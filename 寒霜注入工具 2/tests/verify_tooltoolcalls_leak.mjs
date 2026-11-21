import fs from "node:fs";

const ROOT = "/var/mobile/Library/Mobile Documents/iCloud~com~thomfang~Scripting/Documents/scripts/寒霜注入工具 2";
const NEWP = ROOT + "/server.ts";
const OLDP = ROOT + "/server.ts.bak-20261121-2145";

function loadRules(p) {
  const lines = fs.readFileSync(p, "utf8").split("\n");
  let startRe = "";
  let tags = [];
  for (let i = 0; i < lines.length; i++) {
    if (!startRe && lines[i].includes("const TOOL_MARKUP_START_RE")) {
      const inline = lines[i].slice(lines[i].indexOf("=") + 1).trim();
      startRe = (inline.startsWith("/") ? inline : lines[i + 1].trim()).replace(/;\s*$/, "");
    }
    if (!tags.length && lines[i].includes("const TOOL_TAG_NAMES = [")) {
      for (let j = i + 1; j < lines.length; j++) {
        const m = /"([^"]+)"/.exec(lines[j]);
        if (m) tags.push(m[1]);
        if (lines[j].includes("];")) break;
      }
    }
  }
  return { re: new Function("return " + startRe)(), tags, startRe };
}

function makeFilter(rules) {
  const RE = rules.re;
  const TAGS = rules.tags;
  let acc = "";
  let pushed = 0;
  let capturing = false;
  let jsonHold = -1;

  const objEnd = (t, s) => {
    let d = 0;
    let inStr = false;
    let esc = false;
    for (let i = s; i < t.length; i++) {
      const c = t[i];
      if (inStr) {
        if (esc) esc = false;
        else if (c.charCodeAt(0) === 92) esc = true;
        else if (c === String.fromCharCode(34)) inStr = false;
        continue;
      }
      if (c === String.fromCharCode(34)) inStr = true;
      else if (c === "{") d++;
      else if (c === "}") {
        d--;
        if (d === 0) return i;
      }
    }
    return -1;
  };

  const looksJsonCall = (chunk) => {
    try {
      const o = JSON.parse(chunk);
      if (!o || typeof o !== "object") return false;
      if (Array.isArray(o.tool_calls)) return true;
      const name = o.name || o.tool || (o.function_call && o.function_call.name) || (o.function && o.function.name);
      const args = o.arguments !== undefined ? o.arguments : o.parameters !== undefined ? o.parameters : o.input !== undefined ? o.input : o.args;
      return typeof name === "string" && /^[A-Za-z_][\w.:-]*$/.test(name) && args !== undefined;
    } catch (e) {
      return false;
    }
  };

  const captureAt = (idx) => {
    capturing = true;
    if (idx > pushed) {
      const out = acc.slice(pushed, idx);
      pushed = idx;
      return out;
    }
    return "";
  };

  const holdLen = () => {
    const t = acc;
    const n = t.length;
    if (!n) return 0;
    const maxLen = Math.min(n - pushed, 32);
    for (let len = maxLen; len >= 1; len--) {
      const suffix = t.slice(n - len);
      if (/^<\s*\/?\s*$/.test(suffix)) return len;
      const tag = /^<\s*\/?\s*([a-z_:][a-z_: ]*)$/i.exec(suffix);
      if (tag) {
        const partial = tag[1].toLowerCase().replace(/[\s_]+/g, "");
        if (!partial) return len;
        if (TAGS.some((nm) => nm.replace(/_/g, "").startsWith(partial))) return len;
      }
      if (/^<\s*\/?\s*[｜|]/.test(suffix)) return len;
    }
    const ws = Math.max(0, n - 64);
    const tail = t.slice(ws);
    const kip = /\{\s*"[a-z_]*"?$/i.exec(tail);
    if (kip) return kip[0].length;
    return 0;
  };

  const scanJson = () => {
    const t = acc;
    const re = /\{\s*"(?:tool_calls|tool_call|function_call|name|tool)"\s*:/gi;
    let cand = null;
    let m;
    while ((m = re.exec(t)) !== null) {
      if (m.index + m[0].length > pushed) cand = m;
    }
    if (!cand) return null;
    const start = cand.index;
    const end = objEnd(t, start);
    if (end < 0) {
      jsonHold = start;
      if (start > pushed) {
        const out = t.slice(pushed, start);
        pushed = start;
        return out;
      }
      return "";
    }
    const chunk = t.slice(start, end + 1);
    if (/\{\s*"(?:tool_calls|tool_call|function_call)"\s*:/.test(chunk) || looksJsonCall(chunk)) {
      jsonHold = -1;
      return captureAt(start);
    }
    jsonHold = -1;
    if (end + 1 > pushed) {
      const out = t.slice(pushed, end + 1);
      pushed = end + 1;
      return out;
    }
    return "";
  };

  return {
    onChunk(text) {
      acc += text;
      if (capturing) return "";
      const marker = RE.exec(acc);
      if (marker) {
        if (marker.index >= pushed) return captureAt(marker.index);
        capturing = true;
        return "";
      }
      const h = scanJson();
      if (h !== null) return h;
      const hold = holdLen();
      const safe = acc.length - hold;
      if (safe > pushed) {
        const out = acc.slice(pushed, safe);
        pushed = safe;
        return out;
      }
      return "";
    },
    onEnd() {
      if (capturing) return "";
      if (jsonHold >= 0) return "";
      const hold = holdLen();
      const safe = acc.length - hold;
      if (safe > pushed) {
        const out = acc.slice(pushed, safe);
        pushed = safe;
        return out;
      }
      return "";
    },
    pushedText() {
      return acc.slice(0, pushed);
    },
  };
}

const BODY =
  "当前进度：0%｜开始执行 beta4 升级，预计 5 步：备份配置 → 拉取镜像 → 核对镜像参数 → 重建容器 → 验证版本与健康状态";
const LEAK =
  BODY +
  "\n\n" +
  "<tool_tool_calls>" +
  "\n" +
  '{"name":"shell","arguments":{"action":"exec","command":"docker pull x"}}' +
  "\n" +
  "</tool_tool_calls>";
const NORMAL = '数学比较 a < b 成立；配置片段 {"x":1} 原样保留；数组 [1,2] 不受影响。';

function run(rules, sample, size) {
  const f = makeFilter(rules);
  let out = "";
  for (let i = 0; i < sample.length; i += size) out += f.onChunk(sample.slice(i, i + size));
  out += f.onEnd();
  return out;
}

const newR = loadRules(NEWP);
const oldR = loadRules(OLDP);

const report = [];
for (const size of [1, 3, 7, 64]) {
  const oldOut = run(oldR, LEAK, size);
  const newOut = run(newR, LEAK, size);
  const normalOut = run(newR, NORMAL, size);
  report.push({
    size,
    oldLeak: /tool_tool_calls|<\s*tool/i.test(oldOut),
    oldTail: oldOut.slice(-50),
    newLeak: /tool_tool_calls|<\s*tool/i.test(newOut),
    newTail: newOut.slice(-30),
    normalIntact: normalOut.includes("a < b") && normalOut.includes('{"x":1}') && normalOut.includes("[1,2]"),
  });
}

console.log("newRegex:", newR.startRe);
console.log("newTags:", newR.tags.join(","));
console.log("oldRegex:", oldR.startRe);
console.log(JSON.stringify(report, null, 2));
const pass = report.every((r) => r.newLeak === false && r.normalIntact === true);
const ab = report.some((r) => r.oldLeak === true);
console.log("AB_OLD_LEAKS:", ab, "| NEW_CLEAN_AND_SAFE:", pass);
process.exit(pass && ab ? 0 : 1);
