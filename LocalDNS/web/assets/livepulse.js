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
      '  min-width: 1380px !important;',
      '  width: 1380px !important;',
      '  transform-origin: top left !important;',
      '  transition: transform 0.22s cubic-bezier(0.16, 1, 0.3, 1) !important;',
      '}',
      '.topo-grid {',
      '  grid-template-columns: repeat(6, minmax(205px, 1fr)) !important;',
      '  gap: 22px !important;',
      '  overflow: visible !important;',
      '}',
      '.topo-col {',
      '  min-width: 205px !important;',
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
      var naturalW = 1380;
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
        qq('.t-node[data-zero-flow="true"]', card).forEach(function (node) {
          node.classList.toggle('is-hidden-zero', hideZeroFlow);
        });
        window.dispatchEvent(new CustomEvent('localdns:layoutchange'));
      };
    }
  }

  function updateDynamicTopology() {
    var card = q('.topology-glass-card');
    var wrap = q('#topo-stage-wrap');
    var grid = q('.topo-grid');
    var svg = q('#topo-svg');
    if (!card || !wrap || !grid || !svg) return;

    // 注入增强 CSS 与控制工具条
    injectTopologyEnhanceStyles();
    setupTopologyControls(card, wrap);

    // 1. 动态注入阶段 06：出站执行 (Surge 节点与阻断)
    var col6 = q('.topo-col[data-col="6"]');
    if (!col6) {
      col6 = document.createElement('div');
      col6.className = 'topo-col';
      col6.dataset.col = '6';
      col6.innerHTML = [
        '<div class="topo-col-title"><span>06</span>出站执行 (Surge)</div>',
        '<div class="topo-col-body">',
        '  <div class="t-node" data-node-id="out_direct" data-outbound="direct" title="国内直连出站，不经代理">',
        '    <div class="tn-left">',
        '      <div class="tn-icon-box" style="color:#10B981;background:rgba(16,185,129,0.12)">⚡️</div>',
        '      <div class="tn-meta">',
        '        <div class="tn-name">DIRECT 直连</div>',
        '        <div class="tn-sub" id="topo-direct-sub">大陆服务 · 本地直出</div>',
        '      </div>',
        '    </div>',
        '    <span class="tn-val" style="color:#10B981">直连</span>',
        '  </div>',
        '  <div class="t-node" data-node-id="out_proxy" data-outbound="proxy" title="Surge 代理通道，支持智能选路">',
        '    <div class="tn-left">',
        '      <div class="tn-icon-box" style="color:#3B82F6;background:rgba(59,130,246,0.12)">✈️</div>',
        '      <div class="tn-meta">',
        '        <div class="tn-name" id="topo-surge-node-name">PROXY 代理</div>',
        '        <div class="tn-sub" id="topo-surge-node-sub">Surge 节点出站</div>',
        '      </div>',
        '    </div>',
        '    <span class="tn-val" id="topo-surge-node-val" style="color:#3B82F6">加速</span>',
        '  </div>',
        '  <div class="t-node" data-node-id="out_block" data-outbound="block" title="0.0.0.0 阻断，主动掐断活跃长连接">',
        '    <div class="tn-left">',
        '      <div class="tn-icon-box" style="color:#EF4444;background:rgba(239,68,68,0.12)">🛑</div>',
        '      <div class="tn-meta">',
        '        <div class="tn-name">BLK 拦截</div>',
        '        <div class="tn-sub" id="topo-block-sub">连接掐断 · 零消耗</div>',
        '      </div>',
        '    </div>',
        '    <span class="tn-val" style="color:#EF4444">阻断</span>',
        '  </div>',
        '</div>'
      ].join('');
      grid.appendChild(col6);
      topoInjected = true;
      window.dispatchEvent(new CustomEvent('localdns:layoutchange'));
    }

    // 2. 拉取后端动态拓扑数据，更新阶段 06 状态与自愈标记
    fetch('/api/v1/topology/flow', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data || !data.success) return;

        // 更新 Surge 节点信息
        if (data.surge) {
          var s = data.surge;
          if (s.online) {
            setText(q('#topo-surge-node-name'), 'PROXY · 在线');
            setText(q('#topo-surge-node-sub'), '模式: ' + (s.mode || 'rule').toUpperCase());
            setText(q('#topo-surge-node-val'), '就绪');
          } else {
            setText(q('#topo-surge-node-name'), 'Surge (未连接)');
            setText(q('#topo-surge-node-sub'), '可开启 HTTP API 联动');
            setText(q('#topo-surge-node-val'), '离线');
          }
        }

        // 更新自愈信息
        if (data.self_healing && data.self_healing.healed_recent_count > 0) {
          var healedNode = q('[data-node-id="r4"] .tn-sub');
          if (healedNode) setText(healedNode, '已自愈 ' + data.self_healing.healed_recent_count + ' 域名');
        }

        // 3. 动态绘制延伸至阶段 06 的贝塞尔连线
        drawStage6Curves(wrap, svg);
      })
      .catch(function () {});
  }

  function drawStage6Curves(wrap, svg) {
    if (!wrap || !svg) return;
    var wrapRect = wrap.getBoundingClientRect();
    if (!wrapRect.width || !wrapRect.height) return;

    var s6Edges = [
      { from: 'alidns_ip', to: 'out_direct', color: '#10B981' },
      { from: 'alidns_doh', to: 'out_direct', color: '#10B981' },
      { from: 'dnspod_doh', to: 'out_direct', color: '#10B981' },
      { from: 'cloudflare_ip', to: 'out_proxy', color: '#3B82F6' },
      { from: 'cloudflare_ecs', to: 'out_proxy', color: '#3B82F6' },
      { from: 'google_proxy', to: 'out_proxy', color: '#3B82F6' },
      { from: 'google_doh', to: 'out_proxy', color: '#3B82F6' },
    ];

    var pathsHtml = '';
    s6Edges.forEach(function (e, idx) {
      var fEl = wrap.querySelector('[data-node-id="' + e.from + '"]') || wrap.querySelector('.t-node');
      var tEl = wrap.querySelector('[data-node-id="' + e.to + '"]');
      if (!fEl || !tEl) return;
      var r1 = fEl.getBoundingClientRect(), r2 = tEl.getBoundingClientRect();
      var x1 = r1.right - wrapRect.left, y1 = r1.top + r1.height / 2 - wrapRect.top;
      var x2 = r2.left - wrapRect.left, y2 = r2.top + r2.height / 2 - wrapRect.top;
      var dx = (x2 - x1) * 0.54;
      var d = 'M ' + x1.toFixed(1) + ' ' + y1.toFixed(1) + ' C ' + (x1 + dx).toFixed(1) + ' ' + y1.toFixed(1) + ', ' + (x2 - dx).toFixed(1) + ' ' + y2.toFixed(1) + ', ' + x2.toFixed(1) + ' ' + y2.toFixed(1);
      pathsHtml += '<path class="topo-edge s6-edge" data-s6-idx="' + idx + '" d="' + d + '" stroke="' + e.color + '" stroke-opacity="0.4" fill="none" stroke-width="1.6" />';
    });

    var existingS6 = svg.querySelectorAll('.s6-edge');
    for (var i = 0; i < existingS6.length; i++) existingS6[i].remove();
    svg.insertAdjacentHTML('beforeend', pathsHtml);
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
