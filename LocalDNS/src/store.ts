import type {
  UpstreamConfig,
  SwitchStates,
  AdGuardRuleSource,
  DiversionSource,
} from './types';

export class Store {
  private static instance: Store;

  private upstreamConfig: UpstreamConfig;
  private upstreamEcs = '';
  private switches: SwitchStates;
  private rules: Record<string, string> = {};
  private adguardSources: AdGuardRuleSource[] = [];
  private diversionSources: DiversionSource[] = [];
  private clientAliases: Record<string, string> = {};
  private auditCapacity = 500;
  private auditCapturing = true;
  private requeryConfig = {
    enabled: false,
    interval_minutes: 60,
    refresh_days: 7,
    first_run_time: '04:00',
  };
  private interfaceSettings: Record<string, { value: any; revision: number }> = {};
  private ruleBackups: Record<string, Array<{ id: string; time: number; bytes: number; tag: string; content: string }>> = {};

  private constructor() {
    this.upstreamConfig = this.loadOrDefault('localdns_upstreams', {
      domestic: [
        { tag: 'alidns_doh', protocol: 'https', addr: 'https://dns.alidns.com/dns-query', enabled: true },
        { tag: 'dnspod_doh', protocol: 'https', addr: 'https://doh.pub/dns-query', enabled: true },
      ],
      foreign: [
        { tag: 'cloudflare_doh', protocol: 'https', addr: 'https://1.1.1.1/dns-query', enabled: true },
        { tag: 'google_doh', protocol: 'https', addr: 'https://dns.google/dns-query', enabled: true },
      ],
      foreign_ecs: [
        { tag: 'cloudflare_ecs', protocol: 'https', addr: 'https://cloudflare-dns.com/dns-query', enabled: true },
        { tag: 'quad9_doh', protocol: 'https', addr: 'https://dns.quad9.net/dns-query', enabled: true },
      ],
      proxy: [
        { tag: 'google_proxy', protocol: 'https', addr: 'https://dns.google/dns-query', enabled: true },
      ],
    });

    this.switches = this.loadOrDefault('localdns_switches', {
      switch1: 'A',  // 请求屏蔽 (开)
      switch5: 'B',  // 类型屏蔽 (关)
      switch7: 'A',  // 广告屏蔽 (开)
      switch6: 'B',  // IPv6 屏蔽 (关)
      switch13: 'A', // 核心缓存 (开)
      switch4: 'A',  // 过期缓存 (开)
      switch2: 'B',  // 指定 Client FakeIP (关)
      switch12: 'B', // 指定 Client RealIP (关)
      switch_mitm: 'A', // MITM 中间人解密与 FakeIP 接管 (开)
      switch_rewrite: 'A', // HTTP/HTTPS 重写引擎 (开)
    });

    this.rules = this.loadOrDefault('localdns_rules', {
      whitelist: '# 允许放行域名，每行一个\nexample.com\n',
      blocklist: '# 本地拦截黑名单，每行一个\ntracking.example.com\n',
      greylist: '# 灰名单域名\n',
      force_realip: '# 强制 RealIP 域名\n',
      ddns_domains: '# DDNS 域名\n',
      pcdn_domains: '# PCDN 域名\n',
      pcdn_regex_v4: '',
      pcdn_regex_v6: '',
      client_ip: '# 客户端 IP 列表\n',
      direct_ip: '# 直连 IP 列表\n',
      rewrite: '# 重定向列表: 域名 目标IP\n# dev.local 127.0.0.1\n',
    });

    this.adguardSources = this.loadOrDefault('localdns_adguard_sources', [
      {
        id: 'adguard_dns',
        name: 'AdGuard DNS Filter',
        tag: 'adguard',
        url: 'https://adguardteam.github.io/HostlistsRegistry/assets/filter_1.txt',
        enabled: true,
        auto_update: true,
        update_interval_hours: 24,
        rule_count: 0,
        last_updated: null,
        last_error: null,
      },
      {
        id: 'anti_ad',
        name: 'anti-AD',
        tag: 'adguard',
        url: 'https://raw.githubusercontent.com/privacy-protection-tools/anti-AD/master/anti-ad-adguard.txt',
        enabled: false,
        auto_update: true,
        update_interval_hours: 24,
        rule_count: 0,
        last_updated: null,
        last_error: null,
      },
    ]);

    this.diversionSources = this.loadOrDefault('localdns_diversion_sources', [
      {
        id: 'cn_rules',
        name: '国内直连列表',
        tag: 'custom_cn',
        url: 'https://raw.githubusercontent.com/Loyalsoldier/v2ray-rules-dat/release/direct-list.txt',
        format: 'txt',
        enabled: true,
        auto_update: true,
        update_interval_hours: 24,
        rule_count: 0,
        last_updated: null,
        last_error: null,
      },
      {
        id: 'geosite_cn',
        name: 'Geosite CN',
        tag: 'geosite_cn',
        url: 'https://raw.githubusercontent.com/Loyalsoldier/domain-list-custom/release/cn.txt',
        format: 'txt',
        enabled: true,
        auto_update: true,
        update_interval_hours: 24,
        rule_count: 0,
        last_updated: null,
        last_error: null,
      },
    ]);

    this.clientAliases = this.loadOrDefault('localdns_client_aliases', {});
    this.auditCapacity = this.loadOrDefault('localdns_audit_capacity', 500);
    this.auditCapturing = this.loadOrDefault('localdns_audit_capturing', true);
    this.upstreamEcs = this.loadOrDefault('localdns_upstream_ecs', '');
    this.requeryConfig = this.loadOrDefault('localdns_requery_config', this.requeryConfig);
    this.interfaceSettings = this.loadOrDefault('localdns_interface_settings', {});
    this.ruleBackups = this.loadOrDefault('localdns_rule_backups', {});

    // Auto-healing: Ensure primary AdGuard filter source and switch7 are enabled so ad blocking works out of the box!
    let sourcesChanged = false;
    for (const s of this.adguardSources) {
      if ((s.id === 'adguard_dns' || s.rule_count > 0) && !s.enabled) {
        s.enabled = true;
        sourcesChanged = true;
      }
    }
    if (sourcesChanged) {
      this.persist('localdns_adguard_sources', this.adguardSources);
    }
    if (this.switches.switch7 !== 'A') {
      this.switches.switch7 = 'A';
      this.persist('localdns_switches', this.switches);
    }
    if (!this.switches.switch_mitm) {
      this.switches.switch_mitm = 'A';
      this.persist('localdns_switches', this.switches);
    }
    if (!this.switches.switch_rewrite) {
      this.switches.switch_rewrite = 'A';
      this.persist('localdns_switches', this.switches);
    }
  }

  static get(): Store {
    if (!Store.instance) {
      Store.instance = new Store();
    }
    return Store.instance;
  }

  private loadOrDefault<T>(key: string, def: T): T {
    try {
      if (typeof Storage !== 'undefined' && Storage.contains && Storage.contains(key)) {
        const val = Storage.get<T>(key);
        if (val !== null && val !== undefined) return val;
      }
    } catch {}
    return def;
  }

  private persist<T>(key: string, val: T): void {
    try {
      if (typeof Storage !== 'undefined' && Storage.set) {
        Storage.set(key, val);
      }
    } catch {}
  }

  // Upstream
  getUpstreamConfig(): UpstreamConfig {
    return this.upstreamConfig;
  }

  setUpstreamConfig(cfg: UpstreamConfig): void {
    this.upstreamConfig = cfg;
    this.persist('localdns_upstreams', cfg);
  }

  setUpstreamGroup(group: keyof UpstreamConfig, nodes: any[]): void {
    this.upstreamConfig[group] = nodes;
    this.setUpstreamConfig(this.upstreamConfig);
  }

  getUpstreamEcs(): string {
    return this.upstreamEcs;
  }

  setUpstreamEcs(ecs: string): void {
    this.upstreamEcs = ecs;
    this.persist('localdns_upstream_ecs', ecs);
  }

  // Switches
  getSwitches(): SwitchStates {
    return this.switches;
  }

  setSwitch(tag: keyof SwitchStates, val: 'A' | 'B'): void {
    this.switches[tag] = val;
    this.persist('localdns_switches', this.switches);
  }

  // Rules
  getRule(tag: string): string {
    return this.rules[tag] || '';
  }

  setRule(tag: string, content: string): void {
    this.rules[tag] = content;
    this.persist('localdns_rules', this.rules);
  }

  getAllRules(): Record<string, string> {
    return { ...this.rules };
  }

  // AdGuard
  getAdguardSources(): AdGuardRuleSource[] {
    return this.adguardSources;
  }

  setAdguardSources(sources: AdGuardRuleSource[]): void {
    this.adguardSources = sources;
    this.persist('localdns_adguard_sources', sources);
  }

  // Diversion
  getDiversionSources(): DiversionSource[] {
    return this.diversionSources;
  }

  setDiversionSources(sources: DiversionSource[]): void {
    this.diversionSources = sources;
    this.persist('localdns_diversion_sources', sources);
  }

  // Client Aliases
  getClientAliases(): Record<string, string> {
    return this.clientAliases;
  }

  setClientAlias(ip: string, alias: string): void {
    if (!alias) {
      delete this.clientAliases[ip];
    } else {
      this.clientAliases[ip] = alias;
    }
    this.persist('localdns_client_aliases', this.clientAliases);
  }

  // Audit
  getAuditCapacity(): number {
    return this.auditCapacity;
  }

  setAuditCapacity(cap: number): void {
    this.auditCapacity = Math.max(100, Math.floor(cap));
    this.persist('localdns_audit_capacity', this.auditCapacity);
  }

  isAuditCapturing(): boolean {
    return this.auditCapturing;
  }

  setAuditCapturing(capturing: boolean): void {
    this.auditCapturing = capturing;
    this.persist('localdns_audit_capturing', capturing);
  }

  // Requery
  getRequeryConfig() {
    return this.requeryConfig;
  }

  setRequeryConfig(cfg: any) {
    this.requeryConfig = { ...this.requeryConfig, ...cfg };
    this.persist('localdns_requery_config', this.requeryConfig);
  }

  // Interface Settings (brand identity, proxy-panel settings)
  getInterfaceSetting(section: string): { value: any; revision: number } | null {
    return this.interfaceSettings[section] || null;
  }

  setInterfaceSetting(section: string, value: any): { value: any; revision: number } {
    const cur = this.interfaceSettings[section];
    const newRev = (cur?.revision || 0) + 1;
    const entry = { value, revision: newRev };
    this.interfaceSettings[section] = entry;
    this.persist('localdns_interface_settings', this.interfaceSettings);
    return entry;
  }

  // Rule Backups (Upstream UI 2026.10.18.18 / .19 rule-backups.js)
  getRuleBackups(tag: string): Array<{ id: string; time: number; bytes: number }> {
    const list = this.ruleBackups[tag] || [];
    return list.map((b) => ({ id: b.id, time: b.time, bytes: b.bytes }));
  }

  getRuleBackupContent(tag: string, id: string): { id: string; time: number; bytes: number; tag: string; content: string } | null {
    const list = this.ruleBackups[tag] || [];
    const found = list.find((b) => b.id === id);
    return found || null;
  }

  addRuleBackup(tag: string, content: string): { id: string; time: number; bytes: number } {
    if (!this.ruleBackups[tag]) {
      this.ruleBackups[tag] = [];
    }
    const backupItem = {
      id: `bk_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      time: Date.now(),
      bytes: content.length,
      tag,
      content,
    };
    // Keep most recent 20 backups per tag
    this.ruleBackups[tag].unshift(backupItem);
    if (this.ruleBackups[tag].length > 20) {
      this.ruleBackups[tag] = this.ruleBackups[tag].slice(0, 20);
    }
    this.persist('localdns_rule_backups', this.ruleBackups);
    return { id: backupItem.id, time: backupItem.time, bytes: backupItem.bytes };
  }
}
