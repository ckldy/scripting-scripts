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

  const handleEditCustomInstruction = async (grp: Group) => {
    const instruction = await Dialog.prompt({
      title: `自定义策略 - ${grp.name}`,
      message: "输入要注入的自定义系统提示词 (system/instructions)。填写后将最高优先级注入，留空则使用内置策略库。",
      placeholder: "如：你是一个专业助手，请始终使用中文回答...",
      defaultValue: grp.custom_instruction || "",
    })
    if (instruction === null) return

    await store.updateConfig((cfg) => {
      const target = cfg.groups.find((g) => g.id === grp.id)
      if (target) {
        target.custom_instruction = instruction.trim() || undefined
      }
    })
    await loadData()
    await Dialog.alert({
      title: "策略更新",
      message: instruction.trim() ? "已成功设置自定义 Prompt 策略！" : "已清除自定义策略，恢复使用内置策略库与兜底规则。",
    })
  }

  const handleEditGroupName = async (grp: Group) => {
    const newName = await Dialog.prompt({
      title: "修改分组名称",
      message: "请输入新的分组名称",
      defaultValue: grp.name,
    })
    if (!newName || !newName.trim()) return

    await store.updateConfig((cfg) => {
      const target = cfg.groups.find((g) => g.id === grp.id)
      if (target) {
        target.name = newName.trim()
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
    const profileActions = [
      { label: `🌟 一键绑定当前分类全部 (${targetProfiles.length} 款)` },
      { label: `❌ 一键解绑当前分类全部` },
      ...targetProfiles.map((p) => {
        const bound = grp.profile_ids.includes(p.id)
        return {
          label: `${bound ? "✅ 已绑定" : "➕ 未绑定"}: ${p.name}`,
        }
      }),
    ]

    const selectedIdx = await Dialog.actionSheet({
      title: `预设管理 (当前分组: ${grp.name})`,
      actions: profileActions,
    })
    if (selectedIdx === null) return

    if (selectedIdx === 0) {
      // 一键绑定全部
      await store.updateConfig((cfg) => {
        const target = cfg.groups.find((g) => g.id === grp.id)
        if (target) {
          const currentSet = new Set(target.profile_ids)
          targetProfiles.forEach((p) => currentSet.add(p.id))
          target.profile_ids = Array.from(currentSet)
        }
      })
      await loadData()
      await Dialog.alert({
        title: "批量绑定完成",
        message: `已将「${families[famChoice].name}」下的 ${targetProfiles.length} 款策略全部绑定至当前分组！`,
      })
      return
    }

    if (selectedIdx === 1) {
      // 一键解绑全部
      await store.updateConfig((cfg) => {
        const target = cfg.groups.find((g) => g.id === grp.id)
        if (target) {
          const toRemove = new Set(targetProfiles.map((p) => p.id))
          target.profile_ids = target.profile_ids.filter((id) => !toRemove.has(id))
        }
      })
      await loadData()
      await Dialog.alert({
        title: "批量解绑完成",
        message: `已从当前分组解除「${families[famChoice].name}」下的策略绑定！`,
      })
      return
    }

    const chosenProfile = targetProfiles[selectedIdx - 2]
    const currentBound = grp.profile_ids.includes(chosenProfile.id)

    const opIdx = await Dialog.actionSheet({
      title: `${chosenProfile.name} (${chosenProfile.model_family})`,
      message: `适配模型: ${chosenProfile.models.join(", ")}`,
      actions: [
        { label: currentBound ? "❌ 从分组解绑此策略" : "✅ 绑定此策略至分组" },
        { label: "🔍 查看提示词指令前段" },
      ],
    })
    if (opIdx === null) return

    if (opIdx === 0) {
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
        title: "状态更新",
        message: `已更新预设「${chosenProfile.name}」的绑定状态！`,
      })
    } else if (opIdx === 1) {
      const snippet = (chosenProfile.instruction || "").slice(0, 500)
      await Dialog.alert({
        title: `${chosenProfile.name} 指令预览`,
        message: snippet + ((chosenProfile.instruction || "").length > 500 ? "\n\n...(余下内容已省略)" : ""),
      })
    }
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
                  title={grp.default_strategy_enabled ? "兜底策略: 开" : "兜底策略: 关"}
                  action={() => handleToggleDefaultStrategy(grp)}
                />
              </HStack>
              <Text>
                通用兜底 (Astra机制): {grp.default_strategy_enabled ? "已开启 (无专属匹配时生效)" : "已关闭"}
              </Text>
              <Text>
                自定义策略: {grp.custom_instruction ? `已设置 (${grp.custom_instruction.length} 字，最高优先级)` : "未设置 (使用预设库)"}
              </Text>
              <Text>
                已绑定专有预设: {grp.profile_ids.length} / 36 款
              </Text>
              <HStack spacing={10}>
                <Button title="绑定预设" action={() => handleConfigureProfiles(grp)} />
                <Button title="自定义Prompt" action={() => handleEditCustomInstruction(grp)} />
                <Button title="重命名" action={() => handleEditGroupName(grp)} />
                <Button title="删除" action={() => handleDeleteGroup(grp)} />
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
