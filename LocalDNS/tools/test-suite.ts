import { Path, Script } from 'scripting';
import { LocalDnsServer } from '../src/server';
import { DnsResolver } from '../src/resolver';
import { parseDnsPacket, serializeDnsPacket } from '../src/dns-packet';
import { AdGuardEngine } from '../src/adguard';
import type { DnsPacket } from '../src/types';

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

  // 检查原生闭环入口与拓扑动态推演组件
  assert(appJsStr.includes('btn-ov-vpn-toggle'), 'app.js includes btn-ov-vpn-toggle native VPN button');
  assert(appJsStr.includes('btn-ov-install-mobileconfig'), 'app.js includes btn-ov-install-mobileconfig Apple DNS button');
  assert(appJsStr.includes('topo-dynamic-toolbar'), 'app.js includes topo-dynamic-toolbar HTML');
  assert(appJsStr.includes('runTopoTracer'), 'app.js implements runTopoTracer dynamic path reasoning');

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
    // 2.7 验证 AdGuard 18.5 万条广告过滤规则库开箱即用状态
    const ruleCount = AdGuardEngine.get().getRuleCount();
    assert(ruleCount > 100000, `AdGuard engine has over 100,000 rules active (got: ${ruleCount.toLocaleString()})`);

    // 2.8 验证 DNS 核心与 AdGuard 广告域名真实黑洞化拦截 (返回 0.0.0.0)
    const resolver = DnsResolver.get();

    // 构造测试 DNS wire 报文函数
    const makeDnsQuery = (qname: string): Uint8Array => {
      const pkt: DnsPacket = {
        id: Math.floor(Math.random() * 65535),
        flags: 0x0100,
        qr: false,
        opcode: 0,
        aa: false,
        tc: false,
        rd: true,
        ra: false,
        rcode: 0,
        rcodeName: 'NOERROR',
        questions: [{ name: qname, type: 1, typeName: 'A', class: 1 }],
        answers: [],
        authorities: [],
        additionals: [],
      };
      return serializeDnsPacket(pkt);
    };

    // 验证百度移动广告拦截
    const resBaiduAd = await resolver.resolve(makeDnsQuery('mobads.baidu.com'), '127.0.0.1');
    const parsedBaiduAd = parseDnsPacket(resBaiduAd);
    assert(parsedBaiduAd.answers.length > 0 && String(parsedBaiduAd.answers[0].data) === '0.0.0.0', 'mobads.baidu.com resolved to 0.0.0.0 (AdGuard blocked)');

    // 验证腾讯广点通广告拦截
    const resGdtAd = await resolver.resolve(makeDnsQuery('pgdt.gtimg.cn'), '127.0.0.1');
    const parsedGdtAd = parseDnsPacket(resGdtAd);
    assert(parsedGdtAd.answers.length > 0 && String(parsedGdtAd.answers[0].data) === '0.0.0.0', 'pgdt.gtimg.cn resolved to 0.0.0.0 (AdGuard blocked)');

    // 验证 YouTube 广告打点拦截
    const resYtAd = await resolver.resolve(makeDnsQuery('s.youtube.com'), '127.0.0.1');
    const parsedYtAd = parseDnsPacket(resYtAd);
    assert(parsedYtAd.answers.length > 0 && String(parsedYtAd.answers[0].data) === '0.0.0.0', 's.youtube.com resolved to 0.0.0.0 (AdGuard blocked)');

    // 验证 Google 双击广告拦截
    const resDblAd = await resolver.resolve(makeDnsQuery('pagead2.googlesyndication.com'), '127.0.0.1');
    const parsedDblAd = parseDnsPacket(resDblAd);
    assert(parsedDblAd.answers.length > 0 && String(parsedDblAd.answers[0].data) === '0.0.0.0', 'pagead2.googlesyndication.com resolved to 0.0.0.0 (AdGuard blocked)');

    // 验证正常国内域名正常解析到合法 IP
    const resNormal = await resolver.resolve(makeDnsQuery('baidu.com'), '127.0.0.1');
    const parsedNormal = parseDnsPacket(resNormal);
    assert(parsedNormal.answers.length > 0 && String(parsedNormal.answers[0].data) !== '0.0.0.0', 'baidu.com resolved to genuine non-blocked IP');

    // 2.9 验证 DoH 二进制 Wire 报文 POST 端点 (/dns-query)
    const dohPostQuery = makeDnsQuery('mobads.baidu.com');
    const resDohPost = await fetch(`${baseUrl}/dns-query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/dns-message' },
      body: dohPostQuery,
    });
    assert(resDohPost.status === 200, `POST /dns-query returns 200 OK`);
    assert(resDohPost.headers.get('Content-Type')?.includes('application/dns-message'), 'DoH POST Content-Type is application/dns-message');
    const dohPostBytes = new Uint8Array(await resDohPost.arrayBuffer());
    const parsedDohPost = parseDnsPacket(dohPostBytes);
    assert(parsedDohPost.answers[0]?.data === '0.0.0.0', 'DoH POST returned 0.0.0.0 blocked answer');

    // 2.10 验证 DoH GET 端点 (/dns-query?dns=...)
    let b64Dns = btoa(String.fromCharCode(...dohPostQuery)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const resDohGet = await fetch(`${baseUrl}/dns-query?dns=${b64Dns}`);
    assert(resDohGet.status === 200, `GET /dns-query?dns=... returns 200 OK`);
    assert(resDohGet.headers.get('Content-Type')?.includes('application/dns-message'), 'DoH GET Content-Type is application/dns-message');

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

    // 2.14 验证 /api/proxy-config/... 协同管理与备份接口 (FJGAC / UI 2026.10.18.19)
    // 2.14.1 界面设置 (interface/brand)
    const resGetBrand = await fetch(`${baseUrl}/api/proxy-config/interface/brand`);
    assert(resGetBrand.status === 200, `GET /api/proxy-config/interface/brand returns 200 OK`);
    const brandData = await resGetBrand.json();
    assert(brandData.revision !== undefined, 'interface/brand has revision field');

    const resPostBrand = await fetch(`${baseUrl}/api/proxy-config/interface/brand`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: { name: 'LocalDNS Test', logo: '' }, revision: '0' }),
    });
    assert(resPostBrand.status === 200, `POST /api/proxy-config/interface/brand returns 200 OK`);
    const postedBrand = await resPostBrand.json();
    assert(postedBrand.value?.name === 'LocalDNS Test', 'Brand name saved in server interface settings');

    // 2.14.2 规则备份与恢复 (rule-backups)
    const resPostBackup = await fetch(`${baseUrl}/api/proxy-config/rule-backups`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tag: 'whitelist', content: 'test.example.com\nmytest.com' }),
    });
    assert(resPostBackup.status === 200, `POST /api/proxy-config/rule-backups returns 200 OK`);
    const backupResult = await resPostBackup.json();
    assert(backupResult.saved === true && backupResult.backup?.id, 'Backup saved on server with valid id');
    const backupId = backupResult.backup.id;

    const resGetBackups = await fetch(`${baseUrl}/api/proxy-config/rule-backups?tag=whitelist`);
    assert(resGetBackups.status === 200, `GET /api/proxy-config/rule-backups?tag=whitelist returns 200 OK`);
    const backupsList = await resGetBackups.json();
    assert(Array.isArray(backupsList.backups) && backupsList.backups.length > 0, 'Backups list returns array with backup');

    const resGetSingleBackup = await fetch(`${baseUrl}/api/proxy-config/rule-backups?tag=whitelist&id=${backupId}`);
    assert(resGetSingleBackup.status === 200, `GET single backup by id returns 200 OK`);
    const singleBackup = await resGetSingleBackup.json();
    assert(singleBackup.content.includes('test.example.com'), 'Backup content matches original saved text');

    // 2.14.3 流量历史采样 (traffic)
    const resTraffic = await fetch(`${baseUrl}/api/proxy-config/traffic?minutes=60`);
    assert(resTraffic.status === 200, `GET /api/proxy-config/traffic returns 200 OK`);
    const trafficData = await resTraffic.json();
    assert(Array.isArray(trafficData.points) && Number.isFinite(trafficData.now), 'Traffic data contains points array and valid now timestamp');

    // 2.14.4 配置核心与文件查看
    const resCores = await fetch(`${baseUrl}/api/proxy-config/cores`);
    assert(resCores.status === 200, `GET /api/proxy-config/cores returns 200 OK`);
    const coresData = await resCores.json();
    assert(Array.isArray(coresData.cores) && coresData.cores.length > 0, 'Cores returns active local core');

    const resFiles = await fetch(`${baseUrl}/api/proxy-config/files`);
    assert(resFiles.status === 200, `GET /api/proxy-config/files returns 200 OK`);
    const filesData = await resFiles.json();
    assert(Array.isArray(filesData.files) && filesData.directory, 'Files returns directory listing');
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
