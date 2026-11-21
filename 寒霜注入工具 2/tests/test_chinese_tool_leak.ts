import { Script } from "scripting";
import { parseToolCalls, stripToolMarkup, StreamToolFilter, looksLikeToolCall } from "../server";

const RAW_SAMPLE = `当前进度：98%｜已完成：**FUSE 挂载成功**——宿主机上已能看到「115 网盘、天翼云盘、夸克网盘」目录，\`mount\` 显示 \`mediavault on /data/muvyo/mount/cloudfs/mounts type fuse\`｜下一步：将 busybox 持久化挂载进容器，以免重启后丢失；然后进行最终验证

<调用工具 shell 参数={"action":"exec","command":"scripting-ts run '/var/mobile/Library/Mobile Documents/iCloud~com~thomfang~Scripting/Documents/scripting-skills/ssh-manager/scripts/ssh-manager.ts' --queryparameters '{\\"action\\":\\"execute\\",\\"name\\":\\"hk\\",\\"command\\":\\"docker stop muvyo && docker rename muvyo muvyo-bak && docker run -d --name muvyo --restart unless-stopped --device /dev/fuse --cap-add SYS_ADMIN --security-opt apparmor=unconfined -e MEDIAVAULT_BASE=/opt -e TZ=Asia/Shanghai -e LANG=zh_CN.UTF-8 -e LC_ALL=zh_CN.UTF-8 -e PUID=0 -e PGID=0 -e UMASK=022 -p 17810:7810 -p 7811:7811 -p 7812:7812 -v /data/muvyo/bin/busybox:/bin/mount:ro -v /data/muvyo/mount:/mount -v /data/muvyo/mount:/mnt:rshared -v /data/muvyo/opt:/opt -v /data/muvyo/strm:/media/mv thsrite/muvyo:v3.14.8-beta4-amd64\\"}' --timeout 300","intent":"重建容器并把 busybox 持久挂载为 /bin/mount"}
`;

// 1. 验证解析
const parsed = parseToolCalls(RAW_SAMPLE);
const parseOk = !!parsed && parsed.calls.length === 1 && parsed.calls[0].name === "shell";

// 2. 验证痕迹识别
const looksLike = looksLikeToolCall(RAW_SAMPLE);

// 3. 验证清洗
const stripped = stripToolMarkup(RAW_SAMPLE);

// 4. 验证流式过滤器切片阻断
function feed(size: number): string {
  const f = new StreamToolFilter({ guardJsonToolCalls: true });
  let res = "";
  for (let i = 0; i < RAW_SAMPLE.length; i += size) {
    res += f.onChunk(RAW_SAMPLE.slice(i, i + size));
  }
  res += f.onEnd();
  return res;
}

const leakResults = [1, 3, 7, 64].map((size) => {
  const p = feed(size);
  return {
    size,
    hasToolTagLeak: p.includes("调用工具"),
    clean: !p.includes("调用工具"),
    tail: p.slice(-40),
  };
});

const allStreamClean = leakResults.every((r) => r.clean);
const allStrippedClean = !stripped.includes("调用工具");

Script.exit({
  passed: parseOk && looksLike && allStreamClean && allStrippedClean,
  parseOk,
  looksLike,
  allStreamClean,
  allStrippedClean,
  calls: parsed?.calls,
  restTail: parsed?.rest.slice(-50),
  leakResults,
});
