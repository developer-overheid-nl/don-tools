import { describe, expect, it } from "vitest";
import { bundleOAS } from "../src/services/bundle-oas.service.js";
import type { HttpError } from "../src/utils/problem-details.js";

const toJson = (buffer: Buffer) => JSON.parse(buffer.toString("utf8"));

describe("bundleOAS", () => {
  it("dereferences non-circular schema references", async () => {
    const sourceSpec = {
      openapi: "3.0.3",
      info: { title: "Reference API", version: "1.0.0" },
      paths: {},
      components: {
        schemas: {
          Pet: {
            type: "object",
            properties: {
              owner: { $ref: "#/components/schemas/Owner" },
            },
          },
          Owner: {
            type: "object",
            properties: {
              name: { type: "string" },
            },
          },
        },
      },
    };

    const result = await bundleOAS({ oasBody: JSON.stringify(sourceSpec) });
    const bundled = toJson(result.rawBody);

    expect(result.headers["Content-Type"]).toBe("application/json");
    expect(bundled.components.schemas.Pet.properties.owner).toMatchObject({
      type: "object",
      properties: { name: { type: "string" } },
    });
    expect(bundled.components.schemas.Pet.properties.owner).not.toHaveProperty("$ref");
  });

  it("rejects circular dereference results instead of returning YAML anchors", async () => {
    const sourceSpec = {
      openapi: "3.0.3",
      info: { title: "Recursive API", version: "1.0.0" },
      paths: {},
      components: {
        schemas: {
          Node: {
            type: "object",
            properties: {
              children: {
                type: "array",
                items: { $ref: "#/components/schemas/Node" },
              },
            },
          },
        },
      },
    };

    await expect(bundleOAS({ oasBody: JSON.stringify(sourceSpec) })).rejects.toMatchObject({
      name: "HttpError",
      status: 422,
      message: "De OpenAPI specificatie bevat circulaire verwijzingen en kan niet volledig worden gedereferenced.",
    } satisfies Partial<HttpError>);
  });
});
