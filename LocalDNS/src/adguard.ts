import { Store } from './store';
import type { AdGuardRuleSource } from './types';

async function fetchRuleWithFallback(url: string): Promise<string> {
  const candidateUrls: string[] = [url];
  // If GitHub raw URL, add high-speed mirror candidate
  if (url.includes('raw.githubusercontent.com')) {
    candidateUrls.push(url.replace('raw.githubusercontent.com', 'raw.gitmirror.com'));
    candidateUrls.push(`https://ghproxy.net/${url}`);
  }

  let lastError: any = null;
  for (const u of candidateUrls) {
    try {
      const resp = await fetch(u, {
        headers: { 'User-Agent': 'LocalDNS/FJG4Z' },
        signal: AbortSignal.timeout(8000),
      });
      if (resp.ok) {
        return await resp.text();
      }
      lastError = new Error(`HTTP ${resp.status} ${resp.statusText}`);
    } catch (e: any) {
      lastError = e;
    }
  }
  throw lastError || new Error('All download attempts failed');
}

const BUILTIN_AD_RULES = `
! Builtin High-frequency Mobile Ads & Tracking Filters
||adservice.google.com^
||pagead2.googlesyndication.com^
||googleads.g.doubleclick.net^
||ads.google.com^
||analytics.google.com^
||mobads.baidu.com^
||mobads-logs.baidu.com^
||pos.baidu.com^
||cpro.baidu.com^
||adash.m.taobao.com^
||adashx.m.taobao.com^
||alimama.com^
||tanx.com^
||pgdt.gtimg.cn^
||adnet.qq.com^
||e.qq.com^
||mi.gdt.qq.com^
||tmead.y.qq.com^
||ad.tencent.com^
||pangolin-sdk-toutiao.com^
||pglstatp-toutiao.com^
||toblog.ctobsnssdk.com^
||ads.tiktok.com^
||analytics.tiktok.com^
||e.kuaishou.com^
||corp.kuaishou.com^
||ad.xiaohongshu.com^
||track.uc.cn^
||umeng.com^
||talkingdata.net^
||sensorsdata.cn^
||growingio.com^
||tracking.example.com^
`;

export class AdGuardEngine {
  private static instance: AdGuardEngine;

  private blockedDomains = new Set<string>();
  private blockedSuffixes = new Set<string>();
  private whitelistDomains = new Set<string>();
  private whitelistSuffixes = new Set<string>();

  private ruleCount = 0;
  private isUpdating = false;

  private constructor() {
    this.rebuildFromStore();
  }

  static get(): AdGuardEngine {
    if (!AdGuardEngine.instance) {
      AdGuardEngine.instance = new AdGuardEngine();
    }
    return AdGuardEngine.instance;
  }

  getRuleCount(): number {
    return this.ruleCount;
  }

  rebuildFromStore(): void {
    this.blockedDomains.clear();
    this.blockedSuffixes.clear();
    this.whitelistDomains.clear();
    this.whitelistSuffixes.clear();

    // 1. Load built-in high-frequency ad rules first (guarantees out-of-the-box blocking!)
    let total = this.parseRules(BUILTIN_AD_RULES);

    // 2. Load stored subscription rules from Store
    const sources = Store.get().getAdguardSources();
    for (const source of sources) {
      if (!source.enabled) continue;
      const rawText = Store.get().getRule(`adguard_source_${source.id}`);
      if (rawText) {
        total += this.parseRules(rawText);
      }
    }
    this.ruleCount = total;
  }

  parseRules(text: string): number {
    const lines = text.split('\n');
    let count = 0;

    for (let line of lines) {
      line = line.trim();
      if (!line || line.startsWith('!') || line.startsWith('#')) continue;

      // Whitelist
      if (line.startsWith('@@')) {
        const pattern = line.slice(2);
        if (pattern.startsWith('||') && pattern.endsWith('^')) {
          this.whitelistSuffixes.add(pattern.slice(2, -1).toLowerCase());
        } else if (pattern.startsWith('||')) {
          this.whitelistSuffixes.add(pattern.slice(2).toLowerCase());
        } else {
          this.whitelistDomains.add(pattern.toLowerCase());
        }
        count++;
        continue;
      }

      // Hosts format: 0.0.0.0 domain.com or 127.0.0.1 domain.com
      const hostsMatch = line.match(/^(?:0\.0\.0\.0|127\.0\.0\.1)\s+([a-zA-Z0-9.\-_]+)/);
      if (hostsMatch) {
        this.blockedDomains.add(hostsMatch[1].toLowerCase());
        count++;
        continue;
      }

      // AdGuard format: ||domain.com^
      if (line.startsWith('||') && line.endsWith('^')) {
        this.blockedSuffixes.add(line.slice(2, -1).toLowerCase());
        count++;
        continue;
      }

      if (line.startsWith('||')) {
        this.blockedSuffixes.add(line.slice(2).toLowerCase());
        count++;
        continue;
      }

      // Simple domain
      if (/^[a-zA-Z0-9.\-_]+$/.test(line)) {
        this.blockedDomains.add(line.toLowerCase());
        count++;
      }
    }
    return count;
  }

  isBlocked(domain: string): boolean {
    const d = domain.toLowerCase().replace(/\.$/, '');

    // Check whitelist first
    if (this.whitelistDomains.has(d)) return false;
    for (const suffix of this.whitelistSuffixes) {
      if (d === suffix || d.endsWith('.' + suffix)) return false;
    }

    // Check exact domain
    if (this.blockedDomains.has(d)) return true;

    // Check suffix
    for (const suffix of this.blockedSuffixes) {
      if (d === suffix || d.endsWith('.' + suffix)) return true;
    }

    return false;
  }

  async updateSource(id: string): Promise<{ success: boolean; ruleCount: number; error?: string }> {
    const sources = Store.get().getAdguardSources();
    const source = sources.find(s => s.id === id);
    if (!source) throw new Error(`Source ${id} not found`);

    try {
      const text = await fetchRuleWithFallback(source.url);
      Store.get().setRule(`adguard_source_${source.id}`, text);

      const parsedCount = this.parseRules(text);
      source.rule_count = parsedCount;
      source.last_updated = new Date().toISOString();
      source.last_error = null;
      Store.get().setAdguardSources(sources);
      this.rebuildFromStore();
      return { success: true, ruleCount: parsedCount };
    } catch (err: any) {
      source.last_error = err.message || String(err);
      Store.get().setAdguardSources(sources);
      return { success: false, ruleCount: 0, error: source.last_error || undefined };
    }
  }

  async updateAll(): Promise<{ updated_sources: number; errors: Array<{ name: string; error: string }> }> {
    if (this.isUpdating) return { updated_sources: 0, errors: [] };
    this.isUpdating = true;
    try {
      const sources = Store.get().getAdguardSources();
      let updated = 0;
      const errors: Array<{ name: string; error: string }> = [];
      for (const s of sources) {
        if (!s.enabled) continue;
        const res = await this.updateSource(s.id);
        if (res.success) {
          updated++;
        } else {
          errors.push({ name: s.name, error: res.error || '下载或解析失败' });
        }
      }
      return { updated_sources: updated, errors };
    } finally {
      this.isUpdating = false;
    }
  }
}
