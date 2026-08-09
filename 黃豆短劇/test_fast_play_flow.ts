import { fetch, Script } from "scripting"
import { startProxyServer } from "./proxy"
import { huangdouClient } from "./client"

// 无头端到端验证：模拟“点击播放”的完整链路
// 1) 启动本地代理
// 2) 首页请求建立 preferredLineBase（快速路径前提）
// 3) huangdouClient.play() 获取播放源（快速路径，不应有上游 play 请求）
// 4) 用代理化 URL 拉取 m3u8，验证改写后的清单
async function main() {
  await startProxyServer()
  const nav = await huangdouClient.getHomeNavigation()
  console.log(`[测试] 导航就绪 category=${nav.selectedCategory}`)

  const page = await huangdouClient.list(1)
  const drama = page.items[0]
  if (!drama) throw new Error("首页无数据")
  console.log(`[测试] 选中剧集 ${drama.name} (${drama.id})`)

  const detail = await huangdouClient.detail(drama.id)
  const ep = detail.episodes[0]
  if (!ep) throw new Error("无剧集")
  console.log(`[测试] 第 ${ep.seq} 集 purchased=${ep.purchased} type=${ep.type}`)

  const t0 = Date.now()
  const source = await huangdouClient.play(drama.id, ep.seq)
  console.log(`[测试] play() 耗时 ${Date.now() - t0}ms url=${source.url.slice(0, 110)}`)

  const t1 = Date.now()
  const resp = await fetch(source.url, { headers: source.headers })
  const bytes = new Uint8Array((await resp.data()).toArrayBuffer())
  const head = new TextDecoder().decode(bytes.slice(0, 160))
  console.log(`[测试] m3u8 耗时 ${Date.now() - t1}ms status=${resp.status} bytes=${bytes.length}`)
  console.log(`[测试] m3u8 头部: ${head.split("\n").slice(0, 4).join(" | ")}`)

  Script.exit({ ok: resp.ok && bytes.length > 0, playMs: Date.now() - t0, m3u8Ms: Date.now() - t1, status: resp.status, bytes: bytes.length })
}

main().catch(error => {
  console.error(`[测试] 失败: ${error instanceof Error ? error.message : String(error)}`)
  Script.exit({ ok: false, error: error instanceof Error ? error.message : String(error) })
})
