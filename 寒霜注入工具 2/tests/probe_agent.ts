// 只读探测：确认 ScriptingAgent 技能/工作区 API 在本机可用
import { Script } from "scripting";

declare const ScriptingAgent: any;

async function main() {
  const out: any = {};
  try {
    out.hasAgent = typeof ScriptingAgent !== "undefined";
    out.methods = out.hasAgent
      ? ["run", "listSkills", "createSkill", "updateSkill", "getSkill", "listWorkspaces", "createWorkspace", "listProviders"]
          .filter((m) => typeof ScriptingAgent[m] === "function")
      : [];
    if (out.hasAgent && typeof ScriptingAgent.listWorkspaces === "function") {
      const ws = await ScriptingAgent.listWorkspaces();
      out.workspaces = (ws || []).map((w: any) => ({ id: w.id, name: w.name }));
    }
    if (out.hasAgent && typeof ScriptingAgent.listSkills === "function") {
      const sk = await ScriptingAgent.listSkills({ includeDisabled: true });
      out.skills = (sk || []).map((s: any) => ({ id: s.id, name: s.name, userManaged: s.isUserManaged }));
    }
    if (out.hasAgent && typeof ScriptingAgent.listProviders === "function") {
      const p = await ScriptingAgent.listProviders();
      out.providers = (p || []).map((x: any) => ({ id: x.id, name: x.name }));
    }
  } catch (e) {
    out.error = String(e);
  }
  console.log(JSON.stringify(out, null, 2));
  Script.exit("ok");
}

main();
