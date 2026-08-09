// 直接请求 navBlock（推荐 tab）解密看首页各模块实际内容量
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

  console.log("\n[1] navFilter（分类筛选 tab）")
  const filter = await api("/drama/navFilter", { code: "yuandou" }, token)
  console.log(`  tabs: ${JSON.stringify(Array.isArray(filter?.data?.list) ? filter.data.list.map((t: any) => ({ tab: t.tab, name: t.name, filter: t.filter })) : filter?.data)}`)

  console.log("\n[2] navBlock（首页模块，推荐 tab）")
  const block = await api("/drama/navBlock", { code: "yuandou", tab: "recommend", page: "1" }, token)
  const blocks = Array.isArray(block?.data?.list) ? block.data.list : []
  console.log(`  模块数: ${blocks.length}`)
  blocks.forEach((b: any) => {
    const items = Array.isArray(b?.items) ? b.items : []
    console.log(`  - ${b?.name} (${b?.sub_name || ""}): ${items.length} 部`)
  })

  console.log("\n[3] navBlock page=2（加载更多）")
  const block2 = await api("/drama/navBlock", { code: "yuandou", tab: "recommend", page: "2" }, token)
  const blocks2 = Array.isArray(block2?.data?.list) ? block2.data.list : []
  console.log(`  模块数: ${blocks2.length}`)
  blocks2.forEach((b: any) => console.log(`  - ${b?.name}: ${Array.isArray(b?.items) ? b.items.length : 0} 部`))

  console.log("\n[4] /drama/list 带 filter(order=new) 分页列表")
  for (const page of ["1", "2", "3"]) {
    const list = await api("/drama/list", { page, page_size: "18", order: "new" }, token)
    const items = Array.isArray(list?.data?.list) ? list.data.list : []
    console.log(`  page=${page}: ${items.length} 部 ${items[0] ? `(首部: ${items[0].name})` : ""}`)
    if (!items.length) break
  }

  console.log("\n[5] /drama/list 不带 order（默认）")
  const listDef = await api("/drama/list", { page: "1", page_size: "18" }, token)
  console.log(`  page=1: ${Array.isArray(listDef?.data?.list) ? listDef.data.list.length : 0} 部`)

  console.log("\n[6] 其他分类 navFilter（如 zhenren 真人短剧）")
  for (const code of ["zhenren", "zongyi", "chuanmei"]) {
    const f = await api("/drama/navFilter", { code }, token)
    const tabs = Array.isArray(f?.data?.list) ? f.data.list.map((t: any) => ({ tab: t.tab, name: t.name, filter: t.filter })) : []
    console.log(`  ${code}: ${JSON.stringify(tabs)}`)
  }

  stopProxyServer()
  Script.exit("OK")
}

main().catch(e => {
  stopProxyServer()
  console.log("FAIL:", e instanceof Error ? e.message : String(e))
  Script.exit("FAIL")
})
