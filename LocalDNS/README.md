# LocalDNS for Scripting App

> **当前版本**：`v1.15.10 (Build 20261111)`  
> **移植作者**：`vcncv`  
> **上游开源**：[yyhoworks/LocalDNS](https://github.com/yyhoworks/LocalDNS)（对齐 UI `2026.11.07.2` / 内核 `FJMOS`）

将 [yyhoworks/LocalDNS](https://github.com/yyhoworks/LocalDNS)（Rust DNS 核心 + 双皮肤 Web 控制台）完整转换为适配 **iOS Scripting App** 的本地高性能 DNS 服务与安全管理系统。

### v1.15.10 修复缓存命中率恒为 0% + 境外 DoH 超时按分组调优
- **面板「缓存命中率」恒为 0%（真 bug）**：`audit.getStats()` 读的是 raw `mainCache` 池计数，而 main 池是 write-through 回退池、自身只看得见未命中，真实命中数在 `CacheManager` 的逻辑查询聚合量里。改为读 `getPoolMetrics()` 中 `cache_main`（聚合口径）。
- **修复前证据**：`/metrics` 里 `localdns_cache_hit_total{tag="cache_main"} 742` / `query_total 942`（真实 **78.8%**），而 `/api/v1/status`、`/api/v2/audit/stats` 一致报 `0`。
- **修复后验收**：同一进程内随查询爬升（6 次查询 16.7% → 9 次 37.5% → 12 次 50%），`/api/v2/audit/stats` 与面板同源。
- **境外 DoH 超时按分组**：`domestic` 仍 2500ms（IP 直连、快，死了要早发现），`foreign` / `foreign_ecs` / `proxy` 提升到 6000ms。境外 DoH 必须经隧道，冷握手本身 ~1s，旧 2.5s 默认会把长尾直接 abort（`cloudflare_ip` 24/146、`google_doh` 25/146 ≈ **17%**），而每次 abort 还会掐断 keep-alive，让下一次再付一次握手 —— 越超时越慢。
- **调优后实测**：8 个境外域名连续解析 **8/8 成功**（1.00–1.28s），重启后 `error_total` 全部为 **0**（两节点各 9 次查询、0 错误）。
- **新增诊断工具**：`tools/diff-hub-module.py` 抓本地动态编译的 `/surge/hub.sgmodule` 与 Surge `get_module` 正文，按 `[Section]` 切分、忽略注释空行、归一化 `[Build: …]` 时间戳后逐段比对，判断「模块是否过期」不再靠肉眼（本次比对 7 个 section 全部逐行一致）。

### v1.15.9 精确同步上游面板 2026.11.07.2（内核零改动）
- **精确替换打包 SPA**：`app-DHEFTe3j.js`（858 KB）+ `index-V92FMUfL.css`（760 KB），旧 `app-WuMOQwvp.js` / `index-CuVu9oNC.css` 已彻底移除；`editor-A1rycQg2.js` 上游内容未变（`84ec8b8f…`），本地 Surge 区段校验原样保留。
- **跟随上游本版改动**：设备名称字号字重 16px/600 → **14px/500**，IP 仍是 12px 等宽；升级入口主按钮按「实际更新内容」着色——只有 UI 有更新时突出「升级 UI」，UI 与内核都有更新才突出整套升级，单独「升级 UI」仍可点击。
- **本地定制零丢失**：7 处 Surge 补丁（`Surge · CONF` 核心置顶、品牌与面板文案、默认核心 `surge` 及回退逻辑）与 editor 的 Surge 区段校验逐行重放；`livepulse.js`、`surge-workbench.js`、AdHunter 入口、`data-backend-version="FJMOS"`、同源 `proxyConfigBase` 全部保留。
- **内核零改动的可验证依据**：上游 `.1` / `.2` 两版只改前端，`Full.zip` 沿用 `2026.11.06.1` 的 FJN01 内核与干净默认配置；对新旧 app bundle 提取全部 `/api/v1` · `/api/v2` 端点逐项比对，**29 → 29 无增无减**，`FJMOS` TS 后端、legacy 探测与 28 个既有契约行为不变，无需改内核代码。
- **同步工具加固**：`tools/sync-upstream-ui.py` 新增 `latest` 参数（自动取 GitHub 最新正式 tag）；下载后用发行版 `SHA256SUMS.txt` 校验安装包（本次 `88f071fc…` 通过），校验表取不到时明确告警而不是静默跳过；收尾自检本地补丁特征串、`index.html` 三处定制与打包文件唯一性，任一不符硬失败；顺带清理改名后遗留的旧 `editor-*`。
- **测试去硬编码**：`test-suite.ts` 与 `test-ui-contract.ts` 不再写死 `app-*` / `index-*` / `editor-*` 文件名，改为从 `index.html`（app/css）与 app bundle 的懒加载引用（editor）解析，下次换包不必再改测试；版本断言更新到 `2026.11.07.2`。
- **回归测试不再污染生产库**：旧 `test-suite.ts` 会把 `test_bili` 模块以启用态留在库里（其 PUT 用例写出的 `live.bilibili.com,REJECT` 会真实误伤直播），并把 `direct` 分流组全量覆盖成 3 条测试规则。现在测试开始快照 `direct` / `proxy` 组文本、`finally` 原样写回，并删掉测试模块；两条与 2026-11-07 设计相反的旧断言（内置脚本覆盖 `youtubei`、MITM 禁媒体域名）改成校验当前编排（内置只管 `www/m.youtube.com`、`[MITM]` 只能一行 hostname）。

### v1.15.8 回退 YouTube Enhance 脚本重排（客户端打不开）
- **现象**：按 v1.15.7 把 `youtube.enhance.response` 排到内置脚本前面，并在 Surge 更新模块后，YouTube 客户端打不开；04:40 的请求记录显示 `browse` / `guide` 被 gholts `response.js` 改写后客户端停止继续请求。
- **结论**：gholts `response.js` 的 protobuf transform 与当前 YouTube 客户端不兼容；Surge 每个响应只跑第一条匹配脚本，模块功能与客户端稳定不可兼得。
- **回退**：内置 `localdns_builtin_yt_web` 恢复绝对置顶；YouTube Enhance 模块在 LocalDNS 侧关闭（`app_modules.enabled=0`），player / next 不再被 gholts 改写；browse / search / guide 等内置不匹配的端点仍可走 gholts（模块重新启用时）。
- **恢复顺序**：Surge 里先保持 Hub 模块关闭，确认客户端能打开；再重新启用 Hub（只含内置脚本）。YouTube Enhance 要等 gholts 适配新客户端后再开，否则会再次把客户端改坏。

### v1.15.7 修复 YouTube Enhance 被内置脚本遮蔽（已被 v1.15.8 回退）
- 本版把内置脚本移到 `youtube.enhance.response` 之后，确实让模块功能跑起来了，但客户端打不开，已回退；保留本节作为排序机制的记录。

### v1.15.6 修 YouTube 两条链路：网络扩展内存红线 + 网页钩子收紧
- **网络扩展内存红线（App 漏广告与视频断流的总闸）**：Surge 事件日志实测到 `core.warning`——「脚本使用了过多内存，即将导致 Surge 引擎内存超限被系统终止」。引擎一旦被系统杀掉，MITM 与全部七层脚本**同时**失效：App 贴片广告回流、网页视频接连中断，而 `/v1/profiles/current` 看起来仍然一切正常。现在 `compileUnifiedHubModule()` 把导入脚本的 `max-size=-1`（不限流）与超大值统一收敛到 8 MiB：宁可让超大响应跳过脚本，也不把网络扩展的内存赌进去。
- **Hub 自检上报引擎级告警**：`GET /api/v1/surge/hub-health` 新增 `warnings` 字段，直接列出 Surge 的「脚本内存超限」与「规则集/脚本远程加载失败」——这类故障不改配置文本，只比对 MITM 域名与脚本名永远看不出来。
- **AdBlockHub 4.4.5**：
  * **首屏贴片（4.4.5）**：YouTube 在 HTML 内联脚本里同步执行 `window.ytplayer.bootstrapPlayerResponse = window.ytInitialPlayerResponse`，紧接着 `createPlayer()`；`JSON.parse` 看不到这段 JS 对象字面量，10ms 轮询也赶不上同步赋值。现在在 `window.ytplayer` 上装 setter，赋值瞬间就地剥离 `adPlacements` / `playerAds` / `adBreakHeartbeatParams`，播放器拿到的首屏响应已是干净的。
  * `ytInitialPlayerResponse` 是页面用 `var` 声明的全局（`configurable:false`），换 getter/setter 必然抛 `TypeError: Attempting to change configurable attribute of unconfigurable property`，旧版这段从 4.3.0 起就没真正生效过；保留「短时轮询 + 就地删键」作为兜底。
  * `Response.prototype.json/text` 只对 `response.url` 含 `/youtubei/v1/` 的接口生效，不再重写首页 HTML、JS、媒体分片这类体量与格式都未知的响应（4.4.2 让网页端加载不出视频正是这一类误伤）。
  * 遮罩守卫不再 `el.remove()` Polymer 的 `tp-yt-iron-overlay-backdrop` 单例，只摘 `opened` + `pointer-events:none`：节点被拔掉后 IronOverlayManager 仍握旧引用，后续弹窗与播放器控件会失联。
  * iOS 起播兜底最多尝试 3 次、且只静音一次，避免反复 mute/unmute 被 WebKit 判成用户手势变更而直接暂停。
- **验收**：`test-adblockhub-444.js` 17/17（含首屏 `bootstrapPlayerResponse` 同步剥离 5 项）、`test-youtube-web-script.js` 12/12、`test-popup-logic.js` 14/14。模块正文有改动，需在 Surge 内对「LocalDNS Unified Hub」点一次「更新」才会生效。

### v1.15.5 修复 mod_adhunter 与 YouTube 网页遮罩
- **mod_adhunter 规则总是被清空（真因）**：`app_modules` 与子表是 `ON DELETE CASCADE`，而 `saveModule()` 用 `INSERT OR REPLACE`——先删旧行就会把 `module_http_rules` 连带清空。旧代码「先插规则、后存模块」等于每次写完立刻被删，所以模块长期只剩 64 字节头、0 条规则。现在改成**先 `saveModule`、再把全量规则回写**。
- **模块自包含**：`raw_content` 现在持久化 `[Rule]` 区段（清洗后的规则），不再依赖内存态；下次重解析不会被洗掉。
- **JS 不落 Surge**：规则里若出现 `script-path`，只接受 `127.0.0.1` / `localhost`（即 LocalDNS 自己的 `/scripts/*`），外部脚本引用直接丢弃并记日志——保持「LocalDNS 处理脚本、Surge 只跑必要七层」的红线。
- **历史脏数据清理**：`isOverbroadRejectRule` 命中的旧规则（如 `.*(ad|banner|splash|popunder).*`）在重建时被剔除，不再写入模块。
- **YouTube 网页点不动（遮挡）修复**：AdBlockHub 4.4.1 删除 `ytd-popup-container:has(a[href*="/premium"])` 整块隐藏，新增 `tp-yt-iron-overlay-backdrop { pointer-events: none }` 与「无可见对话框时清理孤儿遮罩」定时守卫。
- **验收**：`addAdHunterRules` 单测 5/5（写入、进入 Hub、外部脚本丢弃、raw_content 持久化、`[Rule]` 区段），全量回归 152/152。

### v1.15.4 保持模块精简（回退实验性改动）
- 网页去广告回到「接口 JSON 脱水」单通道：`youtube-web.js?v=20261106c`、pattern `player|next|reel/reel_watch_sequence`、`max-size=2MB`、`binary-body-mode=1`、`engine=webview`，与之前一致。
- **撤销**临时加入的 HTML 文档通道（3MB 整页缓冲）与信息流 renderer 深度遍历：前者把整页文本压进 Surge 网络扩展，违背「LocalDNS 脱水、Surge 只保留必要七层」的设计，有内存风险；后者也增加 MITM CPU。
- 网页广告的正确位置是浏览器内的 AdBlockHub 用户脚本（已有 `ytInitialPlayerResponse` / `JSON.parse` / `Response` 钩子），不占用 Surge 内存。
- 保留的内核修复：模块规则 `#` 注释清洗、`*.googlevideo.com` 不进 MITM、内置脚本置顶、Hub 自检参数指纹。

### v1.15.3 内核侧修复：广告清洗数据库、Hub 脚本顺序与 YouTube 客户端去广告
- **修复规则清洗吞注释（29,564 条规则曾经静默失效）**：`parseRulesList()` 只剥 `//` 不剥 `#`，把「# 注释」并进了 `pattern`——block 组 22,941 条（43%）、proxy 组 6,623 条（99.9%），导出到 Surge 的 RULE-SET 整行不可用。现在导入即剥离、导出再兜底清洗，并在启动时幂等修复历史数据（已修复 29,564 条，block.list 脏行 1,933 → 0、proxy.list 6,623 → 0）。
- **YouTube 客户端去广告修复**：内置 `localdns_builtin_yt_web` 强制置顶到 `[Script]` 首位（此前排在 96 个脚本末尾，任何远程脚本失败它就永远轮不到），保留 `requires-body + binary-body-mode + engine=webview + max-size=2MB`，pattern 覆盖 `youtubei.googleapis.com`，脚本 URL 升版 `?v=20261106c`。
- **MITM 媒体红线落地**：编译期把 `*.googlevideo.com` 等媒体分片域名从 `[MITM]` 剔除——它们没有任何可剥离的广告字段，解密只会增加握手开销、弱网放大内存并导致播放中断。
- **Hub 自检升级**：`/api/v1/surge/hub-health` 增加内置 YouTube 脚本的参数指纹比对，Surge 缓存的旧版模块正文会被判为 `scripts_not_applied` 并提示重装，而不是误报 healthy。
- **一键安装保持稳定 URL**：不要给 Hub 安装链接加 `?v=` 破缓存参数——Surge 会把带参 URL 当成新模块，出现两个同名「LocalDNS Unified Hub」并导致脚本重复执行；需要刷新时在 Surge 里删掉旧模块再重装。
- **验收**：DNS 层 293,321 条 AdGuard + 318 条模块脱水规则实测拦截（`ads.youtube.com`、`googleads.g.doubleclick.net`、`mobads.baidu.com` → `0.0.0.0`）；回归测试 152 项全通过（新增 6 项：内置脚本置顶/客户端覆盖/二进制体模式/MITM 媒体豁免/注释剥离）。

### v1.15.2 精确同步上游 UI 2026.11.06.1（页面命名统一与字号收敛）
- **精确替换打包 SPA**：`app-WuMOQwvp.js`（859 KB）+ `index-CuVu9oNC.css`（758 KB），旧 `app-CsE8sd7S.js` / `index-C5EjdCFs.css` 已彻底移除；`editor-A1rycQg2.js` 上游内容未变，本地 Surge 区段校验原样保留。
- **页面命名与浏览器标签页统一**：日志 / 解析 / 分流 / 系统，不再混用「查询日志 / DNS 管理 / 规则管理 / 系统管理」；搜索旧名称仍可跳转到对应页面（上游保留别名）。
- **Claude 浅色皮肤可读性修正**：主色徽章文字 `#C96442` → `#A44B2D`（对纸面对比度 3.77:1 → 5.60:1），徽章底色改为同色系，不再蓝底配橙字。
- **字号收敛**：全站收敛到 11 / 12 / 13 / 14 / 16 / 18 / 20 / 22 / 24px，最小字号由 8px 提到 11px（28px 以上展示数字不变）。
- **本地定制零丢失**：7 处 Surge 补丁（`Surge · CONF` 核心置顶、品牌与面板文案、默认核心 `surge` 及回退逻辑）与 editor 的 Surge 区段校验逐行重放；`livepulse.js`、`surge-workbench.js`、AdHunter 入口、`data-backend-version="FJMOS"`、同源 `proxyConfigBase` 全部保留。
- **内核零改动**：本版上游只改前端；FJN01 四架构内核、默认配置与代理配置服务 1.7.1 与 `2026.11.05.6` 逐字节一致，新 UI 请求的 28 个 `/api/v1` · `/api/v2` 端点集合与上一版完全相同，`FJMOS` 后端无需改动。
- **同步流程工具化**：新增 `tools/sync-upstream-ui.py`，一键完成备份、替换、7 处补丁重放、`index.html` 三处定制与 `version.json` 改写，并在每个锚点命中数不为 1 时硬失败。

### v1.15.1 精确同步上游 UI 2026.11.05.6（FJN01 发行线，保留 FJMOS 内核）
- **精确替换打包 SPA**：`app-CsE8sd7S.js`（858 KB）+ `index-C5EjdCFs.css`（759 KB）+ `editor-A1rycQg2.js`，旧 `app-C9ij6y6z.js` / `index-qdjMEPt4.css` 已彻底移除。
- **本地定制零丢失（逐行重放）**：重新打上 7 处 Surge 集成补丁（`Surge · CONF` 核心置顶、品牌与面板文案、默认核心 `surge` 及回退逻辑）与 editor 的 Surge 区段结构校验；`livepulse.js`、`surge-workbench.js`、AdHunter 入口、`data-backend-version="FJMOS"` 全部原样保留。
- **字体子集同步**：Noto Serif SC / Noto Sans SC UI 子集与 `fonts/manifest.json` 跟随上游重新子集化（936 字）。
- **后端契约零改动**：新包 `/api/v1/*` 端点集合与上一版完全一致（23 个），仅升级 UI 产物，`FJMOS` 内核标识与全部接口行为保持不变。

### v1.15.0 落地 Surge TF436 特性全量支持与全链路增强
- **Surge 原生配置实时编辑与一键热载**：
  * 在原生配置编辑器的「配置核心」中将 `Surge · CONF` 置顶为首选；
  * 通过 Surge HTTP API (`/v1/profiles/current`) 直读 Surge 正在生效的完整配置；
  * 支持实时语法结构校验；点击「保存并应用」自动传回 Surge 执行热载 (`/v1/profiles/reload`) 与 DNS 缓存冲刷 (`/v1/dns/flush`)，无需重启即时生效。
- **AdHunter 离线抓包深度分析与规则合成 (TF436+)**：
  * 接入 Surge 磁盘归档的抓包会话 (`Saved Capture Sessions`)；
  * 支持选择会话一键扫描 App 与页面广告接口（自动并发提取 JSON 响应体扫描广告载荷）；
  * 自动合成零域名 `URL-REGEX` 与 Userscript，一键合流母核。
- **Surge 工作台新增「抓包会话审查」面板**：
  * 实时浏览历史抓包会话列表、请求记录总数、限制条件与终止原因；
  * 支持请求实时过滤（关键词、域名、状态码、进程名）；
  * 详情弹窗自带 JSON 格式化与高亮，支持一键切换查看 Raw Request/Response 原始报文。
- **Tailscale & WireGuard 回环穿透直连保护**：
  * 在自动生成的 Surge 配置文件中加入 `100.64.0.0/10` 与 `*.ts.net` 直连白名单规则，打通本机回环穿透与跨机隧道无死锁访问。
- **多维流量拆解与节点下钻接口**：
  * 落地 `/api/v1/surge/traffic/breakdown`，支持按节点与设备下钻拆解流经的具体域名与请求频次。

### v1.14.2 对齐上游 FJMOS / UI 2026.11.03.2 与直连 DNS 极速优化
- **精确同步上游 SPA**：全量跟随上游打包产物 `app-C9ij6y6z.js` 与 `index-qdjMEPt4.css`。
- **顶栏精简分组与流光毛玻璃可读性**：
  * 顶栏按「搜索 · 徽标 │ 代理▾ │ 概览 外观 流光 │ 刷新 主题」统一分组，手机端收紧为 5 键并将「流光 / 概览卡片 / 版本」收纳至外观面板快捷入口；
  * 版本按钮改为单行等宽紧凑徽标 `v11.03.2`；
  * 流光毛玻璃遮盖度下限提升至 62%，背景暗化下限提升至 20%，极端纯白/纯黑壁纸下次级文字对比度大幅改善；
  * 补齐无障碍实底降级兜底。
- **去广告清洗算法重构（提速 4000+ 倍）**：
  * `AdGuardEngine`（18.5万条）与 `SurgeService`（3.2万条）将线性数组与 `endsWith` 扫描彻底重构为 **$O(k)$ 逐级父域名哈希探测**；
  * 正常域名在线清洗耗时从 **33.00 ms 暴降至 0.008 ms**，1000 次请求仅需 8.00 ms。
- **全量直连 DNS 极速上游**：
  * DNS 查询全部强制走国内高速直连上游（`domestic`：223.5.5.5、alidns、dnspod），杜绝经过代理节点带来的 500~2000ms 高延迟；
  * 默认禁用 `proxy` 组上游节点，Surge 配置文件中显式配置 53/853 端口与 DoH IP 直连。
- **多线程并发抓取与批量统一入库（Map-Reduce）**：
  * 远程规则集批量刷新（12 个规则集）采用 6 并发 Worker 线程池并发抓取与解析，最后统一原子写库、统一孤儿清理与缓存重载，耗时从 35 秒骤降至 2~3 秒。
- **本地自研能力 100% 保留**：`livepulse.js` 实时流光拓扑看板、`surge-workbench.js` Surge 治理工作台、`ad-hunter.html` 智能去广告实验室、同源 `proxyConfigBase` 配置均完整保留。

### v1.14.1 Hub 生效性自检 + 版本号单一真源
- **`GET /api/v1/surge/hub-health`**：把「模块看起来启用了、实际 MITM 没生效」这类隐性故障变成可查询的硬指标——期望值取自 `compileUnifiedHubModule()` 编译产物，实际值取自 Surge `/v1/profiles/current`，逐项比对 MITM 域名与 Script 条目，输出 `healthy` / `surge_api_offline` / `hub_module_disabled` / `mitm_not_applied` / `scripts_not_applied` 五类判定与处置建议。
- **修复版本号漂移**：界面原先硬编码 `APP_VERSION = 'v1.12.0'`，与 `script.json` 的 1.14.x 严重脱节。现改为启动时从 `script.json` 读取，`script.json` 成为唯一真源。
- **B 站 gRPC 通道加固**：`biliapi.net` / `biliapi.com` / `bilivideo.cn` / `hdslb.com` 纳入国内直连判定，避免 `direct-list` 订阅失效时 `grpc.biliapi.net` 被误判为国外解析，拖垮播放与弹幕。

### v1.13.0 「DNS 解析路径」重构为全链路闭环拓扑
- **阶段 06 出站执行数据活化**：此前阶段 06 三个节点（DIRECT / PROXY / BLK）只有静态文案，既无真实流量也无流光。现由 `/api/v1/topology/flow` 下发 `outbound` 实时聚合数据——直连次数与占比、代理次数与占比（含 Surge 在线状态/出站模式）、拦截次数与占比，节点副标题与右侧数值徽章逐帧刷新。
- **正向链路完整化**：05 上游 DNS 节点 → 06 DIRECT / PROXY（按策略组自动着色）；03 拦截规则（r6）→ 06 BLK；06 三路汇聚 → 「回环清洗与自愈」节点，并在 05/06 之间补齐此前完全缺失的贝塞尔连线。
- **两条返程回环，把运行图闭合成环**：
  * **顶部回环清洗链路（06 ➔ 02/03）**：Surge 模块广告规则沉淀入库、出站故障反哺自愈学习，反向弧线自右向左流过画布顶部，配「回环清洗 · 沉淀入库」胶囊标签；
  * **底部闭环交付链路（06 ➔ 01）**：解析结果回传客户端，弧线沿画布底部合拢，配「闭环交付 · 数据回传完成」胶囊标签；
  * 回环路径按 06→目标 方向绘制，叠加 `topoDashLoop` 反向流光，视觉上自右向左回流，形成 01 ➔ 06 ➔ 01 的完整闭环。
- **流光修复**：旧实现只给阶段 06 画了裸 `topo-edge`，没有 `topo-halo / topo-glow / topo-particle` 三件套，所以永远不会有流光。现所有阶段 06 与回环连线均补齐完整四层路径与端点光点，并遵守「流光开关」「减少动态效果」与悬停态。
- **不再被 SPA 重绘抹除**：回环图层 `#topo-s6-loopback-layer` 作为独立 `<g>` 挂载，配合按元素绑定的 `MutationObserver` 与重入保护，上游 `drawTopoCurves` 全量重写 SVG 后能立即自愈补回。
- **零流量节点自动降级**：阶段 06 节点按真实条数写入 `data-zero-flow`，「⚡️ 仅看活跃」折叠与零流量隐藏首次覆盖出站节点，回环标签同步收敛。
- **画布扩容**：`topo-stage-wrap` 宽度 1380 ➔ 1420px，并补 `padding: 30px 10px 42px`，为顶部/底部回环弧线与胶囊标签留出专属通道，不与节点卡片重叠。

### v1.12.0 同步上游 FJHAI / UI 2026.11.01.1
- **前端全量跟随上游打包 SPA**：`app-D0OSKPpj.js` + `index-DCmM8ALJ.css`（772KB / 624KB），精确替换打包资源，同步更新 Noto SC 字体子集。
- **概览缓存控制拆分为独立开关**：对齐上游 2026.11.01.1，概览「快捷控制」将「核心缓存 / 乐观过期」由共用单选分段控件拆为两个独立 `.switch` 开关（名称在左、轨道在右、附「开 / 关」文字），绑定 `change` 事件与提交防连点，失败自动回滚；后端 `switch13` / `switch4` 接口保持无缝契约。
- **名单管理解析控制新增「国外 IP 段」**：对齐 FJHAI 内核架构，解析控制列表新增「国外 IP 段」(`foreign_ip`，对应 `/api/v1/lists/foreign_cidrs`)，支持指定 IP 或 CIDR 网段优先按国外地址分流，原文编辑即时持久化。
- **核心族探测与旧版插件兼容**：继续保持 `/api/v1/features` 优雅 404 探测机制，UI 自动无缝降级运行于本地定制 Legacy 插件模式。
- **本地深度定制全面保留**：`web/assets/livepulse.js`（1s 浮动脉冲与 KPI / 2s 进程真实 CPU·内存就地更新）、`web/assets/surge-workbench.js`（Surge 深度治理工作台）、同源 `proxyConfigBase` 配置均完整保留。

### v1.11.0 LocalDNS × Surge 联动控制分流与动态解析路径
- **SQLite 结构化数据中枢**：引入 Scripting 原生 `SQLite`（`surge_link.db`），解耦管理态与运行态。支持 App 净化模块、分流规则组、七层重写/脚本以及全链路动态拓扑记录，提供独立开关可控。
- **Surge 模块解析脱水引擎**：一键导入外部 `.sgmodule`，自动将成千上万行 `REJECT` 广告域名截留并下沉到 LocalDNS 本地 DNS 拦截库（纳秒级阻断回 0.0.0.0，彻底消除 Surge Network Extension 内存超限闪退），提纯后的纯 L7 重写与 MITM 域名动态编译为统一单一调度模块 `/surge/hub.sgmodule`。
- **统一动态分流 RULE-SET 导出**：各分流组（国内直连、节点代理、流媒体、游戏加速、Apple服务）独立开关，实时向 Surge 导出动态订阅链接 `/rules/:group.list`，变动秒级生效且无感热更。
- **Surge HTTP API 联动调度**：支持与本地或局域网 Surge（:6171）实时双向通信，出站模式切换、策略组选择、资源秒更、DNS 缓存冲刷，并支持在拦截到广告或高危追踪时主动调用 `/v1/requests/kill` 掐断后台活跃长连接。
- **「DNS 解析路径」动态拓扑、展示面积大扩容与阶段 06 出站执行**：拓扑图扩展至阶段 06（Surge 出口），实时映射直连与代理节点状态；支持自动学习自愈路径标注与全链路贝塞尔流光动态延伸。针对多节点展示拥挤问题，将拓扑舞台宽度由 960px 大幅扩容至 1380px，列宽由 126px 提升至 212px，消除文字挤压与截断；新增「🔎 全貌（自适应一屏）」、「⛶ 展开大图（全屏沉浸）」、「⚡️ 仅看活跃」三合一控制器，以及顶部「01~06 六大阶段快速平移导航胶囊」，全链路尽收眼底。
- **Web 控制台工作台全面升级（Surge 深度赋能）**：
  * **远程模块与规则导入**：支持一键输入远程 HTTP(S) URL（自动带 GitHub raw 镜像加速与超时保护），一键自动下载、清洗脱水与入库；
  * **Surge 规则多行批量导入与智能清洗 (⚡️ 一键清洗)**：支持直接整段粘贴 Surge 配置文件中的规则块（包含多行注释、`RULE-SET` 外部订阅、`DOMAIN-SUFFIX` 等），系统自动识别 `REJECT`、`DIRECT`、`PROXY` 与自定义策略组，自动抓取并展开外部规则集正文，广告域名自动清洗下沉至本地 DNS 秒级拦截，分流组原生支持 `REJECT` 拦截策略；
  * **模块与规则在线代码编辑**：提供轻量级在线多行代码编辑器，支持查看/修改 `.sgmodule` 源码并重新脱水，支持按组批量编辑分流规则文本；全站浅深色主题自适应，彻底消除黑底黑字；
  * **Surge 深度连通性测试与运行状态仪表盘**：提供「🔌 连通测试」按钮，测试 API 往返延迟 (ms)、HTTP 状态码、已挂载模块与策略组数量，若连接异常提供智能排查提示 (Hint)；支持 DIRECT / RULE / PROXY 出站模式一键切换；
  * **傻瓜式「Surge 配置向导」**：提供逐步教程与配置示例，支持一键复制 `[General]` http-api 配置、一键调起 `surge:///install-module` 安装 Hub 调度模块、一键复制 `[Rule]` 动态 RULE-SET 引用。

### v1.10.0 同步上游 FJH7T / UI 2026.10.30.7
- **前端全量跟随上游打包 SPA**：`app-CrSEI1zm.js` + `index-Bv4RNw_V.css`（722KB / 618KB），同步更新 Noto SC 字体子集（补「热窄竖轴仪抓」等 6 字）；上游自 2026.10.26.1 起已移除未使用的 Chart.js（约 205KB），本地同步删除。
- **新增页面与导航**：两字扁平导航 7 个一级入口（概览 / 日志 / 解析 / 分流 / 设备 / 代理 / 系统），新增独立「设备」页（FakeIP / RealIP 单机策略与受控 IP 管理）。
- **分流工作台**：名单管理分「核心分流 / 解析控制 / PCDN 抑制」三组、分组切换位于卡片头；在线分流按类型折叠为 6 组，新增 `geoip_non_cn`（GeoIP 非 CN）分组支持。
- **后端契约保持 legacy 兼容**：新版 UI 仍先请求 `GET /api/v1/features` 判断核心族，本端不实现（404）→ UI 自动走旧插件 API；`/api/v1/upstream/config` 继续兼容 `group` 与 `plugin_tag`。
- **可选增强缺失时自动降级**：新版「缓存参数」依赖 `/api/v1/cache/settings`（404 时界面自动隐藏该入口）；查询日志「记录存盘」依赖 `persist` 字段（缺失时隐藏）。
- **本地定制保留**：`web/assets/livepulse.js`（1s KPI / 2s CPU·内存就地脉冲）继续挂载；`config.js` 继续使用同源 `proxyConfigBase`。
- **代理配置编辑器兼容新版 UI**：`/api/proxy-config/cores` 返回 `mihomo` / `sing-box` 的 `available / exists / mode / path / roots`，并补齐 `read / check / save / fetch` 本地虚拟配置接口；不再提示“未找到核心配置”，保存仅写入本地 Storage，不启动或重载代理核心。

### v1.9.0 同步上游 FJGLI / UI 2026.10.22.3
- **前端全量跟随上游打包 SPA**：`app-DOuhu87M.js` + `index-B2JH1zZT.css`（其余字体/图标/编辑器/`chart.umd.min.js` 与上一版逐字节一致，仅精确替换 2 个打包文件 + 3 个元数据文件）。
- **核心族探测保持 legacy 兼容**：新版 UI 会先请求 `/api/v1/features` 判断核心族；本移植端不实现该接口（返回 404），UI 自动回落到旧插件 API，现有页面（概览/日志/规则/上游/广告/缓存/刷新任务）行为不变。
- **上游保存兼容 `group`**：后端 `/api/v1/upstream/config` 同时接受 `group` 与 `plugin_tag`，对齐上游 2026.10.22.2 的字段迁移。
- **在线分流保存不再误报**：上游 2026.10.22.3 接受仅返回 `changed: true/false` 的成功结果，未记录格式时显示“格式未记录”。
- **本地定制保留**：`web/assets/livepulse.js`（1s KPI / 2s CPU·内存就地脉冲）继续挂载；`config.js` 继续使用同源 `proxyConfigBase`。

### v1.7.0 参考 SmartDNS 深度优化
- **智能测速选最快 IP（P0）**：对上游返回的多个 A/AAAA 使用 `node:net` 做 TCP 握手测速（`tcp:443,tcp:80`），按 RTT 重排并返回访问最快的地址；支持 `response-mode`、`max-reply-ip-num`，测速结果 60s 复用，并发上限 8 保护 32 socket 配额。
- **缓存增强（P1）**：LRU 淘汰、按分组命中缓存池、`cache-persist` 持久化、`prefetch-domain` 临近过期预取、NXDOMAIN 负缓存、`rr-ttl-min/max` 与 `serve-expired` TTL 治理。
- **DoT / TCP-DNS 上游（P1）**：`node:net` / `node:tls` 实现 RFC 1035 over TCP 与 DoT(853)，与 DoH 同池竞速（Scripting 无 UDP，`udp://` 上游自动回落 TCP）。
- **结果 IP 治理（P1）**：`blacklist-ip` / `whitelist-ip` / `ignore-ip` / `ip-alias` / `bogus-nxdomain`。
- **规则与多客户端（P2）**：per-client `client-rules`（按 IP/CIDR 分组、no-cache/no-rule）、`domain-set` / `ip-set` 命名集合、DNS64（A→AAAA 合成）、本地记录注入（hosts / TXT / CNAME）、`force-qtype-SOA` 精细化。
- **修复**：分组缓存只写不读（死功能）、上游统计 winner 重复计数、缓存 FIFO→LRU。
- **UDP 说明**：Scripting 运行时无 `dgram`/原始套接字（`node:net` 仅 TCP），已采用 DoT/TCP 等价替代并预留 UDP 适配位，待平台支持后零改动接入。

---

## 鸣谢与致敬

| 开发者 | 负责内容 |
|---|---|
| **R 大（折腾日记交流群）** | **原版 DNS 核心架构，主要使用 Rust 编写** |
| **[yyhoworks](https://github.com/yyhoworks)** | **Web UI 设计、双皮肤体系（人文羊皮纸与流光毛玻璃）与前端交互系统** |
| **[@clone-fan](https://github.com/clone-fan)** | **通过 PR #1 与 PR #3 贡献玻璃细节、清单工作台、字体上传与交互动效** |
| **vcncv** | **面向 iOS Scripting 环境的纯 TypeScript 核心重构、双通道 DoH 服务端、18.5 万条 AdGuard 广告拦截引擎、四级缓存池、Happy Eyeballs 竞速解析、原生仪表盘开发、实时脉冲监控与全套 proxy-config 协同服务** |

---

## 核心特性

### 1. 本地 DNS 核心引擎 (TypeScript 原生实现)
- **RFC 1035 / 3596 二进制 DNS 编解码**：纯 TypeScript 原生实现，支持 A、AAAA、CNAME、PTR、SOA、TXT、HTTPS (SVCB) 等协议格式解析与打包。
- **DNS-over-HTTPS (DoH) 服务端**：在本地 `http://127.0.0.1:9099/dns-query` 与 `https://127.0.0.1:9443/dns-query` 提供双通道 DoH 接口，支持 POST（二进制 wire format）与 GET（base64url 格式）。
- **18.5 万条 AdGuard 广告与隐私追踪域名实时黑洞化拦截**：开箱即用 185,122 条过滤规则，常见移动广告（百度移动、腾讯广点通、穿山甲、Google 双击广告、YouTube 追踪打点等）在 DNS 层面 100% 立即黑洞化阻断并返回 `0.0.0.0`。
- **四级缓存池 (`CacheManager`)**：包含核心缓存、国内缓存、国外缓存与国外 ECS 缓存；支持动态 TTL 递减与过期缓存自愈回退（Stale-while-revalidate）。
- **多上游并发竞速与双发自愈**：支持国内组 (`domestic`)、国外组 (`foreign`)、国外 ECS 组 (`foreign_ecs`) 和代理组 (`proxy`) 的多节点并发请求与最快采纳（Winner 统计）；非国内组 350ms 未返回自动拉起国内组竞速。
- **多维度分流路由器 (`DiversionEngine`)**：涵盖名单管理（白名单/黑名单/灰名单/强制 RealIP/重定向 Rewrite）与在线分流（自定义 CN/Non-CN、Geosite CN/Non-CN），支持同组来源合并去重。

### 2. 系统级集成与全场景接入
- **Apple 官方原生加密 DNS 描述文件 (`/localdns.mobileconfig`)**：
  - 遵循 iOS 14+ 官方标准的 `com.apple.dnsSettings.managed` 配置文件规范；
  - 内嵌 `com.apple.security.root` 安全载荷一并下发 `LocalDNS Root CA`，实现“证书信任 + 内核级 DoH”一次性顺畅安装；
  - 由苹果操作系统内核直接驱动本地 9443 DoH 服务，后台零额外耗电、免开任何代理工具，全局阻断 18.5 万条广告。
- **Surge 专属安全 DoH 接管**：`doh-server = https://127.0.0.1:9443/dns-query`，满足 Surge 对 TLS 的强校验。
- **Shadowrocket 免证书全局接管**：支持明文 HTTP DoH `http://127.0.0.1:9099/dns-query`，小火箭 DNS 覆写秒级生效。
- **电脑 / 局域网设备接入**：局域网设备可将安全 DNS 指向当前手机 IP，打造家庭级 DNS 防火墙。
- **Scripting 原生全局 VPN 隧道**：深度调用 Scripting 系统级 `VPN` API，在原生仪表盘提供一键启闭与状态实时联动。

### 3. 上游 FJH7T / UI 2026.10.30.7 设备页与分流工作台
- **全新清单工作台**：合入上游最新清单工作台修复，解决编辑后取消逻辑、未保存判断、Ctrl+S 快捷保存与草稿隔离机制；备注、分组、新增项注释均参与草稿状态跟踪，批量粘贴去重并保持 `#` 注释停用状态。
- **服务端持久化身份设置与代理面板 (`/api/proxy-config/interface/*`)**：支持服务端持久化保存自定义显示名称、Logo 与代理面板入口地址，跨设备刷新无缝同步。
- **名单工作台备份与历史恢复服务 (`/api/proxy-config/rule-backups`)**：保存前重新读取名单并在服务端建立历史快照（每份名单最多保留 20 份），支持一键调出备份弹窗安全载入草稿并核对生效。
- **7 天流量吞吐量采样时序服务 (`/api/proxy-config/traffic`)**：服务端以 1.5 秒为周期持续平滑采集 QPS 样本并持久化存储，支持 1小时 / 6小时 / 1天 / 3天 / 7天 多时间跨度平滑可视化。

### 4. 毛玻璃质感控制台与原生仪表盘
- **双皮肤体系**：「人文羊皮纸 · Claude」与「流光毛玻璃 · 原版」无刷新一键切换，各自独立保存深浅色主题。
- **全分流动态流光推演拓扑**：支持全部全景、国内直连、国外无污染、广告拦截等模式高亮切换；支持输入域名动态推演全链路解析路径与决策卡片，粒子引擎自动沿决策路径流动巡礼。
- **秒级实时脉冲监控**：运行时长秒级精准跳动，2秒轻量更新进程 CPU 与真实 RSS 内存，离开概览页自动销毁定时器。
- **双重防崩溃加固**：防御性选择器安全查询，彻底根除空指针解引用崩溃（“无法加载当前页面”）。

---

## 快速使用指南

### 方案 1：Apple 官方原生加密 DNS 描述文件 (首选推荐 · 零外挂 · 零耗电)
1. 在 LocalDNS 原生仪表盘中点击 **【一键安装 Apple 官方纯净 DNS 描述文件】**，Safari 点击允许下载；
2. 打开 iPhone「设置」➔ 顶部点击「已下载的描述文件」➔ 安装「LocalDNS 原生纯净加密 DNS」（已自动合入根证书与 DNS 设置）；
3. 前往「设置」➔「通用」➔「关于本机」➔「证书信任设置」，开启 **LocalDNS Root CA** 完全信任；
4. 前往「设置」➔「通用」➔「VPN 与设备管理」➔「DNS」中勾选 **LocalDNS 原生纯净加密 DNS** 即可全局生效！

### 方案 2：Surge 专属安全 DoH
1. 在 LocalDNS 原生仪表盘点击「安装 CA 根证书」，并在 iOS 证书信任设置中开启信任；
2. 点击「复制 Surge DoH 配置」，粘贴至 Surge 配置文件的 `[General]` 节点：
   ```ini
   [General]
   doh-server = https://127.0.0.1:9443/dns-query
   skip-proxy = 127.0.0.1, localhost, *.local, 192.168.0.0/16
   ```
3. 开启 Surge，全设备 DNS 查询瞬间由本地 18.5 万条 AdGuard 广告规则直接黑洞化！

### 方案 3：Shadowrocket (小火箭 · 免证书全局接管)
1. 点击「复制通用 DoH 地址」，获得 `http://127.0.0.1:9099/dns-query`；
2. 打开小火箭 ➔ 底部「设置」➔「DNS」➔「DNS 覆写」，粘贴该地址并保存；
3. 返回小火箭首页开启开关即可全局生效。
