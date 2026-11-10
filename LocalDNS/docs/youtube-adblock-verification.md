# YouTube 去广告：核验与维护手册

> 2026-11-07 事故后建立。核心结论：**「能播放」和「去掉广告」是两件独立的事**，必须分开验证，
> 不允许再用一个 `allOk` 混在一起。

## 1. 先分清两个数字

| 数字 | 含义 | 改它会影响什么 |
|---|---|---|
| `YT_BUILTIN_WEB_MAX_SIZE` = 8388608 (8MB) | Surge 编译期 `max-size`，单响应缓冲上限 | 太大可能撑爆网络扩展内存 |
| `YT_BUILTIN_WEB_MAX_PROCESS_BYTES` = 2097152 (2MB) | 脚本内 `MAX_PROCESS_BYTES`，超过就原样放行 | 太小会让大响应跳过脱水（退化为不去广告） |

两者都必须满足：`脚本内上限 ≤ 编译期 max-size`（`test-yt-playback-smoke.js` 的 F 组有断言）。

## 2. 单一真相

所有规则都在 `src/youtube-rules.ts`：

- `YT_WEB_JSON_ENDPOINTS` —— 允许脱水的端点（当前只有 `player` / `next` / `reel/reel_watch_sequence`）
- `renderBuiltinWebRule(baseUrl, immutableFile)` —— 唯一的行渲染器

**禁止**再手写 `localdns_builtin_yt_web = type=http-response,...` 长字符串。改端点只改这个文件。

## 3. 端点不可随便加

新增端点前逐条核对（`YT_ENDPOINT_PROMOTION_CHECKLIST`）：

1. 有真实带广告响应样本（非构造）
2. 已确认广告字段的确切路径
3. 已确认该字段不是播放必需字段
4. 已有对应 fixture
5. 播放 smoke 断言通过
6. 内存峰值验证通过
7. Canary 灰度无回归

> 2026-11-07 教训：把 `browse|search|guide|get_watch|account/get_setting|navigation/resolve_url`
> 一并纳入后与「网页无法播放」同时出现；而且实测这 6 个端点的真实响应里
> **一个现有广告键都没有**，扩白名单没有收益只有风险。已回退。

## 4. 脚本不可变（回滚的前提）

`/scripts/<name>.<12位hex>.js` 会返回 `Cache-Control: immutable`；稳定名 `/scripts/<name>.js` 是 `no-store`。

- 修改 `web/scripts/youtube-web.js` 后，`publishBuiltinWebScript()` 会按内容哈希复制出
  `youtube-web.<sha12>.js`，模块引用哈希名。
- 内容一变哈希就变 ⇒ 新模块引新文件，**旧模块继续引旧文件**，回滚才真正成立。
- ⚠️ 稳定名是 `no-store`：**只要它还在被引用，改文件就等于改线上**。这是历史事故根因，不要再依赖稳定名。

## 5. 三层验证怎么跑

```sh
# 1) 脚本单元（构造样本，验证删除逻辑本身）
node tools/test-youtube-web-script.js

# 2) 播放 smoke（fixture 驱动，验证删广告不破坏播放）
node tools/test-yt-playback-smoke.js

# 3) 母核（浏览器侧钩子 + 诊断接口）
node tools/test-adblockhub-444.js

# 4) 全链路（Surge 配置 + 分项 verdict）
scripting-ts run tools/test-youtube-adblock.ts
```

第 2 步会写 `tools/fixtures/youtube/smoke-result.json`，第 4 步读取它，
因此两套测试不会给出互相矛盾的结论。

### verdict 含义

| verdict | 含义 | 可发布 |
|---|---|---|
| `configuration-broken` | Surge 配置/规则结构不对 | ❌ |
| `script-unit-failed` | 播放 smoke 失败（可能破坏播放） | ❌ |
| `playback-ok-ad-removal-unverified` | 配置对、播放安全，但**真实流量去广告未证明** | ✅（有条件） |

`realTrafficObserved` / `adRemovalObserved` 在测试环境恒为 `false`：
它们只能由真实带登录态的播放证明，见下一节。

## 6. 真实流量核验（必须用户手动，一次即可）

匿名请求 YouTube 不下发广告，所以自动化拿不到带广告样本。步骤：

1. Safari → 设置 → 扩展，确认 **AdBlock Hub** 已启用、允许在 `youtube.com` 上运行
2. 打开任意 YouTube 视频页（有贴片广告的视频）
3. 打开 Safari 开发者工具控制台，执行：

```js
JSON.stringify(window.__LOCALDNS_ADBLOCK_STATUS__, null, 2)
```

4. 判读：

| 现象 | 结论 | 下一步 |
|---|---|---|
| `injectedAt === null` | 脚本**没注入** | 查扩展是否启用、站点权限 |
| `counts` 全 0 | 注入了但**没命中任何数据路径** | 广告可能走播放器运行时，不在 JSON 层 |
| `counts.jsonParsed > 0`、`counts.*Pruned === 0` | 走了 JSON，但**没有广告键** | 广告键名可能变了，需要采样确认真实字段名 |
| `totalPruned > 0` 且有广告 | 钩子在工作，但广告来自别处 | 属于渲染层/播放器状态机 |
| `totalPruned > 0` 且无广告 | 正常 | — |
| `last.error` 非空 | 钩子内部异常 | 按 `last.error` 定位 |

`last.deletedKeys` 会给出**实际被删的键名**，这是确认「键名是否变了」的直接证据。

## 7. 内存红线（不可回潮）

- ❌ 绝不给 `/watch` 整页 HTML 加 Surge 脚本（历史 3MB 通道把网络扩展内存打爆被系统杀）
- ❌ 绝不恢复 `localdns_builtin_yt_html`
- ✅ 首屏 `ytInitialPlayerResponse` 由浏览器侧母核剥离（零 Surge 内存）
- ✅ 脚本内 `MAX_PROCESS_BYTES` 护栏 + 编译期 `max-size` 双保险

## 8. 回滚

```sh
git checkout -- web/scripts/youtube-web.js          # 或从 backup/ 取
git checkout -- src/surge-service.ts src/youtube-rules.ts
```

Surge 侧回滚：停用当前模块，启用 `LocalDNS Unified Hub LocalCanary MemSafe`
（或更早的 `LocalCanary` / `Full`）。旧模块引用的哈希脚本文件仍在 `web/scripts/`，内容不变。
