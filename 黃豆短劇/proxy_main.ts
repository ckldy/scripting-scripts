// 黄豆短剧代理入口：运行本文件 = 常驻本地代理（app 内使用方式）
// 用法：scripting-ts run proxy_main.ts 或 Scripting app 内直接运行
import { Script } from "scripting"
import { startProxyServer } from "./proxy"

Script.enableMinimize()
startProxyServer().catch(e => {
  console.error(e)
  Script.exit("代理启动失败: " + e)
})
