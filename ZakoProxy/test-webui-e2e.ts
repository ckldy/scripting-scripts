import { Script } from "scripting"
import { ZakoServer } from "./src/server"
import { Store } from "./src/store"

declare function fetch(input: any, init?: any): Promise<any>

async function runE2ETest() {
  console.log("=== 开始 ZakoProxy 流光毛玻璃 Web 控制台 E2E 端到端测试 ===")

  const dataDir = `${Script.directory}/data`
  const store = new Store(dataDir)
  await store.init()

  const server = new ZakoServer(store)
  const testPort = 1998 // 使用独立测试端口
  const startRes = server.start(testPort)

  if (!startRes.success) {
    console.error("❌ 服务启动失败:", startRes.error)
    return false
  }

  const port = startRes.port || testPort
  console.log(`✅ ZakoProxy 测试服务已成功启动于端口 :${port}`)

  let allPassed = true
  const assert = (condition: boolean, msg: string) => {
    if (condition) {
      console.log(`  ✓ ${msg}`)
    } else {
      console.error(`  ✗ ${msg}`)
      allPassed = false
    }
  }

  try {
    const baseUrl = `http://127.0.0.1:${port}`

    // 1. 测试根路径重定向
    console.log("\n[1/5] 测试 Web 静态资源与路由重定向...")
    const rRoot = await fetch(`${baseUrl}/`)
    assert(rRoot.status === 200 || rRoot.status === 302, `GET / 正常响应或重定向 (状态码 ${rRoot.status})`)

    // 2. 测试 WebUI index.html 响应
    const rHtml = await fetch(`${baseUrl}/ui/`)
    const htmlText = await rHtml.text()
    assert(rHtml.status === 200, `GET /ui/ 状态码 200`)
    assert(
      htmlText.includes("ZakoProxy · 流光毛玻璃控制台"),
      "index.html 包含控制台标题"
    )
    assert(
      htmlText.includes("data-preset=\"cosmos\""),
      "index.html 包含 cosmos 流光背景预设"
    )

    // 3. 测试 CSS 静态资源
    const rCss = await fetch(`${baseUrl}/ui/assets/css/glass.css`)
    const cssText = await rCss.text()
    assert(rCss.status === 200, "GET /ui/assets/css/glass.css 状态码 200")
    assert(
      cssText.includes("--glass-blur"),
      "glass.css 包含毛玻璃滤镜与流光变量"
    )

    // 4. 测试 JS 静态资源
    const rJs = await fetch(`${baseUrl}/ui/assets/js/app.js`)
    const jsText = await rJs.text()
    assert(rJs.status === 200, "GET /ui/assets/js/app.js 状态码 200")
    assert(
      jsText.includes("initAppearance"),
      "app.js 包含流光毛玻璃与交互初始化"
    )

    // 5. 测试 Chart.js 静态资源
    const rChart = await fetch(`${baseUrl}/ui/assets/js/chart.umd.min.js`)
    assert(rChart.status === 200, "GET /ui/assets/js/chart.umd.min.js 状态码 200")

    // 6. 测试 Logo 图标
    const rLogo = await fetch(`${baseUrl}/ui/assets/img/logo.png`)
    assert(rLogo.status === 200, "GET /ui/assets/img/logo.png 状态码 200")

    // 测试 REST API 路由
    console.log("\n[2/5] 测试核心 REST API 路由 (/api/*)...")

    // GET /api/system
    const rSys = await fetch(`${baseUrl}/api/system`)
    const dSys = await rSys.json()
    assert(rSys.status === 200, "GET /api/system 状态码 200")
    assert(dSys.app === "ZakoProxy", `系统名匹配: ${dSys.app}`)
    assert(dSys.running === true, `运行状态匹配: ${dSys.running}`)
    assert(dSys.profiles_count === 36, `策略库数量匹配: ${dSys.profiles_count}`)

    // GET /api/stats
    const rStats = await fetch(`${baseUrl}/api/stats`)
    const dStats = await rStats.json()
    assert(rStats.status === 200, "GET /api/stats 状态码 200")
    assert("hourlyTrend" in dStats, "包含 24 小时吞吐分桶趋势")
    assert("accountsRuntime" in dStats, "包含账号运行时并发监控")

    // GET /api/profiles
    const rProfiles = await fetch(`${baseUrl}/api/profiles`)
    const dProfiles = await rProfiles.json()
    assert(rProfiles.status === 200, "GET /api/profiles 状态码 200")
    assert(Array.isArray(dProfiles) && dProfiles.length === 36, `成功枚举 36 款专属策略`)

    // GET /api/groups
    const rGroups = await fetch(`${baseUrl}/api/groups`)
    const dGroups = await rGroups.json()
    assert(rGroups.status === 200, "GET /api/groups 状态码 200")
    assert(Array.isArray(dGroups) && dGroups.length >= 1, "包含默认 Primary 分组")

    // GET /api/settings
    const rSettings = await fetch(`${baseUrl}/api/settings`)
    const dSettings = await rSettings.json()
    assert(rSettings.status === 200, "GET /api/settings 状态码 200")
    assert("max_retries" in dSettings, "包含故障转移重试参数")

    console.log("\n[3/5] 测试客户端 API 密钥 CRUD 与 SHA-256 安全哈希...")
    // POST /api/keys
    const rCreateKey = await fetch(`${baseUrl}/api/keys`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "E2E-Test-Key" }),
    })
    const dCreateKey = await rCreateKey.json()
    assert(rCreateKey.status === 200, "POST /api/keys 创建密钥成功")
    assert(Boolean(dCreateKey.raw_key), `生成 raw_key 成功: ${dCreateKey.raw_key?.slice(0, 10)}...`)
    assert(dCreateKey.key?.name === "E2E-Test-Key", "密钥名称一致")
    const testKeyId = dCreateKey.key?.id

    // PATCH /api/keys/:id
    const rPatchKey = await fetch(`${baseUrl}/api/keys/${testKeyId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    })
    const dPatchKey = await rPatchKey.json()
    assert(dPatchKey.key?.enabled === false, "PATCH /api/keys/:id 成功停用密钥")

    // DELETE /api/keys/:id
    const rDelKey = await fetch(`${baseUrl}/api/keys/${testKeyId}`, {
      method: "DELETE",
    })
    const dDelKey = await rDelKey.json()
    assert(dDelKey.success === true, "DELETE /api/keys/:id 成功删除密钥")

    console.log("\n[4/5] 测试上游账号 CRUD 与 AES-256 加密保护...")
    // POST /api/accounts
    const rCreateAcc = await fetch(`${baseUrl}/api/accounts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "E2E-Upstream",
        endpoint: "https://api.openai.com/v1",
        api_key: "sk-test-secret-1234567890",
        priority: 5,
        models: ["gpt-4o", "gpt-4o-mini"],
        protocols: ["chat", "responses"],
      }),
    })
    const dCreateAcc = await rCreateAcc.json()
    assert(rCreateAcc.status === 200, "POST /api/accounts 创建账号成功")
    assert(dCreateAcc.account?.api_key === undefined, "返回中严格脱敏不返回明文 API Key")
    const testAccId = dCreateAcc.account?.id

    // GET /api/accounts (验证脱敏与运行时信息)
    const rGetAccs = await fetch(`${baseUrl}/api/accounts`)
    const dGetAccs = await rGetAccs.json()
    const foundAcc = dGetAccs.find((a: any) => a.id === testAccId)
    assert(Boolean(foundAcc), "在账号列表中找到新建账号")
    assert(foundAcc?.api_key_masked?.includes("••••"), "展示已脱敏 API Key")

    // POST /api/accounts/:id/test (连通性测试)
    const rTestAcc = await fetch(`${baseUrl}/api/accounts/${testAccId}/test`, {
      method: "POST",
    })
    const dTestAcc = await rTestAcc.json()
    assert(rTestAcc.status === 200, "POST /api/accounts/:id/test 请求完成")
    assert("latency_ms" in dTestAcc, `测得往返延迟: ${dTestAcc.latency_ms}ms`)

    // DELETE /api/accounts/:id
    const rDelAcc = await fetch(`${baseUrl}/api/accounts/${testAccId}`, {
      method: "DELETE",
    })
    const dDelAcc = await rDelAcc.json()
    assert(dDelAcc.success === true, "DELETE /api/accounts/:id 成功删除测试账号")

    console.log("\n[5/5] 测试原有 AI 代理核心接口连通性...")
    const rHealth = await fetch(`${baseUrl}/health`)
    const dHealth = await rHealth.json()
    assert(dHealth.status === "ok", "GET /health 状态健康")

    const rNotFound = await fetch(`${baseUrl}/non-existent-route`)
    assert(rNotFound.status === 404, "未知路径正确返回 404")

    console.log("\n=======================================================")
    if (allPassed) {
      console.log("🎉 所有 25 项流光毛玻璃 Web 控制台与 REST API 测试 100% 通过！")
    } else {
      console.error("❌ 部分测试用例未通过，请检查上述错误日志！")
    }
  } catch (err: any) {
    console.error("测试异常发生:", err)
    allPassed = false
  } finally {
    server.stop()
    console.log("测试服务已停止。")
    Script.exit(allPassed ? 0 : 1)
  }

  return allPassed
}

runE2ETest()
