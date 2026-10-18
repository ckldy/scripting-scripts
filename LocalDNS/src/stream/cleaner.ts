// Stream Cleaner: High-Performance HLS (M3U8) Playlist & JSON Ad Pruner
import { ModuleManager } from '../modules/module-manager';

export class StreamCleaner {
  // 1x1 像素透明 GIF (base64)
  private static readonly TRANSPARENT_1X1_GIF = 
    'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

  /**
   * 1. HLS M3U8 播放列表广告切片流式清洗 (针对 Twitch / Kick / 通用 SSAI)
   */
  static cleanM3U8(manifestText: string, url: string = ''): string {
    let cleaned = manifestText;
    let modified = false;

    // 清理 Twitch DATERANGE 广告段与前置预取
    if (
      manifestText.includes('EXT-X-DATERANGE') ||
      manifestText.includes('stitched-ad') ||
      manifestText.includes('twitch-')
    ) {
      const prev = cleaned;
      cleaned = cleaned.replace(/#EXT-X-DATERANGE:ID="(?:stitched-ad|maf-ad|source|trigger)[^"]*"[^\n]*\n/gi, '');
      cleaned = cleaned.replace(/#EXT-X-DATERANGE:[^\n]+CLASS="twitch-[^\n]+"[^\n]*\n/gi, '');
      cleaned = cleaned.replace(/#EXT-X-DATERANGE:[^\n]+CLASS="[^"]*ad-quartile[^"]*"[^\n]*\n/gi, '');
      cleaned = cleaned.replace(/#EXT-X-TWITCH-PREFETCH:[^\n]*\n/gi, '');
      if (cleaned !== prev) modified = true;
    }

    // 清理通用带 ad / advertisement 标记的切片行
    if (cleaned.includes('ad_segment') || cleaned.includes('/ad/') || cleaned.includes('-ad-')) {
      const prev = cleaned;
      cleaned = cleaned.replace(/#EXTINF:[^,\n]+,[^\n]*\n.*?ad_segment.*?\.ts\n/gi, '');
      cleaned = cleaned.replace(/#EXTINF:[^,\n]+,[^\n]*\n.*?(?:\/ad\/|-ad-).*?\.(?:ts|m4s|mp4)\n/gi, '');
      if (cleaned !== prev) modified = true;
    }

    // 清理连续重复或孤立的 DISCONTINUITY 标签（防止播放器卡死或黑屏等待）
    if (cleaned.includes('#EXT-X-DISCONTINUITY')) {
      const prev = cleaned;
      cleaned = cleaned.replace(/(?:\n#EXT-X-DISCONTINUITY\s*){2,}/g, '\n#EXT-X-DISCONTINUITY\n');
      if (cleaned !== prev) modified = true;
    }

    if (modified) {
      ModuleManager.get().recordStreamClean();
    }

    return cleaned;
  }

  /**
   * 2. 视频 API 响应体 JSON 递归剪枝 (YouTube / B站 / 腾讯视频等)
   */
  static cleanJSON(jsonText: string, url: string = ''): string {
    try {
      const obj = JSON.parse(jsonText);
      let changed = false;

      // 针对 YouTube 官方播放器响应接口特化处理
      if (
        url.includes('/youtubei/v1/player') ||
        url.includes('/youtubei/v1/get_watch') ||
        url.includes('/youtubei/v1/browse') ||
        url.includes('/watch?')
      ) {
        const cleanPlayerObject = (pObj: any) => {
          if (!pObj || typeof pObj !== 'object') return;
          const adKeys = [
            'adPlacements',
            'playerAds',
            'adSlots',
            'adPlacementRenderer',
            'adLayoutLoggingData',
            'adPlacementConfig',
            'adBreakHeartbeatParams',
            'paidContentOverlayRenderer',
            'instreamAdPlayerOverlayRenderer',
          ];
          for (const k of adKeys) {
            if (pObj[k] !== undefined) {
              delete pObj[k];
              changed = true;
            }
          }
          if (pObj.playbackTracking) {
            if (pObj.playbackTracking.videostatsPlaybackUrl) {
              delete pObj.playbackTracking.videostatsPlaybackUrl;
              changed = true;
            }
            if (pObj.playbackTracking.videostatsAtrUrl) {
              delete pObj.playbackTracking.videostatsAtrUrl;
              changed = true;
            }
            if (pObj.playbackTracking.atrUrl) {
              delete pObj.playbackTracking.atrUrl;
              changed = true;
            }
            if (pObj.playbackTracking.videostatsWatchtimeUrl) {
              delete pObj.playbackTracking.videostatsWatchtimeUrl;
              changed = true;
            }
          }
        };

        cleanPlayerObject(obj);
        if (obj.playerResponse) {
          cleanPlayerObject(obj.playerResponse);
        }
      }

      // 广义广告字段递归深度剪枝
      const pruneKeyWords = [
        'ad_info',
        'ad_list',
        'ad_slots',
        'adSlots',
        'advertisement',
        'banner_list',
        'commercial',
        'adPlacements',
        'playerAds',
        'adPlacementRenderer',
        'adSlotRenderer',
        'promotedSparklesWebRenderer',
        'promotedVideoRenderer',
        'compactPromotedVideoRenderer',
        'promotedSparklesTextSearchRenderer',
        'adBreakHeartbeatParams',
        'adPlacementConfig',
      ];

      const recursivePrune = (node: any) => {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) {
          for (let i = node.length - 1; i >= 0; i--) {
            const item = node[i];
            if (item && typeof item === 'object') {
              if (item.is_ad || item.ad_id || item.ad_type || item.ad) {
                node.splice(i, 1);
                changed = true;
              } else {
                recursivePrune(item);
              }
            }
          }
        } else {
          for (const key of Object.keys(node)) {
            if (pruneKeyWords.includes(key)) {
              delete node[key];
              changed = true;
            } else {
              recursivePrune(node[key]);
            }
          }
        }
      };

      recursivePrune(obj);

      if (changed) {
        ModuleManager.get().recordStreamClean();
        return JSON.stringify(obj);
      }
      return jsonText;
    } catch {
      return jsonText;
    }
  }

  /**
   * 3. 静态拦截响应快速生成（透明图、空字典、空数组等）
   */
  static getRejectResponse(action: string): { status: number; headers: Record<string, string>; body: string } {
    switch (action) {
      case 'reject-img':
        return {
          status: 200,
          headers: {
            'Content-Type': 'image/gif',
            'Content-Length': '43',
            'Cache-Control': 'public, max-age=86400',
          },
          body: this.TRANSPARENT_1X1_GIF,
        };
      case 'reject-dict':
        return {
          status: 200,
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Content-Length': '2',
          },
          body: '{}',
        };
      case 'reject-array':
        return {
          status: 200,
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Content-Length': '2',
          },
          body: '[]',
        };
      case 'reject-200':
      default:
        return {
          status: 204,
          headers: {
            'Content-Length': '0',
            'Connection': 'keep-alive',
          },
          body: '',
        };
    }
  }
}
