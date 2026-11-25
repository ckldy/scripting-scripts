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

declare const fetch: any;

/* ------------------------------------------------------------------ */
/* Anthropic 协议适配：让 5195 直接当 Claude 客户端的 Base URL           */
/* ------------------------------------------------------------------ */

/** Anthropic 请求 → OpenAI chat 请求（system / 消息 / 工具全部拍平） */
function anthropicToOpenAI(body: any): any {
  const msgs: any[] = [];

  const sys = body?.system;
  let sysText = "";
  if (typeof sys === "string") sysText = sys;
  else if (Array.isArray(sys)) {
    sysText = sys
      .filter((b: any) => b && typeof b.text === "string")
      .map((b: any) => b.text)
      .join("\n");
  }
  if (sysText.trim()) msgs.push({ role: "system", content: sysText });

  const src = Array.isArray(body?.messages) ? body.messages : [];
  for (const m of src) {
    const role = m?.role === "assistant" ? "assistant" : "user";
    let text = "";
    const parts: any[] = Array.isArray(m?.content)
      ? m.content
      : typeof m?.content === "string"
      ? [{ type: "text", text: m.content }]
      : [];

    for (const p of parts) {
      if (!p) continue;
      if (p.type === "text" && typeof p.text === "string") {
        text += p.text;
      } else if (p.type === "tool_use") {
        // 助手运行时只吃文本：工具调用写成文字，交给上层 parseToolCalls 解析
        text += "\n[调用工具 " + String(p.name || "") + " 参数 " + JSON.stringify(p.input ?? {}) + "]";
      } else if (p.type === "tool_result") {
        const c = p.content;
        let t = "";
        if (typeof c === "string") t = c;
        else if (Array.isArray(c)) {
          t = c
            .filter((x: any) => x && typeof x.text === "string")
            .map((x: any) => x.text)
            .join("\n");
        }
        if (t.trim()) msgs.push({ role: "user", content: "[工具返回]\n" + t });
      } else if (p.type === "image") {
        text += "\n[图片已省略：本网关文本通道不支持图片输入]";
      }
    }

    if (text.trim()) msgs.push({ role, content: text });
  }

  const out: any = {
    model: typeof body?.model === "string" ? body.model : "hanshuang-armor",
    stream: body?.stream === true,
    messages: msgs,
  };

  if (Array.isArray(body?.tools) && body.tools.length) {
    const tools = body.tools
      .map((t: any) => ({
        type: "function",
        function: {
          name: String(t?.name || ""),
          description: String(t?.description || ""),
          parameters: t?.input_schema || { type: "object", properties: {} },
        },
      }))
      .filter((t: any) => t.function.name);
    if (tools.length) out.tools = tools;
  }

  const tc = body?.tool_choice;
  if (tc && typeof tc === "object") {
    if (tc.type === "auto") out.tool_choice = "auto";
    else if (tc.type === "any") out.tool_choice = "required";
    else if (tc.type === "tool" && tc.name) {
      out.tool_choice = { type: "function", function: { name: String(tc.name) } };
    }
  }

  return out;
}

const ANTH_STOP_MAP: Record<string, string> = {
  stop: "end_turn",
  tool_calls: "tool_use",
  length: "max_tokens",
  content_filter: "end_turn",
};

/** OpenAI 流片段 → Anthropic SSE 事件（thinking / text / tool_use 三种块） */
class AnthropicSseConverter {
  private pending = "";
  private started = false;
  private thinkIndex = -1;
  private textIndex = -1;
  private nextIndex = 0;
  private stopReason = "end_turn";
  private outChars = 0;
  private inTokens = 0;
  private outTokens = 0;
  private toolCalls: any[] = [];
  private ended = false;
  private readonly id: string;
  private readonly model: string;

  constructor(model: string) {
    this.id = "msg_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    this.model = model;
  }

  private ev(type: string, data: any): string {
    return "event: " + type + "\ndata: " + JSON.stringify(data) + "\n\n";
  }

  private messageStart(): string {
    return this.ev("message_start", {
      type: "message_start",
      message: {
        id: this.id,
        type: "message",
        role: "assistant",
        model: this.model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    });
  }

  private openText(out: string[]): number {
    if (this.textIndex >= 0) return this.textIndex;
    this.textIndex = this.nextIndex++;
    out.push(
      this.ev("content_block_start", {
        type: "content_block_start",
        index: this.textIndex,
        content_block: { type: "text", text: "" },
      })
    );
    return this.textIndex;
  }

  private closeThink(out: string[]) {
    if (this.thinkIndex < 0) return;
    out.push(this.ev("content_block_stop", { type: "content_block_stop", index: this.thinkIndex }));
    this.thinkIndex = -1;
  }

  public onChunk(chunk: string): string {
    const out: string[] = [];
    this.pending += chunk;

    const lines = this.pending.split("\n");
    this.pending = lines.pop() || "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const raw = line.slice(6).trim();
      if (!raw || raw === "[DONE]") continue;

      let obj: any;
      try {
        obj = JSON.parse(raw);
      } catch {
        continue;
      }

      if (obj && obj.error) {
        out.push(
          this.ev("error", {
            type: "error",
            error: { type: "api_error", message: String(obj.error.message || "upstream error") },
          })
        );
        continue;
      }

      if (obj && obj.usage) {
        this.inTokens = Number(obj.usage.prompt_tokens) || this.inTokens;
        this.outTokens = Number(obj.usage.completion_tokens) || this.outTokens;
      }

      const choice = obj && obj.choices ? obj.choices[0] : null;
      if (!choice) continue;
      const delta = choice.delta || {};

      if (!this.started) {
        this.started = true;
        out.push(this.messageStart());
      }

      if (typeof delta.reasoning_content === "string" && delta.reasoning_content) {
        if (this.thinkIndex < 0) {
          this.thinkIndex = this.nextIndex++;
          out.push(
            this.ev("content_block_start", {
              type: "content_block_start",
              index: this.thinkIndex,
              content_block: { type: "thinking", thinking: "" },
            })
          );
        }
        out.push(
          this.ev("content_block_delta", {
            type: "content_block_delta",
            index: this.thinkIndex,
            delta: { type: "thinking_delta", thinking: delta.reasoning_content },
          })
        );
      }

      if (typeof delta.content === "string" && delta.content) {
        this.closeThink(out);
        const idx = this.openText(out);
        this.outChars += delta.content.length;
        out.push(
          this.ev("content_block_delta", {
            type: "content_block_delta",
            index: idx,
            delta: { type: "text_delta", text: delta.content },
          })
        );
      }

      if (Array.isArray(delta.tool_calls)) {
        for (const toolCall of delta.tool_calls) {
          const i = Number(toolCall && toolCall.index != null ? toolCall.index : 0);
          if (!this.toolCalls[i]) {
            this.toolCalls[i] = {
              id: (toolCall && toolCall.id) || "toolu_" + Date.now().toString(36) + i,
              name: (toolCall && toolCall.function && toolCall.function.name) || "",
              args: "",
            };
          }
          const slot = this.toolCalls[i];
          const fn = toolCall && toolCall.function;
          if (fn && fn.name && !slot.name) slot.name = fn.name;
          if (fn && typeof fn.arguments === "string") slot.args += fn.arguments;
        }
      }

      if (choice.finish_reason) {
        this.stopReason = ANTH_STOP_MAP[String(choice.finish_reason)] || "end_turn";
      }
    }

    return out.join("");
  }

  public onEnd(): string {
    if (this.ended) return "";
    this.ended = true;
    const out: string[] = [];

    if (!this.started) {
      this.started = true;
      out.push(this.messageStart());
    }

    this.closeThink(out);
    if (this.textIndex >= 0) {
      out.push(this.ev("content_block_stop", { type: "content_block_stop", index: this.textIndex }));
    }

    for (const tc of this.toolCalls) {
      if (!tc) continue;
      let input: any = {};
      try {
        input = tc.args ? JSON.parse(tc.args) : {};
      } catch {
        input = { raw: tc.args };
      }
      const idx = this.nextIndex++;
      out.push(
        this.ev("content_block_start", {
          type: "content_block_start",
          index: idx,
          content_block: { type: "tool_use", id: tc.id, name: tc.name, input: {} },
        })
      );
      out.push(
        this.ev("content_block_delta", {
          type: "content_block_delta",
          index: idx,
          delta: { type: "input_json_delta", partial_json: JSON.stringify(input) },
        })
      );
      out.push(this.ev("content_block_stop", { type: "content_block_stop", index: idx }));
      this.stopReason = "tool_use";
    }

    const estimated = this.outTokens || Math.max(1, Math.ceil(this.outChars / 1.6));
    out.push(
      this.ev("message_delta", {
        type: "message_delta",
        delta: { stop_reason: this.stopReason, stop_sequence: null },
        usage: { input_tokens: this.inTokens, output_tokens: estimated },
      })
    );
    out.push(this.ev("message_stop", { type: "message_stop" }));
    return out.join("");
  }
}


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

      const isAnthropicPath = path === "/v1/messages" || path === "/messages";
      const isChatPath =
        path === "/v1/chat/completions" || path === "/chat/completions" || path === "/v1/v1/chat/completions";

      // 客户端建连时常先探测模型列表：代理到主网关，让 5195 能当完整 Base URL 用
      if ((path === "/v1/models" || path === "/models") && method === "GET") {
        try {
          const res = await fetch(`http://127.0.0.1:${this.opts.mainGatewayPort}/v1/models`, { method: "GET" });
          const text = await res.text();
          socket.end(
            [
              `HTTP/1.1 ${res.status} ${res.statusText || "OK"}`,
              "Content-Type: application/json; charset=utf-8",
              "Access-Control-Allow-Origin: *",
              `Content-Length: ${Buffer.byteLength(text, "utf-8")}`,
              "Connection: close",
              "",
              text,
            ].join("\r\n")
          );
        } catch (e) {
          socket.end(jsonResponse(502, "Bad Gateway", { error: "models_proxy_failed", message: String(e) }));
        }
        return;
      }

      if (!isChatPath && !isAnthropicPath) {
        socket.end(
          jsonResponse(404, "Not Found", {
            error: "stream_port_only",
            message: `本端口 ${this.opts.port} 只处理 /v1/chat/completions 与 /v1/messages；其他接口请访问主网关 http://127.0.0.1:${this.opts.mainGatewayPort}/v1`,
            main_gateway: `http://127.0.0.1:${this.opts.mainGatewayPort}/v1`,
          })
        );
        return;
      }

      if (method !== "POST") {
        socket.end(jsonResponse(405, "Method Not Allowed", { error: "method_not_allowed" }));
        return;
      }

      if (!bodyJson) {
        socket.end(jsonResponse(400, "Bad Request", { error: "invalid_body" }));
        return;
      }

      if (isAnthropicPath) {
        await this.handleAnthropic(socket, { method, path, headers, body: bodyJson });
        return;
      }

      // 非流式也走真流式内核，再把片段聚合成完整 JSON 返回：
      // 这样客户端把 Base URL 指到 5195 时，流式与非流式都是逐块产出，不会卡满整轮。
      if (bodyJson.stream !== true) {
        await this.runBuffered(socket, { method, path, headers, body: bodyJson });
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

  /** Anthropic /v1/messages：请求转成 OpenAI 跑真流式内核，再把输出转回 Anthropic 事件 */
  private async handleAnthropic(socket: any, req: StreamRequest) {
    const openaiBody = anthropicToOpenAI(req.body);
    const model = String(req.body?.model || openaiBody.model || "hanshuang-armor");
    const wantStream = req.body?.stream === true;

    if (!wantStream) {
      // 非流式：内部仍跑真流式，聚合后按 Anthropic message 结构返回
      let text = "";
      let thinking = "";
      let stopReason = "end_turn";
      let inTok = 0;
      let outTok = 0;
      const toolCalls: any[] = [];
      let errorObj: any = null;
      let done = false;

      const absorb = (chunk: string) => {
        for (const line of String(chunk).split("\n")) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (!raw || raw === "[DONE]") continue;
          let obj: any;
          try {
            obj = JSON.parse(raw);
          } catch {
            continue;
          }
          if (obj && obj.error) errorObj = obj.error;
          if (obj && obj.usage) {
            inTok = Number(obj.usage.prompt_tokens) || inTok;
            outTok = Number(obj.usage.completion_tokens) || outTok;
          }
          const choice = obj && obj.choices ? obj.choices[0] : null;
          if (!choice) continue;
          const d = choice.delta || {};
          if (typeof d.reasoning_content === "string") thinking += d.reasoning_content;
          if (typeof d.content === "string") text += d.content;
          if (Array.isArray(d.tool_calls)) {
            for (const tc of d.tool_calls) {
              const i = Number(tc && tc.index != null ? tc.index : 0);
              if (!toolCalls[i]) {
                toolCalls[i] = { id: (tc && tc.id) || "toolu_" + Date.now().toString(36) + i, name: "", args: "" };
              }
              const slot = toolCalls[i];
              const fn = tc && tc.function;
              if (fn && fn.name && !slot.name) slot.name = fn.name;
              if (fn && typeof fn.arguments === "string") slot.args += fn.arguments;
            }
          }
          if (choice.finish_reason) {
            stopReason = ANTH_STOP_MAP[String(choice.finish_reason)] || "end_turn";
          }
        }
      };

      const finish = () => {
        if (done) return;
        done = true;
        if (errorObj) {
          socket.end(jsonResponse(502, "Bad Gateway", { type: "error", error: errorObj }));
          return;
        }
        const content: any[] = [];
        if (thinking) content.push({ type: "thinking", thinking });
        if (text) content.push({ type: "text", text });
        for (const tc of toolCalls) {
          if (!tc || !tc.name) continue;
          let input: any = {};
          try {
            input = tc.args ? JSON.parse(tc.args) : {};
          } catch {
            input = { raw: tc.args };
          }
          content.push({ type: "tool_use", id: tc.id, name: tc.name, input });
          stopReason = "tool_use";
        }
        socket.end(
          jsonResponse(200, "OK", {
            id: "msg_" + Date.now().toString(36),
            type: "message",
            role: "assistant",
            model,
            content,
            stop_reason: stopReason,
            stop_sequence: null,
            usage: { input_tokens: inTok, output_tokens: outTok },
          })
        );
      };

      try {
        await this.opts.onStreamRequest({ ...req, body: openaiBody }, absorb, finish);
      } catch (e: any) {
        socket.end(jsonResponse(500, "Internal Server Error", { type: "error", error: { message: String(e?.message || e) } }));
        return;
      }
      finish();
      return;
    }

    // 流式：先发 SSE 头，再把 OpenAI 片段转成 Anthropic 事件下发
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

    const conv = new AnthropicSseConverter(model);
    let closed = false;
    const writeSse = (s: string) => {
      if (closed || socket.destroyed) return;
      socket.write(s);
    };
    const closeSse = () => {
      if (closed) return;
      closed = true;
      if (!socket.destroyed) socket.end();
    };

    const onOpenAiChunk = (chunk: string) => {
      const anth = conv.onChunk(chunk);
      if (anth) writeSse(anth);
    };

    try {
      await this.opts.onStreamRequest({ ...req, body: openaiBody }, onOpenAiChunk, () => {
        const tail = conv.onEnd();
        if (tail) writeSse(tail);
        closeSse();
      });
      // 上游未主动 close 时兜底收尾（onEnd 幂等，重复调用安全）
      const tail = conv.onEnd();
      if (tail) writeSse(tail);
    } catch (e: any) {
      writeSse(
        "event: error\ndata: " +
          JSON.stringify({ type: "error", error: { type: "api_error", message: String(e?.message || e) } }) +
          "\n\n"
      );
    }
    closeSse();
  }

  /** 非流式：内部跑真流式，把 SSE 片段聚合成标准 chat.completion JSON */
  private async runBuffered(socket: any, req: StreamRequest) {
    const model = typeof req.body?.model === "string" ? req.body.model : "hanshuang-armor";
    let content = "";
    let reasoning = "";
    let finish = "stop";
    let usage: any = null;
    let errorObj: any = null;
    const calls: any[] = [];
    let settled = false;

    const absorb = (chunk: string) => {
      for (const line of String(chunk).split("\n")) {
        if (!line.startsWith("data: ")) continue;
        const raw = line.slice(6).trim();
        if (!raw || raw === "[DONE]") continue;
        try {
          const obj = JSON.parse(raw);
          if (obj.error) errorObj = obj.error;
          if (obj.usage) usage = obj.usage;
          const ch = obj.choices?.[0];
          if (!ch) continue;
          const d = ch.delta || {};
          if (typeof d.content === "string") content += d.content;
          if (typeof d.reasoning_content === "string") reasoning += d.reasoning_content;
          if (Array.isArray(d.tool_calls)) calls.push(...d.tool_calls);
          if (ch.finish_reason) finish = ch.finish_reason;
        } catch {}
      }
    };

    const settle = () => {
      if (settled) return;
      settled = true;
      if (errorObj) {
        socket.end(jsonResponse(502, "Bad Gateway", { error: errorObj }));
        return;
      }
      const message: any = { role: "assistant", content };
      if (calls.length) {
        message.tool_calls = calls.map((c, i) => ({
          id: c?.id || `call_${Date.now().toString(36)}_${i}`,
          type: "function",
          function: { name: c?.function?.name || "", arguments: c?.function?.arguments || "{}" },
        }));
      }
      if (reasoning) message.reasoning_content = reasoning;
      const payload: any = {
        id: `chatcmpl-${Date.now()}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [{ index: 0, message, finish_reason: message.tool_calls ? "tool_calls" : finish }],
      };
      if (usage) payload.usage = usage;
      socket.end(jsonResponse(200, "OK", payload));
    };

    try {
      await this.opts.onStreamRequest(req, absorb, settle);
    } catch (e: any) {
      if (!settled) {
        settled = true;
        socket.end(jsonResponse(500, "Internal Server Error", { error: { message: String(e?.message || e) } }));
      }
      return;
    }
    settle();
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
