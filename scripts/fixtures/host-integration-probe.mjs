import { writeFile } from 'node:fs/promises'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'

export const name = 'dsh-console-trajectory-host-integration-probe'
export const inject = ['agents', 'commands', 'sessions', 'sessionQuery', 'appExit']

async function createAgent(ctx, id) {
  return ctx.agents.create({
    sessionId: id,
    meta: { cwd: process.cwd() },
    agentOptions: { provider: 'dsh-console-fake', model: 'alpha' },
    setup(agentCtx) {
      installModelSelection(agentCtx, {
        current: { provider: 'dsh-console-fake', model: 'alpha' },
        assembled: undefined,
      })
    },
  })
}

async function followup(handle, text) {
  handle.agent.followup(createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  }))
  await handle.agent.whenIdle()
}

async function run(ctx) {
  const first = await createAgent(ctx, 'dsh-console-trajectory-first')
  let second
  try {
    await followup(first, 'Create the first trajectory event stream.')
    const execution = await ctx.commands.execute(
      first.agent,
      '/trajectory',
      [],
      AbortSignal.timeout(15_000),
    )
    if (execution?.result.kind !== 'success') throw new Error(`trajectory command failed: ${JSON.stringify(execution)}`)
    const viewerUrl = /https?:\/\/127\.0\.0\.1:\d+\/trajectory\/\S+/u.exec(execution.result.text ?? '')?.[0]
    if (viewerUrl === undefined) throw new Error('trajectory command did not return a loopback viewer URL')
    const origin = new URL(viewerUrl).origin
    const frontendStatus = await fetch(viewerUrl).then(response => response.status)
    const initial = await fetch(`${origin}/api/sessions`).then(response => response.json())
    const initialSnapshotStatus = await fetch(`${origin}/api/sessions/${first.agent.session.id}`).then(response => response.status)

    const after = first.agent.session.events.at(-1)?.seq ?? -1
    const stream = await fetch(`${origin}/api/sessions/${first.agent.session.id}/events?after=${after}`)
    const reader = stream.body?.getReader()
    if (reader === undefined) throw new Error('trajectory event stream has no response body')
    await followup(first, 'Stream a live trajectory update.')
    const liveChunk = await reader.read()
    await reader.cancel()
    const liveText = new TextDecoder().decode(liveChunk.value)

    await ctx.sessions.flush(first.agent.session)
    await first.dispose()
    second = await createAgent(ctx, 'dsh-console-trajectory-second')
    await followup(second, 'Switch the viewer to a second session.')
    const switched = await ctx.commands.execute(
      second.agent,
      '/trajectory',
      [],
      AbortSignal.timeout(15_000),
    )
    if (switched?.result.kind !== 'success') throw new Error('trajectory command failed for the second Session')
    const sessions = await fetch(`${origin}/api/sessions`).then(response => response.json())
    const historyStatus = await fetch(`${origin}/api/sessions/${first.agent.session.id}`).then(response => response.status)
    const missingStatus = await fetch(`${origin}/api/sessions/dsh-console-missing`).then(response => response.status)

    await writeFile(process.env.DSH_TRAJECTORY_INTEGRATION_RESULT, JSON.stringify({
      frontendStatus,
      historyStatus,
      initialSnapshotStatus,
      initialSessions: initial.sessions,
      liveEvent: liveText.includes('session-event'),
      missingStatus,
      sessions: sessions.sessions,
      viewerUrl,
    }))
  } finally {
    await second?.dispose()
    await first.dispose()
  }
  ctx.appExit(0)
}

export function apply(ctx) {
  void run(ctx).catch(error => {
    process.stderr.write(`trajectory host integration probe: ${String(error)}\n`)
    ctx.appExit?.(1)
  })
}
