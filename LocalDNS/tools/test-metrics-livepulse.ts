import { Script } from 'scripting';
import { LocalDnsServer } from '../src/server';
import { DnsResolver } from '../src/resolver';
import { serializeDnsPacket } from '../src/dns-packet';
import type { DnsPacket } from '../src/types';

let passed = 0, failed = 0;
function assert(c: boolean, d: string) { if (c) { console.log('  ✅ PASS: ' + d); passed++; } else { console.error('  ❌ FAIL: ' + d); failed++; } }

function parseProm(txt: string) {
  const flat: Record<string, number> = {}, tagged: Record<string, number> = {};
  for (const line of (txt || '').split('\n')) {
    if (!line || line.charAt(0) === '#') continue;
    const m = line.match(/^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{([^}]*)\})?\s+([-+0-9.eE]+)\s*$/);
    if (!m) continue;
    const name = m[1], labels = m[3] || '', val = parseFloat(m[4]);
    if (!isFinite(val)) continue;
    if (!(name in flat)) flat[name] = val;
    const tm = labels.match(/tag="([^"]*)"/);
    if (tm) tagged[name + '|' + tm[1]] = val;
  }
  return { flat, tagged };
}

function makeDnsQuery(qname: string): Uint8Array {
  const pkt: DnsPacket = {
    id: Math.floor(Math.random() * 65535), flags: 0x0100, qr: false, opcode: 0, aa: false, tc: false,
    rd: true, ra: false, rcode: 0, rcodeName: 'NOERROR',
    questions: [{ name: qname, type: 1, typeName: 'A', class: 1 }],
    answers: [], authorities: [], additionals: [],
  };
  return serializeDnsPacket(pkt);
}

async function main() {
  console.log('=== [Test] /metrics KPI gauges for livepulse ===');
  const server = LocalDnsServer.get();
  const startRes = server.start(9212);
  assert(startRes.success, 'server started on ' + startRes.port);
  const baseUrl = 'http://127.0.0.1:' + startRes.port;

  const resolver = DnsResolver.get();
  for (const d of ['baidu.com', 'qq.com', 'apple.com', 'mobads.baidu.com']) {
    await resolver.resolve(makeDnsQuery(d), '127.0.0.1');
  }

  const res = await fetch(baseUrl + '/metrics');
  assert(res.status === 200, 'GET /metrics 200');
  const txt = await res.text();
  const m = parseProm(txt);

  assert(Number.isFinite(m.flat['localdns_queries_total']) && m.flat['localdns_queries_total'] >= 4, 'queries_total >= 4 (got ' + m.flat['localdns_queries_total'] + ')');
  assert(Number.isFinite(m.flat['localdns_clients_total']) && m.flat['localdns_clients_total'] >= 1, 'clients_total present (got ' + m.flat['localdns_clients_total'] + ')');
  assert(Number.isFinite(m.flat['localdns_domains_total']) && m.flat['localdns_domains_total'] >= 4, 'domains_total present (got ' + m.flat['localdns_domains_total'] + ')');
  assert(Number.isFinite(m.flat['localdns_adguard_blocked_total']) && m.flat['localdns_adguard_blocked_total'] >= 1, 'adguard_blocked_total >= 1 (got ' + m.flat['localdns_adguard_blocked_total'] + ')');
  assert(Number.isFinite(m.flat['localdns_blocked_total']), 'blocked_total present');
  assert(Number.isFinite(m.flat['localdns_average_duration_ms']) && m.flat['localdns_average_duration_ms'] >= 0, 'average_duration_ms present (got ' + m.flat['localdns_average_duration_ms'] + ')');

  // cache tag parsing (livepulse depends on this)
  const cq = m.tagged['localdns_cache_query_total|cache_main'];
  const ch = m.tagged['localdns_cache_hit_total|cache_main'];
  assert(Number.isFinite(cq), 'tagged cache_main query_total parsed (got ' + cq + ')');
  assert(Number.isFinite(ch), 'tagged cache_main hit_total parsed (got ' + ch + ')');

  // metric lines well-formed (no NaN)
  assert(!/NaN|undefined/.test(txt), 'metrics contain no NaN/undefined');

  server.stop();
  console.log('\nResult: Total ' + (passed + failed) + ', Passed ' + passed + ', Failed ' + failed);
  Script.exit();
}

main().catch(e => { console.error('FATAL', e); Script.exit(); });
