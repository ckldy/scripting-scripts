import { Script } from 'scripting';
import { AdGuardEngine } from './src/adguard';
import { Store } from './src/store';
import { DiversionEngine } from './src/diversion';

async function diagAdGuard() {
  console.log('=== Checking AdGuard Engine & Rules Status ===');
  
  const ruleCount = AdGuardEngine.get().getRuleCount();
  console.log('AdGuard Rule Count in Memory:', ruleCount);

  const sources = Store.get().getAdguardSources();
  console.log(`AdGuard Sources configured: ${sources.length}`);
  sources.forEach(s => {
    const raw = Store.get().getRule(`adguard_source_${s.id}`);
    console.log(`  - Source [${s.name}]: enabled=${s.enabled}, count=${s.rule_count}, stored_bytes=${raw ? raw.length : 0}`);
  });

  const switches = Store.get().getSwitches();
  console.log('Switch7 (广告屏蔽开关):', switches.switch7);

  // Test some common ad domains
  const testAdDomains = [
    'adservice.google.com',
    'pagead2.googlesyndication.com',
    'ads.tiktok.com',
    'e.kuaishou.com',
    'adashx.m.taobao.com',
    'tracking.example.com'
  ];

  console.log('\nTesting ad domains blocking:');
  testAdDomains.forEach(d => {
    const isBlk = AdGuardEngine.get().isBlocked(d);
    const div = DiversionEngine.get().match(d, '127.0.0.1');
    console.log(`  ${d} -> isBlocked: ${isBlk}, diversion: ${div.group} (${div.domainSet})`);
  });

  Script.exit();
}

diagAdGuard();
