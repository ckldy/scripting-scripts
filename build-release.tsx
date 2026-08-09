// 仓库发布构建脚本：把 scripts/<名字>/ 打成 dist/<名字>.zip（script.json 在 zip 根）
// 用法: scripting-ts run build-release.tsx --timeout 180
// 注意: FileManager/Archive 是全局 namespace（不要 import），Script 从 scripting import
import { Script } from "scripting"

async function build() {
  const root = Script.directory
  const distDir = root + "/dist"

  const src = root + "/黃豆短劇"
  const dest = distDir + "/黃豆短劇.zip"
  await FileManager.remove(dest).catch(() => undefined)
  console.log("开始打包:", src)
  await FileManager.zip(src, dest, false) // shouldKeepParent=false → zip 根直接是脚本文件

  // 验证：zip 根必须含 script.json
  const archive = Archive.openForMode(dest, "read")
  const paths = archive.getEntryPaths()
  const required = ["script.json", "index.tsx"]
  for (const req of required) {
    if (!paths.includes(req)) throw new Error(`zip 缺少 ${req}，路径: ${paths.slice(0, 10).join(", ")}`)
  }
  console.log(`✅ 打包完成 ${dest}（${paths.length} 个条目，含 script.json/index.tsx）`)
}

build().then(
  () => Script.exit("ok"),
  reason => {
    console.log("构建失败:", reason instanceof Error ? reason.message : String(reason))
    Script.exit("error")
  },
)
