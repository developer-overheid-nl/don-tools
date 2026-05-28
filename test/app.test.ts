import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp({ loggerEnabled: false });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe("app", () => {
  it("serves the OpenAPI spec", async () => {
    const response = await app.inject({ method: "GET", url: "/v1/openapi.json" });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { info: { title: string } };
    expect(body.info.title).toBe("Tools API v1");
  });

  it("returns API-Version header", async () => {
    const response = await app.inject({ method: "GET", url: "/v1/openapi.json" });
    expect(response.headers["api-version"]).toBe("1.0.0");
  });

  it("returns problem+json on unknown route", async () => {
    const response = await app.inject({ method: "GET", url: "/no-such-route" });
    expect(response.statusCode).toBe(404);
    expect(response.headers["content-type"]).toContain("application/problem+json");
    expect(response.json()).toMatchObject({ status: 404, title: "Not Found" });
  });

  it("returns problem+json on validation failure", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/oas/validate",
      payload: {},
    });
    expect(response.statusCode).toBe(400);
    expect(response.headers["content-type"]).toContain("application/problem+json");
  });

  it("sets API-Version on 404 responses", async () => {
    const response = await app.inject({ method: "GET", url: "/no-such-route" });
    expect(response.statusCode).toBe(404);
    expect(response.headers["api-version"]).toBe("1.0.0");
  });

  it("sets API-Version on 4xx error responses", async () => {
    const response = await app.inject({ method: "POST", url: "/v1/oas/validate", payload: {} });
    expect(response.statusCode).toBe(400);
    expect(response.headers["api-version"]).toBe("1.0.0");
  });

  it("AJV rejects untrustedClient without email", async () => {
    const response = await app.inject({ method: "POST", url: "/v1/auth/clients", payload: {} });
    expect(response.statusCode).toBe(400);
    const problem = response.json() as { errors?: Array<{ detail: string; pointer: string }> };
    expect(problem.errors?.some((e) => e.detail.includes("required") && e.pointer === "#/email")).toBe(true);
  });

  it("AJV rejects untrustedClient with malformed email", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/clients",
      payload: { email: "not-an-email" },
    });
    expect(response.statusCode).toBe(400);
  });

  it("AJV rejects oasUrl that is not a URI", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/oas/validate",
      payload: { oasUrl: "not a url" },
    });
    expect(response.statusCode).toBe(400);
  });

  it("AJV rejects unknown ruleset version", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/oas/validate",
      payload: { oasBody: "openapi: 3.0.0", targetVersion: "9.9" },
    });
    expect(response.statusCode).toBe(400);
  });

  it("validate without targetVersion uses default ruleset 2.1", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/oas/validate",
      payload: { oasBody: '{"openapi":"3.0.0","info":{"title":"T","version":"1.0.0"},"paths":{}}' },
    });
    expect(response.statusCode).toBe(200);
    expect((response.json() as { rulesetVersion: string }).rulesetVersion).toBe("2.1");
  });
});
