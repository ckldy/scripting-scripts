# LocalDNS for Scripting App

> **当前版本**：`v1.5.0 (Build 20261018)`  
> **移植作者**：`vcncv`  
> **上游开源**：[yyhoworks/LocalDNS](https://github.com/yyhoworks/LocalDNS)（对齐 UI `2026.10.17.2` / 内核 `FJG4Z`，实现原生零外挂纯净去广告闭环：深度集成 Scripting 系统级 VPN 隧道、Apple 原生加密 DNS 描述文件、本地 MITM 切片流清洗引擎与 9099/9443 双端口对称代理）

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

### 2. 原生零外挂纯净闭环与应用层流清洗 (v1.5.0 重大升级)
- **原生零外挂纯净去广告闭环 (v1.5.0 首创)**：
  - **核心痛点突破**：以往流清洗与切片去广告必须在外部代理软件（如 Surge / Loon）中挂载复杂模块，导致用户产生“既然本地有引擎为什么还要装外挂软件”的困扰。v1.5.0 彻底推倒外部依赖，打造 **100% 本地原生闭环**！
  - **Scripting 原生全局 VPN 隧道**：深度调用 Scripting 系统级 `VPN` API（`VPN.getState()`, `VPN.start()`, `VPN.stop()`），在 iOS 原生仪表盘与 Web 控制台提供一键开关。连接后全手机网络流量直接由系统内核级虚拟网卡流经本地，切片清洗与域名过滤由 LocalDNS 内部直接执行；
  - **Apple 官方原生加密 DNS 描述文件 (`/localdns.mobileconfig`)**：一键生成并下载遵循 iOS 14+ 官方标准的 `com.apple.dnsSettings.managed` 配置文件，由苹果操作系统内核直接驱动本地 9443 DoH 服务，后台零额外耗电、免开任何代理工具，全局阻断 18.5 万条广告；
  - **本地原生模块直接执行中心**：LocalDNS 原生加载并执行 Surge 模块、Loon 插件与 QX 重写规则，直接在本地中间件与 `ProxyHandler` 流水线中生效，外部客户端仅作为可选导出备用；
- **9099 (HTTP) 与 9443 (HTTPS) 双端口全功能对称生效 (v1.4.8)**：
  - **双端口对称共生架构**：本地 HTTP 9099 端口与 HTTPS 9443 端口底层共享同一套中间件流水线与规则引擎，支持全功能对等运作；
  - **HTTP/HTTPS 代理双通道接管**：客户端既可使用免证书的明文 HTTP 代理节点（`LocalDNS-Proxy = http, 127.0.0.1, 9099`），也可使用带 TLS 加密的安全 HTTPS 代理节点（`LocalDNS-Proxy-TLS = https, 127.0.0.1, 9443, skip-cert-verify=true`）；
  - **绝对 URL 自动嗅探增强**：全面支持 `http://`、`https://` 以及 `/https://...` 格式的代理请求解析，自动识别请求来源端口协议，无论是明文还是 TLS 密文均可无缝重定向、Mock、Header/Body 篡改与切片清洗；
  - **双通道 DoH 与 Web 控制台**：`http://127.0.0.1:9099/dns-query` 与 `https://127.0.0.1:9443/dns-query` 完全对称生效，共享四级缓存池与 AdGuard 过滤状态；`http://127.0.0.1:9099/ui/` 与 `https://127.0.0.1:9443/ui/` 均可访问毛玻璃 Web 控制台；
  - **动态模块链接自适应**：Web 控制台与原生仪表盘自适应当前访问端口与协议，一键调起安装至 Surge/Loon；
- **Surge / Loon / QX 模块一键动态编译与客户端挂载 (v1.4.7)**：
  - **核心机制打通**：YouTube、B站等现代视频平台全面采用 HTTPS 加密传输，纯 DNS 只能拦截外链广告域名，无法解密并修改视频切片或播放器 JSON。必须由 Surge、Loon、Quantumult X 等客户端执行 HTTPS MITM 解密；
  - **本地动态编译端点**：提供 `/localdns.sgmodule`、`/localdns.plugin`、`/localdns.conf` 实时导出接口，将 LocalDNS 内存中所有激活的 MITM 主机名与重写规则编译为标准客户端配置；
  - **双端一键挂载**：在 Web 控制台与 iOS 原生仪表盘提供「一键安装至 Surge」、「一键安装至 Loon」协议调起按键与直链复制，一秒完成客户端模块挂载；
- **YouTube 15 条强力重写规则与流清洗强化**：
  - 预置重写规则扩充至 15 条，全面阻断 `videoplayback?oad=1` 广告切片、拦截 `api/stats/ads`、`api/stats/atr`、`api/stats/playback`、`api/stats/watchtime` 与 `ptracking`，覆盖 `www`、`m` 及 `music.youtube.com`；
  - 针对 YouTube 播放器 JSON 响应中的 `playerResponse` 嵌套结构进行递归剪枝，彻底抹除 `adPlacements`、`adBreakHeartbeatParams` 与 `adPlacementConfig`；
- **YouTube / Google 广告域名深度阻断与 CDN 分流寻址修复**：
  - **广告与追踪域名强力黑洞化**：在内置 AdGuard 规则库中加入 `s.youtube.com`, `s2.youtube.com`, `ads.youtube.com`, `video-stats.l.google.com`, `pagead2.googlesyndication.com` 等 YouTube 专属广告与打点域名，确保 DNS 查询 100% 立即阻断并返回 `0.0.0.0`，从源头消灭前贴片广告请求；
  - **视频 CDN 分流逻辑纠正**：修正了 `diversion.ts` 中一刀切将 `googlevideo.com` 等视频流域名误劫持为 `198.18.0.x` FakeIP 的缺陷。在标准 DNS 模式下，合法视频流域名正常返回真实上游海外 CDN IP，保证客户端建立直连通道，避免因 FakeIP 未建连导致的播放器重试与广告降级回退；仅在用户显式开启 `switch2` 客户端 FakeIP 时按需分配；
  - **YouTube 模块规则与流清洗强化**：预置 9 条 YouTube 专属重写规则，全面阻断 `videoplayback?oad=1` 广告切片、拦截 `api/stats/ads` 与 `api/stats/atr`，并针对 YouTube 播放器 JSON 响应中的 `playerResponse` 嵌套结构进行递归剪枝，彻底抹除 `adPlacements` 与广告插槽；
- **9099 端口标准透明 HTTP 代理与绝对 URL 自动嗅探**：
  - 本地 HTTP 9099 端口具备双重工作模式：既是 Web 质感控制台与明文 DoH 服务端，又是标准透明 HTTP 代理服务器；
  - 自动识别客户端发来的绝对代理请求（`GET http://...`）或透明宿主请求（通过 `Host` 头部嗅探），无缝交由 `ProxyHandler` 流水线进行重定向、Mock、Header/Body 篡改与流清洗；
  - 完美兼容 Surge、Loon、Shadowrocket 等代理工具的 `http, 127.0.0.1, 9099` 本地节点对接与 iOS Wi-Fi 代理手动配置。
- **开箱即用的全网主流视频去广告规则库**：
  - **Bilibili 纯净视频与开屏秒开 (`preset_bilibili`)**：拦截开屏广告（`/x/v2/splash`）、信息流推广（`/x/v2/feed/index`）、视频中插推荐（`/x/v2/ad/*`）与搜索广场推广；
  - **全网通用视频广告 SDK 桩代码 (`preset_universal_video_sdk`)**：本地 Mock 模拟完整的 Google IMA3 (`ima3.js`) SDK，派发 `ALL_ADS_COMPLETED` 与 `COMPLETE` 事件欺骗播放器跳过广告等待；同时预置爱奇艺 (`/player/info` 空广告数组)、优酷、腾讯视频与芒果 TV 去广告规则；
  - **YouTube 纯净视频切片阻断与流清洗 (`preset_youtube`)**：剥离 `videoplayback?adformat=1` 广告切片、剪枝 `adPlacements`；
  - **Twitch 直播 SSAI 广告切片清洗 (`preset_twitch`)**：流式剥离 M3U8 中的 DATERANGE 广告段与预取切片。
- **查询日志 HTTP 重写实时审计追踪 (`renderHttpRewriteLogs`)**：
  - 在 Web 控制台“查询日志”页面新增 **「HTTP 重写日志」** 专属选项卡，与 DNS 查询日志无缝切换；
  - 顶部呈现重写运行体征面板（已截获/总请求数、重定向/Mock 数、Header/Body 替换数、静态阻断数、视频流清洗数、平均处理延迟）；
  - 支持按动作类型（重定向、Mock、Header修改、Body替换、拟真阻断、流清洗）、截获状态（已截获/直接透传）、URL/域名关键词多条件过滤；
  - 提供审计详情抽屉，透视时间、方法、主机、客户端 IP、状态码、处理耗时、执行动作、命中规则、匹配正则与完整请求 URL；
  - 支持一键清空重写审计日志与 `/api/v1/rewrites/logs` REST API 导出。
- **规则管理 HTTP 重写多维度筛选与搜索栏 (`renderRewrites`)**：
  - 在“HTTP 重写”列表视图新增多维度筛选工具栏：
    - 支持按规则名称、正则 Pattern、重写目标、备注说明进行实时模糊搜索；
    - 支持按动作类型筛选（全部/302重定向/Mock响应/Header替换删除/Body替换/静态拟真阻断）；
    - 支持按规则来源筛选（全部/自定义规则/模块内置规则）；
    - 支持按启用状态筛选（全部/仅生效中/仅已停用）；
  - 动态显示匹配条数，支持一键重置筛选条件；
  - 在 Web 控制台“规则管理”新增 **「HTTP 重写」** 专区，支持双视图一键无缝切换：
    - **可视化列表视图**：展示动作标签（重定向/Mock/Header/Body/Reject）、规则名称、匹配正则、目标参数、所属来源；支持单条规则独立启闭开关、编辑、推演与删除；
    - **纯文本编辑视图**：支持 Surge/Loon 标准语法直接批量查看、编辑、保存与下载自定义重写配置文本；
  - **单条重写规则编辑/新建弹窗 (`openRewriteModal`)**：
    - 提供经典预设模版一键载入（API 路径重定向、广告接口 Mock、伪装 User-Agent、删除敏感头、Body 广告开关替换、204 快速阻断等）；
    - 根据选择的动作动态切换参数表单，实时校验正则表达式合法性；
  - **HTTP 重写实时推演与在线测试器 (`openRewriteTestModal`)**：
    - 输入任意测试 URL 与请求方法，实时模拟重写匹配引擎；
    - 即时反馈命中规则、模拟返回状态码、重定向 Location、报文预览及执行动作，便于上线前精准排障；
  - 提供重写指标卡片（总规则数、已生效数、重定向/Mock 数、Header/Body 替换数、静态拟真阻断数、自定义规则数）。
- **核心功能策略开关 (`switch_mitm` & `switch_rewrite`)**：
  - 在 Web 控制台“功能开关”页面与 iOS 原生仪表盘中新增 **「MITM 流量接管」** 与 **「HTTP 重写引擎」** 独立控制项；
  - 关闭 `switch_mitm` 时，DNS 路由器自动绕过 FakeIP 劫持，恢复原始上游寻址；
  - 关闭 `switch_rewrite` 时，代理通道直接直连上游，不触发任何重定向、Mock 与切片剥离；
  - 双开关均支持实时热重载并持久化落盘，各策略互不干扰。
- **完善的高性能 HTTP 重写引擎 (`ProxyHandler`)**：
  - **正则捕获组重定向**：支持 `302 / 307` 路径捕获组映射（如 `^https?:\/\/api\.com\/user\/(.+) 302 https://newapi.com/u/$1`）；
  - **Mock 虚拟响应 (零网络开销)**：支持 `mock 200 {"code":0}` 与 `mock 204`，直接在本地截断返回虚拟报文，免去真实上游请求耗时；
  - **请求 Header 修改与剥离**：支持 `header-replace` 与 `header-del`，动态重写发往上游的 User-Agent、Token 或剔除敏感头；
  - **响应 Body 全局正则替换**：支持 `body-replace` / `response-body`，动态查找并替换响应文本内容；
  - **静态阻断合集**：支持 `reject`, `reject-200`, `reject-img` (1x1透明GIF), `reject-dict` (`{}`), `reject-array` (`[]`)。
- **规则管理模块导入入口 (`renderModules`)**：
  - 在 Web 控制台“规则管理”新增 **「模块管理 (Surge / Loon / QX)」** 选项卡；
  - 提供模块总览指标（激活模块、MITM 通配主机数、重写规则/脚本数、流清洗次数、FakeIP 占用）；
  - 支持一键快捷载入社区成熟去广告预设（YouTube 纯净流净化、Bilibili 全面去广告、Twitch SSAI 清洗、爱奇艺去广告等）；
  - 支持在线订阅 URL 输入与任意配置内容即时粘贴导入；
  - 提供模块规则详情深度查看弹窗（逐条查看已解析的 MITM 主机、URL 重写映射与 JS 沙箱脚本定义）；
  - 内置 **「视频流清洗实时测试器」**（一键填入 M3U8/JSON 测试样本，在线推演广告切片剥离效果）。
- **DNS 解析路径全分流动态交互视图 (`topology-dynamic-flow`)**：
  - 在 Web 控制台“运行概览”与“DNS 解析路径”拓扑增加全新动态工具栏；
  - **分流逻辑模式切换**：支持「全部全景」、「国内直连」、「国外无污染」、「视频流清洗/FakeIP」、「广告与安全拦截」5 大模式即时高亮与暗化过滤；
  - **域名动态推演器 (`runTopoTracer`)**：输入任意域名（或点击快捷药丸，如 YouTube 切片、哔哩哔哩、百度广告、GitHub 等），实时模拟并高亮全链路解析路径（客户端 ➔ 核心缓存 ➔ 匹配分流规则 ➔ 上游策略组 ➔ 最终节点/响应）；
  - **解析决策卡片**：展示域名命中的具体分流级别、执行动作（FakeIP 分配/本地黑洞阻断/国内竞速/海外无污染）以及返回的最优 IP 或虚拟地址；
  - **路径高亮流光联动**：拓扑粒子引擎自动沿着匹配的分流路径连续流动巡礼，清晰呈现分流决策全貌。
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
