import { pgTable, uuid, text, jsonb, timestamp, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./users";

// MCP OAuth (RFC 9728 / 8414 / 7591). This backend is both Authorization Server and Resource
// Server, since userService is already the identity source.
//
// Agents are public clients — headless, so they cannot keep a secret. PKCE is the protection, and
// none of these tables store a client_secret.

// One row per agent install that has ever called POST /oauth/register.
export const oauthClients = pgTable("oauth_clients", {
  id: text("id").primaryKey(), // the client_id
  clientName: text("client_name").notNull(),
  redirectUris: jsonb("redirect_uris").$type<string[]>().notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Pending state between GET /oauth/authorize and the human's decision on web/'s consent page.
// userId is null until the human is identified by their own session JWT.
export const oauthAuthorizationRequests = pgTable(
  "oauth_authorization_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(), // the request_id in the /agent-connect URL
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClients.id, { onDelete: "cascade" }),
    redirectUri: text("redirect_uri").notNull(),
    codeChallenge: text("code_challenge").notNull(),
    scope: text("scope").notNull(),
    state: text("state"),
    status: text("status").notNull().default("pending"),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    check(
      "oauth_authorization_requests_status_check",
      sql`${t.status} in ('pending', 'approved', 'denied')`
    ),
  ]
);

// Single-use authorization codes, minted on approval, consumed by POST /oauth/token.
export const oauthCodes = pgTable("oauth_codes", {
  code: text("code").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  clientId: text("client_id")
    .notNull()
    .references(() => oauthClients.id, { onDelete: "cascade" }),
  redirectUri: text("redirect_uri").notNull(),
  codeChallenge: text("code_challenge").notNull(),
  scope: text("scope").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  consumedAt: timestamp("consumed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Long-lived bearer secrets, hashed at rest. Rotated on every use — refreshAccessToken issues a
// new row and revokes this one, so a stolen refresh token is replayable exactly once.
export const oauthRefreshTokens = pgTable("oauth_refresh_tokens", {
  tokenHash: text("token_hash").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  clientId: text("client_id")
    .notNull()
    .references(() => oauthClients.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at").notNull(),
  revokedAt: timestamp("revoked_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
