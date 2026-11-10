/**
 * src/rule-guard.ts
 *
 * 过宽 REJECT 规则护栏（Overbroad Rule Guard）
 *
 * 事故背景：AdHunter 曾合成并下发过
 *   URL-REGEX,"^https?:\/\/[^\/]+\/.*(ad|banner|splash|popunder).*(?:[?#]|$)",REJECT
 * 这条"裸子串"规则会把 /s/desktop/92ead095/jsbin/... 这类正常资源全部 REJECT
 * （资源哈希里含 ad 子串），导致 www.youtube.com 的 CSS/JS 被拦光、整页空白；
 * Surge 还会因频繁触发把 REJECT 升级成 REJECT-DROP，进一步放大伤害。
 *
 * 策略：REJECT 类 URL-REGEX 规则必须同时满足
 *   1) 不存在「无边界 .* 前缀 + 裸短词（ad/ads/adv）交替」这种写法；
 *   2) 不命中受保护资源语料库 PROTECTED_URL_CORPUS。
 * 违反任一条即判为过宽，禁止注入 hub.sgmodule / AdHunter 规则库。
 */

/**
 * 受保护资源语料：这些 URL 形态属于"绝对不能 REJECT"的正常资源。
 * 任何零域名规则只要命中其中一条，就说明粒度过粗。
 */
export const PROTECTED_URL_CORPUS: string[] = [
  // YouTube 桌面版页面与静态资源（哈希段常含 ad 子串，如 92ead095）
  'https://www.youtube.com/s/desktop/92ead095/jsbin/scheduler.vflset/scheduler.js',
  'https://www.youtube.com/s/desktop/92ead095/jsbin/network.vflset/network.js',
  'https://www.youtube.com/s/desktop/92ead095/cssbin/www-main-desktop-home-page-skeleton-2x.css',
  'https://www.youtube.com/s/desktop/92ead095/jsbin/webcomponents-sd.vflset/webcomponents-sd.js',
  'https://www.youtube.com/youtubei/v1/player?key=AIzaSy&prettyPrint=false',
  'https://www.youtube.com/youtubei/v1/next?key=AIzaSy&prettyPrint=false',
  'https://www.youtube.com/error_204?t=jserror&level=WARNING',
  'https://www.youtube.com/manifest.webmanifest',
  'https://www.youtube.com/sw.js',
  'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
  'https://rr1---sn-abc.googlevideo.com/videoplayback?expire=1&itag=137',
  // 通用 CDN 与常见"含 ad 子串"的正常路径
  'https://fonts.gstatic.com/s/roboto/v30/KFOmCnqEu92Fr1Mu4mxK.woff2',
  'https://cdn.example.com/files/download/report.pdf',
  'https://example.com/api/v1/load?shadow=1',
  'https://example.com/static/head-banner.css',
];

/** 短到必须加边界锚定才安全的广告词 */
const BARE_SHORT_TOKENS = /^(ad|ads|adv)$/i;

/**
 * 判断一条模块规则是否为"过宽 REJECT"。
 * @returns null 表示安全；返回字符串表示过宽原因（用于日志与 UI 提示）
 */
export function isOverbroadRejectRule(pattern: string): string | null {
  const raw = (pattern || '').trim();
  if (!raw) return null;
  if (!/REJECT/i.test(raw)) return null;
  if (!/URL-REGEX/i.test(raw)) return null;

  // 取出正则正文：优先最外层双引号内容（Surge 模块允许含逗号的正则整体加引号）
  const quoted = raw.match(/"([^"]+)"/);
  let body = quoted ? quoted[1] : '';
  if (!body) {
    const after = raw.split(/URL-REGEX\s*,?/i)[1] || '';
    body = after.split(',')[0] || '';
  }
  body = body.trim();
  if (!body) return null;

  // 1) 无边界 .* 前缀 + 裸短词交替：典型误伤形态
  if (/\.\*/.test(body)) {
    const group = body.match(/\(([^()]*)\)/);
    if (group) {
      const tokens = group[1].split('|').map((t) => t.trim());
      if (tokens.some((t) => BARE_SHORT_TOKENS.test(t))) {
        return '无边界 .* 前缀搭配裸 "ad/ads/adv" 交替，会误伤含该子串的正常 URL';
      }
    }
  }

  // 2) 语料回测：命中受保护资源即判过宽
  let re: RegExp;
  try {
    re = new RegExp(body, 'i');
  } catch {
    // 正则有语法问题，交给 Surge 自身处理，这里不误判
    return null;
  }
  for (const url of PROTECTED_URL_CORPUS) {
    try {
      if (re.test(url)) {
        return `命中受保护资源语料（${url.slice(0, 56)}…），粒度过粗`;
      }
    } catch {
      return null;
    }
  }

  return null;
}
