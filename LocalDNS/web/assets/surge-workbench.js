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

  function openModal(title, contentHtml, onConfirm, confirmText) {
    injectWorkbenchStyles();
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
        '  <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:16px;padding-top:12px;border-top:1px solid rgba(148,163,184,0.15);flex-shrink:0">',
        '    <button type="button" class="button" id="sw-modal-cancel">取消</button>',
        '    <button type="button" class="button primary" id="sw-modal-ok">确定</button>',
        '  </div>',
        '</div>'
      ].join('');
      document.body.appendChild(modal);

      q('#sw-modal-close', modal).onclick = closeModal;
      q('#sw-modal-cancel', modal).onclick = closeModal;
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
      '      <h2 style="font-size:16px;margin:0 0 4px">动态分流规则组</h2>',
      '      <p style="font-size:12px;opacity:0.75;margin:0">每个分流组独立生成在线 RULE-SET 订阅链接，Surge 引用后即可零重启热更新。</p>',
      '    </div>',
      '    <div style="display:flex;gap:8px;flex-wrap:wrap">',
      '      <button type="button" class="button small primary" id="sw-btn-import-remote-rules">🌐 导入远程规则集 (URL)</button>',
      '      <button type="button" class="button small" id="sw-btn-add-rule">+ 添加单个域名</button>',
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

  // ==================== 4. Surge 配置向导 ====================

  function renderGuideView() {
    var origin = location.origin;
    var hubUrl = origin + '/surge/hub.sgmodule';
    var directUrl = origin + '/rules/direct.list';
    var proxyUrl = origin + '/rules/proxy.list';
    var mediaUrl = origin + '/rules/media.list';

    var surgeGeneralSnippet = [
      '[General]',
      '# 1. 开启 HTTP API (密钥可自定义，保持一致即可)',
      'http-api = localdnskey@0.0.0.0:6171',
      'http-api-tls = false',
      'http-api-web-dashboard = false'
    ].join('\n');

    var surgeRulesSnippet = [
      '[Rule]',
      '# LocalDNS 动态分流托管规则集',
      'RULE-SET,' + directUrl + ',DIRECT',
      'RULE-SET,' + proxyUrl + ',PROXY',
      'RULE-SET,' + mediaUrl + ',PROXY',
      'FINAL,PROXY,dns-failed'
    ].join('\n');

    return [
      '<div class="sw-panel" id="sw-panel-guide">',
      '  <div class="glass-card" style="padding:20px;max-width:780px">',
      '    <h2 style="font-size:17px;margin:0 0 8px">📖 Surge 联动配置向导</h2>',
      '    <p style="font-size:13px;opacity:0.8;margin:0 0 20px;line-height:1.5">只需 3 步，即可完成 LocalDNS 与 Surge 的深度缝合，实现 DNS 拦截脱水、单一模块调度与全链路动态分流。</p>',
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
          '  <div style="display:flex;justify-content:flex-end;margin-top:10px;gap:6px">',
          '    <button type="button" class="button small sw-btn-edit-mod" data-mod-id="' + m.id + '" data-mod-name="' + m.name + '">✏️ 编辑代码</button>',
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

  // 刷新分流组列表
  async function loadDiversion() {
    var container = q('#sw-groups-list');
    if (!container) return;
    try {
      var res = await fetch('/api/v1/surge/diversion/groups');
      var data = await res.json();
      if (!data.groups) return;

      container.innerHTML = data.groups.map(function (g) {
        var subUrl = location.origin + '/rules/' + g.id + '.list';
        return [
          '<div class="glass-card" style="padding:14px">',
          '  <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">',
          '    <div>',
          '      <strong style="font-size:14px">' + g.name + '</strong>',
          '      <span style="font-size:12px;margin-left:8px;padding:2px 6px;background:rgba(148,163,184,0.15);border-radius:4px">策略: ' + g.surge_policy + '</span>',
          '      <p style="font-size:12px;opacity:0.75;margin:4px 0 0">' + (g.description || '') + '</p>',
          '    </div>',
          '    <div style="display:flex;align-items:center;gap:8px">',
          '      <a href="' + subUrl + '" target="_blank" class="button small">查看订阅</a>',
          '      <button type="button" class="button small sw-btn-edit-rules" data-group-id="' + g.id + '" data-group-name="' + g.name + '">✏️ 编辑全组规则</button>',
          '      <label style="cursor:pointer;display:inline-flex;align-items:center;gap:4px;font-size:13px;margin-left:6px">',
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
              return true;
            } else {
              alert('保存失败: ' + (saveData.error || '未知错误'));
              return false;
            }
          }, '保存全部规则');
        };
      });
    } catch (e) {
      container.innerHTML = '<div style="color:#EF4444">加载分流组失败: ' + e.message + '</div>';
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
      var data = await res.json();
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
      var data = await res.json();
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

    // 一键安装 Hub 模块
    var installBtn = q('#sw-btn-install-surge');
    if (installBtn) {
      installBtn.onclick = function () {
        var hubUrl = location.origin + '/surge/hub.sgmodule';
        location.href = 'surge:///install-module?url=' + encodeURIComponent(hubUrl);
        toast('已调起 Surge 安装模块', '若未响应可复制: ' + hubUrl);
      };
    }

    // 导入远程模块 (URL)
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

    // 导入远程规则集
    var btnImportRemoteRules = q('#sw-btn-import-remote-rules');
    if (btnImportRemoteRules) {
      btnImportRemoteRules.onclick = async function () {
        var gRes = await fetch('/api/v1/surge/diversion/groups');
        var gData = await gRes.json();
        var groups = gData.groups || [];

        var options = groups.map(function (g) {
          return '<option value="' + g.id + '">' + g.name + ' (' + g.surge_policy + ')</option>';
        }).join('');

        var html = [
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

        openModal('🌐 导入远程规则集', html, async function () {
          var gid = q('#sw-rules-target-group').value;
          var url = q('#sw-rules-url').value.trim();
          var mode = q('input[name="sw-rules-mode"]:checked').value;
          if (!url) { alert('请输入远程规则集 URL'); return false; }

          toast('正在抓取远程规则…');
          try {
            var res = await fetch('/api/v1/surge/diversion/rules/import-remote', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ group_id: gid, url: url, mode: mode }),
            });
            var data = await res.json();
            if (data.success) {
              toast('规则导入成功', '已导入 ' + data.importedCount + ' 条规则');
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
        }, '开始下载并导入');
      };
    }

    // 添加单条域名
    var btnAddRule = q('#sw-btn-add-rule');
    if (btnAddRule) {
      btnAddRule.onclick = async function () {
        var gRes = await fetch('/api/v1/surge/diversion/groups');
        var gData = await gRes.json();
        var groups = gData.groups || [];
        var options = groups.map(function (g) {
          return '<option value="' + g.id + '">' + g.name + '</option>';
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
          '  </select>',
          '</div>',
          '<div style="margin-bottom:12px">',
          '  <label>匹配表达式 (域名/IP)</label>',
          '  <input type="text" id="sw-add-rule-pat" class="sw-input" placeholder="例如：example.com" />',
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
        var txt = [
          '[General]',
          'http-api = localdnskey@0.0.0.0:6171',
          'http-api-tls = false',
          'http-api-web-dashboard = false'
        ].join('\n');
        copyText(txt);
      };
    }

    var btnOpenHub = q('#sw-guide-open-hub');
    if (btnOpenHub) {
      btnOpenHub.onclick = function () {
        var hubUrl = location.origin + '/surge/hub.sgmodule';
        location.href = 'surge:///install-module?url=' + encodeURIComponent(hubUrl);
        toast('已调起 Surge 安装模块', '若未响应可复制: ' + hubUrl);
      };
    }

    var btnCopyRules = q('#sw-guide-copy-rules');
    if (btnCopyRules) {
      btnCopyRules.onclick = function () {
        var origin = location.origin;
        var txt = [
          '[Rule]',
          'RULE-SET,' + origin + '/rules/direct.list,DIRECT',
          'RULE-SET,' + origin + '/rules/proxy.list,PROXY',
          'RULE-SET,' + origin + '/rules/media.list,PROXY',
          'FINAL,PROXY,dns-failed'
        ].join('\n');
        copyText(txt);
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
    var editorEl = q('#pc-editor', pcRoot);
    var statusEl = q('#pc-status', pcRoot);
    var actionsEl = q('.pc-actions', pcRoot);
    var httpForm = q('#pc-http-form', pcRoot);
    var rawShow = activeTab === 'raw-editor';

    if (sourceBar) sourceBar.style.display = rawShow ? '' : 'none';
    if (editorEl) editorEl.style.display = rawShow ? '' : 'none';
    if (statusEl) statusEl.style.display = rawShow ? '' : 'none';
    if (actionsEl) actionsEl.style.display = rawShow ? '' : 'none';
    if (httpForm && !rawShow) httpForm.hidden = true;

    // 渲染我们注入的状态栏、Tab 栏与对应面板
    var html = renderHeaderStatus() + renderTabs();
    if (activeTab === 'modules') html += renderModulesView();
    if (activeTab === 'diversion') html += renderDiversionView();
    if (activeTab === 'surge-settings') html += renderSurgeSettingsView();
    if (activeTab === 'guide') html += renderGuideView();

    container.innerHTML = html;
    setupEvents();

    if (activeTab === 'modules') loadModules();
    if (activeTab === 'diversion') loadDiversion();
    if (activeTab === 'surge-settings') loadSurgeSettingsAndRuntime();
  }

  function checkRoute() {
    if (location.hash.includes('proxy-config')) {
      var pcRoot = q('.pc-root');
      if (pcRoot && (!q('#sw-container') || !workbenchInjected)) {
        workbenchInjected = true;
        // 初始静默探测一次 Surge 状态用于展示顶部徽标
        fetch('/api/v1/surge/runtime')
          .then(function (r) { return r.json(); })
          .then(function (d) { cachedRuntime = d; updateView(); })
          .catch(function () { updateView(); });
      }
    } else {
      workbenchInjected = false;
    }
  }

  window.addEventListener('hashchange', checkRoute);
  setInterval(checkRoute, 600);
})();
