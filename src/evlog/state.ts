// biome-ignore-all lint: MIT port of HugoRCD/evlog/src/ai — keep upstream-compatible behavior
// biome-ignore-all assist: MIT port of HugoRCD/evlog/src/ai — keep upstream-compatible behavior
// biome-ignore-all format: MIT port of HugoRCD/evlog/src/ai — keep upstream-compatible behavior
import type { RequestLogger } from 'evlog'
import type {
  AccumulatorState,
  AILoggerOptions,
  AIMetadata,
  ToolInputsOptions,
  UsageAccumulator,
  Watermarks,
} from './types'

export function addUsage(
  acc: UsageAccumulator,
  usage: {
    inputTokens: { total: number | undefined, cacheRead?: number | undefined, cacheWrite?: number | undefined }
    outputTokens: { total: number | undefined, reasoning?: number | undefined }
  },
): void {
  acc.inputTokens += usage.inputTokens.total ?? 0
  acc.outputTokens += usage.outputTokens.total ?? 0
  acc.cacheReadTokens += usage.inputTokens.cacheRead ?? 0
  acc.cacheWriteTokens += usage.inputTokens.cacheWrite ?? 0
  acc.reasoningTokens += usage.outputTokens.reasoning ?? 0
}

/** Resolve the real provider and model hidden behind a gateway model ID. */
export function resolveProviderAndModel(provider: string, modelId: string): { provider: string, model: string } {
  if (provider !== 'gateway' || !modelId.includes('/')) {
    return { provider, model: modelId }
  }
  const slashIndex = modelId.indexOf('/')
  return {
    provider: modelId.slice(0, slashIndex),
    model: modelId.slice(slashIndex + 1),
  }
}

function freshWatermarks(): Watermarks {
  return { toolCalls: 0, toolCallInputs: 0, stepsUsage: 0, toolExecutions: 0, models: new Set() }
}

function resolveToolInputs(raw?: boolean | ToolInputsOptions): { enabled: boolean, options: ToolInputsOptions | undefined } {
  if (!raw) return { enabled: false, options: undefined }
  if (raw === true) return { enabled: true, options: undefined }
  return { enabled: true, options: raw }
}

export function processToolInput(
  input: unknown,
  toolName: string,
  options: ToolInputsOptions | undefined,
): unknown {
  let value = input
  if (options?.transform) {
    value = options.transform(value, toolName)
  }
  if (options?.maxLength !== undefined) {
    let str: string
    if (typeof value === 'string') {
      str = value
    } else {
      try {
        str = JSON.stringify(value) ?? String(value)
      } catch {
        str = String(value)
      }
    }
    if (str.length > options.maxLength) {
      return `${str.slice(0, options.maxLength)}…`
    }
  }
  return value
}

export function createAccumulatorState(options?: AILoggerOptions): AccumulatorState {
  const { enabled, options: captureOpts } = resolveToolInputs(options?.toolInputs)
  return {
    calls: 0,
    steps: 0,
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      reasoningTokens: 0,
    },
    models: [],
    lastProvider: undefined,
    allToolCalls: [],
    allToolCallInputs: [],
    stepsUsage: [],
    lastFinishReason: undefined,
    lastMsToFirstChunk: undefined,
    lastMsToFinish: undefined,
    lastError: undefined,
    lastResponseId: undefined,
    lastOutput: undefined,
    toolInputs: enabled,
    toolInputsOptions: captureOpts,
    toolExecutions: [],
    generationStartTime: undefined,
    totalDurationMs: undefined,
    embedding: undefined,
    costMap: options?.cost,
    costUsageByModel: new Map(),
    hasUnattributedCostUsage: false,
    subscribers: new Set(),
    _flushed: freshWatermarks(),
  }
}

export function computeEstimatedCost(state: AccumulatorState): number | undefined {
  if (!state.costMap) return undefined
  if (state.hasUnattributedCostUsage || state.costUsageByModel.size === 0) return undefined

  let total = 0
  for (const [model, usage] of state.costUsageByModel) {
    const pricing = state.costMap[model]
    if (!pricing) return undefined
    total += (usage.inputTokens / 1_000_000) * pricing.input
    total += (usage.outputTokens / 1_000_000) * pricing.output
  }
  return total > 0 ? Math.round(total * 1_000_000) / 1_000_000 : undefined
}

export function recordCostUsage(
  state: AccumulatorState,
  model: string | undefined,
  inputTokens: number,
  outputTokens: number,
): void {
  if (inputTokens === 0 && outputTokens === 0) return
  if (!model) {
    state.hasUnattributedCostUsage = true
    return
  }
  const usage = state.costUsageByModel.get(model) ?? { inputTokens: 0, outputTokens: 0 }
  usage.inputTokens += inputTokens
  usage.outputTokens += outputTokens
  state.costUsageByModel.set(model, usage)
}

function cloneSnapshotValue(value: unknown): unknown {
  try {
    return structuredClone(value)
  } catch {
    return cloneSnapshotValueFallback(value)
  }
}

function cloneSnapshotValueFallback(value: unknown, seen = new WeakMap<object, unknown>()): unknown {
  if (typeof value !== 'object' || value === null) return value
  if (value instanceof Date) return new Date(value)
  const existing = seen.get(value)
  if (existing !== undefined) return existing
  if (value instanceof Map) {
    const clone = new Map<unknown, unknown>()
    seen.set(value, clone)
    for (const [key, item] of value) {
      clone.set(cloneSnapshotValueFallback(key, seen), cloneSnapshotValueFallback(item, seen))
    }
    return clone
  }
  if (value instanceof Set) {
    const clone = new Set<unknown>()
    seen.set(value, clone)
    for (const item of value) clone.add(cloneSnapshotValueFallback(item, seen))
    return clone
  }
  if (Array.isArray(value)) {
    const clone: unknown[] = []
    seen.set(value, clone)
    for (const item of value) clone.push(cloneSnapshotValueFallback(item, seen))
    return clone
  }
  const clone: Record<string, unknown> = {}
  seen.set(value, clone)
  for (const [key, item] of Object.entries(value)) {
    clone[key] = cloneSnapshotValueFallback(item, seen)
  }
  return clone
}

/** Build a full snapshot, or a delta suitable for evlog's array-merging `set`. */
export function buildMetadata(
  state: AccumulatorState,
  since: Watermarks = freshWatermarks(),
): AIMetadata {
  const lastModel = state.models[state.models.length - 1]
  const data: AIMetadata = {
    calls: state.calls,
    inputTokens: state.usage.inputTokens,
    outputTokens: state.usage.outputTokens,
    totalTokens: state.usage.inputTokens + state.usage.outputTokens,
  }

  if (lastModel) data.model = lastModel
  if (state.lastProvider) data.provider = state.lastProvider
  if (state.usage.cacheReadTokens > 0) data.cacheReadTokens = state.usage.cacheReadTokens
  if (state.usage.cacheWriteTokens > 0) data.cacheWriteTokens = state.usage.cacheWriteTokens
  if (state.usage.reasoningTokens > 0) data.reasoningTokens = state.usage.reasoningTokens
  if (state.lastFinishReason) data.finishReason = state.lastFinishReason
  if (state.lastResponseId) data.responseId = state.lastResponseId
  if (state.lastOutput !== undefined) data.output = state.lastOutput
  if (state.lastMsToFirstChunk !== undefined) data.msToFirstChunk = state.lastMsToFirstChunk
  if (state.lastMsToFinish !== undefined) {
    data.msToFinish = state.lastMsToFinish
    if (state.usage.outputTokens > 0 && state.lastMsToFinish > 0) {
      data.tokensPerSecond = Math.round((state.usage.outputTokens / state.lastMsToFinish) * 1000)
    }
  }
  if (state.lastError) data.error = state.lastError
  if (state.totalDurationMs !== undefined) data.totalDurationMs = state.totalDurationMs
  if (state.embedding) data.embedding = { ...state.embedding }
  const cost = computeEstimatedCost(state)
  if (cost !== undefined) data.estimatedCost = cost

  if (state.toolInputs) {
    if (state.allToolCallInputs.length > since.toolCallInputs) {
      data.toolCalls = state.allToolCallInputs.slice(since.toolCallInputs).map(t => ({
        name: t.name,
        input: cloneSnapshotValue(t.input),
      }))
    }
  } else if (state.allToolCalls.length > since.toolCalls) {
    data.toolCalls = state.allToolCalls.slice(since.toolCalls)
  }

  if (state.steps > 1 && state.stepsUsage.length > since.stepsUsage) {
    data.steps = state.steps
    data.stepsUsage = state.stepsUsage
      .slice(since.stepsUsage)
      .map(s => ({ ...s, ...(s.toolCalls ? { toolCalls: [...s.toolCalls] } : {}) }))
  }

  if (state.toolExecutions.length > since.toolExecutions) {
    data.tools = state.toolExecutions.slice(since.toolExecutions).map(t => ({ ...t }))
  }

  const uniqueModels = new Set(state.models)
  if (uniqueModels.size > 1) {
    const newModels = [...uniqueModels].filter(m => !since.models.has(m))
    if (newModels.length > 0) data.models = newModels
  }

  return data
}

function notifySubscribers(state: AccumulatorState): void {
  for (const subscriber of state.subscribers) {
    try {
      subscriber(buildMetadata(state))
    } catch {
      // Subscribers must not break the AI flow.
    }
  }
}

/** Flush the latest scalar values and cumulative-array deltas to evlog. */
export function flushState(log: RequestLogger, state: AccumulatorState): void {
  const flushed = state._flushed
  const data = buildMetadata(state, flushed)

  flushed.toolCalls = state.allToolCalls.length
  flushed.toolCallInputs = state.allToolCallInputs.length
  flushed.toolExecutions = state.toolExecutions.length
  if (data.stepsUsage) flushed.stepsUsage = state.stepsUsage.length
  if (data.models) for (const model of data.models) flushed.models.add(model)

  log.set({ ai: data } as Record<string, unknown>)
  if (state.subscribers.size > 0) notifySubscribers(state)
}

export function recordModel(
  state: AccumulatorState,
  provider: string,
  modelId: string,
  responseModelId?: string,
): { provider: string, model: string } {
  const resolved = resolveProviderAndModel(provider, responseModelId ?? modelId)
  state.models.push(resolved.model)
  state.lastProvider = resolved.provider
  return resolved
}

export function safeParseJSON(input: string): unknown {
  try {
    return JSON.parse(input)
  } catch {
    return input
  }
}

export function extractTextOutput(content: Array<{ type: string, text?: string }>): string | undefined {
  const parts: string[] = []
  for (const item of content) {
    if (item.type === 'text' && typeof item.text === 'string' && item.text.length > 0) {
      parts.push(item.text)
    }
  }
  return parts.length > 0 ? parts.join('') : undefined
}

export function formatTelemetryError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function recordError(
  log: RequestLogger,
  state: AccumulatorState,
  model: { provider: string, modelId: string },
  error: unknown,
): void {
  state.calls++
  state.steps++
  const resolved = recordModel(state, model.provider, model.modelId)
  state.lastFinishReason = 'error'
  state.lastError = formatTelemetryError(error)
  state.stepsUsage.push({ model: resolved.model, inputTokens: 0, outputTokens: 0 })
  flushState(log, state)
}
