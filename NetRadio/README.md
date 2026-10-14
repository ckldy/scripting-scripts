# NetRadio（网络收音机）- Scripting 脚本版

基于 **[net-redio](https://github.com/yichuancq/net-redio)** 开源项目深度移植与适配的 iOS Scripting 原生网络收音机。

> **移植 / 维护**：[vcncv](https://github.com/ckldy) ｜ **原始项目**：[yichuancq/net-redio](https://github.com/yichuancq/net-redio)

---

## 致谢声明与原始仓库

- **原始项目仓库**：[https://github.com/yichuancq/net-redio](https://github.com/yichuancq/net-redio)
- **原始项目作者**：[yichuancq](https://github.com/yichuancq)
- **Scripting 移植与增强**：[vcncv](https://github.com/ckldy)
- **开源许可证**：遵循开源协议

**特别鸣谢**：
衷心感谢原作者 **yichuancq** 开发并开源的 **NetRadio（net-redio）** 项目！
原仓库设计了极具质感的黑胶唱机拟真动效、复古金属唱臂交互、矩阵式跳动示波器、多主题自适应色板，并悉心整理了全球各大洲数百家优质流媒体广播电台（涵盖 SomaFM、广播流、古典、爵士、电子等丰富品类）。

在将其转换为 Scripting 脚本的过程中，我们完整保留了原项目的全部精致 UI、动效与功能 Tab，同时针对 iOS 移动端生态进行了深度原生增强，将其升级为一款体验丝滑、原生级后台保活的随身网络收音机。

---

## 核心特性

### 1. 完整保留原项目所有精致界面与交互
- **黑胶唱机舞台**：拟真黑胶唱片旋转动画、高光反射与沟槽纹理；可自定义 5 种唱片底色（黑、白、蓝、红、黄）与 3 档旋转速度（33⅓ RPM、慢速、快速）；复古金属机械唱臂随着播放/暂停平滑抬起与下落。
- **矩阵式电平示波器**：底部播放条内置 11 列 × 8 行动态跳动电平指示器（绿/黄/红三色阶梯），随音乐播放律动，静音时自适应压低。
- **丰富的主题调色盘**：内置 36 种设计师精选强调色色板，结合 Dark / Light 深浅双色主题，按钮高亮、边框、卡片阴影动态自适应。
- **全功能导航与分类**：
  - **所有电台**：按热度排序浏览全球电台。
  - **大洲与国家折叠列表**：亚洲、欧洲、北美、南美、大洋洲、非洲等按国家精准分类筛选。
  - **实时搜索**：支持电台名称、流派、国家、DJ、描述及正在播放曲目关键词毫秒级搜索。
  - **星标收藏夹**：一键收藏喜爱电台，带未读角标与独立展示视图。
  - **收听历史记录**：自动按时间线记录最近收听电台，支持一键回放与单独/批量清除。
  - **偏好设置与关于**：所有设置与开关（示波器显隐、唱臂显隐、配色、转速）均本地持久化保存。

### 2. iOS 原生音频引擎增强（Scripting Native Integration）
- **原生 `AVPlayer` 核心**：不再受限于浏览器后台音频休眠限制，直接调用 iOS 原生音视频管线播放 MP3、AAC 与 HLS 直链，低功耗、高保真。
- **后台常驻播放（`SharedAudioSession`）**：配置 `playback` 音频会话并激活，配合 `Script.minimize()` 最小化保活，锁屏或切换 App 后广播流依旧稳定不断流。
- **锁屏与控制中心控制（`MediaPlayer` / `NowPlayingInfo`）**：
  - 锁屏界面和 Dynamic Island / 灵动岛完整显示当前电台名称、简介与流派；
  - 标识 `isLiveStream: true`，完美适配电台无时长直播态；
  - 支持系统锁屏、控制中心与蓝牙耳机线控的播放、暂停与切台。
- **双向通信桥接**：Native 播放状态与 Web 动效严格同步，耳机一按，唱片旋转与示波器即刻联动。
- **退出与后台生命周期选项**：退出时提供优雅弹窗询问「后台继续收听」或「完全退出」，不打断听歌体验。

### 3. 电台数据
- 内置全球 **1000+** 家公开流媒体电台清单（`stations.json`），覆盖中国（含央广/CRI/地方台）、港澳台、日韩、欧美、南美、大洋洲等 **36 个地区**。
- 数据按国家/地区归类，前端支持按大洲 → 国家逐级筛选。

---

## 项目结构

```text
NetRadio/
├── script.json         # Scripting 脚本元数据配置（含署名、致谢、remoteResource）
├── README.md           # 项目说明、转换说明与致谢声明
├── index.tsx           # 入口：Navigation 全屏挂载 + 最小化后台保活
├── view.tsx            # 主视图：NavigationStack + WebView + 原生 AVPlayer/MediaPlayer 桥接
├── stations.json       # 全球 1000+ 电台数据清单
└── web/
    └── index.html      # 完整保留全部 UI、动效与 Tab 的单文件前端
```

---

## 安装

导入仓库发布的安装包：`dist/NetRadio.zip`

```
https://raw.githubusercontent.com/ckldy/scripting-scripts/main/dist/NetRadio.zip
```

---

再次感谢原作者 **yichuancq** 的开源奉献！本项目由 **[vcncv](https://github.com/ckldy)** 移植与维护。
