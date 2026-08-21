/**
 * @license
 * Copyright (c) 2021-present, FriendliAI Inc. All rights reserved.
 */

import type {
  LanguageModelV4Content,
  LanguageModelV4Middleware,
  LanguageModelV4StreamPart,
} from "@ai-sdk/provider";

/**
 * Forked from AI SDK extract-reasoning middleware and adapted for
 * LanguageModelV4. Upstream reference:
 * https://github.com/vercel/ai/blob/main/packages/ai/src/middleware/extract-reasoning-middleware.ts
 */

/**
 * Returns the index of the start of the searchedText in the text, or null if it
 * is not found.
 */
export function getPotentialStartIndex(
  text: string,
  searchedText: string
): number | null {
  if (searchedText.length === 0) {
    return null;
  }

  const directIndex = text.indexOf(searchedText);
  if (directIndex !== -1) {
    return directIndex;
  }

  for (let i = text.length - 1; i >= 0; i -= 1) {
    const suffix = text.substring(i);
    if (searchedText.startsWith(suffix)) {
      return i;
    }
  }

  return null;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Extract an XML-tagged reasoning section from the generated text and exposes it
 * as a `reasoning` property on the result.
 *
 * @param openingTag - The opening XML tag to extract reasoning from.
 * @param closingTag - The closing XML tag to extract reasoning from.
 * @param separator - The separator to use between reasoning and text sections.
 * @param startWithReasoning - Whether to start with reasoning tokens.
 */
export function extractReasoningMiddleware({
  openingTag,
  closingTag,
  separator = "\n",
  startWithReasoning = false,
}: {
  openingTag: string;
  closingTag: string;
  separator?: string;
  startWithReasoning?: boolean;
}): LanguageModelV4Middleware {
  if (openingTag.length === 0 || closingTag.length === 0) {
    throw new Error("Reasoning tags must not be empty");
  }

  return {
    specificationVersion: "v4",
    wrapGenerate: async ({ doGenerate }) => {
      const { content, ...rest } = await doGenerate();

      const transformedContent: LanguageModelV4Content[] = [];
      for (const part of content) {
        if (part.type !== "text") {
          transformedContent.push(part);
          continue;
        }

        const text = startWithReasoning ? openingTag + part.text : part.text;
        const regexp = new RegExp(
          `${escapeRegExp(openingTag)}(.*?)${escapeRegExp(closingTag)}`,
          "gs"
        );
        const matches = Array.from(text.matchAll(regexp));

        if (!matches.length) {
          transformedContent.push(part);
          continue;
        }

        const reasoningText = matches.map((match) => match[1]).join(separator);

        let textWithoutReasoning = text;
        for (let i = matches.length - 1; i >= 0; i -= 1) {
          const match = matches[i];
          const matchIndex = match.index ?? 0;

          const beforeMatch = textWithoutReasoning.slice(0, matchIndex);
          const afterMatch = textWithoutReasoning.slice(
            matchIndex + match[0].length
          );

          textWithoutReasoning =
            beforeMatch +
            (beforeMatch.length > 0 && afterMatch.length > 0 ? separator : "") +
            afterMatch;
        }

        transformedContent.push({
          type: "reasoning",
          text: reasoningText,
        });

        transformedContent.push({
          type: "text",
          text: textWithoutReasoning,
        });
      }

      return { content: transformedContent, ...rest };
    },

    wrapStream: async ({ doStream }) => {
      const { stream, ...rest } = await doStream();

      interface ExtractionState {
        afterSwitch: boolean;
        buffer: string;
        isFirstReasoning: boolean;
        isFirstText: boolean;
        isReasoning: boolean;
        reasoningId?: string;
        textId: string;
      }

      const reasoningExtractions: Record<string, ExtractionState> = {};
      const delayedTextStarts = new Map<string, LanguageModelV4StreamPart>();
      let reasoningIdCounter = 0;

      function getReasoningId(activeExtraction: ExtractionState): string {
        activeExtraction.reasoningId ??= `reasoning-${reasoningIdCounter++}`;
        return activeExtraction.reasoningId;
      }

      function publish(
        activeExtraction: ExtractionState,
        controller: TransformStreamDefaultController<LanguageModelV4StreamPart>,
        text: string
      ) {
        if (text.length === 0) {
          return;
        }

        const prefix =
          activeExtraction.afterSwitch &&
          (activeExtraction.isReasoning
            ? !activeExtraction.isFirstReasoning
            : !activeExtraction.isFirstText)
            ? separator
            : "";

        if (
          activeExtraction.isReasoning &&
          (activeExtraction.afterSwitch || activeExtraction.isFirstReasoning)
        ) {
          controller.enqueue({
            type: "reasoning-start",
            id: getReasoningId(activeExtraction),
          });
        }

        if (activeExtraction.isReasoning) {
          controller.enqueue({
            type: "reasoning-delta",
            delta: prefix + text,
            id: getReasoningId(activeExtraction),
          });
        } else {
          const delayedTextStart = delayedTextStarts.get(
            activeExtraction.textId
          );
          if (delayedTextStart) {
            controller.enqueue(delayedTextStart);
            delayedTextStarts.delete(activeExtraction.textId);
          }
          controller.enqueue({
            type: "text-delta",
            delta: prefix + text,
            id: activeExtraction.textId,
          });
        }

        activeExtraction.afterSwitch = false;

        if (activeExtraction.isReasoning) {
          activeExtraction.isFirstReasoning = false;
        } else {
          activeExtraction.isFirstText = false;
        }
      }

      function flushExtraction(
        activeExtraction: ExtractionState,
        controller: TransformStreamDefaultController<LanguageModelV4StreamPart>
      ) {
        publish(activeExtraction, controller, activeExtraction.buffer);
        activeExtraction.buffer = "";
      }

      function flushAll(
        controller: TransformStreamDefaultController<LanguageModelV4StreamPart>
      ) {
        for (const activeExtraction of Object.values(reasoningExtractions)) {
          flushExtraction(activeExtraction, controller);
        }
        for (const delayedTextStart of delayedTextStarts.values()) {
          controller.enqueue(delayedTextStart);
        }
        delayedTextStarts.clear();
      }

      return {
        stream: stream.pipeThrough(
          new TransformStream<
            LanguageModelV4StreamPart,
            LanguageModelV4StreamPart
          >({
            transform: (chunk, controller) => {
              // Do not send `text-start` before `reasoning-start`
              // https://github.com/vercel/ai/issues/7774
              if (chunk.type === "text-start") {
                delayedTextStarts.set(chunk.id, chunk);
                return;
              }

              if (chunk.type === "text-end") {
                const activeExtraction = reasoningExtractions[chunk.id];
                if (activeExtraction) {
                  flushExtraction(activeExtraction, controller);
                }
                const delayedTextStart = delayedTextStarts.get(chunk.id);
                if (delayedTextStart) {
                  controller.enqueue(delayedTextStart);
                  delayedTextStarts.delete(chunk.id);
                }
                controller.enqueue(chunk);
                return;
              }

              if (chunk.type === "finish" || chunk.type === "error") {
                flushAll(controller);
                controller.enqueue(chunk);
                return;
              }

              if (chunk.type !== "text-delta") {
                controller.enqueue(chunk);
                return;
              }

              if (reasoningExtractions[chunk.id] == null) {
                reasoningExtractions[chunk.id] = {
                  isFirstReasoning: true,
                  isFirstText: true,
                  afterSwitch: false,
                  isReasoning: startWithReasoning,
                  buffer: "",
                  textId: chunk.id,
                };
              }

              const activeExtraction = reasoningExtractions[chunk.id];
              activeExtraction.buffer += chunk.delta;

              do {
                const nextTag = activeExtraction.isReasoning
                  ? closingTag
                  : openingTag;

                const startIndex = getPotentialStartIndex(
                  activeExtraction.buffer,
                  nextTag
                );

                if (startIndex == null) {
                  publish(
                    activeExtraction,
                    controller,
                    activeExtraction.buffer
                  );
                  activeExtraction.buffer = "";
                  break;
                }

                publish(
                  activeExtraction,
                  controller,
                  activeExtraction.buffer.slice(0, startIndex)
                );

                const foundFullMatch =
                  startIndex + nextTag.length <= activeExtraction.buffer.length;

                if (foundFullMatch) {
                  activeExtraction.buffer = activeExtraction.buffer.slice(
                    startIndex + nextTag.length
                  );

                  if (activeExtraction.isReasoning) {
                    // Empty reasoning blocks still need start/end pair
                    if (activeExtraction.isFirstReasoning) {
                      controller.enqueue({
                        type: "reasoning-start",
                        id: getReasoningId(activeExtraction),
                      });
                    }

                    controller.enqueue({
                      type: "reasoning-end",
                      id: getReasoningId(activeExtraction),
                    });
                    activeExtraction.reasoningId = undefined;
                  }

                  activeExtraction.isReasoning = !activeExtraction.isReasoning;
                  activeExtraction.afterSwitch = true;
                } else {
                  activeExtraction.buffer =
                    activeExtraction.buffer.slice(startIndex);
                  break;
                }
              } while (true);
            },
            flush: (controller) => {
              flushAll(controller);
            },
          })
        ),
        ...rest,
      };
    },
  };
}
