// LocalDNS Core Types

export type UpstreamGroup = 'domestic' | 'foreign' | 'foreign_ecs' | 'proxy';

export interface UpstreamNode {
  tag: string;
  protocol: 'udp' | 'tcp' | 'tls' | 'https';
  addr: string;
  dial?: string;
  socks?: string;
  ecs?: string;
  timeout?: number;
  enabled?: boolean;
}

export type UpstreamConfig = Record<UpstreamGroup, UpstreamNode[]>;

export interface DnsQuestion {
  name: string;
  type: number;
  typeName: string;
  class: number;
}

export interface DnsRecord {
  name: string;
  type: number;
  typeName: string;
  class: number;
  ttl: number;
  data: string | Uint8Array;
}

export interface DnsPacket {
  id: number;
  flags: number;
  qr: boolean;
  opcode: number;
  aa: boolean;
  tc: boolean;
  rd: boolean;
  ra: boolean;
  rcode: number;
  rcodeName: string;
  questions: DnsQuestion[];
  answers: DnsRecord[];
  authorities: DnsRecord[];
  additionals: DnsRecord[];
}

/**
 * 缓存条目的来源信息（上游 UI 2026.11.21.1 的「原始分流 / 原始上游尝试 / 原始学习记录」）。
 * 只有真正写入缓存时已知的字段才会被填上；未知即缺省，界面不据此推测。
 */
export interface CacheOrigin {
  domain_set?: string;
  upstream_attempt?: string;
  learning?: string;
}

export interface AuditLogEntry {
  id: string;
  time: string; // ISO 8601 or local format
  timestamp: number;
  client: string;
  client_alias?: string;
  domain: string;
  query_type: string;
  domain_set: string;
  response_code: string;
  duration_ms: number;
  answers: string[];
  upstream_tag?: string;
  cache?: boolean;
  origin?: CacheOrigin;
  trace_id: string;
}

export interface AuditStats {
  total_queries: number;
  blocked_queries: number;
  average_duration_ms: number;
  cache_hit_rate: number;
  active_clients: number;
  tracked_domains: number;
}

export interface CacheEntry {
  packet: DnsPacket;
  rawBytes: Uint8Array;
  expiresAt: number;
  originalTtl: number;
  createdAt: number;
  origin?: CacheOrigin;
}

export interface CachePoolMetrics {
  tag: string;
  queries: number;
  hits: number;
  lazyHits: number;
  size: number;
}

export interface SwitchStates {
  switch1: 'A' | 'B';  // 请求屏蔽 (对无解析结果屏蔽)
  switch5: 'A' | 'B';  // 类型屏蔽 (屏蔽 SOA、PTR、HTTPS 等)
  switch7: 'A' | 'B';  // 广告屏蔽 (启用 AdGuard 广告规则)
  switch6: 'A' | 'B';  // IPv6 屏蔽 (屏蔽 AAAA)
  switch13: 'A' | 'B'; // 核心缓存 (启用最终结果缓存)
  switch4: 'A' | 'B';  // 过期缓存 (允许过期响应)
  switch2: 'A' | 'B';  // 指定 Client FakeIP
  switch12: 'A' | 'B'; // 指定 Client RealIP
}

export interface AdGuardRuleSource {
  id: string;
  name: string;
  tag: string;
  url: string;
  enabled: boolean;
  auto_update: boolean;
  update_interval_hours: number;
  rule_count: number;
  last_updated: string | null;
  last_error: string | null;
}

export interface DiversionSource {
  id: string;
  name: string;
  tag: string; // 'custom_cn' | 'custom_non_cn' | 'geoip_cn' | 'geosite_cn' | 'geosite_non_cn'
  url: string;
  format: string; // 'srs' | 'dat' | 'yaml' | 'json' | 'txt'
  dataset?: string;
  enabled: boolean;
  auto_update: boolean;
  update_interval_hours: number;
  rule_count: number;
  last_updated: string | null;
  last_error: string | null;
}

/**
 * 单个上游节点的累计指标 + 当前错误轮次指标。
 * 轮次：最后一次错误之后静默 quiet 秒即结束，结束后不再把历史错误计入当前轮次。
 */
export interface UpstreamStats {
  group: string;
  tag: string;
  query_total: number;
  success_total: number;
  winner_total: number;
  error_total: number;
  latency_sum: number;
  latency_count: number;
  recent_errors: Array<{ time: number; error: string }>;
  last_error_ts: number;
  error_reasons: Record<string, number>;
  round_successes: number;
  round_errors: number;
  round_reasons: Record<string, number>;
  round_last_error_ts: number;
}

export interface SpeedConfig {
  enabled: boolean;
  mode: string; // e.g. 'tcp:443,tcp:80' | 'none'
  responseMode: 'fastest-ip' | 'fastest-response' | 'first-ping';
  maxReplyIpNum: number; // 0 = unlimited
  timeoutMs: number;
  dualstackSelection: boolean;
}

export interface CacheConfig {
  size: number;
  persist: boolean;
  prefetch: boolean;
  serveExpiredTtl: number;
  replyTtl: number;
  rrTtlMin: number;
  rrTtlMax: number;
  negativeTtl: number;
}

export interface Dns64Config {
  enabled: boolean;
  prefix: string;
}

export interface NamedSets {
  domainSets: Record<string, string[]>;
  ipSets: Record<string, string[]>;
}
