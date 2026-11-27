/** 临时：验证 MITM 分流（媒体流剔除 / youtubei 保留） */
import { Script } from 'scripting';
import { narrowMitmHosts, isMitmPinningSensitive } from '../src/surge-service';

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail?: any) => {
  if (ok) { pass++; console.log('  ✓ ' + name + (detail ? '  ' + JSON.stringify(detail) : '')); }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  ' + JSON.stringify(detail) : '')); }
};

const haystack = [
  'youtube.enhance.ump = type=http-response,pattern=^https?://[\\w-]+\\.googlevideo\\.com/initplayback',
  'youtube.enhance.response = type=http-response,pattern=^https://youtubei\\.googleapis\\.com/youtubei/v1/player',
  'https://rr1---sn-abc.googlevideo.com/videoplayback?expire=1',
].join('\n');

const hosts = ['*.googlevideo.com', 'www.youtube.com', 'youtubei.googleapis.com', '*.ggpht.com'];
const r = narrowMitmHosts(hosts, haystack);
console.log('kept:', r.kept, 'dropped:', r.dropped);

check('googlevideo 在保留集（YouTube Enhance 媒体脚本需要）', r.kept.some((h) => h.includes('googlevideo')), r.kept);
check('www.youtube.com 排除出 MITM（交由浏览器插件）', !r.kept.includes('www.youtube.com') && r.dropped.includes('www.youtube.com'));
check('youtubei 保留', r.kept.includes('youtubei.googleapis.com'));
check('媒体子域判定为钉扎敏感', isMitmPinningSensitive('rr1---sn-abc.googlevideo.com') === true);
check('非媒体域不敏感', isMitmPinningSensitive('youtubei.googleapis.com') === false);

console.log('RESULT ' + JSON.stringify({ pass, fail }));
Script.exit(fail > 0 ? 1 : 0);
