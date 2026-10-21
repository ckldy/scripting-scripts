/* LocalDNS 概览页实时轻量心跳（就地更新，不整页重渲染）
   - 每秒：运行时长、累计请求、缓存命中率、客户端数、域名数、拦截请求、平均响应、浮动统计条
   - 每 2 秒：进程 CPU、内存占用
   适配上游打包 SPA（app-*.js）的 DOM 标记；仅概览页生效。 */
(function () {
  var lastCpuTotal = null, lastCpuAt = null, tick = 0;

  function parseProm(txt) {
    var flat = {}, tagged = {};
    if (!txt) return { flat: flat, tagged: tagged };
    var lines = txt.split('\n');
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (!line || line.charAt(0) === '#') continue;
      var m = line.match(/^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{([^}]*)\})?\s+([-+0-9.eE]+)\s*$/);
      if (!m) continue;
      var name = m[1], labels = m[3] || '', val = parseFloat(m[4]);
      if (!isFinite(val)) continue;
      if (!(name in flat)) flat[name] = val;
      var tm = labels.match(/tag="([^"]*)"/);
      if (tm) tagged[name + '|' + tm[1]] = val;
    }
    return { flat: flat, tagged: tagged };
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

  // 与上游 SPA 的 num / pct / fullNum / ms / compactNum 保持一致的格式
  function fmtNum(v) { return isFinite(+v) ? (+v).toLocaleString('zh-CN') : null; }
  function fmtFull(v) { return isFinite(+v) ? Math.max(0, Math.floor(+v)).toLocaleString('zh-CN') : null; }
  function fmtPct(v) { return isFinite(+v) ? (+v).toFixed(2) + '%' : null; }
  function fmtMs(v) { return isFinite(+v) ? (+v).toFixed(2) + ' ms' : null; }
  function fmtCompact(v) {
    var n = +v;
    if (!isFinite(n)) return null;
    if (Math.abs(n) < 1e4) return n.toLocaleString('zh-CN');
    try {
      return new Intl.NumberFormat('zh-CN', { notation: 'compact', compactDisplay: 'short', maximumFractionDigits: 1 }).format(n);
    } catch (e) {
      return n.toLocaleString('zh-CN');
    }
  }

  function q(sel) { try { return document.querySelector(sel); } catch (e) { return null; } }

  // 仅在内容变化时写 DOM，避免每秒无意义的重排
  function setText(el, text) {
    if (!el || text == null) return;
    if (el.textContent !== text) el.textContent = text;
  }
  function setHtml(el, html) {
    if (!el || html == null) return;
    if (el.innerHTML !== html) el.innerHTML = html;
  }

  function updateKpis(m) {
    var flat = m.flat, tagged = m.tagged;

    var totalQ = flat['localdns_queries_total'];
    var clients = flat['localdns_clients_total'];
    var domains = flat['localdns_domains_total'];
    var adBlocked = flat['localdns_adguard_blocked_total'];
    var avgMs = flat['localdns_average_duration_ms'];

    // 累计请求
    setText(q('.spark-kpi-card[data-route="logs"] .sk-val'), fmtNum(totalQ));

    // 缓存命中率（主缓存已由后端聚合为总体，缺失时退化为分组合计）
    var groupTags = ['cache_domestic', 'cache_foreign', 'cache_foreign_ecs'];
    var mainQ = tagged['localdns_cache_query_total|cache_main'];
    var mainH = tagged['localdns_cache_hit_total|cache_main'];
    var sumQ = 0, sumH = 0, activePools = 0;
    if (isFinite(mainQ) && mainQ > 0) activePools++;
    for (var i = 0; i < groupTags.length; i++) {
      var pq = tagged['localdns_cache_query_total|' + groupTags[i]];
      var ph = tagged['localdns_cache_hit_total|' + groupTags[i]];
      if (isFinite(pq) && pq > 0) {
        activePools++;
        sumQ += pq;
        if (isFinite(ph)) sumH += ph;
      }
    }
    var cacheEl = q('.spark-kpi-card[data-route="management"] .sk-val');
    var cacheNoteEl = q('.spark-kpi-card[data-route="management"] .sk-note');
    var totalQn = isFinite(totalQ) ? +totalQ : 0;
    var overallRate = null;
    if (isFinite(mainQ) && mainQ > 0 && isFinite(mainH)) overallRate = mainH / mainQ * 100;
    else if (sumQ > 0) overallRate = sumH / sumQ * 100;
    if (overallRate !== null) {
      setText(cacheEl, fmtPct(overallRate));
      setText(q('.spark-kpi-card[data-route="logs"] .sk-note'), '缓存命中占 ' + fmtPct(overallRate));
      setText(cacheNoteEl, activePools + ' 个活跃缓存池');
    }
    // 无任何缓存查询时保持原样（可能是「已关闭」，不覆盖）

    // 客户端数 / 域名数
    setText(q('#kpi-card-clients .sk-val'), fmtNum(clients));
    setText(q('#kpi-card-domains .sk-val'), fmtFull(domains));

    // 拦截请求
    setText(q('.spark-kpi-card[data-route="rules"] .sk-val'), fmtFull(adBlocked));
    if (isFinite(adBlocked) && totalQn > 0) {
      setText(q('.spark-kpi-card[data-route="rules"] .sk-note'),
        fmtPct(adBlocked / totalQn * 100) + ' 的请求被拦截');
    }

    // 平均响应
    setText(q('.spark-kpi-card[data-route="upstreams"] .sk-val'), fmtMs(avgMs));

    // 拓扑「02 引擎与多级缓存」：同步命中率、请求徽标与 5 条进度条
    var engineCard = q('.t-engine-card');
    if (engineCard && overallRate !== null) {
      var overall = overallRate;
      setText(q('.t-engine-card .tec-big'), overall.toFixed(1) + '%');
      setText(q('.t-engine-card .tec-badge'), isFinite(totalQ) ? fmtCompact(totalQ) + ' 请求' : null);
      setText(q('.t-engine-card .tec-desc'), '多级内存缓存命中 · ' + activePools + ' 个活跃缓存池');

      var rateOf = function (tag) {
        var tq = tagged['localdns_cache_query_total|' + tag];
        var th = tagged['localdns_cache_hit_total|' + tag];
        return isFinite(tq) && tq > 0 && isFinite(th) ? th / tq * 100 : 0;
      };
      var lazyRateOf = function (tag) {
        var tq = tagged['localdns_cache_query_total|' + tag];
        var tl = tagged['localdns_cache_lazy_hit_total|' + tag];
        return isFinite(tq) && tq > 0 && isFinite(tl) ? tl / tq * 100 : 0;
      };
      var rates = [
        overall,
        rateOf('cache_domestic'),
        rateOf('cache_foreign'),
        rateOf('cache_foreign_ecs'),
        Math.max(lazyRateOf('cache_main'), lazyRateOf('cache_domestic')),
      ];
      var rows = engineCard.querySelectorAll('.tec-bar-row');
      for (var bi = 0; bi < rows.length && bi < rates.length; bi++) {
        var fill = rows[bi].querySelector('.tec-bar-fill');
        var pctEl = rows[bi].querySelector('.tec-bar-pct');
        var w = Math.max(4, rates[bi]).toFixed(1) + '%';
        if (fill && fill.style.width !== w) fill.style.width = w;
        setText(pctEl, rates[bi].toFixed(1) + '%');
      }
    }

    // 右下浮动统计条
    if (isFinite(totalQ)) setText(q('#float-stat-top'), '↑ 累计 ' + fmtCompact(totalQ) + ' 次');
    if (isFinite(avgMs)) setText(q('#float-stat-bot'), '↓ ' + fmtMs(avgMs));
  }

  function run() {
    if (document.visibilityState !== 'visible') return;
    var onOverview = q('[data-service-metric="uptime"]') || q('.spark-kpi-card');
    if (!onOverview) return; // 仅概览页存在
    tick++;
    fetch('/metrics', { cache: 'no-store' })
      .then(function (r) { return r.text(); })
      .then(function (txt) {
        var m = parseProm(txt), now = Date.now();

        // 运行时长：每秒
        var start = m.flat['process_start_time_seconds'];
        if (start != null && isFinite(start)) {
          setHtml(q('[data-service-metric="uptime"] .service-uptime-value'), uptimeMarkup(now / 1000 - start));
        }

        // 业务 KPI：每秒就地更新（单个节点异常不影响其余脉冲）
        try { updateKpis(m); } catch (e) {}

        // CPU / 内存：每 2 秒
        if (tick % 2 === 0) {
          var cpu = m.flat['process_cpu_seconds_total'];
          var rss = m.flat['process_resident_memory_bytes'];
          if (cpu != null && isFinite(cpu)) {
            var pct = 0;
            if (lastCpuTotal != null && lastCpuAt != null && cpu >= lastCpuTotal && now > lastCpuAt) {
              var dt = (now - lastCpuAt) / 1000;
              if (dt > 0.4) pct = Math.max(0, Math.min(100, (cpu - lastCpuTotal) / dt * 100));
            }
            lastCpuTotal = cpu; lastCpuAt = now;
            setText(q('[data-service-metric="cpu"] [data-display-number]'), pct.toFixed(1) + '%');
          }
          if (rss != null && isFinite(rss)) {
            setText(q('[data-service-metric="memory"] [data-display-number]'), fmtBytes(rss));
          }
        }
      })
      .catch(function () {});
  }

  setInterval(run, 1000);
})();
