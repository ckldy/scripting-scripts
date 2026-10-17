// Unified Module Parser for Surge (.sgmodule), Loon (.plugin), and Quantumult X (.conf)
import type {
  CleanModule,
  CleanRewriteRule,
  CleanScriptRule,
  ModulePlatform,
  RewriteAction,
} from './types';

export class ModuleParser {
  /**
   * 智能解析任意格式的模块/插件配置
   */
  static parse(content: string, hintId?: string, hintUrl?: string): CleanModule {
    const platform = this.detectPlatform(content);
    const id = hintId || `mod_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    switch (platform) {
      case 'quantumultx':
        return this.parseQuantumultX(content, id, hintUrl);
      case 'loon':
        return this.parseLoon(content, id, hintUrl);
      case 'surge':
      default:
        return this.parseSurge(content, id, hintUrl);
    }
  }

  /**
   * 自动探测配置文本来源平台
   */
  static detectPlatform(content: string): ModulePlatform {
    const lower = content.toLowerCase();
    if (
      lower.includes('[rewrite_local]') ||
      lower.includes('[rewrite_remote]') ||
      (lower.includes('[mitm]') && lower.includes('url script-response-body')) ||
      lower.includes('url reject-')
    ) {
      return 'quantumultx';
    }
    if (
      lower.includes('[plugin]') ||
      lower.includes('http-response ^') ||
      lower.includes('http-request ^') ||
      (content.includes('#!name=') && lower.includes('[rewrite]'))
    ) {
      return 'loon';
    }
    return 'surge';
  }

  /**
   * 1. 解析 Surge 模块规范 (.sgmodule)
   */
  private static parseSurge(content: string, id: string, url?: string): CleanModule {
    const lines = content.split(/\r?\n/);
    let name = 'Surge 模块';
    let description = '';
    const mitmHosts = new Set<string>();
    const rewrites: CleanRewriteRule[] = [];
    const scripts: CleanScriptRule[] = [];
    let currentSection = '';

    for (let rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      // 解析元数据
      if (line.startsWith('#!name=')) {
        name = line.substring(7).trim();
        continue;
      }
      if (line.startsWith('#!desc=')) {
        description = line.substring(7).trim();
        continue;
      }

      // 注释行跳过
      if (line.startsWith('#') || line.startsWith(';') || line.startsWith('//')) {
        continue;
      }

      // 匹配节区 [SECTION]
      if (line.startsWith('[') && line.endsWith(']')) {
        currentSection = line.substring(1, line.length - 1).trim().toUpperCase();
        continue;
      }

      // 解析 [MITM]
      if (currentSection === 'MITM') {
        if (line.toLowerCase().startsWith('hostname')) {
          const eqIdx = line.indexOf('=');
          if (eqIdx !== -1) {
            const val = line.substring(eqIdx + 1).replace(/%APPEND%/g, '').trim();
            for (const h of val.split(',')) {
              const clean = h.trim();
              if (clean) mitmHosts.add(clean);
            }
          }
        }
        continue;
      }

      // 解析 [URL REWRITE]
      if (currentSection === 'URL REWRITE') {
        const parts = line.split(/\s+/);
        if (parts.length >= 2) {
          const patternStr = parts[0];
          const actionStr = parts[1].toLowerCase();
          const targetStr = parts.slice(2).join(' ') || undefined;

          const action = this.normalizeAction(actionStr);
          if (action) {
            try {
              rewrites.push({
                id: `rw_${rewrites.length + 1}`,
                pattern: patternStr,
                regex: new RegExp(patternStr),
                action,
                target: targetStr,
              });
            } catch {
              // 正则表达式非法则忽略
            }
          }
        }
        continue;
      }

      // 解析 [SCRIPT]
      if (currentSection === 'SCRIPT') {
        const eqIdx = line.indexOf('=');
        if (eqIdx !== -1) {
          const scriptName = line.substring(0, eqIdx).trim();
          const paramStr = line.substring(eqIdx + 1).trim();
          const props = this.parseCommaKeyValues(paramStr);

          const scriptType = props['type'] === 'http-request' ? 'http-request' : 'http-response';
          const patternStr = props['pattern'] || '';
          const scriptPath = props['script-path'] || '';
          const requiresBody = props['requires-body'] === '1' || props['requires-body'] === 'true';
          const binaryBody = props['binary-body-mode'] === '1' || props['binary-body-mode'] === 'true';
          const timeout = parseInt(props['timeout'] || '5', 10) || 5;

          if (patternStr && scriptPath) {
            try {
              scripts.push({
                id: `scr_${scripts.length + 1}`,
                name: scriptName,
                type: scriptType,
                pattern: patternStr,
                regex: new RegExp(patternStr),
                scriptPath,
                requiresBody,
                binaryBody,
                timeout,
              });
            } catch {
              // 忽略无效正则
            }
          }
        }
        continue;
      }
    }

    return {
      id,
      name,
      description,
      platform: 'surge',
      enabled: true,
      url,
      autoUpdate: !!url,
      updateIntervalHours: 24,
      lastUpdated: new Date().toISOString(),
      lastError: null,
      mitmHosts: Array.from(mitmHosts),
      rewrites,
      scripts,
      rawSource: content,
    };
  }

  /**
   * 2. 解析 Loon 插件规范 (.plugin)
   */
  private static parseLoon(content: string, id: string, url?: string): CleanModule {
    const lines = content.split(/\r?\n/);
    let name = 'Loon 插件';
    let description = '';
    const mitmHosts = new Set<string>();
    const rewrites: CleanRewriteRule[] = [];
    const scripts: CleanScriptRule[] = [];
    let currentSection = '';

    for (let rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      if (line.startsWith('#!name=')) {
        name = line.substring(7).trim();
        continue;
      }
      if (line.startsWith('#!desc=')) {
        description = line.substring(7).trim();
        continue;
      }
      if (line.startsWith('#') || line.startsWith(';') || line.startsWith('//')) {
        continue;
      }

      if (line.startsWith('[') && line.endsWith(']')) {
        currentSection = line.substring(1, line.length - 1).trim().toUpperCase();
        continue;
      }

      // [MITM]
      if (currentSection === 'MITM') {
        if (line.toLowerCase().startsWith('hostname')) {
          const eqIdx = line.indexOf('=');
          if (eqIdx !== -1) {
            const val = line.substring(eqIdx + 1).trim();
            for (const h of val.split(',')) {
              const clean = h.trim();
              if (clean) mitmHosts.add(clean);
            }
          }
        }
        continue;
      }

      // [REWRITE]
      if (currentSection === 'REWRITE') {
        const parts = line.split(/\s+/);
        if (parts.length >= 2) {
          const patternStr = parts[0];
          const actionStr = parts[1].toLowerCase();
          const targetStr = parts.slice(2).join(' ') || undefined;

          const action = this.normalizeAction(actionStr);
          if (action) {
            try {
              rewrites.push({
                id: `rw_${rewrites.length + 1}`,
                pattern: patternStr,
                regex: new RegExp(patternStr),
                action,
                target: targetStr,
              });
            } catch {
              // 忽略无效正则
            }
          }
        }
        continue;
      }

      // [SCRIPT] Loon 格式：
      // http-response ^https?://... script-path=..., tag=xxx, requires-body=true
      if (currentSection === 'SCRIPT') {
        const parts = line.split(/\s+/);
        if (parts.length >= 2) {
          const scriptTypeRaw = parts[0].toLowerCase();
          const patternStr = parts[1];
          const restStr = parts.slice(2).join(' ');
          const props = this.parseCommaKeyValues(restStr);

          const scriptType = scriptTypeRaw.includes('request') ? 'http-request' : 'http-response';
          const scriptName = props['tag'] || `loon_script_${scripts.length + 1}`;
          const scriptPath = props['script-path'] || '';
          const requiresBody = props['requires-body'] === '1' || props['requires-body'] === 'true';
          const timeout = parseInt(props['timeout'] || '5', 10) || 5;

          if (patternStr && scriptPath) {
            try {
              scripts.push({
                id: `scr_${scripts.length + 1}`,
                name: scriptName,
                type: scriptType,
                pattern: patternStr,
                regex: new RegExp(patternStr),
                scriptPath,
                requiresBody,
                timeout,
              });
            } catch {
              // 忽略无效正则
            }
          }
        }
        continue;
      }
    }

    return {
      id,
      name,
      description,
      platform: 'loon',
      enabled: true,
      url,
      autoUpdate: !!url,
      updateIntervalHours: 24,
      lastUpdated: new Date().toISOString(),
      lastError: null,
      mitmHosts: Array.from(mitmHosts),
      rewrites,
      scripts,
      rawSource: content,
    };
  }

  /**
   * 3. 解析 Quantumult X 重写规范 (.conf)
   */
  private static parseQuantumultX(content: string, id: string, url?: string): CleanModule {
    const lines = content.split(/\r?\n/);
    let name = 'Quantumult X 重写';
    let description = '';
    const mitmHosts = new Set<string>();
    const rewrites: CleanRewriteRule[] = [];
    const scripts: CleanScriptRule[] = [];
    let currentSection = '';

    for (let rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      if (line.startsWith('#') || line.startsWith(';')) {
        if (!name || name === 'Quantumult X 重写') {
          const nameMatch = line.match(/^[#;]\s*(?:name|title)\s*[:=]\s*(.+)$/i);
          if (nameMatch) name = nameMatch[1].trim();
        }
        continue;
      }

      if (line.startsWith('[') && line.endsWith(']')) {
        currentSection = line.substring(1, line.length - 1).trim().toLowerCase();
        continue;
      }

      // [mitm]
      if (currentSection === 'mitm') {
        if (line.toLowerCase().startsWith('hostname')) {
          const eqIdx = line.indexOf('=');
          if (eqIdx !== -1) {
            const val = line.substring(eqIdx + 1).trim();
            for (const h of val.split(',')) {
              const clean = h.trim();
              if (clean) mitmHosts.add(clean);
            }
          }
        }
        continue;
      }

      // [rewrite_local] 或直接以 URL 开头的规则行
      if (currentSection === 'rewrite_local' || line.includes(' url ')) {
        // Quantumult X 语法结构:
        // pattern url reject-200
        // pattern url script-response-body path/to/script.js
        // pattern url script-request-body path/to/script.js
        const parts = line.split(/\s+url\s+/i);
        if (parts.length === 2) {
          const patternStr = parts[0].trim();
          const actionPart = parts[1].trim();
          const actionTokens = actionPart.split(/\s+/);
          const verb = actionTokens[0].toLowerCase();

          if (verb.startsWith('reject')) {
            const action = this.normalizeAction(verb);
            if (action) {
              try {
                rewrites.push({
                  id: `rw_${rewrites.length + 1}`,
                  pattern: patternStr,
                  regex: new RegExp(patternStr),
                  action,
                });
              } catch {}
            }
          } else if (verb.includes('script-response') || verb.includes('script-request')) {
            const scriptType = verb.includes('request') ? 'http-request' : 'http-response';
            const scriptPath = actionTokens[1] || '';
            const requiresBody = verb.includes('-body');

            if (patternStr && scriptPath) {
              try {
                scripts.push({
                  id: `scr_${scripts.length + 1}`,
                  name: `qx_script_${scripts.length + 1}`,
                  type: scriptType,
                  pattern: patternStr,
                  regex: new RegExp(patternStr),
                  scriptPath,
                  requiresBody,
                  timeout: 5,
                });
              } catch {}
            }
          } else if (verb.startsWith('302') || verb.startsWith('307')) {
            const targetUrl = actionTokens[1];
            try {
              rewrites.push({
                id: `rw_${rewrites.length + 1}`,
                pattern: patternStr,
                regex: new RegExp(patternStr),
                action: 'redirect',
                target: targetUrl,
              });
            } catch {}
          }
        }
      }
    }

    return {
      id,
      name,
      description,
      platform: 'quantumultx',
      enabled: true,
      url,
      autoUpdate: !!url,
      updateIntervalHours: 24,
      lastUpdated: new Date().toISOString(),
      lastError: null,
      mitmHosts: Array.from(mitmHosts),
      rewrites,
      scripts,
      rawSource: content,
    };
  }

  /**
   * 标准化动作名称
   */
  private static normalizeAction(raw: string): RewriteAction | null {
    const val = raw.toLowerCase().trim();
    if (val === 'reject' || val === 'block') return 'reject';
    if (val === 'reject-200' || val === 'reject-tinygif' || val === '-blank') return 'reject-200';
    if (val === 'reject-img' || val === 'reject-gif') return 'reject-img';
    if (val === 'reject-dict' || val === 'reject-json') return 'reject-dict';
    if (val === 'reject-array') return 'reject-array';
    if (val.startsWith('_302_') || val.startsWith('_307_') || val === '302' || val === '307') return 'redirect';
    if (val === 'header-replace' || val === 'request-header' || val === 'response-header') return 'header-replace';
    if (val === 'body-replace' || val === 'replace' || val === 'response-body') return 'body-replace';
    return null;
  }

  /**
   * 解析形如: a=1, b="foo", c=true 的逗号键值对
   */
  private static parseCommaKeyValues(str: string): Record<string, string> {
    const result: Record<string, string> = {};
    const tokens = str.split(',');
    for (const token of tokens) {
      const eqIdx = token.indexOf('=');
      if (eqIdx !== -1) {
        const key = token.substring(0, eqIdx).trim().toLowerCase();
        let val = token.substring(eqIdx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.substring(1, val.length - 1);
        }
        result[key] = val;
      }
    }
    return result;
  }
}
