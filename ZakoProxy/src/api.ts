import { PROFILES, findProfile } from "./profiles"
import { APP_VERSION } from "./server"
import type { ZakoServer } from "./server"
import type { Store } from "./store"
import { digest, id, now, token } from "./store"
import type { Account, ApiKey, Config, Group, Settings } from "./types"

declare function fetch(input: any, init?: any): Promise<any>

const START_TIME = Date.now()

/**
 * 控制台统一安全响应头：禁止内嵌、禁止 MIME 探测、限制外部连接（防数据外带）
 * 注：WebUI 大量使用内联 onclick/style，故保留 'unsafe-inline'。
 */
export const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy":
    "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
}

/**
 * 跨域可读的响应头：浏览器的 CORS 默认只放开 6 个“安全头”，
 * 不显式 Expose 的话，前端 fetch 读不到 X-Zako-* 策略诊断头，
 * 用户就无法判断本次请求到底命中了哪条预设。
 */
export const EXPOSE_HEADERS = "X-Zako-Strategy, X-Zako-Profile, X-Zako-Matched-Model, X-Zako-Score, X-Zako-Injected, X-Zako-Version"

export function jsonResponse(data: any, status: number = 200): HttpResponse {
  const jsonStr = JSON.stringify(data)
  return HttpResponse.raw(status, status === 200 ? "OK" : "Error", {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      ...SECURITY_HEADERS,
    },
    body: Data.fromRawString(jsonStr, "utf-8") || undefined,
  })
}

function parseQueryParams(url: string): Record<string, string> {
  const result: Record<string, string> = {}
  const qIdx = url.indexOf("?")
  if (qIdx === -1) return result
  const queryStr = url.substring(qIdx + 1)
  const pairs = queryStr.split("&")
  for (const pair of pairs) {
    if (!pair) continue
    const eqIdx = pair.indexOf("=")
    if (eqIdx !== -1) {
      const k = decodeURIComponent(pair.substring(0, eqIdx))
      const v = decodeURIComponent(pair.substring(eqIdx + 1))
      result[k] = v
    } else {
      result[decodeURIComponent(pair)] = ""
    }
  }
  return result
}

function parseJsonBody(req: HttpRequest): any {
  try {
    const raw = req.body?.toDecodedString("utf8") || ""
    if (!raw.trim()) return {}
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export async function handleApiRoute(
  path: string,
  method: string,
  req: HttpRequest,
  store: Store,
  server: ZakoServer
): Promise<HttpResponse | null> {
  // 提取纯净路径（去掉 query 参数）
  const cleanPath = path.split("?")[0]
  const query = parseQueryParams(path)

  // 1. GET /api/system
  if (cleanPath === "/api/system" && method === "GET") {
    const cfg = await store.getConfig()
    return jsonResponse({
      version: APP_VERSION,
      app: "ZakoProxy",
      author: "vcncv",
      running: server.isRunning,
      port: server.activePort || 1990,
      uptime_seconds: Math.floor((Date.now() - server.startTime) / 1000),
      start_time: server.startTime,
      accounts_count: cfg.accounts?.length || 0,
      keys_count: cfg.keys?.length || 0,
      groups_count: cfg.groups?.length || 0,
      profiles_count: PROFILES.length,
    })
  }

  // 1.1 POST /api/system/restart (热重启代理服务)
  if (cleanPath === "/api/system/restart" && method === "POST") {
    const cfg = await store.getConfig()
    const body = parseJsonBody(req)
    const targetPort =
      (typeof body.port === "number" && body.port > 0)
        ? body.port
        : (server.activePort || cfg.settings?.port || 1990)

    // 延迟 100ms 异步重启，以便先完成当前 HTTP 响应的交付
    setTimeout(async () => {
      try {
        await server.restart(targetPort)
      } catch (e) {
        console.error("ZakoProxy hot restart failed:", e)
      }
    }, 100)

    return jsonResponse({
      success: true,
      message: "ZakoProxy 代理服务正在热重启...",
      target_port: targetPort,
      version: APP_VERSION,
    })
  }

  // 2. GET /api/stats
  if (cleanPath === "/api/stats" && method === "GET") {
    const cfg = await store.getConfig()
    const current = now()
    const sevenDaysAgo = current - 7 * 86400
    const logs = await store.logs(sevenDaysAgo, current + 60)

    let inTok = 0
    let outTok = 0
    let cacheTok = 0
    let latTotal = 0
    let succCount = 0
    let cyberCount = 0
    const modelStats: Record<string, { requests: number; tokens: number }> = {}
    const protocolStats: Record<string, number> = {}

    // 24小时分桶 (每小时统计一次)
    const hourlyBuckets: { [hour: string]: { requests: number; tokens: number } } = {}
    for (let i = 23; i >= 0; i--) {
      const d = new Date((current - i * 3600) * 1000)
      const hStr = `${String(d.getHours()).padStart(2, "0")}:00`
      hourlyBuckets[hStr] = { requests: 0, tokens: 0 }
    }

    const dayAgo = current - 86400
    for (const l of logs) {
      const iT = l.usage?.input_tokens || 0
      const oT = l.usage?.output_tokens || 0
      const cT = l.usage?.cached_tokens || 0
      const tot = iT + oT

      inTok += iT
      outTok += oT
      cacheTok += cT
      latTotal += l.latency_ms || 0
      if (l.status >= 200 && l.status < 300) succCount++
      if (l.cyber) cyberCount++

      // 模型统计
      const m = l.model || "unknown"
      if (!modelStats[m]) modelStats[m] = { requests: 0, tokens: 0 }
      modelStats[m].requests++
      modelStats[m].tokens += tot

      // 协议统计
      const p = l.protocol || "chat"
      protocolStats[p] = (protocolStats[p] || 0) + 1

      // 24小时桶
      if (l.timestamp >= dayAgo) {
        const d = new Date(l.timestamp * 1000)
        const hStr = `${String(d.getHours()).padStart(2, "0")}:00`
        if (hourlyBuckets[hStr]) {
          hourlyBuckets[hStr].requests++
          hourlyBuckets[hStr].tokens += tot
        }
      }
    }

    // 账号运行时活跃度与状态
    const accountsRuntime = (cfg.accounts || []).map((acc) => {
      const rt = store.runtime.getRuntime(acc.id)
      const cooldownRemaining = Math.max(0, rt.cooldown_until - current)
      return {
        id: acc.id,
        name: acc.name,
        active: rt.active,
        failures: rt.failures,
        cooldownRemaining,
        requests: rt.requests,
        enabled: acc.enabled,
      }
    })

    return jsonResponse({
      totalRequests: logs.length,
      successRate: logs.length > 0 ? Math.round((succCount / logs.length) * 100) : 100,
      inputTokens: inTok,
      outputTokens: outTok,
      cachedTokens: cacheTok,
      avgLatency: logs.length > 0 ? Math.round(latTotal / logs.length) : 0,
      cyberCount,
      models: modelStats,
      protocols: protocolStats,
      hourlyTrend: hourlyBuckets,
      accountsRuntime,
    })
  }

  // 3. GET /api/logs
  if (cleanPath === "/api/logs" && method === "GET") {
    const page = parseInt(query.page || "1", 10) || 1
    const size = parseInt(query.size || "25", 10) || 25
    const filterModel = query.model || ""
    const filterStatus = query.status ? parseInt(query.status, 10) : null
    const filterCyber = query.cyber ? query.cyber === "true" : null
    const filterProtocol = query.protocol || ""

    const allRes = await store.logsPage(page, size)
    // 如果没有特别筛选条件，直接返回原生分页
    if (!filterModel && filterStatus === null && filterCyber === null && !filterProtocol) {
      return jsonResponse(allRes)
    }

    // 若有复合过滤条件，执行内存过滤并重新计算总数与分页
    const cfg = await store.getConfig()
    const allLogs = await store.logs(now() - (cfg.settings?.retention_days || 7) * 86400, now() + 60)
    const filtered = allLogs.filter((l) => {
      if (filterModel && !l.model.toLowerCase().includes(filterModel.toLowerCase())) return false
      if (filterStatus !== null && l.status !== filterStatus) return false
      if (filterCyber !== null && l.cyber !== filterCyber) return false
      if (filterProtocol && l.protocol !== filterProtocol) return false
      return true
    })

    const total = filtered.length
    const total_pages = Math.max(1, Math.ceil(total / size))
    const validPage = Math.min(Math.max(1, page), total_pages)
    const offset = (validPage - 1) * size
    const items = filtered.slice(offset, offset + size)

    return jsonResponse({
      items,
      page: validPage,
      total,
      total_pages,
      retention_days: cfg.settings?.retention_days || 7,
    })
  }

  // 4. DELETE /api/logs
  if (cleanPath === "/api/logs" && method === "DELETE") {
    const deletedCount = await store.deleteLogs()
    return jsonResponse({ success: true, count: deletedCount })
  }

  // 5. GET /api/accounts
  if (cleanPath === "/api/accounts" && method === "GET") {
    const cfg = await store.getConfig()
    const current = now()
    const safeAccounts = []
    for (const acc of cfg.accounts || []) {
      const rt = store.runtime.getRuntime(acc.id)
      const cooldownRemaining = Math.max(0, rt.cooldown_until - current)
      // 永远不返回密钥（即使是密文），只返回脱敏后的明文前缀
      const safe: any = { ...acc }
      delete safe.api_key
      const rawKey = acc.api_key ? await store.cipher.unseal(acc.api_key) : ""
      safeAccounts.push({
        ...safe,
        api_key_masked: rawKey ? `${rawKey.slice(0, 4)}••••${rawKey.slice(-4)}` : "",
        has_api_key: Boolean(acc.api_key),
        runtime: {
          active: rt.active,
          failures: rt.failures,
          cooldownRemaining,
          requests: rt.requests,
        },
      })
    }
    return jsonResponse(safeAccounts)
  }

  // 6. POST /api/accounts
  if (cleanPath === "/api/accounts" && method === "POST") {
    const body = parseJsonBody(req)
    if (!body || !body.name || !body.endpoint) {
      return jsonResponse({ error: "Missing required fields (name, endpoint)" }, 400)
    }

    let encryptedKey = ""
    if (body.api_key) {
      encryptedKey = await store.cipher.seal(body.api_key)
    }

    const newAcc: Account = {
      id: id(),
      name: String(body.name).trim(),
      endpoint: String(body.endpoint).trim().replace(/\/+$/, ""),
      api_key: encryptedKey,
      proxy_url: body.proxy_url ? String(body.proxy_url).trim() : undefined,
      models: Array.isArray(body.models) ? body.models : [],
      model_mappings: typeof body.model_mappings === "object" && body.model_mappings ? body.model_mappings : {},
      group_ids: Array.isArray(body.group_ids) ? body.group_ids : [],
      rpm: typeof body.rpm === "number" ? body.rpm : 0,
      concurrency: typeof body.concurrency === "number" ? body.concurrency : 0,
      priority: typeof body.priority === "number" ? body.priority : 10,
      enabled: body.enabled !== false,
      protocols: Array.isArray(body.protocols) && body.protocols.length > 0 ? body.protocols : ["chat", "responses"],
    }

    await store.updateConfig((c) => {
      if (!c.accounts) c.accounts = []
      c.accounts.push(newAcc)
    })

    return jsonResponse({ success: true, account: { ...newAcc, api_key: undefined } })
  }

  // 7. PUT /api/accounts/:id
  if (cleanPath.startsWith("/api/accounts/") && !cleanPath.endsWith("/test") && method === "PUT") {
    const accId = cleanPath.slice("/api/accounts/".length)
    const body = parseJsonBody(req)
    if (!body) return jsonResponse({ error: "Invalid JSON body" }, 400)

    let updatedAcc: Account | null = null
    await store.updateConfig(async (c) => {
      const idx = (c.accounts || []).findIndex((a) => a.id === accId)
      if (idx === -1) return
      const old = c.accounts[idx]

      let encKey = old.api_key
      if (body.api_key && body.api_key !== old.api_key && !body.api_key.includes("••••")) {
        encKey = await store.cipher.seal(body.api_key)
      }

      updatedAcc = {
        ...old,
        name: body.name !== undefined ? String(body.name).trim() : old.name,
        endpoint: body.endpoint !== undefined ? String(body.endpoint).trim().replace(/\/+$/, "") : old.endpoint,
        api_key: encKey,
        proxy_url: body.proxy_url !== undefined ? (body.proxy_url ? String(body.proxy_url).trim() : undefined) : old.proxy_url,
        models: Array.isArray(body.models) ? body.models : old.models,
        model_mappings: typeof body.model_mappings === "object" ? body.model_mappings : old.model_mappings,
        group_ids: Array.isArray(body.group_ids) ? body.group_ids : old.group_ids,
        rpm: typeof body.rpm === "number" ? body.rpm : old.rpm,
        concurrency: typeof body.concurrency === "number" ? body.concurrency : old.concurrency,
        priority: typeof body.priority === "number" ? body.priority : old.priority,
        enabled: typeof body.enabled === "boolean" ? body.enabled : old.enabled,
        protocols: Array.isArray(body.protocols) ? body.protocols : old.protocols,
      }
      c.accounts[idx] = updatedAcc
    })

    if (!updatedAcc) return jsonResponse({ error: "Account not found" }, 404)
    const safeUpdated = { ...(updatedAcc as Account), api_key: undefined }
    return jsonResponse({ success: true, account: safeUpdated })
  }

  // 8. DELETE /api/accounts/:id
  if (cleanPath.startsWith("/api/accounts/") && !cleanPath.endsWith("/test") && method === "DELETE") {
    const accId = cleanPath.slice("/api/accounts/".length)
    let removed = false
    await store.updateConfig((c) => {
      const prevLen = c.accounts?.length || 0
      c.accounts = (c.accounts || []).filter((a) => a.id !== accId)
      if (c.accounts.length < prevLen) removed = true
    })
    return jsonResponse({ success: removed })
  }

  // 9. POST /api/accounts/:id/test (连通性测试)
  if (cleanPath.startsWith("/api/accounts/") && cleanPath.endsWith("/test") && method === "POST") {
    const accId = cleanPath.slice("/api/accounts/".length, cleanPath.length - "/test".length)
    const cfg = await store.getConfig()
    const acc = (cfg.accounts || []).find((a) => a.id === accId)
    if (!acc) return jsonResponse({ error: "Account not found" }, 404)

    const rawKey = acc.api_key ? await store.cipher.unseal(acc.api_key) : ""
    const testUrl = `${acc.endpoint}/models`
    const tStart = Date.now()
    try {
      const headers: Record<string, string> = {
        "User-Agent": "ZakoProxy/1.0",
      }
      if (rawKey) {
        headers["Authorization"] = `Bearer ${rawKey}`
        headers["x-api-key"] = rawKey
      }
      const resp = await fetch(testUrl, {
        method: "GET",
        headers,
      })
      const latency = Date.now() - tStart
      return jsonResponse({
        success: resp.ok,
        status: resp.status,
        latency_ms: latency,
        status_text: resp.statusText,
      })
    } catch (e: any) {
      const latency = Date.now() - tStart
      return jsonResponse({
        success: false,
        status: 0,
        latency_ms: latency,
        error: e?.message || String(e),
      })
    }
  }

  // 10. GET /api/keys
  if (cleanPath === "/api/keys" && method === "GET") {
    const cfg = await store.getConfig()
    const groupMap = new Map((cfg.groups || []).map((g) => [g.id, g.name]))
    const keysWithGroupName = (cfg.keys || []).map((k) => ({
      ...k,
      group_name: groupMap.get(k.group_id) || "Default",
      secret: undefined, // 永远不返回 secret
    }))
    return jsonResponse(keysWithGroupName)
  }

  // 11. POST /api/keys
  if (cleanPath === "/api/keys" && method === "POST") {
    const body = parseJsonBody(req)
    if (!body || !body.name) {
      return jsonResponse({ error: "Key name is required" }, 400)
    }

    const cfg = await store.getConfig()
    const defaultGroup = cfg.groups?.[0]?.id || "primary"
    const prefix = "sk-"
    const rawSecret = token(prefix)
    const hashed = await digest(rawSecret)

    const newKey: ApiKey = {
      id: id(),
      name: String(body.name).trim(),
      group_id: body.group_id || defaultGroup,
      secret: "", // 仅留存哈希，不存明文
      hash: hashed,
      prefix: `${prefix}${rawSecret.slice(3, 7)}...`,
      enabled: true,
      created_at: now(),
    }

    await store.updateConfig((c) => {
      if (!c.keys) c.keys = []
      c.keys.push(newKey)
    })

    // 返回新 Key 的完整 rawSecret，供前端一键复制
    return jsonResponse({
      success: true,
      raw_key: rawSecret,
      key: newKey,
    })
  }

  // 12. DELETE /api/keys/:id
  if (cleanPath.startsWith("/api/keys/") && method === "DELETE") {
    const keyId = cleanPath.slice("/api/keys/".length)
    let removed = false
    await store.updateConfig((c) => {
      const prev = c.keys?.length || 0
      c.keys = (c.keys || []).filter((k) => k.id !== keyId)
      if (c.keys.length < prev) removed = true
    })
    return jsonResponse({ success: removed })
  }

  // 13. PATCH /api/keys/:id
  if (cleanPath.startsWith("/api/keys/") && method === "PATCH") {
    const keyId = cleanPath.slice("/api/keys/".length)
    const body = parseJsonBody(req)
    let updated: ApiKey | null = null
    await store.updateConfig((c) => {
      const item = (c.keys || []).find((k) => k.id === keyId)
      if (item) {
        if (typeof body?.enabled === "boolean") item.enabled = body.enabled
        if (body?.name) item.name = String(body.name).trim()
        if (body?.group_id) item.group_id = String(body.group_id).trim()
        updated = item
      }
    })
    if (!updated) return jsonResponse({ error: "Key not found" }, 404)
    return jsonResponse({ success: true, key: updated })
  }

  // 14. GET /api/groups
  if (cleanPath === "/api/groups" && method === "GET") {
    const cfg = await store.getConfig()
    return jsonResponse(cfg.groups || [])
  }

  // 15. POST /api/groups
  if (cleanPath === "/api/groups" && method === "POST") {
    const body = parseJsonBody(req)
    if (!body || !body.name) return jsonResponse({ error: "Group name is required" }, 400)
    const newGrp: Group = {
      id: id(),
      name: String(body.name).trim(),
      profile_ids: Array.isArray(body.profile_ids) ? body.profile_ids : [],
      default_strategy_enabled: body.default_strategy_enabled !== false,
      custom_instruction: typeof body.custom_instruction === "string" ? body.custom_instruction.trim() : undefined,
    }
    await store.updateConfig((c) => {
      if (!c.groups) c.groups = []
      c.groups.push(newGrp)
    })
    return jsonResponse({ success: true, group: newGrp })
  }

  // 16. PUT /api/groups/:id
  if (cleanPath.startsWith("/api/groups/") && method === "PUT") {
    const grpId = cleanPath.slice("/api/groups/".length)
    const body = parseJsonBody(req)
    let updated: Group | null = null
    await store.updateConfig((c) => {
      const item = (c.groups || []).find((g) => g.id === grpId)
      if (item) {
        if (body.name) item.name = String(body.name).trim()
        if (Array.isArray(body.profile_ids)) item.profile_ids = body.profile_ids
        if (typeof body.default_strategy_enabled === "boolean") {
          item.default_strategy_enabled = body.default_strategy_enabled
        }
        if (body.custom_instruction !== undefined) {
          item.custom_instruction = typeof body.custom_instruction === "string" ? body.custom_instruction.trim() : undefined
        }
        updated = item
      }
    })
    if (!updated) return jsonResponse({ error: "Group not found" }, 404)
    return jsonResponse({ success: true, group: updated })
  }

  // 17. DELETE /api/groups/:id
  if (cleanPath.startsWith("/api/groups/") && method === "DELETE") {
    const grpId = cleanPath.slice("/api/groups/".length)
    let removed = false
    await store.updateConfig((c) => {
      const prev = c.groups?.length || 0
      c.groups = (c.groups || []).filter((g) => g.id !== grpId)
      if (c.groups.length < prev) removed = true
    })
    return jsonResponse({ success: removed })
  }

  // 18. GET /api/profiles/:id
  if (cleanPath.startsWith("/api/profiles/") && method === "GET") {
    const profileId = cleanPath.slice("/api/profiles/".length)
    const profile = findProfile(profileId)
    if (!profile) return jsonResponse({ error: "Profile not found" }, 404)
    return jsonResponse(profile)
  }

  // 18.2 GET /api/profiles
  if (cleanPath === "/api/profiles" && method === "GET") {
    const summary = PROFILES.map((p) => ({
      id: p.id,
      name: p.name,
      model_family: p.model_family,
      models: p.models,
      instruction_length: p.instruction?.length || 0,
      instruction_snippet: p.instruction ? p.instruction.slice(0, 160) + "..." : "",
    }))
    return jsonResponse(summary)
  }

  // 19. GET /api/settings
  if (cleanPath === "/api/settings" && method === "GET") {
    const cfg = await store.getConfig()
    return jsonResponse(cfg.settings || {})
  }

  // 20. PUT /api/settings
  if (cleanPath === "/api/settings" && method === "PUT") {
    const body = parseJsonBody(req)
    if (!body) return jsonResponse({ error: "Invalid JSON" }, 400)
    let updated: Settings | null = null
    await store.updateConfig((c) => {
      c.settings = {
        security_path: body.security_path !== undefined ? String(body.security_path) : c.settings.security_path,
        max_retries: typeof body.max_retries === "number" ? body.max_retries : c.settings.max_retries,
        failure_threshold: typeof body.failure_threshold === "number" ? body.failure_threshold : c.settings.failure_threshold,
        cooldown_seconds: typeof body.cooldown_seconds === "number" ? body.cooldown_seconds : c.settings.cooldown_seconds,
        request_timeout_seconds: typeof body.request_timeout_seconds === "number" ? body.request_timeout_seconds : c.settings.request_timeout_seconds,
        retention_days: typeof body.retention_days === "number" ? body.retention_days : c.settings.retention_days,
        port: typeof body.port === "number" ? body.port : c.settings.port,
      }
      updated = c.settings
    })
    return jsonResponse({ success: true, settings: updated })
  }

  return null
}
