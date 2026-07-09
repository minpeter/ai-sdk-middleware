---
"@ai-sdk-tool/middleware": minor
---

Target AI SDK v7 / LanguageModelV4 middleware.

- All middlewares now implement `LanguageModelV4Middleware` (`specificationVersion: "v4"`)
- Peer: `@ai-sdk/provider@^4`; optional `ai` `>=7.0.0 <8.0.0`; optional `evlog` `>=2` for full `RequestLogger`
- Node.js `>=22` (AI SDK v7 requirement)
- Upgrade TypeScript to 7.x; generate declarations with `tsc --emitDeclarationOnly`
- Align tooling to latest Biome/ultracite, Vitest, pnpm, and @types/node
- Add `@ai-sdk-tool/middleware/evlog`: LanguageModelV4 port of open-source `evlog/ai` (logic identical; only middleware spec version differs; full upstream test suite ported)
