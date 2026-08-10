// 台风路径 — 原版前端格式 WebView + Leaflet 重构

import { Script, Widget } from "scripting"
import { loadWidgetData } from "./widget_data"
import { renderAllTyphoonWidgetMaps } from "./widget_map"

const projectDirectory = FileManager.scriptsDirectory + "/台风路径"
const webDirectory = projectDirectory + "/web"
const entryFile = webDirectory + "/index.html"
const requestedTyphoonId = String(Script.queryParameters["tfbh"] || "").replace(/[^A-Za-z0-9_-]/g, "")

async function refreshWidgetMapCache() {
  try {
    const { cache } = await loadWidgetData()
    if (cache.typhoons.length && await renderAllTyphoonWidgetMaps(cache.typhoons)) Widget.reloadAll()
  } catch (error) {
    console.error("Widget地图缓存更新失败", String(error))
  }
}

async function main() {
  await refreshWidgetMapCache()
  const webView = new WebViewController({ ephemeral: true })
  const allowedHosts = new Set([
    "tf02.istrongcloud.com",
    "tf03.istrongcloud.com",
    "datacenter.istrongcloud.com",
    "upy.istrongcloud.com",
    "wprd01.is.autonavi.com",
    "wprd02.is.autonavi.com",
    "wprd03.is.autonavi.com",
    "wprd04.is.autonavi.com",
  ])

  webView.shouldAllowRequest = async request => {
    if (request.url.startsWith("file:")) return request.method === "GET"
    try {
      const url = new URL(request.url)
      const isNavigation = ["linkActivated", "formSubmitted", "formResubmitted"].includes(request.navigationType)
      return !isNavigation && request.method === "GET" && url.protocol === "https:" && (!url.port || url.port === "443") && allowedHosts.has(url.hostname)
    } catch {
      return false
    }
  }

  let sharing = false
  await webView.addScriptMessageHandler("shareTyphoon", async () => {
    if (sharing) return { ok: false, busy: true }
    sharing = true
    try {
      return { ok: true, completed: await ShareSheet.present(["台风路径", "https://tf03.istrongcloud.com/member/v1.3/home"]) }
    } catch (error) {
      console.error("分享失败", error)
      return { ok: false }
    } finally {
      sharing = false
    }
  })

  try {
    const loaded = await webView.loadFile(entryFile, webDirectory)
    if (!loaded) throw new Error("本地地图页面加载失败")
    if (requestedTyphoonId) await webView.evaluateJavaScript(`window.__requestedTyphoonId=${JSON.stringify(requestedTyphoonId)}`)
    await webView.present({ fullscreen: true })
  } finally {
    webView.dispose()
    Script.exit()
  }
}

main().catch(error => {
  console.error(error)
  Script.exit()
})
