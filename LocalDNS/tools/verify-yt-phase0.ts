/**
 * Phase 0 运行时验证：播放安全基线。
 *
 * 与 tools/test-yt-transport-baseline.js（静态契约）互补：
 *   - 静态测试证明「模块里没有 YouTube body 脚本」
 *   - 本脚本证明「DNS 层没有误伤播放域名」，并输出机器可读 verdict
 *
 * 用法：scripting-ts run tools/verify-yt-phase0.ts
 */
import { Script } from 'scripting';
import { DnsResolver } from '../src/resolver';

/** 播放必需域名：任何一个被判为拦截，视频就会挂。 */
const PLAYBACK_DOMAINS = [
  'www.youtube.com',
  'm.youtube.com',
  'youtubei.googleapis.com',
  'i.ytimg.com',
  'redirector.googlevideo.com',
  'rr1---sn-4g5e6nzz.googlevideo.com',
];

/** 广告域名：拦截是期望行为，但不必全中（部分走 URL 层而非 DNS 层）。 */
const AD_DOMAINS = [
  'ads.youtube.com',
  'pagead2.googlesyndication.com',
  'googleads.g.doubleclick.net',
  'pubads.g.doubleclick.net',
  'securepubads.g.doubleclick.net',
  'ad.doubleclick.net',
  'adservice.google.com',
  'ytads.google.com',
];

function isBlocked(res: { blocked?: boolean; addresses: string[] }): boolean {
  return !!res.blocked || res.addresses.includes('0.0.0.0') || res.addresses.includes('::');
}

async function main() {
  const resolver = DnsResolver.get();

  console.log('========== 1) 播放域名必须放行（误伤即事故） ==========');
  let playbackOk = 0;
  const playbackBad: string[] = [];
  for (const d of PLAYBACK_DOMAINS) {
    const res = await resolver.resolveName(d, 1, '127.0.0.1');
    const bad = isBlocked(res);
    if (!bad) playbackOk++;
    else playbackBad.push(d);
    console.log(`  ${bad ? '❌' : '✅'} ${d.padEnd(38)} blocked=${bad} answers=${res.addresses.slice(0, 2).join(',') || '(empty)'}`);
  }
  console.log(`  => 放行 ${playbackOk}/${PLAYBACK_DOMAINS.length}`);

  console.log('\n========== 2) 广告域名拦截（DNS 层覆盖率） ==========');
  let adOk = 0;
  for (const d of AD_DOMAINS) {
    const res = await resolver.resolveName(d, 1, '127.0.0.1');
    const blocked = isBlocked(res);
    if (blocked) adOk++;
    console.log(`  ${blocked ? '✅' : '⚠️ '} ${d.padEnd(38)} blocked=${blocked}`);
  }
  console.log(`  => 广告域名 DNS 拦截 ${adOk}/${AD_DOMAINS.length}`);

  console.log('\n========== 3) 基线模块可安装性 ==========');
  const baseUrl = 'http://127.0.0.1:9099/ui/hub-yt-transport-baseline.sgmodule';
  let baselineReadable = false;
  let baselineBytes = 0;
  let noYtScripts = false;
  try {
    const resp = await fetch(baseUrl);
    const text = await resp.text();
    baselineBytes = text.length;
    baselineReadable = resp.ok && text.length > 0;
    noYtScripts =
      !text.includes('youtube.enhance.') &&
      !text.includes('localdns_builtin_yt_web') &&
      !text.includes('log-event') &&
      !text.includes('auto-hd');
    console.log(`  HTTP ${resp.status} / ${baselineBytes} chars`);
  } catch (e) {
    console.log('  拉取基线失败:', String(e));
  }
  console.log(`  ${baselineReadable ? '✅' : '❌'} 本地可读 (${baselineBytes} chars)`);
  console.log(`  ${noYtScripts ? '✅' : '❌'} 确认不含任何 YouTube 播放脚本`);

  console.log('\n========== 4) 结论 ==========');
  const playbackSafe = playbackOk === PLAYBACK_DOMAINS.length;
  const verdict = !playbackSafe
    ? 'playback-blocked-by-dns'
    : !noYtScripts
    ? 'baseline-contaminated'
    : 'phase0-ok';

  const result = {
    verdict,
    playbackDomainsOk: playbackOk,
    playbackDomainsTotal: PLAYBACK_DOMAINS.length,
    blockedPlaybackDomains: playbackBad,
    adDomainsDnsBlocked: adOk,
    adDomainsTotal: AD_DOMAINS.length,
    baselineReadable,
    baselineNoYtScripts: noYtScripts,
    // Phase 0 只建立播放基线，网页/客户端去广告能力在此阶段刻意关闭
    webAdRemoval: 'deferred-to-phase1',
    clientAdRemoval: 'disabled',
    qualityEnhancement: 'disabled',
  };

  console.log(`  verdict: ${verdict}`);
  if (verdict === 'phase0-ok') {
    console.log('  说明：DNS 未误伤播放域名，基线模块不含任何 YouTube 播放脚本。');
    console.log('        此时播放应恢复；网页去广告交由 Phase 1 的 Safari 母核。');
  } else if (verdict === 'playback-blocked-by-dns') {
    console.log(`  阻断域名：${playbackBad.join(', ')}`);
  }

  Script.exit(JSON.stringify(result, null, 2));
}

main();
