// biome-ignore-all lint: MIT port of HugoRCD/evlog/src/ai — keep upstream-compatible behavior
// biome-ignore-all assist: MIT port of HugoRCD/evlog/src/ai — keep upstream-compatible behavior
// biome-ignore-all format: MIT port of HugoRCD/evlog/src/ai — keep upstream-compatible behavior
import type { LanguageModelV4, LanguageModelV4Middleware } from '@ai-sdk/provider'
import { gateway, wrapLanguageModel } from 'ai'
import type { GatewayModelId } from 'ai'
import type { RequestLogger } from 'evlog'
import { buildMiddleware, buildMiddlewareFromState } from './middleware'
import {
  buildMetadata,
  computeEstimatedCost,
  createAccumulatorState,
  flushState,
  recordCostUsage,
} from './state'
import type { AILogger, AILoggerOptions, AIMetadataListener } from './types'

/** Create evlog middleware for explicit composition with other wrappers. */
export function createAIMiddleware(
  log: RequestLogger,
  options?: AILoggerOptions,
): LanguageModelV4Middleware {
  return buildMiddleware(log, options)
}

/** Create an AI logger backed by one request-wide accumulator. */
export function createAILogger(log: RequestLogger, options?: AILoggerOptions): AILogger {
  const state = createAccumulatorState(options)
  state._log = log
  const middleware = buildMiddlewareFromState(log, state)

  return {
    wrap: (model: LanguageModelV4 | GatewayModelId) => {
      const resolved = typeof model === 'string' ? gateway(model) : model
      return wrapLanguageModel({ model: resolved, middleware })
    },

    captureEmbed: result => {
      state.calls++
      state.usage.inputTokens += result.usage.tokens
      recordCostUsage(state, result.model, result.usage.tokens, 0)
      state.embedding = {
        tokens: (state.embedding?.tokens ?? 0) + result.usage.tokens,
        ...(result.model !== undefined
          ? { model: result.model }
          : state.embedding?.model
            ? { model: state.embedding.model }
            : {}),
        ...(result.dimensions !== undefined
          ? { dimensions: result.dimensions }
          : state.embedding?.dimensions
            ? { dimensions: state.embedding.dimensions }
            : {}),
        ...(result.count !== undefined
          ? { count: (state.embedding?.count ?? 0) + result.count }
          : state.embedding?.count
            ? { count: state.embedding.count }
            : {}),
      }
      flushState(log, state)
    },

    getMetadata: () => buildMetadata(state),
    getEstimatedCost: () => computeEstimatedCost(state),

    onUpdate: (callback: AIMetadataListener) => {
      state.subscribers.add(callback)
      return () => {
        state.subscribers.delete(callback)
      }
    },

    _state: state,
  }
}
