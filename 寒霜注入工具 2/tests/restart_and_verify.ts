// 重启网关（run_single）并复检是否已载入新代码
import { Script } from "scripting";

declare const fetch: any;

async function keepalive(): Promise<any> {
  try {
    const res = await fetch("http://127.0.0.1:5190/api/keepalive");
    return await res.json();
  } catch (e: any) {
    return { error: String(e?.message || e) };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise<void>((r) => setTimeout(r, ms));
}

async function main() {
  const before = await keepalive();
  const oldStart = before?.keepAlive?.startTime ?? null;

  // run_single 会终止同脚本的其他实例并启动新实例
  try {
    await Safari.openURL("scripting://run_single/寒霜注入工具 2");
  } catch (e: any) {
    return Script.exit({ stage: "openURL", error: String(e?.message || e), oldStart });
  }

  let after: any = {};
  let restarted = false;
  for (let i = 0; i < 24; i++) {
    await sleep(5000);
    after = await keepalive();
    const t = after?.keepAlive?.startTime ?? null;
    if (after?.ok && t && t !== oldStart) {
      restarted = true;
      break;
    }
  }

  let streamPort = 0;
  try {
    const r = await fetch("http://127.0.0.1:5195/v1/models");
    streamPort = r.status;
  } catch {}

  Script.exit({
    oldStart,
    newStart: after?.keepAlive?.startTime ?? null,
    restarted,
    keepalive: after,
    streamPortStatus: streamPort,
  });
}

main();
