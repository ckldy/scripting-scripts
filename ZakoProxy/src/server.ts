import { Path, Script } from "scripting"
import { SECURITY_HEADERS, handleApiRoute } from "./api"
import { ProxyEngine } from "./proxy"
import { APP_VERSION } from "./version"
import type { Store } from "./store"

export { APP_VERSION }

/**
 * 将 /ui/ 后的相对路径安全地解析到 web 根目录内。
 * 返回 null 表示路径非法（目录穿越、反斜杠、NUL 等），调用方应直接 404。
 */
export function resolveStaticPath(webRootRaw: string, sub: string): string | null {
  const webRoot = webRootRaw.replace(/\/+$/, "")
  if (!sub || sub.includes("\0") || sub.includes("\\")) return null
  if (sub.split(/[\\/]+/).includes("..")) return null
  const fullPath = Path.join(webRoot, sub)
  if (fullPath !== webRoot && !fullPath.startsWith(`${webRoot}/`)) return null
  return fullPath
}

export class ZakoServer {
  private server: HttpServer | null = null
  private engine: ProxyEngine
  public activePort: number | null = null
  public startTime: number = Date.now()

  constructor(private store: Store) {
    this.engine = new ProxyEngine(store)
  }

  get isRunning(): boolean {
    return this.server !== null && this.server.state === "running"
  }

  start(port: number = 1990): { success: boolean; port?: number; error?: string } {
    if (this.isRunning) {
      return { success: true, port: this.activePort || port }
    }

    try {
      this.server = new HttpServer()
      const webDir = Path.join(Script.directory, "web")

      // 1. 全局中间件：拦截 CORS Preflight、WebUI 静态资源、/api/* 控制台 REST 路由
      this.server.registerMiddleware(async (req: HttpRequest) => {
        const method = req.method ? req.method.toUpperCase() : "GET"
        const path = req.path || "/"

        // CORS Preflight 预检请求
        // 仅对 AI 代理端点放开跨域；/api/* 是无需鉴权的管理接口，绝不向第三方网页开放
        if (method === "OPTIONS") {
          const allowCors = !path.startsWith("/api/")
          return HttpResponse.raw(204, "No Content", {
            headers: allowCors
              ? {
                  "Access-Control-Allow-Origin": "*",
                  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, PATCH, OPTIONS",
                  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-key",
                  "Access-Control-Max-Age": "86400",
                }
              : {},
          })
        }

        // 根路径重定向到 /ui/
        if (path === "/" || path === "/ui") {
          return HttpResponse.movedTemporarily("/ui/")
        }

        // Web 控制台静态资源托管 (/ui/*)
        if (path.startsWith("/ui")) {
          let sub = path.slice(3) // 移除 '/ui'
          if (sub.startsWith("/")) sub = sub.slice(1)
          if (!sub || sub === "/") sub = "index.html"
          sub = sub.split("?")[0]

          // 防目录穿越：拒绝 .. 段/反斜杠/NUL，且最终路径必须位于 web 目录内
          const fullPath = resolveStaticPath(webDir, sub)
          if (!fullPath) {
            return HttpResponse.raw(404, "Not Found", {
              headers: {
                "Content-Type": "text/plain; charset=utf-8",
                ...SECURITY_HEADERS,
              },
              body: Data.fromRawString("Not Found", "utf-8") || undefined,
            })
          }

          if ((await FileManager.exists(fullPath)) && !(await FileManager.isDirectory(fullPath))) {
            const ext = Path.extname(fullPath).toLowerCase()
            const mimeMap: Record<string, string> = {
              ".html": "text/html; charset=utf-8",
              ".css": "text/css; charset=utf-8",
              ".js": "application/javascript; charset=utf-8",
              ".json": "application/json; charset=utf-8",
              ".png": "image/png",
              ".jpg": "image/jpeg",
              ".jpeg": "image/jpeg",
              ".svg": "image/svg+xml",
              ".woff2": "font/woff2",
              ".woff": "font/woff",
              ".txt": "text/plain; charset=utf-8",
              ".ico": "image/x-icon",
            }
            const contentType = mimeMap[ext] || "application/octet-stream"
            const file = FileEntity.openForReading(fullPath)
            return HttpResponse.raw(200, "OK", {
              headers: {
                "Content-Type": contentType,
                "Cache-Control": "no-cache, no-store, must-revalidate",
                Pragma: "no-cache",
                Expires: "0",
                "Access-Control-Allow-Origin": "*",
                ...SECURITY_HEADERS,
              },
              body: file,
            })
          }
        }

        // 控制台 REST API 路由 (/api/*)
        if (path.startsWith("/api/")) {
          const apiResp = await handleApiRoute(path, method, req, this.store, this)
          if (apiResp) {
            return apiResp
          }
        }

        // 放行至后继已注册的 AI 代理路由
        return undefined
      })

      // 2. GET /health
      this.server.registerAsyncHandler("/health", async () => {
        return HttpResponse.ok(
          HttpResponseBody.text(JSON.stringify({ status: "ok", app: "ZakoProxy", version: APP_VERSION }))
        )
      })

      // 3. GET /v1/models
      this.server.registerAsyncHandler("/v1/models", async (req) => {
        try {
          const res = await this.engine.handleModels(req.headers)
          return HttpResponse.raw(res.status, "OK", {
            headers: res.headers,
            body: Data.fromRawString(res.body, "utf-8") || undefined,
          })
        } catch (err: any) {
          return this.formatErrorResponse(err)
        }
      })

      // 4. POST /v1/responses
      this.server.registerAsyncHandler("/v1/responses", async (req) => {
        return this.handleForward("responses", req)
      })

      // 5. POST /v1/responses/compact
      this.server.registerAsyncHandler("/v1/responses/compact", async (req) => {
        return this.handleForward("compact", req)
      })

      // 6. POST /v1/chat/completions
      this.server.registerAsyncHandler("/v1/chat/completions", async (req) => {
        return this.handleForward("chat", req)
      })

      // 7. POST /v1/messages
      this.server.registerAsyncHandler("/v1/messages", async (req) => {
        return this.handleForward("anthropic", req)
      })

      // 8. 404 Handler
      this.server.setNotFoundHandler(async (req) => {
        const errorJson = JSON.stringify({
          error: {
            message: `Route not found: ${req.path}`,
            type: "not_found",
          },
        })
        return HttpResponse.raw(404, "Not Found", {
          headers: { "Content-Type": "application/json; charset=utf-8", ...SECURITY_HEADERS },
          body: Data.fromRawString(errorJson, "utf-8") || undefined,
        })
      })

      const err = this.server.start({
        port,
        forceIPv4: true,
      })

      if (err) {
        this.server = null
        this.activePort = null
        return { success: false, error: err }
      }

      this.activePort = this.server.port || port
      this.startTime = Date.now()
      return { success: true, port: this.activePort }
    } catch (e: any) {
      this.server = null
      this.activePort = null
      return { success: false, error: e?.message || String(e) }
    }
  }

  stop(): void {
    if (this.server) {
      try {
        this.server.stop()
      } catch {}
      this.server = null
      this.activePort = null
    }
  }

  async restart(port?: number): Promise<{ success: boolean; port?: number; error?: string }> {
    const targetPort = port || this.activePort || 1990
    this.stop()
    await new Promise<void>((resolve) => setTimeout(() => resolve(), 150))
    return this.start(targetPort)
  }

  private async handleForward(protocol: string, req: HttpRequest): Promise<HttpResponse> {
    try {
      const rawText = req.body?.toDecodedString("utf8") || ""
      let bodyObj: any = {}
      if (rawText.trim()) {
        try {
          bodyObj = JSON.parse(rawText)
        } catch {
          return this.formatErrorResponse({
            status: 400,
            message: "Malformed JSON body in request",
          })
        }
      }

      const res = await this.engine.forward(protocol, req.headers, bodyObj)
      return HttpResponse.raw(res.status, "OK", {
        headers: res.headers,
        body: Data.fromRawString(res.body, "utf-8") || undefined,
      })
    } catch (err: any) {
      return this.formatErrorResponse(err)
    }
  }

  private formatErrorResponse(err: any): HttpResponse {
    const status = typeof err?.status === "number" ? err.status : 500
    const message = err?.message || err?.error || "Internal Proxy Error"
    const errorJson = JSON.stringify({
      error: {
        message,
        type: "proxy_error",
      },
    })
    const headers: Record<string, string> = {
      "Content-Type": "application/json; charset=utf-8",
      ...(err?.headers || {}),
    }

    return HttpResponse.raw(status, "Error", {
      headers,
      body: Data.fromRawString(errorJson, "utf-8") || undefined,
    })
  }
}
