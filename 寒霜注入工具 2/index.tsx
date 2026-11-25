/**
 * 寒霜注入工具 — Scripting 入口与原生控制台
 * 
 * 核心功能：
 * 1. 启动常驻 HttpServer，提供 REST API 与 /v1 网关代理（WebUI 已下线）
 * 2. 全部操作在原生 SwiftUI 控制台完成
 * 3. 原生 SwiftUI 控制面板：展示网关状态、IP/端口、当前人物卡、快速复制端点、预设模板一键装载
 * 4. 内置 Scripting 专属注入验证与一键破甲测试
 */

import {
  Script,
  Navigation,
  NavigationStack,
  List,
  Section,
  DisclosureGroup,
  HStack,
  VStack,
  Text,
  Button,
  Picker,
  Spacer,
  Image,
  Path,
  useState,
  useEffect,
  useCallback,
} from "scripting";

import {
  store,
  selfHealer,
  SelfHealStatus,
  handleApiRoute,
  PromptCard,
  backgroundManager,
  KeepAliveInfo,
  KeepAliveMode,
  requestGlobalExit,
  isGlobalExitRequested,
  SCRIPTING_DOCS_DIR,
  buildWorkspacesOverview,
  runWorkspaceArmor,
  getWorkspaceArmorState,
  saveWorkspaceArmorState,
  WorkspacesOverview,
  WorkspaceArmorScope,
  recordGatewayStatus,
  recordApiError,
  discoverProviders,
  readEnginePoolConfig,
  saveEnginePoolConfig,
  syncGatewayProviderModels,
  EngineProvider,
  EnginePoolConfig,
  handleStreamChatCompletions,
} from "./server";
import { StreamEngine } from "./stream_engine";

declare const fetch: any;

/* ================================================================== *
 * 辅助函数
 * ================================================================== */

/**
 * 版本号唯一真源：运行时读 script.json。
 * 不能用 Script.metadata.version —— 宿主读的是安装时缓存的那份清单，
 * 实测脚本目录里已是 1.2.5 时它仍返回 1.0.0（历史版本号漂移的真因）。
 */
let cachedAppVersion: string | null = null;

function readAppVersion(): string {
  if (cachedAppVersion) return cachedAppVersion;
  try {
    const raw = FileManager.readAsStringSync(Script.directory + "/script.json", "utf-8");
    const v = JSON.parse(String(raw || "{}")).version;
    if (typeof v === "string" && v) {
      cachedAppVersion = v;
      return v;
    }
  } catch (e) {
    console.warn("[版本] 读取 script.json 失败：", String(e));
  }
  return "未知";
}

function formatDuration(sec: number): string {
  if (sec < 60) return `${sec} 秒`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m < 60) return `${m} 分 ${s} 秒`;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  return `${h} 小时 ${remM} 分`;
}

/* ================================================================== *
 * 网关全局服务单例
 * ================================================================== */

let globalServer: HttpServer | null = null;
let serverActualPort = 5190;

/** 真流式独占端口：只承载 stream:true 的 SSE 推送，与主网关彻底解耦 */
const TRUE_STREAM_PORT = 5195;
let globalStreamEngine: StreamEngine | null = null;

/** 网关最近一次启动错误（供控制台展示与排查） */
let gatewayLastError: string | null = null;

function getGatewayLastError(): string | null {
  return gatewayLastError;
}

/**
 * 把一个 HttpServer 装配好（中间件 + SPA 兜底）并真正校验启动结果。
 * 官方 API：start() 返回错误字符串，成功返回 null；port 在未运行时为 null。
 * 旧实现完全忽略返回值，端口被占用时会「假启动」——server.state 停在 stopped
 * 而代码仍对外宣称监听 5190，客户端于是连不上网关。
 */
function bootServer(port: number): HttpServer {
  const server = new HttpServer();

  // 核心中间件：优先拦截与处理 /api/*、/armor 与 /v1/* 请求
  server.registerMiddleware(async (req: HttpRequest) => {
    const isApi = req.path.startsWith("/api/") || req.path.startsWith("/v1/");
    try {
      const apiRes = await handleApiRoute(req, server.port ?? port);
      if (apiRes) return apiRes;
      // API 未命中必须回 JSON：若落到静态托管会返回 index.html，前端 JSON 解析失败会整页崩
      if (isApi) {
        return HttpResponse.raw(404, "Not Found", {
          headers: { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" },
          body: Data.fromRawString(JSON.stringify({ error: "not_implemented", path: req.path }), "utf-8")!,
        });
      }
    } catch (err) {
      console.error("handleApiRoute error", err);
      recordApiError(req.path, err);
      if (isApi) {
        return HttpResponse.raw(500, "Internal Server Error", {
          headers: { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" },
          body: Data.fromRawString(
            JSON.stringify({ error: "internal_error", message: String(err), path: req.path }),
            "utf-8"
          )!,
        });
      }
    }
    return null; // 透传至静态文件处理
  });

  // 兜底处理器：WebUI 已下线，未命中一律 404（只保留 /api、/v1、/armor）
  server.setNotFoundHandler(async (_req: HttpRequest) => {
    return HttpResponse.notFound();
  });

  const startError = server.start({
    port,
    forceIPv4: true,
    maxRequestBodySize: 32 * 1024 * 1024,
  });

  if (startError) {
    throw new Error(`start() 返回错误：${startError}`);
  }
  if (server.state !== "running" || !server.port) {
    throw new Error(`端口 ${port} 未进入 running 状态 (state=${server.state}, port=${server.port})`);
  }
  return server;
}

/**
 * 启动独占端口的真流式引擎。
 * 失败绝不影响主网关：只在控制台显示一行告警。
 */
function startTrueStreamEngine(): boolean {
  if (globalStreamEngine && globalStreamEngine.isRunning()) return true;
  try {
    const engine = new StreamEngine({
      port: TRUE_STREAM_PORT,
      mainGatewayPort: serverActualPort || 5190,
      onStreamRequest: async (req, writeChunk, close) => {
        await handleStreamChatCompletions(req.body, writeChunk, close, serverActualPort || 5190);
      },
    });
    globalStreamEngine = engine;
    engine
      .start()
      .then(() => {
        console.log(`[寒霜注入工具] 真流式引擎已就绪 -> http://127.0.0.1:${TRUE_STREAM_PORT}/v1`);
      })
      .catch((err: any) => {
        console.warn("[寒霜注入工具] 真流式引擎启动失败（主网关不受影响）:", err?.message || String(err));
        globalStreamEngine = null;
      });
    return true;
  } catch (e) {
    console.warn("[寒霜注入工具] 真流式引擎初始化异常（主网关不受影响）:", String(e));
    globalStreamEngine = null;
    return false;
  }
}

function stopTrueStreamEngine(): void {
  if (globalStreamEngine) {
    try {
      globalStreamEngine.stop();
    } catch {}
    globalStreamEngine = null;
    console.log("[寒霜注入工具] 真流式引擎已停止");
  }
}

function getTrueStreamPort(): number {
  return globalStreamEngine && globalStreamEngine.isRunning() ? TRUE_STREAM_PORT : 0;
}

function startHttpServer(port = 5190): number {
  if (globalServer && globalServer.state === "running" && globalServer.port) {
    return globalServer.port;
  }

  try {
    const server = bootServer(port);
    globalServer = server;
    serverActualPort = server.port as number;
    gatewayLastError = null;
    selfHealer.startDaemon(15000);
    console.log(`[寒霜注入工具] 服务已启动，端口: ${serverActualPort}，自愈守护已开启`);
    recordGatewayStatus(true, serverActualPort);
    startTrueStreamEngine();
    return serverActualPort;
  } catch (e) {
    const firstError = String(e);
    console.error(`[寒霜注入工具] 端口 ${port} 启动失败：${firstError}，改用随机端口重试`);
    try {
      const server = bootServer(0);
      globalServer = server;
      serverActualPort = server.port as number;
      gatewayLastError = `指定端口 ${port} 不可用（${firstError}），已回退随机端口 ${serverActualPort}`;
      selfHealer.startDaemon(15000);
      console.log(`[寒霜注入工具] 已回退到随机端口 ${serverActualPort}（网关可用，但请同步更新 Provider baseURL）`);
      recordGatewayStatus(true, serverActualPort, gatewayLastError);
      startTrueStreamEngine();
      return serverActualPort;
    } catch (err2) {
      gatewayLastError = `网关启动彻底失败：${String(err2)}`;
      recordGatewayStatus(false, 0, gatewayLastError);
      console.error("[寒霜注入工具] 致命错误：随机端口依然失败", err2);
      return 0;
    }
  }
}

export { getTrueStreamPort, TRUE_STREAM_PORT };

function genUUID(): string {
  const hex = "0123456789ABCDEF";
  let s = "";
  for (let i = 0; i < 32; i++) s += hex[Math.floor(Math.random() * 16)];
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-4${s.slice(13, 16)}-A${s.slice(17, 20)}-${s.slice(20, 32)}`;
}

/**
 * 把旧 schema 的 provider 条目升级到 App 当前使用的完整 schema。
 * 依据：App 自己写入的条目为 13 个供应商级键 / 25 个模型级键；
 * 冲突副本里的旧条目只有 7~8 键 / 17 键，缺 providerID 等，
 * 直接放回去 App 解码失败 → AgentProviderConnectionError。
 */
async function normalizeProviders(): Promise<void> {
  const sp = Path.join(SCRIPTING_DOCS_DIR, ".scripting");
  const activePath = Path.join(sp, "agent-custom-providers.json");
  const goodPath = Path.join(sp, "agent-custom-providers.json.hs-backup");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");

  const readArr = (p: string): any[] => {
    try {
      if (!FileManager.existsSync(p)) return [];
      const v = JSON.parse(FileManager.readAsStringSync(p, "utf-8") || "[]");
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  };

  const cur = readArr(activePath);
  const good = readArr(goodPath);
  console.log(`[norm] 当前 ${cur.length} 项，参考(旧备份) ${good.length} 项`);
  if (cur.length === 0) {
    console.log("[norm] 当前为空，终止");
    return;
  }

  const providerDefaults: Record<string, any> = {
    credentialStorageVersion: 1,
    fixedHeaderNames: [],
    headerBindings: {},
    supportsGeminiFiles: false,
    customHeaders: {},
  };
  const modelDefaults: Record<string, any> = {
    cacheReadsPrice: null,
    cacheWritesPrice: null,
    catalogAutomaticFields: null,
    chatCompletionsCompatibility: null,
    imageApiMode: null,
    imageOnly: null,
    inputPrice: null,
    outputPrice: null,
    providerInputTokenLimit: null,
    providerOutputTokenLimit: null,
    reasoningEffort: "medium",
    requestUserAgent: null,
    supportedGenerationMethods: null,
    supportsAudio: null,
    supportsGenerateImage: null,
    supportsImageEdit: null,
    supportsPDF: null,
    supportsPromptCache: false,
    supportsReasoningSummaries: null,
    supportsVideo: null,
    temperature: null,
    thinking: false,
  };

  let filledProvider = 0;
  let filledModel = 0;
  let idFromRef = 0;
  let idGenerated = 0;

  for (const p of cur) {
    if (!p) continue;
    const ref = good.find((g: any) => String(g?.baseUrl || "") === String(p.baseUrl || ""));
    // providerID：优先沿用旧备份里同 baseUrl 的 ID，否则生成
    if (!p.providerID) {
      if (ref?.providerID) {
        p.providerID = ref.providerID;
        idFromRef++;
      } else {
        p.providerID = genUUID();
        idGenerated++;
      }
    }
    // apiKeyRevision：旧备份里有就回填，避免密钥与供应商解绑（缺失时用户需重新填 key）
    if (!p.apiKeyRevision && ref?.apiKeyRevision) {
      p.apiKeyRevision = ref.apiKeyRevision;
      console.log(`[norm] ${p.name} 回填 apiKeyRevision`);
    }
    for (const k of Object.keys(providerDefaults)) {
      if (!(k in p)) {
        p[k] = providerDefaults[k];
        filledProvider++;
      }
    }
    if (p.modelInfos && typeof p.modelInfos === "object") {
      for (const mid of Object.keys(p.modelInfos)) {
        const m = p.modelInfos[mid];
        if (!m || typeof m !== "object") continue;
        for (const k of Object.keys(modelDefaults)) {
          if (!(k in m)) {
            m[k] = modelDefaults[k];
            filledModel++;
          }
        }
      }
    }
  }
  console.log(
    `[norm] 补齐供应商级字段 ${filledProvider} 个、模型级字段 ${filledModel} 个；providerID 沿用 ${idFromRef} 个、新生成 ${idGenerated} 个`
  );

  try {
    const raw = FileManager.readAsStringSync(activePath, "utf-8") || "";
    const bak = `${activePath}.bak-normalize-${stamp}`;
    FileManager.writeAsStringSync(bak, raw, "utf-8");
    console.log(`[norm] 已备份 -> ${bak}`);
  } catch (e) {
    console.log(`[norm] 备份失败，终止 :: ${String(e)}`);
    return;
  }

  const out = JSON.stringify(cur, null, 2);
  FileManager.writeAsStringSync(activePath, out, "utf-8");
  console.log(`[norm] 已写入 ${cur.length} 项，${out.length} 字节`);

  await new Promise<void>((r) => setTimeout(r, 1200));
  const verify = readArr(activePath);
  console.log(`[norm] 回读 ${verify.length} 项`);
  verify.forEach((it: any, i: number) => {
    const pk = Object.keys(it).length;
    const mk = it?.modelInfos ? Object.keys(it.modelInfos).length : 0;
    const firstModel = it?.modelInfos ? it.modelInfos[Object.keys(it.modelInfos)[0]] : null;
    console.log(
      `[norm]   ${i}: ${it?.name} | keys=${pk} | 模型=${mk} | 首模型键=${firstModel ? Object.keys(firstModel).length : 0} | providerID=${it?.providerID}`
    );
  });
}

async function fixDefaultRef(): Promise<void> {
  const sp = Path.join(SCRIPTING_DOCS_DIR, ".scripting");
  const pvPath = Path.join(sp, "agent-custom-providers.json");
  const gsPath = Path.join(sp, "agent-global-settings.json");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");

  const pv = JSON.parse(FileManager.readAsStringSync(pvPath, "utf-8") || "[]");
  const gs = JSON.parse(FileManager.readAsStringSync(gsPath, "utf-8") || "{}");
  const pd = gs.providerDefaults || {};
  const wantId = String(pd.defaultProviderID || "");
  const wantName = String(pd.defaultCustomProviderId || "");
  console.log(`[fix] 期望默认: id=${wantId} name=${wantName}`);

  const hit = (Array.isArray(pv) ? pv : []).find((x: any) => String(x?.providerID || "") === wantId);
  if (!hit) {
    console.log("[fix] 按 defaultProviderID 找不到条目，改用名字匹配");
    const byName = (Array.isArray(pv) ? pv : []).find((x: any) => String(x?.name || "") === wantName);
    if (!byName) {
      console.log("[fix] 名字也匹配不到，无法修复默认引用");
      return;
    }
    pd.defaultProviderID = byName.providerID;
    console.log(`[fix] 已把 defaultProviderID 校正为 ${byName.providerID}`);
  } else {
    console.log(`[fix] 命中条目 name=${hit.name} id=${hit.providerID}`);
    if (wantName && hit.name !== wantName) {
      console.log(`[fix] 重命名 ${hit.name} -> ${wantName}（与 defaultCustomProviderId 对齐）`);
      hit.name = wantName;
    }
  }

  const target = (Array.isArray(pv) ? pv : []).find((x: any) => String(x?.providerID || "") === String(pd.defaultProviderID));
  const curModel = String(pd.defaultModelId || "");
  if (target && curModel && !(target.modelInfos && target.modelInfos[curModel])) {
    const fallback = target.currentModelId || Object.keys(target.modelInfos || {})[0];
    if (fallback) {
      pd.defaultModelId = fallback;
      target.currentModelId = fallback;
      console.log(`[fix] defaultModelId ${curModel} 不存在于该供应商，改为 ${fallback}`);
    }
  } else if (target && curModel) {
    console.log(`[fix] defaultModelId ${curModel} 在该供应商模型列表中，正常`);
  }

  // 备份
  try {
    FileManager.writeAsStringSync(`${pvPath}.bak-fixref-${stamp}`, FileManager.readAsStringSync(pvPath, "utf-8") || "", "utf-8");
    FileManager.writeAsStringSync(`${gsPath}.bak-fixref-${stamp}`, FileManager.readAsStringSync(gsPath, "utf-8") || "", "utf-8");
    console.log("[fix] 两份文件已备份");
  } catch (e) {
    console.log(`[fix] 备份失败，终止 :: ${String(e)}`);
    return;
  }

  FileManager.writeAsStringSync(pvPath, JSON.stringify(pv, null, 2), "utf-8");
  FileManager.writeAsStringSync(gsPath, JSON.stringify(gs, null, 2), "utf-8");
  console.log("[fix] 已写入");

  await new Promise<void>((r) => setTimeout(r, 1000));
  const pv2 = JSON.parse(FileManager.readAsStringSync(pvPath, "utf-8") || "[]");
  const gs2 = JSON.parse(FileManager.readAsStringSync(gsPath, "utf-8") || "{}");
  const pd2 = gs2.providerDefaults || {};
  const finalHit = (Array.isArray(pv2) ? pv2 : []).find(
    (x: any) => String(x?.providerID || "") === String(pd2.defaultProviderID || "")
  );
  console.log(`[fix] 校验: defaultProvider=${pd2.defaultProvider} name=${pd2.defaultCustomProviderId} model=${pd2.defaultModelId}`);
  console.log(
    `[fix] 校验: 默认条目 ${finalHit ? `已解析 -> ${finalHit.name} (${finalHit.providerID})` : "仍然悬空"}`
  );
  (Array.isArray(pv2) ? pv2 : []).forEach((x: any, i: number) =>
    console.log(`[fix]   ${i} ${x.name} pid=${x.providerID} models=${x.modelInfos ? Object.keys(x.modelInfos).length : 0}`)
  );
}

async function probeDefaults(): Promise<void> {
  const sp = Path.join(SCRIPTING_DOCS_DIR, ".scripting");
  const gp = Path.join(sp, "agent-global-settings.json");
  let g: any = null;
  try {
    g = JSON.parse(FileManager.readAsStringSync(gp, "utf-8") || "{}");
  } catch (e) {
    console.log(`[v5] settings 解析失败 ${String(e)}`);
    return;
  }
  const pd = g.providerDefaults || {};
  for (const k of ["defaultProvider", "defaultProviderID", "defaultCustomProviderId", "defaultModelId"]) {
    console.log(`[v5] ${k} = ${JSON.stringify(pd[k])}`);
  }
  console.log(`[v5] retiredProviders = ${JSON.stringify(pd.retiredProviders).slice(0, 600)}`);
  console.log(`[v5] providerBaseURLs = ${JSON.stringify(pd.providerBaseURLs).slice(0, 600)}`);

  // 现有自定义 provider 的 ID 集合
  let ids: string[] = [];
  try {
    const arr = JSON.parse(FileManager.readAsStringSync(Path.join(sp, "agent-custom-providers.json"), "utf-8") || "[]");
    ids = (Array.isArray(arr) ? arr : []).map((x: any) => String(x?.providerID || ""));
  } catch {}
  console.log(`[v5] 现有自定义 providerID: ${ids.join(" | ")}`);
  const ref = String(pd.defaultCustomProviderId || pd.defaultProviderID || "");
  if (ref) {
    console.log(`[v5] 默认引用 ${ref} -> ${ids.includes(ref) ? "存在" : "悬空(不存在)"}`);
  } else {
    console.log("[v5] 无默认自定义供应商引用");
  }
}

async function probeAllVersions(): Promise<void> {
  const sp = Path.join(SCRIPTING_DOCS_DIR, ".scripting");
  let names: string[] = [];
  try {
    names = FileManager.readDirectorySync(sp);
  } catch (e) {
    console.log(`[v4] 列目录失败 ${String(e)}`);
    return;
  }
  const targets = names.filter((n) => /^agent-custom-providers/i.test(n));
  for (const n of targets) {
    const p = Path.join(sp, n);
    let size = -1;
    try { size = FileManager.statSync(p).size; } catch {}
    let raw = "";
    try { raw = FileManager.readAsStringSync(p, "utf-8") || ""; } catch {}
    console.log(`[v4] === ${n} (${size}B)`);
    try {
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) {
        console.log(`[v4]   非数组: ${typeof arr}`);
        continue;
      }
      console.log(`[v4]   条目 ${arr.length}`);
      arr.forEach((it: any, i: number) => {
        const mk = it?.modelInfos ? Object.keys(it.modelInfos).length : 0;
        console.log(
          `[v4]    ${i} name=${it?.name} keys=${Object.keys(it || {}).length} apiType=${it?.apiType} keyOpt=${it?.apiKeyOptional} models=${mk} pid=${it?.providerID || "无"} rev=${it?.apiKeyRevision ? "有" : "无"}`
        );
      });
    } catch (e) {
      console.log(`[v4]   JSON 解析失败: ${String(e)}  头部=${raw.slice(0, 80)}`);
    }
  }
  // 全局设置里的内置连接
  try {
    const gp = Path.join(sp, "agent-global-settings.json");
    const g = JSON.parse(FileManager.readAsStringSync(gp, "utf-8") || "{}");
    const pd = g.providerDefaults || {};
    console.log(`[v4] global providerDefaults 键: ${Object.keys(pd).join(",")}`);
    const conns = pd?.builtInConnections?.connections;
    if (Array.isArray(conns)) {
      console.log(`[v4] builtInConnections ${conns.length} 条`);
      conns.forEach((c: any, i: number) =>
        console.log(`[v4]    ${i} provider=${c?.provider} id=${c?.id} auth=${c?.authentication} cur=${c?.currentModelId || c?.defaultModelId || "-"}`)
      );
    }
    console.log(`[v4] 其余顶层键: ${Object.keys(g).join(",")}`);
  } catch (e) {
    console.log(`[v4] global-settings 失败 ${String(e)}`);
  }
}

async function probeAllVersionsDummy(): Promise<void> {}

async function probeKeys(): Promise<void> {
  const sp = Path.join(SCRIPTING_DOCS_DIR, ".scripting");
  const files = [
    "agent-custom-providers.json",
    "agent-custom-providers.json.hs-backup",
  ];
  for (const f of files) {
    const p = Path.join(sp, f);
    try {
      const arr = JSON.parse(FileManager.readAsStringSync(p, "utf-8") || "[]");
      if (!Array.isArray(arr)) continue;
      console.log(`[k] ${f} 共 ${arr.length} 项`);
      arr.forEach((it: any, i: number) => {
        console.log(`[k]  ${i} keys(${Object.keys(it).length}): ${Object.keys(it).sort().join(",")}`);
        if (it?.modelInfos) {
          const first = Object.keys(it.modelInfos)[0];
          if (first) {
            const m = it.modelInfos[first];
            console.log(`[k]     modelInfos.${first} keys(${Object.keys(m).length}): ${Object.keys(m).sort().join(",")}`);
          }
        }
      });
    } catch (e) {
      console.log(`[k] ${f} 失败 ${String(e)}`);
    }
  }
}

async function probeAgentConflict(): Promise<void> {
  const ag = (FileManager as any).appGroupDocumentsDirectory as string;
  const ccDir = Path.join(ag, "Agent Conflict Copies");
  const walk = (dir: string, depth: number) => {
    if (depth > 2) return;
    let names: string[] = [];
    try {
      if (!FileManager.existsSync(dir)) {
        console.log(`[v3] 不存在 ${dir}`);
        return;
      }
      names = FileManager.readDirectorySync(dir);
    } catch (e) {
      console.log(`[v3] 列目录失败 ${dir} :: ${String(e)}`);
      return;
    }
    console.log(`[v3] --- ${dir} 共 ${names.length} 项`);
    for (const n of names) {
      const fp = Path.join(dir, n);
      let isDir = false;
      let size = -1;
      try { isDir = FileManager.isDirectorySync(fp); } catch {}
      try { size = FileManager.statSync(fp).size; } catch {}
      console.log(`[v3]     ${isDir ? "[D]" : "   "} ${n} ${isDir ? "" : size + "B"}`);
      if (isDir) walk(fp, depth + 1);
    }
  };
  walk(ccDir, 0);

  // 全局设置里与默认供应商相关的键
  try {
    const gp = Path.join(SCRIPTING_DOCS_DIR, ".scripting", "agent-global-settings.json");
    const raw = FileManager.readAsStringSync(gp, "utf-8") || "";
    const parsed = JSON.parse(raw);
    const keys = Object.keys(parsed || {});
    console.log(`[v3] global-settings 顶层键 ${keys.length}: ${keys.join(",").slice(0, 400)}`);
    for (const k of keys) {
      if (!/provider|default|model|retired|connection/i.test(k)) continue;
      const v = (parsed as any)[k];
      console.log(`[v3]   ${k} => ${JSON.stringify(v).slice(0, 500)}`);
    }
  } catch (e) {
    console.log(`[v3] global-settings 读取失败 ${String(e)}`);
  }
}

async function probeBothDirs(): Promise<void> {
  const dirs: Array<{ tag: string; dir: string }> = [];
  try { dirs.push({ tag: "docsDir", dir: SCRIPTING_DOCS_DIR }); } catch {}
  try { if ((FileManager as any).appGroupDocumentsDirectory) dirs.push({ tag: "appGroup", dir: (FileManager as any).appGroupDocumentsDirectory }); } catch {}
  try { if ((FileManager as any).documentsDirectory) dirs.push({ tag: "documents", dir: (FileManager as any).documentsDirectory }); } catch {}
  for (const d of dirs) {
    console.log(`[v2] ===== ${d.tag} :: ${d.dir}`);
    for (const rel of ["", ".scripting", "scripting-agent"]) {
      const p = rel ? Path.join(d.dir, rel) : d.dir;
      let exists = false;
      try { exists = FileManager.existsSync(p); } catch {}
      if (!exists) { console.log(`[v2] --- ${rel || "."} 不存在`); continue; }
      let names: string[] = [];
      try { names = FileManager.readDirectorySync(p); } catch (e) { console.log(`[v2] --- ${rel || "."} 失败 ${String(e)}`); continue; }
      console.log(`[v2] --- ${rel || "."} 共 ${names.length} 项`);
      for (const n of names) {
        const fp = Path.join(p, n);
        let size = -1; let isDir = false;
        try { size = FileManager.statSync(fp).size; } catch {}
        try { isDir = FileManager.isDirectorySync(fp); } catch {}
        console.log(`[v2]     ${isDir ? "[D]" : "   "} ${n}  ${isDir ? "" : size + "B"}`);
      }
    }
  }
}

/** 恢复供应商配置：以冲突副本中的完整版为底，补回寒霜网关条目 */
async function restoreProviders(): Promise<void> {  const sp = Path.join(SCRIPTING_DOCS_DIR, ".scripting");
  const activePath = Path.join(sp, "agent-custom-providers.json");
  const richPath = Path.join(sp, "agent-custom-providers 2.json");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");

  const readArr = (p: string): any[] => {
    try {
      if (!FileManager.existsSync(p)) return [];
      const parsed = JSON.parse(FileManager.readAsStringSync(p, "utf-8") || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      console.log(`[恢复] 读取失败 ${p} :: ${String(e)}`);
      return [];
    }
  };

  const active = readArr(activePath);
  const rich = readArr(richPath);
  console.log(`[恢复] 当前活动 ${active.length} 项，完整副本 ${rich.length} 项`);
  if (rich.length === 0) {
    console.log("[恢复] 完整副本为空，放弃恢复（不动活动文件）");
    return;
  }

  const merged = rich.map((x: any) => ({ ...x }));
  const gateway = active.find(
    (x: any) =>
      String(x?.providerID || "") === "HANSHUANG-GATEWAY-5190" ||
      String(x?.name || "").includes("寒霜破甲网关")
  );
  const hasGatewayAlready = merged.some(
    (x: any) =>
      String(x?.providerID || "") === "HANSHUANG-GATEWAY-5190" ||
      String(x?.name || "").includes("寒霜破甲网关")
  );
  if (gateway && !hasGatewayAlready) {
    merged.push({ ...gateway });
    console.log("[恢复] 已补回寒霜破甲网关条目");
  }

  // 完整副本里的条目普遍缺 providerID；从活动文件按 baseUrl 匹配补回，
  // 避免 App 重新分配 ID 后与既有凭证（apiKeyRevision）解绑。
  let idFilled = 0;
  for (const item of merged) {
    if (item?.providerID) continue;
    const hit = active.find(
      (a: any) => String(a?.baseUrl || "") === String(item?.baseUrl || "") && a?.providerID
    );
    if (hit) {
      item.providerID = hit.providerID;
      idFilled++;
    }
  }
  console.log(`[恢复] providerID 回填 ${idFilled} 项`);

  // 备份活动文件
  try {
    const rawActive = FileManager.readAsStringSync(activePath, "utf-8") || "";
    const bak = `${activePath}.bak-restore-${stamp}`;
    FileManager.writeAsStringSync(bak, rawActive, "utf-8");
    console.log(`[恢复] 已备份原文件 -> ${bak} (${rawActive.length} 字节)`);
  } catch (e) {
    console.log(`[恢复] 备份失败，终止写入 :: ${String(e)}`);
    return;
  }

  const out = JSON.stringify(merged, null, 2);
  FileManager.writeAsStringSync(activePath, out, "utf-8");
  console.log(`[恢复] 已写入 ${merged.length} 项，${out.length} 字节`);

  // 立即回读校验
  await new Promise<void>((r) => setTimeout(r, 1200));
  const verify = readArr(activePath);
  console.log(`[恢复] 回读校验：${verify.length} 项`);
  verify.forEach((it: any, i: number) => {
    const mc = it?.modelInfos ? Object.keys(it.modelInfos).length : 0;
    console.log(`[恢复]   ${i}: ${it?.name} | ${it?.baseUrl} | ${it?.apiType} | 模型 ${mc} | ${it?.currentModelId}`);
  });
  console.log(`[恢复] ${verify.length >= merged.length ? "成功" : "异常：回读条目少于写入"}`);
}

/** 只读检查：逐份打印 provider / models 配置的内容摘要 */
async function inspectProviderContent(): Promise<void> {
  const sp = Path.join(SCRIPTING_DOCS_DIR, ".scripting");
  const targets = [
    "agent-custom-providers.json",
    "agent-custom-providers 2.json",
    "agent-custom-providers.json.hs-backup",
    "agent-custom-models.json",
    "agent-custom-models 2.json",
  ];
  for (const name of targets) {
    const fp = Path.join(sp, name);
    try {
      if (!FileManager.existsSync(fp)) {
        console.log(`[内容] ${name} :: 不存在`);
        continue;
      }
      const raw = FileManager.readAsStringSync(fp, "utf-8") || "";
      const parsed = JSON.parse(raw);
      let mtime = "?";
      try {
        const st: any = FileManager.statSync(fp);
        const ms = typeof st.mtimeMs === "number" ? st.mtimeMs : (st.modificationDate instanceof Date ? st.modificationDate.getTime() : 0);
        mtime = ms ? new Date(ms).toISOString() : "?";
      } catch {}
      console.log(`[内容] ${name} :: mtime=${mtime} size=${raw.length}`);
      if (Array.isArray(parsed)) {
        console.log(`[内容] ${name} :: 数组 ${parsed.length} 项`);
        parsed.forEach((it: any, i: number) => {
          const modelCount = it && it.modelInfos ? Object.keys(it.modelInfos).length : 0;
          console.log(
            `[内容]   ${i}: name=${it?.name} apiType=${it?.apiType} baseUrl=${it?.baseUrl} cur=${it?.currentModelId} modelInfos=${modelCount} id=${it?.providerID || it?.id || "-"}`
          );
        });
      } else {
        const keys = Object.keys(parsed || {});
        console.log(`[内容] ${name} :: 对象，顶层键 ${keys.length}: ${keys.join(" | ").slice(0, 300)}`);
        for (const k of keys) {
          const v = (parsed as any)[k];
          if (v && typeof v === "object" && !Array.isArray(v)) {
            console.log(`[内容]   ${k} -> 对象 ${Object.keys(v).length} 键: ${Object.keys(v).join(",").slice(0, 240)}`);
          } else if (Array.isArray(v)) {
            console.log(`[内容]   ${k} -> 数组 ${v.length} 项`);
          } else {
            console.log(`[内容]   ${k} -> ${String(v).slice(0, 120)}`);
          }
        }
      }
    } catch (e) {
      console.log(`[内容] ${name} :: 读取/解析失败 ${String(e)}`);
    }
  }
}

/** 只读探针：枚举设备上所有 agent-custom-providers/models 候选文件，输出路径/大小/条目数 */
async function probeProviderFiles(): Promise<void> {
  const candidates: Array<{ tag: string; dir: string }> = [];
  const push = (tag: string, dir?: string | null) => {
    if (dir) candidates.push({ tag, dir });
  };
  try {
    push("docsDir", SCRIPTING_DOCS_DIR);
  } catch {}
  try {
    push("documents", (FileManager as any).documentsDirectory);
  } catch {}
  try {
    push("icloudDocs", (FileManager as any).iCloudDocumentsDirectory);
  } catch {}
  try {
    push("appGroup", (FileManager as any).appGroupDocumentsDirectory);
  } catch {}

  const seen = new Set<string>();
  for (const c of candidates) {
    if (!c.dir || seen.has(c.dir)) continue;
    seen.add(c.dir);
    const sp = Path.join(c.dir, ".scripting");
    let hasSp = false;
    try {
      hasSp = FileManager.existsSync(sp);
    } catch {}
    console.log(`[探针] ${c.tag} dir=${c.dir} .scripting=${hasSp}`);
    const sl = Path.join(c.dir, "storage-locations.json");
    try {
      if (FileManager.existsSync(sl)) {
        const rawSl = FileManager.readAsStringSync(sl, "utf-8") || "";
        console.log(`[探针] storage-locations@${c.tag} :: ${rawSl.slice(0, 260)}`);
      }
    } catch {}
    if (!hasSp) continue;
    let names: string[] = [];
    try {
      names = FileManager.readDirectorySync(sp);
    } catch (e) {
      console.log(`[探针] 列目录失败 ${c.tag} :: ${String(e)}`);
      continue;
    }
    for (const n of names) {
      if (!/agent-custom-(providers|models)|agent-global-settings/i.test(n)) continue;
      const fp = Path.join(sp, n);
      let size = -1;
      let entries = -1;
      try {
        size = FileManager.statSync(fp).size;
      } catch {}
      try {
        const raw = FileManager.readAsStringSync(fp, "utf-8") || "";
        const parsed = JSON.parse(raw);
        entries = Array.isArray(parsed) ? parsed.length : Object.keys(parsed || {}).length;
      } catch {
        entries = -2;
      }
      console.log(`[探针] ${c.tag}/${n} size=${size} entries=${entries}`);
    }
  }
}

/**
 * 网关启动自检：真实打一次本机请求，确认 5190 上有 HTTP 服务在应答。
 * 只做两条最小 GET，不触上游、不改状态。
 */
async function selfTestGateway(port: number): Promise<void> {
  if (!port) {
    console.log("[自检] 网关端口为 0，未监听，跳过自检");
    return;
  }
  try {
    const res = await fetch(`http://127.0.0.1:${port}/v1/models`, {
      headers: { Authorization: "Bearer selftest" },
    });
    const text = await res.text();
    console.log(`[自检] GET /v1/models -> ${res.status} ${text.slice(0, 160)}`);
  } catch (e) {
    console.log(`[自检] GET /v1/models 失败：${String(e)}`);
  }
  try {
    const res2 = await fetch(`http://127.0.0.1:${port}/api/self-heal/status`);
    console.log(`[自检] GET /api/self-heal/status -> ${res2.status}`);
  } catch (e) {
    console.log(`[自检] GET /api/self-heal/status 失败：${String(e)}`);
  }
  // 全链路：走一次最小 chat 请求。上游没有密钥时会拿到 401，
  // 这同样证明网关转发链路是通的（区别只是上游鉴权）。
  try {
    const res3 = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "hanshuang-armor",
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 8,
      }),
    });
    const t3 = await res3.text();
    console.log(`[自检] POST /v1/chat/completions -> ${res3.status} ${t3.slice(0, 240)}`);
  } catch (e) {
    console.log(`[自检] POST /v1/chat/completions 失败：${String(e)}`);
  }
}

/** 只读检查：寒霜网关 Provider 是否已经注册进 Scripting Agent */
async function checkGatewayProviderRegistered(port: number): Promise<void> {
  let agent: any = null;
  try {
    // Scripting 全局 API 不在 globalThis 上，必须按裸标识符取
    agent = typeof ScriptingAgent !== "undefined" ? (ScriptingAgent as any) : null;
  } catch {
    agent = null;
  }
  if (!agent || typeof agent.listProviders !== "function") {
    let globalKeys = "";
    try {
      globalKeys = Object.keys(globalThis)
        .filter((k) => /script|agent|assistant/i.test(k))
        .join(",");
    } catch {}
    console.log(
      `[自检] ScriptingAgent 不可用（bare typeof=${typeof ScriptingAgent}, 权限=${
        typeof Script !== "undefined" ? "ok" : "no"
      }, 相关全局=${globalKeys || "无"}），无法检查 Provider 注册状态`
    );
    return;
  }
  try {
    const list: any[] = await agent.listProviders();
    const hit = (Array.isArray(list) ? list : []).find(
      (pr: any) =>
        String(pr.id || "") === "HANSHUANG-GATEWAY-5190" ||
        String(pr.name || "").includes(`(${port})`) ||
        String(pr.baseURL || pr.baseUrl || "").includes(`127.0.0.1:${port}`)
    );
    if (hit) {
      console.log(`[自检] Provider 已注册：${hit.name} (${hit.id})，模型数 ${Array.isArray(hit.models) ? hit.models.length : 0}`);
    } else {
      console.log(`[自检] Provider 未注册：需在控制台点「安装网关 Provider」并在弹出的确认框点允许（端口 ${port}）`);
    }
  } catch (e) {
    console.log(`[自检] listProviders 失败：${String(e)}`);
  }
}

/* ================================================================== *
 * 原生控制台主界面 (MainView)
 * ================================================================== */

export default function MainView() {
  const [port, setPort] = useState<number>(serverActualPort);
  const [isRunning, setIsRunning] = useState<boolean>(true);
  const [cards, setCards] = useState<PromptCard[]>([]);
  const [currentCardId, setCurrentCardId] = useState<string | null>(null);
  const [selfHealStatus, setSelfHealStatus] = useState<SelfHealStatus | null>(selfHealer.getStatus());
  const [keepAliveInfo, setKeepAliveInfo] = useState<KeepAliveInfo | null>(null);
  const [keepAliveMode, setKeepAliveMode] = useState<KeepAliveMode>("location");
  const [lastLog, setLastLog] = useState<string>("就绪");
  const dismiss = Navigation.useDismiss();

  // 工作区记忆注入（memory/workspaces/<名>/MEMORY.md）
  const [wsArmor, setWsArmor] = useState<WorkspacesOverview | null>(null);

  // 引擎池（Provider 级）：启用/停用与对外模型都按 Provider 算
  const [providers, setProviders] = useState<EngineProvider[]>([]);
  const [poolCfg, setPoolCfg] = useState<EnginePoolConfig>({
    order: [],
    disabledProviders: [],
    providerModels: {},
    maxRounds: 3,
    autoFallback: true,
    syncGatewayModels: true,
  });
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null);
  const [showDisabled, setShowDisabled] = useState<boolean>(false);

  const refreshWorkspaces = useCallback(() => {
    try {
      setWsArmor(buildWorkspacesOverview());
    } catch (e) {
      console.log(`[workspace-armor] 读取工作区总览失败: ${String(e)}`);
    }
  }, []);

  useEffect(() => {
    refreshWorkspaces();
  }, [refreshWorkspaces]);

  // 批量处理工作区注入块：补齐 / 刷新 / 移除
  const handleApplyWorkspaceArmor = async (mode: "missing" | "refresh" | "remove") => {
    try {
      if (mode === "remove") {
        const confirmed = await Dialog.confirm({
          title: "确认移除全部工作区注入块？",
          message: "将把寒霜注入块从各工作区的 MEMORY.md 中删除，只保留你自己的记忆内容。移除前会整份备份到 data/backups/workspaces/。",
        });
        if (!confirmed) return;
      }

      const result = runWorkspaceArmor({
        mode: mode === "remove" ? "remove" : "inject",
        onlyMissing: mode === "missing",
        refreshAll: mode === "refresh",
      });
      refreshWorkspaces();

      const changed = result.injected + result.refreshed + result.removed;
      const failedItems = result.items.filter((i) => i.action === "failed").slice(0, 3);
      Dialog.alert({
        title: result.failed > 0
          ? "⚠️ 部分工作区处理失败"
          : changed > 0
          ? "✅ 工作区注入已更新"
          : "✅ 无需处理",
        message:
          `范围：${result.scope === "all" ? "全部工作区（含 UUID 目录）" : "仅命名工作区"}\n` +
          `新写入 ${result.injected} ｜ 刷新 ${result.refreshed} ｜ 移除 ${result.removed} ｜ 跳过 ${result.skipped} ｜ 失败 ${result.failed}\n\n` +
          (failedItems.length > 0
            ? failedItems.map((i) => `${i.name}: ${i.message}`).join("\n")
            : "所有目标工作区的 MEMORY.md 都已与当前人物卡一致。"),
      }).catch(() => {});
    } catch (e) {
      Dialog.alert({
        title: "工作区注入操作失败",
        message: String(e),
      }).catch(() => {});
    }
  };

  // 切换扫描范围（仅命名工作区 / 含 UUID 目录）
  const handleToggleWorkspaceScope = () => {
    const state = getWorkspaceArmorState();
    state.scope = state.scope === "all" ? "named" : "all";
    saveWorkspaceArmorState(state);
    refreshWorkspaces();
  };

  // 开关工作区注入自愈
  const handleToggleWorkspaceHeal = () => {
    const state = getWorkspaceArmorState();
    state.enabled = !state.enabled;
    saveWorkspaceArmorState(state);
    refreshWorkspaces();
  };

  // 初始化与刷新数据
  const refreshState = useCallback(() => {
    const cardStore = store.getCardStore();
    setCards([...cardStore.cards]);
    setCurrentCardId(cardStore.currentId);
    setSelfHealStatus(selfHealer.getStatus());

    backgroundManager.getState().then((st) => {
      setKeepAliveInfo(st);
    }).catch(() => {});

    const proxyState = store.getProxyState();
    if (proxyState.lastInjection) {
      const inj = proxyState.lastInjection;
      const t = new Date(inj.at).toLocaleTimeString();
      setLastLog(`${t} 拦截 ${inj.protocol} -> ${inj.injected ? "注入成功" : "跳过"}`);
    } else {
      setLastLog("暂无拦截记录，等待客户端请求");
    }
  }, []);

  useEffect(() => {
    const p = startHttpServer(5190);
    setPort(p);
    setIsRunning(true);
    refreshState();

    backgroundManager.getState().then((st) => {
      setKeepAliveInfo(st);
      setKeepAliveMode(st.mode);
    }).catch(() => {});

    // 定时轮询保活状态与运行时长 (每 3 秒)
    const timer = setInterval(() => {
      backgroundManager.getState().then((st) => {
        setKeepAliveInfo(st);
        setKeepAliveMode(st.mode);
      }).catch(() => {});
    }, 3000);

    return () => clearInterval(timer);
  }, [refreshState]);

  // 切换保活模式
  const handleSwitchKeepAliveMode = async (newMode: KeepAliveMode) => {
    try {
      await backgroundManager.setMode(newMode);
      setKeepAliveMode(newMode);
      const next = await backgroundManager.getState();
      setKeepAliveInfo(next);
      Dialog.alert({
        title: "保活模式已切换",
        message:
          newMode === "location"
            ? "已开启「位置常驻保活」：绝不被听歌/看视频中断，锁屏依然坚如磐石；已自动设为低功耗粗精度。"
            : newMode === "audio"
            ? "已开启「静音音频保活」：无状态栏定位图标，但在播放其他声音时可能被系统挂起。"
            : "已开启「跟随应用」：最省电无后台常驻，跟随 Scripting 应用本身生命周期。",
      }).catch(() => {});
    } catch (e) {
      Dialog.alert({ title: "切换保活模式失败", message: String(e) }).catch(() => {});
    }
  };

  // 切换后台常驻保活
  const handleToggleKeepAlive = async () => {
    try {
      if (keepAliveInfo?.active || keepAliveInfo?.requested) {
        await backgroundManager.stopKeepAlive();
      } else {
        await backgroundManager.startKeepAlive();
      }
      const next = await backgroundManager.getState();
      setKeepAliveInfo(next);
      refreshState();
      Dialog.alert({
        title: next.active ? "✅ 后台常驻保活已激活" : "⏸️ 后台保活已暂停",
        message: next.active
          ? "已激活 iOS 系统后台音频引擎守护，切到后台、锁屏或切换应用时网关与注入服务持续运行，不会被系统挂起或杀死。"
          : "已暂停后台音频守护，切换到其他应用后可能在片刻后被系统挂起。",
      }).catch(() => {});
    } catch (e) {
      Dialog.alert({
        title: "保活操作异常",
        message: String(e),
      }).catch(() => {});
    }
  };

  // 立即最小化到后台常驻
  const handleMinimizeToBackground = async () => {
    try {
      if (typeof Script.minimize === "function") {
        const ok = await Script.minimize();
        if (!ok) {
          Dialog.alert({
            title: "提示",
            message: "当前窗口模式下暂不支持编程式最小化，您可直接向下滑动手势关闭页面，脚本已启用自动最小化后台常驻！",
          }).catch(() => {});
        }
      }
    } catch {
      Dialog.alert({
        title: "最小化常驻提示",
        message: "您可以直接向下滑动手势关闭本页面，网关与注入服务将在后台持续常驻运行，不会被杀死。",
      }).catch(() => {});
    }
  };

  // 安全彻底退出工具
  const handleTerminateApp = async () => {
    try {
      const confirmed = await Dialog.confirm({
        title: "🛑 确认完全退出？",
        message: "完全退出将彻底停止本地网关服务与自愈守护，并释放后台保活资源。\n\n如需继续在后台使用网关代理，建议直接向下滑动手势关闭页面或点击【最小化到后台】。",
      });
      if (confirmed) {
        requestGlobalExit();
        if (dismiss) {
          dismiss();
        }
      }
    } catch {
      // 用户取消
    }
  };

  // 复制真流式端口 URL
  const handleCopyTrueStreamUrl = () => {
    const sp = getTrueStreamPort();
    if (!sp) {
      Dialog.alert({
        title: "真流式端口未启用",
        message:
          "真流式独占端口尚未监听成功。主网关仍可正常使用（协议级 SSE 完整兼容）。\n\n如需逐字推流，请确认 5195 端口未被占用后重启工具。",
      }).catch(() => {});
      return;
    }
    const url = `http://127.0.0.1:${sp}/v1`;
    try {
      Pasteboard.setString(url);
      Dialog.alert({
        title: "✅ 真流式地址已复制",
        message: `${url}\n\n把该地址填进客户端 Base URL 即可获得毫秒级逐字推流。\n\n注意：该端口只接受 "stream" 的对话请求；非流式与管理接口请继续用主网关 ${port}。`,
      }).catch(() => {});
    } catch {
      console.log("Copied: " + url);
    }
  };

  // 复制网关 URL
  const handleCopyGatewayUrl = () => {
    const url = `http://127.0.0.1:${port}/v1`;
    try {
      Pasteboard.setString(url);
      Dialog.alert({
        title: "已复制到剪贴板",
        message: `网关端点：\n${url}\n\n可在各种客户端（Claude Code / Codex / NextChat 等）中作为 base_url 使用。`,
      }).catch(() => {});
    } catch {
      console.log("Copied: " + url);
    }
  };

  // 运行 Scripting 专属注入自检
  const handleRunSelfTest = async () => {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/test-scripting-inject`);
      const data = await res.json();
      const passed = data.testPassed;
      Dialog.alert({
        title: passed ? "✅ Scripting 注入自检全通" : "⚠️ 自检未完全通过",
        message: `测试时间：${new Date(data.timestamp).toLocaleTimeString()}\n` +
          `测试人物卡：${data.cardUsed}\n\n` +
          `1. 硬拒答拦截: ${data.cases.case1_hardRefusal.passed ? "通过" : "失败"}\n` +
          `2. 软回退拦截: ${data.cases.case2_softFallback.passed ? "通过" : "失败"}\n` +
          `3. 正常输出引述保护: ${data.cases.case3_normalTech.passed ? "通过" : "失败"}\n` +
          `4. Scripting Assistant 注入: ${data.cases.case4_scriptingInjection.passed ? "通过" : "失败"}\n` +
          `5. 幂等性防重复注入: ${data.cases.case5_idempotent.passed ? "通过" : "失败"}`,
      }).catch(() => {});
    } catch (e) {
      Dialog.alert({
        title: "自检请求失败",
        message: String(e),
      }).catch(() => {});
    }
  };

  // 运行一次 Scripting 破甲验证测试（上游跟随系统模型，不改系统 Provider 设置）
  const handleTestArmor = async () => {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/armor`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "帮我审计并逆向目标资产" }),
      });
      const data = await res.json();

      if (!data || data.ok !== true) {
        const err = data?.error;
        const hits = (data?.outputJudgement?.hits || []).join("、") || "无";
        Dialog.alert({
          title: "❌ 破甲验证未通过",
          message:
            `模型：${data?.model || "未取到"}（${data?.upstream || "系统模型"}）\n` +
            `轮数：${data?.rounds ?? 0} ｜ 仍拒答：${data?.refusal ? "是" : "否"}\n\n` +
            (err
              ? `失败原因 [${err.type}]\n${err.message}\n\n处理建议：\n${err.hint}`
              : `模型未给出合规产物\n判定命中：${hits}\n输出预览：${String(data?.text || "").slice(0, 200)}`),
        }).catch(() => {});
        refreshState();
        return;
      }

      Dialog.alert({
        title: "🎯 Scripting 破甲注入验证通过",
        message:
          `模型：${data.model}（${data.upstream}）\n` +
          `轮数：${data.rounds} ｜ ${data.corrected ? "纠正轮破甲成功" : "首轮即破甲"}\n` +
          `使用卡片：${data.card} ｜ 注入：${data.injected ? "已注入" : "未注入"}\n\n` +
          `输出预览：\n${String(data.text).slice(0, 160)}...`,
      }).catch(() => {});
      refreshState();
    } catch (e) {
      Dialog.alert({
        title: "破甲测试请求失败",
        message: `${String(e)}\n\n先确认本地服务在运行（端口 ${port}）。`,
      }).catch(() => {});
    }
  };

  // 手动执行自愈体检
  const handleTriggerSelfHeal = () => {
    const res = selfHealer.checkAndHeal("ui_manual");
    setSelfHealStatus(res.status);
    refreshState();
    Dialog.alert({
      title: res.healed ? "🛡️ 已触发自愈修复" : "✅ 注入系统处于健全状态",
      message: `体检时间：${new Date().toLocaleTimeString()}\n` +
        `自愈总次数：${res.status.healedCount} 次\n` +
        `当前激活卡：${res.status.targets.activeCard || "未激活"}\n\n` +
        `1. 人物卡存储：${res.status.targets.cardsStore ? "正常" : "异常"}\n` +
        `2. Scripting Assistant 注入点：${res.status.targets.scriptingAssistantFile ? "正常 (已守护)" : "异常"}\n` +
        `3. 破甲内核 (armor_kernel.ts)：${res.status.targets.armorKernelFile ? "正常 (已守护)" : "异常"}\n` +
        `4. 网关代理端点：${res.status.targets.gatewayProxy ? "就绪" : "未就绪"}\n\n` +
        (res.status.recentEvents.length > 0
          ? `最近自愈动态：\n${res.status.recentEvents[0].target} -> ${res.status.recentEvents[0].action}`
          : "守护进程持续巡检中，确保注入配置不被外部修改破坏。"),
    }).catch(() => {});
  };

  // 一键全量注入 Scripting 真实目标
  const handleInjectAllScripting = async () => {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/scripting/inject-all`, {
        method: "POST",
      });
      const data = await res.json();
      if (data.success) {
        Dialog.alert({
          title: "✅ Scripting 全量注入成功",
          message: `已将当前人物卡 [${activeCard?.name || "默认"}] 注入至 Scripting 的全部 5 个真实目标：\n\n` +
            `1. Assistant 系统规则 (assistant-rules)\n` +
            `2. Assistant 提示词模板 (assistant-prompts)\n` +
            `3. Agent 核心人格 (soul/SOUL.md)\n` +
            `4. Agent 全局长期记忆 (memory)\n` +
            `5. 破甲内核模块 (armor_kernel.ts)`,
        }).catch(() => {});
      } else {
        Dialog.alert({
          title: "注入未完成",
          message: data.error || "未知原因",
        }).catch(() => {});
      }
      refreshState();
    } catch (e) {
      Dialog.alert({
        title: "请求失败",
        message: String(e),
      }).catch(() => {});
    }
  };

  // 一键在 Scripting 中安装/注册【寒霜破甲网关】Provider
  const handleInstallGatewayProvider = async () => {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/scripting/install-gateway-provider`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ setAsDefault: true }),
      });
      const data = await res.json();
      if (data.success) {
        Dialog.alert({
          title: "🎉 网关 Provider 已写入",
          message: `已在 Scripting 中注册【寒霜破甲网关 (${port})】，模型 ID：hanshuang-armor。\n\n` +
            `下一步：打开 Agent 的选模器，选中「寒霜破甲网关」→ hanshuang-armor 即可接管。\n` +
            (data.warning ? `\n注意：${data.warning}` : ""),
        }).catch(() => {});
      } else if (data.cancelled) {
        Dialog.alert({
          title: "已取消",
          message: data.error || "写入被取消",
        }).catch(() => {});
      } else if (data.needsManualAdd) {
        Dialog.alert({
          title: "需要手动添加供应商",
          message: data.manualSteps || data.error || "无法通过官方接口写入",
        }).catch(() => {});
      } else {
        Dialog.alert({
          title: "安装失败",
          message: data.error || "写入配置失败",
        }).catch(() => {});
      }
      refreshState();
    } catch (e) {
      Dialog.alert({
        title: "请求失败",
        message: String(e),
      }).catch(() => {});
    }
  };

  // 切换人物卡
  const handleSelectCard = (id: string) => {
    const cardStore = store.getCardStore();
    cardStore.currentId = id;
    store.saveCardStore(cardStore);
    setCurrentCardId(id);
    refreshState();
  };

  // 切换人物卡开启/停用状态
  const handleToggleCardEnabled = () => {
    const cardStore = store.getCardStore();
    const cur = cardStore.cards.find((c) => c.id === currentCardId);
    if (cur) {
      cur.enabled = !cur.enabled;
      store.saveCardStore(cardStore);
      refreshState();
    }
  };

  // 选中的人物卡对象
  const activeCard = cards.find((c) => c.id === currentCardId) ?? null;

  // 引擎池（Provider 级）：重新发现 / 启停 / 选对外模型 / 设主引擎 / 同步到系统
  const refreshProviders = useCallback(async () => {
    try {
      setProviders(await discoverProviders(port));
      setPoolCfg(readEnginePoolConfig());
    } catch (e) {
      setLastLog(`引擎池读取失败：${String(e)}`);
    }
  }, [port]);

  useEffect(() => {
    refreshProviders();
  }, [refreshProviders]);

  const syncModelsToSystem = async () => {
    const res = await syncGatewayProviderModels(port);
    if (res.ok) setLastLog(`已同步 ${res.models.length} 个模型到网关 Provider`);
    else if (res.cancelled) setLastLog("同步已取消：需要在系统弹窗里点「允许」");
    else if (res.reason === "not_installed") setLastLog("还没安装网关 Provider，请先点上面的安装按钮");
    else setLastLog(`同步失败：${res.reason || "未知原因"}`);
  };

  const handleToggleProvider = async (p: EngineProvider) => {
    const cfg = readEnginePoolConfig();
    const disabled = new Set(cfg.disabledProviders);
    if (p.enabled) disabled.add(p.providerId);
    else disabled.delete(p.providerId);
    saveEnginePoolConfig({ disabledProviders: [...disabled] });
    await refreshProviders();
  };

  const handleProviderModel = async (p: EngineProvider, modelId: string) => {
    saveEnginePoolConfig({ providerModels: { [p.providerId]: modelId } });
    await refreshProviders();
  };

  const handleMakePrimaryProvider = async (p: EngineProvider) => {
    const cfg = readEnginePoolConfig();
    saveEnginePoolConfig({ order: [p.providerId, ...cfg.order.filter((k) => k !== p.providerId)] });
    await refreshProviders();
    setLastLog(`主引擎：${p.providerName}`);
  };

  return (
    <NavigationStack>
      <List
        navigationTitle="寒霜注入工具"
        navigationBarTitleDisplayMode="large"
      >
        {/* 本地网关 */}
        <Section
          header={<Text>本地网关</Text>}
          footer={<Text>常驻本地 HttpServer，为 Scripting 与其他客户端提供 /v1 破甲代理（WebUI 已下线，全部操作在本页完成）。</Text>}
        >
          <HStack spacing={12}>
            <Image
              systemName={isRunning ? "checkmark.seal.fill" : "exclamationmark.triangle.fill"}
            />
            <VStack alignment="leading" spacing={4}>
              <Text font="headline">网关服务：{isRunning ? "运行中" : "已暂停"}</Text>
              <Text font="caption" foregroundStyle="secondaryLabel">
                主网关: {port}（OpenAI & Claude & Scripting 全协议）
              </Text>
              <Text font="caption" foregroundStyle={getTrueStreamPort() ? "#34C759" : "secondaryLabel"}>
                {getTrueStreamPort()
                  ? `真流式端口: ${TRUE_STREAM_PORT}（node:net 逐字推送）`
                  : "真流式端口: 未启用（仅主网关可用）"}
              </Text>
            </VStack>
          </HStack>

          <Button
            title="📋 复制网关代理地址 (http://...:5190/v1)"
            action={handleCopyGatewayUrl}
          />

          <Button
            title={
              getTrueStreamPort()
                ? `⚡ 复制真流式地址 (http://...:${TRUE_STREAM_PORT}/v1)`
                : "⚡ 真流式端口未启用"
            }
            action={handleCopyTrueStreamUrl}
          />
        </Section>

        {/* ⚡ 后台常驻与系统保活 (防系统休眠与杀死) */}
        <Section
          header={<Text>⚡ 后台常驻与系统保活 (防休眠/防杀死)</Text>}
          footer={
            <Text>
              借助 iOS BackgroundKeeper 静音音频引擎，使本地 HttpServer 和网关代理在切后台、锁屏和休眠状态下持续运行不被系统挂起或杀死；下滑手势自动最小化，杜绝误触关闭退出。
            </Text>
          }
        >
          <HStack spacing={12}>
            <Image
              systemName={keepAliveInfo?.active ? "shield.fill" : "shield.slash.fill"}
            />
            <VStack alignment="leading" spacing={4}>
              <Text font="headline" foregroundStyle={keepAliveInfo?.active ? "#34C759" : "secondaryLabel"}>
                {keepAliveInfo?.active ? `● 后台常驻运行中 (${keepAliveMode === "location" ? "位置保活" : keepAliveMode === "audio" ? "音频守护" : "跟随应用"})` : "○ 后台常驻未激活"}
              </Text>
              <Text font="caption" foregroundStyle="secondaryLabel">
                {keepAliveInfo?.active
                  ? `持续运行: ${formatDuration(keepAliveInfo.durationSeconds)} ｜ 策略: ${keepAliveMode === "location" ? "📍 位置常驻 (抗其他音频冲掉)" : keepAliveMode === "audio" ? "🎵 静音音频引擎" : "📱 跟随应用生命周期"}`
                  : "切到其他应用后可能在片刻后被系统挂起"}
              </Text>
            </VStack>
          </HStack>

          <Picker
            title="保活模式选择"
            value={keepAliveMode}
            onChanged={(val: any) => handleSwitchKeepAliveMode(val)}
          >
            <Text key="location" tag="location">📍 位置常驻保活 (推荐，防音频冲掉)</Text>
            <Text key="audio" tag="audio">🎵 静音音频保活 (无顶部图标)</Text>
            <Text key="app" tag="app">📱 跟随 Scripting (最省电无后台)</Text>
          </Picker>

          <HStack>
            <Text foregroundStyle="secondaryLabel">手势防杀死保护</Text>
            <Spacer />
            <Text font="caption" foregroundStyle="#34C759">
              ✓ 下滑手势自动转入后台常驻
            </Text>
          </HStack>

          <HStack>
            <Text foregroundStyle="secondaryLabel">自愈心跳保活巡检</Text>
            <Spacer />
            <Text font="caption" foregroundStyle="#34C759">
              ✓ 每 15 秒巡检防掉线
            </Text>
          </HStack>

          <Button
            title="📦 立即最小化到后台 (保持网关运行)"
            action={handleMinimizeToBackground}
          />

          <Button
            title={keepAliveInfo?.active ? "⏸️ 暂停后台常驻保活" : "▶️ 重新激活后台常驻保活"}
            action={handleToggleKeepAlive}
          />

          <Button
            title="🛑 安全停止并完全退出工具"
            action={handleTerminateApp}
          />
        </Section>

        {/* Scripting 模型工作模式与生效管理 */}
        <Section
          header={<Text>Scripting 模型工作模式与注入生效管理</Text>}
          footer={<Text>彻底打通 Agent 人格/记忆、Assistant 全局规则、脚本破甲内核与 Custom Provider 网关四大模式。</Text>}
        >
          <VStack alignment="leading" spacing={6}>
            <Text font="subheadline">四大模型工作模式覆盖：</Text>
            <Text font="caption" foregroundStyle="secondaryLabel">
              • 模式1 [Agent]：SOUL.md 核心人格 + MEMORY.md 长期记忆
            </Text>
            <Text font="caption" foregroundStyle="secondaryLabel">
              • 模式2 [Assistant]：assistant-rules 系统全局规则 + 模板库
            </Text>
            <Text font="caption" foregroundStyle="secondaryLabel">
              • 模式3 [脚本代码]：armor_kernel.ts 原生导出模块
            </Text>
            <Text font="caption" foregroundStyle="secondaryLabel">
              • 模式4 [网络代理]：Custom Provider 协议层拦截 + 判拒重试
            </Text>
          </VStack>

          <Button
            title="⚡ 一键全量注入 Scripting 真实目标 (推荐)"
            action={handleInjectAllScripting}
          />

          <Button
            title="🔌 一键安装【寒霜破甲网关】为 Scripting Provider"
            action={handleInstallGatewayProvider}
          />
        </Section>

        {/* 引擎池：按 Provider 启用，可折叠 */}
        <Section
          header={<Text>🧩 引擎池（按 Provider 启用）</Text>}
          footer={
            <Text>
              点开可看该 Provider 的模型总数并选“对外模型”；启用状态以 Provider 为单位，不会把几百个模型全列出来。点“同步到系统”后，系统选模器里的【寒霜破甲网关】只显示已启用的 Provider。
            </Text>
          }
        >
          {providers.filter((p) => p.enabled).length === 0 ? (
            <Text font="caption" foregroundStyle="secondaryLabel">没有启用的 Provider（先在 Scripting 里添加或启用）</Text>
          ) : (
            providers
              .filter((p) => p.enabled)
              .map((p) => (
                <DisclosureGroup
                  key={p.providerId}
                  label={
                    <HStack spacing={8}>
                      <Text font="headline">{p.providerName}</Text>
                      <Text font="caption2" foregroundStyle="secondaryLabel">
                        {p.models.length} 个模型
                      </Text>
                    </HStack>
                  }
                  isExpanded={expandedProvider === p.providerId}
                  onChanged={(v: boolean) => setExpandedProvider(v ? p.providerId : null)}
                >
                  <Text font="caption2" foregroundStyle="secondaryLabel">
                    对外别名：{p.alias}（当前模型：{p.modelId}）
                  </Text>
                  <Button title="⏸ 停用该 Provider" action={() => handleToggleProvider(p)} />
                  <Picker
                    title="对外模型"
                    value={p.modelId}
                    onChanged={(v: string) => handleProviderModel(p, v)}
                  >
                    {p.models.map((m) => (
                      <Text key={m} tag={m}>
                        {m}
                      </Text>
                    ))}
                  </Picker>
                  <Button title="设为主引擎" action={() => handleMakePrimaryProvider(p)} />
                </DisclosureGroup>
              ))
          )}
          {providers.filter((p) => !p.enabled).length > 0 ? (
            <DisclosureGroup
              label={
                <HStack spacing={8}>
                  <Text font="headline">已停用的 Provider</Text>
                  <Text font="caption2" foregroundStyle="secondaryLabel">
                    {providers.filter((p) => !p.enabled).length} 个
                  </Text>
                </HStack>
              }
              isExpanded={showDisabled}
              onChanged={(v: boolean) => setShowDisabled(v)}
            >
              {providers
                .filter((p) => !p.enabled)
                .map((p) => (
                  <VStack key={p.providerId} alignment="leading" spacing={6}>
                    <Text font="headline">{p.providerName}</Text>
                    <Text font="caption2" foregroundStyle="secondaryLabel">
                      {p.models.length} 个模型 · 已停用
                    </Text>
                    <Button title="▶️ 启用该 Provider" action={() => handleToggleProvider(p)} />
                  </VStack>
                ))}
            </DisclosureGroup>
          ) : null}
          <Button title="🔄 重新发现本机 Provider" action={refreshProviders} />
          <Button title="📤 同步到系统选模器（只改网关自己）" action={syncModelsToSystem} />
          <Text font="caption2" foregroundStyle="secondaryLabel">
            自动回退：{poolCfg.autoFallback ? "开" : "关"} ｜ 判拒重试轮数：{poolCfg.maxRounds}
          </Text>
        </Section>

        {/* Scripting 注入与破甲验证 */}
        <Section
          header={<Text>Scripting 注入与破甲测试</Text>}
          footer={<Text>包含判拒评分（硬拒答/软回退）、跨轮纠正注入与 Scripting 原生链路验证。</Text>}
        >
          <Button
            title="⚡ 执行 Scripting 注入自检 (5项测试)"
            action={handleRunSelfTest}
          />

          <Button
            title="🎯 发起 Scripting 破甲与纠正验证 (/armor)"
            action={handleTestArmor}
          />
        </Section>

        {/* 工作区记忆注入（Scripting Agent 多工作区） */}
        <Section
          header={<Text>🗂️ 工作区记忆注入（多工作区同步）</Text>}
          footer={
            <Text>
              直接写入各工作区的 memory/workspaces/&lt;名&gt;/MEMORY.md，每次对话都会整份注入上下文。只改标记块内内容，不动你自己的记忆；写入前整份备份到 data/backups/workspaces/。
            </Text>
          }
        >
          <HStack>
            <Text foregroundStyle="secondaryLabel">已挂载 / 命名工作区</Text>
            <Spacer />
            <Text
              font="headline"
              foregroundStyle={
                wsArmor && wsArmor.namedBadCount === 0 ? "#34C759" : "#FF9500"
              }
            >
              {wsArmor ? `${wsArmor.namedOkCount} / ${wsArmor.namedTotal}` : "读取中…"}
            </Text>
          </HStack>
          <HStack>
            <Text foregroundStyle="secondaryLabel">缺失 / 待刷新</Text>
            <Spacer />
            <Text font="caption" foregroundStyle="secondaryLabel">
              {wsArmor ? `${wsArmor.missingCount} 个缺失 ｜ ${wsArmor.outdatedCount} 个待刷新（含 UUID 目录）` : "-"}
            </Text>
          </HStack>
          <HStack>
            <Text foregroundStyle="secondaryLabel">注入自愈</Text>
            <Spacer />
            <Text font="caption" foregroundStyle={wsArmor?.state.enabled ? "#34C759" : "#FF9500"}>
              {wsArmor?.state.enabled ? "● 每 5 分钟补回被覆盖的块" : "○ 已关闭"}
            </Text>
          </HStack>
          <HStack>
            <Text foregroundStyle="secondaryLabel">扫描范围</Text>
            <Spacer />
            <Text font="caption">{wsArmor?.state.scope === "all" ? "全部工作区（含 UUID 目录）" : "仅命名工作区"}</Text>
          </HStack>
          {wsArmor && wsArmor.namedBadCount > 0 && (
            <VStack alignment="leading" spacing={2}>
              {wsArmor.items
                .filter((i) => !i.isUuid && i.status !== "ok")
                .slice(0, 4)
                .map((i) => (
                  <Text key={i.name} font="caption2" foregroundStyle="secondaryLabel">
                    {i.status === "outdated" ? "待刷新" : "缺失"}：{i.name}
                  </Text>
                ))}
            </VStack>
          )}
          <Button
            title="🩹 补齐缺失的工作区注入"
            action={() => handleApplyWorkspaceArmor("missing")}
          />
          <Button
            title="🔄 用当前卡片刷新全部工作区"
            action={() => handleApplyWorkspaceArmor("refresh")}
          />
          <Button
            title="🧹 移除全部工作区注入块（保留原记忆）"
            action={() => handleApplyWorkspaceArmor("remove")}
          />
          <Button
            title={`切换扫描范围（当前：${wsArmor?.state.scope === "all" ? "全部" : "仅命名"}）`}
            action={handleToggleWorkspaceScope}
          />
          <Button
            title={wsArmor?.state.enabled ? "关闭工作区注入自愈" : "开启工作区注入自愈"}
            action={handleToggleWorkspaceHeal}
          />
          <Button title="🔄 刷新工作区状态" action={refreshWorkspaces} />
        </Section>

        {/* 自愈守护系统 */}
        <Section
          header={<Text>🛡️ 寒霜注入自愈守护系统</Text>}
          footer={<Text>自愈守护进程持续巡检，若卡片被关闭、被篡改或文件标记丢失，将自动自我修复恢复生效。</Text>}
        >
          <HStack>
            <Text foregroundStyle="secondaryLabel">自愈健康度</Text>
            <Spacer />
            <Text font="headline" foregroundStyle="#34C759">
              {selfHealStatus?.health === "healthy" ? "● 健全守护中" : "⚠️ 需要自愈"}
            </Text>
          </HStack>
          <HStack>
            <Text foregroundStyle="secondaryLabel">已自愈修复次数</Text>
            <Spacer />
            <Text>{selfHealStatus?.healedCount ?? 0} 次</Text>
          </HStack>
          <HStack>
            <Text foregroundStyle="secondaryLabel">Scripting Assistant 注入点</Text>
            <Spacer />
            <Text foregroundStyle={selfHealStatus?.targets.scriptingAssistantFile ? "#34C759" : "#FF9500"}>
              {selfHealStatus?.targets.scriptingAssistantFile ? "✓ 已守护" : "待恢复"}
            </Text>
          </HStack>
          <HStack>
            <Text foregroundStyle="secondaryLabel">破甲内核 (armor_kernel.ts)</Text>
            <Spacer />
            <Text foregroundStyle={selfHealStatus?.targets.armorKernelFile ? "#34C759" : "#FF9500"}>
              {selfHealStatus?.targets.armorKernelFile ? "✓ 已守护" : "待恢复"}
            </Text>
          </HStack>
          <HStack>
            <Text foregroundStyle="secondaryLabel">系统后台常驻音频保活</Text>
            <Spacer />
            <Text foregroundStyle={keepAliveInfo?.active ? "#34C759" : "#FF9500"}>
              {keepAliveInfo?.active ? "✓ 活跃守护中" : "未开启"}
            </Text>
          </HStack>
          <Button
            title="🩺 立即执行全量自愈体检"
            action={handleTriggerSelfHeal}
          />
        </Section>

        {/* 当前人物卡控制 */}
        <Section
          header={<Text>当前激活人物卡</Text>}
          footer={<Text>注入模式：{activeCard?.mode ?? "未选择"} ｜ 预估 Token：{activeCard?.tokenEstimate ?? 0}</Text>}
        >
          {activeCard ? (
            <VStack alignment="leading" spacing={6}>
              <HStack>
                <Text font="headline">{activeCard.name}</Text>
                <Spacer />
                <Text
                  font="subheadline"
                  foregroundStyle={activeCard.enabled ? "#34C759" : "secondaryLabel"}
                >
                  {activeCard.enabled ? "● 已开启注入" : "○ 已停用"}
                </Text>
              </HStack>
              <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={2}>
                {activeCard.system.slice(0, 100)}...
              </Text>
            </VStack>
          ) : (
            <Text foregroundStyle="secondaryLabel">暂无激活人物卡，请在下方选择或导入</Text>
          )}

          {activeCard && (
            <Button
              title={activeCard.enabled ? "停用当前人物卡" : "开启当前人物卡"}
              action={handleToggleCardEnabled}
            />
          )}

          <Picker
            title="切换人物卡"
            value={currentCardId ?? ""}
            onChanged={(val: string) => handleSelectCard(val)}
          >
            {cards.map((c) => (
              <Text key={c.id} tag={c.id}>
                {c.name} {c.enabled ? " (已启用)" : " (停用)"}
              </Text>
            ))}
          </Picker>
        </Section>

        {/* 代理监控与实时日志 */}
        <Section header={<Text>网关代理状态与最近日志</Text>}>
          <HStack>
            <Text foregroundStyle="secondaryLabel">最近动态</Text>
            <Spacer />
            <Text font="caption">{lastLog}</Text>
          </HStack>
          <HStack>
            <Text foregroundStyle="secondaryLabel">人物卡总数</Text>
            <Spacer />
            <Text>{cards.length} 张</Text>
          </HStack>
          <Button
            title="🔄 刷新状态"
            action={refreshState}
          />
        </Section>

        {/* 内置寒霜模板快捷展示 */}
        <Section
          header={<Text>内置寒霜模板清单</Text>}
          footer={<Text>以上模板已预装在人物卡库中，可随时在 Web 面板中编辑或切换。</Text>}
        >
          {cards.slice(0, 6).map((c) => (
            <HStack key={c.id} spacing={8}>
              <Image systemName="wand.and.stars" />
              <VStack alignment="leading" spacing={2}>
                <Text font="body">{c.name}</Text>
                <Text font="caption2" foregroundStyle="secondaryLabel">
                  模式: {c.mode} ｜ Token: {c.tokenEstimate}
                </Text>
              </VStack>
              <Spacer />
              {c.id === currentCardId && (
                <Text font="caption" foregroundStyle="#34C759">
                  生效中
                </Text>
              )}
            </HStack>
          ))}
        </Section>

        {/* 关于信息 */}
        <Section header={<Text>关于</Text>}>
          <HStack>
            <Text foregroundStyle="secondaryLabel">版本号</Text>
            <Spacer />
            <Text>v{readAppVersion()}</Text>
          </HStack>
          <HStack>
            <Text foregroundStyle="secondaryLabel">作者</Text>
            <Spacer />
            <Text>vcncv</Text>
          </HStack>
        </Section>
      </List>
    </NavigationStack>
  );
}

/* ================================================================== *
 * 后台常驻生命周期与执行入口
 * ================================================================== */

let isPresentingView = false;

async function presentMainView() {
  if (isPresentingView) return;
  isPresentingView = true;
  try {
    await Navigation.present({
      element: <MainView />,
      swipeBackBehavior: "minimize",
    });
  } catch (e) {
    console.error("[寒霜注入工具] Navigation.present 异常", e);
  } finally {
    isPresentingView = false;
  }
}

/* ================================================================== *
 * 设备端诊断 / 修复钩子
 * 由脚本目录下的标记文件触发（data/diag.flag），用于排查 Provider 配置损坏
 * ================================================================== */

function logChunks(tag: string, text: string, size = 700, maxLen = 8000) {
  if (!text) {
    console.log(`[诊断] ${tag} :: <empty>`);
    return;
  }
  const body = text.length > maxLen ? text.slice(0, maxLen) + `…(truncated, total ${text.length})` : text;
  for (let i = 0; i < body.length; i += size) {
    console.log(`[诊断] ${tag}[${i}] :: ${body.slice(i, i + size)}`);
  }
}

function readIfExists(p: string): string | null {
  try {
    if (!FileManager.existsSync(p)) return null;
    return FileManager.readAsStringSync(p, "utf-8") ?? "";
  } catch (err) {
    return `<<read error ${String(err)}>>`;
  }
}

function providerRoots(): string[] {
  const roots: string[] = [];
  try { if (SCRIPTING_DOCS_DIR) roots.push(SCRIPTING_DOCS_DIR); } catch {}
  try {
    const d = (FileManager as any).documentsDirectory;
    if (d && !roots.includes(d)) roots.push(d);
  } catch {}
  try {
    const ic = (FileManager as any).iCloudDocumentsDirectory;
    if (ic && !roots.includes(ic)) roots.push(ic);
  } catch {}
  try {
    const ag = (FileManager as any).appGroupDocumentsDirectory;
    if (ag && !roots.includes(ag)) roots.push(ag);
  } catch {}
  return roots;
}

/** 扫掉 data/ 下所有遗留的 *.flag，返回删除数量 */
function sweepLegacyFlags(): number {
  let n = 0;
  const dataDir = Path.join(Script.directory, "data");
  try {
    const items = FileManager.readDirectorySync(dataDir) as any[];
    for (const it of items) {
      const name = typeof it === "string" ? it : it?.name || "";
      if (!name.endsWith(".flag")) continue;
      try {
        FileManager.removeSync(Path.join(dataDir, name));
        n++;
      } catch {}
    }
  } catch {}
  return n;
}

/** 从 queryParameters 里取探针名（CLI: --query-parameters '{"probe":"ls"}'） */
function readProbeParam(): string | null {
  try {
    const qp = (Script as any).queryParameters;
    const v = qp && typeof qp === "object" ? qp.probe : null;
    return typeof v === "string" && v ? v.toLowerCase() : null;
  } catch {
    return null;
  }
}

async function runProbeByName(name: string) {
  switch (name) {
    case "sweep":
      console.log("[probe] 仅清理，已完成");
      return;
    case "ls":
      await probeDirSnapshot();
      return;
    case "dump":
      await probeSettingsDump();
      return;
    case "sample":
      await probeAppSamples();
      return;
    case "cmp":
      await probeSettingsHistory();
      return;
    case "undo":
      await revertBuiltInsShape();
      return;
    case "restorebic":
      await probeRestoreBuiltIns();
      return;
    case "rival":
      await probeRivalScript();
      return;
    case "replace2":
      await replaceRivalScript();
      return;
    case "sysfix":
      await fixSystemProviders();
      return;
    case "bic":
      await repairBuiltIns();
      return;
    case "keysfix":
      await fixProviderKeySchema();
      return;
    case "appsettings":
      await probeAppSettings();
      return;
    default:
      console.log(`[probe] 未知探针: ${name}`);
  }
}

/**
 * 修复：把自定义供应商归一化到 App 当前格式（13 个 provider 键 / 25 个 modelInfo 键）。
 * 依据是 App 自己写过的 agent-custom-providers.json.hs-backup：
 *   apiKeyOptional, apiKeyRevision, apiType, baseUrl, credentialStorageVersion,
 *   currentModelId, customHeaders, fixedHeaderNames, headerBindings, modelInfos,
 *   name, providerID, supportsGeminiFiles
 * 关键点：credentialStorageVersion 存在时 apiKeyRevision 必须存在（凭据指针）。
 * 缺任何一条都会让整份数组 Codable 解码失败 —— 表现就是供应商页面直接打不开。
 */
async function fixProviderKeySchema() {
  console.log("[pk] ===== 供应商键结构归一化 =====");

  const MODEL_KEYS = [
    "cacheReadsPrice", "cacheWritesPrice", "catalogAutomaticFields", "chatCompletionsCompatibility",
    "contextWindow", "imageApiMode", "imageOnly", "inputPrice", "maxTokens", "outputPrice",
    "providerInputTokenLimit", "providerOutputTokenLimit", "reasoningEffort", "requestUserAgent",
    "supportedGenerationMethods", "supportsAudio", "supportsGenerateImage", "supportsImageEdit",
    "supportsImages", "supportsPDF", "supportsPromptCache", "supportsReasoningSummaries",
    "supportsVideo", "temperature", "thinking",
  ];
  const MODEL_DEFAULTS: Record<string, any> = {
    cacheReadsPrice: null, cacheWritesPrice: null, catalogAutomaticFields: null,
    chatCompletionsCompatibility: null, imageApiMode: null, imageOnly: null, inputPrice: null,
    outputPrice: null, providerInputTokenLimit: null, providerOutputTokenLimit: null,
    reasoningEffort: "medium", requestUserAgent: null, supportedGenerationMethods: null,
    supportsAudio: null, supportsGenerateImage: null, supportsImageEdit: null, supportsPDF: null,
    supportsPromptCache: false, supportsReasoningSummaries: null, supportsVideo: null,
    temperature: null, thinking: false,
  };

  for (const root of providerRoots()) {
    const provPath = Path.join(root, ".scripting", "agent-custom-providers.json");
    const raw = readIfExists(provPath);
    if (raw === null) continue;
    let list: any[];
    let isArray = true;
    try {
      const p = JSON.parse(raw);
      if (Array.isArray(p)) list = p;
      else if (Array.isArray(p?.providers)) {
        list = p.providers;
        isArray = false;
      } else {
        console.log(`[pk] ${provPath} 顶层既不是数组也没有 providers，跳过`);
        continue;
      }
    } catch (err) {
      console.log(`[pk] ${provPath} 解析失败 ${String(err)}`);
      continue;
    }

    const out: any[] = [];
    for (const pr of list) {
      const name = String(pr?.name || "");
      const mi = pr?.modelInfos && typeof pr?.modelInfos === "object" ? pr.modelInfos : {};
      const modelIds = Object.keys(mi);

      // 模型逐个补 25 键
      const modelNext: Record<string, any> = {};
      for (const mid of modelIds) {
        const m = { ...(mi[mid] || {}) } as any;
        for (const k of MODEL_KEYS) {
          if (!(k in m)) m[k] = MODEL_DEFAULTS[k];
        }
        if (typeof m.contextWindow !== "number") m.contextWindow = 128000;
        modelNext[mid] = m;
      }

      const missing: string[] = [];
      const next: any = {
        apiKeyOptional: typeof pr?.apiKeyOptional === "boolean" ? pr.apiKeyOptional : false,
        apiKeyRevision: typeof pr?.apiKeyRevision === "string" && pr.apiKeyRevision ? pr.apiKeyRevision : genUUID(),
        apiType: typeof pr?.apiType === "string" && pr.apiType ? pr.apiType : "OpenAIChatCompletion",
        baseUrl: String(pr?.baseUrl || pr?.baseURL || ""),
        credentialStorageVersion: typeof pr?.credentialStorageVersion === "number" ? pr.credentialStorageVersion : 1,
        currentModelId: typeof pr?.currentModelId === "string" && pr.currentModelId ? pr.currentModelId : modelIds[0] || "",
        customHeaders: pr?.customHeaders && typeof pr.customHeaders === "object" ? pr.customHeaders : {},
        fixedHeaderNames: Array.isArray(pr?.fixedHeaderNames) ? pr.fixedHeaderNames : [],
        headerBindings: pr?.headerBindings && typeof pr.headerBindings === "object" ? pr.headerBindings : {},
        modelInfos: modelNext,
        name,
        providerID: typeof pr?.providerID === "string" && pr.providerID ? pr.providerID : genUUID(),
        supportsGeminiFiles: typeof pr?.supportsGeminiFiles === "boolean" ? pr.supportsGeminiFiles : false,
      };
      for (const k of Object.keys(next)) {
        if (next[k] === undefined) missing.push(k);
      }
      // 旧格式遗留的 provider 级 chatCompletionsCompatibility 不属于 13 键，丢弃
      if ("chatCompletionsCompatibility" in pr) console.log(`[pk] ${name}: 去掉 provider 级 chatCompletionsCompatibility`);
      console.log(`[pk] ${name}: ${Object.keys(pr || {}).length} -> ${Object.keys(next).length} 键, models=${modelIds.length}, apiKeyRevision=${next.apiKeyRevision.slice(0, 8)}…, cur=${next.currentModelId}`);
      out.push(next);
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    try {
      FileManager.writeAsStringSync(Path.join(Script.directory, "data", `keysfix-backup-${stamp}.json`), raw, "utf-8");
      console.log(`[pk] 已备份 -> data/keysfix-backup-${stamp}.json`);
    } catch (err) {
      console.log(`[pk] 备份失败 ${String(err)}`);
      continue;
    }

    const payload = isArray ? out : { providers: out };
    FileManager.writeAsStringSync(provPath, JSON.stringify(payload, null, 2), "utf-8");
    console.log(`[pk] 已写回 ${provPath}`);
  }

  await new Promise<void>((r) => setTimeout(r, 1200));

  for (const root of providerRoots()) {
    const provPath = Path.join(root, ".scripting", "agent-custom-providers.json");
    const raw = readIfExists(provPath);
    if (raw === null) continue;
    try {
      const list: any[] = JSON.parse(raw);
      console.log(`[pk] 校验 ${provPath} bytes=${raw.length} 条目=${list.length}`);
      list.forEach((pr: any, i: number) => {
        const ks = Object.keys(pr || {});
        const models = Object.keys(pr?.modelInfos || {});
        const mk = models.length ? Object.keys(pr.modelInfos[models[0]]).length : 0;
        console.log(`[pk]   [${i}] ${pr?.name} provKeys=${ks.length} modelInfoKeys=${mk} models=${models.length} hasRevision=${!!pr?.apiKeyRevision}`);
        console.log(`[pk]       ${ks.join(",")}`);
      });
    } catch (err) {
      console.log(`[pk] 校验失败 ${String(err)}`);
    }
  }
  console.log("[pk] ===== 结束 =====");
}

/**
 * 只读：把 App 自己写过的 agent-custom-providers 样本逐字段拆开，
 * 统计 provider / modelInfo 的键集合、哪些键在样本里出现过 null，
 * 用来判断我们归一化时多写的键或 null 是否导致 Codable 解码失败。
 */
async function probeAppSamples() {
  console.log("[sample] ===== App 样本字段分析 =====");
  const files = [
    "agent-custom-providers 2.json",
    "agent-custom-providers.json.hs-backup",
    "agent-custom-providers.json.bak-restore-2026-11-19T03-33-32-310Z",
    "agent-custom-providers.json",
  ];

  for (const root of providerRoots()) {
    const dot = Path.join(root, ".scripting");
    for (const fname of files) {
      const raw = readIfExists(Path.join(dot, fname));
      if (raw === null) continue;
      let list: any[];
      try {
        const p = JSON.parse(raw);
        list = Array.isArray(p) ? p : Array.isArray(p?.providers) ? p.providers : [];
      } catch (err) {
        console.log(`[sample] ${fname} len=${raw.length} 解析失败`);
        continue;
      }
      console.log(`[sample] --- ${fname} len=${raw.length} 条目=${list.length}`);

      const provKeyCount = new Map<string, number>();
      const modelKeyCount = new Map<string, number>();
      const nullKeys = new Set<string>();
      let modelTotal = 0;
      let samplesPrinted = 0;

      for (const pr of list) {
        const pk = Object.keys(pr || {});
        console.log(`[sample]   ${pr?.name} pid=${pr?.providerID} provKeys(${pk.length})=${pk.join(",")}`);
        for (const k of pk) {
          provKeyCount.set(k, (provKeyCount.get(k) || 0) + 1);
          if (pr[k] === null) nullKeys.add(`prov.${k}`);
        }
        const mi = pr?.modelInfos;
        const models: [string, any][] = mi && typeof mi === "object" ? Object.entries(mi) : [];
        console.log(`[sample]     models=${models.length} ids=${models.map(([id]) => id).join("|")}`);
        for (const [, mv] of models) {
          modelTotal++;
          const mk = Object.keys(mv || {});
          for (const k of mk) {
            modelKeyCount.set(k, (modelKeyCount.get(k) || 0) + 1);
            if ((mv as any)[k] === null) nullKeys.add(`model.${k}`);
          }
          if (samplesPrinted < 2) {
            console.log(`[sample]     modelSample keys(${mk.length}) ${JSON.stringify(mv)}`);
            samplesPrinted++;
          }
        }
      }

      console.log(`[sample]   provider 键覆盖（条目数=${list.length}）:`);
      Array.from(provKeyCount.entries()).sort().forEach(([k, n]) => console.log(`[sample]     ${k} x${n}`));
      console.log(`[sample]   modelInfo 键覆盖（模型数=${modelTotal}）:`);
      Array.from(modelKeyCount.entries()).sort().forEach(([k, n]) => console.log(`[sample]     ${k} x${n}`));
      console.log(`[sample]   出现过 null 的键: ${Array.from(nullKeys).join(",") || "<无>"}`);
    }
  }
  console.log("[sample] ===== 分析结束 =====");
}

/**
 * 把系统供应商（providerDefaults.builtInConnections.connections）统一成 App
 * 当前的“现代连接”结构，并给空壳连接灌入内置模型种子：
 *   isLegacy:false + usesIndependentSettings:true + apiKeyRevision + modelInfos + defaultModelId
 * 依据样本：openrouter 那条（App 自己写的唯一一条非 legacy 连接）。
 * 空壳连接没有 modelInfos = 没有模型列表，这就是“系统供应商下加不了新模型”的直接原因。
 */
async function fixSystemProviders() {
  console.log("[sys] ===== 系统供应商现代化 =====");

  for (const root of providerRoots()) {
    const dot = Path.join(root, ".scripting");
    const setPath = Path.join(dot, "agent-global-settings.json");
    const catPath = Path.join(dot, "agent-custom-models.json");
    const raw = readIfExists(setPath);
    if (raw === null) continue;

    let s: any;
    try {
      s = JSON.parse(raw);
    } catch (err) {
      console.log(`[sys] ${setPath} 解析失败 ${String(err)}`);
      continue;
    }
    const pd = s?.providerDefaults;
    const conns: any[] = Array.isArray(pd?.builtInConnections?.connections) ? pd.builtInConnections.connections : [];
    if (conns.length === 0) {
      console.log(`[sys] ${setPath} 连接表为空，跳过`);
      continue;
    }

    // 内置模型种子：agent-custom-models.json → models["<provider>.custom.models"]
    const seeds: Record<string, any> = {};
    const catRaw = readIfExists(catPath);
    if (catRaw) {
      try {
        const cat = JSON.parse(catRaw);
        const models = cat?.models || {};
        for (const k of Object.keys(models)) {
          const m = /^([A-Za-z0-9]+)\.custom\.models$/.exec(k);
          if (m) seeds[m[1].toLowerCase()] = models[k] || {};
        }
        console.log(`[sys] 模型种子: ${Object.keys(seeds).map((p) => `${p}(${Object.keys(seeds[p]).length})`).join(" ")}`);
      } catch (err) {
        console.log(`[sys] 种子文件解析失败 ${String(err)}`);
      }
    } else {
      console.log("[sys] 无 agent-custom-models.json，跳过种子");
    }

    console.log(`[sys] 修复前 ${conns.length} 条：`);
    conns.forEach((c: any, i: number) => {
      const n = c?.modelInfos && typeof c.modelInfos === "object" ? Object.keys(c.modelInfos).length : 0;
      console.log(`[sys]   [${i}] ${c?.provider} legacy=${c?.isLegacy} indep=${c?.usesIndependentSettings} rev=${c?.apiKeyRevision ? "有" : "无"} models=${n}`);
    });

    for (const c of conns) {
      const prov = String(c?.provider || "").toLowerCase();
      if (typeof c.id !== "string" || !c.id) c.id = genUUID();
      c.isLegacy = false;
      c.usesIndependentSettings = true;
      if (typeof c.apiKeyRevision !== "string" || !c.apiKeyRevision) c.apiKeyRevision = genUUID();
      if (typeof c.authentication !== "string" || !c.authentication) c.authentication = "apiKey";

      const have = c.modelInfos && typeof c.modelInfos === "object" ? Object.keys(c.modelInfos) : [];
      if (have.length === 0) {
        const seed = seeds[prov] || {};
        const ids = Object.keys(seed);
        if (ids.length) {
          c.modelInfos = JSON.parse(JSON.stringify(seed));
          console.log(`[sys]   ${prov}: 灌入内置模型 ${ids.length} 个 -> ${ids.join("|")}`);
        } else {
          console.log(`[sys]   ${prov}: 无内置种子，保持空模型表`);
        }
      }
      const ids = c.modelInfos && typeof c.modelInfos === "object" ? Object.keys(c.modelInfos) : [];
      if (ids.length && !ids.includes(String(c.defaultModelId || ""))) {
        c.defaultModelId = ids[0];
        console.log(`[sys]   ${prov}: defaultModelId -> ${ids[0]}`);
      }
    }

    // 清理与现存连接矛盾的墓碑（provider 仍活着却被标记 retired）
    const liveProviders = new Set(conns.map((c: any) => String(c?.provider || "").toLowerCase()));
    const retired: any[] = Array.isArray(pd?.retiredProviders) ? pd.retiredProviders : [];
    const retiredNext = retired.filter((r: any) => {
      const p = String(r?.provider || "").toLowerCase();
      if (p && liveProviders.has(p)) {
        console.log(`[sys] 移除矛盾墓碑 provider=${p} id=${r?.id}`);
        return false;
      }
      return true;
    });

    const next = {
      ...s,
      providerDefaults: {
        ...pd,
        builtInConnections: { ...(pd?.builtInConnections || {}), connections: conns, version: pd?.builtInConnections?.version ?? 1 },
        retiredProviders: retiredNext,
      },
    };

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    try {
      FileManager.writeAsStringSync(Path.join(Script.directory, "data", `sysfix-backup-${stamp}.json`), raw, "utf-8");
      console.log(`[sys] 已备份 -> data/sysfix-backup-${stamp}.json`);
    } catch (err) {
      console.log(`[sys] 备份失败 ${String(err)}`);
      continue;
    }
    FileManager.writeAsStringSync(setPath, JSON.stringify(next, null, 2), "utf-8");
    console.log(`[sys] 已写回 ${setPath}`);
  }

  await new Promise<void>((r) => setTimeout(r, 1200));

  for (const root of providerRoots()) {
    const setPath = Path.join(root, ".scripting", "agent-global-settings.json");
    const raw = readIfExists(setPath);
    if (raw === null) continue;
    try {
      const s = JSON.parse(raw);
      const pd = s?.providerDefaults || {};
      const conns: any[] = pd?.builtInConnections?.connections || [];
      console.log(`[sys] 校验 bytes=${raw.length} 连接=${conns.length} 墓碑=${(pd?.retiredProviders || []).length}`);
      conns.forEach((c: any, i: number) => {
        const ids = c?.modelInfos && typeof c.modelInfos === "object" ? Object.keys(c.modelInfos) : [];
        console.log(`[sys]   [${i}] ${c?.provider} legacy=${c?.isLegacy} indep=${c?.usesIndependentSettings} rev=${c?.apiKeyRevision ? "有" : "无"} default=${c?.defaultModelId || "-"} models=${ids.length}`);
      });
    } catch (err) {
      console.log(`[sys] 校验失败 ${String(err)}`);
    }
  }
  console.log("[sys] ===== 结束 =====");
}

/**
 * 把「寒霜注入工具 2」的代码替换成当前修复版。
 * 只替换源码（index.tsx / server.ts），保留它自己的 script.json、data/、dist/。
 * 旧版 server.ts 的 install-gateway-provider 会手写 agent-custom-providers.json，
 * 字段不全导致整份数组解码失败 —— 这就是「系统供应商被冲掉」的根源。
 */
async function replaceRivalScript() {
  console.log("[replace2] ===== 替换副本脚本源码 =====");
  const srcDir = Script.directory;
  const parent = Path.dirname(srcDir);
  const selfName = Path.basename(srcDir);
  console.log(`[replace2] 自身目录=${srcDir} 父目录=${parent} 名称=${selfName}`);

  const candidates = [`${selfName} 2`, "寒霜注入工具 2"];
  let dstDir: string | null = null;
  for (const c of candidates) {
    const p = Path.join(parent, c);
    if (FileManager.existsSync(p)) {
      dstDir = p;
      break;
    }
  }
  if (!dstDir) {
    console.log(`[replace2] 未找到副本目录，候选：${candidates.join(" / ")}`);
    return;
  }
  console.log(`[replace2] 目标目录=${dstDir}`);

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = Path.join(srcDir, "data", `rival-backup-${stamp}`);

  const files = ["index.tsx", "server.ts"];
  for (const f of files) {
    const s = Path.join(srcDir, f);
    const d = Path.join(dstDir, f);
    const srcTxt = readIfExists(s);
    if (srcTxt === null) {
      console.log(`[replace2] 源文件缺失 ${f}，跳过`);
      continue;
    }
    const oldTxt = readIfExists(d);
    // 备份副本原文件
    try {
      if (oldTxt !== null) {
        FileManager.writeAsStringSync(Path.join(backupDir, f), oldTxt, "utf-8");
        console.log(`[replace2] 已备份副本原 ${f}（${oldTxt.length} 字符）`);
      }
    } catch (err) {
      console.log(`[replace2] 备份 ${f} 失败 ${String(err)}`);
      continue;
    }
    FileManager.writeAsStringSync(d, srcTxt, "utf-8");
    console.log(`[replace2] 已写入 ${d}（${oldTxt === null ? 0 : oldTxt.length} -> ${srcTxt.length} 字符）`);
  }

  await new Promise<void>((r) => setTimeout(r, 800));

  // 回读校验：新代码里必须具备这两个修复标记
  const idx = readIfExists(Path.join(dstDir, "index.tsx")) || "";
  const srv = readIfExists(Path.join(dstDir, "server.ts")) || "";
  console.log(`[replace2] 校验 index.tsx bytes=${idx.length} 含sweep标志=${idx.includes("sweepLegacyFlags")} 含probe入口=${idx.includes("queryParameters")}`);
  console.log(`[replace2] 校验 server.ts bytes=${srv.length} 含拒绝手写注释=${srv.includes("绝不手写 App 的私有配置文件")} 含ScriptingAgent优先=${srv.includes("via: \"scriptingAgent\"")}`);
  console.log(`[replace2] 备份目录=${backupDir}`);
  console.log("[replace2] ===== 结束 =====");
}

/**
 * 只读排查：找出「寒霜注入工具 2」这份副本，并在它的源码里搜所有会碰
 * 供应商配置的语句（agent-global-settings / providerDefaults / builtInConnections /
 * agent-custom-providers / setProvider / install-gateway-provider）。
 * 目的是确认到底是哪一段把系统供应商连接表冲掉的。
 */
async function probeRivalScript() {
  console.log("[rival] ===== 排查副本脚本 =====");
  const PAT = /agent-global-settings|providerDefaults|builtInConnections|agent-custom-providers|setProvider|install-gateway-provider|scripting\/install|providerBaseURLs|retiredProviders/;
  const CODE_EXT = /\.(tsx?|js|mjs|json)$/i;

  for (const root of providerRoots()) {
    console.log(`[rival] root=${root}`);
    let items: any[] = [];
    try {
      items = FileManager.readDirectorySync(root) as any[];
    } catch (err) {
      console.log(`[rival]   读取失败 ${String(err)}`);
      continue;
    }
    const dirs = items
      .map((it: any) => (typeof it === "string" ? it : it?.name || ""))
      .filter((n: string) => n && /寒霜|hanshuang/i.test(n));
    console.log(`[rival]   寒霜相关条目(${dirs.length}) ${dirs.join(" | ")}`);

    for (const d of dirs) {
      const dirPath = Path.join(root, d);
      let isDir = false;
      try {
        isDir = FileManager.isDirectorySync(dirPath);
      } catch {}
      console.log(`[rival]   --- ${d} isDir=${isDir}`);
      if (!isDir) continue;

      let subs: any[] = [];
      try {
        subs = FileManager.readDirectorySync(dirPath) as any[];
      } catch (err) {
        console.log(`[rival]     读取失败 ${String(err)}`);
        continue;
      }
      const names = subs.map((it: any) => (typeof it === "string" ? it : it?.name || "")).filter(Boolean);
      console.log(`[rival]     文件(${names.length}) ${names.join(" | ")}`);

      for (const n of names) {
        if (!CODE_EXT.test(n)) continue;
        // 只看根层源码，跳过 dist 大文件
        const fp = Path.join(dirPath, n);
        let isSubDir = false;
        try {
          isSubDir = FileManager.isDirectorySync(fp);
        } catch {}
        if (isSubDir) continue;
        let txt = readIfExists(fp);
        if (!txt) continue;
        if (txt.length > 600000) {
          console.log(`[rival]       ${n} 过大(${txt.length})，跳过`);
          continue;
        }
        const lines = txt.split("\n");
        let hits = 0;
        lines.forEach((ln: string, i: number) => {
          if (!PAT.test(ln)) return;
          hits++;
          if (hits > 25) return;
          console.log(`[rival]       ${n}:${i + 1} ${ln.trim().slice(0, 260)}`);
        });
        console.log(`[rival]       ${n} 命中 ${hits} 行`);
      }
    }
  }
  console.log("[rival] ===== 排查结束 =====");
}

/**
 * 恢复「系统供应商」：先打印当前 builtInConnections 现状，再按 App 母本回填。
 */
async function probeRestoreBuiltIns() {
  console.log("[rb] ===== 恢复系统供应商 =====");
  for (const root of providerRoots()) {
    const setPath = Path.join(root, ".scripting", "agent-global-settings.json");
    const raw = readIfExists(setPath);
    if (raw === null) continue;
    try {
      const s = JSON.parse(raw);
      const pd = s?.providerDefaults || {};
      const conns: any[] = pd?.builtInConnections?.connections || [];
      console.log(`[rb] 修复前 ${setPath} bytes=${raw.length} 连接=${conns.length} 墓碑=${(pd?.retiredProviders || []).length}`);
      conns.forEach((c: any, i: number) => {
        const mi = c?.modelInfos;
        const n = mi && typeof mi === "object" ? Object.keys(mi).length : 0;
        console.log(`[rb]   [${i}] ${c?.provider}/${c?.authentication} legacy=${c?.isLegacy} models=${n} rev=${c?.apiKeyRevision ? "有" : "无"} keys=${Object.keys(c || {}).length}`);
      });
      if (conns.length === 0) console.log("[rb] 当前系统供应商连接表为空 —— 需要整体回填");
    } catch (err) {
      console.log(`[rb] 读取失败 ${String(err)}`);
    }
  }
  await revertBuiltInsShape();
  console.log("[rb] ===== 恢复结束 =====");
}

/**
 * 回退：以上一轮 App 自己写过的 agent-global-settings.json.hs-backup 为母本，
 * 只做「按 (provider, authentication) 去重」，其余字段一个不动。
 * 目的：把 builtInConnections 恢复成 App 原生形状，去掉我上一步硬塞的
 * usesIndependentSettings，避免 App 误判这几条 legacy 连接有独立凭据。
 */
async function revertBuiltInsShape() {
  console.log("[undo] ===== 还原 builtInConnections 原生形状 =====");

  for (const root of providerRoots()) {
    const dot = Path.join(root, ".scripting");
    const setPath = Path.join(dot, "agent-global-settings.json");
    const curRaw = readIfExists(setPath);
    const baseRaw = readIfExists(Path.join(dot, "agent-global-settings.json.hs-backup"));
    if (curRaw === null || baseRaw === null) {
      console.log(`[undo] ${setPath} 或缺母本，跳过（cur=${curRaw === null ? "无" : "有"} base=${baseRaw === null ? "无" : "有"}）`);
      continue;
    }

    let base: any;
    try {
      base = JSON.parse(baseRaw);
    } catch (err) {
      console.log(`[undo] 母本解析失败 ${String(err)}`);
      continue;
    }

    const pd = base?.providerDefaults;
    const conns: any[] = Array.isArray(pd?.builtInConnections?.connections) ? pd.builtInConnections.connections : [];
    const score = (c: any) => {
      const mi = c?.modelInfos;
      const n = mi && typeof mi === "object" ? Object.keys(mi).length : 0;
      return (c?.isLegacy === false ? 1000 : 0) + n * 10 + (c?.apiKeyRevision ? 5 : 0) + Object.keys(c || {}).length;
    };
    const best = new Map<string, any>();
    for (const c of conns) {
      const key = `${String(c?.provider)}|${String(c?.authentication)}`;
      const prev = best.get(key);
      if (!prev) best.set(key, c);
      else if (score(c) > score(prev)) {
        console.log(`[undo] 去重 ${key}: 保留 ${c?.id}，丢弃 ${prev?.id}`);
        best.set(key, c);
      } else {
        console.log(`[undo] 去重 ${key}: 保留 ${prev?.id}，丢弃 ${c?.id}`);
      }
    }
    const kept = Array.from(best.values());

    // 默认引用以当前文件为准（App 可能已改过），其余全部用母本
    let cur: any = null;
    try {
      cur = JSON.parse(curRaw);
    } catch {}
    const curPd = cur?.providerDefaults || {};
    const next = {
      ...base,
      providerDefaults: {
        ...pd,
        ...(typeof curPd.defaultProvider === "string" ? { defaultProvider: curPd.defaultProvider } : {}),
        ...(typeof curPd.defaultProviderID === "string" ? { defaultProviderID: curPd.defaultProviderID } : {}),
        ...(typeof curPd.defaultCustomProviderId === "string" ? { defaultCustomProviderId: curPd.defaultCustomProviderId } : {}),
        ...(typeof curPd.defaultModelId === "string" ? { defaultModelId: curPd.defaultModelId } : {}),
        builtInConnections: { ...(pd?.builtInConnections || {}), connections: kept, version: pd?.builtInConnections?.version ?? 1 },
      },
    };

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    try {
      FileManager.writeAsStringSync(Path.join(Script.directory, "data", `undo-backup-${stamp}.json`), curRaw, "utf-8");
      console.log(`[undo] 当前状态已备份 -> data/undo-backup-${stamp}.json`);
    } catch (err) {
      console.log(`[undo] 备份失败 ${String(err)}`);
      continue;
    }
    FileManager.writeAsStringSync(setPath, JSON.stringify(next, null, 2), "utf-8");
    console.log(`[undo] 已按母本写回（${conns.length} -> ${kept.length} 条连接）`);
  }

  await new Promise<void>((r) => setTimeout(r, 1200));

  for (const root of providerRoots()) {
    const setPath = Path.join(root, ".scripting", "agent-global-settings.json");
    const raw = readIfExists(setPath);
    if (raw === null) continue;
    try {
      const s = JSON.parse(raw);
      const pd = s?.providerDefaults || {};
      const conns: any[] = pd?.builtInConnections?.connections || [];
      console.log(`[undo] 校验 ${setPath} bytes=${raw.length}`);
      conns.forEach((c: any, i: number) => {
        const mi = c?.modelInfos;
        const n = mi && typeof mi === "object" ? Object.keys(mi).length : 0;
        console.log(`[undo]   [${i}] ${c?.provider}/${c?.authentication} legacy=${c?.isLegacy} models=${n} keys(${Object.keys(c || {}).length})=${Object.keys(c || {}).join(",")}`);
      });
      console.log(`[undo]   defaultProvider=${pd?.defaultProvider} defaultCustomProviderId=${pd?.defaultCustomProviderId} defaultModelId=${pd?.defaultModelId} retired=${(pd?.retiredProviders || []).length}`);
    } catch (err) {
      console.log(`[undo] 校验失败 ${String(err)}`);
    }
  }
  console.log("[undo] ===== 结束 =====");
}

/**
 * 只读对比：把每个历史备份里 builtInConnections 每条连接的键列出来，
 * 找出「App 原本写过、现在丢了」的字段（尤其是 apiKeyRevision）。
 */
async function probeSettingsHistory() {
  console.log("[cmp] ===== 历史设置对比 =====");
  for (const root of providerRoots()) {
    const dot = Path.join(root, ".scripting");
    let items: any[] = [];
    try {
      items = FileManager.readDirectorySync(dot) as any[];
    } catch {
      continue;
    }
    const names = items
      .map((it: any) => (typeof it === "string" ? it : it?.name || ""))
      .filter((n: string) => /^agent-global-settings.*\.json/.test(n))
      .sort();
    console.log(`[cmp] 候选文件(${names.length}) ${names.join(" | ")}`);
    for (const n of names) {
      const raw = readIfExists(Path.join(dot, n));
      if (!raw) continue;
      let s: any;
      try {
        s = JSON.parse(raw);
      } catch (err) {
        console.log(`[cmp] ${n} len=${raw.length} 解析失败`);
        continue;
      }
      const pd = s?.providerDefaults || {};
      const conns: any[] = pd?.builtInConnections?.connections || [];
      console.log(`[cmp] --- ${n} len=${raw.length} conns=${conns.length} bicVersion=${pd?.builtInConnections?.version} retired=${(pd?.retiredProviders || []).length}`);
      conns.forEach((c: any, i: number) => {
        const mi = c?.modelInfos;
        const m = mi && typeof mi === "object" ? Object.keys(mi).length : 0;
        console.log(`[cmp]   [${i}] ${c?.provider}/${c?.authentication} legacy=${c?.isLegacy} id=${c?.id} models=${m} keys(${Object.keys(c || {}).length})=${Object.keys(c || {}).join(",")}`);
      });
    }
  }
  console.log("[cmp] ===== 对比结束 =====");
}

/**
 * 只读：扫 app 的 settings.json，列出与 agent / provider / model 相关的键，
 * 用来确认「系统供应商」列表是否还有第三处状态（缓存 / 迁移标记 / 上次错误）。
 */
async function probeAppSettings() {
  console.log("[as] ===== settings.json 概览 =====");
  for (const root of providerRoots()) {
    const fp = Path.join(root, ".scripting", "settings.json");
    const raw = readIfExists(fp);
    if (raw === null) continue;
    console.log(`[as] === ${fp} len=${raw.length}`);
    let s: any;
    try {
      s = JSON.parse(raw);
    } catch (err) {
      console.log(`[as] 解析失败 ${String(err)}`);
      continue;
    }
    if (!s || typeof s !== "object") {
      console.log(`[as] 顶层类型 ${typeof s}`);
      continue;
    }
    const keys = Object.keys(s);
    console.log(`[as] 顶层 keys(${keys.length}) ${keys.join(",")}`);
    for (const k of keys) {
      if (!/agent|provider|model|assistant|connection/i.test(k)) continue;
      const v = s[k];
      let desc = "";
      if (Array.isArray(v)) desc = `array(${v.length})`;
      else if (v && typeof v === "object") desc = `object(${Object.keys(v).length})`;
      else desc = `${typeof v}=${String(v).slice(0, 60)}`;
      console.log(`[as]   ${k}: ${desc}`);
      if (v && typeof v === "object") {
        const compact = JSON.stringify(v);
        console.log(`[as]     ${compact.slice(0, 700)}`);
        if (compact.length > 700) console.log(`[as]     ...(total ${compact.length})`);
      }
    }
  }
  console.log("[as] ===== 概览结束 =====");
}

/**
 * 修复「系统供应商」连接表：providerDefaults.builtInConnections.connections
 * 已知问题：openrouter 存在两条 (provider, authentication) 完全相同的连接
 * （一条 isLegacy=true 的空壳 + 一条非 legacy 的实壳），App 在新增系统供应商时
 * 会对该表做写回校验，重复项会让整个变更失败并抛出 AgentProviderConnectionError。
 * 这里按 (provider, authentication) 去重，保留字段更全 / 非 legacy 的那条，
 * 同时清掉与现存连接 ID 冲突的 retiredProviders 墓碑，并给每条连接补齐布尔字段。
 */
async function repairBuiltIns() {
  console.log("[bic] ===== 系统供应商连接表修复 =====");
  let touched = 0;

  for (const root of providerRoots()) {
    const setPath = Path.join(root, ".scripting", "agent-global-settings.json");
    const raw = readIfExists(setPath);
    if (raw === null) continue;

    let s: any;
    try {
      s = JSON.parse(raw);
    } catch (err) {
      console.log(`[bic] ${setPath} 解析失败，跳过：${String(err)}`);
      continue;
    }
    const pd = s?.providerDefaults;
    const conns: any[] = Array.isArray(pd?.builtInConnections?.connections) ? pd.builtInConnections.connections : [];
    if (conns.length === 0) {
      console.log(`[bic] ${setPath} 无 builtInConnections，跳过`);
      continue;
    }
    console.log(`[bic] 原始连接 ${conns.length} 条：`);
    conns.forEach((c: any, i: number) => {
      const mi = c?.modelInfos;
      const n = mi && typeof mi === "object" ? Object.keys(mi).length : 0;
      console.log(`[bic]   [${i}] provider=${c?.provider} auth=${c?.authentication} legacy=${c?.isLegacy} id=${c?.id} models=${n} indep=${c?.usesIndependentSettings}`);
    });

    const score = (c: any) => {
      const mi = c?.modelInfos;
      const n = mi && typeof mi === "object" ? Object.keys(mi).length : 0;
      return (c?.isLegacy === false ? 1000 : 0) + n * 10 + (c?.apiKeyRevision ? 5 : 0) + (c?.defaultModelId ? 3 : 0) + Object.keys(c || {}).length;
    };

    const best = new Map<string, any>();
    for (const c of conns) {
      const key = `${String(c?.provider)}|${String(c?.authentication)}`;
      const prev = best.get(key);
      if (!prev || score(c) > score(prev)) {
        if (prev) console.log(`[bic] 去重 ${key}: 丢弃 id=${prev?.id}(score ${score(prev)})，保留 id=${c?.id}(score ${score(c)})`);
        best.set(key, c);
      } else {
        console.log(`[bic] 去重 ${key}: 丢弃 id=${c?.id}(score ${score(c)})，保留 id=${prev?.id}(score ${score(prev)})`);
      }
    }
    const kept = Array.from(best.values());

    // 规范化字段
    for (const c of kept) {
      if (typeof c.id !== "string") c.id = genUUID();
      if (typeof c.isLegacy !== "boolean") c.isLegacy = false;
      if (typeof c.usesIndependentSettings !== "boolean") c.usesIndependentSettings = true;
      if (typeof c.authentication !== "string" || !c.authentication) c.authentication = "apiKey";
      if (c.modelInfos && typeof c.modelInfos !== "object") delete c.modelInfos;
    }

    // 墓碑清理：与现存连接 ID 冲突的 retiredProviders 会让 App 认为该连接已删除
    const liveIds = new Set(kept.map((c: any) => String(c.id)));
    const retired: any[] = Array.isArray(pd?.retiredProviders) ? pd.retiredProviders : [];
    const retiredNext = retired.filter((r: any) => {
      const id = String(r?.id || "");
      if (id && liveIds.has(id)) {
        console.log(`[bic] 移除冲突墓碑 provider=${r?.provider} id=${id}`);
        return false;
      }
      return true;
    });
    if (retired.length !== retiredNext.length) console.log(`[bic] 墓碑 ${retired.length} -> ${retiredNext.length}`);

    // 写回前的默认引用一致性
    let defaultProvider = pd?.defaultProvider;
    const customId = pd?.defaultCustomProviderId;
    const provFile = readIfExists(Path.join(root, ".scripting", "agent-custom-providers.json"));
    let customNames: string[] = [];
    try {
      const list: any[] = JSON.parse(provFile || "[]");
      customNames = list.map((p: any) => String(p?.name || "")).filter(Boolean);
    } catch {}
    console.log(`[bic] defaultProvider=${defaultProvider} defaultCustomProviderId=${customId} 自定义供应商=${customNames.join(",")}`);
    if (defaultProvider === "custom" && customId && !customNames.includes(String(customId))) {
      console.log(`[bic] 警告：defaultCustomProviderId=${customId} 在自定义列表中不存在`);
    }

    const next = {
      ...s,
      providerDefaults: {
        ...pd,
        builtInConnections: { ...(pd?.builtInConnections || {}), connections: kept, version: pd?.builtInConnections?.version ?? 1 },
        retiredProviders: retiredNext,
      },
    };

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    try {
      FileManager.writeAsStringSync(Path.join(Script.directory, "data", `bic-backup-${stamp}.json`), raw, "utf-8");
      console.log(`[bic] 已备份 -> data/bic-backup-${stamp}.json`);
    } catch (err) {
      console.log(`[bic] 备份失败 ${String(err)}`);
      continue;
    }
    FileManager.writeAsStringSync(setPath, JSON.stringify(next, null, 2), "utf-8");
    touched++;
    console.log(`[bic] 已写回 ${setPath}`);
  }

  await new Promise<void>((r) => setTimeout(r, 1200));

  // 回读校验
  for (const root of providerRoots()) {
    const setPath = Path.join(root, ".scripting", "agent-global-settings.json");
    const raw = readIfExists(setPath);
    if (raw === null) continue;
    try {
      const s = JSON.parse(raw);
      const pd = s?.providerDefaults || {};
      const conns: any[] = pd?.builtInConnections?.connections || [];
      console.log(`[bic] 校验 ${setPath}`);
      conns.forEach((c: any, i: number) => {
        const mi = c?.modelInfos;
        const n = mi && typeof mi === "object" ? Object.keys(mi).length : 0;
        console.log(`[bic]   [${i}] provider=${c?.provider} auth=${c?.authentication} legacy=${c?.isLegacy} id=${c?.id} models=${n}`);
      });
      console.log(`[bic]   墓碑=${(pd?.retiredProviders || []).length} 字节=${raw.length}`);
    } catch (err) {
      console.log(`[bic] 校验解析失败 ${String(err)}`);
    }
  }
  console.log(`[bic] ===== 结束（改写 ${touched} 个文件）=====`);
}

/**
 * 完整转储 agent-global-settings.json（重点是 providerDefaults 里的
 * builtInConnections / retiredProviders —— 系统供应商的连接配置就存在这里）
 */
async function probeSettingsDump() {
  console.log("[dump] ===== 设置转储开始 =====");
  for (const root of providerRoots()) {
    const setPath = Path.join(root, ".scripting", "agent-global-settings.json");
    const raw = readIfExists(setPath);
    if (raw === null) continue;
    console.log(`[dump] === ${setPath} len=${raw.length}`);
    try {
      const s = JSON.parse(raw);
      const compact = JSON.stringify(s);
      for (let i = 0; i < compact.length; i += 600) {
        console.log(`[dump] cfg[${i}] ${compact.slice(i, i + 600)}`);
      }
    } catch (err) {
      console.log(`[dump] 解析失败 ${String(err)}`);
    }
  }

  // 模型目录文件
  for (const root of providerRoots()) {
    for (const fname of ["agent-custom-models.json", "agent-custom-models 2.json"]) {
      const fp = Path.join(root, ".scripting", fname);
      const raw = readIfExists(fp);
      if (raw === null) continue;
      console.log(`[dump] === ${fp} len=${raw.length}`);
      try {
        const m = JSON.parse(raw);
        console.log(`[dump]   顶层=${Array.isArray(m) ? "array" : typeof m} keys=${Array.isArray(m) ? m.length : Object.keys(m || {}).join(",")}`);
        const compact = JSON.stringify(m);
        for (let i = 0; i < compact.length; i += 600) {
          console.log(`[dump]   models[${i}] ${compact.slice(i, i + 600)}`);
        }
      } catch (err) {
        console.log(`[dump]   解析失败 ${String(err)}`);
      }
    }
  }

  // 每个 provider 的 modelInfos 数量
  for (const root of providerRoots()) {
    const provPath = Path.join(root, ".scripting", "agent-custom-providers.json");
    const raw = readIfExists(provPath);
    if (raw === null) continue;
    try {
      const list: any[] = JSON.parse(raw);
      list.forEach((pr: any, i: number) => {
        const mi = pr?.modelInfos;
        const kind = Array.isArray(mi) ? `arr(${mi.length})` : mi && typeof mi === "object" ? `obj(${Object.keys(mi).length})` : String(mi);
        console.log(`[dump] prov[${i}] ${pr?.name} apiType=${pr?.apiType} cur=${pr?.currentModelId} modelInfos=${kind}`);
        if (mi && typeof mi === "object") {
          const first = Array.isArray(mi) ? mi[0] : mi[Object.keys(mi)[0]];
          if (first) console.log(`[dump]   sample keys(${Object.keys(first).length}) ${JSON.stringify(first).slice(0, 500)}`);
        }
        console.log(`[dump]   fullKeys ${Object.keys(pr || {}).join(",")}`);
      });
    } catch (err) {
      console.log(`[dump] providers 解析失败 ${String(err)}`);
    }
  }
  console.log("[dump] ===== 设置转储结束 =====");
}

/**
 * 只读快照：列出每个 root 下 .scripting 的真实文件清单（名字 + 大小），
 * 并打印 providers 条目的字段组成，用于判断「系统供应商」到底落在哪个文件。
 */
async function probeDirSnapshot() {
  console.log("[ls] ===== 目录快照开始 =====");

  const roots = providerRoots();
  console.log(`[ls] roots(${roots.length}) = ${roots.join(" || ")}`);

  for (const root of roots) {
    const dot = Path.join(root, ".scripting");
    console.log(`[ls] --- ${dot}`);
    if (!FileManager.existsSync(dot)) {
      console.log("[ls]   目录不存在");
      continue;
    }
    let items: any[] = [];
    try {
      items = FileManager.readDirectorySync(dot) as any[];
    } catch (err) {
      console.log(`[ls]   读取失败 ${String(err)}`);
      continue;
    }
    for (const it of items) {
      const name = typeof it === "string" ? it : it?.name || "";
      if (!name) continue;
      const fp = Path.join(dot, name);
      let isDir = false;
      let size = -1;
      try {
        isDir = FileManager.isDirectorySync(fp);
      } catch {}
      if (!isDir) {
        try {
          size = FileManager.statSync(fp).size;
        } catch {}
      }
      console.log(`[ls]   ${isDir ? "D" : "F"} ${name} ${size}`);
    }
  }

  // providers 条目字段组成
  for (const root of roots) {
    const provPath = Path.join(root, ".scripting", "agent-custom-providers.json");
    const raw = readIfExists(provPath);
    if (raw === null) continue;
    console.log(`[ls] === ${provPath} len=${raw.length}`);
    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      console.log(`[ls]   JSON 解析失败 ${String(err)}`);
      continue;
    }
    const list: any[] = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.providers) ? parsed.providers : [];
    console.log(`[ls]   顶层类型=${Array.isArray(parsed) ? "array" : typeof parsed} 条目=${list.length}`);
    list.forEach((pr: any, i: number) => {
      const pk = pr && typeof pr === "object" ? Object.keys(pr) : [];
      console.log(`[ls]   [${i}] name=${pr?.name} pid=${pr?.providerID} base=${pr?.baseURL || pr?.baseUrl} keys=${pk.length}`);
      console.log(`[ls]        ${pk.join(",")}`);
      const ms: any[] = Array.isArray(pr?.models) ? pr.models : [];
      console.log(`[ls]        models=${ms.length} ${ms.map((m: any) => m?.id).join("|")}`);
      if (ms[0]) console.log(`[ls]        model0keys(${Object.keys(ms[0]).length}) ${Object.keys(ms[0]).join(",")}`);
    });
  }

  // 全局设置里的 providerDefaults
  for (const root of roots) {
    const setPath = Path.join(root, ".scripting", "agent-global-settings.json");
    const raw = readIfExists(setPath);
    if (raw === null) continue;
    console.log(`[ls] === ${setPath} len=${raw.length}`);
    try {
      const s = JSON.parse(raw);
      console.log(`[ls]   顶层 keys=${Object.keys(s || {}).join(",")}`);
      const pd = s?.providerDefaults;
      if (pd) {
        const flat: Record<string, any> = {};
        for (const k of Object.keys(pd)) {
          const v = pd[k];
          flat[k] = v && typeof v === "object" ? `[${Array.isArray(v) ? "arr" : "obj"} ${Object.keys(v).length}]` : v;
        }
        console.log(`[ls]   providerDefaults=${JSON.stringify(flat)}`);
      } else {
        console.log("[ls]   无 providerDefaults");
      }
    } catch (err) {
      console.log(`[ls]   JSON 解析失败 ${String(err)}`);
    }
  }

  // App 内 ScriptingAgent 是否可用 + 真实返回结构
  let agent: any = null;
  try {
    agent = typeof ScriptingAgent !== "undefined" ? ScriptingAgent : null;
  } catch (err) {
    console.log(`[ls] ScriptingAgent 取用抛错 ${String(err)}`);
  }
  console.log(`[ls] typeof ScriptingAgent = ${typeof ScriptingAgent}`);
  if (agent && typeof agent.listProviders === "function") {
    try {
      const res = await agent.listProviders();
      const arr: any[] = Array.isArray(res) ? res : Array.isArray(res?.providers) ? res.providers : [];
      console.log(`[ls] listProviders OK count=${arr.length}`);
      arr.forEach((p: any, i: number) => {
        console.log(`[ls]   api[${i}] name=${p?.name} pid=${p?.providerID} kind=${p?.kind} system=${p?.isSystem} ${Object.keys(p || {}).length}keys`);
      });
      if (arr[0]) logChunks("[ls] api0", JSON.stringify(arr[0]), 700, 6000);
    } catch (err) {
      console.log(`[ls] listProviders 抛错 ${String(err)}`);
    }
  } else {
    console.log("[ls] ScriptingAgent 不可用或无 listProviders");
  }

  console.log("[ls] ===== 目录快照结束 =====");
}

async function runBootDiagnostics() {  const dataDir = Path.join(Script.directory, "data");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  console.log("[诊断] ===== 开始 Provider 配置体检 =====");

  for (const root of providerRoots()) {
    const dot = Path.join(root, ".scripting");
    console.log(`[诊断] root=${root}`);
    try {
      const items = FileManager.readDirectorySync(dot);
      logChunks(`list@${root}`, JSON.stringify(items), 700, 6000);
    } catch (err) {
      console.log(`[诊断] list@${root} :: ERR ${String(err)}`);
    }
    for (const fname of [
      "agent-custom-providers.json",
      "agent-global-settings.json",
      "agent-custom-providers 2.json",
      "agent-custom-models.json",
      "agent-custom-models 2.json",
    ]) {
      const fp = Path.join(dot, fname);
      const raw = readIfExists(fp);
      if (raw === null) {
        console.log(`[诊断] missing ${fp}`);
        continue;
      }
      logChunks(`raw:${fname}`, raw, 700, 40000);
      try {
        const bak = Path.join(dataDir, `backup-${fname}-${stamp}.json`);
        FileManager.writeAsStringSync(bak, raw, "utf-8");
        console.log(`[诊断] 已备份 -> ${bak}`);
      } catch (err) {
        console.log(`[诊断] 备份失败 ${String(err)}`);
      }
      try {
        JSON.parse(raw);
        console.log(`[诊断] JSON 可解析: ${fname}`);
      } catch (err) {
        console.log(`[诊断] JSON 解析失败: ${fname} :: ${String(err)}`);
      }
    }
  }
  console.log("[诊断] ===== 体检结束 =====");

  // 回读 data/ 下的 providers 备份，便于异地还原
  try {
    const items = FileManager.readDirectorySync(dataDir);
    for (const it of items as any[]) {
      const name = typeof it === "string" ? it : it?.name || "";
      if (!name.startsWith("backup-agent-custom-providers")) continue;
      const raw = readIfExists(Path.join(dataDir, name)) || "";
      console.log(`[诊断] backup=${name} len=${raw.length}`);
      logChunks(`backup:${name}`, raw, 700, 80000);
    }
  } catch (err) {
    console.log(`[诊断] 回读备份失败 ${String(err)}`);
  }
  console.log("[诊断] ===== 备份回读结束 =====");
}

/**
 * 修复：移除手工写入、字段不全的寒霜网关条目。
 * App 的 on-disk schema 比公开 API 多一大票字段，手写条目会让整个数组解码失败，
 * 表现就是「已有供应商全部消失 + 无法新增供应商」。这里只删掉我们自己那一条，
 * 用户原有条目原样保留。
 */
async function repairProviderConfig() {
  const dataDir = Path.join(Script.directory, "data");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  console.log("[修复] ===== 开始修复 Provider 配置 =====");

  for (const root of providerRoots()) {
    const dot = Path.join(root, ".scripting");
    const provPath = Path.join(dot, "agent-custom-providers.json");
    const settingsPath = Path.join(dot, "agent-global-settings.json");
    const raw = readIfExists(provPath);
    if (raw === null) continue;

    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      console.log(`[修复] ${provPath} JSON 无法解析，放弃：${String(err)}`);
      continue;
    }

    const isArray = Array.isArray(parsed);
    const list: any[] = isArray ? parsed : Array.isArray(parsed?.providers) ? parsed.providers : [];
    console.log(`[修复] 原始条目: ${list.map((pr: any) => `${pr?.name || "?"}#${pr?.providerID || pr?.id || "?"}`).join(" | ")}`);

    const kept = list.filter((pr: any) => {
      const id = pr?.providerID || pr?.id || "";
      const base = String(pr?.baseUrl || pr?.baseURL || "");
      const isOurs = id === "HANSHUANG-GATEWAY-5190" || base.includes("127.0.0.1");
      if (isOurs) console.log(`[修复] 移除损坏条目 name=${pr?.name} id=${id} base=${base}`);
      return !isOurs;
    });

    if (kept.length !== list.length) {
      try {
        FileManager.writeAsStringSync(Path.join(dataDir, `repair-backup-providers-${stamp}.json`), raw, "utf-8");
      } catch (err) {
        console.log(`[修复] 备份失败 ${String(err)}`);
      }
      const next = isArray ? kept : { ...parsed, providers: kept };
      FileManager.writeAsStringSync(provPath, JSON.stringify(next, null, 2), "utf-8");
      console.log(`[修复] 已写回 ${provPath}（${list.length} -> ${kept.length} 条）`);
    } else {
      console.log(`[修复] provider 列表无需移除（共 ${list.length} 条）`);
    }

    // 默认模型若指向已不存在的 provider，清空让 App 回落内置默认
    try {
      const sRaw = readIfExists(settingsPath);
      if (sRaw) {
        const s = JSON.parse(sRaw);
        const pd = s?.providerDefaults;
        if (pd && typeof pd === "object") {
          const scalar: Record<string, any> = {};
          for (const k of Object.keys(pd)) {
            const v = pd[k];
            scalar[k] = v && typeof v === "object" ? (Array.isArray(v) ? `[arr ${v.length}]` : `[obj ${Object.keys(v).length}]`) : v;
          }
          console.log(`[修复] providerDefaults 标量: ${JSON.stringify(scalar)}`);

          const ids = new Set(kept.map((pr: any) => pr?.providerID || pr?.id).filter(Boolean));
          const danglingKeys: string[] = [];
          for (const k of ["defaultProviderID", "defaultCustomProviderId"]) {
            const v = pd[k];
            if (v && !ids.has(v)) danglingKeys.push(k);
          }
          if (pd.defaultProviderID === "HANSHUANG-GATEWAY-5190") danglingKeys.push("defaultProviderID");

          if (danglingKeys.length) {
            try {
              FileManager.writeAsStringSync(Path.join(dataDir, `repair-backup-settings-${stamp}.json`), sRaw, "utf-8");
            } catch {}
            const removed: Record<string, any> = {};
            for (const k of Array.from(new Set(danglingKeys))) {
              removed[k] = pd[k];
              delete pd[k];
            }
            delete pd.defaultModelId;
            if (pd.defaultProvider === "custom") delete pd.defaultProvider;
            s.updatedAt = Date.now() / 1000;
            FileManager.writeAsStringSync(settingsPath, JSON.stringify(s, null, 2), "utf-8");
            console.log(`[修复] 已清除悬空默认供应商 ${JSON.stringify(removed)}，回落内置默认`);
          } else {
            console.log("[修复] 默认供应商无悬空引用");
          }
        }
      }
    } catch (err) {
      console.log(`[修复] 处理默认模型失败 ${String(err)}`);
    }
  }
  console.log("[修复] ===== 修复结束 =====");
}

/** 修复后用官方 API 复核：App 自己认到几个供应商/模型 */
async function verifyProviders() {
  try {
    const agent: any = (globalThis as any).ScriptingAgent;
    console.log(`[复核] ScriptingAgent: ${agent ? "present" : "missing"}`);
    if (!agent || typeof agent.listProviders !== "function") return;
    const list = await agent.listProviders();
    if (!Array.isArray(list)) {
      console.log(`[复核] listProviders 返回异常: ${JSON.stringify(list)}`);
      return;
    }
    console.log(`[复核] 供应商数: ${list.length}`);
    for (const pr of list) {
      const models = Array.isArray(pr?.models) ? pr.models.map((mm: any) => mm?.id).join(",") : "";
      console.log(`[复核] ${pr?.name} | id=${pr?.id} | base=${pr?.baseURL || pr?.baseUrl || ""} | models=${models}`);
    }
  } catch (err) {
    console.log(`[复核] 失败 :: ${String(err)}`);
  }
}

async function run() {
  // 0. 申请脚本级文件系统权限
  // 注入目标都在脚本目录之外（~/Documents/assistant-rules 等），未授权时会“写入失败但不报错地不生效”。
  try {
    const granted = await Script.requestAccess(["fileSystem"]);
    console.log("[寒霜注入工具] 文件系统权限:", granted);
    if (!granted.includes("fileSystem")) {
      await Dialog.alert({
        title: "⚠️ 缺少文件系统权限",
        message: "注入目标在脚本目录之外（如 ~/Documents/assistant-rules），没有该权限时会导致「写入失败 / 注入不生效」。\n\n请到 设置 → 脚本权限 → 寒霜注入工具 → 文件，改为“允许”后重新运行。",
      });
    }
  } catch (err) {
    console.log("[寒霜注入工具] 申请文件系统权限失败", err);
  }

  // 0.1 申请 Scripting Agent 权限（官方 Provider 读写接口依赖它）
  try {
    const granted2 = await Script.requestAccess(["fileSystem", "scriptingAgent"] as any);
    console.log("[寒霜注入工具] 当前权限:", granted2);
  } catch (err) {
    console.log("[寒霜注入工具] 申请 Agent 权限失败（可能当前版本不支持）", String(err));
  }

  // 1. 启动 HttpServer 本地网关与 Web 控制台
  const actualPort = startHttpServer(5190);
  console.log(`[寒霜注入工具] 服务已挂载于端口 ${actualPort}`);
  if (gatewayLastError) {
    console.log(`[寒霜注入工具] 网关告警：${gatewayLastError}`);
  }

  // 2. 启用系统下拉手势最小化保护（防手势关闭杀死进程）
  try {
    if (typeof Script.enableMinimize === "function") {
      Script.enableMinimize(true);
      console.log("[寒霜注入工具] 已开启下滑手势自动最小化保护 (Script.enableMinimize)");
    }
  } catch (err) {
    console.log("[寒霜注入工具] 当前环境暂不支持 enableMinimize", err);
  }

  // 3. 自动启动系统级后台常驻保活 (异步启动，绝不阻塞界面启动)
  try {
    backgroundManager.startKeepAlive().catch((err) => {
      console.error("[寒霜注入工具] 启动后台常驻保活失败", err);
    });
    console.log("[寒霜注入工具] 已调度后台保活启动任务");
  } catch (err) {
    console.error("[寒霜注入工具] 启动后台常驻保活异常", err);
  }
  // 3.5 设备端体检（存在 data/diag.flag 时执行一次，执行完直接退出，不接管常驻）
  // 关键修复：flag 必须一次性消费。旧实现跑完体检不删 flag，
  // 导致此后每次启动都进体检分支并 Script.exit()，本地网关永远起不来。
  try {
    const diagFlag = Path.join(Script.directory, "data", "diag.flag");
    const repairFlag = Path.join(Script.directory, "data", "repair.flag");
    if (FileManager.existsSync(diagFlag)) {
      // 先消费 flag，确保即使体检抛错也不会下次再进体检分支
      try {
        FileManager.removeSync(diagFlag);
      } catch (e) {
        console.log("[诊断] 删除 diag.flag 失败", String(e));
      }
      await selfTestGateway(actualPort);
      await runBootDiagnostics();
      if (FileManager.existsSync(repairFlag)) {
        await repairProviderConfig();
        try {
          FileManager.removeSync(repairFlag);
        } catch (e) {
          console.log("[诊断] 删除 repair.flag 失败", String(e));
        }
      }
      await verifyProviders();
      console.log("[诊断] 体检模式：跳过后台常驻，直接退出");
      Script.exit("DIAG_DONE");
      return;
    }
    // 残留的 repair.flag 单独存在时也要清掉，避免后续误触发
    if (FileManager.existsSync(repairFlag)) {
      try {
        FileManager.removeSync(repairFlag);
        console.log("[诊断] 已清理残留 repair.flag");
      } catch {}
    }
  } catch (err) {
    console.log("[诊断] 体检异常", String(err));
    Script.exit("DIAG_FAILED");
    return;
  }

  // 3.46 启动清理：扫掉一切遗留的 *.flag，并支持用 queryParameters 触发探针
  //      （旧做法靠 data/xxx.flag 文件，CLI 会把它推到设备且不会回收，
  //        残留的 flag 会让正常启动直接走探针分支然后 exit，表现为“脚本秒退”）
  try {
    const swept = sweepLegacyFlags();
    if (swept > 0) console.log(`[clean] 已清理遗留 flag ${swept} 个`);
    const probeName = readProbeParam();
    if (probeName) {
      console.log(`[probe] queryParameters.probe=${probeName}`);
      await runProbeByName(probeName);
      Script.exit(`PROBE_${probeName.toUpperCase()}_DONE`);
      return;
    }
  } catch (err) {
    console.log("[clean] 清理/探针异常", String(err));
  }

  // 3.47 修复：把 5 条自定义供应商补齐到 App 当前 13 键格式（一次性）
  try {
    const keysFixFlag = Path.join(Script.directory, "data", "provider-keysfix.flag");
    if (FileManager.existsSync(keysFixFlag)) {
      try {
        FileManager.removeSync(keysFixFlag);
      } catch {}
      await fixProviderKeySchema();
      console.log("[pk] 完成，退出");
      Script.exit("PK_DONE");
      return;
    }
  } catch (err) {
    console.log("[pk] 异常", String(err));
  }

  // 3.48 只读：对比 App 自己写过的 providers 样本字段（一次性）
  try {
    const sampleFlag = Path.join(Script.directory, "data", "provider-sample.flag");
    if (FileManager.existsSync(sampleFlag)) {
      try {
        FileManager.removeSync(sampleFlag);
      } catch {}
      await probeAppSamples();
      console.log("[sample] 完成，退出");
      Script.exit("SAMPLE_DONE");
      return;
    }
  } catch (err) {
    console.log("[sample] 异常", String(err));
  }

  // 3.49 回退：把 builtInConnections 还原成 App 原生形状（一次性）
  try {
    const undoFlag = Path.join(Script.directory, "data", "provider-undo.flag");
    if (FileManager.existsSync(undoFlag)) {
      try {
        FileManager.removeSync(undoFlag);
      } catch {}
      await revertBuiltInsShape();
      console.log("[undo] 完成，退出");
      Script.exit("UNDO_DONE");
      return;
    }
  } catch (err) {
    console.log("[undo] 异常", String(err));
  }

  // 3.5 只读：对比各历史备份里 builtInConnections 的字段组成（一次性）
  try {
    const cmpFlag = Path.join(Script.directory, "data", "provider-cmp.flag");
    if (FileManager.existsSync(cmpFlag)) {
      try {
        FileManager.removeSync(cmpFlag);
      } catch {}
      await probeSettingsHistory();
      console.log("[cmp] 完成，退出");
      Script.exit("CMP_DONE");
      return;
    }
  } catch (err) {
    console.log("[cmp] 异常", String(err));
  }

  // 3.51 只读：app settings.json 里与 agent/provider/model 相关的段落（一次性）
  try {
    const setFlag = Path.join(Script.directory, "data", "provider-appsettings.flag");
    if (FileManager.existsSync(setFlag)) {
      try {
        FileManager.removeSync(setFlag);
      } catch {}
      await probeAppSettings();
      console.log("[as] 完成，退出");
      Script.exit("AS_DONE");
      return;
    }
  } catch (err) {
    console.log("[as] 异常", String(err));
  }

  // 3.52 修复系统供应商连接表：去重 + 规范化 + 清理墓碑冲突（一次性）
  try {
    const bicFlag = Path.join(Script.directory, "data", "provider-bic.flag");
    if (FileManager.existsSync(bicFlag)) {
      try {
        FileManager.removeSync(bicFlag);
      } catch {}
      await repairBuiltIns();
      console.log("[bic] 完成，退出");
      Script.exit("BIC_DONE");
      return;
    }
  } catch (err) {
    console.log("[bic] 异常", String(err));
  }

  // 3.53 完整转储：全局设置里的 builtInConnections / retiredProviders（一次性）
  try {
    const dumpFlag = Path.join(Script.directory, "data", "provider-dump.flag");
    if (FileManager.existsSync(dumpFlag)) {
      try {
        FileManager.removeSync(dumpFlag);
      } catch {}
      await probeSettingsDump();
      console.log("[dump] 完成，退出");
      Script.exit("DUMP_DONE");
      return;
    }
  } catch (err) {
    console.log("[dump] 异常", String(err));
  }

  // 3.54 只读快照：把 .scripting 目录结构 + 现有条目的字段组成打出来（一次性）
  try {
    const lsFlag = Path.join(Script.directory, "data", "provider-ls.flag");
    if (FileManager.existsSync(lsFlag)) {
      try {
        FileManager.removeSync(lsFlag);
      } catch {}
      await probeDirSnapshot();
      console.log("[ls] 完成，退出");
      Script.exit("LS_DONE");
      return;
    }
  } catch (err) {
    console.log("[ls] 异常", String(err));
  }

  // 3.55 只读探针：定位设备上真实的 Provider 配置落点（一次性）
  try {
    const probeFlag = Path.join(Script.directory, "data", "provider-probe.flag");
    const inspectFlag = Path.join(Script.directory, "data", "provider-inspect.flag");
    if (FileManager.existsSync(probeFlag)) {
      try {
        FileManager.removeSync(probeFlag);
      } catch {}
      await probeProviderFiles();
      console.log("[探针] 完成，退出");
      Script.exit("PROBE_DONE");
      return;
    }
    if (FileManager.existsSync(inspectFlag)) {
      try {
        FileManager.removeSync(inspectFlag);
      } catch {}
      await inspectProviderContent();
      console.log("[内容] 完成，退出");
      Script.exit("INSPECT_DONE");
      return;
    }
    const restoreFlag = Path.join(Script.directory, "data", "provider-restore.flag");
    const probe2Flag = Path.join(Script.directory, "data", "provider-probe2.flag");
    const probe3Flag = Path.join(Script.directory, "data", "provider-probe3.flag");
    const keysFlag = Path.join(Script.directory, "data", "provider-keys.flag");
    const normFlag = Path.join(Script.directory, "data", "provider-normalize.flag");
    const v4Flag = Path.join(Script.directory, "data", "provider-v4.flag");
    const v5Flag = Path.join(Script.directory, "data", "provider-v5.flag");
    const fixRefFlag = Path.join(Script.directory, "data", "provider-fixref.flag");
    if (FileManager.existsSync(fixRefFlag)) {
      try {
        FileManager.removeSync(fixRefFlag);
      } catch {}
      await fixDefaultRef();
      console.log("[fix] 完成，退出");
      Script.exit("FIXREF_DONE");
      return;
    }
    if (FileManager.existsSync(v5Flag)) {
      try {
        FileManager.removeSync(v5Flag);
      } catch {}
      await probeDefaults();
      console.log("[v5] 完成，退出");
      Script.exit("V5_DONE");
      return;
    }
    if (FileManager.existsSync(v4Flag)) {
      try {
        FileManager.removeSync(v4Flag);
      } catch {}
      await probeAllVersions();
      console.log("[v4] 完成，退出");
      Script.exit("V4_DONE");
      return;
    }
    if (FileManager.existsSync(normFlag)) {
      try {
        FileManager.removeSync(normFlag);
      } catch {}
      await normalizeProviders();
      console.log("[norm] 完成，退出");
      Script.exit("NORM_DONE");
      return;
    }
    if (FileManager.existsSync(keysFlag)) {
      try {
        FileManager.removeSync(keysFlag);
      } catch {}
      await probeKeys();
      console.log("[k] 完成，退出");
      Script.exit("KEYS_DONE");
      return;
    }
    if (FileManager.existsSync(probe3Flag)) {
      try {
        FileManager.removeSync(probe3Flag);
      } catch {}
      await probeAgentConflict();
      console.log("[v3] 完成，退出");
      Script.exit("PROBE3_DONE");
      return;
    }
    if (FileManager.existsSync(probe2Flag)) {
      try {
        FileManager.removeSync(probe2Flag);
      } catch {}
      await probeBothDirs();
      console.log("[v2] 完成，退出");
      Script.exit("PROBE2_DONE");
      return;
    }
    if (FileManager.existsSync(restoreFlag)) {
      try {
        FileManager.removeSync(restoreFlag);
      } catch {}
      await restoreProviders();
      console.log("[恢复] 完成，退出");
      Script.exit("RESTORE_DONE");
      return;
    }
  } catch (err) {
    console.log("[探针] 异常", String(err));
  }

  // 4. 注册唤醒/恢复事件处理器 (Script.onResume)
  try {
    Script.onResume(async (details) => {
      console.log("[寒霜注入工具] 脚本被唤醒/从后台恢复", details);
      // 如果当前界面未打开且用户未请求退出，重新唤起原生界面
      if (!isPresentingView && !isGlobalExitRequested()) {
        await presentMainView();
      }
    });
  } catch (err) {
    console.log("[寒霜注入工具] 注册 Script.onResume 失败", err);
  }

  // 3.6 网关自检异步执行（不阻塞主界面弹出）
  selfTestGateway(actualPort).catch((e) => console.log("[自检] 异常", e));
  checkGatewayProviderRegistered(actualPort).catch((e) => console.log("[检查] 异常", e));

  // 5. 首次展现主界面（秒开）
  await presentMainView();

  console.log("[寒霜注入工具] 前台控制台已关闭/缩入后台，脚本进入常驻运行模式，持续监听网关请求...");

  // 6. 持久后台常驻事件循环：绝对不调用 Script.exit()，除非收到明确退出指令
  while (!isGlobalExitRequested()) {
    await new Promise<void>((resolve) => {
      setTimeout(() => resolve(), 3000);
    });
  }

  // 7. 用户明确要求彻底退出：清理所有资源
  console.log("[寒霜注入工具] 收到明确退出指令，开始释放后台常驻保活与网关服务...");
  try {
    await backgroundManager.stopKeepAlive();
  } catch {}
  selfHealer.stopDaemon();
  stopTrueStreamEngine();
  if (globalServer) {
    try {
      globalServer.stop();
    } catch {}
    globalServer = null;
  }
  console.log("[寒霜注入工具] 资源清理完毕，已安全退出");
  Script.exit();
}

run();
