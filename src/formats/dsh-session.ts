import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session/types'
import type {
  AssistantBlock,
  AssistantRequestConfig,
  ContentBlock,
  ConversationNode,
  ConversationPromptSnapshot,
  RequestPromptChange,
  RequestView,
  ToolSchema,
} from '../shims/runtime.js'

export interface DshSessionWireSnapshot {
  readonly header: SessionHeader
  readonly events: readonly SessionEvent[]
}

export interface ProjectedTrajectory {
  readonly nodes: readonly ConversationNode[]
  readonly requests: readonly RequestView[]
}

interface PartialStep {
  readonly turn: number
  readonly step: number
  readonly seq: number
  readonly time: number
  readonly blocks: Map<number, AssistantBlock>
}

export function projectDshSession(events: readonly SessionEvent[]): ProjectedTrajectory {
  const nodes: ConversationNode[] = []
  const requests: RequestView[] = []
  const callHeads = new Map<string, { name: string; argsRaw: string; time: number }>()
  const stepStarts = new Map<string, { seq: number; time: number }>()
  const partials = new Map<string, PartialStep>()
  const finalized = new Set<string>()
  let pendingHeader: { change: RequestPromptChange | null; prompt: ConversationPromptSnapshot } | null = null
  let lastPrompt: ConversationPromptSnapshot | null = null

  for (const event of events) {
    switch (event.type) {
      case 'step/start':
        stepStarts.set(stepKey(event.data.turn, event.data.step), { seq: event.seq, time: event.time })
        break
      case 'user/message': {
        const source = event.data.source
        const base = { seq: event.seq, time: event.time, content: contentOf(event.data.content), source }
        nodes.push(source?.kind === 'user'
          ? { kind: 'user', ...base }
          : { kind: 'context', ...base, provenance: source, form: null })
        break
      }
      case 'assistant/chunk': {
        const key = stepKey(event.data.turn, event.data.step)
        let partial = partials.get(key)
        if (partial === undefined) {
          partial = { turn: event.data.turn, step: event.data.step, seq: event.seq, time: event.time, blocks: new Map() }
          partials.set(key, partial)
        }
        const chunk = event.data.chunk
        if (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta') {
          const previous = partial.blocks.get(chunk.index)
          const kind = chunk.type === 'text-delta' ? 'text' : 'reasoning'
          const text = previous?.kind === kind ? previous.text + chunk.text : chunk.text
          partial.blocks.set(chunk.index, { kind, text })
        } else if (chunk.type === 'block-end') {
          partial.blocks.set(chunk.index, toAssistantBlock(chunk.block))
        }
        break
      }
      case 'assistant/message': {
        const { turn, step, message, usage } = event.data
        const key = stepKey(turn, step)
        const start = stepStarts.get(key)
        const provenance = message.source?.kind === 'model'
          ? { provider: message.source.provider, model: message.source.model }
          : undefined
        nodes.push({
          kind: 'assistant', seq: event.seq, time: event.time, turn, step,
          messageId: message.id, blocks: message.content.map(toAssistantBlock),
          ...(usage === undefined ? {} : { usage }),
          ...(provenance === undefined ? {} : { provenance }),
          ...(event.data.interrupted === true ? { interrupted: true as const } : {}),
          timing: { stepStartTime: start?.time ?? null, firstTokenTime: partials.get(key)?.time ?? null, completedTime: event.time },
        })
        requests.push({
          purpose: 'assistant', turn, step, startSeq: start?.seq ?? event.seq,
          startedAt: start?.time ?? event.time, completedAt: event.time, status: 'complete',
          ...(usage === undefined ? {} : { usage }),
          ...(provenance === undefined ? {} : { provenance }),
          ...(pendingHeader === null ? {} : {
            prompt: pendingHeader.prompt,
            ...(pendingHeader.change === null ? {} : { promptChange: pendingHeader.change }),
          }),
        })
        pendingHeader = null
        finalized.add(key)
        break
      }
      case 'tool/call':
        callHeads.set(event.data.callId, { name: event.data.name, argsRaw: event.data.arguments, time: event.time })
        break
      case 'tool/result': {
        const block = event.data.message.content.find(entry => entry.type === 'tool-result')
        if (block?.type !== 'tool-result') break
        const head = callHeads.get(block.toolCallId)
        nodes.push({
          kind: 'tool-result', seq: event.seq, time: event.time, callId: block.toolCallId,
          call: head === undefined ? null : { name: head.name, argsRaw: head.argsRaw },
          callTime: head?.time ?? null, content: contentOf(block.content),
          isError: block.isError === true || event.data.error !== undefined,
          ...(event.data.error === undefined ? {} : { error: event.data.error }),
          ...(event.data.meta === undefined ? {} : { meta: event.data.meta }),
          callView: null, resultView: null, subCalls: [],
        })
        break
      }
      case 'request/header': {
        const header = event.data.header
        const prompt: ConversationPromptSnapshot = {
          config: adaptConfig(header.config),
          system: header.system ?? '',
          tools: header.tools as readonly ToolSchema[],
        }
        const kind = promptChangeKind(lastPrompt, prompt)
        pendingHeader = {
          change: kind === null ? null : { seq: event.seq, time: event.time, kind, ...(lastPrompt === null ? {} : { previous: lastPrompt }) },
          prompt,
        }
        lastPrompt = prompt
        break
      }
      case 'turn/end': {
        if (event.data.reason.kind !== 'error') break
        for (let index = requests.length - 1; index >= 0; index -= 1) {
          const request = requests[index]
          if (request?.purpose === 'assistant' && request.turn === event.data.turn) {
            requests[index] = { ...request, status: 'error', error: event.data.reason.error.message, completedAt: event.time }
            break
          }
        }
        break
      }
      default:
        break
    }
  }

  for (const [key, partial] of partials) {
    if (finalized.has(key) || partial.blocks.size === 0) continue
    const start = stepStarts.get(key)
    nodes.push({
      kind: 'assistant', seq: partial.seq, time: partial.time, turn: partial.turn, step: partial.step,
      messageId: `partial-${partial.turn}-${partial.step}`,
      blocks: [...partial.blocks.entries()].sort(([a], [b]) => a - b).map(([, block]) => block),
      timing: { stepStartTime: start?.time ?? null, firstTokenTime: partial.time, completedTime: partial.time },
    })
    requests.push({
      purpose: 'assistant', turn: partial.turn, step: partial.step,
      startSeq: start?.seq ?? partial.seq, startedAt: start?.time ?? partial.time,
      completedAt: null, status: 'running',
      ...(pendingHeader === null ? {} : { prompt: pendingHeader.prompt }),
    })
  }

  return { nodes, requests }
}

function stepKey(turn: number, step: number): string { return `${turn}\u0000${step}` }

function contentOf(input: readonly { type: string }[]): ContentBlock[] {
  return input.map(block => {
    const value = block as unknown as Record<string, unknown>
    if (block.type === 'text' || block.type === 'reasoning') return { type: block.type, text: typeof value.text === 'string' ? value.text : '' }
    if (block.type === 'tool-call') return {
      type: 'tool-call', id: String(value.id ?? ''), name: String(value.name ?? ''), arguments: String(value.arguments ?? ''),
    }
    return { type: block.type, ...(typeof value.text === 'string' ? { text: value.text } : {}) }
  })
}

function toAssistantBlock(block: { type: string }): AssistantBlock {
  const value = block as unknown as Record<string, unknown>
  switch (block.type) {
    case 'text': return { kind: 'text', text: String(value.text ?? '') }
    case 'reasoning': return { kind: 'reasoning', text: String(value.text ?? '') }
    case 'image': return { kind: 'image', attachment: value.attachment }
    case 'tool-call': return { kind: 'tool-call', callId: String(value.id ?? ''), name: String(value.name ?? ''), argsRaw: String(value.arguments ?? '') }
    default: return { kind: 'other', block }
  }
}

function adaptConfig(config: { provider: string; model: string }): AssistantRequestConfig {
  const value = config as unknown as Record<string, unknown>
  return {
    provider: config.provider,
    model: config.model,
    ...(typeof value.thinking === 'string' ? { thinking: value.thinking } : {}),
    ...(typeof value.reasoningEffort === 'string' ? { reasoningEffort: value.reasoningEffort } : {}),
    ...(typeof value.temperature === 'number' ? { temperature: value.temperature } : {}),
    ...(typeof value.maxTokens === 'number' ? { maxTokens: value.maxTokens } : {}),
    ...(Array.isArray(value.stop) && value.stop.every(entry => typeof entry === 'string') ? { stop: value.stop } : {}),
  }
}

function promptChangeKind(previous: ConversationPromptSnapshot | null, next: ConversationPromptSnapshot): RequestPromptChange['kind'] | null {
  if (previous === null) return 'initial'
  const systemChanged = previous.system !== next.system
  const toolsChanged = JSON.stringify(previous.tools) !== JSON.stringify(next.tools)
  if (systemChanged && toolsChanged) return 'system-and-tools'
  if (systemChanged) return 'system'
  if (toolsChanged) return 'tools'
  return null
}
