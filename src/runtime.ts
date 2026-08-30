import type { Session } from '@deepseek-ai/dsh-session'

export interface ViewerServerHandle {
  readonly origin: string
  dispose(): Promise<void>
}

export interface ViewerOpenResult {
  readonly url: string
  readonly opened: boolean
}

export type TrajectoryViewerSnapshot =
  | { readonly status: 'idle' }
  | { readonly status: 'starting' }
  | { readonly status: 'ready'; readonly origin: string }
  | { readonly status: 'failed'; readonly message: string }

export interface TrajectoryViewerSeams {
  registerSession(session: Session): void
  startServer(signal: AbortSignal): Promise<ViewerServerHandle>
  openBrowser(url: string, signal: AbortSignal): Promise<void>
}

function abortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason
  return new Error(typeof signal.reason === 'string' ? signal.reason : 'trajectory viewer request aborted')
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError(signal)
}

function safeMessage(error: unknown): string {
  return error instanceof Error && error.name === 'AbortError'
    ? 'Trajectory Viewer startup was cancelled.'
    : 'Trajectory Viewer failed to start.'
}

function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError(signal))
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      signal.removeEventListener('abort', onAbort)
      reject(abortError(signal))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      value => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}

export class TrajectoryViewerRuntime {
  private snapshot: TrajectoryViewerSnapshot = Object.freeze({ status: 'idle' })
  private readonly listeners = new Set<() => void>()
  private server: ViewerServerHandle | undefined
  private starting: Promise<ViewerServerHandle> | undefined
  private startingController: AbortController | undefined
  private startingWaiters = 0
  private disposed = false

  constructor(private readonly seams: TrajectoryViewerSeams) {}

  getSnapshot = (): TrajectoryViewerSnapshot => this.snapshot

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  async open(session: Session, signal: AbortSignal): Promise<ViewerOpenResult> {
    if (this.disposed) throw new Error('Trajectory Viewer has been disposed.')
    throwIfAborted(signal)
    this.seams.registerSession(session)
    const server = await this.ensureServer(signal)
    throwIfAborted(signal)
    const url = new URL(`/trajectory/${encodeURIComponent(session.id)}`, `${server.origin}/`).href
    try {
      await this.seams.openBrowser(url, signal)
      return Object.freeze({ url, opened: true })
    } catch (error) {
      throwIfAborted(signal)
      return Object.freeze({ url, opened: false })
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    this.startingController?.abort(new Error('Trajectory Viewer disposed during startup.'))
    const starting = this.starting
    this.starting = undefined
    let server = this.server
    this.server = undefined
    if (server === undefined && starting !== undefined) {
      try {
        server = await starting
      } catch {}
    }
    await server?.dispose()
    this.update(Object.freeze({ status: 'idle' }))
    this.listeners.clear()
  }

  private async ensureServer(signal: AbortSignal): Promise<ViewerServerHandle> {
    if (this.server !== undefined) return this.server
    if (this.starting === undefined) {
      this.update(Object.freeze({ status: 'starting' }))
      const controller = new AbortController()
      this.startingController = controller
      const starting = this.seams.startServer(controller.signal).then(
        async (server) => {
          if (this.disposed || controller.signal.aborted) {
            await server.dispose()
            throw abortError(controller.signal)
          }
          this.server = server
          this.starting = undefined
          this.startingController = undefined
          this.update(Object.freeze({ status: 'ready', origin: server.origin }))
          return server
        },
        (error: unknown) => {
          this.starting = undefined
          this.startingController = undefined
          this.update(controller.signal.aborted
            ? Object.freeze({ status: 'idle' })
            : Object.freeze({ status: 'failed', message: safeMessage(error) }))
          throw error
        },
      )
      this.starting = starting
      void starting.catch(() => {})
    }
    const starting = this.starting
    this.startingWaiters += 1
    try {
      const server = await withAbort(starting, signal)
      throwIfAborted(signal)
      return server
    } finally {
      this.startingWaiters -= 1
      if (this.startingWaiters === 0 && this.server === undefined && this.starting === starting) {
        this.startingController?.abort(new Error('Trajectory Viewer startup was cancelled.'))
      }
    }
  }

  private update(snapshot: TrajectoryViewerSnapshot): void {
    this.snapshot = snapshot
    for (const listener of this.listeners) listener()
  }
}
