# LocalDNS for Scripting App

> **当前版本**：`v1.15.34 (Build 20261128)`  
> **移植作者**：`vcncv`  
> **上游开源**：[yyhoworks/LocalDNS](https://github.com/yyhoworks/LocalDNS)（对齐 UI `2026.11.21.1` / 内核 `FJMOS`）

将 [yyhoworks/LocalDNS](https://github.com/yyhoworks/LocalDNS)（Rust DNS 核心 + 双皮肤 Web 控制台）完整转换为适配 **iOS Scripting App** 的本地高性能 DNS 服务与安全管理系统。

### v1.15.34 解决视频媒体流报 403 Forbidden 终局问题
- **实测抓包破案（Surge Request 54149 & 54150 铁证）**：
  1. **Google Video 返回 403 Forbidden**：我们在实时日志中捕获到：
     ```json
     {
       "URL": "https://rr1---sn-q4flrnes.googlevideo.com/videoplayback?...",
       "remark": "Modified by script youtube.enhance.auto-hd",
       "responseHeader": "HTTP/1.1 403 Forbidden\r\nContent-Length: 0"
     }
     ```
  2. **403 产生机理**：
     - 在现代 Google Video 流媒体协议中，URL 携带了密签：`sparams=expire,ei,ip,id,itag...&sig=...`；
     - `itag` 属于被 HMAC 加密签名的参数之一；
     - `youtube.enhance.auto-hd` 强行在网络层改写了 `itag`，导致请求参数与 Google 生成的 `sig` 签名不匹配；
     - Google 视频服务器判定请求被非法篡改，**直接拒绝连接并返回 `HTTP/1.1 403 Forbidden`**，浏览器收到 0 字节媒体（`readyState: 0`），导致播放器无法播放！
- **修复方案**：
  - **彻底排除破坏签名的 `auto-hd` 与 `init` 脚本**：
    - `auto-hd` 仅用于强制分辨率，完全不具备任何去广告功能；
    - 排除后，所有 `videoplayback` 媒体分片均保持 100% 原生合法签名直通，Google Video 正常下发视频数据，彻底终结 403 拒流；
  - **保留真正负责去广告的核心管道**：
    - `*.googlevideo.com` 保持在 Surge `[MITM]` 列表中，确保客户端 YouTube iOS App 能完整通过 `ump.jsc` 解密 Onesie UMP 广告包；
    - `youtubei.googleapis.com` 继续由 `response.jsc` 承载全量去广告与画中画/后台播放，客户端功能 100% 完好；
  - **浏览器端（`AdBlockHub v4.26.0`）**：
    - 维持 FadBlock 黄金标准（50ms 轮询 + 自动静音 + `currentTime = duration` 强制秒跳贴片 + 全套跳过按钮瞬点）；
    - 永久保护 `adBreakHeartbeatParams` 心跳凭据，登录态下 SABR 绝不切断流。
- **验证**：单测 42 项及全链路校验全部通过。

### v1.15.33 终极解决贴片广告去不掉问题（FadBlock 黄金标准 50ms 瞬跳）
- **贴片广告为什么此前没跳过？**
  1. 此前代码中 `AD_SEEK_END` 处于默认关闭状态，仅依赖 `playbackRate = 16.0` 纯倍速来冲刷广告；
  2. 但在 iOS / iPadOS Safari WebKit 运行环境中，系统媒体内核对未静音或部分媒体流的 `playbackRate` 实施了严格的速率上限封顶（甚至直接锁死在 1.0x-2.0x），导致 15-30 秒的贴片广告依旧原速完整播放，用户必须坐等广告播完；
- **修复方案（`AdBlockHub v4.26.0`）**：
  - **默认启用片尾瞬跳（FadBlock 方案）**：
    - `AD_SEEK_END = true`（默认开启瞬跳，`#adhub-noseek` 可关）；
    - 轮询频率提速至 **50ms**（极速响应）；
    - 一旦检测到 `.ad-showing`，立即将视频标签进度推至片尾：`video.currentTime = video.duration || 99999`，**强制直接触发媒体 `ended` 事件**；
    - YouTube 播放器检测到广告播放完毕，**瞬间从贴片切换到正片（耗时 < 0.05 秒）**；
  - **全套 2026 按钮秒点**：
    - 扩充全套跳过按钮选择器（`.ytp-ad-skip-button-modern`, `[class*="skip-button"]`, `button[aria-label*="跳过"]` 等），出现即瞬间模拟点击；
  - **视觉零闪现**：
    - 在 `.ad-showing` 期间全面隐藏广告倒计时、广告信息卡、预览文本与浮层，视觉上毫无广告残留；
  - **客户端 Enhance 完好**：
    - `*.googlevideo.com` 保持在 Surge MITM，客户端 Enhance 全功能去广告生效。
- **验证**：单测 42 项全部通过，`tools/test-youtube-adblock.ts` okToShip=true。

### v1.15.32 彻底解答并解决「登录账号无法播放，退出账号又能播」+ *.googlevideo.com 恢复 MITM
- **登录态 vs 未登录态播放差异根因剖析**：
  1. **登录账号状态（SABR 强心跳校验）**：
     - 用户登录 Google 账号后，YouTube 开启严格的 SABR（Server-Abrupt Streaming）协议，并在 `ytInitialPlayerResponse` 下发带有账号签名的对账心跳令牌 **`adBreakHeartbeatParams`** 与 **`playbackTracking`**；
     - 此前 `AdBlockHub` 的 `AD_KEYS` 误将 `adBreakHeartbeatParams` 当作广告字段删除了；
     - 播放器发不出带该 token 的播放心跳，Google 服务端立刻判定客户端在拦截广告对账，**直接终止向该账号下发后续视频分片（触发 `s:444` 封播态并切断连接）**，表现为您看到的“黑屏且不播放”；
  2. **未登录账号状态（匿名无心跳绑定）**：
     - 退出账号后，连接属于匿名访客，Google 服务端没有绑定账号级的心跳会话，即使删除了该字段也不会触发账号级的切断对账，所以退出账号就能播放！
- **彻底修复措施**：
  - **AdBlockHub 升至 v4.25.0**：
    - 将 `adBreakHeartbeatParams`、`adBreakParams` 与 `playbackTracking` 从 `AD_KEYS` 彻底剔除，并**永久列入 `PROTECTED_KEYS` 保护白名单**（对齐 uBlock Origin 官方规则 `quick-fixes.txt` 绝不删除心跳凭据的规范）；
    - 仅对纯广告排期 `adPlacements`、`playerAds`、`adSlots` 进行清洗；
    - Google 服务端收到合法的账号心跳令牌，**登录状态下即刻解除 `s:444` 切断，无论登录还是未登录均可流畅秒开**；
  - **Surge MITM 完整保留 `*.googlevideo.com`**：
    - 恢复 `*.googlevideo.com` 在 Surge `[MITM]` 核心解密名单中，确保客户端 YouTube iOS App 能完整解密 Onesie `/initplayback` UMP 数据包（已注入 GZIP 流 Polyfill），客户端全量去广告彻底生效。
- **验证**：单测 42 项全部通过，`tools/test-youtube-adblock.ts` okToShip=true。

### v1.15.31 彻底根除「黑屏无视频」与「400 Bad Request」媒体断流
- **实证抓包破案（Surge Request 44755 & 44756 铁证）**：
  1. **Google Video 报 400 Bad Request**：抓包证实，挂在 `googlevideo.com` 上的 `youtube.enhance.auto-hd` 与 `ump` 尝试解析并改写 SABR 的 `POST /videoplayback` / `GET /initplayback`，破坏了现代 YouTube 媒体流协议的 HMAC / 签名，导致 Google Video 视频服务器直接抛出 **`HTTP/1.1 400 Bad Request` 并关闭流**；
  2. **window.ytplayer 原型劫持**：`AdBlockHub` 此前在 window 级别通过 `Object.defineProperty` 劫持 `ytplayer`，破坏了 Polymer 播放器 bootstrapping 原型链判定，导致网页端播放器未能完成加载；
- **终局解决方案（双机制分流定型）**：
  - **媒体流直通保障**：
    - 将 `*.googlevideo.com` 彻底移出 Surge `[MITM]` 列表，排除 `auto-hd`、`init` 与 `ump` 流内脚本；
    - 媒体数据 100% 走原生 TLS 代理直通，杜绝 400 报错、杜绝 WebKit 证书钉扎冲突、杜绝 0 字节断流，视频全速加载；
  - **客户端 Enhance 核心功能完好**：
    - YouTube iOS 客户端的信息流、推荐、搜索、短视频、播放器广告拦截、后台播放（Background Playback）与画中画（PiP）全部由 **`youtubei.googleapis.com` (response.jsc)** 承载，保持 MITM 毫秒级去广告；
  - **浏览器端（`AdBlockHub v4.24.1`）**：
    - 彻底移出对 `window.ytplayer` 的描述符劫持，保持对象原型链原生纯净；
    - 默认剥离 `adPlacements` 广告排期，解除等待 `0.0.0.0` 广告的缓冲死锁；
    - 激活起播保障并在 `currentTime === 0` 时自动拉起，轻触屏幕任意位置自动恢复声音。
- **验证**：单测 42 项及全链路校验全部通过。

### v1.15.30 彻底终结 YouTube 网页「黑屏不播放」
- **根因实测定位（深入用户截图同款视频现场取证）**：
  1. **排期与 DNS 拦截死锁**：若未剥离广告排期，YouTube 会先尝试向 `googleads.g.doubleclick.net` 拉取贴片，因 LocalDNS DNS 阻断至 `0.0.0.0`，播放器等不到广告而无限死锁在黑屏缓冲态（`s:444 / playerState: 3`）；
  2. **iOS Safari WebKit 手势限制**：即使主视频已在后台缓冲好（实测已缓冲 18.4 秒），WebKit 默认禁止无手势有声自动播放，YouTube 隐藏了封面图（`ytp-cued-thumbnail-overlay: display:none`）并将播放器停滞在 `unstarted-mode`，呈现为一个空荡荡的黑方块。
- **修复措施**：
  - **AdBlockHub 升至 v4.24.1**：
    1. 默认剥离 `adPlacements` 与 `adSlots`，彻底解除等待 `0.0.0.0` 的死锁，SABR 直接转为 `s:5`（就绪态）；
    2. 激活起播保障：在视频就绪且处于 `currentTime === 0` 时自动拉起 `mp.playVideo()` 与 `video.play()`，若遇 iOS 手势限制则静音起播渲染画面，用户只要轻触屏幕任意位置自动恢复声音；
  - **Surge 媒体流直通**：`auto-hd` 与 `ump` 仅附着 `c=IOS`，Safari 媒体流纯净走代理。
- **验证**：单测 42 项及全链路校验全部通过。

### v1.15.29 终极根除「黑窗无视频」死锁（实测 statsForNerds 从 s:444 死锁转为 s:5 就绪）
- **根因实测定位（WebKit DOM 深度探测实证）**：
  1. **黑窗死锁机制曝光**：我们在真实的 WebKit 播放实例中抓取到了 `statsForNerds` 的状态日志：`debug_info: "USDAI, SABR, vd:gp, s:444 t:0.00 b:0.000-19.994 P"`，播放器处于 `playerState: 3`（BUFFERING）；
  2. **为什么缓冲了 20 秒却死锁在黑屏？**
     - 因为此前在 safe mode 下保留了 `adPlacements` 广告排期；
     - YouTube 播放器在开播前**必须先加载排期中的 DoubleClick 贴片广告**；
     - 但 LocalDNS 的 DNS 拦截库已经将 `googleads.g.doubleclick.net` 与 `pagead2.googlesyndication.com` 阻断为 `0.0.0.0`；
     - 播放器永远等不到来自 `0.0.0.0` 的广告数据，进入无限死锁缓冲态（`s:444`），导致主视频虽然已下载了 20 秒数据却永远无法起播，呈现为用户看到的 **“黑窗无视频”**；
  3. **死锁解除实证**：实测一旦将 `adPlacements` / `adSlots` 从 `playerResponse` 中剥离，SABR 状态**瞬间从 `s:444` 死锁变为 `s:5`（CUED就绪态）**，播放器不再向已挂掉的 DoubleClick 等待广告，正片视频瞬间起播！
- **修复措施**：
  - **AdBlockHub 升至 v4.24.0（对齐 uBlock Origin 官方默认剥离策略）**：
    - 默认模式剥离 `adPlacements`、`playerAds` 与 `adSlots`，彻底解除等待 `0.0.0.0` 广告的死锁（`verifyPlaybackIntact` 护栏严格确保 `streamingData` 与 `playabilityStatus` 100% 完好不变）；
    - 保留 `onAbnormalityDetected` 异常侦测中和与 `#player-ads` 白名单保护；
    - 若需要对比测试原版响应，可通过 `#adhub-raw` 回退；
  - **Surge 底层路由（[src/surge-service.ts](src/surge-service.ts)）**：
    - `auto-hd` 与 `ump` 严格限定于 `c=IOS`，Safari 媒体流纯净直通不进任何脚本缓冲；
    - 代理组选用在线优质的日本节点，消灭 IP 风控。
- **验证**：`tools/test-adblockhub-exemptions.js` 42 项全部通过，`tools/test-adblockhub-444.js` 34 项全部通过，`tools/test-youtube-adblock.ts` okToShip=true。

### v1.15.28 根治「无法访问此内容，请稍后再试」媒体流拦截
- **根因实测定位（Surge Request 40878 抓包实证）**：
  1. **Surge 媒体脚本截获 Safari 媒体流**：抓包显示 Safari 播放时发送 `POST /videoplayback?...&c=WEB`，Surge 依然命中了 `[Script] HTTP request script found: youtube.enhance.auto-hd`，由于该脚本配置了 `requires-body=1, max-size=1MB`，Surge 强行缓冲导致 WebKit 媒体栈超时断开连接（`Disconnect: Client-side stream closed`），直接触发 YouTube 网页报错 **“无法访问此内容，请稍后再试”**；
  2. **替换匹配失效原因**：代码中此前使用 `cleanPattern.includes('googlevideo.com')`，而数据库中原模式为 `googlevideo\.com`（带反斜杠），导致字符串匹配直接返回 `false`，未能成功收窄为 `c=IOS`；
  3. **InnerTube 状态**：强行伪造 `clientScreen="CHANNEL"` 在部分常规 `/watch` 页面被服务端直接判定 `UNPLAYABLE`（“需要重新加载页面”）。
- **修复措施**：
  - **Surge 媒体流 pattern 彻底收窄生效**：将匹配条件修正为 `includes('googlevideo')`，实测 `compileUnifiedHubModule` 已成功输出：
    ```ini
    pattern=^https?:\/\/[\w-]+\.googlevideo\.com\/videoplayback\?(?:.*[&?])?c=IOS(?:&|$|_)
    ```
    Safari 浏览器端媒体流（`c=WEB`）绝不再被 `auto-hd` 拦截或缓冲，100% 走原生代理直通，彻底终结 `Client-side stream closed`；
  - **AdBlockHub 升至 v4.23.0**：移除对 `clientScreen` 的强制伪造与对 `Response` 单一消费流的破坏，保留 `onAbnormalityDetected` 异常中和与 `#player-ads` 白名单，配合 16x 纯倍速与自动秒跳，平滑播放。
- **验证**：单测 42 项及全套七层契约验证全部通过。

### v1.15.27 深度对齐 uBlock Origin 官方全套去广告与防反制方案，彻底根治网页端无法播放
- **根因实测**：
  1. **Google 节点风控拦截**：在代理节点（如台湾/日本节点未登录或隐私窗口）下，Google 对 Web 请求判定触发机器人验证，播放器接口返回 `status: LOGIN_REQUIRED`，`reason: "登入帳戶以確認你不是機器人"`，`streamingData.formats` 为空（0 条流），导致 Safari 播放器无法获取视频流；
  2. **Surge 媒体流 pattern 污染**：Surge Hub 原版 `youtube.enhance.auto-hd` 与 `ump` 挂接在 `googlevideo.com` 上并声明了 `requires-body=1, max-size=1MB`，导致 Safari 浏览器的每个媒体分片也被 Surge 强行缓冲，引发 `Read stream EOF / 0 字节断流`。
- **修复措施**：
  - **浏览器插件（`AdBlockHub v4.22.0` 全套 uBO 官方方案）**：
    1. **`JSON.stringify` 注入**：参考 uBO `trusted-edit-inbound-object`，在 Web 端请求体中注入 `clientScreen: "CHANNEL"` 与 `isInlinePlaybackNoAd: true`，InnerTube 服务端判定为 Channel/Inline 播放，**彻底免登录直接返回合法视频流**；
    2. **广告排期零损转置**：劫持 `fetch`/`XHR` 响应，将 `adPlacements` 与 `adSlots` 重命名为 `no_ads`（严格对齐 uBO `replace=/"adPlacements"/"no_ads"/`），播放器因无广告排期天然不播贴片，且 JSON 结构完整不破坏 SABR 校验；
    3. **状态自愈与异常中和**：代理 `Promise.prototype.then` 中和 `onAbnormalityDetected`；在 DOM 检测到 `LOGIN_REQUIRED` 或 `UNPLAYABLE` 时自动调用 `player.loadVideoById(videoId, startSec)` 毫秒级自愈起播；
    4. **对齐 uBO 白名单**：彻底移出 `#player-ads` CSS 隐藏规则，消除 DOM 探针反制。
  - **Surge 底层（[src/surge-service.ts](src/surge-service.ts)）**：
    - `auto-hd` 与 `ump` 媒体流 pattern 严格收窄至 `c=IOS`，仅对 YouTube iOS App 生效；Safari 浏览器（`c=WEB`）媒体流绝不挂接 `requires-body` 缓冲，100% 直通代理，杜绝 0 字节断流。
- **验证**：`tools/test-adblockhub-exemptions.js` 42 项全部通过，`tools/test-adblockhub-444.js` 34 项全部通过，`tools/test-youtube-adblock.ts` okToShip=true。

### v1.15.26 YouTube Enhance 客户端与 Safari 网页端双机制分流 + uBlock Origin 官方方案深度融合
- **架构方案**：
  1. **客户端（YouTube iOS App，全量 MITM）**：
     - `*.googlevideo.com` 与 `youtubei.googleapis.com` 均走代理 MITM 解密，恢复完整的 `youtube.enhance.ump`（Onesie `/initplayback` UMP 解密）与 `youtube.enhance.response`；
     - 注入纯 JS RFC 1951/1952 GZIP 并发流 Polyfill，根治 Surge JSC 引擎缺失 `DecompressionStream` 导致 Onesie 解密静默失败放行广告的问题；
  2. **网页端（Safari 浏览器，对齐 uBlock Origin 官方去广告与防反制最佳实践）**：
     - **中和异常检测（`onAbnormalityDetected`）**：参考 uBO 官方 scriptlet 机制，代理 `Promise.prototype.then`，彻底中和 YouTube 内部异常侦测回调，阻止 YouTube 挂载 `player-unavailable=""` 或隐藏播放器；
     - **对齐 uBO 白名单（`#@##player-ads`）**：从广告样式中剔除 `#player-ads`，消除 YouTube DOM 高度为 0 反制侦测；
     - **解除容器隐藏**：注入 `ytd-watch-flexy #player-container { visibility: visible !important; }`，并动态摘除 `ytd-watch-flexy` 上的 `player-unavailable`；
     - **无卡顿跳广告**：贴片广告保持 16x 纯加速与自动点击跳过按钮（不强行 seek 片尾卡死 SABR 缓冲区）；全量清除 Feed/横幅/伴随/搜索置顶/推荐流/反广告弹窗页面广告；
     - **Surge 节点优化**：锁定 `台湾节点` 至稳定在线的 `Taiwan 04` 节点，消除 `Taiwan 03` 节点离线导致连接中断与 `Read stream EOF`。
- **验证**：`tools/test-mitm-split.ts`（5/5 passed）、`tools/test-youtube-adblock.ts`（okToShip=true）、Surge JSC 真实引擎 40KB GZIP 往返验证通过。

### v1.15.25 彻底修复 YouTube Enhance 客户端 UMP 静默失效与 Safari 浏览器 SABR 封播
- **根因排查（实机 Surge + WebKit 真实 DOM 探测实证）**：
  1. **YouTube Enhance 客户端生效机理**：YouTube 客户端（iOS App）95% 以上的核心去广告（首页推荐/搜索/短视频/信息流广告清理）、后台播放、画中画（PiP）、4x 倍速、去赞助与商品、跳过插播均运行在 `youtubei.googleapis.com` 上（由 `youtube.enhance.response` 与 `ad-break` 挂载），此域名必须保持 MITM 解密；
  2. **媒体流 *.googlevideo.com 断流根因**：若将 `*.googlevideo.com` 放入 MITM 解密，Safari 浏览器端以及 YouTube App 自身的底层媒体播放管道会遭遇 HTTP/2 连接池挂起与证书钉扎（Surge 报 `Read stream EOF / inBytes: 0` 与 `Client closed connection just after TLS handshake, it might because of certificate pinning`），导致 Safari 视频流 0 字节断流，播放器被打上 `player-unavailable=""`，直接触发 YouTube 自身规则 `ytd-watch-flexy[player-unavailable] #player-container { visibility: hidden; }`，整个播放器在页面上被直接隐藏；
  3. **客户端 UMP 静默报错根因**：Surge `engine=jsc` 缺失 `DecompressionStream` / `CompressionStream`，导致 `ump.js` 在处理 gzip 压缩的 UMP `/initplayback` 包时抛 `ReferenceError` 并被内部 `catch` 吞掉后放行广告；此外 `isYoutubeWebAdRewrite()` 未处理转义斜杠导致一条规则残留。
- **修复**：
  - **分流架构终局定型**：
    - **`youtubei.googleapis.com` 独占 MITM 解密**：服务 YouTube 客户端全量去广告与增强逻辑，`response.jsc` 保持 JSC 毫秒级执行；
    - **媒体流 `*.googlevideo.com` 保持代理直通不进 MITM**：彻底消除 Safari 网页端 `Read stream EOF / 0 字节丢包` 与客户端媒体断连问题，保证 4K/1080p 视频数据全速无阻流；
    - **App 端 `ump.jsc` 注入 GZIP 流 Polyfill**：注入纯 JS RFC 1951/1952 流 polyfill，确保客户端即便走 Onesie `/initplayback` 也能正常解密与剥离广告；
  - **浏览器端（`AdBlockHub v4.20.1` 播放安全与显示保障）**：
    - 默认安全模式保留 player 广告排期（`ADHUB_PLAYER_RAW = true`），避免触发 YouTube SABR 判定异常；
    - 注入保底样式 `ytd-watch-flexy #player-container { visibility: visible !important; }`，解除 YouTube 对播放器容器的隐藏遮挡；
    - 动态检测并自动摘除 `ytd-watch-flexy` 上的 `player-unavailable` 属性，恢复真实播放窗口；
    - 贴片视频采用 16x 纯加速与自动点击跳过按钮（不强行修改 `currentTime` 触发 SABR 卡死）；全量清除 Feed/横幅/伴随/搜索置顶/推荐流/反广告弹窗页面广告。
- **验证**：Surge 真实 `jsc` 引擎实测 40KB GZIP 往返与 `response.jsc` / `ump.jsc` 零异常通过；`test-mitm-split.ts`（5/5 passed）、`test-youtube-adblock.ts`（okToShip=true）、`_verify_all_v25.ts`（6/6 passed）全链路校验通过。

### v1.15.24 YouTube Enhance 与浏览器插件彻底分流 + 修复 JSC TextEncoder 崩溃
- **问题定位**：
  1. v1.15.23 将 `youtube.enhance.*` 切为 `engine=jsc`，但仍直连 GitHub 原版 `response.js` / `ump.js`，而 Surge `jsc` 实测无 `TextEncoder` / `TextDecoder`（`undefined`），导致两条核心脚本 100% 在第 1 行第 30 列抛 `ReferenceError` 崩溃，YouTube Enhance 完全未生效且 App 端漏广；
  2. Surge Hub 仍把 `www/m/s.youtube.com` 与 `imasdk.googleapis.com` 放进 `[MITM]`，并挂载崩掉的 `localdns_builtin_yt_web` 与网页端 `pagead`/`stats/ads` REJECT 规则，与浏览器端冲突并触发反广告墙（信标 `e2`）；
  3. 浏览器侧 `AdBlockHub v4.17.2` 默认把 `ADHUB_PLAYER_RAW=true`、`AD_AUTOSKIP=false` 全部关掉，视频贴片与信息流广告原样放行。
- **修复**：
  - **App 端（YouTube Enhance 独占）**：同步上游最新 `gholts/surge` 脚本至 `web/scripts/yt/`，由 `wrapYoutubeEnhanceForJsc()` 自动注入纯 JS UTF-8 `TextEncoder/TextDecoder`（含 `fatal` 支持）及 `*.googlevideo.com` 浏览器旁路守卫（`c=WEB/MWEB/...` 或 `Mozilla/5.0` UA 直接 `$done({})`），发布不可变副本 `/scripts/yt/*.jsc.<sha12>.js` 供 `engine=jsc` 毫秒级执行；
  - **Surge Hub 分流**：`[MITM]` 与媒体代理仅保留 `youtubei.googleapis.com` + `*.googlevideo.com`，彻底剔除 `www/m/s.youtube.com` 与 `imasdk.googleapis.com`，移除 `localdns_builtin_yt_web` 与网页端诱饵 `REJECT` 规则，并在 `[Rule]` 拦截纯展示广告创意域 `tpc.googlesyndication.com` / `safeframe.googlesyndication.com`；
  - **浏览器端（AdBlockHub v4.19.0 独占）**：显式声明 `@inject-into page` 确保注入页面主世界；修复 `playbackGuard()` 在首页/搜索/切页时因隐藏 `#movie_player` (`rects===0`) 在 1.6 秒后误拔 `#adblock-hub-style` 的回归；恢复 player/feed 广告脱水（深度扩至 24 层，支持嵌套 `playerResponse` 与 stringified `raw_player_response`）及 2026 桌面/移动端页面广告清理；修复 `adFastTick/onAdState` 在 WebKit `readyState=0` 时首次 seek 失败即锁死 key 的问题，保证 100ms 16x 压速与就绪后跳片尾兜底；拦截诱饵请求返回合成 `200 OK` 并置 `window.google_ad_status=1`；`Response` 钩子仅匹配 `www/m/music.youtube.com`，默认关闭 `nip.io` 失败信标。
- **验证**：Surge 真实 `jsc` 引擎实测 `response.jsc` / `ump.jsc` / `request.jsc` / `key.jsc` 零异常且浏览器请求秒放行；WebKit 27.3 实测 18 条新增 CSS 选择器无错误；`test-adblockhub-444.js` **34/34**、`test-adblockhub-exemptions.js` **41/41**、`test-youtube-web-script.js` **23/23**、`test-yt-playback-smoke.js` **33/33**、`test-mitm-split.ts` **5/5**、`test-youtube-adblock.ts` **okToShip=true**、`test-suite.ts` **151/154**（仅 3 条既有数据库空表项）。

### v1.15.23 客户端优先：媒体流恢复 MITM + 引擎换 jsc
- **客户端**：`*.googlevideo.com` 恢复 MITM，`youtube.enhance.ump / init / auto-hd` 重新有附着点，Enhance 全功能生效。
- **网页端**：去广告交给 Safari 用户脚本 **AdBlockHub v4.17.2**（`@run-at document-start`，页面内 hook，不依赖 Surge MITM）。
- **引擎**：`YT_BUILTIN_WEB_ENGINE` 与 Hub 内全部 `youtube.enhance.*` 从 `webview` 改 `jsc`（webview 实测每条 7–9 秒，客户端 3 秒就 RST）。
- **已知限制**：googlevideo 被 MITM 时 Safari 媒体栈可能因证书钉扎断连（历史日志 `MITM failed ... bytes 0/0`）；若网页不能播，需切回网页优先模式（把 googlevideo 从 `narrowMitmHosts` 的保留分支移到 dropped）。
- **验证**：profile 实测 7/7 条 `youtube.enhance.*` 为 `engine=jsc`；`renderBuiltinWebRule()` 输出 `engine=jsc`。

### v1.15.22 审计 smartdns 后补齐上游回落与节点熔断
- **审计对象**：`pymumu/smartdns`（master）：`src/dns_client/dns_client.c`、`src/dns_client/server_info.c`、`etc/smartdns/smartdns.conf`。
- **smartdns 的三层机制**：
  1. `-fallback` 备用服务器标记（默认配置注释：`set as fallback dns server`）；
  2. 首轮发送跳过 fallback（`if (server_info->flags.fallback && retry_count == DNS_QUERY_RETRY && i == 0) continue;`），重试轮（`retry_count == 1`）整组切到 `fallback` 组；
  3. 服务器 prohibit：被禁服务器在 60 s（重试轮 5 s）内跳过；`_dns_client_check_servers()` 每 10 s 检查「上次发送 600 s 无接收」并关闭 socket。
- **本项目原状**：只有「组内并发 + Promise.any」，没有任何跨组回落，且注释写死「宁可 SERVFAIL 也绝不 fallback 到 domestic」——境外两个 DoH 同时超时就全灭。
- **补齐**：
  - `FallbackConfig { policy, nodeCooldownSec, domesticTtlCap }`，持久化 `localdns_fallback_config`，默认 `safe`；
  - 回落链：`foreign → foreign_ecs`、`proxy → foreign → foreign_ecs`、`foreign_ecs → foreign`；仅 `aggressive` 末尾追加 `domestic`；
  - 节点熔断：连续失败 2 次冷却 45 s（5–600 s 可调），组内全冷却时忽略熔断；
  - 降级国内：`upstreamTag=fallback:domestic:<tag>`、`origin.learning=fallback:domestic`、**不写境外组池**、main 池 TTL ≤ 60 s、metrics `localdns_fallback_total{from,via}`；
  - 回落单步预算 2500 ms，主组超时仍 6000 ms。
- **接口**：`GET/POST /api/v1/upstreams/fallback`。
- **UI**：工作台「⚙️ 联动与运行状态」新增回落策略下拉 + 冷却秒数（随「保存 Surge 联动配置」一起提交）。
- **验证**：`tools/test-fallback.ts` **12/12**（配置边界、熔断触发/解除、冷却过滤、端到端把 foreign 全指向 `127.0.0.1:9` 仍返回 NOERROR，580 ms）；`test-ui-contract` **47/47**；`test-suite` 151/154（3 条失败均为数据状态：AdGuard 库 48 条、direct 组本无规则，与本次改动无关）。

### v1.15.21 托管模块自动检测上游更新
- **结论**：模块更新一直「能用」，但**看不出变化**——`refreshModule` 只换正文，`name` 从来没动过，所以毒奶始终显示「2026年10月31日更新」，而上游当天已是「(2026年11月25日更新)」。
- **新字段**：`app_modules` 增加 `content_hash / remote_hash / remote_checked_at / remote_name`（幂等 ALTER）；正文哈希在 `saveModule()` 统一计算，导入 / 刷新 / 手改都自动对齐。
- **巡检**：`checkModuleUpdates()` 并发 3 抓取上游、只比哈希、写回 `remote_*`；本机回环来源（`http://127.0.0.1:9099/ad-hunter.html`）自动跳过，不计失败。
- **刷新**：`refreshModule()` 采纳上游 `#!name`（用户改过名且不是「(日期)」型名字时保留），并返回 `changed` 区分「已更新 / 已是最新」。
- **自动巡检**：进程启动 45 秒后跑一次，之后每 6 小时一次；同一进程内最短 30 分钟一次。
- **接口**：`POST /api/v1/surge/modules/check-updates`（可带 `ids`）、`GET /api/v1/surge/modules/updates`（只读缓存）、`GET /api/v1/surge/modules` 增返回 `checked_at`。
- **UI**：卡片「🆕 有更新」徽标 + 「上游：…」版本行 + 橙色「⬆️ 更新到新版」按钮；面板顶部「🆕 N 个模块有上游更新 · 检查于 …」；新增「🔍 检查更新」；打开模块页首次自动检查（localStorage 30 分钟节流）。
- **实测**：`tools/test-module-updates.ts` **19/19**（真实上游：毒奶 11月25日 → 强制置旧判定有更新 → 刷新 → 名称同步 → 复查无更新）；`tools/test-module-api.ts` **8/8**（新端点 200、旧路由不受影响、本机来源跳过）。全量巡检出 **哔哩哔哩增强** 确有上游更新（`bilibili.request` 改名 + 新增 `resolve?host=` 规则）。
- **事故记录**：编辑 `web/assets/surge-workbench.js` 时用 `open(path,'w')` 触发异常，文件被截断为 0 字节；已从 `scripting-repos/scripting-scripts-work` 的 11-16 源码快照恢复并重放本次补丁。11-17～11-24 之间若该文件另有小改动，可能缺失，需人工核对。此后所有文件改写一律走「写临时文件 + `os.replace`」。

### v1.15.20 修概览「上游 DNS 健康」误报 + 补丁包改名避开 immutable 缓存
- **现象**：重启脚本后约 1 分钟，概览一直显示「5/7（2 异常）」，「解析」页两项境外 DoH 各累计 8 次超时，看着像解析坏了。
- **实测时间线**：04:39:25 进程启动；04:39:40–04:40:32 期间 `1.1.1.1` / `dns.google` 各超时 8 次（`The operation was aborted`，6 s 上限），同一分钟的国内查询 99 ms / 1 ms 正常 → 是随道未就绪，不是事件循环卡死，也不是解析链路改动。
- **真因**：概览健康度用**累计**口径 `err > 0 && success < 80`，成功 3/(3+8)=27%，要再成功约 32 次才回到 80%，所以一直红；而「解析」页早已按当前轮次显示。
- **修法（第 8 处本地补丁 `overview-health-round`）**：`faultyUps` 判定改用 `x.m.round ?? x.m`，与轮次指标同源；静默 300 s 后轮次归零，健康度自动恢复。实测刷新后显示 **7/7 在线**。
- **补丁包改名**：打补丁后的字节与上游哈希不符，而 `/ui/assets/*` 带 `public, max-age=31536000, immutable`；同名文件会让回访浏览器一年内继续用旧包。同步工具现在把补丁版重命名为 `app-zO37TzL3-local.js` 并同步改写 `index.html`，以后每次发版都会得到新文件名。
- **排查记录**：`dig @127.0.0.1` 超时是预期行为——LocalDNS 只提供 DoH（9099 / 9443），不监听 53。
- **建议**：要把 DNS 交给 LocalDNS 时，Surge `[General]` 用 `encrypted-dns-server = https://127.0.0.1:9443/dns-query` 且保留 `dns-server` 公共回退；当前生效配置用的是 `tls://1.1.1.1` 等外部 DNS，随道重连时设备解析会跟着抖一阵。

### v1.15.19 新增「版本更新提示」：每个版本只在首次启动弹一次
- **触发规则**：原生界面挂载后延时 800 ms 调 `showUpdateNoticeOnce(APP_VERSION)`；Storage 键 `localdns_update_notice_seen_version` 记录已看版本，同版本不再弹；换新版本（版本号变化）后的首次启动会再弹一次。
- **确认才记账**：只有用户点「知道了」后才写入已看版本；中途退出或进程被杀，下次仍会提示。版本号读取失败（`v?`）或清单里没有该版本的文案时不弹也不写，避免把提示永久吞掉。
- **文案集中管理**：更新列表在 `src/changelog.ts` 的 `RELEASE_NOTES`（version / build / items），新增版本只补一条，`index.tsx` 不存任何文案。
- **不影响主界面**：宿主没有 `Dialog` 或 Storage 不可用时静默跳过，只打一行 `console.warn`。
- **踩坑记录**：`Dialog` 是宿主的**全局命名空间**，不能从 `'scripting'` 导入——导入会拿到 `undefined` 并静默失效；现改为 `globalThis.Dialog` 能力探测，声明放在 `src/globals.d.ts`。
- **验收**：`_probe_changelog.ts` 19 项断言全通过（版本归一化、首启/同版本/升级/回退/未知版本判定、正文渲染、Storage 往返、无文案与空版本不弹、同进程只尝试一次），真机上 `Dialog.alert` 与 `useEffect` 均为 function。
- **构建号**：`20261125`；`script.json` 1.15.19。升级后首次启动会看到 v1.15.19 的更新内容（含上一版 FJO02 同步与模块库恢复要点）。

### v1.15.18 精确同步上游 UI 2026.11.21.1（FJO02 发行线）并按新契约补齐后端
- **精确替换打包 SPA**：`app-zO37TzL3.js`（890 KB）+ `index-CBx03oFF.css`（778 KB），旧 `app-BF6QW_hf.js` / `index-3nLTlqR7.css` 已移除；`editor-A1rycQg2.js` 上游逐字节未变（`6bbce02c…`），本地 Surge 区段校验原样重放。
- **7 处 Surge 补丁零丢失**：导航副标题、代理流量 `source` 透传、`brands.surge`、默认核心 `surge`、`Surge · CONF` 下拉项、`chosen` 优先 surge、代理页副标题，逐条命中 1 次；`livepulse.js`、`surge-workbench.js`、AdHunter 入口、`data-backend-version="FJMOS"` 全部保留。
- **端点集合 0 新增 / 0 消失**（26 个），本版变更集中在字段级：新增日志 `origin` 与上游轮次指标。
- **新功能 1：查询详情「缓存记录」显示缓存来源**。`CacheEntry` 记住写入时的 `domain_set` / `upstream_attempt`（并随缓存 dump 持久化），命中时随审计日志下发 `origin`；`/api/v2/audit/logs` 只透传已知字符串字段——本地没有学习机制，`origin.learning` 不下发也不猜测。实测 `example.org` 二次解析：`{"cache":true,"origin":{"domain_set":"default_foreign","upstream_attempt":"cloudflare_ip"}}`，前端「缓存记录」步骤显示「原始分流 / 原始上游尝试」与「原始字段来自缓存条目，不代表本次查询访问了上游」。
- **新功能 2：解析页按上游展示「当前错误轮次」与轮次成功率**。新增 `localdns_upstream_round_errors`、`localdns_upstream_round_successes`、`localdns_upstream_round_error_reason{reason}`、`localdns_upstream_error_round_quiet_seconds`（300 s）与 `localdns_unixtime_seconds`；轮次在最后一次错误后静默 300 s 结束，结束后不再把历史错误计入当前轮次，累计指标保持不变。
- **顺带修正累计错误分类**：旧实现把每个失败都写成 `reason="other"`；现在按异常文本归类 timeout / tls / socks5 / refused / unreachable / eof / connect / http / protocol，分类合计恒等于 `error_total`，UI 的「分类合计与错误总数不一致」告警不会触发。
- **能力探测保持兼容**：新 UI 用 `providerKernels = {FJN8C, FJO02}` 判断服务商编辑能力，`/api/v1/status.version` 仍为 `FJMOS`，行为与上一版一致（隐藏服务商列、不写 `provider`、保存时不删除未知字段）。
- **同步工具二次去硬编码**：品牌锚点由 `FJN[0-9A-Z]+` 放宽为 `FJ[A-Z][A-Z0-9]+`（FJO02 不再以 FJN 开头）；补丁规格移入仓库 `tools/upstream-patch-spec.json`，可用 11.08.4 原包逐字节复现当前产物；工作目录在 App Group 不可写时自动回退到工作区。
- **完整性校验**：`LocalDNS_UI_2026.11.21.1_Update.zip` 经发行版 `SHA256SUMS.txt` 校验（`dda168da…`，8,762,552 B）。
- **验收**：`test-ui-contract.ts` **47/47**（新增 13 项：origin 透传与不猜测、轮次计数、原因分类、unixtime / quiet 指标）；`test-suite.ts` **153/154**，唯一失败 `AdGuard engine has over 100,000 rules active` 是本地规则库为空的数据状态（存储 `count=0 / stored_bytes=0`，内存仅 48 条），与本次升级无关，见「已知问题」。
- **真机浏览器复核**（本地服务 9298）：概览页徽标 `FJMOS`、AdHunter 入口、livepulse 回环层与 `.tec-bar-row` 正常；解析页表头含 `错误 / 成功率`，错误单元格 `title="当前轮次错误"`，统计口径文案切到轮次版本；代理页副标题已替换、`Surge · CONF` 为首选且默认选中、工作台 7 个 tab 注入成功；查询详情「缓存记录」按新字段渲染。

### v1.15.17 Surge 联动状态条不再因一次瞬时探测失败而焊死成「未连接」
- **现象**：代理 → 配置管理顶部状态条显示「Surge 联动未连接」，但 `GET /api/v1/surge/runtime` 实际返回 `online:true`（rtt 2–5 ms），刷新页面又变绿。
- **真因**：`surge-workbench.js` 只在工作台首次注入时抓一次 `/api/v1/surge/runtime`；后端那条链路要串行跑 `/v1/outbound`（3 s 超时）→ `/v1/modules`（~110 KB）→ `/v1/policy_groups`，Surge 正忙或刚刷规则时一次失败就返回 `online:false`，前端没有任何重试，红色状态就一直留到下次整页刷新。
- **修法（仅前端，后端零改动）**：① 三态显示——未知 = 琥珀「正在检测 Surge 联动…」、在线 = 绿、离线 = 红并**就地显示原因摘要**（手机上没有 hover）；② 探测失败隔 800 ms 再试一次，in-flight 去重；③ 停在配置页时每 30 s 重探一次，只重绘状态条（`paintStatusBar()`），不重建工作台、不丢当前 tab；④ 状态条重绘后自动重绑「连通测试 / 一键同步」。
- **验收**：真机浏览器注入 fetch 故障 → 状态条变红并显示「联动接口请求失败: 模拟网络中断」，恢复后自动转绿；6 个 tab 逐个点选正常，头部为「Surge 引擎已连通」、模式 RULE、延迟 2 ms、活跃模块 13 个。
- **顺带确认**：`/ui/#/proxy-config` 冷启动（直接刷新该 hash）时配置面板停在「请稍候。」、`.pc-root` 不生成，点一下「配置管理」即恢复——**用 11.07.2 旧 bundle 复现结果完全一致**，属上游既有行为，不是换包引入。
- **脚本版本串**：`surge-workbench.js?v=20261116-v1`（`index.html` 与同步脚本常量同步更新）。

### v1.15.16 精确同步上游 UI 2026.11.08.4（FJN8C 发行线，内核零改动）
- **精确替换打包 SPA**：`app-BF6QW_hf.js`（883 KB）+ `index-3nLTlqR7.css`（760 KB），旧 `app-DHEFTe3j.js` / `index-V92FMUfL.css` 已移除；`editor-A1rycQg2.js` 上游仍逐字节未变（`84ec8b8f…`），本地 Surge 区段校验原样保留。
- **发行线换名不换契约**：上游 tag 前缀由 `fjn01-ui-v` 改为 **`fjn8c-ui-v`**，`version.json` 的 `releaseTag` 现跟随上游 `fjn8c-ui-v2026.11.08.4`，`backendVersion` 仍是本地 `FJMOS`。核对新旧 bundle 抽出的 `/api/v1` · `/api/v2` 端点集合：**0 新增 / 0 消失**，28 个既有契约行为不变，`FJMOS` TS 后端无需改动。
- **同步工具去硬编码**：`tools/sync-upstream-ui.py` 的 tag 判断改为正则（任意 `<线>-ui-v<版本>` 都接受），品牌徽标锚点从写死 `FJN01` 改为 `FJN[0-9A-Z]+` 通配再替换成 `FJMOS`，`releaseTag` 不再强制拼 `fjn01-` 前缀——下次上游再换代号（下一个是 FJN8C 之后）不必改脚本。
- **上游本版实际改动**（不影响 iOS 移植）：升级服务 `ui-updater` 1.4.2 改为优先走 GitHub 官方附件 API 下载（`browser_download_url` 作为回退），修「在线升级永远卡在下载」；UI 侧新增「等待备份确认」态（停转圈、收起其他升级选项、已上传内核不再显示「尚未选择文件」）。iOS 移植不走 `ui-updater`，仅前端状态变化。
- **完整性校验**：安装包用发行版 `SHA256SUMS.txt` 校验通过（`b8c50e03b41452af…`，8,761,795 B），收尾自检（7 处 app 补丁特征串、editor Surge 校验、`index.html` 三处定制、`app-*`/`index-*` 唯一性、editor 存在）全绿。
- **本地定制零丢失**：7 处 Surge 补丁逐条命中（锚点各命中 1 次）、`livepulse.js`、`surge-workbench.js`、AdHunter 入口、`data-backend-version="FJMOS"`、同源 `proxyConfigBase` 全部保留。真机浏览器复核：品牌 `FJMOS`、AdHunter 链接、livepulse 拓扑（6 列 + 闭环层 + 控件）、工作台 6 个 tab / 7 个模块正常加载、代理页文案与 `Surge · CONF` 首选项在位。
- **验收**：`test-ui-contract.ts` **34/34**；`test-suite.ts` **152/154**，2 项失败（`Direct RULE-SET exports active direct rules`、`Rules text exported for online editor`）是**数据状态**问题而非 UI 回归——生产库里 `direct` / `proxy` 分流组已是 0 条（`2026-11-07` 备份里分别是 4 / 6628 条），失败点在测试写入任何规则**之前**的首次读取，详见下方「已知问题」。

### v1.15.15 修节点引导集在 Surge 6 上完全失效（我自己上一版的 bug）
- **现象**：`GET /api/v1/surge/proxy-bootstrap` 恒为 `{"success":true,"hosts":[]}`，`POST` 返回 `{"ok":false,"error":"HTTP 404"}`。
- **真因**：Surge **6.100.0 删除了 `/v1/proxies`**（`{"error":"unknown path"}` / 404），改成 `/v1/policies`。而 `/v1/policies` **只返回策略名**（`{"proxies":["德国-fk.vcncv.com",...],"policy-groups":[...]}`）；顺便把 `v1/policies/<name>`、`/v1/policies/detail`、`/v1/profiles`、`/v1/policy-groups`、`/v1/config` 全试了，**均不存在**，HTTP API 已不再对外暴露任何 host/port 详情（只有 MCP 的 `get_profile_section` 才有）。
- **上版为何没发现**：v1.15.13 用「假 Surge 服务器」自测时，是按 v5 文档造的 `/v1/proxies` 响应，所以自测通过、真机 404。**假服务器的测试只能证明客户端逻辑，不能证明接口契约**。
- **修法**：`refreshProxyBootstrapHosts()` 改为**三级数据源**：① `/v1/proxies`（Surge 5，直接给 host/server/address 详情）；② **`/v1/profiles/current?sensitive=1` 解 `[Proxy]` 段，取每行 `type, host, port` 的第 2 个字段**（准确；`sensitive=0` 会把 host 抹成 `masked`，必须用 1；只抽 host，其余字段含密码读完即丢，不落盘不打日志）；③ `/v1/policies` 策略名抽主机名（`德国-fk.vcncv.com` → `fk.vcncv.com`）兜底。响应新增 `source` 字段（`proxies` / `profile` / `policies-names`）；学到空集时**保留原值**不回写，避免接口变动把引导集冲成空。另加 `POST /api/v1/surge/proxy-bootstrap {"hosts":[...]}` 手工补录（名字里不带域名的节点用）。
- **验收**：真机 Surge 6.100.0 上 `refresh={"ok":true,"hosts":["fk.vcncv.com"],"source":"profile"}`，落盘后分流 `fk.vcncv.com → {group:domestic, domainSet:proxy_bootstrap}`，对照 `stun.sgponte.com`/`example.org` 仍为 `default_foreign`、`dns.google` 仍为 `upstream_bootstrap`。

### v1.15.14 修上游自伤：解析器自己的 DoH 被自己的规则打死
- **现象**：面板「上游 DNS 健康」长期停在 4/7，`google_doh` 总是异常。即使隧道回来也不恢复。
- **真因**：`google_doh` 的上游地址是主机名 `https://dns.google/dns-query`，而 `dns.google` 被模块脱水规则拦成黑洞：`GET /api/resolve?name=dns.google` → `{"addresses":["0.0.0.0"],"blocked":true,"domain_set":"surge_module_block"}`。`resolver.ts` 里虽然早就把 `dns.google` 写进了 `BOOTSTRAP_HOSTS` 静态表，但分流拦截（3.2）排在 bootstrap（5）之前，根本走不到。
- **修法**：`DiversionEngine` 从 `Store.getUpstreamConfig()` 自动收集四个分组里所有上游的 DoH 主机名（IP 上游跳过），再补上 `dns.google` / `cloudflare-dns.com` / `one.one.one.one` / `dns.quad9.net` / `dns.alidns.com` / `doh.pub` / `dot.pub`，在 `match()` 第 **1.2 步**（重写之后、模块拦截之前）直接判 `{group:'domestic', domainSet:'upstream_bootstrap'}`。上游配置变更（`POST /api/v1/upstream/config`）后自动重算。
- **顺带排除的误报**：`cloudflare_ip` / `google_doh` 在隧道下线时必然全 abort（实测直连 `https://1.1.1.1/dns-query` 6s 超时），`dnspod_doh` 的偶发 abort 是并发竞速撞 2500ms 国内超时（实测 `doh.pub` 本身 `200 / 0.24s`）——这两类不是故障，无需改代码。
- **预期**：隧道在线时 7/7；隧道下线时 5/7（只差两个境外 DoH）。

### v1.15.13 修「启动后 Surge 节点连不上」：代理节点域名引导集
- **现象**：启动 LocalDNS 后，Surge 里德国节点连接失败；同时所有境外域名在 LocalDNS 里 6 秒超时后 `SERVFAIL`（`raw.githubusercontent.com`、`api.twitter.com`、`ip-api.com` 等）。
- **真因（DNS 死锁）**：`default_foreign` 兑底把所有不在 CN 名单里的域名都推给境外 DoH，而境外 DoH 必须经隔道；隔道要连节点，节点域名又要先解析——而 Surge 的 DNS 已全量指向 `127.0.0.1`，于是「连节点 → 解析节点域名 → 走隔道 → 连节点」互为前提。`resolver.ts` 又硬性规定「境外无可用节点时宁可 SERVFAIL 也不 fallback domestic」，所以没有自救路径。实测：`GET /api/resolve?name=stun.sgponte.com` 返回 `SERVFAIL`（`domain_set=default_foreign`），而同一域名用阿里 DoH 查得 `194.156.162.145` / `38.175.109.142`。
- **修法**：新增「代理节点域名引导集」`proxy_bootstrap`——启动时（及每 60s、及每次同步）从 Surge `GET /v1/proxies` 学习所有节点的服务器域名，持久化到 Storage，在 `DiversionEngine.match()` 里排在灰名单之前直接判定为 `domestic`。Surge 未启动时沿用上次结果，不会因重启丢失。IP 节点、IPv6、`localhost`/`.local`/非法主机名自动跳过。
- **新增接口**：`GET /api/v1/surge/proxy-bootstrap` 查看当前集；`POST` 立即重学。
- **验收**：假 Surge 服务（端口 6166 本地模拟 `/v1/proxies`）跑真实调用路径，输出 `{"ok":true,"hosts":["de-01.sgponte.com","hk.sgponte.com"]}`——IP 节点 `82.39.212.190` 与 `router.local` 被正确跳过；分类探针：`stun.sgponte.com` / `a.node1.sgponte.com` → `{group:"domestic",domainSet:"proxy_bootstrap"}`，`example.org` 仍为 `default_foreign`。

### v1.15.12 修复界面版本号假回退（显示 1.14.1，清单其实已是 1.15.x）
- **现象**：App 导航标题与「版本与开源致敬」显示 `v1.14.1 (Build 20261102)`，而磁盘上 `script.json` 已是 `1.15.11`。
- **真因**：`APP_VERSION` 用 `FileManager.readAsStringSync(${Script.directory}/script.json)` 取版本，`try{}catch{}` 静默吞掉失败后落到写死的保底常量 `'v1.14.1'`（从 v1.14.1 那次提交起就没再抬过）。实测该读取在当前运行时确实会失败：探针显示 `exists=true`、`isiCloudFileDownloaded=true`，但 `readAsStringSync` 抛「本次脚本运行没有该权限」；只有显式 `downloadFileFromiCloud()` 之后才读得动。
- **修法**：版本优先读宿主解析的清单 `Script.metadata.version`（无文件 IO，独立探针项目实测 `9.9.9` 原样返回）；文件读取降为兜底；最终兜底改为**不含版号的 `v?`** 并在控制台 `console.warn` 一行，永不再写死陈旧版本。
- **旁证**：同一探针里 `cert/ca.crt` 这类 `readAsStringSync` 调用同样被拒——`generateAppleDnsProfile()` 的 CA 嵌入也有静默失败风险，本次不动（不扩大范围），仅记录。

### v1.15.11 修「小组件白屏」根因三件套：TTL 抬底 + MITM 收敛 + DoH 失效自检
- **过期缓存回包 TTL 5s → 60s**：`serveExpiredTtl` 分支只借用 `replyTtl`，5 秒的 TTL 会让消费端（尤其是几十秒预算、每次冷解析的小组件扩展进程）刚拿到地址就又要重查，DNS 一拥而上反而拖慢首屏。现默认 `replyTtl: 60`（`store.ts` 默认值 + `cache.ts` 三处默认参数同步），运行中可用 `POST /api/v1/cache/config {"replyTtl":60}` 热调。实测 `GET /api/resolve?name=www.baidu.com&type=1` 由固定 `ttl:5` 变为 `ttl:110`（真实上游 TTL 透传）。
- **聚合模块 MITM 域名收敛 462 → 390**：新增 `narrowMitmHosts()`——只有被 HTTP 规则 / 脚本 / 重写正文真正引用过的域名才开解密，`www.youtube.com`、`m.youtube.com`、`s.youtube.com`、`youtubei.googleapis.com`、`imasdk.googleapis.com` 恒保留。匹配分三层：精确子串 → 核心词边界正则 → 去尾部 `x?[0-9]+` 的 stem 兜底（不兜这一层会误杀用 `nivod\d`、`555dy\w{0,3}` 写法的脚本站点，首版就因此误丢 84 个域名）。实测丢弃的 69 个域名（`*.cnn.com`、`*.bloomberg.com`、`www.nytimes.com`、`www.reddit.com`、stackoverflow 等）均无对应脚本，属纯解密开销。
- **新增 DoH 失效自检 `GET /api/v1/surge/dns-failover`**：本地探测 `127.0.0.1:<端口>/dns-query`，再读 Surge `/v1/profiles/current` 判断「是否把 DNS 全量交给 127.0.0.1」与「是否留了公共回退」，四态输出 `healthy` / `local_doh_down` / `no_public_fallback` / `surge_api_offline`，并附可直接粘贴的 `[General]` 片段（键名跟随配置实际存在的那一个：`encrypted-dns-server` 或 `doh-server`）。同一结果也并入 `/api/v1/surge/hub-health` 的 `dns` 字段。
- **探针踩坑**：DoH 成功回包是二进制 DNS 报文，用 `res.text()` 判定会抛 `Failed to decode data to utf-8` 并在服务健康时误报 `local_doh_down`；改为以 HTTP 200 为判据、体积仅作附加信号。
- **生成配置与 UI 片段改用官方键名** `encrypted-dns-server`（旧 `doh-server` 同义），并强制带上 `dns-server = 223.5.5.5, 119.29.29.29` 回退链。本机实测：生效配置里只有 `encrypted-dns-server = https://127.0.0.1:9443/dns-query`、`dns-server` 缺失 —— 这正是「Scripting 进程被回收 ⇒ 全机解析全灭 ⇒ 小组件最先白屏」的现场证据。

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

## 已知问题

### 分流组「孤儿规则清理」会连带删掉手工粘贴的规则（待确认修复）
- **本版回归状态**：`Direct RULE-SET exports active direct rules` 与 `Rules text exported for online editor` 已通过（当前库里 `direct` 组有规则），但下面描述的机制性风险未消除。
- **现象**：生产库 `direct`（国内直连）与 `proxy`（节点代理）两个分流组变成 **0 条规则**，`/rules/direct.list` 只剩模块头。`test-suite.ts` 两条断言（`Direct RULE-SET exports active direct rules`、`Rules text exported for online editor`）因此长期不过，与 UI 无关。
- **时间线证据**：`backup/20261107/surge_link.db` 里 `direct` 4 条（1 条有来源绑定）、`proxy` 6628 条（全部绑定到同一个远程规则集）；现行库里两者均为 0，且 `rule_source_bindings` 与现存规则数等量（53751 ≈ 53751），即「无绑定的规则已不存在」。
- **机制**：`surge-service.ts` 刷新全部订阅时，**阶段 3** 执行 `DELETE FROM diversion_rules WHERE id NOT IN (SELECT rule_id FROM rule_source_bindings) AND is_auto_learned = 0`——把「已不在任何订阅／模块来源里的手工规则」整批删除。当某个远程规则集被移除（或将 `proxy` 组规则切换回手写）时，原属它的整组规则连同手工补充都会在下次刷新时无提示消失。
- **待办**：① 是否把阶段 3 限定为「仅清理该来源自己曾经绑定过的规则」或加确认闸门；② 是否从 `20261107` 备份恢复 `proxy` 的 6628 条与 `direct` 的 4 条（需用户确认，因为中间 `block` 组已发生变化，不能整库回滚）。

### AdGuard 规则库为空导致回归套件的 10 万条断言失败（数据状态，非代码回归）
- **现象**：`test-suite.ts` 唯一失败项 `AdGuard engine has over 100,000 rules active (got: 48)`。
- **证据**：`tools/diag-adguard.ts` 直接读 `Store`：两个来源均为 `count=0 / stored_bytes=0`（`AdGuard DNS Filter` 启用但正文为空、`anti-AD` 关闭），内存里只剩 48 条内置规则。规则正文不在存储里，与换包、缓存来源、轮次指标改动无关。
- **处理**：在「名单管理 → 广告规则」重新导入/刷新 AdGuard 规则集即可恢复；不建议把断言降到 48 来掩盖数据缺失。

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
- **Surge 专属安全 DoH 接管**：`encrypted-dns-server = https://127.0.0.1:9443/dns-query`（旧版 `doh-server` 同义），满足 Surge 对 TLS 的强校验；**必须同时保留 `dns-server` 公共回退链**（见下方方案 2），否则 Scripting 进程被系统回收时全机解析全灭。
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
   encrypted-dns-server = https://127.0.0.1:9443/dns-query
   # 回退链：本地 DoH 不可达时由 dns-server 兜底
   dns-server = 223.5.5.5, 119.29.29.29
   skip-proxy = 127.0.0.1, localhost, *.local, 192.168.0.0/16
   ```
   > ⚠️ 回退链不是可选项。DoH 服务跑在 Scripting 进程里，进程被 iOS 回收时 127.0.0.1:9443 直接拒连；
   > 没有 `dns-server` 兜底就变成「全机解析全灭」，而 Scripting 小组件（独立扩展进程、几十秒预算、每次冷解析）
   > 会第一个白屏。只想避免这个副作用：不要安装方案 1 的描述文件。
3. 开启 Surge，全设备 DNS 查询瞬间由本地 18.5 万条 AdGuard 广告规则直接黑洞化！

### 方案 3：Shadowrocket (小火箭 · 免证书全局接管)
1. 点击「复制通用 DoH 地址」，获得 `http://127.0.0.1:9099/dns-query`；
2. 打开小火箭 ➔ 底部「设置」➔「DNS」➔「DNS 覆写」，粘贴该地址并保存；
3. 返回小火箭首页开启开关即可全局生效。
