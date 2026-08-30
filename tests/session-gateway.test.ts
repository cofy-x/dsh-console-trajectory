import { Context } from '@deepseek-ai/cordis'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionQueryEngine } from '@deepseek-ai/dsh-session-query'
import { afterEach, describe, expect, it } from 'vitest'
import { LazyWebServer } from '../src/lazy-webserver.js'
import { TrajectorySessionGateway } from '../src/session-gateway.js'

const cleanups: Array<() => Promise<void> | void> = []
afterEach(async () => { while (cleanups.length > 0) await cleanups.pop()?.() })

function createSession(id: string, cwd = '/workspace', createdAt = 1): Session {
  const sessionId = SessionId(id)
  return Session.create(sessionId, undefined, {
    version: 0,
    id: sessionId,
    createdAt,
    cwd,
  })
}

describe('TrajectorySessionGateway', () => {
  it('serves only explicitly registered Sessions on loopback', async () => {
    const ctx = new Context()
    const server = new LazyWebServer(ctx)
    const query = {
      filterSessions: async () => [],
      readTitleSnapshots: async () => [],
      readSession: async () => { throw new Error('not found') },
    } as unknown as SessionQueryEngine
    const gateway = new TrajectorySessionGateway(ctx, server, query)
    cleanups.push(async () => { gateway.dispose(); await server.close() })
    const port = await server.listen()
    const origin = `http://127.0.0.1:${port}`
    expect(await fetch(`${origin}/api/sessions/unknown`).then(response => response.status)).toBe(404)

    const session = createSession('dsh-console-test')
    gateway.register(session)
    const list = await fetch(`${origin}/api/sessions`).then(next => next.json())
    expect(list).toMatchObject({ sessions: [{ id: 'dsh-console-test', current: true, live: true }] })
    const response = await fetch(`${origin}/api/sessions/dsh-console-test`)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ header: { id: 'dsh-console-test' }, events: [] })

    const stream = await fetch(`${origin}/api/sessions/dsh-console-test/events?after=-1`)
    const reader = stream.body?.getReader()
    if (reader === undefined) throw new Error('SSE response body missing')
    const event = session.append('turn/start', { turn: 1 })
    ctx.emit('session/event', session, event)
    const chunk = await reader.read()
    expect(new TextDecoder().decode(chunk.value)).toContain('"type":"turn/start"')
    await reader.cancel()

    ctx.emit('session/disposed', session)
    expect(await fetch(`${origin}/api/sessions/dsh-console-test`).then(next => next.status)).toBe(404)
    await expect(reader.read()).resolves.toMatchObject({ done: true })
  })

  it('lists titled history, switches live Sessions, and contains damaged logs', async () => {
    const ctx = new Context()
    const server = new LazyWebServer(ctx)
    const history = createSession('dsh-console-history', '/workspace', 2)
    const damaged = createSession('dsh-console-damaged', '/workspace', 1)
    const records = [history, damaged].map(session => ({
      header: session.header,
      live: false,
      persisted: true,
    }))
    const query = {
      filterSessions: async (filters: ReadonlyArray<{ kind: string, values: readonly unknown[] }>) => {
        const idFilter = filters.find(filter => filter.kind === 'id')
        return idFilter === undefined
          ? records
          : records.filter(record => idFilter.values.includes(record.header.id))
      },
      readTitleSnapshots: async (ids: readonly ReturnType<typeof SessionId>[]) =>
        ids.map(sessionId => ({
          sessionId,
          status: 'fulfilled' as const,
          value: {
            session: records.find(record => record.header.id === sessionId)?.header,
            ...(sessionId === history.id
              ? { title: { title: 'History title', eventSeq: 0 } }
              : {}),
          },
        })),
      listEvents: async (sessionId: ReturnType<typeof SessionId>) => {
        if (sessionId === damaged.id) throw new Error('damaged log')
        return [{
          sessionId,
          seq: 0,
          type: 'user/message',
          time: 2,
          surface: 'current' as const,
        }]
      },
      readSession: async (sessionId: ReturnType<typeof SessionId>) => {
        if (sessionId === damaged.id) throw new Error('damaged log')
        return { session: history.header, events: history.events }
      },
    } as unknown as SessionQueryEngine
    const gateway = new TrajectorySessionGateway(ctx, server, query)
    cleanups.push(async () => { gateway.dispose(); await server.close() })
    const first = createSession('dsh-console-current-1', '/workspace', 3)
    const second = createSession('dsh-console-current-2', '/workspace', 4)
    gateway.register(first)
    gateway.register(second)
    const origin = `http://127.0.0.1:${await server.listen()}`

    const listed = await fetch(`${origin}/api/sessions`).then(response => response.json())
    expect(listed.sessions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: history.id, title: 'History title', live: false }),
      expect.objectContaining({ id: damaged.id, live: false }),
      expect.objectContaining({ id: first.id, current: false, live: true }),
      expect.objectContaining({ id: second.id, current: true, live: true }),
    ]))
    expect(await fetch(`${origin}/api/sessions/${history.id}`).then(response => response.status)).toBe(200)
    expect(await fetch(`${origin}/api/sessions/${damaged.id}`).then(response => response.status)).toBe(404)

    gateway.register(createSession('dsh-console-other-workspace', '/other', 5))
    expect(await fetch(`${origin}/api/sessions/${first.id}`).then(response => response.status)).toBe(404)
  })
})
