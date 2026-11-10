# Phase 0 报告：YouTube 播放安全基线

- 执行时间：2026-11-08 00:12–00:18（Asia/Shanghai）
- 依据：[全链路新架构 spec](./superpowers/specs/2026-11-08-youtube-full-pipeline-design.md)
- 结论：**phase0-ok**（模块已生成并验证，尚未安装到 Surge）

## 1. 触发原因（证据）

Surge `/v1/events` 中 `2026-11-07T23:21:30` 连续三条：

```text
脚本"youtube.enhance.log-event"使用了过多内存，即将导致 Surge 引擎内存超限被系统终止
```

同一时段启用模块为 `LocalDNS Unified Hub YT Web Immutable`，其中同时挂了 7 条
`youtube.enhance.*` 脚本 + `localdns_builtin_yt_web`。网络引擎被系统终止时，
MITM 与全部响应脚本一起失效，表现就是「广告被拦截、视频播不了」。

## 2. 产出物

| 文件 | 作用 |
|---|---|
| `web/hub-yt-transport-baseline.sgmodule` | 播放安全基线模块（59221 B，82 条非 YouTube 脚本，27 条规则） |
| `tools/build-yt-transport-baseline.js` | 由稳定模块做**减法**生成基线，可重复执行 |
| `tools/test-yt-transport-baseline.js` | 静态契约测试，26 项 |
| `tools/verify-yt-phase0.ts` | 运行时验证（DNS + 可安装性），输出机器 verdict |

### 基线怎么来的

用减法而不是重写，避免丢掉拼多多/闲鱼/B站等已调好的规则：

- 删除 8 条脚本：`localdns_builtin_yt_web`、`youtube.enhance.{ad-break,response,key,ump,init,auto-hd,log-event}`
- 从 `[MITM] hostname` 摘掉 5 个 YouTube 域名：`www.youtube.com`、`m.youtube.com`、`youtubei.googleapis.com`、`s.youtube.com`、`*.googlevideo.com`
- 其余 `[Rule]` / `[URL Rewrite]` / `[Header Rewrite]` / `[Body Rewrite]` / `[Map Local]` / 82 条非 YouTube 脚本**逐行一致**

为什么连 MITM 一起摘：没有脚本消费这些解密流量，保留只是白白增加内存与故障面。

## 3. 验证结果

### 3.1 静态契约（26 passed / 0 failed）

- 不存在任何 `youtube.enhance.*`、`localdns_builtin_yt_web`
- 不存在 `log-event`、`auto-hd`、`ump/init/key`
- 无脚本 pattern 覆盖 `youtubei` / `googlevideo`
- MITM 不含 YouTube，但保留 `www.bilibili.com`、`api.pinduoduo.com`（未误删）
- 连通性保留：`googlevideo`/`ytimg`/`youtubei` 走 PROXY，QUIC 443 降级保留
- 广告阻断保留：`pagead`、`stats/ads` 仍 REJECT
- 无规则 REJECT 播放入口域名
- 非 YouTube 各段行数与内容逐行一致

### 3.2 运行时（verdict = `phase0-ok`）

播放域名 6/6 放行：

```text
www.youtube.com / m.youtube.com / youtubei.googleapis.com
i.ytimg.com / redirector.googlevideo.com / rr1---sn-4g5e6nzz.googlevideo.com
```

广告域名 DNS 拦截 8/8：

```text
ads.youtube.com / pagead2.googlesyndication.com / googleads.g.doubleclick.net
pubads / securepubads / ad.doubleclick.net / adservice.google.com / ytads.google.com
```

模块可安装性：

```text
GET http://127.0.0.1:9099/ui/hub-yt-transport-baseline.sgmodule  →  200  59221 B
```

### 3.3 内存

生成后至 00:18 无新增 `core.warning`；现存告警均为 23:21 之前的历史事件。

## 4. 未完成项（诚实标记）

| 项 | 状态 | 说明 |
|---|---|---|
| 基线模块安装到 Surge | **未执行** | Surge iOS 模块安装只能走 App UI，`POST /v1/modules` 是空操作 |
| 真机连续播放 60 秒 | **未验证** | 需安装后由用户实测 |
| 网页去广告 | 推迟到 Phase 1 | 本阶段刻意关闭，交给 Safari AdBlockHub |
| 客户端 protobuf | disabled | Phase 2 |
| 画质增强 | disabled | Phase 3 |

因此本阶段**不能**宣称「去广告仍然有效」。Phase 0 的唯一承诺是：**视频能播**。

## 5. 复跑命令

```sh
node tools/build-yt-transport-baseline.js      # 重新生成基线
node tools/test-yt-transport-baseline.js       # 静态契约 26 项
scripting-ts run tools/verify-yt-phase0.ts     # 运行时 verdict
```

## 6. 回滚

基线是**新增文件**，未覆盖任何现有模块。回滚只需在 Surge 模块列表停用
`LocalDNS YouTube Transport Baseline`、重新启用旧模块即可，无需改任何脚本源码。

## 7. 后续补充（00:19–00:22）

### 7.1 现场状态复核

`node tools/check-yt-live.js` 读到：

```text
legacyImmutableOn : false      ← 已从 Immutable 切回
memSafeOn         : true       ← 当前启用 MemSafe
baselineInstalled : false      ← 基线尚未安装
hasLogEvent       : true       ← 元凶脚本仍在跑
youtubeScripts    : 7 条（ad-break/response/key/ump/init/auto-hd/log-event）
newMemoryWarnings : 0          ← 00:20 之后无新增（这段时间没在播）
```

结论：**切回 `MemSafe` 不等于脱离风险**。`MemSafe` 与基线的差别不是名字，而是它**仍然挂着
7 条 `youtube.enhance.*`**，其中 `log-event` 正是 23:21 三条内存告警的脚本。

### 7.2 母核升级到 4.6.0（播放字段硬护栏）

`AdBlockHub.user.js` 4.5.0 → 4.6.0，落实 spec 4.3 的「不可修改的播放字段」：

- 新增 `PROTECTED_KEYS = [streamingData, playabilityStatus, videoDetails, microformat]`
- 新增 `SAFE_AD_KEYS = AD_KEYS.filter(k => !PROTECTED_KEYS.includes(k))`，清洗循环改用 `SAFE_AD_KEYS`
  —— 这样将来有人误把 `streamingData` 写进 `AD_KEYS`，也不会变成一次线上静默的播放故障
- 新增 `playbackSnapshot()` / `verifyPlaybackIntact()`，在 5 个清洗点（JSON.parse、
  bootstrap setter、Response.json、Response.text、首屏轮询）清洗后校验受保护字段仍是同一引用
- 诊断新增 `playbackGuardViolations`（必须恒为 0）与 `protectedKeys`

回归：`node tools/test-adblockhub-444.js` → **27 passed / 0 failed**；
`node tools/check-userscript-syntax.js` → 语法 OK 37.2 KB。

### 7.3 仍然缺的只有一步

基线安装只能走 Surge App UI。装上之后 Phase 0 才算真正生效；
在此之前任何「已修复」的说法都不成立。

### 7.5 Phase 1 注入核验：母核未生效（00:50）

在真实 YouTube 视频页（`watch?v=aqz-KE-bpKQ`）用页面内 JS 取证：

```text
__LOCALDNS_ADBLOCK_STATUS__ : false
__adblockHub                : false
document#adblock-hub-style  : false
JSON.parse 是否被改写        : false（仍为 [native code]）
```

又写入一个最小探针 userscript（`@match https://www.youtube.com/*`、`@grant none`、
只设 `window.__LOCALDNS_PROBE__` 与一个 `<meta id="localdns-probe">`），重载后：

```text
__LOCALDNS_PROBE__ : null
#localdns-probe    : false
```

**连最小探针都不注入**，因此问题不在 AdBlockHub 的代码（其语法、版本、`@match` 均已验证），
而在「扩展/脚本没有被注入到这个页面」。

⚠️ 诚实边界：Agent 控制的标签页不一定等同于用户手动使用的 Safari 标签页
（Safari Web Extension 在部分内嵌 WebView 中不加载）。所以上述证据只能证明
「这个页面没注入」，不能单独断定用户 Safari 也没注入。已删除探针文件，不留垃圾。

### 7.6 由此得出的架构结论

网页广告**只能**由 Safari 母核处理：

- Surge 的 `/watch` 整页 HTML 通道（旧 `localdns_builtin_yt_html`，3MB）已因内存被杀禁用，不得回潮。
- 真实匿名 `player/next` 响应里并不存在 6 个广告键（已在 Phase 0 前的抓取中证实），
  所以**即使把 `localdns_builtin_yt_web` 加回去，也去不掉网页广告**。
- 网页广告的载体是 `/watch` 内联的 `ytInitialPlayerResponse`，只有页面内 JS 能改，
  也就是 Safari 母核。

因此 Safari 扩展注入是 Phase 1 的**单点依赖**；注入不成立时，Phase 1 无法完成，
而重新堆 Surge body 脚本只会重复「广告去掉、播放挂掉」的旧事故。

### 7.4 Phase 1 Safari 母核收窄（00:26）

`AdBlockHub.user.js` 4.6.0 → **4.7.0**，`Response.json/text` 的 URL 过滤从
"所有 `/youtubei/v1/`" 收窄为：

```text
www.youtube.com/youtubei/v1/player
www.youtube.com/youtubei/v1/next
www.youtube.com/youtubei/v1/reel/reel_watch_sequence
youtubei.googleapis.com/youtubei/v1/player|next|reel/reel_watch_sequence
```

明确原样放行：`browse`、`search`、`guide`、`get_watch`、`/watch`、`googlevideo`。

回归：`node tools/test-adblockhub-444.js` → **34 passed / 0 failed**；
包含 player/next 命中和 browse/search/guide/get_watch 原样放行，母核语法 OK 37.7 KB。

这一步只修改 Safari 母核，**没有启用任何新的 Surge body 脚本**；
设备侧仍必须先安装 Phase 0 基线，才能让 Safari 成为网页清洗唯一 Owner。
