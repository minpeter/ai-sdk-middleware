// biome-ignore-all lint: official evlog test port — keep upstream structure
// biome-ignore-all assist: official evlog test port — keep upstream structure
// biome-ignore-all format: official evlog test port — keep upstream structure

import type { LanguageModelV4, LanguageModelV4CallOptions, LanguageModelV4FinishReason, LanguageModelV4StreamPart } from '@ai-sdk/provider'
import type { RequestLogger } from 'evlog'
import { vi } from 'vitest'
import type { EvlogTelemetry } from '../evlog'
import { defined } from './defined'
import { mergeWideEventFields } from './merge-wide-event-fields'

interface MockLogger extends RequestLogger {
  setCalls: Array<Record<string, unknown>>
  /**
   * Cumulative state assembled from every `log.set()` payload using the
   * same merge semantics as evlog's wide-event pipeline. Assert against
   * this when verifying what consumers will see in the drain.
   */
  merged: Record<string, unknown>
}

function createMockLogger(): MockLogger {
  const setCalls: Array<Record<string, unknown>> = []
  const merged: Record<string, unknown> = {}
  return {
    setCalls,
    merged,
    set: vi.fn((data: Record<string, unknown>) => {
      const cloned = structuredClone(data)
      setCalls.push(cloned)
      mergeWideEventFields(merged, structuredClone(data))
    }),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    setLevel: vi.fn(),
    emit: vi.fn(() => null),
    getContext: vi.fn(() => ({})),
  }
}

function createMockUsage(overrides?: Partial<{
  inputTotal: number
  outputTotal: number
  cacheRead: number
  cacheWrite: number
  reasoning: number
}>) {
  return {
    inputTokens: {
      total: overrides?.inputTotal ?? 100,
      noCache: undefined,
      cacheRead: overrides?.cacheRead ?? undefined,
      cacheWrite: overrides?.cacheWrite ?? undefined,
    },
    outputTokens: {
      total: overrides?.outputTotal ?? 50,
      text: undefined,
      reasoning: overrides?.reasoning ?? undefined,
    },
  }
}

type GenerateResult = Awaited<ReturnType<LanguageModelV4['doGenerate']>>
type StreamResult = Awaited<ReturnType<LanguageModelV4['doStream']>>

/** AI SDK generate results require many fields — partial mocks cast once here. */
function asGenerateResult(value: Record<string, unknown>): GenerateResult {
  return value as GenerateResult
}

function asStreamResult(value: Record<string, unknown>): StreamResult {
  return value as StreamResult
}

/**
 * Full LanguageModelV4 surface required by wrapLanguageModel under TS strict
 * (V4 requires supportedUrls; upstream V3 fixtures only Pick'd a subset).
 * doGenerate/doStream stay loose vi.fn mocks so partial result fixtures match upstream tests.
 */
type MockLanguageModel = LanguageModelV4 & {
  doGenerate: ReturnType<typeof vi.fn>
  doStream: ReturnType<typeof vi.fn>
}

function createMockCallOptions(): LanguageModelV4CallOptions {
  return { prompt: [] }
}

function getLastAiData(log: MockLogger): Record<string, unknown> {
  return defined(log.setCalls.at(-1)?.ai, 'last ai payload') as Record<string, unknown>
}

function callIntegrationOnStart(integration: EvlogTelemetry, event?: Record<string, unknown>) {
  defined(integration.onStart, 'onStart')({
    model: { provider: 'anthropic', modelId: 'claude-sonnet-4.6' },
    maxRetries: 0,
    ...event,
  })
}

/** createEvlogIntegration ignores the onFinish/onEnd payload — cast kept in one place. */
function callIntegrationOnFinish(integration: EvlogTelemetry) {
  if (integration.onFinish) {
    integration.onFinish({})
    return
  }
  defined(integration.onEnd, 'onEnd')({})
}

function callIntegrationOnEnd(integration: EvlogTelemetry) {
  defined(integration.onEnd, 'onEnd')({})
}

function callIntegrationOnToolCallFinish(
  integration: EvlogTelemetry,
  input: {
    toolName: string
    durationMs: number
    success: boolean
    output?: unknown
    error?: unknown
  },
) {
  const base = {
    toolCall: { toolName: input.toolName, toolCallId: 'tc1', input: {} },
    durationMs: input.durationMs,
    messages: [],
    stepNumber: undefined,
    model: undefined,
    abortSignal: undefined,
    functionId: undefined,
    metadata: undefined,
    experimental_context: undefined,
  }

  const event = input.success
    ? { ...base, success: true as const, output: input.output ?? {} }
    : { ...base, success: false as const, error: input.error ?? new Error('failed') }

  defined(integration.onToolCallFinish, 'onToolCallFinish')(event)
}

function callIntegrationOnToolExecutionEnd(
  integration: EvlogTelemetry,
  input: {
    toolName: string
    toolExecutionMs: number
    success: boolean
    output?: unknown
    error?: unknown
  },
) {
  const toolOutput = input.success
    ? { type: 'tool-result' as const, output: input.output ?? {} }
    : { type: 'tool-error' as const, error: input.error ?? new Error('failed') }

  defined(integration.onToolExecutionEnd, 'onToolExecutionEnd')({
    callId: 'call-1',
    toolCall: { toolName: input.toolName, toolCallId: 'tc1', input: {} },
    toolExecutionMs: input.toolExecutionMs,
    toolContext: undefined,
    toolOutput,
    messages: [],
  })
}

function callIntegrationOnEmbedEnd(
  integration: EvlogTelemetry,
  input: {
    modelId?: string
    tokens?: number
    dimensions?: number
    count?: number
  } = {},
) {
  const count = input.count ?? 1
  defined(integration.onEmbedEnd, 'onEmbedEnd')({
    callId: 'embed-1',
    embedCallId: 'embed-call-1',
    operationId: 'ai.embed.doEmbed',
    provider: 'openai',
    modelId: input.modelId ?? 'text-embedding-3-small',
    values: Array.from({ length: count }, (_, i) => `value-${i}`),
    embeddings: [{ length: input.dimensions ?? 1536 }],
    usage: { tokens: input.tokens ?? 10 },
  })
}

function callIntegrationOnAbort(integration: EvlogTelemetry, reason?: unknown) {
  defined(integration.onAbort, 'onAbort')({
    callId: 'call-1',
    steps: [],
    ...(reason !== undefined ? { reason } : {}),
  })
}

function callIntegrationOnError(integration: EvlogTelemetry, error: unknown) {
  defined(integration.onError, 'onError')(error)
}

function createMockModel(overrides?: Partial<{ provider: string, modelId: string }>): MockLanguageModel {
  return {
    specificationVersion: 'v4',
    provider: overrides?.provider ?? 'anthropic',
    modelId: overrides?.modelId ?? 'claude-sonnet-4.6',
    supportedUrls: {},
    doGenerate: vi.fn(),
    doStream: vi.fn(),
  } as MockLanguageModel
}

function createFinishReason(unified: LanguageModelV4FinishReason['unified'] = 'stop'): LanguageModelV4FinishReason {
  return { unified, raw: undefined }
}

function makeReadableStream(chunks: LanguageModelV4StreamPart[]): ReadableStream<LanguageModelV4StreamPart> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk)
      }
      controller.close()
    },
  })
}

async function consumeStream(stream: ReadableStream<LanguageModelV4StreamPart>): Promise<LanguageModelV4StreamPart[]> {
  const reader = stream.getReader()
  const result: LanguageModelV4StreamPart[] = []
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    result.push(value)
  }
  return result
}

export {
  asGenerateResult,
  asStreamResult,
  callIntegrationOnAbort,
  callIntegrationOnEmbedEnd,
  callIntegrationOnEnd,
  callIntegrationOnError,
  callIntegrationOnFinish,
  callIntegrationOnStart,
  callIntegrationOnToolCallFinish,
  callIntegrationOnToolExecutionEnd,
  consumeStream,
  createFinishReason,
  createMockCallOptions,
  createMockLogger,
  createMockModel,
  createMockUsage,
  getLastAiData,
  makeReadableStream,
}

export type { MockLanguageModel, MockLogger }
