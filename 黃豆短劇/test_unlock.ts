// 解锁流程验证：金币集 play → 813005 ApiError → buy → 203001（匿名设备无金币）
import { fetch, Script } from "scripting"
import { huangdouClient, ApiError } from "./client"

function assert(ok: boolean, name: string): void {
  console.log(`  ${ok ? "✓" : "✗"} ${name}`)
  if (!ok) throw new Error(name)
}

async function main() {
  // 金币剧（前 2 集免费，第 3 集 coin 38 金币）
  const id = "6a60ba12b2283e06d44f676e"

  console.log("[play] 金币集（第 3 集，is_buy=false）")
  try {
    await huangdouClient.play(id, 3)
    assert(false, "金币集不应直接放行")
  } catch (e) {
    assert(e instanceof ApiError && e.code === 813005, `813005 识别: ${e instanceof ApiError ? e.code : e}`)
    console.log(`  文案: ${e instanceof Error ? e.message : e}`)
  }

  console.log("[buy] doBuy 解锁第 3 集")
  try {
    const ok = await huangdouClient.buy(id, 3, "coin")
    assert(ok, `doBuy 成功: ${ok}`)
  } catch (e) {
    assert(e instanceof ApiError && e.code === 203001, `203001 识别: ${e instanceof ApiError ? e.code : e}`)
    console.log(`  文案: ${e instanceof Error ? e.message : e}`)
  }

  console.log("[play] 免费集（第 1 集）仍可播放")
  const play = await huangdouClient.play(id, 1)
  assert(/^https?:\/\/\S+\.m3u8/.test(play.url), `m3u8: ${play.url.slice(0, 70)}`)

  Script.exit("OK")
}

main().catch((e) => {
  console.log("FAIL:", e)
  Script.exit("FAIL: " + e)
})
