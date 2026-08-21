// biome-ignore-all lint: official evlog test port — keep upstream structure
// biome-ignore-all assist: official evlog test port — keep upstream structure
// biome-ignore-all format: official evlog test port — keep upstream structure

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAILogger, createAIMiddleware, createEvlogIntegration } from '../evlog'
import { defined } from '../test-helpers/defined'
import {
  asGenerateResult,
  callIntegrationOnAbort,
  callIntegrationOnEmbedEnd,
  callIntegrationOnEnd,
  callIntegrationOnError,
  callIntegrationOnFinish,
  callIntegrationOnStart,
  callIntegrationOnToolCallFinish,
  callIntegrationOnToolExecutionEnd,
  createFinishReason,
  createMockCallOptions,
  createMockLogger,
  createMockModel,
  createMockUsage,
  getLastAiData,
} from '../test-helpers/evlog'
import { withFakeTimers } from '../test-helpers/timers'

describe('createAILogger', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('createAIMiddleware', () => {
    it('returns a valid middleware object', () => {
      const log = createMockLogger()
      const middleware = createAIMiddleware(log)

      expect(middleware).toBeDefined()
      expect(middleware.wrapGenerate).toBeTypeOf('function')
      expect(middleware.wrapStream).toBeTypeOf('function')
    })

    it('captures data when used with wrapLanguageModel', async () => {
      const { wrapLanguageModel } = await import('ai')
      const log = createMockLogger()
      const middleware = createAIMiddleware(log, { toolInputs: true })
      const model = createMockModel()

      const wrappedModel = wrapLanguageModel({ model, middleware })

      vi.mocked(model.doGenerate).mockResolvedValue({
        content: [{ type: 'tool-call', toolCallId: 'tc1', toolName: 'search', input: '{"q":"test"}' }],
        finishReason: createFinishReason('tool-calls'),
        usage: createMockUsage({ inputTotal: 100, outputTotal: 50 }),
        response: { modelId: 'claude-sonnet-4.6', id: 'msg_abc' },
      })

      await wrappedModel.doGenerate(createMockCallOptions())

      const aiData = log.setCalls[log.setCalls.length - 1].ai as Record<string, unknown>
      expect(aiData.calls).toBe(1)
      expect(aiData.toolCalls).toEqual([{ name: 'search', input: { q: 'test' } }])
      expect(aiData.responseId).toBe('msg_abc')
    })
  })

  describe('captureEmbed v2', () => {
    it('captures embedding model info', () => {
      const log = createMockLogger()
      const ai = createAILogger(log)

      ai.captureEmbed({ usage: { tokens: 500 }, model: 'text-embedding-3-small', dimensions: 1536 })

      const aiData = log.setCalls[0].ai as Record<string, unknown>
      expect(aiData.calls).toBe(1)
      expect(aiData.inputTokens).toBe(500)
      expect(aiData.embedding).toEqual({
        tokens: 500,
        model: 'text-embedding-3-small',
        dimensions: 1536,
      })
    })

    it('captures embedMany count', () => {
      const log = createMockLogger()
      const ai = createAILogger(log)

      ai.captureEmbed({ usage: { tokens: 2000 }, model: 'text-embedding-3-small', count: 10 })

      const aiData = log.setCalls[0].ai as Record<string, unknown>
      const embedding = aiData.embedding as Record<string, unknown>
      expect(embedding.count).toBe(10)
      expect(embedding.tokens).toBe(2000)
    })

    it('accumulates multiple embed calls', () => {
      const log = createMockLogger()
      const ai = createAILogger(log)

      ai.captureEmbed({ usage: { tokens: 100 }, model: 'text-embedding-3-small', dimensions: 1536, count: 5 })
      ai.captureEmbed({ usage: { tokens: 200 }, count: 10 })

      const aiData = log.setCalls[log.setCalls.length - 1].ai as Record<string, unknown>
      expect(aiData.calls).toBe(2)
      const embedding = aiData.embedding as Record<string, unknown>
      expect(embedding.tokens).toBe(300)
      expect(embedding.model).toBe('text-embedding-3-small')
      expect(embedding.dimensions).toBe(1536)
      expect(embedding.count).toBe(15)
    })

    it('is backward compatible with basic usage', () => {
      const log = createMockLogger()
      const ai = createAILogger(log)

      ai.captureEmbed({ usage: { tokens: 100 } })

      const aiData = log.setCalls[0].ai as Record<string, unknown>
      expect(aiData.calls).toBe(1)
      expect(aiData.inputTokens).toBe(100)
      expect(aiData.embedding).toEqual({ tokens: 100 })
    })
  })

  describe('cost estimation', () => {
    it('computes estimatedCost from pricing map', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log, {
        cost: {
          'claude-sonnet-4.6': { input: 3, output: 15 },
        },
      })
      const model = createMockModel()
      const wrappedModel = ai.wrap(model)

      vi.mocked(model.doGenerate).mockResolvedValue({
        content: [],
        finishReason: createFinishReason(),
        usage: createMockUsage({ inputTotal: 1_000_000, outputTotal: 500_000 }),
        response: { modelId: 'claude-sonnet-4.6' },
      })

      await wrappedModel.doGenerate(createMockCallOptions())

      const aiData = log.setCalls[log.setCalls.length - 1].ai as Record<string, unknown>
      // 1M input * $3/1M = $3 + 500K output * $15/1M = $7.5 => $10.5
      expect(aiData.estimatedCost).toBe(10.5)
    })

    it('prices cumulative usage with each model\'s own rates', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log, {
        cost: {
          'fast-model': { input: 1, output: 2 },
          'smart-model': { input: 3, output: 4 },
        },
      })
      const fast = createMockModel({ modelId: 'fast-model' })
      const smart = createMockModel({ modelId: 'smart-model' })
      const wrappedFast = ai.wrap(fast)
      const wrappedSmart = ai.wrap(smart)

      vi.mocked(fast.doGenerate).mockResolvedValue(asGenerateResult({
        content: [],
        finishReason: createFinishReason(),
        usage: createMockUsage({ inputTotal: 1_000_000, outputTotal: 1_000_000 }),
        response: { modelId: 'fast-model' },
      }))
      vi.mocked(smart.doGenerate).mockResolvedValue(asGenerateResult({
        content: [],
        finishReason: createFinishReason(),
        usage: createMockUsage({ inputTotal: 1_000_000, outputTotal: 1_000_000 }),
        response: { modelId: 'smart-model' },
      }))

      await wrappedFast.doGenerate(createMockCallOptions())
      await wrappedSmart.doGenerate(createMockCallOptions())

      expect(ai.getEstimatedCost()).toBe(10)
    })

    it('does not report a partial cost when usage cannot be attributed to a model', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log, {
        cost: { 'claude-sonnet-4.6': { input: 3, output: 15 } },
      })
      const model = createMockModel()
      const wrappedModel = ai.wrap(model)

      ai.captureEmbed({ usage: { tokens: 100 } })
      vi.mocked(model.doGenerate).mockResolvedValue(asGenerateResult({
        content: [],
        finishReason: createFinishReason(),
        usage: createMockUsage(),
        response: { modelId: 'claude-sonnet-4.6' },
      }))
      await wrappedModel.doGenerate(createMockCallOptions())

      expect(ai.getEstimatedCost()).toBeUndefined()
    })

    it('omits estimatedCost when model not in pricing map', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log, {
        cost: {
          'gpt-4o': { input: 2.5, output: 10 },
        },
      })
      const model = createMockModel()
      const wrappedModel = ai.wrap(model)

      vi.mocked(model.doGenerate).mockResolvedValue({
        content: [],
        finishReason: createFinishReason(),
        usage: createMockUsage({ inputTotal: 100, outputTotal: 50 }),
        response: { modelId: 'claude-sonnet-4.6' },
      })

      await wrappedModel.doGenerate(createMockCallOptions())

      const aiData = log.setCalls[log.setCalls.length - 1].ai as Record<string, unknown>
      expect(aiData.estimatedCost).toBeUndefined()
    })

    it('omits estimatedCost when no pricing map provided', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log)
      const model = createMockModel()
      const wrappedModel = ai.wrap(model)

      vi.mocked(model.doGenerate).mockResolvedValue({
        content: [],
        finishReason: createFinishReason(),
        usage: createMockUsage({ inputTotal: 100, outputTotal: 50 }),
        response: { modelId: 'claude-sonnet-4.6' },
      })

      await wrappedModel.doGenerate(createMockCallOptions())

      const aiData = log.setCalls[log.setCalls.length - 1].ai as Record<string, unknown>
      expect(aiData.estimatedCost).toBeUndefined()
    })
  })

  describe('createEvlogIntegration', () => {
    it('returns a valid telemetry integration with v6 and v7 hooks', () => {
      const log = createMockLogger()
      const integration = createEvlogIntegration(log)

      expect(integration).toBeDefined()
      expect(integration.onStart).toBeTypeOf('function')
      expect(integration.onToolCallFinish).toBeTypeOf('function')
      expect(integration.onToolExecutionEnd).toBeTypeOf('function')
      expect(integration.onFinish).toBeTypeOf('function')
      expect(integration.onEnd).toBeTypeOf('function')
      expect(integration.onEmbedEnd).toBeTypeOf('function')
      expect(integration.onAbort).toBeTypeOf('function')
      expect(integration.onError).toBeTypeOf('function')
    })

    it('captures tool execution timing and success', () => {
      const log = createMockLogger()
      const integration = createEvlogIntegration(log)

      callIntegrationOnStart(integration)
      callIntegrationOnToolCallFinish(integration, {
        toolName: 'getWeather',
        durationMs: 150,
        success: true,
        output: { temperature: 22 },
      })
      callIntegrationOnFinish(integration)

      const aiData = getLastAiData(log)
      const tools = aiData.tools as Array<Record<string, unknown>>
      expect(tools).toHaveLength(1)
      expect(tools[0]).toEqual({
        name: 'getWeather',
        durationMs: 150,
        success: true,
      })
      expect(aiData.totalDurationMs).toBeTypeOf('number')
      expect(aiData.totalDurationMs).toBeGreaterThanOrEqual(0)
    })

    it('captures tool execution errors', () => {
      const log = createMockLogger()
      const integration = createEvlogIntegration(log)

      callIntegrationOnStart(integration)
      callIntegrationOnToolCallFinish(integration, {
        toolName: 'searchDB',
        durationMs: 50,
        success: false,
        error: new Error('Connection refused'),
      })
      callIntegrationOnFinish(integration)

      const aiData = getLastAiData(log)
      const tools = aiData.tools as Array<Record<string, unknown>>
      expect(tools).toHaveLength(1)
      expect(tools[0]).toEqual({
        name: 'searchDB',
        durationMs: 50,
        success: false,
        error: 'Connection refused',
      })
    })

    it('captures multiple tool executions', () => {
      const log = createMockLogger()
      const integration = createEvlogIntegration(log)

      callIntegrationOnStart(integration)
      callIntegrationOnToolCallFinish(integration, {
        toolName: 'getWeather',
        durationMs: 100,
        success: true,
        output: {},
      })
      callIntegrationOnToolCallFinish(integration, {
        toolName: 'searchDB',
        durationMs: 250,
        success: true,
        output: {},
      })
      callIntegrationOnFinish(integration)

      const aiData = getLastAiData(log)
      const tools = aiData.tools as Array<Record<string, unknown>>
      expect(tools).toHaveLength(2)
      expect(tools[0].name).toBe('getWeather')
      expect(tools[1].name).toBe('searchDB')
    })

    it('shares state with AILogger when passed AILogger', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log)
      const integration = createEvlogIntegration(ai)
      const model = createMockModel()
      const wrappedModel = ai.wrap(model)

      vi.mocked(model.doGenerate).mockResolvedValue({
        content: [{ type: 'tool-call', toolCallId: 'tc1', toolName: 'getWeather', input: '{}' }],
        finishReason: createFinishReason('tool-calls'),
        usage: createMockUsage({ inputTotal: 200, outputTotal: 100 }),
        response: { modelId: 'claude-sonnet-4.6' },
      })

      callIntegrationOnStart(integration)
      await wrappedModel.doGenerate(createMockCallOptions())
      callIntegrationOnToolCallFinish(integration, {
        toolName: 'getWeather',
        durationMs: 75,
        success: true,
        output: { temp: 20 },
      })
      callIntegrationOnFinish(integration)

      const aiData = getLastAiData(log)
      expect(aiData.calls).toBe(1)
      expect(aiData.model).toBe('claude-sonnet-4.6')
      expect(aiData.inputTokens).toBe(200)
      expect(aiData.outputTokens).toBe(100)
      const tools = aiData.tools as Array<Record<string, unknown>>
      expect(tools).toHaveLength(1)
      expect(tools[0].name).toBe('getWeather')
      expect(tools[0].durationMs).toBe(75)
      expect(aiData.totalDurationMs).toBeTypeOf('number')
    })

    it('computes totalDurationMs from onStart to onFinish', async () => {
      await withFakeTimers(() => {
        const log = createMockLogger()
        const integration = createEvlogIntegration(log)

        callIntegrationOnStart(integration)
        vi.advanceTimersByTime(20)
        callIntegrationOnFinish(integration)

        const aiData = getLastAiData(log)
        expect(aiData.totalDurationMs).toBe(20)
      })
    })

    it('handles string errors from tool execution', () => {
      const log = createMockLogger()
      const integration = createEvlogIntegration(log)

      callIntegrationOnStart(integration)
      callIntegrationOnToolCallFinish(integration, {
        toolName: 'myTool',
        durationMs: 10,
        success: false,
        error: 'Something went wrong',
      })
      callIntegrationOnFinish(integration)

      const aiData = getLastAiData(log)
      const tools = aiData.tools as Array<Record<string, unknown>>
      expect(tools[0].error).toBe('Something went wrong')
    })

    it('omits tools field when no tool executions', () => {
      const log = createMockLogger()
      const integration = createEvlogIntegration(log)

      callIntegrationOnStart(integration)
      callIntegrationOnFinish(integration)

      const aiData = getLastAiData(log)
      expect(aiData.tools).toBeUndefined()
    })

    describe('AI SDK v7 hooks', () => {
      it('captures tool execution via onToolExecutionEnd', () => {
        const log = createMockLogger()
        const integration = createEvlogIntegration(log)

        callIntegrationOnStart(integration)
        callIntegrationOnToolExecutionEnd(integration, {
          toolName: 'getWeather',
          toolExecutionMs: 150,
          success: true,
          output: { temperature: 22 },
        })
        callIntegrationOnEnd(integration)

        const aiData = getLastAiData(log)
        const tools = aiData.tools as Array<Record<string, unknown>>
        expect(tools).toHaveLength(1)
        expect(tools[0]).toEqual({
          name: 'getWeather',
          durationMs: 150,
          success: true,
        })
      })

      it('captures tool errors via onToolExecutionEnd', () => {
        const log = createMockLogger()
        const integration = createEvlogIntegration(log)

        callIntegrationOnStart(integration)
        callIntegrationOnToolExecutionEnd(integration, {
          toolName: 'searchDB',
          toolExecutionMs: 50,
          success: false,
          error: new Error('Connection refused'),
        })
        callIntegrationOnEnd(integration)

        const aiData = getLastAiData(log)
        const tools = aiData.tools as Array<Record<string, unknown>>
        expect(tools[0]).toEqual({
          name: 'searchDB',
          durationMs: 50,
          success: false,
          error: 'Connection refused',
        })
      })

      it('computes totalDurationMs from onStart to onEnd', async () => {
        await withFakeTimers(() => {
          const log = createMockLogger()
          const integration = createEvlogIntegration(log)

          callIntegrationOnStart(integration)
          vi.advanceTimersByTime(20)
          callIntegrationOnEnd(integration)

          const aiData = getLastAiData(log)
          expect(aiData.totalDurationMs).toBe(20)
        })
      })

      it('auto-captures embeddings via onEmbedEnd', () => {
        const log = createMockLogger()
        const integration = createEvlogIntegration(log)

        callIntegrationOnEmbedEnd(integration, {
          modelId: 'text-embedding-3-small',
          tokens: 42,
          dimensions: 1536,
          count: 3,
        })

        const aiData = getLastAiData(log)
        expect(aiData.calls).toBe(1)
        expect(aiData.inputTokens).toBe(42)
        expect(aiData.embedding).toEqual({
          model: 'text-embedding-3-small',
          tokens: 42,
          dimensions: 1536,
          count: 3,
        })
      })

      it('accumulates embed events and preserves dimensions when an event has no embedding', () => {
        const log = createMockLogger()
        const integration = createEvlogIntegration(log)

        callIntegrationOnEmbedEnd(integration, {
          modelId: 'text-embedding-3-small',
          tokens: 10,
          dimensions: 1536,
          count: 2,
        })
        defined(integration.onEmbedEnd, 'onEmbedEnd')({
          modelId: 'text-embedding-3-small',
          usage: { tokens: 5 },
          embeddings: [],
          values: [],
        })

        expect(getLastAiData(log).embedding).toEqual({
          model: 'text-embedding-3-small',
          tokens: 15,
          dimensions: 1536,
          count: 2,
        })
      })

      it('records abort via onAbort', () => {
        const log = createMockLogger()
        const integration = createEvlogIntegration(log)

        callIntegrationOnStart(integration)
        callIntegrationOnAbort(integration, new Error('User cancelled'))

        const aiData = getLastAiData(log)
        expect(aiData.finishReason).toBe('abort')
        expect(aiData.error).toBe('User cancelled')
        expect(aiData.totalDurationMs).toBeTypeOf('number')
      })

      it('records an abort without inventing an error when no reason is provided', () => {
        const log = createMockLogger()
        const integration = createEvlogIntegration(log)

        callIntegrationOnStart(integration)
        callIntegrationOnAbort(integration)

        const aiData = getLastAiData(log)
        expect(aiData.finishReason).toBe('abort')
        expect(aiData.error).toBeUndefined()
      })

      it('records unrecoverable errors via onError', () => {
        const log = createMockLogger()
        const integration = createEvlogIntegration(log)

        callIntegrationOnError(integration, new Error('Provider unavailable'))

        const aiData = getLastAiData(log)
        expect(aiData.error).toBe('Provider unavailable')
      })
    })
  })
})
