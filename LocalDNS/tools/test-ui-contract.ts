import { Script } from 'scripting';
import { LocalDnsServer } from '../src/server';
import { Store } from '../src/store';

/**
 * 新版上游 SPA（FJGLI / UI 2026.10.22.3）契约校验。
 * 重点覆盖 UI normalizeResponse 对 GET 响应的严格类型校验，
 * 以及 upstream/config 的 group 字段兼容与 /api/v1/features 的 legacy 探测。
 */
async function main() {
  console.log('=== [LocalDNS] UI Contract Verification (FJGLI / UI 2026.10.22.3) ===');
  let passed = 0;
  let failed = 0;
  const assert = (cond: boolean, desc: string) => {
    if (cond) {
      console.log(`  ✅ PASS: ${desc}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${desc}`);
      failed++;
    }
  };

  const store = Store.get();
  const originalUpstreams = JSON.parse(JSON.stringify(store.getUpstreamConfig()));
  const server = LocalDnsServer.get();
  const startRes = server.start(9299);
  assert(startRes.success === true, `HTTP Server started on port ${startRes.port}`);
  const base = `http://127.0.0.1:${startRes.port}`;

  try {
    // 打包资源静态托管
    const appJs = await fetch(`${base}/ui/assets/app-DOuhu87M.js`);
    assert(appJs.status === 200, `/ui/assets/app-DOuhu87M.js returns 200 (got ${appJs.status})`);
    assert((appJs.headers.get('Content-Type') || '').includes('javascript'), 'app bundle Content-Type is javascript');
    const pulse = await fetch(`${base}/ui/assets/livepulse.js`);
    assert(pulse.status === 200, `/ui/assets/livepulse.js returns 200 (got ${pulse.status})`);

    // UI 核心族探测：必须 404 才会进入 legacy 兼容模式
    const features = await fetch(`${base}/api/v1/features`);
    assert(features.status === 404, `/api/v1/features returns 404 (got ${features.status})`);

    // upstream/tags 必须是字符串数组
    const tagsRes = await fetch(`${base}/api/v1/upstream/tags`);
    const tags = await tagsRes.json();
    assert(Array.isArray(tags) && tags.every((x: any) => typeof x === 'string'), 'upstream/tags is string array');

    // upstream/ecs 必须是对象，ecs 为字符串
    const ecs = await (await fetch(`${base}/api/v1/upstream/ecs`)).json();
    assert(ecs && typeof ecs === 'object' && !Array.isArray(ecs) && (ecs.ecs === undefined || typeof ecs.ecs === 'string'), 'upstream/ecs shape valid');

    // upstream/config 必须是 {group: [node...]}，节点字段类型符合 UI 校验
    const validateUpstreamConfig = (data: any) => {
      if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
      for (const group of Object.values(data)) {
        if (!Array.isArray(group)) return false;
        for (const item of group as any[]) {
          if (!item || typeof item !== 'object') return false;
          for (const key of ['tag', 'addr', 'server_addr', 'protocol', 'dial_addr', 'socks5']) {
            if (item[key] !== undefined && typeof item[key] !== 'string') return false;
          }
          if (item.enabled !== undefined && typeof item.enabled !== 'boolean') return false;
        }
      }
      return true;
    };
    const cfg = await (await fetch(`${base}/api/v1/upstream/config`)).json();
    assert(validateUpstreamConfig(cfg), 'upstream/config passes UI normalizeResponse validation');

    // group 字段兼容（FJGLI 新字段）
    const nodeG = { tag: 'contract_group_node', protocol: 'https', addr: 'https://1.1.1.1/dns-query', enabled: true };
    const postGroup = await fetch(`${base}/api/v1/upstream/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ group: 'domestic', upstreams: [nodeG] }),
    });
    assert(postGroup.status === 200, `POST upstream/config with group returns 200 (got ${postGroup.status})`);
    const afterGroup = await (await fetch(`${base}/api/v1/upstream/config`)).json();
    assert((afterGroup.domestic || []).some((n: any) => n.tag === 'contract_group_node'), 'group field accepted and persisted');

    // plugin_tag 旧字段仍兼容
    const nodeP = { tag: 'contract_plugin_tag_node', protocol: 'https', addr: 'https://223.5.5.5/dns-query', enabled: true };
    const postPlugin = await fetch(`${base}/api/v1/upstream/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plugin_tag: 'foreign', upstreams: [nodeP] }),
    });
    assert(postPlugin.status === 200, `POST upstream/config with plugin_tag returns 200 (got ${postPlugin.status})`);
    const afterPlugin = await (await fetch(`${base}/api/v1/upstream/config`)).json();
    assert((afterPlugin.foreign || []).some((n: any) => n.tag === 'contract_plugin_tag_node'), 'plugin_tag field still accepted');

    // v2 audit stats 数值字段
    const stats = await (await fetch(`${base}/api/v2/audit/stats`)).json();
    assert(stats && typeof stats === 'object', 'v2 audit stats is object');
    for (const key of ['total_queries', 'average_duration_ms', 'client_count', 'domain_count']) {
      assert(stats[key] === undefined || Number.isFinite(stats[key]), `stats.${key} numeric or absent`);
    }

    // audit status / capacity
    const aStatus = await (await fetch(`${base}/api/v1/audit/status`)).json();
    assert(aStatus && typeof aStatus === 'object' && typeof aStatus.capturing === 'boolean', 'audit/status has boolean capturing');
    const aCap = await (await fetch(`${base}/api/v1/audit/capacity`)).json();
    assert(aCap && typeof aCap === 'object' && Number.isFinite(aCap.capacity), 'audit/capacity has numeric capacity');

    // client_name 必须为 {ip: alias}
    const aliases = await (await fetch(`${base}/plugins/client_name`)).json();
    assert(aliases && typeof aliases === 'object' && !Array.isArray(aliases) && Object.values(aliases).every((v: any) => typeof v === 'string'), 'plugins/client_name maps ip->string');

    // switch show 返回 A/B 文本
    const sw = await (await fetch(`${base}/plugins/switch7/show`)).text();
    assert(sw === 'A' || sw === 'B', `switch7/show returns A/B (got ${JSON.stringify(sw)})`);
  } catch (e: any) {
    console.error('  💥 ERROR:', e?.message || e);
    failed++;
  } finally {
    // 还原用户上游配置，避免测试污染
    try { store.setUpstreamConfig(originalUpstreams); } catch {}
    try { server.stop(); } catch {}
  }

  console.log(`\nUI Contract Result: Total ${passed + failed}, Passed: ${passed}, Failed: ${failed}`);
  Script.exit(failed === 0 ? 0 : 1);
}

main();
