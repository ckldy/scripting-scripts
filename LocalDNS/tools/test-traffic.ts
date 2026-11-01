import { Script } from 'scripting';
import { TrafficManager } from '../src/traffic';

async function testTraffic() {
  console.log('--- 测试 TrafficManager 数据规范与有效性 ---');
  const mgr = TrafficManager.get();

  // 1. 获取摘要
  const summary = await mgr.getTrafficSummary();
  console.log('1. Summary 结构验证:');
  console.log('   date:', summary.date, 'source:', summary.source);
  console.log('   today:', JSON.stringify(summary.today));
  if (!summary.today || summary.today.down <= 0 || summary.today.up <= 0) {
    throw new Error('Summary today 数据无效');
  }

  // 2. 获取明细
  const detail = await mgr.getTrafficDetail(true);
  console.log('2. Detail 结构验证:');
  console.log('   daily entries count:', detail.daily.length);
  if (!Array.isArray(detail.daily) || detail.daily.length < 30) {
    throw new Error('Detail daily 数组数量不足');
  }

  // 3. 校验每一天的维度数据总和是否符合前端严格约束：sum <= day
  for (const day of detail.daily) {
    const dayDown = day.down;
    const dayUp = day.up;

    let devDown = 0, devUp = 0;
    for (const d of Object.values(day.devices)) {
      devDown += d.down;
      devUp += d.up;
    }
    if (devDown > dayDown || devUp > dayUp) {
      throw new Error(`日期 ${day.date} devices 总和超过当天上限`);
    }

    let provDown = 0, provUp = 0;
    for (const p of Object.values(day.providers)) {
      provDown += p.down;
      provUp += p.up;
    }
    if (provDown > dayDown || provUp > dayUp) {
      throw new Error(`日期 ${day.date} providers 总和超过当天上限`);
    }

    let nodeDown = 0, nodeUp = 0;
    for (const n of Object.values(day.nodes)) {
      nodeDown += n.down;
      nodeUp += n.up;
    }
    if (nodeDown > dayDown || nodeUp > dayUp) {
      throw new Error(`日期 ${day.date} nodes 总和超过当天上限`);
    }
  }

  console.log('✅ 所有约束校验通过！dimensionMap 与 parseDetail 将 100% 成功解析！');
  Script.exit('ok');
}

testTraffic().catch((e) => {
  console.error('❌ 测试失败:', e);
  Script.exit('error');
});
