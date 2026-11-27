/**
 * YouTube 去广告规则的**单一真相**（Single Source of Truth）。
 *
 * 背景（2026-11-07 事故）：同一条「内置网页 JSON 脚本」的 pattern / max-size / script URL
 * 曾散落在 5 个地方（编译循环、兜底注入、canary 生成、DB、静态模块），改一处漏四处，
 * 导致「网页无法播放」与「改了没生效」反复出现。
 *
 * 约定：
 *  - 任何需要「内置网页脚本 Surge 行」的地方，都必须调用 renderBuiltinWebRule()。
 *  - 禁止再手写 `localdns_builtin_yt_web = type=http-response,...` 长字符串。
 *  - 修改端点/上限只改本文件。
 *
 * 内存红线：绝不匹配 /watch 整页 HTML。首屏 ytInitialPlayerResponse 是内联 JS 对象字面量，
 * 不经过 JSON.parse，交给浏览器侧 AdBlockHub 的钩子剥离（零 Surge 内存）。
 * 历史 localdns_builtin_yt_html 的 3MB 整页通道曾把网络扩展内存打爆被系统杀，禁止回潮。
 */

/** 内置网页 JSON 脚本在 web/scripts/ 下的文件名（稳定名）。 */
export const YT_BUILTIN_WEB_SCRIPT = 'youtube-web.js';

/**
 * 允许进入 Surge JSON 脱水的网页 youtubei 端点。
 *
 * 2026-11-07 教训：把 browse|search|guide|get_watch|account/get_setting|navigation/resolve_url
 * 一并纳入后与「网页无法播放」同时出现，且真实响应里并不存在现有广告键（实测 6 个端点全 NONE），
 * 扩白名单没有实证收益。新增端点必须走 YT_ENDPOINT_PROMOTION_CHECKLIST。
 */
export const YT_WEB_JSON_ENDPOINTS: readonly string[] = [
  'player',
  'next',
  'reel/reel_watch_sequence',
];

/**
 * 新增端点前必须逐条满足（缺一不可）：
 *  1. 有真实带广告响应样本（非构造）
 *  2. 已确认广告字段的确切路径
 *  3. 已确认该字段不是播放必需字段
 *  4. 已有对应 fixture（tools/fixtures/youtube/）
 *  5. 播放 smoke 断言通过（streamingData / playabilityStatus / videoDetails 不受影响）
 *  6. 内存峰值验证通过（body 大小与 Surge 缓冲上限）
 *  7. Canary 灰度观察无回归
 */
export const YT_ENDPOINT_PROMOTION_CHECKLIST: readonly string[] = [
  '有真实带广告响应样本（非构造）',
  '已确认广告字段的确切路径',
  '已确认该字段不是播放必需字段',
  '已有对应 fixture',
  '播放 smoke 断言通过',
  '内存峰值验证通过',
  'Canary 灰度无回归',
];

/**
 * Surge 单响应缓冲上限（编译期 max-size）。
 *
 * 2026-11-07 已验证可播放的基线是 8MB；不要与脚本内的「可处理上限」混为一谈。
 * 实测网页端点 body：player ~11KB、next ~0.5–1.15MB、reel 更小，均在 8MB 内。
 */
export const YT_BUILTIN_WEB_MAX_SIZE = 8388608;

/**
 * 脚本内部可处理上限（web/scripts/youtube-web.js 的 MAX_PROCESS_BYTES）。
 * 超过则原样放行，绝不把大 body 拉进 JSON.parse / JSON.stringify。
 * 必须 ≤ YT_BUILTIN_WEB_MAX_SIZE，测试里有断言守着。
 */
export const YT_BUILTIN_WEB_MAX_PROCESS_BYTES = 2097152;

/** 内置网页脚本的其它固定参数（改这些会影响播放，改前请走 checklist）。 */
/**
 * 2026-11-27：webview → jsc。
 * 实测 webview 引擎每条请求要 7–9 秒（WebView 进程启动 + 脚本注入），
 * 网页播放器早已超时，表现为「脚本找到了但没效果」；jsc 是进程内 JavaScriptCore，毫秒级。
 * 脚本只用 $request/$response/$done/JSON/TextEncoder/TextDecoder，全部在 JSC 可用。
 */
export const YT_BUILTIN_WEB_ENGINE = 'jsc' as const;

/** 生成内置网页脚本的 URL 正则。 */
export function buildYtWebPattern(endpoints: readonly string[] = YT_WEB_JSON_ENDPOINTS): string {
  return (
    '^https?://([a-zA-Z0-9_-]+[.])?youtube[.]com/youtubei/v1/(?:' +
    endpoints.join('|') +
    ')(?:[?].*)?$'
  );
}

export interface SurgeScriptRule {
  name: string;
  pattern: string;
  /** script-path 完整 URL（由调用方注入 baseUrl 与不可变文件名） */
  scriptPath: string;
  requiresBody?: boolean;
  maxSize?: number;
  binaryBody?: boolean;
  engine?: string;
  argument?: string;
  timeout?: number;
}

/**
 * 渲染一条 Surge [Script] 行。
 * pattern 含逗号/空格/引号时必须加引号，否则 Surge INI 解析器会按逗号截断。
 */
export function renderSurgeScriptLine(rule: SurgeScriptRule): string {
  const parts: string[] = [`type=http-response`];

  const clean = String(rule.pattern || '').replace(/^["']|["']$/g, '');
  if (clean.includes(',') || clean.includes(' ') || clean.includes('"')) {
    parts.push(`pattern="${clean.replace(/"/g, '\\"')}"`);
  } else if (clean) {
    parts.push(`pattern=${clean}`);
  }

  if (rule.argument) {
    const raw = rule.argument.trim();
    const inner =
      raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2 ? raw.slice(1, -1) : raw;
    parts.push(`argument="${inner}"`);
  }
  if (rule.requiresBody) parts.push('requires-body=1');
  if (rule.maxSize !== undefined) parts.push(`max-size=${rule.maxSize}`);
  if (rule.binaryBody) parts.push('binary-body-mode=1');
  if (rule.engine) parts.push(`engine=${rule.engine}`);
  if (rule.timeout !== undefined) parts.push(`timeout=${rule.timeout}`);
  parts.push(`script-path=${rule.scriptPath}`);

  return `${rule.name} = ${parts.join(',')}`;
}

/**
 * 渲染「内置网页 JSON 脚本」的完整行。
 *
 * @param baseUrl        LocalDNS 基地址，如 http://127.0.0.1:9099
 * @param immutableFile  内容哈希文件名，如 youtube-web.010cebc8dc23.js。
 *                       传空则退回稳定名（no-store），仅用于兼容旧模块。
 */
export function renderBuiltinWebRule(baseUrl: string, immutableFile?: string): string {
  const file = immutableFile || YT_BUILTIN_WEB_SCRIPT;
  return renderSurgeScriptLine({
    name: 'localdns_builtin_yt_web',
    pattern: buildYtWebPattern(),
    scriptPath: `${baseUrl}/scripts/${file}`,
    // 2026-11-10 双面分流：这行只服务网页面，写 webMode=auto。
    // 脚本按登录态自己判：匿名 → 去广，登录 → 播放优先（删广告位会判禁播）。
    // App 面的去广告由 youtube.enhance.response 在 youtubei.googleapis.com 上做，两边不共用策略。
    argument: '{"webMode":"auto"}',
    requiresBody: true,
    maxSize: YT_BUILTIN_WEB_MAX_SIZE,
    binaryBody: true,
    engine: YT_BUILTIN_WEB_ENGINE,
  });
}

/** 内置行以该前缀开头，用于在各产物里定位/去重。 */
export const YT_BUILTIN_WEB_RULE_NAME = 'localdns_builtin_yt_web';

/**
 * 判断某行是否是内置网页规则。
 */
export function isBuiltinWebRuleLine(line: string): boolean {
  return String(line || '').trimStart().startsWith(`${YT_BUILTIN_WEB_RULE_NAME} =`);
}

/**
 * YouTube App 与浏览器插件分流规则（2026-11-27）：
 * - YouTube Enhance（App 端）专管 youtubei.googleapis.com + *.googlevideo.com（带 App UA/c=IOS 隔离）。
 * - 浏览器端（Safari www.youtube.com / m.youtube.com / music.youtube.com）交由浏览器插件 AdBlockHub 独占处理。
 * - Surge Hub 禁止对网页端域名开 MITM、禁止加载 localdns_builtin_yt_web、禁止拦截网页端 /pagead /stats/ads（否则触发反广告墙）。
 */
export const YT_APP_MITM_HOSTS: readonly string[] = [
  'youtubei.googleapis.com',
  '*.googlevideo.com',
];

export const YT_WEB_EXCLUDED_MITM_HOSTS = new Set<string>([
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtube.com',
  's.youtube.com',
  's2.youtube.com',
  'imasdk.googleapis.com',
]);

export function isYoutubeWebExcludedHost(host: string): boolean {
  const bare = String(host || '').trim().replace(/^[-*]+\.?/, '').toLowerCase();
  if (!bare) return false;
  return YT_WEB_EXCLUDED_MITM_HOSTS.has(bare);
}

/**
 * 判断一条来自子模块的 URL Rewrite 是否属于浏览器端 YouTube 拦截（应由浏览器插件接管，不进 Surge Hub）。
 */
export function isYoutubeWebAdRewrite(pattern: string): boolean {
  const p = String(pattern || '').toLowerCase().replace(/\\\//g, '/');
  if (!p) return false;
  return (
    (p.includes('youtube') && (p.includes('pagead') || p.includes('pcs') || p.includes('stats/ads'))) ||
    p.includes('imasdk.googleapis.com')
  );
}

/**
 * Surge JSC 引擎兼容层：注入轻量纯 JS UTF-8 TextEncoder / TextDecoder（含 fatal 支持）。
 * 解决 gholts response.js / ump.js 在 engine=jsc 下报错 ReferenceError: Can't find variable: TextEncoder 的问题。
 */
export const JSC_TEXT_CODEC_POLYFILL = [
  'if(typeof TextEncoder==="undefined"){function TextEncoder(){}TextEncoder.prototype.encode=function(s){s=String(s);var o=[],i=0,n=s.length;while(i<n){var c=s.charCodeAt(i++);if(c<128)o.push(c);else if(c<2048)o.push(192|(c>>6),128|(c&63));else if(c>=55296&&c<=56319&&i<n){var c2=s.charCodeAt(i);if(c2>=56320&&c2<=57343){i++;var p=65536+((c-55296)<<10)+(c2-56320);o.push(240|(p>>18),128|((p>>12)&63),128|((p>>6)&63),128|(p&63));continue;}o.push(239,191,189);}else if(c>=55296&&c<=57343)o.push(239,191,189);else o.push(224|(c>>12),128|((c>>6)&63),128|(c&63));}return new Uint8Array(o);};}',
  'if(typeof TextDecoder==="undefined"){function TextDecoder(l,opts){this.fatal=!!(opts&&opts.fatal);}TextDecoder.prototype.decode=function(b){b=b instanceof Uint8Array?b:new Uint8Array(b);var o=[],i=0,n=b.length;while(i<n){var a=b[i++];if(a<128)o.push(a);else if((a&224)===192){if(i>=n||(b[i]&192)!==128||a<194){if(this.fatal)throw new TypeError("Invalid UTF-8");o.push(65533);continue;}o.push(((a&31)<<6)|(b[i++]&63));}else if((a&240)===224){if(i+1>=n||(b[i]&192)!==128||(b[i+1]&192)!==128||(a===224&&b[i]<160)||(a===237&&b[i]>=160)){if(this.fatal)throw new TypeError("Invalid UTF-8");o.push(65533);continue;}o.push(((a&15)<<12)|((b[i++]&63)<<6)|(b[i++]&63));}else if((a&248)===240){if(i+2>=n||(b[i]&192)!==128||(b[i+1]&192)!==128||(b[i+2]&192)!==128||(a===240&&b[i]<144)||(a===244&&b[i]>=144)||a>244){if(this.fatal)throw new TypeError("Invalid UTF-8");o.push(65533);continue;}var p=((a&7)<<18)|((b[i++]&63)<<12)|((b[i++]&63)<<6)|(b[i++]&63);p-=65536;o.push(55296+(p>>10),56320+(p&1023));}else{if(this.fatal)throw new TypeError("Invalid UTF-8");o.push(65533);}}var r="";for(var j=0;j<o.length;j+=4096)r+=String.fromCharCode.apply(null,o.slice(j,j+4096));return r;};}',
].join('');

/**
 * Surge JSC 引擎兼容层：注入纯 JS RFC 1952/1951 GZIP DecompressionStream / CompressionStream。
 * 解决 gholts ump.js 处理 gzip 压缩 UMP /initplayback 时在 engine=jsc 下报错
 * ReferenceError: Can't find variable: DecompressionStream 而静默跳过放行广告的根因。
 */
export const JSC_GZIP_STREAM_POLYFILL =
  'if(typeof DecompressionStream==="undefined"||typeof CompressionStream==="undefined"){(function(){' +
  'var CRC=(function(){var t=new Uint32Array(256);for(var n=0;n<256;n++){var c=n;for(var k=0;k<8;k++)c=(c&1)?(0xedb88320^(c>>>1)):(c>>>1);t[n]=c>>>0;}return function(b){var c=0xffffffff;for(var i=0;i<b.length;i++)c=t[(c^b[i])&255]^(c>>>8);return(c^0xffffffff)>>>0;};})();' +
  'function cat(a){var n=0,i=0;for(;i<a.length;i++)n+=a[i].length;var o=new Uint8Array(n),p=0;for(i=0;i<a.length;i++){o.set(a[i],p);p+=a[i].length;}return o;}' +
  'var FL=new Uint8Array(288);for(var i=0;i<144;i++)FL[i]=8;for(;i<256;i++)FL[i]=9;for(;i<280;i++)FL[i]=7;for(;i<288;i++)FL[i]=8;' +
  'var FD=new Uint8Array(32);for(i=0;i<32;i++)FD[i]=5;' +
  'var LB=[3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258];' +
  'var LE=[0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0];' +
  'var DB=[1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577];' +
  'var DE=[0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13];' +
  'var CO=[16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15];' +
  'function mkT(lens){var ml=0,i;for(i=0;i<lens.length;i++)if(lens[i]>ml)ml=lens[i];if(!ml)return{m:0,t:new Int32Array(1)};var cnt=new Uint16Array(ml+1);for(i=0;i<lens.length;i++)if(lens[i])cnt[lens[i]]++;var nxt=new Uint16Array(ml+1),c=0;for(i=1;i<=ml;i++){c=(c+cnt[i-1])<<1;nxt[i]=c;}var sz=1<<ml,t=new Int32Array(sz).fill(-1);for(var sym=0;sym<lens.length;sym++){var l=lens[sym];if(!l)continue;var code=nxt[l]++,rev=0;for(var b=0;b<l;b++)if(code&(1<<b))rev|=1<<(l-1-b);var step=1<<l,val=(sym<<5)|l;for(var j=rev;j<sz;j+=step)t[j]=val;}return{m:ml,t:t};}' +
  'var FT=mkT(FL),FDT=mkT(FD);' +
  'function gunzip(src){if(src.length<18||src[0]!==31||src[1]!==139||src[2]!==8)throw new Error("Invalid gzip");var flg=src[3],p=10;if(flg&4){if(p+2>src.length)throw new Error("Bad gzip xlen");p+=2+(src[p]|(src[p+1]<<8));}if(flg&8){while(p<src.length&&src[p]!==0)p++;p++;}if(flg&16){while(p<src.length&&src[p]!==0)p++;p++;}if(flg&2)p+=2;if(p>src.length-8)throw new Error("Truncated gzip");var end=src.length-8,bp=p*8,endb=end*8;function bits(n){if(bp+n>endb)throw new Error("Truncated deflate");var v=0;for(var k=0;k<n;k++){var idx=bp+k;v|=((src[idx>>3]>>(idx&7))&1)<<k;}bp+=n;return v;}function dec(tb){var mask=(1<<tb.m)-1,idx=bp>>3,sh=bp&7,w=(src[idx]|((src[idx+1]||0)<<8)|((src[idx+2]||0)<<16))>>>sh;var v=tb.t[w&mask];if(v<0)throw new Error("Bad huffman");bp+=v&31;return v>>>5;}var out=[],bf=0;do{bf=bits(1);var bt=bits(2);if(bt===0){bp=(bp+7)&~7;var o=bp>>3;if(o+4>end)throw new Error("Bad stored block");var ln=src[o]|(src[o+1]<<8),nl=src[o+2]|(src[o+3]<<8);if((ln^nl)!==65535)throw new Error("Bad stored len");o+=4;if(o+ln>end)throw new Error("Truncated stored");for(var k=0;k<ln;k++)out.push(src[o+k]);bp=(o+ln)*8;}else{var lt,dt;if(bt===1){lt=FT;dt=FDT;}else if(bt===2){var hlit=bits(5)+257,hdist=bits(5)+1,hclen=bits(4)+4,cl=new Uint8Array(19);for(var i=0;i<hclen;i++)cl[CO[i]]=bits(3);var ct=mkT(cl),ls=new Uint8Array(hlit+hdist),k=0;while(k<ls.length){var s=dec(ct);if(s<16)ls[k++]=s;else{var rp=s===16?bits(2)+3:(s===17?bits(3)+3:bits(7)+11),val=s===16?ls[k-1]:0;while(rp--)ls[k++]=val;}}lt=mkT(ls.subarray(0,hlit));dt=mkT(ls.subarray(hlit));}else throw new Error("Bad btype");for(;;){var sy=dec(lt);if(sy<256)out.push(sy);else if(sy===256)break;else{var li=sy-257,len=LB[li]+bits(LE[li]),di=dec(dt),dist=DB[di]+bits(DE[di]),sp=out.length-dist;if(sp<0)throw new Error("Bad dist");for(var k=0;k<len;k++)out.push(out[sp+k]);}}}}while(!bf);var res=new Uint8Array(out),exp=(src[end]|(src[end+1]<<8)|(src[end+2]<<16)|(src[end+3]<<24))>>>0;if(CRC(res)!==exp)throw new Error("CRC mismatch");return res;}' +
  'function gzip(raw){var n=raw.length,blk=Math.max(1,Math.ceil(n/65535)),out=new Uint8Array(10+blk*5+n+8),p=0;out[p++]=31;out[p++]=139;out[p++]=8;out[p++]=0;out[p++]=0;out[p++]=0;out[p++]=0;out[p++]=0;out[p++]=0;out[p++]=255;if(n===0){out[p++]=1;out[p++]=0;out[p++]=0;out[p++]=255;out[p++]=255;}else{for(var off=0;off<n;){var c=Math.min(65535,n-off),last=off+c>=n?1:0;out[p++]=last;out[p++]=c&255;out[p++]=(c>>8)&255;out[p++]=(~c)&255;out[p++]=((~c)>>8)&255;out.set(raw.subarray(off,off+c),p);p+=c;off+=c;}}var crc=CRC(raw);out[p++]=crc&255;out[p++]=(crc>>>8)&255;out[p++]=(crc>>>16)&255;out[p++]=(crc>>>24)&255;out[p++]=n&255;out[p++]=(n>>>8)&255;out[p++]=(n>>>16)&255;out[p++]=(n>>>24)&255;return out.subarray(0,p);}' +
  'function mkS(fn){var ch=[],done=false,err=null,emitted=false,waiter=null;function wake(){if(waiter){var w=waiter;waiter=null;w();}}return{writable:{getWriter:function(){return{write:function(b){if(b&&b.length)ch.push(b instanceof Uint8Array?b:new Uint8Array(b));return Promise.resolve();},close:function(){done=true;wake();return Promise.resolve();},abort:function(e){err=e||new Error("Aborted");done=true;wake();return Promise.resolve();},releaseLock:function(){}};}},readable:{getReader:function(){function readNext(){if(err)return Promise.reject(err);if(!done)return new Promise(function(res){waiter=res;}).then(readNext);if(emitted)return Promise.resolve({value:undefined,done:true});emitted=true;try{var res=fn(cat(ch));return Promise.resolve({value:res,done:false});}catch(e){return Promise.reject(e);}}return{read:readNext,cancel:function(e){err=e||new Error("Cancelled");done=true;wake();return Promise.resolve();},releaseLock:function(){}};}}};}' +
  'if(typeof DecompressionStream==="undefined")DecompressionStream=function(f){if(f!=="gzip")throw new Error("Unsupported:"+f);return mkS(gunzip);};' +
  'if(typeof CompressionStream==="undefined")CompressionStream=function(f){if(f!=="gzip")throw new Error("Unsupported:"+f);return mkS(gzip);};' +
  '})();}';

/**
 * 媒体流脚本分流守卫：若请求来自浏览器（c=WEB/MWEB/... 或 Mozilla UA 且非 YouTube App），
 * YouTube Enhance 的 ump / init / auto-hd 直接原样放行，避免与浏览器插件冲突或误伤网页播放。
 */
export const YT_APP_ONLY_CHECK_EXPR =
  '(function(){try{var u=String(($request&&$request.url)||"");if(/[?&]c=(?:WEB|MWEB|TVHTML5|WEB_EMBEDDED_PLAYER|WEB_REMIX|WEB_CREATOR)(?:&|$)/i.test(u))return true;var h=($request&&$request.headers)||{},ua="";for(var k in h){if(String(k).toLowerCase()==="user-agent"){ua=String(h[k]||"");break;}}if(/Mozilla\\/5\\.0/i.test(ua)&&!/com\\.google\\.ios\\.youtube|YouTube/i.test(ua))return true;}catch(_){}return false;})()';

/**
 * 把上游 YouTube Enhance 脚本包装为 Surge JSC 引擎可直接执行的版本（可选注入编码器 / GZIP 流 polyfill 与 App 独占分流守卫）。
 */
export function wrapYoutubeEnhanceForJsc(
  rawSource: string,
  opts: { needsTextCodec?: boolean; needsGzipStream?: boolean; appOnlyMediaGuard?: boolean } = {}
): string {
  const parts: string[] = [];
  if (opts.needsTextCodec) {
    parts.push(JSC_TEXT_CODEC_POLYFILL);
  }
  if (opts.needsGzipStream) {
    parts.push(JSC_GZIP_STREAM_POLYFILL);
  }
  if (opts.appOnlyMediaGuard) {
    parts.push(`if(${YT_APP_ONLY_CHECK_EXPR}){$done({});}else{\n${rawSource}\n}`);
  } else {
    parts.push(rawSource);
  }
  return parts.join('\n');
}
