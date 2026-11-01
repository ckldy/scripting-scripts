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

  function q(sel, parent) {
    try {
      return (parent || document).querySelector(sel);
    } catch (e) {
      return null;
    }
  }

  function qq(sel, parent) {
    try {
      return Array.from((parent || document).querySelectorAll(sel));
    } catch (e) {
      return [];
    }
  }

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

  // ==================== 拓扑展示面积优化与阶段 06 出站执行 ====================

  var topoInjected = false;
  var isFitView = false;
  var isMaximized = false;
  var hideZeroFlow = false;
  var is3DView = false;
  try {
    is3DView = (typeof localStorage !== 'undefined' && localStorage.getItem('localdns_topo_view_mode') === '3d');
  } catch (_) {}

  var TOPO_3D_PRESETS = {
    isometric: { rx: 22, ry: -14, rz: 2, scale: 0.88, tx: 0, ty: 0, name: '斜视等轴' },
    topdown: { rx: 42, ry: 0, rz: 0, scale: 0.85, tx: 0, ty: 12, name: '立体俯瞰' },
    cinematic: { rx: 12, ry: -22, rz: 1, scale: 0.90, tx: -10, ty: -4, name: '深邃视角' }
  };

  var current3D = {
    rx: 22,
    ry: -14,
    rz: 2,
    scale: 0.88,
    tx: 0,
    ty: 0
  };

  function injectTopologyEnhanceStyles() {
    if (q('#topo-enhance-style')) return;
    var style = document.createElement('style');
    style.id = 'topo-enhance-style';
    style.textContent = [
      '/* LocalDNS 拓扑大图展示面积与全景自适应增强 */',
      '.topology-glass-card {',
      '  position: relative !important;',
      '  overflow-x: auto !important;',
      '  overflow-y: visible !important;',
      '  -webkit-overflow-scrolling: touch !important;',
      '  scroll-behavior: smooth !important;',
      '  padding: 18px 20px 24px !important;',
      '  transition: all 0.25s ease-out !important;',
      '}',
      '.topology-glass-card.is-maximized {',
      '  position: fixed !important;',
      '  inset: 10px !important;',
      '  z-index: 9999 !important;',
      '  max-width: none !important;',
      '  margin: 0 !important;',
      '  background: rgba(18, 20, 24, 0.94) !important;',
      '  backdrop-filter: blur(24px) !important;',
      '  -webkit-backdrop-filter: blur(24px) !important;',
      '  box-shadow: 0 24px 64px rgba(0,0,0,0.6) !important;',
      '  border-radius: 16px !important;',
      '}',
      '.topology-glass-card::-webkit-scrollbar {',
      '  height: 6px;',
      '}',
      '.topology-glass-card::-webkit-scrollbar-track {',
      '  background: rgba(148, 163, 184, 0.08);',
      '  border-radius: 999px;',
      '}',
      '.topology-glass-card::-webkit-scrollbar-thumb {',
      '  background: rgba(148, 163, 184, 0.35);',
      '  border-radius: 999px;',
      '}',
      '.topology-glass-card::-webkit-scrollbar-thumb:hover {',
      '  background: rgba(148, 163, 184, 0.6);',
      '}',
      '.topo-stage-wrap {',
      '  position: relative !important;',
      '  min-width: 1420px !important;',
      '  width: 1420px !important;',
      '  padding: 30px 10px 42px 10px !important;',
      '  box-sizing: border-box !important;',
      '  transform-origin: top left !important;',
      '  transition: transform 0.22s cubic-bezier(0.16, 1, 0.3, 1) !important;',
      '}',
      '.topo-grid {',
      '  grid-template-columns: repeat(6, minmax(210px, 1fr)) !important;',
      '  gap: 24px !important;',
      '  overflow: visible !important;',
      '}',
      '.topo-col {',
      '  min-width: 210px !important;',
      '}',
      '.topo-col-body {',
      '  display: flex !important;',
      '  flex-direction: column !important;',
      '  gap: 8px !important;',
      '  overflow: visible !important;',
      '}',
      '.t-node {',
      '  min-height: 56px !important;',
      '  padding: 8px 12px !important;',
      '  border-radius: 10px !important;',
      '}',
      '.console-topology-heading {',
      '  display: flex !important;',
      '  align-items: center !important;',
      '  justify-content: space-between !important;',
      '  flex-wrap: wrap !important;',
      '  gap: 12px !important;',
      '  margin-bottom: 14px !important;',
      '}',
      '.topo-controls {',
      '  display: inline-flex !important;',
      '  align-items: center !important;',
      '  gap: 6px !important;',
      '  flex-wrap: wrap !important;',
      '}',
      '.topo-ctrl-btn {',
      '  display: inline-flex !important;',
      '  align-items: center !important;',
      '  gap: 5px !important;',
      '  padding: 5px 11px !important;',
      '  font-size: 11px !important;',
      '  font-weight: 600 !important;',
      '  border-radius: 7px !important;',
      '  border: 1px solid rgba(148, 163, 184, 0.28) !important;',
      '  background: rgba(255, 255, 255, 0.05) !important;',
      '  color: inherit !important;',
      '  cursor: pointer !important;',
      '  user-select: none !important;',
      '  transition: all 0.15s !important;',
      '}',
      '.topo-ctrl-btn:hover {',
      '  background: rgba(148, 163, 184, 0.18) !important;',
      '  border-color: rgba(148, 163, 184, 0.45) !important;',
      '}',
      '.topo-ctrl-btn.active {',
      '  background: var(--color-primary, #B45309) !important;',
      '  color: #fff !important;',
      '  border-color: transparent !important;',
      '}',
      '.topo-stages-nav {',
      '  display: flex !important;',
      '  gap: 6px !important;',
      '  margin: 2px 0 16px !important;',
      '  overflow-x: auto !important;',
      '  padding-bottom: 4px !important;',
      '}',
      '.topo-stages-nav::-webkit-scrollbar { display: none; }',
      '.topo-stage-pill {',
      '  font-size: 11px !important;',
      '  padding: 4px 10px !important;',
      '  border-radius: 999px !important;',
      '  background: rgba(148, 163, 184, 0.1) !important;',
      '  border: 1px solid rgba(148, 163, 184, 0.2) !important;',
      '  color: inherit !important;',
      '  white-space: nowrap !important;',
      '  cursor: pointer !important;',
      '  transition: all 0.15s !important;',
      '}',
      '.topo-stage-pill:hover, .topo-stage-pill.active {',
      '  background: rgba(148, 163, 184, 0.25) !important;',
      '  border-color: var(--color-primary, #B45309) !important;',
      '}',
      '.t-node.t-loopback-node {',
      '  border: 1px dashed rgba(245, 158, 11, 0.45) !important;',
      '  background: rgba(245, 158, 11, 0.06) !important;',
      '  position: relative !important;',
      '  overflow: hidden !important;',
      '}',
      '.t-node.t-loopback-node:hover {',
      '  border-color: rgba(245, 158, 11, 0.9) !important;',
      '  background: rgba(245, 158, 11, 0.12) !important;',
      '}',
      '@keyframes topoDashLoop {',
      '  from { stroke-dashoffset: 0; }',
      '  to { stroke-dashoffset: -24px; }',
      '}',
      '.topo-particle.is-loopback {',
      '  fill: none !important;',
      '  stroke-width: 2.2 !important;',
      '  stroke-dasharray: 6 18 !important;',
      '  animation: topoDashLoop 1.6s linear infinite !important;',
      '}',
      '.topo-edge.is-loopback {',
      '  stroke-dasharray: 4 6 !important;',
      '  stroke-opacity: 0.55 !important;',
      '  stroke-width: 1.8 !important;',
      '}',
      '.topo-stage-wrap.is-compact .loopback-badge-group {',
      '  opacity: 0.35 !important;',
      '}',
      '.loopback-ribbon-text {',
      '  font-family: var(--font-sans, system-ui);',
      '  font-size: 10.5px !important;',
      '  font-weight: 600 !important;',
      '  letter-spacing: 0.03em !important;',
      '  user-select: none !important;',
      '  pointer-events: none !important;',
      '}',
      '.t-node[data-zero-flow="true"].is-hidden-zero {',
      '  display: none !important;',
      '}',
      '/* 3D 空间立体拓扑样式体系 */',
      '.topology-glass-card.is-3d-view {',
      '  perspective: 1600px !important;',
      '  perspective-origin: 50% 36% !important;',
      '  overflow: visible !important;',
      '  background: radial-gradient(circle at 50% 28%, rgba(30, 41, 59, 0.45) 0%, rgba(15, 23, 42, 0.92) 100%) !important;',
      '}',
      '.topo-stage-wrap.is-3d {',
      '  transform-style: preserve-3d !important;',
      '  transition: transform 0.22s cubic-bezier(0.16, 1, 0.3, 1) !important;',
      '  position: relative !important;',
      '}',
      '.topo-stage-wrap.is-3d.is-dragging {',
      '  transition: none !important;',
      '}',
      '.topo-stage-wrap.is-3d::before {',
      '  content: "" !important;',
      '  position: absolute !important;',
      '  inset: -60px -80px -40px -80px !important;',
      '  background-image:',
      '    linear-gradient(to right, rgba(59, 130, 246, 0.15) 1px, transparent 1px),',
      '    linear-gradient(to bottom, rgba(59, 130, 246, 0.15) 1px, transparent 1px) !important;',
      '  background-size: 44px 44px !important;',
      '  transform: translateZ(-60px) !important;',
      '  border-radius: 24px !important;',
      '  border: 1px solid rgba(59, 130, 246, 0.25) !important;',
      '  box-shadow: 0 0 80px rgba(59, 130, 246, 0.12) inset, 0 32px 70px rgba(0, 0, 0, 0.6) !important;',
      '  pointer-events: none !important;',
      '}',
      '.topo-stage-wrap.is-3d .topo-grid {',
      '  transform-style: preserve-3d !important;',
      '}',
      '.topo-stage-wrap.is-3d .topo-col {',
      '  transform-style: preserve-3d !important;',
      '}',
      '.topo-stage-wrap.is-3d .topo-col-title {',
      '  transform: translateZ(28px) !important;',
      '  text-shadow: 0 4px 12px rgba(0,0,0,0.6) !important;',
      '  letter-spacing: 0.04em !important;',
      '}',
      '.topo-stage-wrap.is-3d .t-node {',
      '  transform-style: preserve-3d !important;',
      '  transform: translateZ(36px) !important;',
      '  box-shadow: 0 16px 26px -4px rgba(0,0,0,0.48), 0 4px 10px -2px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.2) !important;',
      '  border-color: rgba(255,255,255,0.18) !important;',
      '  transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.2s !important;',
      '}',
      '.topo-stage-wrap.is-3d .t-node:hover {',
      '  transform: translateZ(56px) scale(1.025) !important;',
      '  box-shadow: 0 24px 38px -4px rgba(0,0,0,0.65), 0 0 24px rgba(59,130,246,0.35) !important;',
      '}',
      '.topo-stage-wrap.is-3d #topo-svg {',
      '  transform: translateZ(12px) !important;',
      '  overflow: visible !important;',
      '  filter: drop-shadow(0 8px 16px rgba(0,0,0,0.4)) !important;',
      '}',
      '.topo-stage-wrap.is-3d .loopback-badge-group {',
      '  transform: translateZ(64px) !important;',
      '}',
      '.topo-stage-wrap.is-3d .topo-edge.is-loopback {',
      '  stroke-width: 2.2 !important;',
      '  filter: drop-shadow(0 0 6px rgba(245, 158, 11, 0.5)) !important;',
      '}',
      '.topo-btn-view-group {',
      '  display: inline-flex !important;',
      '  background: rgba(255, 255, 255, 0.06) !important;',
      '  border: 1px solid rgba(148, 163, 184, 0.3) !important;',
      '  border-radius: 8px !important;',
      '  padding: 2px !important;',
      '  gap: 2px !important;',
      '}',
      '.topo-btn-view {',
      '  border: none !important;',
      '  background: transparent !important;',
      '  color: inherit !important;',
      '  padding: 4px 10px !important;',
      '  font-size: 11px !important;',
      '  font-weight: 600 !important;',
      '  border-radius: 6px !important;',
      '  cursor: pointer !important;',
      '  transition: all 0.15s !important;',
      '  user-select: none !important;',
      '}',
      '.topo-btn-view:hover {',
      '  background: rgba(255, 255, 255, 0.1) !important;',
      '}',
      '.topo-btn-view.active {',
      '  background: #2563EB !important;',
      '  color: #fff !important;',
      '  box-shadow: 0 2px 6px rgba(37, 99, 235, 0.4) !important;',
      '}',
      '.topo-3d-preset-bar {',
      '  display: inline-flex !important;',
      '  align-items: center !important;',
      '  gap: 4px !important;',
      '  background: rgba(15, 23, 42, 0.75) !important;',
      '  border: 1px solid rgba(59, 130, 246, 0.3) !important;',
      '  border-radius: 8px !important;',
      '  padding: 2px 6px !important;',
      '  font-size: 11px !important;',
      '  backdrop-filter: blur(12px) !important;',
      '  -webkit-backdrop-filter: blur(12px) !important;',
      '}',
      '.topo-3d-hint {',
      '  font-size: 11px !important;',
      '  color: #38BDF8 !important;',
      '  font-weight: 600 !important;',
      '  margin-right: 2px !important;',
      '  user-select: none !important;',
      '}',
      '.topo-btn-3d-preset {',
      '  padding: 3px 8px !important;',
      '  font-size: 10.5px !important;',
      '}'
    ].join('\n');
    document.head.appendChild(style);
  }

  function applyFitView(card, wrap) {
    if (!card || !wrap) return;
    if (isFitView) {
      var availableW = card.clientWidth - 40;
      var naturalW = 1420;
      var ratio = Math.max(0.25, Math.min(1, availableW / naturalW));
      var naturalH = wrap.offsetHeight || 520;
      wrap.style.transform = 'scale(' + ratio + ')';
      wrap.style.transformOrigin = 'top left';
      wrap.style.marginBottom = -Math.round((1 - ratio) * naturalH) + 'px';
      wrap.style.marginRight = -Math.round((1 - ratio) * naturalW) + 'px';
    } else {
      wrap.style.transform = '';
      wrap.style.transformOrigin = '';
      wrap.style.marginBottom = '';
      wrap.style.marginRight = '';
    }
  }

  function apply3DTransform(card, wrap) {
    if (!card || !wrap) return;
    if (!is3DView) {
      card.classList.remove('is-3d-view');
      wrap.classList.remove('is-3d');
      applyFitView(card, wrap);
      return;
    }
    card.classList.add('is-3d-view');
    wrap.classList.add('is-3d');

    var availableW = card.clientWidth - 40;
    var baseScale = Math.max(0.42, Math.min(0.96, availableW / 1420));
    var finalScale = (baseScale * (current3D.scale || 0.88)).toFixed(3);

    wrap.style.transformOrigin = 'center center';
    wrap.style.transform =
      'translate3d(' + current3D.tx + 'px, ' + current3D.ty + 'px, 0) ' +
      'rotateX(' + current3D.rx + 'deg) ' +
      'rotateY(' + current3D.ry + 'deg) ' +
      'rotateZ(' + current3D.rz + 'deg) ' +
      'scale3d(' + finalScale + ', ' + finalScale + ', ' + finalScale + ')';
    wrap.style.marginBottom = '';
    wrap.style.marginRight = '';
  }

  var is3DDragBound = false;
  function setup3DDragInteraction(card, wrap) {
    if (is3DDragBound || !card || !wrap) return;
    is3DDragBound = true;

    var isDragging = false;
    var startX = 0, startY = 0;
    var startRx = current3D.rx, startRy = current3D.ry;

    card.addEventListener('pointerdown', function (e) {
      if (!is3DView) return;
      if (e.target.closest('button, a, input, select, .topo-ctrl-btn, .topo-btn-view, .topo-stage-pill, .t-node')) return;
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      startRx = current3D.rx;
      startRy = current3D.ry;
      wrap.classList.add('is-dragging');
      card.style.cursor = 'grabbing';
      if (card.setPointerCapture) {
        try { card.setPointerCapture(e.pointerId); } catch (_) {}
      }
    });

    window.addEventListener('pointermove', function (e) {
      if (!isDragging || !is3DView) return;
      var dx = e.clientX - startX;
      var dy = e.clientY - startY;

      var newRy = startRy + dx * 0.22;
      var newRx = startRx - dy * 0.18;

      current3D.ry = Math.max(-55, Math.min(55, Math.round(newRy)));
      current3D.rx = Math.max(0, Math.min(70, Math.round(newRx)));

      qq('.topo-btn-3d-preset').forEach(function (btn) { btn.classList.remove('active'); });

      apply3DTransform(card, wrap);
    });

    function stopDrag(e) {
      if (!isDragging) return;
      isDragging = false;
      wrap.classList.remove('is-dragging');
      card.style.cursor = '';
      if (card.releasePointerCapture && e && e.pointerId) {
        try { card.releasePointerCapture(e.pointerId); } catch (_) {}
      }
    }

    window.addEventListener('pointerup', stopDrag);
    window.addEventListener('pointercancel', stopDrag);
  }

  function setupTopologyControls(card, wrap) {
    var heading = q('.console-topology-heading');
    if (!heading || q('.topo-controls', heading)) return;

    var controls = document.createElement('div');
    controls.className = 'topo-controls';
    controls.innerHTML = [
      '<div class="topo-btn-view-group" title="切换平面 / 3D 立体视图">',
      '  <button type="button" class="topo-btn-view ' + (!is3DView ? 'active' : '') + '" id="topo-btn-view-2d" title="经典平面视图 (2D)">',
      '    <span>🗺 平面</span>',
      '  </button>',
      '  <button type="button" class="topo-btn-view ' + (is3DView ? 'active' : '') + '" id="topo-btn-view-3d" title="空间立体视图 (3D 透视 · 按住空白拖拽自由旋转)">',
      '    <span>🧊 3D 立体</span>',
      '  </button>',
      '</div>',
      '<div class="topo-3d-preset-bar" id="topo-3d-preset-bar" style="' + (is3DView ? 'display:inline-flex' : 'display:none') + '">',
      '  <span class="topo-3d-hint">🧊 空间立体</span>',
      '  <button type="button" class="topo-ctrl-btn topo-btn-3d-preset active" data-preset="isometric">斜视等轴</button>',
      '  <button type="button" class="topo-ctrl-btn topo-btn-3d-preset" data-preset="topdown">俯瞰立体</button>',
      '  <button type="button" class="topo-ctrl-btn topo-btn-3d-preset" data-preset="cinematic">深邃视角</button>',
      '  <button type="button" class="topo-ctrl-btn" id="topo-btn-3d-reset" title="复位默认 3D 视角">🔄 复位</button>',
      '</div>',
      '<button type="button" class="topo-ctrl-btn" id="topo-btn-fit" title="自适应一屏全貌展示全部 6 个阶段">',
      '  <span>🔎 全貌</span>',
      '</button>',
      '<button type="button" class="topo-ctrl-btn" id="topo-btn-max" title="突破常规栅格限制，全屏铺满大图展示">',
      '  <span>⛶ 展开大图</span>',
      '</button>',
      '<button type="button" class="topo-ctrl-btn" id="topo-btn-compact" title="折叠 0 流量空闲分支，保持专注">',
      '  <span>⚡️ 仅看活跃</span>',
      '</button>'
    ].join('');
    heading.appendChild(controls);

    // 绑定 2D / 3D 视图切换
    var btnView2D = q('#topo-btn-view-2d');
    var btnView3D = q('#topo-btn-view-3d');
    var presetBar = q('#topo-3d-preset-bar');

    function switchViewMode(to3D) {
      is3DView = to3D;
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('localdns_topo_view_mode', is3DView ? '3d' : '2d');
        }
      } catch (_) {}
      if (btnView2D) btnView2D.classList.toggle('active', !is3DView);
      if (btnView3D) btnView3D.classList.toggle('active', is3DView);
      if (presetBar) presetBar.style.display = is3DView ? 'inline-flex' : 'none';
      if (is3DView) {
        toast('进入 3D 空间立体视图', '可按住空白处拖拽自由旋转视角');
      } else {
        toast('切回平面视图', '已恢复 2D 经典渲染布局');
      }
      apply3DTransform(card, wrap);
      window.dispatchEvent(new CustomEvent('localdns:layoutchange'));
    }

    if (btnView2D) {
      btnView2D.onclick = function () { switchViewMode(false); };
    }
    if (btnView3D) {
      btnView3D.onclick = function () { switchViewMode(true); };
    }

    // 绑定 3D 预设视角切换
    qq('.topo-btn-3d-preset', controls).forEach(function (btn) {
      btn.onclick = function () {
        var key = btn.dataset.preset;
        var p = TOPO_3D_PRESETS[key];
        if (!p) return;
        current3D.rx = p.rx;
        current3D.ry = p.ry;
        current3D.rz = p.rz;
        current3D.scale = p.scale;
        current3D.tx = p.tx;
        current3D.ty = p.ty;
        qq('.topo-btn-3d-preset', controls).forEach(function (b) { b.classList.toggle('active', b === btn); });
        apply3DTransform(card, wrap);
      };
    });

    // 绑定 3D 复位按钮
    var btnReset3D = q('#topo-btn-3d-reset');
    if (btnReset3D) {
      btnReset3D.onclick = function () {
        var p = TOPO_3D_PRESETS.isometric;
        current3D.rx = p.rx;
        current3D.ry = p.ry;
        current3D.rz = p.rz;
        current3D.scale = p.scale;
        current3D.tx = p.tx;
        current3D.ty = p.ty;
        qq('.topo-btn-3d-preset', controls).forEach(function (b) {
          b.classList.toggle('active', b.dataset.preset === 'isometric');
        });
        apply3DTransform(card, wrap);
      };
    }

    // 阶段导航胶囊条
    var nav = q('.topo-stages-nav', card);
    if (!nav) {
      nav = document.createElement('div');
      nav.className = 'topo-stages-nav';
      nav.setAttribute('role', 'navigation');
      nav.setAttribute('aria-label', '阶段快速平移导航');
      var stages = [
        { col: '1', title: '01 客户端来源' },
        { col: '2', title: '02 引擎多级缓存' },
        { col: '3', title: '03 分流规则集' },
        { col: '4', title: '04 上游策略组' },
        { col: '5', title: '05 DNS 解析节点' },
        { col: '6', title: '06 Surge 出站执行' }
      ];
      nav.innerHTML = stages.map(function (s) {
        return '<button type="button" class="topo-stage-pill" data-stage-col="' + s.col + '">' + s.title + '</button>';
      }).join('');
      heading.insertAdjacentElement('afterend', nav);

      // 绑定胶囊平移事件
      qq('.topo-stage-pill', nav).forEach(function (pill) {
        pill.onclick = function () {
          if (isFitView) {
            // 若在全貌模式下，先切回 1:1 细节再滚动
            isFitView = false;
            applyFitView(card, wrap);
            var btnFit = q('#topo-btn-fit');
            if (btnFit) btnFit.classList.remove('active');
          }
          var targetCol = q('.topo-col[data-col="' + pill.dataset.stageCol + '"]', card);
          if (targetCol) {
            card.scrollLeft = Math.max(0, targetCol.offsetLeft - 16);
          }
        };
      });

      // 监听卡片横向滚动，自动高亮最靠近的胶囊
      card.addEventListener('scroll', function () {
        var scrollLeft = card.scrollLeft;
        var cols = qq('.topo-col', card);
        var activeCol = '1';
        for (var i = 0; i < cols.length; i++) {
          if (cols[i].offsetLeft - 60 <= scrollLeft) {
            activeCol = cols[i].dataset.col || '1';
          }
        }
        qq('.topo-stage-pill', nav).forEach(function (p) {
          p.classList.toggle('active', p.dataset.stageCol === activeCol);
        });
      }, { passive: true });
    }

    // 绑定全貌切换事件
    var btnFit = q('#topo-btn-fit');
    if (btnFit) {
      btnFit.onclick = function () {
        isFitView = !isFitView;
        btnFit.classList.toggle('active', isFitView);
        btnFit.innerHTML = isFitView ? '<span>🔍 1:1 细节</span>' : '<span>🔎 全貌</span>';
        applyFitView(card, wrap);
        window.dispatchEvent(new CustomEvent('localdns:layoutchange'));
      };
    }

    // 绑定展开大图事件
    var btnMax = q('#topo-btn-max');
    if (btnMax) {
      btnMax.onclick = function () {
        isMaximized = !isMaximized;
        card.classList.toggle('is-maximized', isMaximized);
        btnMax.classList.toggle('active', isMaximized);
        btnMax.innerHTML = isMaximized ? '<span>⛶ 还原视窗</span>' : '<span>⛶ 展开大图</span>';
        if (isFitView) applyFitView(card, wrap);
        window.dispatchEvent(new CustomEvent('localdns:layoutchange'));
        window.dispatchEvent(new Event('resize'));
      };
    }

    // 绑定折叠空闲事件
    var btnCompact = q('#topo-btn-compact');
    if (btnCompact) {
      btnCompact.onclick = function () {
        hideZeroFlow = !hideZeroFlow;
        btnCompact.classList.toggle('active', hideZeroFlow);
        wrap.classList.toggle('is-compact', hideZeroFlow);
        qq('.t-node[data-zero-flow="true"]', card).forEach(function (node) {
          node.classList.toggle('is-hidden-zero', hideZeroFlow);
        });
        window.dispatchEvent(new CustomEvent('localdns:layoutchange'));
      };
    }

    window.addEventListener('resize', function () {
      if (is3DView) apply3DTransform(card, wrap);
      else if (isFitView) applyFitView(card, wrap);
    }, { passive: true });

    setup3DDragInteraction(card, wrap);
  }

  var cachedTopologyData = null;
  var observedSvgEl = null;
  var isRenderingLoop = false;

  function updateDynamicTopology() {
    var card = q('.topology-glass-card');
    var wrap = q('#topo-stage-wrap');
    var grid = q('.topo-grid');
    var svg = q('#topo-svg');
    if (!card || !wrap || !grid || !svg) return;

    // 注入增强 CSS 与控制工具条
    injectTopologyEnhanceStyles();
    setupTopologyControls(card, wrap);
    apply3DTransform(card, wrap);

    // 1. 动态注入阶段 06：出站执行 (Surge 节点与阻断) 及 回环清洗自愈节点
    var col6 = q('.topo-col[data-col="6"]');
    if (!col6) {
      col6 = document.createElement('div');
      col6.className = 'topo-col';
      col6.dataset.col = '6';
      col6.innerHTML = [
        '<div class="topo-col-title"><span>06</span>出站执行 (Surge)</div>',
        '<div class="topo-col-body">',
        '  <div class="t-node" data-node-id="out_direct" data-outbound="direct" title="国内直连服务/直连 IP 直达运营商出口">',
        '    <div class="tn-left">',
        '      <div class="tn-icon-box" style="color:#10B981;background:rgba(16,185,129,0.12)">⚡️</div>',
        '      <div class="tn-meta">',
        '        <div class="tn-name">DIRECT 直连</div>',
        '        <div class="tn-sub" id="topo-direct-sub">0 次 (0.0%) · 本地直出</div>',
        '      </div>',
        '    </div>',
        '    <span class="tn-val" id="topo-direct-val" style="color:#10B981">直连 0%</span>',
        '  </div>',
        '  <div class="t-node" data-node-id="out_proxy" data-outbound="proxy" title="Surge 代理通道，支持智能选路与节点动态加速">',
        '    <div class="tn-left">',
        '      <div class="tn-icon-box" style="color:#3B82F6;background:rgba(59,130,246,0.12)">✈️</div>',
        '      <div class="tn-meta">',
        '        <div class="tn-name" id="topo-surge-node-name">PROXY 代理</div>',
        '        <div class="tn-sub" id="topo-surge-node-sub">0 次 (0.0%) · 模式: RULE</div>',
        '      </div>',
        '    </div>',
        '    <span class="tn-val" id="topo-surge-node-val" style="color:#3B82F6">加速 0%</span>',
        '  </div>',
        '  <div class="t-node" data-node-id="out_block" data-outbound="block" title="0.0.0.0 纳秒阻断，主动调用 Surge HTTP API 掐断活跃长连接">',
        '    <div class="tn-left">',
        '      <div class="tn-icon-box" style="color:#EF4444;background:rgba(239,68,68,0.12)">🛑</div>',
        '      <div class="tn-meta">',
        '        <div class="tn-name">BLK 拦截</div>',
        '        <div class="tn-sub" id="topo-block-sub">0 次 (0.0%) · 纳秒拦截</div>',
        '      </div>',
        '    </div>',
        '    <span class="tn-val" id="topo-block-val" style="color:#EF4444">阻断 0%</span>',
        '  </div>',
        '  <div class="t-node t-loopback-node" data-node-id="out_loopback" data-outbound="loopback" title="回环清洗与自愈：Surge 模块广告规则沉淀入库为本地 DNS 拦截；出站故障自动反哺自愈学习">',
        '    <div class="tn-left">',
        '      <div class="tn-icon-box" style="color:#F59E0B;background:rgba(245,158,11,0.14)">🔄</div>',
        '      <div class="tn-meta">',
        '        <div class="tn-name">回环清洗与自愈</div>',
        '        <div class="tn-sub" id="topo-loop-sub">脱水 0 规则 · 自愈 0 域名</div>',
        '      </div>',
        '    </div>',
        '    <span class="tn-val" id="topo-loop-val" style="color:#F59E0B">闭环运转</span>',
        '  </div>',
        '</div>'
      ].join('');
      grid.appendChild(col6);
      topoInjected = true;
      window.dispatchEvent(new CustomEvent('localdns:layoutchange'));
    }

    // 2. 拉取后端动态拓扑与真实出站数据，更新阶段 06 状态与自愈标记
    fetch('/api/v1/topology/flow', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data || !data.success) return;
        cachedTopologyData = data;

        // 更新真实出站与 Surge 状态数据
        var ob = data.outbound;
        var s = data.surge || { online: false, mode: 'rule', activePolicy: 'PROXY' };

        if (ob && ob.direct) {
          setText(q('#topo-direct-sub'), fmtNum(ob.direct.count) + ' 次 (' + ob.direct.pct + ') · 本地直出');
          setText(q('#topo-direct-val'), '直连 ' + ob.direct.pct);
        }
        if (ob && ob.proxy) {
          var proxySub = fmtNum(ob.proxy.count) + ' 次 (' + ob.proxy.pct + ') · ' + (s.online ? ('模式: ' + (s.mode || 'rule').toUpperCase()) : '代理通道');
          setText(q('#topo-surge-node-sub'), proxySub);
          setText(q('#topo-surge-node-name'), s.online ? 'PROXY · 在线' : 'PROXY 代理');
          setText(q('#topo-surge-node-val'), (s.online ? '加速 ' : '就绪 ') + ob.proxy.pct);
        }
        if (ob && ob.block) {
          setText(q('#topo-block-sub'), fmtNum(ob.block.count) + ' 次 (' + ob.block.pct + ') · 0.0.0.0 拦截');
          setText(q('#topo-block-val'), '阻断 ' + ob.block.pct);
        }
        if (ob && ob.loopback) {
          var cleanTxt = '脱水 ' + fmtNum(ob.loopback.cleaned_rules) + ' 规则 · 自愈 ' + fmtNum(ob.loopback.healed_count) + ' 域名';
          setText(q('#topo-loop-sub'), cleanTxt);
          setText(q('#topo-loop-val'), ob.loopback.status || '闭环运转');
        }

        // 零流量标记与「仅看活跃」折叠联动
        var zeroMap = {
          out_direct: !(ob && ob.direct && ob.direct.count > 0),
          out_proxy: !(ob && ob.proxy && ob.proxy.count > 0),
          out_block: !(ob && ob.block && ob.block.count > 0),
          out_loopback: !(ob && ob.loopback && ob.loopback.cleaned_rules > 0)
        };
        Object.keys(zeroMap).forEach(function (nid) {
          var node = wrap.querySelector('[data-node-id="' + nid + '"]');
          if (!node) return;
          node.setAttribute('data-zero-flow', zeroMap[nid] ? 'true' : 'false');
          node.classList.toggle('is-hidden-zero', hideZeroFlow && zeroMap[nid]);
        });

        // 更新自愈信息
        if (data.self_healing && data.self_healing.healed_recent_count > 0) {
          var healedNode = q('[data-node-id="r4"] .tn-sub');
          if (healedNode) setText(healedNode, '已自愈 ' + data.self_healing.healed_recent_count + ' 域名');
        }

        // 3. 动态绘制延伸至阶段 06 出站及闭环反哺回环的贝塞尔流光连线
        renderStage6AndLoopback(wrap, svg);
      })
      .catch(function () {
        renderStage6AndLoopback(wrap, svg);
      });
  }

  function renderStage6AndLoopback(wrap, svg) {
    if (!wrap || !svg || isRenderingLoop) return;
    isRenderingLoop = true;
    try {
      var wrapRect = wrap.getBoundingClientRect();
      if (!wrapRect.width || !wrapRect.height) return;

    var layer = svg.querySelector('#topo-s6-loopback-layer');
    if (!layer) {
      layer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      layer.id = 'topo-s6-loopback-layer';
      svg.appendChild(layer);
    }

    var html = '';

    function makePath(x1, y1, x2, y2, color, isLoop, loopDirection, label, labelColor) {
      if (isNaN(x1) || isNaN(y1) || isNaN(x2) || isNaN(y2)) return;
      var d = '';
      if (!isLoop) {
        var dx = (x2 - x1) * 0.54;
        d = 'M ' + x1.toFixed(1) + ' ' + y1.toFixed(1) + ' C ' + (x1 + dx).toFixed(1) + ' ' + y1.toFixed(1) + ', ' + (x2 - dx).toFixed(1) + ' ' + y2.toFixed(1) + ', ' + x2.toFixed(1) + ' ' + y2.toFixed(1);
      } else if (loopDirection === 'top') {
        var topY = 16;
        d = 'M ' + x1.toFixed(1) + ' ' + y1.toFixed(1) + ' C ' + (x1 - 180).toFixed(1) + ' ' + topY + ', ' + (x2 + 180).toFixed(1) + ' ' + topY + ', ' + x2.toFixed(1) + ' ' + y2.toFixed(1);
      } else {
        var botY = Math.max(wrapRect.height - 18, y1 + 35);
        d = 'M ' + x1.toFixed(1) + ' ' + y1.toFixed(1) + ' C ' + (x1 - 200).toFixed(1) + ' ' + botY + ', ' + (x2 + 200).toFixed(1) + ' ' + botY + ', ' + x2.toFixed(1) + ' ' + y2.toFixed(1);
      }

      var loopCls = isLoop ? ' is-loopback' : '';
      html += '<path class="topo-halo' + loopCls + '" d="' + d + '" stroke="' + color + '" />';
      html += '<path class="topo-glow' + loopCls + '" d="' + d + '" stroke="' + color + '" />';
      html += '<path class="topo-particle' + loopCls + '" d="' + d + '" stroke="' + color + '" />';
      html += '<path class="topo-edge' + loopCls + '" d="' + d + '" stroke="' + color + '" stroke-opacity="' + (isLoop ? '0.75' : '0.45') + '" fill="none" stroke-width="' + (isLoop ? '1.8' : '1.5') + '" />';
      html += '<circle class="topo-dot-halo" cx="' + x1.toFixed(1) + '" cy="' + y1.toFixed(1) + '" r="3.6" fill="' + color + '" />';
      html += '<circle class="topo-dot" cx="' + x1.toFixed(1) + '" cy="' + y1.toFixed(1) + '" r="2.2" fill="' + color + '" />';
      html += '<circle class="topo-dot-halo" cx="' + x2.toFixed(1) + '" cy="' + y2.toFixed(1) + '" r="3.6" fill="' + color + '" />';
      html += '<circle class="topo-dot" cx="' + x2.toFixed(1) + '" cy="' + y2.toFixed(1) + '" r="2.2" fill="' + color + '" />';

      if (label) {
        var lx = (x1 + x2) / 2;
        var ly = loopDirection === 'top' ? 16 : (wrapRect.height - 18);
        var pillW = 220, pillH = 22;
        var pillX = lx - pillW / 2;
        var pillY = ly - pillH / 2;
        html += '<g class="loopback-badge-group">' +
          '<rect x="' + pillX.toFixed(1) + '" y="' + pillY.toFixed(1) + '" width="' + pillW + '" height="' + pillH + '" rx="' + (pillH / 2) + '" fill="rgba(15,23,42,0.92)" stroke="' + (labelColor || color) + '" stroke-width="1.2" />' +
          '<text x="' + lx.toFixed(1) + '" y="' + (pillY + 14.5).toFixed(1) + '" text-anchor="middle" fill="' + (labelColor || color) + '" class="loopback-ribbon-text">' + label + '</text>' +
          '</g>';
      }
    }

    var outDirect = wrap.querySelector('[data-node-id="out_direct"]');
    var outProxy = wrap.querySelector('[data-node-id="out_proxy"]');
    var outBlock = wrap.querySelector('[data-node-id="out_block"]');
    var outLoopback = wrap.querySelector('[data-node-id="out_loopback"]');
    if (!outDirect || !outProxy || !outBlock) return;

    var rd = outDirect.getBoundingClientRect();
    var rp = outProxy.getBoundingClientRect();
    var rb = outBlock.getBoundingClientRect();
    var rl = outLoopback ? outLoopback.getBoundingClientRect() : null;

    var directLeft = { x: rd.left - wrapRect.left, y: rd.top + rd.height / 2 - wrapRect.top };
    var proxyLeft = { x: rp.left - wrapRect.left, y: rp.top + rp.height / 2 - wrapRect.top };
    var blockLeft = { x: rb.left - wrapRect.left, y: rb.top + rb.height / 2 - wrapRect.top };

    // 1. Stage 05 (上游 DNS 节点) ➔ Stage 06 出站执行 (DIRECT / PROXY)
    var serverNodes = wrap.querySelectorAll('.topo-col[data-col="5"] .t-node');
    if (serverNodes.length > 0) {
      var mid = Math.ceil(serverNodes.length / 2);
      serverNodes.forEach(function (sNode, idx) {
        var sr = sNode.getBoundingClientRect();
        if (!sr.width || !sr.height) return;
        var sx = sr.right - wrapRect.left;
        var sy = sr.top + sr.height / 2 - wrapRect.top;
        if (idx < mid) {
          // 国内策略上游 ➔ DIRECT 直连
          makePath(sx, sy, directLeft.x, directLeft.y, '#10B981', false);
        } else {
          // 国外/代理上游 ➔ PROXY 代理
          makePath(sx, sy, proxyLeft.x, proxyLeft.y, '#3B82F6', false);
        }
      });
    }

    // 2. Stage 03 拦截规则 (r6 / 广告黑名单) ➔ Stage 06 BLK 阻断
    var ruleBlock = wrap.querySelector('[data-node-id="r6"]') || wrap.querySelector('.topo-col[data-col="3"] .t-node:last-child');
    if (ruleBlock) {
      var rbr = ruleBlock.getBoundingClientRect();
      if (rbr.width && rbr.height) {
        var rbx = rbr.right - wrapRect.left;
        var rby = rbr.top + rbr.height / 2 - wrapRect.top;
        makePath(rbx, rby, blockLeft.x, blockLeft.y, '#EF4444', false);
      }
    }

    // 3. Stage 06 汇聚至回环控制节点
    if (rl && outLoopback) {
      var loopLeft = { x: rl.left - wrapRect.left, y: rl.top + rl.height / 2 - wrapRect.top };
      var dirRight = { x: rd.right - wrapRect.left, y: rd.top + rd.height / 2 - wrapRect.top };
      var prxRight = { x: rp.right - wrapRect.left, y: rp.top + rp.height / 2 - wrapRect.top };
      var blkRight = { x: rb.right - wrapRect.left, y: rb.top + rb.height / 2 - wrapRect.top };

      makePath(dirRight.x, dirRight.y, loopLeft.x, loopLeft.y, '#10B981', false);
      makePath(prxRight.x, prxRight.y, loopLeft.x, loopLeft.y, '#3B82F6', false);
      makePath(blkRight.x, blkRight.y, loopLeft.x, loopLeft.y, '#EF4444', false);
    }

    // 4. 顶部回环清洗链路：06 出站 ➔ 02 核心引擎 / 03 规则拦截 (脱水清洗 · 沉淀入库)
    var eCore = wrap.querySelector('[data-node-id="e_core"]');
    if (eCore) {
      var ecr = eCore.getBoundingClientRect();
      if (ecr.width && ecr.height) {
        var ecTop = { x: ecr.left + ecr.width / 2 - wrapRect.left, y: ecr.top - wrapRect.top };
        var srcBlock = rl ? { x: rl.right - wrapRect.left, y: rl.top - wrapRect.top } : { x: rb.right - wrapRect.left, y: rb.top - wrapRect.top };
        makePath(srcBlock.x, srcBlock.y, ecTop.x, ecTop.y, '#EF4444', true, 'top', '⚡️ 06 ➔ 02 回环清洗 · 沉淀入库 (DNS拦截)', '#EF4444');
      }
    }

    // 5. 底部闭环交付链路：06 出站 ➔ 01 客户端来源 (闭环完成 · 数据交付)
    var c1Node = wrap.querySelector('.topo-col[data-col="1"] .t-node');
    if (c1Node) {
      var c1r = c1Node.getBoundingClientRect();
      if (c1r.width && c1r.height) {
        var c1Bot = { x: c1r.left + c1r.width / 2 - wrapRect.left, y: c1r.bottom - wrapRect.top };
        var srcDirect = rl ? { x: rl.right - wrapRect.left, y: rl.bottom - wrapRect.top } : { x: rd.right - wrapRect.left, y: rd.bottom - wrapRect.top };
        makePath(srcDirect.x, srcDirect.y, c1Bot.x, c1Bot.y, '#10B981', true, 'bottom', '🔄 06 ➔ 01 闭环交付 · 数据回传完成', '#10B981');
      }
    }

    // 6. 自愈反哺链路：06 PROXY ➔ 03 r4 灰名单自愈
    if (cachedTopologyData && cachedTopologyData.self_healing && cachedTopologyData.self_healing.healed_recent_count > 0) {
      var r4Node = wrap.querySelector('[data-node-id="r4"]');
      if (r4Node) {
        var r4r = r4Node.getBoundingClientRect();
        if (r4r.width && r4r.height) {
          var r4Top = { x: r4r.left + r4r.width / 2 - wrapRect.left, y: r4r.top - wrapRect.top };
          var prxTop = { x: rp.right - wrapRect.left, y: rp.top - wrapRect.top };
          makePath(prxTop.x, prxTop.y, r4Top.x, r4Top.y, '#F59E0B', true, 'top', '🔄 06 ➔ 03 自愈反哺 · 动态容灾', '#F59E0B');
        }
      }
    }

    layer.innerHTML = html;

    // 防止 SPA 重绘抹除图层：按当前 SVG 元素绑定（SPA 重绘会替换 #topo-svg）
    if (observedSvgEl !== svg) {
      observedSvgEl = svg;
      var obs = new MutationObserver(function () {
        if (svg.isConnected && !svg.querySelector('#topo-s6-loopback-layer')) {
          renderStage6AndLoopback(wrap, svg);
        }
      });
      obs.observe(svg, { childList: true });
    }
    } finally {
      isRenderingLoop = false;
    }
  }

  function run() {
    var onOverview = q('[data-service-metric="uptime"]') || q('.spark-kpi-card');
    if (!onOverview) return; // 仅概览页存在
    tick++;

    // 拓扑增强初始化与出站更新：首次进入立刻执行，后续每 3 秒刷新
    if (!topoInjected || tick % 3 === 0) {
      try { updateDynamicTopology(); } catch (e) {}
    }

    if (document.visibilityState === 'hidden') return;
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
