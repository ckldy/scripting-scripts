// 台风路径 — 原版前端格式 WebView + Leaflet 重构

import { Script, Widget } from "scripting"
import { loadWidgetData } from "./widget_data"
import { renderAllTyphoonWidgetMaps, verifyAmapKey } from "./widget_map"
import { amapKeyStatus, readSavedAmapKey, saveAmapKey } from "./amap_config"

type AmapRuntimeState = {
  processing: boolean
  configured: boolean
  masked?: string
  updatedAt?: number
  valid?: boolean
  validationError?: string
  message?: string
}

const projectDirectory = FileManager.scriptsDirectory + "/台风路径"
const webDirectory = projectDirectory + "/web"
const entryFile = webDirectory + "/index.html"
const requestedTyphoonId = String(Script.queryParameters["tfbh"] || "").replace(/[^A-Za-z0-9_-]/g, "")

async function doRefreshWidgetMapCache(amapKey: string): Promise<number> {
  if (!amapKey) {
    console.log("未配置高德地图 Key，跳过小组件地图缓存生成")
    return 0
  }
  try {
    const { cache } = await loadWidgetData()
    if (!cache.typhoons.length) return 0
    const rendered = await renderAllTyphoonWidgetMaps(cache.typhoons, amapKey, cache.updatedAt)
    if (rendered) Widget.reloadAll()
    return rendered
  } catch (error) {
    console.error("Widget地图缓存更新失败", String(error))
    return 0
  }
}

// 单飞：同一运行期内同 Key 的刷新只执行一个任务，避免连续打开主程序导致并行下载/渲染互相覆盖。
let widgetRefresh: { key: string; promise: Promise<number> } | null = null
function refreshWidgetMapCache(amapKey: string): Promise<number> {
  if (widgetRefresh && widgetRefresh.key === amapKey) return widgetRefresh.promise
  const promise = doRefreshWidgetMapCache(amapKey).finally(() => {
    if (widgetRefresh?.promise === promise) widgetRefresh = null
  })
  widgetRefresh = { key: amapKey, promise }
  return promise
}

async function main() {
  const initialKey = readSavedAmapKey()
  let amapRuntimeState: AmapRuntimeState = {
    processing: !!initialKey,
    ...amapKeyStatus(),
    message: initialKey ? "正在后台验证 Key…" : undefined
  }
  let amapOperationId = 0
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
  await webView.addScriptMessageHandler("shareTyphoon", () => {
    if (sharing) return { ok: false, busy: true }
    sharing = true
    ShareSheet.present(["台风路径", "https://tf03.istrongcloud.com/member/v1.3/home"])
      .catch(error => console.error("分享失败", error))
      .finally(() => { sharing = false })
    return { ok: true }
  })

  // Scripting 的 WebView 消息处理器不会等待 Promise：这些 handler 必须同步返回。
  await webView.addScriptMessageHandler("getAmapKeyStatus", () => amapRuntimeState)

  await webView.addScriptMessageHandler("clearAmapKey", () => {
    amapOperationId++
    saveAmapKey("")
    amapRuntimeState = { processing: false, configured: false }
    return { ok: true, ...amapRuntimeState }
  })

  await webView.addScriptMessageHandler("setAmapKey", (params?: { key?: string }) => {
    const key = String(params?.key || "").trim()
    if (key.length < 8) return { ok: false, message: "Key 长度不足，请检查是否完整" }
    if (amapRuntimeState.processing) return { ok: false, busy: true, message: "正在验证 Key，请稍候" }

    const operationId = ++amapOperationId
    amapRuntimeState = {
      processing: true,
      ...amapKeyStatus(),
      message: "正在验证 Key…"
    }

    ;(async () => {
      const check = await verifyAmapKey(key)
      if (operationId !== amapOperationId) return
      if (!check.ok) {
        amapRuntimeState = {
          processing: false,
          ...amapKeyStatus(),
          valid: false,
          validationError: check.error || "Key 验证失败"
        }
        return
      }

      saveAmapKey(key)
      amapRuntimeState = {
        processing: false,
        ...amapKeyStatus(),
        valid: true,
        message: "Key 已保存并验证通过，正在后台生成地图缓存…"
      }
      refreshWidgetMapCache(key).catch(error => console.error("Key保存后后台生成地图失败", String(error)))
    })().catch(error => {
      if (operationId !== amapOperationId) return
      amapRuntimeState = {
        processing: false,
        ...amapKeyStatus(),
        valid: false,
        validationError: String(error)
      }
    })

    return { ok: true, pending: true, message: "正在验证 Key…" }
  })

  try {
    const loaded = await webView.loadFile(entryFile, webDirectory)
    if (!loaded) throw new Error("本地地图页面加载失败")
    if (requestedTyphoonId) await webView.evaluateJavaScript(`window.__requestedTyphoonId=${JSON.stringify(requestedTyphoonId)}`)
    if (initialKey) {
      const operationId = ++amapOperationId
      ;(async () => {
        const check = await verifyAmapKey(initialKey)
        if (operationId !== amapOperationId) return
        if (!check.ok) {
          amapRuntimeState = {
            processing: false,
            ...amapKeyStatus(),
            valid: false,
            validationError: check.error || "Key 验证失败"
          }
          return
        }
        amapRuntimeState = {
          processing: false,
          ...amapKeyStatus(),
          valid: true,
          message: "Key 验证通过，正在后台更新地图缓存…"
        }
        refreshWidgetMapCache(initialKey).catch(error => console.error("启动后后台生成地图失败", String(error)))
      })().catch(error => {
        if (operationId !== amapOperationId) return
        amapRuntimeState = {
          processing: false,
          ...amapKeyStatus(),
          valid: false,
          validationError: String(error)
        }
      })
    }
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
