import { KeycloakClient, translateKeycloakError } from "../helpers/keycloak.helper.js";
import { HttpError } from "../utils/problem-details.js";
import type { KeycloakClientResult, UntrustedClientInput } from "../types/api.js";

const keycloakClient = KeycloakClient.fromConfig();

export const untrustedClient = async (input: UntrustedClientInput): Promise<KeycloakClientResult> => {
  if (!keycloakClient.isConfigured()) {
    throw new HttpError(500, "Keycloak service niet geconfigureerd");
  }
  try {
    return await keycloakClient.createClient({ email: input.email });
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw translateKeycloakError(error);
  }
};
