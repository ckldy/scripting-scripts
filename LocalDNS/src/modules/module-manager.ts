// Module Manager: handles module loading, persistence, MITM matching, and rewrite/script dispatching
import type {
  CleanModule,
  CleanRewriteRule,
  CleanScriptRule,
  EnrichedRewriteRule,
  ModuleManagerStats,
  RewriteAction,
} from './types';
import { ModuleParser } from './parser';

export class ModuleManager {
  private static instance: ModuleManager;
  private modules: CleanModule[] = [];
  private mitmPatterns: { original: string; regex: RegExp; exclude: boolean }[] = [];
  private stats: ModuleManagerStats = {
    totalModules: 0,
    activeModules: 0,
    totalMitmHosts: 0,
    totalRewrites: 0,
    totalScripts: 0,
    hitRewrites: 0,
    hitScripts: 0,
    cleanedStreams: 0,
  };

  private constructor() {
    this.loadModules();
  }

  static get(): ModuleManager {
    if (!ModuleManager.instance) {
      ModuleManager.instance = new ModuleManager();
    }
    return ModuleManager.instance;
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

  private loadModules(): void {
    const rawModules = this.loadOrDefault<any[]>('localdns_clean_modules', []);
    if (rawModules && rawModules.length > 0) {
      this.modules = rawModules.map((m) => {
        // 恢复正则表达式对象
        const rewrites: CleanRewriteRule[] = (m.rewrites || []).map((rw: any) => ({
          ...rw,
          regex: new RegExp(rw.pattern),
          enabled: rw.enabled !== false,
        }));
        const scripts: CleanScriptRule[] = (m.scripts || []).map((sc: any) => ({
          ...sc,
          regex: new RegExp(sc.pattern),
        }));
        return {
          ...m,
          rewrites,
          scripts,
        };
      });
    } else {
      // 预置高频社区经典去广告模块与自定义重写
      this.initDefaultPresets();
    }

    // 确保存在自定义重写模块 (custom_rewrites)
    let needSave = false;
    if (!this.modules.some((m) => m.id === 'custom_rewrites')) {
      const customModuleRaw = `#!name=自定义 HTTP 重写
#!desc=本地自定义 URL 重定向、Mock 虚拟响应、Header 篡改与 Body 替换规则
[URL Rewrite]
`;
      const mCustom = ModuleParser.parse(customModuleRaw, 'custom_rewrites');
      this.modules.unshift(mCustom);
      needSave = true;
    }

    // 自动自愈补齐开箱即用的 B站去广告与全网视频SDK桩模块
    if (!this.modules.some((m) => m.id === 'preset_bilibili')) {
      const biliModuleRaw = this.getBilibiliModuleRaw();
      const mBili = ModuleParser.parse(biliModuleRaw, 'preset_bilibili');
      this.modules.push(mBili);
      needSave = true;
    }

    if (!this.modules.some((m) => m.id === 'preset_universal_video_sdk')) {
      const sdkModuleRaw = this.getUniversalVideoSdkModuleRaw();
      const mSdk = ModuleParser.parse(sdkModuleRaw, 'preset_universal_video_sdk');
      this.modules.push(mSdk);
      needSave = true;
    }

    if (needSave) {
      this.saveModules();
    }

    this.rebuildMitmIndex();
  }

  private getBilibiliModuleRaw(): string {
    return `#!name=Bilibili 纯净视频与开屏去广告
#!desc=去除哔哩哔哩开屏秒启动、视频播放中插推荐、番剧贴片、信息流广告与推广卡片
[MITM]
hostname = *.bilibili.com, api.bilibili.com, app.bilibili.com, grpc.biliapi.net

[URL Rewrite]
^https?:\\/\\/api\\.bilibili\\.com\\/x\\/v2\\/splash reject-200
^https?:\\/\\/app\\.bilibili\\.com\\/x\\/v2\\/feed\\/index reject-dict
^https?:\\/\\/api\\.bilibili\\.com\\/x\\/v2\\/ad\\/.* reject-dict
^https?:\\/\\/api\\.bilibili\\.com\\/x\\/v2\\/dm\\/ad reject-dict
^https?:\\/\\/api\\.bilibili\\.com\\/x\\/v2\\/rank\\/.*ad reject-200
^https?:\\/\\/app\\.bilibili\\.com\\/x\\/v2\\/search\\/square reject-dict
`;
  }

  private getUniversalVideoSdkModuleRaw(): string {
    return `#!name=全网通用视频广告SDK桩与拦截
#!desc=模拟 Google IMA SDK 桩代码，拦截爱奇艺、优酷、腾讯视频等前贴片与中插广告接口
[MITM]
hostname = imasdk.googleapis.com, *.iqiyi.com, *.qiyi.com, adstats.tencentmusic.com, *.youku.com, *.mgtv.com

[URL Rewrite]
^https?:\\/\\/imasdk\\.googleapis\\.com\\/js\\/sdkloader\\/ima3.*\\.js mock 200 window.google={ima:{AdDisplayContainer:function(){return{initialize:function(){},destroy:function(){}}},AdsLoader:function(){return{addEventListener:function(e,f){if(e==='adsManagerLoaded')setTimeout(function(){f({getAdsManager:function(){return{init:function(){},start:function(){},destroy:function(){},addEventListener:function(ev,cb){if(ev==='allAdsCompleted'||ev==='complete')cb();}}};});},10);}},requestAds:function(){}}},AdsManagerLoadedEvent:{Type:{ADS_MANAGER_LOADED:'adsManagerLoaded'}},AdEvent:{Type:{ALL_ADS_COMPLETED:'allAdsCompleted',COMPLETE:'complete',CONTENT_PAUSE_REQUESTED:'contentPauseRequested',CONTENT_RESUME_REQUESTED:'contentResumeRequested'}}}};
^https?:\\/\\/[\\w-]+\\.iqiyi\\.com\\/v5\\/ad\\/ reject-200
^https?:\\/\\/api\\.iqiyi\\.com\\/player\\/info mock 200 {"code":"A00000","data":{"ads":[]}}
^https?:\\/\\/adstats\\.tencentmusic\\.com\\/.* reject-200
^https?:\\/\\/.*\\.youku\\.com\\/.*\\/ad\\/.* reject-dict
^https?:\\/\\/.*\\.mgtv\\.com\\/.*\\/ad\\/.* reject-dict
`;
  }

  private initDefaultPresets(): void {
    // 预置 0: 自定义 HTTP 重写模块
    const customModuleRaw = `#!name=自定义 HTTP 重写
#!desc=本地自定义 URL 重定向、Mock 虚拟响应、Header 篡改与 Body 替换规则
[URL Rewrite]
`;

    // 预置 1: YouTube 视频去广告与清爽模块 (Surge 规范)
    const ytModuleRaw = `#!name=YouTube 纯净去广告与流净化
#!desc=屏蔽 YouTube 贴片广告、中插广告、信息流推广与后台跟踪
[MITM]
hostname = *.googlevideo.com, www.youtube.com, youtubei.googleapis.com

[URL Rewrite]
^https?:\\/\\/[\\w-]+\\.googlevideo\\.com\\/videoplayback\\?.+(&adformat=|\\/ad\\/) reject-200
^https?:\\/\\/www\\.youtube\\.com\\/youtubei\\/v1\\/player\\/ad_break reject-dict
^https?:\\/\\/youtubei\\.googleapis\\.com\\/youtubei\\/v1\\/log_event reject-200
^https?:\\/\\/www\\.youtube\\.com\\/api\\/stats\\/ads reject-200

[Script]
youtube-player = type=http-response,pattern=^https?:\\/\\/www\\.youtube\\.com\\/youtubei\\/v1\\/player,script-path=https://raw.githubusercontent.com/Maasea/sgmodule/master/Script/Youtube/youtube.js,requires-body=true
`;

    // 预置 2: Twitch SSAI 广告切片清洗模块
    const twitchModuleRaw = `#!name=Twitch 直播切片广告清洗
#!desc=清洗 Twitch 直播流 M3U8 清单中的服务端插入切片 (SSAI)
[MITM]
hostname = *.ttvnw.net, *.twitch.tv

[URL Rewrite]
^https?:\\/\\/usher\\.ttvnw\\.net\\/api\\/channel\\/hls\\/ reject-dict
^https?:\\/\\/spade\\.twitch\\.tv\\/track reject-200
`;

    const m0 = ModuleParser.parse(customModuleRaw, 'custom_rewrites');
    const m1 = ModuleParser.parse(ytModuleRaw, 'preset_youtube');
    const m2 = ModuleParser.parse(twitchModuleRaw, 'preset_twitch');
    const m3 = ModuleParser.parse(this.getBilibiliModuleRaw(), 'preset_bilibili');
    const m4 = ModuleParser.parse(this.getUniversalVideoSdkModuleRaw(), 'preset_universal_video_sdk');
    this.modules = [m0, m1, m2, m3, m4];
    this.saveModules();
  }

  private saveModules(): void {
    // 持久化时将 RegExp 转换为字符串已在对象内保存了 pattern
    const serializable = this.modules.map((m) => ({
      ...m,
      rewrites: m.rewrites.map((rw) => ({
        id: rw.id,
        name: rw.name,
        pattern: rw.pattern,
        action: rw.action,
        target: rw.target,
        extra: rw.extra,
        enabled: rw.enabled !== false,
        note: rw.note,
      })),
      scripts: m.scripts.map((sc) => ({
        id: sc.id,
        name: sc.name,
        type: sc.type,
        pattern: sc.pattern,
        scriptPath: sc.scriptPath,
        scriptContent: sc.scriptContent,
        requiresBody: sc.requiresBody,
        binaryBody: sc.binaryBody,
        timeout: sc.timeout,
      })),
    }));
    this.persist('localdns_clean_modules', serializable);
    this.rebuildMitmIndex();
  }

  /**
   * 重建 MITM 主机名匹配索引
   */
  public rebuildMitmIndex(): void {
    this.mitmPatterns = [];
    const allHosts = new Set<string>();

    for (const mod of this.modules) {
      if (!mod.enabled) continue;
      for (const h of mod.mitmHosts) {
        allHosts.add(h.trim());
      }
    }

    for (const host of allHosts) {
      if (!host) continue;
      let isExclude = false;
      let patternStr = host;
      if (patternStr.startsWith('-') || patternStr.startsWith('~')) {
        isExclude = true;
        patternStr = patternStr.substring(1);
      }

      // 将通配符转换为正则表达式
      // 如 *.googlevideo.com -> ^(?:.*?\.)?googlevideo\.com$
      let regexStr = patternStr
        .replace(/\./g, '\\.')
        .replace(/\*/g, '.*?');
      if (!regexStr.startsWith('^')) regexStr = `^${regexStr}`;
      if (!regexStr.endsWith('$')) regexStr = `${regexStr}$`;

      try {
        this.mitmPatterns.push({
          original: host,
          regex: new RegExp(regexStr, 'i'),
          exclude: isExclude,
        });
      } catch {}
    }

    // 更新统计
    this.stats.totalModules = this.modules.length;
    this.stats.activeModules = this.modules.filter((m) => m.enabled).length;
    this.stats.totalMitmHosts = allHosts.size;
    this.stats.totalRewrites = this.modules
      .filter((m) => m.enabled)
      .reduce((acc, cur) => acc + cur.rewrites.length, 0);
    this.stats.totalScripts = this.modules
      .filter((m) => m.enabled)
      .reduce((acc, cur) => acc + cur.scripts.length, 0);
  }

  /**
   * 检查某个域名是否需要进行 MITM 解密接管
   */
  public isMitmHost(hostname: string): boolean {
    if (!hostname) return false;
    const cleanHost = hostname.split(':')[0].toLowerCase();

    // 优先匹配排除名单（- / ~ 开头）
    for (const p of this.mitmPatterns) {
      if (p.exclude && p.regex.test(cleanHost)) {
        return false;
      }
    }

    // 匹配包含规则
    for (const p of this.mitmPatterns) {
      if (!p.exclude && p.regex.test(cleanHost)) {
        return true;
      }
    }

    return false;
  }

  /**
   * 匹配 URL 重定向与静态阻断规则
   */
  public matchRewrite(url: string): { rule: CleanRewriteRule; action: RewriteAction; target?: string; extra?: string } | null {
    for (const mod of this.modules) {
      if (!mod.enabled) continue;
      for (const rw of mod.rewrites) {
        if (rw.enabled === false) continue; // 支持单条重写规则独立开关
        if (rw.regex.test(url)) {
          this.stats.hitRewrites++;
          return {
            rule: rw,
            action: rw.action,
            target: rw.target,
            extra: rw.extra,
          };
        }
      }
    }
    return null;
  }

  // ================= HTTP 重写规则专属管理接口 =================

  /**
   * 获取所有模块与自定义集合中的全部重写规则
   */
  public getAllRewrites(): EnrichedRewriteRule[] {
    const list: EnrichedRewriteRule[] = [];
    for (const mod of this.modules) {
      for (const rw of mod.rewrites) {
        list.push({
          ...rw,
          moduleId: mod.id,
          moduleName: mod.name,
          moduleEnabled: mod.enabled,
          isCustom: mod.id === 'custom_rewrites',
        });
      }
    }
    return list;
  }

  /**
   * 获取专供用户自定义重写规则的模块对象
   */
  public getCustomRewritesModule(): CleanModule {
    let custom = this.modules.find((m) => m.id === 'custom_rewrites');
    if (!custom) {
      const customModuleRaw = `#!name=自定义 HTTP 重写\n#!desc=本地自定义 URL 重定向、Mock 虚拟响应、Header 篡改与 Body 替换规则\n[URL Rewrite]\n`;
      custom = ModuleParser.parse(customModuleRaw, 'custom_rewrites');
      this.modules.unshift(custom);
      this.saveModules();
    }
    return custom;
  }

  /**
   * 添加一条自定义 HTTP 重写规则
   */
  public addCustomRewrite(item: {
    name?: string;
    pattern: string;
    action: RewriteAction;
    target?: string;
    extra?: string;
    enabled?: boolean;
    note?: string;
  }): CleanRewriteRule {
    const custom = this.getCustomRewritesModule();
    const id = `rw_cust_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const rule: CleanRewriteRule = {
      id,
      name: item.name || '',
      pattern: item.pattern,
      regex: new RegExp(item.pattern),
      action: item.action,
      target: item.target,
      extra: item.extra,
      enabled: item.enabled !== false,
      note: item.note,
    };
    custom.rewrites.unshift(rule);
    this.saveModules();
    return rule;
  }

  /**
   * 更新单条重写规则 (可以修改 pattern, action, target, extra, name, enabled, note 等)
   */
  public updateRewrite(
    id: string,
    patch: Partial<CleanRewriteRule>
  ): CleanRewriteRule | null {
    for (const mod of this.modules) {
      const idx = mod.rewrites.findIndex((r) => r.id === id);
      if (idx !== -1) {
        const cur = mod.rewrites[idx];
        const next: CleanRewriteRule = {
          ...cur,
          ...patch,
          id: cur.id,
        };
        if (patch.pattern) {
          next.regex = new RegExp(patch.pattern);
        }
        mod.rewrites[idx] = next;
        this.saveModules();
        return next;
      }
    }
    return null;
  }

  /**
   * 切换单条重写规则的启闭状态
   */
  public toggleRewrite(id: string, enabled: boolean): boolean {
    const res = this.updateRewrite(id, { enabled });
    return res !== null;
  }

  /**
   * 删除单条重写规则
   */
  public deleteRewrite(id: string): boolean {
    for (const mod of this.modules) {
      const prevLen = mod.rewrites.length;
      mod.rewrites = mod.rewrites.filter((r) => r.id !== id);
      if (mod.rewrites.length !== prevLen) {
        this.saveModules();
        return true;
      }
    }
    return false;
  }

  /**
   * 从纯文本批量导入保存自定义重写规则
   */
  public saveCustomRewritesFromText(text: string): CleanModule {
    const custom = this.getCustomRewritesModule();
    let surgeText = text.trim();
    if (!surgeText.toUpperCase().includes('[URL REWRITE]') && !surgeText.toUpperCase().includes('[REWRITE]')) {
      surgeText = `[URL Rewrite]\n${surgeText}`;
    }
    const parsed = ModuleParser.parse(surgeText, 'custom_rewrites');
    custom.rewrites = parsed.rewrites;
    custom.rawSource = text;
    custom.lastUpdated = new Date().toISOString();
    this.saveModules();
    return custom;
  }

  /**
   * 导出自定义重写为 Surge/Loon 格式文本
   */
  public exportCustomRewritesText(): string {
    const custom = this.getCustomRewritesModule();
    const lines: string[] = ['# LocalDNS 自定义 HTTP 重写规则', ''];
    for (const r of custom.rewrites) {
      if (r.name) lines.push(`# ${r.name}`);
      const enabledPrefix = r.enabled === false ? '# ' : '';
      let line = '';
      if (r.action === 'redirect') {
        line = `${r.pattern} 302 ${r.target || ''}`;
      } else if (r.action === 'mock') {
        line = `${r.pattern} mock ${r.target || '200'} ${r.extra || ''}`;
      } else if (r.action === 'header-replace') {
        line = `${r.pattern} header-replace ${r.target || ''} ${r.extra || ''}`;
      } else if (r.action === 'header-del') {
        line = `${r.pattern} header-del ${r.target || ''}`;
      } else if (r.action === 'body-replace') {
        line = `${r.pattern} response-body ${r.target || ''} ${r.extra || ''}`;
      } else {
        line = `${r.pattern} ${r.action}`;
      }
      lines.push(`${enabledPrefix}${line}`.trim());
    }
    return lines.join('\n');
  }

  /**
   * 匹配执行脚本
   */
  public matchScripts(url: string, type: 'http-request' | 'http-response'): CleanScriptRule[] {
    const matched: CleanScriptRule[] = [];
    for (const mod of this.modules) {
      if (!mod.enabled) continue;
      for (const sc of mod.scripts) {
        if (sc.type === type && sc.regex.test(url)) {
          matched.push(sc);
          this.stats.hitScripts++;
        }
      }
    }
    return matched;
  }

  // 模块 CRUD 接口
  public getModules(): CleanModule[] {
    return this.modules;
  }

  public getModule(id: string): CleanModule | undefined {
    return this.modules.find((m) => m.id === id);
  }

  public addModule(content: string, url?: string): CleanModule {
    const parsed = ModuleParser.parse(content, undefined, url);
    // 如果存在同名或同URL模块，则覆盖
    const existingIdx = this.modules.findIndex((m) => (url && m.url === url) || m.id === parsed.id);
    if (existingIdx !== -1) {
      this.modules[existingIdx] = parsed;
    } else {
      this.modules.push(parsed);
    }
    this.saveModules();
    return parsed;
  }

  public removeModule(id: string): boolean {
    const prevLen = this.modules.length;
    this.modules = this.modules.filter((m) => m.id !== id);
    if (this.modules.length !== prevLen) {
      this.saveModules();
      return true;
    }
    return false;
  }

  public toggleModule(id: string, enabled: boolean): boolean {
    const mod = this.modules.find((m) => m.id === id);
    if (mod) {
      mod.enabled = enabled;
      this.saveModules();
      return true;
    }
    return false;
  }

  /**
   * 在线更新模块及其引用的 JS 脚本
   */
  public async updateModule(id: string): Promise<CleanModule | null> {
    const mod = this.modules.find((m) => m.id === id);
    if (!mod) return null;

    if (!mod.url) {
      // 离线模块更新内部脚本缓存
      await this.cacheModuleScripts(mod);
      this.saveModules();
      return mod;
    }

    try {
      const res = await fetch(mod.url);
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      const content = await res.text();
      const updated = ModuleParser.parse(content, mod.id, mod.url);
      updated.enabled = mod.enabled;
      updated.autoUpdate = mod.autoUpdate;
      updated.lastUpdated = new Date().toISOString();
      updated.lastError = null;

      // 预先缓存远程脚本
      await this.cacheModuleScripts(updated);

      const idx = this.modules.findIndex((m) => m.id === id);
      if (idx !== -1) {
        this.modules[idx] = updated;
      }
      this.saveModules();
      return updated;
    } catch (err: any) {
      mod.lastError = err.message || '更新失败';
      this.saveModules();
      return mod;
    }
  }

  /**
   * 预下载并缓存模块引用的远程脚本，提高运行时性能并支持离线
   */
  public async cacheModuleScripts(mod: CleanModule): Promise<void> {
    for (const sc of mod.scripts) {
      if (sc.scriptPath.startsWith('http://') || sc.scriptPath.startsWith('https://')) {
        try {
          const res = await fetch(sc.scriptPath);
          if (res.ok) {
            sc.scriptContent = await res.text();
          }
        } catch {}
      }
    }
  }

  public getStats(): ModuleManagerStats {
    return { ...this.stats };
  }

  public recordStreamClean(): void {
    this.stats.cleanedStreams++;
  }
}
