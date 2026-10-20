# ZakoProxy for Scripting

> **当前版本**：`v1.4.1`  
> **作者**：`vcncv`  
> **来源架构**：基于 [ckldy/ZakoProxyCLI](https://github.com/ckldy/ZakoProxyCLI) 核心移植，视觉界面参考 [yyhoworks/LocalDNS](https://github.com/yyhoworks/LocalDNS) 流光毛玻璃架构深度定制。

为 iOS / iPadOS **Scripting App** 打造的高性能自托管 AI API 中转、模型策略注入与多账号容灾网关，内置 **双模流光毛玻璃 Web 控制台（Liquid Glassmorphism WebUI）**、SwiftUI 风格原生仪表盘、多维分层智能 Prompt 提示词注入引擎、SQLite WAL 存储、服务秒级热重启与 Web Crypto AES-256-GCM 凭据加密体系。

---

## 🌟 核心特性

### 1. 流光毛玻璃 Web 控制台 (Liquid Glassmorphism WebUI)
参考 LocalDNS 视觉设计规范打造的次时代 Web 控制台，前后端完全解耦，支持三种使用场景：
- **iOS 原生全屏内嵌**：通过 `WebViewController` 全屏呈现，具备 `viewport-fit=cover` 视口适配与硬件级 GPU 渲染，与 iOS 系统质感浑然一体；
- **Safari / 移动端浏览器**：直接访问 `http://127.0.0.1:1990/ui/`，自适应底部晶透 TabBar；
- **局域网多设备协作**：同一 Wi-Fi 下的电脑或平板可直接访问当前手机 IP，将 iPhone 化身为局域网 AI 代理调度中心。

#### 视觉与交互特性：
- **深浅双模主题**：支持 `dark-glass`（暗黑晶透）与 `light-glass`（明亮雪白）一键无缝热切换。
- **四大流光背景预设**：
  - `Cosmos`：宇宙金蓝流光（默认）；
  - `Aurora`：碧蓝极光流动；
  - `Emerald`：翡翠水透质感；
  - `Obsidian`：黑曜石沉稳暗夜。
- **实时指标时序可视化**：集成 Chart.js，提供 24 小时请求量与 Token 消耗双轴平滑曲线图。
- **上游账号健康雷达**：秒级展示各账号的当前实时并发数、累计请求数、连续失败数与冷却熔断倒计时。
- **动态连通性测速**：在 Web 界面一键触发上游端点 `/models` 探测，毫秒级测量往返延迟。
- **36 款专属策略速查抽屉**：可视化翻阅各模型家族的 System Instruction 提示词指令。
- **审计日志深度筛选**：支持按模型名、状态码、协议、Cyber 特征多维过滤，点击弹出单条请求调用链路明细。

---

### 2. 全协议原生中转与流式转发
- **OpenAI Chat Completions**：`POST /v1/chat/completions`，支持多轮对话、Function / Tool Calls、多模态以及 SSE 流式响应（按 SSE 格式完整回传；受 Scripting `HttpServer` 不支持边到边流式写入的限制，实际会在上游生成完毕后一次性下发）。
- **长响应完整转发 (v1.4.1)**：正常响应只做密钥脱敏，**不再套用 2KB 错误摘要截断**，完整保留 `data: [DONE]` 与全部 SSE 分片。
- **Anthropic Messages**：`POST /v1/messages`，原生保持 Anthropic 消息结构与工具定义，支持 `x-api-key` 鉴权与 `anthropic-version` 透传。
- **Responses / Compact**：`POST /v1/responses`、`POST /v1/responses/compact`。
- **模型发现列表**：`GET /v1/models`，根据客户端 API Key 所属分组，动态聚合该分组下全部启用账号的模型与有效别名映射。
- **健康检查**：`GET /health`。

---

### 3. 内置 36 款针对性 Prompt 预设与分层多维智能匹配引擎 (v1.4.0 注入机制修复)
- **通道修饰后缀解构与 Base Model 提取**：
  - 针对实际中转站与多渠道常见的多样化修饰后缀（如 `-high`, `-low`, `-medium`, `-tiered`, `-extra`, `-thinking`, `-preview`, `-latest`, `-agent`, `-image`, `-chat` 等），自动解构并提取出对应的 **Base Model**（如 `openai/gemini-3.8-flash-high` 自动解构出 `gemini-3.8-flash`）；
  - 自动剥离日期后缀（如 `-20241022`, `-0731`）与微版本号（如 `-v1`, `-v2`）。
- **多维打分引擎与同家族混淆彻底消除**：
  - 针对同一模型家族内的不同细分子型号（如 `gemini-3.8-flash` vs `gemini-3-flash`，`claude-opus-4-6` vs `claude-sonnet-4-6`），提取模型核心版本特征进行加权打分；
  - 基础模型精确匹配赋予 850 高分，杜绝了绑定的某一子型号策略无脑劫持同家族其他互斥模型的严重隐患；
  - 未绑定精确策略的同家族模型平滑回退至 Astra 通用兜底，杜绝误注入。
- **全透明请求日志审计**：
  - 每次请求调用均在 SQLite 审计日志与前端展示中记录策略决策明细（`strategy_type`: 自定义/预设/兜底/无，`profile_name`, `matched_model`）；
  - Web 控制台审计日志表格与详情抽屉、iOS 原生日志列表均可秒级查看注入了哪款 Prompt、命中哪个特征。
- **全协议多形态请求体安全合并与防重入**：
  - **Anthropic 协议**：若客户端已有 `system`（无论是字符串还是 ContentBlock 数组），均安全前置合并并防止重复追加；
  - **OpenAI Chat 协议**：**关键修复**——将预设注入到**最后一条 `user` 消息**内容首部（带高优先级分隔标记与幂等去重）。因为许多上游适配层（尤其 Gemini 逆向类）会丢弃 `system` 角色，而 `user` 内容必定转发，从而确保预设真正送达并被模型采纳；若不存在 user 消息才退回 system 首条；
  - **Responses / Compact 协议**：安全合并至 `instructions` / `instruction` 字段。
- **逐请求策略可见性 (v1.4.0 新增)**：代理响应头新增 `X-Zako-Strategy` / `X-Zako-Profile` / `X-Zako-Matched-Model` / `X-Zako-Version`，任意客户端或抓包工具均可即时确认本次请求实际生效的预设策略与版本。
- **36 款针对性模型 Profile 矩阵**：
  - **Claude (14款)**：`claude-opus-5-5`, `claude-sonnet-4-6`, `claude-haiku-4-5` 等
  - **DeepSeek (6款)**：包含汉霜 (Hanshuang) 与 DSH purge API 适配器完整集成
  - **Gemini (7款)**：`gemini-3.1-pro`, `gemini-3-flash`, `gemini-3.1-flash-image`, `gemini-3.8-flash` 等
  - **GPT 5.6 / 6 (3款)**：`gpt-5.6-sol-v45`, `gpt-6-astra-v2-rc1` 等
  - **Kimi (4款破限)**：`kimi-k2-code`, `kimi-k2.5-code`, `kimi-k2.7-code`, `kimi-k2-plus`
  - **GLM / Grok (2款)**：`glm-5.3`, `grok-4.7`

---

### 4. 服务秒级热重启与版本自省 (v1.4.0 增强)
- **热重启接口**：支持 `POST /api/system/restart` 异步热重启，自动保持当前活动端口无缝重新载入路由与内存策略；
- **多端一键交互**：
  - Web 控制台：侧边栏内核状态底栏、设置页网络表单均提供晶透的「热重启服务」一键按钮；
  - iOS 原生控制台：仪表盘服务控制栏直接提供「重启」按钮，修改端口后提示一键重启生效；
- **全系统版本自省统一**：`/api/system`、`/health`、页面 UI（顶栏品牌徽标、侧栏内核状态、设置页「关于与版本信息」卡片、浏览器标题）统一展示动态自省版本号 `v1.4.1`。

---

### 4. 多账号管理与高可用故障转移 (Failover)
- **优先级路由与并发/RPM 准入**：支持为账号配置优先级（数字越小越优先）、并发上限与 RPM 限制。
- **故障转移与自适应重试**：当上游账号遇到网络异常或 `401/403/408/429/5xx` 时，系统自动在保持原始请求的前提下，重新进行模型映射与策略计算，并无缝重试下一个可用账号。
- **熔断与冷却机制**：账号连续失败达到阈值（默认 2 次）后自动触发冷却熔断（默认 60 秒），冷却期内自动避开该账号。

---

### 5. 灵活的模型别名映射
- 支持在账号中配置客户端请求模型到真实上游模型的映射关系（例如 `chat-main` 映射至 `gpt-4o`）。
- 客户端既可以直接使用真实模型名，也可以使用自定义别名。

---

### 6. 本地安全加密存储
- **SQLite WAL 模式存储**：配置、账号、密钥与请求日志完整保存在本地 SQLite 数据库中。
- **AES-256-GCM 凭据加密**：所有上游 API Key 在本地均通过独有的 `master.key` 进行 AES-256-GCM 高度加密存储，密钥绝不以明文留存。
- **代理 Key SHA-256 哈希鉴权**：系统对外发放的 `sk-...` 客户端密钥仅保存哈希散列，并自动进行日志脱敏。
- **静态资源防目录穿越 (v1.4.1)**：`/ui/*` 请求经路径归一化校验，`..`、反斜杠与 NUL 一律 404，避免 `master.key` / `zako.db` 被直接下载。
- **安全响应头 (v1.4.1)**：统一返回 `Content-Security-Policy`、`X-Frame-Options: DENY`、`X-Content-Type-Options: nosniff`、`Referrer-Policy: no-referrer`。
- **管理接口不返回密钥密文 (v1.4.1)**：`/api/accounts` 仅返回 4+4 位掩码与 `has_api_key`；`/api/*` 不再开放跨域，仅 AI 代理端点保留 CORS。
- **账号分组必选 (v1.4.1)**：WebUI 账号弹窗新增分组多选与必选校验，避免新建账号因 `group_ids` 为空而永远不被选中。

---

## 🛠️ 后端 REST API 体系 (`/api/*`)

ZakoProxy 内置了前后端解耦的 RESTful 架构，共提供 20 个轻量级服务接口：

| 方法 | 路由 | 说明 |
| :--- | :--- | :--- |
| `GET` | `/api/system` | 获取当前服务运行状态、监听端口、运行时长与组件数量 |
| `GET` | `/api/stats` | 获取 7 天统计、24 小时吞吐时序分桶、账号运行时健康度 |
| `GET` | `/api/accounts` | 获取上游账号列表（API Key 严格掩码脱敏并附带并发数据） |
| `POST` | `/api/accounts` | 添加上游账号（密钥经 Web Crypto AES-256-GCM 本地加密保存） |
| `PUT` | `/api/accounts/:id` | 修改上游账号配置 |
| `DELETE` | `/api/accounts/:id` | 删除指定上游账号 |
| `POST` | `/api/accounts/:id/test` | 连通性快速探测（发起真实上游 `/models` 握手并测延迟） |
| `GET` | `/api/keys` | 获取客户端 API Key 列表（含所属分组） |
| `POST` | `/api/keys` | 生成新密钥（返回一次性明文用于复制，本地留存 SHA-256 哈希） |
| `PATCH` | `/api/keys/:id` | 快速启用 / 禁用指定 API Key |
| `DELETE` | `/api/keys/:id` | 删除指定 API Key |
| `GET` | `/api/groups` | 获取分组列表及所绑定的 Profile IDs |
| `POST` | `/api/groups` | 创建新分组 |
| `PUT` | `/api/groups/:id` | 修改分组属性与默认策略开关 |
| `DELETE` | `/api/groups/:id` | 删除分组 |
| `GET` | `/api/profiles` | 枚举 36 款内置针对性模型 Prompt 策略摘要与指令快照 |
| `GET` | `/api/settings` | 读取容灾重试、超时、熔断与保留周期设置 |
| `PUT` | `/api/settings` | 热更新网络层参数 |
| `GET` | `/api/logs` | 分页查询审计请求日志（支持多维复合过滤） |
| `DELETE` | `/api/logs` | 清空请求审计日志 |

---

## 🚀 快速上手与客户端配置

### 1. 运行方式
在 Scripting App 中点击 **ZakoProxy** 脚本：
1. 首次启动会自动初始化本地 SQLite 数据库与默认分组。
2. 在控制台点击 **「启动服务」**，代理服务即在本地 `127.0.0.1:1990` 开启监听。
3. 点击 **「✨ 打开全屏毛玻璃控制台」**，即可进入高颜值的流光 Web 界面；或者在浏览器中打开 `http://127.0.0.1:1990/ui/`。
4. 在控制台点击 **「API 密钥」** -> **「创建新密钥」**，生成并复制客户端 Key。
5. 在 **「上游账号」** 中添加你的 OpenAI / DeepSeek / Claude 或中转端点，系统使用 AES-256 自动保护密钥。
6. 退出脚本时，可选择 **「在后台保持运行 (最小化)」**，代理服务将在后台持续提供服务。

### 2. 常用客户端接入配置

| 配置项 | 填写内容 |
| :--- | :--- |
| **API 端点 (BaseURL)** | `http://127.0.0.1:1990/v1` |
| **API 密钥 (API Key)** | 控制台中创建的 `sk-...` |

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
├── script.json         # 脚本元数据描述符 (v1.4.1)
├── index.tsx           # 脚本主入口、SwiftUI 原生仪表盘与 WebViewController 挂载
├── test-webui-e2e.ts   # 25 项全链路自动化端到端测试用例
├── README.md           # 项目使用与配置文档
├── src/
│   ├── types.ts        # 核心数据接口定义
│   ├── profiles.ts     # 36 款内置 Prompt 预设与默认策略库
│   ├── store.ts        # SQLite 持久化、AES-256 加密与运行时状态管理
│   ├── proxy.ts        # 代理转发引擎（别名映射、Prompt 注入、故障转移与日志脱敏）
│   ├── server.ts       # 本地 HttpServer 中间件路由与静态资源调度
│   ├── api.ts          # 20 个前后端解耦的控制台 RESTful 接口
│   └── ui/             # 原生 SwiftUI 交互界面组件
│       ├── DashboardView.tsx   # 仪表盘主控台与 WebUI 唤起入口
│       ├── AccountsView.tsx    # 上游账号管理
│       ├── GroupsView.tsx      # 分组与 Prompt 策略配置
│       ├── KeysView.tsx        # 客户端 API Key 发放与管理
│       ├── LogsView.tsx        # 实时请求调用日志与使用量明细
│       └── SettingsView.tsx    # 端口、重试轮次与熔断设置
└── web/                # 流光毛玻璃 Web 控制台静态资源
    ├── index.html      # 控制台 SPA 骨架
    └── assets/
        ├── css/
        │   └── glass.css       # 流光壁纸、毛玻璃层叠样式与暗黑/明亮双主题
        ├── js/
        │   ├── app.js          # WebUI 前端核心业务、REST API 联动与轮询
        │   └── chart.umd.min.js# Chart.js 本地离线时序图表引擎
        └── img/
            └── logo.png        # 晶透 Logo 图标
```
