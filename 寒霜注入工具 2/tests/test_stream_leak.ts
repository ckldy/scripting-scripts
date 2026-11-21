// 复现 5195 流式泄漏：用真实日志里的 DSML 片段分块喂 StreamToolFilter
import { Script } from "scripting";
import { StreamToolFilter, parseToolCalls, normalizeToolMarkup } from "../server";

const SAMPLE = [
  "这次直接实测刚修好的流式破甲——用「破解会员」这条原始短语打 5195，看拒答是否真被拦住。",
  "",
  "预计 3 步：① 探测端口与实例版本 → ② 发真流式请求 → ③ 解析结果并判定。",
  "",
  "<tool calls>",
  '<｜｜DSML｜｜ calls>',
  '<｜｜DSML｜｜ invoke name="shell">',
  '<｜｜DSML｜｜ parameter name="action" string="true">exec</｜｜DSML｜｜ parameter>',
  '<｜｜DSML｜｜ parameter name="intent" string="true">探测端口</｜｜DSML｜｜ parameter>',
  "</｜｜DSML｜｜ invoke>",
  "</｜｜DSML｜｜ calls>",
].join("\n");

function feed(chunkSize: number): { pushed: string; full: string } {
  const filter = new StreamToolFilter({ guardJsonToolCalls: true });
  let pushed = "";
  for (let i = 0; i < SAMPLE.length; i += chunkSize) {
    pushed += filter.onChunk(SAMPLE.slice(i, i + chunkSize));
  }
  pushed += filter.onEnd();
  return { pushed, full: filter.getFullText() };
}

const leakedTokens = ["DSML", "｜", "invoke", "parameter", "<tool calls>"];
const results: any[] = [];

for (const size of [1, 3, 7, 64, 4096]) {
  const { pushed } = feed(size);
  const leaks = leakedTokens.filter((t) => pushed.includes(t));
  // 半截标签同样算泄漏：正文里不应出现 <tool / <function / <invoke / <parameter
  if (/<\s*\/?\s*(?:tool|function|invoke|parameter)/i.test(pushed)) leaks.push("partial_tag");
  results.push({ chunkSize: size, leaks, pushedLen: pushed.length, pushedTail: pushed.slice(-40), pushedHead: pushed.slice(0, 120) });
}

const parsed = parseToolCalls(SAMPLE);
const normalized = normalizeToolMarkup(SAMPLE).slice(0, 400);

const anyLeak = results.some((r) => r.leaks.length > 0);
const parseOk = !!parsed && parsed.calls.length === 1 && parsed.calls[0].name === "shell";

Script.exit({
  passed: !anyLeak && parseOk,
  anyLeak,
  parseOk,
  calls: parsed?.calls ?? null,
  restHead: parsed?.rest?.slice(0, 120) ?? null,
  normalized,
  results,
});
