// HTTP / HTTPS Proxy & Stream Cleaning Pipeline Handler
import { ModuleManager } from '../modules/module-manager';
import { StreamCleaner } from '../stream/cleaner';
import { ScriptSandbox } from '../runtime/sandbox';
import type { SandboxContext } from '../runtime/sandbox';

export interface ProxyIncomingRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

export interface ProxyOutgoingResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  intercepted?: boolean;
  cleanAction?: string;
}

export class ProxyHandler {
  private static instance: ProxyHandler;

  private constructor() {}

  static get(): ProxyHandler {
    if (!ProxyHandler.instance) {
      ProxyHandler.instance = new ProxyHandler();
    }
    return ProxyHandler.instance;
  }

  /**
   * 处理 HTTP 请求流经模块引擎全生命周期
   */
  async processRequest(req: ProxyIncomingRequest): Promise<ProxyOutgoingResponse> {
    const url = req.url;
    const moduleMgr = ModuleManager.get();

    // 1. 匹配重写/阻断规则 (Reject / Redirect)
    const rewriteMatch = moduleMgr.matchRewrite(url);
    if (rewriteMatch) {
      const { action, target } = rewriteMatch;
      if (action === 'redirect' && target) {
        return {
          status: 302,
          headers: {
            'Location': target,
            'Connection': 'close',
          },
          body: '',
          intercepted: true,
          cleanAction: `redirect -> ${target}`,
        };
      }

      // 返回对应的 Reject 伪装内容 (204 / {} / 1x1 GIF / [])
      const rej = StreamCleaner.getRejectResponse(action);
      return {
        status: rej.status,
        headers: rej.headers,
        body: rej.body,
        intercepted: true,
        cleanAction: action,
      };
    }

    // 2. 匹配并执行前置 Request 脚本
    let currentReq = { ...req };
    const reqScripts = moduleMgr.matchScripts(url, 'http-request');
    for (const script of reqScripts) {
      try {
        const result = await ScriptSandbox.execute(script, { request: currentReq });
        if (result.modifiedRequest) {
          currentReq = {
            ...currentReq,
            ...result.modifiedRequest,
          };
        }
      } catch (err) {
        console.error(`[ProxyHandler] Request script ${script.name} error:`, err);
      }
    }

    // 3. 向上游真实服务器发起请求
    let upstreamStatus = 200;
    let upstreamHeaders: Record<string, string> = {};
    let upstreamBody = '';

    try {
      const fetchHeaders = { ...currentReq.headers };
      // 避免 host / content-length 头冲突
      delete fetchHeaders['host'];
      delete fetchHeaders['content-length'];

      const res = await fetch(currentReq.url, {
        method: currentReq.method,
        headers: fetchHeaders,
        body: currentReq.method !== 'GET' && currentReq.method !== 'HEAD' ? currentReq.body : undefined,
      });

      upstreamStatus = res.status;
      if (res.headers && typeof res.headers.entries === 'function') {
        upstreamHeaders = Object.fromEntries(res.headers.entries());
      }
      upstreamBody = await res.text();
    } catch (err: any) {
      return {
        status: 502,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        body: `Bad Gateway: ${err.message || 'Upstream connection error'}`,
        intercepted: false,
      };
    }

    // 4. 流清洗处理 (HLS M3U8 清单清洗 或 JSON 响应剪枝)
    let cleanedBody = upstreamBody;
    const contentType = (upstreamHeaders['content-type'] || '').toLowerCase();

    if (
      url.includes('.m3u8') ||
      contentType.includes('mpegurl') ||
      contentType.includes('application/x-mpegurl') ||
      contentType.includes('application/vnd.apple.mpegurl')
    ) {
      cleanedBody = StreamCleaner.cleanM3U8(cleanedBody, url);
    } else if (
      contentType.includes('json') ||
      url.includes('/youtubei/v1/player') ||
      (cleanedBody.startsWith('{') && cleanedBody.endsWith('}'))
    ) {
      cleanedBody = StreamCleaner.cleanJSON(cleanedBody, url);
    }

    // 5. 匹配并执行后置 Response 脚本
    let currentResp: ProxyOutgoingResponse = {
      status: upstreamStatus,
      headers: upstreamHeaders,
      body: cleanedBody,
    };

    const respScripts = moduleMgr.matchScripts(url, 'http-response');
    for (const script of respScripts) {
      try {
        const sandboxCtx: SandboxContext = {
          request: currentReq,
          response: {
            status: currentResp.status,
            statusCode: currentResp.status,
            headers: currentResp.headers,
            body: currentResp.body,
          },
        };
        const result = await ScriptSandbox.execute(script, sandboxCtx);
        if (result.modifiedResponse) {
          currentResp = {
            status: result.modifiedResponse.status || currentResp.status,
            headers: result.modifiedResponse.headers || currentResp.headers,
            body: result.modifiedResponse.body !== undefined ? result.modifiedResponse.body : currentResp.body,
            intercepted: true,
            cleanAction: `script: ${script.name}`,
          };
        }
      } catch (err) {
        console.error(`[ProxyHandler] Response script ${script.name} error:`, err);
      }
    }

    return currentResp;
  }
}
