// 实测：流式长回复是否被截断、断点多长、chunk 间隔多大
import { Script } from "scripting";
import fs from "node:fs";

declare const fetch: any;

const PROMPT =
  "请写一份完整的技术文档，主题是『本地网关的流式传输设计』，要求：1) 至少 12 个小节；2) 每节不少于 200 字；3) 不要省略号，不要写『以下省略』；4) 一次性写完，中途不要停。";

async function runStream(url: string, label: string) {
  const started = Date.now();
  let content = "";
  let reasoning = "";
  let chunks = 0;
  let finish: string | null = null;
  let maxGap = 0;
  let lastAt = started;
  let firstByteAt = 0;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "hanshuang-cpa",
      stream: true,
      messages: [{ role: "user", content: PROMPT }],
    }),
  });

  const reader: any = (res as any).body?.getReader?.();
  if (!reader) {
    const text = await res.text();
    return { label, mode: "no-reader", status: res.status, chars: text.length };
  }

  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!firstByteAt) firstByteAt = Date.now();
    const now = Date.now();
    const gap = now - lastAt;
    if (gap > maxGap) maxGap = gap;
    lastAt = now;

    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const evt = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      if (!evt.startsWith("data: ")) continue;
      const raw = evt.slice(6).trim();
      if (raw === "[DONE]") continue;
      try {
        const obj = JSON.parse(raw);
        const ch = obj.choices?.[0];
        if (ch?.delta?.content) {
          content += ch.delta.content;
          chunks++;
        }
        if (ch?.delta?.reasoning_content) reasoning += ch.delta.reasoning_content;
        if (ch?.finish_reason) finish = ch.finish_reason;
      } catch {}
    }
  }

  return {
    label,
    status: res.status,
    totalMs: Date.now() - started,
    ttfbMs: firstByteAt ? firstByteAt - started : null,
    maxGapMs: maxGap,
    chunks,
    contentChars: content.length,
    reasoningChars: reasoning.length,
    finish,
    tail: content.slice(-120),
  };
}

async function main() {
  const out: any = {};
  try {
    out.stream5195 = await runStream("http://127.0.0.1:5195/v1/chat/completions", "5195");
  } catch (e: any) {
    out.stream5195 = { error: String(e?.message || e) };
  }
  try {
    out.stream5190 = await runStream("http://127.0.0.1:5190/v1/chat/completions", "5190");
  } catch (e: any) {
    out.stream5190 = { error: String(e?.message || e) };
  }
  Script.exit(out);
}

main();
