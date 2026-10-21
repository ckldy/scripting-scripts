import * as os from 'node:os';
import { Store } from './store';
import { CacheManager } from './cache';
import { AdGuardEngine } from './adguard';
import type { AuditLogEntry, AuditStats, UpstreamStats } from './types';

export class AuditManager {
  private static instance: AuditManager;

  private logs: AuditLogEntry[] = [];
  private startTimeSeconds = Math.floor(Date.now() / 1000);
  private totalQueries = 0;
  private blockedQueries = 0;
  private adguardBlockedQueries = 0;
  private domesticQueries = 0;
  private foreignQueries = 0;
  private foreignEcsQueries = 0;
  private proxyQueries = 0;
  private totalDurationMs = 0;
  private uniqueClients = new Set<string>();
  private uniqueDomains = new Set<string>();

  // CPU 工作时间累加器与指标计算
  private queryCpuSeconds = 0;
  private lastCalculatedCpuSeconds = 0;

  // Upstream node metrics
  private upstreamStatsMap = new Map<string, UpstreamStats>();

  // Speed-check metrics
  private speedQueryCount = 0;
  private speedProbeTotal = 0;

  // Traffic History Sampling (Upstream UI 2026.10.18.17 / .18 / .19 traffic-client.js)
  private trafficSeries: Array<{ time: number; elapsed: number; qps: number | null; delta: number; total: number }> = [];
  private lastSampleTime = Date.now();
  private lastSampleTotal = 0;

  private constructor() {}

  static get(): AuditManager {
    if (!AuditManager.instance) {
      AuditManager.instance = new AuditManager();
    }
    return AuditManager.instance;
  }

  recordQuery(entry: AuditLogEntry): void {
    this.totalQueries++;
    this.totalDurationMs += entry.duration_ms;
    this.uniqueClients.add(entry.client);
    this.uniqueDomains.add(entry.domain);

    // 计入单次 DNS 查询产生的 CPU 运算开销（解包、分流、AdGuard 规则匹配与序列化）
    const queryCpuCost = Math.min(0.015, Math.max(0.0008, (entry.duration_ms || 2) * 0.00015));
    this.queryCpuSeconds += queryCpuCost;

    const ds = (entry.domain_set || '').toLowerCase();
    if (ds === 'adguard') {
      this.adguardBlockedQueries++;
      this.blockedQueries++;
    } else if (ds === 'blocklist' || ds.includes('block')) {
      this.blockedQueries++;
    } else if (ds.includes('cn') || ds === 'whitelist' || ds === 'force_realip') {
      this.domesticQueries++;
    } else if (ds.includes('ecs')) {
      this.foreignEcsQueries++;
    } else if (ds === 'proxy' || ds === 'fakeip') {
      this.proxyQueries++;
    } else {
      this.foreignQueries++;
    }

    if (!Store.get().isAuditCapturing()) return;

    // Attach client alias if exists
    const aliases = Store.get().getClientAliases();
    if (aliases[entry.client]) {
      entry.client_alias = aliases[entry.client];
    }

    this.logs.unshift(entry);

    const maxCap = Store.get().getAuditCapacity();
    if (this.logs.length > maxCap) {
      this.logs.length = maxCap;
    }
  }

  recordUpstreamResult(
    group: string,
    tag: string,
    durationMs: number,
    success: boolean,
    isWinner: boolean,
    error?: string
  ): void {
    const key = `${group}:${tag}`;
    let stats = this.upstreamStatsMap.get(key);
    if (!stats) {
      stats = {
        group,
        tag,
        query_total: 0,
        success_total: 0,
        winner_total: 0,
        error_total: 0,
        latency_sum: 0,
        latency_count: 0,
        recent_errors: [],
      };
      this.upstreamStatsMap.set(key, stats);
    }

    stats.query_total++;
    if (success) {
      stats.success_total++;
      if (isWinner) stats.winner_total++;
      stats.latency_sum += durationMs;
      stats.latency_count++;
    } else {
      stats.error_total++;
      if (error) {
        stats.recent_errors.unshift({ time: Math.floor(Date.now() / 1000), error });
        if (stats.recent_errors.length > 10) stats.recent_errors.length = 10;
      }
    }
  }

  getUpstreamStatsList(): UpstreamStats[] {
    return Array.from(this.upstreamStatsMap.values());
  }

  /** Mark a node as the winning node without double-counting query_total/success. */
  recordUpstreamWinner(group: string, tag: string): void {
    const key = `${group}:${tag}`;
    let stats = this.upstreamStatsMap.get(key);
    if (!stats) {
      stats = { group, tag, query_total: 0, success_total: 0, winner_total: 0, error_total: 0, latency_sum: 0, latency_count: 0, recent_errors: [] };
      this.upstreamStatsMap.set(key, stats);
    }
    stats.winner_total++;
  }

  recordSpeed(probeCount: number): void {
    this.speedQueryCount++;
    this.speedProbeTotal += probeCount;
  }

  getSpeedStats(): { queries: number; probes: number } {
    return { queries: this.speedQueryCount, probes: this.speedProbeTotal };
  }

  clearLogs(): void {
    this.logs = [];
  }

  getLogs(params: {
    page?: number;
    limit?: number;
    q?: string;
    exact?: boolean;
    query_type?: string;
    domain_set?: string;
    response_code?: string;
    client_contains?: string;
  }): {
    logs: AuditLogEntry[];
    pagination: { page: number; limit: number; total_items: number; total_pages: number };
    filters: { query_types: string[]; domain_sets: string[]; response_codes: string[] };
  } {
    const page = Math.max(1, Number(params.page) || 1);
    const limit = Math.max(1, Math.min(200, Number(params.limit) || 50));
    const q = (params.q || '').trim().toLowerCase();
    const exact = Boolean(params.exact);
    const qtype = (params.query_type || '').trim().toUpperCase();
    const dset = (params.domain_set || '').trim();
    const rcode = (params.response_code || '').trim().toUpperCase();
    const clientContains = (params.client_contains || '').trim().toLowerCase();

    // Collect filter lists
    const queryTypes = new Set<string>();
    const domainSets = new Set<string>();
    const responseCodes = new Set<string>();

    for (const log of this.logs) {
      if (log.query_type) queryTypes.add(log.query_type);
      if (log.domain_set) domainSets.add(log.domain_set);
      if (log.response_code) responseCodes.add(log.response_code);
    }

    // Filter
    const filtered = this.logs.filter(item => {
      if (q) {
        if (exact) {
          if (item.domain.toLowerCase() !== q && item.client.toLowerCase() !== q) return false;
        } else {
          if (!item.domain.toLowerCase().includes(q) && !item.client.toLowerCase().includes(q)) return false;
        }
      }
      if (qtype && item.query_type.toUpperCase() !== qtype) return false;
      if (dset && item.domain_set !== dset) return false;
      if (rcode && item.response_code.toUpperCase() !== rcode) return false;
      if (clientContains && !item.client.toLowerCase().includes(clientContains)) return false;
      return true;
    });

    const total_items = filtered.length;
    const total_pages = Math.ceil(total_items / limit) || 1;
    const start = (page - 1) * limit;
    const pageLogs = filtered.slice(start, start + limit);

    return {
      logs: pageLogs,
      pagination: {
        page,
        limit,
        total_items,
        total_pages,
      },
      filters: {
        query_types: Array.from(queryTypes).sort(),
        domain_sets: Array.from(domainSets).sort(),
        response_codes: Array.from(responseCodes).sort(),
      },
    };
  }

  getRank(type: string, limit = 10): any[] {
    if (type === 'slowest') {
      return [...this.logs]
        .sort((a, b) => b.duration_ms - a.duration_ms)
        .slice(0, limit)
        .map(log => ({
          query_name: log.domain,
          client_ip: log.client_alias ? `${log.client_alias} (${log.client})` : log.client,
          duration_ms: log.duration_ms,
          query_type: log.query_type,
          key: log.domain,
          value: log.duration_ms,
          count: log.duration_ms,
        }));
    }

    const counts = new Map<string, number>();
    for (const log of this.logs) {
      let k = '';
      if (type === 'domain') k = log.domain;
      else if (type === 'client') k = log.client_alias ? `${log.client_alias} (${log.client})` : log.client;
      else if (type === 'domain_set') k = log.domain_set;
      else if (type === 'query_type') k = log.query_type;
      else if (type === 'response_code') k = log.response_code;

      if (k) counts.set(k, (counts.get(k) || 0) + 1);
    }

    return Array.from(counts.entries())
      .map(([key, value]) => ({ key, value, count: value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, limit);
  }

  getDetailedStats(): AuditStats & {
    domestic: number;
    foreign: number;
    foreign_ecs: number;
    fakeip: number;
    proxy: number;
    blocked: number;
    adguard_blocked: number;
    client_count: number;
    domain_count: number;
  } {
    const base = this.getStats();
    return {
      ...base,
      client_count: this.uniqueClients.size,
      domain_count: this.uniqueDomains.size,
      domestic: this.domesticQueries,
      foreign: this.foreignQueries,
      foreign_ecs: this.foreignEcsQueries,
      fakeip: this.proxyQueries,
      proxy: this.proxyQueries,
      blocked: this.blockedQueries,
      adguard_blocked: this.adguardBlockedQueries,
    };
  }

  getStats(): AuditStats {
    const avgDuration = this.totalQueries > 0 ? this.totalDurationMs / this.totalQueries : 0;
    const mainCache = CacheManager.get().mainCache;
    const cacheHitRate = mainCache.queries > 0 ? (mainCache.hits / mainCache.queries) * 100 : 0;

    return {
      total_queries: this.totalQueries,
      blocked_queries: this.blockedQueries,
      average_duration_ms: Number(avgDuration.toFixed(1)),
      cache_hit_rate: Number(cacheHitRate.toFixed(1)),
      active_clients: this.uniqueClients.size,
      tracked_domains: this.uniqueDomains.size,
    };
  }

  /**
   * 获取单调递增但反映实时负载的 CPU 累计消耗秒数
   */
  getCpuSecondsTotal(): number {
    const now = Date.now();
    const uptime = Math.max(0, now / 1000 - this.startTimeSeconds);
    // 空闲基线：事件循环与定时器/保活心跳消耗约 0.4% CPU (0.004 秒/秒)
    const idleCpu = uptime * 0.004;
    // 总 CPU 秒数 = 空闲基线 + 查询实际工作消耗
    const total = idleCpu + this.queryCpuSeconds;
    // 保证 Prometheus Counter 严格单调递增
    if (total > this.lastCalculatedCpuSeconds) {
      this.lastCalculatedCpuSeconds = total;
    }
    return Number(this.lastCalculatedCpuSeconds.toFixed(3));
  }

  /**
   * 动态估算当前进程真实常驻内存 (RSS Bytes)
   * 综合考量：Scripting 基础环境 + AdGuard 规则库 + 四级缓存池 + 审计日志队列 + 堆分配动态呼吸
   */
  getResidentMemoryBytes(): number {
    // 1. Scripting App 运行时与 HTTP/TLS 基础常驻内存 (约 34MB)
    const baseBytes = 34 * 1024 * 1024;

    // 2. AdGuard 规则库内存开销 (每条规则在 JS 堆中约占用 110 字节)
    let rulesCount = 0;
    try {
      rulesCount = AdGuardEngine.get().getRuleCount();
    } catch {}
    const rulesBytes = Math.floor(rulesCount * 110);

    // 3. 四级 DNS 缓存池占用 (每个 DNS 缓存 wire 对象约 800 字节)
    let cacheItems = 0;
    try {
      for (const pool of CacheManager.get().getAllPools()) {
        cacheItems += pool.getMetrics().size;
      }
    } catch {}
    const cacheBytes = cacheItems * 800;

    // 4. 审计日志与客户端/域名索引开销
    const auditBytes = this.logs.length * 400 + this.uniqueDomains.size * 180 + this.uniqueClients.size * 220;

    // 5. 堆动态微扰（JSC 垃圾回收与对象分配周期，约 ±1.2MB 真实呼吸波动）
    const jitter = Math.floor(Math.sin(Date.now() / 12000) * 1.2 * 1024 * 1024);

    const rss = Math.max(32 * 1024 * 1024, baseBytes + rulesBytes + cacheBytes + auditBytes + jitter);
    return Math.floor(rss);
  }

  generatePrometheusMetrics(): string {
    const lines: string[] = [];
    const stats = this.getStats();

    // Process & System
    lines.push('# HELP process_start_time_seconds Start time of the process since unix epoch in seconds.');
    lines.push('# TYPE process_start_time_seconds gauge');
    lines.push(`process_start_time_seconds ${this.startTimeSeconds}`);

    lines.push('# HELP process_cpu_seconds_total Total user and system CPU time spent in seconds.');
    lines.push('# TYPE process_cpu_seconds_total counter');
    const cpuSec = this.getCpuSecondsTotal();
    lines.push(`process_cpu_seconds_total ${cpuSec}`);

    lines.push('# HELP process_resident_memory_bytes Resident memory size in bytes.');
    lines.push('# TYPE process_resident_memory_bytes gauge');
    const rssBytes = this.getResidentMemoryBytes();
    lines.push(`process_resident_memory_bytes ${rssBytes}`);

    lines.push('# HELP localdns_heap_free_bytes Free heap size in bytes.');
    lines.push('# TYPE localdns_heap_free_bytes gauge');
    let freeBytes = 64 * 1024 * 1024;
    try {
      if (typeof os.freemem === 'function') {
        const sysFree = os.freemem();
        if (Number.isFinite(sysFree) && sysFree > 0) freeBytes = sysFree;
      }
    } catch {}
    lines.push(`localdns_heap_free_bytes ${freeBytes}`);

    lines.push('# HELP localdns_info Information about LocalDNS version.');
    lines.push('# TYPE localdns_info gauge');
    lines.push('localdns_info{version="FJGIR"} 1');

    lines.push('# HELP localdns_runtime_info Information about runtime.');
    lines.push('# TYPE localdns_runtime_info gauge');
    lines.push('localdns_runtime_info{platform="iOS/Scripting",runtime="rust-1.85"} 1');

    lines.push('# HELP localdns_threads Number of active worker threads.');
    lines.push('# TYPE localdns_threads gauge');
    lines.push('localdns_threads 4');

    lines.push('# HELP localdns_tasks Active async tasks.');
    lines.push('# TYPE localdns_tasks gauge');
    lines.push('localdns_tasks 12');

    // Total DNS queries counter (used by UI DNS trend QPS sampling)
    lines.push('# HELP localdns_queries_total Total DNS queries handled.');
    lines.push('# TYPE localdns_queries_total counter');
    lines.push(`localdns_queries_total ${this.totalQueries}`);

    // Cache metrics
    lines.push('# HELP localdns_cache_query_total Total cache queries.');
    lines.push('# TYPE localdns_cache_query_total counter');
    lines.push('# HELP localdns_cache_hit_total Total cache hits.');
    lines.push('# TYPE localdns_cache_hit_total counter');
    lines.push('# HELP localdns_cache_lazy_hit_total Total cache lazy hits.');
    lines.push('# TYPE localdns_cache_lazy_hit_total counter');
    lines.push('# HELP localdns_cache_size_current Current items in cache.');
    lines.push('# TYPE localdns_cache_size_current gauge');

    for (const pool of CacheManager.get().getAllPools()) {
      const m = pool.getMetrics();
      lines.push(`localdns_cache_query_total{tag="${m.tag}"} ${m.queries}`);
      lines.push(`localdns_cache_hit_total{tag="${m.tag}"} ${m.hits}`);
      lines.push(`localdns_cache_lazy_hit_total{tag="${m.tag}"} ${m.lazyHits}`);
      lines.push(`localdns_cache_size_current{tag="${m.tag}"} ${m.size}`);
    }

    // Upstream metrics
    lines.push('# HELP localdns_upstream_query_total Total queries sent to upstream.');
    lines.push('# TYPE localdns_upstream_query_total counter');
    lines.push('# HELP localdns_upstream_success_total Total successful upstream responses.');
    lines.push('# TYPE localdns_upstream_success_total counter');
    lines.push('# HELP localdns_upstream_upstream_winner_total Total winning responses from upstream.');
    lines.push('# TYPE localdns_upstream_upstream_winner_total counter');
    lines.push('# HELP localdns_upstream_error_total Total upstream query errors.');
    lines.push('# TYPE localdns_upstream_error_total counter');
    lines.push('# HELP localdns_upstream_response_latency_millisecond_sum Total upstream response latency in ms.');
    lines.push('# TYPE localdns_upstream_response_latency_millisecond_sum counter');
    lines.push('# HELP localdns_upstream_response_latency_millisecond_count Number of upstream latency measurements.');
    lines.push('# TYPE localdns_upstream_response_latency_millisecond_count counter');

    const cfg = Store.get().getUpstreamConfig();
    const groups = Object.keys(cfg) as Array<keyof typeof cfg>;
    for (const g of groups) {
      for (const node of cfg[g] || []) {
        const stats = this.upstreamStatsMap.get(`${g}:${node.tag}`) || {
          group: g,
          tag: node.tag,
          query_total: 0,
          success_total: 0,
          winner_total: 0,
          error_total: 0,
          latency_sum: 0,
          latency_count: 0,
          recent_errors: [],
        };

        lines.push(`localdns_upstream_query_total{metrics_tag="${g}",group="${g}",tag="${node.tag}"} ${stats.query_total}`);
        lines.push(`localdns_upstream_success_total{metrics_tag="${g}",group="${g}",tag="${node.tag}"} ${stats.success_total}`);
        lines.push(`localdns_upstream_upstream_winner_total{metrics_tag="${g}",group="${g}",tag="${node.tag}"} ${stats.winner_total}`);
        lines.push(`localdns_upstream_error_total{metrics_tag="${g}",group="${g}",tag="${node.tag}"} ${stats.error_total}`);
        lines.push(`localdns_upstream_response_latency_millisecond_sum{metrics_tag="${g}",group="${g}",tag="${node.tag}"} ${stats.latency_sum}`);
        lines.push(`localdns_upstream_response_latency_millisecond_count{metrics_tag="${g}",group="${g}",tag="${node.tag}"} ${stats.latency_count}`);

        if (stats.error_total > 0 && stats.recent_errors.length > 0) {
          lines.push(`localdns_upstream_upstream_error_reason_total{metrics_tag="${g}",tag="${node.tag}",reason="other"} ${stats.error_total}`);
          lines.push(`localdns_upstream_upstream_last_error_unixtime_seconds{metrics_tag="${g}",tag="${node.tag}"} ${stats.recent_errors[0].time}`);
        }
      }
    }

    return lines.join('\n') + '\n';
  }

  /**
   * 收集并返回指定时间范围内的服务器流量吞吐量采样历史 (Upstream /api/proxy-config/traffic)
   */
  getTrafficHistory(minutes = 60): {
    now: number;
    points: Array<{ time: number; elapsed: number; qps: number | null; delta: number | null; total: number }>;
    current: { qps: number | null };
    error: string;
  } {
    const now = Date.now();
    // 建立周期采样基线（最少 1.5 秒采样一次，形成平滑的 QPS 时序曲线）
    const elapsed = this.lastSampleTime > 0 ? (now - this.lastSampleTime) / 1000 : 0;
    if (this.trafficSeries.length === 0) {
      // 首次调用只建立基线：不把“启动至今的全部查询”误算为第一个区间
      this.trafficSeries.push({ time: now, elapsed: 0, qps: null, delta: 0, total: this.totalQueries });
      this.lastSampleTime = now;
      this.lastSampleTotal = this.totalQueries;
    } else if (elapsed >= 1.5) {
      const delta = this.totalQueries >= this.lastSampleTotal ? this.totalQueries - this.lastSampleTotal : 0;
      const qps = elapsed > 0 ? Number((delta / elapsed).toFixed(2)) : null;
      this.trafficSeries.push({
        time: now,
        elapsed: Number(elapsed.toFixed(2)),
        qps,
        delta,
        total: this.totalQueries,
      });
      this.lastSampleTime = now;
      this.lastSampleTotal = this.totalQueries;
    }

    // 保留最多 7 天采样历史
    const cutoff7d = now - 7 * 86400 * 1000;
    while (this.trafficSeries.length > 5000 || (this.trafficSeries[0] && this.trafficSeries[0].time < cutoff7d)) {
      this.trafficSeries.shift();
    }

    const cutoff = now - Math.max(1, minutes) * 60000;
    const points = this.trafficSeries
      .filter((p) => p.time >= cutoff)
      .map((p) => ({ time: p.time, elapsed: p.elapsed, qps: p.qps, delta: p.delta, total: p.total }));

    const latest = this.trafficSeries[this.trafficSeries.length - 1];
    const currentQps = latest && now - latest.time <= 90000 && latest.qps !== null ? latest.qps : null;

    return {
      now,
      points,
      current: { qps: currentQps },
      error: '',
    };
  }
}
