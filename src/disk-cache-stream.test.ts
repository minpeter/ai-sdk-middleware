import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearDiskCache,
  createDiskCacheMiddleware,
  getCacheStats,
} from "./disk-cache";
import {
  collectStream,
  createFinishReason,
  createMockModel,
  createMockParams,
  createUsage,
} from "./test-helpers/disk-cache";

const TEST_CACHE_DIR = ".test-ai-cache-stream";

describe("createDiskCacheMiddleware", () => {
  beforeEach(async () => {
    await clearDiskCache(TEST_CACHE_DIR);
  });

  afterEach(async () => {
    await clearDiskCache(TEST_CACHE_DIR);
    vi.unstubAllEnvs();
  });

  describe("wrapStream", () => {
    it("should cache stream results on first call", async () => {
      const middleware = createDiskCacheMiddleware({
        cacheDir: TEST_CACHE_DIR,
      });
      const model = createMockModel("test-model");
      const params = createMockParams("Stream test");
      let callCount = 0;

      const mockParts = [
        { type: "text-start", id: "t1" },
        { type: "text-delta", id: "t1", delta: "Hello" },
        { type: "text-delta", id: "t1", delta: " World" },
        { type: "text-end", id: "t1" },
        {
          type: "finish",
          finishReason: createFinishReason("stop"),
          usage: createUsage(),
        },
      ] as LanguageModelV4StreamPart[];

      const doStream = () => {
        callCount++;
        return Promise.resolve({
          stream: new ReadableStream<LanguageModelV4StreamPart>({
            start(controller) {
              for (const part of mockParts) {
                controller.enqueue(part);
              }
              controller.close();
            },
          }),
          response: {
            id: "stream-response",
            timestamp: new Date("2026-02-03T04:05:06.000Z"),
          },
          request: { body: "stream-request" },
        });
      };

      const wrapStream = middleware.wrapStream;
      expect(wrapStream).toBeDefined();
      if (!wrapStream) {
        return;
      }

      const result1 = await wrapStream({
        doStream,
        params,
        model,
      } as never);
      const parts1 = await collectStream(result1.stream);

      expect(callCount).toBe(1);
      expect(parts1).toHaveLength(5);

      const result2 = await wrapStream({
        doStream,
        params,
        model,
      } as never);
      const parts2 = await collectStream(result2.stream);

      expect(callCount).toBe(1);
      expect(parts2).toEqual(parts1);
      expect(result2.response).toEqual({
        id: "stream-response",
        timestamp: new Date("2026-02-03T04:05:06.000Z"),
      });
      expect(
        (result2.response as { timestamp?: unknown })?.timestamp
      ).toBeInstanceOf(Date);
      expect(result2.request).toEqual({ body: "stream-request" });
    });

    it("should ignore a cached stream payload whose parts are invalid", async () => {
      const rawCacheKey = "invalid-stream-schema";
      const cacheKey = createHash("sha256").update(rawCacheKey).digest("hex");
      const cacheSubDir = join(resolve(TEST_CACHE_DIR), cacheKey.slice(0, 2));
      mkdirSync(cacheSubDir, { recursive: true });
      writeFileSync(
        join(cacheSubDir, `${cacheKey}.json`),
        JSON.stringify({ type: "stream", parts: null })
      );

      const middleware = createDiskCacheMiddleware({
        cacheDir: TEST_CACHE_DIR,
        generateKey: () => rawCacheKey,
      });
      let callCount = 0;
      const doStream = () => {
        callCount++;
        return Promise.resolve({
          stream: new ReadableStream<LanguageModelV4StreamPart>({
            start(controller) {
              controller.enqueue({
                type: "finish",
                finishReason: createFinishReason("stop"),
                usage: createUsage(),
              });
              controller.close();
            },
          }),
        });
      };
      const wrapStream = middleware.wrapStream;
      expect(wrapStream).toBeDefined();
      if (!wrapStream) {
        return;
      }

      const result = await wrapStream({
        doStream,
        params: createMockParams("invalid"),
        model: createMockModel("test"),
      } as never);
      await collectStream(result.stream);

      expect(callCount).toBe(1);
    });

    it("should bypass stream caching when key serialization fails", async () => {
      const middleware = createDiskCacheMiddleware({
        cacheDir: TEST_CACHE_DIR,
      });
      const params: Record<string, unknown> = { prompt: "circular-stream" };
      params.self = params;
      let callCount = 0;
      const doStream = () => {
        callCount++;
        return Promise.resolve({
          stream: new ReadableStream<LanguageModelV4StreamPart>({
            start(controller) {
              controller.enqueue({
                type: "finish",
                finishReason: createFinishReason("stop"),
                usage: createUsage(),
              });
              controller.close();
            },
          }),
        });
      };
      const wrapStream = middleware.wrapStream;
      expect(wrapStream).toBeDefined();
      if (!wrapStream) {
        return;
      }

      for (let i = 0; i < 2; i++) {
        const result = await wrapStream({
          doStream,
          params,
          model: createMockModel("test"),
        } as never);
        await collectStream(result.stream);
      }

      expect(callCount).toBe(2);
      expect((await getCacheStats(TEST_CACHE_DIR)).totalFiles).toBe(0);
    });

    it("should not cache a stream without a finish part", async () => {
      const middleware = createDiskCacheMiddleware({
        cacheDir: TEST_CACHE_DIR,
      });
      const model = createMockModel("test-model");
      const params = createMockParams("IncompleteStream");
      let callCount = 0;

      const doStream = () => {
        callCount++;
        return Promise.resolve({
          stream: new ReadableStream<LanguageModelV4StreamPart>({
            start(controller) {
              controller.enqueue({
                type: "text-delta",
                id: "t1",
                delta: "partial",
              });
              controller.close();
            },
          }),
        });
      };

      const wrapStream = middleware.wrapStream;
      expect(wrapStream).toBeDefined();
      if (!wrapStream) {
        return;
      }

      for (let i = 0; i < 2; i++) {
        const result = await wrapStream({ doStream, params, model } as never);
        await collectStream(result.stream);
      }

      expect(callCount).toBe(2);
    });

    it("should not cache stream results when finishReason is other", async () => {
      const middleware = createDiskCacheMiddleware({
        cacheDir: TEST_CACHE_DIR,
      });
      const model = createMockModel("test-model");
      const params = createMockParams("OtherStream");
      let callCount = 0;

      const doStream = () => {
        callCount++;
        return Promise.resolve({
          stream: new ReadableStream<LanguageModelV4StreamPart>({
            start(controller) {
              controller.enqueue({
                type: "finish",
                finishReason: createFinishReason("other"),
                usage: createUsage(),
              });
              controller.close();
            },
          }),
        });
      };

      const wrapStream = middleware.wrapStream;
      expect(wrapStream).toBeDefined();
      if (!wrapStream) {
        return;
      }

      for (let i = 0; i < 2; i++) {
        const result = await wrapStream({ doStream, params, model } as never);
        await collectStream(result.stream);
      }

      expect(callCount).toBe(2);
    });

    it("should not cache stream results when finishReason is error", async () => {
      const middleware = createDiskCacheMiddleware({
        cacheDir: TEST_CACHE_DIR,
      });
      const model = createMockModel("test-model");
      const params = createMockParams("StreamError");
      let callCount = 0;

      const mockParts = [
        { type: "text-start", id: "t1" },
        { type: "text-delta", id: "t1", delta: "partial" },
        { type: "text-end", id: "t1" },
        {
          type: "finish",
          finishReason: createFinishReason("error"),
          usage: createUsage(),
        },
      ] as LanguageModelV4StreamPart[];

      const doStream = () => {
        callCount++;
        return Promise.resolve({
          stream: new ReadableStream<LanguageModelV4StreamPart>({
            start(controller) {
              for (const part of mockParts) {
                controller.enqueue(part);
              }
              controller.close();
            },
          }),
          response: {},
          request: {},
        });
      };

      const wrapStream = middleware.wrapStream;
      expect(wrapStream).toBeDefined();
      if (!wrapStream) {
        return;
      }

      const result1 = await wrapStream({
        doStream,
        params,
        model,
      } as never);
      const parts1 = await collectStream(result1.stream);

      const result2 = await wrapStream({
        doStream,
        params,
        model,
      } as never);
      const parts2 = await collectStream(result2.stream);

      expect(parts1).toEqual(parts2);
      expect(callCount).toBe(2);
    });
  });
});
