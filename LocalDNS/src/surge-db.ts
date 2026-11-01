/**
 * src/surge-db.ts
 *
 * LocalDNS × Surge 联动系统 SQLite 数据库持久化层
 * 托管 App 模块资产、七层重写/脚本、分流规则组、动态自愈学习以及拓扑链路
 */

import { Path, Script } from 'scripting';

export interface ModuleArgumentItem {
  key: string;
  defaultValue: string;
}

export interface AppModule {
  id: string;
  name: string;
  category: 'app' | 'media' | 'system' | 'privacy';
  source_url: string | null;
  enabled: boolean;
  raw_content?: string | null;
  arguments_schema?: ModuleArgumentItem[];
  arguments_desc?: string | null;
  custom_arguments?: Record<string, string>;
  created_at: number;
  updated_at: number;
}

export interface DnsRule {
  id?: number;
  module_id: string;
  type: 'DOMAIN' | 'DOMAIN-SUFFIX' | 'DOMAIN-KEYWORD' | 'IP-CIDR';
  pattern: string;
  action: 'REJECT' | 'REJECT-200' | 'REJECT-DROP' | 'DIRECT';
  enabled: boolean;
}

export interface HttpRule {
  id?: number;
  module_id: string;
  rule_type: 'rewrite' | 'header' | 'script' | 'map-local' | 'body-rewrite' | 'rule';
  sub_type: string;
  pattern: string;
  target: string;
  script_name?: string;
  requires_body: boolean;
  max_size: number;
  binary_body?: boolean;
  engine?: string;
  argument?: string;
  timeout?: number;
  enabled: boolean;
}

export interface GeneralSetting {
  id?: number;
  module_id: string;
  key: string;
  operator: '=' | '%APPEND%' | '%INSERT%';
  value: string;
}

export interface DiversionGroup {
  id: string;
  name: string;
  surge_policy: string;
  enabled: boolean;
  priority: number;
  description: string | null;
  rule_count?: number;
}

export interface RemoteRuleSet {
  url: string;
  name?: string | null;
  group_id: string;
  enabled: boolean;
  rule_count: number;
  unique_count: number;
  last_error: string | null;
  updated_at: number;
  created_at?: number;
}

export interface DiversionRule {
  id?: number;
  group_id: string;
  match_type: 'DOMAIN' | 'DOMAIN-SUFFIX' | 'DOMAIN-KEYWORD' | 'IP-CIDR' | 'GEOIP' | 'RULE-SET' | string;
  pattern: string;
  enabled: boolean;
  comment?: string | null;
  is_auto_learned: boolean;
  hit_count?: number;
  last_hit_at?: number | null;
  source_url?: string | null;
  sources?: string[];
  is_unique?: boolean;
}

export interface SurgeConfig {
  api_url: string;
  api_key: string;
  enabled: boolean;
  auto_switch_on_timeout: boolean;
  auto_learn_unreachable: boolean;
  sync_ruleset: boolean;
  kill_blocked_active: boolean;
  last_sync_at: number | null;
  last_sync_status: string | null;
}

export interface TopologyLink {
  id?: number;
  domain: string;
  client_ip: string;
  cached: boolean;
  diversion_group: string;
  upstream_node: string;
  surge_outbound: string;
  surge_policy: string;
  duration_ms: number;
  is_self_healed: boolean;
  timestamp: number;
}

export class SurgeDatabase {
  private static instance: SurgeDatabase;
  private db: SQLite.Database | null = null;
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  public static get(): SurgeDatabase {
    if (!SurgeDatabase.instance) {
      SurgeDatabase.instance = new SurgeDatabase();
    }
    return SurgeDatabase.instance;
  }

  private constructor() {}

  private getDb(): SQLite.Database {
    if (!this.db) throw new Error('SurgeDatabase is not initialized');
    return this.db;
  }

  public async init(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      const appGroup = (FileManager as any).appGroupDocumentsDirectory;
      const baseDir = appGroup ? Path.join(appGroup, 'LocalDNS') : Script.directory;
      try {
        if (!(await FileManager.exists(baseDir))) {
          await FileManager.createDirectory(baseDir, true);
        }
      } catch (e) {
        console.warn('Failed to ensure directory for SQLite:', e);
      }

      const dbPath = Path.join(baseDir, 'surge_link.db');
      this.db = SQLite.open(dbPath);
      try {
        await this.db.execute('PRAGMA busy_timeout = 5000;');
      } catch (e) {
        console.warn('Failed to set busy_timeout for SQLite:', e);
      }

      await this.createTables();
      try {
        await this.db.execute('ALTER TABLE module_http_rules ADD COLUMN binary_body INTEGER DEFAULT 0;');
      } catch {}
      try {
        await this.db.execute('ALTER TABLE module_http_rules ADD COLUMN engine TEXT;');
      } catch {}
      try {
        await this.db.execute('ALTER TABLE module_http_rules ADD COLUMN argument TEXT;');
      } catch {}
      try {
        await this.db.execute('ALTER TABLE module_http_rules ADD COLUMN timeout INTEGER;');
      } catch {}
      try {
        await this.db.execute('ALTER TABLE module_http_rules ADD COLUMN script_name TEXT;');
      } catch {}
      try {
        await this.db.execute('ALTER TABLE diversion_rules ADD COLUMN source_url TEXT;');
      } catch {}
      try {
        await this.db.execute('ALTER TABLE app_modules ADD COLUMN arguments_schema TEXT;');
      } catch {}
      try {
        await this.db.execute('ALTER TABLE app_modules ADD COLUMN arguments_desc TEXT;');
      } catch {}
      try {
        await this.db.execute('ALTER TABLE app_modules ADD COLUMN custom_arguments TEXT;');
      } catch {}
      try {
        await this.db.execute('ALTER TABLE remote_rule_sets ADD COLUMN name TEXT;');
      } catch {}
      try {
        await this.db.execute('ALTER TABLE remote_rule_sets ADD COLUMN unique_count INTEGER DEFAULT 0;');
      } catch {}
      try {
        await this.db.execute('ALTER TABLE remote_rule_sets ADD COLUMN enabled INTEGER DEFAULT 1;');
      } catch {}
      try {
        await this.db.execute('UPDATE remote_rule_sets SET enabled = 1 WHERE enabled IS NULL;');
      } catch {}
      await this.seedDefaults();
      this.initialized = true;
    })();

    return this.initPromise;
  }

  private async createTables(): Promise<void> {
    await this.getDb().execute(`
      CREATE TABLE IF NOT EXISTS app_modules (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        category TEXT DEFAULT 'app',
        source_url TEXT,
        enabled INTEGER DEFAULT 1,
        raw_content TEXT,
        created_at INTEGER,
        updated_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS module_dns_rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        module_id TEXT NOT NULL,
        type TEXT NOT NULL,
        pattern TEXT NOT NULL,
        action TEXT DEFAULT 'REJECT',
        enabled INTEGER DEFAULT 1,
        FOREIGN KEY(module_id) REFERENCES app_modules(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_mod_dns ON module_dns_rules(module_id, pattern);

      CREATE TABLE IF NOT EXISTS module_mitm_hosts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        module_id TEXT NOT NULL,
        hostname TEXT NOT NULL,
        enabled INTEGER DEFAULT 1,
        FOREIGN KEY(module_id) REFERENCES app_modules(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_mod_mitm ON module_mitm_hosts(module_id, hostname);

      CREATE TABLE IF NOT EXISTS module_http_rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        module_id TEXT NOT NULL,
        rule_type TEXT NOT NULL,
        sub_type TEXT NOT NULL,
        pattern TEXT NOT NULL,
        target TEXT NOT NULL,
        requires_body INTEGER DEFAULT 0,
        max_size INTEGER DEFAULT 1048576,
        binary_body INTEGER DEFAULT 0,
        engine TEXT,
        argument TEXT,
        enabled INTEGER DEFAULT 1,
        FOREIGN KEY(module_id) REFERENCES app_modules(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS module_general_settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        module_id TEXT NOT NULL,
        key TEXT NOT NULL,
        operator TEXT DEFAULT '=',
        value TEXT NOT NULL,
        FOREIGN KEY(module_id) REFERENCES app_modules(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS diversion_groups (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        surge_policy TEXT NOT NULL,
        enabled INTEGER DEFAULT 1,
        priority INTEGER DEFAULT 0,
        description TEXT
      );

      CREATE TABLE IF NOT EXISTS diversion_rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        group_id TEXT NOT NULL,
        match_type TEXT NOT NULL,
        pattern TEXT NOT NULL,
        enabled INTEGER DEFAULT 1,
        comment TEXT,
        is_auto_learned INTEGER DEFAULT 0,
        hit_count INTEGER DEFAULT 0,
        last_hit_at INTEGER,
        source_url TEXT,
        FOREIGN KEY(group_id) REFERENCES diversion_groups(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_div_rules ON diversion_rules(group_id, pattern);

      CREATE TABLE IF NOT EXISTS remote_rule_sets (
        url TEXT PRIMARY KEY,
        name TEXT,
        group_id TEXT NOT NULL,
        enabled INTEGER DEFAULT 1,
        rule_count INTEGER DEFAULT 0,
        unique_count INTEGER DEFAULT 0,
        last_error TEXT,
        updated_at INTEGER,
        created_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS rule_source_bindings (
        rule_id INTEGER NOT NULL,
        source_url TEXT NOT NULL,
        created_at INTEGER,
        PRIMARY KEY (rule_id, source_url),
        FOREIGN KEY (rule_id) REFERENCES diversion_rules(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_rsb_src ON rule_source_bindings(source_url);
      CREATE INDEX IF NOT EXISTS idx_rsb_rule ON rule_source_bindings(rule_id);

      CREATE TABLE IF NOT EXISTS surge_config (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        api_url TEXT DEFAULT 'http://127.0.0.1:6171',
        api_key TEXT DEFAULT '',
        enabled INTEGER DEFAULT 0,
        auto_switch_on_timeout INTEGER DEFAULT 1,
        auto_learn_unreachable INTEGER DEFAULT 1,
        sync_ruleset INTEGER DEFAULT 1,
        kill_blocked_active INTEGER DEFAULT 1,
        last_sync_at INTEGER,
        last_sync_status TEXT
      );

      CREATE TABLE IF NOT EXISTS topology_links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        domain TEXT NOT NULL,
        client_ip TEXT NOT NULL,
        cached INTEGER DEFAULT 0,
        diversion_group TEXT NOT NULL,
        upstream_node TEXT NOT NULL,
        surge_outbound TEXT NOT NULL,
        surge_policy TEXT NOT NULL,
        duration_ms REAL DEFAULT 0,
        is_self_healed INTEGER DEFAULT 0,
        timestamp INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_topo_ts ON topology_links(timestamp);
    `);
  }

  private async seedDefaults(): Promise<void> {
    // 检查是否有配置记录
    const cfg = await this.getDb().fetchOne('SELECT id FROM surge_config WHERE id = 1');
    if (!cfg) {
      await this.getDb().execute(`
        INSERT INTO surge_config (id, api_url, api_key, enabled, auto_switch_on_timeout, auto_learn_unreachable, sync_ruleset, kill_blocked_active)
        VALUES (1, 'http://127.0.0.1:6171', '', 0, 1, 1, 1, 1)
      `);
    }

    // 确保 6 大默认分流组完整存在
    const defaultGroups: DiversionGroup[] = [
      { id: 'block', name: '广告与黑洞拦截', surge_policy: 'REJECT', enabled: true, priority: 5, description: '恶意广告、隐私追踪与黑洞化域名，直接返回 0.0.0.0' },
      { id: 'direct', name: '国内直连', surge_policy: 'DIRECT', enabled: true, priority: 10, description: '大陆主流服务、CDN 与局域网流量' },
      { id: 'proxy', name: '节点代理', surge_policy: 'PROXY', enabled: true, priority: 20, description: '被阻断或需要代理加速的境外服务' },
      { id: 'media', name: '海外流媒体', surge_policy: 'PROXY', enabled: true, priority: 30, description: 'YouTube, Netflix, Spotify, Disney+ 等流媒体' },
      { id: 'game', name: '游戏加速', surge_policy: 'DIRECT', enabled: true, priority: 40, description: 'Steam, PSN, Xbox, Nintendo 等游戏下载' },
      { id: 'apple', name: 'Apple服务', surge_policy: 'DIRECT', enabled: true, priority: 50, description: 'Apple 官方推送、App Store 与 iCloud' },
    ];
    for (const g of defaultGroups) {
      const exist = await this.getDb().fetchOne<any>('SELECT id FROM diversion_groups WHERE id = ?', [g.id]);
      if (!exist) {
        await this.getDb().execute(
          'INSERT INTO diversion_groups (id, name, surge_policy, enabled, priority, description) VALUES (?, ?, ?, ?, ?, ?)',
          [g.id, g.name, g.surge_policy, g.enabled ? 1 : 0, g.priority, g.description]
        );
      }
    }

    // 清理之前测试误生成的异常临时分组
    await this.getDb().execute("DELETE FROM diversion_groups WHERE id LIKE 'direct%geoip%'");
    await this.getDb().execute("DELETE FROM diversion_rules WHERE group_id LIKE 'direct%geoip%'");

    // 默认分流规则种子 (若无规则时填充基础规则)
    const ruleCount = await this.getDb().fetchOne<{ count: number }>('SELECT count(*) as count FROM diversion_rules');
    if (ruleCount && ruleCount.count === 0) {
      const defaultRules: Array<{ group: string; type: DiversionRule['match_type']; pattern: string; comment: string }> = [
        { group: 'block', type: 'DOMAIN-SUFFIX', pattern: 'adservice.google.com', comment: 'Google 广告' },
        { group: 'block', type: 'DOMAIN-KEYWORD', pattern: 'telemetry', comment: '遥测打点' },
        { group: 'direct', type: 'DOMAIN-SUFFIX', pattern: 'cn', comment: '国内顶级域名' },
        { group: 'direct', type: 'DOMAIN-SUFFIX', pattern: 'baidu.com', comment: '百度直连' },
        { group: 'direct', type: 'DOMAIN-SUFFIX', pattern: 'qq.com', comment: '腾讯服务' },
        { group: 'direct', type: 'DOMAIN-SUFFIX', pattern: 'aliyun.com', comment: '阿里云' },
        { group: 'direct', type: 'DOMAIN-KEYWORD', pattern: 'bilibili', comment: '哔哩哔哩' },
        { group: 'proxy', type: 'DOMAIN-SUFFIX', pattern: 'github.com', comment: 'GitHub' },
        { group: 'proxy', type: 'DOMAIN-SUFFIX', pattern: 'google.com', comment: 'Google 核心' },
        { group: 'proxy', type: 'DOMAIN-SUFFIX', pattern: 'twitter.com', comment: 'X / Twitter' },
        { group: 'proxy', type: 'DOMAIN-SUFFIX', pattern: 'x.com', comment: 'X' },
        { group: 'media', type: 'DOMAIN-SUFFIX', pattern: 'youtube.com', comment: 'YouTube 视频' },
        { group: 'media', type: 'DOMAIN-SUFFIX', pattern: 'googlevideo.com', comment: 'YouTube 媒体流' },
        { group: 'media', type: 'DOMAIN-SUFFIX', pattern: 'netflix.com', comment: 'Netflix' },
        { group: 'media', type: 'DOMAIN-SUFFIX', pattern: 'spotify.com', comment: 'Spotify 音乐' },
        { group: 'apple', type: 'DOMAIN-SUFFIX', pattern: 'apple.com', comment: 'Apple 核心' },
        { group: 'apple', type: 'DOMAIN-SUFFIX', pattern: 'icloud.com', comment: 'iCloud 同步' },
        { group: 'apple', type: 'DOMAIN-SUFFIX', pattern: 'mzstatic.com', comment: 'Apple 静态资源' },
      ];
      for (const r of defaultRules) {
        await this.getDb().execute(
          'INSERT INTO diversion_rules (group_id, match_type, pattern, enabled, comment, is_auto_learned) VALUES (?, ?, ?, 1, ?, 0)',
          [r.group, r.type, r.pattern, r.comment]
        );
      }
    }
  }

  // ==================== App Modules ====================

  public async getModules(): Promise<AppModule[]> {
    await this.init();
    const rows = await this.getDb().fetchAll<any>('SELECT * FROM app_modules ORDER BY updated_at DESC');
    return rows.map((r: any) => {
      let schema: ModuleArgumentItem[] | undefined;
      let customArgs: Record<string, string> | undefined;
      try {
        if (r.arguments_schema) schema = JSON.parse(r.arguments_schema);
      } catch {}
      try {
        if (r.custom_arguments) customArgs = JSON.parse(r.custom_arguments);
      } catch {}

      return {
        id: r.id,
        name: r.name,
        category: r.category,
        source_url: r.source_url,
        enabled: Boolean(r.enabled),
        raw_content: r.raw_content,
        arguments_schema: schema,
        arguments_desc: r.arguments_desc,
        custom_arguments: customArgs,
        created_at: r.created_at,
        updated_at: r.updated_at,
      };
    });
  }

  public async getModule(id: string): Promise<AppModule | null> {
    await this.init();
    const r = await this.getDb().fetchOne<any>('SELECT * FROM app_modules WHERE id = ?', [id]);
    if (!r) return null;
    let schema: ModuleArgumentItem[] | undefined;
    let customArgs: Record<string, string> | undefined;
    try {
      if (r.arguments_schema) schema = JSON.parse(r.arguments_schema);
    } catch {}
    try {
      if (r.custom_arguments) customArgs = JSON.parse(r.custom_arguments);
    } catch {}

    return {
      id: r.id,
      name: r.name,
      category: r.category,
      source_url: r.source_url,
      enabled: Boolean(r.enabled),
      raw_content: r.raw_content,
      arguments_schema: schema,
      arguments_desc: r.arguments_desc,
      custom_arguments: customArgs,
      created_at: r.created_at,
      updated_at: r.updated_at,
    };
  }

  public async saveModule(module: AppModule): Promise<void> {
    await this.init();
    const now = Date.now();
    const schemaStr = module.arguments_schema ? JSON.stringify(module.arguments_schema) : null;
    const customArgsStr = module.custom_arguments ? JSON.stringify(module.custom_arguments) : null;

    await this.getDb().execute(
      `INSERT OR REPLACE INTO app_modules (id, name, category, source_url, enabled, raw_content, arguments_schema, arguments_desc, custom_arguments, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT created_at FROM app_modules WHERE id = ?), ?), ?)`,
      [
        module.id,
        module.name,
        module.category,
        module.source_url,
        module.enabled ? 1 : 0,
        module.raw_content || null,
        schemaStr,
        module.arguments_desc || null,
        customArgsStr,
        module.id,
        now,
        now,
      ]
    );
  }

  public async saveModuleCustomArguments(id: string, customArguments: Record<string, string>): Promise<void> {
    await this.init();
    await this.getDb().execute(
      'UPDATE app_modules SET custom_arguments = ?, updated_at = ? WHERE id = ?',
      [JSON.stringify(customArguments), Date.now(), id]
    );
  }

  public async setModuleEnabled(id: string, enabled: boolean): Promise<void> {
    await this.init();
    await this.getDb().execute('UPDATE app_modules SET enabled = ?, updated_at = ? WHERE id = ?', [enabled ? 1 : 0, Date.now(), id]);
  }

  public async deleteModule(id: string): Promise<void> {
    await this.init();
    await this.getDb().execute('DELETE FROM app_modules WHERE id = ?', [id]);
  }

  // ==================== Module Rules & Assets ====================

  public async saveModuleRules(
    moduleId: string,
    dnsRules: DnsRule[],
    mitmHosts: string[],
    httpRules: HttpRule[],
    generalSettings: GeneralSetting[]
  ): Promise<void> {
    await this.init();
    // 事务替换
    await this.getDb().execute('DELETE FROM module_dns_rules WHERE module_id = ?', [moduleId]);
    await this.getDb().execute('DELETE FROM module_mitm_hosts WHERE module_id = ?', [moduleId]);
    await this.getDb().execute('DELETE FROM module_http_rules WHERE module_id = ?', [moduleId]);
    await this.getDb().execute('DELETE FROM module_general_settings WHERE module_id = ?', [moduleId]);

    for (const r of dnsRules) {
      await this.getDb().execute(
        'INSERT INTO module_dns_rules (module_id, type, pattern, action, enabled) VALUES (?, ?, ?, ?, ?)',
        [moduleId, r.type, r.pattern, r.action, r.enabled !== false ? 1 : 0]
      );
    }
    for (const host of mitmHosts) {
      const h = host.trim();
      if (h) {
        await this.getDb().execute('INSERT INTO module_mitm_hosts (module_id, hostname, enabled) VALUES (?, ?, 1)', [moduleId, h]);
      }
    }
    for (const hr of httpRules) {
      await this.getDb().execute(
        `INSERT INTO module_http_rules (module_id, rule_type, sub_type, pattern, target, script_name, requires_body, max_size, binary_body, engine, argument, timeout, enabled)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          moduleId,
          hr.rule_type,
          hr.sub_type,
          hr.pattern,
          hr.target,
          hr.script_name || null,
          hr.requires_body ? 1 : 0,
          hr.max_size !== undefined ? hr.max_size : 1048576,
          hr.binary_body ? 1 : 0,
          hr.engine || null,
          hr.argument || null,
          hr.timeout !== undefined ? hr.timeout : null,
          hr.enabled !== false ? 1 : 0,
        ]
      );
    }
    for (const gs of generalSettings) {
      await this.getDb().execute(
        'INSERT INTO module_general_settings (module_id, key, operator, value) VALUES (?, ?, ?, ?)',
        [moduleId, gs.key, gs.operator || '=', gs.value]
      );
    }
  }

  public async getActiveMitmHosts(): Promise<string[]> {
    await this.init();
    const rows = await this.getDb().fetchAll<{ hostname: string }>(`
      SELECT DISTINCT m.hostname
      FROM module_mitm_hosts m
      JOIN app_modules a ON m.module_id = a.id
      WHERE a.enabled = 1 AND m.enabled = 1
      ORDER BY m.hostname ASC
    `);
    return rows.map((r) => r.hostname);
  }

  public async getActiveHttpRules(): Promise<HttpRule[]> {
    await this.init();
    const rows = await this.getDb().fetchAll<any>(`
      SELECT r.*
      FROM module_http_rules r
      JOIN app_modules a ON r.module_id = a.id
      WHERE a.enabled = 1 AND r.enabled = 1
      ORDER BY r.id ASC
    `);
    return rows.map((r: any) => ({
      id: r.id,
      module_id: r.module_id,
      rule_type: r.rule_type,
      sub_type: r.sub_type,
      pattern: r.pattern,
      target: r.target,
      script_name: r.script_name || undefined,
      requires_body: Boolean(r.requires_body),
      max_size: r.max_size,
      binary_body: Boolean(r.binary_body),
      engine: r.engine || undefined,
      argument: r.argument || undefined,
      timeout: r.timeout !== null && r.timeout !== undefined ? Number(r.timeout) : undefined,
      enabled: Boolean(r.enabled),
    }));
  }

  public async getActiveGeneralSettings(): Promise<GeneralSetting[]> {
    await this.init();
    const rows = await this.getDb().fetchAll<any>(`
      SELECT g.*
      FROM module_general_settings g
      JOIN app_modules a ON g.module_id = a.id
      WHERE a.enabled = 1
      ORDER BY g.id ASC
    `);
    return rows.map((r: any) => ({
      id: r.id,
      module_id: r.module_id,
      key: r.key,
      operator: r.operator,
      value: r.value,
    }));
  }

  public async getActiveDnsBlockRules(): Promise<DnsRule[]> {
    await this.init();
    // 聚合 module_dns_rules (REJECT) 与 diversion_rules (group_id = 'block')
    const modRows = await this.getDb().fetchAll<any>(`
      SELECT d.id, d.module_id, d.type, d.pattern, d.action, d.enabled
      FROM module_dns_rules d
      JOIN app_modules a ON d.module_id = a.id
      WHERE a.enabled = 1 AND d.enabled = 1 AND d.action LIKE 'REJECT%'
    `);
    const divRows = await this.getDb().fetchAll<any>(`
      SELECT r.id, 'diversion_block' as module_id, r.match_type as type, r.pattern, 'REJECT' as action, r.enabled
      FROM diversion_rules r
      JOIN diversion_groups g ON r.group_id = g.id
      WHERE (g.id = 'block' OR g.surge_policy LIKE 'REJECT%') AND g.enabled = 1 AND r.enabled = 1
    `);
    const all = [...modRows, ...divRows];
    return all.map((r: any) => ({
      id: r.id,
      module_id: r.module_id,
      type: r.type,
      pattern: r.pattern,
      action: r.action,
      enabled: Boolean(r.enabled),
    }));
  }

  // ==================== Diversion Groups & Rules ====================

  public async getDiversionGroups(): Promise<DiversionGroup[]> {
    await this.init();
    const rows = await this.getDb().fetchAll<any>(`
      SELECT g.*, COUNT(r.id) as rule_count
      FROM diversion_groups g
      LEFT JOIN diversion_rules r ON g.id = r.group_id
      GROUP BY g.id
      ORDER BY g.priority ASC, g.id ASC
    `);
    return rows.map((r: any) => ({
      id: r.id,
      name: r.name,
      surge_policy: r.surge_policy,
      enabled: Boolean(r.enabled),
      priority: r.priority,
      description: r.description,
      rule_count: Number(r.rule_count || 0),
    }));
  }

  public async getDiversionGroup(id: string): Promise<DiversionGroup | null> {
    await this.init();
    const r = await this.getDb().fetchOne<any>(`
      SELECT g.*, COUNT(r.id) as rule_count
      FROM diversion_groups g
      LEFT JOIN diversion_rules r ON g.id = r.group_id
      WHERE g.id = ?
      GROUP BY g.id
    `, [id]);
    if (!r) return null;
    return {
      id: r.id,
      name: r.name,
      surge_policy: r.surge_policy,
      enabled: Boolean(r.enabled),
      priority: r.priority,
      description: r.description,
      rule_count: Number(r.rule_count || 0),
    };
  }

  public async ensureGroupExists(groupId: string, name?: string, policy?: string): Promise<DiversionGroup> {
    await this.init();
    const existing = await this.getDiversionGroup(groupId);
    if (existing) return existing;

    const finalPolicy = policy || (groupId === 'block' ? 'REJECT' : (groupId === 'direct' ? 'DIRECT' : 'PROXY'));
    const finalName = name || (groupId === 'block' ? '广告与黑洞拦截' : (groupId === 'direct' ? '国内直连' : (groupId === 'proxy' ? '节点代理' : groupId)));
    const newGroup: DiversionGroup = {
      id: groupId,
      name: finalName,
      surge_policy: finalPolicy,
      enabled: true,
      priority: groupId === 'block' ? 5 : 50,
      description: `由规则导入自动创建 (${finalPolicy})`,
    };
    await this.saveDiversionGroup(newGroup);
    return newGroup;
  }

  public async saveDiversionGroup(group: DiversionGroup): Promise<void> {
    await this.init();
    await this.getDb().execute(
      `INSERT OR REPLACE INTO diversion_groups (id, name, surge_policy, enabled, priority, description)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [group.id, group.name, group.surge_policy, group.enabled ? 1 : 0, group.priority || 0, group.description || null]
    );
  }

  public async setDiversionGroupEnabled(id: string, enabled: boolean): Promise<void> {
    await this.init();
    await this.getDb().execute('UPDATE diversion_groups SET enabled = ? WHERE id = ?', [enabled ? 1 : 0, id]);
  }

  public async deleteDiversionGroup(id: string): Promise<void> {
    await this.init();
    await this.getDb().execute('DELETE FROM diversion_groups WHERE id = ?', [id]);
  }

  public async getDiversionRule(id: number): Promise<DiversionRule | null> {
    await this.init();
    const r = await this.getDb().fetchOne<any>('SELECT * FROM diversion_rules WHERE id = ?', [id]);
    if (!r) return null;
    return {
      id: r.id,
      group_id: r.group_id,
      match_type: r.match_type,
      pattern: r.pattern,
      enabled: Boolean(r.enabled),
      comment: r.comment,
      is_auto_learned: Boolean(r.is_auto_learned),
      hit_count: r.hit_count,
      last_hit_at: r.last_hit_at,
    };
  }

  public async getDiversionRulesPaged(options: {
    groupId?: string;
    search?: string;
    matchType?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ total: number; rules: DiversionRule[] }> {
    await this.init();
    const whereParts: string[] = [];
    const params: any[] = [];

    if (options.groupId) {
      whereParts.push('group_id = ?');
      params.push(options.groupId);
    }
    if (options.matchType && options.matchType !== 'ALL') {
      whereParts.push('match_type = ?');
      params.push(options.matchType);
    }
    if (options.search && options.search.trim()) {
      const q = `%${options.search.trim().toLowerCase()}%`;
      whereParts.push("(LOWER(pattern) LIKE ? OR LOWER(COALESCE(comment, '')) LIKE ?)");
      params.push(q, q);
    }

    const whereSql = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : '';

    const countRow = await this.getDb().fetchOne<{ total: number }>(
      `SELECT COUNT(*) as total FROM diversion_rules ${whereSql}`,
      params
    );
    const total = countRow ? Number(countRow.total) : 0;

    const limit = Math.max(1, Math.min(500, options.limit || 50));
    const offset = Math.max(0, options.offset || 0);

    const rows = await this.getDb().fetchAll<any>(
      `SELECT * FROM diversion_rules ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const ruleIds = rows.map((r: any) => r.id);
    const sourceMap = new Map<number, string[]>();
    if (ruleIds.length > 0) {
      try {
        const idList = ruleIds.join(',');
        const bindingRows = await this.getDb().fetchAll<any>(
          `SELECT rule_id, source_url FROM rule_source_bindings WHERE rule_id IN (${idList})`
        );
        for (const b of bindingRows) {
          const rid = Number(b.rule_id);
          if (!sourceMap.has(rid)) sourceMap.set(rid, []);
          sourceMap.get(rid)!.push(b.source_url);
        }
      } catch {}
    }

    const rules: DiversionRule[] = rows.map((r: any) => {
      const srcList = sourceMap.get(r.id) || (r.source_url ? [r.source_url] : ['__manual__']);
      const isUnique = srcList.length === 1 && !srcList.includes('__manual__') && !srcList.includes('__auto_learned__');
      return {
        id: r.id,
        group_id: r.group_id,
        match_type: r.match_type,
        pattern: r.pattern,
        enabled: Boolean(r.enabled),
        comment: r.comment,
        is_auto_learned: Boolean(r.is_auto_learned),
        hit_count: r.hit_count,
        last_hit_at: r.last_hit_at,
        source_url: r.source_url,
        sources: srcList,
        is_unique: isUnique,
      };
    });

    return { total, rules };
  }

  public async getDiversionRules(groupId?: string): Promise<DiversionRule[]> {
    await this.init();
    let sql = 'SELECT * FROM diversion_rules';
    const params: any[] = [];
    if (groupId) {
      sql += ' WHERE group_id = ?';
      params.push(groupId);
    }
    sql += ' ORDER BY id DESC';
    const rows = await this.getDb().fetchAll<any>(sql, params);
    return rows.map((r: any) => ({
      id: r.id,
      group_id: r.group_id,
      match_type: r.match_type,
      pattern: r.pattern,
      enabled: Boolean(r.enabled),
      comment: r.comment,
      is_auto_learned: Boolean(r.is_auto_learned),
      hit_count: r.hit_count,
      last_hit_at: r.last_hit_at,
    }));
  }

  public async saveDiversionRule(rule: DiversionRule): Promise<number> {
    await this.init();
    if (rule.id) {
      await this.getDb().execute(
        `UPDATE diversion_rules
         SET group_id = ?, match_type = ?, pattern = ?, enabled = ?, comment = ?
         WHERE id = ?`,
        [rule.group_id, rule.match_type, rule.pattern, rule.enabled ? 1 : 0, rule.comment || null, rule.id]
      );
      return rule.id;
    } else {
      await this.getDb().execute(
        `INSERT INTO diversion_rules (group_id, match_type, pattern, enabled, comment, is_auto_learned)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [rule.group_id, rule.match_type, rule.pattern, rule.enabled ? 1 : 0, rule.comment || null, rule.is_auto_learned ? 1 : 0]
      );
      const last = await this.getDb().fetchOne<{ id: number }>('SELECT last_insert_rowid() as id');
      return last ? last.id : 0;
    }
  }

  public async setDiversionRuleEnabled(id: number, enabled: boolean): Promise<void> {
    await this.init();
    await this.getDb().execute('UPDATE diversion_rules SET enabled = ? WHERE id = ?', [enabled ? 1 : 0, id]);
  }

  public async deleteDiversionRule(id: number): Promise<void> {
    await this.init();
    await this.getDb().execute('DELETE FROM diversion_rules WHERE id = ?', [id]);
  }

  public async getActiveRulesByGroup(groupId: string): Promise<DiversionRule[]> {
    await this.init();
    const rows = await this.getDb().fetchAll<any>(`
      SELECT r.*
      FROM diversion_rules r
      JOIN diversion_groups g ON r.group_id = g.id
      WHERE g.id = ? AND g.enabled = 1 AND r.enabled = 1
      ORDER BY r.id ASC
    `, [groupId]);
    return rows.map((r: any) => ({
      id: r.id,
      group_id: r.group_id,
      match_type: r.match_type,
      pattern: r.pattern,
      enabled: Boolean(r.enabled),
      comment: r.comment,
      is_auto_learned: Boolean(r.is_auto_learned),
      hit_count: r.hit_count,
      last_hit_at: r.last_hit_at,
    }));
  }

  public async replaceGroupRules(
    groupId: string,
    rules: Array<{ match_type: DiversionRule['match_type']; pattern: string; comment?: string }>
  ): Promise<number> {
    await this.init();
    await this.getDb().execute('DELETE FROM diversion_rules WHERE group_id = ?', [groupId]);
    if (!rules || rules.length === 0) return 0;

    const seen = new Set<string>();
    const toInsert: Array<{ match_type: string; pattern: string; comment: string | null }> = [];
    for (const r of rules) {
      const p = String(r.pattern || '').trim().toLowerCase();
      if (!p || seen.has(p)) continue;
      seen.add(p);
      toInsert.push({
        match_type: r.match_type || 'DOMAIN-SUFFIX',
        pattern: p,
        comment: r.comment || null,
      });
    }

    const batchSize = 2000;
    for (let i = 0; i < toInsert.length; i += batchSize) {
      const chunk = toInsert.slice(i, i + batchSize);
      const steps: SQLite.TransactionStep[] = chunk.map((item) => ({
        sql: 'INSERT INTO diversion_rules (group_id, match_type, pattern, enabled, comment, is_auto_learned) VALUES (?, ?, ?, 1, ?, 0)',
        args: [groupId, item.match_type, item.pattern, item.comment],
      }));
      await this.getDb().transaction(steps);
    }
    return toInsert.length;
  }

  public async appendGroupRules(
    groupId: string,
    rules: Array<{ match_type: DiversionRule['match_type']; pattern: string; comment?: string }>,
    sourceUrl?: string
  ): Promise<number> {
    await this.init();
    if (!rules || rules.length === 0) return 0;
    const finalSource = sourceUrl || '__manual__';
    const now = Date.now();

    // 查出该组已存在的所有 pattern 映射其 ID
    const existingRows = await this.getDb().fetchAll<{ id: number; pattern: string }>(
      'SELECT id, pattern FROM diversion_rules WHERE group_id = ?',
      [groupId]
    );
    const patternToId = new Map<string, number>();
    for (const r of existingRows) patternToId.set(r.pattern.toLowerCase(), r.id);

    const toInsertRules: Array<{ match_type: string; pattern: string; comment: string | null }> = [];
    const bindingSteps: Array<{ rule_id: number; source_url: string }> = [];

    for (const r of rules) {
      const p = String(r.pattern || '').trim().toLowerCase();
      if (!p) continue;
      const existingId = patternToId.get(p);
      if (existingId !== undefined) {
        // 重合共有项：不重复插入底表，但记录对该来源的绑定
        bindingSteps.push({ rule_id: existingId, source_url: finalSource });
      } else {
        // 新规则：插入底表
        toInsertRules.push({
          match_type: r.match_type || 'DOMAIN-SUFFIX',
          pattern: p,
          comment: r.comment || null,
        });
      }
    }

    // 1. 批量插入新规则
    if (toInsertRules.length > 0) {
      const batchSize = 1000;
      for (let i = 0; i < toInsertRules.length; i += batchSize) {
        const chunk = toInsertRules.slice(i, i + batchSize);
        const steps: SQLite.TransactionStep[] = chunk.map((item) => ({
          sql: 'INSERT INTO diversion_rules (group_id, match_type, pattern, enabled, comment, is_auto_learned, source_url) VALUES (?, ?, ?, 1, ?, 0, ?)',
          args: [groupId, item.match_type, item.pattern, item.comment, finalSource],
        }));
        await this.getDb().transaction(steps);
      }

      // 重新查出新插入的规则 ID 并建立绑定
      const newRows = await this.getDb().fetchAll<{ id: number; pattern: string }>(
        'SELECT id, pattern FROM diversion_rules WHERE group_id = ? AND source_url = ?',
        [groupId, finalSource]
      );
      for (const nr of newRows) {
        bindingSteps.push({ rule_id: nr.id, source_url: finalSource });
      }
    }

    // 2. 批量写入绑定关系
    if (bindingSteps.length > 0) {
      const bSize = 1500;
      for (let i = 0; i < bindingSteps.length; i += bSize) {
        const chunk = bindingSteps.slice(i, i + bSize);
        const steps: SQLite.TransactionStep[] = chunk.map((b) => ({
          sql: 'INSERT OR IGNORE INTO rule_source_bindings (rule_id, source_url, created_at) VALUES (?, ?, ?)',
          args: [b.rule_id, b.source_url, now],
        }));
        await this.getDb().transaction(steps);
      }
    }

    if (sourceUrl) {
      await this.recalculateRuleSetCounts(sourceUrl);
    }
    return toInsertRules.length + bindingSteps.length;
  }

  // ==================== 远程规则集登记与刷新 ====================

  public async upsertRemoteRuleSet(url: string, groupId: string, ruleCount: number, lastError?: string | null, name?: string): Promise<void> {
    await this.init();
    const now = Date.now();
    const existing = await this.getDb().fetchOne<any>('SELECT url, name FROM remote_rule_sets WHERE url = ?', [url]);
    const finalName = name || existing?.name || (url.split('/').pop() || '远程规则集');
    if (existing) {
      await this.getDb().execute(
        'UPDATE remote_rule_sets SET group_id = ?, name = ?, rule_count = ?, last_error = ?, updated_at = ? WHERE url = ?',
        [groupId, finalName, ruleCount, lastError || null, now, url]
      );
    } else {
      await this.getDb().execute(
        'INSERT INTO remote_rule_sets (url, name, group_id, enabled, rule_count, unique_count, last_error, updated_at, created_at) VALUES (?, ?, ?, 1, ?, 0, ?, ?, ?)',
        [url, finalName, groupId, ruleCount, lastError || null, now, now]
      );
    }
  }

  public async recalculateRuleSetCounts(targetUrl?: string): Promise<void> {
    await this.init();
    const sets = targetUrl
      ? [{ url: targetUrl }]
      : await this.getDb().fetchAll<any>('SELECT url FROM remote_rule_sets');

    for (const s of sets) {
      const u = s.url;
      const totalRow = await this.getDb().fetchOne<any>(
        'SELECT count(*) as c FROM rule_source_bindings WHERE source_url = ?',
        [u]
      );
      const totalCount = Number(totalRow?.c || 0);

      const uniqueRow = await this.getDb().fetchOne<any>(
        `SELECT count(*) as c
         FROM rule_source_bindings b1
         WHERE b1.source_url = ?
           AND NOT EXISTS (
             SELECT 1 FROM rule_source_bindings b2
             WHERE b2.rule_id = b1.rule_id AND b2.source_url != b1.source_url
           )`,
        [u]
      );
      const uniqueCount = Number(uniqueRow?.c || 0);

      await this.getDb().execute(
        'UPDATE remote_rule_sets SET rule_count = ?, unique_count = ? WHERE url = ?',
        [totalCount, uniqueCount, u]
      );
    }
  }

  public async safeDeleteRemoteRuleSet(url: string): Promise<{ deletedUnique: number; preservedShared: number }> {
    await this.init();
    const totalRow = await this.getDb().fetchOne<any>(
      'SELECT count(*) as c FROM rule_source_bindings WHERE source_url = ?',
      [url]
    );
    const totalCount = Number(totalRow?.c || 0);

    const uniqueRow = await this.getDb().fetchOne<any>(
      `SELECT count(*) as c
       FROM rule_source_bindings b1
       WHERE b1.source_url = ?
         AND NOT EXISTS (
           SELECT 1 FROM rule_source_bindings b2
           WHERE b2.rule_id = b1.rule_id AND b2.source_url != b1.source_url
         )`,
      [url]
    );
    const uniqueCount = Number(uniqueRow?.c || 0);
    const preservedShared = Math.max(0, totalCount - uniqueCount);

    // 1. 解除该规则集的所有来源绑定
    await this.getDb().execute('DELETE FROM rule_source_bindings WHERE source_url = ?', [url]);

    // 2. 级联清理孤儿规则（完全失去任何来源绑定的特有规则，绝不伤及手动规则或自愈规则）
    await this.getDb().execute(`
      DELETE FROM diversion_rules
      WHERE id NOT IN (SELECT DISTINCT rule_id FROM rule_source_bindings)
        AND is_auto_learned = 0
    `);

    // 3. 删除登记表记录
    await this.getDb().execute('DELETE FROM remote_rule_sets WHERE url = ?', [url]);

    // 4. 重新计算其余规则集的统计
    await this.recalculateRuleSetCounts();

    return { deletedUnique: uniqueCount, preservedShared };
  }

  public async listRemoteRuleSets(): Promise<RemoteRuleSet[]> {
    await this.init();
    const rows = await this.getDb().fetchAll<any>('SELECT * FROM remote_rule_sets ORDER BY rule_count DESC, updated_at DESC');
    return rows.map((r: any) => ({
      url: r.url,
      name: r.name || (r.url.split('/').pop() || '远程规则集'),
      group_id: r.group_id,
      enabled: r.enabled !== 0 && r.enabled !== false && r.enabled !== null,
      rule_count: Number(r.rule_count || 0),
      unique_count: Number(r.unique_count || 0),
      last_error: r.last_error || null,
      updated_at: Number(r.updated_at || 0),
      created_at: Number(r.created_at || 0),
    }));
  }

  public async setRemoteRuleSetEnabled(
    url: string,
    enabled: boolean
  ): Promise<{ affectedRules: number; enabledCount: number }> {
    await this.init();
    const db = this.getDb();
    const enVal = enabled ? 1 : 0;

    // 1. 更新 remote_rule_sets 表的 enabled 字段
    await db.execute('UPDATE remote_rule_sets SET enabled = ? WHERE url = ?', [enVal, url]);

    // 2. 同步更新 diversion_rules 表中的 enabled 状态
    let affectedRules = 0;
    if (enabled) {
      // 开启：所有属于该规则集的规则全部恢复生效
      const res = await db.execute(
        `UPDATE diversion_rules
         SET enabled = 1
         WHERE id IN (
           SELECT rule_id
           FROM rule_source_bindings
           WHERE source_url = ?
         )`,
        [url]
      );
      affectedRules = (res as any)?.changes || 0;
    } else {
      // 关闭：凡是绑定了该规则集，且没有其他有效来源（无其他已开启规则集，且非手动 __manual__、非自愈 __auto_learned__）的规则，置为不生效
      const res = await db.execute(
        `UPDATE diversion_rules
         SET enabled = 0
         WHERE id IN (
           SELECT b.rule_id
           FROM rule_source_bindings b
           WHERE b.source_url = ?
         )
         AND NOT EXISTS (
           SELECT 1
           FROM rule_source_bindings b2
           WHERE b2.rule_id = diversion_rules.id
             AND (
               b2.source_url = '__manual__'
               OR b2.source_url = '__auto_learned__'
               OR b2.source_url IN (SELECT url FROM remote_rule_sets WHERE enabled = 1)
             )
         )
         AND is_auto_learned = 0`,
        [url]
      );
      affectedRules = (res as any)?.changes || 0;
    }

    const countRow = await db.fetchOne<any>(
      `SELECT count(*) as c
       FROM diversion_rules
       WHERE id IN (SELECT rule_id FROM rule_source_bindings WHERE source_url = ?)
         AND enabled = 1`,
      [url]
    );
    const enabledCount = Number(countRow?.c || 0);

    return { affectedRules, enabledCount };
  }

  public async ensureRemoteRuleSet(url: string, groupId: string, name?: string): Promise<void> {
    await this.init();
    const finalName = name || (url.split('/').pop() || '远程规则集');
    await this.getDb().execute(
      'INSERT OR IGNORE INTO remote_rule_sets (url, name, group_id, enabled, rule_count, unique_count, updated_at, created_at) VALUES (?, ?, ?, 1, 0, 0, ?, ?)',
      [url, finalName, groupId, Date.now(), Date.now()]
    );
  }

  public async deleteRulesBySource(url: string): Promise<number> {
    const res = await this.safeDeleteRemoteRuleSet(url);
    return res.deletedUnique;
  }

  public async recordRuleHit(id: number): Promise<void> {
    await this.init();
    await this.getDb().execute(
      'UPDATE diversion_rules SET hit_count = hit_count + 1, last_hit_at = ? WHERE id = ?',
      [Date.now(), id]
    );
  }

  public async autoLearnUnreachable(pattern: string, comment = '动态测速自愈升阶'): Promise<void> {
    await this.init();
    const existing = await this.getDb().fetchOne<any>(
      'SELECT id, group_id FROM diversion_rules WHERE pattern = ?',
      [pattern]
    );
    if (existing) {
      // 若原先在 direct 组，自动升阶至 proxy
      if (existing.group_id !== 'proxy') {
        await this.getDb().execute(
          'UPDATE diversion_rules SET group_id = ?, is_auto_learned = 1, comment = ?, enabled = 1 WHERE id = ?',
          ['proxy', comment, existing.id]
        );
      }
    } else {
      await this.getDb().execute(
        'INSERT INTO diversion_rules (group_id, match_type, pattern, enabled, comment, is_auto_learned) VALUES ("proxy", "DOMAIN-SUFFIX", ?, 1, ?, 1)',
        [pattern, comment]
      );
    }
  }

  // ==================== Surge Config ====================

  public async getSurgeConfig(): Promise<SurgeConfig> {
    await this.init();
    const r = await this.getDb().fetchOne<any>('SELECT * FROM surge_config WHERE id = 1');
    return {
      api_url: r?.api_url || 'http://127.0.0.1:6171',
      api_key: r?.api_key || '',
      enabled: Boolean(r?.enabled),
      auto_switch_on_timeout: Boolean(r?.auto_switch_on_timeout),
      auto_learn_unreachable: Boolean(r?.auto_learn_unreachable),
      sync_ruleset: Boolean(r?.sync_ruleset),
      kill_blocked_active: Boolean(r?.kill_blocked_active),
      last_sync_at: r?.last_sync_at || null,
      last_sync_status: r?.last_sync_status || null,
    };
  }

  public async saveSurgeConfig(config: Partial<SurgeConfig>): Promise<SurgeConfig> {
    await this.init();
    const curr = await this.getSurgeConfig();
    const next: SurgeConfig = {
      api_url: config.api_url !== undefined ? config.api_url : curr.api_url,
      api_key: config.api_key !== undefined ? config.api_key : curr.api_key,
      enabled: config.enabled !== undefined ? config.enabled : curr.enabled,
      auto_switch_on_timeout: config.auto_switch_on_timeout !== undefined ? config.auto_switch_on_timeout : curr.auto_switch_on_timeout,
      auto_learn_unreachable: config.auto_learn_unreachable !== undefined ? config.auto_learn_unreachable : curr.auto_learn_unreachable,
      sync_ruleset: config.sync_ruleset !== undefined ? config.sync_ruleset : curr.sync_ruleset,
      kill_blocked_active: config.kill_blocked_active !== undefined ? config.kill_blocked_active : curr.kill_blocked_active,
      last_sync_at: config.last_sync_at !== undefined ? config.last_sync_at : curr.last_sync_at,
      last_sync_status: config.last_sync_status !== undefined ? config.last_sync_status : curr.last_sync_status,
    };
    await this.getDb().execute(
      `UPDATE surge_config
       SET api_url = ?, api_key = ?, enabled = ?, auto_switch_on_timeout = ?, auto_learn_unreachable = ?, sync_ruleset = ?, kill_blocked_active = ?, last_sync_at = ?, last_sync_status = ?
       WHERE id = 1`,
      [
        next.api_url,
        next.api_key,
        next.enabled ? 1 : 0,
        next.auto_switch_on_timeout ? 1 : 0,
        next.auto_learn_unreachable ? 1 : 0,
        next.sync_ruleset ? 1 : 0,
        next.kill_blocked_active ? 1 : 0,
        next.last_sync_at,
        next.last_sync_status,
      ]
    );
    return next;
  }

  // ==================== Topology Links ====================

  public async recordTopologyLink(link: Omit<TopologyLink, 'id' | 'timestamp'>): Promise<void> {
    await this.init();
    await this.getDb().execute(
      `INSERT INTO topology_links (domain, client_ip, cached, diversion_group, upstream_node, surge_outbound, surge_policy, duration_ms, is_self_healed, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        link.domain,
        link.client_ip,
        link.cached ? 1 : 0,
        link.diversion_group,
        link.upstream_node,
        link.surge_outbound,
        link.surge_policy,
        link.duration_ms || 0,
        link.is_self_healed ? 1 : 0,
        Date.now(),
      ]
    );

    // 定期保留最新 1000 条，防止表无限膨胀
    if (Math.random() < 0.05) {
      await this.getDb().execute(
        'DELETE FROM topology_links WHERE id NOT IN (SELECT id FROM topology_links ORDER BY id DESC LIMIT 1000)'
      );
    }
  }

  public async getRecentTopologyLinks(limit = 100): Promise<TopologyLink[]> {
    await this.init();
    const rows = await this.getDb().fetchAll<any>(
      'SELECT * FROM topology_links ORDER BY id DESC LIMIT ?',
      [limit]
    );
    return rows.map((r: any) => ({
      id: r.id,
      domain: r.domain,
      client_ip: r.client_ip,
      cached: Boolean(r.cached),
      diversion_group: r.diversion_group,
      upstream_node: r.upstream_node,
      surge_outbound: r.surge_outbound,
      surge_policy: r.surge_policy,
      duration_ms: r.duration_ms,
      is_self_healed: Boolean(r.is_self_healed),
      timestamp: r.timestamp,
    }));
  }
}
