// 5195 全协议验证：/v1/models、流式、非流式
import { Script } from "scripting";

declare const fetch: any;

const PROMPT = "用三句话讲讲 HTTP/2 多路复用解决了什么问题。";

async function main() {
  const out: any = {};

  // 1) /v1/models
  try {
    const r = await fetch("http://127.0.0.1:5195/v1/models");
    const j = await r.json();
    out.models = { status: r.status, ids: (j.data || []).map((m: any) => m.id) };
  } catch (e: any) {
    out.models = { error: String(e?.message || e) };
  }

  // 2) 非流式
  try {
    const t0 = Date.now();
    const r = await fetch("http://127.0.0.1:5195/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "hanshuang-cpa", stream: false, messages: [{ role: "user", content: PROMPT }] }),
    });
    const raw = await r.text();
    let j: any = null;
    try {
      j = JSON.parse(raw);
    } catch {}
    const msg = j?.choices?.[0]?.message;
    out.nonStream = {
      status: r.status,
      ms: Date.now() - t0,
      finish: j?.choices?.[0]?.finish_reason ?? null,
      contentChars: typeof msg?.content === "string" ? msg.content.length : 0,
      reasoningChars: typeof msg?.reasoning_content === "string" ? msg.reasoning_content.length : 0,
      head: (raw || "").slice(0, 200),
    };
  } catch (e: any) {
    out.nonStream = { error: String(e?.message || e) };
  }

  // 3) 流式（首字节与分片）
  try {
    const t0 = Date.now();
    let first = 0;
    let chunks = 0;
    let content = "";
    const r = await fetch("http://127.0.0.1:5195/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "hanshuang-cpa", stream: true, messages: [{ role: "user", content: PROMPT }] }),
    });
    const reader: any = (r as any).body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!first) first = Date.now() - t0;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const evt = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (!evt.startsWith("data: ")) continue;
        const raw = evt.slice(6).trim();
        if (raw === "[DONE]") continue;
        try {
          const o = JSON.parse(raw);
          const c = o.choices?.[0]?.delta?.content;
          if (c) {
            content += c;
            chunks++;
          }
        } catch {}
      }
    }
    out.stream = { status: r.status, ttfbMs: first, chunks, contentChars: content.length, totalMs: Date.now() - t0 };
  } catch (e: any) {
    out.stream = { error: String(e?.message || e) };
  }

  Script.exit(out);
}

main();
