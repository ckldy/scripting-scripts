// 5195 Anthropic 协议实测：/v1/messages 流式 + 非流式
import { Script } from "scripting";

declare const fetch: any;

const BODY_BASE: any = {
  model: "hanshuang-cpa",
  max_tokens: 512,
  system: "你是简洁的技术助手。",
  messages: [{ role: "user", content: "用三句话说明 QUIC 相比 TCP+TLS 的优势。" }],
};

async function main() {
  const out: any = {};

  // 1) 流式
  try {
    const t0 = Date.now();
    let first = 0;
    let events: string[] = [];
    let text = "";
    let thinking = "";
    let stopReason: string | null = null;
    let sawMessageStop = false;

    const r = await fetch("http://127.0.0.1:5195/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ ...BODY_BASE, stream: true }),
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
        const evt = buf.slice(0, i).trim();
        buf = buf.slice(i + 2);
        if (!evt) continue;
        const lines = evt.split("\n");
        let evName = "";
        let dataRaw = "";
        for (const ln of lines) {
          if (ln.startsWith("event: ")) evName = ln.slice(7).trim();
          else if (ln.startsWith("data: ")) dataRaw = ln.slice(6).trim();
        }
        if (evName && !events.includes(evName)) events.push(evName);
        if (evName === "message_stop") sawMessageStop = true;
        if (!dataRaw) continue;
        try {
          const o = JSON.parse(dataRaw);
          const d = o.delta || {};
          if (d.type === "text_delta" && typeof d.text === "string") text += d.text;
          if (d.type === "thinking_delta" && typeof d.thinking === "string") thinking += d.thinking;
          if (o.type === "message_delta" && o.delta) stopReason = o.delta.stop_reason ?? stopReason;
        } catch {}
      }
    }

    out.stream = {
      status: r.status,
      ttfbMs: first,
      totalMs: Date.now() - t0,
      events,
      sawMessageStop,
      textChars: text.length,
      thinkingChars: thinking.length,
      stopReason,
      tail: text.slice(-80),
    };
  } catch (e: any) {
    out.stream = { error: String(e?.message || e) };
  }

  // 2) 非流式
  try {
    const t0 = Date.now();
    const r = await fetch("http://127.0.0.1:5195/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ ...BODY_BASE, stream: false }),
    });
    const raw = await r.text();
    let j: any = null;
    try {
      j = JSON.parse(raw);
    } catch {}
    out.nonStream = {
      status: r.status,
      ms: Date.now() - t0,
      type: j?.type ?? null,
      stopReason: j?.stop_reason ?? null,
      blocks: Array.isArray(j?.content) ? j.content.map((b: any) => b.type) : null,
      textChars: Array.isArray(j?.content)
        ? j.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("").length
        : 0,
      head: (raw || "").slice(0, 160),
    };
  } catch (e: any) {
    out.nonStream = { error: String(e?.message || e) };
  }

  Script.exit(out);
}

main();
