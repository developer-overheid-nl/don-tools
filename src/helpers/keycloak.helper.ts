import { randomUUID } from "node:crypto";
import { config } from "../config.js";
import { HttpError } from "../utils/problem-details.js";

const KEYCLOAK_CLIENT_DESCRIPTION =
  "Dit is een read-only api key. Meer info: https://apis.developer.overheid.nl/apis/toevoegen";
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_ERROR_BODY_LENGTH = 8192;

export const KEYCLOAK_ERROR_CODES = {
  CONFIG: "config",
  CONFLICT: "conflict",
  UNAUTHORIZED: "unauthorized",
  CLIENT_ID_MISSING: "client_id_missing",
  GENERIC: "generic",
} as const;

type ErrorCode = (typeof KEYCLOAK_ERROR_CODES)[keyof typeof KEYCLOAK_ERROR_CODES];

export class KeycloakError extends Error {
  readonly code: ErrorCode;

  constructor(message: string, code: ErrorCode = KEYCLOAK_ERROR_CODES.GENERIC) {
    super(message);
    this.name = "KeycloakError";
    this.code = code;
  }
}

const truncate = (value: string): string =>
  value.length <= MAX_ERROR_BODY_LENGTH ? value : `${value.slice(0, MAX_ERROR_BODY_LENGTH)}…`;

const buildKeycloakPayload = (clientId: string, email: string): Record<string, unknown> => {
  const payload: Record<string, unknown> = {
    clientId,
    name: clientId,
    enabled: true,
    publicClient: true,
    directAccessGrantsEnabled: false,
    standardFlowEnabled: false,
    serviceAccountsEnabled: false,
    authorizationServicesEnabled: false,
    protocol: "openid-connect",
    description: KEYCLOAK_CLIENT_DESCRIPTION,
  };
  if (email) payload.attributes = { email };
  return payload;
};

const extractClientIdFromLocation = (locationHeader: string | null): string => {
  if (!locationHeader) throw new KeycloakError("Keycloak response bevat geen Location header");
  try {
    const url = new URL(locationHeader);
    const candidate = url.pathname.split("/").pop()?.trim();
    if (candidate) return candidate;
  } catch {
    // not a full URL — fall through
  }
  const lastSlash = locationHeader.lastIndexOf("/");
  if (lastSlash >= 0 && lastSlash < locationHeader.length - 1) {
    const candidate = locationHeader.slice(lastSlash + 1).trim();
    if (candidate) return candidate;
  }
  throw new KeycloakError(`Kan clientId niet bepalen uit Keycloak Location header: ${locationHeader}`);
};

const buildBase = (baseUrl: string, realm: string, suffix: string): string => {
  if (!baseUrl || !realm) return "";
  return `${baseUrl.replace(/\/+$/, "")}${suffix}${encodeURIComponent(realm)}`;
};

export class KeycloakClient {
  private readonly adminClientsURL: string;
  private readonly tokenURL: string;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly timeoutMs: number;

  private constructor(adminClientsURL: string, tokenURL: string, clientId: string, clientSecret: string) {
    this.adminClientsURL = adminClientsURL;
    this.tokenURL = tokenURL;
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.timeoutMs = DEFAULT_TIMEOUT_MS;
  }

  static fromConfig(): KeycloakClient {
    const { baseUrl, realm, clientId, clientSecret } = config.keycloak;
    const adminBase = buildBase(baseUrl, realm, "/admin/realms/");
    const tokenBase = buildBase(baseUrl, realm, "/realms/");
    return new KeycloakClient(
      adminBase ? `${adminBase}/clients` : "",
      tokenBase ? `${tokenBase}/protocol/openid-connect/token` : "",
      clientId,
      clientSecret,
    );
  }

  isConfigured(): boolean {
    return Boolean(this.adminClientsURL && this.tokenURL && this.clientId && this.clientSecret);
  }

  async createClient(input: { email: string }): Promise<{ apiKey: string }> {
    if (!this.isConfigured()) throw new KeycloakError("Keycloak configuratie ontbreekt", KEYCLOAK_ERROR_CODES.CONFIG);

    const token = await this.fetchToken();
    const newClientId = randomUUID();
    const payload = buildKeycloakPayload(newClientId, input.email);

    let response: Response;
    try {
      response = await fetch(this.adminClientsURL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
        throw new KeycloakError("Timeout tijdens verzoek naar Keycloak");
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new KeycloakError(`Netwerkfout richting Keycloak: ${message}`);
    }

    const responseText = truncate(await response.text());
    switch (response.status) {
      case 201:
        return { apiKey: extractClientIdFromLocation(response.headers.get("location")) };
      case 204:
        throw new KeycloakError("clientId ontbreekt of is ongeldig", KEYCLOAK_ERROR_CODES.CLIENT_ID_MISSING);
      case 409:
        throw new KeycloakError("Keycloak client bestaat al", KEYCLOAK_ERROR_CODES.CONFLICT);
      case 401:
      case 403:
        throw new KeycloakError("Geen toegang tot Keycloak admin API", KEYCLOAK_ERROR_CODES.UNAUTHORIZED);
      default: {
        const message = responseText || response.statusText || "Onbekende fout";
        throw new KeycloakError(`Keycloak response ${response.status}: ${message}`);
      }
    }
  }

  private async fetchToken(): Promise<string> {
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.clientId,
      client_secret: this.clientSecret,
    });

    let response: Response;
    try {
      response = await fetch(this.tokenURL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
        throw new KeycloakError("Timeout tijdens ophalen van Keycloak token");
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new KeycloakError(`Netwerkfout richting Keycloak token endpoint: ${message}`);
    }

    const text = truncate(await response.text());
    if (!response.ok) {
      if (response.status === 400 || response.status === 401 || response.status === 403) {
        throw new KeycloakError("autorisatie voor keycloak mislukt", KEYCLOAK_ERROR_CODES.UNAUTHORIZED);
      }
      throw new KeycloakError(`Keycloak token response ${response.status}: ${text || response.statusText}`);
    }

    let parsed: { access_token?: string };
    try {
      parsed = JSON.parse(text || "{}");
    } catch {
      throw new KeycloakError("Keycloak token response bevat geen geldig JSON");
    }
    const token = parsed.access_token;
    if (!token) throw new KeycloakError("Keycloak token ontbreekt in response");
    return token;
  }
}

export const translateKeycloakError = (error: unknown): HttpError => {
  if (!(error instanceof KeycloakError)) {
    const message = error instanceof Error ? error.message : "Er is een fout opgetreden.";
    return new HttpError(500, message);
  }
  switch (error.code) {
    case KEYCLOAK_ERROR_CODES.CONFIG:
      return new HttpError(500, "Keycloak configuratie ontbreekt");
    case KEYCLOAK_ERROR_CODES.CONFLICT:
      return new HttpError(409, "Keycloak client bestaat al");
    case KEYCLOAK_ERROR_CODES.UNAUTHORIZED:
      return new HttpError(403, "Geen toegang tot Keycloak admin API");
    case KEYCLOAK_ERROR_CODES.CLIENT_ID_MISSING:
      return new HttpError(400, "clientId ontbreekt of is ongeldig");
    default:
      return new HttpError(500, error.message || "Er is een fout opgetreden bij Keycloak.");
  }
};
