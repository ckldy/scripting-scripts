// 全分类审计：navFilter 各分类的 tab/filter 结构 + 各 tab 的 /drama/list 内容量
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

  console.log("\n[0] 分类列表")
  const nav = await api("/drama/navList", {}, token)
  const categories = Array.isArray(nav?.data?.list) ? nav.data.list : []
  categories.forEach((c: any) => console.log(`  ${c.id} ${c.code} ${c.name}`))

  for (const cat of categories) {
    const code = String(cat.code)
    console.log(`\n===== 分类: ${cat.name} (${code}) =====`)
    // 1. navFilter
    const filter = await api("/drama/navFilter", { code }, token)
    const tabs = Array.isArray(filter?.data?.list) ? filter.data.list : []
    console.log(`  子项数: ${tabs.length}`)
    for (let i = 0; i < tabs.length; i++) {
      const t = tabs[i]
      const flt = t?.filter || {}
      const hasCat = Boolean(flt.cat_id)
      console.log(`  [${i}] tab="${t?.tab || ""}" name="${t?.name || ""}" filter=${JSON.stringify(flt)} ${hasCat ? "→list分页" : "→navBlock聚合?"}`)
      // 2. 验证内容量：无 cat_id 的 tab 走 navBlock 看返回；有 cat_id 的走 list page1
      if (hasCat) {
        const list = await api("/drama/list", { page: "1", page_size: "18", ...flt }, token)
        const items = Array.isArray(list?.data?.list) ? list.data.list : []
        console.log(`     list page1: ${items.length} 部 ${items[0] ? `(首部: ${items[0].name})` : ""}`)
      } else {
        const block = await api("/drama/navBlock", { code, tab: t?.tab || "recommend", page: "1" }, token)
        const blocks = Array.isArray(block?.data?.list) ? block.data.list : []
        console.log(`     navBlock: ${blocks.length} 模块 ${blocks.map((b: any) => `${b?.name}(${Array.isArray(b?.items) ? b.items.length : 0})`).join(", ") || "(空)"}`)
      }
    }
  }

  console.log("\n===== 黄豆原创 (yuandou) 深挖：推荐 tab 用 list(order=new) 分页内容量 =====")
  for (const page of ["1", "2", "3", "4", "5"]) {
    const list = await api("/drama/list", { page, page_size: "18", order: "new" }, token)
    const items = Array.isArray(list?.data?.list) ? list.data.list : []
    console.log(`  page=${page}: ${items.length} 部 ${items[0] ? `(首部: ${items[0].name})` : "(空)"}`)
    if (!items.length) break
  }

  stopProxyServer()
  console.log("\n=== 审计完成 ===")
  Script.exit("OK")
}

main().catch(e => {
  stopProxyServer()
  console.log("FAIL:", e instanceof Error ? e.message : String(e))
  Script.exit("FAIL")
})
