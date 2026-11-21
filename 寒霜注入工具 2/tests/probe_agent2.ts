// 探测：在真实脚本运行时里访问 ScriptingAgent，并测 attachments 是否可用
import { Script } from "scripting";

async function main() {
  const out: any = {};

  // 用 Function 构造器绕开 TS 静态分析，模拟 server.ts 的裸标识符取法
  let agent: any = null;
  try {
    agent = new Function("return typeof ScriptingAgent !== 'undefined' ? ScriptingAgent : null")();
  } catch (e) {
    out.accessError = String(e);
  }
  out.gotAgent = !!agent;
  out.methods = agent
    ? ["run", "listSkills", "createSkill", "updateSkill", "listWorkspaces", "listProviders"]
        .filter((m) => typeof agent[m] === "function")
    : [];

  if (agent && typeof agent.listSkills === "function") {
    try {
      const sk = await agent.listSkills({ includeDisabled: true });
      out.skillCount = (sk || []).length;
      out.skillSample = (sk || []).slice(0, 5).map((s: any) => ({ id: s.id, name: s.name }));
    } catch (e) {
      out.skillError = String(e);
    }
  }

  if (agent && typeof agent.listWorkspaces === "function") {
    try {
      const ws = await agent.listWorkspaces();
      out.workspaces = (ws || []).map((w: any) => ({ id: w.id, name: w.name }));
    } catch (e) {
      out.wsError = String(e);
    }
  }

  console.log(JSON.stringify(out, null, 2));
  Script.exit("ok");
}

main();
