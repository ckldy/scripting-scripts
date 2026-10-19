declare const fetch: any

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
import { id } from "../store"
import type { Account, Group } from "../types"

interface AccountsViewProps {
  store: Store
}

export function AccountsView({ store }: AccountsViewProps) {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [groups, setGroups] = useState<Group[]>([])
  const [loading, setLoading] = useState(true)

  const loadData = async () => {
    try {
      const cfg = await store.getConfig()
      setAccounts(cfg.accounts || [])
      setGroups(cfg.groups || [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  const handleCreateAccount = async () => {
    if (groups.length === 0) {
      await Dialog.alert({
        title: "无法添加账号",
        message: "当前还没有任何分组，请先在分组管理中创建一个分组。",
      })
      return
    }

    const name = await Dialog.prompt({
      title: "1. 账号备注名称",
      placeholder: "例如：DeepSeek 官方直连 / OpenAI",
      defaultValue: `账号 ${accounts.length + 1}`,
    })
    if (!name || !name.trim()) return

    const endpoint = await Dialog.prompt({
      title: "2. 上游 API Endpoint",
      message: "支持带或不带 /v1 的 HTTP(S) 地址",
      placeholder: "https://api.deepseek.com",
      defaultValue: "https://api.openai.com/v1",
    })
    if (!endpoint || !endpoint.trim()) return

    const apiKey = await Dialog.prompt({
      title: "3. 上游 API Key",
      message: "用于认证上游服务的真实 Key，将被 AES-256 加密存储",
      placeholder: "sk-...",
    })
    if (!apiKey || !apiKey.trim()) return

    const modelsInput = await Dialog.prompt({
      title: "4. 上游支持的模型列表",
      message: "多个模型用英文逗号隔开",
      placeholder: "gpt-4o, gpt-4o-mini",
      defaultValue: "gpt-4o, gpt-4o-mini",
    })
    if (!modelsInput || !modelsInput.trim()) return
    const models = modelsInput
      .split(",")
      .map((m) => m.trim())
      .filter(Boolean)

    const mappingsInput = await Dialog.prompt({
      title: "5. 模型映射别名 (可选)",
      message: "客户端请求模型=真实上游模型，多对用逗号隔开。若不需要请直接留空。",
      placeholder: "chat-main=gpt-4o, claude-3-5-sonnet=gpt-4o",
      defaultValue: "",
    })
    const modelMappings: Record<string, string> = {}
    if (mappingsInput && mappingsInput.trim()) {
      for (const pair of mappingsInput.split(",")) {
        const [k, v] = pair.split("=").map((s) => s.trim())
        if (k && v) {
          modelMappings[k] = v
        }
      }
    }

    let selectedGroupId = groups[0].id
    if (groups.length > 1) {
      const gChoice = await Dialog.actionSheet({
        title: "6. 选择所属分组",
        actions: groups.map((g) => ({ label: g.name })),
      })
      if (gChoice !== null) {
        selectedGroupId = groups[gChoice].id
      }
    }

    // 加密 API Key
    const sealedKey = await store.cipher.seal(apiKey.trim())

    const newAccount: Account = {
      id: id(),
      name: name.trim(),
      endpoint: endpoint.trim(),
      api_key: sealedKey,
      models,
      model_mappings: modelMappings,
      group_ids: [selectedGroupId],
      rpm: 0,
      concurrency: 0,
      priority: 0,
      enabled: true,
      protocols: ["responses", "compact", "chat", "anthropic"],
    }

    await store.updateConfig((cfg) => {
      cfg.accounts.push(newAccount)
    })

    await loadData()

    await Dialog.alert({
      title: "创建成功",
      message: `上游账号「${name}」已添加！`,
    })
  }

  const handleToggleAccount = async (acc: Account) => {
    await store.updateConfig((cfg) => {
      const target = cfg.accounts.find((a) => a.id === acc.id)
      if (target) {
        target.enabled = !target.enabled
      }
    })
    await loadData()
  }

  const handleDeleteAccount = async (acc: Account) => {
    const confirm = await Dialog.confirm({
      title: "删除账号",
      message: `确定要删除上游账号「${acc.name}」吗？`,
      confirmLabel: "删除",
      cancelLabel: "取消",
    })
    if (!confirm) return

    await store.updateConfig((cfg) => {
      cfg.accounts = cfg.accounts.filter((a) => a.id !== acc.id)
    })
    await loadData()
  }

  const handleTestAccount = async (acc: Account) => {
    try {
      const rawKey = await store.cipher.unseal(acc.api_key)
      let testUrl = acc.endpoint.replace(/\/+$/, "")
      if (!testUrl.endsWith("/v1")) testUrl += "/v1"
      testUrl += "/models"

      const start = Date.now()
      const res = await fetch(testUrl, {
        headers: {
          Authorization: `Bearer ${rawKey}`,
        },
      })
      const latency = Date.now() - start

      if (res.ok) {
        await Dialog.alert({
          title: "连接测试成功",
          message: `HTTP ${res.status} OK\n耗时: ${latency}ms\n已成功连通上游模型接口！`,
        })
      } else {
        await Dialog.alert({
          title: "连接测试失败",
          message: `上游返回 HTTP ${res.status}\n耗时: ${latency}ms`,
        })
      }
    } catch (e: any) {
      await Dialog.alert({
        title: "连接测试异常",
        message: e?.message || String(e),
      })
    }
  }

  const getGroupName = (acc: Account) => {
    const gNames = acc.group_ids
      .map((gid) => groups.find((g) => g.id === gid)?.name)
      .filter(Boolean)
    return gNames.length > 0 ? gNames.join(", ") : "未分组"
  }

  const getRuntimeStatus = (acc: Account) => {
    const r = store.runtime.getRuntime(acc.id)
    const current = Math.floor(Date.now() / 1000)
    if (r.cooldown_until > current) {
      return `冷却中 (剩余 ${r.cooldown_until - current}s)`
    }
    if (r.active > 0) {
      return `活跃: ${r.active}`
    }
    return "正常"
  }

  return (
    <List
      navigationTitle="上游账号管理"
      toolbar={{
        topBarTrailing: (
          <Button title="添加账号" action={handleCreateAccount} />
        ),
      }}
    >
      <Section
        header={<Text>已配置的上游账号</Text>}
        footer={<Text>多账号按优先级排序自动故障转移；支持 Chat、Messages、Responses 等多种协议。</Text>}
      >
        {accounts.length === 0 ? (
          <Text>暂无上游账号，请点击右上角添加。</Text>
        ) : (
          accounts.map((acc) => (
            <VStack key={acc.id} alignment="leading" spacing={6}>
              <HStack>
                <Text attributedString={`**${acc.name}**`} />
                <Button
                  title={acc.enabled ? "已启用" : "已停用"}
                  action={() => handleToggleAccount(acc)}
                />
              </HStack>
              <Text>端点: {acc.endpoint}</Text>
              <HStack>
                <Text>分组: {getGroupName(acc)}</Text>
                <Text>优先级: {acc.priority}</Text>
                <Text>状态: {getRuntimeStatus(acc)}</Text>
              </HStack>
              <Text>
                模型({acc.models.length}): {acc.models.slice(0, 3).join(", ")}
                {acc.models.length > 3 ? "..." : ""}
              </Text>
              <HStack spacing={12}>
                <Button title="测试连通" action={() => handleTestAccount(acc)} />
                <Button title="删除账号" action={() => handleDeleteAccount(acc)} />
              </HStack>
            </VStack>
          ))
        )}
      </Section>
    </List>
  )
}
