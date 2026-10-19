import {
  Button,
  HStack,
  List,
  Section,
  Text,
  VStack,
  useEffect,
  useState,
} from "scripting"
import type { Store } from "../store"
import type { Settings } from "../types"

interface SettingsViewProps {
  store: Store
  onPortChange?: (newPort: number) => void
}

export function SettingsView({ store, onPortChange }: SettingsViewProps) {
  const [settings, setSettings] = useState<Settings>({
    security_path: "",
    max_retries: 2,
    failure_threshold: 2,
    cooldown_seconds: 60,
    request_timeout_seconds: 120,
    retention_days: 7,
    port: 1990,
  })
  const [loading, setLoading] = useState(true)

  const loadData = async () => {
    try {
      const cfg = await store.getConfig()
      setSettings(cfg.settings)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  const handleEditPort = async () => {
    const input = await Dialog.prompt({
      title: "修改服务端口",
      message: "本地 HttpServer 监听端口（默认 1990）",
      defaultValue: String(settings.port || 1990),
    })
    if (!input) return
    const p = parseInt(input.trim(), 10)
    if (isNaN(p) || p <= 0 || p > 65535) {
      await Dialog.alert({ title: "错误", message: "端口必须在 1-65535 之间" })
      return
    }

    await store.updateConfig((cfg) => {
      cfg.settings.port = p
    })
    await loadData()
    if (onPortChange) onPortChange(p)
  }

  const handleEditRetries = async () => {
    const input = await Dialog.prompt({
      title: "修改最大重试次数",
      message: "当账号请求发生网络异常或 4xx/5xx 可重试错误时的故障转移重试次数",
      defaultValue: String(settings.max_retries ?? 2),
    })
    if (!input) return
    const r = parseInt(input.trim(), 10)
    if (isNaN(r) || r < 0) return

    await store.updateConfig((cfg) => {
      cfg.settings.max_retries = r
    })
    await loadData()
  }

  const handleEditThreshold = async () => {
    const input = await Dialog.prompt({
      title: "修改熔断阈值",
      message: "单个账号连续失败达到该次数后自动进入冷却熔断状态",
      defaultValue: String(settings.failure_threshold ?? 2),
    })
    if (!input) return
    const t = parseInt(input.trim(), 10)
    if (isNaN(t) || t <= 0) return

    await store.updateConfig((cfg) => {
      cfg.settings.failure_threshold = t
    })
    await loadData()
  }

  const handleEditCooldown = async () => {
    const input = await Dialog.prompt({
      title: "修改冷却熔断时长 (秒)",
      message: "触发熔断后的暂停请求冷却时间（秒）",
      defaultValue: String(settings.cooldown_seconds ?? 60),
    })
    if (!input) return
    const c = parseInt(input.trim(), 10)
    if (isNaN(c) || c <= 0) return

    await store.updateConfig((cfg) => {
      cfg.settings.cooldown_seconds = c
    })
    await loadData()
  }

  const handleEditTimeout = async () => {
    const input = await Dialog.prompt({
      title: "修改请求超时时长 (秒)",
      message: "向上游发起请求的最大等待超时时间（秒）",
      defaultValue: String(settings.request_timeout_seconds ?? 120),
    })
    if (!input) return
    const to = parseInt(input.trim(), 10)
    if (isNaN(to) || to <= 0) return

    await store.updateConfig((cfg) => {
      cfg.settings.request_timeout_seconds = to
    })
    await loadData()
  }

  const handleEditRetention = async () => {
    const input = await Dialog.prompt({
      title: "修改日志保留天数",
      message: "自动清理超过指定天数的调用日志",
      defaultValue: String(settings.retention_days ?? 7),
    })
    if (!input) return
    const d = parseInt(input.trim(), 10)
    if (isNaN(d) || d <= 0) return

    await store.updateConfig((cfg) => {
      cfg.settings.retention_days = d
    })
    await loadData()
  }

  return (
    <List navigationTitle="系统与服务设置">
      <Section header={<Text>网络与端口</Text>}>
        <HStack>
          <VStack alignment="leading">
            <Text attributedString="**监听端口**" />
            <Text>当前: {settings.port || 1990}</Text>
          </VStack>
          <Button title="修改" action={handleEditPort} />
        </HStack>
      </Section>

      <Section header={<Text>故障转移与熔断机制</Text>}>
        <HStack>
          <VStack alignment="leading">
            <Text attributedString="**最大重试次数**" />
            <Text>
              遇到异常时尝试切换其他账号的次数: {settings.max_retries}
            </Text>
          </VStack>
          <Button title="修改" action={handleEditRetries} />
        </HStack>

        <HStack>
          <VStack alignment="leading">
            <Text attributedString="**熔断失败阈值**" />
            <Text>
              账号连续失败达 {settings.failure_threshold} 次后进入冷却
            </Text>
          </VStack>
          <Button title="修改" action={handleEditThreshold} />
        </HStack>

        <HStack>
          <VStack alignment="leading">
            <Text attributedString="**熔断冷却时间**" />
            <Text>
              触发熔断后冷却 {settings.cooldown_seconds} 秒
            </Text>
          </VStack>
          <Button title="修改" action={handleEditCooldown} />
        </HStack>

        <HStack>
          <VStack alignment="leading">
            <Text attributedString="**上游超时时间**" />
            <Text>
              每次请求上游最长等待 {settings.request_timeout_seconds} 秒
            </Text>
          </VStack>
          <Button title="修改" action={handleEditTimeout} />
        </HStack>
      </Section>

      <Section header={<Text>存储与维护</Text>}>
        <HStack>
          <VStack alignment="leading">
            <Text attributedString="**日志保留天数**" />
            <Text>
              系统将自动清理早于 {settings.retention_days} 天的请求记录
            </Text>
          </VStack>
          <Button title="修改" action={handleEditRetention} />
        </HStack>
      </Section>
    </List>
  )
}
