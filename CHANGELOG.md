# @ai-sdk-tool/middleware

## 0.1.0

### Minor Changes

- 43aab65: Target AI SDK v7 / LanguageModelV4 middleware.

  - All middlewares now implement `LanguageModelV4Middleware` (`specificationVersion: "v4"`)
  - Peer: `@ai-sdk/provider@^4`; optional `ai` `>=7.0.0 <8.0.0`; optional `evlog` `>=2` for full `RequestLogger`
  - Node.js `>=22` (AI SDK v7 requirement)
  - Upgrade TypeScript to 7.x; generate declarations with `tsc --emitDeclarationOnly`
  - Align tooling to latest Biome/ultracite, Vitest, pnpm, and @types/node
  - Add `@ai-sdk-tool/middleware/evlog`: LanguageModelV4 port of open-source `evlog/ai` (logic identical; only middleware spec version differs; full upstream test suite ported)

### Patch Changes

- d9d37e3: Update release documentation in README and add repository policy that all changes targeting main must be merged through a pull request.

## 0.0.3

### Patch Changes

- fba3bf1: Prepare the first standalone release after repository split and strengthen middleware test coverage for cache, reasoning extraction, and system prompt edge cases.

## 0.0.2

### Patch Changes

- b9b13bd: feat: Implement PR #141 review feedback - clean up gemma support and fix documentation

  - Remove all gemma model references and configurations across codebase
  - Fix broken README examples by adding proper model and middleware imports
  - Change xmlToolMiddleware placement from "first" to "last" for consistency
  - Fix yamlToolMiddleware import name in benchmark scripts
  - Update ai dependency from 6.0.5 to 6.0.6
  - Add missing transformParams to disk cache middleware

## 0.0.1

### Patch Changes

- 537adc6: minor dependency version bump

## 0.0.1-canary.0

### Patch Changes

- 1f36102: minor dependency version bump
