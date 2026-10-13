# DON Tools Logic

Herbruikbare TypeScript-logica voor de tools van `developer.overheid.nl`.

Deze repository publiceert het package `@developer-overheid-nl/don-tools`. Het is bewust
geen HTTP API. De v1 HTTP-adapter staat in `don-tools-api` en importeert dit package. Een CLI of
andere runtime kan dezelfde logica later ook rechtstreeks gebruiken.

## Wat zit hierin?

- OpenAPI input ophalen uit `oasBody` of `oasUrl`
- OpenAPI 3.0/3.1 converteren
- OpenAPI documenten bundelen en externe referenties oplossen
- OpenAPI documenten valideren met DON ADR rulesets
- Boilerplate OpenAPI documenten genereren uit JSON input
- OpenAPI documenten converteren naar Postman collections
- Markdown en Mermaid genereren voor Arazzo workflows
- Keycloak clients aanmaken voor API-keyachtige toegang

## Publieke API

Importeer functies en types vanaf de package root:

```ts
import {
  bundleOAS,
  convertOAS,
  createPostmanCollection,
  generateOAS,
  validatorOpenAPIPost,
  type OasInput,
} from "@developer-overheid-nl/don-tools";
```

Belangrijkste exports:

- `arazzoMarkdown`
- `arazzoMermaid`
- `bundleOAS`
- `convertOAS`
- `createPostmanCollection`
- `generateOAS`
- `untrustedClient`
- `validatorOpenAPIPost`
- `fetchSpecification`
- `resolveOasInput`
- `HttpError`
- publieke input- en resulttypes

## Ontwikkelen

Vereisten:

- Node.js 22.18+
- pnpm 11+

Setup:

```sh
corepack enable
pnpm install
```

Handige scripts:

```sh
pnpm build      # TypeScript build naar dist/
pnpm typecheck  # TypeScript typecheck zonder output
pnpm lint       # Biome lint
pnpm test       # Vitest tests
pnpm format     # Biome format
```

De build schrijft ESM JavaScript en TypeScript declarations naar `dist/`. Alleen `dist/` wordt
meegenomen in het npm package.

## Publiceren naar npm

Voor handmatig publishen:

```sh
pnpm install
pnpm build
pnpm test
npm pack --dry-run
npm login
npm publish --access public
```

Controleer voor publishen:

- `package.json` heeft de juiste `version`
- `private` staat op `false`
- `dist/` is opnieuw gebouwd
- `npm pack --dry-run` toont alleen bestanden die je verwacht

`validatorOpenAPIPost` valideert tegen de API Design Rules met
[`@developer-overheid-nl/don-checker`](https://github.com/developer-overheid-nl/don-checker). Die
publiceert alleen een CLI, dus de validator start die als child process (spec via stdin, JSON-output).
De timeout is instelbaar met `VALIDATOR_TIMEOUT_MS` (standaard 60000).

Welke ADR-versies er zijn, komt uit `adrVersions` van `@developer-overheid-nl/adr-rulesets`. `targetVersion`
`2.0`, `2.1` en `2.2` lopen tegen de nieuwste definitieve `2.0.x`, `2.1.x` en `2.2.x` daarin (nu `2.0.2`,
`2.1.0` en `2.2.0`); `draft` loopt tegen de draftversie (`werkversie`).

De `score` is het percentage regels met severity `error` in de ADR-ruleset van die versie waarop de spec
niet faalt; warnings tellen niet mee. De regels komen uit `@developer-overheid-nl/adr-rulesets`, hetzelfde
pakket dat don-checker draait (een test bewaakt dat beide dezelfde versie gebruiken). Een spec die niet
als OpenAPI te parsen is krijgt score `0`.

## Gebruiken vanuit `don-tools-api`

Na publicatie kan de v1 API-adapter een expliciete npm-versie gebruiken:

```sh
cd ../don-tools-api
npm install @developer-overheid-nl/don-tools@<version>
```

Gebruik in CI/CD liever een npm-versie dan een GitHub dependency. Dat voorkomt SSH-key- en
repository-tokenproblemen tijdens installs en Docker builds.

## Repository-indeling

```text
src/index.ts       Publieke package exports
src/services/      Businesslogica per tool
src/helpers/       Gedeelde helpers voor input, Arazzo en Keycloak
src/utils/         Algemene utilities en problem-details fouten
src/types/         Publieke TypeScript types en dependency shims
test/              Vitest tests
dist/              Build output, alleen aanwezig na pnpm build
```

## Licentie

EUPL-1.2
