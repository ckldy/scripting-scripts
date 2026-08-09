// 验证：代理遇到 master playlist（多码率）时自动选择最高画质变体
// 用本地 mock HttpServer 模拟上游：master.m3u8 含 720p + 1080p 两个变体，
// 通过代理拉取 master 应返回 1080p media playlist（改写为 /cdn/ 地址）。
import { fetch, Script } from "scripting"
import { startProxyServer, stopProxyServer } from "./proxy"

const MOCK_PORT = 8899
const MOCK_BASE = `http://127.0.0.1:${MOCK_PORT}`

function mockBody(text: string): HttpResponse {
  return HttpResponse.raw(200, "OK", { headers: { "Content-Type": "application/vnd.apple.mpegurl" }, body: Data.fromRawString(text, "utf-8") })
}

function segUrl(name: string): string {
  // 用 mock 服务器的假分片，避免后台预热真去拉 CloudFront
  return `${MOCK_BASE}/fake/${name}`
}

function masterPlaylist(): string {
  return [
    "#EXTM3U",
    "#EXT-X-VERSION:3",
    "#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=1280x720,CODECS=\"avc1.4d401f,mp4a.40.2\"",
    `${MOCK_BASE}/media_720.m3u8`,
    "#EXT-X-STREAM-INF:BANDWIDTH=2600000,RESOLUTION=1920x1080,CODECS=\"avc1.640028,mp4a.40.2\"",
    `${MOCK_BASE}/media_1080.m3u8`,
    "#EXT-X-STREAM-INF:BANDWIDTH=400000,RESOLUTION=854x480,CODECS=\"avc1.4d401e,mp4a.40.2\"",
    `${MOCK_BASE}/media_480.m3u8`,
  ].join("\n")
}

function mediaPlaylist(quality: string, key: string): string {
  return [
    "#EXTM3U",
    "#EXT-X-VERSION:3",
    "#EXT-X-TARGETDURATION:10",
    "#EXT-X-MEDIA-SEQUENCE:0",
    "#EXT-X-PLAYLIST-TYPE:VOD",
    `#EXT-X-KEY:METHOD=AES-128,URI="${MOCK_BASE}/fake/${key}",IV=0x00000000000000000000000000000000`,
    "#EXTINF:10.000000,",
    segUrl(`${quality}_seg_000.ts`),
    "#EXTINF:10.000000,",
    segUrl(`${quality}_seg_001.ts`),
    "#EXT-X-ENDLIST",
  ].join("\n")
}

async function main() {
  console.log("=== 启动 mock 上游（模拟 master playlist 多码率）===")
  const mockServer = new HttpServer()
  mockServer.setNotFoundHandler(async req => {
    if (req.path === "/master.m3u8") return mockBody(masterPlaylist())
    if (req.path === "/media_720.m3u8") return mockBody(mediaPlaylist("720", "key_720"))
    if (req.path === "/media_1080.m3u8") return mockBody(mediaPlaylist("1080", "key_1080"))
    if (req.path === "/media_480.m3u8") return mockBody(mediaPlaylist("480", "key_480"))
    if (req.path.startsWith("/fake/")) return HttpResponse.raw(200, "OK", { headers: { "Content-Type": "application/octet-stream" }, body: Data.fromRawString("FAKE", "utf-8") })
    return HttpResponse.raw(404, "Not Found", { body: Data.fromRawString("not found", "utf-8") })
  })
  const mockError = mockServer.start({ port: MOCK_PORT, forceIPv4: true })
  if (mockError) throw new Error(`mock 启动失败: ${mockError}`)
  console.log(`mock 上游已启动 ${MOCK_BASE}`)

  console.log("\n=== 启动代理 ===")
  await startProxyServer(8787)

  // 1) 直接拉 mock master 确认结构
  const raw = await fetch(`${MOCK_BASE}/master.m3u8`)
  const rawText = await raw.text()
  console.log(`[mock master] HTTP ${raw.status} ${rawText.length}B`)
  console.log(`  变体行数: ${rawText.split("\n").filter((l: string) => l.includes("#EXT-X-STREAM-INF")).length}`)

  // 2) 经代理拉 master → 应自动选择 1080p 变体并返回其 media playlist（改写为 /cdn/）
  const masterProxy = `http://127.0.0.1:8787/hls/${encodeURIComponent(`${MOCK_BASE}/master.m3u8`)}`
  console.log(`\n[代理 master] GET ${masterProxy.slice(0, 100)}…`)
  const res = await fetch(masterProxy)
  const text = await res.text()
  console.log(`HTTP ${res.status} ${text.length}B`)
  const lines = text.split("\n").filter(Boolean)
  console.log(`  包含 #EXT-X-STREAM-INF: ${text.includes("#EXT-X-STREAM-INF")}`)
  console.log(`  包含 1080 分片: ${text.includes("1080_seg")}`)
  console.log(`  包含 720 分片: ${text.includes("720_seg")}`)
  console.log(`  分片已改写 /cdn/: ${text.includes("/cdn/")}`)
  console.log(`  内容前 5 行: ${lines.slice(0, 5).join(" | ")}`)

  const ok1080 = text.includes("1080_seg") && !text.includes("720_seg") && !text.includes("#EXT-X-STREAM-INF") && text.includes("/cdn/")
  console.log(`\n结果: ${ok1080 ? "✓ 代理自动选择最高画质(1080p)变体" : "✗ 未选择最高画质变体"}`)

  stopProxyServer()
  mockServer.stop()
  Script.exit(ok1080 ? "OK" : "FAIL")
}

main().catch(e => {
  try { stopProxyServer() } catch { }
  console.log("FAIL:", e instanceof Error ? e.message : String(e))
  Script.exit("FAIL")
})
