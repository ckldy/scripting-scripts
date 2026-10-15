import type { CacheEntry, CachePoolMetrics, DnsPacket } from './types';
import { serializeDnsPacket } from './dns-packet';

export class CachePool {
  private entries = new Map<string, CacheEntry>();
  public queries = 0;
  public hits = 0;
  public lazyHits = 0;

  constructor(public readonly tag: string) {}

  private key(domain: string, qtype: number): string {
    return `${domain.toLowerCase()}:${qtype}`;
  }

  get(domain: string, qtype: number, allowExpired = false): { packet: DnsPacket; rawBytes: Uint8Array; isLazy: boolean } | null {
    this.queries++;
    const k = this.key(domain, qtype);
    const entry = this.entries.get(k);
    if (!entry) return null;

    const now = Date.now();
    if (entry.expiresAt > now) {
      this.hits++;
      // Adjust TTL in answers
      const remainingSeconds = Math.max(1, Math.floor((entry.expiresAt - now) / 1000));
      const adjustedPacket: DnsPacket = {
        ...entry.packet,
        answers: entry.packet.answers.map(ans => ({ ...ans, ttl: remainingSeconds })),
      };
      return {
        packet: adjustedPacket,
        rawBytes: serializeDnsPacket(adjustedPacket),
        isLazy: false,
      };
    }

    if (allowExpired) {
      this.lazyHits++;
      const adjustedPacket: DnsPacket = {
        ...entry.packet,
        answers: entry.packet.answers.map(ans => ({ ...ans, ttl: 5 })), // Minimal TTL for stale hit
      };
      return {
        packet: adjustedPacket,
        rawBytes: serializeDnsPacket(adjustedPacket),
        isLazy: true,
      };
    }

    // Expired and not allowing stale
    this.entries.delete(k);
    return null;
  }

  set(domain: string, qtype: number, packet: DnsPacket, rawBytes: Uint8Array): void {
    const k = this.key(domain, qtype);
    // Find minimal TTL from answers, default to 300s
    let minTtl = 300;
    if (packet.answers.length > 0) {
      minTtl = Math.min(...packet.answers.map(a => Math.max(5, a.ttl || 300)));
    }
    const now = Date.now();
    this.entries.set(k, {
      packet,
      rawBytes,
      originalTtl: minTtl,
      expiresAt: now + minTtl * 1000,
      createdAt: now,
    });

    // Cleanup old items if size exceeds limit
    if (this.entries.size > 20000) {
      let toDelete = 2000;
      for (const key of this.entries.keys()) {
        this.entries.delete(key);
        if (--toDelete <= 0) break;
      }
    }
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
        answers: entry.packet.answers.map(a => String(a.data)),
      });
    }
    return result;
  }
}

export class CacheManager {
  private static instance: CacheManager;

  public mainCache = new CachePool('cache_main');
  public domesticCache = new CachePool('cache_domestic');
  public foreignCache = new CachePool('cache_foreign');
  public foreignEcsCache = new CachePool('cache_foreign_ecs');

  private constructor() {}

  static get(): CacheManager {
    if (!CacheManager.instance) {
      CacheManager.instance = new CacheManager();
    }
    return CacheManager.instance;
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

  clearAll(): void {
    for (const pool of this.getAllPools()) {
      pool.clear();
    }
  }
}
