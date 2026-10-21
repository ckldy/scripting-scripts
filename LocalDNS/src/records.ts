// Local record injection — port of SmartDNS hosts-file / txt-record / cname
import { Store } from './store';
import type { DnsRecord } from './types';

export interface LocalRecordResult {
  kind: 'answer' | 'cname';
  records: DnsRecord[];
  cnameTarget?: string;
}

function ipv4ToInt(ip: string): number | null {
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const nums = m.slice(1).map(Number);
  if (nums.some(n => n > 255)) return null;
  return 1;
}

export class LocalRecordsEngine {
  private static instance: LocalRecordsEngine;

  private hosts = new Map<string, { v4: string[]; v6: string[] }>();
  private txt = new Map<string, string[]>();
  private cname = new Map<string, string>();

  static get(): LocalRecordsEngine {
    if (!LocalRecordsEngine.instance) LocalRecordsEngine.instance = new LocalRecordsEngine();
    return LocalRecordsEngine.instance;
  }

  reload(): void {
    const store = Store.get();
    this.hosts.clear();
    this.txt.clear();
    this.cname.clear();

    // hosts-file format: "1.2.3.4 host1 host2 ..." or "::1 host"
    for (let line of store.getRule('local_hosts').split('\n')) {
      line = line.trim();
      if (!line || line.startsWith('#')) continue;
      const parts = line.split(/\s+/);
      if (parts.length < 2) continue;
      const ip = parts[0];
      const isV6 = ip.includes(':');
      if (!isV6 && ipv4ToInt(ip) === null) continue;
      for (const host of parts.slice(1)) {
        const h = host.toLowerCase();
        if (!this.hosts.has(h)) this.hosts.set(h, { v4: [], v6: [] });
        const entry = this.hosts.get(h)!;
        (isV6 ? entry.v6 : entry.v4).push(ip);
      }
    }

    // txt-record: "domain text..."
    for (let line of store.getRule('txt_records').split('\n')) {
      line = line.trim();
      if (!line || line.startsWith('#')) continue;
      const idx = line.indexOf(' ');
      if (idx < 0) continue;
      const domain = line.slice(0, idx).toLowerCase();
      const text = line.slice(idx + 1);
      if (!this.txt.has(domain)) this.txt.set(domain, []);
      this.txt.get(domain)!.push(text);
    }

    // cname: "domain target"
    for (let line of store.getRule('cname_records').split('\n')) {
      line = line.trim();
      if (!line || line.startsWith('#')) continue;
      const parts = line.split(/\s+/);
      if (parts.length < 2) continue;
      this.cname.set(parts[0].toLowerCase(), parts[1].toLowerCase());
    }
  }

  lookup(domain: string, qtype: number): LocalRecordResult | null {
    const d = domain.toLowerCase().replace(/\.$/, '');

    if (qtype === 16) {
      const txts = this.txt.get(d);
      if (txts && txts.length) {
        return {
          kind: 'answer',
          records: txts.map(t => ({ name: d, type: 16, typeName: 'TXT', class: 1, ttl: 300, data: t })),
        };
      }
    }

    if (qtype === 1 || qtype === 28) {
      const host = this.hosts.get(d);
      if (host) {
        const ips = qtype === 28 ? host.v6 : host.v4;
        if (ips.length) {
          return {
            kind: 'answer',
            records: ips.map(ip => ({
              name: d,
              type: qtype,
              typeName: qtype === 28 ? 'AAAA' : 'A',
              class: 1,
              ttl: 300,
              data: ip,
            })),
          };
        }
      }
      const target = this.cname.get(d);
      if (target) {
        return {
          kind: 'cname',
          cnameTarget: target,
          records: [{ name: d, type: 5, typeName: 'CNAME', class: 1, ttl: 300, data: target }],
        };
      }
    }

    return null;
  }
}
