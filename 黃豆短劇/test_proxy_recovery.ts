// 验证：客户端 activeLine 漂移修复——代理后启动也能恢复走代理
// 场景：代理未启动 → 客户端请求漂移到真实线路 → 启动代理 → 后续请求必须回到 local（代理）返回 999999
import { Script } from "scripting"
import { huangdouClient } from "./client"
import { startProxyServer, stopProxyServer } from "./proxy"

async function main() {
  console.log("=== 场景1：代理未启动，客户端请求（应失败或走真实线路）===")
  let firstBalance = "?"
  try {
    const info = await huangdouClient.probe("/user/info")
    firstBalance = String(info?.balance ?? info?.gold ?? "?")
  } catch (e) {
    console.log(`  请求失败（预期）: ${e instanceof Error ? e.message : String(e)}`)
  }
  console.log(`  首次 balance=${firstBalance}`)

  console.log("\n=== 场景2：启动代理后，客户端再次请求（必须走代理返回 999999）===")
  await startProxyServer(8787)
  let balance = "?"
  // CLI 上游网络偶发不可达：重试几次（代理转发需要上游可达）
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const info = await huangdouClient.probe("/user/info")
      balance = String(info?.balance ?? info?.gold ?? "?")
      console.log(`  尝试${attempt}: balance=${balance}`)
      if (balance === "999999") break
    } catch (e) {
      console.log(`  尝试${attempt} 失败: ${e instanceof Error ? e.message : String(e)}`)
    }
    await new Promise(r => setTimeout(r, 3000))
  }
  console.log(`  代理启动后最终 balance=${balance}`)

  stopProxyServer()
  if (balance !== "999999") {
    console.log(`\n✗ 修复未生效：客户端没有走代理（balance=${balance}）`)
    Script.exit("FAIL")
  }
  console.log("\n✓ 客户端恢复走代理（activeLine 漂移修复生效）")
  Script.exit("OK")
}

main().catch(e => {
  stopProxyServer()
  console.log("FAIL:", e instanceof Error ? e.message : String(e))
  Script.exit("FAIL")
})
