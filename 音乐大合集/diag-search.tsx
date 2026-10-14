// 端到端验证：推送模式桥 + 各站源搜索（复刻 index.tsx 的实现）
import { Script, Path } from "scripting"

declare const fetch: any

async function nativeHttpDo(params: any): Promise<string> {
  try {
    const url = String(params?.url || "")
    if (!url) return ""
    const method = String(params?.method || "GET").toUpperCase()
    const headers: Record<string, string> = {}
    Object.entries(params?.headers || {}).forEach(([k, v]: any) => {
      try { if (v != null && !/^user-agent$/i.test(k)) headers[k] = String(v) } catch (e) {}
    })
    const init: any = { method, headers, timeout: Number(params?.timeout) || 15 }
    if (method !== "GET" && method !== "HEAD" && params?.body) init.body = String(params.body)
    const r = await fetch(url, init)
    return await r.text()
  } catch (e) { return "" }
}

async function main() {
  const server = new HttpServer()
  server.registerFilesFromDirectory("/:file", Path.join(Script.directory, "web"), { defaults: ["index.html"] })
  const err = server.start({ port: 0, forceIPv4: true })
  if (err) { console.error("服务器启动失败: " + err); await console.present(); Script.exit(); return }
  const base = `http://127.0.0.1:${server.port}/`
  console.log("本地服务: " + base)

  const webView = new WebViewController()

  // 复刻 index.tsx 的推送桥
  await webView.addScriptMessageHandler("aqHttp", (params: any) => {
    const id = String(params?.__id || "")
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

  const ok = await webView.loadURL(base)
  console.log("页面加载: " + (ok ? "成功" : "失败"))
  await webView.waitForLoad()

  // 复刻 index.tsx 的注入脚本
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
          var timer = setTimeout(function () { delete window.__aqHttpCbs[id]; resolve(""); }, ms);
          window.__aqHttpCbs[id] = function (t) {
            clearTimeout(timer); delete window.__aqHttpCbs[id]; resolve(String(t || ""));
          };
          try {
            window.webkit.messageHandlers.aqHttp.postMessage({
              __id: id, url: url, method: opts.method || "GET",
              headers: opts.headers || {}, body: opts.body || "", timeout: opts.timeout || 15,
            });
          } catch (e) { clearTimeout(timer); delete window.__aqHttpCbs[id]; resolve(""); }
        });
      };
    })();
  `)

  const result: any = await Promise.race([
    webView.evaluateJavaScript(`
      return (async function () {
        var out = {};
        function withTimeout(p, ms) {
          return Promise.race([p, new Promise(function (r) { setTimeout(function () { r("__T__"); }, ms); })]);
        }
        var kw = encodeURIComponent("周杰伦");
        // 1) 推送桥本身
        try {
          var t = await withTimeout(window.__aqHttpPush("https://u.y.qq.com/cgi-bin/musicu.fcg?data=%7B%7D", { timeout: 8 }), 15000);
          out.bridge = t.length > 10 ? "OK len=" + t.length : "EMPTY len=" + t.length;
        } catch (e) { out.bridge = "FAIL"; }
        // 2) 页面内部 searchQQ / searchNetease / searchKuwo / searchKugou / searchMigu
        //    （都挂在闭包里，走 AQ.searchQQ 等公开口）
        try {
          var l = await withTimeout(window.AQ.searchQQ("周杰伦", 1), 20000);
          out.qq = l && l.length ? "OK n=" + l.length + " first=" + l[0].name : "EMPTY";
        } catch (e) { out.qq = "FAIL:" + (e && e.message); }
        // 网易：走 adapterRequest→aqHttpPush
        try {
          var r2 = await withTimeout(window.AQ.adapterRequest("https://music.163.com/api/search/get?s=" + kw + "&type=1&limit=5&offset=0", { headers: { Referer: "https://music.163.com/" }, timeout: 8 }), 20000);
          var j2 = r2 && r2.indexOf("{") >= 0 ? JSON.parse(r2) : null;
          out.netease = j2 && j2.result && j2.result.songs ? "OK n=" + j2.result.songs.length : "EMPTY len=" + (r2 ? r2.length : 0);
        } catch (e) { out.netease = "FAIL:" + (e && e.message); }
        try {
          var r3 = await withTimeout(window.AQ.adapterRequest("https://search.kuwo.cn/r.s?all=" + kw + "&ft=music&rn=5&pn=0&rformat=json&encoding=utf8&mobi=1&vipver=1", { headers: { Referer: "https://www.kuwo.cn/" }, timeout: 8 }), 20000);
          out.kuwo = r3 && r3.indexOf("abslist") >= 0 ? "OK len=" + r3.length : "EMPTY len=" + (r3 ? r3.length : 0);
        } catch (e) { out.kuwo = "FAIL:" + (e && e.message); }
        try {
          var r4 = await withTimeout(window.AQ.adapterRequest("https://songsearch.kugou.com/song_search_v2?keyword=" + kw + "&page=1&pagesize=5&userid=-1&clientver=&platform=WebFilter&filter=2&iscorrection=1&privilege_filter=0&format=jsonp&callback=jq9", { headers: { Referer: "https://www.kugou.com/" }, timeout: 8 }), 20000);
          out.kugou = r4 && r4.length > 100 ? "OK len=" + r4.length : "EMPTY len=" + (r4 ? r4.length : 0);
        } catch (e) { out.kugou = "FAIL:" + (e && e.message); }
        try {
          var r5 = await withTimeout(window.AQ.adapterRequest("https://pd.musicapp.migu.cn/MIGUM3.0/v1.0/content/search_all.do?text=" + kw + "&pageNo=1&pageSize=5&searchSwitch=" + encodeURIComponent('{"song":1}'), { timeout: 8 }), 20000);
          out.migu = r5 && r5.indexOf("songResultData") >= 0 ? "OK len=" + r5.length : "EMPTY len=" + (r5 ? r5.length : 0);
        } catch (e) { out.migu = "FAIL:" + (e && e.message); }
        return out;
      })();
    `),
    new Promise((r) => setTimeout(() => r({ timeout: "整体超时" }), 120000)),
  ])

  console.log("===== 推送桥 + 各站源验证 =====")
  for (const k of Object.keys(result || {})) console.log(k + ": " + result[k])

  webView.dispose()
  server.stop()
  Script.exit()
}

main()
