// 高德地图 Key 配置：读取/保存统一入口
// 来源优先级：小组件「参数」(Widget.parameter) → App Group 共享文件 → Keychain
// - 小组件扩展无法保证 Keychain 可用，写入 App Group 共享文件是跨上下文的主通道
// - 主程序「更多」面板保存时同时写 App Group 文件与 Keychain（兼容旧版本地配置）

import { Path, Widget } from 'scripting'

export const AMAP_KEYCHAIN_KEY = 'TyphoonTrackWidget.AMapWebServiceKey'
const CONFIG_DIR = Path.join(FileManager.appGroupDocumentsDirectory, 'TyphoonTrackWidget')
const CONFIG_PATH = Path.join(CONFIG_DIR, 'amap-config.json')

type AmapConfig = { key?: string; updatedAt?: number }

/** 从小组件「参数」栏解析高德 Key：直接粘贴明文，或 JSON（amapKey/key/amap 字段）。仅 widget 上下文调用。 */
export function widgetParameterAmapKey(): string {
  try {
    const raw = String(Widget.parameter || '').trim()
    if (!raw) return ''
    if (raw.startsWith('{')) {
      const parsed = JSON.parse(raw) as Record<string, unknown>
      for (const field of ['amapKey', 'key', 'amap'] as const) {
        const value = parsed[field]
        if (typeof value === 'string' && value.trim()) return value.trim()
      }
      return ''
    }
    return raw
  } catch {
    return ''
  }
}

/** 读取已保存的高德 Key：App Group 共享文件优先，Keychain 兜底（兼容旧版本地配置）。 */
export function readSavedAmapKey(): string {
  try {
    if (FileManager.existsSync(CONFIG_PATH)) {
      const config = JSON.parse(FileManager.readAsStringSync(CONFIG_PATH)) as AmapConfig
      if (typeof config.key === 'string' && config.key.trim()) return config.key.trim()
    }
  } catch {
    // 文件损坏时忽略，继续尝试 Keychain
  }
  try {
    return String(Keychain.get(AMAP_KEYCHAIN_KEY) || '').trim()
  } catch {
    return ''
  }
}

/** 保存高德 Key（空值表示清除）。返回保存后的 key（可能为 ''）。 */
export function saveAmapKey(key: string): string {
  const trimmed = String(key || '').trim()
  try {
    FileManager.createDirectorySync(CONFIG_DIR, true)
    FileManager.writeAsStringSync(CONFIG_PATH, JSON.stringify({ key: trimmed, updatedAt: Date.now() }))
  } catch (error) {
    console.error('App Group 配置写入失败', String(error))
  }
  try {
    if (trimmed) Keychain.set(AMAP_KEYCHAIN_KEY, trimmed)
    else Keychain.remove(AMAP_KEYCHAIN_KEY)
  } catch (error) {
    // 小组件扩展等环境 Keychain 可能不可用，App Group 文件已足够
    console.error('Keychain 写入失败', String(error))
  }
  return trimmed
}

export function maskAmapKey(key: string): string {
  const trimmed = String(key || '').trim()
  if (trimmed.length <= 8) return '••••••••'
  return `${trimmed.slice(0, 4)}••••${trimmed.slice(-4)}`
}

// 注意：amapKeyStatus 刻意不返回完整 key。完整 Key 只允许在原生/小组件扩展内通过 readSavedAmapKey 使用，
// 不跨 WebView bridge 传出，避免页面逻辑、调试输出或第三方资源扩大 Key 暴露面。
export function amapKeyStatus(): { configured: boolean; masked?: string; updatedAt?: number } {
  try {
    const key = readSavedAmapKey()
    if (!key) return { configured: false }
    let updatedAt: number | undefined
    try {
      if (FileManager.existsSync(CONFIG_PATH)) {
        const config = JSON.parse(FileManager.readAsStringSync(CONFIG_PATH)) as AmapConfig
        if (typeof config.updatedAt === 'number') updatedAt = config.updatedAt
      }
    } catch {}
    return { configured: true, masked: maskAmapKey(key), updatedAt }
  } catch {
    return { configured: false }
  }
}
