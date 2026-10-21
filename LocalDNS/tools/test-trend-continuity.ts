import { Script } from 'scripting';
import { LocalDnsServer } from '../src/server';
import { DnsResolver } from '../src/resolver';
import { serializeDnsPacket } from '../src/dns-packet';
import type { DnsPacket } from '../src/types';

// 复刻上游 SPA trafficService（parse / record）的核心逻辑，验证趋势采样点连续、无缺口。

let passed = 0, failed = 0;
function assert(c: boolean, d: string) { if (c) { console.log('  ✅ PASS: ' + d); passed++; } else { console.error('  ❌ FAIL: ' + d); failed++; } }

function sleep(ms: number) { return new Promise<void>(r => setTimeout(r, ms)); }
function makeDnsQuery(qname: string): Uint8Array {
  const pkt: DnsPacket = {
    id: Math.floor(Math.random() * 65535), flags: 0x0100, qr: false, opcode: 0, aa: false, tc: false,
    rd: true, ra: false, rcode: 0, rcodeName: 'NOERROR',
    questions: [{ name: qname, type: 1, typeName: 'A', class: 1 }],
    answers: [], authorities: [], additionals: [],
  };
  return serializeDnsPacket(pkt);
}

interface PromSample { name: string; labels: Record<string, string>; value: number }
function parseProm(text: string): PromSample[] {
  const out: PromSample[] = [];
  for (const line of text.split('\n')) {
    if (!line || line.charAt(0) === '#') continue;
    const m = line.match(/^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{([^}]*)\})?\s+([-+0-9.eE]+)\s*$/);
    if (!m) continue;
    const labels: Record<string, string> = {};
    (m[3] || '').replace(/([a-zA-Z_][a-zA-Z0-9_]*)="([^"]*)"/g, (_s, k, v) => { labels[k] = v; return ''; });
    out.push({ name: m[1], labels, value: parseFloat(m[4]) });
  }
  return out;
}
const nonneg = (n: any) => typeof n === 'number' && Number.isFinite(n) && n >= 0;

function parseMetrics(text: string) {
  const metrics = parseProm(text);
  const get = (name: string, tag?: string) => {
    const found = metrics.filter(p => p.name === name && (tag === undefined || p.labels.tag === tag));
    return found.length === 1 && nonneg(found[0].value) ? found[0].value : null;
  };
  const upstreams = new Map<string, any>();
  for (const p of metrics) {
    const kind = p.name === 'localdns_upstream_response_latency_millisecond_sum' ? 'sum'
      : p.name === 'localdns_upstream_response_latency_millisecond_count' ? 'count' : null;
    if (!kind) continue;
    const key = JSON.stringify(Object.entries(p.labels).sort(([a], [b]) => a.localeCompare(b)));
    if (!upstreams.has(key)) upstreams.set(key, {});
    const row = upstreams.get(key);
    row[kind] = row[kind] === undefined && nonneg(p.value) ? p.value : null;
  }
  const latency = [...upstreams].sort(([a], [b]) => a.localeCompare(b));
  const valid = latency.length > 0 && latency.every(([, p]) => nonneg(p.sum) && nonneg(p.count));
  return {
    total: get('localdns_queries_total'),
    start: get('process_start_time_seconds'),
    cacheQueries: get('localdns_cache_query_total', 'cache_main'),
    cacheHits: get('localdns_cache_hit_total', 'cache_main'),
    upstreams: valid ? latency.map(([k, p]) => [k, p.sum, p.count] as [string, number, number]) : null,
  };
}

function record(series: any[], sample: any, now = Date.now()): boolean {
  if (!nonneg(sample?.total) || !nonneg(now)) return false;
  const previous = series[series.length - 1];
  if (previous && now - previous.time < 1500) return false;
  const next: any = {
    time: now, total: sample.total, breakBefore: sample.breakBefore === true,
    start: nonneg(sample.start) ? sample.start : null,
    cacheQueries: nonneg(sample.cacheQueries) ? sample.cacheQueries : null,
    cacheHits: nonneg(sample.cacheHits) ? sample.cacheHits : null,
    upstreams: sample.upstreams,
  };
  const elapsed = previous ? (now - previous.time) / 1000 : 0;
  const valid = !!previous && !next.breakBefore && elapsed > 0 && elapsed <= 90 && previous.start === next.start && next.total >= previous.total;
  const diff = (a: any, b: any) => nonneg(a) && nonneg(b) && a >= b ? a - b : null;
  next.elapsed = valid ? elapsed : 0;
  next.delta = valid ? next.total - previous.total : null;
  next.qps = valid ? next.delta / elapsed : null;
  next.cacheQueriesDelta = valid ? diff(next.cacheQueries, previous.cacheQueries) : null;
  next.cacheHitsDelta = valid ? diff(next.cacheHits, previous.cacheHits) : null;
  next.cache = next.cacheQueriesDelta > 0 && next.cacheHitsDelta !== null && next.cacheHitsDelta <= next.cacheQueriesDelta
    ? next.cacheHitsDelta / next.cacheQueriesDelta * 100 : null;
  next.responseCount = next.responseSum = next.latency = null;
  if (valid && next.upstreams && previous.upstreams && next.upstreams.length === previous.upstreams.length) {
    let count = 0, sum = 0, consistent = true;
    next.upstreams.forEach(([key, s, c]: [string, number, number], i: number) => {
      const old = previous.upstreams[i];
      if (key !== old[0] || s < old[1] || c < old[2]) consistent = false;
      else { sum += s - old[1]; count += c - old[2]; }
    });
    if (consistent && count > 0) { next.responseCount = count; next.responseSum = sum; next.latency = sum / count; }
  }
  for (const key of ['qps', 'cache', 'latency']) if (!nonneg(next[key])) next[key] = null;
  series.push(next);
  return true;
}

async function main() {
  console.log('=== [Test] DNS trend sampling continuity ===');
  const server = LocalDnsServer.get();
  const s = server.start(9215);
  const base = 'http://127.0.0.1:' + s.port;
  const resolver = DnsResolver.get();
  const series: any[] = [];
  let breakNext = true;

  const fresh = ['taobao.com', 'jd.com', 'bilibili.com', 'apple.com', 'microsoft.com', 'cloudflare.com'];
  for (let i = 0; i < fresh.length; i++) {
    await resolver.resolve(makeDnsQuery(fresh[i]), '127.0.0.1');
    await resolver.resolve(makeDnsQuery('baidu.com'), '127.0.0.1'); // 命中缓存
    await sleep(2000);
    const txt = await (await fetch(base + '/metrics')).text();
    const sample: any = parseMetrics(txt);
    if (record(series, { ...sample, breakBefore: breakNext })) breakNext = false;
  }

  assert(series.length === fresh.length, 'sampled every interval (got ' + series.length + ')');
  const body = series.slice(1);
  assert(body.length >= 4, 'enough steady-state points (got ' + body.length + ')');
  assert(body.every(p => p.qps !== null && p.qps >= 0), 'QPS continuous (no null gaps)');
  assert(body.every(p => p.cache !== null), 'cache hit-rate continuous (no null gaps)');
  assert(body.every(p => p.responseCount === null || (p.latency !== null && Number.isFinite(p.latency))), 'latency finite whenever upstream responses exist');
  assert(body.filter(p => p.latency !== null).length >= 3, 'most intervals report upstream latency');  assert(body.every(p => p.elapsed >= 1.5 && p.elapsed <= 5), 'sample interval sane');
  assert(body.some(p => p.cache > 0), 'cache hit-rate > 0 (aggregate cache_main works)');

  for (const p of body) {
    console.log(`  · qps=${p.qps === null ? 'null' : p.qps.toFixed(2)} cache=${p.cache === null ? 'null' : p.cache.toFixed(1) + '%'} latency=${p.latency === null ? 'null' : p.latency.toFixed(1) + 'ms'} resp=${p.responseCount} up=${p.upstreams ? p.upstreams.length : 'null'} elapsed=${p.elapsed.toFixed(2)}s`);
  }

  server.stop();
  console.log('\nResult: Total ' + (passed + failed) + ', Passed ' + passed + ', Failed ' + failed);
  Script.exit();
}

main().catch(e => { console.error('FATAL', e); Script.exit(); });
