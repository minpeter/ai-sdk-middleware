import type {
  LanguageModelV4CallOptions,
  LanguageModelV4Middleware,
  LanguageModelV4Prompt,
} from "@ai-sdk/provider";

type SystemPromptPlacement = "first" | "last";

interface DefaultSystemPromptMiddlewareOptions {
  placement?: SystemPromptPlacement;
  systemPrompt: string;
}

function mergeSystemPrompts({
  base,
  addition,
  placement,
}: {
  base?: string;
  addition: string;
  placement: SystemPromptPlacement;
}): string {
  if (!base) {
    return addition;
  }

  if (addition.length === 0) {
    return base;
  }

  return placement === "first"
    ? `${addition}\n\n${base}`
    : `${base}\n\n${addition}`;
}

function ensurePromptArray(
  prompt?: LanguageModelV4Prompt
): LanguageModelV4Prompt {
  if (!prompt) {
    return [];
  }

  return [...prompt];
}

export function defaultSystemPromptMiddleware({
  systemPrompt,
  placement = "first",
}: DefaultSystemPromptMiddlewareOptions): LanguageModelV4Middleware {
  return {
    specificationVersion: "v4",
    transformParams: ({ params }) => {
      const prompt = ensurePromptArray(params.prompt);
      const systemIndex = prompt.findIndex(
        (message) => message.role === "system"
      );

      if (systemIndex === -1) {
        const promptWithSystem: LanguageModelV4Prompt =
          placement === "first"
            ? [
                {
                  role: "system",
                  content: systemPrompt,
                },
                ...prompt,
              ]
            : [
                ...prompt,
                {
                  role: "system",
                  content: systemPrompt,
                },
              ];

        const nextParams: LanguageModelV4CallOptions = {
          ...params,
          prompt: promptWithSystem,
        };

        return Promise.resolve(nextParams);
      }

      const systemMessage = prompt[systemIndex];
      if (systemMessage.role !== "system") {
        return Promise.resolve(params);
      }

      const mergedContent = mergeSystemPrompts({
        base: systemMessage.content,
        addition: systemPrompt,
        placement,
      });

      const updatedPrompt: LanguageModelV4Prompt = [...prompt];
      updatedPrompt[systemIndex] = {
        ...systemMessage,
        content: mergedContent,
      };

      const nextParams: LanguageModelV4CallOptions = {
        ...params,
        prompt: updatedPrompt,
      };

      return Promise.resolve(nextParams);
    },
  };
}
