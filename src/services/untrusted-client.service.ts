import { KeycloakClient, translateKeycloakError } from "../helpers/keycloak.helper.js";
import { HttpError } from "../utils/problem-details.js";
import type { KeycloakClientResult, UntrustedClientInput } from "../types/api.js";

const keycloakClient = KeycloakClient.fromConfig();

export const untrustedClient = async (input: UntrustedClientInput): Promise<KeycloakClientResult> => {
  const email = typeof input.email === "string" ? input.email.trim() : "";
  if (!email) {
    throw new HttpError(400, "email ontbreekt of is ongeldig");
  }
  if (!keycloakClient.isConfigured()) {
    throw new HttpError(500, "Keycloak service niet geconfigureerd");
  }
  try {
    return await keycloakClient.createClient({ email });
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw translateKeycloakError(error);
  }
};
