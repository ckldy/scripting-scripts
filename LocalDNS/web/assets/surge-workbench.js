/**
 * web/assets/surge-workbench.js
 *
 * LocalDNS × Surge 模块工作台与动态分流可视化面板
 * 挂载于 #/proxy-config 路由，提供：
 * 1. App 模块管理（独立开关、规则脱水统计、一键导入）
 * 2. 动态分流治理（分组开关、域名规则维护、RULE-SET 订阅导出）
 * 3. Surge 联动调度与出站控制（模式切换、一键同步）
 */

(function () {
  var activeTab = 'modules'; // 'modules' | 'diversion' | 'surge-settings' | 'raw-editor'
  var workbenchInjected = false;

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
    el.style.cssText = 'background:rgba(30,41,59,0.92);color:#fff;padding:10px 16px;border-radius:10px;margin-top:8px;font-size:13px;box-shadow:0 8px 24px rgba(0,0,0,0.2);backdrop-filter:blur(10px);z-index:9999;transition:opacity 0.3s';
    el.innerHTML = '<strong>' + title + '</strong>' + (desc ? '<div style="opacity:0.8;font-size:12px;margin-top:2px">' + desc + '</div>' : '');
    stack.appendChild(el);
    setTimeout(function () {
      el.style.opacity = '0';
      setTimeout(function () { el.remove(); }, 300);
    }, 2500);
  }

  function renderTabs() {
    return [
      '<div class="sw-tab-bar" style="display:flex;gap:8px;margin:16px 0;padding:4px;background:rgba(148,163,184,0.12);border-radius:12px;max-width:600px">',
      '  <button type="button" class="sw-tab-btn ' + (activeTab === 'modules' ? 'active' : '') + '" data-sw-tab="modules" style="flex:1;padding:8px 12px;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;background:' + (activeTab === 'modules' ? 'var(--color-primary, #B45309)' : 'transparent') + ';color:' + (activeTab === 'modules' ? '#fff' : 'inherit') + '">📦 Surge 模块工作台</button>',
      '  <button type="button" class="sw-tab-btn ' + (activeTab === 'diversion' ? 'active' : '') + '" data-sw-tab="diversion" style="flex:1;padding:8px 12px;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;background:' + (activeTab === 'diversion' ? 'var(--color-primary, #B45309)' : 'transparent') + ';color:' + (activeTab === 'diversion' ? '#fff' : 'inherit') + '">🔀 动态分流治理</button>',
      '  <button type="button" class="sw-tab-btn ' + (activeTab === 'surge-settings' ? 'active' : '') + '" data-sw-tab="surge-settings" style="flex:1;padding:8px 12px;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;background:' + (activeTab === 'surge-settings' ? 'var(--color-primary, #B45309)' : 'transparent') + ';color:' + (activeTab === 'surge-settings' ? '#fff' : 'inherit') + '">⚙️ 联动与同步</button>',
      '  <button type="button" class="sw-tab-btn ' + (activeTab === 'raw-editor' ? 'active' : '') + '" data-sw-tab="raw-editor" style="flex:1;padding:8px 12px;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;background:' + (activeTab === 'raw-editor' ? 'var(--color-primary, #B45309)' : 'transparent') + ';color:' + (activeTab === 'raw-editor' ? '#fff' : 'inherit') + '">📝 原生配置编辑</button>',
      '</div>'
    ].join('');
  }

  // 1. 模块工作台主视图
  function renderModulesView() {
    return [
      '<div class="sw-panel" id="sw-panel-modules">',
      '  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:10px">',
      '    <div>',
      '      <h2 style="font-size:16px;margin:0 0 4px">已托管 App 净化模块</h2>',
      '      <p style="font-size:12px;opacity:0.75;margin:0">所有模块中的域名拦截已被 LocalDNS 本地吸收并纳秒级阻断，仅向 Surge 注入必要之七层重写。</p>',
      '    </div>',
      '    <div style="display:flex;gap:8px">',
      '      <button type="button" class="button small" id="sw-btn-install-surge" style="background:#10B981;color:#fff">📲 导入至 Surge</button>',
      '      <button type="button" class="button small" id="sw-btn-sync-surge">🔄 立即同步</button>',
      '      <button type="button" class="button small primary" id="sw-btn-add-module">+ 导入新模块</button>',
      '    </div>',
      '  </div>',
      '  <div id="sw-modules-list" style="display:grid;grid-template-columns:repeat(auto-fill, minmax(280px, 1fr));gap:12px">',
      '    <div style="padding:20px;text-align:center;opacity:0.6;grid-column:1/-1">正在读取模块数据库…</div>',
      '  </div>',
      '</div>'
    ].join('');
  }

  // 2. 动态分流治理主视图
  function renderDiversionView() {
    return [
      '<div class="sw-panel" id="sw-panel-diversion">',
      '  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:10px">',
      '    <div>',
      '      <h2 style="font-size:16px;margin:0 0 4px">动态分流规则组</h2>',
      '      <p style="font-size:12px;opacity:0.75;margin:0">每个分流组独立生成在线 RULE-SET 订阅链接，Surge 引用后即可零重启热更新。</p>',
      '    </div>',
      '    <div style="display:flex;gap:8px">',
      '      <button type="button" class="button small primary" id="sw-btn-add-rule">+ 添加分流域名</button>',
      '    </div>',
      '  </div>',
      '  <div id="sw-groups-list" style="display:flex;flex-direction:column;gap:12px">',
      '    <div style="padding:20px;text-align:center;opacity:0.6">正在加载分流数据库…</div>',
      '  </div>',
      '</div>'
    ].join('');
  }

  // 3. Surge 联动设置视图
  function renderSurgeSettingsView() {
    return [
      '<div class="sw-panel" id="sw-panel-surge-settings">',
      '  <div class="glass-card" style="padding:18px;max-width:680px">',
      '    <h2 style="font-size:16px;margin:0 0 12px">Surge HTTP API 联动控制</h2>',
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
      '      <h3 style="font-size:13px;margin:0 0 8px">自动化调度与防护策略</h3>',
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
      '    <div style="display:flex;justify-content:space-between;align-items:center">',
      '      <span id="sw-surge-sync-status" style="font-size:12px;opacity:0.7">尚未同步</span>',
      '      <button type="button" class="button primary" id="sw-btn-save-surge-config">保存配置并连接测试</button>',
      '    </div>',
      '  </div>',
      '</div>'
    ].join('');
  }

  // 刷新模块列表
  async function loadModules() {
    var container = q('#sw-modules-list');
    if (!container) return;
    try {
      var res = await fetch('/api/v1/surge/modules');
      var data = await res.json();
      if (!data.modules || data.modules.length === 0) {
        container.innerHTML = '<div style="padding:30px;text-align:center;opacity:0.6;grid-column:1/-1">暂无 App 净化模块。点击右上角「+ 导入新模块」添加 B站、知乎、小红书等去广告模块。</div>';
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
          '    <button type="button" class="button small sw-btn-del-mod" data-mod-id="' + m.id + '" style="color:#EF4444;border-color:rgba(239,68,68,0.3)">删除</button>',
          '  </div>',
          '</div>'
        ].join('');
      }).join('');

      // 绑定开关事件
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

      // 绑定删除事件
      qq('.sw-btn-del-mod', container).forEach(function (btn) {
        btn.onclick = async function () {
          if (!confirm('确定要删除该 App 模块吗？')) return;
          var id = btn.dataset.modId;
          await fetch('/api/v1/surge/modules/' + encodeURIComponent(id), { method: 'DELETE' });
          toast('模块已删除', id);
          loadModules();
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
          '      <span style="font-size:12px;margin-left:8px;padding:2px 6px;background:rgba(148,163,184,0.15);border-radius:4px">出站策略: ' + g.surge_policy + '</span>',
          '      <p style="font-size:12px;opacity:0.75;margin:4px 0 0">' + (g.description || '') + '</p>',
          '    </div>',
          '    <div style="display:flex;align-items:center;gap:10px">',
          '      <a href="' + subUrl + '" target="_blank" class="button small" title="查看导出的 RULE-SET 规则文本">查看订阅</a>',
          '      <label style="cursor:pointer;display:inline-flex;align-items:center;gap:4px;font-size:13px">',
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
    } catch (e) {
      container.innerHTML = '<div style="color:#EF4444">加载分流组失败: ' + e.message + '</div>';
    }
  }

  // 刷新 Surge 联动设置
  async function loadSurgeSettings() {
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
  }

  function setupEvents() {
    // Tab 切换
    qq('.sw-tab-btn').forEach(function (btn) {
      btn.onclick = function () {
        activeTab = btn.dataset.swTab;
        updateView();
      };
    });

    // Surge 一键安装
    var installBtn = q('#sw-btn-install-surge');
    if (installBtn) {
      installBtn.onclick = function () {
        var hubUrl = location.origin + '/surge/hub.sgmodule';
        var scheme = 'surge:///install-module?url=' + encodeURIComponent(hubUrl);
        location.href = scheme;
        toast('已调起 Surge 安装模块', '若未响应可手动复制: ' + hubUrl);
      };
    }

    // 立即同步
    var syncBtn = q('#sw-btn-sync-surge');
    if (syncBtn) {
      syncBtn.onclick = async function () {
        syncBtn.disabled = true;
        syncBtn.textContent = '正在同步…';
        try {
          var res = await fetch('/api/v1/surge/sync', { method: 'POST' });
          toast('已向 Surge 下发同步指令', '刷新 RULE-SET 与模块');
        } catch (e) {
          toast('同步失败', e.message);
        } finally {
          syncBtn.disabled = false;
          syncBtn.textContent = '🔄 立即同步';
        }
      };
    }

    // 导入新模块弹窗
    var addModBtn = q('#sw-btn-add-module');
    if (addModBtn) {
      addModBtn.onclick = function () {
        var name = prompt('请输入模块名称（如：哔哩哔哩净化）：', '');
        if (!name) return;
        var content = prompt('请粘贴 .sgmodule 原始文本内容：', '');
        if (!content) return;
        fetch('/api/v1/surge/modules', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name, content: content }),
        })
          .then(function (r) { return r.json(); })
          .then(function (res) {
            if (res.success) {
              toast('模块导入成功', '已提取 ' + res.dnsRulesCount + ' 域名并脱水');
              loadModules();
            } else {
              alert('导入失败: ' + (res.error || '未知错误'));
            }
          })
          .catch(function (e) { alert('请求失败: ' + e.message); });
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
          loadSurgeSettings();
        } catch (e) {
          alert('保存失败: ' + e.message);
        } finally {
          saveCfgBtn.disabled = false;
        }
      };
    }
  }

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

    // 渲染我们注入的 Tab 栏与面板
    var html = renderTabs();
    if (activeTab === 'modules') html += renderModulesView();
    if (activeTab === 'diversion') html += renderDiversionView();
    if (activeTab === 'surge-settings') html += renderSurgeSettingsView();

    container.innerHTML = html;
    setupEvents();

    if (activeTab === 'modules') loadModules();
    if (activeTab === 'diversion') loadDiversion();
    if (activeTab === 'surge-settings') loadSurgeSettings();
  }

  function checkRoute() {
    if (location.hash.includes('proxy-config')) {
      var pcRoot = q('.pc-root');
      if (pcRoot && (!q('#sw-container') || !workbenchInjected)) {
        workbenchInjected = true;
        updateView();
      }
    } else {
      workbenchInjected = false;
    }
  }

  window.addEventListener('hashchange', checkRoute);
  setInterval(checkRoute, 600);
})();
