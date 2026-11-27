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
    version: '1.15.34',
    build: '20261128',
    items: [
      '彻底解决视频播放报 403 Forbidden 无法起播问题：实测抓包锁定 01:29:19 的 videoplayback 失败，由于 auto-hd 强行改写媒体流 itag，破坏了 Google Video 对 sparams 的 HMAC 签名 (sig)，服务端直接报 HTTP 403 Forbidden',
      '彻底排除破坏签名的 auto-hd 与 init 脚本：auto-hd 完全无去广告功能，移除后 videoplayback 原生合法签名直通，Google Video 正常下发视频数据',
      '保留真正负责去广告的核心脚本：*.googlevideo.com 保持在 MITM，客户端通过 ump.jsc 解密 Onesie UMP 广告包，youtubei.googleapis.com (response.jsc) 负责全量去广告与增强，客户端功能 100% 完好',
      '浏览器端 AdBlockHub v4.26.0 保持 FadBlock 级 50ms 瞬跳秒杀贴片广告与心跳凭据保护',
    ],
  },
  {
    version: '1.15.33',
    build: '20261128',
    items: [
      '终极解决网页端贴片广告去不掉问题：此前 AD_SEEK_END 默认关闭仅靠 16x 纯倍速，而在 iOS WebKit 环境下倍速被系统严格封顶，导致贴片依旧按原速播放',
      '浏览器端 AdBlockHub 升级 v4.26.0：开启 FadBlock 级贴片秒杀标准（50ms 轮询 + 自动静音 + currentTime 直达片尾强制触发 ended 事件 + 2026 全套跳过按钮瞬点），0.05 秒瞬秒任何贴片广告',
      '视觉零闪现：.ad-showing 期间全面通过 CSS 隐藏广告倒计时、广告信息卡与浮层',
      '*.googlevideo.com 保持在 Surge MITM，客户端 Enhance 全功能去广告正常生效',
    ],
  },
  {
    version: '1.15.32',
    build: '20261128',
    items: [
      '彻底解答并解决「登录账号无法播放，退出账号又能播」：登录账号时 YouTube 服务端绑定 SABR 心跳凭据 adBreakHeartbeatParams 校验，此前插件将其误删导致 Google 服务端直接切断视频分片传输（s:444）；未登录账号无此心跳校验故能播',
      '浏览器端 AdBlockHub 升级 v4.25.0：将 adBreakHeartbeatParams 与 playbackTracking 永久列入 PROTECTED_KEYS 受保护字段绝不删除，登录状态与未登录状态均可秒开正片',
      '满足客户端去广告硬需求：*.googlevideo.com 恢复保留在 Surge MITM 解密名单中，配合 ump.js GZIP 流 polyfill 确保客户端 Onesie UMP 与全功能去广告彻底生效',
      '单测 42 项及全链路 okToShip 校验全部通过',
    ],
  },
  {
    version: '1.15.31',
    build: '20261127',
    items: [
      '彻底根治「黑屏无视频」：抓包实证定位到 Surge 的 auto-hd 篡改 POST /videoplayback 请求体导致 Google Video 报 HTTP 400 Bad Request 且断流',
      '媒体流彻底直通：将 *.googlevideo.com 彻底移出 MITM，排除 auto-hd / init / ump 等流内脚本，媒体数据 100% 代理直通，杜绝 400 报错与 0 字节断流',
      '客户端 Enhance 核心功能完好：客户端 95% 以上去广告与画中画、后台播放均由 youtubei.googleapis.com (response.jsc) 独占承载，不受任何影响',
      '浏览器端 AdBlockHub 升至 v4.24.1：彻底移出 window.ytplayer 原型劫持，恢复原生对象原型链，并默认剥离广告排期解除死锁，正片秒开',
    ],
  },
  {
    version: '1.15.30',
    build: '20261127',
    items: [
      '彻底终结 YouTube 网页「黑屏不播放」：深入 WebKit 现场定位黑屏两大元凶——未剥离广告排期导致播放器死锁于 DoubleClick 0.0.0.0 广告缓冲（s:444）+ iOS Safari 手势策略导致正片就绪后停滞在 unstarted-mode',
      '浏览器端 AdBlockHub 升级 v4.24.1：默认剥离 adPlacements 排期解除 s:444，激活起播保障并在 currentTime===0 时自动拉起，点击任意位置无缝恢复声音',
      'Surge Hub 媒体脚本严格限制 c=IOS，Safari c=WEB 媒体流纯净直通代理',
    ],
  },
  {
    version: '1.15.29',
    build: '20261127',
    items: [
      '终极根治「黑窗无视频」死锁（实测 statsForNerds 从 s:444 死锁转为 s:5 就绪）：查清黑窗死锁是由于保留 adPlacements 导致播放器尝试向已被 DNS 阻断至 0.0.0.0 的 DoubleClick 加载贴片，播放器因等不到广告而无限死锁在黑屏缓冲态（playerState: 3）',
      '浏览器插件 AdBlockHub 升级 v4.24.0：对齐 uBlock Origin 官方方案默认剥离/中和 player 广告排期（保证 streamingData 完好），播放器无广告排期自然秒开正片',
      'Surge Hub 媒体脚本 pattern 彻底收窄生效：auto-hd 与 ump 仅附着客户端 c=IOS，Safari c=WEB 媒体分片 100% 走代理直通绝不进脚本缓冲',
      '结合 onAbnormalityDetected 中和与 #player-ads 白名单，播放器容器 100% 可见并恢复正常播放',
    ],
  },
  {
    version: '1.15.28',
    build: '20261127',
    items: [
      '根治网页端「无法访问此内容，请稍后再试」：定位到 Surge 的 auto-hd 脚本因 includes 转义反斜杠缺陷依然在拦截 Safari 的 c=WEB 媒体流',
      '修复 pattern 替换逻辑：includes("googlevideo.com") 改为 includes("googlevideo")，成功将 auto-hd 与 ump pattern 严格限制为 c=IOS，Safari 媒体流彻底 100% 走代理直通绝不进脚本缓冲',
      '浏览器端 AdBlockHub 升级 v4.23.0：移除导致 InnerTube 接口返回 UNPLAYABLE 的 clientScreen 伪造，回归原生 Response 流，结合 uBO onAbnormalityDetected 中和与 16x 纯倍速秒跳冲刷贴片',
      '锁定代理节点至优质稳定的日本节点，消除节点 IP 被 Google 阻断 Sorry 报错',
    ],
  },
  {
    version: '1.15.27',
    build: '20261127',
    items: [
      '网页端深度融合 uBlock Origin 官方全套去广告与防反制方案：解决网页端「登入帳戶以確認你不是機器人」/「LOGIN_REQUIRED」/「UNPLAYABLE」导致视频无法起播的问题',
      'uBO trusted-edit-inbound-object：劫持 JSON.stringify，针对 WEB 端注入 clientScreen="CHANNEL" 与 isInlinePlaybackNoAd=true，免登录直接获取无广告流',
      'uBO 官方数据转置：fetch/XHR 收到 /player 与 /get_watch 时将 adPlacements 与 adSlots 转为 no_ads，零破坏消除贴片',
      'uBO 官方自愈逻辑：检测到 LOGIN_REQUIRED 或 UNPLAYABLE 时自动调用 player.loadVideoById 自愈恢复播放',
      '媒体流窄口径：Surge Hub 中 auto-hd / ump 的 pattern 严格限制 c=IOS，彻底避免对 Safari 浏览器 c=WEB 媒体流附加 requires-body 缓冲与断流',
      '浏览器插件 AdBlockHub 升至 v4.22.0，所有契约单测全数通过',
    ],
  },
  {
    version: '1.15.26',
    build: '20261127',
    items: [
      '双机制分流：*.googlevideo.com 恢复走代理 MITM 解密，配合 ump.js GZIP 流 polyfill 确保客户端 Onesie UMP 解密与去广告功能彻底生效',
      '网页端对齐 uBlock Origin 官方核心方案：代理 Promise.prototype.then 彻底中和 YouTube 内部异常侦测回调 onAbnormalityDetected，阻止触发 player-unavailable 与隐藏视频容器',
      '遵从 uBO 官方白名单（#@##player-ads）：从广告 CSS 中剔除 #player-ads，避免触发 YouTube DOM 高度为 0 反制侦测',
      '浏览器插件 AdBlockHub 升至 v4.21.0：默认安全模式防 SABR 封播、强制 player-container 保持 visible、动态摘除 player-unavailable，页面广告与反广告弹窗全量清除',
    ],
  },
  {
    version: '1.15.25',
    build: '20261127',
    items: [
      '媒体流防断连：*.googlevideo.com 保持代理直通不进 MITM，消除 Safari 网页端 Read stream EOF 0 字节断流与客户端证书钉扎报错，客户端核心去广告与后台播放等全量功能通过 youtubei.googleapis.com MITM 完整生效',
      '修：Surge JSC 引擎缺失 DecompressionStream/CompressionStream 导致 youtube.enhance.ump 处理 gzip UMP /initplayback 静默报错放行广告，现注入纯 JS RFC1951/1952 GZIP 流 polyfill',
      '修：isYoutubeWebAdRewrite 对转义斜杠正则兼容，彻底剔除残留的 s.youtube.com/api/stats/ads 规则',
      '浏览器插件 AdBlockHub 升至 v4.20.1：默认安全模式保留排期防封播、注入强制 visible 样式保障、动态检测并摘除 player-unavailable，页面广告与反广告弹窗全量清除',
    ],
  },
  {
    version: '1.15.24',
    build: '20261127',
    items: [
      '修：YouTube Enhance 在 Surge JSC 引擎报 TextEncoder ReferenceError 崩溃，现自动发布本地 JSC 兼容不可变脚本，毫秒级生效且不再 RST',
      '分流：YouTube Enhance 独占 youtubei.googleapis.com 与 *.googlevideo.com（带浏览器 UA/c=WEB 旁路守卫），www/m/s.youtube.com 彻底移出 Surge MITM 与内置脚本',
      '浏览器插件 AdBlockHub 升至 v4.18.0：恢复 player/feed 广告脱水与默认 16x/秒跳兜底，拦截广告诱饵探测防反广告墙',
      'hub-health 同步校验 App/浏览器分流边界及本地 JSC 兼容脚本状态',
    ],
  },
  {
    version: '1.15.23',
    build: '20261127',
    items: [
      '客户端优先：媒体流 *.googlevideo.com 恢复 MITM，YouTube Enhance 全功能生效',
      '网页端去广告交给 Safari 用户脚本 AdBlockHub（页面内 hook，不依赖 MITM）',
      '修：全部 YouTube 脚本 webview → jsc（webview 实测 7–9 秒，客户端 3 秒就 RST）',
      'YouTube Enhance 模块无需关闭，客户端与网页可同时使用',
    ],
  },
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
