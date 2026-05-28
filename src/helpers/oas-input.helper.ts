import { HttpError } from "../utils/problem-details.js";
import type { OasInput } from "../types/api.js";
import { fetchSpecification } from "./remote-specification.helper.js";

export interface ResolvedOasInput {
  source: string;
  contents: string;
}

// AJV (driven by the OpenAPI schema) guarantees the input is an object with at
// least one non-empty body or a valid-URI url. This resolver trusts those
// constraints; the trailing throw is a safety net for callers that bypass the
// HTTP boundary (e.g. arazzo's own fallback path that does not require oas*).
export const resolveOasInput = async (input: OasInput): Promise<ResolvedOasInput> => {
  if (input.oasBody) return { source: "request-body", contents: input.oasBody };
  if (input.oasUrl) {
    const contents = await fetchSpecification(input.oasUrl, {
      errorMessage: "Het ophalen van de OpenAPI specificatie is mislukt.",
    });
    return { source: input.oasUrl, contents };
  }
  throw new HttpError(400, "Geef een oasBody of oasUrl mee.");
};
