/**
 * Type-only stand-in for `@deepseek-ai/dsh-client-runtime/client`.
 *
 * Copied and trimmed from deepseek-harness `packages/client/runtime/src/client/`
 * (sessions/conversation.ts, sessions/request-inspection.ts, contract/conversation.ts)
 * so the copied ui-trajectory sources compile unchanged. Brand types widen to
 * string and host-computed view intents widen to unknown; the standalone viewer
 * never produces them.
 * @module shims/runtime
 */

export type SessionId = string

/** Request configuration recorded for one provider call. */
export interface AssistantRequestConfig {
  provider: string
  model: string
  purpose?: string
  thinking?: string
  reasoningEffort?: string
  temperature?: number
  maxTokens?: number
  stop?: readonly string[]
}

/** Stable provider/model identity reported for one completed request. */
export interface AssistantProvenanceView {
  provider: string
  model: string
}

/** Minimal content-block union covering what the trajectory fold inspects. */
export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'tool-call'; id: string; name: string; arguments: string }
  | { type: string; text?: string }

/** Assistant content blocks classified by what the UI renders. */
export type AssistantBlock =
  | { kind: 'text'; text: string }
  | { kind: 'reasoning'; text: string }
  | { kind: 'image'; attachment: unknown }
  | { kind: 'tool-call'; callId: string; name: string; argsRaw: string }
  | { kind: 'other'; block: unknown }

/** A finalized user message. */
export interface UserMessageNode {
  kind: 'user'
  seq: number
  time: number
  content: readonly ContentBlock[]
  source: unknown
}

/** A human message admitted mid-turn. */
export interface SteeringMessageNode {
  kind: 'steering'
  messageId: string
  seq: number
  time: number
  content: readonly ContentBlock[]
  source: unknown
}

/** A context/system injection surfaced in the flow. */
export interface ContextMessageNode {
  kind: 'context'
  seq: number
  time: number
  content: readonly ContentBlock[]
  source: unknown
  provenance: unknown
  form: unknown | null
}

/** Recorded boundaries used to derive assistant latency and throughput. */
export interface AssistantTiming {
  stepStartTime: number | null
  firstTokenTime: number | null
  completedTime: number
}

/** A finalized assistant message. */
export interface AssistantMessageNode {
  kind: 'assistant'
  seq: number
  messageId?: string
  time: number
  turn: number
  step: number
  blocks: readonly AssistantBlock[]
  usage?: unknown
  provenance?: AssistantProvenanceView
  requestConfig?: AssistantRequestConfig
  timing?: AssistantTiming
  interrupted?: true
}

/** A tool result paired (when in-window) with its call head. */
export interface ToolResultNode {
  kind: 'tool-result'
  seq: number
  time: number
  callId: string
  call: { name: string; argsRaw: string } | null
  callTime: number | null
  content: readonly ContentBlock[]
  isError: boolean
  error?: { name: string; code: string }
  meta?: unknown
  callView: unknown | null
  resultView: unknown | null
  subCalls: readonly ToolCallBlock[]
}

/** In-flight tool card material: call seen, result not yet. */
export interface RunningToolCall {
  callId: string
  name: string
  argsRaw: string
  turn: number
  step: number
  time: number
  callView: unknown | null
  subCalls: readonly ToolCallBlock[]
}

/** One running or settled call, recursively owning its child calls. */
export type ToolCallBlock = RunningToolCall | ToolResultNode

/** One landed compaction marker. */
export interface CompactionSummaryNode {
  kind: 'compaction'
  seq: number
  time: number
  summary: string | null
  summaryEventSeq: number | null
  shadowedItemCount: number | null
  shadowedTokenCount: number | null
}

/** Finalized conversation node union (kind discriminates). */
export type ConversationNode =
  | UserMessageNode
  | AssistantMessageNode
  | SteeringMessageNode
  | ContextMessageNode
  | ToolResultNode
  | CompactionSummaryNode

/** In-progress assistant output (chunk accumulator product). */
export interface PartialAssistant {
  turn: number
  step: number
  blocks: readonly AssistantBlock[]
}

/**
 * Snapshot slice consumed by the trajectory fold. The real DSH interface is
 * far wider; the copied layout only indexes `nodes`, `partial`, `runningCalls`.
 */
export interface ConversationSnapshot {
  nodes: readonly ConversationNode[]
  partial: PartialAssistant | null
  runningCalls: readonly RunningToolCall[]
}

/** Engine-owned placement of one matched event in the session hierarchy. */
export type ConversationLocation =
  | { readonly kind: 'session' }
  | { readonly kind: 'turn'; readonly turn: { readonly turn: number } }
  | {
    readonly kind: 'step'
    readonly turn: { readonly turn: number }
    readonly step: { readonly step: number }
  }
  | { readonly kind: 'unresolved' }

/** Tool schema as sent with one request (OpenAI-compatible fields). */
export interface ToolSchema {
  name: string
  description?: string
  parameters: object | unknown[]
}

/** Complete model-visible request header in force for one generation. */
export interface ConversationPromptSnapshot {
  config: AssistantRequestConfig
  system: string
  tools: readonly ToolSchema[]
}

/** System/tool change introduced while preparing one request. */
export interface RequestPromptChange {
  seq: number
  time: number
  kind: 'initial' | 'system' | 'tools' | 'system-and-tools'
  previous?: ConversationPromptSnapshot
}

/** Lifecycle fields shared by ordinary generation and compaction requests. */
interface RequestViewBase {
  startSeq: number
  startedAt: number
  completedAt: number | null
  status: 'running' | 'complete' | 'error'
  error?: string
  provenance?: AssistantProvenanceView
  requestConfig?: AssistantRequestConfig
  usage?: unknown
  resultSeq?: number
}

/** One ordinary assistant generation assembled from durable request events. */
interface AssistantRequestView extends RequestViewBase {
  purpose: 'assistant'
  turn: number
  step: number
  prompt?: ConversationPromptSnapshot
  promptChange?: RequestPromptChange
  retry?: number
  maxRetries?: number
  retryDelayMs?: number
}

/** One compaction provider request. */
interface CompactionRequestView extends RequestViewBase {
  purpose: 'compaction'
  turn: number | null
  step: 0
  replacementSeq?: number
  summary?: readonly ContentBlock[]
  rawOutput?: readonly ContentBlock[]
}

/** One provider request assembled from durable request lifecycle events. */
export type RequestView = AssistantRequestView | CompactionRequestView

/** Request data consumed by the stage-oriented trajectory layout. */
export interface RequestInspectionSnapshot {
  requests: readonly RequestView[]
  callSchemas: ReadonlyMap<string, ToolSchema>
}
