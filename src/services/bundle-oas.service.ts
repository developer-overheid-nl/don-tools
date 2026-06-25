import { dump } from "js-yaml";
import { bundleFromString, createConfig } from "@redocly/openapi-core";
import { HttpError } from "../utils/problem-details.js";
import { resolveOasInput } from "../helpers/oas-input.helper.js";
import type { OasInput } from "../types/api.js";

export interface BundleResult {
  headers: Record<string, string>;
  rawBody: Buffer;
}

const redoclyConfig = await createConfig({ extends: ["minimal"] });

const guessInputFormat = (contents: string): "json" | "yaml" => {
  const trimmed = contents.trimStart();
  return trimmed.startsWith("{") || trimmed.startsWith("[") ? "json" : "yaml";
};

const stringifyAsJson = (document: unknown): string | null => {
  try {
    return JSON.stringify(document, null, 2);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.toLowerCase().includes("circular")) return null;
    throw error;
  }
};

export const bundleOAS = async (input: OasInput): Promise<BundleResult> => {
  const resolved = await resolveOasInput(input);
  const contents = typeof resolved.contents === "string" ? resolved.contents : "";
  if (!contents.trim()) throw new HttpError(400, "Body ontbreekt of ongeldig: gebruik oasUrl of oasBody.");

  const inputFormat = guessInputFormat(contents);
  let document: unknown;
  try {
    // biome-ignore lint/suspicious/noExplicitAny: redocly typing is loose for bundleFromString
    const result = await (bundleFromString as any)({
      source: contents,
      config: redoclyConfig,
      dereference: true,
    });
    document = result?.bundle?.parsed;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new HttpError(400, "Het bundelen van de OpenAPI specificatie is mislukt.", { detail: message });
  }

  if (!document || typeof document !== "object" || Array.isArray(document)) {
    throw new HttpError(500, "Onverwachte structuur na bundelen.");
  }

  let outputFormat: "json" | "yaml" = inputFormat;
  let bundledText: string | null = null;
  if (inputFormat === "json") {
    bundledText = stringifyAsJson(document);
    if (bundledText === null) outputFormat = "yaml";
  }
  if (bundledText === null) {
    bundledText = dump(document, { lineWidth: -1 });
  }

  const filename = `openapi.${outputFormat}`;
  const contentType = outputFormat === "json" ? "application/json" : "application/yaml";

  return {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
    rawBody: Buffer.from(bundledText, "utf8"),
  };
};
