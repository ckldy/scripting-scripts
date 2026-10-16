import { Path, Script } from 'scripting';
import { Store } from './store';
import { CacheManager } from './cache';
import { AdGuardEngine } from './adguard';
import { DiversionEngine } from './diversion';
import { AuditManager } from './audit';
import { DnsResolver, cleanDomain } from './resolver';

function parseJsonBody(req: HttpRequest): any {
  try {
    const raw = req.body.toRawString('utf-8');
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function jsonResponse(data: any, status = 200): HttpResponse {
  const jsonStr = JSON.stringify(data);
  const bodyData = Data.fromRawString(jsonStr, 'utf-8');
  return HttpResponse.raw(status, 'OK', {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
    body: bodyData,
  });
}

function textResponse(text: string, status = 200, contentType = 'text/plain; charset=utf-8'): HttpResponse {
  const bodyData = Data.fromRawString(text, 'utf-8');
  return HttpResponse.raw(status, 'OK', {
    headers: {
      'Content-Type': contentType,
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
    body: bodyData,
  });
}

function decodeBase64Url(str: string): Uint8Array {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4 !== 0) {
    base64 += '=';
  }
  const binaryStr = atob(base64);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }
  return bytes;
}

export class LocalDnsServer {
  private static instance: LocalDnsServer;
  private httpServer: HttpServer | null = null;
  private httpsServer: HttpServer | null = null;
  private port = 9099;
  private httpsPort = 9443;
  private isRunning = false;
  private isHttpsActive = false;

  private constructor() {}

  static get(): LocalDnsServer {
    if (!LocalDnsServer.instance) {
      LocalDnsServer.instance = new LocalDnsServer();
    }
    return LocalDnsServer.instance;
  }

  getPort(): number {
    return this.port;
  }

  getHttpsPort(): number {
    return this.httpsPort;
  }

  getIsRunning(): boolean {
    return this.isRunning;
  }

  getIsHttpsActive(): boolean {
    return this.isHttpsActive;
  }

  getProtocol(): 'http' {
    return 'http';
  }

  start(port = 9099): { success: boolean; port: number; httpsPort: number; error?: string } {
    if (this.isRunning && this.httpServer) {
      return { success: true, port: this.port, httpsPort: this.httpsPort };
    }

    this.port = port;
    const webDir = Path.join(Script.directory, 'web');
    const p12Path = Path.join(Script.directory, 'cert/server.p12');

    // 1. Start HTTP Management & Web UI Server (default 9099)
    const candidatePorts = [port, 9098, 9090, 8099];
    let startedPort = port;
    let mainServer: HttpServer | null = null;
    let lastError: string | null = null;

    for (const p of candidatePorts) {
      const s = new HttpServer();
      this.setupServerMiddleware(s, webDir);
      const err = s.start({ port: p, forceIPv4: false });
      if (!err) {
        startedPort = s.port || p;
        mainServer = s;
        break;
      } else {
        lastError = err;
        try { s.stop(); } catch {}
      }
    }

    if (!mainServer) {
      this.isRunning = false;
      this.httpServer = null;
      return { success: false, port, httpsPort: this.httpsPort, error: lastError || 'Port in use' };
    }

    this.port = startedPort;
    this.httpServer = mainServer;
    this.isRunning = true;

    // 2. Start HTTPS DoH Server (default 9443, with TLS P12 for Surge and RFC 8484 HTTPS clients)
    this.isHttpsActive = false;
    if (FileManager.existsSync(p12Path)) {
      try {
        const tlsServer = new HttpServer();
        
        // Explicitly register async route handlers so Swifter router matches them
        tlsServer.registerAsyncHandler('/dns-query', async (req: HttpRequest) => {
          if (req.method === 'OPTIONS') {
            return HttpResponse.raw(204, 'No Content', {
              headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization',
              },
            });
          }
          return await this.handleDoh(req);
        });

        tlsServer.registerAsyncHandler('/api/resolve', async (req: HttpRequest) => {
          return await this.handleApi('/api/resolve', req.method.toUpperCase(), req);
        });

        const caPath = Path.join(Script.directory, 'cert/ca.crt');
        tlsServer.registerAsyncHandler('/ca.crt', async () => {
          if (FileManager.existsSync(caPath)) {
            const f = FileEntity.openForReading(caPath);
            return HttpResponse.raw(200, 'OK', {
              headers: { 'Content-Type': 'application/x-x509-ca-cert' },
              body: f,
            });
          }
          return HttpResponse.notFound();
        });

        const tlsCandidatePorts = [9443, 8443, 9093];
        for (const tp of tlsCandidatePorts) {
          const tlsErr = tlsServer.start({
            port: tp,
            forceIPv4: false,
            tls: {
              p12: p12Path,
              password: 'localdns',
              minVersion: '1.2',
              maxVersion: '1.3',
            },
          });
          if (!tlsErr) {
            this.httpsPort = tlsServer.port || tp;
            this.httpsServer = tlsServer;
            this.isHttpsActive = true;
            break;
          } else {
            try { tlsServer.stop(); } catch {}
          }
        }
      } catch (e) {
        console.warn('[LocalDNS] HTTPS DoH server startup skipped:', e);
      }
    }

    return { success: true, port: this.port, httpsPort: this.httpsPort };
  }

  reloadTlsServer(): boolean {
    const p12Path = Path.join(Script.directory, 'cert/server.p12');
    if (this.httpsServer) {
      try { this.httpsServer.stop(); } catch {}
      this.httpsServer = null;
    }
    this.isHttpsActive = false;

    if (!FileManager.existsSync(p12Path)) {
      return false;
    }

    try {
      const tlsServer = new HttpServer();
      tlsServer.registerAsyncHandler('/dns-query', async (req: HttpRequest) => {
        if (req.method === 'OPTIONS') {
          return HttpResponse.raw(204, 'No Content', {
            headers: {
              'Access-Control-Allow-Origin': '*',
              'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
              'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            },
          });
        }
        return await this.handleDoh(req);
      });

      tlsServer.registerAsyncHandler('/api/resolve', async (req: HttpRequest) => {
        return await this.handleApi('/api/resolve', req.method.toUpperCase(), req);
      });

      const caPath = Path.join(Script.directory, 'cert/ca.crt');
      tlsServer.registerAsyncHandler('/ca.crt', async () => {
        if (FileManager.existsSync(caPath)) {
          const f = FileEntity.openForReading(caPath);
          return HttpResponse.raw(200, 'OK', {
            headers: { 'Content-Type': 'application/x-x509-ca-cert' },
            body: f,
          });
        }
        return HttpResponse.notFound();
      });

      const tlsCandidatePorts = [this.httpsPort, 9443, 8443, 9093];
      for (const tp of tlsCandidatePorts) {
        const tlsErr = tlsServer.start({
          port: tp,
          forceIPv4: false,
          tls: {
            p12: p12Path,
            password: 'localdns',
            minVersion: '1.2',
            maxVersion: '1.3',
          },
        });
        if (!tlsErr) {
          this.httpsPort = tlsServer.port || tp;
          this.httpsServer = tlsServer;
          this.isHttpsActive = true;
          return true;
        } else {
          try { tlsServer.stop(); } catch {}
        }
      }
    } catch (e) {
      console.warn('[LocalDNS] HTTPS reload failed:', e);
    }
    return false;
  }

  stop(): void {
    if (this.httpServer) {
      try { this.httpServer.stop(); } catch {}
      this.httpServer = null;
    }
    if (this.httpsServer) {
      try { this.httpsServer.stop(); } catch {}
      this.httpsServer = null;
    }
    this.isRunning = false;
    this.isHttpsActive = false;
  }

  private setupServerMiddleware(server: HttpServer, webDir: string): void {

    // 2. Global Dispatcher Middleware
    server.registerMiddleware(async (req: HttpRequest) => {
      // CORS Preflight
      if (req.method === 'OPTIONS') {
        return HttpResponse.raw(204, 'No Content', {
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          },
        });
      }

      const path = req.path;
      const method = req.method.toUpperCase();

      // Redirect root to /ui/
      if (path === '/' || path === '/ui') {
        return HttpResponse.movedTemporarily('/ui/');
      }

      // Serve /ui/* static assets
      if (path.startsWith('/ui')) {
        let sub = path.slice(3); // Remove '/ui'
        if (sub.startsWith('/')) sub = sub.slice(1);
        if (!sub || sub === '/') sub = 'index.html';
        sub = sub.split('?')[0];

        const fullPath = Path.join(webDir, sub);
        if ((await FileManager.exists(fullPath)) && !(await FileManager.isDirectory(fullPath))) {
          const ext = Path.extname(fullPath).toLowerCase();
          const mimeMap: Record<string, string> = {
            '.html': 'text/html; charset=utf-8',
            '.css': 'text/css; charset=utf-8',
            '.js': 'application/javascript; charset=utf-8',
            '.json': 'application/json; charset=utf-8',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.svg': 'image/svg+xml',
            '.woff2': 'font/woff2',
            '.woff': 'font/woff',
            '.txt': 'text/plain; charset=utf-8',
            '.crt': 'application/x-x509-ca-cert',
            '.mobileconfig': 'application/x-apple-aspen-config; charset=utf-8',
            '.sgmodule': 'text/plain; charset=utf-8',
          };
          const contentType = mimeMap[ext] || 'application/octet-stream';
          const file = FileEntity.openForReading(fullPath);
          return HttpResponse.raw(200, 'OK', {
            headers: {
              'Content-Type': contentType,
              'Cache-Control': 'no-cache, no-store, must-revalidate',
              'Pragma': 'no-cache',
              'Expires': '0',
              'Access-Control-Allow-Origin': '*',
            },
            body: file,
          });
        }
      }

      // DoH DNS-over-HTTPS endpoint: /dns-query
      if (path === '/dns-query') {
        return await this.handleDoh(req);
      }

      // Prometheus metrics: /metrics
      if (path === '/metrics') {
        const metrics = AuditManager.get().generatePrometheusMetrics();
        return textResponse(metrics, 200, 'text/plain; version=0.0.4; charset=utf-8');
      }

      // REST API routing
      if (path.startsWith('/api/')) {
        return await this.handleApi(path, method, req);
      }

      // Plugins API routing
      if (path.startsWith('/plugins/')) {
        return await this.handlePlugins(path, method, req);
      }

      // Let pass through to static files handler
      return null;
    });

    // Fallback 404
    server.setNotFoundHandler(async (req) => {
      if (req.path.startsWith('/api/') || req.path.startsWith('/plugins/')) {
        return jsonResponse({ error: 'Endpoint not found', path: req.path }, 404);
      }
      return HttpResponse.notFound(HttpResponseBody.text(`Not found: ${req.path}`));
    });
  }

  private async handleDoh(req: HttpRequest): Promise<HttpResponse> {
    const clientIp = req.address || '127.0.0.1';
    let queryBytes: Uint8Array | null = null;

    if (req.method === 'POST') {
      const bodyData = req.body;
      if (bodyData) {
        queryBytes = bodyData.toUint8Array();
      }
    } else if (req.method === 'GET') {
      let dnsB64 = '';
      try {
        const u = new URL(req.target || req.path, 'http://127.0.0.1');
        dnsB64 = u.searchParams.get('dns') || '';
      } catch {}
      if (!dnsB64 && Array.isArray(req.queryParams)) {
        const dnsParam = req.queryParams.find(p => p.key === 'dns');
        if (dnsParam) dnsB64 = dnsParam.value;
      }
      if (dnsB64) {
        try {
          queryBytes = decodeBase64Url(dnsB64);
        } catch {}
      }
    }

    if (!queryBytes || queryBytes.length === 0) {
      return HttpResponse.badRequest(HttpResponseBody.text('Missing DNS wire query'));
    }

    try {
      const respBytes = await DnsResolver.get().resolve(queryBytes, clientIp);
      const respData = Data.fromUint8Array(respBytes);

      return HttpResponse.raw(200, 'OK', {
        headers: {
          'Content-Type': 'application/dns-message',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'max-age=300',
          'Connection': 'keep-alive',
          'Keep-Alive': 'timeout=60, max=1000',
        },
        body: respData,
      });
    } catch (e: any) {
      return HttpResponse.internalServerError();
    }
  }

  private async handleApi(path: string, method: string, req: HttpRequest): Promise<HttpResponse> {
    const store = Store.get();
    const cleanPath = path.split('?')[0];

    // 1. /api/v1/status
    if (cleanPath === '/api/v1/status' && method === 'GET') {
      const detailedStats = AuditManager.get().getDetailedStats();
      const upstreamStats = AuditManager.get().getUpstreamStatsList();
      const fileCounts = DiversionEngine.get().getSourceFileCounts();
      const adCount = AdGuardEngine.get().getRuleCount();

      return jsonResponse({
        status: 'online',
        version: 'FJG20',
        upstream_stats: upstreamStats,
        rules: {
          geosite_cn: fileCounts.geosite_cn || 0,
          force_domestic: (fileCounts.whitelist || 0) + (fileCounts.custom_cn || 0),
          geosite_non_cn: (fileCounts.geosite_non_cn || 0) + (fileCounts.custom_non_cn || 0),
          force_foreign_fakeip: fileCounts.greylist || 0,
          block: fileCounts.blocklist || 0,
        },
        adguard_rules: adCount,
        stats: detailedStats,
      });
    }

    // 2. /api/v1/upstream/config
    if (path === '/api/v1/upstream/config') {
      if (method === 'GET') {
        return jsonResponse(store.getUpstreamConfig());
      }
      if (method === 'POST') {
        const body = parseJsonBody(req);
        if (body.plugin_tag && Array.isArray(body.upstreams)) {
          store.setUpstreamGroup(body.plugin_tag, body.upstreams);
        }
        if (body.ecs !== undefined) {
          store.setUpstreamEcs(body.ecs);
        }
        return jsonResponse({ success: true });
      }
    }

    // 3. /api/v1/upstream/tags
    if (path === '/api/v1/upstream/tags' && method === 'GET') {
      return jsonResponse(['domestic', 'foreign', 'foreign_ecs', 'proxy']);
    }

    // 4. /api/v1/upstream/ecs
    if (path === '/api/v1/upstream/ecs') {
      if (method === 'GET') {
        return jsonResponse({ ecs: store.getUpstreamEcs() });
      }
      if (method === 'POST') {
        const body = parseJsonBody(req);
        store.setUpstreamEcs(body.ecs || '');
        return jsonResponse({ success: true, ecs: store.getUpstreamEcs() });
      }
    }

    // 5. /api/v1/audit/status
    if (path === '/api/v1/audit/status' && method === 'GET') {
      return jsonResponse({ capturing: store.isAuditCapturing() });
    }
    if (path === '/api/v1/audit/start' && method === 'POST') {
      store.setAuditCapturing(true);
      return jsonResponse({ success: true, capturing: true });
    }
    if (path === '/api/v1/audit/stop' && method === 'POST') {
      store.setAuditCapturing(false);
      return jsonResponse({ success: true, capturing: false });
    }

    // 6. /api/v1/audit/capacity
    if (path === '/api/v1/audit/capacity') {
      if (method === 'GET') {
        return jsonResponse({ capacity: store.getAuditCapacity() });
      }
      if (method === 'POST') {
        const body = parseJsonBody(req);
        const cap = Number(body.capacity || body);
        if (Number.isFinite(cap) && cap >= 100) {
          store.setAuditCapacity(cap);
          return jsonResponse({ success: true, capacity: store.getAuditCapacity() });
        }
        return jsonResponse({ error: 'Capacity must be at least 100' }, 400);
      }
    }

    // 7. /api/v1/audit/clear
    if (path === '/api/v1/audit/clear' && method === 'POST') {
      AuditManager.get().clearLogs();
      return jsonResponse({ success: true });
    }

    // 8. /api/v2/audit/stats
    if (path === '/api/v2/audit/stats' && method === 'GET') {
      return jsonResponse(AuditManager.get().getDetailedStats());
    }

    // 9. /api/v2/audit/rank/:type
    if (path.startsWith('/api/v2/audit/rank/')) {
      const type = path.replace('/api/v2/audit/rank/', '');
      const limitParam = req.queryParams.find(p => p.key === 'limit');
      const limit = limitParam ? Number(limitParam.value) || 10 : 10;
      const ranks = AuditManager.get().getRank(type, limit);
      return jsonResponse(ranks);
    }

    // 10. /api/v2/audit/logs
    if (path === '/api/v2/audit/logs' && method === 'GET') {
      const getParam = (key: string) => req.queryParams.find(p => p.key === key)?.value;
      const logsResult = AuditManager.get().getLogs({
        page: Number(getParam('page')) || 1,
        limit: Number(getParam('limit')) || 50,
        q: getParam('q'),
        exact: getParam('exact') === 'true' || getParam('exact') === '1',
        query_type: getParam('query_type'),
        domain_set: getParam('domain_set'),
        response_code: getParam('response_code'),
        client_contains: getParam('client_contains'),
      });
      return jsonResponse(logsResult);
    }

    // 11. /api/v1/system/restart
    if (path === '/api/v1/system/restart' && method === 'POST') {
      // Simulate quick reboot
      setTimeout(() => {
        CacheManager.get().clearAll();
      }, 300);
      return jsonResponse({ success: true, message: 'Restart scheduled' });
    }

    // 12. /api/resolve (JSON DNS resolve for Surge DNS script or debug)
    if (cleanPath.startsWith('/api/resolve') && method === 'GET') {
      let domain = '';
      let typeStr = '1';

      try {
        const u = new URL(req.target || path, 'http://127.0.0.1');
        domain = (u.searchParams.get('name') || u.searchParams.get('domain') || '').trim();
        typeStr = (u.searchParams.get('type') || '1').trim().toUpperCase();
      } catch {
        const getParam = (key: string) => req.queryParams.find(p => p.key === key)?.value;
        domain = (getParam('name') || getParam('domain') || '').trim();
        typeStr = (getParam('type') || '1').trim().toUpperCase();
      }

      if (!domain) {
        return jsonResponse({ error: 'Missing name parameter' }, 400);
      }
      domain = cleanDomain(domain);
      let qtype = 1;
      if (typeStr === '28' || typeStr === 'AAAA') qtype = 28;
      else if (typeStr === '16' || typeStr === 'TXT') qtype = 16;
      else if (typeStr === '5' || typeStr === 'CNAME') qtype = 5;
      else if (Number(typeStr)) qtype = Number(typeStr);

      const clientIp = req.address || '127.0.0.1';
      const result = await DnsResolver.get().resolveName(domain, qtype, clientIp);
      return jsonResponse({
        name: domain,
        type: qtype === 28 ? 'AAAA' : 'A',
        addresses: result.addresses,
        ttl: result.ttl,
        rcode: result.rcode,
        blocked: result.blocked,
        domain_set: result.domainSet,
      });
    }

    // 13. /api/surge-script (Returns ready-to-use Surge DNS script)
    if (cleanPath.startsWith('/api/surge-script') && method === 'GET') {
      const scriptContent = `/**
 * LocalDNS Surge DNS Script
 * 接管 Surge DNS 查询并交由本地 LocalDNS 处理（广告过滤、分流与多级缓存）
 */
const domain = $request.question.name;
const qtype = $request.question.type;

$httpClient.get({
  url: 'http://127.0.0.1:${this.port}/api/resolve?name=' + encodeURIComponent(domain) + '&type=' + qtype,
  timeout: 3000
}, function(error, response, data) {
  if (error || !data) {
    $done({}); // 异常时回退到系统或上游解析
    return;
  }
  try {
    const res = JSON.parse(data);
    if (res && Array.isArray(res.addresses) && res.addresses.length > 0) {
      $done({
        addresses: res.addresses,
        ttl: res.ttl || 300
      });
      return;
    }
  } catch (e) {}
  $done({});
});
`;
      return textResponse(scriptContent, 200, 'application/javascript; charset=utf-8');
    }

    return jsonResponse({ error: 'Unknown API endpoint' }, 404);
  }

  private async handlePlugins(path: string, method: string, req: HttpRequest): Promise<HttpResponse> {
    const store = Store.get();
    const sub = path.replace('/plugins/', '');

    // 1. /plugins/client_name
    if (sub === 'client_name') {
      if (method === 'GET') {
        return jsonResponse(store.getClientAliases());
      }
      if (method === 'POST') {
        const body = parseJsonBody(req);
        if (body.ip && body.name !== undefined) {
          store.setClientAlias(body.ip, body.name);
        }
        return jsonResponse({ success: true, aliases: store.getClientAliases() });
      }
    }

    // 2. /plugins/adguard/...
    if (sub === 'adguard/rules' && method === 'GET') {
      return jsonResponse(store.getAdguardSources());
    }
    if (sub.startsWith('adguard/rules/') && method === 'PUT') {
      const id = sub.replace('adguard/rules/', '');
      const body = parseJsonBody(req);
      const sources = store.getAdguardSources();
      const idx = sources.findIndex(s => s.id === id || s.name === body.name || s.name === id);
      if (idx !== -1) {
        sources[idx] = { ...sources[idx], ...body };
        store.setAdguardSources(sources);
        AdGuardEngine.get().rebuildFromStore();
        return jsonResponse(sources[idx]);
      }
      return jsonResponse({ error: 'AdGuard rule not found' }, 404);
    }
    if (sub.startsWith('adguard/rules/') && method === 'DELETE') {
      const id = sub.replace('adguard/rules/', '');
      let sources = store.getAdguardSources();
      sources = sources.filter(s => s.id !== id && s.name !== id);
      store.setAdguardSources(sources);
      AdGuardEngine.get().rebuildFromStore();
      return jsonResponse({ success: true });
    }
    if (sub.startsWith('adguard/rules/') && sub.endsWith('/update') && method === 'POST') {
      const id = sub.replace('adguard/rules/', '').replace('/update', '');
      const sources = store.getAdguardSources();
      const s = sources.find(x => x.id === id || x.name === id);
      if (s) {
        const res = await AdGuardEngine.get().updateSource(s.id);
        return jsonResponse({
          success: res.success,
          rule_count: res.ruleCount,
          changed: true,
          error: res.error || null,
        });
      }
      return jsonResponse({ error: 'AdGuard rule not found' }, 404);
    }
    if (sub === 'adguard/update' && method === 'POST') {
      const res = await AdGuardEngine.get().updateAll();
      return jsonResponse({
        success: true,
        updated_sources: res.updated_sources,
        errors: res.errors,
      });
    }
    if (sub.startsWith('adguard/update/') && method === 'POST') {
      const name = decodeURIComponent(sub.replace('adguard/update/', ''));
      const sources = store.getAdguardSources();
      const s = sources.find(x => x.name === name || x.id === name);
      if (s) {
        const res = await AdGuardEngine.get().updateSource(s.id);
        return jsonResponse({
          success: res.success,
          rule_count: res.ruleCount,
          changed: true,
          error: res.error || null,
        });
      }
      return jsonResponse({ error: 'Source not found' }, 404);
    }
    if (sub === 'adguard/config' || sub === 'adguard/rules') {
      if (method === 'GET') {
        return jsonResponse(store.getAdguardSources());
      }
      if (method === 'POST') {
        const body = parseJsonBody(req);
        const sources = store.getAdguardSources();
        const existingIdx = sources.findIndex(s => s.name === body.name || s.id === body.id);
        if (existingIdx !== -1) {
          sources[existingIdx] = { ...sources[existingIdx], ...body };
        } else {
          sources.push({
            id: `ad_${Date.now()}`,
            name: body.name || '新规则',
            tag: 'adguard',
            url: body.url || '',
            enabled: body.enabled !== false,
            auto_update: body.auto_update !== false,
            update_interval_hours: body.update_interval_hours || 24,
            rule_count: 0,
            last_updated: null,
            last_error: null,
          });
        }
        store.setAdguardSources(sources);
        AdGuardEngine.get().rebuildFromStore();
        return jsonResponse({ success: true });
      }
    }
    if (sub.startsWith('adguard/config/') && method === 'DELETE') {
      const name = decodeURIComponent(sub.replace('adguard/config/', ''));
      let sources = store.getAdguardSources();
      sources = sources.filter(s => s.name !== name && s.id !== name);
      store.setAdguardSources(sources);
      AdGuardEngine.get().rebuildFromStore();
      return jsonResponse({ success: true });
    }

    // 3. /plugins/requery/...
    if (sub === 'requery/stats/source_file_counts' && method === 'GET') {
      return jsonResponse(DiversionEngine.get().getSourceFileCounts());
    }
    if (sub === 'requery/status' && method === 'GET') {
      return jsonResponse({ status: 'idle', last_run: null });
    }
    if (sub === 'requery/scheduler/config') {
      if (method === 'GET') return jsonResponse(store.getRequeryConfig());
      if (method === 'POST') {
        const body = parseJsonBody(req);
        store.setRequeryConfig(body);
        return jsonResponse({ success: true, config: store.getRequeryConfig() });
      }
    }
    if (sub === 'requery/trigger' && method === 'POST') {
      DiversionEngine.get().updateAll();
      return jsonResponse({ success: true, message: 'Refresh started' });
    }
    if (sub === 'requery/cancel' && method === 'POST') {
      return jsonResponse({ success: true, message: 'Cancelled' });
    }
    if (sub === 'requery/reset' && method === 'POST') {
      return jsonResponse({ success: true });
    }

    // 4. /plugins/:tag/show
    if (sub.endsWith('/show')) {
      const tag = sub.replace('/show', '');
      const switches = store.getSwitches();

      // Check if it's a switch
      if (tag.startsWith('switch')) {
        const val = switches[tag as keyof typeof switches] || 'B';
        return textResponse(val);
      }

      // Check if it's a cache view
      if (tag.startsWith('cache_')) {
        const pool = CacheManager.get().getPool(tag);
        if (pool) {
          const items = pool.dumpItems();
          const lines = items.map(it => `${it.domain} (Type: ${it.type}, TTL: ${it.ttl}s) -> ${it.answers.join(', ')}`);
          return textResponse(lines.length ? lines.join('\n') : '缓存池当前为空');
        }
      }

      // Local rule content
      const ruleText = store.getRule(tag);
      return textResponse(ruleText);
    }

    // 5. /plugins/:tag/post (Switches toggle or Local list rules save)
    if (sub.endsWith('/post') && method === 'POST') {
      const tag = sub.replace('/post', '');
      const body = parseJsonBody(req);

      // Handle Switch Toggles (e.g. switch1, switch7, switch13, switch6, switch5, switch4, switch2, switch12)
      if (tag.startsWith('switch')) {
        const val = String(body.value || body || 'B').toUpperCase() === 'A' ? 'A' : 'B';
        store.setSwitch(tag as any, val);
        return jsonResponse({ success: true, tag, value: val });
      }

      // Handle Local List Rules (e.g. whitelist, blocklist, greylist, force_realip, etc.)
      const values = Array.isArray(body.values) ? body.values : [];
      store.setRule(tag, values.join('\n'));
      DiversionEngine.get().reloadLocalRules();
      return jsonResponse({ success: true, count: values.length });
    }

    // 6. /plugins/:tag/config/:name (PUT to update/toggle diversion rule, DELETE to remove)
    if (sub.includes('/config/')) {
      const parts = sub.split('/config/');
      const tag = parts[0];
      const name = decodeURIComponent(parts[1] || '');

      const isDiversionTag = ['custom_cn', 'custom_non_cn', 'geoip_cn', 'geosite_cn', 'geosite_non_cn'].includes(tag);
      if (isDiversionTag) {
        let allSources = store.getDiversionSources();
        if (method === 'PUT') {
          const body = parseJsonBody(req);
          const idx = allSources.findIndex(s => s.tag === tag && (s.name === name || s.name === body.name || s.id === body.id));
          if (idx !== -1) {
            allSources[idx] = { ...allSources[idx], ...body, tag };
            store.setDiversionSources(allSources);
            DiversionEngine.get().reloadSubscriptions();
            return jsonResponse(allSources[idx]);
          } else {
            const newSource = {
              id: body.id || `div_${Date.now()}`,
              name: body.name || name || '新规则源',
              tag,
              url: body.url || '',
              format: body.format || 'txt',
              dataset: body.dataset,
              enabled: body.enabled !== false,
              auto_update: body.auto_update !== false,
              update_interval_hours: body.update_interval_hours || 24,
              rule_count: body.rule_count || 0,
              last_updated: body.last_updated || null,
              last_error: null,
            };
            allSources.push(newSource);
            store.setDiversionSources(allSources);
            DiversionEngine.get().reloadSubscriptions();
            return jsonResponse(newSource);
          }
        }
        if (method === 'DELETE') {
          allSources = allSources.filter(s => !(s.tag === tag && (s.name === name || s.id === name)));
          store.setDiversionSources(allSources);
          DiversionEngine.get().reloadSubscriptions();
          return jsonResponse({ success: true });
        }
      }
    }

    // 7. /plugins/:tag/config
    if (sub.endsWith('/config')) {
      const tag = sub.replace('/config', '');

      // Diversion sources config: /plugins/:tag/config
      const isDiversionTag = ['custom_cn', 'custom_non_cn', 'geoip_cn', 'geosite_cn', 'geosite_non_cn'].includes(tag);
      if (isDiversionTag) {
        const allSources = store.getDiversionSources();
        if (method === 'GET') {
          const matched = allSources.filter(s => s.tag === tag);
          return jsonResponse(matched);
        }
        if (method === 'POST') {
          const body = parseJsonBody(req);
          const idx = allSources.findIndex(s => s.id === body.id || s.name === body.name);
          if (idx !== -1) {
            allSources[idx] = { ...allSources[idx], ...body };
          } else {
            allSources.push({
              id: `div_${Date.now()}`,
              name: body.name || '新规则源',
              tag,
              url: body.url || '',
              format: body.format || 'txt',
              dataset: body.dataset,
              enabled: body.enabled !== false,
              auto_update: body.auto_update !== false,
              update_interval_hours: body.update_interval_hours || 24,
              rule_count: 0,
              last_updated: null,
              last_error: null,
            });
          }
          store.setDiversionSources(allSources);
          DiversionEngine.get().reloadSubscriptions();
          return jsonResponse({ success: true });
        }
      }

      // Switch config update: /plugins/switchX/config
      if (tag.startsWith('switch') && method === 'POST') {
        const body = parseJsonBody(req);
        const val = String(body.value || body || 'B').toUpperCase() === 'A' ? 'A' : 'B';
        store.setSwitch(tag as any, val);
        return jsonResponse({ success: true, tag, value: val });
      }

      // Local rule save: /plugins/whitelist/config, etc.
      if (method === 'POST') {
        const bodyStr = req.body.toRawString('utf-8');
        store.setRule(tag, bodyStr);
        DiversionEngine.get().reloadLocalRules();
        return jsonResponse({ success: true, count: store.getRule(tag).split('\n').filter(Boolean).length });
      }
    }

    // 6. /plugins/:tag/flush
    if (sub.endsWith('/flush') && method === 'POST') {
      const tag = sub.replace('/flush', '');
      const pool = CacheManager.get().getPool(tag);
      if (pool) {
        pool.clear();
      } else if (tag === 'cache_all' || tag === 'cache') {
        CacheManager.get().clearAll();
      }
      return jsonResponse({ success: true, message: `Cache ${tag} flushed` });
    }

    // 7. /plugins/:tag/update-all
    if (sub.endsWith('/update-all') && method === 'POST') {
      const tag = sub.replace('/update-all', '');
      const res = await DiversionEngine.get().updateAll(tag);
      return jsonResponse({
        success: true,
        failed: res.failed,
        dataset_required: 0,
        errors: res.errors,
      });
    }

    // 8. /plugins/:tag/update/:name
    if (sub.includes('/update/') && method === 'POST') {
      const parts = sub.split('/update/');
      const tag = parts[0];
      const name = decodeURIComponent(parts[1] || '');
      const sources = store.getDiversionSources();
      const s = sources.find(x => x.tag === tag && (x.name === name || x.id === name)) ||
                sources.find(x => x.name === name || x.id === name);
      if (s) {
        const res = await DiversionEngine.get().updateSource(s.id);
        return jsonResponse({
          success: res.success,
          changed: true,
          source: {
            name: s.name,
            tag: s.tag,
            rule_count: s.rule_count,
            last_updated: s.last_updated,
            detected_format: s.format || 'txt',
            enabled: s.enabled,
          },
        });
      }
      return jsonResponse({ error: 'Source not found' }, 404);
    }

    // 9. /plugins/:tag/config/:name (DELETE diversion source)
    if (sub.includes('/config/') && method === 'DELETE') {
      const parts = sub.split('/config/');
      const name = decodeURIComponent(parts[1] || '');
      let sources = store.getDiversionSources();
      sources = sources.filter(x => x.name !== name && x.id !== name);
      store.setDiversionSources(sources);
      DiversionEngine.get().reloadSubscriptions();
      return jsonResponse({ success: true });
    }

    return jsonResponse({ error: 'Plugin action not supported' }, 404);
  }
}
