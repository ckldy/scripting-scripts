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

  // ==================== 远程资源抓取与连通测试扩展 ====================

  /**
   * 抓取远程 HTTP(S) 文本，带镜像降级与尺寸/超时保护
   */
  public async fetchRemoteText(urlStr: string): Promise<{ text: string; finalUrl: string }> {
    let targetUrl: URL;
    try {
      targetUrl = new URL(urlStr.trim());
    } catch {
      throw new Error('无效的 URL 地址格式');
    }
    if (!['http:', 'https:'].includes(targetUrl.protocol)) {
      throw new Error('仅支持 HTTP 或 HTTPS 协议');
    }

    const candidateUrls: string[] = [targetUrl.href];
    if (targetUrl.hostname === 'raw.githubusercontent.com') {
      candidateUrls.push(targetUrl.href.replace('raw.githubusercontent.com', 'raw.gitmirror.com'));
      candidateUrls.push(`https://ghproxy.net/${targetUrl.href}`);
    }

    let lastError: any = null;
    for (const u of candidateUrls) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      try {
        const resp = await fetch(u, {
          headers: { 'User-Agent': 'LocalDNS/FJH7T (Surge-Hub)' },
          signal: ctrl.signal,
        });
        clearTimeout(timer);
        if (resp.ok) {
          const txt = await resp.text();
          if (txt.length > 5 * 1024 * 1024) {
            throw new Error('远程文件过大（超过 5MB 限制）');
          }
          return { text: txt, finalUrl: u };
        }
        lastError = new Error(`HTTP ${resp.status} ${resp.statusText}`);
      } catch (e: any) {
        clearTimeout(timer);
        lastError = e;
      }
    }
    throw lastError || new Error('所有下载候选地址均尝试失败');
  }

  /**
   * 主动深度探测 Surge HTTP API 连通性与响应质量
   */
  public async testSurgeConnectivity(customUrl?: string, customKey?: string): Promise<{
    success: boolean;
    rttMs: number;
    url: string;
    outbound?: string;
    modulesCount?: number;
    activePoliciesCount?: number;
    error?: string;
    hint?: string;
  }> {
    const cfg = await this.db.getSurgeConfig();
    const apiUrl = (customUrl || cfg.api_url || 'http://127.0.0.1:6171').replace(/\/+$/, '');
    const apiKey = customKey !== undefined ? customKey : cfg.api_key;

    const start = Date.now();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3000);

    try {
      const headers: Record<string, string> = {
        'User-Agent': 'LocalDNS/FJH7T',
        'Accept': 'application/json',
      };
      if (apiKey) headers['X-Key'] = apiKey;

      const res = await fetch(`${apiUrl}/v1/outbound`, { headers, signal: ctrl.signal });
      clearTimeout(timer);
      const rttMs = Date.now() - start;

      if (!res.ok) {
        let hint = '请核对 Surge 的 [General] http-api 密钥是否与此处填写的 API 访问密钥完全一致。';
        if (res.status === 403 || res.status === 401) hint = 'Surge 鉴权失败：X-Key 密钥不匹配。';
        return {
          success: false,
          rttMs,
          url: apiUrl,
          error: `HTTP ${res.status} ${res.statusText}`,
          hint,
        };
      }

      const outData: any = await res.json().catch(() => ({}));
      const modRes = await fetch(`${apiUrl}/v1/modules`, { headers, signal: AbortSignal.timeout(2000) }).catch(() => null);
      const modData: any = modRes && modRes.ok ? await modRes.json().catch(() => ({})) : {};
      const polRes = await fetch(`${apiUrl}/v1/policy_groups`, { headers, signal: AbortSignal.timeout(2000) }).catch(() => null);
      const polData: any = polRes && polRes.ok ? await polRes.json().catch(() => ({})) : {};

      const modulesCount = Array.isArray(modData?.enabled) ? modData.enabled.length : 0;
      const activePoliciesCount = typeof polData === 'object' && polData ? Object.keys(polData).length : 0;

      return {
        success: true,
        rttMs,
        url: apiUrl,
        outbound: outData?.mode || 'rule',
        modulesCount,
        activePoliciesCount,
      };
    } catch (e: any) {
      clearTimeout(timer);
      const rttMs = Date.now() - start;
      let hint = '连接失败。请确认：1. Surge 是否正在运行；2. Surge 配置 [General] 是否包含 http-api = key@0.0.0.0:6171；3. 若跨设备连接，IP 地址是否可达。';
      if (e?.name === 'AbortError') hint = '连接超时（超过 3 秒未响应）。可能是 Surge 未监听指定端口或防火墙阻断。';
      return {
        success: false,
        rttMs,
        url: apiUrl,
        error: e?.message || '网络连接失败',
        hint,
      };
    }
  }

  /**
   * 收集 Surge 详细运行体征
   */
  public async getSurgeDetailedRuntime(): Promise<{
    online: boolean;
    outbound?: string;
    rttMs?: number;
    modules?: { enabled: string[]; available: string[] };
    policyGroups?: SurgePolicyGroupItem[];
    lastSyncAt?: number | null;
    lastSyncStatus?: string | null;
    error?: string;
    hint?: string;
  }> {
    const conn = await this.testSurgeConnectivity();
    if (!conn.success) {
      const cfg = await this.db.getSurgeConfig();
      return {
        online: false,
        error: conn.error,
        hint: conn.hint,
        lastSyncAt: cfg.last_sync_at,
        lastSyncStatus: cfg.last_sync_status,
      };
    }

    const cfg = await this.db.getSurgeConfig();
    const pGroups = await this.getPolicyGroups();
    const modRes = await this.callSurgeApi('/v1/modules');

    return {
      online: true,
      outbound: conn.outbound,
      rttMs: conn.rttMs,
      modules: modRes.data,
      policyGroups: pGroups,
      lastSyncAt: cfg.last_sync_at,
      lastSyncStatus: cfg.last_sync_status,
    };
  }

  /**
   * 从远程 URL 导入 App 模块
   */
  public async importRemoteModule(
    url: string,
    name?: string,
    category: AppModule['category'] = 'app'
  ): Promise<{ module: AppModule; parsed: ParsedModuleContent }> {
    const { text, finalUrl } = await this.fetchRemoteText(url);
    const fileSlug = (url.split('/').pop() || 'mod').replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
    const id = ('mod_' + fileSlug + '_' + Date.now().toString(36)).slice(0, 48);
    const parsed = await this.importModule(id, name || '', category, finalUrl, text);
    const mod = await this.db.getModule(id);
    return { module: mod!, parsed };
  }

  /**
   * 在线更新模块内容
   */
  public async updateModuleContent(id: string, name: string, content: string): Promise<ParsedModuleContent> {
    await this.init();
    const existing = await this.db.getModule(id);
    const finalCategory = existing ? existing.category : 'app';
    const sourceUrl = existing ? existing.source_url : null;
    return await this.importModule(id, name, finalCategory, sourceUrl, content);
  }

  /**
   * 远程导入规则集到指定分流组
   */
  public async importRemoteRules(
    groupId: string,
    url: string,
    mode: 'append' | 'replace' = 'append'
  ): Promise<{ importedCount: number; finalUrl: string }> {
    await this.init();
    const { text, finalUrl } = await this.fetchRemoteText(url);
    const rules = this.parseRulesList(text);
    let count = 0;
    if (mode === 'replace') {
      count = await this.db.replaceGroupRules(groupId, rules);
    } else {
      count = await this.db.appendGroupRules(groupId, rules);
    }
    this.scheduleSurgeSync();
    return { importedCount: count, finalUrl };
  }

  /**
   * 在线多行编辑并替换指定分流组的规则
   */
  public async updateGroupRulesText(groupId: string, text: string): Promise<number> {
    await this.init();
    const rules = this.parseRulesList(text);
    const count = await this.db.replaceGroupRules(groupId, rules);
    this.scheduleSurgeSync();
    return count;
  }

  /**
   * 格式化规则集文本解析
   */
  public parseRulesList(text: string): Array<{ match_type: any; pattern: string; comment?: string }> {
    const lines = text.split(/\r?\n/);
    const result: Array<{ match_type: any; pattern: string; comment?: string }> = [];

    for (let rawLine of lines) {
      let line = rawLine.trim();
      if (!line || line.startsWith('#') || line.startsWith(';')) continue;

      let comment = '';
      const slashMatch = line.match(/(^|[^:])\/\/(.*)$/);
      if (slashMatch && slashMatch.index !== undefined) {
        const cutAt = slashMatch.index + slashMatch[1].length;
        comment = line.slice(cutAt + 2).trim();
        line = line.slice(0, cutAt).trim();
      }

      const tokens = line.split(',').map((t) => t.trim());
      if (tokens.length >= 2) {
        const type = tokens[0].toUpperCase();
        const pattern = tokens[1];
        if (['DOMAIN', 'DOMAIN-SUFFIX', 'DOMAIN-KEYWORD', 'IP-CIDR', 'GEOIP', 'RULE-SET'].includes(type)) {
          result.push({ match_type: type, pattern, comment });
          continue;
        }
      }

      // 纯域名行兼容 (如只有 baidu.com)
      if (!line.includes(',') && !line.includes(' ') && line.includes('.')) {
        result.push({ match_type: 'DOMAIN-SUFFIX', pattern: line, comment });
      }
    }
    return result;
  }

  /**
   * 批量导入与智能清洗 Surge 规则文本（支持多规则集、多行内联规则同时导入并按策略自动分流）
   */
  public async ingestSurgeRulesBlock(
    text: string,
    options?: { downloadRuleSets?: boolean; targetGroupOverride?: string }
  ): Promise<{
    totalLines: number;
    parsedRulesCount: number;
    ruleSetsFetchedCount: number;
    rejectCount: number;
    directCount: number;
    proxyCount: number;
    otherCount: number;
    groupsUpdated: string[];
    details: string[];
  }> {
    await this.init();
    const lines = text.split(/\r?\n/);
    const downloadRuleSets = options?.downloadRuleSets !== false;
    const targetOverride = options?.targetGroupOverride?.trim();

    let parsedRulesCount = 0;
    let ruleSetsFetchedCount = 0;
    let rejectCount = 0;
    let directCount = 0;
    let proxyCount = 0;
    let otherCount = 0;

    const groupRulesMap = new Map<string, Array<{ match_type: any; pattern: string; comment?: string }>>();
    const details: string[] = [];
    let lastComment = '';

    const addRuleToGroup = (groupId: string, rule: { match_type: any; pattern: string; comment?: string }) => {
      if (!groupRulesMap.has(groupId)) {
        groupRulesMap.set(groupId, []);
      }
      groupRulesMap.get(groupId)!.push(rule);
    };

    for (let rawLine of lines) {
      let line = rawLine.trim();
      if (!line) continue;

      // 捕获前导注释
      if (line.startsWith('#') || line.startsWith(';') || line.startsWith('//')) {
        lastComment = line.replace(/^[#;/\s>]+/, '').trim();
        continue;
      }

      // 剥离行尾注释 (避开 http:// 与 https:// 中的 //)
      let inlineComment = lastComment;
      const slashMatch = line.match(/(^|[^:])\/\/(.*)$/);
      if (slashMatch && slashMatch.index !== undefined) {
        const cutAt = slashMatch.index + slashMatch[1].length;
        inlineComment = line.slice(cutAt + 2).trim();
        line = line.slice(0, cutAt).trim();
      }

      const tokens = line.split(',').map((t) => t.trim());
      if (tokens.length < 2) {
        // 纯域名兼容
        if (line.includes('.') && !line.includes(' ')) {
          const gid = targetOverride || 'direct';
          addRuleToGroup(gid, { match_type: 'DOMAIN-SUFFIX', pattern: line, comment: inlineComment });
          parsedRulesCount++;
          directCount++;
        }
        continue;
      }

      const typeUpper = tokens[0].toUpperCase();

      // 1. 处理 RULE-SET 外部规则集
      if (typeUpper === 'RULE-SET') {
        parsedRulesCount++;
        const ruleSetUrl = tokens[1];
        const rawPolicy = (tokens[2] || 'DIRECT').toUpperCase();
        let targetGroupId = targetOverride || '';

        let isReject = false;
        if (!targetGroupId) {
          if (rawPolicy.startsWith('REJECT')) {
            targetGroupId = 'block';
            isReject = true;
          } else if (rawPolicy === 'DIRECT') {
            targetGroupId = 'direct';
          } else if (rawPolicy === 'PROXY') {
            targetGroupId = 'proxy';
          } else {
            // 自定义策略名（如 Media, HK-Node 等）
            targetGroupId = rawPolicy.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
          }
        } else {
          isReject = targetGroupId === 'block';
        }

        // 确保目标分组存在
        await this.db.ensureGroupExists(targetGroupId, undefined, rawPolicy);

        // 若是远程 HTTP(S) 链接且需要自动展开内容
        if (downloadRuleSets && (ruleSetUrl.startsWith('http://') || ruleSetUrl.startsWith('https://'))) {
          try {
            const { text: remoteContent } = await this.fetchRemoteText(ruleSetUrl);
            const extracted = this.parseRulesList(remoteContent);
            ruleSetsFetchedCount++;

            for (const r of extracted) {
              addRuleToGroup(targetGroupId, {
                match_type: r.match_type,
                pattern: r.pattern,
                comment: r.comment || inlineComment || `来自 ${ruleSetUrl.split('/').pop()}`,
              });
            }

            if (isReject) {
              rejectCount += extracted.length;
            } else if (targetGroupId === 'direct') {
              directCount += extracted.length;
            } else if (targetGroupId === 'proxy') {
              proxyCount += extracted.length;
            } else {
              otherCount += extracted.length;
            }

            details.push(`RULE-SET [${ruleSetUrl.split('/').pop()}]: 成功抓取并展开 ${extracted.length} 条规则至 [${targetGroupId}]`);
          } catch (e: any) {
            // 抓取失败时保留该引用链接，不中断主流程
            addRuleToGroup(targetGroupId, {
              match_type: 'RULE-SET',
              pattern: ruleSetUrl,
              comment: (inlineComment ? inlineComment + ' · ' : '') + `抓取失败，保留引用: ${e?.message || e}`,
            });
            details.push(`RULE-SET [${ruleSetUrl.split('/').pop()}]: 下载失败 (${e?.message || e})，已保留原引用`);
          }
        } else {
          // 不下载或本地路径，直接存为引用规则
          addRuleToGroup(targetGroupId, {
            match_type: 'RULE-SET',
            pattern: ruleSetUrl,
            comment: inlineComment,
          });
          if (isReject) rejectCount++;
          else if (targetGroupId === 'direct') directCount++;
          else if (targetGroupId === 'proxy') proxyCount++;
          else otherCount++;
          details.push(`RULE-SET [${ruleSetUrl}]: 已保存引用至 [${targetGroupId}]`);
        }

        lastComment = '';
        continue;
      }

      // 2. 处理内联规则 (DOMAIN, DOMAIN-SUFFIX, IP-CIDR 等)
      if (['DOMAIN', 'DOMAIN-SUFFIX', 'DOMAIN-KEYWORD', 'IP-CIDR', 'IP-CIDR6', 'GEOIP', 'USER-AGENT', 'URL-REGEX'].includes(typeUpper)) {
        parsedRulesCount++;
        const pattern = tokens[1];
        const rawPolicy = (tokens[2] || 'DIRECT').toUpperCase();
        let targetGroupId = targetOverride || '';

        let isReject = false;
        if (!targetGroupId) {
          if (rawPolicy.startsWith('REJECT')) {
            targetGroupId = 'block';
            isReject = true;
          } else if (rawPolicy === 'DIRECT') {
            targetGroupId = 'direct';
          } else if (rawPolicy === 'PROXY') {
            targetGroupId = 'proxy';
          } else {
            targetGroupId = rawPolicy.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
          }
        } else {
          isReject = targetGroupId === 'block';
        }

        await this.db.ensureGroupExists(targetGroupId, undefined, rawPolicy);

        addRuleToGroup(targetGroupId, {
          match_type: typeUpper,
          pattern,
          comment: inlineComment,
        });

        if (isReject) rejectCount++;
        else if (targetGroupId === 'direct') directCount++;
        else if (targetGroupId === 'proxy') proxyCount++;
        else otherCount++;

        lastComment = '';
        continue;
      }
    }

    // 3. 批量持久化写入数据库
    const groupsUpdated: string[] = [];
    for (const [gid, rules] of groupRulesMap.entries()) {
      if (rules.length > 0) {
        await this.db.appendGroupRules(gid, rules);
        groupsUpdated.push(gid);
      }
    }

    // 4. 刷新 DNS 拦截库与通知 Surge 同步
    await this.reloadDnsBlockCache();
    this.scheduleSurgeSync();

    return {
      totalLines: lines.length,
      parsedRulesCount,
      ruleSetsFetchedCount,
      rejectCount,
      directCount,
      proxyCount,
      otherCount,
      groupsUpdated,
      details,
    };
  }
}
