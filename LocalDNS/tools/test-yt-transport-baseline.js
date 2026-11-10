#!/usr/bin/env node
/**
 * YouTube 播放安全基线（Phase 0）契约测试。
 *
 * 这些断言保护的不是代码风格，而是「广告被拦截但视频不能播放」这个事故的成因：
 * 只要有人在基线模块里加回任何 YouTube body 脚本、MITM 截图或画质脚本，测试立刻变红。
 *
 * 用法：node tools/test-yt-transport-baseline.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BASE = path.join(ROOT, 'web/hub-yt-transport-baseline.sgmodule');
const MEMSAFE = path.join(ROOT, 'web/hub-local-canary-memsafe.sgmodule');

let passed = 0;
let failed = 0;
function check(name, ok, extra) {
  if (ok) {
    passed++;
    console.log('✅ ' + name);
  } else {
    failed++;
    console.log('❌ ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : ''));
  }
}

const text = fs.readFileSync(BASE, 'utf8');
const lines = text.split('\n');

/** 按段落切分模块 @returns {Record<string, string[]>} */
function sections(src) {
  const map = {};
  let cur = '_head';
  map[cur] = [];
  for (const line of src.split('\n')) {
    const t = line.trim();
    const m = t.match(/^\[([A-Za-z ]+)\]$/);
    if (m) {
      cur = m[1];
      map[cur] = [];
      continue;
    }
    if (t) map[cur].push(t);
  }
  return map;
}
const sec = sections(text);
const mem = sections(fs.readFileSync(MEMSAFE, 'utf8'));

const scriptLines = sec['Script'] || [];
const ruleLines = sec['Rule'] || [];
const mitmLine = (sec['MITM'] || []).find((l) => l.startsWith('hostname')) || '';

console.log('===== A. YouTube 脚本必须完全消失 =====');
check('不存在 youtube.enhance.* 脚本', !scriptLines.some((l) => l.startsWith('youtube.enhance.')), scriptLines.filter((l) => l.startsWith('youtube.enhance.')));
check('不存在 localdns_builtin_yt_web', !scriptLines.some((l) => l.startsWith('localdns_builtin_yt_web')));
check('不存在 log-event（内存告警元凶）', !text.includes('youtube.enhance.log-event'));
check('不存在 auto-hd（画质已隔离）', !text.includes('youtube.enhance.auto-hd'));
check('不存在 ump / init / key', !/youtube\.enhance\.(ump|init|key)\b/.test(text));

console.log('\n===== B. 任何脚本都不得命中 youtubei / googlevideo =====');
const ytPatterned = scriptLines.filter(
  (l) => l.includes('youtubei') || l.includes('googlevideo') || /youtube\[\.\]com/.test(l)
);
check('无脚本 pattern 覆盖 YouTube 数据面', ytPatterned.length === 0, ytPatterned.map((l) => l.slice(0, 60)));
check('基线内不存在 requires-body=1 的 YouTube 行', !scriptLines.some((l) => l.includes('youtube') && l.includes('requires-body')));

console.log('\n===== C. MITM 不再解密 YouTube =====');
check('MITM 不含 www.youtube.com', !mitmLine.includes('www.youtube.com'));
check('MITM 不含 youtubei.googleapis.com', !mitmLine.includes('youtubei.googleapis.com'));
check('MITM 不含 googlevideo', !mitmLine.includes('googlevideo'));
check('MITM 仍保留非 YouTube 主机（未误删）', mitmLine.includes('www.bilibili.com') && mitmLine.includes('api.pinduoduo.com'));

console.log('\n===== D. 连通性与广告阻断必须保留 =====');
check('googlevideo 走 PROXY', ruleLines.some((l) => /DOMAIN-SUFFIX,googlevideo\.com,PROXY/.test(l)));
check('ytimg 走 PROXY', ruleLines.some((l) => /DOMAIN-SUFFIX,ytimg\.com,PROXY/.test(l)));
check('youtubei 走 PROXY', ruleLines.some((l) => /DOMAIN,youtubei\.googleapis\.com,PROXY/.test(l)));
check('QUIC 443 降级保留', ruleLines.some((l) => /AND,\(\(PROTOCOL,UDP\),\(DEST-PORT,443\)\),REJECT-NO-DROP/.test(l)));
check('youtube pagead URL 被 REJECT', ruleLines.some((l) => l.includes('pagead') && l.includes('REJECT')));
check('youtube stats/ads URL 被 REJECT', ruleLines.some((l) => l.includes('stats/ads') && l.includes('REJECT')));
check('没有规则 REJECT 播放入口域名', !ruleLines.some((l) => /^(DOMAIN|DOMAIN-SUFFIX),(www\.)?youtube\.com,REJECT/.test(l)));

console.log('\n===== E. 非 YouTube 能力逐行保留（减法不得误删） =====');
for (const name of ['URL Rewrite', 'Header Rewrite', 'Body Rewrite', 'Map Local']) {
  const a = (mem[name] || []).length;
  const b = (sec[name] || []).length;
  check(`[${name}] 行数保持 ${a}`, a === b, { memsafe: a, baseline: b });
}
const memNonYtScripts = (mem['Script'] || []).filter((l) => !l.startsWith('youtube.enhance.') && !l.startsWith('localdns_builtin_yt_web'));
check(`[Script] 仅剩非 YouTube 脚本 ${memNonYtScripts.length} 条`, scriptLines.length === memNonYtScripts.length, {
  expect: memNonYtScripts.length,
  actual: scriptLines.length,
});
check('非 YouTube 脚本内容逐一一致', JSON.stringify(scriptLines) === JSON.stringify(memNonYtScripts));

console.log('\n===== F. 模块元信息 =====');
check('name 标记为 Transport Baseline', text.includes('#!name=LocalDNS YouTube Transport Baseline'));
check('desc 说明零 body 脚本', text.includes('零 body 脚本'));

const bytes = Buffer.byteLength(text);
console.log('\n===== 结果 =====');
console.log(`文件 ${path.relative(ROOT, BASE)}  ${bytes} B  脚本 ${scriptLines.length} 条  规则 ${ruleLines.length} 条`);
console.log(`\n播放安全基线：${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
