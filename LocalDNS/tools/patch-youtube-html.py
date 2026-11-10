from pathlib import Path

p = Path('/var/mobile/Library/Mobile Documents/iCloud~com~thomfang~Scripting/Documents/scripts/LocalDNS/web/scripts/youtube-web.js')
s = p.read_text(encoding='utf-8')

helpers = r'''
  function isWatchHtmlRequest(url) {
    return /^https?:\/\/(?:www|m)\.youtube\.com\/watch(?:[?#]|$)/.test(String(url || ''));
  }

  function findJsonObjectEnd(s, start) {
    var depth = 0;
    var inStr = false;
    var esc = false;
    for (var i = start; i < s.length; i++) {
      var ch = s[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
      } else if (ch === '"') {
        inStr = true;
      } else if (ch === '{') {
        depth++;
      } else if (ch === '}') {
        depth--;
        if (depth === 0) return i;
      }
    }
    return -1;
  }

  function stripHtmlPlayerAds(html) {
    var re = /ytInitialPlayerResponse\s*=\s*\{/g;
    var m = re.exec(html);
    if (!m) return html;
    var start = m.index + m[0].lastIndexOf('{');
    var end = findJsonObjectEnd(html, start);
    if (end < 0) return html;
    var raw = html.slice(start, end + 1);
    if (!AD_KEY_RE.test(raw)) return html;
    try {
      var data = JSON.parse(raw);
      var out = JSON.stringify(pruneAds(data, 0));
      if (!out || out === raw) return html;
      return html.slice(0, start) + out + html.slice(end + 1);
    } catch (e) {
      return html;
    }
  }
'''

marker = "  function isPlayerRequest(url) {"
if helpers.strip() not in s:
    s = s.replace(marker, helpers + "\n" + marker, 1)

old_guard = "    if (!/\\/youtubei\\/v1\\/(?:player|next|reel\\/reel_watch_sequence)(?:[?]|$)/.test(__url)) { $done({}); return; }"
new_guard = "    var watchHtml = isWatchHtmlRequest(__url);\n    if (!watchHtml && !/\\/youtubei\\/v1\\/(?:player|next|reel\\/reel_watch_sequence)(?:[?]|$)/.test(__url)) { $done({}); return; }"
if old_guard in s:
    s = s.replace(old_guard, new_guard, 1)

html_branch = r'''
    // 网页首屏：HTML 内联的 ytInitialPlayerResponse 走 JSON.parse 清理。
    if (watchHtml) {
      var html = binary ? new TextDecoder('utf-8').decode(bytes) : text;
      if (!html || html.indexOf('ytInitialPlayerResponse') === -1) { $done({}); return; }
      var cleanedHtml = stripHtmlPlayerAds(html);
      if (cleanedHtml === html) { $done({}); return; }
      $done({ body: binary ? new TextEncoder().encode(cleanedHtml) : cleanedHtml });
      return;
    }
'''
anchor = "    } else {\n      text = String(body);\n    }\n"
if 'if (watchHtml) {' not in s:
    s = s.replace(anchor, anchor + html_branch, 1)

p.write_text(s, encoding='utf-8')
print('watchHtml guard', 'var watchHtml' in s)
print('html branch', 'if (watchHtml) {' in s)
print('helpers', 'function stripHtmlPlayerAds' in s)
print('len', len(s))
