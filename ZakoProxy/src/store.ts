import type {
  Account,
  AccountRuntime,
  ApiKey,
  Config,
  Group,
  RequestLog,
  Settings,
  Usage,
} from "./types"

export function now(): number {
  return Math.floor(Date.now() / 1000)
}

export function id(): string {
  return crypto.randomUUID()
}

export function token(prefix: string = ""): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
  return `${prefix}${hex}`
}

export async function digest(value: string): Promise<string> {
  const enc = new TextEncoder().encode(value)
  const hashBuf = await crypto.subtle.digest("SHA-256", enc)
  return Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

function bytesToBase64(bytes: Uint8Array): string {
  const binary = Array.from(bytes, (b) => String.fromCharCode(b)).join("")
  return btoa(binary)
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64)
  return new Uint8Array(Array.from(binary, (c) => c.charCodeAt(0)))
}

export class KeyCipher {
  private key: CryptoKey | null = null

  async init(keyPath: string) {
    let keyBytes: Uint8Array
    if (FileManager.existsSync(keyPath)) {
      try {
        keyBytes = FileManager.readAsBytesSync(keyPath)
      } catch {
        keyBytes = crypto.getRandomValues(new Uint8Array(32))
        FileManager.writeAsBytesSync(keyPath, keyBytes)
      }
    } else {
      keyBytes = crypto.getRandomValues(new Uint8Array(32))
      FileManager.writeAsBytesSync(keyPath, keyBytes)
    }

    this.key = await crypto.subtle.importKey(
      "raw",
      keyBytes,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    )
  }

  async seal(plain: string): Promise<string> {
    if (!this.key) throw new Error("Cipher not initialized")
    if (!plain) return ""
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const plainBytes = new TextEncoder().encode(plain)
    const cipherBuf = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      this.key,
      plainBytes
    )
    const cipherBytes = new Uint8Array(cipherBuf)
    const merged = new Uint8Array(iv.length + cipherBytes.length)
    merged.set(iv, 0)
    merged.set(cipherBytes, iv.length)
    return bytesToBase64(merged)
  }

  async unseal(encrypted: string): Promise<string> {
    if (!this.key) throw new Error("Cipher not initialized")
    if (!encrypted) return ""
    try {
      const raw = base64ToBytes(encrypted)
      if (raw.length < 28) return ""
      const iv = raw.slice(0, 12)
      const data = raw.slice(12)
      const decBuf = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv },
        this.key,
        data
      )
      return new TextDecoder().decode(decBuf)
    } catch {
      return ""
    }
  }
}

export function parseUsage(value: any): Usage {
  if (!value || typeof value !== "object") {
    return {
      input_tokens: 0,
      output_tokens: 0,
      cached_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    }
  }
  const u = value.usage || value.response?.usage || value.message?.usage || value

  const getNum = (paths: string[]): number => {
    for (const p of paths) {
      const parts = p.split("/").filter(Boolean)
      let curr = u
      for (const part of parts) {
        if (curr && typeof curr === "object" && part in curr) {
          curr = curr[part]
        } else {
          curr = undefined
          break
        }
      }
      if (typeof curr === "number" && !isNaN(curr)) {
        return Math.floor(curr)
      }
    }
    return 0
  }

  const cacheRead = getNum([
    "cache_read_input_tokens",
    "input_tokens_details/cached_tokens",
    "prompt_tokens_details/cached_tokens",
    "cached_tokens",
  ])

  const cacheCreation = getNum([
    "cache_creation_input_tokens",
    "input_tokens_details/cache_creation_tokens",
    "input_tokens_details/cache_write_tokens",
    "prompt_tokens_details/cache_creation_tokens",
    "prompt_tokens_details/cache_write_tokens",
    "cache_creation_tokens",
    "cache_write_tokens",
  ])

  const inputRaw = getNum(["input_tokens", "prompt_tokens"])
  const outputRaw = getNum(["output_tokens", "completion_tokens"])

  const totalInput = inputRaw + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0)

  return {
    input_tokens: totalInput,
    output_tokens: outputRaw,
    cached_tokens: cacheRead,
    cache_creation_input_tokens: cacheCreation,
    cache_read_input_tokens: cacheRead,
  }
}

export class RuntimeManager {
  private runtimes = new Map<string, AccountRuntime>()

  getRuntime(accountId: string): AccountRuntime {
    let r = this.runtimes.get(accountId)
    if (!r) {
      r = {
        active: 0,
        failures: 0,
        cooldown_until: 0,
        window: 0,
        requests: 0,
      }
      this.runtimes.set(accountId, r)
    }
    return r
  }

  admit(account: Account): { allowed: boolean; reason?: string; retryAfter?: number } {
    const r = this.getRuntime(account.id)
    const current = now()

    // 冷却检查
    if (r.cooldown_until > current) {
      return {
        allowed: false,
        reason: "upstream_cooldown",
        retryAfter: r.cooldown_until - current,
      }
    }
    if (r.cooldown_until !== 0) {
      r.cooldown_until = 0
      r.failures = 0
    }

    // RPM 窗口滚动
    const currentMin = Math.floor(current / 60)
    if (r.window !== currentMin) {
      r.window = currentMin
      r.requests = 0
    }

    if (account.rpm > 0 && r.requests >= account.rpm) {
      return {
        allowed: false,
        reason: "rate_limit_exceeded",
        retryAfter: 60 - (current % 60),
      }
    }

    if (account.concurrency > 0 && r.active >= account.concurrency) {
      return {
        allowed: false,
        reason: "concurrency_limit_exceeded",
        retryAfter: 1,
      }
    }

    r.active++
    r.requests++
    return { allowed: true }
  }

  release(accountId: string) {
    const r = this.getRuntime(accountId)
    if (r.active > 0) {
      r.active--
    }
  }

  recordHealth(accountId: string, settings: Settings, success: boolean) {
    const r = this.getRuntime(accountId)
    if (success) {
      r.failures = 0
      r.cooldown_until = 0
    } else {
      r.failures++
      if (r.failures >= Math.max(1, settings.failure_threshold)) {
        r.cooldown_until = now() + Math.max(1, settings.cooldown_seconds)
      }
    }
  }
}

export class Store {
  public cipher: KeyCipher
  public runtime: RuntimeManager
  private db: any
  private dbPath: string
  private masterKeyPath: string

  constructor(dataDir: string) {
    if (!FileManager.existsSync(dataDir)) {
      FileManager.createDirectorySync(dataDir, true)
    }
    this.dbPath = `${dataDir.replace(/\/+$/, "")}/zako.db`
    this.masterKeyPath = `${dataDir.replace(/\/+$/, "")}/master.key`
    this.cipher = new KeyCipher()
    this.runtime = new RuntimeManager()
  }

  async init(): Promise<void> {
    await this.cipher.init(this.masterKeyPath)

    this.db = SQLite.open(this.dbPath, {
      foreignKeysEnabled: true,
      journalMode: "wal",
      busyMode: 5,
      maximumReaderCount: 5,
      readonly: false,
      label: "zako-db",
    })

    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS config (
        id INTEGER PRIMARY KEY CHECK(id=1),
        value TEXT NOT NULL
      )
    `)
    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS requests (
        id TEXT PRIMARY KEY,
        timestamp INTEGER NOT NULL,
        value TEXT NOT NULL
      )
    `)
    await this.db.execute(`
      CREATE INDEX IF NOT EXISTS requests_time ON requests(timestamp)
    `)

    const existing = await this.db.fetchOne("SELECT value FROM config WHERE id=1")
    if (!existing) {
      const defaultConfig: Config = {
        username: "admin",
        password_hash: "",
        settings: {
          security_path: "",
          max_retries: 2,
          failure_threshold: 2,
          cooldown_seconds: 60,
          request_timeout_seconds: 120,
          retention_days: 7,
          port: 1990,
        },
        groups: [
          {
            id: id(),
            name: "Primary",
            profile_ids: [],
            default_strategy_enabled: true,
          },
        ],
        accounts: [],
        keys: [],
      }
      await this.saveConfig(defaultConfig)
    }
  }

  async getConfig(): Promise<Config> {
    const row = (await this.db.fetchOne("SELECT value FROM config WHERE id=1")) as { value: string } | null
    if (!row || !row.value) {
      throw new Error("Config not found")
    }
    return JSON.parse(row.value) as Config
  }

  async saveConfig(config: Config): Promise<void> {
    const jsonStr = JSON.stringify(config)
    await this.db.execute(
      "INSERT INTO config(id, value) VALUES(1, ?1) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
      [jsonStr]
    )
    if (config.settings?.retention_days) {
      await this.pruneLogs(config.settings.retention_days)
    }
  }

  async updateConfig<T>(mutator: (cfg: Config) => Promise<T> | T): Promise<T> {
    const cfg = await this.getConfig()
    const result = await mutator(cfg)
    await this.saveConfig(cfg)
    return result
  }

  async log(entry: RequestLog, retentionDays: number = 7): Promise<void> {
    const jsonStr = JSON.stringify(entry)
    await this.db.execute(
      "INSERT INTO requests(id, timestamp, value) VALUES(?1, ?2, ?3)",
      [entry.id, entry.timestamp, jsonStr]
    )
    await this.pruneLogs(retentionDays)
  }

  async logs(from: number, to: number): Promise<RequestLog[]> {
    const rows = (await this.db.fetchAll(
      "SELECT value FROM requests WHERE timestamp>=?1 AND timestamp<=?2 ORDER BY timestamp DESC, id DESC",
      [from, to]
    )) as { value: string }[]
    return rows.map((r: { value: string }) => JSON.parse(r.value) as RequestLog)
  }

  async logsPage(requestedPage: number, pageSize: number = 20): Promise<{
    items: RequestLog[]
    page: number
    total: number
    total_pages: number
    retention_days: number
  }> {
    const cfg = await this.getConfig()
    const retention = Math.max(1, cfg.settings?.retention_days || 7)
    await this.pruneLogs(retention)

    const totalRow = (await this.db.fetchOne("SELECT COUNT(*) as count FROM requests")) as { count: number } | null
    const total = totalRow?.count || 0
    const total_pages = Math.max(1, Math.ceil(total / pageSize))
    const page = Math.min(Math.max(1, requestedPage), total_pages)
    const offset = (page - 1) * pageSize

    const rows = (await this.db.fetchAll(
      "SELECT value FROM requests ORDER BY timestamp DESC, id DESC LIMIT ?1 OFFSET ?2",
      [pageSize, offset]
    )) as { value: string }[]
    const items = rows.map((r: { value: string }) => JSON.parse(r.value) as RequestLog)

    return {
      items,
      page,
      total,
      total_pages,
      retention_days: retention,
    }
  }

  async exportLogs(): Promise<{ retention_days: number; logs: RequestLog[] }> {
    const cfg = await this.getConfig()
    const retention = Math.max(1, cfg.settings?.retention_days || 7)
    await this.pruneLogs(retention)

    const rows = (await this.db.fetchAll(
      "SELECT value FROM requests ORDER BY timestamp DESC, id DESC"
    )) as { value: string }[]
    return {
      retention_days: retention,
      logs: rows.map((r: { value: string }) => JSON.parse(r.value) as RequestLog),
    }
  }

  async deleteLogs(): Promise<number> {
    const countRow = (await this.db.fetchOne("SELECT COUNT(*) as count FROM requests")) as { count: number } | null
    await this.db.execute("DELETE FROM requests")
    return countRow?.count || 0
  }

  async pruneLogs(retentionDays: number): Promise<void> {
    const cutoff = now() - Math.max(1, retentionDays) * 86400
    await this.db.execute("DELETE FROM requests WHERE timestamp < ?1", [cutoff])
  }
}
