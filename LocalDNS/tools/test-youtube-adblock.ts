import { Script } from 'scripting';
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
  const scriptLines = hubLines.filter(l => l.startsWith('localdns_hub_sc_') && (l.includes('youtube') || l.includes('googlevideo')));
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

  const allOk =
    blockedOk === YT_AD_DOMAINS.length &&
    coreOk === YT_CORE_DOMAINS.length &&
    respAllOk &&
    hasBlockQuic && hasUdpReject && hasBlockList;

  console.log(`\n===== 总体结论：${allOk ? '✅ YouTube 去广告链路全部就绪' : '⚠️ 存在未就绪项'} =====`);
  Script.exit({ allOk, blockedOk, coreOk, ytScripts: scriptLines.length, respAllOk });
}

main().catch(e => {
  console.error(e);
  Script.exit();
});
