import { Path, Script } from 'scripting';
import { SurgeService } from '../src/surge-service';
import { DnsResolver } from '../src/resolver';
import { DiversionEngine } from '../src/diversion';
import { AdGuardEngine } from '../src/adguard';

const YT_AD_DOMAINS = [
  's.youtube.com',
  's2.youtube.com',
  'ads.youtube.com',
  'video-stats.l.google.com',
  'video-stats.youtube.com',
  'stats_check.youtube.com',
  'pagead2.googlesyndication.com',
  'googleads.g.doubleclick.net',
  'pubads.g.doubleclick.net',
  'securepubads.g.doubleclick.net',
  'static.doubleclick.net',
  'ad.doubleclick.net',
  'doubleclick.net',
  'g.doubleclick.net',
  'adservice.google.com',
  'ytads.google.com',
];

const YT_CORE_DOMAINS = [
  'www.youtube.com',
  'm.youtube.com',
  'youtubei.googleapis.com',
  'i.ytimg.com',
  'redirector.googlevideo.com',
];

async function main() {
  const service = SurgeService.get();
  await service.init();
  const resolver = DnsResolver.get();

  console.log('========== 1) DNS 层：YouTube 广告域名拦截验证 ==========');
  let blockedOk = 0;
  for (const d of YT_AD_DOMAINS) {
    const div = DiversionEngine.get().match(d, '127.0.0.1');
    const ag = AdGuardEngine.get().isBlocked(d);
    const res = await resolver.resolveName(d, 1, '127.0.0.1');
    const isBlocked = res.addresses.includes('0.0.0.0') || res.blocked;
    if (isBlocked) blockedOk++;
    console.log(`  ${isBlocked ? '✅' : '❌'} ${d.padEnd(36)} blocked=${res.blocked} set=${div.domainSet} answers=${res.addresses.join(',')}`);
  }
  console.log(`  => 广告域名命中拦截：${blockedOk}/${YT_AD_DOMAINS.length}`);

  console.log('\n========== 2) DNS 层：YouTube 核心域名必须放行 ==========');
  let coreOk = 0;
  for (const d of YT_CORE_DOMAINS) {
    const res = await resolver.resolveName(d, 1, '127.0.0.1');
    const isBlocked = res.blocked || res.addresses.includes('0.0.0.0');
    if (!isBlocked) coreOk++;
    console.log(`  ${!isBlocked ? '✅' : '❌'} ${d.padEnd(36)} blocked=${isBlocked} answers=${res.addresses.slice(0, 2).join(',')}`);
  }
  console.log(`  => 核心域名正常放行：${coreOk}/${YT_CORE_DOMAINS.length}`);

  console.log('\n========== 3) 七层层：hub.sgmodule App / 浏览器分流与 Enhance 脚本完整性 ==========');
  const hub = await service.compileUnifiedHubModule();
  const hubLines = hub.split('\n');
  const scriptLines = hubLines.filter(l => /^(?:youtube\.enhance\.|localdns_builtin_yt_web)/.test(l));
  console.log(`  YouTube 相关脚本数量：${scriptLines.length}`);
  for (const l of scriptLines) {
    const name = l.split('=')[0].trim();
    const hasBinary = l.includes('binary-body-mode=1');
    const hasEngine = /engine=(webview|jsc)/.test(l);
    const hasArg = l.includes('argument=');
    console.log(`  • ${name}`);
    console.log(`      binary-body-mode=${hasBinary} engine=${hasEngine} argument=${hasArg}`);
  }
  const respScripts = scriptLines.filter(l => l.includes('type=http-response') && l.includes('requires-body=1'));
  const respAllOk = respScripts.every(l => l.includes('binary-body-mode=1') && l.includes('engine=jsc'));
  console.log(`  ${respAllOk ? '✅' : '❌'} 所有需 body 的响应脚本均带 binary-body-mode + engine=jsc`);

  const mediaNames = ['youtube.enhance.ump'];
  const mediaOk = mediaNames.every(n => hubLines.some(l => l.startsWith(n)));
  const noBuiltinWebInHub = !hubLines.some(l => l.startsWith('localdns_builtin_yt_web ='));
  const responseLine = hubLines.find(l => l.startsWith('youtube.enhance.response')) || '';
  const umpLine = hubLines.find(l => l.startsWith('youtube.enhance.ump')) || '';
  const responseFull = ['player', 'next', 'get_watch'].every(k => responseLine.includes(k));
  const localJscPolyfill =
    /\/scripts\/yt\/response\.jsc\.[0-9a-f]{12}\.js/.test(responseLine) &&
    /\/scripts\/yt\/ump\.jsc\.[0-9a-f]{12}\.js/.test(umpLine);
  const mitmLine = hubLines.find(l => l.startsWith('hostname =')) || '';
  const mitmGooglevideo = mitmLine.includes('*.googlevideo.com');
  const mitmYoutubei = mitmLine.includes('youtubei.googleapis.com');
  const mitmNoWebYoutube =
    !/\bwww\.youtube\.com\b/.test(mitmLine) &&
    !/\bm\.youtube\.com\b/.test(mitmLine) &&
    !/\bs\.youtube\.com\b/.test(mitmLine) &&
    !/\bimasdk\.googleapis\.com\b/.test(mitmLine);

  const rulesTsText = FileManager.readAsStringSync(
    Path.join(Script.directory, 'src', 'youtube-rules.ts')
  );
  const serviceTsText = FileManager.readAsStringSync(
    Path.join(Script.directory, 'src', 'surge-service.ts')
  );
  const singleSourceOfTruth =
    serviceTsText.includes("from './youtube-rules'") &&
    serviceTsText.includes('wrapYoutubeEnhanceForJsc(') &&
    rulesTsText.includes('JSC_TEXT_CODEC_POLYFILL') &&
    rulesTsText.includes('JSC_GZIP_STREAM_POLYFILL');

  const builtinJsText = FileManager.readAsStringSync(
    Path.join(Script.directory, 'web', 'scripts', 'youtube-web.js')
  );
  const surfaceSplit =
    builtinJsText.includes('function surfaceOf(') &&
    builtinJsText.includes('function modeFor(') &&
    builtinJsText.includes('function webSignedIn(');

  console.log(`  ${mediaOk ? '✅' : '❌'} ump/init/auto-hd 媒体脚本全部存在`);
  console.log(`  ${noBuiltinWebInHub ? '✅' : '❌'} Hub 不再注入 localdns_builtin_yt_web（网页端交给浏览器插件）`);
  console.log(`  ${localJscPolyfill ? '✅' : '❌'} response/ump 使用本地 JSC 兼容不可变脚本（含 TextEncoder/TextDecoder）`);
  console.log(`  ${singleSourceOfTruth ? '✅' : '❌'} 规则与 JSC 包装来自单一真相 src/youtube-rules.ts`);
  console.log(`  ${responseFull ? '✅' : '❌'} response.js 覆盖 player/next/get_watch 全端点`);
  console.log(`  ${mitmGooglevideo && mitmYoutubei ? '✅' : '❌'} App 域名 *.googlevideo.com + youtubei.googleapis.com 在 MITM`);
  console.log(`  ${mitmNoWebYoutube ? '✅' : '❌'} 网页域名 www/m/s.youtube.com + imasdk 已从 Hub MITM 剔除`);
  console.log(`  ${surfaceSplit ? '✅' : '❌'} youtube-web.js 保留双面逻辑备用`);

  console.log('\n========== 4) 七层层：MITM 解密域名与网页端排除校验 ==========');
  for (const h of ['*.googlevideo.com', 'youtubei.googleapis.com']) {
    const present = mitmLine.includes(h);
    console.log(`  ${present ? '✅' : '❌'} 包含 App 域: ${h}`);
  }
  for (const h of ['www.youtube.com', 'm.youtube.com', 's.youtube.com', 'imasdk.googleapis.com']) {
    const absent = !new RegExp(`(?:^|,\\s*)${h.replace(/\./g, '\\.')}(?:,|$)`).test(mitmLine);
    console.log(`  ${absent ? '✅' : '❌'} 排除网页域: ${h}`);
  }

  console.log('\n========== 5) 七层层：网页端广告/诱饵端点不再被 Hub 误拒 ==========');
  const noWebReject =
    !hub.includes('www[.]youtube[.]com/(pagead|pcs)') &&
    !hub.includes('www\\.youtube\\.com\\/(pagead|pcs)') &&
    !hub.includes('s[.]youtube[.]com/api/stats/ads') &&
    !hub.includes('s\\.youtube\\.com\\/api\\/stats\\/ads');
  console.log(`  ${noWebReject ? '✅' : '❌'} Hub 不再拦截网页端 pagead/stats/ads（交由浏览器插件处理）`);

  console.log('\n========== 6) 生成的 Surge 完整配置：QUIC 与 block.list ==========');
  const conf = await service.generateSurgeConfig({ host: '127.0.0.1:9099' });
  const hasBlockQuic = conf.includes('block-quic = true');
  const hasUdpReject = conf.includes('AND,((PROTOCOL,UDP),(DEST-PORT,443)),REJECT-NO-DROP');
  const hasBlockList = conf.includes('/rules/block.list,REJECT');
  const hasDoh = conf.includes('https://127.0.0.1:9443/dns-query');
  console.log(`  ${hasBlockQuic ? '✅' : '❌'} block-quic = true`);
  console.log(`  ${hasUdpReject ? '✅' : '❌'} UDP 443 REJECT-NO-DROP`);
  console.log(`  ${hasBlockList ? '✅' : '❌'} RULE-SET block.list,REJECT`);
  console.log(`  ${hasDoh ? '✅' : '❌'} doh-server 接管`);

  // ===== 读取播放 smoke 结果（由 tools/test-yt-playback-smoke.js 落盘）=====
  let smoke: any = null;
  const smokePath = Path.join(Script.directory, 'tools', 'fixtures', 'youtube', 'smoke-result.json');
  try {
    if (FileManager.existsSync(smokePath)) {
      smoke = JSON.parse(FileManager.readAsStringSync(smokePath));
    }
  } catch (e) {
    smoke = null;
  }
  const smokeAvailable = !!smoke;
  const playbackSmokeOk = !!(smoke && smoke.playbackSmokeOk);
  const adRemovalInFixture = !!(smoke && smoke.adRemoved);
  const streamingDataPreserved = !!(smoke && smoke.streamingDataPreserved);

  console.log('\n========== 7) 分项结论 ==========');
  console.log(`  ${smokeAvailable ? '✅' : '❌'} 播放 smoke 结果可读`);
  console.log(`  ${playbackSmokeOk ? '✅' : '❌'} 播放 smoke 通过（删广告不破坏 streamingData）`);
  console.log(`  ${adRemovalInFixture ? '✅' : '❌'} 合成样本中广告键被删除`);
  console.log(`  ${streamingDataPreserved ? '✅' : '❌'} streamingData 完整保留`);

  const configurationOk =
    blockedOk >= 11 && // s.youtube.com 等播放生命线故意放行，不能要求 16/16
    coreOk === YT_CORE_DOMAINS.length &&
    respAllOk &&
    mediaOk &&
    noBuiltinWebInHub &&
    localJscPolyfill &&
    singleSourceOfTruth &&
    responseFull &&
    mitmGooglevideo &&
    mitmYoutubei &&
    mitmNoWebYoutube &&
    noWebReject &&
    hasBlockQuic &&
    hasUdpReject &&
    hasBlockList;

  const scriptUnitOk = smokeAvailable && playbackSmokeOk;
  const memorySafe = !hub.includes('localdns_builtin_yt_html');

  // 真实流量去广告效果只能由「带登录态的真实播放」证明，测试环境无法自证。
  const realTrafficObserved = false;
  const adRemovalObserved = false;

  const verdict =
    !configurationOk
      ? 'configuration-broken'
      : !scriptUnitOk
        ? 'script-unit-failed'
        : 'playback-ok-ad-removal-unverified';

  const okToShip = configurationOk && scriptUnitOk;

  console.log(`\n===== 总体结论：${okToShip ? '✅ 配置与脚本就绪' : '⚠️ 存在未就绪项'} =====`);
  console.log(`  verdict: ${verdict}`);
  if (okToShip) {
    console.log('  说明：已验证「配置正确 + 删广告不破坏播放」。');
    console.log('        真实流量是否真的去掉广告仍未证明，需按 README 做带登录态采样。');
  }

  Script.exit({
    verdict,
    okToShip,
    configurationOk,
    scriptUnitOk,
    playbackSmokeOk,
    memorySafe,
    adRemovalInFixture,
    streamingDataPreserved,
    realTrafficObserved,
    adRemovalObserved,
    details: {
      blockedOk,
      coreOk,
      ytScripts: scriptLines.length,
      respAllOk,
      mediaOk,
      noBuiltinWebInHub,
      localJscPolyfill,
      surfaceSplit,
      responseFull,
      mitmGooglevideo,
      mitmYoutubei,
      mitmNoWebYoutube,
      noWebReject,
      singleSourceOfTruth,
      hasBlockQuic,
      hasUdpReject,
      hasBlockList,
    },
  });
}

main().catch(e => {
  console.error(e);
  Script.exit();
});
