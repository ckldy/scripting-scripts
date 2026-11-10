import { Script } from 'scripting';
import { SurgeDatabase, DnsRule, HttpRule } from '../src/surge-db';

async function main() {
  const db = SurgeDatabase.get();
  await db.init();
  await db.setOptimizationFlag('opt.db_tx', String(Script.queryParameters?.dbTx ?? '1'));

  const id = 'opt_test_' + Date.now();
  const now = Date.now();
  await db.saveModule({
    id,
    name: 'opt tx test',
    category: 'system',
    source_url: null,
    enabled: true,
    raw_content: '#!name=opt tx test\n[Rule]\nDOMAIN,opt-test.example,REJECT',
    created_at: now,
    updated_at: now,
  });

  const dns: DnsRule[] = [
    { module_id: id, type: 'DOMAIN', pattern: 'opt-test.example', action: 'REJECT', enabled: true },
    { module_id: id, type: 'DOMAIN-SUFFIX', pattern: 'opt-suffix.example', action: 'REJECT', enabled: true },
  ];
  const http: HttpRule[] = [
    {
      module_id: id,
      rule_type: 'rule',
      sub_type: '',
      pattern: 'DOMAIN,opt-test.example,REJECT',
      target: '',
      requires_body: false,
      max_size: 0,
      binary_body: false,
      enabled: true,
    },
  ];

  await db.saveModuleRules(id, dns, ['opt-test.example'], http, []);

  const activeDns = (await db.getActiveDnsBlockRules()).filter((r) => r.module_id === id);
  const activeHttp = (await db.getActiveHttpRules()).filter((r) => r.module_id === id);
  const activeMitm = (await db.getActiveMitmHosts()).filter((h) => h === 'opt-test.example');

  const ok = activeDns.length === 2 && activeHttp.length === 1 && activeMitm.length === 1;
  await db.deleteModule(id);
  const leftDns = (await db.getActiveDnsBlockRules()).filter((r) => r.module_id === id);
  const leftHttp = (await db.getActiveHttpRules()).filter((r) => r.module_id === id);
  const okCleanup = leftDns.length === 0 && leftHttp.length === 0;

  const result = {
    ok,
    okCleanup,
    activeDns: activeDns.length,
    activeHttp: activeHttp.length,
    activeMitm: activeMitm.length,
    leftDns: leftDns.length,
    leftHttp: leftHttp.length,
  };
  console.log(JSON.stringify(result));
  Script.exit(result);
}

main().catch((e) => {
  console.error(e);
  Script.exit({ ok: false, error: String(e?.message || e) });
});
