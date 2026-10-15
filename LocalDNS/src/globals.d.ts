// Ambient declarations for Scripting Runtime

declare const fetch: (url: string | URL, init?: any) => Promise<any>;
declare class AbortController {
  readonly signal: any;
  abort(reason?: any): void;
}
declare class AbortSignal {
  static timeout(ms: number): any;
}
declare class Data {
  static fromFile(path: string): Data | null;
  static fromUTF8(str: string): Data;
  static fromRawString(str: string, encoding?: string): Data;
  static fromBase64(base64: string): Data;
  static fromUint8Array(bytes: Uint8Array): Data;
  toUTF8(): string;
  toRawString(encoding?: string): string;
  toBase64(): string;
  toUint8Array(): Uint8Array | null;
  size: number;
}
declare class FileEntity {
  static openForReading(path: string): FileEntity;
  close(): void;
  readonly path: string;
}
declare namespace Storage {
  function get<T = any>(key: string, options?: { shared?: boolean }): T | null;
  function set<T = any>(key: string, value: T, options?: { shared?: boolean }): boolean;
  function remove(key: string, options?: { shared?: boolean }): void;
  function contains(key: string, options?: { shared?: boolean }): boolean;
  function clear(): void;
  function keys(): string[];
  function getData(key: string, options?: { shared?: boolean }): Data | null;
  function setData(key: string, data: Data, options?: { shared?: boolean }): void;
}
declare namespace Script {
  const directory: string;
  const env: string;
  function exit(value?: any): void;
  function minimize(): Promise<boolean>;
  function isMinimized(): boolean;
  function enableMinimize(enabled?: boolean): void;
  function onMinimize(callback: () => void): () => void;
  function onResume(callback: (details: any) => void): () => void;
}
declare namespace BackgroundKeeper {
  const isActive: Promise<boolean>;
  function keepAlive(): Promise<boolean>;
  function stopKeepAlive(): Promise<void>;
}
declare namespace Path {
  function join(...paths: string[]): string;
  function dirname(path: string): string;
  function basename(path: string): string;
  function extname(path: string): string;
}
declare namespace FileManager {
  function exists(path: string): Promise<boolean>;
  function existsSync(path: string): boolean;
  function isDirectory(path: string): Promise<boolean>;
  function isDirectorySync(path: string): boolean;
  function isFile(path: string): Promise<boolean>;
  function isFileSync(path: string): boolean;
  function readAsString(path: string): Promise<string>;
  function readAsStringSync(path: string): string;
  function writeAsString(path: string, content: string): Promise<void>;
  function writeAsStringSync(path: string, content: string): void;
  function readAsData(path: string): Promise<Data>;
  function readAsDataSync(path: string): Data;
}
declare class HttpResponseBody {
  static text(text: string): HttpResponseBody;
  static html(html: string): HttpResponseBody;
  static data(data: Data): HttpResponseBody;
}
declare class HttpResponse {
  readonly statusCode: number;
  readonly reasonPhrase: string;
  static ok(body?: HttpResponseBody): HttpResponse;
  static created(): HttpResponse;
  static accepted(): HttpResponse;
  static badRequest(body?: HttpResponseBody | null): HttpResponse;
  static notFound(body?: HttpResponseBody | null): HttpResponse;
  static internalServerError(): HttpResponse;
  static movedTemporarily(url: string): HttpResponse;
  static raw(statusCode: number, phrase: string, options?: { headers?: Record<string, string>; body?: Data | any } | null): HttpResponse;
}
declare interface HttpRequest {
  path: string;
  target: string;
  method: string;
  headers: Record<string, string>;
  body: Data;
  address: string | null;
  params: Record<string, string>;
  queryParams: Array<{ key: string; value: string }>;
}
declare class HttpServer {
  readonly port: number | null;
  readonly state: string;
  start(options?: { port?: number; forceIPv4?: boolean; tls?: any }): string | null;
  stop(): void;
  registerFilesFromDirectory(path: string, directory: string, options?: { defaults?: string[] }): void;
  registerFile(path: string, filePath: string): void;
  registerMiddleware(handler: (request: HttpRequest) => Promise<HttpResponse | null | undefined>): void;
  registerAsyncHandler(path: string, handler: (request: HttpRequest) => Promise<HttpResponse>): void;
  setNotFoundHandler(handler: (request: HttpRequest) => Promise<HttpResponse>): void;
}

