// TCP / TLS (DoT) DNS upstream transport — RFC 1035 over TCP with 2-byte length prefix.
// UDP is NOT available in the Scripting runtime (no dgram), so plain DNS uses TCP (port 53)
// and encrypted DNS uses DoT (port 853). DoH continues to use fetch() in resolver.ts.
import * as net from 'node:net';
import * as tls from 'node:tls';

function queryOverStream(
  socket: any,
  queryBytes: Uint8Array,
  timeoutMs: number,
  startConnect: (onReady: () => void, onFail: (e: any) => void) => void
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let buffer = new Uint8Array(0);

    const cleanup = () => {
      try { socket && socket.destroy(); } catch {}
    };
    const fail = (e: any) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(e instanceof Error ? e : new Error(String(e)));
    };
    const ok = (bytes: Uint8Array) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(bytes);
    };

    const sendQuery = () => {
      const len = queryBytes.length;
      const frame = new Uint8Array(2 + len);
      frame[0] = (len >> 8) & 0xff;
      frame[1] = len & 0xff;
      frame.set(queryBytes, 2);
      try {
        socket.write(frame);
      } catch (e) {
        fail(e);
      }
    };

    const onData = (data: any) => {
      const chunk = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
      const merged = new Uint8Array(buffer.length + chunk.length);
      merged.set(buffer, 0);
      merged.set(chunk, buffer.length);
      buffer = merged;
      if (buffer.length >= 2) {
        const need = (buffer[0] << 8) | buffer[1];
        if (buffer.length >= 2 + need) {
          ok(buffer.subarray(2, 2 + need));
        }
      }
    };

    try {
      socket.setTimeout(timeoutMs, () => fail(new Error('timeout')));
      socket.on('data', onData);
      socket.once('error', fail);
      socket.once('close', () => {
        if (!settled) fail(new Error('connection closed before response'));
      });
      startConnect(sendQuery, fail);
    } catch (e) {
      fail(e);
    }
  });
}

/** Plain DNS over TCP (default port 53). */
export function queryTcpDns(host: string, port: number, queryBytes: Uint8Array, timeoutMs = 2500): Promise<Uint8Array> {
  const socket = net.createConnection({ host, port: port || 53, noDelay: true });
  return queryOverStream(socket, queryBytes, timeoutMs, (onReady, onFail) => {
    socket.once('connect', onReady);
  });
}

/** DNS over TLS (DoT, default port 853). servername is used for SNI / certificate verification. */
export function queryDot(
  host: string,
  port: number,
  queryBytes: Uint8Array,
  timeoutMs = 2500,
  servername?: string
): Promise<Uint8Array> {
  const socket = tls.connect({
    host,
    port: port || 853,
    servername: servername || host,
    rejectUnauthorized: true,
  });
  return queryOverStream(socket, queryBytes, timeoutMs, (onReady, onFail) => {
    socket.once('secureConnect', onReady);
  });
}
