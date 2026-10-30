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
  assert(await FileManager.exists(Path.join(webDir, 'config.js')), 'config.js exists');
  assert(await FileManager.exists(Path.join(webDir, 'build-meta.json')), 'build-meta.json exists');
  assert(await FileManager.exists(Path.join(webDir, 'assets/app-CrSEI1zm.js')), 'bundled app js exists');
  assert(await FileManager.exists(Path.join(webDir, 'assets/index-Bv4RNw_V.css')), 'bundled css exists');
  assert(await FileManager.exists(Path.join(webDir, 'assets/editor-A1rycQg2.js')), 'proxy editor bundle exists');
  assert(!(await FileManager.exists(Path.join(webDir, 'assets/js/chart.umd.min.js'))), 'unused chart.js removed (upstream 2026.10.26.1)');
  assert(await FileManager.exists(Path.join(webDir, 'custom/settings.json')), 'custom/settings.json exists');

  // 读取 version.json 校验
  const verStr = await FileManager.readAsString(Path.join(webDir, 'version.json'));
  const verData = JSON.parse(verStr);
  assert(verData.uiVersion === '2026.10.30.7', `UI version matches 2026.10.30.7 (got: ${verData.uiVersion})`);
  assert(verData.backendVersion === 'FJH7T', `Backend version matches FJH7T (got: ${verData.backendVersion})`);
  assert(verData.releaseTag === 'fjh7t-ui-v2026.10.30.7', `Release tag matches (got: ${verData.releaseTag})`);

  // 检查 index.html 包含双皮肤及新资源引入
  const htmlStr = await FileManager.readAsString(Path.join(webDir, 'index.html'));
  assert(htmlStr.includes('data-skin="claude"'), 'index.html includes Claude skin attribute');
  assert(htmlStr.includes('/ui/assets/app-CrSEI1zm.js'), 'index.html loads bundled app js');
  assert(htmlStr.includes('/ui/assets/index-Bv4RNw_V.css'), 'index.html loads bundled css');
  assert(htmlStr.includes('/ui/config.js'), 'index.html loads ui config.js');
  assert(htmlStr.includes('/ui/assets/livepulse.js'), 'index.html keeps local livepulse heartbeat patch');
  assert(htmlStr.includes('data-backend-version="FJH7T"'), 'index.html has FJH7T data attribute');

  // 校验打包 bundle 内含关键前端能力
  const appBundle = await FileManager.readAsString(Path.join(webDir, 'assets/app-CrSEI1zm.js'));
  assert(appBundle.length > 500000, `bundle size sane (got ${appBundle.length})`);
  assert(appBundle.includes('/api/v2/audit/logs'), 'bundle calls v2 audit logs');
  assert(appBundle.includes('/api/v1/audit/settings'), 'bundle supports audit settings (log dir)');
  assert(appBundle.includes('/plugins/requery/stats/source_file_counts'), 'bundle calls requery counts');
  assert(appBundle.includes('/api/v1/upstream/config'), 'bundle calls upstream config');
  assert(appBundle.includes('geoip_non_cn'), 'bundle supports geoip_non_cn rule group');
  assert(appBundle.includes('/api/v1/cache/settings'), 'bundle supports cache settings (optional)');
  const bundleCss = await FileManager.readAsString(Path.join(webDir, 'assets/index-Bv4RNw_V.css'));
  assert(bundleCss.length > 100000, `bundled css size sane (got ${bundleCss.length})`);

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
    assert(verJson.backendVersion === 'FJH7T', `Static version.json returns FJH7T`);

    // 2.3 验证 /ui/assets/index-*.css 打包 CSS 静态托管
    const resClaudeCss = await fetch(`${baseUrl}/ui/assets/index-Bv4RNw_V.css`);
    assert(resClaudeCss.status === 200, `/ui/assets/index-Bv4RNw_V.css returns 200 OK`);
    assert((resClaudeCss.headers.get('Content-Type') || '').includes('text/css'), 'CSS Content-Type is correct');

    // 2.4 验证 /api/v1/status 契约
    const resStatus = await fetch(`${baseUrl}/api/v1/status`);
    assert(resStatus.status === 200, `/api/v1/status returns 200 OK`);
    const statusJson = await resStatus.json();
    assert(statusJson.status === 'online', 'status is online');
    assert(statusJson.version === 'FJH7T', `version is FJH7T (got: ${statusJson.version})`);
    assert(typeof statusJson.rules === 'object' && statusJson.rules !== null, 'rules object is present');
    assert(typeof statusJson.stats === 'object' && statusJson.stats !== null, 'stats object is present');
    assert(Array.isArray(statusJson.upstream_stats), 'upstream_stats is an array');

    // 2.4.1 验证 /api/v1/features 不存在（新版 UI 用它探测核心族，404 时进入 legacy 兼容模式）
    const resFeatures = await fetch(`${baseUrl}/api/v1/features`);
    assert(resFeatures.status === 404, `/api/v1/features returns 404 so UI keeps legacy API mode (got: ${resFeatures.status})`);

    // 2.5 验证 /metrics 包含 FJH7T 版本指标
    const resMetrics = await fetch(`${baseUrl}/metrics`);
    assert(resMetrics.status === 200, `/metrics returns 200 OK`);
    const metricsText = await resMetrics.text();
    assert(metricsText.includes('localdns_info{version="FJH7T"} 1'), 'metrics includes localdns_info with FJH7T');
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

    // 2.14 验证 /api/proxy-config/... 协同管理与备份接口 (FJH7T / UI 2026.10.30.7)
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
    assert(Array.isArray(coresData.cores) && coresData.cores.length >= 2, 'Cores returns mihomo and sing-box');
    assert(coresData.cores.every((core: any) => core.available && core.exists && core.mode === 'file'), 'Cores expose available/exists/mode for the new UI');
    assert(coresData.cores.every((core: any) => typeof core.path === 'string' && Array.isArray(core.roots)), 'Cores expose startup path and allowed roots');

    const resFiles = await fetch(`${baseUrl}/api/proxy-config/files`);
    assert(resFiles.status === 200, `GET /api/proxy-config/files returns 200 OK`);
    const filesData = await resFiles.json();
    assert(Array.isArray(filesData.files) && filesData.directory === '/configs', 'Files returns root directory listing');

    const resCoreFiles = await fetch(`${baseUrl}/api/proxy-config/files?core=mihomo&path=%2Fconfigs%2Fmihomo`);
    assert(resCoreFiles.status === 200, `GET /api/proxy-config/files?core=mihomo returns 200 OK`);
    const coreFiles = await resCoreFiles.json();
    assert(Array.isArray(coreFiles.files) && coreFiles.files.some((f: any) => f.path === '/configs/mihomo/config.yaml'), 'Core directory lists the startup config');

    const resRead = await fetch(`${baseUrl}/api/proxy-config/read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ core: 'mihomo', path: '/configs/mihomo/config.yaml' }),
    });
    assert(resRead.status === 200, `POST /api/proxy-config/read returns 200 OK`);
    const readData = await resRead.json();
    assert(readData.path === '/configs/mihomo/config.yaml' && readData.mode === 'file' && typeof readData.revision === 'string', 'Read returns path/mode/revision for the editor');
    assert(typeof readData.content === 'string' && readData.content.includes('mixed-port'), 'Read returns seeded mihomo config content');

    const resCheck = await fetch(`${baseUrl}/api/proxy-config/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ core: 'mihomo', path: '/configs/mihomo/config.yaml', content: readData.content, revision: readData.revision }),
    });
    assert(resCheck.status === 200, `POST /api/proxy-config/check returns 200 OK`);
    const checkData = await resCheck.json();
    assert(checkData.ok === true && typeof checkData.detail === 'string', 'Check reports local virtual config validation');

    // 2.15 LocalDNS × Surge 联动与动态解析路径验证
    console.log('\n--- Test 2.15: Surge Link & Dynamic Routing Verification ---');

    // 2.15.1 导入测试模块并脱水
    const sampleModule = [
      '#!name=Bilibili Clean',
      '#!desc=哔哩哔哩去广告净化模块',
      '[Rule]',
      'DOMAIN-SUFFIX,ad.bilibili.com,REJECT',
      'DOMAIN-SUFFIX,cm.bilibili.com,REJECT',
      '[MITM]',
      'hostname = %APPEND% api.bilibili.com, app.bilibili.com',
      '[URL Rewrite]',
      '^https?:\\/\\/api\\.bilibili\\.com\\/x\\/v2\\/splash _reject',
      '[Script]',
      'bili_feed = type=http-response,pattern=^https?:\\/\\/app\\.bilibili\\.com\\/feed,script-path=bili.js,requires-body=1',
    ].join('\n');

    const resImportMod = await fetch(`${baseUrl}/api/v1/surge/modules`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'test_bili',
        name: '哔哩哔哩净化',
        category: 'app',
        content: sampleModule,
      }),
    });
    assert(resImportMod.status === 200, 'POST /api/v1/surge/modules returns 200 OK');
    const importData = await resImportMod.json();
    assert(importData.success === true && importData.dnsRulesCount === 2, 'Module脱水：提取 2 条域名到 DNS 拦截库');
    assert(importData.mitmCount === 2 && importData.httpRulesCount === 2, 'Module提纯：保留 2 个 MITM 域名与 2 条七层规则');

    // 2.15.2 统一调度模块编译
    const resHub = await fetch(`${baseUrl}/surge/hub.sgmodule`);
    assert(resHub.status === 200, 'GET /surge/hub.sgmodule returns 200 OK');
    const hubText = await resHub.text();
    assert(hubText.includes('#!name=LocalDNS Unified Hub'), 'Hub 模块包含统一命名');
    assert(hubText.includes('api.bilibili.com'), 'Hub 模块包含 MITM 解密域名');
    assert(hubText.includes('splash _reject'), 'Hub 模块包含 URL Rewrite 规则');
    assert(!hubText.includes('ad.bilibili.com'), 'Hub 模块已彻底剔除广告域名（已下沉到 LocalDNS 拦截）');

    // 2.15.3 动态分流组与 RULE-SET 导出
    const resGroups = await fetch(`${baseUrl}/api/v1/surge/diversion/groups`);
    assert(resGroups.status === 200, 'GET /api/v1/surge/diversion/groups returns 200 OK');
    const groupsData = await resGroups.json();
    assert(Array.isArray(groupsData.groups) && groupsData.groups.length >= 5, 'Diversion groups seeded successfully');

    const resDirectList = await fetch(`${baseUrl}/rules/direct.list`);
    assert(resDirectList.status === 200, 'GET /rules/direct.list returns 200 OK');
    const directListText = await resDirectList.text();
    assert(directListText.includes('baidu.com') || directListText.includes('DOMAIN-SUFFIX,cn'), 'Direct RULE-SET exports active direct rules');

    // 2.15.4 Surge 联动配置获取与保存
    const resSurgeCfg = await fetch(`${baseUrl}/api/v1/surge/config`);
    assert(resSurgeCfg.status === 200, 'GET /api/v1/surge/config returns 200 OK');
    const surgeCfg = await resSurgeCfg.json();
    assert(typeof surgeCfg.api_url === 'string' && typeof surgeCfg.enabled === 'boolean', 'Surge config contract valid');

    // 2.15.5 动态 DNS 解析路径与全链路拓扑端点
    const resTopo = await fetch(`${baseUrl}/api/v1/topology/flow`);
    assert(resTopo.status === 200, 'GET /api/v1/topology/flow returns 200 OK');
    const topoData = await resTopo.json();
    assert(topoData.success === true && typeof topoData.surge === 'object', 'Topology flow includes Surge outbound stage');
    assert(topoData.modules.enabled >= 1, 'Topology flow includes active App modules');
    assert(Array.isArray(topoData.diversion.groups) && topoData.diversion.groups.length >= 5, 'Topology flow includes diversion groups');

    // 2.15.6 验证模块脱水后的 DNS 拦截实时生效
    const resolveTestDomain = async (targetDomain: string): Promise<string[]> => {
      const dp: any = {
        id: 1234, flags: 0x0100, qr: false, opcode: 0, aa: false, tc: false, rd: true, ra: false, rcode: 0, rcodeName: 'NOERROR',
        questions: [{ name: targetDomain, type: 1, typeName: 'A', class: 1 }],
        answers: [], authorities: [], additionals: []
      };
      const qBytes = serializeDnsPacket(dp);
      const resDoh = await fetch(`${baseUrl}/dns-query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/dns-message' },
        body: qBytes,
      });
      const ab = await resDoh.arrayBuffer();
      const respP = parseDnsPacket(new Uint8Array(ab));
      return respP.answers.map((a: any) => String(a.data));
    };

    const blockedAnswers = await resolveTestDomain('ad.bilibili.com');
    assert(blockedAnswers.includes('0.0.0.0'), 'ad.bilibili.com 即刻被模块脱水 DNS 引擎拦截为 0.0.0.0');

    // 2.15.7 模块在线代码编辑与重新脱水
    const updatedModule = sampleModule.replace('cm.bilibili.com', 'live.bilibili.com');
    const resPutMod = await fetch(`${baseUrl}/api/v1/surge/modules/test_bili`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '哔哩哔哩净化 (已修改)', content: updatedModule }),
    });
    assert(resPutMod.status === 200, 'PUT /api/v1/surge/modules/:id returns 200 OK');
    const putData = await resPutMod.json();
    assert(putData.success === true && putData.dnsRulesCount === 2, 'Module在线编辑保存并重新脱水');

    // 2.15.8 分流规则多行文本导出与全量批量替换
    const resGetRulesText = await fetch(`${baseUrl}/api/v1/surge/diversion/rules/text?group=direct`);
    assert(resGetRulesText.status === 200, 'GET /api/v1/surge/diversion/rules/text returns 200 OK');
    const rulesTextData = await resGetRulesText.json();
    assert(typeof rulesTextData.text === 'string' && rulesTextData.count > 0, 'Rules text exported for online editor');

    const newRulesText = [
      'DOMAIN-SUFFIX,cn // 大陆顶级域',
      'DOMAIN-SUFFIX,taobao.com // 淘宝直连',
      'DOMAIN-SUFFIX,jd.com // 京东直连',
    ].join('\n');
    const resPostRulesText = await fetch(`${baseUrl}/api/v1/surge/diversion/rules/text`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ group_id: 'direct', text: newRulesText }),
    });
    assert(resPostRulesText.status === 200, 'POST /api/v1/surge/diversion/rules/text returns 200 OK');
    const postRulesData = await resPostRulesText.json();
    assert(postRulesData.success === true && postRulesData.count === 3, 'Group rules batch replaced and saved');

    // 2.15.9 Surge 连通性测试接口
    const resTestConn = await fetch(`${baseUrl}/api/v1/surge/test-connection`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_url: 'http://127.0.0.1:61999', api_key: 'testkey' }),
    });
    assert(resTestConn.status === 200, 'POST /api/v1/surge/test-connection returns 200 OK');
    const testConnData = await resTestConn.json();
    assert(testConnData.success === false && typeof testConnData.hint === 'string', 'Connection test returns diagnosis and actionable hint');

    // 2.15.10 Surge 详细运行体征接口
    const resRuntime = await fetch(`${baseUrl}/api/v1/surge/runtime`);
    assert(resRuntime.status === 200, 'GET /api/v1/surge/runtime returns 200 OK');
    const runtimeData = await resRuntime.json();
    assert(typeof runtimeData.online === 'boolean', 'Surge detailed runtime contract valid');
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
