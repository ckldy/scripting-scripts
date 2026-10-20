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
import type { ZakoServer } from "../server"
import type { Store } from "../store"
import { now } from "../store"
import type { Config, RequestLog } from "../types"
import { AccountsView } from "./AccountsView"
import { GroupsView } from "./GroupsView"
import { KeysView } from "./KeysView"
import { LogsView } from "./LogsView"
import { SettingsView } from "./SettingsView"

declare class WebViewController {
  constructor(options?: { ephemeral?: boolean })
  loadURL(url: string): Promise<boolean>
  present(options?: { fullscreen?: boolean; navigationTitle?: string }): Promise<void>
  dispose(): void
}

declare namespace Safari {
  function openURL(url: string): Promise<void>
}

interface DashboardViewProps {
  store: Store
  server: ZakoServer
  onDismiss: () => void
}

type SubViewType = "none" | "keys" | "accounts" | "groups" | "logs" | "settings"

export function DashboardView({ store, server, onDismiss }: DashboardViewProps) {
  const [subView, setSubView] = useState<SubViewType>("none")
  const [serverRunning, setServerRunning] = useState(server.isRunning)
  const [serverPort, setServerPort] = useState(server.activePort || 1990)
  const [stats, setStats] = useState({
    totalRequests: 0,
    successRate: 100,
    inputTokens: 0,
    outputTokens: 0,
    cachedTokens: 0,
    avgLatency: 0,
    cyberCount: 0,
  })
  const [configSummary, setConfigSummary] = useState({
    keysCount: 0,
    accountsCount: 0,
    groupsCount: 0,
  })

  const loadData = async () => {
    try {
      const cfg = await store.getConfig()
      setConfigSummary({
        keysCount: cfg.keys?.length || 0,
        accountsCount: cfg.accounts?.length || 0,
        groupsCount: cfg.groups?.length || 0,
      })

      // 统计最近 7 天日志
      const recentLogs = await store.logs(now() - 7 * 86400, now() + 60)
      if (recentLogs.length > 0) {
        let inTok = 0
        let outTok = 0
        let cacheTok = 0
        let latTotal = 0
        let succCount = 0
        let cyber = 0

        for (const l of recentLogs) {
          inTok += l.usage?.input_tokens || 0
          outTok += l.usage?.output_tokens || 0
          cacheTok += l.usage?.cached_tokens || 0
          latTotal += l.latency_ms || 0
          if (l.status >= 200 && l.status < 300) succCount++
          if (l.cyber) cyber++
        }

        setStats({
          totalRequests: recentLogs.length,
          successRate: Math.round((succCount / recentLogs.length) * 100),
          inputTokens: inTok,
          outputTokens: outTok,
          cachedTokens: cacheTok,
          avgLatency: Math.round(latTotal / recentLogs.length),
          cyberCount: cyber,
        })
      } else {
        setStats({
          totalRequests: 0,
          successRate: 100,
          inputTokens: 0,
          outputTokens: 0,
          cachedTokens: 0,
          avgLatency: 0,
          cyberCount: 0,
        })
      }
    } catch {}
  }

  useEffect(() => {
    loadData()
  }, [subView])

  const handleToggleServer = async () => {
    if (server.isRunning) {
      server.stop()
      setServerRunning(false)
      await Dialog.alert({ title: "服务已停止", message: "本地代理服务已停止监听。" })
    } else {
      const cfg = await store.getConfig()
      const port = cfg.settings?.port || 1990
      const res = server.start(port)
      if (res.success) {
        setServerRunning(true)
        setServerPort(res.port || port)
        await Dialog.alert({
          title: "服务已启动",
          message: `本地代理已成功运行在端口 :${res.port}！`,
        })
      } else {
        await Dialog.alert({
          title: "启动失败",
          message: res.error || "无法启动服务，可能端口被占用",
        })
      }
    }
  }

  const handleCopyBaseUrl = async () => {
    const url = `http://127.0.0.1:${serverPort}/v1`
    await Pasteboard.setString(url)
    await Dialog.alert({
      title: "已复制 BaseURL",
      message: `${url}\n\n可直接粘贴到 NextChat、ChatBox、OpenCat 等客户端的 API 地址中。`,
    })
  }

  const ensureServerRunning = async (): Promise<number | null> => {
    if (!server.isRunning) {
      const cfg = await store.getConfig()
      const port = cfg.settings?.port || 1990
      const res = server.start(port)
      if (res.success) {
        setServerRunning(true)
        setServerPort(res.port || port)
        return res.port || port
      } else {
        await Dialog.alert({
          title: "启动失败",
          message: res.error || "无法自动启动本地服务",
        })
        return null
      }
    }
    return server.activePort || serverPort
  }

  const handleOpenGlassConsole = async () => {
    const port = await ensureServerRunning()
    if (!port) return
    const webView = new WebViewController()
    try {
      await webView.loadURL(`http://127.0.0.1:${port}/ui/`)
      await webView.present({
        fullscreen: true,
        navigationTitle: "ZakoProxy 流光毛玻璃控制台",
      })
    } finally {
      webView.dispose()
      loadData()
    }
  }

  const handleOpenInSafari = async () => {
    const port = await ensureServerRunning()
    if (!port) return
    if (typeof Safari !== "undefined" && Safari.openURL) {
      await Safari.openURL(`http://127.0.0.1:${port}/ui/`)
    }
  }

  const handleCopyWebUiUrl = async () => {
    const port = await ensureServerRunning()
    if (!port) return
    const url = `http://127.0.0.1:${port}/ui/`
    await Pasteboard.setString(url)
    await Dialog.alert({
      title: "已复制 Web 控制台地址",
      message: `${url}\n\n您可以在 Safari 或局域网其他设备中直接访问。`,
    })
  }

  // 子视图路由呈现
  if (subView === "keys") {
    return (
      <VStack>
        <HStack>
          <Button title="← 返回控制台" action={() => setSubView("none")} />
        </HStack>
        <KeysView store={store} />
      </VStack>
    )
  }
  if (subView === "accounts") {
    return (
      <VStack>
        <HStack>
          <Button title="← 返回控制台" action={() => setSubView("none")} />
        </HStack>
        <AccountsView store={store} />
      </VStack>
    )
  }
  if (subView === "groups") {
    return (
      <VStack>
        <HStack>
          <Button title="← 返回控制台" action={() => setSubView("none")} />
        </HStack>
        <GroupsView store={store} />
      </VStack>
    )
  }
  if (subView === "logs") {
    return (
      <VStack>
        <HStack>
          <Button title="← 返回控制台" action={() => setSubView("none")} />
        </HStack>
        <LogsView store={store} />
      </VStack>
    )
  }
  if (subView === "settings") {
    return (
      <VStack>
        <HStack>
          <Button title="← 返回控制台" action={() => setSubView("none")} />
        </HStack>
        <SettingsView
          store={store}
          onPortChange={(p) => {
            setServerPort(p)
          }}
        />
      </VStack>
    )
  }

  const formatTokens = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
    return String(n)
  }

  return (
    <List
      navigationTitle="ZakoProxy 控制台"
      toolbar={{
        topBarTrailing: <Button title="完成" action={onDismiss} />,
      }}
    >
      {/* 1. 服务控制与运行状态 */}
      <Section
        header={<Text>服务状态</Text>}
        footer={<Text>支持 OpenAI / Chat Completions, Anthropic Messages 及 Responses 协议。</Text>}
      >
        <HStack>
          <VStack alignment="leading" spacing={4}>
            <Text attributedString={serverRunning ? "**🟢 代理服务运行中**" : "**⚪ 服务已停止**"} />
            <Text>监听地址: 127.0.0.1:{serverPort}</Text>
          </VStack>
          <Button
            title={serverRunning ? "停止服务" : "启动服务"}
            action={handleToggleServer}
          />
        </HStack>

        <HStack>
          <VStack alignment="leading" spacing={2}>
            <Text attributedString="**接口 BaseURL**" />
            <Text>http://127.0.0.1:{serverPort}/v1</Text>
          </VStack>
          <Button title="复制地址" action={handleCopyBaseUrl} />
        </HStack>
      </Section>

      {/* 2. 流光毛玻璃 Web 控制台入口 (对齐 LocalDNS) */}
      <Section
        header={<Text>流光毛玻璃 Web 控制台</Text>}
        footer={<Text>参考 LocalDNS 视觉架构设计，提供深浅双模流光毛玻璃、实时吞吐双轴图表与上游健康雷达。</Text>}
      >
        <HStack>
          <VStack alignment="leading" spacing={2}>
            <Text attributedString="**✨ 打开全屏毛玻璃控制台**" />
            <Text>内置原生全屏 WebViewController 晶透呈现</Text>
          </VStack>
          <Button title="进入控制台" action={handleOpenGlassConsole} />
        </HStack>

        <HStack>
          <VStack alignment="leading" spacing={2}>
            <Text attributedString="**🌐 Safari / 局域网访问**" />
            <Text>http://127.0.0.1:{serverPort}/ui/</Text>
          </VStack>
          <HStack spacing={6}>
            <Button title="在浏览器打开" action={handleOpenInSafari} />
            <Button title="复制" action={handleCopyWebUiUrl} />
          </HStack>
        </HStack>
      </Section>

      {/* 2. 核心调用指标统计 */}
      <Section header={<Text>近 7 天调用指标看板</Text>}>
        <HStack>
          <VStack alignment="leading" spacing={2}>
            <Text>总请求数</Text>
            <Text attributedString={`**${stats.totalRequests} 次**`} />
          </VStack>
          <VStack alignment="leading" spacing={2}>
            <Text>请求成功率</Text>
            <Text attributedString={`**${stats.successRate}%**`} />
          </VStack>
          <VStack alignment="leading" spacing={2}>
            <Text>平均响应</Text>
            <Text attributedString={`**${stats.avgLatency}ms**`} />
          </VStack>
        </HStack>

        <HStack>
          <VStack alignment="leading" spacing={2}>
            <Text>输入 Tokens</Text>
            <Text attributedString={`**${formatTokens(stats.inputTokens)}**`} />
          </VStack>
          <VStack alignment="leading" spacing={2}>
            <Text>输出 Tokens</Text>
            <Text attributedString={`**${formatTokens(stats.outputTokens)}**`} />
          </VStack>
          <VStack alignment="leading" spacing={2}>
            <Text>缓存 Tokens</Text>
            <Text attributedString={`**${formatTokens(stats.cachedTokens)}**`} />
          </VStack>
        </HStack>

        {stats.cyberCount > 0 ? (
          <HStack>
            <Text attributedString={`**⚡ Cyber 特征命中计数: ${stats.cyberCount} 次**`} />
          </HStack>
        ) : null}
      </Section>

      {/* 3. 核心功能菜单导航 */}
      <Section header={<Text>管理模块</Text>}>
        <HStack>
          <VStack alignment="leading" spacing={2}>
            <Text attributedString="**🔑 API 密钥管理**" />
            <Text>已创建 {configSummary.keysCount} 个代理 Key，用于外部客户端鉴权</Text>
          </VStack>
          <Button title="进入" action={() => setSubView("keys")} />
        </HStack>

        <HStack>
          <VStack alignment="leading" spacing={2}>
            <Text attributedString="**🌐 上游账号管理**" />
            <Text>已配置 {configSummary.accountsCount} 个上游账号，包含自动故障转移与映射</Text>
          </VStack>
          <Button title="进入" action={() => setSubView("accounts")} />
        </HStack>

        <HStack>
          <VStack alignment="leading" spacing={2}>
            <Text attributedString="**👥 分组与 Prompt 策略**" />
            <Text>内置 36 款专属模型预设与 Astra 通用执行策略</Text>
          </VStack>
          <Button title="进入" action={() => setSubView("groups")} />
        </HStack>

        <HStack>
          <VStack alignment="leading" spacing={2}>
            <Text attributedString="**📜 请求调用日志**" />
            <Text>实时查看近期请求明细、耗时、状态码及使用量</Text>
          </VStack>
          <Button title="进入" action={() => setSubView("logs")} />
        </HStack>

        <HStack>
          <VStack alignment="leading" spacing={2}>
            <Text attributedString="**⚙️ 系统与故障转移设置**" />
            <Text>端口、重试轮次、熔断冷却及日志保留参数</Text>
          </VStack>
          <Button title="进入" action={() => setSubView("settings")} />
        </HStack>
      </Section>
    </List>
  )
}
