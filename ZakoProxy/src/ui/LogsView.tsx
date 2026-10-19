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
import type { RequestLog } from "../types"

interface LogsViewProps {
  store: Store
}

export function LogsView({ store }: LogsViewProps) {
  const [logs, setLogs] = useState<RequestLog[]>([])
  const [loading, setLoading] = useState(true)

  const loadData = async () => {
    try {
      setLoading(true)
      const pageData = await store.logsPage(1, 50)
      setLogs(pageData.items || [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  const handleClearLogs = async () => {
    const confirm = await Dialog.confirm({
      title: "清空调用日志",
      message: "确定要清空所有已记录的调用日志吗？该操作不可逆。",
      confirmLabel: "清空",
      cancelLabel: "取消",
    })
    if (!confirm) return

    await store.deleteLogs()
    await loadData()
    await Dialog.alert({
      title: "清空完成",
      message: "已成功清空全部请求日志！",
    })
  }

  const formatTime = (ts: number) => {
    const d = new Date(ts * 1000)
    const pad = (n: number) => String(n).padStart(2, "0")
    return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  }

  return (
    <List
      navigationTitle="调用日志"
      toolbar={{
        topBarTrailing: (
          <HStack spacing={12}>
            <Button title="刷新" action={loadData} />
            <Button title="清空" action={handleClearLogs} />
          </HStack>
        ),
      }}
    >
      <Section
        header={<Text>最近调用记录 (最新 50 条)</Text>}
        footer={<Text>包含请求协议、耗时、首字响应延迟、Token 统计及安全审计标识。</Text>}
      >
        {logs.length === 0 ? (
          <Text>暂无调用记录，开始发起 API 请求后将在此实时展示。</Text>
        ) : (
          logs.map((log) => {
            const isOk = log.status >= 200 && log.status < 300
            return (
              <VStack key={log.id} alignment="leading" spacing={4}>
                <HStack>
                  <Text attributedString={`**${log.model}**`} />
                  <Text attributedString={isOk ? `*HTTP ${log.status}*` : `**[HTTP ${log.status}]**`} />
                </HStack>
                <HStack>
                  <Text>协议: {log.protocol.toUpperCase()}</Text>
                  <Text>耗时: {log.latency_ms}ms</Text>
                  {log.first_token_ms ? (
                    <Text>首字: {log.first_token_ms}ms</Text>
                  ) : null}
                  {log.cyber ? (
                    <Text attributedString="**⚡ Cyber**" />
                  ) : null}
                </HStack>
                <HStack>
                  <Text>
                    Tokens: 进 {log.usage.input_tokens} / 出 {log.usage.output_tokens} (缓存 {log.usage.cached_tokens})
                  </Text>
                  <Text>{formatTime(log.timestamp)}</Text>
                </HStack>
                {log.error ? (
                  <Text attributedString={`*错误: ${log.error}*`} />
                ) : null}
              </VStack>
            )
          })
        )}
      </Section>
    </List>
  )
}
