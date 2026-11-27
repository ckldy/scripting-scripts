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

  // Surge JSC 引擎不自带 TextEncoder / TextDecoder；若缺少则提供轻量纯 JS UTF-8 编解码兜底，
  // 避免 binary-body-mode=1 下在 catch 里静默失败。
  if (typeof TextEncoder === 'undefined') {
    var TextEncoder = function () {};
    TextEncoder.prototype.encode = function (str) {
      str = String(str);
      var out = [], i = 0, n = str.length;
      while (i < n) {
        var c = str.charCodeAt(i++);
        if (c < 0x80) out.push(c);
        else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
        else if (c >= 0xd800 && c <= 0xdbff && i < n) {
          var c2 = str.charCodeAt(i);
          if (c2 >= 0xdc00 && c2 <= 0xdfff) {
            i++;
            var cp = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
            out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
            continue;
          }
          out.push(0xef, 0xbf, 0xbd);
        } else if (c >= 0xd800 && c <= 0xdfff) out.push(0xef, 0xbf, 0xbd);
        else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
      }
      return new Uint8Array(out);
    };
  }
  if (typeof TextDecoder === 'undefined') {
    var TextDecoder = function (label, opts) { this.fatal = !!(opts && opts.fatal); };
    TextDecoder.prototype.decode = function (buf) {
      var b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
      var out = [], i = 0, n = b.length;
      while (i < n) {
        var a = b[i++];
        if (a < 0x80) out.push(a);
        else if ((a & 0xe0) === 0xc0) {
          if (i >= n || (b[i] & 0xc0) !== 0x80 || a < 0xc2) {
            if (this.fatal) throw new TypeError('Invalid UTF-8');
            out.push(0xfffd); continue;
          }
          out.push(((a & 0x1f) << 6) | (b[i++] & 0x3f));
        } else if ((a & 0xf0) === 0xe0) {
          if (i + 1 >= n || (b[i] & 0xc0) !== 0x80 || (b[i + 1] & 0xc0) !== 0x80 || (a === 0xe0 && b[i] < 0xa0) || (a === 0xed && b[i] >= 0xa0)) {
            if (this.fatal) throw new TypeError('Invalid UTF-8');
            out.push(0xfffd); continue;
          }
          out.push(((a & 0x0f) << 12) | ((b[i++] & 0x3f) << 6) | (b[i++] & 0x3f));
        } else if ((a & 0xf8) === 0xf0) {
          if (i + 2 >= n || (b[i] & 0xc0) !== 0x80 || (b[i + 1] & 0xc0) !== 0x80 || (b[i + 2] & 0xc0) !== 0x80 || (a === 0xf0 && b[i] < 0x90) || (a === 0xf4 && b[i] >= 0x90) || a > 0xf4) {
            if (this.fatal) throw new TypeError('Invalid UTF-8');
            out.push(0xfffd); continue;
          }
          var p = ((a & 0x07) << 18) | ((b[i++] & 0x3f) << 12) | ((b[i++] & 0x3f) << 6) | (b[i++] & 0x3f);
          p -= 0x10000;
          out.push(0xd800 + (p >> 10), 0xdc00 + (p & 0x3ff));
        } else {
          if (this.fatal) throw new TypeError('Invalid UTF-8');
          out.push(0xfffd);
        }
      }
      var res = '';
      for (var j = 0; j < out.length; j += 4096) res += String.fromCharCode.apply(null, out.slice(j, j + 4096));
      return res;
    };
  }

  /**
   * 2026-11-10：双面分流（两面策略必须不同，不得混用）。
   *
   * 同一份脚本同时服务两个面，但「删广告字段」的代价完全不同：
   *  - App 面（youtubei.googleapis.com）：删 adPlacements / paidPromotion / adSlots 正常。
   *    播放数据内嵌在 next 的 WatchContent.player 里，删广告字段不影响出流。
   *  - 网页面（www.youtube.com）：删 adPlacements 会被判「使用广告拦截器」直接禁播
   *    （#adhub-off A/B 已坐实）。网页的视觉广告交给浏览器侧 AdBlockHub，Surge 不插手。
   *
   * 因此按 host + 登录态分流，两面永不共用同一套策略：
   *  - web 未登录   -> 'strip'          ：匿名删广告安全（无痕实测无广告且可播）
   *  - web 已登录   -> 'playback-first' ：只删反墙键，不删广告位
   *  - client（App） -> 'strip'          ：照删广告字段
   */
  function surfaceOf(url) {
    var u = String(url || '').toLowerCase();
    if (u.indexOf('//youtubei.googleapis.com/') !== -1) return 'client';
    if (u.indexOf('//youtubei.') !== -1) return 'client';
    return 'web';
  }

  var ARG = {};
  try { ARG = JSON.parse(String($argument || '{}')) || {}; } catch (e) { ARG = {}; }

  function modeFor(surface) {
    if (surface === 'client') return ARG.clientMode === 'playback-first' ? 'playback-first' : 'strip';
    if (ARG.webMode === 'strip') return 'strip';
    if (ARG.webMode === 'playback-first') return 'playback-first';
    // 2026-11-10 实测依据：
    //  - 匿名（无痕）：删广告位后无广告且能播。
    //  - 登录：同一台机、同一节点、同一脚本，删广告位 → 反广告墙 + 零媒体。
    // 所以网页面默认 auto：匿名才去广，登录一律让路（视觉广告交给 AdBlockHub）。
    return webSignedIn() ? 'playback-first' : 'strip';
  }

  /** 登录态判据：只看 Cookie 里有没有 Google 账号票据，不解析内容、不外发。 */
  function webSignedIn() {
    var h = ($request && $request.headers) || {};
    var ck = '';
    for (var k in h) {
      if (String(k).toLowerCase() === 'cookie') { ck = String(h[k] || ''); break; }
    }
    return /(?:^|;\s*)(?:SAPISID|__Secure-3PSID|LOGIN_INFO)=/.test(ck);
  }

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
    if (!/\/youtubei\/v1\/(?:player|next|reel\/reel_watch_sequence)(?:[?]|$)/.test(__url)) { $done({}); return; }

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

      var data = JSON.parse(text);
      if (!data || typeof data !== 'object') { $done({}); return; }

      var surface = surfaceOf(__url);
      var mode = modeFor(surface);
      // 网页面默认只反墙不去广，面面分明。
      var prunedData = mode === 'strip' ? pruneAds(data, 0) : pruneEnf(data, 0);
      if (!prunedData) { $done({}); return; }
      var outText = JSON.stringify(prunedData);
      // 没真删掉任何东西就不写回，避免无意义重序列化。
      if (outText.length === text.length) { $done({}); return; }
      $done({ body: binary ? new TextEncoder().encode(outText) : outText });
      return;
    }

    // ---------- protobuf 通道（仅 player，仅 App 面） ----------
    // 网页面永不走这里：protobuf 删字段一旦落到网页，就是禁播的另一种写法。
    if (surfaceOf(__url) !== 'client') { $done({}); return; }
    if (!isPlayerRequest(__url)) { $done({}); return; }

    var res = dropProtoFields(bytes, [7, 61, 68]);
    if (!res || res.dropped === 0) { $done({}); return; }
    $done({ body: res.bytes });
  } catch (err) {
    $done({});
  }
})();
