import { randomUUID } from "node:crypto";
import type {
  OAuthClientInformationContext,
  OAuthClientMetadata,
  OAuthClientProvider,
  OAuthDiscoveryState,
  StoredOAuthClientInformation,
  StoredOAuthTokens,
} from "@modelcontextprotocol/client";
import { env } from "../config/env.ts";
import type { McpOAuthState } from "./types.ts";

const AGENT_SCOPE = "store:agent";

type ProviderDeps = {
  connectionId: string;
  label: string;
  /** A reference into the live `ConnectionRecord.auth` — mutated in place. */
  state: McpOAuthState;
  /** Flush the owning record to disk. Called after every mutation. */
  persist: () => Promise<void>;
  /** Hand the merchant login/consent URL to whoever can show it to a human. */
  onAuthorizationUrl: (url: string) => void;
};

/**
 * An `OAuthClientProvider` for one MCP connection.
 *
 * It carries no logic of its own — the SDK's transport drives discovery, dynamic
 * client registration, PKCE, token exchange and refresh, and calls back here only
 * to read and persist state. Everything lands on the `McpOAuthState` object this
 * is constructed with (a slice of the persisted `ConnectionRecord`), so a process
 * restart mid-flow loses nothing but an in-flight authorize redirect.
 *
 * `redirectToAuthorization` does not open a browser: this server is headless. It
 * forwards the URL to `onAuthorizationUrl`; the UI opens the tab.
 */
export class McpOAuthProvider implements OAuthClientProvider {
  readonly #connectionId: string;
  readonly #label: string;
  readonly #state: McpOAuthState;
  readonly #persist: () => Promise<void>;
  readonly #onAuthorizationUrl: (url: string) => void;

  constructor(deps: ProviderDeps) {
    this.#connectionId = deps.connectionId;
    this.#label = deps.label;
    this.#state = deps.state;
    this.#persist = deps.persist;
    this.#onAuthorizationUrl = deps.onAuthorizationUrl;
  }

  get redirectUrl(): string {
    return new URL(
      `/api/connections/${this.#connectionId}/oauth/callback`,
      env.PUBLIC_URL,
    ).toString();
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: `buyer-agent — ${this.#label}`,
      redirect_uris: [this.redirectUrl],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      scope: AGENT_SCOPE,
      // Loopback redirect — the SDK would infer this anyway; merchant ignores it.
      application_type: "native",
    };
  }

  state(): string {
    const value = randomUUID();
    this.#state.csrfState = value;
    void this.#persist();
    return value;
  }

  /** The `state` value last handed to the authorization server, for the callback to check. */
  get expectedState(): string | undefined {
    return this.#state.csrfState;
  }

  clientInformation(
    ctx?: OAuthClientInformationContext,
  ): StoredOAuthClientInformation | undefined {
    const clients = this.#state.clients;
    if (!clients) return undefined;
    if (ctx) return clients[ctx.issuer];
    // Per-request read with no ctx — return the most recently saved set.
    const values = Object.values(clients);
    return values[values.length - 1];
  }

  async saveClientInformation(
    info: StoredOAuthClientInformation,
    ctx?: OAuthClientInformationContext,
  ): Promise<void> {
    const key = ctx?.issuer ?? info.issuer ?? "default";
    this.#state.clients = { ...this.#state.clients, [key]: info };
    await this.#persist();
  }

  tokens(): StoredOAuthTokens | undefined {
    // Called with no ctx for the transport's per-request bearer read — always
    // return the most recently saved pair, never undefined once one exists.
    return this.#state.tokens;
  }

  async saveTokens(tokens: StoredOAuthTokens): Promise<void> {
    this.#state.tokens = tokens;
    await this.#persist();
  }

  redirectToAuthorization(authorizationUrl: URL): void {
    this.#onAuthorizationUrl(authorizationUrl.toString());
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    this.#state.codeVerifier = codeVerifier;
    await this.#persist();
  }

  codeVerifier(): string {
    const verifier = this.#state.codeVerifier;
    if (!verifier) {
      throw new Error("No PKCE code verifier saved for this connection.");
    }
    return verifier;
  }

  async saveDiscoveryState(state: OAuthDiscoveryState): Promise<void> {
    this.#state.discovery = state;
    await this.#persist();
  }

  discoveryState(): OAuthDiscoveryState | undefined {
    return this.#state.discovery;
  }
}
