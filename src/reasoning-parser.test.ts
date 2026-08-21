import type {
  LanguageModelV4,
  LanguageModelV4CallOptions,
  LanguageModelV4Content,
  LanguageModelV4GenerateResult,
  LanguageModelV4StreamPart,
  LanguageModelV4StreamResult,
  LanguageModelV4Usage,
} from "@ai-sdk/provider";
import { describe, expect, it } from "vitest";

import {
  extractReasoningMiddleware,
  getPotentialStartIndex,
} from "./reasoning-parser";

const TEST_MODEL: LanguageModelV4 = {
  specificationVersion: "v4",
  provider: "test-provider",
  modelId: "test-model",
  supportedUrls: {},
  doGenerate: async () => createGenerateResult([{ type: "text", text: "" }]),
  doStream: async () => createStreamResult([]),
};

const TEST_PARAMS: LanguageModelV4CallOptions = {
  prompt: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
};

function createUsage(): LanguageModelV4Usage {
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
  content: LanguageModelV4Content[]
): LanguageModelV4GenerateResult {
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
  parts: LanguageModelV4StreamPart[]
): LanguageModelV4StreamResult {
  return {
    stream: new ReadableStream<LanguageModelV4StreamPart>({
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
  stream: ReadableStream<LanguageModelV4StreamPart>
): Promise<LanguageModelV4StreamPart[]> {
  const parts: LanguageModelV4StreamPart[] = [];
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
  content: LanguageModelV4Content[]
): Promise<LanguageModelV4GenerateResult> {
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
  inputParts: LanguageModelV4StreamPart[]
): Promise<LanguageModelV4StreamPart[]> {
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

  it("returns null when there is no overlap", () => {
    expect(getPotentialStartIndex("abc", "<think>")).toBeNull();
  });
});

describe("extractReasoningMiddleware wrapGenerate", () => {
  it("rejects empty reasoning tags", () => {
    expect(() =>
      extractReasoningMiddleware({ openingTag: "", closingTag: "</think>" })
    ).toThrow("Reasoning tags must not be empty");
    expect(() =>
      extractReasoningMiddleware({ openingTag: "<think>", closingTag: "" })
    ).toThrow("Reasoning tags must not be empty");
  });

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

  it("keeps non-text parts and transforms text parts only", async () => {
    const middleware = extractReasoningMiddleware({
      openingTag: "<think>",
      closingTag: "</think>",
      separator: "",
    });

    const result = await runWrapGenerate(middleware, [
      { type: "reasoning", text: "existing" },
      { type: "text", text: "A<think>why</think>B" },
    ]);

    expect(result.content).toEqual([
      { type: "reasoning", text: "existing" },
      { type: "reasoning", text: "why" },
      { type: "text", text: "AB" },
    ]);
  });

  it("keeps text unchanged when opening tag is not closed", async () => {
    const middleware = extractReasoningMiddleware({
      openingTag: "<think>",
      closingTag: "</think>",
    });

    const result = await runWrapGenerate(middleware, [
      { type: "text", text: "prefix<think>unfinished" },
    ]);

    expect(result.content).toEqual([
      { type: "text", text: "prefix<think>unfinished" },
    ]);
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

  it("treats regex metacharacters in tags literally", async () => {
    const middleware = extractReasoningMiddleware({
      openingTag: "[think+]",
      closingTag: "[/think+]",
    });

    const result = await runWrapGenerate(middleware, [
      { type: "text", text: "A[think+]why[/think+]B" },
    ]);

    expect(result.content).toEqual([
      { type: "reasoning", text: "why" },
      { type: "text", text: "A\nB" },
    ]);
  });
});

describe("extractReasoningMiddleware wrapStream", () => {
  it("matches generate output across every fixed-width chunk split", async () => {
    const middleware = extractReasoningMiddleware({
      openingTag: "<think>",
      closingTag: "</think>",
      separator: "\n",
    });
    const text = "A<think>reason-1</think>B<think>reason-2</think>C";
    const generated = await runWrapGenerate(middleware, [
      { type: "text", text },
    ]);
    const expectedReasoning = generated.content
      .filter((part) => part.type === "reasoning")
      .map((part) => part.text)
      .join("");
    const expectedText = generated.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("");

    for (let width = 1; width <= text.length; width++) {
      const chunks: LanguageModelV4StreamPart[] = [];
      for (let offset = 0; offset < text.length; offset += width) {
        chunks.push({
          type: "text-delta",
          id: "t1",
          delta: text.slice(offset, offset + width),
        });
      }
      const output = await runWrapStream(middleware, chunks);
      const reasoning = output
        .filter((part) => part.type === "reasoning-delta")
        .map((part) => part.delta)
        .join("");
      const visibleText = output
        .filter((part) => part.type === "text-delta")
        .map((part) => part.delta)
        .join("");

      expect({ reasoning, text: visibleText }).toEqual({
        reasoning: expectedReasoning,
        text: expectedText,
      });
    }
  });

  it("passes through stream chunks unchanged when tags are missing", async () => {
    const middleware = extractReasoningMiddleware({
      openingTag: "<think>",
      closingTag: "</think>",
    });

    const input = [
      { type: "stream-start", warnings: [] },
      { type: "text-delta", id: "t1", delta: "plain response" },
      {
        type: "finish",
        usage: createUsage(),
        finishReason: { unified: "stop", raw: "stop" },
      },
    ] as LanguageModelV4StreamPart[];

    const output = await runWrapStream(middleware, input);

    expect(output[0]).toEqual({ type: "stream-start", warnings: [] });
    expect(output).toContainEqual({
      type: "text-delta",
      id: "t1",
      delta: "plain response",
    });
    expect(output).toContainEqual({
      type: "finish",
      usage: createUsage(),
      finishReason: { unified: "stop", raw: "stop" },
    });

    const reasoningStarts = output.filter(
      (
        part
      ): part is Extract<
        LanguageModelV4StreamPart,
        { type: "reasoning-start" }
      > => part.type === "reasoning-start"
    );
    const reasoningDeltas = output.filter(
      (
        part
      ): part is Extract<
        LanguageModelV4StreamPart,
        { type: "reasoning-delta" }
      > => part.type === "reasoning-delta"
    );

    expect(reasoningStarts).toHaveLength(0);
    expect(reasoningDeltas).toHaveLength(0);
  });

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
        LanguageModelV4StreamPart,
        { type: "reasoning-delta" }
      > => part.type === "reasoning-delta"
    );
    const textDeltas = output.filter(
      (
        part
      ): part is Extract<LanguageModelV4StreamPart, { type: "text-delta" }> =>
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

  it("delays text-start until first non-reasoning text delta", async () => {
    const middleware = extractReasoningMiddleware({
      openingTag: "<think>",
      closingTag: "</think>",
    });

    const output = await runWrapStream(middleware, [
      { type: "text-start", id: "t1" },
      { type: "text-delta", id: "t1", delta: "<think>why</think>answer" },
      { type: "text-end", id: "t1" },
    ]);

    const types = output.map((part) => part.type);
    expect(types.indexOf("reasoning-start")).toBeLessThan(
      types.indexOf("text-start")
    );
    expect(output).toContainEqual({ type: "text-start", id: "t1" });
    expect(output).toContainEqual({
      type: "text-delta",
      id: "t1",
      delta: "answer",
    });
  });

  it("preserves a partial opening tag when the stream finishes", async () => {
    const middleware = extractReasoningMiddleware({
      openingTag: "<think>",
      closingTag: "</think>",
    });

    const output = await runWrapStream(middleware, [
      { type: "text-delta", id: "t1", delta: "answer<thi" },
      {
        type: "finish",
        usage: createUsage(),
        finishReason: { unified: "stop", raw: "stop" },
      },
    ]);

    const text = output
      .filter(
        (
          part
        ): part is Extract<LanguageModelV4StreamPart, { type: "text-delta" }> =>
          part.type === "text-delta"
      )
      .map((part) => part.delta)
      .join("");
    expect(text).toBe("answer<thi");
    expect(output.at(-1)?.type).toBe("finish");
  });

  it("preserves a partial closing tag when the stream finishes", async () => {
    const middleware = extractReasoningMiddleware({
      openingTag: "<think>",
      closingTag: "</think>",
    });

    const output = await runWrapStream(middleware, [
      { type: "text-delta", id: "t1", delta: "<think>plan</thi" },
      {
        type: "finish",
        usage: createUsage(),
        finishReason: { unified: "stop", raw: "stop" },
      },
    ]);

    const reasoning = output
      .filter(
        (
          part
        ): part is Extract<
          LanguageModelV4StreamPart,
          { type: "reasoning-delta" }
        > => part.type === "reasoning-delta"
      )
      .map((part) => part.delta)
      .join("");
    expect(reasoning).toBe("plan</thi");
  });

  it("flushes a partial tag before a terminal stream error", async () => {
    const middleware = extractReasoningMiddleware({
      openingTag: "<think>",
      closingTag: "</think>",
    });

    const output = await runWrapStream(middleware, [
      { type: "text-delta", id: "t1", delta: "answer<thi" },
      { type: "error", error: "provider failed" },
    ]);

    expect(output.map((part) => part.type)).toEqual([
      "text-delta",
      "text-delta",
      "error",
    ]);
    const text = output
      .filter((part) => part.type === "text-delta")
      .map((part) => part.delta)
      .join("");
    expect(text).toBe("answer<thi");
  });

  it("emits a start and end pair for an empty reasoning block", async () => {
    const middleware = extractReasoningMiddleware({
      openingTag: "<think>",
      closingTag: "</think>",
    });

    const output = await runWrapStream(middleware, [
      { type: "text-delta", id: "t1", delta: "<think></think>answer" },
    ]);

    expect(output.slice(0, 2)).toEqual([
      { type: "reasoning-start", id: "reasoning-0" },
      { type: "reasoning-end", id: "reasoning-0" },
    ]);
  });

  it("keeps delayed text lifecycle events isolated per stream id", async () => {
    const middleware = extractReasoningMiddleware({
      openingTag: "<think>",
      closingTag: "</think>",
    });

    const output = await runWrapStream(middleware, [
      { type: "text-start", id: "a" },
      { type: "text-start", id: "b" },
      { type: "text-delta", id: "a", delta: "<think>ra</think>A" },
      { type: "text-delta", id: "b", delta: "<think>rb</think>B" },
      { type: "text-end", id: "a" },
      { type: "text-end", id: "b" },
    ]);

    const indexOf = (type: string, id: string) =>
      output.findIndex(
        (part) => part.type === type && "id" in part && part.id === id
      );
    expect(indexOf("text-start", "a")).toBeLessThan(indexOf("text-delta", "a"));
    expect(indexOf("text-start", "b")).toBeLessThan(indexOf("text-delta", "b"));

    const reasoningIds = output
      .filter((part) => part.type === "reasoning-start")
      .map((part) => part.id);
    expect(reasoningIds).toEqual(["reasoning-0", "reasoning-1"]);
  });

  it("preserves an empty text start/end lifecycle", async () => {
    const middleware = extractReasoningMiddleware({
      openingTag: "<think>",
      closingTag: "</think>",
    });

    const output = await runWrapStream(middleware, [
      { type: "text-start", id: "t1" },
      { type: "text-end", id: "t1" },
    ]);

    expect(output).toEqual([
      { type: "text-start", id: "t1" },
      { type: "text-end", id: "t1" },
    ]);
  });

  it("does not drop a delayed text-start when the source closes early", async () => {
    const middleware = extractReasoningMiddleware({
      openingTag: "<think>",
      closingTag: "</think>",
    });

    const output = await runWrapStream(middleware, [
      { type: "text-start", id: "t1" },
    ]);

    expect(output).toEqual([{ type: "text-start", id: "t1" }]);
  });
});
