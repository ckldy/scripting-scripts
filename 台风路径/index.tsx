// 台风路径 — 原版前端格式 WebView + Leaflet 重构

import { Script, Widget } from "scripting"
import { loadWidgetData } from "./widget_data"
import { renderAllTyphoonWidgetMaps, verifyAmapKey } from "./widget_map"
import { amapKeyStatus, readSavedAmapKey, saveAmapKey } from "./amap_config"

const projectDirectory = FileManager.scriptsDirectory + "/台风路径"
const webDirectory = projectDirectory + "/web"
const entryFile = webDirectory + "/index.html"
const requestedTyphoonId = String(Script.queryParameters["tfbh"] || "").replace(/[^A-Za-z0-9_-]/g, "")

async function refreshWidgetMapCache(amapKey: string): Promise<number> {
  if (!amapKey) {
    console.log("未配置高德地图 Key，跳过小组件地图缓存生成")
    return 0
  }
  try {
    const { cache } = await loadWidgetData()
    if (!cache.typhoons.length) return 0
    const rendered = await renderAllTyphoonWidgetMaps(cache.typhoons, amapKey)
    if (rendered) Widget.reloadAll()
    return rendered
  } catch (error) {
    console.error("Widget地图缓存更新失败", String(error))
    return 0
  }
}

async function main() {
  await refreshWidgetMapCache(readSavedAmapKey())
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

  await webView.addScriptMessageHandler("getAmapKeyStatus", async () => {
    const status = amapKeyStatus()
    if (status.configured && status.key) {
      const check = await verifyAmapKey(status.key)
      return { ...status, valid: check.ok, validationError: check.error }
    }
    return status
  })

  await webView.addScriptMessageHandler("setAmapKey", async (params?: { key?: string }) => {
    const key = String(params?.key || "").trim()
    if (key.length < 8) return { ok: false, message: "Key 长度不足，请检查是否完整" }
    const check = await verifyAmapKey(key)
    if (!check.ok) return { ok: false, message: check.error || "Key 验证失败" }
    saveAmapKey(key)
    // 地图缓存后台生成，不阻塞保存操作
    refreshWidgetMapCache(key).catch(error => console.error("Key保存后后台生成地图失败", String(error)))
    return { ok: true, message: "Key 已保存并验证通过，正在后台生成地图缓存…", ...amapKeyStatus() }
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
