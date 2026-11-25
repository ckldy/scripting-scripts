// 短回复探测：5190 是否已真流式（首字节/分片间隔），并排除长任务超时干扰
import { Script } from "scripting";

declare const fetch: any;

async function probe(url: string, label: string) {
  const started = Date.now();
  let firstByteAt = 0;
  let chunks = 0;
  let content = "";
  let maxGap = 0;
  let lastAt = started;
  const arrivals: number[] = [];

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "hanshuang-cpa",
      stream: true,
      messages: [{ role: "user", content: "请分 5 段、每段一句话，讲一下 TCP 粘包是怎么处理的。不要用列表符号。" }],
    }),
  });

  const reader: any = (res as any).body?.getReader?.();
  if (!reader) {
    const text = await res.text();
    return { label, mode: "no-reader", status: res.status, chars: text.length, totalMs: Date.now() - started };
  }

  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!firstByteAt) firstByteAt = Date.now();
    const now = Date.now();
    if (now - lastAt > maxGap) maxGap = now - lastAt;
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
        const d = obj.choices?.[0]?.delta;
        if (d?.content) {
          content += d.content;
          chunks++;
          if (arrivals.length < 6) arrivals.push(Date.now() - started);
        }
      } catch {}
    }
  }

  return {
    label,
    status: res.status,
    ttfbMs: firstByteAt ? firstByteAt - started : null,
    totalMs: Date.now() - started,
    maxGapMs: maxGap,
    chunks,
    chars: content.length,
    firstArrivalsMs: arrivals,
    tail: content.slice(-80),
  };
}

async function main() {
  const out: any = {};
  try {
    out.c5195 = await probe("http://127.0.0.1:5195/v1/chat/completions", "5195");
  } catch (e: any) {
    out.c5195 = { error: String(e?.message || e) };
  }
  try {
    out.c5190 = await probe("http://127.0.0.1:5190/v1/chat/completions", "5190");
  } catch (e: any) {
    out.c5190 = { error: String(e?.message || e) };
  }
  Script.exit(out);
}

main();
