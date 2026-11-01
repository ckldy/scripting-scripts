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
  var isSphereMode = false;
  try {
    isSphereMode = (typeof localStorage !== 'undefined' && localStorage.getItem('localdns_topo_view_mode') === 'sphere');
  } catch (_) {}

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
      '/* 3D 闭环球体拓扑系统样式体系 */',
      '.topology-glass-card.is-sphere-mode {',
      '  overflow-x: hidden !important;',
      '  width: 100% !important;',
      '  min-width: 0 !important;',
      '  padding: 16px 20px 24px !important;',
      '}',
      '.topology-glass-card.is-sphere-mode #topo-stage-wrap {',
      '  display: none !important;',
      '}',
      '.topo-sphere-viewport {',
      '  position: relative !important;',
      '  grid-column: 1 / -1 !important;',
      '  width: 100% !important;',
      '  height: 600px !important;',
      '  min-height: 520px !important;',
      '  margin-top: 10px !important;',
      '  overflow: hidden !important;',
      '  border-radius: 16px !important;',
      '  background: radial-gradient(circle at 50% 50%, rgba(15, 23, 42, 0.5) 0%, rgba(2, 6, 23, 0.98) 100%) !important;',
      '  box-shadow: inset 0 0 100px rgba(0, 0, 0, 0.8), 0 12px 36px rgba(0, 0, 0, 0.5) !important;',
      '  border: 1px solid rgba(59, 130, 246, 0.3) !important;',
      '  cursor: grab !important;',
      '  user-select: none !important;',
      '  touch-action: none !important;',
      '}',
      '.topology-glass-card.is-maximized .topo-sphere-viewport {',
      '  height: calc(100vh - 140px) !important;',
      '}',
      '.topo-sphere-viewport:active {',
      '  cursor: grabbing !important;',
      '}',
      '#topo-sphere-canvas {',
      '  position: absolute !important;',
      '  left: 0 !important;',
      '  top: 0 !important;',
      '  width: 100% !important;',
      '  height: 100% !important;',
      '  pointer-events: none !important;',
      '}',
      '.topo-sphere-nodes {',
      '  position: absolute !important;',
      '  left: 0 !important;',
      '  top: 0 !important;',
      '  width: 100% !important;',
      '  height: 100% !important;',
      '  pointer-events: none !important;',
      '}',
      '.topo-s-node {',
      '  position: absolute !important;',
      '  left: 0 !important;',
      '  top: 0 !important;',
      '  margin: 0 !important;',
      '  pointer-events: auto !important;',
      '  transform-origin: center center !important;',
      '  box-sizing: border-box !important;',
      '}',
      '.topo-s-node-inner {',
      '  display: flex !important;',
      '  align-items: center !important;',
      '  gap: 7px !important;',
      '  padding: 6px 11px !important;',
      '  border-radius: 9px !important;',
      '  background: rgba(15, 23, 42, 0.92) !important;',
      '  backdrop-filter: blur(16px) !important;',
      '  -webkit-backdrop-filter: blur(16px) !important;',
      '  border: 1px solid rgba(148, 163, 184, 0.35) !important;',
      '  box-shadow: 0 10px 24px -4px rgba(0, 0, 0, 0.8), 0 0 12px rgba(59, 130, 246, 0.25) !important;',
      '  cursor: pointer !important;',
      '  white-space: nowrap !important;',
      '  transition: transform 0.18s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.18s, border-color 0.18s !important;',
      '}',
      '.topo-s-node:hover .topo-s-node-inner {',
      '  transform: scale(1.14) !important;',
      '  border-color: #38BDF8 !important;',
      '  box-shadow: 0 16px 36px -4px rgba(0, 0, 0, 0.95), 0 0 28px rgba(56, 189, 248, 0.7) !important;',
      '}',
      '.topo-s-node.is-back {',
      '  pointer-events: none !important;',
      '}',
      '.topo-s-node.is-focused .topo-s-node-inner {',
      '  border-color: #F59E0B !important;',
      '  box-shadow: 0 0 30px rgba(245, 158, 11, 0.8) !important;',
      '  transform: scale(1.15) !important;',
      '}',
      '.topo-s-icon {',
      '  width: 22px !important;',
      '  height: 22px !important;',
      '  display: flex !important;',
      '  align-items: center !important;',
      '  justify-content: center !important;',
      '  border-radius: 6px !important;',
      '  font-size: 11px !important;',
      '  flex-shrink: 0 !important;',
      '}',
      '.topo-s-meta {',
      '  display: flex !important;',
      '  flex-direction: column !important;',
      '  gap: 1px !important;',
      '}',
      '.topo-s-name {',
      '  font-size: 11px !important;',
      '  font-weight: 700 !important;',
      '  color: #F8FAFC !important;',
      '  line-height: 1.2 !important;',
      '}',
      '.topo-s-val {',
      '  font-size: 10px !important;',
      '  font-weight: 600 !important;',
      '  line-height: 1.1 !important;',
      '}',
      '.topo-sphere-hud {',
      '  position: absolute !important;',
      '  bottom: 12px !important;',
      '  left: 14px !important;',
      '  display: flex !important;',
      '  align-items: center !important;',
      '  gap: 8px !important;',
      '  background: rgba(15, 23, 42, 0.8) !important;',
      '  backdrop-filter: blur(10px) !important;',
      '  -webkit-backdrop-filter: blur(10px) !important;',
      '  padding: 5px 12px !important;',
      '  border-radius: 20px !important;',
      '  border: 1px solid rgba(59, 130, 246, 0.35) !important;',
      '  font-size: 11px !important;',
      '  pointer-events: none !important;',
      '  user-select: none !important;',
      '}',
      '.topo-sphere-tag {',
      '  font-weight: 700 !important;',
      '  color: #38BDF8 !important;',
      '  letter-spacing: 0.02em !important;',
      '}',
      '.topo-sphere-tip {',
      '  color: #94A3B8 !important;',
      '  font-size: 10.5px !important;',
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
      '.topo-sphere-bar {',
      '  display: inline-flex !important;',
      '  align-items: center !important;',
      '  gap: 4px !important;',
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

  // ==================== 3D 闭环球体拓扑系统 (Spherical 3D Closed-Loop Topology) ====================

  var sphereEngineInstance = null;

  function getOrCreateSphereEngine(card, wrap) {
    if (sphereEngineInstance) return sphereEngineInstance;

    var viewport = q('#topo-sphere-viewport');
    if (!viewport) {
      viewport = document.createElement('div');
      viewport.className = 'topo-sphere-viewport';
      viewport.id = 'topo-sphere-viewport';
      viewport.style.display = isSphereMode ? 'block' : 'none';
      viewport.innerHTML = [
        '<canvas id="topo-sphere-canvas"></canvas>',
        '<div class="topo-sphere-nodes" id="topo-sphere-nodes"></div>',
        '<div class="topo-sphere-hud">',
        '  <span class="topo-sphere-tag">🌐 3D 闭环全息球体</span>',
        '  <span class="topo-sphere-tip">360° 任意拖拽自由旋转 · 滚轮缩放 · 点击节点聚焦</span>',
        '</div>'
      ].join('');
      wrap.insertAdjacentElement('beforebegin', viewport);
    }

    var canvas = q('#topo-sphere-canvas', viewport);
    var ctx = canvas.getContext('2d');
    var nodesContainer = q('#topo-sphere-nodes', viewport);

    var rotMatrix = [
      0.91, 0.08, -0.40,
      -0.12, 0.99, -0.07,
      0.39, 0.11, 0.91
    ];
    var sphereRadius = 240;
    var targetRadius = 240;
    var isAutoSpin = true;
    var isDragging = false;
    var lastX = 0, lastY = 0;
    var velX = 0, velY = 0;
    var flowPhase = 0;
    var animId = null;
    var isRunning = false;
    var sphereNodes = [];
    var sphereLinks = [];

    function mat3Mul(a, b) {
      var r = new Array(9);
      for (var i = 0; i < 3; i++) {
        for (var j = 0; j < 3; j++) {
          r[i * 3 + j] =
            a[i * 3 + 0] * b[0 * 3 + j] +
            a[i * 3 + 1] * b[1 * 3 + j] +
            a[i * 3 + 2] * b[2 * 3 + j];
        }
      }
      return r;
    }

    function mat3VecMul(m, v) {
      return [
        m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
        m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
        m[6] * v[0] + m[7] * v[1] + m[8] * v[2]
      ];
    }

    function makeRotationMatrix(ax, ay, az, angle) {
      var c = Math.cos(angle);
      var s = Math.sin(angle);
      var t = 1 - c;
      return [
        t * ax * ax + c,      t * ax * ay - s * az, t * ax * az + s * ay,
        t * ax * ay + s * az, t * ay * ay + c,      t * ay * az - s * ax,
        t * ax * az - s * ay, t * ay * az + s * ax, t * az * az + c
      ];
    }

    function normalizeMat3(m) {
      var x = [m[0], m[3], m[6]];
      var y = [m[1], m[4], m[7]];
      function len(v) { return Math.sqrt(v[0]*v[0] + v[1]*v[1] + v[2]*v[2]) || 1; }
      function norm(v) { var l = len(v); return [v[0]/l, v[1]/l, v[2]/l]; }
      function dot(a, b) { return a[0]*b[0] + a[1]*b[1] + a[2]*b[2]; }
      function cross(a, b) { return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]; }
      x = norm(x);
      var dxy = dot(x, y);
      y = norm([y[0] - dxy * x[0], y[1] - dxy * x[1], y[2] - dxy * x[2]]);
      var z = norm(cross(x, y));
      return [x[0], y[0], z[0], x[1], y[1], z[1], x[2], y[2], z[2]];
    }

    var STAGE_LONGS = [
      0,
      55 * Math.PI / 180,
      115 * Math.PI / 180,
      175 * Math.PI / 180,
      235 * Math.PI / 180,
      295 * Math.PI / 180
    ];

    function syncNodesFromDOM() {
      sphereNodes = [];
      sphereLinks = [];
      var stageNodeMap = {};

      for (var col = 1; col <= 6; col++) {
        var colEl = q('.topo-col[data-col="' + col + '"]', wrap);
        if (!colEl) continue;
        var nodeEls = qq('.t-node', colEl);
        if (nodeEls.length === 0) continue;
        stageNodeMap[col] = [];

        var theta = STAGE_LONGS[col - 1];
        var count = nodeEls.length;

        for (var idx = 0; idx < count; idx++) {
          var el = nodeEls[idx];
          var name = (q('.tn-name', el) && q('.tn-name', el).textContent.trim()) || '节点';
          var val = (q('.tn-val', el) && q('.tn-val', el).textContent.trim()) || '';
          var sub = (q('.tn-sub', el) && q('.tn-sub', el).textContent.trim()) || '';
          var icon = (q('.tn-icon-box', el) && q('.tn-icon-box', el).textContent.trim()) || '⚡️';
          var valColor = (q('.tn-val', el) && q('.tn-val', el).style.color) || '#38BDF8';
          var nodeId = el.dataset.nodeId || ('node_' + col + '_' + idx);
          var isLoop = el.classList.contains('t-loopback-node') || el.dataset.outbound === 'loopback';

          var phi = 0;
          if (count > 1) {
            var phiRange = Math.min(0.85, 0.28 * count);
            phi = -phiRange / 2 + (phiRange / (count - 1)) * idx;
          }

          var nodeData = {
            id: nodeId,
            stage: col,
            index: idx,
            name: name,
            val: val,
            sub: sub,
            icon: icon,
            valColor: valColor,
            isLoop: isLoop,
            theta: theta,
            phi: phi,
            domEl: null
          };
          sphereNodes.push(nodeData);
          stageNodeMap[col].push(nodeData);
        }
      }

      // 保底机制：若 DOM 提取节点数少于 10 个，使用完整全阶段闭环蓝图
      if (sphereNodes.length < 10) {
        sphereNodes = [];
        sphereLinks = [];
        stageNodeMap = {};

        var ob = (cachedTopologyData && cachedTopologyData.outbound) || {};
        var s = (cachedTopologyData && cachedTopologyData.surge) || { online: false };

        var BLUEPRINT = [
          {
            stage: 1,
            nodes: [
              { id: 'c_lan', name: '局域网客户端', val: '192.168.x', sub: '活跃接入', icon: '💻', valColor: '#3B82F6' },
              { id: 'c_local', name: '本机回环', val: '127.0.0.1', sub: '高频解析', icon: '📱', valColor: '#10B981' },
              { id: 'c_tun', name: 'TUN 虚拟网卡', val: '全量接管', sub: '全局路由', icon: '🌐', valColor: '#8B5CF6' }
            ]
          },
          {
            stage: 2,
            nodes: [
              { id: 'cache_ram', name: 'RAM 内存缓存', val: '纳秒直出', sub: 'L1 极速', icon: '⚡️', valColor: '#10B981' },
              { id: 'cache_disk', name: 'Disk 持久缓存', val: 'SQLite 归档', sub: 'L2 降级', icon: '💾', valColor: '#3B82F6' },
              { id: 'cache_block', name: '0.0.0.0 黑洞', val: '即时拦截', sub: '广告与高危', icon: '🛑', valColor: '#EF4444' }
            ]
          },
          {
            stage: 3,
            nodes: [
              { id: 'r_direct', name: 'DIRECT 直连规则', val: '国内域名', sub: '主流 CDN', icon: '⚡️', valColor: '#10B981' },
              { id: 'r_proxy', name: 'PROXY 代理规则', val: '境外服务', sub: '节点加速', icon: '✈️', valColor: '#3B82F6' },
              { id: 'r_reject', name: 'REJECT 广告拦截', val: '脱水规则集', sub: 'Aegis 订阅', icon: '🛡', valColor: '#EF4444' },
              { id: 'r_apple', name: 'Apple 服务加速', val: '官方直连', sub: 'App Store/iCloud', icon: '🍎', valColor: '#94A3B8' }
            ]
          },
          {
            stage: 4,
            nodes: [
              { id: 'g_domestic', name: '国内主干策略', val: 'BGP 直达', sub: '智能选路', icon: '🇨🇳', valColor: '#10B981' },
              { id: 'g_foreign', name: '海外加速策略', val: 'Anycast', sub: '多节点汇聚', icon: '🌍', valColor: '#3B82F6' },
              { id: 'g_fallback', name: '故障备援策略', val: 'Fallback', sub: '自动熔断', icon: '🔄', valColor: '#F59E0B' }
            ]
          },
          {
            stage: 5,
            nodes: [
              { id: 'dns_ali', name: 'AliDNS (223.5.5.5)', val: '国内主力', sub: 'ECS 支持', icon: '📡', valColor: '#10B981' },
              { id: 'dns_dnspod', name: 'DNSPod (119.29.29.29)', val: '腾讯备选', sub: '腾讯云内网', icon: '📡', valColor: '#10B981' },
              { id: 'dns_cf', name: 'Cloudflare DoH', val: '加密解析', sub: '隐私保护', icon: '🔒', valColor: '#3B82F6' },
              { id: 'dns_google', name: 'Google DNS (8.8.8.8)', val: '全球递归', sub: '境外基线', icon: '🌐', valColor: '#3B82F6' }
            ]
          },
          {
            stage: 6,
            nodes: [
              { id: 'out_direct', name: 'DIRECT 直连', val: (ob.direct ? '直连 ' + ob.direct.pct : '直连出站'), sub: '运营商直连出口', icon: '⚡️', valColor: '#10B981' },
              { id: 'out_proxy', name: 'PROXY 代理', val: (ob.proxy ? (s.online ? '加速 ' : '就绪 ') + ob.proxy.pct : '代理就绪'), sub: 'Surge 节点动态加速', icon: '✈️', valColor: '#3B82F6' },
              { id: 'out_block', name: 'BLK 广告阻断', val: (ob.block ? '阻断 ' + ob.block.pct : '阻断 0%'), sub: '0.0.0.0 纳秒丢弃', icon: '🛑', valColor: '#EF4444' },
              { id: 'out_loopback', name: '回环清洗与自愈', val: (ob.loopback ? ob.loopback.status : '闭环运转中'), sub: '脱水规则沉淀 · 灰名单反哺', icon: '🔄', valColor: '#F59E0B', isLoop: true }
            ]
          }
        ];

        BLUEPRINT.forEach(function(stg) {
          var col = stg.stage;
          var theta = STAGE_LONGS[col - 1];
          stageNodeMap[col] = [];
          var count = stg.nodes.length;
          stg.nodes.forEach(function(item, idx) {
            var phi = 0;
            if (count > 1) {
              var phiRange = Math.min(0.85, 0.28 * count);
              phi = -phiRange / 2 + (phiRange / (count - 1)) * idx;
            }
            var nodeData = {
              id: item.id,
              stage: col,
              index: idx,
              name: item.name,
              val: item.val,
              sub: item.sub,
              icon: item.icon,
              valColor: item.valColor,
              isLoop: item.isLoop || false,
              theta: theta,
              phi: phi,
              domEl: null
            };
            sphereNodes.push(nodeData);
            stageNodeMap[col].push(nodeData);
          });
        });
      }

      function linkStageGroup(srcs, tgts, color) {
        if (!srcs || !tgts || srcs.length === 0 || tgts.length === 0) return;
        for (var s = 0; s < srcs.length; s++) {
          for (var t = 0; t < tgts.length; t++) {
            if (srcs.length > 2 && tgts.length > 2 && Math.abs(s - t) > 1) continue;
            sphereLinks.push({ from: srcs[s], to: tgts[t], color: color, isLoop: false });
          }
        }
      }

      linkStageGroup(stageNodeMap[1], stageNodeMap[2], '#3B82F6');
      linkStageGroup(stageNodeMap[2], stageNodeMap[3], '#10B981');
      linkStageGroup(stageNodeMap[3], stageNodeMap[4], '#8B5CF6');
      linkStageGroup(stageNodeMap[4], stageNodeMap[5], '#06B6D4');

      if (stageNodeMap[5] && stageNodeMap[6]) {
        var s6Direct = stageNodeMap[6].find(function(n) { return n.id === 'out_direct'; });
        var s6Proxy = stageNodeMap[6].find(function(n) { return n.id === 'out_proxy'; });
        var s6Block = stageNodeMap[6].find(function(n) { return n.id === 'out_block'; });
        stageNodeMap[5].forEach(function(s5Node, i) {
          if (s6Direct && i === 0) sphereLinks.push({ from: s5Node, to: s6Direct, color: '#10B981', isLoop: false });
          if (s6Proxy && i > 0) sphereLinks.push({ from: s5Node, to: s6Proxy, color: '#3B82F6', isLoop: false });
        });
        if (s6Block && stageNodeMap[3]) {
          var blockRule = stageNodeMap[3].find(function(n) { return n.name.indexOf('黑洞') >= 0 || n.name.indexOf('拦截') >= 0 || n.name.indexOf('REJECT') >= 0; }) || stageNodeMap[3][stageNodeMap[3].length - 1];
          if (blockRule) sphereLinks.push({ from: blockRule, to: s6Block, color: '#EF4444', isLoop: false });
        }
      }

      // 闭环回流弧线：Stage 6 -> 跨越球体另一侧 -> Stage 1 & Stage 2
      if (stageNodeMap[6] && (stageNodeMap[1] || stageNodeMap[2])) {
        var s6Loop = stageNodeMap[6].find(function(n) { return n.isLoop; }) || stageNodeMap[6][stageNodeMap[6].length - 1];
        if (s6Loop) {
          if (stageNodeMap[1] && stageNodeMap[1][0]) {
            sphereLinks.push({ from: s6Loop, to: stageNodeMap[1][0], color: '#F59E0B', isLoop: true, label: '自愈闭环回流' });
          }
          if (stageNodeMap[2] && stageNodeMap[2][0]) {
            sphereLinks.push({ from: s6Loop, to: stageNodeMap[2][0], color: '#F59E0B', isLoop: true, label: '脱水规则沉淀' });
          }
        }
      }

      renderNodeDOMs();
    }

    function renderNodeDOMs() {
      nodesContainer.innerHTML = '';
      sphereNodes.forEach(function(node) {
        var el = document.createElement('div');
        el.className = 'topo-s-node';
        el.id = 's-node-' + node.id;
        el.innerHTML = [
          '<div class="topo-s-node-inner" style="border-left: 3px solid ' + node.valColor + '">',
          '  <div class="topo-s-icon" style="background:rgba(255,255,255,0.08)">' + node.icon + '</div>',
          '  <div class="topo-s-meta">',
          '    <div class="topo-s-name">' + node.name + '</div>',
          '    <div class="topo-s-val" style="color:' + node.valColor + '">' + (node.val || node.sub) + '</div>',
          '  </div>',
          '</div>'
        ].join('');

        el.onclick = function(e) {
          e.stopPropagation();
          focusNode(node);
        };

        nodesContainer.appendChild(el);
        node.domEl = el;
      });
    }

    function focusNode(targetNode) {
      isAutoSpin = false;
      var qSpin = q('#topo-btn-sphere-spin');
      if (qSpin) qSpin.textContent = '▶︎ 自转';

      var v = [
        Math.cos(targetNode.phi) * Math.sin(targetNode.theta),
        -Math.sin(targetNode.phi),
        Math.cos(targetNode.phi) * Math.cos(targetNode.theta)
      ];

      var curDir = mat3VecMul(rotMatrix, v);
      var curX = curDir[0], curY = curDir[1], curZ = curDir[2];

      var axis = [-curY, curX, 0];
      var lenA = Math.sqrt(axis[0]*axis[0] + axis[1]*axis[1]);
      if (lenA > 0.001) {
        axis[0] /= lenA;
        axis[1] /= lenA;
        var dot = curZ;
        var angle = Math.acos(Math.max(-1, Math.min(1, dot)));
        var delta = makeRotationMatrix(axis[0], axis[1], 0, angle * 0.35);
        rotMatrix = normalizeMat3(mat3Mul(delta, rotMatrix));
      }
    }

    function drawWireframeGlobe(w, h, R) {
      var cx = w / 2;
      var cy = h / 2;
      var fov = 850;

      function project(v) {
        var scale = fov / (fov - v[2]);
        return [cx + v[0] * scale, cy + v[1] * scale, v[2]];
      }

      ctx.save();

      // 1. 绘制 5 圈纬线（赤道加粗发光）
      var lats = [-50, -25, 0, 25, 50];
      for (var l = 0; l < lats.length; l++) {
        var phi = lats[l] * Math.PI / 180;
        var rLat = R * Math.cos(phi);
        var yLat = -R * Math.sin(phi);

        ctx.beginPath();
        var steps = 48;
        for (var step = 0; step <= steps; step++) {
          var th = (step / steps) * Math.PI * 2;
          var pt = [rLat * Math.sin(th), yLat, rLat * Math.cos(th)];
          var rotPt = mat3VecMul(rotMatrix, pt);
          var p = project(rotPt);
          if (step === 0) ctx.moveTo(p[0], p[1]);
          else ctx.lineTo(p[0], p[1]);
        }
        var isEquator = (lats[l] === 0);
        ctx.strokeStyle = isEquator ? 'rgba(56, 189, 248, 0.45)' : 'rgba(56, 189, 248, 0.20)';
        ctx.lineWidth = isEquator ? 1.8 : 1.0;
        ctx.stroke();
      }

      // 2. 绘制 6 条经线大圆
      var longs = [0, 60, 120, 180, 240, 300];
      for (var lo = 0; lo < longs.length; lo++) {
        var theta = longs[lo] * Math.PI / 180;
        ctx.beginPath();
        var lSteps = 48;
        for (var st = 0; st <= lSteps; st++) {
          var ph = (st / lSteps) * Math.PI * 2;
          var pPt = [
            R * Math.cos(ph) * Math.sin(theta),
            -R * Math.sin(ph),
            R * Math.cos(ph) * Math.cos(theta)
          ];
          var rPt = mat3VecMul(rotMatrix, pPt);
          var proj = project(rPt);
          if (st === 0) ctx.moveTo(proj[0], proj[1]);
          else ctx.lineTo(proj[0], proj[1]);
        }
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.20)';
        ctx.lineWidth = 1.0;
        ctx.stroke();
      }

      // 3. 绘制外围大气层微光外环
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.4)';
      ctx.lineWidth = 1.8;
      ctx.stroke();

      ctx.restore();
    }

    function drawSphereLinks(w, h, R, nodePosMap) {
      var cx = w / 2;
      var cy = h / 2;
      var fov = 850;

      function project(v) {
        var scale = fov / (fov - v[2]);
        return [cx + v[0] * scale, cy + v[1] * scale, v[2]];
      }

      sphereLinks.forEach(function(link) {
        var p1 = nodePosMap[link.from.id];
        var p2 = nodePosMap[link.to.id];
        if (!p1 || !p2) return;

        var steps = 18;
        var pts = [];
        for (var i = 0; i <= steps; i++) {
          var t = i / steps;
          var bulge = 1 + 0.12 * Math.sin(Math.PI * t);
          var vx = (p1[0] * (1 - t) + p2[0] * t) * bulge;
          var vy = (p1[1] * (1 - t) + p2[1] * t) * bulge;
          var vz = (p1[2] * (1 - t) + p2[2] * t) * bulge;

          var len = Math.sqrt(vx*vx + vy*vy + vz*vz) || 1;
          var rCurrent = R * bulge;
          var normV = [vx / len * rCurrent, vy / len * rCurrent, vz / len * rCurrent];
          pts.push(project(normV));
        }

        ctx.save();
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (var k = 1; k < pts.length; k++) {
          ctx.lineTo(pts[k][0], pts[k][1]);
        }

        var avgZ = (p1[2] + p2[2]) / 2;
        var alpha = avgZ > 0 ? (link.isLoop ? 0.9 : 0.6) : (link.isLoop ? 0.45 : 0.2);
        ctx.strokeStyle = link.color;
        ctx.globalAlpha = alpha;
        ctx.lineWidth = link.isLoop ? 2.4 : 1.6;
        if (link.isLoop) {
          ctx.setLineDash([6, 5]);
          ctx.shadowColor = '#F59E0B';
          ctx.shadowBlur = 8;
        } else {
          ctx.setLineDash([]);
          ctx.shadowColor = link.color;
          ctx.shadowBlur = 4;
        }
        ctx.stroke();
        ctx.restore();

        var particleT = (flowPhase + (link.isLoop ? 0.5 : 0)) % 1;
        var pIdx = Math.floor(particleT * (pts.length - 1));
        var nextIdx = Math.min(pts.length - 1, pIdx + 1);
        var subT = (particleT * (pts.length - 1)) - pIdx;

        var px = pts[pIdx][0] * (1 - subT) + pts[nextIdx][0] * subT;
        var py = pts[pIdx][1] * (1 - subT) + pts[nextIdx][1] * subT;
        var pz = pts[pIdx][2] * (1 - subT) + pts[nextIdx][2] * subT;

        ctx.save();
        ctx.beginPath();
        var pRadius = link.isLoop ? 4 : 3;
        ctx.arc(px, py, pRadius, 0, Math.PI * 2);
        ctx.fillStyle = link.isLoop ? '#FDE047' : '#FFFFFF';
        ctx.shadowColor = link.isLoop ? '#F59E0B' : link.color;
        ctx.shadowBlur = link.isLoop ? 12 : 8;
        ctx.globalAlpha = pz > -R * 0.3 ? 1 : 0.35;
        ctx.fill();
        ctx.restore();
      });
    }

    function updateDOMNodes(w, h, R, nodePosMap) {
      var cx = w / 2;
      var cy = h / 2;
      var fov = 850;

      sphereNodes.forEach(function(node) {
        var pos = nodePosMap[node.id];
        if (!pos || !node.domEl) return;

        var rz = pos[2];
        var scale = fov / (fov - rz);
        var px = cx + pos[0] * scale;
        var py = cy + pos[1] * scale;

        var isFront = (rz > -R * 0.25);
        var opacity = isFront
          ? (0.55 + 0.45 * ((rz + R) / (2 * R)))
          : (0.16 + 0.26 * ((rz + R) / (2 * R)));

        node.domEl.classList.toggle('is-back', !isFront);
        node.domEl.style.transform = 'translate3d(' + Math.round(px) + 'px, ' + Math.round(py) + 'px, 0) translate(-50%, -50%) scale(' + (scale * 0.94).toFixed(3) + ')';
        node.domEl.style.zIndex = Math.round(rz + 1000);
        node.domEl.style.opacity = opacity.toFixed(2);
      });
    }

    function renderFrame() {
      if (!isRunning) return;

      var w = viewport.clientWidth || 800;
      var h = viewport.clientHeight || 560;

      var dpr = window.devicePixelRatio || 1;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }

      ctx.clearRect(0, 0, w, h);

      var cx = w / 2;
      var cy = h / 2;

      baseRadius = Math.max(160, Math.min(270, Math.min(w, h) * 0.44));
      currentRadius += (targetRadius - currentRadius) * 0.1;
      var R = currentRadius;

      if (isDragging) {
      } else {
        if (Math.abs(velX) > 0.0001 || Math.abs(velY) > 0.0001) {
          var dist = Math.sqrt(velX * velX + velY * velY);
          var ax = -velY / dist;
          var ay = velX / dist;
          var deltaM = makeRotationMatrix(ax, ay, 0, dist);
          rotMatrix = normalizeMat3(mat3Mul(deltaM, rotMatrix));
          velX *= 0.92;
          velY *= 0.92;
        } else if (isAutoSpin) {
          var spinM = makeRotationMatrix(0, 1, 0, 0.0022);
          rotMatrix = normalizeMat3(mat3Mul(spinM, rotMatrix));
        }
      }

      flowPhase = (flowPhase + 0.012) % 1;

      var grad = ctx.createRadialGradient(cx, cy, R * 0.1, cx, cy, R * 1.05);
      grad.addColorStop(0, 'rgba(56, 189, 248, 0.16)');
      grad.addColorStop(0.5, 'rgba(30, 58, 138, 0.06)');
      grad.addColorStop(1, 'transparent');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, R * 1.05, 0, Math.PI * 2);
      ctx.fill();

      drawWireframeGlobe(w, h, R);

      var nodePosMap = {};
      sphereNodes.forEach(function(node) {
        var localPos = [
          R * Math.cos(node.phi) * Math.sin(node.theta),
          -R * Math.sin(node.phi),
          R * Math.cos(node.phi) * Math.cos(node.theta)
        ];
        nodePosMap[node.id] = mat3VecMul(rotMatrix, localPos);
      });

      drawSphereLinks(w, h, R, nodePosMap);
      updateDOMNodes(w, h, R, nodePosMap);

      animId = requestAnimationFrame(renderFrame);
    }

    viewport.addEventListener('pointerdown', function(e) {
      if (e.target.closest('button, .topo-s-node')) return;
      isDragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      velX = 0;
      velY = 0;
      if (viewport.setPointerCapture) {
        try { viewport.setPointerCapture(e.pointerId); } catch (_) {}
      }
    });

    window.addEventListener('pointermove', function(e) {
      if (!isDragging) return;
      var dx = e.clientX - lastX;
      var dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;

      velX = dx * 0.005;
      velY = dy * 0.005;

      var dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > 0.5) {
        var ax = -dy / dist;
        var ay = dx / dist;
        var angle = dist * 0.0055;
        var delta = makeRotationMatrix(ax, ay, 0, angle);
        rotMatrix = normalizeMat3(mat3Mul(delta, rotMatrix));
      }
    });

    function stopDrag(e) {
      if (!isDragging) return;
      isDragging = false;
      if (viewport.releasePointerCapture && e && e.pointerId) {
        try { viewport.releasePointerCapture(e.pointerId); } catch (_) {}
      }
    }
    window.addEventListener('pointerup', stopDrag);
    window.addEventListener('pointercancel', stopDrag);

    viewport.addEventListener('wheel', function(e) {
      e.preventDefault();
      var delta = -Math.sign(e.deltaY) * 20;
      targetRadius = Math.max(160, Math.min(380, targetRadius + delta));
    }, { passive: false });

    function start() {
      if (isRunning) return;
      isRunning = true;
      syncNodesFromDOM();
      animId = requestAnimationFrame(renderFrame);
    }

    function stop() {
      isRunning = false;
      if (animId) {
        cancelAnimationFrame(animId);
        animId = null;
      }
    }

    function resetOrientation() {
      rotMatrix = [
        0.91, 0.08, -0.40,
        -0.12, 0.99, -0.07,
        0.39, 0.11, 0.91
      ];
      targetRadius = baseRadius;
      velX = 0;
      velY = 0;
    }

    function toggleAutoSpin() {
      isAutoSpin = !isAutoSpin;
      return isAutoSpin;
    }

    sphereEngineInstance = {
      viewport: viewport,
      start: start,
      stop: stop,
      syncNodesFromDOM: syncNodesFromDOM,
      resetOrientation: resetOrientation,
      toggleAutoSpin: toggleAutoSpin
    };

    return sphereEngineInstance;
  }

  function setupTopologyControls(card, wrap) {
    var heading = q('.console-topology-heading');
    if (!heading || q('.topo-controls', heading)) return;

    var controls = document.createElement('div');
    controls.className = 'topo-controls';
    controls.innerHTML = [
      '<div class="topo-btn-view-group" title="切换平面 / 3D 球体闭环视图">',
      '  <button type="button" class="topo-btn-view ' + (!isSphereMode ? 'active' : '') + '" id="topo-btn-view-2d" title="经典平面视图 (2D 拓扑)">',
      '    <span>🗺 平面视图</span>',
      '  </button>',
      '  <button type="button" class="topo-btn-view ' + (isSphereMode ? 'active' : '') + '" id="topo-btn-view-3d" title="3D 闭环全息球体 (360° 任意拖拽自由旋转)">',
      '    <span>🌐 3D 球体</span>',
      '  </button>',
      '</div>',
      '<div class="topo-sphere-bar" id="topo-sphere-bar" style="' + (isSphereMode ? 'display:inline-flex' : 'display:none') + '">',
      '  <button type="button" class="topo-ctrl-btn" id="topo-btn-sphere-spin" title="开启/暂停球体自转">⏸ 自转</button>',
      '  <button type="button" class="topo-ctrl-btn" id="topo-btn-sphere-reset" title="复位正面视角">🔄 复位</button>',
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

    var btnView2D = q('#topo-btn-view-2d');
    var btnView3D = q('#topo-btn-view-3d');
    var sphereBar = q('#topo-sphere-bar');
    var nav = q('.topo-stages-nav', card);
    var engine = getOrCreateSphereEngine(card, wrap);

    function switchViewMode(toSphere) {
      isSphereMode = toSphere;
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('localdns_topo_view_mode', isSphereMode ? 'sphere' : 'plane');
        }
      } catch (_) {}

      card.classList.toggle('is-sphere-mode', isSphereMode);
      if (btnView2D) btnView2D.classList.toggle('active', !isSphereMode);
      if (btnView3D) btnView3D.classList.toggle('active', isSphereMode);
      if (sphereBar) sphereBar.style.display = isSphereMode ? 'inline-flex' : 'none';

      if (isSphereMode) {
        wrap.style.display = 'none';
        if (nav) nav.style.display = 'none';
        engine.viewport.style.display = 'block';
        engine.start();
        toast('进入 3D 闭环球体拓扑', '360° 任意拖拽自由旋转 · 滚轮缩放');
      } else {
        engine.stop();
        engine.viewport.style.display = 'none';
        wrap.style.display = 'block';
        if (nav) nav.style.display = 'flex';
        applyFitView(card, wrap);
        toast('切回平面视图', '已恢复 2D 经典拓扑布局');
        window.dispatchEvent(new CustomEvent('localdns:layoutchange'));
      }
    }

    if (btnView2D) {
      btnView2D.onclick = function () { switchViewMode(false); };
    }
    if (btnView3D) {
      btnView3D.onclick = function () { switchViewMode(true); };
    }

    var btnSphereSpin = q('#topo-btn-sphere-spin');
    if (btnSphereSpin) {
      btnSphereSpin.onclick = function () {
        var running = engine.toggleAutoSpin();
        btnSphereSpin.textContent = running ? '⏸ 自转' : '▶︎ 自转';
      };
    }

    var btnSphereReset = q('#topo-btn-sphere-reset');
    if (btnSphereReset) {
      btnSphereReset.onclick = function () {
        engine.resetOrientation();
      };
    }

    // 阶段导航胶囊条
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
      if (isFitView) applyFitView(card, wrap);
    }, { passive: true });

    card.classList.toggle('is-sphere-mode', isSphereMode);
    if (isSphereMode) {
      wrap.style.display = 'none';
      if (nav) nav.style.display = 'none';
      engine.viewport.style.display = 'block';
      engine.start();
    } else {
      engine.viewport.style.display = 'none';
      wrap.style.display = 'block';
    }
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
        if (sphereEngineInstance && isSphereMode) {
          sphereEngineInstance.syncNodesFromDOM();
        }
      })
      .catch(function () {
        renderStage6AndLoopback(wrap, svg);
        if (sphereEngineInstance && isSphereMode) {
          sphereEngineInstance.syncNodesFromDOM();
        }
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
