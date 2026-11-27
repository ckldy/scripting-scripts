/**
 * AdBlockHub 4.7.0 回归：YouTube 播放端点钩子只碰 player/next/reel，browse/search/guide/get_watch 原样放行、
 * 首屏 ytplayer.bootstrapPlayerResponse 同步赋值即剥离、遮罩只摘 opened 不拔节点。
 * 用最小 DOM 桩在 vm 里跑真实脚本。
 */
const fs = require('fs');
const vm = require('vm');

const P = '/var/mobile/Library/Mobile Documents/iCloud~com~thomfang~Scripting/Documents/scripting-safari-extension/userscripts/AdBlockHub.user.js';
const code = fs.readFileSync(P, 'utf8');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('✅', name); }
  else { fail++; console.log('❌', name, extra === undefined ? '' : extra); }
}

// ---- 最小桩 ----
const timers = [];
const backdrop = {
  removed: false,
  attrs: { opened: '' },
  style: {},
  hasAttribute(n) { return Object.prototype.hasOwnProperty.call(this.attrs, n); },
  removeAttribute(n) { delete this.attrs[n]; },
  remove() { this.removed = true; },
  getClientRects() { return [{ width: 1 }]; },
};

const doc = {
  readyState: 'complete',
  head: null,
  documentElement: { appendChild() {} },
  body: { className: '', classList: { contains: () => false, remove() {} } },
  getElementById() { return null; },
  querySelector() { return null; },
  querySelectorAll(sel) {
    if (String(sel).includes('iron-overlay-backdrop')) return [backdrop];
    return [];
  },
  createElement() { return { id: '', textContent: '', appendChild() {}, setAttribute() {} }; },
  addEventListener() {},
  removeEventListener() {},
};
doc.head = doc.documentElement;

class Res {
  constructor(url, data) { this.url = url; this._data = data || { adPlacements: [1], playerAds: [2], streamingData: { formats: [1] } }; }
  json() { return Promise.resolve(JSON.parse(JSON.stringify(this._data))); }
  text() { return Promise.resolve(JSON.stringify(this._data)); }
}
class FakeEventTarget { addEventListener() {} removeEventListener() {} }
class FakeAnchor extends FakeEventTarget { constructor() { super(); this.href = 'https://example.com/'; } click() {} }

const sandbox = {
  console,
  location: { hostname: 'www.youtube.com', href: 'https://www.youtube.com/watch?v=abc#adhub-strict', hash: '#adhub-strict' },
  navigator: { userActivation: { isActive: false, hasBeenActive: true } },
  document: doc,
  EventTarget: FakeEventTarget,
  HTMLAnchorElement: FakeAnchor,
  Response: Res,
  MutationObserver: class { observe() {} disconnect() {} },
  setInterval(fn) { timers.push(fn); return timers.length; },
  setTimeout(fn) { timers.push(fn); return timers.length; },
  clearInterval() {},
  URL,
  // 独立一份 JSON：脚本会改写 JSON.parse（YouTube 域生效），不能污染宿主与其他桩
  JSON: { parse: (t, r) => JSON.parse(t, r), stringify: (v) => JSON.stringify(v) },
  Object,
  Array,
  Math,
  String,
  Date,
  Promise,
  Request: function () {},
  localStorage: { setItem() {}, getItem() { return null; } },
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.addEventListener = () => {};
sandbox.removeEventListener = () => {};
sandbox.open = () => null;

// 复刻真实 YouTube：ytInitialPlayerResponse 是 var 全局，writable 但不可配置
Object.defineProperty(sandbox, 'ytInitialPlayerResponse', {
  value: { adPlacements: [1], playerAds: [2], streamingData: { formats: [7] } },
  writable: true,
  enumerable: true,
  configurable: false,
});

vm.createContext(sandbox);
let topLevelError = '';
try {
  vm.runInContext(code, sandbox, { timeout: 5000, filename: 'AdBlockHub.user.js' });
} catch (e) {
  topLevelError = e.message;
}
check('顶层执行不抛错', topLevelError === '', topLevelError);

// 轮询 10ms 一次；跑几轮，确认就地剥离生效
for (let i = 0; i < 5; i++) for (const t of timers.slice(0, 1)) t();
const ipr = sandbox.ytInitialPlayerResponse;
check('ytInitialPlayerResponse 就地剥离 adPlacements', ipr && !('adPlacements' in ipr), ipr && Object.keys(ipr));
check('ytInitialPlayerResponse 就地剥离 playerAds', ipr && !('playerAds' in ipr));
check('ytInitialPlayerResponse 保留 streamingData', !!(ipr && ipr.streamingData));

// 4.4.5：模拟 YouTube 首屏内联脚本，window.ytplayer 创建后立刻同步赋 bootstrapPlayerResponse；
// 这条赋值后面紧跟着 createPlayer()，轮询与 JSON.parse 都插不进去，必须由 setter 当场剥离。
const fresh = { adPlacements: [1], playerAds: [2], adBreakHeartbeatParams: 'x', streamingData: { formats: [9] } };
sandbox.window.ytplayer = {};
sandbox.window.ytplayer.bootstrapPlayerResponse = fresh;
check('首屏 bootstrapPlayerResponse 赋值即剥离 adPlacements', !('adPlacements' in fresh));
check('首屏 bootstrapPlayerResponse 赋值即剥离 playerAds', !('playerAds' in fresh));
check('首屏 bootstrapPlayerResponse 保留 streamingData', !!(fresh.streamingData));
check('首屏 ytplayer 钩子已命中', !!(sandbox.__adblockHub && sandbox.__adblockHub.ytPlayerPruned > 0), sandbox.__adblockHub);
check('诊断版本为 4.26.0', !!(sandbox.__adblockHub && sandbox.__adblockHub.version === '4.26.0'), sandbox.__adblockHub && sandbox.__adblockHub.version);

// 4.5.0 新增：标准化只读诊断接口（给 LocalDNS 核验用）
const st = sandbox.__LOCALDNS_ADBLOCK_STATUS__;
check('暴露 __LOCALDNS_ADBLOCK_STATUS__', !!st);
check('诊断含 injectedAt', !!(st && st.injectedAt));
check('诊断含 counts 分组', !!(st && st.counts && typeof st.counts.jsonPruned === 'number'));
check('诊断含 last.deletedKeys 数组', !!(st && st.last && Array.isArray(st.last.deletedKeys)));
check('totalPruned 为数字且 > 0', !!(st && typeof st.totalPruned === 'number' && st.totalPruned > 0), st && st.totalPruned);
check('lastDeletedKeys 记录了实际删除的键', !!(st && st.last.deletedKeys.length > 0), st && st.last.deletedKeys);
check('删除键只含广告字段', !!(st && st.last.deletedKeys.every(k => ['adPlacements','playerAds','adSlots','adBreakParams','adBreakHeartbeatParams','playerAdParams'].indexOf(k) !== -1)), st && st.last.deletedKeys);

// 4.6.0 新增：受保护播放字段硬护栏
check('诊断含 playbackGuardViolations', !!(st && typeof st.playbackGuardViolations === 'number'));
check('护栏未被触发（恒应为 0）', !!(st && st.playbackGuardViolations === 0), st && st.playbackGuardViolations);
check('受保护字段不在删除键集合里', !!(st && st.last.deletedKeys.every(k => ['streamingData','playabilityStatus','videoDetails','microformat'].indexOf(k) === -1)));

// Response 钩子：只碰 /youtubei/v1/
const api = new sandbox.Response('https://www.youtube.com/youtubei/v1/player?key=x');
const apiGoogle = new sandbox.Response('https://youtubei.googleapis.com/youtubei/v1/player?key=x');
const next = new sandbox.Response('https://www.youtube.com/youtubei/v1/next?key=x');
const browse = new sandbox.Response('https://www.youtube.com/youtubei/v1/browse?key=x');
const search = new sandbox.Response('https://www.youtube.com/youtubei/v1/search?key=x');
const guide = new sandbox.Response('https://www.youtube.com/youtubei/v1/guide?key=x');
const getWatch = new sandbox.Response('https://www.youtube.com/youtubei/v1/get_watch?key=x');
const page = new sandbox.Response('https://www.youtube.com/watch?v=abc');
const media = new sandbox.Response('https://rr4---sn-x.googlevideo.com/videoplayback?x=1');

Promise.all([api.json(), apiGoogle.json(), next.json(), browse.json(), search.json(), guide.json(), getWatch.json(), page.json(), media.json(), api.text(), browse.text(), page.text()]).then(([a, ag, n, b, s, g, gw, p, m, at, bt, pt]) => {
  check('/youtubei/ player json 已剥离 ads', !('adPlacements' in a) && !('playerAds' in a));
  check('youtubei.googleapis.com 原样放行（分流给 YouTube Enhance）', 'adPlacements' in ag && 'playerAds' in ag);
  check('/youtubei/ next json 已剥离 ads', !('adPlacements' in n) && !('playerAds' in n));
  check('/browse json 不误删 adPlacements（只删 feed 广告位）', 'adPlacements' in b && 'playerAds' in b);
  check('/search json 原样放行', 'adPlacements' in s && 'playerAds' in s);
  check('/guide json 原样放行', 'adPlacements' in g && 'playerAds' in g);
  check('/get_watch json 原样放行', 'adPlacements' in gw && 'playerAds' in gw);
  check('非 /youtubei/ json 原样放行', 'adPlacements' in p && 'playerAds' in p);
  check('googlevideo json 原样放行', 'adPlacements' in m);
  check('/player text 已剥离 ads', !JSON.parse(at).adPlacements);
  check('/browse text 原样放行', 'adPlacements' in JSON.parse(bt));
  check('非 /youtubei/ text 原样放行', 'adPlacements' in JSON.parse(pt));

  // 遮罩：只摘 opened + pointer-events，绝不拔节点
  const cleanTicks = timers.slice(1);
  for (const t of cleanTicks) t();
  check('遮罩未被 remove()', backdrop.removed === false);
  check('遮罩 opened 已摘掉', !backdrop.hasAttribute('opened'));
  check('遮罩 pointer-events=none', backdrop.style.pointerEvents === 'none');

  console.log(`\n===== ${pass} passed, ${fail} failed =====`);
  process.exit(fail ? 1 : 0);
}).catch((e) => {
  console.log('❌ 异步断言异常:', e && e.message);
  process.exit(1);
});
