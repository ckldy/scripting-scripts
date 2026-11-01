import { Script } from 'scripting';
import { LocalDnsServer } from './server';
import { CacheManager } from './cache';

export interface GuardianStatus {
  enabled: boolean;
  keeperStatus: string;
  keeperActive: boolean;
  keeperRequested: boolean;
  lastFailure: string | null;
  serverRunning: boolean;
  serverPort: number;
  autoHealedCount: number;
  uptimeSeconds: number;
  startedAt: number;
  lastCheckAt: number;
}

/**
 * LocalDNS 进程守护引擎 (ProcessGuardian)
 *
 * 核心目标：彻底根除 iOS 锁屏或切入后台后被系统杀死的现象
 *
 * 三大防线：
 * 1. 【高频智能看门狗】：每 6 秒巡检 BackgroundKeeper 与端口状态，遇打断（来电/音视频通知）秒级自愈拉起保活
 * 2. 【生命周期加固】：监听 onMinimize 与 onResume，切出瞬间主动强化保活并做内存整理（防 Jetsam 杀手）
 * 3. 【服务端口热备拉起】：检测到 HTTP/DoH 端口意外被杀时原地复活重启
 */
export class ProcessGuardian {
  private static instance: ProcessGuardian;
  private enabled = true;
  private watchdogTimer: any = null;
  private autoHealedCount = 0;
  private startedAt = Date.now();
  private lastCheckAt = Date.now();
  private isChecking = false;
  private hooksRegistered = false;

  public static get(): ProcessGuardian {
    if (!ProcessGuardian.instance) {
      ProcessGuardian.instance = new ProcessGuardian();
    }
    return ProcessGuardian.instance;
  }

  /**
   * 启动看门狗守护
   */
  public start(): void {
    if (this.watchdogTimer) return;
    this.enabled = true;
    console.log('[Guardian] 🛡 启动进程守护巡检看门狗 (间隔 6 秒)...');

    // 1. 立即激活一次系统后台长驻保活
    this.ensureKeepAlive();

    // 2. 启动核心看门狗巡检定时器（每 6 秒一次）
    this.watchdogTimer = setInterval(() => {
      this.checkAndHeal();
    }, 6000);

    // 3. 注册生命周期钩子
    this.registerLifecycleHooks();
  }

  /**
   * 停止看门狗守护
   */
  public stop(): void {
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
    this.enabled = false;
    if (typeof BackgroundKeeper !== 'undefined' && BackgroundKeeper.stopKeepAlive) {
      try {
        BackgroundKeeper.stopKeepAlive();
      } catch {}
    }
    console.log('[Guardian] 进程守护已停止');
  }

  /**
   * 核心看门狗巡检与自愈逻辑
   */
  public async checkAndHeal(): Promise<boolean> {
    if (!this.enabled || this.isChecking) return true;
    this.isChecking = true;
    this.lastCheckAt = Date.now();
    let healed = false;

    try {
      // 检查 A: 本地 DNS 服务状态（如果服务被意外停止，立即原地重启拉起）
      const server = LocalDnsServer.get();
      if (!server.getIsRunning()) {
        console.warn('[Guardian] ⚠️ 检测到本地服务意外停止，看门狗正在原地重启...');
        const res = server.start(server.getPort() || 9099);
        if (res.success) {
          this.autoHealedCount++;
          healed = true;
          console.log('[Guardian] ✅ 本地服务已自愈复活，端口:', res.port);
        }
      }

      // 检查 B: BackgroundKeeper 系统后台保活状态
      if (typeof BackgroundKeeper !== 'undefined') {
        let state: any = null;
        if (typeof BackgroundKeeper.getState === 'function') {
          try {
            state = await BackgroundKeeper.getState();
          } catch {}
        }

        // 如果保活不处于活跃状态（比如被来电、通知音或后台音频打断）
        const needsKeepAlive = !state || state.status !== 'active' || !state.isActive;
        if (needsKeepAlive) {
          console.warn('[Guardian] ⚠️ 后台保活中断或失活，看门狗正在自愈激活...', state);
          const ok = await this.ensureKeepAlive();
          if (ok) {
            this.autoHealedCount++;
            healed = true;
            console.log('[Guardian] ✅ 后台保活已成功自愈夺回，自愈总计:', this.autoHealedCount);
          }
        }
      }
    } catch (e) {
      console.error('[Guardian] 巡检异常:', e);
    } finally {
      this.isChecking = false;
    }

    return healed;
  }

  /**
   * 确保 BackgroundKeeper 处于活跃长驻状态
   */
  public async ensureKeepAlive(): Promise<boolean> {
    if (typeof BackgroundKeeper === 'undefined' || !BackgroundKeeper.keepAlive) {
      return false;
    }
    try {
      const ok = await BackgroundKeeper.keepAlive();
      return ok;
    } catch (e) {
      console.warn('[Guardian] keepAlive 请求失败:', e);
      return false;
    }
  }

  /**
   * 注册生命周期钩子（前后台切换强化守护）
   */
  private registerLifecycleHooks(): void {
    if (this.hooksRegistered) return;
    this.hooksRegistered = true;

    if (typeof Script.enableMinimize === 'function') {
      try {
        Script.enableMinimize(true);
      } catch {}
    }

    if (typeof Script.onMinimize === 'function') {
      try {
        Script.onMinimize(() => {
          console.log('[Guardian] 监听到 App 收起/切后台，执行保活加固与内存整理...');
          this.ensureKeepAlive();
          this.cleanupMemory();
        });
      } catch {}
    }

    if (typeof Script.onResume === 'function') {
      try {
        Script.onResume(() => {
          console.log('[Guardian] 监听到 App 唤醒恢复，立刻校验服务与保活状态...');
          this.checkAndHeal();
        });
      } catch {}
    }
  }

  /**
   * 内存整理：清理过期无用缓存，防 Jetsam 杀手
   */
  public cleanupMemory(): void {
    try {
      CacheManager.get().cleanup();
    } catch (e) {
      console.warn('[Guardian] 内存缓存整理异常:', e);
    }
  }

  public async getStatus(): Promise<GuardianStatus> {
    const server = LocalDnsServer.get();
    let keeperStatus = 'unsupported';
    let keeperActive = false;
    let keeperRequested = false;
    let lastFailure: string | null = null;

    if (typeof BackgroundKeeper !== 'undefined') {
      try {
        if (typeof BackgroundKeeper.getState === 'function') {
          const s = await BackgroundKeeper.getState();
          keeperStatus = s.status;
          keeperActive = s.isActive;
          keeperRequested = s.requested;
          lastFailure = s.lastFailure;
        } else {
          keeperActive = await BackgroundKeeper.isActive;
          keeperStatus = keeperActive ? 'active' : 'inactive';
        }
      } catch (e: any) {
        lastFailure = String(e?.message || e);
      }
    }

    return {
      enabled: this.enabled,
      keeperStatus,
      keeperActive,
      keeperRequested,
      lastFailure,
      serverRunning: server.getIsRunning(),
      serverPort: server.getPort(),
      autoHealedCount: this.autoHealedCount,
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
      startedAt: this.startedAt,
      lastCheckAt: this.lastCheckAt
    };
  }

  public setEnabled(en: boolean): void {
    this.enabled = en;
    if (en) {
      this.ensureKeepAlive();
    } else {
      if (typeof BackgroundKeeper !== 'undefined' && BackgroundKeeper.stopKeepAlive) {
        try {
          BackgroundKeeper.stopKeepAlive();
        } catch {}
      }
    }
  }
}
