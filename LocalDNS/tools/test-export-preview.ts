import { Script } from 'scripting';
import { ModuleManager } from '../src/modules/module-manager';

const surgeText = ModuleManager.get().exportAsSurgeModule();
console.log('=== SURGE MODULE PREVIEW ===');
console.log(surgeText);

const loonText = ModuleManager.get().exportAsLoonPlugin();
console.log('=== LOON PLUGIN PREVIEW ===');
console.log(loonText);

Script.exit({ ok: true, surgeLength: surgeText.length, loonLength: loonText.length });
