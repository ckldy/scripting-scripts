import { Canvas, ImageRenderer, Path, fetch, type CanvasRenderingContext } from 'scripting'
import {
  WIDGET_CACHE_DIR, lastValidPoint, normalizedTyphoonId, typhoonId, widgetMapManifestPath, widgetMapPath, withTimeout,
  type ForecastSet, type Quadrants, type Typhoon, type TyphoonPoint, type WidgetMapManifest
} from './widget_data'

const STATIC_MAP_URL = 'https://restapi.amap.com/v3/staticmap'
const MAP_SIZE = 354
const MAP_ZOOM = 5
const MAX_MERCATOR_LAT = 85.05112878
const EARTH_RADIUS_KM = 6371.0088
const MAP_DOWNLOAD_TIMEOUT = 12000
const TYPHOON_CLOUD_SPRITE_PATH = Path.join(FileManager.scriptsDirectory, '台风路径', 'web', 'vendor', 'typhoon-cloud-sprite.png')

const AMAP_ERROR_TEXT: Record<string, string> = {
  USERKEY_PLAT_NOMATCH: 'Key 与平台不匹配：请使用「Web服务」类型的 Key（高德开放平台 → 应用管理 → 创建应用 → 添加 Key → 服务平台选「Web服务」）',
  INVALID_USER_KEY: 'Key 无效或已被删除，请检查是否复制完整',
  USER_DAILY_QUERY_OVER_LIMIT: '该 Key 今日调用配额已用尽，请明日再试或更换 Key',
  DAILY_QUERY_OVER_LIMIT: '今日调用配额已用尽，请明日再试',
  INVALID_USER_SCODE: '安全码校验失败',
  INVALID_PARAMS: '请求参数错误'
}

export function amapErrorText(info: string): string {
  if (!info) return '未知错误（高德接口未返回具体原因）'
  return AMAP_ERROR_TEXT[info] || `高德接口错误：${info}`
}

/** 预检高德 Web服务 Key 是否可用（请求 1×1 静态地图，接口返回 JSON 错误时解析具体原因）。 */
export async function verifyAmapKey(key: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const url = `${STATIC_MAP_URL}?location=120.5,30.5&zoom=4&size=1*1&scale=1&key=${encodeURIComponent(key)}`
    const response = await withTimeout(fetch(url), 10000, '高德 Key 验证请求超时')
    const contentType = String(response.headers?.get?.('content-type') || '')
    if (contentType.includes('json')) {
      let info = ''
      try {
        info = String(((await response.json()) as { info?: string })?.info || '')
      } catch {}
      return { ok: false, error: amapErrorText(info) }
    }
    if (!response.ok) return { ok: false, error: `高德接口 HTTP ${response.status}` }
    return { ok: true }
  } catch (error) {
    return { ok: false, error: `网络错误：${String(error)}` }
  }
}

const FORECAST_COLORS: Record<string, string> = {
  '中国': '#FF4050', '中国香港': '#FF66FF', '香港': '#FF66FF', '日本': '#43FF4B',
  '中国台湾': '#FFA040', '台湾': '#FFA040', '美国': '#40DDFF', '韩国': '#669999', '欧洲': '#246ED4'
}

function validPoint(value: unknown): value is TyphoonPoint {
  if (!value || typeof value !== 'object') return false
  const point = value as TyphoonPoint
  return Number.isFinite(+point.lat) && Number.isFinite(+point.lng) &&
    +point.lat >= -MAX_MERCATOR_LAT && +point.lat <= MAX_MERCATOR_LAT &&
    +point.lng >= -180 && +point.lng <= 180
}

function worldPoint(point: Pick<TyphoonPoint, 'lat' | 'lng'>, zoom = MAP_ZOOM) {
  const lat = Math.max(-MAX_MERCATOR_LAT, Math.min(MAX_MERCATOR_LAT, +point.lat))
  const sin = Math.sin(lat * Math.PI / 180)
  const worldSize = 256 * 2 ** zoom
  return {
    x: (+point.lng + 180) / 360 * worldSize,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * worldSize
  }
}

export function projectWidgetPoint(point: Pick<TyphoonPoint, 'lat' | 'lng'>, center: Pick<TyphoonPoint, 'lat' | 'lng'>) {
  const target = worldPoint(point)
  const origin = worldPoint(center)
  return { x: MAP_SIZE / 2 + target.x - origin.x, y: MAP_SIZE / 2 + target.y - origin.y }
}

function recentHistory(tf: Typhoon) {
  const valid = tf.points.filter(validPoint)
  const cutoff = Date.now() - 72 * 60 * 60 * 1000
  const recent = valid.filter(point => {
    if (!point.time) return true
    const timestamp = new Date(point.time).getTime()
    return Number.isFinite(timestamp) && timestamp >= cutoff
  })
  return recent.length >= 2 ? recent : valid.slice(-Math.min(valid.length, 12))
}

function latestForecast(points: TyphoonPoint[]): { anchor: TyphoonPoint; sets: ForecastSet[] } | null {
  for (let index = points.length - 1; index >= 0; index--) {
    const anchor = points[index]
    if (validPoint(anchor) && Array.isArray(anchor.forecast) && anchor.forecast.length) {
      return { anchor, sets: anchor.forecast }
    }
  }
  return null
}

function mapRevisionSource(tf: Typhoon) {
  const track = recentHistory(tf)
  const forecast = latestForecast(tf.points)
  const pointFields = (point: TyphoonPoint) => [
    String(point.time || ''), +point.lat, +point.lng, +(point.power || 0),
    +(point.radius7 || 0), +(point.radius10 || 0), +(point.radius12 || 0),
    point.radius7_quad || null, point.radius10_quad || null, point.radius12_quad || null
  ]
  return JSON.stringify({
    id: normalizedTyphoonId(tf),
    name: String(tf.name || ''),
    track: track.map(pointFields),
    forecast: forecast ? {
      anchor: pointFields(forecast.anchor),
      sets: forecast.sets.map(set => ({ sets: set.sets, points: (set.points || []).filter(validPoint).map(pointFields) }))
    } : null
  })
}

/** 稳定的非加密内容摘要：仅用于缓存代次，不处理密钥或安全数据。 */
export function widgetMapRevision(tf: Typhoon) {
  const source = mapRevisionSource(tf)
  let hash = 2166136261
  for (let index = 0; index < source.length; index++) {
    hash ^= source.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

function strengthColor(power?: number) {
  const value = +(power || 0)
  if (value >= 16) return '#FF0C0C'
  if (value >= 14) return '#f95aff'
  if (value >= 12) return '#FDAC03'
  if (value >= 10) return '#FBFF6B'
  if (value >= 8) return '#38ABFF'
  return '#68FF8C'
}

function safeRadius(value: unknown) {
  const radius = Number(value)
  return Number.isFinite(radius) && radius > 0 && radius <= 2000 ? radius : 0
}

function destination(center: TyphoonPoint, bearing: number, distanceKm: number): TyphoonPoint {
  const angular = distanceKm / EARTH_RADIUS_KM
  const theta = bearing * Math.PI / 180
  const lat1 = +center.lat * Math.PI / 180
  const lng1 = +center.lng * Math.PI / 180
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(angular) + Math.cos(lat1) * Math.sin(angular) * Math.cos(theta))
  const lng2 = lng1 + Math.atan2(Math.sin(theta) * Math.sin(angular) * Math.cos(lat1), Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2))
  return { lat: lat2 * 180 / Math.PI, lng: ((lng2 * 180 / Math.PI + 540) % 360) - 180 }
}

function windCirclePoints(center: TyphoonPoint, radius: number, quadrants?: Quadrants) {
  const points: TyphoonPoint[] = []
  for (let bearing = 0; bearing < 360; bearing += 6) {
    const key: keyof Quadrants = bearing < 90 ? 'ne' : bearing < 180 ? 'se' : bearing < 270 ? 'sw' : 'nw'
    const distance = safeRadius(quadrants?.[key]) || radius
    if (distance) points.push(destination(center, bearing, distance))
  }
  return points
}

function roundedRect(ctx: CanvasRenderingContext, x: number, y: number, width: number, height: number, radius: number) {
  const r = Math.min(radius, width / 2, height / 2)
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + width - r, y)
  ctx.quadraticCurveTo(x + width, y, x + width, y + r)
  ctx.lineTo(x + width, y + height - r)
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height)
  ctx.lineTo(x + r, y + height)
  ctx.quadraticCurveTo(x, y + height, x, y + height - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}

function drawPolyline(ctx: CanvasRenderingContext, points: TyphoonPoint[], center: TyphoonPoint, color: string, width: number, dash: number[] = []) {
  if (points.length < 2) return
  ctx.save()
  ctx.beginPath()
  points.forEach((point, index) => {
    const p = projectWidgetPoint(point, center)
    if (index) ctx.lineTo(p.x, p.y)
    else ctx.moveTo(p.x, p.y)
  })
  ctx.strokeStyle = color
  ctx.lineWidth = width
  ctx.lineCap = dash.length ? 'square' : 'round'
  ctx.lineJoin = 'round'
  ctx.setLineDash(dash)
  ctx.stroke()
  ctx.restore()
}

function drawWindCircles(ctx: CanvasRenderingContext, center: TyphoonPoint) {
  const levels: Array<[keyof TyphoonPoint, keyof TyphoonPoint, string, string]> = [
    ['radius12', 'radius12_quad', 'rgba(237,49,67,.65)', 'rgba(237,49,67,.10)'],
    ['radius10', 'radius10_quad', 'rgba(230,199,0,.82)', 'rgba(245,217,0,.12)'],
    ['radius7', 'radius7_quad', 'rgba(23,143,66,.65)', 'rgba(53,184,91,.15)']
  ]
  for (const [radiusKey, quadKey, stroke, fill] of levels) {
    const radius = safeRadius(center[radiusKey])
    const points = windCirclePoints(center, radius, center[quadKey] as Quadrants | undefined)
    if (points.length < 3) continue
    ctx.save()
    ctx.beginPath()
    points.forEach((point, index) => {
      const p = projectWidgetPoint(point, center)
      if (index) ctx.lineTo(p.x, p.y)
      else ctx.moveTo(p.x, p.y)
    })
    ctx.closePath()
    ctx.fillStyle = fill
    ctx.strokeStyle = stroke
    ctx.lineWidth = 1
    ctx.fill()
    ctx.stroke()
    ctx.restore()
  }
}

function drawTrackPoints(ctx: CanvasRenderingContext, points: TyphoonPoint[], center: TyphoonPoint) {
  for (const point of points) {
    const p = projectWidgetPoint(point, center)
    ctx.beginPath()
    ctx.arc(p.x, p.y, 3.2, 0, Math.PI * 2)
    ctx.fillStyle = strengthColor(point.power)
    ctx.fill()
    ctx.strokeStyle = 'rgba(0,0,0,.82)'
    ctx.lineWidth = 1
    ctx.stroke()
  }
}

function drawForecasts(ctx: CanvasRenderingContext, tf: Typhoon, center: TyphoonPoint) {
  const forecast = latestForecast(tf.points)
  if (!forecast) return
  for (const set of forecast.sets) {
    const points = (set.points || []).filter(validPoint)
    if (!points.length) continue
    const color = FORECAST_COLORS[set.sets] || '#d5d9df'
    drawPolyline(ctx, [forecast.anchor, ...points], center, color, set.sets === '中国' ? 2.5 : 1.45, [8, 6])
    for (const point of points) {
      const p = projectWidgetPoint(point, center)
      ctx.beginPath()
      ctx.arc(p.x, p.y, set.sets === '中国' ? 3 : 2.4, 0, Math.PI * 2)
      ctx.fillStyle = strengthColor(point.power)
      ctx.fill()
      ctx.strokeStyle = color
      ctx.lineWidth = 1
      ctx.stroke()
    }
  }
}

function drawCenterFallback(ctx: CanvasRenderingContext, point: TyphoonPoint) {
  const center = { x: MAP_SIZE / 2, y: MAP_SIZE / 2 }
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,.45)'
  ctx.shadowBlur = 4
  ctx.fillStyle = 'rgba(255,255,255,.9)'
  ctx.beginPath()
  ctx.arc(center.x, center.y, 12, 0, Math.PI * 2)
  ctx.fill()
  ctx.shadowColor = 'rgba(0,0,0,0)'
  ctx.strokeStyle = strengthColor(point.power)
  ctx.lineWidth = 3
  for (let index = 0; index < 3; index++) {
    const start = index * Math.PI * 2 / 3
    ctx.beginPath()
    ctx.arc(center.x, center.y, 8, start, start + Math.PI * .72)
    ctx.stroke()
  }
  ctx.fillStyle = strengthColor(point.power)
  ctx.beginPath()
  ctx.arc(center.x, center.y, 3, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

function drawCenter(ctx: CanvasRenderingContext, point: TyphoonPoint, sprite: UIImage | null) {
  const power = Math.max(6, Math.min(17, +(point.power || 6)))
  const frame = Math.floor((power - 6) / 2)
  if (!sprite || sprite.width < (frame + 1) * 64 || sprite.height < 64) {
    drawCenterFallback(ctx, point)
    return
  }
  ctx.drawImage({ image: sprite }, frame * 64, 0, 64, 64, MAP_SIZE / 2 - 16, MAP_SIZE / 2 - 16, 32, 32)
}

function drawName(ctx: CanvasRenderingContext, tf: Typhoon, track: TyphoonPoint[], center: TyphoonPoint) {
  const first = track[0]
  if (!first) return
  const anchor = projectWidgetPoint(first, center)
  const text = `${tf.name || '未命名'}${typhoonId(tf)}`
  ctx.font = 12
  const width = Math.min(128, ctx.measureText(text).width + 12)
  const placeLeft = track[1] ? +track[1].lng > +first.lng : false
  const x = Math.max(4, Math.min(MAP_SIZE - width - 4, placeLeft ? anchor.x - width - 8 : anchor.x + 8))
  const y = Math.max(4, Math.min(MAP_SIZE - 24, anchor.y - 12))
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,.28)'
  ctx.shadowBlur = 3
  ctx.shadowOffsetY = 1
  roundedRect(ctx, x, y, width, 22, 7)
  ctx.fillStyle = 'rgba(255,255,255,.78)'
  ctx.fill()
  ctx.shadowColor = 'rgba(0,0,0,0)'
  ctx.strokeStyle = 'rgba(0,0,0,.38)'
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.fillStyle = 'rgba(0,0,0,.86)'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, x + 6, y + 11, width - 12)
  ctx.restore()
}

function staticMapURL(center: TyphoonPoint, key: string) {
  if (!key) throw new Error('未配置高德静态地图服务 key')
  const params = new URLSearchParams({
    location: `${+center.lng},${+center.lat}`,
    zoom: String(MAP_ZOOM),
    size: `${MAP_SIZE}*${MAP_SIZE}`,
    scale: '2',
    key
  })
  return `${STATIC_MAP_URL}?${params}`
}

// 同目录临时文件 + rename 原子替换：先发布 PNG，再更新 manifest，Widget 只读已完整落盘的一代缓存。
function replaceFileSync(finalPath: string, tempPath: string) {
  if (FileManager.existsSync(finalPath)) FileManager.removeSync(finalPath)
  FileManager.renameSync(tempPath, finalPath)
}

async function publishMap(id: string, revision: string, data: Data) {
  const finalPath = widgetMapPath(id, revision)
  const tempPath = Path.join(WIDGET_CACHE_DIR, `map-${id}.tmp-${Date.now()}.png`)
  await FileManager.createDirectory(WIDGET_CACHE_DIR, true)
  await FileManager.writeAsData(tempPath, data)
  try {
    replaceFileSync(finalPath, tempPath)
  } catch (error) {
    if (FileManager.existsSync(tempPath)) FileManager.removeSync(tempPath)
    throw error
  }
}

async function publishManifest(id: string, revision: string, manifest: WidgetMapManifest) {
  const finalPath = widgetMapManifestPath(id, revision)
  const tempPath = Path.join(WIDGET_CACHE_DIR, `map-${id}.tmp-${Date.now()}.json`)
  FileManager.writeAsStringSync(tempPath, JSON.stringify(manifest))
  try {
    replaceFileSync(finalPath, tempPath)
  } catch (error) {
    if (FileManager.existsSync(tempPath)) FileManager.removeSync(tempPath)
    throw error
  }
}

function completeManifest(id: string, revision: string) {
  const manifestPath = widgetMapManifestPath(id, revision)
  if (!FileManager.existsSync(manifestPath)) return null
  try {
    const manifest = JSON.parse(FileManager.readAsStringSync(manifestPath)) as WidgetMapManifest
    const imagePath = Path.join(WIDGET_CACHE_DIR, manifest.mapPath || '')
    return manifest.typhoonId === id && manifest.mapRevision === revision &&
      FileManager.existsSync(imagePath) && UIImage.fromFile(imagePath) ? manifest : null
  } catch {
    return null
  }
}

function cleanupOldMapRevisions(id: string, keep = 2) {
  try {
    const prefix = `map-${id}-`
    const manifests = FileManager.readDirectorySync(WIDGET_CACHE_DIR)
      .filter(name => name.startsWith(prefix) && name.endsWith('.json'))
      .map(name => {
        try {
          const manifest = JSON.parse(FileManager.readAsStringSync(Path.join(WIDGET_CACHE_DIR, name))) as WidgetMapManifest
          return { name, manifest }
        } catch { return null }
      })
      .filter((value): value is { name: string; manifest: WidgetMapManifest } => !!value)
      .sort((a, b) => +(b.manifest.generatedAt || 0) - +(a.manifest.generatedAt || 0))
    for (const entry of manifests.slice(keep)) {
      const manifestPath = Path.join(WIDGET_CACHE_DIR, entry.name)
      const imagePath = Path.join(WIDGET_CACHE_DIR, entry.manifest.mapPath || '')
      if (FileManager.existsSync(manifestPath)) FileManager.removeSync(manifestPath)
      if (entry.manifest.mapPath && FileManager.existsSync(imagePath)) FileManager.removeSync(imagePath)
    }
  } catch (error) {
    console.error(`Widget旧地图缓存清理失败(${id})`, String(error))
  }
}

export async function renderTyphoonWidgetMap(tf: Typhoon, key: string, dataUpdatedAt = Date.now()) {
  const center = lastValidPoint(tf)
  const id = normalizedTyphoonId(tf)
  if (!center || !id) return false
  const revision = widgetMapRevision(tf)
  if (completeManifest(id, revision)) return false
  const basemap = await withTimeout(UIImage.fromURL(staticMapURL(center, key)), MAP_DOWNLOAD_TIMEOUT, '高德静态底图下载超时')
  if (!basemap) throw new Error('高德静态底图下载失败')
  const sprite = UIImage.fromFile(TYPHOON_CLOUD_SPRITE_PATH)
  const track = recentHistory(tf)
  const data = await ImageRenderer.toPNGData(
    <Canvas
      opaque
      frame={{ width: MAP_SIZE, height: MAP_SIZE }}
      draw={ctx => {
        ctx.drawImage({ image: basemap }, 0, 0, MAP_SIZE, MAP_SIZE)
        drawWindCircles(ctx, center)
        drawPolyline(ctx, track, center, 'rgba(27,172,255,.82)', 3)
        drawForecasts(ctx, tf, center)
        drawTrackPoints(ctx, track, center)
        drawCenter(ctx, center, sprite)
        drawName(ctx, tf, track, center)
      }}
    />,
    { opaque: true, scale: 2 }
  )
  const mapName = `map-${id}-${revision}.png`
  await publishMap(id, revision, data)
  // 不可变 PNG 完整落盘后才提交同代 manifest；失败不会破坏上一份完整缓存。
  await publishManifest(id, revision, {
    typhoonId: id,
    pointTime: String(center.time || ''),
    dataUpdatedAt,
    mapPath: mapName,
    generatedAt: Date.now(),
    mapRevision: revision,
    typhoon: tf
  })
  cleanupOldMapRevisions(id)
  return true
}

export async function renderAllTyphoonWidgetMaps(typhoons: Typhoon[], key: string, dataUpdatedAt = Date.now(), selectedId = '') {
  let rendered = 0
  const safeSelectedId = String(selectedId).replace(/[^A-Za-z0-9_-]/g, '')
  const ordered = [...typhoons].sort((a, b) => Number(normalizedTyphoonId(b) === safeSelectedId) - Number(normalizedTyphoonId(a) === safeSelectedId))
  for (const tf of ordered) {
    try {
      if (await renderTyphoonWidgetMap(tf, key, dataUpdatedAt)) {
        rendered++
      }
    } catch (error) {
      console.error(`Widget地图缓存失败(${typhoonId(tf)})`, String(error))
    }
  }
  return rendered
}
