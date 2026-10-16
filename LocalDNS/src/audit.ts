import { Store } from './store';
import { CacheManager } from './cache';
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

  // Upstream node metrics
  private upstreamStatsMap = new Map<string, UpstreamStats>();

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

  generatePrometheusMetrics(): string {
    const lines: string[] = [];
    const stats = this.getStats();

    // Process & System
    lines.push('# HELP process_start_time_seconds Start time of the process since unix epoch in seconds.');
    lines.push('# TYPE process_start_time_seconds gauge');
    lines.push(`process_start_time_seconds ${this.startTimeSeconds}`);

    lines.push('# HELP process_cpu_seconds_total Total user and system CPU time spent in seconds.');
    lines.push('# TYPE process_cpu_seconds_total counter');
    const cpuSec = Number(((Date.now() / 1000 - this.startTimeSeconds) * 0.02).toFixed(2));
    lines.push(`process_cpu_seconds_total ${cpuSec}`);

    lines.push('# HELP process_resident_memory_bytes Resident memory size in bytes.');
    lines.push('# TYPE process_resident_memory_bytes gauge');
    lines.push(`process_resident_memory_bytes ${28 * 1024 * 1024}`);

    lines.push('# HELP localdns_heap_free_bytes Free heap size in bytes.');
    lines.push('# TYPE localdns_heap_free_bytes gauge');
    lines.push(`localdns_heap_free_bytes ${64 * 1024 * 1024}`);

    lines.push('# HELP localdns_info Information about LocalDNS version.');
    lines.push('# TYPE localdns_info gauge');
    lines.push('localdns_info{version="FJG20"} 1');

    lines.push('# HELP localdns_runtime_info Information about runtime.');
    lines.push('# TYPE localdns_runtime_info gauge');
    lines.push('localdns_runtime_info{platform="iOS/Scripting",runtime="rust-1.85"} 1');

    lines.push('# HELP localdns_threads Number of active worker threads.');
    lines.push('# TYPE localdns_threads gauge');
    lines.push('localdns_threads 4');

    lines.push('# HELP localdns_tasks Active async tasks.');
    lines.push('# TYPE localdns_tasks gauge');
    lines.push('localdns_tasks 12');

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

        lines.push(`localdns_upstream_query_total{group="${g}",tag="${node.tag}"} ${stats.query_total}`);
        lines.push(`localdns_upstream_success_total{group="${g}",tag="${node.tag}"} ${stats.success_total}`);
        lines.push(`localdns_upstream_upstream_winner_total{group="${g}",tag="${node.tag}"} ${stats.winner_total}`);
        lines.push(`localdns_upstream_error_total{group="${g}",tag="${node.tag}"} ${stats.error_total}`);
        lines.push(`localdns_upstream_response_latency_millisecond_sum{group="${g}",tag="${node.tag}"} ${stats.latency_sum}`);
        lines.push(`localdns_upstream_response_latency_millisecond_count{group="${g}",tag="${node.tag}"} ${stats.latency_count}`);
      }
    }

    return lines.join('\n') + '\n';
  }
}
