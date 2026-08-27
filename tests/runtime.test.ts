import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { describe, expect, it, vi } from 'vitest'
import { TrajectoryViewerRuntime } from '../src/runtime.js'

const session = Session.create(SessionId('dsh-console-test'))
const registerSession = vi.fn()

describe('TrajectoryViewerRuntime', () => {
  it('starts once and reuses the loopback server', async () => {
    const dispose = vi.fn(async () => {})
    const startServer = vi.fn(async () => ({ origin: 'http://127.0.0.1:43123', dispose }))
    const openBrowser = vi.fn(async () => {})
    const runtime = new TrajectoryViewerRuntime({ registerSession, startServer, openBrowser })

    await Promise.all([
      runtime.open(session, new AbortController().signal),
      runtime.open(session, new AbortController().signal),
    ])

    expect(startServer).toHaveBeenCalledTimes(1)
    expect(openBrowser).toHaveBeenCalledTimes(2)
    expect(runtime.getSnapshot()).toEqual({ status: 'ready', origin: 'http://127.0.0.1:43123' })
    await runtime.dispose()
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it('returns a manual URL when browser launch fails', async () => {
    const runtime = new TrajectoryViewerRuntime({
      registerSession,
      startServer: async () => ({ origin: 'http://127.0.0.1:7', dispose: async () => {} }),
      openBrowser: async () => { throw new Error('no browser') },
    })
    await expect(runtime.open(session, new AbortController().signal)).resolves.toEqual({
      opened: false,
      url: 'http://127.0.0.1:7/trajectory/dsh-console-test',
    })
    await runtime.dispose()
  })

  it('does not start after cancellation', async () => {
    const startServer = vi.fn()
    const runtime = new TrajectoryViewerRuntime({ registerSession, startServer, openBrowser: vi.fn() })
    const controller = new AbortController()
    controller.abort(new Error('cancelled'))
    await expect(runtime.open(session, controller.signal)).rejects.toThrow('cancelled')
    expect(startServer).not.toHaveBeenCalled()
  })

  it('aborts an in-flight startup after its final waiter cancels', async () => {
    let startupSignal: AbortSignal | undefined
    const runtime = new TrajectoryViewerRuntime({
      registerSession,
      startServer: signal => {
        startupSignal = signal
        return new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => { reject(signal.reason) }, { once: true })
        })
      },
      openBrowser: vi.fn(),
    })
    const controller = new AbortController()
    const opening = runtime.open(session, controller.signal)
    controller.abort(new Error('cancelled'))

    await expect(opening).rejects.toThrow('cancelled')
    expect(startupSignal?.aborted).toBe(true)
    await vi.waitFor(() => { expect(runtime.getSnapshot()).toEqual({ status: 'idle' }) })
  })

  it('disposes a server that becomes ready after startup cancellation', async () => {
    const dispose = vi.fn(async () => {})
    let resolveServer: ((server: { origin: string; dispose(): Promise<void> }) => void) | undefined
    const runtime = new TrajectoryViewerRuntime({
      registerSession,
      startServer: () => new Promise(resolve => { resolveServer = resolve }),
      openBrowser: vi.fn(),
    })
    const controller = new AbortController()
    const opening = runtime.open(session, controller.signal)
    controller.abort(new Error('cancelled'))
    resolveServer?.({ origin: 'http://127.0.0.1:9', dispose })

    await expect(opening).rejects.toThrow('cancelled')
    await vi.waitFor(() => { expect(dispose).toHaveBeenCalledTimes(1) })
  })
})
