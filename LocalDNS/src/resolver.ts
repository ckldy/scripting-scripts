import {
  parseDnsPacket,
  serializeDnsPacket,
  createBlockedResponse,
  createEmptyResponse,
  createAnswersResponse,
} from './dns-packet';
import { Store } from './store';
import { CacheManager } from './cache';
import { DiversionEngine } from './diversion';
import { AuditManager } from './audit';
import { SpeedChecker } from './speedcheck';
import { queryTcpDns, queryDot } from './upstream-tcp';
import { IpRulesEngine } from './ip-rules';
import { ClientRulesEngine } from './client-rules';
import { LocalRecordsEngine } from './records';
import { synthesizeAAAA } from './dns64';
import type { DnsPacket, DnsRecord, UpstreamNode, UpstreamGroup, SpeedConfig } from './types';

function generateTraceId(): string {
  const chars = 'abcdef0123456789';
  let id = '';
  for (let i = 0; i < 16; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

// Built-in static bootstrap hosts to eliminate circular DNS dependency (Bootstrap Deadlock)
export const BOOTSTRAP_HOSTS: Record<string, { ipv4: string[]; ipv6?: string[] }> = {
  'dns.alidns.com': { ipv4: ['223.5.5.5', '223.6.6.6'], ipv6: ['2400:3200::1', '2400:3200:baba::1'] },
  'doh.pub': { ipv4: ['1.12.12.12', '120.53.53.53'] },
  'dot.pub': { ipv4: ['1.12.12.12', '120.53.53.53'] },
  'dns.google': { ipv4: ['8.8.8.8', '8.8.4.4'], ipv6: ['2001:4860:4860::8888', '2001:4860:4860::8844'] },
  'cloudflare-dns.com': { ipv4: ['1.1.1.1', '1.0.0.1'], ipv6: ['2606:4700:4700::1111', '2606:4700:4700::1001'] },
  'one.one.one.one': { ipv4: ['1.1.1.1', '1.0.0.1'], ipv6: ['2606:4700:4700::1111', '2606:4700:4700::1001'] },
  'dns.quad9.net': { ipv4: ['9.9.9.9', '149.112.112.112'], ipv6: ['2620:fe::fe', '2620:fe::9'] },
  'localdns.local': { ipv4: ['127.0.0.1'], ipv6: ['::1'] },
  'localhost': { ipv4: ['127.0.0.1'], ipv6: ['::1'] },
};

// Convert public plain DNS IPs to reliable native DoH endpoints
const PUBLIC_DOH_MAP: Record<string, string> = {
  '223.5.5.5': 'https://223.5.5.5/dns-query',
  '223.6.6.6': 'https://223.5.5.5/dns-query',
  '119.29.29.29': 'https://doh.pub/dns-query',
  '1.12.12.12': 'https://doh.pub/dns-query',
  '120.53.53.53': 'https://doh.pub/dns-query',
  '1.1.1.1': 'https://1.1.1.1/dns-query',
  '1.0.0.1': 'https://1.1.1.1/dns-query',
  '8.8.8.8': 'https://dns.google/dns-query',
  '8.8.4.4': 'https://dns.google/dns-query',
  '9.9.9.9': 'https://dns.quad9.net/dns-query',
};

export function cleanDomain(raw: string): string {
  let d = String(raw || '').trim().toLowerCase();
  d = d.replace(/^[a-zA-Z]+:\/\//, '');
  d = d.split('/')[0].split('?')[0];
  d = d.replace(/:\d+$/, '');
  return d.replace(/\.$/, '');
}

function parseHostPort(addr: string, defaultPort: number): { host: string; port: number } {
  let s = addr.replace(/^[a-z0-9]+:\/\//i, '');
  s = s.split('/')[0];
  const m = s.match(/^\[([^\]]+)\](?::(\d+))?$/);
  if (m) return { host: m[1], port: m[2] ? Number(m[2]) : defaultPort };
  const idx = s.lastIndexOf(':');
  if (idx > 0 && /^\d+$/.test(s.slice(idx + 1))) {
    return { host: s.slice(0, idx), port: Number(s.slice(idx + 1)) };
  }
  return { host: s, port: defaultPort };
}

export class DnsResolver {
  private static instance: DnsResolver;
  private inFlightQueries = new Map<string, Promise<Uint8Array>>();
  private prefetching = new Set<string>();
  private lastRuleReload = 0;

  private constructor() {}

  static get(): DnsResolver {
    if (!DnsResolver.instance) DnsResolver.instance = new DnsResolver();
    return DnsResolver.instance;
  }

  private ensureRuleEngines(): void {
    const now = Date.now();
    if (now - this.lastRuleReload > 3000) {
      this.lastRuleReload = now;
      try { IpRulesEngine.get().reload(); } catch {}
      try { ClientRulesEngine.get().reload(); } catch {}
      try { LocalRecordsEngine.get().reload(); } catch {}
    }
  }

  async resolve(queryBytes: Uint8Array, clientIp = '127.0.0.1'): Promise<Uint8Array> {
    let query: DnsPacket;
    try {
      query = parseDnsPacket(queryBytes);
    } catch {
      return serializeDnsPacket(
        createEmptyResponse(
          { id: 0, flags: 0, qr: false, opcode: 0, aa: false, tc: false, rd: true, ra: false, rcode: 1, rcodeName: 'FORMERR', questions: [], answers: [], authorities: [], additionals: [] },
          1,
          'FORMERR'
        )
      );
    }

    const q = query.questions[0] || { name: '', type: 1, typeName: 'A', class: 1 };
    const domain = cleanDomain(q.name);
    if (query.questions[0]) query.questions[0].name = domain;
    const qtype = q.type;
    const cacheKey = `${domain}:${qtype}`;

    // SingleFlight: coalesce identical concurrent queries
    if (this.inFlightQueries.has(cacheKey)) {
      try {
        const inFlight = await this.inFlightQueries.get(cacheKey)!;
        const cloned = parseDnsPacket(inFlight);
        cloned.id = query.id;
        return serializeDnsPacket(cloned);
      } catch {
        // fall through to own resolution
      }
    }

    const queryPromise = this.doResolve(query, queryBytes, domain, qtype, clientIp);
    this.inFlightQueries.set(cacheKey, queryPromise);
    try {
      return await queryPromise;
    } finally {
      this.inFlightQueries.delete(cacheKey);
    }
  }

  private logQuery(params: {
    traceId: string; clientIp: string; domain: string; qtypeName: string; domainSet: string;
    rcode: string; duration: number; answers: string[]; upstreamTag?: string;
  }): void {
    AuditManager.get().recordQuery({
      id: params.traceId,
      time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
      timestamp: Math.floor(Date.now() / 1000),
      client: params.clientIp,
      domain: params.domain,
      query_type: params.qtypeName,
      domain_set: params.domainSet,
      response_code: params.rcode,
      duration_ms: params.duration,
      answers: params.answers,
      upstream_tag: params.upstreamTag,
      trace_id: params.traceId,
    });
  }

  private forceQtypeSoaList(): number[] {
    const text = Store.get().getRule('force_qtype_soa');
    const out: number[] = [];
    for (let line of (text || '').split('\n')) {
      line = line.trim();
      if (!line || line.startsWith('#')) continue;
      for (const tok of line.split(/[,\s]+/)) {
        const n = Number(tok);
        if (Number.isFinite(n) && n >= 0 && n <= 65535) out.push(n);
      }
    }
    return out;
  }

  private async doResolve(
    query: DnsPacket,
    queryBytes: Uint8Array,
    domain: string,
    qtype: number,
    clientIp: string,
    forceRefresh = false
  ): Promise<Uint8Array> {
    const startTime = Date.now();
    const traceId = generateTraceId();
    const q = query.questions[0] || { name: '', type: 1, typeName: 'A', class: 1 };
    const qtypeName = q.typeName || 'A';
    const store = Store.get();
    const switches = store.getSwitches();
    const speedCfg = store.getSpeedConfig();
    const cacheCfg = store.getCacheConfig();
    this.ensureRuleEngines();

    const clientMatch = ClientRulesEngine.get().resolve(clientIp);
    const noCache = clientMatch?.noCache === true;

    // 0. force-qtype-SOA (fine-grained qtype blocking)
    if (this.forceQtypeSoaList().includes(qtype)) {
      const resp = createEmptyResponse(query, 0, 'NOERROR');
      this.logQuery({ traceId, clientIp, domain, qtypeName, domainSet: 'force_soa', rcode: 'NOERROR', duration: Date.now() - startTime, answers: [] });
      return serializeDnsPacket(resp);
    }

    // 1. switch6: IPv6 屏蔽 (AAAA)
    if (switches.switch6 === 'A' && qtype === 28) {
      const resp = createEmptyResponse(query, 0, 'NOERROR');
      this.logQuery({ traceId, clientIp, domain, qtypeName, domainSet: 'ipv6_blocked', rcode: 'NOERROR', duration: Date.now() - startTime, answers: [] });
      return serializeDnsPacket(resp);
    }

    // 2. switch5: 类型屏蔽 (SOA 6, PTR 12, HTTPS 65)
    if (switches.switch5 === 'A' && (qtype === 6 || qtype === 12 || qtype === 65)) {
      const resp = createEmptyResponse(query, 0, 'NOERROR');
      this.logQuery({ traceId, clientIp, domain, qtypeName, domainSet: 'type_blocked', rcode: 'NOERROR', duration: Date.now() - startTime, answers: [] });
      return serializeDnsPacket(resp);
    }

    // 3. Diversion & Rule Matching
    const diversion = DiversionEngine.get().match(domain, clientIp);

    // 3.1 Rewrite
    if (diversion.group === 'rewrite' && diversion.rewriteIp) {
      const resp = createBlockedResponse(query, domain, qtype);
      if (resp.answers[0]) resp.answers[0].data = diversion.rewriteIp;
      this.logQuery({ traceId, clientIp, domain, qtypeName, domainSet: diversion.domainSet, rcode: 'NOERROR', duration: Date.now() - startTime, answers: [diversion.rewriteIp] });
      return serializeDnsPacket(resp);
    }

    // 3.2 Blocked (Blocklist or AdGuard)
    if (diversion.group === 'blocked') {
      const resp = createBlockedResponse(query, domain, qtype);
      const answerStr = qtype === 28 ? '::' : '0.0.0.0';
      this.logQuery({ traceId, clientIp, domain, qtypeName, domainSet: diversion.domainSet, rcode: 'NOERROR', duration: Date.now() - startTime, answers: [answerStr] });
      return serializeDnsPacket(resp);
    }

    // 4. Local records injection (hosts / TXT / CNAME)
    const localRec = LocalRecordsEngine.get().lookup(domain, qtype);
    if (localRec && localRec.kind === 'answer') {
      const resp = createEmptyResponse(query, 0, 'NOERROR');
      resp.answers = localRec.records;
      resp.aa = true;
      this.logQuery({ traceId, clientIp, domain, qtypeName, domainSet: 'local_record', rcode: 'NOERROR', duration: Date.now() - startTime, answers: localRec.records.map(r => String(r.data)), upstreamTag: 'local' });
      return serializeDnsPacket(resp);
    }
    if (localRec && localRec.kind === 'cname' && localRec.cnameTarget) {
      // Return CNAME, then resolve the target for A/AAAA
      const resp = createEmptyResponse(query, 0, 'NOERROR');
      resp.answers = [...localRec.records];
      if (qtype === 1 || qtype === 28) {
        try {
          const targetRes = await this.resolveName(localRec.cnameTarget, qtype, clientIp);
          for (const ip of targetRes.addresses) {
            resp.answers.push({ name: localRec.cnameTarget, type: qtype, typeName: qtype === 28 ? 'AAAA' : 'A', class: 1, ttl: 300, data: ip });
          }
        } catch {}
      }
      this.logQuery({ traceId, clientIp, domain, qtypeName, domainSet: 'cname_record', rcode: 'NOERROR', duration: Date.now() - startTime, answers: resp.answers.map(r => String(r.data)), upstreamTag: 'local' });
      return serializeDnsPacket(resp);
    }

    // 5. Bootstrap Hosts (static instant resolution to avoid bootstrap deadlock)
    const bootstrapEntry = BOOTSTRAP_HOSTS[domain];
    if (bootstrapEntry) {
      const isV6 = qtype === 28;
      const ips = isV6 ? (bootstrapEntry.ipv6 || []) : bootstrapEntry.ipv4;
      if (ips.length > 0) {
        const resp = createAnswersResponse(query, domain, qtype, ips, 600);
        this.logQuery({ traceId, clientIp, domain, qtypeName, domainSet: 'bootstrap', rcode: 'NOERROR', duration: Date.now() - startTime, answers: ips, upstreamTag: 'bootstrap_static' });
        return serializeDnsPacket(resp);
      }
    }

    // 6. Determine target group (with per-client override)
    let targetGroup: UpstreamGroup = (diversion.group as UpstreamGroup) || 'domestic';
    if (clientMatch?.group) targetGroup = clientMatch.group;

    const cacheManager = CacheManager.get();
    const groupPoolTag = `cache_${targetGroup}`;

    // 7. Cache lookup (group pool first, then main) — fixes group cache dead feature
    if (switches.switch13 === 'A' && !noCache && !forceRefresh) {
      const allowExpired = switches.switch4 === 'A';
      const cached = cacheManager.lookupWithFallback(groupPoolTag, 'cache_main', domain, qtype, allowExpired, cacheCfg.replyTtl);
      if (cached) {
        const respPacket: DnsPacket = { ...cached.packet, id: query.id };
        // Prefetch if nearing expiry
        if (cacheCfg.prefetch) {
          const meta = cacheManager.peek(groupPoolTag, domain, qtype) || cacheManager.peek('cache_main', domain, qtype);
          if (meta) {
            const remain = meta.expiresAt - Date.now();
            if (remain < Math.min(meta.originalTtl * 1000 * 0.2, 30000)) {
              this.prefetch(domain, qtype, clientIp);
            }
          }
        }
        this.logQuery({ traceId, clientIp, domain, qtypeName, domainSet: diversion.domainSet, rcode: respPacket.rcodeName, duration: Date.now() - startTime, answers: respPacket.answers.map(a => String(a.data)), upstreamTag: cached.isLazy ? 'cache_lazy' : 'cache_hit' });
        return serializeDnsPacket(respPacket);
      }
    }

    // 8. Query upstream group
    const upstreamConfig = store.getUpstreamConfig();
    let groupNodes = (upstreamConfig[targetGroup] || []).filter(n => n.enabled !== false);
    let actualQueryGroup: UpstreamGroup = targetGroup;
    if (groupNodes.length === 0) {
      groupNodes = (upstreamConfig.domestic || []).filter(n => n.enabled !== false);
      actualQueryGroup = 'domestic';
    }
    if (groupNodes.length === 0) {
      this.logQuery({ traceId, clientIp, domain, qtypeName, domainSet: diversion.domainSet, rcode: 'SERVFAIL', duration: Date.now() - startTime, answers: [] });
      return serializeDnsPacket(createEmptyResponse(query, 2, 'SERVFAIL'));
    }

    let respPacket: DnsPacket;
    let winnerTag = '';
    let latency = 0;
    try {
      const result = await this.queryUpstreamNodes(groupNodes, actualQueryGroup, query, queryBytes);
      respPacket = result.packet;
      winnerTag = result.winnerTag;
      latency = result.latency;
    } catch {
      this.logQuery({ traceId, clientIp, domain, qtypeName, domainSet: diversion.domainSet, rcode: 'SERVFAIL', duration: Date.now() - startTime, answers: [] });
      return serializeDnsPacket(createEmptyResponse(query, 2, 'SERVFAIL'));
    }

    respPacket.id = query.id;

    // 9. Post-processing pipeline
    // 9.1 IP rules (ignore / blacklist / ip-alias / bogus-nxdomain)
    const ipResult = IpRulesEngine.get().apply(respPacket.answers);
    respPacket.answers = ipResult.records;

    // 9.2 DNS64 (AAAA NODATA -> synthesize from A)
    const dns64 = store.getDns64Config();
    if (qtype === 28 && dns64.enabled && respPacket.answers.filter(a => a.type === 28).length === 0 && respPacket.rcode === 0) {
      try {
        const aRes = await this.resolveName(domain, 1, clientIp);
        if (aRes.addresses.length) {
          const v6 = synthesizeAAAA(aRes.addresses, dns64.prefix);
          if (v6.length) {
            respPacket.answers = v6.map(ip => ({ name: domain, type: 28, typeName: 'AAAA', class: 1, ttl: Math.max(30, aRes.ttl || 60), data: ip }));
          }
        }
      } catch {}
    }

    // 9.3 Fastest-IP selection
    respPacket = await this.selectFastest(respPacket, qtype, speedCfg);

    // 9.4 Dualstack selection (prefer IPv4 when clearly faster)
    if (qtype === 28 && speedCfg.enabled && speedCfg.dualstackSelection && respPacket.answers.some(a => a.type === 28)) {
      try {
        const aRes = await this.resolveName(domain, 1, clientIp);
        if (aRes.addresses.length) {
          const v6ips = respPacket.answers.filter(a => a.type === 28).map(a => String(a.data));
          const v6rank = await SpeedChecker.get().rank(v6ips, speedCfg.mode, speedCfg.timeoutMs);
          const v4rank = await SpeedChecker.get().rank(aRes.addresses, speedCfg.mode, speedCfg.timeoutMs);
          const best6 = Math.min(...v6rank.map(r => r.rtt));
          const best4 = Math.min(...v4rank.map(r => r.rtt));
          if (best4 !== Number.MAX_SAFE_INTEGER && (best6 === Number.MAX_SAFE_INTEGER || best4 < best6 * 0.75)) {
            respPacket = createEmptyResponse(query, 0, 'NOERROR');
          }
        }
      } catch {}
    }

    // 9.5 switch1: 请求屏蔽 (empty result -> NXDOMAIN)
    if (switches.switch1 === 'A' && respPacket.answers.length === 0 && respPacket.rcode === 0) {
      respPacket = createEmptyResponse(query, 3, 'NXDOMAIN');
    }

    // 9.6 TTL clamp (rr-ttl-min / rr-ttl-max)
    if (cacheCfg.rrTtlMin > 0 || cacheCfg.rrTtlMax > 0) {
      respPacket.answers = respPacket.answers.map(a => {
        let ttl = a.ttl;
        if (cacheCfg.rrTtlMin > 0) ttl = Math.max(ttl, cacheCfg.rrTtlMin);
        if (cacheCfg.rrTtlMax > 0) ttl = Math.min(ttl, cacheCfg.rrTtlMax);
        return { ...a, ttl };
      });
    }

    const finalBytes = serializeDnsPacket(respPacket);

    // 10. Cache write (group pool + main pool)
    if (switches.switch13 === 'A' && !noCache) {
      const isNegative = respPacket.rcode !== 0 || respPacket.answers.length === 0;
      const ttlOverride = isNegative ? cacheCfg.negativeTtl : undefined;
      cacheManager.set(groupPoolTag, domain, qtype, respPacket, finalBytes, ttlOverride);
      cacheManager.set('cache_main', domain, qtype, respPacket, finalBytes, ttlOverride);
    }

    // 11. Audit
    this.logQuery({
      traceId, clientIp, domain, qtypeName, domainSet: diversion.domainSet,
      rcode: respPacket.rcodeName, duration: latency,
      answers: respPacket.answers.map(a => String(a.data)), upstreamTag: winnerTag,
    });

    return finalBytes;
  }

  private prefetch(domain: string, qtype: number, clientIp: string): void {
    const key = `${domain}:${qtype}`;
    if (this.prefetching.has(key)) return;
    this.prefetching.add(key);
    const dummy: DnsPacket = {
      id: Math.floor(Math.random() * 65535), flags: 0x0100, qr: false, opcode: 0, aa: false, tc: false, rd: true, ra: false, rcode: 0, rcodeName: 'NOERROR',
      questions: [{ name: domain, type: qtype, typeName: qtype === 28 ? 'AAAA' : 'A', class: 1 }],
      answers: [], authorities: [], additionals: [],
    };
    const bytes = serializeDnsPacket(dummy);
    this.doResolve(dummy, bytes, domain, qtype, clientIp, true)
      .catch(() => {})
      .finally(() => { this.prefetching.delete(key); });
  }

  private async selectFastest(respPacket: DnsPacket, qtype: number, speedCfg: SpeedConfig): Promise<DnsPacket> {
    if (!speedCfg.enabled || speedCfg.responseMode === 'fastest-response') return respPacket;
    const addrRecs = respPacket.answers.filter(a => a.type === 1 || a.type === 28);
    if (addrRecs.length <= 1) return respPacket;

    const ips = addrRecs.map(a => String(a.data));
    const ranked = await SpeedChecker.get().rank(ips, speedCfg.mode, speedCfg.timeoutMs);
    const rankMap = new Map<string, number>();
    for (const r of ranked) rankMap.set(r.ip, r.rtt);
    AuditManager.get().recordSpeed(ips.length);

    const sortedAddr = [...addrRecs].sort(
      (a, b) => (rankMap.get(String(a.data)) ?? Number.MAX_SAFE_INTEGER) - (rankMap.get(String(b.data)) ?? Number.MAX_SAFE_INTEGER)
    );
    let finalAddr = sortedAddr;
    if (speedCfg.maxReplyIpNum > 0) finalAddr = sortedAddr.slice(0, speedCfg.maxReplyIpNum);

    const others = respPacket.answers.filter(a => a.type !== 1 && a.type !== 28);
    return { ...respPacket, answers: [...others, ...finalAddr] };
  }

  private async queryUpstreamNodes(
    nodes: UpstreamNode[],
    group: UpstreamGroup,
    query: DnsPacket,
    queryBytes: Uint8Array
  ): Promise<{ packet: DnsPacket; winnerTag: string; latency: number; actualGroup: string }> {
    const startTime = Date.now();
    const candidatePromises: Array<Promise<{ node: UpstreamNode; rawBytes: Uint8Array; actualGroup: string }>> = [];

    nodes.forEach(node => {
      candidatePromises.push(this.querySingleNode(node, group, queryBytes, node.timeout || 2500));
    });

    // Happy Eyeballs: for non-domestic groups, launch domestic fallback after 350ms
    if (group !== 'domestic') {
      const domesticNodes = (Store.get().getUpstreamConfig().domestic || []).filter(n => n.enabled !== false);
      if (domesticNodes.length > 0) {
        const domesticRace = new Promise<{ node: UpstreamNode; rawBytes: Uint8Array; actualGroup: string }>((resolve, reject) => {
          setTimeout(() => {
            const domPromises = domesticNodes.map(n => this.querySingleNode(n, 'domestic', queryBytes, 2000));
            Promise.any(domPromises).then(resolve).catch(reject);
          }, 350);
        });
        candidatePromises.push(domesticRace);
      }
    }

    const winner = await Promise.any(candidatePromises);
    const latency = Date.now() - startTime;
    const packet = parseDnsPacket(winner.rawBytes);
    packet.id = query.id;
    AuditManager.get().recordUpstreamWinner(winner.actualGroup, winner.node.tag);
    return { packet, winnerTag: winner.node.tag, latency, actualGroup: winner.actualGroup };
  }

  private resolveProtocol(node: UpstreamNode): 'tls' | 'tcp' | 'doh' {
    const proto = (node.protocol || '').toLowerCase();
    const addr = (node.addr || '').toLowerCase();
    if (proto === 'tls' || addr.startsWith('tls://') || addr.startsWith('dot://')) return 'tls';
    if (proto === 'tcp' || addr.startsWith('tcp://')) return 'tcp';
    // 'udp' is not available in the Scripting runtime; fall back to plain DNS over TCP.
    if (proto === 'udp' || addr.startsWith('udp://')) return 'tcp';
    return 'doh';
  }

  private toDohUrl(addr: string): string {
    if (addr.startsWith('http://') || addr.startsWith('https://')) return addr;
    const hostPart = addr.replace(/^[a-zA-Z]+:\/\//, '').split('/')[0].replace(/:\d+$/, '');
    if (PUBLIC_DOH_MAP[hostPart]) return PUBLIC_DOH_MAP[hostPart];
    return `https://${addr}/dns-query`;
  }

  private async querySingleNode(
    node: UpstreamNode,
    group: string,
    queryBytes: Uint8Array,
    timeoutMs: number
  ): Promise<{ node: UpstreamNode; rawBytes: Uint8Array; actualGroup: string }> {
    const nodeStart = Date.now();
    try {
      const protocol = this.resolveProtocol(node);
      let rawBytes: Uint8Array;

      if (protocol === 'tls') {
        const { host, port } = parseHostPort(node.addr, 853);
        const servername = node.dial || (host.includes(':') || /^\d+\.\d+\.\d+\.\d+$/.test(host) ? undefined : host);
        rawBytes = await queryDot(host, port, queryBytes, timeoutMs, servername);
      } else if (protocol === 'tcp') {
        const { host, port } = parseHostPort(node.addr, 53);
        rawBytes = await queryTcpDns(host, port, queryBytes, timeoutMs);
      } else {
        let targetUrl = this.toDohUrl(node.addr);
        const ecsSubnet = Store.get().getUpstreamEcs();
        if (group === 'foreign_ecs' && ecsSubnet) {
          const u = new URL(targetUrl);
          u.searchParams.set('edns_client_subnet', ecsSubnet);
          targetUrl = u.toString();
        }
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const resp = await fetch(targetUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/dns-message', Accept: 'application/dns-message' },
            body: queryBytes,
            signal: controller.signal,
          });
          if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
          const arrayBuf = await resp.arrayBuffer();
          rawBytes = new Uint8Array(arrayBuf);
        } finally {
          clearTimeout(timer);
        }
      }

      const duration = Date.now() - nodeStart;
      AuditManager.get().recordUpstreamResult(group, node.tag, duration, true, false);
      return { node, rawBytes, actualGroup: group };
    } catch (e: any) {
      const duration = Date.now() - nodeStart;
      AuditManager.get().recordUpstreamResult(group, node.tag, duration, false, false, e.message || String(e));
      throw e;
    }
  }

  async resolveName(
    domain: string,
    qtype = 1,
    clientIp = '127.0.0.1'
  ): Promise<{ addresses: string[]; ttl: number; rcode: string; blocked: boolean; domainSet: string }> {
    const pureDomain = cleanDomain(domain);
    const dummyPacket: DnsPacket = {
      id: Math.floor(Math.random() * 65535), flags: 0x0100, qr: false, opcode: 0, aa: false, tc: false, rd: true, ra: false, rcode: 0, rcodeName: 'NOERROR',
      questions: [{ name: pureDomain, type: qtype, typeName: qtype === 28 ? 'AAAA' : 'A', class: 1 }],
      answers: [], authorities: [], additionals: [],
    };
    const queryBytes = serializeDnsPacket(dummyPacket);
    const respBytes = await this.resolve(queryBytes, clientIp);
    const respPacket = parseDnsPacket(respBytes);
    const addresses = respPacket.answers.map(a => String(a.data)).filter(Boolean);
    const minTtl = respPacket.answers.length > 0 ? Math.min(...respPacket.answers.map(a => a.ttl || 300)) : 300;
    const isBlocked = addresses.includes('0.0.0.0') || addresses.includes('::');
    const diversion = DiversionEngine.get().match(domain, clientIp);
    return { addresses, ttl: minTtl, rcode: respPacket.rcodeName, blocked: isBlocked, domainSet: diversion.domainSet };
  }
}
