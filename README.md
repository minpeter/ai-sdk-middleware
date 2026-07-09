# AI SDK Middleware

[![npm](https://img.shields.io/npm/v/@ai-sdk-tool/middleware)](https://www.npmjs.com/package/@ai-sdk-tool/middleware)
[![npm](https://img.shields.io/npm/dt/@ai-sdk-tool/middleware)](https://www.npmjs.com/package/@ai-sdk-tool/middleware)

Reusable middleware utilities for the Vercel AI SDK **v7** (`LanguageModelV4`), plus an [`evlog/ai`](https://github.com/HugoRCD/evlog) LanguageModelV4 port.

## Support matrix

Aligned with the [official AI SDK layering](https://ai-sdk.dev) and [evlog AI integration](https://www.evlog.dev/use-cases/ai-sdk/overview):

| Layer | Spec |
|-------|------|
| AI SDK v6 | Primarily `LanguageModelV3` / `LanguageModelV3Middleware` |
| AI SDK v7 (`ai@7`) | Core is `LanguageModelV4` (`specificationVersion: "v4"`) |
| This package (core middlewares) | `LanguageModelV4Middleware` only |
| `@ai-sdk-tool/middleware/evlog` wrap | `LanguageModelV4` + `LanguageModelV4Middleware` |
| Upstream `evlog/ai` wrap | `LanguageModelV3` + `LanguageModelV3Middleware` only |
| Peer `ai` (optional, for `./evlog`) | `>=7.0.0 <8.0.0` (LanguageModelV4 wrap — not AI SDK v6) |
| Peer `evlog` (optional, for `./evlog` types) | `>=2.0.0` — full `RequestLogger` type |
| Peer `@ai-sdk/provider` | `^4` (LanguageModelV4 types) |
| Node.js | `>=22` (required for AI SDK v7) |

**Meaning:** this package targets **AI SDK v7 / LanguageModelV4** only. Upstream `evlog/ai` still peers `ai >= 6.0.168` and wraps **V3**; use that for AI SDK v6.

### `./evlog` feature matrix

Capture token usage, tool calls, model info, and streaming metrics into wide events. Requires **AI SDK v7** (`ai >= 7`, Node.js 22+).

For tool execution timing, abort tracking, and auto embed capture, pass `createEvlogIntegration(ai)` to `telemetry.integrations`.

| Data | Source | Description |
|------|--------|-------------|
| tokens, model, provider, stream metrics | middleware (`wrap` / `createAIMiddleware`) | `inputTokens`, `outputTokens`, cache/reasoning tokens, `msToFirstChunk`, `msToFinish`, `tokensPerSecond`, … |
| `ai.tools[]` | `onToolExecutionEnd` | Per-tool `name`, `durationMs`, `success`, `error` |
| `ai.totalDurationMs` | `onStart` → `onEnd` | Wall time from generation start to completion |
| `ai.embedding` | `onEmbedEnd` or `captureEmbed()` | Embeddings |
| `ai.finishReason: 'abort'` | `onAbort` | Aborted stream |
| `ai.error` | `onAbort` / `onError` | Abort reason or unrecoverable error |

Integration still implements the older v6 hook names (`onToolCallFinish`, `onFinish`) for source parity with upstream, but this package only supports AI SDK v7.

## Installation

```bash
pnpm add @ai-sdk-tool/middleware
# for ./evlog:
pnpm add ai@^7
```

## Exports

- `@ai-sdk-tool/middleware`
- `@ai-sdk-tool/middleware/disk-cache`
- `@ai-sdk-tool/middleware/reasoning-parser`
- `@ai-sdk-tool/middleware/evlog` — LanguageModelV4 port of [`evlog/ai`](https://github.com/HugoRCD/evlog) (optional peer: `ai`)

## Included middleware

All middlewares implement `LanguageModelV4Middleware` and work with `wrapLanguageModel` from `ai@7`:

- `createDiskCacheMiddleware`: Disk-based response cache for `generate` and `stream`
- `defaultSystemPromptMiddleware`: Inject or merge system prompts
- `extractReasoningMiddleware`: Extract XML-tagged reasoning into `reasoning` parts
- `createAIMiddleware` / `createAILogger` / `createEvlogIntegration` (`./evlog`): wide-event AI observability (`log.set({ ai })`)

### evlog example (v7)

```ts
import { generateText } from "ai";
import {
  createAILogger,
  createEvlogIntegration,
} from "@ai-sdk-tool/middleware/evlog";

const ai = createAILogger(log); // full evlog RequestLogger

const result = await generateText({
  model: ai.wrap(yourLanguageModelV4), // or gateway model id string
  prompt: "hello",
  telemetry: {
    integrations: [createEvlogIntegration(ai)],
  },
});
```

### Core middleware example

```ts
import { wrapLanguageModel } from "ai";
import { createDiskCacheMiddleware } from "@ai-sdk-tool/middleware/disk-cache";
import { defaultSystemPromptMiddleware } from "@ai-sdk-tool/middleware";

const model = wrapLanguageModel({
  model: yourLanguageModelV4,
  middleware: [
    defaultSystemPromptMiddleware({ systemPrompt: "You are helpful." }),
    createDiskCacheMiddleware({ cacheDir: ".ai-cache" }),
  ],
});
```

## Development

```bash
pnpm install
pnpm run typecheck
pnpm run test
pnpm run build
```

## Release flow

- Add a patch/minor/major changeset in `.changeset/*.md`
- Merge changes to `main` via a pull request, then let `Release Changeset` open/update the version PR
- Merging the version PR publishes the package to npm automatically
