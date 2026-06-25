import { describe, expect, it } from "vitest";
import { untrustedClient } from "../src/services/untrusted-client.service.js";
import type { HttpError } from "../src/utils/problem-details.js";

describe("untrustedClient", () => {
  it("rejects an empty email before creating a client", async () => {
    await expect(untrustedClient({ email: "" })).rejects.toMatchObject({
      name: "HttpError",
      status: 400,
      detail: "email ontbreekt of is ongeldig",
    } satisfies Partial<HttpError>);
  });

  it("rejects a whitespace-only email before creating a client", async () => {
    await expect(untrustedClient({ email: "   " })).rejects.toMatchObject({
      name: "HttpError",
      status: 400,
      detail: "email ontbreekt of is ongeldig",
    } satisfies Partial<HttpError>);
  });
});
