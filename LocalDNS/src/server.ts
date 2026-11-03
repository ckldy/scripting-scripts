import { Path, Script } from 'scripting';
import { Store } from './store';
import { CacheManager } from './cache';
import { AdGuardEngine } from './adguard';
import { DiversionEngine } from './diversion';
import { AuditManager } from './audit';
import { DnsResolver, cleanDomain } from './resolver';
import { SpeedChecker } from './speedcheck';
import { IpRulesEngine } from './ip-rules';
import { ClientRulesEngine } from './client-rules';
import { LocalRecordsEngine } from './records';
import { SurgeService } from './surge-service';
import { handleSurgeApiRequest } from './surge-api';
import { ProcessGuardian } from './guardian';
import { TrafficManager } from './traffic';
import { AdHunterService } from './ad-hunter';

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
      this.setupServerMiddleware(s, webDir, false);
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

    // Apply cache configuration and warm up persisted cache
    try {
      CacheManager.get().applyConfig(Store.get().getCacheConfig());
      CacheManager.get().loadFromStorage();
    } catch {}

    // Initialize Surge Service & SQLite database
    try {
      SurgeService.get().init().catch((e) => console.warn('[LocalDNS] SurgeService init error:', e));
    } catch (e) {
      console.warn('[LocalDNS] Failed to trigger SurgeService init:', e);
    }

    // 2. Start HTTPS DoH Server (default 9443, with TLS P12 for Surge and RFC 8484 HTTPS clients)
    this.isHttpsActive = false;
    if (FileManager.existsSync(p12Path)) {
      try {
        const tlsServer = new HttpServer();
        this.setupServerMiddleware(tlsServer, webDir, true);

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
    const webDir = Path.join(Script.directory, 'web');
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
      this.setupServerMiddleware(tlsServer, webDir, true);

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

  private setupServerMiddleware(server: HttpServer, webDir: string, isTls = false): void {

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

      // Native Apple Encrypted DNS configuration profile endpoint: /localdns.mobileconfig
      if ((path === '/localdns.mobileconfig' || path === '/apple-dns.mobileconfig') && method === 'GET') {
        const configXml = this.generateAppleDnsProfile(this.httpsPort);
        const bodyData = Data.fromRawString(configXml, 'utf-8');
        return HttpResponse.raw(200, 'OK', {
          headers: {
            'Content-Type': 'application/x-apple-aspen-config; charset=utf-8',
            'Content-Disposition': 'attachment; filename="LocalDNS.mobileconfig"',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
          },
          body: bodyData,
        });
      }

      // Redirect root to /ui/
      if (path === '/' || path === '/ui') {
        return HttpResponse.movedTemporarily('/ui/');
      }

      // 代理流量数据采集端点: custom/traffic.json 与 custom/traffic-detail.json
      if (
        path.includes('custom/traffic.json') ||
        path.includes('custom/traffic-detail.json') ||
        path === '/api/v1/traffic/detail' ||
        path === '/api/v1/traffic/summary'
      ) {
        const isDetail = path.includes('traffic-detail') || path.endsWith('/detail');
        if (isDetail) {
          const detail = await TrafficManager.get().getTrafficDetail();
          return jsonResponse(detail);
        } else {
          const summary = await TrafficManager.get().getTrafficSummary();
          return jsonResponse(summary);
        }
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

      // Built-in Surge scripts for modules: /scripts/*
      if (path.startsWith('/scripts/') && (method === 'GET' || method === 'HEAD')) {
        let sub = path.slice('/scripts/'.length).split('?')[0];
        if (sub && !sub.includes('..')) {
          const fullPath = Path.join(webDir, 'scripts', sub);
          if ((await FileManager.exists(fullPath)) && !(await FileManager.isDirectory(fullPath))) {
            const file = FileEntity.openForReading(fullPath);
            return HttpResponse.raw(200, 'OK', {
              headers: {
                'Content-Type': 'application/javascript; charset=utf-8',
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Access-Control-Allow-Origin': '*',
              },
              body: file,
            });
          }
        }
      }

      // CA Root Certificate download: /ca.crt
      if (path === '/ca.crt' && method === 'GET') {
        const caPath = Path.join(Script.directory, 'cert/ca.crt');
        if (FileManager.existsSync(caPath)) {
          const f = FileEntity.openForReading(caPath);
          return HttpResponse.raw(200, 'OK', {
            headers: {
              'Content-Type': 'application/x-x509-ca-cert',
              'Access-Control-Allow-Origin': '*',
            },
            body: f,
          });
        }
      }

      // DoH DNS-over-HTTPS endpoint: /dns-query
      if (path === '/dns-query') {
        return await this.handleDoh(req);
      }

      // Surge 统一调度模块与动态分流订阅
      if (
        path === '/surge/hub.sgmodule' ||
        path.startsWith('/surge/') ||
        path.startsWith('/rules/') ||
        path.startsWith('/api/v1/surge') ||
        path.startsWith('/api/v1/topology') ||
        path.startsWith('/api/v1/rules')
      ) {
        const surgeResp = await handleSurgeApiRequest(req, path, method);
        if (surgeResp) return surgeResp;
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

    // Explicit async route registrations to guarantee 100% routing match across Swifter engines
    server.registerAsyncHandler('/dns-query', async (req: HttpRequest) => {
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

    server.registerAsyncHandler('/api/resolve', async (req: HttpRequest) => {
      return await this.handleApi('/api/resolve', req.method.toUpperCase(), req);
    });

    const caPath = Path.join(Script.directory, 'cert/ca.crt');
    server.registerAsyncHandler('/ca.crt', async () => {
      if (FileManager.existsSync(caPath)) {
        const f = FileEntity.openForReading(caPath);
        return HttpResponse.raw(200, 'OK', {
          headers: { 'Content-Type': 'application/x-x509-ca-cert', 'Access-Control-Allow-Origin': '*' },
          body: f,
        });
      }
      return HttpResponse.notFound();
    });

    server.registerAsyncHandler('/metrics', async () => {
      const metrics = AuditManager.get().generatePrometheusMetrics();
      return textResponse(metrics, 200, 'text/plain; version=0.0.4; charset=utf-8');
    });

    server.registerAsyncHandler('/localdns.mobileconfig', async () => {
      const configXml = this.generateAppleDnsProfile(this.httpsPort);
      const bodyData = Data.fromRawString(configXml, 'utf-8');
      return HttpResponse.raw(200, 'OK', {
        headers: {
          'Content-Type': 'application/x-apple-aspen-config; charset=utf-8',
          'Content-Disposition': 'attachment; filename="LocalDNS.mobileconfig"',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
        },
        body: bodyData,
      });
    });

    server.registerAsyncHandler('/api/v1/system/vpn', async (req) => {
      return await this.handleApi('/api/v1/system/vpn', req.method.toUpperCase(), req);
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

  private reloadRuleEngines(): void {
    try { IpRulesEngine.get().reload(); } catch {}
    try { ClientRulesEngine.get().reload(); } catch {}
    try { LocalRecordsEngine.get().reload(); } catch {}
    try { DiversionEngine.get().reloadLocalRules(); } catch {}
  }

  private async handleApi(path: string, method: string, req: HttpRequest): Promise<HttpResponse> {
    const store = Store.get();
    const cleanPath = path.split('?')[0];

    // 0. 进程守护中枢与自愈: /api/v1/guardian/*
    if (cleanPath.startsWith('/api/v1/guardian')) {
      const guardian = ProcessGuardian.get();
      if (cleanPath === '/api/v1/guardian/status' && method === 'GET') {
        const s = await guardian.getStatus();
        return jsonResponse({ success: true, ...s });
      }
      if (cleanPath === '/api/v1/guardian/toggle' && method === 'POST') {
        const body = parseJsonBody(req);
        const en = body.enabled !== undefined ? Boolean(body.enabled) : true;
        guardian.setEnabled(en);
        const s = await guardian.getStatus();
        return jsonResponse({ success: true, ...s });
      }
      if (cleanPath === '/api/v1/guardian/heal' && method === 'POST') {
        const healed = await guardian.checkAndHeal();
        const s = await guardian.getStatus();
        return jsonResponse({ success: true, healed, ...s });
      }
    }

    // 1. /api/v1/status
    if (cleanPath === '/api/v1/status' && method === 'GET') {
      const detailedStats = AuditManager.get().getDetailedStats();
      const upstreamStats = AuditManager.get().getUpstreamStatsList();
      const fileCounts = DiversionEngine.get().getSourceFileCounts();
      const adCount = AdGuardEngine.get().getRuleCount();

      return jsonResponse({
        status: 'online',
        version: 'FJMOS',
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

    // FJMOS 分流刷新变化报告端点
    if (cleanPath === '/api/v1/route-refresh/changes' && method === 'GET') {
      return jsonResponse({ success: true, summary: null });
    }

    // 2. /api/v1/upstream/config
    if (path === '/api/v1/upstream/config') {
      if (method === 'GET') {
        return jsonResponse(store.getUpstreamConfig());
      }
      if (method === 'POST') {
        const body = parseJsonBody(req);
        // FJHAI / FJH7T 使用 group 字段，旧核心使用 plugin_tag；两者都接受。
        const group = body.group || body.plugin_tag;
        if (group && Array.isArray(body.upstreams)) {
          store.setUpstreamGroup(group, body.upstreams);
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

    // 6.5 /api/v1/audit/settings (custom audit log directory)
    if (path === '/api/v1/audit/settings') {
      const buildAuditStorage = () => {
        const dir = store.getAuditDir();
        const abs = dir.startsWith('/') ? dir : Path.join(Script.directory, dir);
        const logs: any = AuditManager.get().getLogs({ page: 1, limit: 1 });
        const entries =
          Number(logs?.pagination?.total_items) ||
          Number(logs?.total ?? logs?.totalCount) ||
          0;
        return {
          dir,
          path: abs,
          memory_fs: false,
          capacity: store.getAuditCapacity(),
          entries,
          memory_bytes: entries * 220,
          disk_bytes: 0,
        };
      };
      if (method === 'GET') return jsonResponse(buildAuditStorage());
      if (method === 'POST') {
        const body = parseJsonBody(req);
        const dir = String(body.dir || '').trim();
        if (!dir) return jsonResponse({ error: '日志目录不能为空' }, 400);
        store.setAuditDir(dir);
        return jsonResponse(buildAuditStorage());
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

      // Map internal AuditLogEntry -> upstream UI v2 contract.
      // UI strictly requires `answers` to be an array of records ({type,data,ttl}) and
      // uses query_name / client_ip / query_time / pagination.current_page.
      const mapAnswer = (value: string, qtypeName: string) => {
        const v = String(value);
        let type = qtypeName || 'A';
        if (/^\d{1,3}(\.\d{1,3}){3}$/.test(v)) type = 'A';
        else if (v.includes(':')) type = 'AAAA';
        else if (!/^\d+$/.test(v)) type = qtypeName === 'A' || qtypeName === 'AAAA' ? 'CNAME' : qtypeName;
        return { type, data: v, value: v, ttl: null };
      };
      const mapLog = (log: any) => ({
        // New UI fields
        query_name: log.domain,
        query_type: log.query_type,
        query_class: 'IN',
        client_ip: log.client,
        client_alias: log.client_alias,
        response_code: log.response_code,
        query_time: new Date((log.timestamp || 0) * 1000).toISOString(),
        answers: Array.isArray(log.answers)
          ? log.answers.map((a: string) => mapAnswer(a, log.query_type))
          : [],
        cache: typeof log.upstream_tag === 'string' && log.upstream_tag.startsWith('cache'),
        upstream_attempt: log.upstream_tag,
        // Preserve legacy fields for the native page / older clients
        id: log.id,
        time: log.time,
        timestamp: log.timestamp,
        domain: log.domain,
        client: log.client,
        domain_set: log.domain_set,
        duration_ms: log.duration_ms,
        upstream_tag: log.upstream_tag,
        trace_id: log.trace_id,
      });

      return jsonResponse({
        logs: logsResult.logs.map(mapLog),
        filters: logsResult.filters,
        pagination: {
          current_page: logsResult.pagination.page,
          total_pages: logsResult.pagination.total_pages,
          total_items: logsResult.pagination.total_items,
          page: logsResult.pagination.page,
          limit: logsResult.pagination.limit,
        },
      });
    }

    // 11. /api/v1/system/restart
    if (path === '/api/v1/system/restart' && method === 'POST') {
      // Simulate quick reboot
      setTimeout(() => {
        CacheManager.get().clearAll();
      }, 300);
      return jsonResponse({ success: true, message: 'Restart scheduled' });
    }

    // 11.5 /api/v1/lists/:name (FJHAI 国外 IP 段 foreign_cidrs 与各类名单兼容)
    if (cleanPath.startsWith('/api/v1/lists/')) {
      const listName = cleanPath.replace('/api/v1/lists/', '');
      const listTagMap: Record<string, string> = {
        foreign_cidrs: 'foreign_ip',
        direct_cidrs: 'direct_ip',
        clients: 'client_ip',
        realip: 'force_realip',
        ddns: 'ddns_domains',
        pcdn: 'pcdn_domains',
        pcdn_v4: 'pcdn_regex_v4',
        pcdn_v6: 'pcdn_regex_v6',
      };
      const ruleTag = listTagMap[listName] || listName;
      if (method === 'GET') {
        const text = store.getRule(ruleTag);
        return textResponse(text);
      }
      if (method === 'PUT' || method === 'POST') {
        const body = parseJsonBody(req);
        let content = '';
        if (typeof body === 'string') {
          content = body;
        } else if (Array.isArray(body)) {
          content = body.join('\n');
        } else if (Array.isArray(body?.values)) {
          content = body.values.join('\n');
        } else if (typeof body?.content === 'string') {
          content = body.content;
        }
        store.setRule(ruleTag, content);
        this.reloadRuleEngines();
        return jsonResponse({ success: true, count: content.split('\n').filter(Boolean).length });
      }
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

    // 14. /api/v1/system/vpn (Scripting 原生系统级 VPN 控制与状态透视)
    if (cleanPath === '/api/v1/system/vpn') {
      if (method === 'GET') {
        try {
          const vpnState = typeof VPN !== 'undefined' ? await VPN.getState() : { status: 'unsupported', active: false };
          return jsonResponse({ success: true, vpn: vpnState });
        } catch (e: any) {
          return jsonResponse({ success: false, error: e.message }, 500);
        }
      }
      if (method === 'POST') {
        const body = parseJsonBody(req);
        const action = body.action || 'toggle';
        try {
          if (typeof VPN === 'undefined') {
            return jsonResponse({ error: 'VPN API not available in current environment' }, 501);
          }
          let nextState: any;
          if (action === 'start') {
            nextState = await VPN.start();
          } else if (action === 'stop') {
            nextState = await VPN.stop();
          } else {
            const cur = await VPN.getState();
            if (cur.active || cur.status === 'connected') {
              nextState = await VPN.stop();
            } else {
              nextState = await VPN.start();
            }
          }
          return jsonResponse({ success: true, vpn: nextState });
        } catch (e: any) {
          return jsonResponse({ success: false, error: e.message }, 500);
        }
      }
    }

    // 29. /api/proxy-config/... (Upstream UI 2026.10.18.19 配置管理与备份协同服务)
    if (cleanPath.startsWith('/api/proxy-config')) {
      const subConfigPath = cleanPath.replace('/api/proxy-config', '');

      // 代理配置编辑器兼容层：上游 UI 2026.11.01.1 要求核心同时提供
      // available / exists / mode / path / roots，且读取结果必须带 path/revision。
      // LocalDNS 不启动 mihomo / sing-box，这里提供两份可编辑的本地虚拟配置，
      // 保存只写入 Storage，不会启动或重载任何代理核心。
      const proxyCores = [
        { id: 'mihomo', name: 'Mihomo', format: 'YAML', mode: 'file', path: '/configs/mihomo/config.yaml', directory: '/configs/mihomo', roots: ['/configs'] },
        { id: 'sing-box', name: 'sing-box', format: 'JSON', mode: 'file', path: '/configs/sing-box/config.json', directory: '/configs/sing-box', roots: ['/configs'] },
      ];
      const proxySeeds: Record<string, string> = {
        'mihomo': [
          '# LocalDNS 本地代理配置模板',
          '# 仅保存在 LocalDNS 内，不会启动或重载代理核心。',
          'mixed-port: 7890',
          'allow-lan: false',
          'mode: rule',
          'log-level: warning',
          'proxies: []',
          'proxy-groups:',
          '  - name: PROXY',
          '    type: select',
          '    proxies:',
          '      - DIRECT',
          'rules:',
          '  - MATCH,DIRECT',
        ].join('\n'),
        'sing-box': JSON.stringify({
          log: { level: 'warn' },
          inbounds: [],
          outbounds: [{ type: 'direct', tag: 'direct' }],
          route: { final: 'direct' },
        }, null, 2),
      };
      const proxyKey = (id: string) => `proxy_config_${id}`;
      const proxyRevKey = (id: string) => `proxy_config_${id}_revision`;
      const readProxyContent = (id: string): string => {
        const stored = Storage.get<string>(proxyKey(id));
        return typeof stored === 'string' ? stored : (proxySeeds[id] || '');
      };
      const proxyRevision = (id: string): string => String(Storage.get<string>(proxyRevKey(id)) || '1');
      const writeProxyContent = (id: string, content: string): string => {
        Storage.set(proxyKey(id), content);
        const revision = String(Date.now());
        Storage.set(proxyRevKey(id), revision);
        return revision;
      };
      const getConfigParam = (key: string) => {
        const raw = req.queryParams?.find((p) => p.key === key)?.value || '';
        try {
          return decodeURIComponent(raw);
        } catch {
          return raw;
        }
      };

      // 29.1 /api/proxy-config/interface/:section (名称、Logo、代理面板地址持久化)
      if (subConfigPath.startsWith('/interface/')) {
        const section = subConfigPath.replace('/interface/', '').trim();
        if (method === 'GET') {
          const setting = store.getInterfaceSetting(section);
          return jsonResponse({
            value: setting ? setting.value : null,
            revision: setting ? String(setting.revision) : '0',
          });
        }
        if (method === 'POST') {
          const body = parseJsonBody(req);
          const updated = store.setInterfaceSetting(section, body.value);
          return jsonResponse({
            value: updated.value,
            revision: String(updated.revision),
          });
        }
      }

      // 29.2 /api/proxy-config/rule-backups (名单工作台备份与历史恢复)
      if (subConfigPath === '/rule-backups' || subConfigPath === '/rule-backups/') {
        const getParam = (key: string) => req.queryParams?.find((p) => p.key === key)?.value;
        const tag = getParam('tag') || '';
        const id = getParam('id');

        if (method === 'GET') {
          if (id) {
            const backup = store.getRuleBackupContent(tag, id);
            if (backup) {
              return jsonResponse(backup);
            }
            return jsonResponse({ error: 'Backup not found' }, 404);
          }
          const list = store.getRuleBackups(tag);
          return jsonResponse({ backups: list });
        }
        if (method === 'POST') {
          const body = parseJsonBody(req);
          const targetTag = body.tag || tag;
          const content = body.content || '';
          if (!targetTag) {
            return jsonResponse({ error: 'Missing tag parameter' }, 400);
          }
          const backup = store.addRuleBackup(targetTag, content);
          return jsonResponse({ saved: true, backup });
        }
      }

      // 29.3 /api/proxy-config/traffic (服务器采样吞吐量时序记录)
      if (subConfigPath === '/traffic' || subConfigPath === '/traffic/') {
        const getParam = (key: string) => req.queryParams?.find((p) => p.key === key)?.value;
        const minutes = Number(getParam('minutes')) || 60;
        const history = AuditManager.get().getTrafficHistory(minutes);
        return jsonResponse(history);
      }

      // 29.4 /api/proxy-config/cores (可用核心列表)
      if (subConfigPath === '/cores' || subConfigPath === '/cores/') {
        return jsonResponse({
          cores: proxyCores.map((core) => ({
            ...core,
            available: true,
            exists: true,
            active: false,
          })),
        });
      }

      // 29.5 /api/proxy-config/files (配置文件浏览)
      if (subConfigPath === '/files' || subConfigPath === '/files/') {
        const requested = getConfigParam('path') || '/configs';
        if (requested === '/configs' || requested === '/configs/') {
          return jsonResponse({
            directory: '/configs',
            files: proxyCores.map((core) => ({
              name: core.id,
              path: core.directory,
              directory: true,
              active: false,
              size: 0,
              modified: 0,
            })),
          });
        }
        const core = proxyCores.find((item) => requested === item.directory || requested.startsWith(item.directory + '/'));
        if (!core) {
          return jsonResponse({ error: 'Directory not allowed' }, 403);
        }
        const content = readProxyContent(core.id);
        return jsonResponse({
          directory: core.directory,
          files: [{
            name: core.path.split('/').pop(),
            path: core.path,
            directory: false,
            active: false,
            size: content.length,
            modified: Date.now(),
          }],
        });
      }

      // 29.6 /api/proxy-config/read
      if (subConfigPath === '/read' && method === 'POST') {
        const body = parseJsonBody(req);
        const core = proxyCores.find((item) => item.id === body.core);
        if (!core) {
          return jsonResponse({ error: 'Unknown core' }, 404);
        }
        const path = body.path || core.path;
        if (path !== core.path) {
          return jsonResponse({ error: 'Config path not allowed' }, 403);
        }
        return jsonResponse({
          core: core.id,
          path,
          content: readProxyContent(core.id),
          revision: proxyRevision(core.id),
          active: false,
          mode: 'file',
          groupCount: 0,
          groupRevision: '',
        });
      }

      // 29.7 /api/proxy-config/check
      if (subConfigPath === '/check' && method === 'POST') {
        const body = parseJsonBody(req);
        if (body.core === 'sing-box' && typeof body.content === 'string') {
          try {
            JSON.parse(body.content);
          } catch (e: any) {
            return jsonResponse({ ok: false, detail: 'JSON 语法错误：' + e.message }, 200);
          }
        }
        return jsonResponse({ ok: true, detail: '本地虚拟配置校验通过；保存不会启动或重载代理核心。' });
      }

      // 29.8 /api/proxy-config/save
      if (subConfigPath === '/save' && method === 'POST') {
        const body = parseJsonBody(req);
        const core = proxyCores.find((item) => item.id === body.core);
        if (!core) {
          return jsonResponse({ error: 'Unknown core' }, 404);
        }
        if (body.path && body.path !== core.path) {
          return jsonResponse({ error: 'Config path not allowed' }, 403);
        }
        const revision = writeProxyContent(core.id, typeof body.content === 'string' ? body.content : '');
        return jsonResponse({
          ok: true,
          revision,
          unchanged: false,
          confirmation: 'saved-only',
          reloaded: false,
          backup: null,
        });
      }

      // 29.9 /api/proxy-config/fetch (HTTP 配置导入)
      if (subConfigPath === '/fetch' && method === 'POST') {
        const body = parseJsonBody(req);
        if (!body.url) {
          return jsonResponse({ error: 'Missing url' }, 400);
        }
        let target: URL;
        try {
          target = new URL(String(body.url));
        } catch {
          return jsonResponse({ error: 'Invalid url' }, 400);
        }
        if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) {
          return jsonResponse({ error: 'Only http(s) URLs without credentials are allowed' }, 400);
        }
        try {
          const res = await fetch(target.href, { headers: { 'User-Agent': 'LocalDNS/FJMOS' } });
          if (!res.ok) {
            return jsonResponse({ error: `HTTP ${res.status}` }, 502);
          }
          const content = await res.text();
          if (content.length > 2 * 1024 * 1024) {
            return jsonResponse({ error: 'Config too large' }, 413);
          }
          return jsonResponse({ content, sourceHost: target.host });
        } catch (e: any) {
          return jsonResponse({ error: e?.message || 'Fetch failed' }, 502);
        }
      }

      // 29.10 /api/proxy-config 根信息
      return jsonResponse({
        status: 'online',
        version: '1.6.0',
        service: 'LocalDNS Config协同服务',
        features: ['interface', 'rule-backups', 'traffic', 'cores', 'files', 'read', 'save', 'check', 'fetch']
      });
    }

    // 30. /api/v1/speed/config (测速选优配置)
    if (cleanPath === '/api/v1/speed/config') {
      if (method === 'GET') {
        return jsonResponse({ ...store.getSpeedConfig(), stats: AuditManager.get().getSpeedStats() });
      }
      if (method === 'POST') {
        const body = parseJsonBody(req);
        const cfg = store.setSpeedConfig(body);
        return jsonResponse({ success: true, config: cfg });
      }
    }

    // 30.1 /api/v1/speed/test (单 IP 测速)
    if (cleanPath === '/api/v1/speed/test' && method === 'GET') {
      const getParam = (k: string) => req.queryParams.find(p => p.key === k)?.value;
      const ip = getParam('ip') || '';
      if (!ip) return jsonResponse({ error: 'Missing ip' }, 400);
      const mode = getParam('mode') || store.getSpeedConfig().mode;
      const rtt = await SpeedChecker.get().measure(ip, mode, store.getSpeedConfig().timeoutMs);
      return jsonResponse({ ip, mode, rtt, ok: rtt !== null });
    }

    // 31. /api/v1/cache/config (缓存调优)
    if (cleanPath === '/api/v1/cache/config') {
      if (method === 'GET') {
        return jsonResponse(store.getCacheConfig());
      }
      if (method === 'POST') {
        const body = parseJsonBody(req);
        const cfg = store.setCacheConfig(body);
        CacheManager.get().applyConfig(cfg);
        return jsonResponse({ success: true, config: cfg });
      }
    }

    // 32. /api/v1/dns64/config (DNS64)
    if (cleanPath === '/api/v1/dns64/config') {
      if (method === 'GET') {
        return jsonResponse(store.getDns64Config());
      }
      if (method === 'POST') {
        const body = parseJsonBody(req);
        return jsonResponse({ success: true, config: store.setDns64Config(body) });
      }
    }

    // 33. /api/v1/named-sets (domain-set / ip-set 命名集合)
    if (cleanPath === '/api/v1/named-sets') {
      if (method === 'GET') {
        return jsonResponse(store.getNamedSets());
      }
      if (method === 'POST') {
        const body = parseJsonBody(req);
        const sets = store.setNamedSets(body);
        this.reloadRuleEngines();
        return jsonResponse({ success: true, sets });
      }
    }

    // 34. /api/v1/rule-engines/reload (立即重载 IP/客户端/记录规则)
    if (cleanPath === '/api/v1/rule-engines/reload' && method === 'POST') {
      this.reloadRuleEngines();
      return jsonResponse({ success: true });
    }

    // 35. /api/v1/ad-hunter/* (AdHunter 智能去广告实验室)
    if (cleanPath.startsWith('/api/v1/ad-hunter')) {
      const adHunter = AdHunterService.get();

      // 35.1 快速预设列表
      if (cleanPath === '/api/v1/ad-hunter/presets' && method === 'GET') {
        return jsonResponse({
          success: true,
          presets: [
            {
              name: '黑料网 (吃瓜类首页)',
              url: 'https://i4p76.sancpkvy.cc/',
              type: 'heiliao',
              desc: '自研 PGX-Slot 广告引擎、15+ 混排伪装卡片、18禁年龄弹窗、虚假底部导航',
            },
            {
              name: '黑料网 (爆料详情页)',
              url: 'https://i4p76.sancpkvy.cc/archives/123759/',
              type: 'heiliao',
              desc: '正文密集 40+ 条博彩色情文字矩阵、底部组合大横幅、虚假社交引流图标',
            },
            {
              name: 'Javtiful (成人视频点播)',
              url: 'https://javtiful.com/zh/video/115315/ipzz-995-reducing-mosaic',
              type: 'javtiful',
              desc: '播放器正上方悬浮遮罩广告、顶部文字横幅、假直播引流轮播区',
            },
          ],
        });
      }

      // 35.2 深度分析 URL 页面特征
      if (cleanPath === '/api/v1/ad-hunter/analyze' && method === 'POST') {
        const body = parseJsonBody(req);
        const targetUrl = String(body.url || '').trim();
        if (!targetUrl) return jsonResponse({ error: '请输入有效的目标网址' }, 400);
        try {
          const report = await adHunter.analyzeUrl(targetUrl);
          return jsonResponse({ success: true, report });
        } catch (e: any) {
          return jsonResponse({ error: e?.message || '分析网页广告失败' }, 502);
        }
      }

      // 35.3 一键下发至 Surge / LocalDNS
      if (cleanPath === '/api/v1/ad-hunter/deploy-surge' && method === 'POST') {
        const body = parseJsonBody(req);
        if (!body.report) return jsonResponse({ error: 'Missing report data' }, 400);
        try {
          const res = await adHunter.deployToSurge(body.report);
          return jsonResponse(res);
        } catch (e: any) {
          return jsonResponse({ error: e?.message || '部署至 Surge 失败' }, 500);
        }
      }

      // 35.4 一键安装至 Safari 扩展 Userscript 目录
      if (cleanPath === '/api/v1/ad-hunter/deploy-userscript' && method === 'POST') {
        const body = parseJsonBody(req);
        const fileName = String(body.fileName || 'adhunter-custom').trim();
        const content = String(body.content || '').trim();
        if (!content) return jsonResponse({ error: '脚本内容不能为空' }, 400);
        try {
          const res = await adHunter.deployToUserscript(fileName, content);
          return jsonResponse(res);
        } catch (e: any) {
          return jsonResponse({ error: e?.message || '保存脚本失败' }, 500);
        }
      }

      // 35.5 全端自动化合流：网络层注入 Surge + DOM特征直接合并入 AdBlockHub 全局母核
      if (cleanPath === '/api/v1/ad-hunter/auto-sync' && method === 'POST') {
        const body = parseJsonBody(req);
        if (!body.report) return jsonResponse({ error: 'Missing report data' }, 400);
        try {
          const res = await adHunter.autoSyncToHub(body.report);
          return jsonResponse(res);
        } catch (e: any) {
          return jsonResponse({ error: e?.message || '全端自动合流失败' }, 500);
        }
      }
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
      this.reloadRuleEngines();
      return jsonResponse({ success: true, count: values.length });
    }

    // 6. /plugins/:tag/config/:name (PUT to update/toggle diversion rule, DELETE to remove)
    if (sub.includes('/config/')) {
      const parts = sub.split('/config/');
      const tag = parts[0];
      const name = decodeURIComponent(parts[1] || '');

      const isDiversionTag = ['custom_cn', 'custom_non_cn', 'geoip_cn', 'geoip_non_cn', 'geosite_cn', 'geosite_non_cn'].includes(tag);
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
      const isDiversionTag = ['custom_cn', 'custom_non_cn', 'geoip_cn', 'geoip_non_cn', 'geosite_cn', 'geosite_non_cn'].includes(tag);
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

  private generateAppleDnsProfile(httpsPort: number): string {
    const serverUrl = `https://localdns.local:${httpsPort}/dns-query`;

    let caBase64 = '';
    const caPath = Path.join(Script.directory, 'cert/ca.crt');
    try {
      if (FileManager.existsSync(caPath)) {
        const rawCert = FileManager.readAsStringSync(caPath);
        caBase64 = rawCert
          .replace(/-----BEGIN CERTIFICATE-----/g, '')
          .replace(/-----END CERTIFICATE-----/g, '')
          .replace(/[\r\n\s]/g, '');
      }
    } catch {}

    const caPayload = caBase64 ? `
        <dict>
            <key>PayloadCertificateFileName</key>
            <string>LocalDNS-Root-CA.crt</string>
            <key>PayloadContent</key>
            <data>
                ${caBase64}
            </data>
            <key>PayloadDescription</key>
            <string>LocalDNS 安全根证书，用于系统级加密 DNS 安全握手与防篡改验证</string>
            <key>PayloadDisplayName</key>
            <string>LocalDNS Root CA</string>
            <key>PayloadIdentifier</key>
            <string>com.localdns.apple.ca</string>
            <key>PayloadType</key>
            <string>com.apple.security.root</string>
            <key>PayloadUUID</key>
            <string>C516805E-B561-4FA5-900E-6F47963C8159</string>
            <key>PayloadVersion</key>
            <integer>1</integer>
        </dict>` : '';

    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>PayloadContent</key>
    <array>${caPayload}
        <dict>
            <key>DNSSettings</key>
            <dict>
                <key>DNSProtocol</key>
                <string>HTTPS</string>
                <key>ServerAddresses</key>
                <array>
                    <string>127.0.0.1</string>
                </array>
                <key>ServerURL</key>
                <string>${serverUrl}</string>
            </dict>
            <key>PayloadDescription</key>
            <string>LocalDNS iOS 原生系统级 Encrypted DNS (DoH) 纯净去广告与防追踪配置</string>
            <key>PayloadDisplayName</key>
            <string>LocalDNS 原生纯净加密 DNS</string>
            <key>PayloadIdentifier</key>
            <string>com.localdns.apple.dns.managed</string>
            <key>PayloadType</key>
            <string>com.apple.dnsSettings.managed</string>
            <key>PayloadUUID</key>
            <string>8F2C7480-323A-4217-A186-0D5303E48C5B</string>
            <key>PayloadVersion</key>
            <integer>1</integer>
        </dict>
    </array>
    <key>PayloadDescription</key>
    <string>LocalDNS 原生系统级纯净 DNS 配置，零外挂、零耗电，全局自动拦截 18.5 万条广告与恶意追踪域名。</string>
    <key>PayloadDisplayName</key>
    <string>LocalDNS 原生纯净加密 DNS</string>
    <key>PayloadIdentifier</key>
    <string>com.localdns.apple.profile</string>
    <key>PayloadOrganization</key>
    <string>LocalDNS</string>
    <key>PayloadRemovalDisallowed</key>
    <false/>
    <key>PayloadType</key>
    <string>Configuration</string>
    <key>PayloadUUID</key>
    <string>7A14486E-6F39-44F4-9C78-592DB96DF026</string>
    <key>PayloadVersion</key>
    <integer>1</integer>
</dict>
</plist>`;
  }
}
