import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";
import { resolveOasInput } from "../helpers/oas-input.helper.js";
import type { LintResult, RulesetVersion, ValidateInput } from "../types/api.js";

// don-checker only publishes a CLI bundle (no library exports), so we run it as
// a child process: the spec goes in on stdin, diagnostics come back as JSON.
const DON_CHECKER_CLI = fileURLToPath(import.meta.resolve("@developer-overheid-nl/don-checker/dist/cli.mjs"));

// Public ruleset versions mapped onto don-checker's `adr` standard versions.
// don-checker has no 2.2 release; its `werkversie` tracks the latest ADR draft.
const DON_CHECKER_VERSIONS: Record<RulesetVersion, string> = {
  "2.0": "2.0.2",
  "2.1": "2.1.0",
  "2.2": "werkversie",
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

interface DonCheckerDiagnostic {
  code?: string;
  severity?: string;
  message: string;
  path?: Array<string | number>;
}

interface DonCheckerOutput {
  diagnostics: DonCheckerDiagnostic[];
}

const buildInfo = (lintMessageId: string, diagnostic: DonCheckerDiagnostic) => {
  const pathValue =
    Array.isArray(diagnostic.path) && diagnostic.path.length > 0 ? diagnostic.path.map(String).join(".") : "body";
  return [{ id: randomUUID(), lintMessageId, message: diagnostic.message, path: pathValue }];
};

const mapDiagnosticsToMessages = (diagnostics: DonCheckerDiagnostic[], timestamp: string) =>
  diagnostics.map((diagnostic) => {
    const lintMessageId = randomUUID();
    const severity = SEVERITY_LABELS.find((label) => label === diagnostic.severity) ?? "info";
    return {
      id: lintMessageId,
      code: diagnostic.code || "spectral",
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

const buildLintResult = (diagnostics: DonCheckerDiagnostic[], rulesetVersion: string): LintResult => {
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

const runDonChecker = (contents: string, version: string): Promise<DonCheckerDiagnostic[]> =>
  new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [DON_CHECKER_CLI, "validate", "--standard", "adr", "--version", version, "--format", "json", "--fail-on", "none"],
      { stdio: ["pipe", "pipe", "pipe"], timeout: config.validatorTimeoutMs },
    );
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code !== 0) {
        const detail = Buffer.concat(stderr).toString("utf8").trim() || `exit code ${code ?? signal}`;
        reject(new Error(`don-checker validatie is mislukt: ${detail}`));
        return;
      }
      try {
        const output = JSON.parse(Buffer.concat(stdout).toString("utf8")) as DonCheckerOutput;
        resolve(Array.isArray(output.diagnostics) ? output.diagnostics : []);
      } catch (error) {
        reject(new Error("don-checker gaf geen geldige JSON-output terug.", { cause: error }));
      }
    });
    // The CLI may exit before reading all of stdin (e.g. on a startup error);
    // the close handler reports that, so an EPIPE here is not interesting.
    child.stdin.on("error", () => {});
    child.stdin.end(contents);
  });

export const validatorOpenAPIPost = async (input: ValidateInput): Promise<LintResult> => {
  const { contents } = await resolveOasInput(input);
  const rulesetVersion: RulesetVersion = input.targetVersion ?? DEFAULT_RULESET_VERSION;
  const diagnostics = await runDonChecker(contents, DON_CHECKER_VERSIONS[rulesetVersion]);
  return buildLintResult(diagnostics, rulesetVersion);
};
