# LocalDNS 清洗链路优化方案（安全版）

日期：2026-11-07  
范围：整条清洗链路（入库、归一化、存储、索引、DNS 查询、规则导出、Surge 模块编译、脚本构建/托管、遥测），不是单一 YouTube 模块。

## 0. 目标与非目标

### 目标
- 提高规则入库、查询、导出的准确性与速度。
- 降低 Surge 脚本内存风险，同时保持 YouTube 客户端/网页去广告可用。
- 所有优化可灰度、可回滚、可验证；现有功能不能被“优化”冲掉。

### 非目标
- 不把 HTTP 脚本执行搬进 LocalDNS（需要二次 HTTP 代理/MITM，不划算）。
- 不重新加入“googlevideo 不进 MITM / 媒体脚本过滤”等四项限制。
- 不做破坏性数据库迁移（不 DROP 旧表、不删旧列）。
- 不在没有 A/B 的情况下改变 DNS 匹配顺序。

## 1. 当前基线（2026-11-07）

- LocalDNS 1.15.8；Surge 启用 `LocalDNS Unified Hub Full`；旧 `Safe`/`Hub` 停用。
- YouTube：内置脚本只匹配 `www/m.youtube.com`；原版 `youtube.enhance.response` 全端点；`ump/init/auto-hd` 保留；`*.googlevideo.com` 在 MITM。
- DNS 热路径：内存 Set/Map；`diversion_rules` 60,383、`module_dns_rules` 318、`module_http_rules` 240、AdGuard 293,321。
- SQLite 已开 WAL + `synchronous=NORMAL` + `busy_timeout`。
- 已知问题：
  - `saveModuleRules` / `addAdHunterRules` 没有整体事务，逐条自动提交。
  - `module_http_rules` 没有 `(module_id, rule_type)` 索引。
  - `recordRuleHit` 没有调用方，`hit_count` 永远 0。
  - `collectEngineWarnings` 不按当前 profile 过滤历史事件，`localdns_builtin_yt_html` 会长期误报。
  - 双轨规则：`module_dns_rules` 与 `diversion_rules` 各自维护。
  - 远程脚本仍依赖 GitHub；模块正文缓存顽固。

## 2. 必须保持的现有功能（不可回退清单）

### DNS
- 匹配顺序不变：rewrite → `PLAYBACK_VITAL_HOSTS` → 模块 DNS 拦截 → blocklist → AdGuard → whitelist → greylist → RealIP → 自定义 CN → 自定义 Non-CN → Geosite CN → Geosite Non-CN → 内置启发式。
- `s.youtube.com`、`s2.youtube.com`、`video-stats.*`、`stats_check.youtube.com` 继续 `playback_allow`。
- `youtubei.googleapis.com`、`www.youtube.com`、`i.ytimg.com`、`redirector.googlevideo.com` 正常解析。
- `ads.youtube.com`、`pagead2`、`doubleclick`、`mobads` 等继续 0.0.0.0。
- block 组 `magsrv.com` 等继续 `surge_module_block`。
- DNS 缓存、in-flight 去重、DoH/DoT、ECS、fake-IP、审计日志、客户端分流不能失效。

### Surge 模块
- `LocalDNS Unified Hub Full` 保持启用；旧 Hub 只作为回滚，不自动删除。
- 内置脚本只匹配 `www/m.youtube.com`，不得重新匹配 `youtubei`。
- `youtube.enhance.response` 保持 `player|next|browse|search|reel|guide|account/get_setting|get_watch` 全端点。
- `youtube.enhance.ump` / `init` / `auto-hd` 保留；`requires-body=1` 不改 0。
- `*.googlevideo.com` 保持在 `[MITM]`。
- `max-size` 暂不降低；`engine=webview`（response/ump）与 `engine=jsc`（request）不改。
- 模块导入导出保留：`#!` 元数据、`#!arguments`、占位符、MITM、URL Rewrite、Header/Body Rewrite、Map Local、脚本参数。

### 数据与 UI
- `module_dns_rules` / `diversion_rules` / `app_modules` / `rule_source_bindings` 旧表继续可读。
- 模块启用/停用、规则导入、AdHunter 合流、block/proxy/direct/media 导出不能失效。
- `/api/v1/status`、`/api/v1/audit/logs`、`/v1/modules`、`/api/v1/surge/hub-health`、规则/模块 UI 的现有字段不能删；只能新增。
- Safari `AdBlockHub.user.js` 与网页去广告不改。

## 3. 安全机制

1. **备份**：每阶段前 `VACUUM INTO` 备份 `surge_link.db`，导出 `hub.sgmodule`、`block.list`、`/v1/profiles/current`、`/v1/modules`、`/api/v1/status`。
2. **黄金基线**：
   - DNS 200+ 域名语料，覆盖 block/proxy/direct/media/whitelist/playback/geosite/IDN/大小写/尾点。
   - 记录 `blocked`、`domain_set`、`answers`、`group`。
   - Hub 正文 SHA256、block.list SHA256、模块列表、`hub-health`。
   - YouTube：`tools/test-youtube-adblock.ts` 必须 `allOk:true`。
3. **Feature flags**：每项优化独立开关，默认关闭；存 `surge_config` 或 Store。
4. **影子模式**：新引擎/新快照并行计算，不返回给客户端；与旧结果逐条比对，差异写日志；差异为 0 才切换。
5. **金丝雀模块**：脚本/模块改动用新模块名/新 URL 安装；旧 Full 保持启用；用户验证后再切换。
6. **幂等迁移**：只 `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` / 受保护的 `ALTER TABLE ADD COLUMN`；不 `DROP`、不改名。
7. **回滚**：每阶段有独立回滚步骤；旧表、旧模块、旧脚本至少保留一个版本。
8. **测试门槛**：DNS 黄金、Hub 哈希、模块计数、YouTube 回归、UI smoke、性能 p95 全部通过才进入下一阶段。

## 4. 分阶段方案

### Phase 0：基线、开关、指标（无行为变化）

- 备份数据库与配置。
- 新增 `optimization_flags`（或 `surge_config` 键）：
  - `opt.db_tx`
  - `opt.hit_counter`
  - `opt.script_registry`
  - `opt.script_local_paths`
  - `opt.dedupe_scripts`
  - `opt.rules_v2`
  - `opt.snapshot_v2`
  - `opt.cname_check`
- 新增 `tools/test-dns-golden.ts`，跑黄金语料。
- 给 `DiversionEngine.match()` 加分段计时（只记录，不改变决策）。
- 输出 baseline 文件到 `tmp/baseline/`。

**验收**：所有基线哈希/计数一致；DNS 0 差异；YouTube `allOk:true`。

---

### Phase 1：数据库写路径加固（低风险）

**改动**
- `saveModuleRules`：把 4 个 DELETE + 所有 INSERT 放进一个 `transaction`；批量插入；失败整体回滚。
- `addAdHunterRules`：`saveModule` + 全量 `module_http_rules` 插入放进一个事务。
- 新增索引（`IF NOT EXISTS`）：
  - `module_http_rules(module_id, rule_type)`
  - `diversion_rules(group_id, enabled)`
  - `module_dns_rules(module_id, enabled)`
- PRAGMA：`cache_size`、`temp_store=MEMORY`、`mmap_size`（按设备内存）。
- 保留旧逐条路径作为 flag 关闭时的 fallback。

**不改变**
- 规则内容、顺序、来源绑定、模块 raw_content、Hub 编译结果。

**验收**
- 导入同一模块前后：`module_dns_rules` / `module_http_rules` / `module_mitm_hosts` 计数、pattern 集合、raw_content 完全一致。
- Hub 正文 SHA 不变；block.list SHA 不变。
- 导入耗时下降；失败注入测试能整体回滚（不留半套规则）。
- DNS 黄金 0 差异；YouTube `allOk:true`。

**回滚**：`opt.db_tx=0` 走旧路径；代码回退；DB 备份可恢复。

---

### Phase 2：命中遥测与性能指标（低风险）

**改动**
- DNS 命中时内存累加 `ruleId -> count`，每 5–10 秒批量 `UPDATE diversion_rules SET hit_count=...`。
- 只对 `diversion_rules` 记录；`module_dns_rules` 另有来源，不混写。
- 新增 `/api/v1/metrics`（additive）：match 各阶段 p50/p95、快照版本、规则数、导入耗时、缓存命中率。
- `collectEngineWarnings` 按当前 profile 过滤历史脚本告警（先解决 `localdns_builtin_yt_html` 误报）。

**不改变**
- DNS 返回、匹配顺序、规则内容。

**验收**
- 黄金 DNS 0 差异；`hit_count` 只在真实命中后增长；批量写入不阻塞查询。
- `hub-health` 不再报历史 HTML 脚本；YouTube 正常。

**回滚**：`opt.hit_counter=0`；关掉 metrics 路由即可。

---

### Phase 3：脚本注册表 + 本地镜像（先不改模块路径）

**改动**
- 新增 `script_registry` 表（additive）：
  `name, source_url, local_path, sha256, bytes, engine, max_size, last_checked, enabled`。
- 镜像 `response.js` / `ump.js` / `request.js` / `key.js` 到 `web/scripts/yt/`，计算 SHA。
- `/scripts/*` 路由支持版本化文件名 `.<sha>.js`，版本化文件返回 immutable；非版本化保持 no-store。
- **第一阶段不改模块 `script-path`**：先把镜像内容与 GitHub 内容逐字节比对，确认一致。
- 第二阶段用**新模块名/新 URL**（Canary）指向本地版本化脚本；旧 Full 保持启用。

**不改变**
- 当前 Full 的脚本 URL、参数、MITM、max-size、engine。
- `requires-body` 保持 1（media）。

**验收**
- 镜像 SHA 与源一致；Canary 模块 live profile 与 Full 逐行 diff，只允许 script-path 变化。
- YouTube 客户端/网页广告正常；Bilibili/拼多多/闲鱼模块不受影响。
- 旧 Full 可随时切回。

**回滚**：停用 Canary，重新启用 Full；`opt.script_local_paths=0`。

---

### Phase 4：脚本去重 + 单 Hub 对账（低风险，需金丝雀）

**改动**
- `compileUnifiedHubModule` 增加去重键 `script_name + pattern + target`；相同只保留一条，记录 warning。
- 不同参数/不同 pattern 的同名脚本**不合并**。
- 模块对账：
  - 列出 `/v1/modules`，只处理名字以 `LocalDNS Unified Hub` 开头的模块。
  - 只允许一个启用；旧模块保留但停用，不删除。
  - 新模块用新名称/新 URL 安装，验证后再停旧模块。

**不改变**
- 脚本顺序（内置只匹配网页；response 全端点）。
- 模块 raw_content 与用户自定义参数。

**验收**
- Hub 正文与基线 diff 仅去重项；脚本数不减少关键脚本。
- live profile 只有一套 built-in/response/ump/init/auto-hd。
- YouTube `allOk:true`；客户端/网页广告正常。

**回滚**：`opt.dedupe_scripts=0`；重新启用旧 Full。

---

### Phase 5：Canonical 规则表（大改，双写 + 影子）

**改动**
- 新增表（additive）：
  - `rules(id, type, pattern, action, priority, enabled, hash, created_at, updated_at)`
  - `rule_sources(id, kind, url, trust, version, last_fetch, enabled)`
  - `rule_bindings(rule_id, source_id, raw_rule)`
- 旧表继续保留；导入路径**双写**旧表 + 新表。
- 后台回填：从 `module_dns_rules` / `diversion_rules` 生成 `rules` + bindings；不阻塞 DNS。
- 新快照从 `rules` 构建；影子模式与旧快照逐条比对。
- 导出 block.list / Hub 仍走旧路径，直到新路径完全等价。

**不改变**
- DNS 查询继续用旧快照；UI 继续读旧表。
- 规则优先级/顺序不变。

**验收**
- 回填后 `rules` 去重数、来源绑定数、block/proxy/direct 分组与旧表一致。
- 黄金 DNS + 抽样在线查询影子差异 = 0。
- block.list 行数/哈希一致；Hub 正文一致。
- 打开 `opt.rules_v2` 后仍 0 差异，再切换读路径。

**回滚**：`opt.rules_v2=0`；旧表未动；删除新表即可（可选）。

---

### Phase 6：快照/缓存/增量刷新（中风险，影子 + 金丝雀）

**改动**
- 规则变更时构建新快照，构建完原子替换；查询无锁。
- 决策缓存 `domain + snapshotVersion -> result`；规则版本变化自动失效。
- 每个源存 hash/etag；未变则跳过解析和写库。
- `getActiveDnsBlockRules` 用版本/hash 跳过无变化重载。
- 保留旧快照一个版本用于回滚。

**不改变**
- 匹配顺序、返回结果、缓存 TTL、DoH/DoT/ECS/fake-IP。

**验收**
- 黄金 DNS 0 差异；p95 不明显变差；规则更新后缓存正确失效。
- 旧快照可切回；模块导入/AdHunter 仍正常。

**回滚**：`opt.snapshot_v2=0`；使用旧快照。

---

### Phase 7：准确性增强（默认关闭/只记录）

- CNAME cloaking：对 CNAME 目标再跑一次 match；先 `log-only`，确认不误杀 CDN 后再启用。
- Whitelist 优先级：增加配置，默认保持现状（AdGuard 先于 whitelist）。
- 冲突报告：同一域名多 action/多来源，UI 只读展示，不自动改规则。
- IDN/punycode、尾点、大小写统一在 ingest 层；只影响新导入，不改旧规则。
- 规则校验：过宽 regex、无效 pattern、未解析占位符、外部 script-path；新导入拒绝/标记。

**验收**：黄金 + 真实站点；无误杀；默认行为不变。

---

### Phase 8：脚本构建/拆分（可选，最后做）

- 有原版源码/构建管线时，按端点拆分 `response.js`；先 Canary。
- `player` 可做字节级 7/61/68 剥离（内置已有），但会丢 PiP/后台/最大倍速，需确认取舍。
- 所有脚本变更先 benchmark；`requires-body` 对 init/auto-hd 保持 1；`response.js` 保持 webview。
- 没有源码就先不拆；优先 `max-size`/去重/单 Hub/本地镜像。

## 5. 测试矩阵

| 阶段 | 测试 | 通过标准 |
|---|---|---|
| 0 | 基线快照 | DB/Hub/block.list/profile 哈希记录 |
| 1 | 模块导入前后 diff | 规则计数/pattern/raw_content 一致；失败可回滚 |
| 2 | 命中/指标 | 黄金 DNS 0 差异；hit_count 真实增长；p95 不退化 |
| 3 | 脚本镜像/Canary | SHA 一致；live profile diff 仅路径；YouTube 正常 |
| 4 | 去重/单 Hub | 关键脚本不丢；只有一套脚本；YouTube 正常 |
| 5 | rules_v2 影子 | 去重/绑定/分组一致；影子 0 差异；block.list/Hub 一致 |
| 6 | snapshot_v2 影子 | 黄金 0 差异；缓存失效正确；p95 不退化 |
| 7 | CNAME/冲突 | log-only 无误杀；默认行为不变 |
| 8 | 拆包/外科剥离 | 内存下降；YouTube 客户端/网页正常；可回滚 Full |

## 6. 回滚矩阵

| 变更 | 回滚 |
|---|---|
| DB 事务 | `opt.db_tx=0` / 代码回退 / DB 备份 |
| 命中计数 | `opt.hit_counter=0` |
| 脚本镜像 | 停用 Canary，启用旧 Full；`opt.script_local_paths=0` |
| 去重 | `opt.dedupe_scripts=0`；启用旧 Full |
| rules_v2 | `opt.rules_v2=0`；旧表未动 |
| snapshot_v2 | `opt.snapshot_v2=0`；旧快照 |
| CNAME/冲突 | 关闭 flag；默认行为不变 |
| 拆包 | 启用 Full 旧模块 |

## 7. 明确不做

- 不删旧表/旧列/旧模块。
- 不把 HTTP 脚本执行搬进 LocalDNS。
- 不重新禁 `*.googlevideo.com` MITM 或 `ump/init/auto-hd`。
- 不把 `requires-body` 对 init/auto-hd 设为 0。
- 不把 `response.js` 改 `jsc`。
- 不在未做影子比对前切换 DNS 读路径。
- 不在未验证前降低 `max-size` 或改脚本 engine。
- 不改变 `/api/v1/status` 等现有响应字段；只新增。

## 8. 建议执行顺序

1. Phase 0（基线/开关/指标）
2. Phase 1（DB 事务/索引）
3. Phase 2（命中/指标/告警过滤）
4. Phase 3（脚本镜像，不改路径）
5. Phase 4（去重/单 Hub，金丝雀）
6. Phase 5（rules_v2 双写/影子）
7. Phase 6（snapshot_v2 影子/切换）
8. Phase 7（准确性增强，默认关闭）
9. Phase 8（脚本拆分，可选）

Phase 1–2 可以不改变任何用户可见行为；Phase 3–4 需要一次 YouTube 客户端/网页实测；Phase 5–6 需要影子差异为 0 才切换。
