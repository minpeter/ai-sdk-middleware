import type {
  LanguageModelV3CallOptions,
  LanguageModelV3Prompt,
} from "@ai-sdk/provider";
import { describe, expect, it } from "vitest";

import { defaultSystemPromptMiddleware } from "./default-system-prompt";

function callTransform(
  mw: ReturnType<typeof defaultSystemPromptMiddleware>,
  prompt: LanguageModelV3Prompt
) {
  const transform = mw.transformParams;
  if (!transform) {
    throw new Error("transformParams is undefined");
  }

  type TransformArg = Parameters<NonNullable<typeof transform>>[0];

  return transform({
    params: { prompt } as LanguageModelV3CallOptions,
  } as TransformArg);
}

describe("defaultSystemPromptMiddleware placement", () => {
  it("first: adds at beginning when missing system", async () => {
    const mw = defaultSystemPromptMiddleware({
      systemPrompt: "SYS",
      placement: "first",
    });
    const prompt = [
      { role: "user", content: [{ type: "text", text: "hello" }] },
    ] as unknown as LanguageModelV3Prompt;
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
    const prompt = [
      { role: "user", content: [{ type: "text", text: "hello" }] },
    ] as unknown as LanguageModelV3Prompt;
    const out = await callTransform(mw, prompt);
    expect(out.prompt.at(-1)?.role).toBe("system");
    expect(String(out.prompt.at(-1)?.content)).toContain("SYS");
  });

  it("does not mutate input prompt array", async () => {
    const mw = defaultSystemPromptMiddleware({
      systemPrompt: "SYS",
      placement: "first",
    });

    const prompt = [
      { role: "user", content: [{ type: "text", text: "hello" }] },
    ] as unknown as LanguageModelV3Prompt;
    const snapshot = structuredClone(prompt);

    await callTransform(mw, prompt);

    expect(prompt).toEqual(snapshot);
  });

  it("first: merges before existing system content", async () => {
    const mw = defaultSystemPromptMiddleware({
      systemPrompt: "ADD",
      placement: "first",
    });
    const prompt = [
      { role: "system", content: "BASE" },
    ] as unknown as LanguageModelV3Prompt;
    const out = await callTransform(mw, prompt);
    const text = String(out.prompt[0].content);
    expect(text.startsWith("ADD\n\nBASE")).toBe(true);
  });

  it("first: merges array-based system content", async () => {
    const mw = defaultSystemPromptMiddleware({
      systemPrompt: "ADD",
      placement: "first",
    });
    const prompt = [
      {
        role: "system",
        content: [{ type: "text", text: "BASE" }],
      },
    ] as unknown as LanguageModelV3Prompt;

    const out = await callTransform(mw, prompt);

    expect(String(out.prompt[0].content)).toBe("ADD\n\nBASE");
  });

  it("last: merges after existing system content", async () => {
    const mw = defaultSystemPromptMiddleware({
      systemPrompt: "ADD",
      placement: "last",
    });
    const prompt = [
      { role: "system", content: "BASE" },
    ] as unknown as LanguageModelV3Prompt;
    const out = await callTransform(mw, prompt);
    const text = String(out.prompt[0].content);
    expect(text.endsWith("BASE\n\nADD")).toBe(true);
  });

  it("merges only the first system message when multiple exist", async () => {
    const mw = defaultSystemPromptMiddleware({
      systemPrompt: "ADD",
      placement: "last",
    });

    const prompt = [
      { role: "system", content: "FIRST" },
      { role: "user", content: [{ type: "text", text: "hello" }] },
      { role: "system", content: "SECOND" },
    ] as unknown as LanguageModelV3Prompt;

    const out = await callTransform(mw, prompt);

    expect(String(out.prompt[0].content)).toBe("FIRST\n\nADD");
    expect(out.prompt[1].role).toBe("user");
    expect(String(out.prompt[2].content)).toBe("SECOND");
  });
});
