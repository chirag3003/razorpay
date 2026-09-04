export const BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL;

export class ApiError extends Error {
  code: string;
  status: number;

  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

export class ApiValidationError extends ApiError {
  fieldErrors: { path: string; message: string }[];

  constructor(fieldErrors: { path: string; message: string }[], status: number) {
    super(fieldErrors[0]?.message ?? "Invalid input", "VALIDATION_ERROR", status);
    this.name = "ApiValidationError";
    this.fieldErrors = fieldErrors;
  }
}

type ApiFetchOptions = {
  method?: string;
  body?: unknown;
  token?: string | null;
  searchParams?: Record<string, string | number | boolean | undefined>;
};

function buildQueryString(
  searchParams?: ApiFetchOptions["searchParams"]
): string {
  if (!searchParams) return "";
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (value === undefined) continue;
    search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `?${query}` : "";
}

async function parseErrorResponse(res: Response): Promise<never> {
  const genericMessage =
    res.status >= 500
      ? "The server ran into a problem. Please try again in a moment."
      : "Something went wrong";
  const genericCode = res.status >= 500 ? "SERVER_ERROR" : "UNKNOWN";

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new ApiError(genericMessage, genericCode, res.status);
  }

  if (
    body &&
    typeof body === "object" &&
    "success" in body &&
    (body as { success: unknown }).success === false &&
    "error" in body
  ) {
    const errorField = (body as { error: unknown }).error;
    if (
      errorField &&
      typeof errorField === "object" &&
      "name" in errorField &&
      (errorField as { name: unknown }).name === "ZodError"
    ) {
      const rawMessage = (errorField as unknown as { message: unknown })
        .message;
      try {
        const issues = JSON.parse(String(rawMessage)) as {
          path: (string | number)[];
          message: string;
        }[];
        const fieldErrors = issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        }));
        throw new ApiValidationError(fieldErrors, res.status);
      } catch (err) {
        if (err instanceof ApiValidationError) throw err;
        throw new ApiError("Invalid input", "VALIDATION_ERROR", res.status);
      }
    }
  }

  if (
    body &&
    typeof body === "object" &&
    "error" in body &&
    typeof (body as { error: unknown }).error === "string"
  ) {
    const code =
      "code" in body && typeof (body as { code: unknown }).code === "string"
        ? (body as { code: string }).code
        : genericCode;
    throw new ApiError((body as { error: string }).error, code, res.status);
  }

  throw new ApiError(genericMessage, genericCode, res.status);
}

export async function apiFetch<T>(
  path: string,
  opts: ApiFetchOptions = {}
): Promise<T> {
  if (!BASE_URL) {
    throw new ApiError(
      "NEXT_PUBLIC_API_BASE_URL is not set — add it to web/.env.local",
      "CONFIG_ERROR",
      0
    );
  }

  // FormData carries its own encoding: it must be sent untouched, and setting Content-Type
  // ourselves would omit the multipart boundary the browser generates. Used by the voice upload
  // in lib/api/voice.ts — the alternative was a bare fetch in a component, which AGENTS.md
  // rules out.
  const isFormData =
    typeof FormData !== "undefined" && opts.body instanceof FormData;

  const headers: Record<string, string> = {};
  if (opts.body !== undefined && !isFormData) {
    headers["Content-Type"] = "application/json";
  }
  if (opts.token) headers["Authorization"] = `Bearer ${opts.token}`;

  let res: Response;
  try {
    res = await fetch(
      `${BASE_URL}${path}${buildQueryString(opts.searchParams)}`,
      {
        method: opts.method ?? "GET",
        headers,
        body: isFormData
          ? (opts.body as FormData)
          : opts.body !== undefined
            ? JSON.stringify(opts.body)
            : undefined,
      }
    );
  } catch {
    // Transport failure: server down, DNS, connection refused, offline.
    throw new ApiError(
      "Can't reach the server. Check your connection and try again.",
      "NETWORK_ERROR",
      0
    );
  }

  if (!res.ok) {
    await parseErrorResponse(res);
  }

  if (res.status === 204) {
    return undefined as T;
  }

  return (await res.json()) as T;
}

export function isNetworkError(err: unknown): boolean {
  return err instanceof ApiError && err.code === "NETWORK_ERROR";
}

export function isServerError(err: unknown): boolean {
  return (
    err instanceof ApiError &&
    (err.status >= 500 || err.code === "NETWORK_ERROR")
  );
}
