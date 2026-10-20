declare const fetch: any
declare const Response: any
declare const AbortController: any

import type { Account, ApiKey, Config, Group, RequestLog, StrategyMatchResult, Usage } from "./types"
import { Store, digest, id, now, parseUsage } from "./store"
import { getInstruction, matchInstruction } from "./profiles"
import { APP_VERSION } from "./version"

const MAX_ERROR_BYTES = 2048

export function routeFor(protocol: string): string {
  switch (protocol) {
    case "compact":
      return "responses/compact"
    case "anthropic":
      return "messages"
    case "chat":
      return "chat/completions"
    default:
      return "responses"
  }
}

export function upstreamUrl(endpoint: string, route: string): string {
  let ep = endpoint.trim().replace(/\/+$/, "")
  if (!ep.startsWith("http://") && !ep.startsWith("https://")) {
    throw new Error("Endpoint must be an HTTP(S) URL")
  }
  const root = ep.endsWith("/v1") ? ep : `${ep}/v1`
  const cleanRoute = route.replace(/^\/+/, "").replace(/^v1\//, "")
  return `${root}/${cleanRoute}`
}

export function errorSummary(message: string, secrets: string[]): string {
  let msg = message
  for (const s of secrets) {
    if (s && s.length > 0) {
      msg = msg.split(s).join("[redacted]")
    }
  }
  if (msg.length > MAX_ERROR_BYTES) {
    msg = msg.slice(0, MAX_ERROR_BYTES - 1) + "…"
  }
  return msg
}

export async function authorizeKey(
  store: Store,
  headers: Record<string, string>
): Promise<{ config: Config; key: ApiKey; group: Group }> {
  let tokenStr = ""
  const authHeader = headers["authorization"] || headers["Authorization"] || ""
  if (authHeader) {
    const parts = authHeader.split(" ")
    if (parts.length === 2 && parts[0].toLowerCase() === "bearer") {
      tokenStr = parts[1].trim()
    }
  }
  if (!tokenStr) {
    tokenStr = (headers["x-api-key"] || headers["X-API-Key"] || "").trim()
  }

  if (!tokenStr) {
    throw { status: 401, message: "A valid proxy API key is required" }
  }

  const config = await store.getConfig()
  const hash = await digest(tokenStr)
  const key = config.keys.find((k) => k.enabled && k.hash === hash)
  if (!key) {
    throw { status: 401, message: "A valid proxy API key is required" }
  }

  const group = config.groups.find((g) => g.id === key.group_id)
  if (!group) {
    throw { status: 503, message: "The API key has no available group" }
  }

  return { config, key, group }
}

export function getAvailableModels(config: Config, group: Group): string[] {
  const modelSet = new Set<string>()
  for (const account of config.accounts) {
    if (!account.enabled || !account.group_ids.includes(group.id)) continue
    for (const model of account.models) {
      modelSet.add(model)
    }
    for (const [requested, actual] of Object.entries(account.model_mappings || {})) {
      if (account.models.includes(actual)) {
        modelSet.add(requested)
      }
    }
  }
  return Array.from(modelSet).sort()
}

export function resolveActualModel(account: Account, requested: string): string | null {
  const actual = account.model_mappings?.[requested] || requested
  if (account.models.includes(actual)) {
    return actual
  }
  return null
}

export function applyPromptStrategy(
  protocol: string,
  body: any,
  group: Group,
  actualModel: string,
  requestedModel?: string
): StrategyMatchResult {
  const match = matchInstruction(group, actualModel, requestedModel)
  const instruction = match.instruction
  if (!instruction || !instruction.trim()) {
    return match
  }

  const cleanInstruction = instruction.trim()
  const STRATEGY_MARKER = "【ZakoProxy 预设策略 · 已生效 · 最高优先级】"
  const strategyBlock = `${STRATEGY_MARKER}\n${cleanInstruction}\n【ZakoProxy 预设策略 · 结束】`
  const hasBlock = (t: any): boolean => typeof t === "string" && t.includes(STRATEGY_MARKER)

  if (protocol === "anthropic") {
    // Anthropic 原生 system 字段最权威，追加注入并保持幂等
    if (!body.system || (typeof body.system === "string" && body.system.trim() === "")) {
      body.system = strategyBlock
    } else if (typeof body.system === "string") {
      if (!hasBlock(body.system)) body.system = `${body.system}\n\n${strategyBlock}`
    } else if (Array.isArray(body.system)) {
      const alreadyHas = body.system.some(
        (part: any) => typeof part === "object" && part?.text && hasBlock(part.text)
      )
      if (!alreadyHas) body.system = [...body.system, { type: "text", text: strategyBlock }]
    }
  } else if (protocol === "chat") {
    if (!Array.isArray(body.messages)) body.messages = []
    // 关键修复：把预设注入到最后一条 user 消息。
    // 许多上游适配层（尤其 Gemini 逆向类）会丢弃 system 角色，但 user 内容必定转发；
    // 放在当前用户轮次也拥有最高 recency，确保预设真正送达并被采纳。
    let targetIdx = -1
    for (let i = body.messages.length - 1; i >= 0; i--) {
      if (body.messages[i] && body.messages[i].role === "user") {
        targetIdx = i
        break
      }
    }
    if (targetIdx >= 0) {
      const msg = body.messages[targetIdx]
      if (typeof msg.content === "string") {
        if (!hasBlock(msg.content)) msg.content = `${strategyBlock}\n\n${msg.content}`
      } else if (Array.isArray(msg.content)) {
        const alreadyHas = msg.content.some(
          (part: any) => typeof part === "object" && part?.text && hasBlock(part.text)
        )
        if (!alreadyHas) msg.content = [{ type: "text", text: strategyBlock }, ...msg.content]
      } else {
        msg.content = strategyBlock
      }
    } else {
      // 没有 user 消息时退回 system / 首条消息
      const firstMsg = body.messages[0]
      if (firstMsg && (firstMsg.role === "system" || firstMsg.role === "developer")) {
        if (typeof firstMsg.content === "string") {
          if (!hasBlock(firstMsg.content)) firstMsg.content = `${firstMsg.content}\n\n${strategyBlock}`
        } else if (Array.isArray(firstMsg.content)) {
          const alreadyHas = firstMsg.content.some(
            (part: any) => typeof part === "object" && part?.text && hasBlock(part.text)
          )
          if (!alreadyHas) firstMsg.content = [...firstMsg.content, { type: "text", text: strategyBlock }]
        } else {
          firstMsg.content = strategyBlock
        }
      } else {
        body.messages.unshift({ role: "system", content: strategyBlock })
      }
    }
  } else {
    // responses / compact：注入到 instructions / instruction 字段
    const field =
      body.instructions !== undefined ? "instructions" : body.instruction !== undefined ? "instruction" : "instructions"
    const cur = body[field]
    if (typeof cur === "string" && cur.trim()) {
      if (!hasBlock(cur)) body[field] = `${cur}\n\n${strategyBlock}`
    } else {
      body[field] = strategyBlock
    }
  }

  return match
}

export interface ForwardResult {
  status: number
  headers: Record<string, string>
  body: string
}

export class ProxyEngine {
  constructor(private store: Store) {}

  async handleModels(headers: Record<string, string>): Promise<ForwardResult> {
    const { config, group } = await authorizeKey(this.store, headers)
    const models = getAvailableModels(config, group)
    const data = models.map((m) => ({
      id: m,
      object: "model",
      owned_by: "upstream",
    }))
    return {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ object: "list", data }),
    }
  }

  async forward(
    protocol: string,
    headers: Record<string, string>,
    body: any
  ): Promise<ForwardResult> {
    const { config, key, group } = await authorizeKey(this.store, headers)

    const requestedModel = typeof body?.model === "string" ? body.model.trim() : ""
    if (!body || typeof body !== "object" || !requestedModel) {
      throw { status: 400, message: "A JSON object with a nonempty model is required" }
    }

    const secretsToRedact: string[] = []
    const authHeader = headers["authorization"] || headers["Authorization"] || ""
    if (authHeader) secretsToRedact.push(authHeader.replace(/^Bearer\s+/i, ""))
    const xApiKey = headers["x-api-key"] || headers["X-API-Key"] || ""
    if (xApiKey) secretsToRedact.push(xApiKey)

    // 筛选符合条件的账号
    const eligibleAccounts = config.accounts
      .filter((acc) => {
        return (
          acc.enabled &&
          acc.group_ids.includes(group.id) &&
          acc.protocols.includes(protocol) &&
          resolveActualModel(acc, requestedModel) !== null
        )
      })
      .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))

    if (eligibleAccounts.length === 0) {
      const logEntry: RequestLog = {
        id: id(),
        timestamp: now(),
        key_id: key.id,
        account_id: "",
        model: requestedModel,
        protocol,
        status: 503,
        latency_ms: 0,
        usage: {
          input_tokens: 0,
          output_tokens: 0,
          cached_tokens: 0,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
        cyber: false,
        attempts: 0,
        request_path: `/v1/${routeFor(protocol)}`,
        error: "No account supports this group, model, and protocol",
        strategy_type: "none",
      }
      await this.store.log(logEntry, config.settings.retention_days)
      throw { status: 503, message: "No account supports this group, model, and protocol" }
    }

    const maxRetries = config.settings.max_retries ?? 2
    const totalAttempts = maxRetries + 1
    const triedAccounts = new Set<string>()

    const startTime = Date.now()
    let lastError: any = null
    let attemptsCount = 0

    for (let i = 0; i < totalAttempts; i++) {
      // 选择下一个未尝试账号并校验准入
      let selectedAccount: Account | null = null
      let admissionFailureReason: string | undefined
      let retryAfterSeconds: number | undefined

      for (const acc of eligibleAccounts) {
        if (triedAccounts.has(acc.id)) continue
        const check = this.store.runtime.admit(acc)
        if (check.allowed) {
          selectedAccount = acc
          break
        } else {
          admissionFailureReason = check.reason
          retryAfterSeconds = check.retryAfter
        }
      }

      if (!selectedAccount) {
        // 没有可用账号
        const status = admissionFailureReason === "upstream_cooldown" ? 503 : 429
        const errMsg = admissionFailureReason || "upstream_unavailable"
        throw {
          status,
          message: errMsg,
          headers: retryAfterSeconds ? { "Retry-After": String(retryAfterSeconds) } : undefined,
        }
      }

      triedAccounts.add(selectedAccount.id)
      attemptsCount++

      const actualModel = resolveActualModel(selectedAccount, requestedModel)!
      // 深度拷贝请求体，并注入对应策略
      const upstreamBody = JSON.parse(JSON.stringify(body))
      upstreamBody.model = actualModel
      let matchResult: StrategyMatchResult = { instruction: null, strategy_type: "none" }
      try {
        matchResult = applyPromptStrategy(protocol, upstreamBody, group, actualModel, requestedModel)
      } catch (err: any) {
        this.store.runtime.release(selectedAccount.id)
        throw { status: 400, message: err.message || "Failed to apply prompt strategy" }
      }

      // 获取解密密钥
      let decryptedKey = ""
      try {
        decryptedKey = await this.store.cipher.unseal(selectedAccount.api_key)
      } catch {
        this.store.runtime.release(selectedAccount.id)
        this.store.runtime.recordHealth(selectedAccount.id, config.settings, false)
        continue
      }
      secretsToRedact.push(decryptedKey)

      const targetUrl = upstreamUrl(selectedAccount.endpoint, routeFor(protocol))

      // 准备 upstream 请求头
      const reqHeaders: Record<string, string> = {
        "Content-Type": "application/json",
      }
      if (protocol === "anthropic") {
        reqHeaders["x-api-key"] = decryptedKey
        reqHeaders["anthropic-version"] = headers["anthropic-version"] || "2023-06-01"
        if (headers["anthropic-beta"]) {
          reqHeaders["anthropic-beta"] = headers["anthropic-beta"]
        }
      } else {
        reqHeaders["Authorization"] = `Bearer ${decryptedKey}`
      }

      for (const h of ["accept", "openai-beta", "idempotency-key", "x-client-request-id"]) {
        if (headers[h]) {
          reqHeaders[h] = headers[h]
        }
      }

      const timeoutMs = Math.max(1, config.settings.request_timeout_seconds || 120) * 1000
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)

      let res: any
      try {
        res = await fetch(targetUrl, {
          method: "POST",
          headers: reqHeaders,
          body: JSON.stringify(upstreamBody),
          signal: controller.signal,
        })
      } catch (fetchErr: any) {
        clearTimeout(timer)
        this.store.runtime.release(selectedAccount.id)
        this.store.runtime.recordHealth(selectedAccount.id, config.settings, false)
        lastError = fetchErr
        continue
      }
      clearTimeout(timer)

      const isRetryable =
        [401, 403, 408, 429].includes(res.status) || res.status >= 500

      if (isRetryable && i < totalAttempts - 1) {
        this.store.runtime.release(selectedAccount.id)
        this.store.runtime.recordHealth(selectedAccount.id, config.settings, false)
        continue
      }

      // 处理上游响应
      const responseContentType = res.headers.get("content-type") || ""
      const isSse = responseContentType.toLowerCase().includes("text/event-stream")

      let rawResponseText = ""
      let firstTokenMs: number | undefined
      let usage: Usage = {
        input_tokens: 0,
        output_tokens: 0,
        cached_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      }
      let containsCyber = false

      if (isSse && res.body && typeof res.body.getReader === "function") {
        const reader = res.body.getReader()
        const decoder = new TextDecoder("utf-8")
        let buffer = ""

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          const chunkStr = decoder.decode(value, { stream: true })
          buffer += chunkStr

          if (!firstTokenMs && (chunkStr.includes('"content"') || chunkStr.includes('"text"') || chunkStr.includes('"delta"'))) {
            firstTokenMs = Date.now() - startTime
          }
          if (!containsCyber && /cyber/i.test(chunkStr)) {
            containsCyber = true
          }
        }
        rawResponseText = buffer

        // 尝试从 SSE 文本中解析最终 usage
        const lines = rawResponseText.split("\n")
        for (const line of lines) {
          if (line.startsWith("data:") && line.includes('"usage"')) {
            try {
              const jsonStr = line.replace(/^data:\s*/, "").trim()
              if (jsonStr && jsonStr !== "[DONE]") {
                const parsed = JSON.parse(jsonStr)
                const u = parseUsage(parsed)
                usage.input_tokens = Math.max(usage.input_tokens, u.input_tokens)
                usage.output_tokens = Math.max(usage.output_tokens, u.output_tokens)
                usage.cached_tokens = Math.max(usage.cached_tokens, u.cached_tokens)
                usage.cache_creation_input_tokens = Math.max(usage.cache_creation_input_tokens, u.cache_creation_input_tokens)
                usage.cache_read_input_tokens = Math.max(usage.cache_read_input_tokens, u.cache_read_input_tokens)
              }
            } catch {}
          }
        }
      } else {
        rawResponseText = await res.text()
        if (/cyber/i.test(rawResponseText)) {
          containsCyber = true
        }
        try {
          const parsed = JSON.parse(rawResponseText)
          usage = parseUsage(parsed)
        } catch {}
      }

      this.store.runtime.release(selectedAccount.id)
      const isSuccess = res.status >= 200 && res.status < 300
      this.store.runtime.recordHealth(selectedAccount.id, config.settings, isSuccess)

      const totalLatency = Date.now() - startTime

      // 脱敏处理
      const safeResponseText = errorSummary(rawResponseText, secretsToRedact)

      const returnHeaders: Record<string, string> = {
        "Content-Type": responseContentType || "application/json; charset=utf-8",
        "X-Request-Id": id(),
      }
      for (const h of ["retry-after", "x-request-id"]) {
        const val = res.headers.get(h)
        if (val) returnHeaders[h] = val
      }

      // 将本次实际生效的 Prompt 策略写入响应头，便于逐请求“看得见”验证
      if (matchResult && matchResult.strategy_type && matchResult.strategy_type !== "none") {
        returnHeaders["X-Zako-Strategy"] = matchResult.strategy_type
        if (matchResult.profile_name) returnHeaders["X-Zako-Profile"] = encodeURIComponent(matchResult.profile_name)
        if (matchResult.matched_model) returnHeaders["X-Zako-Matched-Model"] = encodeURIComponent(matchResult.matched_model)
      }
      returnHeaders["X-Zako-Version"] = APP_VERSION

      // 记录日志
      const logEntry: RequestLog = {
        id: returnHeaders["X-Request-Id"],
        timestamp: now(),
        key_id: key.id,
        account_id: selectedAccount.id,
        model: requestedModel,
        protocol,
        status: res.status,
        latency_ms: totalLatency,
        first_token_ms: firstTokenMs,
        usage,
        cyber: containsCyber,
        attempts: attemptsCount,
        request_path: `/v1/${routeFor(protocol)}`,
        error: isSuccess ? undefined : errorSummary(`Upstream status ${res.status}`, secretsToRedact),
        strategy_type: matchResult.strategy_type,
        profile_id: matchResult.profile_id,
        profile_name: matchResult.profile_name,
        matched_model: matchResult.matched_model,
      }
      await this.store.log(logEntry, config.settings.retention_days)

      return {
        status: res.status,
        headers: returnHeaders,
        body: safeResponseText,
      }
    }

    throw {
      status: 502,
      message: lastError ? String(lastError) : "Upstream request failed after all attempts",
    }
  }
}
