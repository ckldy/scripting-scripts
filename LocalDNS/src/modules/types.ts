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
  | 'body-replace';

export interface CleanRewriteRule {
  id: string;
  pattern: string;
  regex: RegExp;
  action: RewriteAction;
  target?: string;
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
