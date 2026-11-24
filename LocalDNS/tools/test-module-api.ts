/**
 * tools/test-module-api.ts
 *
 * 直接调用 API 路由处理器，验证新增端点能被正确分派（不需要重启 HTTP 服务）
 * 说明：HttpResponse 是原生对象，JS 侧只能读到 statusCode，正文无法读取，
 *       因此这里断言「路由命中 + 状态码 + 副作用落库」，响应字段结构由 service 测试覆盖。
 * 运行：scripting-ts run _verify_api.ts（项目根 shim）
 */

import { Script } from 'scripting';
import { handleSurgeApiRequest } from '../src/surge-api';
import { SurgeDatabase } from '../src/surge-db';

const LIMBO = 'mod_adblock4limbo_sgmodule_mvwbtxjm';

function fakeReq(bodyText: string): any {
  return {
    method: 'GET',
    path: '',
    queryParams: [],
    headers: {},
    body: Data.fromRawString(bodyText, 'utf-8'),
  };
}

async function call(path: string, method = 'GET', bodyText = '{}'): Promise<{ handled: boolean; status: number }> {
  const res: any = await handleSurgeApiRequest(fakeReq(bodyText), path, method);
  return { handled: Boolean(res), status: Number(res?.statusCode || 0) };
}

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

  console.log('— 1. 新端点能被分派 —');
  const list = await call('/api/v1/surge/modules');
  check('GET /modules → 200', list.handled && list.status === 200, list);

  const ups = await call('/api/v1/surge/modules/updates');
  check('GET /modules/updates → 200（不被 :id 抢路由）', ups.handled && ups.status === 200, ups);

  const before = Number((await db.getModule(LIMBO))?.remote_checked_at || 0);
  const chk = await call('/api/v1/surge/modules/check-updates', 'POST', JSON.stringify({ ids: [LIMBO] }));
  check('POST /check-updates → 200', chk.handled && chk.status === 200, chk);
  const afterMod = await db.getModule(LIMBO);
  check('巡检确实落库（remote_checked_at 增大）', Number(afterMod?.remote_checked_at || 0) > before, {
    before,
    after: afterMod?.remote_checked_at,
  });

  console.log('— 2. 旧路由未受影响 —');
  const single = await call('/api/v1/surge/modules/' + encodeURIComponent(LIMBO));
  check('GET /modules/:id → 200', single.handled && single.status === 200, single);
  const missing = await call('/api/v1/surge/modules/not_exist_id');
  check('不存在模块 → 404', missing.handled && missing.status === 404, missing);
  const refreshMissing = await call('/api/v1/surge/modules/not_exist_id/refresh', 'POST');
  check('刷新不存在模块 → 400', refreshMissing.handled && refreshMissing.status === 400, refreshMissing);

  console.log('— 3. 本机来源不参与巡检 —');
  const local = await call('/api/v1/surge/modules/check-updates', 'POST', JSON.stringify({ ids: ['mod_adhunter'] }));
  check('本机模块巡检返回 200（内部跳过而非失败）', local.handled && local.status === 200, local);

  console.log('RESULT ' + JSON.stringify({ pass, fail }));
  Script.exit(fail > 0 ? 1 : 0);
}

void main();
