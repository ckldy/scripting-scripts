/**
 * YouTube 去广告规则的**单一真相**（Single Source of Truth）。
 *
 * 背景（2026-11-07 事故）：同一条「内置网页 JSON 脚本」的 pattern / max-size / script URL
 * 曾散落在 5 个地方（编译循环、兜底注入、canary 生成、DB、静态模块），改一处漏四处，
 * 导致「网页无法播放」与「改了没生效」反复出现。
 *
 * 约定：
 *  - 任何需要「内置网页脚本 Surge 行」的地方，都必须调用 renderBuiltinWebRule()。
 *  - 禁止再手写 `localdns_builtin_yt_web = type=http-response,...` 长字符串。
 *  - 修改端点/上限只改本文件。
 *
 * 内存红线：绝不匹配 /watch 整页 HTML。首屏 ytInitialPlayerResponse 是内联 JS 对象字面量，
 * 不经过 JSON.parse，交给浏览器侧 AdBlockHub 的钩子剥离（零 Surge 内存）。
 * 历史 localdns_builtin_yt_html 的 3MB 整页通道曾把网络扩展内存打爆被系统杀，禁止回潮。
 */

/** 内置网页 JSON 脚本在 web/scripts/ 下的文件名（稳定名）。 */
export const YT_BUILTIN_WEB_SCRIPT = 'youtube-web.js';

/**
 * 允许进入 Surge JSON 脱水的网页 youtubei 端点。
 *
 * 2026-11-07 教训：把 browse|search|guide|get_watch|account/get_setting|navigation/resolve_url
 * 一并纳入后与「网页无法播放」同时出现，且真实响应里并不存在现有广告键（实测 6 个端点全 NONE），
 * 扩白名单没有实证收益。新增端点必须走 YT_ENDPOINT_PROMOTION_CHECKLIST。
 */
export const YT_WEB_JSON_ENDPOINTS: readonly string[] = [
  'player',
  'next',
  'reel/reel_watch_sequence',
];

/**
 * 新增端点前必须逐条满足（缺一不可）：
 *  1. 有真实带广告响应样本（非构造）
 *  2. 已确认广告字段的确切路径
 *  3. 已确认该字段不是播放必需字段
 *  4. 已有对应 fixture（tools/fixtures/youtube/）
 *  5. 播放 smoke 断言通过（streamingData / playabilityStatus / videoDetails 不受影响）
 *  6. 内存峰值验证通过（body 大小与 Surge 缓冲上限）
 *  7. Canary 灰度观察无回归
 */
export const YT_ENDPOINT_PROMOTION_CHECKLIST: readonly string[] = [
  '有真实带广告响应样本（非构造）',
  '已确认广告字段的确切路径',
  '已确认该字段不是播放必需字段',
  '已有对应 fixture',
  '播放 smoke 断言通过',
  '内存峰值验证通过',
  'Canary 灰度无回归',
];

/**
 * Surge 单响应缓冲上限（编译期 max-size）。
 *
 * 2026-11-07 已验证可播放的基线是 8MB；不要与脚本内的「可处理上限」混为一谈。
 * 实测网页端点 body：player ~11KB、next ~0.5–1.15MB、reel 更小，均在 8MB 内。
 */
export const YT_BUILTIN_WEB_MAX_SIZE = 8388608;

/**
 * 脚本内部可处理上限（web/scripts/youtube-web.js 的 MAX_PROCESS_BYTES）。
 * 超过则原样放行，绝不把大 body 拉进 JSON.parse / JSON.stringify。
 * 必须 ≤ YT_BUILTIN_WEB_MAX_SIZE，测试里有断言守着。
 */
export const YT_BUILTIN_WEB_MAX_PROCESS_BYTES = 2097152;

/** 内置网页脚本的其它固定参数（改这些会影响播放，改前请走 checklist）。 */
export const YT_BUILTIN_WEB_ENGINE = 'webview' as const;

/** 生成内置网页脚本的 URL 正则。 */
export function buildYtWebPattern(endpoints: readonly string[] = YT_WEB_JSON_ENDPOINTS): string {
  return (
    '^https?://([a-zA-Z0-9_-]+[.])?youtube[.]com/youtubei/v1/(?:' +
    endpoints.join('|') +
    ')(?:[?].*)?$'
  );
}

export interface SurgeScriptRule {
  name: string;
  pattern: string;
  /** script-path 完整 URL（由调用方注入 baseUrl 与不可变文件名） */
  scriptPath: string;
  requiresBody?: boolean;
  maxSize?: number;
  binaryBody?: boolean;
  engine?: string;
  argument?: string;
  timeout?: number;
}

/**
 * 渲染一条 Surge [Script] 行。
 * pattern 含逗号/空格/引号时必须加引号，否则 Surge INI 解析器会按逗号截断。
 */
export function renderSurgeScriptLine(rule: SurgeScriptRule): string {
  const parts: string[] = [`type=http-response`];

  const clean = String(rule.pattern || '').replace(/^["']|["']$/g, '');
  if (clean.includes(',') || clean.includes(' ') || clean.includes('"')) {
    parts.push(`pattern="${clean.replace(/"/g, '\\"')}"`);
  } else if (clean) {
    parts.push(`pattern=${clean}`);
  }

  if (rule.argument) {
    const raw = rule.argument.trim();
    const inner =
      raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2 ? raw.slice(1, -1) : raw;
    parts.push(`argument="${inner}"`);
  }
  if (rule.requiresBody) parts.push('requires-body=1');
  if (rule.maxSize !== undefined) parts.push(`max-size=${rule.maxSize}`);
  if (rule.binaryBody) parts.push('binary-body-mode=1');
  if (rule.engine) parts.push(`engine=${rule.engine}`);
  if (rule.timeout !== undefined) parts.push(`timeout=${rule.timeout}`);
  parts.push(`script-path=${rule.scriptPath}`);

  return `${rule.name} = ${parts.join(',')}`;
}

/**
 * 渲染「内置网页 JSON 脚本」的完整行。
 *
 * @param baseUrl        LocalDNS 基地址，如 http://127.0.0.1:9099
 * @param immutableFile  内容哈希文件名，如 youtube-web.010cebc8dc23.js。
 *                       传空则退回稳定名（no-store），仅用于兼容旧模块。
 */
export function renderBuiltinWebRule(baseUrl: string, immutableFile?: string): string {
  const file = immutableFile || YT_BUILTIN_WEB_SCRIPT;
  return renderSurgeScriptLine({
    name: 'localdns_builtin_yt_web',
    pattern: buildYtWebPattern(),
    scriptPath: `${baseUrl}/scripts/${file}`,
    // 2026-11-10 双面分流：这行只服务网页面，写 webMode=auto。
    // 脚本按登录态自己判：匿名 → 去广，登录 → 播放优先（删广告位会判禁播）。
    // App 面的去广告由 youtube.enhance.response 在 youtubei.googleapis.com 上做，两边不共用策略。
    argument: '{"webMode":"auto"}',
    requiresBody: true,
    maxSize: YT_BUILTIN_WEB_MAX_SIZE,
    binaryBody: true,
    engine: YT_BUILTIN_WEB_ENGINE,
  });
}

/** 内置行以该前缀开头，用于在各产物里定位/去重。 */
export const YT_BUILTIN_WEB_RULE_NAME = 'localdns_builtin_yt_web';

/** 判断某行是否是内置网页规则。 */
export function isBuiltinWebRuleLine(line: string): boolean {
  return String(line || '').trimStart().startsWith(`${YT_BUILTIN_WEB_RULE_NAME} =`);
}
