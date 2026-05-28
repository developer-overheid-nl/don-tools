import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const rootDir = join(here, "..");

const parseInt10 = (value: string | undefined, fallback: number): number => {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const config = {
  rootDir,
  openapiSpecPath: join(rootDir, "api", "openapi.json"),
  port: parseInt10(process.env.PORT, 1338),
  host: process.env.HOST ?? "0.0.0.0",
  logLevel: process.env.LOG_LEVEL ?? "info",
  nodeEnv: process.env.NODE_ENV ?? "development",
  oasFetchTimeoutMs: parseInt10(process.env.OAS_FETCH_TIMEOUT_MS, 45000),
  keycloak: {
    baseUrl: process.env.KEYCLOAK_BASE_URL ?? "",
    realm: process.env.KEYCLOAK_REALM ?? "",
    clientId: process.env.AUTH_CLIENT_ID ?? "",
    clientSecret: process.env.AUTH_CLIENT_SECRET ?? "",
  },
} as const;
