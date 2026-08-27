import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { LazyWebServer } from './lazy-webserver.js'

interface ViewerSessionSnapshot {
  readonly header: Session['header']
  readonly events: readonly SessionEvent[]
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
    'x-content-type-options': 'nosniff',
  })
  response.end(JSON.stringify(value))
}

function sessionPath(request: IncomingMessage): { id: string; stream: boolean } | undefined {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1')
  const match = /^\/api\/sessions\/([^/]+)(\/events)?$/.exec(url.pathname)
  if (match?.[1] === undefined) return undefined
  try { return { id: decodeURIComponent(match[1]), stream: match[2] !== undefined } }
  catch { return undefined }
}

export class TrajectorySessionGateway {
  private readonly sessions = new Map<string, Session>()
  private readonly streams = new Map<string, Set<ServerResponse>>()
  private readonly releaseRoutes: Array<() => void>
  private readonly releaseEvents: Array<() => void>

  constructor(ctx: Context, server: LazyWebServer) {
    this.releaseRoutes = [server.register({
      kind: 'prefix',
      path: '/api/sessions',
      handler: (request, response) => { this.handle(request, response) },
    })]
    this.releaseEvents = [
      ctx.on('session/event', (session, event) => {
        if (this.sessions.get(session.id) !== session) return
        const payload = `event: session-event\ndata: ${JSON.stringify(event)}\n\n`
        for (const response of this.streams.get(session.id) ?? []) response.write(payload)
      }),
      ctx.on('session/disposed', session => { this.revoke(session) }),
    ]
  }

  register(session: Session): void { this.sessions.set(session.id, session) }

  dispose(): void {
    for (const release of this.releaseEvents) release()
    for (const release of this.releaseRoutes) release()
    for (const responses of this.streams.values()) {
      for (const response of responses) response.end()
    }
    this.streams.clear()
    this.sessions.clear()
  }

  private revoke(session: Session): void {
    if (this.sessions.get(session.id) !== session) return
    this.sessions.delete(session.id)
    for (const response of this.streams.get(session.id) ?? []) response.end()
    this.streams.delete(session.id)
  }

  private handle(request: IncomingMessage, response: ServerResponse): void {
    if (request.method !== 'GET') { json(response, 405, { error: 'method not allowed' }); return }
    const target = sessionPath(request)
    if (target === undefined) { json(response, 404, { error: 'not found' }); return }
    const session = this.sessions.get(target.id)
    if (session === undefined) { json(response, 404, { error: 'session is not available to this viewer' }); return }
    if (!target.stream) {
      const snapshot: ViewerSessionSnapshot = { header: session.header, events: session.events }
      json(response, 200, snapshot)
      return
    }
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    const parsedAfter = Number(url.searchParams.get('after') ?? '-1')
    const after = Number.isSafeInteger(parsedAfter) ? parsedAfter : -1
    response.writeHead(200, {
      'cache-control': 'no-store',
      connection: 'keep-alive',
      'content-type': 'text/event-stream; charset=utf-8',
      'x-accel-buffering': 'no',
      'x-content-type-options': 'nosniff',
    })
    response.flushHeaders()
    for (const event of session.events) {
      if (event.seq > after) response.write(`event: session-event\ndata: ${JSON.stringify(event)}\n\n`)
    }
    let responses = this.streams.get(target.id)
    if (responses === undefined) { responses = new Set(); this.streams.set(target.id, responses) }
    responses.add(response)
    request.once('close', () => {
      responses?.delete(response)
      if (responses?.size === 0) this.streams.delete(target.id)
    })
  }
}
