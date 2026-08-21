# Middleware Package

Standalone AI SDK middleware utilities. Disk caching, reasoning extraction, system prompts, and an `evlog/ai` LanguageModelV4 port.

## Support matrix

Same layering as official AI SDK + [evlog AI docs](https://www.evlog.dev/use-cases/ai-sdk/overview):

| Layer | Spec |
|-------|------|
| AI SDK v6 | Primarily `LanguageModelV3` — **not supported here** (use upstream `evlog/ai`) |
| AI SDK v7 (`ai@7`) | Core `LanguageModelV4` (`specificationVersion: "v4"`) — **this package** |
| Core middlewares here | `LanguageModelV4Middleware` only |
| `./evlog` wrap | `LanguageModelV4` + `LanguageModelV4Middleware` |
| Upstream `evlog/ai` wrap | `LanguageModelV3` only; peer `ai >= 6.0.168` |
| Peer `ai` (optional) | `>=7.0.0 <8.0.0` |
| Peer `evlog` (optional) | `>=2.0.0` — full `RequestLogger` type (not a narrowed `{ set }` surface) |
| Peer `@ai-sdk/provider` | `^4` |
| Node.js | `>=22` |

`./evlog` integration mount (v7): `telemetry.integrations`

| Field | Hook |
|-------|------|
| `ai.tools[]` | `onToolExecutionEnd` (v6 name `onToolCallFinish` kept for upstream parity) |
| `ai.totalDurationMs` | `onStart` → `onEnd` (v6 name `onFinish` kept for upstream parity) |
| `ai.embedding` | `onEmbedEnd` or `captureEmbed()` |
| abort / error | `onAbort` / `onError` |

## STRUCTURE

```
src/
├── disk-cache.ts             # LLM response caching
├── reasoning-parser.ts       # Extract reasoning from model output
├── default-system-prompt.ts  # System prompt utilities
├── evlog.ts                  # LanguageModelV4 port of evlog/ai
└── index.ts                  # Package exports (not including evlog)
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Add caching | `disk-cache.ts` | `createDiskCacheMiddleware` |
| Extract reasoning | `reasoning-parser.ts` | `extractReasoningMiddleware` |
| System prompts | `default-system-prompt.ts` | Prompt injection utilities |
| evlog wide-event AI wrap | `evlog.ts` | `createAILogger`, `createAIMiddleware` (subpath only) |

## DISK CACHE

```typescript
import { createDiskCacheMiddleware } from "@ai-sdk-tool/middleware/disk-cache";

const cache = createDiskCacheMiddleware({
  cacheDir: ".cache",
});
```

- Hash-based cache keys (includes package version)
- Skips caching when `finishReason.unified` is `error` or `other`
- Env: `AI_CACHE_ENABLED`, `AI_CACHE_DEBUG`, `AI_CACHE_FORCE_REFRESH`

## REASONING PARSER

```typescript
import { extractReasoningMiddleware } from "@ai-sdk-tool/middleware/reasoning-parser";

const mw = extractReasoningMiddleware({
  openingTag: "<think>",
  closingTag: "</think>",
});
```

## SUBPATH EXPORTS

| Import Path | Export |
|-------------|--------|
| `@ai-sdk-tool/middleware` | Core middlewares (cache, reasoning, system prompt) |
| `@ai-sdk-tool/middleware/disk-cache` | `createDiskCacheMiddleware` |
| `@ai-sdk-tool/middleware/reasoning-parser` | `extractReasoningMiddleware` |
| `@ai-sdk-tool/middleware/evlog` | `createAILogger`, `createAIMiddleware`, `createEvlogIntegration` |

## EVLOG (V4 port)

MIT-licensed port of [HugoRCD/evlog `evlog/ai`](https://github.com/HugoRCD/evlog).

The port keeps the upstream API shape and full `RequestLogger` surface while intentionally adding:

- `LanguageModelV3*` → `LanguageModelV4*` and `specificationVersion: "v4"`
- Per-model cumulative cost accounting
- Immutable public metadata/listener snapshots
- Stream cancellation and source-error accounting

Telemetry hooks, metadata fields, and the official AI test suite remain aligned with upstream and are extended with V4 robustness fixtures.

```typescript
import { createAILogger } from "@ai-sdk-tool/middleware/evlog";

const ai = createAILogger(log); // evlog RequestLogger
const model = ai.wrap(languageModelV4); // or gateway model id string
```

- Peers (optional for subpath): `ai >=7 <8`, `evlog >=2`
- Not re-exported from package root

## NOTES

- Tests: `*.test.ts` colocated
- Build: `tsup` (JS) + `tsc --emitDeclarationOnly` (`.d.ts`; TS7 has no stable Compiler API for tsup dts)
- Any change targeting `main` must go through a pull request first; direct pushes to `main` are forbidden.
