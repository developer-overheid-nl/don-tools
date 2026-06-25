const parseInt10 = (value: string | undefined, fallback: number): number => {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const config = {
  oasFetchTimeoutMs: parseInt10(process.env.OAS_FETCH_TIMEOUT_MS, 45000),
  keycloak: {
    baseUrl: process.env.KEYCLOAK_BASE_URL ?? "",
    realm: process.env.KEYCLOAK_REALM ?? "",
    clientId: process.env.AUTH_CLIENT_ID ?? "",
    clientSecret: process.env.AUTH_CLIENT_SECRET ?? "",
  },
} as const;
