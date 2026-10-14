import { Navigation, Path, Script } from "scripting";
import AppView, { isCurrentlyPlaying, stopAndCleanupPlayer } from "./view";

const LOG_PATH = Path.join(FileManager.appGroupDocumentsDirectory, "netradio_debug.log");
function dbg(msg: string) {
  try {
    FileManager.appendTextSync(LOG_PATH, `[${new Date().toLocaleTimeString()}] [index] ${msg}\n`);
  } catch (e) {}
}

(async () => {
  // 开启最小化后台支持：下拉收起时最小化（后台继续播放），而不是结束脚本
  try {
    if (Script.supportsMinimization()) {
      Script.enableMinimize(true);
    }
    dbg("enableMinimize done, supports=" + Script.supportsMinimization());
  } catch (e) {
    dbg("enableMinimize error: " + String(e));
  }

  Script.onMinimize(() => {
    dbg("onMinimize: script minimized, keep playing");
  });

  // 监听后台唤醒或重新进入
  Script.onResume((details) => {
    dbg("onResume: fromMinimized=" + details.resumeFromMinimized);
    console.log("NetRadio resumed, from minimized:", details.resumeFromMinimized);
  });

  await Navigation.present({
    element: <AppView />,
    modalPresentationStyle: "fullScreen",
  });
  dbg("present resolved; isPlaying=" + isCurrentlyPlaying());

  // 如果正在后台收听广播，绝不调用 Script.exit()，保持脚本常驻后台持续播放
  if (!isCurrentlyPlaying()) {
    stopAndCleanupPlayer();
    Script.exit();
  } else {
    dbg("keep-alive: still playing in background, not exiting");
  }
})().catch(async (e) => {
  dbg("launch error: " + String(e));
  console.error("NetRadio launch error:", e);
});
