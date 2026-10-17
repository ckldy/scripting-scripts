# LocalDNS for Scripting App

> **当前版本**：`v1.4.0 (Build 20261018)`  
> **移植作者**：`vcncv`  
> **上游开源**：[yyhoworks/LocalDNS](https://github.com/yyhoworks/LocalDNS)（对齐 UI `2026.10.17.2` / 内核 `FJG4Z`，集成跨平台模块引擎与流清洗架构）

将 [yyhoworks/LocalDNS](https://github.com/yyhoworks/LocalDNS)（Rust DNS 核心 + 双皮肤 Web 控制台）完整转换为适配 **iOS Scripting App** 的本地 DNS 与应用层流清洗服务系统。

---

## 鸣谢与致敬

| 开发者 | 负责内容 |
|---|---|
| **R 大（折腾日记交流群）** | **原版 DNS 核心架构，主要使用 Rust 编写** |
| **[yyhoworks](https://github.com/yyhoworks)** | **Web UI 设计、双皮肤体系（人文羊皮纸与流光毛玻璃）与前端交互系统** |
| **[@clone-fan](https://github.com/clone-fan)** | **通过 PR #1 贡献玻璃细节、交互动效、字体上传与数字动画修复** |
| **vcncv** | **面向 iOS Scripting 环境的纯 TypeScript 核心重构、双通道 DoH 服务端、Surge/Loon/QX 跨平台模块引擎、FakeIP 与 HLS/JSON 视频流清洗流水线、JS 沙箱运行时、原生仪表盘开发、实时脉冲监控与网络防死锁** |

---

## 核心特性

### 1. 本地 DNS 核心引擎 (TypeScript 原生实现)
- **RFC 1035 / 3596 二进制 DNS 编解码**：纯 TypeScript 实现，支持 A、AAAA、CNAME、PTR、SOA、TXT、HTTPS (SVCB) 等协议格式解析与打包。
- **DNS-over-HTTPS (DoH) 服务端**：在本地 `http://127.0.0.1:9099/dns-query` 与 `https://127.0.0.1:9443/dns-query` 提供双通道 DoH 接口，支持 POST（二进制 wire format）与 GET（base64url 格式）。
- **多上游并发竞速**：支持国内组 (`domestic`)、国外组 (`foreign`)、国外 ECS 组 (`foreign_ecs`) 和代理组 (`proxy`) 的多节点并发请求与最快采纳（Winner 统计）。
- **四级缓存池 (`CacheManager`)**：包含核心缓存、国内缓存、国外缓存与国外 ECS 缓存；支持动态 TTL 递减与过期缓存回退（Stale-while-revalidate）。
- **AdGuard 广告拦截引擎 (`AdGuardEngine`)**：支持 AdGuard 规则语法（`||domain^`、`@@` 白名单例外）与 Hosts 语法拦截，支持多订阅源在线更新与 18.5 万条过滤规则开箱即用。
- **多维度分流路由器 (`DiversionEngine`)**：涵盖名单管理（白名单/黑名单/灰名单/强制 RealIP/重定向 Rewrite/MITM 劫持）与在线分流（自定义 CN/Non-CN、Geosite CN/Non-CN），支持同组来源合并去重。

### 2. 跨平台模块引擎与应用层流清洗 (Surge / Loon / Quantumult X)
- **统一模块规范解析器 (`ModuleParser`)**：
  - 自动识别并解析 **Surge 模块 (`.sgmodule`)**、**Loon 插件 (`.plugin`)** 与 **Quantumult X 重写 (`.conf`)**；
  - 提取 `[MITM] hostname`（支持通配符与负向排除名单，如 `-excluded.domain.com`）；
  - 提取 `[URL Rewrite]` 与重写指令（`reject`、`reject-200`、`reject-img`、`reject-dict`、`302/307 redirect`）；
  - 提取 `[Script]` 定义，解析请求/响应事件类型、正则匹配模式、脚本路径与超时设置。
- **FakeIP 虚拟地址池 (`FakeIpPool`)**：
  - 符合 RFC 2544 规范的 `198.18.0.0/15` 保留地址池分配器；
  - 命中已启用模块 MITM 列表的域名自动由 DNS 路由器分配 FakeIP，并将流量引导至本地处理管线；
  - 支持 FakeIP 与原始域名双向高频秒级反查与幂等复用。
- **HLS M3U8 清单清洗与 JSON 广告递归剪枝 (`StreamCleaner`)**：
  - **HLS M3U8 流清洗**：流式剥离 Twitch/Kick/通用 SSAI 中的 `#EXT-X-DATERANGE:ID="stitched-ad..."` 广告段、`#EXT-X-TWITCH-PREFETCH` 预取切片以及 `ad_segment` TS 分片，并自动去重连续断流标记 `#EXT-X-DISCONTINUITY`；
  - **播放器 JSON 剪枝**：深度递归遍历视频元数据与播放器 API 响应，剔除 YouTube 的 `adPlacements`、`playerAds`、`adSlots` 与 `videostatsPlaybackUrl` 等追踪项，彻底抹除前贴片、中插和暂停广告。
- **兼容多协议规范的 JavaScript 沙箱运行时 (`ScriptSandbox`)**：
  - 提供兼容 Surge / Loon / Quantumult X 规范的沙箱执行上下文；
  - 完整注入 `$request`、`$response`（包含 `status`/`statusCode`、`headers` 与 `body`）、`$done()`；
  - 模拟支持 `$httpClient`（GET/POST/PUT/DELETE/HEAD）、`$persistentStore`（本地持久化键值对）、`$notification` 与 QX `$prefs` / `$notify`；
  - 支持超时自动熔断降级放行，保证网络高可用。

### 3. 100% 契约对齐的 LocalDNS REST API & Prometheus 指标
- 服务端提供与原 FJG20 后端完全一致的 API：
  - `/api/v1/status`: 运行状态、版本、上游健康度、拦截指标、模块状态与 FakeIP 池统计
  - `/api/v1/modules/*`: 模块列表、在线导入、开关切换、更新与统计
  - `/api/v1/modules/clean-stream`: 在线流清洗能力测试
  - `/api/v1/modules/execute-script`: 沙箱脚本实时执行测试
  - `/api/v1/modules/fakeip/*`: FakeIP 动态分配与反查接口
  - `/api/v1/upstream/*`: 上游节点配置查询与修改、ECS 配置、分组管理
  - `/api/v1/audit/*`: 审计开关、日志容量配置、清空日志
  - `/api/v2/audit/*`: 详细查询日志检索、多条件筛选、分页、客户端/域名排行
  - `/plugins/*`: 8 类策略开关状态读写、AdGuard 订阅更新、分流数据统计、多级缓存查看与清空
  - `/metrics`: 标准 Prometheus 文本格式导出（含 QPS、缓存命中率、延迟分布与上游节点健康度）

### 4. 双端统一交互界面
- **iOS 原生仪表盘 (`index.tsx`)**：
  - 服务启停与端口显示；
  - 核心指标实时卡片（累计查询、拦截请求、缓存命中率、平均延迟、活跃设备、追踪域名）；
  - **跨平台模块与视频流清洗专区**：展示激活模块数、MITM 域名数、流清洗次数与 FakeIP 分配量，内置 YouTube 视频流切片阻断与 Twitch M3U8 流清洗一键实测；
  - 5 大核心策略快捷开关（广告拦截、核心缓存、过期缓存、IPv6 屏蔽、请求屏蔽）；
  - 本地 DNS 实时解析测试工具（实时查看解析耗时、命中策略、所属上游组与返回 IP）。
- **内嵌全功能双皮肤 Web 控制台 (UI 2026.10.17.2)**：
  - 一键在原生 `WebViewController` 中弹出完整的 Web 控制台，支持**双皮肤无刷新即时切换**：
    - **「人文羊皮纸 · Claude」**：温润象牙色底纸、深炭墨色、赤陶红与鼠尾草绿，自带宣纸纤维肌理层，提供 5 款预设色调与纸张肌理/温润层次调节；
    - **「流光毛玻璃 · 原版」**：深空暖金、极光深海等 5 组光影预设、本地壁纸 IndexedDB 存储与模糊度/遮盖度/暗化遮罩调节；
  - 顶栏快捷「流光」开关直接控制拓扑粒子动画，支持偏好记忆；
  - 包含本地字体（Noto Serif SC、Instrument Serif、IBM Plex Mono/Sans）与浏览器本地字体上传；
  - 强化两级实时脉冲监控（秒级运行时长精确跳动，2秒轻量更新 CPU 与真实 RSS 内存）；
  - 图例排版防溢出加固与 6:6 宽幅黄金比例布局。

---

## 目录结构

```text
LocalDNS/
├── script.json             # Scripting 脚本配置元数据 (v1.4.0)
├── index.tsx               # iOS 原生仪表盘入口 & 模块/流清洗状态卡片
├── web/                    # 完整玻璃质感 Web 控制台静态资源
│   ├── index.html
│   ├── config.js
│   └── assets/
│       ├── css/            # app.css, console.css, skin-claude.css, material.css 等
│       ├── js/             # app.js, console.js, skin.js, appearance.js, topology-flow.js 等
│       ├── fonts/          # noto-serif-sc, ibm-plex-mono, instrument-serif
│       └── img/            # logo 与背景纹理
├── src/
│   ├── types.ts            # 全局 TypeScript 接口定义
│   ├── globals.d.ts        # Scripting 运行时全局类型声明
│   ├── dns-packet.ts       # 二进制 DNS 报文 Parser 与 Serializer
│   ├── store.ts            # 持久化存储与配置管理器 (基于 Scripting Storage)
│   ├── cache.ts            # 四级缓存池管理
│   ├── adguard.ts          # AdGuard 规则与广告拦截引擎
│   ├── diversion.ts        # 名单与 SRS 分流引擎 (支持 MITM FakeIP 路由)
│   ├── audit.ts            # 查询审计日志与 Prometheus metrics 生成器
│   ├── resolver.ts         # DNS 核心解析器与并发上游竞速调度器
│   ├── server.ts           # HttpServer 服务端、DoH 处理、模块 API 与代理管道
│   ├── modules/            # 【新增】跨平台模块引擎
│   │   ├── types.ts        # 统一 CleanModule 与 Rewrite/Script 契约
│   │   ├── parser.ts       # Surge / Loon / Quantumult X 统一解析转换器
│   │   └── module-manager.ts # 模块在线下载、存储持久化与 MITM 匹配分发
│   ├── mitm/               # 【新增】中间人与 FakeIP
│   │   ├── fakeip.ts       # 198.18.0.0/15 地址池分配与反查
│   │   └── proxy-handler.ts # HTTP/HTTPS 代理处理与流清洗流水线
│   ├── stream/             # 【新增】流清洗流水线
│   │   └── cleaner.ts      # HLS M3U8 清单标签剥离与 JSON 递归深度剪枝
│   └── runtime/            # 【新增】JS 异步沙箱
│       └── sandbox.ts      # Surge/Loon/QX 标准兼容的 JS 脚本执行器
└── tools/
    ├── generate-cert.sh    # CA 根证书与 PKCS#12 自动化签发脚本
    ├── test-suite.ts       # 核心服务全量回归验证套件 (39 项测试)
    └── test-modules-suite.ts # 跨平台模块引擎与流清洗自动化测试套件 (55 项测试)
```

---

## 在 iOS 上配置使用本地 DNS

启动 LocalDNS 脚本后，服务采用**双通道共生架构**运行：
- **HTTP 端口 9099**：纯净管理控制台与通用 DoH（`http://127.0.0.1:9099/dns-query`，零证书门槛，浏览器秒开）；
- **HTTPS 端口 9443**：Surge 专用的安全 TLS 1.3 DoH 接口（`https://127.0.0.1:9443/dns-query`）。

您可以根据您的使用场景任选一种方式将网络流量引流至 LocalDNS：

---

### 方式 1：Surge 专属 HTTPS 原生 DoH 接管 (强烈推荐)

Surge 的 `doh-server` 严格遵循 RFC 8484 规范，必须使用 HTTPS。LocalDNS 已内置由本地 CA 签发的专用 TLS 证书（带 `127.0.0.1` 与 `localhost` SAN 扩展，严格符合 Apple <= 825 天安全限制）：

#### 第 1 步：安装并完全信任 LocalDNS CA 根证书
1. 启动 LocalDNS，在原生仪表盘中点击 **「① 安装 CA 根证书」**（会自动调用 Safari 下载 `http://127.0.0.1:9099/ui/ca.crt`）；
2. 前往 iOS **「设置」➔「已下载的描述文件」**，点击安装 **LocalDNS Root CA**；
3. **【关键核心步骤】前往 iOS「设置」➔「通用」➔「关于本机」➔「证书信任设置」**，找到 **LocalDNS Root CA** 并勾选为**完全信任**！

#### 第 2 步：在 Surge 配置文件中添加配置（纠正为 127.0.0.1 纯 IP，含防死锁规则）
打开 Surge，在配置文件的文本模式下，添加以下内容（或在 LocalDNS 界面一键点击 **「② 复制 Surge 专属 DoH 配置」**）：
```ini
[General]
# 官方标准 HTTPS DoH 接口 (直接使用 127.0.0.1 纯 IP，端口 9443，彻底免除域名解析失败)
doh-server = https://127.0.0.1:9443/dns-query
# 放行本地回环，防止代理回路
skip-proxy = 127.0.0.1, localhost, *.local, 192.168.0.0/16

[Rule]
# 核心防死锁规则（必须放在规则最顶端！）：放行公共 DNS，避免单机 TUN 循环等待
IP-CIDR,223.5.5.5/32,DIRECT,no-resolve
IP-CIDR,119.29.29.29/32,DIRECT,no-resolve
```
保存并重新加载 Surge 配置，所有网络流量瞬间全部通过 LocalDNS 进行解析，控制台数字实时跳动！

#### 证书重新生成与轮换
如果证书过期或需要重签，可随时进行重新生成：
- **方式 A（界面一键）**：在 LocalDNS 原生仪表盘中点击 **「重新生成 CA 证书」**，服务会自动热重载新证书；
- **方式 B（终端脚本）**：在终端执行 `sh tools/generate-cert.sh` 即可一键重新生成全套证书与 PKCS#12 文件。
- 重新生成后，再次点击「安装 CA 根证书」并在系统设置中信任即可。

---

### 方式 2：Shadowrocket（小火箭·全手机免证书一秒接管·最推荐）
小火箭原生支持明文 HTTP DoH，完全不需要安装任何证书：
1. 打开小火箭 ➔ 底部 **「设置」➔「DNS」➔「DNS 覆写」**；
2. 填入：`http://127.0.0.1:9099/dns-query`；
3. 开启小火箭开关即可全局生效！

---

### 方式 3：局域网设备（电脑 / Mac / 电视盒子）
在同一局域网的电脑 Chrome / Edge 浏览器中：
- 进入 **「设置」➔「隐私和安全」➔「安全」➔ 开启「使用安全 DNS」**；
- 选择「自定义」，填入：`http://<当前手机IP>:9099/dns-query` 即可！

---

## 控制台访问

- **在 Scripting 内部**：点击仪表盘上的 **「打开玻璃质感 Web 控制台」**，即可在应用内无缝全屏使用。
- **在外部浏览器**：点击 **「Safari 打开」**，或在任意浏览器访问 `http://127.0.0.1:9099/ui/`。
