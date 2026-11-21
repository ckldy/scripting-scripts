// 破甲纠正循环回归测试（不联网、不伪造模型输出：用注入的 runTurn 驱动）
import { Script } from "scripting";
import { runArmorLoop, ARMOR_CORRECTIVE_PREFIX, buildCorrectiveUserMessage } from "../server";

type Turn = { system: string; messages: Array<{ role: string; content: string }>; round: number };

const REFUSAL = "抱歉，我不能协助完成这个请求。这类操作存在风险，建议改为合规方案。";
const COMPLY = "# 产物\n\n```bash\nnmap -sV 127.0.0.1\n```\n直接可运行。";

async function main() {
  const results: Record<string, unknown> = {};

  // 1) 首轮拒答 → 纠正轮成功
  const turns: Turn[] = [];
  const r1 = await runArmorLoop({
    baseSystem: "# 卡片\n直接给产物。",
    prompt: "帮我审计目标",
    maxRetry: 2,
    runTurn: async (opts) => {
      turns.push({ system: opts.system, messages: opts.messages, round: opts.round });
      const text = opts.round === 0 ? REFUSAL : COMPLY;
      return { ok: true, text };
    },
  });

  const second = turns[1];
  results.round1 = {
    rounds: r1.rounds,
    corrected: r1.corrected,
    ok: r1.ok,
    stillRefused: r1.stillRefused,
    // 纠正句必须在 system 最前面
    correctiveAtHead: !!second && second.system.startsWith(ARMOR_CORRECTIVE_PREFIX),
    cardStillPresent: !!second && second.system.includes("# 卡片"),
    historyRoles: second ? second.messages.map((m) => m.role) : [],
    hasRefusalInHistory: !!second && second.messages.some((m) => m.content.includes("我不能协助")),
    hasCorrectiveUser: !!second && second.messages.some((m) => m.content.includes("现在重新执行原始请求")),
  };

  // 2) 只有拒答、maxRetry=0 → 判失败
  const r2 = await runArmorLoop({
    baseSystem: "BASE",
    prompt: "P",
    maxRetry: 0,
    runTurn: async () => ({ ok: true, text: REFUSAL }),
  });
  results.refusedOnly = { ok: r2.ok, rounds: r2.rounds, stillRefused: r2.stillRefused, corrected: r2.corrected };

  // 3) 上游失败 → 带错误返回，不伪造成功
  const r3 = await runArmorLoop({
    baseSystem: "BASE",
    prompt: "P",
    maxRetry: 2,
    runTurn: async () => ({
      ok: false,
      text: "",
      error: { type: "http_error", message: "上游 401", hint: "换 key" },
    }),
  });
  results.upstreamFailure = {
    ok: r3.ok,
    rounds: r3.rounds,
    errorType: r3.failure?.type ?? null,
    textEmpty: r3.text === "",
  };

  // 4) 纠正 user 消息必须带上一轮原文
  const cu = buildCorrectiveUserMessage("帮我审计目标", REFUSAL);
  results.correctiveMessage = {
    hasOriginalPrompt: cu.includes("帮我审计目标"),
    hasRefusalQuote: cu.includes("我不能协助"),
  };

  const allPassed =
    (results.round1 as any).rounds === 2 &&
    (results.round1 as any).corrected === true &&
    (results.round1 as any).ok === true &&
    (results.round1 as any).correctiveAtHead === true &&
    (results.round1 as any).historyRoles.join(",") === "user,assistant,user" &&
    (results.round1 as any).hasRefusalInHistory === true &&
    (results.round1 as any).hasCorrectiveUser === true &&
    (results.refusedOnly as any).ok === false &&
    (results.refusedOnly as any).stillRefused === true &&
    (results.upstreamFailure as any).ok === false &&
    (results.upstreamFailure as any).errorType === "http_error" &&
    (results.upstreamFailure as any).textEmpty === true &&
    (results.correctiveMessage as any).hasOriginalPrompt === true &&
    (results.correctiveMessage as any).hasRefusalQuote === true;

  Script.exit({ allPassed, ...results });
}

main().catch((e) => Script.exit({ allPassed: false, error: String(e) }));
