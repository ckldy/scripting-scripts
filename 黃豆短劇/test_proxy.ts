// 代理闭环测试：请求全部走本地代理 http://127.0.0.1:8787
// 验证：/user/info 返回钻石会员+999999金币；付费集自动解锁
import { fetch, Script } from "scripting"
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
  const bytes = new Uint8Array(requiredData(await response.data()).toArrayBuffer())
  const ivHex = hex(bytes.slice(0, 16))
  const decryptedHex = decryptCBCPkcs7Hex(hex(bytes.slice(16)), key, ivHex)
  const decrypted = new Uint8Array(dataFromHex(decryptedHex).toArrayBuffer())
  const plain = isCompressed(decrypted) ? inflate(decrypted) : decrypted
  return JSON.parse(new TextDecoder().decode(plain))
}

async function main() {
  const saved = Storage.get<{ userId: string; token: string }>("huangdou_login_v1")
  const token = saved?.userId && saved?.token ? `${saved.token}_${saved.userId}` : ""
  if (!token) throw new Error("请先运行 app 或 test_api 完成登录")

  console.log("[1] /user/info（应显示钻石会员 + 999999 金币）")
  const info = await api("/user/info", {}, token)
  console.log(`  status=${info.status} balance=${info.data?.balance} is_vip=${info.data?.is_vip} play_num=${info.data?.play_num}`)

  console.log("[2] /drama/play 金币集（第 3 集）→ 代理应自动解锁")
  const play = await api("/drama/play", { id: "6a60ba12b2283e06d44f676e", seq: "3" }, token)
  console.log(`  status=${play.status} err=${play.error || "-"}`)
  const url = String(play.data?.m3u8 || play.data?.lines?.[0]?.url || "")
  console.log(`  m3u8: ${url.slice(0, 90)}`)

  console.log("[3] /drama/play VIP 剧")
  const vip = await api("/drama/play", { id: "6a583d66b2283e06d44f5f5b", seq: "1" }, token)
  console.log(`  status=${vip.status} err=${vip.error || "-"}`)
  console.log(`  m3u8: ${String(vip.data?.m3u8 || vip.data?.lines?.[0]?.url || "").slice(0, 90)}`)

  console.log("[4] 再查 /user/info 看金币状态（应已扣除）")
  const info2 = await api("/user/info", {}, token)
  console.log(`  balance=${info2.data?.balance}（999999 - 已用）`)

  Script.exit("OK")
}

main().catch((e) => {
  console.log("FAIL:", e)
  Script.exit("FAIL: " + e)
})
