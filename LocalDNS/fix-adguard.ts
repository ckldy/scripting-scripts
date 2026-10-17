import { Script } from 'scripting';
import { Store } from './src/store';
import { AdGuardEngine } from './src/adguard';
import { DiversionEngine } from './src/diversion';

async function fixAndVerifyAdguard() {
  console.log('=== Activating AdGuard Rules & Switch7 ===');
  const store = Store.get();

  // 1. Ensure source is enabled
  const sources = store.getAdguardSources();
  sources.forEach(s => {
    if (s.id === 'adguard_dns' || s.rule_count > 0) {
      s.enabled = true;
    }
  });
  store.setAdguardSources(sources);

  // 2. Ensure switch7 is 'A'
  store.setSwitch('switch7', 'A');

  // 3. Rebuild AdGuard engine
  AdGuardEngine.get().rebuildFromStore();
  const ruleCount = AdGuardEngine.get().getRuleCount();
  console.log('New AdGuard Rule Count in Memory:', ruleCount);

  // 4. Test ad domain matching
  const testAdDomains = [
    'adservice.google.com',
    'pagead2.googlesyndication.com',
    'ads.tiktok.com',
    'e.kuaishou.com',
    'adashx.m.taobao.com',
    'tracking.example.com',
    'mobads.baidu.com',
    'pgdt.gtimg.cn'
  ];

  let blockedCount = 0;
  testAdDomains.forEach(d => {
    const isBlk = AdGuardEngine.get().isBlocked(d);
    const div = DiversionEngine.get().match(d, '127.0.0.1');
    const ok = isBlk || div.group === 'blocked';
    if (ok) blockedCount++;
    console.log(`  ${d} -> isBlocked: ${isBlk}, diversion: ${div.group} (${div.domainSet}) [${ok ? 'BLOCKED' : 'PASS'}]`);
  });

  console.log(`\nResult: ${blockedCount} / ${testAdDomains.length} ad domains BLOCKED!`);
  Script.exit();
}

fixAndVerifyAdguard();
