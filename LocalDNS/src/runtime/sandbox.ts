// Surge / Loon / Quantumult X Compatible JavaScript Runtime Sandbox
import type { CleanScriptRule } from '../modules/types';

export interface SandboxRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

export interface SandboxResponse {
  status: number;
  statusCode?: number;
  headers: Record<string, string>;
  body?: string;
}

export interface SandboxContext {
  request: SandboxRequest;
  response?: SandboxResponse;
}

export interface SandboxExecutionResult {
  modifiedRequest?: SandboxRequest;
  modifiedResponse?: SandboxResponse;
  aborted?: boolean;
  error?: string;
}

export class ScriptSandbox {
  /**
   * 执行外部脚本并等待 $done() 返回结果
   */
  static async execute(
    script: CleanScriptRule,
    context: SandboxContext
  ): Promise<SandboxExecutionResult> {
    const code = script.scriptContent;
    if (!code) {
      return {};
    }

    const timeoutMs = (script.timeout || 5) * 1000;

    return new Promise((resolve) => {
      let isDone = false;
      const timer = setTimeout(() => {
        if (!isDone) {
          isDone = true;
          // 超时保底降级放行，不影响业务
          resolve({});
        }
      }, timeoutMs);

      const finish = (result: SandboxExecutionResult) => {
        if (isDone) return;
        isDone = true;
        clearTimeout(timer);
        resolve(result);
      };

      // 1. $done 函数实现 (Surge / Loon / QX 三合一重载)
      const $done = (data?: any) => {
        if (!data || typeof data !== 'object') {
          return finish({});
        }

        // QX: $done({ response: { status, headers, body } })
        if (data.response) {
          return finish({
            modifiedResponse: {
              status: data.response.status || data.response.statusCode || 200,
              statusCode: data.response.status || data.response.statusCode || 200,
              headers: data.response.headers || {},
              body: data.response.body,
            },
          });
        }

        // Surge/Loon http-response: $done({ status, headers, body })
        if (data.status !== undefined || data.statusCode !== undefined || data.body !== undefined) {
          const respStatus = data.status || data.statusCode || (context.response ? context.response.status : 200);
          return finish({
            modifiedResponse: {
              status: respStatus,
              statusCode: respStatus,
              headers: data.headers || (context.response ? context.response.headers : {}),
              body: data.body !== undefined ? data.body : context.response?.body,
            },
          });
        }

        // Surge/Loon http-request: $done({ url, headers, body })
        if (data.url || data.headers || data.body !== undefined) {
          return finish({
            modifiedRequest: {
              url: data.url || context.request.url,
              method: context.request.method,
              headers: data.headers || context.request.headers,
              body: data.body !== undefined ? data.body : context.request.body,
            },
          });
        }

        finish({});
      };

      // 2. $httpClient 实现
      const $httpClient = {
        get: (options: any, callback: Function) => this.performHttp('GET', options, callback),
        post: (options: any, callback: Function) => this.performHttp('POST', options, callback),
        put: (options: any, callback: Function) => this.performHttp('PUT', options, callback),
        delete: (options: any, callback: Function) => this.performHttp('DELETE', options, callback),
        head: (options: any, callback: Function) => this.performHttp('HEAD', options, callback),
      };

      // 3. $persistentStore 实现
      const $persistentStore = {
        read: (key: string): string | null => {
          try {
            if (typeof Storage !== 'undefined') {
              const val = Storage.get(`mod_store_${key}`);
              return typeof val === 'string' ? val : (val ? JSON.stringify(val) : null);
            }
          } catch {}
          return null;
        },
        write: (val: string, key: string): boolean => {
          try {
            if (typeof Storage !== 'undefined') {
              return Storage.set(`mod_store_${key}`, val);
            }
          } catch {}
          return false;
        },
      };

      // 4. $notification 与 QX $notify 实现
      const $notification = {
        post: (title: string, subTitle: string, detail: string) => {
          console.log(`[Script Notification] ${title} | ${subTitle} | ${detail}`);
        },
      };

      // 5. Quantumult X $prefs 与工具
      const $prefs = {
        valueForKey: (k: string) => $persistentStore.read(k),
        setValueForKey: (v: string, k: string) => $persistentStore.write(v, k),
      };

      // 组装注入沙箱环境
      const scope: Record<string, any> = {
        $request: { ...context.request },
        $response: context.response ? { ...context.response, statusCode: context.response.status } : undefined,
        $done,
        $httpClient,
        $persistentStore,
        $notification,
        $prefs,
        $notify: (title: string, sub: string, msg: string) => $notification.post(title, sub, msg),
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        console,
        JSON,
        Math,
        Date,
        RegExp,
        Array,
        Object,
        String,
        Number,
        Boolean,
        Promise,
      };

      try {
        const paramNames = Object.keys(scope);
        const paramValues = Object.values(scope);
        // 使用 Function 构造独立上下文
        const runner = new Function(...paramNames, `"use strict";\n${code}`);
        runner(...paramValues);
      } catch (err: any) {
        console.error(`[Sandbox Execution Error] ${script.name}:`, err);
        finish({ error: err.message });
      }
    });
  }

  private static async performHttp(method: string, options: any, callback: Function): Promise<void> {
    const url = typeof options === 'string' ? options : options.url;
    const headers = typeof options === 'object' && options.headers ? options.headers : {};
    const body = typeof options === 'object' ? options.body : undefined;

    try {
      const res = await fetch(url, {
        method,
        headers,
        body,
      });
      const text = await res.text();
      const respObj = {
        status: res.status,
        statusCode: res.status,
        headers: Object.fromEntries(res.headers ? res.headers.entries() : []),
      };
      if (typeof callback === 'function') {
        callback(null, respObj, text);
      }
    } catch (err: any) {
      if (typeof callback === 'function') {
        callback(err.message, null, null);
      }
    }
  }
}
