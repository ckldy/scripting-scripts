import type { CacheEntry, CacheConfig, CachePoolMetrics, DnsPacket, DnsRecord } from './types';
import { serializeDnsPacket } from './dns-packet';

export class CachePool {
  private entries = new Map<string, CacheEntry>();
  public queries = 0;
  public hits = 0;
  public lazyHits = 0;

  constructor(public readonly tag: string, private maxSize = 20000) {}

  setMaxSize(n: number): void {
    this.maxSize = Math.max(100, Math.floor(n));
    this.evictIfNeeded();
  }

  private key(domain: string, qtype: number): string {
    return `${domain.toLowerCase()}:${qtype}`;
  }

  private touch(k: string, entry: CacheEntry): void {
    // Move to most-recently-used position (LRU)
    this.entries.delete(k);
    this.entries.set(k, entry);
  }

  private evictIfNeeded(): void {
    while (this.entries.size > this.maxSize) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  get(
    domain: string,
    qtype: number,
    allowExpired = false,
    replyTtl = 5
  ): { packet: DnsPacket; rawBytes: Uint8Array; isLazy: boolean } | null {
    this.queries++;
    const k = this.key(domain, qtype);
    const entry = this.entries.get(k);
    if (!entry) return null;

    const now = Date.now();
    if (entry.expiresAt > now) {
      this.hits++;
      this.touch(k, entry);
      const remainingSeconds = Math.max(1, Math.floor((entry.expiresAt - now) / 1000));
      const adjustedPacket: DnsPacket = {
        ...entry.packet,
        answers: entry.packet.answers.map((ans: DnsRecord) => ({ ...ans, ttl: remainingSeconds })),
      };
      return { packet: adjustedPacket, rawBytes: serializeDnsPacket(adjustedPacket), isLazy: false };
    }

    if (allowExpired) {
      this.lazyHits++;
      this.touch(k, entry);
      const adjustedPacket: DnsPacket = {
        ...entry.packet,
        answers: entry.packet.answers.map((ans: DnsRecord) => ({ ...ans, ttl: replyTtl })),
      };
      return { packet: adjustedPacket, rawBytes: serializeDnsPacket(adjustedPacket), isLazy: true };
    }

    this.entries.delete(k);
    return null;
  }

  peek(domain: string, qtype: number): { expiresAt: number; originalTtl: number } | null {
    const entry = this.entries.get(this.key(domain, qtype));
    if (!entry) return null;
    return { expiresAt: entry.expiresAt, originalTtl: entry.originalTtl };
  }

  set(
    domain: string,
    qtype: number,
    packet: DnsPacket,
    rawBytes: Uint8Array,
    ttlOverride?: number
  ): void {
    const k = this.key(domain, qtype);
    let minTtl = 300;
    if (ttlOverride !== undefined && ttlOverride > 0) {
      minTtl = ttlOverride;
    } else if (packet.answers.length > 0) {
      minTtl = Math.min(...packet.answers.map(a => Math.max(1, a.ttl || 300)));
    }
    const now = Date.now();
    // delete then set to keep LRU order fresh
    this.entries.delete(k);
    this.entries.set(k, {
      packet,
      rawBytes,
      originalTtl: minTtl,
      expiresAt: now + minTtl * 1000,
      createdAt: now,
    });
    this.evictIfNeeded();
  }

  clear(): void {
    this.entries.clear();
  }

  getMetrics(): CachePoolMetrics {
    return {
      tag: this.tag,
      queries: this.queries,
      hits: this.hits,
      lazyHits: this.lazyHits,
      size: this.entries.size,
    };
  }

  dumpItems(): Array<{ domain: string; type: number; ttl: number; answers: string[] }> {
    const now = Date.now();
    const result: Array<{ domain: string; type: number; ttl: number; answers: string[] }> = [];
    for (const [key, entry] of this.entries.entries()) {
      const [domain, typeStr] = key.split(':');
      const rem = Math.max(0, Math.floor((entry.expiresAt - now) / 1000));
      result.push({
        domain,
        type: Number(typeStr),
        ttl: rem,
        answers: entry.packet.answers.map((a: DnsRecord) => String(a.data)),
      });
    }
    return result;
  }

  dumpForPersist(limit: number): Array<{ key: string; packet: DnsPacket; expiresAt: number; originalTtl: number; createdAt: number }> {
    const out: Array<{ key: string; packet: DnsPacket; expiresAt: number; originalTtl: number; createdAt: number }> = [];
    const now = Date.now();
    // Iterate from most-recent to oldest
    const keys = Array.from(this.entries.keys());
    for (let i = keys.length - 1; i >= 0 && out.length < limit; i--) {
      const entry = this.entries.get(keys[i])!;
      if (entry.expiresAt <= now) continue;
      out.push({ key: keys[i], packet: entry.packet, expiresAt: entry.expiresAt, originalTtl: entry.originalTtl, createdAt: entry.createdAt });
    }
    return out;
  }

  loadForPersist(items: Array<{ key: string; packet: DnsPacket; expiresAt: number; originalTtl: number; createdAt: number }>): void {
    const now = Date.now();
    for (const it of items) {
      if (it.expiresAt <= now) continue;
      this.entries.set(it.key, {
        packet: it.packet,
        rawBytes: serializeDnsPacket(it.packet),
        originalTtl: it.originalTtl,
        expiresAt: it.expiresAt,
        createdAt: it.createdAt,
      });
    }
    this.evictIfNeeded();
  }
}

const CACHE_DUMP_KEY = 'localdns_cache_dump';
const PERSIST_PER_POOL_LIMIT = 2000;

export class CacheManager {
  private static instance: CacheManager;

  public mainCache = new CachePool('cache_main');
  public domesticCache = new CachePool('cache_domestic');
  public foreignCache = new CachePool('cache_foreign');
  public foreignEcsCache = new CachePool('cache_foreign_ecs');

  private persistEnabled = true;
  private persistTimer: any = null;
  private loaded = false;

  private constructor() {}

  static get(): CacheManager {
    if (!CacheManager.instance) {
      CacheManager.instance = new CacheManager();
    }
    return CacheManager.instance;
  }

  applyConfig(cfg: CacheConfig): void {
    this.persistEnabled = cfg.persist;
    for (const pool of this.getAllPools()) pool.setMaxSize(cfg.size);
  }

  getPool(tag: string): CachePool | null {
    switch (tag) {
      case 'cache_main': return this.mainCache;
      case 'cache_domestic': return this.domesticCache;
      case 'cache_foreign': return this.foreignCache;
      case 'cache_foreign_ecs': return this.foreignEcsCache;
      default: return null;
    }
  }

  getAllPools(): CachePool[] {
    return [this.mainCache, this.domesticCache, this.foreignCache, this.foreignEcsCache];
  }

  get(poolTag: string, domain: string, qtype: number, allowExpired = false, replyTtl = 5) {
    const pool = this.getPool(poolTag) || this.mainCache;
    return pool.get(domain, qtype, allowExpired, replyTtl);
  }

  peek(poolTag: string, domain: string, qtype: number) {
    const pool = this.getPool(poolTag) || this.mainCache;
    return pool.peek(domain, qtype);
  }

  set(poolTag: string, domain: string, qtype: number, packet: DnsPacket, rawBytes: Uint8Array, ttlOverride?: number): void {
    const pool = this.getPool(poolTag);
    if (pool) pool.set(domain, qtype, packet, rawBytes, ttlOverride);
    this.schedulePersist();
  }

  clearAll(): void {
    for (const pool of this.getAllPools()) pool.clear();
    this.schedulePersist();
  }

  // --- Persistence ---
  loadFromStorage(): void {
    if (this.loaded) return;
    this.loaded = true;
    if (!this.persistEnabled) return;
    try {
      if (typeof Storage === 'undefined' || !Storage.get) return;
      const dump = Storage.get<any>(CACHE_DUMP_KEY);
      if (!dump || typeof dump !== 'object') return;
      for (const pool of this.getAllPools()) {
        const items = dump[pool.tag];
        if (Array.isArray(items)) pool.loadForPersist(items);
      }
    } catch {}
  }

  schedulePersist(): void {
    if (!this.persistEnabled) return;
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.persistNow();
    }, 5000);
  }

  persistNow(): void {
    if (!this.persistEnabled) return;
    try {
      if (typeof Storage === 'undefined' || !Storage.set) return;
      const dump: Record<string, any> = {};
      for (const pool of this.getAllPools()) {
        dump[pool.tag] = pool.dumpForPersist(PERSIST_PER_POOL_LIMIT);
      }
      Storage.set(CACHE_DUMP_KEY, dump);
    } catch {}
  }
}
