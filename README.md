# Scripting 脚本仓库

Scripting (iOS) 小脚本合集。每个脚本独立目录、独立打包，互不影响。

## 📦 脚本列表

| 脚本 | 版本 | 说明 | 安装链接 |
|---|---|---|---|
| 台风路径 | 2.1.2 | 原版布局的实时台风路径、多机构预报与气象图层地图（数据源: 四创科技）；大号小组件地图需在小组件「参数」或主程序「更多」填写「Web服务」类型高德 Key（已有有效 Key 时自动只读） | [安装](https://www.scripting.fun/import_scripts/?urls=%5B%22https%3A%2F%2Fraw.githubusercontent.com%2Fckldy%2Fscripting-scripts%2Fmain%2Fdist%2F台风路径.zip%22%5D) |
| 黃豆短劇 | 1.2.0 | 浏览、搜索与收藏黃豆短劇内容，支持播放历史、剧集播放、上下滑切集与进度条 | [安装](https://www.scripting.fun/import_scripts/?urls=%5B%22https%3A%2F%2Fraw.githubusercontent.com%2Fckldy%2Fscripting-scripts%2Fmain%2Fdist%2F黃豆短劇.zip%22%5D) |

## 📥 安装方法

1. 点击上表"安装"链接（https 网页），页面会生成 `scripting://import_scripts` 导入链接；
2. 在 Scripting 应用中打开该链接（或在浏览器复制链接，粘贴到 Scripting 的"导入脚本"）；
3. 确认导入即可，脚本出现在 Scripting 首页。

> 也可以直接使用导入链接：`scripting://import_scripts?urls=https://raw.githubusercontent.com/ckldy/scripting-scripts/main/dist/黃豆短劇.zip`

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
