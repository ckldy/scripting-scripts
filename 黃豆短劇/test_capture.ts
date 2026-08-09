// 本地抓包：抓取真实请求/响应样本（requestId + 响应密文），供 node 解密验证
// 样本保存到 samples/capture.json，然后由 node decrypt.js 独立解密验证
import { fetch, Script } from "scripting"
import { encryptCBCPkcs7Hex } from "./crypto-js"
import { gzip } from "./pako.min"

const MASTER_KEY = "7961beb44246e3012ce228d6b5ced05a"
const BASE = "https://lzlukvca.cc"
const SAMPLES_PATH = FileManager.scriptsDirectory + "/黃豆短劇/samples/capture.json"

type Sample = { label: string; path: string; requestId: string; key: string; iv: string; cipherHex: string; rawHex: string }

function deriveKey(requestId: string): string { return Crypto.hmacSHA256(dataFromHex(requestId.replace(/-/g, "")), requiredData(Data.fromString(MASTER_KEY))).toHexString() }
function requiredData(value: Data | null): Data { if (!value) throw new Error("Data 转换失败"); return value }
function dataFromHex(value: string): Data { const bytes = new Uint8Array(Math.floor(value.length / 2)); for (let i = 0; i < bytes.length; i++) bytes[i] = Number.parseInt(value.slice(i * 2, i * 2 + 2), 16); const data = Data.fromArrayBuffer(bytes.buffer); if (!data) throw new Error("hex 转换失败"); return data }
function hex(value: Uint8Array): string { return Array.from(value, b => b.toString(16).padStart(2, "0")).join("") }

async function capture(label: string, path: string, data: unknown, token: string): Promise<void> {
  const url = `${BASE}/api${path}`
  const sessionId = UUID.string().replace(/-/g, "").toLowerCase()
  const requestId = UUID.string().toLowerCase()
  const key = deriveKey(requestId)
  const iv = Crypto.generateSymmetricKey(128).toHexString()
  const deviceId = Storage.get<string>("huangdou_device_id_v1") || UUID.string().toLowerCase()
  const jsonData = requiredData(Data.fromString(JSON.stringify({ token, deviceId, data })))
  const plaintext = hex(gzip(new Uint8Array(jsonData.toArrayBuffer())))
  const encrypted = encryptCBCPkcs7Hex(plaintext, key, iv)
  const body = dataFromHex(iv + encrypted)
  const time = Math.floor(Date.now() / 1000)
  const signSource = `Dart|${sessionId}|${requestId}|${time}|${url.replace(/^https?:\/\//, "")}`
  const response = await fetch(url, { method: "POST", headers: { version: "1.0.0", deviceType: "web", time: String(time), sign: `${Crypto.md5(requiredData(Data.fromString(signSource))).toHexString()}-${time}`, requestId, sessionId, deviceBrand: "", deviceModel: "", systemName: "", systemVersion: "", "Content-Type": "application/x-www-form-urlencoded" }, body })
  const bytes = new Uint8Array(requiredData(await response.data()).toArrayBuffer())
  const rawHex = hex(bytes)
  const sample: Sample = { label, path, requestId, key, iv, cipherHex: rawHex.length > 32 ? rawHex.slice(32) : "", rawHex }
  FileManager.appendTextSync(SAMPLES_PATH, JSON.stringify(sample) + "\n")
  console.log(`[${label}] ${path} → status=${response.status} respBytes=${bytes.length} requestId=${requestId.slice(0, 8)}… 已存样本`)
}

async function main() {
  const saved = Storage.get<{ userId: string; token: string }>("huangdou_login_v1")
  const token = saved?.userId && saved?.token ? `${saved.token}_${saved.userId}` : ""
  if (!token) throw new Error("请先运行一次 app 或 test_api 完成登录")

  await FileManager.createDirectorySync(FileManager.scriptsDirectory + "/黃豆短劇/samples", true)
  if (FileManager.existsSync(SAMPLES_PATH)) FileManager.removeSync(SAMPLES_PATH)

  await capture("用户信息", "/user/info", {}, token)
  await capture("免费集播放", "/drama/play", { id: "6a60ba12b2283e06d44f676e", seq: "1" }, token)
  await capture("金币集播放", "/drama/play", { id: "6a60ba12b2283e06d44f676e", seq: "3" }, token)

  Script.exit("OK")
}

main().catch((e) => {
  console.log("FAIL:", e)
  Script.exit("FAIL: " + e)
})
