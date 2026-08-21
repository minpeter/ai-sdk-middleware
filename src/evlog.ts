/**
 * LanguageModelV4 port of `evlog/ai` (HugoRCD/evlog, MIT).
 *
 * Upstream: https://github.com/HugoRCD/evlog/blob/main/packages/evlog/src/ai/index.ts
 * Adapted to LanguageModelV4 and hardened for per-model cost accounting,
 * immutable snapshots, and stream cancellation/error accounting.
 * RequestLogger is the full type from `evlog` (not a narrowed surface).
 *
 * @license MIT — Copyright (c) 2026 HugoRCD; V4 port © minpeter / ai-sdk-tool
 */

// biome-ignore-all lint/performance/noBarrelFile: This file is the public package entry point.
export { createAILogger, createAIMiddleware } from "./evlog/logger";
export { createEvlogIntegration } from "./evlog/telemetry";
export type {
  AIEmbeddingData,
  AIEventData,
  AILogger,
  AILoggerOptions,
  AIMetadata,
  AIMetadataListener,
  AIStepUsage,
  AIToolExecution,
  EvlogTelemetry,
  ModelCost,
  ToolInputsOptions,
} from "./evlog/types";
