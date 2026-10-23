// 音乐大合集 —— 本地 WebView 版（原名：Apple 音乐源）
// 本地 HttpServer 托管 web/ 目录；并注入原生搜索桥（QQ 老接口失效时走 musicu.fcg，绕过 CORS）。

import { Script, Path } from "scripting"

declare const fetch: any
declare const DownloadManager: any

const activeDownloadTasks = new Map<string, any>()

let dlQueueInstance: any = null
async function getDlQueue(): Promise<any> {
  if (!dlQueueInstance) {
    dlQueueInstance = await DownloadManager.open({
      identifier: "music_downloads_mgr",
      mode: "foreground",
      maxConcurrentTasks: 2,
      allowsCellularAccess: true,
      timeoutIntervalForRequest: 60,
    })
  }
  return dlQueueInstance
}

async function nativeDownloadFile(params: any, webView: WebViewController): Promise<any> {
  const id = String(params?.__id || "")
  const url = String(params?.url || "")
  let filename = String(params?.filename || "")
  if (!url) return { ok: false, error: "缺少下载地址" }
  filename = filename.replace(/[\\/:*?"<>|\r\n\t]/g, "_").trim()
  if (!filename) filename = "song_" + Date.now() + ".mp3"

  try {
    const queue = await getDlQueue()
    const targetPath = Path.join(DOWNLOADS_DIR, filename)

    if (FileManager.existsSync(targetPath)) {
      try { FileManager.removeSync(targetPath) } catch (eRem) {}
    }

    try {
      const oldTask = await queue.getTaskByURL(url)
      if (oldTask) await oldTask.remove({ deleteFile: true })
    } catch (eOld) {}

    const hdrs: Record<string, string> = {
      "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      "Accept": "*/*",
    }
    if (params?.headers && typeof params.headers === "object") {
      Object.keys(params.headers).forEach((k) => {
        if (!/^(host|content-length|range)$/i.test(k)) hdrs[k] = String(params.headers[k])
      })
    }

    const task = await queue.download({
      url: url,
      destination: targetPath,
      headers: hdrs,
      priority: 0.8,
    })

    if (id) {
      activeDownloadTasks.set(id, task)
      task.onProgress = (p: any) => {
        try {
          const fraction = typeof p?.fractionCompleted === "number" ? p.fractionCompleted : 0
          const completed = Number(p?.completedBytes) || 0
          const total = Number(p?.totalBytes) || 0
          const speed = Number(p?.bytesPerSecond) || 0
          webView.evaluateJavaScript(
            `window.__aqDlProgress && window.__aqDlProgress(${JSON.stringify(id)}, ${JSON.stringify({
              fraction,
              completed,
              total,
              speed,
            })})`,
          ).catch(() => {})
        } catch (e) {}
      }
    }

    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error("下载超时 (75s)")), 75000)
    })
    const finalPath = (await Promise.race([task.waitUntilFinished(), timeoutPromise])) as string

    if (!finalPath || !FileManager.existsSync(finalPath)) {
      throw new Error("下载完成但未检测到目标文件")
    }

    const size = FileManager.statSync(finalPath).size
    if (size < 1000) {
      try { FileManager.removeSync(finalPath) } catch (e) {}
      throw new Error("下载文件为空或损坏")
    }

    const actualName = Path.basename(finalPath)
    const mime = FileManager.mimeType(finalPath) || ""

    return {
      ok: true,
      filename: actualName,
      localUrl: "/downloads/" + encodeURIComponent(actualName),
      size: size,
      mime: mime,
    }
  } catch (e: any) {
    console.warn("[nativeDownload] " + e)
    return { ok: false, error: String(e?.message || e) }
  } finally {
    if (id) activeDownloadTasks.delete(id)
  }
}

/** localStorage 按 origin（含端口）隔离，随机端口会让设置活不过一次重启；
 *  所以设置另存为本地文件，启动时通过 /settings.js 下发给页面。 */
const WEB_PORT = 17853
const SETTINGS_FILE = Path.join(FileManager.appGroupDocumentsDirectory, "music_settings.json")
const DOWNLOADS_DIR = Path.join(FileManager.appGroupDocumentsDirectory, "music_downloads")
if (!FileManager.existsSync(DOWNLOADS_DIR)) {
  try { FileManager.createDirectorySync(DOWNLOADS_DIR, true) } catch (e) {}
}
const DOWNLOADS_RECORD_FILE = Path.join(FileManager.appGroupDocumentsDirectory, "music_downloads_record.json")

function readSavedDownloads(): any[] {
  try {
    if (!FileManager.existsSync(DOWNLOADS_RECORD_FILE)) return []
    const arr = JSON.parse(FileManager.readAsStringSync(DOWNLOADS_RECORD_FILE))
    return Array.isArray(arr) ? arr : []
  } catch (e) {
    return []
  }
}

function writeSavedDownloads(list: any[]): boolean {
  try {
    FileManager.writeAsStringSync(DOWNLOADS_RECORD_FILE, JSON.stringify(Array.isArray(list) ? list : []))
    return true
  } catch (e) {
    return false
  }
}

function readSavedSettings(): Record<string, string> {
  try {
    if (!FileManager.existsSync(SETTINGS_FILE)) return {}
    const obj = JSON.parse(FileManager.readAsStringSync(SETTINGS_FILE))
    if (!obj || typeof obj !== "object") return {}
    const out: Record<string, string> = {}
    Object.keys(obj).forEach((k) => {
      if (obj[k] != null && obj[k] !== "") out[k] = String(obj[k])
    })
    return out
  } catch (e) {
    console.warn("[settings] read fail: " + e)
    return {}
  }
}

function hasSavedSettings(): boolean {
  try { return FileManager.existsSync(SETTINGS_FILE) } catch (e) { return false }
}

/** 保存整份设置；返回是否成功 */
function writeSavedSettings(obj: any): boolean {
  try {
    const clean: Record<string, string> = {}
    Object.keys(obj || {}).forEach((k) => {
      if (obj[k] != null && obj[k] !== "") clean[k] = String(obj[k])
    })
    FileManager.writeAsStringSync(SETTINGS_FILE, JSON.stringify(clean))
    return true
  } catch (e) {
    console.warn("[settings] save fail: " + e)
    return false
  }
}

function settingsScript(): string {
  return (
    "window.__AQ_SETTINGS=" + JSON.stringify(readSavedSettings()) + ";" +
    "window.__AQ_HAS_SAVED=" + (hasSavedSettings() ? "true" : "false") + ";" +
    "window.__AQ_DOWNLOADS_RECORD=" + JSON.stringify(readSavedDownloads()) + ";"
  )
}

function jsResponse(body: string): HttpResponse {
  return HttpResponse.raw(200, "OK", {
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      "cache-control": "no-store",
    },
    body: Data.fromRawString(body)!,
  })
}

function jsonResponse(body: string): HttpResponse {
  return HttpResponse.raw(200, "OK", {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
    body: Data.fromRawString(body)!,
  })
}

/** QQ musicu 搜索：DoSearchForQQMusicDesktop（原生请求无 CORS 限制） */
async function nativeSearchQQ(kw: string, page: number): Promise<any[]> {
  const payload = {
    comm: { ct: 19, cv: 1859, uin: 0, format: "json", platform: "yqq.json", needNewCode: 0 },
    req_1: {
      method: "DoSearchForQQMusicDesktop",
      module: "music.search.SearchCgiService",
      param: {
        query: kw,
        num_per_page: 30,
        page_num: page || 1,
        search_type: 0,
      },
    },
  }
  try {
    const r = await fetch(
      "https://u.y.qq.com/cgi-bin/musicu.fcg?data=" + encodeURIComponent(JSON.stringify(payload)),
      { headers: { Referer: "https://y.qq.com/", Accept: "application/json" }, timeout: 12 },
    )
    if (!r.ok) return []
    const j = await r.json()
    const list = j?.req_1?.data?.body?.song?.list || []
    // 映射为 app.js normSong 兼容结构
    return (list as any[]).map((s: any) => {
      const singer = (s.singer || []).map((a: any) => a.name).filter(Boolean).join(" / ")
      const amid = (s.album && (s.album.mid || s.album.pmid)) || ""
      return {
        name: s.name || s.title || "",
        artist: singer || "未知",
        songmid: s.mid || "",
        id: s.mid || "",
        albummid: amid,
        album: (s.album && (s.album.title || s.album.name)) || "",
        cover: amid ? "https://y.gtimg.cn/music/photo_new/T002R300x300M000" + amid + ".jpg" : "",
        interval: s.interval || 0,
        source: "qq",
      }
    }).filter((s) => s.songmid && s.name)
  } catch (e) {
    console.warn("[nativeSearchQQ]", e)
    return []
  }
}

/** 通用原生 HTTP 桥（推送模式）：网页 postMessage 发请求（不等返回值），
 *  原生 fetch 完成后用 evaluateJavaScript 把结果推回 window.__aqHttpCbs[id]。
 *  注意：Scripting 的 message handler 异步返回值无法回传到网页，必须用推送模式。 */
async function nativeHttpDo(params: any): Promise<string> {
  try {
    const url = String(params?.url || "")
    if (!url) return ""
    const method = String(params?.method || "GET").toUpperCase()
    const headers: Record<string, string> = {}
    Object.entries(params?.headers || {}).forEach(([k, v]) => {
      try { if (v != null && !/^user-agent$/i.test(k)) headers[k] = String(v) } catch (e) {}
    })
    const init: any = { method, headers, timeout: Number(params?.timeout) || 15 }
    if (method !== "GET" && method !== "HEAD" && params?.body) init.body = String(params.body)
    const r = await fetch(url, init)
    return await r.text()
  } catch (e) {
    console.warn("[aqHttp] " + (e as any))
    return ""
  }
}

/** 探测音频文件信息：HEAD 优先；HEAD 不可用（403/405/无长度）时用 Range GET 取 Content-Range，
 *  全程不读 body（避免把整首音频读进内存）。 */
async function nativeMediaInfo(params: any): Promise<string> {
  const url = String(params?.url || "")
  if (!url) return JSON.stringify({ ok: false })
  const timeout = Number(params?.timeout) || 15
  const hdrs: Record<string, string> = {}
  Object.entries(params?.headers || {}).forEach(([k, v]) => {
    try { if (v != null && !/^(range|user-agent)$/i.test(k)) hdrs[k] = String(v) } catch (e) {}
  })
  const readHeaders = (r: any): Record<string, string> => {
    const h: Record<string, string> = {}
    try {
      if (r && r.headers && typeof r.headers.forEach === "function") {
        r.headers.forEach((v: string, k: string) => { h[String(k).toLowerCase()] = String(v) })
      } else if (r && r.headers && typeof r.headers === "object") {
        Object.keys(r.headers).forEach((k) => { h[k.toLowerCase()] = String(r.headers[k]) })
      }
    } catch (e) {}
    return h
  }
  const snap = (r: any): any => {
    const h = readHeaders(r)
    let length = typeof r?.expectedContentLength === "number" ? r.expectedContentLength : 0
    if (!length) length = Number(h["content-length"] || 0) || 0
    const cr = String(h["content-range"] || "")
    if (!length) {
      const m = cr.match(/\/\s*(\d+)\s*$/)
      if (m) length = Number(m[1]) || 0
    }
    return {
      ok: true,
      status: Number(r?.status) || 0,
      finalUrl: String(r?.url || url),
      mime: String(r?.mimeType || h["content-type"] || ""),
      length: length || 0,
      acceptRanges: String(h["accept-ranges"] || ""),
      contentRange: cr,
    }
  }
  let out: any = null
  try {
    out = snap(await fetch(url, { method: "HEAD", headers: hdrs, timeout }))
  } catch (eHead) {
    out = null
  }
  if (!out || out.status >= 400 || !out.length) {
    try {
      const r2 = await fetch(url, { method: "GET", headers: Object.assign({ Range: "bytes=0-0" }, hdrs), timeout })
      const s2 = snap(r2)
      if (!out || out.status >= 400) out = s2
      else {
        out.length = out.length || s2.length
        out.mime = out.mime || s2.mime
        out.acceptRanges = out.acceptRanges || s2.acceptRanges
      }
    } catch (eGet) {}
  }
  return JSON.stringify(out || { ok: false })
}

async function main() {
  // 1) 本地静态服务器托管 web/ 目录
  const webDir = Path.join(Script.directory, "web")
  function newServer(): HttpServer {
    const s = new HttpServer()
    // GET /settings.js：中间件抢在静态目录前处理（registerHandler 会被 /:file 遮住）
    s.registerMiddleware(async (req) => {
      if (req.path === "/settings.js") return jsResponse(settingsScript())
      return null
    })
    // POST /settings/save：registerAsyncHandler 能拿到 body（middleware 看不到 POST）
    s.registerAsyncHandler("/settings/save", async (req) => {
      let text = ""
      try { text = req.body ? req.body.toDecodedString("utf8") : "" } catch (eB) { text = "" }
      let ok = false
      try {
        const obj = JSON.parse(text)
        if (obj && typeof obj === "object") ok = writeSavedSettings(obj)
      } catch (eP) { ok = false }
      return jsonResponse(JSON.stringify({ ok }))
    })
    s.registerFilesFromDirectory("/downloads/:file", DOWNLOADS_DIR)
    s.registerFilesFromDirectory("/:file", webDir, { defaults: ["index.html"] })
    return s
  }
  // 先试固定端口（保住 localStorage 里的其它缓存），占用则退回随机端口
  let server = newServer()
  let startErr = server.start({ port: WEB_PORT, forceIPv4: true })
  if (startErr) {
    server = newServer()
    startErr = server.start({ port: 0, forceIPv4: true })
  }
  if (startErr) {
    console.error("本地服务启动失败: " + startErr)
    await console.present()
    Script.exit()
    return
  }
  const base = `http://127.0.0.1:${server.port}/`

  // 2) WebView 以 http 源加载
  const webView = new WebViewController()

  // 原生搜索桥：网页调用 window.webkit.messageHandlers.nativeSearchQQ.postMessage({kw, page})
  await webView.addScriptMessageHandler("nativeSearchQQ", async (params: any) => {
    return await nativeSearchQQ(String(params?.kw || ""), Number(params?.page) || 1)
  })

  // 通用 HTTP 桥（推送模式）：网页发 {__id, url, method, headers, body, timeout}，结果推回 __aqHttpCbs
  await webView.addScriptMessageHandler("aqHttp", (params: any) => {
    const id = String(params?.__id || "")
    // 异步执行，不阻塞 handler；完成后推送结果回网页
    ;(async () => {
      const text = await nativeHttpDo(params)
      try {
        await webView.evaluateJavaScript(
          `window.__aqHttpCbs && window.__aqHttpCbs[${JSON.stringify(id)}] && window.__aqHttpCbs[${JSON.stringify(id)}](${JSON.stringify(text)})`,
        )
      } catch (e) {}
    })()
    return null
  })

  // 文件信息桥（推送模式）：网页传 {__id, url, headers}，结果推回 __aqMediaCbs
  await webView.addScriptMessageHandler("aqMediaInfo", (params: any) => {
    const id = String(params?.__id || "")
    ;(async () => {
      const text = await nativeMediaInfo(params)
      try {
        await webView.evaluateJavaScript(
          `window.__aqMediaCbs && window.__aqMediaCbs[${JSON.stringify(id)}] && window.__aqMediaCbs[${JSON.stringify(id)}](${JSON.stringify(text)})`,
        )
      } catch (e) {}
    })()
    return null
  })

  // 原生下载桥（使用原生 DownloadManager 流式写入，无内存膨胀与主线程卡死）
  await webView.addScriptMessageHandler("aqDownload", (params: any) => {
    const id = String(params?.__id || "")
    ;(async () => {
      const res = await nativeDownloadFile(params, webView)
      try {
        await webView.evaluateJavaScript(
          `window.__aqDownloadCbs && window.__aqDownloadCbs[${JSON.stringify(id)}] && window.__aqDownloadCbs[${JSON.stringify(id)}](${JSON.stringify(res)})`,
        )
      } catch (eEval) {}
    })()
    return null
  })

  // 原生取消下载任务桥
  await webView.addScriptMessageHandler("aqCancelDownload", (params: any) => {
    const id = String(params?.__id || "")
    if (id && activeDownloadTasks.has(id)) {
      const task = activeDownloadTasks.get(id)
      try {
        task.cancel().catch(() => {})
        task.remove({ deleteFile: true }).catch(() => {})
      } catch (e) {}
      activeDownloadTasks.delete(id)
    }
    return null
  })

  // 原生删除已下载音频文件桥
  await webView.addScriptMessageHandler("aqDeleteDownload", (params: any) => {
    const id = String(params?.__id || "")
    const filename = String(params?.filename || "").replace(/[\\/:*?"<>|]/g, "_").trim()
    let ok = false
    if (filename) {
      try {
        const filePath = Path.join(DOWNLOADS_DIR, filename)
        if (FileManager.existsSync(filePath)) {
          FileManager.removeSync(filePath)
          ok = true
        }
      } catch (e) {
        console.warn("[aqDeleteDownload]", e)
      }
    }
    try {
      webView.evaluateJavaScript(
        `window.__aqDeleteCbs && window.__aqDeleteCbs[${JSON.stringify(id)}] && window.__aqDeleteCbs[${JSON.stringify(id)}](${JSON.stringify({ ok })})`,
      )
    } catch (e) {}
    return null
  })

  // 同步已下载记录到本地磁盘
  await webView.addScriptMessageHandler("aqSaveDownloadsRecord", (params: any) => {
    try {
      const list = params?.list
      if (Array.isArray(list)) writeSavedDownloads(list)
    } catch (e) {}
    return null
  })

  // 窗口控制桥：允许前端调用主动关闭页面并释放实例
  await webView.addScriptMessageHandler("closeWindow", () => {
    try {
      webView.dismiss()
    } catch (e) {}
    return null
  })

  // 监听恢复事件（多窗口或后台唤醒时保持响应）
  Script.onResume(() => {})

  const ok = await webView.loadURL(base)
  if (!ok) {
    console.error("加载本地页面失败: " + base)
    server.stop()
    await console.present()
    Script.exit()
    return
  }

  // 注入推送模式桥接函数：__aqHttpPush 返回 Promise，原生完成后推回结果
  await webView.evaluateJavaScript(`
    (function () {
      if (window.__aqHttpPush) return;
      window.__aqHttpCbs = window.__aqHttpCbs || {};
      window.__aqHttpPush = function (url, opts) {
        opts = opts || {};
        return new Promise(function (resolve) {
          var seq = (window.__aqHttpSeq = (window.__aqHttpSeq || 0) + 1);
          var id = "aqh_" + Date.now() + "_" + seq;
          var ms = ((Number(opts.timeout) || 15) + 3) * 1000;
          var timer = setTimeout(function () {
            delete window.__aqHttpCbs[id];
            resolve("");
          }, ms);
          window.__aqHttpCbs[id] = function (t) {
            clearTimeout(timer);
            delete window.__aqHttpCbs[id];
            resolve(String(t || ""));
          };
          try {
            window.webkit.messageHandlers.aqHttp.postMessage({
              __id: id, url: url, method: opts.method || "GET",
              headers: opts.headers || {}, body: opts.body || "",
              timeout: opts.timeout || 15,
            });
          } catch (e) {
            clearTimeout(timer);
            delete window.__aqHttpCbs[id];
            resolve("");
          }
        });
      };
      // 原生 QQ 搜索桥：也改走 aqHttpPush（旧的 postMessage 返回值模式拿不到结果）
      window.__nativeSearchQQ = function (kw, page) {
        var payload = {
          comm: { ct: 19, cv: 1859, uin: 0, format: "json", platform: "yqq.json", needNewCode: 0 },
          req_1: {
            method: "DoSearchForQQMusicDesktop",
            module: "music.search.SearchCgiService",
            param: { query: kw, num_per_page: 30, page_num: page || 1, search_type: 0 },
          },
        };
        return window.__aqHttpPush(
          "https://u.y.qq.com/cgi-bin/musicu.fcg?data=" + encodeURIComponent(JSON.stringify(payload)),
          { headers: { Referer: "https://y.qq.com/", Accept: "application/json" }, timeout: 12 },
        ).then(function (txt) {
          try {
            var j = JSON.parse(txt);
            var list = (j && j.req_1 && j.req_1.data && j.req_1.data.body && j.req_1.data.body.song && j.req_1.data.body.song.list) || [];
            return list.map(function (s) {
              var singer = (s.singer || []).map(function (a) { return a.name; }).filter(Boolean).join(" / ");
              var amid = (s.album && (s.album.mid || s.album.pmid)) || "";
              return {
                name: s.name || "", artist: singer || "未知",
                songmid: s.mid || "", id: s.mid || "", albummid: amid,
                album: (s.album && (s.album.title || s.album.name)) || "",
                cover: amid ? "https://y.gtimg.cn/music/photo_new/T002R300x300M000" + amid + ".jpg" : "",
                interval: s.interval || 0, source: "qq",
              };
            }).filter(function (s) { return s.songmid && s.name; });
          } catch (e) { return []; }
        });
      };
      // 原生关闭窗口桥
      window.__closeWindow = function () {
        try {
          window.webkit.messageHandlers.closeWindow.postMessage({});
        } catch (e) {}
      };
    })();
  `)

  // 注入文件信息桥（推送模式）：__aqMediaInfo(url, headers) → Promise<{ok,status,finalUrl,mime,length,acceptRanges}>
  await webView.evaluateJavaScript(`
    (function () {
      if (window.__aqMediaInfo) return;
      window.__aqMediaCbs = window.__aqMediaCbs || {};
      window.__aqMediaInfo = function (url, headers) {
        return new Promise(function (resolve) {
          var seq = (window.__aqMediaSeq = (window.__aqMediaSeq || 0) + 1);
          var id = "aqm_" + Date.now() + "_" + seq;
          var timer = setTimeout(function () {
            delete window.__aqMediaCbs[id];
            resolve(null);
          }, 22000);
          window.__aqMediaCbs[id] = function (t) {
            clearTimeout(timer);
            delete window.__aqMediaCbs[id];
            try { resolve(JSON.parse(String(t || "null"))); } catch (e) { resolve(null); }
          };
          try {
            window.webkit.messageHandlers.aqMediaInfo.postMessage({
              __id: id, url: url, headers: headers || {}, timeout: 15,
            });
          } catch (e) {
            clearTimeout(timer);
            delete window.__aqMediaCbs[id];
            resolve(null);
          }
        });
      };
      // 注入原生下载桥与进度桥
      window.__aqDownloadCbs = window.__aqDownloadCbs || {};
      window.__aqDlProgressCbs = window.__aqDlProgressCbs || {};
      window.__aqDlProgress = function (id, data) {
        if (window.__aqDlProgressCbs && window.__aqDlProgressCbs[id]) {
          try { window.__aqDlProgressCbs[id](data); } catch (e) {}
        }
      };
      window.__aqCancelDownload = function (id) {
        try {
          window.webkit.messageHandlers.aqCancelDownload.postMessage({ __id: id });
        } catch (e) {}
      };
      window.__aqDownloadFile = function (url, filename, headers, customId) {
        return new Promise(function (resolve) {
          var seq = (window.__aqDlSeq = (window.__aqDlSeq || 0) + 1);
          var id = customId || ("aqdl_" + Date.now() + "_" + seq);
          var timer = setTimeout(function () {
            delete window.__aqDownloadCbs[id];
            delete window.__aqDlProgressCbs[id];
            resolve({ ok: false, error: "下载超时" });
          }, 85000);
          window.__aqDownloadCbs[id] = function (res) {
            clearTimeout(timer);
            delete window.__aqDownloadCbs[id];
            delete window.__aqDlProgressCbs[id];
            resolve(res || { ok: false, error: "未返回结果" });
          };
          try {
            window.webkit.messageHandlers.aqDownload.postMessage({
              __id: id, url: url, filename: filename, headers: headers || {},
            });
          } catch (e) {
            clearTimeout(timer);
            delete window.__aqDownloadCbs[id];
            delete window.__aqDlProgressCbs[id];
            resolve({ ok: false, error: String(e) });
          }
        });
      };
      // 注入原生删除桥
      window.__aqDeleteCbs = window.__aqDeleteCbs || {};
      window.__aqDeleteFile = function (filename) {
        return new Promise(function (resolve) {
          var seq = (window.__aqDelSeq = (window.__aqDelSeq || 0) + 1);
          var id = "aqdel_" + Date.now() + "_" + seq;
          window.__aqDeleteCbs[id] = function (res) {
            delete window.__aqDeleteCbs[id];
            resolve(res || { ok: false });
          };
          try {
            window.webkit.messageHandlers.aqDeleteDownload.postMessage({
              __id: id, filename: filename,
            });
          } catch (e) {
            delete window.__aqDeleteCbs[id];
            resolve({ ok: false });
          }
        });
      };
      // 注入同步下载记录桥
      window.__aqSyncDownloadsRecord = function (list) {
        try {
          window.webkit.messageHandlers.aqSaveDownloadsRecord.postMessage({ list: list || [] });
        } catch (e) {}
      };
    })();
  `)

  await webView.present({ fullscreen: true, navigationTitle: "音乐大合集" })

  webView.dispose()
  server.stop()
  Script.exit()
}

main()
