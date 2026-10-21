// Per-client rules — port of SmartDNS client-rules (match by client IP/CIDR -> group / no-cache / no-rule)
import { Store } from './store';
import type { UpstreamGroup } from './types';

interface ClientRule {
  net: number;
  mask: number;
  group?: UpstreamGroup;
  noCache: boolean;
  noRule: boolean;
}

export interface ClientMatch {
  group?: UpstreamGroup;
  noCache: boolean;
  noRule: boolean;
}

const VALID_GROUPS: UpstreamGroup[] = ['domestic', 'foreign', 'foreign_ecs', 'proxy'];

function ipv4ToInt(ip: string): number | null {
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const nums = m.slice(1).map(Number);
  if (nums.some(n => n > 255)) return null;
  return (((nums[0] << 24) >>> 0) + (nums[1] << 16) + (nums[2] << 8) + nums[3]) >>> 0;
}

export class ClientRulesEngine {
  private static instance: ClientRulesEngine;
  private rules: ClientRule[] = [];

  static get(): ClientRulesEngine {
    if (!ClientRulesEngine.instance) ClientRulesEngine.instance = new ClientRulesEngine();
    return ClientRulesEngine.instance;
  }

  reload(): void {
    this.rules = [];
    const text = Store.get().getRule('client_rules');
    for (let line of (text || '').split('\n')) {
      line = line.trim();
      if (!line || line.startsWith('#')) continue;
      const parts = line.split(/\s+/);
      if (parts.length < 2) continue;

      const [base, bitsStr] = parts[0].split('/');
      const baseInt = ipv4ToInt(base);
      if (baseInt === null) continue;
      const bits = bitsStr === undefined ? 32 : Number(bitsStr);
      if (!Number.isFinite(bits) || bits < 0 || bits > 32) continue;
      const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;

      const groupTok = parts[1].toLowerCase();
      const group = VALID_GROUPS.includes(groupTok as UpstreamGroup) ? (groupTok as UpstreamGroup) : undefined;
      const noCache = parts.slice(2).some(p => p.toLowerCase() === 'no-cache');
      const noRule = parts.slice(2).some(p => p.toLowerCase() === 'no-rule');

      this.rules.push({ net: (baseInt & mask) >>> 0, mask, group, noCache, noRule });
    }
  }

  resolve(clientIp: string): ClientMatch | null {
    const v = ipv4ToInt(clientIp);
    if (v === null) return null;
    for (const r of this.rules) {
      if (((v & r.mask) >>> 0) === r.net) {
        return { group: r.group, noCache: r.noCache, noRule: r.noRule };
      }
    }
    return null;
  }
}
