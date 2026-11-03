/**
 * LocalDNS 内置：YouTube 网页版 JSON 广告彻底剥离脚本
 * 经过验证的稳定版：
 * 针对 /youtubei/v1/player 与 next 接口，在网络层直接将 adPlacements 与 playerAds 彻底删除
 * 播放器自始至终拿不到广告数据，实现 100% 正片直接播放！
 */
(function () {
  try {
    var raw = $response && $response.body;
    if (!raw) { $done({}); return; }

    var text = typeof raw === 'string' ? raw : new TextDecoder('utf-8').decode(raw);
    if (!text || text.charCodeAt(0) !== 123) { $done({}); return; }

    // 快速字符检查：有广告字段才进入 JSON 解析
    if (
      text.indexOf('"adPlacements"') === -1 &&
      text.indexOf('"playerAds"') === -1 &&
      text.indexOf('"adSlots"') === -1 &&
      text.indexOf('"adBreakParams"') === -1
    ) {
      $done({});
      return;
    }

    var json = JSON.parse(text);
    var changed = false;

    // 核心直接剥离
    var keys = ['adPlacements', 'playerAds', 'adSlots', 'adBreakParams', 'adBreakHeartbeatParams', 'adFormat', 'adParams'];
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (k in json) { delete json[k]; changed = true; }
      if (json.playerResponse && typeof json.playerResponse === 'object' && k in json.playerResponse) {
        delete json.playerResponse[k];
        changed = true;
      }
    }

    if (!changed) {
      $done({});
      return;
    }

    $done({ body: JSON.stringify(json) });
  } catch (err) {
    $done({});
  }
})();
