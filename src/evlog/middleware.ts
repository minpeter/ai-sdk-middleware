// biome-ignore-all lint: MIT port of HugoRCD/evlog/src/ai — keep upstream-compatible behavior
// biome-ignore-all assist: MIT port of HugoRCD/evlog/src/ai — keep upstream-compatible behavior
// biome-ignore-all format: MIT port of HugoRCD/evlog/src/ai — keep upstream-compatible behavior
import type { LanguageModelV4Middleware, LanguageModelV4StreamPart } from '@ai-sdk/provider'
import type { RequestLogger } from 'evlog'
import {
  addUsage,
  createAccumulatorState,
  extractTextOutput,
  flushState,
  formatTelemetryError,
  processToolInput,
  recordCostUsage,
  recordError,
  recordModel,
  safeParseJSON,
} from './state'
import type { AccumulatorState, AILoggerOptions, UsageAccumulator } from './types'

export function buildMiddleware(
  log: RequestLogger,
  options?: AILoggerOptions,
): LanguageModelV4Middleware {
  const state = createAccumulatorState(options)
  state._log = log
  return buildMiddlewareFromState(log, state)
}

export function buildMiddlewareFromState(
  log: RequestLogger,
  state: AccumulatorState,
): LanguageModelV4Middleware {
  return {
    specificationVersion: 'v4',

    wrapGenerate: async ({ doGenerate, model }) => {
      try {
        const result = await doGenerate()

        state.calls++
        state.steps++
        addUsage(state.usage, result.usage)
        const resolvedModel = recordModel(
          state,
          model.provider,
          model.modelId,
          result.response?.modelId,
        )
        recordCostUsage(
          state,
          resolvedModel.model,
          result.usage.inputTokens.total ?? 0,
          result.usage.outputTokens.total ?? 0,
        )
        state.lastFinishReason = result.finishReason.unified
        if (result.response?.id) state.lastResponseId = result.response.id

        const textOutput = extractTextOutput(result.content)
        if (textOutput !== undefined) state.lastOutput = textOutput

        const stepToolCalls: string[] = []
        for (const item of result.content) {
          if (item.type !== 'tool-call') continue
          state.allToolCalls.push(item.toolName)
          stepToolCalls.push(item.toolName)
          if (state.toolInputs) {
            const raw = typeof item.input === 'string' ? safeParseJSON(item.input) : item.input
            state.allToolCallInputs.push({
              name: item.toolName,
              input: processToolInput(raw, item.toolName, state.toolInputsOptions),
            })
          }
        }

        state.stepsUsage.push({
          model: resolvedModel.model,
          inputTokens: result.usage.inputTokens.total ?? 0,
          outputTokens: result.usage.outputTokens.total ?? 0,
          ...(stepToolCalls.length > 0 ? { toolCalls: stepToolCalls } : {}),
        })

        flushState(log, state)
        return result
      } catch (error) {
        recordError(log, state, model, error)
        throw error
      }
    },

    wrapStream: async ({ doStream, model }) => {
      const streamStart = Date.now()
      let firstChunkTime: number | undefined
      let streamUsage: UsageAccumulator | undefined
      let streamFinishReason: string | undefined
      let streamModelId: string | undefined
      let streamResponseId: string | undefined
      const streamToolCalls: string[] = []
      const streamToolInputBuffers = new Map<string, { name: string, chunks: string[] }>()
      let streamError: string | undefined
      const streamTextChunks: string[] = []

      let doStreamResult: Awaited<ReturnType<typeof doStream>>
      try {
        doStreamResult = await doStream()
      } catch (error) {
        recordError(log, state, model, error)
        throw error
      }

      const { stream, ...rest } = doStreamResult
      let finalized = false

      const finalizeStream = (finishReason?: string, error?: unknown): void => {
        if (finalized) return
        finalized = true

        state.calls++
        state.steps++
        if (streamUsage) {
          state.usage.inputTokens += streamUsage.inputTokens
          state.usage.outputTokens += streamUsage.outputTokens
          state.usage.cacheReadTokens += streamUsage.cacheReadTokens
          state.usage.cacheWriteTokens += streamUsage.cacheWriteTokens
          state.usage.reasoningTokens += streamUsage.reasoningTokens
        }

        const resolvedModel = recordModel(
          state,
          model.provider,
          model.modelId,
          streamModelId,
        )
        recordCostUsage(
          state,
          resolvedModel.model,
          streamUsage?.inputTokens ?? 0,
          streamUsage?.outputTokens ?? 0,
        )
        state.lastFinishReason = finishReason ?? streamFinishReason
        state.allToolCalls.push(...streamToolCalls)
        if (streamResponseId) state.lastResponseId = streamResponseId

        state.lastMsToFirstChunk = firstChunkTime === undefined
          ? undefined
          : firstChunkTime - streamStart
        state.lastMsToFinish = Date.now() - streamStart

        if (error !== undefined) state.lastError = formatTelemetryError(error)
        else if (streamError) state.lastError = streamError
        if (streamTextChunks.length > 0) state.lastOutput = streamTextChunks.join('')

        state.stepsUsage.push({
          model: resolvedModel.model,
          inputTokens: streamUsage?.inputTokens ?? 0,
          outputTokens: streamUsage?.outputTokens ?? 0,
          ...(streamToolCalls.length > 0 ? { toolCalls: [...streamToolCalls] } : {}),
        })
        flushState(log, state)
      }

      const transformStream = new TransformStream<LanguageModelV4StreamPart, LanguageModelV4StreamPart>({
        transform(chunk, controller) {
          if (firstChunkTime === undefined && chunk.type === 'text-delta') {
            firstChunkTime = Date.now()
          }

          if (chunk.type === 'text-delta') streamTextChunks.push(chunk.delta)

          if (chunk.type === 'tool-input-start') {
            streamToolCalls.push(chunk.toolName)
            if (state.toolInputs) {
              streamToolInputBuffers.set(chunk.id, { name: chunk.toolName, chunks: [] })
            }
          }

          if (chunk.type === 'tool-input-delta' && state.toolInputs) {
            streamToolInputBuffers.get(chunk.id)?.chunks.push(chunk.delta)
          }

          if (chunk.type === 'tool-input-end' && state.toolInputs) {
            const buffer = streamToolInputBuffers.get(chunk.id)
            if (buffer) {
              const raw = safeParseJSON(buffer.chunks.join(''))
              state.allToolCallInputs.push({
                name: buffer.name,
                input: processToolInput(raw, buffer.name, state.toolInputsOptions),
              })
              streamToolInputBuffers.delete(chunk.id)
            }
          }

          if (chunk.type === 'finish') {
            streamUsage = {
              inputTokens: chunk.usage.inputTokens.total ?? 0,
              outputTokens: chunk.usage.outputTokens.total ?? 0,
              cacheReadTokens: chunk.usage.inputTokens.cacheRead ?? 0,
              cacheWriteTokens: chunk.usage.inputTokens.cacheWrite ?? 0,
              reasoningTokens: chunk.usage.outputTokens.reasoning ?? 0,
            }
            streamFinishReason = chunk.finishReason.unified
          }

          if (chunk.type === 'response-metadata') {
            if (chunk.modelId) streamModelId = chunk.modelId
            if (chunk.id) streamResponseId = chunk.id
          }

          if (chunk.type === 'error') {
            streamError = formatTelemetryError(chunk.error)
          }
          controller.enqueue(chunk)
        },

        flush() {
          finalizeStream()
        },
      })

      const reader = stream.pipeThrough(transformStream).getReader()
      const observedStream = new ReadableStream<LanguageModelV4StreamPart>({
        async pull(controller) {
          try {
            const { done, value } = await reader.read()
            if (done) controller.close()
            else controller.enqueue(value)
          } catch (error) {
            finalizeStream('error', error)
            controller.error(error)
          }
        },
        async cancel(reason) {
          finalizeStream('abort', reason)
          await reader.cancel(reason)
        },
      })

      return { stream: observedStream, ...rest }
    },
  }
}
