#!/usr/bin/env node
/**
 * 生成 YouTube「播放安全基线」模块（Phase 0）。
 *
 * 做法是从当前稳定模块做**减法**，而不是重写：
 *   - 删掉所有 youtube.enhance.* 脚本行
 *   - 删掉 localdns_builtin_yt_web（网页 JSON 留给 Safari 母核）
 *   - 从 MITM hostname 里摘掉 YouTube 域名（没有脚本需要解密，解密只是白白增加开销与故障面）
 *   - 其余 Rule / URL Rewrite / Header Rewrite / Body Rewrite / Map Local / 非 YouTube 脚本逐行原样保留
 *
 * 为什么用减法：重写整份模块会丢掉拼多多/闲鱼/B站等已调好的规则，那是不可接受的回归。
 *
 * 用法：node tools/build-yt-transport-baseline.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'web/hub-local-canary-memsafe.sgmodule');
const OUT = path.join(ROOT, 'web/hub-yt-transport-baseline.sgmodule');

/** 需要从 MITM 里剔除的 YouTube 域名（基线无脚本消费，解密纯属负担）。 */
const YT_MITM_HOSTS = [
  'www.youtube.com',
  'm.youtube.com',
  'youtubei.googleapis.com',
  's.youtube.com',
  '*.googlevideo.com',
];

/** 是否是需要移除的 YouTube 脚本行。 */
function isYtScriptLine(line) {
  const t = line.trimStart();
  return t.startsWith('youtube.enhance.') || t.startsWith('localdns_builtin_yt_web =');
}

const raw = fs.readFileSync(SRC, 'utf8');
const lines = raw.split('\n');

let inMitm = false;
const out = [];
const removedScripts = [];
const removedMitmHosts = [];

for (const line of lines) {
  const trimmed = line.trim();

  // 段落切换
  if (/^\[[A-Za-z ]+\]$/.test(trimmed)) {
    inMitm = trimmed === '[MITM]';
    out.push(line);
    continue;
  }

  // 标题行改写
  if (trimmed.startsWith('#!name=')) {
    out.push('#!name=LocalDNS YouTube Transport Baseline');
    continue;
  }
  if (trimmed.startsWith('#!desc=')) {
    out.push(
      '#!desc=播放安全基线：仅 YouTube 连通性与广告域名阻断，零 body 脚本。' +
        '网页清洗交给 Safari AdBlockHub，客户端 protobuf 与画质增强默认关闭。'
    );
    continue;
  }

  // 修正误导性注释：基线已不再 MITM YouTube，注释必须与新事实一致
  if (/^#\s*拦截 QUIC/.test(trimmed)) {
    out.push('# 拦截 QUIC (UDP 443)，迫使客户端回退 TCP；基线不 MITM YouTube，仅保证 TCP 连通');
    continue;
  }

  // 移除 YouTube 脚本行
  if (isYtScriptLine(line)) {
    removedScripts.push(trimmed.split('=')[0].trim());
    continue;
  }

  // MITM hostname 剔除 YouTube 域名
  if (inMitm && trimmed.startsWith('hostname')) {
    const m = trimmed.match(/^(hostname\s*=\s*)(.*)$/);
    if (m) {
      const hosts = m[2]
        .split(',')
        .map((h) => h.trim())
        .filter((h) => {
          if (!h) return false;
          if (YT_MITM_HOSTS.includes(h)) {
            removedMitmHosts.push(h);
            return false;
          }
          return true;
        });
      out.push(`${m[1]}${hosts.join(', ')}`);
      continue;
    }
  }

  out.push(line);
}

// 收尾：压缩连续空行（段落被删空时会出现）
let text = out.join('\n').replace(/\n{3,}/g, '\n\n');
if (!text.endsWith('\n')) text += '\n';

fs.writeFileSync(OUT, text, 'utf8');

console.log('源模块 :', path.relative(ROOT, SRC));
console.log('输出   :', path.relative(ROOT, OUT));
console.log('移除脚本:', removedScripts.length, removedScripts.join(', '));
console.log('移除MITM:', removedMitmHosts.length, removedMitmHosts.join(', '));
console.log('输出大小:', Buffer.byteLength(text), 'B');
