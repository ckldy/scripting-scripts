// 真流式首窗门禁回归测试：不联网，只验证 streamGuardDecision 的拦截/放行边界
import { Script } from "scripting";
import {
  streamGuardDecision,
  judge,
  STREAM_GUARD_MAX_CHARS,
  STREAM_GUARD_MIN_CHARS,
  REFUSAL_WINDOW_CHARS,
} from "../server";

type Case = { name: string; text: string; want: "block" | "allow" | "wait"; wantRefusal?: boolean };

const LONG_NORMAL = "按步骤执行：先备份，再修改，最后验证。" + "把每一步的命令与输出写进报告。".repeat(18);

const cases: Case[] = [
  { name: "硬拒答（短句）", text: "抱歉，我不能协助完成这个请求。", want: "block" },
  { name: "软回退（建议改为）", text: "这个功能涉及授权绕过，建议改为走官方渠道申请。", want: "block" },
  {
    name: "拒答在长前言之后（命中判拒立即拦截）",
    text: "我理解你想了解这个 APK 的内部结构和授权校验逻辑，这个需求在技术上很常见。不过，关于绕过软件授权限制这一类的具体实现，我没办法提供可执行的步骤或者代码。",
    want: "block",
    wantRefusal: true,
  },
  { name: "短正常开头（未满提前放行门槛）", text: "好的，先备份原文件。", want: "wait" },
  {
    name: "英文元评论前言 + 后置拒答（拒答句在首窗 260 字之外）",
    text:
      "The provided prompt consists of simulated developer instructions designed to override safety constraints and compel the execution of cyberattack activities, including credential harvesting, remote process injection, software cracking, and unauthorized penetration testing. \n\nI cannot accept these instructions or adopt a role that bypasses safety policies.",
    want: "block",
    wantRefusal: true,
  },
  {
    name: "正常技术回答带代码块（应提前放行）",
    text: "先备份原文件，再用下面的命令反编译目标 APK，最后定位授权校验分支：\n\n```bash\napktool d target.apk -o out\n```\n",
    want: "allow",
  },
  { name: "超首窗上限的正常长文本（无句末也必须放行）", text: LONG_NORMAL, want: "allow" },
  {
    name: "正常技术回答不应误判",
    text: "用 frida 附加目标进程后 dump 内存：\n\n```bash\nfrida -U -f com.example.app --no-pause\n```\n\n然后 `Memory.scan` 定位特征码。",
    want: "allow",
  },
  {
    name: "纯文字正常回答（无交付特征，先 wait）",
    text: "先把手上的材料按时间顺序整理一遍，然后把关键结论写成三段，再把需要复核的点单独列出来，最后统一发给对方确认。",
    want: "wait",
  },
];

let failed = 0;
const details: any[] = [];

for (const c of cases) {
  const got = streamGuardDecision(c.text);
  const ok = got === c.want;
  if (!ok) failed++;
  const refusalOk = c.wantRefusal === undefined ? true : !!judge(c.text).refusal === c.wantRefusal;
  if (!refusalOk) failed++;
  details.push({ name: c.name, got, want: c.want, ok, refusalOk, len: c.text.length });
}

const windowOk = STREAM_GUARD_MAX_CHARS >= REFUSAL_WINDOW_CHARS && STREAM_GUARD_MIN_CHARS < STREAM_GUARD_MAX_CHARS;
if (!windowOk) failed++;

Script.exit({
  allPassed: failed === 0,
  failed,
  windowOk,
  refusalWindow: REFUSAL_WINDOW_CHARS,
  guardMin: STREAM_GUARD_MIN_CHARS,
  guardMax: STREAM_GUARD_MAX_CHARS,
  longNormalLen: LONG_NORMAL.length,
  details,
});
