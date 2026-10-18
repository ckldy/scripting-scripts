import { Path, Script } from 'scripting';
import { LocalDnsServer } from '../src/server';

async function runTests() {
  console.log('=== [LocalDNS] Starting Full Upgrade Verification Test Suite ===');
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

  // 1. 验证静态资源与文件系统完整性
  console.log('\n--- Test 1: Static Files & Assets Verification ---');
  console.log('Script.directory is:', Script.directory);
  const projectDir = Script.directory.includes('tools') ? Path.dirname(Script.directory) : Script.directory;
  const webDir = Path.join(projectDir, 'web');
  console.log('Resolved webDir is:', webDir);
  assert(await FileManager.exists(Path.join(webDir, 'index.html')), 'index.html exists');
  assert(await FileManager.exists(Path.join(webDir, 'version.json')), 'version.json exists');
  assert(await FileManager.exists(Path.join(webDir, 'assets/css/skin-claude.css')), 'skin-claude.css exists');
  assert(await FileManager.exists(Path.join(webDir, 'assets/js/skin.js')), 'skin.js exists');
  assert(await FileManager.exists(Path.join(webDir, 'assets/js/appearance.js')), 'appearance.js exists');
  assert(await FileManager.exists(Path.join(webDir, 'assets/js/topology-flow.js')), 'topology-flow.js exists');
  assert(await FileManager.exists(Path.join(webDir, 'assets/js/font-uploads.js')), 'font-uploads.js exists');

  // 读取 version.json 校验
  const verStr = await FileManager.readAsString(Path.join(webDir, 'version.json'));
  const verData = JSON.parse(verStr);
  assert(verData.uiVersion === '2026.10.18.19', `UI version matches 2026.10.18.19 (got: ${verData.uiVersion})`);
  assert(verData.backendVersion === 'FJGAC', `Backend version matches FJGAC (got: ${verData.backendVersion})`);
  assert(verData.releaseTag === 'fjgac-ui-v2026.10.18.19', `Release tag matches (got: ${verData.releaseTag})`);

  // 检查 index.html 包含双皮肤及新资源引入
  const htmlStr = await FileManager.readAsString(Path.join(webDir, 'index.html'));
  assert(htmlStr.includes('data-skin="claude"'), 'index.html includes Claude skin attribute');
  assert(htmlStr.includes('assets/css/skin-claude.css'), 'index.html links skin-claude.css');
  assert(htmlStr.includes('assets/js/skin.js'), 'index.html links skin.js');
  assert(htmlStr.includes('assets/js/appearance.js'), 'index.html links appearance.js');
  assert(htmlStr.includes('data-backend-version="FJGAC"'), 'index.html has FJGAC data attribute');

  // 检查 app.css 中防溢出弹性图例样式
  const cssStr = await FileManager.readAsString(Path.join(webDir, 'assets/css/app.css'));
  assert(cssStr.includes('.rl-name-text'), 'app.css includes fortified .rl-name-text class');
  assert(cssStr.includes('font-variant-numeric: tabular-nums'), 'app.css has tabular numbers for legends');

  // 检查 console.js 中防御性 closest 选择器，避免空指针解引用
  const consoleJsStr = await FileManager.readAsString(Path.join(webDir, 'assets/js/console.js'));
  assert(consoleJsStr.includes("trend?.closest('.col-8, .col-6')"), 'console.js includes safe trend column query');

  // 检查 app.js 中脉冲监控与全量 safe 保护
  const appJsStr = await FileManager.readAsString(Path.join(webDir, 'assets/js/app.js'));
  assert(appJsStr.includes('挂载概览页实时轻量心跳'), 'app.js includes realtime pulse timer');
  assert(appJsStr.includes('safe(()=>api.stats()'), 'app.js includes safe() wrapper for api.stats');
  assert(appJsStr.includes('国外默认') && appJsStr.includes('国内直连'), 'app.js includes Chinese legend labels');

  // 检查规则管理模块导入、HTTP重写与动态视图
  assert(appJsStr.includes('data-rule-tab="modules"'), 'app.js includes modules tab button in rules management');
  assert(appJsStr.includes('data-rule-tab="rewrites"'), 'app.js includes rewrites tab button in rules management');
  assert(appJsStr.includes('data-log-tab="rewrite"'), 'app.js includes rewrite log tab in query logs');
  assert(appJsStr.includes('renderModules'), 'app.js implements renderModules component');
  assert(appJsStr.includes('renderRewrites'), 'app.js implements renderRewrites component');
  assert(appJsStr.includes('renderHttpRewriteLogs'), 'app.js implements renderHttpRewriteLogs component');
  assert(appJsStr.includes('openRewriteModal'), 'app.js implements openRewriteModal component');
  assert(appJsStr.includes('openRewriteTestModal'), 'app.js implements openRewriteTestModal component');
  assert(appJsStr.includes('openModuleModal'), 'app.js implements openModuleModal import modal');
  assert(appJsStr.includes('btn-mount-surge'), 'app.js includes btn-mount-surge client link button');
  assert(appJsStr.includes('btn-mount-loon'), 'app.js includes btn-mount-loon client link button');
  assert(appJsStr.includes('btn-native-vpn-toggle'), 'app.js includes btn-native-vpn-toggle native VPN button');
  assert(appJsStr.includes('btn-download-mobileconfig'), 'app.js includes btn-download-mobileconfig Apple DNS button');
  assert(appJsStr.includes('btn-preview-compiled-module'), 'app.js includes btn-preview-compiled-module button');
  assert(appJsStr.includes('topo-dynamic-toolbar'), 'app.js includes topo-dynamic-toolbar HTML');
  assert(appJsStr.includes('runTopoTracer'), 'app.js implements runTopoTracer dynamic path reasoning');
  assert(appJsStr.includes('rewrite-filter-bar'), 'app.js includes rewrite-filter-bar multi-dimensional filter');
  assert(appJsStr.includes('switch_mitm') && appJsStr.includes('switch_rewrite'), 'app.js switchProfiles includes switch_mitm and switch_rewrite');

  // 检查 app.css 中动态视图工具栏与重写样式
  assert(cssStr.includes('.topo-dynamic-toolbar'), 'app.css includes .topo-dynamic-toolbar styles');
  assert(cssStr.includes('.topo-pill-btn'), 'app.css includes .topo-pill-btn styles');
  assert(cssStr.includes('.rewrite-stat-grid'), 'app.css includes .rewrite-stat-grid styles');
  assert(cssStr.includes('.rewrite-rules-table'), 'app.css includes .rewrite-rules-table styles');
  assert(cssStr.includes('.rewrite-filter-bar'), 'app.css includes .rewrite-filter-bar styles');

  // 检查 topology-flow.js 动态分流引擎
  const topoFlowJsStr = await FileManager.readAsString(Path.join(webDir, 'assets/js/topology-flow.js'));
  assert(topoFlowJsStr.includes('setCustomPath'), 'topology-flow.js supports setCustomPath method');
  assert(topoFlowJsStr.includes('setCategory'), 'topology-flow.js supports setCategory method');

  // 2. 服务端与 API 契约测试
  console.log('\n--- Test 2: Server Startup & API Contract Verification ---');
  const server = LocalDnsServer.get();
  const startRes = server.start(9199);
  assert(startRes.success === true, `HTTP Server started on port ${startRes.port}`);

  const baseUrl = `http://127.0.0.1:${startRes.port}`;

  try {
    // 2.1 验证 /ui/ 静态托管
    const resUi = await fetch(`${baseUrl}/ui/index.html`);
    assert(resUi.status === 200, `/ui/index.html returns 200 OK (status: ${resUi.status})`);
    const cTypeUi = resUi.headers.get('Content-Type') || '';
    assert(cTypeUi.includes('text/html'), `Content-Type is text/html (got: ${cTypeUi})`);

    // 2.2 验证 /ui/version.json 静态托管
    const resVer = await fetch(`${baseUrl}/ui/version.json`);
    assert(resVer.status === 200, `/ui/version.json returns 200 OK`);
    const verJson = await resVer.json();
    assert(verJson.backendVersion === 'FJGAC', `Static version.json returns FJGAC`);

    // 2.3 验证 /ui/assets/css/skin-claude.css 静态托管
    const resClaudeCss = await fetch(`${baseUrl}/ui/assets/css/skin-claude.css`);
    assert(resClaudeCss.status === 200, `/ui/assets/css/skin-claude.css returns 200 OK`);
    assert((resClaudeCss.headers.get('Content-Type') || '').includes('text/css'), 'CSS Content-Type is correct');

    // 2.4 验证 /api/v1/status 契约
    const resStatus = await fetch(`${baseUrl}/api/v1/status`);
    assert(resStatus.status === 200, `/api/v1/status returns 200 OK`);
    const statusJson = await resStatus.json();
    assert(statusJson.status === 'online', 'status is online');
    assert(statusJson.version === 'FJGAC', `version is FJGAC (got: ${statusJson.version})`);
    assert(typeof statusJson.rules === 'object' && statusJson.rules !== null, 'rules object is present');
    assert(typeof statusJson.stats === 'object' && statusJson.stats !== null, 'stats object is present');
    assert(Array.isArray(statusJson.upstream_stats), 'upstream_stats is an array');

    // 2.5 验证 /metrics 包含 FJGAC 版本指标
    const resMetrics = await fetch(`${baseUrl}/metrics`);
    assert(resMetrics.status === 200, `/metrics returns 200 OK`);
    const metricsText = await resMetrics.text();
    assert(metricsText.includes('localdns_info{version="FJGAC"} 1'), 'metrics includes localdns_info with FJGAC');
    assert(metricsText.includes('process_cpu_seconds_total'), 'metrics includes CPU counter');
    assert(metricsText.includes('process_resident_memory_bytes'), 'metrics includes RSS memory metric');

    // 2.6 验证根路径重定向到 /ui/
    const resRoot = await fetch(`${baseUrl}/`);
    assert(resRoot.status === 200 && (resRoot.url.includes('/ui') || resRoot.redirected), `Root / properly resolves/redirects to /ui/ (status: ${resRoot.status}, url: ${resRoot.url})`);
    // 2.7 验证 /api/v1/modules 模块 API
    const resModules = await fetch(`${baseUrl}/api/v1/modules`);
    assert(resModules.status === 200, `/api/v1/modules returns 200 OK`);
    const modData = await resModules.json();
    assert(modData.success === true, 'modules api returns success true');
    assert(Array.isArray(modData.modules), 'modules list is an array');
    assert(modData.stats && typeof modData.stats.totalModules === 'number', 'modules stats present');

    // 2.8 验证 switch_mitm 与 switch_rewrite 功能开关接口
    const resMitm = await fetch(`${baseUrl}/plugins/switch_mitm/show`);
    assert(resMitm.status === 200, `/plugins/switch_mitm/show returns 200 OK`);
    const valMitm = (await resMitm.text()).trim();
    assert(valMitm === 'A' || valMitm === 'B', `switch_mitm value is valid (got ${valMitm})`);

    const resRewrite = await fetch(`${baseUrl}/plugins/switch_rewrite/show`);
    assert(resRewrite.status === 200, `/plugins/switch_rewrite/show returns 200 OK`);
    const valRewrite = (await resRewrite.text()).trim();
    assert(valRewrite === 'A' || valRewrite === 'B', `switch_rewrite value is valid (got ${valRewrite})`);

    // 验证开关切换持久化
    const postMitm = await fetch(`${baseUrl}/plugins/switch_mitm/post`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: 'B' }),
    });
    assert(postMitm.status === 200, `POST /plugins/switch_mitm/post returns 200 OK`);
    const getMitmB = await (await fetch(`${baseUrl}/plugins/switch_mitm/show`)).text();
    assert(getMitmB.trim() === 'B', `switch_mitm toggled to B`);

    // 恢复开关为 A
    await fetch(`${baseUrl}/plugins/switch_mitm/post`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: 'A' }),
    });
    const getMitmA = await (await fetch(`${baseUrl}/plugins/switch_mitm/show`)).text();
    assert(getMitmA.trim() === 'A', `switch_mitm restored to A`);

    // 2.9 验证 /api/v1/rewrites 全套 CRUD 与测试接口
    const resGetRw = await fetch(`${baseUrl}/api/v1/rewrites`);
    assert(resGetRw.status === 200, `GET /api/v1/rewrites returns 200 OK`);
    const rwData = await resGetRw.json();
    assert(rwData.success === true, 'rewrites api returns success true');
    assert(Array.isArray(rwData.rewrites), 'rewrites list is an array');
    assert(typeof rwData.rawText === 'string', 'rawText export is string');

    // 添加单条自定义重写规则
    const resAddRw = await fetch(`${baseUrl}/api/v1/rewrites`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: '测试自定义重写',
        pattern: '^https?:\\/\\/api\\.testsuite\\.com\\/mock-unit',
        action: 'mock',
        target: '200',
        extra: '{"unitTest":true}',
        enabled: true,
        note: '自动化测试生成'
      }),
    });
    assert(resAddRw.status === 200, `POST /api/v1/rewrites returns 200 OK`);
    const addedRw = await resAddRw.json();
    assert(addedRw.success === true && addedRw.rewrite && addedRw.rewrite.id, 'Created rewrite has id');
    const newRwId = addedRw.rewrite.id;

    // 验证在线重写推演测试接口
    const resSimRw = await fetch(`${baseUrl}/api/v1/rewrites/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: 'https://api.testsuite.com/mock-unit',
        method: 'GET'
      }),
    });
    assert(resSimRw.status === 200, `POST /api/v1/rewrites/test returns 200 OK`);
    const simData = await resSimRw.json();
    assert(simData.matched === true, 'Test simulation matched newly created rewrite rule');
    assert(simData.simulation.status === 200, 'Test simulation returned status 200');
    assert(simData.simulation.bodySnippet.includes('unitTest'), 'Simulation body includes mock payload');

    // 切换单条规则状态
    const resToggleRw = await fetch(`${baseUrl}/api/v1/rewrites/${encodeURIComponent(newRwId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    });
    assert(resToggleRw.status === 200, `PUT /api/v1/rewrites/:id returns 200 OK`);
    const toggledRw = await resToggleRw.json();
    assert(toggledRw.rewrite.enabled === false, 'Rewrite enabled toggled to false');

    // 删除单条规则
    const resDelRw = await fetch(`${baseUrl}/api/v1/rewrites/${encodeURIComponent(newRwId)}`, {
      method: 'DELETE',
    });
    assert(resDelRw.status === 200, `DELETE /api/v1/rewrites/:id returns 200 OK`);

    // 验证纯文本批量保存
    const resTextRw = await fetch(`${baseUrl}/api/v1/rewrites/text`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: '^https?:\\/\\/api\\.testsuite\\.com\\/batch-text mock 204\n^https?:\\/\\/api\\.testsuite\\.com\\/u\\/(.+) 302 https://new.com/$1'
      }),
    });
    assert(resTextRw.status === 200, `POST /api/v1/rewrites/text returns 200 OK`);
    const textSaved = await resTextRw.json();
    assert(textSaved.count === 2, 'Batch text parsed 2 rewrite rules');

    // 2.10 验证 HTTP 重写与流清洗实时审计日志接口
    const resRwLogs = await fetch(`${baseUrl}/api/v1/rewrites/logs?page=1&limit=20`);
    assert(resRwLogs.status === 200, `GET /api/v1/rewrites/logs returns 200 OK`);
    const rwLogsData = await resRwLogs.json();
    assert(rwLogsData.success === true, 'rewrites logs api returns success true');
    assert(Array.isArray(rwLogsData.list), 'rewrites logs list is an array');
    assert(typeof rwLogsData.total === 'number', 'rewrites logs total is a number');
    assert(rwLogsData.stats && typeof rwLogsData.stats.totalRequests === 'number', 'rewrites logs stats present');

    // 验证重写统计接口
    const resRwStats = await fetch(`${baseUrl}/api/v1/rewrites/stats`);
    assert(resRwStats.status === 200, `GET /api/v1/rewrites/stats returns 200 OK`);
    const rwStatsData = await resRwStats.json();
    assert(rwStatsData.success === true && typeof rwStatsData.stats.totalRequests === 'number', 'rewrites stats returns valid data');

    // 验证清空重写日志接口
    const resRwClear = await fetch(`${baseUrl}/api/v1/rewrites/logs/clear`, { method: 'POST' });
    assert(resRwClear.status === 200, `POST /api/v1/rewrites/logs/clear returns 200 OK`);
    const resRwLogsAfter = await (await fetch(`${baseUrl}/api/v1/rewrites/logs`)).json();
    assert(resRwLogsAfter.total === 0, 'rewrites logs cleared to 0');

    // 2.11 验证透明 HTTP/HTTPS 代理与绝对 URL 自动嗅探 (9099 与 9443 双端口对称生效)
    const resBiliProxy = await fetch(`${baseUrl}/x/v2/splash`, {
      method: 'GET',
      headers: { Host: 'api.bilibili.com' },
    });
    assert(resBiliProxy.status === 204, `Transparent HTTP proxy intercepts Bilibili splash ad with 204 (got ${resBiliProxy.status})`);
    assert(resBiliProxy.headers.get('X-LocalDNS-Proxy')?.startsWith('transparent'), 'X-LocalDNS-Proxy header is transparent');
    assert(resBiliProxy.headers.get('X-LocalDNS-Cleaned') === 'true', 'X-LocalDNS-Cleaned header is true');

    // 验证以绝对 HTTPS 路径发起的代理请求 (如通过 HTTPS 端口或客户端代理连接发起)
    const resBiliAbsHttps = await fetch(`${baseUrl}/https://api.bilibili.com/x/v2/splash`, {
      method: 'GET',
    });
    assert(resBiliAbsHttps.status === 204, `Absolute HTTPS proxy URL intercepts Bilibili splash ad with 204 (got ${resBiliAbsHttps.status})`);
    assert(resBiliAbsHttps.headers.get('X-LocalDNS-Cleaned') === 'true', 'Absolute HTTPS URL proxy marked as cleaned');

    // 验证全网通用视频 SDK 桩代码透明代理拦截
    const resImaProxy = await fetch(`${baseUrl}/js/sdkloader/ima3.js`, {
      method: 'GET',
      headers: { Host: 'imasdk.googleapis.com' },
    });
    assert(resImaProxy.status === 200, `Transparent HTTP proxy mocks Google IMA3 SDK with 200 (got ${resImaProxy.status})`);
    const imaBody = await resImaProxy.text();
    assert(imaBody.includes('window.google={ima:'), 'Google IMA3 SDK mock stub code returned');
    assert(resImaProxy.headers.get('X-LocalDNS-Cleaned') === 'true', 'IMA SDK marked as cleaned');

    // 2.12 验证动态编译模块导出端点 (/localdns.sgmodule, /localdns.plugin, /localdns.conf)
    const resSurgeExport = await fetch(`${baseUrl}/localdns.sgmodule`);
    assert(resSurgeExport.status === 200, `/localdns.sgmodule returns 200 OK`);
    const surgeExportText = await resSurgeExport.text();
    assert(surgeExportText.includes('#!name=LocalDNS') && surgeExportText.includes('[MITM]') && surgeExportText.includes('[URL Rewrite]'), 'Surge module export contains header, MITM and Rewrite sections');

    const resLoonExport = await fetch(`${baseUrl}/localdns.plugin`);
    assert(resLoonExport.status === 200, `/localdns.plugin returns 200 OK`);
    const loonExportText = await resLoonExport.text();
    assert(loonExportText.includes('#!name=LocalDNS') && loonExportText.includes('[Mitm]') && loonExportText.includes('[Rewrite]'), 'Loon plugin export contains header, Mitm and Rewrite sections');

    const resQxExport = await fetch(`${baseUrl}/localdns.conf`);
    assert(resQxExport.status === 200, `/localdns.conf returns 200 OK`);
    const qxExportText = await resQxExport.text();
    assert(qxExportText.includes('[rewrite_local]') && qxExportText.includes('[mitm]'), 'Quantumult X export contains rewrite_local and mitm sections');

    // 2.13 验证系统级原生 VPN 控制接口与 Apple 原生加密 DNS 描述文件
    const resVpn = await fetch(`${baseUrl}/api/v1/system/vpn`);
    assert(resVpn.status === 200, `/api/v1/system/vpn returns 200 OK`);
    const vpnData = await resVpn.json();
    assert(vpnData.success === true && vpnData.vpn, 'Native VPN status contract valid');

    const resMobileconfig = await fetch(`${baseUrl}/localdns.mobileconfig`);
    assert(resMobileconfig.status === 200, `/localdns.mobileconfig returns 200 OK`);
    const cTypeMc = resMobileconfig.headers.get('Content-Type') || '';
    assert(cTypeMc.includes('apple-aspen-config'), 'Content-Type is apple-aspen-config');
    const mcText = await resMobileconfig.text();
    assert(mcText.includes('com.apple.dnsSettings.managed'), 'Apple DNS payload type matches com.apple.dnsSettings.managed');
    assert(mcText.includes('com.apple.security.root'), 'Apple profile bundles com.apple.security.root root CA');
    assert(mcText.includes('https://localdns.local:'), 'ServerURL uses standard FQDN https://localdns.local:');
    assert(!mcText.includes('http://127.0.0.1'), 'ServerURL strictly avoids forbidden plain HTTP or IP addresses');
    assert(mcText.includes('<string>127.0.0.1</string>'), 'ServerAddresses contains 127.0.0.1 bootstrap address');
  } catch (err: any) {
    console.error('API Test Error:', err);
    failed++;
  } finally {
    server.stop();
    console.log('HTTP Server stopped.');
  }

  console.log(`\n========================================`);
  console.log(`Test Result: Total ${passed + failed}, Passed: ${passed}, Failed: ${failed}`);
  console.log(`========================================`);

  if (failed > 0) {
    Script.exit({ ok: false, failed });
  } else {
    Script.exit({ ok: true, passed });
  }
}

runTests().catch(e => {
  console.error('Fatal Test Exception:', e);
  Script.exit({ ok: false, error: String(e) });
});
