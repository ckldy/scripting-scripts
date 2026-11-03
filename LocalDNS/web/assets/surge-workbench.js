/**
 * web/assets/surge-workbench.js
 *
 * LocalDNS × Surge 模块工作台与动态分流可视化管理系统
 * 挂载于 #/proxy-config 路由，包含：
 * 1. 远程模块导入、脱水统计与在线代码编辑
 * 2. 远程规则集导入、分组独立开关与多行文本在线编辑
 * 3. Surge 连通性深度测试、实时运行状态仪表盘与出站切换
 * 4. 傻瓜式「Surge 配置引导」向导与一键配置复制
 */

(function () {
  var activeTab = 'modules'; // 'modules' | 'diversion' | 'surge-settings' | 'guide' | 'raw-editor'
  var workbenchInjected = false;
  var cachedRuntime = null;

  function injectWorkbenchStyles() {
    if (document.getElementById('sw-workbench-styles')) return;
    var style = document.createElement('style');
    style.id = 'sw-workbench-styles';
    style.textContent = [
      '/* LocalDNS × Surge 工作台全站主题自适应与编辑器对比度优化 */',
      '.sw-modal-panel {',
      '  width: 100% !important;',
      '  max-width: 660px !important;',
      '  max-height: 90vh !important;',
      '  display: flex !important;',
      '  flex-direction: column !important;',
      '  border-radius: 16px !important;',
      '  background: var(--glass-bg, #FAF8F5) !important;',
      '  color: var(--text-1, #191816) !important;',
      '  border: 1px solid var(--border-highlight, rgba(148, 163, 184, 0.35)) !important;',
      '  box-shadow: 0 24px 64px rgba(0,0,0,0.3) !important;',
      '  padding: 20px !important;',
      '  overflow: hidden !important;',
      '}',
      '.sw-modal-panel h3, .sw-modal-panel strong {',
      '  color: var(--text-1, #191816) !important;',
      '}',
      '.sw-modal-panel label {',
      '  color: var(--text-1, #191816) !important;',
      '  font-size: 12px !important;',
      '  font-weight: 600 !important;',
      '}',
      '.sw-modal-panel p, .sw-modal-panel small {',
      '  color: var(--text-2, #64748b) !important;',
      '}',
      '.sw-modal-panel .icon-button {',
      '  color: var(--text-2, #64748b) !important;',
      '}',
      '.sw-modal-panel .icon-button:hover {',
      '  color: var(--text-1, #191816) !important;',
      '}',
      '/* 代码与规则编辑器 textarea: 清晰浅灰底色/深黑文字，深色模式自动反色 */',
      'textarea.sw-textarea {',
      '  width: 100% !important;',
      '  box-sizing: border-box !important;',
      '  padding: 12px 14px !important;',
      '  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace !important;',
      '  font-size: 13px !important;',
      '  line-height: 1.6 !important;',
      '  border-radius: 10px !important;',
      '  background: rgba(0, 0, 0, 0.04) !important;',
      '  color: var(--text-1, #191816) !important;',
      '  border: 1px solid var(--border-glass, rgba(148, 163, 184, 0.35)) !important;',
      '  resize: vertical !important;',
      '  tab-size: 2 !important;',
      '  outline: none !important;',
      '  transition: border-color 0.15s, box-shadow 0.15s !important;',
      '}',
      'textarea.sw-textarea:focus {',
      '  border-color: var(--color-primary, #B45309) !important;',
      '  box-shadow: 0 0 0 2px rgba(180, 83, 9, 0.2) !important;',
      '}',
      'html[data-theme="dark-glass"] textarea.sw-textarea {',
      '  background: rgba(0, 0, 0, 0.45) !important;',
      '  color: #f1f5f9 !important;',
      '  border-color: rgba(255, 255, 255, 0.16) !important;',
      '}',
      '/* 输入框与下拉选择框 */',
      '.sw-input, .sw-select {',
      '  width: 100% !important;',
      '  box-sizing: border-box !important;',
      '  padding: 8px 12px !important;',
      '  margin-top: 4px !important;',
      '  border-radius: 8px !important;',
      '  background: rgba(0, 0, 0, 0.04) !important;',
      '  color: var(--text-1, #191816) !important;',
      '  border: 1px solid var(--border-glass, rgba(148, 163, 184, 0.3)) !important;',
      '  font-size: 13px !important;',
      '  outline: none !important;',
      '}',
      '.sw-input:focus, .sw-select:focus {',
      '  border-color: var(--color-primary, #B45309) !important;',
      '  box-shadow: 0 0 0 2px rgba(180, 83, 9, 0.18) !important;',
      '}',
      'html[data-theme="dark-glass"] .sw-input,',
      'html[data-theme="dark-glass"] .sw-select {',
      '  background: rgba(0, 0, 0, 0.4) !important;',
      '  color: #f1f5f9 !important;',
      '  border-color: rgba(255, 255, 255, 0.15) !important;',
      '}',
      '/* 配置向导 pre 预览块 */',
      '.sw-code-pre {',
      '  padding: 12px 14px !important;',
      '  border-radius: 8px !important;',
      '  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace !important;',
      '  font-size: 12px !important;',
      '  line-height: 1.55 !important;',
      '  overflow-x: auto !important;',
      '  margin: 0 0 10px 0 !important;',
      '  background: rgba(0, 0, 0, 0.04) !important;',
      '  border: 1px solid rgba(148, 163, 184, 0.25) !important;',
      '  color: var(--text-1, #191816) !important;',
      '}',
      'html[data-theme="dark-glass"] .sw-code-pre {',
      '  background: rgba(0, 0, 0, 0.45) !important;',
      '  border-color: rgba(255, 255, 255, 0.15) !important;',
      '  color: #A7F3D0 !important;',
      '}',
      '/* 大号弹窗与明细管理列表 */',
      '.sw-modal-panel.sw-modal-large {',
      '  max-width: 860px !important;',
      '  width: 95vw !important;',
      '}',
      '.sw-rule-item {',
      '  display: flex !important;',
      '  align-items: center !important;',
      '  justify-content: space-between !important;',
      '  padding: 8px 12px !important;',
      '  border-radius: 8px !important;',
      '  background: rgba(0, 0, 0, 0.02) !important;',
      '  border: 1px solid rgba(148, 163, 184, 0.18) !important;',
      '  gap: 10px !important;',
      '  font-size: 13px !important;',
      '  transition: background 0.15s, border-color 0.15s !important;',
      '}',
      '.sw-rule-item:hover {',
      '  background: rgba(0, 0, 0, 0.05) !important;',
      '  border-color: rgba(148, 163, 184, 0.35) !important;',
      '}',
      'html[data-theme="dark-glass"] .sw-rule-item {',
      '  background: rgba(255, 255, 255, 0.03) !important;',
      '  border-color: rgba(255, 255, 255, 0.08) !important;',
      '}',
      'html[data-theme="dark-glass"] .sw-rule-item:hover {',
      '  background: rgba(255, 255, 255, 0.07) !important;',
      '  border-color: rgba(255, 255, 255, 0.16) !important;',
      '}',
      '.sw-badge {',
      '  font-size: 11px !important;',
      '  font-weight: 600 !important;',
      '  padding: 2px 7px !important;',
      '  border-radius: 5px !important;',
      '  display: inline-block !important;',
      '  font-family: ui-monospace, SFMono-Regular, monospace !important;',
      '  white-space: nowrap !important;',
      '}'
    ].join('\n');
    document.head.appendChild(style);
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

  function toast(title, desc) {
    var stack = q('#toast-stack') || document.body;
    var el = document.createElement('div');
    el.className = 'glass-toast';
    el.style.cssText = 'background:rgba(30,41,59,0.95);color:#fff;padding:11px 18px;border-radius:12px;margin-top:8px;font-size:13px;box-shadow:0 12px 32px rgba(0,0,0,0.3);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border:1px solid rgba(255,255,255,0.1);z-index:99999;transition:opacity 0.25s';
    el.innerHTML = '<strong style="display:block;font-size:13px">' + title + '</strong>' + (desc ? '<div style="opacity:0.85;font-size:12px;margin-top:3px;line-height:1.4">' + desc + '</div>' : '');
    stack.appendChild(el);
    setTimeout(function () {
      el.style.opacity = '0';
      setTimeout(function () { el.remove(); }, 250);
    }, 2800);
  }

  function openModal(title, contentHtml, onConfirm, confirmText, options) {
    injectWorkbenchStyles();
    options = options || {};
    var modal = q('#sw-global-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'sw-global-modal';
      modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;z-index:99990;padding:16px;opacity:0;transition:opacity 0.2s';
      modal.innerHTML = [
        '<div class="sw-modal-panel glass-card">',
        '  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-shrink:0">',
        '    <h3 id="sw-modal-title" style="margin:0;font-size:16px;font-weight:600"></h3>',
        '    <button type="button" class="icon-button" id="sw-modal-close" style="background:none;border:none;font-size:20px;cursor:pointer;padding:4px 8px">✕</button>',
        '  </div>',
        '  <div id="sw-modal-body" style="flex:1;overflow-y:auto;padding-right:4px"></div>',
        '  <div id="sw-modal-footer" style="display:flex;justify-content:flex-end;gap:10px;margin-top:16px;padding-top:12px;border-top:1px solid rgba(148,163,184,0.15);flex-shrink:0">',
        '    <button type="button" class="button" id="sw-modal-cancel">取消</button>',
        '    <button type="button" class="button primary" id="sw-modal-ok">确定</button>',
        '  </div>',
        '</div>'
      ].join('');
      document.body.appendChild(modal);

      q('#sw-modal-close', modal).onclick = closeModal;
      q('#sw-modal-cancel', modal).onclick = closeModal;
    }

    var panel = q('.sw-modal-panel', modal);
    if (panel) {
      if (options.large) {
        panel.classList.add('sw-modal-large');
      } else {
        panel.classList.remove('sw-modal-large');
      }
    }

    var footer = q('#sw-modal-footer', modal);
    if (footer) {
      footer.style.display = options.hideFooter ? 'none' : 'flex';
      var cancelBtn = q('#sw-modal-cancel', modal);
      if (cancelBtn) {
        cancelBtn.style.display = options.hideCancel ? 'none' : '';
        cancelBtn.textContent = options.cancelText || '取消';
      }
    }

    q('#sw-modal-title', modal).textContent = title;
    q('#sw-modal-body', modal).innerHTML = contentHtml;
    var okBtn = q('#sw-modal-ok', modal);
    okBtn.textContent = confirmText || '确定';
    okBtn.onclick = async function () {
      if (onConfirm) {
        var shouldClose = await onConfirm();
        if (shouldClose !== false) closeModal();
      } else {
        closeModal();
      }
    };

    modal.style.display = 'flex';
    requestAnimationFrame(function () { modal.style.opacity = '1'; });
  }

  function closeModal() {
    var modal = q('#sw-global-modal');
    if (modal) {
      modal.style.opacity = '0';
      setTimeout(function () { modal.style.display = 'none'; }, 200);
    }
  }

  function openSubModal(title, contentHtml, onConfirm, confirmText) {
    injectWorkbenchStyles();
    var modal = q('#sw-sub-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'sw-sub-modal';
      modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;z-index:99998;padding:16px;opacity:0;transition:opacity 0.2s';
      modal.innerHTML = [
        '<div class="sw-modal-panel glass-card" style="max-width:520px;z-index:99999">',
        '  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-shrink:0">',
        '    <h3 id="sw-sub-modal-title" style="margin:0;font-size:15px;font-weight:600"></h3>',
        '    <button type="button" class="icon-button" id="sw-sub-modal-close" style="background:none;border:none;font-size:18px;cursor:pointer;padding:4px 8px">✕</button>',
        '  </div>',
        '  <div id="sw-sub-modal-body" style="flex:1;overflow-y:auto;padding-right:4px"></div>',
        '  <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:16px;padding-top:12px;border-top:1px solid rgba(148,163,184,0.15);flex-shrink:0">',
        '    <button type="button" class="button" id="sw-sub-modal-cancel">取消</button>',
        '    <button type="button" class="button primary" id="sw-sub-modal-ok">确定</button>',
        '  </div>',
        '</div>'
      ].join('');
      document.body.appendChild(modal);

      q('#sw-sub-modal-close', modal).onclick = closeSubModal;
      q('#sw-sub-modal-cancel', modal).onclick = closeSubModal;
    }

    q('#sw-sub-modal-title', modal).textContent = title;
    q('#sw-sub-modal-body', modal).innerHTML = contentHtml;
    var okBtn = q('#sw-sub-modal-ok', modal);
    okBtn.textContent = confirmText || '确定';
    okBtn.onclick = async function () {
      if (onConfirm) {
        var shouldClose = await onConfirm();
        if (shouldClose !== false) closeSubModal();
      } else {
        closeSubModal();
      }
    };

    modal.style.display = 'flex';
    requestAnimationFrame(function () { modal.style.opacity = '1'; });
  }

  function closeSubModal() {
    var modal = q('#sw-sub-modal');
    if (modal) {
      modal.style.opacity = '0';
      setTimeout(function () { modal.style.display = 'none'; }, 200);
    }
  }

  function copyText(str) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(str).then(function () {
        toast('复制成功', '配置片段已写入剪贴板');
      }).catch(function () {
        prompt('请长按复制配置文本：', str);
      });
    } else {
      prompt('请长按复制配置文本：', str);
    }
  }

  // ==================== 顶部导航与状态条 ====================

  function renderHeaderStatus() {
    var isOnline = cachedRuntime && cachedRuntime.online;
    var rtt = cachedRuntime && cachedRuntime.rttMs ? cachedRuntime.rttMs + ' ms' : '--';
    var mode = cachedRuntime && cachedRuntime.outbound ? cachedRuntime.outbound.toUpperCase() : 'UNKNOWN';

    return [
      '<div class="sw-status-bar" style="display:flex;justify-content:space-between;align-items:center;padding:10px 16px;background:rgba(255,255,255,0.03);border:1px solid rgba(148,163,184,0.18);border-radius:12px;margin-bottom:14px;flex-wrap:wrap;gap:10px">',
      '  <div style="display:flex;align-items:center;gap:12px">',
      '    <div style="display:flex;align-items:center;gap:6px">',
      '      <span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:' + (isOnline ? '#10B981' : '#EF4444') + ';box-shadow:0 0 8px ' + (isOnline ? '#10B981' : '#EF4444') + '"></span>',
      '      <strong style="font-size:13px">' + (isOnline ? 'Surge 引擎已连通' : 'Surge 联动未连接') + '</strong>',
      '    </div>',
      '    <span style="font-size:12px;opacity:0.75;padding:2px 8px;background:rgba(148,163,184,0.12);border-radius:6px">模式: ' + mode + '</span>',
      '    <span style="font-size:12px;opacity:0.75;padding:2px 8px;background:rgba(148,163,184,0.12);border-radius:6px">延迟: ' + rtt + '</span>',
      '  </div>',
      '  <div style="display:flex;align-items:center;gap:8px">',
      '    <button type="button" class="button small" id="sw-btn-test-conn" style="background:rgba(59,130,246,0.15);color:#60A5FA;border-color:rgba(59,130,246,0.3)">🔌 连通测试</button>',
      '    <button type="button" class="button small" id="sw-btn-header-sync">🔄 一键同步</button>',
      '  </div>',
      '</div>'
    ].join('');
  }

  function renderTabs() {
    return [
      '<div class="sw-tab-bar" style="display:flex;gap:6px;margin:12px 0 16px;padding:4px;background:rgba(148,163,184,0.12);border-radius:12px;overflow-x:auto;-webkit-overflow-scrolling:touch">',
      '  <button type="button" class="sw-tab-btn ' + (activeTab === 'modules' ? 'active' : '') + '" data-sw-tab="modules">📦 模块工作台</button>',
      '  <button type="button" class="sw-tab-btn ' + (activeTab === 'diversion' ? 'active' : '') + '" data-sw-tab="diversion">🔀 动态分流治理</button>',
      '  <button type="button" class="sw-tab-btn ' + (activeTab === 'capture-sessions' ? 'active' : '') + '" data-sw-tab="capture-sessions">🔍 抓包会话 (TF436)</button>',
      '  <button type="button" class="sw-tab-btn ' + (activeTab === 'surge-settings' ? 'active' : '') + '" data-sw-tab="surge-settings">⚙️ 联动与运行状态</button>',
      '  <button type="button" class="sw-tab-btn ' + (activeTab === 'guide' ? 'active' : '') + '" data-sw-tab="guide">📖 Surge 配置向导</button>',
      '  <button type="button" class="sw-tab-btn ' + (activeTab === 'raw-editor' ? 'active' : '') + '" data-sw-tab="raw-editor">📝 原生配置编辑</button>',
      '</div>'
    ].join('');
  }

  // ==================== 1. 模块工作台 ====================

  function renderModulesView() {
    return [
      '<div class="sw-panel" id="sw-panel-modules">',
      '  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:10px">',
      '    <div>',
      '      <h2 style="font-size:16px;margin:0 0 4px">已托管 App 净化模块</h2>',
      '      <p style="font-size:12px;opacity:0.75;margin:0">所有模块中的域名拦截已被 LocalDNS 本地吸收并纳秒级阻断，仅向 Surge 注入必要之七层重写。</p>',
      '    </div>',
      '    <div style="display:flex;gap:8px;flex-wrap:wrap">',
      '      <button type="button" class="button small" id="sw-btn-install-surge" style="background:#10B981;color:#fff">📲 导入至 Surge</button>',
      '      <button type="button" class="button small" id="sw-btn-refresh-all-modules">🔄 全部更新</button>',
      '      <button type="button" class="button small primary" id="sw-btn-import-remote-mod">🌐 导入远程模块 (URL)</button>',
      '      <button type="button" class="button small" id="sw-btn-add-module-raw">+ 粘贴文本导入</button>',
      '    </div>',
      '  </div>',
      '  <div id="sw-modules-list" style="display:grid;grid-template-columns:repeat(auto-fill, minmax(290px, 1fr));gap:12px">',
      '    <div style="padding:30px;text-align:center;opacity:0.6;grid-column:1/-1">正在读取模块数据库…</div>',
      '  </div>',
      '</div>'
    ].join('');
  }

  // ==================== 2. 动态分流治理 ====================

  function renderDiversionView() {
    return [
      '<div class="sw-panel" id="sw-panel-diversion">',
      '  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:10px">',
      '    <div>',
      '      <h2 style="font-size:16px;margin:0 0 4px">动态分流规则治理中枢</h2>',
      '      <p style="font-size:12px;opacity:0.75;margin:0">全量分流规则入库 SQLite 托管，支持单条细则增删改查、全组多行编辑与零重启动态订阅。</p>',
      '    </div>',
      '    <div style="display:flex;gap:8px;flex-wrap:wrap">',
      '      <button type="button" class="button small primary" id="sw-btn-batch-rules" style="background:#8B5CF6;color:#fff;border-color:transparent">⚡️ 批量导入 Surge 规则 (一键清洗)</button>',
      '      <button type="button" class="button small" id="sw-btn-add-rule">+ 添加单条规则</button>',
      '      <button type="button" class="button small" id="sw-btn-create-group">+ 新建分流组</button>',
      '      <button type="button" class="button small" id="sw-btn-refresh-remote-rules">🔄 更新远程规则集</button>',
      '      <button type="button" class="button small" id="sw-btn-export-conf" style="background:#0284C7;color:#fff;border-color:transparent">🚀 生成/导出 Surge 配置</button>',
      '    </div>',
      '  </div>',
      '  <!-- 规则治理体征与统计概览卡片 -->',
      '  <div id="sw-diversion-summary" class="glass-card" style="padding:12px 16px;margin-bottom:14px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;font-size:13px">',
      '    <div style="display:flex;gap:18px;flex-wrap:wrap">',
      '      <span><strong>分流规则组：</strong><span id="sw-stat-total-groups" style="color:#3B82F6;font-weight:700">0</span> 组</span>',
      '      <span><strong>已收录规则总量：</strong><span id="sw-stat-total-rules" style="color:#10B981;font-weight:700">0</span> 条</span>',
      '      <span><strong>已启用分流组：</strong><span id="sw-stat-active-groups" style="color:#8B5CF6;font-weight:700">0</span> 组</span>',
      '    </div>',
      '    <div style="font-size:12px;opacity:0.75">💡 点击每个分流组卡片上的「📋 规则明细」即可搜索、修改或删除细则条目</div>',
      '  </div>',
      '  <!-- 外部规则集独立管理看板 -->',
      '  <div class="glass-card" style="padding:16px;margin-bottom:14px;border:1px solid rgba(59,130,246,0.3)">',
      '    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-wrap:wrap;gap:8px">',
      '      <div style="display:flex;align-items:center;gap:8px">',
      '        <strong style="font-size:15px">📦 已订阅外部规则集 (Remote Rule Sets)</strong>',
      '        <span id="sw-stat-rulesets-count" style="font-size:12px;padding:2px 8px;background:rgba(59,130,246,0.15);color:#3B82F6;border-radius:10px;font-weight:700">0</span>',
      '      </div>',
      '      <div style="display:flex;gap:6px">',
      '        <button type="button" class="button small primary" id="sw-btn-quick-add-ruleset" style="background:#10B981;color:#fff;border-color:transparent">+ 订阅外部规则集 (URL)</button>',
      '        <button type="button" class="button small" id="sw-btn-quick-refresh-rulesets">🔄 一键更新全部规则集</button>',
      '      </div>',
      '    </div>',
      '    <p style="font-size:12px;opacity:0.75;margin:0 0 12px">每一个外部规则集均保留原始直链与独占特有统计。删除规则集时<strong>自动识别多源重叠，仅清除独占特有规则，保留共有规则</strong>，实现无感安全瘦身！</p>',
      '    <div id="sw-rulesets-list" style="display:grid;grid-template-columns:repeat(auto-fill, minmax(330px, 1fr));gap:10px">',
      '      <div style="padding:20px;text-align:center;opacity:0.6;grid-column:1/-1">正在读取已订阅外部规则集…</div>',
      '    </div>',
      '  </div>',
      '  <div id="sw-groups-list" style="display:flex;flex-direction:column;gap:12px">',
      '    <div style="padding:20px;text-align:center;opacity:0.6">正在加载分流数据库…</div>',
      '  </div>',
      '</div>'
    ].join('');
  }

  // ==================== 3. 联动与运行状态 ====================

  function renderSurgeSettingsView() {
    return [
      '<div class="sw-panel" id="sw-panel-surge-settings">',
      '  <!-- 连通性测试结果面板 (默认隐藏，测试后展示) -->',
      '  <div id="sw-conn-result-card" class="glass-card" style="display:none;padding:16px;margin-bottom:16px;border-left:4px solid #3B82F6"></div>',
      '',
      '  <!-- Surge 运行仪表盘 -->',
      '  <div class="glass-card" style="padding:16px;margin-bottom:16px">',
      '    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">',
      '      <h3 style="font-size:14px;font-weight:600;margin:0">Surge 实时运行体征</h3>',
      '      <button type="button" class="button small" id="sw-btn-refresh-runtime">🔄 刷新状态</button>',
      '    </div>',
      '    <div id="sw-runtime-dashboard" style="display:grid;grid-template-columns:repeat(auto-fit, minmax(180px, 1fr));gap:10px">',
      '      <div style="padding:12px;background:rgba(255,255,255,0.03);border-radius:8px">正在检测 Surge 状态…</div>',
      '    </div>',
      '    <div style="margin-top:12px;padding-top:10px;border-top:1px solid rgba(148,163,184,0.15);display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">',
      '      <span style="font-size:12px;opacity:0.8">快速出站模式切换：</span>',
      '      <div style="display:flex;gap:6px">',
      '        <button type="button" class="button small sw-btn-mode" data-mode="direct">DIRECT 直连</button>',
      '        <button type="button" class="button small sw-btn-mode" data-mode="rule">RULE 分流</button>',
      '        <button type="button" class="button small sw-btn-mode" data-mode="proxy">PROXY 全局</button>',
      '      </div>',
      '    </div>',
      '  </div>',
      '',
      '  <!-- 联动参数配置表单 -->',
      '  <div class="glass-card" style="padding:18px">',
      '    <h3 style="font-size:14px;font-weight:600;margin:0 0 12px">Surge HTTP API 联动参数</h3>',
      '    <div style="margin-bottom:14px">',
      '      <label style="display:flex;align-items:center;gap:8px;font-size:14px;font-weight:600;cursor:pointer">',
      '        <input type="checkbox" id="sw-surge-enabled" /> 开启与本机/局域网 Surge 自动联动控制',
      '      </label>',
      '      <p style="font-size:12px;opacity:0.75;margin:4px 0 0 24px">开启后，模块与分流规则变动将自动反向通知 Surge 刷新，DNS 测速超时时自动调度策略自愈。</p>',
      '    </div>',
      '    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px">',
      '      <div>',
      '        <label style="font-size:12px;font-weight:600">Surge HTTP API 地址</label>',
      '        <input type="text" id="sw-surge-url" placeholder="http://127.0.0.1:6171" style="width:100%;margin-top:4px;padding:8px;border-radius:6px;border:1px solid rgba(148,163,184,0.3);background:transparent" />',
      '      </div>',
      '      <div>',
      '        <label style="font-size:12px;font-weight:600">API 访问密钥 (X-Key)</label>',
      '        <input type="password" id="sw-surge-key" placeholder="Surge 配置中的 http-api 密钥" style="width:100%;margin-top:4px;padding:8px;border-radius:6px;border:1px solid rgba(148,163,184,0.3);background:transparent" />',
      '      </div>',
      '    </div>',
      '    <div style="margin-bottom:14px;border-top:1px solid rgba(148,163,184,0.15);padding-top:12px">',
      '      <h4 style="font-size:13px;margin:0 0 8px">自动化调度与防护策略</h4>',
      '      <label style="display:flex;align-items:center;gap:8px;font-size:13px;margin-bottom:6px;cursor:pointer">',
      '        <input type="checkbox" id="sw-surge-auto-switch" checked /> DNS 海外节点多次超时时，自动触发 Surge 策略组测速与自愈',
      '      </label>',
      '      <label style="display:flex;align-items:center;gap:8px;font-size:13px;margin-bottom:6px;cursor:pointer">',
      '        <input type="checkbox" id="sw-surge-auto-learn" checked /> 测速彻底失败或遭受污染的域名，自动学习升阶并分配走代理',
      '      </label>',
      '      <label style="display:flex;align-items:center;gap:8px;font-size:13px;margin-bottom:6px;cursor:pointer">',
      '        <input type="checkbox" id="sw-surge-kill-blocked" checked /> 命中 AdGuard 广告与高危追踪域名时，主动通过 API 掐断活跃长连接 (Kill Active Requests)',
      '      </label>',
      '    </div>',
      '    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">',
      '      <span id="sw-surge-sync-status" style="font-size:12px;opacity:0.7">尚未同步</span>',
      '      <div style="display:flex;gap:8px">',
      '        <button type="button" class="button" id="sw-btn-test-in-form">🔌 测试连接</button>',
      '        <button type="button" class="button primary" id="sw-btn-save-surge-config">保存配置</button>',
      '      </div>',
      '    </div>',
      '  </div>',
      '</div>'
    ].join('');
  }

  // ==================== 3.5 Surge TF436 落盘抓包会话审查 ====================

  var currentCaptureSession = '';
  var currentSessionOffset = 0;
  var currentSessionLimit = 50;
  var currentSessionRequests = [];
  var cachedSessionsList = [];

  function renderCaptureSessionsView() {
    return [
      '<div class="sw-panel" id="sw-panel-capture">',
      '  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:10px">',
      '    <div>',
      '      <h2 style="font-size:16px;margin:0 0 4px">Surge 历史抓包会话审查 (TF436+)</h2>',
      '      <p style="font-size:12px;opacity:0.75;margin:0">直接读取 Surge 归档到磁盘的 Saved Capture Sessions，支持全量请求检索与 Raw Request/Response 报文下钻。</p>',
      '    </div>',
      '    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">',
      '      <select id="sw-cs-select" class="sw-select" style="min-width:240px;margin-top:0"><option value="">加载中…</option></select>',
      '      <button type="button" class="button small" id="sw-cs-refresh-btn">🔄 刷新会话</button>',
      '      <a href="/ui/ad-hunter.html" target="_blank" class="button small primary" style="background:#8B5CF6;color:#fff;border-color:transparent;text-decoration:none;display:inline-flex;align-items:center;gap:4px">🛡️ 去广告提纯</a>',
      '    </div>',
      '  </div>',
      '  <div id="sw-cs-meta-bar" style="display:flex;gap:16px;padding:10px 14px;background:rgba(148,163,184,0.08);border-radius:10px;margin-bottom:12px;font-size:12px;flex-wrap:wrap;align-items:center">',
      '    <span>正在读取会话…</span>',
      '  </div>',
      '  <div style="margin-bottom:12px;display:flex;gap:10px;align-items:center">',
      '    <input type="text" id="sw-cs-search-input" class="sw-input" style="flex:1;margin-top:0" placeholder="🔍 筛选 URL 关键词、域名、状态码 (如 200) 或进程名..." />',
      '    <span id="sw-cs-filtered-count" style="font-size:12px;opacity:0.75;white-space:nowrap"></span>',
      '  </div>',
      '  <div id="sw-cs-table-wrap" class="table-wrap" style="background:rgba(255,255,255,0.02);border:1px solid rgba(148,163,184,0.15);border-radius:10px;max-height:600px;overflow-y:auto">',
      '    <div style="padding:40px;text-align:center;opacity:0.6">加载中…</div>',
      '  </div>',
      '  <div id="sw-cs-pagination" style="display:flex;justify-content:space-between;align-items:center;margin-top:10px;font-size:12px"></div>',
      '</div>'
    ].join('');
  }

  async function loadCaptureSessions() {
    var metaBar = q('#sw-cs-meta-bar');
    var selectEl = q('#sw-cs-select');
    var tableWrap = q('#sw-cs-table-wrap');

    try {
      var res = await fetch('/api/v1/surge/capture/sessions');
      var data = await res.json();
      cachedSessionsList = data.sessions || [];

      if (cachedSessionsList.length === 0) {
        if (selectEl) selectEl.innerHTML = '<option value="">⚠️ 暂无保存的会话</option>';
        if (metaBar) metaBar.innerHTML = '<span>⚠️ Surge 尚未保存落盘抓包会话。请在 iPhone/Mac Surge 中开启「抓包」录制并保存会话后刷新。</span>';
        if (tableWrap) tableWrap.innerHTML = '<div style="padding:40px;text-align:center;opacity:0.6">暂无抓包请求数据</div>';
        return;
      }

      if (selectEl) {
        selectEl.innerHTML = cachedSessionsList.map(function (s) {
          return '<option value="' + s.name + '" ' + (s.name === currentCaptureSession ? 'selected' : '') + '>' + s.name + (s.requestCount ? ' (' + s.requestCount + ' 条请求)' : '') + '</option>';
        }).join('');
      }

      if (!currentCaptureSession || !cachedSessionsList.some(function (s) { return s.name === currentCaptureSession; })) {
        currentCaptureSession = cachedSessionsList[0].name;
      }

      renderSessionMeta();
      await loadSessionRequests(currentCaptureSession, 0);
    } catch (e) {
      if (metaBar) metaBar.innerHTML = '<span style="color:#EF4444">❌ 读取 Surge 抓包会话失败: ' + (e.message || e) + '</span>';
    }
  }

  function renderSessionMeta() {
    var metaBar = q('#sw-cs-meta-bar');
    if (!metaBar) return;
    var current = cachedSessionsList.find(function (s) { return s.name === currentCaptureSession; });
    if (!current) {
      metaBar.innerHTML = '<span>未选中有效会话</span>';
      return;
    }

    var startStr = current.startTime ? new Date(current.startTime * 1000).toLocaleString('zh-CN') : '--';
    var endStr = current.endTime ? new Date(current.endTime * 1000).toLocaleString('zh-CN') : '--';
    var countStr = current.requestCount ? current.requestCount + ' 条' : '--';
    var reason = current.stopReason || '正常结束';

    metaBar.innerHTML = [
      '<div><strong>会话名称:</strong> <code style="color:#60A5FA">' + current.name + '</code></div>',
      '<div><strong>记录条数:</strong> ' + countStr + '</div>',
      '<div><strong>开始:</strong> ' + startStr + '</div>',
      '<div><strong>结束:</strong> ' + endStr + '</div>',
      '<div><strong>终止原因:</strong> <span class="badge" style="background:rgba(16,185,129,0.15);color:#34D399">' + reason + '</span></div>'
    ].join('');
  }

  async function loadSessionRequests(sessionName, offset) {
    var tableWrap = q('#sw-cs-table-wrap');
    if (!tableWrap) return;
    tableWrap.innerHTML = '<div style="padding:40px;text-align:center;opacity:0.6">正在拉取请求列表…</div>';
    currentSessionOffset = offset || 0;

    try {
      var res = await fetch('/api/v1/surge/capture/requests?name=' + encodeURIComponent(sessionName) + '&offset=' + currentSessionOffset + '&limit=' + currentSessionLimit);
      var data = await res.json();
      currentSessionRequests = data.requests || [];
      renderSessionRequestsTable();
    } catch (e) {
      tableWrap.innerHTML = '<div style="padding:40px;text-align:center;color:#EF4444">加载请求失败: ' + e.message + '</div>';
    }
  }

  function renderSessionRequestsTable() {
    var tableWrap = q('#sw-cs-table-wrap');
    var countLabel = q('#sw-cs-filtered-count');
    var pagination = q('#sw-cs-pagination');
    var searchInput = q('#sw-cs-search-input');
    var searchVal = (searchInput ? searchInput.value : '').toLowerCase().trim();

    if (!tableWrap) return;

    var filtered = currentSessionRequests.filter(function (r) {
      if (!searchVal) return true;
      var url = (r.URL || r.url || '').toLowerCase();
      var method = (r.method || '').toLowerCase();
      var host = (r.notes && r.notes.host ? r.notes.host : (r.host || '')).toLowerCase();
      var status = String(r.statusCode || r.status || '');
      return url.includes(searchVal) || method.includes(searchVal) || host.includes(searchVal) || status.includes(searchVal);
    });

    if (countLabel) {
      countLabel.textContent = '当前显示 ' + filtered.length + ' / ' + currentSessionRequests.length + ' 条请求';
    }

    if (filtered.length === 0) {
      tableWrap.innerHTML = '<div style="padding:40px;text-align:center;opacity:0.6">无符合条件的请求记录</div>';
      return;
    }

    var rows = filtered.map(function (r, idx) {
      var id = r.key || r.id || idx;
      var method = r.method || 'GET';
      var url = r.URL || r.url || '--';
      var status = r.statusCode || (r.failed ? 'Failed' : (r.completed ? '200' : 'Active'));
      var isSuccess = String(status).startsWith('2') || status === 'Active';
      var statusColor = isSuccess ? '#10B981' : (String(status).startsWith('3') ? '#3B82F6' : '#EF4444');
      var inB = r.inBytes || 0;
      var inSizeStr = inB > 1024 ? (inB / 1024).toFixed(1) + ' KB' : inB + ' B';
      var devName = r.deviceName || r.localAddress || '--';

      return [
        '<tr>',
        '  <td style="font-family:monospace;font-size:11px;opacity:0.6">' + id + '</td>',
        '  <td><span style="font-weight:700;font-size:11px;padding:2px 6px;border-radius:4px;background:rgba(148,163,184,0.15)">' + method + '</span></td>',
        '  <td><span style="color:' + statusColor + ';font-weight:600;font-size:12px">' + status + '</span></td>',
        '  <td style="max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + url + '">',
        '    <span style="font-size:12px;font-family:monospace">' + url + '</span>',
        '  </td>',
        '  <td style="font-size:12px;opacity:0.8">' + devName + '</td>',
        '  <td style="font-size:11px;opacity:0.75;font-family:monospace">↓' + inSizeStr + '</td>',
        '  <td>',
        '    <button type="button" class="button small sw-cs-detail-btn" data-cs-key="' + id + '" style="padding:2px 8px;font-size:11px">🔍 报文</button>',
        '  </td>',
        '</tr>'
      ].join('');
    });

    tableWrap.innerHTML = [
      '<table class="sw-table" style="width:100%;font-size:12px">',
      '  <thead><tr><th>ID</th><th>方法</th><th>状态</th><th>URL / 路径</th><th>设备/来源</th><th>大小</th><th>操作</th></tr></thead>',
      '  <tbody>' + rows.join('') + '</tbody>',
      '</table>'
    ].join('');

    // 绑定报文点击事件
    qq('.sw-cs-detail-btn', tableWrap).forEach(function (btn) {
      btn.onclick = function () {
        var key = btn.dataset.csKey;
        var targetReq = currentSessionRequests.find(function (x) { return (x.key || String(x.id)) === key; });
        if (targetReq) showCaptureRequestModal(currentCaptureSession, targetReq);
      };
    });

    if (pagination) {
      var prevDisabled = currentSessionOffset === 0 ? 'disabled' : '';
      var nextDisabled = currentSessionRequests.length < currentSessionLimit ? 'disabled' : '';
      pagination.innerHTML = [
        '<button type="button" class="button small" id="sw-cs-prev-btn" ' + prevDisabled + '>‹ 上一页</button>',
        '<span>偏移: ' + currentSessionOffset + ' (每页 ' + currentSessionLimit + ' 条)</span>',
        '<button type="button" class="button small" id="sw-cs-next-btn" ' + nextDisabled + '>下一页 ›</button>'
      ].join('');

      var prevBtn = q('#sw-cs-prev-btn');
      var nextBtn = q('#sw-cs-next-btn');
      if (prevBtn) prevBtn.onclick = function () {
        loadSessionRequests(currentCaptureSession, Math.max(0, currentSessionOffset - currentSessionLimit));
      };
      if (nextBtn) nextBtn.onclick = function () {
        loadSessionRequests(currentCaptureSession, currentSessionOffset + currentSessionLimit);
      };
    }
  }

  async function showCaptureRequestModal(sessionName, req) {
    var key = req.key || String(req.id);
    var url = req.URL || req.url || '';
    var method = req.method || 'GET';

    var html = [
      '<div style="font-size:12px;line-height:1.6">',
      '  <div style="padding:10px;background:rgba(148,163,184,0.08);border-radius:8px;margin-bottom:12px">',
      '    <div><strong>URL:</strong> <code style="word-break:break-all;color:#60A5FA">' + url + '</code></div>',
      '    <div style="display:flex;gap:12px;margin-top:4px">',
      '      <span><strong>方法:</strong> ' + method + '</span>',
      '      <span><strong>策略:</strong> ' + (req.policyName || 'DIRECT') + '</span>',
      '      <span><strong>客户端:</strong> ' + (req.localAddress || req.sourceAddress || '--') + '</span>',
      '    </div>',
      '  </div>',
      '  <div style="display:flex;gap:8px;margin-bottom:10px">',
      '    <button type="button" class="tab-btn active" id="sw-crm-tab-res" style="border-radius:6px;padding:4px 12px">📥 响应体 (Response)</button>',
      '    <button type="button" class="tab-btn" id="sw-crm-tab-req" style="border-radius:6px;padding:4px 12px">📤 请求体 (Request)</button>',
      '  </div>',
      '  <pre id="sw-crm-body" style="background:#0b0f19;color:#e2e8f0;padding:12px;border-radius:8px;max-height:380px;overflow:auto;font-family:monospace;font-size:11px;white-space:pre-wrap;word-break:break-all">正在拉取响应报文数据…</pre>',
      '</div>'
    ].join('');

    openModal('🔍 抓包报文审查 [' + key + ']', html, null, null);

    async function loadBody(type) {
      var pre = q('#sw-crm-body');
      if (!pre) return;
      pre.textContent = '正在从 Surge 提取原始 ' + type + ' 报文…';
      try {
        var res = await fetch('/api/v1/surge/capture/data?name=' + encodeURIComponent(sessionName) + '&key=' + encodeURIComponent(key) + '&type=' + type);
        var d = await res.json();
        var txt = d.text || '';
        try {
          txt = JSON.stringify(JSON.parse(txt), null, 2);
        } catch (_) {}
        pre.textContent = txt || '（空报文内容）';
      } catch (e) {
        pre.textContent = '提取报文异常: ' + e.message;
      }
    }

    loadBody('response');

    var tabRes = q('#sw-crm-tab-res');
    var tabReq = q('#sw-crm-tab-req');
    if (tabRes && tabReq) {
      tabRes.onclick = function () {
        tabRes.classList.add('active');
        tabReq.classList.remove('active');
        loadBody('response');
      };
      tabReq.onclick = function () {
        tabReq.classList.add('active');
        tabRes.classList.remove('active');
        loadBody('request');
      };
    }
  }

  // ==================== 4. Surge 配置向导 ====================

  function renderGuideView() {
    var origin = location.origin;
    var host = location.hostname || '127.0.0.1';
    var httpPort = (location.protocol === 'http:' && location.port) ? location.port : '9099';
    var httpOrigin = 'http://' + host + ':' + httpPort;
    var confUrl = httpOrigin + '/surge/localdns.conf';
    var hubUrl = httpOrigin + '/surge/hub.sgmodule';
    var blockUrl = httpOrigin + '/rules/block.list';
    var directUrl = httpOrigin + '/rules/direct.list';
    var proxyUrl = httpOrigin + '/rules/proxy.list';
    var mediaUrl = httpOrigin + '/rules/media.list';

    var surgeGeneralSnippet = [
      '[General]',
      '# 1. 安全 DoH 接管：将全机 DNS 交由 LocalDNS 过滤（18.5万条 AdGuard + 模块脱水秒级黑洞）',
      'doh-server = https://127.0.0.1:9443/dns-query',
      'skip-proxy = 127.0.0.1, 192.168.0.0/16, 10.0.0.0/8, 172.16.0.0/12, localhost, *.local, captive.apple.com',
      '',
      '# 2. 拦截 QUIC（UDP 443）：逼迫 YouTube 等 App 回退 TCP，才能被 MitM 解密去广告',
      'block-quic = true',
      '',
      '# 3. 开启 HTTP API (LocalDNS 与 Surge 实时双向调度中枢)',
      'http-api = localdnskey@0.0.0.0:6171',
      'http-api-tls = false',
      'http-api-web-dashboard = false'
    ].join('\n');

    var surgeRulesSnippet = [
      '[Rule]',
      '# 1. 拦截 QUIC（UDP 443），迫使其走 TCP 以便解密与脚本去广告',
      'AND,((PROTOCOL,UDP),(DEST-PORT,443)),REJECT-NO-DROP',
      '',
      '# 2. LocalDNS 动态广告与黑洞拦截规则集（5.3万条规则，必须置于 [Rule] 最顶部）',
      'RULE-SET,' + blockUrl + ',REJECT',
      '',
      '# 3. LocalDNS 动态分流托管规则集',
      'RULE-SET,' + directUrl + ',DIRECT',
      'RULE-SET,' + proxyUrl + ',PROXY',
      'RULE-SET,' + mediaUrl + ',PROXY',
      '',
      '# 4. 兜底规则',
      'GEOIP,CN,DIRECT',
      'FINAL,PROXY,dns-failed'
    ].join('\n');

    return [
      '<div class="sw-panel" id="sw-panel-guide">',
      '  <div class="glass-card" style="padding:20px;max-width:780px">',
      '    <h2 style="font-size:17px;margin:0 0 8px">📖 Surge 联动配置向导</h2>',
      '    <p style="font-size:13px;opacity:0.8;margin:0 0 20px;line-height:1.5">LocalDNS 与 Surge 深度缝合，支持一键生成标准 .conf 配置文件直接导入，亦可分步局部集成。</p>',
      '',
      '    <!-- 核心重点：一键自动生成 Surge 完整配置文件 -->',
      '    <div style="margin-bottom:24px;padding:16px 18px;background:linear-gradient(135deg, rgba(59,130,246,0.12), rgba(16,185,129,0.08));border-radius:12px;border:1px solid rgba(59,130,246,0.35)">',
      '      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:12px">',
      '        <div>',
      '          <strong style="font-size:15px;color:var(--text-1, #191816)">🚀 一键生成 Surge 完整配置文件 (.conf)</strong>',
      '          <p style="font-size:12px;opacity:0.8;margin:4px 0 0">已按照 Surge 规范生成完整配置（含 General、DNS 指向、Proxy Group、动态 RULE-SET 与 Hub 模块）。</p>',
      '        </div>',
      '        <div style="display:flex;gap:6px;flex-wrap:wrap">',
      '          <button type="button" class="button small primary" id="sw-guide-open-conf" style="background:#10B981;color:#fff;border-color:transparent">📲 一键调起 Surge 安装</button>',
      '          <button type="button" class="button small" id="sw-guide-download-conf">📥 下载 .conf 文件</button>',
      '          <button type="button" class="button small" id="sw-guide-copy-full-conf">📋 复制全部配置</button>',
      '          <button type="button" class="button small" id="sw-guide-customize-conf">⚙️ 定制/预览</button>',
      '        </div>',
      '      </div>',
      '      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">',
      '        <span style="font-size:12px;opacity:0.75;white-space:nowrap">Surge 在线下载直链:</span>',
      '        <input type="text" readonly value="' + confUrl + '" id="sw-guide-conf-url-input" style="flex:1;min-width:200px;padding:6px 10px;font-size:12px;border-radius:6px;border:1px solid rgba(148,163,184,0.3);background:transparent" />',
      '        <button type="button" class="button small" id="sw-guide-copy-conf-url">复制链接</button>',
      '      </div>',
      '      <p style="font-size:11px;opacity:0.65;margin:6px 0 0">💡 在 Surge App 中点击「Download Profile from Web」，粘贴上方直链即可一秒完整导入并自动更新。</p>',
      '    </div>',
      '',
      '    <h3 style="font-size:14px;margin:0 0 12px;opacity:0.9">或者：将 LocalDNS 局部集成到现有 Surge 配置中（3 步教程）</h3>',
      '',
      '    <!-- 步骤 1 -->',
      '    <div style="margin-bottom:20px;padding:14px;background:rgba(255,255,255,0.03);border-radius:10px;border-left:4px solid #3B82F6">',
      '      <h3 style="font-size:14px;margin:0 0 6px">第一步：在 Surge 中开启 HTTP API 控制通道</h3>',
      '      <p style="font-size:12px;opacity:0.8;margin:0 0 10px">打开 Surge 的主配置文件（或文本编辑），在 <code>[General]</code> 段落中加入以下配置：</p>',
      '      <pre class="sw-code-pre">' + surgeGeneralSnippet + '</pre>',
      '      <div style="display:flex;justify-content:flex-end">',
      '        <button type="button" class="button small" id="sw-guide-copy-general">📋 复制 [General] 配置片段</button>',
      '      </div>',
      '    </div>',
      '',
      '    <!-- 步骤 2 -->',
      '    <div style="margin-bottom:20px;padding:14px;background:rgba(255,255,255,0.03);border-radius:10px;border-left:4px solid #10B981">',
      '      <h3 style="font-size:14px;margin:0 0 6px">第二步：安装 LocalDNS 统一脱水调度模块</h3>',
      '      <p style="font-size:12px;opacity:0.8;margin:0 0 10px">在 Surge 中安装此模块（终身只需装这一个），所有 App 模块的七层规则均由该模块动态编译下发：</p>',
      '      <div style="display:flex;gap:8px;margin-bottom:10px">',
      '        <input type="text" readonly value="' + hubUrl + '" style="flex:1;padding:6px 10px;font-size:12px;border-radius:6px;border:1px solid rgba(148,163,184,0.3);background:transparent" />',
      '        <button type="button" class="button small primary" id="sw-guide-open-hub">📲 一键调起 Surge 安装</button>',
      '      </div>',
      '    </div>',
      '',
      '    <!-- 步骤 3 -->',
      '    <div style="margin-bottom:20px;padding:14px;background:rgba(255,255,255,0.03);border-radius:10px;border-left:4px solid #F59E0B">',
      '      <h3 style="font-size:14px;margin:0 0 6px">第三步：在 Surge 中引用动态 RULE-SET 分流</h3>',
      '      <p style="font-size:12px;opacity:0.8;margin:0 0 10px">将 Surge 配置文件中的 <code>[Rule]</code> 段落精简为以下内容，分流规则变动即可在 LocalDNS 网页端秒更，Surge 零重启：</p>',
      '      <pre class="sw-code-pre">' + surgeRulesSnippet + '</pre>',
      '      <div style="display:flex;justify-content:flex-end">',
      '        <button type="button" class="button small" id="sw-guide-copy-rules">📋 复制 [Rule] 配置片段</button>',
      '      </div>',
      '    </div>',
      '',
      '    <!-- FAQ 排查 -->',
      '    <div style="padding:14px;background:rgba(148,163,184,0.06);border-radius:10px">',
      '      <h4 style="font-size:13px;margin:0 0 6px">常见问题排查（FAQ）：</h4>',
      '      <ul style="font-size:12px;opacity:0.85;margin:0;padding-left:18px;line-height:1.6">',
      '        <li><strong>提示连通失败或超时？</strong> 请核对 Surge 是否已启动，且在同一个 Wi-Fi 网络（若 LocalDNS 与 Surge 在同一台手机上，API 地址填 <code>http://127.0.0.1:6171</code> 即可）。</li>',
      '        <li><strong>密钥报错 401/403？</strong> 请检查 Surge <code>http-api</code> 等号前的密钥与 LocalDNS 设置中填写的密钥是否完全一致。</li>',
      '      </ul>',
      '    </div>',
      '  </div>',
      '</div>'
    ].join('');
  }

  // ==================== 数据交互与业务逻辑 ====================

  // 刷新模块列表
  async function loadModules() {
    var container = q('#sw-modules-list');
    if (!container) return;
    try {
      var res = await fetch('/api/v1/surge/modules');
      var data = await res.json();
      if (!data.modules || data.modules.length === 0) {
        container.innerHTML = '<div style="padding:30px;text-align:center;opacity:0.6;grid-column:1/-1">暂无 App 净化模块。可点击上方「🌐 导入远程模块 (URL)」填入 GitHub 模块链接。</div>';
        return;
      }
      container.innerHTML = data.modules.map(function (m) {
        return [
          '<div class="glass-card" style="padding:14px;display:flex;flex-direction:column;justify-content:space-between;border:1px solid ' + (m.enabled ? 'rgba(16,185,129,0.3)' : 'rgba(148,163,184,0.2)') + '">',
          '  <div>',
          '    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">',
          '      <strong style="font-size:14px">' + m.name + '</strong>',
          '      <label style="cursor:pointer;display:inline-flex;align-items:center">',
          '        <input type="checkbox" class="sw-mod-toggle" data-mod-id="' + m.id + '" ' + (m.enabled ? 'checked' : '') + ' />',
          '      </label>',
          '    </div>',
          '    <div style="font-size:12px;opacity:0.8;margin-bottom:8px">分类: ' + (m.category || 'app') + ' · 状态: ' + (m.enabled ? '<span style="color:#10B981">运行中</span>' : '<span style="opacity:0.6">已关闭</span>') + '</div>',
          '    <div style="font-size:11px;padding:6px 8px;background:rgba(148,163,184,0.1);border-radius:6px;line-height:1.5">',
          '      ⚡️ 域名拦截已在 LocalDNS 纳秒阻断<br/>',
          '      🛡 提纯后的七层重写由 Surge 统一调度',
          '    </div>',
          '  </div>',
          '  <div style="display:flex;justify-content:flex-end;margin-top:10px;gap:6px;flex-wrap:wrap">',
          (m.hasArguments || (m.arguments_schema && m.arguments_schema.length > 0) ? '    <button type="button" class="button small primary sw-btn-params-mod" data-mod-id="' + m.id + '" data-mod-name="' + m.name + '" style="background:rgba(59,130,246,0.15);color:#3B82F6;border-color:rgba(59,130,246,0.35)">🎛 编辑参数</button>' : ''),
          (m.source_url ? '    <button type="button" class="button small sw-btn-refresh-mod" data-mod-id="' + m.id + '">🔄 更新</button>' : ''),
          '    <button type="button" class="button small sw-btn-edit-mod" data-mod-id="' + m.id + '" data-mod-name="' + m.name + '">✏️ 查看代码</button>',
          '    <button type="button" class="button small sw-btn-del-mod" data-mod-id="' + m.id + '" style="color:#EF4444;border-color:rgba(239,68,68,0.3)">删除</button>',
          '  </div>',
          '</div>'
        ].join('');
      }).join('');

      // 开关事件
      qq('.sw-mod-toggle', container).forEach(function (chk) {
        chk.onchange = async function () {
          var id = chk.dataset.modId;
          var en = chk.checked;
          await fetch('/api/v1/surge/modules/' + encodeURIComponent(id) + '/toggle', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled: en }),
          });
          toast('模块状态已更新', (en ? '已开启 ' : '已关闭 ') + id);
          loadModules();
        };
      });

      // 单个模块远程更新事件
      qq('.sw-btn-refresh-mod', container).forEach(function (btn) {
        btn.onclick = async function () {
          var id = btn.dataset.modId;
          var old = btn.textContent;
          btn.disabled = true;
          btn.textContent = '更新中…';
          try {
            var r = await fetch('/api/v1/surge/modules/' + encodeURIComponent(id) + '/refresh', { method: 'POST' });
            var d = await r.json();
            if (d.success) toast('模块已更新', '重新脱水 ' + (d.rules || 0) + ' 条规则 · 请到 Surge 中更新模块生效');
            else alert('更新失败: ' + (d.error || '未知错误'));
          } catch (e) {
            alert('更新失败: ' + e.message);
          }
          btn.disabled = false;
          btn.textContent = old;
          loadModules();
        };
      });

      // 编辑参数事件 (1:1 复刻 Surge 风格参数表单面板)
      qq('.sw-btn-params-mod', container).forEach(function (btn) {
        btn.onclick = async function () {
          var id = btn.dataset.modId;
          var name = btn.dataset.modName;
          try {
            var res = await fetch('/api/v1/surge/modules/' + encodeURIComponent(id) + '/arguments');
            var data = await res.json();
            if (!data.success) {
              alert('获取模块参数失败: ' + (data.error || '未知错误'));
              return;
            }

            var schema = data.schema || [];
            var customArgs = data.customArguments || {};
            var desc = data.desc || '';

            if (schema.length === 0) {
              alert('该模块未声明 #!arguments 参数表');
              return;
            }

            var formRows = schema.map(function (item) {
              var currentVal = customArgs[item.key] !== undefined ? customArgs[item.key] : item.defaultValue;
              var isSwitch = item.defaultValue === '0' || item.defaultValue === '1' || item.defaultValue === 'true' || item.defaultValue === 'false';
              
              var inputControl = '';
              if (isSwitch) {
                var isChecked = currentVal === '1' || currentVal === 'true';
                inputControl = [
                  '<label style="position:relative;display:inline-block;width:44px;height:24px;cursor:pointer">',
                  '  <input type="checkbox" class="sw-arg-input sw-arg-switch" data-key="' + item.key + '" ' + (isChecked ? 'checked' : '') + ' style="opacity:0;width:0;height:0" />',
                  '  <span style="position:absolute;inset:0;background:' + (isChecked ? '#10B981' : 'rgba(148,163,184,0.3)') + ';border-radius:24px;transition:0.2s">',
                  '    <span style="position:absolute;left:' + (isChecked ? '22px' : '2px') + ';top:2px;width:20px;height:20px;background:#fff;border-radius:50%;transition:0.2s;box-shadow:0 1px 3px rgba(0,0,0,0.3)"></span>',
                  '  </span>',
                  '</label>'
                ].join('');
              } else {
                inputControl = '<input type="text" class="sw-input sw-arg-input" data-key="' + item.key + '" value="' + (currentVal || '') + '" placeholder="默认: ' + (item.defaultValue || '空') + '" style="font-size:13px;padding:6px 10px;text-align:right;width:200px" />';
              }

              return [
                '<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;border-bottom:1px solid rgba(148,163,184,0.12);background:rgba(255,255,255,0.02)">',
                '  <div style="font-weight:500;font-size:13px">' + item.key + '</div>',
                '  <div>' + inputControl + '</div>',
                '</div>'
              ].join('');
            }).join('');

            var descSection = '';
            if (desc) {
              descSection = [
                '<div style="margin-top:14px;padding:12px;background:rgba(0,0,0,0.25);border-radius:8px;font-size:11px;line-height:1.6;opacity:0.85;white-space:pre-wrap;border:1px solid rgba(148,163,184,0.15)">',
                '  <div style="font-weight:600;margin-bottom:4px;color:#94A3B8">参数说明 (arguments-desc):</div>',
                desc,
                '</div>'
              ].join('');
            }

            var modalHtml = [
              '<div style="display:flex;flex-direction:column;gap:4px">',
              '  <div style="font-size:12px;opacity:0.75;margin-bottom:8px">修改参数后将重新宏展开与脱水，并自动通知 Surge 热重载加载最新配置：</div>',
              '  <div style="border:1px solid rgba(148,163,184,0.2);border-radius:8px;overflow:hidden">',
              formRows,
              '  </div>',
              descSection,
              '  <div style="margin-top:12px;display:flex;justify-content:flex-start">',
              '    <button type="button" class="button small" id="sw-btn-reset-args" style="opacity:0.8">🔄 重置为默认值</button>',
              '  </div>',
              '</div>'
            ].join('');

            openModal('编辑参数 · ' + name, modalHtml, async function () {
              var newArgs = {};
              qq('.sw-arg-input').forEach(function (input) {
                var k = input.dataset.key;
                if (!k) return;
                if (input.classList.contains('sw-arg-switch')) {
                  var origItem = schema.find(function (s) { return s.key === k; });
                  if (origItem && (origItem.defaultValue === 'true' || origItem.defaultValue === 'false')) {
                    newArgs[k] = input.checked ? 'true' : 'false';
                  } else {
                    newArgs[k] = input.checked ? '1' : '0';
                  }
                } else {
                  newArgs[k] = input.value.trim();
                }
              });

              var putRes = await fetch('/api/v1/surge/modules/' + encodeURIComponent(id) + '/arguments', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ arguments: newArgs }),
              });
              var putData = await putRes.json();
              if (putData.success) {
                toast('参数已保存并重新脱水', 'DNS 拦截与七层 Hub 已更新');
                loadModules();
                return true;
              } else {
                alert('保存参数失败: ' + (putData.error || '未知错误'));
                return false;
              }
            }, '保存并应用');

            // 监听开关点击视觉反馈与重置按钮绑定
            qq('.sw-arg-switch').forEach(function (chk) {
              chk.onchange = function () {
                var track = chk.nextElementSibling;
                var thumb = track ? track.firstElementChild : null;
                if (track && thumb) {
                  track.style.background = chk.checked ? '#10B981' : 'rgba(148,163,184,0.3)';
                  thumb.style.left = chk.checked ? '22px' : '2px';
                }
              };
            });

            var btnReset = q('#sw-btn-reset-args');
            if (btnReset) {
              btnReset.onclick = async function () {
                if (!confirm('确定将该模块的所有参数重置为作者默认值吗？')) return;
                var resetRes = await fetch('/api/v1/surge/modules/' + encodeURIComponent(id) + '/arguments/reset', {
                  method: 'POST',
                });
                var resetData = await resetRes.json();
                if (resetData.success) {
                  toast('已恢复默认参数', '重新脱水完成');
                  closeModal();
                  loadModules();
                } else {
                  alert('重置失败: ' + (resetData.error || '未知错误'));
                }
              };
            }
          } catch (e) {
            alert('打开参数面板异常: ' + e.message);
          }
        };
      });

      // 删除事件
      qq('.sw-btn-del-mod', container).forEach(function (btn) {
        btn.onclick = async function () {
          if (!confirm('确定要删除该 App 模块吗？')) return;
          var id = btn.dataset.modId;
          await fetch('/api/v1/surge/modules/' + encodeURIComponent(id), { method: 'DELETE' });
          toast('模块已删除', id);
          loadModules();
        };
      });

      // 编辑代码事件
      qq('.sw-btn-edit-mod', container).forEach(function (btn) {
        btn.onclick = async function () {
          var id = btn.dataset.modId;
          var name = btn.dataset.modName;
          var modRes = await fetch('/api/v1/surge/modules/' + encodeURIComponent(id));
          var modData = await modRes.json();
          var content = (modData.module && modData.module.raw_content) || '';

          var editorHtml = [
            '<div style="margin-bottom:12px">',
            '  <label>模块名称</label>',
            '  <input type="text" id="sw-edit-mod-name" class="sw-input" value="' + name + '" />',
            '</div>',
            '<div>',
            '  <label>.sgmodule 原始代码 (支持在线编辑与重新脱水)</label>',
            '  <textarea id="sw-edit-mod-code" class="sw-textarea" rows="15" spellcheck="false">' + content + '</textarea>',
            '</div>'
          ].join('');

          openModal('编辑模块代码: ' + name, editorHtml, async function () {
            var newName = q('#sw-edit-mod-name').value.trim() || name;
            var newCode = q('#sw-edit-mod-code').value;
            var putRes = await fetch('/api/v1/surge/modules/' + encodeURIComponent(id), {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ name: newName, content: newCode }),
            });
            var putData = await putRes.json();
            if (putData.success) {
              toast('模块更新成功', '已重新脱水并同步');
              loadModules();
              return true;
            } else {
              alert('保存失败: ' + (putData.error || '未知错误'));
              return false;
            }
          }, '保存并重新脱水');
        };
      });
    } catch (e) {
      container.innerHTML = '<div style="color:#EF4444;padding:20px;grid-column:1/-1">加载模块失败: ' + e.message + '</div>';
    }
  }

  // ==================== 分流治理细则与分组管理 ====================

  function getBadgeStyle(type) {
    if (type === 'DOMAIN-SUFFIX') return 'background:rgba(16,185,129,0.15);color:#10B981;border:1px solid rgba(16,185,129,0.3)';
    if (type === 'DOMAIN') return 'background:rgba(59,130,246,0.15);color:#3B82F6;border:1px solid rgba(59,130,246,0.3)';
    if (type === 'DOMAIN-KEYWORD') return 'background:rgba(245,158,11,0.15);color:#F59E0B;border:1px solid rgba(245,158,11,0.3)';
    if (type === 'IP-CIDR') return 'background:rgba(99,102,241,0.15);color:#6366F1;border:1px solid rgba(99,102,241,0.3)';
    if (type === 'RULE-SET') return 'background:rgba(139,92,246,0.15);color:#8B5CF6;border:1px solid rgba(139,92,246,0.3)';
    return 'background:rgba(148,163,184,0.15);color:#94A3B8;border:1px solid rgba(148,163,184,0.3)';
  }

  // 单条规则编辑弹窗
  function openEditRuleModal(rule, onDone) {
    var html = [
      '<div style="margin-bottom:12px">',
      '  <label>所属分流组</label>',
      '  <input type="text" class="sw-input" disabled value="' + rule.group_id + '" style="opacity:0.75" />',
      '</div>',
      '<div style="margin-bottom:12px">',
      '  <label>匹配类型</label>',
      '  <select id="sw-er-type" class="sw-select">',
      '    <option value="DOMAIN-SUFFIX"' + (rule.match_type === 'DOMAIN-SUFFIX' ? ' selected' : '') + '>DOMAIN-SUFFIX (后缀通配)</option>',
      '    <option value="DOMAIN"' + (rule.match_type === 'DOMAIN' ? ' selected' : '') + '>DOMAIN (完全匹配)</option>',
      '    <option value="DOMAIN-KEYWORD"' + (rule.match_type === 'DOMAIN-KEYWORD' ? ' selected' : '') + '>DOMAIN-KEYWORD (关键字)</option>',
      '    <option value="IP-CIDR"' + (rule.match_type === 'IP-CIDR' ? ' selected' : '') + '>IP-CIDR (网段)</option>',
      '    <option value="RULE-SET"' + (rule.match_type === 'RULE-SET' ? ' selected' : '') + '>RULE-SET (远程规则集)</option>',
      '  </select>',
      '</div>',
      '<div style="margin-bottom:12px">',
      '  <label>匹配表达式 (域名 / IP / 规则集 URL)</label>',
      '  <input type="text" id="sw-er-pat" class="sw-input" value="' + (rule.pattern || '') + '" />',
      '</div>',
      '<div style="margin-bottom:12px">',
      '  <label>备注说明 (选填)</label>',
      '  <input type="text" id="sw-er-comment" class="sw-input" value="' + (rule.comment || '') + '" />',
      '</div>',
      '<div>',
      '  <label style="cursor:pointer;display:inline-flex;align-items:center;gap:6px;font-size:13px">',
      '    <input type="checkbox" id="sw-er-enabled" ' + (rule.enabled ? 'checked' : '') + ' /> 规则生效启用',
      '  </label>',
      '</div>'
    ].join('');

    openSubModal('✏️ 编辑单条分流规则 (ID: ' + rule.id + ')', html, async function () {
      var pat = q('#sw-er-pat').value.trim();
      var type = q('#sw-er-type').value;
      var comment = q('#sw-er-comment').value.trim();
      var enabled = q('#sw-er-enabled').checked;
      if (!pat) { alert('请输入匹配表达式'); return false; }

      var payload = {
        id: rule.id,
        group_id: rule.group_id,
        match_type: type,
        pattern: pat,
        comment: comment,
        enabled: enabled,
      };

      try {
        var res = await fetch('/api/v1/surge/diversion/rules', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        var data = await res.json();
        if (data.success) {
          toast('规则已修改', pat);
          if (onDone) onDone();
          return true;
        } else {
          alert('修改失败: ' + (data.error || '未知错误'));
          return false;
        }
      } catch (e) {
        alert('网络异常: ' + e.message);
        return false;
      }
    }, '保存修改');
  }

  // 在明细弹窗内直接添加单条规则
  function openAddRuleInGroupModal(groupId, onDone) {
    var html = [
      '<div style="margin-bottom:12px">',
      '  <label>所属分流组</label>',
      '  <input type="text" class="sw-input" disabled value="' + groupId + '" style="opacity:0.75" />',
      '</div>',
      '<div style="margin-bottom:12px">',
      '  <label>匹配类型</label>',
      '  <select id="sw-ar-type" class="sw-select">',
      '    <option value="DOMAIN-SUFFIX">DOMAIN-SUFFIX (后缀通配)</option>',
      '    <option value="DOMAIN">DOMAIN (完全匹配)</option>',
      '    <option value="DOMAIN-KEYWORD">DOMAIN-KEYWORD (关键字)</option>',
      '    <option value="IP-CIDR">IP-CIDR (网段)</option>',
      '    <option value="RULE-SET">RULE-SET (远程规则集)</option>',
      '  </select>',
      '</div>',
      '<div style="margin-bottom:12px">',
      '  <label>匹配表达式 (域名 / IP / 规则集 URL)</label>',
      '  <input type="text" id="sw-ar-pat" class="sw-input" placeholder="例如：example.com 或 https://..." />',
      '</div>',
      '<div>',
      '  <label>备注说明 (选填)</label>',
      '  <input type="text" id="sw-ar-comment" class="sw-input" placeholder="例如：自定义规则" />',
      '</div>'
    ].join('');

    openSubModal('➕ 添加规则到分流组: ' + groupId, html, async function () {
      var pat = q('#sw-ar-pat').value.trim();
      var type = q('#sw-ar-type').value;
      var comment = q('#sw-ar-comment').value.trim();
      if (!pat) { alert('请输入匹配表达式'); return false; }

      var payload = {
        group_id: groupId,
        match_type: type,
        pattern: pat,
        comment: comment,
        enabled: true,
      };

      try {
        var res = await fetch('/api/v1/surge/diversion/rules', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        var data = await res.json();
        if (data.success) {
          toast('规则已添加', pat);
          if (onDone) onDone();
          return true;
        } else {
          alert('添加失败: ' + (data.error || '未知错误'));
          return false;
        }
      } catch (e) {
        alert('网络异常: ' + e.message);
        return false;
      }
    }, '立即添加');
  }

  // 规则明细管理大弹窗（支持搜索、类型筛选、分页翻页、启禁与修改删除）
  async function openRulesDetailModal(groupId, groupName) {
    var curPage = 1;
    var pageSize = 20;
    var curSearch = '';
    var curType = 'ALL';
    var totalCount = 0;

    var containerHtml = [
      '<div style="display:flex;flex-direction:column;gap:12px">',
      '  <!-- 工具栏 -->',
      '  <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;justify-content:space-between;padding-bottom:10px;border-bottom:1px solid rgba(148,163,184,0.15)">',
      '    <div style="display:flex;gap:8px;flex:1;min-width:260px;flex-wrap:wrap">',
      '      <input type="text" id="sw-rd-search" class="sw-input" placeholder="🔍 搜索域名、IP 或备注..." style="margin-top:0;flex:1;min-width:180px" />',
      '      <select id="sw-rd-type" class="sw-select" style="margin-top:0;width:150px">',
      '        <option value="ALL">全部类型</option>',
      '        <option value="DOMAIN-SUFFIX">DOMAIN-SUFFIX</option>',
      '        <option value="DOMAIN">DOMAIN</option>',
      '        <option value="DOMAIN-KEYWORD">DOMAIN-KEYWORD</option>',
      '        <option value="IP-CIDR">IP-CIDR</option>',
      '        <option value="RULE-SET">RULE-SET</option>',
      '      </select>',
      '    </div>',
      '    <div style="display:flex;gap:6px">',
      '      <button type="button" class="button small primary" id="sw-rd-btn-add" style="background:#10B981;color:#fff;border-color:transparent">+ 添加规则</button>',
      '      <button type="button" class="button small" id="sw-rd-btn-refresh">🔄 刷新</button>',
      '    </div>',
      '  </div>',
      '  <!-- 规则列表容器 -->',
      '  <div id="sw-rd-list" style="max-height:56vh;overflow-y:auto;min-height:220px;display:flex;flex-direction:column;gap:6px;padding-right:4px">',
      '    <div style="text-align:center;padding:40px;opacity:0.6">正在检索数据库…</div>',
      '  </div>',
      '  <!-- 底部分页控制 -->',
      '  <div style="display:flex;justify-content:space-between;align-items:center;padding-top:10px;border-top:1px solid rgba(148,163,184,0.15);font-size:12px;flex-wrap:wrap;gap:8px">',
      '    <span id="sw-rd-page-info" style="opacity:0.85">共 0 条规则</span>',
      '    <div style="display:flex;gap:6px;align-items:center">',
      '      <button type="button" class="button small" id="sw-rd-prev" disabled>上一页</button>',
      '      <span id="sw-rd-cur-page" style="font-weight:600;min-width:32px;text-align:center">1</span>',
      '      <button type="button" class="button small" id="sw-rd-next" disabled>下一页</button>',
      '    </div>',
      '  </div>',
      '</div>'
    ].join('');

    openModal('📋 分流规则明细: ' + groupName + ' (' + groupId + ')', containerHtml, null, '关闭', {
      large: true,
      hideCancel: true,
    });

    var listEl = q('#sw-rd-list');
    var searchInput = q('#sw-rd-search');
    var typeSelect = q('#sw-rd-type');
    var pageInfo = q('#sw-rd-page-info');
    var curPageEl = q('#sw-rd-cur-page');
    var prevBtn = q('#sw-rd-prev');
    var nextBtn = q('#sw-rd-next');
    var addBtn = q('#sw-rd-btn-add');
    var refreshBtn = q('#sw-rd-btn-refresh');

    var searchTimer = null;

    async function fetchAndRender() {
      if (!listEl) return;
      listEl.innerHTML = '<div style="text-align:center;padding:30px;opacity:0.6">正在读取规则记录…</div>';
      var offset = (curPage - 1) * pageSize;
      var url = '/api/v1/surge/diversion/rules?paged=1&group=' + encodeURIComponent(groupId) +
                '&limit=' + pageSize + '&offset=' + offset;
      if (curSearch) url += '&search=' + encodeURIComponent(curSearch);
      if (curType && curType !== 'ALL') url += '&type=' + encodeURIComponent(curType);

      try {
        var res = await fetch(url);
        var data = await res.json();
        totalCount = data.total || 0;
        var rules = data.rules || [];
        var maxPage = Math.max(1, Math.ceil(totalCount / pageSize));

        if (curPageEl) curPageEl.textContent = curPage + ' / ' + maxPage;
        if (pageInfo) pageInfo.textContent = '共 ' + totalCount.toLocaleString() + ' 条规则';
        if (prevBtn) prevBtn.disabled = (curPage <= 1);
        if (nextBtn) nextBtn.disabled = (curPage >= maxPage);

        if (rules.length === 0) {
          listEl.innerHTML = '<div style="text-align:center;padding:40px;opacity:0.6">未查询到匹配的分流规则条目</div>';
          return;
        }

        listEl.innerHTML = rules.map(function (r) {
          var badgeCss = getBadgeStyle(r.match_type);
          var commentHtml = r.comment ? '<span style="font-size:12px;opacity:0.75;margin-left:8px">// ' + r.comment + '</span>' : '';
          var learnedBadge = r.is_auto_learned ? '<span class="sw-badge" style="background:rgba(245,158,11,0.15);color:#F59E0B;border:1px solid rgba(245,158,11,0.3);margin-left:6px">自愈学习</span>' : '';
          var hitBadge = (r.hit_count && r.hit_count > 0) ? '<span style="font-size:11px;opacity:0.7;margin-left:6px">🎯 ' + r.hit_count + '</span>' : '';

          var srcBadge = '';
          var srcList = r.sources || [];
          if (srcList.includes('__manual__')) {
            srcBadge = '<span class="sw-badge" style="background:rgba(148,163,184,0.15);color:#94A3B8;border:1px solid rgba(148,163,184,0.3);margin-left:6px" title="用户手动添加的独立规则">✍️ 手动</span>';
          } else if (r.is_unique && srcList.length === 1) {
            var sName = (srcList[0].split('/').pop() || '外部源').replace(/\.list$/i, '');
            srcBadge = '<span class="sw-badge" style="background:rgba(16,185,129,0.15);color:#10B981;border:1px solid rgba(16,185,129,0.35);margin-left:6px" title="仅由该规则集独占: ' + srcList[0] + '">独占: ' + sName + '</span>';
          } else if (srcList.length > 1) {
            srcBadge = '<span class="sw-badge" style="background:rgba(59,130,246,0.15);color:#3B82F6;border:1px solid rgba(59,130,246,0.35);margin-left:6px" title="多源共享规则:\n' + srcList.join('\n') + '">多源共享 (' + srcList.length + ')</span>';
          }

          return [
            '<div class="sw-rule-item" data-id="' + r.id + '">',
            '  <div style="display:flex;align-items:center;gap:8px;flex:1;min-width:0">',
            '    <span class="sw-badge" style="' + badgeCss + '">' + r.match_type + '</span>',
            '    <code style="font-size:13px;font-weight:600;word-break:break-all">' + r.pattern + '</code>',
            '    ' + commentHtml,
            '    ' + learnedBadge,
            '    ' + srcBadge,
            '    ' + hitBadge,
            '  </div>',
            '  <div style="display:flex;align-items:center;gap:8px;flex-shrink:0">',
            '    <label style="cursor:pointer;display:inline-flex;align-items:center;gap:4px;font-size:12px">',
            '      <input type="checkbox" class="sw-rd-chk-toggle" data-rule-id="' + r.id + '" ' + (r.enabled ? 'checked' : '') + ' /> 生效',
            '    </label>',
            '    <button type="button" class="button small sw-rd-btn-edit" data-rule-id="' + r.id + '" style="padding:2px 8px;font-size:12px">✏️</button>',
            '    <button type="button" class="button small sw-rd-btn-del" data-rule-id="' + r.id + '" data-rule-pat="' + r.pattern + '" style="padding:2px 8px;font-size:12px;color:#EF4444;border-color:rgba(239,68,68,0.3)">🗑️</button>',
            '  </div>',
            '</div>'
          ].join('');
        }).join('');

        // 绑定单条启闭
        qq('.sw-rd-chk-toggle', listEl).forEach(function (chk) {
          chk.onchange = async function () {
            var rid = chk.dataset.ruleId;
            var en = chk.checked;
            await fetch('/api/v1/surge/diversion/rules/' + rid + '/toggle', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ enabled: en }),
            });
            toast('规则状态已更新');
          };
        });

        // 绑定编辑单条
        qq('.sw-rd-btn-edit', listEl).forEach(function (btn) {
          btn.onclick = function () {
            var rid = Number(btn.dataset.ruleId);
            var targetRule = rules.find(function (x) { return x.id === rid; });
            if (targetRule) {
              openEditRuleModal(targetRule, function () {
                fetchAndRender();
                loadDiversion();
              });
            }
          };
        });

        // 绑定删除单条
        qq('.sw-rd-btn-del', listEl).forEach(function (btn) {
          btn.onclick = async function () {
            var rid = btn.dataset.ruleId;
            var pat = btn.dataset.rulePat;
            if (!confirm('确定彻底删除该分流规则吗？\n' + pat)) return;

            try {
              var delRes = await fetch('/api/v1/surge/diversion/rules/' + rid, { method: 'DELETE' });
              var delData = await delRes.json();
              if (delData.success) {
                toast('规则已删除', pat);
                fetchAndRender();
                loadDiversion();
              } else {
                alert('删除失败: ' + (delData.error || '未知错误'));
              }
            } catch (e) {
              alert('请求异常: ' + e.message);
            }
          };
        });
      } catch (e) {
        listEl.innerHTML = '<div style="color:#EF4444;padding:20px;text-align:center">检索规则失败: ' + e.message + '</div>';
      }
    }

    if (searchInput) {
      searchInput.oninput = function () {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(function () {
          curSearch = searchInput.value.trim();
          curPage = 1;
          fetchAndRender();
        }, 260);
      };
      searchInput.onkeydown = function (e) {
        if (e.key === 'Enter') {
          clearTimeout(searchTimer);
          curSearch = searchInput.value.trim();
          curPage = 1;
          fetchAndRender();
        }
      };
    }

    if (typeSelect) {
      typeSelect.onchange = function () {
        curType = typeSelect.value;
        curPage = 1;
        fetchAndRender();
      };
    }

    if (prevBtn) {
      prevBtn.onclick = function () {
        if (curPage > 1) {
          curPage--;
          fetchAndRender();
        }
      };
    }

    if (nextBtn) {
      nextBtn.onclick = function () {
        curPage++;
        fetchAndRender();
      };
    }

    if (addBtn) {
      addBtn.onclick = function () {
        openAddRuleInGroupModal(groupId, function () {
          fetchAndRender();
          loadDiversion();
        });
      };
    }

    if (refreshBtn) {
      refreshBtn.onclick = fetchAndRender;
    }

    fetchAndRender();
  }

  // 分流组属性编辑
  function openEditGroupModal(group) {
    var isCore = ['direct', 'proxy', 'block', 'media', 'game', 'apple'].includes(group.id);

    var html = [
      '<div style="margin-bottom:12px">',
      '  <label>分流组标识 (ID)</label>',
      '  <input type="text" class="sw-input" disabled value="' + group.id + '" style="opacity:0.75" />',
      '</div>',
      '<div style="margin-bottom:12px">',
      '  <label>分流组名称</label>',
      '  <input type="text" id="sw-eg-name" class="sw-input" value="' + group.name + '" />',
      '</div>',
      '<div style="margin-bottom:12px">',
      '  <label>Surge 导出策略</label>',
      '  <div style="display:flex;gap:6px;align-items:center;margin-bottom:6px">',
      '    <input type="text" id="sw-eg-policy" class="sw-input" style="margin-top:0" value="' + group.surge_policy + '" placeholder="DIRECT / PROXY / REJECT 或策略组名" />',
      '  </div>',
      '  <div style="display:flex;gap:6px;font-size:11px">',
      '    <button type="button" class="button small sw-eg-quick-pol" data-pol="DIRECT">DIRECT 直连</button>',
      '    <button type="button" class="button small sw-eg-quick-pol" data-pol="PROXY">PROXY 代理</button>',
      '    <button type="button" class="button small sw-eg-quick-pol" data-pol="REJECT">REJECT 拦截</button>',
      '  </div>',
      '</div>',
      '<div style="margin-bottom:12px">',
      '  <label>匹配优先级 (越小越优先)</label>',
      '  <input type="number" id="sw-eg-priority" class="sw-input" value="' + (group.priority || 0) + '" />',
      '</div>',
      '<div style="margin-bottom:14px">',
      '  <label>描述说明</label>',
      '  <input type="text" id="sw-eg-desc" class="sw-input" value="' + (group.description || '') + '" />',
      '</div>',
      (!isCore ? [
        '<div style="padding-top:10px;border-top:1px solid rgba(239,68,68,0.2);display:flex;justify-content:flex-end">',
        '  <button type="button" class="button small" id="sw-eg-btn-delete" style="color:#EF4444;border-color:rgba(239,68,68,0.4)">🗑️ 删除此分流组</button>',
        '</div>'
      ].join('') : '')
    ].join('');

    openModal('⚙️ 编辑分流组: ' + group.name, html, async function () {
      var name = q('#sw-eg-name').value.trim();
      var policy = q('#sw-eg-policy').value.trim();
      var priority = Number(q('#sw-eg-priority').value) || 0;
      var desc = q('#sw-eg-desc').value.trim();
      if (!name || !policy) { alert('分流组名称与策略不能为空'); return false; }

      var payload = {
        id: group.id,
        name: name,
        surge_policy: policy,
        priority: priority,
        description: desc,
        enabled: group.enabled,
      };

      try {
        var res = await fetch('/api/v1/surge/diversion/groups', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        var data = await res.json();
        if (data.success) {
          toast('分流组设置已更新', name);
          loadDiversion();
          return true;
        } else {
          alert('保存失败: ' + (data.error || '未知错误'));
          return false;
        }
      } catch (e) {
        alert('请求失败: ' + e.message);
        return false;
      }
    }, '保存分流组');

    qq('.sw-eg-quick-pol').forEach(function (btn) {
      btn.onclick = function () {
        var pol = btn.dataset.pol;
        var pInput = q('#sw-eg-policy');
        if (pInput) pInput.value = pol;
      };
    });

    var delBtn = q('#sw-eg-btn-delete');
    if (delBtn) {
      delBtn.onclick = async function () {
        if (!confirm('确定彻底删除该分流组及其包含的所有规则吗？此操作不可撤销！')) return;
        try {
          var res = await fetch('/api/v1/surge/diversion/groups/' + encodeURIComponent(group.id), { method: 'DELETE' });
          var data = await res.json();
          if (data.success) {
            toast('分流组已删除', group.id);
            closeModal();
            loadDiversion();
          } else {
            alert('删除失败: ' + (data.error || '未知错误'));
          }
        } catch (e) {
          alert('请求异常: ' + e.message);
        }
      };
    }
  }

  // 新建分流组
  function openCreateGroupModal() {
    var html = [
      '<div style="margin-bottom:12px">',
      '  <label>分流组唯一标识 (英文字母/数字，如 telegram)</label>',
      '  <input type="text" id="sw-cg-id" class="sw-input" placeholder="例如：telegram" />',
      '</div>',
      '<div style="margin-bottom:12px">',
      '  <label>分流组显示名称</label>',
      '  <input type="text" id="sw-cg-name" class="sw-input" placeholder="例如：Telegram 专线" />',
      '</div>',
      '<div style="margin-bottom:12px">',
      '  <label>Surge 导出策略</label>',
      '  <div style="display:flex;gap:6px;align-items:center;margin-bottom:6px">',
      '    <input type="text" id="sw-cg-policy" class="sw-input" style="margin-top:0" value="PROXY" placeholder="DIRECT / PROXY / REJECT 或策略组名" />',
      '  </div>',
      '  <div style="display:flex;gap:6px;font-size:11px">',
      '    <button type="button" class="button small sw-cg-quick-pol" data-pol="DIRECT">DIRECT 直连</button>',
      '    <button type="button" class="button small sw-cg-quick-pol" data-pol="PROXY">PROXY 代理</button>',
      '    <button type="button" class="button small sw-cg-quick-pol" data-pol="REJECT">REJECT 拦截</button>',
      '  </div>',
      '</div>',
      '<div style="margin-bottom:12px">',
      '  <label>匹配优先级 (越小越优先)</label>',
      '  <input type="number" id="sw-cg-priority" class="sw-input" value="60" />',
      '</div>',
      '<div>',
      '  <label>描述说明 (选填)</label>',
      '  <input type="text" id="sw-cg-desc" class="sw-input" placeholder="例如：电报通讯服务分流" />',
      '</div>'
    ].join('');

    openModal('➕ 新建动态分流规则组', html, async function () {
      var id = q('#sw-cg-id').value.trim().toLowerCase();
      var name = q('#sw-cg-name').value.trim();
      var policy = q('#sw-cg-policy').value.trim();
      var priority = Number(q('#sw-cg-priority').value) || 60;
      var desc = q('#sw-cg-desc').value.trim();

      if (!id || !name || !policy) {
        alert('分流组标识、名称与策略均为必填项');
        return false;
      }
      if (!/^[a-z0-9_-]+$/.test(id)) {
        alert('分流组标识仅支持小写字母、数字、下划线与中划线');
        return false;
      }

      var payload = {
        id: id,
        name: name,
        surge_policy: policy,
        priority: priority,
        description: desc,
        enabled: true,
      };

      try {
        var res = await fetch('/api/v1/surge/diversion/groups', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        var data = await res.json();
        if (data.success) {
          toast('新建分流组成功', name);
          loadDiversion();
          return true;
        } else {
          alert('创建失败: ' + (data.error || '未知错误'));
          return false;
        }
      } catch (e) {
        alert('请求失败: ' + e.message);
        return false;
      }
    }, '立即创建');

    qq('.sw-cg-quick-pol').forEach(function (btn) {
      btn.onclick = function () {
        var pol = btn.dataset.pol;
        var pInput = q('#sw-cg-policy');
        if (pInput) pInput.value = pol;
      };
    });
  }

  // 按照 Surge 格式自动生成配置的大弹窗
  async function openSurgeConfModal(initialMode) {
    var curMode = initialMode || 'ruleset';
    var curHost = location.host || '127.0.0.1:9053';
    var curKey = 'localdnskey';

    try {
      var cfgRes = await fetch('/api/v1/surge/config');
      var cfgData = await cfgRes.json();
      if (cfgData.api_key) curKey = cfgData.api_key;
    } catch (e) {}

    var bodyHtml = [
      '<div style="display:flex;flex-direction:column;gap:14px">',
      '  <div style="background:rgba(59,130,246,0.08);border-left:4px solid #3B82F6;padding:12px;border-radius:8px;font-size:13px;line-height:1.5">',
      '    <strong>💡 按照 Surge 标准格式自动生成完整配置文件 (.conf)</strong>',
      '    <p style="margin:4px 0 0;opacity:0.85;font-size:12px">根据 LocalDNS 当前的数据库规则组、策略与 API 联动参数，自动编译生成标准配置文件，可直接导入 Surge 使用。</p>',
      '  </div>',
      '  <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">',
      '    <div>',
      '      <label>规则引用模式</label>',
      '      <select id="sw-cm-mode" class="sw-select">',
      '        <option value="ruleset"' + (curMode === 'ruleset' ? ' selected' : '') + '>动态订阅模式 (推荐，零重启热更新)</option>',
      '        <option value="inline"' + (curMode === 'inline' ? ' selected' : '') + '>静态内联模式 (全量规则直接写入配置)</option>',
      '      </select>',
      '    </div>',
      '    <div>',
      '      <label>LocalDNS 服务地址 (Host:Port)</label>',
      '      <input type="text" id="sw-cm-host" class="sw-input" value="' + curHost + '" placeholder="例如：127.0.0.1:9053 或 局域网IP:9053" />',
      '    </div>',
      '  </div>',
      '  <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">',
      '    <div>',
      '      <label>HTTP API 控制密钥 (X-Key)</label>',
      '      <input type="text" id="sw-cm-key" class="sw-input" value="' + curKey + '" placeholder="与 Surge 设置保持一致" />',
      '    </div>',
      '    <div>',
      '      <label>示范代理节点定义 (选填)</label>',
      '      <input type="text" id="sw-cm-proxy" class="sw-input" placeholder="留空则使用默认 PROXY_DEMO 模板" />',
      '    </div>',
      '  </div>',
      '  <div>',
      '    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">',
      '      <label>生成的完整配置内容 (.conf)</label>',
      '      <button type="button" class="button small" id="sw-cm-btn-refresh">🔄 重新编译预览</button>',
      '    </div>',
      '    <textarea id="sw-cm-preview" class="sw-textarea" rows="12" spellcheck="false" readonly style="font-size:12px;font-family:ui-monospace, monospace"></textarea>',
      '  </div>',
      '  <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;padding-top:10px;border-top:1px solid rgba(148,163,184,0.15)">',
      '    <div style="display:flex;gap:8px;flex-wrap:wrap">',
      '      <button type="button" class="button small primary" id="sw-cm-btn-install" style="background:#10B981;color:#fff;border-color:transparent">📲 一键调起 Surge 安装</button>',
      '      <button type="button" class="button small" id="sw-cm-btn-download">📥 下载 .conf 文件</button>',
      '      <button type="button" class="button small" id="sw-cm-btn-copy">📋 复制全部配置</button>',
      '    </div>',
      '    <span style="font-size:11px;opacity:0.7">文件名: LocalDNS.conf</span>',
      '  </div>',
      '</div>'
    ].join('');

    openModal('🚀 Surge 完整配置文件自动生成与导入', bodyHtml, null, '关闭', {
      large: true,
      hideCancel: true,
    });

    var modeSelect = q('#sw-cm-mode');
    var hostInput = q('#sw-cm-host');
    var keyInput = q('#sw-cm-key');
    var proxyInput = q('#sw-cm-proxy');
    var previewEl = q('#sw-cm-preview');
    var refreshBtn = q('#sw-cm-btn-refresh');
    var installBtn = q('#sw-cm-btn-install');
    var downloadBtn = q('#sw-cm-btn-download');
    var copyBtn = q('#sw-cm-btn-copy');

    var currentConf = '';

    async function compileAndRender() {
      if (!previewEl) return;
      previewEl.value = '正在自动编译 Surge 配置文件…';
      var payload = {
        mode: modeSelect ? modeSelect.value : curMode,
        host: hostInput ? hostInput.value.trim() : curHost,
        api_key: keyInput ? keyInput.value.trim() : curKey,
        custom_proxy_node: proxyInput ? proxyInput.value.trim() : '',
      };
      try {
        var res = await fetch('/api/v1/surge/generate-conf', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        var data = await res.json();
        if (data.success && data.conf) {
          currentConf = data.conf;
          previewEl.value = currentConf;
        } else {
          previewEl.value = '编译配置失败: ' + (data.error || '未知错误');
        }
      } catch (e) {
        previewEl.value = '请求失败: ' + e.message;
      }
    }

    if (modeSelect) modeSelect.onchange = compileAndRender;
    if (refreshBtn) refreshBtn.onclick = compileAndRender;

    if (installBtn) {
      installBtn.onclick = function () {
        var host = hostInput ? hostInput.value.trim() : location.host;
        var mode = modeSelect ? modeSelect.value : 'ruleset';
        var confUrl = 'http://' + host + '/surge/localdns.conf?mode=' + mode;
        var installScheme = 'surge:///install-config?url=' + encodeURIComponent(confUrl);
        location.href = installScheme;
        toast('已调起 Surge 安装配置', '若未响应可使用直链: ' + confUrl);
      };
    }

    if (downloadBtn) {
      downloadBtn.onclick = function () {
        var host = hostInput ? hostInput.value.trim() : location.host;
        var mode = modeSelect ? modeSelect.value : 'ruleset';
        var downloadUrl = '/surge/localdns.conf?host=' + encodeURIComponent(host) + '&mode=' + mode + '&download=1';
        window.open(downloadUrl, '_blank');
        toast('正在下载 LocalDNS.conf 配置文件');
      };
    }

    if (copyBtn) {
      copyBtn.onclick = function () {
        if (!currentConf) { alert('配置尚未编译完成'); return; }
        copyText(currentConf);
      };
    }

    compileAndRender();
  }

  // 刷新分流组列表
  async function loadDiversion() {
    var container = q('#sw-groups-list');
    if (!container) return;
    try {
      var res = await fetch('/api/v1/surge/diversion/groups');
      var data = await res.json();
      if (!data.groups) return;

      var groups = data.groups;
      var totalRules = 0;
      var activeCount = 0;
      groups.forEach(function (g) {
        totalRules += (g.rule_count || 0);
        if (g.enabled) activeCount++;
      });

      var statGroups = q('#sw-stat-total-groups');
      var statRules = q('#sw-stat-total-rules');
      var statActive = q('#sw-stat-active-groups');
      if (statGroups) statGroups.textContent = groups.length;
      if (statRules) statRules.textContent = totalRules.toLocaleString();
      if (statActive) statActive.textContent = activeCount;

      container.innerHTML = groups.map(function (g) {
        var subUrl = location.origin + '/rules/' + g.id + '.list';
        var isReject = g.surge_policy.startsWith('REJECT');
        var isDirect = g.surge_policy === 'DIRECT';
        var badgeColor = isReject ? '#EF4444' : (isDirect ? '#10B981' : '#3B82F6');
        var badgeBg = isReject ? 'rgba(239,68,68,0.12)' : (isDirect ? 'rgba(16,185,129,0.12)' : 'rgba(59,130,246,0.12)');
        var badgeBorder = isReject ? 'rgba(239,68,68,0.3)' : (isDirect ? 'rgba(16,185,129,0.3)' : 'rgba(59,130,246,0.3)');

        var ruleCount = g.rule_count || 0;
        var rBg = ruleCount > 0 ? 'rgba(16,185,129,0.12)' : 'rgba(148,163,184,0.12)';
        var rColor = ruleCount > 0 ? '#10B981' : '#94A3B8';
        var rBorder = ruleCount > 0 ? 'rgba(16,185,129,0.3)' : 'rgba(148,163,184,0.25)';

        return [
          '<div class="glass-card" style="padding:14px">',
          '  <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">',
          '    <div>',
          '      <strong style="font-size:15px">' + g.name + '</strong>',
          '      <code style="font-size:11px;opacity:0.6;margin-left:4px">(' + g.id + ')</code>',
          '      <span style="font-size:12px;margin-left:8px;padding:3px 8px;background:' + badgeBg + ';color:' + badgeColor + ';border:1px solid ' + badgeBorder + ';border-radius:6px;font-weight:600">策略: ' + g.surge_policy + '</span>',
          '      <span style="font-size:12px;margin-left:6px;padding:3px 8px;background:' + rBg + ';color:' + rColor + ';border:1px solid ' + rBorder + ';border-radius:6px;font-weight:600">📦 ' + ruleCount.toLocaleString() + ' 条规则</span>',
          '      <p style="font-size:12px;opacity:0.75;margin:4px 0 0">' + (g.description || '无备注') + '</p>',
          '    </div>',
          '    <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">',
          '      <a href="' + subUrl + '" target="_blank" class="button small">🔗 订阅</a>',
          '      <button type="button" class="button small primary sw-btn-view-rules" data-group-id="' + g.id + '" data-group-name="' + g.name + '" style="background:#0D9488;color:#fff;border-color:transparent">📋 规则明细 (' + ruleCount.toLocaleString() + ')</button>',
          '      <button type="button" class="button small sw-btn-edit-rules" data-group-id="' + g.id + '" data-group-name="' + g.name + '">📝 文本编辑</button>',
          '      <button type="button" class="button small sw-btn-edit-group" data-group-id="' + g.id + '" title="修改分流组名称/策略/优先级">⚙️ 设置</button>',
          '      <label style="cursor:pointer;display:inline-flex;align-items:center;gap:4px;font-size:13px;margin-left:4px">',
          '        <input type="checkbox" class="sw-group-toggle" data-group-id="' + g.id + '" ' + (g.enabled ? 'checked' : '') + ' /> 启用',
          '      </label>',
          '    </div>',
          '  </div>',
          '</div>'
        ].join('');
      }).join('');

      qq('.sw-group-toggle', container).forEach(function (chk) {
        chk.onchange = async function () {
          var id = chk.dataset.groupId;
          var en = chk.checked;
          await fetch('/api/v1/surge/diversion/groups/' + encodeURIComponent(id) + '/toggle', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled: en }),
          });
          toast('分流组已更新', (en ? '已开启 ' : '已禁用 ') + id);
          loadDiversion();
        };
      });

      // 查看与管理明细
      qq('.sw-btn-view-rules', container).forEach(function (btn) {
        btn.onclick = function () {
          openRulesDetailModal(btn.dataset.groupId, btn.dataset.groupName);
        };
      });

      // 分组设置编辑
      qq('.sw-btn-edit-group', container).forEach(function (btn) {
        btn.onclick = function () {
          var gid = btn.dataset.groupId;
          var targetGroup = groups.find(function (x) { return x.id === gid; });
          if (targetGroup) openEditGroupModal(targetGroup);
        };
      });

      // 在线编辑全组规则
      qq('.sw-btn-edit-rules', container).forEach(function (btn) {
        btn.onclick = async function () {
          var gid = btn.dataset.groupId;
          var gname = btn.dataset.groupName;
          var res = await fetch('/api/v1/surge/diversion/rules/text?group=' + encodeURIComponent(gid));
          var rdata = await res.json();
          var rulesText = rdata.text || '';

          var bodyHtml = [
            '<p style="font-size:12px;margin:0 0 8px">每行一条规则，格式支持 <code>DOMAIN-SUFFIX,xxx</code>、<code>DOMAIN,yyy</code> 或纯域名。</p>',
            '<textarea id="sw-edit-rules-textarea" class="sw-textarea" rows="16" spellcheck="false">' + rulesText + '</textarea>'
          ].join('');

          openModal('在线编辑规则集: ' + gname, bodyHtml, async function () {
            var newText = q('#sw-edit-rules-textarea').value;
            var saveRes = await fetch('/api/v1/surge/diversion/rules/text', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ group_id: gid, text: newText }),
            });
            var saveData = await saveRes.json();
            if (saveData.success) {
              toast('分流规则已更新', '保存并生效 ' + saveData.count + ' 条规则');
              loadDiversion();
              return true;
            } else {
              alert('保存失败: ' + (saveData.error || '未知错误'));
              return false;
            }
          }, '保存全部规则');
        };
      });
      // 加载已订阅远程规则集看板
      await loadRemoteRuleSets();
    } catch (e) {
      container.innerHTML = '<div style="color:#EF4444">加载分流组失败: ' + e.message + '</div>';
    }
  }

  // 刷新已订阅远程规则集看板
  async function loadRemoteRuleSets() {
    var container = q('#sw-rulesets-list');
    var statCount = q('#sw-stat-rulesets-count');
    if (!container) return;
    try {
      var res = await fetch('/api/v1/surge/remote-rulesets');
      var data = await res.json();
      var sets = data.rule_sets || [];
      if (statCount) statCount.textContent = sets.length;

      if (sets.length === 0) {
        container.innerHTML = '<div style="padding:24px;text-align:center;opacity:0.6;grid-column:1/-1">暂无已订阅的外部规则集。可点击上方「🌐 订阅外部规则集 (URL)」填入远程 .list 链接。</div>';
        return;
      }

      container.innerHTML = sets.map(function (s) {
        var sharedCount = Math.max(0, s.rule_count - (s.unique_count || 0));
        var groupBadge = '<span class="sw-badge" style="background:rgba(59,130,246,0.12);color:#3B82F6;border:1px solid rgba(59,130,246,0.3)">' + s.group_id + '</span>';
        var lastUpdate = s.updated_at ? new Date(s.updated_at).toLocaleString('zh-CN', { hour12: false }) : '未记录';
        var errHtml = s.last_error ? '<div style="font-size:11px;color:#EF4444;margin-top:4px">⚠️ ' + s.last_error + '</div>' : '';
        var isEnabled = s.enabled !== false;
        var cardOpacity = isEnabled ? '1' : '0.68';
        var cardBorder = isEnabled ? 'rgba(148,163,184,0.25)' : 'rgba(239,68,68,0.25)';
        var statusHtml = isEnabled
          ? '<span style="color:#10B981;font-weight:600">已启用生效</span>'
          : '<span style="color:#94A3B8;font-weight:600">已关闭不生效</span>';

        return [
          '<div class="glass-card" style="padding:12px;display:flex;flex-direction:column;justify-content:space-between;border:1px solid ' + cardBorder + ';opacity:' + cardOpacity + ';transition:all .2s ease">',
          '  <div>',
          '    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">',
          '      <strong style="font-size:13px;word-break:break-all">' + (s.name || '外部规则集') + '</strong>',
          '      ' + groupBadge,
          '    </div>',
          '    <div style="margin-bottom:8px">',
          '      <a href="' + s.url + '" target="_blank" style="font-size:11px;color:var(--primary, #3B82F6);word-break:break-all;text-decoration:none" title="' + s.url + '">🔗 ' + s.url + '</a>',
          '    </div>',
          '    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px;font-size:11px">',
          '      <span class="sw-badge" style="background:rgba(59,130,246,0.12);color:#3B82F6;border:1px solid rgba(59,130,246,0.3)">总计 ' + s.rule_count.toLocaleString() + ' 条</span>',
          '      <span class="sw-badge" style="background:rgba(16,185,129,0.15);color:#10B981;border:1px solid rgba(16,185,129,0.35);font-weight:600" title="仅由本规则集提供的独占规则，删除时将被安全清理">独占 ' + (s.unique_count || 0).toLocaleString() + ' 条</span>',
          '      <span class="sw-badge" style="background:rgba(148,163,184,0.12);color:#64748B;border:1px solid rgba(148,163,184,0.25)" title="与其他规则集或手动规则重叠的共有项，删除时完整保留">共享 ' + sharedCount.toLocaleString() + ' 条</span>',
          '    </div>',
          '    <div style="font-size:11px;opacity:0.65">更新时间: ' + lastUpdate + '</div>',
          '    ' + errHtml,
          '  </div>',
          '  <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px;padding-top:8px;border-top:1px solid rgba(148,163,184,0.15);flex-wrap:wrap;gap:8px">',
          '    <label style="cursor:pointer;display:inline-flex;align-items:center;gap:5px;font-size:12px;user-select:none" title="启用或关闭该条外部规则集，数据库与分流引擎同步生效">',
          '      <input type="checkbox" class="sw-ruleset-toggle" data-url="' + encodeURIComponent(s.url) + '" ' + (isEnabled ? 'checked' : '') + ' />',
          '      ' + statusHtml,
          '    </label>',
          '    <div style="display:flex;gap:6px">',
          '      <button type="button" class="button small sw-btn-refresh-single-ruleset" data-url="' + encodeURIComponent(s.url) + '">🔄 更新</button>',
          '      <button type="button" class="button small sw-btn-del-ruleset" data-url="' + encodeURIComponent(s.url) + '" data-name="' + (s.name || s.url) + '" data-total="' + s.rule_count + '" data-unique="' + (s.unique_count || 0) + '" data-shared="' + sharedCount + '" style="color:#EF4444;border-color:rgba(239,68,68,0.3)">🗑 安全移除</button>',
          '    </div>',
          '  </div>',
          '</div>'
        ].join('');
      }).join('');

      // 切换规则集启用/关闭状态
      qq('.sw-ruleset-toggle', container).forEach(function (chk) {
        chk.onchange = async function () {
          var u = decodeURIComponent(chk.dataset.url);
          var en = chk.checked;
          chk.disabled = true;
          try {
            var r = await fetch('/api/v1/surge/remote-rulesets/toggle', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ url: u, enabled: en }),
            });
            var d = await r.json();
            if (d.success) {
              toast('外部规则集已' + (en ? '启用' : '关闭'), (en ? '已启用并恢复生效 ' : '已关闭并停用 ') + (d.affectedRules || 0) + ' 条规则');
            } else {
              alert('切换状态失败: ' + (d.error || '未知错误'));
              chk.checked = !en;
            }
          } catch (e) {
            alert('网络异常: ' + e.message);
            chk.checked = !en;
          }
          chk.disabled = false;
          loadDiversion();
        };
      });

      // 单个刷新
      qq('.sw-btn-refresh-single-ruleset', container).forEach(function (btn) {
        btn.onclick = async function () {
          var u = decodeURIComponent(btn.dataset.url);
          var old = btn.textContent;
          btn.disabled = true;
          btn.textContent = '更新中…';
          try {
            var r = await fetch('/api/v1/surge/remote-rulesets/refresh', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ url: u }),
            });
            var d = await r.json();
            if (d.success) toast('规则集已更新', u.split('/').pop());
            else alert('更新失败: ' + (d.error || '未知错误'));
          } catch (e) {
            alert('更新失败: ' + e.message);
          }
          btn.disabled = false;
          btn.textContent = old;
          loadDiversion();
        };
      });

      // 安全删除（带独占/共享提示）
      qq('.sw-btn-del-ruleset', container).forEach(function (btn) {
        btn.onclick = async function () {
          var u = decodeURIComponent(btn.dataset.url);
          var name = btn.dataset.name;
          var total = btn.dataset.total;
          var unique = btn.dataset.unique;
          var shared = btn.dataset.shared;

          var confirmMsg = [
            '确定要移除外部规则集【' + name + '】吗？\n',
            '⚡️ 该集合共包含 ' + total + ' 条规则：',
            '  • 独占特有规则: ' + unique + ' 条（将被安全删除，释放空间）',
            '  • 多源共享规则: ' + shared + ' 条（将被完整保留，绝不误伤其他规则集！）\n',
            '移除后将即刻执行瘦身并同步生效。'
          ].join('\n');

          if (!confirm(confirmMsg)) return;

          btn.disabled = true;
          try {
            var r = await fetch('/api/v1/surge/remote-rulesets/delete?url=' + encodeURIComponent(u), { method: 'POST' });
            var d = await r.json();
            if (d.success) {
              toast('规则集已安全移除', '清除 ' + d.deletedUnique + ' 条独占规则，保留 ' + d.preservedShared + ' 条共享规则');
            } else {
              alert('删除失败: ' + (d.error || '未知错误'));
            }
          } catch (e) {
            alert('删除失败: ' + e.message);
          }
          loadDiversion();
        };
      });

    } catch (e) {
      container.innerHTML = '<div style="color:#EF4444;grid-column:1/-1">加载已订阅规则集失败: ' + e.message + '</div>';
    }
  }

  // 刷新 Surge 联动设置与运行仪表盘
  async function loadSurgeSettingsAndRuntime() {
    try {
      var res = await fetch('/api/v1/surge/config');
      var cfg = await res.json();
      var chkEn = q('#sw-surge-enabled');
      var txtUrl = q('#sw-surge-url');
      var txtKey = q('#sw-surge-key');
      var chkSw = q('#sw-surge-auto-switch');
      var chkLn = q('#sw-surge-auto-learn');
      var chkKb = q('#sw-surge-kill-blocked');
      var statusEl = q('#sw-surge-sync-status');

      if (chkEn) chkEn.checked = Boolean(cfg.enabled);
      if (txtUrl) txtUrl.value = cfg.api_url || 'http://127.0.0.1:6171';
      if (txtKey) txtKey.value = cfg.api_key || '';
      if (chkSw) chkSw.checked = Boolean(cfg.auto_switch_on_timeout);
      if (chkLn) chkLn.checked = Boolean(cfg.auto_learn_unreachable);
      if (chkKb) chkKb.checked = Boolean(cfg.kill_blocked_active);
      if (statusEl && cfg.last_sync_status) {
        statusEl.textContent = '上次同步: ' + cfg.last_sync_status;
      }
    } catch (e) {}

    // 加载运行仪表盘
    await refreshRuntimeDashboard();
  }

  async function refreshRuntimeDashboard() {
    var board = q('#sw-runtime-dashboard');
    if (!board) return;
    try {
      var res = await fetch('/api/v1/surge/runtime');
      var data = {};
      try { data = await res.json(); } catch (_) { data = { online: false, error: '接口异常 HTTP ' + res.status }; }
      cachedRuntime = data;

      if (!data.online) {
        board.innerHTML = [
          '<div style="grid-column:1/-1;padding:14px;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);border-radius:8px">',
          '  <strong style="color:#EF4444;display:block;margin-bottom:4px">🔴 Surge 引擎离线或未连通</strong>',
          '  <div style="font-size:12px;opacity:0.85;line-height:1.5">' + (data.hint || data.error || '请检查 Surge 是否已开启 HTTP API') + '</div>',
          '</div>'
        ].join('');
        return;
      }

      var polGroups = Array.isArray(data.policyGroups) ? data.policyGroups : [];
      var mods = data.modules && Array.isArray(data.modules.enabled) ? data.modules.enabled : [];

      board.innerHTML = [
        '<div style="padding:10px 12px;background:rgba(255,255,255,0.03);border-radius:8px">',
        '  <span style="font-size:11px;opacity:0.75;display:block">出站模式</span>',
        '  <strong style="font-size:15px;color:#10B981">' + (data.outbound || 'RULE').toUpperCase() + '</strong>',
        '</div>',
        '<div style="padding:10px 12px;background:rgba(255,255,255,0.03);border-radius:8px">',
        '  <span style="font-size:11px;opacity:0.75;display:block">API 响应延迟</span>',
        '  <strong style="font-size:15px;color:#3B82F6">' + (data.rttMs || '--') + ' ms</strong>',
        '</div>',
        '<div style="padding:10px 12px;background:rgba(255,255,255,0.03);border-radius:8px">',
        '  <span style="font-size:11px;opacity:0.75;display:block">Surge 活跃模块</span>',
        '  <strong style="font-size:15px">' + mods.length + ' 个</strong>',
        '</div>',
        '<div style="padding:10px 12px;background:rgba(255,255,255,0.03);border-radius:8px">',
        '  <span style="font-size:11px;opacity:0.75;display:block">活跃策略组</span>',
        '  <strong style="font-size:15px">' + polGroups.length + ' 个</strong>',
        '</div>'
      ].join('');

      // 高亮出站按钮
      qq('.sw-btn-mode').forEach(function (btn) {
        var isCurrent = btn.dataset.mode === (data.outbound || '').toLowerCase();
        btn.classList.toggle('primary', isCurrent);
      });
    } catch (e) {
      board.innerHTML = '<div style="color:#EF4444;grid-column:1/-1">获取运行体征失败: ' + e.message + '</div>';
    }
  }

  // 执行连通性测试
  async function runConnectionTest(customUrl, customKey) {
    var resultCard = q('#sw-conn-result-card');
    if (resultCard) {
      resultCard.style.display = 'block';
      resultCard.innerHTML = '正在深度探测 Surge HTTP API 连通性…';
    }
    toast('正在测试连通性…');

    try {
      var res = await fetch('/api/v1/surge/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_url: customUrl, api_key: customKey }),
      });
      var data = {};
      try {
        data = await res.json();
      } catch (parseErr) {
        data = { success: false, error: '接口返回非 JSON 响应 (HTTP ' + res.status + ')', hint: '服务端可能正在重载或数据库正在同步' };
      }
      if (resultCard) {
        if (data.success) {
          resultCard.style.borderLeftColor = '#10B981';
          resultCard.innerHTML = [
            '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">',
            '  <strong style="color:#10B981;font-size:15px">🟢 连通成功！Surge 响应正常</strong>',
            '  <span style="font-size:12px;padding:2px 8px;background:rgba(16,185,129,0.15);border-radius:4px;color:#10B981">' + data.rttMs + ' ms</span>',
            '</div>',
            '<div style="font-size:12px;opacity:0.85;line-height:1.6">',
            '  目标接口: <code>' + data.url + '</code><br/>',
            '  当前出站模式: <strong>' + (data.outbound || '').toUpperCase() + '</strong> · 已挂载模块: ' + data.modulesCount + ' 个 · 策略组: ' + data.activePoliciesCount + ' 个',
            '</div>'
          ].join('');
          toast('Surge 连通测试通过！', '响应延迟 ' + data.rttMs + ' ms');
        } else {
          resultCard.style.borderLeftColor = '#EF4444';
          resultCard.innerHTML = [
            '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">',
            '  <strong style="color:#EF4444;font-size:15px">🔴 连通失败</strong>',
            '  <span style="font-size:12px;padding:2px 8px;background:rgba(239,68,68,0.15);border-radius:4px;color:#EF4444">' + (data.error || '错误') + '</span>',
            '</div>',
            '<div style="font-size:12px;opacity:0.85;line-height:1.6">',
            '  目标接口: <code>' + data.url + '</code><br/>',
            '  <span style="color:#F59E0B">排查建议：</span>' + (data.hint || '请核对地址与密钥'),
            '</div>'
          ].join('');
          toast('Surge 连通失败', data.error || '请检查配置');
        }
      }
      refreshRuntimeDashboard();
    } catch (e) {
      if (resultCard) {
        resultCard.innerHTML = '<div style="color:#EF4444">测试请求异常: ' + e.message + '</div>';
      }
    }
  }

  // ==================== 事件绑定 ====================

  function setupEvents() {
    // Tab 切换
    qq('.sw-tab-btn').forEach(function (btn) {
      btn.onclick = function () {
        activeTab = btn.dataset.swTab;
        updateView();
      };
    });

    // 顶部测试连通性
    var btnTestHeader = q('#sw-btn-test-conn');
    if (btnTestHeader) {
      btnTestHeader.onclick = function () {
        activeTab = 'surge-settings';
        updateView();
        runConnectionTest();
      };
    }

    // 顶部一键同步
    var btnHeaderSync = q('#sw-btn-header-sync');
    if (btnHeaderSync) {
      btnHeaderSync.onclick = async function () {
        btnHeaderSync.disabled = true;
        btnHeaderSync.textContent = '同步中…';
        try {
          await fetch('/api/v1/surge/sync', { method: 'POST' });
          toast('已向 Surge 下发同步指令');
        } catch (e) {
          toast('同步失败', e.message);
        } finally {
          btnHeaderSync.disabled = false;
          btnHeaderSync.textContent = '🔄 一键同步';
        }
      };
    }

    // 一键安装 Hub 模块解析 URL
    function resolveHubUrl() {
      var host = location.hostname || '127.0.0.1';
      // Surge 安装远程模块时必须使用 HTTP 端口 9099，避免 HTTPS 9443 因本地证书强校验失败报错“无效模块”
      var port = (location.protocol === 'http:' && location.port) ? location.port : '9099';
      return 'http://' + host + ':' + port + '/surge/hub.sgmodule';
    }

    // 一键安装 Hub 模块
    var installBtn = q('#sw-btn-install-surge');
    if (installBtn) {
      installBtn.onclick = function () {
        var hubUrl = resolveHubUrl();
        copyText(hubUrl);
        location.href = 'surge:///install-module?url=' + encodeURIComponent(hubUrl);
        toast('已调起 Surge 安装模块', '模块链接已复制到剪贴板，如未弹窗可手动粘贴');
      };
    }

    // 导入远程模块 (URL)
    var btnRefreshAllModules = q('#sw-btn-refresh-all-modules');
    if (btnRefreshAllModules) {
      btnRefreshAllModules.onclick = async function () {
        var old = btnRefreshAllModules.textContent;
        btnRefreshAllModules.disabled = true;
        btnRefreshAllModules.textContent = '正在更新全部模块…';
        try {
          var r = await fetch('/api/v1/surge/modules/refresh-all', { method: 'POST' });
          var d = await r.json();
          if (d.success) {
            var fail = (d.results || []).filter(function (x) { return !x.updated; });
            toast('全部模块已更新', '成功 ' + d.updated + ' / ' + d.total + '，本地模块跳过 ' + d.skipped + (fail.length ? '，失败 ' + fail.length : ''));
            if (fail.length) console.warn('更新失败模块:', fail);
          } else {
            alert('更新失败: ' + (d.error || '未知错误'));
          }
        } catch (e) {
          alert('更新失败: ' + e.message);
        }
        btnRefreshAllModules.disabled = false;
        btnRefreshAllModules.textContent = old;
        loadModules();
      };
    }

    var btnImportRemoteMod = q('#sw-btn-import-remote-mod');
    if (btnImportRemoteMod) {
      btnImportRemoteMod.onclick = function () {
        var html = [
          '<div style="margin-bottom:12px">',
          '  <label>远程 .sgmodule 链接 (URL)</label>',
          '  <input type="url" id="sw-import-mod-url" class="sw-input" placeholder="https://raw.githubusercontent.com/.../app.sgmodule" />',
          '  <p style="font-size:11px;margin:4px 0 0">支持 GitHub raw、jsDelivr 或任意公开 HTTP(S) 模块直链，自动国内镜像加速。</p>',
          '</div>',
          '<div style="margin-bottom:12px">',
          '  <label>自定义模块名称 (选填)</label>',
          '  <input type="text" id="sw-import-mod-name" class="sw-input" placeholder="留空则自动从模块 #!name= 读取" />',
          '</div>',
          '<div>',
          '  <label>模块分类</label>',
          '  <select id="sw-import-mod-cat" class="sw-select">',
          '    <option value="app">App 净化</option>',
          '    <option value="media">流媒体增强</option>',
          '    <option value="privacy">隐私防追踪</option>',
          '    <option value="system">系统功能</option>',
          '  </select>',
          '</div>'
        ].join('');

        openModal('🌐 导入远程 Surge 模块', html, async function () {
          var url = q('#sw-import-mod-url').value.trim();
          if (!url) { alert('请输入远程模块 URL'); return false; }
          var name = q('#sw-import-mod-name').value.trim();
          var cat = q('#sw-import-mod-cat').value;

          toast('正在抓取并脱水模块…');
          try {
            var res = await fetch('/api/v1/surge/modules/import-remote', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ url: url, name: name, category: cat }),
            });
            var data = await res.json();
            if (data.success) {
              toast('远程模块导入成功', '已下沉 ' + data.dnsRulesCount + ' 域名拦截并提纯七层');
              loadModules();
              return true;
            } else {
              alert('导入失败: ' + (data.error || '未知错误'));
              return false;
            }
          } catch (e) {
            alert('网络请求失败: ' + e.message);
            return false;
          }
        }, '开始下载并脱水导入');
      };
    }

    // 粘贴文本导入模块
    var btnAddRawMod = q('#sw-btn-add-module-raw');
    if (btnAddRawMod) {
      btnAddRawMod.onclick = function () {
        var html = [
          '<div style="margin-bottom:12px">',
          '  <label>模块名称</label>',
          '  <input type="text" id="sw-raw-mod-name" class="sw-input" placeholder="例如：知乎去推荐流" />',
          '</div>',
          '<div>',
          '  <label>.sgmodule 原始文本</label>',
          '  <textarea id="sw-raw-mod-content" class="sw-textarea" rows="12" placeholder="请粘贴完整的 .sgmodule 文本内容" spellcheck="false"></textarea>',
          '</div>'
        ].join('');

        openModal('📋 粘贴文本导入模块', html, async function () {
          var name = q('#sw-raw-mod-name').value.trim();
          var content = q('#sw-raw-mod-content').value;
          if (!content) { alert('请输入模块内容'); return false; }

          var res = await fetch('/api/v1/surge/modules', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: name, content: content }),
          });
          var data = await res.json();
          if (data.success) {
            toast('模块导入成功', '提取 ' + data.dnsRulesCount + ' 条域名并入库');
            loadModules();
            return true;
          } else {
            alert('导入失败: ' + (data.error || '未知错误'));
            return false;
          }
        }, '立即脱水导入');
      };
    }

    // 批量导入与智能清洗 Surge 规则
    var btnBatchRules = q('#sw-btn-batch-rules');
    if (btnBatchRules) {
      btnBatchRules.onclick = async function () {
        var gRes = await fetch('/api/v1/surge/diversion/groups');
        var gData = await gRes.json();
        var groups = gData.groups || [];

        var groupOpts = '<option value="">🤖 自动按每行末尾策略智能分配 (推荐)</option>' +
          groups.map(function (g) {
            return '<option value="' + g.id + '">强制分配到【' + g.name + '】(' + g.surge_policy + ')</option>';
          }).join('');

        var html = [
          '<div style="margin-bottom:12px">',
          '  <p style="font-size:12px;margin:0 0 8px;line-height:1.5">',
          '    直接从 Surge 配置文件中完整复制多行规则（如 <code>RULE-SET,https://.../AdDomain.list,REJECT,no-resolve</code> 或 <code>DOMAIN-SUFFIX,google.com,PROXY</code>）。<br/>',
          '    系统自动识别 <strong>REJECT 广告拦截</strong>、<strong>DIRECT 直连</strong>、<strong>PROXY 代理</strong>，自动抓取并展开外部规则集，广告域名自动下沉至 DNS 秒级拦截！',
          '  </p>',
          '  <textarea id="sw-batch-rules-content" class="sw-textarea" rows="12" placeholder="在此粘贴任意 Surge 规则段落、注释与外部 RULE-SET 链接..." spellcheck="false"></textarea>',
          '</div>',
          '<div style="display:flex;flex-direction:column;gap:10px;margin-bottom:12px;padding:12px;background:rgba(148,163,184,0.06);border-radius:10px">',
          '  <label style="display:flex;align-items:flex-start;gap:8px;font-size:12px;cursor:pointer">',
          '    <input type="checkbox" id="sw-batch-download" checked style="margin-top:2px" />',
          '    <span><strong>自动抓取并展开远程 RULE-SET 内部域名</strong> (REJECT 广告域名自动提取并入库本地 DNS 拦截库，直连/代理规则自动归类)</span>',
          '  </label>',
          '  <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">',
          '    <span style="font-size:12px;opacity:0.85">目标策略分配：</span>',
          '    <select id="sw-batch-override" class="sw-select" style="max-width:320px;margin-top:0">' + groupOpts + '</select>',
          '  </div>',
          '</div>'
        ].join('');

        openModal('⚡️ 批量导入 Surge 规则 (一键清洗)', html, async function () {
          var content = q('#sw-batch-rules-content').value.trim();
          if (!content) { alert('请粘贴 Surge 规则文本'); return false; }
          var download = q('#sw-batch-download').checked;
          var override = q('#sw-batch-override').value;

          toast('正在智能清洗并抓取外部规则集…', '可能需要数秒');
          try {
            var res = await fetch('/api/v1/surge/rules/batch-import', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                content: content,
                downloadRuleSets: download,
                targetGroupOverride: override,
              }),
            });
            var data = await res.json();
            if (data.success) {
              var report = [
                '总识别行数: ' + data.totalLines,
                '解析有效规则: ' + data.parsedRulesCount + ' 条',
                '抓取远程规则集: ' + data.ruleSetsFetchedCount + ' 个',
                '下沉 REJECT 广告拦截域名: ' + data.rejectCount + ' 个 (DNS 秒阻 0.0.0.0)',
                '新增直连规则: ' + data.directCount + ' 条',
                '新增代理规则: ' + data.proxyCount + ' 条',
                '更新分流组: ' + data.groupsUpdated.join('、')
              ].join('\n');
              alert('🎉 Surge 规则批量清洗与导入成功！\n\n' + report);
              loadDiversion();
              return true;
            } else {
              alert('导入失败: ' + (data.error || '未知错误'));
              return false;
            }
          } catch (e) {
            alert('网络异常: ' + e.message);
            return false;
          }
        }, '开始一键清洗导入');
      };
    }

    // 订阅外部规则集
    async function openImportRemoteRulesModal() {
      var gRes = await fetch('/api/v1/surge/diversion/groups');
      var gData = await gRes.json();
      var groups = gData.groups || [];

      var options = groups.map(function (g) {
        return '<option value="' + g.id + '">' + g.name + ' (' + g.surge_policy + ')</option>';
      }).join('');

      var html = [
        '<div style="margin-bottom:12px">',
        '  <label>规则集名称 (选填)</label>',
        '  <input type="text" id="sw-rules-name" class="sw-input" placeholder="留空则自动提取名称" />',
        '</div>',
        '<div style="margin-bottom:12px">',
        '  <label>目标分流组</label>',
        '  <select id="sw-rules-target-group" class="sw-select">' + options + '</select>',
        '</div>',
        '<div style="margin-bottom:12px">',
        '  <label>远程规则集 URL (.list / .txt)</label>',
        '  <input type="url" id="sw-rules-url" class="sw-input" placeholder="https://raw.githubusercontent.com/.../direct.list" />',
        '</div>',
        '<div>',
        '  <label>导入模式</label>',
        '  <div style="display:flex;gap:16px;margin-top:6px;font-size:13px">',
        '    <label style="cursor:pointer;display:inline-flex;align-items:center;gap:4px"><input type="radio" name="sw-rules-mode" value="append" checked /> 追加到现有规则</label>',
        '    <label style="cursor:pointer;display:inline-flex;align-items:center;gap:4px"><input type="radio" name="sw-rules-mode" value="replace" /> 覆盖全组已有规则</label>',
        '  </div>',
        '</div>'
      ].join('');

      openModal('🌐 订阅外部规则集', html, async function () {
        var name = q('#sw-rules-name').value.trim();
        var gid = q('#sw-rules-target-group').value;
        var url = q('#sw-rules-url').value.trim();
        var mode = q('input[name="sw-rules-mode"]:checked').value;
        if (!url) { alert('请输入远程规则集 URL'); return false; }

        toast('正在抓取远程规则…', '可能需要数秒');
        try {
          var res = await fetch('/api/v1/surge/remote-rulesets', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ group_id: gid, url: url, name: name }),
          });
          var data = await res.json();
          if (data.success) {
            toast('规则集订阅成功', '已导入并建立绑定 ' + (data.importedCount || 0) + ' 条规则');
            loadDiversion();
            return true;
          } else {
            alert('导入失败: ' + (data.error || '未知错误'));
            return false;
          }
        } catch (e) {
          alert('网络异常: ' + e.message);
          return false;
        }
      }, '开始下载并订阅');
    }

    var btnImportRemoteRules = q('#sw-btn-import-remote-rules');
    if (btnImportRemoteRules) {
      btnImportRemoteRules.onclick = openImportRemoteRulesModal;
    }

    // 看板上的快捷添加与一键全部刷新规则集
    var btnQuickAdd = q('#sw-btn-quick-add-ruleset');
    if (btnQuickAdd) {
      btnQuickAdd.onclick = openImportRemoteRulesModal;
    }
    var btnQuickRefreshAll = q('#sw-btn-quick-refresh-rulesets');
    if (btnQuickRefreshAll) {
      btnQuickRefreshAll.onclick = async function () {
        var old = btnQuickRefreshAll.textContent;
        btnQuickRefreshAll.disabled = true;
        btnQuickRefreshAll.textContent = '正在刷新全部规则集…';
        try {
          var r = await fetch('/api/v1/surge/remote-rulesets/refresh', { method: 'POST' });
          var d = await r.json();
          if (d.success) toast('规则集已全部更新', '共 ' + d.total + ' 个集合，成功 ' + d.updated);
          else alert('更新失败: ' + (d.error || '未知错误'));
        } catch (e) {
          alert('网络异常: ' + e.message);
        }
        btnQuickRefreshAll.disabled = false;
        btnQuickRefreshAll.textContent = old;
        loadDiversion();
      };
    }

    // 添加单条规则
    var btnAddRule = q('#sw-btn-add-rule');
    if (btnAddRule) {
      btnAddRule.onclick = async function () {
        var gRes = await fetch('/api/v1/surge/diversion/groups');
        var gData = await gRes.json();
        var groups = gData.groups || [];
        var options = groups.map(function (g) {
          return '<option value="' + g.id + '">' + g.name + ' (' + g.surge_policy + ')</option>';
        }).join('');

        var html = [
          '<div style="margin-bottom:12px">',
          '  <label>目标分流组</label>',
          '  <select id="sw-add-rule-gid" class="sw-select">' + options + '</select>',
          '</div>',
          '<div style="margin-bottom:12px">',
          '  <label>匹配类型</label>',
          '  <select id="sw-add-rule-type" class="sw-select">',
          '    <option value="DOMAIN-SUFFIX">DOMAIN-SUFFIX (后缀通配)</option>',
          '    <option value="DOMAIN">DOMAIN (完全匹配)</option>',
          '    <option value="DOMAIN-KEYWORD">DOMAIN-KEYWORD (关键字)</option>',
          '    <option value="IP-CIDR">IP-CIDR (网段)</option>',
          '    <option value="RULE-SET">RULE-SET (远程规则集)</option>',
          '  </select>',
          '</div>',
          '<div style="margin-bottom:12px">',
          '  <label>匹配表达式 (域名 / IP / 规则集 URL)</label>',
          '  <input type="text" id="sw-add-rule-pat" class="sw-input" placeholder="例如：example.com 或 https://..." />',
          '</div>',
          '<div>',
          '  <label>备注说明 (选填)</label>',
          '  <input type="text" id="sw-add-rule-comment" class="sw-input" placeholder="例如：办公内网" />',
          '</div>'
        ].join('');

        openModal('添加单个分流规则', html, async function () {
          var gid = q('#sw-add-rule-gid').value;
          var type = q('#sw-add-rule-type').value;
          var pat = q('#sw-add-rule-pat').value.trim();
          var comment = q('#sw-add-rule-comment').value.trim();
          if (!pat) { alert('请输入匹配表达式'); return false; }

          var res = await fetch('/api/v1/surge/diversion/rules', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ group_id: gid, match_type: type, pattern: pat, comment: comment }),
          });
          var data = await res.json();
          if (data.success) {
            toast('规则添加成功', pat);
            loadDiversion();
            return true;
          } else {
            alert('添加失败: ' + (data.error || '未知错误'));
            return false;
          }
        }, '立即添加');
      };
    }

    // 新建分流组
    var btnCreateGroup = q('#sw-btn-create-group');
    if (btnCreateGroup) {
      btnCreateGroup.onclick = openCreateGroupModal;
    }

    // 运行体征刷新
    var btnRefreshRun = q('#sw-btn-refresh-runtime');
    if (btnRefreshRun) {
      btnRefreshRun.onclick = refreshRuntimeDashboard;
    }

    // 出站模式快捷切换
    qq('.sw-btn-mode').forEach(function (btn) {
      btn.onclick = async function () {
        var mode = btn.dataset.mode;
        toast('正在切换 Surge 出站模式至 ' + mode.toUpperCase() + '…');
        var res = await fetch('/api/v1/surge/outbound', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: mode }),
        });
        var data = await res.json();
        if (data.success) {
          toast('模式切换成功', mode.toUpperCase());
          refreshRuntimeDashboard();
        } else {
          toast('切换失败', data.error || 'Surge API 未响应');
        }
      };
    });

    // 表单内测试连接
    var btnTestInForm = q('#sw-btn-test-in-form');
    if (btnTestInForm) {
      btnTestInForm.onclick = function () {
        var u = q('#sw-surge-url')?.value.trim();
        var k = q('#sw-surge-key')?.value.trim();
        runConnectionTest(u, k);
      };
    }

    // 保存 Surge 联动配置
    var saveCfgBtn = q('#sw-btn-save-surge-config');
    if (saveCfgBtn) {
      saveCfgBtn.onclick = async function () {
        saveCfgBtn.disabled = true;
        var payload = {
          enabled: q('#sw-surge-enabled').checked,
          api_url: q('#sw-surge-url').value.trim(),
          api_key: q('#sw-surge-key').value.trim(),
          auto_switch_on_timeout: q('#sw-surge-auto-switch').checked,
          auto_learn_unreachable: q('#sw-surge-auto-learn').checked,
          kill_blocked_active: q('#sw-surge-kill-blocked').checked,
        };
        try {
          await fetch('/api/v1/surge/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          toast('Surge 联动配置已保存');
          runConnectionTest(payload.api_url, payload.api_key);
        } catch (e) {
          alert('保存失败: ' + e.message);
        } finally {
          saveCfgBtn.disabled = false;
        }
      };
    }

    // 向导复制按钮
    var btnCopyGeneral = q('#sw-guide-copy-general');
    if (btnCopyGeneral) {
      btnCopyGeneral.onclick = function () {
        var host = location.hostname || '127.0.0.1';
        var httpPort = (location.protocol === 'http:' && location.port) ? location.port : '9099';
        var baseUrl = 'http://' + host + ':' + httpPort;
        var txt = [
          '[General]',
          '# 1. 安全 DoH 接管（需安装并信任 LocalDNS Root CA）',
          'doh-server = https://127.0.0.1:9443/dns-query',
          'skip-proxy = 127.0.0.1, 192.168.0.0/16, 10.0.0.0/8, 172.16.0.0/12, localhost, *.local, captive.apple.com',
          '',
          '# 2. 拦截 QUIC（UDP 443），迫使 YouTube 等 App 回退 TCP，才能被 MitM 解密去广告',
          'block-quic = true',
          '',
          '# 3. 开启 HTTP API 联动',
          'http-api = localdnskey@0.0.0.0:6171',
          'http-api-tls = false',
          'http-api-web-dashboard = false'
        ].join('\n');
        copyText(txt);
        toast('已复制 [General] 配置片段', '请粘贴至 Surge [General] 节点中');
      };
    }

    var btnOpenHub = q('#sw-guide-open-hub');
    if (btnOpenHub) {
      btnOpenHub.onclick = function () {
        var hubUrl = resolveHubUrl();
        copyText(hubUrl);
        location.href = 'surge:///install-module?url=' + encodeURIComponent(hubUrl);
        toast('已调起 Surge 安装模块', '模块链接已复制到剪贴板，如未弹窗可手动粘贴');
      };
    }

    var btnCopyRules = q('#sw-guide-copy-rules');
    if (btnCopyRules) {
      btnCopyRules.onclick = function () {
        var host = location.hostname || '127.0.0.1';
        var httpPort = (location.protocol === 'http:' && location.port) ? location.port : '9099';
        var baseUrl = 'http://' + host + ':' + httpPort;
        var txt = [
          '[Rule]',
          '# 1. 拦截 QUIC（UDP 443），迫使其走 TCP 以便解密与脚本去广告',
          'AND,((PROTOCOL,UDP),(DEST-PORT,443)),REJECT-NO-DROP',
          '',
          '# 2. LocalDNS 动态广告与黑洞拦截规则集（5.3万条规则，必须置于 [Rule] 最顶部）',
          'RULE-SET,' + baseUrl + '/rules/block.list,REJECT',
          '',
          '# 3. LocalDNS 动态分流托管规则集',
          'RULE-SET,' + baseUrl + '/rules/direct.list,DIRECT',
          'RULE-SET,' + baseUrl + '/rules/proxy.list,PROXY',
          'RULE-SET,' + baseUrl + '/rules/media.list,PROXY',
          '',
          '# 4. 兜底规则',
          'GEOIP,CN,DIRECT',
          'FINAL,PROXY,dns-failed'
        ].join('\n');
        copyText(txt);
        toast('已复制完整 [Rule] 规则模板', '已包含 block.list 广告拦截，请粘贴至 Surge [Rule] 区域顶部');
      };
    }

    // 导出 Surge 配置按钮 (分流治理面板)
    var btnRefreshRemoteRules = q('#sw-btn-refresh-remote-rules');
    if (btnRefreshRemoteRules) {
      btnRefreshRemoteRules.onclick = async function () {
        var old = btnRefreshRemoteRules.textContent;
        btnRefreshRemoteRules.disabled = true;
        btnRefreshRemoteRules.textContent = '正在更新远程规则集…';
        try {
          var r = await fetch('/api/v1/surge/remote-rulesets/refresh', { method: 'POST' });
          var d = await r.json();
          if (d.success) {
            var fails = (d.details || []).filter(function (x) { return x.error; });
            toast('远程规则集已更新', '共 ' + d.total + ' 个，成功 ' + d.updated + (fails.length ? '，失败 ' + fails.length : ''));
            if (fails.length) console.warn('更新失败规则集:', fails);
          } else {
            alert('更新失败: ' + (d.error || '未知错误'));
          }
        } catch (e) {
          alert('更新失败: ' + e.message);
        }
        btnRefreshRemoteRules.disabled = false;
        btnRefreshRemoteRules.textContent = old;
        if (typeof loadDiversion === 'function') loadDiversion();
      };
    }

    var btnExportConf = q('#sw-btn-export-conf');
    if (btnExportConf) {
      btnExportConf.onclick = function () {
        openSurgeConfModal('ruleset');
      };
    }

    // 向导顶部：一键调起安装配置
    var btnGuideOpenConf = q('#sw-guide-open-conf');
    if (btnGuideOpenConf) {
      btnGuideOpenConf.onclick = function () {
        var confUrl = location.origin + '/surge/localdns.conf?mode=ruleset';
        var installScheme = 'surge:///install-config?url=' + encodeURIComponent(confUrl);
        location.href = installScheme;
        toast('已调起 Surge 安装配置', '若未响应可使用直链: ' + confUrl);
      };
    }

    // 向导顶部：下载 .conf 文件
    var btnGuideDlConf = q('#sw-guide-download-conf');
    if (btnGuideDlConf) {
      btnGuideDlConf.onclick = function () {
        var downloadUrl = '/surge/localdns.conf?host=' + encodeURIComponent(location.host) + '&mode=ruleset&download=1';
        window.open(downloadUrl, '_blank');
        toast('正在下载 LocalDNS.conf 配置文件');
      };
    }

    // 向导顶部：复制完整配置
    var btnGuideCopyFull = q('#sw-guide-copy-full-conf');
    if (btnGuideCopyFull) {
      btnGuideCopyFull.onclick = async function () {
        toast('正在拉取完整配置文件…');
        try {
          var res = await fetch('/surge/localdns.conf?host=' + encodeURIComponent(location.host) + '&mode=ruleset');
          var txt = await res.text();
          copyText(txt);
        } catch (e) {
          alert('获取配置文件失败: ' + e.message);
        }
      };
    }

    // 向导顶部：定制/预览
    var btnGuideCustomConf = q('#sw-guide-customize-conf');
    if (btnGuideCustomConf) {
      btnGuideCustomConf.onclick = function () {
        openSurgeConfModal('ruleset');
      };
    }

    // 向导顶部：复制直链
    var btnGuideCopyUrl = q('#sw-guide-copy-conf-url');
    if (btnGuideCopyUrl) {
      btnGuideCopyUrl.onclick = function () {
        var uInput = q('#sw-guide-conf-url-input');
        if (uInput) copyText(uInput.value);
      };
    }

    // 抓包会话刷新与搜索事件
    var btnCsRefresh = q('#sw-cs-refresh-btn');
    if (btnCsRefresh) {
      btnCsRefresh.onclick = function () {
        loadCaptureSessions();
      };
    }
    var selCs = q('#sw-cs-select');
    if (selCs) {
      selCs.onchange = function () {
        currentCaptureSession = selCs.value;
        renderSessionMeta();
        loadSessionRequests(currentCaptureSession, 0);
      };
    }
    var inputCsSearch = q('#sw-cs-search-input');
    if (inputCsSearch) {
      inputCsSearch.oninput = function () {
        renderSessionRequestsTable();
      };
    }
  }

  // ==================== 视图装配与生命周期 ====================

  function updateView() {
    var pcRoot = q('.pc-root');
    if (!pcRoot) return;

    var container = q('#sw-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'sw-container';
      var heading = q('.pc-heading', pcRoot);
      if (heading) {
        heading.insertAdjacentElement('afterend', container);
      } else {
        pcRoot.prepend(container);
      }
    }

    // 确保自适应样式已注入
    injectWorkbenchStyles();

    // 控制原生编辑器的显隐
    var sourceBar = q('.pc-sourcebar', pcRoot);
    var workspaceEl = q('.pc-workspace', pcRoot);
    var footnoteEl = q('.pc-footnote', pcRoot);
    var editorEl = q('#pc-editor', pcRoot);
    var statusEl = q('#pc-status', pcRoot);
    var actionsEl = q('.pc-actions', pcRoot);
    var httpForm = q('#pc-http-form', pcRoot);
    var rawShow = activeTab === 'raw-editor';

    if (sourceBar) sourceBar.style.display = rawShow ? '' : 'none';
    if (workspaceEl) workspaceEl.style.display = rawShow ? '' : 'none';
    if (footnoteEl) footnoteEl.style.display = rawShow ? '' : 'none';
    if (editorEl) editorEl.style.display = rawShow ? '' : 'none';
    if (statusEl) statusEl.style.display = rawShow ? '' : 'none';
    if (actionsEl) actionsEl.style.display = rawShow ? '' : 'none';
    if (httpForm && !rawShow) httpForm.hidden = true;

    // 当切换至原生编辑时，确保配置核心选中并加载 Surge
    if (rawShow) {
      var coreSelect = q('#pc-core-select', pcRoot);
      if (coreSelect && coreSelect.value !== 'surge') {
        var surgeOpt = q('option[value="surge"]', coreSelect);
        if (surgeOpt) {
          coreSelect.value = 'surge';
          coreSelect.dispatchEvent(new Event('change'));
        }
      }
    }

    // 渲染我们注入的状态栏、Tab 栏与对应面板
    var html = renderHeaderStatus() + renderTabs();
    if (activeTab === 'modules') html += renderModulesView();
    if (activeTab === 'diversion') html += renderDiversionView();
    if (activeTab === 'capture-sessions') html += renderCaptureSessionsView();
    if (activeTab === 'surge-settings') html += renderSurgeSettingsView();
    if (activeTab === 'guide') html += renderGuideView();

    container.innerHTML = html;
    setupEvents();
    syncSurgeHeaderInfo();

    if (activeTab === 'modules') loadModules();
    if (activeTab === 'diversion') loadDiversion();
    if (activeTab === 'capture-sessions') loadCaptureSessions();
    if (activeTab === 'surge-settings') loadSurgeSettingsAndRuntime();
  }

  function syncSurgeHeaderInfo() {
    var subEl = q('.pp-heading p');
    if (subEl) {
      subEl.textContent = '查看 Surge 代理用量，管理核心联动配置。';
    }
    var statEl = q('#proxy-stat-status');
    if (statEl) {
      if (cachedRuntime && cachedRuntime.online) {
        statEl.textContent = 'Surge · 采集中';
      } else if (cachedRuntime && !cachedRuntime.online) {
        statEl.textContent = 'Surge · 未连接';
      }
    }
  }

  function checkRoute() {
    if (location.hash.includes('proxy-config')) {
      syncSurgeHeaderInfo();
      var pcRoot = q('.pc-root');
      if (pcRoot && (!q('#sw-container') || !workbenchInjected)) {
        workbenchInjected = true;
        // 初始静默探测一次 Surge 状态用于展示顶部徽标
        fetch('/api/v1/surge/runtime')
          .then(function (r) { return r.json(); })
          .then(function (d) { cachedRuntime = d; updateView(); syncSurgeHeaderInfo(); })
          .catch(function () { updateView(); syncSurgeHeaderInfo(); });
      }
    } else {
      workbenchInjected = false;
    }
  }

  window.addEventListener('hashchange', checkRoute);
  setInterval(checkRoute, 600);
})();
