import { randomUUID } from "node:crypto";
import spectralCore from "@stoplight/spectral-core";
import spectralParsers from "@stoplight/spectral-parsers";
import adr20 from "@developer-overheid-nl/adr-rulesets/rulesets/adr-20";
import adr21 from "@developer-overheid-nl/adr-rulesets/rulesets/adr-21";
import adr22 from "@developer-overheid-nl/adr-rulesets/rulesets/adr-22";
import adrDraft from "@developer-overheid-nl/adr-rulesets/rulesets/adr-draft";
import { resolveOasInput } from "../helpers/oas-input.helper.js";
import type { LintResult, RulesetVersion, ValidateInput } from "../types/api.js";

const { Spectral, Document } = spectralCore;
type SpectralInstance = InstanceType<typeof Spectral>;
const Parsers = spectralParsers;

const buildSpectral = (ruleset: unknown): SpectralInstance => {
  const instance = new Spectral();
  // biome-ignore lint/suspicious/noExplicitAny: spectral ruleset typing is loose
  instance.setRuleset(ruleset as any);
  return instance;
};

const SPECTRAL_INSTANCES: Record<RulesetVersion, SpectralInstance> = {
  "2.0": buildSpectral(adr20),
  "2.1": buildSpectral(adr21),
  "2.2": buildSpectral(adr22),
  draft: buildSpectral(adrDraft),
};

const DEFAULT_RULESET_VERSION: RulesetVersion = "2.1";
const SEVERITY_LABELS = ["error", "warning", "info", "hint"] as const;

const MEASURED_RULE_GROUPS: Record<string, string> = {
  openapi3: "openapi3",
  "nlgov:openapi3": "openapi3",
  "openapi-root-exists": "openapi-root-exists",
  "nlgov:openapi-root-exists": "openapi-root-exists",
  "missing-version-header": "version-header",
  "nlgov:missing-version-header": "version-header",
  "missing-header": "version-header",
  "nlgov:missing-header": "version-header",
  "include-major-version-in-uri": "include-major-version-in-uri",
  "nlgov:include-major-version-in-uri": "include-major-version-in-uri",
  "paths-no-trailing-slash": "paths-no-trailing-slash",
  "nlgov:paths-no-trailing-slash": "paths-no-trailing-slash",
  "info-contact-fields-exist": "info-contact-fields-exist",
  "nlgov:info-contact-fields-exist": "info-contact-fields-exist",
  "http-methods": "http-methods",
  "nlgov:http-methods": "http-methods",
  semver: "semver",
  "nlgov:semver": "semver",
};

const MEASURED_GROUP_KEYS = Array.from(new Set(Object.values(MEASURED_RULE_GROUPS)));

interface SpectralDiagnostic {
  code?: string | number;
  severity?: number;
  message: string;
  path?: Array<string | number>;
}

const buildInfo = (lintMessageId: string, diagnostic: SpectralDiagnostic) => {
  const pathValue =
    Array.isArray(diagnostic.path) && diagnostic.path.length > 0 ? diagnostic.path.map(String).join(".") : "body";
  return [{ id: randomUUID(), lintMessageId, message: diagnostic.message, path: pathValue }];
};

const mapDiagnosticsToMessages = (diagnostics: SpectralDiagnostic[], timestamp: string) =>
  diagnostics.map((diagnostic) => {
    const lintMessageId = randomUUID();
    const severityIndex =
      typeof diagnostic.severity === "number" && diagnostic.severity >= 0 ? diagnostic.severity : 2;
    const severity = SEVERITY_LABELS[severityIndex] ?? "info";
    return {
      id: lintMessageId,
      code: diagnostic.code != null ? String(diagnostic.code) : "spectral",
      createdAt: timestamp,
      severity,
      infos: buildInfo(lintMessageId, diagnostic),
    };
  });

const computeAdrScore = (messages: Array<{ severity: string; code: string }>): { score: number } => {
  const failedGroups = new Set<string>();
  for (const message of messages) {
    if (String(message.severity).toLowerCase() !== "error") continue;
    const group = MEASURED_RULE_GROUPS[message.code];
    if (group) failedGroups.add(group);
  }
  if (MEASURED_GROUP_KEYS.length === 0) return { score: 100 };
  const score = Math.round((1 - failedGroups.size / MEASURED_GROUP_KEYS.length) * 100);
  return { score: Math.max(0, Math.min(100, score)) };
};

const buildLintResult = (diagnostics: SpectralDiagnostic[], rulesetVersion: string): LintResult => {
  const timestamp = new Date().toISOString();
  const messages = mapDiagnosticsToMessages(diagnostics, timestamp);
  const errorCount = messages.filter((m) => String(m.severity).toLowerCase() === "error").length;
  const { score } = computeAdrScore(messages);
  return {
    id: randomUUID(),
    apiId: "",
    createdAt: timestamp,
    failures: errorCount,
    messages,
    score,
    successes: score === 100,
    rulesetVersion,
  };
};

export const validatorOpenAPIPost = async (input: ValidateInput): Promise<LintResult> => {
  const { contents, source } = await resolveOasInput(input);
  const rulesetVersion: RulesetVersion = input.targetVersion ?? DEFAULT_RULESET_VERSION;
  const spectral = SPECTRAL_INSTANCES[rulesetVersion];
  const document = new Document(contents, Parsers.Yaml, source);
  const parseDiagnostics = (Array.isArray(document.diagnostics) ? document.diagnostics : []) as SpectralDiagnostic[];
  const lintDiagnostics = (await spectral.run(document, { ignoreUnknownFormat: false })) as SpectralDiagnostic[];
  return buildLintResult([...parseDiagnostics, ...lintDiagnostics], rulesetVersion);
};
