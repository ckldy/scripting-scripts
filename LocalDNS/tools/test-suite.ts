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
  assert(verData.uiVersion === '2026.10.17.2', `UI version matches 2026.10.17.2 (got: ${verData.uiVersion})`);
  assert(verData.backendVersion === 'FJG4Z', `Backend version matches FJG4Z (got: ${verData.backendVersion})`);
  assert(verData.releaseTag === 'fjg4z-ui-v2026.10.17.2', `Release tag matches (got: ${verData.releaseTag})`);

  // 检查 index.html 包含双皮肤及新资源引入
  const htmlStr = await FileManager.readAsString(Path.join(webDir, 'index.html'));
  assert(htmlStr.includes('data-skin="claude"'), 'index.html includes Claude skin attribute');
  assert(htmlStr.includes('assets/css/skin-claude.css'), 'index.html links skin-claude.css');
  assert(htmlStr.includes('assets/js/skin.js'), 'index.html links skin.js');
  assert(htmlStr.includes('assets/js/appearance.js'), 'index.html links appearance.js');
  assert(htmlStr.includes('data-backend-version="FJG4Z"'), 'index.html has FJG4Z data attribute');

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

  // 检查规则管理模块导入与动态视图
  assert(appJsStr.includes('data-rule-tab="modules"'), 'app.js includes modules tab button in rules management');
  assert(appJsStr.includes('renderModules'), 'app.js implements renderModules component');
  assert(appJsStr.includes('openModuleModal'), 'app.js implements openModuleModal import modal');
  assert(appJsStr.includes('topo-dynamic-toolbar'), 'app.js includes topo-dynamic-toolbar HTML');
  assert(appJsStr.includes('runTopoTracer'), 'app.js implements runTopoTracer dynamic path reasoning');
  assert(appJsStr.includes('switch_mitm') && appJsStr.includes('switch_rewrite'), 'app.js switchProfiles includes switch_mitm and switch_rewrite');

  // 检查 app.css 中动态视图工具栏样式
  assert(cssStr.includes('.topo-dynamic-toolbar'), 'app.css includes .topo-dynamic-toolbar styles');
  assert(cssStr.includes('.topo-pill-btn'), 'app.css includes .topo-pill-btn styles');

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
    assert(verJson.backendVersion === 'FJG4Z', `Static version.json returns FJG4Z`);

    // 2.3 验证 /ui/assets/css/skin-claude.css 静态托管
    const resClaudeCss = await fetch(`${baseUrl}/ui/assets/css/skin-claude.css`);
    assert(resClaudeCss.status === 200, `/ui/assets/css/skin-claude.css returns 200 OK`);
    assert((resClaudeCss.headers.get('Content-Type') || '').includes('text/css'), 'CSS Content-Type is correct');

    // 2.4 验证 /api/v1/status 契约
    const resStatus = await fetch(`${baseUrl}/api/v1/status`);
    assert(resStatus.status === 200, `/api/v1/status returns 200 OK`);
    const statusJson = await resStatus.json();
    assert(statusJson.status === 'online', 'status is online');
    assert(statusJson.version === 'FJG4Z', `version is FJG4Z (got: ${statusJson.version})`);
    assert(typeof statusJson.rules === 'object' && statusJson.rules !== null, 'rules object is present');
    assert(typeof statusJson.stats === 'object' && statusJson.stats !== null, 'stats object is present');
    assert(Array.isArray(statusJson.upstream_stats), 'upstream_stats is an array');

    // 2.5 验证 /metrics 包含 FJG4Z 版本指标
    const resMetrics = await fetch(`${baseUrl}/metrics`);
    assert(resMetrics.status === 200, `/metrics returns 200 OK`);
    const metricsText = await resMetrics.text();
    assert(metricsText.includes('localdns_info{version="FJG4Z"} 1'), 'metrics includes localdns_info with FJG4Z');
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
