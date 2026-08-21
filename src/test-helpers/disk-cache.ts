import type {
  LanguageModelV4FinishReason,
  LanguageModelV4StreamPart,
  LanguageModelV4Usage,
} from "@ai-sdk/provider";

export function createMockModel(modelId: string) {
  return { modelId };
}

export function createMockParams(prompt: string) {
  return { prompt };
}

export function createUsage(): LanguageModelV4Usage {
  return {
    inputTokens: {
      total: 10,
      noCache: 10,
      cacheRead: 0,
      cacheWrite: 0,
    },
    outputTokens: {
      total: 5,
      text: 5,
      reasoning: 0,
    },
  };
}

export function createFinishReason(
  unified: LanguageModelV4FinishReason["unified"]
): LanguageModelV4FinishReason {
  return { unified, raw: unified };
}

export async function collectStream(
  stream: ReadableStream<LanguageModelV4StreamPart>
) {
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
