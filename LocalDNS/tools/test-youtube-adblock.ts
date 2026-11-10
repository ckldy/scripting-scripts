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

  console.log('\n========== 3) 七层层：hub.sgmodule YouTube 脚本完整性 ==========');
  const hub = await service.compileUnifiedHubModule();
  const hubLines = hub.split('\n');
  const scriptLines = hubLines.filter(l => /^(?:youtube\.enhance\.|localdns_builtin_yt_web)/.test(l));
  console.log(`  YouTube 相关脚本数量：${scriptLines.length}`);
  const checks: Array<[string, boolean]> = [];
  for (const l of scriptLines) {
    const name = l.split('=')[0].trim();
    const isResponseWithBody = l.includes('type=http-response') && l.includes('requires-body=1');
    const hasBinary = l.includes('binary-body-mode=1');
    const hasEngine = /engine=(webview|jsc)/.test(l);
    const hasArg = l.includes('argument=');
    console.log(`  • ${name}`);
    console.log(`      binary-body-mode=${hasBinary} engine=${hasEngine} argument=${hasArg}`);
    if (isResponseWithBody) {
      checks.push([`${name}: binary-body-mode`, hasBinary]);
      checks.push([`${name}: engine`, hasEngine]);
    }
  }
  const respScripts = scriptLines.filter(l => l.includes('type=http-response') && l.includes('requires-body=1'));
  const respAllOk = respScripts.every(l => l.includes('binary-body-mode=1') && /engine=(webview|jsc)/.test(l));
  console.log(`  ${respAllOk ? '✅' : '❌'} 所有需 body 的响应脚本均带 binary-body-mode + engine`);

  // Surge 每个响应只跑第一条匹配的 http-response 脚本；内置 yt_web 必须排在
  // youtube.enhance.response 之前。2026-11-07 实测：把 gholts 排到前面会让客户端打不开。
  const ytEnhanceIdx = hubLines.findIndex(l => l.startsWith('youtube.enhance.response'));
  const ytBuiltinIdx = hubLines.findIndex(l => l.startsWith('localdns_builtin_yt_web'));
  const orderOk = ytEnhanceIdx === -1 || (ytBuiltinIdx !== -1 && ytBuiltinIdx < ytEnhanceIdx);
  console.log(`  ${orderOk ? '✅' : '❌'} 排序：localdns_builtin_yt_web (${ytBuiltinIdx}) -> youtube.enhance.response (${ytEnhanceIdx})`);

  // 2026-11-07 回归：四项媒体限制曾导致客户端/网页广告回流，必须保持全量模块。
  const mediaNames = ['youtube.enhance.ump', 'youtube.enhance.init', 'youtube.enhance.auto-hd'];
  const mediaOk = mediaNames.every(n => hubLines.some(l => l.startsWith(n)));
  const builtinLine = hubLines.find(l => l.startsWith('localdns_builtin_yt_web')) || '';
  const builtinNoYoutubei = builtinLine.length > 0 && !builtinLine.includes('youtubei[.]googleapis[.]com');
  // 2026-11-07 网页播放回归后：内置脚本必须保持「窄 pattern + 8MB」的已验证可播放基线。
  // 注意命名：8388608 不是「内存封顶」，而是**已验证可播放的基线值**；脚本内的真正处理上限
  // 是 MAX_PROCESS_BYTES(2MiB)，由 tools/test-yt-playback-smoke.js 的 F 组跨文件断言守护。
  const builtinBaselineMaxSize = builtinLine.includes('max-size=8388608') &&
    !builtinLine.includes('max-size=1048576');
  const builtinEndpointsBaseline =
    ['player', 'next', 'reel/reel_watch_sequence'].every(k => builtinLine.includes(k)) &&
    !['browse', 'search', 'guide', 'get_watch'].some(k => builtinLine.includes(k));
  // 单一真相：内置行必须由 src/youtube-rules.ts 渲染，不允许再出现手写 URL 版本号。
  const rulesTsText = FileManager.readAsStringSync(
    Path.join(Script.directory, 'src', 'youtube-rules.ts')
  );
  const serviceTsText = FileManager.readAsStringSync(
    Path.join(Script.directory, 'src', 'surge-service.ts')
  );
  const singleSourceOfTruth =
    serviceTsText.includes("from './youtube-rules'") &&
    serviceTsText.includes('renderBuiltinWebRule(') &&
    !/youtube-web\.js\?v=/.test(serviceTsText) &&
    rulesTsText.includes('YT_BUILTIN_WEB_MAX_PROCESS_BYTES');
  // 不可变脚本：内置行必须指向内容哈希文件名（youtube-web.<12hex>.js），否则旧模块无法回滚。
  const builtinImmutableUrl = /youtube-web\.[0-9a-f]{12}\.js/.test(builtinLine);
  const builtinNoStableQuery = !/youtube-web\.js\?v=/.test(builtinLine);
  // 精确判定「不碰整页 HTML」：pattern 锚定 /youtubei/v1/ 接口，且无 HTML 通道指纹。
  // 不能用裸 includes('watch')——get_watch / reel_watch_sequence 含 watch 子串会误报。
  const builtinNoHtml = builtinLine.includes('/youtubei/v1/') &&
    !builtinLine.includes('yt_html') && !builtinLine.includes('ytInitialPlayerResponse') &&
    !builtinLine.includes('/watch?') && !builtinLine.includes('text/html');
  const responseLine = hubLines.find(l => l.startsWith('youtube.enhance.response')) || '';
  const responseFull = ['player', 'next', 'get_watch'].every(k => responseLine.includes(k));
  const mitmGooglevideo = hub.includes('*.googlevideo.com');
  // 2026-11-10 双面分流：网页与客户端是两套策略，不得混用。
  // 网页面删广告位 = 判禁播（#adhub-off A/B 坐实），只能 playback-first；
  // 客户端（youtubei.googleapis.com）才删广告字段。
  const builtinJsText = FileManager.readAsStringSync(
    Path.join(Script.directory, 'web', 'scripts', 'youtube-web.js')
  );
  const surfaceSplit =
    builtinLine.includes('webMode') &&
    builtinJsText.includes('function surfaceOf(') &&
    builtinJsText.includes('function modeFor(') &&
    builtinJsText.includes('function webSignedIn(') &&
    builtinJsText.includes("'playback-first'") &&
    builtinJsText.includes('pruneEnf(data, 0)') &&
    builtinJsText.includes('pruneAds(data, 0)');
  const surfaceSplitLog = builtinLine.includes('webMode') && builtinLine.includes('auto');
  console.log(`  ${mediaOk ? '✅' : '❌'} ump/init/auto-hd 媒体脚本全部存在`);
  console.log(`  ${builtinBaselineMaxSize ? '✅' : '❌'} 内置脚本保持 max-size=8MB 基线（未漂移）`);
  console.log(`  ${builtinEndpointsBaseline ? '✅' : '❌'} 内置脚本只覆盖 player/next/reel（可播放基线）`);
  console.log(`  ${singleSourceOfTruth ? '✅' : '❌'} 规则来自单一真相 src/youtube-rules.ts（无手写版本号）`);
  console.log(`  ${builtinImmutableUrl ? '✅' : '❌'} 内置脚本使用内容哈希不可变 URL（旧模块可回滚）`);
  console.log(`  ${builtinNoStableQuery ? '✅' : '❌'} 内置脚本不再使用 ?v= 稳定名（no-store 会污染旧模块）`);
  console.log(`  ${builtinNoHtml ? '✅' : '❌'} 内置脚本不碰 /watch 整页 HTML（防引擎被杀）`);
  console.log(`  ${builtinNoYoutubei ? '✅' : '❌'} 内置脚本不再匹配 youtubei（不遮蔽原版 response.js）`);
  console.log(`  ${responseFull ? '✅' : '❌'} response.js 覆盖 player/next/get_watch 全端点`);
  console.log(`  ${mitmGooglevideo ? '✅' : '❌'} *.googlevideo.com 在 MITM 列表`);
  console.log(`  ${surfaceSplit ? '✅' : '❌'} 双面分流：web 按登录态 auto（匿名去广 / 登录播放优先）+ client 去广`);
  console.log(`  ${surfaceSplitLog ? '✅' : '❌'} 网页条目显式声明 webMode=auto（不靠默认值）`);

  console.log('\n========== 4) 七层层：MITM 解密域名覆盖 ==========');
  const mitmNeeded = ['*.googlevideo.com', 'youtubei.googleapis.com', 'www.youtube.com', 's.youtube.com'];
  for (const h of mitmNeeded) {
    const present = hub.includes(h);
    console.log(`  ${present ? '✅' : '❌'} ${h}`);
  }

  console.log('\n========== 5) 七层层：URL Rewrite 广告拦截规则 ==========');
  const rwNeeded = [
    'www\\.youtube\\.com\\/(pagead|pcs)\\/',
    's\\.youtube\\.com\\/api\\/stats\\/ads',
  ];
  for (const r of rwNeeded) {
    const present = hub.includes(r);
    console.log(`  ${present ? '✅' : '❌'} ${r}`);
  }

  console.log('\n========== 6) 生成的 Surge 完整配置：QUIC 与 block.list ==========');
  const conf = await service.generateSurgeConfig({ host: '127.0.0.1:9099' });
  const hasBlockQuic = conf.includes('block-quic = true');
  const hasUdpReject = conf.includes('AND,((PROTOCOL,UDP),(DEST-PORT,443)),REJECT-NO-DROP');
  const hasBlockList = conf.includes('/rules/block.list,REJECT');
  const hasDoh = conf.includes('doh-server = https://127.0.0.1:9443/dns-query');
  console.log(`  ${hasBlockQuic ? '✅' : '❌'} block-quic = true`);
  console.log(`  ${hasUdpReject ? '✅' : '❌'} UDP 443 REJECT-NO-DROP`);
  console.log(`  ${hasBlockList ? '✅' : '❌'} RULE-SET block.list,REJECT`);
  console.log(`  ${hasDoh ? '✅' : '❌'} doh-server 接管`);

  // ===== 读取播放 smoke 结果（由 tools/test-yt-playback-smoke.js 落盘）=====
  // 两套测试共享同一份证据，避免「单元测试全绿 / 实际不能播」这类矛盾结论。
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
  console.log('  ⚠️  真实流量中去广告效果：**未验证**（需带登录态采样，见 README）');

  // ===== 分项 verdict：不再用单一 allOk 掩盖「配置对但效果未证明」 =====
  const configurationOk =
    blockedOk >= 11 && // s.youtube.com 等播放生命线故意放行，不能要求 16/16
    coreOk === YT_CORE_DOMAINS.length &&
    respAllOk &&
    orderOk &&
    mediaOk &&
    builtinNoYoutubei &&
    surfaceSplit &&
    surfaceSplitLog &&
    responseFull &&
    mitmGooglevideo &&
    builtinBaselineMaxSize &&
    builtinEndpointsBaseline &&
    builtinNoHtml &&
    singleSourceOfTruth &&
    builtinImmutableUrl &&
    builtinNoStableQuery &&
    hasBlockQuic &&
    hasUdpReject &&
    hasBlockList;

  const scriptUnitOk = smokeAvailable && playbackSmokeOk;
  const memorySafe =
    !!builtinLine &&
    !builtinLine.includes('localdns_builtin_yt_html') &&
    !/max-size=([0-9]{8,})/.test(builtinLine);

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
      orderOk,
      builtinNoYoutubei,
      surfaceSplit,
      surfaceSplitLog,
      responseFull,
      mitmGooglevideo,
      builtinBaselineMaxSize,
      builtinEndpointsBaseline,
      builtinNoHtml,
      singleSourceOfTruth,
      builtinImmutableUrl,
      builtinNoStableQuery,
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
