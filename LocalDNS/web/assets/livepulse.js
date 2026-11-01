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
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('localdns_topo_view_mode');
    }
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
      '  padding: 60px 16px 60px 16px !important;',
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
      '  to { stroke-dashoffset: -56; }',
      '}',
      '@keyframes topoPulseGlow {',
      '  0%, 100% { stroke-opacity: 0.25; filter: drop-shadow(0 0 2px currentColor); }',
      '  50% { stroke-opacity: 0.65; filter: drop-shadow(0 0 7px currentColor); }',
      '}',
      '#topo-s6-loopback-layer .topo-particle {',
      '  fill: none !important;',
      '  stroke-linecap: round !important;',
      '  stroke-dasharray: 8 18 !important;',
      '  stroke-width: 2.8px !important;',
      '  animation: topoDashLoop 1.4s linear infinite !important;',
      '  filter: drop-shadow(0 0 4px currentColor) drop-shadow(0 0 8px currentColor) !important;',
      '  opacity: 1 !important;',
      '  display: block !important;',
      '  visibility: visible !important;',
      '}',
      '#topo-s6-loopback-layer .topo-particle.is-loopback {',
      '  stroke-dasharray: 10 22 !important;',
      '  stroke-width: 3.4px !important;',
      '  animation: topoDashLoop 1.1s linear infinite !important;',
      '  filter: drop-shadow(0 0 5px currentColor) drop-shadow(0 0 10px currentColor) !important;',
      '  opacity: 1 !important;',
      '}',
      '#topo-s6-loopback-layer .topo-edge.is-loopback {',
      '  stroke-dasharray: 5 6 !important;',
      '  stroke-opacity: 0.75 !important;',
      '  stroke-width: 2.2px !important;',
      '  filter: drop-shadow(0 0 4px currentColor) !important;',
      '}',
      '#topo-s6-loopback-layer .topo-glow.is-loopback {',
      '  stroke-width: 6px !important;',
      '  stroke-opacity: 0.3 !important;',
      '  animation: topoPulseGlow 2s ease-in-out infinite !important;',
      '}',
      '.loopback-badge-group {',
      '  pointer-events: none !important;',
      '  filter: drop-shadow(0 4px 12px rgba(0,0,0,0.75)) !important;',
      '}',
      '.loopback-ribbon-text {',
      '  font-family: var(--font-sans, system-ui);',
      '  font-size: 11px !important;',
      '  font-weight: 700 !important;',
      '  letter-spacing: 0.04em !important;',
      '  user-select: none !important;',
      '  pointer-events: none !important;',
      '}',
      '.t-node[data-zero-flow="true"].is-hidden-zero {',
      '  display: none !important;',
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
      var naturalH = wrap.offsetHeight || 560;
      wrap.style.transform = 'scale(' + ratio + ')';
      wrap.style.transformOrigin = 'top left';
      wrap.style.marginTop = '16px';
      wrap.style.marginBottom = -Math.round((1 - ratio) * naturalH) + 'px';
      wrap.style.marginRight = -Math.round((1 - ratio) * naturalW) + 'px';
    } else {
      wrap.style.transform = '';
      wrap.style.transformOrigin = '';
      wrap.style.marginTop = '';
      wrap.style.marginBottom = '';
      wrap.style.marginRight = '';
    }
  }

  function setupTopologyControls(card, wrap) {
    var heading = q('.console-topology-heading');
    if (!heading || q('.topo-controls', heading)) return;

    var controls = document.createElement('div');
    controls.className = 'topo-controls';
    controls.innerHTML = [
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
        var topY = 28;
        d = 'M ' + x1.toFixed(1) + ' ' + y1.toFixed(1) + ' C ' + (x1 - 180).toFixed(1) + ' ' + topY + ', ' + (x2 + 180).toFixed(1) + ' ' + topY + ', ' + x2.toFixed(1) + ' ' + y2.toFixed(1);
      } else {
        var botY = Math.max(wrapRect.height - 28, y1 + 35);
        d = 'M ' + x1.toFixed(1) + ' ' + y1.toFixed(1) + ' C ' + (x1 - 200).toFixed(1) + ' ' + botY + ', ' + (x2 + 200).toFixed(1) + ' ' + botY + ', ' + x2.toFixed(1) + ' ' + y2.toFixed(1);
      }

      var loopCls = isLoop ? ' is-loopback' : ' is-s6-flow';
      html += '<path class="topo-halo' + loopCls + '" d="' + d + '" stroke="' + color + '" />';
      html += '<path class="topo-glow' + loopCls + '" d="' + d + '" stroke="' + color + '" />';
      html += '<path class="topo-particle' + loopCls + '" d="' + d + '" stroke="' + color + '" />';
      html += '<path class="topo-edge' + loopCls + '" d="' + d + '" stroke="' + color + '" stroke-opacity="' + (isLoop ? '0.75' : '0.45') + '" fill="none" stroke-width="' + (isLoop ? '2.0' : '1.5') + '" />';
      html += '<circle class="topo-dot-halo" cx="' + x1.toFixed(1) + '" cy="' + y1.toFixed(1) + '" r="3.6" fill="' + color + '" />';
      html += '<circle class="topo-dot" cx="' + x1.toFixed(1) + '" cy="' + y1.toFixed(1) + '" r="2.2" fill="' + color + '" />';
      html += '<circle class="topo-dot-halo" cx="' + x2.toFixed(1) + '" cy="' + y2.toFixed(1) + '" r="3.6" fill="' + color + '" />';
      html += '<circle class="topo-dot" cx="' + x2.toFixed(1) + '" cy="' + y2.toFixed(1) + '" r="2.2" fill="' + color + '" />';

      if (label) {
        var lx = (x1 + x2) / 2;
        var ly = loopDirection === 'top' ? 28 : (wrapRect.height - 28);
        var pillW = 240, pillH = 24;
        var pillX = lx - pillW / 2;
        var pillY = ly - pillH / 2;
        html += '<g class="loopback-badge-group">' +
          '<rect x="' + pillX.toFixed(1) + '" y="' + pillY.toFixed(1) + '" width="' + pillW + '" height="' + pillH + '" rx="' + (pillH / 2) + '" fill="rgba(15,23,42,0.96)" stroke="' + (labelColor || color) + '" stroke-width="1.4" />' +
          '<text x="' + lx.toFixed(1) + '" y="' + (pillY + 16).toFixed(1) + '" text-anchor="middle" fill="' + (labelColor || color) + '" class="loopback-ribbon-text">' + label + '</text>' +
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

    // 进程守护实时状态注入：每 4 秒刷新一次
    if (tick % 4 === 0) {
      try { updateGuardianIndicator(); } catch (e) {}
    }
  }

  // 进程守护实时状态徽章
  function updateGuardianIndicator() {
    var statusBox = q('.console-connection-status') || q('.top-header-grid .connection-indicator');
    if (!statusBox) return;
    var badge = q('#guardian-live-badge');
    if (!badge) {
      badge = document.createElement('span');
      badge.id = 'guardian-live-badge';
      badge.style.cssText = 'display:inline-flex;align-items:center;gap:4px;font-size:11.5px;padding:2px 8px;border-radius:12px;background:rgba(16,185,129,0.12);color:#10B981;border:1px solid rgba(16,185,129,0.3);margin-left:8px;cursor:pointer;user-select:none;font-weight:600';
      badge.title = 'LocalDNS 进程守护神：看门狗每 6 秒巡检，持续保障后台存活与中断自愈';
      badge.onclick = async function () {
        try {
          var r = await fetch('/api/v1/guardian/status');
          var d = await r.json();
          var tip = [
            '🛡 LocalDNS 进程守护健康报告',
            '• 看门狗状态: ' + (d.enabled ? '已激活 (每 6 秒巡检)' : '已停用'),
            '• 系统后台保活: ' + (d.keeperActive ? '运行中 (' + d.keeperStatus + ')' : '未激活'),
            '• 异常自愈复活: ' + d.autoHealedCount + ' 次',
            '• 持续运行时间: ' + Math.floor(d.uptimeSeconds / 60) + ' 分钟',
            '• 服务监听端口: ' + d.serverPort
          ].join('\n');
          alert(tip);
        } catch (e) {
          alert('获取守护状态失败: ' + e.message);
        }
      };
      statusBox.appendChild(badge);
    }

    fetch('/api/v1/guardian/status', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.success) return;
        var isOk = d.enabled && d.keeperActive && d.serverRunning;
        var text = isOk ? '🛡 守护活跃' : '⚠️ 守护待命';
        if (d.autoHealedCount > 0) {
          text += ' (已自愈 ' + d.autoHealedCount + ' 次)';
        }
        badge.innerHTML = text;
        badge.style.background = isOk ? 'rgba(16,185,129,0.12)' : 'rgba(245,158,11,0.14)';
        badge.style.color = isOk ? '#10B981' : '#F59E0B';
        badge.style.borderColor = isOk ? 'rgba(16,185,129,0.3)' : 'rgba(245,158,11,0.35)';
      })
      .catch(function () {});
  }

  setInterval(run, 1000);
})();
