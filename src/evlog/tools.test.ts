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

  describe('captureEmbed', () => {
    it('captures embedding token usage', () => {
      const log = createMockLogger()
      const ai = createAILogger(log)

      ai.captureEmbed({ usage: { tokens: 42 } })

      const aiData = log.setCalls[log.setCalls.length - 1].ai as Record<string, unknown>
      expect(aiData.calls).toBe(1)
      expect(aiData.inputTokens).toBe(42)
      expect(aiData.outputTokens).toBe(0)
      expect(aiData.totalTokens).toBe(42)
    })

    it('accumulates with language model calls', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log)
      const model = createMockModel()
      const wrappedModel = ai.wrap(model)

      ai.captureEmbed({ usage: { tokens: 30 } })

      vi.mocked(model.doGenerate).mockResolvedValue({
        content: [],
        finishReason: createFinishReason(),
        usage: createMockUsage({ inputTotal: 200, outputTotal: 100 }),
        response: { modelId: 'claude-sonnet-4.6' },
      })

      await wrappedModel.doGenerate(createMockCallOptions())

      const aiData = log.setCalls[log.setCalls.length - 1].ai as Record<string, unknown>
      expect(aiData.calls).toBe(2)
      expect(aiData.inputTokens).toBe(230)
      expect(aiData.outputTokens).toBe(100)
      expect(aiData.totalTokens).toBe(330)
    })
  })

  describe('toolInputs option', () => {
    it('does not capture tool call inputs by default', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log)
      const model = createMockModel()
      const wrappedModel = ai.wrap(model)

      vi.mocked(model.doGenerate).mockResolvedValue({
        content: [{ type: 'tool-call', toolCallId: 'tc1', toolName: 'searchWeb', input: '{"query":"weather"}' }],
        finishReason: createFinishReason('tool-calls'),
        usage: createMockUsage(),
        response: { modelId: 'claude-sonnet-4.6' },
      })

      await wrappedModel.doGenerate(createMockCallOptions())

      const aiData = log.setCalls[log.setCalls.length - 1].ai as Record<string, unknown>
      expect(aiData.toolCalls).toEqual(['searchWeb'])
    })

    it('captures tool call inputs from doGenerate when enabled', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log, { toolInputs: true })
      const model = createMockModel()
      const wrappedModel = ai.wrap(model)

      vi.mocked(model.doGenerate).mockResolvedValue({
        content: [
          { type: 'tool-call', toolCallId: 'tc1', toolName: 'searchWeb', input: '{"query":"weather in SF"}' },
          { type: 'tool-call', toolCallId: 'tc2', toolName: 'calculate', input: '{"expression":"2+2"}' },
        ],
        finishReason: createFinishReason('tool-calls'),
        usage: createMockUsage(),
        response: { modelId: 'claude-sonnet-4.6' },
      })

      await wrappedModel.doGenerate(createMockCallOptions())

      const aiData = log.setCalls[log.setCalls.length - 1].ai as Record<string, unknown>
      expect(aiData.toolCalls).toEqual([
        { name: 'searchWeb', input: { query: 'weather in SF' } },
        { name: 'calculate', input: { expression: '2+2' } },
      ])
    })

    it('handles non-JSON tool inputs gracefully', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log, { toolInputs: true })
      const model = createMockModel()
      const wrappedModel = ai.wrap(model)

      vi.mocked(model.doGenerate).mockResolvedValue({
        content: [{ type: 'tool-call', toolCallId: 'tc1', toolName: 'run', input: 'not-json' }],
        finishReason: createFinishReason('tool-calls'),
        usage: createMockUsage(),
        response: { modelId: 'claude-sonnet-4.6' },
      })

      await wrappedModel.doGenerate(createMockCallOptions())

      const aiData = log.setCalls[log.setCalls.length - 1].ai as Record<string, unknown>
      const toolCalls = aiData.toolCalls as Array<{ name: string, input: unknown }>
      expect(toolCalls[0].input).toBe('not-json')
    })

    it('captures tool call inputs from stream deltas when enabled', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log, { toolInputs: true })
      const model = createMockModel()
      const wrappedModel = ai.wrap(model)

      const chunks: LanguageModelV4StreamPart[] = [
        { type: 'tool-input-start', id: 'tc1', toolName: 'searchWeb' },
        { type: 'tool-input-delta', id: 'tc1', delta: '{"que' },
        { type: 'tool-input-delta', id: 'tc1', delta: 'ry":"hello"}' },
        { type: 'tool-input-end', id: 'tc1' },
        { type: 'finish', finishReason: createFinishReason('tool-calls'), usage: createMockUsage() },
      ]

      vi.mocked(model.doStream).mockResolvedValue({
        stream: makeReadableStream(chunks),
      })

      const result = await wrappedModel.doStream(createMockCallOptions())
      await consumeStream(result.stream)

      const aiData = log.setCalls[log.setCalls.length - 1].ai as Record<string, unknown>
      expect(aiData.toolCalls).toEqual([{ name: 'searchWeb', input: { query: 'hello' } },])
    })

    it('does not capture stream tool inputs when toolInputs is false', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log)
      const model = createMockModel()
      const wrappedModel = ai.wrap(model)

      const chunks: LanguageModelV4StreamPart[] = [
        { type: 'tool-input-start', id: 'tc1', toolName: 'searchWeb' },
        { type: 'tool-input-delta', id: 'tc1', delta: '{"query":"test"}' },
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

    it('handles object-type tool inputs from doGenerate', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log, { toolInputs: true })
      const model = createMockModel()
      const wrappedModel = ai.wrap(model)

      vi.mocked(model.doGenerate).mockResolvedValue({
        content: [{ type: 'tool-call', toolCallId: 'tc1', toolName: 'run', input: { already: 'parsed' } }],
        finishReason: createFinishReason('tool-calls'),
        usage: createMockUsage(),
        response: { modelId: 'claude-sonnet-4.6' },
      })

      await wrappedModel.doGenerate(createMockCallOptions())

      const aiData = log.setCalls[log.setCalls.length - 1].ai as Record<string, unknown>
      const toolCalls = aiData.toolCalls as Array<{ name: string, input: unknown }>
      expect(toolCalls[0].input).toEqual({ already: 'parsed' })
    })

    it('truncates inputs exceeding maxLength', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log, { toolInputs: { maxLength: 20 } })
      const model = createMockModel()
      const wrappedModel = ai.wrap(model)

      vi.mocked(model.doGenerate).mockResolvedValue({
        content: [{ type: 'tool-call', toolCallId: 'tc1', toolName: 'queryDB', input: '{"sql":"SELECT * FROM events WHERE status = 200 ORDER BY created_at DESC LIMIT 50"}' },],
        finishReason: createFinishReason('tool-calls'),
        usage: createMockUsage(),
        response: { modelId: 'claude-sonnet-4.6' },
      })

      await wrappedModel.doGenerate(createMockCallOptions())

      const aiData = log.setCalls[log.setCalls.length - 1].ai as Record<string, unknown>
      const inputs = aiData.toolCalls as Array<{ name: string, input: unknown }>
      expect(inputs[0].input).toBeTypeOf('string')
      expect((inputs[0].input as string).length).toBeLessThanOrEqual(21)
      expect((inputs[0].input as string).endsWith('…')).toBe(true)
    })

    it('supports a zero maxLength and non-JSON input values', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log, { toolInputs: { maxLength: 0 } })
      const model = createMockModel()
      const wrappedModel = ai.wrap(model)

      vi.mocked(model.doGenerate).mockResolvedValue(asGenerateResult({
        content: [{ type: 'tool-call', toolCallId: 'tc1', toolName: 'run', input: BigInt(1) }],
        finishReason: createFinishReason('tool-calls'),
        usage: createMockUsage(),
        response: { modelId: 'claude-sonnet-4.6' },
      }))

      await wrappedModel.doGenerate(createMockCallOptions())

      const inputs = getLastAiData(log).toolCalls as Array<{ name: string, input: unknown }>
      expect(inputs[0].input).toBe('…')
    })

    it('does not truncate inputs within maxLength', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log, { toolInputs: { maxLength: 500 } })
      const model = createMockModel()
      const wrappedModel = ai.wrap(model)

      vi.mocked(model.doGenerate).mockResolvedValue({
        content: [{ type: 'tool-call', toolCallId: 'tc1', toolName: 'search', input: '{"q":"hello"}' },],
        finishReason: createFinishReason('tool-calls'),
        usage: createMockUsage(),
        response: { modelId: 'claude-sonnet-4.6' },
      })

      await wrappedModel.doGenerate(createMockCallOptions())

      const aiData = log.setCalls[log.setCalls.length - 1].ai as Record<string, unknown>
      const inputs = aiData.toolCalls as Array<{ name: string, input: unknown }>
      expect(inputs[0].input).toEqual({ q: 'hello' })
    })

    it('applies transform function to inputs', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log, {
        toolInputs: {
          transform: (input, toolName) => {
            if (toolName === 'queryDB') {
              return { sql: '***' }
            }
            return input
          },
        },
      })
      const model = createMockModel()
      const wrappedModel = ai.wrap(model)

      vi.mocked(model.doGenerate).mockResolvedValue({
        content: [
          { type: 'tool-call', toolCallId: 'tc1', toolName: 'queryDB', input: '{"sql":"SELECT * FROM users"}' },
          { type: 'tool-call', toolCallId: 'tc2', toolName: 'search', input: '{"q":"hello"}' },
        ],
        finishReason: createFinishReason('tool-calls'),
        usage: createMockUsage(),
        response: { modelId: 'claude-sonnet-4.6' },
      })

      await wrappedModel.doGenerate(createMockCallOptions())

      const aiData = log.setCalls[log.setCalls.length - 1].ai as Record<string, unknown>
      const inputs = aiData.toolCalls as Array<{ name: string, input: unknown }>
      expect(inputs[0]).toEqual({ name: 'queryDB', input: { sql: '***' } })
      expect(inputs[1]).toEqual({ name: 'search', input: { q: 'hello' } })
    })

    it('applies transform then maxLength truncation', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log, {
        toolInputs: {
          transform: (input) => input,
          maxLength: 10,
        },
      })
      const model = createMockModel()
      const wrappedModel = ai.wrap(model)

      vi.mocked(model.doGenerate).mockResolvedValue({
        content: [{ type: 'tool-call', toolCallId: 'tc1', toolName: 'search', input: '{"query":"a very long search query that exceeds the limit"}' },],
        finishReason: createFinishReason('tool-calls'),
        usage: createMockUsage(),
        response: { modelId: 'claude-sonnet-4.6' },
      })

      await wrappedModel.doGenerate(createMockCallOptions())

      const aiData = log.setCalls[log.setCalls.length - 1].ai as Record<string, unknown>
      const inputs = aiData.toolCalls as Array<{ name: string, input: unknown }>
      expect((inputs[0].input as string).endsWith('…')).toBe(true)
      expect((inputs[0].input as string).length).toBeLessThanOrEqual(11)
    })

    it('truncates stream tool inputs with maxLength', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log, { toolInputs: { maxLength: 15 } })
      const model = createMockModel()
      const wrappedModel = ai.wrap(model)

      const chunks: LanguageModelV4StreamPart[] = [
        { type: 'tool-input-start', id: 'tc1', toolName: 'queryDB' },
        { type: 'tool-input-delta', id: 'tc1', delta: '{"sql":"SELECT * FROM events' },
        { type: 'tool-input-delta', id: 'tc1', delta: ' WHERE id = 1"}' },
        { type: 'tool-input-end', id: 'tc1' },
        { type: 'finish', finishReason: createFinishReason('tool-calls'), usage: createMockUsage() },
      ]

      vi.mocked(model.doStream).mockResolvedValue({
        stream: makeReadableStream(chunks),
      })

      const result = await wrappedModel.doStream(createMockCallOptions())
      await consumeStream(result.stream)

      const aiData = log.setCalls[log.setCalls.length - 1].ai as Record<string, unknown>
      const inputs = aiData.toolCalls as Array<{ name: string, input: unknown }>
      expect((inputs[0].input as string).endsWith('…')).toBe(true)
      expect((inputs[0].input as string).length).toBeLessThanOrEqual(16)
    })
  })

  describe('responseId', () => {
    it('captures responseId from doGenerate', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log)
      const model = createMockModel()
      const wrappedModel = ai.wrap(model)

      vi.mocked(model.doGenerate).mockResolvedValue({
        content: [],
        finishReason: createFinishReason(),
        usage: createMockUsage(),
        response: { modelId: 'claude-sonnet-4.6', id: 'msg_01XFDUDYJgAACzvnptvVoYEL' },
      })

      await wrappedModel.doGenerate(createMockCallOptions())

      const aiData = log.setCalls[log.setCalls.length - 1].ai as Record<string, unknown>
      expect(aiData.responseId).toBe('msg_01XFDUDYJgAACzvnptvVoYEL')
    })

    it('captures responseId from stream response-metadata', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log)
      const model = createMockModel()
      const wrappedModel = ai.wrap(model)

      const chunks: LanguageModelV4StreamPart[] = [
        { type: 'response-metadata', id: 'msg_stream_123', modelId: 'claude-sonnet-4.6' } as LanguageModelV4StreamPart,
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
      expect(aiData.responseId).toBe('msg_stream_123')
    })

    it('omits responseId when not provided', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log)
      const model = createMockModel()
      const wrappedModel = ai.wrap(model)

      vi.mocked(model.doGenerate).mockResolvedValue({
        content: [],
        finishReason: createFinishReason(),
        usage: createMockUsage(),
        response: { modelId: 'claude-sonnet-4.6' },
      })

      await wrappedModel.doGenerate(createMockCallOptions())

      const aiData = log.setCalls[log.setCalls.length - 1].ai as Record<string, unknown>
      expect(aiData.responseId).toBeUndefined()
    })
  })

  describe('stepsUsage', () => {
    it('omits stepsUsage for a single call', async () => {
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
      expect(aiData.stepsUsage).toBeUndefined()
      expect(aiData.steps).toBeUndefined()
    })

    it('includes stepsUsage for multiple calls', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log)
      const model = createMockModel()
      const wrappedModel = ai.wrap(model)

      vi.mocked(model.doGenerate)
        .mockResolvedValueOnce({
          content: [{ type: 'tool-call', toolCallId: 'tc1', toolName: 'search', input: '{}' }],
          finishReason: createFinishReason('tool-calls'),
          usage: createMockUsage({ inputTotal: 100, outputTotal: 50 }),
          response: { modelId: 'claude-sonnet-4.6' },
        })
        .mockResolvedValueOnce({
          content: [],
          finishReason: createFinishReason(),
          usage: createMockUsage({ inputTotal: 300, outputTotal: 200 }),
          response: { modelId: 'claude-sonnet-4.6' },
        })

      await wrappedModel.doGenerate(createMockCallOptions())
      await wrappedModel.doGenerate(createMockCallOptions())

      const aiData = log.setCalls[log.setCalls.length - 1].ai as Record<string, unknown>
      expect(aiData.steps).toBe(2)
      const stepsUsage = aiData.stepsUsage as Array<Record<string, unknown>>
      expect(stepsUsage).toHaveLength(2)
      expect(stepsUsage[0]).toEqual({
        model: 'claude-sonnet-4.6',
        inputTokens: 100,
        outputTokens: 50,
        toolCalls: ['search'],
      })
      expect(stepsUsage[1]).toEqual({
        model: 'claude-sonnet-4.6',
        inputTokens: 300,
        outputTokens: 200,
      })
    })

    it('includes stepsUsage with stream calls', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log)
      const model = createMockModel()
      const wrappedModel = ai.wrap(model)

      const chunks1: LanguageModelV4StreamPart[] = [
        { type: 'tool-input-start', id: 'tc1', toolName: 'search' },
        { type: 'tool-input-delta', id: 'tc1', delta: '{}' },
        { type: 'tool-input-end', id: 'tc1' },
        { type: 'finish', finishReason: createFinishReason('tool-calls'), usage: createMockUsage({ inputTotal: 150, outputTotal: 80 }) },
      ]

      const chunks2: LanguageModelV4StreamPart[] = [
        { type: 'text-start', id: 't1' },
        { type: 'text-delta', id: 't1', delta: 'Done' },
        { type: 'text-end', id: 't1' },
        { type: 'finish', finishReason: createFinishReason(), usage: createMockUsage({ inputTotal: 400, outputTotal: 100 }) },
      ]

      vi.mocked(model.doStream)
        .mockResolvedValueOnce({ stream: makeReadableStream(chunks1) })
        .mockResolvedValueOnce({ stream: makeReadableStream(chunks2) })

      const result1 = await wrappedModel.doStream(createMockCallOptions())
      await consumeStream(result1.stream)
      const result2 = await wrappedModel.doStream(createMockCallOptions())
      await consumeStream(result2.stream)

      const aiData = log.setCalls[log.setCalls.length - 1].ai as Record<string, unknown>
      expect(aiData.steps).toBe(2)
      const stepsUsage = aiData.stepsUsage as Array<Record<string, unknown>>
      expect(stepsUsage).toHaveLength(2)
      expect(stepsUsage[0]).toEqual({
        model: 'claude-sonnet-4.6',
        inputTokens: 150,
        outputTokens: 80,
        toolCalls: ['search'],
      })
      expect(stepsUsage[1]).toEqual({
        model: 'claude-sonnet-4.6',
        inputTokens: 400,
        outputTokens: 100,
      })
    })

    it('tracks per-step models in stepsUsage', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log)
      const fast = createMockModel({ provider: 'anthropic', modelId: 'claude-haiku-4.5' })
      const smart = createMockModel({ provider: 'anthropic', modelId: 'claude-sonnet-4.6' })

      const wrappedFast = ai.wrap(fast)
      const wrappedSmart = ai.wrap(smart)

      vi.mocked(fast.doGenerate).mockResolvedValue({
        content: [],
        finishReason: createFinishReason(),
        usage: createMockUsage({ inputTotal: 50, outputTotal: 20 }),
        response: { modelId: 'claude-haiku-4.5' },
      })

      vi.mocked(smart.doGenerate).mockResolvedValue({
        content: [],
        finishReason: createFinishReason(),
        usage: createMockUsage({ inputTotal: 200, outputTotal: 100 }),
        response: { modelId: 'claude-sonnet-4.6' },
      })

      await wrappedFast.doGenerate(createMockCallOptions())
      await wrappedSmart.doGenerate(createMockCallOptions())

      const aiData = log.setCalls[log.setCalls.length - 1].ai as Record<string, unknown>
      const stepsUsage = aiData.stepsUsage as Array<Record<string, unknown>>
      expect(stepsUsage[0].model).toBe('claude-haiku-4.5')
      expect(stepsUsage[1].model).toBe('claude-sonnet-4.6')
    })
  })
})
