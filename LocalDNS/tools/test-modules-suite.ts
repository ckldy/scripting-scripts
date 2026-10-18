// Comprehensive Automated Test Suite for LocalDNS Clean Modules & Stream Cleaner Engine
import { Script } from 'scripting';
import { Store } from '../src/store';
import { ModuleParser } from '../src/modules/parser';
import { ModuleManager } from '../src/modules/module-manager';
import { StreamCleaner } from '../src/stream/cleaner';
import { ScriptSandbox } from '../src/runtime/sandbox';
import { FakeIpPool } from '../src/mitm/fakeip';
import { DiversionEngine } from '../src/diversion';
import { ProxyHandler } from '../src/mitm/proxy-handler';

async function runModulesTestSuite() {
  console.log('================================================================');
  console.log('  [LocalDNS] Stream Cleaning & Surge/Loon/QX Engine Test Suite  ');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, desc: string) {
    if (condition) {
      console.log(`  ✅ PASS: ${desc}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${desc}`);
      failed++;
    }
  }

  // -------------------------------------------------------------
  // Test 1: ModuleParser - Surge (.sgmodule)
  // -------------------------------------------------------------
  console.log('--- Test Group 1: ModuleParser (Surge Specification) ---');
  const surgeSample = `#!name=YouTube 纯净模块
#!desc=去贴片广告与信息流
[MITM]
hostname = *.googlevideo.com, www.youtube.com, youtubei.googleapis.com, -excluded.googlevideo.com

[URL Rewrite]
^https?:\\/\\/[\\w-]+\\.googlevideo\\.com\\/videoplayback\\?.+(&adformat=|\\/ad\\/) reject-200
^https?:\\/\\/www\\.youtube\\.com\\/youtubei\\/v1\\/player\\/ad_break reject-dict
^https?:\\/\\/www\\.youtube\\.com\\/redirect_ad 302 https://example.com/target

[Script]
youtube-player = type=http-response,pattern=^https?:\\/\\/www\\.youtube\\.com\\/youtubei\\/v1\\/player,script-path=https://example.com/yt.js,requires-body=true,timeout=10
`;

  const parsedSurge = ModuleParser.parse(surgeSample, 'test_surge');
  assert(parsedSurge.name === 'YouTube 纯净模块', 'Surge module name parsed correctly');
  assert(parsedSurge.platform === 'surge', 'Platform detected as surge');
  assert(parsedSurge.mitmHosts.includes('*.googlevideo.com'), 'Extracted *.googlevideo.com to MITM hosts');
  assert(parsedSurge.mitmHosts.includes('-excluded.googlevideo.com'), 'Extracted negative pattern to MITM hosts');
  assert(parsedSurge.rewrites.length === 3, `Extracted 3 rewrite rules (got ${parsedSurge.rewrites.length})`);
  assert(parsedSurge.rewrites[0].action === 'reject-200', 'First rewrite is reject-200');
  assert(parsedSurge.rewrites[1].action === 'reject-dict', 'Second rewrite is reject-dict');
  assert(parsedSurge.rewrites[2].action === 'redirect', 'Third rewrite is redirect');
  assert(parsedSurge.scripts.length === 1, `Extracted 1 script rule (got ${parsedSurge.scripts.length})`);
  assert(parsedSurge.scripts[0].requiresBody === true, 'Script requires-body parsed as true');
  assert(parsedSurge.scripts[0].timeout === 10, 'Script timeout parsed as 10s');

  // -------------------------------------------------------------
  // Test 2: ModuleParser - Loon (.plugin)
  // -------------------------------------------------------------
  console.log('\n--- Test Group 2: ModuleParser (Loon Plugin Specification) ---');
  const loonSample = `#!name=Bilibili 去广告
#!desc=去除开屏、番剧贴片与动态广告
[Plugin]

[Mitm]
hostname = api.bilibili.com, app.bilibili.com

[Rewrite]
^https?:\\/\\/api\\.bilibili\\.com\\/x\\/v2\\/splash reject
^https?:\\/\\/app\\.bilibili\\.com\\/x\\/v2\\/feed\\/index reject-dict

[Script]
http-response ^https?:\\/\\/api\\.bilibili\\.com\\/x\\/v2\\/reply\\/reply script-path=https://example.com/bili.js, tag=bili-reply, requires-body=true
`;

  const parsedLoon = ModuleParser.parse(loonSample, 'test_loon');
  assert(parsedLoon.name === 'Bilibili 去广告', 'Loon plugin name parsed');
  assert(parsedLoon.platform === 'loon', 'Platform detected as loon');
  assert(parsedLoon.mitmHosts.includes('api.bilibili.com'), 'Extracted api.bilibili.com');
  assert(parsedLoon.rewrites.length === 2, `Extracted 2 rewrite rules in Loon (got ${parsedLoon.rewrites.length})`);
  assert(parsedLoon.rewrites[0].action === 'reject', 'First Loon rewrite is reject');
  assert(parsedLoon.scripts.length === 1, `Extracted 1 Loon script rule (got ${parsedLoon.scripts.length})`);
  assert(parsedLoon.scripts[0].name === 'bili-reply', 'Loon script tag parsed as name');

  // -------------------------------------------------------------
  // Test 3: ModuleParser - Quantumult X (.conf)
  // -------------------------------------------------------------
  console.log('\n--- Test Group 3: ModuleParser (Quantumult X Specification) ---');
  const qxSample = `# Title: iQiyi Video AdBlock
# Author: Test

[mitm]
hostname = *.iqiyi.com, *.qiyi.com

[rewrite_local]
^https?:\\/\\/[\\w-]+\\.iqiyi\\.com\\/v5\\/ad\\/ url reject-200
^https?:\\/\\/api\\.iqiyi\\.com\\/player\\/info url script-response-body https://example.com/iqiyi.js
`;

  const parsedQx = ModuleParser.parse(qxSample, 'test_qx');
  assert(parsedQx.platform === 'quantumultx', 'Platform detected as quantumultx');
  assert(parsedQx.mitmHosts.includes('*.iqiyi.com'), 'Extracted *.iqiyi.com');
  assert(parsedQx.rewrites.length === 1, `Extracted 1 QX rewrite rule (got ${parsedQx.rewrites.length})`);
  assert(parsedQx.scripts.length === 1, `Extracted 1 QX script rule (got ${parsedQx.scripts.length})`);

  // -------------------------------------------------------------
  // Test 4: ModuleManager - MITM & Rewrite Dispatching
  // -------------------------------------------------------------
  console.log('\n--- Test Group 4: ModuleManager & MITM Matching ---');
  const mgr = ModuleManager.get();
  // 添加测试模块
  mgr.addModule(surgeSample);

  assert(mgr.isMitmHost('rr1---sn-4g5edn6e.googlevideo.com') === true, 'Matches *.googlevideo.com');
  assert(mgr.isMitmHost('www.youtube.com') === true, 'Matches www.youtube.com');
  assert(mgr.isMitmHost('excluded.googlevideo.com') === false, 'Excluded host is NOT matched (negative rule win)');
  assert(mgr.isMitmHost('baidu.com') === false, 'Non-MITM domain returns false');

  const rwHit = mgr.matchRewrite('https://rr1---sn-4g5edn6e.googlevideo.com/videoplayback?id=123&adformat=1');
  assert(rwHit !== null && rwHit.action === 'reject-200', 'Rewrite rule matched reject-200');

  const rwHitDict = mgr.matchRewrite('https://www.youtube.com/youtubei/v1/player/ad_break?key=val');
  assert(rwHitDict !== null && rwHitDict.action === 'reject-dict', 'Rewrite rule matched reject-dict');

  const stats = mgr.getStats();
  assert(stats.totalModules > 0, `Total modules > 0 (got ${stats.totalModules})`);
  assert(stats.totalMitmHosts > 0, `Total MITM hosts > 0 (got ${stats.totalMitmHosts})`);

  // -------------------------------------------------------------
  // Test 5: StreamCleaner - HLS M3U8 & JSON
  // -------------------------------------------------------------
  console.log('\n--- Test Group 5: StreamCleaner (M3U8 & JSON Pruning) ---');
  const dirtyM3U8 = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:6
#EXT-X-DATERANGE:ID="stitched-ad-1234",START-DATE="2026-10-18T00:00:00Z",PLANNED-DURATION=15.0
#EXTINF:6.000,
https://video.example.com/segment1.ts
#EXT-X-TWITCH-PREFETCH:https://video.example.com/prefetch.ts
#EXT-X-DISCONTINUITY
#EXT-X-DISCONTINUITY
#EXTINF:6.000,
https://video.example.com/ad_segment_01.ts
#EXTINF:6.000,
https://video.example.com/segment2.ts
#EXT-X-ENDLIST
`;

  const cleanedM3U8 = StreamCleaner.cleanM3U8(dirtyM3U8, 'https://usher.ttvnw.net/stream.m3u8');
  assert(!cleanedM3U8.includes('stitched-ad'), 'Purged #EXT-X-DATERANGE stitched-ad tag');
  assert(!cleanedM3U8.includes('TWITCH-PREFETCH'), 'Purged #EXT-X-TWITCH-PREFETCH tag');
  assert(!cleanedM3U8.includes('ad_segment_01.ts'), 'Purged ad_segment_01.ts slice');
  assert(cleanedM3U8.includes('segment1.ts'), 'Preserved genuine segment1.ts');
  assert(cleanedM3U8.includes('segment2.ts'), 'Preserved genuine segment2.ts');
  assert(!cleanedM3U8.includes('\n#EXT-X-DISCONTINUITY\n#EXT-X-DISCONTINUITY'), 'Deduplicated multiple DISCONTINUITY tags');

  // JSON 清洗测试
  const dirtyJSON = JSON.stringify({
    playabilityStatus: { status: 'OK' },
    adPlacements: [{ adId: 'ad_999' }],
    playerAds: [{ format: 'preroll' }],
    adSlots: ['slot_1'],
    playbackTracking: {
      videostatsPlaybackUrl: 'https://youtube.com/api/stats/atr',
      genuineStats: 'https://youtube.com/api/stats/qoe',
    },
    videoDetails: { title: 'Test Video', author: 'Uploader' },
  });

  const cleanedJSONStr = StreamCleaner.cleanJSON(dirtyJSON, 'https://www.youtube.com/youtubei/v1/player');
  const cleanedJSON = JSON.parse(cleanedJSONStr);
  assert(cleanedJSON.adPlacements === undefined, 'Purged adPlacements');
  assert(cleanedJSON.playerAds === undefined, 'Purged playerAds');
  assert(cleanedJSON.adSlots === undefined, 'Purged adSlots');
  assert(cleanedJSON.playbackTracking.videostatsPlaybackUrl === undefined, 'Purged ad tracking ATR URL');
  assert(cleanedJSON.playbackTracking.genuineStats !== undefined, 'Preserved legitimate playback metrics');
  assert(cleanedJSON.videoDetails.title === 'Test Video', 'Preserved genuine video metadata');

  // -------------------------------------------------------------
  // Test 6: ScriptSandbox Runtime Execution
  // -------------------------------------------------------------
  console.log('\n--- Test Group 6: ScriptSandbox Runtime Execution ---');
  const mockScriptCode = `
    const resp = JSON.parse($response.body);
    resp.title = "Cleaned by Script";
    delete resp.ad;
    $done({ body: JSON.stringify(resp) });
  `;

  const scriptRule = {
    id: 'test_sandbox',
    name: 'Mock Script',
    type: 'http-response' as const,
    pattern: '.*',
    regex: /.*/,
    scriptPath: 'local.js',
    scriptContent: mockScriptCode,
    requiresBody: true,
    timeout: 3,
  };

  const sandboxResult = await ScriptSandbox.execute(scriptRule, {
    request: { url: 'https://example.com/api', method: 'GET', headers: {} },
    response: {
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Original', ad: 'banner_content' }),
    },
  });

  assert(sandboxResult.modifiedResponse !== undefined, 'Sandbox returned modified response');
  if (sandboxResult.modifiedResponse) {
    const parsedRes = JSON.parse(sandboxResult.modifiedResponse.body || '{}');
    assert(parsedRes.title === 'Cleaned by Script', 'Script modified response body property');
    assert(parsedRes.ad === undefined, 'Script deleted advertisement property');
  }

  // -------------------------------------------------------------
  // Test 7: FakeIpPool (RFC 2544 198.18.0.0/15)
  // -------------------------------------------------------------
  console.log('\n--- Test Group 7: FakeIpPool Allocation & Lookup ---');
  const fakePool = FakeIpPool.get();
  const ip1 = fakePool.allocate('rr1---sn-test.googlevideo.com');
  assert(fakePool.isFakeIp(ip1), `Allocated IP ${ip1} is within 198.18.0.0/15`);
  const ip1Again = fakePool.allocate('rr1---sn-test.googlevideo.com');
  assert(ip1 === ip1Again, 'Idempotent allocation for identical domain');

  const lookedUpDomain = fakePool.lookup(ip1);
  assert(lookedUpDomain === 'rr1---sn-test.googlevideo.com', 'Reverse lookup retrieves correct domain');

  // -------------------------------------------------------------
  // Test 8: DiversionEngine Integration with FakeIP MITM & DNS Guard
  // -------------------------------------------------------------
  console.log('\n--- Test Group 8: DiversionEngine MITM & FakeIP Integration ---');
  const diversion = DiversionEngine.get();
  const store = Store.get();

  // 8.1 默认模式 (switch2 !== 'A', switch_mitm === 'A') 下，合法视频域名正常返回真实上游策略组 (foreign/domestic)，不返回未监听的 FakeIP
  store.setSwitch('switch_mitm', 'A');
  store.setSwitch('switch_rewrite', 'A');
  store.setSwitch('switch2', 'B');
  const routeDefaultStream = diversion.match('rr2---sn-4g5edn6e.googlevideo.com', '127.0.0.1');
  assert(routeDefaultStream.group === 'foreign', 'Default mode routes foreign video stream to foreign group');
  assert(routeDefaultStream.domainSet === 'mitm_stream', 'Domain set tagged as mitm_stream');
  assert(routeDefaultStream.rewriteIp === undefined, 'No FakeIP returned to prevent network breakage');

  // 8.2 显式开启 Client FakeIP 模式 (switch2 === 'A') 时，才为该域名分配 FakeIP 虚拟地址
  store.setSwitch('switch2', 'A');
  const routeFakeIpStream = diversion.match('rr2---sn-4g5edn6e.googlevideo.com', '127.0.0.1');
  assert(routeFakeIpStream.group === 'rewrite', 'FakeIP mode routes to rewrite group');
  assert(routeFakeIpStream.domainSet === 'mitm_fakeip', 'Domain set tagged as mitm_fakeip');
  assert(routeFakeIpStream.rewriteIp !== undefined && fakePool.isFakeIp(routeFakeIpStream.rewriteIp), 'Returns valid FakeIP');
  store.setSwitch('switch2', 'B'); // 恢复默认

  // 8.3 YouTube 核心广告与追踪域名必须优先由 AdGuard 100% 阻断为 0.0.0.0
  const routeYtAd1 = diversion.match('s.youtube.com', '127.0.0.1');
  assert(routeYtAd1.group === 'blocked' && routeYtAd1.domainSet === 'adguard', 's.youtube.com blocked by AdGuard');
  const routeYtAd2 = diversion.match('video-stats.l.google.com', '127.0.0.1');
  assert(routeYtAd2.group === 'blocked' && routeYtAd2.domainSet === 'adguard', 'video-stats.l.google.com blocked by AdGuard');
  const routeYtAd3 = diversion.match('pagead2.googlesyndication.com', '127.0.0.1');
  assert(routeYtAd3.group === 'blocked' && routeYtAd3.domainSet === 'adguard', 'pagead2.googlesyndication.com blocked by AdGuard');

  // 8.4 国内普通域名不受影响
  const routeBaidu = diversion.match('www.baidu.com', '127.0.0.1');
  assert(routeBaidu.group === 'domestic', 'Domestic domain still routes to domestic');

  // -------------------------------------------------------------
  // Test 9: ProxyHandler Pipeline Interception
  // -------------------------------------------------------------
  console.log('\n--- Test Group 9: ProxyHandler Pipeline Interception ---');
  const proxyHandler = ProxyHandler.get();
  const interceptedResp = await proxyHandler.processRequest({
    url: 'https://rr1---sn-4g5edn6e.googlevideo.com/videoplayback?id=123&adformat=1',
    method: 'GET',
    headers: { host: 'rr1---sn-4g5edn6e.googlevideo.com' },
  });

  assert(interceptedResp.intercepted === true, 'Request intercepted by module rewrite');
  assert(interceptedResp.status === 204, 'Reject-200 returned HTTP 204 No Content');
  assert(interceptedResp.cleanAction === 'reject-200', 'Clean action recorded as reject-200');

  // -------------------------------------------------------------
  // Test 10: Advanced HTTP Rewrite (Redirect Captures, Mock, Header & Body)
  // -------------------------------------------------------------
  console.log('\n--- Test Group 10: Advanced HTTP Rewrite Features ---');
  const advancedRewriteModule = `#!name=高级重写测试模块
[MITM]
hostname = api.example.com

[URL Rewrite]
^https?:\\/\\/api\\.example\\.com\\/user\\/(.+) 302 https://newapi.example.com/u/$1
^https?:\\/\\/api\\.example\\.com\\/mock-test mock 200 {"code":0,"msg":"mocked"}
^https?:\\/\\/api\\.example\\.com\\/mock-empty mock 204
`;

  mgr.addModule(advancedRewriteModule);

  // 10.1 正则捕获组重定向测试
  const redirectResp = await proxyHandler.processRequest({
    url: 'https://api.example.com/user/98765',
    method: 'GET',
    headers: { host: 'api.example.com' },
  });
  assert(redirectResp.status === 302, 'Redirect returned 302 status');
  assert(redirectResp.headers['Location'] === 'https://newapi.example.com/u/98765', 'Regex capture group $1 replaced into target URL');
  assert(redirectResp.intercepted === true, 'Redirect marked as intercepted');

  // 10.2 Mock 虚拟响应测试
  const mockResp = await proxyHandler.processRequest({
    url: 'https://api.example.com/mock-test',
    method: 'GET',
    headers: { host: 'api.example.com' },
  });
  assert(mockResp.status === 200, 'Mock response returned status 200');
  assert(mockResp.body === '{"code":0,"msg":"mocked"}', 'Mock response returned custom body');
  assert(mockResp.headers['X-LocalDNS-Mock'] === 'true', 'Mock response includes X-LocalDNS-Mock header');
  assert(mockResp.intercepted === true, 'Mock response marked as intercepted');

  // -------------------------------------------------------------
  // Test 11: Switch Controls (switch_rewrite & switch_mitm)
  // -------------------------------------------------------------
  console.log('\n--- Test Group 11: Switch Controls (switch_rewrite & switch_mitm) ---');
  // store already retrieved in Test Group 8

  // 11.1 测试关闭 HTTP 重写开关 (switch_rewrite = 'B')
  store.setSwitch('switch_rewrite', 'B');
  const bypassRewriteResp = await proxyHandler.processRequest({
    url: 'https://api.example.com/mock-test',
    method: 'GET',
    headers: { host: 'api.example.com' },
  });
  // 当重写关闭时，不应命中 mock 规则，而是尝试直连上游
  assert(bypassRewriteResp.headers['X-LocalDNS-Mock'] === undefined, 'When switch_rewrite is B, mock rule is bypassed');
  // 恢复 switch_rewrite 为 A
  store.setSwitch('switch_rewrite', 'A');

  // 11.2 测试关闭 MITM 开关 (switch_mitm = 'B')
  store.setSwitch('switch_mitm', 'B');
  store.setSwitch('switch2', 'A');
  const bypassMitmRoute = diversion.match('rr2---sn-4g5edn6e.googlevideo.com', '127.0.0.1');
  assert(bypassMitmRoute.domainSet !== 'mitm_fakeip', 'When switch_mitm is B, MITM host is NOT hijacked to FakeIP');
  // 恢复 switch_mitm 为 A
  store.setSwitch('switch_mitm', 'A');
  const restoredMitmRoute = diversion.match('rr2---sn-4g5edn6e.googlevideo.com', '127.0.0.1');
  assert(restoredMitmRoute.domainSet === 'mitm_fakeip', 'When switch_mitm is A and switch2 is A, MITM host is properly hijacked to FakeIP');
  store.setSwitch('switch2', 'B'); // 恢复 switch2 为 B

  // -------------------------------------------------------------
  // Test 12: Built-in Video AdBlock Presets (Bilibili & Universal Video SDK)
  // -------------------------------------------------------------
  console.log('\n--- Test Group 12: Built-in Video AdBlock Presets ---');

  // 12.1 B站开屏广告拦截测试
  const biliSplashResp = await proxyHandler.processRequest({
    url: 'https://api.bilibili.com/x/v2/splash',
    method: 'GET',
    headers: { host: 'api.bilibili.com' },
  });
  assert(biliSplashResp.status === 204, 'Bilibili splash ad intercepted with 204');
  assert(biliSplashResp.intercepted === true, 'Bilibili splash ad marked as intercepted');

  // 12.2 B站信息流广告拦截测试
  const biliFeedResp = await proxyHandler.processRequest({
    url: 'https://app.bilibili.com/x/v2/feed/index',
    method: 'GET',
    headers: { host: 'app.bilibili.com' },
  });
  assert(biliFeedResp.status === 200 && biliFeedResp.body === '{}', 'Bilibili feed ad intercepted with reject-dict {}');

  // 12.3 全网通用视频 Google IMA3 SDK 桩测试
  const imaSdkResp = await proxyHandler.processRequest({
    url: 'https://imasdk.googleapis.com/js/sdkloader/ima3.js',
    method: 'GET',
    headers: { host: 'imasdk.googleapis.com' },
  });
  assert(imaSdkResp.status === 200, 'IMA3 SDK returned 200 OK');
  assert(imaSdkResp.body.includes('window.google={ima:'), 'IMA3 SDK returned mock stub code');
  assert(imaSdkResp.headers['X-LocalDNS-Mock'] === 'true', 'IMA3 SDK marked with X-LocalDNS-Mock header');

  // 12.5 YouTube 增强版去广告规则测试 (切片阻断与广告上报阻断)
  const ytVideoPlaybackResp = await proxyHandler.processRequest({
    url: 'https://rr1---sn-4g5edn6e.googlevideo.com/videoplayback?id=999&oad=1&ad_v=2',
    method: 'GET',
    headers: { host: 'rr1---sn-4g5edn6e.googlevideo.com' },
  });
  assert(ytVideoPlaybackResp.status === 204, 'YouTube oad/ad_v video slice intercepted with 204');

  const ytStatsAdsResp = await proxyHandler.processRequest({
    url: 'https://www.youtube.com/api/stats/ads?ns=yt',
    method: 'GET',
    headers: { host: 'www.youtube.com' },
  });
  assert(ytStatsAdsResp.status === 204, 'YouTube api/stats/ads tracking intercepted with 204');

  const ytStatsAtrResp = await proxyHandler.processRequest({
    url: 'https://m.youtube.com/api/stats/atr?ns=yt',
    method: 'POST',
    headers: { host: 'm.youtube.com' },
  });
  assert(ytStatsAtrResp.status === 204, 'YouTube m.youtube.com atr tracking intercepted with 204');

  // 12.6 YouTube 播放器 JSON 响应多级嵌套剪枝测试
  const nestedYtJson = JSON.stringify({
    playerResponse: {
      adPlacements: [{ adPlacementRenderer: { adId: 'abc' } }],
      playerAds: [{ format: 'instream' }],
      adSlots: ['slot_ad_1'],
      playbackTracking: {
        atrUrl: { baseUrl: 'https://youtube.com/atr' },
        videostatsPlaybackUrl: { baseUrl: 'https://youtube.com/stats' },
        genuineStats: { baseUrl: 'https://youtube.com/qoe' }
      },
      videoDetails: { title: 'Genuine Video' }
    }
  });

  const cleanedNestedStr = StreamCleaner.cleanJSON(nestedYtJson, 'https://www.youtube.com/watch?v=123');
  const cleanedNested = JSON.parse(cleanedNestedStr);
  assert(cleanedNested.playerResponse.adPlacements === undefined, 'Nested adPlacements in playerResponse purged');
  assert(cleanedNested.playerResponse.playerAds === undefined, 'Nested playerAds in playerResponse purged');
  assert(cleanedNested.playerResponse.playbackTracking.atrUrl === undefined, 'atrUrl tracking purged');
  assert(cleanedNested.playerResponse.videoDetails.title === 'Genuine Video', 'Genuine videoDetails preserved');

  // -------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------
  console.log('\n================================================================');
  console.log(`  Tests Completed: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
  console.log('================================================================\n');

  Script.exit({ passed, failed });
}

runModulesTestSuite().catch((err) => {
  console.error('[TestSuite Fatal Error]', err);
  Script.exit({ error: String(err) });
});
