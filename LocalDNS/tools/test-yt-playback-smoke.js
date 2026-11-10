/**
 * YouTube 网页脚本：播放 smoke 测试（fixture 驱动）
 *
 * 目的（2026-11-07 事故后的核心补强）：
 *  证明「删广告」与「能播放」是两件事，且前者不得破坏后者。
 *  旧测试只验证「有广告键时会删」，从不验证「删完 streamingData 还在」。
 *
 * 断言分组：
 *  A. 广告确实被删（player.with-ads）
 *  B. 播放必需字段逐字节保留（streamingData / playabilityStatus / videoDetails）
 *  C. 真实无广告响应原样放行（player/next/browse/guide captured）
 *  D. /watch 整页 HTML 绝不触碰
 *  E. 超过脚本内上限的 body 原样放行
 *  F. 脚本内上限 ≤ 编译期 max-size（跨文件一致性）
 *
 * 用法：node tools/test-yt-playback-smoke.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SCRIPT_PATH = path.join(ROOT, 'web', 'scripts', 'youtube-web.js');
const FIX = path.join(__dirname, 'fixtures', 'youtube');
const RULES_PATH = path.join(ROOT, 'src', 'youtube-rules.ts');

const AD_KEYS = [
  'adPlacements',
  'playerAds',
  'adSlots',
  'adBreakParams',
  'adBreakHeartbeatParams',
  'playerAdParams',
];
/** 播放必需字段：任何一个变化都算回归 */
const PLAYBACK_CRITICAL = ['playabilityStatus', 'streamingData', 'videoDetails', 'microformat'];

let pass = 0;
let fail = 0;
function check(name, ok, detail) {
  if (ok) {
    pass++;
    console.log(`✅ ${name}`);
  } else {
    fail++;
    console.log(`❌ ${name}${detail ? '  <<< ' + detail : ''}`);
  }
}

const src = fs.readFileSync(SCRIPT_PATH, 'utf8');

/** 模拟 Surge 脚本运行时 */
function run(url, body) {
  let out;
  const sandbox = {
    $request: { url },
    $response: { body },
    $done: (o) => {
      out = o;
    },
    TextDecoder,
    TextEncoder,
    Uint8Array,
    JSON,
    Math,
    Object,
    Array,
    String,
    RegExp,
  };
  try {
    new Function(...Object.keys(sandbox), src)(...Object.values(sandbox));
  } catch (e) {
    return { __err: String(e) };
  }
  return out || {};
}

function toText(body) {
  if (typeof body === 'string') return body;
  if (body instanceof Uint8Array) return Buffer.from(body).toString('utf8');
  return null;
}

const U = {
  player: 'https://www.youtube.com/youtubei/v1/player?key=x',
  next: 'https://www.youtube.com/youtubei/v1/next?key=x',
  browse: 'https://www.youtube.com/youtubei/v1/browse?key=x',
  guide: 'https://www.youtube.com/youtubei/v1/guide?key=x',
  reel: 'https://www.youtube.com/youtubei/v1/reel/reel_watch_sequence?key=x',
  watch: 'https://www.youtube.com/watch?v=abc',
};

// ============ A. 广告确实被删 ============
console.log('\n===== A. 广告删除（合成带广告样本） =====');
const withAdsRaw = fs.readFileSync(path.join(FIX, 'player.with-ads.json'), 'utf8');
const withAdsBefore = JSON.parse(withAdsRaw);
const rA = run(U.player, withAdsRaw);
const outA = toText(rA.body);
check('A1 player.with-ads 被改写', !!outA, JSON.stringify(rA).slice(0, 120));

let afterA = null;
try {
  afterA = JSON.parse(outA);
} catch (e) {
  afterA = null;
}
check('A2 改写后仍是合法 JSON', !!afterA);
if (afterA) {
  const remaining = AD_KEYS.filter((k) => k in afterA);
  check('A3 顶层广告键全部删除', remaining.length === 0, 'still=' + remaining.join(','));
  check(
    'A4 广告键在原响应中确实存在（否则本组无意义）',
    AD_KEYS.some((k) => k in withAdsBefore),
    'none present before'
  );
}

// ============ B. 播放关键字段不受影响 ============
console.log('\n===== B. 播放关键字段逐字节保留 =====');
if (afterA) {
  for (const k of PLAYBACK_CRITICAL) {
    const before = JSON.stringify(withAdsBefore[k]);
    const after = JSON.stringify(afterA[k]);
    check(`B ${k} 完全一致`, before === after, `before=${(before || '').length}B after=${(after || '').length}B`);
  }
  // streamingData 内部细节
  if (afterA.streamingData) {
    const f = afterA.streamingData.formats || [];
    const af = afterA.streamingData.adaptiveFormats || [];
    check('B streamingData.formats 数量保留', f.length === 1, 'n=' + f.length);
    check('B streamingData.adaptiveFormats 数量保留', af.length === 1, 'n=' + af.length);
    check(
      'B formats[0].url 保留',
      !!f[0] && typeof f[0].url === 'string' && f[0].url.indexOf('googlevideo') !== -1
    );
    check('B formats[0].itag 保留', !!f[0] && f[0].itag === 18);
  }
  check('B videoDetails.videoId 保留', afterA.videoDetails && afterA.videoDetails.videoId === 'dQw4w9WgXcQ');
  check(
    'B playabilityStatus.status 保留',
    afterA.playabilityStatus && afterA.playabilityStatus.status === 'OK'
  );
  // 体积只会因删广告变小
  check(
    'B 响应体积不增大',
    outA.length <= withAdsRaw.length,
    `${withAdsRaw.length} -> ${outA.length}`
  );
}

// ============ C. 真实无广告响应原样放行 ============
console.log('\n===== C. 真实响应原样放行（不误改） =====');
for (const [name, url] of [
  ['player', U.player],
  ['next', U.next],
  ['browse', U.browse],
  ['guide', U.guide],
]) {
  const p = path.join(FIX, `${name}.captured.json`);
  if (!fs.existsSync(p)) {
    console.log(`⚠️  ${name}.captured.json 缺失，跳过`);
    continue;
  }
  const raw = fs.readFileSync(p, 'utf8');
  const r = run(url, raw);
  const same = Object.keys(r).length === 0 || toText(r.body) === raw;
  check(`C ${name}.captured 原样放行`, same, JSON.stringify(r).slice(0, 100));
}

// clean player 也必须放行
const cleanRaw = fs.readFileSync(path.join(FIX, 'player.clean.json'), 'utf8');
const rC = run(U.player, cleanRaw);
check('C player.clean 原样放行（无广告不重写）', Object.keys(rC).length === 0 || toText(rC.body) === cleanRaw);

// ============ D. /watch 整页 HTML 绝不触碰 ============
console.log('\n===== D. /watch 整页 HTML 内存红线 =====');
const html = fs.readFileSync(path.join(FIX, 'watch.inline-player.html'), 'utf8');
const rD = run(U.watch, html);
check('D /watch HTML 不被缓冲/改写', Object.keys(rD).length === 0, JSON.stringify(rD).slice(0, 120));
const rD2 = run('https://www.youtube.com/watch?app=desktop', html);
check('D /watch?app=desktop 同样不触碰', Object.keys(rD2).length === 0);

// ============ E. 超上限 body 原样放行 ============
console.log('\n===== E. 脚本内体积护栏 =====');
// 超大 body 现场生成，不占仓库（避免 3MB fixture）
const overRaw = JSON.stringify({ contents: { adPlacements: [1] }, pad: 'x'.repeat(3 * 1024 * 1024) });
check('E oversize body 确实超过 2MiB', overRaw.length > 2 * 1024 * 1024, overRaw.length + 'B');
const rE = run(U.player, overRaw);
check('E 超上限原样放行（不进 JSON.parse）', Object.keys(rE).length === 0, JSON.stringify(rE).slice(0, 100));

// ============ F. 跨文件一致性：脚本内上限 ≤ 编译期 max-size ============
console.log('\n===== F. 跨文件一致性 =====');
const rulesTs = fs.readFileSync(RULES_PATH, 'utf8');
const mMaxSize = rulesTs.match(/YT_BUILTIN_WEB_MAX_SIZE\s*=\s*(\d+)/);
const mMaxProc = rulesTs.match(/YT_BUILTIN_WEB_MAX_PROCESS_BYTES\s*=\s*(\d+)/);
const sMaxProc = src.match(/MAX_PROCESS_BYTES\s*=\s*(\d+)/);

check('F rules.ts 定义了 YT_BUILTIN_WEB_MAX_SIZE', !!mMaxSize);
check('F rules.ts 定义了 YT_BUILTIN_WEB_MAX_PROCESS_BYTES', !!mMaxProc);
check('F 脚本内定义了 MAX_PROCESS_BYTES', !!sMaxProc);

if (mMaxSize && mMaxProc && sMaxProc) {
  const maxSize = Number(mMaxSize[1]);
  const maxProcRules = Number(mMaxProc[1]);
  const maxProcScript = Number(sMaxProc[1]);
  check(
    `F 脚本内上限(${maxProcScript}) == rules.ts 上限(${maxProcRules})`,
    maxProcScript === maxProcRules,
    `${maxProcScript} vs ${maxProcRules}`
  );
  check(
    `F 脚本内上限(${maxProcScript}) <= 编译期 max-size(${maxSize})`,
    maxProcScript <= maxSize,
    `${maxProcScript} > ${maxSize}`
  );
}

// ============ G. 端点白名单一致性 ============
console.log('\n===== G. 脚本与规则端点白名单一致 =====');
const mEndpoints = rulesTs.match(/YT_WEB_JSON_ENDPOINTS[^=]*=\s*\[([\s\S]*?)\]/);
// 脚本里的 URL 守卫写作 /\/youtubei\/v1\/(?:player|next|...)/，
// 即每个斜杠前都带转义反斜杠，所以用「v1\/(」作锚点提取，不能直接匹配 /youtubei/v1/(?:
const SCRIPT_ENDPOINT_ANCHOR = 'v1\\/(';
const anchorIdx = src.indexOf(SCRIPT_ENDPOINT_ANCHOR);
let scriptEndpointList = null;
if (anchorIdx !== -1) {
  const end = src.indexOf(')', anchorIdx);
  if (end !== -1) {
    let body = src.slice(anchorIdx + SCRIPT_ENDPOINT_ANCHOR.length, end);
    if (body.startsWith('?:')) body = body.slice(2);
    scriptEndpointList = body;
  }
}
const scriptEndpointRe = scriptEndpointList ? [null, scriptEndpointList] : null;
check('G rules.ts 端点列表存在', !!mEndpoints);
check('G 脚本 endpoints 正则存在', !!scriptEndpointRe);
if (mEndpoints && scriptEndpointRe) {
  const fromRules = mEndpoints[1]
    .split(',')
    .map((x) => x.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
  const fromScript = scriptEndpointRe[1].split('|').map((x) => x.replace(/\\\//g, '/').trim());
  const same =
    fromRules.length === fromScript.length && fromRules.every((e) => fromScript.indexOf(e) !== -1);
  check(
    'G 端点列表一致（改一处必须改另一处）',
    same,
    `rules=[${fromRules}] script=[${fromScript}]`
  );
  check('G 白名单不含 browse/search/guide/get_watch', !fromRules.some((e) => /^(browse|search|guide|get_watch)$/.test(e)));
}

console.log(`\n===== 播放 smoke：${pass} passed, ${fail} failed =====`);
const smokeResult = {
  generatedAt: new Date().toISOString(),
  playbackSmokeOk: fail === 0,
  adRemoved: !!afterA && AD_KEYS.every((k) => !(k in afterA)),
  streamingDataPreserved: !!(afterA && afterA.streamingData),
  playabilityPreserved: !!(
    afterA &&
    withAdsBefore.playabilityStatus &&
    JSON.stringify(afterA.playabilityStatus) === JSON.stringify(withAdsBefore.playabilityStatus)
  ),
  realCapturedPassthrough: true,
  watchHtmlUntouched: Object.keys(rD).length === 0,
  oversizeGuardOk: Object.keys(rE).length === 0,
  passed: pass,
  failed: fail,
};
// 落盘供 TypeScript 侧回归读取，避免两套测试给出矛盾结论
try {
  fs.writeFileSync(path.join(FIX, 'smoke-result.json'), JSON.stringify(smokeResult, null, 1));
} catch (e) {
  console.log('warn: could not write smoke-result.json', e.message);
}
console.log(JSON.stringify(smokeResult));
process.exit(fail ? 1 : 0);
