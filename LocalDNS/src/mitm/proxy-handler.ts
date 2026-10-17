// HTTP / HTTPS Proxy & Stream Cleaning Pipeline Handler
import { Store } from '../store';
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
    const switches = Store.get().getSwitches();
    const isRewriteEnabled = switches.switch_rewrite !== 'B';

    let currentReq = { ...req, headers: { ...req.headers } };
    let matchedBodyReplace: { search: string; replace: string } | null = null;
    let rewriteActionSummary = '';

    // 1. 匹配重写/阻断规则 (Reject / Redirect / Mock / Header / Body)，受控于 switch_rewrite 开关
    if (isRewriteEnabled) {
      const rewriteMatch = moduleMgr.matchRewrite(url);
      if (rewriteMatch) {
        const { action, target, extra } = rewriteMatch;

        // 1.1 302/307 重定向 (支持 $1, $2 等正则捕获组替换)
        if (action === 'redirect' && target) {
          const targetUrl = url.replace(rewriteMatch.rule.regex, target);
          return {
            status: 302,
            headers: {
              'Location': targetUrl,
              'Connection': 'close',
            },
            body: '',
            intercepted: true,
            cleanAction: `redirect -> ${targetUrl}`,
          };
        }

        // 1.2 Mock 虚拟响应 (不发真实上游请求，直接返回指定状态码与内容)
        if (action === 'mock') {
          const statusCode = parseInt(target || '200', 10) || 200;
          const content = extra || '';
          const isJson =
            (content.startsWith('{') && content.endsWith('}')) ||
            (content.startsWith('[') && content.endsWith(']'));
          return {
            status: statusCode,
            headers: {
              'Content-Type': isJson ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
              'Content-Length': String(content.length),
              'X-LocalDNS-Mock': 'true',
            },
            body: content,
            intercepted: true,
            cleanAction: `mock (${statusCode})`,
          };
        }

        // 1.3 静态阻断 (204 / {} / [] / 1x1 GIF / 404)
        if (
          action === 'reject' ||
          action === 'reject-200' ||
          action === 'reject-img' ||
          action === 'reject-dict' ||
          action === 'reject-array'
        ) {
          const rej = StreamCleaner.getRejectResponse(action);
          return {
            status: rej.status,
            headers: rej.headers,
            body: rej.body,
            intercepted: true,
            cleanAction: action,
          };
        }

        // 1.4 请求 Header 修改与删除
        if (action === 'header-replace' && target) {
          currentReq.headers[target] = extra || '';
          rewriteActionSummary = `header-replace: ${target}`;
        } else if (action === 'header-del' && target) {
          delete currentReq.headers[target];
          delete currentReq.headers[target.toLowerCase()];
          rewriteActionSummary = `header-del: ${target}`;
        }

        // 1.5 响应 Body 替换标记
        if (action === 'body-replace' && target) {
          matchedBodyReplace = { search: target, replace: extra || '' };
          rewriteActionSummary = `body-replace: ${target}`;
        }
      }
    }

    // 2. 匹配并执行前置 Request 脚本
    const reqScripts = moduleMgr.matchScripts(url, 'http-request');
    for (const script of reqScripts) {
      try {
        const result = await ScriptSandbox.execute(script, { request: currentReq });
        if (result.modifiedRequest) {
          currentReq = {
            ...currentReq,
            ...result.modifiedRequest,
            headers: { ...currentReq.headers, ...(result.modifiedRequest.headers || {}) },
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

    // 4. 流清洗处理 (HLS M3U8 清单清洗 或 JSON 响应剪枝 或 正则 Body 替换)
    let cleanedBody = upstreamBody;
    const contentType = (upstreamHeaders['content-type'] || '').toLowerCase();

    // 4.1 执行正则/文本 Body 替换
    if (matchedBodyReplace) {
      try {
        cleanedBody = cleanedBody.replace(new RegExp(matchedBodyReplace.search, 'g'), matchedBodyReplace.replace);
      } catch {
        cleanedBody = cleanedBody.split(matchedBodyReplace.search).join(matchedBodyReplace.replace);
      }
    }

    // 4.2 执行流式 M3U8 清洗与 JSON 剪枝
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
      intercepted: Boolean(rewriteActionSummary),
      cleanAction: rewriteActionSummary || undefined,
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
