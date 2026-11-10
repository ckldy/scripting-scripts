/**
 * 把 tools/_raw/*.json 脱敏成 tools/fixtures/youtube/*.json，并生成合成的「带广告」样本。
 *
 * 原则：
 *  - 真实样本只保留结构形状（截断长数组、剔除 tracking/captions、redact 标题作者）
 *  - 合成样本必须结构真实（含 streamingData / playabilityStatus / videoDetails + 广告键）
 *  - 不写入任何 cookie / 账号信息
 */
const fs = require('fs');
const path = require('path');

const RAW = path.join(__dirname, '_raw');
const OUT = path.join(__dirname, 'fixtures', 'youtube');

function sanitize(node, depth = 0) {
  if (depth > 22) return null;
  if (Array.isArray(node)) return node.slice(0, 2).map((x) => sanitize(x, depth + 1));
  if (node && typeof node === 'object') {
    const out = {};
    for (const k of Object.keys(node)) {
      if (/^(captions|captionTracks|trackingParams|responseContext)$/.test(k)) continue;
      let v = node[k];
      if (/^(title|author|ownerChannelName|shortDescription|text)$/.test(k) && typeof v === 'string') {
        v = '<redacted>';
      }
      out[k] = sanitize(v, depth + 1);
    }
    return out;
  }
  if (typeof node === 'string' && node.length > 160) return node.slice(0, 160) + '…';
  return node;
}

fs.mkdirSync(OUT, { recursive: true });
const manifest = {};

for (const name of ['player', 'next', 'browse', 'guide']) {
  const p = path.join(RAW, name + '.json');
  if (!fs.existsSync(p)) continue;
  const raw = fs.readFileSync(p, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    console.log(`${name}: NOT JSON (${e.message.slice(0, 50)}) — skipped`);
    continue;
  }
  const clean = sanitize(parsed);
  const f = `${name}.captured.json`;
  fs.writeFileSync(path.join(OUT, f), JSON.stringify(clean, null, 1));
  const out = JSON.stringify(clean);
  manifest[name] = {
    file: f,
    rawBytes: Buffer.byteLength(raw),
    fixtureBytes: Buffer.byteLength(out),
    hasStreamingData: !!parsed.streamingData,
    hasPlayabilityStatus: !!parsed.playabilityStatus,
    hasVideoDetails: !!parsed.videoDetails,
    hasAdKeys: /"(adPlacements|playerAds|adSlots)"/.test(raw),
  };
  console.log(
    `${name.padEnd(7)} raw=${String(manifest[name].rawBytes).padStart(7)}B -> ${String(manifest[name].fixtureBytes).padStart(7)}B` +
      ` streamingData=${manifest[name].hasStreamingData} playability=${manifest[name].hasPlayabilityStatus}` +
      ` videoDetails=${manifest[name].hasVideoDetails} adKeys=${manifest[name].hasAdKeys}`
  );
}

// ---------- 合成：带广告的 player（结构真实，用于验证「删广告但保住播放字段」） ----------
const playerWithAds = {
  responseContext: { serviceTrackingParams: [] },
  playabilityStatus: { status: 'OK', playableInEmbed: true },
  streamingData: {
    expiresInSeconds: '21540',
    formats: [
      {
        itag: 18,
        url: 'https://rr1---sn-example.googlevideo.com/videoplayback?itag=18&mime=video%2Fmp4',
        mimeType: 'video/mp4; codecs="avc1.42001E, mp4a.40.2"',
        bitrate: 531000,
        width: 640,
        height: 360,
        contentLength: '7345123',
      },
    ],
    adaptiveFormats: [
      {
        itag: 137,
        url: 'https://rr1---sn-example.googlevideo.com/videoplayback?itag=137',
        mimeType: 'video/mp4; codecs="avc1.640028"',
        bitrate: 4210933,
        width: 1920,
        height: 1080,
      },
    ],
  },
  videoDetails: {
    videoId: 'dQw4w9WgXcQ',
    title: '<redacted>',
    lengthSeconds: '213',
    isLiveContent: false,
  },
  adPlacements: [
    { adPlacementRenderer: { renderer: { instreamVideoAdRenderer: {} }, params: 'AD_PARAMS_1' } },
    { adPlacementRenderer: { renderer: { instreamVideoAdRenderer: {} }, params: 'AD_PARAMS_2' } },
  ],
  playerAds: [{ playerLegacyDesktopWatchAdsRenderer: { playerAdParams: { showCompanion: true } } }],
  adSlots: [{ adSlotRenderer: { adSlotMetadata: { slotId: 'SLOT_1' } } }],
  adBreakParams: { adBreakParams: 'BREAK' },
  adBreakHeartbeatParams: 'HEARTBEAT',
};

// ---------- 合成：无广告的正常 player ----------
const playerNoAds = JSON.parse(JSON.stringify(playerWithAds));
delete playerNoAds.adPlacements;
delete playerNoAds.playerAds;
delete playerNoAds.adSlots;
delete playerNoAds.adBreakParams;
delete playerNoAds.adBreakHeartbeatParams;

['player.with-ads.json', 'player.clean.json'].forEach((f, i) => {
  const data = i === 0 ? playerWithAds : playerNoAds;
  fs.writeFileSync(path.join(OUT, f), JSON.stringify(data, null, 1));
  console.log(`${f.padEnd(24)} ${Buffer.byteLength(JSON.stringify(data))}B`);
});

// ---------- 合成：/watch 首屏 HTML 片段（含内联 ytInitialPlayerResponse） ----------
const watchHtml =
  '<!DOCTYPE html><html><head><title>YouTube</title></head><body>' +
  '<script nonce="x">var ytInitialPlayerResponse = ' +
  JSON.stringify(playerWithAds) +
  ';var ytplayer={config:{args:{raw_player_response:ytInitialPlayerResponse}}};</script>' +
  '<script src="/s/player/base.js"></script></body></html>';
fs.writeFileSync(path.join(OUT, 'watch.inline-player.html'), watchHtml);
console.log(`watch.inline-player.html   ${Buffer.byteLength(watchHtml)}B`);

// ---------- 超大 body 由测试运行时现场生成，不落盘（见 test-yt-playback-smoke.js E 组） ----------

fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1));
console.log('\ndone ->', OUT);
