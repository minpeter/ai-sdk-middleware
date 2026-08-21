// biome-ignore-all lint: official evlog test port — keep upstream structure
// biome-ignore-all assist: official evlog test port — keep upstream structure
// biome-ignore-all format: official evlog test port — keep upstream structure

import { createLogger } from 'evlog'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAILogger, createEvlogIntegration } from '../evlog'
import { defined } from '../test-helpers/defined'
import {
  asGenerateResult,
  callIntegrationOnFinish,
  callIntegrationOnStart,
  callIntegrationOnToolCallFinish,
  createFinishReason,
  createMockCallOptions,
  createMockLogger,
  createMockModel,
  createMockUsage,
} from '../test-helpers/evlog'

describe('createAILogger', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('public metadata API', () => {
    describe('getMetadata', () => {
      it('returns an empty snapshot before any activity', () => {
        const log = createMockLogger()
        const ai = createAILogger(log)

        const metadata = ai.getMetadata()
        expect(metadata).toEqual({
          calls: 0,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
        })
        expect(metadata.model).toBeUndefined()
        expect(metadata.provider).toBeUndefined()
      })

      it('returns the same shape as the wide event data', async () => {
        const log = createMockLogger()
        const ai = createAILogger(log, {
          cost: { 'claude-sonnet-4.6': { input: 3, output: 15 } },
        })
        const model = createMockModel()
        const wrappedModel = ai.wrap(model)

        vi.mocked(model.doGenerate).mockResolvedValue({
          content: [{ type: 'tool-call', toolCallId: 'tc1', toolName: 'search', input: '{}' }],
          finishReason: createFinishReason('tool-calls'),
          usage: createMockUsage({ inputTotal: 1_000_000, outputTotal: 500_000 }),
          response: { modelId: 'claude-sonnet-4.6', id: 'msg_abc' },
        })

        await wrappedModel.doGenerate(createMockCallOptions())

        const aiData = log.setCalls[log.setCalls.length - 1].ai as Record<string, unknown>
        const metadata = ai.getMetadata()

        expect(metadata).toEqual(aiData)
        expect(metadata.calls).toBe(1)
        expect(metadata.model).toBe('claude-sonnet-4.6')
        expect(metadata.provider).toBe('anthropic')
        expect(metadata.inputTokens).toBe(1_000_000)
        expect(metadata.outputTokens).toBe(500_000)
        expect(metadata.totalTokens).toBe(1_500_000)
        expect(metadata.estimatedCost).toBe(10.5)
        expect(metadata.responseId).toBe('msg_abc')
        expect(metadata.toolCalls).toEqual(['search'])
        expect(metadata.finishReason).toBe('tool-calls')
      })

      it('returns a fresh copy that does not mutate underlying state', async () => {
        const log = createMockLogger()
        const ai = createAILogger(log)
        const model = createMockModel()
        const wrappedModel = ai.wrap(model)

        vi.mocked(model.doGenerate).mockResolvedValue({
          content: [{ type: 'tool-call', toolCallId: 'tc1', toolName: 'search', input: '{}' }],
          finishReason: createFinishReason('tool-calls'),
          usage: createMockUsage({ inputTotal: 100, outputTotal: 50 }),
          response: { modelId: 'claude-sonnet-4.6' },
        })

        await wrappedModel.doGenerate(createMockCallOptions())

        const first = ai.getMetadata()
        ;(first.toolCalls as string[]).push('mutated')
        first.calls = 999

        const second = ai.getMetadata()
        expect(second.calls).toBe(1)
        expect(second.toolCalls).toEqual(['search'])
      })

      it('deeply isolates captured tool input objects', async () => {
        const log = createMockLogger()
        const ai = createAILogger(log, { toolInputs: true })
        const model = createMockModel()
        const wrappedModel = ai.wrap(model)

        vi.mocked(model.doGenerate).mockResolvedValue(asGenerateResult({
          content: [{
            type: 'tool-call',
            toolCallId: 'tc1',
            toolName: 'search',
            input: { filters: { status: 'active' } },
          }],
          finishReason: createFinishReason('tool-calls'),
          usage: createMockUsage(),
          response: { modelId: 'claude-sonnet-4.6' },
        }))

        await wrappedModel.doGenerate(createMockCallOptions())

        const first = ai.getMetadata()
        const firstInput = (first.toolCalls as Array<{ input: { filters: { status: string } } }>)[0].input
        firstInput.filters.status = 'mutated'

        const secondInput = (ai.getMetadata().toolCalls as Array<{ input: { filters: { status: string } } }>)[0].input
        expect(secondInput.filters.status).toBe('active')
      })

      it('updates after each step in a multi-step run', async () => {
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
        const afterStep1 = ai.getMetadata()
        expect(afterStep1.calls).toBe(1)
        expect(afterStep1.totalTokens).toBe(150)

        await wrappedModel.doGenerate(createMockCallOptions())
        const afterStep2 = ai.getMetadata()
        expect(afterStep2.calls).toBe(2)
        expect(afterStep2.totalTokens).toBe(450)
      })

      it('reflects embedding capture', () => {
        const log = createMockLogger()
        const ai = createAILogger(log)

        ai.captureEmbed({ usage: { tokens: 500 }, model: 'text-embedding-3-small', dimensions: 1536 })

        const metadata = ai.getMetadata()
        expect(metadata.calls).toBe(1)
        expect(metadata.inputTokens).toBe(500)
        expect(metadata.embedding).toEqual({
          tokens: 500,
          model: 'text-embedding-3-small',
          dimensions: 1536,
        })
      })

      it('reflects errors from a failed generation', async () => {
        const log = createMockLogger()
        const ai = createAILogger(log)
        const model = createMockModel()
        const wrappedModel = ai.wrap(model)

        vi.mocked(model.doGenerate).mockRejectedValue(new Error('quota exceeded'))

        await expect(wrappedModel.doGenerate(createMockCallOptions())).rejects.toThrow('quota exceeded')

        const metadata = ai.getMetadata()
        expect(metadata.error).toBe('quota exceeded')
        expect(metadata.finishReason).toBe('error')
      })
    })

    describe('getEstimatedCost', () => {
      it('returns undefined without a cost map', async () => {
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
        expect(ai.getEstimatedCost()).toBeUndefined()
      })

      it('returns the same value as metadata.estimatedCost', async () => {
        const log = createMockLogger()
        const ai = createAILogger(log, {
          cost: { 'claude-sonnet-4.6': { input: 3, output: 15 } },
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

        expect(ai.getEstimatedCost()).toBe(10.5)
        expect(ai.getEstimatedCost()).toBe(ai.getMetadata().estimatedCost)
      })

      it('returns undefined for an unpriced model', async () => {
        const log = createMockLogger()
        const ai = createAILogger(log, { cost: { 'gpt-4o': { input: 2.5, output: 10 } } })
        const model = createMockModel()
        const wrappedModel = ai.wrap(model)

        vi.mocked(model.doGenerate).mockResolvedValue({
          content: [],
          finishReason: createFinishReason(),
          usage: createMockUsage(),
          response: { modelId: 'claude-sonnet-4.6' },
        })

        await wrappedModel.doGenerate(createMockCallOptions())
        expect(ai.getEstimatedCost()).toBeUndefined()
      })
    })

    describe('onUpdate', () => {
      it('fires the callback on each step with a metadata snapshot', async () => {
        const log = createMockLogger()
        const ai = createAILogger(log)
        const model = createMockModel()
        const wrappedModel = ai.wrap(model)

        const updates: Array<ReturnType<typeof ai.getMetadata>> = []
        ai.onUpdate((metadata) => {
          updates.push(metadata)
        })

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

        expect(updates).toHaveLength(2)
        expect(updates[0].calls).toBe(1)
        expect(updates[0].totalTokens).toBe(150)
        expect(updates[1].calls).toBe(2)
        expect(updates[1].totalTokens).toBe(450)
      })

      it('fires on captureEmbed', () => {
        const log = createMockLogger()
        const ai = createAILogger(log)

        const updates: Array<ReturnType<typeof ai.getMetadata>> = []
        ai.onUpdate(metadata => updates.push(metadata))

        ai.captureEmbed({ usage: { tokens: 42 } })

        expect(updates).toHaveLength(1)
        expect(updates[0].embedding).toEqual({ tokens: 42 })
      })

      it('fires on errors', async () => {
        const log = createMockLogger()
        const ai = createAILogger(log)
        const model = createMockModel()
        const wrappedModel = ai.wrap(model)

        const updates: Array<ReturnType<typeof ai.getMetadata>> = []
        ai.onUpdate(metadata => updates.push(metadata))

        vi.mocked(model.doGenerate).mockRejectedValue(new Error('boom'))
        await expect(wrappedModel.doGenerate(createMockCallOptions())).rejects.toThrow('boom')

        expect(updates).toHaveLength(1)
        expect(updates[0].error).toBe('boom')
        expect(updates[0].finishReason).toBe('error')
      })

      it('fires on createEvlogIntegration onFinish when sharing state', async () => {
        const log = createMockLogger()
        const ai = createAILogger(log)
        const integration = createEvlogIntegration(ai)
        const model = createMockModel()
        const wrappedModel = ai.wrap(model)

        const updates: Array<ReturnType<typeof ai.getMetadata>> = []
        ai.onUpdate(metadata => updates.push(metadata))

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
          durationMs: 50,
          success: true,
          output: {},
        })
        callIntegrationOnFinish(integration)

        expect(updates.length).toBeGreaterThanOrEqual(2)
        const last = updates[updates.length - 1]
        expect(last.tools).toHaveLength(1)
        expect(last.totalDurationMs).toBeTypeOf('number')
      })

      it('returns an unsubscribe function', async () => {
        const log = createMockLogger()
        const ai = createAILogger(log)
        const model = createMockModel()
        const wrappedModel = ai.wrap(model)

        let count = 0
        const off = ai.onUpdate(() => {
          count++ 
        })

        vi.mocked(model.doGenerate).mockResolvedValue({
          content: [],
          finishReason: createFinishReason(),
          usage: createMockUsage(),
          response: { modelId: 'claude-sonnet-4.6' },
        })

        await wrappedModel.doGenerate(createMockCallOptions())
        expect(count).toBe(1)

        off()

        await wrappedModel.doGenerate(createMockCallOptions())
        expect(count).toBe(1)
      })

      it('supports multiple subscribers', () => {
        const log = createMockLogger()
        const ai = createAILogger(log)

        let a = 0
        let b = 0
        ai.onUpdate(() => {
          a++ 
        })
        ai.onUpdate(() => {
          b++ 
        })

        ai.captureEmbed({ usage: { tokens: 10 } })
        ai.captureEmbed({ usage: { tokens: 20 } })

        expect(a).toBe(2)
        expect(b).toBe(2)
      })

      it('gives each subscriber an isolated snapshot', () => {
        const log = createMockLogger()
        const ai = createAILogger(log, { toolInputs: true })
        const seen: number[] = []

        ai.onUpdate((metadata) => {
          metadata.calls = 999
          const toolCalls = metadata.toolCalls as Array<{ input: { nested: { value: number } } }> | undefined
          if (toolCalls) toolCalls[0].input.nested.value = 999
        })
        ai.onUpdate((metadata) => {
          seen.push(metadata.calls)
          const toolCalls = metadata.toolCalls as Array<{ input: { nested: { value: number } } }> | undefined
          if (toolCalls) seen.push(toolCalls[0].input.nested.value)
        })

        const model = createMockModel()
        const wrappedModel = ai.wrap(model)
        vi.mocked(model.doGenerate).mockResolvedValue(asGenerateResult({
          content: [{
            type: 'tool-call',
            toolCallId: 'tc1',
            toolName: 'run',
            input: { nested: { value: 1 } },
          }],
          finishReason: createFinishReason('tool-calls'),
          usage: createMockUsage(),
          response: { modelId: 'claude-sonnet-4.6' },
        }))

        return wrappedModel.doGenerate(createMockCallOptions()).then(() => {
          expect(seen).toEqual([1, 1])
        })
      })

      it('isolates subscriber errors so the AI flow continues', async () => {
        const log = createMockLogger()
        const ai = createAILogger(log)
        const model = createMockModel()
        const wrappedModel = ai.wrap(model)

        ai.onUpdate(() => {
          throw new Error('listener crashed')
        })
        let calls = 0
        ai.onUpdate(() => {
          calls++ 
        })

        vi.mocked(model.doGenerate).mockResolvedValue({
          content: [],
          finishReason: createFinishReason(),
          usage: createMockUsage(),
          response: { modelId: 'claude-sonnet-4.6' },
        })

        await expect(wrappedModel.doGenerate(createMockCallOptions())).resolves.toBeDefined()
        expect(calls).toBe(1)
      })

      it('delivers an immutable snapshot to listeners', () => {
        const log = createMockLogger()
        const ai = createAILogger(log)

        const seen: Array<ReturnType<typeof ai.getMetadata>> = []
        ai.onUpdate((metadata) => {
          seen.push(metadata) 
        })

        ai.captureEmbed({ usage: { tokens: 10 } })
        seen[0].calls = 999

        ai.captureEmbed({ usage: { tokens: 20 } })
        expect(seen[1].calls).toBe(2)
      })
    })
  })

  describe('end-to-end with the real logger', () => {
    it('produces a wide event with linear array growth across a multi-step run', async () => {
      const log = createLogger()
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

      const wide = defined(log.emit({ _forceKeep: true }), 'wide event')
      expect(wide).not.toBeNull()
      const aiData = defined(wide.ai, 'wide event ai') as Record<string, unknown>

      expect((aiData.toolCalls as string[])).toEqual(tools)
      expect((aiData.stepsUsage as unknown[])).toHaveLength(tools.length)
      expect(aiData.steps).toBe(tools.length)
      expect(aiData.calls).toBe(tools.length)
      expect(aiData.inputTokens).toBe(100 * tools.length)
      expect(aiData.outputTokens).toBe(20 * tools.length)
    })

    it('keeps `models` deduplicated across many flushes on the real wide event', async () => {
      const log = createLogger()
      const ai = createAILogger(log)

      const gemini = createMockModel({ provider: 'google', modelId: 'gemini-3-flash' })
      const claude = createMockModel({ provider: 'anthropic', modelId: 'claude-sonnet-4.6' })
      const wrappedGemini = ai.wrap(gemini)
      const wrappedClaude = ai.wrap(claude)

      const baseResult = (modelId: string) => ({
        content: [],
        finishReason: createFinishReason(),
        usage: createMockUsage({ inputTotal: 50, outputTotal: 10 }),
        response: { modelId },
      })
      vi.mocked(gemini.doGenerate).mockResolvedValue(baseResult('gemini-3-flash'))
      vi.mocked(claude.doGenerate).mockResolvedValue(baseResult('claude-sonnet-4.6'))

      // Alternate models so each `flushState` re-evaluates the unique set.
      await wrappedGemini.doGenerate(createMockCallOptions())
      await wrappedClaude.doGenerate(createMockCallOptions())
      await wrappedGemini.doGenerate(createMockCallOptions())
      await wrappedClaude.doGenerate(createMockCallOptions())

      const wide = defined(log.emit({ _forceKeep: true }), 'wide event')
      const aiData = defined(wide.ai, 'wide event ai') as Record<string, unknown>
      expect(aiData.models).toEqual(['gemini-3-flash', 'claude-sonnet-4.6'])
    })
  })
})
