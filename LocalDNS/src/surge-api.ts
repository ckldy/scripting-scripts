/**
 * src/surge-api.ts
 *
 * LocalDNS × Surge 联动 API 路由处理器
 * 1. 统一调度模块 (/surge/hub.sgmodule)
 * 2. 动态 RULE-SET 分流订阅 (/rules/:group.list)
 * 3. 模块管理接口 (/api/v1/surge/modules/*)
 * 4. 分流组与规则接口 (/api/v1/surge/diversion/*)
 * 5. Surge HTTP API 联动状态与控制 (/api/v1/surge/config, status, outbound, policies, sync)
 * 6. 动态 DNS 解析路径与拓扑数据 (/api/v1/topology/flow)
 */

import { SurgeDatabase, type AppModule, type DiversionGroup, type DiversionRule, type SurgeConfig } from './surge-db';
import { SurgeService } from './surge-service';
import { AuditManager } from './audit';
import { Store } from './store';

function parseJsonBody(req: HttpRequest): any {
  try {
    const raw = req.body.toRawString('utf-8');
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function jsonResponse(data: any, status = 200): HttpResponse {
  const jsonStr = JSON.stringify(data);
  const bodyData = Data.fromRawString(jsonStr, 'utf-8');
  return HttpResponse.raw(status, 'OK', {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
    body: bodyData,
  });
}

function textResponse(
  text: string,
  status = 200,
  contentType = 'text/plain; charset=utf-8',
  extraHeaders?: Record<string, string>
): HttpResponse {
  const bodyData = Data.fromRawString(text, 'utf-8');
  const headers: Record<string, string> = {
    'Content-Type': contentType,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    ...(extraHeaders || {}),
  };
  return HttpResponse.raw(status, 'OK', {
    headers,
    body: bodyData,
  });
}

export async function handleSurgeApiRequest(req: HttpRequest, path: string, method: string): Promise<HttpResponse | null> {
  const db = SurgeDatabase.get();
  const service = SurgeService.get();

  // 1. 统一调度模块端点: /surge/hub.sgmodule 或 /api/v1/surge/hub.sgmodule
  if (path === '/surge/hub.sgmodule' || path === '/api/v1/surge/hub.sgmodule') {
    if (method === 'GET') {
      const moduleContent = await service.compileUnifiedHubModule();
      return textResponse(moduleContent, 200, 'text/plain; charset=utf-8');
    }
  }

  // 1.1 自动生成完整的 Surge 配置文件 (.conf): /surge/localdns.conf, /surge/profile.conf, /api/v1/surge/config.conf
  if (
    path === '/surge/localdns.conf' ||
    path === '/surge/profile.conf' ||
    path === '/api/v1/surge/config.conf' ||
    path === '/api/v1/surge/localdns.conf'
  ) {
    if (method === 'GET') {
      const getParam = (k: string) => req.queryParams?.find((p) => p.key === k)?.value;
      const getHeader = (name: string): string => {
        if (!req.headers) return '';
        const lower = name.toLowerCase();
        for (const [k, v] of Object.entries(req.headers)) {
          if (k.toLowerCase() === lower) return v;
        }
        return '';
      };
      const reqHost = getHeader('host') || '127.0.0.1:9053';
      const host = getParam('host') || reqHost;
      const mode = (getParam('mode') === 'inline' ? 'inline' : 'ruleset') as 'ruleset' | 'inline';
      const apiKey = getParam('api_key') || getParam('key');
      const isDownload = getParam('download') === '1' || getParam('download') === 'true';

      const conf = await service.generateSurgeConfig({
        host,
        mode,
        apiKey,
      });

      const extraHeaders: Record<string, string> = {};
      if (isDownload) {
        extraHeaders['Content-Disposition'] = 'attachment; filename="LocalDNS.conf"';
      }

      return textResponse(conf, 200, 'text/plain; charset=utf-8', extraHeaders);
    }
  }

  // 1.2 在线生成并定制 Surge 配置参数: /api/v1/surge/generate-conf
  if (path === '/api/v1/surge/generate-conf' && method === 'POST') {
    const body = parseJsonBody(req);
    const getHeader = (name: string): string => {
      if (!req.headers) return '';
      const lower = name.toLowerCase();
      for (const [k, v] of Object.entries(req.headers)) {
        if (k.toLowerCase() === lower) return v;
      }
      return '';
    };
    const reqHost = getHeader('host') || '127.0.0.1:9053';
    const host = body.host || reqHost;
    const mode = (body.mode === 'inline' ? 'inline' : 'ruleset') as 'ruleset' | 'inline';
    const apiKey = body.api_key || body.apiKey;

    const conf = await service.generateSurgeConfig({
      host,
      mode,
      apiKey,
      customProxyNode: body.custom_proxy_node,
    });

    const downloadUrl = `/surge/localdns.conf?host=${encodeURIComponent(host)}&mode=${mode}&download=1`;
    const installUrl = `surge:///install-config?url=${encodeURIComponent(`http://${host}/surge/localdns.conf?mode=${mode}`)}`;

    return jsonResponse({
      success: true,
      conf,
      host,
      mode,
      downloadUrl,
      installUrl,
    });
  }

  // 2. 动态分流 RULE-SET 导出: /rules/:group.list 或 /api/v1/rules/:group.list
  if (path.startsWith('/rules/') || path.startsWith('/api/v1/rules/')) {
    let group = path.replace('/api/v1/rules/', '').replace('/rules/', '').trim();
    if (group.endsWith('.list')) group = group.slice(0, -5);
    group = group.split('?')[0];

    if (method === 'GET') {
      const rules = await db.getActiveRulesByGroup(group);
      const lines: string[] = [
        `# LocalDNS 动态分流规则集 [${group}]`,
        `# 规则条数: ${rules.length} · 自动生成时间: ${new Date().toISOString()}`,
        '',
      ];
      for (const r of rules) {
        const comment = r.comment ? ` // ${r.comment}` : '';
        lines.push(`${r.match_type},${r.pattern}${comment}`);
      }
      return textResponse(lines.join('\n'), 200, 'text/plain; charset=utf-8');
    }
  }

  // 3. Surge 模块管理 (/api/v1/surge/modules)
  if (path === '/api/v1/surge/modules' || path === '/api/v1/surge/modules/') {
    if (method === 'GET') {
      const modules = await db.getModules();
      return jsonResponse({ success: true, modules });
    }
    if (method === 'POST') {
      const body = parseJsonBody(req);
      if (!body.content) {
        return jsonResponse({ error: 'Missing module content' }, 400);
      }
      const id = (body.id || `mod_${Date.now()}`).toLowerCase().replace(/[^a-z0-9_-]/g, '_');
      const name = body.name || id;
      const category = body.category || 'app';
      const sourceUrl = body.source_url || null;

      const parsed = await service.importModule(id, name, category, sourceUrl, body.content);
      return jsonResponse({
        success: true,
        id,
        name,
        dnsRulesCount: parsed.dnsRules.length,
        mitmCount: parsed.mitmHosts.length,
        httpRulesCount: parsed.httpRules.length,
      });
    }
  }

  // 3.1 单个模块操作: /api/v1/surge/modules/:id (GET, DELETE)
  // 或 /api/v1/surge/modules/:id/toggle (POST)
  if (path.startsWith('/api/v1/surge/modules/')) {
    const sub = path.replace('/api/v1/surge/modules/', '').trim();
    const parts = sub.split('/');
    const modId = decodeURIComponent(parts[0]);

    if (parts.length === 2 && parts[1] === 'toggle' && method === 'POST') {
      const body = parseJsonBody(req);
      await db.setModuleEnabled(modId, Boolean(body.enabled));
      await service.reloadDnsBlockCache();
      service.scheduleSurgeSync();
      return jsonResponse({ success: true, id: modId, enabled: Boolean(body.enabled) });
    }

    if (parts.length === 1) {
      if (method === 'GET') {
        const mod = await db.getModule(modId);
        if (!mod) return jsonResponse({ error: 'Module not found' }, 404);
        return jsonResponse({ success: true, module: mod });
      }
      if (method === 'PUT') {
        const body = parseJsonBody(req);
        if (!body.content) {
          return jsonResponse({ error: 'Missing content' }, 400);
        }
        const parsed = await service.updateModuleContent(modId, body.name || modId, body.content);
        return jsonResponse({
          success: true,
          id: modId,
          dnsRulesCount: parsed.dnsRules.length,
          mitmCount: parsed.mitmHosts.length,
          httpRulesCount: parsed.httpRules.length,
        });
      }
      if (method === 'DELETE') {
        await db.deleteModule(modId);
        await service.reloadDnsBlockCache();
        service.scheduleSurgeSync();
        return jsonResponse({ success: true, id: modId, deleted: true });
      }
    }
  }

  // 3.2 远程模块导入: /api/v1/surge/modules/import-remote
  if (path === '/api/v1/surge/modules/import-remote' && method === 'POST') {
    const body = parseJsonBody(req);
    if (!body.url) {
      return jsonResponse({ error: 'Missing remote module url' }, 400);
    }
    try {
      const res = await service.importRemoteModule(body.url, body.name, body.category || 'app');
      return jsonResponse({
        success: true,
        module: res.module,
        dnsRulesCount: res.parsed.dnsRules.length,
        mitmCount: res.parsed.mitmHosts.length,
        httpRulesCount: res.parsed.httpRules.length,
      });
    } catch (e: any) {
      return jsonResponse({ error: e?.message || 'Remote module import failed' }, 502);
    }
  }

  // 4. 分流组管理: /api/v1/surge/diversion/groups
  if (path === '/api/v1/surge/diversion/groups' || path === '/api/v1/surge/diversion/groups/') {
    if (method === 'GET') {
      const groups = await db.getDiversionGroups();
      return jsonResponse({ success: true, groups });
    }
    if (method === 'POST') {
      const body = parseJsonBody(req);
      if (!body.id || !body.name || !body.surge_policy) {
        return jsonResponse({ error: 'Missing required group fields (id, name, surge_policy)' }, 400);
      }
      const group: DiversionGroup = {
        id: String(body.id).toLowerCase().trim(),
        name: String(body.name).trim(),
        surge_policy: String(body.surge_policy).trim(),
        enabled: body.enabled !== false,
        priority: Number(body.priority) || 0,
        description: body.description || null,
      };
      await db.saveDiversionGroup(group);
      service.scheduleSurgeSync();
      return jsonResponse({ success: true, group });
    }
  }

  // 4.1 分流组开关与删除: /api/v1/surge/diversion/groups/:id (toggle, delete)
  if (path.startsWith('/api/v1/surge/diversion/groups/')) {
    const sub = path.replace('/api/v1/surge/diversion/groups/', '').trim();
    const parts = sub.split('/');
    const groupId = decodeURIComponent(parts[0]);

    if (parts.length === 2 && parts[1] === 'toggle' && method === 'POST') {
      const body = parseJsonBody(req);
      await db.setDiversionGroupEnabled(groupId, Boolean(body.enabled));
      service.scheduleSurgeSync();
      return jsonResponse({ success: true, id: groupId, enabled: Boolean(body.enabled) });
    }

    if (parts.length === 1 && method === 'DELETE') {
      await db.deleteDiversionGroup(groupId);
      service.scheduleSurgeSync();
      return jsonResponse({ success: true, id: groupId, deleted: true });
    }
  }

  // 4.2 具体分流规则列表与新增: /api/v1/surge/diversion/rules
  if (path === '/api/v1/surge/diversion/rules' || path === '/api/v1/surge/diversion/rules/') {
    const getParam = (k: string) => req.queryParams?.find((p) => p.key === k)?.value;
    const groupId = getParam('group');
    const search = getParam('search') || getParam('q');
    const matchType = getParam('type') || getParam('match_type');
    const paged = getParam('paged') === '1' || getParam('paged') === 'true' || search !== undefined || getParam('limit') !== undefined;

    if (method === 'GET') {
      if (paged) {
        const limit = Number(getParam('limit')) || 50;
        const offset = Number(getParam('offset')) || 0;
        const res = await db.getDiversionRulesPaged({
          groupId: groupId || undefined,
          search: search || undefined,
          matchType: matchType || undefined,
          limit,
          offset,
        });
        return jsonResponse({
          success: true,
          total: res.total,
          limit,
          offset,
          rules: res.rules,
        });
      }

      const rules = await db.getDiversionRules(groupId);
      return jsonResponse({ success: true, count: rules.length, rules });
    }
    if (method === 'POST') {
      const body = parseJsonBody(req);
      if (!body.group_id || !body.pattern) {
        return jsonResponse({ error: 'Missing group_id or pattern' }, 400);
      }
      const rule: DiversionRule = {
        id: body.id ? Number(body.id) : undefined,
        group_id: body.group_id,
        match_type: body.match_type || 'DOMAIN-SUFFIX',
        pattern: String(body.pattern).trim().toLowerCase(),
        enabled: body.enabled !== false,
        comment: body.comment || null,
        is_auto_learned: Boolean(body.is_auto_learned),
      };
      const ruleId = await db.saveDiversionRule(rule);
      service.scheduleSurgeSync();
      return jsonResponse({ success: true, id: ruleId, rule: { ...rule, id: ruleId } });
    }
  }

  // 4.3 具体分流规则开关与删除: /api/v1/surge/diversion/rules/:id (toggle, delete)
  if (path.startsWith('/api/v1/surge/diversion/rules/')) {
    const sub = path.replace('/api/v1/surge/diversion/rules/', '').trim();
    const parts = sub.split('/');
    const ruleId = Number(parts[0]);

    if (parts.length === 2 && parts[1] === 'toggle' && method === 'POST') {
      const body = parseJsonBody(req);
      await db.setDiversionRuleEnabled(ruleId, Boolean(body.enabled));
      service.scheduleSurgeSync();
      return jsonResponse({ success: true, id: ruleId, enabled: Boolean(body.enabled) });
    }

    if (parts.length === 1 && method === 'DELETE') {
      await db.deleteDiversionRule(ruleId);
      service.scheduleSurgeSync();
      return jsonResponse({ success: true, id: ruleId, deleted: true });
    }
  }

  // 4.4 远程规则集导入: /api/v1/surge/diversion/rules/import-remote
  if (path === '/api/v1/surge/diversion/rules/import-remote' && method === 'POST') {
    const body = parseJsonBody(req);
    if (!body.group_id || !body.url) {
      return jsonResponse({ error: 'Missing group_id or url' }, 400);
    }
    try {
      const res = await service.importRemoteRules(body.group_id, body.url, body.mode || 'append');
      return jsonResponse({
        success: true,
        group_id: body.group_id,
        importedCount: res.importedCount,
        finalUrl: res.finalUrl,
      });
    } catch (e: any) {
      return jsonResponse({ error: e?.message || 'Remote rules import failed' }, 502);
    }
  }

  // 4.5 分流组规则多行文本导出与在线全量编辑: /api/v1/surge/diversion/rules/text
  if (path === '/api/v1/surge/diversion/rules/text') {
    const getParam = (k: string) => req.queryParams?.find((p) => p.key === k)?.value;
    const groupId = getParam('group') || '';
    if (method === 'GET') {
      if (!groupId) return jsonResponse({ error: 'Missing group param' }, 400);
      const rules = await db.getDiversionRules(groupId);
      const lines = rules.map((r) => `${r.match_type},${r.pattern}${r.comment ? ` // ${r.comment}` : ''}`);
      return jsonResponse({ success: true, group_id: groupId, count: rules.length, text: lines.join('\n') });
    }
    if (method === 'POST') {
      const body = parseJsonBody(req);
      const targetGroup = body.group_id || groupId;
      if (!targetGroup) return jsonResponse({ error: 'Missing group_id' }, 400);
      const text = typeof body.text === 'string' ? body.text : '';
      const count = await service.updateGroupRulesText(targetGroup, text);
      return jsonResponse({ success: true, group_id: targetGroup, count });
    }
  }

  // 4.6 批量导入与智能清洗 Surge 规则文本: /api/v1/surge/rules/batch-import
  if (path === '/api/v1/surge/rules/batch-import' && method === 'POST') {
    const body = parseJsonBody(req);
    if (!body.content) {
      return jsonResponse({ error: 'Missing content' }, 400);
    }
    try {
      const summary = await service.ingestSurgeRulesBlock(String(body.content), {
        downloadRuleSets: body.downloadRuleSets !== false,
        targetGroupOverride: body.targetGroupOverride || undefined,
      });
      return jsonResponse({ success: true, ...summary });
    } catch (e: any) {
      return jsonResponse({ error: e?.message || 'Batch import failed' }, 500);
    }
  }

  // 5. Surge 联动配置与状态 (/api/v1/surge/config, status, outbound, policies, sync)
  if (path === '/api/v1/surge/config') {
    if (method === 'GET') {
      const config = await db.getSurgeConfig();
      return jsonResponse(config);
    }
    if (method === 'POST') {
      const body = parseJsonBody(req);
      const saved = await db.saveSurgeConfig(body);
      if (saved.enabled) {
        service.scheduleSurgeSync();
      }
      return jsonResponse({ success: true, config: saved });
    }
  }

  if (path === '/api/v1/surge/status' && method === 'GET') {
    const status = await service.getSurgeStatus();
    return jsonResponse(status);
  }

  // 5.1 连通性主动测试: /api/v1/surge/test-connection
  if (path === '/api/v1/surge/test-connection' && method === 'POST') {
    const body = parseJsonBody(req);
    const result = await service.testSurgeConnectivity(body.api_url, body.api_key);
    return jsonResponse(result);
  }

  // 5.2 详细运行状态仪表盘: /api/v1/surge/runtime
  if (path === '/api/v1/surge/runtime' && method === 'GET') {
    const runtime = await service.getSurgeDetailedRuntime();
    return jsonResponse(runtime);
  }

  if (path === '/api/v1/surge/outbound' && method === 'POST') {
    const body = parseJsonBody(req);
    const mode = body.mode;
    if (!['direct', 'rule', 'proxy'].includes(mode)) {
      return jsonResponse({ error: 'Invalid mode' }, 400);
    }
    const ok = await service.setOutboundMode(mode);
    return jsonResponse({ success: ok, mode });
  }

  if (path === '/api/v1/surge/policies' && method === 'GET') {
    const groups = await service.getPolicyGroups();
    return jsonResponse({ success: true, groups });
  }

  if (path === '/api/v1/surge/policy/select' && method === 'POST') {
    const body = parseJsonBody(req);
    if (!body.group_name || !body.policy) {
      return jsonResponse({ error: 'Missing group_name or policy' }, 400);
    }
    const ok = await service.selectPolicy(body.group_name, body.policy);
    return jsonResponse({ success: ok });
  }

  if (path === '/api/v1/surge/sync' && method === 'POST') {
    service.scheduleSurgeSync();
    return jsonResponse({ success: true, message: 'Surge sync scheduled' });
  }

  // 6. 动态 DNS 解析路径与全链路拓扑数据: /api/v1/topology/flow
  if (path === '/api/v1/topology/flow' || path === '/api/v1/topology') {
    if (method === 'GET') {
      const surgeCfg = await db.getSurgeConfig();
      let surgeStatus: any = { online: false, mode: 'rule', activePolicy: 'DIRECT' };
      if (surgeCfg.enabled) {
        const s = await service.getSurgeStatus();
        surgeStatus = { online: s.online, mode: s.outbound || 'rule', activePolicy: 'PROXY' };
      }

      // 从数据库获取活跃模块与分流规则组，构建动态阶段
      const modules = await db.getModules();
      const enabledModules = modules.filter((m) => m.enabled);
      const groups = await db.getDiversionGroups();
      const enabledGroups = groups.filter((g) => g.enabled);

      const recentLinks = await db.getRecentTopologyLinks(20);
      const healedCount = recentLinks.filter((l) => l.is_self_healed).length;

      // 拓扑数据
      return jsonResponse({
        success: true,
        surge: surgeStatus,
        modules: {
          total: modules.length,
          enabled: enabledModules.length,
          items: enabledModules.map((m) => ({ id: m.id, name: m.name, category: m.category })),
        },
        diversion: {
          groups: enabledGroups.map((g) => ({ id: g.id, name: g.name, policy: g.surge_policy })),
        },
        self_healing: {
          active: surgeCfg.auto_learn_unreachable,
          healed_recent_count: healedCount,
        },
        recent_flows: recentLinks.slice(0, 10),
      });
    }
  }

  return null;
}
