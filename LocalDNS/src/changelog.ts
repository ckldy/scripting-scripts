/**
 * 版本更新提示（What's New）
 *
 * 规则：
 * - 只有「当前版本」的首次启动会展示一次更新内容；
 * - 展示后把版本号写入 Storage，同一个版本不再重复弹出；
 * - 换新版本（版本号变化）后的首次启动会再次展示，随后同样只弹一次；
 * - 版本号读取失败（v?）时不弹也不写入，避免误把提示永久吞掉。
 *
 * 文案只放在这里，index.tsx 只负责调用，新增版本时补一条 RELEASE_NOTES 即可。
 */

export interface ReleaseNote {
  /** 与 script.json 保持一致，不带前导 v */
  version: string;
  /** 构建日期，仅用于界面展示 */
  build: string;
  /** 本次更新的要点，每条会渲染成一行「• …」 */
  items: string[];
}

/** Storage 里记录「已看过提示」的版本号 */
export const UPDATE_NOTICE_SEEN_KEY = 'localdns_update_notice_seen_version';

/** 新的在前；只有 version 与当前版本一致的那一条会被展示 */
export const RELEASE_NOTES: ReleaseNote[] = [
  {
    version: '1.15.22',
    build: '20261127',
    items: [
      '新：主组全失败不再直接 SERVFAIL——按 off/safe/aggressive 三档回落（默认 safe）',
      '新：单节点连续失败 2 次冷却 45 秒，不再每次白等 6 秒（熔断）',
      '新：aggressive 降级国内时结果不进境外缓存池、TTL ≤ 60 秒、日志与 metrics 标记',
      '新：工作台「联动与运行状态」新增回落策略下拉与节点冷却秒数',
    ],
  },
  {
    version: '1.15.21',
    build: '20261125',
    items: [
      '新：托管模块自动检测上游更新——后台每 6 小时巡检，模块卡片显示「🆕 有更新」与上游版本',
      '新：「🔍 检查更新」按钮（只对比不改内容），打开模块页首次会自动检查一次',
      '修：刷新模块时采用上游 #!name，毒奶这类「(2026年11月25日更新)」的日期名会跟着更新',
      '修：刷新后区分「已更新」与「已是最新」，不再把内容未变也报成更新',
    ],
  },
  {
    version: '1.15.20',
    build: '20261125',
    items: [
      '修复：概览「上游 DNS 健康」改用当前错误轮次口径，不再把一次启动抖动永久标红',
      '本地补丁版改名为 app-…-local.js，避开浏览器一年期 immutable 缓存继续用旧界面',
      '说明：重启后约 1 分钟内境外 DoH 超时属随道重连，不是解析链路改动',
    ],
  },
  {
    version: '1.15.19',
    build: '20261125',
    items: [
      '新增：版本更新后首次启动展示更新内容，仅提示一次',
      '界面已同步上游 FJO02 / UI 2026.11.21.1',
      '查询详情新增「缓存来源」：原始分流 / 原始上游尝试',
      '解析页按上游显示当前错误轮次与轮次成功率',
      '错误原因细分为超时 / TLS / 拒绝 / 中断等',
      '模块库已从备份恢复 7 个模块，YouTube Enhance 保持关闭',
    ],
  },
  {
    version: '1.15.18',
    build: '20261125',
    items: [
      '界面同步上游 FJO02 / UI 2026.11.21.1',
      '查询详情新增「缓存来源」：原始分流 / 原始上游尝试',
      '解析页按上游显示当前错误轮次与轮次成功率',
      '模块库从 11-07 备份恢复 7 个模块',
    ],
  },
  {
    version: '1.15.17',
    build: '20261116',
    items: [
      'Surge 联动状态条改为三态，探测失败自动重试一次',
      '停在配置页时每 30 秒重探，只重绘状态条不丢当前标签',
    ],
  },
  {
    version: '1.15.16',
    build: '20261116',
    items: ['精确同步上游 FJN8C / UI 2026.11.08.4（7 处 Surge 补丁零丢失）'],
  },
];

/** 把 "1.15.18" / "v1.15.18" / " 1.15.18 " 归一成 "1.15.18"；无法识别时返回空串 */
export function normalizeVersion(raw: unknown): string {
  const text = String(raw ?? '').trim();
  const m = /^v?(\d+(?:\.\d+)*)/i.exec(text);
  return m ? m[1] : '';
}

/** 取当前版本对应的更新说明；没有对应条目时返回 null */
export function releaseNoteFor(rawVersion: unknown): ReleaseNote | null {
  const version = normalizeVersion(rawVersion);
  if (!version) return null;
  return RELEASE_NOTES.find((note) => note.version === version) || null;
}

/** 是否需要展示：当前版本不为空、有对应说明、且记录的已看版本与之不同 */
export function shouldShowUpdateNotice(seenVersion: unknown, currentVersion: unknown): boolean {
  const current = normalizeVersion(currentVersion);
  if (!current) return false;
  if (!releaseNoteFor(current)) return false;
  return normalizeVersion(seenVersion) !== current;
}

/** 渲染成 Dialog.alert 的正文 */
export function renderReleaseNote(note: ReleaseNote): string {
  const head = `版本 ${note.version} · 构建 ${note.build}`;
  const body = note.items.map((item) => `• ${item}`).join('\n');
  const tail = '此提示每个版本只出现一次。';
  return [head, '', body, '', tail].join('\n');
}

// ---------------------------------------------------------------------------
// 展示层：依赖宿主全局 Storage / Dialog（两者都不需要也不应该从 'scripting' 导入）
// ---------------------------------------------------------------------------

/** 同一次进程只尝试一次，避免反复收起/展开页面时重复入队 */
let noticeAttempted = false;

/**
 * 当前版本首次启动时弹一次更新提示，返回是否真的弹了。
 * - 用户确认后才写已看版本；中途被杀掉下次仍会提示
 * - 版本未知（v?）或没有对应文案时不弹也不写
 * - 宿主没有 Dialog 时静默跳过（不影响主界面）
 */
export async function showUpdateNoticeOnce(currentVersion: unknown): Promise<boolean> {
  if (noticeAttempted) return false;
  noticeAttempted = true;

  const note = releaseNoteFor(currentVersion);
  if (!note) return false;

  let seen = '';
  try {
    if (typeof Storage !== 'undefined' && typeof Storage.get === 'function') {
      seen = String(Storage.get<string>(UPDATE_NOTICE_SEEN_KEY) || '');
    }
  } catch (e) {
    console.warn('[LocalDNS] 读取更新提示状态失败：', String(e));
  }
  if (!shouldShowUpdateNotice(seen, currentVersion)) return false;

  const dialog = (globalThis as any)?.Dialog;
  if (!dialog || typeof dialog.alert !== 'function') return false;

  try {
    await dialog.alert({
      title: `已更新到 v${note.version}`,
      message: renderReleaseNote(note),
      buttonLabel: '知道了',
    });
  } catch (e) {
    console.warn('[LocalDNS] 提示展示失败：', String(e));
    return false;
  }

  try {
    if (typeof Storage !== 'undefined' && typeof Storage.set === 'function') {
      Storage.set(UPDATE_NOTICE_SEEN_KEY, note.version);
    }
  } catch (e) {
    console.warn('[LocalDNS] 提示状态写入失败：', String(e));
  }
  return true;
}
