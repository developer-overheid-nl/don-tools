export interface ProblemError {
  detail: string;
  pointer: string;
}

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  errors?: ProblemError[];
}

const STATUS_TEXTS: Record<number, string> = {
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  405: "Method Not Allowed",
  409: "Conflict",
  415: "Unsupported Media Type",
  422: "Unprocessable Entity",
  429: "Too Many Requests",
  500: "Internal Server Error",
  501: "Not Implemented",
  502: "Bad Gateway",
  503: "Service Unavailable",
  504: "Gateway Timeout",
};

export const statusText = (status: number): string => STATUS_TEXTS[status] ?? "Unknown Error";

export class HttpError extends Error {
  readonly status: number;
  readonly detail: string;
  readonly errors?: ProblemError[];

  constructor(
    status: number,
    message: string,
    options: { detail?: string; errors?: ProblemError[]; cause?: unknown } = {},
  ) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = "HttpError";
    this.status = status;
    this.detail = options.detail ?? message;
    if (options.errors) this.errors = options.errors;
  }
}

export const toProblemDetails = (error: unknown, instance?: string): ProblemDetails => {
  if (error instanceof HttpError) {
    return {
      type: `https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status/${error.status}`,
      title: statusText(error.status),
      status: error.status,
      detail: error.detail,
      ...(instance ? { instance } : {}),
      ...(error.errors ? { errors: error.errors } : {}),
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  return {
    type: "https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status/500",
    title: statusText(500),
    status: 500,
    detail: message,
    ...(instance ? { instance } : {}),
  };
};
