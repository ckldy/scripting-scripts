/**
 * 轻量级运行指标：只记录，不参与决策。
 * 采样窗口 512 条，避免长期占用内存；重启即清零。
 */
export interface DiversionMatchResultLike {
  group?: string;
  domainSet?: string;
}

interface MatchSample {
  ms: number;
  blocked: boolean;
  domainSet: string;
  at: number;
}

class MetricsService {
  private samples: MatchSample[] = [];
  private total = 0;
  private blocked = 0;
  private sumMs = 0;
  private maxMs = 0;
  private byDomainSet = new Map<string, number>();

  recordMatch(ms: number, result: DiversionMatchResultLike): void {
    const safeMs = Number.isFinite(ms) && ms >= 0 ? ms : 0;
    const domainSet = result?.domainSet || 'unknown';
    const isBlocked = result?.group === 'blocked';
    this.total += 1;
    if (isBlocked) this.blocked += 1;
    this.sumMs += safeMs;
    if (safeMs > this.maxMs) this.maxMs = safeMs;
    this.byDomainSet.set(domainSet, (this.byDomainSet.get(domainSet) || 0) + 1);
    this.samples.push({ ms: safeMs, blocked: isBlocked, domainSet, at: Date.now() });
    if (this.samples.length > 512) this.samples.shift();
  }

  snapshot(): {
    total: number;
    blocked: number;
    avgMs: number;
    p50Ms: number;
    p95Ms: number;
    maxMs: number;
    byDomainSet: Record<string, number>;
    samples: number;
  } {
    const sorted = this.samples.map((s) => s.ms).sort((a, b) => a - b);
    const pick = (q: number): number => {
      if (!sorted.length) return 0;
      const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)));
      return sorted[idx];
    };
    return {
      total: this.total,
      blocked: this.blocked,
      avgMs: this.total > 0 ? this.sumMs / this.total : 0,
      p50Ms: pick(0.5),
      p95Ms: pick(0.95),
      maxMs: this.maxMs,
      byDomainSet: Object.fromEntries(this.byDomainSet),
      samples: this.samples.length,
    };
  }

  reset(): void {
    this.samples = [];
    this.total = 0;
    this.blocked = 0;
    this.sumMs = 0;
    this.maxMs = 0;
    this.byDomainSet.clear();
  }
}

export const metrics = new MetricsService();
