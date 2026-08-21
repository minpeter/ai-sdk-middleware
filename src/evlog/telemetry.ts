// biome-ignore-all lint: MIT port of HugoRCD/evlog/src/ai — keep upstream-compatible behavior
// biome-ignore-all assist: MIT port of HugoRCD/evlog/src/ai — keep upstream-compatible behavior
// biome-ignore-all format: MIT port of HugoRCD/evlog/src/ai — keep upstream-compatible behavior
import * as aiModule from 'ai'
import type { RequestLogger } from 'evlog'
import {
  createAccumulatorState,
  flushState,
  formatTelemetryError,
  recordCostUsage,
} from './state'
import type {
  AccumulatorState,
  AILogger,
  AILoggerOptions,
  AIToolExecution,
  EvlogTelemetry,
} from './types'

interface EvlogTelemetryIntegration extends EvlogTelemetry {}

interface V6ToolCallFinishEvent {
  toolCall: { toolName: string }
  durationMs: number
  success: boolean
  error?: unknown
}

interface V7ToolExecutionEndEvent {
  toolCall: { toolName: string }
  toolExecutionMs: number
  toolOutput: { type: 'tool-result', output?: unknown } | { type: 'tool-error', error: unknown }
}

interface V7EmbedEndEvent {
  modelId: string
  usage: { tokens: number }
  embeddings: Array<{ length?: number }>
  values: string[]
}

const { bindTelemetryIntegration } = aiModule as {
  bindTelemetryIntegration?: (integration: EvlogTelemetryIntegration) => EvlogTelemetry
}

function recordToolExecution(
  state: AccumulatorState,
  input: { name: string, durationMs: number, success: boolean, error?: string },
): void {
  const execution: AIToolExecution = {
    name: input.name,
    durationMs: input.durationMs,
    success: input.success,
  }
  if (input.error) execution.error = input.error
  state.toolExecutions.push(execution)
}

function adaptV6ToolEvent(event: V6ToolCallFinishEvent) {
  return {
    name: event.toolCall.toolName,
    durationMs: event.durationMs,
    success: event.success,
    error: !event.success && event.error !== undefined
      ? formatTelemetryError(event.error)
      : undefined,
  }
}

function adaptV7ToolEvent(event: V7ToolExecutionEndEvent) {
  const success = event.toolOutput.type === 'tool-result'
  return {
    name: event.toolCall.toolName,
    durationMs: event.toolExecutionMs,
    success,
    error: !success && event.toolOutput.type === 'tool-error'
      ? formatTelemetryError(event.toolOutput.error)
      : undefined,
  }
}

function recordGenerationEnd(state: AccumulatorState, log: RequestLogger): void {
  if (state.generationStartTime !== undefined) {
    state.totalDurationMs = Date.now() - state.generationStartTime
  }
  flushState(log, state)
}

function recordEmbedEnd(
  state: AccumulatorState,
  log: RequestLogger,
  event: V7EmbedEndEvent,
): void {
  state.calls++
  state.usage.inputTokens += event.usage.tokens
  recordCostUsage(state, event.modelId, event.usage.tokens, 0)
  const dimensions = event.embeddings[0]?.length
  state.embedding = {
    tokens: (state.embedding?.tokens ?? 0) + event.usage.tokens,
    model: event.modelId,
    ...(dimensions !== undefined
      ? { dimensions }
      : state.embedding?.dimensions
        ? { dimensions: state.embedding.dimensions }
        : {}),
    count: (state.embedding?.count ?? 0) + event.values.length,
  }
  flushState(log, state)
}

function finalizeIntegration(integration: EvlogTelemetryIntegration): EvlogTelemetry {
  if (typeof bindTelemetryIntegration === 'function') {
    return bindTelemetryIntegration(integration)
  }
  return integration
}

/**
 * Create telemetry hooks for tool timing, generation duration, embeddings,
 * aborts, and errors. An `AILogger` shares its middleware accumulator.
 */
export function createEvlogIntegration(
  logOrAi: RequestLogger | AILogger,
  options?: AILoggerOptions,
): EvlogTelemetry {
  let log: RequestLogger
  let state: AccumulatorState

  if ('_state' in logOrAi && logOrAi._state) {
    state = logOrAi._state
    log = state._log!
  } else {
    log = logOrAi as RequestLogger
    state = createAccumulatorState(options)
    state._log = log
  }

  class EvlogIntegration implements EvlogTelemetryIntegration {
    onStart(_event: unknown) {
      state.generationStartTime = Date.now()
    }

    onToolCallFinish(event: unknown) {
      recordToolExecution(state, adaptV6ToolEvent(event as V6ToolCallFinishEvent))
    }

    onToolExecutionEnd(event: unknown) {
      recordToolExecution(state, adaptV7ToolEvent(event as V7ToolExecutionEndEvent))
    }

    onFinish(_event: unknown) {
      recordGenerationEnd(state, log)
    }

    onEnd(_event: unknown) {
      recordGenerationEnd(state, log)
    }

    onEmbedEnd(event: unknown) {
      recordEmbedEnd(state, log, event as V7EmbedEndEvent)
    }

    onAbort(event: unknown) {
      state.lastFinishReason = 'abort'
      const { reason } = event as { reason?: unknown }
      if (reason !== undefined) state.lastError = formatTelemetryError(reason)
      recordGenerationEnd(state, log)
    }

    onError(error: unknown) {
      state.lastError = formatTelemetryError(error)
      flushState(log, state)
    }
  }

  return finalizeIntegration(new EvlogIntegration())
}
