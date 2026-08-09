import {
  AppEvents,
  AVPlayerView,
  Button,
  Device,
  HStack,
  Image,
  Navigation,
  PIPStatus,
  ProgressView,
  Slider,
  Spacer,
  Text,
  VStack,
  ZStack,
  fetch,
  useEffect,
  useObservable,
  useRef,
  useState,
} from "scripting"
import { huangdouClient, type DramaEpisode, type DramaItem, type DramaPlay } from "./client"
import { recordPlayback } from "./storage"

type PlayerState = "loading" | "playing" | "paused" | "error"
type CachedSource = { source: DramaPlay; headers: Record<string, string> }

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) seconds = 0
  const total = Math.floor(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mm = String(m).padStart(2, "0")
  const ss = String(s).padStart(2, "0")
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`
}

export async function presentEpisodePlayer(request: {
  drama: DramaItem
  episodes: DramaEpisode[]
  startSeq: number
  onLibraryChanged: () => void
}): Promise<void> {
  const startIndex = Math.max(0, request.episodes.findIndex(item => item.seq === request.startSeq))
  if (!request.episodes[startIndex]) throw new Error("剧集不存在。")
  const player = new AVPlayer()
  await Navigation.present({
    element: <EpisodePlayer {...request} player={player} />,
    modalPresentationStyle: "fullScreen",
  })
}

function EpisodePlayer({ drama, episodes, startSeq, onLibraryChanged, player }: {
  drama: DramaItem
  episodes: DramaEpisode[]
  startSeq: number
  onLibraryChanged: () => void
  player: AVPlayer
}) {
  const dismiss = Navigation.useDismiss()
  const pipStatus = useObservable<PIPStatus>()
  const startIndex = Math.max(0, episodes.findIndex(item => item.seq === startSeq))
  const [currentIndex, setCurrentIndex] = useState(startIndex)
  const [playerState, setPlayerState] = useState<PlayerState>("loading")
  const [error, setError] = useState<string | null>(null)
  const [hasSource, setHasSource] = useState(false)
  const [loadStep, setLoadStep] = useState("正在请求播放地址…")
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [controlsVisible, setControlsVisible] = useState(true)
  const currentIndexRef = useRef(startIndex)
  const playingRef = useRef(false)
  const scrubbingRef = useRef(false)
  const scrubValueRef = useRef(0)
  const controlsVisibleRef = useRef(true)
  const hideTimerRef = useRef<number | null>(null)
  const generationRef = useRef(0)
  const sourceGenerationRef = useRef(-1)
  const disposedRef = useRef(false)
  const switchingRef = useRef(false)
  const playIntentRef = useRef(true)
  const fallbackRef = useRef<string | null>(null)
  const fallbackUsedRef = useRef(false)
  const recordedSeqRef = useRef<number | null>(null)
  const sourceCacheRef = useRef(new Map<number, CachedSource>())
  const sourceRequestsRef = useRef(new Map<number, Promise<CachedSource>>())
  const warmingIndexesRef = useRef(new Set<number>())
  const warmedIndexesRef = useRef(new Set<number>())
  const warmQueueRef = useRef(Promise.resolve())

  const currentEpisode = episodes[currentIndex] ?? episodes[0]

  async function resolveSource(index: number): Promise<CachedSource> {
    const cached = sourceCacheRef.current.get(index)
    if (cached) return cached
    const pending = sourceRequestsRef.current.get(index)
    if (pending) return pending
    const episode = episodes[index]
    if (!episode) throw new Error("剧集不存在。")
    const request = huangdouClient.play(drama.id, episode.seq).then(source => {
      const result = { source, headers: huangdouClient.playbackHeaders(source.url) }
      sourceCacheRef.current.set(index, result)
      sourceRequestsRef.current.delete(index)
      return result
    }, reason => {
      sourceRequestsRef.current.delete(index)
      throw reason
    })
    sourceRequestsRef.current.set(index, request)
    return request
  }

  async function warmFollowingNow(index: number): Promise<void> {
    // 所有预热批次都通过 warmQueueRef 串行执行，避免重复 play 触发跨批并发。
    for (let offset = 1; offset <= 3; offset++) {
      const nextIndex = index + offset
      if (nextIndex >= episodes.length || disposedRef.current) break
      if (warmedIndexesRef.current.has(nextIndex) || warmingIndexesRef.current.has(nextIndex)) continue
      warmingIndexesRef.current.add(nextIndex)
      const started = Date.now()
      try {
        const resolved = await resolveSource(nextIndex)
        if (disposedRef.current) return
        const response = await fetch(resolved.source.url, {
          headers: { ...resolved.headers, "X-Huangdou-Warm": "1" },
        })
        if (response.ok) {
          await response.data()
          warmedIndexesRef.current.add(nextIndex)
          console.log(`[播放列表] 第 ${episodes[nextIndex].seq} 集完整预热 ${Date.now() - started}ms，后续跳过`)
        } else {
          throw new Error(`HTTP ${response.status}`)
        }
      } catch (reason) {
        console.log(`[播放列表] 第 ${episodes[nextIndex].seq} 集预热失败，下次允许重试: ${reason instanceof Error ? reason.message : reason}`)
      } finally {
        warmingIndexesRef.current.delete(nextIndex)
      }
    }
  }

  function warmFollowing(index: number): void {
    warmQueueRef.current = warmQueueRef.current.then(
      () => warmFollowingNow(index),
      () => warmFollowingNow(index),
    )
  }

  function recordCurrent(index: number): void {
    const episode = episodes[index]
    if (!episode || recordedSeqRef.current === episode.seq) return
    recordPlayback(drama, episode.seq, episode.name || `第 ${episode.seq} 集`)
    onLibraryChanged()
    recordedSeqRef.current = episode.seq
  }

  function syncPlaybackTime(): void {
    try {
      const t = player.currentTime
      const d = player.duration
      if (d > 0) {
        setCurrentTime(Math.min(t, d))
        setDuration(d)
      }
    } catch { /* 读取失败不影响播放 */ }
  }

  function updateControlsVisible(visible: boolean): void {
    controlsVisibleRef.current = visible
    setControlsVisible(visible)
  }

  function scheduleControlsHide(): void {
    if (hideTimerRef.current !== null) {
      clearTimeout(hideTimerRef.current)
      hideTimerRef.current = null
    }
    // 仅播放中才自动隐藏；暂停/加载/错误时保持控制层可见。
    if (!playingRef.current || !controlsVisibleRef.current) return
    hideTimerRef.current = setTimeout(() => {
      hideTimerRef.current = null
      if (disposedRef.current || !playingRef.current || scrubbingRef.current) return
      updateControlsVisible(false)
    }, 3000)
  }

  function cancelControlsHide(): void {
    if (hideTimerRef.current !== null) {
      clearTimeout(hideTimerRef.current)
      hideTimerRef.current = null
    }
  }

  function startPlayback(generation: number, index: number, attempt = 0): void {
    if (disposedRef.current || sourceGenerationRef.current !== generation || currentIndexRef.current !== index) return
    if (player.play()) {
      playingRef.current = true
      switchingRef.current = false
      setPlayerState("playing")
      syncPlaybackTime()
      recordCurrent(index)
      warmFollowing(index)
      scheduleControlsHide()
      return
    }
    if (attempt < 4) {
      setTimeout(() => startPlayback(generation, index, attempt + 1), 200)
    } else {
      switchingRef.current = false
      setPlayerState("error")
      setError("播放器未能自动开始播放，请重新加载。")
    }
  }

  async function loadIndex(index: number): Promise<void> {
    if (index < 0 || index >= episodes.length || disposedRef.current) return
    const generation = ++generationRef.current
    currentIndexRef.current = index
    switchingRef.current = true
    playIntentRef.current = true
    sourceGenerationRef.current = -1
    fallbackRef.current = null
    fallbackUsedRef.current = false
    player.stop()
    playingRef.current = false
    setCurrentTime(0)
    setDuration(0)
    updateControlsVisible(true)
    cancelControlsHide()
    setPlayerState("loading")
    setError(null)
    setCurrentIndex(index)
    console.log(`[播放列表] 加载第 ${episodes[index].seq} 集`)
    const started = Date.now()
    setLoadStep("正在请求播放地址…")
    const watchdog = setTimeout(() => {
      if (disposedRef.current || generation !== generationRef.current || index !== currentIndexRef.current) return
      const phase = sourceGenerationRef.current < 0 ? "播放地址请求" : "播放器就绪"
      console.log(`[播放列表] 第 ${episodes[index].seq} 集加载看门狗触发: ${phase}超时`)
      switchingRef.current = false
      setPlayerState("error")
      setError(`${phase}超时（20秒），请重新加载。`)
    }, 20000)
    try {
      const resolved = await resolveSource(index)
      console.log(`[播放列表] 第 ${episodes[index].seq} 集播放地址 ${Date.now() - started}ms ${resolved.source.url.slice(0, 90)}`)
      if (disposedRef.current || generation !== generationRef.current || index !== currentIndexRef.current) return
      fallbackRef.current = resolved.source.previewUrl && resolved.source.previewUrl !== resolved.source.url
        ? resolved.source.previewUrl
        : null
      sourceGenerationRef.current = generation
      setLoadStep("正在加载视频源…")
      if (!player.setSource(resolved.source.url, { headers: resolved.headers })) {
        if (!fallbackRef.current || !player.setSource(fallbackRef.current, { headers: resolved.headers })) {
          sourceGenerationRef.current = -1
          throw new Error("系统无法加载当前剧集的播放地址。")
        }
        fallbackUsedRef.current = true
      }
      setHasSource(true)
      setLoadStep("等待播放器就绪…")
      clearTimeout(watchdog)
      console.log(`[播放列表] 第 ${episodes[index].seq} 集已提交 AVPlayer 加载`)
      setTimeout(() => {
        if (!disposedRef.current && generation === generationRef.current && index === currentIndexRef.current && player.timeControlStatus !== TimeControlStatus.playing) {
          console.log(`[播放列表] 第 ${episodes[index].seq} 集提交后仍未ready: status=${String(player.timeControlStatus)} time=${player.currentTime}s duration=${player.duration}s`)
        }
      }, 5000)
    } catch (reason) {
      if (disposedRef.current || generation !== generationRef.current || index !== currentIndexRef.current) return
      clearTimeout(watchdog)
      switchingRef.current = false
      setPlayerState("error")
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  function switchEpisode(direction: -1 | 1): void {
    if (switchingRef.current) return
    const targetIndex = currentIndexRef.current + direction
    if (targetIndex < 0 || targetIndex >= episodes.length) return
    console.log(`[播放列表] ${direction > 0 ? "上滑" : "下滑"}切到第 ${episodes[targetIndex].seq} 集`)
    void loadIndex(targetIndex)
  }

  function togglePlayback(): void {
    if (playerState === "loading" || playerState === "error") return
    if (player.timeControlStatus === TimeControlStatus.playing) {
      playIntentRef.current = false
      playingRef.current = false
      cancelControlsHide()
      updateControlsVisible(true)
      player.pause()
      setPlayerState("paused")
    } else {
      playIntentRef.current = true
      startPlayback(sourceGenerationRef.current, currentIndexRef.current)
    }
  }

  useEffect(() => {
    Device.supportedInterfaceOrientations = ["portrait"]
    SharedAudioSession.setCategory("playback", ["defaultToSpeaker"])
    void SharedAudioSession.setActive(true)

    player.onReadyToPlay = () => {
      const generation = sourceGenerationRef.current
      const index = currentIndexRef.current
      if (disposedRef.current || generation < 0 || generation !== generationRef.current) return
      if (playIntentRef.current) startPlayback(generation, index)
      else {
        switchingRef.current = false
        setPlayerState("paused")
      }
    }
    player.onTimeControlStatusChanged = status => {
      if (disposedRef.current) return
      try {
        console.log(`[播放列表] 第 ${episodes[currentIndexRef.current]?.seq ?? "?"} 集状态=${String(status)} time=${player.currentTime}s duration=${player.duration}s`)
      } catch { /* 日志读取失败不影响状态更新 */ }
      if (status === TimeControlStatus.playing) {
        playingRef.current = true
        switchingRef.current = false
        setPlayerState("playing")
        syncPlaybackTime()
        scheduleControlsHide()
      } else {
        playingRef.current = false
        cancelControlsHide()
        updateControlsVisible(true)
        if (!switchingRef.current && playerState !== "loading") {
          setPlayerState("paused")
        }
      }
    }
    player.onError = message => {
      try {
        console.log(`[播放列表] 第 ${episodes[currentIndexRef.current]?.seq ?? "?"} 集播放器错误 time=${player.currentTime}s duration=${player.duration}s: ${message}`)
      } catch { /* 日志读取失败不影响错误处理 */ }
      if (disposedRef.current || sourceGenerationRef.current !== generationRef.current) return
      if (!fallbackUsedRef.current && fallbackRef.current) {
        fallbackUsedRef.current = true
        player.stop()
        setPlayerState("loading")
        if (player.setSource(fallbackRef.current, { headers: huangdouClient.playbackHeaders(fallbackRef.current) })) return
      }
      switchingRef.current = false
      setPlayerState("error")
      setError(message)
    }

    const sceneListener = (phase: "active" | "inactive" | "background") => {
      if (phase === "background") {
        playIntentRef.current = false
        playingRef.current = false
        player.pause()
        setPlayerState("paused")
      } else if (phase === "active" && sourceGenerationRef.current === generationRef.current) {
        playIntentRef.current = true
        startPlayback(sourceGenerationRef.current, currentIndexRef.current)
      }
    }
    player.onEnded = () => {
      console.log(`[播放列表] 第 ${episodes[currentIndexRef.current]?.seq ?? "?"} 集播放结束 time=${player.currentTime}s duration=${player.duration}s`)
    }
    // Scripting 无 setInterval，用递归 setTimeout 实现 1 秒轮询。
    // 只在真正播放时读时间，加载/切集阶段零 native 调用（防止阻塞 JS 事件循环）。
    let progressTimer: number | null = null
    const scheduleTick = (): void => {
      progressTimer = setTimeout(() => {
        if (disposedRef.current) return
        if (!playingRef.current || scrubbingRef.current || !controlsVisibleRef.current) {
          scheduleTick()
          return
        }
        syncPlaybackTime()
        scheduleTick()
      }, 1000)
    }
    scheduleTick()
    AppEvents.scenePhase.addListener(sceneListener)
    currentIndexRef.current = startIndex
    setCurrentIndex(startIndex)
    setPlayerState("loading")
    // 页面先呈现，再异步解析首集播放地址；预热只在当前集真正开始播放后后台执行。
    void loadIndex(startIndex)

    return () => {
      disposedRef.current = true
      generationRef.current += 1
      if (progressTimer !== null) clearTimeout(progressTimer)
      cancelControlsHide()
      AppEvents.scenePhase.removeListener(sceneListener)
      player.stop()
      player.dispose()
      Device.supportedInterfaceOrientations = Device.userConfiguredInterfaceOrientations
      void SharedAudioSession.setActive(false, ["notifyOthersOnDeactivation"])
    }
  }, [])

  return <ZStack
    frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
    background="black"
    ignoresSafeArea
    onTapGesture={() => {
      if (!controlsVisibleRef.current) {
        // 控制层隐藏时，单击唤出（不切换播放状态）
        updateControlsVisible(true)
        syncPlaybackTime()
        scheduleControlsHide()
        return
      }
      togglePlayback()
    }}
    onDragGesture={{
      minDistance: 24,
      coordinateSpace: "global",
      onEnded: gesture => {
        const predictedY = gesture.predictedEndTranslation.height
        const y = Math.abs(predictedY) > Math.abs(gesture.translation.height) ? predictedY : gesture.translation.height
        if (Math.abs(y) < 70 || Math.abs(y) < Math.abs(gesture.translation.width)) return
        switchEpisode(y < 0 ? 1 : -1)
      },
    }}
  >
    {hasSource ? <AVPlayerView
      player={player}
      pipStatus={pipStatus}
      allowsPictureInPicturePlayback={false}
      canStartPictureInPictureAutomaticallyFromInline={false}
      updatesNowPlayingInfoCenter={false}
      videoGravity="resizeAspect"
      allowsHitTesting={false}
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
    /> : undefined}

    {playerState === "loading" ? <VStack spacing={12}>
      <ProgressView progressViewStyle="circular" tint="white" />
      <Text font="footnote" foregroundStyle="white">正在加载第 {currentEpisode.seq} 集</Text>
      <Text font="caption2" foregroundStyle="white" opacity={0.7}>{loadStep}</Text>
    </VStack> : undefined}
    {playerState === "paused" ? <Image systemName="play.circle.fill" font={72} foregroundStyle="white" opacity={0.72} /> : undefined}
    {playerState === "error" ? <VStack spacing={14} padding={{ horizontal: 28 }}>
      <Image systemName="exclamationmark.triangle.fill" font={38} foregroundStyle="systemOrange" />
      <Text font="headline" foregroundStyle="white">第 {currentEpisode.seq} 集加载失败</Text>
      <Text font="footnote" foregroundStyle="secondaryLabel" multilineTextAlignment="center">{error || "请稍后重试"}</Text>
      <Button title="重新加载" systemImage="arrow.clockwise" action={() => { void loadIndex(currentIndexRef.current) }} buttonStyle="borderedProminent" />
    </VStack> : undefined}

    {controlsVisible ? <VStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }} padding={{ top: 14, horizontal: 14, bottom: 34 }} allowsHitTesting={false}>
      <HStack frame={{ maxWidth: "infinity" }}>
        <Spacer />
        <Text font="headline" fontWeight="semibold" foregroundStyle="white">第 {currentEpisode.seq} 集</Text>
        <Spacer />
        <Text font="footnote" foregroundStyle="white" opacity={0.7}>{currentIndex + 1}/{episodes.length}</Text>
      </HStack>
      <Spacer />
      <VStack alignment="leading" spacing={5} frame={{ maxWidth: "infinity", alignment: "leading" }}>
        <Text font="headline" fontWeight="semibold" foregroundStyle="white" lineLimit={2}>{drama.name}</Text>
        <Text font="subheadline" foregroundStyle="white" opacity={0.82}>{currentEpisode.name || `第 ${currentEpisode.seq} 集`}</Text>
      </VStack>
    </VStack> : undefined}
    {controlsVisible && duration > 0 ? <VStack frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "bottom" }} padding={{ horizontal: 16, bottom: 100 }}>
      <HStack spacing={8} frame={{ maxWidth: "infinity" }}>
        <Text font="caption2" monospacedDigit foregroundStyle="white" opacity={0.75} frame={{ width: 42, alignment: "leading" }}>{formatTime(currentTime)}</Text>
        <Slider
          min={0}
          max={duration}
          value={Math.min(currentTime, duration)}
          onChanged={value => {
            scrubValueRef.current = value
            setCurrentTime(value)
          }}
          onEditingChanged={editing => {
            if (editing) {
              scrubbingRef.current = true
              cancelControlsHide()
            } else {
              scrubbingRef.current = false
              try { player.currentTime = scrubValueRef.current } catch { /* 忽略 seek 异常 */ }
              syncPlaybackTime()
              scheduleControlsHide()
            }
          }}
          tint="white"
        />
        <Text font="caption2" monospacedDigit foregroundStyle="white" opacity={0.75} frame={{ width: 42, alignment: "trailing" }}>{formatTime(duration)}</Text>
      </HStack>
    </VStack> : undefined}
    <VStack frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" }} padding={{ top: 14, leading: 14 }}>
      <Button title="关闭" systemImage="xmark" action={() => dismiss()} buttonStyle="bordered" tint="white" />
    </VStack>
  </ZStack>
}
