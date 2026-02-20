import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3Content,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult,
  LanguageModelV3Usage,
} from "@ai-sdk/provider";
import { describe, expect, it } from "vitest";

import {
  extractReasoningMiddleware,
  getPotentialStartIndex,
} from "./reasoning-parser";

const TEST_MODEL: LanguageModelV3 = {
  specificationVersion: "v3",
  provider: "test-provider",
  modelId: "test-model",
  supportedUrls: {},
  doGenerate: async () => createGenerateResult([{ type: "text", text: "" }]),
  doStream: async () => createStreamResult([]),
};

const TEST_PARAMS: LanguageModelV3CallOptions = {
  prompt: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
};

function createUsage(): LanguageModelV3Usage {
  return {
    inputTokens: {
      total: 1,
      noCache: 1,
      cacheRead: 0,
      cacheWrite: 0,
    },
    outputTokens: {
      total: 1,
      text: 1,
      reasoning: 0,
    },
  };
}

function createGenerateResult(
  content: LanguageModelV3Content[]
): LanguageModelV3GenerateResult {
  return {
    content,
    finishReason: {
      unified: "stop",
      raw: "stop",
    },
    usage: createUsage(),
    warnings: [],
  };
}

function createStreamResult(
  parts: LanguageModelV3StreamPart[]
): LanguageModelV3StreamResult {
  return {
    stream: new ReadableStream<LanguageModelV3StreamPart>({
      start(controller) {
        for (const part of parts) {
          controller.enqueue(part);
        }
        controller.close();
      },
    }),
  };
}

async function collectParts(
  stream: ReadableStream<LanguageModelV3StreamPart>
): Promise<LanguageModelV3StreamPart[]> {
  const parts: LanguageModelV3StreamPart[] = [];
  const reader = stream.getReader();

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    parts.push(value);
  }

  return parts;
}

async function runWrapGenerate(
  middleware: ReturnType<typeof extractReasoningMiddleware>,
  content: LanguageModelV3Content[]
): Promise<LanguageModelV3GenerateResult> {
  const wrapGenerate = middleware.wrapGenerate;
  if (!wrapGenerate) {
    throw new Error("wrapGenerate is undefined");
  }

  return await wrapGenerate({
    doGenerate: async () => createGenerateResult(content),
    doStream: async () => createStreamResult([]),
    params: TEST_PARAMS,
    model: TEST_MODEL,
  });
}

async function runWrapStream(
  middleware: ReturnType<typeof extractReasoningMiddleware>,
  inputParts: LanguageModelV3StreamPart[]
): Promise<LanguageModelV3StreamPart[]> {
  const wrapStream = middleware.wrapStream;
  if (!wrapStream) {
    throw new Error("wrapStream is undefined");
  }

  const streamResult = await wrapStream({
    doGenerate: async () => createGenerateResult([{ type: "text", text: "" }]),
    doStream: async () => createStreamResult(inputParts),
    params: TEST_PARAMS,
    model: TEST_MODEL,
  });

  return collectParts(streamResult.stream);
}

describe("getPotentialStartIndex", () => {
  it("returns direct match index", () => {
    expect(getPotentialStartIndex("prefix<think>", "<think>")).toBe(6);
  });

  it("returns suffix overlap index for partial match", () => {
    expect(getPotentialStartIndex("hello</th", "</think>")).toBe(5);
  });

  it("returns null when searched text is empty", () => {
    expect(getPotentialStartIndex("abc", "")).toBeNull();
  });
});

describe("extractReasoningMiddleware wrapGenerate", () => {
  it("keeps content unchanged when tags are missing", async () => {
    const middleware = extractReasoningMiddleware({
      openingTag: "<think>",
      closingTag: "</think>",
    });

    const result = await runWrapGenerate(middleware, [
      { type: "text", text: "plain response" },
    ]);

    expect(result.content).toEqual([{ type: "text", text: "plain response" }]);
  });

  it("extracts reasoning blocks and keeps text with separator", async () => {
    const middleware = extractReasoningMiddleware({
      openingTag: "<think>",
      closingTag: "</think>",
      separator: "\n",
    });

    const result = await runWrapGenerate(middleware, [
      {
        type: "text",
        text: "A<think>reason-1</think>B<think>reason-2</think>C",
      },
    ]);

    expect(result.content).toEqual([
      { type: "reasoning", text: "reason-1\nreason-2" },
      { type: "text", text: "A\nB\nC" },
    ]);
  });

  it("supports startWithReasoning when content starts inside reasoning", async () => {
    const middleware = extractReasoningMiddleware({
      openingTag: "<think>",
      closingTag: "</think>",
      startWithReasoning: true,
    });

    const result = await runWrapGenerate(middleware, [
      { type: "text", text: "plan</think>answer" },
    ]);

    expect(result.content).toEqual([
      { type: "reasoning", text: "plan" },
      { type: "text", text: "answer" },
    ]);
  });
});

describe("extractReasoningMiddleware wrapStream", () => {
  it("extracts reasoning across split tag chunks and preserves non-text parts", async () => {
    const middleware = extractReasoningMiddleware({
      openingTag: "<think>",
      closingTag: "</think>",
      separator: "\n",
    });

    const output = await runWrapStream(middleware, [
      { type: "stream-start", warnings: [] },
      { type: "text-delta", id: "t1", delta: "Before <thi" },
      { type: "text-delta", id: "t1", delta: "nk>why" },
      { type: "text-delta", id: "t1", delta: "</thi" },
      { type: "text-delta", id: "t1", delta: "nk> after" },
      {
        type: "finish",
        usage: createUsage(),
        finishReason: { unified: "stop", raw: "stop" },
      },
    ]);

    expect(output[0]).toEqual({ type: "stream-start", warnings: [] });
    expect(output).toContainEqual({
      type: "text-delta",
      id: "t1",
      delta: "Before ",
    });
    expect(output).toContainEqual({
      type: "reasoning-start",
      id: "reasoning-0",
    });
    expect(output).toContainEqual({
      type: "reasoning-delta",
      id: "reasoning-0",
      delta: "why",
    });
    expect(output).toContainEqual({ type: "reasoning-end", id: "reasoning-0" });
    expect(output).toContainEqual({
      type: "text-delta",
      id: "t1",
      delta: "\n after",
    });
    expect(output.at(-1)?.type).toBe("finish");
  });

  it("supports startWithReasoning for streaming before opening tag appears", async () => {
    const middleware = extractReasoningMiddleware({
      openingTag: "<think>",
      closingTag: "</think>",
      startWithReasoning: true,
    });

    const output = await runWrapStream(middleware, [
      { type: "text-delta", id: "t1", delta: "plan" },
      { type: "text-delta", id: "t1", delta: "</thi" },
      { type: "text-delta", id: "t1", delta: "nk>answer" },
      {
        type: "finish",
        usage: createUsage(),
        finishReason: { unified: "stop", raw: "stop" },
      },
    ]);

    expect(output).toContainEqual({
      type: "reasoning-start",
      id: "reasoning-0",
    });
    expect(output).toContainEqual({
      type: "reasoning-delta",
      id: "reasoning-0",
      delta: "plan",
    });
    expect(output).toContainEqual({ type: "reasoning-end", id: "reasoning-0" });
    expect(output).toContainEqual({
      type: "text-delta",
      id: "t1",
      delta: "answer",
    });
  });

  it("keeps extraction state isolated per stream id", async () => {
    const middleware = extractReasoningMiddleware({
      openingTag: "<think>",
      closingTag: "</think>",
    });

    const output = await runWrapStream(middleware, [
      { type: "text-delta", id: "a", delta: "<think>ra</think>A" },
      { type: "text-delta", id: "b", delta: "<think>rb</think>B" },
      {
        type: "finish",
        usage: createUsage(),
        finishReason: { unified: "stop", raw: "stop" },
      },
    ]);

    const reasoningDeltas = output.filter(
      (
        part
      ): part is Extract<
        LanguageModelV3StreamPart,
        { type: "reasoning-delta" }
      > => part.type === "reasoning-delta"
    );
    const textDeltas = output.filter(
      (
        part
      ): part is Extract<LanguageModelV3StreamPart, { type: "text-delta" }> =>
        part.type === "text-delta"
    );

    expect(reasoningDeltas.map((part) => part.delta)).toEqual(["ra", "rb"]);
    expect(textDeltas).toContainEqual({
      type: "text-delta",
      id: "a",
      delta: "A",
    });
    expect(textDeltas).toContainEqual({
      type: "text-delta",
      id: "b",
      delta: "B",
    });
  });
});
