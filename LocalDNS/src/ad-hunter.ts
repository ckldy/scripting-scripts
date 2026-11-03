/**
 * AdHunter Service — 页面特征去广告分析与规则合成引擎
 * 
 * 核心设计哲学：
 * 1. 零域名依赖 (Zero-Domain Dependency)：针对高频换皮与域名轮换站点，基于 DOM 骨架、数据属性与运行时行为特征提取广告指纹。
 * 2. 启发式特征扫描：插槽广告 (Slots)、信息流伪装卡片 (In-Feed Cards via :has)、文字推广矩阵、全屏遮罩/年龄弹窗、核心广告引擎脚本。
 * 3. 三维规则合成：CSS 纯特征隐藏样式、运行时 Defuser 脚本、Surge 零域名 URL-REGEX 规则。
 * 4. 一键部署：直通 LocalDNS SQLite 规则库与 Safari Extension userscripts 目录。
 */

import { SurgeDatabase } from './surge-db';
import { SurgeService } from './surge-service';

export interface AdFeatureReport {
  targetUrl: string;
  domain: string;
  analyzedAt: string;
  cmsFamily: {
    id: string; // 'heiliao' | 'javtiful' | 'maccms' | 'universal'
    name: string;
    confidence: number;
    signaturesFound: string[];
  };
  stats: {
    totalAdsDetected: number;
    slotsCount: number;
    inFeedCardsCount: number;
    popupsCount: number;
    textMatricesCount: number;
    navPromosCount: number;
    scriptEnginesCount: number;
  };
  detectedSlots: Array<{
    selector: string;
    description: string;
    slotKey?: string;
    variant?: string;
  }>;
  inFeedCards: {
    detected: boolean;
    containerSelector: string;
    cardSelector: string;
    features: string[];
  };
  popupsAndOverlays: Array<{
    selector: string;
    description: string;
    type: 'age_gate' | 'modal' | 'player_overlay' | 'float_banner';
  }>;
  textLinkMatrices: Array<{
    selector: string;
    description: string;
  }>;
  fakeNavigationPromos: Array<{
    selector: string;
    description: string;
  }>;
  scriptEngines: Array<{
    path: string;
    zeroDomainRegex: string;
    type: 'slot_engine' | 'popunder' | 'tracker' | 'ad_network';
    description: string;
  }>;
  synthesizedRules: {
    cssCosmetic: string;
    defuserScriptlet: string;
    surgeUrlRegex: string[];
    userscriptCode: string;
  };
}

export class AdHunterService {
  private static instance: AdHunterService;

  static get(): AdHunterService {
    if (!AdHunterService.instance) {
      AdHunterService.instance = new AdHunterService();
    }
    return AdHunterService.instance;
  }

  /**
   * 自动抓取目标页面并进行深度特征分析与规则合成
   */
  public async analyzeUrl(rawUrl: string): Promise<AdFeatureReport> {
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      throw new Error('无效的 URL 地址');
    }

    // 使用真实移动端 Safari UA 请求目标页面
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    let html = '';
    try {
      const res = await fetch(parsed.href, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh-Hans;q=0.9',
        },
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (!res.ok) {
        throw new Error(`目标网站响应错误: HTTP ${res.status}`);
      }
      html = await res.text();
    } catch (e: any) {
      clearTimeout(timer);
      throw new Error(`抓取目标网页失败: ${e?.message || '网络连接超时'}`);
    }

    return this.inspectHtml(parsed.href, parsed.hostname, html);
  }

  /**
   * 基于 Surge TF436 落盘抓包会话 (Saved Capture Sessions) 深度提取广告接口特征并自动合成规则
   */
  public async analyzeCaptureSession(sessionName: string, maxRequests = 120): Promise<AdFeatureReport> {
    const surgeService = SurgeService.get();
    const reqRes = await surgeService.listCaptureSessionRequests(sessionName, 0, maxRequests);
    if (reqRes.error) {
      throw new Error(`读取 Surge 抓包会话失败: ${reqRes.error}`);
    }

    const requests = reqRes.requests || [];
    if (requests.length === 0) {
      throw new Error(`抓包会话 [${sessionName}] 为空或无请求记录`);
    }

    const report: AdFeatureReport = {
      targetUrl: `surge-session://${sessionName}`,
      domain: `capture-session:${sessionName}`,
      analyzedAt: new Date().toISOString(),
      cmsFamily: {
        id: 'capture_session',
        name: `Surge 抓包会话 [${sessionName}]`,
        confidence: 0.9,
        signaturesFound: [],
      },
      stats: {
        totalAdsDetected: 0,
        slotsCount: 0,
        inFeedCardsCount: 0,
        popupsCount: 0,
        textMatricesCount: 0,
        navPromosCount: 0,
        scriptEnginesCount: 0,
      },
      detectedSlots: [],
      inFeedCards: {
        detected: false,
        containerSelector: '',
        cardSelector: '',
        features: [],
      },
      popupsAndOverlays: [],
      textLinkMatrices: [],
      fakeNavigationPromos: [],
      scriptEngines: [],
      synthesizedRules: {
        cssCosmetic: '',
        defuserScriptlet: '',
        surgeUrlRegex: [],
        userscriptCode: '',
      },
    };

    // 广告与追踪特征识别模式（覆盖下划线、斜杠及各分隔符）
    const AD_URL_PATTERN = /(?:^|[^a-zA-Z0-9])(ad|ads|advert|banner|splash|popunder|tracker|telemetry|analytics|notice|promo|marketing|delivery|pgx|open_screen|boot_ad)(?:[^a-zA-Z0-9]|$)/i;
    const AD_PAYLOAD_KEYS = ['ad_list', 'ad_slots', 'adplacement', 'splash', 'creatives', 'materials', 'feed_ads', 'infeed', 'popup', 'interstitial', 'ads', 'advertisement'];

    // 筛选出疑似广告请求
    const candidateReqs = requests.filter((r) => {
      const url = r.URL || r.url || '';
      const notes = Array.isArray(r.notes) ? r.notes.join(' ') : '';
      return AD_URL_PATTERN.test(url) || AD_URL_PATTERN.test(notes);
    });

    // 并发提取候选请求的响应 Body 进行特征识别
    const toInspect = candidateReqs.slice(0, 30);
    const bodyPromises = toInspect.map(async (req) => {
      const key = req.key || String(req.id);
      try {
        const bodyRes = await surgeService.getCaptureSessionData(sessionName, key, 'response');
        return { req, bodyText: bodyRes.text || '' };
      } catch {
        return { req, bodyText: '' };
      }
    });

    const inspectedItems = await Promise.all(bodyPromises);
    const detectedRegexSet = new Set<string>();

    for (const item of inspectedItems) {
      const req = item.req;
      const urlStr = req.URL || req.url || '';
      const body = item.bodyText;

      let isAdHit = false;
      let adDesc = '抓包特征命中广告接口';

      // 1. JSON 键名扫描
      if (body.startsWith('{') || body.startsWith('[')) {
        for (const k of AD_PAYLOAD_KEYS) {
          if (body.toLowerCase().includes(`"${k}"`)) {
            isAdHit = true;
            adDesc = `响应 JSON 包含广告载荷字段 [${k}]`;
            report.cmsFamily.signaturesFound.push(`JSON_KEY:${k}`);
            break;
          }
        }
      }

      // 2. URL 强模式扫描
      if (!isAdHit && AD_URL_PATTERN.test(urlStr)) {
        isAdHit = true;
        adDesc = 'URL 路径命中广告拦截指纹';
      }

      if (isAdHit) {
        report.stats.totalAdsDetected++;
        report.stats.scriptEnginesCount++;

        // 提取零域名 URL-REGEX 规则
        try {
          const u = new URL(urlStr.startsWith('http') ? urlStr : `http://${urlStr}`);
          const pathRegex = u.pathname.replace(/\/[0-9a-f]{8,}/gi, '/[a-f0-9]+').replace(/\/(\d+)(\/|$)/g, '/\\d+$2');
          const zeroRegex = `^https?://[^/]+${pathRegex}(?:[?#]|$)`;
          if (!detectedRegexSet.has(zeroRegex)) {
            detectedRegexSet.add(zeroRegex);
            report.scriptEngines.push({
              path: u.pathname,
              zeroDomainRegex: zeroRegex,
              type: 'ad_network',
              description: `${adDesc} (${u.hostname}${u.pathname})`,
            });
          }
        } catch {
          const cleanPath = urlStr.split('?')[0].split('#')[0];
          const zeroRegex = `^https?://[^/]+/${cleanPath.replace(/^\/+/, '')}`;
          if (!detectedRegexSet.has(zeroRegex)) {
            detectedRegexSet.add(zeroRegex);
            report.scriptEngines.push({
              path: cleanPath,
              zeroDomainRegex: zeroRegex,
              type: 'ad_network',
              description: adDesc,
            });
          }
        }
      }
    }

    report.synthesizedRules = this.synthesizeRules(report);
    return report;
  }

  /**
   * 纯 HTML 内容特征解析（支持从 HTML 字符串或已抓取内容检测）
   */
  public inspectHtml(targetUrl: string, domain: string, html: string): AdFeatureReport {
    const report: AdFeatureReport = {
      targetUrl,
      domain,
      analyzedAt: new Date().toISOString(),
      cmsFamily: {
        id: 'universal',
        name: '通用自适应 CMS',
        confidence: 0.5,
        signaturesFound: [],
      },
      stats: {
        totalAdsDetected: 0,
        slotsCount: 0,
        inFeedCardsCount: 0,
        popupsCount: 0,
        textMatricesCount: 0,
        navPromosCount: 0,
        scriptEnginesCount: 0,
      },
      detectedSlots: [],
      inFeedCards: {
        detected: false,
        containerSelector: '',
        cardSelector: '',
        features: [],
      },
      popupsAndOverlays: [],
      textLinkMatrices: [],
      fakeNavigationPromos: [],
      scriptEngines: [],
      synthesizedRules: {
        cssCosmetic: '',
        defuserScriptlet: '',
        surgeUrlRegex: [],
        userscriptCode: '',
      },
    };

    // ==================== 1. CMS 基因特征探测 ====================
    if (html.includes('xqbj-container') || html.includes('HlwPgxAds') || html.includes('__SSP_ENABLED__')) {
      report.cmsFamily = {
        id: 'heiliao',
        name: '黑料社区 / 吃瓜爆料网 (Heiliao v4 CMS)',
        confidence: 0.98,
        signaturesFound: ['#xqbj-container', 'window.HlwPgxAds', 'window.__SSP_ENABLED__'],
      };
    } else if (html.includes('front-player') || html.includes('watch-config') || html.includes('data-front-feature-placement')) {
      report.cmsFamily = {
        id: 'javtiful',
        name: 'Javtiful / 成人视频 VOD 架构',
        confidence: 0.96,
        signaturesFound: ['#front-player', 'script#watch-config', 'data-front-feature-placement'],
      };
    } else if (html.includes('stui-') || html.includes('myui-') || html.includes('mac_')) {
      report.cmsFamily = {
        id: 'maccms',
        name: '苹果CMS / 影视聚合模版',
        confidence: 0.90,
        signaturesFound: ['stui/myui 骨架类名', 'MacPlayer 调度器'],
      };
    }

    // ==================== 2. 插槽类广告 (Slots) 探测 ====================
    const slotRegex = /class=["\'][^"\']*?(pgx-slot|front-feature-placement|ssp-placement|component-advertises)[^"\']*?["\']/gi;
    const dataSlotRegex = /data-slot=["\']([^"\']+)["\']/gi;
    const foundDataSlots = new Set<string>();
    let m: RegExpExecArray | null;

    while ((m = dataSlotRegex.exec(html)) !== null) {
      foundDataSlots.add(m[1]);
    }

    if (html.includes('pgx-slot') || html.includes('data-slot') || html.includes('component-advertises')) {
      report.detectedSlots.push({
        selector: '.pgx-slot, [data-slot]',
        description: 'PGX / SSP 动态插槽广告位 (' + Array.from(foundDataSlots).join(', ') + ')',
      });
      report.detectedSlots.push({
        selector: '.component-advertises, .component-advertises-0, .component-advertises-1',
        description: '广告容器包装组件',
      });
      report.detectedSlots.push({
        selector: '.slider-banners, .swiper-banners-container, .ssp-placement, template[data-ssp-legacy]',
        description: '轮播横幅与遗留 SSP 占位模板',
      });
    }

    if (html.includes('data-front-feature-placement') || html.includes('front-feature-placement')) {
      report.detectedSlots.push({
        selector: '[data-front-feature-placement], .front-feature-placement',
        description: 'Javtiful 官方统一定义广告位',
      });
      report.detectedSlots.push({
        selector: '.front-feature-placement-wide, .front-feature-placement-side, .announcement-bar, [data-text-ads], [data-leaderboard]',
        description: '页面顶部/底部通栏及侧边栏横幅广告',
      });
    }

    // ==================== 3. 信息流混排伪装卡片 (In-Feed Cards) 探测 ====================
    if (html.includes('pgx-card') || html.includes('data-event="ad_click"') || html.includes('data-ad_slot_key')) {
      report.inFeedCards = {
        detected: true,
        containerSelector: '.video-item:has(a.pgx-card), .video-item:has(a[data-event="ad_click"])',
        cardSelector: 'a.pgx-card, a[data-event="ad_click"][rel*="sponsored"]',
        features: ['a.pgx-card', 'data-event="ad_click"', 'data-ad_slot_key', 'rel="sponsored"'],
      };
    } else if (html.includes('data-home-live')) {
      report.inFeedCards = {
        detected: true,
        containerSelector: 'section[data-home-live], .home-live',
        cardSelector: 'a[href*="ohmycams.com"]',
        features: ['section[data-home-live]', 'data-endpoint="/zh/api/live/home-source"'],
      };
    }

    // ==================== 4. 遮罩、全屏弹窗与年龄拦截 探测 ====================
    if (html.includes('age-gate')) {
      report.popupsAndOverlays.push({
        selector: '#age-gate, .age-gate, .age-gate-box, .age-gate-overlay',
        description: '18禁年龄拦截确认遮罩（阻断访问并锁定滚动）',
        type: 'age_gate',
      });
    }
    if (html.includes('front-feature-placement-player')) {
      report.popupsAndOverlays.push({
        selector: '.front-feature-placement-player',
        description: '直接覆盖在视频播放器上的半透明/嵌入式悬浮广告框',
        type: 'player_overlay',
      });
    }
    if (html.includes('pop_notice') || html.includes('pop_grid') || html.includes('popup_image')) {
      report.popupsAndOverlays.push({
        selector: '.pgx-slot[data-variant="popup_image"], .pgx-slot[data-variant="grid"], .pgx-slot[data-variant="float"]',
        description: '进入页面后弹出的单图与网格弹窗',
        type: 'modal',
      });
    }

    // ==================== 5. 密集文字推广矩阵 探测 ====================
    if (html.includes('detail-list-title') || html.includes('btnads_3') || html.includes('data-variant="text"')) {
      report.textLinkMatrices.push({
        selector: '.detail-list-title:has(a[data-event="ad_click"]), .detail-list-title:has(a[rel*="sponsored"]), a.gotoclick[data-event="ad_click"]',
        description: '正文下方密集的 40+ 条色情/博彩外链文字推广网格',
      });
    }

    // ==================== 6. 伪装原生导航与虚假外链 探测 ====================
    if (html.includes('footer-menu') && html.includes('target="_blank"')) {
      report.fakeNavigationPromos.push({
        selector: '.footer-menu a[target="_blank"], .footer-menu a[href^="http"]',
        description: '底部导航栏中伪装成原生功能的“官方APP”、“福利”等外链推广',
      });
    }
    if (html.includes('footer-list') && (html.includes('qq.png') || html.includes('peach-av'))) {
      report.fakeNavigationPromos.push({
        selector: '.footer-list a:has(img.qq), .footer-list a[href*="peach-av"]',
        description: '页脚使用官方社交图标（QQ/微信）伪装的色情引流外链',
      });
    }

    // ==================== 7. 脚本路径与核心广告引擎 探测 ====================
    const scriptSrcMatches = html.match(/src=["\']([^"\']+\.js[^"\']*)["\']/gi) || [];
    const scriptPaths = new Set<string>();
    for (const match of scriptSrcMatches) {
      const src = match.replace(/^src=["\']/i, '').replace(/["\']$/, '').split('?')[0];
      if (
        src.includes('slot-ads') ||
        src.includes('bottom-popup') ||
        src.includes('tjtag') ||
        src.includes('cogninotow') ||
        src.includes('fozekikikiminu') ||
        src.includes('janitorprecision') ||
        src.includes('loud-hall') ||
        src.includes('tapioni')
      ) {
        scriptPaths.add(src);
      }
    }

    for (const p of scriptPaths) {
      const isExternal = p.startsWith('http://') || p.startsWith('https://') || p.startsWith('//');
      const cleanPath = isExternal ? new URL(p.startsWith('//') ? 'https:' + p : p).pathname : p;
      const zeroRegex = `^https?:\\/\\/[^\\/]+${cleanPath.replace(/\./g, '\\.')}`;
      report.scriptEngines.push({
        path: p,
        zeroDomainRegex: zeroRegex,
        type: cleanPath.includes('slot-ads') || cleanPath.includes('bottom-popup') ? 'slot_engine' : 'ad_network',
        description: cleanPath.includes('slot-ads') ? '自研 PGX 广告插槽调度引擎' : cleanPath.includes('tjtag') ? '点击埋点与数据上报脚本' : '外部广告联盟与弹窗脚本',
      });
    }

    // ==================== 统计汇总结算 ====================
    report.stats.slotsCount = report.detectedSlots.length;
    report.stats.inFeedCardsCount = report.inFeedCards.detected ? 1 : 0;
    report.stats.popupsCount = report.popupsAndOverlays.length;
    report.stats.textMatricesCount = report.textLinkMatrices.length;
    report.stats.navPromosCount = report.fakeNavigationPromos.length;
    report.stats.scriptEnginesCount = report.scriptEngines.length;
    report.stats.totalAdsDetected =
      report.stats.slotsCount +
      report.stats.inFeedCardsCount +
      report.stats.popupsCount +
      report.stats.textMatricesCount +
      report.stats.navPromosCount +
      report.stats.scriptEnginesCount;

    // ==================== 8. 自动化规则合成 (Rule Synthesis) ====================
    report.synthesizedRules = this.synthesizeRules(report);

    return report;
  }

  /**
   * 将检测到的特征聚合成 纯特征 CSS / Defuser 脚本 / Surge 规则 / Userscript
   */
  private synthesizeRules(report: AdFeatureReport): {
    cssCosmetic: string;
    defuserScriptlet: string;
    surgeUrlRegex: string[];
    userscriptCode: string;
  } {
    const cssSelectors: string[] = [];

    // 1. 槽位
    for (const slot of report.detectedSlots) {
      cssSelectors.push(slot.selector);
    }
    // 2. 信息流卡片
    if (report.inFeedCards.detected && report.inFeedCards.containerSelector) {
      cssSelectors.push(report.inFeedCards.containerSelector);
      cssSelectors.push(report.inFeedCards.cardSelector);
    }
    // 3. 文字矩阵
    for (const tm of report.textLinkMatrices) {
      cssSelectors.push(tm.selector);
    }
    // 4. 伪装导航
    for (const nav of report.fakeNavigationPromos) {
      cssSelectors.push(nav.selector);
    }
    // 5. 遮罩弹窗
    for (const pop of report.popupsAndOverlays) {
      cssSelectors.push(pop.selector);
    }

    // 去重合并
    const uniqueCssSelectors = Array.from(new Set(cssSelectors.flatMap(s => s.split(',').map(x => x.trim())).filter(Boolean)));
    let cssCosmetic = uniqueCssSelectors.join(',\n') + ` {\n  display: none !important;\n  visibility: hidden !important;\n  height: 0 !important;\n  pointer-events: none !important;\n  z-index: -9999 !important;\n}`;

    // 针对页面可能挂载的 fixbody 滚动锁定，强制物理覆盖解除
    cssCosmetic += `\n\n/* === 物理防锁死：彻底粉碎 fixbody 对页面滚动的劫持 === */\nhtml,\nbody,\nhtml.fixbody,\nbody.fixbody,\nbody.navbar,\n#xqbj-container {\n  overflow: visible !important;\n  overflow-y: auto !important;\n  height: auto !important;\n  min-height: 100% !important;\n  max-height: none !important;\n  position: static !important;\n  touch-action: auto !important;\n  -webkit-overflow-scrolling: touch !important;\n}`;

    // Defuser 脚本代码
    let defuserScriptlet = `// 运行时基因检测与广告引擎灭活 (零域名依赖)\n`;
    if (report.cmsFamily.id === 'heiliao') {
      defuserScriptlet += `try {\n  const now = new Date();\n  const dateKey = \`\${now.getFullYear()}-\${String(now.getMonth() + 1).padStart(2, '0')}-\${String(now.getDate()).padStart(2, '0')}\`;\n  localStorage.setItem('hlw_age_verify_date', dateKey);\n} catch (_) {}\nObject.defineProperty(window, 'HlwPgxAds', {\n  get: () => ({ boot: () => {} }),\n  set: () => {},\n  configurable: false\n});\nwindow.__SSP_ENABLED__ = false;\nwindow.__SSP_SLOTS__ = [];\n`;
    }
    defuserScriptlet += `// 弹窗与点击劫持防御 (Popunder Defuser)\nconst _rawOpen = window.open;\nwindow.open = function(url, target, features) {\n  if (!url || /sponsored|aff|chat|game|peach|trwl1|ohmycams/i.test(url)) {\n    console.log('[AdHunter] 阻断恶意弹窗:', url);\n    return null;\n  }\n  return _rawOpen.call(window, url, target, features);\n};\n`;

    // Surge 规则（零域名 URL-REGEX）
    const surgeUrlRegex: string[] = [];
    for (const engine of report.scriptEngines) {
      if (engine.zeroDomainRegex) {
        surgeUrlRegex.push(`URL-REGEX,"${engine.zeroDomainRegex}",REJECT`);
      }
    }

    // 打包完整 Userscript
    const userscriptCode = `// ==UserScript==
// @name         AdHunter 智能特征去广告 [${report.cmsFamily.name}]
// @namespace    https://github.com/LocalDNS/AdHunter
// @version      1.0.0
// @description  基于 DOM 基因与行为特征的高精度纯净去广告，零域名依赖，无惧换皮与域名轮换
// @match        *://*/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function() {
  'use strict';

  // 1. 基因特征探针
  function isTargetPage() {
    return !!(
      document.getElementById('xqbj-container') ||
      document.getElementById('front-player') ||
      document.querySelector('.pgx-slot, [data-front-feature-placement], #age-gate') ||
      window.__SSP_ENABLED__ !== undefined ||
      window.HlwPgxAds !== undefined
    );
  }

  // 2. 运行时灭活
  ${defuserScriptlet}

  // 3. 注入纯特征 CSS 规则
  function applyStyles() {
    if (document.getElementById('adhunter-feature-style')) return;
    const style = document.createElement('style');
    style.id = 'adhunter-feature-style';
    style.textContent = \`${cssCosmetic}\`;
    (document.head || document.documentElement).appendChild(style);
  }

  // 4. DOM 守卫与弹窗速解
  function guard() {
    if (!isTargetPage()) return;
    applyStyles();

    // 自动解开 18 岁弹窗对页面滚动的锁定
    const gate = document.getElementById('age-gate');
    if (gate) gate.remove();
    if (document.body) {
      document.body.classList.remove('fixbody');
      document.body.style.removeProperty('overflow');
      document.body.style.removeProperty('height');
      document.body.style.removeProperty('position');
    }
    if (document.documentElement) {
      document.documentElement.classList.remove('fixbody');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', guard);
  } else {
    guard();
  }

  const observer = new MutationObserver(guard);
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
`;

    return {
      cssCosmetic,
      defuserScriptlet,
      surgeUrlRegex,
      userscriptCode,
    };
  }

  /**
   * 一键下发规则到 LocalDNS / Surge 模块
   */
  public async deployToSurge(report: AdFeatureReport): Promise<{ success: boolean; rulesAdded: number; message: string }> {
    const db = SurgeDatabase.get();
    await db.init();

    const added = await db.addAdHunterRules(report.synthesizedRules.surgeUrlRegex);

    // 2. 触发 LocalDNS 重新编译 Hub 模块并通知 Surge 热重载
    try {
      const surgeService = SurgeService.get();
      await surgeService.reloadSurgeHubModule();
    } catch (e) {
      console.warn('Surge reload notice failed:', e);
    }

    return {
      success: true,
      rulesAdded: added,
      message: `已成功部署 ${added} 条零域名 URL-REGEX 规则到 LocalDNS Unified Hub，并触发 Surge 重新加载！`,
    };
  }

  /**
   * 一键安装或更新到 Safari Extension Userscript 目录
   */
  public async deployToUserscript(fileName: string, scriptContent: string): Promise<{ success: boolean; filePath: string }> {
    const userscriptDir = '/var/mobile/Library/Mobile Documents/iCloud~com~thomfang~Scripting/Documents/scripting-safari-extension/userscripts/';
    const safeName = fileName.endsWith('.user.js') ? fileName : `${fileName}.user.js`;
    const targetPath = `${userscriptDir}${safeName}`;

    await FileManager.writeAsString(targetPath, scriptContent);
    return {
      success: true,
      filePath: targetPath,
    };
  }

  /**
   * 一键全端自动化合流：
   * 1. 网络层规则自动注入 LocalDNS SQLite 模块 mod_adhunter，并触发 Surge 模块热重载
   * 2. 界面层与行为层规则自动合并注入全局母核 AdBlockHub.user.js，彻底免除多文件与二次导入
   */
  public async autoSyncToHub(report: AdFeatureReport): Promise<{
    success: boolean;
    surgeRulesAdded: number;
    selectorsMerged: number;
    filePath: string;
    message: string;
  }> {
    // 1. 同步至 Surge 模块与 LocalDNS SQLite 规则库
    let surgeRulesAdded = 0;
    try {
      const surgeRes = await this.deployToSurge(report);
      surgeRulesAdded = surgeRes.rulesAdded;
    } catch (e) {
      console.warn('[AdHunter] deployToSurge error:', e);
    }

    // 2. 提取报告中的所有候选选择器
    const candidateSelectors: string[] = [];
    if (report.detectedSlots) {
      for (const s of report.detectedSlots) {
        if (s.selector) candidateSelectors.push(...s.selector.split(','));
      }
    }
    if (report.inFeedCards && report.inFeedCards.detected && report.inFeedCards.containerSelector) {
      candidateSelectors.push(...report.inFeedCards.containerSelector.split(','));
    }
    if (report.textLinkMatrices) {
      for (const t of report.textLinkMatrices) {
        if (t.selector) candidateSelectors.push(...t.selector.split(','));
      }
    }
    if (report.popupsAndOverlays) {
      for (const p of report.popupsAndOverlays) {
        if (p.selector) candidateSelectors.push(...p.selector.split(','));
      }
    }
    if (report.fakeNavigationPromos) {
      for (const n of report.fakeNavigationPromos) {
        if (n.selector) candidateSelectors.push(...n.selector.split(','));
      }
    }

    // 规范化并去重候选选择器
    const cleanCandidates = Array.from(
      new Set(
        candidateSelectors
          .map((s) => s.trim())
          .filter((s) => s.length > 0 && !s.startsWith('/*'))
      )
    );

    // 3. 读取全局母核 AdBlockHub.user.js
    const hubPath = '/var/mobile/Library/Mobile Documents/iCloud~com~thomfang~Scripting/Documents/scripting-safari-extension/userscripts/AdBlockHub.user.js';
    let hubCode = '';
    try {
      hubCode = await FileManager.readAsString(hubPath);
    } catch (e) {
      console.warn('[AdHunter] read AdBlockHub.user.js failed:', e);
    }

    let selectorsMerged = 0;
    if (hubCode && cleanCandidates.length > 0) {
      // 找出当前母核中尚未包含的选择器
      const newSelectors = cleanCandidates.filter((sel) => !hubCode.includes(sel));

      if (newSelectors.length > 0) {
        const dateTag = new Date().toISOString().slice(0, 10);
        const sourceTag = report.cmsFamily?.name || report.domain || 'AdHunter';
        const injectionBlock = `\n    /* [AdHunter 自动合流: ${sourceTag} (${dateTag})] */\n    ${newSelectors.join(',\n    ')},`;

        // 插入在 #limbo-ad-notice { 之前，保证语法完全合法
        if (hubCode.includes('#limbo-ad-notice {')) {
          hubCode = hubCode.replace('#limbo-ad-notice {', `${injectionBlock}\n    #limbo-ad-notice {`);
        } else if (hubCode.includes('display: none !important;')) {
          hubCode = hubCode.replace('display: none !important;', `${injectionBlock}\n      display: none !important;`);
        }

        // 保存更新后的母核脚本
        await FileManager.writeAsString(hubPath, hubCode);
        selectorsMerged = newSelectors.length;
      }
    }

    return {
      success: true,
      surgeRulesAdded,
      selectorsMerged,
      filePath: hubPath,
      message: `已全端自动化合流生效：Surge 注入 ${surgeRulesAdded} 条网络规则，Safari 母核合并 ${selectorsMerged} 个特征选择器！`,
    };
  }
}
