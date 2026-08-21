import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearDiskCache, getCacheStats } from "./disk-cache";

describe("clearDiskCache", () => {
  it("should remove cache directory", async () => {
    const cacheDir = ".test-clear-cache";
    mkdirSync(resolve(cacheDir), { recursive: true });
    writeFileSync(join(resolve(cacheDir), "test.json"), "{}");

    expect(existsSync(resolve(cacheDir))).toBe(true);

    await clearDiskCache(cacheDir);

    expect(existsSync(resolve(cacheDir))).toBe(false);
  });

  it("should not throw for non-existent directory", async () => {
    await expect(
      clearDiskCache(".non-existent-cache-dir")
    ).resolves.not.toThrow();
  });
});

describe("getCacheStats", () => {
  const STATS_CACHE_DIR = ".test-stats-cache";

  beforeEach(async () => {
    await clearDiskCache(STATS_CACHE_DIR);
  });

  afterEach(async () => {
    await clearDiskCache(STATS_CACHE_DIR);
  });

  it("should return zeros for empty cache", async () => {
    const stats = await getCacheStats(STATS_CACHE_DIR);
    expect(stats).toEqual({
      totalFiles: 0,
      totalSizeBytes: 0,
      generateCount: 0,
      streamCount: 0,
    });
  });

  it("should count cached files correctly", async () => {
    const cacheDir = resolve(STATS_CACHE_DIR);
    const subDir = join(cacheDir, "ab");
    mkdirSync(subDir, { recursive: true });

    writeFileSync(
      join(subDir, "abc123.json"),
      JSON.stringify({ type: "generate", content: [] })
    );
    writeFileSync(
      join(subDir, "def456.json"),
      JSON.stringify({ type: "stream", parts: [] })
    );

    const stats = await getCacheStats(STATS_CACHE_DIR);
    expect(stats.totalFiles).toBe(2);
    expect(stats.generateCount).toBe(1);
    expect(stats.streamCount).toBe(1);
    expect(stats.totalSizeBytes).toBeGreaterThan(0);
  });

  it("should skip malformed json files when counting cache types", async () => {
    const cacheDir = resolve(STATS_CACHE_DIR);
    const subDir = join(cacheDir, "cd");
    mkdirSync(subDir, { recursive: true });

    writeFileSync(
      join(subDir, "valid.json"),
      JSON.stringify({ type: "generate", content: [] })
    );
    writeFileSync(join(subDir, "broken.json"), "{");

    const stats = await getCacheStats(STATS_CACHE_DIR);
    expect(stats.totalFiles).toBe(2);
    expect(stats.generateCount).toBe(1);
    expect(stats.streamCount).toBe(0);
    expect(stats.totalSizeBytes).toBeGreaterThan(0);
  });
});
