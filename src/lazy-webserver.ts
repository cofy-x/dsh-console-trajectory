import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Service, type Context } from '@deepseek-ai/cordis'

export interface HttpRoute {
  readonly kind: 'exact' | 'prefix'
  readonly path: string
  handler(request: IncomingMessage, response: ServerResponse): Promise<void> | void
}

export class LazyWebServer extends Service {
  private readonly exact = new Map<string, HttpRoute>()
  private readonly prefixes = new Map<string, HttpRoute>()
  private fallback: HttpRoute['handler'] | undefined
  private server: Server | undefined
  private listening: Promise<number> | undefined
  private listenedPort: number | undefined

  constructor(ctx: Context) {
    super(ctx, 'trajectoryWebServer')
    ctx.effect(() => async () => { await this.close() }, 'dsh-console-trajectory: web server')
  }

  get host(): '127.0.0.1' { return '127.0.0.1' }

  register(route: HttpRoute): () => void {
    const table = route.kind === 'exact' ? this.exact : this.prefixes
    if (table.has(route.path)) throw new Error(`trajectory webserver: duplicate ${route.kind} route "${route.path}"`)
    table.set(route.path, route)
    return () => { table.delete(route.path) }
  }

  registerFallback(handler: HttpRoute['handler']): () => void {
    if (this.fallback !== undefined) throw new Error('trajectory webserver: fallback already registered')
    this.fallback = handler
    return () => { if (this.fallback === handler) this.fallback = undefined }
  }

  async listen(): Promise<number> {
    if (this.listenedPort !== undefined) return this.listenedPort
    if (this.listening !== undefined) return this.listening
    const server = createServer((request, response) => {
      void this.handle(request, response).catch((error: unknown) => {
        this.ctx.logger.warn(error instanceof Error ? error : new Error(String(error)))
        if (response.headersSent) response.destroy()
        else { response.writeHead(500); response.end() }
      })
    })
    this.server = server
    this.listening = new Promise<number>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, this.host, () => {
        const address = server.address()
        if (address === null || typeof address === 'string') reject(new Error('invalid trajectory listen address'))
        else {
          this.listenedPort = (address as AddressInfo).port
          resolve(this.listenedPort)
        }
      })
    })
    try { return await this.listening }
    catch (error) { this.server = undefined; this.listenedPort = undefined; throw error }
    finally { this.listening = undefined }
  }

  async close(): Promise<void> {
    if (this.listening !== undefined) { try { await this.listening } catch {} }
    const server = this.server
    this.server = undefined
    this.listenedPort = undefined
    if (server === undefined) return
    await new Promise<void>(resolve => {
      server.close(() => resolve())
      server.closeAllConnections()
    })
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
    const route = this.exact.get(pathname) ?? this.longestPrefix(pathname)
    if (route !== undefined) { await route.handler(request, response); return }
    if (this.fallback !== undefined) { await this.fallback(request, response); return }
    response.writeHead(404); response.end()
  }

  private longestPrefix(pathname: string): HttpRoute | undefined {
    let best: HttpRoute | undefined
    for (const [prefix, route] of this.prefixes) {
      if (pathname !== prefix && !pathname.startsWith(`${prefix}/`)) continue
      if (best === undefined || prefix.length > best.path.length) best = route
    }
    return best
  }
}
