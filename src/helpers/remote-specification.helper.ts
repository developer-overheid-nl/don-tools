import { config } from "../config.js";
import { HttpError } from "../utils/problem-details.js";

const DEFAULT_ERROR_MESSAGE = "Het ophalen van de specificatie is mislukt.";
const DEFAULT_ORIGIN = "https://developer.overheid.nl";

interface FetchOptions {
  errorMessage?: string;
}

const normalizeErrorDetail = (error: unknown): string => {
  if (!error || typeof error !== "object") return "Onbekende netwerkfout";
  const e = error as { message?: string; code?: string; type?: string };
  const parts: string[] = [];
  if (e.message) parts.push(e.message);
  if (e.code) parts.push(`code=${e.code}`);
  if (e.type) parts.push(`type=${e.type}`);
  return parts.join(" ").trim() || "Onbekende netwerkfout";
};

const doFetch = async (url: string, origin: string | undefined): Promise<string> => {
  const controller = new AbortController();
  const timeout = config.oasFetchTimeoutMs;
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  try {
    const headers: Record<string, string> = {};
    if (origin) headers.Origin = origin;
    const response = await fetch(url, { signal: controller.signal, headers });
    if (!response.ok) {
      const preview = await response.text().catch(() => "");
      const trimmed = preview ? preview.slice(0, 200) : "";
      throw new Error(`Server gaf status ${response.status}${trimmed ? `: ${trimmed}` : ""}`);
    }
    return await response.text();
  } finally {
    clearTimeout(timeoutId);
  }
};

export const fetchSpecification = async (url: string, options: FetchOptions = {}): Promise<string> => {
  const { errorMessage = DEFAULT_ERROR_MESSAGE } = options;
  const attempts: Array<string | undefined> = [DEFAULT_ORIGIN, undefined];
  let lastError: unknown;
  for (const origin of attempts) {
    try {
      return await doFetch(url, origin);
    } catch (error) {
      lastError = error;
    }
  }
  throw new HttpError(400, errorMessage, { detail: normalizeErrorDetail(lastError) });
};
