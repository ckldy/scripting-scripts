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
import { PROFILES } from "../profiles"
import type { Group, Profile } from "../types"

interface GroupsViewProps {
  store: Store
}

export function GroupsView({ store }: GroupsViewProps) {
  const [groups, setGroups] = useState<Group[]>([])
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null)
  const [loading, setLoading] = useState(true)

  const loadData = async () => {
    try {
      const cfg = await store.getConfig()
      setGroups(cfg.groups || [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  const handleCreateGroup = async () => {
    const name = await Dialog.prompt({
      title: "新建分组",
      message: "请输入分组名称（如：生产组 / 尝鲜组）",
      placeholder: "例如：VIP分组",
      defaultValue: `分组 ${groups.length + 1}`,
    })
    if (!name || !name.trim()) return

    const newGroup: Group = {
      id: id(),
      name: name.trim(),
      profile_ids: [],
      default_strategy_enabled: true,
    }

    await store.updateConfig((cfg) => {
      cfg.groups.push(newGroup)
    })

    await loadData()
  }

  const handleToggleDefaultStrategy = async (grp: Group) => {
    await store.updateConfig((cfg) => {
      const target = cfg.groups.find((g) => g.id === grp.id)
      if (target) {
        target.default_strategy_enabled = !target.default_strategy_enabled
      }
    })
    await loadData()
  }

  const handleDeleteGroup = async (grp: Group) => {
    const confirm = await Dialog.confirm({
      title: "删除分组",
      message: `确定要删除分组「${grp.name}」吗？`,
      confirmLabel: "删除",
      cancelLabel: "取消",
    })
    if (!confirm) return

    await store.updateConfig((cfg) => {
      cfg.groups = cfg.groups.filter((g) => g.id !== grp.id)
    })
    await loadData()
  }

  const handleConfigureProfiles = async (grp: Group) => {
    // 弹窗展示预设模型列表并可快速勾选/解除
    const families = [
      { name: "全部", filter: () => true },
      { name: "Claude (14款)", filter: (p: Profile) => p.model_family === "claude" },
      { name: "DeepSeek (6款含汉霜/DSH)", filter: (p: Profile) => p.model_family === "deepseek" },
      { name: "Gemini (7款)", filter: (p: Profile) => p.model_family === "gemini" },
      { name: "GPT 5.6/6 (3款)", filter: (p: Profile) => p.model_family.startsWith("gpt") },
      { name: "Kimi (4款破限)", filter: (p: Profile) => p.model_family === "kimi" },
      { name: "GLM / Grok (2款)", filter: (p: Profile) => ["glm", "grok"].includes(p.model_family) },
    ]

    const famChoice = await Dialog.actionSheet({
      title: "选择要配置的预设分类",
      actions: families.map((f) => ({ label: f.name })),
    })
    if (famChoice === null) return

    const targetProfiles = PROFILES.filter(families[famChoice].filter)
    const profileActions = targetProfiles.map((p) => {
      const bound = grp.profile_ids.includes(p.id)
      return {
        label: `${bound ? "✅ 已绑定" : "➕ 未绑定"}: ${p.name}`,
      }
    })

    const selectedIdx = await Dialog.actionSheet({
      title: `点击切换绑定状态 (当前分组: ${grp.name})`,
      actions: profileActions,
    })
    if (selectedIdx === null) return

    const chosenProfile = targetProfiles[selectedIdx]
    await store.updateConfig((cfg) => {
      const target = cfg.groups.find((g) => g.id === grp.id)
      if (target) {
        if (target.profile_ids.includes(chosenProfile.id)) {
          target.profile_ids = target.profile_ids.filter((id) => id !== chosenProfile.id)
        } else {
          target.profile_ids.push(chosenProfile.id)
        }
      }
    })

    await loadData()
    await Dialog.alert({
      title: "设置更新",
      message: `已更新预设「${chosenProfile.name}」的绑定状态！`,
    })
  }

  return (
    <List
      navigationTitle="分组与 Prompt 策略"
      toolbar={{
        topBarTrailing: (
          <Button title="新建分组" action={handleCreateGroup} />
        ),
      }}
    >
      <Section
        header={<Text>已配置的分组</Text>}
        footer={<Text>分组用于隔离账号与 Key，并挂载特定的提示词注入策略。包含 36 款内置主流模型 Profile 及默认 Astra 执行策略。</Text>}
      >
        {groups.length === 0 ? (
          <Text>暂无分组，请点击右上角新建。</Text>
        ) : (
          groups.map((grp) => (
            <VStack key={grp.id} alignment="leading" spacing={6}>
              <HStack>
                <Text attributedString={`**${grp.name}**`} />
                <Button
                  title={grp.default_strategy_enabled ? "默认策略: 开" : "默认策略: 关"}
                  action={() => handleToggleDefaultStrategy(grp)}
                />
              </HStack>
              <Text>
                默认策略 (Astra通用执行机制): {grp.default_strategy_enabled ? "已开启 (当无专有预设匹配时生效)" : "已关闭"}
              </Text>
              <Text>
                已绑定专有预设数: {grp.profile_ids.length} 个 (共 36 个内置可用)
              </Text>
              <HStack spacing={12}>
                <Button title="选择/绑定预设 (36款)" action={() => handleConfigureProfiles(grp)} />
                <Button title="删除分组" action={() => handleDeleteGroup(grp)} />
              </HStack>
            </VStack>
          ))
        )}
      </Section>

      <Section header={<Text>内置 Prompt 策略库说明</Text>}>
        <VStack alignment="leading" spacing={4}>
          <Text attributedString="**🎯 默认策略 (profiles/default.md)**" />
          <Text>
            基于 Astra 任务执行机制，针对全协议通用自适应，去除固定身份与输出格式限制。
          </Text>
        </VStack>
        <VStack alignment="leading" spacing={4}>
          <Text attributedString="**⚡ 36 款针对性专有预设**" />
          <Text>
            包含 Claude 14 款、DeepSeek 6 款(含汉霜+DSH purge)、Gemini 7 款、GPT 3 款、Kimi 4 款破限、GLM 5.3 与 Grok。当匹配到对应实际模型时优先注入。
          </Text>
        </VStack>
      </Section>
    </List>
  )
}
