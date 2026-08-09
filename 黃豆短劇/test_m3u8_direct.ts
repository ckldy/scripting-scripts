// 实验：金币集与 VIP 集的 m3u8 主清单 URL 是否无需购买态即可访问
// 若金币集主清单可直取，则「扣视图金币 + 构造真实 m3u8 链接」闭环可行
import { Script } from "scripting"

const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0.1 Mobile/15E148 Safari/604.1"

async function probe(label: string, url: string): Promise<void> {
  const started = Date.now()
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "*/*" } })
    const buf = new Uint8Array((await r.data()).toArrayBuffer())
    const text = new TextDecoder().decode(buf.slice(0, 400))
    console.log(`[${label}] HTTP ${r.status} ${buf.length}B ${Date.now() - started}ms`)
    console.log(`  ${text.split("\n").slice(0, 6).join(" | ")}`)
  } catch (e) {
    console.log(`[${label}] 异常: ${e instanceof Error ? e.message : String(e)}`)
  }
}

async function main() {
  // 金币集（真实播放请求里解出的 id/seq）
  await probe("金币集8", "https://psfxhhox.top/api/drama/hls/6a52d26d0e18e7c330a8d1f0/8/play.m3u8?line=free")
  // VIP 剧对照（此前 play 接口返回的真实 m3u8）
  await probe("VIP剧1", "https://psfxhhox.top/api/drama/hls/6a583d66b2283e06d44f5f5b/1/play.m3u8?line=free")
  // 免费剧对照
  await probe("免费剧1", "https://psfxhhox.top/api/drama/hls/6a638826b2283e06d44f6b8a/1/play.m3u8?line=free")
  Script.exit("OK")
}

main().catch(e => {
  console.log("FAIL:", e instanceof Error ? e.message : String(e))
  Script.exit("FAIL")
})
