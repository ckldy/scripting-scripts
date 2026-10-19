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
import { digest, id, now, token } from "../store"
import type { ApiKey, Config, Group } from "../types"

interface KeysViewProps {
  store: Store
}

export function KeysView({ store }: KeysViewProps) {
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [groups, setGroups] = useState<Group[]>([])
  const [loading, setLoading] = useState(true)

  const loadData = async () => {
    try {
      const cfg = await store.getConfig()
      setKeys(cfg.keys || [])
      setGroups(cfg.groups || [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  const handleCreateKey = async () => {
    if (groups.length === 0) {
      await Dialog.alert({
        title: "无法创建",
        message: "当前还没有任何分组，请先在分组管理中创建一个分组。",
      })
      return
    }

    const keyName = await Dialog.prompt({
      title: "创建 API Key",
      message: "请输入该 Key 的备注名称（例如：OpenCat / ChatBox）",
      placeholder: "例如：我的主力 Key",
      defaultValue: `Key ${keys.length + 1}`,
    })
    if (!keyName || !keyName.trim()) return

    let selectedGroupId = groups[0].id
    if (groups.length > 1) {
      const groupChoice = await Dialog.actionSheet({
        title: "选择该 Key 所属分组",
        actions: groups.map((g) => ({ label: g.name })),
      })
      if (groupChoice === null) return
      selectedGroupId = groups[groupChoice].id
    }

    // 生成 sk- 格式高熵密钥
    const rawSecret = token("sk-zako-")
    const hash = await digest(rawSecret)
    const prefix = rawSecret.slice(0, 16) + "..."

    const newKey: ApiKey = {
      id: id(),
      name: keyName.trim(),
      group_id: selectedGroupId,
      secret: "", // 不保存明文
      hash,
      prefix,
      enabled: true,
      created_at: now(),
    }

    await store.updateConfig((cfg) => {
      cfg.keys.push(newKey)
    })

    await loadData()

    // 复制生成的 Key
    await Pasteboard.setString(rawSecret)

    await Dialog.alert({
      title: "API Key 创建成功",
      message: `已自动复制到剪贴板！\n\n密钥：\n${rawSecret}\n\n⚠️ 请妥善保存，密钥仅在此处完整展示一次。`,
    })
  }

  const handleToggleKey = async (key: ApiKey) => {
    await store.updateConfig((cfg) => {
      const target = cfg.keys.find((k) => k.id === key.id)
      if (target) {
        target.enabled = !target.enabled
      }
    })
    await loadData()
  }

  const handleDeleteKey = async (key: ApiKey) => {
    const confirm = await Dialog.confirm({
      title: "删除 API Key",
      message: `确定要删除「${key.name}」吗？使用该 Key 的客户端将无法再访问。`,
      confirmLabel: "删除",
      cancelLabel: "取消",
    })
    if (!confirm) return

    await store.updateConfig((cfg) => {
      cfg.keys = cfg.keys.filter((k) => k.id !== key.id)
    })
    await loadData()
  }

  const getGroupName = (groupId: string) => {
    const g = groups.find((grp) => grp.id === groupId)
    return g ? g.name : "未分配"
  }

  const formatDate = (ts: number) => {
    const d = new Date(ts * 1000)
    return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`
  }

  return (
    <List
      navigationTitle="API 密钥管理"
      toolbar={{
        topBarTrailing: (
          <Button title="新建 Key" action={handleCreateKey} />
        ),
      }}
    >
      <Section header={<Text>已发放的 Proxy 密钥</Text>} footer={<Text>使用上述 Key 作为 Bearer 或 x-api-key 即可调用当前中转服务。</Text>}>
        {keys.length === 0 ? (
          <Text>暂无 API Key，请点击右上角新建。</Text>
        ) : (
          keys.map((k) => (
            <VStack key={k.id} alignment="leading" spacing={6}>
              <HStack>
                <Text attributedString={`**${k.name}**`} />
                <Button
                  title={k.enabled ? "已启用" : "已禁用"}
                  action={() => handleToggleKey(k)}
                />
              </HStack>
              <HStack>
                <Text>前缀: {k.prefix}</Text>
                <Text>分组: {getGroupName(k.group_id)}</Text>
                <Text>创建: {formatDate(k.created_at)}</Text>
              </HStack>
              <HStack>
                <Button
                  title="删除"
                  action={() => handleDeleteKey(k)}
                />
              </HStack>
            </VStack>
          ))
        )}
      </Section>
    </List>
  )
}
