# 寒霜注入工具 (Hanshuang Inject Tool)

> 本地提示词注入与网关代理工具（Scripting 版）

- **作者**: vcncv
- **版本**: v1.2.3
- **环境**: iOS / iPadOS Scripting App

---

## 📖 项目简介

寒霜注入工具是专为 iOS Scripting 环境打造的本地提示词注入、人物卡管理与网关代理工具。v1.2.0 重磅升级基于 `node:net` 的原生 TCP 真流式引擎与三模式后台保活（位置 / 音频 / 跟随应用），彻底解决 Swifter 框架下的缓冲问题，实现打字机毫秒级逐字推流。

## ✨ 核心特性

1. **node:net 原生 TCP 真流式引擎（端口 5195）**
   - 突破 Swifter `HttpServer` 全包缓冲限制，直接由原生 TCP Socket 接管推流，设置 `socket.setNoDelay(true)` 绕过 Nagle 算法。
   - 独占监听 **5195** 端口，专门承载 `stream: true` 的 `/v1/chat/completions` SSE 推送，与 5190 主网关彻底解耦防死锁。
   - `Assistant.requestStreaming` 产出的每个 Token 毫秒级直达第三方客户端（Claude Code / Codex / NextChat 等）。

2. **本地主网关全协议服务（端口 5190）**
   - 原生常驻 `HttpServer`，提供 OpenAI / Claude / Scripting 全格式支持、模型列表发现、注入自检与控制台路由。

3. **三模式后台常驻与保活 (防系统休眠与杀死)**
   - **位置保活**：基于 `Location.startUpdatingLocation`（3km 省电精度 + 允许后台更新），在其他应用播放媒体/语音时绝不会被冲掉。
   - **音频保活**：基于 `BackgroundKeeper` 静音音频守护，锁屏常驻运行，状态栏无小箭头图标。
   - **跟随应用**：低功耗模式，切前台时自动拉起。
   - 配置实时持久化在 `data/keepalive-config.json`，支持原生 UI 动态切换与记忆。

2. **Scripting 深度注入与破甲验证**
   - 覆盖 Scripting 四大模型工作模式：智能体 Agent 模式、系统全局 Assistant 模式、脚本运行时 API 模式与本地网关代理模式。
   - 真实落地点注入：Assistant 全局规则 (`assistant-rules/`)、提示词模板 (`assistant-prompts/`)、Agent 核心人格 (`SOUL.md`)、长期记忆 (`MEMORY.md`) 与代码级破甲内核 (`armor_kernel.ts`)。
   - 提供 Custom Provider 网关一键装配 API，一键在 Scripting 中创建【寒霜破甲网关】并设为默认上游。
   - 深度集成 L3 判拒评分器（中文/英文软硬拒答特征检测、敏感标记拦截与标题门分析）。
   - 深度集成 L2 跨轮纠正循环（遇拒答自动重试纠正直至破甲）。
   - 提供专属 `/armor` 路由端点与自检测试套件。

3. **人物卡管理与提示词库**
   - 支持多种注入模式：`fill`、`prepend`、`append`、`override`。
   - 内置寒霜人物卡库与预设模板，支持一键切换、启用/停用与实时 Token 估算。

4. **自愈守护系统 (Self-Healer)**
   - 后台守护进程持续巡检，若注入点文件被篡改或文件标记丢失，自动自我修复恢复生效。

5. **双重交互界面**
   - **原生 SwiftUI 控制台**：实时监控服务状态、端口、自愈健康度与人物卡快捷切换。
   - **全屏 WebUI 交互面板**：基于 WebViewController 唤起完整的图形化管理界面。

---

## 📁 目录结构

```text
寒霜注入工具/
├── script.json            # 脚本元数据配置（作者: vcncv, 版本: 1.0.0）
├── index.tsx              # Scripting 原生入口与 SwiftUI 控制台视图
├── server.ts              # 本地 HttpServer、网关代理、自愈守护与 REST API 核心
├── test_runner.mjs        # 自动化测试与注入验证脚本
├── data/                  # 运行时数据目录与注入模板
│   ├── prompt-cards.json  # 角色卡数据存储
│   ├── armor_kernel.ts    # 破甲内核
│   ├── AGENTS.md
│   └── scripting-assistant-prompt.md
├── prompts/               # 内置寒霜提示词预设
│   ├── 寒霜v1.2.md
│   ├── 寒霜v3.md
│   ├── 寒霜v4.md
│   ├── 寒霜v4-claude.md
│   ├── 寒霜v5.md
│   └── 寒霜-变体B-v3-英文.md
└── dist/                  # 前端 WebUI 静态资源打包产物
    ├── index.html
    ├── tray-panel.html
    └── assets/
```

---

## 🔒 隐私与许可

本项目为私人仓库（Private Repository），仅限作者个人使用。
