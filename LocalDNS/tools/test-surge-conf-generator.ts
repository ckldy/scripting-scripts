/**
 * tools/test-surge-conf-generator.ts
 * 验证按照 Surge 格式自动生成配置文件的各项契约与标准
 */

import { Script } from 'scripting';
import { LocalDnsServer } from '../src/server';

async function run() {
  console.log('=== [LocalDNS] Surge Configuration (.conf) Auto-Generator Verification ===');

  const server = LocalDnsServer.get();
  const startRes = server.start(9499);
  if (!startRes.success) {
    throw new Error('Failed to start server: ' + startRes.error);
  }
  console.log(`  ✅ LocalDNS Server started on port ${startRes.port}`);

  const origin = `http://127.0.0.1:${startRes.port}`;

  try {
    // 1. 验证 GET /surge/localdns.conf 返回完整且符合 Surge 标准规范的配置文件
    const res = await fetch(`${origin}/surge/localdns.conf`);
    if (res.status !== 200) {
      throw new Error(`GET /surge/localdns.conf 返回状态异常: ${res.status}`);
    }
    const confText = await res.text();
    console.log(`  ✅ PASS: GET /surge/localdns.conf 成功返回 (长度: ${confText.length} 字符)`);

    // 校验关键 Surge 段落
    const requiredSections = ['[General]', '[Replica]', '[Proxy]', '[Proxy Group]', '[Rule]', '[Host]'];
    for (const sec of requiredSections) {
      if (!confText.includes(sec)) {
        throw new Error(`生成的 Surge 配置缺少标准段落: ${sec}`);
      }
    }
    console.log('  ✅ PASS: 配置文件包含 Surge 全部标准核心段落 ([General], [Replica], [Proxy], [Proxy Group], [Rule], [Host])');

    // 校验核心配置项
    if (!confText.includes('dns-server = 127.0.0.1') || !confText.includes('http-api = ')) {
      throw new Error('缺少 LocalDNS 专属 DNS 或 http-api 控制配置');
    }
    if (!confText.includes('RULE-SET,http://') || !confText.includes('/rules/direct.list,DIRECT')) {
      throw new Error('缺少动态分流 RULE-SET 订阅挂载');
    }
    if (!confText.includes('FINAL,PROXY,dns-failed')) {
      throw new Error('缺少 FINAL 兜底规则');
    }
    console.log('  ✅ PASS: 核心段落配置项（LocalDNS 本地 DNS、http-api 密钥、RULE-SET 订阅挂载、FINAL 兜底）校验完全符合规范');

    // 2. 验证下载模式带有 Content-Disposition 附件头
    const dlRes = await fetch(`${origin}/surge/localdns.conf?download=1`);
    const disp = dlRes.headers.get('Content-Disposition') || '';
    if (!disp.includes('attachment') || !disp.includes('LocalDNS.conf')) {
      throw new Error(`下载头异常: ${disp}`);
    }
    console.log(`  ✅ PASS: ?download=1 包含正确的 Content-Disposition 附件下载响应头: ${disp}`);

    // 3. 验证静态内联展开模式 mode=inline
    const inlineRes = await fetch(`${origin}/surge/localdns.conf?mode=inline`);
    const inlineText = await inlineRes.text();
    if (!inlineText.includes('# LocalDNS 全量规则内联展开模式')) {
      throw new Error('内联模式生成异常');
    }
    console.log('  ✅ PASS: mode=inline 成功将分流数据库细则逐行内联展开到 [Rule] 中');

    // 4. 验证 POST /api/v1/surge/generate-conf 定制端点
    const customKey = 'my_secret_key_123';
    const customHost = '192.168.1.88:9053';
    const genRes = await fetch(`${origin}/api/v1/surge/generate-conf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: customHost,
        mode: 'ruleset',
        api_key: customKey,
      }),
    });
    const genData = await genRes.json();
    if (!genData.success || !genData.conf || !genData.downloadUrl || !genData.installUrl) {
      throw new Error(`定制生成端点返回异常: ${JSON.stringify(genData)}`);
    }
    if (!genData.conf.includes(`http-api = ${customKey}@0.0.0.0:6171`)) {
      throw new Error('定制 API Key 未正确生效到配置文件中');
    }
    if (!genData.conf.includes(`http://${customHost}/rules/direct.list`)) {
      throw new Error('定制 Host 未正确生效到 RULE-SET 订阅链接中');
    }
    if (!genData.installUrl.startsWith('surge:///install-config?url=')) {
      throw new Error('一键调起安装 scheme 链接格式异常');
    }
    console.log(`  ✅ PASS: POST /api/v1/surge/generate-conf 定制生成成功，包含一键调起 scheme: ${genData.installUrl}`);

    console.log('\n========================================');
    console.log('🎉 Surge 配置文件自动生成与一键导入验证全部 PASS！');
    console.log('========================================');
  } finally {
    server.stop();
    console.log('  ✅ LocalDNS Server stopped');
  }

  return { ok: true };
}

run()
  .then((res) => Script.exit(res))
  .catch((e) => {
    console.error('Test execution failed:', e);
    Script.exit({ ok: false, error: e?.message });
  });
