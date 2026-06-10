import openapiToPostman from "openapi-to-postmanv2";
import { HttpError } from "../utils/problem-details.js";
import { resolveOasInput } from "../helpers/oas-input.helper.js";
import type { OasInput } from "../types/api.js";
import { sanitizeFileName } from "../utils/file-name.js";

const EMPTY_BODY_ERROR = "Body ontbreekt of ongeldig: gebruik oasUrl of oasBody";
const DEFAULT_COLLECTION_NAME = "postman-collection";

export interface PostmanResult {
  headers: Record<string, string>;
  rawBody: Buffer;
}

interface PostmanConversionResult {
  result: boolean;
  reason?: string;
  output?: Array<{ type: string; data: { info?: { name?: string } } }>;
}

const convertToPostman = (data: string): Promise<PostmanConversionResult> =>
  new Promise((resolve, reject) => {
    openapiToPostman.convert({ type: "string", data }, {}, (error: Error | null, result: PostmanConversionResult) => {
      if (error) return reject(error);
      if (result?.result !== true) {
        const reason = typeof result?.reason === "string" ? result.reason : "Conversie naar Postman is mislukt.";
        return reject(new Error(reason));
      }
      resolve(result);
    });
  });

export const createPostmanCollection = async (input: OasInput): Promise<PostmanResult> => {
  const resolved = await resolveOasInput(input);
  const trimmed = resolved.contents.trim();
  if (!trimmed) throw new HttpError(400, EMPTY_BODY_ERROR);

  let conversionResult: PostmanConversionResult;
  try {
    conversionResult = await convertToPostman(trimmed);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Conversie naar Postman is mislukt.";
    throw new HttpError(500, message);
  }

  const collectionOutput = Array.isArray(conversionResult.output)
    ? conversionResult.output.find((item) => item.type === "collection")
    : null;
  if (!collectionOutput?.data) throw new HttpError(500, "Conversie naar Postman heeft geen collectie opgeleverd.");

  const collection = collectionOutput.data;
  const collectionName = collection?.info?.name ?? DEFAULT_COLLECTION_NAME;
  const filenameBase = sanitizeFileName(collectionName, { fallback: DEFAULT_COLLECTION_NAME, lowercase: true });
  const json = JSON.stringify(collection, null, 2);

  return {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="${filenameBase}.json"`,
    },
    rawBody: Buffer.from(json, "utf8"),
  };
};
