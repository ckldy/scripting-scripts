// 黄豆短剧本地代理（Scripting HttpServer 版）
// 架构：解密客户端请求 → 代理自建请求（新 requestId/sign）转发上游 → 解密响应 → 改写
//   （/user/info → 钻石会员 + 999999 金币；/drama/play 付费墙 → 解锁身份真实播放并从金币状态扣除）
//   → 用客户端 key 重加密返回。客户端只需把 API 指向 http://127.0.0.1:8787
// 注意：HttpServer/HttpResponse/HttpResponseBody/HttpRequest 为全局 API，无需导入
import { fetch, Script } from "scripting"
import { decryptCBCPkcs7Hex, encryptCBCPkcs7Hex } from "./crypto-js"
import { gzip, inflate } from "./pako.min"

const MASTER_KEY = "7961beb44246e3012ce228d6b5ced05a"
// 线路容错：与 client.ts 一致，主线路不可用时自动切换
const LINES = [
  { code: "china_1", base: "https://lzlukvca.cc" },
  { code: "china_1", base: "https://psfxhhox.top" },
  { code: "china_2", base: "https://sxqirtho.top" },
  { code: "china_3", base: "https://qicuknlj.top" },
  { code: "china_4", base: "https://hddj05.com" },
  { code: "china_5", base: "https://hddj06.com" },
  { code: "china_6", base: "https://hddj07.com" },
  { code: "oversea_1", base: "https://hvthtcpa.top" },
]
const PORT = 8787
const PROXY_BASE = `http://127.0.0.1:${PORT}`
const HLS_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1"
// 成功线路持久化：代理重启后首请求/首播直接命中上次可用线路，避免重新探测（preferredLineBase 为内存态，重启丢失）。
const LINE_KEY = "huangdou_proxy_line_v1"
let preferredLineBase: string | null = null
function loadPreferredLine(): void { try { const saved = Storage.get<{ base: string }>(LINE_KEY); if (saved?.base && LINES.some(line => line.base === saved.base)) preferredLineBase = saved.base } catch { } }
function savePreferredLine(base: string): void { try { Storage.set(LINE_KEY, { base }) } catch { } }

// ---------- HLS 资源改写：AVPlayer 用 AppleCoreMedia UA 拉 CloudFront 会被挂起，
// 代理把所有 HLS 资源 URL（m3u8/key/分片）改写成代理地址，代理用 Safari UA 转发 ----------
function toProxyUrl(original: string): string {
  return `${PROXY_BASE}/hls/${encodeURIComponent(original)}`
}
function fromProxyPath(encoded: string): string {
  try { return decodeURIComponent(encoded) } catch { return "" }
}
function isHlsResource(path: string): boolean {
  return path.startsWith("/hls/") || path.startsWith("/cdn/")
}

async function fetchManifestOnce(url: string): Promise<{ status: number; bytes: Uint8Array }> {
  const started = Date.now()
  const response = await withTimeout(4000, (async () => {
    const res = await fetch(url, { headers: { "User-Agent": HLS_UA, Accept: "*/*" } })
    const bytes = new Uint8Array(requiredData(await res.data()).toArrayBuffer())
    return { res, bytes }
  })())
  console.log(`[代理] m3u8 探测 ${Date.now() - started}ms ${url.slice(0, 60)}… → ${response.res.status} ${response.bytes.length}B`)
  return { status: response.res.status, bytes: response.bytes }
}

async function fetchWithSafariUA(url: string): Promise<{ status: number; bytes: Uint8Array }> {
  // key/分片重试 3 次（30s 超时）：网络抖动时自动重试，避免一次失败导致播放中断。
  // 超时必须覆盖 fetch+body 下载全程（此前只包 fetch 头，大分片 body 挂起时无超时保护）。
  let lastErr: unknown = null
  for (let attempt = 1; attempt <= 3; attempt++) {
    const started = Date.now()
    try {
      const response = await withTimeout(30000, (async () => {
        const res = await fetch(url, { headers: { "User-Agent": HLS_UA, Accept: "*/*" } })
        const bytes = new Uint8Array(requiredData(await res.data()).toArrayBuffer())
        return { res, bytes }
      })())
      console.log(`[代理] HLS 拉取 ${Date.now() - started}ms ${url.slice(0, 60)}… → ${response.res.status} ${response.bytes.length}B`)
      return { status: response.res.status, bytes: response.bytes }
    } catch (e) {
      lastErr = e
      console.log(`[代理] HLS 拉取尝试${attempt}失败 ${url.slice(0, 60)}… → ${e instanceof Error ? e.message : e}`)
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("HLS 拉取失败")
}

// HLS 地址带有 auth_key（有效期约 1h），不能缓存到签名过期后仍用旧 URL 拉上游。
// 但缓存存的是“已下载的内容”（数据有效，与签名无关）：AVPlayer 的 URL 来自 2min 内刷新的清单，签名始终新鲜；
// 缓存只影响“未命中时拿旧 URL 拉上游”这一条路径。因此内容 TTL 放宽到 30min（仍 < 1h 签名期，安全冗余），
// 提升连播/切集/回看的缓存命中率；清单 TTL 保持 2min 确保签名新鲜。
const hlsCache = new Map<string, { bytes: Uint8Array; ts: number }>()
const hlsInFlight = new Map<string, Promise<{ status: number; bytes: Uint8Array }>>()
const HLS_MANIFEST_TTL = 2 * 60 * 1000
const HLS_RESOURCE_TTL = 30 * 60 * 1000

// 定期清理过期缓存条目：长期看剧时 Map 只增不减（过期条目仅在命中时删除），避免内存累积。
// 用递归 setTimeout（而非 setInterval），与代理进程生命周期一致且无重复定时器风险。
function scheduleHlsCacheCleanup(): void {
  setTimeout(() => {
    const now = Date.now()
    let removed = 0
    for (const [url, entry] of hlsCache) {
      if (now - entry.ts > HLS_RESOURCE_TTL) { hlsCache.delete(url); removed++ }
    }
    if (removed) console.log(`[代理] HLS 缓存清理 ${removed} 条过期资源（剩余 ${hlsCache.size} 条）`)
    scheduleHlsCacheCleanup()
  }, 5 * 60 * 1000)
}

async function fetchHlsCached(url: string): Promise<{ status: number; bytes: Uint8Array }> {
  const ttl = /\.m3u8(?:[?#]|$)/i.test(url) ? HLS_MANIFEST_TTL : HLS_RESOURCE_TTL
  const hit = hlsCache.get(url)
  if (hit && Date.now() - hit.ts < ttl) {
    console.log(`[代理] HLS 缓存命中 ${resourceLabel(url)} ${url.slice(0, 60)}… (${hit.bytes.length}B)`)
    return { status: 200, bytes: hit.bytes }
  }
  if (hit) hlsCache.delete(url)
  const pending = hlsInFlight.get(url)
  if (pending) {
    console.log(`[代理] HLS 等待同一请求 ${resourceLabel(url)} ${url.slice(0, 60)}…`)
    return pending
  }
  const request = (/\.m3u8(?:[?#]|$)/i.test(url) ? fetchManifestOnce(url) : fetchWithSafariUA(url)).then(result => {
    if (result.status === 200 && result.bytes.length > 0) hlsCache.set(url, { bytes: result.bytes, ts: Date.now() })
    return result
  }).finally(() => hlsInFlight.delete(url))
  hlsInFlight.set(url, request)
  return request
}

// 每剧记住可用线路：同一剧的所有集共享同一上游线路（已实证 8 线路清单分片同源同结构），
// 按剧记（而非按集）让切集直接命中记忆，坏线路场景跳过 4s 失败探测。
// 持久化到 Storage：重启后继续生效；上限 500 条（超出删除最旧），避免无限增长。
const LINE_CACHE_KEY = "huangdou_proxy_lines_v1"
const LINE_CACHE_MAX = 500
const hlsLineCache = new Map<string, string>()
// 记忆键：优先提取 dramaId（同剧共用线路），无法提取时退回完整 URL（兼容旧数据/非标准格式）。
function lineCacheKey(url: string): string {
  const match = url.match(/\/api\/drama\/hls\/([^/]+)\//i)
  return match ? `d:${match[1]}` : url
}
function loadLineCache(): void {
  try {
    const saved = Storage.get<Record<string, string>>(LINE_CACHE_KEY)
    if (saved) for (const [url, line] of Object.entries(saved)) if (LINES.some(item => item.base === line)) hlsLineCache.set(url, line)
  } catch { }
}
function saveLineCache(): void {
  if (hlsLineCache.size > LINE_CACHE_MAX) {
    // Map 迭代顺序 = 插入序：超出上限时删除最旧条目
    const overflow = hlsLineCache.size - LINE_CACHE_MAX
    for (let index = 0; index < overflow; index++) {
      const first = hlsLineCache.keys().next().value
      if (first !== undefined) hlsLineCache.delete(first)
    }
  }
  try { Storage.set(LINE_CACHE_KEY, Object.fromEntries(hlsLineCache)) } catch { }
}

async function fetchManifestWithLineFallback(original: string): Promise<{ status: number; bytes: Uint8Array }> {
  const preferredOrigin = original.match(/^(https?:\/\/[^/]+)/i)?.[1] ?? ""
  // 1) 已记住该剧可用线路 → 直接请求，快速返回（按剧记忆，切集直接命中）
  const remembered = hlsLineCache.get(lineCacheKey(original))
  if (remembered && remembered !== preferredOrigin) {
    try {
      // 记忆线路命中：统一按已验证可用的 free 直连格式构造（play.m3u8 无鉴权），
      // 避免原始 URL 的 query（token/line 参数）绑定原线路 host 导致换线后失效。
      const pathPart = original.match(/^https?:\/\/[^/]+(\/api\/drama\/hls\/[^/]+\/[^/]+\/play\.m3u8)/i)
      const candidate = pathPart ? `${remembered}${pathPart[1]}?line=free` : original.replace(preferredOrigin, remembered)
      const result = await fetchHlsCached(candidate)
      const text = new TextDecoder().decode(result.bytes)
      if (result.status === 200 && text.includes("#EXTM3U")) {
        hlsCache.set(original, { bytes: result.bytes, ts: Date.now() })
        console.log(`[代理] 清单线路记忆命中 ${remembered}`)
        return result
      }
    } catch (error) {
      console.log(`[代理] 清单记忆线路失效 ${remembered}: ${error instanceof Error ? error.message : error}`)
    }
    hlsLineCache.delete(lineCacheKey(original))
    saveLineCache()
  }
  // 2) 首选线路快速探测
  const first = await fetchHlsCached(original).catch(error => {
    console.log(`[代理] 首选线路清单失败 ${original.slice(0, 70)}…: ${error instanceof Error ? error.message : error}`)
    return null
  })
  if (first && first.status === 200 && new TextDecoder().decode(first.bytes).includes("#EXTM3U")) {
    if (preferredOrigin && hlsLineCache.get(lineCacheKey(original)) !== preferredOrigin) { hlsLineCache.set(lineCacheKey(original), preferredOrigin); saveLineCache() }
    return first
  }
  // 3) 备用线路（最多 3 条，每条 4s 上限）
  // 匹配任意 query 的 play.m3u8（真实解锁/VIP 返回的地址可能带 token/line 参数），
  // 回退候选统一使用已验证可用的 free 直连格式。
  const match = original.match(/^https?:\/\/[^/]+(\/api\/drama\/hls\/[^/]+\/[^/]+\/play\.m3u8)(?:[?#].*)?$/i)
  if (!match) return first || { status: 502, bytes: new Uint8Array() }
  let tried = 0
  for (const line of LINES) {
    if (line.base === preferredOrigin || tried >= 3) continue
    tried++
    const candidate = `${line.base}${match[1]}?line=free`
    try {
      const result = await fetchHlsCached(candidate)
      const text = new TextDecoder().decode(result.bytes)
      if (result.status === 200 && text.includes("#EXTM3U")) {
        hlsCache.set(original, { bytes: result.bytes, ts: Date.now() })
        hlsLineCache.set(lineCacheKey(original), line.base)
        saveLineCache()
        console.log(`[代理] 清单线路回退成功 ${preferredOrigin} → ${line.base}`)
        return result
      }
    } catch (error) {
      console.log(`[代理] 清单备用线路失败 ${line.base}: ${error instanceof Error ? error.message : error}`)
    }
  }
  return first || { status: 502, bytes: new Uint8Array() }
}

// 改写 m3u8 内容：所有 https CDN 资源 URL → 代理 /cdn/ 地址
function resourceLabel(url: string): string {
  if (/\.m3u8(?:[?#]|$)/i.test(url)) return "m3u8"
  if (/\.(?:key|key\?|enc\.key)(?:[?#]|$)/i.test(url) || /(?:^|[/?])enc\.key(?:[?#]|$)/i.test(url)) return "key"
  return "segment"
}

function rewriteM3u8(text: string): string {
  return text.replace(/https?:\/\/[^\s"']+/g, raw => {
    if (raw.startsWith(PROXY_BASE)) return raw
    return `${PROXY_BASE}/cdn/${encodeURIComponent(raw)}`
  })
}

// ---------- 自动选择最高画质：master playlist（多码率变体）→ 解析并选最高码率变体 ----------
// 上游 play.m3u8 目前是单码率 media playlist（720p，无 #EXT-X-STREAM-INF）；
// 若未来/某些剧种返回 master playlist（含多个 #EXT-X-STREAM-INF 变体），
// 代理自动解析 BANDWIDTH/RESOLUTION 并选择最高画质变体，返回其 media playlist，
// 保证 AVPlayer 直接播放最高码率档位（避免 AVPlayer 按带宽自适应降级）。
function pickBestVariantUrl(masterText: string, baseUrl: string): string | null {
  const lines = masterText.split(/\r?\n/)
  let best: { bandwidth: number; resolution: number; url: string } | null = null
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line.startsWith("#EXT-X-STREAM-INF")) continue
    const attrs = line.slice(line.indexOf(":") + 1)
    const bandwidth = Number(/BANDWIDTH=(\d+)/i.exec(attrs)?.[1] ?? 0)
    const res = /RESOLUTION=(\d+)x(\d+)/i.exec(attrs)
    const resolution = res ? Number(res[1]) * Number(res[2]) : 0
    const urlLine = (lines[i + 1] || "").trim()
    if (!urlLine || urlLine.startsWith("#")) continue
    let absolute: string
    try { absolute = new URL(urlLine, baseUrl).toString() } catch { continue }
    if (!best || bandwidth > best.bandwidth || (bandwidth === best.bandwidth && resolution > best.resolution)) {
      best = { bandwidth, resolution, url: absolute }
    }
  }
  return best?.url ?? null
}

// 从清单文本判断是否已含分片（media playlist）；master playlist 只有变体行无分片。
// 注意：media playlist 一定有 #EXTINF 行（每个分片前一行），master playlist 没有。
function isMediaPlaylist(text: string): boolean {
  return text.includes("#EXTINF")
}

// warm 预热专用：短超时（10s）、独立请求（不共享 hlsInFlight），成功才入缓存。
// 目的：慢网络下 warm 卡住时绝不拖累播放器的真实请求——此前 warm 与播放器共用 inFlight，
// 播放器会复用 warm 的请求一起等 30s 超时后再自己重试，起播被放大到 30s+ 且缓冲耗尽中断。
// 代价：warm 下载中若播放器同时请求同一 URL 会重复下载（仅 10s 窗口内，可接受）。
async function fetchHlsWarmOnce(url: string): Promise<boolean> {
  try {
    const result = await withTimeout(6000, (async () => {
      const res = await fetch(url, { headers: { "User-Agent": HLS_UA, Accept: "*/*" } })
      const bytes = new Uint8Array(requiredData(await res.data()).toArrayBuffer())
      return { res, bytes }
    })())
    if (result.res.status === 200 && result.bytes.length > 0) {
      hlsCache.set(url, { bytes: result.bytes, ts: Date.now() })
      return true
    }
  } catch (error) {
    console.log(`[代理] HLS 预热跳过 ${url.slice(0, 60)}…: ${error instanceof Error ? error.message : error}`)
  }
  return false
}

async function warmManifestResources(manifest: string): Promise<void> {
  const key = manifest.match(/URI="([^"]+)"/i)?.[1]
  if (key && /^https?:\/\//i.test(key)) {
    if (!(await fetchHlsWarmOnce(key))) throw new Error(`AES key 预热失败: HTTP 或超时`)
  }
  const firstSegment = manifest.split(/\r?\n/).map(line => line.trim()).find(line => line && !line.startsWith("#") && /^https?:\/\//i.test(line))
  if (firstSegment) {
    if (!(await fetchHlsWarmOnce(firstSegment))) throw new Error(`首片预热失败: HTTP 或超时`)
  }
}

async function handleHlsResource(encodedUrl: string, waitForWarm = false): Promise<HttpResponse> {
  const original = fromProxyPath(encodedUrl)
  console.log(`[代理] HLS 资源: ${String(original).slice(0, 90)}`)
  if (!original || !/^https?:\/\//.test(original)) {
    return HttpResponse.raw(400, "Bad Request", { body: Data.fromRawString("bad hls url", "utf-8") })
  }
  const started = Date.now()
  const upstream = /\.m3u8(?:[?#]|$)/i.test(original)
    ? await fetchManifestWithLineFallback(original)
    : await fetchHlsCached(original)
  console.log(`[代理] HLS 响应 ${resourceLabel(original)} ${Date.now() - started}ms HTTP ${upstream.status} ${upstream.bytes.length}B`)
  let text = new TextDecoder().decode(upstream.bytes)
  if (text.includes("#EXTM3U") || text.includes("#EXT-X")) {
    // 自动选择最高画质：master playlist（多码率变体）→ 解析最高码率变体并递归拉取其 media playlist，
    // 返回给播放器的始终是最高画质档位；单码率 media playlist 保持不变。
    if (text.includes("#EXT-X-STREAM-INF") && !isMediaPlaylist(text)) {
      const bestVariant = pickBestVariantUrl(text, original)
      if (bestVariant && bestVariant !== original) {
        const variantStarted = Date.now()
        try {
          const variant = /\.m3u8(?:[?#]|$)/i.test(bestVariant)
            ? await fetchManifestWithLineFallback(bestVariant)
            : await fetchHlsCached(bestVariant)
          const variantText = new TextDecoder().decode(variant.bytes)
          if (variant.status === 200 && (variantText.includes("#EXTM3U") || variantText.includes("#EXT-X"))) {
            console.log(`[代理] master playlist 自动选择最高画质变体 ${Date.now() - variantStarted}ms → ${bestVariant.slice(0, 90)} (${variant.bytes.length}B)`)
            text = variantText
          } else {
            console.log(`[代理] 最高画质变体拉取失败 HTTP ${variant.status}，回退 master 原样返回`)
          }
        } catch (error) {
          console.log(`[代理] 最高画质变体拉取异常，回退 master 原样返回: ${error instanceof Error ? error.message : error}`)
        }
      }
    }
    // m3u8 清单：改写内容中的资源 URL
    const rewritten = rewriteM3u8(text)
    if (waitForWarm) {
      // 预热请求（episode-player 连播预热）：等待 key 和首片尽力入缓存后返回，确保多集预热保持串行。
      // 预热失败不抛错——清单本身有效，预热只是“尽力缓存”，失败返回 200 清单，避免 HttpServer 500。
      const warmStarted = Date.now()
      console.log(`[代理] HLS 完整预热开始 ${original.slice(0, 70)}…`)
      const warmOk = await warmManifestResources(text).then(() => true).catch(error => {
        console.log(`[代理] HLS 完整预热未完成（仍返回清单）: ${error instanceof Error ? error.message : error}`)
        return false
      })
      console.log(`[代理] HLS 完整预热${warmOk ? "完成" : "未完成"} ${Date.now() - warmStarted}ms ${original.slice(0, 70)}…`)
    } else {
      // 正常播放不阻塞清单响应；后台预热与 AVPlayer 的同资源请求会通过 hlsInFlight 去重。
      void warmManifestResources(text).catch(error => {
        console.log(`[代理] HLS 首帧预热失败: ${error instanceof Error ? error.message : error}`)
      })
    }
    return HttpResponse.raw(upstream.status, "OK", { headers: { "Content-Type": "application/vnd.apple.mpegurl", "Access-Control-Allow-Origin": "*" }, body: Data.fromRawString(rewritten, "utf-8") })
  }
  // key / 分片：原样转发
  return HttpResponse.raw(upstream.status, "OK", { headers: { "Content-Type": "application/octet-stream", "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=3600" }, body: Data.fromArrayBuffer(upstream.bytes.buffer) })
}

// ---------- 视图状态：钻石会员 + 999999 金币（每次回应都返回此状态） ----------
// 平台规则：金币集单集解锁固定 38 金币/集（doBuy 与付费墙直连统一口径）
const COIN_PRICE = 38
const VIEW_KEY = "huangdou_proxy_view_v1"
let viewState: { balance: number; used: number } = { balance: 999999, used: 0 }
function loadView(): void { try { const s = Storage.get<{ balance: number; used: number }>(VIEW_KEY); if (s) viewState = { balance: 999999, used: 0, ...s } } catch { } }
function saveView(): void { Storage.set(VIEW_KEY, viewState) }
function deductCoins(price: number): void { viewState.used += price; viewState.balance = Math.max(0, 999999 - viewState.used); saveView() }

// ---------- 解锁身份（代理自己的设备，每日签到拿 VIP 1天） ----------
const UNLOCK_KEY = "huangdou_proxy_unlock_v1"
type UnlockState = { deviceId: string; userId: string; token: string; signedDay: string }
let unlock: UnlockState = { deviceId: "", userId: "", token: "", signedDay: "" }
function loadUnlock(): void { try { const s = Storage.get<UnlockState>(UNLOCK_KEY); if (s) unlock = s } catch { } }
function saveUnlock(): void { Storage.set(UNLOCK_KEY, unlock) }

// ---------- 协议工具（与 client.ts 一致） ----------
function withTimeout<T>(ms: number, promise: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`请求超时（${ms / 1000}s）`)), ms)
    promise.then(v => { clearTimeout(timer); resolve(v) }, e => { clearTimeout(timer); reject(e) })
  })
}
function deriveKey(requestId: string): string { return Crypto.hmacSHA256(dataFromHex(requestId.replace(/-/g, "")), requiredData(Data.fromString(MASTER_KEY))).toHexString() }
function requiredData(value: Data | null): Data { if (!value) throw new Error("数据处理失败"); return value }
function dataFromHex(value: string): Data { const bytes = new Uint8Array(Math.floor(value.length / 2)); for (let i = 0; i < bytes.length; i++) bytes[i] = Number.parseInt(value.slice(i * 2, i * 2 + 2), 16); const data = Data.fromArrayBuffer(bytes.buffer); if (!data) throw new Error("hex 转换失败"); return data }
function hex(value: Uint8Array): string { return Array.from(value, b => b.toString(16).padStart(2, "0")).join("") }
function isCompressed(value: Uint8Array): boolean { if (value.length < 2) return false; if (value[0] === 0x1f && value[1] === 0x8b) return true; return value[0] === 0x78 && (((value[0] << 8) | value[1]) % 31 === 0) }
function decryptResponse(raw: Uint8Array, keyHex: string): any {
  const ivHex = hex(raw.slice(0, 16))
  const plainHex = decryptCBCPkcs7Hex(hex(raw.slice(16)), keyHex, ivHex)
  const decrypted = new Uint8Array(dataFromHex(plainHex).toArrayBuffer())
  const plain = isCompressed(decrypted) ? inflate(decrypted) : decrypted
  return JSON.parse(new TextDecoder().decode(plain))
}
function encryptResponse(obj: any, keyHex: string): Data {
  const plain = new Uint8Array(requiredData(Data.fromString(JSON.stringify(obj))).toArrayBuffer())
  const compressed = gzip(plain)
  const iv = Crypto.generateSymmetricKey(128).toHexString()
  const encrypted = encryptCBCPkcs7Hex(hex(compressed), keyHex, iv)
  return dataFromHex(iv + encrypted)
}
function decryptRequestBody(body: Uint8Array, keyHex: string): any {
  const ivHex = hex(body.slice(0, 16))
  const plainHex = decryptCBCPkcs7Hex(hex(body.slice(16)), keyHex, ivHex)
  const decrypted = new Uint8Array(dataFromHex(plainHex).toArrayBuffer())
  const plain = isCompressed(decrypted) ? inflate(decrypted) : decrypted
  return JSON.parse(new TextDecoder().decode(plain))
}

// ---------- 代理身份内部请求（解锁用；同样走 解密→重加密→转发 链路） ----------

/**
 * 代理自建请求转发上游（新 requestId/sign/加密 body，线路循环容错）。
 * 主链路 handleProxy 与解锁身份 unlockRequest 共用的核心转发逻辑。
 * @param bodyData 加密前的明文对象 {token, deviceId, data}
 * @param opts.preferred 优先线路（排序在前），默认全部线路按声明顺序
 * @param opts.acceptErrorStatus 为 true 时 HTTP 200 + 可解密即采用（status=n 付费墙由调用方处理，不换线）；
 *                               false 时 status=n 视为业务失败并换下一条线路
 */
async function forwardToUpstream(path: string, bodyData: unknown, opts: { preferred?: string | null; acceptErrorStatus?: boolean } = {}): Promise<{ status: number; env: any; key: string; base: string }> {
  const orderedLines = opts.preferred
    ? [...LINES].sort((a, b) => Number(b.base === opts.preferred) - Number(a.base === opts.preferred))
    : LINES
  let lastErr: unknown = null
  for (const line of orderedLines) {
    const url = `${line.base}/api${path}`
    const sessionId = UUID.string().replace(/-/g, "").toLowerCase()
    const requestId = UUID.string().toLowerCase()
    const key = deriveKey(requestId)
    const iv = Crypto.generateSymmetricKey(128).toHexString()
    const jsonData = requiredData(Data.fromString(JSON.stringify(bodyData)))
    const plaintext = hex(gzip(new Uint8Array(jsonData.toArrayBuffer())))
    const body = dataFromHex(iv + encryptCBCPkcs7Hex(plaintext, key, iv))
    const time = Math.floor(Date.now() / 1000)
    const signSource = `Dart|${sessionId}|${requestId}|${time}|${url.replace(/^https?:\/\//, "")}`
    const headers = {
      version: "1.0.0", deviceType: "web", time: String(time),
      sign: `${Crypto.md5(requiredData(Data.fromString(signSource))).toHexString()}-${time}`,
      requestId, sessionId, deviceBrand: "", deviceModel: "", systemName: "", systemVersion: "",
      "Content-Type": "application/x-www-form-urlencoded",
    }
    try {
      const upstreamResp = await withTimeout(6000, fetch(url, { method: "POST", headers, body }))
      const respBytes = new Uint8Array(requiredData(await upstreamResp.data()).toArrayBuffer())
      if (respBytes.length < 32) throw new Error("响应无效")
      console.log(`[代理] 线路 ${line.base} ${path} → HTTP ${upstreamResp.status} ${respBytes.length}B`)
      const env = decryptResponse(respBytes, key)
      const result = { status: upstreamResp.status, env, key, base: line.base }
      if (!opts.acceptErrorStatus && env.status === "n") {
        const err: any = new Error(env.error || "API 错误")
        err.code = Number(env.errorCode) || 0
        throw err
      }
      if (upstreamResp.ok) {
        preferredLineBase = line.base
        savePreferredLine(line.base)
        console.log(`[代理] 记住成功线路 ${line.base}`)
        return result
      } // 200 + 可解密即采用（status=n 付费墙由解锁逻辑处理，不再换线）
      lastErr = new Error(`HTTP ${upstreamResp.status}`)
    } catch (e) {
      lastErr = e
      console.log(`[代理] 线路 ${line.base} ${path} → 异常 ${e instanceof Error ? e.message : e}`)
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("所有线路均不可用")
}

async function unlockRequest(path: string, data: unknown, token: string): Promise<any> {
  const result = await forwardToUpstream(path, { token, deviceId: unlock.deviceId || "", data }, { preferred: null, acceptErrorStatus: false })
  return result.env.data ?? null
}

async function ensureUnlockIdentity(): Promise<void> {
  if (unlock.userId && unlock.token) return
  if (!unlock.deviceId) { unlock.deviceId = UUID.string().toLowerCase(); saveUnlock() }
  const data = await unlockRequest("/login/device", { line_code: "china_1", channel_code: "", share_code: "", clipboard_text: "", device_info: { browserName: "BrowserName.safari", language: "zh-CN", userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1", platform: "iPhone" } }, "")
  const userId = String(data?.user_id || "")
  const token = String(data?.token || "")
  if (!userId || !token) throw new Error("解锁身份创建失败")
  unlock.userId = userId
  unlock.token = token
  saveUnlock()
}

async function ensureDailySign(): Promise<void> {
  const today = new Date().toISOString().slice(0, 10)
  if (unlock.signedDay === today) return
  try {
    await withTimeout(20000, (async () => {
      await unlockRequest("/user/doSign", {}, `${unlock.token}_${unlock.userId}`)
    })())
  } catch { }
  unlock.signedDay = today
  saveUnlock()
}

// ---------- 付费集直连：主清单 URL 无鉴权（实测含 AES-128 key + CloudFront 分片） ----------
// API 阶段只构造当前成功线路的地址；实际清单下载由播放页内 HLS 代理负责，避免前置验证触发30秒超时。
function buildDirectM3u8(dramaId: string, seq: string, base: string): string {
  return `${base}/api/drama/hls/${dramaId}/${seq}/play.m3u8?line=free`
}

// ---------- 代理主处理 ----------
async function handleProxy(req: { path: string; method: string; headers: Record<string, string>; body: Data }): Promise<HttpResponse> {
  // 健康检查：客户端启动时验证代理可用
  if (req.path === "/ping" || req.path === "/health") {
    return HttpResponse.raw(200, "OK", { headers: { "Content-Type": "text/plain" }, body: Data.fromRawString("pong", "utf-8") })
  }
  // HLS 资源（m3u8/key/分片）直接转发（Safari UA 拉取，避免 AVPlayer UA 被 CDN 挂起）
  if (isHlsResource(req.path)) {
    const encoded = req.path.slice(5) // "/hls/" 与 "/cdn/" 前缀均为 5 字符
    const waitForWarm = String(req.headers["x-huangdou-warm"] || req.headers["X-Huangdou-Warm"] || "") === "1"
    return handleHlsResource(encoded, waitForWarm)
  }
  // HttpServer 的 req.path 带 /api 前缀（如 /api/user/info），转发时不再重复拼接
  const path = req.path.startsWith("/api") ? req.path.slice(4) : req.path
  const clientRequestId = String(req.headers["requestid"] || req.headers["requestId"] || "")
  const bodyBytes = new Uint8Array(req.body.toArrayBuffer())

  // 1) 解密客户端请求（拿明文 {token, deviceId, data}）
  const clientKey = deriveKey(clientRequestId)
  let reqObj: any = null
  try {
    reqObj = decryptRequestBody(bodyBytes, clientKey)
  } catch (e) {
    console.log(`[代理] 请求体解密失败 ${path}: ${e instanceof Error ? e.message : e}`)
  }

  // 详情页已确认可用线路时，播放接口直接返回可确定的无鉴权清单地址。
  // 先登记预取，再响应客户端；AVPlayer 随后的同 URL 请求会复用 hlsInFlight。
  if (path === "/drama/play" && preferredLineBase) {
    const dramaId = String(reqObj?.data?.id || "")
    const seq = String(reqObj?.data?.seq || "")
    if (dramaId && seq) {
      const direct = buildDirectM3u8(dramaId, seq, preferredLineBase)
      const prefetchStarted = Date.now()
      void fetchManifestWithLineFallback(direct).then(result => {
        const manifest = new TextDecoder().decode(result.bytes)
        if (result.status !== 200 || !manifest.includes("#EXTM3U")) throw new Error(`m3u8 HTTP ${result.status}`)
        return warmManifestResources(manifest)
      }).then(() => {
        console.log(`[代理] 播放快速预取完成 ${Date.now() - prefetchStarted}ms ${dramaId} 第${seq}集`)
      }).catch(error => {
        console.log(`[代理] 播放快速预取失败 ${dramaId} 第${seq}集: ${error instanceof Error ? error.message : error}`)
      })
      const directProxy = toProxyUrl(direct)
      const fastEnv = {
        status: "y", errorCode: 0, error: "",
        data: {
          drama_id: `rp_${dramaId}`,
          duration: 0,
          hls_key: "",
          m3u8: directProxy,
          preview_m3u8: "",
          lines: [{ name: "快速直连", url: directProxy }],
          name: `第 ${seq} 集`,
        },
      }
      const fastBuf = new Uint8Array(encryptResponse(fastEnv, clientKey).toArrayBuffer())
      console.log(`[代理] 播放快速响应 ${dramaId} 第${seq}集 → ${direct}`)
      return HttpResponse.raw(200, "OK", { headers: { "Content-Type": "application/octet-stream" }, body: Data.fromArrayBuffer(fastBuf.buffer) })
    }
  }

  // 2) 代理自建请求转发上游（新 requestId/key/sign，线路循环容错）
  // 200 + 可解密即采用（status=n 付费墙由下面解锁逻辑处理，不再换线）
  const upstream = await forwardToUpstream(path, reqObj ?? { token: "", deviceId: "", data: {} }, { preferred: preferredLineBase, acceptErrorStatus: true })
  const env: any = upstream.env

  let outEnv = env
  if (path === "/user/info" && env?.status === "y" && env.data) {
    // 构造响应体状态：每次回应都返回 钻石会员 + 999999 金币
    env.data.balance = String(viewState.balance)
    env.data.is_vip = "y"
    env.data.play_num = "999/999"
    console.log(`[代理] /user/info → 钻石会员 + ${viewState.balance} 金币`)
  } else if (path === "/drama/doBuy" && env?.status === "n") {
    // 扣金币请求：上游失败（余额不足等）→ 改写为成功，视图金币扣费
    const dramaId = String(reqObj?.data?.id || "")
    const seq = String(reqObj?.data?.seq || "")
    const method = String(reqObj?.data?.method || "coin")
    const price = env.errorCode === 203001 || env.errorCode === 813005 ? COIN_PRICE : 0
    deductCoins(price)
    outEnv = {
      status: "y", errorCode: 0, error: "",
      data: { id: dramaId, seq, method, price, msg: "购买成功（代理）" },
    }
    console.log(`[代理] /drama/doBuy ${dramaId} 第${seq}集 ${method} → 改写成功 (扣 ${price} 金币, 余额 ${viewState.balance})`)
  } else if (path === "/user/doSign" && env?.status === "n") {
    // 签到请求：上游失败（已签到等）→ 改写为成功，返回 VIP/金币奖励视图
    outEnv = {
      status: "y", errorCode: 0, error: "",
      data: { continue_days: 1, prize_id: "day_1", prize_name: "vip1天", prize_type: "vip", prize_num: 1, balance: viewState.balance, msg: "签到成功（代理）" },
    }
    console.log(`[代理] /user/doSign → 改写成功`)
  } else if (path === "/drama/detail" && env?.status === "y" && env.data) {
    // 剧集详情：付费集全部标记为已购买（客户端字段 is_buy），直接可播
    let bought = 0
    const list = Array.isArray(env.data.episodes) ? env.data.episodes : Array.isArray(env.data.list) ? env.data.list : []
    for (const ep of list) {
      if (ep && typeof ep === "object" && (Number(ep.price || 0) > 0 || ep.type === "vip" || ep.type === "coin" || ep.is_vip)) {
        ep.is_buy = true
        bought++
      }
    }
    if (bought) console.log(`[代理] /drama/detail → 标记 ${bought} 个付费集为已购买`)
  } else if (path === "/drama/play" && env?.status === "n" && (env.errorCode === 813005 || env.errorCode === 813004)) {
    // VIP/金币主清单均已验证无鉴权：直接使用当前成功线路，避免解锁身份串行探测八条线路。
    const dramaId = String(reqObj?.data?.id || "")
    const seq = String(reqObj?.data?.seq || "")
    const base = String(upstream?.base || LINES[0].base)
    if (dramaId && seq) {
      const direct = buildDirectM3u8(dramaId, seq, base)
      const price = env.errorCode === 813005 ? COIN_PRICE : 0
      deductCoins(price)
      outEnv = {
        status: "y", errorCode: 0, error: "",
        data: {
          drama_id: `rp_${dramaId}`,
          duration: 0,
          hls_key: "",
          m3u8: direct,
          preview_m3u8: "",
          lines: [{ name: "直连", url: direct }],
          name: `第 ${seq} 集`,
        },
      }
      console.log(`[代理] 付费集直连 ${dramaId} 第${seq}集 → ${direct} (扣 ${price} 金币, 余额 ${viewState.balance})`)
    }
  }

  // 3) 用客户端 requestId 的 key 重加密返回
  // HLS 地址改写为代理地址：AVPlayer 全程访问本地代理（http://127.0.0.1:8787/hls/...），
  // 代理用 Safari UA 拉上游并改写清单内 key/分片为 /cdn/ 地址，绕开 CloudFront 对 AppleCoreMedia UA 的挂起。
  if (path === "/drama/play" && outEnv?.status === "y" && outEnv.data) {
    const m3u8 = String(outEnv.data.m3u8 || "")
    if (m3u8 && !m3u8.startsWith(PROXY_BASE)) outEnv.data.m3u8 = toProxyUrl(m3u8)
    const preview = String(outEnv.data.preview_m3u8 || "")
    if (preview && !preview.startsWith(PROXY_BASE)) outEnv.data.preview_m3u8 = toProxyUrl(preview)
    if (Array.isArray(outEnv.data.lines)) {
      outEnv.data.lines = outEnv.data.lines.map((l: any) => {
        const u = String(l?.url || "")
        return u && !u.startsWith(PROXY_BASE) ? { ...l, url: toProxyUrl(u) } : l
      })
    }
  }
  const outBuf = new Uint8Array(encryptResponse(outEnv, clientKey).toArrayBuffer())
  return HttpResponse.raw(200, "OK", { headers: { "Content-Type": "application/octet-stream" }, body: Data.fromArrayBuffer(outBuf.buffer) })
}

// ---------- 启动 ----------
let _server: HttpServer | null = null

export async function startProxyServer(port = PORT): Promise<HttpServer> {
  loadView()
  loadUnlock()
  loadPreferredLine()
  loadLineCache()
  if (_server) return _server
  const server = new HttpServer()
  server.setNotFoundHandler(async req => handleProxy({ path: req.path, method: req.method, headers: req.headers, body: req.body }))
  const error = server.start({ port, forceIPv4: true })
  if (error) {
    // 端口可能已被现有代理实例占用（如 proxy_main.ts 常驻后再开主程序）：
    // 先探测是否已有实例在服务，有则直接复用（客户端只连 127.0.0.1:8787，谁在服务无所谓），
    // 避免 index.tsx 双重启动时误报“代理启动失败”退出。复用路径不持有 _server，stop 不会误停他人实例。
    // 注意：探测必须校验响应体为 pong——Scripting 裸 HttpServer 对未知路径默认返回 200，
    // 仅凭 HTTP 状态会把非代理服务误判为可用。
    try {
      const probe = await withTimeout(2000, fetch(`http://127.0.0.1:${port}/ping`))
      const probeText = probe.ok ? new TextDecoder().decode(new Uint8Array(requiredData(await probe.data()).toArrayBuffer())) : ""
      if (probeText.trim() === "pong") {
        console.log(`黄豆短剧代理已由现有实例服务: http://127.0.0.1:${port}（${error}）`)
        return server
      }
    } catch { }
    throw new Error(`代理启动失败: ${error}`)
  }
  _server = server
  // 仅在真正持有 server 时启动缓存清理（复用路径本进程无 hlsCache 数据，无需清理）。
  scheduleHlsCacheCleanup()
  console.log(`黄豆短剧代理已启动: http://127.0.0.1:${server.port ?? port}/api/*`)
  console.log(`视图状态: 钻石会员 + ${viewState.balance} 金币（已用 ${viewState.used}）`)
  console.log(`解锁身份: ${unlock.userId ? unlock.userId.slice(0, 10) + "…" : "(首次解锁时自动创建并签到)"}`)
  console.log(`可用线路: ${preferredLineBase ? preferredLineBase + "（上次成功）" : "待探测"}，线路记忆 ${hlsLineCache.size} 条`)
  return server
}

export function stopProxyServer(): void {
  _server?.stop()
  _server = null
}
