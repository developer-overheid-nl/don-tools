import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { adr20, adr21, adr22, adrDraft } from "@developer-overheid-nl/adr-rulesets/rulesets";
import { config } from "../config.js";
import { resolveOasInput } from "../helpers/oas-input.helper.js";
import type { LintResult, RulesetVersion, ValidateInput } from "../types/api.js";

// don-checker only publishes a CLI bundle (no library exports), so we run it as
// a child process: the spec goes in on stdin, diagnostics come back as JSON.
const DON_CHECKER_CLI = fileURLToPath(import.meta.resolve("@developer-overheid-nl/don-checker/dist/cli.mjs"));

// Public ruleset versions mapped onto don-checker's `adr` standard versions and the
// adr-rulesets ruleset each of those runs. `draft` is don-checker's `werkversie`,
// which tracks the latest ADR draft.
const ADR_VERSIONS: Record<RulesetVersion, { donChecker: string; ruleset: unknown }> = {
  "2.0": { donChecker: "2.0.2", ruleset: adr20 },
  "2.1": { donChecker: "2.1.0", ruleset: adr21 },
  "2.2": { donChecker: "2.2.0", ruleset: adr22 },
  draft: { donChecker: "werkversie", ruleset: adrDraft },
};

const DEFAULT_RULESET_VERSION: RulesetVersion = "2.1";
const SEVERITY_LABELS = ["error", "warning", "info", "hint"] as const;

const ruleSeverity = (rule: unknown): unknown =>
  typeof rule === "object" && rule !== null ? (rule as { severity?: unknown }).severity : rule;

// The score measures the rules a version's ruleset treats as errors; taking them
// from the ruleset itself avoids a hand-maintained list of codes. Warnings never
// fail an API.
const SCORED_RULES: Record<RulesetVersion, Set<string>> = Object.fromEntries(
  Object.entries(ADR_VERSIONS).map(([version, { ruleset }]) => {
    const rules = (ruleset as { rules?: Record<string, unknown> }).rules ?? {};
    const codes = Object.entries(rules)
      .filter(([, rule]) => ruleSeverity(rule) === "error")
      .map(([code]) => code);
    return [version, new Set(codes)];
  }),
) as Record<RulesetVersion, Set<string>>;

// Diagnostics meaning the document could not be checked as OpenAPI at all.
const UNCHECKABLE_CODES = new Set(["parser", "unrecognized-format"]);

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

const computeAdrScore = (
  messages: Array<{ severity: string; code: string }>,
  rulesetVersion: RulesetVersion,
): { score: number } => {
  if (messages.some((message) => UNCHECKABLE_CODES.has(message.code))) return { score: 0 };
  const scoredRules = SCORED_RULES[rulesetVersion];
  const failedRules = new Set(
    messages
      .filter((message) => message.severity === "error" && scoredRules.has(message.code))
      .map((message) => message.code),
  );
  if (scoredRules.size === 0) return { score: 100 };
  return { score: Math.round((1 - failedRules.size / scoredRules.size) * 100) };
};

const buildLintResult = (diagnostics: DonCheckerDiagnostic[], rulesetVersion: RulesetVersion): LintResult => {
  const timestamp = new Date().toISOString();
  const messages = mapDiagnosticsToMessages(diagnostics, timestamp);
  const errorCount = messages.filter((m) => String(m.severity).toLowerCase() === "error").length;
  const { score } = computeAdrScore(messages, rulesetVersion);
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
  const diagnostics = await runDonChecker(contents, ADR_VERSIONS[rulesetVersion].donChecker);
  return buildLintResult(diagnostics, rulesetVersion);
};
