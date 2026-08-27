import { useEffect, useMemo, useState } from 'react'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { projectDshSession, type DshSessionWireSnapshot } from '../formats/dsh-session.js'
import { TrajectoryPanel } from '../viewer/TrajectoryPanel.js'
import css from './app.module.css'

function currentSessionId(): string | undefined {
  const match = /^\/trajectory\/([^/]+)\/?$/.exec(window.location.pathname)
  if (match?.[1] === undefined) return undefined
  try { return decodeURIComponent(match[1]) } catch { return undefined }
}

function appendEvent(events: readonly SessionEvent[], event: SessionEvent): readonly SessionEvent[] {
  if (events.some(entry => entry.seq === event.seq)) return events
  return [...events, event].sort((a, b) => a.seq - b.seq)
}

export function App() {
  const sessionId = currentSessionId()
  const [snapshot, setSnapshot] = useState<DshSessionWireSnapshot | null>(null)
  const [error, setError] = useState<string | null>(sessionId === undefined ? 'Invalid Session URL.' : null)

  useEffect(() => {
    if (sessionId === undefined) return
    const controller = new AbortController()
    let source: EventSource | undefined
    void fetch(`/api/sessions/${encodeURIComponent(sessionId)}`, { signal: controller.signal, cache: 'no-store' }).then(async response => {
      if (!response.ok) throw new Error(response.status === 404 ? 'This Session is no longer available.' : 'The Session could not be loaded.')
      const next = await response.json() as DshSessionWireSnapshot
      if (controller.signal.aborted) return
      setSnapshot(next)
      const after = next.events.at(-1)?.seq ?? -1
      source = new EventSource(`/api/sessions/${encodeURIComponent(sessionId)}/events?after=${after}`)
      source.addEventListener('session-event', message => {
        const event = JSON.parse((message as MessageEvent<string>).data) as SessionEvent
        setSnapshot(current => current === null ? current : { ...current, events: appendEvent(current.events, event) })
      })
      source.onerror = () => { if (!controller.signal.aborted) setError('Live updates disconnected. Reload to reconnect.') }
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'The Session could not be loaded.')
    })
    return () => { controller.abort(); source?.close() }
  }, [sessionId])

  const projection = useMemo(() => snapshot === null ? null : projectDshSession(snapshot.events), [snapshot])
  if (error !== null && snapshot === null) return <main className={css.state}><h1>Trajectory Viewer</h1><p>{error}</p></main>
  if (snapshot === null || projection === null) return <main className={css.state}><p>Loading trajectory...</p></main>
  return (
    <main className={css.app}>
      <header className={css.header}>
        <div><strong>Trajectory Viewer</strong><span className={css.badge}>READ ONLY</span></div>
        <code title={snapshot.header.id}>{snapshot.header.id}</code>
      </header>
      {error !== null && <div className={css.warning}>{error}</div>}
      {projection.nodes.length === 0 && projection.requests.length === 0
        ? <div className={css.state}><p>This Session has no trajectory events yet.</p></div>
        : <section className={css.viewer}><TrajectoryPanel nodes={projection.nodes} requests={projection.requests} /></section>}
    </main>
  )
}
