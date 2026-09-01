import { Hono, type Context } from "hono";
import { zValidator } from "@hono/zod-validator";
import { oauthMetadataResponse } from "@modelcontextprotocol/server";
import type { OAuthMetadata } from "@modelcontextprotocol/server";
import { env } from "../config/env";
import { requireAuth } from "../middleware/auth";
import * as oauthService from "../services/oauthService";
import { OAuthProtocolError } from "../services/oauthService";
import {
  registerClientSchema,
  createAuthorizationRequestSchema,
  authorizeDecisionSchema,
  tokenRequestSchema,
} from "../schemas/oauth.schema";
import type { AppEnv } from "../types";

// MCP OAuth. This backend is both Authorization Server and Resource Server — userService is
// already the identity source, so there is no separate IdP to delegate to. routes/mcp.ts is the
// Resource Server half.
//
// OAuth error responses use a spec-mandated wire shape, re-shaped locally rather than left to
// app.onError.

const resourceUrl = new URL("/api/mcp", env.OAUTH_ISSUER_URL);

const oauthMetadata: OAuthMetadata = {
  issuer: env.OAUTH_ISSUER_URL,
  authorization_endpoint: new URL("/oauth/authorize", env.OAUTH_ISSUER_URL).toString(),
  token_endpoint: new URL("/oauth/token", env.OAUTH_ISSUER_URL).toString(),
  registration_endpoint: new URL("/oauth/register", env.OAUTH_ISSUER_URL).toString(),
  response_types_supported: ["code"],
  grant_types_supported: ["authorization_code", "refresh_token"],
  code_challenge_methods_supported: ["S256"],
  token_endpoint_auth_methods_supported: ["none"],
  scopes_supported: ["store:agent"],
};

export const oauthRoutes = new Hono<AppEnv>();

// RFC 9728 protected-resource and RFC 8414 authorization-server metadata, both from one handler:
// it inspects the path itself and returns undefined for anything else.
oauthRoutes.get("/.well-known/*", (c) => {
  return (
    oauthMetadataResponse(c.req.raw, {
      oauthMetadata,
      resourceServerUrl: resourceUrl,
      resourceName: "Razorpay Store",
      scopesSupported: ["store:agent"],
    }) ?? c.notFound()
  );
});

function oauthErrorResponse(c: Context, err: unknown) {
  if (err instanceof OAuthProtocolError) {
    return c.json(
      { error: err.oauthCode, error_description: err.message },
      err.status as 400 | 401 | 403 | 404 | 409 | 410
    );
  }
  throw err;
}

oauthRoutes.post("/oauth/register", zValidator("json", registerClientSchema), async (c) => {
  try {
    const result = await oauthService.registerClient(c.req.valid("json"));
    return c.json(result, 201);
  } catch (err) {
    return oauthErrorResponse(c, err);
  }
});

oauthRoutes.get(
  "/oauth/authorize",
  zValidator("query", createAuthorizationRequestSchema),
  async (c) => {
    try {
      const request = await oauthService.createAuthorizationRequest(c.req.valid("query"));
      const target = new URL("/agent-connect", env.PUBLIC_APP_URL);
      target.searchParams.set("request_id", request.id);
      return c.redirect(target.toString(), 302);
    } catch (err) {
      return oauthErrorResponse(c, err);
    }
  }
);

// Read-only lookup for web/'s consent page — see web/issues.md.
oauthRoutes.get("/api/oauth/authorize/:requestId", async (c) => {
  try {
    const info = await oauthService.getAuthorizationRequest(c.req.param("requestId"));
    return c.json(info);
  } catch (err) {
    return oauthErrorResponse(c, err);
  }
});

// Authenticated with the human's own session JWT — this is the identity being delegated to
// their agent, so it is the login they already have, not a new credential.
oauthRoutes.post(
  "/api/oauth/authorize/decision",
  requireAuth,
  zValidator("json", authorizeDecisionSchema),
  async (c) => {
    try {
      const { requestId, decision } = c.req.valid("json");
      const result = await oauthService.decideAuthorizationRequest(
        requestId,
        c.get("userId"),
        decision
      );
      return c.json(result);
    } catch (err) {
      return oauthErrorResponse(c, err);
    }
  }
);

oauthRoutes.post("/oauth/token", zValidator("form", tokenRequestSchema), async (c) => {
  try {
    const input = c.req.valid("form");

    if (input.grant_type === "authorization_code") {
      if (!input.code || !input.code_verifier || !input.redirect_uri) {
        throw new OAuthProtocolError(
          "invalid_request",
          "code, code_verifier, and redirect_uri are required for authorization_code"
        );
      }
      const tokens = await oauthService.exchangeAuthorizationCode({
        code: input.code,
        codeVerifier: input.code_verifier,
        clientId: input.client_id,
        redirectUri: input.redirect_uri,
      });
      return c.json(tokens);
    }

    if (!input.refresh_token) {
      throw new OAuthProtocolError("invalid_request", "refresh_token is required for refresh_token grant");
    }
    const tokens = await oauthService.refreshAccessToken({
      refreshToken: input.refresh_token,
      clientId: input.client_id,
    });
    return c.json(tokens);
  } catch (err) {
    return oauthErrorResponse(c, err);
  }
});
