// SpeedChecker — TCP handshake latency probing (equivalent to SmartDNS speed-check-mode tcp:port)
// Uses node:net (TCP client) which is available in the Scripting full-App runtime.
import * as net from 'node:net';

export interface SpeedResult {
  ip: string;
  rtt: number; // ms, Number.MAX_SAFE_INTEGER means unreachable
  ok: boolean;
}

interface CacheItem {
  rtt: number;
  at: number;
}

export class SpeedChecker {
  private static instance: SpeedChecker;

  private cache = new Map<string, CacheItem>();
  private ttlMs = 60_000;         // reuse a measured RTT for 60s
  private maxConcurrency = 8;     // node:net hard limit is 32 sockets per context
  private failTtlMs = 15_000;     // remember unreachable for 15s

  static get(): SpeedChecker {
    if (!SpeedChecker.instance) SpeedChecker.instance = new SpeedChecker();
    return SpeedChecker.instance;
  }

  /** Parse "tcp:443,tcp:80" / "none" / "" into a port list. */
  parseMode(mode: string): number[] {
    const ports: number[] = [];
    if (!mode || mode.trim() === 'none') return ports;
    for (const part of mode.split(',')) {
      const m = part.trim().match(/^tcp:(\d+)$/i);
      if (m) {
        const p = Number(m[1]);
        if (p >= 1 && p <= 65535) ports.push(p);
      }
    }
    if (ports.length === 0) ports.push(443);
    return ports;
  }

  private measureTcp(ip: string, port: number, timeoutMs: number): Promise<number | null> {
    return new Promise((resolve) => {
      const start = Date.now();
      let done = false;
      let socket: any = null;
      const finish = (rtt: number | null) => {
        if (done) return;
        done = true;
        try { socket && socket.destroy(); } catch {}
        resolve(rtt);
      };
      try {
        socket = net.createConnection({ host: ip, port, noDelay: true });
        socket.setTimeout(timeoutMs, () => finish(null));
        socket.once('connect', () => finish(Date.now() - start));
        socket.once('error', () => finish(null));
      } catch {
        finish(null);
      }
    });
  }

  /** Measure one IP; returns ms or null when unreachable. Cached. */
  async measure(ip: string, mode: string, timeoutMs = 800): Promise<number | null> {
    const cached = this.cache.get(ip);
    if (cached) {
      const age = Date.now() - cached.at;
      if (cached.rtt === Number.MAX_SAFE_INTEGER) {
        if (age < this.failTtlMs) return null;
      } else if (age < this.ttlMs) {
        return cached.rtt;
      }
    }
    const ports = this.parseMode(mode);
    if (ports.length === 0) return null;
    for (const port of ports) {
      const rtt = await this.measureTcp(ip, port, timeoutMs);
      if (rtt !== null) {
        this.cache.set(ip, { rtt, at: Date.now() });
        return rtt;
      }
    }
    this.cache.set(ip, { rtt: Number.MAX_SAFE_INTEGER, at: Date.now() });
    return null;
  }

  /** Measure all IPs with bounded concurrency; returns results in original order. */
  async rank(ips: string[], mode: string, timeoutMs = 800): Promise<SpeedResult[]> {
    const results: SpeedResult[] = new Array(ips.length);
    let cursor = 0;
    const workerCount = Math.max(1, Math.min(this.maxConcurrency, ips.length));
    const worker = async () => {
      while (true) {
        const i = cursor++;
        if (i >= ips.length) break;
        const rtt = await this.measure(ips[i], mode, timeoutMs);
        results[i] = {
          ip: ips[i],
          rtt: rtt === null ? Number.MAX_SAFE_INTEGER : rtt,
          ok: rtt !== null,
        };
      }
    };
    const workers: Promise<void>[] = [];
    for (let w = 0; w < workerCount; w++) workers.push(worker());
    await Promise.all(workers);
    return results;
  }

  clearCache(): void {
    this.cache.clear();
  }

  getCacheSize(): number {
    return this.cache.size;
  }
}
