const fs = require('fs');
const vm = require('vm');

const SCRIPT = '/var/mobile/Library/Mobile Documents/iCloud~com~thomfang~Scripting/Documents/scripts/LocalDNS/web/scripts/youtube-web.js';
const code = fs.readFileSync(SCRIPT, 'utf8');

function run({ url, body }) {
  let done = null;
  const sandbox = {
    $request: { url },
    $response: { body },
    $done: (v) => { done = v; },
    Uint8Array,
    TextEncoder,
    TextDecoder,
    console,
    JSON,
    Math,
    Object,
    String,
    Array,
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { timeout: 3000 });
  return done;
}

function varint(n) {
  const out = [];
  do {
    let b = n % 128;
    n = Math.floor(n / 128);
    if (n) b |= 0x80;
    out.push(b);
  } while (n);
  return out;
}
function field(len, id, payload) {
  return [].concat(varint((id << 3) | 2), varint(payload.length), payload);
}

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('✅', name); }
  else { fail++; console.log('❌', name, extra || ''); }
}

// 1) JSON with ads
const json = JSON.stringify({
  playabilityStatus: { status: 'OK' },
  playerResponse: { adPlacements: [{ a: 1 }], playerAds: [{ b: 2 }], streamingData: { formats: [1, 2] } },
  adSlots: [{ x: 1 }],
  adBreakParams: { y: 1 },
  videoDetails: { videoId: 'abc' }
});
let r = run({ url: 'https://www.youtube.com/youtubei/v1/player?key=x', body: json });
check('JSON: 有广告字段时写回', !!r && typeof r.body === 'string');
const parsed = JSON.parse(r.body);
check('JSON: 顶层 adSlots 已删', !('adSlots' in parsed));
check('JSON: 顶层 adBreakParams 已删', !('adBreakParams' in parsed));
check('JSON: 嵌套 adPlacements 已删', !('adPlacements' in parsed.playerResponse));
check('JSON: 嵌套 playerAds 已删', !('playerAds' in parsed.playerResponse));
check('JSON: 正常字段保留', parsed.playerResponse.streamingData.formats.length === 2 && parsed.videoDetails.videoId === 'abc');

// 2) JSON without ads -> untouched
r = run({ url: 'https://www.youtube.com/youtubei/v1/next', body: JSON.stringify({ content: 1 }) });
check('JSON: 无广告字段直接放行', r && Object.keys(r).length === 0);

// 3) protobuf player with fields 2, 7, 9, 68 (App surface: youtubei.googleapis.com)
const pb = new Uint8Array([
  ...field(3, 2, [97, 98, 99]),
  ...field(2, 7, [1, 2]),
  ...field(3, 9, [4, 5, 6]),
  ...field(2, 68, [7, 8]),
]);
r = run({ url: 'https://youtubei.googleapis.com/youtubei/v1/player?key=x', body: pb });
check('PB: 有广告字段时写回', !!r && r.body instanceof Uint8Array, r && r.body);
const expected = new Uint8Array([...field(3, 2, [97, 98, 99]), ...field(3, 9, [4, 5, 6])]);
check('PB: 精确删除 7 / 68，保留 2 / 9', !!r && Buffer.compare(Buffer.from(r.body), Buffer.from(expected)) === 0, r && Array.from(r.body));

// 4) protobuf on /next must be untouched (field 7 = content)
const nextPb = new Uint8Array([...field(3, 7, [99, 111, 110])]);
r = run({ url: 'https://youtubei.googleapis.com/youtubei/v1/next?key=x', body: nextPb });
check('PB: /next 不处理（保护 content）', r && Object.keys(r).length === 0);

// 5) broken bytes -> untouched
r = run({ url: 'https://youtubei.googleapis.com/youtubei/v1/player?key=x', body: new Uint8Array([0x22, 0x7f, 0x01]) });
check('PB: 越界数据放行', r && Object.keys(r).length === 0);

// 6) binary JSON (binary-body-mode)
const jsonBytes = new TextEncoder().encode(json);
r = run({ url: 'https://www.youtube.com/youtubei/v1/player?key=x', body: jsonBytes });
check('二进制 JSON: 也能剥离', !!r && r.body instanceof Uint8Array && !JSON.parse(new TextDecoder().decode(r.body)).adSlots);

// 7) 2026-11-07 网页播放回归后的安全基线：
//    只让 player|next|reel 三个端点走 JSON.parse 脱水；其余 youtubei 端点原样放行。
//    （扩到 browse/search/guide/get_watch 等全端点的版本曾与「网页无法播放」同时出现，已回退。
//     真实响应对比也证实这些端点本身不含 6 个广告键，扩白名单没有收益却有风险。）
for (const ep of ['player', 'next', 'reel/reel_watch_sequence']) {
  const rr = run({
    url: 'https://www.youtube.com/youtubei/v1/' + ep + '?key=x',
    body: JSON.stringify({ contents: { adPlacements: [{ a: 1 }] }, videoDetails: { videoId: 'ok' } })
  });
  const ok = !!rr && typeof rr.body === 'string' && !('adPlacements' in JSON.parse(rr.body).contents);
  check('端点 /' + ep + ' 走 JSON.parse 脱水', ok);
}
for (const ep of ['browse', 'search', 'guide', 'get_watch', 'account/get_setting', 'navigation/resolve_url']) {
  const rr = run({
    url: 'https://www.youtube.com/youtubei/v1/' + ep + '?key=x',
    body: JSON.stringify({ contents: { adPlacements: [{ a: 1 }] }, videoDetails: { videoId: 'ok' } })
  });
  check('非白名单端点 /' + ep + ' 原样放行（基线）', rr && Object.keys(rr).length === 0);
}

// 8) 内存红线：/watch 整页 HTML 绝不进脚本缓冲
const bigHtml = '<!DOCTYPE html><script>var ytInitialPlayerResponse = {"adPlacements":[1]};</script>';
r = run({ url: 'https://www.youtube.com/watch?v=abc&diag=1', body: bigHtml });
check('/watch 整页 HTML 不缓冲不改写', r && Object.keys(r).length === 0);

// 9) 非白名单端点不动（/youtubei/v1/config 等）
r = run({ url: 'https://www.youtube.com/youtubei/v1/config?key=x', body: JSON.stringify({ adSlots: [1] }) });
check('非白名单端点原样放行', r && Object.keys(r).length === 0);

console.log(`\n===== ${pass} passed, ${fail} failed =====`);
process.exit(fail ? 1 : 0);
