import type {
  LanguageModelV4,
  LanguageModelV4CallOptions,
  LanguageModelV4Prompt,
} from "@ai-sdk/provider";
import { describe, expect, it } from "vitest";

import { defaultSystemPromptMiddleware } from "./default-system-prompt";

const TEST_MODEL: LanguageModelV4 = {
  specificationVersion: "v4",
  provider: "test-provider",
  modelId: "test-model",
  supportedUrls: {},
  doGenerate: async () => {
    throw new Error("not used");
  },
  doStream: async () => {
    throw new Error("not used");
  },
};

function callTransform(
  mw: ReturnType<typeof defaultSystemPromptMiddleware>,
  prompt: LanguageModelV4Prompt
) {
  const transform = mw.transformParams;
  if (!transform) {
    throw new Error("transformParams is undefined");
  }

  return transform({
    type: "generate",
    params: { prompt } as LanguageModelV4CallOptions,
    model: TEST_MODEL,
  });
}

describe("defaultSystemPromptMiddleware placement", () => {
  it("first: adds at beginning when missing system", async () => {
    const mw = defaultSystemPromptMiddleware({
      systemPrompt: "SYS",
      placement: "first",
    });
    const prompt: LanguageModelV4Prompt = [
      { role: "user", content: [{ type: "text", text: "hello" }] },
    ];
    const out = await callTransform(mw, prompt);
    expect(out.prompt[0].role).toBe("system");
    expect(String(out.prompt[0].content)).toContain("SYS");
  });

  it("first: adds at beginning when prompt is empty", async () => {
    const mw = defaultSystemPromptMiddleware({
      systemPrompt: "SYS",
      placement: "first",
    });

    const out = await callTransform(mw, []);

    expect(out.prompt).toEqual([{ role: "system", content: "SYS" }]);
  });

  it("last: appends at end when missing system", async () => {
    const mw = defaultSystemPromptMiddleware({
      systemPrompt: "SYS",
      placement: "last",
    });
    const prompt: LanguageModelV4Prompt = [
      { role: "user", content: [{ type: "text", text: "hello" }] },
    ];
    const out = await callTransform(mw, prompt);
    expect(out.prompt.at(-1)?.role).toBe("system");
    expect(String(out.prompt.at(-1)?.content)).toContain("SYS");
  });

  it("does not mutate input prompt array", async () => {
    const mw = defaultSystemPromptMiddleware({
      systemPrompt: "SYS",
      placement: "first",
    });

    const prompt: LanguageModelV4Prompt = [
      { role: "user", content: [{ type: "text", text: "hello" }] },
    ];
    const snapshot = structuredClone(prompt);

    await callTransform(mw, prompt);

    expect(prompt).toEqual(snapshot);
  });

  it("first: merges before existing system content", async () => {
    const mw = defaultSystemPromptMiddleware({
      systemPrompt: "ADD",
      placement: "first",
    });
    const prompt: LanguageModelV4Prompt = [{ role: "system", content: "BASE" }];
    const out = await callTransform(mw, prompt);
    const text = String(out.prompt[0].content);
    expect(text.startsWith("ADD\n\nBASE")).toBe(true);
  });

  it("last: merges after existing system content", async () => {
    const mw = defaultSystemPromptMiddleware({
      systemPrompt: "ADD",
      placement: "last",
    });
    const prompt: LanguageModelV4Prompt = [{ role: "system", content: "BASE" }];
    const out = await callTransform(mw, prompt);
    const text = String(out.prompt[0].content);
    expect(text.endsWith("BASE\n\nADD")).toBe(true);
  });

  it("merges only the first system message when multiple exist", async () => {
    const mw = defaultSystemPromptMiddleware({
      systemPrompt: "ADD",
      placement: "last",
    });

    const prompt: LanguageModelV4Prompt = [
      { role: "system", content: "FIRST" },
      { role: "user", content: [{ type: "text", text: "hello" }] },
      { role: "system", content: "SECOND" },
    ];

    const out = await callTransform(mw, prompt);

    expect(String(out.prompt[0].content)).toBe("FIRST\n\nADD");
    expect(out.prompt[1].role).toBe("user");
    expect(String(out.prompt[2].content)).toBe("SECOND");
  });

  it("returns specificationVersion v4", () => {
    const mw = defaultSystemPromptMiddleware({
      systemPrompt: "SYS",
    });
    expect(mw.specificationVersion).toBe("v4");
  });
});
