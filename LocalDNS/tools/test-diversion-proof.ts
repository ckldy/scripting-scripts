import { Script } from 'scripting';
import { DiversionEngine } from '../src/diversion';

const domains = [
  'www.youtube.com',
  'rr1---sn-4g5edn6e.googlevideo.com',
  'youtubei.googleapis.com',
  'api.bilibili.com'
];

for (const d of domains) {
  const res = DiversionEngine.get().match(d, '127.0.0.1');
  console.log(`Domain: ${d} -> Group: ${res.group}, DomainSet: ${res.domainSet}, RewriteIP: ${res.rewriteIp}`);
}

Script.exit({ ok: true });
