/**
 * tools/test-diversion-management.ts
 * 验证分流治理规则数量可见性、单条规则 CRUD、分页搜索、分组设置与全生命周期
 */

import { Script } from 'scripting';
import { LocalDnsServer } from '../src/server';

async function run() {
  console.log('=== [LocalDNS] Diversion Management & Rule Visibility Verification ===');

  const server = LocalDnsServer.get();
  const startRes = server.start(9399);
  if (!startRes.success) {
    throw new Error('Failed to start server: ' + startRes.error);
  }
  console.log(`  ✅ LocalDNS Server started on port ${startRes.port}`);

  const origin = `http://127.0.0.1:${startRes.port}`;

  try {
    // 1. 验证 groups 接口返回 rule_count
    const gRes = await fetch(`${origin}/api/v1/surge/diversion/groups`);
    const gData = await gRes.json();
    if (!gData.success || !Array.isArray(gData.groups)) {
      throw new Error('groups 接口返回格式不符合契约');
    }
    const hasCount = gData.groups.every((g: any) => typeof g.rule_count === 'number');
    if (!hasCount) {
      throw new Error('分流组卡片未包含 rule_count 规则数量字段');
    }
    console.log(`  ✅ PASS: /api/v1/surge/diversion/groups 返回 ${gData.groups.length} 个分组，全部包含 rule_count 数量统计`);

    // 2. 验证分页与总数检索
    const pagedRes = await fetch(`${origin}/api/v1/surge/diversion/rules?paged=1&limit=5&offset=0`);
    const pagedData = await pagedRes.json();
    if (!pagedData.success || typeof pagedData.total !== 'number' || !Array.isArray(pagedData.rules)) {
      throw new Error('rules 分页接口返回格式不符合契约');
    }
    console.log(`  ✅ PASS: /api/v1/surge/diversion/rules?paged=1 检索成功，总计 ${pagedData.total} 条规则，分页切片 ${pagedData.rules.length} 条`);

    // 3. 验证单条规则添加
    const testPattern = `test-crud-${Date.now()}.local`;
    const addRes = await fetch(`${origin}/api/v1/surge/diversion/rules`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        group_id: 'direct',
        match_type: 'DOMAIN-SUFFIX',
        pattern: testPattern,
        comment: '自动化回归单条规则',
        enabled: true,
      }),
    });
    const addData = await addRes.json();
    if (!addData.success || !addData.id) {
      throw new Error(`单条规则新增失败: ${JSON.stringify(addData)}`);
    }
    const createdId = addData.id;
    console.log(`  ✅ PASS: 单条规则新增成功 (ID: ${createdId}, Pattern: ${testPattern})`);

    // 4. 验证关键词搜索能准确命中刚添加的单条规则
    const searchRes = await fetch(`${origin}/api/v1/surge/diversion/rules?paged=1&search=${encodeURIComponent(testPattern)}`);
    const searchRaw = await searchRes.text();
    let searchData: any;
    try {
      searchData = JSON.parse(searchRaw);
    } catch (e) {
      console.error('searchRes body text was:', searchRaw);
      throw new Error('searchRes JSON parse error: ' + searchRaw);
    }
    if (searchData.total < 1 || !searchData.rules.some((r: any) => r.id === createdId)) {
      throw new Error('关键词搜索未能检索到刚插入的单条规则');
    }
    console.log(`  ✅ PASS: 关键词搜索精确命中目标规则 (total: ${searchData.total})`);

    // 5. 验证单条规则修改 (Edit)
    const updatedComment = '自动化回归修改后备注';
    const editRes = await fetch(`${origin}/api/v1/surge/diversion/rules`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: createdId,
        group_id: 'direct',
        match_type: 'DOMAIN',
        pattern: testPattern,
        comment: updatedComment,
        enabled: true,
      }),
    });
    const editData = await editRes.json();
    if (!editData.success) {
      throw new Error(`单条规则修改失败: ${JSON.stringify(editData)}`);
    }
    console.log(`  ✅ PASS: 单条规则修改成功 (Match Type 变更为 DOMAIN)`);

    // 6. 验证单条规则启禁切换 (Toggle)
    const toggleRes = await fetch(`${origin}/api/v1/surge/diversion/rules/${createdId}/toggle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    });
    const toggleData = await toggleRes.json();
    if (!toggleData.success || toggleData.enabled !== false) {
      throw new Error(`单条规则禁用切换失败: ${JSON.stringify(toggleData)}`);
    }
    console.log(`  ✅ PASS: 单条规则快速启闭切换成功 (enabled: false)`);

    // 7. 验证单条规则删除 (Delete)
    const delRes = await fetch(`${origin}/api/v1/surge/diversion/rules/${createdId}`, {
      method: 'DELETE',
    });
    const delData = await delRes.json();
    if (!delData.success || !delData.deleted) {
      throw new Error(`单条规则删除失败: ${JSON.stringify(delData)}`);
    }
    console.log(`  ✅ PASS: 单条规则彻底删除成功 (ID: ${createdId})`);

    // 8. 验证新建自定义分流组与删除自定义分流组
    const customGroupId = `temp_group_${Date.now()}`;
    const createGroupRes = await fetch(`${origin}/api/v1/surge/diversion/groups`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: customGroupId,
        name: '自动化测试临时分流组',
        surge_policy: 'PROXY',
        priority: 88,
        description: '回归测试用组',
      }),
    });
    const createGroupData = await createGroupRes.json();
    if (!createGroupData.success) {
      throw new Error(`新建自定义分流组失败: ${JSON.stringify(createGroupData)}`);
    }
    console.log(`  ✅ PASS: 新建自定义分流组成功 (${customGroupId})`);

    const delGroupRes = await fetch(`${origin}/api/v1/surge/diversion/groups/${customGroupId}`, {
      method: 'DELETE',
    });
    const delGroupData = await delGroupRes.json();
    if (!delGroupData.success || !delGroupData.deleted) {
      throw new Error(`删除自定义分流组失败: ${JSON.stringify(delGroupData)}`);
    }
    console.log(`  ✅ PASS: 删除自定义分流组成功 (${customGroupId})`);

    console.log('\n========================================');
    console.log('🎉 所有分流治理与规则明细管理验证全部 PASS！');
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
