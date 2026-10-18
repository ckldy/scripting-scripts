import { Script } from 'scripting';
import { AdGuardEngine } from '../src/adguard';
import { DiversionEngine } from '../src/diversion';

const testDomains = [
  's.youtube.com',
  'ads.youtube.com',
  'pagead2.googlesyndication.com',
  'googleads.g.doubleclick.net',
  'adservice.google.com',
  'video-stats.l.google.com',
  'static.doubleclick.net',
  'securepubads.g.doubleclick.net',
  'www.youtube.com',
  'rr1---sn-4g5edn6e.googlevideo.com'
];

for (const d of testDomains) {
  const isAd = AdGuardEngine.get().isBlocked(d);
  const route = DiversionEngine.get().match(d, '127.0.0.1');
  console.log(`${d.padEnd(35)} -> AdGuardBlocked: ${isAd}, RouteGroup: ${route.group}, DomainSet: ${route.domainSet}, IP: ${route.rewriteIp || '上游解析'}`);
}

Script.exit({ ok: true });
