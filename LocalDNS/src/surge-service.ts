/**
 * src/surge-service.ts
 *
 * LocalDNS × Surge 联动调度与模块脱水服务
 * 1. .sgmodule 解析、脱水（提取 REJECT 域名到 DNS 层，保留纯 L7 重写与脚本）
 * 2. 动态聚合编译单一调度模块 (/surge/hub.sgmodule)
 * 3. Surge HTTP API 客户端封装（带毫秒超时与静默降级）
 * 4. 内存级快速 DNS 拦截匹配集（零等待阻断）
 */

import { SurgeDatabase, type AppModule, type DnsRule, type HttpRule, type GeneralSetting } from './surge-db';

export interface ParsedModuleContent {
  name: string;
  desc?: string;
  system?: string;
  dnsRules: DnsRule[];
  mitmHosts: string[];
  httpRules: HttpRule[];
  generalSettings: GeneralSetting[];
}

export interface SurgeOutboundState {
  mode: string;
  policy?: string;
}

export interface SurgePolicyGroupItem {
  name: string;
  current: string;
  options: string[];
}

export class SurgeService {
  private static instance: SurgeService;
  private db: SurgeDatabase;
  private fastBlockExact = new Set<string>();
  private fastBlockSuffix: string[] = [];
  private fastBlockKeyword: string[] = [];
  private syncTimer: any = null;

  public static get(): SurgeService {
    if (!SurgeService.instance) {
      SurgeService.instance = new SurgeService();
    }
    return SurgeService.instance;
  }

  private constructor() {
    this.db = SurgeDatabase.get();
  }

  /**
   * 初始化服务并载入内存阻断集
   */
  public async init(): Promise<void> {
    await this.db.init();
    await this.reloadDnsBlockCache();
  }

  /**
   * 刷新内存中的 DNS 拦截规则，供 resolver.ts 纳秒级查询
   */
  public async reloadDnsBlockCache(): Promise<void> {
    const rules = await this.db.getActiveDnsBlockRules();
    const exact = new Set<string>();
    const suffix: string[] = [];
    const keyword: string[] = [];

    for (const r of rules) {
      const p = r.pattern.toLowerCase().trim();
      if (!p) continue;
      if (r.type === 'DOMAIN') {
        exact.add(p);
      } else if (r.type === 'DOMAIN-SUFFIX') {
        suffix.push(p);
      } else if (r.type === 'DOMAIN-KEYWORD') {
        keyword.push(p);
      }
    }

    this.fastBlockExact = exact;
    this.fastBlockSuffix = suffix;
    this.fastBlockKeyword = keyword;
  }

  /**
   * 判断域名是否被活跃模块的 DNS 规则拦截
   */
  public isDomainBlocked(domain: string): { blocked: boolean; pattern?: string; ruleType?: string } {
    const d = domain.toLowerCase().trim();
    if (this.fastBlockExact.has(d)) {
      return { blocked: true, pattern: d, ruleType: 'DOMAIN' };
    }
    for (const s of this.fastBlockSuffix) {
      if (d === s || d.endsWith('.' + s)) {
        return { blocked: true, pattern: s, ruleType: 'DOMAIN-SUFFIX' };
      }
    }
    for (const k of this.fastBlockKeyword) {
      if (d.includes(k)) {
        return { blocked: true, pattern: k, ruleType: 'DOMAIN-KEYWORD' };
      }
    }
    return { blocked: false };
  }

  // ==================== .sgmodule 解析与脱水 ====================

  /**
   * 解析原生 .sgmodule 文本，提取域名到 DNS，七层剥离
   */
  public parseModuleText(moduleId: string, text: string): ParsedModuleContent {
    const lines = text.split(/\r?\n/);
    let currentSection = '';
    let name = moduleId;
    let desc = '';
    let system = '';

    const dnsRules: DnsRule[] = [];
    const mitmHosts = new Set<string>();
    const httpRules: HttpRule[] = [];
    const generalSettings: GeneralSetting[] = [];

    for (let rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      // 元数据解析
      if (line.startsWith('#!name=')) {
        name = line.replace('#!name=', '').trim();
        continue;
      }
      if (line.startsWith('#!desc=')) {
        desc = line.replace('#!desc=', '').trim();
        continue;
      }
      if (line.startsWith('#!system=')) {
        system = line.replace('#!system=', '').trim();
        continue;
      }
      if (line.startsWith('#') || line.startsWith(';')) continue;

      // 区段头
      if (line.startsWith('[') && line.endsWith(']')) {
        currentSection = line.slice(1, -1).trim();
        continue;
      }

      // [Rule] 区段：提取 REJECT 规则到 DNS 拦截库
      if (currentSection === 'Rule') {
        const parts = line.split(',').map((p) => p.trim());
        if (parts.length >= 2) {
          const type = parts[0].toUpperCase();
          const pattern = parts[1];
          const action = (parts[2] || 'REJECT').toUpperCase();

          if (['DOMAIN', 'DOMAIN-SUFFIX', 'DOMAIN-KEYWORD', 'IP-CIDR'].includes(type) && action.startsWith('REJECT')) {
            dnsRules.push({
              module_id: moduleId,
              type: type as any,
              pattern,
              action: action as any,
              enabled: true,
            });
            continue;
          }
        }
      }

      // [MITM] 区段：提取解密域名
      if (currentSection === 'MITM') {
        const eqIdx = line.indexOf('=');
        if (eqIdx !== -1) {
          const key = line.slice(0, eqIdx).trim();
          let val = line.slice(eqIdx + 1).trim();
          if (key === 'hostname') {
            if (val.startsWith('%APPEND%')) val = val.replace('%APPEND%', '').trim();
            if (val.startsWith('%INSERT%')) val = val.replace('%INSERT%', '').trim();
            const hosts = val.split(',').map((h) => h.trim()).filter(Boolean);
            for (const h of hosts) mitmHosts.add(h);
          }
        }
        continue;
      }

      // [URL Rewrite] / [Header Rewrite] 区段
      if (currentSection === 'URL Rewrite' || currentSection === 'Header Rewrite') {
        const tokens = line.split(/\s+/);
        if (tokens.length >= 2) {
          httpRules.push({
            module_id: moduleId,
            rule_type: currentSection === 'Header Rewrite' ? 'header' : 'rewrite',
            sub_type: tokens[2] || 'rewrite',
            pattern: tokens[0],
            target: tokens.slice(1).join(' '),
            requires_body: false,
            max_size: 1048576,
            enabled: true,
          });
        }
        continue;
      }

      // [Script] 区段
      if (currentSection === 'Script') {
        const eqIdx = line.indexOf('=');
        if (eqIdx !== -1) {
          const scriptName = line.slice(0, eqIdx).trim();
          const params = line.slice(eqIdx + 1).trim();
          const reqBody = /requires-body\s*=\s*(?:1|true)/i.test(params);
          const patternMatch = params.match(/pattern\s*=\s*([^,]+)/);
          const typeMatch = params.match(/type\s*=\s*([^,]+)/);
          const pathMatch = params.match(/script-path\s*=\s*([^,]+)/);

          httpRules.push({
            module_id: moduleId,
            rule_type: 'script',
            sub_type: typeMatch ? typeMatch[1].trim() : 'http-response',
            pattern: patternMatch ? patternMatch[1].trim() : scriptName,
            target: pathMatch ? pathMatch[1].trim() : params,
            requires_body: reqBody,
            max_size: 1048576,
            enabled: true,
          });
        }
        continue;
      }

      // [General] 区段
      if (currentSection === 'General') {
        const eqIdx = line.indexOf('=');
        if (eqIdx !== -1) {
          const key = line.slice(0, eqIdx).trim();
          let value = line.slice(eqIdx + 1).trim();
          let operator: GeneralSetting['operator'] = '=';
          if (value.startsWith('%APPEND%')) {
            operator = '%APPEND%';
            value = value.replace('%APPEND%', '').trim();
          } else if (value.startsWith('%INSERT%')) {
            operator = '%INSERT%';
            value = value.replace('%INSERT%', '').trim();
          }
          generalSettings.push({ module_id: moduleId, key, operator, value });
        }
        continue;
      }
    }

    return {
      name,
      desc,
      system,
      dnsRules,
      mitmHosts: Array.from(mitmHosts),
      httpRules,
      generalSettings,
    };
  }

  /**
   * 导入并存储模块（清洗脱水）
   */
  public async importModule(
    id: string,
    name: string,
    category: AppModule['category'],
    sourceUrl: string | null,
    rawContent: string
  ): Promise<ParsedModuleContent> {
    await this.init();
    const parsed = this.parseModuleText(id, rawContent);
    const finalName = name || parsed.name || id;

    const moduleObj: AppModule = {
      id,
      name: finalName,
      category,
      source_url: sourceUrl,
      enabled: true,
      raw_content: rawContent,
      created_at: Date.now(),
      updated_at: Date.now(),
    };

    await this.db.saveModule(moduleObj);
    await this.db.saveModuleRules(id, parsed.dnsRules, parsed.mitmHosts, parsed.httpRules, parsed.generalSettings);
    await this.reloadDnsBlockCache();
    this.scheduleSurgeSync();
    return parsed;
  }

  // ==================== 统一聚合模块编译 (/surge/hub.sgmodule) ====================

  /**
   * 编译已激活模块的纯七层聚合模块文本
   */
  public async compileUnifiedHubModule(): Promise<string> {
    await this.init();
    const mitmHosts = await this.db.getActiveMitmHosts();
    const httpRules = await this.db.getActiveHttpRules();
    const genSettings = await this.db.getActiveGeneralSettings();

    const sections: string[] = [
      '#!name=LocalDNS Unified Hub',
      '#!desc=由 LocalDNS 智能中枢自动脱水与动态聚合编译的纯七层调度模块。域名拦截已全部在 LocalDNS 本地秒级阻断，仅向 Surge 注入必要之 MITM 解密与 URL 重写。',
      '#!system=ios,mac',
      '',
    ];

    // [General]
    if (genSettings.length > 0) {
      sections.push('[General]');
      for (const gs of genSettings) {
        sections.push(`${gs.key} = ${gs.operator !== '=' ? gs.operator + ' ' : ''}${gs.value}`);
      }
      sections.push('');
    }

    // [MITM]
    if (mitmHosts.length > 0) {
      sections.push('[MITM]');
      // 聚合去重与规范输出
      sections.push(`hostname = %APPEND% ${mitmHosts.join(', ')}`);
      sections.push('');
    }

    // [URL Rewrite]
    const rewrites = httpRules.filter((r) => r.rule_type === 'rewrite');
    if (rewrites.length > 0) {
      sections.push('[URL Rewrite]');
      for (const rw of rewrites) {
        sections.push(`${rw.pattern} ${rw.target}`);
      }
      sections.push('');
    }

    // [Header Rewrite]
    const headers = httpRules.filter((r) => r.rule_type === 'header');
    if (headers.length > 0) {
      sections.push('[Header Rewrite]');
      for (const hr of headers) {
        sections.push(`${hr.pattern} ${hr.target}`);
      }
      sections.push('');
    }

    // [Script]
    const scripts = httpRules.filter((r) => r.rule_type === 'script');
    if (scripts.length > 0) {
      sections.push('[Script]');
      let idx = 1;
      for (const sc of scripts) {
        const scName = `localdns_hub_sc_${idx++}`;
        const parts = [
          `type=${sc.sub_type}`,
          `pattern=${sc.pattern}`,
          `script-path=${sc.target}`,
        ];
        if (sc.requires_body) parts.push('requires-body=1');
        if (sc.max_size) parts.push(`max-size=${sc.max_size}`);
        sections.push(`${scName} = ${parts.join(',')}`);
      }
      sections.push('');
    }

    return sections.join('\n');
  }

  // ==================== Surge HTTP API Client ====================

  private async callSurgeApi(path: string, method = 'GET', body?: any): Promise<{ ok: boolean; status: number; data: any; error?: string }> {
    const config = await this.db.getSurgeConfig();
    if (!config.enabled && !path.startsWith('/v1/events')) {
      return { ok: false, status: 0, data: null, error: 'Surge 联动已在 LocalDNS 中关闭' };
    }
    const baseUrl = config.api_url.replace(/\/+$/, '');
    const url = `${baseUrl}${path.startsWith('/') ? '' : '/'}${path}`;
    const headers: Record<string, string> = {
      'User-Agent': 'LocalDNS/FJH7T',
      'Accept': 'application/json',
    };
    if (config.api_key) {
      headers['X-Key'] = config.api_key;
    }
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    // 严苛超时控制：1.5 秒，绝不阻塞主线程
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 1500);

    try {
      const res = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      const isJson = (res.headers.get('content-type') || '').includes('json');
      const data = isJson ? await res.json().catch(() => null) : await res.text().catch(() => null);
      return { ok: res.ok, status: res.status, data };
    } catch (e: any) {
      clearTimeout(timer);
      return { ok: false, status: 0, data: null, error: e?.message || 'Network error' };
    }
  }

  public async getSurgeStatus(): Promise<{ online: boolean; outbound?: string; modules?: any; error?: string }> {
    const res = await this.callSurgeApi('/v1/outbound');
    if (!res.ok) {
      return { online: false, error: res.error || `HTTP ${res.status}` };
    }
    const modRes = await this.callSurgeApi('/v1/modules');
    return {
      online: true,
      outbound: res.data?.mode || 'rule',
      modules: modRes.data,
    };
  }

  public async setOutboundMode(mode: 'direct' | 'rule' | 'proxy'): Promise<boolean> {
    const res = await this.callSurgeApi('/v1/outbound', 'POST', { mode });
    return res.ok;
  }

  public async getPolicyGroups(): Promise<SurgePolicyGroupItem[]> {
    const res = await this.callSurgeApi('/v1/policy_groups');
    if (!res.ok || !res.data) return [];
    const result: SurgePolicyGroupItem[] = [];
    if (typeof res.data === 'object') {
      for (const [name, info] of Object.entries<any>(res.data)) {
        result.push({
          name,
          current: info?.current || info?.policy || '',
          options: Array.isArray(info?.options) ? info.options : [],
        });
      }
    }
    return result;
  }

  public async selectPolicy(groupName: string, policy: string): Promise<boolean> {
    const res = await this.callSurgeApi('/v1/policy_groups/select', 'POST', {
      group_name: groupName,
      policy,
    });
    return res.ok;
  }

  public async testPolicyGroup(groupName: string): Promise<boolean> {
    const res = await this.callSurgeApi('/v1/policy_groups/test', 'POST', {
      group_name: groupName,
    });
    return res.ok;
  }

  public async flushSurgeDns(): Promise<boolean> {
    const res = await this.callSurgeApi('/v1/dns/flush', 'POST', {});
    return res.ok;
  }

  public async updateSurgeExternalResources(): Promise<boolean> {
    const res = await this.callSurgeApi('/v1/external_resources/update', 'POST', { key: 'all' });
    return res.ok;
  }

  public async reloadSurgeHubModule(): Promise<boolean> {
    // 关然后开触发热更新
    await this.callSurgeApi('/v1/modules', 'POST', { 'LocalDNS Unified Hub': false });
    const res = await this.callSurgeApi('/v1/modules', 'POST', { 'LocalDNS Unified Hub': true });
    return res.ok;
  }

  public async killActiveRequestsByHost(host: string): Promise<number> {
    const res = await this.callSurgeApi('/v1/requests/active');
    if (!res.ok || !Array.isArray(res.data?.requests)) return 0;
    const h = host.toLowerCase();
    let killed = 0;
    for (const req of res.data.requests) {
      const targetHost = (req.notes?.host || req.host || '').toLowerCase();
      if (targetHost === h || targetHost.endsWith('.' + h)) {
        await this.callSurgeApi('/v1/requests/kill', 'POST', { id: req.id });
        killed++;
      }
    }
    return killed;
  }

  /**
   * 防抖触发同步到 Surge
   */
  public scheduleSurgeSync(): void {
    if (this.syncTimer) clearTimeout(this.syncTimer);
    this.syncTimer = setTimeout(async () => {
      try {
        const cfg = await this.db.getSurgeConfig();
        if (!cfg.enabled) return;

        let okCount = 0;
        if (cfg.sync_ruleset) {
          const r1 = await this.updateSurgeExternalResources();
          if (r1) okCount++;
        }
        const r2 = await this.reloadSurgeHubModule();
        if (r2) okCount++;
        const r3 = await this.flushSurgeDns();
        if (r3) okCount++;

        await this.db.saveSurgeConfig({
          last_sync_at: Date.now(),
          last_sync_status: `已成功同步 (${okCount} 项操作成功)`,
        });
      } catch (e: any) {
        await this.db.saveSurgeConfig({
          last_sync_at: Date.now(),
          last_sync_status: `同步失败: ${e?.message || e}`,
        });
      }
    }, 500);
  }
}
