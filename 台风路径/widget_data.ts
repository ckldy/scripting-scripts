import { Path, fetch } from 'scripting'

export const TYPHOON_API = 'https://tf02.istrongcloud.com/'
export const WIDGET_CACHE_DIR = Path.join(FileManager.appGroupDocumentsDirectory, 'TyphoonTrackWidget')
const CACHE_PATH = Path.join(WIDGET_CACHE_DIR, 'state.json')
export const MAX_MERCATOR_LAT = 85.05112878

/** 给 Promise 增加有限超时：底层请求无法中止，但调用方不会无限等待挂起。 */
export function withTimeout<T>(promise: Promise<T>, ms: number, message = '请求超时'): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    promise.then(
      value => { clearTimeout(timer); resolve(value) },
      error => { clearTimeout(timer); reject(error) }
    )
  })
}

export type Quadrants = { ne?: number; se?: number; sw?: number; nw?: number }
export type ForecastSet = { sets: string; points?: TyphoonPoint[] }
export type TyphoonPoint = {
  lat: number
  lng: number
  time?: string
  speed?: number
  power?: number
  pressure?: number
  strong?: string
  move_dir?: string
  move_speed?: number
  radius7?: number
  radius10?: number
  radius12?: number
  radius7_quad?: Quadrants
  radius10_quad?: Quadrants
  radius12_quad?: Quadrants
  forecast?: ForecastSet[] | null
  location?: string
  completion?: string
}
export type LandRecord = { land_time?: string; position?: string; lat?: number; lng?: number }
export type Typhoon = {
  tfbh?: string
  ident?: string
  name?: string
  points: TyphoonPoint[]
  land?: LandRecord[]
}
export type WidgetCache = {
  typhoons: Typhoon[]
  selectedId?: string
  updatedAt: number
  lastAutoAdvanceAt?: number
}

export function widgetMapPath(id: string) {
  return Path.join(WIDGET_CACHE_DIR, `map-${id}.png`)
}

export type WidgetMapManifest = {
  typhoonId: string
  pointTime: string
  dataUpdatedAt: number
  mapPath: string
  generatedAt: number
}

export function widgetMapManifestPath(id: string) {
  return Path.join(WIDGET_CACHE_DIR, `map-${id}.json`)
}

/** 读取地图缓存 manifest；缺失或字段非法返回 null（Widget 不得展示无代次绑定的旧地图）。 */
export function readWidgetMapManifest(id: string): WidgetMapManifest | null {
  try {
    const path = widgetMapManifestPath(id)
    if (!FileManager.existsSync(path)) return null
    const value = JSON.parse(FileManager.readAsStringSync(path)) as WidgetMapManifest
    if (typeof value?.typhoonId !== 'string' || typeof value?.pointTime !== 'string' || typeof value?.mapPath !== 'string') return null
    return value
  } catch {
    return null
  }
}

export function typhoonId(tf: Typhoon) {
  return String(tf.tfbh || tf.ident || '')
}

export function readCache(): WidgetCache | null {
  try {
    if (!FileManager.existsSync(CACHE_PATH)) return null
    const value = JSON.parse(FileManager.readAsStringSync(CACHE_PATH)) as WidgetCache
    return Array.isArray(value.typhoons) ? value : null
  } catch {
    return null
  }
}

export function writeCache(cache: WidgetCache) {
  FileManager.createDirectorySync(WIDGET_CACHE_DIR, true)
  // 同目录临时文件 + rename 原子替换，避免写入中断留下半截 JSON。
  const tempPath = Path.join(WIDGET_CACHE_DIR, `state.json.tmp-${Date.now()}`)
  FileManager.writeAsStringSync(tempPath, JSON.stringify(cache))
  try {
    if (FileManager.existsSync(CACHE_PATH)) FileManager.removeSync(CACHE_PATH)
    FileManager.renameSync(tempPath, CACHE_PATH)
  } catch (error) {
    if (FileManager.existsSync(tempPath)) FileManager.removeSync(tempPath)
    throw error
  }
}

function validTyphoons(value: unknown): Typhoon[] {
  if (!Array.isArray(value)) return []
  return value.filter((tf): tf is Typhoon => {
    if (!tf || typeof tf !== 'object') return false
    const points = (tf as Typhoon).points
    return Array.isArray(points) && points.some(point => Number.isFinite(+point.lat) && Number.isFinite(+point.lng) && +point.lat >= -85 && +point.lat <= 85 && +point.lng >= -180 && +point.lng <= 180)
  })
}

export async function fetchTyphoons(): Promise<Typhoon[]> {
  const response = await withTimeout(fetch(TYPHOON_API + 'data/complex/currMerger.json'), 15000, '台风清单请求超时')
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const typhoons = validTyphoons(await withTimeout(response.json(), 10000, '台风清单解析超时'))
  if (!typhoons.length) return []
  await Promise.all(typhoons.map(async tf => {
    const last = tf.points.at(-1)
    if (!last) return
    try {
      const response = await withTimeout(fetch(TYPHOON_API + `data/completion/${encodeURIComponent(typhoonId(tf))}.json`), 8000, '台风详情请求超时')
      if (!response.ok) return
      const completion = await withTimeout(response.json(), 8000, '台风详情解析超时')
      if (String(completion?.time || '') === String(last.time || '')) {
        last.location = String(completion.location || '')
        last.completion = String(completion.completion || '')
      }
    } catch {}
  }))
  return typhoons
}

export function lastValidPoint(tf: Typhoon): TyphoonPoint | null {
  for (let index = tf.points.length - 1; index >= 0; index--) {
    const point = tf.points[index]
    if (Number.isFinite(+point.lat) && Number.isFinite(+point.lng) &&
      +point.lat >= -MAX_MERCATOR_LAT && +point.lat <= MAX_MERCATOR_LAT &&
      +point.lng >= -180 && +point.lng <= 180) return point
  }
  return null
}

export async function loadWidgetData() {
  const cached = readCache()
  try {
    const typhoons = await fetchTyphoons()
    const ids = new Set(typhoons.map(typhoonId))
    const selectedId = cached?.selectedId && ids.has(cached.selectedId)
      ? cached.selectedId
      : typhoonId(typhoons[0] || { points: [] })
    const cache: WidgetCache = {
      typhoons,
      selectedId,
      updatedAt: Date.now(),
      lastAutoAdvanceAt: cached?.lastAutoAdvanceAt ?? Date.now()
    }
    writeCache(cache)
    return { cache, stale: false }
  } catch (error) {
    if (cached) return { cache: cached, stale: true, error: String(error) }
    throw error
  }
}

export function selectedIndex(cache: WidgetCache) {
  if (!cache.typhoons.length) return 0
  const index = cache.typhoons.findIndex(tf => typhoonId(tf) === cache.selectedId)
  return index >= 0 ? index : 0
}

export function shiftSelection(step: number) {
  const cache = readCache()
  if (!cache?.typhoons.length) return
  const index = (selectedIndex(cache) + step + cache.typhoons.length) % cache.typhoons.length
  cache.selectedId = typhoonId(cache.typhoons[index])
  cache.lastAutoAdvanceAt = Date.now()
  writeCache(cache)
}

export function autoAdvance(cache: WidgetCache, now = Date.now()) {
  if (cache.typhoons.length < 2) return cache
  if (cache.lastAutoAdvanceAt && now - cache.lastAutoAdvanceAt < 25 * 60 * 1000) return cache
  const index = (selectedIndex(cache) + 1) % cache.typhoons.length
  cache.selectedId = typhoonId(cache.typhoons[index])
  cache.lastAutoAdvanceAt = now
  writeCache(cache)
  return cache
}
