import { randomBytes, createHash } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db";
import {
  oauthClients,
  oauthAuthorizationRequests,
  oauthCodes,
  oauthRefreshTokens,
} from "../db/schema";
import { issueAgentToken, AGENT_TOKEN_TTL_SECONDS } from "./userService";
import type { RegisterClientInput, CreateAuthorizationRequestInput } from "../schemas/oauth.schema";

// MCP OAuth (RFC 9728 / 8414 / 7591 + authorization-code + PKCE). This backend is both the
// Authorization Server and the Resource Server — see backend/CLAUDE.md.
//
// Not a DomainError: OAuth's wire error shape (`{error, error_description}`) is a spec-mandated
// contract different from this app's `{error, code}`, so routes/oauth.ts shapes it directly
// rather than letting app.onError touch it.
export class OAuthProtocolError extends Error {
  constructor(
    readonly oauthCode: string,
    message: string,
    readonly status: number = 400
  ) {
    super(message);
  }
}

const AUTHORIZATION_REQUEST_TTL_MINUTES = 10;
const CODE_TTL_MINUTES = 5;
const REFRESH_TOKEN_TTL_DAYS = 30;
const DEFAULT_SCOPE = "store:agent";

function randomToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function minutesFromNow(minutes: number) {
  return new Date(Date.now() + minutes * 60 * 1000);
}

function daysFromNow(days: number) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

function isWellFormedHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/** RFC 7591 dynamic client registration. Public client only — no secret is ever issued. */
export async function registerClient(input: RegisterClientInput) {
  if (input.redirect_uris.length === 0 || !input.redirect_uris.every(isWellFormedHttpUrl)) {
    throw new OAuthProtocolError(
      "invalid_client_metadata",
      "redirect_uris must be a non-empty array of valid http(s) URLs"
    );
  }

  const id = randomToken(16);
  const [client] = await db
    .insert(oauthClients)
    .values({
      id,
      clientName: input.client_name ?? "Unnamed agent",
      redirectUris: input.redirect_uris,
    })
    .returning();

  if (!client) throw new Error("Failed to register OAuth client");

  return {
    client_id: client.id,
    client_id_issued_at: Math.floor(client.createdAt.getTime() / 1000),
    client_name: client.clientName,
    redirect_uris: client.redirectUris,
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
  };
}

async function getClient(clientId: string) {
  const [client] = await db
    .select()
    .from(oauthClients)
    .where(eq(oauthClients.id, clientId))
    .limit(1);
  if (!client) throw new OAuthProtocolError("invalid_client", "Unknown client_id");
  return client;
}

/**
 * GET /oauth/authorize's server half: validate, park the request, return the id to redirect to
 * web/'s consent page with. The decision happens later, once a human is identified.
 */
export async function createAuthorizationRequest(input: CreateAuthorizationRequestInput) {
  const client = await getClient(input.client_id);

  // Exact match only, no prefix match — the open-redirect guard. Otherwise an honestly
  // registered client could send victims through /authorize to any redirect_uri.
  if (!client.redirectUris.includes(input.redirect_uri)) {
    throw new OAuthProtocolError("invalid_request", "redirect_uri does not match a registered URI");
  }

  if (input.code_challenge_method !== "S256") {
    throw new OAuthProtocolError(
      "invalid_request",
      "code_challenge_method must be S256 — plain and missing PKCE are not supported"
    );
  }

  const [request] = await db
    .insert(oauthAuthorizationRequests)
    .values({
      clientId: client.id,
      redirectUri: input.redirect_uri,
      codeChallenge: input.code_challenge,
      scope: input.scope ?? DEFAULT_SCOPE,
      state: input.state,
      expiresAt: minutesFromNow(AUTHORIZATION_REQUEST_TTL_MINUTES),
    })
    .returning();

  if (!request) throw new Error("Failed to create authorization request");
  return request;
}

/** For web/'s consent page to render "<client name> wants to connect". */
export async function getAuthorizationRequest(requestId: string) {
  const [request] = await db
    .select()
    .from(oauthAuthorizationRequests)
    .where(eq(oauthAuthorizationRequests.id, requestId))
    .limit(1);

  if (!request) throw new OAuthProtocolError("invalid_request", "Unknown or expired request", 404);
  if (request.status !== "pending") {
    throw new OAuthProtocolError("invalid_request", "This request has already been decided", 409);
  }
  if (request.expiresAt < new Date()) {
    throw new OAuthProtocolError("invalid_request", "This request has expired", 410);
  }

  const client = await getClient(request.clientId);
  return { requestId: request.id, clientName: client.clientName, scope: request.scope };
}

/**
 * The human's decision, from web/'s consent page under their own session JWT. Approving mints a
 * single-use code; either way the request is consumed — a request_id decides exactly once.
 */
export async function decideAuthorizationRequest(
  requestId: string,
  userId: string,
  decision: "approve" | "deny"
) {
  const [request] = await db
    .select()
    .from(oauthAuthorizationRequests)
    .where(eq(oauthAuthorizationRequests.id, requestId))
    .limit(1);

  if (!request) throw new OAuthProtocolError("invalid_request", "Unknown or expired request", 404);
  if (request.status !== "pending") {
    throw new OAuthProtocolError("invalid_request", "This request has already been decided", 409);
  }
  if (request.expiresAt < new Date()) {
    throw new OAuthProtocolError("invalid_request", "This request has expired", 410);
  }

  const redirect = new URL(request.redirectUri);

  if (decision === "deny") {
    await db
      .update(oauthAuthorizationRequests)
      .set({ status: "denied", userId })
      .where(eq(oauthAuthorizationRequests.id, requestId));

    redirect.searchParams.set("error", "access_denied");
    if (request.state) redirect.searchParams.set("state", request.state);
    return { redirectTo: redirect.toString() };
  }

  const code = randomToken(32);
  await db.transaction(async (tx) => {
    await tx
      .update(oauthAuthorizationRequests)
      .set({ status: "approved", userId })
      .where(eq(oauthAuthorizationRequests.id, requestId));

    await tx.insert(oauthCodes).values({
      code,
      userId,
      clientId: request.clientId,
      redirectUri: request.redirectUri,
      codeChallenge: request.codeChallenge,
      scope: request.scope,
      expiresAt: minutesFromNow(CODE_TTL_MINUTES),
    });
  });

  redirect.searchParams.set("code", code);
  if (request.state) redirect.searchParams.set("state", request.state);
  return { redirectTo: redirect.toString() };
}

function verifyPkce(codeVerifier: string, codeChallenge: string) {
  const computed = createHash("sha256").update(codeVerifier).digest("base64url");
  return computed === codeChallenge;
}

async function issueTokenPair(userId: string, clientId: string, scope: string) {
  const accessToken = await issueAgentToken(userId);
  const refreshToken = randomToken(32);

  await db.insert(oauthRefreshTokens).values({
    tokenHash: hashToken(refreshToken),
    userId,
    clientId,
    expiresAt: daysFromNow(REFRESH_TOKEN_TTL_DAYS),
  });

  return {
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: AGENT_TOKEN_TTL_SECONDS,
    refresh_token: refreshToken,
    scope,
  };
}

export async function exchangeAuthorizationCode(input: {
  code: string;
  codeVerifier: string;
  clientId: string;
  redirectUri: string;
}) {
  const [record] = await db
    .select()
    .from(oauthCodes)
    .where(eq(oauthCodes.code, input.code))
    .limit(1);

  if (!record || record.consumedAt) {
    throw new OAuthProtocolError("invalid_grant", "Unknown, expired, or already-used code");
  }
  if (record.expiresAt < new Date()) {
    throw new OAuthProtocolError("invalid_grant", "Code has expired");
  }
  if (record.clientId !== input.clientId) {
    throw new OAuthProtocolError("invalid_grant", "client_id does not match the authorized code");
  }
  if (record.redirectUri !== input.redirectUri) {
    throw new OAuthProtocolError("invalid_grant", "redirect_uri does not match the authorization request");
  }
  if (!verifyPkce(input.codeVerifier, record.codeChallenge)) {
    throw new OAuthProtocolError("invalid_grant", "code_verifier does not match code_challenge");
  }

  // Consume before minting — a code is single-use even under a concurrent double-exchange.
  const consumed = await db
    .update(oauthCodes)
    .set({ consumedAt: new Date() })
    .where(and(eq(oauthCodes.code, input.code), isNull(oauthCodes.consumedAt)))
    .returning({ code: oauthCodes.code });

  if (consumed.length === 0) {
    throw new OAuthProtocolError("invalid_grant", "Code was already used");
  }

  return issueTokenPair(record.userId, record.clientId, record.scope);
}

export async function refreshAccessToken(input: { refreshToken: string; clientId: string }) {
  const tokenHash = hashToken(input.refreshToken);
  const [record] = await db
    .select()
    .from(oauthRefreshTokens)
    .where(eq(oauthRefreshTokens.tokenHash, tokenHash))
    .limit(1);

  if (!record || record.revokedAt) {
    throw new OAuthProtocolError("invalid_grant", "Unknown or revoked refresh token");
  }
  if (record.expiresAt < new Date()) {
    throw new OAuthProtocolError("invalid_grant", "Refresh token has expired");
  }
  if (record.clientId !== input.clientId) {
    throw new OAuthProtocolError("invalid_grant", "client_id does not match this refresh token");
  }

  // Revoke before minting: a stolen refresh token is good for one exchange, and whoever loses
  // the race finds theirs already dead.
  const revoked = await db
    .update(oauthRefreshTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(oauthRefreshTokens.tokenHash, tokenHash), isNull(oauthRefreshTokens.revokedAt)))
    .returning({ tokenHash: oauthRefreshTokens.tokenHash });

  if (revoked.length === 0) {
    throw new OAuthProtocolError("invalid_grant", "Refresh token was already used");
  }

  return issueTokenPair(record.userId, record.clientId, DEFAULT_SCOPE);
}
