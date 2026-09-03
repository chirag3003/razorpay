import { Hono } from "hono";
import {
  createMcpHandler,
  requireBearerAuth,
  getOAuthProtectedResourceMetadataUrl,
  OAuthError,
  OAuthErrorCode,
} from "@modelcontextprotocol/server";
import type { AuthInfo, McpRequestContext } from "@modelcontextprotocol/server";
import { verifyAgentToken } from "../services/userService";
import { buildMcpServer } from "../agent-interfaces/mcp";
import { env } from "../config/env";
import { logger } from "../logger";

// The MCP endpoint. Auth is the agent JWT minted by routes/oauth.ts's authorization-code
// exchange. On failure requireBearerAuth returns the 401 + WWW-Authenticate challenge, which is
// what triggers an MCP client's OAuth discovery in the first place.
//
// One McpServer per request, closing over the resolved userId, so every tool call in that request
// is scoped to the account the token was issued for.

const resourceUrl = new URL("/api/mcp", env.OAUTH_ISSUER_URL);

const bearerGate = requireBearerAuth({
  verifier: {
    async verifyAccessToken(token: string): Promise<AuthInfo> {
      // requireBearerAuth only treats an OAuthError as an auth failure. Anything else —
      // UnauthorizedError included — answers a bare 500 instead of the 401 + WWW-Authenticate
      // challenge a client's discovery flow depends on.
      let userId: string;
      try {
        userId = await verifyAgentToken(token);
      } catch (err) {
        // The client only ever sees the generic 401 + WWW-Authenticate challenge below — this
        // is the one place the real reason (expired, malformed, wrong secret) is visible at all.
        logger.warn("mcp", "bearer token rejected", { reason: (err as Error)?.message });
        throw new OAuthError(OAuthErrorCode.InvalidToken, "Invalid or expired agent token");
      }

      return {
        token,
        clientId: userId,
        scopes: ["store:agent"],
        // hono/jwt's verify already rejected an expired token. Request-scoped bookkeeping only,
        // not a second expiry check.
        expiresAt: Math.floor(Date.now() / 1000) + 60,
        extra: { userId },
      };
    },
  },
  resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(resourceUrl),
});

const mcpHandler = createMcpHandler(
  (requestCtx: McpRequestContext) => {
    const userId = requestCtx.authInfo?.clientId;
    if (!userId) throw new Error("MCP request reached the factory with no resolved userId");
    return buildMcpServer({ actor: { type: "agent", id: userId }, userId });
  },
  { legacy: "stateless" }
);

export const mcpRoutes = new Hono();

mcpRoutes.all("/", async (c) => {
  const gated = await bearerGate(c.req.raw);
  if (gated instanceof Response) return gated;

  return mcpHandler.fetch(c.req.raw, { authInfo: gated });
});
