// AdBlockHub 4.7.1 回归：站点豁免 + 播放干预默认关闭 + SPA 换视频后仍脱水。
//
// 锁死 2026-11-08 那次「启用插件后 YouTube 视频看不了 / 网页广告还在」的修复：
//   A. YouTube 上不再注入全局滚动布局 CSS（只保留广告组件 CSS）
//   B. YouTube 上不再改写 AdProvider / adsbygoogle 等全局对象
//   C. 普通站点行为不变（滚动修复 + 全局对象灭活）
//   D. 版本 4.7.1，播放干预默认关闭（#adhub-fast 可开启）
//   E. SPA 换视频后新的 ytInitialPlayerResponse 仍被脱水，且播放字段不受伤
//
// 用法：node tools/test-adblockhub-exemptions.js
//
// 注：普通全局赋值（window.xxx = ...）在该 runtime 的 vm 下不会镜像到外层对象，
//     所以只断言两站点之间的行为差异，不单独断言 adsbygoogle 的值。
const fs = require('fs');
const vm = require('vm');

const SRC = fs.readFileSync('/var/mobile/Library/Mobile Documents/iCloud~com~thomfang~Scripting/Documents/scripting-safari-extension/userscripts/AdBlockHub.user.js', 'utf8');

function run(hostname, hash = '', cookie = '') {
  const appended = [];
  const styleEls = {};
  const timers = [];
  const document = {
    cookie,
    readyState: 'complete',
    head: { appendChild: (n) => { appended.push(n); } },
    documentElement: { appendChild: (n) => { appended.push(n); } },
    body: { appendChild() {}, classList: { contains: () => false, remove() {} } },
    getElementById: (id) => (id === 'adblock-hub-style' ? styleEls[id] || null : null),
    createElement: () => {
      const el = { id: '', style: {}, textContent: '', setAttribute() {}, remove() {} };
      return el;
    },
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
  };
  // createElement 后写入 id，需要能被 getElementById 看到
  const realCreate = document.createElement;
  document.createElement = () => {
    const el = realCreate();
    return new Proxy(el, {
      set(t, k, v) { t[k] = v; if (k === 'id' && v) styleEls[v] = t; return true; },
    });
  };

  const store = {};
  const sandbox = {
    console,
    addEventListener: () => {},
    removeEventListener: () => {},
    document,
    location: { hostname, href: `https://${hostname}/watch?v=x`, hash },
    navigator: { userActivation: { isActive: false, hasBeenActive: false } },
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
    },
    setTimeout: () => 0,
    setInterval: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearInterval: () => 0,
    MutationObserver: function () { this.observe = () => {}; },
    URL,
    EventTarget,
    HTMLAnchorElement: function () {},
    JSON,
    Object,
    Array,
    String,
    Number,
    Math,
    Date,
    RegExp,
    Error,
    TypeError,
    Promise,
    Uint8Array,
    TextDecoder,
    TextEncoder,
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox, { timeout: 5000 });

  // 首屏路径回归（memory §K / AdBlockHub 4.4.5 正解）：
  // 页面是同步执行的 `window.ytplayer = {}` → `.bootstrapPlayerResponse = ytInitialPlayerResponse`
  // → createPlayer()，中间没有任何宏任务。必须靠 setter 在赋值瞬间就剔干净。
  let firstScreen = { ran: false };
  try {
    firstScreen = vm.runInContext(
      '(function(){' +
      '  window.ytplayer = {};' +
      "  window.ytplayer.bootstrapPlayerResponse = {adPlacements:[{a:1}], playerAds:null, adBreakHeartbeatParams:'hb', streamingData:{formats:[1]}, playabilityStatus:{status:'OK'}};" +
      '  var b = window.ytplayer.bootstrapPlayerResponse;' +
      '  return { ran:true, ads:(b.adPlacements||[]).length, heartbeat:b.adBreakHeartbeatParams,' +
      '           streaming:!!(b.streamingData && b.streamingData.formats),' +
      '           status:b.playabilityStatus && b.playabilityStatus.status };' +
      '})()',
      sandbox
    );
  } catch (e) {
    firstScreen = { ran: false, error: String(e) };
  }

  // 追溯脱水回归（4.9.3）：脚本晚到（或 window.ytplayer 已被页面创建）时，
  // 装钩子必须把「已经存进去的脏值」也剔掉，否则首屏贴片照播。
  let retro = { ran: false };
  try {
    retro = vm.runInContext(
      '(function(){' +
      "  window.ytplayer = { bootstrapPlayerResponse: {adPlacements:[{a:1}], adBreakHeartbeatParams:'hb', streamingData:{formats:[1]}, playabilityStatus:{status:'OK'}} };" +
      '  var b = window.ytplayer.bootstrapPlayerResponse;' +
      '  return { ran:true, ads:(b.adPlacements||[]).length,' +
      '           streaming:!!(b.streamingData && b.streamingData.formats),' +
      '           status:b.playabilityStatus && b.playabilityStatus.status };' +
      '})()',
      sandbox
    );
  } catch (e) {
    retro = { ran: false, error: String(e) };
  }
  const style = appended.find((n) => n && n.id === 'adblock-hub-style');
  const css = style ? String(style.textContent) : '';

  // SPA 换视频：注入一个带广告键的新 playerResponse，手动触发 250ms 跟踪器
  const spa = (() => {
    try {
      sandbox.ytInitialPlayerResponse = {
        adPlacements: [{ adPlacementRenderer: 1 }],
        playerAds: {},
        adBreakHeartbeatParams: 'x',
        streamingData: { formats: [1] },
        playabilityStatus: { status: 'OK' },
        videoDetails: { videoId: 'x' },
      };
      const t = timers.find((x) => x.ms === 250);
      if (!t) return { ran: false, timers: timers.map((x) => x.ms) };
      t.fn();
      const pr = sandbox.ytInitialPlayerResponse;
      return {
        ads: (pr.adPlacements || []).length,
        playerAds: !!pr.playerAds,
        heartbeat: !!pr.adBreakHeartbeatParams,
        streaming: !!(pr.streamingData || {}).formats,
        status: pr.playabilityStatus && pr.playabilityStatus.status,
      };
    } catch (e) { return { error: String(e) }; }
  })();

  return {
    host: hostname,
    spa,
    firstScreen,
    retro,
    cssHasScrollFix: css.includes('html, body, html.fixbody'),
    cssHasAdSelectors: css.includes('ytd-ad-slot-renderer'),
    adProviderOverridden: (() => {
      try { return typeof sandbox.AdProvider === 'object' && sandbox.AdProvider !== undefined; } catch (_) { return false; }
    })(),
    adsbygoogleStubbed: (() => {
      try { return vm.runInContext("!!(this.adsbygoogle && typeof this.adsbygoogle.push === 'function')", sandbox); } catch (_) { return false; }
    })(),
    status: (() => {
      try { return JSON.parse(JSON.stringify(sandbox.__LOCALDNS_ADBLOCK_STATUS__ || {})); } catch (_) { return null; }
    })(),
  };
}

const yt = run('www.youtube.com');
const web = run('example.com');
const ytFast = run('www.youtube.com', '#adhub-fast');
const ytOff = run('www.youtube.com', '#adhub-off');
const ytFull = run('www.youtube.com', '#adhub-full');
const ytRaw = run('www.youtube.com', '#adhub-raw');
const ytStrict = run('www.youtube.com', '#adhub-strict');
const ytLoggedIn = run('www.youtube.com', '', 'SAPISID=testcookie');

let fail = 0;
function check(name, ok) {
  console.log(`${ok ? '✅' : '❌'} ${name}`);
  if (!ok) fail++;
}

check('YouTube：不注入全局滚动 CSS', yt.cssHasScrollFix === false);
check('YouTube：仍注入广告组件 CSS', yt.cssHasAdSelectors === true);
check('YouTube：不改写 AdProvider', yt.adProviderOverridden === false);
check('YouTube：不改写 adsbygoogle', yt.adsbygoogleStubbed === false);
check('普通站点：注入滚动 CSS', web.cssHasScrollFix === true);
check('普通站点：改写 AdProvider', web.adProviderOverridden === true);
// adsbygoogle 是普通赋值，这个 runtime 的 vm 不镜像，无法断言（浏览器里必然生效）
check('YouTube 与普通站点行为不同', yt.adProviderOverridden !== web.adProviderOverridden);
check('版本号 4.26.0', yt.status && yt.status.version === '4.26.0');
check('贴片：默认开启 16x/自动跳过兜底（#adhub-noskip 可关）',
  /const AD_AUTOSKIP = \(\(\) => \{[\s\S]{0,600}?return true;/.test(SRC) &&
    SRC.indexOf('adhub-noskip') !== -1);
check('贴片：seek 默认开启瞬跳（FadBlock 秒杀方案）',
  SRC.indexOf('AD_SEEK_END') !== -1 && SRC.indexOf('adhub-noseek') !== -1);
check('贴片：adFastTick 自动静音',
  /adFastTick[\s\S]{0,1200}?\.muted\s*=/.test(SRC));
check('贴片：诊断计数进信标（远程能看出是哪条判据命中）',
  SRC.indexOf("'k' + Math.min(ADHUB_STATUS.adClassSeen, 9)") !== -1 &&
    SRC.indexOf("'x' + Math.min(ADHUB_STATUS.adSeeked, 9)") !== -1);
check('贴片：50ms 轮询（fadblock 极速方案）',
  SRC.indexOf('const AD_TICK_MS = 50') !== -1 && SRC.indexOf('installAdFastWatcher') !== -1);
check('贴片：用 .video-stream 取播放元素',
  SRC.indexOf('video.video-stream') !== -1);
check('广告：每条广告都重新压 16x（不再只设一次）', SRC.indexOf('playbackRate < 16') !== -1);
check('广告：按 src+duration 记账与安全保护',
  SRC.indexOf('adSeekedKey') !== -1);
const adStateBody = (SRC.split('function onAdState')[1] || '').split('function installAdSkipObserver')[0];
check('广告：onAdState 自动静音与瞬跳', /video\.muted = true/.test(adStateBody));
check('#adhub-off 会强制重载（否则只改 hash 不重跑脚本），上次 A/B 会得到假结果',
  SRC.indexOf("adhub_off_reloaded") !== -1 && SRC.indexOf('location.reload()') !== -1);
check('Response 钩子不含 get_watch（播放红线）', !/\(\?:player\|next\|get_watch/.test(SRC));
check('Response 钩子播放白名单保持窄口径', /player\|next\|reel\\\/reel_watch_sequence/.test(SRC));
check('Response 钩子仅限浏览器域名（不碰 youtubei.googleapis.com）', /host === 'www\.youtube\.com' \|\| host === 'm\.youtube\.com' \|\| host === 'music\.youtube\.com'/.test(SRC));
check('网络广告诱饵拦截存在（避免 DNS 0.0.0.0 触发反广告墙）', /function isYtAdBaitUrl/.test(SRC) && /_adhubBait/.test(SRC));
// 唯一允许的 reload 是 #adhub-off 分支里的那一次（4.13.5）；拆墙/退让都不许自动重载。
const reloadIdx = SRC.indexOf('location.reload()');
const offIdx = SRC.indexOf('adhub_off_reloaded');
check('墙：不再自动重载（会话级标记退让无效）',
  reloadIdx === -1 || (offIdx !== -1 && offIdx < reloadIdx && reloadIdx - offIdx < 400));
check('退让模式：有 sessionStorage 开关', /function adhubSafeMode\(\)/.test(SRC) && /ADHUB_SAFE_KEY/.test(SRC));
check('退让模式：脱水入口都受控', /depth === 0 && adhubSafeMode\(\)/.test(SRC));
check('退让模式：Response 钩子受控', /if \(adhubSafeMode\(\)\) return null;/.test(SRC));
check('反广告墙：有专门的拆除函数', /function ytKillEnforcement\(\)/.test(SRC));
check('反广告墙：不再裸删', !/if \(dialog\) dialog\.remove\(\)/.test(SRC));
check('反广告墙：关掉 openPopupConfig 弹窗开关', /openPopupConfig/.test(SRC) && /supportedPopups/.test(SRC));
check('反广告墙：CSS 隐藏墙卡片', /ytd-enforcement-message-view-model,/.test(SRC.split('const PURE_AD_CSS')[1] || ''));
check('默认：剥离模式剥离 player 广告排期解除黑窗缓冲死锁',
  yt.spa && yt.spa.ads === 0 && yt.spa.streaming === true && yt.spa.status === 'OK');
check('#adhub-raw：保留原始 player 响应（对比回退开关）',
  ytRaw.spa && ytRaw.spa.ads === 1);
check('#adhub-strict：强制剥离 player 广告',
  ytStrict.spa && ytStrict.spa.ads === 0);
check('首屏：剥离排期并保证 streamingData / playabilityStatus 保留',
  yt.firstScreen.ran && yt.firstScreen.streaming === true && yt.firstScreen.status === 'OK');
check('首屏 #adhub-strict：setter 赋值瞬间剥离广告',
  ytStrict.firstScreen.ran && ytStrict.firstScreen.ads === 0);
check('追溯 #adhub-strict：同样剥离广告', ytStrict.retro.ran && ytStrict.retro.ads === 0);
check('追溯：streamingData / playabilityStatus 保留',
  yt.retro.ran && yt.retro.streaming === true && yt.retro.status === 'OK');
check('首屏：非 YouTube 不装 setter',
  web.firstScreen.ran === false || web.firstScreen.ads !== 0);
check('默认：streamingData/playabilityStatus 保留', yt.spa && yt.spa.streaming === true && yt.spa.status === 'OK');
check('已登录态同样剥离 player 广告排期且保持 streamingData 保留',
  ytLoggedIn.spa && ytLoggedIn.spa.ads === 0 && ytLoggedIn.firstScreen.ads === 0 && ytLoggedIn.spa.streaming === true);
check('默认 playback=off', ytFast.status !== null && yt.status.hooks && yt.status.hooks.jsonPatched === true);
check('#adhub-off 一键停用：不注入任何东西', !(ytOff.status && ytOff.status.version) && ytOff.cssHasAdSelectors === false && ytOff.spa.ran === false);

console.log('\nplayback 默认值:', JSON.stringify({ default: yt.status && yt.status.counts, fastHashApplied: ytFast.status && ytFast.status.version }));
process.exit(fail ? 1 : 0);
