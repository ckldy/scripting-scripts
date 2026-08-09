// 验证：首页 3×6 网格数据源——有 cat_id 的分类走 /drama/list 分页（每页 18 部）；黄豆原创无 cat_id，补充二级 tab（大神精选/单体作品/影视魔改）用 keywords 搜索。
import { fetch, Script } from "scripting"
import { huangdouClient } from "./client"
import { startProxyServer, stopProxyServer } from "./proxy"

let startedProxy = false

async function proxyIsReady(): Promise<boolean> {
  try { return (await fetch("http://127.0.0.1:8787/ping")).ok } catch { return false }
}

async function main() {
  const reusedProxy = await proxyIsReady()
  console.log(reusedProxy ? "=== 复用现有代理 ===" : "=== 启动代理 ===")
  if (!reusedProxy) { await startProxyServer(8787); startedProxy = true }

  console.log("\n[1] 获取导航（zhenren 真人短剧）")
  const nav = await huangdouClient.getHomeNavigation("zhenren")
  console.log(`  分类: ${nav.categories.map((c: any) => c.name).join(" / ")}`)
  console.log(`  选中: ${nav.selectedCategory}, 首个tab: ${nav.selectedTab.name} filter=${JSON.stringify(nav.selectedTab.filter)}`)
  if (nav.selectedCategory !== "zhenren") throw new Error("未选中 zhenren 分类")

  console.log("\n[2] 第 1 页：单一列表模块，最多 18 部")
  const blocks1 = await huangdouClient.getHomeBlocks("zhenren", nav.selectedTab, 1)
  const items1 = blocks1[0]?.items || []
  console.log(`  模块数: ${blocks1.length}, 内容: ${items1.length} 部`)
  if (blocks1.length !== 1) throw new Error("首页不应混入运营聚合模块")
  if (!items1.length) throw new Error("第 1 页无内容")
  if (items1.length > 18) throw new Error("第 1 页超过 18 部")

  console.log("\n[3] 第 2 页：保留筛选并切换到不同作品")
  const blocks2 = await huangdouClient.getHomeBlocks("zhenren", nav.selectedTab, 2)
  const items2 = blocks2[0]?.items || []
  console.log(`  模块数: ${blocks2.length}, 内容: ${items2.length} 部`)
  if (!items2.length) throw new Error("第 2 页无内容（分页未生效）")
  if (items2.length > 18) throw new Error("第 2 页超过 18 部")
  if (items1[0]?.id === items2[0]?.id) throw new Error("相邻页面首部作品重复")

  console.log("\n[4] 黄豆原创（yuandou）：推荐 + 大神精选/单体作品/影视魔改 二级 tab")
  const navYu = await huangdouClient.getHomeNavigation("yuandou")
  console.log(`  tabs: ${navYu.tabs.map(t => t.name).join(" / ")}`)
  if (navYu.tabs.length !== 4) throw new Error("黄豆原创应有 4 个 tab（推荐+3个分类）")
  const recBlocks = await huangdouClient.getHomeBlocks("yuandou", navYu.tabs[0], 1, "黄豆原创")
  const recItems = recBlocks[0]?.items || []
  console.log(`  推荐: ${recItems.length} 部`)
  if (!recItems.length) throw new Error("黄豆原创推荐 tab 无内容")
  if (recItems.length <= 8) throw new Error("黄豆原创推荐 tab 应显示全部 14 部")
  if (!recItems.every((i: any) => i.category === "黄豆原创")) throw new Error("推荐 tab 混入非原创内容")
  for (const tab of navYu.tabs.slice(1)) {
    const p1 = await huangdouClient.getHomeBlocks("yuandou", tab, 1, "黄豆原创")
    const p2 = await huangdouClient.getHomeBlocks("yuandou", tab, 2, "黄豆原创")
    const items1 = p1[0]?.items || []
    const items2 = p2[0]?.items || []
    console.log(`  ${tab.name}: 第1页 ${items1.length} 部, 第2页 ${items2.length} 部`)
    if (!items1.length) throw new Error(`${tab.name} 第 1 页无内容`)
    if (!items1.every((i: any) => i.category === tab.name)) throw new Error(`${tab.name} 混入其他分类`)
    if (!items2.length) throw new Error(`${tab.name} 应可分页`)
    if (items1[0]?.id === items2[0]?.id) throw new Error(`${tab.name} 分页内容重复`)
  }

  if (startedProxy) stopProxyServer()
  console.log("\n✓ 首页数据验证通过：列表分类每页 18 部可翻页，黄豆原创含 4 个二级 tab 且分类正确可翻页")
  Script.exit("OK")
}

main().catch(e => {
  if (startedProxy) stopProxyServer()
  console.log("FAIL:", e instanceof Error ? e.message : String(e))
  Script.exit("FAIL")
})
