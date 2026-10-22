/* early */
try{var t=localStorage.getItem("aq_theme")||"light";function _aqIsNight(){var h=new Date().getHours();return h>=18||h<6;}var dark=t==="dark"||(t==="auto"&&_aqIsNight())||(t==="system"&&window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches);if(dark)document.documentElement.classList.add("dark");}catch(e){}

/* block 1 */
(function () {
  "use strict";

  /* ========== helpers ========== */
  function ls(k, d) {
    try { var v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; }
  }
  function lsJSON(k, d) {
    try { return JSON.parse(localStorage.getItem(k) || "null") || d; } catch (e) { return d; }
  }
  function saveJSON(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {}
  }

  /* —— 设置：草稿 + 保存 ——
     设置页改动先只作用于当前运行态；点「保存设置」才写本地文件，下次启动据此恢复。
     已保存值由原生 /settings.js 在 app.js 之前注入到 window.__AQ_SETTINGS。 */
  var SAVED_CFG = {};
  var HAS_SAVED = false;
  try {
    if (window.__AQ_SETTINGS && typeof window.__AQ_SETTINGS === "object") SAVED_CFG = window.__AQ_SETTINGS;
    HAS_SAVED = !!window.__AQ_HAS_SAVED;
  } catch (eCfgInit) {}

  /** 读设置：已保存文件值优先，其次 localStorage */
  function cfg(k, d) {
    try {
      if (HAS_SAVED && SAVED_CFG[k] != null && SAVED_CFG[k] !== "") return String(SAVED_CFG[k]);
    } catch (eCfg) {}
    return ls(k, d);
  }

  var SETTINGS_KEYS = ["aq_q", "aq_auto_q", "aq_theme", "aq_np_style", "aq_np_seek", "aq_resume", "aq_auto_src", "aq_home_full", "aq_play_src"];
  var SETTINGS_DEFAULTS = { aq_q: "flac", aq_auto_q: "1", aq_theme: "light", aq_np_style: "classic", aq_np_seek: "orbit", aq_resume: "0", aq_auto_src: "guess", aq_home_full: "1", aq_play_src: "" };
  var _persistGate = true;   // false = 当前改动仅供预览，不落盘
  var _settingsDirty = false;
  var _fileSaveTimer = 0;
  var _bootDone = false;     // 启动阶段只读不写，避免每次启动都重写设置文件

  function persistSetting(k, v) {
    if (!_persistGate) return;
    try { localStorage.setItem(k, String(v)); } catch (e) {}
    scheduleFileSave();
  }

  /** 非设置页入口（如播放页音质菜单）改动：防抖写文件，避免重启被旧值覆盖 */
  function scheduleFileSave() {
    try {
      if (!_bootDone) return;
      if (_fileSaveTimer) clearTimeout(_fileSaveTimer);
      _fileSaveTimer = setTimeout(function () {
        _fileSaveTimer = 0;
        postSettingsToFile(currentSettingsSnapshot());
      }, 250);
    } catch (e) {}
  }

  function postSettingsToFile(snap) {
    try {
      return fetch("/settings/save", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(snap || {}),
      }).then(function (r) { return r.json(); });
    } catch (e) {
      return Promise.resolve({ ok: false });
    }
  }

  /** 设置页控件：只应用不保存，并标记为待保存 */
  function applyDraft(fn) {
    var prev = _persistGate;
    _persistGate = false;
    try { fn(); } finally { _persistGate = prev; }
    markSettingsDirty(true);
  }

  function markSettingsDirty(on) {
    _settingsDirty = !!on;
    var btn = $("#btnSaveSettings");
    if (btn) {
      btn.textContent = _settingsDirty ? "保存设置 · 未保存" : "保存设置";
      btn.classList.toggle("is-dirty", _settingsDirty);
    }
  }

  function currentSettingsSnapshot() {
    return {
      aq_q: S.quality,
      aq_auto_q: S.autoQDowngrade ? "1" : "0",
      aq_theme: S.theme,
      aq_np_style: S.npStyle,
      aq_np_seek: S.npSeekStyle,
      aq_resume: S.resumeLast ? "1" : "0",
      aq_auto_src: S.autoPlaySrc || "guess",
      aq_home_full: _homeFullPref ? "1" : "0",
      aq_play_src: S.defaultSrcId || "",
    };
  }

  function saveSettings() {
    var snap = currentSettingsSnapshot();
    SETTINGS_KEYS.forEach(function (k) {
      if (snap[k] == null) return;
      try { localStorage.setItem(k, String(snap[k])); } catch (e) {}
    });
    // 只有落盘成功才清掉「未保存」标识
    postSettingsToFile(snap).then(function (j) {
      if (j && j.ok) {
        markSettingsDirty(false);
        toast("设置已保存，下次启动生效");
      } else {
        toast("保存失败，请重试");
      }
    }).catch(function () { toast("保存失败，请重试"); });
  }

  /** 恢复默认：只改当前运行态，仍需点「保存设置」才落盘 */
  function resetSettings() {
    applyDraft(function () {
      S.quality = SETTINGS_DEFAULTS.aq_q;
      S.autoQDowngrade = SETTINGS_DEFAULTS.aq_auto_q === "1";
      S.resumeLast = SETTINGS_DEFAULTS.aq_resume === "1";
      S.autoPlaySrc = SETTINGS_DEFAULTS.aq_auto_src;
      S.defaultSrcId = "";
      try { syncSeg(); } catch (e1) {}
      try { syncAutoQSeg(); } catch (e2) {}
      try { applyTheme(SETTINGS_DEFAULTS.aq_theme, true); } catch (e3) {}
      try { applyNpStyle(SETTINGS_DEFAULTS.aq_np_style); } catch (e4) {}
      try { applyNpSeekStyle(SETTINGS_DEFAULTS.aq_np_seek, true); } catch (e5) {}
      try { syncAutoPlaySeg(); } catch (e6) {}
      try { syncDefaultSrcLabel(); } catch (eDs) {}
      try { setHomeFullPref(SETTINGS_DEFAULTS.aq_home_full === "1", true); } catch (e7) {}
    });
    toast("已恢复默认值（未保存）");
  }

  var S = {
    quality: cfg("aq_q", "flac"),
    autoQDowngrade: cfg("aq_auto_q", "1") !== "0",
    theme: cfg("aq_theme", "light"),
    npStyle: cfg("aq_np_style", "classic"),
    npSeekStyle: (function(){ var v = cfg("aq_np_seek", "orbit"); if (v==="1"||v==="heart") return "heart"; if (v==="0"||v==="bar") return "bar"; if (v==="glow") return "glow"; if (v==="capsule") return "orbit"; if (v==="orbit") return "orbit"; return "orbit"; })(),
    resumeLast: cfg("aq_resume", "0") === "1",
    autoPlaySrc: cfg("aq_auto_src", "guess"),
    defaultSrcId: cfg("aq_play_src", ""),
    lxScript: ls("aq_lx_script", ""),
    lxBase: ls("aq_lx", ""),
    sources: lsJSON("aq_sources", null),
    fav: lsJSON("aq_fav", []),
    favPl: lsJSON("aq_fav_pl", []),
    recent: lsJSON("aq_recent", []),
    dl: lsJSON("aq_dl", []),
    queue: [],
    idx: -1,
    playMode: ls("aq_mode", "list"), /* list | single | shuffle */
    sleepUntil: 0,
    sleepAfterTrack: false,
    feed: [],
    playlists: [],
    playQ: null,
    _pendingFile: null,
    _pendingFileText: "",
  };
  // 内置音源（默认可开关）
  if (!S.sources || !S.sources.length) {
    S.sources = [
      { id: "ynx", name: "星河入梦", platform: "qq", platforms: ["qq", "netease", "kugou", "kuwo", "migu"], type: "api", url: "https://v.yuafeng.cn", enabled: true, builtin: true },
      // 念心支持多平台解析：搜酷我/网易等时走对应 php
      { id: "nianxin", name: "松间听雨", platform: "qq", platforms: ["qq", "netease", "kugou", "kuwo", "migu"], type: "api", url: "https://mcp.nianxinxz.com", enabled: true, builtin: true },
      // 长青 SVIP：haitangw 多平台直链（HTTPS），不走混淆 LX 脚本
      { id: "changqing", name: "淡月疏星", platform: "qq", platforms: ["qq", "netease", "kugou", "kuwo", "migu"], type: "api", url: "https://yinyue.haitangw.net", enabled: true, builtin: true },
      // 屿溪-终章：musicserver.haitangw.cc 统一 resolve-url（支持母带档）
      { id: "yuxi", name: "雾隐青山", platform: "qq", platforms: ["qq", "netease", "kugou", "kuwo", "migu"], type: "api", url: "https://musicserver.haitangw.cc", enabled: true, builtin: true },
    ];
    saveJSON("aq_sources", S.sources);
  } else {
    // 每次启动校正内置源平台声明（避免旧 localStorage 只剩 qq，网易永远匹配不到）
    try {
      var changed = false;
      var hasCq = false;
      var hasYuxi = false;
      (S.sources || []).forEach(function (s) {
        if (!s) return;
        var isNx = s.id === "nianxin" || /念心|松间听雨|nianxin/i.test(s.name || "");
        var isYnx = s.id === "ynx" || /玉宁熙|星河入梦|yuafeng/i.test(String(s.name || "") + (s.url || ""));
        var isYuxi = s.id === "yuxi" || /屿溪|雾隐青山|yuxi|新裤子|终章|musicserver\.haitangw\.cc/i.test(String(s.name || "") + (s.url || "") + (s.jsUrl || "") + (s.fromFile || ""));
        var isCq = !isYuxi && (s.id === "changqing" || /长青|淡月疏星|changqing|元力菌|yinyue\.haitangw\.net/i.test(String(s.name || "") + (s.url || "") + (s.jsUrl || "")));
        if (isCq) hasCq = true;
        if (isYuxi) hasYuxi = true;
        if (isNx || isYnx || isCq || isYuxi) {
          var need = ["qq", "netease", "kugou", "kuwo", "migu"];
          var cur = Array.isArray(s.platforms) ? s.platforms.slice() : (s.platform ? [s.platform] : []);
          need.forEach(function (p) {
            if (cur.indexOf(p) < 0) { cur.push(p); changed = true; }
          });
          s.platforms = cur;
          if (isYnx && !s.url) { s.url = "https://v.yuafeng.cn"; changed = true; }
          if (isNx && !s.url) { s.url = "https://mcp.nianxinxz.com"; changed = true; }
          if (isYnx && s.name !== "星河入梦") { s.name = "星河入梦"; changed = true; }
          if (isNx && s.name !== "松间听雨") { s.name = "松间听雨"; changed = true; }
          if (isCq && !isYuxi && s.name !== "淡月疏星") { s.name = "淡月疏星"; changed = true; }
          if (isCq && !isYuxi) {
            if (!s.url || /yinyue\.haitangw\.net/i.test(String(s.url)) || !s.url) {
              if (s.url !== "https://yinyue.haitangw.net") { s.url = "https://yinyue.haitangw.net"; changed = true; }
            }
            // 导入的混淆 JS 不要再走 LX 运行时，改走内置 HTTPS 直链
            if (s.type === "js" && /长青|淡月疏星|changqing|元力菌|yinyue\.haitangw/i.test(String(s.name || "") + (s.url || "") + (s.fromFile || ""))) {
              s.type = "api"; changed = true;
            }
            if (s.id !== "changqing" && /长青|淡月疏星|changqing|元力菌/i.test(String(s.name || ""))) { s.id = "changqing"; changed = true; }
          }
          if (isYuxi) {
            if (s.url !== "https://musicserver.haitangw.cc") { s.url = "https://musicserver.haitangw.cc"; changed = true; }
            if (s.type === "js") { s.type = "api"; changed = true; }
            if (s.id !== "yuxi") { s.id = "yuxi"; changed = true; }
            if (s.name !== "雾隐青山") { s.name = "雾隐青山"; changed = true; }
          }
        }
      });
      if (!hasCq) {
        S.sources.push({ id: "changqing", name: "淡月疏星", platform: "qq", platforms: ["qq", "netease", "kugou", "kuwo", "migu"], type: "api", url: "https://yinyue.haitangw.net", enabled: true, builtin: true });
        changed = true;
      }
      if (!hasYuxi) {
        S.sources.push({ id: "yuxi", name: "雾隐青山", platform: "qq", platforms: ["qq", "netease", "kugou", "kuwo", "migu"], type: "api", url: "https://musicserver.haitangw.cc", enabled: true, builtin: true });
        changed = true;
      }
      if (changed) saveJSON("aq_sources", S.sources);
    } catch (eMig) {}
  }
  // 启动时清掉残留的「测试中」运行态（刷新/中断测试会把 _testing 写进 localStorage）
  try {
    var _srcDirty = false;
    (S.sources || []).forEach(function (s) {
      if (!s) return;
      if (s._testing) { s._testing = false; _srcDirty = true; }
      if (s._testToken) { delete s._testToken; _srcDirty = true; }
    });
    if (_srcDirty) saveJSON("aq_sources", S.sources);
  } catch (eClr) {}

  var audio = document.getElementById("audio");
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.from((r || document).querySelectorAll(s)); };
  function on(el, ev, fn, opt) { if (el) el.addEventListener(ev, fn, opt); }

  var YNX_KEY = "ak_7cf9da787d54a3a12484fc8c92b2796eb5348c3e76cff8ca";
  var PLACEHOLDER = "data:image/svg+xml," + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect fill="#f2f2f7" width="400" height="400"/><text x="50%" y="54%" fill="#c7c7cc" font-size="72" text-anchor="middle" font-family="system-ui,sans-serif">♪</text></svg>'
  );

  /* 与 qqmusci 一致的封面规则 */
  function coverUrl(mid, type, size) {
    if (!mid) return "";
    mid = String(mid).trim();
    size = size || 300;
    if (mid.indexOf("http") === 0) return upgradeCoverUrl(mid.replace(/^http:/, "https:"), size);
    if (/^T00[12]R/i.test(mid)) {
      var full = "https://y.gtimg.cn/music/photo_new/" + mid + (mid.indexOf(".jpg") > -1 ? "" : ".jpg");
      return upgradeCoverUrl(full, size);
    }
    var dim = size >= 800 ? "800x800" : (size >= 500 ? "500x500" : "300x300");
    if (type === "singer") return "https://y.gtimg.cn/music/photo_new/T001R" + dim + "M000" + mid + ".jpg";
    return "https://y.gtimg.cn/music/photo_new/T002R" + dim + "M000" + mid + ".jpg";
  }
  function fixCover(url) {
    if (!url) return "";
    url = String(url).trim();
    if (url.indexOf("//") === 0) url = "https:" + url;
    return url.replace(/^http:/, "https:");
  }
  /**
   * 把各站封面 URL 升到最高可用清晰度（播放页 / 歌单详情顶图用）
   * QQ: T00xR300 → 800；网易: param=；酷狗 {size}；酷我路径尺寸
   */
  function upgradeCoverUrl(url, preferSize) {
    if (!url) return "";
    var u = fixCover(String(url));
    if (!u || u.indexOf("data:") === 0) return u;
    preferSize = preferSize || 800;
    try {
      // QQ 音乐 photo_new
      u = u.replace(/T00([12])R\d+x\d+M/i, function (_, t) {
        var dim = preferSize >= 800 ? "800x800" : (preferSize >= 500 ? "500x500" : "300x300");
        return "T00" + t + "R" + dim + "M";
      });
      // 网易云 param=140y140 / 300y300 → 0 或 800y800
      if (/music\.126\.net|music\.163\.com/i.test(u)) {
        if (/[?&]param=/i.test(u)) {
          u = u.replace(/([?&]param=)[^&]*/i, "$1" + preferSize + "y" + preferSize);
        } else {
          u += (u.indexOf("?") >= 0 ? "&" : "?") + "param=" + preferSize + "y" + preferSize;
        }
      }
      // 酷狗 / 其它 {size} 占位
      u = u.replace(/\{size\}/gi, String(preferSize >= 480 ? 480 : preferSize));
      // 常见 query size=
      u = u.replace(/([?&](?:size|w|h|width|height)=)\d+/gi, function (m, p) {
        return p + String(preferSize);
      });
      // 路径中的 /150/ /300/ /400/ 等小尺寸段
      u = u.replace(/\/(1[25]0|240|300|400)(\/|$)/g, function (_, s, tail) {
        return "/" + preferSize + (tail || "");
      });
      // 酷我 img 尺寸后缀 _150.jpg _300.jpg
      u = u.replace(/_(\d{2,4})(\.jpg|\.png|\.webp)/i, function (m, n, ext) {
        var num = parseInt(n, 10);
        if (num > 0 && num < preferSize) return "_" + preferSize + ext;
        return m;
      });
    } catch (e) {}
    return u;
  }
  function songCoverHi(s) {
    var base = songCover(s);
    if (!base || base === PLACEHOLDER) return base;
    return upgradeCoverUrl(base, 800) || base;
  }
  function songCover(s) {
    if (!s) return PLACEHOLDER;
    var raw =
      s.cover || s.pic || s.albumPic || s.album_pic || s.picurl || s.picUrl ||
      s.albumpic || s.hts_albumpic || s.img || s.image || s.albumImg || "";
    if (raw) {
      var fixed = fixCover(String(raw));
      // 酷我相对路径 / 无协议路径
      if (fixed && !/^https?:\/\//i.test(fixed) && (s.source === "kuwo" || s.kuwoId || s.rid)) {
        fixed = typeof kuwoResolvePic === "function" ? kuwoResolvePic(raw, "album") : fixed;
      }
      if (fixed && /^https?:\/\//i.test(fixed)) return fixed;
    }
    if (s.albummid) return coverUrl(s.albummid) || PLACEHOLDER;
    if (s.albumMid) return coverUrl(s.albumMid) || PLACEHOLDER;
    if (s.album_mid) return coverUrl(s.album_mid) || PLACEHOLDER;
    if (s.album && (s.album.mid || s.album.pmid)) return coverUrl(s.album.mid || s.album.pmid) || PLACEHOLDER;
    // 酷我：仅当 albummid 像路径（含 / 或非纯数字）才拼 CDN；纯数字 albumid 无效会 404
    if ((s.source === "kuwo" || s.kuwoId) && (s.albummid || s.albumId || s.ALBUMID)) {
      var aid = String(s.albummid || s.albumId || s.ALBUMID || "").trim();
      if (aid && aid !== "0" && !/^\d+$/.test(aid)) {
        var kwPic = typeof kuwoResolvePic === "function" ? kuwoResolvePic(aid, "album") : "";
        if (kwPic && !/\/albumcover\/?\d+$/i.test(kwPic)) return kwPic;
      }
    }
    return PLACEHOLDER;
  }
  function bindImg(img, song, hiRes) {
    if (!img) return;
    img.referrerPolicy = "no-referrer";
    img.loading = "lazy";
    img.decoding = "async";
    var lo = songCover(song) || PLACEHOLDER;
    var hi = hiRes ? (songCoverHi(song) || lo) : lo;
    img.onerror = function () {
      // 高清失败回退普通封面
      if (hiRes && hi && lo && this.src !== lo && lo !== PLACEHOLDER) {
        this.onerror = function () { this.onerror = null; this.src = PLACEHOLDER; };
        this.src = lo;
        return;
      }
      this.onerror = null;
      this.src = PLACEHOLDER;
    };
    img.src = hi || PLACEHOLDER;
  }

  function qLabel(q) {
    return ({ "64k": "流畅", "128k": "标准", "192k": "较高", "320k": "高品", flac: "无损", hires: "Hi-Res", master: "母带", flac24bit: "Hi-Res" })[q] || q || "—";
  }
  /** 播放页音质：只显示实际在播档位 */
  function setPlayQDisplay(actual) {
    S.playQ = actual || S.playQ || null;
    var nq = $("#npQ");
    if (!nq) return;
    nq.textContent = S.playQ ? qLabel(S.playQ) : "—";
    nq.removeAttribute("title");
  }
  /* 音质降级链：与薄荷 / LX 一致，从高到低 */
  var QUALITY_ORDER = ["master", "hires", "flac24bit", "flac", "320k", "192k", "128k", "64k"];
  function qualityRank(q) {
    var i = QUALITY_ORDER.indexOf(q);
    return i < 0 ? 999 : i; // 越小越高
  }
  function qualityFallbacks(fromQ) {
    var start = QUALITY_ORDER.indexOf(fromQ || S.quality || "flac");
    if (start < 0) start = QUALITY_ORDER.indexOf("flac");
    if (start < 0) start = 0;
    // 最多降 3 档，避免 5 次全链解析拖到半分钟
    var list = QUALITY_ORDER.slice(start, start + 3);
    // 母带\/Hi-Res 拿不到真档时必须落到无损，不能直接放弃
    if (list.indexOf("flac") < 0) list.push("flac");
    return list;
  }
  /**
   * 从真实 CDN URL 推断音质（比接口声明更可靠）。
   * QQ：M500=128 / M800=320 / F000=flac / AI00=母带
   * 念心等第三方也会走类似文件名。
   */
  function detectQualityFromUrl(url) {
    if (!url) return null;
    var u = String(url).toLowerCase();
    // 可信标记：取流成功后由本端写入（API 明确返回的档位）
    var mTag = u.match(/[?&#](?:aq_q|lx_q)=([a-z0-9_]+)/);
    if (mTag) {
      var t = mTag[1];
      if (t === "master" || t === "jymaster") return "master";
      if (t === "hires" || t === "flac24bit") return "hires";
      if (t === "flac" || t === "lossless") return "flac";
      if (t === "320k" || t === "exhigh") return "320k";
      if (t === "192k") return "192k";
      if (t === "128k" || t === "standard") return "128k";
      if (t === "64k") return "64k";
    }
    // 长青 / 念心 haitang 中转：level 参数不完全等于真实档
    var mLevel = u.match(/[?&]level=([a-z0-9_]+)/);
    if (mLevel) {
      var lv = mLevel[1];
      if (lv === "lossless" || lv === "flac") return "flac";
      if (lv === "exhigh" || lv === "320" || lv === "320k") return "320k";
      if (lv === "standard" || lv === "128" || lv === "128k") return "128k";
      if (lv === "higher") return "192k";
      // 中转自称母带/Hi-Res：保守按 flac（除非已有 aq_q 可信标记）
      if (lv === "hires" || lv === "master" || lv === "jymaster") return "flac";
    }
    if (/ai0[0-9]|aim0|jymaster|dolby|atmos/.test(u)) return "master";
    // 路径含 master 且非中转 level= 冒充
    if (/[/_-]master|master\.|quality=master/.test(u)) return "master";
    if (/hires|flac24|24bit|\.mflac|rs01|r000/.test(u)) return "hires";
    if (/f000|f0m0|\.flac(\?|$)|lossless|\/sq/.test(u)) return "flac";
    if (/m800|320k|exhigh|\/hq/.test(u)) return "320k";
    if (/m6[0-9]{2}|192k/.test(u)) return "192k";
    if (/m500|m400|128k|standard/.test(u)) return "128k";
    if (/m200|64k/.test(u)) return "64k";
    if (/\.flac(\?|$)/.test(u)) return "flac";
    if (/\.mp3(\?|$)/.test(u)) return "128k";
    return null;
  }
  /** 给播放地址打上可信音质标记（不改变 CDN 路径，仅便于本端识别） */
  function tagPlayUrl(url, q) {
    if (!url || !q) return url;
    var s = String(url).trim();
    if (!/^https?:/i.test(s)) return s;
    if (/[?&#](?:aq_q|lx_q)=/i.test(s)) return s;
    // 用 hash，避免部分 CDN 对未知 query 敏感
    if (s.indexOf("#") >= 0) return s + "&aq_q=" + encodeURIComponent(q);
    return s + "#aq_q=" + encodeURIComponent(q);
  }
  /** 各站母带/Hi-Res 能力与 API level 归一 */
  function normPlat(p) {
    p = String(p || "qq").toLowerCase();
    if (p === "wy" || p === "netease") return "netease";
    if (p === "kw" || p === "kuwo") return "kuwo";
    if (p === "kg" || p === "kugou") return "kugou";
    if (p === "mg" || p === "migu") return "migu";
    if (p === "tx") return "qq";
    if (p === "bili" || p === "bilibili" || p === "bz" || p === "b站") return "bilibili";
    return p || "qq";
  }
  /** API / 中转 level 字符串 → 本端音质档 */
  function apiLevelToPlayQ(level) {
    var lv = String(level || "").toLowerCase();
    if (!lv) return null;
    if (/jymaster|master|clear|臻品|dolby|atmos/.test(lv) && !/exhigh|standard/.test(lv)) {
      if (lv === "atmos") return "hires"; // 酷我 atmos 按 Hi-Res
      return "master";
    }
    if (/hires|2599|flac24|24bit|4000k/.test(lv)) return "hires";
    if (/lossless|flac|sq|2000k/.test(lv)) return "flac";
    if (/exhigh|320/.test(lv)) return "320k";
    if (/higher|192/.test(lv)) return "192k";
    if (/standard|128/.test(lv)) return "128k";
    if (/64/.test(lv)) return "64k";
    return null;
  }
  /** 实际音质是否达到请求档位（允许更高，不允许偷偷降成低码率） */
  function qualityMeets(actual, wanted) {
    if (!wanted) return true;
    if (!actual) return false; // 认不出就当不合格，避免假高音质
    return qualityRank(actual) <= qualityRank(wanted);
  }
  // 玉宁熙：实测仅 低品质/中品质/SQ无损/臻品母带 有效；Hi-Res 会 PHP 报错
  function ynxType(q) {
    q = q || S.quality;
    return ({
      "64k": "低品质",
      "128k": "低品质",
      "192k": "中品质",
      "320k": "中品质",
      flac: "SQ无损",
      flac24bit: "臻品母带", // 无独立 Hi-Res，用母带档
      hires: "臻品母带",
      master: "臻品母带"
    })[q] || "SQ无损";
  }
  // 念心 level：实测 master/hires 实际返回 128k MP3，统一要 lossless（真 FLAC）；
  // 拿不到更高档由外层按「母带→Hi-Res→无损」降级
  function nxLevel(q, plat) {
    q = q || S.quality;
    plat = normPlat(plat || "qq");
    var base = {
      "64k": "standard",
      "128k": "standard",
      "192k": "exhigh",
      "320k": "exhigh",
      flac: "lossless",
      // 实测：念心 QQ 的 master\/hires 实际返回 128k MP3，只有 lossless 是真 FLAC
      flac24bit: "lossless",
      hires: "lossless",
      master: "lossless"
    }[q] || "lossless";
    if (plat === "migu") {
      // 咪咕无臻品母带，母带偏好降为 hires
      if (base === "master") return "hires";
      return base;
    }
    if (plat === "kuwo") {
      // 酷我：母带/Hi-Res 均试 master（部分曲目仅到 lossless）
      return base;
    }
    if (plat === "kugou") {
      // 酷狗有 clear/master，无独立 hires 时用 master 顶
      if (base === "hires") return "master";
      return base;
    }
    // qq / netease
    return base;
  }
  function keyOf(s) { return (s.songmid || s.id || "") + "|" + (s.name || ""); }
  function sameSong(a, b) {
    if (!a || !b) return false;
    if (keyOf(a) === keyOf(b)) return true;
    var am = a.songmid || a.id || "";
    var bm = b.songmid || b.id || "";
    if (am && bm && String(am) === String(bm)) return true;
    return false;
  }
  function indexInList(list, song) {
    if (!list || !list.length || !song) return -1;
    return list.findIndex(function (x) { return sameSong(x, song); });
  }
  function fmt(t) {
    if (!isFinite(t) || t < 0) return "0:00";
    var m = Math.floor(t / 60), sec = Math.floor(t % 60);
    return m + ":" + String(sec).padStart(2, "0");
  }
  function toast(msg, ms) {
    var el = document.querySelector(".toast");
    if (!el) {
      el = document.createElement("div");
      el.className = "toast";
      document.body.appendChild(el);
    }
    el.textContent = msg || "";
    el.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.classList.remove("show"); }, ms || 2200);
  }
  function shuffle(a) {
    var x = a.slice();
    for (var i = x.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = x[i]; x[i] = x[j]; x[j] = tmp;
    }
    return x;
  }

  /* ========== JSONP（解决 QQ 接口 CORS，与原版一致） ========== */
  function jsonp(url, timeout) {
    return new Promise(function (resolve, reject) {
      var cb = "_aqjsonp_" + Date.now() + "_" + Math.floor(Math.random() * 1e6);
      var done = false;
      var timer = setTimeout(function () {
        if (done) return;
        done = true;
        cleanup();
        reject(new Error("jsonp timeout"));
      }, (timeout || 12) * 1000);
      function cleanup() {
        try { delete window[cb]; } catch (e) { window[cb] = undefined; }
        if (script && script.parentNode) script.parentNode.removeChild(script);
        clearTimeout(timer);
      }
      window[cb] = function (data) {
        if (done) return;
        done = true;
        cleanup();
        resolve(data);
      };
      var sep = url.indexOf("?") >= 0 ? "&" : "?";
      var finalUrl = url;
      if (!/[?&]callback=/.test(url) && !/[?&]jsonpCallback=/.test(url)) {
        // 歌词接口必须用 callback=，搜索等用 jsonpCallback=
        if (/lyric|fcg_query_lyric|splcloud/.test(url)) {
          finalUrl = url.replace(/([?&])format=json\b/, "$1format=jsonp") + sep + "callback=" + cb;
        } else if (/client_search_cp/.test(url)) {
          finalUrl = url.replace(/([?&])format=json\b/, "$1format=jsonp") + sep + "jsonpCallback=" + cb;
        } else {
          finalUrl = url + sep + "jsonpCallback=" + cb + "&callback=" + cb;
        }
      }
      var script = document.createElement("script");
      script.async = true;
      script.src = finalUrl;
      script.onerror = function () {
        if (done) return;
        done = true;
        cleanup();
        reject(new Error("jsonp error"));
      };
      (document.head || document.documentElement).appendChild(script);
    });
  }

  function parseLooseJson(t) {
    if (t == null) return null;
    if (typeof t !== "string") return t;
    var s = String(t).trim();
    if (!s) return null;
    try { return JSON.parse(s); } catch (e0) {}
    // 接口偶发 PHP Warning 前缀
    var i = s.indexOf("{");
    var j = s.lastIndexOf("}");
    if (i >= 0 && j > i) {
      try { return JSON.parse(s.slice(i, j + 1)); } catch (e1) {}
    }
    return { _text: s };
  }
  function reqFetch(url, opt) {
    opt = opt || {};
    // 播放解析默认 5s；显式传入可覆盖。noProxy 跳过慢代理
    var ms = (opt.timeout != null ? opt.timeout : 5) * 1000;
    var headers = Object.assign({ Accept: "application/json,text/plain,*/*" }, opt.headers || {});
    try { delete headers["User-Agent"]; delete headers["user-agent"]; } catch (eU) {}
    function doFetch(u, tms) {
      var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
      var to = setTimeout(function () {
        try { if (ctrl) ctrl.abort(); } catch (e) {}
      }, tms || ms);
      var init = {
        method: opt.method || "GET",
        headers: headers,
        mode: "cors",
        credentials: "omit",
      };
      if (opt.body != null) {
        if (typeof opt.body === "object" && !(typeof FormData !== "undefined" && opt.body instanceof FormData)) {
          if (!headers["Content-Type"] && !headers["content-type"]) {
            headers["Content-Type"] = "application/json";
          }
          init.body = typeof opt.body === "string" ? opt.body : JSON.stringify(opt.body);
        } else {
          init.body = opt.body;
        }
      }
      if (ctrl) init.signal = ctrl.signal;
      return fetch(u, init).then(function (r) {
        return r.text().then(function (t) {
          clearTimeout(to);
          var data = parseLooseJson(t);
          if (data && typeof data === "object") data._http = r.status;
          return data;
        });
      }, function (err) {
        clearTimeout(to);
        throw err;
      });
    }
    return doFetch(url, ms).catch(function () {
      if (opt.noProxy) return null;
      // 只试 1 个代理，且更短超时，避免拖到 30s+
      var pu = "https://corsproxy.io/?" + encodeURIComponent(url);
      return doFetch(pu, Math.min(ms, 4000)).catch(function () { return null; });
    }).then(function (data) {
      return data;
    }, function () {
      return null;
    });
  }


  /* ========== 规范化歌曲 ========== */
  function extractArtistName(s) {
    if (!s || typeof s !== "object") return "";
    if (s.artist && typeof s.artist === "string") return stripEm(s.artist);
    if (s.singername) return stripEm(s.singername);
    if (s.singer_name) return stripEm(s.singer_name);
    if (s.singerName) return stripEm(s.singerName);
    if (typeof s.singer === "string") return stripEm(s.singer);
    var singers = s.singer || s.singers || s.singer_list || [];
    if (Array.isArray(singers) && singers.length) {
      return singers.map(function (x) {
        if (typeof x === "string") return stripEm(x);
        return stripEm(x.name || x.singername || x.singer_name || x.singerName || x.title || "");
      }).filter(Boolean).join(" / ");
    }
    if (s.songInfo) {
      var a1 = extractArtistName(s.songInfo);
      if (a1) return a1;
    }
    if (s.track) {
      var a2 = extractArtistName(s.track);
      if (a2) return a2;
    }
    if (s.album && (s.album.singername || s.album.singer_name)) {
      return stripEm(s.album.singername || s.album.singer_name);
    }
    return "";
  }
  /** 统一解析歌曲时长（秒）：兼容秒 / 毫秒 / mm:ss */
  function songDurationSec(s) {
    if (!s || typeof s !== "object") return 0;
    var raw = s.interval != null ? s.interval
      : (s.duration != null ? s.duration
      : (s.dt != null ? s.dt
      : (s.timeLength != null ? s.timeLength
      : (s.Duration != null ? s.Duration
      : (s.DURATION != null ? s.DURATION
      : (s.songTimeMinutes != null ? s.songTimeMinutes
      : (s.time_public != null ? s.time_public
      : (s.playTime != null ? s.playTime
      : (s.timelength != null ? s.timelength
      : (s.song_play_time != null ? s.song_play_time : 0))))))))));
    if (raw == null || raw === "" || raw === 0) return 0;
    if (typeof raw === "string") {
      var str = raw.trim();
      if (/^\d+:\d{1,2}(:\d{1,2})?$/.test(str)) {
        var parts = str.split(":").map(function (x) { return parseInt(x, 10) || 0; });
        if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
        if (parts.length === 2) return parts[0] * 60 + parts[1];
      }
      var n = parseFloat(str);
      if (!isFinite(n) || n <= 0) return 0;
      raw = n;
    }
    var num = Number(raw);
    if (!isFinite(num) || num <= 0) return 0;
    // 大于 10000 按毫秒处理（网易 dt 等）
    if (num > 10000) return Math.round(num / 1000);
    return Math.round(num);
  }
  function isSongLiked(song) {
    if (!song || !S.fav) return false;
    var k = keyOf(song);
    return S.fav.some(function (x) { return keyOf(x) === k; });
  }
  function heartSvg() {
    // 与播放页 #npFav 同一路径（描边心，liked 时 fill）
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z"/></svg>';
  }
  function normSong(s) {
    if (!s) return null;
    // 展开嵌套
    if (s.songInfo && typeof s.songInfo === "object") {
      try { s = Object.assign({}, s.songInfo, s); } catch (e0) {}
    }
    if (s.track && typeof s.track === "object") {
      try { s = Object.assign({}, s.track, s); } catch (e1) {}
    }
    var amid = s.albummid || s.albumMid || s.album_mid || s.albumPmid ||
      (s.album && (s.album.mid || s.album.pmid || s.album.albumMid || s.album.albummid)) || "";
    var artist = extractArtistName(s);
    var name = stripEm(s.title || s.name || s.songname || s.songName || s.song_name || s.song_title || "");
    var mid = s.mid || s.songmid || s.songMid || s.media_mid || s.song_mid || s.song_id || "";
    if (!name || !mid) return null;
    mid = String(mid);
    var cover = s.cover || s.pic || s.albumPic || s.album_pic || s.picurl || "";
    if (!cover && amid) cover = coverUrl(amid);
    var iv = songDurationSec(s);
    return {
      name: name,
      artist: artist || "未知",
      songmid: mid,
      albummid: amid,
      albumMid: amid,
      album: (s.album && (s.album.name || s.album.title)) || s.albumname || s.albumName || s.album_name || "",
      cover: cover ? fixCover(cover) : (amid ? coverUrl(amid) : ""),
      interval: iv,
      source: s.source || "qq",
    };
  }

  function stripEm(s) {
    if (s == null) return "";
    return String(s)
      .replace(/<\/?em>/gi, "")
      .replace(/<\/?b>/gi, "")
      .replace(/<\/?span[^>]*>/gi, "")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .trim();
  }
  function normPlaylist(p) {
    if (!p || typeof p !== "object") return null;
    // 展开 basic / doc 嵌套
    if (p.basic && typeof p.basic === "object") {
      try { p = Object.assign({}, p, p.basic); } catch (e) {}
    }
    if (p.doc && typeof p.doc === "object") {
      try { p = Object.assign({}, p, p.doc); } catch (e2) {}
    }
    var rawId = p.dissid || p.disstid || p.diss_id || p.tid || p.content_id || p.docid || p.id || "";
    var id = String(rawId).replace(/^0+(?=\d)/, "");
    var title = stripEm(p.dissname || p.title || p.name || p.diss_name || p.songlist_name || "");
    var cover = p.imgurl || p.logo || p.cover || p.pic || p.picurl || p.pic_url || p.cover_url || "";
    if (cover) cover = fixCover(cover);
    if (!id || !title) return null;
    return {
      id: id,
      name: title,
      cover: cover,
      listen: p.listennum || p.listen_num || p.listen_count || 0,
      type: "playlist",
    };
  }

  /* ========== QQ musicu.fcg 统一搜索（2024 后 client_search_cp 已 500 失效） ==========
   * 关键：comm 必须用 {ct:19, cv:1859}，旧的 {ct:24, cv:0} 会被静默返回空列表。
   * musicu.fcg 原生支持 JSONP（&callback=），网页可直连无需 CORS 代理。 */
  function musicuSearch(kw, page, searchType) {
    var payload = {
      comm: { ct: 19, cv: 1859, uin: 0, format: "json", platform: "yqq.json", needNewCode: 0 },
      req_1: {
        method: "DoSearchForQQMusicDesktop",
        module: "music.search.SearchCgiService",
        param: {
          query: kw,
          num_per_page: 30,
          page_num: page || 1,
          search_type: searchType == null ? 0 : searchType,
        },
      },
    };
    var url = "https://u.y.qq.com/cgi-bin/musicu.fcg?data=" + encodeURIComponent(JSON.stringify(payload));
    return jsonp(url, 10);
  }

  /* ========== QQ 搜索（musicu.fcg JSONP 优先；原生桥兜底） ========== */
  async function searchQQ(kw, page) {
    if (!kw) return [];
    page = page || 1;
    var list = [];

    // 1) musicu.fcg JSONP（client_search_cp 已失效，不再尝试）
    try {
      var data = await musicuSearch(kw, page, 0);
      var raw = (data && data.req_1 && data.req_1.data && data.req_1.data.body && data.req_1.data.body.song && data.req_1.data.body.song.list) || [];
      list = raw.map(normSong).filter(Boolean);
    } catch (e) {
      console.warn("musicu search fail", e);
    }

    // 2) 原生桥（Scripting WebView 注入的 __nativeSearchQQ）
    if (!list.length && typeof window.__nativeSearchQQ === "function") {
      try {
        list = await window.__nativeSearchQQ(kw, page);
      } catch (e3) {}
    }

    return list;
  }

  /* ========== 多站源搜索（完整抄自 qqmusci-patched：ADAPTER + JSONP） ========== */
  /**
   * 对齐 ADAPTER_request：
   * 1) 有 window.fm.req → 原生请求（无 CORS）
   * 2) GET 优先 JSONP（酷我/酷狗 songsearch 都靠这个）
   * 3) 失败再 fetch + 公共 CORS 代理
   */
  /**
   * WebToApp (GeckoView) / FongMi / 自研壳 统一原生 HTTP
   * Apple Music_1.0.3.apk = WebToApp 打包：开启 CORS bypass 后
   *   - window.__wta_gecko_bridge_installed__ / __wtaSendNative
   *   - window.fetch / XHR 已被 OkHttp 劫持
   */
  function normalizeNativeBody(res) {
    if (res == null) return "";
    if (typeof res === "string") return res;
    if (typeof res === "number" || typeof res === "boolean") return String(res);
    if (typeof res === "object") {
      if (typeof res.body === "string") return res.body;
      if (typeof res.data === "string") return res.data;
      if (typeof res.text === "string") return res.text;
      if (res.bodyBase64 != null) {
        try {
          return decodeURIComponent(escape(atob(String(res.bodyBase64))));
        } catch (e0) {
          try { return atob(String(res.bodyBase64)); } catch (e1) { return ""; }
        }
      }
      if (res.data != null && typeof res.data === "object") {
        try { return JSON.stringify(res.data); } catch (e2) {}
      }
      if (typeof res.result === "string") return res.result;
      try { return JSON.stringify(res); } catch (e3) { return ""; }
    }
    return String(res);
  }

  function isWebToAppBridge() {
    try {
      // 仅当真有桥注入时算 WebToApp 原生能力（不要仅凭 UA 误判）
      if (window.__wta_gecko_bridge_installed__) return true;
      if (typeof window.__wtaSendNative === "function") return true;
      var scope = window.__wta_private_network_scope__;
      if (scope === "CORS_BYPASS" || scope === "PRIVATE_NETWORK" || scope === "LOCAL_ONLY") return true;
    } catch (e) {}
    return false;
  }

  /** 是否具备多站源能力（有原生 HTTP 桥，或 FongMi/TVBox 等已知壳）→ 才显示站源切换 */
  function canShowPlatformSwitch() {
    try {
      try {
        var force = localStorage.getItem("aq_force_multi");
        if (force === "1" || force === "true") return true;
        if (force === "0" || force === "false") return false;
      } catch (eF) {}
      // 真桥：WebToApp / AQNative / FongMi / Android / Capacitor / Cordova
      if (typeof hasNativeHttpBridge === "function" && hasNativeHttpBridge()) return true;
      if (window.AQNative && (typeof window.AQNative.request === "function" || typeof window.AQNative.req === "function" || typeof window.AQNative.http === "function")) return true;
      if (window.fm && (typeof window.fm.req === "function" || typeof window.fm.request === "function" || typeof window.fm.http === "function")) return true;
      if (window.Fm && (typeof window.Fm.req === "function" || typeof window.Fm.request === "function")) return true;
      if (window.android && (typeof window.android.req === "function" || typeof window.android.request === "function" || typeof window.android.http === "function")) return true;
      if (window.Android && (typeof window.Android.req === "function" || typeof window.Android.request === "function" || typeof window.Android.http === "function")) return true;
      if (window.webkit && window.webkit.messageHandlers && (window.webkit.messageHandlers.aqHttp || window.webkit.messageHandlers.http)) return true;
      if (window.Capacitor && window.Capacitor.Plugins && (window.Capacitor.Plugins.CapacitorHttp || window.Capacitor.Plugins.Http)) return true;
      if (typeof window.cordova !== "undefined" && window.cordova.plugin && window.cordova.plugin.http) return true;
      // 已知壳 UA（桥可能稍晚注入，先显示切换）
      var ua = navigator.userAgent || "";
      if (/FongMi|FMApp|fmapp|TVBox|CatVod|影视仓|OKHttp|okhttp|WebToApp/i.test(ua)) return true;
    } catch (e) {}
    return false;
  }

  function hasNativeHttpBridge() {
    try {
      if (isWebToAppBridge()) return true;
      if (window.AQNative && (typeof window.AQNative.request === "function" || typeof window.AQNative.req === "function" || typeof window.AQNative.http === "function")) return true;
      if (window.fm && (typeof window.fm.req === "function" || typeof window.fm.request === "function" || typeof window.fm.http === "function")) return true;
      if (window.Fm && (typeof window.Fm.req === "function" || typeof window.Fm.request === "function")) return true;
      if (window.android && (typeof window.android.req === "function" || typeof window.android.request === "function" || typeof window.android.http === "function")) return true;
      if (window.Android && (typeof window.Android.req === "function" || typeof window.Android.request === "function" || typeof window.Android.http === "function")) return true;
      if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.aqHttp) return true;
      if (window.Capacitor && window.Capacitor.Plugins && (window.Capacitor.Plugins.CapacitorHttp || window.Capacitor.Plugins.Http)) return true;
      if (typeof window.cordova !== "undefined" && window.cordova.plugin && window.cordova.plugin.http) return true;
    } catch (e) {}
    return false;
  }

  function callMaybePromise(fn, args) {
    return Promise.resolve()
      .then(function () { return fn.apply(null, args || []); })
      .then(normalizeNativeBody);
  }

  function nativeHttpRequest(url, opts) {
    opts = opts || {};
    var method = (opts.method || "GET").toUpperCase();
    var headers = opts.headers || {};
    var body = opts.body;
    if (body != null && typeof body !== "string") {
      try { body = JSON.stringify(body); } catch (e) { body = String(body); }
    }
    var timeout = opts.timeout || 30;
    var payload = {
      url: url,
      method: method,
      headers: headers,
      body: body || "",
      timeout: timeout,
      responseType: "text",
      credentials: opts.credentials || "omit",
    };

    var chain = [];

    // 0) WebToApp GeckoView
    try {
      if (typeof window.__wtaSendNative === "function") {
        chain.push(function () {
          function toB64(s) {
            try { return btoa(unescape(encodeURIComponent(String(s || "")))); }
            catch (e) { try { return btoa(String(s || "")); } catch (e2) { return ""; } }
          }
          function fromB64(b64) {
            try { return decodeURIComponent(escape(atob(String(b64 || "")))); }
            catch (e) { try { return atob(String(b64 || "")); } catch (e2) { return ""; } }
          }
          var msg = JSON.stringify({
            url: url,
            method: method || "GET",
            headers: headers || {},
            bodyBase64: body ? toB64(body) : "",
          });
          return Promise.resolve(window.__wtaSendNative(msg)).then(function (raw) {
            if (raw == null) return "";
            if (typeof raw === "object") {
              if (raw.bodyBase64 != null) return fromB64(raw.bodyBase64);
              if (raw.body != null) return String(raw.body);
              return normalizeNativeBody(raw);
            }
            var s = String(raw);
            try {
              var o = JSON.parse(s);
              if (o && o.bodyBase64 != null) return fromB64(o.bodyBase64);
              if (o && o.body != null) return String(o.body);
            } catch (eP) {}
            return s;
          });
        });
      } else if (isWebToAppBridge()) {
        // fetch 已被 content_script 劫持到 OkHttp
        chain.push(function () {
          return fetch(url, {
            method: method || "GET",
            headers: headers || {},
            body: (method === "GET" || method === "HEAD") ? undefined : (body || undefined),
            credentials: "omit",
            mode: "cors",
          }).then(function (r) { return r.text(); }).catch(function () { return ""; });
        });
      }
    } catch (eWta) {}

    // 1) AQNative
    try {
      var aq = window.AQNative;
      if (aq) {
        if (typeof aq.request === "function") chain.push(function () { return callMaybePromise(aq.request.bind(aq), [payload]); });
        if (typeof aq.req === "function") chain.push(function () { return callMaybePromise(aq.req.bind(aq), [url, payload]); });
        if (typeof aq.http === "function") chain.push(function () { return callMaybePromise(aq.http.bind(aq), [payload]); });
      }
    } catch (eAq) {}

    // 2) FongMi
    try {
      var fm = window.fm || window.Fm;
      if (fm) {
        if (typeof fm.req === "function") chain.push(function () { return callMaybePromise(fm.req.bind(fm), [url, payload]); });
        if (typeof fm.request === "function") chain.push(function () { return callMaybePromise(fm.request.bind(fm), [url, payload]); });
        if (typeof fm.http === "function") chain.push(function () { return callMaybePromise(fm.http.bind(fm), [payload]); });
      }
    } catch (eFm) {}

    // 3) Android interface
    function androidBridge(obj) {
      if (!obj) return;
      function wrap(fn, mode) {
        return function () {
          return Promise.resolve().then(function () {
            var out;
            try {
              if (mode === "url_opts") out = fn.call(obj, url, JSON.stringify(payload));
              else if (mode === "json") out = fn.call(obj, JSON.stringify(payload));
              else out = fn.call(obj, url);
            } catch (e) { return ""; }
            if (out == null) return "";
            return normalizeNativeBody(out);
          });
        };
      }
      if (typeof obj.req === "function") chain.push(wrap(obj.req, "url_opts"));
      if (typeof obj.request === "function") chain.push(wrap(obj.request, "json"));
      if (typeof obj.http === "function") chain.push(wrap(obj.http, "json"));
    }
    try { androidBridge(window.android); } catch (eA1) {}
    try { androidBridge(window.Android); } catch (eA2) {}

    // 4.5) iOS Scripting WebView 推送模式桥：__aqHttpPush（原生 fetch，无 CORS；返回值经 evaluateJavaScript 推回）
    try {
      if (typeof window.__aqHttpPush === "function") {
        chain.push(function () {
          return Promise.resolve(window.__aqHttpPush(url, { method: method, headers: headers, body: body || "", timeout: timeout }))
            .then(function (t) { return t || ""; })
            .catch(function () { return ""; });
        });
      }
    } catch (ePush) {}

    // 5) Capacitor
    try {
      var plugins = window.Capacitor && window.Capacitor.Plugins;
      var capHttp = plugins && (plugins.CapacitorHttp || plugins.Http);
      if (capHttp && typeof capHttp.request === "function") {
        chain.push(function () {
          return capHttp.request({
            url: url,
            method: method,
            headers: headers,
            data: body || undefined,
            connectTimeout: timeout * 1000,
            readTimeout: timeout * 1000,
            responseType: "text",
          }).then(function (r) {
            if (!r) return "";
            if (typeof r.data === "string") return r.data;
            if (r.data != null) {
              try { return typeof r.data === "string" ? r.data : JSON.stringify(r.data); } catch (e) { return String(r.data); }
            }
            return normalizeNativeBody(r);
          });
        });
      }
    } catch (eCap) {}

    if (!chain.length) return Promise.resolve("");

    return chain.reduce(function (prev, fn) {
      return prev.then(function (got) {
        if (got && String(got).length > 0) return got;
        return Promise.resolve().then(function () { return fn(); }).catch(function () { return ""; });
      });
    }, Promise.resolve(""));
  }

  function adapterRequest(url, opts) {
    opts = opts || {};
    var method = (opts.method || "GET").toUpperCase();
    var headers = opts.headers || {};
    var body = opts.body;
    if (body != null && typeof body !== "string") {
      try { body = JSON.stringify(body); } catch (e) { body = String(body); }
    }

    // 有原生桥（含 WebToApp CORS bypass）→ 优先原生，无 CORS
    if (hasNativeHttpBridge()) {
      return nativeHttpRequest(url, opts).then(function (t) {
        if (t && String(t).length > 0) return t;
        return browserRequestFallback(url, opts, method, headers, body);
      });
    }
    return browserRequestFallback(url, opts, method, headers, body);
  }

  function browserRequestFallback(url, opts, method, headers, body) {
    method = method || (opts && opts.method) || "GET";
    method = String(method).toUpperCase();
    headers = headers || (opts && opts.headers) || {};
    body = body != null ? body : (opts && opts.body);
    if (body != null && typeof body !== "string") {
      try { body = JSON.stringify(body); } catch (e) { body = String(body); }
    }
    if (method === "POST") {
      return fetch(url, { method: "POST", headers: headers, body: body, mode: "cors", credentials: "omit" })
        .then(function (r) { return r.text(); })
        .catch(function () { return ""; });
    }
    var forcePlain = /msearch(cdn)?\.kugou\.com/i.test(url)
      || /mobileservice\.kugou\.com/i.test(url)
      || /mobilecdn(bj)?\.kugou\.com/i.test(url)
      || /complexsearch\.kugou\.com/i.test(url)
      || /gateway\.kugou\.com/i.test(url)
      || /nplserver\.kuwo\.cn/i.test(url)
      || /wapi\.kuwo\.cn\/api\/www\/playlist/i.test(url)
      || /pd\.musicapp\.migu\.cn/i.test(url)
      || /music\.163\.com\/api\//i.test(url)
      || /search\.kuwo\.cn/i.test(url)
      || /kuwo\.cn\/r\.s/i.test(url);
    function viaProxy() {
      var proxies = [
        "https://api.allorigins.win/raw?url=",
        "https://api.codetabs.com/v1/proxy?quest=",
        "https://corsproxy.io/?",
      ];
      function one(i) {
        if (i >= proxies.length) return Promise.resolve("");
        return fetch(proxies[i] + encodeURIComponent(url), { method: "GET", mode: "cors", credentials: "omit" })
          .then(function (r) { return r.text(); })
          .then(function (t) {
            if (!t) return one(i + 1);
            var s = String(t).trim();
            if (/^[[{]/.test(s) || s.indexOf("abslist") >= 0 || s.indexOf("result") >= 0 || s.indexOf("data") >= 0)
              return s;
            return one(i + 1);
          })
          .catch(function () { return one(i + 1); });
      }
      return one(0);
    }
    if (forcePlain) {
      return fetch(url, { method: "GET", headers: headers, mode: "cors", credentials: "omit" })
        .then(function (r) { return r.text(); })
        .then(function (t) {
          if (t && /^[\s]*[[{]/.test(t)) return t;
          return viaProxy();
        })
        .catch(function () { return viaProxy(); });
    }
    return jsonpRequest(url, ((opts && opts.timeout) || 12) * 1000)
      .catch(function () {
        return fetch(url, { method: "GET", headers: headers, mode: "cors", credentials: "omit" })
          .then(function (r) { return r.text(); })
          .catch(function () { return viaProxy(); });
      });
  }

  function parseSearchBody(txt) {
    if (txt == null || txt === "") return null;
    if (typeof txt === "object") return txt;
    var s = String(txt).trim();
    if (!s) return null;
    // 已是对象字符串 / JSONP 外壳
    var d = null;
    try { d = JSON.parse(s); if (d) return d; } catch (e0) {}
    try { d = JSON.parse(s.replace(/'/g, '"')); if (d) return d; } catch (e1) {}
    var m = /\(([\s\S]*)\)\s*;?\s*$/.exec(s);
    if (m) {
      try { return JSON.parse(m[1]); } catch (e2) {}
      try { return JSON.parse(m[1].replace(/'/g, '"')); } catch (e3) {}
    }
    var i = s.indexOf("{");
    var j = s.lastIndexOf("}");
    if (i >= 0 && j > i) {
      var slice = s.slice(i, j + 1);
      try { return JSON.parse(slice); } catch (e4) {}
      try { return JSON.parse(slice.replace(/'/g, '"')); } catch (e5) {}
    }
    return null;
  }
  function kuwoResolvePic(raw, baseHint) {
    if (!raw) return "";
    var pic = String(raw).trim().replace(/^["']|["']$/g, "");
    if (!pic || pic === "null" || pic === "undefined") return "";
    if (pic.indexOf("//") === 0) pic = "https:" + pic;
    if (/^https?:\/\//i.test(pic)) return pic.replace(/^http:/i, "https:");
    pic = pic.replace(/^\/+/, "");
    var base = "https://img1.kuwo.cn/star/albumcover/";
    if (baseHint && String(baseHint).indexOf("http") === 0) {
      base = String(baseHint).replace(/\/?$/, "/");
    } else {
      var kind = String(baseHint || "album").toLowerCase();
      if (kind === "artist" || kind.indexOf("starheads") >= 0) base = "https://img1.kuwo.cn/star/starheads/";
      else if (kind === "playlist" || kind.indexOf("userpl") >= 0) base = "https://img1.kuwo.cn/star/userpl2015/";
    }
    return (base + pic).replace(/^http:/i, "https:");
  }
  function parseKuwoBody(txt) {
    if (!txt) return null;
    if (typeof txt === "object") return txt;
    txt = String(txt).trim();
    var d = parseSearchBody(txt);
    if (d) return d;
    try { return JSON.parse(txt); } catch (e) {}
    try { return JSON.parse(txt.replace(/'/g, '"')); } catch (e2) {}
    return null;
  }

  /* —— 网易云（对齐 API.neteaseSearch：搜索后 song/detail 补封面）—— */
  async function searchNetease(kw, page) {
    if (!kw) return [];
    page = page || 1;
    var offset = (page - 1) * 20;
    var hdr = { Referer: "https://music.163.com/" };
    var songUrl = "https://music.163.com/api/search/get?s=" + encodeURIComponent(kw) +
      "&type=1&limit=20&offset=" + offset;
    try {
      var txt = await adapterRequest(songUrl, { headers: hdr, timeout: 5 });
      var d = parseSearchBody(txt);
      var songs = (d && d.result && d.result.songs) || [];
      var list = songs.map(function (s) {
        var artists = (s.artists || s.ar || []).map(function (a) { return a.name; }).filter(Boolean).join(" / ");
        var album = (s.album && s.album.name) || (s.al && s.al.name) || "";
        var pic = (s.album && (s.album.picUrl || s.album.blurPicUrl)) ||
          (s.al && (s.al.picUrl || s.al.blurPicUrl)) || "";
        var id = String(s.id || "");
        if (!id || !s.name) return null;
        return {
          name: stripEm(s.name || ""),
          artist: artists || "未知",
          songmid: id,
          id: id,
          albummid: String((s.album && s.album.id) || (s.al && s.al.id) || ""),
          album: album,
          cover: pic ? fixCover(String(pic).replace(/^http:/, "https:")) : "",
          interval: Math.round(((s.duration || s.dt || 0) / 1000)) || 0,
          source: "netease",
          neteaseId: id,
        };
      }).filter(Boolean);

      // 搜索接口常无 picUrl，与 patched fillCovers 一样再拉详情补封面
      var needCover = list.filter(function (s) { return !s.cover; });
      if (needCover.length) {
        try {
          var ids = list.map(function (s) { return s.neteaseId; }).join(",");
          var detailUrl = "https://music.163.com/api/song/detail/?ids=[" + ids + "]";
          var txt2 = await adapterRequest(detailUrl, { headers: hdr, timeout: 5 });
          var d2 = parseSearchBody(txt2);
          var details = (d2 && d2.songs) || [];
          var map = {};
          details.forEach(function (ds) {
            var pic2 = (ds.album && (ds.album.picUrl || ds.album.blurPicUrl)) ||
              (ds.al && (ds.al.picUrl || ds.al.blurPicUrl)) || "";
            if (pic2) map[String(ds.id)] = fixCover(String(pic2).replace(/^http:/, "https:"));
            var al = (ds.album && ds.album.name) || (ds.al && ds.al.name) || "";
            if (al) map[String(ds.id) + "_al"] = al;
            // 无 picUrl 时用 pic 数字拼 CDN（网易常见）
            if (!pic2 && ds.album && ds.album.pic) {
              try {
                var picId = String(ds.album.pic);
                if (/^\d+$/.test(picId) && picId !== "0") {
                  map[String(ds.id)] = "https://p1.music.126.net/" + picId + ".jpg";
                }
              } catch (ePic) {}
            }
          });
          list.forEach(function (s) {
            if (map[s.neteaseId]) s.cover = map[s.neteaseId];
            if ((!s.album || s.album === "") && map[s.neteaseId + "_al"]) s.album = map[s.neteaseId + "_al"];
          });
        } catch (eFill) {
          console.warn("netease fillCovers fail", eFill);
        }
      }
      return list;
    } catch (e) {
      console.warn("searchNetease fail", e);
      return [];
    }
  }

  /* —— 酷我（完整抄 API.kuwoSearch + _mapKuwoList + _parseKuwoBody）—— */
  function mapKuwoList(list) {
    return (list || []).map(function (it) {
      if (!it) return null;
      var rid = String(it.MUSICRID || it.musicrid || it.rid || it.DC_TARGETID || it.id || "")
        .replace(/^MUSIC_/i, "").trim();
      var name = String(it.SONGNAME || it.NAME || it.name || it.songname || it.N || "")
        .replace(/&nbsp;/g, " ").trim();
      var artist = String(it.ARTIST || it.artist || it.ARTISTNAME || it.artistname || "")
        .replace(/&nbsp;/g, " ").trim();
      var album = String(it.ALBUM || it.album || "").replace(/&nbsp;/g, " ").trim();
      var dur = parseInt(it.DURATION || it.duration || it.songTimeMinutes || 0, 10) || 0;
      var pic = it.albumpic || it.hts_albumpic || it.web_albumpic_short || it.pic || it.pic120 ||
        it.img || it.hts_MVPIC || it.MVPIC || it.web_artistpic_short || it.artistpic || "";
      pic = kuwoResolvePic(pic);
      if (pic) pic = String(pic).replace(/\/120\//g, "/500/").replace(/_150\./g, "_500.");
      if (!rid || !name) return null;
      return {
        name: stripEm(name),
        artist: stripEm(artist) || "未知",
        songmid: rid,
        id: rid,
        rid: rid,
        albummid: String(it.ALBUMID || it.albumid || it.albumId || ""),
        album: stripEm(album),
        cover: pic ? fixCover(pic) : "",
        interval: dur,
        source: "kuwo",
      };
    }).filter(Boolean);
  }
  async function searchKuwo(kw, page) {
    if (!kw) return [];
    page = page || 1;
    var pn = Math.max(0, page - 1);
    var hdr = {
      Referer: "https://www.kuwo.cn/",
      Accept: "application/json, text/plain, */*",
    };
    // 与 patched API.kuwoSearch 完全相同的两个 URL
    var songUrls = [
      "https://search.kuwo.cn/r.s?all=" + encodeURIComponent(kw) +
        "&ft=music&rn=30&pn=" + pn + "&rformat=json&encoding=utf8&mobi=1&vipver=1",
      "https://search.kuwo.cn/r.s?all=" + encodeURIComponent(kw) +
        "&ft=music&itemset=web_2013&client=kt&pn=" + pn + "&rn=30&rformat=json&encoding=utf8",
    ];
    for (var i = 0; i < songUrls.length; i++) {
      try {
        var txt = await adapterRequest(songUrls[i], { headers: hdr, timeout: 5 });
        var d = parseSearchBody(txt);
        var list = (d && d.abslist) || (d && d.data && d.data.list) || (d && d.data && d.data.abslist) || [];
        var mapped = mapKuwoList(list);
        if (mapped.length) return mapped;
      } catch (e) {
        console.warn("searchKuwo try", i, e);
      }
    }
    return [];
  }

  /* —— 酷狗（完整抄 API.kugouSearch：songsearch JSONP 优先）—— */
  async function searchKugou(kw, page) {
    if (!kw) return [];
    page = page || 1;
    var hdr = {
      Referer: "https://www.kugou.com/",
      Accept: "application/json, text/plain, */*",
    };
    // patched：songsearch 支持 JSONP；mobilecdn 需代理
    var urls = [
      "https://songsearch.kugou.com/song_search_v2?keyword=" +
        encodeURIComponent(kw) + "&page=" + page + "&pagesize=30&userid=-1&clientver=&platform=WebFilter&filter=2&iscorrection=1&privilege_filter=0&format=jsonp",
      "https://mobilecdn.kugou.com/api/v3/search/song?format=json&keyword=" +
        encodeURIComponent(kw) + "&page=" + page + "&pagesize=30&showtype=1",
      "https://mobilecdnbj.kugou.com/api/v3/search/song?format=json&keyword=" +
        encodeURIComponent(kw) + "&page=" + page + "&pagesize=30&showtype=1",
    ];
    function pickList(d) {
      if (!d) return [];
      return (d.data && (d.data.info || d.data.lists || d.data.list)) || d.lists || d.info || d.list || [];
    }
    function mapOne(it) {
      if (!it) return null;
      var hash = (it.FileHash || it.filehash || it.HQFileHash || it.hash || it.Hash || "").toLowerCase();
      var name = stripEm(String(it.SongName || it.songname || it.songName || it.name || "").replace(/<[^>]+>/g, ""));
      var singer = stripEm(String(it.SingerName || it.singername || it.singerName || it.choricSinger || it.singer || "").replace(/<[^>]+>/g, ""));
      var album = stripEm(String(it.AlbumName || it.album_name || it.albumName || "").replace(/<[^>]+>/g, ""));
      var dur = Number(it.Duration || it.duration || it.timeLength || 0) || 0;
      if (dur > 10000) dur = Math.round(dur / 1000);
      var img = it.img || it.Image || it.album_img || (it.trans_param && it.trans_param.union_cover) || "";
      if (img) img = String(img).replace(/\{size\}/g, "240").replace(/^http:/, "https:");
      if (!hash || !name) return null;
      return {
        name: name,
        artist: singer || "未知",
        songmid: hash,
        id: hash,
        hash: hash,
        albummid: "",
        album: album,
        cover: img ? fixCover(img) : "",
        interval: dur,
        source: "kugou",
      };
    }
    for (var i = 0; i < urls.length; i++) {
      try {
        var txt = await adapterRequest(urls[i], { headers: hdr, timeout: 5 });
        var d = parseSearchBody(txt);
        var mapped = pickList(d).map(mapOne).filter(Boolean);
        if (mapped.length) return mapped;
      } catch (e) {
        console.warn("searchKugou try", i, e);
      }
    }
    return [];
  }

  /* —— 咪咕（完整抄 API.miguSearch：pd.musicapp.migu.cn）—— */
  async function searchMigu(kw, page) {
    if (!kw) return [];
    page = page || 1;
    var hdr = {
      Referer: "https://music.migu.cn/",
      Accept: "application/json, text/plain, */*",
    };
    var url = "https://pd.musicapp.migu.cn/MIGUM3.0/v1.0/content/search_all.do?text=" +
      encodeURIComponent(kw) + "&pageNo=" + page + "&pageSize=30&searchSwitch=" +
      encodeURIComponent('{"song":1,"album":0,"singer":0,"tagSong":0,"mvSong":0,"songlist":0,"bestShow":0}');
    try {
      var txt = await adapterRequest(url, { headers: hdr, timeout: 5 });
      var d = parseSearchBody(txt);
      var songResult = (d && d.songResultData && d.songResultData.result) ||
        (d && d.data && d.data.songResultData && d.data.songResultData.result) || [];
      return (songResult || []).map(function (s) {
        if (!s) return null;
        var mid = String(s.copyrightId || s.songId || s.contentId || s.id || "");
        var name = stripEm(s.songName || s.name || s.title || "");
        var artists = s.singerList || s.singers || s.singerName || [];
        var artist = "";
        if (Array.isArray(artists)) {
          artist = artists.map(function (a) {
            return (a && (a.name || a.singerName || a)) || "";
          }).filter(Boolean).join(" / ");
        } else {
          artist = String(artists || "");
        }
        var album = stripEm(s.albumName || s.album || "");
        var pic = "";
        var imgs = s.imgItems || s.imgs || s.albumImgItems || [];
        if (Array.isArray(imgs) && imgs.length) {
          pic = imgs[0].img || imgs[0].url || imgs[0].pic || "";
        }
        pic = pic || s.cover || s.pic || s.imgUrl || s.albumPic || "";
        if (pic) pic = String(pic).replace(/^http:/, "https:");
        if (!mid || !name) return null;
        return {
          name: name,
          artist: stripEm(artist) || "未知",
          songmid: mid,
          id: mid,
          // 念心/其它源可能认不同字段，全部保留
          copyrightId: String(s.copyrightId || ""),
          contentId: String(s.contentId || ""),
          miguSongId: String(s.songId || s.id || ""),
          albummid: "",
          album: album,
          cover: pic ? fixCover(pic) : "",
          interval: 0,
          source: "migu",
        };
      }).filter(Boolean);
    } catch (e) {
      console.warn("searchMigu fail", e);
      return [];
    }
  }


  /* ========== B站（Bilibili）搜索 / 播放 —— 接口对齐 NeriPlayer / 官方 API ========== */
  function stripBiliHtml(s) {
    return String(s || "").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').trim();
  }
  function biliDurationSec(dur) {
    if (dur == null) return 0;
    if (typeof dur === "number") return dur;
    var s = String(dur).trim();
    if (/^\d+$/.test(s)) return parseInt(s, 10) || 0;
    var parts = s.split(":").map(function (x) { return parseInt(x, 10) || 0; });
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return 0;
  }
  function biliCover(pic) {
    if (!pic) return "";
    var p = String(pic);
    if (p.indexOf("//") === 0) p = "https:" + p;
    if (p.indexOf("http://") === 0) p = "https://" + p.slice(7);
    return p;
  }
  async function searchBilibili(kw, page) {
    if (!kw) return [];
    page = page || 1;
    var BILI_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
    var hdr = {
      "User-Agent": BILI_UA,
      "Referer": "https://search.bilibili.com/",
      "Origin": "https://search.bilibili.com",
      "Accept": "application/json, text/plain, */*",
    };

    function mapItem(it) {
      if (!it) return null;
      var bvid = it.bvid || it.bvid_id || "";
      var aid = it.aid || it.id || "";
      if (!bvid && !aid) return null;
      var title = stripBiliHtml(it.title || it.name || "");
      if (!title) return null;
      var author = stripBiliHtml(
        it.author ||
        (it.owner && (it.owner.name || it.owner.uname)) ||
        it.upic || it.up || it.uname || it.username || ""
      ) || "UP主";
      var pic = biliCover(it.pic || it.cover || (it.owner && it.owner.face) || "");
      var mid = bvid || ("av" + aid);
      var cid = it.cid || 0;
      return {
        name: title,
        artist: author,
        singer: author,
        singername: author,
        album: (function () {
          var base = stripBiliHtml(it.typename || it.tname || "") || "B站";
          var sec = biliDurationSec(it.duration || it.length || 0);
          if (sec >= 30 * 60) return "可能含多集 · 点击展开";
          return base;
        })(),
        songmid: "bv_" + mid + (cid ? ("_" + cid) : ""),
        mid: mid,
        id: mid,
        bvid: bvid || "",
        aid: aid ? String(aid) : "",
        cid: cid || 0,
        cover: pic,
        duration: biliDurationSec(it.duration || it.length || 0),
        source: "bilibili",
        platform: "bilibili",
        upMid: (it.mid != null ? String(it.mid) : "") || (it.owner && it.owner.mid != null ? String(it.owner.mid) : "") || "",
      };
    }

    function parsePayload(txt) {
      var list = [];
      if (!txt) return list;
      var d = null;
      try {
        if (typeof txt === "object") d = txt;
        else d = parseSearchBody(txt) || parseLooseJson(txt) || JSON.parse(String(txt));
      } catch (e0) {
        try { d = parseLooseJson(txt); } catch (e1) { d = null; }
      }
      if (!d) return list;
      // 若被风控返回 HTML，code 不存在
      if (typeof d.code === "number" && d.code !== 0) {
        console.warn("[bili] search code", d.code, d.message || "");
      }
      var data = d.data || {};
      var rows = [];
      if (Array.isArray(data.result)) {
        // type 搜索：直接数组；all/v2：分栏
        if (data.result.length && data.result[0] && (data.result[0].result_type || data.result[0].resultType)) {
          data.result.forEach(function (blk) {
            if (blk && (blk.result_type === "video" || blk.resultType === "video") && Array.isArray(blk.data)) {
              rows = rows.concat(blk.data);
            }
          });
        } else {
          rows = data.result;
        }
      } else if (Array.isArray(data.list)) {
        rows = data.list;
      }
      var seen = {};
      rows.forEach(function (it) {
        var m = mapItem(it);
        if (!m) return;
        var key = m.bvid || m.aid;
        if (seen[key]) return;
        seen[key] = 1;
        list.push(m);
      });
      return list;
    }

    // 1) 非 WBI type 搜索（与参考 HTML _biliSearchPlain 一致）
    // 优先 WBI（无完整签名多数环境仍可用）；非 WBI 常 412 风控
    var urls = [
      "https://api.bilibili.com/x/web-interface/wbi/search/type?search_type=video&keyword=" +
        encodeURIComponent(kw) + "&page=" + page + "&page_size=20&platform=pc",
      "https://api.bilibili.com/x/web-interface/search/all/v2?keyword=" +
        encodeURIComponent(kw) + "&page=" + page + "&pagesize=20",
      "https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=" +
        encodeURIComponent(kw) + "&page=" + page +
        "&page_size=20&order=&duration=&tids_1=&tids_2=&__refresh__=true&highlight=1&single_column=0&platform=pc",
    ];

    for (var ui = 0; ui < urls.length; ui++) {
      try {
        var txt = await adapterRequest(urls[ui], { headers: hdr, timeout: 12 });
        // adapter 失败再试 reqFetch（带 corsproxy）
        if (!txt || String(txt).length < 20) {
          var data2 = await reqFetch(urls[ui], { headers: hdr, timeout: 10 });
          if (data2) txt = typeof data2 === "string" ? data2 : JSON.stringify(data2);
        }
        var list = parsePayload(txt);
        if (list && list.length) {
          console.log("[bili] search ok via", ui, "n=", list.length);
          return list;
        }
        // 也可能 adapter 直接返回了对象字符串化后 parse 失败，再试 reqFetch 对象
        if (!list.length) {
          var data3 = await reqFetch(urls[ui], { headers: hdr, timeout: 10 });
          list = parsePayload(data3);
          if (list && list.length) {
            console.log("[bili] search ok reqFetch", ui, "n=", list.length);
            return list;
          }
        }
      } catch (e) {
        console.warn("[bili] search try fail", ui, e);
      }
    }
    console.warn("[bili] search empty for", kw);
    return [];
  }

  var _biliSpiCookie = null;
  var BILI_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

  function isBiliSong(song) {
    if (!song) return false;
    try {
      if (S && (S.platform === "bilibili" || S.platform === "bili") && song && song.source !== "qq") {
        // 当前切站为 B站时，搜索结果一律按 B站处理
        var src0 = String(song.source || "").toLowerCase();
        if (!src0 || src0 === "bilibili" || src0 === "bili") return true;
      }
    } catch (e0) {}
    var src = String(song.source || song.platform || "").toLowerCase();
    if (src === "bilibili" || src === "bili") return true;
    if (song.bvid) return true;
    var mid = String(song.songmid || song.mid || song.id || song.media_mid || "");
    if (/^bv_/i.test(mid) || /^BV[\w]+/i.test(mid)) return true;
    if (song._biliAudioUrl || song._biliPlayHeaders) return true;
    return false;
  }

  function biliStripTag(url) {
    // 去掉本端 #aq_q= 标记，避免个别壳/代理对 hash 敏感
    return String(url || "").replace(/#aq_q=[^#]*$/i, "").replace(/[?&]aq_q=[^&]*/i, "");
  }

  async function biliEnsureSpi() {
    if (_biliSpiCookie && (_biliSpiCookie.b_3 || _biliSpiCookie.b_4)) return _biliSpiCookie;
    try {
      var txt = await adapterRequest("https://api.bilibili.com/x/frontend/finger/spi", {
        headers: { "User-Agent": BILI_UA },
        timeout: 8,
      });
      var d = parseSearchBody(txt) || parseLooseJson(txt);
      if (!d && txt && String(txt).charAt(0) === "{") {
        try { d = JSON.parse(txt); } catch (e) {}
      }
      var data = (d && d.data) || d || {};
      _biliSpiCookie = { b_3: data.b_3 || data.buvid3 || "", b_4: data.b_4 || data.buvid4 || "" };
    } catch (e) {
      _biliSpiCookie = { b_3: "", b_4: "" };
    }
    return _biliSpiCookie;
  }

  function biliCookieHeader() {
    if (!_biliSpiCookie) return "";
    var parts = [];
    if (_biliSpiCookie.b_3) parts.push("buvid3=" + _biliSpiCookie.b_3);
    if (_biliSpiCookie.b_4) parts.push("buvid4=" + _biliSpiCookie.b_4);
    return parts.join("; ");
  }

  async function resolveBilibiliPlay(song) {
    /* 对齐 qqmusic-custom-sources API.bilibiliUrl：官方 playurl 只取音轨 + 挂 Referer 头 */
    if (!song) return null;
    var bvid = song.bvid || "";
    var aid = song.aid || 0;
    var cid = song.cid || 0;
    var sm = String(song.songmid || song.media_mid || song.mid || song.id || "");
    if (!bvid && !aid) {
      var m = /^bv_(BV[\w]+)/i.exec(sm);
      if (m) bvid = m[1];
      else if (/^BV[\w]+/i.test(sm)) bvid = sm.replace(/^bv_/i, "");
      else {
        var m2 = /^bv_av(\d+)/i.exec(sm);
        if (m2) aid = m2[1];
      }
    }
    if ((!bvid && !aid) || !cid) {
      var m3 = /^bv_(BV[\w]+)_(\d+)$/i.exec(sm);
      if (m3) { bvid = bvid || m3[1]; cid = cid || +m3[2]; }
      var m4 = /^bv_av(\d+)_(\d+)$/i.exec(sm);
      if (m4) { aid = aid || m4[1]; cid = cid || +m4[2]; }
    }
    if (!bvid && !aid) {
      console.warn("[bili] missing id", sm);
      return null;
    }

    await biliEnsureSpi();
    var hdr = {
      "User-Agent": BILI_UA,
      "Accept": "application/json, text/plain, */*",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      "Origin": "https://www.bilibili.com",
      "Referer": "https://www.bilibili.com/",
    };
    var ck = biliCookieHeader();
    if (ck) hdr["Cookie"] = ck;

    async function biliJson(url) {
      try {
        var txt = await adapterRequest(url, { headers: hdr, timeout: 14 });
        if (txt && String(txt).length > 2) {
          var d = parseSearchBody(txt) || parseLooseJson(txt);
          if (!d && typeof txt === "string" && txt.charAt(0) === "{") {
            try { d = JSON.parse(txt); } catch (e0) {}
          }
          if (d) return d;
        }
      } catch (e1) {}
      try { return await reqFetch(url, { headers: hdr, timeout: 12 }); } catch (e2) { return null; }
    }

    function biliAudioLink(audio) {
      if (!audio) return null;
      var cands = [];
      if (audio.baseUrl) cands.push(audio.baseUrl);
      if (audio.base_url) cands.push(audio.base_url);
      var backs = audio.backupUrl || audio.backup_url || [];
      if (backs && backs.length) for (var i = 0; i < backs.length; i++) if (backs[i]) cands.push(backs[i]);
      if (!cands.length) return null;
      function isPcdn(u) { return /mcdn\.|szbdyd\.|mountaintoys|\.mcdn|\/\/[^/]*\.edge\.|szext|\bxy\d/i.test(u); }
      function isUpos(u) { return /upos-|\.bilivideo\.com/i.test(u) && !isPcdn(u); }
      var upos = cands.filter(isUpos);
      var good = cands.filter(function (u) { return !isPcdn(u); });
      var u = (upos[0] || good[0] || cands[0] || "");
      return u ? String(u).replace(/^http:/i, "https:") : null;
    }

    function pickAudio(res) {
      if (!res || !res.data) return null;
      var data = res.data;
      var url = null;
      if (data.dash) {
        var dash = data.dash;
        if (dash.dolby && dash.dolby.audio && dash.dolby.audio.length) url = biliAudioLink(dash.dolby.audio[0]);
        if (!url && dash.flac && dash.flac.audio) {
          var fa = Array.isArray(dash.flac.audio) ? dash.flac.audio[0] : dash.flac.audio;
          url = biliAudioLink(fa);
        }
        if (!url && dash.audio && dash.audio.length) {
          var audios = dash.audio.slice().sort(function (a, b) {
            return (b.id || 0) - (a.id || 0) || (b.bandwidth || 0) - (a.bandwidth || 0);
          });
          for (var j = 0; j < audios.length; j++) {
            url = biliAudioLink(audios[j]);
            if (url) break;
          }
        }
      }
      if (!url && data.durl && data.durl[0] && data.durl[0].url) {
        url = String(data.durl[0].url).replace(/^http:/i, "https:");
      }
      return url || null;
    }

    function hasStream(res) {
      try {
        if (!res || !res.data) return false;
        if (typeof res.code === "number" && res.code !== 0) return false;
        var data = res.data;
        if (data.dash && ((data.dash.audio && data.dash.audio.length) || (data.dash.flac && data.dash.flac.audio) || (data.dash.dolby && data.dash.dolby.audio))) return true;
        if (data.durl && data.durl.length) return true;
      } catch (e) {}
      return false;
    }

    try {
      if (!cid) {
        var viewUrl = bvid
          ? ("https://api.bilibili.com/x/web-interface/view?bvid=" + encodeURIComponent(bvid))
          : ("https://api.bilibili.com/x/web-interface/view?aid=" + encodeURIComponent(aid));
        var view = await biliJson(viewUrl);
        if (view && view.code === 0 && view.data) {
          cid = view.data.cid || 0;
          if (!bvid && view.data.bvid) bvid = view.data.bvid;
          if (!aid && view.data.aid) aid = view.data.aid;
          if ((!cid || cid === 0) && view.data.pages && view.data.pages[0]) cid = view.data.pages[0].cid;
        }
      }
      if (!cid) {
        var plUrl = bvid
          ? ("https://api.bilibili.com/x/player/pagelist?bvid=" + encodeURIComponent(bvid))
          : ("https://api.bilibili.com/x/player/pagelist?aid=" + encodeURIComponent(aid));
        var pl = await biliJson(plUrl);
        if (pl && pl.code === 0 && pl.data && pl.data[0]) cid = pl.data[0].cid;
      }
      if (!cid) {
        console.warn("[bili] no cid");
        return null;
      }
      try {
        song.cid = cid;
        song.bvid = bvid || song.bvid;
        song.aid = aid || song.aid;
        song.source = "bilibili";
      } catch (eF) {}

      // plain playurl
      var q = (bvid ? ("bvid=" + encodeURIComponent(bvid)) : ("aid=" + encodeURIComponent(aid))) +
        "&cid=" + encodeURIComponent(cid) + "&qn=127&fnval=4048&fnver=0&fourk=1";
      var play = await biliJson("https://api.bilibili.com/x/player/playurl?" + q);
      if (!hasStream(play) || !pickAudio(play)) {
        // WBI 降级（无签名部分环境仍可用）
        var wq = "cid=" + encodeURIComponent(cid) + "&qn=127&fnval=4048&fnver=0&fourk=1";
        if (bvid) wq += "&bvid=" + encodeURIComponent(bvid);
        else wq += "&avid=" + encodeURIComponent(aid);
        var play2 = await biliJson("https://api.bilibili.com/x/player/wbi/playurl?" + wq);
        if (hasStream(play2)) play = play2;
      }
      var stream = pickAudio(play);
      if (!stream) {
        console.warn("[bili] no audio", play && play.code, play && play.message);
        return null;
      }

      // 播放头：与参考 HTML 一致 Host + 视频页 Referer
      var host = "";
      try {
        var noProto = String(stream).replace(/^https?:\/\//i, "");
        host = noProto.substring(0, noProto.indexOf("/"));
      } catch (eH0) {}
      var refId = bvid || aid || "";
      var playHeaders = {
        "User-Agent": BILI_UA,
        "user-agent": BILI_UA,
        "Accept": "*/*",
        "accept": "*/*",
        "Host": host,
        "host": host,
        "Connection": "keep-alive",
        "Referer": "https://www.bilibili.com/video/" + refId,
        "referer": "https://www.bilibili.com/video/" + refId,
      };
      try {
        song._biliPlayHeaders = playHeaders;
        song._biliAudioUrl = stream;
        song.source = "bilibili";
        song.playUrl = stream;
      } catch (eH) {}

      // 优先 fm.res 注入头（参考 credentials: include）；裸 bilivideo 链几乎必 403
      try {
        if (window.fm && typeof window.fm.res === "function") {
          var proxied = window.fm.res(stream, { headers: playHeaders, credentials: "include" });
          if (proxied && proxied !== stream) {
            console.log("[bili] play via fm.res");
            try { song.playUrl = proxied; } catch (eP) {}
            return String(proxied).trim(); // 不打 #aq_q，避免壳处理异常
          }
        }
      } catch (eRes) {
        console.warn("[bili] fm.res", eRes);
      }
      // 无代理时仍返回原链，交给 tryPlayUrl 走 blob
      return String(stream).trim();
    } catch (e) {
      console.warn("[bili] resolve fail", e);
      return null;
    }
  }

  function biliCleanTitle(name) {
    name = String(name || "").trim();
    name = name.replace(/<[^>]+>/g, "");
    var book = name.match(/《([^》]+)》/);
    if (book && book[1]) name = book[1];
    name = name
      .replace(/^【[^】]*】\s*/g, "")
      .replace(/\s*[\|｜].*$/, "")
      .replace(/\s*[\[【].{0,30}[\]】]\s*/g, " ")
      .replace(/\s*[\(（].{0,30}[\)）]\s*/g, " ")
      .replace(/(无损|音质|HIFI|后台播放|热歌|精选|合集|完整版|高清|官方|翻唱|cover|Live|现场|MV)/ig, " ")
      .replace(/\s+/g, " ")
      .trim();
    name = name
      .replace(/^[\sPp]*\d+(?:[\.．、)\s]+)\s*(?:\d+[\.．、)\s]+)?/, "")
      .replace(/^[①②③④⑤⑥⑦⑧⑨⑩]+\s*/, "")
      .replace(/\s+/g, " ")
      .trim();
    return name;
  }

  function bilibiliMapPart(detail, page, idx) {
    if (!detail || !page) return null;
    var cid = page.cid || 0;
    if (!cid) return null;
    var bvid = detail.bvid || "";
    var aid = detail.aid || 0;
    var owner = detail.owner || {};
    var partName = page.part || ("P" + (page.page || (idx + 1)));
    var clean = biliCleanTitle(partName) || partName;
    var author = owner.name || "";
    return {
      name: clean,
      artist: author,
      singer: author,
      singername: author,
      album: detail.title || "",
      songmid: "bv_" + (bvid || ("av" + aid)) + "_" + cid,
      mid: bvid || ("av" + aid),
      id: bvid || ("av" + aid),
      bvid: bvid,
      aid: aid,
      cid: cid,
      cover: biliCover(detail.pic || ""),
      duration: biliDurationSec(page.duration || 0),
      source: "bilibili",
      platform: "bilibili",
      upMid: owner.mid != null ? String(owner.mid) : "",
      _biliPart: true,
      _biliPage: page.page || (idx + 1),
    };
  }

  async function bilibiliViewDetail(song) {
    if (!song) return null;
    var bvid = song.bvid || "";
    var aid = song.aid || 0;
    var sm = String(song.songmid || song.mid || song.id || "");
    if (!bvid && !aid) {
      var m = /^bv_(BV[\w]+)/i.exec(sm);
      if (m) bvid = m[1];
      else if (/^BV[\w]+/i.test(sm)) bvid = sm.replace(/^bv_/i, "");
      else {
        var m2 = /^bv_av(\d+)/i.exec(sm);
        if (m2) aid = m2[1];
      }
    }
    if (!bvid && !aid) return null;
    await biliEnsureSpi();
    var hdr = {
      "User-Agent": BILI_UA,
      "Accept": "application/json, text/plain, */*",
      "Referer": "https://www.bilibili.com/",
      "Origin": "https://www.bilibili.com",
    };
    var ck = biliCookieHeader();
    if (ck) hdr["Cookie"] = ck;
    var viewUrl = bvid
      ? ("https://api.bilibili.com/x/web-interface/view?bvid=" + encodeURIComponent(bvid))
      : ("https://api.bilibili.com/x/web-interface/view?aid=" + encodeURIComponent(aid));
    try {
      var txt = await adapterRequest(viewUrl, { headers: hdr, timeout: 12 });
      var d = parseSearchBody(txt) || parseLooseJson(txt);
      if (!d && txt && String(txt).charAt(0) === "{") {
        try { d = JSON.parse(txt); } catch (e0) {}
      }
      if (!d || d.code !== 0) {
        d = await reqFetch(viewUrl, { headers: hdr, timeout: 10 });
      }
      if (d && d.code === 0 && d.data) return d.data;
    } catch (e) {
      console.warn("[bili] view detail", e);
    }
    return null;
  }

  /** 多 P / 合集拆成「一集一首」；multi=true 时应展示列表而非整包开播 */
  async function bilibiliExpandParts(song) {
    if (!song) return { multi: false, songs: [], title: "", cover: "" };
    if (song._biliPart && song.cid) {
      return { multi: false, songs: [song], title: song.album || song.name || "", cover: song.cover || "" };
    }
    try {
      var detail = await bilibiliViewDetail(song);
      if (!detail) {
        return { multi: false, songs: [song], title: song.name || "", cover: song.cover || "" };
      }
      var owner = detail.owner || {};
      var songs = [];
      var title = detail.title || song.name || "";
      var cover = biliCover(detail.pic || song.cover || "");

      // 1) ugc_season 合集
      try {
        var season = detail.ugc_season;
        if (season) {
          var sc = biliCover(season.cover || season.cover16x9 || season.cover_horizontal || "");
          if (sc) cover = sc;
          if (season.title) title = season.title;
          if (season.sections && season.sections.length) {
            for (var si = 0; si < season.sections.length; si++) {
              var eps = season.sections[si].episodes || [];
              for (var ei = 0; ei < eps.length; ei++) {
                var ep = eps[ei];
                if (!ep) continue;
                var epCid = ep.cid || (ep.page && ep.page.cid) || 0;
                var epBvid = ep.bvid || "";
                var epAid = ep.aid || 0;
                if (!epCid && !epBvid && !epAid) continue;
                var epTitle = ep.title || (ep.arc && ep.arc.title) || ("第" + (ei + 1) + "集");
                var epPic = biliCover((ep.arc && ep.arc.pic) || ep.cover || cover);
                var epDur = biliDurationSec((ep.arc && ep.arc.duration) || (ep.page && ep.page.duration) || 0);
                var author = (ep.arc && ep.arc.author && ep.arc.author.name) || owner.name || song.artist || "";
                songs.push({
                  name: biliCleanTitle(epTitle) || epTitle,
                  artist: author,
                  singer: author,
                  singername: author,
                  album: season.title || title,
                  songmid: "bv_" + (epBvid || ("av" + epAid)) + (epCid ? ("_" + epCid) : ""),
                  mid: epBvid || ("av" + epAid),
                  id: epBvid || ("av" + epAid),
                  bvid: epBvid,
                  aid: epAid,
                  cid: epCid,
                  cover: epPic,
                  duration: epDur,
                  source: "bilibili",
                  platform: "bilibili",
                  upMid: owner.mid != null ? String(owner.mid) : "",
                  _biliPart: true,
                });
              }
            }
          }
        }
      } catch (eSe) {}

      // 2) 多 P 视频
      var pages = detail.pages || [];
      if (!songs.length && pages.length > 1) {
        for (var i = 0; i < pages.length; i++) {
          var mapped = bilibiliMapPart(detail, pages[i], i);
          if (mapped) songs.push(mapped);
        }
      }

      if (songs.length > 1) {
        return { multi: true, songs: songs, title: title, cover: cover };
      }

      // 单 P：补全 cid 后直接播
      var one = Object.assign({}, song);
      one.bvid = detail.bvid || one.bvid || "";
      one.aid = detail.aid || one.aid || 0;
      one.cid = (pages[0] && pages[0].cid) || detail.cid || one.cid || 0;
      one.cover = cover || one.cover;
      one.artist = one.artist || owner.name || "UP主";
      one.singer = one.artist;
      one.singername = one.artist;
      one.source = "bilibili";
      if (one.cid) {
        one.songmid = "bv_" + (one.bvid || ("av" + one.aid)) + "_" + one.cid;
        one._biliPart = true;
      }
      one.duration = one.duration || biliDurationSec(detail.duration || (pages && pages[0] && pages[0].duration) || 0);
      return { multi: false, songs: [one], title: title, cover: cover };
    } catch (e) {
      console.warn("[bili] expand", e);
      return { multi: false, songs: [song], title: song.name || "", cover: song.cover || "" };
    }
  }

  async function openBiliCollectionDetail(exp, hit) {
    var titleText = (exp && exp.title) || (hit && hit.name) || "B站合集";
    var cover = (exp && exp.cover) || (hit && hit.cover) || PLACEHOLDER;
    var songs = (exp && exp.songs) || [];
    openDetailPageShell({
      title: titleText,
      cover: cover,
      sub: "B站 · " + songs.length + " 首",
      desc: (hit && hit.artist) ? ("UP：" + hit.artist) : "多 P / 合集",
      kind: "bili-collection",
      source: "bilibili",
      id: (hit && (hit.bvid || hit.songmid)) || "",
      info: { title: titleText, cover: cover },
    });
    detailState.songs = songs;
    var subEl = document.getElementById("detailSub");
    if (subEl) subEl.textContent = "B站 · 共 " + songs.length + " 首";
    if (typeof isUsableCover === "function" && isUsableCover(cover)) {
      try { applyDetailCover(cover, { force: true }); } catch (eC) {}
    }
    renderDetailSongRows(songs);
    var tip = document.getElementById("detailLoadTip");
    if (tip) tip.textContent = songs.length ? ("已加载全部 " + songs.length + " 首") : "";
    try { syncDetailLikeBtn(); } catch (eLk) {}
  }

  async function searchSongs(kw, page) {
    if (!kw) return [];
    var plat = S.platform || "qq";
    var list = [];
    try {
      if (plat === "bilibili" || plat === "bili") list = await searchBilibili(kw, page);
      else if (plat === "netease") list = await searchNetease(kw, page);
      else if (plat === "kuwo") list = await searchKuwo(kw, page);
      else if (plat === "kugou") list = await searchKugou(kw, page);
      else if (plat === "migu") list = await searchMigu(kw, page);
      else list = await searchQQ(kw, page);
    } catch (e) {
      console.warn("searchSongs fail", plat, e);
      list = [];
    }
    // 其它站无结果时静默回退 QQ（B 站不回退，避免搜到无关 QQ 曲）
    if ((!list || !list.length) && plat !== "qq" && plat !== "bilibili" && plat !== "bili") {
      try {
        list = await searchQQ(kw, page);
      } catch (e2) {}
    }
    return list || [];
  }

  function platDisplayName() {
    var plat = S.platform || "qq";
    if (plat === "bilibili" || plat === "bili") return "B站";
    var p = (typeof platformsForMenu === "function" ? platformsForMenu() : (PLATFORMS || [])).find(function (x) {
      return x.id === plat;
    });
    return (p && p.name) || "QQ";
  }

  function normSinger(s) {
    if (!s) return null;
    var mid = s.singerMID || s.singer_mid || s.mid || s.singerMid || s.id || "";
    var name = s.singerName || s.singer_name || s.name || s.singer || "";
    if (!name) return null;
    var pic = s.singerPic || s.singer_pic || s.pic || "";
    if (!pic && mid) pic = coverUrl(String(mid), "singer");
    if (pic) pic = fixCover(pic);
    return {
      mid: String(mid || ""),
      name: name,
      cover: pic,
      songnum: s.songNum || s.song_num || s.musicNum || s.songnum || 0,
      albumnum: s.albumNum || s.album_num || s.albumnum || 0,
      type: "singer",
    };
  }

  /* smartbox：歌手/专辑联想（QQ 官方，稳定有数据） */
  async function smartbox(kw) {
    if (!kw) return { singers: [], albums: [], songs: [] };
    try {
      var url = "https://c.y.qq.com/splcloud/fcgi-bin/smartbox_new.fcg?key=" +
        encodeURIComponent(kw) + "&format=jsonp&inCharset=utf8&outCharset=utf-8";
      var data = await jsonp(url, 10);
      var d = (data && data.data) || {};
      var singers = ((d.singer && d.singer.itemlist) || []).map(normSinger).filter(Boolean);
      var albums = ((d.album && d.album.itemlist) || []).map(function (a) {
        return {
          mid: a.mid || "",
          name: a.name || "",
          cover: a.pic ? fixCover(a.pic) : (a.mid ? coverUrl(a.mid) : ""),
          artist: a.singer || "",
          type: "album",
        };
      });
      return { singers: singers, albums: albums, songs: (d.song && d.song.itemlist) || [] };
    } catch (e) {
      return { singers: [], albums: [], songs: [] };
    }
  }

  async function searchSingersFromSongs(kw) {
    var songs = await searchSongs(kw).catch(function () { return []; });
    var seen = {}, out = [];
    (songs || []).forEach(function (s) {
      var raw = (s.artist || s.singer || "").replace(/<[^>]+>/g, "");
      raw.split(/[\/、,&｜|]/).forEach(function (part) {
        var name = String(part || "").trim();
        if (!name || name === "未知" || seen[name]) return;
        seen[name] = 1;
        out.push({
          mid: (s.upMid ? ("bili_up_" + s.upMid) : ("sg_" + (s.source || "x") + "_" + name)),
          name: name,
          cover: s.cover || "",
          songnum: 0,
          albumnum: 0,
          type: "singer",
          source: s.source || S.platform || "qq",
          upMid: s.upMid || "",
        });
      });
    });
    return out;
  }

  async function searchSingersQQ(kw) {
    var seen = {}, out = [];
    function push(sg) {
      if (!sg || !sg.name) return;
      var k = (sg.mid || "") + "|" + sg.name;
      if (seen[k]) return;
      seen[k] = 1;
      sg.source = sg.source || "qq";
      out.push(sg);
    }
    try {
      var box = await smartbox(kw);
      (box.singers || []).forEach(push);
    } catch (e) {}
    try {
      // client_search_cp 已 500 失效，改用 musicu.fcg（search_type 0，返回体含 singer/zhida）
      var data = await musicuSearch(kw, 1, 0);
      var body = (data && data.req_1 && data.req_1.data && data.req_1.data.body) || {};
      ((body.zhida && body.zhida.list) || []).forEach(function (z) {
        if (z && (z.zhida_singer || z.singer)) {
          var zh = z.zhida_singer || z.singer;
          push(normSinger({
            singerMID: zh.singerMID || zh.mid, singerName: zh.singerName || zh.name,
            singerPic: zh.singerPic || zh.pic, songNum: zh.songNum, albumNum: zh.albumNum,
          }));
        }
      });
      ((body.singer && body.singer.list) || []).forEach(function (sg) {
        push(normSinger({ mid: sg.mid, name: sg.name, singerPic: sg.pic || "" }));
      });
      var songs = (body.song && body.song.list) || [];
      songs.forEach(function (s) {
        (s.singer || []).forEach(function (sg) {
          push(normSinger({ mid: sg.mid || sg.singerMID, name: sg.name || sg.singerName, singerPic: sg.pic || "" }));
        });
      });
    } catch (e2) {}
    return out;
  }

  async function searchSingersNetease(kw) {
    var hdr = { Referer: "https://music.163.com/" };
    var url = "https://music.163.com/api/search/get?s=" + encodeURIComponent(kw) +
      "&type=100&limit=20&offset=0";
    try {
      var txt = await adapterRequest(url, { headers: hdr, timeout: 5 });
      var d = parseSearchBody(txt);
      var arts = (d && d.result && d.result.artists) || [];
      var list = arts.map(function (a) {
        var pic = a.picUrl || a.img1v1Url || "";
        if (!a.name) return null;
        return {
          mid: "ne_ar_" + a.id,
          name: a.name,
          cover: pic ? fixCover(String(pic).replace(/^http:/, "https:")) : "",
          songnum: a.musicSize || 0,
          albumnum: a.albumSize || 0,
          type: "singer",
          source: "netease",
          neteaseId: String(a.id || ""),
        };
      }).filter(Boolean);
      if (list.length) return list;
    } catch (e) {}
    return searchSingersFromSongs(kw);
  }

  async function searchSingersKuwo(kw) {
    var hdr = { Referer: "https://www.kuwo.cn/", Accept: "application/json, text/plain, */*" };
    var url = "https://search.kuwo.cn/r.s?all=" + encodeURIComponent(kw) +
      "&ft=artist&rn=20&pn=0&rformat=json&encoding=utf8&mobi=1";
    try {
      var txt = await adapterRequest(url, { headers: hdr, timeout: 5 });
      var d = parseKuwoBody(txt);
      var list = (d && d.abslist) || (d && d.artistlist) || (d && d.data && d.data.list) || [];
      var basePic = (d && (d.BASEPICPATH || d.basepicpath || d.ARTISTPIC)) || "https://img1.kuwo.cn/star/starheads/";
      var mapped = (list || []).map(function (it) {
        var name = String(it.ARTIST || it.artist || it.name || it.NAME || "").replace(/&nbsp;/g, " ").trim();
        var id = String(it.ARTISTID || it.artistid || it.id || it.DC_TARGETID || name);
        var pic = it.hts_PIC || it.hts_pic || it.PIC || it.pic || it.img || it.image ||
          it.PICPATH || it.picpath || it.artistpic || it.artistPic || "";
        pic = kuwoResolvePic(pic, basePic);
        if (!name) return null;
        return {
          mid: "kw_ar_" + id,
          name: name,
          cover: pic ? fixCover(pic) : "",
          songnum: parseInt(it.SONGNUM || it.songnum || 0, 10) || 0,
          albumnum: 0,
          type: "singer",
          source: "kuwo",
          rid: id,
        };
      }).filter(Boolean);
      if (mapped.length) return mapped;
    } catch (e) {}
    return searchSingersFromSongs(kw);
  }

  async function searchSingersKugou(kw) {
    var hdr = { Referer: "https://www.kugou.com/", Accept: "application/json" };
    var q = encodeURIComponent(kw);
    var urls = [
      "https://msearch.kugou.com/api/v3/search/singer?format=json&keyword=" + q + "&page=1&pagesize=20",
      "https://mobileservice.kugou.com/api/v3/search/singer?format=json&keyword=" + q + "&page=1&pagesize=20",
      "https://mobilecdn.kugou.com/api/v3/search/singer?format=json&keyword=" + q + "&page=1&pagesize=12",
    ];
    for (var i = 0; i < urls.length; i++) {
      try {
        var txt = await adapterRequest(urls[i], { headers: hdr, timeout: 5 });
        var d = parseSearchBody(txt);
        var list = (d && d.data && (d.data.info || d.data.lists || d.data.list)) || d.lists || d.info || [];
        if (!Array.isArray(list)) list = [];
        var mapped = list.map(function (it) {
          if (!it) return null;
          var name = String(it.singername || it.SingerName || it.name || "").replace(/<[^>]+>/g, "").trim();
          if (!name) return null;
          var id = it.singerid || it.SingerId || it.id || name;
          var pic = it.imgurl || it.image || it.img || "";
          if (pic) pic = String(pic).replace(/\{size\}/g, "240").replace(/^http:/, "https:");
          return {
            mid: "kg_ar_" + id,
            name: name,
            cover: pic ? fixCover(pic) : "",
            songnum: 0,
            albumnum: 0,
            type: "singer",
            source: "kugou",
          };
        }).filter(Boolean);
        if (mapped.length) return mapped;
      } catch (e) {}
    }
    return searchSingersFromSongs(kw);
  }

  async function searchSingersMigu(kw) {
    var hdr = { Referer: "https://music.migu.cn/", Accept: "application/json" };
    var url = "https://pd.musicapp.migu.cn/MIGUM3.0/v1.0/content/search_all.do?text=" +
      encodeURIComponent(kw) + "&pageNo=1&pageSize=20&searchSwitch=" +
      encodeURIComponent('{"song":0,"album":0,"singer":1,"tagSong":0,"mvSong":0,"songlist":0,"bestShow":0}');
    try {
      var txt = await adapterRequest(url, { headers: hdr, timeout: 5 });
      var d = parseSearchBody(txt);
      var arts = (d && d.singerResultData && d.singerResultData.result) ||
        (d && d.data && d.data.singerResultData && d.data.singerResultData.result) || [];
      var mapped = (arts || []).map(function (a) {
        if (!a) return null;
        var id = String(a.id || a.singerId || "");
        var name = a.name || a.singerName || "";
        if (!name) return null;
        var pic = "";
        var imgs = a.imgItems || a.imgs || [];
        if (Array.isArray(imgs) && imgs[0]) pic = imgs[0].img || imgs[0].url || "";
        pic = pic || a.singerPic || a.picUrl || a.imgUrl || "";
        return {
          mid: "mg_ar_" + (id || name),
          name: name,
          cover: pic ? fixCover(String(pic).replace(/^http:/, "https:")) : "",
          songnum: 0,
          albumnum: 0,
          type: "singer",
          source: "migu",
        };
      }).filter(Boolean);
      if (mapped.length) return mapped;
    } catch (e) {}
    return searchSingersFromSongs(kw);
  }

  async function searchSingersBilibili(kw) {
    if (!kw) return [];
    var hdr = {
      "User-Agent": BILI_UA,
      "Referer": "https://search.bilibili.com/",
      "Origin": "https://search.bilibili.com",
      "Accept": "application/json, text/plain, */*",
    };
    var urls = [
      "https://api.bilibili.com/x/web-interface/wbi/search/type?search_type=bili_user&keyword=" +
        encodeURIComponent(kw) + "&page=1&page_size=20&platform=pc",
      "https://api.bilibili.com/x/web-interface/search/type?search_type=bili_user&keyword=" +
        encodeURIComponent(kw) + "&page=1&page_size=20&platform=pc",
    ];
    for (var ui = 0; ui < urls.length; ui++) {
      try {
        var txt = await adapterRequest(urls[ui], { headers: hdr, timeout: 12 });
        if (!txt || String(txt).length < 20) {
          var d0 = await reqFetch(urls[ui], { headers: hdr, timeout: 10 });
          if (d0) txt = typeof d0 === "string" ? d0 : JSON.stringify(d0);
        }
        var d = parseSearchBody(txt) || parseLooseJson(txt);
        if (!d && typeof txt === "string" && txt.charAt(0) === "{") {
          try { d = JSON.parse(txt); } catch (e0) {}
        }
        if (!d || (typeof d.code === "number" && d.code !== 0)) continue;
        var rows = (d.data && d.data.result) || [];
        if (!Array.isArray(rows) || !rows.length) continue;
        var list = rows.map(function (it) {
          if (!it) return null;
          var name = stripBiliHtml(it.uname || it.name || it.user_name || "");
          var mid = it.mid != null ? String(it.mid) : "";
          if (!name || !mid) return null;
          var face = biliCover(it.upic || it.face || it.uface || "");
          return {
            mid: "bili_up_" + mid,
            name: name,
            cover: face,
            songnum: parseInt(it.videos || it.video_count || 0, 10) || 0,
            albumnum: 0,
            type: "singer",
            source: "bilibili",
            upMid: mid,
            usign: stripBiliHtml(it.usign || it.sign || "") || "",
          };
        }).filter(Boolean);
        if (list.length) {
          console.log("[bili] user search ok", list.length);
          return list;
        }
      } catch (e) {
        console.warn("[bili] user search", e);
      }
    }
    // 兜底：从视频结果抽 UP
    return searchSingersFromSongs(kw);
  }

  /** 拉取 UP 主投稿列表。空间接口常风控，优先视频搜索按 mid 过滤 */
  async function searchBiliUpWorks(upMid, upName, page) {
    page = page || 1;
    upMid = String(upMid || "").replace(/^bili_up_/i, "");
    var hdr = {
      "User-Agent": BILI_UA,
      "Referer": "https://search.bilibili.com/",
      "Origin": "https://search.bilibili.com",
      "Accept": "application/json, text/plain, */*",
    };
    var out = [];
    var total = 0;

    // 1) 尝试空间投稿（多数环境需 WBI 且易风控，成功则最准）
    if (upMid) {
      try {
        var spaceUrls = [
          "https://api.bilibili.com/x/space/arc/search?mid=" + encodeURIComponent(upMid) +
            "&ps=30&pn=" + page + "&order=pubdate&jsonp=jsonp",
          "https://api.bilibili.com/x/space/wbi/arc/search?mid=" + encodeURIComponent(upMid) +
            "&ps=30&pn=" + page + "&order=pubdate",
        ];
        for (var si = 0; si < spaceUrls.length && !out.length; si++) {
          var stxt = await adapterRequest(spaceUrls[si], {
            headers: Object.assign({}, hdr, {
              Referer: "https://space.bilibili.com/" + upMid + "/video",
              Origin: "https://space.bilibili.com",
            }),
            timeout: 10,
          });
          var sd = parseSearchBody(stxt) || parseLooseJson(stxt);
          if (!sd && stxt && String(stxt).charAt(0) === "{") {
            try { sd = JSON.parse(stxt); } catch (eS) {}
          }
          if (sd && sd.code === 0 && sd.data) {
            var vl = (sd.data.list && sd.data.list.vlist) || [];
            total = (sd.data.page && sd.data.page.count) || vl.length;
            vl.forEach(function (it) {
              if (!it) return;
              var bvid = it.bvid || "";
              var aid = it.aid || it.id || "";
              if (!bvid && !aid) return;
              var title = stripBiliHtml(it.title || "");
              if (!title) return;
              var midKey = bvid || ("av" + aid);
              out.push({
                name: title,
                artist: stripBiliHtml(it.author || upName || "") || "UP主",
                singer: stripBiliHtml(it.author || upName || "") || "UP主",
                singername: stripBiliHtml(it.author || upName || "") || "UP主",
                album: "B站",
                songmid: "bv_" + midKey,
                mid: midKey,
                id: midKey,
                bvid: bvid || "",
                aid: aid ? String(aid) : "",
                cid: 0,
                cover: biliCover(it.pic || ""),
                duration: biliDurationSec(it.length || it.duration || 0),
                source: "bilibili",
                platform: "bilibili",
                upMid: upMid,
              });
            });
          }
        }
      } catch (eSp) {
        console.warn("[bili] space arc", eSp);
      }
    }

    // 2) 兜底：按 UP 名搜视频并过滤 mid（空间被风控时仍可用）
    if (!out.length && (upName || upMid)) {
      try {
        var kw = upName || "";
        var vurl =
          "https://api.bilibili.com/x/web-interface/wbi/search/type?search_type=video&keyword=" +
          encodeURIComponent(kw || String(upMid)) +
          "&page=" + page + "&page_size=30&platform=pc&order=pubdate";
        var vtxt = await adapterRequest(vurl, { headers: hdr, timeout: 12 });
        if (!vtxt || String(vtxt).length < 20) {
          var vd0 = await reqFetch(vurl, { headers: hdr, timeout: 10 });
          if (vd0) vtxt = typeof vd0 === "string" ? vd0 : JSON.stringify(vd0);
        }
        var vd = parseSearchBody(vtxt) || parseLooseJson(vtxt);
        if (!vd && vtxt && String(vtxt).charAt(0) === "{") {
          try { vd = JSON.parse(vtxt); } catch (eV) {}
        }
        var rows = (vd && vd.data && vd.data.result) || [];
        if (!Array.isArray(rows)) rows = [];
        total = (vd && vd.data && (vd.data.numResults || vd.data.numresults)) || rows.length;
        rows.forEach(function (it) {
          if (!it) return;
          // 有 mid 则严格过滤；无 mid 时保留（按名搜的近似结果）
          if (upMid && it.mid != null && String(it.mid) !== String(upMid)) return;
          var bvid = it.bvid || "";
          var aid = it.aid || it.id || "";
          if (!bvid && !aid) return;
          var title = stripBiliHtml(it.title || it.name || "");
          if (!title) return;
          var midKey = bvid || ("av" + aid);
          var author = stripBiliHtml(it.author || upName || "") || "UP主";
          out.push({
            name: title,
            artist: author,
            singer: author,
            singername: author,
            album: stripBiliHtml(it.typename || "") || "B站",
            songmid: "bv_" + midKey,
            mid: midKey,
            id: midKey,
            bvid: bvid || "",
            aid: aid ? String(aid) : "",
            cid: 0,
            cover: biliCover(it.pic || it.cover || ""),
            duration: biliDurationSec(it.duration || it.length || 0),
            source: "bilibili",
            platform: "bilibili",
            upMid: upMid || (it.mid != null ? String(it.mid) : ""),
          });
        });
      } catch (eV2) {
        console.warn("[bili] up works search", eV2);
      }
    }
    return { songs: out, total: total || out.length };
  }

  async function searchSingers(kw) {
    if (!kw) return [];
    var plat = S.platform || "qq";
    var list = [];
    try {
      if (plat === "bilibili" || plat === "bili") {
        list = await searchSingersBilibili(kw);
      } else if (plat === "netease") list = await searchSingersNetease(kw);
      else if (plat === "kuwo") list = await searchSingersKuwo(kw);
      else if (plat === "kugou") list = await searchSingersKugou(kw);
      else if (plat === "migu") list = await searchSingersMigu(kw);
      else list = await searchSingersQQ(kw);
    } catch (e) {
      console.warn("searchSingers", plat, e);
      list = [];
    }
    // 仍空：从单曲结果抽歌手（同站源）
    if (!list.length) {
      try { list = await searchSingersFromSongs(kw); } catch (e2) {}
    }
    return list || [];
  }

  function digPlaylistRaw(d) {
    if (!d || typeof d !== "object") return [];
    var node = d.req || d.req_1 || d.req_0 || d["music.search.SearchCgiService"] || d;
    var data = (node && node.data) ? node.data : node;
    if (data && data.data) data = data.data;
    var body = (data && data.body) ? data.body : data;
    if (d.data && (d.data.diss || d.data.songlist)) body = d.data;
    if (!body || typeof body !== "object") return [];
    var raw = body.item_songlist || body.songlist || body.diss || body.playlist || body.list || null;
    var items = [];
    if (Array.isArray(raw)) items = raw;
    else if (raw && typeof raw === "object") {
      items = raw.list || raw.item_list || raw.songlist || raw.disslist || raw.itemlist || [];
    }
    if ((!items || !items.length) && Array.isArray(body.list)) items = body.list;
    return (items || []).map(function (it) {
      if (!it || typeof it !== "object") return null;
      var x = it.doc || it.playlist || it.diss || it;
      if (x && x.basic) {
        try { x = Object.assign({}, x, x.basic); } catch (eM) { x = x.basic || x; }
      }
      return x;
    }).filter(Boolean);
  }

  async function searchPlaylistsQQ(kw) {
    var out = [], seen = {};
    function pushAll(arr) {
      (arr || []).forEach(function (p) {
        var n = normPlaylist(p);
        if (!n || !n.id || seen[n.id]) return;
        n.source = "qq";
        seen[n.id] = 1;
        out.push(n);
      });
    }
    function harvest(d) {
      if (!d) return;
      pushAll(digPlaylistRaw(d));
      var data = d.data || d;
      if (data) {
        pushAll((data.diss && (data.diss.list || data.diss.itemlist)) || []);
        pushAll((data.songlist && (data.songlist.list || data.songlist.itemlist)) || []);
        pushAll((data.playlist && (data.playlist.list || data.playlist.itemlist)) || []);
      }
    }
    async function musicuJsonpSearch(searchType) {
      try {
        var d = await musicuSearch(kw, 1, searchType);
        harvest(d);
      } catch (e) {}
    }
    await Promise.race([
      Promise.all([
        musicuJsonpSearch(3), // 歌单
        musicuJsonpSearch(0), // 歌曲，收 zhida/歌单内联
      ]),
      new Promise(function (r) { setTimeout(r, 2800); }),
    ]);
    return out;
  }

  async function searchPlaylistsNetease(kw) {
    var hdr = { Referer: "https://music.163.com/" };
    var url = "https://music.163.com/api/search/get?s=" + encodeURIComponent(kw) +
      "&type=1000&limit=30&offset=0";
    try {
      var txt = await adapterRequest(url, { headers: hdr, timeout: 5 });
      var d = parseSearchBody(txt);
      var list = (d && d.result && d.result.playlists) || [];
      return list.map(function (p) {
        var id = String(p.id || "");
        var cover = p.coverImgUrl || p.picUrl || "";
        if (!id || !p.name) return null;
        return {
          id: id,
          name: p.name,
          cover: cover ? fixCover(String(cover).replace(/^http:/, "https:")) : "",
          source: "netease",
          listen: p.playCount || 0,
          creator: (p.creator && p.creator.nickname) || "",
          type: "playlist",
        };
      }).filter(Boolean);
    } catch (e) {
      return [];
    }
  }

  async function searchPlaylistsKuwo(kw) {
    var hdr = { Referer: "https://www.kuwo.cn/", Accept: "application/json, text/plain, */*" };
    var q = encodeURIComponent(kw || "");
    var urls = [
      "https://wapi.kuwo.cn/api/www/search/searchPlayListBykeyWord?key=" + q + "&pn=0&rn=30&httpsStatus=1",
      "https://search.kuwo.cn/r.s?all=" + q + "&ft=playlist&rn=30&pn=0&rformat=json&encoding=utf8&mobi=1",
      "https://search.kuwo.cn/r.s?all=" + q + "&ft=playlist&rn=30&pn=0&rformat=json&encoding=utf8",
      "https://m.kuwo.cn/newh5app/api/www/search/searchPlayListBykeyWord?key=" + q + "&pn=0&rn=30&httpsStatus=1",
    ];
    function mapList(list, basePic) {
      return (list || []).map(function (it) {
        if (!it) return null;
        var id = String(it.PLAYLISTID || it.playlistid || it.pid || it.id || it.DC_TARGETID || "").trim();
        var name = String(it.NAME || it.name || it.PLAYLIST || it.title || "").replace(/&nbsp;/g, " ").trim();
        var pic = it.hts_pic || it.hts_PIC || it.pic || it.PIC || it.img || it.image ||
          it.PICPATH || it.picpath || it.logo || "";
        pic = kuwoResolvePic(pic, basePic || "playlist");
        if (!id || !name) return null;
        return {
          id: id,
          name: name,
          cover: pic ? fixCover(pic) : "",
          source: "kuwo",
          creator: it.uname || it.USERNAME || it.nickname || it.userName || "",
          listen: Number(it.playcnt || it.listencnt || it.listenCnt || 0) || 0,
          type: "playlist",
        };
      }).filter(Boolean);
    }
    for (var i = 0; i < urls.length; i++) {
      try {
        var d = null;
        try {
          d = await reqFetch(urls[i], { timeout: 10, headers: hdr });
        } catch (e1) { d = null; }
        if (!d) {
          var txt = await adapterRequest(urls[i], { headers: hdr, timeout: 10 });
          d = typeof txt === "string" ? (parseKuwoBody(txt) || parseLooseJson(txt) || JSON.parse(txt)) : txt;
        }
        if (!d) continue;
        if (typeof d === "string") {
          try { d = parseKuwoBody(d) || parseLooseJson(d) || JSON.parse(d); } catch (e2) { continue; }
        }
        var list =
          (d.abslist) ||
          (d.data && d.data.list) ||
          (d.data && d.data.abslist) ||
          (d.list) || [];
        var basePic = (d.BASEPICPATH || d.basepicpath) || "";
        var mapped = mapList(list, basePic);
        if (mapped.length) return mapped;
      } catch (e) {}
    }
    return [];
  }

  async function searchPlaylistsKugou(kw) {
    var hdr = { Referer: "https://www.kugou.com/", Accept: "application/json" };
    var q = encodeURIComponent(kw);
    var urls = [
      "https://msearch.kugou.com/api/v3/search/special?format=json&keyword=" + q + "&page=1&pagesize=30&version=9108",
      "https://mobileservice.kugou.com/api/v3/search/special?format=json&keyword=" + q + "&page=1&pagesize=30&version=9108",
      "https://msearch.kugou.com/api/v3/search/special?keyword=" + q + "&page=1&pagesize=30&version=9108&sver=2",
    ];
    for (var i = 0; i < urls.length; i++) {
      try {
        var txt = await adapterRequest(urls[i], { headers: hdr, timeout: 5 });
        var d = parseSearchBody(txt);
        var list = (d && d.data && (d.data.info || d.data.lists || d.data.list)) || d.lists || d.info || [];
        if (!Array.isArray(list)) list = [];
        var mapped = list.map(function (it) {
          if (!it) return null;
          var id = String(it.specialid || it.specialId || it.id || it.gid || it.global_collection_id || "").trim();
          if (!id || id === "0") return null;
          var pic = it.imgurl || it.imgUrl || it.sizable_cover || it.cover || "";
          if (pic) pic = String(pic).replace(/\{size\}/g, "240").replace(/^http:/, "https:");
          var title = it.specialname || it.specialName || it.name || it.special_name || "";
          if (!title) return null;
          return {
            id: id,
            name: title,
            cover: pic ? fixCover(pic) : "",
            source: "kugou",
            creator: it.nickname || it.username || "",
            listen: Number(it.playcount || it.playCount || 0) || 0,
            type: "playlist",
          };
        }).filter(Boolean);
        if (mapped.length) return mapped;
      } catch (e) {}
    }
    return [];
  }

  async function searchPlaylistsMigu(kw) {
    var hdr = { Referer: "https://music.migu.cn/", Accept: "application/json" };
    var url = "https://pd.musicapp.migu.cn/MIGUM3.0/v1.0/content/search_all.do?text=" +
      encodeURIComponent(kw) + "&pageNo=1&pageSize=30&searchSwitch=" +
      encodeURIComponent('{"song":0,"album":0,"singer":0,"tagSong":0,"mvSong":0,"songlist":1,"bestShow":0}');
    try {
      var txt = await adapterRequest(url, { headers: hdr, timeout: 5 });
      var d = parseSearchBody(txt);
      var pl = (d && d.songListResultData && d.songListResultData.result) ||
        (d && d.songlistResultData && d.songlistResultData.result) ||
        (d && d.data && d.data.songListResultData && d.data.songListResultData.result) || [];
      return (pl || []).map(function (p) {
        if (!p) return null;
        var id = String(p.id || p.musicListId || "");
        if (!id) return null;
        var cover = "";
        var imgs = p.imgItems || p.imgs || [];
        if (Array.isArray(imgs) && imgs[0]) cover = imgs[0].img || imgs[0].url || "";
        cover = cover || p.musicListPicUrl || p.picUrl || p.cover || p.image || "";
        var title = p.name || p.title || "";
        if (!title) return null;
        return {
          id: id,
          name: title,
          cover: cover ? fixCover(String(cover).replace(/^http:/, "https:")) : "",
          source: "migu",
          creator: p.userName || p.nickname || "",
          type: "playlist",
        };
      }).filter(Boolean);
    } catch (e) {
      return [];
    }
  }

  async function searchPlaylists(kw, opts) {
    // B站无传统歌单搜索：避免回退 QQ 歌单造成「全是 QQ」
    try {
      var _sp = (S.platform || "").toLowerCase();
      if (_sp === "bilibili" || _sp === "bili") return [];
    } catch (eSp) {}

    if (!kw) return [];
    opts = opts || {};
    var plat = S.platform || "qq";
    var list = [];
    try {
      if (plat === "netease") list = await searchPlaylistsNetease(kw);
      else if (plat === "kuwo") list = await searchPlaylistsKuwo(kw);
      else if (plat === "kugou") list = await searchPlaylistsKugou(kw);
      else if (plat === "migu") list = await searchPlaylistsMigu(kw);
      else list = await searchPlaylistsQQ(kw);
    } catch (e) {
      console.warn("searchPlaylists", plat, e);
      list = [];
    }
    // 酷我等偶发超时：静默再试一次，避免切站立刻被判「暂无」
    if ((!list || !list.length) && plat !== "qq" && !opts.noRetry) {
      try {
        await new Promise(function (r) { setTimeout(r, 280); });
        if (plat === "kuwo") list = await searchPlaylistsKuwo(kw);
        else if (plat === "netease") list = await searchPlaylistsNetease(kw);
        else if (plat === "kugou") list = await searchPlaylistsKugou(kw);
        else if (plat === "migu") list = await searchPlaylistsMigu(kw);
      } catch (eR) {}
    }
    // 仅搜索页可选静默回退 QQ；永不弹「已用 QQ」提示
    if ((!list || !list.length) && plat !== "qq" && opts.allowQQFallback) {
      try {
        list = await searchPlaylistsQQ(kw);
      } catch (e2) {}
    }
    return list || [];
  }

  /* 热门 / 推荐：多关键词混合，避免全是一个人 */
  var FEED_KW = ["流行", "热歌", "华语", "新歌", "摇滚", "民谣", "电子", "R&B", "说唱", "轻音乐", "粤语", "经典老歌", "情歌", "抖音", "欧美"];

  async function loadMixedFeed() {
    var picks = shuffle(FEED_KW).slice(0, 4);
    var songLists = await Promise.all(picks.map(function (k) {
      return searchQQ(k).catch(function () { return []; });
    }));
    var merged = [];
    var seen = {};
    songLists.forEach(function (arr) {
      (arr || []).forEach(function (s) {
        var k = keyOf(s);
        if (!seen[k]) { seen[k] = 1; merged.push(s); }
      });
    });
    // 交错打乱
    return shuffle(merged).slice(0, 40);
  }

  async function loadPlaylists() {
    var kws = shuffle(["流行", "热门", "华语", "情歌", "经典"]).slice(0, 2);
    var all = [];
    for (var i = 0; i < kws.length; i++) {
      var pl = await searchPlaylistsQQ(kws[i]);
      all = all.concat(pl);
    }
    var seen = {};
    return all.filter(function (p) {
      if (seen[p.id]) return false;
      seen[p.id] = 1;
      return true;
    }).slice(0, 16);
  }

  function digDissSongs(data) {
    if (!data) return [];
    var raw =
      data.songlist ||
      data.song_list ||
      data.songList ||
      (data.dirinfo && (data.dirinfo.songlist || data.dirinfo.song_list)) ||
      [];
    if (!Array.isArray(raw) && raw && typeof raw === "object") {
      raw = raw.list || raw.itemlist || raw.songlist || [];
    }
    return (raw || []).map(function (it) {
      var s = it.songInfo || it.song || it;
      var n = normSong(s);
      if (n) return n;
      // 宽松：仅有 songmid/name 也收
      var mid = s.songmid || s.mid || s.media_mid || "";
      var name = stripEm(s.songname || s.title || s.name || "");
      if (!mid || !name) return null;
      var singers = s.singer || [];
      var artist = Array.isArray(singers)
        ? singers.map(function (x) { return stripEm(x.name || ""); }).filter(Boolean).join(" / ")
        : "";
      var amid = s.albummid || (s.album && s.album.mid) || "";
      return {
        name: name,
        artist: artist || "未知",
        songmid: mid,
        albummid: amid,
        albumMid: amid,
        album: (s.album && s.album.name) || s.albumname || "",
        cover: amid ? coverUrl(amid) : "",
        source: "qq",
      };
    }).filter(Boolean);
  }

  /* 歌单详情：对齐 QQ CgiGetDiss + aiDissInfo + cdinfo */
  async function playlistSongs(dissid) {
    if (!dissid) return [];
    dissid = String(dissid).replace(/\D/g, "") || String(dissid);
    var idNum = Number(dissid) || dissid;

    function musicuGet(module, method, param) {
      var payload = {
        comm: { ct: 24, cv: 0, g_tk: 5381, uin: "0", format: "json", platform: "yqq.json" },
        req_0: { module: module, method: method, param: param },
      };
      var url = "https://u.y.qq.com/cgi-bin/musicu.fcg?data=" + encodeURIComponent(JSON.stringify(payload));
      return jsonp(url, 10).then(function (d) {
        var data = (d && d.req_0 && d.req_0.data) || (d && d.req_1 && d.req_1.data) || {};
        return digDissSongs(data);
      }).catch(function () { return []; });
    }

    // 并行竞速
    var tasks = [
      musicuGet("srf_diss_info.DissInfoServer", "CgiGetDiss", {
        disstid: idNum,
        dirid: 0,
        onlysonglist: 0,
        song_begin: 0,
        song_num: 80,
        userinfo: 1,
        orderlist: 1,
        pic_dpi: 800,
      }),
      musicuGet("music.srfDissInfo.aiDissInfo", "uniform_get_Dissinfo", {
        disstid: idNum,
        song_begin: 0,
        song_num: 80,
      }),
      musicuGet("srf_diss_info.DissInfoServer", "CgiGetDissInfo", {
        disstid: idNum,
        userinfo: 1,
        song_begin: 0,
        song_num: 80,
      }),
      jsonp(
        "https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg?type=1&json=1&utf8=1&onlysong=0&nosign=1&disstid=" +
          encodeURIComponent(dissid) +
          "&format=jsonp&g_tk=5381&loginUin=0&hostUin=0&inCharset=utf8&outCharset=utf-8&platform=yqq.json&needNewCode=0",
        10
      ).then(function (data) {
        var cd = (data && data.cdlist && data.cdlist[0]) || {};
        return digDissSongs(cd);
      }).catch(function () { return []; }),
    ];

    // 谁先返回非空就用谁，尽快开播
    return await new Promise(function (resolve) {
      var left = tasks.length;
      var done = false;
      tasks.forEach(function (p) {
        Promise.resolve(p).then(function (list) {
          if (done) return;
          if (list && list.length) {
            done = true;
            resolve(list);
            return;
          }
          left--;
          if (left <= 0) resolve([]);
        }).catch(function () {
          left--;
          if (!done && left <= 0) resolve([]);
        });
      });
    });
  }



  /** 拉取歌单简介/元信息（各平台），仅用于详情页展示 */
  function normalizeIntroText(s) {
    if (s == null) return "";
    s = String(s).replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"')
      .replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    s = s.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    return s;
  }
  function digDissMeta(data) {
    if (!data || typeof data !== "object") return { intro: "", title: "", cover: "" };
    var dir = data.dirinfo || data.dirInfo || data.diss_info || data.dissInfo || data;
    var cd = (data.cdlist && data.cdlist[0]) || data;
    var intro =
      dir.desc || dir.description || dir.introduction || dir.intro || dir.title_desc ||
      dir.basic_desc || dir.tag_desc ||
      cd.desc || cd.description || cd.introduction || cd.intro ||
      data.desc || data.description || data.introduction || data.intro || "";
    var title = dir.title || dir.dissname || dir.name || cd.dissname || cd.title || data.title || "";
    var cover =
      dir.logo || dir.picurl || dir.pic_url || dir.cover ||
      cd.logo || cd.picurl || cd.cover || data.logo || data.cover || "";
    if (cover) {
      try { cover = (typeof fixCover === "function" ? fixCover(cover) : cover); } catch (eC) {}
      try { if (typeof upgradeCoverUrl === "function") cover = upgradeCoverUrl(cover, 800); } catch (eU) {}
    }
    return {
      intro: normalizeIntroText(intro),
      title: String(title || "").trim(),
      cover: cover || "",
    };
  }
  async function fetchPlaylistMetaQQ(dissid) {
    if (!dissid) return { intro: "", title: "", cover: "" };
    dissid = String(dissid).replace(/\D/g, "") || String(dissid);
    var idNum = Number(dissid) || dissid;
    function musicuMeta(module, method, param) {
      var payload = {
        comm: { ct: 24, cv: 0, g_tk: 5381, uin: "0", format: "json", platform: "yqq.json" },
        req_0: { module: module, method: method, param: param },
      };
      var url = "https://u.y.qq.com/cgi-bin/musicu.fcg?data=" + encodeURIComponent(JSON.stringify(payload));
      return jsonp(url, 10).then(function (d) {
        var data = (d && d.req_0 && d.req_0.data) || (d && d.req_1 && d.req_1.data) || d || {};
        return digDissMeta(data);
      }).catch(function () { return { intro: "", title: "", cover: "" }; });
    }
    var tasks = [
      musicuMeta("srf_diss_info.DissInfoServer", "CgiGetDiss", {
        disstid: idNum, dirid: 0, onlysonglist: 0, song_begin: 0, song_num: 1, userinfo: 1, orderlist: 1, pic_dpi: 800,
      }),
      musicuMeta("music.srfDissInfo.aiDissInfo", "uniform_get_Dissinfo", {
        disstid: idNum, song_begin: 0, song_num: 1,
      }),
      musicuMeta("srf_diss_info.DissInfoServer", "CgiGetDissInfo", {
        disstid: idNum, userinfo: 1, song_begin: 0, song_num: 1,
      }),
      jsonp(
        "https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg?type=1&json=1&utf8=1&onlysong=0&nosign=1&disstid=" +
          encodeURIComponent(dissid) +
          "&format=jsonp&g_tk=5381&loginUin=0&hostUin=0&inCharset=utf8&outCharset=utf-8&platform=yqq.json&needNewCode=0",
        10
      ).then(function (data) {
        return digDissMeta(data);
      }).catch(function () { return { intro: "", title: "", cover: "" }; }),
    ];
    return await new Promise(function (resolve) {
      var left = tasks.length;
      var best = { intro: "", title: "", cover: "" };
      var done = false;
      tasks.forEach(function (p) {
        Promise.resolve(p).then(function (m) {
          if (done) return;
          if (m && m.intro) {
            done = true;
            resolve(m);
            return;
          }
          if (m) {
            if (!best.intro && m.intro) best.intro = m.intro;
            if (!best.title && m.title) best.title = m.title;
            if (!best.cover && m.cover) best.cover = m.cover;
          }
          left--;
          if (left <= 0) resolve(best);
        }).catch(function () {
          left--;
          if (!done && left <= 0) resolve(best);
        });
      });
    });
  }
  async function fetchPlaylistMetaNetease(pid) {
    try {
      pid = String(pid || "").replace(/^ne_pl_/i, "").replace(/\D/g, "");
      if (!pid) return { intro: "", title: "", cover: "" };
      var hdr = (typeof neHdr === "function") ? neHdr() : {
        Referer: "https://music.163.com/", Origin: "https://music.163.com", Accept: "*/*",
      };
      var urls = [
        "https://music.163.com/api/v6/playlist/detail?id=" + pid + "&n=1",
        "https://music.163.com/api/v1/playlist/detail?id=" + pid + "&n=1",
        "https://music.163.com/api/playlist/detail?id=" + pid,
      ];
      for (var i = 0; i < urls.length; i++) {
        var d = null;
        try {
          if (typeof neRequestJson === "function") d = await neRequestJson(urls[i], hdr, 12);
          else if (typeof reqFetch === "function") d = await reqFetch(urls[i], { timeout: 12, headers: hdr });
        } catch (e1) { d = null; }
        if (!d || typeof d !== "object") {
          try {
            var txt = await adapterRequest(urls[i], { headers: hdr, timeout: 12 });
            d = typeof txt === "string" ? (parseLooseJson(txt) || JSON.parse(txt)) : txt;
          } catch (e2) { d = null; }
        }
        var pl = (d && d.playlist) || (d && d.result && d.result.playlist) || null;
        if (!pl) continue;
        var intro = pl.description || pl.desc || pl.introduction || "";
        return {
          intro: normalizeIntroText(intro),
          title: String(pl.name || "").trim(),
          cover: pl.coverImgUrl ? (typeof rankCover === "function" ? rankCover(pl.coverImgUrl) : pl.coverImgUrl) : "",
        };
      }
    } catch (e) { console.warn("fetchPlaylistMetaNetease", e); }
    return { intro: "", title: "", cover: "" };
  }
  async function fetchPlaylistMetaKuwo(pid) {
    try {
      pid = String(pid || "").replace(/^kw_pl_/i, "").trim();
      if (!pid) return { intro: "", title: "", cover: "" };
      var hdr = { Referer: "https://www.kuwo.cn/", Accept: "application/json" };
      var urls = [
        "https://nplserver.kuwo.cn/pl.svc?op=getlistinfo&pid=" + encodeURIComponent(pid) +
          "&pn=0&rn=1&encode=utf8&keyset=pl2012&identity=kuwo&pcmp4=1&vipver=MUSIC_9.0.5.0_BCS31&newver=1",
        "https://wapi.kuwo.cn/api/www/playlist/playListInfo?pid=" + encodeURIComponent(pid) +
          "&pn=0&rn=1&httpsStatus=1",
        "https://m.kuwo.cn/newh5app/wapi/api/www/playlist/playListInfo?pid=" + encodeURIComponent(pid) +
          "&pn=0&rn=1",
      ];
      for (var i = 0; i < urls.length; i++) {
        var d = null;
        try {
          d = await reqFetch(urls[i], { timeout: 10, headers: hdr });
        } catch (e1) {
          try {
            var txt = await adapterRequest(urls[i], { headers: hdr, timeout: 10 });
            d = typeof txt === "string" ? (parseLooseJson(txt) || (typeof parseKuwoBody === "function" ? parseKuwoBody(txt) : null) || JSON.parse(txt)) : txt;
          } catch (e2) { d = null; }
        }
        if (!d) continue;
        var data = d.data || d;
        var intro =
          data.info || data.intro || data.description || data.desc ||
          d.info || d.intro || d.description || "";
        var title = data.name || data.title || data.TITLE || d.name || "";
        var pic = data.pic || data.img || data.pic500 || data.pic300 || data.img700 || "";
        if (pic && typeof kuwoResolvePic === "function") {
          try { pic = kuwoResolvePic(pic, "playlist"); } catch (eP) {}
        }
        if (intro || title) {
          return {
            intro: normalizeIntroText(intro),
            title: String(title || "").trim(),
            cover: pic ? (typeof fixCover === "function" ? fixCover(pic) : pic) : "",
          };
        }
      }
    } catch (e) { console.warn("fetchPlaylistMetaKuwo", e); }
    return { intro: "", title: "", cover: "" };
  }
  async function fetchPlaylistMetaKugou(pid) {
    try {
      pid = String(pid || "").trim();
      if (!pid) return { intro: "", title: "", cover: "" };
      var hdr = { Referer: "https://www.kugou.com/", Accept: "application/json" };
      var urls = [
        "https://mobileservice.kugou.com/api/v5/special/info?specialid=" + encodeURIComponent(pid) +
          "&page=1&pagesize=1&version=9108&apiver=6",
        "https://mobiles.kugou.com/api/v5/special/info?specialid=" + encodeURIComponent(pid) +
          "&page=1&pagesize=1",
        "https://www2.kugou.kugou.com/yueku/v9/special/getSpecial?specialid=" + encodeURIComponent(pid) +
          "&page=1&pagesize=1",
      ];
      for (var i = 0; i < urls.length; i++) {
        var d = null;
        try {
          d = await reqFetch(urls[i], { timeout: 10, headers: hdr });
        } catch (e1) {
          try {
            var txt = await adapterRequest(urls[i], { headers: hdr, timeout: 10 });
            d = typeof txt === "string" ? JSON.parse(txt) : txt;
          } catch (e2) { d = null; }
        }
        if (!d) continue;
        var info = d.data || d.info || d;
        if (Array.isArray(info)) info = info[0] || {};
        // kugou special info often nests under data
        var node = (d.data && !Array.isArray(d.data) && d.data) || info || d;
        var intro =
          node.intro || node.introduction || node.description || node.desc ||
          node.special_intro || node.specialname_intro ||
          (node.info && (node.info.intro || node.info.description)) || "";
        var title = node.specialname || node.special_name || node.name || node.filename || "";
        var cover = node.imgurl || node.imgUrl || node.user_avatar || node.cover || node.pic || "";
        if (cover) cover = String(cover).replace(/\{size\}/g, "480");
        if (intro || title) {
          return {
            intro: normalizeIntroText(intro),
            title: String(title || "").trim(),
            cover: cover ? (typeof fixCover === "function" ? fixCover(cover) : cover) : "",
          };
        }
      }
    } catch (e) { console.warn("fetchPlaylistMetaKugou", e); }
    return { intro: "", title: "", cover: "" };
  }
  async function fetchPlaylistMeta(id, source) {
    source = (source || "qq").toLowerCase();
    id = String(id || "").trim();
    if (!id) return { intro: "", title: "", cover: "" };
    try {
      if (source === "netease") return await fetchPlaylistMetaNetease(id);
      if (source === "kuwo") return await fetchPlaylistMetaKuwo(id);
      if (source === "kugou") return await fetchPlaylistMetaKugou(id);
      // qq / migu fallback to qq-style (migu playlists rare)
      return await fetchPlaylistMetaQQ(id);
    } catch (e) {
      console.warn("fetchPlaylistMeta", source, e);
      return { intro: "", title: "", cover: "" };
    }
  }

  /* ========== 官方榜单：QQ / 网易 / 酷我 / 酷狗（随站源切换） ========== */
  function rankCover(url) {
    if (!url) return "";
    var u = fixCover(String(url).replace(/\{size\}/gi, "480").replace(/http:\/\//i, "https://"));
    return (typeof upgradeCoverUrl === "function") ? upgradeCoverUrl(u, 800) : u;
  }

  async function fetchQQToplistOverview() {
    try {
      var d = null;
      if (typeof musicuJsonp === "function") {
        d = await musicuJsonp({
          comm: { ct: 24, cv: 0 },
          req_0: { module: "musicToplist.ToplistInfoServer", method: "GetAll", param: {} },
        }, 12000);
      }
      if (typeof d === "string") {
        try { d = JSON.parse(d); } catch (e0) {
          try { d = (typeof jsonp_safeParse === "function") ? jsonp_safeParse(d) : null; } catch (e1) { d = null; }
        }
      }
      if (!d || !d.req_0 || !d.req_0.data || !d.req_0.data.group) {
        var body = JSON.stringify({
          comm: { ct: 24, cv: 0 },
          req_0: { module: "musicToplist.ToplistInfoServer", method: "GetAll", param: {} }
        });
        var url =
          "https://u.y.qq.com/cgi-bin/musicu.fcg?_=" + Date.now() +
          "&data=" + encodeURIComponent(body) +
          "&format=jsonp&inCharset=utf8&outCharset=utf-8&platform=yqq.json&needNewCode=0";
        d = await jsonp(url, 12);
      }
      if (!d || !d.req_0 || !d.req_0.data || !d.req_0.data.group) return [];
      var out = [];
      d.req_0.data.group.forEach(function (g) {
        (g.toplist || []).forEach(function (t) {
          out.push({
            topId: t.topId,
            id: t.topId,
            topTitle: t.title,
            title: t.title,
            name: t.title || "榜单",
            intro: t.intro || t.titleDetail || "",
            update_key: t.updateTime || t.period || "",
            update: t.updateTime || t.period || "",
            frontPicUrl: rankCover(t.headPicUrl || t.frontPicUrl || t.picUrl || ""),
            pic: rankCover(t.headPicUrl || t.frontPicUrl || t.picUrl || ""),
            cover: rankCover(t.headPicUrl || t.frontPicUrl || t.picUrl || ""),
            type: "toplist",
            source: "qq",
          });
        });
      });
      return out;
    } catch (e) {
      console.warn("qq toplist overview", e);
      return [];
    }
  }

  async function fetchNeteaseToplistOverview() {
    var FALLBACK = [
      { id: "19723756", name: "飙升榜", updateFrequency: "每天更新" },
      { id: "3779629", name: "新歌榜", updateFrequency: "每天更新" },
      { id: "3778678", name: "热歌榜", updateFrequency: "每周更新" },
      { id: "2884035", name: "原创榜", updateFrequency: "每周更新" },
      { id: "1978921795", name: "电音榜", updateFrequency: "每周更新" },
      { id: "5059661515", name: "网络热歌榜", updateFrequency: "每周更新" },
      { id: "991319590", name: "说唱榜", updateFrequency: "每周更新" },
      { id: "71385702", name: "古典音乐榜", updateFrequency: "每周更新" },
      { id: "180106", name: "UK排行榜", updateFrequency: "每周更新" },
      { id: "60198", name: "美国Billboard", updateFrequency: "每周更新" },
      { id: "11641012", name: "iTunes榜", updateFrequency: "每周更新" },
      { id: "120001", name: "Hit FM Top", updateFrequency: "每周更新" },
    ];
    function normalize(list) {
      return (list || []).map(function (t) {
        var id = t.id || t.playlistId;
        if (!id) return null;
        return {
          topId: id,
          id: id,
          name: t.name || t.title || "榜单",
          title: t.name || t.title || "",
          intro: t.description || t.updateFrequency || t.updateFreq || "",
          update: t.updateFrequency || t.updateFreq || "",
          cover: rankCover(t.coverImgUrl || t.cover || t.picUrl || ""),
          type: "toplist",
          source: "netease",
          playCount: t.playCount || 0,
        };
      }).filter(Boolean);
    }
    try {
      var url = "https://music.163.com/api/toplist";
      var hdr = {
        Referer: "https://music.163.com/",
        Origin: "https://music.163.com",
        Accept: "*/*",
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 CloudMusic/8.9.0",
      };
      var d = null;
      try {
        d = await reqFetch(url, { timeout: 12, headers: hdr });
      } catch (e1) { d = null; }
      if (!d || !(d.list || d.toplist)) {
        try {
          var txt = await adapterRequest(url, { headers: hdr, timeout: 12 });
          d = typeof txt === "string" ? (parseLooseJson(txt) || JSON.parse(txt)) : txt;
        } catch (e2) { d = null; }
      }
      var list = (d && (d.list || d.toplist || (d.data && d.data.list))) || [];
      var out = normalize(list);
      if (out.length >= 4) return out.slice(0, 24);
      return normalize(FALLBACK);
    } catch (e) {
      console.warn("netease toplist overview", e);
      return normalize(FALLBACK);
    }
  }

  /** 酷我榜单树：递归 child，叶子节点 sourceid 为真实 bangId */
  function walkKuwoBangTree(node, out) {
    if (!node) return;
    var children = node.child || node.children || [];
    if (children && children.length) {
      for (var i = 0; i < children.length; i++) walkKuwoBangTree(children[i], out);
      return;
    }
    var bangId = node.sourceid || node.SOURCEID || node.sourceId || "";
    var id = bangId || node.id || node.bangId || "";
    if (!id) return;
    // 过滤纯分类壳（无图且无 sourceid 的往往是空壳）
    var name = node.name || node.NAME || node.disname || node.title || "";
    if (!name) return;
    var pic = node.pic5 || node.pic || node.pic2 || node.img || node.PIC || node.pic240 || node.pic120 || "";
    // 酷我常返回相对路径，必须用 kuwoResolvePic 拼完整 CDN
    pic = typeof kuwoResolvePic === "function" ? kuwoResolvePic(pic, "album") : pic;
    out.push({
      topId: String(id),
      id: String(id),
      bangId: String(bangId || id),
      name: name,
      title: name,
      intro: node.intro || node.tips || node.pub || "",
      cover: rankCover(pic),
      type: "toplist",
      source: "kuwo",
    });
  }

  async function fetchKuwoToplistOverview() {
    try {
      var urls = [
        "https://wapi.kuwo.cn/api/pc/bang/list?pn=1&rn=100&httpsStatus=1",
        "https://wapi.kuwo.cn/api/pc/bang/list?httpsStatus=1",
      ];
      var hdr = { Referer: "https://www.kuwo.cn/", Accept: "application/json, text/plain, */*" };
      var d = null;
      for (var ui = 0; ui < urls.length && !d; ui++) {
        try {
          d = await reqFetch(urls[ui], { timeout: 10, headers: hdr });
        } catch (e1) { d = null; }
        if (!d || (typeof d === "object" && !d.child && !d.data && !d.name)) {
          try {
            var txt = await adapterRequest(urls[ui], { headers: hdr, timeout: 10 });
            d = typeof txt === "string" ? (parseLooseJson(txt) || JSON.parse(txt)) : txt;
          } catch (e2) { d = null; }
        }
      }
      if (!d) return [];
      var out = [];
      // 根可能是 {child:[...]} 或 {data:{child}} 或数组
      if (Array.isArray(d)) {
        d.forEach(function (n) { walkKuwoBangTree(n, out); });
      } else if (d.data && (d.data.child || d.data.list)) {
        walkKuwoBangTree(d.data, out);
        if (!out.length && Array.isArray(d.data.list)) {
          d.data.list.forEach(function (n) { walkKuwoBangTree(n, out); });
        }
      } else {
        walkKuwoBangTree(d, out);
      }
      // 去重
      var seen = {}, uniq = [];
      out.forEach(function (x) {
        var k = String(x.id);
        if (seen[k]) return;
        seen[k] = 1;
        uniq.push(x);
      });
      return uniq;
    } catch (e) {
      console.warn("kuwo toplist overview", e);
      return [];
    }
  }

  async function fetchKugouToplistOverview() {
    try {
      var urls = [
        "https://mobileservice.kugou.com/api/v5/rank/list?version=9108&plat=0&showtype=2&parentid=0&apiver=6&area_code=1&withsong=1",
        "https://m.kugou.com/rank/list&json=true",
      ];
      var hdr = { Referer: "https://www.kugou.com/", Accept: "application/json, text/plain, */*" };
      var d = null;
      for (var ui = 0; ui < urls.length && !d; ui++) {
        try {
          d = await reqFetch(urls[ui], { timeout: 10, headers: hdr });
        } catch (e1) { d = null; }
        if (!d || !(d.data || d.rank || d.list)) {
          try {
            var txt = await adapterRequest(urls[ui], { headers: hdr, timeout: 10 });
            d = typeof txt === "string" ? (parseLooseJson(txt) || JSON.parse(txt)) : txt;
          } catch (e2) { d = null; }
        }
      }
      if (!d) return [];
      var info =
        (d.data && d.data.info) ||
        (d.rank && d.rank.list) ||
        d.info ||
        d.list ||
        [];
      if (!Array.isArray(info)) info = [];
      var out = [];
      info.forEach(function (t) {
        // 必须用 rankid（如 8888），不要用列表内部 id（如 2）
        var id = t.rankid != null ? t.rankid : (t.rank_id != null ? t.rank_id : t.id);
        if (id == null || id === "") return;
        var pic =
          t.img_9 || t.imgurl || t.img_cover || t.banner_9 || t.bannerurl ||
          t.album_img_9 || t.album_img || "";
        if (pic) pic = String(pic).replace(/\{size\}/gi, "400");
        out.push({
          topId: String(id),
          id: String(id),
          name: t.rankname || t.rank_name || t.classname || t.name || "榜单",
          title: t.rankname || t.rank_name || "",
          intro: t.intro || t.update_frequency || "",
          cover: rankCover(pic),
          type: "toplist",
          source: "kugou",
          ranktype: t.ranktype != null ? t.ranktype : 1,
        });
      });
      return out;
    } catch (e) {
      console.warn("kugou toplist overview", e);
      return [];
    }
  }

  async function fetchToplistOverview() {
    var plat = S.platform || "qq";
    try {
      var list = [];
      if (plat === "netease") list = await fetchNeteaseToplistOverview();
      else if (plat === "kuwo") list = await fetchKuwoToplistOverview();
      else if (plat === "kugou") list = await fetchKugouToplistOverview();
      else list = await fetchQQToplistOverview();
      if (!list || !list.length) {
        console.warn("[rank] empty for", plat);
      } else {
        console.info("[rank]", plat, "got", list.length);
      }
      return list || [];
    } catch (e) {
      console.warn("toplist overview", e);
      return [];
    }
  }

  async function fetchQQToplistDetail(topid) {
    try {
      var d = null;
      if (typeof musicuJsonp === "function") {
        d = await musicuJsonp({
          comm: { ct: 24, cv: 0 },
          req_0: {
            module: "musicToplist.ToplistInfoServer",
            method: "GetDetail",
            param: { topId: Number(topid) || 62, offset: 0, num: 100, period: "" },
          },
        }, 12000);
      }
      if (typeof d === "string") {
        try { d = JSON.parse(d); } catch (e0) {
          try { d = (typeof jsonp_safeParse === "function") ? jsonp_safeParse(d) : null; } catch (e1) { d = null; }
        }
      }
      if (!d || !d.req_0 || !d.req_0.data) {
        var body = JSON.stringify({
          comm: { ct: 24, cv: 0 },
          req_0: {
            module: "musicToplist.ToplistInfoServer",
            method: "GetDetail",
            param: { topId: Number(topid) || 62, offset: 0, num: 100, period: "" },
          },
        });
        var url =
          "https://u.y.qq.com/cgi-bin/musicu.fcg?_=" + Date.now() +
          "&data=" + encodeURIComponent(body) +
          "&format=jsonp&inCharset=utf8&outCharset=utf-8&platform=yqq.json&needNewCode=0";
        d = await jsonp(url, 12);
      }
      if (!d || !d.req_0 || !d.req_0.data) return { info: {}, songs: [] };
      var data = d.req_0.data;
      var infoRaw = data.data || {};
      var songs = (data.songInfoList || []).map(function (s) {
        var amid = (s.album && (s.album.mid || s.album.pmid)) || s.albummid || "";
        var singer = (s.singer || []).map(function (a) { return a.name; }).filter(Boolean).join("/");
        return normSong({
          mid: s.mid,
          songmid: s.mid,
          name: s.title || s.name,
          title: s.title || s.name,
          singer: singer,
          artist: singer,
          albummid: amid,
          albumMid: amid,
          albumname: s.album && (s.album.title || s.album.name),
          cover: (s.album && s.album.pic) || s.pic || (amid ? coverUrl(amid) : ""),
          interval: s.interval || 0,
          source: "qq",
        });
      }).filter(Boolean);
      return {
        info: {
          title: infoRaw.title || infoRaw.titleDetail || "",
          topTitle: infoRaw.title || "",
          cover: rankCover(infoRaw.headPicUrl || infoRaw.frontPicUrl || infoRaw.picUrl || ""),
          frontPicUrl: rankCover(infoRaw.headPicUrl || ""),
          intro: infoRaw.intro || "",
          playCount: infoRaw.listenNum || 0,
        },
        songs: songs,
      };
    } catch (e) {
      console.warn("qq toplist detail", e);
      return { info: {}, songs: [] };
    }
  }

  async function fetchNeteaseToplistDetail(topid) {
    try {
      var pid = String(topid || "").replace(/^ne_pl_/i, "").replace(/\D/g, "").trim();
      if (!pid) return { info: {}, songs: [] };
      var hdr = {
        Referer: "https://music.163.com/",
        Origin: "https://music.163.com",
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 CloudMusic/8.9.0",
      };
      // 榜单本质是特殊歌单：用 n=100000 拿全量 trackIds，再分批补全详情
      var urls = [
        "https://music.163.com/api/v6/playlist/detail?id=" + encodeURIComponent(pid) + "&n=100000",
        "https://music.163.com/api/v1/playlist/detail?id=" + encodeURIComponent(pid) + "&n=100000",
        "https://music.163.com/api/toplist/detail?id=" + encodeURIComponent(pid),
        "https://music.163.com/api/playlist/detail?id=" + encodeURIComponent(pid),
      ];
      var info = { title: "", cover: "", intro: "" };
      var pl = null;
      var d = null;
      for (var ui = 0; ui < urls.length; ui++) {
        d = null;
        try {
          d = await reqFetch(urls[ui], { timeout: 18, headers: hdr });
        } catch (e1) { d = null; }
        if (!d || typeof d !== "object") {
          try {
            var txt = await adapterRequest(urls[ui], { headers: hdr, timeout: 18 });
            d = typeof txt === "string" ? (parseLooseJson(txt) || JSON.parse(txt)) : txt;
          } catch (e2) { d = null; }
        }
        if (!d) continue;
        pl = d.playlist || (d.result && d.result.playlist) || null;
        // toplist/detail 可能直接给 songs
        if (!pl && Array.isArray(d.songs) && d.songs.length) {
          pl = { name: (d.list && d.list.name) || "", coverImgUrl: "", tracks: d.songs, trackIds: d.songs.map(function (s) { return { id: s.id }; }) };
        }
        if (pl) break;
      }
      if (!pl) {
        try {
          var fallback = await neteasePlaylistSongs(pid);
          return { info: info, songs: fallback || [] };
        } catch (e5) {
          return { info: info, songs: [] };
        }
      }
      if (pl.name) info.title = pl.name;
      if (pl.coverImgUrl) info.cover = rankCover(pl.coverImgUrl);
      if (pl.description) info.intro = String(pl.description).replace(/\n+/g, " ").trim();

      var trackMap = {};
      var tracks = pl.tracks || [];
      if (Array.isArray(tracks)) {
        tracks.forEach(function (t) {
          if (t && t.id != null) trackMap[String(t.id)] = t;
        });
      }
      var trackIds = [];
      if (Array.isArray(pl.trackIds) && pl.trackIds.length) {
        trackIds = pl.trackIds.map(function (t) {
          return (t && (t.id != null ? t.id : t)) || "";
        }).filter(Boolean);
      }
      if (!trackIds.length && tracks.length) {
        trackIds = tracks.map(function (t) { return t && t.id; }).filter(Boolean);
      }
      trackIds = trackIds.slice(0, 500);
      var missing = trackIds.filter(function (tid) { return !trackMap[String(tid)]; });
      if (missing.length) {
        var fetched = await neteaseFetchSongDetails(missing, hdr);
        (fetched || []).forEach(function (s) {
          if (s && s.id != null) trackMap[String(s.id)] = s;
        });
      }
      var songs = [];
      trackIds.forEach(function (tid) {
        var m = mapNeteaseTrack(trackMap[String(tid)]);
        if (m && m.name && m.songmid) songs.push(m);
      });
      if (!songs.length && tracks.length) {
        songs = tracks.map(mapNeteaseTrack).filter(function (s) { return s && s.name && s.songmid; });
      }
      if (!songs.length) {
        try {
          songs = await neteasePlaylistSongs(pid);
        } catch (e6) { songs = []; }
      }
      return { info: info, songs: songs || [] };
    } catch (e) {
      console.warn("netease toplist detail", e);
      return { info: {}, songs: [] };
    }
  }

  function mapKuwoBangSong(s) {
    if (!s) return null;
    var id = s.rid || s.id || s.musicrid || s.MUSICRID || s.songid || "";
    id = String(id).replace(/^MUSIC_/i, "").trim();
    var name = s.name || s.SONGNAME || s.songName || s.songname || s.N || "";
    var artist = s.artist || s.ARTIST || s.singer || s.artist_name || s.singername || s.ARTISTNAME || "";
    var albumId = s.albumid || s.ALBUMID || s.albumId || s.albummid || "";
    // 只认真实图片 URL / 可解析路径；禁止用纯数字 albumid 拼假 CDN（会 404）
    var coverRaw =
      s.pic || s.PIC || s.albumpic || s.hts_albumpic || s.web_albumpic_short ||
      s.img || s.hts_png || s.pic500 || s.pic120 || s.album_pic || s.MVPIC || s.hts_MVPIC ||
      s.v9_pic2 || "";
    var cover = "";
    if (coverRaw) {
      cover = typeof kuwoResolvePic === "function" ? kuwoResolvePic(coverRaw, "album") : String(coverRaw);
      cover = String(cover || "")
        .replace(/\/120\//g, "/500/")
        .replace(/\/120\b/g, "/500")
        .replace(/_120\./g, "_500.")
        .replace(/_150\./g, "_500.");
      cover = rankCover(cover);
      // 过滤明显无效：只有 base 无文件、或纯数字后缀
      if (cover && (/\/albumcover\/?\d+$/i.test(cover) || /\/albumcover\/?$/i.test(cover))) {
        cover = "";
      }
    }
    if (!name || !id) return null;
    return {
      name: stripEm(String(name)),
      artist: stripEm(String(artist)) || "未知",
      songmid: String(id),
      id: String(id),
      albummid: String(albumId || ""),
      cover: cover || "",
      source: "kuwo",
      kuwoId: id,
      rid: String(id),
    };
  }

  /** 对缺封面的酷我歌曲批量拉 musicInfo 补图（限量，避免卡顿） */
  async function fillKuwoSongCovers(songs, limit) {
    songs = songs || [];
    limit = Math.min(limit || 200, songs.length);
    var need = [];
    for (var i = 0; i < songs.length && need.length < limit; i++) {
      if (songs[i] && !songs[i].cover) need.push(songs[i]);
    }
    if (!need.length) return songs;
    var hdr = { Referer: "https://www.kuwo.cn/", Accept: "application/json, text/plain, */*" };
    var batch = 6;
    for (var off = 0; off < need.length; off += batch) {
      var slice = need.slice(off, off + batch);
      await Promise.all(slice.map(function (song) {
        return (async function () {
          var mid = song.rid || song.kuwoId || song.songmid || song.id;
          if (!mid) return;
          var url = "https://wapi.kuwo.cn/api/www/music/musicInfo?mid=" + encodeURIComponent(mid) + "&httpsStatus=1";
          try {
            var d = null;
            try {
              d = await reqFetch(url, { timeout: 6, headers: hdr });
            } catch (e1) {
              var txt = await adapterRequest(url, { headers: hdr, timeout: 6 });
              d = typeof txt === "string" ? (parseLooseJson(txt) || parseKuwoBody(txt) || JSON.parse(txt)) : txt;
            }
            var data = (d && d.data) || d || {};
            var pic = data.pic || data.albumpic || data.pic120 || "";
            if (pic) {
              pic = typeof kuwoResolvePic === "function" ? kuwoResolvePic(pic, "album") : pic;
              pic = String(pic).replace(/\/120\//g, "/500/").replace(/_120\./g, "_500.");
              song.cover = rankCover(pic) || fixCover(pic);
            }
          } catch (e2) {}
        })();
      }));
    }
    return songs;
  }

  async function fetchKuwoToplistDetail(topid) {
    try {
      var bangId = String(topid || "").replace(/^MUSIC_/i, "").trim();
      if (!bangId) return { info: {}, songs: [] };
      var hdr = { Referer: "https://www.kuwo.cn/", Accept: "application/json, text/plain, */*" };
      var info = { title: "", cover: "", intro: "" };
      var all = [];
      var seen = {};
      var pageSize = 100;
      var maxPages = 5;

      function mapBangList(list) {
        if (!Array.isArray(list)) return [];
        return list.map(function (s) {
          var m = typeof mapKuwoBangSong === "function" ? mapKuwoBangSong(s) : null;
          if (!m) {
            var id = String(s.rid || s.id || s.musicrid || "").replace(/^MUSIC_/i, "").trim();
            var name = s.name || s.SONGNAME || s.songName || "";
            if (!id || !name || seen[id]) return null;
            seen[id] = 1;
            return {
              name: name,
              artist: s.artist || s.ARTIST || s.singer || "未知",
              songmid: id, id: id, rid: id, kuwoId: id,
              albummid: String(s.albumid || ""),
              cover: "",
              source: "kuwo",
            };
          }
          if (seen[m.songmid]) return null;
          seen[m.songmid] = 1;
          return m;
        }).filter(Boolean);
      }

      async function fetchPage(pn) {
        var urls = [
          "https://wapi.kuwo.cn/api/www/bang/bang/musicList?bangId=" + encodeURIComponent(bangId) + "&pn=" + pn + "&rn=" + pageSize + "&httpsStatus=1",
          "https://m.kuwo.cn/newh5app/wapi/api/www/bang/bang/musicList?bangId=" + encodeURIComponent(bangId) + "&pn=" + pn + "&rn=" + pageSize + "&httpsStatus=1",
          "https://kbangserver.kuwo.cn/ksong.s?from=pc&fmt=json&pn=" + pn + "&rn=" + pageSize + "&type=bang&id=" + encodeURIComponent(bangId),
        ];
        for (var i = 0; i < urls.length; i++) {
          var d = null;
          try {
            d = await reqFetch(urls[i], { timeout: 12, headers: hdr });
          } catch (e1) { d = null; }
          if (!d) {
            try {
              var txt0 = await adapterRequest(urls[i], { headers: hdr, timeout: 12 });
              if (txt0) d = typeof txt0 === "string" ? (parseLooseJson(txt0) || parseKuwoBody(txt0) || JSON.parse(txt0)) : txt0;
            } catch (eA) { d = null; }
          }
          if (!d) continue;
          if (typeof d === "string") {
            try { d = parseLooseJson(d) || parseKuwoBody(d) || JSON.parse(d); } catch (e3) { continue; }
          }
          var data = d.data || d;
          if (data.name || data.NAME || data.bangName) {
            info.title = data.name || data.NAME || data.bangName || info.title || "";
          }
          if (data.info || data.intro) info.intro = data.info || data.intro || info.intro || "";
          var pic = data.pic || data.img || data.pic500 || data.pic300 || "";
          if (pic) info.cover = rankCover(typeof kuwoResolvePic === "function" ? kuwoResolvePic(pic, "playlist") : pic);
          var list =
            data.musicList || data.musiclist || data.list || data.songlist ||
            d.musiclist || d.musicList || d.list || data.abslist || [];
          if (!Array.isArray(list) || !list.length) continue;
          return mapBangList(list);
        }
        return [];
      }

      for (var page = 0; page < maxPages; page++) {
        var batch = await fetchPage(page);
        if (!batch.length) break;
        all = all.concat(batch);
        if (batch.length < pageSize) break;
      }
      if (all.length) {
        try { all = await fillKuwoSongCovers(all, Math.min(all.length, 300)); } catch (eFill) {}
      }
      return { info: info, songs: all };
    } catch (e) {
      console.warn("kuwo toplist detail", e);
      return { info: {}, songs: [] };
    }
  }

  async function fetchKugouToplistDetail(topid, ranktype) {
    try {
      var rawId = String(topid || "").trim();
      if (!rawId) return { info: {}, songs: [] };
      var types = [];
      [ranktype, 1, 2, 0].forEach(function (t) {
        if (t == null || t === "") return;
        t = Number(t);
        if (isNaN(t)) return;
        if (types.indexOf(t) < 0) types.push(t);
      });
      if (!types.length) types = [1, 2];

      var hdr = { Referer: "https://www.kugou.com/", Accept: "application/json, text/plain, */*" };
      var songs = [];
      var info = { title: "", cover: "" };

      function mapKugouSongs(list) {
        if (!Array.isArray(list)) return [];
        return list.map(function (s) {
          if (!s || typeof s !== "object") return null;
          var hash = s.hash || s.FileHash || s.sqhash || s.HQFileHash || s["320hash"] || "";
          var name = s.songname || s.SongName || s.song_name || "";
          var artist = s.singername || s.SingerName || s.author_name || s.choric_singer || s.author || "";
          if (!name && s.filename) {
            var fn = String(s.filename);
            var idx = fn.indexOf(" - ");
            if (idx > 0) {
              artist = artist || fn.slice(0, idx);
              name = fn.slice(idx + 3);
            } else name = fn;
          }
          if (!name && s.name) {
            name = s.name;
            artist = artist || s.author || "";
          }
          var cover = s.album_img || s.album_sizable_cover || s.imgUrl || s.album_cover || s.sizable_cover || "";
          if (!cover && s.trans_param && s.trans_param.union_cover) cover = s.trans_param.union_cover;
          if (cover) cover = String(cover).replace(/\{size\}/gi, "240");
          if (!name) return null;
          var mid = hash || String(s.audio_id || s.album_audio_id || "");
          if (!mid) return null;
          if (!artist && Array.isArray(s.authors)) {
            artist = s.authors.map(function (a) { return a.author_name || a.name; }).filter(Boolean).join(" / ");
          }
          return {
            name: name,
            artist: artist || "未知",
            songmid: mid,
            id: mid,
            hash: hash,
            album_id: s.album_id || "",
            cover: rankCover(cover),
            source: "kugou",
            kugouHash: hash,
          };
        }).filter(Boolean);
      }

      async function tryUrl(url) {
        var d = null;
        try {
          var txt = await adapterRequest(url, { headers: hdr, timeout: 12 });
          if (txt) d = typeof txt === "string" ? (parseLooseJson(txt) || JSON.parse(txt)) : txt;
        } catch (eA) { d = null; }
        if (!d) {
          try {
            d = await reqFetch(url, { timeout: 12, headers: hdr });
          } catch (eR) { d = null; }
        }
        if (!d) return null;
        if (typeof d === "string") {
          try { d = parseLooseJson(d) || JSON.parse(d); } catch (eP) { return null; }
        }
        return d;
      }

      for (var ti = 0; ti < types.length && !songs.length; ti++) {
        var rt = types[ti];
        var rid = encodeURIComponent(rawId);
        var urls = [
          "https://mobileservice.kugou.com/api/v3/rank/song?version=9108&ranktype=" + rt +
            "&rankid=" + rid + "&page=1&pagesize=100&area_code=1&apiver=6&with_cover=1",
          "https://mobileservice.kugou.com/api/v3/rank/song?rankid=" + rid +
            "&page=1&pagesize=100&ranktype=" + rt + "&version=9108&apiver=6",
          "https://mobi.kugou.com/api/v5/rank/song?version=9108&rankid=" + rid +
            "&ranktype=" + rt + "&page=1&pagesize=100&area_code=1",
        ];
        for (var i = 0; i < urls.length && !songs.length; i++) {
          var d = await tryUrl(urls[i]);
          if (!d) continue;
          var list =
            (d.data && Array.isArray(d.data.info) && d.data.info) ||
            (d.data && Array.isArray(d.data.list) && d.data.list) ||
            (d.data && Array.isArray(d.data.songs) && d.data.songs) ||
            (Array.isArray(d.songs) && d.songs) ||
            (Array.isArray(d.info) && d.info) ||
            [];
          var mapped = mapKugouSongs(list);
          if (mapped.length) {
            songs = mapped;
            if (d.data && (d.data.rankname || d.data.rank_name)) {
              info.title = d.data.rankname || d.data.rank_name;
            }
          }
        }
      }
      return { info: info, songs: songs };
    } catch (e) {
      console.warn("kugou toplist detail", e);
      return { info: {}, songs: [] };
    }
  }

  async function fetchToplistDetail(topid, source, board) {
    var src = source || (board && board.source) || "qq";
    try {
      if (src === "netease") return await fetchNeteaseToplistDetail(topid);
      if (src === "kuwo") return await fetchKuwoToplistDetail((board && board.bangId) || topid);
      if (src === "kugou") return await fetchKugouToplistDetail(topid, board && board.ranktype);
      return await fetchQQToplistDetail(topid);
    } catch (e) {
      console.warn("toplist detail", e);
      return { info: {}, songs: [] };
    }
  }

  var homeRankPool = [];
  var RANK_SHOW_N = 12;

  function pickRankBatch(pool, n) {
    var arr = (pool || []).slice();
    if (!arr.length) return [];
    // 洗牌后取前 n；不足则全取
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr.slice(0, Math.min(n || RANK_SHOW_N, arr.length));
  }

  function renderHomeRanks(list) {
    var box = $("#homeRankGrid");
    if (!box) return;
    box.innerHTML = "";
    if (!list || !list.length) {
      box.innerHTML = '<div class="empty" style="grid-column:1/-1;padding:16px;font-size:13px;color:var(--label-3)">榜单暂不可用</div>';
      return;
    }
    // 默认只展示 12 个，其余通过「换一批」随机替换
    list.forEach(function (board) {
      var el = document.createElement("div");
      el.className = "rank-card";
      var title = board.name || board.title || "榜单";
      el.innerHTML =
        '<div class="rank-cover">' +
        '<img alt="" referrerpolicy="no-referrer"/>' +
        '<div class="rank-on-cover"></div>' +
        '</div>' +
        '<div class="rank-name"></div>';
      var img = el.querySelector("img");
      img.onerror = function () { this.onerror = null; this.src = PLACEHOLDER; };
      img.src = board.cover || PLACEHOLDER;
      el.querySelector(".rank-on-cover").textContent = title;
      el.querySelector(".rank-name").textContent = title;
      el.addEventListener("click", function () {
        openToplistDetail(board);
      });
      box.appendChild(el);
    });
  }

  function refreshHomeRanksBatch() {
    if (!homeRankPool.length) {
      loadHomeRanks();
      return;
    }
    var batch = pickRankBatch(homeRankPool, RANK_SHOW_N);
    renderHomeRanks(batch);
    try { toast("已换一批榜单"); } catch (e) {}
  }

  async function loadHomeRanks() {
    var box = $("#homeRankGrid");
    var platName = (typeof platDisplayName === "function") ? platDisplayName() : (S.platform || "QQ");
    if (box) box.innerHTML = '<div class="empty" style="grid-column:1/-1;padding:16px;font-size:13px;color:var(--label-3)">加载' + platName + '榜单…</div>';
    var list = [];
    try {
      list = await fetchToplistOverview();
    } catch (e) {
      console.warn("loadHomeRanks", e);
      list = [];
    }
    homeRankPool = list || [];
    if (!homeRankPool.length) {
      if (box) {
        box.innerHTML = '<div class="empty" style="grid-column:1/-1;padding:16px;font-size:13px;color:var(--label-3)">' +
          platName + '榜单暂时拉不到（网络/跨域）· 可点「换一批」重试</div>';
      }
      return list;
    }
    renderHomeRanks(pickRankBatch(homeRankPool, RANK_SHOW_N));
    return list;
  }


  /* ========== 沉浸式歌单/榜单详情页（非弹窗，对齐 squid 模糊墙 + 封面融合） ========== */
  var detailState = {
    songs: [],
    info: {},
    cover: "",
    title: "",
    kind: "", // playlist | toplist
    source: "",
    id: "",
    loading: false,
  };
  var detailHistoryPushed = false;
  var _detailIgnorePop = 0;
  var _detailWallSeq = 0;
  var _detailWallUrl = "";

  function isUsableCover(url) {
    var src = String(url || "").trim();
    if (!src) return false;
    if (typeof PLACEHOLDER !== "undefined" && src === PLACEHOLDER) return false;
    if (/data:image\/svg/i.test(src)) return false;
    if (/\/albumcover\/?\d+$/i.test(src)) return false;
    if (/^https?:\/\//i.test(src) || src.indexOf("//") === 0) return true;
    return false;
  }

  function detailWallSet(url, opts) {
    opts = opts || {};
    try {
      var amb = document.getElementById("detailWallAmb");
      if (!amb) return;
      var src = String(url || "").trim();
      // 空/占位：保留当前已显示的模糊墙，绝不冲掉
      if (!isUsableCover(src)) {
        if (opts.forceClear) {
          amb.classList.remove("on");
          amb.style.backgroundImage = "";
          _detailWallUrl = "";
        }
        return;
      }
      if (_detailWallUrl === src && amb.classList.contains("on")) return;
      var prevUrl = _detailWallUrl;
      var hadOn = amb.classList.contains("on");
      var prevBg = amb.style.backgroundImage || "";
      _detailWallSeq++;
      var seq = _detailWallSeq;
      _detailWallUrl = src;
      var img = new Image();
      img.referrerPolicy = "no-referrer";
      img.onload = function () {
        if (seq !== _detailWallSeq) return;
        amb.style.backgroundImage = 'url("' + src.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '")';
        amb.classList.add("on");
      };
      img.onerror = function () {
        if (seq !== _detailWallSeq) return;
        // 新图失败：回退上一张，不要清空
        if (prevUrl && isUsableCover(prevUrl) && hadOn) {
          _detailWallUrl = prevUrl;
          if (prevBg) amb.style.backgroundImage = prevBg;
          amb.classList.add("on");
        }
      };
      img.src = src;
    } catch (e) {}
  }

  /** 设置顶部海报：升到最高清；失败不冲掉已有图 */
  function applyDetailCover(url, opts) {
    opts = opts || {};
    var src = String(url || "").trim();
    if (!isUsableCover(src)) return false;
    var lo = fixCover(src);
    var hi = (typeof upgradeCoverUrl === "function") ? upgradeCoverUrl(lo, 800) : lo;
    var heroImg = document.getElementById("detailHeroImg");
    if (detailState.cover === hi && !opts.force) {
      detailWallSet(hi);
      return true;
    }
    detailState.cover = hi;
    if (heroImg) {
      var prev = heroImg.getAttribute("src") || heroImg.src || "";
      heroImg.onerror = function () {
        // 高清失败 → 原图 → 上一张
        if (hi && lo && this.src === hi && lo !== hi) {
          this.onerror = function () {
            this.onerror = null;
            if (prev && isUsableCover(prev)) this.src = prev;
          };
          this.src = lo;
          return;
        }
        this.onerror = null;
        if (prev && isUsableCover(prev)) this.src = prev;
      };
      heroImg.src = hi;
    }
    detailWallSet(hi);
    return true;
  }

  function detailWallClear() {
    try {
      _detailWallSeq++;
      _detailWallUrl = "";
      var amb = document.getElementById("detailWallAmb");
      if (amb) {
        amb.classList.remove("on");
        amb.style.backgroundImage = "";
      }
    } catch (e) {}
  }

  function isDetailOpen() {
    var dp = document.getElementById("detailPage");
    return !!(dp && dp.classList.contains("open"));
  }

  function renderDetailSongRows(songs) {
    var box = document.getElementById("detailSongList");
    if (!box) return;
    box.innerHTML = "";
    if (!songs || !songs.length) {
      box.innerHTML = '<div class="detail-load-tip" style="padding:40px 12px">暂无歌曲</div>';
      return;
    }
    var curKey = "";
    try {
      if (S.queue && S.queue[S.idx]) curKey = keyOf(S.queue[S.idx]);
    } catch (e) {}
    songs.forEach(function (s, i) {
      if (!s) return;
      var row = document.createElement("div");
      row.className = "detail-song-row" + (curKey && keyOf(s) === curKey ? " playing" : "");
      row.dataset.i = String(i);
      var idx = document.createElement("div");
      idx.className = "detail-song-idx";
      idx.textContent = String(i + 1);
      var art = document.createElement("img");
      art.className = "detail-song-art";
      art.alt = "";
      art.referrerPolicy = "no-referrer";
      art.loading = "lazy";
      art.onerror = function () { this.onerror = null; this.src = PLACEHOLDER; };
      // 封面：优先歌曲自身，其次歌单/榜单封面
      var coverSrc = "";
      try {
        if (typeof songCover === "function") coverSrc = songCover(s) || "";
        else if (typeof coverUrl === "function" && s.albummid) coverSrc = coverUrl(s.albummid) || "";
      } catch (eC) {}
      if (!coverSrc) coverSrc = s.cover || s.pic || s.album_img || "";
      if (!coverSrc) coverSrc = detailState.cover || PLACEHOLDER;
      art.src = coverSrc || PLACEHOLDER;
      var meta = document.createElement("div");
      meta.className = "detail-song-meta";
      var name = document.createElement("div");
      name.className = "detail-song-name";
      name.textContent = s.name || "未知";
      var sub = document.createElement("div");
      sub.className = "detail-song-sub";
      sub.textContent = (s.artist || "未知") + (s.album ? " · " + s.album : "");
      meta.appendChild(name);
      meta.appendChild(sub);
      var side = document.createElement("div");
      side.className = "detail-song-side";
      var dur = document.createElement("span");
      dur.className = "detail-song-dur";
      var sec = songDurationSec(s);
      dur.textContent = sec > 0 ? fmt(sec) : "";
      var likeBtn = document.createElement("button");
      likeBtn.type = "button";
      likeBtn.className = "detail-song-like" + (isSongLiked(s) ? " on" : "");
      likeBtn.setAttribute("aria-label", "喜欢");
      try { likeBtn.setAttribute("data-sk", keyOf(s)); } catch (eSk) {}
      likeBtn.innerHTML = heartSvg();
      likeBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        e.preventDefault();
        toggleFav(s);
      });
      side.appendChild(dur);
      side.appendChild(likeBtn);
      row.appendChild(idx);
      row.appendChild(art);
      row.appendChild(meta);
      row.appendChild(side);
      row.addEventListener("click", function (e) {
        if (e.target.closest(".detail-song-like")) return;
        play(s, detailState.songs);
      });
      box.appendChild(row);
    });
  }

  function closeDetailPage(fromPop, alreadyAnimated) {
    var dp = document.getElementById("detailPage");
    // 无论如何清掉 detail-open，避免顶栏/底栏样式被锁死
    try { document.documentElement.classList.remove("detail-open"); } catch (e0) {}
    // 退出后恢复迷你条正常态（有队列则保持 show）
    try {
      var miniEl = document.getElementById("mini");
      if (miniEl) {
        if (S.queue && S.queue.length) miniEl.classList.add("show");
        // 清掉可能残留的 inline 尺寸
        miniEl.style.height = "";
        miniEl.style.minHeight = "";
        miniEl.style.width = "";
        miniEl.style.flex = "";
        miniEl.style.margin = "";
        miniEl.style.padding = "";
        miniEl.style.transform = "";
        miniEl.style.opacity = "";
      }
    } catch (eMiniC) {}
    if (!dp) return;
    if (!dp.classList.contains("open") && !alreadyAnimated) return;
    dp.classList.add("closing");
    dp.classList.remove("open");
    setTimeout(function () {
      dp.classList.remove("closing");
      dp.style.transform = "";
      dp.style.opacity = "";
      try { detailWallClear(); } catch (e1) {}
    }, alreadyAnimated ? 40 : 380);
    if (detailHistoryPushed && !fromPop) {
      detailHistoryPushed = false;
      _detailIgnorePop = 1;
      try { history.back(); } catch (e2) {}
      setTimeout(function () { _detailIgnorePop = 0; }, 280);
    } else {
      detailHistoryPushed = false;
      try {
        if (location.hash === "#detail") {
          history.replaceState({ overlay: null }, "", location.pathname + location.search);
        }
      } catch (e3) {}
    }
  }

  function openDetailPageShell(opts) {
    opts = opts || {};
    var dp = document.getElementById("detailPage");
    var scroll = document.getElementById("detailScroll");
    if (!dp) return null;
    // 关闭可能残留的歌单 sheet，避免叠层
    try {
      var mask = document.getElementById("sheetMask");
      if (mask && mask.classList.contains("open")) {
        // 仅关 UI，不抢 history（详情自己压栈）
        mask.classList.remove("open");
        try { document.body.classList.remove("sheet-open"); } catch (eS) {}
      }
    } catch (e) {}

    var title = opts.title || "详情";
    var cover = opts.cover || PLACEHOLDER;
    var sub = opts.sub || "";
    var desc = opts.desc || "";

    detailState.title = title;
    detailState.cover = cover;
    detailState.songs = [];
    detailState.info = opts.info || {};
    detailState.kind = opts.kind || "";
    detailState.source = opts.source || "";
    detailState.id = opts.id || "";

    var titleEl = document.getElementById("detailTitle");
    var subEl = document.getElementById("detailSub");
    var descEl = document.getElementById("detailDesc");
    var topTitle = document.getElementById("detailTopTitle");
    var heroImg = document.getElementById("detailHeroImg");
    var list = document.getElementById("detailSongList");
    var tip = document.getElementById("detailLoadTip");

    if (titleEl) titleEl.textContent = title;
    if (topTitle) topTitle.textContent = title;
    if (subEl) subEl.textContent = sub || "加载中…";
    if (descEl) descEl.textContent = desc || "";
    if (list) list.innerHTML = '<div class="detail-load-tip" style="padding:36px 12px">加载歌曲…</div>';
    if (tip) tip.textContent = "";
    try { document.documentElement.classList.add("detail-open"); } catch (eW0) {}
    // 只用可用封面；不要先清空模糊墙（会「冲掉」刚显示的海报）
    if (isUsableCover(cover)) {
      applyDetailCover(cover, { force: true });
    } else if (heroImg) {
      // 无封面时用中性底，不闪主页
      heroImg.removeAttribute("src");
      heroImg.alt = "";
    }

    dp.classList.remove("closing", "scrolled");
    dp.style.transform = "";
    dp.style.opacity = "";
    dp.classList.add("open");
    try { document.documentElement.classList.add("detail-open"); } catch (e2) {}
    // 已有播放队列时，保证迷你条带 .show，避免二次进入只剩一条线
    try {
      var miniEl = document.getElementById("mini");
      if (miniEl && S.queue && S.queue.length) {
        miniEl.classList.add("show");
      }
    } catch (eMini) {}
    try { syncDetailLikeBtn(); } catch (eLk0) {}
    if (scroll) {
      scroll.scrollTop = 0;
      if (!scroll._detailScrollBound) {
        scroll._detailScrollBound = true;
        scroll.addEventListener("scroll", function () {
          var y = scroll.scrollTop || 0;
          dp.classList.toggle("scrolled", y > 120);
        }, { passive: true });
      }
    }

    // history：独立 overlay，不与播放页冲突
    if (!detailHistoryPushed) {
      try {
        history.pushState({ aqDetail: 1, overlay: "detail" }, "", "#detail");
        detailHistoryPushed = true;
      } catch (eH) {
        try {
          history.pushState({ aqDetail: 1, overlay: "detail" }, "");
          detailHistoryPushed = true;
        } catch (eH2) {}
      }
    } else {
      try {
        if (location.hash !== "#detail") {
          history.replaceState({ aqDetail: 1, overlay: "detail" }, "", "#detail");
        }
      } catch (eR) {}
    }
    return dp;
  }

  function bindDetailActions() {
    var playAll = document.getElementById("detailPlayAll");
    var shuffle = document.getElementById("detailShuffle");
    var back = document.getElementById("detailBackBtn");
    var likeBtn = document.getElementById("detailLikeBtn");
    if (likeBtn && !likeBtn._bound) {
      likeBtn._bound = true;
      likeBtn.addEventListener("click", function (e) {
        if (e) e.stopPropagation();
        var pl = {
          id: detailState.id,
          topId: detailState.id,
          name: detailState.title,
          title: detailState.title,
          cover: detailState.cover,
          source: detailState.source,
          kind: detailState.kind || "playlist",
          intro: (detailState.info && (detailState.info.intro || detailState.info.desc)) || "",
        };
        if (!pl.id) { toast("无法收藏"); return; }
        toggleFavPlaylist(pl);
      });
    }
    if (playAll && !playAll._bound) {
      playAll._bound = true;
      playAll.addEventListener("click", function () {
        if (!detailState.songs.length) { toast("暂无歌曲"); return; }
        play(detailState.songs[0], detailState.songs);
      });
    }
    if (shuffle && !shuffle._bound) {
      shuffle._bound = true;
      shuffle.addEventListener("click", function () {
        if (!detailState.songs.length) { toast("暂无歌曲"); return; }
        var list = detailState.songs.slice();
        for (var i = list.length - 1; i > 0; i--) {
          var j = Math.floor(Math.random() * (i + 1));
          var t = list[i]; list[i] = list[j]; list[j] = t;
        }
        play(list[0], list);
      });
    }
    if (back && !back._bound) {
      back._bound = true;
      back.addEventListener("click", function () { closeDetailPage(false); });
    }
  }
  try { bindDetailActions(); } catch (eB) {}

  // 详情页手势：下滑关闭（不与播放页抢 edge 返回）
  (function setupDetailGesture() {
    var dp = document.getElementById("detailPage");
    var scroll = document.getElementById("detailScroll");
    if (!dp || dp._gestureBound) return;
    dp._gestureBound = true;
    var sy = 0, cy = 0, dragging = false, mode = "";
    var easeOut = "transform .36s cubic-bezier(0.32, 0.72, 0, 1), opacity .3s ease";
    var easeBack = "transform .4s cubic-bezier(0.32, 0.72, 0, 1), opacity .28s ease";
    function atTop() {
      try { return !scroll || scroll.scrollTop <= 4; } catch (e) { return true; }
    }
    dp.addEventListener("touchstart", function (e) {
      if (!dp.classList.contains("open")) return;
      if (!e.touches || !e.touches[0]) return;
      if (e.target && e.target.closest && e.target.closest("button")) return;
      sy = e.touches[0].clientY;
      cy = sy;
      dragging = true;
      mode = "";
      dp.style.transition = "none";
    }, { passive: true });
    dp.addEventListener("touchmove", function (e) {
      if (!dragging || !e.touches || !e.touches[0]) return;
      cy = e.touches[0].clientY;
      var dy = cy - sy;
      if (!mode) {
        if (dy > 12 && atTop()) mode = "down";
        else return;
      }
      if (mode === "down") {
        var d = Math.max(0, dy);
        dp.style.transform = "translate3d(0," + d + "px,0)";
        dp.style.opacity = String(Math.max(0.3, 1 - d / 480));
      }
    }, { passive: true });
    dp.addEventListener("touchend", function () {
      if (!dragging) return;
      dragging = false;
      var dy = cy - sy;
      var h = window.innerHeight || 700;
      if (mode === "down" && dy > 90) {
        dp.style.transition = easeOut;
        dp.style.transform = "translate3d(0," + h + "px,0)";
        dp.style.opacity = "0";
        setTimeout(function () { closeDetailPage(false, true); }, 280);
      } else {
        dp.style.transition = easeBack;
        dp.style.transform = "";
        dp.style.opacity = "";
        setTimeout(function () { dp.style.transition = ""; }, 400);
      }
      mode = "";
    }, { passive: true });
  })();

  async function openToplistDetail(board) {
    if (!board) return;
    var titleText = board.name || board.title || "榜单";
    var cover = board.cover || PLACEHOLDER;
    var intro = board.intro || board.desc || board.description || board.update || "";
    openDetailPageShell({
      title: titleText,
      cover: cover,
      sub: "官方榜单 · 加载中…",
      desc: intro,
      kind: "toplist",
      source: board.source || S.platform || "qq",
      id: String(board.topId || board.id || ""),
      info: board,
    });
    try {
      var pack = await fetchToplistDetail(
        board.topId || board.id,
        board.source || S.platform || "qq",
        board
      );
      var songs = (pack && pack.songs) || [];
      var info = (pack && pack.info) || {};
      // 仅当接口封面可用且比当前更好时才更新，避免把首页带来的海报冲掉
      if (info.cover && isUsableCover(info.cover)) {
        applyDetailCover(info.cover);
        cover = detailState.cover || cover;
      } else if (isUsableCover(board.cover)) {
        applyDetailCover(board.cover);
      }
      // 酷我：若仍无顶图，用第一首有封面的歌兜底（等补封面后）
      if (!isUsableCover(detailState.cover) && songs.length) {
        for (var ci = 0; ci < Math.min(songs.length, 8); ci++) {
          var sc = "";
          try { sc = (typeof songCover === "function") ? songCover(songs[ci]) : (songs[ci].cover || ""); } catch (eSc) {}
          if (isUsableCover(sc)) { applyDetailCover(sc); break; }
        }
      }
      if (info.title) {
        titleText = info.title;
        var te = document.getElementById("detailTitle");
        var tt = document.getElementById("detailTopTitle");
        if (te) te.textContent = titleText;
        if (tt) tt.textContent = titleText;
      }
      // 酷我补封面
      if ((board.source || S.platform) === "kuwo" && songs.length) {
        try {
          songs = await fillKuwoSongCovers(songs, Math.min(songs.length, 200));
        } catch (eF) {}
        // 补封面后若顶图仍空，用歌曲封面撑海报
        if (!isUsableCover(detailState.cover)) {
          for (var ki = 0; ki < Math.min(songs.length, 12); ki++) {
            var ksc = "";
            try { ksc = (typeof songCover === "function") ? songCover(songs[ki]) : (songs[ki].cover || ""); } catch (eK) {}
            if (isUsableCover(ksc)) { applyDetailCover(ksc); break; }
          }
        }
      }
      detailState.songs = songs;
      detailState.info = info;
      // 全部榜单：顶图强制用第一首可用封面
      if (songs.length) {
        for (var fi = 0; fi < Math.min(songs.length, 15); fi++) {
          var fsc = "";
          try { fsc = (typeof songCover === "function") ? songCover(songs[fi]) : (songs[fi].cover || ""); } catch (eFsc) {}
          if (typeof isUsableCover === "function" && isUsableCover(fsc)) {
            applyDetailCover(fsc, { force: true });
            break;
          }
        }
      }
      var subEl = document.getElementById("detailSub");
      if (subEl) {
        subEl.textContent =
          (info.update || board.update || "官方榜单") +
          " · 共 " + songs.length + " 首";
      }
      var descEl = document.getElementById("detailDesc");
      if (descEl && (info.intro || intro)) descEl.textContent = info.intro || intro;
      renderDetailSongRows(songs);
      var tip = document.getElementById("detailLoadTip");
      if (tip) tip.textContent = songs.length ? ("已加载全部 " + songs.length + " 首") : "";
      try { syncDetailLikeBtn(); } catch (eLk) {}
    } catch (e) {
      console.warn("toplist detail fail", e);
      toast("榜单加载失败");
      var list = document.getElementById("detailSongList");
      if (list) list.innerHTML = '<div class="detail-load-tip" style="padding:40px 12px">加载失败</div>';
    }
  }

  async function playPlaylist(pl) {
    return openPlaylistDetail(pl);
  }

  async function openPlaylistDetail(pl) {
    if (!pl) return;
    var id = String(pl.id || pl.dissid || pl.tid || pl.pid || "").trim();
    var psrc = pl.source || S.platform || "qq";
    var titleText = pl.name || pl.title || "歌单";
    var cover = pl.cover || pl.pic || PLACEHOLDER;
    var seedIntro = pl.intro || pl.desc || pl.description || pl.introduction || "";
    openDetailPageShell({
      title: titleText,
      cover: cover,
      sub: ({ qq: "QQ音乐", netease: "网易云", kuwo: "酷我", kugou: "酷狗", migu: "咪咕" }[psrc] || psrc) + " · 加载中…",
      desc: seedIntro,
      kind: "playlist",
      source: psrc,
      id: id,
      info: pl,
    });
    try {
      // 并行：歌曲列表 + 歌单简介（列表卡片常无简介，需单独拉详情）
      var songsP;
      if (psrc === "netease" && id) songsP = neteasePlaylistSongs(id).catch(function () { return []; });
      else if (psrc === "kuwo" && id) songsP = kuwoPlaylistSongs(id).catch(function () { return []; });
      else if (psrc === "kugou" && id) songsP = kugouPlaylistSongs(id).catch(function () { return []; });
      else if (id) songsP = playlistSongs(id).catch(function () { return []; });
      else songsP = Promise.resolve([]);
      var metaP = id
        ? fetchPlaylistMeta(id, psrc).catch(function () { return { intro: "", title: "", cover: "" }; })
        : Promise.resolve({ intro: "", title: "", cover: "" });
      var pair = await Promise.all([songsP, metaP]);
      var songs = pair[0] || [];
      var meta = pair[1] || {};
      if ((!songs || !songs.length) && titleText) {
        songs = await searchSongs(titleText, 1).catch(function () { return []; });
      }
      songs = songs || [];
      if (psrc === "kuwo" && songs.length) {
        try {
          songs = await fillKuwoSongCovers(songs, Math.min(songs.length, 300));
        } catch (eF2) {}
      }
      detailState.songs = songs;
      // 写入简介（接口优先，保留列表里已有的兜底）
      var introText = normalizeIntroText(meta.intro || seedIntro || "");
      if (introText) {
        try {
          detailState.info = detailState.info || {};
          detailState.info.intro = introText;
          detailState.info.desc = introText;
        } catch (eInf) {}
        var descEl = document.getElementById("detailDesc");
        if (descEl) descEl.textContent = introText;
      }
      if (meta.title && meta.title !== titleText) {
        // 仅在卡片标题为空/占位时覆盖，避免改用户看到的名字
      }
      if (meta.cover && isUsableCover(meta.cover) && !isUsableCover(detailState.cover)) {
        applyDetailCover(meta.cover);
      }
      var subEl = document.getElementById("detailSub");
      if (subEl) {
        subEl.textContent =
          ({ qq: "QQ音乐", netease: "网易云", kuwo: "酷我", kugou: "酷狗", migu: "咪咕" }[psrc] || psrc) +
          " · 共 " + songs.length + " 首";
      }
      // 若首曲有封面且歌单无图，用首曲封面做模糊墙
      if (!isUsableCover(detailState.cover)) {
        for (var pi = 0; pi < Math.min((songs || []).length, 8); pi++) {
          var psc = "";
          try { psc = (typeof songCover === "function") ? songCover(songs[pi]) : (songs[pi].cover || ""); } catch (eP) {}
          if (isUsableCover(psc)) { applyDetailCover(psc); break; }
        }
      } else {
        applyDetailCover(detailState.cover);
      }
      renderDetailSongRows(songs);
      var tip = document.getElementById("detailLoadTip");
      if (tip) tip.textContent = songs.length ? ("已加载全部 " + songs.length + " 首") : "暂无歌曲";
      try { syncDetailLikeBtn(); } catch (eLk2) {}
    } catch (e) {
      console.warn("playlist detail fail", e);
      toast("歌单加载失败");
      var list = document.getElementById("detailSongList");
      if (list) list.innerHTML = '<div class="detail-load-tip" style="padding:40px 12px">加载失败</div>';
    }
  }


  function srcEnabled(idOrName) {
    var list = S.sources || [];
    for (var i = 0; i < list.length; i++) {
      if ((list[i].id === idOrName || list[i].name === idOrName) && list[i].enabled) return list[i];
    }
    return null;
  }
  function srcPlatforms(src) {
    if (!src) return [];
    if (Array.isArray(src.platforms) && src.platforms.length) return src.platforms;
    if (src.platform === "all") return ["qq", "netease", "kugou", "kuwo", "migu"];
    if (src.platform) return [src.platform];
    return [];
  }
  function sourcesFor(platform, loose) {
    var all = (S.sources || []).filter(function (s) { return !!s.enabled; });
    var matched = all.filter(function (s) {
      var ps = srcPlatforms(s);
      return ps.indexOf("all") >= 0 || ps.indexOf(platform) >= 0 || s.platform === "all" || s.platform === platform;
    });
    // 当前站源没有可用音源时，回退到所有已启用源（避免只开玉宁熙却选了网易导致全不能播）
    if ((!matched || !matched.length) && loose !== false) return all;
    return matched;
  }


  /* 兼容旧名：是否可多站（有桥或已知壳，不再把普通 Android WebView 算进去） */
  function isFmApp() {
    return typeof canShowPlatformSwitch === "function" ? canShowPlatformSwitch() : false;
  }
  // 不在启动瞬间锁死：每次用 isFmApp() 实时判断（桥可能晚注入）
  var PLATFORMS = [
    { id: "qq", name: "QQ" },
    { id: "netease", name: "网易" },
    { id: "kuwo", name: "酷我" },
    { id: "kugou", name: "酷狗" },
    { id: "migu", name: "咪咕" },
  ];
  var PLATFORM_BILI = { id: "bilibili", name: "B站" };
  /** 主页切站不显示 B 站；搜索页菜单追加 B 站 */
  function platformsForMenu() {
    var list = PLATFORMS.slice();
    var page = (typeof _curPage !== "undefined" && _curPage) ? _curPage : "home";
    if (page === "search") {
      list = list.concat([PLATFORM_BILI]);
    }
    return list;
  }
  S.platform = localStorage.getItem("aq_plat") || "qq";
  // 若本地存了 bilibili 但当前不在搜索页，仍允许保留，菜单仅在搜索页露出
  try {
    if (S.platform === "bili") S.platform = "bilibili";
  } catch (eP0) {}
  try { S.lxScript = localStorage.getItem("aq_lx_script") || S.lxScript || ""; } catch (eLxS) { S.lxScript = S.lxScript || ""; }

  function syncPlatBtn() {
    var wrap = $("#platWrap");
    // 仅：FongMi/TVBox 等已知壳，或检测到原生 HTTP 桥 → 显示站源切换
    var show = typeof canShowPlatformSwitch === "function" ? canShowPlatformSwitch() : false;
    if (!show) {
      if (wrap) wrap.style.display = "none";
      return;
    }
    if (wrap) wrap.style.display = "";

    var plat = S.platform || "qq";
    var el = $("#platName");
    if (el) {
      var all = platformsForMenu();
      var p = all.find(function (x) { return x.id === plat; });
      if (!p && plat === "bilibili") p = PLATFORM_BILI;
      el.textContent = (p && p.name) || "QQ";
    }
    var btn = $("#btnPlat") || document.querySelector(".plat-btn");
    if (btn) {
      btn.setAttribute("data-plat", plat === "bilibili" ? "bilibili" : plat);
      // 箭头：各站官方色
      var accent = {
        qq: "#31c27c",
        netease: "#ec4141",
        kuwo: "#ff6a00",
        kugou: "#2ca2f9",
        migu: "#ed4141",
        bilibili: "#fb7299",
      }[plat] || "#8e8e93";
      btn.style.setProperty("--plat-accent", accent);
      var caret = btn.querySelector(".plat-caret");
      if (caret) caret.style.color = accent;
    }
    // 指示灯：有对接音源=绿，无=红
    var dot = document.querySelector(".plat-btn .plat-dot");
    if (dot) {
      var chain = sourcesFor(plat);
      var ok = chain && chain.length > 0;
      dot.classList.toggle("on", !!ok);
      dot.title = ok ? "已对接音源" : "未对接 · 将用其它平台";
    }
    // 猜你喜欢左上角色条：随切站即时变色
    try {
      var gc = $("#guessCard");
      if (gc) gc.setAttribute("data-plat", plat);
    } catch (eGc) {}
  }

  /** 同平台多音源竞速；forceQ 指定音质；返回的 URL 必须真实达到该档（防假高音质） */
  function raceSources(chain, song, mid, forceQ) {
    return trySourcesInOrder(chain, song, mid, forceQ);
  }

  /**
   * 多源取流：普通音质并行竞速；母带/Hi-Res 优先串行试星河入梦，拒绝用无损凑数。
   */
  function isYnxSource(src) {
    if (!src) return false;
    return src.id === "ynx" || /玉宁熙|星河入梦|yuafeng/i.test(String(src.name || "") + (src.url || ""));
  }
  /** 母带优先星河入梦，但用户指定的默认音源永远排最前 */
  function preferMasterSources(chain, forceQ) {
    var list = (chain || []).filter(function (s) { return s && s.enabled !== false; });
    if (!list.length) return list;
    var defId = S.defaultSrcId || "";
    var byDefault = function (s) { return (defId && (s.id === defId || s.name === defId)) ? 0 : 1; };
    if (forceQ !== "master" && forceQ !== "hires" && forceQ !== "flac24bit") {
      if (!defId) return list;
      return list.slice().sort(function (a, b) { return byDefault(a) - byDefault(b); });
    }
    return list.slice().sort(function (a, b) {
      var da = byDefault(a), db = byDefault(b);
      if (da !== db) return da - db;
      return (isYnxSource(a) ? 0 : 1) - (isYnxSource(b) ? 0 : 1);
    });
  }
  function trySourcesInOrder(chain, song, mid, forceQ) {
    if (!chain || !chain.length) return Promise.resolve(null);
    var list = preferMasterSources(chain, forceQ);
    if (!list.length) return Promise.resolve(null);
    return (async function () {
      // 默认音源：先单独串行试一把（避免并行竞速被“秒回”的源抢赢）
      var defId = S.defaultSrcId || "";
      if (defId && list.length > 1) {
        var defSrc = null;
        for (var di = 0; di < list.length; di++) {
          if (list[di].id === defId || list[di].name === defId) { defSrc = list[di]; break; }
        }
        if (defSrc) {
          try {
            var dUrl = await resolveBySource(defSrc, song, mid, forceQ);
            if (dUrl && /^https?:\/\//i.test(String(dUrl))) {
              var dQ = detectQualityFromUrl(dUrl);
              var dOk = forceQ ? (dQ ? qualityMeets(dQ, forceQ) : false) : true;
              if (dOk) {
                try {
                  S.playSrcId = defSrc.id || defSrc.name || "";
                  if (song) song._playSrcId = S.playSrcId;
                } catch (eW) {}
                return dUrl;
              }
            }
          } catch (eDef) {
            console.warn("[default-src] fail", defId, eDef);
          }
          // 默认源达不到目标档：从候选里剔除，交给其它源自动接手
          list = list.filter(function (x) { return x !== defSrc; });
          if (!list.length) return null;
        }
      }
      return await raceOrStrict(list, song, mid, forceQ);
    })();
  }

  function raceOrStrict(list, song, mid, forceQ) {
    var needStrict = forceQ === "master" || forceQ === "hires" || forceQ === "flac24bit";
    if (needStrict) {
      return (async function () {
        for (var i = 0; i < list.length; i++) {
          var src = list[i];
          try {
            var url = await resolveBySource(src, song, mid, forceQ);
            if (!url) continue;
            var actual = detectQualityFromUrl(url);
            // 严格档：必须能认出真实档位且达标，认不出就不算母带
            if (!actual || !qualityMeets(actual, forceQ)) {
              console.warn("[strict] reject", src.name || src.id, forceQ, "got", actual || "unknown");
              continue;
            }
            try {
              S.playSrcId = src.id || src.name || "";
              if (song) song._playSrcId = S.playSrcId;
            } catch (eWin) {}
            console.info("[strict] win", src.name || src.id, actual || forceQ, String(url).slice(0, 60));
            return url;
          } catch (eOne) {
            console.warn("[strict] fail", src.name || src.id, eOne);
          }
        }
        return null;
      })();
    }
    return new Promise(function (resolve) {
      var left = list.length;
      var settled = false;
      list.forEach(function (src) {
        Promise.resolve()
          .then(function () { return resolveBySource(src, song, mid, forceQ); })
          .then(function (url) {
            if (settled) return;
            if (url) {
              var actual = detectQualityFromUrl(url);
              if (forceQ && actual && !qualityMeets(actual, forceQ)) {
                console.warn("[race] reject", src.name || src.id, forceQ, actual);
                left--;
                if (left <= 0) resolve(null);
                return;
              }
              settled = true;
              try {
                S.playSrcId = src.id || src.name || "";
                if (song) song._playSrcId = S.playSrcId;
              } catch (eWin) {}
              console.info("[race] win", src.name || src.id, String(url).slice(0, 60));
              resolve(url);
              return;
            }
            left--;
            if (left <= 0) resolve(null);
          })
          .catch(function () {
            if (settled) return;
            left--;
            if (left <= 0) resolve(null);
          });
      });
    });
  }

  /** 在指定音质下解析播放地址（不自动降级）；校验 CDN 真实档位 */
  function cleanPlayMid(song, mid) {
    mid = String(mid || song.songmid || song.mid || song.id || "").trim();
    // 去掉平台前缀，音源接口要纯 ID
    mid = mid.replace(/^(kw_|kg_|ne_|mg_|qq_|tx_|wy_)/i, "");
    if (song) {
      if (song.rid) mid = String(song.rid).replace(/^MUSIC_/i, "");
      if (song.hash) mid = String(song.hash).toLowerCase();
      if (song.neteaseId) mid = String(song.neteaseId);
      if (song.bvid) mid = String(song.bvid);
    }
    return mid;
  }
  async function resolvePlayAtQuality(song, q) {
    // —— 0) B站：独立官方音轨，绝不进内置音源链 ——
    if (isBiliSong(song)) {
      try {
        var biliUrl = await resolveBilibiliPlay(song);
        if (biliUrl) {
          return {
            url: biliStripTag(biliUrl),
            quality: "128k",
            requested: q,
            via: "bilibili",
          };
        }
      } catch (eBili) {
        console.warn("[resolve] bilibili fail", eBili);
      }
      return null; // 绝不回退内置音源
    }

    var mid = cleanPlayMid(song);
    if (!mid) return null;
    var songPlat = normPlat((song && song.source) || "qq");

    // —— 1) 同平台：所有「已启用且声明支持该平台」的音源，按列表顺序试 ——
    // 例：网易曲 + 勾了玉宁熙&念心 → 先玉宁熙网易，失败再念心网易
    var chain = (S.sources || []).filter(function (s) {
      if (!s || !s.enabled) return false;
      var ps = srcPlatforms(s);
      if (!ps.length) return true; // 未声明平台的自定义源也参与
      return ps.indexOf("all") >= 0 || ps.indexOf(songPlat) >= 0;
    });
    // 默认音源排最前；它拿不到目标音质时会自动继续试后面的源
    var _defId = S.defaultSrcId || "";
    if (_defId && chain.length > 1) {
      chain = chain.slice().sort(function (a, b) {
        var ad = ((a.id || a.name) === _defId) ? 0 : 1;
        var bd = ((b.id || b.name) === _defId) ? 0 : 1;
        return ad - bd;
      });
    }
    if (chain.length) {
      try {
        var url = await trySourcesInOrder(chain, song, mid, q);
        if (url) {
          var detQ = detectQualityFromUrl(url);
          var actual = detQ || q;
          var strictQ = (q === "master" || q === "hires" || q === "flac24bit");
          if (detQ ? qualityMeets(detQ, q) : !strictQ) {
            return { url: url, quality: actual, requested: q, via: songPlat };
          }
          console.warn("[resolve] quality not meet", q, "got", actual);
        }
      } catch (e1) {
        console.warn("[resolve] same-plat fail", songPlat, e1);
      }
    }

    // —— 2) 同平台全失败：仅当非 QQ 曲时，用歌名搜 QQ 同源再解析 ——
    if (songPlat !== "qq" && song && song.name) {
      try {
        var kw = (song.name + " " + (song.artist || "")).trim();
        var alt = await searchQQ(kw).catch(function () { return []; });
        if (alt && alt[0] && alt[0].songmid) {
          var qqSong = Object.assign({}, alt[0], { source: "qq" });
          var qqMid = cleanPlayMid(qqSong);
          var qqChain = (S.sources || []).filter(function (s) {
            if (!s || !s.enabled) return false;
            var ps = srcPlatforms(s);
            if (!ps.length) return true;
            return ps.indexOf("all") >= 0 || ps.indexOf("qq") >= 0;
          });
          if (qqChain.length && qqMid) {
            var qqUrl = await trySourcesInOrder(qqChain, qqSong, qqMid, q);
            if (qqUrl) {
              try { /* moved to play success */; } catch (eT) {}
              return {
                url: qqUrl,
                quality: detectQualityFromUrl(qqUrl) || q,
                requested: q,
                via: "qq-fallback",
              };
            }
          }
        }
      } catch (eFb) {
        console.warn("[resolve] qq fallback fail", eFb);
      }
    }
    return null;
  }

  /**
   * 解析播放地址；取不到目标音质时按链自动降级（仅用已启用音源）。
   * 返回 string URL（兼容旧调用）；实际播放时用 resolvePlayWithQ。
   */
  async function resolvePlay(song, forceQ) {
    var pack = await resolvePlayWithQ(song, forceQ);
    return pack && pack.url ? pack.url : null;
  }

  async function resolvePlayWithQ(song, forceQ) {
    var mid = song.songmid || song.mid || song.id;
    if (!mid) return null;
    var want = forceQ || S.quality || "flac";
    var chain = (S.autoQDowngrade !== false) ? qualityFallbacks(want) : [want];
    var last = null;
    for (var qi = 0; qi < chain.length; qi++) {
      var q = chain[qi];
      try {
        var pack = await resolvePlayAtQuality(song, q);
        if (pack && pack.url) {
          var actualQ = detectQualityFromUrl(pack.url) || pack.quality || q;
          pack.quality = actualQ;
          pack.requested = want;
          pack.downgraded = actualQ !== want && qualityRank(actualQ) > qualityRank(want);
          return pack;
        }
        last = pack;
      } catch (e) {
        console.warn("resolve q fail", q, e);
      }
    }
    return last;
  }

  function closePlatMenu() {
    var wrap = $("#platWrap");
    if (wrap) wrap.classList.remove("open");
  }
  function renderPlatMenu() {
    var menu = $("#platMenu");
    if (!menu) return;
    menu.innerHTML = "";
    platformsForMenu().forEach(function (p) {
      var chain = (p.id === "bilibili") ? [] : sourcesFor(p.id);
      var btn = document.createElement("button");
      btn.type = "button";
      btn.setAttribute("data-plat", p.id);
      if (S.platform === p.id) btn.className = "on";
      btn.innerHTML =
        "<span>" + p.name + "</span>" +
        '<span class="plat-src-hint">' + (p.id === "bilibili" ? "官方" : (chain.length ? chain.length + "源" : "备用")) + "</span>";
      btn.onclick = function (e) {
        e.stopPropagation();
        var prev = S.platform;
        // 记住当前页：切站后必须留在此页（搜索/资料库/设置），绝不能回主页
        var stayPage = (typeof _curPage !== "undefined" && _curPage) ? _curPage : "home";
        // 关掉 sheet/详情时用 fromPop=true，禁止 history.back()，否则会弹出 #search 触发 popstate→go(home)
        try {
          var sheetMask = $("#sheetMask");
          if (sheetMask && sheetMask.classList.contains("open")) {
            closeSheet(true);
          }
        } catch (eClose) {}
        try {
          if (typeof isDetailOpen === "function" && isDetailOpen()) {
            closeDetailPage(true);
          }
        } catch (eDetC) {}
        try {
          sheetHistoryPushed = false;
          detailHistoryPushed = false;
          if (typeof _sheetIgnorePop !== "undefined") _sheetIgnorePop = 0;
          if (typeof _detailIgnorePop !== "undefined") _detailIgnorePop = 0;
        } catch (eFlags) {}
        S.platform = p.id;
        localStorage.setItem("aq_plat", p.id);
        syncPlatBtn();
        renderPlatMenu();
        closePlatMenu();
        // 强制保持当前页 UI（防止任何异步/历史副作用把页签切走）
        try {
          if (stayPage && stayPage !== "home") {
            $$(".page").forEach(function (el) {
              el.classList.remove("leave-left", "leave-right", "enter-from-left", "enter-from-right");
              el.classList.toggle("on", el.dataset.p === stayPage);
            });
            $$(".tab").forEach(function (el) { el.classList.toggle("on", el.dataset.p === stayPage); });
            _curPage = stayPage;
            var tStay = $("#pageTitle");
            if (tStay && typeof TITLES !== "undefined") tStay.textContent = TITLES[stayPage] || "Music";
            // 维持子页 history，避免后续返回逻辑紊乱
            try {
              if (!_subPagePushed) {
                history.pushState({ aqPage: stayPage }, "", "#" + stayPage);
                _subPagePushed = true;
              } else {
                history.replaceState({ aqPage: stayPage }, "", "#" + stayPage);
              }
            } catch (eHistStay) {}
          }
        } catch (eStay) {}
        // 搜索页：有关键词立刻用新站源重搜；无关键词刷新空态。绝不 go(home)。
        try {
          if (prev !== p.id) {
            var qEl = $("#qInput");
            var kw = (qEl && qEl.value || "").trim();
            try {
              searchCache = { kw: "", song: [], singer: [], playlist: [] };
            } catch (eSc) {}
            if (kw) {
              doSearch(true);
            } else if (stayPage === "search") {
              try { renderSearchTab(); } catch (eRs) {}
            }
          }
        } catch (eRe) {}
        // 搜索页切站：只换搜索结果；主页（及其他页）切站：整体刷新主页数据
        if (prev !== p.id) {
          try {
            if (stayPage === "search") {
              // 仅搜索结果，不刷主页；有关键词则按新站源重搜
              try { toast("已切换至 " + p.name + " · 搜索"); } catch (eT0) {}
              try {
                var kwNow = ($("#qInput") && $("#qInput").value || "").trim();
                if (kwNow && typeof doSearch === "function") doSearch(true);
              } catch (eRes) {}
            } else {
              // 离开搜索切站时，若当前是 B 站则回到 QQ（主页不提供 B 站）
              if (p.id === "bilibili") {
                S.platform = "qq";
                try { localStorage.setItem("aq_plat", "qq"); } catch (eB) {}
                try { syncPlatBtn(); renderPlatMenu(); } catch (eB2) {}
                try { toast("B站仅搜索页可用，已切回 QQ"); } catch (eB3) {}
                return;
              }
              homePlCache = null;
              homeRankPool = [];
              try {
                if (typeof loadHomeRanks === "function") {
                  Promise.resolve(loadHomeRanks()).catch(function () {});
                }
              } catch (eLr) {}
              loadRandomHomePlaylists().then(function (list) {
                homePlCache = list || [];
                if (homeChView === "playlist") renderHomePlaylists(homePlCache);
              }).catch(function () {});
              fetchRecommendFromCharts(24).then(function (list) {
                list = list || [];
                S.recList = list.slice(0, 24);
                var row = $("#recRow");
                if (row) {
                  row.innerHTML = "";
                  S.recList.forEach(function (s) { row.appendChild(albumCard(s, S.recList)); });
                }
              }).catch(function () {});
              fetchPool(HOT_KW, 12, {}, 2).then(function (list) {
                list = list || [];
                S.feed = list;
                var hot = $("#hotList");
                if (hot) {
                  hot.innerHTML = "";
                  list.forEach(function (s) { hot.appendChild(songRow(s, list)); });
                }
              }).catch(function () {});
              Promise.all([
                fetchGuessLike(40).catch(function () { return []; }),
                fetchRadarSongs(40).catch(function () { return []; }),
              ]).then(function (pair) {
                var guess = pair[0] || [];
                var radar = pair[1] || [];
                S.guessList = guess;
                S.radarList = radar;
                if (guess.length || radar.length) {
                  try { renderTopDuo(guess, radar); } catch (eD) {}
                }
              }).catch(function () {});
              try { toast("已切换至 " + p.name); } catch (eT) {}
            }
          } catch (eRf) {}
        }
      };
      menu.appendChild(btn);
    });
  }
  var _platIgnoreCloseUntil = 0;
  function togglePlatMenu(e) {
    if (e) {
      try { e.stopPropagation(); } catch (e1) {}
      try { e.preventDefault(); } catch (e2) {}
    }
    var wrap = $("#platWrap");
    if (!wrap) return;
    if (wrap.classList.contains("open")) {
      closePlatMenu();
    } else {
      renderPlatMenu();
      wrap.classList.add("open");
      // 打开后短暂忽略外部关闭，避免同一次触摸/滚动把菜单弹回
      _platIgnoreCloseUntil = Date.now() + 400;
    }
  }

  

  /* ========== LX Music 音源规范运行时 ==========
   * 兼容洛雪音乐客户端第三方音源脚本（.js），规范要点：
   * 1) 全局对象 globalThis.lx
   * 2) lx.EVENT_NAMES = { inited, request, updateAlert }
   * 3) lx.on(event, handler) / lx.send(event, data)
   * 4) lx.request(url, options, callback)  — callback(err, { body, statusCode, headers })
   * 5) 脚本在 request 事件里处理 action==="musicUrl"：
   *      handler({ action, source, info: { musicInfo, type } }) => Promise<string url>
   * 6) source: tx|wy|kg|kw|mg ； type: 128k|320k|flac|flac24bit|hires|atmos|master 等
   * 7) musicInfo 常用字段: songmid/hash/name/singer/albumName/albumId/strMediaMid
   * 8) 初始化: lx.send(EVENT_NAMES.inited, { status, openDevTools, sources })
   * 导入的脚本按此规范执行，无需为每个源单独写解析。
   * ============================================================ */
  function platToLxCode(p) {
    return ({ qq: "tx", netease: "wy", kugou: "kg", kuwo: "kw", migu: "mg", tx: "tx", wy: "wy", kg: "kg", kw: "kw", mg: "mg" })[p] || "tx";
  }

  /** 将播放器音质映射为 LX 常见 type（脚本 _dab / qualitys 用） */
  function toLxQuality(q) {
    q = String(q || "128k");
    var map = {
      "64k": "128k",
      "128k": "128k",
      "192k": "320k",
      "320k": "320k",
      flac: "flac",
      flac24bit: "flac24bit",
      hires: "flac24bit",
      master: "master",
      atmos: "atmos",
    };
    return map[q] || q;
  }

  /* 轻量 MD5（部分音源签名用） */
  function lxMd5(str) {
    str = String(str || "");
    function safeAdd(x, y) {
      var lsw = (x & 0xffff) + (y & 0xffff);
      var msw = (x >> 16) + (y >> 16) + (lsw >> 16);
      return (msw << 16) | (lsw & 0xffff);
    }
    function bitRotateLeft(num, cnt) { return (num << cnt) | (num >>> (32 - cnt)); }
    function md5cmn(q, a, b, x, s, t) { return safeAdd(bitRotateLeft(safeAdd(safeAdd(a, q), safeAdd(x, t)), s), b); }
    function md5ff(a, b, c, d, x, s, t) { return md5cmn((b & c) | (~b & d), a, b, x, s, t); }
    function md5gg(a, b, c, d, x, s, t) { return md5cmn((b & d) | (c & ~d), a, b, x, s, t); }
    function md5hh(a, b, c, d, x, s, t) { return md5cmn(b ^ c ^ d, a, b, x, s, t); }
    function md5ii(a, b, c, d, x, s, t) { return md5cmn(c ^ (b | ~d), a, b, x, s, t); }
    function binlMD5(x, len) {
      x[len >> 5] |= 0x80 << (len % 32);
      x[(((len + 64) >>> 9) << 4) + 14] = len;
      var i, olda, oldb, oldc, oldd;
      var a = 1732584193, b = -271733879, c = -1732584194, d = 271733878;
      for (i = 0; i < x.length; i += 16) {
        olda = a; oldb = b; oldc = c; oldd = d;
        a = md5ff(a, b, c, d, x[i], 7, -680876936); d = md5ff(d, a, b, c, x[i + 1], 12, -389564586); c = md5ff(c, d, a, b, x[i + 2], 17, 606105819); b = md5ff(b, c, d, a, x[i + 3], 22, -1044525330);
        a = md5ff(a, b, c, d, x[i + 4], 7, -176418897); d = md5ff(d, a, b, c, x[i + 5], 12, 1200080426); c = md5ff(c, d, a, b, x[i + 6], 17, -1473231341); b = md5ff(b, c, d, a, x[i + 7], 22, -45705983);
        a = md5ff(a, b, c, d, x[i + 8], 7, 1770035416); d = md5ff(d, a, b, c, x[i + 9], 12, -1958414417); c = md5ff(c, d, a, b, x[i + 10], 17, -42063); b = md5ff(b, c, d, a, x[i + 11], 22, -1990404162);
        a = md5ff(a, b, c, d, x[i + 12], 7, 1804603682); d = md5ff(d, a, b, c, x[i + 13], 12, -40341101); c = md5ff(c, d, a, b, x[i + 14], 17, -1502002290); b = md5ff(b, c, d, a, x[i + 15], 22, 1236535329);
        a = md5gg(a, b, c, d, x[i + 1], 5, -165796510); d = md5gg(d, a, b, c, x[i + 6], 9, -1069501632); c = md5gg(c, d, a, b, x[i + 11], 14, 643717713); b = md5gg(b, c, d, a, x[i], 20, -373897302);
        a = md5gg(a, b, c, d, x[i + 5], 5, -701558691); d = md5gg(d, a, b, c, x[i + 10], 9, 38016083); c = md5gg(c, d, a, b, x[i + 15], 14, -660478335); b = md5gg(b, c, d, a, x[i + 4], 20, -405537848);
        a = md5gg(a, b, c, d, x[i + 9], 5, 568446438); d = md5gg(d, a, b, c, x[i + 14], 9, -1019803690); c = md5gg(c, d, a, b, x[i + 3], 14, -187363961); b = md5gg(b, c, d, a, x[i + 8], 20, 1163531501);
        a = md5gg(a, b, c, d, x[i + 13], 5, -1444681467); d = md5gg(d, a, b, c, x[i + 2], 9, -51403784); c = md5gg(c, d, a, b, x[i + 7], 14, 1735328473); b = md5gg(b, c, d, a, x[i + 12], 20, -1926607734);
        a = md5hh(a, b, c, d, x[i + 5], 4, -378558); d = md5hh(d, a, b, c, x[i + 8], 11, -2022574463); c = md5hh(c, d, a, b, x[i + 11], 16, 1839030562); b = md5hh(b, c, d, a, x[i + 14], 23, -35309556);
        a = md5hh(a, b, c, d, x[i + 1], 4, -1530992060); d = md5hh(d, a, b, c, x[i + 4], 11, 1272893353); c = md5hh(c, d, a, b, x[i + 7], 16, -155497632); b = md5hh(b, c, d, a, x[i + 10], 23, -1094730640);
        a = md5hh(a, b, c, d, x[i + 13], 4, 681279174); d = md5hh(d, a, b, c, x[i], 11, -358537222); c = md5hh(c, d, a, b, x[i + 3], 16, -722521979); b = md5hh(b, c, d, a, x[i + 6], 23, 76029189);
        a = md5hh(a, b, c, d, x[i + 9], 4, -640364487); d = md5hh(d, a, b, c, x[i + 12], 11, -421815835); c = md5hh(c, d, a, b, x[i + 15], 16, 530742520); b = md5hh(b, c, d, a, x[i + 2], 23, -995338651);
        a = md5ii(a, b, c, d, x[i], 6, -198630844); d = md5ii(d, a, b, c, x[i + 7], 10, 1126891415); c = md5ii(c, d, a, b, x[i + 14], 15, -1416354905); b = md5ii(b, c, d, a, x[i + 5], 21, -57434055);
        a = md5ii(a, b, c, d, x[i + 12], 6, 1700485571); d = md5ii(d, a, b, c, x[i + 3], 10, -1894986606); c = md5ii(c, d, a, b, x[i + 10], 15, -1051523); b = md5ii(b, c, d, a, x[i + 1], 21, -2054922799);
        a = md5ii(a, b, c, d, x[i + 8], 6, 1873313359); d = md5ii(d, a, b, c, x[i + 15], 10, -30611744); c = md5ii(c, d, a, b, x[i + 6], 15, -1560198380); b = md5ii(b, c, d, a, x[i + 13], 21, 1309151649);
        a = md5ii(a, b, c, d, x[i + 4], 6, -145523070); d = md5ii(d, a, b, c, x[i + 11], 10, -1120210379); c = md5ii(c, d, a, b, x[i + 2], 15, 718787259); b = md5ii(b, c, d, a, x[i + 9], 21, -343485551);
        a = safeAdd(a, olda); b = safeAdd(b, oldb); c = safeAdd(c, oldc); d = safeAdd(d, oldd);
      }
      return [a, b, c, d];
    }
    function rstrMD5(s) {
      var i, output = [];
      for (i = 0; i < s.length * 8; i += 8) output[i >> 5] |= (s.charCodeAt(i / 8) & 0xff) << (i % 32);
      return binlMD5(output, s.length * 8);
    }
    function rstr2hex(inputArr) {
      var hex = "0123456789abcdef", out = "", i, j, x;
      for (i = 0; i < 4; i++) {
        x = inputArr[i];
        for (j = 0; j < 4; j++) out += hex.charAt((x >> (j * 8 + 4)) & 0x0f) + hex.charAt((x >> (j * 8)) & 0x0f);
      }
      return out;
    }
    // UTF-8
    str = unescape(encodeURIComponent(str));
    return rstr2hex(rstrMD5(str));
  }

  var _lxHandlerCache = Object.create(null);

  function buildLxHost(handlers) {
    return {
      EVENT_NAMES: {
        inited: "inited",
        request: "request",
        updateAlert: "updateAlert",
      },
      version: "2.4.0",
      env: "mobile",
      quality: { list: ["128k", "320k", "flac", "flac24bit", "hires", "atmos", "master"] },
      currentScriptInfo: { name: "web-player", version: "1.0.0", description: "" },
      on: function (ev, cb) {
        if (!handlers[ev]) handlers[ev] = [];
        handlers[ev].push(cb);
      },
      send: function (ev, data) {
        // inited / updateAlert：记录即可
        try {
          if (ev === "inited" || (handlers && false)) {
            /* no-op host side */
          }
        } catch (eS) {}
      },
      request: function (url, options, callback) {
        options = options || {};
        var method = String(options.method || "GET").toUpperCase();
        var headers = Object.assign({}, options.headers || {});
        var body = options.body;
        var opt = { method: method, headers: headers, timeout: options.timeout ? Math.min(30, options.timeout / 1000 || 8) : 8 };
        if (body != null) {
          if (typeof body === "object" && !(typeof FormData !== "undefined" && body instanceof FormData)) {
            if (!headers["Content-Type"] && !headers["content-type"]) {
              opt.headers["Content-Type"] = "application/json";
            }
            opt.body = body;
          } else {
            opt.body = body;
          }
        }
        reqFetch(String(url), opt).then(function (data) {
          var bodyStr = "";
          var status = 200;
          if (data == null) {
            bodyStr = "";
            status = 0;
          } else if (typeof data === "string") {
            bodyStr = data;
          } else if (data._text != null) {
            bodyStr = String(data._text);
            status = data._http || 200;
          } else {
            status = data._http || 200;
            try { bodyStr = JSON.stringify(data); } catch (e) { bodyStr = String(data); }
          }
          // 兼容两类 LX 脚本：
          // 1) JSON.parse(resp.body)  —— body 为字符串
          // 2) resp.body?.data?.url   —— body 为已解析对象（瓜子等）
          // 能 parse 成对象就给对象；同时挂 bodyText 供需要原文的脚本
          var bodyVal = bodyStr;
          if (typeof bodyStr === "string" && bodyStr.length > 1) {
            var t0 = bodyStr.charAt(0);
            if (t0 === "{" || t0 === "[") {
              try { bodyVal = JSON.parse(bodyStr); } catch (eP) { bodyVal = bodyStr; }
            }
          }
          var resp = { body: bodyVal, bodyText: bodyStr, statusCode: status, headers: {} };
          if (typeof callback === "function") {
            try { callback(status ? null : new Error("empty"), resp); } catch (eCb) {}
          }
        }).catch(function (err) {
          if (typeof callback === "function") {
            try { callback(err || new Error("network"), { body: "", bodyText: "", statusCode: 0, headers: {} }); } catch (e2) {}
          }
        });
      },
      utils: {
        buffer: {
          from: function (data, encoding) {
            if (typeof data === "string") {
              try {
                if (encoding === "base64" && typeof atob === "function") {
                  var bin = atob(data);
                  var arr = new Uint8Array(bin.length);
                  for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
                  return arr;
                }
                if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(data);
              } catch (e) {}
              return data;
            }
            return data;
          },
          bufToString: function (buf, encoding) {
            try {
              if (buf && typeof TextDecoder !== "undefined") {
                var u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
                if (encoding === "base64" && typeof btoa === "function") {
                  var s = "";
                  for (var i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
                  return btoa(s);
                }
                return new TextDecoder().decode(u8);
              }
            } catch (e2) {}
            return String(buf || "");
          },
        },
        crypto: {
          md5: function (data) {
            if (data && data.buffer) {
              try {
                var u8 = data instanceof Uint8Array ? data : new Uint8Array(data);
                var s = "";
                for (var i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
                return lxMd5(s);
              } catch (e) {}
            }
            return lxMd5(data);
          },
          aesEncrypt: function (data) { return data; },
          aesDecrypt: function (data) { return data; },
          rsaEncrypt: function (data) { return data; },
          randomBytes: function (size) {
            var n = size || 16;
            var arr = new Uint8Array(n);
            try {
              if (typeof crypto !== "undefined" && crypto.getRandomValues) crypto.getRandomValues(arr);
            } catch (e) {
              for (var i = 0; i < n; i++) arr[i] = (Math.random() * 256) | 0;
            }
            return arr;
          },
        },
      },
    };
  }

  function getLxRequestHandler(scriptText) {
    var key = String(scriptText.length) + ":" + lxMd5(scriptText.slice(0, 2000) + scriptText.slice(-500));
    if (_lxHandlerCache[key]) return _lxHandlerCache[key];
    var handlers = Object.create(null);
    var lx = buildLxHost(handlers);
    var prevLx = globalThis.lx;
    globalThis.lx = lx;
    try {
      var fn = new Function("console", String(scriptText));
      fn(console);
    } catch (eEval) {
      console.warn("[lx-runtime] eval", eEval);
      try { globalThis.lx = prevLx; } catch (e0) {}
      return null;
    }
    // 保持 globalThis.lx 指向本次 host，供后续异步 request 使用
    var list = handlers["request"] || handlers[lx.EVENT_NAMES.request] || [];
    if (!list.length) {
      try { globalThis.lx = prevLx; } catch (e1) {}
      return null;
    }
    var pack = { handler: list[0], lx: lx, prevLx: prevLx, handlers: handlers };
    _lxHandlerCache[key] = pack;
    return pack;
  }

  async function runLxPluginMusicUrl(scriptText, song, quality) {
    if (!scriptText || scriptText.length < 30) return null;
    var songPlat = (song && song.source) || "qq";
    var code = platToLxCode(songPlat);
    var mid = cleanPlayMid(song);
    if (!mid) return null;
    var q = toLxQuality(quality || "128k");

    var pack = getLxRequestHandler(scriptText);
    if (!pack || !pack.handler) return null;

    // 确保执行期 globalThis.lx 可用
    var prevLx = globalThis.lx;
    globalThis.lx = pack.lx;

    var musicInfo = {
      songmid: mid,
      mid: mid,
      id: mid,
      hash: String((song && (song.hash || song.FileHash)) || mid).toLowerCase(),
      name: (song && song.name) || "",
      songname: (song && song.name) || "",
      singer: (song && song.artist) || "",
      singername: (song && song.artist) || "",
      albumName: (song && song.album) || "",
      albumname: (song && song.album) || "",
      albumId: (song && (song.albummid || song.albumId || song.album_id)) || "",
      albummid: (song && (song.albummid || song.albumId)) || "",
      strMediaMid: mid,
      interval: (song && song.interval) || "",
      img: (song && song.cover) || "",
    };

    var payload = {
      action: "musicUrl",
      source: code,
      info: {
        musicInfo: musicInfo,
        type: q,
      },
    };

    try {
      var url = await Promise.resolve(pack.handler(payload));
      if (url && typeof url === "object" && url.url) url = url.url;
      if (url && /^https?:\/\//i.test(String(url))) {
        return String(url).trim().replace(/^http:\/\//i, "https://");
      }
      // 音质不支持时尝试降级 type 再要一次
      var fallbacks = [q, "flac", "320k", "128k"];
      var seen = {};
      for (var fi = 0; fi < fallbacks.length; fi++) {
        var tq = fallbacks[fi];
        if (seen[tq]) continue;
        seen[tq] = 1;
        if (tq === q) continue;
        try {
          var url2 = await Promise.resolve(pack.handler({
            action: "musicUrl",
            source: code,
            info: { musicInfo: musicInfo, type: tq },
          }));
          if (url2 && typeof url2 === "object" && url2.url) url2 = url2.url;
          if (url2 && /^https?:\/\//i.test(String(url2))) return String(url2).trim().replace(/^http:\/\//i, "https://");
        } catch (eF) {}
      }
      return null;
    } catch (e) {
      console.warn("[lx-runtime] musicUrl", code, e);
      return null;
    } finally {
      try { globalThis.lx = prevLx; } catch (eR) {}
    }
  }

async function resolveBySource(src, song, mid, forceQ) {
    if (!src) return null;
    var q = forceQ || S.quality || "flac";
    mid = cleanPlayMid(song, mid);
    if (!mid) return null;
    var songPlat = (song && song.source) || "qq";
    var srcPlats = srcPlatforms(src);
    // 源未声明支持该平台时跳过（避免用 QQ mid 接口硬套酷我 ID）
    if (srcPlats.length && srcPlats.indexOf("all") < 0 && srcPlats.indexOf(songPlat) < 0) {
      // 仅当源只接了单一平台且与歌曲不符时跳过；多平台源按歌曲平台选路径
      if (srcPlats.length === 1 && srcPlats[0] !== songPlat) return null;
    }

    // 屿溪优先于长青（两者域名都含 haitangw，避免误匹配）
    var isYuxiSrc =
      src.id === "yuxi" ||
      /屿溪|雾隐青山|yuxi|新裤子|终章|musicserver\.haitangw\.cc/i.test(String(src.name || "") + (src.url || "") + (src.jsUrl || "") + (src.fromFile || ""));
    // 长青：仅 yinyue.haitangw.net 路径，排除 musicserver
    var isChangqing =
      !isYuxiSrc && (
        src.id === "changqing" ||
        /长青|淡月疏星|changqing|元力菌|yinyue\.haitangw\.net/i.test(String(src.name || "") + (src.url || "") + (src.jsUrl || "") + (src.fromFile || ""))
      );
    if (isChangqing) {
      var cqPlat = "qq";
      if (songPlat === "netease") cqPlat = "wy";
      else if (songPlat === "kugou") cqPlat = "kg";
      else if (songPlat === "kuwo") cqPlat = "kw";
      else if (songPlat === "migu") cqPlat = "mg";
      // 各站尽量要到母带/Hi-Res（与雾隐青山对齐）
      var cqMap = {
        qq: { "64k": "standard", "128k": "standard", "192k": "exhigh", "320k": "exhigh", flac: "lossless", flac24bit: "jymaster", hires: "jymaster", master: "jymaster" },
        wy: { "64k": "standard", "128k": "standard", "192k": "exhigh", "320k": "exhigh", flac: "lossless", flac24bit: "hires", hires: "hires", master: "jymaster" },
        kg: { "64k": "standard", "128k": "standard", "192k": "exhigh", "320k": "exhigh", flac: "lossless", flac24bit: "master", hires: "master", master: "master" },
        kw: { "64k": "standard", "128k": "standard", "192k": "exhigh", "320k": "exhigh", flac: "lossless", flac24bit: "master", hires: "master", master: "master" },
        mg: { "64k": "standard", "128k": "standard", "192k": "exhigh", "320k": "exhigh", flac: "lossless", flac24bit: "hires", hires: "hires", master: "hires" }
      };
      var cqLevel = (cqMap[cqPlat] || cqMap.qq)[q] || "lossless";
      var cqPath = {
        qq: "/qq/qq_kw.php",
        wy: "/wy/wy.php",
        kg: "/kg/kg_song_kw.php",
        kw: "/kw/kw.php",
        mg: "/mg/migu.php"
      }[cqPlat] || "/qq/qq_kw.php";
      var cqId = mid;
      if (cqPlat === "kg") {
        cqId = String((song && (song.hash || song.FileHash || song.songmid || mid)) || mid || "").toLowerCase();
      }
      var cqUrl = "https://yinyue.haitangw.net" + cqPath +
        "?type=" + ((q === "flac" || q === "hires" || q === "flac24bit" || q === "master") ? "flac" : "mp3") +
        "&id=" + encodeURIComponent(cqId) +
        "&level=" + encodeURIComponent(cqLevel);
      // 只按 URL 实际可识别的档位标记（level=jymaster 不直接当母带）
      var cqQ = detectQualityFromUrl(cqUrl) || (q === "master" || q === "hires" || q === "flac24bit" ? "" : (apiLevelToPlayQ(cqLevel) || q));
      // 该中转会「秒回死链」赢下并行竞速；先探一下存活，4xx/5xx 直接跳过
      if (typeof window.__aqMediaInfo === "function") {
        try {
          var cqInfo = await window.__aqMediaInfo(cqUrl, {});
          if (cqInfo && cqInfo.ok && Number(cqInfo.status) >= 400) {
            console.warn("[changqing] dead url", cqInfo.status);
            return null;
          }
        } catch (eCqProbe) {}
      }
      return cqQ ? tagPlayUrl(cqUrl, cqQ) : cqUrl;
    }

    // 屿溪-终章：POST musicserver.haitangw.cc/v1/music/resolve-url
    if (isYuxiSrc) {
      var yxPlat = "tx";
      if (songPlat === "netease") yxPlat = "wy";
      else if (songPlat === "kugou") yxPlat = "kg";
      else if (songPlat === "kuwo") yxPlat = "kw";
      else if (songPlat === "migu") yxPlat = "mg";
      // 音质 → 服务端 level（与原脚本降级表对齐）
      var yxLevelMap = {
        tx: { "64k": "standard", "128k": "standard", "192k": "exhigh", "320k": "exhigh", flac: "lossless", flac24bit: "2599", hires: "2599", master: "jymaster" },
        wy: { "64k": "standard", "128k": "standard", "192k": "exhigh", "320k": "exhigh", flac: "lossless", flac24bit: "hires", hires: "hires", master: "jymaster" },
        kw: { "64k": "standard", "128k": "standard", "192k": "exhigh", "320k": "exhigh", flac: "lossless", flac24bit: "atmos", hires: "atmos", master: "master" },
        kg: { "64k": "standard", "128k": "standard", "192k": "exhigh", "320k": "exhigh", flac: "lossless", flac24bit: "hires", hires: "hires", master: "clear" },
        mg: { "64k": "128k", "128k": "128k", "192k": "320k", "320k": "320k", flac: "flac", flac24bit: "flac24bit", hires: "hires", master: "hires" }
      };
      var yxLevel = (yxLevelMap[yxPlat] || yxLevelMap.tx)[q] || "exhigh";
      var yxId = mid;
      if (yxPlat === "kg") {
        yxId = String((song && (song.hash || song.FileHash || song.songmid || mid)) || mid || "").toLowerCase();
      }
      var yxBase = String(src.url || "https://musicserver.haitangw.cc").replace(/\/$/, "");
      if (!/musicserver\.haitangw\.cc/i.test(yxBase)) yxBase = "https://musicserver.haitangw.cc";
      var yxUrl = yxBase + "/v1/music/resolve-url";
      // 目标档 + 降级链
      var yxTry = [yxLevel];
      var yxFall = { jymaster: ["2599", "lossless", "exhigh", "standard"], "2599": ["lossless", "exhigh", "standard"], hires: ["lossless", "exhigh", "standard"], master: ["atmos", "lossless", "exhigh", "standard"], atmos: ["lossless", "exhigh", "standard"], clear: ["hires", "lossless", "exhigh", "standard"], lossless: ["exhigh", "standard"], flac24bit: ["flac", "320k", "128k"], flac: ["320k", "128k"], exhigh: ["standard"], "320k": ["128k"] };
      (yxFall[yxLevel] || ["exhigh", "standard"]).forEach(function (lv) {
        if (yxTry.indexOf(lv) < 0) yxTry.push(lv);
      });
      for (var yi = 0; yi < yxTry.length && yi < 4; yi++) {
        try {
          var yxRes = await reqFetch(yxUrl, {
            method: "POST",
            timeout: 8,
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: { source: yxPlat, rid: String(yxId), level: yxTry[yi] }
          });
          if (!yxRes) continue;
          var yxMusic = null;
          if (yxRes.code === 0 || yxRes.code === "0") {
            if (yxRes.data && yxRes.data.url) yxMusic = yxRes.data.url;
            else if (yxRes.url) yxMusic = yxRes.url;
          }
          if (!yxMusic && yxRes.data && typeof yxRes.data === "string" && /^https?:/i.test(yxRes.data)) yxMusic = yxRes.data;
          if (yxMusic && /^https?:/i.test(String(yxMusic))) {
            var yxOut = String(yxMusic).trim().replace(/^http:\/\//i, "https://");
            // 以 URL 实际标记为准（AI0=母带 / RS01=Hi-Res / F000=无损 / M500=128k）
            var detYx = detectQualityFromUrl(yxOut);
            var yxQ = detYx || (q === "master" || q === "hires" || q === "flac24bit" ? "" : (apiLevelToPlayQ(yxTry[yi]) || q));
            return yxQ ? tagPlayUrl(yxOut, yxQ) : yxOut;
          }
        } catch (eYx) {
          console.warn("[yuxi]", yxPlat, yxTry[yi], eYx);
        }
      }
      return null;
    }

    // 第三方 LX 脚本源：走轻量运行时（长青已在上方短路）
    if (src && (src.script || src.lxScript || (src.type === "js" && src._script))) {
      try {
        var sc = src.script || src.lxScript || src._script;
        var lxUrl = await runLxPluginMusicUrl(sc, song, forceQ);
        if (lxUrl) {
          // 兜底：脚本若仍返回 http 中转站，强制升 HTTPS
          lxUrl = String(lxUrl).replace(/^http:\/\//i, "https://");
          if (/yinyue\.haitangw\.net/i.test(lxUrl)) {
            lxUrl = lxUrl.replace(/^http:\/\//i, "https://");
          }
          return lxUrl;
        }
      } catch (eLx) { console.warn("[resolve] lx script", eLx); }
    }
    if (S.lxScript && src && (src.id === "lx" || /墨澜|聚合/i.test(String(src.name || "")))) {
      try {
        var lxUrl2 = await runLxPluginMusicUrl(S.lxScript, song, forceQ);
        if (lxUrl2) return String(lxUrl2).replace(/^http:\/\//i, "https://");
      } catch (eLx2) {}
    }

    // 玉宁熙 Pro：对齐 LX 脚本 — QQ / 网易 / 酷我 / 酷狗 / 咪咕
    if (src.id === "ynx" || /玉宁熙|星河入梦|yuafeng/i.test(src.name + (src.url || ""))) {
      // —— QQ：v.yuafeng.cn ——
      if (songPlat === "qq") {
        var baseY = String(src.url || "https://v.yuafeng.cn").replace(/\/$/, "");
        if (!/yuafeng\.cn/i.test(baseY)) baseY = "https://v.yuafeng.cn";
        // 每种音质最多试 2 个 type，加快失败
        var typeNames = [ynxType(q)];
        if (q === "128k" || q === "64k") typeNames.push("低品质");
        else if (q === "320k" || q === "192k") typeNames.push("中品质");
        else if (q === "flac") typeNames.push("SQ无损");
        else if (q === "hires" || q === "flac24bit" || q === "master") typeNames.push("臻品母带");
        var seenT = {};
        for (var ti = 0; ti < typeNames.length; ti++) {
          var tn = typeNames[ti];
          if (!tn || seenT[tn]) continue;
          seenT[tn] = 1;
          var yurl = baseY + "/api/qqmusic?type=" + encodeURIComponent(tn) +
            "&mid=" + encodeURIComponent(mid) +
            "&apikey=" + encodeURIComponent(YNX_KEY);
          var ynx = await reqFetch(yurl, {
            timeout: 6,
            headers: { Authorization: "Bearer " + YNX_KEY },
          });
          if (!ynx) continue;
          var music = null;
          if (ynx.code === 0 || ynx.code === "0") {
            if (ynx.data) {
              if (ynx.data.music) music = ynx.data.music;
              else if (ynx.data.url) music = ynx.data.url;
            }
            if (!music && ynx.music) music = ynx.music;
            if (!music && ynx.url) music = ynx.url;
          }
          if (!music && ynx._text && /^https?:/.test(String(ynx._text).trim())) music = String(ynx._text).trim();
          if (music) {
            try {
              if (ynx.data && ynx.data.cover) song.cover = fixCover(ynx.data.cover);
              if (ynx.data && ynx.data.album_mid) {
                song.albummid = ynx.data.album_mid;
                if (!song.cover) song.cover = coverUrl(ynx.data.album_mid);
              }
            } catch (eC) {}
            var mu = String(music).trim().replace(/^http:\/\//i, "https://");
            // 只按 URL 真实可识别的档位打标记，绝不把请求档当成实际档
            var detMu = detectQualityFromUrl(mu);
            if (detMu) return tagPlayUrl(mu, detMu);
            if (q === "master" || q === "hires" || q === "flac24bit") return mu;
            return q ? tagPlayUrl(mu, q) : mu;
          }
        }
        return null;
      }

      // —— 网易：IKUN 接口 c.wwwweb.top（支持 quality=master / hires / flac）——
      if (songPlat === "netease") {
        function pickWyPack(wyRes) {
          if (!wyRes) return null;
          var url = null, qRet = null;
          if (Number(wyRes.code) === 200 && wyRes.url && /^https?:/i.test(String(wyRes.url))) {
            url = String(wyRes.url).trim().replace(/^http:\/\//i, "https://");
            qRet = wyRes.quality || null;
          } else if (wyRes.data && wyRes.data.url && /^https?:/i.test(String(wyRes.data.url))) {
            url = String(wyRes.data.url).trim().replace(/^http:\/\//i, "https://");
            qRet = (wyRes.data.quality || wyRes.quality) || null;
          } else if (wyRes._text) {
            try {
              var j = JSON.parse(String(wyRes._text).replace(/^[^\{]*/, ""));
              if (j && j.url && /^https?:/i.test(String(j.url))) {
                url = String(j.url).trim().replace(/^http:\/\//i, "https://");
                qRet = j.quality || null;
              }
            } catch (eJ) {}
          }
          if (!url) return null;
          // 归一化 API 返回的 quality 字段
          var qn = String(qRet || "").toLowerCase();
          if (qn === "jymaster" || qn === "master") qn = "master";
          else if (qn === "hires" || qn === "flac24bit") qn = "hires";
          else if (qn === "lossless" || qn === "sq" || qn === "flac") qn = "flac";
          else if (qn === "exhigh" || qn === "320" || qn === "320k") qn = "320k";
          else if (!qn) qn = null;
          return { url: url, quality: qn };
        }
        async function tryWyQuality(qq) {
          var body = JSON.stringify({ source: "wy", musicId: String(mid), quality: qq });
          try {
            var wyRes = await reqFetch("https://c.wwwweb.top/music/url", {
              method: "POST",
              timeout: 5,
              headers: { "Content-Type": "application/json", Accept: "application/json" },
              body: body,
            });
            var p1 = pickWyPack(wyRes);
            if (p1 && p1.url) return p1;
          } catch (eWy) {
            console.warn("[ynx] netease post fail", qq, eWy);
          }
          try {
            var proxyUrl = "https://corsproxy.io/?" + encodeURIComponent("https://c.wwwweb.top/music/url");
            var wyRes2 = await reqFetch(proxyUrl, {
              method: "POST",
              timeout: 5,
              noProxy: true,
              headers: { "Content-Type": "application/json", Accept: "application/json" },
              body: body,
            });
            var p2 = pickWyPack(wyRes2);
            if (p2 && p2.url) return p2;
          } catch (eWy2) {
            console.warn("[ynx] netease proxy fail", qq, eWy2);
          }
          return null;
        }
        // 母带/Hi-Res：按档位阶梯试，成功则打可信标记
        var wyTry = [q];
        if (q === "master") wyTry = ["master", "hires", "flac"];
        else if (q === "hires" || q === "flac24bit") wyTry = ["hires", "flac"];
        else if (q === "flac") wyTry = ["flac", "320k"];
        var seenW = {};
        for (var wi = 0; wi < wyTry.length; wi++) {
          var wq = wyTry[wi];
          if (!wq || seenW[wq]) continue;
          seenW[wq] = 1;
          var packW = await tryWyQuality(wq);
          if (!packW || !packW.url) continue;
          // 请求母带时：只有 API 声明 master 或当前试的就是 master 且成功，才接受为母带
          var tagged = packW.quality || wq;
          if (q === "master" && tagged !== "master" && wq !== "master") {
            // 降档试到的 hires/flac：严格模式下由外层判断；此处仍返回并标记真实档
            return tagPlayUrl(packW.url, tagged);
          }
          if (q === "master" && (tagged === "master" || wq === "master")) {
            return tagPlayUrl(packW.url, "master");
          }
          return tagPlayUrl(packW.url, tagged);
        }
        return null;
      }

      // —— 酷我：车机接口 ——
      if (songPlat === "kuwo") {
        var kwBr = ({
          "64k": "128kmp3",
          "128k": "128kmp3",
          "192k": "320kmp3",
          "320k": "320kmp3",
          flac: "2000kflac",
          flac24bit: "4000kflac",
          hires: "4000kflac",
          master: "4000kflac",
        })[q] || "2000kflac";
        var uid = String(Math.floor(Math.random() * 0xffffff));
        var kwUrl =
          "https://nmobi.kuwo.cn/mobi.s?f=web&source=kwplayercar_ar_6.0.0.9_B_jiakong_vh.apk" +
          "&type=convert_url_with_sign&rid=" + encodeURIComponent(mid) +
          "&br=" + encodeURIComponent(kwBr) +
          "&user=" + uid + "&loginUid=" + uid;
        try {
          var kwRes = await reqFetch(kwUrl, { timeout: 5 });
          var kwPlay = (kwRes && kwRes.data && kwRes.data.url) || (kwRes && kwRes.url) || "";
          // 车机接口版权拦截时会返回字符串 "None"
          if (kwPlay && String(kwPlay) !== "None" && /^https?:/i.test(String(kwPlay))) {
            kwPlay = String(kwPlay).split("?")[0];
            kwPlay = kwPlay.replace(/^http:\/\//i, "https://");
            var kwQ = /4000k/i.test(kwBr) ? (q === "master" ? "master" : "hires") : /2000k|flac/i.test(kwBr) ? "flac" : /320/i.test(kwBr) ? "320k" : "128k";
            return tagPlayUrl(kwPlay, kwQ);
          }
        } catch (eKw) {
          console.warn("[ynx] kuwo fail", eKw);
        }
        return null;
      }

      // —— 酷狗：星海接口 ——
      if (songPlat === "kugou") {
        var mainHash = String((song && (song.hash || song.FileHash || song.songmid || mid)) || mid).toUpperCase();
        var kgMid = String((song && (song.songmid || song.id)) || mid);
        var albumId = String((song && (song.albumId || song.album_id || "")) || "");
        var kgUrl =
          "https://yy.zddyr.top/lx/api/?source=kg&quality=" + encodeURIComponent(q) +
          "&mainHash=" + encodeURIComponent(mainHash) +
          "&songmid=" + encodeURIComponent(kgMid) +
          "&albumId=" + encodeURIComponent(albumId);
        try {
          var kgRes = await reqFetch(kgUrl, { timeout: 5 });
          if (kgRes && Number(kgRes.code) === 200 && kgRes.url && /^https?:/i.test(String(kgRes.url))) {
            var kgOut = String(kgRes.url).trim().replace(/^http:\/\//i, "https://");
            var kgQ = (q === "master") ? "master" : (q === "hires" || q === "flac24bit") ? "hires" : (q || "flac");
            return tagPlayUrl(kgOut, kgQ);
          }
        } catch (eKg) {
          console.warn("[ynx] kugou fail", eKg);
        }
        return null;
      }

      // 咪咕链路依赖专辑 contentId，网页端成功率低，交给其它源
      return null;
    }

    // 念心 v1.0.1：接口直接吐音频流（非 JSON），拼好的 URL 就是播放地址（与 LX 原版一致）
    if (src.id === "nianxin" || /念心|松间听雨|nianxin/i.test(src.name + (src.url || ""))) {
      if (srcPlats.length && srcPlats.indexOf(songPlat) < 0 && srcPlats.indexOf("all") < 0) {
        if (songPlat !== "qq") return null;
      }
      var nxFile = ({
        qq: "tx.php",
        netease: "wy.php",
        kuwo: "kw.php",
        kugou: "kg.php",
        migu: "mg.php",
      })[songPlat] || "tx.php";
      var level = nxLevel(q, songPlat);
      if (!level || level === "undefined") level = "lossless";
      var baseNx = String(src.url || "https://mcp.nianxinxz.com").replace(/\/$/, "");
      // 原版返回可播 URL 字符串，不要 fetch 解析 body（body 是 mp3/flac 二进制）
      // 酷狗：必须用 FileHash；咪咕：依次试 contentId / copyrightId / songId
      var idCandidates = [];
      if (songPlat === "kugou") {
        var h = String((song && (song.hash || song.FileHash || song.songmid || mid)) || mid || "").toLowerCase();
        if (h) idCandidates.push(h);
      } else if (songPlat === "migu") {
        [song && song.contentId, song && song.copyrightId, song && song.miguSongId, mid].forEach(function (x) {
          x = String(x || "").trim();
          if (x && idCandidates.indexOf(x) < 0) idCandidates.push(x);
        });
      } else {
        idCandidates.push(String(mid || ""));
      }
      idCandidates = idCandidates.filter(Boolean);
      if (!idCandidates.length) return null;
      // 接口直接吐流：返回第一个候选 URL（播放器播失败会换源/降级）
      // 咪咕若服务端当前全空，会在 play 失败后走其它源或 QQ 回退
      var nxId = idCandidates[0];
      var nxPlayUrl =
        baseNx.replace(/^http:/i, "https:") +
        "/share/ceshi/" + nxFile +
        "?id=" + encodeURIComponent(nxId) +
        "&level=" + encodeURIComponent(level) +
        "&type=mp3";
      var nxQ = apiLevelToPlayQ(level) || (level === "master" ? "master" : level === "hires" ? "hires" : level === "lossless" ? "flac" : null);
      return nxQ ? tagPlayUrl(nxPlayUrl, nxQ) : nxPlayUrl;
    }
    // 长青解析已前置到 resolveBySource 开头（HTTPS 直链）

    // 自定义 API / 导入源：按「歌曲所属平台 ∩ 源勾选平台」解析
    // 勾了多平台且原版支持 → 会按 song.source 走对应 plat code
    // 注意：纯 LX Music 脚本（无 HTTP 接口）无法在网页执行，必须能抽到 base URL
    if (src.url && (src.type === "api" || src.type === "js" || !src.type)) {
      var base = String(src.url).replace(/\/$/, "");
      var platCode = { qq: "tx", netease: "wy", kugou: "kg", kuwo: "kw", migu: "mg" };
      // 只试：歌曲平台（优先）+ 源声明支持的平台；未勾选的不试
      var codes = [];
      function pushCode(p) {
        var c = platCode[p];
        if (c && codes.indexOf(c) < 0) codes.push(c);
      }
      // 源声明了平台时严格按勾选；未声明则放宽
      var declared = srcPlats.filter(function (p) { return p && p !== "all"; });
      if (declared.length) {
        // 歌曲平台在勾选内才优先
        if (!declared.length || declared.indexOf(songPlat) >= 0 || srcPlats.indexOf("all") >= 0) {
          pushCode(songPlat);
        }
        declared.forEach(pushCode);
      } else {
        pushCode(songPlat);
        codes = codes.concat(["tx", "wy", "kg", "kw", "mg"].filter(function (c) { return codes.indexOf(c) < 0; }));
      }
      if (!codes.length) codes = [platCode[songPlat] || "tx"];

      var tryUrls = [];
      codes.forEach(function (code) {
        // LX 常见：/url/{plat}/{id}/{quality}
        tryUrls.push(base + "/url/" + code + "/" + encodeURIComponent(mid) + "/" + encodeURIComponent(q));
        tryUrls.push(base + "/url/" + code + "/" + encodeURIComponent(mid) + "/" + encodeURIComponent(nxLevel(q, songPlat)));
        // /{plat}/url?id=&quality=
        tryUrls.push(base + "/" + code + "/url?id=" + encodeURIComponent(mid) + "&quality=" + encodeURIComponent(q));
      });
      // QQ 曲库额外试 qqmusic / level 风格
      if (songPlat === "qq") {
        tryUrls.push(base + "/api/qqmusic?mid=" + encodeURIComponent(mid) + "&type=" + encodeURIComponent(ynxType(q)));
        tryUrls.push(base + "/api/qqmusic?type=" + encodeURIComponent(ynxType(q)) + "&mid=" + encodeURIComponent(mid));
        tryUrls.push(base + "?id=" + encodeURIComponent(mid) + "&level=" + encodeURIComponent(nxLevel(q, songPlat)));
      }
      // 网易常见 POST 风格（部分导入源）
      if (songPlat === "netease") {
        try {
          var impWy = await reqFetch(base + "/music/url", {
            method: "POST",
            timeout: 5,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ source: "wy", musicId: String(mid), quality: q }),
          });
          if (impWy && Number(impWy.code) === 200 && impWy.url && /^https?:/i.test(String(impWy.url))) {
            var impU = String(impWy.url).trim().replace(/^http:\/\//i, "https://");
            var impQ = (impWy.quality || q || "").toLowerCase();
            if (impQ === "jymaster") impQ = "master";
            if (impQ === "lossless") impQ = "flac";
            return tagPlayUrl(impU, impQ || q);
          }
        } catch (eImpWy) {}
      }
      tryUrls.push(base + "/url?id=" + encodeURIComponent(mid) + "&quality=" + encodeURIComponent(q) + "&type=" + encodeURIComponent(platCode[songPlat] || "tx"));
      tryUrls.push(base + "/url?id=" + encodeURIComponent(mid) + "&quality=" + encodeURIComponent(q) + "&source=" + encodeURIComponent(platCode[songPlat] || "tx"));

      // 最多试前 4 个 URL，避免自定义源拖死起播
      for (var j = 0; j < tryUrls.length && j < 4; j++) {
        var d = await reqFetch(tryUrls[j], { timeout: 4, noProxy: j > 0 });
        if (!d) continue;
        if (typeof d === "string" && /^https?:/.test(d)) return d.replace(/^http:\/\//i, "https://");
        if (d.url && /^https?:/.test(d.url)) return String(d.url).replace(/^http:\/\//i, "https://");
        if (d.data && d.data.music && /^https?:/.test(String(d.data.music))) return String(d.data.music).trim().replace(/^http:\/\//i, "https://");
        if (d.data && typeof d.data === "string" && /^https?:/.test(d.data)) return d.data.replace(/^http:\/\//i, "https://");
        if (d.data && d.data.url && /^https?:/.test(d.data.url)) return String(d.data.url).replace(/^http:\/\//i, "https://");
        if (d._text && /^https?:/.test(String(d._text).trim())) return String(d._text).trim().replace(/^http:\/\//i, "https://");
      }
    }
    if (src.type === "file") return null;
    return null;
  }

  function inferQ(url) {
    return detectQualityFromUrl(url) || S.quality;
  }

  /* ========== Player ========== */
  var _playGen = 0;
  async function play(song, list, preferUrl) {
    if (!song) return;
    // B站：点搜索结果里的合集/多P稿时，先拆成单集列表，不要整包只播第一首
    try {
      if (!preferUrl && isBiliSong(song) && !song._biliPart && !song._biliExpandSkip) {
        // 队列已是展开后的分集则跳过
        var alreadyParts = list && list.length > 1 && list.every(function (x) { return x && x._biliPart; });
        if (!alreadyParts) {
          try { toast("正在解析分集…"); } catch (eT0) {}
          var exp = await bilibiliExpandParts(song);
          if (exp && exp.multi && exp.songs && exp.songs.length > 1) {
            await openBiliCollectionDetail(exp, song);
            return;
          }
          // 单 P：用补全 cid 的条目继续播
          if (exp && exp.songs && exp.songs[0]) {
            var origSong = song;
            song = exp.songs[0];
            if (list && list.length) {
              try {
                for (var ii = 0; ii < list.length; ii++) {
                  if (!list[ii]) continue;
                  if (list[ii] === origSong || (list[ii].bvid && list[ii].bvid === (origSong.bvid || song.bvid)) ||
                      keyOf(list[ii]) === keyOf(origSong)) {
                    list[ii] = Object.assign({}, list[ii], song);
                    break;
                  }
                }
              } catch (eRep) {}
            }
          }
        }
      }
    } catch (eBiliPlay) {
      console.warn("[bili] expand on play", eBiliPlay);
    }
    // 每次点播/切歌递增代数；旧的异步解析在落地前发现代数变了就立刻放弃
    var gen = ++_playGen;
    if (list && list.length) {
      try {
        if (_channelPlayCtx && !_channelPlayCtx._lock) {
          var ck = "";
          try { ck = keyOf(song); } catch (eK0) {}
          if (!ck || !_channelPlayCtx.seen || !_channelPlayCtx.seen[ck]) _channelPlayCtx = null;
        }
      } catch (eClr) {}
      S.queue = list.slice();
      S.idx = indexInList(S.queue, song);
      if (S.idx < 0) {
        S.queue = [song].concat(S.queue.filter(function (x) { return !sameSong(x, song); }));
        S.idx = 0;
      }
    } else {
      if (!S.queue.length) { S.queue = [song]; S.idx = 0; }
      else {
        var i = indexInList(S.queue, song);
        if (i >= 0) S.idx = i;
        else { S.queue.splice(S.idx + 1, 0, song); S.idx++; }
      }
    }
    // 立刻换封面/标题，并停掉上一首，避免快速连切仍听旧歌
    // 切歌前先按队列预取取色，尽量让下一首瞬间命中
    try { prefetchAmbientAround(song); } catch (ePf) {}
    paintNow(song);
    var mini = $("#mini");
    if (mini) mini.classList.add("show");
    try {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    } catch (eStop) {}
    setPlaying(false);

    // 取不到目标音质或播失败 → 按链降级
    var wantQ = S.quality || "flac";
    var qChain = (S.autoQDowngrade !== false) ? qualityFallbacks(wantQ) : [wantQ];
    var played = false;
    var usedQ = wantQ;
    var keepRate = Number(audio.playbackRate) || 1;
    loadLyrics(song);

    async function tryPlayUrl(url, q) {
      if (!url) return false;
      if (gen !== _playGen) return false; // 已被更新的切歌取消
      async function attempt(srcUrl) {
        if (gen !== _playGen) return false;
        audio.removeAttribute("crossorigin");
        audio.src = srcUrl;
        try { audio.playbackRate = keepRate; } catch (eR) {}
        await audio.play();
        if (gen !== _playGen) {
          try { audio.pause(); } catch (eA) {}
          return false;
        }
        setPlaying(true);
        return true;
      }
      // B站：对齐参考 HTML —— 只走 fm.res（带 Referer）或 fm.req→blob，裸链几乎必 403
      url = typeof biliStripTag === "function" ? biliStripTag(url) : url;
      var isBiliUrl = /bilivideo|akamaized|hdslb|bilibili/i.test(String(url));
      if (isBiliUrl || isBiliSong(song)) {
        var biliHdrs = (song && song._biliPlayHeaders) || {
          "User-Agent": BILI_UA,
          "Accept": "*/*",
          "Referer": "https://www.bilibili.com/video/" + ((song && (song.bvid || song.aid)) || ""),
          "referer": "https://www.bilibili.com/video/" + ((song && (song.bvid || song.aid)) || ""),
        };
        // a) fm.res 注入头
        try {
          if (window.fm && typeof window.fm.res === "function") {
            var pxy = window.fm.res(url, { headers: biliHdrs, credentials: "include" });
            if (pxy && pxy !== url) {
              try { if (await attempt(pxy)) return true; } catch (ePx) { console.warn("[bili] fm.res play", ePx); }
            }
          }
        } catch (eFm) {}
        // b) mediaUrl 兼容
        try {
          if (typeof mediaUrl === "function") {
            var mu = mediaUrl(url, biliHdrs);
            if (mu && mu !== url) {
              try { if (await attempt(mu)) return true; } catch (eMu) {}
            }
          }
        } catch (eM) {}
        // c) fm.req arraybuffer → blob
        try {
          if (window.fm && typeof window.fm.req === "function") {
            var res = await Promise.resolve(window.fm.req(url, {
              method: "GET",
              headers: biliHdrs,
              responseType: "arraybuffer",
              timeout: 25,
              credentials: "omit",
            }));
            var buf = null;
            if (res && res.body instanceof ArrayBuffer) buf = res.body;
            else if (res instanceof ArrayBuffer) buf = res;
            else if (res && res.data instanceof ArrayBuffer) buf = res.data;
            if (buf && buf.byteLength > 1000) {
              var blob = new Blob([buf], { type: "audio/mp4" });
              var obj = URL.createObjectURL(blob);
              try {
                if (await attempt(obj)) {
                  setTimeout(function () { try { URL.revokeObjectURL(obj); } catch (eR) {} }, 600000);
                  return true;
                }
              } catch (eBl) {
                try { URL.revokeObjectURL(obj); } catch (eR2) {}
              }
            }
          }
        } catch (eReq) {
          console.warn("[bili] blob play fail", eReq);
        }
        // d) 裸链最后碰运气（多数环境会 403）
        try {
          if (await attempt(url)) return true;
        } catch (eRaw) {
          console.warn("[bili] raw play fail", eRaw);
        }
        return false; // B站到此结束，不要再走 FLAC blob / 降级换源
      }
      // 1) 直接播
      try {
        return await attempt(url);
      } catch (e1) {
        if (gen !== _playGen) return false;
        // 2) http/https 互换
        try {
          var alt = url.startsWith("https://") ? url.replace(/^https:\/\//, "http://") : url.replace(/^http:\/\//, "https://");
          if (alt !== url) return await attempt(alt);
        } catch (e2) {}
        if (gen !== _playGen) return false;
        // 3) FLAC/高码率：部分 WebView 直链失败，拉 blob 再播（不立刻降级成 128k）
        var wantBlob = /flac|hires|master|lossless|f000|ai00|\.flac/i.test(String(url) + (q || ""));
        if (wantBlob) {
          try {
            var resp = await fetch(url, { mode: "cors", credentials: "omit" });
            if (!resp.ok) throw new Error("blob http " + resp.status);
            var blob = await resp.blob();
            if (blob && blob.size > 1000) {
              var obj = URL.createObjectURL(blob);
              try {
                return await attempt(obj);
              } finally {
                setTimeout(function () { try { URL.revokeObjectURL(obj); } catch (e) {} }, 600000);
              }
            }
          } catch (e3) {
            console.warn("[play] blob fallback fail", q, e3);
          }
        }
        console.warn("[PlaybackController] quality fallback playback failed: quality=" + q, e1);
        return false;
      }
    }

    // 0) 本地下载库（IndexedDB）优先离线播放
    if (!preferUrl) {
      try {
        var localUrl = await getLocalPlayUrl(song);
        if (localUrl) {
          preferUrl = localUrl;
          try { toast("正在播放本地文件"); } catch (eT0) {}
        }
      } catch (eLoc) {}
    }

    // 优先用预取好的下一首地址 / 本地 blob（手动切歌秒切）
    if (preferUrl && (/^https?:\/\//i.test(String(preferUrl)) || /^blob:/i.test(String(preferUrl)))) {
      S.playQ = inferQ(preferUrl) || wantQ;
      usedQ = S.playQ;
      setPlayQDisplay(usedQ);
      if (await tryPlayUrl(preferUrl, wantQ)) {
        played = true;
        usedQ = detectQualityFromUrl(preferUrl) || usedQ;
        S.playQ = usedQ;
        setPlayQDisplay(usedQ);
        try {
          bindMediaSessionActions();
          updateMediaSession(song);
          setMediaPlaybackState(true);
          setTimeout(function () { try { updateMediaSession(song); } catch (e) {} }, 600);
        } catch (eP) {}
      }
    }

    if (!played) {
      for (var qi = 0; qi < qChain.length; qi++) {
        if (gen !== _playGen) return; // 用户已切到更新一首
        var tryQ = qChain[qi];
        var pack = null;
        try {
          pack = await resolvePlayAtQuality(song, tryQ);
        } catch (e) {
          console.warn("[PlaybackController] quality fallback lookup failed: quality=" + tryQ, e);
        }
        if (gen !== _playGen) return;
        if (!pack || !pack.url) continue;

        paintNow(song);
        S.playQ = detectQualityFromUrl(pack.url) || pack.quality || tryQ;
        usedQ = S.playQ;
        setPlayQDisplay(usedQ);

        if (await tryPlayUrl(pack.url, tryQ)) {
          played = true;
          var realQ = detectQualityFromUrl(pack.url) || pack.quality || tryQ;
          usedQ = realQ;
          S.playQ = realQ;
          setPlayQDisplay(realQ);
          // iOS Safari：必须在 play() 成功后再写一遍 Now Playing，否则锁屏无封面/无按钮
          try {
            bindMediaSessionActions();
            updateMediaSession(song);
            setMediaPlaybackState(true);
            updateMediaPositionState();
            // 封面图可能异步加载，稍后再刷一次 metadata
            setTimeout(function () {
              try { updateMediaSession(song); updateMediaPositionState(); } catch (e2) {}
            }, 600);
            setTimeout(function () {
              try { updateMediaSession(song); } catch (e3) {}
            }, 1800);
          } catch (eMs) {}
          if (pack.via === "qq-fallback") {
            var fromName = ({ netease: "网易", kuwo: "酷我", kugou: "酷狗", migu: "咪咕" })[pack.fallbackFrom || song.source] || "当前站源";
            try { toast(fromName + "解析失败，已切换 QQ 同源曲播放"); } catch (eT) {}
          }
          break;
        }
      }
    }

    if (gen !== _playGen) return; // 最终结果也不要 toast/写历史

    // B站：独立取流，失败只提示，绝对不换 QQ / 内置音源
    var _isBiliPlay = false;
    try {
      _isBiliPlay = isBiliSong(song) || (S.platform === "bilibili") || (S.platform === "bili")
        || (song && (song.bvid || /^bv_/i.test(String(song.songmid || ""))));
    } catch (eIb) {}
    if (!played && song && _isBiliPlay) {
      try { toast("B站无法取流。请在 FongMi 等壳内使用，或检查网络"); } catch (eTb) {}
      return;
    }

    // 播放失败：自动换源一次（搜 QQ 同源曲再解析，仅一次）—— 非 B站
    if (!played && song && !song._autoSrcSwitched && !_isBiliPlay) {
      try {
        song._autoSrcSwitched = true;
        var kw2 = ((song.name || "") + " " + (song.artist || "")).trim();
        if (kw2) {
          var altList = await searchQQ(kw2).catch(function () { return []; });
          var alt0 = (altList || []).find(function (x) {
            return x && x.songmid && String(x.songmid) !== String(song.songmid || song.mid || "");
          }) || (altList && altList[0]);
          if (alt0 && alt0.songmid) {
            var altSong = Object.assign({}, alt0, { source: "qq", _autoSrcSwitched: true });
            toast("正在换源重试…");
            var altPack = await resolvePlayWithQ(altSong, wantQ).catch(function () { return null; });
            if (altPack && altPack.url && gen === _playGen) {
              paintNow(altSong);
              // 用同源曲替换队列当前项，避免再点还是坏链
              try {
                if (S.queue && S.idx >= 0) S.queue[S.idx] = Object.assign({}, S.queue[S.idx], altSong);
              } catch (eRep) {}
              if (await tryPlayUrl(altPack.url, altPack.quality || wantQ)) {
                played = true;
                usedQ = detectQualityFromUrl(altPack.url) || altPack.quality || wantQ;
                S.playQ = usedQ;
                setPlayQDisplay(usedQ);
                try {
                  bindMediaSessionActions();
                  updateMediaSession(altSong);
                  setMediaPlaybackState(true);
                } catch (eMsA) {}
                toast("已换源继续播放");
              }
            }
          }
        }
      } catch (eSw) {
        console.warn("[play] auto switch source fail", eSw);
      }
    }

    if (!played) {
      toast("暂时无法播放，请换一首或调整音质");
    } else if (usedQ !== wantQ && qualityRank(usedQ) > qualityRank(wantQ)) {
      toast(qLabel(wantQ) + "暂不可用 · 已切换" + qLabel(usedQ));
    }

    pushRecent(song);
    // 清掉已消费的预取，再预取新的下一首
    if (_nextKey === keyOf(song)) {
      _nextUrl = null;
      _nextKey = "";
    }
    prefetchNextUrl();
  }

  var _nextUrl = null, _nextKey = "";
  function prefetchNextUrl() {
    try {
      var q = S.queue || [];
      if (q.length < 2) return;
      var ni = (S.idx + 1) % q.length;
      var ns = q[ni];
      if (!ns) return;
      var k = keyOf(ns);
      if (k === _nextKey && _nextUrl) return;
      _nextKey = k;
      _nextUrl = null;
      var wantQ = S.quality || "flac";
      resolvePlay(ns, wantQ).then(function (u) {
        if (keyOf(ns) === _nextKey) _nextUrl = u;
      }).catch(function () {});
      prefetchAmbient(ns);
    } catch (e) {}
  }

  var _ambientToken = 0;
  function sampleCanvasColor(imgEl) {
    if (!imgEl || !(imgEl.naturalWidth || imgEl.width)) return null;
    try {
      var c = document.createElement("canvas");
      var w = 48, h = 48;
      c.width = w; c.height = h;
      var ctx = c.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(imgEl, 0, 0, w, h);
      var data = ctx.getImageData(0, 0, w, h).data;
      // 量化桶：统计占比；同时找最鲜艳
      var buckets = {};
      var vivid = null, vividScore = -1;
      var validN = 0;
      for (var i = 0; i < data.length; i += 4) {
        if (data[i + 3] < 150) continue;
        var rr = data[i], gg = data[i + 1], bb = data[i + 2];
        var max = Math.max(rr, gg, bb);
        var min = Math.min(rr, gg, bb);
        var lum = 0.299 * rr + 0.587 * gg + 0.114 * bb;
        // 太黑不要；白色可取但排除最白
        if (lum < 38) continue;
        if (lum > 242) continue; // 最白不要
        if (rr > 250 && gg > 250 && bb > 250) continue;
        var sat = max === 0 ? 0 : (max - min) / max;
        // 近灰不参与占比（避免黑白灰主导）
        if (sat < 0.12) continue;
        validN++;
        // 16 级量化桶 → 找占比最多
        var br = (rr >> 4), bg = (gg >> 4), bbk = (bb >> 4);
        var key = br + "," + bg + "," + bbk;
        if (!buckets[key]) buckets[key] = { n: 0, r: 0, g: 0, b: 0, sat: 0 };
        var bk = buckets[key];
        bk.n++;
        bk.r += rr; bk.g += gg; bk.b += bb;
        bk.sat += sat;
        // 鲜艳度得分（回退一些极端饱和权重）
        if (sat >= 0.22) {
          var score = sat * 1.15 + ((max - min) / 255) * 0.55 + (lum / 255) * 0.35;
          if (score > vividScore) {
            vividScore = score;
            vivid = { r: rr, g: gg, b: bb, sat: sat };
          }
        }
      }
      if (!validN) return null;
      // 占比最多的色桶
      var dom = null, domN = 0;
      for (var k in buckets) {
        if (!buckets.hasOwnProperty(k)) continue;
        var b = buckets[k];
        if (b.n > domN) {
          domN = b.n;
          dom = {
            r: Math.round(b.r / b.n),
            g: Math.round(b.g / b.n),
            b: Math.round(b.b / b.n),
            sat: b.sat / b.n,
            n: b.n,
          };
        }
      }
      function clampC(x) { return Math.max(0, Math.min(255, Math.round(x))); }
      // 规则：鲜艳 + 占比最多；过黑过白已过滤；结果在两者间加权回退
      if (dom && vivid) {
        var domShare = dom.n / validN;
        // 占比高且不太灰 → 多听众数；鲜艳很强则略拉向鲜艳
        // 更偏主色，鲜艳只作点缀，降低刺眼
        var wVivid = 0.18 + Math.min(0.2, (vivid.sat - 0.22) * 0.45);
        if (domShare > 0.22 && dom.sat >= 0.18) wVivid = Math.min(wVivid, 0.22);
        if (domShare > 0.35) wVivid = Math.min(wVivid, 0.15);
        var wDom = 1 - wVivid;
        return {
          r: clampC(dom.r * wDom + vivid.r * wVivid),
          g: clampC(dom.g * wDom + vivid.g * wVivid),
          b: clampC(dom.b * wDom + vivid.b * wVivid),
        };
      }
      if (dom) return { r: dom.r, g: dom.g, b: dom.b };
      if (vivid) return { r: vivid.r, g: vivid.g, b: vivid.b };
      return null;
    } catch (e) {
      return null;
    }
  }
  function extractCoverColor(url) {
    return new Promise(function (resolve) {
      if (!url) return resolve(null);
      var raw = String(url).trim();
      // 代理列表：把封面拉成可 CORS 读的图
      var candidates = [
        "https://images.weserv.nl/?url=" + encodeURIComponent(raw.replace(/^https?:\/\//i, "")) + "&w=64&h=64&fit=cover&output=jpg",
        "https://wsrv.nl/?url=" + encodeURIComponent(raw) + "&w=64&h=64&fit=cover&output=jpg",
        "https://cdn.statically.io/img/" + raw.replace(/^https?:\/\//i, "") + "?w=64&h=64",
      ];
      // 直连也试一次
      candidates.unshift(raw);

      function tryOne(i) {
        if (i >= candidates.length) return resolve(null);
        var src = candidates[i];
        // fetch blob → objectURL，避免 <img crossOrigin> 失败
        fetch(src, { mode: "cors", credentials: "omit", cache: "force-cache" })
          .then(function (r) {
            if (!r.ok) throw new Error("bad status");
            return r.blob();
          })
          .then(function (blob) {
            if (!blob || !blob.type || blob.type.indexOf("image") < 0) {
              // 有的代理不标 type，仍试
              if (!blob || blob.size < 80) throw new Error("empty");
            }
            var obj = URL.createObjectURL(blob);
            var img = new Image();
            img.onload = function () {
              var c = sampleCanvasColor(img);
              URL.revokeObjectURL(obj);
              if (c) resolve(c);
              else tryOne(i + 1);
            };
            img.onerror = function () {
              URL.revokeObjectURL(obj);
              tryOne(i + 1);
            };
            img.src = obj;
          })
          .catch(function () {
            // 退回 Image + crossOrigin
            var img = new Image();
            img.crossOrigin = "anonymous";
            img.onload = function () {
              var c = sampleCanvasColor(img);
              if (c) resolve(c);
              else tryOne(i + 1);
            };
            img.onerror = function () { tryOne(i + 1); };
            img.src = src;
          });
      }
      tryOne(0);
    });
  }
  var _ambientCur = { r: 250, g: 45, b: 72 };
  var _ambientAnim = null;
  var _colorCache = {}; // coverUrl -> {r,g,b}
  function rgbToAmbientPair(rgb) {
    if (!rgb) {
      return {
        c1: { r: 250, g: 45, b: 72 },
        c2: { r: 240, g: 200, b: 210 },
      };
    }
    var immersive = !!(S.npStyle === "immersive" || ($("#np") && $("#np").classList.contains("immersive")));
    if (immersive) {
      // 沉浸：保留并抬升最鲜艳色，不要压成灰黑中间色
      function vividBoost(c) {
        var r = c.r, g = c.g, b = c.b;
        var max = Math.max(r, g, b);
        var min = Math.min(r, g, b);
        var mid = (max + min) / 2;
        // 轻微抬饱和即可，避免刺眼
        if (max > min) {
          var k = 1.05;
          r = mid + (r - mid) * k;
          g = mid + (g - mid) * k;
          b = mid + (b - mid) * k;
        }
        // 整体再略压一点亮度
        r *= 0.88; g *= 0.88; b *= 0.88;
        var lum = 0.299 * r + 0.587 * g + 0.114 * b;
        if (lum < 48) {
          var lift = (48 - lum) * 0.7;
          r += lift; g += lift; b += lift;
        }
        if (lum > 175) {
          var cut = (lum - 175) * 0.55;
          r -= cut; g -= cut; b -= cut;
        }
        function cl(v) { return Math.max(0, Math.min(255, Math.round(v))); }
        return { r: cl(r), g: cl(g), b: cl(b) };
      }
      var v1 = vividBoost(rgb);
      return {
        c1: v1,
        c2: {
          r: Math.min(255, Math.round(v1.r * 0.75 + 20)),
          g: Math.min(255, Math.round(v1.g * 0.75 + 20)),
          b: Math.min(255, Math.round(v1.b * 0.75 + 20)),
        },
      };
    }
    // 经典：提亮并略增饱和
    function punch(v, lift) {
      return Math.min(255, Math.round(v * 0.85 + lift));
    }
    return {
      c1: {
        r: punch(rgb.r, 70),
        g: punch(rgb.g, 40),
        b: punch(rgb.b, 50),
      },
      c2: {
        r: Math.min(255, Math.round(rgb.r * 0.5 + 120)),
        g: Math.min(255, Math.round(rgb.g * 0.5 + 110)),
        b: Math.min(255, Math.round(rgb.b * 0.5 + 120)),
      },
    };
  }
  function setAmbientVars(c1, c2) {
    var np = $("#np");
    if (!np) return;
    np.style.setProperty("--np-c1", c1.r + ", " + c1.g + ", " + c1.b);
    np.style.setProperty("--np-c2", c2.r + ", " + c2.g + ", " + c2.b);
    try { syncNpUiContrast(c1, c2); } catch (eUi) {}
  }
  /** 根据取色亮度决定播放页字色/控件：亮底用深色字，暗底用浅色字 */
  function syncNpUiContrast(c1, c2) {
    var np = $("#np");
    if (!np) return;
    var isImm = np.classList.contains("immersive");
    var r = (c1 && c1.r) || 120, g = (c1 && c1.g) || 120, b = (c1 && c1.b) || 120;
    var r2 = (c2 && c2.r) || r, g2 = (c2 && c2.g) || g, b2 = (c2 && c2.b) || b;
    var lum1 = 0.299 * r + 0.587 * g + 0.114 * b;
    var lum2 = 0.299 * r2 + 0.587 * g2 + 0.114 * b2;
    var lum = lum1 * 0.65 + lum2 * 0.35;
    var needDarkUi;
    if (isImm) {
      // 沉浸：纯色底，亮度高 → 深字；否则白字
      needDarkUi = lum > 155;
    } else {
      // 经典：氛围被提亮，白底淡彩为主 → 默认深字；仅极暗封面用白字
      needDarkUi = lum > 88;
    }
    np.classList.toggle("np-ui-dark", !!needDarkUi);
    np.classList.toggle("np-ui-light", !needDarkUi);
  }
  function lerp(a, b, t) { return Math.round(a + (b - a) * t); }
  function animateAmbientTo(rgb, instant) {
    var pair = rgbToAmbientPair(rgb);
    var from = _ambientCur;
    var to = pair.c1;
    var to2 = pair.c2;
    if (_ambientAnim) cancelAnimationFrame(_ambientAnim);
    // 预取命中：瞬间切色，不再等 1～2 秒动画
    if (instant) {
      setAmbientVars(to, to2);
      _ambientCur = to;
      _ambientAnim = null;
      return;
    }
    var t0 = performance.now();
    var dur = 420;
    function frame(now) {
      var t = Math.min(1, (now - t0) / dur);
      // ease-out
      var e = 1 - Math.pow(1 - t, 3);
      var c1 = {
        r: lerp(from.r, to.r, e),
        g: lerp(from.g, to.g, e),
        b: lerp(from.b, to.b, e),
      };
      var c2 = {
        r: lerp(Math.min(255, from.r + 80), to2.r, e),
        g: lerp(Math.min(255, from.g + 80), to2.g, e),
        b: lerp(Math.min(255, from.b + 80), to2.b, e),
      };
      setAmbientVars(c1, c2);
      if (t < 1) {
        _ambientAnim = requestAnimationFrame(frame);
      } else {
        _ambientCur = to;
        _ambientAnim = null;
      }
    }
    _ambientAnim = requestAnimationFrame(frame);
  }
  function ambientSongKey(song) {
    if (!song) return "";
    try {
      if (typeof keyOf === "function") return "sk:" + keyOf(song);
    } catch (e) {}
    return "sk:" + String(song.source || "") + ":" + String(song.songmid || song.id || song.name || "");
  }
  function storeAmbientColor(song, cover, lo, rgb) {
    if (!rgb) return;
    var sk = ambientSongKey(song);
    if (sk) _colorCache[sk] = rgb;
    if (cover) _colorCache[cover] = rgb;
    if (lo) _colorCache[lo] = rgb;
  }
  function lookupAmbientColor(song, cover, lo) {
    var sk = ambientSongKey(song);
    if (sk && _colorCache[sk]) return _colorCache[sk];
    if (cover && _colorCache[cover]) return _colorCache[cover];
    if (lo && _colorCache[lo]) return _colorCache[lo];
    return null;
  }
  function applyNpAmbient(rgb, instant) {
    animateAmbientTo(rgb, instant);
  }
  /** 从已解码的 <img> 同步取色（最快，无网络） */
  function sampleAmbientFromImg(img) {
    try {
      if (!img || !img.complete || !(img.naturalWidth || img.width)) return null;
      if (!img.src || img.src.indexOf("data:image/svg") === 0) return null;
      return sampleCanvasColor(img);
    } catch (e) { return null; }
  }
  function prefetchAmbient(song) {
    if (!song) return;
    var sk = ambientSongKey(song);
    if (sk && _colorCache[sk]) return;
    var lo = songCover(song);
    var cover = (typeof songCoverHi === "function" ? songCoverHi(song) : lo) || lo;
    if (!cover || cover.indexOf("data:") === 0) return;
    if (_colorCache[cover] || (lo && _colorCache[lo])) {
      // 封面已有色则反写歌曲 key
      var rgb0 = _colorCache[cover] || _colorCache[lo];
      if (rgb0 && sk) _colorCache[sk] = rgb0;
      return;
    }
    extractCoverColor(cover).then(function (rgb) {
      storeAmbientColor(song, cover, lo, rgb);
    });
  }
  function prefetchAmbientAround(song) {
    try {
      var q = S.queue || [];
      var n = q.length;
      if (!n) return;
      var idx = typeof S.idx === "number" ? S.idx : 0;
      // 当前 + 前后共最多 8 首
      for (var k = 0; k <= 6; k++) {
        var j = (idx + k) % n;
        if (q[j]) prefetchAmbient(q[j]);
      }
      // 上一首也预取
      if (n > 1) prefetchAmbient(q[(idx - 1 + n) % n]);
    } catch (e) {}
  }
  function refreshNpAmbient(song) {
    var token = ++_ambientToken;
    var lo = song ? songCover(song) : "";
    var cover = song ? (typeof songCoverHi === "function" ? songCoverHi(song) : lo) : "";
    var npEl0 = $("#np");
    var isImm = !!(npEl0 && npEl0.classList.contains("immersive"));
    var isLyFull = !!(npEl0 && npEl0.classList.contains("lyrics-full"));
    try {
      if (isLyFull || !isImm) {
        setNpBlurCover(cover || lo || "");
      } else {
        var bgImg = $("#npBgImg");
        if (bgImg) { bgImg.removeAttribute("src"); bgImg.style.opacity = "0"; }
      }
    } catch (eB0) {}
    function applyIfFresh(rgb, instant) {
      if (token !== _ambientToken) return;
      storeAmbientColor(song, cover, lo, rgb);
      applyNpAmbient(rgb, !!instant);
    }
    // 1) 歌曲 key / 封面 URL 缓存 → 立刻上色
    var cached = lookupAmbientColor(song, cover, lo);
    if (cached) {
      applyIfFresh(cached, true);
    } else {
      // 2) 若封面图已在 DOM 解码完成，同步取样（仍是瞬间）
      try {
        var art = $("#npArt");
        var rgbDom = sampleAmbientFromImg(art);
        if (rgbDom) {
          applyIfFresh(rgbDom, true);
          cached = rgbDom;
        }
      } catch (eD) {}
    }
    if (!cached) {
      // 3) 未命中才走网络取色
      if (cover && cover.indexOf("data:") !== 0) {
        extractCoverColor(cover).then(function (rgb) {
          applyIfFresh(rgb, false);
        });
      } else {
        applyIfFresh(null, true);
      }
    }
    // 封面 onload 后再取一次，保证和当前显示的图一致，并瞬间写入
    try {
      var art2 = $("#npArt");
      if (art2) {
        var onDone = function () {
          if (token !== _ambientToken) return;
          var rgb2 = sampleAmbientFromImg(art2);
          if (rgb2) applyIfFresh(rgb2, true);
        };
        if (art2.complete && art2.naturalWidth) {
          // 可能是上一首残留，等下一帧再采（src 可能刚换）
          setTimeout(onDone, 30);
        } else {
          art2.addEventListener("load", function once() {
            art2.removeEventListener("load", once);
            onDone();
          });
        }
      }
    } catch (eL) {}
    // 预取周围歌曲
    prefetchAmbientAround(song);
  }
  function setNpBlurCover(src) {
    var img = $("#npBgImg");
    if (!img) return;
    var u = src || "";
    if (!u || u === PLACEHOLDER || u.indexOf("data:image/svg") === 0) {
      img.removeAttribute("src");
      img.style.opacity = "0";
      return;
    }
    // 播放页模糊墙统一拉高清，与歌单详情一致
    try {
      if (typeof upgradeCoverUrl === "function") u = upgradeCoverUrl(u, 800) || u;
    } catch (eU) {}
    u = fixCover(u);
    img.referrerPolicy = "no-referrer";
    img.onload = function () {
      img.style.opacity = "1";
      // 沉浸模式确保背景层可见
      try {
        var bg = $("#npBg");
        if (bg) bg.style.opacity = "1";
      } catch (e) {}
    };
    img.onerror = function () {
      // 高清失败回退原图一次
      var lo = src;
      if (lo && lo !== u && lo.indexOf("data:") !== 0) {
        img.onerror = function () { img.style.opacity = "0"; };
        img.src = lo;
        return;
      }
      img.style.opacity = "0";
    };
    if (img.getAttribute("src") !== u) img.src = u;
    else img.style.opacity = "1";
  }
  
  /* ========== 系统媒体控件 / 灵动岛 / 通知栏（Media Session） ========== */
  var _msBound = false;
  var _msPosTimer = 0;

  function mediaSessionSupported() {
    return typeof navigator !== "undefined" && "mediaSession" in navigator;
  }

  function artworkList(coverUrl) {
    var u = String(coverUrl || "").trim();
    if (!u || u.indexOf("data:") === 0) {
      u = "https://y.gtimg.cn/mediastyle/music_v11/extra/default_300x300.jpg?max_age=31536000";
    }
    // iOS 锁屏 / 灵动岛要求可公网访问的 https 图，不要 blob/data
    u = u.replace(/^http:\/\//i, "https://");
    // QQ 封面尺寸参数尽量用大图
    try {
      if (/y\.gtimg\.cn|qq\.com|music\.126\.net|kuwo\.cn|kugou\.com|migu\.cn/i.test(u)) {
        u = u.replace(/\/\d+$/, "/800").replace(/300x300/g, "800x800").replace(/150x150/g, "800x800");
      }
    } catch (eSz) {}
    // iOS 对 type 敏感，多给几档且可省略 type
    var sizes = ["96x96", "128x128", "192x192", "256x256", "384x384", "512x512"];
    var list = sizes.map(function (s) {
      return { src: u, sizes: s, type: "image/jpeg" };
    });
    // 再推一张不带 type 的，兼容部分 WebKit
    list.push({ src: u, sizes: "512x512" });
    return list;
  }

  function updateMediaSession(song) {
    if (!song) return;
    try { bindMediaSessionActions(); } catch (eB) {}
    if (!mediaSessionSupported()) return;
    try {
      var cover = "";
      try { cover = songCover(song) || ""; } catch (eC) {}
      if (!cover && song.cover) cover = song.cover;
      // 从页面上已加载的封面图取 src（往往已是 https 可用图）
      try {
        var img = $("#npArt") || $("#miniArt");
        if (img && img.src && /^https:\/\//i.test(img.src) && img.src.indexOf("data:") !== 0) {
          cover = img.src;
        }
      } catch (eImg) {}
      var title = song.name || "未知歌曲";
      var artist = song.artist || "未知艺人";
      var album = song.album || "";
      if (typeof MediaMetadata !== "undefined") {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: title,
          artist: artist,
          album: album,
          artwork: artworkList(cover),
        });
      } else {
        navigator.mediaSession.metadata = {
          title: title,
          artist: artist,
          album: album,
          artwork: artworkList(cover),
        };
      }
      updateMediaPositionState();
    } catch (e) {
      console.warn("[MediaSession] metadata fail", e);
    }
  }

  
  // —— 锁屏歌词：不滚动，当前句 / 下一句轮流刷到 Now Playing 标题 ——
  var _msLyIdx = -1;
  var _msLyFlip = 0; // 0=当前句 1=下一句
  var _msLyTimer = 0;
  var _msLySong = null;
  var _msLyPair = ["", ""];
  var _msLyLastPush = "";

  function clearLockScreenLyricRotate() {
    if (_msLyTimer) {
      clearInterval(_msLyTimer);
      _msLyTimer = 0;
    }
    _msLyIdx = -1;
    _msLyFlip = 0;
    _msLyPair = ["", ""];
    _msLyLastPush = "";
  }

  function pushLockScreenLyricText(textLine) {
    if (!mediaSessionSupported()) return;
    var song = _msLySong || (S.queue && S.queue[S.idx]);
    if (!song) return;
    textLine = String(textLine || "").trim();
    if (!textLine) return;
    if (textLine === _msLyLastPush) return;
    _msLyLastPush = textLine;
    try {
      var cover = "";
      try {
        var img = $("#npArt") || $("#miniArt");
        if (img && img.src && /^https:\/\//i.test(img.src)) cover = img.src;
      } catch (e0) {}
      if (!cover) {
        try { cover = songCover(song) || song.cover || ""; } catch (e1) {}
      }
      var sub = (song.name || "") + (song.artist ? (" · " + song.artist) : "");
      var meta = {
        title: textLine,
        artist: sub || (song.artist || ""),
        album: song.album || "",
        artwork: artworkList(cover),
      };
      if (typeof MediaMetadata !== "undefined") {
        navigator.mediaSession.metadata = new MediaMetadata(meta);
      } else {
        navigator.mediaSession.metadata = meta;
      }
    } catch (e) {
      console.warn("[MediaSession] lyric push fail", e);
    }
  }

  function startLockScreenLyricRotate(idx) {
    if (!lyricsLines.length || idx < 0) return;
    var a = (lyricsLines[idx] && lyricsLines[idx].text) || "";
    var b = (idx + 1 < lyricsLines.length && lyricsLines[idx + 1])
      ? (lyricsLines[idx + 1].text || "")
      : "";
    a = String(a).trim();
    b = String(b).trim();
    // 过滤空行、纯音乐标记
    if (!a || /^[(\[]?(纯音乐|instrumental|作词|作曲)/i.test(a)) {
      return;
    }
    _msLyIdx = idx;
    _msLyPair = [a, b || a];
    _msLyFlip = 0;
    _msLySong = S.queue && S.queue[S.idx];
    pushLockScreenLyricText(_msLyPair[0]);
    if (_msLyTimer) clearInterval(_msLyTimer);
    // 约 2.8s 轮流：当前句 ↔ 下一句（无需滚动）
    _msLyTimer = setInterval(function () {
      if (audio.paused) return;
      _msLyFlip = _msLyFlip ? 0 : 1;
      var line = _msLyPair[_msLyFlip] || _msLyPair[0];
      pushLockScreenLyricText(line);
    }, 2800);
  }

  /** 由 syncLyrics 调用：唱到哪句就轮流显示哪句和下一句 */
  function onLyricIndexForLockScreen(idx) {
    if (!mediaSessionSupported()) return;
    if (idx === _msLyIdx) return;
    startLockScreenLyricRotate(idx);
  }

function updateMediaPositionState() {
    if (!mediaSessionSupported()) return;
    try {
      if (!audio || !isFinite(audio.duration) || audio.duration <= 0) return;
      navigator.mediaSession.setPositionState({
        duration: audio.duration,
        playbackRate: audio.playbackRate || 1,
        position: Math.min(audio.currentTime || 0, audio.duration),
      });
    } catch (e) {
      // 部分 WebView 不支持 setPositionState，忽略即可
    }
  }

  function setMediaPlaybackState(playing) {
    if (!mediaSessionSupported()) return;
    try {
      navigator.mediaSession.playbackState = playing ? "playing" : "paused";
    } catch (e) {}
    if (playing) {
      if (!_msPosTimer) {
        _msPosTimer = setInterval(function () {
          updateMediaPositionState();
        }, 1000);
      }
      updateMediaPositionState();
    } else if (_msPosTimer) {
      clearInterval(_msPosTimer);
      _msPosTimer = 0;
    }
  }

  function bindMediaSessionActions() {
    if (!mediaSessionSupported()) return;
    var ms = navigator.mediaSession;
    // 每次切歌可重绑：iOS 有时会丢掉 handler
    var isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

    function setHandler(name, fn) {
      try { ms.setActionHandler(name, fn); } catch (e) {}
    }
    function clearHandler(name) {
      try { ms.setActionHandler(name, null); } catch (e) {}
    }

    setHandler("play", function () {
      if (!audio.src && S.queue[S.idx]) {
        play(S.queue[S.idx], S.queue);
        return;
      }
      audio.play().then(function () { setPlaying(true); }).catch(function () {});
    });
    setHandler("pause", function () {
      try { audio.pause(); } catch (e) {}
      setPlaying(false);
    });
    // 音乐播放器：优先上一首/下一首（不是 ±10s）
    setHandler("previoustrack", function () { prev(); });
    setHandler("nexttrack", function () { next(); });
    setHandler("stop", function () {
      try { audio.pause(); } catch (e) {}
      try { audio.currentTime = 0; } catch (e2) {}
      setPlaying(false);
    });

    // iOS 锁屏：只要注册了 seekbackward/seekforward，系统就显示「快退/快进 10s」
    // 而把上一首/下一首挤掉。音乐场景下在 iOS 上主动清掉这两个 handler。
    if (isIOS) {
      clearHandler("seekbackward");
      clearHandler("seekforward");
    } else {
      setHandler("seekbackward", function (details) {
        var off = (details && details.seekOffset) || 10;
        try { audio.currentTime = Math.max(0, (audio.currentTime || 0) - off); } catch (e) {}
        updateMediaPositionState();
      });
      setHandler("seekforward", function (details) {
        var off = (details && details.seekOffset) || 10;
        try {
          var d = audio.duration || 0;
          audio.currentTime = Math.min(d || 1e9, (audio.currentTime || 0) + off);
        } catch (e) {}
        updateMediaPositionState();
      });
    }
    // 进度条拖动仍保留（锁屏进度条）
    setHandler("seekto", function (details) {
      if (!details || details.seekTime == null) return;
      try { audio.currentTime = details.seekTime; } catch (e) {}
      updateMediaPositionState();
    });

    _msBound = true;
  }

  // 尽早绑定，避免首播前系统无 handlers
  try { bindMediaSessionActions(); } catch (eMS) {}

function paintNow(song) {
    // 切歌立刻清掉上一首进度（迷你条 + 全屏进度条 + 时间）
    var seek = $("#npSeek");
    if (seek) { seek.value = 0; seek.style.setProperty("--seek-p", "0%"); }
    var fill = $("#miniFill"); if (fill) fill.style.width = "0%";
    var bar = $("#miniProg"); if (bar) bar.style.width = "0%";
    var cur = $("#npCur"); if (cur) cur.textContent = "0:00";
    var dur = $("#npDur"); if (dur) dur.textContent = "0:00";
    try {
      var host = $("#miniParticles");
      if (host) host.innerHTML = "";
    } catch (eP) {}
    bindImg($("#miniArt"), song, false);
    bindImg($("#npArt"), song, true); // 播放页大封面拉最高清
    // 同步海报到模糊层（全屏歌词用）
    try {
      var cover = song ? songCoverHi(song) : "";
      var art = $("#npArt");
      setNpBlurCover((art && art.src) || cover || "");
    } catch (eBg) {}

    var a, b;
    a = $("#miniName"); if (a) a.textContent = song.name || "未知";
    b = $("#miniArtist"); if (b) b.textContent = song.artist || song.singer || song.singername || "—";
    a = $("#npTitle"); if (a) a.textContent = song.name || "未知";
    b = $("#npArtist"); if (b) b.textContent = song.artist || song.singer || song.singername || "—";
    if (song) loadLyrics(song);
    // 每次切歌都重新取色
    refreshNpAmbient(song);
    // 系统媒体控件 / 灵动岛 / 通知栏元数据
    try {
      clearLockScreenLyricRotate();
      bindMediaSessionActions();
      updateMediaSession(song);
    } catch (eMs) {}
  }
  function setPlaying(on) {
    var play = '<path d="M8 5v14l11-7z"/>';
    var pause = '<path d="M6 5h4v14H6V5zm8 0h4v14h-4V5z"/>';
    var mi = $("#miniPlayIcon"), ni = $("#npPlayIcon");
    if (mi) mi.innerHTML = on ? pause : play;
    if (ni) ni.innerHTML = on ? pause : play;
    // 迷你封面：播放旋转，暂停停在当前角度
    try {
      var art = $("#miniArt");
      if (art) {
        art.classList.add("spinning");
        art.classList.toggle("spinning-paused", !on);
        if (!on && !art.classList.contains("spinning")) {
          /* keep angle */
        }
      }
    } catch (eArt) {}
    // 播放列表当前曲波形：播则跳动，暂停则停
    try {
      document.querySelectorAll(".q-wave").forEach(function (el) {
        el.classList.toggle("is-playing", !!on);
      });
    } catch (eW) {}
    // 播放页进度样式：播放态动画
    try {
      var st = S.npSeekStyle || "bar";
      var npw = $("#npWave");
      if (npw) npw.classList.toggle("is-playing", !!(on && st === "heart"));
      var npo = $("#npOrbit");
      if (npo) npo.classList.toggle("is-playing", !!(on && st === "orbit"));
      var npg = $("#npGlow");
      if (npg) npg.classList.toggle("is-playing", !!(on && st === "glow"));
      try { syncOrbitAnimState(!!(on && st === "orbit")); } catch (eOrA) {}
    } catch (eNw) {}
    try { setMediaPlaybackState(!!on); } catch (eSp) {}
  }
  function toggle() {
    if (!audio.src) {
      if (S.queue[S.idx]) play(S.queue[S.idx], S.queue);
      return;
    }
    if (audio.paused) audio.play().then(function () { setPlaying(true); }).catch(function () { toast("无法播放"); });
    else { audio.pause(); setPlaying(false); }
  }
  function next() {
    if (!S.queue.length) return;
    // 队列只有 1 首时，尝试从首页雷达/猜你喜欢/推荐补全，避免「下一首」原地重播
    if (S.queue.length < 2) {
      try {
        var cur = S.queue[S.idx] || S.queue[0];
        var expand = [];
        function takePool(arr) {
          (arr || []).forEach(function (s) {
            if (!s || indexInList(expand, s) >= 0) return;
            if (cur && sameSong(s, cur)) return;
            expand.push(s);
          });
        }
        takePool(S_radarPool);
        takePool(S.radarList);
        takePool(S_guessPool);
        takePool(S.guessList);
        takePool(S.recList);
        takePool(S.feed);
        if (expand.length) {
          S.queue = [cur].concat(expand).slice(0, 50);
          S.idx = 0;
        }
      } catch (eExp) {}
    }
    if (S.playMode === "shuffle" && S.queue.length > 1) {
      var r = S.idx;
      var guard = 0;
      while (r === S.idx && guard++ < 12) {
        r = Math.floor(Math.random() * S.queue.length);
      }
      S.idx = r;
    } else {
      S.idx = (S.idx + 1) % S.queue.length;
    }
    var song = S.queue[S.idx];
    if (!song) return;
    // 有预取地址就秒切；没有也立刻换 UI，旧解析会被 _playGen 取消
    var ready = (_nextKey === keyOf(song) && _nextUrl) ? _nextUrl : null;
    play(song, S.queue, ready);
  }
  function prev() {
    if (!S.queue.length) return;
    S.idx = (S.idx - 1 + S.queue.length) % S.queue.length;
    play(S.queue[S.idx], S.queue, null);
  }
  var MODE_ORDER = ["list", "single", "shuffle"];
  var MODE_LABEL = { list: "列表循环", single: "单曲循环", shuffle: "随机播放" };
  function modeIconSvg(mode) {
    if (mode === "single") {
      return '<path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/><text x="12" y="16" text-anchor="middle" font-size="8" font-weight="700" fill="currentColor">1</text>';
    }
    if (mode === "shuffle") {
      return '<path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/>';
    }
    // list loop
    return '<path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/>';
  }
  function syncModeBtn() {
    var mode = S.playMode || "list";
    if (MODE_ORDER.indexOf(mode) < 0) mode = "list";
    S.playMode = mode;
    var ic = $("#npModeIcon");
    if (ic) ic.innerHTML = modeIconSvg(mode);
    var btn = $("#npMode");
    if (btn) {
      btn.classList.toggle("on", mode !== "list");
      btn.setAttribute("aria-label", MODE_LABEL[mode] || "播放模式");
      btn.title = MODE_LABEL[mode] || "播放模式";
    }
  }
  function cyclePlayMode() {
    var i = MODE_ORDER.indexOf(S.playMode || "list");
    if (i < 0) i = 0;
    S.playMode = MODE_ORDER[(i + 1) % MODE_ORDER.length];
    try { localStorage.setItem("aq_mode", S.playMode); } catch (e) {}
    syncModeBtn();
    toast(MODE_LABEL[S.playMode] || S.playMode);
  }
  function onTrackEnded() {
    // 定时：播完本首后停止
    if (S.sleepAfterTrack) {
      S.sleepAfterTrack = false;
      S.sleepUntil = 0;
      try { audio.pause(); } catch (e) {}
      setPlaying(false);
      syncSleepBtn();
      toast("定时关闭：已停止播放");
      return;
    }
    if ((S.playMode || "list") === "single") {
      try {
        audio.currentTime = 0;
        audio.play().then(function () { setPlaying(true); }).catch(function () {});
      } catch (e2) {}
      return;
    }
    next();
  }

  var _miniParticleLast = 0;
  function spawnMiniParticles() {
    var host = $("#miniParticles");
    var fill = $("#miniFill");
    var mini = $("#mini");
    if (!host || !fill || !mini || audio.paused) return;
    var now = Date.now();
    if (now - _miniParticleLast < 90) return;
    _miniParticleLast = now;
    var miniW = mini.clientWidth || 280;
    var fillW = fill.clientWidth || 0;
    var edge = fillW; // 进度前沿 x
    var unplayed = Math.max(20, miniW - fillW);
    var n = 2 + Math.floor(Math.random() * 2); // 2~3
    for (var i = 0; i < n; i++) {
      var el = document.createElement("span");
      el.className = "mini-particle";
      // 从最右侧附近出发，飞向进度前沿（可略越过，像堆在进度上）
      var startX = edge + unplayed * (0.2 + Math.random() * 0.8);
      // 终点深入进度渐变内部（edge 以左），避免在未播区就消掉
      var into = Math.min(edge * 0.55, 56 + Math.random() * 40);
      var endX = Math.max(8, edge - into - Math.random() * 16);
      var y0 = 10 + Math.random() * (Math.max(24, mini.clientHeight - 20));
      var dy = (Math.random() - 0.5) * 36;
      var dur = 2.0 + Math.random() * 1.3;
      var s0 = 0.7 + Math.random() * 0.6;
      el.style.left = startX.toFixed(1) + "px";
      el.style.top = y0.toFixed(1) + "px";
      el.style.setProperty("--sx", "0px");
      el.style.setProperty("--dx", (endX - startX).toFixed(1) + "px");
      el.style.setProperty("--dy", dy.toFixed(1) + "px");
      el.style.setProperty("--y0", "0px");
      el.style.setProperty("--dur", dur.toFixed(2) + "s");
      el.style.setProperty("--s0", s0.toFixed(2));
      host.appendChild(el);
      (function (node, life) {
        setTimeout(function () {
          if (node && node.parentNode) node.parentNode.removeChild(node);
        }, life);
      })(el, Math.ceil(dur * 1000) + 80);
    }
    while (host.childNodes.length > 28) {
      host.removeChild(host.firstChild);
    }
  }
    on(audio, "timeupdate", function () {
    if (!audio.duration) return;
    var p = audio.currentTime / audio.duration;
    var pct = (p * 100) + "%";
    var bar = $("#miniProg"); if (bar) bar.style.width = pct;
    var fill = $("#miniFill"); if (fill) fill.style.width = pct;
    /* 拖动进度时不要被 timeupdate 顶回去，否则会感觉不灵敏 */
    var dragging = false;
    try { dragging = typeof window._aqSeeking === "function" && window._aqSeeking(); } catch (eD) {}
    if (!dragging) {
      var seek = $("#npSeek"); if (seek) { seek.value = Math.floor(p * 1000); seek.style.setProperty("--seek-p", pct); }
      try { syncNpWaveBars(p); } catch (eW) {}
    }
    var c = $("#npCur"); if (c) c.textContent = fmt(audio.currentTime);
    var d = $("#npDur"); if (d) d.textContent = fmt(audio.duration);
    if (!dragging) syncLyrics(audio.currentTime);
    if (!audio.paused && p > 0.001 && p < 0.999) spawnMiniParticles();
  });
  on(audio, "pause", function () {
    var host = $("#miniParticles");
    if (host) host.innerHTML = "";
  });
  on(audio, "ended", onTrackEnded);
  on(audio, "play", function () { setPlaying(true); });
  on(audio, "pause", function () { setPlaying(false); });
  on(audio, "loadedmetadata", function () {
    try {
      var song = S.queue && S.queue[S.idx];
      if (song) updateMediaSession(song);
      updateMediaPositionState();
    } catch (eLm) {}
  });
  // 后台/锁屏时保持与系统控件同步
  document.addEventListener("visibilitychange", function () {
    try {
      setMediaPlaybackState(!audio.paused && !!audio.src);
      if (!audio.paused) updateMediaPositionState();
    } catch (eVis) {}
  });


  /* ========== 歌词 ========== */
  var lyricsLines = []; // {t: seconds, text}
  var lyricsSongKey = "";

  function parseLrc(lrc) {
    var lines = [];
    if (!lrc) return lines;
    String(lrc).split(/\r?\n/).forEach(function (line) {
      var m = line.match(/\[(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?\](.*)/);
      if (!m) return;
      var t = parseInt(m[1], 10) * 60 + parseInt(m[2], 10) + (parseInt(m[3] || "0", 10) / (m[3] && m[3].length === 3 ? 1000 : 100));
      var text = (m[4] || "").trim();
      if (text) lines.push({ t: t, text: text });
    });
    lines.sort(function (a, b) { return a.t - b.t; });
    return lines;
  }

  function decodeLyric(raw) {
    if (!raw) return "";
    var s = String(raw);
    // HTML entities
    if (s.indexOf("&#") >= 0) {
      var ta = document.createElement("textarea");
      ta.innerHTML = s;
      s = ta.value;
    }
    // base64 plain LRC
    if (s.indexOf("[") < 0) {
      try {
        s = decodeURIComponent(escape(atob(s)));
      } catch (e1) {
        try {
          s = atob(s);
        } catch (e2) {}
      }
    }
    return s;
  }



  /* ========== 歌词（完整抄自 qqmusci ADAPTER + API.lyric） ========== */
  var _jsonpSeq = 0;
  function atob_safe(b64) {
    try { return decodeURIComponent(escape(atob(b64))); } catch (e) {
      try { return atob(b64); } catch (e2) { return ""; }
    }
  }
  function jsonp_safeParse(txt) {
    if (txt == null) return null;
    if (typeof txt === "object") return txt;
    try { return JSON.parse(txt); } catch (e) {}
    var m = /\(([\s\S]*)\)\s*;?\s*$/.exec(String(txt));
    if (m) { try { return JSON.parse(m[1]); } catch (e2) {} }
    return null;
  }
  /** 与原版 jsonpRequest 一致 */
  function jsonpRequest(url, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var cb = "__aq_jp_" + (++_jsonpSeq) + "_" + Date.now();
      var script = null;
      var timer = setTimeout(function () {
        cleanup();
        reject(new Error("jsonp timeout"));
      }, timeoutMs || 12000);
      function cleanup() {
        clearTimeout(timer);
        try { delete window[cb]; } catch (e) { window[cb] = undefined; }
        if (script && script.parentNode) script.parentNode.removeChild(script);
      }
      window[cb] = function (data) {
        cleanup();
        try {
          resolve(typeof data === "string" ? data : JSON.stringify(data));
        } catch (e) {
          resolve(String(data));
        }
      };
      var sep = url.indexOf("?") >= 0 ? "&" : "?";
      var finalUrl = url;
      if (/([?&])(callback|jsonpCallback)=/.test(finalUrl)) {
        finalUrl = finalUrl.replace(/([?&])(callback|jsonpCallback)=[^&]*/g, "$1$2=" + cb);
      } else {
        finalUrl = finalUrl + sep + "callback=" + cb + "&jsonpCallback=" + cb;
      }
      finalUrl = finalUrl.replace(/([?&])format=json\b/g, "$1format=jsonp");
      script = document.createElement("script");
      script.async = true;
      script.src = finalUrl;
      script.onerror = function () {
        cleanup();
        reject(new Error("jsonp script error"));
      };
      (document.head || document.documentElement).appendChild(script);
    });
  }

  /** 与原版 API.lyric 一致 */

  async function API_lyricNetease(id) {
    if (!id) return { lyric: "", trans: "" };
    try {
      var url = "https://music.163.com/api/song/lyric?id=" + encodeURIComponent(id) + "&lv=-1&kv=-1&tv=-1";
      var d = null;
      try {
        d = await reqFetch(url, { timeout: 6, headers: { Referer: "https://music.163.com/" } });
      } catch (e1) {
        var txt = await adapterRequest(url, { headers: { Referer: "https://music.163.com/" }, timeout: 6 });
        d = typeof txt === "string" ? JSON.parse(txt) : txt;
      }
      var lyric = (d && d.lrc && d.lrc.lyric) || "";
      var trans = (d && d.tlyric && d.tlyric.lyric) || "";
      if (!lyric || String(lyric).replace(/\s+/g, "").length < 4) return { lyric: "", trans: "" };
      return { lyric: lyric, trans: trans || "" };
    } catch (e) {
      return { lyric: "", trans: "" };
    }
  }

  async function API_lyricKuwo(id) {
    if (!id) return { lyric: "", trans: "" };
    id = String(id).replace(/^MUSIC_/, "");
    try {
      var urls = [
        "https://www.kuwo.cn/openapi/v1/www/lyric/getlyric?musicId=" + encodeURIComponent(id),
        "https://m.kuwo.cn/newh5/singles/songinfoandlrc?musicId=" + encodeURIComponent(id),
        "http://www.kuwo.cn/newh5/singles/songinfoandlrc?musicId=" + encodeURIComponent(id),
      ];
      var hdr = { Referer: "https://www.kuwo.cn/", Accept: "application/json" };
      for (var i = 0; i < urls.length; i++) {
        var d = null;
        try {
          d = await reqFetch(urls[i], { timeout: 6, headers: hdr });
        } catch (e1) {
          try {
            var txt = await adapterRequest(urls[i], { headers: hdr, timeout: 6 });
            d = typeof txt === "string" ? JSON.parse(txt) : txt;
          } catch (e2) { d = null; }
        }
        if (!d) continue;
        var data = d.data || d;
        var lyric = "";
        if (typeof data.lrclist === "object" && Array.isArray(data.lrclist)) {
          lyric = data.lrclist.map(function (line) {
            var t = parseFloat(line.time || line.t || 0);
            var m = Math.floor(t / 60);
            var s = (t % 60).toFixed(2);
            var mm = (m < 10 ? "0" : "") + m;
            var ss = (parseFloat(s) < 10 ? "0" : "") + s;
            return "[" + mm + ":" + ss + "]" + (line.lineLyric || line.text || "");
          }).join("\n");
        } else {
          lyric = data.lyric || data.lrc || (data.songinfo && data.songinfo.lyric) || "";
        }
        if (lyric && String(lyric).replace(/\s+/g, "").length >= 4) {
          return { lyric: lyric, trans: "" };
        }
      }
      return { lyric: "", trans: "" };
    } catch (e) {
      return { lyric: "", trans: "" };
    }
  }

  async function API_lyricKugou(song) {
    try {
      var hash = (song && (song.hash || song.kugouHash || song.songmid)) || "";
      var name = (song && song.name) || "";
      var artist = (song && song.artist) || "";
      if (!hash && !name) return { lyric: "", trans: "" };
      var keyword = (artist ? artist + " - " : "") + name;
      var searchUrl =
        "http://lyrics.kugou.com/search?ver=1&man=yes&client=pc&keyword=" +
        encodeURIComponent(keyword || hash) +
        "&duration=" + encodeURIComponent((song && song.interval) || 0) +
        "&hash=" + encodeURIComponent(hash);
      var d = null;
      try {
        d = await reqFetch(searchUrl, { timeout: 6, headers: { Referer: "https://www.kugou.com/" } });
      } catch (e1) {
        try {
          var txt = await adapterRequest(searchUrl, { headers: { Referer: "https://www.kugou.com/" }, timeout: 6 });
          d = typeof txt === "string" ? JSON.parse(txt) : txt;
        } catch (e2) { d = null; }
      }
      var candidates = (d && d.candidates) || [];
      if (!candidates.length) return { lyric: "", trans: "" };
      // 按歌名/歌手挑最像的候选，避免歌词错配
      var c0 = candidates[0];
      try {
        var wantN = String((song && song.name) || "").toLowerCase();
        var wantA = String((song && song.artist) || "").toLowerCase().split(/[\/、,&]/)[0];
        var bestC = null, bestS = -1;
        candidates.forEach(function (c) {
          if (!c) return;
          var cn = String(c.song || c.songname || c.keyword || "").toLowerCase();
          var ca = String(c.singer || c.artist || "").toLowerCase();
          var sc = 0;
          if (wantN && cn && (cn === wantN || cn.indexOf(wantN) >= 0 || wantN.indexOf(cn) >= 0)) sc += 6;
          if (wantA && ca && (ca.indexOf(wantA) >= 0 || wantA.indexOf(ca) >= 0)) sc += 4;
          if (sc > bestS) { bestS = sc; bestC = c; }
        });
        if (bestC && bestS >= 6) c0 = bestC;
      } catch (eC) {}
      var dl =
        "http://lyrics.kugou.com/download?ver=1&client=pc&id=" +
        encodeURIComponent(c0.id || "") +
        "&accesskey=" + encodeURIComponent(c0.accesskey || "") +
        "&fmt=lrc&charset=utf8";
      var d2 = null;
      try {
        d2 = await reqFetch(dl, { timeout: 6, headers: { Referer: "https://www.kugou.com/" } });
      } catch (e3) {
        try {
          var t2 = await adapterRequest(dl, { headers: { Referer: "https://www.kugou.com/" }, timeout: 6 });
          d2 = typeof t2 === "string" ? JSON.parse(t2) : t2;
        } catch (e4) { d2 = null; }
      }
      var contentLrc = (d2 && d2.content) || "";
      if (!contentLrc) return { lyric: "", trans: "" };
      // kugou often base64
      var lyric = contentLrc;
      try {
        if (lyric.indexOf("[") === -1) lyric = atob_safe(lyric) || contentLrc;
      } catch (e5) {}
      if (!lyric || String(lyric).replace(/\s+/g, "").length < 4) return { lyric: "", trans: "" };
      return { lyric: lyric, trans: "" };
    } catch (e) {
      return { lyric: "", trans: "" };
    }
  }

  function API_lyric(songmid) {
    if (!songmid) return Promise.resolve({ lyric: "", trans: "" });
    songmid = String(songmid);
    var qs =
      "songmid=" + encodeURIComponent(songmid) +
      "&pcachetime=" + Date.now() +
      "&g_tk=5381&loginUin=0&hostUin=0&format=json&inCharset=utf8&outCharset=utf-8" +
      "&notice=0&platform=yqq.json&needNewCode=0&nobase64=1";
    var classicUrls = [
      "https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?" + qs,
      "https://i.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?" + qs,
    ];
    function parseClassicTxt(txt) {
      var d = jsonp_safeParse(txt);
      if (!d) return null;
      var lyric = d.lyric || "";
      var trans = d.trans || "";
      if (lyric && lyric.indexOf("[") === -1) lyric = atob_safe(lyric);
      if (trans && trans.indexOf("[") === -1) trans = atob_safe(trans);
      if (!lyric || String(lyric).replace(/\s+/g, "").length < 4) return null;
      return { lyric: lyric, trans: trans || "" };
    }
    function fromClassicOne(url) {
      return jsonpRequest(url, 10000)
        .then(function (txt) { return parseClassicTxt(txt); })
        .catch(function () { return null; });
    }
    function fromPlayLyric() {
      var body = JSON.stringify({
        comm: { ct: 11, cv: 10030020, uin: "0", format: "json" },
        req_0: {
          module: "music.musichallSong.PlayLyricInfo",
          method: "GetPlayLyricInfo",
          param: { songMID: songmid, songID: 0 },
        },
      });
      // 原版：POST 转 GET data= + jsonp
      var url =
        "https://u.y.qq.com/cgi-bin/musicu.fcg?_=" + Date.now() +
        "&data=" + encodeURIComponent(body) +
        "&format=jsonp&inCharset=utf8&outCharset=utf-8&platform=yqq.json&needNewCode=0";
      return jsonpRequest(url, 10000)
        .then(function (txt) {
          var d = jsonp_safeParse(txt);
          var data = d && d.req_0 && d.req_0.data;
          if (!data) return null;
          var lyric = data.lyric || "";
          var trans = data.trans || data.transLyric || "";
          if (lyric && lyric.indexOf("[") === -1) lyric = atob_safe(lyric);
          if (trans && trans.indexOf("[") === -1) trans = atob_safe(trans);
          if (!lyric || String(lyric).replace(/\s+/g, "").length < 4) return null;
          return { lyric: lyric, trans: trans || "" };
        })
        .catch(function () { return null; });
    }
    function raceFirstLyric(promises) {
      return new Promise(function (resolve) {
        var left = promises.length;
        var done = false;
        if (!left) { resolve({ lyric: "", trans: "" }); return; }
        promises.forEach(function (p) {
          Promise.resolve(p).then(function (res) {
            if (done) return;
            if (res && res.lyric && String(res.lyric).replace(/\s+/g, "").length > 4) {
              done = true;
              resolve(res);
              return;
            }
            left--;
            if (left <= 0) resolve({ lyric: "", trans: "" });
          }).catch(function () {
            left--;
            if (!done && left <= 0) resolve({ lyric: "", trans: "" });
          });
        });
      });
    }
    return raceFirstLyric([
      fromPlayLyric(),
      fromClassicOne(classicUrls[0]),
      fromClassicOne(classicUrls[1]),
    ]);
  }

  async function API_lyricMigu(song) {
    try {
      var cid = (song && (song.copyrightId || song.songmid || song.id)) || "";
      if (!cid) return { lyric: "", trans: "" };
      var urls = [
        "https://music.migu.cn/v3/api/music/audioPlayer/getLyric?copyrightId=" + encodeURIComponent(cid),
        "https://app.c.nf.migu.cn/MIGUM2.0/strategy/lyric/v2.0?copyrightId=" + encodeURIComponent(cid),
      ];
      var hdr = { Referer: "https://music.migu.cn/", Accept: "application/json" };
      for (var i = 0; i < urls.length; i++) {
        var d = null;
        try { d = await reqFetch(urls[i], { timeout: 6, headers: hdr }); }
        catch (e1) {
          try {
            var txt = await adapterRequest(urls[i], { headers: hdr, timeout: 6 });
            d = typeof txt === "string" ? JSON.parse(txt) : txt;
          } catch (e2) { d = null; }
        }
        if (!d) continue;
        var lyric = d.lyric || d.lrc || (d.data && (d.data.lyric || d.data.lrc)) || "";
        if (lyric && String(lyric).replace(/\s+/g, "").length > 4) return { lyric: lyric, trans: "" };
      }
      return { lyric: "", trans: "" };
    } catch (e) { return { lyric: "", trans: "" }; }
  }

  function pickBestLyricMatch(list, song) {
    function norm(s) {
      return String(s || "")
        .toLowerCase()
        .replace(/[\(（\[][^\)）\]]*[\)）\]]/g, "")
        .replace(/feat\.?|ft\.?|version|ver\.|live|remix|伴奏|纯音乐/gi, "")
        .replace(/[^\u4e00-\u9fff\w]+/g, "")
        .trim();
    }
    var name = norm(song && song.name);
    var singer0 = norm(((song && song.artist) || "").split(/[\/、,&｜|]/)[0] || "");
    if (!name) return null;
    var best = null;
    var bestScore = -1;
    (list || []).forEach(function (it) {
      if (!it || !(it.songmid || it.id)) return;
      var n = norm(it.name);
      if (!n) return;
      var score = 0;
      // 歌名必须有实质重合，否则直接跳过（防牛头不对马嘴）
      if (n === name) score += 12;
      else if (n.indexOf(name) === 0 || name.indexOf(n) === 0) score += 7;
      else if (n.indexOf(name) >= 0 || name.indexOf(n) >= 0) {
        // 仅当较短一方长度占比较高才认
        var shorter = Math.min(n.length, name.length);
        var longer = Math.max(n.length, name.length);
        if (shorter >= 2 && shorter / longer >= 0.55) score += 4;
        else return;
      } else return;
      var a = norm(it.artist);
      if (singer0) {
        if (a === singer0) score += 10;
        else if (a && (a.indexOf(singer0) >= 0 || singer0.indexOf(a) >= 0)) score += 5;
        else score -= 3; // 有歌手信息却对不上，降权
      }
      // 时长接近加分（秒）
      try {
        var d0 = Number(song.interval || song.duration || 0);
        var d1 = Number(it.interval || it.duration || 0);
        if (d0 > 30 && d1 > 30 && Math.abs(d0 - d1) <= 8) score += 3;
      } catch (eD) {}
      if (score > bestScore) {
        bestScore = score;
        best = it;
        best._sc = score;
      }
    });
    // 严格阈值：至少接近歌名；有歌手时更倾向双匹配
    if (!best) return null;
    if (bestScore < 10) return null;
    if (singer0 && bestScore < 12) return null;
    return best;
  }

  var _lyricGen = 0;
  async function loadLyrics(song) {
    var box = $("#npLyrics");
    if (!box) return;
    var gen = ++_lyricGen;
    lyricsLines = [];
    lyricsSongKey = keyOf(song);
    clearMiniLyric();
    box.innerHTML = '<div class="ly-empty">…</div>';

    // B站：关闭自动歌词匹配（视频无可靠歌词接口），其它站逻辑不变
    if (typeof isBiliSong === "function" && isBiliSong(song)) {
      box.innerHTML = '<div class="ly-empty">B站视频无歌词</div>';
      clearMiniLyric();
      return;
    }

    var mid = song && (song.songmid || song.id);
    if (!mid && !(song && song.name)) {
      box.innerHTML = '<div class="ly-empty">暂无歌词</div>';
      try { scheduleAutoRematchLyric(song, 2500); } catch (eAR) {}
      return;
    }

    var res = null;
    var src = (song && song.source) || S.platform || "qq";
    src = String(src || "qq").toLowerCase();
    if (src === "wy" || src === "netease") src = "netease";
    if (src === "kw") src = "kuwo";
    if (src === "kg") src = "kugou";
    if (src === "mg") src = "migu";
    if (src === "tx") src = "qq";
    if (src === "bili" || src === "bilibili") {
      box.innerHTML = '<div class="ly-empty">B站视频无歌词</div>';
      clearMiniLyric();
      return;
    }

    async function fromSrc(platform, id, s) {
      try {
        if (platform === "netease") return await API_lyricNetease(id);
        if (platform === "kuwo") return await API_lyricKuwo(id);
        if (platform === "kugou") return await API_lyricKugou(s || song);
        if (platform === "migu") return await API_lyricMigu(s || song);
        return await API_lyric(id);
      } catch (e) { return null; }
    }

    if (mid) {
      res = await fromSrc(src, mid, song);
      if (gen !== _lyricGen) return;
    }

    if ((!res || !res.lyric) && song && song.name) {
      try {
        var relist = [];
        if (src === "netease") relist = await searchNetease(song.name, 1).catch(function () { return []; });
        else if (src === "kuwo") relist = await searchKuwo(song.name, 1).catch(function () { return []; });
        else if (src === "kugou") relist = await searchKugou(song.name, 1).catch(function () { return []; });
        else if (src === "migu") relist = await searchMigu(song.name, 1).catch(function () { return []; });
        else relist = await searchQQ(song.name).catch(function () { return []; });
        if (gen !== _lyricGen) return;
        var bestSame = pickBestLyricMatch(relist, song);
        var bm = bestSame && (bestSame.songmid || bestSame.id);
        if (bm && String(bm) !== String(mid || "")) {
          res = await fromSrc(src, bm, bestSame);
          if (gen !== _lyricGen) return;
        }
      } catch (eRel) {}
    }

    // 跨站兜底：并行搜 QQ/网易/酷我/酷狗/咪咕，取匹配分最高的再拉词
    if ((!res || !res.lyric) && song && song.name) {
      try {
        var fbPlats = ["qq", "netease", "kuwo", "kugou", "migu"].filter(function (p) {
          return p !== src;
        });
        var fbJobs = fbPlats.map(function (plat) {
          return (async function () {
            var list = [];
            try {
              if (plat === "netease") list = await searchNetease(song.name, 1);
              else if (plat === "kuwo") list = await searchKuwo(song.name, 1);
              else if (plat === "kugou") list = await searchKugou(song.name, 1);
              else if (plat === "migu") list = await searchMigu(song.name, 1);
              else list = await searchQQ(song.name);
            } catch (eS) { list = []; }
            var best = pickBestLyricMatch(list || [], song);
            if (!best && list && list.length) best = list[0];
            return { plat: plat, best: best, score: best && typeof best._sc === "number" ? best._sc : 0 };
          })();
        });
        var fbPacks = await Promise.all(fbJobs);
        if (gen !== _lyricGen) return;
        fbPacks.sort(function (a, b) { return (b.score || 0) - (a.score || 0); });
        for (var fi = 0; fi < fbPacks.length; fi++) {
          var fp = fbPacks[fi];
          if (!fp || !fp.best) continue;
          var fid = fp.best.songmid || fp.best.id || fp.best.hash;
          if (!fid && fp.plat !== "kugou") continue;
          try {
            if (fp.plat === "netease") res = await API_lyricNetease(fid);
            else if (fp.plat === "kuwo") res = await API_lyricKuwo(fid);
            else if (fp.plat === "kugou") res = await API_lyricKugou(fp.best);
            else if (fp.plat === "migu") res = await API_lyricMigu(fp.best);
            else res = await API_lyric(fid);
          } catch (eL) { res = null; }
          if (gen !== _lyricGen) return;
          if (res && res.lyric && String(res.lyric).replace(/\s+/g, "").length >= 4) break;
          res = null;
        }
      } catch (eFb) {}
    }

    if (gen !== _lyricGen) return;

    var lrc = (res && res.lyric) || "";
    lyricsLines = parseLrc(lrc);
    // 过滤几乎无字的假歌词
    if (lyricsLines.length) {
      var meaningful = lyricsLines.filter(function (ln) {
        var t = String((ln && ln.text) || "").replace(/\s+/g, "");
        return t.length >= 1 && !/^(\d+:\d+|作词|作曲|编曲|制作人|出品|公司|版权)/.test(t);
      });
      if (meaningful.length < 2 && lyricsLines.length < 4) {
        lyricsLines = [];
      }
    }
    if (!lyricsLines.length) {
      box.innerHTML = '<div class="ly-empty">暂无歌词</div>';
      try { scheduleAutoRematchLyric(song, 2500); } catch (eAR) {}
      clearMiniLyric();
      return;
    }
    box.innerHTML = "";
    var pad = Math.max(80, Math.floor((box.clientHeight || 160) * 0.42));
    var spTop = document.createElement("div");
    spTop.className = "ly-spacer";
    spTop.style.height = pad + "px";
    box.appendChild(spTop);
    lyricsLines.forEach(function (line, i) {
      var el = document.createElement("div");
      el.className = "ly";
      el.dataset.i = String(i);
      el.textContent = line.text;
      box.appendChild(el);
    });
    var spBot = document.createElement("div");
    spBot.className = "ly-spacer";
    spBot.style.height = pad + "px";
    box.appendChild(spBot);
    box.dataset.lock = "0";
    syncLyrics(audio.currentTime || 0, true);
  }


  /** 跨站重新匹配歌词（不换播放音源/进度，只补歌词）
   * 多平台并行搜同名同歌手候选；每次点击轮换下一版（版本不对可连点换一轮）
   */
  var _lyricRematchBusy = false;
  var _lyricRematchCache = null; // { key, list: [{plat,item,score,key}], idx }
  function lyricCandKey(plat, item) {
    var id = (item && (item.songmid || item.mid || item.id || item.rid || item.hash)) || "";
    return String(plat) + ":" + String(id);
  }
  
  var _autoRematchTried = {};
  var _autoRematchTimer = null;
  function scheduleAutoRematchLyric(song, delayMs) {
    try {
      if (_autoRematchTimer) { clearTimeout(_autoRematchTimer); _autoRematchTimer = null; }
      if (!song || !song.name) return;
      // B站不自动跨站匹配歌词
      if (typeof isBiliSong === "function" && isBiliSong(song)) return;
      var src0 = String((song.source || "")).toLowerCase();
      if (src0 === "bilibili" || src0 === "bili") return;
      var k = (typeof keyOf === "function") ? keyOf(song) : (String(song.songmid || song.id || "") + "|" + String(song.name || ""));
      if (_autoRematchTried[k]) return;
      delayMs = delayMs || 2800;
      _autoRematchTimer = setTimeout(function () {
        _autoRematchTimer = null;
        try {
          if (!(S.queue && S.queue[S.idx])) return;
          var cur = S.queue[S.idx];
          var ck = (typeof keyOf === "function") ? keyOf(cur) : (String(cur.songmid || cur.id || "") + "|" + String(cur.name || ""));
          if (ck !== k) return;
          /* 已有有效歌词则跳过 */
          if (lyricsLines && lyricsLines.length > 2) return;
          var box = document.getElementById("npLyrics");
          if (box) {
            var t = (box.textContent || "");
            if (t && t.indexOf("匹配中") >= 0) return;
            /* 有多行歌词内容时不触发 */
            if (box.querySelectorAll && box.querySelectorAll(".ly").length > 2) return;
          }
          _autoRematchTried[k] = true;
          rematchLyrics().catch(function () {});
        } catch (eA) {}
      }, delayMs);
    } catch (e) {}
  }
  async function rematchLyrics() {

    if (_lyricRematchBusy) return;
    var song = S.queue && S.queue[S.idx];
    if (!song || !song.name) {
      toast("没有在播歌曲");
      return;
    }
    if (typeof isBiliSong === "function" && isBiliSong(song)) {
      toast("B站视频不支持自动匹配歌词");
      return;
    }
    _lyricRematchBusy = true;
    try { closeNpMorePop(); } catch (e0) {}
    try { if (typeof dismissNpToolPops === "function") dismissNpToolPops(); } catch (e1) {}
    var box = $("#npLyrics");
    if (box) box.innerHTML = '<div class="ly-empty">匹配中…</div>';

    var gen = ++_lyricGen;
    lyricsLines = [];
    lyricsSongKey = keyOf(song);
    try { clearMiniLyric(); } catch (eC) {}

    var songKey = keyOf(song);
    var kw = (String(song.name || "") + " " + String(song.artist || "")).trim();
    var kw2 = String(song.name || "").trim();
    var plats = ["qq", "netease", "kuwo", "kugou", "migu"];
    var cur = String((song.source || S.platform || "qq")).toLowerCase();
    if (cur === "wy" || cur === "netease") cur = "netease";
    else if (cur === "kw") cur = "kuwo";
    else if (cur === "kg") cur = "kugou";
    else if (cur === "mg") cur = "migu";
    else if (cur === "tx") cur = "qq";
    plats = [cur].concat(plats.filter(function (p) { return p !== cur; }));

    async function searchPlat(plat, q) {
      try {
        if (plat === "netease") return (await searchNetease(q, 1)) || [];
        if (plat === "kuwo") return (await searchKuwo(q, 1)) || [];
        if (plat === "kugou") return (await searchKugou(q, 1)) || [];
        if (plat === "migu") return (await searchMigu(q, 1)) || [];
        return (await searchQQ(q)) || [];
      } catch (e) { return []; }
    }
    async function lyricFrom(plat, item) {
      if (!item) return null;
      var id = item.songmid || item.mid || item.id || item.rid || item.hash;
      if (!id && plat !== "kugou") return null;
      try {
        if (plat === "netease") return await API_lyricNetease(id);
        if (plat === "kuwo") return await API_lyricKuwo(id);
        if (plat === "kugou") return await API_lyricKugou(item);
        if (plat === "migu") return await API_lyricMigu(item);
        return await API_lyric(id);
      } catch (e) { return null; }
    }
    function lrcQuality(lrc) {
      var lines = parseLrc(lrc || "");
      if (!lines.length) return 0;
      var meaningful = lines.filter(function (ln) {
        var t = String((ln && ln.text) || "").replace(/\s+/g, "");
        return t.length >= 1 && !/^(\d+:\d+|作词|作曲|编曲|制作人|出品|公司|版权)/.test(t);
      });
      if (meaningful.length < 2 && lines.length < 4) return 0;
      return meaningful.length;
    }
    function applyLrc(lrc, fromPlat, meta) {
      if (gen !== _lyricGen) return false;
      if (lrcQuality(lrc) <= 0) return false;
      lyricsLines = parseLrc(lrc || "");
      if (!lyricsLines.length) return false;
      if (!box) return true;
      box.innerHTML = "";
      var pad = Math.max(80, Math.floor((box.clientHeight || 160) * 0.42));
      var spTop = document.createElement("div");
      spTop.className = "ly-spacer";
      spTop.style.height = pad + "px";
      box.appendChild(spTop);
      lyricsLines.forEach(function (line, i) {
        var el = document.createElement("div");
        el.className = "ly";
        el.dataset.i = String(i);
        el.textContent = line.text;
        box.appendChild(el);
      });
      var spBot = document.createElement("div");
      spBot.className = "ly-spacer";
      spBot.style.height = pad + "px";
      box.appendChild(spBot);
      box.dataset.lock = "0";
      try { syncLyrics(audio.currentTime || 0, true); } catch (eS) {}
      var names = { qq: "QQ", netease: "网易", kuwo: "酷我", kugou: "酷狗", migu: "咪咕" };
      var tip = "已匹配歌词 · " + (names[fromPlat] || fromPlat);
      if (meta && meta.total > 1) {
        tip += "（" + meta.cur + "/" + meta.total + "，再点换版）";
      }
      toast(tip);
      return true;
    }
    function sameNameArtist(it, song0) {
      if (!it) return false;
      function norm(s) {
        return String(s || "")
          .toLowerCase()
          .replace(/[\(（\[][^\)）\]]*[\)）\]]/g, "")
          .replace(/feat\.?|ft\.?|version|ver\.|live|remix|伴奏|纯音乐/gi, "")
          .replace(/[^\u4e00-\u9fff\w]+/g, "")
          .trim();
      }
      var n0 = norm(song0.name);
      var n1 = norm(it.name);
      if (!n0 || !n1) return false;
      if (n0 !== n1 && n0.indexOf(n1) < 0 && n1.indexOf(n0) < 0) return false;
      var a0 = norm(((song0.artist || "").split(/[\/、,&｜|]/)[0] || ""));
      var a1 = norm(((it.artist || "").split(/[\/、,&｜|]/)[0] || ""));
      if (!a0) return true;
      if (!a1) return true;
      return a0 === a1 || a0.indexOf(a1) >= 0 || a1.indexOf(a0) >= 0;
    }
    function scoreItem(it, song0, plat) {
      if (!it) return -1;
      var sc = typeof it._sc === "number" ? it._sc : 0;
      if (!sc) {
        try {
          var b = pickBestLyricMatch([it], song0);
          sc = (b && typeof b._sc === "number") ? b._sc : 0;
        } catch (e) { sc = 0; }
      }
      if (plat === cur) sc += 1;
      return sc;
    }

    try {
      var needBuild = !_lyricRematchCache || _lyricRematchCache.key !== songKey ||
        !(_lyricRematchCache.list && _lyricRematchCache.list.length);
      if (needBuild) {
        toast("正在搜各站同名版本…");
        var searchJobs = plats.map(function (plat) {
          return (async function () {
            var list = await searchPlat(plat, kw);
            if ((!list || !list.length) && kw2 && kw2 !== kw) {
              list = await searchPlat(plat, kw2);
            }
            return { plat: plat, list: list || [] };
          })();
        });
        var packs = await Promise.all(searchJobs);
        if (gen !== _lyricGen) return;

        var candidates = [];
        var seen = {};
        packs.forEach(function (pk) {
          if (!pk || !pk.list) return;
          pk.list.forEach(function (it) {
            if (!sameNameArtist(it, song)) return;
            var ck = lyricCandKey(pk.plat, it);
            if (!ck || seen[ck]) return;
            var id = it.songmid || it.mid || it.id || it.rid || it.hash;
            if (!id && pk.plat !== "kugou") return;
            seen[ck] = 1;
            candidates.push({ plat: pk.plat, item: it, score: scoreItem(it, song, pk.plat), key: ck });
          });
        });
        if (candidates.length < 2) {
          packs.forEach(function (pk) {
            if (!pk || !pk.list) return;
            pk.list.slice(0, 8).forEach(function (it) {
              var ck = lyricCandKey(pk.plat, it);
              if (!ck || seen[ck]) return;
              var id = it.songmid || it.mid || it.id || it.rid || it.hash;
              if (!id && pk.plat !== "kugou") return;
              var n0 = String(song.name || "").toLowerCase().replace(/\s+/g, "");
              var n1 = String(it.name || "").toLowerCase().replace(/\s+/g, "");
              if (!n0 || !n1) return;
              if (n0 !== n1 && n0.indexOf(n1) < 0 && n1.indexOf(n0) < 0) return;
              seen[ck] = 1;
              candidates.push({ plat: pk.plat, item: it, score: scoreItem(it, song, pk.plat), key: ck });
            });
          });
        }
        candidates.sort(function (a, b) { return (b.score || 0) - (a.score || 0); });
        var mid0 = String(song.songmid || song.mid || song.id || "");
        if (mid0) {
          var selfKey = lyricCandKey(cur, song);
          var hasSelf = candidates.some(function (c) { return c.key === selfKey; });
          if (!hasSelf) {
            candidates.unshift({ plat: cur, item: song, score: 99, key: selfKey });
          } else {
            candidates.sort(function (a, b) {
              if (a.key === selfKey) return -1;
              if (b.key === selfKey) return 1;
              return (b.score || 0) - (a.score || 0);
            });
          }
        }
        _lyricRematchCache = { key: songKey, list: candidates, idx: -1 };
      }

      var pool = (_lyricRematchCache && _lyricRematchCache.list) || [];
      if (!pool.length) {
        if (box) box.innerHTML = '<div class="ly-empty">暂无歌词</div>';
        try { clearMiniLyric(); } catch (e2) {}
        toast("各平台均未匹配到同名版本");
        return;
      }

      var startIdx = ((_lyricRematchCache.idx || 0) + 1) % pool.length;
      var tried = 0;
      var okMatch = false;
      while (tried < pool.length) {
        if (gen !== _lyricGen) return;
        var ci = (startIdx + tried) % pool.length;
        var c = pool[ci];
        tried++;
        _lyricRematchCache.idx = ci;
        var res = await lyricFrom(c.plat, c.item);
        if (gen !== _lyricGen) return;
        if (res && res.lyric && applyLrc(res.lyric, c.plat, { cur: ci + 1, total: pool.length })) {
          okMatch = true;
          break;
        }
      }

      if (!okMatch) {
        if (gen !== _lyricGen) return;
        if (box) box.innerHTML = '<div class="ly-empty">暂无歌词</div>';
        try { clearMiniLyric(); } catch (e3) {}
        toast("各版本均未取到有效歌词");
      }
    } catch (err) {
      console.warn("rematchLyrics", err);
      if (gen === _lyricGen && box) box.innerHTML = '<div class="ly-empty">暂无歌词</div>';
      toast("匹配歌词失败");
    } finally {
      _lyricRematchBusy = false;
    }
  }


  var _lyricLastIdx = -1;
  var _miniLyBusy = false;
  var _miniMqTimer = null;
  function stopMiniMarquee(el) {
    if (_miniMqTimer) {
      try { clearTimeout(_miniMqTimer); } catch (e) {}
      _miniMqTimer = null;
    }
    if (!el) return;
    el.classList.remove("is-marquee");
    el.style.removeProperty("--mq-dx");
    el.style.removeProperty("--mq-dur");
    el.style.transform = "";
  }
  /** 过长则单次跑马灯，跑完停在末尾，不循环 */
  function startMiniMarquee(el) {
    stopMiniMarquee(el);
    if (!el) return;
    // 先按截断态测量
    el.classList.remove("is-marquee");
    el.style.transform = "translateX(0)";
    void el.offsetWidth;
    var track = el.parentElement;
    var trackW = (track && track.clientWidth) || el.clientWidth || 0;
    var textW = el.scrollWidth || 0;
    if (!trackW || textW <= trackW + 4) return;
    var dx = -(textW - trackW + 6);
    // 约 40px/s，最短 2.2s，最长 8s
    var dur = Math.max(2.2, Math.min(8, Math.abs(dx) / 40));
    el.style.setProperty("--mq-dx", dx + "px");
    el.style.setProperty("--mq-dur", dur + "s");
    // 下一帧再开动画，避免被换句 transition 干扰
    _miniMqTimer = setTimeout(function () {
      _miniMqTimer = null;
      if (!el.isConnected) return;
      el.classList.add("is-marquee");
    }, 40);
  }
  function clearMiniLyric() {
    var sub = $("#miniSub");
    var cur = $("#miniLyCur");
    var next = $("#miniLyNext");
    if (cur) {
      stopMiniMarquee(cur);
      cur.textContent = "";
      cur.className = "mini-lyric-line is-cur";
    }
    if (next) {
      next.textContent = "";
      next.className = "mini-lyric-line is-next";
    }
    if (sub) sub.classList.remove("show-lyric");
    _miniLyBusy = false;
  }
  function setMiniLyricByIndex(idx, force) {
    var sub = $("#miniSub");
    var cur = $("#miniLyCur");
    if (!cur || !sub) return;
    if (!lyricsLines.length) {
      clearMiniLyric();
      return;
    }
    idx = Math.max(0, Math.min(idx, lyricsLines.length - 1));
    var curText = ((lyricsLines[idx] && lyricsLines[idx].text) || "").trim();
    if (!curText) {
      clearMiniLyric();
      return;
    }
    sub.classList.add("show-lyric");

    // 首次 / 强制：直接显示，不预显下一句
    if (force || !cur.textContent || _miniLyBusy) {
      stopMiniMarquee(cur);
      cur.className = "mini-lyric-line is-cur";
      cur.textContent = curText;
      _miniLyBusy = false;
      requestAnimationFrame(function () { startMiniMarquee(cur); });
      return;
    }
    if (cur.textContent === curText) return;

    // 换句：旧句左淡出，新句从右侧滑入
    _miniLyBusy = true;
    stopMiniMarquee(cur);
    cur.classList.add("is-out");
    setTimeout(function () {
      cur.textContent = curText;
      cur.className = "mini-lyric-line is-cur is-from-right";
      // 强制 reflow 再进入
      void cur.offsetWidth;
      cur.classList.add("is-enter");
      setTimeout(function () {
        cur.className = "mini-lyric-line is-cur";
        _miniLyBusy = false;
        startMiniMarquee(cur);
      }, 320);
    }, 180);
  }
  function syncLyrics(t, force) {
    if (!lyricsLines.length) {
      clearMiniLyric();
      return;
    }
    var idx = 0;
    for (var i = 0; i < lyricsLines.length; i++) {
      if (lyricsLines[i].t <= t + 0.15) idx = i;
      else break;
    }
    if (idx !== _lyricLastIdx || force) {
      setMiniLyricByIndex(idx, !!force);
    }
    var box = $("#npLyrics");
    if (!box) {
      _lyricLastIdx = idx;
      return;
    }
    var nodes = box.querySelectorAll(".ly");
    if (!nodes.length) {
      _lyricLastIdx = idx;
      return;
    }
    var changed = idx !== _lyricLastIdx;

    if (changed || force) {
      // 锁屏：按当前唱到的句，与下一句轮流显示
      try { onLyricIndexForLockScreen(idx); } catch (eLy) {}
      nodes.forEach(function (n, i) {
        var on = i === idx;
        var near = Math.abs(i - idx) === 1;
        n.classList.toggle("on", on);
        n.classList.toggle("near", near && !on);
      });
      _lyricLastIdx = idx;
    }
    var cur = nodes[idx];

    if (!cur || box.dataset.lock === "1") return;
    if (!(changed || force)) return;
    // 当前句丝滑滚到正中（自下而上推进）
    try {
      var boxRect = box.getBoundingClientRect();
      var curRect = cur.getBoundingClientRect();
      var boxMid = boxRect.top + boxRect.height / 2;
      var curMid = curRect.top + curRect.height / 2;
      var delta = curMid - boxMid;
      if (Math.abs(delta) > 2) {
        var target = Math.max(0, box.scrollTop + delta);
        if (typeof box.scrollTo === "function") {
          box.scrollTo({ top: target, behavior: force ? "auto" : "smooth" });
        } else {
          box.scrollTop = target;
        }
      }
    } catch (e) {}
  }


  function pushRecent(song) {
    var k = keyOf(song);
    S.recent = [song].concat(S.recent.filter(function (x) { return keyOf(x) !== k; })).slice(0, 100);
    saveJSON("aq_recent", S.recent);
    updateLibCounts();
    renderLibRecent();
  }

  /* ========== 本地下载：IndexedDB 存文件 + 导出到系统 ========== */
  var _dlDbP = null;
  function dlDb() {
    if (_dlDbP) return _dlDbP;
    _dlDbP = new Promise(function (resolve, reject) {
      try {
        var req = indexedDB.open("aq_music_files_v1", 1);
        req.onupgradeneeded = function () {
          var db = req.result;
          if (!db.objectStoreNames.contains("files")) {
            db.createObjectStore("files", { keyPath: "id" });
          }
        };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error || new Error("idb")); };
      } catch (e) {
        reject(e);
      }
    });
    return _dlDbP;
  }
  function dlKey(song) {
    return "dl_" + keyOf(song);
  }
  function safeFilename(song, ext) {
    var name = (song.name || "song") + " - " + (song.artist || "unknown");
    name = String(name).replace(/[\\\/:*?"<>|]/g, "_").replace(/\s+/g, " ").trim();
    if (name.length > 80) name = name.slice(0, 80);
    return name + "." + (ext || "mp3");
  }
  async function idbPutFile(id, blob, meta) {
    var db = await dlDb();
    return new Promise(function (resolve, reject) {
      var tx = db.transaction("files", "readwrite");
      tx.objectStore("files").put({
        id: id,
        blob: blob,
        mime: (blob && blob.type) || "audio/mpeg",
        name: (meta && meta.filename) || "song.mp3",
        ts: Date.now(),
        song: meta && meta.song ? {
          name: meta.song.name,
          artist: meta.song.artist,
          songmid: meta.song.songmid || meta.song.id,
          id: meta.song.id,
          source: meta.song.source,
          cover: meta.song.cover,
          album: meta.song.album,
          hash: meta.song.hash,
        } : null,
      });
      tx.oncomplete = function () { resolve(true); };
      tx.onerror = function () { reject(tx.error); };
    });
  }
  async function idbGetFile(id) {
    try {
      var db = await dlDb();
      return await new Promise(function (resolve) {
        var tx = db.transaction("files", "readonly");
        var req = tx.objectStore("files").get(id);
        req.onsuccess = function () { resolve(req.result || null); };
        req.onerror = function () { resolve(null); };
      });
    } catch (e) {
      return null;
    }
  }
  async function idbDelFile(id) {
    try {
      var db = await dlDb();
      return await new Promise(function (resolve) {
        var tx = db.transaction("files", "readwrite");
        tx.objectStore("files").delete(id);
        tx.oncomplete = function () { resolve(true); };
        tx.onerror = function () { resolve(false); };
      });
    } catch (e) {
      return false;
    }
  }

  /** 导出到系统目录：Android/浏览器 → 直接进「下载」；iOS → 分享到文件 */
  async function exportBlobToDevice(blob, filename) {
    var ua = navigator.userAgent || "";
    var isIOS = /iPad|iPhone|iPod/.test(ua) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    var isAndroid = /Android/i.test(ua);

    function triggerAnchorDownload() {
      var obj = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = obj;
      a.download = filename;
      a.setAttribute("download", filename);
      a.style.display = "none";
      a.rel = "noopener";
      // 部分 Android WebView 需要进 DOM 再 click
      document.body.appendChild(a);
      if (typeof a.requestFullscreen === "function") { /* no-op keep lint calm */ }
      a.click();
      setTimeout(function () {
        try { a.remove(); } catch (e) {}
        try { URL.revokeObjectURL(obj); } catch (e2) {}
      }, 6000);
      return "anchor";
    }

    // —— Android / 桌面浏览器：优先 a[download]，一般直接进系统「下载」文件夹 ——
    if (!isIOS) {
      try {
        // IE/旧 Edge
        if (window.navigator && window.navigator.msSaveOrOpenBlob) {
          window.navigator.msSaveOrOpenBlob(blob, filename);
          return "anchor";
        }
        triggerAnchorDownload();
        return "anchor";
      } catch (eA) {
        console.warn("anchor download fail", eA);
      }
      // 桌面可再试「另存为」选目录
      try {
        if (window.showSaveFilePicker) {
          var handle = await window.showSaveFilePicker({
            suggestedName: filename,
            types: [{ description: "Audio", accept: { "audio/*": [".mp3", ".flac", ".m4a"] } }],
          });
          var w = await handle.createWritable();
          await w.write(blob);
          await w.close();
          return "picker";
        }
      } catch (ePick) {
        if (ePick && ePick.name === "AbortError") return "cancel";
      }
    }

    // —— iOS：a[download] 不可靠，用系统分享 →「存储到文件」——
    try {
      var file = new File([blob], filename, { type: blob.type || "audio/mpeg" });
      if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: filename, text: filename });
        return "share";
      }
    } catch (eShare) {
      if (eShare && (eShare.name === "AbortError" || /abort|cancel/i.test(String(eShare.message || "")))) {
        return "cancel";
      }
    }

    // 最后兜底再试一次 anchor（部分环境仍可能进下载）
    try {
      return triggerAnchorDownload();
    } catch (e2) {}
    return "none";
  }

  /** 播放前：若本地下载库有文件，返回 blob URL */
  async function getLocalPlayUrl(song) {
    if (!song) return null;
    var id = dlKey(song);
    var rec = await idbGetFile(id);
    if (!rec || !rec.blob) return null;
    try {
      return URL.createObjectURL(rec.blob);
    } catch (e) {
      return null;
    }
  }

  async function download(song) {
    if (!song) return;
    toast("正在获取音频…");
    var url = await resolvePlay(song);
    if (!url) { toast("无下载地址"); return; }

    var ext = "mp3";
    if (/flac/i.test(url)) ext = "flac";
    else if (/m4a|mp4|aac/i.test(url)) ext = "m4a";
    var filename = safeFilename(song, ext);
    var id = dlKey(song);

    try {
      var ctrl = new AbortController();
      var to = setTimeout(function () { ctrl.abort(); }, 60000);
      var res = await fetch(url, { mode: "cors", credentials: "omit", signal: ctrl.signal });
      clearTimeout(to);
      if (!res.ok) throw new Error("http " + res.status);
      var blob = await res.blob();
      if (!blob || blob.size < 1000) throw new Error("empty blob");
      if (blob.type && /flac/i.test(blob.type)) {
        filename = safeFilename(song, "flac");
      }

      // 1) 写入 App 内数据库 → 「已下载」列表可离线播
      try {
        await idbPutFile(id, blob, { filename: filename, song: song });
      } catch (eIdb) {
        console.warn("idb put fail", eIdb);
      }

      var entry = Object.assign({}, song, {
        local: true,
        localId: id,
        localName: filename,
        localSize: blob.size,
      });
      var k = keyOf(song);
      S.dl = [entry].concat(S.dl.filter(function (x) { return keyOf(x) !== k; })).slice(0, 80);
      saveJSON("aq_dl", S.dl);
      updateLibCounts();

      // 2) 导出到系统目录 / 分享
      var how = await exportBlobToDevice(blob, filename);
      if (how === "anchor") {
        toast("已保存到系统「下载」文件夹 · App 内也可离线播");
      } else if (how === "picker") {
        toast("已保存到你选择的位置");
      } else if (how === "share") {
        toast("请选择「存储到文件」保存到手机");
      } else if (how === "cancel") {
        toast("已加入 App 内「已下载」（未导出到系统）");
      } else {
        toast("已加入 App 内「已下载」，可离线播放");
      }
      return;
    } catch (e) {
      console.warn("download fail", e);
    }

    // CORS 失败：打开直链，提示用户长按保存；列表仍记录元数据（在线播）
    try {
      window.open(url, "_blank", "noopener");
      toast("跨域限制，已打开链接，请用浏览器「下载/另存为」");
    } catch (e2) {
      toast("下载失败，请换音源或音质重试");
    }
    var k2 = keyOf(song);
    S.dl = [song].concat(S.dl.filter(function (x) { return keyOf(x) !== k2; })).slice(0, 80);
    saveJSON("aq_dl", S.dl);
    updateLibCounts();
  }


  function syncLikeButtons(song) {
    if (!song) return;
    var k = keyOf(song);
    var on = isSongLiked(song);
    try {
      document.querySelectorAll(".song-like[data-sk], .detail-song-like[data-sk]").forEach(function (btn) {
        if (btn.getAttribute("data-sk") === k) {
          btn.classList.toggle("on", on);
        }
      });
    } catch (e1) {}
    try { updateFavBtn(); } catch (e2) {}
  }
  function toggleFav(song) {
    if (!song) return;
    var k = keyOf(song);
    if (S.fav.some(function (x) { return keyOf(x) === k; })) {
      S.fav = S.fav.filter(function (x) { return keyOf(x) !== k; });
      toast("已取消喜欢");
    } else {
      S.fav.unshift(song);
      toast("已加入喜欢");
    }
    saveJSON("aq_fav", S.fav);
    updateLibCounts();
    syncLikeButtons(song);
  }

  function favPlKey(pl) {
    if (!pl) return "";
    return String(pl.source || "") + ":" + String(pl.kind || "playlist") + ":" + String(pl.id || pl.topId || "");
  }
  function isFavPlaylist(pl) {
    if (!pl || !S.favPl) return false;
    var k = favPlKey(pl);
    return S.favPl.some(function (x) { return favPlKey(x) === k; });
  }
  function toggleFavPlaylist(pl) {
    if (!pl) return;
    if (!S.favPl) S.favPl = [];
    var k = favPlKey(pl);
    var idx = -1;
    for (var i = 0; i < S.favPl.length; i++) {
      if (favPlKey(S.favPl[i]) === k) { idx = i; break; }
    }
    if (idx >= 0) {
      S.favPl.splice(idx, 1);
      toast("已取消收藏歌单");
    } else {
      S.favPl.unshift({
        id: String(pl.id || pl.topId || ""),
        topId: pl.topId || pl.id || "",
        name: pl.name || pl.title || "歌单",
        title: pl.name || pl.title || "歌单",
        cover: pl.cover || detailState.cover || "",
        source: pl.source || detailState.source || S.platform || "qq",
        kind: pl.kind || detailState.kind || "playlist",
        intro: pl.intro || pl.desc || "",
      });
      toast("已加入喜欢的歌单");
    }
    saveJSON("aq_fav_pl", S.favPl);
    updateLibCounts();
    syncDetailLikeBtn();
  }
  function syncDetailLikeBtn() {
    var btn = document.getElementById("detailLikeBtn");
    if (!btn) return;
    var pl = {
      id: detailState.id,
      topId: detailState.id,
      name: detailState.title,
      cover: detailState.cover,
      source: detailState.source,
      kind: detailState.kind,
    };
    btn.classList.toggle("on", isFavPlaylist(pl));
  }

  /* ========== UI ========== */
  function srcLabelOf(song) {
    var map = { qq: "QQ", netease: "网易", kugou: "酷狗", kuwo: "酷我", migu: "咪咕", bilibili: "B站", bili: "B站" };
    var s = (song && song.source) || S.platform || "qq";
    return map[s] || String(s).toUpperCase();
  }
  function songRow(song, list) {
    var el = document.createElement("div");
    el.className = "song";
    el.innerHTML =
      '<img class="song-art" alt="" />' +
      '<div class="song-meta"><div class="song-name"></div><div class="song-sub">' +
      '<span class="song-src"></span><span class="song-sub-text"></span></div></div>' +
      '<div class="song-side">' +
      '<span class="song-dur"></span>' +
      '<button class="song-like" type="button" aria-label="喜欢"></button>' +
      '</div>';
    bindImg(el.querySelector(".song-art"), song);
    el.querySelector(".song-name").textContent = song.name;
    var srcEl = el.querySelector(".song-src");
    var plat = String((song && song.source) || S.platform || "qq").toLowerCase();
    if (plat === "wy") plat = "netease";
    if (plat === "kw") plat = "kuwo";
    if (plat === "kg") plat = "kugou";
    if (plat === "mg") plat = "migu";
    if (plat === "tx") plat = "qq";
    srcEl.textContent = srcLabelOf(song);
    srcEl.setAttribute("data-plat", plat);
    el.querySelector(".song-sub-text").textContent =
      (song.artist || song.singer || song.singername || "未知") + (song.album ? " · " + song.album : "");
    var durEl = el.querySelector(".song-dur");
    var sec = songDurationSec(song);
    durEl.textContent = sec > 0 ? fmt(sec) : "";
    var likeBtn = el.querySelector(".song-like");
    likeBtn.innerHTML = heartSvg();
    try { likeBtn.setAttribute("data-sk", keyOf(song)); } catch (eSk) {}
    if (isSongLiked(song)) likeBtn.classList.add("on");
    likeBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      e.preventDefault();
      toggleFav(song);
    });
    el.addEventListener("click", function (e) {
      if (e.target.closest(".song-like")) return;
      play(song, list);
    });
    return el;
  }
  function albumCard(song, list) {
    var el = document.createElement("div");
    el.className = "album";
    el.innerHTML = '<img class="album-art" alt="" /><div class="album-name"></div><div class="album-artist"></div>';
    /* 为你推荐：优先 800 高清封面，失败回退普通 */
    bindImg(el.querySelector(".album-art"), song, true);
    el.querySelector(".album-name").textContent = song.name;
    el.querySelector(".album-artist").textContent = song.artist;
    el.addEventListener("click", function () { play(song, list); });
    return el;
  }
  function playlistCard(pl) {
    var el = document.createElement("div");
    el.className = "album";
    el.innerHTML = '<img class="album-art" alt="" /><div class="album-name"></div><div class="album-artist"></div>';
    var img = el.querySelector(".album-art");
    img.referrerPolicy = "no-referrer";
    img.onerror = function () { this.onerror = null; this.src = PLACEHOLDER; };
    img.src = pl.cover || PLACEHOLDER;
    el.querySelector(".album-name").textContent = pl.name;
    el.querySelector(".album-artist").textContent = "歌单";
    el.addEventListener("click", function () {
      playPlaylist(pl);
    });
    return el;
  }

  /* ========== Home ========== */

  /**
   * 主页「猜你喜欢」——对齐 QQ 音乐日常推荐逻辑（非汽水向）
   * 按流派混排：华语流行 / 抒情情歌 / 民谣 / R&B / 说唱 / 摇滚 / 粤语 / 经典怀旧 / 新歌
   * 主链路：官方榜单（热歌·流行指数·新歌·飙升）+ 流派关键词 + 优质艺人池
   * 严格过滤：AI 翻唱、抖音流水、儿歌、日语噪声；艺人去重一人最多 2 首
   * 网络抒情/民谣艺人（如戴羽彤、海来阿木）并入对应流派池随机抽取，不单独按名拉取
   */
  async function fetchGuessLike(size) {
    size = size || 40;
    var plat = S.platform || "qq";
    var out = [];
    var seen = {};
    var artistCnt = {};
    function artistKey(s) {
      var a = (s && (s.artist || s.singer || s.singername || "")) || "";
      a = String(a).replace(/\s+/g, "").replace(/[\/／、,&|｜]/g, "/").split("/")[0];
      return a.toLowerCase() || "_unknown";
    }
    function pushSongs(arr, forceSrc, maxPerArtist) {
      maxPerArtist = maxPerArtist == null ? 2 : maxPerArtist;
      (arr || []).forEach(function (s) {
        if (!s) return;
        var raw = s.songInfo || s.track || s.Track || s;
        if (raw && raw.songInfo) raw = raw.songInfo;
        var mid = raw.mid || raw.songmid || raw.songMid || s.mid || s.songmid || s.id || "";
        var name = raw.name || raw.title || raw.songname || s.name || s.title || "";
        if (!mid || !name) return;
        var amid =
          raw.albummid || raw.albumMid || raw.album_mid ||
          (raw.album && (raw.album.mid || raw.album.pmid || raw.album.albumMid)) ||
          (s.album && (s.album.mid || s.album.pmid)) || s.albummid || "";
        var pic = raw.cover || raw.pic || (raw.album && (raw.album.picUrl || raw.album.pic)) || s.cover || "";
        var n = null;
        try {
          n = normSong(Object.assign({}, raw, s, {
            mid: mid, songmid: mid, name: name, title: name,
            albummid: amid, albumMid: amid,
            cover: pic || (amid ? coverUrl(amid) : ""),
            source: forceSrc || s.source || plat,
          }));
        } catch (eN) {
          n = {
            name: name,
            artist: s.artist || s.singer || "未知",
            songmid: String(mid),
            id: String(mid),
            cover: pic || "",
            source: forceSrc || s.source || plat,
          };
        }
        if (!n || !n.songmid || seen[n.songmid]) return;
        if (!n.cover && n.albummid) n.cover = coverUrl(n.albummid);
        var t = ((n.name || "") + " " + (n.artist || "") + " " + (n.album || "")).toLowerCase();
        if (/[\u3040-\u30ff]/.test(t)) return;
        if (/日语|日文|日本|j-pop|jpop|儿歌|童谣|儿童|少儿|幼儿|宝宝巴士|贝瓦/.test(t)) return;
        if (/^dj\s|电台|广播|播客|有声|伴奏|纯音乐版|铃声/.test((n.name || "").toLowerCase())) return;
        if (/ai翻唱|suno|虚拟歌手|洛天依|初音|汽水音乐翻唱|抖音bgm|快手热歌/.test(t)) return;
        if (/伤感翻唱|热门翻唱|网络翻唱|男女对唱版/.test(t)) return;
        var ak = artistKey(n);
        if ((artistCnt[ak] || 0) >= maxPerArtist) return;
        seen[n.songmid] = 1;
        artistCnt[ak] = (artistCnt[ak] || 0) + 1;
        n.source = forceSrc || n.source || plat;
        out.push(n);
      });
    }
    function withT(p, ms) {
      return Promise.race([
        Promise.resolve(p).catch(function () { return []; }),
        new Promise(function (r) { setTimeout(function () { r([]); }, ms); }),
      ]);
    }
    function shuffleLocal(arr) {
      arr = (arr || []).slice();
      for (var i = arr.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
      }
      return arr;
    }

    /* —— 流派关键词池（对齐 QQ 音乐曲风标签） —— */
    var genreKw = {
      pop: ["华语流行", "内地流行", "流行歌曲", "华语热歌", "国语流行"],
      ballad: ["华语情歌", "抒情歌曲", "慢歌", "温柔情歌", "伤感情歌"],
      folk: ["华语民谣", "民谣歌曲", "独立民谣", "校园民谣"],
      rnb: ["华语R&B", "R&B歌曲", "节奏布鲁斯", "灵魂乐"],
      rap: ["华语说唱", "说唱歌曲", "嘻哈", "国风说唱"],
      rock: ["华语摇滚", "摇滚歌曲", "独立摇滚"],
      canto: ["粤语流行", "粤语歌曲", "粤语经典", "广东歌"],
      classic: ["华语经典", "经典老歌", "怀旧金曲", "华语金曲"],
      newhit: ["华语新歌", "流行新歌", "热门新歌"],
    };
    /* 优质艺人池：各流派代表性；网络抒情/民谣并入 ballad / folk，随池随机，不单独指定 */
    var genreArtists = {
      pop: ["周杰伦", "林俊杰", "薛之谦", "邓紫棋", "李荣浩", "张杰", "周深", "汪苏泷", "许嵩", "胡彦斌"],
      ballad: ["毛不易", "张碧晨", "袁娅维", "金志文", "郁可唯", "张靓颖", "梁静茹", "林宥嘉", "戴羽彤", "庄心妍", "程响", "任然"],
      folk: ["赵雷", "陈鸿宇", "宋冬野", "马頔", "尧十三", "陈粒", "万能青年旅店", "海来阿木", "隔壁老樊", "柏松"],
      rnb: ["陶喆", "王力宏", "方大同", "Jony J", "艾热", "那英"],
      rap: ["GAI", "VaVa", "马思唯", "法老", "KEY.L刘聪", "Tizzy T"],
      rock: ["五月天", "痛仰", "新裤子", "刺猬", "二手玫瑰", "逃跑计划"],
      canto: ["陈奕迅", "张学友", "Beyond", "杨千嬅", "容祖儿", "古巨基", "李克勤"],
      classic: ["邓丽君", "王菲", "张国荣", "刘若英", "孙燕姿", "蔡依林", "周华健"],
    };

    var kwJobs = [];
    var genreOrder = ["pop", "ballad", "folk", "rnb", "rap", "rock", "canto", "classic", "newhit"];
    genreOrder.forEach(function (g) {
      var kws = shuffleLocal(genreKw[g] || []).slice(0, 2);
      kws.forEach(function (k) { kwJobs.push({ kind: "kw", genre: g, q: k }); });
      var arts = shuffleLocal(genreArtists[g] || []).slice(0, g === "pop" || g === "ballad" ? 3 : 2);
      arts.forEach(function (a) { kwJobs.push({ kind: "artist", genre: g, q: a }); });
    });
    kwJobs = shuffleLocal(kwJobs).slice(0, 18);

    var jobs = [];
    jobs.push(withT((async function () {
      try {
        var boards = await fetchToplistOverview().catch(function () { return []; });
        if (!boards || !boards.length) return [];
        var prefer = boards.filter(function (b) {
          var t = String(b.name || b.title || "");
          return /热歌|流行|新歌|飙升|潮流|国风|说唱|民谣|摇滚/.test(t);
        });
        var pick = (prefer.length ? prefer : boards).slice(0, 4);
        var all = [];
        for (var bi = 0; bi < pick.length; bi++) {
          var b = pick[bi];
          var pack = await fetchToplistDetail(b.topId || b.id, b.source || plat || "qq", b).catch(function () { return null; });
          var songs = (pack && pack.songs) || [];
          if (songs.length > 20) songs = songs.slice(3, 22);
          else if (songs.length > 10) songs = songs.slice(1);
          all = all.concat(shuffleLocal(songs).slice(0, 14));
        }
        return all;
      } catch (e) { return []; }
    })(), 7000));

    kwJobs.forEach(function (item) {
      jobs.push(withT(searchSongs(item.q), 4500).then(function (list) {
        return { genre: item.genre, list: list || [] };
      }));
    });

    try {
      var packs = await Promise.all(jobs);
      var bucketBoard = shuffleLocal(packs[0] || []);
      var byGenre = {};
      for (var i = 1; i < packs.length; i++) {
        var p = packs[i] || {};
        var g = p.genre || "pop";
        if (!byGenre[g]) byGenre[g] = [];
        byGenre[g] = byGenre[g].concat(shuffleLocal(p.list || []).slice(0, 10));
      }

      var genreQuota = {
        pop: Math.round(size * 0.14),
        ballad: Math.round(size * 0.12),
        folk: Math.round(size * 0.08),
        rnb: Math.round(size * 0.07),
        rap: Math.round(size * 0.06),
        rock: Math.round(size * 0.06),
        canto: Math.round(size * 0.07),
        classic: Math.round(size * 0.07),
        newhit: Math.round(size * 0.06),
      };

      pushSongs(bucketBoard, "qq", 2);
      genreOrder.forEach(function (g) {
        var need = genreQuota[g] || 2;
        var pool = shuffleLocal(byGenre[g] || []);
        var before = out.length;
        pushSongs(pool, "qq", 2);
        if (out.length - before < Math.max(1, Math.floor(need / 2))) {
          pushSongs(pool, "qq", 3);
        }
      });
    } catch (e) {
      console.warn("fetchGuessLike", e);
    }

    if (out.length < size) {
      try {
        var fillKw = shuffleLocal([
          "华语流行", "华语情歌", "流行歌曲", "经典老歌", "粤语流行",
          "华语民谣", "华语新歌", "华语摇滚", "R&B", "说唱"
        ]).slice(0, 5);
        var morePack = await Promise.all(fillKw.map(function (k) {
          return withT(searchQQ(k), 3500);
        }));
        var extraMerged = [];
        morePack.forEach(function (arr) {
          extraMerged = extraMerged.concat(shuffleLocal(arr || []).slice(0, 10));
        });
        pushSongs(extraMerged, "qq", 2);
      } catch (e2) {}
    }

    function interleaveByArtist(list) {
      var buckets = {};
      var keys = [];
      (list || []).forEach(function (s) {
        var ak = artistKey(s);
        if (!buckets[ak]) { buckets[ak] = []; keys.push(ak); }
        buckets[ak].push(s);
      });
      keys = shuffleLocal(keys);
      var merged = [];
      var more = true;
      while (more) {
        more = false;
        for (var ki = 0; ki < keys.length; ki++) {
          var b = buckets[keys[ki]];
          if (b && b.length) {
            merged.push(b.shift());
            more = true;
          }
        }
      }
      return merged;
    }

    return interleaveByArtist(out).slice(0, size);
  }

  /* ========== 顶部双卡：猜你喜欢 / 听歌雷达 ========== */
  var S_guessSong = null;
  var S_radarSong = null;
  var S_guessPool = [];
  var S_radarPool = [];
  var duoTimer = null;
  var _duoCarousel = {
    guess: { slides: [], idx: 0, flip: false },
    radar: { slides: [], idx: 0, flip: false },
  };

  function pickDuoSong(pool, excludeKey) {
    var arr = (pool || []).filter(function (s) {
      return s && keyOf(s) !== excludeKey;
    });
    if (!arr.length) arr = pool || [];
    if (!arr.length) return null;
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function _duoCoverOf(song) {
    if (!song) return PLACEHOLDER;
    try {
      var hi = typeof songCoverHi === "function" ? songCoverHi(song) : "";
      return hi || songCover(song) || PLACEHOLDER;
    } catch (e) {
      return songCover(song) || PLACEHOLDER;
    }
  }

  /** 从池中随机抽最多 n 首，艺人尽量不重复 */
  function pickDuoSlides(pool, n, excludeKeys) {
    n = n || 5;
    excludeKeys = excludeKeys || [];
    var arr = (pool || []).filter(Boolean).slice();
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    var out = [], seenK = {}, seenA = {};
    excludeKeys.forEach(function (k) { if (k) seenK[k] = 1; });
    function tryPush(s, strictA) {
      if (!s) return false;
      var k = keyOf(s);
      if (!k || seenK[k]) return false;
      var a = String(s.artist || s.singer || "").split(/[\/、,&|｜]/)[0].trim().toLowerCase();
      if (strictA && a && seenA[a]) return false;
      seenK[k] = 1;
      if (a) seenA[a] = 1;
      out.push(s);
      return true;
    }
    arr.forEach(function (s) {
      if (out.length >= n) return;
      tryPush(s, true);
    });
    if (out.length < n) {
      arr.forEach(function (s) {
        if (out.length >= n) return;
        tryPush(s, false);
      });
    }
    return out;
  }

  function paintDuoCard(kind, song, opts) {
    opts = opts || {};
    var isGuess = kind === "guess";
    var title = $(isGuess ? "#guessTitle" : "#radarTitle");
    var sub = $(isGuess ? "#guessSub" : "#radarSub");
    var imgA = $(isGuess ? "#guessImg" : "#radarImg");
    var imgB = $(isGuess ? "#guessImgB" : "#radarImgB");
    var state = _duoCarousel[isGuess ? "guess" : "radar"];

    if (song && (song.name || song.songmid)) {
      if (title) title.textContent = song.name || "—";
      var ar = song.artist || song.singername || song.singer || "";
      if (ar === "未知" || !ar) ar = song.album || "";
      if (sub) sub.textContent = ar || "";
      // 仅猜你喜欢：左上角色条跟随当前站源（切站即变色）
      if (isGuess) {
        var card = $("#guessCard");
        var plat = String(S.platform || (song && song.source) || "qq").toLowerCase();
        if (plat === "wy") plat = "netease";
        if (plat === "kw") plat = "kuwo";
        if (plat === "kg") plat = "kugou";
        if (plat === "mg") plat = "migu";
        if (plat === "tx") plat = "qq";
        if (card) card.setAttribute("data-plat", plat);
      }

      var cover = _duoCoverOf(song);
      var glassImg = $(isGuess ? "#guessGlassImg" : "#radarGlassImg");
      if (glassImg) {
        glassImg.referrerPolicy = "no-referrer";
        glassImg.onerror = function () { this.onerror = null; this.removeAttribute("src"); };
        glassImg.src = cover || "";
      }
      var fade = !!opts.fade && imgA && imgB;

      if (fade) {
        // 双缓冲交叉淡入：当前 on 的图淡出，另一张写入新图后淡入
        var front = state.flip ? imgB : imgA;
        var back = state.flip ? imgA : imgB;
        if (back) {
          back.referrerPolicy = "no-referrer";
          back.onerror = function () {
            this.onerror = null;
            this.src = PLACEHOLDER;
          };
          back.src = cover || PLACEHOLDER;
          // 强制 reflow 再切换 class，保证 transition
          try { void back.offsetWidth; } catch (eR) {}
          back.classList.add("on");
          if (front) front.classList.remove("on");
          state.flip = !state.flip;
        }
      } else if (imgA) {
        imgA.referrerPolicy = "no-referrer";
        imgA.onerror = function () {
          this.onerror = null;
          this.src = PLACEHOLDER;
        };
        imgA.src = cover || PLACEHOLDER;
        imgA.classList.add("on");
        if (imgB) {
          imgB.classList.remove("on");
          imgB.removeAttribute("src");
        }
        state.flip = false;
      }
    } else {
      if (imgA) {
        imgA.onerror = null;
        imgA.src = PLACEHOLDER;
        imgA.classList.add("on");
      }
      if (imgB) imgB.classList.remove("on");
      if (title) title.textContent = "暂无推荐";
      if (sub) sub.textContent = "";
      if (isGuess) {
        var card0 = $("#guessCard");
        if (card0) card0.removeAttribute("data-plat");
      }
    }
  }

  function _duoRecentKeys() {
    try {
      return JSON.parse(sessionStorage.getItem("aq_duo_recent") || "[]") || [];
    } catch (e) { return []; }
  }
  function _duoRemember(keys) {
    try {
      var prev = _duoRecentKeys();
      var next = (keys || []).concat(prev).filter(Boolean);
      var seen = {}, out = [];
      next.forEach(function (k) {
        if (seen[k]) return;
        seen[k] = 1;
        out.push(k);
      });
      sessionStorage.setItem("aq_duo_recent", JSON.stringify(out.slice(0, 24)));
    } catch (e2) {}
  }
  function pickFreshDuoSong(pool, excludeKeys) {
    excludeKeys = excludeKeys || [];
    var recent = _duoRecentKeys();
    var arr = (pool || []).filter(Boolean);
    if (!arr.length) return null;
    function score(s) {
      var k = keyOf(s);
      var c = (s.cover || s.albummid || "") + "";
      var pen = 0;
      if (excludeKeys.indexOf(k) >= 0) pen += 50;
      if (recent.indexOf(k) >= 0) pen += 20;
      if (c && recent.indexOf("c:" + c) >= 0) pen += 15;
      return pen + Math.random();
    }
    var ranked = arr.slice().sort(function (a, b) { return score(a) - score(b); });
    return ranked[0] || null;
  }

  var duoTimerGuess = null;
  var duoTimerRadar = null;
  var duoRadarDelay = null;

  function stopDuoCarousel() {
    if (duoTimer) {
      try { clearInterval(duoTimer); } catch (e) {}
      duoTimer = null;
    }
    if (duoTimerGuess) {
      try { clearInterval(duoTimerGuess); } catch (e0) {}
      duoTimerGuess = null;
    }
    if (duoTimerRadar) {
      try { clearInterval(duoTimerRadar); } catch (e1) {}
      duoTimerRadar = null;
    }
    if (duoRadarDelay) {
      try { clearTimeout(duoRadarDelay); } catch (e2) {}
      duoRadarDelay = null;
    }
  }

  function tickDuoOne(kind) {
    var st = _duoCarousel[kind];
    if (!st || !st.slides || st.slides.length < 2) return;
    st.idx = (st.idx + 1) % st.slides.length;
    var song = st.slides[st.idx];
    if (kind === "guess") S_guessSong = song;
    else S_radarSong = song;
    paintDuoCard(kind, song, { fade: true });
  }

  function tickDuoCarousel() {
    // 兼容旧调用：分别推进，但通常用错位定时器
    tickDuoOne("guess");
    tickDuoOne("radar");
  }

  function startDuoCarousel() {
    stopDuoCarousel();
    var gN = (_duoCarousel.guess.slides || []).length;
    var rN = (_duoCarousel.radar.slides || []).length;
    if (gN < 2 && rN < 2) return;
    // 两卡错位轮播：猜你喜欢立即按 4.5s；听歌雷达延迟约半拍再开，互不同步换图
    if (gN >= 2) {
      duoTimerGuess = setInterval(function () {
        if (document.hidden) return;
        try { tickDuoOne("guess"); } catch (e) { console.warn(e); }
      }, 4500);
    }
    if (rN >= 2) {
      // 先错开约 2.2s 再进入同一周期，之后各自独立计时
      duoRadarDelay = setTimeout(function () {
        duoRadarDelay = null;
        if (document.hidden) return;
        try { tickDuoOne("radar"); } catch (e2) {}
        duoTimerRadar = setInterval(function () {
          if (document.hidden) return;
          try { tickDuoOne("radar"); } catch (e3) { console.warn(e3); }
        }, 4500);
      }, 2200);
    }
  }

  function renderTopDuo(guessList, radarList) {
    // 只在有数据时更新对应池，避免一侧先到把另一侧清空成「暂无推荐」
    var hasG = guessList && guessList.length;
    var hasR = radarList && radarList.length;
    if (hasG) S_guessPool = (guessList || []).filter(Boolean).slice();
    if (hasR) S_radarPool = (radarList || []).filter(Boolean).slice();

    // 各随机最多 5 张海报轮播；两卡尽量错开曲目
    var gSlides = pickDuoSlides(S_guessPool, 5, []);
    var gKeys = gSlides.map(function (s) { return keyOf(s); });
    var rSlides = pickDuoSlides(S_radarPool, 5, gKeys);
    // 雷达池不足时不强制排除
    if (rSlides.length < 2) rSlides = pickDuoSlides(S_radarPool, 5, []);

    if (hasG || gSlides.length) {
      _duoCarousel.guess = { slides: gSlides, idx: 0, flip: false };
      S_guessSong = gSlides[0] || null;
    }
    if (hasR || rSlides.length) {
      _duoCarousel.radar = { slides: rSlides, idx: 0, flip: false };
      S_radarSong = rSlides[0] || null;
    }

    // 若首张撞封面，雷达换下一张
    try {
      var gKey = S_guessSong ? keyOf(S_guessSong) : "";
      var gCover = S_guessSong ? ((S_guessSong.cover || S_guessSong.albummid || "") + "") : "";
      if (S_guessSong && S_radarSong && rSlides.length > 1) {
        for (var ri = 0; ri < rSlides.length; ri++) {
          var rs = rSlides[ri];
          var same = keyOf(rs) === gKey ||
            (((rs.cover || rs.albummid || "") + "" === gCover) && gCover);
          if (!same) {
            S_radarSong = rs;
            _duoCarousel.radar.idx = ri;
            break;
          }
        }
      }
    } catch (eAlign) {}

    try {
      var mem = [];
      if (S_guessSong) {
        mem.push(keyOf(S_guessSong));
        if (S_guessSong.cover || S_guessSong.albummid) mem.push("c:" + (S_guessSong.cover || S_guessSong.albummid));
      }
      if (S_radarSong) {
        mem.push(keyOf(S_radarSong));
        if (S_radarSong.cover || S_radarSong.albummid) mem.push("c:" + (S_radarSong.cover || S_radarSong.albummid));
      }
      _duoRemember(mem);
    } catch (eM) {}

    if (S_guessSong || hasG) paintDuoCard("guess", S_guessSong, { fade: false });
    if (S_radarSong || hasR) paintDuoCard("radar", S_radarSong, { fade: false });
    // 仍无雷达数据时保持「加载中」，不要写成暂无推荐
    if (!S_radarSong && !(_duoCarousel.radar.slides || []).length) {
      try {
        var rt = $("#radarTitle");
        if (rt && (rt.textContent === "暂无推荐" || rt.textContent === "—" || !rt.textContent)) {
          rt.textContent = "加载中…";
        }
      } catch (eRt) {}
    }

    var gCard = $("#guessCard");
    var rCard = $("#radarCard");
    function buildDuoQueue(seed, primary, fallback) {
      var pool = [];
      function pushAll(arr) {
        (arr || []).forEach(function (s) {
          if (!s) return;
          if (indexInList(pool, s) >= 0) return;
          pool.push(s);
        });
      }
      pushAll(primary);
      if (pool.length < 2) pushAll(fallback);
      if (seed) {
        pool = pool.filter(function (s) { return keyOf(s) !== keyOf(seed); });
        pool.unshift(seed);
      }
      if (!pool.length && seed) pool = [seed];
      return pool.slice();
    }
    if (gCard) {
      gCard.onclick = function () {
        if (!S_guessSong) return;
        var q = buildDuoQueue(S_guessSong, S_guessPool, S.guessList);
        play(S_guessSong, q);
      };
    }
    if (rCard) {
      rCard.onclick = function () {
        if (!S_radarSong) return;
        var q = buildDuoQueue(S_radarSong, S_radarPool, S.radarList);
        play(S_radarSong, q);
      };
    }

    startDuoCarousel();
  }

  /**
   * 听歌雷达 ← NGMusic「私人雷达 / 私人FM」数据池
   * 链路对齐 APK：
   *   1) /api/v1/radio/get · /api/personal_fm · /api/radio/get  （私人FM）
   *   2) /api/v3/discovery/recommend/songs 等日推              （私人推荐）
   *   3) /api/personalized/newsong                             （个性化新歌）
   *   4) 仍空时再轻量搜索兜底
   * 歌曲统一标 source=netease，与猜你喜欢曲库分离
   */
  async function fetchRadarSongs(size) {
    size = size || 40;
    var out = [];
    var seen = {};
    function withT(p, ms) {
      return Promise.race([
        Promise.resolve(p).catch(function () { return null; }),
        new Promise(function (r) { setTimeout(function () { r(null); }, ms); }),
      ]);
    }
    function pushSong(s) {
      if (!s || !(s.songmid || s.id || s.name)) return;
      var k = keyOf(s);
      if (!k || seen[k]) return;
      seen[k] = 1;
      if (!s.source) s.source = S.platform || "qq";
      out.push(s);
    }
    // 与猜你喜欢同路径：当前站源搜索 + 榜单，优先保证首屏有图（不再死等网易 FM）
    var kws = [
      "流行", "华语热歌", "抖音热歌", "独立音乐", "民谣", "电子",
      "说唱", "轻音乐", "R&B", "摇滚", "经典老歌", "新歌"
    ];
    try {
      for (var i = kws.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var t = kws[i]; kws[i] = kws[j]; kws[j] = t;
      }
    } catch (eSh) {}
    var need = Math.min(size, 24);
    var searchJobs = kws.slice(0, 5).map(function (kw) {
      return withT(searchSongs(kw), 4200).then(function (list) {
        (list || []).forEach(function (s) {
          if (out.length >= size) return;
          pushSong(s);
        });
        return list;
      });
    });
    // 榜单兜底（与猜你喜欢同源，速度快）
    var chartJob = withT((async function () {
      try {
        if (typeof fetchRecommendFromCharts === "function") {
          var rec = await fetchRecommendFromCharts(Math.max(16, size)).catch(function () { return []; });
          if (rec && rec.length) return rec;
        }
      } catch (e0) {}
      try {
        if (typeof fetchToplistOverview === "function") {
          var boards = await fetchToplistOverview().catch(function () { return []; });
          if (boards && boards.length) {
            var b = boards[Math.floor(Math.random() * Math.min(boards.length, 4))];
            var pack = await fetchToplistDetail(b.topId || b.id, b.source || S.platform || "qq", b).catch(function () { return null; });
            return (pack && pack.songs) || [];
          }
        }
      } catch (e1) {}
      return [];
    })(), 5000).then(function (list) {
      (list || []).forEach(function (s) {
        if (out.length >= size) return;
        pushSong(s);
      });
      return list;
    });

    try {
      await Promise.all(searchJobs.concat([chartJob]).map(function (p) {
        return Promise.resolve(p).catch(function () { return null; });
      }));
    } catch (eAll) {}

    // 仍不足：再补 2 组搜索
    if (out.length < 8) {
      var moreKw = kws.slice(5, 9);
      await Promise.all(moreKw.map(function (kw) {
        return withT(searchSongs(kw), 4000).then(function (list) {
          (list || []).forEach(function (s) {
            if (out.length >= size) return;
            pushSong(s);
          });
        });
      }));
    }
    // 猜你喜欢池借一点（保证绝不空白）
    if (out.length < 6 && S.guessList && S.guessList.length) {
      S.guessList.forEach(function (s) {
        if (out.length >= need) return;
        pushSong(s);
      });
    }
    if (out.length < 6 && S_guessPool && S_guessPool.length) {
      S_guessPool.forEach(function (s) {
        if (out.length >= need) return;
        pushSong(s);
      });
    }
    try {
      for (var i2 = out.length - 1; i2 > 0; i2--) {
        var j2 = Math.floor(Math.random() * (i2 + 1));
        var t2 = out[i2]; out[i2] = out[j2]; out[j2] = t2;
      }
    } catch (eSh2) {}
    return out.slice(0, size);
  }

  /* ========== Hero 轮播（兼容） ========== */
  var heroTimer = null;
  function renderHeroCarousel(list) {
    // 兼容旧调用：整表当猜你喜欢，雷达用打乱副本
    var g = (list || []).slice();
    var r = shuffle(g.slice());
    renderTopDuo(g, r);
    return;
    var track = $("#featureTrack");

  }

  /* ========== 音质：从按钮向上弹出 ========== */
  var _sleepTimer = null;
  function clearSleepTimer() {
    if (_sleepTimer) { try { clearTimeout(_sleepTimer); } catch (e) {} _sleepTimer = null; }
    S.sleepUntil = 0;
    S.sleepAfterTrack = false;
  }
  function armSleepMinutes(mins) {
    clearSleepTimer();
    if (!mins || mins <= 0) {
      syncSleepBtn();
      toast("已取消定时");
      return;
    }
    S.sleepUntil = Date.now() + mins * 60 * 1000;
    S.sleepAfterTrack = false;
    _sleepTimer = setTimeout(function () {
      _sleepTimer = null;
      S.sleepUntil = 0;
      try { audio.pause(); } catch (e) {}
      setPlaying(false);
      syncSleepBtn();
      toast("定时关闭：已停止播放");
    }, mins * 60 * 1000);
    syncSleepBtn();
    toast("定时 " + mins + " 分钟后关闭");
  }
  function armSleepAfterTrack() {
    clearSleepTimer();
    S.sleepAfterTrack = true;
    S.sleepUntil = 0;
    syncSleepBtn();
    toast("播完本首后关闭");
  }
  function syncSleepBtn() {
    var lab = $("#npSleepLabel");
    var btn = $("#npSleep");
    var on = !!(S.sleepAfterTrack || (S.sleepUntil && S.sleepUntil > Date.now()));
    if (btn) btn.classList.toggle("has-timer", on);
    if (!lab) return;
    if (S.sleepAfterTrack) {
      lab.textContent = "本首后";
      return;
    }
    if (S.sleepUntil && S.sleepUntil > Date.now()) {
      var left = Math.max(1, Math.ceil((S.sleepUntil - Date.now()) / 60000));
      lab.textContent = left + "分";
      return;
    }
    lab.textContent = "定时";
  }
  function openSleepSheet() {
    var box = $("#qPopOpts");
    var pop = $("#qPop");
    var mask = $("#qPopMask");
    if (!box || !pop || !mask) return;
    var opts = [
      { id: "off", label: "关闭定时", sub: "取消倒计时" },
      { id: "15", label: "15 分钟", sub: "" },
      { id: "30", label: "30 分钟", sub: "" },
      { id: "45", label: "45 分钟", sub: "" },
      { id: "60", label: "60 分钟", sub: "" },
      { id: "track", label: "播完本首", sub: "本曲结束后停止" },
    ];
    box.innerHTML = "";
    var title = document.createElement("div");
    title.style.cssText = "font-size:12px;color:var(--label-3);padding:6px 12px 4px;font-weight:600";
    title.textContent = "定时关闭";
    box.appendChild(title);
    opts.forEach(function (o) {
      var b = document.createElement("button");
      b.type = "button";
      var active = false;
      if (o.id === "off") active = !S.sleepAfterTrack && !(S.sleepUntil && S.sleepUntil > Date.now());
      else if (o.id === "track") active = !!S.sleepAfterTrack;
      else if (S.sleepUntil && S.sleepUntil > Date.now() && !S.sleepAfterTrack) {
        var leftM = Math.ceil((S.sleepUntil - Date.now()) / 60000);
        var want = parseInt(o.id, 10);
        active = Math.abs(leftM - want) <= 1 && leftM <= want;
      }
      b.className = "q-opt" + (active ? " on" : "");
      b.innerHTML = "<span><div>" + o.label + "</div>" +
        (o.sub ? "<div class=\"q-sub\">" + o.sub + "</div>" : "") +
        "</span><span class=\"q-check\">✓</span>";
      b.onclick = function (e) {
        e.stopPropagation();
        if (o.id === "off") clearSleepTimer(), syncSleepBtn(), toast("已取消定时");
        else if (o.id === "track") armSleepAfterTrack();
        else armSleepMinutes(parseInt(o.id, 10));
        closeQualitySheet();
      };
      box.appendChild(b);
    });
    var anchor = $("#npSleep");
    // 先清掉音质弹层可能留下的 top/bottom，避免错位叠在屏幕外
    try {
      pop.style.left = "";
      pop.style.top = "";
      pop.style.bottom = "";
      pop.style.width = "";
      pop.style.transformOrigin = "";
    } catch (eClr) {}
    mask.classList.add("open");
    // 定位在定时按钮上方（同音质弹窗）
    try {
      var r = anchor ? anchor.getBoundingClientRect() : null;
      var pw = 180;
      if (r) {
        var left = Math.min(window.innerWidth - pw - 12, Math.max(12, r.left + r.width / 2 - pw / 2));
        var top = Math.max(12, r.top - 8);
        pop.style.left = left + "px";
        pop.style.width = pw + "px";
        pop.style.bottom = (window.innerHeight - top) + "px";
        pop.style.top = "auto";
        pop.style.transformOrigin = "bottom center";
      }
    } catch (ePos) {}
    pop.classList.add("open");
  }

  /* —— 播放页底栏 · 切换音源与平台 —— */
  var _srcSwitchBusy = false;
  function closeNpMorePop() {
    var mask = $("#qPopMask");
    var pop = $("#npMorePop");
    if (pop) {
      pop.classList.remove("open");
      try {
        pop.style.left = "";
        pop.style.top = "";
        pop.style.right = "";
      } catch (e) {}
    }
    // 仅当音质弹层也未开时关 mask
    var qPop = $("#qPop");
    if (mask && (!qPop || !qPop.classList.contains("open"))) {
      mask.classList.remove("open");
    }
  }
  function openNpMorePop() {
    var pop = $("#npMorePop");
    var mask = $("#qPopMask");
    var anchor = $("#npMore");
    if (!pop || !mask || !anchor) return;
    try { syncNpSrcLabel(); } catch (eLbl2) {}
    // 关掉音质弹层避免叠层
    try { closeQualitySheet(); } catch (e0) {}
    pop.style.visibility = "hidden";
    pop.classList.add("open");
    var ph = pop.offsetHeight || 48;
    var pw = pop.offsetWidth || 148;
    pop.classList.remove("open");
    pop.style.visibility = "";
    var r = anchor.getBoundingClientRect();
    // 从底栏按钮向上弹出并水平居中对齐
    var left = r.left + r.width / 2 - pw / 2;
    left = Math.max(10, Math.min(left, window.innerWidth - pw - 10));
    var top = r.top - ph - 10;
    if (top < 8) top = Math.min(r.bottom + 8, window.innerHeight - ph - 12);
    pop.style.left = left + "px";
    pop.style.top = top + "px";
    mask.classList.add("open");
    requestAnimationFrame(function () { pop.classList.add("open"); });
  }
  function toggleNpMorePop() {
    var pop = $("#npMorePop");
    if (pop && pop.classList.contains("open")) closeNpMorePop();
    else openNpMorePop();
  }

  /** 切到指定音源；不传则按列表轮换到下一个。
   *  目标源拿不到目标音质/播不了时，会自动继续试其它已启用源 */
  async function cycleSongSource(targetId) {
    if (_srcSwitchBusy) return;
    var song = S.queue && S.queue[S.idx];
    if (!song) { toast("没有在播歌曲"); return; }
    var mid = typeof cleanPlayMid === "function" ? cleanPlayMid(song) : (song.songmid || song.mid || song.id);
    if (!mid) { toast("缺少歌曲 ID，无法换源"); return; }

    var songPlat = (song && song.source) || S.platform || "qq";
    var all = (S.sources || []).filter(function (s) { return s && s.enabled !== false; });
    if (!all.length) { toast("没有已启用的音源"); return; }

    // 优先同平台声明的源；不够再扩到全部已启用
    var chain = all.filter(function (s) {
      var ps = srcPlatforms(s);
      if (!ps.length) return true;
      return ps.indexOf("all") >= 0 || ps.indexOf(songPlat) >= 0 || s.platform === "all" || s.platform === songPlat;
    });
    if (chain.length < 1) chain = all.slice();

    var lastId = (song && song._playSrcId) || S.playSrcId || "";
    // 指定源优先；其余按列表顺序作为「拿不到就自动切」的备选
    var ordered = [];
    var j;
    if (targetId) {
      for (j = 0; j < chain.length; j++) {
        if ((chain[j].id || chain[j].name) === targetId) { ordered.push(chain[j]); break; }
      }
    }
    for (j = 0; j < chain.length; j++) {
      var cid = chain[j].id || chain[j].name || "";
      if (targetId && cid === targetId) continue;
      ordered.push(chain[j]);
    }
    if (!ordered.length) ordered = chain.slice();
    if (!targetId) {
      var startIdx = 0;
      for (j = 0; j < ordered.length; j++) {
        if ((ordered[j].id || ordered[j].name) === lastId) { startIdx = (j + 1) % ordered.length; break; }
      }
      ordered = ordered.slice(startIdx).concat(ordered.slice(0, startIdx));
    }

    _srcSwitchBusy = true;
    closeNpMorePop();
    toast("正在切换音源…");
    var wantQ = S.playQ || S.quality || "flac";
    var qChain = (S.autoQDowngrade !== false && typeof qualityFallbacks === "function")
      ? qualityFallbacks(wantQ) : [wantQ];
    var keepT = 0;
    try { keepT = audio.currentTime || 0; } catch (eT) {}
    var keepRate = Number(audio.playbackRate) || 1;
    var tried = 0;

    try {
      // 音质优先、音源次之：先尽量保住目标音质，目标源不行就换源，最后才降档
      for (var qi = 0; qi < qChain.length; qi++) {
        var q = qChain[qi];
        for (var n = 0; n < ordered.length; n++) {
          var src = ordered[n];
          var srcId = src.id || src.name || ("src" + n);
          // 轮换时跳过当前源；指定源不跳
          if (!targetId && ordered.length > 1 && srcId === lastId && n === 0) continue;
          var url = null;
          try {
            url = await resolveBySource(src, Object.assign({}, song), mid, q);
          } catch (eR) { url = null; }
          if (!url || !/^https?:\/\//i.test(String(url))) continue;
          // 严格档位校验（与播放一致，软放行 flac 顶替母带）
          try {
            if (typeof qualityUrlPass === "function" && !qualityUrlPass(url, q)) {
              var act = typeof detectQualityFromUrl === "function" ? detectQualityFromUrl(url) : "";
              var soft = (q === "master" || q === "hires" || q === "flac24bit") && act === "flac";
              if (!soft && act && typeof qualityMeets === "function" && !qualityMeets(act, q)) continue;
            }
          } catch (eQ) {}

          tried++;
          try {
            audio.removeAttribute("crossorigin");
            audio.src = String(url);
            try { audio.playbackRate = keepRate; } catch (eR2) {}
            await audio.play();
            // 尽量回到原进度（换源常不支持 seek 到同一位置，失败忽略）
            try {
              if (keepT > 2 && isFinite(keepT)) {
                var onMeta = function () {
                  try { if (audio.duration && keepT < audio.duration - 1) audio.currentTime = keepT; } catch (eS) {}
                  audio.removeEventListener("loadedmetadata", onMeta);
                };
                audio.addEventListener("loadedmetadata", onMeta);
                try { if (audio.duration && keepT < audio.duration - 1) audio.currentTime = keepT; } catch (eS2) {}
              }
            } catch (eSeek) {}
            setPlaying(true);
            S.playSrcId = srcId;
            if (song) song._playSrcId = srcId;
            var detSw = (typeof detectQualityFromUrl === "function") ? detectQualityFromUrl(url) : null;
            var realQ = detSw || ((q === "master" || q === "hires" || q === "flac24bit") ? "flac" : q);
            S.playQ = realQ;
            if (typeof setPlayQDisplay === "function") setPlayQDisplay(realQ);
            else { var nq = $("#npQ"); if (nq) nq.textContent = typeof qLabel === "function" ? qLabel(realQ) : realQ; }
            toast("已切换：" + (src.name || srcId));
            try { syncNpSrcLabel(); } catch (eLbl) {}
            return;
          } catch (ePlay) {
            console.warn("[switchSrc] play fail", src.name, ePlay);
          }
        }
      }
      toast(tried ? "其它音源暂不可播" : "未找到可播音源");
    } finally {
      _srcSwitchBusy = false;
    }
  }

  var _platSwitchBusy = false;
  var PLAT_CYCLE = [
    { id: "qq", name: "QQ" },
    { id: "netease", name: "网易" },
    { id: "kuwo", name: "酷我" },
    { id: "kugou", name: "酷狗" },
    { id: "migu", name: "咪咕" },
  ];

  async function searchOnPlatform(plat, kw) {
    kw = String(kw || "").trim();
    if (!kw) return [];
    try {
      if (plat === "netease") return (await searchNetease(kw, 1)) || [];
      if (plat === "kuwo") return (await searchKuwo(kw, 1)) || [];
      if (plat === "kugou") return (await searchKugou(kw, 1)) || [];
      if (plat === "migu") return (await searchMigu(kw, 1)) || [];
      return (await searchQQ(kw)) || [];
    } catch (e) {
      console.warn("[switchPlat] search fail", plat, e);
      return [];
    }
  }

  /** 当前歌曲换平台：按歌名+歌手在下一站搜同源再播（QQ 不行 → 网易 → …） */
  async function cycleSongPlatform() {
    if (_platSwitchBusy || _srcSwitchBusy) return;
    var song = S.queue && S.queue[S.idx];
    if (!song || !song.name) { toast("没有在播歌曲"); return; }

    var curPlat = String((song.source || S.platform || "qq")).toLowerCase();
    if (curPlat === "wy" || curPlat === "netease") curPlat = "netease";
    else if (curPlat === "kw") curPlat = "kuwo";
    else if (curPlat === "kg") curPlat = "kugou";
    else if (curPlat === "mg") curPlat = "migu";
    else if (curPlat === "tx") curPlat = "qq";
    else if (["qq", "netease", "kuwo", "kugou", "migu"].indexOf(curPlat) < 0) curPlat = "qq";

    var startIdx = 0;
    for (var i = 0; i < PLAT_CYCLE.length; i++) {
      if (PLAT_CYCLE[i].id === curPlat) { startIdx = (i + 1) % PLAT_CYCLE.length; break; }
    }

    _platSwitchBusy = true;
    closeNpMorePop();
    toast("正在切换平台…");
    var kw = (song.name + " " + (song.artist || "")).trim();
    var kw2 = String(song.name || "").trim();
    var keepT = 0;
    try { keepT = audio.currentTime || 0; } catch (eT) {}

    try {
      for (var n = 0; n < PLAT_CYCLE.length; n++) {
        var p = PLAT_CYCLE[(startIdx + n) % PLAT_CYCLE.length];
        if (p.id === curPlat && PLAT_CYCLE.length > 1) continue;

        var list = await searchOnPlatform(p.id, kw);
        if ((!list || !list.length) && kw2 && kw2 !== kw) {
          list = await searchOnPlatform(p.id, kw2);
        }
        var best = null;
        try {
          best = typeof pickBestLyricMatch === "function" ? pickBestLyricMatch(list, song) : null;
        } catch (eM) { best = null; }
        if (!best && list && list.length) {
          // 宽松兜底：同名优先
          var name0 = String(song.name || "").toLowerCase().replace(/\s+/g, "");
          for (var j = 0; j < list.length; j++) {
            var nm = String(list[j].name || "").toLowerCase().replace(/\s+/g, "");
            if (nm === name0 || (nm && name0 && (nm.indexOf(name0) >= 0 || name0.indexOf(nm) >= 0))) {
              best = list[j];
              break;
            }
          }
          if (!best) best = list[0];
        }
        if (!best || !(best.songmid || best.id || best.mid)) continue;

        var nextSong = Object.assign({}, best);
        nextSong.source = p.id;
        if (!nextSong.songmid) nextSong.songmid = nextSong.mid || nextSong.id;
        // 写入队列当前位置，后续切源/歌词走新平台
        try {
          if (S.queue && S.idx >= 0) {
            S.queue[S.idx] = nextSong;
          }
        } catch (eQ) {}
        song._playSrcId = "";
        S.playSrcId = "";

        try {
          // 用统一 play 走完整解析链
          await play(nextSong, S.queue);
          // 尽量恢复进度
          try {
            if (keepT > 2 && isFinite(keepT)) {
              var onMeta = function () {
                try {
                  if (audio.duration && keepT < audio.duration - 1) audio.currentTime = keepT;
                } catch (eS) {}
                audio.removeEventListener("loadedmetadata", onMeta);
              };
              audio.addEventListener("loadedmetadata", onMeta);
            }
          } catch (eSeek) {}
          toast("已切换平台：" + p.name);
          return;
        } catch (ePlay) {
          console.warn("[switchPlat] play fail", p.id, ePlay);
        }
      }
      toast("其它平台暂无此曲");
    } finally {
      _platSwitchBusy = false;
    }
  }

  /* ========== 播放页：音源文件信息 ========== */
  var _npInfoSeq = 0;
  var _npInfoUrl = "";

  function npFmtBytes(n) {
    n = Number(n) || 0;
    if (n <= 0) return "—";
    var units = ["B", "KB", "MB", "GB"];
    var i = 0, v = n;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    var txt = i === 0 ? String(Math.round(v)) : (v >= 100 ? v.toFixed(0) : v.toFixed(1));
    return txt + " " + units[i];
  }
  function npFmtDur(t) {
    t = Number(t) || 0;
    if (!(t > 0) || !isFinite(t)) return "—";
    var m = Math.floor(t / 60), s = Math.round(t % 60);
    if (s === 60) { m++; s = 0; }
    return m + ":" + String(s).padStart(2, "0");
  }
  function npUrlBare(url) {
    try { var u = new URL(String(url), location.href); return u.origin + u.pathname; }
    catch (e) { return String(url || "").split("?")[0].split("#")[0]; }
  }
  var NP_FMT_EXT = { mp3: "MP3", flac: "FLAC", m4a: "M4A", mp4: "MP4", aac: "AAC", ape: "APE", wav: "WAV", ogg: "OGG", oga: "OGG", opus: "OPUS", wma: "WMA", dff: "DFF", dsf: "DSF", m4b: "M4A", ts: "TS" };
  function npFmtLabel(mime, url) {
    var m = String(mime || "").toLowerCase();
    if (m.indexOf("flac") >= 0) return "FLAC";
    if (m.indexOf("mp4") >= 0 || m.indexOf("m4a") >= 0 || m.indexOf("aac") >= 0) return "M4A / AAC";
    if (m.indexOf("mpeg") >= 0 || m.indexOf("mp3") >= 0) return "MP3";
    if (m.indexOf("wav") >= 0) return "WAV";
    if (m.indexOf("opus") >= 0) return "OPUS";
    if (m.indexOf("ogg") >= 0) return "OGG";
    if (m.indexOf("ape") >= 0) return "APE";
    if (m.indexOf("mp2t") >= 0) return "TS";
    if (/^blob:/i.test(String(url || ""))) return "内嵌流（blob）";
    var path = npUrlBare(url).toLowerCase();
    var mm = path.match(/\.([a-z0-9]{2,5})$/);
    if (mm && NP_FMT_EXT[mm[1]]) return NP_FMT_EXT[mm[1]];
    return mm ? mm[1].toUpperCase() : "未知";
  }
  function npProbeHeaders(song) {
    var plat = String((song && song.source) || S.platform || "qq").toLowerCase();
    var map = {
      qq: "https://y.qq.com/",
      netease: "https://music.163.com/",
      kugou: "https://www.kugou.com/",
      kuwo: "https://www.kuwo.cn/",
      migu: "https://music.migu.cn/",
      bilibili: "https://www.bilibili.com/",
      bili: "https://www.bilibili.com/",
    };
    var ref = map[plat] || "";
    return ref ? { Referer: ref } : {};
  }
  function npInfoContext(song, url) {
    var dur = 0;
    try { dur = (audio && isFinite(audio.duration)) ? audio.duration : 0; } catch (eD) {}
    if (!dur) dur = Number(song && song.interval) || 0;
    var srcId = S.playSrcId || (song && song._playSrcId) || "";
    var srcName = "";
    if (srcId) {
      var hit = (S.sources || []).find(function (s) { return s && (s.id === srcId || s.name === srcId); });
      srcName = hit ? (hit.name || hit.id) : srcId;
    }
    var wantQ = S.quality || "";
    var realQ = S.playQ || "";
    var qLab = function (v) { return (typeof qLabel === "function" ? qLabel(v) : v) || "—"; };
    var qTxt = "—";
    if (realQ) qTxt = qLab(realQ) + (wantQ && realQ !== wantQ ? "（请求 " + qLab(wantQ) + "）" : "");
    else if (wantQ) qTxt = qLab(wantQ);
    return {
      url: url,
      dur: dur,
      title: ((song && song.name) || "—") + ((song && song.artist) ? " · " + song.artist : ""),
      platform: (typeof srcLabelOf === "function" ? srcLabelOf(song) : ((song && song.source) || "—")),
      srcName: srcName || "—",
      quality: qTxt,
      format: npFmtLabel("", url),
      mime: "",
      size: "—",
      bitrate: "—",
      status: 0,
      rangeOk: false,
      note: "",
    };
  }
  function npInfoRows(ctx) {
    var rows = [
      ["歌曲", ctx.title, false],
      ["平台", ctx.platform || "—", false],
      ["音源", ctx.srcName || "—", false],
      ["音质", ctx.quality || "—", false],
      ["格式", ctx.format || "—", false],
      ["体积", ctx.size || "—", false],
      ["时长", npFmtDur(ctx.dur), false],
      ["平均码率", ctx.bitrate || "—", false],
    ];
    if (ctx.mime) rows.push(["MIME", ctx.mime, true]);
    if (ctx.status) rows.push(["HTTP", String(ctx.status) + (ctx.rangeOk ? " · 支持 Range" : ""), false]);
    if (ctx.note) rows.push(["提示", ctx.note, false, true]);
    if (ctx.url) rows.push(["地址", ctx.url, true]);
    return rows;
  }
  function npRenderInfo(rows) {
    var box = $("#npInfoBody");
    if (!box) return;
    box.innerHTML = "";
    rows.forEach(function (r) {
      var row = document.createElement("div");
      row.className = "np-info-row";
      var k = document.createElement("span");
      k.className = "np-info-k";
      k.textContent = r[0];
      var v = document.createElement("span");
      v.className = "np-info-v" + (r[2] ? " mono" : "") + (r[3] ? " warn" : "");
      v.textContent = r[1];
      row.appendChild(k);
      row.appendChild(v);
      box.appendChild(row);
    });
  }
  function closeNpFileInfo() {
    _npInfoSeq++;
    var mask = $("#npInfoMask");
    if (!mask) return;
    mask.classList.remove("open");
    mask.setAttribute("aria-hidden", "true");
  }
  function openNpFileInfo() {
    var mask = $("#npInfoMask");
    if (!mask) return;
    var song = null;
    try { song = (S.queue && S.idx >= 0) ? S.queue[S.idx] : null; } catch (e0) {}
    var url = "";
    try { url = String(audio.currentSrc || audio.src || ""); } catch (e1) {}
    if (!song || !url) { toast("当前没有正在播放的音频"); return; }

    var ctx = npInfoContext(song, url);
    _npInfoUrl = url;
    var seq = ++_npInfoSeq;
    function paint() { npRenderInfo(npInfoRows(ctx)); }
    paint();
    mask.classList.add("open");
    mask.setAttribute("aria-hidden", "false");

    if (/^blob:/i.test(url)) {
      ctx.note = "内嵌流播放（blob），无法探测远端体积";
      paint();
      return;
    }
    if (!/^https?:/i.test(url)) {
      ctx.note = "非网络地址，无法探测体积";
      paint();
      return;
    }

    // 异步探测体积 / 格式 / 状态，拿到后刷新面板
    (async function () {
      var got = null;
      try {
        if (typeof window.__aqMediaInfo === "function") {
          got = await window.__aqMediaInfo(url, npProbeHeaders(song));
        }
      } catch (e2) { got = null; }

      if (!got || !got.ok) {
        try {
          var r = await fetch(url, { method: "HEAD" });
          if (r && r.ok) {
            got = {
              ok: true,
              status: r.status,
              finalUrl: r.url || url,
              mime: (r.headers && r.headers.get("content-type")) || "",
              length: Number((r.headers && r.headers.get("content-length")) || 0) || 0,
              acceptRanges: (r.headers && r.headers.get("accept-ranges")) || "",
            };
          }
        } catch (e3) {}
      }
      if (seq !== _npInfoSeq) return;

      if (got && got.ok) {
        if (got.finalUrl) { ctx.url = String(got.finalUrl); _npInfoUrl = ctx.url; }
        ctx.mime = String(got.mime || "");
        ctx.format = npFmtLabel(ctx.mime, ctx.url);
        var len = Number(got.length) || 0;
        if (len > 0) {
          ctx.size = npFmtBytes(len);
          if (ctx.dur > 0) ctx.bitrate = Math.round(len * 8 / ctx.dur / 1000) + " kbps";
        } else {
          ctx.size = "未知";
        }
        ctx.status = Number(got.status) || 0;
        ctx.rangeOk = !!(got.acceptRanges && /bytes/i.test(String(got.acceptRanges)));
        var m = ctx.mime.toLowerCase();
        var q = String(S.playQ || "").toLowerCase();
        if (m && /mpeg|mp3/.test(m) && /flac|hires|master|flac24bit/.test(q)) {
          ctx.note = "实际编码为 MP3，与所标音质不符";
        }
      } else {
        ctx.size = "未知";
        ctx.note = ctx.note || "服务端未返回体积信息（可能不支持 HEAD）";
      }
      paint();
    })();
  }
  function npCopyUrl() {
    if (!_npInfoUrl) { toast("暂无可复制的地址"); return; }
    function fallback() {
      try {
        var ta = document.createElement("textarea");
        ta.value = _npInfoUrl;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        var ok = false;
        try { ok = document.execCommand("copy"); } catch (eC) {}
        document.body.removeChild(ta);
        toast(ok ? "已复制音源地址" : "复制失败");
      } catch (e) { toast("复制失败"); }
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(_npInfoUrl).then(function () {
          toast("已复制音源地址");
        }).catch(fallback);
        return;
      }
    } catch (e) {}
    fallback();
  }

  /* ========== 音源选择（切源 / 默认音源） ========== */
  var _srcPickMode = "switch";
  function srcNameById(id) {
    if (!id) return "";
    var hit = (S.sources || []).find(function (x) { return x && (x.id === id || x.name === id); });
    return hit ? (hit.name || hit.id) : "";
  }
  function srcPlatLabel(src) {
    var ps = srcPlatforms(src);
    if (!ps.length) return "未声明平台";
    return ps.map(function (p) {
      return (typeof PLATFORM_LABEL !== "undefined" && PLATFORM_LABEL[p]) || p;
    }).join(" / ");
  }
  function syncNpSrcLabel() {
    var el = $("#npSrcBtnLabel");
    if (!el) return;
    var song = null;
    try { song = (S.queue && S.idx >= 0) ? S.queue[S.idx] : null; } catch (eS) {}
    var id = (song && song._playSrcId) || S.playSrcId || "";
    var nm = srcNameById(id);
    el.textContent = nm ? ("音源 · " + nm) : "音源";
  }
  function syncDefaultSrcLabel() {
    var btn = $("#btnPickDefaultSrc");
    if (!btn) return;
    btn.textContent = srcNameById(S.defaultSrcId || "") || "自动";
  }
  function mkSrcRow(o) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "np-src-item" + (o.current ? " is-current" : "") + (o.disabled ? " is-disabled" : "");
    var main = document.createElement("div");
    main.className = "np-src-item-main";
    var nm = document.createElement("div");
    nm.className = "np-src-item-name";
    var t = document.createElement("span");
    t.textContent = o.name;
    nm.appendChild(t);
    if (o.current) {
      var bd = document.createElement("span");
      bd.className = "np-src-badge";
      bd.textContent = _srcPickMode === "default" ? "默认" : "使用中";
      nm.appendChild(bd);
    }
    main.appendChild(nm);
    if (o.sub) {
      var sb = document.createElement("div");
      sb.className = "np-src-item-sub";
      sb.textContent = o.sub;
      main.appendChild(sb);
    }
    b.appendChild(main);
    if (o.current) {
      var ck = document.createElement("span");
      ck.className = "np-src-check";
      ck.textContent = "✓";
      b.appendChild(ck);
    }
    b.addEventListener("click", function () {
      if (o.disabled) { toast("该音源已禁用，请先在设置里启用"); return; }
      pickSource(o.id);
    });
    return b;
  }
  function renderSrcPicker() {
    var box = $("#npSrcList");
    if (!box) return;
    box.innerHTML = "";
    var song = null;
    try { song = (S.queue && S.idx >= 0) ? S.queue[S.idx] : null; } catch (eR) {}
    var curId = (song && song._playSrcId) || S.playSrcId || "";
    var defId = S.defaultSrcId || "";

    if (_srcPickMode === "default") {
      box.appendChild(mkSrcRow({
        id: "",
        name: "自动（按列表顺序）",
        sub: "不指定默认源，按音源列表顺序尝试",
        current: !defId,
        disabled: false,
      }));
    }
    (S.sources || []).forEach(function (src) {
      if (!src) return;
      var id = src.id || src.name || "";
      var isCur = _srcPickMode === "switch" ? (id === curId) : (id === defId);
      var sub = srcPlatLabel(src);
      if (src.enabled === false) sub += " · 已禁用";
      box.appendChild(mkSrcRow({
        id: id,
        name: src.name || id,
        sub: sub,
        current: isCur,
        disabled: _srcPickMode === "switch" && src.enabled === false,
      }));
    });
  }
  function openSrcPicker(mode) {
    _srcPickMode = mode === "default" ? "default" : "switch";
    var mask = $("#npSrcMask");
    var box = $("#npSrcList");
    var title = $("#npSrcTitle");
    if (!mask || !box) return;
    if (title) title.textContent = _srcPickMode === "default" ? "默认音源" : "选择音源";
    renderSrcPicker();
    mask.classList.add("open");
    mask.setAttribute("aria-hidden", "false");
  }
  function closeSrcPicker() {
    var mask = $("#npSrcMask");
    if (!mask) return;
    mask.classList.remove("open");
    mask.setAttribute("aria-hidden", "true");
  }
  function pickSource(id) {
    if (_srcPickMode === "default") {
      applyDraft(function () { S.defaultSrcId = String(id || ""); });
      syncDefaultSrcLabel();
      closeSrcPicker();
      var nm = srcNameById(id);
      toast(nm ? ("默认音源：" + nm) : "默认音源：自动");
      return;
    }
    closeSrcPicker();
    if (!id) return;
    cycleSongSource(id).catch(function (eSw) {
      console.warn(eSw);
      toast("切换失败");
      _srcSwitchBusy = false;
    });
  }

  function bindNpMore() {
    var more = $("#npMore");
    if (more && !more._bound) {
      more._bound = true;
      var onMore = withTapLock("npMore", 350, function () { toggleNpMorePop(); });
      more.addEventListener("click", onMore);
      more.addEventListener("touchend", onMore, { passive: false });
    }
    var sw = $("#npSwitchSrc");
    if (sw && !sw._bound) {
      sw._bound = true;
      var onSw = withTapLock("npSwitchSrc", 500, function () {
        closeNpMorePop();
        openSrcPicker("switch");
      });
      sw.addEventListener("click", onSw);
      sw.addEventListener("touchend", onSw, { passive: false });
    }
    var srcMask = $("#npSrcMask");
    if (srcMask && !srcMask._bound) {
      srcMask._bound = true;
      srcMask.addEventListener("click", function (ev) {
        if (ev && ev.target && ev.target.closest && ev.target.closest(".np-info-card")) return;
        closeSrcPicker();
      });
    }
    var srcClose = $("#npSrcClose");
    if (srcClose && !srcClose._bound) {
      srcClose._bound = true;
      srcClose.addEventListener("click", function () { closeSrcPicker(); });
    }
    var sp = $("#npSwitchPlat");
    if (sp && !sp._bound) {
      sp._bound = true;
      var onSp = withTapLock("npSwitchPlat", 600, function () {
        cycleSongPlatform().catch(function (e) {
          console.warn(e);
          toast("切换平台失败");
          _platSwitchBusy = false;
        });
      });
      sp.addEventListener("click", onSp);
      sp.addEventListener("touchend", onSp, { passive: false });
    }
    var lyBtn = $("#npRematchLyric");
    if (lyBtn && !lyBtn._bound) {
      lyBtn._bound = true;
      var onLy = withTapLock("npRematchLyric", 800, function () {
        rematchLyrics().catch(function (e) {
          console.warn(e);
          toast("匹配歌词失败");
          _lyricRematchBusy = false;
        });
      });
      lyBtn.addEventListener("click", onLy);
      lyBtn.addEventListener("touchend", onLy, { passive: false });
    }
    var info = $("#npFileInfo");
    if (info && !info._bound) {
      info._bound = true;
      var onInfo = withTapLock("npFileInfo", 400, function () { openNpFileInfo(); });
      info.addEventListener("click", onInfo);
      info.addEventListener("touchend", onInfo, { passive: false });
    }
    var infoMask = $("#npInfoMask");
    if (infoMask && !infoMask._bound) {
      infoMask._bound = true;
      infoMask.addEventListener("click", function (ev) {
        if (ev && ev.target && ev.target.closest && ev.target.closest(".np-info-card")) return;
        closeNpFileInfo();
      });
    }
    var infoClose = $("#npInfoClose");
    if (infoClose && !infoClose._bound) {
      infoClose._bound = true;
      infoClose.addEventListener("click", function () { closeNpFileInfo(); });
    }
    var infoCopy = $("#npInfoCopy");
    if (infoCopy && !infoCopy._bound) {
      infoCopy._bound = true;
      infoCopy.addEventListener("click", function () { npCopyUrl(); });
    }
    // 点遮罩关：与音质共用 qPopMask
    var mask = $("#qPopMask");
    if (mask && !mask._npMoreBound) {
      mask._npMoreBound = true;
      mask.addEventListener("click", function () {
        try {
          if (typeof dismissNpToolPops === "function") dismissNpToolPops();
          else closeNpMorePop();
        } catch (e) { closeNpMorePop(); }
      });
    }
  }

    function openQualitySheet() {
    var box = $("#qPopOpts");
    var pop = $("#qPop");
    var mask = $("#qPopMask");
    var anchor = $("#npQuality");
    if (!box || !pop || !mask) return;
    box.innerHTML = "";
    var opts = [
      { q: "128k", name: "标准", sub: "128k" },
      { q: "192k", name: "较高", sub: "192k" },
      { q: "320k", name: "高品", sub: "320k MP3" },
      { q: "flac", name: "无损", sub: "FLAC" },
      { q: "hires", name: "Hi-Res", sub: "高解析" },
      { q: "master", name: "母带", sub: "Master" },
    ];
    opts.forEach(function (o) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "q-opt" + (S.quality === o.q ? " on" : "");
      b.innerHTML =
        '<div><div>' + o.name + '</div><div class="q-sub">' + o.sub + "</div></div>" +
        '<span class="q-check">✓</span>';
      b.onclick = function (e) {
        e.stopPropagation();
        S.quality = o.q;
        persistSetting("aq_q", S.quality);
        syncSeg();
        closeQualitySheet();
        toast("已设为" + o.name);
        if (S.queue[S.idx] && audio.src) {
          play(S.queue[S.idx], S.queue);
        }
      };
      box.appendChild(b);
    });
    // 定位到音质按钮上方
    if (anchor) {
      var r = anchor.getBoundingClientRect();
      pop.style.visibility = "hidden";
      pop.classList.add("open");
      var ph = pop.offsetHeight || 180;
      var pw = pop.offsetWidth || 168;
      pop.classList.remove("open");
      pop.style.visibility = "";
      var left = r.left + r.width / 2 - pw / 2;
      left = Math.max(10, Math.min(left, window.innerWidth - pw - 10));
      var top = r.top - ph - 8;
      if (top < 8) top = r.bottom + 8;
      pop.style.left = left + "px";
      pop.style.top = top + "px";
      pop.style.bottom = "auto";
    }
    mask.classList.add("open");
    requestAnimationFrame(function () {
      pop.classList.add("open");
    });
  }
  function closeQualitySheet() {
    var m = $("#qPopMask");
    var p = $("#qPop");
    var morePop = $("#npMorePop");
    if (morePop) morePop.classList.remove("open");
    if (m) m.classList.remove("open");
    if (p) {
      p.classList.remove("open");
      // 清掉定位，避免下次音质/定时弹层错位
      try {
        p.style.left = "";
        p.style.top = "";
        p.style.bottom = "";
        p.style.width = "";
        p.style.visibility = "";
        p.style.transformOrigin = "";
      } catch (eClr) {}
    }
  }

  var HERO_KW = ["流行金曲", "华语经典", "热门单曲", "新歌推荐", "怀旧金曲", "情歌对唱"];
  /* 为你推荐：主链路已改为热歌榜+新歌榜（fetchRecommendFromCharts）
     REC_KW 仅作榜单全空时的搜索回退词池 */
  /* 回退关键词池：风格词，不用具体歌手名
     风格对齐 qqmusci 汽水向：网络情感 / 翻唱 / AI / 抖音，少用 KTV 顶流 */
  var REC_KW = [
    "抖音热歌", "抖音热门", "快手热歌", "汽水音乐", "网络热歌", "网络情歌", "伤感翻唱",
    "热门翻唱", "AI翻唱", "Suno", "虚拟歌手", "原曲翻唱", "男女对唱", "抖音BGM",
    "2024热歌", "2025热歌", "新锐歌手", "小众情歌", "治愈翻唱", "情感歌曲",
    "华语流行", "内地流行", "伤感情歌", "温柔女声", "民谣"
  ];
  var HOT_KW = [
    "飙升", "网络热歌", "抖音热歌", "快手热歌", "伤感情歌", "AI翻唱", "汽水音乐", "新歌"
  ];

  /** 仅作音源探测等内部用，主页展示不再使用 */
  function fallbackSongs() {
    return shuffle([
      { name: "晴天", artist: "周杰伦", songmid: "0039MnYb0qxYhV", albummid: "000MkMni19ClKG", album: "叶惠美" },
      { name: "海阔天空", artist: "Beyond", songmid: "001XvR6E2YVGsz", albummid: "001jv6ku2x9Z5o", album: "乐与怒" },
      { name: "演员", artist: "薛之谦", songmid: "001Qu4I30eVFYv", albummid: "003RMaRI1iFoYd", album: "绅士" },
      { name: "消愁", artist: "毛不易", songmid: "001y5cM22VJ1uE", albummid: "001BbwCb3HrW8K", album: "平凡的一天" },
      { name: "起风了", artist: "买辣椒也用券", songmid: "0020iuKo2oYZRb", albummid: "002jLGWe16Sf9Z", album: "起风了" },
      { name: "甜蜜蜜", artist: "邓丽君", songmid: "001bhqJB2qSkTb", albummid: "002Neh8l0uciMQ", album: "甜蜜蜜" },
    ].map(function (s) {
      s.cover = coverUrl(s.albummid);
      s.source = "qq";
      return s;
    }));
  }

  /**
   * 为你推荐：热歌榜 + 新歌榜数据链路（对齐 NGMusic / 主流榜单 ID）
   * - QQ：热歌榜 26、新歌榜 27（优先从 overview 按名匹配）
   * - 网易：热歌榜 3778678、新歌榜 3779629
   * - 其它站源：overview 里按「热歌」「新歌」名匹配，失败再回退搜索
   * 两榜各取一段后交错混排，艺人去重（一人一首）
   */
  /** 为你推荐大池缓存：换一批从池里重抽，避免每次同一批固定脸 */
  var _recChartPool = [];
  var _recChartPoolPlat = "";
  var _recChartPoolAt = 0;

  /**
   * 为你推荐：扩大数据池
   * - 热歌榜 + 新歌榜 + 飙升榜 + 网络热歌 / 流行指数（有则并入）
   * - 先缓存最多 ~120 首大池，展示 count 首（默认 24）
   * - 换一批：同一大池内重新随机切片，不必重新打榜也能换脸
   * - forceRefresh=true 时强制重拉榜单
   */
  async function fetchRecommendFromCharts(count, forceRefresh) {
    count = count || 24;
    var plat = S.platform || "qq";
    var now = Date.now();
    // 已知官方榜 ID
    var KNOWN = {
      qq: { hot: "26", neu: "27", rise: "62", net: "27" },
      netease: { hot: "3778678", neu: "3779629", rise: "19723756", net: "5059661515" },
    };
    function artistKey(s) {
      var a = (s && (s.artist || s.singer || "")) || "";
      a = String(a).replace(/\s+/g, "").replace(/[\/／、,&|｜]/g, "/").split("/")[0];
      return a.toLowerCase() || "_unknown";
    }
    function shuffleArr(arr) {
      arr = (arr || []).slice();
      for (var i = arr.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
      }
      return arr;
    }
    function pickFromPool(pool, n) {
      pool = shuffleArr(pool);
      var seenMid = {}, seenArt = {}, out = [];
      // 第一轮：一人一首
      pool.forEach(function (s) {
        if (out.length >= n) return;
        if (!s || !s.songmid || seenMid[s.songmid]) return;
        var ak = artistKey(s);
        if (seenArt[ak]) return;
        seenMid[s.songmid] = 1;
        seenArt[ak] = 1;
        out.push(s);
      });
      // 第二轮：放宽艺人，补满
      if (out.length < n) {
        pool.forEach(function (s) {
          if (out.length >= n) return;
          if (!s || !s.songmid || seenMid[s.songmid]) return;
          seenMid[s.songmid] = 1;
          out.push(s);
        });
      }
      return out.slice(0, n);
    }
    // 缓存有效（同站源、5 分钟内、池够大）且非强制刷新 → 直接从池里换一批
    if (
      !forceRefresh &&
      _recChartPoolPlat === plat &&
      _recChartPool.length >= count &&
      now - _recChartPoolAt < 5 * 60 * 1000
    ) {
      return pickFromPool(_recChartPool, count);
    }

    function matchIds(boards) {
      boards = boards || [];
      var found = { hot: null, neu: null, rise: null, net: null };
      boards.forEach(function (b) {
        var n = String(b.name || b.title || b.topTitle || "");
        var id = String(b.topId || b.id || "");
        if (!id) return;
        if (!found.hot && /热歌榜/.test(n) && !/网络/.test(n)) found.hot = id;
        if (!found.neu && /新歌榜/.test(n)) found.neu = id;
        if (!found.rise && /飙升/.test(n)) found.rise = id;
        if (!found.net && (/网络热歌/.test(n) || /流行指数/.test(n) || /潮流/.test(n))) found.net = id;
      });
      if (!found.hot) {
        boards.forEach(function (b) {
          var n = String(b.name || b.title || "");
          var id = String(b.topId || b.id || "");
          if (id && /热歌/.test(n) && !found.hot) found.hot = id;
        });
      }
      var known = KNOWN[plat] || {};
      if (!found.hot && known.hot) found.hot = known.hot;
      if (!found.neu && known.neu) found.neu = known.neu;
      if (!found.rise && known.rise) found.rise = known.rise;
      if (!found.net && known.net) found.net = known.net;
      return found;
    }
    function tagSongs(list, tag) {
      return (list || []).map(function (s) {
        if (!s) return null;
        var o = Object.assign({}, s);
        o._recFrom = tag;
        if (!o.source) o.source = plat;
        return o;
      }).filter(Boolean);
    }

    var buckets = { hot: [], neu: [], rise: [], net: [] };
    try {
      var boards = await fetchToplistOverview().catch(function () { return []; });
      var ids = matchIds(boards);
      var jobs = [];
      [["hot", "热歌榜"], ["neu", "新歌榜"], ["rise", "飙升榜"], ["net", "网络/流行榜"]].forEach(function (pair) {
        var key = pair[0], label = pair[1];
        var id = ids[key];
        if (!id) return;
        // 避免同一 id 重复拉
        var dup = false;
        Object.keys(ids).forEach(function (k) {
          if (k !== key && ids[k] === id && buckets[k]) dup = true;
        });
        if (dup && (key === "net" || key === "rise")) return;
        jobs.push(
          fetchToplistDetail(id, plat, { topId: id, id: id, name: label, source: plat })
            .then(function (p) { buckets[key] = tagSongs((p && p.songs) || [], key); })
            .catch(function () { buckets[key] = []; })
        );
      });
      await Promise.all(jobs);
    } catch (e) {
      console.warn("fetchRecommendFromCharts", e);
    }

    // 合并大池：热歌去头、新歌/飙升保留前排
    var pool = [];
    var seenPool = {};
    function addPool(arr, skipHead) {
      arr = arr || [];
      if (skipHead && arr.length > 15) arr = arr.slice(3);
      arr.forEach(function (s) {
        if (!s || !s.songmid || seenPool[s.songmid]) return;
        seenPool[s.songmid] = 1;
        pool.push(s);
      });
    }
    addPool(buckets.neu, false);
    addPool(buckets.rise, false);
    addPool(buckets.hot, true);
    addPool(buckets.net, true);

    // 池仍偏小：用搜索扩池
    if (pool.length < 40) {
      try {
        var extra = await fetchPool(
          ["热歌榜", "新歌榜", "华语热歌", "华语新歌", "飙升", "网络热歌", "流行热歌", "抖音热歌"],
          48,
          seenPool,
          6
        ).catch(function () { return []; });
        (extra || []).forEach(function (s) {
          if (!s || !s.songmid || seenPool[s.songmid]) return;
          seenPool[s.songmid] = 1;
          if (!s.source) s.source = plat;
          pool.push(s);
        });
      } catch (e2) {}
    }

    _recChartPool = pool;
    _recChartPoolPlat = plat;
    _recChartPoolAt = Date.now();
    return pickFromPool(pool, count);
  }



  /** 歌手归一化：用于「为你推荐」艺人去重 */
  function artistKeyOf(s) {
    var a = (s && (s.artist || s.singer || s.singername || "")) || "";
    a = String(a).replace(/\s+/g, "").replace(/[/／、,&|｜]/g, "/").split("/")[0];
    return a.toLowerCase() || "_unknown";
  }

  /**
   * 用指定关键词池拉一批（跟随当前站源）
   * - 按 songmid 去重
   * - 按艺人限流：同一歌手最多 maxPerArtist 首（默认 1），避免庄心妍连出好几首
   * - 最终按艺人交错混排，保证相邻尽量不同人
   */
  async function fetchPool(kwPool, count, excludeSet, kwPickCount) {
    excludeSet = excludeSet || {};
    var maxPerArtist = 1; // 推荐区一人一首，保证独立感
    // 多抽几个关键词，再在结果里严格去重，避免整批同人
    var picks = shuffle(kwPool).slice(0, Math.max(kwPickCount || 2, 5));
    var plat = S.platform || "qq";
    function withTimeout(p, ms) {
      return Promise.race([
        Promise.resolve(p).catch(function () { return []; }),
        new Promise(function (r) { setTimeout(function () { r([]); }, ms); }),
      ]);
    }
    var chunks = await Promise.all(picks.map(function (k) {
      return withTimeout(searchSongs(k), 4500);
    }));
    var out = [];
    var seen = Object.assign({}, excludeSet);
    var artistCnt = {};
    function tryPush(s) {
      if (!s || !s.songmid || seen[s.songmid]) return false;
      var ak = artistKeyOf(s);
      if ((artistCnt[ak] || 0) >= maxPerArtist) return false;
      seen[s.songmid] = 1;
      artistCnt[ak] = (artistCnt[ak] || 0) + 1;
      if (!s.source) s.source = plat;
      out.push(s);
      return true;
    }
    // 每个关键词批次只取前几首，再全局按艺人限流
    chunks.forEach(function (arr) {
      shuffle(arr || []).slice(0, 8).forEach(tryPush);
    });
    // 当前站全空再硬回退 QQ
    if (!out.length && plat !== "qq") {
      var chunks2 = await Promise.all(picks.map(function (k) {
        return withTimeout(searchQQ(k), 3500);
      }));
      chunks2.forEach(function (arr) {
        shuffle(arr || []).slice(0, 8).forEach(tryPush);
      });
    }
    // 若仍不足（艺人太少），放宽到每人最多 2 首再补一轮
    if (out.length < count) {
      maxPerArtist = 2;
      chunks.forEach(function (arr) {
        shuffle(arr || []).forEach(tryPush);
      });
    }
    // 按艺人分桶交错，避免 shuffle 后仍相邻同人
    var buckets = {};
    out.forEach(function (s) {
      var ak = artistKeyOf(s);
      if (!buckets[ak]) buckets[ak] = [];
      buckets[ak].push(s);
    });
    var keys = shuffle(Object.keys(buckets));
    var interleaved = [];
    var more = true;
    while (more && interleaved.length < count) {
      more = false;
      keys.forEach(function (k) {
        if (buckets[k] && buckets[k].length && interleaved.length < count) {
          interleaved.push(buckets[k].shift());
          more = true;
        }
      });
    }
    return interleaved.slice(0, count);
  }


  function musicuJsonp(payload, timeout) {
    var body = typeof payload === "string" ? payload : JSON.stringify(payload);
    var url =
      "https://u.y.qq.com/cgi-bin/musicu.fcg?_=" + Date.now() +
      "&data=" + encodeURIComponent(body) +
      "&format=jsonp&inCharset=utf8&outCharset=utf-8&platform=yqq.json&needNewCode=0";
    // 兼容：传 12 表示秒；传 >=200 视为毫秒
    var ms = timeout || 12000;
    if (ms > 0 && ms < 200) ms = ms * 1000;
    return jsonpRequest(url, ms).then(function (txt) {
      if (txt && typeof txt === "object") return txt;
      return (typeof jsonp_safeParse === "function") ? jsonp_safeParse(txt) : (function () {
        try { return JSON.parse(txt); } catch (e) { return null; }
      })();
    });
  }

  async function fetchChannels() {
    try {
      var d = await musicuJsonp({
        comm: { ct: 24, cv: 0 },
        req_0: { module: "musicToplist.ToplistInfoServer", method: "GetAll", param: {} },
      });
      var groups = (d && d.req_0 && d.req_0.data && d.req_0.data.group) || [];
      var out = [];
      groups.forEach(function (g) {
        (g.toplist || []).forEach(function (t) {
          out.push({
            topId: t.topId,
            title: t.title || t.topTitle || "",
            intro: t.intro || t.titleDetail || "",
            cover: fixCover(t.headPicUrl || t.frontPicUrl || t.picUrl || ""),
          });
        });
      });
      return out;
    } catch (e) {
      return [];
    }
  }

  async function fetchChannelSongs(topId) {
    try {
      var d = await musicuJsonp({
        comm: { ct: 24, cv: 0 },
        req_0: {
          module: "musicToplist.ToplistInfoServer",
          method: "GetDetail",
          param: { topId: Number(topId) || 62, offset: 0, num: 50, period: "" },
        },
      });
      var data = d && d.req_0 && d.req_0.data;
      if (!data) return [];
      return (data.songInfoList || [])
        .map(function (s) {
          return normSong({
            mid: s.mid,
            songmid: s.mid,
            title: s.title || s.name,
            name: s.title || s.name,
            singer: s.singer,
            album: s.album,
            albummid: (s.album && (s.album.mid || s.album.pmid)) || "",
            interval: s.interval,
          });
        })
        .filter(Boolean);
    } catch (e) {
      return [];
    }
  }

  /* 频道池：后台补全类型；主页默认抽 9 个，换一批随机替换 */
  var THEME_CHANNELS_ALL = [
    { name: "热歌",   mark: "热歌", kw: "热歌榜",     g1: "#FF5C8A", g2: "#E8356A" },
    { name: "网络流行", mark: "流行", kw: "网络流行",   g1: "#7B5CFF", g2: "#B14DFF" },
    { name: "情歌",   mark: "情歌", kw: "情歌",       g1: "#FF6B9D", g2: "#E8457A" },
    { name: "KTV必点", mark: "KTV",  kw: "KTV必点",    g1: "#5B7CFF", g2: "#3D5BDB" },
    { name: "经典",   mark: "经典", kw: "经典老歌",   g1: "#2C3E6B", g2: "#1A1F3A" },
    { name: "摇滚",   mark: "摇滚", kw: "摇滚",       g1: "#E85A4A", g2: "#B83020" },
    { name: "古风",   mark: "古风", kw: "古风",       g1: "#C4A46A", g2: "#8A7040" },
    { name: "官方",   mark: "官方", kw: "官方歌单",   g1: "#31C27C", g2: "#1A9E5C" },
    { name: "民谣",   mark: "民谣", kw: "民谣",       g1: "#E8A838", g2: "#C47A18" },
    { name: "电子",   mark: "电子", kw: "电子音乐",   g1: "#00C2C7", g2: "#008A9A" },
    { name: "说唱",   mark: "说唱", kw: "华语说唱",   g1: "#FF8A3D", g2: "#E05A10" },
    { name: "轻音乐", mark: "轻音", kw: "轻音乐",     g1: "#6BCB77", g2: "#3A9B5A" },
    { name: "粤语",   mark: "粤语", kw: "粤语金曲",   g1: "#F7B731", g2: "#D4920A" },
    { name: "日语",   mark: "日语", kw: "日语流行",   g1: "#FF6B81", g2: "#D63A55" },
    { name: "韩语",   mark: "韩语", kw: "韩语流行",   g1: "#A55EEA", g2: "#7B2CBF" },
    { name: "欧美",   mark: "欧美", kw: "欧美流行",   g1: "#4B7BEC", g2: "#2F5AD0" },
    { name: "爵士",   mark: "爵士", kw: "爵士",       g1: "#778CA3", g2: "#4B6584" },
    { name: "ACG",    mark: "ACG",  kw: "动漫歌曲",   g1: "#FD79A8", g2: "#E84393" },
    { name: "影视",   mark: "影视", kw: "影视原声",   g1: "#636E72", g2: "#2D3436" },
    { name: "儿歌",   mark: "儿歌", kw: "儿歌",       g1: "#55EFC4", g2: "#00B894" },
    { name: "蓝调",   mark: "蓝调", kw: "蓝调",       g1: "#0984E3", g2: "#0652DD" },
    { name: "乡村",   mark: "乡村", kw: "乡村音乐",   g1: "#E17055", g2: "#D63031" },
    { name: "拉丁",   mark: "拉丁", kw: "拉丁音乐",   g1: "#E84393", g2: "#C0392B" },
    { name: "金属",   mark: "金属", kw: "金属",       g1: "#2D3436", g2: "#000000" },
  ];
  var THEME_CHANNELS = THEME_CHANNELS_ALL.slice(0, 9);
  var CHANNEL_SHOW_N = 9;
  var homeChView = "channel";
  var homePlCache = null;

  function pickChannelBatch(n) {
    var arr = THEME_CHANNELS_ALL.slice();
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr.slice(0, Math.min(n || CHANNEL_SHOW_N, arr.length));
  }

  function renderThemeChannels(list) {
    var box = document.getElementById("chGrid");
    if (!box) return;
    var show = list && list.length ? list : (THEME_CHANNELS.length ? THEME_CHANNELS : pickChannelBatch(CHANNEL_SHOW_N));
    THEME_CHANNELS = show;
    box.innerHTML = "";
    show.forEach(function (ch) {
      var el = document.createElement("div");
      el.className = "ch-item";
      el.innerHTML =
        '<div class="ch-cover">' +
        '<div class="ch-art-ring2"></div><div class="ch-art-ring"></div>' +
        '<div class="ch-art-mark"></div><div class="ch-art-sub">CHANNEL</div>' +
        '</div><div class="ch-name"></div>';
      var cover = el.querySelector(".ch-cover");
      cover.style.background = "linear-gradient(145deg, " + ch.g1 + " 0%, " + ch.g2 + " 100%)";
      el.querySelector(".ch-art-mark").textContent = ch.mark;
      el.querySelector(".ch-name").textContent = ch.name;
      el.addEventListener("click", async function () {
        toast("加载「" + ch.name + "」…");
        var songs = [];
        var seenMid = {};
        function pushUnique(arr) {
          (arr || []).forEach(function (s) {
            if (!s) return;
            var k = "";
            try { k = (typeof keyOf === "function") ? keyOf(s) : (s.songmid || s.id || s.name); } catch (eK) {
              k = s.songmid || s.id || s.name || "";
            }
            if (!k || seenMid[k]) return;
            seenMid[k] = 1;
            songs.push(s);
          });
        }
        async function searchPage(kw, pg) {
          try {
            if (S.platform && S.platform !== "qq") {
              return await searchSongs(kw, pg).catch(function () { return []; });
            }
            return await searchQQ(kw, pg).catch(function () { return []; });
          } catch (e) { return []; }
        }
        var kwList = [ch.kw, ch.name].filter(function (k, i, a) {
          return k && String(k).trim() && a.indexOf(k) === i;
        });
        if (!kwList.length) kwList = [ch.kw || ch.name].filter(Boolean);
        // 并行拉多页（约 80 首）：关键词 × 页码一起发
        var pages = [1, 2, 3];
        var jobs = [];
        kwList.forEach(function (kw) {
          pages.forEach(function (pg) {
            jobs.push(searchPage(kw, pg));
          });
        });
        try {
          var batches = await Promise.all(jobs);
          batches.forEach(pushUnique);
        } catch (e) {}
        if (songs.length < 20) {
          try { pushUnique(await fetchPool(kwList, 80, seenMid)); } catch (e2) {}
        }
        if (!songs.length) {
          toast("暂无歌曲");
          return;
        }
        if (songs.length > 80) songs = songs.slice(0, 80);
        var nextPage = pages[pages.length - 1] + 1;
        _channelPlayCtx = {
          name: ch.name,
          kwList: kwList,
          page: nextPage,
          seen: seenMid,
          loading: false,
          done: false,
        };
        var startIdx = Math.floor(Math.random() * songs.length);
        _channelPlayCtx._lock = true;
        play(songs[startIdx], songs);
        _channelPlayCtx._lock = false;
        openNowPlaying();
      });

      box.appendChild(el);
    });
  }

  /* 网易云歌单搜索（type=1000） */
  async function searchNeteasePlaylists(kw) {
    if (!kw) return [];
    try {
      var url = "https://music.163.com/api/search/get?s=" + encodeURIComponent(kw) +
        "&type=1000&limit=12&offset=0";
      var d = await reqFetch(url, {
        timeout: 5,
        headers: {
          Referer: "https://music.163.com/",
          "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15",
        },
      });
      var list = (d && d.result && d.result.playlists) || [];
      return list.map(function (p) {
        return {
          id: String(p.id),
          name: stripEm(p.name || ""),
          cover: fixCover(p.coverImgUrl || p.picUrl || ""),
          listen: p.playCount || 0,
          type: "playlist",
          source: "netease",
        };
      }).filter(function (p) { return p.id && p.name; });
    } catch (e) {
      return [];
    }
  }
  /* 网易歌单详情：与 squid 同接口 —— v6 detail n=100000 + trackIds + song/detail 分批；另补 track/all */
  function mapNeteaseTrack(t) {
    if (!t || t.id == null) return null;
    var ar = (t.ar || t.artists || []).map(function (a) { return a && a.name; }).filter(Boolean).join(" / ");
    var al = t.al || t.album || {};
    var pic = al.picUrl || al.blurPicUrl || "";
    return {
      name: t.name || "",
      artist: ar || "未知",
      songmid: String(t.id),
      id: String(t.id),
      albummid: String(al.id || ""),
      album: al.name || "",
      cover: fixCover(pic),
      source: "netease",
      neteaseId: String(t.id),
    };
  }

  function neHdr() {
    return {
      Referer: "https://music.163.com/",
      Origin: "https://music.163.com",
      Accept: "*/*",
      "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 CloudMusic/8.9.0",
    };
  }

  async function neRequestJson(url, hdr, timeout) {
    timeout = timeout || 18;
    hdr = hdr || neHdr();
    // 与 squid 一致：优先 adapter（绕过 CORS），再 reqFetch
    var d = null;
    try {
      var txt = await adapterRequest(url, { headers: hdr, timeout: timeout });
      if (txt) d = typeof txt === "string" ? (parseLooseJson(txt) || JSON.parse(txt)) : txt;
    } catch (e0) { d = null; }
    if (d) return d;
    try {
      d = await reqFetch(url, { timeout: timeout, headers: hdr });
    } catch (e1) { d = null; }
    return d;
  }

  async function neteaseFetchSongDetails(ids, hdr) {
    ids = (ids || []).map(function (x) { return String(x || "").trim(); }).filter(Boolean);
    if (!ids.length) return [];
    var out = [];
    var chunk = 50; // 网易 song/detail 大批量常失败，50 更稳
    for (var i = 0; i < ids.length; i += chunk) {
      var part = ids.slice(i, i + chunk);
      var urls = [
        "https://music.163.com/api/song/detail/?ids=[" + part.join(",") + "]",
        "https://music.163.com/api/v3/song/detail?c=" + encodeURIComponent(JSON.stringify(part.map(function (id) { return { id: Number(id) || id }; }))),
        "https://interface.music.163.com/api/song/detail/?ids=[" + part.join(",") + "]",
      ];
      var got = null;
      for (var u = 0; u < urls.length && !got; u++) {
        try {
          var det = await neRequestJson(urls[u], hdr, 15);
          var songs = (det && det.songs) || (det && det.data && det.data.songs) || [];
          if (Array.isArray(songs) && songs.length) got = songs;
        } catch (e) {}
      }
      if (got) out = out.concat(got);
    }
    return out;
  }

  async function neteaseTrackAll(pid, limit, offset) {
    limit = limit || 200;
    offset = offset || 0;
    var urls = [
      "https://music.163.com/api/v6/playlist/detail?id=" + encodeURIComponent(pid) + "&n=" + limit + "&s=" + offset,
      "https://music.163.com/api/playlist/track/all?id=" + encodeURIComponent(pid) + "&limit=" + limit + "&offset=" + offset,
      "https://interface.music.163.com/api/playlist/track/all?id=" + encodeURIComponent(pid) + "&limit=" + limit + "&offset=" + offset,
    ];
    var hdr = neHdr();
    for (var i = 0; i < urls.length; i++) {
      try {
        var d = await neRequestJson(urls[i], hdr, 18);
        if (!d) continue;
        // track/all 直接给 songs
        if (Array.isArray(d.songs) && d.songs.length) return d.songs;
        if (d.data && Array.isArray(d.data.songs) && d.data.songs.length) return d.data.songs;
        var pl = d.playlist || (d.result && d.result.playlist);
        if (pl && Array.isArray(pl.tracks) && pl.tracks.length) return pl.tracks;
      } catch (e) {}
    }
    return [];
  }

  async function neteasePlaylistSongs(pid) {
    try {
      pid = String(pid || "").replace(/^ne_pl_/i, "").replace(/\D/g, "");
      if (!pid) return [];
      var hdr = neHdr();

      // 1) 主接口：与 squid 完全一致
      var detailUrl = "https://music.163.com/api/v6/playlist/detail?id=" + pid + "&n=100000";
      var d = await neRequestJson(detailUrl, hdr, 18);
      if (!d || !d.playlist) {
        d = await neRequestJson("https://music.163.com/api/v1/playlist/detail?id=" + pid + "&n=100000", hdr, 18);
      }
      if (!d || !d.playlist) {
        d = await neRequestJson("https://music.163.com/api/playlist/detail?id=" + pid, hdr, 15);
      }
      var pl = (d && d.playlist) || (d && d.result && d.result.playlist) || null;

      var trackMap = {};
      var trackIds = [];
      var tracks = [];

      if (pl) {
        tracks = pl.tracks || [];
        if (Array.isArray(tracks)) {
          tracks.forEach(function (t) {
            if (t && t.id != null) trackMap[String(t.id)] = t;
          });
        }
        if (Array.isArray(pl.trackIds) && pl.trackIds.length) {
          trackIds = pl.trackIds.map(function (t) {
            return (t && (t.id != null ? t.id : t)) || "";
          }).filter(Boolean);
        }
        if (!trackIds.length && tracks.length) {
          trackIds = tracks.map(function (t) { return t && t.id; }).filter(Boolean);
        }
      }

      // 2) trackIds 明显多于 tracks（典型只返回前 10）→ 分批 song/detail
      if (trackIds.length > Object.keys(trackMap).length) {
        var missing = trackIds.filter(function (tid) { return !trackMap[String(tid)]; });
        // 一次最多补 1000
        missing = missing.slice(0, 1000);
        if (missing.length) {
          var fetched = await neteaseFetchSongDetails(missing, hdr);
          (fetched || []).forEach(function (s) {
            if (s && s.id != null) trackMap[String(s.id)] = s;
          });
        }
      }

      // 3) 仍不足：用 track/all 分页拉
      var haveCount = Object.keys(trackMap).length;
      if ((!trackIds.length && haveCount < 20) || (trackIds.length && haveCount < Math.min(trackIds.length, 30))) {
        var offset = 0;
        for (var page = 0; page < 10; page++) {
          var more = await neteaseTrackAll(pid, 200, offset);
          if (!more || !more.length) break;
          more.forEach(function (t) {
            if (t && t.id != null) {
              trackMap[String(t.id)] = t;
              if (trackIds.indexOf(t.id) < 0 && trackIds.indexOf(String(t.id)) < 0) {
                trackIds.push(t.id);
              }
            }
          });
          if (more.length < 200) break;
          offset += 200;
        }
        if (!trackIds.length) {
          trackIds = Object.keys(trackMap);
        }
      }

      trackIds = (trackIds.length ? trackIds : Object.keys(trackMap)).slice(0, 1000);
      var result = [];
      var seen = {};
      trackIds.forEach(function (tid) {
        var key = String(tid);
        if (seen[key]) return;
        seen[key] = 1;
        var m = mapNeteaseTrack(trackMap[key]);
        if (m && m.name && m.songmid) result.push(m);
      });
      if (!result.length && tracks.length) {
        result = tracks.map(mapNeteaseTrack).filter(function (s) { return s && s.name && s.songmid; });
      }
      return result;
    } catch (e) {
      console.warn("neteasePlaylistSongs", e);
      return [];
    }
  }

  async function kuwoPlaylistSongs(pid) {
    try {
      pid = String(pid || "").replace(/^kw_pl_/i, "").trim();
      if (!pid) return [];
      var hdr = { Referer: "https://www.kuwo.cn/", Accept: "application/json" };
      var pageSize = 100;
      var maxPages = 8; // 最多约 800 首
      var all = [];
      var seen = {};
      var total = 0;

      function mapList(list) {
        if (!Array.isArray(list)) return [];
        return list.map(function (s) {
          var id = s.rid || s.id || s.musicrid || "";
          id = String(id).replace(/^MUSIC_/i, "").trim();
          var name = s.name || s.SONGNAME || s.songName || s.songname || "";
          var artist = s.artist || s.ARTIST || s.singer || s.artist_name || "";
          if (!name || !id) return null;
          if (seen[id]) return null;
          seen[id] = 1;
          var albumId = s.albumid || s.ALBUMID || s.albumId || s.albummid || "";
          var picRaw =
            s.pic || s.albumpic || s.hts_albumpic || s.web_albumpic_short ||
            s.img || s.pic120 || s.pic500 || s.MVPIC || "";
          var cover = "";
          if (picRaw) {
            cover = typeof kuwoResolvePic === "function" ? kuwoResolvePic(picRaw, "album") : fixCover(picRaw);
            cover = String(cover || "").replace(/\/120\//g, "/500/").replace(/_120\./g, "_500.").replace(/_150\./g, "_500.");
            cover = fixCover(cover);
            if (cover && /\/albumcover\/?\d+$/i.test(cover)) cover = "";
          }
          return {
            name: name,
            artist: artist || "未知",
            songmid: String(id),
            id: String(id),
            albummid: String(albumId || ""),
            album: s.album || s.ALBUM || "",
            cover: cover || "",
            source: "kuwo",
            kuwoId: id,
            rid: String(id),
          };
        }).filter(Boolean);
      }

      async function fetchPage(pn) {
        // pn 从 0 起；多端点兜底
        var urls = [
          "https://nplserver.kuwo.cn/pl.svc?op=getlistinfo&pid=" + encodeURIComponent(pid) +
            "&pn=" + pn + "&rn=" + pageSize + "&encode=utf8&keyset=pl2012&identity=kuwo&pcmp4=1&vipver=MUSIC_9.0.5.0_BCS31&newver=1",
          "https://wapi.kuwo.cn/api/www/playlist/playListInfo?pid=" + encodeURIComponent(pid) +
            "&pn=" + pn + "&rn=" + pageSize + "&httpsStatus=1",
          "https://m.kuwo.cn/newh5app/wapi/api/www/playlist/playListInfo?pid=" + encodeURIComponent(pid) +
            "&pn=" + pn + "&rn=" + pageSize,
        ];
        for (var i = 0; i < urls.length; i++) {
          var d = null;
          try {
            d = await reqFetch(urls[i], { timeout: 12, headers: hdr });
          } catch (e1) {
            try {
              var txt = await adapterRequest(urls[i], { headers: hdr, timeout: 12 });
              d = typeof txt === "string" ? (parseLooseJson(txt) || parseKuwoBody(txt) || JSON.parse(txt)) : txt;
            } catch (e2) { d = null; }
          }
          if (!d) continue;
          var data = d.data || d;
          var list = data.musicList || data.musiclist || data.list || d.musiclist || d.abslist || [];
          if (!Array.isArray(list) || !list.length) continue;
          var t = Number(data.total || data.songnum || data.songNum || d.total || 0) || 0;
          if (t > total) total = t;
          return mapList(list);
        }
        return [];
      }

      for (var page = 0; page < maxPages; page++) {
        var batch = await fetchPage(page);
        if (!batch.length) break;
        all = all.concat(batch);
        if (batch.length < pageSize) break;
        if (total && all.length >= total) break;
      }
      return all;
    } catch (e) {
      console.warn("kuwoPlaylistSongs", e);
      return [];
    }
  }

  async function kugouPlaylistSongs(pid) {
    try {
      var urls = [
        "https://mobileservice.kugou.com/api/v5/special/info?specialid=" + encodeURIComponent(pid) +
          "&page=1&pagesize=100&version=9108&apiver=6",
        "https://mobiles.kugou.com/api/v5/special/info?specialid=" + encodeURIComponent(pid) +
          "&page=1&pagesize=100",
        "https://www2.kugou.kugou.com/yueku/v9/special/getSpecial?specialid=" + encodeURIComponent(pid) +
          "&page=1&pagesize=100",
      ];
      var hdr = { Referer: "https://www.kugou.com/", Accept: "application/json" };
      for (var i = 0; i < urls.length; i++) {
        var d = null;
        try {
          d = await reqFetch(urls[i], { timeout: 8, headers: hdr });
        } catch (e1) {
          try {
            var txt = await adapterRequest(urls[i], { headers: hdr, timeout: 8 });
            d = typeof txt === "string" ? JSON.parse(txt) : txt;
          } catch (e2) { d = null; }
        }
        if (!d) continue;
        var list =
          (d.data && d.data.info) ||
          (d.data && d.data.list) ||
          (d.data && d.data.songs) ||
          d.info || d.list || [];
        if (!Array.isArray(list) || !list.length) continue;
        return list.map(function (s) {
          var hash = s.hash || s.FileHash || s.sqhash || "";
          var name = s.songname || s.filename || s.SongName || s.name || "";
          var artist = s.singername || s.SingerName || s.author_name || s.singer || "";
          if (!artist && name.indexOf(" - ") > 0) {
            var parts = name.split(" - ");
            artist = parts[0];
            name = parts.slice(1).join(" - ");
          }
          var cover = s.album_img || s.imgUrl || s.cover || "";
          if (cover) cover = String(cover).replace(/\{size\}/g, "240");
          var mid = hash || String(s.audio_id || s.album_audio_id || s.id || "");
          if (!name || !mid) return null;
          return {
            name: name,
            artist: artist || "未知",
            songmid: mid,
            id: mid,
            hash: hash,
            cover: fixCover(cover),
            source: "kugou",
            kugouHash: hash,
          };
        }).filter(Boolean);
      }
      return [];
    } catch (e) {
      return [];
    }
  }

  async function loadRandomHomePlaylists() {
    // 主页歌单跟随当前站源；不回退 QQ、不弹「已用 QQ」（切站偶发超时不应误判）
    var plat = S.platform || "qq";
    var kws = shuffle(["流行", "热门", "华语", "情歌", "经典", "民谣", "摇滚", "电子", "轻音乐", "抖音"]).slice(0, 3);
    var raw = [];
    try {
      var packs = await Promise.all(kws.map(function (k) {
        return searchPlaylists(k, { noRetry: false }).catch(function () { return []; });
      }));
      packs.forEach(function (arr) { raw = raw.concat(arr || []); });
    } catch (e) {}
    // 仍空：整批再拉一次（切站瞬间网络未就绪）
    if (!raw.length && plat !== "qq") {
      try {
        await new Promise(function (r) { setTimeout(r, 400); });
        var packs2 = await Promise.all(kws.map(function (k) {
          return searchPlaylists(k, { noRetry: true }).catch(function () { return []; });
        }));
        packs2.forEach(function (arr) { raw = raw.concat(arr || []); });
      } catch (e2) {}
    }
    var seen = {};
    var merged = [];
    shuffle(raw).forEach(function (p) {
      if (!p || !p.name) return;
      var src = p.source || plat;
      var k = src + ":" + p.id;
      if (seen[k]) return;
      seen[k] = 1;
      p.source = src;
      merged.push(p);
    });
    return merged.slice(0, 18);
  }
function renderHomePlaylists(list) {
    var box = $("#homePlGrid");
    if (!box) return;
    box.innerHTML = "";
    if (!list || !list.length) {
      box.innerHTML = '<div class="empty" style="grid-column:1/-1;padding:20px">暂无歌单</div>';
      return;
    }
    list.forEach(function (pl) {
      var el = document.createElement("div");
      el.className = "pl-card";
      el.innerHTML =
        '<img class="pl-card-cover" alt="" />' +
        '<div class="pl-card-name"></div>' +
        '<div class="pl-card-src"></div>';
      var img = el.querySelector("img");
      img.referrerPolicy = "no-referrer";
      img.onerror = function () { this.onerror = null; this.src = PLACEHOLDER; };
      img.src = pl.cover || PLACEHOLDER;
      el.querySelector(".pl-card-name").textContent = pl.name;
      el.querySelector(".pl-card-src").textContent =
        ({ qq: "QQ音乐", netease: "网易云", kuwo: "酷我", kugou: "酷狗", migu: "咪咕" }[pl.source] || pl.source || "QQ") +
        (pl.listen ? " · " + (pl.listen > 10000 ? Math.round(pl.listen / 10000) + "万" : pl.listen) : "");
      el.addEventListener("click", function () {
        playPlaylist(pl);
      });
      box.appendChild(el);
    });
  }
  function setHomeChView(view) {
    homeChView = view === "playlist" ? "playlist" : "channel";
    $$("#chTabs .ch-tab").forEach(function (b) {
      b.classList.toggle("on", b.dataset.view === homeChView);
    });
    // 左侧大标题与 tab 同步：频道 / 热门歌单（右侧 tab 按钮文案不变）
    try {
      var secT = $("#chSecTitle");
      if (secT) secT.textContent = homeChView === "playlist" ? "热门歌单" : "频道";
      var refBtn = $("#btnPlRefresh");
      if (refBtn) {
        refBtn.title = "换一批";
        refBtn.setAttribute("aria-label", "换一批");
      }
    } catch (eTit) {}
    var ch = $("#chGrid");
    var pl = $("#homePlGrid");
    if (ch) ch.classList.toggle("hide", homeChView !== "channel");
    if (pl) pl.classList.toggle("hide", homeChView !== "playlist");
    if (homeChView === "playlist" && !homePlCache) {
      if (pl) pl.innerHTML = '<div class="empty" style="grid-column:1/-1;padding:20px">加载歌单…</div>';
      loadRandomHomePlaylists().then(function (list) {
        homePlCache = list;
        renderHomePlaylists(list);
      });
    } else if (homeChView === "playlist" && homePlCache) {
      renderHomePlaylists(homePlCache);
    }
  }
  async function refreshHomePlaylists() {
    var btn = $("#btnPlRefresh");
    if (btn) {
      btn.classList.remove("spin");
      void btn.offsetWidth;
      btn.classList.add("spin");
    }
    if (homeChView === "channel") {
      try {
        renderThemeChannels(pickChannelBatch(CHANNEL_SHOW_N));
        toast("已换一批频道");
      } catch (e) {}
      return;
    }
    setHomeChView("playlist");
    var pl = $("#homePlGrid");
    if (pl) pl.innerHTML = '<div class="empty" style="grid-column:1/-1;padding:20px">换一批…</div>';
    homePlCache = null;
    var list = await loadRandomHomePlaylists();
    homePlCache = list;
    renderHomePlaylists(list);
  }
  function bindChTabs() {
    $$("#chTabs .ch-tab").forEach(function (btn) {
      on(btn, "click", function () {
        setHomeChView(btn.dataset.view);
      });
    });
    on($("#btnPlRefresh"), "click", function () {
      refreshHomePlaylists();
    });
    on($("#btnRankRefresh"), "click", function () {
      refreshHomeRanksBatch();
    });
  }

  // 打开列表后短时间内忽略行点击，防止 touchend→合成 click 点到当前曲导致重播
  var _queueSheetGuardUntil = 0;
  function resetSheetBodyStyles(body) {
    if (!body) return;
    try {
      body.removeAttribute("data-queue-sheet");
      body.style.cssText = "";
      body.style.padding = "";
      body.style.overflow = "";
      body.style.maxHeight = "";
      body.style.display = "";
      body.style.flexDirection = "";
      body.style.background = "";
      body.style.position = "";
      body.style.transition = "";
      body.style.transform = "";
      body.style.opacity = "";
      body.style.color = "";
    } catch (e) {}
  }

  var _channelPlayCtx = null;
  var _queueLoadMoreBusy = false;

  async function channelFetchMore(need) {
    need = need || 30;
    var ctx = _channelPlayCtx;
    if (!ctx || ctx.done || ctx.loading) return [];
    ctx.loading = true;
    var added = [];
    try {
      var kwList = ctx.kwList || [];
      if (!kwList.length) {
        ctx.done = true;
        ctx.loading = false;
        return [];
      }
      var rounds = 0;
      while (added.length < need && rounds < 4 && !ctx.done) {
        rounds++;
        var any = false;
        for (var ki = 0; ki < kwList.length && added.length < need; ki++) {
          var batch = [];
          try {
            if (S.platform && S.platform !== "qq") {
              batch = await searchSongs(kwList[ki], ctx.page).catch(function () { return []; });
            } else {
              batch = await searchQQ(kwList[ki], ctx.page).catch(function () { return []; });
            }
          } catch (eB) { batch = []; }
          (batch || []).forEach(function (s) {
            if (!s) return;
            var k = "";
            try { k = (typeof keyOf === "function") ? keyOf(s) : (s.songmid || s.id || s.name); } catch (eK) {
              k = s.songmid || s.id || s.name || "";
            }
            if (!k || (ctx.seen && ctx.seen[k])) return;
            if (ctx.seen) ctx.seen[k] = 1;
            added.push(s);
            any = true;
          });
        }
        ctx.page = (ctx.page || 1) + 1;
        if (!any) {
          ctx.done = true;
          break;
        }
        if (ctx.page > 20) {
          ctx.done = true;
          break;
        }
      }
    } catch (e) {
      console.warn("channelFetchMore", e);
    }
    ctx.loading = false;
    return added;
  }

  function appendSongsToQueueSheet(newSongs) {
    if (!newSongs || !newSongs.length) return;
    var body = $("#sheetBody");
    var mask = $("#sheetMask");
    if (!body || !mask || !mask.classList.contains("open")) return;
    if (!body.getAttribute("data-queue-sheet")) return;
    var wrap = body.querySelector("[data-queue-wrap]");
    var title = body.querySelector(".q-list-title");
    if (title) title.textContent = "播放列表 · " + (S.queue ? S.queue.length : 0) + " 首";
    if (!wrap) return;
    var isDark = document.documentElement.classList.contains("dark");
    var nameColor = isDark ? "#f5f5f7" : "#1c1c1e";
    var subColor = isDark ? "rgba(235,235,245,0.45)" : "rgba(60,60,67,0.55)";
    var onBg = isDark ? "rgba(250,45,72,0.18)" : "rgba(250,45,72,0.10)";
    var baseIdx = (S.queue ? S.queue.length : 0) - newSongs.length;
    newSongs.forEach(function (s, j) {
      var i = baseIdx + j;
      var on = i === S.idx;
      var row = document.createElement("div");
      row.style.cssText =
        "display:flex;align-items:center;gap:12px;padding:10px 10px;margin:2px 0;border-radius:12px;cursor:pointer;" +
        (on ? ("background:" + onBg + ";") : "");
      var img = document.createElement("img");
      img.style.cssText =
        "width:44px;height:44px;border-radius:10px;object-fit:cover;background:#eee;flex-shrink:0;" +
        "box-shadow:0 2px 8px rgba(0,0,0,0.08)";
      img.referrerPolicy = "no-referrer";
      img.src = songCover(s) || PLACEHOLDER;
      var meta = document.createElement("div");
      meta.style.cssText = "flex:1;min-width:0";
      var n = document.createElement("div");
      n.style.cssText =
        "font-size:15px;font-weight:" + (on ? "700" : "600") +
        ";white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:" +
        (on ? "var(--pink)" : nameColor);
      n.textContent = (i + 1) + ". " + (s.name || "未知");
      var a = document.createElement("div");
      a.style.cssText =
        "font-size:12px;color:" + subColor + ";margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis";
      a.textContent = s.artist || "—";
      meta.appendChild(n);
      meta.appendChild(a);
      row.appendChild(img);
      row.appendChild(meta);
      row.addEventListener("click", function (ev) {
        if (Date.now() < _queueSheetGuardUntil) {
          if (ev) { try { ev.preventDefault(); ev.stopPropagation(); } catch (e0) {} }
          return;
        }
        if (i === S.idx) { closeSheet(); return; }
        closeSheet();
        play(s, S.queue);
      });
      wrap.appendChild(row);
    });
    var tip = body.querySelector("[data-queue-more-tip]");
    if (tip) tip.textContent = (_channelPlayCtx && _channelPlayCtx.done) ? "已加载全部" : "";
  }

  async function tryLoadMoreChannelQueue() {
    if (!_channelPlayCtx || _channelPlayCtx.done || _channelPlayCtx.loading || _queueLoadMoreBusy) return;
    _queueLoadMoreBusy = true;
    try {
      var tip = document.querySelector("[data-queue-more-tip]");
      if (tip) tip.textContent = "加载更多…";
      var more = await channelFetchMore(30);
      if (more && more.length) {
        S.queue = (S.queue || []).concat(more);
        appendSongsToQueueSheet(more);
        if (tip && !(_channelPlayCtx && _channelPlayCtx.done)) tip.textContent = "";
      } else {
        if (_channelPlayCtx) _channelPlayCtx.done = true;
        if (tip) tip.textContent = "已加载全部";
      }
    } catch (e) {
      console.warn(e);
    }
    _queueLoadMoreBusy = false;
  }

  function openQueueSheet() {
    var body = $("#sheetBody");
    var mask = $("#sheetMask");
    if (!body || !mask) return;
    // 已打开则不重复构建，避免二次触发
    if (mask.classList.contains("open") && body.querySelector(".q-list-title, [data-queue-sheet]")) {
      return;
    }
    var q = S.queue || [];
    // 清掉榜单/歌单详情残留的透明底、flex 等，否则浅色主题会叠成「黑底黑字」
    resetSheetBodyStyles(body);
    body.innerHTML = "";
    body.style.padding = "6px 0 8px";
    body.style.background = "";
    body.style.color = "";
    body.setAttribute("data-queue-sheet", "1");
    try { document.body.classList.add("sheet-open"); } catch (e0) {}
    var isDark = document.documentElement.classList.contains("dark");
    // 强制可读色：不依赖半透明叠色
    var titleColor = isDark ? "rgba(235,235,245,0.68)" : "rgba(60,60,67,0.72)";
    var nameColor = isDark ? "#f5f5f7" : "#1c1c1e";
    var subColor = isDark ? "rgba(235,235,245,0.45)" : "rgba(60,60,67,0.55)";
    var onBg = isDark ? "rgba(250,45,72,0.18)" : "rgba(250,45,72,0.10)";
    var title = document.createElement("div");
    title.className = "q-list-title";
    title.style.cssText =
      "font-size:13px;font-weight:600;padding:14px 16px 12px;color:" + titleColor +
      ";letter-spacing:0.02em;text-align:center";
    title.textContent = "播放列表 · " + q.length + " 首";
    body.appendChild(title);
    // 吞掉打开瞬间落到 sheet 上的幽灵点击
    _queueSheetGuardUntil = Date.now() + 450;
    if (!q.length) {
      var empty = document.createElement("div");
      empty.className = "empty";
      empty.style.padding = "28px 16px";
      empty.style.color = subColor;
      empty.textContent = "暂无歌曲";
      body.appendChild(empty);
    } else {
      var wrap = document.createElement("div");
      wrap.setAttribute("data-queue-wrap", "1");
      wrap.style.cssText = "max-height:54vh;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:0 8px 8px;width:100%;box-sizing:border-box";
      q.forEach(function (s, i) {
        var on = i === S.idx;
        var row = document.createElement("div");
        row.style.cssText =
          "display:flex;align-items:center;gap:12px;padding:10px 10px;margin:2px 0;border-radius:12px;cursor:pointer;" +
          (on ? ("background:" + onBg + ";") : "");
        var img = document.createElement("img");
        img.style.cssText =
          "width:44px;height:44px;border-radius:10px;object-fit:cover;background:#eee;flex-shrink:0;" +
          "box-shadow:0 2px 8px rgba(0,0,0,0.08)";
        img.referrerPolicy = "no-referrer";
        img.src = songCover(s) || PLACEHOLDER;
        var meta = document.createElement("div");
        meta.style.cssText = "flex:1;min-width:0";
        var n = document.createElement("div");
        n.style.cssText =
          "font-size:15px;font-weight:" + (on ? "700" : "600") +
          ";white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:" +
          (on ? "var(--pink)" : nameColor);
        n.textContent = (i + 1) + ". " + (s.name || "未知");
        var a = document.createElement("div");
        a.style.cssText =
          "font-size:12px;color:" + subColor + ";margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis";
        a.textContent = s.artist || "—";
        meta.appendChild(n);
        meta.appendChild(a);
        row.appendChild(img);
        row.appendChild(meta);
        if (on) {
          var wave = document.createElement("div");
          wave.className = "q-wave" + (audio && !audio.paused ? " is-playing" : "");
          wave.setAttribute("aria-hidden", "true");
          wave.innerHTML = "<i></i><i></i><i></i><i></i><i></i>";
          row.appendChild(wave);
        }
        row.addEventListener("click", function (ev) {
          if (Date.now() < _queueSheetGuardUntil) {
            if (ev) { try { ev.preventDefault(); ev.stopPropagation(); } catch (e0) {} }
            return;
          }
          if (i === S.idx) {
            closeSheet();
            return;
          }
          closeSheet();
          play(s, S.queue);
        });
        wrap.appendChild(row);
      });
      body.appendChild(wrap);
      if (_channelPlayCtx && !_channelPlayCtx.done) {
        var moreTip = document.createElement("div");
        moreTip.setAttribute("data-queue-more-tip", "1");
        moreTip.style.cssText = "text-align:center;padding:10px 12px 16px;font-size:12px;color:" + subColor;
        moreTip.textContent = "上滑加载更多";
        body.appendChild(moreTip);
        wrap.addEventListener("scroll", function () {
          if (wrap.scrollTop + wrap.clientHeight >= wrap.scrollHeight - 80) {
            tryLoadMoreChannelQueue();
          }
        }, { passive: true });
      }
    }
    mask.classList.add("open");
    pushSheetHistory();
  }

  var TITLES = { home: "现在就听", search: "搜索", lib: "资料库", set: "设置" };
  var _pageOrder = ["home", "search", "lib", "set"];
  var _curPage = "home";
  var _subPagePushed = false; // 设置/资料库/搜索是否已压入 history
  function go(p, opts) {
    opts = opts || {};
    if (!p) p = "home";
    if (p === _curPage) {
      $$(".page").forEach(function (el) { el.classList.toggle("on", el.dataset.p === p); });
      $$(".tab").forEach(function (el) { el.classList.toggle("on", el.dataset.p === p); });
      var t0 = $("#pageTitle"); if (t0) t0.textContent = TITLES[p] || "Music";
      return;
    }
    var from = _curPage;
    var fi = _pageOrder.indexOf(from);
    var ti = _pageOrder.indexOf(p);
    var forward = ti >= fi;
    $$(".page").forEach(function (el) {
      el.classList.remove("leave-left", "leave-right", "enter-from-left", "enter-from-right");
      var isTarget = el.dataset.p === p;
      var isFrom = el.dataset.p === from;
      if (isFrom) {
        el.classList.remove("on");
        el.classList.add(forward ? "leave-left" : "leave-right");
      } else if (isTarget) {
        el.classList.add(forward ? "enter-from-right" : "enter-from-left");
        void el.offsetWidth;
        el.classList.add("on");
        el.classList.remove("enter-from-right", "enter-from-left");
      } else {
        el.classList.remove("on");
      }
    });
    $$(".tab").forEach(function (el) { el.classList.toggle("on", el.dataset.p === p); });
    var t = $("#pageTitle"); if (t) t.textContent = TITLES[p] || "Music";
    _curPage = p;
    setTimeout(function () {
      $$(".page").forEach(function (el) {
        el.classList.remove("leave-left", "leave-right");
      });
    }, 420);
    // 搜索页菜单含 B 站；离开搜索时若仍是 B 站则自动回到 QQ（主页不提供 B 站）
    try {
      if (p !== "search" && (S.platform === "bilibili" || S.platform === "bili")) {
        S.platform = "qq";
        try { localStorage.setItem("aq_plat", "qq"); } catch (eLs) {}
      }
      syncPlatBtn();
      renderPlatMenu();
    } catch (ePlatGo) {}

    // 子页（搜索/资料库/设置）压栈，系统返回 / 边缘手势统一回主页
    if (!opts.fromPop) {
      try {
        if (p === "home") {
          if (_subPagePushed) {
            _subPagePushed = false;
            history.replaceState({ aqPage: "home" }, "", location.pathname + location.search);
          }
        } else if (p === "search" || p === "lib" || p === "set") {
          if (!_subPagePushed) {
            history.pushState({ aqPage: p }, "", "#" + p);
            _subPagePushed = true;
          } else {
            history.replaceState({ aqPage: p }, "", "#" + p);
          }
        }
      } catch (eHist) {}
    }
  }

  function openSheet(song, list) {
    var body = $("#sheetBody");
    var mask = $("#sheetMask");
    if (!body || !mask) return;
    resetSheetBodyStyles(body);
    body.innerHTML = "";
    try { document.body.classList.add("sheet-open"); } catch (e0) {}
    [
      { t: "播放", fn: function () { play(song, list); } },
      { t: S.fav.some(function (x) { return keyOf(x) === keyOf(song); }) ? "取消喜欢" : "喜欢", fn: function () { toggleFav(song); } },
      { t: "下载", fn: function () { download(song); } },
    ].forEach(function (it) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = it.t;
      b.onclick = function (ev) {
        if (ev) { try { ev.stopPropagation(); } catch (e0) {} }
        closeSheet();
        it.fn();
      };
      body.appendChild(b);
    });
    mask.classList.add("open");
    pushSheetHistory();
  }
  // 歌单 sheet 与播放页分层占 history，互不踩：
  // - 只开歌单：#sheet，返回关歌单
  // - 歌单点播放：replaceState 把当前 #sheet 换成 #player（栈深不变），返回直接关播放页
  // - 只开播放页：push #player
  var sheetHistoryPushed = false;
  var _sheetIgnorePop = 0;
  function closeSheet(fromPop) {
    var mask = $("#sheetMask");
    var body = $("#sheetBody");
    // 若正在下滑关闭动画中，保留 transform/opacity，避免瞬间回弹残影
    var exiting = false;
    try {
      exiting = !!(body && body.style && body.style.transform &&
        body.style.transform !== "none" && body.style.transform !== "");
    } catch (eEx) {}
    if (mask) mask.classList.remove("open");
    try { document.body.classList.remove("sheet-open"); } catch (e0) {}
    if (body) {
      try {
        body.removeAttribute("data-queue-sheet");
        if (!exiting) {
          body.style.transition = "";
          body.style.transform = "";
          body.style.opacity = "";
        } else {
          // 保持离场动画到结束再清
          body.style.pointerEvents = "none";
        }
        setTimeout(function () {
          if (mask && mask.classList.contains("open")) return;
          resetSheetBodyStyles(body);
          body.innerHTML = "";
          try {
            body.style.pointerEvents = "";
            body.style.transition = "";
            body.style.transform = "";
            body.style.opacity = "";
          } catch (eClr) {}
        }, exiting ? 320 : 280);
      } catch (e) {}
    }
    if (sheetHistoryPushed && !fromPop) {
      sheetHistoryPushed = false;
      _sheetIgnorePop = 1;
      try { history.back(); } catch (e2) {}
      setTimeout(function () { _sheetIgnorePop = 0; }, 280);
    } else {
      sheetHistoryPushed = false;
    }
  }
  function pushSheetHistory() {
    if (sheetHistoryPushed) return;
    try {
      history.pushState({ aqSheet: 1, overlay: "sheet" }, "", "#sheet");
      sheetHistoryPushed = true;
    } catch (e) {
      sheetHistoryPushed = false;
    }
  }
  /** 歌单 → 播放页：用当前 history 条目替换为 #player，不额外 push、不 back */
  function promoteSheetToPlayer() {
    var mask = $("#sheetMask");
    var body = $("#sheetBody");
    if (mask) mask.classList.remove("open");
    try { document.body.classList.remove("sheet-open"); } catch (e0) {}
    if (body) {
      try {
        body.style.transition = "";
        body.style.transform = "";
        body.style.opacity = "";
        setTimeout(function () {
          if (mask && mask.classList.contains("open")) return;
          resetSheetBodyStyles(body);
          body.innerHTML = "";
        }, 280);
      } catch (e) {}
    }
    sheetHistoryPushed = false;
    try {
      history.replaceState({ aqNp: 1, overlay: "player" }, "", "#player");
      npHistoryPushed = true;
    } catch (e2) {
      try {
        history.replaceState({ aqNp: 1, overlay: "player" }, "");
        npHistoryPushed = true;
      } catch (e3) {
        npHistoryPushed = false;
      }
    }
  }

  function updateLibCounts() {
    var a = $("#cntFav"); if (a) a.textContent = (S.fav || []).length;
    var b = $("#cntRecent"); if (b) b.textContent = (S.recent || []).length;
    var c = $("#cntDl"); if (c) c.textContent = (S.dl || []).length;
    var d = $("#cntFavPl"); if (d) d.textContent = (S.favPl || []).length;
  }
  function fillLibPanel(type) {
    var panel = $("#libPanel-" + type);
    if (!panel) return;
    if (type === "favPl") {
      panel.innerHTML = "";
      var list = S.favPl || [];
      if (!list.length) {
        panel.innerHTML = '<div class="empty" style="padding:16px;font-size:13px;color:var(--label-3)">还没有收藏的歌单</div>';
        return;
      }
      list.forEach(function (pl) {
        var row = document.createElement("div");
        row.className = "song";
        row.innerHTML =
          '<img class="song-art" alt="" referrerpolicy="no-referrer"/>' +
          '<div class="song-meta"><div class="song-name"></div><div class="song-sub"></div></div>';
        var img = row.querySelector("img");
        img.onerror = function () { this.onerror = null; this.src = PLACEHOLDER; };
        img.src = pl.cover || PLACEHOLDER;
        row.querySelector(".song-name").textContent = pl.name || pl.title || "歌单";
        var srcMap = { qq: "QQ", netease: "网易", kuwo: "酷我", kugou: "酷狗", migu: "咪咕" };
        row.querySelector(".song-sub").textContent =
          (srcMap[pl.source] || pl.source || "") + " · " + (pl.kind === "toplist" ? "榜单" : "歌单");
        row.addEventListener("click", function () {
          if (pl.kind === "toplist") {
            openToplistDetail(pl);
          } else {
            openPlaylistDetail(pl);
          }
        });
        panel.appendChild(row);
      });
      return;
    }
    var map = { fav: S.fav, recent: S.recent, dl: S.dl };
    var list = map[type] || [];
    panel.innerHTML = "";
    if (!list.length) {
      panel.innerHTML = '<div class="empty" style="padding:16px 0">空空如也</div>';
      return;
    }
    list.slice(0, 80).forEach(function (s) {
      panel.appendChild(songRow(s, list));
    });
  }
  function toggleLib(type) {
    var block = document.querySelector('.lib-block[data-lib="' + type + '"]');
    if (!block) return;
    var willOpen = !block.classList.contains("open");
    // 手风琴：只开一个
    $$(".lib-block").forEach(function (b) {
      if (b !== block) b.classList.remove("open");
    });
    if (willOpen) {
      fillLibPanel(type);
      block.classList.add("open");
    } else {
      block.classList.remove("open");
    }
  }
  function renderLibRecent() {
    // 默认展开最近播放：有 open 或首次进入时填内容
    var block = document.querySelector('.lib-block[data-lib="recent"]');
    if (block && block.classList.contains("open")) fillLibPanel("recent");
  }
  function ensureLibRecentOpen() {
    var block = document.querySelector('.lib-block[data-lib="recent"]');
    if (!block) return;
    $$(".lib-block").forEach(function (b) {
      if (b !== block) b.classList.remove("open");
    });
    block.classList.add("open");
    fillLibPanel("recent");
  }
  function openLib(type) {
    go("lib");
    toggleLib(type);
  }

  /* ========== Search ========== */
  var st = null;
  var searchCache = { kw: "", song: [], singer: [], playlist: [] };
  var searchTab = "song";

  /* 歌手全部歌曲（分页，JSONP musicu） */
  async function singerSongsPage(singermid, begin, num) {
    begin = begin || 0;
    num = num || 50;
    if (!singermid) return { songs: [], total: 0 };
    var payload = {
      comm: { ct: 24, cv: 0, g_tk: 5381, uin: "0", format: "json", platform: "yqq.json" },
      req_1: {
        module: "musichall.song_list_server",
        method: "GetSingerSongList",
        param: { singerMid: singermid, begin: begin, num: num, order: 1 },
      },
    };
    try {
      var url = "https://u.y.qq.com/cgi-bin/musicu.fcg?data=" + encodeURIComponent(JSON.stringify(payload));
      var d = await jsonp(url, 12);
      var data = (d && d.req_1 && d.req_1.data) || {};
      var list = data.songList || data.songlist || [];
      var songs = list.map(function (it) {
        var s = it.songInfo || it;
        return normSong(s);
      }).filter(Boolean);
      return { songs: songs, total: data.totalNum || data.total || songs.length };
    } catch (e) {
      return { songs: [], total: 0 };
    }
  }
  async function openSingerInPage(sg) {
    var out = $("#searchOut");
    if (!out) return;
    searchTab = "singer";
    syncSearchTabs();
    out.innerHTML = "";
    var head = document.createElement("div");
    head.className = "set-hint";
    head.style.cssText = "margin:0 0 12px;display:flex;align-items:center;gap:10px;";
    head.innerHTML =
      '<img style="width:48px;height:48px;border-radius:50%;object-fit:cover;background:#eee" alt=""/>' +
      '<div style="flex:1;min-width:0">' +
      '<div style="font-size:16px;font-weight:700;color:var(--label)"></div>' +
      '<div style="font-size:12px;color:var(--label-3);margin-top:2px">加载中…</div></div>';
    var av = head.querySelector("img");
    av.referrerPolicy = "no-referrer";
    av.src = sg.cover || PLACEHOLDER;
    head.querySelector("div > div").textContent = stripEm(sg.name) || "歌手";
    out.appendChild(head);
    var listBox = document.createElement("div");
    listBox.id = "singerSongList";
    out.appendChild(listBox);
    var moreBtn = document.createElement("button");
    moreBtn.type = "button";
    moreBtn.className = "set-hint";
    moreBtn.style.cssText =
      "display:block;width:100%;margin:12px 0 20px;padding:12px;border:none;border-radius:12px;" +
      "background:var(--surface);color:var(--pink);font-size:14px;font-weight:600;cursor:pointer;font-family:inherit";
    moreBtn.textContent = "加载更多";
    out.appendChild(moreBtn);

    var all = [];
    var begin = 0;
    var total = 0;
    var loading = false;
    var mid = sg.mid || sg.singerMID || "";
    var src = sg.source || S.platform || "qq";
    // QQ 官方 mid（非 ne_ar_/kw_ar_/sg_ 等合成 id）
    var isQQMid = mid && !/^(ne_ar_|kw_ar_|kg_ar_|mg_ar_|sg_)/i.test(String(mid));

    function filterByArtist(list, name) {
      var n = String(name || "").trim().toLowerCase();
      if (!n) return list || [];
      var hit = (list || []).filter(function (s) {
        return String(s.artist || "").toLowerCase().indexOf(n) >= 0;
      });
      return hit.length ? hit : (list || []);
    }

    async function loadMore(auto) {
      if (loading) return;
      loading = true;
      moreBtn.textContent = "加载中…";
      var page = { songs: [], total: 0 };
      var pageNo = Math.floor(begin / 30) + 1;
      try {
        if (src === "bilibili" || src === "bili" || /^bili_up_/i.test(String(mid)) || sg.upMid) {
          // B站 UP 投稿列表
          var upId = sg.upMid || String(mid || "").replace(/^bili_up_/i, "");
          var pack = await searchBiliUpWorks(upId, sg.name, pageNo).catch(function () { return { songs: [], total: 0 }; });
          page = {
            songs: (pack && pack.songs) || [],
            total: (pack && pack.total) || ((pack && pack.songs && pack.songs.length) || 0),
          };
        } else if (isQQMid && (src === "qq" || !src)) {
          page = await singerSongsPage(mid, begin, 50);
        } else {
          // 其它站源 / 合成 mid：按歌手名在对应站源搜歌
          var raw = [];
          if (src === "netease") raw = await searchNetease(sg.name, pageNo).catch(function () { return []; });
          else if (src === "kuwo") raw = await searchKuwo(sg.name, pageNo).catch(function () { return []; });
          else if (src === "kugou") raw = await searchKugou(sg.name, pageNo).catch(function () { return []; });
          else if (src === "migu") raw = await searchMigu(sg.name, pageNo).catch(function () { return []; });
          else raw = await searchQQ(sg.name, pageNo).catch(function () { return []; });
          if (!raw || !raw.length) {
            raw = await searchSongs(sg.name, pageNo).catch(function () { return []; });
          }
          raw = filterByArtist(raw, sg.name);
          page = {
            songs: raw || [],
            total: (raw && raw.length >= 20) ? begin + raw.length + 30 : begin + (raw || []).length,
          };
        }
      } catch (eLoad) {
        page = { songs: [], total: 0 };
      }
      var add = page.songs || [];
      total = page.total || total;
      if (add.length) {
        var seen = {};
        all.forEach(function (s) { seen[keyOf(s)] = 1; });
        add.forEach(function (s) {
          var k = keyOf(s);
          if (seen[k]) return;
          seen[k] = 1;
          all.push(s);
          listBox.appendChild(songRow(s, all));
        });
        begin += isQQMid ? 50 : 30;
      }
      var sub = head.querySelector("div > div + div");
      if (sub) sub.textContent = all.length + (total > all.length ? " / " + total : "") + " 首 · 下滑或点加载更多";
      loading = false;
      if (!add.length || (total && all.length >= total)) {
        moreBtn.textContent = all.length ? "已加载全部" : "暂无歌曲";
        moreBtn.disabled = true;
        moreBtn.style.opacity = "0.5";
      } else {
        moreBtn.textContent = "加载更多";
        moreBtn.disabled = false;
        moreBtn.style.opacity = "1";
      }
    }
    moreBtn.onclick = function () { loadMore(false); };

    // 滚动接近底部自动加载
    var pageEl = $("#pageSearch") || out.closest(".page") || out;
    function onScroll() {
      if (loading || moreBtn.disabled) return;
      var el = pageEl;
      if (el.scrollHeight - el.scrollTop - el.clientHeight < 120) loadMore(true);
    }
    if (pageEl && !pageEl._singerScrollBound) {
      pageEl._singerScrollBound = true;
      pageEl.addEventListener("scroll", onScroll, { passive: true });
    }
    await loadMore(false);
  }
  function singerRow(sg) {
    var el = document.createElement("div");
    el.className = "singer-row";
    el.innerHTML = '<img class="singer-av" alt="" /><div class="singer-meta"><div class="singer-name"></div><div class="singer-sub"></div></div><span class="singer-arrow">›</span>';
    var img = el.querySelector(".singer-av");
    img.referrerPolicy = "no-referrer";
    img.onerror = function () { this.onerror = null; this.src = PLACEHOLDER; };
    img.src = sg.cover || PLACEHOLDER;
    el.querySelector(".singer-name").textContent = stripEm(sg.name);
    var sub = [];
    if (sg.songnum) sub.push(sg.songnum + ((sg.source === "bilibili" || sg.source === "bili") ? " 投稿" : " 首"));
    if (sg.albumnum) sub.push(sg.albumnum + " 专辑");
    el.querySelector(".singer-sub").textContent = sub.join(" · ") || ((sg.source === "bilibili" || sg.source === "bili") ? "UP主" : "歌手");
    el.addEventListener("click", function () {
      openSingerInPage(sg);
    });
    return el;
  }

  function playlistRow(pl) {
    var el = document.createElement("div");
    el.className = "pl-row";
    el.innerHTML = '<img class="pl-cover" alt="" /><div class="pl-meta"><div class="pl-name"></div><div class="pl-sub"></div></div>';
    var img = el.querySelector(".pl-cover");
    img.referrerPolicy = "no-referrer";
    img.onerror = function () { this.onerror = null; this.src = PLACEHOLDER; };
    img.src = pl.cover || PLACEHOLDER;
    el.querySelector(".pl-name").textContent = pl.name;
    el.querySelector(".pl-sub").textContent = pl.listen ? ("播放 " + pl.listen) : "歌单";
    el.addEventListener("click", function () {
      playPlaylist(pl);
    });
    return el;
  }

  function syncSearchTabs() {
    $$(".search-tab").forEach(function (t) {
      t.classList.toggle("on", t.dataset.tab === searchTab);
    });
  }

  function renderSearchTab() {
    var out = $("#searchOut");
    if (!out) return;
    out.innerHTML = "";
    var kw = searchCache.kw;
    // 热搜常驻，不随有无关键词隐藏
    try {
      var chips = $("#chips");
      if (chips) {
        chips.classList.remove("hide", "fading");
        if (!chips.childNodes.length && typeof renderChipBatch === "function") renderChipBatch();
      }
    } catch (eCh) {}

    if (!kw) {
      out.innerHTML = '<div class="empty">搜索 ' + platDisplayName() + ' 曲库 · 歌曲、歌手、歌单</div>';
      return;
    }
    if (searchTab === "song") {
      var songs = searchCache.song || [];
      if (!songs.length) {
        out.innerHTML = '<div class="empty">在 ' + platDisplayName() + ' 没有找到相关歌曲</div>';
        return;
      }
      var c1 = document.createElement("div");
      c1.className = "search-count";
      c1.textContent = platDisplayName() + " · 找到 " + songs.length + " 首歌曲";
      out.appendChild(c1);
      songs.forEach(function (s) { out.appendChild(songRow(s, songs)); });
    } else if (searchTab === "singer") {
      var singers = searchCache.singer || [];
      if (!singers.length) {
        out.innerHTML = '<div class="empty">在 ' + platDisplayName() + ' 没有找到相关歌手</div>';
        return;
      }
      var c2 = document.createElement("div");
      c2.className = "search-count";
      c2.textContent = platDisplayName() + " · 找到 " + singers.length + " 位歌手";
      out.appendChild(c2);
      singers.forEach(function (sg) { out.appendChild(singerRow(sg)); });
    } else {
      var pls = searchCache.playlist || [];
      if (!pls.length) {
        out.innerHTML = '<div class="empty">在 ' + platDisplayName() + ' 没有找到相关歌单</div>';
        return;
      }
      var c3 = document.createElement("div");
      c3.className = "search-count";
      c3.textContent = platDisplayName() + " · 找到 " + pls.length + " 个歌单";
      out.appendChild(c3);
      pls.forEach(function (p) { out.appendChild(playlistRow(p)); });
    }
  }

  var _searchSeq = 0;
  async function doSearch(forceSong) {
    var kw = ($("#qInput") && $("#qInput").value || "").trim();
    var out = $("#searchOut");
    if (!kw) {
      searchCache = { kw: "", song: [], singer: [], playlist: [] };
      out.innerHTML = '<div class="empty">搜索 ' + platDisplayName() + ' 曲库 · 歌曲、歌手、歌单</div>';
      // 清空搜索后立刻保证热搜可见（不必等切 tab）
      try {
        var chips0 = $("#chips");
        if (chips0) {
          chips0.classList.remove("hide", "fading");
          if (!chips0.childNodes.length && typeof renderChipBatch === "function") renderChipBatch();
        }
      } catch (e0) {}
      return;
    }
    var seq = ++_searchSeq;
    var platName = platDisplayName();
    out.innerHTML = '<div class="empty">正在 ' + platName + ' 搜索中…</div>';
    if (forceSong) searchTab = "song";
    syncSearchTabs();

    searchCache = { kw: kw, song: [], singer: [], playlist: [] };

    // 歌曲 / 歌手 / 歌单：全部按当前站源（B 站仅在切到 B 站时由 searchSongs 拉取）
    var pSong = searchSongs(kw).catch(function () { return []; });
    var pSinger = searchSingers(kw).catch(function () { return []; });
    // 搜索页：允许静默回退 QQ，不弹「已用 QQ」避免干扰
    var pPl = searchPlaylists(kw, { allowQQFallback: true }).catch(function () { return []; });

    pSong.then(function (songs) {
      if (seq !== _searchSeq) return;
      searchCache.song = songs || [];
      // 单曲结果里再抽一批歌手（保证歌手 tab 至少有数据）
      var songs = searchCache.song || [];
      if ((!searchCache.singer || !searchCache.singer.length) && songs && songs.length) {
        var seen = {}, extra = [];
        songs.forEach(function (s) {
          String(s.artist || "").split(/[\/、,&｜|]/).forEach(function (part) {
            var name = String(part || "").trim();
            if (!name || name === "未知" || seen[name]) return;
            seen[name] = 1;
            extra.push({
              mid: "sg_" + (s.source || "x") + "_" + name,
              name: name,
              cover: s.cover || "",
              songnum: 0, albumnum: 0, type: "singer",
              source: s.source || S.platform || "qq",
            });
          });
        });
        if (extra.length) searchCache.singer = extra;
      }
      if (searchTab === "song" || searchTab === "singer") renderSearchTab();
    });
    pSinger.then(function (singers) {
      if (seq !== _searchSeq) return;
      if (singers && singers.length) {
        // 与单曲抽出的合并去重
        var seen = {};
        var merged = [];
        (singers || []).concat(searchCache.singer || []).forEach(function (sg) {
          if (!sg || !sg.name || seen[sg.name]) return;
          seen[sg.name] = 1;
          merged.push(sg);
        });
        searchCache.singer = merged;
      }
      if (searchTab === "singer") renderSearchTab();
    });
    pPl.then(function (pls) {
      if (seq !== _searchSeq) return;
      searchCache.playlist = pls || [];
      if (searchTab === "playlist") renderSearchTab();
    });

    await Promise.all([pSong, pSinger, pPl]);
    if (seq !== _searchSeq) return;
    renderSearchTab();
  }

  /* ========== Quality ========== */
  function cycleQ() {
    openQualitySheet();
  }
  function syncSeg() {
    $$("#segQ button").forEach(function (b) { b.classList.toggle("on", b.dataset.q === S.quality); });
  }

  /* ========== 本地音源 JS 导入 ========== */
  function importLxFile(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var text = String(reader.result || "");
        if (text.length < 50) { toast("文件太短，不像音源脚本"); return; }
        if (text.length > 500000) {
          toast("文件过大，已截取前 500KB");
          text = text.slice(0, 500000);
        }
        S.lxScript = text;
        localStorage.setItem("aq_lx_script", text);

        var nm = (file.name || "LX音源").replace(/\.js$/i, "");
        var mName = text.match(/@name\s+(.+)/);
        if (mName) nm = mName[1].trim().slice(0, 40);

        // 每个脚本独立 id，可同时导入多个第三方源
        var id = "lx_" + nm.replace(/[^\w\u4e00-\u9fff]+/g, "_").slice(0, 24);
        var exists = (S.sources || []).find(function (s) {
          return s && (s.id === id || (s.name === nm && s.type === "js"));
        });
        if (exists) {
          exists.name = nm;
          exists.script = text;
          exists.lxScript = text;
          exists.type = "js";
          exists.enabled = true;
          exists.platforms = ["qq", "netease", "kugou", "kuwo", "migu"];
        } else {
          S.sources = (S.sources || []).concat([{
            id: id,
            name: nm,
            platforms: ["qq", "netease", "kugou", "kuwo", "migu"],
            type: "js",
            url: "",
            script: text,
            lxScript: text,
            enabled: true,
            builtin: false,
          }]);
        }
        saveJSON("aq_sources", S.sources);
        try { renderSrcList(); syncPlatBtn(); } catch (eR) {}

        var st = $("#lxStatus");
        if (st) st.textContent = "已导入：" + nm + "（" + Math.round(text.length / 1024) + "KB）· 已启用";
        toast("已导入并启用：" + nm);
      } catch (e) {
        console.warn(e);
        toast("导入失败");
      }
    };
    reader.readAsText(file);
  }

  /* ========== Bind ========== */
  $$(".tab").forEach(function (t) { on(t, "click", function () { go(t.dataset.p); }); });
  on($("#btnRefresh"), "click", refreshRecommend);
  on($("#btnPlat"), "click", togglePlatMenu);
  // 阻止打开按钮上的 touch/pointer 冒泡，避免「刚打开就被关掉」
  (function () {
    var btn = $("#btnPlat");
    if (!btn) return;
    ["pointerdown", "touchstart", "mousedown"].forEach(function (ev) {
      btn.addEventListener(ev, function (e) {
        try { e.stopPropagation(); } catch (err) {}
      }, true);
    });
  })();
  // 点击/触摸菜单外 → 失焦回弹关闭；打开后 400ms 内不关（防误触）
  function maybeClosePlatMenu(e) {
    if (Date.now() < (_platIgnoreCloseUntil || 0)) return;
    var wrap = $("#platWrap");
    if (!wrap || !wrap.classList.contains("open")) return;
    if (e && e.target && wrap.contains(e.target)) return;
    closePlatMenu();
  }
  document.addEventListener("click", maybeClosePlatMenu);
  // WebView / 触摸：click 常不触发，用 pointerdown + touchstart 兜底失焦关闭
  document.addEventListener("pointerdown", maybeClosePlatMenu, true);
  document.addEventListener("touchstart", maybeClosePlatMenu, { capture: true, passive: true });
  // 切页时也关掉菜单（搜索↔主页等）
  try {
    var _goPlat = go;
    go = function (p, opts) {
      try { closePlatMenu(); } catch (eCloseP) {}
      return _goPlat(p, opts);
    };
  } catch (eGoWrap) {}
  // 滚动主内容区时关闭
  (function () {
    var main = document.getElementById("main") || document.querySelector(".main") || document.querySelector("#pages");
    var targets = [main, document.getElementById("homeScroll"), document.getElementById("p-home"), document.getElementById("p-search"), document.querySelector('.page[data-p="search"]')].filter(Boolean);
    if (!targets.length) targets = [document];
    targets.forEach(function (el) {
      el.addEventListener("scroll", function () {
        if (Date.now() < (_platIgnoreCloseUntil || 0)) return;
        closePlatMenu();
      }, { passive: true });
    });
  })();
  syncPlatBtn();
  renderPlatMenu();

  on($("#mini"), "click", function (e) {
    if (e.target.closest("#miniPlay") || e.target.closest("#miniNext")) return;
    openNowPlaying();
  });
  on($("#miniPlay"), "click", function (e) { e.stopPropagation(); toggle(); });
  on($("#miniNext"), "click", function (e) { e.stopPropagation(); next(); });
  /* 收起按钮已移除；下滑手势仍可关闭播放页 */
  /* npPlay/Next/Prev/Close/Fav/Dl 由 bindTap 处理 */
  /* 进度拖动：扩大命中 + 跟手更新，避免 WebView 上卡顿不灵敏 */
  (function bindNpSeekDrag() {
    var seek = $("#npSeek");
    if (!seek) return;
    var _seeking = false;
    function applySeekFromValue(v, commit) {
      if (!audio || !audio.duration || !isFinite(audio.duration)) return;
      var p = Math.max(0, Math.min(1, Number(v) / 1000));
      var pct = (p * 100) + "%";
      seek.style.setProperty("--seek-p", pct);
      try { syncNpWaveBars(p); } catch (eSw) {}
      if (commit !== false) {
        try { audio.currentTime = p * audio.duration; } catch (eT) {}
      }
    }
    function onInput() {
      _seeking = true;
      applySeekFromValue(seek.value, true);
    }
    function onChange() {
      applySeekFromValue(seek.value, true);
      _seeking = false;
    }
    seek.addEventListener("input", onInput, { passive: true });
    seek.addEventListener("change", onChange, { passive: true });
    /* 触控跟手：直接按坐标算进度，比原生 range 在部分 WebView 更灵敏 */
    function posToValue(clientX) {
      var rect = seek.getBoundingClientRect();
      if (!rect.width) return Number(seek.value) || 0;
      var x = (clientX - rect.left) / rect.width;
      x = Math.max(0, Math.min(1, x));
      return Math.round(x * 1000);
    }
    function onTouchStart(e) {
      if (!e.touches || !e.touches[0]) return;
      _seeking = true;
      var v = posToValue(e.touches[0].clientX);
      seek.value = String(v);
      applySeekFromValue(v, true);
    }
    function onTouchMove(e) {
      if (!_seeking || !e.touches || !e.touches[0]) return;
      try { e.preventDefault(); } catch (eP) {}
      var v = posToValue(e.touches[0].clientX);
      seek.value = String(v);
      applySeekFromValue(v, true);
    }
    function onTouchEnd() {
      if (!_seeking) return;
      applySeekFromValue(seek.value, true);
      _seeking = false;
    }
    seek.addEventListener("touchstart", onTouchStart, { passive: true });
    seek.addEventListener("touchmove", onTouchMove, { passive: false });
    seek.addEventListener("touchend", onTouchEnd, { passive: true });
    seek.addEventListener("touchcancel", onTouchEnd, { passive: true });
    window._aqSeeking = function () { return _seeking; };
  })();
  function updateFavBtn() {
    var btn = $("#npFav");
    var song = S.queue && S.queue[S.idx];
    var liked = !!(song && isSongLiked(song));
    if (btn) btn.classList.toggle("liked", liked);
    // 与列表爱心双向联动
    if (song) {
      try {
        var k = keyOf(song);
        document.querySelectorAll(".song-like[data-sk], .detail-song-like[data-sk]").forEach(function (b) {
          if (b.getAttribute("data-sk") === k) b.classList.toggle("on", liked);
        });
      } catch (eL) {}
    }
  }
  /* 统一防抖：WebView 上 touchend 后仍可能合成 click，导致倍速/模式连跳、弹层双开 */
  var _tapLocks = {};
  function withTapLock(key, ms, fn) {
    return function (e) {
      if (e) {
        try { e.preventDefault(); e.stopPropagation(); } catch (e0) {}
      }
      var now = Date.now();
      if (now < (_tapLocks[key] || 0)) return;
      _tapLocks[key] = now + (ms || 400);
      try { fn(e); } catch (e1) { console.warn(e1); }
    };
  }
  function onFavTap(e) {
    if (e) { try { e.stopPropagation(); } catch (e0) {} }
    var song = S.queue[S.idx];
    if (!song) return;
    toggleFav(song);
    updateFavBtn();
  }
  var SPEED_STEPS = [0.75, 1, 1.25, 1.5, 2];
  function currentSpeed() {
    return Number(audio.playbackRate) || 1;
  }
  function syncSpeedBtn() {
    var lab = $("#npSpeedLabel");
    var btn = $("#npSpeed");
    var r = currentSpeed();
    if (lab) lab.textContent = (r === 1 ? "1.0" : String(r)) + "x";
    if (btn) btn.classList.toggle("on", r !== 1);
  }
  function cycleSpeed(e) {
    if (e) { try { e.stopPropagation(); } catch (e0) {} }
    var r = currentSpeed();
    var i = SPEED_STEPS.indexOf(r);
    if (i < 0) i = 1;
    var next = SPEED_STEPS[(i + 1) % SPEED_STEPS.length];
    try { audio.playbackRate = next; } catch (err) {}
    syncSpeedBtn();
    toast("倍速 " + (next === 1 ? "1.0" : next) + "x");
  }
  var favEl = $("#npFav");
  var speedEl = $("#npSpeed");
  if (favEl) {
    var onFav = withTapLock("fav", 350, onFavTap);
    favEl.onclick = onFav;
    favEl.ontouchend = onFav;
  }
  if (speedEl) {
    var onSpeed = withTapLock("speed", 350, cycleSpeed);
    speedEl.onclick = onSpeed;
    speedEl.ontouchend = onSpeed;
  }
  syncSpeedBtn();
  var qEl = $("#npQuality");
  if (qEl) {
    var onQ = withTapLock("quality", 400, function () { cycleQ(); });
    qEl.onclick = onQ;
    qEl.ontouchend = onQ;
  }
  try { bindNpMore(); } catch (eMore) { console.warn(eMore); }
  var queueEl = $("#npQueue");
  if (queueEl) {
    var onQueueBtn = withTapLock("queue", 400, function () { openQueueSheet(); });
    queueEl.addEventListener("click", onQueueBtn);
    queueEl.addEventListener("touchend", onQueueBtn, { passive: false });
  }
  var modeEl = $("#npMode");
  if (modeEl) {
    var onMode = withTapLock("mode", 350, function () { cyclePlayMode(); });
    modeEl.onclick = onMode;
    modeEl.ontouchend = onMode;
  }
  var sleepEl = $("#npSleep");
  if (sleepEl) {
    var onSleep = withTapLock("sleep", 400, function () { openSleepSheet(); });
    sleepEl.onclick = onSleep;
    sleepEl.ontouchend = onSleep;
  }
  try { syncModeBtn(); } catch (eM) {}
  try { syncSleepBtn(); } catch (eS) {}
  // 定时剩余分钟刷新
  setInterval(function () { try { syncSleepBtn(); } catch (e) {} }, 30000);
  $("#npPlay") && ($("#npPlay").onclick = function (e) { e.stopPropagation(); toggle(); });
  $("#npNext") && ($("#npNext").onclick = function (e) { e.stopPropagation(); next(); });
  $("#npPrev") && ($("#npPrev").onclick = function (e) { e.stopPropagation(); prev(); });
  // 播放时刷新喜欢状态
  var _paint = paintNow;
  paintNow = function (song) {
    _paint(song);
    updateFavBtn();
  };

  on($("#qInput"), "input", function () {
    clearTimeout(st);
    var v = ($("#qInput") && $("#qInput").value || "").trim();
    // 清空时立刻露出热搜，不必等防抖 / 切 tab
    if (!v) {
      try {
        var chips = $("#chips");
        if (chips) {
          chips.classList.remove("hide", "fading");
          if (!chips.childNodes.length) renderChipBatch();
        }
        var out0 = $("#searchOut");
        if (out0 && !(searchCache && searchCache.kw)) {
          /* keep */
        }
      } catch (eI) {}
    }
    st = setTimeout(function () { doSearch(); }, 450);
  });
  on($("#qInput"), "keydown", function (e) { if (e.key === "Enter") { clearTimeout(st); doSearch(); } });
  $$(".search-tab").forEach(function (tab) {
    on(tab, "click", function () {
      searchTab = tab.dataset.tab || "song";
      syncSearchTabs();
      renderSearchTab();
    });
  });

  // 热搜词库：星星闪——每 3 秒随机几个消失再换词出现
  var CHIP_POOL = [
    "晴天", "海阔天空", "演员", "起风了", "光年之外", "孤勇者", "稻香", "消愁",
    "夜曲", "七里香", "告白气球", "青花瓷", "安静", "回到过去", "特别的人", "像我这样的人",
    "成全", "体面", "句号", "多远都要在一起", "红色高跟鞋", "小幸运", "理想三旬", "成都",
    "董小姐", "南山南", "泡沫", "画面太美", "热歌", "抖音", "流行", "怀旧",
    "英文歌", "说唱", "民谣", "摇滚"
  ];
  var _chipTimer = 0;
  function chipBatchSize() {
    // 缩小后大约每行 4 个，固定两行
    var w = (window.innerWidth || 375);
    if (w >= 600) return 8;
    if (w >= 380) return 8;
    return 6;
  }
  function bindChipClick(c, w) {
    c.onclick = function () {
      var inp = $("#qInput");
      if (inp) inp.value = w;
      go("search");
      doSearch();
    };
  }
  function renderChipBatch() {
    var host = $("#chips");
    if (!host || host.classList.contains("hide")) return;
    var n = chipBatchSize();
    // 随机抽 n 个不重复词
    var pool = CHIP_POOL.slice();
    for (var i = pool.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = pool[i]; pool[i] = pool[j]; pool[j] = t;
    }
    host.innerHTML = "";
    host.classList.remove("fading");
    pool.slice(0, n).forEach(function (w) {
      var c = document.createElement("button");
      c.type = "button";
      c.className = "chip";
      c.textContent = w;
      bindChipClick(c, w);
      host.appendChild(c);
    });
  }
  function twinkleChips() {
    var host = $("#chips");
    if (!host || document.hidden) return;
    var chips = host.querySelectorAll(".chip");
    if (!chips.length) return;
    // 静默换词：不透明度/缩放动画，避免「弹回」感
    var flashN = Math.min(chips.length, 2 + Math.floor(Math.random() * 3));
    var picked = [];
    while (picked.length < flashN) {
      var ix = Math.floor(Math.random() * chips.length);
      if (picked.indexOf(ix) < 0) picked.push(ix);
    }
    var shown = {};
    for (var s = 0; s < chips.length; s++) shown[chips[s].textContent] = true;
    picked.forEach(function (ix) {
      var el = chips[ix];
      if (!el) return;
      var candidates = CHIP_POOL.filter(function (w) { return !shown[w]; });
      if (!candidates.length) candidates = CHIP_POOL.slice();
      var w = candidates[Math.floor(Math.random() * candidates.length)];
      shown[el.textContent] = false;
      shown[w] = true;
      el.textContent = w;
      bindChipClick(el, w);
    });
  }
  function startChipRotate() {
    renderChipBatch();
    if (_chipTimer) clearInterval(_chipTimer);
    _chipTimer = setInterval(function () {
      var host = $("#chips");
      if (!host || document.hidden) return;
      twinkleChips();
    }, 3200);
  }
  startChipRotate();
  // 仅宽度跨档时补一次数量，避免频繁重建抖动
  var _chipLastN = 0;
  try { _chipLastN = chipBatchSize(); } catch (eN) {}
  window.addEventListener("resize", function () {
    try {
      var n = typeof chipBatchSize === "function" ? chipBatchSize() : 0;
      if (n && n !== _chipLastN) {
        _chipLastN = n;
        renderChipBatch();
      }
    } catch (e) {}
  });

  $$(".lib-block").forEach(function (block) {
    var head = block.querySelector(".lib-item");
    if (!head) return;
    on(head, "click", function () {
      toggleLib(block.dataset.lib);
    });
  });

  $$("#segQ button").forEach(function (b) {
    on(b, "click", function () {
      applyDraft(function () {
        S.quality = b.dataset.q;
        syncSeg();
      });
      toast("音质：" + qLabel(S.quality) + "（未保存）");
    });
  });
  function syncAutoQSeg() {
    $$("#segAutoQ button").forEach(function (b) {
      var on = b.dataset.on === "1";
      b.classList.toggle("on", on === !!S.autoQDowngrade);
    });
  }
  $$("#segAutoQ button").forEach(function (b) {
    on(b, "click", function () {
      applyDraft(function () {
        S.autoQDowngrade = b.dataset.on === "1";
        syncAutoQSeg();
      });
      toast(S.autoQDowngrade ? "音质自动降级：开（未保存）" : "音质自动降级：关（未保存）");
    });
  });
  try { syncAutoQSeg(); } catch (eAQ) {}

  function themeIsNight() {
    var h = new Date().getHours();
    return h >= 18 || h < 6;
  }
  function resolveThemeDark(theme) {
    theme = theme || S.theme || "light";
    if (theme === "dark") return true;
    if (theme === "light") return false;
    if (theme === "auto") return themeIsNight();
    if (theme === "system") {
      try {
        return !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
      } catch (e) { return false; }
    }
    return false;
  }
  var _themeMedia = null;
  var _themeAutoTimer = null;
  function applyTheme(theme, silent) {
    if (theme !== "dark" && theme !== "light" && theme !== "system" && theme !== "auto") theme = "light";
    S.theme = theme;
    persistSetting("aq_theme", theme);
    var dark = resolveThemeDark(theme);
    document.documentElement.classList.toggle("dark", dark);
    $$("#segTheme button").forEach(function (b) {
      b.classList.toggle("on", b.dataset.theme === theme);
    });
    // 跟随系统
    try {
      if (_themeMedia) {
        _themeMedia.removeEventListener("change", _onSystemTheme);
        _themeMedia = null;
      }
    } catch (e0) {}
    if (theme === "system" && window.matchMedia) {
      try {
        _themeMedia = window.matchMedia("(prefers-color-scheme: dark)");
        _themeMedia.addEventListener("change", _onSystemTheme);
      } catch (e1) {
        try {
          _themeMedia = window.matchMedia("(prefers-color-scheme: dark)");
          _themeMedia.addListener(_onSystemTheme);
        } catch (e2) {}
      }
    }
    // 自动：每分钟检查一次，跨过 6/18 点切换
    try {
      if (_themeAutoTimer) { clearInterval(_themeAutoTimer); _themeAutoTimer = null; }
    } catch (e3) {}
    if (theme === "auto") {
      _themeAutoTimer = setInterval(function () {
        if (S.theme !== "auto") return;
        var want = resolveThemeDark("auto");
        var has = document.documentElement.classList.contains("dark");
        if (want !== has) document.documentElement.classList.toggle("dark", want);
      }, 60000);
    }
    // 主题切换后按当前氛围色重算播放页字色对比度
    try {
      if (typeof syncNpUiContrast === "function" && _ambientCur) {
        syncNpUiContrast(_ambientCur, {
          r: Math.min(255, (_ambientCur.r || 120) + 40),
          g: Math.min(255, (_ambientCur.g || 120) + 40),
          b: Math.min(255, (_ambientCur.b || 120) + 40),
        });
      }
    } catch (eUi2) {}
    if (!silent) {
      var lab = { light: "浅色", dark: "暗色", system: "跟随系统", auto: "自动（晚6点–早6点暗色）" };
      try { toast("外观：" + (lab[theme] || theme)); } catch (eT) {}
    }
  }
  function _onSystemTheme() {
    if (S.theme !== "system") return;
    document.documentElement.classList.toggle("dark", resolveThemeDark("system"));
    try {
      if (typeof syncNpUiContrast === "function" && _ambientCur) {
        syncNpUiContrast(_ambientCur, {
          r: Math.min(255, (_ambientCur.r || 120) + 40),
          g: Math.min(255, (_ambientCur.g || 120) + 40),
          b: Math.min(255, (_ambientCur.b || 120) + 40),
        });
      }
    } catch (eUi3) {}
  }
  $$("#segTheme button").forEach(function (b) {
    on(b, "click", function () {
      applyDraft(function () { applyTheme(b.dataset.theme, true); });
      var lab = { light: "浅色", dark: "暗色", system: "跟随系统", auto: "自动" };
      toast("外观：" + (lab[b.dataset.theme] || b.dataset.theme) + "（未保存）");
    });
  });
  try {
    applyTheme(cfg("aq_theme", "light"), true);
  } catch (eTh) {}

  /* —— 星轨：暂停直线 / 播放起浪，小波密浪从右向左飘 —— */
  var _orbitRaf = 0;
  var _orbitPhase = 0;
  var _orbitLastTs = 0;
  var _orbitProg = 0;
  var _orbitAmp = 0;           // 当前波幅（0=直线）
  var _orbitAmpTarget = 0;     // 目标波幅
  var ORBIT_CYCLES = 18;
  var ORBIT_AMP_MAX = 2.4;     // 播放时最大波高（更小更密）
  var ORBIT_MID = 24;
  var ORBIT_W = 400;
  var ORBIT_H = 48;
  var ORBIT_PHASE_SPEED = (Math.PI * 2) / 4.5; // ~4.5s 一圈，右→左
  var ORBIT_AMP_LERP = 6.5;    // 起浪/收浪速度

  function buildOrbitSinePath(phase, amp) {
    return buildOrbitSinePathRange(phase, amp, 0, 1);
  }
  /** 画从 t0→t1（0~1）的浪段，用于已播变色 */
  function buildOrbitSinePathRange(phase, amp, t0, t1) {
    amp = amp == null ? 0 : amp;
    phase = phase || 0;
    t0 = Math.max(0, Math.min(1, t0 == null ? 0 : t0));
    t1 = Math.max(0, Math.min(1, t1 == null ? 1 : t1));
    if (t1 <= t0) t1 = Math.min(1, t0 + 0.001);
    if (amp < 0.05) {
      var x0 = t0 * ORBIT_W, x1 = t1 * ORBIT_W;
      return "M " + x0.toFixed(2) + " " + ORBIT_MID.toFixed(2) + " L " + x1.toFixed(2) + " " + ORBIT_MID.toFixed(2);
    }
    var segs = Math.max(8, Math.ceil(200 * (t1 - t0)));
    var d = "";
    for (var i = 0; i <= segs; i++) {
      var t = t0 + (i / segs) * (t1 - t0);
      var x = t * ORBIT_W;
      var y = ORBIT_MID + Math.sin(t * ORBIT_CYCLES * Math.PI * 2 + phase) * amp;
      d += (i === 0 ? "M " : " L ") + x.toFixed(2) + " " + y.toFixed(2);
    }
    return d;
  }
  function orbitYAt(progress, phase, amp) {
    amp = amp == null ? 0 : amp;
    if (amp < 0.05) return ORBIT_MID;
    return ORBIT_MID + Math.sin((progress || 0) * ORBIT_CYCLES * Math.PI * 2 + (phase || 0)) * amp;
  }
  function paintOrbitWave(p, phase, amp) {
    p = Math.max(0, Math.min(1, p || 0));
    phase = phase || 0;
    amp = amp == null ? _orbitAmp : amp;
    var dim = document.getElementById("npOrbitDim");
    var lit = document.getElementById("npOrbitLit");
    var head = document.getElementById("npOrbitHead");
    var fullPath = buildOrbitSinePath(phase, amp);
    if (dim) {
      dim.setAttribute("d", fullPath);
      try { dim.removeAttribute("pathLength"); } catch (e0) {}
    }
    if (lit) {
      // 已播段：只画 0→p 的路径（不依赖 pathLength/dash，WebView 更稳）
      var playedPath = buildOrbitSinePathRange(phase, amp, 0, Math.max(p, 0.0008));
      lit.setAttribute("d", playedPath);
      try { lit.removeAttribute("pathLength"); } catch (e1) {}
      try { lit.removeAttribute("stroke-dasharray"); } catch (e2) {}
      try { lit.removeAttribute("stroke-dashoffset"); } catch (e3) {}
    }
    if (head) {
      head.style.left = (p * 100) + "%";
      head.style.top = ((orbitYAt(p, phase, amp) / ORBIT_H) * 100) + "%";
    }
  }
  function tickOrbitAnim(ts) {
    if (!_orbitRaf) return;
    if (!_orbitLastTs) _orbitLastTs = ts;
    var dt = (ts - _orbitLastTs) / 1000;
    if (dt < 0) dt = 0;
    if (dt > 0.05) dt = 0.05;
    _orbitLastTs = ts;

    // 波幅平滑过渡：播放起浪 / 暂停收成直线
    var diff = _orbitAmpTarget - _orbitAmp;
    if (Math.abs(diff) > 0.01) {
      var step = Math.min(1, dt * ORBIT_AMP_LERP);
      _orbitAmp += diff * step;
    } else {
      _orbitAmp = _orbitAmpTarget;
    }

    // 仅有浪时相位从右向左推进
    if (_orbitAmp > 0.05) {
      _orbitPhase += dt * ORBIT_PHASE_SPEED;
      if (_orbitPhase > Math.PI * 2) _orbitPhase -= Math.PI * 2;
    }

    try {
      var p = _orbitProg;
      if (typeof audio !== "undefined" && audio && audio.duration && isFinite(audio.duration) && audio.duration > 0) {
        p = Math.max(0, Math.min(1, (audio.currentTime || 0) / audio.duration));
        _orbitProg = p;
      }
      paintOrbitWave(p, _orbitPhase, _orbitAmp);
    } catch (eOr) {}

    // 收浪完成后若目标为 0，可停 rAF（保持直线）
    if (_orbitAmpTarget <= 0 && _orbitAmp < 0.05) {
      _orbitAmp = 0;
      try { paintOrbitWave(_orbitProg, _orbitPhase, 0); } catch (eF) {}
      _orbitRaf = 0;
      _orbitLastTs = 0;
      return;
    }
    _orbitRaf = requestAnimationFrame(tickOrbitAnim);
  }
  function startOrbitAnim() {
    try {
      if ((S.npSeekStyle || "bar") !== "orbit") return;
    } catch (eS) { return; }
    _orbitAmpTarget = ORBIT_AMP_MAX;
    if (_orbitRaf) return;
    _orbitLastTs = 0;
    _orbitRaf = requestAnimationFrame(tickOrbitAnim);
  }
  function stopOrbitAnim() {
    // 不立刻杀 rAF：目标波幅归零，平滑收成直线
    _orbitAmpTarget = 0;
    if (!_orbitRaf) {
      // 已停着：直接画直线
      _orbitAmp = 0;
      try { paintOrbitWave(_orbitProg, _orbitPhase, 0); } catch (eP) {}
      return;
    }
    // rAF 继续跑直到收浪结束
  }
  function syncOrbitAnimState(playing) {
    var isOrbit = false;
    try { isOrbit = (S.npSeekStyle || "bar") === "orbit"; } catch (e0) {}
    if (!isOrbit) {
      _orbitAmpTarget = 0;
      _orbitAmp = 0;
      if (_orbitRaf) {
        try { cancelAnimationFrame(_orbitRaf); } catch (eC) {}
        _orbitRaf = 0;
        _orbitLastTs = 0;
      }
      try { paintOrbitWave(_orbitProg, _orbitPhase, 0); } catch (eP) {}
      return;
    }
    if (playing) startOrbitAnim();
    else stopOrbitAnim();
  }

    function syncNpSeekVisual(p) {
    p = Math.max(0, Math.min(1, p || 0));
    var style = S.npSeekStyle || "bar";
    var pct = (p * 100) + "%";
    if (style === "heart") {
      var wave = $("#npWave");
      if (!wave) return;
      var bars = wave.querySelectorAll("i");
      if (!bars.length) return;
      var nb = bars.length;
      var onN = Math.max(0, Math.min(nb, Math.round(p * nb)));
      for (var i = 0; i < nb; i++) {
        var el = bars[i];
        var played = i < onN;
        el.classList.toggle("on", played);
        // 用预设随机高度，已播抬高、未播压低，避免周期性「一排很齐」
        var base = parseFloat(el.getAttribute("data-h") || "30") || 30;
        if (el.classList.contains("gap")) {
          el.style.height = "6%";
          el.style.opacity = played ? "0.2" : "0.12";
          continue;
        }
        if (played) {
          el.style.height = Math.max(16, Math.min(100, Math.round(base))) + "%";
          el.style.opacity = "1";
        } else {
          el.style.height = Math.max(8, Math.min(26, Math.round(base * 0.28))) + "%";
          el.style.opacity = "0.55";
        }
      }
      return;
    }
    if (style === "orbit") {
      _orbitProg = p;
      // 统一走 paint，保证已播段路径与全浪同步
      paintOrbitWave(p, _orbitPhase, _orbitAmp);
      return;
    }
    if (style === "glow") {
      var gf = $("#npGlowFill");
      if (gf) gf.style.width = pct;
    }
  }
  function syncNpWaveBars(p) { syncNpSeekVisual(p); }
  function applyNpSeekStyle(style, silent) {
    var allowed = { bar: 1, heart: 1, orbit: 1, glow: 1 };
    if (!allowed[style]) style = "orbit";
    S.npSeekStyle = style;
    S.npWave = style === "heart"; // 兼容旧逻辑
    persistSetting("aq_np_seek", style);
    var wrap = $("#npSeekWrap") || document.querySelector(".np-seek");
    if (wrap) {
      wrap.classList.remove("wave-mode", "seek-heart", "seek-orbit", "seek-glow", "seek-bar", "seek-capsule");
      if (style === "heart") wrap.classList.add("seek-heart");
      else if (style === "orbit") wrap.classList.add("seek-orbit");
      else if (style === "glow") wrap.classList.add("seek-glow");
      else wrap.classList.add("seek-bar");
    }
    var playing = false;
    try { playing = !!(audio && !audio.paused); } catch (eP) {}
    try {
      var wave = $("#npWave");
      if (wave) wave.classList.toggle("is-playing", style === "heart" && playing);
      var orb = $("#npOrbit");
      if (orb) orb.classList.toggle("is-playing", style === "orbit" && playing);
      var gl = $("#npGlow");
      if (gl) gl.classList.toggle("is-playing", style === "glow" && playing);
      try { syncOrbitAnimState(!!(style === "orbit" && playing)); } catch (eOrB) {}
    } catch (e2) {}
    $$("#segNpSeek button").forEach(function (b) {
      b.classList.toggle("on", b.dataset.seek === style);
    });
    try {
      if (audio && audio.duration) syncNpSeekVisual(audio.currentTime / audio.duration);
      else syncNpSeekVisual(0);
    } catch (e3) {}
    if (!silent) {
      var lab = { bar: "普通", heart: "心率", orbit: "星轨", glow: "光轨" };
      try { toast("进度条：" + (lab[style] || style)); } catch (eT) {}
    }
  }
  function applyNpWave(on, silent) {
    applyNpSeekStyle(on ? "heart" : "bar", silent);
  }

  function applyNpStyle(style) {
    style = style === "immersive" ? "immersive" : "classic";
    S.npStyle = style;
    persistSetting("aq_np_style", style);
    var np = $("#np");
    if (np) {
      // 只切换样式 class，绝不打开播放页（避免设置里切换时偶发全屏弹出）
      var wasOpen = np.classList.contains("open");
      np.classList.toggle("immersive", style === "immersive");
      if (!wasOpen) {
        np.classList.remove("open", "closing", "lyrics-full");
        np.style.transform = "";
        np.style.opacity = "";
        np.style.transition = "";
      }
    }
    $$("#segNpStyle button").forEach(function (b) {
      b.classList.toggle("on", b.dataset.np === style);
    });
    // 切换样式后按当前封面重算取色（沉浸用暗色、经典用亮色）
    try {
      var song = S.queue && S.queue[S.idx];
      var cover = song ? songCover(song) : "";
      if (cover) {
        extractCoverColor(cover).then(function (rgb) {
          if (rgb) animateAmbientTo(rgb);
        });
      }
    } catch (eRe) {}
  }
  $$("#segNpStyle button").forEach(function (b) {
    on(b, "click", function (ev) {
      if (ev) { try { ev.preventDefault(); ev.stopPropagation(); } catch (e1) {} }
      applyDraft(function () { applyNpStyle(b.dataset.np); });
      toast(b.dataset.np === "immersive" ? "播放页：沉浸模式（未保存）" : "播放页：经典模式（未保存）");
    });
  });
  try { applyNpStyle(cfg("aq_np_style", "classic")); } catch (eNp) {}
  $$("#segNpSeek button").forEach(function (b) {
    on(b, "click", function () {
      applyDraft(function () { applyNpSeekStyle(b.dataset.seek || "bar"); });
    });
  });
  try {
    var sk = cfg("aq_np_seek", "");
    if (!sk) {
      var legacy = ls("aq_np_wave", "");
      if (legacy === "0") sk = "bar";
      else if (legacy === "1") sk = "heart";
      else sk = "orbit";
    }
    if (sk === "capsule") sk = "orbit";
    applyNpSeekStyle(sk, true);
  } catch (eNw) {}

  var AUTO_PLAY_NAMES = { off: "关闭", guess: "猜你喜欢", rec: "为你推荐", playlist: "随机歌单", rank: "随机榜单" };
  function syncAutoPlaySeg() {
    var key = S.resumeLast ? (S.autoPlaySrc || "guess") : "off";
    if (key !== "off" && !AUTO_PLAY_NAMES[key]) key = "guess";
    $$("#segAutoPlay button").forEach(function (b) {
      b.classList.toggle("on", b.dataset.src === key);
    });
    if (!S.resumeLast) hideAutoPlayBar();
  }
  function hideAutoPlayBar() {}
  function showAutoPlayBar(msg) {}
    function applyAutoPlayChoice(src, silent) {
    src = src || "off";
    if (src === "off") {
      S.resumeLast = false;
      persistSetting("aq_resume", "0");
      hideAutoPlayBar();
      syncAutoPlaySeg();
      return;
    }
    if (!AUTO_PLAY_NAMES[src] || src === "off") src = "guess";
    S.resumeLast = true;
    S.autoPlaySrc = src;
    persistSetting("aq_resume", "1");
    persistSetting("aq_auto_src", src);
    syncAutoPlaySeg();
  }
  function turnOffAutoPlay(alsoPause) {
    applyAutoPlayChoice("off", true);
    if (alsoPause) {
      try {
        if (audio && !audio.paused) audio.pause();
        if (typeof setPlaying === "function") setPlaying(false);
      } catch (e3) {}
    }
  }
  $$("#segAutoPlay button").forEach(function (b) {
    on(b, "click", function () {
      applyDraft(function () { applyAutoPlayChoice(b.dataset.src || "off", true); });
    });
  });
  try { syncAutoPlaySeg(); } catch (eRs) {}
  function syncResumeSeg() { syncAutoPlaySeg(); }
  function syncAutoPlaySrcSeg() { syncAutoPlaySeg(); }

  /* —— 音源列表 UI —— */
  var PLATFORM_LABEL = { qq: "QQ", netease: "网易", kugou: "酷狗", kuwo: "酷我", migu: "咪咕" };
  var SRC_Q_LEVELS = [
    { q: "128k", lab: "128k" },
    { q: "320k", lab: "320k" },
    { q: "flac", lab: "flac" },
    { q: "hires", lab: "hires" },
    { q: "master", lab: "master" },
  ];

  function renderSrcList() {
    var box = $("#srcList");
    if (!box) return;
    box.innerHTML = "";
    (S.sources || []).forEach(function (src, idx) {
      var card = document.createElement("div");
      card.className = "src-card" + (src.enabled ? "" : " disabled");
      var plats = srcPlatforms(src);
      if (!plats.length) plats = ["qq"];

      // 平台芯片：与测试结果联动（绿/红）
      var platRowHtml = '<div class="src-plat-row">';
      plats.forEach(function (p) {
        var st = src._platmap && src._platmap[p];
        var cls = st === true ? "ok" : st === false ? "fail" : (src._testing ? "testing" : "");
        platRowHtml += '<span class="src-platchip ' + cls + '">' + (PLATFORM_LABEL[p] || p) + "</span>";
      });
      platRowHtml += "</div>";

      // 右侧音质芯片（与平台测试联动：通过则绿）
      var sideHtml = "";
      if (src._qmap && typeof src._qmap === "object") {
        SRC_Q_LEVELS.forEach(function (lv) {
          var st = src._qmap[lv.q];
          var cls = st === true ? "ok" : st === false ? "fail" : (src._testing ? "testing" : "");
          sideHtml += '<span class="src-qchip ' + cls + '">' + lv.lab + "</span>";
        });
      } else if (src._testing) {
        sideHtml = '<span class="src-qchip testing">测试中…</span>';
      } else {
        sideHtml = '<span class="src-side-empty">未测</span>';
      }

      card.innerHTML =
        '<div class="src-main">' +
        '<div class="src-top">' +
        '<div class="src-check-wrap">' +
        '<button type="button" class="src-switch' + (src.enabled ? " on" : "") + '" role="switch" aria-checked="' + (src.enabled ? "true" : "false") + '" aria-label="启用音源"></button>' +
        '<div class="src-name"></div></div></div>' +
        '<div class="src-meta"></div>' +
        '<div class="src-actions"></div>' +
        "</div>" +
        '<div class="src-side">' + sideHtml + "</div>";
      card.querySelector(".src-name").textContent = src.name;
      card.querySelector(".src-meta").innerHTML = platRowHtml;
      var sw = card.querySelector(".src-switch");
      sw.onclick = function (ev) {
        try { ev.preventDefault(); ev.stopPropagation(); } catch (e0) {}
        src.enabled = !src.enabled;
        // 写回时去掉运行态，避免把「测试中」写进本地
        try {
          var snap = (S.sources || []).map(function (s) {
            if (!s) return s;
            var o = Object.assign({}, s);
            delete o._testing;
            delete o._testToken;
            return o;
          });
          saveJSON("aq_sources", snap);
        } catch (eSv) {
          saveJSON("aq_sources", S.sources);
        }
        renderSrcList();
        try { syncPlatBtn(); } catch (e) {}
        try {
          var n = (S.sources || []).filter(function (x) { return x && x.enabled; }).length;
          toast(src.enabled
            ? ("已启用 " + src.name + " · 立即生效（当前 " + n + " 个源）")
            : ("已禁用 " + src.name + " · 立即生效，播放不再使用"));
        } catch (e2) {}
      };
      var actions = card.querySelector(".src-actions");
      function mkBtn(text, cls, fn) {
        var b = document.createElement("button");
        b.type = "button";
        if (cls) b.className = cls;
        b.textContent = text;
        b.onclick = fn;
        actions.appendChild(b);
        return b;
      }
      mkBtn("编辑", "", function () { editSrc(idx); });
      var testBtn = mkBtn(src._testing ? "测试中" : "测试", "primary", function () {
        if (src._testing) return;
        testOneSource(src, idx);
      });
      if (src._testing) testBtn.disabled = true;
      if (!src.builtin) {
        mkBtn("删除", "danger", function () {
          S.sources.splice(idx, 1);
          saveJSON("aq_sources", S.sources);
          renderSrcList();
          try { syncPlatBtn(); } catch (e) {}
        });
      }
      mkBtn("上移", "", function () {
        if (idx <= 0) return;
        var t = S.sources[idx - 1];
        S.sources[idx - 1] = S.sources[idx];
        S.sources[idx] = t;
        saveJSON("aq_sources", S.sources);
        renderSrcList();
      });
      box.appendChild(card);
    });
  }

  // 与真实播放一致：不设 crossOrigin（很多音频 CDN 无 CORS，但 <audio> 仍可播）
  function probeAudioUrl(url, ms) {
    ms = ms || 8000;
    return new Promise(function (resolve) {
      if (!url || !/^https?:\/\//i.test(String(url))) return resolve(false);
      var done = false;
      var a = new Audio();
      var timer = null;
      function finish(ok) {
        if (done) return;
        done = true;
        try { clearTimeout(timer); } catch (e) {}
        try {
          a.onloadeddata = null;
          a.oncanplay = null;
          a.oncanplaythrough = null;
          a.onerror = null;
          a.pause();
          a.removeAttribute("src");
          a.load();
        } catch (e2) {}
        resolve(!!ok);
      }
      try {
        a.preload = "auto";
        timer = setTimeout(function () { finish(false); }, ms);
        a.onloadeddata = function () { finish(true); };
        a.oncanplay = function () { finish(true); };
        a.oncanplaythrough = function () { finish(true); };
        a.onerror = function () { finish(false); };
        a.src = String(url);
        try { a.load(); } catch (e3) {}
        var p = null;
        try { p = a.play(); } catch (e4) {}
        if (p && typeof p.then === "function") {
          p.then(function () {
            try { a.pause(); } catch (e5) {}
            finish(true);
          }).catch(function () {});
        }
      } catch (e6) {
        finish(false);
      }
    });
  }

  /** 测试判定：拿到 URL 且 CDN/接口档位必须达到请求档（严格，避免 flac 冒充母带） */
  function qualityUrlPass(url, wantQ) {
    if (!url || !/^https?:\/\//i.test(String(url))) return false;
    var actual = detectQualityFromUrl(url);
    // 长青等中转 URL 带 level=lossless 时，detect 会得到 flac；请求母带/Hi-Res 必须判失败
    if (!actual) {
      // 认不出档位：仅当请求本身是中低档才放行（避免假高音质全绿）
      if (wantQ === "master" || wantQ === "hires" || wantQ === "flac24bit") return false;
      return true;
    }
    return qualityMeets(actual, wantQ);
  }

  async function testOneSource(src, idx) {
    if (!src || src._testing) return;
    // 仅锁当前源，其它源完全不动
    var token = (src._testToken || 0) + 1;
    src._testToken = token;
    src._testing = true;
    src._qmap = {};
    src._platmap = {};
    SRC_Q_LEVELS.forEach(function (lv) { src._qmap[lv.q] = null; });
    (srcPlatforms(src) || []).forEach(function (p) { src._platmap[p] = null; });
    renderSrcList();
    var tipSong = (function () {
      var ps = srcPlatforms(src);
      if (ps.indexOf("netease") >= 0 && ps.indexOf("qq") < 0) return "海阔天空";
      return "晴天";
    })();
    toast("正在测试「" + (src.name || "音源") + "」· " + tipSong);
    try {
      await testSourceQualities(src, token);
    } catch (e) {
      if (src._testToken === token) {
        SRC_Q_LEVELS.forEach(function (lv) {
          if (src._qmap[lv.q] == null) src._qmap[lv.q] = false;
        });
      }
    } finally {
      // 无论成功/失败/中断，只要是本轮 token，一定解除「测试中」
      if (src._testToken === token) {
        src._testing = false;
        try {
          // 持久化时去掉运行态，避免刷新后卡死
          var snap = (S.sources || []).map(function (s) {
            if (!s) return s;
            var o = Object.assign({}, s);
            delete o._testing;
            delete o._testToken;
            return o;
          });
          saveJSON("aq_sources", snap);
        } catch (eSv) {}
        renderSrcList();
        var okN = 0;
        SRC_Q_LEVELS.forEach(function (lv) { if (src._qmap && src._qmap[lv.q]) okN++; });
        toast((src.name || "音源") + "：通过 " + okN + "/" + SRC_Q_LEVELS.length);
      }
    }
  }

  function probeSongForPlatform(plat) {
    if (plat === "netease") {
      return { mid: "347230", song: { name: "海阔天空", artist: "Beyond", songmid: "347230", id: "347230", source: "netease" } };
    }
    if (plat === "kugou") {
      return { mid: "8aad0c9e49b9cfc9c7f87a1321f5e82e", song: { name: "海阔天空", artist: "Beyond", songmid: "8aad0c9e49b9cfc9c7f87a1321f5e82e", id: "8aad0c9e49b9cfc9c7f87a1321f5e82e", source: "kugou" } };
    }
    if (plat === "kuwo") {
      return { mid: "228427", song: { name: "海阔天空", artist: "Beyond", songmid: "228427", id: "228427", source: "kuwo" } };
    }
    if (plat === "migu") {
      return { mid: "60054701923", song: { name: "海阔天空", artist: "Beyond", songmid: "60054701923", id: "60054701923", source: "migu" } };
    }
    // QQ 默认：晴天
    return { mid: "0039MnYb0qxYhV", song: { name: "晴天", artist: "周杰伦", songmid: "0039MnYb0qxYhV", albummid: "000MkMni19ClKG", source: "qq" } };
  }

  async function testSourceQualities(src, token) {
    // 按平台分别探测；平台芯片与音质芯片同步绿/红
    var plats = srcPlatforms(src);
    if (!plats.length) plats = ["qq"];
    src._platmap = src._platmap || {};
    plats.forEach(function (p) { src._platmap[p] = null; });
    var map = src._qmap || {};
    SRC_Q_LEVELS.forEach(function (lv) { map[lv.q] = null; });
    src._qmap = map;
    renderSrcList();

    // 多平台：每个平台各测一遍音质；音质结果取各平台「任一通过」的并集
    for (var pi = 0; pi < plats.length; pi++) {
      if (src._testToken !== token) break;
      var plat = plats[pi];
      var probe = probeSongForPlatform(plat);
      var song = probe.song;
      var probeMid = probe.mid;
      var platAnyOk = false;
      for (var i = 0; i < SRC_Q_LEVELS.length; i++) {
        if (src._testToken !== token) break;
        var q = SRC_Q_LEVELS[i].q;
        var ok = false;
        try {
          var url = await resolveBySource(src, Object.assign({}, song), probeMid, q);
          if (src._testToken !== token) break;
          ok = qualityUrlPass(url, q);
          if (!ok && url) {
            console.warn("[test] fail", src.name, plat, q, "actual=", detectQualityFromUrl(url), String(url).slice(0, 100));
          }
        } catch (e) {
          ok = false;
        }
        if (src._testToken !== token) break;
        if (ok) {
          platAnyOk = true;
          // 任一平台该档通过 → 音质芯片绿
          map[q] = true;
        } else if (map[q] == null) {
          map[q] = false;
        }
        src._qmap = map;
        renderSrcList();
      }
      if (src._testToken !== token) break;
      src._platmap[plat] = !!platAnyOk;
      // 未测到的音质档标失败
      SRC_Q_LEVELS.forEach(function (lv) {
        if (map[lv.q] == null) map[lv.q] = false;
      });
      src._qmap = map;
      renderSrcList();
    }
    if (src._testToken !== token) return map;
    src._qmap = map;
    var any = SRC_Q_LEVELS.some(function (lv) { return map[lv.q]; });
    src._test = { ok: any, at: Date.now() };
    src._qtest = { ok: any, at: Date.now() };
    return map;
  }

  function closeSrcEditor() {
    var ed = $("#srcEditor");
    if (!ed) return;
    ed.classList.remove("open");
    // 彻底不接收点击，避免播放页误触「保存」
    try { ed.style.pointerEvents = "none"; } catch (e) {}
  }
  function editSrc(idx) {
    var src = S.sources[idx];
    if (!src) return;
    var ed = $("#srcEditor");
    if (!ed) {
      ed = document.createElement("div");
      ed.id = "srcEditor";
      ed.className = "src-editor-mask";
      ed.innerHTML =
        '<div class="src-editor">' +
        '<div class="src-editor-title">编辑音源</div>' +
        '<label class="src-ed-label">名称</label>' +
        '<input class="field" id="srcEdName" />' +
        '<label class="src-ed-label">对接平台（可多选）</label>' +
        '<div class="src-plat-checks" id="srcEdPlats">' +
        '<label><input type="checkbox" value="qq" /> QQ</label>' +
        '<label><input type="checkbox" value="netease" /> 网易</label>' +
        '<label><input type="checkbox" value="kugou" /> 酷狗</label>' +
        '<label><input type="checkbox" value="kuwo" /> 酷我</label>' +
        '<label><input type="checkbox" value="migu" /> 咪咕</label>' +
        "</div>" +
        '<label class="src-ed-label">接口 / JS 地址</label>' +
        '<input class="field" id="srcEdUrl" placeholder="https://…" />' +
        '<div class="src-ed-actions">' +
        '<button type="button" class="btn-ghost" id="srcEdCancel">取消</button>' +
        '<button type="button" class="btn-pink" id="srcEdSave">保存</button>' +
        "</div></div>";
      document.body.appendChild(ed);
      ed.addEventListener("click", function (e) {
        if (e.target === ed) closeSrcEditor();
      });
      on($("#srcEdCancel"), "click", closeSrcEditor);
      on($("#srcEdSave"), "click", function (ev) {
        // 编辑器未打开时绝不保存（防止 WebView 下隐藏层误触）
        if (!ed.classList.contains("open")) return;
        if (ev) { try { ev.preventDefault(); ev.stopPropagation(); } catch (e0) {} }
        var i = ed._idx;
        var item = S.sources[i];
        if (!item) return closeSrcEditor();
        var name = ($("#srcEdName").value || "").trim();
        if (!name) { toast("请填写名称"); return; }
        var plats = [];
        $$("#srcEdPlats input[type=checkbox]").forEach(function (c) {
          if (c.checked) plats.push(c.value);
        });
        if (!plats.length) { toast("请至少选一个平台"); return; }
        var url = ($("#srcEdUrl").value || "").trim();
        item.name = name;
        item.platforms = plats;
        item.platform = plats[0];
        if (url) {
          if (/\.js(\?|$)/i.test(url) || /script/i.test(url)) item.jsUrl = url;
          else item.url = url.replace(/\/$/, "");
        }
        saveJSON("aq_sources", S.sources);
        renderSrcList();
        try { syncPlatBtn(); } catch (e2) {}
        closeSrcEditor();
        toast("已保存音源：" + name);
      });
    }
    ed._idx = idx;
    $("#srcEdName").value = src.name || "";
    var plats = srcPlatforms(src);
    $$("#srcEdPlats input[type=checkbox]").forEach(function (c) {
      c.checked = plats.indexOf(c.value) >= 0;
    });
    $("#srcEdUrl").value = src.jsUrl || src.url || "";
    try { ed.style.pointerEvents = ""; } catch (ePe) {}
    ed.classList.add("open");
  }

  async function fetchJsScript(url) {
    url = String(url || "").trim();
    if (!url) throw new Error("empty url");
    // 直连
    try {
      var r = await fetch(url, { mode: "cors", credentials: "omit" });
      if (r.ok) {
        var t = await r.text();
        if (t && t.length > 20) return t;
      }
    } catch (e) {}
    // 代理兜底
    var proxies = [
      "https://api.allorigins.win/raw?url=" + encodeURIComponent(url),
      "https://api.codetabs.com/v1/proxy?quest=" + encodeURIComponent(url),
    ];
    for (var i = 0; i < proxies.length; i++) {
      try {
        var r2 = await fetch(proxies[i], { mode: "cors", credentials: "omit" });
        if (!r2.ok) continue;
        var t2 = await r2.text();
        if (t2 && t2.length > 20) return t2;
      } catch (e2) {}
    }
    throw new Error("fetch failed");
  }

  var _srcAddPending = false;
  async function handleSrcAdd() {
    if (_srcAddPending) return;
    _srcAddPending = true;
    var name = ($("#srcName") && $("#srcName").value || "").trim();
    var plats = [];
    $$("#srcAddPlats input[type=checkbox]").forEach(function (c) {
      if (c.checked) plats.push(c.value);
    });
    if (!plats.length) plats = ["qq"];
    var platform = plats[0];
    var jsUrl = ($("#srcJsUrl") && $("#srcJsUrl").value || "").trim();
    var btn = $("#btnSrcAdd");

    if (!name) {
      var hint = document.querySelector(".set-hint");
      if (hint) hint.textContent = "请填写音源名称";
      _srcAddPending = false;
      return;
    }
    if (!jsUrl || !/^https?:\/\//i.test(jsUrl)) {
      var h2 = document.querySelector("#page-set .set-hint");
      if (h2) h2.textContent = "请填写有效的 JS 在线地址（https://…）";
      _srcAddPending = false;
      return;
    }

    if (btn) {
      btn.disabled = true;
      btn.textContent = "导入中…";
    }
    try {
      var script = await fetchJsScript(jsUrl);
      if (script.length > 400000) script = script.slice(0, 400000);
      var item = {
        id: "custom_" + Date.now(),
        name: name,
        platform: platform,
        platforms: plats,
        type: "js",
        jsUrl: jsUrl,
        url: "",
        script: script,
        enabled: true,
        builtin: false,
      };
      // 尝试从脚本里提取可用 API 根地址
      var mApi = script.match(/https?:\/\/[a-zA-Z0-9._\-:/]+(?:lxmusic|yuafeng|music|api)[a-zA-Z0-9._\-:/]*/i);
      if (!mApi) mApi = script.match(/https?:\/\/[a-zA-Z0-9._\-:/]+/);
      if (mApi) item.url = mApi[0].replace(/\/$/, "");

      S.sources.push(item);
      saveJSON("aq_sources", S.sources);
      if ($("#srcName")) $("#srcName").value = "";
      if ($("#srcJsUrl")) $("#srcJsUrl").value = "";
      renderSrcList();
      var h3 = document.querySelector("#page-set .set-hint");
      if (h3) h3.textContent = "已导入：" + name + "（" + Math.round(script.length / 1024) + " KB）";
    } catch (err) {
      var h4 = document.querySelector("#page-set .set-hint");
      if (h4) h4.textContent = "导入失败，请检查地址或跨域";
      console.warn("import js fail", err);
    } finally {
      _srcAddPending = false;
      if (btn) {
        btn.disabled = false;
        btn.textContent = "在线导入";
      }
    }
  }
  on($("#btnSrcAdd"), "click", handleSrcAdd);
  // webview（包括 FongMi）上 click 事件偶发不响应，追加 touchend 兜底
  on($("#btnSrcAdd"), "touchend", function (e) {
    e.preventDefault();
    handleSrcAdd();
  });

  // 本地 JS 音源文件导入：透明 file input 直接覆盖在按钮上方，绕过 webview 对 programmatic click 的限制
  // 注意：不要再用 js 去调 input.click()，在 FongMi / iOS / 部分 Android WebView 里会被拦截
  on($("#srcJsFile"), "change", function (e) {
    var file = e.target && e.target.files && e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var script = String(reader.result || "");
        if (script.length < 50) {
          toast("文件太短，不像音源脚本");
          return;
        }
        if (script.length > 400000) {
          toast("文件过大，已截取前 400KB");
          script = script.slice(0, 400000);
        }
        var name = ($("#srcName") && $("#srcName").value || "").trim();
        if (!name) {
          name = (file.name || "本地音源").replace(/\.js$/i, "");
        }
        var plats = [];
        $$("#srcAddPlats input[type=checkbox]:checked").forEach(function (c) {
          plats.push(c.value);
        });
        if (!plats.length) plats = ["qq"];
        var item = {
          id: "src_" + Date.now(),
          name: name,
          platforms: plats,
          type: "js",
          jsUrl: "",
          url: "",
          script: script,
          enabled: true,
          builtin: false,
          fromFile: file.name || "",
        };
        var mApi = script.match(/https?:\/\/[a-zA-Z0-9._\-:/]+(?:lxmusic|yuafeng|music|api)[a-zA-Z0-9._\-:/]*/i);
        if (!mApi) mApi = script.match(/https?:\/\/[a-zA-Z0-9._\-:/]+/);
        if (mApi) item.url = mApi[0].replace(/\/$/, "");
        S.sources.push(item);
        saveJSON("aq_sources", S.sources);
        if ($("#srcName")) $("#srcName").value = "";
        renderSrcList();
        toast("已导入本地音源：" + name);
      } catch (err) {
        console.warn(err);
        toast("本地导入失败");
      }
      try { e.target.value = ""; } catch (e2) {}
    };
    reader.onerror = function () { toast("读取文件失败"); };
    reader.readAsText(file);
  });

  renderSrcList();
  try { syncPlatBtn(); } catch (e) {}

  on($("#sheetCancel"), "click", closeSheet);
  on($("#qPopMask"), "click", closeQualitySheet);
  on($("#sheetMask"), "click", function (e) { if (e.target.id === "sheetMask") closeSheet(); });

  /* 播放页：对齐 QQ — history + hash，系统/WebView 返回、边缘右滑都走 popstate */
  var npHistoryPushed = false;
  var _npIgnorePop = 0;

  var lyricsHistoryPushed = false;
  function enterLyricsFull() {
    var np = $("#np");
    if (!np || !np.classList.contains("open")) return;
    var isImm = np.classList.contains("immersive");
    // 经典 / 沉浸：都同步封面到模糊层，全屏歌词保留模糊海报背景
    try {
      var art = $("#npArt");
      var song = S.queue && S.queue[S.idx];
      var cover = (song && typeof songCoverHi === "function" ? songCoverHi(song) : "") ||
        (art && art.src) || (song ? songCover(song) : "") || "";
      setNpBlurCover(cover);
    } catch (e1) {}
    np.classList.add("lyrics-full");
    try {
      var bg = $("#npBg");
      var img = $("#npBgImg");
      // 两种模式都保持模糊层可见（经典全屏歌词 CSS 会再叠一层淡彩）
      if (bg) bg.style.opacity = "1";
      if (img && img.src) {
        // 沉浸全屏歌词用 CSS 控制；经典保持模糊图可见
        if (isImm) img.style.opacity = "1";
        else img.style.opacity = "";
      }
    } catch (e2) {}
    // 压一层历史，系统返回 / 边缘右滑可先退出全屏歌词
    if (!lyricsHistoryPushed) {
      try {
        history.pushState({ aqNp: 1, overlay: "lyrics" }, "", "#lyrics");
        lyricsHistoryPushed = true;
      } catch (eH) {
        try {
          history.pushState({ aqNp: 1, overlay: "lyrics" }, "");
          lyricsHistoryPushed = true;
        } catch (eH2) {}
      }
    }
    setTimeout(function () {
      syncLyrics(audio.currentTime || 0, true);
    }, 80);
  }
  function exitLyricsFull(fromPop) {
    var np = $("#np");
    if (!np) return;
    np.classList.remove("lyrics-full");
    // 防止手势残留把整个播放页拖走/变透明
    np.style.transition = "";
    np.style.transform = "";
    np.style.opacity = "";
    // 退出全屏歌词后恢复模糊海报（经典模式依赖 inline opacity）
    try {
      var bg = $("#npBg");
      var img = $("#npBgImg");
      var isImm = np.classList.contains("immersive");
      if (!isImm) {
        if (bg && img && img.getAttribute("src")) bg.style.opacity = "1";
        if (img && img.getAttribute("src")) {
          // 交给 onload / setNpBlurCover 的 opacity；若已有图则显示
          if (!img.style.opacity || img.style.opacity === "0") img.style.opacity = "1";
        }
      }
    } catch (eRest) {}
    if (!np.classList.contains("open")) {
      np.classList.add("open");
    }
    if (lyricsHistoryPushed && !fromPop) {
      lyricsHistoryPushed = false;
      _npIgnorePop = 1;
      try { history.back(); } catch (eB) {}
      setTimeout(function () { _npIgnorePop = 0; }, 200);
    } else {
      lyricsHistoryPushed = false;
      try {
        if (location.hash === "#lyrics") {
          history.replaceState({ aqNp: 1, overlay: "player" }, "", "#player");
        }
      } catch (eR) {}
    }
    setTimeout(function () {
      syncLyrics(audio.currentTime || 0, true);
    }, 80);
  }
  function toggleLyricsFull() {
    var np = $("#np");
    if (!np) return;
    if (np.classList.contains("lyrics-full")) exitLyricsFull();
    else enterLyricsFull();
  }

  function openNowPlaying() {
    var np = $("#np");
    if (!np) return;
    try { enterNpChrome(); } catch (eCh) {}
    np.classList.remove("closing", "lyrics-full");
    lyricsHistoryPushed = false;
    np.style.transform = "";
    np.style.opacity = "";
    np.style.transition = "";
    np.classList.add("open");
    setTimeout(function () {
      var box = $("#npLyrics");
      if (box) {
        var pad = Math.max(80, Math.floor((box.clientHeight || 160) * 0.42));
        box.querySelectorAll(".ly-spacer").forEach(function (sp) {
          sp.style.height = pad + "px";
        });
      }
      syncLyrics(audio.currentTime || 0, true);
    }, 80);
    // 已由 promoteSheetToPlayer 占好 #player 则不再 push
    if (!npHistoryPushed) {
      try {
        history.pushState({ aqNp: 1, overlay: "player" }, "", "#player");
        npHistoryPushed = true;
      } catch (e) {
        try {
          history.pushState({ aqNp: 1, overlay: "player" }, "");
          npHistoryPushed = true;
        } catch (e2) {}
      }
    } else {
      try {
        if (location.hash !== "#player") {
          history.replaceState({ aqNp: 1, overlay: "player" }, "", "#player");
        }
      } catch (e3) {}
    }
  }
  function closeNowPlaying(fromPop, alreadyAnimated) {
    var np = $("#np");
    if (!np) return;
    try { closeNpFileInfo(); } catch (eInfo) {}
    try { closeSrcPicker(); } catch (eSrcPick) {}
    // 若在全屏歌词，先只退歌词，不关播放页
    if (np.classList.contains("lyrics-full") && !alreadyAnimated) {
      exitLyricsFull();
      return;
    }
    if (!np.classList.contains("open") && !alreadyAnimated) return;
    try { exitNpChrome(); } catch (eCh2) {}
    np.classList.add("closing");
    np.classList.remove("open");
    np.classList.remove("lyrics-full");
    // 收起为迷你播放器，不停播
    try {
      var mini = $("#mini");
      if (mini && S.queue && S.queue.length) mini.classList.add("show");
    } catch (eMini) {}

    if (!alreadyAnimated) {
      np.style.transition = "transform .36s cubic-bezier(0.32, 0.72, 0, 1), opacity .3s ease";
      np.style.transform = "translateY(100%)";
      np.style.opacity = "0";
    }
    setTimeout(function () {
      np.classList.remove("closing");
      np.style.transform = "";
      np.style.opacity = "";
      np.style.transition = "";
    }, alreadyAnimated ? 50 : 380);
    if (npHistoryPushed && !fromPop) {
      npHistoryPushed = false;
      _npIgnorePop = 1;
      try { history.back(); } catch (e) {}
      setTimeout(function () {
        _npIgnorePop = 0;
        // 若 hash 还在，清掉
        try {
          if (location.hash === "#player") {
            history.replaceState({ overlay: null }, "", location.pathname + location.search);
          }
        } catch (e2) {}
      }, 360);
    } else {
      npHistoryPushed = false;
      try {
        if (location.hash === "#player") {
          history.replaceState({ overlay: null }, "", location.pathname + location.search);
        }
      } catch (e3) {}
    }
  }
  window.addEventListener("popstate", function (e) {
    if (_sheetIgnorePop > 0) {
      _sheetIgnorePop = 0;
      return;
    }
    if (typeof _detailIgnorePop !== "undefined" && _detailIgnorePop > 0) {
      _detailIgnorePop = 0;
      return;
    }
    if (_npIgnorePop > 0) {
      _npIgnorePop = 0;
      return;
    }
    var np = $("#np");
    // 播放页 / 全屏歌词在最上层，必须先处理，避免详情抢返回导致播放页手势失效
    if (np && np.classList.contains("open") && (np.classList.contains("lyrics-full") || lyricsHistoryPushed)) {
      lyricsHistoryPushed = false;
      exitLyricsFull(true);
      return;
    }
    if (np && np.classList.contains("open")) {
      npHistoryPushed = false;
      closeNowPlaying(true);
      return;
    }
    // 沉浸详情（歌单/榜单全屏页）
    try {
      if (isDetailOpen() && detailHistoryPushed) {
        detailHistoryPushed = false;
        closeDetailPage(true);
        return;
      }
      if (isDetailOpen() && !detailHistoryPushed) {
        closeDetailPage(true);
        return;
      }
    } catch (eDet) {}
    var sheetMask = $("#sheetMask");
    // 歌曲更多 sheet
    if (sheetMask && sheetMask.classList.contains("open") && sheetHistoryPushed) {
      sheetHistoryPushed = false;
      closeSheet(true);
      return;
    }
    if (sheetMask && sheetMask.classList.contains("open") && !sheetHistoryPushed) {
      closeSheet(true);
    }
    // 设置 / 资料库 / 搜索：返回手势统一回主页
    if (_subPagePushed && _curPage && _curPage !== "home") {
      _subPagePushed = false;
      go("home", { fromPop: true });
      return;
    }
    _subPagePushed = false;
  });

  // 手势：下滑关闭；从左边缘右滑 = 系统返回（走 history.back → popstate）

  // 歌单/列表 sheet：左右滑关闭（与播放页同款，不用下拉）
  (function setupSheetGesture() {
    var mask = $("#sheetMask");
    var body = $("#sheetBody");
    if (!mask || !body) return;
    var sx = 0, sy = 0, cx = 0, cy = 0, dragging = false, mode = "";
    var easeOut = "transform .36s cubic-bezier(0.32, 0.72, 0, 1), opacity .3s ease";
    var easeBack = "transform .4s cubic-bezier(0.32, 0.72, 0, 1), opacity .28s ease";

    function sheetOpen() {
      return mask.classList.contains("open");
    }
    /** 列表是否在顶部：仅在顶部允许下拉关闭，避免与歌曲列表滚动冲突 */
    function listAtTop() {
      try {
        var prefer = body.querySelector(".pl-detail-list");
        if (prefer && prefer.scrollTop > 8) return false;
        var nodes = body.querySelectorAll("div");
        for (var i = 0; i < nodes.length; i++) {
          var el = nodes[i];
          var st = window.getComputedStyle(el);
          if ((st.overflowY === "auto" || st.overflowY === "scroll") && el.scrollHeight > el.clientHeight + 4) {
            if (el.scrollTop > 8) return false;
          }
        }
        if (body.scrollTop > 8) return false;
        return true;
      } catch (e) {
        return true;
      }
    }

    mask.addEventListener("touchstart", function (e) {
      if (!sheetOpen()) return;
      if (!e.touches || !e.touches[0]) return;
      // 点在遮罩空白处也可开始，sheet 本体上滑关闭
      sx = e.touches[0].clientX;
      sy = e.touches[0].clientY;
      cx = sx; cy = sy;
      dragging = true;
      mode = "";
      body.style.transition = "none";
    }, { passive: true });

    mask.addEventListener("touchmove", function (e) {
      if (!dragging || !sheetOpen() || !e.touches || !e.touches[0]) return;
      cx = e.touches[0].clientX;
      cy = e.touches[0].clientY;
      var dx = cx - sx, dy = cy - sy;
      if (!mode) {
        // 仅下滑关闭；左右滑动不处理（系统边缘返回仍走 history / popstate）
        if (dy > 12 && Math.abs(dy) > Math.abs(dx) * 1.15) {
          if (!listAtTop()) {
            dragging = false;
            mode = "";
            return;
          }
          mode = "down";
        } else {
          return;
        }
      }
      if (mode === "down") {
        var d = Math.max(0, dy);
        body.style.transform = "translate3d(0," + d + "px,0)";
        body.style.opacity = String(Math.max(0.28, 1 - d / 420));
      }
    }, { passive: true });

    mask.addEventListener("touchend", function () {
      if (!dragging) return;
      dragging = false;
      if (!sheetOpen()) return;
      var dy = cy - sy;
      var h = window.innerHeight || 700;
      if (mode === "down" && dy > 80) {
        body.style.transition = easeOut;
        body.style.transform = "translate3d(0," + h + "px,0)";
        body.style.opacity = "0";
        setTimeout(function () { closeSheet(); }, 300);
        return;
      }
      body.style.transition = easeBack;
      body.style.transform = "";
      body.style.opacity = "";
      mode = "";
    }, { passive: true });
  })();

  
  // 点击歌词区 / 封面 → 全屏歌词
  (function () {
    function tryEnter(e) {
      if (e.target && e.target.closest && e.target.closest("button")) return;
      var np = $("#np");
      if (!np || !np.classList.contains("open")) return;
      if (np.classList.contains("lyrics-full")) return;
      enterLyricsFull();
    }
    var box = $("#npLyrics");
    if (box) {
      box.addEventListener("click", tryEnter);
      box.style.cursor = "pointer";
    }
    var art = $(".np-art-wrap");
    if (art) {
      art.addEventListener("click", tryEnter);
      art.style.cursor = "pointer";
    }
  })();

  (function setupNpGesture() {
    var np = $("#np");
    if (!np) return;
    var sx = 0, sy = 0, cx = 0, cy = 0, dragging = false, mode = "";
    var edgeStart = false;
    var touchOnLyrics = false;
    var easeOut = "transform .36s cubic-bezier(0.32, 0.72, 0, 1), opacity .3s ease";
    var easeBack = "transform .4s cubic-bezier(0.32, 0.72, 0, 1), opacity .28s ease";

    function isControlTarget(t) {
      if (!t || !t.closest) return false;
      return !!(t.closest(".np-controls") || t.closest(".np-tools") || t.closest(".np-seek") || t.closest("button") || t.closest("input"));
    }

    np.addEventListener("touchstart", function (e) {
      if (!np.classList.contains("open")) return;
      if (!e.touches || !e.touches[0]) return;
      if (isControlTarget(e.target)) return;
      sx = e.touches[0].clientX;
      sy = e.touches[0].clientY;
      cx = sx; cy = sy;
      dragging = true;
      mode = "";
      edgeStart = sx <= 28;
      touchOnLyrics = !!(e.target && e.target.closest && e.target.closest("#npLyrics"));
      np.style.transition = "none";
    }, { passive: true });

    np.addEventListener("touchmove", function (e) {
      if (!dragging || !e.touches || !e.touches[0]) return;
      cx = e.touches[0].clientX;
      cy = e.touches[0].clientY;
      var dx = cx - sx, dy = cy - sy;
      if (!mode) {
        if (edgeStart && dx > 10 && Math.abs(dx) > Math.abs(dy)) mode = "edge";
        else if (Math.abs(dy) > 10 && Math.abs(dy) >= Math.abs(dx)) mode = dy > 0 ? "down" : "up";
        else if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) && dx > 0) mode = "right";
        else return;
      }
      // 上滑进全屏：不拖动页面
      if (mode === "up") return;
      // 全屏歌词内上滑只滚歌词，不拖页面
      if (np.classList.contains("lyrics-full") && mode === "up") return;
      if (mode === "down") {
        // 全屏歌词下滑：跟手预览退出
        if (np.classList.contains("lyrics-full")) {
          // 不拖整个页，松手再退
          return;
        }
        var d = Math.max(0, dy);
        np.style.transform = "translate3d(0," + d + "px,0)";
        np.style.opacity = String(Math.max(0.25, 1 - d / 480));
      } else if (mode === "edge" || mode === "right") {
        var r = Math.max(0, dx);
        np.style.transform = "translate3d(" + r + "px,0,0)";
        np.style.opacity = String(Math.max(0.25, 1 - r / 360));
      }
    }, { passive: true });

    np.addEventListener("touchend", function () {
      if (!dragging) return;
      dragging = false;
      var dx = cx - sx, dy = cy - sy;
      var h = window.innerHeight || 700;
      var w = window.innerWidth || 400;

      // 上滑：进入全屏歌词
      if (mode === "up" && dy < -48) {
        np.style.transition = "";
        np.style.transform = "";
        np.style.opacity = "";
        if (!np.classList.contains("lyrics-full")) {
          // 若在歌词区且已向下滚动，视为滚歌词，不进全屏
          var box = $("#npLyrics");
          if (touchOnLyrics && box && box.scrollTop > 16) {
            mode = "";
            edgeStart = false;
            touchOnLyrics = false;
            return;
          }
          enterLyricsFull();
        }
        mode = "";
        edgeStart = false;
        touchOnLyrics = false;
        return;
      }

      var shouldClose = false;
      if (mode === "down" && dy > 70) shouldClose = true;
      if ((mode === "edge" || mode === "right") && dx > 70) shouldClose = true;

      if (shouldClose) {
        // 全屏歌词：只退出歌词（边缘返回走 history，与系统一致）
        if (np.classList.contains("lyrics-full")) {
          np.style.transition = easeBack;
          np.style.transform = "";
          np.style.opacity = "";
          if ((mode === "edge" || mode === "right") && lyricsHistoryPushed) {
            try { history.back(); } catch (eL) { exitLyricsFull(); }
          } else {
            exitLyricsFull();
          }
          setTimeout(function () { np.style.transition = ""; }, 420);
          mode = "";
          edgeStart = false;
          touchOnLyrics = false;
          return;
        }
        // 普通播放页：下滑/右滑 → 收起为迷你条（继续播放）
        np.style.transition = easeOut;
        if (mode === "down") {
          np.style.transform = "translate3d(0," + h + "px,0)";
        } else {
          np.style.transform = "translate3d(" + w + "px,0,0)";
        }
        np.style.opacity = "0";
        setTimeout(function () {
          if (npHistoryPushed) {
            try { history.back(); } catch (e) {
              closeNowPlaying(false, true);
            }
          } else {
            closeNowPlaying(false, true);
          }
        }, 280);
      } else {
        np.style.transition = easeBack;
        np.style.transform = "";
        np.style.opacity = "";
        setTimeout(function () { np.style.transition = ""; }, 420);
      }
      mode = "";
      edgeStart = false;
      touchOnLyrics = false;
    }, { passive: true });
  })();

  // 迷你条上滑打开全屏
  (function setupMiniSwipe() {
    var mini = $("#mini");
    if (!mini) return;
    var sy = 0, dragging = false;
    on(mini, "touchstart", function (e) {
      if (e.target.closest("button")) return;
      sy = e.touches[0].clientY;
      dragging = true;
    }, { passive: true });
    on(mini, "touchend", function (e) {
      if (!dragging) return;
      dragging = false;
      var dy = e.changedTouches[0].clientY - sy;
      if (dy < -28) openNowPlaying();
    }, { passive: true });
  })();



  /* ========== Dock：下滑收合 / 上滑展开（有曲目才合并） ========== */
  var dockCollapsed = false;
  var dockLastY = 0;
  var dockAcc = 0;
  function hasActiveTrack() {
    var mini = $("#mini");
    return !!(mini && mini.classList.contains("show") && S.queue && S.queue.length);
  }
  function setDockCollapsed(on) {
    var dock = $("#dock");
    if (!dock) return;
    // 未在播放：永远展开，只显示完整底栏
    if (on && !hasActiveTrack()) on = false;
    dockCollapsed = !!on;
    dock.classList.toggle("collapsed", dockCollapsed);
    var homeBtn = $("#dockHome");
    var searchBtn = $("#dockSearch");
    var cur = document.querySelector(".tab.on");
    var page = cur ? cur.dataset.p : "home";
    if (homeBtn) homeBtn.classList.toggle("on", page === "home");
    if (searchBtn) searchBtn.classList.toggle("on", page === "search");
  }
  var _dockToggleAt = 0;
  function bindPageScroll(pageEl) {
    if (!pageEl || pageEl._dockBound) return;
    pageEl._dockBound = true;
    pageEl.addEventListener("scroll", function () {
      if (!hasActiveTrack()) {
        if (dockCollapsed) setDockCollapsed(false);
        dockAcc = 0;
        return;
      }
      var y = pageEl.scrollTop || 0;
      var dy = y - dockLastY;
      dockLastY = y;
      // 顶部附近始终展开
      if (y < 48) {
        dockAcc = 0;
        if (dockCollapsed) setDockCollapsed(false);
        return;
      }
      // 忽略极小抖动
      if (Math.abs(dy) < 2) return;
      // 衰减累积，避免一次惯性滚动连跳
      dockAcc = dockAcc * 0.85 + dy;
      var now = Date.now();
      if (now - _dockToggleAt < 520) return;
      // 阈值更高：需要持续滑一段才切换（更接近苹果绵密手感）
      if (dockAcc > 140) {
        dockAcc = 0;
        _dockToggleAt = now;
        if (!dockCollapsed) setDockCollapsed(true);
      } else if (dockAcc < -100) {
        dockAcc = 0;
        _dockToggleAt = now;
        if (dockCollapsed) setDockCollapsed(false);
      }
    }, { passive: true });
  }
  $$(".page").forEach(bindPageScroll);

  /* 主页下拉刷新 */
  (function setupPullRefresh() {
    var page = document.querySelector('.page[data-p="home"]') || $("#p-home");
    if (!page) return;
    var tip = document.createElement("div");
    tip.className = "ptr-tip";
    tip.textContent = "下拉刷新";
    page.insertBefore(tip, page.firstChild);
    var startY = 0, pulling = false, armed = false, refreshing = false;
    page.addEventListener("touchstart", function (e) {
      // 必须贴顶，避免轻微回弹就触发
      if (page.scrollTop > 0 || refreshing) return;
      if (!e.touches || !e.touches[0]) return;
      startY = e.touches[0].clientY;
      pulling = true;
      armed = false;
    }, { passive: true });
    page.addEventListener("touchmove", function (e) {
      if (!pulling || refreshing) return;
      var y = e.touches[0].clientY;
      var dy = y - startY;
      // 阈值提高：需下拉约 130px 才武装，减少误触
      if (page.scrollTop <= 0 && dy > 12) {
        var h = Math.min(48, (dy - 12) * 0.28);
        tip.style.height = h + "px";
        tip.textContent = dy > 130 ? "松开刷新" : "下拉刷新";
        armed = dy > 130;
      } else if (dy <= 12) {
        tip.style.height = "0";
        armed = false;
      }
    }, { passive: true });
    page.addEventListener("touchend", function () {
      if (!pulling) return;
      pulling = false;
      if (armed && !refreshing) {
        refreshing = true;
        tip.style.height = "36px";
        tip.textContent = "刷新中…";
        Promise.resolve(loadHome()).then(function () {
          tip.textContent = "已刷新";
          setTimeout(function () {
            tip.style.height = "0";
            refreshing = false;
          }, 500);
        }).catch(function () {
          tip.style.height = "0";
          refreshing = false;
        });
      } else {
        tip.style.height = "0";
      }
      armed = false;
    }, { passive: true });
  })();

  on($("#dockHome"), "click", function () {
    go("home");
    setDockCollapsed(false);
  });
  on($("#dockSearch"), "click", function () {
    go("search");
    setDockCollapsed(false);
  });
  // 切页时同步侧边高亮
  var _go = go;
  go = function (p) {
    _go(p);
    var homeBtn = $("#dockHome");
    var searchBtn = $("#dockSearch");
    if (homeBtn) homeBtn.classList.toggle("on", p === "home");
    if (searchBtn) searchBtn.classList.toggle("on", p === "search");
  };

  async function refreshRecommend() {
    var row = $("#recRow");
    if (!row) return;
    var btn = $("#btnRefresh");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "换一批…";
    }
    var recList = [];
    try {
      // 换一批：优先从大池重抽；池过期/过小则 force 重拉榜单
      recList = await fetchRecommendFromCharts(24, false).catch(function () { return []; });
      if (!recList || recList.length < 8) {
        recList = await fetchRecommendFromCharts(24, true).catch(function () { return []; });
      }
    } catch (e) { console.warn(e); }
    S.recList = (recList || []).slice(0, 24);
    row.innerHTML = "";
    S.recList.forEach(function (s) { row.appendChild(albumCard(s, S.recList)); });
    if (btn) {
      btn.disabled = false;
      btn.textContent = "换一批";
    }
    try { toast(S.recList.length ? ("已换一批 · " + S.recList.length + " 首") : "换一批失败，稍后再试"); } catch (eT) {}
  }

  async function loadHome() {
    try {
      try { renderThemeChannels(); } catch (e0) { console.warn(e0); }

      try {
        paintDuoCard("guess", null);
        paintDuoCard("radar", null);
        var gTitle = $("#guessTitle");
        var rTitle = $("#radarTitle");
        if (gTitle) gTitle.textContent = "加载中…";
        if (rTitle) rTitle.textContent = "加载中…";
      } catch (eLoad) {}

      // 歌单后台慢慢拉，不挡首屏
      homePlCache = null;
      loadRandomHomePlaylists().then(function (list) {
        homePlCache = list || [];
        if (homeChView === "playlist") renderHomePlaylists(homePlCache);
      }).catch(function () { homePlCache = []; });

      // 官方榜单（热门歌曲下方）— 必须显式调用
      try { loadHomeRanks(); } catch (eRank) { console.warn(eRank); }

      // 全部并行：双卡 / 推荐 / 热门 谁先到先画
      function paintDuo(guess, radar) {
        // 只在有数据时更新对应侧；空数组不覆盖另一侧，避免先到的一侧把雷达刷成「暂无推荐」
        if (guess && guess.length) S.guessList = guess;
        if (radar && radar.length) {
          var gKeys = {};
          (S.guessList || []).forEach(function (s) { gKeys[keyOf(s)] = 1; });
          var r = (radar || []).filter(function (s) { return !gKeys[keyOf(s)]; });
          if (r.length < 4) r = (radar || []).slice();
          S.radarList = r.length ? r : (radar || []).slice();
        }
        var g = (S.guessList && S.guessList.length) ? S.guessList : [];
        var r2 = (S.radarList && S.radarList.length) ? S.radarList : [];
        if (g.length || r2.length) renderTopDuo(g, r2);
      }

      var guessP = fetchGuessLike(40).then(function (list) {
        paintDuo(list || [], null);
        return list || [];
      }).catch(function () { return []; });

      var radarP = fetchRadarSongs(24).then(function (list) {
        list = list || [];
        if (list.length) {
          paintDuo(null, list);
        } else {
          // 空结果再补一次轻量搜索，避免必须手动刷新
          return Promise.all([
            searchSongs("流行").catch(function () { return []; }),
            searchSongs("华语热歌").catch(function () { return []; }),
          ]).then(function (packs) {
            var extra = [];
            (packs || []).forEach(function (arr) {
              (arr || []).forEach(function (s) {
                if (s && s.songmid) extra.push(s);
              });
            });
            if (extra.length) paintDuo(null, extra);
            return extra;
          });
        }
        return list;
      }).catch(function () {
        return searchSongs("流行").then(function (l) {
          if (l && l.length) paintDuo(null, l);
          return l || [];
        }).catch(function () { return []; });
      });

      var recP = fetchRecommendFromCharts(24).then(function (list) {
        list = list || [];
        S.recList = (list || []).slice(0, 24);
        var row = $("#recRow");
        if (row) {
          row.innerHTML = "";
          S.recList.forEach(function (s) { row.appendChild(albumCard(s, S.recList)); });
        }
        return list;
      }).catch(function () { return []; });

      var hotP = fetchPool(HOT_KW, 12, {}, 2).then(function (list) {
        list = list || [];
        S.feed = list;
        var hot = $("#hotList");
        if (hot) {
          hot.innerHTML = "";
          list.forEach(function (s) { hot.appendChild(songRow(s, list)); });
        }
        return list;
      }).catch(function () { return []; });

      // 不等全部结束；只给一个总保底超时
      await Promise.race([
        Promise.all([guessP, radarP, recP, hotP]),
        new Promise(function (r) { setTimeout(r, 4500); }),
      ]);

      if (!(S.guessList && S.guessList.length) && !(S.radarList && S.radarList.length)) {
        paintDuoCard("guess", null);
        paintDuoCard("radar", null);
      }

      // 继续上次播放：主页就绪后自动播最近一条
      try { maybeResumeLastPlay(); } catch (eR) {}
    } catch (err) {
      console.error("loadHome fatal", err);
      try {
        renderThemeChannels();
        paintDuoCard("guess", null);
        paintDuoCard("radar", null);
      } catch (e4) {}
      try { maybeResumeLastPlay(); } catch (eR2) {}
    }
  }

  var _resumeTried = false;
  async function maybeResumeLastPlay() {
    if (_resumeTried) return;
    if (!S.resumeLast) return;
    // 已在播则不打断
    if (S.queue && S.queue.length && S.idx >= 0) return;
    if (audio && !audio.paused && audio.src) return;
    _resumeTried = true;
    var src = S.autoPlaySrc || "guess";
    var names = { guess: "猜你喜欢", rec: "为你推荐", playlist: "随机歌单", rank: "随机榜单" };
    try {
      var list = [];
      if (src === "guess") {
        list = (S.guessList && S.guessList.length) ? S.guessList.slice() : [];
        if (!list.length) list = await fetchGuessLike(40).catch(function () { return []; });
        S.guessList = list || [];
      } else if (src === "rec") {
        list = (S.recList && S.recList.length) ? S.recList.slice() : [];
        if (!list.length) {
          list = await fetchRecommendFromCharts(24).catch(function () { return []; });
        }
        S.recList = list || [];
      } else if (src === "playlist") {
        var pls = homePlCache;
        if (!pls || !pls.length) {
          pls = await loadRandomHomePlaylists().catch(function () { return []; });
          homePlCache = pls || [];
        }
        if (pls && pls.length) {
          var pl = pls[Math.floor(Math.random() * pls.length)];
          var songs = [];
          var id = (pl && (pl.id || pl.dissid || pl.tid || pl.pid)) || "";
          var psrc = (pl && pl.source) || S.platform || "qq";
          try {
            if (psrc === "netease" && id) songs = await neteasePlaylistSongs(id).catch(function () { return []; });
            else if (psrc === "kuwo" && id) songs = await kuwoPlaylistSongs(id).catch(function () { return []; });
            else if (psrc === "kugou" && id) songs = await kugouPlaylistSongs(id).catch(function () { return []; });
            else if (id) songs = await playlistSongs(id).catch(function () { return []; });
          } catch (ePl) { songs = []; }
          if ((!songs || !songs.length) && pl && pl.name) {
            songs = await searchSongs(pl.name, 1).catch(function () { return []; });
          }
          list = songs || [];
        }
      } else if (src === "rank") {
        var boards = homeRankPool;
        if (!boards || !boards.length) {
          boards = await fetchToplistOverview().catch(function () { return []; });
          homeRankPool = boards || [];
        }
        if (boards && boards.length) {
          var b = boards[Math.floor(Math.random() * boards.length)];
          var pack = await fetchToplistDetail(b.topId || b.id, b.source || S.platform || "qq", b).catch(function () { return null; });
          list = (pack && pack.songs) || [];
        }
      }
      list = (list || []).filter(function (s) { return s && (s.songmid || s.id || s.name); });
      if (!list.length) {
        // 最终兜底猜你喜欢
        list = (S.guessList && S.guessList.length) ? S.guessList.slice() : await fetchGuessLike(40).catch(function () { return []; });
      }
      if (!list.length) {
        _resumeTried = false;
        return;
      }
      // 随机起点更自然
      var start = list[Math.floor(Math.random() * Math.min(list.length, 8))] || list[0];
      play(start, list);
      try { /* 自动播放静默开始，不弹提示 */ } catch (eT) {}
    } catch (e) {
      console.warn("auto play fail", e);
      _resumeTried = false;
    }
  }


  /* ========== FongMi chrome / 安全区（开发文档 25.7 / setChrome） ========== */
  var _chromeMode = "";
  var _homeFullPref = true;
  try {
    var _hf = cfg("aq_home_full", "");
    if (_hf === "0") _homeFullPref = false;
    else if (_hf === "1") _homeFullPref = true;
  } catch (eHf0) {}

  function applyViewportChrome(detail) {
    var mode = (detail && detail.chromeMode) || _chromeMode || "";
    var full = /^(edge|immersive|tv-full|tv-toolbar-hidden)$/.test(String(mode));
    try {
      document.documentElement.classList.toggle("fm-chrome-full", full);
    } catch (e1) {}
    _chromeMode = mode || _chromeMode;
  }

  function markFmNative() {
    try {
      if (window.fongmiClient || window.fongmiBridge || window.fm ||
          (typeof canShowPlatformSwitch === "function" && canShowPlatformSwitch())) {
        document.documentElement.classList.add("fm-native");
        return true;
      }
    } catch (e) {}
    return false;
  }

  function whenFmReady(cb, tries) {
    tries = tries || 0;
    var fm = window.fm || window.Fm;
    if (fm && fm.ui) {
      try { cb(fm); } catch (e) { console.warn(e); }
      return;
    }
    if (tries > 40) return;
    setTimeout(function () { whenFmReady(cb, tries + 1); }, tries < 8 ? 80 : 250);
  }

  function syncHomeFullSeg() {
    $$("#segHomeFull button").forEach(function (b) {
      var on = b.dataset.full === "1";
      b.classList.toggle("on", on === !!_homeFullPref);
    });
  }

  function applyHomeChrome(preferFull, opts) {
    opts = opts || {};
    markFmNative();
    whenFmReady(function (fm) {
      if (!fm.ui || typeof fm.ui.setChrome !== "function") return;
      var mode = preferFull ? "edge" : "normal";
      var dark = document.documentElement.classList.contains("dark");
      var style = dark ? "light" : "dark"; // 图标色：深底用浅图标
      var payload = {
        mode: mode,
        statusBarStyle: style,
        navigationBarStyle: style,
        restoreAffordance: "auto",
        scrim: { top: "transparent", bottom: "transparent" }
      };
      if (opts.startup) payload.startup = true;
      Promise.resolve(fm.ui.setChrome(payload)).then(function () {
        _chromeMode = mode;
        applyViewportChrome({ chromeMode: mode });
      }).catch(function () {
        // setChrome 失败时仍按偏好切换 class，避免顶部空白
        applyViewportChrome({ chromeMode: mode });
      });
      if (fm.ui.getViewport) {
        Promise.resolve(fm.ui.getViewport()).then(applyViewportChrome).catch(function () {});
      }
    });
  }

  function setHomeFullPref(on, silent) {
    _homeFullPref = !!on;
    persistSetting("aq_home_full", _homeFullPref ? "1" : "0");
    syncHomeFullSeg();
    applyHomeChrome(_homeFullPref, { startup: true });
    if (!silent) {
      try { toast(_homeFullPref ? "首页全屏：开启（edge）" : "首页全屏：关闭（normal）"); } catch (eT) {}
    }
  }

  // 标记环境 + 监听视口
  try {
    if (markFmNative()) {
      // 默认 edge 融合；用户关闭后走 normal（不预留顶部安全区）
      applyHomeChrome(_homeFullPref, { startup: true });
    }
  } catch (eBoot) {}
  window.addEventListener("fmviewport", function (ev) {
    try { applyViewportChrome(ev && ev.detail ? ev.detail : {}); } catch (eV) {}
  });
  // 桥晚注入：再试几次
  ;[300, 1000, 2500].forEach(function (ms) {
    setTimeout(function () {
      try {
        if (markFmNative()) applyHomeChrome(_homeFullPref, { startup: false });
      } catch (eR) {}
    }, ms);
  });

  // 设置页绑定
  try {
    syncHomeFullSeg();
    $$("#segHomeFull button").forEach(function (b) {
      on(b, "click", function () {
        applyDraft(function () { setHomeFullPref(b.dataset.full === "1", true); });
      });
    });
    on($("#btnSaveSettings"), "click", function () { saveSettings(); });
    on($("#btnResetSettings"), "click", function () { resetSettings(); });
    on($("#btnPickDefaultSrc"), "click", function () { openSrcPicker("default"); });
    syncDefaultSrcLabel();
    markSettingsDirty(false);
  } catch (eSeg) {}

  // 打开沉浸播放页时切 immersive；关闭恢复首页 edge/normal
  var _npChromePushed = false;
  function enterNpChrome() {
    whenFmReady(function (fm) {
      if (!fm.ui || typeof fm.ui.setChrome !== "function") return;
      var dark = document.documentElement.classList.contains("dark");
      var style = "light";
      Promise.resolve(fm.ui.setChrome({
        mode: "immersive",
        statusBarStyle: style,
        navigationBarStyle: style,
        restoreAffordance: "none"
      })).then(function () {
        _npChromePushed = true;
        applyViewportChrome({ chromeMode: "immersive" });
      }).catch(function () {});
    });
  }
  function exitNpChrome() {
    if (!_npChromePushed) {
      // 仍同步首页模式
      applyHomeChrome(_homeFullPref, { startup: false });
      return;
    }
    _npChromePushed = false;
    whenFmReady(function (fm) {
      if (fm.ui && typeof fm.ui.restoreChrome === "function") {
        Promise.resolve(fm.ui.restoreChrome()).then(function () {
          applyHomeChrome(_homeFullPref, { startup: false });
        }).catch(function () {
          applyHomeChrome(_homeFullPref, { startup: false });
        });
      } else {
        applyHomeChrome(_homeFullPref, { startup: false });
      }
    });
  }


  /* ========== Init ========== */
  try { syncSeg(); } catch (e) {}
  try { updateLibCounts(); } catch (e) {}
  try { ensureLibRecentOpen(); } catch (e) {
    try { renderLibRecent(); } catch (e2) {}
  }
  try { bindChTabs(); } catch (e) {}
  try { syncPlatBtn(); } catch (e) {}
  // 桥可能晚于脚本注入：延迟再判几次，避免 fmapp 内误藏切站按钮
  ;[200, 600, 1500, 3000, 6000].forEach(function (ms) {
    setTimeout(function () {
      try {
        // 桥可能晚注入：到点再同步一次显示/隐藏
        try {
          var saved = localStorage.getItem("aq_plat");
          if (saved && (typeof canShowPlatformSwitch === "function" && canShowPlatformSwitch())) {
            S.platform = saved;
          }
        } catch (e0) {}
        syncPlatBtn();
      } catch (e1) {}
    }, ms);
  });
  try { setDockCollapsed(false); } catch (e) {}
  try { loadHome(); } catch (e) { console.error(e); }

  // 启动读完已保存设置后再允许回写，避免每次启动都重写设置文件
  setTimeout(function () { _bootDone = true; }, 0);

  window.AQ = { S: S, play: play, searchQQ: searchQQ, searchPlaylists: searchPlaylists, resolvePlay: resolvePlay, go: go, coverUrl: coverUrl, isFmApp: isFmApp, syncPlatBtn: syncPlatBtn, hasNativeHttpBridge: hasNativeHttpBridge, isWebToAppBridge: isWebToAppBridge, canShowPlatformSwitch: canShowPlatformSwitch, nativeHttpRequest: nativeHttpRequest, adapterRequest: adapterRequest };
})();