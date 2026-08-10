import { Path, fetch } from 'scripting'

export const TYPHOON_API = 'https://tf02.istrongcloud.com/'
export const WIDGET_CACHE_DIR = Path.join(FileManager.appGroupDocumentsDirectory, 'TyphoonTrackWidget')
const CACHE_PATH = Path.join(WIDGET_CACHE_DIR, 'state.json')

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
  FileManager.writeAsStringSync(CACHE_PATH, JSON.stringify(cache))
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
  const response = await fetch(TYPHOON_API + 'data/complex/currMerger.json')
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const typhoons = validTyphoons(await response.json())
  if (!typhoons.length) return []
  await Promise.all(typhoons.map(async tf => {
    const last = tf.points.at(-1)
    if (!last) return
    try {
      const response = await fetch(TYPHOON_API + `data/completion/${encodeURIComponent(typhoonId(tf))}.json`)
      if (!response.ok) return
      const completion = await response.json()
      if (String(completion?.time || '') === String(last.time || '')) {
        last.location = String(completion.location || '')
        last.completion = String(completion.completion || '')
      }
    } catch {}
  }))
  return typhoons
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
