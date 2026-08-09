import { fetch, Navigation, Script } from "scripting"
import { startProxyServer } from "./proxy"
import { HomePage } from "./page"

// 健康检查：确认本地代理已就绪（HttpServer 可能启动成功但端口被旧实例占用，或启动后未监听）
async function ensureProxyReady(): Promise<string | null> {
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const response = await fetch("http://127.0.0.1:8787/ping", { headers: { Accept: "text/plain" } })
      if (response.ok) return null
    } catch {
      // 未就绪，重试
    }
    await new Promise<void>(resolve => setTimeout(resolve, 500))
  }
  return "本地解锁代理未就绪，请重新运行脚本后再试。"
}

async function main() {
  Script.enableMinimize()
  const removeResumeListener = Script.onResume(() => {})
  // 本地代理（金币直连+会员视图）：先启动，再健康检查。
  // 代理不可用则提示并退出，避免客户端回退真实线路拿到未解锁的原始数据（显示锁/无法播放）。
  let proxyError: string | null = null
  try {
    await startProxyServer()
    proxyError = await ensureProxyReady()
  } catch (error) {
    proxyError = `本地解锁代理启动失败: ${error instanceof Error ? error.message : String(error)}`
  }
  if (proxyError) {
    console.error(proxyError)
    removeResumeListener()
    await console.present()
    Script.exit()
    return
  }
  console.log("本地解锁代理已就绪，全部请求将经过代理处理。")
  try {
    await Navigation.present({ element: <HomePage />, modalPresentationStyle: "overFullScreen" })
    removeResumeListener()
    Script.exit()
  } catch (error) {
    removeResumeListener()
    console.error(error)
    console.present().then(Script.exit)
  }
}

main()
