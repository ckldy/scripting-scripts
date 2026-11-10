import { SurgeDatabase } from '../src/surge-db';
import { SurgeService } from '../src/surge-service';
import { Script } from 'scripting';

async function main(): Promise<void> {
  const db = SurgeDatabase.get();
  const status = await db.rebuildCanonicalRules();
  const rules = await db.getCanonicalBlockRules();

  const exact = new Set<string>();
  const suffix: string[] = [];
  const keyword: string[] = [];
  for (const r of rules) {
    if (r.type === 'DOMAIN') exact.add(r.pattern);
    else if (r.type === 'DOMAIN-SUFFIX') suffix.push(r.pattern);
    else if (r.type === 'DOMAIN-KEYWORD') keyword.push(r.pattern);
  }

  const canonicalBlocked = (domain: string): boolean => {
    const d = domain.toLowerCase().replace(/\.$/, '');
    if (exact.has(d)) return true;
    for (const s of suffix) {
      if (d === s || d.endsWith('.' + s)) return true;
    }
    for (const k of keyword) {
      if (k && d.includes(k)) return true;
    }
    return false;
  };

  const golden = [
    'magsrv.com', '11yun.xyz', 'epidermispushupvariable.com', 'pemsrv.com', 'googletagmanager.com',
    'ads.youtube.com', 'pagead2.googlesyndication.com', 'googleads.g.doubleclick.net', 'mobads.baidu.com',
    'adservice.google.com', 's.youtube.com', 's2.youtube.com', 'video-stats.l.google.com',
    'video-stats.youtube.com', 'stats_check.youtube.com', 'www.youtube.com', 'm.youtube.com',
    'youtubei.googleapis.com', 'i.ytimg.com', 'redirector.googlevideo.com', 'www.baidu.com',
    'www.qq.com', 'www.bilibili.com', 'www.taobao.com', 'weibo.com', 'www.google.com',
    'github.com', 'cloudflare.com', 'example.com', 'xn--fiqs8s', 'www.youtube.com.',
    'WWW.YOUTUBE.COM', 'lf-ad-ies.bytecdn.cn', 'extlog.snssdk.com', 'bds.snssdk.com',
    'api.pinduoduo.com', 'acs.m.goofish.com',
  ];

  const service = SurgeService.get();
  await service.reloadDnsBlockCache();
  const mismatches: Array<{ domain: string; canonical: boolean; current: boolean }> = [];
  for (const domain of golden) {
    const canonical = canonicalBlocked(domain);
    const current = service.isDomainBlocked(domain, true).blocked;
    if (canonical !== current) mismatches.push({ domain, canonical, current });
  }

  console.log(JSON.stringify({
    canonical: {
      rules: status.rules,
      enabled_rules: status.enabled_rules,
      block_rules: status.block_rules,
      sources: status.sources,
      bindings: status.bindings,
      current_block_rules: status.current_block_rules,
      consistent: status.consistent,
      duration_ms: status.duration_ms,
    },
    golden: golden.length,
    mismatches,
  }, null, 2));
  Script.exit();
}

main().catch((e) => {
  console.log('FATAL', e instanceof Error ? e.message : String(e));
  Script.exit();
});
