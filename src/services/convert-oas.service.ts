import { Converter } from "@apiture/openapi-down-convert";
import { upgrade as scalarUpgrade } from "@scalar/openapi-upgrader";
import jsYaml from "js-yaml";
import { HttpError } from "../utils/problem-details.js";
import { resolveOasInput } from "../helpers/oas-input.helper.js";
import type { OasInput } from "../types/api.js";

const DEFAULT_TARGET_VERSION = "3.1.0";

const EMPTY_BODY_ERROR = "Body ontbreekt of ongeldig: gebruik oasUrl of oasBody";
const VERSION_MISSING_ERROR = "OpenAPI document bevat geen geldig openapi versieveld";
const UNSUPPORTED_VERSION_ERROR = "Alleen OpenAPI 3.0 en 3.1 worden ondersteund";
const UNSUPPORTED_TARGET_VERSION_ERROR = "targetVersion wordt niet ondersteund. Gebruik 3.0 of 3.1.";

interface VersionDescriptor {
  major: "3.0" | "3.1";
  canonical: "3.0.3" | "3.1.0";
}

interface ParsedSpec {
  spec: Record<string, unknown>;
  format: "json" | "yaml";
}

export interface ConversionResult {
  headers: Record<string, string>;
  rawBody: Buffer;
}

const parseSpecification = (contents: string): ParsedSpec => {
  const trimmed = contents.trim();
  if (trimmed.length === 0) throw new HttpError(400, EMPTY_BODY_ERROR);
  try {
    const spec = JSON.parse(trimmed);
    if (!spec || typeof spec !== "object" || Array.isArray(spec)) throw new Error("Ongeldig OpenAPI document");
    return { spec, format: "json" };
  } catch {
    try {
      const spec = jsYaml.load(trimmed);
      if (!spec || typeof spec !== "object" || Array.isArray(spec)) throw new Error("Ongeldig OpenAPI document");
      return { spec: spec as Record<string, unknown>, format: "yaml" };
    } catch (yamlError) {
      const message = yamlError instanceof Error ? yamlError.message : String(yamlError);
      throw new HttpError(500, `Kan OpenAPI specificatie niet parseren: ${message}`);
    }
  }
};

const resolveVersionDescriptor = (value: unknown): VersionDescriptor | null => {
  const raw =
    typeof value === "number" && Number.isFinite(value)
      ? value.toString()
      : typeof value === "string"
        ? value.trim()
        : "";
  if (!raw) return null;
  if (raw === "3" || raw.startsWith("3.0")) return { major: "3.0", canonical: "3.0.3" };
  if (raw.startsWith("3.1")) return { major: "3.1", canonical: "3.1.0" };
  return null;
};

const normalizeTargetVersion = (value: string | undefined): string => {
  if (!value) return DEFAULT_TARGET_VERSION;
  const descriptor = resolveVersionDescriptor(value);
  if (!descriptor) throw new HttpError(400, UNSUPPORTED_TARGET_VERSION_ERROR);
  return descriptor.canonical;
};

const ensureObjectSpec = (value: unknown, message: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
};

interface ConvertSpecOptions {
  preserveSourceVersion?: boolean;
}

const convertSpec = async (
  spec: Record<string, unknown>,
  targetVersion: string,
  options: ConvertSpecOptions = {},
): Promise<{ spec: Record<string, unknown>; resolvedVersion: string }> => {
  const sourceDescriptor = resolveVersionDescriptor(spec.openapi);
  const rawVersion = spec.openapi == null ? "" : String(spec.openapi).trim();
  if (rawVersion.length === 0 || !sourceDescriptor) throw new HttpError(400, VERSION_MISSING_ERROR);

  const targetDescriptor = resolveVersionDescriptor(targetVersion);
  if (!targetDescriptor) throw new HttpError(400, UNSUPPORTED_TARGET_VERSION_ERROR);

  if (sourceDescriptor.major === targetDescriptor.major) {
    if (options.preserveSourceVersion && sourceDescriptor.major === "3.1") {
      spec.openapi = rawVersion;
      return { spec, resolvedVersion: rawVersion };
    }
    spec.openapi = targetDescriptor.canonical;
    return { spec, resolvedVersion: targetDescriptor.canonical };
  }

  if (sourceDescriptor.major === "3.0" && targetDescriptor.major === "3.1") {
    const upgraded = ensureObjectSpec(
      scalarUpgrade(spec, "3.1"),
      "Scalar OpenAPI upgrader retourneerde een ongeldig document.",
    );
    upgraded.openapi = targetDescriptor.canonical;
    return { spec: upgraded, resolvedVersion: targetDescriptor.canonical };
  }

  if (sourceDescriptor.major === "3.1" && targetDescriptor.major === "3.0") {
    const downConverter = new Converter(spec);
    const downgraded = ensureObjectSpec(
      downConverter.convert(),
      "OpenAPI down converter retourneerde een ongeldig document.",
    );
    downgraded.openapi = targetDescriptor.canonical;
    return { spec: downgraded, resolvedVersion: targetDescriptor.canonical };
  }

  throw new HttpError(400, UNSUPPORTED_VERSION_ERROR);
};

const serializeSpecification = (
  spec: Record<string, unknown>,
  format: "json" | "yaml",
  targetVersion: string,
): { buffer: Buffer; contentType: string; filename: string } => {
  const filenameBase = `openapi-${targetVersion.replace(/\./g, "-")}`;
  if (format === "json") {
    const json = JSON.stringify(spec, null, 2);
    return { buffer: Buffer.from(json, "utf8"), contentType: "application/json", filename: `${filenameBase}.json` };
  }
  const yaml = jsYaml.dump(spec, { lineWidth: -1 });
  return { buffer: Buffer.from(yaml, "utf8"), contentType: "application/yaml", filename: `${filenameBase}.yaml` };
};

export const convertOAS = async (input: OasInput): Promise<ConversionResult> => {
  const targetVersion = normalizeTargetVersion(input.targetVersion);
  const hasExplicitTargetVersion = Boolean(input.targetVersion);
  const { contents } = await resolveOasInput(input);
  const { spec, format } = parseSpecification(contents);

  const { spec: convertedSpec, resolvedVersion } = await convertSpec(spec, targetVersion, {
    preserveSourceVersion: !hasExplicitTargetVersion,
  });

  const { buffer, contentType, filename } = serializeSpecification(convertedSpec, format, resolvedVersion);
  return {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
    rawBody: buffer,
  };
};
