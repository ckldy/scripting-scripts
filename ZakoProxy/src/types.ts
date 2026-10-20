export interface Group {
  id: string
  name: string
  profile_ids: string[]
  default_strategy_enabled: boolean
  custom_instruction?: string
}

export interface Account {
  id: string
  name: string
  endpoint: string
  api_key: string
  proxy_url?: string
  models: string[]
  model_mappings: Record<string, string>
  group_ids: string[]
  rpm: number
  concurrency: number
  priority: number
  enabled: boolean
  protocols: string[]
}

export interface ApiKey {
  id: string
  name: string
  group_id: string
  secret: string
  hash: string
  prefix: string
  enabled: boolean
  created_at: number
}

export interface Settings {
  security_path: string
  max_retries: number
  failure_threshold: number
  cooldown_seconds: number
  request_timeout_seconds: number
  retention_days: number
  port: number
}

export interface Config {
  username: string
  password_hash: string
  settings: Settings
  groups: Group[]
  accounts: Account[]
  keys: ApiKey[]
}

export interface Usage {
  input_tokens: number
  output_tokens: number
  cached_tokens: number
  cache_creation_input_tokens: number
  cache_read_input_tokens: number
}

export interface RequestLog {
  id: string
  timestamp: number
  key_id: string
  account_id: string
  model: string
  protocol: string
  status: number
  latency_ms: number
  first_token_ms?: number
  usage: Usage
  cyber: boolean
  attempts: number
  request_path: string
  error?: string
  strategy_type?: "custom" | "profile" | "default" | "none"
  profile_id?: string
  profile_name?: string
  matched_model?: string
}

export interface StrategyMatchResult {
  instruction: string | null
  strategy_type: "custom" | "profile" | "default" | "none"
  profile_id?: string
  profile_name?: string
  matched_model?: string
  score?: number
}

export interface AccountRuntime {
  active: number
  failures: number
  cooldown_until: number
  window: number
  requests: number
}

export interface Profile {
  id: string
  name: string
  models: string[]
  instruction: string
  model_family: string
}
