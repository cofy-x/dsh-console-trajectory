import { Context } from '@deepseek-ai/cordis'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { afterEach, describe, expect, it } from 'vitest'
import { LazyWebServer } from '../src/lazy-webserver.js'
import { TrajectorySessionGateway } from '../src/session-gateway.js'

const cleanups: Array<() => Promise<void> | void> = []
afterEach(async () => { while (cleanups.length > 0) await cleanups.pop()?.() })

describe('TrajectorySessionGateway', () => {
  it('serves only explicitly registered Sessions on loopback', async () => {
    const ctx = new Context()
    const server = new LazyWebServer(ctx)
    const gateway = new TrajectorySessionGateway(ctx, server)
    cleanups.push(async () => { gateway.dispose(); await server.close() })
    const port = await server.listen()
    const origin = `http://127.0.0.1:${port}`
    expect(await fetch(`${origin}/api/sessions/unknown`).then(response => response.status)).toBe(404)

    const session = Session.create(SessionId('dsh-console-test'))
    gateway.register(session)
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
  })
})
