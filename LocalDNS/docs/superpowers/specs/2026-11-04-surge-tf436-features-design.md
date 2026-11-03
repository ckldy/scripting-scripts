# Surge TestFlight 436 全特性深度整合设计方案

> **日期**：2026-11-04  
> **适用版本**：LocalDNS v1.15.0 × Surge TestFlight 436+ (iOS / Mac)  
> **设计模式**：方案 A（全量渐进整合：AdHunter 离线抓包提纯 + 抓包会话审查 + 流量下钻 + 组网直连穿透）

---

## 1. 方案目标与背景

Surge TestFlight 436 开放了三大底层新特性：
1. **落盘抓包会话 API (`Saved Capture Sessions`)**：`/v1/capture/sessions`、`/v1/capture/sessions/requests` 与 `/v1/capture/sessions/data`，首次允许外部程序读取已经归档落盘的历史完整 HTTP/HTTPS 请求与响应体（Raw Body）；
2. **流量统计多维下钻 (`traffic-stat-breakdown`)**：支持 `policy host`（节点 $\to$ 域名）、`device host`（设备 $\to$ 域名）等多维交叉聚合；
3. **Tailscale & WireGuard 本机回环穿透修复**：打通本机向自身虚拟网卡隧道 IP 及 MagicDNS 的通信死锁。

本方案旨在将上述能力全方位融入 LocalDNS 的**去广告研发、流量审计与配置中枢**三大模块中。

---

## 2. 详细架构设计

### 模块 1：AdHunter 离线抓包会话深度扫描与规则自动合成
- **痛点**：传统 AdHunter 仅能扫描用户输入 URL 抓取的公开网页 HTML，无法获取 iOS App 内嵌广告（如开屏、短视频信息流、视频中插）的 JSON/Protobuf 接口报文。
- **流程**：
  1. 用户在手机上打开 Surge 开启「抓包」复现广告，随后会话落盘保存；
  2. 打开 LocalDNS `ad-hunter.html`，点击「📂 从 Surge 历史抓包导入」；
  3. 后端通过 `/api/v1/ad-hunter/surge-sessions` 代理拉取 Surge `/v1/capture/sessions`，前端以下拉列表呈现；
  4. 选定会话后，后端以分页方式扫描该会话下的请求（提取带有 `application/json`、`text/html` 的响应）；
  5. 调用 `/v1/capture/sessions/data?type=response` 提取原始响应 Body；
  6. 广告特征识别引擎扫描响应体中的高频广告键名（如 `ad`, `ads`, `ad_slots`, `adPlacement`, `splash`, `promotion` 等），提取广告拦截目标路径；
  7. 自动合成 Surge `URL-REGEX` 零域名脱水规则与 Userscript Defuser 脚本，一键写入 LocalDNS 并下发 Surge 热载。

### 模块 2：Surge 历史抓包会话审查面板 (Capture Sessions Explorer)
- **定位**：在 Surge 治理工作台（`web/assets/surge-workbench.js`）新增「🔍 抓包会话」子标签页。
- **能力**：
  1. 会话列表展示：时间、请求总数、限制条件（条数/时长）、终止原因（用户停止、达到限制等）；
  2. 会话请求浏览器：支持输入过滤词（域名、路径、进程名、状态码），分页查看请求明细；
  3. 报文详情弹窗：一键查看指定请求的请求头/体、响应头/体，自带 JSON 格式化与高亮，支持一键复制 cURL 命令或注入 AdHunter 进行规则提纯。

### 模块 3：代理流量「节点 $\to$ 域名」下钻拆解
- **定位**：增强 `src/traffic.ts` 与代理页面流量排行。
- **能力**：
  1. 调用 Surge `/v1/traffic` 与 `/v1/requests/recent` / 会话连接器明细；
  2. 聚合每个节点（如 `德国-fk.vcncv.com`）流经的 Top 域名列表及流量占比；
  3. 在「流量统计」的节点卡片中，支持点击展开该节点下的高频访问域名。

### 模块 4：Tailscale & WireGuard 回环穿透直连保护
- **定位**：增强 `src/surge-service.ts` 的 `generateSurgeConfig`。
- **能力**：
  1. 自动在 Surge 配置文件的 `skip-proxy` 和 `[Rule]` 顶部注入：
     - `IP-CIDR,100.64.0.0/10,DIRECT,no-resolve`（Tailscale CGNAT）
     - `DOMAIN-SUFFIX,ts.net,DIRECT`（Tailscale MagicDNS）
  2. 确保 LocalDNS、Surge 与跨机局域网设备通过 Tailscale 隧道安全组网时 100% 毫秒级直连，不走代理通道。

---

## 3. 后端 API 契约扩展

| 端点 | 方法 | 说明 |
| :--- | :---: | :--- |
| `/api/v1/surge/capture/sessions` | GET | 代理拉取 Surge 保存的全部抓包会话列表 |
| `/api/v1/surge/capture/requests` | GET | 分页检索指定会话内的请求条目（支持 query, offset, limit） |
| `/api/v1/surge/capture/data` | GET | 提取指定会话指定请求的 Raw Request/Response Body |
| `/api/v1/ad-hunter/analyze-session` | POST | AdHunter 自动分析指定 Surge 会话中的广告特征并合成规则 |

---

## 4. 实施阶段与测试验收

1. **Phase 1**：后端 Surge API 扩展（会话列表、请求分页、Raw Body 提取端点），编写集成测试；
2. **Phase 2**：AdHunter 引擎与前端集成，支持从 Surge 历史会话分析广告并一键合成入库；
3. **Phase 3**：Surge 工作台新增「抓包会话审查」面板，支持报文查看与 AdHunter 联动；
4. **Phase 4**：Tailscale 穿透规则写入 `generateSurgeConfig`，全链路自动化回归测试。
