import { useCallback, useEffect, useMemo, useState } from 'react'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { projectDshSession, type DshSessionWireSnapshot } from '../formats/dsh-session.js'
import { TrajectoryPanel } from '../viewer/TrajectoryPanel.js'
import css from './app.module.css'

interface ViewerSessionSnapshot extends DshSessionWireSnapshot {
  readonly current: boolean
  readonly live: boolean
}

interface ViewerSessionSummary {
  readonly id: string
  readonly title?: string
  readonly createdAt: string
  readonly current: boolean
  readonly live: boolean
  readonly persisted: boolean
}

function pathSessionId(): string | undefined {
  const match = /^\/trajectory\/([^/]+)\/?$/.exec(window.location.pathname)
  if (match?.[1] === undefined) return undefined
  try { return decodeURIComponent(match[1]) } catch { return undefined }
}

function appendEvent(events: readonly SessionEvent[], event: SessionEvent): readonly SessionEvent[] {
  if (events.some(entry => entry.seq === event.seq)) return events
  return [...events, event].sort((a, b) => a.seq - b.seq)
}

function shortId(id: string): string {
  const value = id.startsWith('dsh-console-') ? id.slice('dsh-console-'.length) : id
  return value.slice(0, 8)
}

function formatCreatedAt(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.valueOf())
    ? value
    : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

export function App() {
  const [sessionId, setSessionId] = useState(pathSessionId)
  const [sessions, setSessions] = useState<readonly ViewerSessionSummary[]>([])
  const [sessionFilter, setSessionFilter] = useState('')
  const [listError, setListError] = useState<string | null>(null)
  const [snapshot, setSnapshot] = useState<ViewerSessionSnapshot | null>(null)
  const [error, setError] = useState<string | null>(sessionId === undefined ? 'Invalid Session URL.' : null)
  const [connected, setConnected] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const loadSessions = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch('/api/sessions', {
        cache: 'no-store',
        ...(signal === undefined ? {} : { signal }),
      })
      if (!response.ok) throw new Error('Sessions could not be loaded.')
      const value = await response.json() as { sessions: ViewerSessionSummary[] }
      if (signal?.aborted) return
      setSessions(value.sessions)
      setListError(null)
    } catch (reason) {
      if (!signal?.aborted) setListError(reason instanceof Error ? reason.message : 'Sessions could not be loaded.')
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void loadSessions(controller.signal)
    const timer = window.setInterval(() => { void loadSessions(controller.signal) }, 15_000)
    return () => { controller.abort(); window.clearInterval(timer) }
  }, [loadSessions])

  useEffect(() => {
    const listener = (): void => { setSessionId(pathSessionId()) }
    window.addEventListener('popstate', listener)
    return () => { window.removeEventListener('popstate', listener) }
  }, [])

  useEffect(() => {
    setSnapshot(null)
    setConnected(false)
    setError(sessionId === undefined ? 'Invalid Session URL.' : null)
    if (sessionId === undefined) return
    const controller = new AbortController()
    let source: EventSource | undefined
    void fetch(`/api/sessions/${encodeURIComponent(sessionId)}`, {
      signal: controller.signal,
      cache: 'no-store',
    }).then(async response => {
      if (!response.ok) throw new Error(response.status === 404 ? 'This Session is no longer available.' : 'The Session could not be loaded.')
      const next = await response.json() as ViewerSessionSnapshot
      if (controller.signal.aborted) return
      setSnapshot(next)
      setError(null)
      if (!next.live) return
      const after = next.events.at(-1)?.seq ?? -1
      source = new EventSource(`/api/sessions/${encodeURIComponent(sessionId)}/events?after=${after}`)
      source.onopen = () => { setConnected(true); setError(null) }
      source.addEventListener('session-event', message => {
        const event = JSON.parse((message as MessageEvent<string>).data) as SessionEvent
        setSnapshot(current => current === null
          ? current
          : { ...current, events: appendEvent(current.events, event) })
      })
      source.onerror = () => {
        setConnected(false)
        if (!controller.signal.aborted) setError('Live updates disconnected. Reload to reconnect.')
      }
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'The Session could not be loaded.')
    })
    return () => { controller.abort(); source?.close() }
  }, [sessionId])

  const selectSession = (id: string): void => {
    if (id !== sessionId) {
      window.history.pushState(null, '', `/trajectory/${encodeURIComponent(id)}`)
      setSessionId(id)
    }
    setSidebarOpen(false)
  }

  const projection = useMemo(
    () => snapshot === null ? null : projectDshSession(snapshot.events),
    [snapshot],
  )
  const filteredSessions = useMemo(() => {
    const filter = sessionFilter.trim().toLocaleLowerCase()
    if (filter === '') return sessions
    return sessions.filter(session =>
      session.id.toLocaleLowerCase().includes(filter) ||
      session.title?.toLocaleLowerCase().includes(filter),
    )
  }, [sessionFilter, sessions])
  const connectionLabel = snapshot?.live ? (connected ? 'LIVE' : 'CONNECTING') : 'HISTORY'

  return (
    <main className={css.app}>
      <header className={css.header}>
        <div className={css.identity}>
          <button className={css.sessionToggle} type="button" onClick={() => { setSidebarOpen(open => !open) }}>Sessions</button>
          <strong>DSH Console</strong>
          <span className={css.separator}>/</span>
          <span className={css.surface}>Trajectory</span>
          <span className={css.badge}>READ ONLY</span>
        </div>
        <div className={css.sessionMeta}>
          <span className={snapshot?.live && connected ? css.live : css.connecting}>
            <span className={css.statusDot} />
            {connectionLabel}
          </span>
          <span className={css.sessionLabel}>Session</span>
          <code className={css.sessionId} title={sessionId}>{sessionId ?? 'Unavailable'}</code>
        </div>
      </header>
      <div className={css.workspace}>
        {sidebarOpen && <button className={css.backdrop} type="button" aria-label="Close Sessions" onClick={() => { setSidebarOpen(false) }} />}
        <aside className={`${css.sidebar} ${sidebarOpen ? css.sidebarOpen : ''}`} aria-label="Sessions">
          <div className={css.sidebarHeader}>
            <div><strong>Sessions</strong><span>{sessions.length} in this workspace</span></div>
            <button type="button" onClick={() => { void loadSessions() }}>Refresh</button>
          </div>
          <div className={css.sessionSearch}>
            <input
              type="search"
              value={sessionFilter}
              onChange={event => { setSessionFilter(event.target.value) }}
              placeholder="Filter sessions"
              aria-label="Filter Sessions"
            />
          </div>
          {listError !== null && <p className={css.sidebarError}>{listError}</p>}
          <nav className={css.sessionList}>
            {filteredSessions.map(session => (
              <button
                className={`${css.sessionItem} ${session.id === sessionId ? css.sessionItemSelected : ''}`}
                type="button"
                key={session.id}
                onClick={() => { selectSession(session.id) }}
              >
                <span className={css.sessionTitle}>{session.title ?? `Session ${shortId(session.id)}`}</span>
                <span className={css.sessionDetails}>
                  <span>{formatCreatedAt(session.createdAt)}</span>
                  {session.current && <span className={css.current}>Current</span>}
                </span>
                <code>{shortId(session.id)}</code>
              </button>
            ))}
            {filteredSessions.length === 0 && listError === null && (
              <p className={css.emptyList}>{sessions.length === 0 ? 'No Sessions are available yet.' : 'No Sessions match this filter.'}</p>
            )}
          </nav>
        </aside>
        <section className={css.content}>
          {error !== null && snapshot !== null && <div className={css.warning}>{error}</div>}
          {error !== null && snapshot === null
            ? <div className={css.state}><h1>Trajectory Viewer</h1><p>{error}</p></div>
            : snapshot === null || projection === null
              ? <div className={css.state}><p>Loading trajectory...</p></div>
              : projection.nodes.length === 0 && projection.requests.length === 0
                ? <div className={css.state}><p>This Session has no trajectory events yet.</p></div>
                : <div className={css.viewer}><TrajectoryPanel nodes={projection.nodes} requests={projection.requests} /></div>}
        </section>
      </div>
    </main>
  )
}
