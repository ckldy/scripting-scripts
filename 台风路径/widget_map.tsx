import { Canvas, ImageRenderer, Path, type CanvasRenderingContext } from 'scripting'
import {
  WIDGET_CACHE_DIR, widgetMapPath, typhoonId,
  type ForecastSet, type Quadrants, type Typhoon, type TyphoonPoint
} from './widget_data'

const AMAP_KEYCHAIN_KEY = 'TyphoonTrackWidget.AMapWebServiceKey'
const STATIC_MAP_URL = 'https://restapi.amap.com/v3/staticmap'
const MAP_SIZE = 354
const MAP_ZOOM = 5
const MAX_MERCATOR_LAT = 85.05112878
const EARTH_RADIUS_KM = 6371.0088

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

function drawCenter(ctx: CanvasRenderingContext, point: TyphoonPoint) {
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

function staticMapURL(center: TyphoonPoint) {
  const key = Keychain.get(AMAP_KEYCHAIN_KEY)
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

async function publishMap(id: string, data: Data) {
  const finalPath = widgetMapPath(id)
  const tempPath = Path.join(FileManager.temporaryDirectory, `typhoon-widget-${id}-${Date.now()}.png`)
  await FileManager.createDirectory(WIDGET_CACHE_DIR, true)
  await FileManager.writeAsData(tempPath, data)
  if (await FileManager.exists(finalPath)) await FileManager.remove(finalPath)
  await FileManager.copyFile(tempPath, finalPath)
  await FileManager.remove(tempPath)
}

export async function renderTyphoonWidgetMap(tf: Typhoon) {
  const center = [...tf.points].reverse().find(validPoint)
  const id = typhoonId(tf).replace(/[^A-Za-z0-9_-]/g, '')
  if (!center || !id) return false
  const basemap = await UIImage.fromURL(staticMapURL(center))
  if (!basemap) throw new Error('高德静态底图下载失败')
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
        drawCenter(ctx, center)
        drawName(ctx, tf, track, center)
      }}
    />,
    { opaque: true, scale: 2 }
  )
  await publishMap(id, data)
  return true
}

export async function renderAllTyphoonWidgetMaps(typhoons: Typhoon[]) {
  let rendered = 0
  for (const tf of typhoons) {
    try {
      if (await renderTyphoonWidgetMap(tf)) rendered++
    } catch (error) {
      console.error(`Widget地图缓存失败(${typhoonId(tf)})`, String(error))
    }
  }
  return rendered
}
