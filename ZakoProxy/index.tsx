import { Navigation, NavigationStack, Script, useEffect, useState } from "scripting"
import { ZakoServer } from "./src/server"
import { Store } from "./src/store"
import { DashboardView } from "./src/ui/DashboardView"

// 单例状态保持
let globalStore: Store | null = null
let globalServer: ZakoServer | null = null

function MainApp() {
  const [store, setStore] = useState<Store | null>(globalStore)
  const [server, setServer] = useState<ZakoServer | null>(globalServer)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    async function setup() {
      if (!globalStore) {
        const dataDir = `${Script.directory}/data`
        globalStore = new Store(dataDir)
        await globalStore.init()
      }
      if (!globalServer) {
        globalServer = new ZakoServer(globalStore)
      }
      setStore(globalStore)
      setServer(globalServer)
      setReady(true)
    }
    setup()
  }, [])

  const handleDismiss = async () => {
    if (globalServer && globalServer.isRunning) {
      const choice = await Dialog.actionSheet({
        title: "代理服务正在运行中",
        message: "您可以选择让代理服务在后台继续运行，或者彻底关闭服务并退出脚本。",
        actions: [
          { label: "在后台保持运行 (最小化)" },
          { label: "停止服务并退出", destructive: true },
        ],
      })

      if (choice === 0) {
        // 保持后台运行
        if (Script.supportsMinimization && Script.supportsMinimization()) {
          Script.minimize()
        } else {
          Script.exit()
        }
        return
      } else if (choice === 1) {
        globalServer.stop()
        Script.exit()
        return
      }
      return
    }

    Script.exit()
  }

  if (!ready || !store || !server) {
    return null
  }

  return (
    <NavigationStack>
      <DashboardView
        store={store}
        server={server}
        onDismiss={handleDismiss}
      />
    </NavigationStack>
  )
}

async function run() {
  await Navigation.present(<MainApp />)
}

run()
