#!/bin/sh
# 抓 YouTube 网页端真实响应到 tools/_raw/（随后由 sanitize 脚本脱敏成 fixture）
set -e
DIR="tools/_raw"
mkdir -p "$DIR"
KEY="AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8"
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15"
P="http://127.0.0.1:6152"

curl -sS -m 40 --insecure --proxy "$P" \
  -H "content-type: application/json" \
  -H "accept-encoding: identity" \
  -H "origin: https://www.youtube.com" \
  -A "$UA" \
  --data '{"context":{"client":{"clientName":"WEB","clientVersion":"2.20241101.00.00","hl":"zh-CN","gl":"US"}},"videoId":"dQw4w9WgXcQ","playbackContext":{"contentPlaybackContext":{"html5Preference":"HTML5_PREF_WANTS"}}}' \
  "https://www.youtube.com/youtubei/v1/player?key=$KEY&prettyPrint=false" -o "$DIR/player.json"

curl -sS -m 40 --insecure --proxy "$P" \
  -H "content-type: application/json" \
  -H "accept-encoding: identity" \
  -H "origin: https://www.youtube.com" \
  -A "$UA" \
  --data '{"context":{"client":{"clientName":"WEB","clientVersion":"2.20241101.00.00","hl":"zh-CN","gl":"US"}},"videoId":"dQw4w9WgXcQ"}' \
  "https://www.youtube.com/youtubei/v1/next?key=$KEY&prettyPrint=false" -o "$DIR/next.json"

curl -sS -m 40 --insecure --proxy "$P" \
  -H "content-type: application/json" \
  -H "accept-encoding: identity" \
  -H "origin: https://www.youtube.com" \
  -A "$UA" \
  --data '{"context":{"client":{"clientName":"WEB","clientVersion":"2.20241101.00.00","hl":"zh-CN","gl":"US"}},"browseId":"FEwhat_to_watch"}' \
  "https://www.youtube.com/youtubei/v1/browse?key=$KEY&prettyPrint=false" -o "$DIR/browse.json"

curl -sS -m 40 --insecure --proxy "$P" \
  -H "content-type: application/json" \
  -H "accept-encoding: identity" \
  -H "origin: https://www.youtube.com" \
  -A "$UA" \
  --data '{"context":{"client":{"clientName":"WEB","clientVersion":"2.20241101.00.00","hl":"zh-CN","gl":"US"}}}' \
  "https://www.youtube.com/youtubei/v1/guide?key=$KEY&prettyPrint=false" -o "$DIR/guide.json"

ls -l "$DIR"
