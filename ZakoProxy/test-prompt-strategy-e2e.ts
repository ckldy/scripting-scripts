import { Script } from "scripting"
import { ZakoServer, APP_VERSION } from "./src/server"
import { Store } from "./src/store"
import {
  DEFAULT_INSTRUCTION,
  PROFILES,
  findProfile,
  getInstruction,
  matchInstruction,
  matchProfileForModel,
  modelFamily,
  normalizeModelName,
  extractBaseModelCandidates,
  extractModelCore,
  isSameModelCore,
  scoreProfileMatch,
  stripChannelPrefix,
} from "./src/profiles"
import { applyPromptStrategy, errorSummary, hasStrategyBlock, redactSecrets } from "./src/proxy"
import type { Group } from "./src/types"

declare function fetch(input: any, init?: any): Promise<any>

async function runPromptStrategyE2ETest() {
  console.log("=== 开始 ZakoProxy 预设 Prompt 策略全链路与 E2E 验证 (v1.4.3) ===")

  let allPassed = true
  const assert = (condition: boolean, msg: string) => {
    if (condition) {
      console.log(`  ✓ ${msg}`)
    } else {
      console.error(`  ✗ ${msg}`)
      allPassed = false
    }
  }

  // ==========================================
  // 1. 模型通道修饰后缀解构与 Base Model 提取测试
  // ==========================================
  console.log("\n[1/5] 测试通道修饰后缀解构与 Base Model 提取算法...")
  assert(normalizeModelName("openai/gpt-4o") === "gpt-4o", "normalizeModelName 剥离前缀 openai/")
  assert(normalizeModelName("Anthropic/claude-3-5-sonnet") === "claude-3-5-sonnet", "normalizeModelName 剥离前缀并转小写")

  const geminiCandidates = extractBaseModelCandidates("openai/gemini-3.8-flash-high")
  assert(geminiCandidates.includes("gemini-3.8-flash-high"), "候选列表包含原始规范名 gemini-3.8-flash-high")
  assert(geminiCandidates.includes("gemini-3.8-flash"), "候选列表成功解构并提取出 base model gemini-3.8-flash")

  const claudeCandidates = extractBaseModelCandidates("claude-3-5-sonnet-20241022")
  assert(claudeCandidates.includes("claude-3-5-sonnet"), "候选列表成功剥离日期版本后缀 20241022 提取 claude-3-5-sonnet")

  const tieredCandidates = extractBaseModelCandidates("gemini-3.7-flash-tiered")
  assert(tieredCandidates.includes("gemini-3.7-flash"), "候选列表成功剥离 -tiered 后缀")

  // 渠道前缀无关化（v1.4.2）：运营渠道名不属于模型身份，不得干扰匹配
  assert(
    stripChannelPrefix("workbuddy-deepseek-v4.1-flash") === "deepseek-v4.1-flash",
    "stripChannelPrefix 剥离 workbuddy- 渠道前缀"
  )
  assert(
    normalizeModelName("workbuddy/gemini-3.8-flash-high") === "gemini-3.8-flash-high",
    "workbuddy/ 路径式渠道前缀也被剥离"
  )
  assert(normalizeModelName("coldcoffee-claude-opus-4-6") === "claude-opus-4-6", "coldcoffee- 渠道前缀被剥离")
  assert(normalizeModelName("kimi-break-kimi-k3") === "kimi-k3", "kimi-break- 渠道前缀被剥离但保留 kimi-k3")
  assert(normalizeModelName("WORKBUDDY-Claude-Opus-4-6") === "claude-opus-4-6", "渠道前缀大写也能识别")
  assert(
    normalizeModelName("workbuddy-coldcoffee-gemini-3.8-flash") === "gemini-3.8-flash",
    "多级渠道前缀可递进剥离"
  )
  assert(normalizeModelName("deepseek-v4.1-flash") === "deepseek-v4.1-flash", "真实模型族名不被误当渠道前缀剥掉")
  assert(normalizeModelName("hanshuang-deepseek-flash") === "deepseek-flash", "hanshuang- 剥离后 deepseek 仍保留")
  assert(normalizeModelName("gemini-3-flash") === "gemini-3-flash", "无前缀模型名保持不变")
  assert(modelFamily("workbuddy-deepseek-v4.1-flash") === "deepseek", "渠道前缀不影响家族识别")

  // 核心版本容错：v4 不得被当成 v4.1 的前缀
  assert(!isSameModelCore(extractModelCore("deepseek-v4-flash"), extractModelCore("deepseek-v4.1-flash")), "v4-flash 与 v4.1-flash 不会被混淆")
  assert(isSameModelCore(extractModelCore("deepseek-v4.1-flash"), extractModelCore("workbuddy-deepseek-v4.1-flash")), "渠道前缀不影响核心版本相等判定")
  assert(!isSameModelCore(extractModelCore("claude-opus-4-6"), extractModelCore("claude-opus-4-7")), "opus-4-6 与 opus-4-7 严格区分")

  // 模型核心版本提取
  assert(extractModelCore("gemini-3.8-flash-high") === "3.8-flash", "extractModelCore 正确提取 gemini-3.8-flash-high 核心为 3.8-flash")
  assert(extractModelCore("gemini-3-flash") === "3-flash", "extractModelCore 正确提取 gemini-3-flash 核心为 3-flash")
  assert(extractModelCore("claude-opus-4-6-thinking") === "opus-4-6", "extractModelCore 正确提取 claude-opus-4-6-thinking 核心为 opus-4-6")
  assert(extractModelCore("claude-sonnet-4-6") === "sonnet-4-6", "extractModelCore 正确提取 claude-sonnet-4-6 核心为 sonnet-4-6")

  // 响应体完整性：长回复必须完整转发（曾误用 2KB 错误摘要导致流式回复被截断）
  const longBody = "数".repeat(5000)
  assert(redactSecrets(longBody, []).length === 5000, "redactSecrets 不截断正常响应体")
  assert(!redactSecrets(longBody, []).includes("…"), "正常响应体不会出现截断省略号")
  assert(
    redactSecrets(`${longBody} sk-secret-123`, ["sk-secret-123"]).includes("[redacted]"),
    "redactSecrets 仍会替换密钥"
  )
  assert(errorSummary(longBody, []).length === 2048, "errorSummary 仅用于日志并保留 2KB 截断")

  // ==========================================
  // 2. 多维打分系统与同家族防劫持测试
  // ==========================================
  console.log("\n[2/5] 测试多维打分引擎与同家族防劫持消除...")
  const gemini38Profile = findProfile("coldcoffee-gemini-3.8-flash-v1")!
  const gemini3FlashProfile = findProfile("coldcoffee-gemini-3-flash-v1")!
  assert(Boolean(gemini38Profile), "找到冷咖啡 gemini-3.8-flash Profile")
  assert(Boolean(gemini3FlashProfile), "找到冷咖啡 gemini-3-flash Profile")

  // 测试打分：gemini-3.8-flash-high 应该给 gemini-3.8-flash 高分(>=800)，但对 gemini-3-flash 打分必须低
  const score38 = scoreProfileMatch(gemini38Profile, extractBaseModelCandidates("gemini-3.8-flash-high"))
  const score3 = scoreProfileMatch(gemini3FlashProfile, extractBaseModelCandidates("gemini-3.8-flash-high"))
  assert(score38.score >= 800, `gemini-3.8-flash Profile 获得基础模型高分匹配: ${score38.score}`)
  assert(score38.score > score3.score, `gemini-3.8-flash 匹配得分 (${score38.score}) 严格高于 gemini-3-flash (${score3.score})，彻底杜绝混淆`)

  // 测试同家族不同款：绑定 gemini-3.8-flash 时，请求 gemini-3-flash 不得被劫持！
  const testGroupGemini38Only: Group = {
    id: "grp-gemini38",
    name: "Gemini 3.8 组",
    profile_ids: [gemini38Profile.id],
    default_strategy_enabled: true,
  }
  const match38 = matchInstruction(testGroupGemini38Only, "gemini-3.8-flash-high")
  assert(match38.strategy_type === "profile" && match38.profile_id === gemini38Profile.id, "gemini-3.8-flash-high 精确命中 gemini-3.8-flash 预设")
  assert(match38.matched_model === "gemini-3.8-flash", "元数据指出匹配特征模型为 gemini-3.8-flash")

  // 请求 gemini-3-flash-low：因为只绑定了 3.8，核心版本不同，不可被 3.8 劫持！应当平滑回退到 Astra 通用兜底
  const match3With38Group = matchInstruction(testGroupGemini38Only, "gemini-3-flash-low")
  assert(
    match3With38Group.strategy_type === "default",
    "未绑定 gemini-3-flash 时，请求 gemini-3-flash 不会被 3.8 预设劫持，安全回退到 Astra 兜底"
  )

  // ==========================================
  // 2.5 渠道前缀无关的端到端策略命中矩阵
  // ==========================================
  console.log("\n[2.5/5] 测试渠道前缀无关的策略命中矩阵...")
  const prefixGroup: Group = {
    id: "grp-prefix",
    name: "渠道前缀无关组",
    profile_ids: [
      "coldcoffee-gemini-3.8-flash-v1",
      "coldcoffee-gemini-3-flash-v1",
      "coldcoffee-deepseek-v4.1-flash-v1",
      "coldcoffee-deepseek-v4-flash-v1",
      "coldcoffee-claude-opus-4-6-v1",
      "coldcoffee-claude-sonnet-4-6-v1",
      "kimi-break-kimi-k3-v1",
      "coldcoffee-glm-5.3-v1",
    ],
    default_strategy_enabled: true,
  }
  const prefixCases: [string, string][] = [
    ["workbuddy-deepseek-v4.1-flash", "coldcoffee-deepseek-v4.1-flash-v1"],
    ["workbuddy-deepseek-v4-flash", "coldcoffee-deepseek-v4-flash-v1"],
    ["workbuddy/gemini-3.8-flash-high", "coldcoffee-gemini-3.8-flash-v1"],
    ["workbuddy/gemini-3-flash", "coldcoffee-gemini-3-flash-v1"],
    ["workbuddy-claude-opus-4-6", "coldcoffee-claude-opus-4-6-v1"],
    ["claude-opus-4-6-thinking", "coldcoffee-claude-opus-4-6-v1"],
    ["claude-sonnet-4-6", "coldcoffee-claude-sonnet-4-6-v1"],
    ["kimi-break-kimi-k3", "kimi-break-kimi-k3-v1"],
    ["workbuddy-glm-5.3", "coldcoffee-glm-5.3-v1"],
  ]
  for (const [model, expectId] of prefixCases) {
    const m = matchInstruction(prefixGroup, model, model)
    assert(
      m.profile_id === expectId && m.strategy_type === "profile",
      `${model} 命中 ${m.profile_id || m.strategy_type}（期望 ${expectId}）`
    )
  }
  // 未绑定的模型不得被任何同族预设劫持
  const unbound = matchInstruction({ ...prefixGroup, profile_ids: ["coldcoffee-gemini-3.8-flash-v1"] }, "workbuddy-deepseek-v4.1-flash")
  assert(unbound.strategy_type === "default", "未绑定 deepseek 时回退 Astra 兜底，不劫持")
  // 同族不同版本不得互相错配
  const misVersion = matchInstruction({ ...prefixGroup, profile_ids: ["coldcoffee-deepseek-v4-flash-v1"] }, "workbuddy-deepseek-v4.1-flash")
  assert(misVersion.profile_id !== "coldcoffee-deepseek-v4-flash-v1", "未绑定 v4.1 时不会被 v4 预设错配")

  // ==========================================
  // 3. 多协议请求体安全注入与防重入测试
  // ==========================================  console.log("\n[3/5] 测试多协议请求体提示词安全注入与审计元数据...")
  const claudeProfile = findProfile("coldcoffee-claude-sonnet-4-6-v1") || PROFILES.find((p) => p.model_family === "claude")!
  const targetClaudeModel = claudeProfile.models[0]
  const testGroupClaude: Group = {
    id: "grp-claude",
    name: "Claude 组",
    profile_ids: [claudeProfile.id],
    default_strategy_enabled: true,
  }

  // Anthropic 协议
  const anthropicBody: any = {
    model: targetClaudeModel,
    messages: [{ role: "user", content: "hello" }],
  }
  const anthropicRes = applyPromptStrategy("anthropic", anthropicBody, testGroupClaude, targetClaudeModel)
  assert(anthropicRes.strategy_type === "profile", "Anthropic 注入返回 strategy_type 为 profile")
  assert(anthropicBody.system.includes(claudeProfile.instruction.trim()), "Anthropic system 正确注入 Claude 提示词")

  // OpenAI Chat 协议：双通道注入（v1.4.3）
  //  - system：尊重 system 的上游拿最高优先级
  //  - user：丢弃 system 的适配层仍能收到
  const chatBody: any = {
    model: "gemini-3.8-flash-high",
    messages: [
      { role: "system", content: "You are a coding assistant." },
      { role: "user", content: "hello" },
    ],
  }
  const chatRes = applyPromptStrategy("chat", chatBody, testGroupGemini38Only, "gemini-3.8-flash-high")
  assert(chatRes.strategy_type === "profile", "Chat 注入返回 strategy_type 为 profile")
  const lastUser = chatBody.messages[chatBody.messages.length - 1]
  assert(
    lastUser.role === "user" && typeof lastUser.content === "string" && lastUser.content.includes(gemini38Profile.instruction.trim()),
    "Chat 协议将预设注入到最后一条 user 消息内容中"
  )
  assert(
    chatBody.messages[0].role === "system" &&
      String(chatBody.messages[0].content).startsWith("You are a coding assistant.") &&
      String(chatBody.messages[0].content).includes(gemini38Profile.instruction.trim()),
    "Chat 协议同时在 system 消息末尾追加预设（客户端原文保留在前）"
  )
  assert(
    Array.isArray(chatRes.injected_to) &&
      chatRes.injected_to.includes("system") &&
      chatRes.injected_to.includes("user"),
    "Chat 协议上报双通道注入（system + user）"
  )

  // 幂等性：重复注入不叠加（两条通道都不变）
  applyPromptStrategy("chat", chatBody, testGroupGemini38Only, "gemini-3.8-flash-high")
  const occ = (String(chatBody.messages[chatBody.messages.length - 1].content).match(/【ZakoProxy 预设策略 · 已生效/g) || []).length
  const sysOcc = (String(chatBody.messages[0].content).match(/【ZakoProxy 预设策略 · 已生效/g) || []).length
  assert(occ === 1, "Chat 协议重复注入具备幂等性（user 通道仅注入一次）")
  assert(sysOcc === 1, "Chat 协议重复注入具备幂等性（system 通道仅注入一次）")

  // 无 system 消息时：新建一条置顶 system + 注入末条 user
  const chatNoSystem: any = {
    model: "gemini-3.8-flash-high",
    messages: [{ role: "user", content: "hi" }],
  }
  const noSysRes = applyPromptStrategy("chat", chatNoSystem, testGroupGemini38Only, "gemini-3.8-flash-high")
  assert(
    chatNoSystem.messages.length === 2 &&
      chatNoSystem.messages[0].role === "system" &&
      hasStrategyBlock(chatNoSystem.messages[0].content),
    "Chat 协议无 system 时新建置顶 system 策略消息"
  )
  assert(
    noSysRes.injected_to!.length === 2 &&
      hasStrategyBlock(chatNoSystem.messages[1].content),
    "Chat 协议无 system 时仍保留 user 通道注入"
  )

  // 内容块数组形式：两条通道都要能正确追加/前置，且幂等
  const blockBody: any = {
    model: "gemini-3.8-flash-high",
    messages: [
      { role: "system", content: [{ type: "text", text: "sys base" }] },
      { role: "user", content: [{ type: "text", text: "question" }] },
    ],
  }
  applyPromptStrategy("chat", blockBody, testGroupGemini38Only, "gemini-3.8-flash-high")
  applyPromptStrategy("chat", blockBody, testGroupGemini38Only, "gemini-3.8-flash-high")
  assert(
    blockBody.messages[0].content.length === 2 &&
      blockBody.messages[0].content[0].text === "sys base",
    "Chat 内容块 system：策略块追加在末尾且不重复"
  )
  assert(
    blockBody.messages[1].content.length === 2 &&
      blockBody.messages[1].content[1].text === "question",
    "Chat 内容块 user：策略块前置且不重复"
  )

  // ==========================================
  // 4. RESTful API、审计日志与 Web 控制台测试
  // ==========================================
  console.log("\n[4/5] 启动独立服务测试 Group、Profile、审计日志与 WebUI...")

  const dataDir = `${Script.directory}/data`
  const store = new Store(dataDir)
  await store.init()

  const server = new ZakoServer(store)
  const testPort = 1999
  const startRes = server.start(testPort)

  if (!startRes.success) {
    console.error("❌ 服务启动失败:", startRes.error)
    return false
  }

  const port = startRes.port || testPort
  const baseUrl = `http://127.0.0.1:${port}`

  try {
    // 1. GET /api/system 版本自省
    const rSys = await fetch(`${baseUrl}/api/system`)
    assert(rSys.status === 200, "GET /api/system 返回 200 OK")
    const sysData = await rSys.json()
    assert(sysData.version === APP_VERSION, `系统自省版本号严格匹配常量 ${APP_VERSION}`)
    assert(sysData.running === true, "系统自省 running 为 true")

    // 2. GET /health
    const rHealth = await fetch(`${baseUrl}/health`)
    assert(rHealth.status === 200, "GET /health 返回 200 OK")
    const healthData = await rHealth.json()
    assert(healthData.version === APP_VERSION, `健康检查返回最新版本号 ${APP_VERSION}`)

    // 3. GET /api/profiles
    const rProfiles = await fetch(`${baseUrl}/api/profiles`)
    assert(rProfiles.status === 200, "GET /api/profiles 返回 200 OK")
    const profilesList = await rProfiles.json()
    assert(Array.isArray(profilesList) && profilesList.length >= 36, "返回 36+ 款内置 Prompt Profile 摘要")

    // 4. GET /api/profiles/:id
    const sampleProfileId = profilesList[0].id
    const rProfileDetail = await fetch(`${baseUrl}/api/profiles/${sampleProfileId}`)
    assert(rProfileDetail.status === 200, `GET /api/profiles/${sampleProfileId} 返回 200 OK`)
    const profileDetail = await rProfileDetail.json()
    assert(
      profileDetail.id === sampleProfileId && profileDetail.instruction && profileDetail.instruction.length > 50,
      "成功获取完整 Profile 提示词正文与模型匹配列表"
    )

    // 4.1 CORS 预检必须暴露 X-Zako-* 诊断头（否则浏览器端读不到策略命中信息）
    const rPreflight = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:5173",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type,authorization",
      },
    })
    const preflightExpose = String(rPreflight.headers.get("access-control-expose-headers") || "")
    assert(
      preflightExpose.includes("X-Zako-Strategy") && preflightExpose.includes("X-Zako-Injected"),
      "预检响应显式 Expose X-Zako-Strategy / X-Zako-Injected"
    )
    assert(
      String(rPreflight.headers.get("access-control-allow-headers") || "").toLowerCase().includes("anthropic-version"),
      "预检允许 Anthropic 原生头部（anthropic-version / anthropic-beta）"
    )
    const rApiPreflight = await fetch(`${baseUrl}/api/system`, { method: "OPTIONS" })
    assert(
      !String(rApiPreflight.headers.get("access-control-allow-origin") || "").includes("*"),
      "管理 API 预检不向第三方网页开放跨域"
    )

    // 5. POST /api/groups 创建带策略分组
    const newGroupPayload = {
      name: "自动化测试策略组-v130",
      default_strategy_enabled: true,
      custom_instruction: "自动化测试自定义系统提示词-130",
      profile_ids: [gemini38Profile.id],
    }
    const rPostGroup = await fetch(`${baseUrl}/api/groups`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newGroupPayload),
    })
    assert(rPostGroup.status === 200, "POST /api/groups 创建新分组成功")
    const createdGroupRes = await rPostGroup.json()
    const createdGroupId = createdGroupRes.group.id

    // 6. 验证 Web 控制台 HTML 模板中的热重启和策略审计展示元素
    const rHtml = await fetch(`${baseUrl}/ui/`)
    const html = await rHtml.text()
    assert(html.includes("btn-restart-server-sidebar"), "WebUI 侧边栏包含热重启服务按钮")
    assert(html.includes("btn-restart-server-settings"), "WebUI 设置页包含热重启服务按钮")
    assert(html.includes("Prompt 策略"), "WebUI 审计日志表格新增 Prompt 策略表头列")
    assert(html.includes("log-detail-strategy"), "WebUI 审计日志详情模态框包含策略注入审计区")

    // 清理创建的测试分组
    await fetch(`${baseUrl}/api/groups/${createdGroupId}`, { method: "DELETE" })

    // ==========================================
    // 5. 服务热重启机制验证 (POST /api/system/restart)
    // ==========================================
    console.log("\n[5/5] 测试服务热重启接口 (POST /api/system/restart)...")
    const rRestart = await fetch(`${baseUrl}/api/system/restart`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ port }),
    })
    assert(rRestart.status === 200, "POST /api/system/restart 返回 200 OK")
    const restartData = await rRestart.json()
    assert(restartData.success === true, "热重启接口返回 success: true")
    assert(restartData.target_port === port, `热重启目标端口保持一致 :${port}`)
    assert(restartData.version === APP_VERSION, `热重启响应携带版本号 ${APP_VERSION}`)

    // 轮询等待重启完成
    let restartSuccess = false
    for (let attempt = 0; attempt < 10; attempt++) {
      await new Promise<void>((resolve) => setTimeout(() => resolve(), 150))
      try {
        const rSysAfterRestart = await fetch(`${baseUrl}/api/system`)
        if (rSysAfterRestart.status === 200) {
          const sysDataAfter = await rSysAfterRestart.json()
          if (sysDataAfter.running === true) {
            restartSuccess = true
            break
          }
        }
      } catch {}
    }
    assert(restartSuccess, "热重启后服务正常恢复就绪并响应 (200 OK)")

  } finally {
    server.stop()
    console.log("🛑 测试服务已停止并释放测试端口")
  }

  console.log("\n==========================================")
  if (allPassed) {
    console.log("🎉 全部 ZakoProxy 核心加固与 E2E 测试 100% 通过！")
  } else {
    console.error("❌ 存在未通过的测试项，请检查上述错误日志。")
  }
  console.log("==========================================")

  Script.exit(allPassed)
}

runPromptStrategyE2ETest().catch((e) => {
  console.error("测试运行异常:", e)
  Script.exit(false)
})
