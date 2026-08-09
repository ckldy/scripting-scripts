// 「黄豆短剧」全链路验证：首页导航 → 分类块 → 列表 → 详情 → 播放 → 自动解锁
// 覆盖 App 实际使用的全部接口路径
import { fetch, Script } from "scripting"
import { huangdouClient, ApiError } from "./client"

function assert(ok: boolean, name: string): void {
  console.log(`  ${ok ? "✓" : "✗"} ${name}`)
  if (!ok) throw new Error(name)
}

async function main() {
  console.log("[首页] getHomeNavigation（navList + navFilter）")
  const nav = await huangdouClient.getHomeNavigation()
  assert(nav.categories.length > 0, `分类 ${nav.categories.length} 个（${nav.categories.slice(0, 3).map((c) => c.name).join("/")}…）`)
  assert(nav.tabs.length > 0, `Tab ${nav.tabs.length} 个，选中: ${nav.selectedTab.name}`)

  console.log("[首页] getHomeBlocks（navBlock 推荐流）")
  const blocks = await huangdouClient.getHomeBlocks(nav.selectedCategory, nav.selectedTab, 1)
  assert(blocks.length > 0 && blocks[0].items.length > 0, `推荐块 ${blocks.length} 个，首块 ${blocks[0]?.items.length ?? 0} 部剧`)
  const first = blocks[0].items[0]
  console.log(`  首部: ${first.name}`)

  console.log("[列表] list（搜索页/分类页）")
  const page = await huangdouClient.list(1)
  assert(page.items.length > 0, `列表 ${page.items.length} 条`)

  console.log("[搜索] list keywords")
  const found = await huangdouClient.list(1, first.name.slice(0, 2))
  assert(found.items.length > 0, `搜索「${first.name.slice(0, 2)}」返回 ${found.items.length} 条`)

  console.log("[详情] detail")
  const detail = await huangdouClient.detail(first.id)
  assert(detail.episodes.length > 0, `${detail.name} 共 ${detail.episodes.length} 集，买断状态: ${detail.isBuyWhole}`)

  console.log("[播放] 第 1 集（模拟 App 自动解锁流程：失败→换身份→重播）")
  let play
  try {
    play = await huangdouClient.play(first.id, detail.episodes[0].seq)
    console.log("  直接可播（当前身份已是会员）")
  } catch (e) {
    const code = e instanceof ApiError ? e.code : 0
    assert(code === 813005 || code === 813004 || code === 203001, `付费墙拦截识别: ${code}`)
    console.log(`  自动解锁：${e instanceof Error ? e.message : e}`)
    await huangdouClient.resetIdentity()
    play = await huangdouClient.play(first.id, detail.episodes[0].seq)
  }
  assert(/^https?:\/\/\S+\.m3u8/.test(play.url), `自动解锁后 m3u8: ${play.url.slice(0, 70)}`)

  console.log("[播放] m3u8 拉取")
  const res = await fetch(play.url, { headers: huangdouClient.playbackHeaders(play.url) })
  assert(res.status === 200, `HTTP ${res.status}`)

  console.log("[自动解锁] 再次换新身份后重播")
  await huangdouClient.resetIdentity()
  const play2 = await huangdouClient.play(first.id, detail.episodes[0].seq)
  assert(/^https?:\/\/\S+\.m3u8/.test(play2.url), `新身份 m3u8: ${play2.url.slice(0, 70)}`)

  console.log("[buy] doBuy 接口可用性")
  try {
    await huangdouClient.buy(first.id, detail.episodes[0].seq, "coin")
    console.log("  doBuy 调用成功")
  } catch (e) {
    assert(e instanceof ApiError, `doBuy 返回可识别错误: ${e instanceof ApiError ? e.code : e}`)
  }

  Script.exit("OK")
}

main().catch((e) => {
  console.log("FAIL:", e)
  Script.exit("FAIL: " + e)
})
