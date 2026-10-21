# LocalDNS for Scripting App

> **当前版本**：`v1.7.0 (Build 20261021)`  
> **移植作者**：`vcncv`  
> **上游开源**：[yyhoworks/LocalDNS](https://github.com/yyhoworks/LocalDNS)（对齐 UI `2026.10.18.19` / 内核 `FJGAC`）

将 [yyhoworks/LocalDNS](https://github.com/yyhoworks/LocalDNS)（Rust DNS 核心 + 双皮肤 Web 控制台）完整转换为适配 **iOS Scripting App** 的本地高性能 DNS 服务与安全管理系统。

v1.6.0 去伪存真、彻底瘦身，砍掉无法在 DNS 网络层生效的虚假 L7 代理与伪切片清洗，回归纯粹、极致、稳定的 DNS 核心与 18.5 万条广告拦截基础设施。

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

### 3. 上游 FJGAC / UI 2026.10.18.19 清单工作台与配置协同
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
