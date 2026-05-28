const DEFAULT_MAX_LENGTH = 128;

interface SanitizeOptions {
  fallback?: string;
  lowercase?: boolean;
  maxLength?: number;
}

const internalSanitize = (value: unknown, lowercase: boolean, maxLength: number): string => {
  if (typeof value !== "string") return "";

  let working = value.trim();
  if (working.length === 0) return "";

  try {
    working = working.normalize("NFKD").replace(/\p{M}+/gu, "");
  } catch {
    // ignore normalization issues
  }

  working = working
    .replace(/["']/g, "")
    .replace(/\p{Cc}+/gu, " ")
    .replace(/[<>:"/\\|?*]+/g, "-")
    .replace(/[^0-9A-Za-z._\s-]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_.]+|[-_.]+$/g, "")
    .trim();

  if (lowercase) working = working.toLowerCase();
  if (maxLength > 0 && working.length > maxLength) working = working.slice(0, maxLength);
  return working;
};

export const sanitizeFileName = (value: unknown, options: SanitizeOptions = {}): string => {
  const { fallback = "", lowercase = false, maxLength = DEFAULT_MAX_LENGTH } = options;
  const sanitized = internalSanitize(value, lowercase, maxLength);
  if (sanitized) return sanitized;
  if (typeof fallback === "string" && fallback.length > 0) {
    const fallbackSanitized = internalSanitize(fallback, lowercase, maxLength);
    if (fallbackSanitized) return fallbackSanitized;
  }
  return "";
};
