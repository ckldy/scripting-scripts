# YouTube 全链路清洗新架构设计

- 日期：2026-11-08
- 状态：待用户审阅
- 范围：LocalDNS、Surge 模块、Safari AdBlockHub、YouTube 网页与客户端播放链路
- 目标优先级：播放稳定性 > Surge 内存安全 > 可回滚性 > 去广告覆盖率

## 1. 背景与现状证据

当前系统把 DNS 阻断、Surge 多条 body 脚本、内置 `youtube-web`、Safari 母核和画质增强同时叠加在 YouTube 链路上。

已观察到的生产事实：

1. 当前 Surge 启用模块为 `LocalDNS Unified Hub YT Web Immutable`。
2. 当前脚本状态包含 `youtube.enhance.response`、`youtube.enhance.ump`、`youtube.enhance.init`、`youtube.enhance.auto-hd`、`youtube.enhance.log-event` 等多个 YouTube 脚本。
3. Surge 事件中出现 `youtube.enhance.log-event` 使用过多内存、可能导致网络引擎被系统终止的告警。
4. 网络引擎被终止会同时导致 MITM、播放链路和所有响应脚本失效；所以「广告被拦截但视频不能播放」是必须优先解决的架构问题，不是单个广告键名问题。
5. `youtube-web` 的内容哈希 URL 可访问，但这只证明脚本分发正常，不证明整个脚本组合安全。
6. 当前网页脚本 smoke 能证明构造样本的字段删除安全，但不能证明真实登录态广告流量已被删除。

上一轮备份：

```text
/var/mobile/Library/Mobile Documents/iCloud~com~thomfang~Scripting/Documents/backup/LocalDNS/LocalDNS_YouTube全链路清洗架构重建_20261108_000557
```

## 2. 目标

### 2.1 必须实现

- YouTube 视频在清洗失败、脚本异常或实验模块关闭时仍可播放。
- DNS 广告阻断不得误伤 `youtube.com`、`youtubei.googleapis.com`、`googlevideo.com`、`ytimg.com`。
- 生产稳定链路中不再启用 `youtube.enhance.log-event`。
- 网页端清洗只有一个 Owner：Safari AdBlockHub。
- 客户端 protobuf 清洗与网页清洗分离，默认关闭。
- `auto-hd` 与广告清洗分离，默认关闭。
- 每个实验模块可以独立启用、停用和回滚。
- 任何 body 脚本都必须有体积上限、失败放行策略和内存告警检查。
- 诊断可以区分：未注入、未命中、命中未删除、命中并删除、异常、播放失败。

### 2.2 非目标

- 本阶段不扩大 YouTube endpoint 白名单。
- 本阶段不修改 `/watch` HTML 的 Surge 响应内容。
- 本阶段不把 `browse`、`search`、`guide`、`get_watch` 加入网页 JSON 清洗。
- 本阶段不把客户端 protobuf 清洗直接投入稳定生产。
- 本阶段不在未有真实用户态证据时宣称「真实广告已去除」。
- 本阶段不处理 `auto-hd` 的画质策略本身，只隔离它。

## 3. 架构总览

```text
                    ┌──────────────────────────┐
                    │ LocalDNS DNS              │
                    │ 仅广告域名阻断            │
                    │ 播放域名明确放行          │
                    └────────────┬─────────────┘
                                 │
                    ┌────────────▼─────────────┐
                    │ Surge YouTube Transport   │
                    │ 代理 / QUIC / 必要 MITM   │
                    │ 默认不改写播放 body       │
                    └────────────┬─────────────┘
                                 │
              ┌──────────────────┴──────────────────┐
              │                                     │
   ┌──────────▼─────────┐                ┌──────────▼─────────┐
   │ Safari AdBlockHub   │                │ Client Experimental │
   │ 网页首屏/Fetch 清洗 │                │ protobuf，默认关闭  │
   │ 唯一网页 Owner      │                │ 独立模块/独立回滚   │
   └──────────┬─────────┘                └────────────────────┘
              │
   ┌──────────▼─────────┐
   │ YouTube 播放器      │
   │ streamingData 原样  │
   │ playability 原样    │
   └────────────────────┘

   Quality/auto-hd：独立实验模块，默认关闭
   Observer：只读诊断，不修改任何流量
```

## 4. 模块边界与契约

### 4.1 `youtube-transport`

职责：

- YouTube 与 Googlevideo 的路由、代理策略和必要 MITM。
- QUIC 443 降级为 TCP，前提是不会影响非 YouTube 流量。
- 保证 `youtube.com`、`youtubei.googleapis.com`、`*.googlevideo.com`、`*.ytimg.com` 可访问。

禁止：

- `requires-body`。
- `http-response` 播放数据重写。
- JSON.parse / JSON.stringify。
- protobuf 修改。
- `auto-hd`、`log-event`、`ump/init/key`。

播放失败时该模块仍应保持可用，是所有后续模块的基础。

### 4.2 `youtube-dns-ads`

只阻断已确认的广告/广告统计域名；不得阻断或污染播放域名。DNS 规则与路由规则分离，不能用模糊 `ads` 关键词匹配 YouTube 核心域名。

### 4.3 Safari `AdBlockHub`

职责：

- `/watch` 首屏内联 `ytInitialPlayerResponse` 的原地剥离。
- `ytplayer.bootstrapPlayerResponse` 的原地剥离。
- YouTube `JSON.parse`、`Response.json`、`Response.text` 钩子。
- 只对 YouTube 数据 URL 生效；HTML、JS bundle、媒体分片原样放行。

允许删除的键：

```text
adPlacements
playerAds
adSlots
adBreakParams
adBreakHeartbeatParams
playerAdParams
```

不可修改的播放字段：

```text
streamingData
playabilityStatus
videoDetails
microformat
```

错误策略：任何异常、未知结构、超过保护深度均原样返回，不抛出、不阻塞 fetch、不阻塞播放。

### 4.4 `youtube-client-protobuf-experimental`

职责：只处理客户端明确的 `/player` protobuf 响应。

约束：

- 默认关闭。
- 不匹配 `/next`。
- 只允许删除已确认的 protobuf 顶层字段 7、61、68。
- 任意 wire type、长度或解析异常均原样放行。
- 独立 `max-size`，不复用网页 JSON 上限。
- 独立模块、独立日志、独立回滚。

### 4.5 `youtube-quality-experimental`

`auto-hd` 不属于广告清洗链，默认关闭。只有播放基线、内存基线和画质 A/B 均通过后才允许单独灰度。

### 4.6 `youtube-observer`

只读，不含 response body 改写能力。统一输出：

```js
window.__LOCALDNS_YOUTUBE_STATUS__ = {
  transportReady,
  dnsBlocked,
  safariHubInjected,
  jsonParsed,
  jsonPruned,
  protobufPruned,
  lastMatchedUrl,
  lastDeletedKeys,
  lastError,
  playbackProbe,
  engineWarnings,
  rollbackReason
}
```

不记录 cookie、Authorization、完整响应体或完整播放 URL 参数。

## 5. 数据流与优先级

### 网页

```text
/watch HTML
  → Safari 母核原地处理首屏对象
  → 播放器读取 streamingData
  → googlevideo 媒体流由 Transport 直达
```

```text
/youtubei/v1/player JSON
  → Safari Response/JSON 钩子
  → 只删除广告键
  → 原样保留播放字段
```

Surge 不再与 Safari 母核同时处理同一网页 JSON 响应。

### 客户端

```text
客户端 /player protobuf
  → 默认原样放行
  → 启用实验模块后才进入 protobuf 清洗
  → 失败立即原样放行
```

### 广告域名

```text
广告域名 → DNS 阻断
播放域名 → 明确放行
googlevideo → 不参与广告关键词阻断
```

## 6. 故障降级与回滚

优先级固定为：

```text
视频可播放 > Surge 不被杀 > DNS 广告阻断 > 网页广告字段清洗 > 客户端广告清洗 > 画质增强
```

降级规则：

1. Safari 清洗异常：原样放行响应。
2. 实验模块异常：只停用该实验模块，不动 Transport。
3. Surge 出现 YouTube 脚本内存告警：停用全部 YouTube body 脚本，仅保留 Transport + DNS。
4. 播放 smoke 失败：禁止发布或启用对应模块。
5. 连续播放失败：回滚到 `youtube-transport + youtube-dns-ads` 基线。

稳定发布必须使用不可变脚本 URL；稳定 `no-store` 文件只能用于兼容旧模块，不得用于新模块。

## 7. 分阶段迁移计划

### Phase 0：播放安全基线

- 生成只含 Transport + DNS 的基线模块。
- 从稳定模块移除 `log-event`、`auto-hd`、`ump/init/key` 和所有 YouTube body response 脚本。
- 保留旧模块文件，不覆盖、不删除。
- 验证视频首屏、连续 60 秒、切换视频、后台恢复。

### Phase 1：网页母核接管

- AdBlockHub 升级为新诊断协议。
- 网页 JSON 清洗只在 Safari 母核启用。
- Surge 不处理网页 JSON。
- 验证构造 fixture、脱敏真实 fixture 和真实用户态诊断。

### Phase 2：客户端 protobuf 灰度

- 只生成独立实验模块，默认关闭。
- 单独验证客户端 `/player`。
- 任何播放异常自动回到 Phase 1。

### Phase 3：画质模块灰度

- `auto-hd` 单独模块、单独 max-size、单独内存观察。
- 不与广告清洗模块同批发布。

## 8. 测试与验收

### 静态验收

- 稳定模块中不存在 `youtube.enhance.log-event`。
- 稳定模块中不存在 `youtube.enhance.auto-hd`。
- 稳定模块中不存在 `youtube.enhance.ump`、`init`、`key`。
- Transport 模块不存在 `requires-body`。
- DNS 规则不匹配 `youtube.com`、`googlevideo.com`、`ytimg.com`。
- 所有新脚本 URL 使用内容哈希不可变路径。

### 播放验收

- 首页打开成功。
- 视频首帧成功。
- 连续播放至少 60 秒。
- 切换另一个视频成功。
- `streamingData`、`playabilityStatus`、`videoDetails` 完整。
- 关闭清洗模块后仍可播放。
- Surge 无新增 `core.warning`。

### 清洗验收

- 合成带广告 fixture 删除目标键。
- 播放字段逐字节保持。
- 真实无广告 fixture 原样放行。
- Safari 母核能报告注入、命中、删除键和异常。
- 未有真实登录态证据时，verdict 必须保持 `ad-removal-unverified`。

### 回滚验收

- 可在一次模块切换内回到 Transport + DNS。
- 回滚后视频恢复播放。
- 回滚不依赖修改脚本源码。
- 旧不可变脚本文件保留。

## 9. 实现边界

本 spec 批准后，第一轮实现只做 Phase 0：建立播放安全基线并验证，不同时启用客户端 protobuf 或 auto-hd。Phase 1 需要 Phase 0 通过后再进入。任何新增端点、扩大 body 上限或启用新脚本都必须单独提交测试证据。

本阶段不自动切换用户当前 Surge 配置；模块生成和本地验证完成后，再由用户确认安装/切换。

## 10. 成功标准

最终稳定链路必须满足：

```text
transport-ok = true
memory-safe = true
playback-ok = true
rollback-ready = true
web-ad-removal = verified 或 unverified（诚实标记）
client-ad-removal = disabled 或 verified
quality-enhancement = disabled 或 verified
```

任何「广告被拦截但视频无法播放」的状态都视为架构失败，不得作为可发布状态。
