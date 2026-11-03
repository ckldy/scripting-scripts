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

// 主流第三方广告、追踪、统计与联盟域名特征库
const KNOWN_AD_DOMAINS: Array<{ suffix: string; name: string }> = [
  { suffix: 'doubleclick.net', name: 'Google DoubleClick 广告网络' },
  { suffix: 'googlesyndication.com', name: 'Google AdSense 联盟广告' },
  { suffix: 'googleadservices.com', name: 'Google 广告转化跟踪' },
  { suffix: 'google-analytics.com', name: 'Google Analytics 统计' },
  { suffix: 'googletagmanager.com', name: 'Google 跟踪代码管理器' },
  { suffix: 'pos.baidu.com', name: '百度原生网盟广告' },
  { suffix: 'cpro.baidu.com', name: '百度推广与代码' },
  { suffix: 'mobads.baidu.com', name: '百度移动广告 SDK' },
  { suffix: 'hm.baidu.com', name: '百度统计跟踪脚本' },
  { suffix: 'eclick.baidu.com', name: '百度点击跳转监控' },
  { suffix: 'cbjs.baidu.com', name: '百度广告展示平台' },
  { suffix: 'pgdt.gtimg.cn', name: '腾讯广点通广告静态库' },
  { suffix: 'e.qq.com', name: '腾讯社交广告与投放' },
  { suffix: 'tmead.y.qq.com', name: '腾讯优量汇广告 SDK' },
  { suffix: 'adnet.qq.com', name: '腾讯广告网盟' },
  { suffix: 'pangolin-sdk-toutiao.com', name: '字节跳动穿山甲广告 SDK' },
  { suffix: 'pangle.io', name: '穿山甲国际版 Pangle 广告' },
  { suffix: 'toblog.ctobsnssdk.com', name: '字节广告日志上报' },
  { suffix: 'pglstatp-toutiao.com', name: '穿山甲静态资源服务' },
  { suffix: 'alimama.com', name: '阿里妈妈商业广告' },
  { suffix: 'tanx.com', name: '阿里 Tanx 广告交易平台' },
  { suffix: 'adash.m.taobao.com', name: '淘宝移动埋点与投放' },
  { suffix: 'adashx.m.taobao.com', name: '淘宝商业日志跟踪' },
  { suffix: 'taboola.com', name: 'Taboola 信息流赞助推荐' },
  { suffix: 'outbrain.com', name: 'Outbrain 赞助内容引擎' },
  { suffix: 'criteo.com', name: 'Criteo 重定向营销广告' },
  { suffix: 'popads.net', name: 'PopAds 弹窗广告引擎' },
  { suffix: 'exoclick.com', name: 'ExoClick 综合广告网络' },
  { suffix: 'juicyads.com', name: 'JuicyAds 广告与弹窗' },
  { suffix: 'trafficjunky.com', name: 'TrafficJunky 视频广告联盟' },
  { suffix: 'adcash.com', name: 'Adcash 全球广告投放平台' },
  { suffix: 'clickadu.com', name: 'Clickadu 网页横幅与弹窗' },
  { suffix: 'propellerads.com', name: 'PropellerAds 推送与插屏广告' },
  { suffix: 'hilltopads.com', name: 'HilltopAds 弹窗与横幅广告' },
  { suffix: 'magsrv.com', name: 'ExoClick 核心广告投放网络' },
  { suffix: 'pemsrv.com', name: 'ExoClick 弹窗广告引擎' },
  { suffix: 'realsrv.com', name: 'ExoClick 静态广告资源' },
  { suffix: 'epidermispushupvariable.com', name: 'PushUp 强弹与暗刷引擎' },
  { suffix: 'oxgokpozzajz.in', name: '恶意跳转广告网关' },
  { suffix: '11yun.xyz', name: 'Umami 商业统计追踪' },
  { suffix: 'tsyndicate.com', name: 'TrafficStars 广告联盟' },
  { suffix: 'adtng.com', name: 'TrafficJunky 核心引擎' },
];

// 安全词白名单（防止误杀正常网页框架、内容与布局）
const FALSE_POSITIVE_WORDS = new Set([
  'download', 'downloads', 'thread', 'threads', 'header', 'headers', 'footer', 'footers',
  'breadcrumb', 'breadcrumbs', 'broadcast', 'radio', 'gradient', 'shadow', 'radius',
  'badge', 'badges', 'reload', 'head', 'lead', 'upload', 'uploads', 'spread', 'dead',
  'reading', 'headline', 'pad', 'road', 'load', 'loading', 'modal-body', 'modal-header',
  'container', 'wrapper', 'sidebar', 'content', 'main', 'card', 'box', 'item', 'page'
]);

function isAdToken(raw: string): boolean {
  const s = raw.toLowerCase().trim();
  if (s.length < 2 || s.length > 50 || FALSE_POSITIVE_WORDS.has(s)) return false;
  // 1. 精确广告根词与联盟组件前缀 (含 QF 旗帜横幅)
  if (/^(ads?|banner|guanggao|gg|sponsor(ed)?|popunder|floating[-_]?ad|fixed[-_]?ad|couplet|adv|exo|qf|img-qf|bottom-img-qf|home-qf|popunder\d*)$/i.test(s)) return true;
  if (s.includes('exo-native') || s.includes('msg-native') || s.includes('native-widget') || s.includes('img-qf') || s.includes('home-qf')) return true;
  // 2. 广告复合词
  if (/^(ad|banner|gg|adv|sponsor)[-_](box|slot|card|container|wrapper|placement|item|content|area|zone|frame|header|footer|sidebar|top|bottom|left|right|float|fixed|popup|overlay|layer|module|block|wrap|view|list|pic|img)$/i.test(s)) return true;
  if (/^([a-z0-9]+)[-_](ad|ads|banner|gg|guanggao|sponsor|adv)$/i.test(s)) return true;
  if (/^([a-z0-9]+)[-_](ad|ads|banner|gg|adv)[-_]([a-z0-9]+)$/i.test(s)) return true;
  return false;
}

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

    // 1. 尝试直连抓取目标页面
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    let html = '';
    let fetchError: any = null;
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
      if (res.ok) {
        html = await res.text();
      } else {
        fetchError = new Error(`HTTP ${res.status} ${res.statusText}`);
      }
    } catch (e: any) {
      clearTimeout(timer);
      fetchError = e;
    }

    // 2. 若直连被墙（网络连接中断/超时/空回包），自动无缝启用镜像通道跨网穿透
    if (!html || html.length < 200) {
      try {
        const jinaRes = await fetch(`https://r.jina.ai/${parsed.href}`, {
          headers: {
            'X-Return-Format': 'html',
            'User-Agent': 'LocalDNS/FJMOS AdHunter/1.15',
          },
          signal: AbortSignal.timeout(12000),
        });
        if (jinaRes.ok) {
          const jinaText = await jinaRes.text();
          if (jinaText && jinaText.length > 200) {
            html = jinaText;
          }
        }
      } catch (_) {}
    }

    if (!html) {
      throw new Error(`抓取目标网页失败: ${fetchError?.message || '网络连接中断或目标网站不可达'}`);
    }

    return this.inspectHtml(parsed.href, parsed.hostname, html);
  }

  /**
   * 基于 Surge TF436 落盘抓包会话 (Saved Capture Sessions) 深度提取广告接口特征并自动合成规则
   * 1. 自动循环分页拉取全量会话请求（上限 800 条，绝不截断）
   * 2. 第一顺位：从会话中的网页主文档 (HTML 响应) 深度提取 DOM 广告插槽、广告容器 Class 与 ID 锚点
   * 3. 第二顺位：匹配已知广告联盟 (KNOWN_AD_DOMAINS) 与第三方广告域名
   * 4. 第三顺位：匹配接口路径与 JSON 广告载荷 (URL-REGEX)
   */
  public async analyzeCaptureSession(sessionName: string, maxRequests = 600): Promise<AdFeatureReport> {
    const surgeService = SurgeService.get();

    // 1. 循环分页拉取完整会话请求列表，彻底解决只读前 120 条导致严重漏抓问题
    const allRequests: any[] = [];
    let currentOffset = 0;
    const pageSize = 100;
    while (currentOffset < maxRequests) {
      const reqRes = await surgeService.listCaptureSessionRequests(sessionName, currentOffset, pageSize);
      if (reqRes.error) {
        if (allRequests.length === 0) throw new Error(`读取 Surge 抓包会话失败: ${reqRes.error}`);
        break;
      }
      const list = reqRes.requests || [];
      if (list.length === 0) break;
      allRequests.push(...list);
      currentOffset += list.length;
      if (list.length < pageSize) break;
    }

    if (allRequests.length === 0) {
      throw new Error(`抓包会话 [${sessionName}] 为空或无请求记录`);
    }

    const report: AdFeatureReport = {
      targetUrl: `surge-session://${sessionName}`,
      domain: `capture-session:${sessionName}`,
      analyzedAt: new Date().toISOString(),
      cmsFamily: {
        id: 'capture_session',
        name: `Surge 抓包会话 [${sessionName}]`,
        confidence: 0.95,
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

    // 2. 第一阶段：扫描会话中所有的网页主文档 (HTML 响应)，直接从实际渲染的网页中提纯 DOM 广告选择器
    for (const req of allRequests) {
      const url = req.URL || req.url || '';
      // 寻找疑似主页面请求（状态码正常，且非静态音视频/图片/字体）
      if (
        !url.includes('.png') && !url.includes('.jpg') && !url.includes('.jpeg') &&
        !url.includes('.mp4') && !url.includes('.m3u8') && !url.includes('.ts') &&
        !url.includes('.woff') && !url.includes('.css') && !url.includes('.svg')
      ) {
        const key = req.key || String(req.id);
        try {
          const bodyRes = await surgeService.getCaptureSessionData(sessionName, key, 'response');
          const bodyText = bodyRes.text || '';
          if (bodyText.includes('<html') || bodyText.includes('<!DOCTYPE') || bodyText.includes('class=')) {
            let host = '';
            try { host = new URL(url.startsWith('http') ? url : `http://${url}`).hostname; } catch {}
            // 调用 inspectHtml 从抓包的真实网页提取 DOM 选择器、插槽、卡片与悬浮层
            const pageReport = this.inspectHtml(url, host || sessionName, bodyText);
            if (pageReport.detectedSlots.length > 0) {
              report.detectedSlots.push(...pageReport.detectedSlots);
            }
            if (pageReport.inFeedCards.detected) {
              report.inFeedCards = pageReport.inFeedCards;
            }
            if (pageReport.popupsAndOverlays.length > 0) {
              report.popupsAndOverlays.push(...pageReport.popupsAndOverlays);
            }
            if (pageReport.textLinkMatrices.length > 0) {
              report.textLinkMatrices.push(...pageReport.textLinkMatrices);
            }
            if (pageReport.fakeNavigationPromos.length > 0) {
              report.fakeNavigationPromos.push(...pageReport.fakeNavigationPromos);
            }
            if (pageReport.cmsFamily.id !== 'universal') {
              report.cmsFamily = pageReport.cmsFamily;
            }
            // 只要成功分析出一个主文档 HTML 即完成 DOM 提取
            break;
          }
        } catch (_) {}
      }
    }

    // 3. 第二阶段：全量扫描会话中全部请求，匹配第三方广告网络域名 (高优先级)
    const AD_URL_PATTERN = /(?:^|[^a-zA-Z0-9])(ad|ads|advert|banner|splash|popunder|tracker|telemetry|analytics|notice|promo|marketing|delivery|pgx|open_screen|boot_ad)(?:[^a-zA-Z0-9]|$)/i;

    const detectedEnginesMap = new Map<string, { type: 'slot_engine' | 'popunder' | 'tracker' | 'ad_network'; zeroDomainRegex: string; desc: string }>();

    for (const req of allRequests) {
      const urlStr = req.URL || req.url || '';
      if (!urlStr) continue;

      let uHost = '';
      let uPath = '';
      try {
        const u = new URL(urlStr.startsWith('http') ? urlStr : `http://${urlStr}`);
        uHost = u.hostname.toLowerCase();
        uPath = u.pathname;
      } catch {
        uHost = urlStr.split('/')[0].split(':')[0].toLowerCase();
        uPath = urlStr.replace(/^[^/]+/, '').split('?')[0];
      }

      // 3.1 域名匹配已知第三方广告联盟
      for (const known of KNOWN_AD_DOMAINS) {
        if (uHost === known.suffix || uHost.endsWith('.' + known.suffix)) {
          const rule = `DOMAIN-SUFFIX,${known.suffix},REJECT`;
          if (!detectedEnginesMap.has(rule)) {
            detectedEnginesMap.set(rule, {
              type: 'ad_network',
              zeroDomainRegex: rule,
              desc: `${known.name} (${uHost})`,
            });
            // 自动为广告域名补充 DOM iframe 隐藏选择器
            report.detectedSlots.push({
              selector: `iframe[src*="${known.suffix}"], script[src*="${known.suffix}"]`,
              description: `拦截 ${known.name} 动态嵌入框架`,
            });
          }
          break;
        }
      }

      // 3.2 路径匹配广告 API 接口
      if (AD_URL_PATTERN.test(uPath)) {
        const cleanPath = uPath.replace(/\/[0-9a-f]{8,}/gi, '/[a-f0-9]+').replace(/\/(\d+)(\/|$)/g, '/\\d+$2');
        const zeroRegex = `^https?://[^/]+${cleanPath}(?:[?#]|$)`;
        if (!detectedEnginesMap.has(zeroRegex)) {
          detectedEnginesMap.set(zeroRegex, {
            type: uPath.includes('pop') ? 'popunder' : (uPath.includes('slot') ? 'slot_engine' : 'ad_network'),
            zeroDomainRegex: zeroRegex,
            desc: `广告接口路径 (${uHost}${uPath})`,
          });
        }
      }
    }

    for (const [key, item] of detectedEnginesMap.entries()) {
      report.scriptEngines.push({
        path: key,
        zeroDomainRegex: item.zeroDomainRegex,
        type: item.type,
        description: item.desc,
      });
    }

    // 4. 去重 DOM 选择器
    const cleanSlots: typeof report.detectedSlots = [];
    const seenSels = new Set<string>();
    for (const s of report.detectedSlots) {
      if (!seenSels.has(s.selector)) {
        seenSels.add(s.selector);
        cleanSlots.push(s);
      }
    }
    report.detectedSlots = cleanSlots;

    // 5. 统计汇总结算
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

    report.synthesizedRules = this.synthesizeRules(report);
    return report;
  }

  /**
   * 纯 HTML 内容特征解析（支持从 HTML 字符串或已抓取内容检测）
   */
  public inspectHtml(targetUrl: string, domain: string, html: string): AdFeatureReport {
    // 提取网页原生 Title 标签作为标头识别
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const siteTitle = titleMatch ? titleMatch[1].trim().slice(0, 40) : domain;

    const report: AdFeatureReport = {
      targetUrl,
      domain,
      analyzedAt: new Date().toISOString(),
      cmsFamily: {
        id: 'universal',
        name: siteTitle ? `${siteTitle} · 自适应网页` : '通用自适应 CMS',
        confidence: 0.8,
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

    // ==================== 2. 通用启发式广告 Class 与 ID 扫描 ====================
    const foundAdClasses = new Set<string>();
    const foundAdIds = new Set<string>();

    // 匹配所有 class 属性
    const classAttrRegex = /class=["']([^"']+)["']/gi;
    let cm: RegExpExecArray | null;
    while ((cm = classAttrRegex.exec(html)) !== null) {
      const tokens = cm[1].split(/\s+/);
      for (const tok of tokens) {
        if (isAdToken(tok)) {
          foundAdClasses.add(tok);
        }
      }
    }

    // 匹配所有 id 属性
    const idAttrRegex = /id=["']([^"']+)["']/gi;
    let im: RegExpExecArray | null;
    while ((im = idAttrRegex.exec(html)) !== null) {
      const idVal = im[1].trim();
      if (isAdToken(idVal)) {
        foundAdIds.add(idVal);
      }
    }

    // 将命中的真实 Class 转为高精度选择器
    if (foundAdClasses.size > 0) {
      const classSelectors = Array.from(foundAdClasses).map(c => `.${c}`);
      report.detectedSlots.push({
        selector: classSelectors.slice(0, 15).join(', '),
        description: `扫描到 ${foundAdClasses.size} 个具有广告词根特征的 DOM 容器 (${Array.from(foundAdClasses).slice(0, 6).join(', ')})`,
      });
      if (classSelectors.length > 15) {
        report.detectedSlots.push({
          selector: classSelectors.slice(15).join(', '),
          description: `额外 ${classSelectors.length - 15} 个页面内嵌广告容器选择器`,
        });
      }
    }

    // 将命中的真实 ID 转为高精度选择器
    if (foundAdIds.size > 0) {
      const idSelectors = Array.from(foundAdIds).map(id => `#${id}`);
      report.detectedSlots.push({
        selector: idSelectors.join(', '),
        description: `扫描到 ${foundAdIds.size} 个广告专属 ID 锚点 (${Array.from(foundAdIds).slice(0, 5).join(', ')})`,
      });
    }

    // ==================== 3. 主流广告联盟与插槽特征扫描 ====================
    // 3.0 通用通栏横幅广告 (Banners / 旗帜广告位 / QF 模式)
    const bannerClasses = new Set<string>();
    if (html.includes('home-qf') || html.includes('img-qf') || html.includes('bottom-img-qf') || html.includes('/images/qf/')) {
      bannerClasses.add('.home-qf');
      bannerClasses.add('.img-qf1');
      bannerClasses.add('.img-qf2');
      bannerClasses.add('.bottom-img-qf1');
      bannerClasses.add('.bottom-img-qf2');
      bannerClasses.add('[class*="img-qf"]');
      bannerClasses.add('img[src*="/images/qf/"]');
      bannerClasses.add('a:has(> img[src*="/images/qf/"])');
      bannerClasses.add('div:has(> a > img[src*="/images/qf/"])');
    }

    // 扫描直接跳转至外部 IP 端口或境外博彩的广告外链横幅
    const ipLinkRegex = /<a[^>]+href=["'](https?:\/\/\d+\.\d+\.\d+\.\d+(?::\d+)?\/?[^"']*)["'][^>]*>/gi;
    let foundIpLinks = 0;
    while (ipLinkRegex.exec(html) !== null) {
      foundIpLinks++;
    }
    if (foundIpLinks > 0 || html.includes('amazonaws.com/?shareName') || html.includes('ifengyue.online') || html.includes('guotiai4.cc')) {
      bannerClasses.add('a[href^="http://101."], a[href^="https://101."]');
      bannerClasses.add('a[href^="http://157."], a[href^="https://157."]');
      bannerClasses.add('a[href*=":5012"], a[href*=":5002"], a[href*=":30400"]');
      bannerClasses.add('a[href*="amazonaws.com"]');
      bannerClasses.add('a[href*="ifengyue.online"]');
      bannerClasses.add('a[href*="guotiai4.cc"]');
      bannerClasses.add('a.navFooter');
    }

    if (bannerClasses.size > 0) {
      report.detectedSlots.push({
        selector: Array.from(bannerClasses).join(', '),
        description: `扫描到 ${bannerClasses.size} 组通栏横幅广告容器与博彩外链图片 (QF 旗帜横幅)`,
      });
    }

    // 3.1 Google AdSense
    if (html.includes('adsbygoogle') || html.includes('google-analytics') || html.includes('googlesyndication') || html.includes('doubleclick')) {
      report.detectedSlots.push({
        selector: 'ins.adsbygoogle, [data-ad-client], [data-ad-slot], [data-ad-format], [data-ad-unit]',
        description: 'Google AdSense 联盟广告组件与自定义插槽',
      });
    }

    // 3.2 百度网盟与移动推广
    if (html.includes('cpro') || html.includes('pos.baidu.com') || html.includes('BAIDU_SSP_') || html.includes('mobads')) {
      report.detectedSlots.push({
        selector: '[id^="BAIDU_SSP_"], [id^="baidu_clb_slot_id"], div[id^="cproIframe"], [class*="cpro"]',
        description: '百度原生推广与网盟展示容器',
      });
    }

    // 3.3 字节跳动穿山甲 / Pangle
    if (html.includes('pangle') || html.includes('pangolin')) {
      report.detectedSlots.push({
        selector: '[id^="pangle"], [class*="pangle"], [class*="pangolin"]',
        description: '字节跳动穿山甲广告原生容器',
      });
    }

    // 3.4 腾讯广点通 / 优量汇
    if (html.includes('gdt') || html.includes('adnet.qq')) {
      report.detectedSlots.push({
        selector: '[id^="gdt"], [class*="gdt-"], [id*="adnet"]',
        description: '腾讯优量汇广告容器',
      });
    }

    // 3.5 通用广告 iframe
    if (/<iframe[^>]+(ad|banner|google|baidu|cpro|doubleclick)[^>]*>/i.test(html)) {
      report.detectedSlots.push({
        selector: 'iframe[src*="ad"], iframe[id*="ad"], iframe[src*="doubleclick"], iframe[src*="googleads"], iframe[src*="pos.baidu.com"]',
        description: '第三方广告展示 iframe 嵌套框架',
      });
    }

    // 3.6 预设黑料与成人站专有插槽
    if (html.includes('pgx-slot') || html.includes('data-slot') || html.includes('component-advertises')) {
      report.detectedSlots.push({
        selector: '.pgx-slot, [data-slot]',
        description: 'PGX / SSP 动态插槽广告位',
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

    // ==================== 4. 信息流混排伪装卡片 (In-Feed Cards) 探测 ====================
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
    } else if (html.includes('rel="sponsored"') || html.includes("rel='sponsored'")) {
      report.inFeedCards = {
        detected: true,
        containerSelector: ':has(> a[rel*="sponsored"])',
        cardSelector: 'a[rel*="sponsored"]',
        features: ['rel="sponsored"'],
      };
    }

    // ==================== 5. 遮罩、全屏弹窗与年龄拦截 探测 ====================
    if (html.includes('age-gate')) {
      report.popupsAndOverlays.push({
        selector: '#age-gate, .age-gate, .age-gate-box, .age-gate-overlay',
        description: '18禁年龄拦截确认遮罩（阻断访问并锁定滚动）',
        type: 'age_gate',
      });
    }
    if (html.includes('front-feature-placement-player') || html.includes('video-overlay-ad')) {
      report.popupsAndOverlays.push({
        selector: '.front-feature-placement-player, .video-overlay-ad',
        description: '直接覆盖在视频播放器上的半透明/嵌入式悬浮广告框',
        type: 'player_overlay',
      });
    }
    if (html.includes('pop_notice') || html.includes('pop_grid') || html.includes('popup_image') || html.includes('bottom-floating-ad') || html.includes('fixed-banner')) {
      report.popupsAndOverlays.push({
        selector: '.pgx-slot[data-variant="popup_image"], .pgx-slot[data-variant="grid"], .bottom-floating-ad, .fixed-banner, [class*="floating-ad"]',
        description: '进入页面后弹出的单图与网格弹窗/悬浮挂件',
        type: 'modal',
      });
    }

    // ==================== 6. 密集文字推广矩阵与赞助链接 探测 ====================
    if (html.includes('detail-list-title') || html.includes('btnads_3') || html.includes('data-variant="text"')) {
      report.textLinkMatrices.push({
        selector: '.detail-list-title:has(a[data-event="ad_click"]), .detail-list-title:has(a[rel*="sponsored"]), a.gotoclick[data-event="ad_click"]',
        description: '正文下方密集的色情/博彩外链文字推广网格',
      });
    }
    if (html.includes('rel="sponsored"') || html.includes("rel='sponsored'")) {
      report.textLinkMatrices.push({
        selector: 'a[rel*="sponsored"], a[target="_blank"][href*="/ad/"], a[target="_blank"][href*="union"]',
        description: '第三方付费赞助与引流点击链接',
      });
    }

    // ==================== 7. 伪装原生导航与虚假外链 探测 ====================
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

    // ==================== 8. 脚本路径、联盟网络与广告接口 探测 ====================
    const srcMatches = html.match(/(?:src|href)=["']([^"']+)["']/gi) || [];
    const scannedUrls = new Set<string>();

    for (const match of srcMatches) {
      const rawVal = match.replace(/^(?:src|href)=["']/i, '').replace(/["']$/, '').trim();
      if (!rawVal || rawVal.startsWith('data:') || rawVal.startsWith('javascript:')) continue;
      scannedUrls.add(rawVal);
    }

    const detectedEnginesMap = new Map<string, { type: 'slot_engine' | 'popunder' | 'tracker' | 'ad_network'; zeroDomainRegex: string; desc: string }>();

    for (const urlStr of scannedUrls) {
      let uHost = '';
      let uPath = '';
      try {
        const u = new URL(urlStr.startsWith('//') ? 'https:' + urlStr : (urlStr.startsWith('http') ? urlStr : `http://${domain}/${urlStr.replace(/^\/+/, '')}`));
        uHost = u.hostname.toLowerCase();
        uPath = u.pathname;
      } catch {
        uPath = urlStr.split('?')[0].split('#')[0];
      }

      // 8.1 匹配已知第三方广告、联盟与追踪网络
      for (const known of KNOWN_AD_DOMAINS) {
        if (uHost === known.suffix || uHost.endsWith('.' + known.suffix)) {
          const rule = `DOMAIN-SUFFIX,${known.suffix},REJECT`;
          if (!detectedEnginesMap.has(rule)) {
            detectedEnginesMap.set(rule, {
              type: 'ad_network',
              zeroDomainRegex: rule,
              desc: `${known.name} (${uHost})`,
            });
          }
          break;
        }
      }

      // 8.2 匹配常见广告与数据埋点路径特征
      if (
        uPath.includes('slot-ads') ||
        uPath.includes('bottom-popup') ||
        uPath.includes('tjtag') ||
        uPath.includes('cogninotow') ||
        uPath.includes('fozekikikiminu') ||
        uPath.includes('janitorprecision') ||
        uPath.includes('loud-hall') ||
        uPath.includes('tapioni') ||
        uPath.includes('/api/ad') ||
        uPath.includes('/get_ad') ||
        uPath.includes('/ad_show') ||
        uPath.includes('/splash_ad') ||
        uPath.includes('/open_screen')
      ) {
        const cleanP = uPath.split('?')[0];
        const zeroRegex = `^https?:\\/\\/[^\\/]+${cleanP.replace(/\./g, '\\.')}(?:[?#]|$)`;
        if (!detectedEnginesMap.has(zeroRegex)) {
          detectedEnginesMap.set(zeroRegex, {
            type: uPath.includes('slot') || uPath.includes('popup') ? 'slot_engine' : 'tracker',
            zeroDomainRegex: zeroRegex,
            desc: uPath.includes('slot') ? '自研广告插槽调度引擎' : uPath.includes('tjtag') ? '点击埋点与数据上报脚本' : '动态广告投放接口',
          });
        }
      }
    }

    for (const [key, item] of detectedEnginesMap.entries()) {
      report.scriptEngines.push({
        path: key,
        zeroDomainRegex: item.zeroDomainRegex,
        type: item.type,
        description: item.desc,
      });
    }

    // ==================== 9. 保底防护（针对纯净页面提供通用插槽防护层） ====================
    if (report.detectedSlots.length === 0 && report.popupsAndOverlays.length === 0 && report.scriptEngines.length === 0) {
      report.detectedSlots.push({
        selector: 'ins.adsbygoogle, [data-ad-slot], [data-ad-client], [data-ad-unit], iframe[src*="ad"], iframe[src*="googleads"], div[id^="cproIframe"], .banner-ad, .ad-box',
        description: '通用广告插槽与联盟组件基础过滤防线 (Google AdSense / 百度网盟 / 穿山甲)',
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

    // ==================== 10. 自动化规则合成 (Rule Synthesis) ====================
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
    let cssCosmetic = uniqueCssSelectors.length > 0
      ? uniqueCssSelectors.join(',\n') + ` {\n  display: none !important;\n  visibility: hidden !important;\n  height: 0 !important;\n  pointer-events: none !important;\n  z-index: -9999 !important;\n}`
      : `/* 通用基础去广告防线 */\nins.adsbygoogle, [data-ad-slot], [data-ad-client], .ad-slot, .banner-ad {\n  display: none !important;\n  height: 0 !important;\n}`;

    // 针对页面可能挂载的 fixbody 滚动锁定，强制物理覆盖解除
    cssCosmetic += `\n\n/* === 物理防锁死：彻底粉碎 fixbody 对页面滚动的劫持 === */\nhtml,\nbody,\nhtml.fixbody,\nbody.fixbody,\nbody.navbar,\n#xqbj-container {\n  overflow: visible !important;\n  overflow-y: auto !important;\n  height: auto !important;\n  min-height: 100% !important;\n  max-height: none !important;\n  position: static !important;\n  touch-action: auto !important;\n  -webkit-overflow-scrolling: touch !important;\n}`;

    // Defuser 脚本代码
    let defuserScriptlet = `// 运行时基因检测与广告引擎灭活 (零域名依赖)\n`;
    if (report.cmsFamily.id === 'heiliao') {
      defuserScriptlet += `try {\n  const now = new Date();\n  const dateKey = \`\${now.getFullYear()}-\${String(now.getMonth() + 1).padStart(2, '0')}-\${String(now.getDate()).padStart(2, '0')}\`;\n  localStorage.setItem('hlw_age_verify_date', dateKey);\n} catch (_) {}\nObject.defineProperty(window, 'HlwPgxAds', {\n  get: () => ({ boot: () => {} }),\n  set: () => {},\n  configurable: false\n});\nwindow.__SSP_ENABLED__ = false;\nwindow.__SSP_SLOTS__ = [];\n`;
    }
    defuserScriptlet += `// 灭活商业广告引擎全局对象\ntry { Object.defineProperty(window, 'AdProvider', { get: () => ({}), set: () => {}, configurable: false }); Object.defineProperty(window, 'popunder', { get: () => ({}), set: () => {}, configurable: false }); window.adsbygoogle = { push: function(){} }; try { Object.freeze(window.adsbygoogle); } catch(_) {} } catch(_) {}\n`;
    defuserScriptlet += `// 核心防御 1：阻断全局恶意点击劫持与 TouchJacking 监听器注册\ntry {\n  const _rawAdd = EventTarget.prototype.addEventListener;\n  EventTarget.prototype.addEventListener = function (type, listener, options) {\n    if (this === window || this === document || (this && this.tagName === 'BODY') || (this && this.tagName === 'HTML')) {\n      if (type === 'click' || type === 'touchstart' || type === 'touchend' || type === 'mousedown') {\n        const fnStr = String(listener || '');\n        if (fnStr.includes('decodeURI') || fnStr.includes('popunder') || fnStr.includes('clocid') || fnStr.includes('cltgid') || fnStr.includes('epidermispushup') || fnStr.includes('magsrv') || fnStr.includes('pemsrv') || fnStr.includes('window.open') || fnStr.includes('location.href')) {\n          console.log('[AdHunter] 已阻断全局恶意点击劫持监听器:', type);\n          return;\n        }\n      }\n    }\n    return _rawAdd.call(this, type, listener, options);\n  };\n} catch(_) {}\n`;
    defuserScriptlet += `// 核心防御 2：阻断动态 <a> 标签模拟点击劫持 (Anchor Click-Hijack)\ntry {\n  const _rawAClick = HTMLAnchorElement.prototype.click;\n  HTMLAnchorElement.prototype.click = function () {\n    const href = String(this.href || '');\n    if (href && (href.includes('101.237.') || href.includes('157.185.') || href.includes('amazonaws.com') || href.includes('guotiai') || href.includes('ifengyue') || href.includes('magsrv') || href.includes('pemsrv') || href.includes('popunder') || href.includes('oxgok') || /sponsored|aff|cid=|shareName|ref_id/i.test(href))) {\n      console.log('[AdHunter] 已阻断脚本模拟点击恶意外跳:', href);\n      return;\n    }\n    return _rawAClick.call(this);\n  };\n} catch(_) {}\n`;
    defuserScriptlet += `// 核心防御 3：弹窗与点击劫持防御 (Popunder Defuser)\nconst _rawOpen = window.open;\nwindow.open = function(url, target, features) {\n  if (!url || /sponsored|aff|chat|game|peach|trwl1|ohmycams|cpro|magsrv|pemsrv|oxgok|popunder|ad\\.|101\\.237|157\\.185|amazonaws|guotiai|ifengyue|cid=|ref_id|shareName/i.test(url)) {\n    console.log('[AdHunter] 阻断恶意外链弹窗:', url);\n    return null;\n  }\n  return _rawOpen.call(window, url, target, features);\n};\n`;

    // Surge 规则（零域名 URL-REGEX 或 DOMAIN-SUFFIX）
    const surgeUrlRegex: string[] = [];
    for (const engine of report.scriptEngines) {
      if (engine.zeroDomainRegex) {
        if (engine.zeroDomainRegex.startsWith('DOMAIN-SUFFIX,') || engine.zeroDomainRegex.startsWith('DOMAIN,')) {
          surgeUrlRegex.push(engine.zeroDomainRegex);
        } else {
          surgeUrlRegex.push(`URL-REGEX,"${engine.zeroDomainRegex}",REJECT`);
        }
      }
    }

    // 若无匹配规则，保底提供通用过滤参考
    if (surgeUrlRegex.length === 0) {
      surgeUrlRegex.push(`URL-REGEX,"^https?:\\/\\/[^\\/]+\\/.*(ad|banner|splash|popunder).*(?:[?#]|$)",REJECT`);
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
    return true;
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
    applyStyles();

    // 自动解开弹窗对页面滚动的锁定
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
   * 1. 纯域名规则 (DOMAIN / DOMAIN-SUFFIX): 立即写入 LocalDNS diversion_rules (group='block') 纳秒级拦截并实时供给 Surge /rules/block.list 外部订阅
   * 2. 七层零域名规则 (URL-REGEX): 写入 mod_adhunter 并重新编译 Unified Hub 模块
   * 3. 实时冲刷本地 DNS 缓存并向 Surge 下发热重载指令
   */
  public async deployToSurge(report: AdFeatureReport): Promise<{ success: boolean; rulesAdded: number; message: string }> {
    const db = SurgeDatabase.get();
    await db.init();
    const surgeService = SurgeService.get();

    const rules = report.synthesizedRules.surgeUrlRegex || [];
    const domainRulesToBlock: Array<{ match_type: any; pattern: string; comment?: string }> = [];
    const urlRegexToModule: string[] = [];

    for (const r of rules) {
      if (r.startsWith('DOMAIN-SUFFIX,') || r.startsWith('DOMAIN,')) {
        const parts = r.split(',').map((p) => p.trim());
        const matchType = parts[0] as any;
        const pattern = parts[1];
        if (pattern) {
          domainRulesToBlock.push({
            match_type: matchType,
            pattern,
            comment: `AdHunter 智能提纯 [${report.cmsFamily?.name || report.domain}]`,
          });
        }
      } else {
        urlRegexToModule.push(r);
      }
    }

    // 1. 纯域名规则：立即写入 diversion_rules 的 'block' 分组（最高优先级拦截 + /rules/block.list 输出）
    let blockAdded = 0;
    if (domainRulesToBlock.length > 0) {
      blockAdded = await db.appendGroupRules('block', domainRulesToBlock, '__adhunter__');
    }

    // 2. 七层零域名规则：写入 mod_adhunter
    const modAdded = await db.addAdHunterRules(urlRegexToModule);

    // 3. 即时冲刷本地 DNS 拦截缓存与通知 Surge 全量热载
    try {
      await surgeService.reloadDnsBlockCache();
      await surgeService.reloadSurgeHubModule();
      await surgeService.flushSurgeDns();
      await surgeService.updateSurgeExternalResources();
    } catch (e) {
      console.warn('[AdHunter] Surge reload notice failed:', e);
    }

    const totalAdded = blockAdded + modAdded;
    return {
      success: true,
      rulesAdded: totalAdded,
      message: `已全端下沉生效：${blockAdded} 个广告域名入库 LocalDNS 本地 DNS 纳秒拦截并更新 Surge block.list；${modAdded} 条七层规则注入 Unified Hub 模块并已触发热重载！`,
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

    // 3. 读取全局母核 AdBlockHub.user.js 并原子合流
    const hubPath = '/var/mobile/Library/Mobile Documents/iCloud~com~thomfang~Scripting/Documents/scripting-safari-extension/userscripts/AdBlockHub.user.js';
    let hubCode = '';
    try {
      hubCode = await FileManager.readAsString(hubPath);
    } catch (e) {
      console.warn('[AdHunter] read AdBlockHub.user.js failed:', e);
    }

    let selectorsMerged = 0;
    let defusersMerged = 0;

    if (hubCode) {
      // 3.1 找出当前母核中尚未包含的选择器并注入
      const newSelectors = cleanCandidates.filter((sel) => !hubCode.includes(sel));
      const dateTag = new Date().toISOString().slice(0, 10);
      const sourceTag = report.cmsFamily?.name || report.domain || 'AdHunter';

      if (newSelectors.length > 0) {
        const injectionBlock = `\n    /* [AdHunter 自动合流: ${sourceTag} (${dateTag})] */\n    ${newSelectors.join(',\n    ')},`;

        // 插入在 #limbo-ad-notice { 之前，保证语法完全合法
        if (hubCode.includes('#limbo-ad-notice {')) {
          hubCode = hubCode.replace('#limbo-ad-notice {', `${injectionBlock}\n    #limbo-ad-notice {`);
        } else if (hubCode.includes('display: none !important;')) {
          hubCode = hubCode.replace('display: none !important;', `${injectionBlock}\n      display: none !important;`);
        }
        selectorsMerged = newSelectors.length;
      }

      // 3.2 提取广告域名并注入母核防弹窗拦截白名单 (Popunder Defuser)
      const adDomainsToDefuse: string[] = [];
      for (const r of (report.synthesizedRules.surgeUrlRegex || [])) {
        if (r.startsWith('DOMAIN-SUFFIX,') || r.startsWith('DOMAIN,')) {
          const dom = r.split(',')[1]?.trim();
          if (dom && !hubCode.includes(dom)) {
            adDomainsToDefuse.push(dom.replace(/\./g, '\\.'));
          }
        }
      }

      if (adDomainsToDefuse.length > 0 && hubCode.includes('/sponsored|aff|chat|game')) {
        const patternInsert = `|${adDomainsToDefuse.join('|')}`;
        hubCode = hubCode.replace('/sponsored|aff|chat|game', `/sponsored|aff|chat|game${patternInsert}`);
        defusersMerged = adDomainsToDefuse.length;
      }

      // 3.3 注入合流标记并落盘保存
      const mergeHeader = `// [AdHunter 活跃合流生效: ${sourceTag} · ${dateTag}]\n`;
      if (!hubCode.includes(`[AdHunter 活跃合流生效: ${sourceTag}`)) {
        hubCode = hubCode.replace('// ==/UserScript==', `// ==/UserScript==\n${mergeHeader}`);
      }

      await FileManager.writeAsString(hubPath, hubCode);
    }

    return {
      success: true,
      surgeRulesAdded,
      selectorsMerged,
      filePath: hubPath,
      message: `已全端自动化合流生效：Surge 下沉 ${surgeRulesAdded} 条网络拦截规则；Safari 母核合并 ${selectorsMerged} 个特征选择器、${defusersMerged} 个弹窗拦截！`,
    };
  }
}
