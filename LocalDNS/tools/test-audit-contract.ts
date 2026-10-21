import { Script } from 'scripting';
import { LocalDnsServer } from '../src/server';
import { DnsResolver } from '../src/resolver';
import { serializeDnsPacket } from '../src/dns-packet';
import type { DnsPacket } from '../src/types';

let passed = 0;
let failed = 0;
function assert(cond: boolean, desc: string) {
  if (cond) { console.log(`  ✅ PASS: ${desc}`); passed++; }
  else { console.error(`  ❌ FAIL: ${desc}`); failed++; }
}

// Replicate the upstream UI contract validator (app.js record()/array()/normalizeResponse)
class ContractError extends Error {}
function record(value: any, name: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ContractError(`${name} 返回格式无效。`);
  return value;
}
function array(value: any, name: string) {
  if (!Array.isArray(value)) throw new ContractError(`${name} 返回格式无效。`);
  return value;
}
function validateLogs(value: any) {
  const data = record(value, '查询日志');
  const logs = data.logs === undefined ? [] : array(data.logs, '查询日志');
  logs.forEach((log: any) => {
    const item = record(log, '查询记录');
    for (const key of ['query_name', 'query_type', 'client_ip', 'response_code']) {
      if (item[key] !== undefined && typeof item[key] !== 'string') throw new ContractError(`查询记录 ${key} 类型无效。`);
    }
    if (item.answers !== undefined) array(item.answers, 'DNS 应答').forEach((a: any) => record(a, 'DNS 应答'));
  });
  const filters = data.filters === undefined ? {} : record(data.filters, '日志筛选');
  for (const key of ['query_types', 'domain_sets', 'response_codes']) {
    if (filters[key] !== undefined && !array(filters[key], '日志筛选').every((i: any) => typeof i === 'string')) throw new ContractError('日志筛选类型无效。');
  }
  const pagination = data.pagination === undefined ? {} : record(data.pagination, '分页');
  for (const key of ['current_page', 'total_pages', 'total_items']) {
    if (pagination[key] !== undefined && (!Number.isFinite(pagination[key]) || Number(pagination[key]) < 0)) throw new ContractError('分页数据无效。');
  }
  return { ...data, logs, filters, pagination };
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
  console.log('=== [Test] Audit Logs v2 Contract (UI compatibility) ===');
  const server = LocalDnsServer.get();
  const startRes = server.start(9211);
  assert(startRes.success, `server started on ${startRes.port}`);
  const baseUrl = `http://127.0.0.1:${startRes.port}`;

  // Populate audit logs via real resolution
  const resolver = DnsResolver.get();
  for (const d of ['baidu.com', 'qq.com', 'mobads.baidu.com']) {
    await resolver.resolve(makeDnsQuery(d), '127.0.0.1');
  }

  // 1. /api/v2/audit/logs strict UI validation
  const res = await fetch(`${baseUrl}/api/v2/audit/logs?page=1&limit=50`);
  assert(res.status === 200, 'GET /api/v2/audit/logs 200');
  const raw = await res.json();
  let v: any = null;
  try { v = validateLogs(raw); assert(true, 'UI contract validator accepts logs payload'); }
  catch (e: any) { assert(false, `UI contract validator threw: ${e.message}`); }

  if (v) {
    assert(Array.isArray(v.logs) && v.logs.length > 0, `logs non-empty (got ${v.logs.length})`);
    const item = v.logs[0];
    assert(typeof item.query_name === 'string', 'query_name present');
    assert(typeof item.client_ip === 'string', 'client_ip present');
    assert(typeof item.query_time === 'string' && !isNaN(Date.parse(item.query_time)), 'query_time is valid date');
    assert(Array.isArray(item.answers), 'answers is array');
    const answered = v.logs.find((l: any) => Array.isArray(l.answers) && l.answers.length > 0);
    assert(!!answered, 'at least one log has answers');
    if (answered) {
      const a = answered.answers[0];
      assert(typeof a === 'object' && !Array.isArray(a) && typeof a.data === 'string', 'answer item is object with string data');
      assert('type' in a && 'ttl' in a, 'answer item has type & ttl');
    }
    assert(Number.isFinite(v.pagination.current_page) && v.pagination.current_page >= 1, 'pagination.current_page valid');
    assert(Number.isFinite(v.pagination.total_pages) && v.pagination.total_pages >= 1, 'pagination.total_pages valid');
    assert(Number.isFinite(v.pagination.total_items), 'pagination.total_items valid');
    assert(Array.isArray(v.filters.query_types) && v.filters.query_types.length > 0, 'filters.query_types populated');
  }

  // 2. audit settings contract
  const resSettings = await fetch(`${baseUrl}/api/v1/audit/settings`);
  const settings = await resSettings.json();
  assert(resSettings.status === 200, 'GET /api/v1/audit/settings 200');
  const settingsOk = typeof settings.dir === 'string' && typeof settings.path === 'string' && settings.path.startsWith('/') &&
    typeof settings.memory_fs === 'boolean' && ['capacity', 'entries', 'memory_bytes', 'disk_bytes'].every(k => typeof settings[k] === 'number' && Number.isFinite(settings[k]) && settings[k] >= 0);
  assert(settingsOk, `audit settings contract valid (entries=${settings.entries})`);
  assert(Number(settings.entries) > 0, `audit settings entries > 0 (got ${settings.entries})`);

  // 3. stats + rank + client_name
  const resStats = await fetch(`${baseUrl}/api/v2/audit/stats`);
  const stats = await resStats.json();
  assert(resStats.status === 200 && Number.isFinite(stats.total_queries) && Number.isFinite(stats.average_duration_ms), 'audit stats contract valid');

  const resRank = await fetch(`${baseUrl}/api/v2/audit/rank/domain?limit=10`);
  const rank = await resRank.json();
  assert(resRank.status === 200 && Array.isArray(rank), 'audit rank returns array');

  const resAlias = await fetch(`${baseUrl}/plugins/client_name`);
  const alias = await resAlias.json();
  assert(resAlias.status === 200 && Object.values(alias).every((x: any) => typeof x === 'string'), 'client_name returns string map');

  // 4. old endpoints still fine
  const resStatus = await fetch(`${baseUrl}/api/v1/audit/status`);
  const st = await resStatus.json();
  assert(resStatus.status === 200 && typeof st.capturing === 'boolean', 'audit/status valid');
  const resCap = await fetch(`${baseUrl}/api/v1/audit/capacity`);
  const cap = await resCap.json();
  assert(resCap.status === 200 && Number.isFinite(cap.capacity), 'audit/capacity valid');

  server.stop();
  console.log(`\nResult: Total ${passed + failed}, Passed ${passed}, Failed ${failed}`);
  Script.exit();
}

main().catch(e => { console.error('FATAL', e); Script.exit(); });
