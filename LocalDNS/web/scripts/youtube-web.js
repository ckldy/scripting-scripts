/**
 * LocalDNS 内置：YouTube 网页版去广告脚本
 * 由 LocalDNS 本地托管（http://127.0.0.1:9099/scripts/youtube-web.js），
 * 供 Surge 七层模块引用，仅处理 www.youtube.com / m.youtube.com 的 youtubei/v1 JSON 响应。
 * 非 JSON（App 端 protobuf）响应一律原样放行。
 */
(function () {
  try {
    var raw = $response && $response.body;
    if (raw === null || raw === undefined) { $done({}); return; }

    var text = typeof raw === 'string' ? raw : new TextDecoder('utf-8').decode(raw);
    if (!text || text.charCodeAt(0) !== 123) { $done({}); return; }

    var json;
    try {
      json = JSON.parse(text);
    } catch (e) {
      $done({});
      return;
    }

    var changed = false;

    function strip(obj) {
      if (!obj || typeof obj !== 'object') return;
      var keys = ['adPlacements', 'playerAds', 'adSlots', 'adBreakParams', 'adBreakHeartbeatParams'];
      for (var i = 0; i < keys.length; i++) {
        if (keys[i] in obj) {
          delete obj[keys[i]];
          changed = true;
        }
      }
    }

    strip(json);
    strip(json.playerResponse);
    strip(json.player);
    strip(json.adSlots);

    // 清理首页 / 搜索 / 相关视频 / 评论区的各类广告与推广渲染器
    var AD_KEYS = [
      'adSlotRenderer',
      'adSlotAndLayoutMetadata',
      'promotedSparklesWebRenderer',
      'promotedSparklesTextSearchRenderer',
      'compactPromotedVideoRenderer',
      'promotedVideoRenderer',
      'displayAdRenderer',
      'inFeedAdLayoutRenderer',
      'brandVideoShelfRenderer',
      'brandVideoSingletonRenderer',
      'statementBannerRenderer',
      'mastheadAdV3Renderer',
      'videoMastheadAdV3Renderer',
      'prerollRenderer',
      'featuredPromotedSparklesWebRenderer',
      'adDurationRemaining',
      'adInfoRenderer'
    ];

    function walk(node, depth) {
      if (!node || typeof node !== 'object' || depth > 32) return;
      if (Array.isArray(node)) {
        for (var i = 0; i < node.length; i++) walk(node[i], depth + 1);
        return;
      }
      for (var k in node) {
        if (!Object.prototype.hasOwnProperty.call(node, k)) continue;
        if (AD_KEYS.indexOf(k) !== -1) {
          delete node[k];
          changed = true;
          continue;
        }
        walk(node[k], depth + 1);
      }
    }
    walk(json, 0);

    if (!changed) {
      $done({});
      return;
    }
    $done({ body: JSON.stringify(json) });
  } catch (err) {
    console.log('LocalDNS youtube-web error: ' + err);
    $done({});
  }
})();
