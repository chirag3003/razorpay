import { BASE_URL } from "@/lib/api/client";

/**
 * MCP OAuth's consent endpoints — deliberately not `apiFetch`. The backend's own comment in
 * `routes/oauth.ts` notes this pair uses the spec-mandated `{error, error_description}` shape,
 * not this app's usual `{error, code}`, and every failure here (unknown/decided/expired request)
 * comes back with the same `error` code regardless of cause — only the HTTP status (404/409/410)
 * tells them apart. `OAuthRequestError.status` is what callers should branch on.
 */

export type AuthorizeRequestInfo = {
  requestId: string;
  clientName: string;
  scope: string;
};

export class OAuthRequestError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "OAuthRequestError";
    this.status = status;
  }
}

async function toOAuthError(res: Response): Promise<OAuthRequestError> {
  let message = "Something went wrong. Try again.";
  try {
    const body = (await res.json()) as { error_description?: string };
    if (body?.error_description) message = body.error_description;
  } catch {
    // Non-JSON error body — keep the generic message.
  }
  return new OAuthRequestError(message, res.status);
}

function requireBaseUrl() {
  if (!BASE_URL) {
    throw new OAuthRequestError(
      "NEXT_PUBLIC_API_BASE_URL is not set — add it to web/.env.local",
      0
    );
  }
  return BASE_URL;
}

export async function getAuthorizeRequest(
  requestId: string
): Promise<AuthorizeRequestInfo> {
  const base = requireBaseUrl();
  let res: Response;
  try {
    res = await fetch(`${base}/api/oauth/authorize/${requestId}`);
  } catch {
    throw new OAuthRequestError("Can't reach the server. Check your connection and try again.", 0);
  }
  if (!res.ok) throw await toOAuthError(res);
  return res.json();
}

export async function decideAuthorizeRequest(
  requestId: string,
  decision: "approve" | "deny",
  token: string
): Promise<{ redirectTo: string }> {
  const base = requireBaseUrl();
  let res: Response;
  try {
    res = await fetch(`${base}/api/oauth/authorize/decision`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ requestId, decision }),
    });
  } catch {
    throw new OAuthRequestError("Can't reach the server. Check your connection and try again.", 0);
  }
  if (!res.ok) throw await toOAuthError(res);
  return res.json();
}
