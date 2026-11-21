/**
 * 寒霜真流式 TCP 引擎（独占端口版）
 * ------------------------------------------------------------------
 * 只负责一件事：用 node:net 原生 Socket 承载 stream:true 的 SSE 推送，
 * 让 Assistant.requestStreaming 的每个 chunk 毫秒级直达客户端。
 *
 * 与 5190 主网关（HttpServer）完全解耦：
 *  - 不做任何向 HttpServer 的转发，因此不可能出现上次的管道死锁；
 *  - 启动失败也不影响 5190 主网关；
 *  - 非流式请求直接返回 JSON 提示改用 5190。
 */

// @ts-ignore
const net = require("node:net");

export interface StreamRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: any;
}

export interface StreamEngineOptions {
  /** 本引擎独占的对外端口，例如 5195 */
  port: number;
  /** 主网关端口，仅用于在错误提示里告诉客户端该去哪里 */
  mainGatewayPort: number;
  /** 真正产出 SSE 的回调（由 index.tsx 注入 handleStreamChatCompletions） */
  onStreamRequest: (
    req: StreamRequest,
    writeChunk: (data: string) => void,
    close: () => void
  ) => Promise<void>;
}

function jsonResponse(status: number, phrase: string, obj: any): string {
  const body = JSON.stringify(obj);
  return [
    `HTTP/1.1 ${status} ${phrase}`,
    "Content-Type: application/json; charset=utf-8",
    "Access-Control-Allow-Origin: *",
    `Content-Length: ${Buffer.byteLength(body, "utf-8")}`,
    "Connection: close",
    "",
    body,
  ].join("\r\n");
}

export class StreamEngine {
  private server: any = null;
  private running = false;

  constructor(private opts: StreamEngineOptions) {}

  public isRunning(): boolean {
    return this.running;
  }

  public start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.server = net.createServer((socket: any) => this.handleConnection(socket));

        this.server.listen(this.opts.port, "127.0.0.1", () => {
          this.running = true;
          console.log(`[真流式] 独占端口引擎已就绪 127.0.0.1:${this.opts.port}`);
          resolve();
        });

        this.server.on("error", (err: any) => {
          this.running = false;
          console.error("[真流式] 端口监听失败:", err?.message || err);
          reject(err);
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  public stop(): void {
    if (this.server) {
      try {
        this.server.close();
      } catch {}
      this.server = null;
    }
    this.running = false;
  }

  /* ------------------------------------------------------------------ */

  private handleConnection(socket: any) {
    try {
      socket.setNoDelay(true); // 关闭 Nagle，逐 chunk 立即发包
    } catch {}

    let buffer: any = Buffer.alloc(0);
    let headerParsed = false;
    let method = "GET";
    let path = "/";
    let headers: Record<string, string> = {};
    let contentLength = 0;

    const onData = async (chunk: any) => {
      buffer = Buffer.concat([buffer, chunk]);

      if (!headerParsed) {
        const headerEnd = buffer.indexOf("\r\n\r\n");
        if (headerEnd === -1) {
          if (buffer.length > 64 * 1024) {
            // 头部过大，直接放弃
            socket.removeListener("data", onData);
            socket.end(jsonResponse(413, "Payload Too Large", { error: "header_too_large" }));
          }
          return;
        }

        const headerStr = buffer.slice(0, headerEnd).toString("utf-8");
        const lines = headerStr.split("\r\n");
        const parts = (lines[0] || "").split(" ");
        method = (parts[0] || "GET").toUpperCase();
        path = parts[1] || "/";

        for (let i = 1; i < lines.length; i++) {
          const colon = lines[i].indexOf(":");
          if (colon > 0) {
            const k = lines[i].slice(0, colon).trim().toLowerCase();
            const v = lines[i].slice(colon + 1).trim();
            headers[k] = v;
          }
        }

        contentLength = parseInt(headers["content-length"] || "0", 10) || 0;
        headerParsed = true;
        buffer = buffer.slice(headerEnd + 4);
      }

      if (buffer.length < contentLength) return; // 等 body 收全

      socket.removeListener("data", onData);
      const bodyBytes = buffer.slice(0, contentLength);

      // CORS 预检
      if (method === "OPTIONS") {
        socket.end(
          [
            "HTTP/1.1 204 No Content",
            "Access-Control-Allow-Origin: *",
            "Access-Control-Allow-Methods: POST, GET, OPTIONS",
            "Access-Control-Allow-Headers: Content-Type, Authorization",
            "Content-Length: 0",
            "Connection: close",
            "",
            "",
          ].join("\r\n")
        );
        return;
      }

      let bodyJson: any = null;
      try {
        if (bodyBytes.length > 0) bodyJson = JSON.parse(bodyBytes.toString("utf-8"));
      } catch {}

      const isChatPath =
        path === "/v1/chat/completions" || path === "/chat/completions" || path === "/v1/v1/chat/completions";

      if (!isChatPath) {
        socket.end(
          jsonResponse(404, "Not Found", {
            error: "stream_port_only",
            message: `本端口 ${this.opts.port} 只处理 /v1/chat/completions 的流式请求；其他接口请访问主网关 http://127.0.0.1:${this.opts.mainGatewayPort}/v1`,
            main_gateway: `http://127.0.0.1:${this.opts.mainGatewayPort}/v1`,
          })
        );
        return;
      }

      if (method !== "POST") {
        socket.end(jsonResponse(405, "Method Not Allowed", { error: "method_not_allowed" }));
        return;
      }

      if (!bodyJson || bodyJson.stream !== true) {
        socket.end(
          jsonResponse(400, "Bad Request", {
            error: "stream_only",
            message: `本端口 ${this.opts.port} 只支持 "stream": true 的流式对话；非流式请求请改用主网关 http://127.0.0.1:${this.opts.mainGatewayPort}/v1`,
          })
        );
        return;
      }

      await this.runStream(socket, { method, path, headers, body: bodyJson });
    };

    socket.on("data", onData);
    socket.on("error", (err: any) => {
      // 客户端主动断开很常见，只在非 ECONNRESET 时提示
      const msg = err?.message || String(err);
      if (!/ECONNRESET|EPIPE|socket has been ended/i.test(msg)) {
        console.error("[真流式] socket error:", msg);
      }
    });
  }

  private async runStream(
    socket: any,
    req: StreamRequest
  ) {
    const sseHead = [
      "HTTP/1.1 200 OK",
      "Content-Type: text/event-stream; charset=utf-8",
      "Cache-Control: no-cache, no-transform",
      "Connection: keep-alive",
      "X-Accel-Buffering: no",
      "Access-Control-Allow-Origin: *",
      "",
      "",
    ].join("\r\n");

    socket.write(sseHead);

    const writeChunk = (data: string) => {
      if (!socket.destroyed) {
        socket.write(data);
      }
    };

    const close = () => {
      if (!socket.destroyed) {
        socket.end();
      }
    };

    try {
      await this.opts.onStreamRequest(req, writeChunk, close);
    } catch (e: any) {
      console.error("[真流式] 生成异常:", e?.message || e);
      writeChunk(
        `data: ${JSON.stringify({ error: { type: "stream_internal_error", message: String(e?.message || e) } })}\n\n`
      );
      writeChunk("data: [DONE]\n\n");
      close();
    }
  }
}
