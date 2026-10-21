import { Script } from 'scripting';
import { DnsResolver } from '../src/resolver';
import { Store } from '../src/store';
import { DiversionEngine } from '../src/diversion';
import { AdGuardEngine } from '../src/adguard';

async function main() {
  console.log('=== [Diag] LocalDNS Comprehensive Resolution Diagnostics ===');

  const store = Store.get();
  console.log('Switches:', JSON.stringify(store.getSwitches()));
  console.log('Upstreams:', JSON.stringify(store.getUpstreamConfig(), null, 2));

  // 1. Test domestic upstreams direct fetch
  console.log('\n--- Testing Direct Upstream Fetch ---');
  const upstreams = store.getUpstreamConfig();
  const allNodes = [
    ...(upstreams.domestic || []),
    ...(upstreams.foreign || []),
  ];

  for (const node of allNodes) {
    const start = Date.now();
    try {
      let targetUrl = node.addr;
      if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
        targetUrl = `https://${targetUrl}/dns-query`;
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);
      const resp = await fetch(targetUrl, {
        method: 'GET',
        headers: { 'Accept': 'application/dns-message' },
        signal: controller.signal,
      });
      clearTimeout(timer);
      console.log(`[Upstream ${node.tag}] ${node.addr} -> status: ${resp.status} (${Date.now() - start}ms)`);
    } catch (e: any) {
      console.log(`[Upstream ${node.tag}] ${node.addr} -> FAILED: ${e.message} (${Date.now() - start}ms)`);
    }
  }

  // 2. Test domain resolution via DnsResolver
  const testDomains = [
    'dns.alidns.com', // Bootstrap domain
    'doh.pub',        // Bootstrap domain
    'localdns.local', // Bootstrap local domain
    'baidu.com',
    'qq.com',
    'apple.com',
    'google.com',
    'github.com',
    'mobads.baidu.com', // Ad domain
  ];

  console.log('\n--- Testing DnsResolver.resolveName ---');
  for (const domain of testDomains) {
    try {
      const match = DiversionEngine.get().match(domain, '127.0.0.1');
      console.log(`\nDomain [${domain}] -> matched group: ${match.group}, set: ${match.domainSet}`);
      const res = await DnsResolver.get().resolveName(domain, 1, '127.0.0.1');
      console.log(`Domain [${domain}] result:`, JSON.stringify(res));
    } catch (e: any) {
      console.error(`Domain [${domain}] ERROR:`, e);
    }
  }

  Script.exit();
}

main().catch(err => {
  console.error('Diag script failed:', err);
  Script.exit();
});
