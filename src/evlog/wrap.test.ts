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
  getLastAiData,
  makeReadableStream,
} from '../test-helpers/evlog'

describe('createAILogger', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('wrap - wrapGenerate', () => {
    it('captures basic token usage from doGenerate', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log)
      const model = createMockModel()

      const wrappedModel = ai.wrap(model)

      const mockResult = {
        content: [],
        finishReason: createFinishReason(),
        usage: createMockUsage({ inputTotal: 200, outputTotal: 800 }),
        response: { modelId: 'claude-sonnet-4.6' },
      }

      vi.mocked(model.doGenerate).mockResolvedValue(asGenerateResult(mockResult))
      await wrappedModel.doGenerate(createMockCallOptions())

      expect(log.set).toHaveBeenCalled()
      const lastSetCall = log.setCalls[log.setCalls.length - 1]
      const aiData = lastSetCall.ai as Record<string, unknown>

      expect(aiData.calls).toBe(1)
      expect(aiData.model).toBe('claude-sonnet-4.6')
      expect(aiData.provider).toBe('anthropic')
      expect(aiData.inputTokens).toBe(200)
      expect(aiData.outputTokens).toBe(800)
      expect(aiData.totalTokens).toBe(1000)
      expect(aiData.finishReason).toBe('stop')
    })

    it('captures final text content as ai.output', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log)
      const model = createMockModel()
      const wrappedModel = ai.wrap(model)

      vi.mocked(model.doGenerate).mockResolvedValue(asGenerateResult({
        content: [
          { type: 'text', text: 'Hello ' },
          { type: 'text', text: 'world' },
        ],
        finishReason: createFinishReason(),
        usage: createMockUsage(),
        response: { modelId: 'claude-sonnet-4.6' },
      }))
      await wrappedModel.doGenerate(createMockCallOptions())

      const aiData = getLastAiData(log)
      expect(aiData.output).toBe('Hello world')
      expect(ai.getMetadata().output).toBe('Hello world')
    })

    it('omits ai.output when generate content has no text parts', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log)
      const model = createMockModel()
      const wrappedModel = ai.wrap(model)

      vi.mocked(model.doGenerate).mockResolvedValue(asGenerateResult({
        content: [{ type: 'tool-call', toolCallId: 'tc1', toolName: 'search', input: '{}' }],
        finishReason: createFinishReason('tool-calls'),
        usage: createMockUsage(),
        response: { modelId: 'claude-sonnet-4.6' },
      }))
      await wrappedModel.doGenerate(createMockCallOptions())

      const aiData = getLastAiData(log)
      expect(aiData.output).toBeUndefined()
    })

    it('retains last-observed fields when the next call omits them', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log)
      const model = createMockModel()
      const wrappedModel = ai.wrap(model)

      vi.mocked(model.doGenerate)
        .mockResolvedValueOnce(asGenerateResult({
          content: [{ type: 'text', text: 'first response' }],
          finishReason: createFinishReason(),
          usage: createMockUsage(),
          response: { modelId: 'claude-sonnet-4.6', id: 'response-1' },
        }))
        .mockResolvedValueOnce(asGenerateResult({
          content: [{ type: 'tool-call', toolCallId: 'tc1', toolName: 'search', input: '{}' }],
          finishReason: createFinishReason('tool-calls'),
          usage: createMockUsage(),
          response: { modelId: 'claude-sonnet-4.6' },
        }))

      await wrappedModel.doGenerate(createMockCallOptions())
      expect(ai.getMetadata().output).toBe('first response')
      expect(ai.getMetadata().responseId).toBe('response-1')

      await wrappedModel.doGenerate(createMockCallOptions())
      expect(ai.getMetadata().output).toBe('first response')
      expect(ai.getMetadata().responseId).toBe('response-1')
      expect((log.merged.ai as Record<string, unknown>).output).toBe('first response')
    })

    it('retains a previous error so cumulative execution metadata reports it', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log)
      const model = createMockModel()
      const wrappedModel = ai.wrap(model)

      vi.mocked(model.doGenerate)
        .mockRejectedValueOnce(new Error('temporary failure'))
        .mockResolvedValueOnce(asGenerateResult({
          content: [{ type: 'text', text: 'recovered' }],
          finishReason: createFinishReason(),
          usage: createMockUsage(),
          response: { modelId: 'claude-sonnet-4.6' },
        }))

      await expect(wrappedModel.doGenerate(createMockCallOptions())).rejects.toThrow('temporary failure')
      expect(ai.getMetadata().error).toBe('temporary failure')

      await wrappedModel.doGenerate(createMockCallOptions())
      expect(ai.getMetadata().error).toBe('temporary failure')
      expect(ai.getMetadata().output).toBe('recovered')
    })

    it('captures cache and reasoning token breakdown', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log)
      const model = createMockModel()
      const wrappedModel = ai.wrap(model)

      const mockResult = {
        content: [],
        finishReason: createFinishReason(),
        usage: createMockUsage({ inputTotal: 500, outputTotal: 300, cacheRead: 150, cacheWrite: 50, reasoning: 100 }),
        response: { modelId: 'claude-sonnet-4.6' },
      }

      vi.mocked(model.doGenerate).mockResolvedValue(asGenerateResult(mockResult))
      await wrappedModel.doGenerate(createMockCallOptions())

      const aiData = log.setCalls[log.setCalls.length - 1].ai as Record<string, unknown>
      expect(aiData.cacheReadTokens).toBe(150)
      expect(aiData.cacheWriteTokens).toBe(50)
      expect(aiData.reasoningTokens).toBe(100)
    })

    it('omits cache/reasoning fields when zero', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log)
      const model = createMockModel()
      const wrappedModel = ai.wrap(model)

      const mockResult = {
        content: [],
        finishReason: createFinishReason(),
        usage: createMockUsage({ inputTotal: 100, outputTotal: 50 }),
        response: { modelId: 'claude-sonnet-4.6' },
      }

      vi.mocked(model.doGenerate).mockResolvedValue(asGenerateResult(mockResult))
      await wrappedModel.doGenerate(createMockCallOptions())

      const aiData = log.setCalls[log.setCalls.length - 1].ai as Record<string, unknown>
      expect(aiData.cacheReadTokens).toBeUndefined()
      expect(aiData.cacheWriteTokens).toBeUndefined()
      expect(aiData.reasoningTokens).toBeUndefined()
    })

    it('captures tool calls from content', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log)
      const model = createMockModel()
      const wrappedModel = ai.wrap(model)

      const mockResult = {
        content: [
          { type: 'tool-call', toolCallId: 'tc1', toolName: 'searchWeb', input: '{}' },
          { type: 'text', id: 't1', text: 'hello' },
          { type: 'tool-call', toolCallId: 'tc2', toolName: 'calculatePrice', input: '{}' },
        ],
        finishReason: createFinishReason('tool-calls'),
        usage: createMockUsage(),
        response: { modelId: 'claude-sonnet-4.6' },
      }

      vi.mocked(model.doGenerate).mockResolvedValue(asGenerateResult(mockResult))
      await wrappedModel.doGenerate(createMockCallOptions())

      const aiData = log.setCalls[log.setCalls.length - 1].ai as Record<string, unknown>
      expect(aiData.toolCalls).toEqual(['searchWeb', 'calculatePrice'])
      expect(aiData.finishReason).toBe('tool-calls')
    })

    it('uses response.modelId over model.modelId', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log)
      const model = createMockModel({ modelId: 'claude-sonnet-4.6' })
      const wrappedModel = ai.wrap(model)

      const mockResult = {
        content: [],
        finishReason: createFinishReason(),
        usage: createMockUsage(),
        response: { modelId: 'claude-sonnet-4.6-20250514' },
      }

      vi.mocked(model.doGenerate).mockResolvedValue(asGenerateResult(mockResult))
      await wrappedModel.doGenerate(createMockCallOptions())

      const aiData = log.setCalls[log.setCalls.length - 1].ai as Record<string, unknown>
      expect(aiData.model).toBe('claude-sonnet-4.6-20250514')
    })

    it('falls back to model.modelId when response has no modelId', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log)
      const model = createMockModel({ modelId: 'claude-sonnet-4.6' })
      const wrappedModel = ai.wrap(model)

      const mockResult = {
        content: [],
        finishReason: createFinishReason(),
        usage: createMockUsage(),
      }

      vi.mocked(model.doGenerate).mockResolvedValue(asGenerateResult(mockResult))
      await wrappedModel.doGenerate(createMockCallOptions())

      const aiData = log.setCalls[log.setCalls.length - 1].ai as Record<string, unknown>
      expect(aiData.model).toBe('claude-sonnet-4.6')
    })
  })

  describe('wrap - wrapStream', () => {
    it('captures usage from stream finish chunk', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log)
      const model = createMockModel()
      const wrappedModel = ai.wrap(model)

      const chunks: LanguageModelV4StreamPart[] = [
        { type: 'text-start', id: 't1' },
        { type: 'text-delta', id: 't1', delta: 'Hello ' },
        { type: 'text-delta', id: 't1', delta: 'world' },
        { type: 'text-end', id: 't1' },
        {
          type: 'finish',
          finishReason: createFinishReason(),
          usage: createMockUsage({ inputTotal: 300, outputTotal: 150 }),
        },
      ]

      vi.mocked(model.doStream).mockResolvedValue({
        stream: makeReadableStream(chunks),
      })

      const result = await wrappedModel.doStream(createMockCallOptions())
      await consumeStream(result.stream)

      const aiData = log.setCalls[log.setCalls.length - 1].ai as Record<string, unknown>
      expect(aiData.inputTokens).toBe(300)
      expect(aiData.outputTokens).toBe(150)
      expect(aiData.totalTokens).toBe(450)
      expect(aiData.finishReason).toBe('stop')
      expect(aiData.output).toBe('Hello world')
    })

    it('concatenates stream text-delta chunks into ai.output', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log)
      const model = createMockModel()
      const wrappedModel = ai.wrap(model)

      vi.mocked(model.doStream).mockResolvedValue({
        stream: makeReadableStream([
          { type: 'text-delta', id: 't1', delta: 'Hel' },
          { type: 'text-delta', id: 't1', delta: 'lo ' },
          { type: 'text-delta', id: 't1', delta: 'stream' },
          {
            type: 'finish',
            finishReason: createFinishReason(),
            usage: createMockUsage(),
          },
        ]),
      })

      const result = await wrappedModel.doStream(createMockCallOptions())
      await consumeStream(result.stream)

      expect(getLastAiData(log).output).toBe('Hello stream')
      expect(ai.getMetadata().output).toBe('Hello stream')
    })

    it('captures streaming metrics', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log)
      const model = createMockModel()
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
      expect(aiData.msToFirstChunk).toBeTypeOf('number')
      expect(aiData.msToFirstChunk).toBeGreaterThanOrEqual(0)
      expect(aiData.msToFinish).toBeTypeOf('number')
      expect(aiData.msToFinish).toBeGreaterThanOrEqual(0)
    })

    it('captures tool calls from stream chunks', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log)
      const model = createMockModel()
      const wrappedModel = ai.wrap(model)

      const chunks: LanguageModelV4StreamPart[] = [
        { type: 'tool-input-start', id: 'tc1', toolName: 'searchWeb' },
        { type: 'tool-input-delta', id: 'tc1', delta: '{}' },
        { type: 'tool-input-end', id: 'tc1' },
        { type: 'finish', finishReason: createFinishReason('tool-calls'), usage: createMockUsage() },
      ]

      vi.mocked(model.doStream).mockResolvedValue({
        stream: makeReadableStream(chunks),
      })

      const result = await wrappedModel.doStream(createMockCallOptions())
      await consumeStream(result.stream)

      const aiData = log.setCalls[log.setCalls.length - 1].ai as Record<string, unknown>
      expect(aiData.toolCalls).toEqual(['searchWeb'])
    })

    it('captures modelId from response-metadata chunk', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log)
      const model = createMockModel({ modelId: 'claude-sonnet-4.6' })
      const wrappedModel = ai.wrap(model)

      const chunks: LanguageModelV4StreamPart[] = [
        { type: 'response-metadata', modelId: 'claude-sonnet-4.6-20250514' } as LanguageModelV4StreamPart,
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
      expect(aiData.model).toBe('claude-sonnet-4.6-20250514')
    })

    it('passes stream chunks through unchanged', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log)
      const model = createMockModel()
      const wrappedModel = ai.wrap(model)

      const inputChunks: LanguageModelV4StreamPart[] = [
        { type: 'text-start', id: 't1' },
        { type: 'text-delta', id: 't1', delta: 'Hello' },
        { type: 'text-end', id: 't1' },
        { type: 'finish', finishReason: createFinishReason(), usage: createMockUsage() },
      ]

      vi.mocked(model.doStream).mockResolvedValue({
        stream: makeReadableStream(inputChunks),
      })

      const result = await wrappedModel.doStream(createMockCallOptions())
      const outputChunks = await consumeStream(result.stream)

      expect(outputChunks).toHaveLength(inputChunks.length)
      expect(outputChunks.map(c => c.type)).toEqual(['text-start', 'text-delta', 'text-end', 'finish'])
    })
  })
})
