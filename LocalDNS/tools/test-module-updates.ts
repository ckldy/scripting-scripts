/**
 * tools/test-module-updates.ts
 *
 * 模块上游更新检测端到端验证（真实抓取 limbopro 上游）
 * 覆盖：抓取→哈希对比→写回标记→刷新落库→名称同步→复查无更新
 * 运行：scripting-ts run _verify_modules.ts（项目根 shim）
 */

import { Script } from 'scripting';
import { SurgeDatabase } from '../src/surge-db';
import { SurgeService } from '../src/surge-service';

const LIMBO = 'mod_adblock4limbo_sgmodule_mvwbtxjm';

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

  const db = SurgeDatabase.get();
  await db.init();
  const service = SurgeService.get();
  const dbAny = (db as any).getDb();
  const countRules = async (): Promise<number> => {
    const row = await dbAny.fetchOne('SELECT COUNT(*) AS n FROM module_http_rules WHERE module_id = ?', [LIMBO]);
    return Number((row && (row as any).n) || 0);
  };

  console.log('— 0. 基线 —');
  const before = await db.getModule(LIMBO);
  check('毒奶模块存在', Boolean(before), before && before.name);
  if (!before) {
    console.log('RESULT ' + JSON.stringify({ pass, fail: fail + 1 }));
    Script.exit(1);
    return;
  }
  const rulesBefore = await countRules();
  check('七层规则非空', rulesBefore > 0, { rules: rulesBefore });

  console.log('— 1. 首次巡检（真实上游） —');
  const r1 = await service.checkModuleUpdates([LIMBO]);
  const item1 = r1.items[0] || ({} as any);
  check('巡检覆盖 1 个模块', r1.checked === 1, { checked: r1.checked, failed: r1.failed });
  check('抓到上游名称含 11月25日', /2026年11月25日更新/.test(item1.remote_name || ''), item1.remote_name);
  const afterCheck = await db.getModule(LIMBO);
  check('已写入内容哈希', Boolean(afterCheck?.content_hash), { content_hash: afterCheck?.content_hash });

  console.log('— 2. 人为置为旧版本 → 应判定有更新 —');
  await dbAny.execute("UPDATE app_modules SET content_hash = 'stale-hash-for-test' WHERE id = ?", [LIMBO]);
  const r2 = await service.checkModuleUpdates([LIMBO]);
  const item2 = r2.items[0] || ({} as any);
  check('判定为有更新', item2.has_update === true, item2);
  check('计数为 1', r2.updates === 1, { updates: r2.updates });
  const staleMod = await db.getModule(LIMBO);
  check('DB update_available = true', staleMod?.update_available === true, {
    content_hash: staleMod?.content_hash,
    remote_hash: staleMod?.remote_hash,
  });
  check('update_available 可通过列表接口透出', (await db.getModules()).some((m) => m.id === LIMBO && m.update_available === true), true);

  console.log('— 3. 刷新应落库并同步上游名称 —');
  const r3 = await service.refreshModule(LIMBO);
  check('刷新成功', r3.updated === true, { error: r3.error });
  check('内容确有变更', r3.changed === true, { changed: r3.changed });
  check('名称已同步 11月25日', /2026年11月25日更新/.test(r3.name || ''), r3.name);
  const rulesAfter = await countRules();
  check('刷新后七层规则未被级联清空', rulesAfter === rulesBefore, { before: rulesBefore, after: rulesAfter });
  const afterRefresh = await db.getModule(LIMBO);
  check('DB 名称已更新', /2026年11月25日更新/.test(afterRefresh?.name || ''), afterRefresh?.name);
  check('本地哈希 == 上游哈希', Boolean(afterRefresh?.content_hash) && afterRefresh?.content_hash === afterRefresh?.remote_hash, {
    content_hash: afterRefresh?.content_hash,
    remote_hash: afterRefresh?.remote_hash,
  });
  check('更新标记已清除', afterRefresh?.update_available === false, { update_available: afterRefresh?.update_available });

  console.log('— 4. 复查应为无更新 —');
  const r4 = await service.checkModuleUpdates([LIMBO]);
  const item4 = r4.items[0] || ({} as any);
  check('复查判定无更新', item4.has_update === false, item4);
  check('复查计数为 0', r4.updates === 0, { updates: r4.updates });

  console.log('— 5. 全量巡检（并发 3，覆盖所有远程模块） —');
  const all = await service.checkModuleUpdates();
  check('全量巡检无致命失败', all.failed === 0, { checked: all.checked, failed: all.failed, updates: all.updates });
  for (const it of all.items) {
    console.log('    · ' + (it.has_update ? '有更新 ' : '已最新 ') + it.name + ' → ' + (it.remote_name || '?') + (it.error ? ' [' + it.error + ']' : ''));
  }

  console.log('RESULT ' + JSON.stringify({ pass, fail }));
  Script.exit(fail > 0 ? 1 : 0);
}

void main();
