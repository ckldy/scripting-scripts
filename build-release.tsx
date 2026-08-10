// 仓库发布构建脚本：遍历仓库根下所有脚本目录，打成 dist/<脚本名>.zip（script.json 在 zip 根）
// 用法: scripting-ts run build-release.tsx --timeout 180
// 注意: FileManager/Archive 是全局 namespace（不要 import，import 得到的方法集不全），Script 从 scripting import
import { Script } from "scripting"

async function build() {
  const root = Script.directory
  const distDir = root + "/dist"
  await FileManager.createDirectory(distDir, true).catch(() => undefined)

  const items = await FileManager.readDirectory(root) // 实际返回文件名 string 数组
  const scriptDirs: string[] = []
  for (const name of items) {
    if (name.startsWith(".") || name === "dist" || name === "node_modules") continue
    const maybeDir = root + "/" + name
    if (await FileManager.exists(maybeDir + "/script.json")) scriptDirs.push(maybeDir)
  }

  let built = 0
  for (const src of scriptDirs) {
    const name = src.substring(src.lastIndexOf("/") + 1)
    const dest = distDir + "/" + name + ".zip"
    await FileManager.remove(dest).catch(() => undefined)
    console.log("开始打包:", src)
    await FileManager.zip(src, dest, false) // shouldKeepParent=false → zip 根直接是脚本文件

    // 验证：zip 根必须含 script.json
    const archive = Archive.openForMode(dest, "read")
    const paths = archive.getEntryPaths()
    const required = ["script.json", "index.tsx"]
    for (const req of required) {
      if (!paths.includes(req)) throw new Error(`${name}: zip 缺少 ${req}，路径: ${paths.slice(0, 10).join(", ")}`)
    }
    console.log(`✅ 打包完成 ${dest}（${paths.length} 个条目，含 script.json/index.tsx）`)
    built++
  }

  if (built === 0) throw new Error("没有找到任何可打包的脚本目录")
  console.log(`共打包 ${built} 个脚本`)
}

build().then(
  () => Script.exit("ok"),
  reason => {
    console.log("构建失败:", reason instanceof Error ? reason.message : String(reason))
    Script.exit("error")
  },
)
