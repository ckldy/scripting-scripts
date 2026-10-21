import { Script } from 'scripting';
import { Store } from '../src/store';
import { parseDnsPacket, serializeDnsPacket } from '../src/dns-packet';

async function main() {
  console.log('=== Testing Upstream DNS Servers with REAL POST dns-message ===');
  
  const dummyPacket = {
    id: 1234,
    flags: 0x0100,
    qr: false,
    opcode: 0,
    aa: false,
    tc: false,
    rd: true,
    ra: false,
    rcode: 0,
    rcodeName: 'NOERROR',
    questions: [{ name: 'baidu.com', type: 1, typeName: 'A', class: 1 }],
    answers: [],
    authorities: [],
    additionals: [],
  };
  const queryBytes = serializeDnsPacket(dummyPacket as any);

  const targets = [
    { tag: 'alidns_doh (domain)', url: 'https://dns.alidns.com/dns-query' },
    { tag: 'alidns_doh (ip)', url: 'https://223.5.5.5/dns-query' },
    { tag: 'dnspod_doh (domain)', url: 'https://doh.pub/dns-query' },
    { tag: 'dnspod_doh (ip 119.29.29.29)', url: 'https://119.29.29.29/dns-query' },
    { tag: 'cloudflare_doh (1.1.1.1)', url: 'https://1.1.1.1/dns-query' },
    { tag: 'google_doh (dns.google)', url: 'https://dns.google/dns-query' },
    { tag: '114dns (http)', url: 'http://114.114.114.114/dns-query' },
  ];

  for (const t of targets) {
    const start = Date.now();
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4000);
      const resp = await fetch(t.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/dns-message',
          'Accept': 'application/dns-message',
        },
        body: queryBytes,
        signal: controller.signal,
      });
      clearTimeout(timer);
      const latency = Date.now() - start;
      if (!resp.ok) {
        console.log(`❌ [${t.tag}] ${t.url} -> HTTP ${resp.status} ${resp.statusText} (${latency}ms)`);
      } else {
        const buf = await resp.arrayBuffer();
        const rawBytes = new Uint8Array(buf);
        const parsed = parseDnsPacket(rawBytes);
        const ips = parsed.answers.map(a => a.data).join(', ');
        console.log(`✅ [${t.tag}] ${t.url} -> OK (${latency}ms), answers: [${ips}]`);
      }
    } catch (e: any) {
      console.log(`💥 [${t.tag}] ${t.url} -> ERROR: ${e.message} (${Date.now() - start}ms)`);
    }
  }

  Script.exit();
}

main();
