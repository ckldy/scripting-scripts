# Scripting 脚本仓库

Scripting (iOS) 小脚本合集。每个脚本独立目录、独立打包，互不影响。

## 📦 脚本列表

| 脚本 | 版本 | 说明 | 安装链接 |
|---|---|---|---|
| LocalDNS（本地 DNS 服务） | 1.2.0 | 本地 DNS 服务管理系统，带全功能玻璃质感 Web 控制台与 DoH 服务（作者 vcncv，致敬 yyhoworks/LocalDNS 与 R 大） | [安装](https://www.scripting.fun/import_scripts/?urls=%5B%22https%3A%2F%2Fraw.githubusercontent.com%2Fckldy%2Fscripting-scripts%2Fmain%2Fdist%2FLocalDNS.zip%22%5D) |
| 台风路径 | 2.3.1 | 实时台风路径、多机构预报与气象图层；主程序刷新后会同步重载用户小组件，大号组件地图缓存批处理仅重载一次 | [安装](https://www.scripting.fun/import_scripts/?urls=%5B%22https%3A%2F%2Fraw.githubusercontent.com%2Fckldy%2Fscripting-scripts%2Fmain%2Fdist%2F台风路径.zip%22%5D) |
| 黃豆短劇 | 1.2.0 | 浏览、搜索与收藏黃豆短劇内容，支持播放历史、剧集播放、上下滑切集与进度条 | [安装](https://www.scripting.fun/import_scripts/?urls=%5B%22https%3A%2F%2Fraw.githubusercontent.com%2Fckldy%2Fscripting-scripts%2Fmain%2Fdist%2F黃豆短劇.zip%22%5D) |
| NetRadio（网络收音机） | 1.0.1 | 全球 1000+ 公开网络电台（按 36 个国家/地区归类），黑胶唱机舞台、电平示波器、主题调色板与 iOS 原生后台/锁屏播控（基于 net-redio 移植，作者 vcncv） | [安装](https://www.scripting.fun/import_scripts/?urls=%5B%22https%3A%2F%2Fraw.githubusercontent.com%2Fckldy%2Fscripting-scripts%2Fmain%2Fdist%2FNetRadio.zip%22%5D) |
| 音乐大合集 | 1.0.0 | 多源聚合音乐播放器，支持 QQ/网易/酷狗/酷我/咪咕音源，经典与沉浸播放页窗口自适应、纯净无下划线歌词、多样式进度条与后台保活播放（作者 vcncv） | [安装](https://www.scripting.fun/import_scripts/?urls=%5B%22https%3A%2F%2Fraw.githubusercontent.com%2Fckldy%2Fscripting-scripts%2Fmain%2Fdist%2F%E9%9F%B3%E4%B9%90%E5%A4%A7%E5%90%88%E9%9B%86.zip%22%5D) |

## 📥 安装方法

1. 点击上表"安装"链接（https 网页），页面会生成 `scripting://import_scripts` 导入链接；
2. 在 Scripting 应用中打开该链接（或在浏览器复制链接，粘贴到 Scripting 的"导入脚本"）；
3. 确认导入即可，脚本出现在 Scripting 首页。

## 🌟 脚本功能详解与直链

### 🛡️ LocalDNS (本地 DNS 服务管理系统)
- **版本**：`1.2.0` ｜ **作者**：`vcncv`（原案致敬 `yyhoworks/LocalDNS` 与 R 大）
- **特性**：
  - **纯 TypeScript DNS 核心引擎**：纯 TS 实现 RFC 1035 / 3596 标准二进制 DNS 报文编解码，支持 A, AAAA, CNAME, PTR, SOA, TXT, HTTPS 等；
  - **双通道共生架构**：HTTP 端口 9099（Web 玻璃控制台/REST API/普通 DoH 秒开免证书）+ HTTPS 端口 9443（Surge 专用的安全 TLS 1.3 DoH，支持自签名证书链）；
  - **Happy Eyeballs 双发自愈竞速与 SingleFlight**：多上游并发测速与首包采纳，350ms 内未返回自动拉起国内节点双发竞速，高并发重复查询 0 延迟秒级共享返回，彻底消灭超时卡顿；
  - **四级缓存池与 AdGuard 广告拦截**：核心缓存、国内、国外、国外 ECS 四级隔离与动态 TTL 衰减；内置 AdGuard 语法与 Hosts 拦截引擎，支持在线规则自动镜像拉取；
  - **11 层精准分流路由器**：重定向 Rewrite、黑白名单、强制 RealIP、GeoIP、Geosite 与国内大厂启发式分流；
  - **全功能玻璃质感 Web 控制台**：内嵌 5 套光影预设、Noto Serif SC 宋体标题、Instrument Serif 衬线数字字体、Chart.js 实时 QPS 趋势图、名单在线编辑与多级缓存查看；
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
