# Scripting 脚本仓库

Scripting (iOS) 小脚本合集。每个脚本独立目录、独立打包，互不影响。

## 📦 脚本列表

| 脚本 | 版本 | 说明 | 安装链接 |
|---|---|---|---|
| LocalDNS（本地 DNS 服务） | 1.5.1 | 本地 DNS 与原生流清洗系统，首创「零外挂软件纯净去广告闭环」：深度集成 Scripting 系统级 VPN 隧道一键接管、修复 Apple 官方原生加密 DNS 描述文件安装校验（内嵌 com.apple.security.root 根证书载荷与 FQDN 规范）、内置本地 MITM 与切片流清洗引擎（直接执行 Surge/Loon 模块与 QX 规则无需外部 App）、支持 9099 (HTTP) 与 9443 (HTTPS) 双端口全功能对称代理、强化 15 条 YouTube 切片阻断与全网通用视频 SDK 桩代码（作者 vcncv，致敬 yyhoworks/LocalDNS 与 R 大） | [安装](https://www.scripting.fun/import_scripts/?urls=%5B%22https%3A%2F%2Fraw.githubusercontent.com%2Fckldy%2Fscripting-scripts%2Fmain%2Fdist%2FLocalDNS.zip%22%5D) |
| 台风路径 | 2.3.1 | 实时台风路径、多机构预报与气象图层；主程序刷新后会同步重载用户小组件，大号组件地图缓存批处理仅重载一次 | [安装](https://www.scripting.fun/import_scripts/?urls=%5B%22https%3A%2F%2Fraw.githubusercontent.com%2Fckldy%2Fscripting-scripts%2Fmain%2Fdist%2F台风路径.zip%22%5D) |
| 黃豆短劇 | 1.2.0 | 浏览、搜索与收藏黃豆短劇内容，支持播放历史、剧集播放、上下滑切集与进度条 | [安装](https://www.scripting.fun/import_scripts/?urls=%5B%22https%3A%2F%2Fraw.githubusercontent.com%2Fckldy%2Fscripting-scripts%2Fmain%2Fdist%2F黃豆短劇.zip%22%5D) |
| NetRadio（网络收音机） | 1.0.1 | 全球 1000+ 公开网络电台（按 36 个国家/地区归类），黑胶唱机舞台、电平示波器、主题调色板与 iOS 原生后台/锁屏播控（基于 net-redio 移植，作者 vcncv） | [安装](https://www.scripting.fun/import_scripts/?urls=%5B%22https%3A%2F%2Fraw.githubusercontent.com%2Fckldy%2Fscripting-scripts%2Fmain%2Fdist%2FNetRadio.zip%22%5D) |
| 音乐大合集 | 1.0.0 | 多源聚合音乐播放器，支持 QQ/网易/酷狗/酷我/咪咕音源，经典与沉浸播放页窗口自适应、纯净无下划线歌词、多样式进度条与后台保活播放（作者 vcncv） | [安装](https://www.scripting.fun/import_scripts/?urls=%5B%22https%3A%2F%2Fraw.githubusercontent.com%2Fckldy%2Fscripting-scripts%2Fmain%2Fdist%2F%E9%9F%B3%E4%B9%90%E5%A4%A7%E5%90%88%E9%9B%86.zip%22%5D) |

## 📥 安装方法

1. 点击上表"安装"链接（https 网页），页面会生成 `scripting://import_scripts` 导入链接；
2. 在 Scripting 应用中打开该链接（或在浏览器复制链接，粘贴到 Scripting 的"导入脚本"）；
3. 确认导入即可，脚本出现在 Scripting 首页。

## 🌟 脚本功能详解与直链

### 🛡️ LocalDNS (本地 DNS 服务与流清洗管理系统)
- **版本**：`1.5.1` ｜ **作者**：`vcncv`（原案致敬 `yyhoworks/LocalDNS` 与 R 大）
- **特性**：
  - **原生零外挂纯净去广告闭环 (v1.5.1 重大升级)**：
    - **彻底推倒外部软件依赖**：直接在 LocalDNS 原生闭环实现全自动去广告，无需在手机上额外运行 Surge、Loon、小火箭等第三方外挂软件；
    - **Scripting 原生系统级 VPN 隧道**：深度调用 Scripting 原生 `VPN` API（`VPN.getState()`, `VPN.start()`, `VPN.stop()`），在 iOS 原生仪表盘与 Web 控制台提供一键开关。连接后全手机网络流量直接由系统内核级虚拟网卡流经本地，切片清洗与域名过滤由 LocalDNS 内部直接执行；
    - **Apple 官方原生加密 DNS 描述文件修复与根证书内嵌 (`/localdns.mobileconfig`)**：纠正此前因 `ServerURL` 协议与裸 IP 地址触发的 iOS 描述文件安装校验报错；合入 `com.apple.security.root` 安全载荷一并下发 `LocalDNS Root CA`，实现“证书信任 + 内核级 DoH”一次性顺畅安装，后台零额外耗电、免开任何代理工具，全局阻断 18.5 万条广告；
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
  - **9099 端口标准透明 HTTP 代理接管**：HTTP 9099 端口兼具 Web 控制台、普通 DoH 与透明 HTTP 代理服务；自动嗅探请求绝对 URL 或通过 Host 头部精准接管，直接交由 `ProxyHandler` 流水线重写、Mock 响应与切片清洗，无缝对接 Surge/Loon/小火箭本地节点与 iOS Wi-Fi 代理；
  - **开箱即用的全网主流视频去广告规则库**：
    - **Bilibili 纯净视频与开屏秒开 (`preset_bilibili`)**：拦截开屏广告（`/x/v2/splash` 204 秒开）、信息流推广卡片（`/x/v2/feed/index` 剔除）、视频播放中插推荐（`/x/v2/ad/*` 阻断）与搜索广场推广；
    - **全网通用视频广告 SDK 桩代码 (`preset_universal_video_sdk`)**：本地 Mock 模拟完整的 Google IMA3 (`ima3.js`) SDK，派发 `ALL_ADS_COMPLETED` 与 `COMPLETE` 事件欺骗播放器跳过广告等待；同时预置爱奇艺 (`/player/info` 空广告数组)、优酷、腾讯视频与芒果 TV 去广告规则；
    - **YouTube 纯净视频切片阻断与流清洗 (`preset_youtube`)**：剥离 `videoplayback?adformat=1` 广告切片、剪枝 `adPlacements`；
    - **Twitch 直播 SSAI 广告切片清洗 (`preset_twitch`)**：流式剥离 M3U8 中的 DATERANGE 广告段与预取切片；
  - **查询日志 HTTP 重写实时审计追踪**：在 Web 控制台“查询日志”新增「HTTP 重写日志」选项卡，与 DNS 查询日志无缝切换；展示拦截状态、执行动作、状态码、耗时、规则名称、请求主机与完整 URL；提供审计详情抽屉并支持一键清空日志；
  - **规则管理 HTTP 重写多维度筛选与搜索栏**：在“HTTP 重写”列表视图新增多维度筛选工具栏，支持按关键词、动作类型（302重定向/Mock响应/Header替换/Body替换/拟真阻断）、规则来源（自定义/模块内置）与生效状态（生效中/已停用）即时模糊过滤与计数；
  - **规则管理 HTTP 重写深度编辑与在线推演**：支持双视图一键无缝切换（可视化列表 + 纯文本配置编辑），支持单条规则独立启闭开关、编辑、推演与删除；内置经典预设模版（重定向、Mock、UA替换、敏感头剥离、广告开关替换等）；内置 HTTP 重写实时推演与在线测试器，即时反馈命中规则、模拟返回状态码、重定向 Location、报文预览及执行动作；
  - **核心功能策略独立开关**：在 Web 控制台“功能开关”页面与 iOS 原生仪表盘中新增「MITM 流量接管 (`switch_mitm`)」与「HTTP 重写引擎 (`switch_rewrite`)」，支持一键启闭与热重载，方便精准排障；
  - **完善的高性能 HTTP 重写引擎**：支持 `302 / 307` 正则捕获组重定向（`$1, $2` 路径替换）、支持 `mock 200/204` 虚拟响应（零上游开销）、支持请求 Header 替换与删除 (`header-replace` / `header-del`)、支持响应 Body 全局正则替换 (`body-replace`)；
  - **规则管理跨平台模块导入入口**：在 Web 控制台“规则管理”新增「模块管理 (Surge / Loon / QX)」专区，支持一键填入常用社区预设（YouTube 纯净流净化、B站去广告、Twitch SSAI 清洗、爱奇艺去广告等）、输入远程订阅 URL 或直接粘贴规则配置，支持查看规则条目详情与在线流清洗测试器；
  - **DNS 解析路径全分流动态交互视图**：在“DNS 解析路径”拓扑增加动态交互工具栏，支持「全部全景/国内直连/国外无污染/视频流清洗与FakeIP/广告与安全拦截」5 种分流模式高亮切换；支持输入域名或点击快捷药丸（YouTube 视频切片/哔哩哔哩直连/百度移动广告/GitHub 国际服务/本地重定向）动态推演全链路解析路径与决策卡片，粒子引擎自动沿决策路径流动巡礼；
  - **跨平台模块引擎 (Surge / Loon / Quantumult X)**：原生统一解析器 (`ModuleParser`)，直接加载 `.sgmodule`、`.plugin` 与 QX 重写规则，支持通配主机名、静态 Reject (204/200/img/dict)、302 重定向与脚本绑定；
  - **FakeIP 虚拟地址池 (RFC 2544 198.18.0.0/15)**：命中的 MITM 视频域名自动由 DNS 路由器分配 FakeIP，并将流量引导至本地处理管线，支持高频双向毫秒级反查；
  - **HLS M3U8 清单清洗与 JSON 广告递归剪枝**：流式剥离 Twitch/Kick/SSAI 中的 `#EXT-X-DATERANGE` 广告段、预取切片与 ad_segment 分片；递归剪除 YouTube 播放器 `adPlacements`、`playerAds`、`adSlots` 与追踪 URL；
  - **兼容多协议规范的 JavaScript 沙箱运行时**：完整支持 `$request`、`$response`、`$done()`、`$httpClient`、`$persistentStore`、`$notification` 与 QX `$prefs` / `$notify`，带超时自动熔断降级；
  - **纯 TypeScript DNS 核心引擎 (对齐 FJG4Z)**：纯 TS 实现 RFC 1035 / 3596 标准二进制 DNS 报文编解码，全面对齐 FJG4Z 契约规范，支持 A, AAAA, CNAME, PTR, SOA, TXT, HTTPS 等；
  - **双通道共生架构**：HTTP 端口 9099（Web 双皮肤控制台/REST API/普通 DoH 秒开免证书）+ HTTPS 端口 9443（Surge 专用的安全 TLS 1.3 DoH，支持自签名证书链与热重载）；
  - **全新双皮肤体系 (UI 2026.10.17.2)**：
    - **「人文羊皮纸 · Claude」**：温润羊皮纸象牙色底、深炭墨色、赤陶红与鼠尾草绿，宣纸纤维肌理层，提供 5 款预设色调与纸张肌理/温润层次调节；
    - **「流光毛玻璃 · 原版」**：深空暖金、极光深海等 5 组光影预设、本地壁纸 IndexedDB 存储与毛玻璃模糊度/遮盖度/暗化遮罩调节；
    - 两套皮肤各自独立保存深浅色主题，顶栏快捷「流光」开关直接控制拓扑粒子流动，支持浏览器本地字体上传；
  - **彻底修复控制台首页渲染空指针解引用**：消除 `console.js` 中趋势卡片选择器 `trend.closest` 的潜在空指针崩溃，`app.js` 关键接口增加全量 `safe()` 容灾兜底，杜绝“无法加载当前页面”；
  - **Happy Eyeballs 双发自愈竞速与 SingleFlight**：多上游并发测速与首包采纳，350ms 内未返回自动拉起国内节点双发竞速，高并发重复查询 0 延迟秒级共享返回，彻底消灭超时卡顿；
  - **四级缓存池与 AdGuard 广告拦截**：核心缓存、国内、国外、国外 ECS 四级隔离与动态 TTL 衰减；开箱激活 18.5 万条广告拦截规则库，自动拦截率 100%；
  - **11 层精准分流路由器**：重定向 Rewrite、黑白名单、强制 RealIP、GeoIP、Geosite 与国内大厂启发式分流；
  - **两级实时脉冲监控与防溢出排版**：秒级运行时长精确保留与跳动，2秒轻量就地更新进程 CPU 与真实 RSS 内存；分流图例排版加固与防溢出截断；
  - **BackgroundKeeper 官方长驻保活**：启动即自动向 iOS 申请后台长驻运行权限，杜绝切出 App 30 秒后被系统休眠冻结，保持 24 小时端口监听永不断连。
- **安装链接**：[网页一键安装](https://www.scripting.fun/import_scripts/?urls=%5B%22https%3A%2F%2Fraw.githubusercontent.com%2Fckldy%2Fscripting-scripts%2Fmain%2Fdist%2FLocalDNS.zip%22%5D)
- **App 直链**：`scripting://import_scripts?urls=https://raw.githubusercontent.com/ckldy/scripting-scripts/main/dist/LocalDNS.zip`

### 🎵 音乐大合集 (Music Collection)
- **版本**：`1.0.0` ｜ **作者**：`vcncv`
- **特性**：
  - **多源曲库聚合**：深度支持 QQ 音乐、网易云、酷狗、酷我、咪咕 5 大音源搜索与播放，突破跨域限制；支持扩展自定义本地或在线音源插件；
  - **全窗口自适应**：深度适配 iPad 台前调度、分屏模式与浮窗（`100dvh`），任意矮窗口下进度条、播放控制按键与底部工具菜单始终完整可见、永不裁切；
  - **纯净优雅歌词**：纯净无下划线高亮歌词，随歌曲明暗自适应主题色，丝滑垂直滚动，点击全屏歌词，锁屏歌词双句轮流播报；
  - **多样动感进度条**：星轨（正弦浪涌）、心率波形、呼吸光轨与经典细轨 4 种样式自由切换；
  - **多档音质与自动降级**：标准（128k）至无损（FLAC）、Hi-Res、母带（AI00）；播放失败自动平滑重试下一档音质；
  - **后台保活与系统联动**：iOS 原生 MediaSession 深度联动，锁屏与灵动岛展示封面与歌词，支持耳机线控与后台常驻。
- **安装链接**：[网页一键安装](https://www.scripting.fun/import_scripts/?urls=%5B%22https%3A%2F%2Fraw.githubusercontent.com%2Fckldy%2Fscripting-scripts%2Fmain%2Fdist%2F%E9%9F%B3%E4%B9%90%E5%A4%A7%E5%90%88%E9%9B%86.zip%22%5D)
- **App 直链**：`scripting://import_scripts?urls=https://raw.githubusercontent.com/ckldy/scripting-scripts/main/dist/%E9%9F%B3%E4%B9%90%E5%A4%A7%E5%90%88%E9%9B%86.zip`

### 📻 NetRadio (网络收音机)
- **版本**：`1.0.0` ｜ **作者**：`vcncv`（基于 net-redio 深度移植）
- **特性**：
  - **全功能黑胶唱机**：拟真黑胶唱片旋转、复古金属唱臂抬起/下落动效；
  - **动态示波器与色盘**：矩阵式电平示波器随声波跳动，内置 36 种设计师精选配色与深浅主题自适应；
  - **全球 1000+ 电台**：按 36 个国家/地区多级分类，支持毫秒级检索、收藏夹与历史记录；
  - **原生音频后台保活**：调用原生 `AVPlayer` 低功耗管线与锁屏/灵动岛实时广播流状态控制。
- **安装链接**：[网页一键安装](https://www.scripting.fun/import_scripts/?urls=%5B%22https%3A%2F%2Fraw.githubusercontent.com%2Fckldy%2Fscripting-scripts%2Fmain%2Fdist%2FNetRadio.zip%22%5D)
- **App 直链**：`scripting://import_scripts?urls=https://raw.githubusercontent.com/ckldy/scripting-scripts/main/dist/NetRadio.zip`

### 🌀 台风路径
- **版本**：`2.3.1`
- **特性**：
  - 实时台风路径追踪、中央气象台/各国际专业机构路径预报对比与卫星云图气象图层；
  - 主程序刷新自动同步刷新主屏幕与锁屏小组件，支持大号小组件地图缓存优化。
- **安装链接**：[网页一键安装](https://www.scripting.fun/import_scripts/?urls=%5B%22https%3A%2F%2Fraw.githubusercontent.com%2Fckldy%2Fscripting-scripts%2Fmain%2Fdist%2F台风路径.zip%22%5D)
- **App 直链**：`scripting://import_scripts?urls=https://raw.githubusercontent.com/ckldy/scripting-scripts/main/dist/台风路径.zip`

### 🎬 黃豆短劇
- **版本**：`1.2.0`
- **特性**：
  - 优质热门短剧浏览、快速检索与追剧收藏夹；
  - 支持播放历史记忆、上下滑切集手势与进度条随心拖拽。
- **安装链接**：[网页一键安装](https://www.scripting.fun/import_scripts/?urls=%5B%22https%3A%2F%2Fraw.githubusercontent.com%2Fckldy%2Fscripting-scripts%2Fmain%2Fdist%2F黃豆短劇.zip%22%5D)
- **App 直链**：`scripting://import_scripts?urls=https://raw.githubusercontent.com/ckldy/scripting-scripts/main/dist/黃豆短劇.zip`

## 🔄 更新

- 重新导入最新的 zip 即覆盖更新（数据保存在本机，不受影响）。
- 脚本 `script.json` 中的 `remoteResource.url` 指向 `dist/<脚本名>.zip`，可供应用内的远程资源功能使用。

## 🧱 目录结构

```
scripting-scripts/
├── README.md            # 索引与安装说明（新增脚本时更新）
├── build-release.tsx    # 发布构建脚本：脚本目录 → dist/<名>.zip
├── <脚本名>/            # 脚本源码目录（含 script.json + index.tsx）
│   ├── script.json
│   ├── index.tsx
│   └── ...
└── dist/                # 安装包（zip，script.json 在包根）
    └── <脚本名>.zip
```

## 📎 关联仓库

| 仓库 | 说明 |
|---|---|
| [cpa-manager-plus-deploy](https://github.com/ckldy/cpa-manager-plus-deploy) | CPA 系统（CLIProxyAPI + CPA-Manager-Plus 面板）可复现部署模板：双容器 compose、nginx 反代、一键更新服务与安装/备份/还原脚本（纯模板，无真实密钥） |

## ✍️ 新增脚本规范（保证互不影响）

1. **独立目录**：新建 `<脚本名>/`，目录名即脚本名，`script.json` 中 `name` 与目录一致；
2. **不共享代码**：脚本之间不得 import 彼此的模块；公共工具可复制进各自目录，不建共享依赖；
3. **独立打包**：`scripting-ts run build-release.tsx --timeout 180` 会把所有脚本目录打成独立 zip 到 `dist/`，安装互不影响；
4. **更新 README**：在脚本列表加一行（名称/版本/说明/安装链接）；
5. **提交推送**：`git add .` + `git commit` + `git push origin main`（见下方命令）；
6. **remoteResource**：`script.json` 加 `"remoteResource": { "url": "<zip 直链>" }`，直链格式：
   `https://raw.githubusercontent.com/ckldy/scripting-scripts/main/dist/<URL编码脚本名>.zip`

## 🔧 发布命令（本机 isomorphic-git）

```bash
# 本地提交
scripting-ts run /var/mobile/Library/Mobile Documents/iCloud~com~thomfang~Scripting/Documents/scripting-skills/isomorphic-git/scripts/git.ts --queryparameters '{"command":"add","dir":"<仓库目录>","filepath":"."}' --timeout 60
scripting-ts run ... --queryparameters '{"command":"commit","dir":"<仓库目录>","message":"<说明>"}' --timeout 60
# 推送
scripting-ts run ... --queryparameters '{"command":"push","dir":"<仓库目录>","remote":"origin","ref":"main"}' --timeout 120
```
