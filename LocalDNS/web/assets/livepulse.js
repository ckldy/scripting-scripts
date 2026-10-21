/* LocalDNS 概览页实时轻量心跳（就地更新运行时长/CPU/内存，不整页重渲染）
   复刻旧版 app.js 的 1 秒脉冲行为，适配新版打包 SPA 的 DOM 标记。 */
(function () {
  var lastCpuTotal = null, lastCpuAt = null, tick = 0;

  function parseProm(txt) {
    var out = {};
    if (!txt) return out;
    var lines = txt.split('\n');
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (!line || line.charAt(0) === '#') continue;
      var m = line.match(/^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{[^}]*\})?\s+([-+0-9.eE]+)\s*$/);
      if (!m) continue;
      var name = m[1], val = parseFloat(m[3]);
      if (!isFinite(val)) continue;
      if (!(name in out)) out[name] = val; // 取首个（无标签或首标签）样本
    }
    return out;
  }

  function uptimeMarkup(seconds) {
    var s = Math.max(0, Math.floor(+seconds || 0));
    var h = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), sec = s % 60;
    function part(n, u) {
      return '<span class="overview-duration-part"><span class="overview-duration-num">' + n +
        '</span><span class="overview-duration-unit">' + u + '</span></span>';
    }
    if (h) return part(h, '小时') + part(mm, '分钟');
    if (mm) return part(mm, '分钟');
    return part(sec, '秒');
  }

  function fmtBytes(b) {
    b = +b || 0;
    if (b >= 1073741824) return (b / 1073741824).toFixed(1) + ' GB';
    if (b >= 1048576) return (b / 1048576).toFixed(1) + ' MB';
    if (b >= 1024) return (b / 1024).toFixed(1) + ' KB';
    return b + ' B';
  }

  function q(sel) { try { return document.querySelector(sel); } catch (e) { return null; } }

  function run() {
    if (document.visibilityState !== 'visible') return;
    var upEl = q('[data-service-metric="uptime"] .service-uptime-value');
    if (!upEl) return; // 仅概览页存在
    tick++;
    fetch('/metrics', { cache: 'no-store' })
      .then(function (r) { return r.text(); })
      .then(function (txt) {
        var m = parseProm(txt), now = Date.now();
        var start = m['process_start_time_seconds'];
        if (start != null && isFinite(start)) {
          var el = q('[data-service-metric="uptime"] .service-uptime-value');
          if (el) el.innerHTML = uptimeMarkup(now / 1000 - start);
        }
        if (tick % 2 === 0) {
          var cpu = m['process_cpu_seconds_total'];
          var rss = m['process_resident_memory_bytes'];
          if (cpu != null && isFinite(cpu)) {
            var pct = 0;
            if (lastCpuTotal != null && lastCpuAt != null && cpu >= lastCpuTotal && now > lastCpuAt) {
              var dt = (now - lastCpuAt) / 1000;
              if (dt > 0.4) pct = Math.max(0, Math.min(100, (cpu - lastCpuTotal) / dt * 100));
            }
            lastCpuTotal = cpu; lastCpuAt = now;
            var cEl = q('[data-service-metric="cpu"] [data-display-number]');
            if (cEl) cEl.textContent = pct.toFixed(1) + '%';
          }
          if (rss != null && isFinite(rss)) {
            var mEl = q('[data-service-metric="memory"] [data-display-number]');
            if (mEl) mEl.textContent = fmtBytes(rss);
          }
        }
      })
      .catch(function () {});
  }

  setInterval(run, 1000);
})();
