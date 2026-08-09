// 对比：新鲜分片 URL 直连 fetch vs 经代理拉取——定位分片慢/超时是 CDN 网络还是代理问题
import { Script } from "scripting"
import { startProxyServer, stopProxyServer } from "./proxy"

const HLS_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1"

async function fetchWithTimeout(ms: number, url: string, headers: Record<string, string>): Promise<{ status: number; bytes: number; ms: number; err?: string }> {
  const started = Date.now()
  return new Promise(resolve => {
    const timer = setTimeout(() => { resolve({ status: 0, bytes: 0, ms: Date.now() - started, err: "timeout" }) }, ms)
    fetch(url, { headers }).then(async r => {
      const buf = new Uint8Array((await r.data()).toArrayBuffer())
      clearTimeout(timer)
      resolve({ status: r.status, bytes: buf.length, ms: Date.now() - started })
    }).catch(e => {
      clearTimeout(timer)
      resolve({ status: -1, bytes: 0, ms: Date.now() - started, err: e instanceof Error ? e.message : String(e) })
    })
  })
}

async function main() {
  console.log("=== 启动代理 ===")
  await startProxyServer(8787)

  // 1) 拉主清单（经代理，拿到新鲜分片 URL）
  console.log("\n[1] 经代理拉主清单（sxqirtho.top 稳定线路）")
  const m3u8Url = "https://sxqirtho.top/api/drama/hls/6a52d26d0e18e7c330a8d1f0/8/play.m3u8?line=free"
  const proxyM3u8 = await fetchWithTimeout(30000, `http://127.0.0.1:8787/hls/${encodeURIComponent(m3u8Url)}`, { Accept: "*/*" })
  console.log(`代理m3u8: HTTP ${proxyM3u8.status} ${proxyM3u8.bytes}B ${proxyM3u8.ms}ms ${proxyM3u8.err || ""}`)
  if (proxyM3u8.status !== 200) throw new Error("代理 m3u8 拉取失败")

  // 2) 从代理改写后的清单提取分片 URL（已是 /cdn/ 代理地址 + 新鲜 auth_key）
  console.log("\n[2] 提取分片 URL")
  const text = new TextDecoder().decode(new Uint8Array(0)) // placeholder
  // 需要重新读 body——用 fetch 直接读文本
  const m3u8Resp = await fetch(`http://127.0.0.1:8787/hls/${encodeURIComponent(m3u8Url)}`, { headers: { Accept: "*/*" } })
  const m3u8Bytes = new Uint8Array((await m3u8Resp.data()).toArrayBuffer())
  const m3u8Text = new TextDecoder().decode(m3u8Bytes)
  const segMatch = m3u8Text.match(/https?:\/\/[^\s"]+\.ts[^\s"]*/)
  if (!segMatch) throw new Error("无分片行")
  const segProxyUrl = segMatch[0] // http://127.0.0.1:8787/cdn/...（新鲜 auth_key）
  // 解码出原始 CloudFront URL
  const segOriginal = decodeURIComponent(segProxyUrl.replace("http://127.0.0.1:8787/cdn/", ""))
  console.log(`代理分片URL: ${segProxyUrl.slice(0, 80)}...`)
  console.log(`原始分片URL: ${segOriginal.slice(0, 80)}...`)

  // 3) 直接 fetch 原始 CloudFront 分片（新鲜 auth_key）
  console.log("\n[3] 直接 fetch CloudFront 分片（Safari UA）")
  const direct = await fetchWithTimeout(30000, segOriginal, { "User-Agent": HLS_UA, Accept: "*/*" })
  console.log(`直连: HTTP ${direct.status} ${direct.bytes}B ${direct.ms}ms ${direct.err || ""}`)

  // 4) 经代理拉取同一分片
  console.log("\n[4] 经代理 /cdn/ 拉取分片")
  const proxied = await fetchWithTimeout(45000, segProxyUrl, { Accept: "*/*" })
  console.log(`代理: HTTP ${proxied.status} ${proxied.bytes}B ${proxied.ms}ms ${proxied.err || ""}`)

  stopProxyServer()
  const ok = direct.status === 200 && proxied.status === 200 && proxied.bytes > 1024
  console.log(`\n结果: ${ok ? "✓ 分片可经代理拉取（原生播放器可用）" : "✗ 分片链路不通"}`)
  Script.exit(ok ? "OK" : "FAIL")
}

main().catch(e => {
  stopProxyServer()
  console.log("FAIL:", e instanceof Error ? e.message : String(e))
  Script.exit("FAIL")
})
