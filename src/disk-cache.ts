import { createHash } from "node:crypto";
import {
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type {
  LanguageModelV4Middleware,
  LanguageModelV4StreamPart,
} from "@ai-sdk/provider";

declare const __PACKAGE_VERSION__: string;

const SHA256_KEY_PATTERN = /^[a-f0-9]{64}$/;

export interface DiskCacheMiddlewareOptions {
  cacheDir?: string;
  debug?: boolean;
  enabled?: boolean;
  forceRefresh?: boolean;
  generateKey?: (modelId: string, params: unknown) => string;
}

interface CachedGenerateResult {
  content: unknown;
  finishReason: unknown;
  providerMetadata: unknown;
  request: unknown;
  response: unknown;
  type: "generate";
  usage: unknown;
  warnings: unknown;
}

interface CachedStreamResult {
  parts: LanguageModelV4StreamPart[];
  request: unknown;
  response: unknown;
  type: "stream";
}

type CachedResult = CachedGenerateResult | CachedStreamResult;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isCachedResult(value: unknown): value is CachedResult {
  if (!isRecord(value)) {
    return false;
  }
  if (value.type === "stream") {
    return Array.isArray(value.parts);
  }
  return (
    value.type === "generate" &&
    Array.isArray(value.content) &&
    isRecord(value.finishReason) &&
    isRecord(value.usage)
  );
}

function defaultGenerateKey(modelId: string, params: unknown): string {
  const serialized = JSON.stringify(
    { version: __PACKAGE_VERSION__, modelId, params },
    (_key, value) => {
      if (typeof value === "function") {
        return "[function]";
      }
      if (value instanceof RegExp) {
        return value.toString();
      }
      return value;
    }
  );
  return createHash("sha256").update(serialized).digest("hex");
}

function getCachePath(cacheDir: string, key: string): string {
  return join(cacheDir, key.slice(0, 2), `${key}.json`);
}

function normalizeCacheKey(key: string): string {
  return SHA256_KEY_PATTERN.test(key)
    ? key
    : createHash("sha256").update(key).digest("hex");
}

async function readCache(cachePath: string): Promise<CachedResult | null> {
  try {
    const content = await readFile(cachePath, "utf-8");
    const parsed: unknown = JSON.parse(content);
    if (!isCachedResult(parsed)) {
      return null;
    }
    if (parsed.response && typeof parsed.response === "object") {
      const resp = parsed.response as Record<string, unknown>;
      if (typeof resp.timestamp === "string") {
        resp.timestamp = new Date(resp.timestamp);
      }
    }
    return parsed;
  } catch {
    return null;
  }
}

async function writeCache(
  cachePath: string,
  result: CachedResult
): Promise<void> {
  try {
    await mkdir(dirname(cachePath), { recursive: true });
    await writeFile(cachePath, JSON.stringify(result), "utf-8");
  } catch {
    // Silent fail — cache write must not break generation
  }
}

function createStreamFromParts(
  parts: LanguageModelV4StreamPart[]
): ReadableStream<LanguageModelV4StreamPart> {
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      if (index < parts.length) {
        controller.enqueue(parts[index++]);
      } else {
        controller.close();
      }
    },
  });
}

type FinishReasonLike = { unified?: string } | string | null | undefined;

function isErrorFinishReason(finishReason: FinishReasonLike): boolean {
  if (!finishReason) {
    return false;
  }
  const unified =
    typeof finishReason === "string" ? finishReason : finishReason.unified;
  return unified === "error" || unified === "other";
}

export function createDiskCacheMiddleware(
  options: DiskCacheMiddlewareOptions = {}
): LanguageModelV4Middleware {
  const generateKey = options.generateKey ?? defaultGenerateKey;
  const resolvedCacheDir = resolve(options.cacheDir ?? ".ai-cache");

  const envEnabled = process.env.AI_CACHE_ENABLED;
  const enabled =
    envEnabled === undefined
      ? (options.enabled ?? true)
      : envEnabled.toLowerCase() === "true" || envEnabled === "1";

  const envDebug = process.env.AI_CACHE_DEBUG;
  const debug =
    envDebug === undefined
      ? (options.debug ?? false)
      : envDebug.toLowerCase() === "true" || envDebug === "1";

  const envForceRefresh = process.env.AI_CACHE_FORCE_REFRESH;
  const forceRefresh =
    envForceRefresh === undefined
      ? (options.forceRefresh ?? false)
      : envForceRefresh.toLowerCase() === "true" || envForceRefresh === "1";

  const log = debug
    ? (msg: string, data?: unknown) =>
        console.log(`[ai-cache] ${msg}`, data ?? "")
    : () => undefined;

  function createCacheKey(modelId: string, params: unknown): string | null {
    try {
      return normalizeCacheKey(generateKey(modelId, params));
    } catch (error) {
      log("SKIP cache (key generation failed)", error);
      return null;
    }
  }

  if (!enabled) {
    return {
      specificationVersion: "v4",
      transformParams: async ({ params }) => params,
    };
  }

  return {
    specificationVersion: "v4",

    transformParams: async ({ params }) => params,

    wrapGenerate: async ({ doGenerate, params, model }) => {
      const cacheKey = createCacheKey(model.modelId, params);
      if (!cacheKey) {
        return doGenerate();
      }
      const cachePath = getCachePath(resolvedCacheDir, cacheKey);

      if (!forceRefresh) {
        const cached = await readCache(cachePath);
        if (cached?.type === "generate") {
          log("HIT generate", cacheKey.slice(0, 8));
          return {
            content: cached.content,
            finishReason: cached.finishReason,
            usage: cached.usage,
            warnings: cached.warnings,
            response: cached.response,
            providerMetadata: cached.providerMetadata,
            request: cached.request,
          } as Awaited<ReturnType<typeof doGenerate>>;
        }
      }

      log(
        forceRefresh ? "REFRESH generate" : "MISS generate",
        cacheKey.slice(0, 8)
      );
      const result = await doGenerate();

      if (isErrorFinishReason(result.finishReason)) {
        log("SKIP cache (error response)", result.finishReason);
      } else {
        await writeCache(cachePath, {
          type: "generate",
          content: result.content,
          finishReason: result.finishReason,
          usage: result.usage,
          warnings: result.warnings,
          response: result.response,
          providerMetadata: result.providerMetadata,
          request: result.request,
        });
      }

      return result;
    },

    wrapStream: async ({ doStream, params, model }) => {
      const cacheKey = createCacheKey(model.modelId, params);
      if (!cacheKey) {
        return doStream();
      }
      const cachePath = getCachePath(resolvedCacheDir, cacheKey);

      if (!forceRefresh) {
        const cached = await readCache(cachePath);
        if (cached?.type === "stream") {
          log("HIT stream", {
            key: cacheKey.slice(0, 8),
            parts: cached.parts.length,
          });
          return {
            stream: createStreamFromParts(cached.parts),
            response: cached.response,
            request: cached.request,
          } as Awaited<ReturnType<typeof doStream>>;
        }
      }

      log(
        forceRefresh ? "REFRESH stream" : "MISS stream",
        cacheKey.slice(0, 8)
      );
      const result = await doStream();

      const collectedParts: LanguageModelV4StreamPart[] = [];

      const cachedStream = result.stream.pipeThrough(
        new TransformStream<
          LanguageModelV4StreamPart,
          LanguageModelV4StreamPart
        >({
          transform(chunk, controller) {
            collectedParts.push(chunk);
            controller.enqueue(chunk);
          },
          async flush() {
            const finishPart = collectedParts.find((p) => p.type === "finish");
            if (!finishPart || isErrorFinishReason(finishPart.finishReason)) {
              return;
            }

            await writeCache(cachePath, {
              type: "stream",
              parts: collectedParts,
              response: result.response,
              request: result.request,
            });
          },
        })
      );

      return { ...result, stream: cachedStream };
    },
  };
}

export async function clearDiskCache(cacheDir = ".ai-cache"): Promise<void> {
  try {
    await rm(resolve(cacheDir), { recursive: true, force: true });
  } catch {
    // Directory doesn't exist
  }
}

export async function getCacheStats(cacheDir = ".ai-cache"): Promise<{
  totalFiles: number;
  totalSizeBytes: number;
  generateCount: number;
  streamCount: number;
}> {
  const resolvedDir = resolve(cacheDir);
  let totalFiles = 0;
  let totalSizeBytes = 0;
  let generateCount = 0;
  let streamCount = 0;

  async function walkDir(dir: string): Promise<void> {
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      await Promise.all(
        entries.map(async (entry) => {
          const fullPath = join(dir, entry.name);
          if (entry.isDirectory()) {
            await walkDir(fullPath);
          } else if (entry.name.endsWith(".json")) {
            totalFiles++;
            const fileStat = await stat(fullPath);
            totalSizeBytes += fileStat.size;

            try {
              const content = JSON.parse(
                await readFile(fullPath, "utf-8")
              ) as CachedResult;
              if (content.type === "generate") {
                generateCount++;
              } else if (content.type === "stream") {
                streamCount++;
              }
            } catch {
              // Skip malformed
            }
          }
        })
      );
    } catch {
      // Directory doesn't exist
    }
  }

  await walkDir(resolvedDir);
  return { totalFiles, totalSizeBytes, generateCount, streamCount };
}
