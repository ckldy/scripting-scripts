import { Store } from './store';
import { AdGuardEngine } from './adguard';
import { ModuleManager } from './modules/module-manager';
import { FakeIpPool } from './mitm/fakeip';
import type { UpstreamGroup, DiversionSource } from './types';

export interface RouteResult {
  group: UpstreamGroup | 'blocked' | 'rewrite';
  domainSet: string;
  rewriteIp?: string;
}

async function fetchDiversionWithFallback(url: string): Promise<string> {
  const candidateUrls: string[] = [url];
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

export class DiversionEngine {
  private static instance: DiversionEngine;

  private whitelist = new Set<string>();
  private blocklist = new Set<string>();
  private greylist = new Set<string>();
  private forceRealip = new Set<string>();
  private rewrites = new Map<string, string>();

  // Cached domain sets from subscriptions
  private cnDomains = new Set<string>();
  private foreignDomains = new Set<string>();
  private geositeCn = new Set<string>();
  private geositeNonCn = new Set<string>();

  private isUpdating = false;

  private constructor() {
    this.reloadLocalRules();
    this.reloadSubscriptions();
  }

  static get(): DiversionEngine {
    if (!DiversionEngine.instance) {
      DiversionEngine.instance = new DiversionEngine();
    }
    return DiversionEngine.instance;
  }

  reloadLocalRules(): void {
    const store = Store.get();

    this.whitelist = this.parseList(store.getRule('whitelist'));
    this.blocklist = this.parseList(store.getRule('blocklist'));
    this.greylist = this.parseList(store.getRule('greylist'));
    this.forceRealip = this.parseList(store.getRule('force_realip'));

    // Rewrites: "domain.com 1.2.3.4"
    this.rewrites.clear();
    const rewriteLines = store.getRule('rewrite').split('\n');
    for (let line of rewriteLines) {
      line = line.trim();
      if (!line || line.startsWith('#')) continue;
      const parts = line.split(/\s+/);
      if (parts.length >= 2) {
        this.rewrites.set(parts[0].toLowerCase(), parts[1]);
      }
    }
  }

  reloadSubscriptions(): void {
    const store = Store.get();
    const sources = store.getDiversionSources();

    this.cnDomains.clear();
    this.foreignDomains.clear();
    this.geositeCn.clear();
    this.geositeNonCn.clear();

    for (const s of sources) {
      if (!s.enabled) continue;
      const content = store.getRule(`diversion_source_${s.id}`);
      if (!content) continue;

      const set = this.parseList(content);
      if (s.tag === 'custom_cn') {
        for (const d of set) this.cnDomains.add(d);
      } else if (s.tag === 'custom_non_cn') {
        for (const d of set) this.foreignDomains.add(d);
      } else if (s.tag === 'geosite_cn') {
        for (const d of set) this.geositeCn.add(d);
      } else if (s.tag === 'geosite_non_cn') {
        for (const d of set) this.geositeNonCn.add(d);
      }
    }
  }

  private parseList(text: string): Set<string> {
    const set = new Set<string>();
    for (let line of text.split('\n')) {
      line = line.trim();
      if (!line || line.startsWith('#') || line.startsWith('!')) continue;
      // Strip leading full: or domain: prefixes if any
      const cleaned = line.replace(/^(?:full:|domain:)/i, '').toLowerCase();
      set.add(cleaned);
    }
    return set;
  }

  private matchSet(domain: string, set: Set<string>): boolean {
    const d = domain.toLowerCase().replace(/\.$/, '');
    if (set.has(d)) return true;

    // Check parent domains (e.g. sub.example.com -> example.com)
    let idx = d.indexOf('.');
    while (idx !== -1) {
      const parent = d.slice(idx + 1);
      if (set.has(parent)) return true;
      idx = d.indexOf('.', idx + 1);
    }
    return false;
  }

  match(domain: string, clientIp: string): RouteResult {
    let d = domain.trim().toLowerCase();
    d = d.replace(/^[a-zA-Z]+:\/\//, '').split('/')[0].split('?')[0].replace(/:\d+$/, '').replace(/\.$/, '');
    const store = Store.get();
    const switches = store.getSwitches();

    // 1. Rewrite check (Custom redirection highest priority)
    if (this.rewrites.has(d)) {
      return { group: 'rewrite', domainSet: 'rewrite', rewriteIp: this.rewrites.get(d) };
    }

    // 2. Exact & Wildcard Blocklist check (Local custom blacklist highest priority block)
    if (this.blocklist.has(d) || this.matchSet(d, this.blocklist)) {
      return { group: 'blocked', domainSet: 'blocklist' };
    }

    // 3. Module MITM Host check (L7 Stream Cleaning via FakeIP, governed by switch_mitm)
    if (switches.switch_mitm === 'A' && ModuleManager.get().isMitmHost(d)) {
      const fakeIp = FakeIpPool.get().allocate(d);
      return { group: 'rewrite', domainSet: 'mitm_fakeip', rewriteIp: fakeIp };
    }

    // 4. AdGuard ad blocking (Checked before broad root-domain whitelist to prevent ad subdomains from leaking through!)
    if (switches.switch7 === 'A' && AdGuardEngine.get().isBlocked(d)) {
      return { group: 'blocked', domainSet: 'adguard' };
    }

    // 4. Local Whitelist (Checked after ad blocking)
    if (this.matchSet(d, this.whitelist)) {
      return { group: 'domestic', domainSet: 'whitelist' };
    }

    // 5. Local Greylist (Force foreign)
    if (this.matchSet(d, this.greylist)) {
      return { group: 'foreign', domainSet: 'greylist' };
    }

    // 6. Force RealIP
    if (this.matchSet(d, this.forceRealip)) {
      return { group: 'domestic', domainSet: 'force_realip' };
    }

    // 7. Custom CN rules
    if (this.matchSet(d, this.cnDomains)) {
      return { group: 'domestic', domainSet: 'custom_cn' };
    }

    // 8. Custom Non-CN rules
    if (this.matchSet(d, this.foreignDomains)) {
      return { group: 'foreign', domainSet: 'custom_non_cn' };
    }

    // 9. Geosite CN
    if (this.matchSet(d, this.geositeCn)) {
      return { group: 'domestic', domainSet: 'geosite_cn' };
    }

    // 10. Geosite Non-CN
    if (this.matchSet(d, this.geositeNonCn)) {
      return { group: 'foreign', domainSet: 'geosite_non_cn' };
    }

    // 11. Built-in TLD and popular domain heuristics (Optimized for high-speed resolution)
    const isDomainMatch = (domain: string, target: string) =>
      domain === target || domain.endsWith('.' + target);

    const isDomesticDomain =
      d.endsWith('.cn') ||
      isDomainMatch(d, 'baidu.com') ||
      isDomainMatch(d, 'bdstatic.com') ||
      isDomainMatch(d, 'qq.com') ||
      isDomainMatch(d, 'tencent.com') ||
      isDomainMatch(d, 'weixin.qq.com') ||
      isDomainMatch(d, 'aliyun.com') ||
      isDomainMatch(d, 'taobao.com') ||
      isDomainMatch(d, 'alicdn.com') ||
      isDomainMatch(d, 'tmall.com') ||
      isDomainMatch(d, 'jd.com') ||
      isDomainMatch(d, 'bilibili.com') ||
      isDomainMatch(d, 'bilivideo.com') ||
      isDomainMatch(d, 'bytedance.com') ||
      isDomainMatch(d, 'douyin.com') ||
      isDomainMatch(d, 'toutiao.com') ||
      isDomainMatch(d, '163.com') ||
      isDomainMatch(d, '126.net') ||
      isDomainMatch(d, 'netease.com') ||
      isDomainMatch(d, 'sina.com.cn') ||
      isDomainMatch(d, 'sina.com') ||
      isDomainMatch(d, 'weibo.com') ||
      isDomainMatch(d, 'sohu.com') ||
      isDomainMatch(d, 'zhihu.com') ||
      isDomainMatch(d, 'xiaohongshu.com') ||
      isDomainMatch(d, 'meituan.com') ||
      isDomainMatch(d, 'kuaishou.com') ||
      isDomainMatch(d, 'apple.com') ||
      isDomainMatch(d, 'icloud.com') ||
      isDomainMatch(d, 'aaplimg.com') ||
      isDomainMatch(d, 'csdn.net') ||
      isDomainMatch(d, 'v2ex.com');

    if (isDomesticDomain) {
      return { group: 'domestic', domainSet: 'default_cn' };
    }

    // Default to foreign group with automatic domestic fallback
    return { group: 'foreign', domainSet: 'default_foreign' };
  }

  getSourceFileCounts(): Record<string, number> {
    const store = Store.get();
    const counts: Record<string, number> = {
      whitelist: this.whitelist.size,
      blocklist: this.blocklist.size,
      greylist: this.greylist.size,
      force_realip: this.forceRealip.size,
      custom_cn: this.cnDomains.size,
      custom_non_cn: this.foreignDomains.size,
      geosite_cn: this.geositeCn.size,
      geosite_non_cn: this.geositeNonCn.size,
      adguard: AdGuardEngine.get().getRuleCount(),
    };
    return counts;
  }

  async updateSource(id: string): Promise<{ success: boolean; ruleCount: number; error?: string }> {
    const sources = Store.get().getDiversionSources();
    const source = sources.find(s => s.id === id);
    if (!source) throw new Error(`Diversion source ${id} not found`);

    try {
      const text = await fetchDiversionWithFallback(source.url);
      Store.get().setRule(`diversion_source_${source.id}`, text);

      const count = this.parseList(text).size;
      source.rule_count = count;
      source.last_updated = new Date().toISOString();
      source.last_error = null;
      Store.get().setDiversionSources(sources);
      this.reloadSubscriptions();
      return { success: true, ruleCount: count };
    } catch (err: any) {
      source.last_error = err.message || String(err);
      Store.get().setDiversionSources(sources);
      return { success: false, ruleCount: 0, error: source.last_error || undefined };
    }
  }

  async updateAll(tagFilter?: string): Promise<{ updated: number; failed: number; dataset_required: number; errors: Array<{ name: string; error: string }> }> {
    if (this.isUpdating) return { updated: 0, failed: 0, dataset_required: 0, errors: [] };
    this.isUpdating = true;
    try {
      const sources = Store.get().getDiversionSources();
      let updated = 0;
      let failed = 0;
      const errors: Array<{ name: string; error: string }> = [];
      for (const s of sources) {
        if (!s.enabled) continue;
        if (tagFilter && s.tag !== tagFilter) continue;
        const res = await this.updateSource(s.id);
        if (res.success) {
          updated++;
        } else {
          failed++;
          errors.push({ name: s.name, error: res.error || '下载或解析失败' });
        }
      }
      return { updated, failed, dataset_required: 0, errors };
    } finally {
      this.isUpdating = false;
    }
  }
}
