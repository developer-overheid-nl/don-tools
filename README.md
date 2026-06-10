# Tools logic package

Reusable Node.js / TypeScript logic for developer.overheid.nl tools.

This repository contains the package `@developer-overheid-nl/don-tools-logic`. It is intentionally not an HTTP API
application. The HTTP API lives in `/Users/matthijshovestad/workspace/geonovum/don-tools-api` and should import this
package. A future CLI can import the same package.

See [PACKAGE_SPLIT.md](./PACKAGE_SPLIT.md) for the migration setup.

## Stack

- **Runtime**: Node.js 22+
- **Package manager**: pnpm
- **Language**: TypeScript, native ESM, `NodeNext`
- **Tests**: Vitest
- **Lint/format**: Biome

## Public API

Import from the package root:

```ts
import {
  bundleOAS,
  convertOAS,
  createPostmanCollection,
  generateOAS,
  validatorOpenAPIPost,
} from "@developer-overheid-nl/don-tools-logic";
```

The package also exports Arazzo helpers, Keycloak client logic, shared input/result types, and `HttpError`.

## Capabilities

- Resolve OpenAPI input from `oasBody` or `oasUrl`
- Convert OpenAPI 3.0 and 3.1 documents
- Bundle OpenAPI documents with dereferenced references
- Validate OpenAPI documents with DON ADR rulesets
- Generate boilerplate OpenAPI documents from JSON input
- Convert OpenAPI documents to Postman collections
- Generate Markdown and Mermaid output for Arazzo workflows
- Create Keycloak clients for API-key style access

## Project Layout

```text
src/
  index.ts       Public package exports
  services/      Business logic functions
  helpers/       Shared implementation helpers
  utils/         Generic utilities and HttpError
  types/         Public TypeScript types and local dependency shims
test/            Vitest service tests
```

## Development

```sh
corepack enable
pnpm install
pnpm build
pnpm typecheck
pnpm lint
pnpm test
```

The build emits ESM JavaScript and declaration files to `dist/`. Only `dist/` is included in the published package.

## Local Consumer Setup

Until this package is published, the API repository can consume it through a local file dependency:

```json
{
  "dependencies": {
    "@developer-overheid-nl/don-tools-logic": "file:../don-tools-api-v2"
  }
}
```
