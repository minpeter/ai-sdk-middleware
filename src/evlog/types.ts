// biome-ignore-all lint: MIT port of HugoRCD/evlog/src/ai — keep upstream-compatible types
// biome-ignore-all assist: MIT port of HugoRCD/evlog/src/ai — keep upstream-compatible types
// biome-ignore-all format: MIT port of HugoRCD/evlog/src/ai — keep upstream-compatible types
import type { LanguageModelV4 } from '@ai-sdk/provider'
import type { GatewayModelId } from 'ai'
import type { RequestLogger } from 'evlog'

/** Telemetry integration returned by {@link createEvlogIntegration}. */
export type EvlogTelemetry = {
  onStart?: (event: unknown) => void | PromiseLike<void>
  /** AI SDK v6 — superseded by `onToolExecutionEnd` in v7. */
  onToolCallFinish?: (event: unknown) => void | PromiseLike<void>
  onToolExecutionEnd?: (event: unknown) => void | PromiseLike<void>
  /** AI SDK v6 — superseded by `onEnd` in v7. */
  onFinish?: (event: unknown) => void | PromiseLike<void>
  onEnd?: (event: unknown) => void | PromiseLike<void>
  onEmbedEnd?: (event: unknown) => void | PromiseLike<void>
  onAbort?: (event: unknown) => void | PromiseLike<void>
  onError?: (event: unknown) => void | PromiseLike<void>
}

/** Fine-grained control over tool call input capture. */
export interface ToolInputsOptions {
  /** Max character length for the stringified input JSON. */
  maxLength?: number
  /** Transform applied before optional length truncation. */
  transform?: (input: unknown, toolName: string) => unknown
}

/** Cost per 1 million tokens in dollars. */
export interface ModelCost {
  input: number
  output: number
}

/** Options for `createAILogger` and `createAIMiddleware`. */
export interface AILoggerOptions {
  /** Capture tool inputs, optionally transforming or truncating them. */
  toolInputs?: boolean | ToolInputsOptions
  /** Pricing entries keyed by model ID. */
  cost?: Record<string, ModelCost>
}

/** Per-step token usage breakdown for multi-step agent runs. */
export interface AIStepUsage {
  model: string
  inputTokens: number
  outputTokens: number
  toolCalls?: string[]
}

/** Tool execution detail captured via telemetry integration hooks. */
export interface AIToolExecution {
  name: string
  durationMs: number
  success: boolean
  error?: string
}

/** Embedding metadata captured via `captureEmbed`. */
export interface AIEmbeddingData {
  model?: string
  tokens: number
  dimensions?: number
  count?: number
}

/** Shape of the `ai` wide-event field and public metadata snapshot. */
export interface AIEventData {
  calls: number
  model?: string
  models?: string[]
  provider?: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  reasoningTokens?: number
  finishReason?: string
  toolCalls?: string[] | Array<{ name: string, input: unknown }>
  responseId?: string
  steps?: number
  stepsUsage?: AIStepUsage[]
  msToFirstChunk?: number
  msToFinish?: number
  tokensPerSecond?: number
  error?: string
  tools?: AIToolExecution[]
  totalDurationMs?: number
  embedding?: AIEmbeddingData
  estimatedCost?: number
  /** Most recently observed non-empty model text output. */
  output?: string
}

/** Public alias for the snapshot returned by `AILogger.getMetadata()`. */
export type AIMetadata = AIEventData

/** Callback fired whenever accumulated metadata is flushed. */
export type AIMetadataListener = (metadata: AIMetadata) => void

export interface AILogger {
  /** Wrap a LanguageModelV4 object or gateway model ID with evlog middleware. */
  wrap: (model: LanguageModelV4 | GatewayModelId) => LanguageModelV4
  /** Manually capture token usage from `embed()` or `embedMany()`. */
  captureEmbed: (result: {
    usage: { tokens: number }
    model?: string
    dimensions?: number
    count?: number
  }) => void
  /** Return an immutable snapshot of current AI execution metadata. */
  getMetadata: () => AIMetadata
  /** Return the estimated cost in dollars, when all usage can be priced. */
  getEstimatedCost: () => number | undefined
  /** Subscribe to metadata updates and receive an unsubscribe callback. */
  onUpdate: (callback: AIMetadataListener) => () => void
  /** @internal Shared accumulator for `createEvlogIntegration`. */
  _state: AccumulatorState
}

/** @internal */
export interface UsageAccumulator {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  reasoningTokens: number
}

/** @internal */
export interface Watermarks {
  toolCalls: number
  toolCallInputs: number
  stepsUsage: number
  toolExecutions: number
  models: Set<string>
}

/** @internal Shared mutable state; public consumers should use `getMetadata()`. */
export interface AccumulatorState {
  calls: number
  steps: number
  usage: UsageAccumulator
  models: string[]
  lastProvider: string | undefined
  allToolCalls: string[]
  allToolCallInputs: Array<{ name: string, input: unknown }>
  stepsUsage: AIStepUsage[]
  lastFinishReason: string | undefined
  lastMsToFirstChunk: number | undefined
  lastMsToFinish: number | undefined
  lastError: string | undefined
  lastResponseId: string | undefined
  lastOutput: string | undefined
  toolInputs: boolean
  toolInputsOptions: ToolInputsOptions | undefined
  toolExecutions: AIToolExecution[]
  generationStartTime: number | undefined
  totalDurationMs: number | undefined
  embedding: AIEmbeddingData | undefined
  costMap: Record<string, ModelCost> | undefined
  costUsageByModel: Map<string, { inputTokens: number, outputTokens: number }>
  hasUnattributedCostUsage: boolean
  subscribers: Set<AIMetadataListener>
  _flushed: Watermarks
  _log?: RequestLogger
}
