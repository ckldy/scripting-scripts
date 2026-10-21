// IP result governance — port of SmartDNS blacklist-ip / whitelist-ip / ignore-ip / ip-alias / bogus-nxdomain
import { Store } from './store';
import type { DnsRecord } from './types';

interface Cidr4 { net: number; mask: number; }

function ipv4ToInt(ip: string): number | null {
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const nums = m.slice(1).map(Number);
  if (nums.some(n => n > 255)) return null;
  return (((nums[0] << 24) >>> 0) + (nums[1] << 16) + (nums[2] << 8) + nums[3]) >>> 0;
}

function parseCidr4(token: string): Cidr4 | null {
  const [base, bitsStr] = token.split('/');
  const baseInt = ipv4ToInt(base);
  if (baseInt === null) return null;
  const bits = bitsStr === undefined ? 32 : Number(bitsStr);
  if (!Number.isFinite(bits) || bits < 0 || bits > 32) return null;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return { net: (baseInt & mask) >>> 0, mask };
}

function matchCidr4(ip: string, c: Cidr4): boolean {
  const v = ipv4ToInt(ip);
  if (v === null) return false;
  return ((v & c.mask) >>> 0) === c.net;
}

export interface IpRuleApplyResult {
  records: DnsRecord[];
  bogusHit: boolean;
}

export class IpRulesEngine {
  private static instance: IpRulesEngine;

  private ignore: Cidr4[] = [];
  private blacklist: Cidr4[] = [];
  private whitelist: Cidr4[] = [];
  private bogus: Cidr4[] = [];
  private alias: Array<{ cidr: Cidr4; targets: string[] }> = [];
  private v6Exact = new Map<string, 'ignore' | 'blacklist'>();

  static get(): IpRulesEngine {
    if (!IpRulesEngine.instance) IpRulesEngine.instance = new IpRulesEngine();
    return IpRulesEngine.instance;
  }

  private lines(text: string): string[] {
    const out: string[] = [];
    for (let line of (text || '').split('\n')) {
      line = line.trim();
      if (!line || line.startsWith('#')) continue;
      out.push(line);
    }
    return out;
  }

  reload(): void {
    const store = Store.get();
    this.ignore = [];
    this.blacklist = [];
    this.whitelist = [];
    this.bogus = [];
    this.alias = [];
    this.v6Exact.clear();

    const namedSets = store.getNamedSets().ipSets || {};
    const fill = (text: string, target: Cidr4[]) => {
      for (const line of this.lines(text)) {
        for (const tok of line.split(/\s+/)) {
          if (!tok) continue;
          if (tok.toLowerCase().startsWith('ip-set:')) {
            const name = tok.slice('ip-set:'.length);
            for (const t of (namedSets[name] || [])) {
              const c = parseCidr4(String(t).trim());
              if (c) target.push(c);
            }
            continue;
          }
          const c = parseCidr4(tok);
          if (c) target.push(c);
          else if (tok.includes(':')) {
            this.v6Exact.set(tok.toLowerCase(), target === this.ignore ? 'ignore' : 'blacklist');
          }
        }
      }
    };
    fill(store.getRule('ignore_ip'), this.ignore);
    fill(store.getRule('blacklist_ip'), this.blacklist);
    fill(store.getRule('whitelist_ip'), this.whitelist);
    fill(store.getRule('bogus_nxdomain'), this.bogus);

    for (const line of this.lines(store.getRule('ip_alias'))) {
      const parts = line.split(/\s+/);
      if (parts.length < 2) continue;
      const c = parseCidr4(parts[0]);
      if (!c) continue;
      const targets = parts[1].split(',').map(s => s.trim()).filter(Boolean);
      if (targets.length) this.alias.push({ cidr: c, targets });
    }
  }

  /** Apply IP rules to a set of A/AAAA records. Non-address records pass through untouched. */
  apply(records: DnsRecord[]): IpRuleApplyResult {
    const out: DnsRecord[] = [];
    let bogusHit = false;

    for (const rec of records) {
      if (rec.type !== 1 && rec.type !== 28) {
        out.push(rec);
        continue;
      }
      const ip = String(rec.data);

      if (rec.type === 28) {
        const kind = this.v6Exact.get(ip.toLowerCase());
        if (kind === 'ignore' || kind === 'blacklist') continue;
        out.push(rec);
        continue;
      }

      // IPv4
      if (this.ignore.some(c => matchCidr4(ip, c))) continue;
      if (this.blacklist.some(c => matchCidr4(ip, c))) continue;
      if (this.bogus.some(c => matchCidr4(ip, c))) { bogusHit = true; continue; }

      const alias = this.alias.find(a => matchCidr4(ip, a.cidr));
      if (alias) {
        for (const target of alias.targets) {
          const tInt = ipv4ToInt(target);
          if (tInt === null) continue;
          out.push({ ...rec, data: target });
        }
        continue;
      }
      out.push(rec);
    }

    return { records: out, bogusHit };
  }
}
