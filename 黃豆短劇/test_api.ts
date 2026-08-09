// 接口对接验证：client.ts（= client.js 同协议）→ 登录 → 列表 → 详情 → play → m3u8
// 只读验证，不修改任何功能文件
import { fetch, Script } from "scripting"
import { huangdouClient } from "./client"

function assert(ok: boolean, name: string): void {
  console.log(`  ${ok ? "✓" : "✗"} ${name}`)
  if (!ok) throw new Error(name)
}

async function main() {
  console.log("[list] 列表（触发匿名登录 /login/device）")
  const page = await huangdouClient.list(1)
  assert(page.items.length > 0, `列表 ${page.items.length} 条`)
  const free = page.items.find((i) => i.payType === "free") ?? page.items[0]
  console.log(`  选中: ${free.name} (${free.id}) pay_type=${free.payType}`)

  console.log("[detail] 详情")
  const detail = await huangdouClient.detail(free.id)
  assert(detail.episodes.length > 0, `共 ${detail.episodes.length} 集`)
  const ep = detail.episodes[0]

  console.log("[play] 播放接口 → m3u8")
  const play = await huangdouClient.play(free.id, ep.seq)
  assert(/^https?:\/\/\S+\.m3u8/.test(play.url), `m3u8: ${play.url.slice(0, 80)}`)
  console.log(`  headers: ${JSON.stringify(huangdouClient.playbackHeaders(play.url))}`)

  console.log("[m3u8] 实际拉取")
  const res = await fetch(play.url, { headers: huangdouClient.playbackHeaders(play.url) })
  assert(res.status === 200, `m3u8 HTTP ${res.status}`)
  const text = await res.text()
  assert(text.startsWith("#EXTM3U"), "m3u8 内容为 HLS 播放列表")

  Script.exit("OK")
}

main().catch((e) => {
  console.log("FAIL:", e)
  Script.exit("FAIL: " + e)
})
