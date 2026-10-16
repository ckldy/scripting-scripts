import { parseDnsPacket, serializeDnsPacket, createBlockedResponse, createEmptyResponse } from './dns-packet';
import { Store } from './store';
import { CacheManager } from './cache';
import { DiversionEngine } from './diversion';
import { AuditManager } from './audit';
import type { DnsPacket, UpstreamNode, UpstreamGroup } from './types';

function generateTraceId(): string {
  const chars = 'abcdef0123456789';
  let id = '';
  for (let i = 0; i < 16; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

// Convert public plain DNS IPs to reliable DoH endpoints if needed
const PUBLIC_DOH_MAP: Record<string, string> = {
  '223.5.5.5': 'https://dns.alidns.com/dns-query',
  '223.6.6.6': 'https://dns.alidns.com/dns-query',
  '119.29.29.29': 'https://doh.pub/dns-query',
  '1.1.1.1': 'https://1.1.1.1/dns-query',
  '1.0.0.1': 'https://1.0.0.1/dns-query',
  '8.8.8.8': 'https://dns.google/dns-query',
  '8.8.4.4': 'https://dns.google/dns-query',
  '9.9.9.9': 'https://dns.quad9.net/dns-query',
};

export function cleanDomain(raw: string): string {
  let d = String(raw || '').trim().toLowerCase();
  // Strip protocol if user pasted http:// or https://
  d = d.replace(/^[a-zA-Z]+:\/\//, '');
  // Strip path or query
  d = d.split('/')[0].split('?')[0];
  // Strip port (e.g. video.twimg.com:443 -> video.twimg.com)
  d = d.replace(/:\d+$/, '');
  // Strip trailing root dot
  return d.replace(/\.$/, '');
}

export class DnsResolver {
  private static instance: DnsResolver;
  private inFlightQueries = new Map<string, Promise<Uint8Array>>();

  private constructor() {}

  static get(): DnsResolver {
    if (!DnsResolver.instance) {
      DnsResolver.instance = new DnsResolver();
    }
    return DnsResolver.instance;
  }

  async resolve(queryBytes: Uint8Array, clientIp = '127.0.0.1'): Promise<Uint8Array> {
    let query: DnsPacket;
    try {
      query = parseDnsPacket(queryBytes);
    } catch {
      return serializeDnsPacket(createEmptyResponse({ id: 0, flags: 0, qr: false, opcode: 0, aa: false, tc: false, rd: true, ra: false, rcode: 1, rcodeName: 'FORMERR', questions: [], answers: [], authorities: [], additionals: [] }, 1, 'FORMERR'));
    }

    const q = query.questions[0] || { name: '', type: 1, typeName: 'A', class: 1 };
    const domain = cleanDomain(q.name);
    // Ensure normalized pure domain name in question to avoid TLD :port errors
    if (query.questions[0]) {
      query.questions[0].name = domain;
    }
    const qtype = q.type;
    const cacheKey = `${domain}:${qtype}`;

    // SingleFlight: If the same domain and type is already querying upstream, coalesce!
    if (this.inFlightQueries.has(cacheKey)) {
      try {
        const inFlight = await this.inFlightQueries.get(cacheKey)!;
        // Clone packet with caller's query ID
        const clonedPacket = parseDnsPacket(inFlight);
        clonedPacket.id = query.id;
        return serializeDnsPacket(clonedPacket);
      } catch {
        // In-flight failed, proceed with own resolution
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

  private async doResolve(
    query: DnsPacket,
    queryBytes: Uint8Array,
    domain: string,
    qtype: number,
    clientIp: string
  ): Promise<Uint8Array> {
    const startTime = Date.now();
    const traceId = generateTraceId();
    const q = query.questions[0] || { name: '', type: 1, typeName: 'A', class: 1 };
    const store = Store.get();
    const switches = store.getSwitches();

    // 1. Check switch6: IPv6 屏蔽 (AAAA)
    if (switches.switch6 === 'A' && qtype === 28) {
      const resp = createEmptyResponse(query, 0, 'NOERROR');
      const bytes = serializeDnsPacket(resp);
      AuditManager.get().recordQuery({
        id: traceId,
        time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
        timestamp: Math.floor(Date.now() / 1000),
        client: clientIp,
        domain,
        query_type: 'AAAA',
        domain_set: 'ipv6_blocked',
        response_code: 'NOERROR',
        duration_ms: Date.now() - startTime,
        answers: [],
        trace_id: traceId,
      });
      return bytes;
    }

    // 2. Check switch5: 类型屏蔽 (SOA: 6, PTR: 12, HTTPS: 65)
    if (switches.switch5 === 'A' && (qtype === 6 || qtype === 12 || qtype === 65)) {
      const resp = createEmptyResponse(query, 0, 'NOERROR');
      const bytes = serializeDnsPacket(resp);
      AuditManager.get().recordQuery({
        id: traceId,
        time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
        timestamp: Math.floor(Date.now() / 1000),
        client: clientIp,
        domain,
        query_type: q.typeName,
        domain_set: 'type_blocked',
        response_code: 'NOERROR',
        duration_ms: Date.now() - startTime,
        answers: [],
        trace_id: traceId,
      });
      return bytes;
    }

    // 3. Diversion & Rule Matching
    const diversion = DiversionEngine.get().match(domain, clientIp);

    // 3.1 Rewrite
    if (diversion.group === 'rewrite' && diversion.rewriteIp) {
      const resp = createBlockedResponse(query, domain, qtype);
      if (resp.answers[0]) resp.answers[0].data = diversion.rewriteIp;
      const bytes = serializeDnsPacket(resp);
      AuditManager.get().recordQuery({
        id: traceId,
        time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
        timestamp: Math.floor(Date.now() / 1000),
        client: clientIp,
        domain,
        query_type: q.typeName,
        domain_set: 'rewrite',
        response_code: 'NOERROR',
        duration_ms: Date.now() - startTime,
        answers: [diversion.rewriteIp],
        trace_id: traceId,
      });
      return bytes;
    }

    // 3.2 Blocked (Blocklist or AdGuard)
    if (diversion.group === 'blocked') {
      const resp = createBlockedResponse(query, domain, qtype);
      const bytes = serializeDnsPacket(resp);
      const answerStr = qtype === 28 ? '::' : '0.0.0.0';
      AuditManager.get().recordQuery({
        id: traceId,
        time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
        timestamp: Math.floor(Date.now() / 1000),
        client: clientIp,
        domain,
        query_type: q.typeName,
        domain_set: diversion.domainSet,
        response_code: 'NOERROR',
        duration_ms: Date.now() - startTime,
        answers: [answerStr],
        trace_id: traceId,
      });
      return bytes;
    }

    // 4. Cache Lookup (if switch13 核心缓存 is 'A')
    const cacheManager = CacheManager.get();
    if (switches.switch13 === 'A') {
      const allowExpired = switches.switch4 === 'A';
      const cached = cacheManager.mainCache.get(domain, qtype, allowExpired);
      if (cached) {
        // Set query ID in cached packet
        const respPacket: DnsPacket = {
          ...cached.packet,
          id: query.id,
        };
        const bytes = serializeDnsPacket(respPacket);
        AuditManager.get().recordQuery({
          id: traceId,
          time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
          timestamp: Math.floor(Date.now() / 1000),
          client: clientIp,
          domain,
          query_type: q.typeName,
          domain_set: diversion.domainSet,
          response_code: respPacket.rcodeName,
          duration_ms: Date.now() - startTime,
          answers: respPacket.answers.map(a => String(a.data)),
          trace_id: traceId,
          upstream_tag: cached.isLazy ? 'cache_lazy' : 'cache_hit',
        });
        return bytes;
      }
    }

    // 5. Query Upstream Group
    const targetGroup: UpstreamGroup = (diversion.group as UpstreamGroup) || 'domestic';
    const upstreamConfig = store.getUpstreamConfig();
    const groupNodes = (upstreamConfig[targetGroup] || []).filter(n => n.enabled !== false);

    if (groupNodes.length === 0) {
      // Fallback to domestic if empty
      const fallbackNodes = (upstreamConfig.domestic || []).filter(n => n.enabled !== false);
      if (fallbackNodes.length > 0) {
        return this.queryUpstreamNodes(fallbackNodes, 'domestic', query, queryBytes, domain, qtype, diversion.domainSet, traceId, clientIp, startTime);
      }
      // No upstreams configured, return SERVFAIL
      const resp = createEmptyResponse(query, 2, 'SERVFAIL');
      return serializeDnsPacket(resp);
    }

    return this.queryUpstreamNodes(groupNodes, targetGroup, query, queryBytes, domain, qtype, diversion.domainSet, traceId, clientIp, startTime);
  }

  private async queryUpstreamNodes(
    nodes: UpstreamNode[],
    group: UpstreamGroup,
    query: DnsPacket,
    queryBytes: Uint8Array,
    domain: string,
    qtype: number,
    domainSet: string,
    traceId: string,
    clientIp: string,
    startTime: number
  ): Promise<Uint8Array> {
    const candidatePromises: Array<Promise<{ node: UpstreamNode; rawBytes: Uint8Array; actualGroup: string }>> = [];

    // 1. Launch target group nodes
    nodes.forEach(node => {
      candidatePromises.push(this.querySingleNode(node, group, queryBytes, node.timeout || 2500));
    });

    // 2. Happy Eyeballs: For non-domestic groups, if target nodes don't return within 350ms,
    // automatically parallel-launch domestic backup nodes (AliDNS / DNSPod) into the same race!
    if (group !== 'domestic') {
      const domesticNodes = (Store.get().getUpstreamConfig().domestic || []).filter(n => n.enabled !== false);
      if (domesticNodes.length > 0) {
        const domesticRacePromise = new Promise<{ node: UpstreamNode; rawBytes: Uint8Array; actualGroup: string }>((resolve, reject) => {
          setTimeout(() => {
            const domPromises = domesticNodes.map(n => this.querySingleNode(n, 'domestic', queryBytes, 2000));
            Promise.any(domPromises).then(resolve).catch(reject);
          }, 350);
        });
        candidatePromises.push(domesticRacePromise);
      }
    }

    try {
      // Race or fastest winner across primary group + parallel domestic fallback
      const winner = await Promise.any(candidatePromises);
      const latency = Date.now() - startTime;

      // Parse response
      let respPacket = parseDnsPacket(winner.rawBytes);
      respPacket.id = query.id; // Align ID with query

      // Record upstream winner metrics using node's actual group
      AuditManager.get().recordUpstreamResult(winner.actualGroup, winner.node.tag, latency, true, true);

      // Check switch1: 请求屏蔽 (对无解析结果屏蔽)
      const switches = Store.get().getSwitches();
      if (switches.switch1 === 'A' && respPacket.answers.length === 0 && respPacket.rcode === 0) {
        respPacket = createEmptyResponse(query, 3, 'NXDOMAIN');
      }

      const finalBytes = serializeDnsPacket(respPacket);

      // Save to cache
      if (switches.switch13 === 'A') {
        CacheManager.get().mainCache.set(domain, qtype, respPacket, finalBytes);
        const groupPool = CacheManager.get().getPool(`cache_${group}`);
        if (groupPool) groupPool.set(domain, qtype, respPacket, finalBytes);
      }

      // Record audit log
      AuditManager.get().recordQuery({
        id: traceId,
        time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
        timestamp: Math.floor(Date.now() / 1000),
        client: clientIp,
        domain,
        query_type: query.questions[0]?.typeName || 'A',
        domain_set: domainSet,
        response_code: respPacket.rcodeName,
        duration_ms: latency,
        answers: respPacket.answers.map(a => String(a.data)),
        upstream_tag: winner.node.tag,
        trace_id: traceId,
      });

      return finalBytes;
    } catch (err: any) {
      // All candidate nodes failed
      const latency = Date.now() - startTime;
      nodes.forEach(n => AuditManager.get().recordUpstreamResult(group, n.tag, latency, false, false, err.message || 'All nodes failed'));

      const resp = createEmptyResponse(query, 2, 'SERVFAIL');
      const finalBytes = serializeDnsPacket(resp);

      AuditManager.get().recordQuery({
        id: traceId,
        time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
        timestamp: Math.floor(Date.now() / 1000),
        client: clientIp,
        domain,
        query_type: query.questions[0]?.typeName || 'A',
        domain_set: domainSet,
        response_code: 'SERVFAIL',
        duration_ms: latency,
        answers: [],
        trace_id: traceId,
      });

      return finalBytes;
    }
  }

  private async querySingleNode(
    node: UpstreamNode,
    group: string,
    queryBytes: Uint8Array,
    timeoutMs: number
  ): Promise<{ node: UpstreamNode; rawBytes: Uint8Array; actualGroup: string }> {
    const nodeStart = Date.now();
    let url = node.addr;

    // Check if plain IP address can be converted to DoH
    const hostPart = url.replace(/:\d+$/, '');
    if (PUBLIC_DOH_MAP[hostPart]) {
      url = PUBLIC_DOH_MAP[hostPart];
    } else if (!url.startsWith('http://') && !url.startsWith('https://')) {
      // If it is another standard IP, default to HTTPS query if supported or DoH format
      url = `https://${url}/dns-query`;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      // If foreign_ecs group and ecs configured, attach ECS query param or header
      let targetUrl = url;
      const ecsSubnet = Store.get().getUpstreamEcs();
      if (group === 'foreign_ecs' && ecsSubnet) {
        const u = new URL(targetUrl);
        u.searchParams.set('edns_client_subnet', ecsSubnet);
        targetUrl = u.toString();
      }

      const resp = await fetch(targetUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/dns-message',
          'Accept': 'application/dns-message',
        },
        body: queryBytes,
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
      }

      const arrayBuf = await resp.arrayBuffer();
      const rawBytes = new Uint8Array(arrayBuf);
      const duration = Date.now() - nodeStart;

      AuditManager.get().recordUpstreamResult(group, node.tag, duration, true, false);
      return { node, rawBytes, actualGroup: group };
    } catch (e: any) {
      clearTimeout(timer);
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
      id: Math.floor(Math.random() * 65535),
      flags: 0x0100, // RD set
      qr: false,
      opcode: 0,
      aa: false,
      tc: false,
      rd: true,
      ra: false,
      rcode: 0,
      rcodeName: 'NOERROR',
      questions: [{ name: pureDomain, type: qtype, typeName: qtype === 28 ? 'AAAA' : 'A', class: 1 }],
      answers: [],
      authorities: [],
      additionals: [],
    };

    const queryBytes = serializeDnsPacket(dummyPacket);
    const respBytes = await this.resolve(queryBytes, clientIp);
    const respPacket = parseDnsPacket(respBytes);

    const addresses = respPacket.answers.map(a => String(a.data)).filter(Boolean);
    const minTtl = respPacket.answers.length > 0 ? Math.min(...respPacket.answers.map(a => a.ttl || 300)) : 300;
    const isBlocked = addresses.includes('0.0.0.0') || addresses.includes('::');
    const diversion = DiversionEngine.get().match(domain, clientIp);

    return {
      addresses,
      ttl: minTtl,
      rcode: respPacket.rcodeName,
      blocked: isBlocked,
      domainSet: diversion.domainSet,
    };
  }
}
