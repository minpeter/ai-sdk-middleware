import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearDiskCache,
  createDiskCacheMiddleware,
  getCacheStats,
} from "./disk-cache";
import {
  createFinishReason,
  createMockModel,
  createMockParams,
  createUsage,
} from "./test-helpers/disk-cache";

const TEST_CACHE_DIR = ".test-ai-cache-generate";

describe("createDiskCacheMiddleware", () => {
  beforeEach(async () => {
    await clearDiskCache(TEST_CACHE_DIR);
  });

  afterEach(async () => {
    await clearDiskCache(TEST_CACHE_DIR);
    vi.unstubAllEnvs();
  });

  describe("wrapGenerate", () => {
    it("should cache generate results on first call", async () => {
      const middleware = createDiskCacheMiddleware({
        cacheDir: TEST_CACHE_DIR,
      });
      const model = createMockModel("test-model");
      const params = createMockParams("Hello");
      let callCount = 0;

      const mockResult = {
        content: [{ type: "text" as const, text: "response" }],
        finishReason: createFinishReason("stop"),
        usage: createUsage(),
        warnings: [],
        response: {
          id: "response-id",
          modelId: "response-model",
          timestamp: new Date("2026-01-02T03:04:05.000Z"),
        },
        providerMetadata: { provider: { cached: true } },
        request: { body: "request-body" },
      };

      const doGenerate = () => {
        callCount++;
        return Promise.resolve(mockResult);
      };

      const wrapGenerate = middleware.wrapGenerate;
      expect(wrapGenerate).toBeDefined();
      if (!wrapGenerate) {
        return;
      }

      const result1 = await wrapGenerate({
        doGenerate,
        params,
        model,
      } as never);

      expect(callCount).toBe(1);
      expect(result1.content).toEqual(mockResult.content);

      const result2 = await wrapGenerate({
        doGenerate,
        params,
        model,
      } as never);

      expect(callCount).toBe(1);
      expect(result2).toEqual(mockResult);
      expect(
        (result2.response as { timestamp?: unknown })?.timestamp
      ).toBeInstanceOf(Date);
    });

    it("should call model for different params", async () => {
      const middleware = createDiskCacheMiddleware({
        cacheDir: TEST_CACHE_DIR,
      });
      const model = createMockModel("test-model");
      let callCount = 0;

      const doGenerate = () => {
        callCount++;
        return Promise.resolve({
          content: [],
          finishReason: createFinishReason("stop"),
          usage: createUsage(),
          warnings: [],
          response: {},
          providerMetadata: {},
          request: {},
        });
      };

      const wrapGenerate = middleware.wrapGenerate;
      expect(wrapGenerate).toBeDefined();
      if (!wrapGenerate) {
        return;
      }

      await wrapGenerate({
        doGenerate,
        params: createMockParams("Hello"),
        model,
      } as never);

      await wrapGenerate({
        doGenerate,
        params: createMockParams("Goodbye"),
        model,
      } as never);

      expect(callCount).toBe(2);
    });

    it("should respect enabled=false option", () => {
      const middleware = createDiskCacheMiddleware({
        cacheDir: TEST_CACHE_DIR,
        enabled: false,
      });

      expect(middleware.specificationVersion).toBe("v4");
      expect(middleware.wrapGenerate).toBeUndefined();
      expect(middleware.wrapStream).toBeUndefined();
    });

    it("should respect AI_CACHE_ENABLED=false env var", () => {
      vi.stubEnv("AI_CACHE_ENABLED", "false");

      const middleware = createDiskCacheMiddleware({
        cacheDir: TEST_CACHE_DIR,
      });

      expect(middleware.wrapGenerate).toBeUndefined();
      expect(middleware.wrapStream).toBeUndefined();
    });

    it("should let an enabled env var override the disabled option", () => {
      vi.stubEnv("AI_CACHE_ENABLED", "1");

      const middleware = createDiskCacheMiddleware({
        cacheDir: TEST_CACHE_DIR,
        enabled: false,
      });

      expect(middleware.wrapGenerate).toBeDefined();
      expect(middleware.wrapStream).toBeDefined();
    });

    it("should expose an identity transform for enabled and disabled modes", async () => {
      const params = createMockParams("identity");
      for (const enabled of [true, false]) {
        const middleware = createDiskCacheMiddleware({
          cacheDir: TEST_CACHE_DIR,
          enabled,
        });
        const transformParams = middleware.transformParams;
        expect(transformParams).toBeDefined();
        if (transformParams) {
          await expect(transformParams({ params } as never)).resolves.toBe(
            params
          );
        }
      }
    });

    it("should use custom generateKey function", async () => {
      const middleware = createDiskCacheMiddleware({
        cacheDir: TEST_CACHE_DIR,
        generateKey: (modelId, _params) => `custom-${modelId}`,
      });
      const model = createMockModel("my-model");
      let callCount = 0;

      const doGenerate = () => {
        callCount++;
        return Promise.resolve({
          content: [],
          finishReason: createFinishReason("stop"),
          usage: createUsage(),
          warnings: [],
          response: {},
          providerMetadata: {},
          request: {},
        });
      };

      const wrapGenerate = middleware.wrapGenerate;
      expect(wrapGenerate).toBeDefined();
      if (!wrapGenerate) {
        return;
      }

      await wrapGenerate({
        doGenerate,
        params: createMockParams("A"),
        model,
      } as never);

      await wrapGenerate({
        doGenerate,
        params: createMockParams("B"),
        model,
      } as never);

      expect(callCount).toBe(1);
    });

    it("should not cache generate results with error finishReason", async () => {
      const middleware = createDiskCacheMiddleware({
        cacheDir: TEST_CACHE_DIR,
      });
      const model = createMockModel("test-model");
      const params = createMockParams("GenerateError");
      let callCount = 0;

      const doGenerate = () => {
        callCount++;
        return Promise.resolve({
          content: [{ type: "text" as const, text: "error-response" }],
          finishReason: createFinishReason("error"),
          usage: createUsage(),
          warnings: [],
          response: {},
          providerMetadata: {},
          request: {},
        });
      };

      const wrapGenerate = middleware.wrapGenerate;
      expect(wrapGenerate).toBeDefined();
      if (!wrapGenerate) {
        return;
      }

      await wrapGenerate({
        doGenerate,
        params,
        model,
      } as never);

      await wrapGenerate({
        doGenerate,
        params,
        model,
      } as never);

      expect(callCount).toBe(2);
    });

    it("should not cache generate results with other finishReason", async () => {
      const middleware = createDiskCacheMiddleware({
        cacheDir: TEST_CACHE_DIR,
      });
      let callCount = 0;
      const doGenerate = () => {
        callCount++;
        return Promise.resolve({
          content: [],
          finishReason: createFinishReason("other"),
          usage: createUsage(),
          warnings: [],
        });
      };
      const wrapGenerate = middleware.wrapGenerate;
      expect(wrapGenerate).toBeDefined();
      if (!wrapGenerate) {
        return;
      }

      for (let i = 0; i < 2; i++) {
        await wrapGenerate({
          doGenerate,
          params: createMockParams("other"),
          model: createMockModel("test"),
        } as never);
      }

      expect(callCount).toBe(2);
    });

    it("should not break generation when the cache path is unwritable", async () => {
      writeFileSync(resolve(TEST_CACHE_DIR), "not-a-directory");
      const middleware = createDiskCacheMiddleware({
        cacheDir: TEST_CACHE_DIR,
      });
      let callCount = 0;
      const doGenerate = () => {
        callCount++;
        return Promise.resolve({
          content: [],
          finishReason: createFinishReason("stop"),
          usage: createUsage(),
          warnings: [],
        });
      };
      const wrapGenerate = middleware.wrapGenerate;
      expect(wrapGenerate).toBeDefined();
      if (!wrapGenerate) {
        return;
      }

      for (let i = 0; i < 2; i++) {
        await expect(
          wrapGenerate({
            doGenerate,
            params: createMockParams("write-failure"),
            model: createMockModel("test"),
          } as never)
        ).resolves.toBeDefined();
      }

      expect(callCount).toBe(2);
    });

    it("should emit debug hit and miss diagnostics", async () => {
      vi.stubEnv("AI_CACHE_DEBUG", "1");
      const consoleSpy = vi
        .spyOn(console, "log")
        .mockImplementation(() => undefined);
      const middleware = createDiskCacheMiddleware({
        cacheDir: TEST_CACHE_DIR,
      });
      const doGenerate = () =>
        Promise.resolve({
          content: [],
          finishReason: createFinishReason("stop"),
          usage: createUsage(),
          warnings: [],
        });
      const wrapGenerate = middleware.wrapGenerate;
      expect(wrapGenerate).toBeDefined();
      if (!wrapGenerate) {
        return;
      }

      for (let i = 0; i < 2; i++) {
        await wrapGenerate({
          doGenerate,
          params: createMockParams("debug"),
          model: createMockModel("test"),
        } as never);
      }

      expect(consoleSpy).toHaveBeenCalledWith(
        "[ai-cache] MISS generate",
        expect.any(String)
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        "[ai-cache] HIT generate",
        expect.any(String)
      );
    });

    it("should recover from malformed cached generate payload", async () => {
      const rawCacheKey = "ab-fixed-key";
      const cacheKey = createHash("sha256").update(rawCacheKey).digest("hex");
      const cacheSubDir = join(resolve(TEST_CACHE_DIR), cacheKey.slice(0, 2));
      const cachePath = join(cacheSubDir, `${cacheKey}.json`);
      mkdirSync(cacheSubDir, { recursive: true });
      writeFileSync(cachePath, "{");

      const middleware = createDiskCacheMiddleware({
        cacheDir: TEST_CACHE_DIR,
        generateKey: () => rawCacheKey,
      });
      const model = createMockModel("test-model");
      const params = createMockParams("MalformedCache");
      let callCount = 0;

      const doGenerate = () => {
        callCount++;
        return Promise.resolve({
          content: [{ type: "text" as const, text: "fresh" }],
          finishReason: createFinishReason("stop"),
          usage: createUsage(),
          warnings: [],
          response: {},
          providerMetadata: {},
          request: {},
        });
      };

      const wrapGenerate = middleware.wrapGenerate;
      expect(wrapGenerate).toBeDefined();
      if (!wrapGenerate) {
        return;
      }

      const result1 = await wrapGenerate({
        doGenerate,
        params,
        model,
      } as never);
      const result2 = await wrapGenerate({
        doGenerate,
        params,
        model,
      } as never);

      expect(result1.content).toEqual(result2.content);
      expect(callCount).toBe(1);
    });

    it("should ignore a valid JSON payload with an invalid generate schema", async () => {
      const rawCacheKey = "invalid-generate-schema";
      const cacheKey = createHash("sha256").update(rawCacheKey).digest("hex");
      const cacheSubDir = join(resolve(TEST_CACHE_DIR), cacheKey.slice(0, 2));
      mkdirSync(cacheSubDir, { recursive: true });
      writeFileSync(
        join(cacheSubDir, `${cacheKey}.json`),
        JSON.stringify({ type: "generate" })
      );

      const middleware = createDiskCacheMiddleware({
        cacheDir: TEST_CACHE_DIR,
        generateKey: () => rawCacheKey,
      });
      let callCount = 0;
      const doGenerate = () => {
        callCount++;
        return Promise.resolve({
          content: [],
          finishReason: createFinishReason("stop"),
          usage: createUsage(),
          warnings: [],
        });
      };
      const wrapGenerate = middleware.wrapGenerate;
      expect(wrapGenerate).toBeDefined();
      if (!wrapGenerate) {
        return;
      }

      await wrapGenerate({
        doGenerate,
        params: createMockParams("invalid"),
        model: createMockModel("test-model"),
      } as never);

      expect(callCount).toBe(1);
    });

    it("should bypass caching when default key serialization fails", async () => {
      const middleware = createDiskCacheMiddleware({
        cacheDir: TEST_CACHE_DIR,
      });
      const params: Record<string, unknown> = { prompt: "circular" };
      params.self = params;
      let callCount = 0;
      const doGenerate = () => {
        callCount++;
        return Promise.resolve({
          content: [],
          finishReason: createFinishReason("stop"),
          usage: createUsage(),
          warnings: [],
        });
      };
      const wrapGenerate = middleware.wrapGenerate;
      expect(wrapGenerate).toBeDefined();
      if (!wrapGenerate) {
        return;
      }

      await wrapGenerate({
        doGenerate,
        params,
        model: createMockModel("test"),
      } as never);
      await wrapGenerate({
        doGenerate,
        params,
        model: createMockModel("test"),
      } as never);

      expect(callCount).toBe(2);
      expect(await getCacheStats(TEST_CACHE_DIR)).toEqual({
        totalFiles: 0,
        totalSizeBytes: 0,
        generateCount: 0,
        streamCount: 0,
      });
    });

    it("should make custom cache keys path-safe", async () => {
      const middleware = createDiskCacheMiddleware({
        cacheDir: TEST_CACHE_DIR,
        generateKey: () => "../../outside-cache",
      });
      let callCount = 0;
      const doGenerate = () => {
        callCount++;
        return Promise.resolve({
          content: [],
          finishReason: createFinishReason("stop"),
          usage: createUsage(),
          warnings: [],
        });
      };
      const wrapGenerate = middleware.wrapGenerate;
      expect(wrapGenerate).toBeDefined();
      if (!wrapGenerate) {
        return;
      }

      for (let i = 0; i < 2; i++) {
        await wrapGenerate({
          doGenerate,
          params: createMockParams("safe"),
          model: createMockModel("test"),
        } as never);
      }

      expect(callCount).toBe(1);
      expect((await getCacheStats(TEST_CACHE_DIR)).generateCount).toBe(1);
    });

    it("should serialize functions and regular expressions in default keys", async () => {
      const middleware = createDiskCacheMiddleware({
        cacheDir: TEST_CACHE_DIR,
      });
      let callCount = 0;
      const doGenerate = () => {
        callCount++;
        return Promise.resolve({
          content: [],
          finishReason: createFinishReason("stop"),
          usage: createUsage(),
          warnings: [],
        });
      };
      const wrapGenerate = middleware.wrapGenerate;
      expect(wrapGenerate).toBeDefined();
      if (!wrapGenerate) {
        return;
      }

      for (let i = 0; i < 2; i++) {
        await wrapGenerate({
          doGenerate,
          params: { callback: () => i, pattern: /test/gi },
          model: createMockModel("test"),
        } as never);
      }

      expect(callCount).toBe(1);
    });

    it("should bypass cache read when forceRefresh=true", async () => {
      const middleware = createDiskCacheMiddleware({
        cacheDir: TEST_CACHE_DIR,
      });
      const forceRefreshMiddleware = createDiskCacheMiddleware({
        cacheDir: TEST_CACHE_DIR,
        forceRefresh: true,
      });
      const model = createMockModel("test-model");
      const params = createMockParams("ForceRefresh");
      let callCount = 0;

      const doGenerate = () => {
        callCount++;
        return Promise.resolve({
          content: [{ type: "text" as const, text: `response-${callCount}` }],
          finishReason: createFinishReason("stop"),
          usage: createUsage(),
          warnings: [],
          response: {},
          providerMetadata: {},
          request: {},
        });
      };

      const wrapGenerate = middleware.wrapGenerate;
      const wrapGenerateForce = forceRefreshMiddleware.wrapGenerate;
      expect(wrapGenerate).toBeDefined();
      expect(wrapGenerateForce).toBeDefined();
      if (!wrapGenerate) {
        return;
      }
      if (!wrapGenerateForce) {
        return;
      }

      await wrapGenerate({
        doGenerate,
        params,
        model,
      } as never);
      expect(callCount).toBe(1);

      await wrapGenerate({
        doGenerate,
        params,
        model,
      } as never);
      expect(callCount).toBe(1);

      await wrapGenerateForce({
        doGenerate,
        params,
        model,
      } as never);
      expect(callCount).toBe(2);
    });

    it("should respect AI_CACHE_FORCE_REFRESH=true env var", async () => {
      const middleware = createDiskCacheMiddleware({
        cacheDir: TEST_CACHE_DIR,
      });
      const model = createMockModel("test-model");
      const params = createMockParams("EnvForceRefresh");
      let callCount = 0;

      const doGenerate = () => {
        callCount++;
        return Promise.resolve({
          content: [],
          finishReason: createFinishReason("stop"),
          usage: createUsage(),
          warnings: [],
          response: {},
          providerMetadata: {},
          request: {},
        });
      };

      const wrapGenerate = middleware.wrapGenerate;
      expect(wrapGenerate).toBeDefined();
      if (!wrapGenerate) {
        return;
      }

      await wrapGenerate({
        doGenerate,
        params,
        model,
      } as never);
      expect(callCount).toBe(1);

      await wrapGenerate({
        doGenerate,
        params,
        model,
      } as never);
      expect(callCount).toBe(1);

      vi.stubEnv("AI_CACHE_FORCE_REFRESH", "1");
      const forceRefreshMiddleware = createDiskCacheMiddleware({
        cacheDir: TEST_CACHE_DIR,
      });
      const wrapGenerateForce = forceRefreshMiddleware.wrapGenerate;
      expect(wrapGenerateForce).toBeDefined();
      if (!wrapGenerateForce) {
        return;
      }

      await wrapGenerateForce({
        doGenerate,
        params,
        model,
      } as never);
      expect(callCount).toBe(2);
    });
  });
});
