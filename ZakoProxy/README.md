# ZakoProxy for Scripting

基于 [ckldy/ZakoProxyCLI](https://github.com/ckldy/ZakoProxyCLI) 完整架构移植的高性能、自托管 AI API 中转与提示词注入代理服务。

原生运行于 iOS / iPadOS 的 **Scripting** 运行时环境，提供轻量级本地 `HttpServer` 代理服务、SwiftUI 风格的原生控制台交互界面、SQLite WAL 持久化存储与 Web Crypto AES-256-GCM 凭据加密。

---

## 🌟 核心特性

### 1. 全协议原生中转与流式转发
- **OpenAI Chat Completions**：`POST /v1/chat/completions`，支持多轮对话、工具调用（Function/Tool Calls）、多模态内容及 SSE 流式响应。
- **Anthropic Messages**：`POST /v1/messages`，原生保持 Anthropic 消息结构与工具定义，支持 `x-api-key` 鉴权与 `anthropic-version` 透传。
- **Responses / Compact**：`POST /v1/responses`、`POST /v1/responses/compact`。
- **模型发现列表**：`GET /v1/models`，根据客户端 API Key 所属分组，动态聚合该分组下全部启用账号的模型与有效别名映射。
- **健康检查**：`GET /health`。

### 2. 内置 36 款针对性 Prompt 预设与 Astra 通用执行策略
- **36 款针对性模型 Profile**：
  - **Claude (14款)**：`claude-opus-5-5`, `claude-sonnet-4-6`, `claude-haiku-4-5` 等
  - **DeepSeek (6款)**：包含汉霜 (Hanshuang) 与 DSH purge API 适配器完整集成
  - **Gemini (7款)**：`gemini-3.1-pro`, `gemini-3-flash`, `gemini-3.1-flash-image` 等
  - **GPT 5.6 / 6 (3款)**：`gpt-5.6-sol-v45`, `gpt-6-astra-v2-rc1` 等
  - **Kimi (4款破限)**：`kimi-k2-code`, `kimi-k2.5-code`, `kimi-k2.7-code`, `kimi-k2-plus`
  - **GLM / Grok (2款)**：`glm-5.3`, `grok-4.7`
- **默认策略 (Astra General Task Execution)**：
  - 基于 Astra 任务执行与状态延续机制自适应全协议通用注入，去除固定身份与输出格式限制；当未匹配到专有预设且分组开启默认策略时自动生效。

### 3. 多账号管理与高可用故障转移 (Failover)
- **优先级路由与并发/RPM 准入**：支持为账号配置优先级（数字越小越优先）、并发上限与 RPM 限制。
- **故障转移与自适应重试**：当上游账号遇到网络异常或 `401/403/408/429/5xx` 时，系统自动在保持原始请求的前提下，重新进行模型映射与策略计算，并无缝重试下一个可用账号。
- **熔断与冷却机制**：账号连续失败达到阈值（默认 2 次）后自动触发冷却熔断（默认 60 秒），冷却期内自动避开该账号。

### 4. 灵活的模型别名映射
- 支持在账号中配置客户端请求模型到真实上游模型的映射关系（例如 `chat-main` 映射至 `gpt-4o`）。
- 客户端既可以直接使用真实模型名，也可以使用自定义别名。

### 5. 本地安全加密存储
- **SQLite WAL 模式存储**：配置、账号、密钥与请求日志完整保存在本地 SQLite 数据库中。
- **AES-256-GCM 凭据加密**：所有上游 API Key 在本地均通过独有的 `master.key` 进行 AES-256-GCM 高度加密存储，密钥绝不以明文留存。
- **代理 Key SHA-256 哈希鉴权**：系统对外发放的 `sk-zako-...` 客户端密钥仅保存哈希散列，并自动进行日志脱敏。

### 6. 原生 iOS 管理控制台与调用看板
- 提供服务启停开关与一键复制 BaseURL。
- 近 7 天调用看板：请求总数、成功率、平均耗时、输入/输出/缓存 Tokens 及 Cyber 审计特征命中统计。
- 账号、分组、API Key、调用日志查看与系统参数配置。

---

## 🚀 快速上手与客户端配置

### 1. 运行方式
在 Scripting App 中点击 **ZakoProxy** 脚本：
1. 首次启动会自动初始化本地 SQLite 数据库与默认分组。
2. 在控制台点击 **「启动服务」**，代理服务即在本地 `127.0.0.1:1990` 开启监听。
3. 点击 **「API 密钥管理」** -> **「新建 Key」**，系统会自动生成 `sk-zako-...` 并复制到剪贴板。
4. 点击 **「上游账号管理」** -> **「添加账号」**，填入你的 OpenAI / DeepSeek / Claude 或中转站真实端点与 API Key。
5. 退出页面时，可选择 **「在后台保持运行 (最小化)」**，代理服务将在后台持续提供服务。

### 2. 常用客户端接入配置

| 配置项 | 填写内容 |
| :--- | :--- |
| **API 端点 (BaseURL)** | `http://127.0.0.1:1990/v1` |
| **API 密钥 (API Key)** | 控制台中创建的 `sk-zako-...` |

#### 支持的常见客户端：
- **NextChat / ChatGPT-Next-Web**
- **ChatBox**
- **OpenCat**
- **LobeChat**
- **沉浸式翻译 (Immersive Translate)**
- **Bob / PopClip**
- 以及任何支持自定义 OpenAI / Anthropic 兼容端点的应用。

---

## 📂 项目结构

```
ZakoProxy/
├── script.json         # 脚本元数据描述符
├── index.tsx           # 脚本主入口与 SwiftUI 控制台容器
├── README.md           # 项目使用与配置文档
└── src/
    ├── types.ts        # 核心数据接口定义
    ├── profiles.ts     # 36 款内置 Prompt 预设与默认策略库
    ├── store.ts        # 数据持久化、AES-256 加密与运行时状态管理
    ├── proxy.ts        # 代理转发引擎（别名映射、Prompt 注入、故障转移与日志脱敏）
    ├── server.ts       # 本地 HttpServer 路由调度服务
    └── ui/             # 原生 SwiftUI 交互界面组件
        ├── DashboardView.tsx   # 仪表盘主控台与指标统计看板
        ├── AccountsView.tsx    # 上游账号管理
        ├── GroupsView.tsx      # 分组与 Prompt 策略配置
        ├── KeysView.tsx        # 客户端 API Key 发放与管理
        ├── LogsView.tsx        # 实时请求调用日志与使用量明细
        └── SettingsView.tsx    # 端口、重试轮次与熔断设置
```
