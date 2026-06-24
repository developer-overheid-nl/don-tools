import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { load } from "js-yaml";
import {
  bundle as redoclyBundle,
  createConfig,
  formatProblems,
  getTotals,
  lint as redoclyLint,
} from "@redocly/openapi-core";
import { HttpError } from "../utils/problem-details.js";
import { resolveOasInput, type ResolvedOasInput } from "./oas-input.helper.js";
import type { OasInput } from "../types/api.js";
import { fetchSpecification } from "./remote-specification.helper.js";

const EMPTY_BODY_ERROR = "Body ontbreekt of ongeldig: gebruik oasUrl|oasBody";
const INVALID_SPEC_ERROR = "Arazzo specificatie ongeldig of mist workflows";
const TEMP_PREFIX = "don-tools-arazzo-";

const SOURCE_REF_PREFIX = "$sourceDescriptions.";
const COMPONENT_INPUTS_PREFIX = "#/components/inputs/";
const ALLOWED_METHODS = new Set(["get", "put", "post", "delete", "patch", "head", "options", "trace"]);

interface ArazzoDocument {
  arazzo?: string;
  info?: { title?: string; description?: string };
  workflows?: Array<{
    workflowId?: string;
    summary?: string;
    description?: string;
    inputs?: unknown;
    parameters?: Array<{ name?: string; in?: string; value?: unknown; description?: string }>;
    steps?: ArazzoStep[];
  }>;
  components?: { inputs?: Record<string, unknown> };
}

interface ArazzoStep {
  stepId?: string;
  description?: string;
  operationId?: string;
  successCriteria?: Array<{ condition?: string; description?: string }>;
  failureCriteria?: Array<{ condition?: string; description?: string }>;
  outputs?: Record<string, unknown>;
}

interface OperationInfo {
  method: string;
  path: string;
  summary: string;
  description: string;
  tags?: string[];
}

const redoclyConfig = await createConfig({ extends: ["recommended"] });
const arazzoLintConfig = await createConfig({
  extends: ["recommended-strict"],
  arazzo1Rules: {
    "no-criteria-xpath": "error",
    "respect-supported-versions": "warn",
    "no-x-security-scheme-name-without-openapi": "error",
    "x-security-scheme-required-values": "error",
    "x-security-scheme-name-reference": "error",
    "no-x-security-both-scheme-and-scheme-name": "error",
  },
});

const isLikelyArazzoTestFile = (fileName: string, parsedDocument: ArazzoDocument | undefined): boolean =>
  /\.(yaml|yml|json)$/i.test(fileName) && Boolean(parsedDocument?.arazzo);

const ensureTempFile = async (contents: string, filename = "input.yaml") => {
  const tempDir = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
  const filePath = join(tempDir, filename);
  await writeFile(filePath, contents, "utf8");
  const cleanup = async () => {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  };
  return { filePath, cleanup };
};

const parseYamlOrUndefined = (contents: string): Record<string, unknown> | undefined => {
  try {
    const parsed = load(contents);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
};

const normalizeText = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

const resolveVisualizationInput = async (input: OasInput): Promise<ResolvedOasInput> => {
  if (input.arazzoBody) return { source: "request-body", contents: input.arazzoBody };
  if (input.arazzoUrl) {
    const contents = await fetchSpecification(input.arazzoUrl, {
      errorMessage: "Het ophalen van de Arazzo specificatie is mislukt.",
    });
    return { source: input.arazzoUrl, contents };
  }
  const resolved = await resolveOasInput(input);
  if (!resolved.contents.trim()) throw new HttpError(400, EMPTY_BODY_ERROR);
  return resolved;
};

const bundleArazzoDocument = async (filePath: string, skipLint = false): Promise<ArazzoDocument> => {
  const fileName = basename(filePath);
  const version = "don-tools-api";

  if (!skipLint) {
    // biome-ignore lint/suspicious/noExplicitAny: redocly typing is loose
    const lintProblems = await (redoclyLint as any)({ ref: filePath, config: arazzoLintConfig });
    if (Array.isArray(lintProblems) && lintProblems.length > 0) {
      const totals = getTotals(lintProblems);
      formatProblems(lintProblems, { totals, version });
    }
  }

  // biome-ignore lint/suspicious/noExplicitAny: redocly typing is loose
  const bundled = await (redoclyBundle as any)({
    base: dirname(filePath),
    ref: filePath,
    config: arazzoLintConfig,
    dereference: true,
  });

  const parsed = bundled?.bundle?.parsed as ArazzoDocument | undefined;
  if (!parsed) throw new Error(`Could not find source description file '${fileName}'.`);
  if (!isLikelyArazzoTestFile(fileName, parsed)) {
    throw new Error(`File ${fileName} mist een geldige "Arazzo" beschrijving.`);
  }
  return parsed;
};

const loadArazzoDocumentFromContents = async (contents: string): Promise<ArazzoDocument> => {
  const { filePath, cleanup } = await ensureTempFile(contents, "arazzo.yaml");
  try {
    const document = await bundleArazzoDocument(filePath, true);
    if (!document || !Array.isArray(document.workflows) || document.workflows.length === 0) {
      throw new Error(INVALID_SPEC_ERROR);
    }
    return document;
  } finally {
    await cleanup();
  }
};

const generateArazzoFromOpenApi = async (contents: string): Promise<ArazzoDocument> => {
  const { filePath, cleanup } = await ensureTempFile(contents, "openapi.yaml");
  try {
    const respect = await import("@redocly/respect-core");
    // biome-ignore lint/suspicious/noExplicitAny: redocly typing is loose
    const generate = (respect as any).generate;
    const document = (await generate({
      descriptionPath: filePath,
      version: "don-tools-api",
      config: redoclyConfig,
      base: dirname(filePath),
    })) as ArazzoDocument;
    if (!document || !Array.isArray(document.workflows) || document.workflows.length === 0) {
      throw new Error(INVALID_SPEC_ERROR);
    }
    return document;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new HttpError(400, "Kon Arazzo workflows genereren vanuit OpenAPI.", { detail: message });
  } finally {
    await cleanup();
  }
};

const buildOperationLookup = (openapi: Record<string, unknown> | undefined): Map<string, OperationInfo> => {
  const lookup = new Map<string, OperationInfo>();
  if (!openapi || typeof openapi !== "object") return lookup;
  const paths = (openapi as { paths?: Record<string, unknown> }).paths;
  if (!paths || typeof paths !== "object") return lookup;
  for (const [pathKey, pathItem] of Object.entries(paths)) {
    if (!pathItem || typeof pathItem !== "object") continue;
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!ALLOWED_METHODS.has(method) || !operation || typeof operation !== "object") continue;
      const op = operation as { operationId?: string; summary?: string; description?: string; tags?: string[] };
      if (!op.operationId) continue;
      lookup.set(op.operationId, {
        method: method.toUpperCase(),
        path: pathKey,
        summary: normalizeText(op.summary),
        description: normalizeText(op.description),
        tags: Array.isArray(op.tags) ? op.tags : undefined,
      });
    }
  }
  return lookup;
};

const describeSchemaType = (schema: Record<string, unknown> | undefined): string => {
  if (!schema || typeof schema !== "object") return "";
  const parts: string[] = [];
  if (schema.type) parts.push(String(schema.type) + (schema.format ? ` (${String(schema.format)})` : ""));
  else if (schema.format) parts.push(String(schema.format));
  if (Array.isArray(schema.enum)) parts.push(`mogelijk: ${schema.enum.join(", ")}`);
  return parts.join(" | ");
};

const formatInputDefinition = (name: string, schema: Record<string, unknown> | undefined): string[] => {
  const lines = [`- **${name}**`];
  const description = normalizeText(schema?.description);
  const typeInfo = describeSchemaType(schema);
  if (description || typeInfo) {
    const details = [description, typeInfo ? `type: ${typeInfo}` : undefined].filter(Boolean).join(" | ");
    lines.push(`  - ${details}`);
  }
  if (schema && typeof schema.properties === "object" && schema.properties) {
    lines.push("  - Velden:");
    for (const [propName, propSchema] of Object.entries(schema.properties as Record<string, unknown>)) {
      const propType = describeSchemaType(propSchema as Record<string, unknown>);
      const propDescription = normalizeText((propSchema as { description?: unknown })?.description);
      const suffix = [propType, propDescription].filter(Boolean).join(" — ");
      lines.push(`    - ${propName}${suffix ? ` — ${suffix}` : ""}`);
    }
  }
  return lines;
};

const resolveInputs = (
  inputs: unknown,
  components: Record<string, unknown> | undefined,
): Array<{ name: string; schema: Record<string, unknown> }> => {
  if (!inputs) return [];
  if (typeof inputs === "object" && inputs !== null) {
    const ref = (inputs as { $ref?: string }).$ref;
    if (typeof ref === "string") {
      if (!ref.startsWith(COMPONENT_INPUTS_PREFIX)) return [];
      const refName = ref.slice(COMPONENT_INPUTS_PREFIX.length);
      const def = components?.[refName];
      if (!def) return [];
      return [{ name: refName, schema: def as Record<string, unknown> }];
    }
    const inlineName =
      (inputs as { name?: string; title?: string }).name ?? (inputs as { title?: string }).title ?? "inputs";
    return [{ name: inlineName, schema: inputs as Record<string, unknown> }];
  }
  return [];
};

const formatParameterValue = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (value === undefined) return "onbekend";
  return JSON.stringify(value);
};

const appendCriteriaLines = (
  lines: string[],
  items: Array<{ condition?: string; description?: string }> | undefined,
  label: string,
) => {
  if (!Array.isArray(items) || items.length === 0) return;
  lines.push(`  - ${label}:`);
  for (const criteria of items) {
    const condition = normalizeText(criteria?.condition) || "(geen conditie)";
    const detail = normalizeText(criteria?.description);
    lines.push(`    - ${condition}${detail ? ` — ${detail}` : ""}`);
  }
};

const appendOutputs = (lines: string[], outputs: Record<string, unknown> | undefined) => {
  if (!outputs || typeof outputs !== "object" || Object.keys(outputs).length === 0) return;
  lines.push("  - Outputs:");
  for (const [key, value] of Object.entries(outputs)) {
    lines.push(`    - ${key}: ${JSON.stringify(value)}`);
  }
};

const parseStepOperation = (
  value: string | undefined,
): { raw: string; operationId: string; source?: string } => {
  if (!value || typeof value !== "string") return { raw: "", operationId: "" };
  if (!value.startsWith(SOURCE_REF_PREFIX)) return { raw: value, operationId: value };
  const remainder = value.slice(SOURCE_REF_PREFIX.length);
  const delimiterIndex = remainder.indexOf(".");
  if (delimiterIndex === -1) return { raw: value, operationId: remainder };
  return {
    raw: value,
    source: remainder.slice(0, delimiterIndex),
    operationId: remainder.slice(delimiterIndex + 1),
  };
};

const describeStepOperation = (
  step: ArazzoStep,
  operationLookup: Map<string, OperationInfo>,
): { operationDetails?: OperationInfo; suffix: string } => {
  const parsed = parseStepOperation(step.operationId);
  const operationDetails = parsed.operationId ? operationLookup.get(parsed.operationId) : undefined;
  const suffixParts: string[] = [];
  if (operationDetails?.method && operationDetails.path) {
    suffixParts.push(`${operationDetails.method} ${operationDetails.path}`);
  }
  if (parsed.operationId) suffixParts.push(parsed.operationId);
  return {
    operationDetails,
    suffix: suffixParts.length > 0 ? ` (${suffixParts.join(" · ")})` : "",
  };
};

const buildMarkdown = (document: ArazzoDocument, openapi?: Record<string, unknown>): string => {
  const lines: string[] = [];
  const title = normalizeText(document.info?.title) || "Arazzo Workflows";
  const description = normalizeText(document.info?.description);
  const operationLookup = buildOperationLookup(openapi);

  lines.push(`# ${title}`);
  if (description) lines.push("", description);

  (document.workflows ?? []).forEach((workflow, workflowIndex) => {
    const workflowTitle =
      normalizeText(workflow.summary) || workflow.workflowId || `Workflow ${workflowIndex + 1}`;
    lines.push("", `## ${workflowTitle}`);
    if (workflow.description) lines.push("", workflow.description.trim());

    const inputs = resolveInputs(workflow.inputs, document.components?.inputs);
    if (inputs.length > 0) {
      lines.push("", "### Inputs");
      for (const input of inputs) {
        for (const line of formatInputDefinition(input.name, input.schema)) lines.push(line);
      }
    }

    if (Array.isArray(workflow.parameters) && workflow.parameters.length > 0) {
      lines.push("", "### Parameters");
      for (const parameter of workflow.parameters) {
        const location = parameter.in ?? "parameter";
        const name = parameter.name ?? "naamloos";
        const value = formatParameterValue(parameter.value);
        lines.push(`- ${name} (${location}) = ${value}`);
        if (parameter.description) lines.push(`  - ${parameter.description.trim()}`);
      }
    }

    if (Array.isArray(workflow.steps) && workflow.steps.length > 0) {
      lines.push("", "### Stappen");
      workflow.steps.forEach((step, index) => {
        const stepLabel = step.stepId ?? `Stap ${index + 1}`;
        const { operationDetails, suffix } = describeStepOperation(step, operationLookup);
        lines.push(`- **${stepLabel}${suffix}**`);
        const summary = operationDetails?.summary;
        const descriptionText = operationDetails?.description;
        if (summary) lines.push(`  - ${summary}`);
        if (descriptionText && descriptionText !== summary) lines.push(`  - ${descriptionText}`);
        const stepDescription = normalizeText(step.description);
        if (stepDescription && stepDescription !== summary && stepDescription !== descriptionText) {
          lines.push(`  - ${stepDescription}`);
        }
        appendCriteriaLines(lines, step.successCriteria, "Succescriteria");
        appendCriteriaLines(lines, step.failureCriteria, "Faalcriteria");
        appendOutputs(lines, step.outputs);
      });
    }
  });

  return lines.join("\n");
};

const escapeMermaidLabel = (value: unknown): string => (value ? String(value).replace(/"/g, '\\"') : "");

const sanitizeMermaidId = (value: string | undefined, fallback: string): string => {
  if (typeof value !== "string" || value.trim() === "") return fallback;
  const sanitized = value.replace(/[^a-zA-Z0-9_]/g, "_");
  if (!sanitized) return fallback;
  if (/^[0-9]/.test(sanitized)) return `S_${sanitized}`;
  return sanitized;
};

const buildMermaid = (document: ArazzoDocument, openapi?: Record<string, unknown>): string => {
  const operationLookup = buildOperationLookup(openapi);
  const lines = ["flowchart TD"];

  (document.workflows ?? []).forEach((workflow, workflowIndex) => {
    const workflowTitle =
      normalizeText(workflow.summary) || workflow.workflowId || `Workflow ${workflowIndex + 1}`;
    lines.push("", `subgraph "${escapeMermaidLabel(workflowTitle)}"`);

    const steps = Array.isArray(workflow.steps) ? workflow.steps : [];
    if (steps.length === 0) {
      lines.push('    EmptyWorkflow["Geen stappen gedefinieerd"]');
      lines.push("end");
      return;
    }

    const workflowKey = sanitizeMermaidId(workflow.workflowId ?? `workflow_${workflowIndex + 1}`, `workflow_${workflowIndex + 1}`);
    const nodeIds = steps.map((step, index) => {
      const stepKey = sanitizeMermaidId(step.stepId ?? `step_${index + 1}`, `step_${index + 1}`);
      return `${workflowKey}_${stepKey}`;
    });

    steps.forEach((step, index) => {
      const stepLabel = step.stepId ?? `Stap ${index + 1}`;
      const { suffix } = describeStepOperation(step, operationLookup);
      const label = escapeMermaidLabel(`${stepLabel}${suffix}`);
      lines.push(`    ${nodeIds[index]}["${label}"]`);
    });

    for (let i = 0; i < nodeIds.length - 1; i += 1) {
      lines.push(`    ${nodeIds[i]} --> ${nodeIds[i + 1]}`);
    }

    lines.push("end");
  });

  return lines.join("\n");
};

const convertInputToArazzo = async (
  input: OasInput,
): Promise<{ arazzoDocument: ArazzoDocument; openapiDocument?: Record<string, unknown> }> => {
  const resolved = await resolveVisualizationInput(input);
  if (!resolved.contents.trim()) throw new HttpError(400, EMPTY_BODY_ERROR);

  const parsed = parseYamlOrUndefined(resolved.contents);
  const isArazzo = Boolean(parsed && (parsed as ArazzoDocument).arazzo);
  const openapiDocument = parsed && !isArazzo ? parsed : undefined;

  try {
    const arazzoDocument = isArazzo
      ? await loadArazzoDocumentFromContents(resolved.contents)
      : await generateArazzoFromOpenApi(resolved.contents);
    return { arazzoDocument, openapiDocument };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    const message = error instanceof Error ? error.message : INVALID_SPEC_ERROR;
    throw new HttpError(400, message && message !== "Unknown error" ? message : INVALID_SPEC_ERROR, {
      detail: message,
    });
  }
};

export const visualizeArazzo = async (input: OasInput): Promise<{ markdown: string; mermaid: string }> => {
  const { arazzoDocument, openapiDocument } = await convertInputToArazzo(input);
  return {
    markdown: buildMarkdown(arazzoDocument, openapiDocument),
    mermaid: buildMermaid(arazzoDocument, openapiDocument),
  };
};
