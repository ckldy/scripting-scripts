import { Script } from "scripting"
import { ZakoServer } from "./src/server"
import { Store } from "./src/store"
import {
  DEFAULT_INSTRUCTION,
  PROFILES,
  findProfile,
  getInstruction,
  matchProfileForModel,
  modelFamily,
  normalizeModelName,
} from "./src/profiles"
import { applyPromptStrategy } from "./src/proxy"
import type { Group } from "./src/types"

declare function fetch(input: any, init?: any): Promise<any>

async function runPromptStrategyE2ETest() {
  console.log("=== 开始 ZakoProxy 预设 Prompt 策略全链路与 E2E 验证 ===")

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
  // 1. 模型家族识别与归一化测试
  // ==========================================
  console.log("\n[1/4] 测试模型名称归一化与家族识别算法...")
  assert(normalizeModelName("openai/gpt-4o") === "gpt-4o", "normalizeModelName 剥离前缀 openai/")
  assert(normalizeModelName("Anthropic/claude-3-5-sonnet") === "claude-3-5-sonnet", "normalizeModelName 剥离前缀并转小写")

  assert(modelFamily("claude-3-5-sonnet-20241022") === "claude", "识别 claude 家族")
  assert(modelFamily("claude-fable-5-1") === "claude", "识别 claude-fable 家族")
  assert(modelFamily("deepseek-chat") === "deepseek", "识别 deepseek 家族")
  assert(modelFamily("hanshuang-codex") === "deepseek", "识别 寒霜/hanshuang 为 deepseek 家族")
  assert(modelFamily("gemini-1.5-pro") === "gemini", "识别 gemini 家族")
  assert(modelFamily("kimi-latest") === "kimi", "识别 kimi 家族")
  assert(modelFamily("moonshot-v1-auto") === "kimi", "识别 moonshot 为 kimi 家族")
  assert(modelFamily("gpt-4o") === "gpt", "识别 gpt-4o 为 gpt 家族")
  assert(modelFamily("gpt-5.6-sol") === "gpt-5.6", "精确识别 gpt-5.6 家族")
  assert(modelFamily("gpt-6-astra") === "gpt-6", "精确识别 gpt-6 家族")

  // ==========================================
  // 2. 预设分层智能匹配算法测试
  // ==========================================
  console.log("\n[2/4] 测试预设分层智能匹配与指令获取 (getInstruction)...")
  const claudeProfile = PROFILES.find((p) => p.model_family === "claude")!
  assert(Boolean(claudeProfile), "PROFILES 中存在 Claude 系列预设")
  assert(
    matchProfileForModel(claudeProfile, "claude-3-5-sonnet-latest"),
    "Claude Profile 智能匹配任意 claude-3-5 模型请求"
  )

  const deepseekProfile = PROFILES.find((p) => p.id === "hanshuang-deepseek-4.1-flash" || p.model_family === "deepseek")!
  assert(Boolean(deepseekProfile), "PROFILES 中存在 DeepSeek 系列预设")
  assert(
    matchProfileForModel(deepseekProfile, "deepseek-reasoner"),
    "DeepSeek Profile 智能匹配 deepseek 变体请求"
  )

  // 测试不同配置下的分组策略获取
  const testGroupDefaultOnly: Group = {
    id: "grp-test-default",
    name: "通用默认组",
    profile_ids: [],
    default_strategy_enabled: true,
  }
  const defaultInst = getInstruction(testGroupDefaultOnly, "unknown-model-xyz")
  assert(defaultInst === DEFAULT_INSTRUCTION, "未绑定 Profile 且开启兜底时，注入 Astra 默认策略")

  const testGroupDefaultDisabled: Group = {
    id: "grp-test-disabled",
    name: "无策略组",
    profile_ids: [],
    default_strategy_enabled: false,
  }
  assert(getInstruction(testGroupDefaultDisabled, "gpt-4o") === null, "关闭兜底且无绑定时，返回 null 不注入")

  // 测试绑定特定 Profile
  const testGroupBoundClaude: Group = {
    id: "grp-test-claude",
    name: "Claude专属组",
    profile_ids: [claudeProfile.id],
    default_strategy_enabled: true,
  }
  const boundClaudeInst = getInstruction(testGroupBoundClaude, "claude-3-5-haiku-20241022")
  assert(
    boundClaudeInst === claudeProfile.instruction,
    "请求 claude 模型成功优先命中绑定的 Claude Profile"
  )
  const fallbackInst = getInstruction(testGroupBoundClaude, "random-llm")
  assert(
    fallbackInst === DEFAULT_INSTRUCTION,
    "请求未命中的模型平滑回退至 Astra 默认兜底策略"
  )

  // 测试自定义指令最高优先级
  const testGroupCustom: Group = {
    id: "grp-test-custom",
    name: "自定义策略组",
    profile_ids: [claudeProfile.id],
    default_strategy_enabled: true,
    custom_instruction: "YOU ARE A HELPFUL ASSISTANT CUSTOM PROMPT",
  }
  const customInst = getInstruction(testGroupCustom, "claude-3-5-sonnet")
  assert(
    customInst === "YOU ARE A HELPFUL ASSISTANT CUSTOM PROMPT",
    "配置 custom_instruction 时，最高优先级覆盖内置 Profile"
  )

  // ==========================================
  // 3. 多协议请求体注入与安全合并测试
  // ==========================================
  console.log("\n[3/4] 测试多协议请求体提示词安全注入 (applyPromptStrategy)...")

  // A. Anthropic 协议
  const anthropicBody1: any = {
    model: "claude-3-5-sonnet",
    messages: [{ role: "user", content: "hello" }],
  }
  applyPromptStrategy("anthropic", anthropicBody1, testGroupBoundClaude, "claude-3-5-sonnet")
  assert(
    anthropicBody1.system === claudeProfile.instruction.trim(),
    "Anthropic 无 system 时自动设置 system 字符串"
  )

  const anthropicBody2: any = {
    model: "claude-3-5-sonnet",
    system: "Original Client System Prompt",
    messages: [{ role: "user", content: "hello" }],
  }
  applyPromptStrategy("anthropic", anthropicBody2, testGroupBoundClaude, "claude-3-5-sonnet")
  assert(
    anthropicBody2.system.startsWith(claudeProfile.instruction.trim()) &&
      anthropicBody2.system.includes("Original Client System Prompt"),
    "Anthropic 已有 string system 时安全前置合并"
  )
  // 测试防重入
  applyPromptStrategy("anthropic", anthropicBody2, testGroupBoundClaude, "claude-3-5-sonnet")
  const occurrences = anthropicBody2.system.split(claudeProfile.instruction.trim()).length - 1
  assert(occurrences === 1, "Anthropic 重复调用不会双重注入")

  const anthropicBody3: any = {
    model: "claude-3-5-sonnet",
    system: [{ type: "text", text: "Client part 1" }],
    messages: [],
  }
  applyPromptStrategy("anthropic", anthropicBody3, testGroupBoundClaude, "claude-3-5-sonnet")
  assert(
    Array.isArray(anthropicBody3.system) &&
      anthropicBody3.system[0].text === claudeProfile.instruction.trim(),
    "Anthropic system 为数组时，首部安全插入 text 块"
  )

  // B. Chat (OpenAI) 协议
  const chatBody1: any = {
    model: "gpt-4o",
    messages: [{ role: "user", content: "hi" }],
  }
  applyPromptStrategy("chat", chatBody1, testGroupDefaultOnly, "gpt-4o")
  assert(
    chatBody1.messages.length === 2 &&
      chatBody1.messages[0].role === "system" &&
      chatBody1.messages[0].content === DEFAULT_INSTRUCTION.trim(),
    "Chat 协议无 system 时 unshift 注入系统消息"
  )

  const chatBody2: any = {
    model: "gpt-4o",
    messages: [
      { role: "system", content: "User System Instruction" },
      { role: "user", content: "hi" },
    ],
  }
  applyPromptStrategy("chat", chatBody2, testGroupDefaultOnly, "gpt-4o")
  assert(
    chatBody2.messages.length === 2 &&
      chatBody2.messages[0].role === "system" &&
      chatBody2.messages[0].content.startsWith(DEFAULT_INSTRUCTION.trim()) &&
      chatBody2.messages[0].content.includes("User System Instruction"),
    "Chat 协议已有 system 消息时在首条内容安全前置合并"
  )

  // C. Responses / Compact 协议
  const respBody1: any = {
    model: "gpt-4o",
    instructions: "Base instruction",
  }
  applyPromptStrategy("responses", respBody1, testGroupDefaultOnly, "gpt-4o")
  assert(
    respBody1.instructions.startsWith(DEFAULT_INSTRUCTION.trim()) &&
      respBody1.instructions.includes("Base instruction"),
    "Responses 协议 instructions 字段安全前置合并"
  )

  // ==========================================
  // 4. RESTful API 与 Web 控制台端到端测试
  // ==========================================
  console.log("\n[4/4] 启动独立服务测试 Group & Profile REST API...")

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
    // 1. GET /api/profiles
    const rProfiles = await fetch(`${baseUrl}/api/profiles`)
    assert(rProfiles.status === 200, "GET /api/profiles 返回 200 OK")
    const profilesList = await rProfiles.json()
    assert(Array.isArray(profilesList) && profilesList.length >= 36, "返回 36+ 款内置 Prompt Profile 摘要")

    // 2. GET /api/profiles/:id
    const sampleProfileId = profilesList[0].id
    const rProfileDetail = await fetch(`${baseUrl}/api/profiles/${sampleProfileId}`)
    assert(rProfileDetail.status === 200, `GET /api/profiles/${sampleProfileId} 返回 200 OK`)
    const profileDetail = await rProfileDetail.json()
    assert(
      profileDetail.id === sampleProfileId && profileDetail.instruction && profileDetail.instruction.length > 50,
      "成功获取完整 Profile 提示词正文与模型匹配列表"
    )

    // 3. GET /api/groups
    const rGroups = await fetch(`${baseUrl}/api/groups`)
    assert(rGroups.status === 200, "GET /api/groups 返回 200 OK")
    const groupsList = await rGroups.json()
    assert(Array.isArray(groupsList), "返回已有分组数组")

    // 4. POST /api/groups 创建带策略分组
    const newGroupPayload = {
      name: "自动化测试策略组",
      default_strategy_enabled: true,
      custom_instruction: "自动化测试自定义系统提示词",
      profile_ids: [sampleProfileId],
    }
    const rPostGroup = await fetch(`${baseUrl}/api/groups`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newGroupPayload),
    })
    assert(rPostGroup.status === 200, "POST /api/groups 创建新分组成功")
    const createdGroupRes = await rPostGroup.json()
    assert(createdGroupRes.success && createdGroupRes.group?.id, "返回新建分组实体")
    const createdGroupId = createdGroupRes.group.id
    assert(
      createdGroupRes.group.custom_instruction === newGroupPayload.custom_instruction,
      "新建分组正确保存 custom_instruction"
    )
    assert(
      createdGroupRes.group.profile_ids.includes(sampleProfileId),
      "新建分组正确绑定 profile_ids"
    )

    // 5. PUT /api/groups/:id 更新策略
    const updateGroupPayload = {
      name: "更新后的策略组",
      default_strategy_enabled: false,
      custom_instruction: "已修改的自定义提示词内容",
      profile_ids: [],
    }
    const rPutGroup = await fetch(`${baseUrl}/api/groups/${createdGroupId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updateGroupPayload),
    })
    assert(rPutGroup.status === 200, "PUT /api/groups/:id 更新分组成功")
    const updatedGroupRes = await rPutGroup.json()
    assert(
      updatedGroupRes.group.name === "更新后的策略组" &&
        updatedGroupRes.group.default_strategy_enabled === false &&
        updatedGroupRes.group.custom_instruction === "已修改的自定义提示词内容" &&
        updatedGroupRes.group.profile_ids.length === 0,
      "分组属性与策略字段均成功热更新"
    )

    // 6. DELETE /api/groups/:id 清理测试数据
    const rDelGroup = await fetch(`${baseUrl}/api/groups/${createdGroupId}`, {
      method: "DELETE",
    })
    assert(rDelGroup.status === 200, "DELETE /api/groups/:id 删除测试分组成功")

    // 7. 验证 Web 控制台 HTML 模板中的新增交互元素
    const rHtml = await fetch(`${baseUrl}/ui/`)
    const html = await rHtml.text()
    assert(html.includes("id=\"modal-group\""), "WebUI 包含编辑分组模态框 modal-group")
    assert(html.includes("id=\"btn-add-group\""), "WebUI 包含新建分组按钮 btn-add-group")
    assert(html.includes("id=\"group-custom-instruction\""), "WebUI 包含自定义策略输入框 group-custom-instruction")
    assert(html.includes("id=\"group-profiles-selector\""), "WebUI 包含 36 款 Profile 复选网格 group-profiles-selector")
  } finally {
    server.stop()
    console.log("🛑 测试服务已停止并释放资源")
  }

  console.log("\n==========================================")
  if (allPassed) {
    console.log("🎉 全部 Prompt 策略全链路测试验证通过！(100% Passed)")
  } else {
    console.error("❌ 存在未通过的测试项，请检查上述错误日志。")
  }
  console.log("==========================================")

  return allPassed
}

runPromptStrategyE2ETest().then((ok) => {
  Script.exit(ok ? 0 : 1)
})
