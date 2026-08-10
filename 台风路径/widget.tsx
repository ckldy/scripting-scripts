import {
  Button, HStack, Image, Link, RoundedRectangle, Spacer, Text, VStack, Widget, ZStack,
  type Color
} from 'scripting'
import { NextTyphoonIntent, PreviousTyphoonIntent } from './app_intents'
import {
  autoAdvance, loadWidgetData, selectedIndex, typhoonId, widgetMapPath, type Typhoon, type TyphoonPoint, type WidgetCache
} from './widget_data'
import { readSavedAmapKey, saveAmapKey, widgetParameterAmapKey } from './amap_config'

const OPEN_URL = `scripting://run_single/${encodeURIComponent('台风路径')}`
const REFRESH_AFTER = 30 * 60 * 1000

function formatTime(value?: string) {
  if (!value) return '时间未知'
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return value
  return `${date.getMonth() + 1}月${date.getDate()}日${date.getHours()}时`
}

function strength(power?: number) {
  const value = +(power || 0)
  if (value >= 16) return { name: '超强台风', code: 'Super TY', color: '#ff2d3b' as Color }
  if (value >= 14) return { name: '强台风', code: 'STY', color: '#e940ff' as Color }
  if (value >= 12) return { name: '台风', code: 'TY', color: '#ff9f0a' as Color }
  if (value >= 10) return { name: '强热带风暴', code: 'STS', color: '#ffd60a' as Color }
  if (value >= 8) return { name: '热带风暴', code: 'TS', color: '#32a8ff' as Color }
  return { name: '热带低压', code: 'TD', color: '#30d158' as Color }
}

function radiusText(point: TyphoonPoint) {
  const values = [[point.radius7, '7级'], [point.radius10, '10级'], [point.radius12, '12级']]
    .filter(([radius]) => +(radius || 0) > 0)
    .map(([radius, level]) => `${radius}km-${level}`)
  return values.join('，') || '暂无有效风圈'
}

function landText(tf: Typhoon) {
  const land = tf.land?.at(-1)
  if (!land?.land_time || !land.position) return ''
  return `${formatTime(land.land_time)}，${String(land.position).replace(/登陆$/, '')}登陆`
}

function locationText(point: TyphoonPoint) {
  return `东经${(+point.lng).toFixed(1)}°　北纬${(+point.lat).toFixed(1)}°`
}

function powerText(point: TyphoonPoint) {
  const grade = strength(point.power)
  return `${point.speed ?? '-'}米/秒，${point.power ?? '-'}级，${grade.name}(${grade.code})`
}

function summaryRows(tf: Typhoon): Array<{ label: string; color: Color; text: string }> {
  const point = tf.points.at(-1)!
  const land = landText(tf)
  return [
    { label: '中心位置', color: '#36a9ff' as Color, text: locationText(point) },
    { label: '风速风力', color: '#ff5368' as Color, text: powerText(point) },
    { label: land ? '登陆信息' : '风圈半径', color: '#ffb347' as Color, text: land || radiusText(point) },
    { label: '参考位置', color: '#aa8cff' as Color, text: point.location || '暂无参考位置' },
    { label: '未来趋势', color: '#48d67b' as Color, text: point.completion || `${point.move_dir ? `向${point.move_dir}方向` : '缓慢'}移动${point.move_speed ? `，时速${point.move_speed}公里` : ''}` }
  ]
}

function Header({ tf, index, count, compact = false, showPage = true }: { tf: Typhoon; index: number; count: number; compact?: boolean; showPage?: boolean }) {
  const point = tf.points.at(-1)!
  const grade = strength(point.power)
  return (
    <HStack alignment='center' spacing={7}>
      <HStack spacing={5} padding={{ horizontal: compact ? 8 : 10, vertical: compact ? 5 : 7 }} background={grade.color} clipShape={{ type: 'rect', cornerRadius: 12 }}>
        <Image systemName='tropicalstorm' font={compact ? 15 : 18} foregroundStyle='white' />
        <Text font={compact ? 13 : 15} fontWeight='bold' foregroundStyle='white' lineLimit={1}>
          {typhoonId(tf)} {tf.name || '未命名'}
        </Text>
      </HStack>
      <Text font={compact ? 12 : 14} fontWeight='semibold' foregroundStyle='white' shadow={{ color: '#000000cc', radius: 2, y: 1 }}>
        {formatTime(point.time)}
      </Text>
      <Spacer />
      {showPage && count > 1 ? <Text font={10} fontWeight='bold' foregroundStyle='white' shadow={{ color: 'black', radius: 2 }}>{index + 1}/{count}</Text> : null}
    </HStack>
  )
}

function TopSwitchPager({ index, count }: { index: number; count: number }) {
  if (count < 2) return null
  const hitTarget = (systemName: string, intent: ReturnType<typeof PreviousTyphoonIntent>) => (
    <Button buttonStyle='plain' intent={intent}>
      <ZStack frame={{ width: 36, height: 36 }}>
        <Image systemName={systemName} font={11} fontWeight='bold' foregroundStyle='white' shadow={{ color: '#000000cc', radius: 2, y: 1 }} />
      </ZStack>
    </Button>
  )
  return (
    <HStack spacing={0}>
      {hitTarget('chevron.left', PreviousTyphoonIntent(undefined))}
      <Text font={10} fontWeight='bold' foregroundStyle='white' frame={{ width: 24 }} shadow={{ color: '#000000cc', radius: 2, y: 1 }}>{index + 1}/{count}</Text>
      {hitTarget('chevron.right', NextTyphoonIntent(undefined))}
    </HStack>
  )
}


function MediumWidget({ tf, cache, stale }: { tf: Typhoon; cache: WidgetCache; stale: boolean }) {
  const index = selectedIndex(cache)
  const rows = summaryRows(tf)
  return (
    <ZStack frame={Widget.displaySize} widgetBackground='#050608'>
      <Link url={`${OPEN_URL}?tfbh=${encodeURIComponent(typhoonId(tf))}`}>
        <VStack alignment='leading' spacing={4} padding={14} frame={Widget.displaySize}>
          <Header tf={tf} index={index} count={cache.typhoons.length} compact showPage={false} />
          <Spacer minLength={2} />
          {rows.slice(0, 4).map(row => (
            <HStack key={row.label} alignment='top' spacing={7}>
              <Text font={11} fontWeight='bold' foregroundStyle={row.color} frame={{ width: 54 }} lineLimit={1}>{row.label}</Text>
              <Text font={11} fontWeight='medium' foregroundStyle='white' lineLimit={1}>{row.text}</Text>
              <Spacer minLength={0} />
            </HStack>
          ))}
          <HStack>
            <Text font={9} foregroundStyle='#aab0ba'>{stale ? '缓存' : '更新'} {formatTime(new Date(cache.updatedAt).toISOString())}</Text>
            <Spacer />
          </HStack>
        </VStack>
      </Link>
      <VStack frame={Widget.displaySize} padding={{ bottom: 2, trailing: 2 }}>
        <Spacer />
        <HStack><Spacer /><TopSwitchPager index={index} count={cache.typhoons.length} /></HStack>
      </VStack>
    </ZStack>
  )
}

function MapEmptyState({ keyConfigured }: { keyConfigured: boolean }) {
  return (
    <Link url={OPEN_URL}>
      <VStack frame={Widget.displaySize} spacing={8} padding={22} widgetBackground='#9bc9f0'>
        <Image systemName={keyConfigured ? 'arrow.clockwise.circle' : 'key'} font={30} foregroundStyle='#1d4a6e' />
        <Text font={14} fontWeight='bold' foregroundStyle='#12324d' multilineTextAlignment='center'>
          {keyConfigured ? '地图缓存生成中' : '未配置高德地图 Key'}
        </Text>
        <Text font={10} foregroundStyle='#25313c' multilineTextAlignment='center' lineLimit={4}>
          {keyConfigured ? '点按小组件打开主程序，将自动生成地图缓存' : '在小组件「参数」栏粘贴高德 Web服务 Key，或打开主程序「更多」→「高德Key」填写'}
        </Text>
      </VStack>
    </Link>
  )
}

function LargeWidget({ tf, cache, stale, mapImage, keyConfigured }: { tf: Typhoon; cache: WidgetCache; stale: boolean; mapImage: UIImage | null; keyConfigured: boolean }) {
  if (!mapImage) return <MapEmptyState keyConfigured={keyConfigured} />
  const index = selectedIndex(cache)
  const rows = summaryRows(tf)
  return (
    <ZStack frame={Widget.displaySize} widgetBackground='#9bc9f0'>
      {mapImage ? <Image image={mapImage} resizable scaleToFill frame={Widget.displaySize} /> : <RoundedRectangle cornerRadius={0} fill='#9bc9f0' frame={Widget.displaySize} />}
      <Link url={`${OPEN_URL}?tfbh=${encodeURIComponent(typhoonId(tf))}`}>
        <VStack alignment='leading' padding={14} frame={Widget.displaySize}>
          <Header tf={tf} index={index} count={cache.typhoons.length} showPage={false} />
          <Spacer />
          <VStack alignment='leading' spacing={3}>
            {rows.map(row => (
              <HStack key={row.label} alignment='top' spacing={7}>
                <Text font={11} fontWeight='heavy' foregroundStyle={row.color} frame={{ width: 58 }} shadow={{ color: '#000000e6', radius: 2, x: 0, y: 1 }} lineLimit={1}>{row.label}</Text>
                <Text font={11} fontWeight='semibold' foregroundStyle='#25313c' shadow={{ color: '#fffffff2', radius: 2, x: 0, y: 1 }} lineLimit={row.label === '未来趋势' ? 2 : 1}>{row.text}</Text>
                <Spacer minLength={0} />
              </HStack>
            ))}
            <Text font={9} foregroundStyle='#25313c' shadow={{ color: '#ffffffee', radius: 2 }}>{stale ? '缓存数据' : '实时数据'} · {formatTime(new Date(cache.updatedAt).toISOString())}</Text>
          </VStack>
        </VStack>
      </Link>
      <VStack frame={Widget.displaySize} padding={{ top: 2, trailing: 4 }}>
        <HStack><Spacer /><TopSwitchPager index={index} count={cache.typhoons.length} /></HStack>
        <Spacer />
      </VStack>
    </ZStack>
  )
}

function EmptyWidget({ message }: { message: string }) {
  return <VStack frame={Widget.displaySize} spacing={8} widgetBackground='#08111c'><Image systemName='tropicalstorm' font={30} foregroundStyle='#4cb8ff' /><Text font={15} fontWeight='bold' foregroundStyle='white'>暂无活动台风</Text><Text font={10} foregroundStyle='#aab0ba' lineLimit={3}>{message}</Text></VStack>
}

;(async () => {
  const reloadPolicy = { policy: 'after', date: new Date(Date.now() + REFRESH_AFTER) } as const
  try {
    // 小组件「参数」栏填入的高德 Key：保存到共享存储，供主程序生成地图缓存时使用
    const parameterKey = widgetParameterAmapKey()
    if (parameterKey) saveAmapKey(parameterKey)
    const keyConfigured = !!readSavedAmapKey()
    const result = await loadWidgetData()
    const cache = autoAdvance(result.cache)
    if (!cache.typhoons.length) {
      Widget.present(<EmptyWidget message='当前海域暂无活动台风' />, { reloadPolicy })
      return
    }
    const tf = cache.typhoons[selectedIndex(cache)]
    if (Widget.family === 'systemLarge') {
      const path = widgetMapPath(typhoonId(tf))
      const image = FileManager.existsSync(path) ? UIImage.fromFile(path) : null
      Widget.present(<LargeWidget tf={tf} cache={cache} stale={result.stale} mapImage={image} keyConfigured={keyConfigured} />, { reloadPolicy })
    } else {
      Widget.present(<MediumWidget tf={tf} cache={cache} stale={result.stale} />, { reloadPolicy })
    }
  } catch (error) {
    Widget.present(<EmptyWidget message={`更新失败：${String(error)}`} />, { reloadPolicy })
  }
})()
