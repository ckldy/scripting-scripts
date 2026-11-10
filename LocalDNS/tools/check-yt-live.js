#!/usr/bin/env node
/**
 * 查询 Surge 实时状态：基线是否已装、还有哪些 YouTube 脚本在跑、有没有新的内存告警。
 *
 * Surge HTTP API 只在本机 6166 端口，不联网。
 * 用法：node tools/check-yt-live.js
 */
const KEY = 'vcncvkey';
const BASE = 'http://127.0.0.1:6166';

async function api(path) {
  const r = await fetch(BASE + path, { headers: { 'X-Key': KEY } });
  if (!r.ok) throw new Error(path + ' -> HTTP ' + r.status);
  return r.json();
}

/** 基线部署时间基准点：此后出现的告警才算新增。 */
const DEPLOY_AT = new Date('2026-11-08T00:20:00+08:00').getTime();

(async () => {
  let out = {};
  try {
    const mods = await api('/v1/modules');
    const enabled = mods.enabled || [];
    out.enabledModules = enabled;
    out.baselineInstalled = enabled.includes('LocalDNS YouTube Transport Baseline');
    out.legacyImmutableOn = enabled.includes('LocalDNS Unified Hub YT Web Immutable');
    out.memSafeOn = enabled.includes('LocalDNS Unified Hub LocalCanary MemSafe');
  } catch (e) {
    console.log('模块查询失败:', String(e));
  }

  try {
    const sc = await api('/v1/scripting');
    const yt = (sc.scripts || []).filter((s) => /youtube/i.test(s.name || ''));
    out.youtubeScripts = yt.map((s) => ({ name: s.name, error: s.error === undefined ? 'none' : s.error }));
    out.hasLogEvent = yt.some((s) => /log-event/i.test(s.name));
    out.hasAutoHd = yt.some((s) => /auto-hd/i.test(s.name));
    out.hasBuiltinWeb = yt.some((s) => /builtin_yt_web/i.test(s.name));
  } catch (e) {
    console.log('脚本查询失败:', String(e));
  }

  try {
    const ev = await api('/v1/events?limit=30');
    const warns = (ev.events || []).filter(
      (x) => x.type === 1 && /使用了过多内存/.test(x.content || '')
    );
    out.memoryWarningsTotal = warns.length;
    const fresh = warns.filter((w) => new Date(w.date).getTime() > DEPLOY_AT);
    out.newMemoryWarnings = fresh.length;
    out.newWarningDetail = fresh.map((w) => ({ date: w.date, content: w.content }));
    out.latestWarningAt = warns.length ? warns[0].date : null;
  } catch (e) {
    console.log('事件查询失败:', String(e));
  }

  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
})();
