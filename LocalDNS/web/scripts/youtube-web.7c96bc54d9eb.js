/**
 * LocalDNS 内置：YouTube 广告数据剥离脚本（网页 JSON + 客户端 protobuf 双通道）
 *
 * 背景：
 *  - 网页版 /youtubei/v1/player、/next 返回 JSON，删除 adPlacements / playerAds / adSlots 即可 0 秒开播。
 *  - iOS 客户端大量使用 protobuf（application/x-protobuf）。JSON 层删除对二进制无效，
 *    因此在 /youtubei/v1/player 的 protobuf 响应上按 wire format 精确剥离顶层广告字段：
 *      7  = adPlacements
 *      61 = paidPromotion
 *      68 = adSlots
 *    其余字段原样保留，绝不改动 /next（NextResponse 的 7 号字段是 content，删掉会导致客户端白屏）。
 *
 * 安全策略：
 *  - 任何解析异常、字段越界、非 player 接口 → 直接 $done({}) 放行原响应。
 *  - 只有确实删除了字段才写回 body。
 */
(function () {
  var AD_KEYS = [
    'adPlacements',
    'playerAds',
    'adSlots',
    'adBreakParams',
    'adBreakHeartbeatParams',
    'playerAdParams'
  ];
  var AD_KEY_RE = /"(?:adPlacements|playerAds|adSlots|adBreakParams|adBreakHeartbeatParams|playerAdParams)"/;

  /**
   * 2026-11-09：反广告墙（“使用广告拦截器违反 YouTube 服务条款”）。
   *
   * 现场证据：墙弹出后播放器不请求任何媒体（videoplayback 0 条），页面里拆 DOM 5 次
   * 仍在重建 —— 说明判定数据是随 watch 数据一起下发、客户端读到就拒绝出流的。
   * 能赢它的位置只有这里：在页面拿到数据之前删掉，客户端根本不知道该弹。
   *
   * 只按字段名白名单删，不碰 playabilityStatus / streamingData / videoDetails。
   */
  var ENF_KEY_RE = /^(?:adBlock[A-Za-z0-9]*|adblock[A-Za-z0-9]*|enforcement[A-Za-z0-9]*|playbackEnforcement[A-Za-z0-9]*)$/;
  var ENF_TEXT_RE = /"(?:adBlock|enforcement)/;

  /**
   * 脚本内可处理上限（与 src/youtube-rules.ts 的 YT_BUILTIN_WEB_MAX_PROCESS_BYTES 保持一致）。
   * 超过则原样放行，绝不把大 body 拉进 JSON.parse / JSON.stringify。
   * 实测网页端点 body：player ~11KB、next ~0.5–1.15MB，2MiB 有足够余量且守住内存红线。
   */
  var MAX_PROCESS_BYTES = 2097152;

  function pruneAds(obj, depth) {
    if (!obj || typeof obj !== 'object' || depth > 16) return obj;
    if (Array.isArray(obj)) {
      for (var i = 0; i < obj.length; i++) obj[i] = pruneAds(obj[i], depth + 1);
      return obj;
    }
    for (var k = 0; k < AD_KEYS.length; k++) {
      if (AD_KEYS[k] in obj) {
        try { delete obj[AD_KEYS[k]]; } catch (e) {}
      }
    }
    for (var ek in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, ek) && ENF_KEY_RE.test(ek)) {
        try { delete obj[ek]; } catch (e) {}
      }
    }
    for (var key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key) && obj[key] && typeof obj[key] === 'object') {
        obj[key] = pruneAds(obj[key], depth + 1);
      }
    }
    return obj;
  }

  /**
   * 按 protobuf wire format 遍历顶层字段，丢弃 dropList 中的字段。
   * 解析失败（含 group wire type / 长度越界）返回 null，由调用方放行原响应。
   */
  function dropProtoFields(bytes, dropList) {
    var len = bytes.length;
    var i = 0;
    var out = new Uint8Array(len);
    var outLen = 0;
    var dropped = 0;

    function readVarint() {
      var value = 0;
      var shift = 0;
      var b;
      do {
        if (i >= len || shift > 35) return -1;
        b = bytes[i++];
        value += (b & 0x7f) * Math.pow(2, shift);
        shift += 7;
      } while (b & 0x80);
      return value;
    }

    while (i < len) {
      var start = i;
      var tag = readVarint();
      if (tag < 0) return null;
      var field = Math.floor(tag / 8);
      var wire = tag & 7;

      if (wire === 0) {
        if (readVarint() < 0) return null;
      } else if (wire === 1) {
        i += 8;
      } else if (wire === 2) {
        var size = readVarint();
        if (size < 0) return null;
        i += size;
      } else if (wire === 5) {
        i += 4;
      } else {
        return null;
      }

      if (i > len) return null;

      if (dropList.indexOf(field) !== -1) {
        dropped++;
      } else {
        out.set(bytes.subarray(start, i), outLen);
        outLen += i - start;
      }
    }

    if (i !== len) return null;
    return { bytes: out.subarray(0, outLen), dropped: dropped };
  }

  function pruneEnf(obj, depth) {
    if (!obj || typeof obj !== 'object' || depth > 16) return obj;
    if (Array.isArray(obj)) {
      for (var i = 0; i < obj.length; i++) obj[i] = pruneEnf(obj[i], depth + 1);
      return obj;
    }
    for (var key in obj) {
      if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;
      if (ENF_KEY_RE.test(key)) {
        try { delete obj[key]; } catch (e) {}
        continue;
      }
      if (obj[key] && typeof obj[key] === 'object') obj[key] = pruneEnf(obj[key], depth + 1);
    }
    return obj;
  }

  function isPlayerRequest(url) {
    return /\/youtubei\/v1\/player(?:[/?]|$)/.test(String(url || ''));
  }

  try {
    // 只处理播放器与下一页数据；即使模块 pattern 放宽，也不会碰到 watch/browse 等其他响应。
    var __url = ($request && $request.url) || '';
    if (!/\/youtubei\/v1\/(?:player|next|get_watch|reel\/reel_watch_sequence)(?:[?]|$)/.test(__url)) { $done({}); return; }
    var isGetWatch = /\/youtubei\/v1\/get_watch(?:[?]|$)/.test(__url);

    var body = $response && $response.body;
    if (!body) { $done({}); return; }
    // 内存护栏：超上限直接放行（不解析、不改写），Surge 侧另有 max-size 兜底。
    if (body.length > MAX_PROCESS_BYTES) { $done({}); return; }

    var binary = typeof body !== 'string';
    var bytes = null;
    var text = null;

    if (binary) {
      bytes = body instanceof Uint8Array ? body : new Uint8Array(body);
      if (!bytes.length) { $done({}); return; }
      var first = bytes[0];
      if (first === 0x7b || first === 0x5b) {
        text = new TextDecoder('utf-8').decode(bytes);
      }
    } else {
      text = String(body);
    }

    // ---------- JSON 通道（网页版 /next、/player） ----------
    if (text !== null) {
      var c = text.charCodeAt(0);
      if (c !== 123 && c !== 91) { $done({}); return; }
      if (!AD_KEY_RE.test(text) && !ENF_TEXT_RE.test(text)) { $done({}); return; }
      // get_watch 是 watch 数据的唯一来源，它同时带着播放器数据，
      // 11-07 曾因对它做广告剥离而整页无法播放。所以这里只拆反广告墙。
      if (isGetWatch && !ENF_TEXT_RE.test(text)) { $done({}); return; }

      var data = JSON.parse(text);
      if (!data || typeof data !== 'object') { $done({}); return; }

      var prunedData = isGetWatch ? pruneEnf(data, 0) : pruneAds(data, 0);
      if (!prunedData) { $done({}); return; }
      var outText = JSON.stringify(prunedData);
      // 没真删掉任何东西就不写回，避免无意义重序列化。
      if (outText.length === text.length) { $done({}); return; }
      $done({ body: binary ? new TextEncoder().encode(outText) : outText });
      return;
    }

    // ---------- protobuf 通道（仅 player，避免误删 NextResponse.content） ----------
    if (!isPlayerRequest($request && $request.url)) { $done({}); return; }

    var res = dropProtoFields(bytes, [7, 61, 68]);
    if (!res || res.dropped === 0) { $done({}); return; }
    $done({ body: res.bytes });
  } catch (err) {
    $done({});
  }
})();
