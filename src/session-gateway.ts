import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { SessionId, type Session, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { SessionQueryEngine } from '@deepseek-ai/dsh-session-query'
import type { LazyWebServer } from './lazy-webserver.js'

const SESSION_PREFIX = 'dsh-console-'
const COMPLETION_PREFIX = 'dsh-console-completion-'
const OBSERVATION_BATCH_SIZE = 8
const OBSERVATION_CACHE_TTL_MS = 60_000

interface ViewerSessionSnapshot {
  readonly header: Session['header']
  readonly events: readonly SessionEvent[]
  readonly current: boolean
  readonly live: boolean
}

interface ViewerSessionSummary {
  readonly id: string
  readonly title?: string
  readonly createdAt: Session['header']['createdAt']
  readonly current: boolean
  readonly live: boolean
  readonly persisted: boolean
}

type SessionRequest =
  | { readonly kind: 'list' }
  | { readonly kind: 'snapshot'; readonly id: string }
  | { readonly kind: 'events'; readonly id: string }

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
    'x-content-type-options': 'nosniff',
  })
  response.end(JSON.stringify(value))
}

function parseRequest(request: IncomingMessage): SessionRequest | undefined {
  const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
  if (pathname === '/api/sessions' || pathname === '/api/sessions/') return { kind: 'list' }
  const match = /^\/api\/sessions\/([^/]+)(\/events)?$/.exec(pathname)
  if (match?.[1] === undefined) return undefined
  try {
    return match[2] === undefined
      ? { kind: 'snapshot', id: decodeURIComponent(match[1]) }
      : { kind: 'events', id: decodeURIComponent(match[1]) }
  } catch {
    return undefined
  }
}

function isConsoleSession(id: string): boolean {
  return id.startsWith(SESSION_PREFIX) && !id.startsWith(COMPLETION_PREFIX)
}

function hasTrajectoryEvents(events: ReadonlyArray<{ readonly type: string }>): boolean {
  return events.some(event =>
    event.type === 'request/header' ||
    event.type === 'user/message' ||
    event.type === 'assistant/message' ||
    event.type === 'tool/call' ||
    event.type === 'tool/result' ||
    event.type.includes('error') ||
    event.type.includes('interrupt'),
  )
}

export class TrajectorySessionGateway {
  private readonly sessions = new Map<string, Session>()
  private readonly streams = new Map<string, Set<ServerResponse>>()
  private readonly releaseRoutes: Array<() => void>
  private readonly releaseEvents: Array<() => void>
  private currentSessionId: string | undefined
  private cwd: string | undefined
  private readonly observationCache = new Map<string, {
    readonly expiresAt: number
    readonly hasTrajectory: boolean
  }>()

  constructor(
    ctx: Context,
    server: LazyWebServer,
    private readonly query: SessionQueryEngine,
  ) {
    this.releaseRoutes = [server.register({
      kind: 'prefix',
      path: '/api/sessions',
      handler: async (request, response) => { await this.handle(request, response) },
    })]
    this.releaseEvents = [
      ctx.on('session/event', (session, event) => {
        if (this.sessions.get(String(session.id)) !== session) return
        this.observationCache.delete(String(session.id))
        const payload = `event: session-event\ndata: ${JSON.stringify(event)}\n\n`
        for (const response of this.streams.get(String(session.id)) ?? []) response.write(payload)
      }),
      ctx.on('session/disposed', session => { this.revoke(session) }),
    ]
  }

  register(session: Session): void {
    const nextCwd = session.header.cwd
    if (this.cwd !== undefined && nextCwd !== this.cwd) {
      for (const id of this.sessions.keys()) this.closeStreams(id)
      this.sessions.clear()
    }
    this.cwd = nextCwd
    this.currentSessionId = String(session.id)
    this.sessions.set(String(session.id), session)
  }

  dispose(): void {
    for (const release of this.releaseEvents) release()
    for (const release of this.releaseRoutes) release()
    for (const id of this.streams.keys()) this.closeStreams(id)
    this.sessions.clear()
    this.observationCache.clear()
    this.currentSessionId = undefined
    this.cwd = undefined
  }

  private revoke(session: Session): void {
    const id = String(session.id)
    if (this.sessions.get(id) !== session) return
    this.sessions.delete(id)
    this.closeStreams(id)
  }

  private closeStreams(id: string): void {
    for (const response of this.streams.get(id) ?? []) response.end()
    this.streams.delete(id)
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.method !== 'GET') { json(response, 405, { error: 'method not allowed' }); return }
    const target = parseRequest(request)
    if (target === undefined) { json(response, 404, { error: 'not found' }); return }
    if (target.kind === 'list') {
      try { json(response, 200, { sessions: await this.listSessions() }) }
      catch { json(response, 500, { error: 'sessions could not be listed' }) }
      return
    }
    if (!isConsoleSession(target.id)) { json(response, 404, { error: 'session is not available to this viewer' }); return }
    if (target.kind === 'events') { this.streamSession(request, response, target.id); return }
    const snapshot = await this.readSnapshot(target.id)
    if (snapshot === undefined) { json(response, 404, { error: 'session is not available to this viewer' }); return }
    json(response, 200, snapshot)
  }

  private async listSessions(): Promise<ViewerSessionSummary[]> {
    const signal = AbortSignal.timeout(15_000)
    const records = this.cwd === undefined
      ? []
      : await this.query.filterSessions([
          { kind: 'cwd', values: [this.cwd] },
          { kind: 'parent', values: [null] },
        ], signal)
    const candidates = records.filter(record => {
      const id = String(record.header.id)
      return isConsoleSession(id) && (record.persisted || this.sessions.has(id))
    })
    const visible: Array<(typeof candidates)[number]> = []
    for (let offset = 0; offset < candidates.length; offset += OBSERVATION_BATCH_SIZE) {
      const batch = candidates.slice(offset, offset + OBSERVATION_BATCH_SIZE)
      const observations = await Promise.all(batch.map(async record => ({
        record,
        visible: await this.isVisibleHistory(String(record.header.id)),
      })))
      for (const observation of observations) {
        if (observation.visible) visible.push(observation.record)
      }
    }
    const ids = visible.map(record => record.header.id)
    const titles = ids.length === 0 ? [] : await this.query.readTitleSnapshots(ids, signal)
    const titleById = new Map<string, string>()
    for (const result of titles) {
      if (result.status === 'fulfilled' && result.value.title !== undefined) {
        titleById.set(String(result.sessionId), result.value.title.title)
      }
    }
    const summaries = visible.map((record): ViewerSessionSummary => {
      const id = String(record.header.id)
      const title = titleById.get(id)
      return {
        id,
        ...(title === undefined ? {} : { title }),
        createdAt: record.header.createdAt,
        current: id === this.currentSessionId,
        live: this.sessions.has(id),
        persisted: record.persisted,
      }
    })
    const known = new Set(summaries.map(summary => summary.id))
    for (const session of this.sessions.values()) {
      const id = String(session.id)
      if (known.has(id) || session.header.cwd !== this.cwd || !isConsoleSession(id)) continue
      summaries.unshift({
        id,
        createdAt: session.header.createdAt,
        current: id === this.currentSessionId,
        live: true,
        persisted: false,
      })
    }
    return summaries
  }

  private async isVisibleHistory(id: string): Promise<boolean> {
    if (id === this.currentSessionId) return true
    const live = this.sessions.get(id)
    if (live !== undefined) return hasTrajectoryEvents(live.events)
    const cached = this.observationCache.get(id)
    if (cached !== undefined && cached.expiresAt > Date.now()) return cached.hasTrajectory
    try {
      const hasTrajectory = hasTrajectoryEvents(await this.query.listEvents(SessionId(id)))
      this.observationCache.set(id, {
        expiresAt: Date.now() + OBSERVATION_CACHE_TTL_MS,
        hasTrajectory,
      })
      return hasTrajectory
    } catch {
      return true
    }
  }

  private async readSnapshot(id: string): Promise<ViewerSessionSnapshot | undefined> {
    const live = this.sessions.get(id)
    if (live !== undefined && live.header.cwd === this.cwd) {
      return { header: live.header, events: live.events, current: id === this.currentSessionId, live: true }
    }
    if (this.cwd === undefined) return undefined
    const sessionId = SessionId(id)
    const records = await this.query.filterSessions([
      { kind: 'id', values: [sessionId] },
      { kind: 'cwd', values: [this.cwd] },
      { kind: 'parent', values: [null] },
      { kind: 'availability', values: ['persisted'] },
    ])
    if (records.length !== 1) return undefined
    try {
      const log = await this.query.readSession(sessionId)
      return { header: log.session, events: log.events, current: false, live: false }
    } catch {
      return undefined
    }
  }

  private streamSession(request: IncomingMessage, response: ServerResponse, id: string): void {
    const session = this.sessions.get(id)
    if (session === undefined || session.header.cwd !== this.cwd) {
      json(response, 404, { error: 'live updates are not available for this session' })
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
    let responses = this.streams.get(id)
    if (responses === undefined) { responses = new Set(); this.streams.set(id, responses) }
    responses.add(response)
    request.once('close', () => {
      responses?.delete(response)
      if (responses?.size === 0) this.streams.delete(id)
    })
  }
}
