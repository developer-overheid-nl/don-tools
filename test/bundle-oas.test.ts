import { describe, expect, it } from "vitest";
import { bundleOAS } from "../src/services/bundle-oas.service.js";

const toJson = (buffer: Buffer) => JSON.parse(buffer.toString("utf8"));

describe("bundleOAS", () => {
  it("dereferences non-circular refs", async () => {
    const sourceSpec = {
      openapi: "3.0.3",
      info: { title: "Test API", version: "1.0.0" },
      paths: {
        "/pets": {
          get: {
            responses: {
              "200": {
                description: "OK",
                content: {
                  "application/json": {
                    schema: { $ref: "#/components/schemas/Pet" },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          Pet: {
            type: "object",
            properties: { name: { type: "string" } },
          },
        },
      },
    };

    const result = await bundleOAS({ oasBody: JSON.stringify(sourceSpec) });
    const bundled = toJson(result.rawBody);
    const responseSchema = bundled.paths["/pets"].get.responses["200"].content["application/json"].schema;

    expect(result.headers["Content-Type"]).toBe("application/json");
    expect(responseSchema).toEqual(sourceSpec.components.schemas.Pet);
    expect(JSON.stringify(bundled)).not.toContain('"$ref"');
  });

  it("rejects circular refs because they cannot be fully dereferenced", async () => {
    const sourceSpec = {
      openapi: "3.0.3",
      info: { title: "Recursive API", version: "1.0.0" },
      paths: {
        "/nodes": {
          get: {
            responses: {
              "200": {
                description: "OK",
                content: {
                  "application/json": {
                    schema: { $ref: "#/components/schemas/Node" },
                  },
                },
              },
            },
          },
        },
      },
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
      status: 422,
      detail: expect.stringContaining("circulaire verwijzingen"),
    });
  });
});
