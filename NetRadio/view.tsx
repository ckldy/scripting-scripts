import {
  Button,
  Navigation,
  NavigationStack,
  Path,
  Script,
  useCallback,
  useEffect,
  useMemo,
  VStack,
  WebView,
} from "scripting";

// 电台信息数据类型
export interface RadioStationPayload {
  stationuuid: string;
  name: string;
  country: string;
  countrycode: string;
  url_resolved: string;
  bitrate?: number;
  codec?: string;
  hls?: number;
  tags?: string;
  genre?: string;
  description?: string;
  lastPlaying?: string;
  image?: string;
  largeimage?: string;
  xlimage?: string;
}

interface NativeRadioMessage {
  action: "play" | "togglePlay" | "setVolume" | "openExternalUrl" | "exit" | "getStations" | "getSystemVolume";
  station?: RadioStationPayload;
  volume?: number;
  url?: string;
}

// ---- 诊断日志（写入 App Group，便于排查后台播放） ----
const LOG_PATH = Path.join(FileManager.appGroupDocumentsDirectory, "netradio_debug.log");
function dbg(msg: string) {
  try {
    FileManager.appendTextSync(LOG_PATH, `[${new Date().toLocaleTimeString()}] ${msg}\n`);
  } catch (e) {}
}

// 规范化单条电台记录
function normalizeStation(raw: any): RadioStationPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const url = String(raw.url_resolved || raw.url || "").trim();
  if (!url) return null;

  const cc = String(raw.countrycode ?? raw.country_code ?? raw.iso_3166_1_alpha_2 ?? "").trim().toLowerCase();
  const apiId = String(raw.id || "").trim();
  const stationuuid = String(raw.stationuuid || raw.stationUuid || (apiId ? `somafm-${apiId}` : "")).trim();
  const title = String(raw.title || "").trim();
  const legacyName = String(raw.name || "").trim();
  const name = legacyName || (title ? (apiId ? `SomaFM · ${title}` : title) : "未命名电台");
  const genre = String(raw.genre || "").trim();
  const tags = raw.tags != null && String(raw.tags).trim() ? String(raw.tags).trim() : genre.replace(/\|/g, " ").trim();
  const hlsFlag = raw.hls === 1 || raw.hls === true || /\.m3u8(\?|$)/i.test(url) ? 1 : 0;
  const description = String(raw.description || "").trim();

  const out: RadioStationPayload = {
    stationuuid: stationuuid || `u:${url.slice(0, 120)}`,
    name,
    country: String(raw.country || "").trim(),
    countrycode: cc,
    url_resolved: url,
    bitrate: Number(raw.bitrate) || 0,
    codec: String(raw.codec || "").trim(),
    hls: hlsFlag,
    tags,
  };

  if (description) out.description = description;
  if (genre) out.genre = genre;
  if (raw.image) out.image = String(raw.image).trim();
  if (raw.largeimage) out.largeimage = String(raw.largeimage).trim();
  if (raw.xlimage) out.xlimage = String(raw.xlimage).trim();
  if (raw.lastPlaying) out.lastPlaying = String(raw.lastPlaying).trim();

  return out;
}

// ==========================================
// 模块级全局单例状态（确保后台播放不断流）
// ==========================================
let globalPlayer: AVPlayer | null = null;
let globalCurrentStation: RadioStationPayload | null = null;
// 关键：globalIsPlaying 表示“用户播放意图”，不随直播流缓冲状态抖动
let globalIsPlaying = false;
let globalStationsList: RadioStationPayload[] = [];
let globalWebController: WebViewController | null = null;

// 仅同步“播放中”UI 给 Web（不影响播放意图）
function pushWebPlaybackUI(playing: boolean) {
  if (globalWebController) {
    globalWebController.evaluateJavaScript(
      `window.__onNativePlaybackState && window.__onNativePlaybackState(${JSON.stringify({ playing })})`
    ).catch(() => {});
  }
}

// 更新“播放意图”，并同步 UI
function setPlayingIntent(playing: boolean) {
  globalIsPlaying = playing;
  dbg("setPlayingIntent=" + playing);
  pushWebPlaybackUI(playing);
}

// 更新 iOS 锁屏和控制中心 NowPlayingInfo
export function updateNowPlaying(station: RadioStationPayload | null, playing: boolean) {
  if (!station) {
    MediaPlayer.nowPlayingInfo = null;
    return;
  }
  MediaPlayer.nowPlayingInfo = {
    title: station.name,
    artist: station.lastPlaying || station.country || "在线直播",
    albumTitle: station.genre ? `NetRadio · ${station.genre}` : "NetRadio 网络收音机",
    isLiveStream: true,
    playbackRate: playing ? 1.0 : 0.0,
    elapsedPlaybackTime: 0,
    playbackDuration: 0,
  };
}

// 获取或初始化全局播放器
async function getOrCreatePlayer(): Promise<AVPlayer> {
  if (!globalPlayer) {
    try {
      await SharedAudioSession.setCategory("playback", []);
      await SharedAudioSession.setActive(true);
      dbg("audio session playback active");
      // 来电等中断结束后自动恢复播放
      try {
        SharedAudioSession.addInterruptionListener((type) => {
          dbg("interruption=" + type);
          if (type === "began") {
            pushWebPlaybackUI(false);
          } else if (type === "ended") {
            if (globalCurrentStation && globalPlayer && globalIsPlaying) {
              globalPlayer.play();
              pushWebPlaybackUI(true);
            }
          }
        });
      } catch (e) {}
    } catch (err) {
      dbg("audio session error: " + String(err));
      console.warn("SharedAudioSession init error:", err);
    }

    const player = new AVPlayer();
    globalPlayer = player;

    player.onReadyToPlay = () => {
      dbg("onReadyToPlay");
      player.play();
      pushWebPlaybackUI(true);
      if (globalCurrentStation) updateNowPlaying(globalCurrentStation, true);
    };

    player.onTimeControlStatusChanged = (status: TimeControlStatus) => {
      // 缓冲中（waitingToPlayAtSpecifiedRate）也算“正在播放”，避免状态抖动
      const playing = status !== TimeControlStatus.paused;
      dbg("timeControlStatus=" + String(status) + " ui=" + playing);
      pushWebPlaybackUI(playing);
      if (globalCurrentStation) updateNowPlaying(globalCurrentStation, globalIsPlaying);
    };

    player.onError = (msg: string) => {
      dbg("player error: " + msg);
      console.error("AVPlayer Error:", msg);
    };

    // 锁屏与耳机播控监听
    MediaPlayer.setAvailableCommands(["play", "pause", "stop", "nextTrack", "previousTrack"]);
    MediaPlayer.commandHandler = (cmd: MediaPlayerRemoteCommand) => {
      if (!globalPlayer) return;
      dbg("remoteCmd=" + String(cmd));
      switch (cmd) {
        case "play":
          globalPlayer.play();
          setPlayingIntent(true);
          break;
        case "pause":
        case "stop":
          globalPlayer.pause();
          setPlayingIntent(false);
          break;
        case "nextTrack":
          if (globalWebController) {
            globalWebController.evaluateJavaScript(`window.__onNativeRemoteCommand && window.__onNativeRemoteCommand('next')`).catch(() => {});
          }
          break;
        case "previousTrack":
          if (globalWebController) {
            globalWebController.evaluateJavaScript(`window.__onNativeRemoteCommand && window.__onNativeRemoteCommand('prev')`).catch(() => {});
          }
          break;
      }
    };
  }
  return globalPlayer;
}

// 完全停止并释放播放器
export function stopAndCleanupPlayer() {
  dbg("stopAndCleanupPlayer");
  if (globalPlayer) {
    try {
      globalPlayer.pause();
      globalPlayer.dispose();
    } catch (e) {}
    globalPlayer = null;
  }
  MediaPlayer.nowPlayingInfo = null;
  globalIsPlaying = false;
  globalCurrentStation = null;
}

export function isCurrentlyPlaying(): boolean {
  return globalIsPlaying;
}

// 主视图组件
export default function AppView() {
  const dismiss = Navigation.useDismiss();
  const controller = useMemo(() => new WebViewController(), []);

  // 进入后台继续收听：只做最小化，绝不 dismiss / exit（否则会真退出）
  const goBackground = useCallback(async () => {
    dbg("goBackground: supportsMinimization=" + Script.supportsMinimization() + " isMinimized=" + Script.isMinimized());
    try {
      const ok = await Script.minimize();
      dbg("minimize result=" + ok);
      if (!ok) {
        // 最小化被忽略（例如开启了多窗口模式）：保持界面，音频继续，绝不退出
        await Dialog.alert({
          title: "无法进入后台",
          message: "当前环境不支持脚本最小化（常见原因：开启了“多个脚本/多窗口”模式）。\n请在 设置 → 通用 中关闭该模式后重试；在此之前界面会保持打开以继续播放。",
        });
      }
    } catch (e) {
      dbg("minimize error: " + String(e));
    }
  }, []);

  // 处理退出弹窗选项
  const handleExitClick = useCallback(async () => {
    dbg("handleExitClick: isPlaying=" + globalIsPlaying);
    if (globalIsPlaying) {
      const choice = await Dialog.actionSheet({
        title: "NetRadio 播放中",
        message: "您希望在后台继续收听广播，还是完全停止并退出？",
        actions: [
          { label: "后台继续收听" },
          { label: "完全停止并退出", destructive: true },
        ],
      });
      dbg("close choice=" + String(choice));

      if (choice === 0) {
        await goBackground();
      } else if (choice === 1) {
        stopAndCleanupPlayer();
        dismiss();
        Script.exit();
      }
    } else {
      stopAndCleanupPlayer();
      dismiss();
      Script.exit();
    }
  }, [dismiss, goBackground]);

  useEffect(() => {
    globalWebController = controller;

    async function initView() {
      await getOrCreatePlayer();

      // 读取电台数据
      if (globalStationsList.length === 0) {
        try {
          const stationsPath = Path.join(Script.directory, "stations.json");
          if (await FileManager.exists(stationsPath)) {
            const rawText = await FileManager.readAsString(stationsPath);
            const data = JSON.parse(rawText);
            const list = data.channels || data.stations || (Array.isArray(data) ? data : []);
            const normalized: RadioStationPayload[] = [];
            for (const item of list) {
              const s = normalizeStation(item);
              if (s) normalized.push(s);
            }
            globalStationsList = normalized;
            dbg("stations loaded=" + normalized.length);
          }
        } catch (stErr) {
          dbg("stations error: " + String(stErr));
          console.error("Failed to load stations.json:", stErr);
        }
      }

      // 注册 Web 桥接消息
      await controller.addScriptMessageHandler("nativeRadio", async (msg?: NativeRadioMessage) => {
        if (!msg || typeof msg !== "object") return;

        if (msg.action === "getStations") {
          if (globalStationsList.length > 0) {
            controller.evaluateJavaScript(
              `window.__setStations && window.__setStations(${JSON.stringify(globalStationsList)})`
            ).catch(() => {});
          }
          controller.evaluateJavaScript(
            `window.__onNativePlaybackState && window.__onNativePlaybackState(${JSON.stringify({ playing: globalIsPlaying })})`
          ).catch(() => {});
        } else if (msg.action === "play" && msg.station) {
          globalCurrentStation = msg.station;
          const url = msg.station.url_resolved;
          if (url && globalPlayer) {
            globalPlayer.setSource(url);
            if (typeof msg.volume === "number") {
              globalPlayer.volume = Math.max(0, Math.min(1, msg.volume));
            }
            globalPlayer.play();
            setPlayingIntent(true);
            updateNowPlaying(msg.station, true);
            dbg("play: " + msg.station.name);
          }
        } else if (msg.action === "togglePlay") {
          if (!globalPlayer) return;
          if (globalIsPlaying) {
            globalPlayer.pause();
            setPlayingIntent(false);
            if (globalCurrentStation) updateNowPlaying(globalCurrentStation, false);
          } else {
            globalPlayer.play();
            setPlayingIntent(true);
            if (globalCurrentStation) updateNowPlaying(globalCurrentStation, true);
          }
        } else if (msg.action === "setVolume" && typeof msg.volume === "number") {
          if (globalPlayer) globalPlayer.volume = Math.max(0, Math.min(1, msg.volume));
        } else if (msg.action === "openExternalUrl" && msg.url) {
          Safari.openURL(msg.url).catch((e: Error) => {
            console.error("Failed to open external url:", e);
          });
        } else if (msg.action === "getSystemVolume") {
          try {
            const sysVol = await SharedAudioSession.outputVolume;
            await controller.evaluateJavaScript(
              `window.__syncSystemVolume && window.__syncSystemVolume(${sysVol})`
            );
          } catch (e) {}
        } else if (msg.action === "exit") {
          handleExitClick();
        }
      });

      // 加载轻量级 Web 页面
      try {
        const htmlPath = Path.join(Script.directory, "web", "index.html");
        if (await FileManager.exists(htmlPath)) {
          const htmlContent = await FileManager.readAsString(htmlPath);
          await controller.loadHTML(htmlContent, "https://netradio.app/");
          if (globalStationsList.length > 0) {
            controller.evaluateJavaScript(
              `window.__setStations && window.__setStations(${JSON.stringify(globalStationsList)})`
            ).catch(() => {});
          }
        }
      } catch (loadErr) {
        dbg("loadHTML error: " + String(loadErr));
        console.error("Failed to load NetRadio HTML:", loadErr);
      }
    }

    initView();

    return () => {
      globalWebController = null;
      // 重点：如果当前正在播放（用户意图），绝对不要在此停止或释放 player！
      if (!globalIsPlaying) {
        stopAndCleanupPlayer();
      }
    };
  }, [controller, handleExitClick]);

  return (
    <NavigationStack>
      <VStack
        frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
        ignoresSafeArea={true}
        navigationTitle="NetRadio"
        navigationBarTitleDisplayMode="inline"
        toolbar={{
          topBarTrailing: [
            <Button
              title="退出"
              systemImage="xmark"
              action={handleExitClick}
            />,
          ],
        }}
      >
        <WebView
          controller={controller}
          frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
        />
      </VStack>
    </NavigationStack>
  );
}
