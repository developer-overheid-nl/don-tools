// Public logic-package types. The HTTP API repository can map these to its
// OpenAPI request and response schemas.

export interface OasInput {
  oasBody?: string;
  oasUrl?: string;
  arazzoBody?: string;
  arazzoUrl?: string;
  targetVersion?: string;
}

export type RulesetVersion = "2.0" | "2.1" | "2.2" | "draft";

export interface ValidateInput extends OasInput {
  targetVersion?: RulesetVersion;
}

export interface UntrustedClientInput {
  email: string;
}

export interface KeycloakClientResult {
  apiKey?: string;
}

export interface LintMessageInfo {
  id?: string;
  lintMessageId?: string;
  message?: string;
  path?: string;
}

export interface LintMessage {
  id?: string;
  code?: string;
  createdAt?: string;
  severity?: string;
  infos?: LintMessageInfo[];
}

export interface LintResult {
  id?: string;
  apiId?: string;
  createdAt?: string;
  failures?: number;
  messages?: LintMessage[];
  score?: number;
  successes?: boolean;
  rulesetVersion?: string;
}

export interface ProblemError {
  detail: string;
  pointer: string;
}

export interface Problem {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  errors?: ProblemError[];
}
