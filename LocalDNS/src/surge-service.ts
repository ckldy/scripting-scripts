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

function isValidSurgeMitmHost(host: string): boolean {
  if (!host) return false;
  const h = host.startsWith('-') ? host.slice(1).trim() : host.trim();
  if (!h) return false;
  // 排除包含空白、斜杠、冒号、问号等非法字符
  if (/\s|\/|:|\?/.test(h)) return false;
  // Surge 仅支持前缀通配符 *.example.com，不支持通配顶级域（.*）或中间通配符（如 5dy*、nivod*.tv）
  if (h.includes('*')) {
    if (!h.startsWith('*.')) return false;
    if (h.slice(2).includes('*')) return false;
  }
  if (!h.includes('.')) return false;
  if (h.endsWith('.') || h.startsWith('.')) return false;
  return true;
}

function parseSurgeScriptParams(paramsStr: string): {
  type: string;
  pattern: string;
  scriptPath: string;
  requiresBody: boolean;
  maxSize: number;
  binaryBody: boolean;
  engine?: string;
  argument?: string;
} {
  let type = 'http-response';
  let pattern = '';
  let scriptPath = '';
  let requiresBody = false;
  let maxSize = 1048576;
  let binaryBody = false;
  let engine: string | undefined;
  let argument: string | undefined;

  let i = 0;
  const n = paramsStr.length;

  while (i < n) {
    while (i < n && (paramsStr[i] === ' ' || paramsStr[i] === '\t' || paramsStr[i] === ',')) i++;
    if (i >= n) break;

    const kStart = i;
    while (i < n && paramsStr[i] !== '=' && paramsStr[i] !== ',' && paramsStr[i] !== ' ' && paramsStr[i] !== '\t') {
      i++;
    }
    const key = paramsStr.slice(kStart, i).trim().toLowerCase();

    // argument 参数特殊处理：其值是含引号与逗号的 JSON，必须吞掉剩余整行内容
    if (key === 'argument') {
      let rest = paramsStr.slice(i).trim();
      if (rest.startsWith('=')) rest = rest.slice(1).trim();
      const reqIdx = rest.indexOf('#!REQUIREMENT');
      if (reqIdx !== -1) rest = rest.slice(0, reqIdx).trim();
      if (rest.startsWith('"') && rest.endsWith('"') && rest.length >= 2) {
        rest = rest.slice(1, -1);
      } else if (rest.startsWith('"')) {
        rest = rest.slice(1);
      }
      argument = rest.trim();
      i = n;
      break;
    }

    while (i < n && (paramsStr[i] === ' ' || paramsStr[i] === '\t')) i++;

    if (i < n && paramsStr[i] === '=') {
      i++; // skip '='
      while (i < n && (paramsStr[i] === ' ' || paramsStr[i] === '\t')) i++;

      let val = '';
      if (i < n && (paramsStr[i] === '"' || paramsStr[i] === "'")) {
        const quote = paramsStr[i];
        i++; // skip open quote
        const vStart = i;
        while (i < n && paramsStr[i] !== quote) {
          if (paramsStr[i] === '\\' && i + 1 < n) {
            i += 2;
          } else {
            i++;
          }
        }
        val = paramsStr.slice(vStart, i);
        if (i < n && paramsStr[i] === quote) i++; // skip close quote
      } else {
        const vStart = i;
        while (i < n && paramsStr[i] !== ',') {
          i++;
        }
        val = paramsStr.slice(vStart, i).trim();
      }

      if (key === 'type') type = val;
      else if (key === 'pattern') pattern = val;
      else if (key === 'script-path') scriptPath = val;
      else if (key === 'requires-body') requiresBody = val === '1' || val.toLowerCase() === 'true';
      else if (key === 'binary-body-mode') binaryBody = val === '1' || val.toLowerCase() === 'true';
      else if (key === 'engine') engine = val;
      else if (key === 'argument') argument = val;
      else if (key === 'max-size') {
        const parsedSize = parseInt(val, 10);
        if (!isNaN(parsedSize)) maxSize = parsedSize;
      }
    } else {
      if (key === 'requires-body') requiresBody = true;
      if (key === 'binary-body-mode') binaryBody = true;
    }

    while (i < n && (paramsStr[i] === ' ' || paramsStr[i] === '\t')) i++;
    if (i < n && paramsStr[i] === ',') i++;
  }

  return { type, pattern, scriptPath, requiresBody, maxSize, binaryBody, engine, argument };
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
    await this.autoRepairCorruptedRules();
  }

  /**
   * 自动修复历史误截断的损坏规则并重新脱水入库
   */
  public async autoRepairCorruptedRules(): Promise<void> {
    try {
      const dbAny = (this.db as any).getDb();
      const versionRow = (await dbAny.fetchOne('PRAGMA user_version')) as Record<string, any> | null;
      const version = versionRow ? Number(Object.values(versionRow)[0] || 0) : 0;

      if (version < 2) {
        console.log('[SurgeService] Migrating module rules to schema v2 (binary-body / engine / argument), reparsing all modules...');
        await this.reparseAllModules();
        await dbAny.execute('PRAGMA user_version = 2');
      }

      if (version < 3) {
        // 将历史上保留下来的 RULE-SET 远程引用登记为可更新条目
        const refs = (await dbAny.fetchAll(
          "SELECT DISTINCT group_id, pattern FROM diversion_rules WHERE match_type = 'RULE-SET' AND (pattern LIKE 'http://%' OR pattern LIKE 'https://%')"
        )) as Array<{ group_id: string; pattern: string }>;
        for (const r of refs) {
          try {
            await this.db.ensureRemoteRuleSet(r.pattern, r.group_id);
          } catch {}
        }
        await dbAny.execute('PRAGMA user_version = 3');
      }

      if (version < 4) {
        console.log('[SurgeService] Migrating to schema v4 (multi-ownership rule_source_bindings)...');
        await dbAny.execute(`
          CREATE TABLE IF NOT EXISTS rule_source_bindings (
            rule_id INTEGER NOT NULL,
            source_url TEXT NOT NULL,
            created_at INTEGER,
            PRIMARY KEY (rule_id, source_url),
            FOREIGN KEY (rule_id) REFERENCES diversion_rules(id) ON DELETE CASCADE
          );
          CREATE INDEX IF NOT EXISTS idx_rsb_src ON rule_source_bindings(source_url);
          CREATE INDEX IF NOT EXISTS idx_rsb_rule ON rule_source_bindings(rule_id);
        `);

        try {
          await dbAny.execute('ALTER TABLE remote_rule_sets ADD COLUMN name TEXT;');
        } catch {}
        try {
          await dbAny.execute('ALTER TABLE remote_rule_sets ADD COLUMN unique_count INTEGER DEFAULT 0;');
        } catch {}

        const AEGIS_MAP: Array<{ keyword: string; name: string; url: string; group: string }> = [
          { keyword: '网络欺诈拦截', name: '网络欺诈拦截 (Aegis)', url: 'https://raw.githubusercontent.com/Thoseyearsbrian/Aegis/main/rules/Scam_Block.list', group: 'block' },
          { keyword: '成人识别', name: '成人识别拦截 (Aegis)', url: 'https://raw.githubusercontent.com/Thoseyearsbrian/Aegis/main/rules/AdultDomain.list', group: 'block' },
          { keyword: '恶意软件 IOC', name: '恶意软件 IOC 拦截 (Aegis)', url: 'https://raw.githubusercontent.com/Thoseyearsbrian/Aegis/main/rules/Malware_IOC_Block.list', group: 'block' },
          { keyword: 'Pegasus', name: 'Pegasus 间谍软件拦截 (Aegis)', url: 'https://raw.githubusercontent.com/Thoseyearsbrian/Aegis/main/rules/Pegasus_Block.list', group: 'block' },
          { keyword: '广告识别', name: '广告识别 (Aegis)', url: 'https://raw.githubusercontent.com/Thoseyearsbrian/Aegis/main/rules/AdDomain.list', group: 'block' },
          { keyword: '行为分析与遥测', name: '遥测节点识别 (Aegis)', url: 'https://raw.githubusercontent.com/Thoseyearsbrian/Aegis/main/rules/BehaviorDomain.list', group: 'block' },
          { keyword: 'GlobalMedia.list', name: '海外流媒体 (GlobalMedia)', url: 'https://raw.githubusercontent.com/DivineEngine/Profiles/master/Surge/Ruleset/StreamingMedia/Streaming.list', group: 'media' },
          { keyword: '网络钓鱼拦截', name: '网络钓鱼拦截 (Aegis)', url: 'https://raw.githubusercontent.com/Thoseyearsbrian/Aegis/main/rules/Phishing_Block.list', group: 'block' },
          { keyword: '后门控制与植入', name: '后门控制节点拦截 (Aegis)', url: 'https://raw.githubusercontent.com/Thoseyearsbrian/Aegis/main/rules/Backdoor_Block.list', group: 'block' },
          { keyword: 'PCDN', name: 'PCDN 节点识别 (Aegis)', url: 'https://raw.githubusercontent.com/Thoseyearsbrian/Aegis/main/rules/PCDNDomain.list', group: 'block' },
          { keyword: '僵尸网络', name: '僵尸网络控制节点 (Aegis)', url: 'https://raw.githubusercontent.com/Thoseyearsbrian/Aegis/main/rules/Botnet_Block.list', group: 'block' },
          { keyword: '风险通信观察列表', name: '风险通信观察列表 (Aegis)', url: 'https://raw.githubusercontent.com/Thoseyearsbrian/Aegis/main/rules/Quarantine_Block.list', group: 'block' },
        ];

        const now = Date.now();
        for (const m of AEGIS_MAP) {
          await dbAny.execute(
            'INSERT OR REPLACE INTO remote_rule_sets (url, name, group_id, enabled, rule_count, unique_count, last_error, updated_at, created_at) VALUES (?, ?, ?, 1, 0, 0, NULL, ?, ?)',
            [m.url, m.name, m.group, now, now]
          );
          await dbAny.execute(`
            INSERT OR IGNORE INTO rule_source_bindings (rule_id, source_url, created_at)
            SELECT id, '${m.url}', ${now}
            FROM diversion_rules
            WHERE comment LIKE '%${m.keyword}%'
          `);
        }

        await dbAny.execute(`
          INSERT OR IGNORE INTO rule_source_bindings (rule_id, source_url, created_at)
          SELECT id, CASE WHEN is_auto_learned = 1 THEN '__auto_learned__' ELSE '__manual__' END, ${now}
          FROM diversion_rules
          WHERE id NOT IN (SELECT DISTINCT rule_id FROM rule_source_bindings)
        `);

        // 清理无效的 0 条重名记录
        await dbAny.execute("DELETE FROM remote_rule_sets WHERE url = 'https://raw.githubusercontent.com/thoseyearsbrian/aegis/main/rules/addomain.list'");

        await this.db.recalculateRuleSetCounts();
        await dbAny.execute('PRAGMA user_version = 4');
        console.log('[SurgeService] Schema v4 migration completed.');
      }
    } catch (e) {
      console.warn('[SurgeService] Auto repair check error:', e);
    }
  }

  /**
   * 重新解析并脱水全部模块
   */
  public async reparseAllModules(): Promise<void> {
    const modules = await this.db.getModules();
    for (const m of modules) {
      if (m.raw_content) {
        const parsed = this.parseModuleText(m.id, m.raw_content);
        await this.db.saveModuleRules(m.id, parsed.dnsRules, parsed.mitmHosts, parsed.httpRules, parsed.generalSettings);
      }
    }
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

    // 预解析模块默认参数 (#!arguments=k1:v1,k2:v2)，用于填充脚本 argument 中的 {{{key}}} 占位符
    const defaultArgs = new Map<string, string>();
    for (const l of lines) {
      const trimmed = l.trim();
      if (trimmed.startsWith('#!arguments=')) {
        const rawArgs = trimmed.replace('#!arguments=', '').trim();
        for (const pair of rawArgs.split(',')) {
          const parts = pair.split(':');
          const k = parts[0]?.trim();
          const v = parts.slice(1).join(':').trim();
          if (k && v !== undefined) defaultArgs.set(k, v);
        }
      }
    }

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
          const sp = parseSurgeScriptParams(params);

          // 自动填充模块参数占位符 {{{key}}}，防止运行时 JSON Parse 异常
          let resolvedArgument = sp.argument;
          if (resolvedArgument) {
            for (const [k, v] of defaultArgs.entries()) {
              resolvedArgument = resolvedArgument.replace(new RegExp(`\\{\\{\\{${k}\\}\\}\\}`, 'g'), v);
            }
          }

          httpRules.push({
            module_id: moduleId,
            rule_type: 'script',
            sub_type: sp.type || 'http-response',
            pattern: sp.pattern || scriptName,
            target: sp.scriptPath || params,
            requires_body: sp.requiresBody,
            max_size: sp.maxSize,
            binary_body: sp.binaryBody,
            engine: sp.engine,
            argument: resolvedArgument,
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
   * @param baseUrl LocalDNS 服务对外基地址（用于内置脚本 script-path）
   */
  public async compileUnifiedHubModule(baseUrl = 'http://127.0.0.1:9099'): Promise<string> {
    await this.init();
    const mitmHosts = await this.db.getActiveMitmHosts();
    const httpRules = await this.db.getActiveHttpRules();
    const genSettings = await this.db.getActiveGeneralSettings();

    // 内置必需 MITM 域名（YouTube 网页版端点）
    const mitmSet = new Set<string>(mitmHosts);
    mitmSet.add('www.youtube.com');
    mitmSet.add('m.youtube.com');

    const sections: string[] = [
      '#!name=LocalDNS Unified Hub',
      '#!desc=由 LocalDNS 智能中枢自动脱水与动态聚合编译的纯七层调度模块。域名拦截已全部在 LocalDNS 本地秒级阻断，仅向 Surge 注入必要之 MITM 解密与 URL 重写。',
      '#!category=LocalDNS',
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
    const validMitmHosts = Array.from(mitmSet).filter(isValidSurgeMitmHost);
    if (validMitmHosts.length > 0) {
      sections.push('[MITM]');
      // 聚合去重与规范输出，分批每 25 个域名一行，防止单行 13KB+ 超长导致 Surge 解析器缓冲区溢出/截断
      const chunkSize = 25;
      for (let i = 0; i < validMitmHosts.length; i += chunkSize) {
        const chunk = validMitmHosts.slice(i, i + chunkSize);
        sections.push(`hostname = %APPEND% ${chunk.join(', ')}`);
      }
      sections.push('');
    }

    // [URL Rewrite]
    const rewrites = httpRules.filter((r) => r.rule_type === 'rewrite');
    const existingRewritePatterns = new Set(rewrites.map((r) => r.pattern));

    // 内置兜底：YouTube 网页版广告端点（仅按完全相同的 pattern 去重，确保 http / m.youtube.com 也被覆盖）
    const builtinRewrites: Array<[string, string]> = [
      ['^https?://(www|m)[.]youtube[.]com/(pagead|pcs)/', '- reject'],
      ['^https?://(www|m)[.]youtube[.]com/api/stats/ads', '- reject'],
    ];

    if (rewrites.length > 0 || builtinRewrites.length > 0) {
      sections.push('[URL Rewrite]');
      for (const rw of rewrites) {
        sections.push(`${rw.pattern} ${rw.target}`);
      }
      for (const [p, t] of builtinRewrites) {
        if (!existingRewritePatterns.has(p)) sections.push(`${p} ${t}`);
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
        // 关键安全校验：Surge 远程订阅模块中，script-path 必须为 http:// 或 https:// 协议
        // 过滤无法下载的相对路径测试脚本，避免 Surge 安装时报“无效模块/无法下载脚本”
        if (!sc.target || (!sc.target.startsWith('http://') && !sc.target.startsWith('https://'))) {
          continue;
        }

        const scName = `localdns_hub_sc_${idx++}`;
        const parts = [`type=${sc.sub_type}`];
        if (sc.pattern) {
          const cleanPattern = sc.pattern.replace(/^["']|["']$/g, '');
          // 若 pattern 中包含逗号、空格或引号，必须包裹双引号，防止 Surge INI 解析器按逗号分割导致语法损坏
          if (cleanPattern.includes(',') || cleanPattern.includes(' ') || cleanPattern.includes('"')) {
            parts.push(`pattern="${cleanPattern.replace(/"/g, '\\"')}"`);
          } else {
            parts.push(`pattern=${cleanPattern}`);
          }
        }
        parts.push(`script-path=${sc.target}`);
        if (sc.requires_body) parts.push('requires-body=1');
        if (sc.max_size !== undefined) parts.push(`max-size=${sc.max_size}`);
        if (sc.binary_body) parts.push('binary-body-mode=1');
        if (sc.engine) parts.push(`engine=${sc.engine}`);
        if (sc.argument) {
          const rawArg = sc.argument.trim();
          const inner = rawArg.startsWith('"') && rawArg.endsWith('"') && rawArg.length >= 2
            ? rawArg.slice(1, -1)
            : rawArg;
          parts.push(`argument="${inner}"`);
        }
        sections.push(`${scName} = ${parts.join(',')}`);
      }

      // 内置：YouTube 网页版 JSON 广告清理脚本（LocalDNS 本地托管，不依赖 GitHub）
      const builtinYtPattern = '^https?://(www|m)[.]youtube[.]com/youtubei/v1/(?:player|next|browse|search|guide|reel/reel_watch_sequence)(?:[?].*)?$';
      const hasBuiltinYt = scripts.some((s) => (s.target || '').includes('/scripts/youtube-web.js'));
      if (!hasBuiltinYt) {
        sections.push(
          `localdns_builtin_yt_web = type=http-response,pattern="${builtinYtPattern}",script-path=${baseUrl}/scripts/youtube-web.js,requires-body=1,max-size=2097152,engine=jsc`
        );
      }
      sections.push('');
    }

    // 兜底注入：确保内置 YouTube 网页版去广告脚本始终存在
    if (!sections.some((s) => s.includes('localdns_builtin_yt_web'))) {
      const builtinLine = 'localdns_builtin_yt_web = type=http-response,pattern=^https?://(www|m)[.]youtube[.]com/youtubei/v1/(?:player|next|browse|search|guide|reel/reel_watch_sequence)(?:[?].*)?$,script-path=' + baseUrl + '/scripts/youtube-web.js,requires-body=1,max-size=2097152,engine=jsc';
      const lastScIdx = sections.map((s, i) => (s.startsWith('localdns_hub_sc_') ? i : -1)).filter((i) => i >= 0).pop();
      if (lastScIdx !== undefined) {
        sections.splice(lastScIdx + 1, 0, builtinLine);
      } else {
        const tailIdx = sections.lastIndexOf('');
        if (tailIdx >= 0) sections.splice(tailIdx, 0, '[Script]', builtinLine);
        else sections.push('[Script]', builtinLine);
      }
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
      'User-Agent': 'LocalDNS/FJMOS',
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
          headers: { 'User-Agent': 'LocalDNS/FJMOS (Surge-Hub)' },
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
        'User-Agent': 'LocalDNS/FJMOS',
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
    mode: 'append' | 'replace' = 'append',
    name?: string
  ): Promise<{ importedCount: number; finalUrl: string }> {
    await this.init();
    const { text, finalUrl } = await this.fetchRemoteText(url);
    const rules = this.parseRulesList(text);
    let count = 0;
    if (mode === 'replace') {
      count = await this.db.replaceGroupRules(groupId, rules);
    } else {
      count = await this.db.appendGroupRules(groupId, rules, finalUrl || url);
    }
    const finalName = name || (url.split('/').pop() || '远程规则集');
    await this.db.upsertRemoteRuleSet(finalUrl || url, groupId, count, null, finalName);
    this.scheduleSurgeSync();
    return { importedCount: count, finalUrl };
  }

  /**
   * 安全删除远程规则集：仅清除独占特有规则，保留重合共有规则与手动规则
   */
  public async safeDeleteRemoteRuleSet(url: string): Promise<{ deletedUnique: number; preservedShared: number }> {
    await this.init();
    const res = await this.db.safeDeleteRemoteRuleSet(url);
    await this.reloadDnsBlockCache();
    this.scheduleSurgeSync();
    return res;
  }

  /**
   * 切换外部规则集启用/关闭状态：
   * 开启则该集合内规则生效，关闭则集合内独占规则在数据库及运行态中同时置为不生效
   */
  public async setRemoteRuleSetEnabled(
    url: string,
    enabled: boolean
  ): Promise<{ affectedRules: number; enabledCount: number }> {
    await this.init();
    const res = await this.db.setRemoteRuleSetEnabled(url, enabled);
    await this.reloadDnsBlockCache();
    this.scheduleSurgeSync();
    return res;
  }

  /**
   * 从远程源重新下载并脱水单个模块（保留名称/分类/启用状态）
   */
  public async refreshModule(id: string): Promise<{ updated: boolean; rules: number; error?: string }> {
    const mod = await this.db.getModule(id);
    if (!mod) return { updated: false, rules: 0, error: '模块不存在' };
    if (!mod.source_url) return { updated: false, rules: 0, error: '本地模块无远程更新源' };
    try {
      const { text, finalUrl } = await this.fetchRemoteText(mod.source_url);
      const parsed = this.parseModuleText(id, text);
      const moduleObj: AppModule = {
        ...mod,
        source_url: finalUrl || mod.source_url,
        raw_content: text,
        updated_at: Date.now(),
      };
      await this.db.saveModule(moduleObj);
      await this.db.saveModuleRules(id, parsed.dnsRules, parsed.mitmHosts, parsed.httpRules, parsed.generalSettings);
      await this.reloadDnsBlockCache();
      this.scheduleSurgeSync();
      return { updated: true, rules: parsed.httpRules.length + parsed.dnsRules.length };
    } catch (e: any) {
      return { updated: false, rules: 0, error: String(e?.message || e) };
    }
  }

  /**
   * 一键更新全部远程订阅模块
   */
  public async refreshAllModules(): Promise<{
    total: number;
    updated: number;
    skipped: number;
    results: Array<{ id: string; name: string; updated: boolean; error?: string }>;
  }> {
    await this.init();
    const modules = await this.db.getModules();
    const results: Array<{ id: string; name: string; updated: boolean; error?: string }> = [];
    let updated = 0;
    let skipped = 0;
    for (const m of modules) {
      if (!m.source_url) {
        skipped++;
        continue;
      }
      const r = await this.refreshModule(m.id);
      if (r.updated) updated++;
      results.push({ id: m.id, name: m.name, updated: r.updated, error: r.error });
    }
    return { total: modules.length, updated, skipped, results };
  }

  /**
   * 刷新已登记的远程分流规则集（解除旧绑定，重拉写入新规则并清理孤儿规则）
   */
  public async refreshRemoteRuleSets(targetUrl?: string): Promise<{
    total: number;
    updated: number;
    details: Array<{ url: string; group: string; count: number; error?: string }>;
  }> {
    await this.init();
    const allSets = await this.db.listRemoteRuleSets();
    const sets = targetUrl ? allSets.filter(s => s.url === targetUrl) : allSets;
    const details: Array<{ url: string; group: string; count: number; error?: string }> = [];
    let updated = 0;
    const dbAny = (this.db as any).getDb();

    for (const s of sets) {
      try {
        const { text } = await this.fetchRemoteText(s.url);
        const rules = this.parseRulesList(text);
        // 1. 解除该来源在绑定表中的全部旧关联
        await dbAny.execute('DELETE FROM rule_source_bindings WHERE source_url = ?', [s.url]);
        // 2. 重新写入新规则并绑定
        const count = await this.db.appendGroupRules(s.group_id, rules, s.url);
        // 3. 级联清理上游废弃后失去全部引用的孤儿规则
        await dbAny.execute(`
          DELETE FROM diversion_rules
          WHERE id NOT IN (SELECT DISTINCT rule_id FROM rule_source_bindings)
            AND is_auto_learned = 0
        `);
        await this.db.recalculateRuleSetCounts(s.url);
        if (!s.enabled) {
          await this.db.setRemoteRuleSetEnabled(s.url, false);
        }
        updated++;
        details.push({ url: s.url, group: s.group_id, count });
      } catch (e: any) {
        await this.db.upsertRemoteRuleSet(s.url, s.group_id, s.rule_count, String(e?.message || e), s.name || undefined);
        details.push({ url: s.url, group: s.group_id, count: 0, error: String(e?.message || e) });
      }
    }
    await this.reloadDnsBlockCache();
    this.scheduleSurgeSync();
    return { total: sets.length, updated, details };
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

    const groupRulesMap = new Map<string, Array<{ match_type: any; pattern: string; comment?: string; sourceUrl?: string }>>();
    const details: string[] = [];
    let lastComment = '';

    const addRuleToGroup = (groupId: string, rule: { match_type: any; pattern: string; comment?: string; sourceUrl?: string }) => {
      if (!groupRulesMap.has(groupId)) {
        groupRulesMap.set(groupId, []);
      }
      groupRulesMap.get(groupId)!.push(rule);
    };

    const SURGE_OPTIONS = new Set(['NO-RESOLVE', 'EXTENDED-MATCHING', 'PRE-MATCHING', 'AUTO']);
    const extractPolicy = (tokens: string[]): string => {
      for (let i = 2; i < tokens.length; i++) {
        const cleanTok = tokens[i].replace(/[^\w-]/g, '').trim();
        if (cleanTok && !SURGE_OPTIONS.has(cleanTok.toUpperCase())) {
          return cleanTok;
        }
      }
      return 'DIRECT';
    };

    const cleanPattern = (type: string, rawPat: string) => {
      let p = rawPat.trim();
      let t = type.toUpperCase();
      // 剥离端口号，例如 *.gyks.cf:443 -> *.gyks.cf
      if (/:\d+$/.test(p)) {
        p = p.replace(/:\d+$/, '');
      }
      // 通配符处理：例如 *.gyks.cf -> gyks.cf, 转换为 DOMAIN-SUFFIX
      if (p.startsWith('*.')) {
        p = p.slice(2);
        if (t === 'DOMAIN') t = 'DOMAIN-SUFFIX';
      } else if (p.startsWith('.')) {
        p = p.slice(1);
        if (t === 'DOMAIN') t = 'DOMAIN-SUFFIX';
      }
      return { type: t, pattern: p.toLowerCase() };
    };

    // 收集全部需要远程抓取的任务进行并发处理
    interface RemoteTask {
      targetGroupId: string;
      url: string;
      comment: string;
      isReject: boolean;
    }
    const remoteTasks: RemoteTask[] = [];

    for (let rawLine of lines) {
      let line = rawLine.trim();
      if (!line) continue;

      // 捕获前导注释
      if (line.startsWith('#') || line.startsWith(';') || line.startsWith('//')) {
        lastComment = line.replace(/^[#;/\s>]+/, '').trim();
        continue;
      }

      // 剥离行尾注释：支持 # 与 //，同时避开 http:// 与 https:// 中的 //
      let inlineComment = lastComment;
      const hashIdx = line.indexOf('#');
      if (hashIdx !== -1) {
        const afterHash = line.slice(hashIdx + 1).trim();
        if (afterHash) inlineComment = afterHash;
        line = line.slice(0, hashIdx).trim();
      }
      const slashMatch = line.match(/(^|[^:])\/\/(.*)$/);
      if (slashMatch && slashMatch.index !== undefined) {
        const cutAt = slashMatch.index + slashMatch[1].length;
        const afterSlash = line.slice(cutAt + 2).trim();
        if (afterSlash) inlineComment = afterSlash;
        line = line.slice(0, cutAt).trim();
      }

      const tokens = line.split(',').map((t) => t.trim());
      if (tokens.length < 2) {
        // 纯域名兼容
        if (line.includes('.') && !line.includes(' ')) {
          const gid = targetOverride || 'direct';
          const cp = cleanPattern('DOMAIN-SUFFIX', line);
          addRuleToGroup(gid, { match_type: cp.type, pattern: cp.pattern, comment: inlineComment });
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
        const rawPolicy = extractPolicy(tokens);
        const policyUpper = rawPolicy.toUpperCase();
        let targetGroupId = targetOverride || '';

        let isReject = false;
        if (!targetGroupId) {
          if (policyUpper.startsWith('REJECT')) {
            targetGroupId = 'block';
            isReject = true;
          } else if (policyUpper === 'DIRECT') {
            targetGroupId = 'direct';
          } else if (policyUpper === 'PROXY') {
            targetGroupId = 'proxy';
          } else {
            // 自定义策略名（如 Media, HK-Node 等）
            targetGroupId = policyUpper.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
          }
        } else {
          isReject = targetGroupId === 'block';
        }

        // 确保目标分组存在
        await this.db.ensureGroupExists(targetGroupId, undefined, policyUpper);

        if (downloadRuleSets && (ruleSetUrl.startsWith('http://') || ruleSetUrl.startsWith('https://'))) {
          remoteTasks.push({ targetGroupId, url: ruleSetUrl, comment: inlineComment, isReject });
        } else {
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
        const rawPolicy = extractPolicy(tokens);
        const policyUpper = rawPolicy.toUpperCase();
        let targetGroupId = targetOverride || '';

        let isReject = false;
        if (!targetGroupId) {
          if (policyUpper.startsWith('REJECT')) {
            targetGroupId = 'block';
            isReject = true;
          } else if (policyUpper === 'DIRECT') {
            targetGroupId = 'direct';
          } else if (policyUpper === 'PROXY') {
            targetGroupId = 'proxy';
          } else {
            targetGroupId = policyUpper.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
          }
        } else {
          isReject = targetGroupId === 'block';
        }

        await this.db.ensureGroupExists(targetGroupId, undefined, policyUpper);

        const cp = cleanPattern(typeUpper, tokens[1]);
        addRuleToGroup(targetGroupId, {
          match_type: cp.type,
          pattern: cp.pattern,
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

    // 并发抓取远程规则集（6 并发线程池，性能最大化）
    if (remoteTasks.length > 0) {
      const concurrency = 6;
      let taskIdx = 0;
      const worker = async () => {
        while (taskIdx < remoteTasks.length) {
          const t = remoteTasks[taskIdx++];
          try {
            const { text: remoteContent } = await this.fetchRemoteText(t.url);
            const extracted = this.parseRulesList(remoteContent);
            ruleSetsFetchedCount++;

            for (const r of extracted) {
              const cp = cleanPattern(r.match_type, r.pattern);
              addRuleToGroup(t.targetGroupId, {
                match_type: cp.type,
                pattern: cp.pattern,
                comment: r.comment || t.comment || `来自 ${t.url.split('/').pop()}`,
                sourceUrl: t.url,
              });
            }
            await this.db.upsertRemoteRuleSet(t.url, t.targetGroupId, extracted.length);

            if (t.isReject) {
              rejectCount += extracted.length;
            } else if (t.targetGroupId === 'direct') {
              directCount += extracted.length;
            } else if (t.targetGroupId === 'proxy') {
              proxyCount += extracted.length;
            } else {
              otherCount += extracted.length;
            }

            details.push(`RULE-SET [${t.url.split('/').pop()}]: 成功抓取并展开 ${extracted.length} 条规则至 [${t.targetGroupId}]`);
          } catch (e: any) {
            addRuleToGroup(t.targetGroupId, {
              match_type: 'RULE-SET',
              pattern: t.url,
              comment: (t.comment ? t.comment + ' · ' : '') + `抓取失败，保留引用: ${e?.message || e}`,
            });
            await this.db.upsertRemoteRuleSet(t.url, t.targetGroupId, 0, String(e?.message || e));
            details.push(`RULE-SET [${t.url.split('/').pop()}]: 下载失败 (${e?.message || e})，已保留原引用`);
          }
        }
      };

      const workers = new Array(Math.min(concurrency, remoteTasks.length)).fill(0).map(() => worker());
      await Promise.all(workers);
    }

    // 3. 批量持久化写入数据库（按来源 URL 分组写入，便于后续单独刷新）
    const groupsUpdated: string[] = [];
    for (const [gid, rules] of groupRulesMap.entries()) {
      if (rules.length > 0) {
        const bySource = new Map<string, Array<{ match_type: any; pattern: string; comment?: string }>>();
        for (const r of rules) {
          const key = r.sourceUrl || '';
          if (!bySource.has(key)) bySource.set(key, []);
          bySource.get(key)!.push({ match_type: r.match_type, pattern: r.pattern, comment: r.comment });
        }
        for (const [src, list] of bySource.entries()) {
          await this.db.appendGroupRules(gid, list, src || undefined);
        }
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

  /**
   * 按照 Surge 标准格式，自动生成完整的 Surge 配置文件 (.conf)
   * 支持通过 URL 在线订阅导入、一键调起安装或直接下载导入
   */
  public async generateSurgeConfig(options?: {
    host?: string;
    mode?: 'ruleset' | 'inline';
    apiKey?: string;
    customProxyNode?: string;
  }): Promise<string> {
    await this.init();
    const host = options?.host || '127.0.0.1:9053';
    const mode = options?.mode || 'ruleset';
    const cfg = await this.db.getSurgeConfig();
    const apiKey = options?.apiKey || cfg.api_key || 'localdnskey';

    const groups = await this.db.getDiversionGroups();
    const activeGroups = groups.filter((g) => g.enabled);

    // 收集所有用到的出站策略名
    const customPolicies = new Set<string>();
    const isBuiltinPolicy = (p: string) => {
      const u = p.toUpperCase();
      return u === 'DIRECT' || u.startsWith('REJECT');
    };

    for (const g of activeGroups) {
      if (!isBuiltinPolicy(g.surge_policy)) {
        customPolicies.add(g.surge_policy);
      }
    }

    const lines: string[] = [
      '#!name=LocalDNS',
      '#!desc=由 LocalDNS 自动生成的 Surge 完整配置文件。集成本地 DNS 纳秒拦截、App 模块脱水、动态分流治理与 HTTP API 自动化自愈调度。',
      '#!author=LocalDNS',
      '',
      '[General]',
      '# --- LocalDNS 专属智能解析与基础接管 ---',
      'dns-server = 223.5.5.5, 119.29.29.29',
      '# 加密 DNS：将全机 DNS 交由 LocalDNS（需安装并信任 LocalDNS Root CA）',
      'doh-server = https://127.0.0.1:9443/dns-query',
      'read-etc-hosts = true',
      'loglevel = notify',
      'bypass-tun = 192.168.0.0/16, 10.0.0.0/8, 172.16.0.0/12',
      'skip-proxy = 127.0.0.1, 192.168.0.0/16, 10.0.0.0/8, 172.16.0.0/12, localhost, *.local, captive.apple.com',
      'always-real-ip = *.srv.nintendo.net, *.stun.playstation.net, xbox.*.microsoft.com, *.msftncsi.com',
      '',
      '# --- 连通性测速与容错 ---',
      'test-timeout = 5',
      'internet-test-url = http://connectivitycheck.platform.hicloud.com/generate_204',
      'proxy-test-url = http://cp.cloudflare.com/generate_204',
      'show-error-page-for-reject = true',
      '# 拦截 QUIC (UDP 443)，强迫客户端走 TCP HTTP/2 以便解密去广告',
      'block-quic = true',
      '',
      '# --- HTTP API 控制通道（LocalDNS 与 Surge 实时联动与拓扑自愈核心） ---',
      `http-api = ${apiKey}@0.0.0.0:6171`,
      'http-api-tls = false',
      'http-api-web-dashboard = false',
      '',
      '[Replica]',
      'hide-apple-request = 1',
      'hide-crash-reporter-request = 1',
      'hide-udp = 0',
      'keyword-filter-type = false',
      '',
      '[Proxy]',
      '# 基础内置节点',
      'DIRECT = direct',
      '# 示范代理节点（可替换为自己的真实代理节点或订阅导入）',
      options?.customProxyNode || 'PROXY_DEMO = ss, 1.2.3.4, 443, encrypt-method=chacha20-ietf-poly1305, password=password',
      '',
      '[Proxy Group]',
      '# 核心出站策略组',
      'PROXY = select, PROXY_DEMO, DIRECT',
      'Auto-Select = url-test, PROXY_DEMO, url=http://cp.cloudflare.com/generate_204, interval=300, tolerance=50',
      'Fallback = fallback, PROXY_DEMO, url=http://cp.cloudflare.com/generate_204, interval=300',
    ];

    // 添加其他分流组中用到的自定义策略组
    for (const pol of customPolicies) {
      if (pol !== 'PROXY' && pol !== 'Auto-Select' && pol !== 'Fallback') {
        lines.push(`${pol} = select, PROXY, DIRECT`);
      }
    }

    lines.push('', '[Rule]');
    lines.push('# 拦截 QUIC (UDP 443)，迫使 YouTube 等流媒体回退 TCP 以便解密与脚本去广告');
    lines.push('AND,((PROTOCOL,UDP),(DEST-PORT,443)),REJECT-NO-DROP');
    lines.push('');
    lines.push('# LocalDNS 动态广告黑洞拦截集（最高优先级，必须置于规则最顶部）');
    lines.push(`RULE-SET,http://${host}/rules/block.list,REJECT`);
    lines.push('');
    lines.push('# LocalDNS 运行环境与局域网保护（避免回环）');
    lines.push('IP-CIDR,127.0.0.0/8,DIRECT,no-resolve');
    lines.push('IP-CIDR,192.168.0.0/16,DIRECT,no-resolve');
    lines.push('IP-CIDR,10.0.0.0/8,DIRECT,no-resolve');
    lines.push('IP-CIDR,172.16.0.0/12,DIRECT,no-resolve');
    lines.push('');

    if (mode === 'inline') {
      lines.push('# LocalDNS 全量规则内联展开模式');
      for (const g of activeGroups) {
        const rules = await this.db.getActiveRulesByGroup(g.id);
        if (rules.length > 0) {
          lines.push(`\n# --- 分流组: ${g.name} (${g.id}) ---`);
          for (const r of rules) {
            const comment = r.comment ? ` // ${r.comment}` : '';
            lines.push(`${r.match_type},${r.pattern},${g.surge_policy}${comment}`);
          }
        }
      }
    } else {
      lines.push('# LocalDNS 动态分流托管规则集（零重启热更新）');
      for (const g of activeGroups) {
        const subUrl = `http://${host}/rules/${g.id}.list`;
        const countInfo = g.rule_count !== undefined ? ` · ${g.rule_count} 条` : '';
        lines.push(`# ${g.name} (${g.id}${countInfo})`);
        lines.push(`RULE-SET,${subUrl},${g.surge_policy}`);
      }
    }

    lines.push('');
    lines.push('# 兜底规则');
    lines.push('GEOIP,CN,DIRECT');
    lines.push('FINAL,PROXY,dns-failed');
    lines.push('');

    lines.push('[Host]');
    lines.push('localdns.local = 127.0.0.1');
    lines.push('');

    lines.push('# --- LocalDNS 统一脱水调度模块引用提示 ---');
    lines.push(`# 推荐在 Surge 中直接添加模块: http://${host}/surge/hub.sgmodule`);
    lines.push('# （所有 App 模块的七层解密重写已提纯聚合在该单一模块中，广告拦截已下沉至 LocalDNS 秒阻）');

    return lines.join('\n');
  }
}
