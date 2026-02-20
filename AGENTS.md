# Middleware Package

Standalone AI SDK middleware utilities. Disk caching, reasoning extraction, system prompts.

## STRUCTURE

```
src/
├── disk-cache.ts           # LLM response caching
├── reasoning-parser.ts     # Extract reasoning from model output
├── default-system-prompt.ts  # System prompt utilities
└── index.ts                # Package exports
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Add caching | `disk-cache.ts` | `createDiskCacheMiddleware` |
| Extract reasoning | `reasoning-parser.ts` | `extractReasoningMiddleware` |
| System prompts | `default-system-prompt.ts` | Prompt injection utilities |

## DISK CACHE

```typescript
import { createDiskCacheMiddleware } from "@ai-sdk-tool/middleware/disk-cache";

const cache = createDiskCacheMiddleware({
  cacheDir: ".cache",   // Cache directory
  ttl: 3600,           // TTL in seconds
});
```

- Hash-based cache keys
- TTL expiration
- TODO: File locking (see code comments)

## REASONING PARSER

```typescript
import { extractReasoningMiddleware } from "@ai-sdk-tool/middleware/reasoning-parser";

// Extracts <thinking>...</thinking> content from model output
```

- Handles streaming edge cases
- TODO: Additional streaming work needed (see code comments)

## SUBPATH EXPORTS

| Import Path | Export |
|-------------|--------|
| `@ai-sdk-tool/middleware` | All exports |
| `@ai-sdk-tool/middleware/disk-cache` | `createDiskCacheMiddleware` |
| `@ai-sdk-tool/middleware/reasoning-parser` | `extractReasoningMiddleware` |

## NOTES

- Standalone utilities (no internal dependencies)
- Tests: `*.test.ts` colocated
- Non-standard subpath exports: point to `.ts` files, not directories
- Any change targeting `main` must go through a pull request first; direct pushes to `main` are forbidden.
