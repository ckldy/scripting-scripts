import { Script } from 'scripting';
import { ProcessGuardian } from '../src/guardian';

async function testGuardian() {
  console.log('--- 开始测试 ProcessGuardian 守护中枢 ---');
  const guardian = ProcessGuardian.get();
  
  // 1. 获取初始状态
  const initial = await guardian.getStatus();
  console.log('1. 初始守护状态:', JSON.stringify(initial));
  if (initial.enabled !== true) {
    throw new Error('Guardian enabled 初始状态应为 true');
  }

  // 2. 模拟自愈巡检
  console.log('2. 执行一次 checkAndHeal 巡检...');
  const healed = await guardian.checkAndHeal();
  console.log('   巡检结果 (healed):', healed);

  // 3. 内存整理测试
  console.log('3. 执行内存缓存清理 (防 Jetsam)...');
  guardian.cleanupMemory();

  // 4. 再次获取状态验证
  const updated = await guardian.getStatus();
  console.log('4. 更新后守护状态:', JSON.stringify(updated));

  console.log('✅ ProcessGuardian 进程守护所有测试通过！');
  Script.exit('ok');
}

testGuardian().catch((e) => {
  console.error('❌ 测试失败:', e);
  Script.exit('error');
});
