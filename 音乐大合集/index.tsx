// 音乐大合集 —— 本地 WebView 版（原名：Apple 音乐源）
// 本地 HttpServer 托管 web/ 目录；并注入原生搜索桥（QQ 老接口失效时走 musicu.fcg，绕过 CORS）。

import { Script, Path } from "scripting"

declare const fetch: any

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

async function main() {
  // 1) 本地静态服务器托管 web/ 目录
  const server = new HttpServer()
  server.registerFilesFromDirectory(
    "/:file",
    Path.join(Script.directory, "web"),
    { defaults: ["index.html"] },
  )
  const startErr = server.start({ port: 0, forceIPv4: true })
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

  // 音频后台保活
  Script.enableMinimize()
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
    })();
  `)

  await webView.present({ fullscreen: true, navigationTitle: "音乐大合集" })

  webView.dispose()
  server.stop()
  Script.exit()
}

main()
