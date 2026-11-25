// 工具标记变体泄漏回归：连字符/点/冒号/下划线/空格 分隔的标签都不得穿透
import { Script } from "scripting";
import {
  StreamToolFilter,
  parseToolCalls,
  stripToolMarkup,
  looksLikeToolCall,
} from "../server";

const BODY =
  "当前进度：15%｜已完成：确认上游稳定版 v4.0.0 已发布（latest 也指向它）｜下一步：拉取镜像，并核对入口与端口是否变化";

const INNER =
  '<tool_invoke name="shell"><parameter name="action">exec</parameter><parameter name="command">docker pull x</parameter></tool_invoke>';

const JSON_INNER =
  '[{"name":"shell","arguments":{"action":"exec","command":"docker pull x"}}]';

type Case = { name: string; markup: string; expectCall: boolean };

const CASES: Case[] = [
  { name: "下划线双 tool（历史）", markup: `<tool_tool_calls>${INNER}</tool_tool_calls>`, expectCall: true },
  { name: "连字符双 tool（本次泄漏）", markup: `<tool-tool_calls>${INNER}</tool-tool_calls>`, expectCall: true },
  { name: "连字符单 tool", markup: `<tool-calls>${INNER}</tool-calls>`, expectCall: true },
  { name: "点号分隔", markup: `<tool.calls>${INNER}</tool.calls>`, expectCall: true },
  { name: "冒号分隔", markup: `<tool:calls>${INNER}</tool:calls>`, expectCall: true },
  { name: "空格分隔", markup: `<tool calls>${INNER}</tool calls>`, expectCall: true },
  { name: "连字符 function_calls", markup: `<function-calls>${INNER}</function-calls>`, expectCall: true },
  { name: "连字符 tool-invoke 直连", markup: `<tool-invoke name="shell"><parameter name="command">docker pull x</parameter></tool-invoke>`, expectCall: true },
  { name: "连字符包裹 + JSON 数组", markup: `<tool-tool_calls>${JSON_INNER}</tool-tool_calls>`, expectCall: true },
  { name: "未闭合连字符包裹（流被截断）", markup: `<tool-tool_calls>\n{"name":"shell","arguments":{"command":"docker pull x"}}`, expectCall: false },
  { name: "未知变体（兜底拦截）", markup: `<tool-xyz calls="1">{"name":"shell","arguments":{}}</tool-xyz>`, expectCall: false },
  { name: "全角竖线 DSML（历史）", markup: `<｜｜DSML｜｜ calls><｜｜DSML｜｜ invoke name="shell"><｜｜DSML｜｜ parameter name="command" string="true">docker pull x</｜｜DSML｜｜ parameter></｜｜DSML｜｜ invoke></｜｜DSML｜｜ calls>`, expectCall: true },
];

const LEAK_RE =
  /<\s*\/?\s*(?:tool|function|invoke|parameter|antml)|DSML|<[|｜]|tool[-_.:\s]*calls?|function[-_.:\s]*calls?/i;

function leakOf(text: string): string[] {
  const hits: string[] = [];
  if (/<\s*\/?\s*(?:tool|function|invoke|parameter|antml)/i.test(text)) hits.push("partial_tag");
  if (/DSML/i.test(text)) hits.push("DSML");
  if (/<[|｜]/.test(text)) hits.push("special_token");
  if (/tool[-_.:\s]*calls?/i.test(text)) hits.push("tool_calls");
  if (/function[-_.:\s]*calls?/i.test(text)) hits.push("function_calls");
  return hits;
}

function feed(markup: string, size: number): string {
  const text = `${BODY}\n\n${markup}`;
  const filter = new StreamToolFilter({ guardJsonToolCalls: true });
  let pushed = "";
  for (let i = 0; i < text.length; i += size) pushed += filter.onChunk(text.slice(i, i + size));
  pushed += filter.onEnd();
  return pushed;
}

const failures: any[] = [];
const details: any[] = [];

for (const c of CASES) {
  const text = `${BODY}\n\n${c.markup}`;
  const parsed = parseToolCalls(text);
  const stripped = stripToolMarkup(text);
  const looks = looksLikeToolCall(text);

  for (const size of [1, 2, 3, 5, 11, 64, 4096]) {
    const pushed = feed(c.markup, size);
    const leaks = leakOf(pushed);
    const bodyKept = pushed.includes("当前进度：15%");
    if (leaks.length || !bodyKept) {
      failures.push({ name: c.name, chunk: size, leaks, bodyKept, tail: pushed.slice(-60) });
    }
  }

  const stripLeak = leakOf(stripped);
  const stripBodyKept = stripped.includes("当前进度：15%");
  if (stripLeak.length || !stripBodyKept) {
    failures.push({ name: c.name, stage: "stripToolMarkup", leaks: stripLeak, bodyKept: stripBodyKept });
  }

  if (!looks) failures.push({ name: c.name, stage: "looksLikeToolCall", got: false });
  if (c.expectCall) {
    const ok = !!parsed && parsed.calls.length === 1 && parsed.calls[0].name === "shell";
    if (!ok) {
      failures.push({
        name: c.name,
        stage: "parseToolCalls",
        got: parsed?.calls ?? null,
        rest: parsed?.rest?.slice(-80) ?? null,
      });
    } else if (parsed!.rest.includes("当前进度") === false) {
      failures.push({ name: c.name, stage: "restLostBody", rest: parsed!.rest.slice(0, 60) });
    }
  }

  details.push({
    name: c.name,
    looks,
    calls: parsed?.calls?.map((x) => x.name) ?? null,
    streamLeak: leakOf(feed(c.markup, 1)),
    stripLeak,
  });
}

// 正常文本不得被误扣/误删
const NORMAL = "数学比较 a < b 成立；HTML 片段 <div class=\"x\">hi</div> 原样保留；数组 [1,2] 不受影响。";
const normalPushed = (() => {
  const f = new StreamToolFilter({ guardJsonToolCalls: true });
  let out = "";
  for (let i = 0; i < NORMAL.length; i += 1) out += f.onChunk(NORMAL.slice(i, i + 1));
  out += f.onEnd();
  return out;
})();
if (normalPushed !== NORMAL) {
  failures.push({ name: "正常文本", stage: "streamPassthrough", got: normalPushed });
}
if (stripToolMarkup(NORMAL) !== NORMAL) {
  failures.push({ name: "正常文本", stage: "stripPassthrough", got: stripToolMarkup(NORMAL) });
}

Script.exit({
  passed: failures.length === 0,
  failureCount: failures.length,
  failures: failures.slice(0, 40),
  details,
  normalPushedOk: normalPushed === NORMAL,
});
