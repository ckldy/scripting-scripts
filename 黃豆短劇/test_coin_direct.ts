// 回归：金币集「扣金币 + 直连真实 m3u8」闭环
// 客户端协议走本地代理 → /drama/play 金币集应返回 status=y + 可访问 m3u8 → 视图金币扣 38
import { Script } from "scripting"
import { startProxyServer, stopProxyServer } from "./proxy"
import { decryptCBCPkcs7Hex, encryptCBCPkcs7Hex } from "./crypto-js"
import { gzip, inflate } from "./pako.min"

const MASTER_KEY = "7961beb44246e3012ce228d6b5ced05a"
const BASE = "http://127.0.0.1:8787"

function deriveKey(requestId: string): string { return Crypto.hmacSHA256(dataFromHex(requestId.replace(/-/g, "")), requiredData(Data.fromString(MASTER_KEY))).toHexString() }
function requiredData(value: Data | null): Data { if (!value) throw new Error("Data 转换失败"); return value }
function dataFromHex(value: string): Data { const bytes = new Uint8Array(Math.floor(value.length / 2)); for (let i = 0; i < bytes.length; i++) bytes[i] = Number.parseInt(value.slice(i * 2, i * 2 + 2), 16); const data = Data.fromArrayBuffer(bytes.buffer); if (!data) throw new Error("hex 转换失败"); return data }
function hex(value: Uint8Array): string { return Array.from(value, b => b.toString(16).padStart(2, "0")).join("") }
function isCompressed(value: Uint8Array): boolean { if (value.length < 2) return false; if (value[0] === 0x1f && value[1] === 0x8b) return true; return value[0] === 0x78 && (((value[0] << 8) | value[1]) % 31 === 0) }

async function api(path: string, data: unknown, token: string): Promise<any> {
  const url = `${BASE}/api${path}`
  const sessionId = UUID.string().replace(/-/g, "").toLowerCase()
  const requestId = UUID.string().toLowerCase()
  const key = deriveKey(requestId)
  const iv = Crypto.generateSymmetricKey(128).toHexString()
  const deviceId = Storage.get<string>("huangdou_device_id_v1") || UUID.string().toLowerCase()
  const jsonData = requiredData(Data.fromString(JSON.stringify({ token, deviceId, data })))
  const plaintext = hex(gzip(new Uint8Array(jsonData.toArrayBuffer())))
  const body = dataFromHex(iv + encryptCBCPkcs7Hex(plaintext, key, iv))
  const time = Math.floor(Date.now() / 1000)
  const signSource = `Dart|${sessionId}|${requestId}|${time}|${url.replace(/^https?:\/\//, "")}`
  const response = await fetch(url, { method: "POST", headers: { version: "1.0.0", deviceType: "web", time: String(time), sign: `${Crypto.md5(requiredData(Data.fromString(signSource))).toHexString()}-${time}`, requestId, sessionId, deviceBrand: "", deviceModel: "", systemName: "", systemVersion: "", "Content-Type": "application/x-www-form-urlencoded" }, body })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const bytes = new Uint8Array(requiredData(await response.data()).toArrayBuffer())
  const ivHex = hex(bytes.slice(0, 16))
  const decryptedHex = decryptCBCPkcs7Hex(hex(bytes.slice(16)), key, ivHex)
  const decrypted = new Uint8Array(dataFromHex(decryptedHex).toArrayBuffer())
  const plain = isCompressed(decrypted) ? inflate(decrypted) : decrypted
  return JSON.parse(new TextDecoder().decode(plain))
}

async function main() {
  console.log("=== 启动代理 ===")
  await startProxyServer(8787)
  const saved = Storage.get<{ userId: string; token: string }>("huangdou_login_v1")
  const token = saved?.userId && saved?.token ? `${saved.token}_${saved.userId}` : ""

  console.log("\n[1] 播放金币集（id=6a52d26d0e18e7c330a8d1f0 seq=8）")
  const play = await api("/drama/play", { id: "6a52d26d0e18e7c330a8d1f0", seq: "8" }, token)
  const m3u8 = String(play.data?.m3u8 || play.data?.lines?.[0]?.url || "")
  console.log(`  status=${play.status} err=${play.error || "-"} m3u8=${m3u8.slice(0, 100)}`)
  if (play.status !== "y" || !m3u8) throw new Error(`金币集未直连: ${JSON.stringify(play).slice(0, 200)}`)

  console.log("\n[2] 验证返回的 m3u8 可访问（代理改写地址，应含 #EXTM3U + AES-128 key + /cdn/ 分片地址）")
  if (!m3u8.startsWith("http://127.0.0.1:8787/hls/")) throw new Error(`m3u8 未改写为代理地址: ${m3u8}`)
  const check = await fetch(m3u8, { headers: { "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0.1 Mobile/15E148 Safari/604.1", Accept: "*/*" } })
  const checkBytes = new Uint8Array(requiredData(await check.data()).toArrayBuffer())
  const fullText = new TextDecoder().decode(checkBytes)
  const head = fullText.slice(0, 500)
  console.log(`  HTTP ${check.status} ${checkBytes.length}B`)
  console.log(`  ${head.split("\n").slice(0, 6).join(" | ")}`)
  if (!head.includes("#EXTM3U")) throw new Error("m3u8 内容异常")
  if (!head.includes("/cdn/")) throw new Error("m3u8 内 key/分片未改写为 /cdn/ 代理地址")

  console.log("\n[2b] 通过代理拉取 AES key（/cdn/ 地址应可访问）")
  const keyMatch = fullText.match(/URI="([^"]+)/)
  if (!keyMatch) throw new Error("m3u8 无 AES key 行")
  const keyUrl = keyMatch[1]
  console.log(`  key=${keyUrl.slice(0, 90)}`)
  const keyResp = await fetch(keyUrl, { headers: { Accept: "*/*" } })
  const keyBytes = new Uint8Array(requiredData(await keyResp.data()).toArrayBuffer())
  console.log(`  HTTP ${keyResp.status} ${keyBytes.length}B`)
  if (keyResp.status !== 200 || keyBytes.length < 16) throw new Error(`AES key 拉取失败: ${keyResp.status} ${keyBytes.length}B`)

  console.log("\n[2c] 通过代理拉取第一个分片（/cdn/ 地址应可访问）")
  const segMatch = fullText.match(/https?:\/\/[^\s"]+\.ts[^\s"]*/)
  if (!segMatch) throw new Error("m3u8 无分片行")
  const segUrl = segMatch[0]
  console.log(`  seg=${segUrl.slice(0, 90)}`)
  const segResp = await fetch(segUrl, { headers: { Accept: "*/*" } })
  const segBytes = new Uint8Array(requiredData(await segResp.data()).toArrayBuffer())
  console.log(`  HTTP ${segResp.status} ${segBytes.length}B`)
  if (segResp.status !== 200 || segBytes.length < 1024) throw new Error(`分片拉取失败: ${segResp.status} ${segBytes.length}B`)

  console.log("\n[3] 金币扣费生效（每次播放扣 38，余额持久化）")
  const infoBefore = await api("/user/info", {}, token)
  console.log(`  balance=${infoBefore.data?.balance}`)
  await api("/drama/play", { id: "6a52d26d0e18e7c330a8d1f0", seq: "8" }, token)
  const infoAfter = await api("/user/info", {}, token)
  console.log(`  再次播放后 balance=${infoAfter.data?.balance}`)
  const before = Number(infoBefore.data?.balance) || 0
  const after = Number(infoAfter.data?.balance) || 0
  if (before - after !== 38) throw new Error(`金币扣减异常: ${before} → ${after}`)

  console.log("\n[4] doBuy 扣金币请求 → 改写为成功")
  const buy = await api("/drama/doBuy", { id: "6a52d26d0e18e7c330a8d1f0", seq: "8", method: "coin" }, token)
  console.log(`  status=${buy.status} err=${buy.error || "-"} data=${JSON.stringify(buy.data).slice(0, 100)}`)
  if (buy.status !== "y") throw new Error(`doBuy 未改写成功: ${JSON.stringify(buy).slice(0, 160)}`)

  console.log("\n[5] doSign 签到请求 → 改写为成功")
  const sign = await api("/user/doSign", {}, token)
  console.log(`  status=${sign.status} prize=${sign.data?.prize_name || "-"} msg=${sign.data?.msg || "-"}`)
  if (sign.status !== "y") throw new Error(`doSign 未改写成功: ${JSON.stringify(sign).slice(0, 160)}`)

  console.log("\n[6] detail 详情 → 付费集标记已购买")
  const detail = await api("/drama/detail", { id: "6a52d26d0e18e7c330a8d1f0" }, token)
  const eps = Array.isArray(detail.data?.episodes) ? detail.data.episodes : []
  const paid = eps.filter((e: any) => Number(e?.price || 0) > 0 || e?.type === "vip" || e?.type === "coin")
  const paidBought = paid.filter((e: any) => e?.is_buy === true)
  console.log(`  付费集 ${paid.length} 个，已标记购买 ${paidBought.length} 个`)
  if (!paid.length) console.log("  ⚠ 该剧无付费集（跳过断言）")
  else if (paidBought.length !== paid.length) throw new Error(`付费集未全部标记: ${paidBought.length}/${paid.length}`)

  stopProxyServer()
  console.log("\n结果: ✓ 金币集扣金币 + 直连真实 m3u8 闭环可用")
  Script.exit("OK")
}

main().catch(e => {
  stopProxyServer()
  console.log("FAIL:", e instanceof Error ? e.message : String(e))
  Script.exit("FAIL")
})
