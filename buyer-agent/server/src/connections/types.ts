import type {
  OAuthDiscoveryState,
  StoredOAuthClientInformation,
  StoredOAuthTokens,
} from "@modelcontextprotocol/client";
import type { FormRequest, FormResponse, JsonSchema, UrlPrompt } from "../forms/types.ts";

export type ConnectionKind = "mcp" | "a2a";

/**
 * MCP tool annotations, passed through untouched.
 *
 * These are *hints from the server*, not guarantees — the MCP spec is explicit that a client must
 * not treat them as security boundaries. The policy engine uses them to pick a sensible default
 * and nothing more; the human confirmation is what actually holds.
 */
export type ToolAnnotationHints = {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
};

export type DiscoveredTool = {
  /** `${connectionId}__${name}` — namespaced so two connected merchants can both expose `search`. */
  qualifiedName: string;
  /** The name as the origin server knows it. This is what goes back over the wire. */
  name: string;
  connectionId: string;
  connectionLabel: string;
  kind: ConnectionKind;
  description: string;
  inputSchema: JsonSchema;
  annotations?: ToolAnnotationHints;
};

/**
 * What a tool call produced. Deliberately not `throw` — the agent loop turns this straight into a
 * `tool_result` block, and a model cannot catch an exception.
 */
export type ToolOutcome =
  | { ok: true; text: string; structured?: unknown }
  | { ok: false; text: string; retryable: boolean };

export type CallHooks = {
  /** Both protocols route their "I need input" states through here. */
  requestForm(req: Omit<FormRequest, "formId">): Promise<FormResponse>;
  /** MCP URL-mode elicitation. Resolves once the user says they are done. */
  requestUrlVisit(prompt: Omit<UrlPrompt, "promptId">): Promise<FormResponse>;
  /** Streamed to the transcript as a muted progress line. */
  onProgress(note: string): void;
};

export interface MerchantConnection {
  readonly id: string;
  readonly kind: ConnectionKind;
  /** Human label, taken from MCP serverInfo or the A2A Agent Card. */
  readonly label: string;
  connect(): Promise<void>;
  listTools(): Promise<DiscoveredTool[]>;
  callTool(name: string, args: unknown, hooks: CallHooks): Promise<ToolOutcome>;
  close(): Promise<void>;
}

/**
 * OAuth client state for an MCP connection, persisted alongside the record.
 *
 * This is what an `OAuthClientProvider` needs to survive a process restart: the
 * dynamic-client-registration result, the token pair, and the transient PKCE /
 * CSRF / discovery state that spans the authorize redirect. Tokens never leave
 * the server.
 */
export type McpOAuthState = {
  /** RFC 7591 registration result, keyed by authorization-server issuer (SEP-2352). */
  clients?: Record<string, StoredOAuthClientInformation>;
  /** Access + refresh token pair, from the most recent exchange or refresh. */
  tokens?: StoredOAuthTokens;
  /** PKCE verifier — transient, spans the authorize redirect and the callback. */
  codeVerifier?: string;
  /** OAuth2 `state` value, compared against the callback to defeat CSRF. */
  csrfState?: string;
  /** Cached RFC 9728 / 8414 discovery, so a reconnect skips the round trips. */
  discovery?: OAuthDiscoveryState;
};

/** What the registry persists. Tokens never leave the server. */
export type ConnectionRecord = {
  id: string;
  kind: ConnectionKind;
  label: string;
  /** For MCP stdio connections this is the command line instead of a URL. */
  url?: string;
  command?: string;
  args?: string[];
  /** Static bearer token. A2A uses this; an MCP url may use it as a fallback. */
  token?: string;
  /** OAuth client state for an MCP url connection that speaks OAuth. */
  auth?: McpOAuthState;
  addedAt: string;
};

export type ConnectionStatus = {
  id: string;
  kind: ConnectionKind;
  label: string;
  target: string;
  state: "connected" | "connecting" | "authorizing" | "error";
  error?: string;
  /** Set while `state === "authorizing"` — the merchant login/consent URL to open. */
  authorizationUrl?: string;
  toolCount: number;
};
