# Package split setup

This repository is being prepared as the logic package for the Tools API and a future CLI.

## Intended split

- `don-tools-api-v2`: logic package (`@developer-overheid-nl/don-tools-logic`)
- `don-tools-api`: HTTP API application that imports and calls the logic package
- future CLI repository/package: command-line application that imports and calls the same logic package

## Public package API

The public entrypoint is `src/index.ts`, built to `dist/index.js`.

Consumers should import logic from the package root:

```ts
import {
  bundleOAS,
  convertOAS,
  createPostmanCollection,
  generateOAS,
  validatorOpenAPIPost,
} from "@developer-overheid-nl/don-tools-logic";
```

Each function accepts the existing typed input objects and returns the same service result shape currently used by the
API layer:

- binary/download-like results: `{ headers, rawBody }`
- JSON results: plain result objects
- errors: `HttpError`

## Local API repo wiring

Until the package is published, the API repo can depend on this package through a local file dependency:

```json
{
  "dependencies": {
    "@developer-overheid-nl/don-tools-logic": "file:../don-tools-api-v2"
  }
}
```

Then run install in `/Users/matthijshovestad/workspace/geonovum/don-tools-api`.

## Current migration state

The legacy API files have been removed from this repository. The package build emits the logic layer, helpers,
utilities, config, and types needed by `src/index.ts`.

Recommended next migration steps:

1. Update `don-tools-api` service/controller code to import from `@developer-overheid-nl/don-tools-logic`.
2. Keep the OpenAPI contract, HTTP validation, routing, and error mapping fully in `don-tools-api`.
3. Add CLI-specific adapters that call the same package functions directly.
