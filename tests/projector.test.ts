import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { describe, expect, it } from 'vitest'
import { projectDshSession } from '../src/formats/dsh-session.js'

function events(input: readonly object[]): readonly SessionEvent[] { return input as readonly SessionEvent[] }

describe('projectDshSession', () => {
  it('projects canonical text, reasoning, request usage, and interruption', () => {
    const result = projectDshSession(events([
      { type: 'step/start', seq: 0, time: 10, data: { turn: 1, step: 1 } },
      { type: 'request/header', seq: 1, time: 11, data: { reason: 'initial', header: { config: { provider: 'p', model: 'm' }, system: 'system', tools: [] } } },
      { type: 'assistant/chunk', seq: 2, time: 12, data: { turn: 1, step: 1, chunk: { type: 'reasoning-delta', index: 0, text: 'think' } } },
      { type: 'assistant/message', seq: 3, time: 20, data: { turn: 1, step: 1, interrupted: true, usage: { inputTokens: 4, outputTokens: 2 }, message: { id: 'a', role: 'assistant', source: { kind: 'model', provider: 'p', model: 'm' }, content: [{ type: 'reasoning', text: 'think' }, { type: 'text', text: 'answer' }] } } },
    ]))
    expect(result.nodes[0]).toMatchObject({ kind: 'assistant', interrupted: true, turn: 1, step: 1 })
    expect(result.requests[0]).toMatchObject({ status: 'complete', promptChange: { kind: 'initial' }, provenance: { provider: 'p', model: 'm' } })
  })

  it('exposes an in-flight chunk without waiting for a final message', () => {
    const result = projectDshSession(events([
      { type: 'step/start', seq: 0, time: 10, data: { turn: 2, step: 1 } },
      { type: 'assistant/chunk', seq: 1, time: 11, data: { turn: 2, step: 1, chunk: { type: 'text-delta', index: 0, text: 'hel' } } },
      { type: 'assistant/chunk', seq: 2, time: 12, data: { turn: 2, step: 1, chunk: { type: 'text-delta', index: 0, text: 'lo' } } },
    ]))
    expect(result.nodes[0]).toMatchObject({ kind: 'assistant', blocks: [{ kind: 'text', text: 'hello' }] })
    expect(result.requests[0]).toMatchObject({ status: 'running', completedAt: null })
  })

  it('projects an in-flight tool call from canonical deltas', () => {
    const result = projectDshSession(events([
      { type: 'step/start', seq: 0, time: 10, data: { turn: 2, step: 1 } },
      { type: 'assistant/chunk', seq: 1, time: 11, data: { turn: 2, step: 1, chunk: { type: 'tool-call-delta', index: 0, id: 'call-1', name: 'read', argumentsDelta: '{"path":' } } },
      { type: 'assistant/chunk', seq: 2, time: 12, data: { turn: 2, step: 1, chunk: { type: 'tool-call-delta', index: 0, id: 'call-1', argumentsDelta: '"README.md"}' } } },
    ]))
    expect(result.nodes[0]).toMatchObject({
      kind: 'assistant',
      blocks: [{ kind: 'tool-call', callId: 'call-1', name: 'read', argsRaw: '{"path":"README.md"}' }],
    })
  })

  it('does not expose provider authentication diagnostics', () => {
    const result = projectDshSession(events([
      { type: 'step/start', seq: 0, time: 10, data: { turn: 1, step: 1 } },
      { type: 'assistant/message', seq: 1, time: 11, data: { turn: 1, step: 1, message: { id: 'a', role: 'assistant', content: [] } } },
      { type: 'turn/end', seq: 2, time: 12, data: { turn: 1, reason: { kind: 'error', error: { code: 'AUTH', message: 'credential fragment' } } } },
    ]))
    expect(result.requests[0]).toMatchObject({ status: 'error', error: 'AUTH' })
  })
})
