/**
 * ZakoProxy 流光毛玻璃控制台前端核心交互系统
 * 作者: vcncv
 * 特性: 模块化单页应用、全功能 REST API 联动、实时指标轮询、Chart.js 双轴时序可视化、自适应深浅色毛玻璃
 */

(function () {
  'use strict';

  // 全局状态
  const state = {
    currentTab: 'dashboard',
    pollTimer: null,
    system: null,
    stats: null,
    accounts: [],
    keys: [],
    groups: [],
    profiles: [],
    logs: {
      items: [],
      page: 1,
      total: 0,
      total_pages: 1,
    },
    settings: null,
    chartInstance: null,
  };

  // ==========================================
  // 工具函数与 API 封装
  // ==========================================
  async function api(path, options = {}) {
    const defaultHeaders = {
      'Content-Type': 'application/json',
    };
    try {
      const res = await fetch(path, {
        ...options,
        headers: {
          ...defaultHeaders,
          ...(options.headers || {}),
        },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error?.message || data.error || `HTTP ${res.status}`);
      }
      return data;
    } catch (err) {
      console.error(`API Error on [${path}]:`, err);
      throw err;
    }
  }

  function formatNumber(num) {
    if (num === undefined || num === null) return '0';
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'k';
    return Number(num).toLocaleString();
  }

  function formatTime(timestamp) {
    if (!timestamp) return '-';
    const date = new Date(timestamp * 1000);
    return date.toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  }

  function formatUptime(seconds) {
    if (!seconds) return '0s';
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (d > 0) return `${d}d ${h}h ${m}m`;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  }

  // Toast 提示
  function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(20px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3200);
  }

  // 复制文本到剪贴板
  async function copyToClipboard(text, successMsg = '已复制到剪贴板') {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        textarea.remove();
      }
      showToast(successMsg, 'success');
    } catch {
      showToast('复制失败，请手动选择复制', 'error');
    }
  }

  // ==========================================
  // 外观与主题系统 (Appearance & Wallpapers)
  // ==========================================
  function initAppearance() {
    const savedTheme = localStorage.getItem('zako_theme') || 'dark-glass';
    const savedWallpaper = localStorage.getItem('zako_wallpaper') || 'cosmos';
    const savedAlpha = localStorage.getItem('zako_glass_alpha') || '0.65';
    const savedBlur = localStorage.getItem('zako_glass_blur') || '24';

    applyTheme(savedTheme);
    applyWallpaper(savedWallpaper);
    applyGlassParams(savedAlpha, savedBlur);

    // 绑定事件
    const themeBtn = document.getElementById('theme-toggle-btn');
    if (themeBtn) {
      themeBtn.addEventListener('click', () => {
        const current = document.documentElement.getAttribute('data-theme') || 'dark-glass';
        const next = current === 'dark-glass' ? 'light-glass' : 'dark-glass';
        applyTheme(next);
      });
    }

    const wallpaperSelect = document.getElementById('setting-wallpaper-select');
    if (wallpaperSelect) {
      wallpaperSelect.value = savedWallpaper;
      wallpaperSelect.addEventListener('change', (e) => {
        applyWallpaper(e.target.value);
      });
    }

    const alphaInput = document.getElementById('setting-alpha-range');
    if (alphaInput) {
      alphaInput.value = savedAlpha;
      alphaInput.addEventListener('input', (e) => {
        applyGlassParams(e.target.value, null);
      });
    }

    const blurInput = document.getElementById('setting-blur-range');
    if (blurInput) {
      blurInput.value = savedBlur;
      blurInput.addEventListener('input', (e) => {
        applyGlassParams(null, e.target.value);
      });
    }
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('zako_theme', theme);
    if (state.chartInstance) {
      renderChart(state.stats); // 重新以新主题色彩渲染图表
    }
  }

  function applyWallpaper(preset) {
    const layer = document.getElementById('wallpaper-layer');
    if (layer) {
      layer.setAttribute('data-preset', preset);
    }
    localStorage.setItem('zako_wallpaper', preset);
  }

  function applyGlassParams(alpha, blur) {
    if (alpha !== null && alpha !== undefined) {
      document.documentElement.style.setProperty('--glass-alpha', alpha);
      localStorage.setItem('zako_glass_alpha', alpha);
      const valDisp = document.getElementById('val-alpha');
      if (valDisp) valDisp.textContent = Math.round(alpha * 100) + '%';
    }
    if (blur !== null && blur !== undefined) {
      document.documentElement.style.setProperty('--glass-blur', `${blur}px`);
      localStorage.setItem('zako_glass_blur', blur);
      const valDisp = document.getElementById('val-blur');
      if (valDisp) valDisp.textContent = `${blur}px`;
    }
  }

  // ==========================================
  // Tab 导航系统
  // ==========================================
  function switchTab(tabId) {
    state.currentTab = tabId;

    // 更新侧边栏高亮
    document.querySelectorAll('.sidebar .nav-link').forEach((link) => {
      const target = link.getAttribute('data-tab');
      if (target === tabId) {
        link.classList.add('active');
      } else {
        link.classList.remove('active');
      }
    });

    // 更新移动端底栏高亮
    document.querySelectorAll('.mobile-tabbar .mobile-tab-btn').forEach((btn) => {
      const target = btn.getAttribute('data-tab');
      if (target === tabId) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    // 切换内容区域容器
    document.querySelectorAll('.tab-pane').forEach((pane) => {
      if (pane.id === `tab-${tabId}`) {
        pane.classList.add('active');
      } else {
        pane.classList.remove('active');
      }
    });

    // 针对特定 Tab 即时加载对应数据
    if (tabId === 'dashboard') loadStats();
    if (tabId === 'accounts') loadAccounts();
    if (tabId === 'keys') loadKeys();
    if (tabId === 'groups') loadGroups();
    if (tabId === 'logs') loadLogs();
    if (tabId === 'settings') loadSettings();
  }

  function initNavigation() {
    document.querySelectorAll('[data-tab]').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        const tab = el.getAttribute('data-tab');
        if (tab) switchTab(tab);
      });
    });

    const refreshBtn = document.getElementById('btn-refresh-global');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => {
        showToast('正在刷新数据...', 'info');
        loadAllData(true);
      });
    }

    // 全局快捷搜索过滤
    const searchInput = document.getElementById('global-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        const kw = e.target.value.toLowerCase().trim();
        handleGlobalSearch(kw);
      });
    }
  }

  function handleGlobalSearch(kw) {
    if (!kw) {
      // 还原所有卡片/行
      document.querySelectorAll('.account-card, .table-row-item').forEach((el) => {
        el.style.display = '';
      });
      return;
    }
    // 过滤账号卡片
    document.querySelectorAll('.account-card').forEach((card) => {
      const text = card.textContent.toLowerCase();
      card.style.display = text.includes(kw) ? '' : 'none';
    });
    // 过滤表格行
    document.querySelectorAll('.table-row-item').forEach((row) => {
      const text = row.textContent.toLowerCase();
      row.style.display = text.includes(kw) ? '' : 'none';
    });
  }

  // ==========================================
  // 数据获取与渲染
  // ==========================================

  // 1. 系统基础信息
  async function loadSystem() {
    try {
      const data = await api('/api/system');
      state.system = data;
      renderSystem(data);
    } catch {}
  }

  function renderSystem(sys) {
    const statusBadge = document.getElementById('server-status-badge');
    const statusText = document.getElementById('server-status-text');
    if (statusBadge && statusText) {
      if (sys.running) {
        statusBadge.className = 'server-pulse-badge';
        statusText.textContent = `端口 :${sys.port} 运行中`;
      } else {
        statusBadge.className = 'server-pulse-badge stopped';
        statusText.textContent = '已停止';
      }
    }

    const uptimeEl = document.getElementById('metric-uptime');
    if (uptimeEl) {
      uptimeEl.textContent = formatUptime(sys.uptime_seconds);
    }

    const versionText = sys.version ? `v${sys.version}` : '';
    const versionEl = document.getElementById('sidebar-app-version');
    if (versionEl && versionText) versionEl.textContent = versionText;
    const brandVersionEl = document.getElementById('brand-app-version');
    if (brandVersionEl && versionText) brandVersionEl.textContent = versionText;
    const aboutVersionEl = document.getElementById('about-app-version');
    if (aboutVersionEl && versionText) aboutVersionEl.textContent = versionText;
    const aboutVersionRow = document.getElementById('about-app-version-row');
    if (aboutVersionRow && versionText) aboutVersionRow.textContent = versionText;
    if (versionText) {
      document.title = `ZakoProxy ${versionText} · 流光毛玻璃控制台`;
    }
    const aboutAuthor = document.getElementById('about-app-author');
    if (aboutAuthor && sys.author) aboutAuthor.textContent = sys.author;
    const aboutStatus = document.getElementById('about-app-status');
    if (aboutStatus) {
      aboutStatus.textContent = sys.running ? '运行中' : '已停止';
      aboutStatus.style.color = sys.running ? 'var(--success)' : 'var(--danger, #ef4444)';
    }
    const aboutPort = document.getElementById('about-app-port');
    if (aboutPort) aboutPort.textContent = `:${sys.port}`;
    const aboutUptime = document.getElementById('about-app-uptime');
    if (aboutUptime) aboutUptime.textContent = formatUptime(sys.uptime_seconds);
    const aboutProfiles = document.getElementById('about-app-profiles');
    if (aboutProfiles) aboutProfiles.textContent = `${sys.profiles_count ?? '-'} 款`;
  }

  // 2. 指标概览与图表渲染
  async function loadStats() {
    try {
      const data = await api('/api/stats');
      state.stats = data;
      renderMetrics(data);
      renderChart(data);
      renderAccountRuntimeRadar(data.accountsRuntime || []);
    } catch {}
  }

  function renderMetrics(stats) {
    const elReq = document.getElementById('metric-requests');
    if (elReq) elReq.textContent = formatNumber(stats.totalRequests);

    const elRate = document.getElementById('metric-success-rate');
    if (elRate) elRate.textContent = `${stats.successRate}%`;

    const elIn = document.getElementById('metric-input-tokens');
    if (elIn) elIn.textContent = formatNumber(stats.inputTokens);

    const elOut = document.getElementById('metric-output-tokens');
    if (elOut) elOut.textContent = formatNumber(stats.outputTokens);

    const elCache = document.getElementById('metric-cached-tokens');
    if (elCache) {
      elCache.textContent = formatNumber(stats.cachedTokens);
      const ratio = stats.inputTokens > 0 ? Math.round((stats.cachedTokens / stats.inputTokens) * 100) : 0;
      const elRatio = document.getElementById('metric-cache-ratio');
      if (elRatio) elRatio.textContent = `缓存命中 ${ratio}%`;
    }

    const elLat = document.getElementById('metric-avg-latency');
    if (elLat) elLat.textContent = `${stats.avgLatency}ms`;

    const elCyber = document.getElementById('metric-cyber-count');
    if (elCyber) elCyber.textContent = formatNumber(stats.cyberCount);
  }

  function renderChart(stats) {
    if (!stats || !stats.hourlyTrend) return;
    const canvas = document.getElementById('trend-chart-canvas');
    if (!canvas || typeof Chart === 'undefined') return;

    const labels = Object.keys(stats.hourlyTrend);
    const reqData = labels.map((h) => stats.hourlyTrend[h].requests);
    const tokenData = labels.map((h) => stats.hourlyTrend[h].tokens);

    const isLight = document.documentElement.getAttribute('data-theme') === 'light-glass';
    const gridColor = isLight ? 'rgba(0, 0, 0, 0.06)' : 'rgba(255, 255, 255, 0.06)';
    const textColor = isLight ? '#64748B' : '#758299';

    if (state.chartInstance) {
      state.chartInstance.destroy();
    }

    state.chartInstance = new Chart(canvas, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: '请求量 (Requests)',
            data: reqData,
            borderColor: '#3B82F6',
            backgroundColor: 'rgba(59, 130, 246, 0.15)',
            borderWidth: 2,
            tension: 0.35,
            fill: true,
            yAxisID: 'y',
          },
          {
            label: 'Tokens 吞吐',
            data: tokenData,
            borderColor: '#8B5CF6',
            backgroundColor: 'transparent',
            borderWidth: 2,
            borderDash: [4, 4],
            tension: 0.35,
            yAxisID: 'y1',
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false,
        },
        plugins: {
          legend: {
            position: 'top',
            labels: {
              color: textColor,
              font: { size: 11, family: 'var(--font-sans)' },
            },
          },
          tooltip: {
            backgroundColor: isLight ? 'rgba(255, 255, 255, 0.95)' : 'rgba(16, 20, 30, 0.95)',
            titleColor: isLight ? '#0F172A' : '#F4F6FC',
            bodyColor: isLight ? '#334155' : '#B0B9C9',
            borderColor: isLight ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.1)',
            borderWidth: 1,
            padding: 10,
            cornerRadius: 8,
          },
        },
        scales: {
          x: {
            grid: { color: gridColor },
            ticks: { color: textColor, font: { size: 10 } },
          },
          y: {
            type: 'linear',
            display: true,
            position: 'left',
            grid: { color: gridColor },
            ticks: { color: textColor, font: { size: 10 } },
          },
          y1: {
            type: 'linear',
            display: true,
            position: 'right',
            grid: { drawOnChartArea: false },
            ticks: { color: textColor, font: { size: 10 } },
          },
        },
      },
    });
  }

  function renderAccountRuntimeRadar(list) {
    const container = document.getElementById('account-radar-list');
    if (!container) return;
    if (list.length === 0) {
      container.innerHTML = `<div style="text-align:center;padding:20px;color:var(--text-3);">暂无已配置的上游账号</div>`;
      return;
    }
    container.innerHTML = list
      .map((acc) => {
        const isCooldown = acc.cooldownRemaining > 0;
        const statusColor = !acc.enabled ? 'var(--text-3)' : isCooldown ? 'var(--warning)' : 'var(--success)';
        const statusText = !acc.enabled ? '已停用' : isCooldown ? `冷却中 (${acc.cooldownRemaining}s)` : '健康就绪';
        return `
          <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-radius:10px;background:rgba(255,255,255,0.03);border:1px solid var(--glass-border);margin-bottom:8px;">
            <div style="display:flex;align-items:center;gap:10px;">
              <span style="width:8px;height:8px;border-radius:50%;background:${statusColor};box-shadow:0 0 8px ${statusColor};"></span>
              <span style="font-weight:600;color:var(--text-1);">${escapeHtml(acc.name)}</span>
            </div>
            <div style="display:flex;align-items:center;gap:16px;font-size:11px;font-family:var(--font-mono);color:var(--text-2);">
              <span>并发: <b>${acc.active}</b></span>
              <span>请求数: <b>${acc.requests}</b></span>
              <span>连续失败: <b style="color:${acc.failures > 0 ? 'var(--danger)' : 'inherit'}">${acc.failures}</b></span>
              <span class="badge ${isCooldown ? 'badge-warning' : 'badge-success'}">${statusText}</span>
            </div>
          </div>
        `;
      })
      .join('');
  }

  // 3. 上游账号工作台
  async function loadAccounts() {
    try {
      const data = await api('/api/accounts');
      state.accounts = data;
      renderAccounts(data);
    } catch (e) {
      showToast(`加载账号失败: ${e.message}`, 'error');
    }
  }

  function renderAccounts(accounts) {
    const grid = document.getElementById('accounts-grid');
    if (!grid) return;
    if (accounts.length === 0) {
      grid.innerHTML = `
        <div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--text-3);">
          尚无上游账号配置，请点击右上角「+ 新增上游账号」开始添加
        </div>
      `;
      return;
    }

    grid.innerHTML = accounts
      .map((acc) => {
        const protocolsBadges = (acc.protocols || [])
          .map((p) => `<span class="badge badge-primary">${escapeHtml(p)}</span>`)
          .join('');
        const modelsCount = (acc.models || []).length;
        const cooldown = acc.runtime?.cooldownRemaining || 0;

        return `
          <div class="account-card" data-acc-id="${acc.id}">
            <div class="account-card-header">
              <div class="account-name-block">
                <span class="account-name">${escapeHtml(acc.name)}</span>
                <span class="account-endpoint">${escapeHtml(acc.endpoint)}</span>
              </div>
              <label class="switch-wrap">
                <input type="checkbox" class="switch-input toggle-acc-enabled" data-id="${acc.id}" ${acc.enabled ? 'checked' : ''} />
                <span class="switch-slider"></span>
              </label>
            </div>

            <div class="account-badges">
              ${protocolsBadges}
              <span class="badge">权重: ${acc.priority}</span>
              <span class="badge">模型: ${modelsCount}款</span>
              ${cooldown > 0 ? `<span class="badge badge-warning">冷却倒计时: ${cooldown}s</span>` : ''}
            </div>

            <div class="account-stats-row">
              <div class="account-stat-col">
                <span class="account-stat-val">${acc.runtime?.active || 0}</span>
                <span class="account-stat-lbl">实时并发</span>
              </div>
              <div class="account-stat-col">
                <span class="account-stat-val">${acc.runtime?.requests || 0}</span>
                <span class="account-stat-lbl">已服务请求</span>
              </div>
              <div class="account-stat-col">
                <span class="account-stat-val" style="color:${(acc.runtime?.failures || 0) > 0 ? 'var(--danger)' : 'inherit'}">${acc.runtime?.failures || 0}</span>
                <span class="account-stat-lbl">连续失败</span>
              </div>
            </div>

            <div class="account-actions">
              <button type="button" class="btn btn-secondary btn-sm test-acc-btn" data-id="${acc.id}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px;"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
                <span>连通性测试</span>
              </button>
              <div class="btn-group">
                <button type="button" class="btn btn-secondary btn-icon-only edit-acc-btn" data-id="${acc.id}" title="编辑">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                </button>
                <button type="button" class="btn btn-danger btn-icon-only del-acc-btn" data-id="${acc.id}" title="删除">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                </button>
              </div>
            </div>
          </div>
        `;
      })
      .join('');

    // 绑定账号操作事件
    grid.querySelectorAll('.toggle-acc-enabled').forEach((chk) => {
      chk.addEventListener('change', async (e) => {
        const id = e.target.getAttribute('data-id');
        const enabled = e.target.checked;
        try {
          await api(`/api/accounts/${id}`, {
            method: 'PUT',
            body: JSON.stringify({ enabled }),
          });
          showToast(`已${enabled ? '启用' : '停用'}账号`, 'success');
        } catch (err) {
          showToast(`更新状态失败: ${err.message}`, 'error');
          e.target.checked = !enabled;
        }
      });
    });

    grid.querySelectorAll('.test-acc-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        btn.disabled = true;
        btn.innerHTML = `<span>测试中...</span>`;
        try {
          const res = await api(`/api/accounts/${id}/test`, { method: 'POST' });
          if (res.success) {
            btn.innerHTML = `<span style="color:var(--success);">可用 (${res.latency_ms}ms)</span>`;
            showToast(`连通性极佳，延迟 ${res.latency_ms}ms`, 'success');
          } else {
            btn.innerHTML = `<span style="color:var(--danger);">失败 (${res.status})</span>`;
            showToast(`上游连通失败: ${res.error || res.status_text || 'HTTP ' + res.status}`, 'error');
          }
        } catch (err) {
          btn.innerHTML = `<span style="color:var(--danger);">错误</span>`;
          showToast(`测试请求异常: ${err.message}`, 'error');
        } finally {
          setTimeout(() => {
            btn.disabled = false;
            btn.innerHTML = `
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px;"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
              <span>连通性测试</span>
            `;
          }, 3500);
        }
      });
    });

    grid.querySelectorAll('.edit-acc-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        const acc = state.accounts.find((a) => a.id === id);
        if (acc) openAccountModal(acc);
      });
    });

    grid.querySelectorAll('.del-acc-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        const acc = state.accounts.find((a) => a.id === id);
        if (!acc) return;
        if (!confirm(`确定要删除上游账号「${acc.name}」吗？此操作无法撤销。`)) return;
        try {
          await api(`/api/accounts/${id}`, { method: 'DELETE' });
          showToast('账号已安全删除', 'success');
          loadAccounts();
        } catch (err) {
          showToast(`删除失败: ${err.message}`, 'error');
        }
      });
    });
  }

  // 账号弹窗交互
  function openAccountModal(acc = null) {
    const modal = document.getElementById('modal-account');
    if (!modal) return;
    const isEdit = Boolean(acc);
    document.getElementById('modal-account-title').textContent = isEdit ? '编辑上游账号' : '新增上游账号';
    document.getElementById('acc-id').value = isEdit ? acc.id : '';
    document.getElementById('acc-name').value = isEdit ? acc.name : '';
    document.getElementById('acc-endpoint').value = isEdit ? acc.endpoint : 'https://api.openai.com/v1';
    document.getElementById('acc-key').value = isEdit && acc.has_api_key ? '••••••••' : '';
    document.getElementById('acc-priority').value = isEdit ? acc.priority : 10;
    document.getElementById('acc-concurrency').value = isEdit ? acc.concurrency : 0;
    document.getElementById('acc-rpm').value = isEdit ? acc.rpm : 0;
    document.getElementById('acc-models').value = isEdit ? (acc.models || []).join(', ') : 'gpt-4o, gpt-4o-mini, claude-3-5-sonnet';
    document.getElementById('acc-proxy').value = isEdit ? acc.proxy_url || '' : '';

    // 协议选择
    const protoChecks = document.querySelectorAll('.acc-proto-check');
    protoChecks.forEach((chk) => {
      if (isEdit) {
        chk.checked = (acc.protocols || []).includes(chk.value);
      } else {
        chk.checked = chk.value === 'chat' || chk.value === 'responses';
      }
    });

    modal.classList.add('active');
  }

  function initAccountModal() {
    const modal = document.getElementById('modal-account');
    if (!modal) return;
    const addBtn = document.getElementById('btn-add-account');
    if (addBtn) {
      addBtn.addEventListener('click', () => openAccountModal());
    }

    const cancelBtn = document.getElementById('btn-cancel-account');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => modal.classList.remove('active'));
    }

    const form = document.getElementById('form-account');
    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = document.getElementById('acc-id').value;
        const name = document.getElementById('acc-name').value.trim();
        const endpoint = document.getElementById('acc-endpoint').value.trim();
        const apiKey = document.getElementById('acc-key').value.trim();
        const priority = parseInt(document.getElementById('acc-priority').value, 10) || 10;
        const concurrency = parseInt(document.getElementById('acc-concurrency').value, 10) || 0;
        const rpm = parseInt(document.getElementById('acc-rpm').value, 10) || 0;
        const proxy_url = document.getElementById('acc-proxy').value.trim() || undefined;
        const models = document
          .getElementById('acc-models')
          .value.split(',')
          .map((m) => m.trim())
          .filter(Boolean);

        const protocols = [];
        document.querySelectorAll('.acc-proto-check:checked').forEach((chk) => protocols.push(chk.value));

        const payload = {
          name,
          endpoint,
          priority,
          concurrency,
          rpm,
          proxy_url,
          models,
          protocols,
        };
        if (apiKey && !apiKey.includes('••••')) {
          payload.api_key = apiKey;
        }

        try {
          if (id) {
            await api(`/api/accounts/${id}`, {
              method: 'PUT',
              body: JSON.stringify(payload),
            });
            showToast('账号更新成功', 'success');
          } else {
            await api('/api/accounts', {
              method: 'POST',
              body: JSON.stringify(payload),
            });
            showToast('上游账号添加成功，已使用 AES-256 加密保护', 'success');
          }
          modal.classList.remove('active');
          loadAccounts();
        } catch (err) {
          showToast(`保存失败: ${err.message}`, 'error');
        }
      });
    }
  }

  // 4. API Keys 工作台
  async function loadKeys() {
    try {
      const data = await api('/api/keys');
      state.keys = data;
      renderKeys(data);
    } catch (e) {
      showToast(`加载密钥失败: ${e.message}`, 'error');
    }
  }

  function renderKeys(keys) {
    const tbody = document.getElementById('keys-table-body');
    if (!tbody) return;
    if (keys.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" style="text-align:center;padding:30px;color:var(--text-3);">
            暂无客户端 API Key，点击右上角「+ 创建新密钥」生成
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = keys
      .map((k) => {
        return `
          <tr class="table-row-item">
            <td style="font-weight:600;color:var(--text-1);">${escapeHtml(k.name)}</td>
            <td><span class="badge badge-primary">${escapeHtml(k.group_name || 'Primary')}</span></td>
            <td><code style="font-family:var(--font-mono);font-size:12px;color:var(--text-2);">${escapeHtml(k.prefix)}</code></td>
            <td>${formatTime(k.created_at)}</td>
            <td>
              <label class="switch-wrap">
                <input type="checkbox" class="switch-input toggle-key-enabled" data-id="${k.id}" ${k.enabled ? 'checked' : ''} />
                <span class="switch-slider"></span>
              </label>
            </td>
            <td>
              <button type="button" class="btn btn-danger btn-sm del-key-btn" data-id="${k.id}">删除</button>
            </td>
          </tr>
        `;
      })
      .join('');

    tbody.querySelectorAll('.toggle-key-enabled').forEach((chk) => {
      chk.addEventListener('change', async (e) => {
        const id = e.target.getAttribute('data-id');
        const enabled = e.target.checked;
        try {
          await api(`/api/keys/${id}`, {
            method: 'PATCH',
            body: JSON.stringify({ enabled }),
          });
          showToast(`已${enabled ? '启用' : '禁用'}密钥`, 'success');
        } catch (err) {
          showToast(`更新失败: ${err.message}`, 'error');
          e.target.checked = !enabled;
        }
      });
    });

    tbody.querySelectorAll('.del-key-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        const key = state.keys.find((k) => k.id === id);
        if (!key) return;
        if (!confirm(`确定删除 API Key「${key.name}」吗？使用该 Key 的客户端将无法调用。`)) return;
        try {
          await api(`/api/keys/${id}`, { method: 'DELETE' });
          showToast('密钥已安全删除', 'success');
          loadKeys();
        } catch (err) {
          showToast(`删除失败: ${err.message}`, 'error');
        }
      });
    });
  }

  function initKeyModal() {
    const modalCreate = document.getElementById('modal-create-key');
    const modalSecret = document.getElementById('modal-key-secret');
    const addBtn = document.getElementById('btn-add-key');

    if (addBtn) {
      addBtn.addEventListener('click', () => {
        document.getElementById('new-key-name').value = '';
        modalCreate.classList.add('active');
      });
    }

    const cancelBtn = document.getElementById('btn-cancel-key');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => modalCreate.classList.remove('active'));
    }

    const form = document.getElementById('form-create-key');
    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('new-key-name').value.trim();
        if (!name) return;
        try {
          const res = await api('/api/keys', {
            method: 'POST',
            body: JSON.stringify({ name }),
          });
          modalCreate.classList.remove('active');
          loadKeys();

          // 弹出一级重要复制弹窗展示完整原始 Secret
          if (res.raw_key) {
            document.getElementById('secret-key-display').value = res.raw_key;
            modalSecret.classList.add('active');
          }
        } catch (err) {
          showToast(`创建密钥失败: ${err.message}`, 'error');
        }
      });
    }

    const copySecretBtn = document.getElementById('btn-copy-secret-key');
    if (copySecretBtn) {
      copySecretBtn.addEventListener('click', () => {
        const val = document.getElementById('secret-key-display').value;
        copyToClipboard(val, '已复制 API Key 到剪贴板，请妥善保存！');
      });
    }

    const closeSecretBtn = document.getElementById('btn-close-secret-modal');
    if (closeSecretBtn) {
      closeSecretBtn.addEventListener('click', () => modalSecret.classList.remove('active'));
    }
  }

  // 5. 分组与策略库工作台
  async function loadGroups() {
    try {
      const [groups, profiles] = await Promise.all([api('/api/groups'), api('/api/profiles')]);
      state.groups = groups;
      state.profiles = profiles;
      renderGroups(groups, profiles);
      renderProfilesCatalog(profiles);
    } catch (e) {
      showToast(`加载策略库失败: ${e.message}`, 'error');
    }
  }

  function renderGroups(groups, profiles) {
    const container = document.getElementById('groups-list-container');
    if (!container) return;
    const profileMap = new Map(profiles.map((p) => [p.id, p]));

    if (!groups || groups.length === 0) {
      container.innerHTML = `
        <div class="glass-card" style="text-align:center;padding:36px;color:var(--text-3);">
          <div style="font-size:32px;margin-bottom:8px;">📦</div>
          <div style="font-size:14px;color:var(--text-2);margin-bottom:12px;">暂无任何分组</div>
          <button type="button" class="btn btn-primary btn-sm" onclick="window.openAddGroupModal()">立即新建第一个分组</button>
        </div>
      `;
      return;
    }

    container.innerHTML = groups
      .map((g) => {
        const boundProfiles = (g.profile_ids || [])
          .map((pid) => {
            const p = profileMap.get(pid);
            return p
              ? `<span class="badge badge-cyber" style="cursor:pointer;" onclick="window.viewProfileDetail('${p.id}')" title="点击查看策略提示词详情">${escapeHtml(p.name)} (${escapeHtml(p.model_family)})</span>`
              : `<span class="badge badge-cyber" style="opacity:0.6;">${escapeHtml(pid)}</span>`;
          })
          .join('');

        const hasCustomPrompt = typeof g.custom_instruction === 'string' && g.custom_instruction.trim().length > 0;
        const customPromptSnippet = hasCustomPrompt
          ? g.custom_instruction.trim().slice(0, 100) + (g.custom_instruction.trim().length > 100 ? '...' : '')
          : '';

        return `
          <div class="glass-card" style="margin-bottom:16px;">
            <div class="glass-card-header" style="flex-wrap:wrap;gap:8px;">
              <div class="glass-card-title">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                <span>${escapeHtml(g.name)}</span>
                <span style="font-family:var(--font-mono);font-size:11px;color:var(--text-3);margin-left:4px;">ID: ${escapeHtml(g.id)}</span>
              </div>
              <div style="display:flex;align-items:center;gap:8px;">
                <button type="button" class="btn btn-secondary btn-sm" onclick="window.openEditGroupModal('${g.id}')">✏️ 编辑与策略绑定</button>
                <button type="button" class="btn btn-danger btn-sm" onclick="window.deleteGroup('${g.id}', '${escapeHtml(g.name)}')">🗑️ 删除</button>
              </div>
            </div>

            <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(240px, 1fr));gap:12px;margin-bottom:12px;padding:10px;background:rgba(0,0,0,0.15);border-radius:8px;">
              <div>
                <span style="font-size:11px;color:var(--text-3);">通用兜底策略 (Astra)：</span>
                <span class="badge ${g.default_strategy_enabled ? 'badge-success' : 'badge-warning'}" style="margin-left:6px;">
                  ${g.default_strategy_enabled ? '已开启' : '已关闭'}
                </span>
              </div>
              <div>
                <span style="font-size:11px;color:var(--text-3);">自定义专属指令：</span>
                <span class="badge ${hasCustomPrompt ? 'badge-primary' : 'badge-cyber'}" style="margin-left:6px;">
                  ${hasCustomPrompt ? `已配置 (${g.custom_instruction.length} 字符)` : '未配置 (使用预设)'}
                </span>
              </div>
              <div>
                <span style="font-size:11px;color:var(--text-3);">已绑定内置预设：</span>
                <span style="font-size:12px;font-weight:600;color:var(--text-1);margin-left:6px;">
                  ${(g.profile_ids || []).length} / 36 款
                </span>
              </div>
            </div>

            ${hasCustomPrompt ? `
              <div style="margin-bottom:12px;">
                <div style="font-size:11px;color:var(--text-3);margin-bottom:4px;">优先注入的自定义提示词片段：</div>
                <div style="font-size:11px;font-family:var(--font-mono);color:var(--text-2);background:rgba(0,0,0,0.25);padding:8px 10px;border-radius:6px;line-height:1.4;white-space:pre-wrap;">${escapeHtml(customPromptSnippet)}</div>
              </div>
            ` : ''}

            <div>
              <div style="font-size:12px;color:var(--text-2);margin-bottom:8px;">绑定的专有 Prompt 策略：</div>
              <div style="display:flex;flex-wrap:wrap;gap:8px;">
                ${boundProfiles || '<span style="color:var(--text-3);font-size:11px;">未绑定独立策略（将根据全局兜底开关决定是否注入通用任务提示词）</span>'}
              </div>
            </div>
          </div>
        `;
      })
      .join('');
  }

  function renderProfilesCatalog(profiles) {
    const container = document.getElementById('profiles-catalog-grid');
    if (!container) return;

    // 按家族归类展示
    container.innerHTML = profiles
      .map((p) => {
        const modelsPill = (p.models || []).slice(0, 3).join(', ');
        const moreModels = p.models?.length > 3 ? ` +${p.models.length - 3}` : '';
        return `
          <div class="glass-card" style="padding:14px;cursor:pointer;display:flex;flex-direction:column;gap:8px;" onclick="window.viewProfileDetail('${p.id}')">
            <div style="display:flex;align-items:center;justify-content:space-between;">
              <span style="font-weight:600;font-size:13px;color:var(--text-1);">${escapeHtml(p.name)}</span>
              <span class="badge badge-cyber">${escapeHtml(p.model_family)}</span>
            </div>
            <div style="font-size:11px;font-family:var(--font-mono);color:var(--text-3);">
              适配模型: ${escapeHtml(modelsPill + moreModels)}
            </div>
            <div style="font-size:11px;color:var(--text-2);line-height:1.4;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;">
              ${escapeHtml(p.instruction_snippet)}
            </div>
          </div>
        `;
      })
      .join('');
  }

  // 渲染编辑分组时的 Profile 勾选列表
  function renderProfilesSelector(selectedProfileIds = []) {
    const selector = document.getElementById('group-profiles-selector');
    if (!selector) return;
    const selectedSet = new Set(selectedProfileIds);

    const profiles = state.profiles || [];
    selector.innerHTML = profiles
      .map((p) => {
        const isChecked = selectedSet.has(p.id) ? 'checked' : '';
        return `
          <label style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--text-1);cursor:pointer;padding:4px 6px;border-radius:4px;background:rgba(255,255,255,0.03);user-select:none;">
            <input type="checkbox" name="profile_id" value="${escapeHtml(p.id)}" ${isChecked} style="accent-color:var(--primary);width:14px;height:14px;" />
            <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</span>
          </label>
        `;
      })
      .join('');
  }

  // 打开新建分组弹窗
  window.openAddGroupModal = function () {
    const modal = document.getElementById('modal-group');
    if (!modal) return;
    document.getElementById('group-modal-title').textContent = '新建分组与 Prompt 策略';
    document.getElementById('group-id').value = '';
    document.getElementById('group-name').value = `分组 ${(state.groups?.length || 0) + 1}`;
    document.getElementById('group-default-strategy').checked = true;
    document.getElementById('group-custom-instruction').value = '';
    renderProfilesSelector([]);
    modal.classList.add('active');
  };

  // 打开编辑分组弹窗
  window.openEditGroupModal = function (groupId) {
    const g = (state.groups || []).find((item) => item.id === groupId);
    if (!g) return;
    const modal = document.getElementById('modal-group');
    if (!modal) return;
    document.getElementById('group-modal-title').textContent = `编辑分组「${g.name}」与策略`;
    document.getElementById('group-id').value = g.id;
    document.getElementById('group-name').value = g.name || '';
    document.getElementById('group-default-strategy').checked = g.default_strategy_enabled !== false;
    document.getElementById('group-custom-instruction').value = g.custom_instruction || '';
    renderProfilesSelector(g.profile_ids || []);
    modal.classList.add('active');
  };

  // 删除分组
  window.deleteGroup = async function (groupId, groupName) {
    if (!confirm(`确定要删除分组「${groupName}」吗？`)) return;
    try {
      await api(`/api/groups/${groupId}`, { method: 'DELETE' });
      showToast('分组已成功删除', 'success');
      await loadGroups();
    } catch (e) {
      showToast(`删除分组失败: ${e.message}`, 'error');
    }
  };

  function initGroupModal() {
    const modal = document.getElementById('modal-group');
    const form = document.getElementById('form-group');
    const closeBtn = document.getElementById('btn-close-group-modal');
    const cancelBtn = document.getElementById('btn-cancel-group');
    const addGroupBtn = document.getElementById('btn-add-group');
    const selectAllBtn = document.getElementById('btn-select-all-profiles');
    const clearAllBtn = document.getElementById('btn-clear-all-profiles');

    const closeModal = () => modal?.classList.remove('active');
    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (cancelBtn) cancelBtn.addEventListener('click', closeModal);
    if (addGroupBtn) addGroupBtn.addEventListener('click', () => window.openAddGroupModal());

    if (selectAllBtn) {
      selectAllBtn.addEventListener('click', () => {
        const cbs = modal.querySelectorAll('input[name="profile_id"]');
        cbs.forEach((cb) => (cb.checked = true));
      });
    }

    if (clearAllBtn) {
      clearAllBtn.addEventListener('click', () => {
        const cbs = modal.querySelectorAll('input[name="profile_id"]');
        cbs.forEach((cb) => (cb.checked = false));
      });
    }

    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = document.getElementById('group-id')?.value;
        const name = document.getElementById('group-name')?.value.trim();
        const defaultStrategy = document.getElementById('group-default-strategy')?.checked ?? true;
        const customInstruction = document.getElementById('group-custom-instruction')?.value.trim();

        if (!name) {
          showToast('分组名称不能为空', 'warning');
          return;
        }

        const selectedProfileIds = Array.from(modal.querySelectorAll('input[name="profile_id"]:checked')).map(
          (cb) => cb.value
        );

        const payload = {
          name,
          default_strategy_enabled: defaultStrategy,
          custom_instruction: customInstruction,
          profile_ids: selectedProfileIds,
        };

        try {
          if (id) {
            await api(`/api/groups/${id}`, {
              method: 'PUT',
              body: JSON.stringify(payload),
            });
            showToast('分组及 Prompt 策略已更新', 'success');
          } else {
            await api('/api/groups', {
              method: 'POST',
              body: JSON.stringify(payload),
            });
            showToast('新分组创建成功', 'success');
          }
          closeModal();
          await loadGroups();
        } catch (err) {
          showToast(`保存分组失败: ${err.message}`, 'error');
        }
      });
    }
  }

  // 查看策略详情
  window.viewProfileDetail = async function (profileId) {
    const modal = document.getElementById('modal-profile-detail');
    if (!modal) return;
    const titleEl = document.getElementById('profile-detail-title');
    const modelsEl = document.getElementById('profile-detail-models');
    const promptEl = document.getElementById('profile-detail-prompt');

    titleEl.textContent = `策略加载中... (${profileId})`;
    modelsEl.textContent = '...';
    promptEl.value = '正在从后端拉取完整提示词正文...';
    modal.classList.add('active');

    try {
      const p = await api(`/api/profiles/${profileId}`);
      titleEl.textContent = `${p.name} (${p.model_family})`;
      modelsEl.textContent = (p.models || []).join('\n');
      promptEl.value = p.instruction || p.instruction_snippet || '(空)';
    } catch (e) {
      const cached = state.profiles?.find((item) => item.id === profileId);
      if (cached) {
        titleEl.textContent = `${cached.name} (${cached.model_family})`;
        modelsEl.textContent = (cached.models || []).join('\n');
        promptEl.value = cached.instruction_snippet || '(拉取失败)';
      } else {
        promptEl.value = `拉取策略详情失败: ${e.message}`;
      }
    }
  };

  function initProfileDetailModal() {
    const modal = document.getElementById('modal-profile-detail');
    const closeBtn = document.getElementById('btn-close-profile-modal');
    if (closeBtn && modal) {
      closeBtn.addEventListener('click', () => modal.classList.remove('active'));
    }
  }

  // 6. 审计日志中心
  async function loadLogs(page = 1) {
    const filterModel = document.getElementById('log-filter-model')?.value || '';
    const filterStatus = document.getElementById('log-filter-status')?.value || '';
    const filterCyber = document.getElementById('log-filter-cyber')?.value || '';
    const filterProtocol = document.getElementById('log-filter-proto')?.value || '';

    let url = `/api/logs?page=${page}&size=20`;
    if (filterModel) url += `&model=${encodeURIComponent(filterModel)}`;
    if (filterStatus) url += `&status=${filterStatus}`;
    if (filterCyber) url += `&cyber=${filterCyber}`;
    if (filterProtocol) url += `&protocol=${encodeURIComponent(filterProtocol)}`;

    try {
      const data = await api(url);
      state.logs = data;
      renderLogs(data);
    } catch (e) {
      showToast(`加载日志失败: ${e.message}`, 'error');
    }
  }

  function renderLogs(logsData) {
    const tbody = document.getElementById('logs-table-body');
    const pageEl = document.getElementById('logs-current-page');
    const totalEl = document.getElementById('logs-total-records');
    if (pageEl) pageEl.textContent = `第 ${logsData.page} / ${logsData.total_pages} 页`;
    if (totalEl) totalEl.textContent = `共 ${logsData.total} 条`;

    if (!tbody) return;
    if (logsData.items.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="8" style="text-align:center;padding:40px;color:var(--text-3);">
            暂无匹配的审计请求记录
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = logsData.items
      .map((l) => {
        const is2xx = l.status >= 200 && l.status < 300;
        const is4xx = l.status >= 400 && l.status < 500;
        const statusClass = is2xx ? 'status-2xx' : is4xx ? 'status-4xx' : 'status-5xx';
        const totalTok = (l.usage?.input_tokens || 0) + (l.usage?.output_tokens || 0);

        let stratBadge = '<span style="color:var(--text-3);font-size:11px;">无策略</span>';
        if (l.strategy_type === 'custom') {
          stratBadge = '<span class="badge" style="background:rgba(168,85,247,0.15);color:#c084fc;border:1px solid rgba(168,85,247,0.3);">✨ 自定义</span>';
        } else if (l.strategy_type === 'profile') {
          stratBadge = `<span class="badge" style="background:rgba(59,130,246,0.15);color:#60a5fa;border:1px solid rgba(59,130,246,0.3);" title="${escapeHtml(l.profile_name || '')}">🎯 ${escapeHtml(l.profile_name || '预设')}</span>`;
        } else if (l.strategy_type === 'default') {
          stratBadge = '<span class="badge" style="background:rgba(234,179,8,0.15);color:#facc15;border:1px solid rgba(234,179,8,0.3);">🛡️ Astra兜底</span>';
        }

        return `
          <tr class="table-row-item" style="cursor:pointer;" onclick="window.viewLogDetail('${l.id}')">
            <td>${formatTime(l.timestamp)}</td>
            <td><code style="font-family:var(--font-mono);font-size:12px;font-weight:600;color:var(--text-1);">${escapeHtml(l.model)}</code></td>
            <td>${stratBadge}</td>
            <td><span class="badge badge-primary">${escapeHtml(l.protocol)}</span></td>
            <td><span class="status-tag ${statusClass}">${l.status}</span></td>
            <td style="font-family:var(--font-mono);">${l.latency_ms}ms</td>
            <td style="font-family:var(--font-mono);">${formatNumber(totalTok)}</td>
            <td>
              ${l.cyber ? '<span class="badge badge-cyber">Cyber 特征</span>' : '<span style="color:var(--text-3);font-size:11px;">-</span>'}
            </td>
          </tr>
        `;
      })
      .join('');
  }

  window.viewLogDetail = function (logId) {
    const item = (state.logs.items || []).find((l) => l.id === logId);
    if (!item) return;
    const modal = document.getElementById('modal-log-detail');
    if (!modal) return;

    document.getElementById('log-detail-model').textContent = `${item.model} (${item.protocol})`;
    document.getElementById('log-detail-time').textContent = formatTime(item.timestamp);
    document.getElementById('log-detail-path').textContent = item.request_path;
    document.getElementById('log-detail-status').textContent = `HTTP ${item.status}`;
    document.getElementById('log-detail-latency').textContent = `${item.latency_ms} ms`;
    document.getElementById('log-detail-tokens-in').textContent = formatNumber(item.usage?.input_tokens || 0);
    document.getElementById('log-detail-tokens-out').textContent = formatNumber(item.usage?.output_tokens || 0);
    document.getElementById('log-detail-tokens-cache').textContent = formatNumber(item.usage?.cached_tokens || 0);
    document.getElementById('log-detail-error').textContent = item.error || '无错误';

    let stratText = '<span style="color:var(--text-3);">无注入策略</span>';
    if (item.strategy_type === 'custom') {
      stratText = '<span style="color:#c084fc;">✨ 自定义分组 Prompt 策略</span>';
    } else if (item.strategy_type === 'profile') {
      stratText = `<span style="color:#60a5fa;">🎯 专有预设: <strong>${escapeHtml(item.profile_name || item.profile_id)}</strong></span>` +
        (item.matched_model ? ` <span style="color:var(--text-3);font-size:12px;">(匹配特征: <code>${escapeHtml(item.matched_model)}</code>)</span>` : '');
    } else if (item.strategy_type === 'default') {
      stratText = '<span style="color:#facc15;">🛡️ Astra 通用自适应执行策略 (默认保底)</span>';
    }
    const stratEl = document.getElementById('log-detail-strategy');
    if (stratEl) stratEl.innerHTML = stratText;

    modal.classList.add('active');
  };

  function initLogsControls() {
    const prevBtn = document.getElementById('btn-logs-prev');
    const nextBtn = document.getElementById('btn-logs-next');
    if (prevBtn) {
      prevBtn.addEventListener('click', () => {
        if (state.logs.page > 1) {
          loadLogs(state.logs.page - 1);
        }
      });
    }
    if (nextBtn) {
      nextBtn.addEventListener('click', () => {
        if (state.logs.page < state.logs.total_pages) {
          loadLogs(state.logs.page + 1);
        }
      });
    }

    const clearBtn = document.getElementById('btn-clear-logs');
    if (clearBtn) {
      clearBtn.addEventListener('click', async () => {
        if (!confirm('确定清空所有请求日志吗？此操作无法撤销。')) return;
        try {
          const res = await api('/api/logs', { method: 'DELETE' });
          showToast(`已成功清空 ${res.count} 条日志`, 'success');
          loadLogs(1);
          loadStats();
        } catch (err) {
          showToast(`清空失败: ${err.message}`, 'error');
        }
      });
    }

    // 筛选变动自动重新加载
    ['log-filter-model', 'log-filter-status', 'log-filter-cyber', 'log-filter-proto'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('change', () => loadLogs(1));
        if (el.tagName === 'INPUT') {
          el.addEventListener('keyup', (e) => {
            if (e.key === 'Enter') loadLogs(1);
          });
        }
      }
    });

    const closeBtn = document.getElementById('btn-close-log-modal');
    const modal = document.getElementById('modal-log-detail');
    if (closeBtn && modal) {
      closeBtn.addEventListener('click', () => modal.classList.remove('active'));
    }
  }

  // 7. 系统与网络设置
  async function loadSettings() {
    try {
      const data = await api('/api/settings');
      state.settings = data;
      renderSettings(data);
    } catch (e) {
      showToast(`加载设置失败: ${e.message}`, 'error');
    }
  }

  function renderSettings(s) {
    if (!s) return;
    document.getElementById('setting-max-retries').value = s.max_retries ?? 2;
    document.getElementById('setting-failure-threshold').value = s.failure_threshold ?? 2;
    document.getElementById('setting-cooldown').value = s.cooldown_seconds ?? 60;
    document.getElementById('setting-timeout').value = s.request_timeout_seconds ?? 120;
    document.getElementById('setting-retention').value = s.retention_days ?? 7;
    document.getElementById('setting-port').value = s.port ?? 1990;
  }

  async function restartServer() {
    const btnSidebar = document.getElementById('btn-restart-server-sidebar');
    const btnSettings = document.getElementById('btn-restart-server-settings');
    if (btnSidebar) btnSidebar.disabled = true;
    if (btnSettings) btnSettings.disabled = true;
    showToast('正在触发 ZakoProxy 代理服务热重启...', 'info');

    try {
      const res = await api('/api/system/restart', { method: 'POST' });
      showToast(`热重启指令已发送，监听端口: ${res.target_port || 1990}`, 'success');
      setTimeout(async () => {
        try {
          await loadSystem();
          showToast(`服务已就绪 (v${state.system?.version || '1.4.0'})`, 'success');
        } catch {
          showToast('服务重启中，请稍候刷新页面...', 'warning');
        } finally {
          if (btnSidebar) btnSidebar.disabled = false;
          if (btnSettings) btnSettings.disabled = false;
        }
      }, 1500);
    } catch (err) {
      showToast(`热重启服务失败: ${err.message}`, 'error');
      if (btnSidebar) btnSidebar.disabled = false;
      if (btnSettings) btnSettings.disabled = false;
    }
  }

  function initSettingsControls() {
    const btnRestartSidebar = document.getElementById('btn-restart-server-sidebar');
    if (btnRestartSidebar) {
      btnRestartSidebar.addEventListener('click', restartServer);
    }
    const btnRestartSettings = document.getElementById('btn-restart-server-settings');
    if (btnRestartSettings) {
      btnRestartSettings.addEventListener('click', restartServer);
    }
    const form = document.getElementById('form-settings');
    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const payload = {
          max_retries: parseInt(document.getElementById('setting-max-retries').value, 10),
          failure_threshold: parseInt(document.getElementById('setting-failure-threshold').value, 10),
          cooldown_seconds: parseInt(document.getElementById('setting-cooldown').value, 10),
          request_timeout_seconds: parseInt(document.getElementById('setting-timeout').value, 10),
          retention_days: parseInt(document.getElementById('setting-retention').value, 10),
          port: parseInt(document.getElementById('setting-port').value, 10),
        };
        try {
          await api('/api/settings', {
            method: 'PUT',
            body: JSON.stringify(payload),
          });
          showToast('系统参数已成功保存并立即生效！', 'success');
        } catch (err) {
          showToast(`保存设置失败: ${err.message}`, 'error');
        }
      });
    }
  }

  // ==========================================
  // 全局数据加载与初始化
  // ==========================================
  async function loadAllData(silent = false) {
    try {
      await Promise.all([loadSystem(), loadStats()]);
      if (state.currentTab === 'accounts') await loadAccounts();
      if (state.currentTab === 'keys') await loadKeys();
      if (state.currentTab === 'groups') await loadGroups();
      if (state.currentTab === 'logs') await loadLogs(state.logs.page);
      if (state.currentTab === 'settings') await loadSettings();
      if (!silent) showToast('数据已更新', 'success');
    } catch {}
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // DOM 准备完毕启动
  document.addEventListener('DOMContentLoaded', () => {
    initAppearance();
    initNavigation();
    initAccountModal();
    initKeyModal();
    initGroupModal();
    initProfileDetailModal();
    initLogsControls();
    initSettingsControls();

    // 首次加载
    loadAllData(true);

    // 启动 3 秒实时脉冲轮询
    state.pollTimer = setInterval(() => {
      loadSystem();
      if (state.currentTab === 'dashboard') {
        loadStats();
      }
    }, 3000);
  });
})();
