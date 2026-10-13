import { readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validatorOpenAPIPost } from "../src/services/validator-openapi-post.service.js";

const okResponse = (headers: Record<string, unknown> = {}) => ({
  200: {
    description: "OK",
    headers: { "API-Version": { schema: { type: "string" } }, ...headers },
  },
});

const validSpec = {
  openapi: "3.0.3",
  info: {
    title: "Test API",
    description: "Test API",
    version: "1.0.0",
    contact: { name: "Team", email: "team@example.org", url: "https://example.org" },
  },
  servers: [{ url: "https://api.example.org/v1" }],
  tags: [{ name: "meta" }, { name: "pets" }],
  paths: {
    "/openapi.json": {
      get: {
        operationId: "getOpenApi",
        description: "OpenAPI document",
        tags: ["meta"],
        responses: okResponse({ "access-control-allow-origin": { schema: { type: "string", enum: ["*"] } } }),
      },
    },
    "/pets": {
      get: { operationId: "listPets", description: "List pets", tags: ["pets"], responses: okResponse() },
    },
  },
};

const invalidSpec = {
  ...validSpec,
  info: { title: "Test API", version: "one" },
  servers: [{ url: "https://api.example.org" }],
  paths: { "/pets/": { get: { responses: { 200: { description: "OK" } } } } },
};

describe("validatorOpenAPIPost", () => {
  it("defaults to ruleset version 2.2", async () => {
    const result = await validatorOpenAPIPost({ oasBody: JSON.stringify(validSpec) });

    expect(result.rulesetVersion).toBe("2.2");
  });

  it.each(["2.0", "2.1", "2.2", "draft"] as const)(
    "returns a passing LintResult for a compliant spec (%s)",
    async (targetVersion) => {
      const result = await validatorOpenAPIPost({ oasBody: JSON.stringify(validSpec), targetVersion });

      expect(result.rulesetVersion).toBe(targetVersion);
      expect(result.failures).toBe(0);
      expect(result.score).toBe(100);
      expect(result.successes).toBe(true);
      expect(result.messages).toEqual([]);
    },
  );

  it("maps don-checker diagnostics onto lint messages and scores measured rules", async () => {
    const result = await validatorOpenAPIPost({ oasBody: JSON.stringify(invalidSpec), targetVersion: "2.0" });
    const codes = result.messages?.map((message) => message.code);

    expect(result.rulesetVersion).toBe("2.0");
    expect(codes).toEqual(
      expect.arrayContaining(["missing-header", "include-major-version-in-uri", "paths-no-trailing-slash", "semver"]),
    );
    expect(result.failures).toBe(result.messages?.filter((message) => message.severity === "error").length);
    expect(result.successes).toBe(false);
    expect(result.score).toBeLessThan(100);

    const trailingSlash = result.messages?.find((message) => message.code === "paths-no-trailing-slash");
    expect(trailingSlash).toMatchObject({ severity: "error", createdAt: expect.any(String), id: expect.any(String) });
    expect(trailingSlash?.infos?.[0]).toMatchObject({ lintMessageId: trailingSlash?.id, path: "paths./pets/" });
  });

  it("scores the share of the version's error rules that pass", async () => {
    const result = await validatorOpenAPIPost({ oasBody: JSON.stringify(invalidSpec), targetVersion: "2.2" });
    const codes = result.messages?.map((message) => message.code);

    expect(codes).toEqual(
      expect.arrayContaining([
        "nlgov:missing-header",
        "nlgov:include-major-version-in-uri",
        "path-keys-no-trailing-slash",
        "nlgov:semver",
        "info-contact",
      ]),
    );
    // 5 of the 28 error rules in ADR 2.2.0 fail.
    expect(result.score).toBe(82);
  });

  it("reports parser errors for unparseable input instead of throwing", async () => {
    const result = await validatorOpenAPIPost({ oasBody: "{{{", targetVersion: "2.2" });

    expect(result.rulesetVersion).toBe("2.2");
    expect(result.messages?.some((message) => message.code === "parser" && message.severity === "error")).toBe(true);
    expect(result.messages?.find((message) => message.code === "parser")?.infos?.[0]?.path).toBe("body");
    expect(result.score).toBe(0);
    expect(result.successes).toBe(false);
  });

  it("scores against the same adr-rulesets release that don-checker runs", () => {
    const scope = join(process.cwd(), "node_modules", "@developer-overheid-nl");
    const versionAt = (dir: string) => JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).version;
    // pnpm installs don-checker's own dependencies next to its real package directory.
    const checkerRulesets = join(realpathSync(join(scope, "don-checker")), "..", "adr-rulesets");

    expect(versionAt(join(scope, "adr-rulesets"))).toBe(versionAt(checkerRulesets));
  });
});
