# AI SDK Middleware

[![npm](https://img.shields.io/npm/v/@ai-sdk-tool/middleware)](https://www.npmjs.com/package/@ai-sdk-tool/middleware)
[![npm](https://img.shields.io/npm/dt/@ai-sdk-tool/middleware)](https://www.npmjs.com/package/@ai-sdk-tool/middleware)

Reusable middleware utilities for the Vercel AI SDK.

## Installation

```bash
pnpm add @ai-sdk-tool/middleware
```

## Exports

- `@ai-sdk-tool/middleware`
- `@ai-sdk-tool/middleware/disk-cache`
- `@ai-sdk-tool/middleware/reasoning-parser`

## Included middleware

- `createDiskCacheMiddleware`: Disk-based response cache middleware for `generate` and `stream`
- `defaultSystemPromptMiddleware`: Inject or merge system prompts into model input
- `extractReasoningMiddleware`: Extract XML-tagged reasoning into `reasoning` stream/content parts

## Development

```bash
pnpm install
pnpm run typecheck
pnpm run test
pnpm run build
```

## Release flow

- Add a patch/minor/major changeset in `.changeset/*.md`
- Push changes to `main` and let `Release Changeset` workflow open/update the version PR
- Merging the version PR publishes the package to npm automatically
