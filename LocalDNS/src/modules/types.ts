// Clean Module Core Types - Surge / Loon / Quantumult X Unified Contract

export type ModulePlatform = 'surge' | 'loon' | 'quantumultx' | 'universal';

export type RewriteAction =
  | 'reject'
  | 'reject-200'
  | 'reject-img'
  | 'reject-dict'
  | 'reject-array'
  | 'redirect'
  | 'header-replace'
  | 'header-del'
  | 'body-replace'
  | 'mock';

export interface CleanRewriteRule {
  id: string;
  name?: string;
  pattern: string;
  regex: RegExp;
  action: RewriteAction;
  target?: string;
  extra?: string;
  enabled?: boolean;
  note?: string;
}

export interface EnrichedRewriteRule extends CleanRewriteRule {
  moduleId: string;
  moduleName: string;
  moduleEnabled: boolean;
  isCustom: boolean;
}

export interface CleanScriptRule {
  id: string;
  name: string;
  type: 'http-request' | 'http-response';
  pattern: string;
  regex: RegExp;
  scriptPath: string;
  scriptContent?: string;
  requiresBody: boolean;
  binaryBody?: boolean;
  timeout: number; // in seconds, default 5
}

export interface CleanModule {
  id: string;
  name: string;
  description: string;
  platform: ModulePlatform;
  enabled: boolean;
  url?: string;
  autoUpdate: boolean;
  updateIntervalHours: number;
  lastUpdated: string | null;
  lastError: string | null;
  mitmHosts: string[];
  rewrites: CleanRewriteRule[];
  scripts: CleanScriptRule[];
  rawSource: string;
}

export interface ModuleManagerStats {
  totalModules: number;
  activeModules: number;
  totalMitmHosts: number;
  totalRewrites: number;
  totalScripts: number;
  hitRewrites: number;
  hitScripts: number;
  cleanedStreams: number;
}
