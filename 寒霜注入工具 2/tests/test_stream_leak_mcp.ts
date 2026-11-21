import { Script } from "scripting";
import { parseToolCalls, normalizeToolMarkup, stripToolMarkup, StreamToolFilter } from "../server";

const SAMPLE = [
  '<tool_calls>',
  '<tool call name="mcp">',
  '<parameter name="action">call_tool</parameter>',
  '<parameter name="arguments">{"selection_token": "", "query": "怒火拳魂"}</parameter>',
  '<parameter name="intent">检查该片在 Emby 各组件的可用状态</parameter>',
  '<parameter name="server_id">DB61FA2D-E731-46B6-9D19-789B77D94662</parameter>',
  '<parameter name="tool_name">check_in_library</parameter>',
  '</tool call>',
  '</tool_calls>',
].join("\n");

// 1. 验证归一化
const norm = normalizeToolMarkup(SAMPLE);

// 2. 验证解析
const parsed = parseToolCalls(SAMPLE);
const parseOk = !!parsed && parsed.calls.length === 1 && parsed.calls[0].name === "mcp";

// 3. 验证清洗（无残留）
const stripped = stripToolMarkup(SAMPLE);

// 4. 验证流式过滤器分块阻断
function feed(chunkSize: number): string {
  const filter = new StreamToolFilter({ guardJsonToolCalls: true });
  let pushed = "";
  for (let i = 0; i < SAMPLE.length; i += chunkSize) {
    pushed += filter.onChunk(SAMPLE.slice(i, i + chunkSize));
  }
  pushed += filter.onEnd();
  return pushed;
}

const leakResults = [1, 3, 7, 64].map((size) => ({
  size,
  pushed: feed(size),
  clean: feed(size).length === 0,
}));

const allStreamClean = leakResults.every((r) => r.clean);
const allStrippedClean = stripped.trim().length === 0;

Script.exit({
  passed: parseOk && allStreamClean && allStrippedClean,
  parseOk,
  allStreamClean,
  allStrippedClean,
  calls: parsed?.calls,
  normHead: norm.slice(0, 100),
  leakResults,
});
