// 代理闭环单脚本测试：同进程启动 HttpServer 代理 + fetch 客户端（Scripting 网络栈）
// 验证：/user/info 返回钻石会员+999999金币；付费集自动解锁；金币扣除
import { fetch, Script } from "scripting"
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
  return apiBase(`${BASE}/api${path}`, path, data, token)
}

async function apiDirect(base: string, path: string, data: unknown, token: string): Promise<any> {
  return apiBase(base + "/api" + path, path, data, token)
}

async function apiBase(url: string, path: string, data: unknown, token: string): Promise<any> {
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
  console.log("=== 启动代理（同进程） ===")
  await startProxyServer(8787)

  const saved = Storage.get<{ userId: string; token: string }>("huangdou_login_v1")
  const token = saved?.userId && saved?.token ? `${saved.token}_${saved.userId}` : ""

  console.log("\n[0] 直连对照（绕过代理，直调 psfxhhox.top /user/info）")
  try {
    const direct = await apiDirect("https://psfxhhox.top", "/user/info", {}, token)
    console.log(`  status=${direct.status} balance=${direct.data?.balance} is_vip=${direct.data?.is_vip}`)
  } catch (e) {
    console.log(`  直连失败: ${e instanceof Error ? e.message : e}`)
  }

  console.log("\n[1] /user/info（应返回钻石会员 + 999999 金币）")
  const info = await api("/user/info", {}, token)
  console.log(`  status=${info.status} balance=${info.data?.balance} is_vip=${info.data?.is_vip} play_num=${info.data?.play_num}`)

  console.log("\n[2] /drama/play 金币集（第 3 集）→ 代理自动解锁（VIP 不覆盖金币集，解锁身份需签到金币：第1天仅 VIP，第2天起 200+/天）")
  const play = await api("/drama/play", { id: "6a60ba12b2283e06d44f676e", seq: "3" }, token)
  console.log(`  status=${play.status} err=${play.error || "-"}`)
  if (play.status === "y") {
    console.log(`  ✓ 金币集已解锁 m3u8: ${String(play.data?.m3u8 || play.data?.lines?.[0]?.url || "").slice(0, 90)}`)
  } else {
    console.log(`  ⚠ 金币集未解锁（${play.error}；解锁身份签到积累金币后自动解锁）`)
  }

  console.log("\n[3] /drama/play VIP 剧（m3u8 应为原始地址，hls.js 直连）")
  const vip = await api("/drama/play", { id: "6a583d66b2283e06d44f5f5b", seq: "1" }, token)
  console.log(`  status=${vip.status} err=${vip.error || "-"}`)
  const vipUrl = String(vip.data?.m3u8 || vip.data?.lines?.[0]?.url || "")
  console.log(`  m3u8: ${vipUrl.slice(0, 90)}`)
  console.log(`  ✓ 原始地址（非代理入口）: ${vipUrl.startsWith("http") && !vipUrl.includes("127.0.0.1")}`)

  console.log("\n[4] 再查 /user/info（金币应已扣除）")
  const info2 = await api("/user/info", {}, token)
  console.log(`  balance=${info2.data?.balance}（999999 - 已用）`)

  stopProxyServer()
  Script.exit("OK")
}

main().catch((e) => {
  console.log("FAIL:", e)
  Script.exit("FAIL: " + e)
})
