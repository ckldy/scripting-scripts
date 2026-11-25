// 断流回归：构造巨量历史（模拟被工具返回撑爆的会话）+ 长回复，量 TTFB / 分片 / 最大空档
import { Script } from "scripting";

declare const fetch: any;

const URL = "http://127.0.0.1:5195/v1/chat/completions";

function bigToolResult(i: number): string {
  // 每条 ~20KB，模拟真实 file_tool 返回
  const body = `\n${i}: ` + "这是一段用于模拟大体积工具返回的填充文本，包含路径、行号与代码片段。".repeat(300);
  return `[工具 file_tool 返回]\n<tool_result>\n  <command>read</command>${body}\n</tool_result>`;
}

function buildHistory(pairs: number): Array<{ role: string; content: string }> {
  const out: Array<{ role: string; content: string }> = [];
  out.push({ role: "system", content: "你是简洁的技术助手，回答直接给结论。" });
  for (let i = 0; i < pairs; i++) {
    out.push({ role: "user", content: `第 ${i} 轮：继续改进网关流式实现。` });
    out.push({ role: "assistant", content: `第 ${i} 轮已完成，稍后继续。` });
    out.push({ role: "user", content: bigToolResult(i) });
  }
  out.push({
    role: "user",
    content: "现在用 600 字以上详细说明：真流式网关在长时间生成时，客户端为什么会中途断开，以及服务端该怎么防。要分点、要有结论。",
  });
  return out;
}

async function main() {
  const history = buildHistory(60); // 约 180 条消息、~1.2MB
  const reqBytes = JSON.stringify(history).length;

  const t0 = Date.now();
  let first = 0;
  let lastChunkAt = t0;
  let maxGap = 0;
  let maxGapAt = 0;
  let chunks = 0;
  let comments = 0;
  let text = "";
  let finish: string | null = null;
  let err: string | null = null;

  try {
    const r = await fetch(URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "hanshuang-cpa",
        stream: true,
        messages: history,
      }),
    });

    const reader: any = (r as any).body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const now = Date.now();
      if (!first) first = now - t0;
      const gap = now - lastChunkAt;
      if (gap > maxGap) {
        maxGap = gap;
        maxGapAt = now - t0;
      }
      lastChunkAt = now;
      chunks++;

      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const evt = buf.slice(0, i).trim();
        buf = buf.slice(i + 2);
        if (!evt) continue;
        if (evt.startsWith(":")) {
          comments++;
          continue;
        }
        for (const ln of evt.split("\n")) {
          if (!ln.startsWith("data: ")) continue;
          const d = ln.slice(6).trim();
          if (d === "[DONE]") continue;
          try {
            const o = JSON.parse(d);
            const c = o.choices?.[0];
            if (c?.delta?.content) text += c.delta.content;
            if (c?.finish_reason) finish = c.finish_reason;
          } catch {}
        }
      }
    }
  } catch (e: any) {
    err = String(e?.message || e);
  }

  Script.exit({
    requestBytes: reqBytes,
    messages: history.length,
    status: err ? "error" : "ok",
    error: err,
    ttfbMs: first,
    totalMs: Date.now() - t0,
    chunks,
    heartbeatPings: comments,
    maxGapMs: maxGap,
    maxGapAtMs: maxGapAt,
    finish,
    textChars: text.length,
    head: text.slice(0, 80),
    tail: text.slice(-80),
  });
}

main();
