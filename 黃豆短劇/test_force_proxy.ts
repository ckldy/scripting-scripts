// 验证：/ping 健康检查 + 客户端强制代理（代理不可用时必须报错，绝不回退真实线路）
import { Script } from "scripting"
import { fetch } from "scripting"
import { huangdouClient } from "./client"
import { startProxyServer, stopProxyServer } from "./proxy"

async function main() {
  console.log("=== [0] 代理未启动时，客户端请求必须报错（不回退真实线路）===")
  try {
    const info = await huangdouClient.probe("/user/info")
    console.log(`  ✗ 未报错，拿到了 balance=${info?.balance ?? "?"}（说明回退了真实线路！）`)
    Script.exit("FAIL")
  } catch (e) {
    console.log(`  ✓ 正确报错: ${e instanceof Error ? e.message : String(e)}`)
  }

  console.log("\n=== [1] 启动代理 + /ping 健康检查 ===")
  await startProxyServer(8787)
  const ping = await fetch("http://127.0.0.1:8787/ping", { headers: { Accept: "text/plain" } })
  const pingText = await ping.text()
  console.log(`  /ping → HTTP ${ping.status} "${pingText}"`)
  if (ping.status !== 200 || pingText !== "pong") throw new Error("/ping 异常")

  console.log("\n=== [2] 代理就绪后，客户端请求走代理（balance=999xxx）===")
  let balance = "?"
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const info = await huangdouClient.probe("/user/info")
      balance = String(info?.balance ?? info?.gold ?? "?")
      console.log(`  尝试${attempt}: balance=${balance}`)
      if (balance.startsWith("999")) break
    } catch (e) {
      console.log(`  尝试${attempt} 失败: ${e instanceof Error ? e.message : String(e)}`)
    }
    await new Promise(r => setTimeout(r, 3000))
  }

  stopProxyServer()
  if (!balance.startsWith("999")) {
    console.log(`\n✗ 客户端未走代理（balance=${balance}）`)
    Script.exit("FAIL")
  }
  console.log("\n✓ 强制代理生效：代理不可用报错、可用时全部走代理")
  Script.exit("OK")
}

main().catch(e => {
  stopProxyServer()
  console.log("FAIL:", e instanceof Error ? e.message : String(e))
  Script.exit("FAIL")
})
