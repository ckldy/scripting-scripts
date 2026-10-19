import { ProxyEngine } from "./proxy"
import type { Store } from "./store"

export class ZakoServer {
  private server: HttpServer | null = null
  private engine: ProxyEngine
  public activePort: number | null = null

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

      // 1. GET /health
      this.server.registerAsyncHandler("/health", async () => {
        return HttpResponse.ok(
          HttpResponseBody.text(JSON.stringify({ status: "ok" }))
        )
      })

      // 2. GET /v1/models
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

      // 3. POST /v1/responses
      this.server.registerAsyncHandler("/v1/responses", async (req) => {
        return this.handleForward("responses", req)
      })

      // 4. POST /v1/responses/compact
      this.server.registerAsyncHandler("/v1/responses/compact", async (req) => {
        return this.handleForward("compact", req)
      })

      // 5. POST /v1/chat/completions
      this.server.registerAsyncHandler("/v1/chat/completions", async (req) => {
        return this.handleForward("chat", req)
      })

      // 6. POST /v1/messages
      this.server.registerAsyncHandler("/v1/messages", async (req) => {
        return this.handleForward("anthropic", req)
      })

      // 404 Handler
      this.server.setNotFoundHandler(async (req) => {
        const errorJson = JSON.stringify({
          error: {
            message: `Route not found: ${req.path}`,
            type: "not_found",
          },
        })
        return HttpResponse.raw(404, "Not Found", {
          headers: { "Content-Type": "application/json; charset=utf-8" },
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
