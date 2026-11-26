/**
 * tools/test-fallback.ts
 *
 * 上游回落与节点熔断测试（对照 smartdns 的 fallback 组 + prohibit 机制）
 * 运行：scripting-ts run _verify_fallback.ts（项目根 shim）
 */

import { Script } from 'scripting';
import { Store } from '../src/store';
import { DnsResolver } from '../src/resolver';
import { CacheManager } from '../src/cache';

async function main(): Promise<void> {
  let pass = 0;
  let fail = 0;
  const check = (name: string, ok: boolean, detail?: any) => {
    if (ok) {
      pass++;
      console.log('  ✓ ' + name + (detail !== undefined ? '  ' + JSON.stringify(detail) : ''));
    } else {
      fail++;
      console.log('  ✗ ' + name + (detail !== undefined ? '  ' + JSON.stringify(detail) : ''));
    }
  };

  const store = Store.get();
  const resolver: any = DnsResolver.get();
  const original = { ...store.getFallbackConfig() };

  console.log('— 1. 配置默认值与边界 —');
  check('默认策略 safe', original.policy === 'safe', original);
  const clamped = store.setFallbackConfig({ policy: 'bad' as any, nodeCooldownSec: 9999, domesticTtlCap: -5 });
  check('非法 policy 归一为 safe', clamped.policy === 'safe', clamped.policy);
  check('cooldown 上限 600', clamped.nodeCooldownSec === 600, clamped.nodeCooldownSec);
  check('ttlCap 下限 0', clamped.domesticTtlCap === 0, clamped.domesticTtlCap);

  console.log('— 2. 节点熔断 —');
  resolver.nodeHealth.clear();
  resolver.markNodeResult('t1', false);
  check('失败 1 次不熔断', resolver.isNodeCooling('t1') === false);
  resolver.markNodeResult('t1', false);
  check('连续 2 次触发冷却', resolver.isNodeCooling('t1') === true);
  resolver.markNodeResult('t1', true);
  check('成功后立即解除', resolver.isNodeCooling('t1') === false);

  console.log('— 3. 竞速候选过滤 —');
  const nodes = [{ tag: 'a' }, { tag: 'b' }];
  resolver.nodeHealth.clear();
  resolver.markNodeResult('a', false);
  resolver.markNodeResult('a', false);
  const picked = resolver.pickRacingNodes(nodes).map((n: any) => n.tag);
  check('冷却节点被剔除', picked.length === 1 && picked[0] === 'b', picked);
  resolver.markNodeResult('b', false);
  resolver.markNodeResult('b', false);
  check('全部冷却时回退全量（不空转）', resolver.pickRacingNodes(nodes).length === 2);

  console.log('— 4. 端到端：foreign 全不可达仍能解析 —');
  const cfg = JSON.parse(JSON.stringify(store.getUpstreamConfig()));
  try {
    const broken = JSON.parse(JSON.stringify(cfg));
    broken.foreign = (broken.foreign || []).map((n: any) => ({ ...n, addr: 'https://127.0.0.1:9/dns-query' }));
    store.setUpstreamConfig(broken);
    store.setFallbackConfig({ policy: 'safe', nodeCooldownSec: 5, domesticTtlCap: 60 });
    resolver.nodeHealth.clear();
    try { CacheManager.get().clearAll(); } catch {}

    const domain = 'www.google.com';
    const t0 = Date.now();
    const r = await resolver.resolveName(domain, 1, '127.0.0.1');
    const ms = Date.now() - t0;
    check('主组全挂仍返回 NOERROR', r.rcode === 'NOERROR' && r.addresses.length > 0, {
      rcode: r.rcode,
      addrs: r.addresses.slice(0, 2),
      ms,
    });
    check('耗时受控（含 2 段超时 < 9s）', ms < 9000, { ms });
  } finally {
    store.setUpstreamConfig(cfg);
    store.setFallbackConfig(original);
    resolver.nodeHealth.clear();
    try { CacheManager.get().clearAll(); } catch {}
  }
  check('配置已恢复', JSON.stringify(store.getUpstreamConfig().foreign) === JSON.stringify(cfg.foreign));

  console.log('RESULT ' + JSON.stringify({ pass, fail }));
  Script.exit(fail > 0 ? 1 : 0);
}

void main();
