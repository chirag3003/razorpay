# Known gaps found while building the merchant's MCP OAuth server

> **Resolved.** `server/src/connections/oauthProvider.ts` (`McpOAuthProvider`) now implements
> `OAuthClientProvider`; `McpConnection.#buildTransport()` passes it as the transport's
> `authProvider` when no static token is set (a pasted bearer still works as a fallback).
> `ConnectionRecord.auth` (`McpOAuthState` in `connections/types.ts`) persists the
> `{ clients, tokens, codeVerifier, csrfState, discovery }` state via the existing
> `registry.#persist()`. The redirect lands on `GET /api/connections/:id/oauth/callback`
> (buyer-agent's own server); `ConnectionsPanel` opens the merchant consent URL in a new tab.
> Original notes kept below for context.

## Needed: OAuth client support in `connections/mcp.ts`

The Razorpay Store backend now runs a full MCP OAuth server (Authorization Server + Resource
Server in one process — see `backend/API.md`'s MCP OAuth section and `backend/CLAUDE.md`). It
replaces "paste a bearer token into a Connection" with the real flow: the human logs into the
store, approves once, and this agent gets a token without ever seeing it typed anywhere.

`connections/mcp.ts` (`McpConnection`) has zero OAuth code today — `#buildTransport()` just does:

```ts
const headers: Record<string, string> = {};
if (this.#record.token) headers.Authorization = `Bearer ${this.#record.token}`;
return new StreamableHTTPClientTransport(new URL(this.#record.url), {
  requestInit: { headers },
});
```

This still works against a server that only accepts a static bearer token, but the merchant
backend now expects the actual RFC 9728/8414/7591 discovery-and-PKCE dance, and it's the pattern
worth supporting generally — any other MCP server this agent connects to in the future is more
likely to speak OAuth than to accept a pasted token.

**The good news:** `@modelcontextprotocol/client` (already a dependency, same version this file
already imports from) has full OAuth client support built in — this is a moderate, well-scoped
change, not a from-scratch build.

### What to implement

An `OAuthClientProvider` (from `@modelcontextprotocol/client`) and pass it as
`StreamableHTTPClientTransport`'s `authProvider` option instead of the current `requestInit`
headers — transports accept `OAuthClientProvider` directly and drive the whole flow (metadata
discovery, dynamic client registration, PKCE, token exchange, refresh) internally. Concretely:

```ts
new StreamableHTTPClientTransport(new URL(this.#record.url), { authProvider });
```

The interface (all required unless marked optional):

- `get redirectUrl(): string | URL | undefined` — where the merchant's `/oauth/authorize` sends
  the browser back to after approval. For a headless/CLI agent like this one, this typically
  means either standing up a tiny local HTTP listener to catch the redirect, or using a
  registered `redirect_uri` this process can otherwise observe (e.g. a custom URI scheme, if the
  eventual host supports it).
- `get clientMetadata(): OAuthClientMetadata` — this agent's `client_name` / `redirect_uris`,
  used at registration time.
- `clientInformation(ctx?)` / `saveClientInformation?(info, ctx?)` — persist what
  `POST /oauth/register` returns (the merchant issues no client secret — public client, PKCE
  only) so registration happens once per merchant connection, not on every run.
- `tokens(ctx?)` / `saveTokens(tokens, ctx?)` — persist the access + refresh token pair. Called
  with no `ctx` for the transport's per-request read — return the most recently saved set then,
  not `undefined`.
- `redirectToAuthorization(url)` — what actually shows the human the merchant's login/consent
  page. For this agent that likely means opening a browser (`open`/`xdg-open`) or, in the `ui/`
  terminal-first flows, printing the URL and asking the human to open it.
- `saveCodeVerifier(verifier)` / `codeVerifier()` — persist the PKCE verifier between the
  `/authorize` redirect and the callback.

Once wired, connecting to this merchant becomes: register (once), redirect the human to approve
(once), and everything after that — including silent refresh — the SDK's `auth()` flow and the
transport handle without this file's help.

### `ConnectionRecord.token` needs to become real token state

`ConnectionRecord.token` (`connections/types.ts`) is a manually-typed static string today —
exactly what a human pastes into a Connections form. Once `mcp.ts` drives a real OAuth flow, this
needs to become persisted `{ clientInformation, tokens, codeVerifier }` state instead (whatever
shape the `OAuthClientProvider` implementation above chooses to persist it as), keyed by
connection id the same way `token` is now. Flag this as part of the same change, not a separate
one — the Connections UI's "paste a token" affordance for an MCP connection either needs to
become "click connect" (if this codebase is the one initiating `redirectToAuthorization`), or
needs to go away in favor of it happening automatically on first `connect()`.

Not addressing this now since the flow needs the client-side wiring above to exist first — a
storage shape decided before the code that fills it tends to be wrong.
