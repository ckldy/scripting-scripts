import { Script } from 'scripting';
import { Store } from '../src/store';
import { DnsResolver } from '../src/resolver';
import { CachePool } from '../src/cache';
import { SpeedChecker } from '../src/speedcheck';
import { IpRulesEngine } from '../src/ip-rules';
import { ClientRulesEngine } from '../src/client-rules';
import { LocalRecordsEngine } from '../src/records';
import { DiversionEngine } from '../src/diversion';
import { synthesizeAAAA } from '../src/dns64';
import { serializeDnsPacket } from '../src/dns-packet';
import type { DnsPacket, DnsRecord } from '../src/types';

function rec(name: string, type: number, data: string): DnsRecord {
  return { name, type, typeName: type === 28 ? 'AAAA' : type === 5 ? 'CNAME' : type === 16 ? 'TXT' : 'A', class: 1, ttl: 300, data };
}

async function main() {
  console.log('=== [LocalDNS] P0/P1/P2 Advanced Feature Tests ===');
  let passed = 0;
  let failed = 0;
  const assert = (cond: boolean, desc: string) => {
    if (cond) { console.log(`  ✅ PASS: ${desc}`); passed++; }
    else { console.error(`  ❌ FAIL: ${desc}`); failed++; }
  };

  const store = Store.get();
  // Save originals for restoration
  const orig = {
    ignore_ip: store.getRule('ignore_ip'),
    blacklist_ip: store.getRule('blacklist_ip'),
    ip_alias: store.getRule('ip_alias'),
    client_rules: store.getRule('client_rules'),
    local_hosts: store.getRule('local_hosts'),
    txt_records: store.getRule('txt_records'),
    cname_records: store.getRule('cname_records'),
    blocklist: store.getRule('blocklist'),
    force_qtype_soa: store.getRule('force_qtype_soa'),
    namedSets: store.getNamedSets(),
    speedConfig: store.getSpeedConfig(),
    dns64Config: store.getDns64Config(),
  };

  try {
    // 1. DNS64 synthesis
    console.log('\n--- Test 1: DNS64 ---');
    const v6 = synthesizeAAAA(['1.2.3.4'], '64:ff9b::/96');
    assert(v6.length === 1 && v6[0] === '64:ff9b:0:0:0:0:102:304', `DNS64 synthesizes AAAA (got: ${v6[0]})`);

    // 2. IP rules
    console.log('\n--- Test 2: IP Rules (ignore/blacklist/ip-alias) ---');
    store.setRule('ignore_ip', '1.2.3.0/24\n');
    store.setRule('blacklist_ip', '9.9.9.9\n');
    store.setRule('ip_alias', '5.6.7.0/24 8.8.8.8\n');
    IpRulesEngine.get().reload();
    const ipRes = IpRulesEngine.get().apply([
      rec('t', 1, '1.2.3.4'),
      rec('t', 1, '5.6.7.9'),
      rec('t', 1, '9.9.9.9'),
      rec('t', 1, '2.2.2.2'),
    ]);
    const ipData = ipRes.records.map(r => String(r.data));
    assert(!ipData.includes('1.2.3.4'), 'ignore_ip removes 1.2.3.4');
    assert(!ipData.includes('5.6.7.9') && ipData.includes('8.8.8.8'), 'ip_alias rewrites 5.6.7.9 -> 8.8.8.8');
    assert(!ipData.includes('9.9.9.9'), 'blacklist_ip removes 9.9.9.9');
    assert(ipData.includes('2.2.2.2'), 'unrelated IP 2.2.2.2 kept');

    // 3. Client rules
    console.log('\n--- Test 3: Client Rules ---');
    store.setRule('client_rules', '192.168.1.0/24 foreign no-cache\n');
    ClientRulesEngine.get().reload();
    const cm = ClientRulesEngine.get().resolve('192.168.1.5');
    assert(cm !== null && cm.group === 'foreign' && cm.noCache === true, 'client rule maps 192.168.1.5 -> foreign + no-cache');
    assert(ClientRulesEngine.get().resolve('10.0.0.1') === null, 'non-matching client returns null');

    // 4. Local records injection
    console.log('\n--- Test 4: Local Records (hosts/TXT/CNAME) ---');
    store.setRule('local_hosts', '127.0.0.1 dev.local\n');
    store.setRule('txt_records', 'info.local hello world\n');
    store.setRule('cname_records', 'www.alias.local target.local\n');
    LocalRecordsEngine.get().reload();
    const h = LocalRecordsEngine.get().lookup('dev.local', 1);
    assert(h !== null && h.kind === 'answer' && String(h.records[0].data) === '127.0.0.1', 'hosts returns 127.0.0.1 for dev.local');
    const t = LocalRecordsEngine.get().lookup('info.local', 16);
    assert(t !== null && t.kind === 'answer' && String(t.records[0].data) === 'hello world', 'TXT record returns text');
    const c = LocalRecordsEngine.get().lookup('www.alias.local', 1);
    assert(c !== null && c.kind === 'cname' && c.cnameTarget === 'target.local', 'CNAME record returns target');

    // 5. Named domain-set expansion in blocklist
    console.log('\n--- Test 5: domain-set expansion ---');
    store.setNamedSets({ domainSets: { adlist: ['doubleclick.net'] } });
    store.setRule('blocklist', '# test\ndomain-set:adlist\n');
    DiversionEngine.get().reloadLocalRules();
    const dm = DiversionEngine.get().match('ads.doubleclick.net', '127.0.0.1');
    assert(dm.group === 'blocked', `domain-set:adlist blocks subdomain (got: ${dm.group}/${dm.domainSet})`);

    // 6. LRU cache eviction
    console.log('\n--- Test 6: Cache LRU ---');
    const pool = new CachePool('test', 2);
    const pkt = (domain: string): DnsPacket => ({
      id: 1, flags: 0x8180, qr: true, opcode: 0, aa: true, tc: false, rd: true, ra: true, rcode: 0, rcodeName: 'NOERROR',
      questions: [{ name: domain, type: 1, typeName: 'A', class: 1 }],
      answers: [rec(domain, 1, '1.1.1.1')], authorities: [], additionals: [],
    });
    pool.set('a.test', 1, pkt('a.test'), serializeDnsPacket(pkt('a.test')), 300);
    pool.set('b.test', 1, pkt('b.test'), serializeDnsPacket(pkt('b.test')), 300);
    pool.set('c.test', 1, pkt('c.test'), serializeDnsPacket(pkt('c.test')), 300);
    assert(pool.getMetrics().size === 2, `LRU keeps size <= 2 (got ${pool.getMetrics().size})`);
    assert(pool.get('a.test', 1) === null, 'oldest entry a.test evicted');
    assert(pool.get('c.test', 1) !== null, 'newest entry c.test present');

    // 7. Speed check (network; tolerate failure but no crash)
    console.log('\n--- Test 7: Speed Check ---');
    const rtt = await SpeedChecker.get().measure('223.5.5.5', 'tcp:443', 1500);
    assert(rtt === null || (typeof rtt === 'number' && rtt >= 0), `speed measure returns rtt or null (got: ${rtt})`);
    const ranked = await SpeedChecker.get().rank(['223.5.5.5', '1.1.1.1'], 'tcp:443', 1500);
    assert(ranked.length === 2, 'speed rank returns one result per IP');

    // 8. Resolver end-to-end (network)
    console.log('\n--- Test 8: Resolver end-to-end ---');
    try {
      const res = await DnsResolver.get().resolveName('baidu.com', 1, '127.0.0.1');
      assert(res.addresses.length > 0 && !res.blocked, `baidu.com resolves to real IPs (got: ${res.addresses.join(',')})`);
    } catch (e: any) {
      console.error('  (network resolve skipped/failed):', e?.message || e);
    }

    // 9. force-qtype-SOA
    console.log('\n--- Test 9: force-qtype-SOA ---');
    store.setRule('force_qtype_soa', '28\n');
    try {
      const res6 = await DnsResolver.get().resolveName('baidu.com', 28, '127.0.0.1');
      assert(res6.addresses.length === 0, `force-qtype-SOA 28 blocks AAAA (got ${res6.addresses.length} addrs)`);
    } catch (e: any) {
      console.error('  (force-qtype test error):', e?.message || e);
    }
  } finally {
    // Restore all originals
    store.setRule('ignore_ip', orig.ignore_ip);
    store.setRule('blacklist_ip', orig.blacklist_ip);
    store.setRule('ip_alias', orig.ip_alias);
    store.setRule('client_rules', orig.client_rules);
    store.setRule('local_hosts', orig.local_hosts);
    store.setRule('txt_records', orig.txt_records);
    store.setRule('cname_records', orig.cname_records);
    store.setRule('blocklist', orig.blocklist);
    store.setRule('force_qtype_soa', orig.force_qtype_soa);
    store.setNamedSets(orig.namedSets);
    store.setSpeedConfig(orig.speedConfig);
    store.setDns64Config(orig.dns64Config);
    try { IpRulesEngine.get().reload(); } catch {}
    try { ClientRulesEngine.get().reload(); } catch {}
    try { LocalRecordsEngine.get().reload(); } catch {}
    try { DiversionEngine.get().reloadLocalRules(); } catch {}
  }

  console.log(`\n========================================`);
  console.log(`Advanced Test Result: Total ${passed + failed}, Passed: ${passed}, Failed: ${failed}`);
  console.log(`========================================`);
  Script.exit({ ok: failed === 0, passed, failed });
}

main().catch(e => {
  console.error('Fatal advanced test exception:', e);
  Script.exit({ ok: false, error: String(e) });
});
