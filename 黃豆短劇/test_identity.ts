// 诊断：resetIdentity 前后设备身份与会员状态（礼包发放稳定性）
import { Script } from "scripting"
import { huangdouClient, ApiError } from "./client"

async function checkIdentity(label: string): Promise<void> {
  // 通过 userInfo 不可得（client 无此方法），直接尝试播 VIP 剧判定会员状态
  try {
    await huangdouClient.play("6a583d66b2283e06d44f5f5b", 1)
    console.log(`  ${label}: VIP 剧可播（会员）`)
  } catch (e) {
    console.log(`  ${label}: VIP 剧 ${e instanceof ApiError ? e.code : e}（${e instanceof Error ? e.message : e}）`)
  }
  try {
    await huangdouClient.play("6a60ba12b2283e06d44f676e", 3)
    console.log(`  ${label}: 金币集可播`)
  } catch (e) {
    console.log(`  ${label}: 金币集 ${e instanceof ApiError ? e.code : e}（${e instanceof Error ? e.message : e}）`)
  }
}

async function main() {
  console.log("[0] 当前 Storage 身份")
  await checkIdentity("当前")

  for (let i = 1; i <= 3; i++) {
    console.log(`[${i}] resetIdentity 第 ${i} 次`)
    await huangdouClient.resetIdentity()
    await checkIdentity(`第 ${i} 次新身份`)
  }

  Script.exit("OK")
}

main().catch((e) => {
  console.log("FAIL:", e)
  Script.exit("FAIL: " + e)
})
