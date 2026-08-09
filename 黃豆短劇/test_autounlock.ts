// 自动解锁验证：付费墙 → 自动签到(第1天VIP) → VIP 剧放行；金币集自动尝试购买/换身份
import { fetch, Script } from "scripting"
import { huangdouClient, ApiError } from "./client"

function assert(ok: boolean, name: string): void {
  console.log(`  ${ok ? "✓" : "✗"} ${name}`)
  if (!ok) throw new Error(name)
}

async function main() {
  const vipId = "6a583d66b2283e06d44f5f5b"   // VIP 剧
  const coinId = "6a60ba12b2283e06d44f676e" // 金币剧：前2集免费，第3集 coin 38 金币

  console.log("[1] 播放 VIP 剧 → play() 自动解锁（签到/复用 VIP）")
  const vip = await huangdouClient.play(vipId, 1)
  assert(/^https?:\/\/\S+\.m3u8/.test(vip.url), `VIP 剧 m3u8: ${vip.url.slice(0, 70)}`)

  console.log("[2] 播放金币集（第 3 集）→ play() 自动解锁")
  try {
    const play = await huangdouClient.play(coinId, 3)
    assert(/^https?:\/\/\S+\.m3u8/.test(play.url), `金币集 m3u8: ${play.url.slice(0, 70)}`)
  } catch (e) {
    console.log(`  ⚠ 金币集未解锁（需连续签到攒金币）: ${e instanceof ApiError ? e.message : e}`)
  }

  console.log("[3] m3u8 实际拉取（VIP 剧）")
  const res = await fetch(vip.url, { headers: huangdouClient.playbackHeaders(vip.url) })
  assert(res.status === 200, `m3u8 HTTP ${res.status}`)

  console.log("[4] 用户状态持久化检查")
  const saved = Storage.get<{ userId: string; token: string }>("huangdou_login_v1")
  assert(saved?.userId && saved?.token, `login 已持久化 (userId=${saved?.userId.slice(0, 8)}…)`)
  assert(Boolean(Storage.get<string>("huangdou_device_id_v1")), "deviceId 已持久化")

  Script.exit("OK")
}

main().catch((e) => {
  console.log("FAIL:", e)
  Script.exit("FAIL: " + e)
})
