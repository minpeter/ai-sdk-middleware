// biome-ignore-all lint: official evlog test port — keep upstream structure
// biome-ignore-all assist: official evlog test port — keep upstream structure
// biome-ignore-all format: official evlog test port — keep upstream structure

import type { LanguageModelV4StreamPart } from '@ai-sdk/provider'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAILogger } from '../evlog'
import {
  asGenerateResult,
  consumeStream,
  createFinishReason,
  createMockCallOptions,
  createMockLogger,
  createMockModel,
  createMockUsage,
  makeReadableStream,
} from '../test-helpers/evlog'

describe('createAILogger', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('accumulation', () => {
    it('accumulates tokens across multiple generate calls', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log)
      const model = createMockModel()
      const wrappedModel = ai.wrap(model)

      vi.mocked(model.doGenerate)
        .mockResolvedValueOnce({
          content: [],
          finishReason: createFinishReason(),
          usage: createMockUsage({ inputTotal: 100, outputTotal: 50 }),
          response: { modelId: 'claude-sonnet-4.6' },
        })
        .mockResolvedValueOnce({
          content: [],
          finishReason: createFinishReason(),
          usage: createMockUsage({ inputTotal: 200, outputTotal: 100 }),
          response: { modelId: 'claude-sonnet-4.6' },
        })

      await wrappedModel.doGenerate(createMockCallOptions())
      await wrappedModel.doGenerate(createMockCallOptions())

      const aiData = log.setCalls[log.setCalls.length - 1].ai as Record<string, unknown>
      expect(aiData.calls).toBe(2)
      expect(aiData.inputTokens).toBe(300)
      expect(aiData.outputTokens).toBe(150)
      expect(aiData.totalTokens).toBe(450)
    })

    it('shows steps only when greater than 1', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log)
      const model = createMockModel()
      const wrappedModel = ai.wrap(model)

      const mockResult = {
        content: [],
        finishReason: createFinishReason(),
        usage: createMockUsage(),
        response: { modelId: 'claude-sonnet-4.6' },
      }

      vi.mocked(model.doGenerate).mockResolvedValue(asGenerateResult(mockResult))

      await wrappedModel.doGenerate(createMockCallOptions())
      let aiData = log.setCalls[log.setCalls.length - 1].ai as Record<string, unknown>
      expect(aiData.steps).toBeUndefined()

      vi.mocked(model.doGenerate).mockResolvedValue(asGenerateResult(mockResult))
      await wrappedModel.doGenerate(createMockCallOptions())
      aiData = log.setCalls[log.setCalls.length - 1].ai as Record<string, unknown>
      expect(aiData.steps).toBe(2)
    })

    it('tracks multiple models with ai.models array', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log)

      const gemini = createMockModel({ provider: 'google', modelId: 'gemini-3-flash' })
      const claude = createMockModel({ provider: 'anthropic', modelId: 'claude-sonnet-4.6' })

      const wrappedGemini = ai.wrap(gemini)
      const wrappedClaude = ai.wrap(claude)

      vi.mocked(gemini.doGenerate).mockResolvedValue({
        content: [],
        finishReason: createFinishReason(),
        usage: createMockUsage({ inputTotal: 100, outputTotal: 50 }),
        response: { modelId: 'gemini-3-flash' },
      })

      vi.mocked(claude.doGenerate).mockResolvedValue({
        content: [],
        finishReason: createFinishReason(),
        usage: createMockUsage({ inputTotal: 200, outputTotal: 100 }),
        response: { modelId: 'claude-sonnet-4.6' },
      })

      await wrappedGemini.doGenerate(createMockCallOptions())
      await wrappedClaude.doGenerate(createMockCallOptions())

      const aiData = log.setCalls[log.setCalls.length - 1].ai as Record<string, unknown>
      expect(aiData.model).toBe('claude-sonnet-4.6')
      expect(aiData.models).toEqual(['gemini-3-flash', 'claude-sonnet-4.6'])
      expect(aiData.inputTokens).toBe(300)
      expect(aiData.outputTokens).toBe(150)
    })

    it('does not duplicate models in ai.models array', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log)
      const model = createMockModel()
      const wrappedModel = ai.wrap(model)

      const mockResult = {
        content: [],
        finishReason: createFinishReason(),
        usage: createMockUsage(),
        response: { modelId: 'claude-sonnet-4.6' },
      }

      vi.mocked(model.doGenerate).mockResolvedValue(asGenerateResult(mockResult))

      await wrappedModel.doGenerate(createMockCallOptions())
      await wrappedModel.doGenerate(createMockCallOptions())

      const aiData = log.setCalls[log.setCalls.length - 1].ai as Record<string, unknown>
      expect(aiData.model).toBe('claude-sonnet-4.6')
      expect(aiData.models).toBeUndefined()
    })

    it('concatenates tool calls across multiple calls', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log)
      const model = createMockModel()
      const wrappedModel = ai.wrap(model)

      vi.mocked(model.doGenerate)
        .mockResolvedValueOnce({
          content: [{ type: 'tool-call', toolCallId: 'tc1', toolName: 'search', input: '{}' }],
          finishReason: createFinishReason('tool-calls'),
          usage: createMockUsage(),
          response: { modelId: 'claude-sonnet-4.6' },
        })
        .mockResolvedValueOnce({
          content: [{ type: 'tool-call', toolCallId: 'tc2', toolName: 'calculate', input: '{}' }],
          finishReason: createFinishReason('stop'),
          usage: createMockUsage(),
          response: { modelId: 'claude-sonnet-4.6' },
        })

      await wrappedModel.doGenerate(createMockCallOptions())
      await wrappedModel.doGenerate(createMockCallOptions())

      const aiData = log.merged.ai as Record<string, unknown>
      expect(aiData.toolCalls).toEqual(['search', 'calculate'])
    })

    it('does not grow array fields quadratically across multi-step runs', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log)
      const model = createMockModel()
      const wrappedModel = ai.wrap(model)

      const tools = ['list-pages', 'get-page', 'get-page', 'get-page', 'get-page', 'get-page']

      const doGenerate = vi.mocked(model.doGenerate)
      for (const toolName of tools) {
        doGenerate.mockResolvedValueOnce({
          content: [{ type: 'tool-call', toolCallId: `tc-${toolName}`, toolName, input: '{}' }],
          finishReason: createFinishReason('tool-calls'),
          usage: createMockUsage({ inputTotal: 100, outputTotal: 20 }),
          response: { modelId: 'claude-sonnet-4.6' },
        })
        await wrappedModel.doGenerate(createMockCallOptions())
      }

      const merged = log.merged.ai as Record<string, unknown>
      expect((merged.toolCalls as string[])).toEqual(tools)
      expect((merged.stepsUsage as unknown[])).toHaveLength(tools.length)
      expect(merged.steps).toBe(tools.length)

      // Each flush should ship at most a single new tool call, not the full
      // cumulative array — guarding against the quadratic regression.
      const totalToolCallEntries = log.setCalls.reduce((sum, call) => {
        const ai = call.ai as { toolCalls?: unknown[] } | undefined
        return sum + (ai?.toolCalls?.length ?? 0)
      }, 0)
      expect(totalToolCallEntries).toBe(tools.length)
    })
  })

  describe('gateway provider resolution', () => {
    it('resolves provider from gateway modelId', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log)
      const model = createMockModel({ provider: 'gateway', modelId: 'google/gemini-3-flash' })
      const wrappedModel = ai.wrap(model)

      vi.mocked(model.doGenerate).mockResolvedValue({
        content: [],
        finishReason: createFinishReason(),
        usage: createMockUsage(),
      })

      await wrappedModel.doGenerate(createMockCallOptions())

      const aiData = log.setCalls[log.setCalls.length - 1].ai as Record<string, unknown>
      expect(aiData.provider).toBe('google')
      expect(aiData.model).toBe('gemini-3-flash')
    })

    it('uses response.modelId for gateway resolution when available', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log)
      const model = createMockModel({ provider: 'gateway', modelId: 'anthropic/claude-sonnet-4.6' })
      const wrappedModel = ai.wrap(model)

      vi.mocked(model.doGenerate).mockResolvedValue({
        content: [],
        finishReason: createFinishReason(),
        usage: createMockUsage(),
        response: { modelId: 'anthropic/claude-sonnet-4.6-20250514' },
      })

      await wrappedModel.doGenerate(createMockCallOptions())

      const aiData = log.setCalls[log.setCalls.length - 1].ai as Record<string, unknown>
      expect(aiData.provider).toBe('anthropic')
      expect(aiData.model).toBe('claude-sonnet-4.6-20250514')
    })

    it('keeps non-gateway provider as-is', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log)
      const model = createMockModel({ provider: 'anthropic', modelId: 'claude-sonnet-4.6' })
      const wrappedModel = ai.wrap(model)

      vi.mocked(model.doGenerate).mockResolvedValue({
        content: [],
        finishReason: createFinishReason(),
        usage: createMockUsage(),
        response: { modelId: 'claude-sonnet-4.6' },
      })

      await wrappedModel.doGenerate(createMockCallOptions())

      const aiData = log.setCalls[log.setCalls.length - 1].ai as Record<string, unknown>
      expect(aiData.provider).toBe('anthropic')
      expect(aiData.model).toBe('claude-sonnet-4.6')
    })

    it('resolves provider in stream mode', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log)
      const model = createMockModel({ provider: 'gateway', modelId: 'anthropic/claude-sonnet-4.6' })
      const wrappedModel = ai.wrap(model)

      const chunks: LanguageModelV4StreamPart[] = [
        { type: 'text-start', id: 't1' },
        { type: 'text-delta', id: 't1', delta: 'Hi' },
        { type: 'text-end', id: 't1' },
        { type: 'finish', finishReason: createFinishReason(), usage: createMockUsage() },
      ]

      vi.mocked(model.doStream).mockResolvedValue({
        stream: makeReadableStream(chunks),
      })

      const result = await wrappedModel.doStream(createMockCallOptions())
      await consumeStream(result.stream)

      const aiData = log.setCalls[log.setCalls.length - 1].ai as Record<string, unknown>
      expect(aiData.provider).toBe('anthropic')
      expect(aiData.model).toBe('claude-sonnet-4.6')
    })
  })

  describe('string model support', () => {
    it('accepts a string model via wrap()', () => {
      const log = createMockLogger()
      const ai = createAILogger(log)

      const wrappedModel = ai.wrap('anthropic/claude-sonnet-4.6')
      expect(wrappedModel).toBeDefined()
      expect(['v3', 'v4']).toContain(wrappedModel.specificationVersion)
    })
  })

  describe('tokensPerSecond', () => {
    it('computes tokensPerSecond when stream takes measurable time', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log)
      const model = createMockModel()
      const wrappedModel = ai.wrap(model)

      const chunks: LanguageModelV4StreamPart[] = [
        { type: 'text-start', id: 't1' },
        { type: 'text-delta', id: 't1', delta: 'Hi' },
        { type: 'text-end', id: 't1' },
        { type: 'finish', finishReason: createFinishReason(), usage: createMockUsage({ outputTotal: 500 }) },
      ]

      vi.mocked(model.doStream).mockImplementation(async () => {
        await new Promise(r => setTimeout(r, 20))
        return { stream: makeReadableStream(chunks) }
      })

      const result = await wrappedModel.doStream(createMockCallOptions())
      await consumeStream(result.stream)

      const aiData = log.setCalls[log.setCalls.length - 1].ai as Record<string, unknown>
      expect(aiData.msToFinish).toBeGreaterThan(0)
      expect(aiData.tokensPerSecond).toBeTypeOf('number')
      expect(aiData.tokensPerSecond).toBeGreaterThan(0)
    })

    it('omits tokensPerSecond when stream finishes instantly', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log)
      const model = createMockModel()
      const wrappedModel = ai.wrap(model)

      const chunks: LanguageModelV4StreamPart[] = [
        { type: 'text-start', id: 't1' },
        { type: 'text-delta', id: 't1', delta: 'Hi' },
        { type: 'text-end', id: 't1' },
        { type: 'finish', finishReason: createFinishReason(), usage: createMockUsage({ outputTotal: 500 }) },
      ]

      vi.mocked(model.doStream).mockResolvedValue({
        stream: makeReadableStream(chunks),
      })

      const result = await wrappedModel.doStream(createMockCallOptions())
      await consumeStream(result.stream)

      const aiData = log.setCalls[log.setCalls.length - 1].ai as Record<string, unknown>
      if (aiData.msToFinish === 0) {
        expect(aiData.tokensPerSecond).toBeUndefined()
      }
    })
  })

  describe('error capture', () => {
    it('captures error from doGenerate failure', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log)
      const model = createMockModel()
      const wrappedModel = ai.wrap(model)

      vi.mocked(model.doGenerate).mockRejectedValue(new Error('API rate limit exceeded'))

      await expect(wrappedModel.doGenerate(createMockCallOptions())).rejects.toThrow('API rate limit exceeded')

      const aiData = log.setCalls[log.setCalls.length - 1].ai as Record<string, unknown>
      expect(aiData.error).toBe('API rate limit exceeded')
      expect(aiData.finishReason).toBe('error')
      expect(aiData.calls).toBe(1)
    })

    it('captures error from doStream failure', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log)
      const model = createMockModel()
      const wrappedModel = ai.wrap(model)

      vi.mocked(model.doStream).mockRejectedValue(new Error('Connection timeout'))

      await expect(wrappedModel.doStream(createMockCallOptions())).rejects.toThrow('Connection timeout')

      const aiData = log.setCalls[log.setCalls.length - 1].ai as Record<string, unknown>
      expect(aiData.error).toBe('Connection timeout')
      expect(aiData.finishReason).toBe('error')
      expect(aiData.calls).toBe(1)
    })

    it('captures error from stream error chunk', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log)
      const model = createMockModel()
      const wrappedModel = ai.wrap(model)

      const chunks: LanguageModelV4StreamPart[] = [
        { type: 'text-start', id: 't1' },
        { type: 'error', error: new Error('Content filter triggered') },
        { type: 'finish', finishReason: createFinishReason('content-filter'), usage: createMockUsage() },
      ]

      vi.mocked(model.doStream).mockResolvedValue({
        stream: makeReadableStream(chunks),
      })

      const result = await wrappedModel.doStream(createMockCallOptions())
      await consumeStream(result.stream)

      const aiData = log.setCalls[log.setCalls.length - 1].ai as Record<string, unknown>
      expect(aiData.error).toBe('Content filter triggered')
    })

    it('records cancellation when a stream consumer stops early', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log)
      const model = createMockModel()
      const wrappedModel = ai.wrap(model)
      let sourceCancelled = false

      vi.mocked(model.doStream).mockResolvedValue({
        stream: new ReadableStream<LanguageModelV4StreamPart>({
          start(controller) {
            controller.enqueue({ type: 'text-delta', id: 't1', delta: 'partial' })
          },
          cancel() {
            sourceCancelled = true
          },
        }),
      })

      const result = await wrappedModel.doStream(createMockCallOptions())
      const reader = result.stream.getReader()
      await expect(reader.read()).resolves.toMatchObject({ done: false })
      await reader.cancel(new Error('consumer stopped'))

      expect(sourceCancelled).toBe(true)
      expect(ai.getMetadata().calls).toBe(1)
      expect(ai.getMetadata().finishReason).toBe('abort')
      expect(ai.getMetadata().error).toBe('consumer stopped')
      expect(ai.getMetadata().output).toBe('partial')
    })

    it('records an error raised while consuming the source stream', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log)
      const model = createMockModel()
      const wrappedModel = ai.wrap(model)

      vi.mocked(model.doStream).mockResolvedValue({
        stream: new ReadableStream<LanguageModelV4StreamPart>({
          start(controller) {
            controller.enqueue({ type: 'text-delta', id: 't1', delta: 'partial' })
            controller.error(new Error('socket closed'))
          },
        }),
      })

      const result = await wrappedModel.doStream(createMockCallOptions())
      await expect(consumeStream(result.stream)).rejects.toThrow('socket closed')
      expect(ai.getMetadata().calls).toBe(1)
      expect(ai.getMetadata().finishReason).toBe('error')
      expect(ai.getMetadata().error).toBe('socket closed')
    })
  })
})
