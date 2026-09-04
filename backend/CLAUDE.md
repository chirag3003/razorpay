# /backend — Claude Code Context

This file scopes to work happening inside `/backend`. It loads alongside the root `CLAUDE.md`
(which has the full project narrative, track framing, and cross-project hard rules) — this file
only adds backend-specific detail. If something here seems to conflict with the root file, the
root file's Hard Rules win; ask before proceeding.

**If you're building the frontend (or anything else) that calls this API, read `backend/API.md`
instead of this file** — it's the full request/response contract (every route, entity shape,
error format, and the Razorpay checkout sequence) written so you don't need to read backend source
to integrate against it. This file (`CLAUDE.md`) is for people/agents changing backend code.

Two more files worth knowing before you start:

- **`backend/issues.md`** is the single work queue — open bugs, the abuse surface, performance
  work, and the standing Reserve Pay constraint. It absorbed the old `proposal.md` review, whose
  `S#`/`L#`/`A#` ids it keeps.
- **`handled.md`** (repo root) is the inventory of what already fails *gracefully* — the error
  hierarchy, the idempotency guarantees, the deliberate swallows. Read it before adding a new
  error path, and add to it when you add one.

---

## Layout

```
/backend/src
  /db                 Drizzle schema, client, migrations
  /schemas            Zod schemas — single source for validation AND for the MCP tool parameter
                       schemas (via zod-4's z.toJSONSchema).
                       Zero dependencies on anything else in the tree.
  /errors             Typed domain error hierarchy (DomainError base + specific subclasses).
                       Zero dependencies on anything else in the tree.
  logger.ts           The only logging module — one line per event (HTTP request, tool call,
                       LLM round, everything else), gated by DEBUG_LOGS (default on; WARN/ERROR
                       always print). Zero dependencies beyond /config, so it is import-safe from
                       anywhere, same leaf-module status as /schemas and /errors above. Every
                       AI-callable action logs from exactly one place — runTool in
                       /agent-interfaces/tools/registry.ts — which is what makes chat and MCP
                       show up identically without instrumenting either caller separately.
  /clients            External SDK instances (razorpay.ts, openrouter.ts), created once
  /config             Parses + validates process.env via /schemas/env.schema.ts at boot —
                       fail fast on bad config, don't let a missing key surface mid-request
  /services           All business logic. See "Service Layer Rules" below.
  /routes             REST API for the Next.js storefront + dashboard. Thin — validate via
                       /schemas, call one or more /services functions, return.
    /admin            Store-operator endpoints (/api/admin/*): products, categories, orders,
                       dashboard summary, read-only user list. index.ts mounts the sub-routers;
                       every one except auth.ts applies requireAdmin.
  /agent-interfaces
    /tools             The registry every AI-callable action goes through (runTool, ALL_TOOLS).
                       Both the first-party chat agent and /agent-interfaces/mcp wrap this same
                       map without adding a tool of their own — root Hard Rule #2 applied one
                       level up.
    /mcp               buildMcpServer(ctx) — registers every ALL_TOOLS entry as an MCP tool via
                       @modelcontextprotocol/server, translating runTool's {ok, data|error} into
                       MCP's {content, structuredContent} / {isError, content}. No logic of its
                       own. Mounted at POST /api/mcp (routes/mcp.ts).
    /a2a               Not planned. MCP is the agent interface. A2A sends one free-text
                       instruction per skill with no structured-args call in its wire protocol,
                       so every A2A call would need this backend's LLM just to parse intent.
                       Reasoning in full: API.md's MCP section.
  /webhooks           Razorpay webhook receiver — validates the payload and the signature, then
                       routes each event to reservePayService or orderService. Always answers 200
                       (Razorpay retries any non-2xx); see handled.md section 4.
  /middleware         auth.ts (normal human session auth for REST routes, userService.verifyToken),
                      adminAuth.ts (requireAdmin — the /api/admin token, see Conventions).
                      MCP's bearer-token check is inline in routes/mcp.ts instead of a third
                      middleware file — it's a single call to @modelcontextprotocol/server's
                      requireBearerAuth wrapping userService.verifyAgentToken, not a chain worth
                      its own file. There is no scope/spend-cap middleware and none is planned —
                      see "Where the human is in the loop" below.
  /utils              Small pure helpers with no app deps. slug.ts (slugify) — shared by the
                      seed script and the admin product/category create endpoints.
  /chat               The storefront chat wire format and its projections. protocol.ts
                      mirrors web/lib/chat/protocol.ts (server->client half only); partMapper.ts
                      turns a tool result into a rendered widget; turnInput.ts turns a widget tap
                      into text the model reads. No LLM calls — this layer is deterministic.
  /llm                Every LLM API call in the backend lives here, nowhere else. See
                      "LLM Isolation" below. Provider is OpenRouter (clients/openrouter.ts);
                      OPENROUTER_MODEL is the whole provider swap.
  /routes/oauth.ts    MCP OAuth (RFC 9728/8414/7591 + PKCE). This backend is both the
                      Authorization Server and the Resource Server — see "MCP OAuth" below.
  constants.ts        Regulatory/config numbers centralized — RESERVE_PAY_MAX_AMOUNT (₹10,000),
                      RESERVE_PAY_MAX_EXPIRY_DAYS (90), MAX_CART_ITEM_QTY, DELIVERY_SLOTS, etc.
                      Never hardcode these inline in a service or schema.
  server.ts           Entrypoint
```

**There is no test suite, and one is out of scope.** Verification is `bun x tsc --noEmit` plus
the manual money-path walkthrough in `issues.md`.

---

## Service Layer Rules (this is the load-bearing convention for the whole backend)

- **All order/cart/payment/mandate logic lives in `/services`.** `/routes` and
  `/agent-interfaces` must call into the same service functions — never duplicate business logic
  in a route handler or a tool handler, and never reach into the database from either.
- **Dependency direction is one-way:** `/services` must never import from `/routes` or
  `/agent-interfaces`. Only the reverse is allowed. If a service seems to need something from a
  route, that's a sign the logic belongs in the service and the route is just misplaced.
- **`/schemas` and `/errors` are leaf-level, zero-dependency modules** — safely importable from
  anywhere (routes, agent-interfaces, services) with no circular-import risk.
- **Every service function that moves money or checks a mandate must call `auditService`** to
  write a row — actor (token/agent), mandate/scope checked, decision, outcome. An endpoint that
  moves money without an audit write is incomplete, not just under-logged.
- **Domain errors, not generic throws.** Use the `/errors` hierarchy (`MandateExpiredError`,
  `InsufficientBalanceError`, `MandateAmountExceededError`, etc. — `handled.md` section 1 has the
  full table with each one's status and code) so
  `auditService` and both calling layers (routes, agent-interfaces) have one consistent shape to
  catch, log, and translate into a response. The "one graceful failure" demo case should throw
  one of these, not an unhandled exception.

---

## Cart Handling

Cart is **server-side, referenced by ID** — not built client/agent-side and submitted whole at
checkout. Decided because: it's the only way both callers (routes, agent-interfaces) can share
`cartService`'s state; it matches the ACP session model (create→update→complete) already used as
the checkout semantics reference; it produces a real per-item audit sequence instead of one
opaque "checkout happened" entry; it lets per-item validation fail fast on the item that breaks a
rule rather than only at final checkout; and it survives an agent-side crash/restart.

The tools, as they actually exist (`agent-interfaces/tools/`):

```
get_cart()                            → the caller's one active cart, resolved from userId
add_to_cart(productId, qty)           → validates stock and the per-line cap; quantity is ADDITIVE
update_cart_item(itemId, qty)         → absolute quantity
remove_from_cart(itemId) / clear_cart()
prepare_order(addressId, slotId)      → re-validates, writes the signed Cart Mandate, takes no money
place_order(quoteId)                  → runs the Reserve Pay debit, writes audit rows. Idempotent.
```

There is no `create_cart`: `cartService.getOrCreateActiveCartId(userId)` is the only place the
one-cart-per-user assumption lives, and every tool goes through it.

A one-shot "reorder exactly this" convenience is fine to support later, but it must resolve into
the same server-side cart internally (a helper that front-loads several `add_item` calls) — never
a separate checkout path that skips incremental validation.

---

## LLM Isolation

Every LLM API call in the backend lives in `/llm`, and nowhere else. This makes "no LLM in the
merchant transaction core" (root CLAUDE.md Hard Rule #1) structurally checkable rather than just
a written rule.
- **Never allowed to import `/llm`:** `mandateService.ts`, `reservePayService.ts`,
  `paymentService.ts`, `orderService.ts`, `cartService.ts`, or anything in `/agent-interfaces`
  that touches cart/checkout/payment.
- **Allowed to import `/llm`:** exactly two files, and `grep -rn "\.\./llm" src/services
  src/agent-interfaces` should return exactly these two — that grep is the enforcement.
  `chatService.ts` (the storefront chat agent's conversation loop) and `searchAssistService.ts`
  (turns a free-text `search_products_nl` query into `search_products`'s structured filters —
  advisory, never mutates state; the tool handler in `agent-interfaces/tools/catalog.ts` calls
  this service, it does not import `/llm` itself).
- **No LLM framework.** No LangChain, no LangGraph, no agent SDK. The loop is ~180 lines in
  `llm/agentLoop.ts` and it stays that way deliberately: a framework that owns the loop, the
  tools and the state turns "where does the model touch money" from an import-graph question
  into an inspection question, and it fights the per-turn tool filtering that implements the
  `place_order` gate. OpenRouter already provides the only abstraction we wanted — many models
  behind one endpoint, swapped with `OPENROUTER_MODEL`.
- **The chat agent's safety property is structural, not prompted.** `chatService` never puts
  `place_order` in the tool list at all — not conditionally, never. On a `review.confirm` widget
  action it resolves the customer's one open quote and calls the tool directly
  (`chatService.handlePlaceOrderConfirm`), with no model round trip deciding whether or how to
  call it. A confused model or a prompt injection hiding in a product name cannot place an order
  because the function is never in its hands to begin with — there's no "unless" for it to defeat.
- **The MCP surface deliberately does not have that property**, and the two must never be
  conflated. `buildMcpServer` registers every entry of `ALL_TOOLS`, `place_order` and
  `start_reserve_pay_setup` included. See "Where the human is in the loop" below for the accepted
  risk in full. If you add another money-moving tool, decide explicitly which of these two models
  it follows and write it down — do not add a sentence to a system prompt and call it gated.
- If you're adding an ESLint import-boundary rule to enforce this at build time, it belongs here.

---

## Payment / Mandate Specifics (backend implementation detail — see root CLAUDE.md for the "why")

- **Reserve Pay (SBMD) flow lives in `reservePayService.ts`:** Create Customer → Create Order
  (`token.type: single_block_multiple_debit`, `max_amount ≤ RESERVE_PAY_MAX_AMOUNT`,
  `expire_at ≤ RESERVE_PAY_MAX_EXPIRY_DAYS`) → Create Authorisation Payment (`upi.flow: intent`)
  → Fetch Token → subsequent debits are new Orders **without** the `notification` object +
  Initiate Payment referencing the stored token.
- **The gateway behind that flow is swappable.** `reservePayService` calls
  `services/reservePayGateway.ts`, not `paymentService` directly, for the eight Reserve Pay
  gateway calls. The gateway picks `paymentService` (real) or `reservePaySimService` (a local
  simulator) from `RESERVE_PAY_SIM`, because Razorpay has not provisioned
  `/payments/create/json` on this account — see `issues.md`. Everything that makes the rail
  *bounded* — guard chain, the conditional-UPDATE reservation, audit writes, status mapping —
  lives in `reservePayService` and runs identically either way. **Add a new gateway call to the
  `ReservePayGateway` type, not to `reservePayService` as a direct paymentService import.**
- **One Reserve Pay block per (customer, simulated-merchant) pair** — simulate multiple
  merchants as multiple tokens for the same customer within the one Razorpay test account.
- **Verification chain, in this order:** token valid/unexpired (`middleware/auth.ts` for humans,
  the inline `requireBearerAuth` in `routes/mcp.ts` for agents) → mandate active, unexpired and
  within its per-transaction cap → sufficient blocked balance. The last two run in
  `reservePayService.assertDebitable`, and `prepareDebit`'s conditional `UPDATE` re-checks the
  balance atomically in the database — that UPDATE, not the guard chain, is the actual correctness
  guarantee. Don't reorder or short-circuit this. There is no scope/cap step: see
  "Where the human is in the loop".
- **Cart Mandate** is a signed `{cart_contents, total_amount, timestamp}` record, generated in
  `mandateService.ts` at checkout time, before the Reserve Pay debit call — separate from the
  token's general authority, and what makes `place_order` idempotent.

---

## MCP OAuth

`routes/oauth.ts` + `services/oauthService.ts`. This backend is both the Authorization Server
and the Resource Server for `/api/mcp` — the simplest valid MCP OAuth topology, and correct here
since there's no separate identity provider to delegate to: `userService` already is the
identity source.

- **Two mutually-exclusive JWT kinds, one secret.** `userService.issueToken`/`verifyToken`
  (human session, `{sub, exp}`) and `userService.issueAgentToken`/`verifyAgentToken` (agent
  access token, `{sub, actorType: "agent", exp}`, 24h TTL vs the human token's 7 days) sign with
  the same `JWT_SECRET` but reject each other's shape — `verifyToken` rejects any payload
  carrying `actorType`, `verifyAgentToken` requires it. A leaked agent token cannot be replayed
  against `/api/auth/me` or any other human route, and vice versa. One secret, not two, because
  this is one trust boundary (the same account) tagged two ways, unlike the fully separate
  admin auth below.
- **An agent token is only ever minted by `oauthService.exchangeAuthorizationCode` /
  `refreshAccessToken`**, never handed out for a human to copy-paste. There is deliberately no
  `POST /api/auth/agent-login` — that would be the exact copy-paste flow OAuth exists to replace.
- **PKCE is mandatory, not optional.** `createAuthorizationRequest` rejects anything but
  `code_challenge_method: "S256"`. Agents are public clients (headless, can't keep a secret) —
  PKCE is the actual protection, not a `client_secret`; `oauth_clients` has no secret column.
- **The human decision step reuses the existing human session JWT**
  (`POST /api/oauth/authorize/decision` sits behind `requireAuth`, same as every other authed
  route) — approving a connection is "prove you're logged in, then say yes," not a new
  credential. `GET /oauth/authorize` itself redirects to `web/`'s `/agent-connect` page (see
  `web/issues.md`) since this backend never renders HTML.
- **Refresh tokens are hashed at rest and rotated on every use** (`oauth_refresh_tokens.tokenHash`,
  sha256) — a stolen refresh token is replayable exactly once before the legitimate holder's next
  refresh finds it already revoked.
- **No scope or spend-cap enforcement — by design, not planned.**
  `oauthMetadata.scopes_supported` is one blanket `"store:agent"` scope, so every tool is
  available to any connected agent. Root `claude.md`'s fuller "Intent Mandate" design (`scope`,
  `spend_cap`, an "Agent Access" settings page) was designed and deliberately not built. See
  "Where the human is in the loop" below for what that means in practice.

### Where the human is in the loop

> An OAuth-connected MCP agent can call `prepare_order` → `place_order` in one turn, and can call
> `start_reserve_pay_setup` to create a **new** block up to ₹10,000. The human's consent is the
> one-time OAuth approval plus the UPI PIN on the block — not a per-order confirmation. There is
> no scope, no spend cap, and no per-agent limit; the ₹10,000 regulatory ceiling and the block's
> remaining balance are the only bounds. This is deliberate, and it is the opposite of the
> first-party chat agent, where `place_order` is never in the model's tool list at all
> (`chatService.ts:261`). Accepted knowingly: agentic checkout is the product.

What still holds on both surfaces: every action is scoped to one user's data, every money-moving
call writes an audit row naming the actor, and the cart mandate records exactly what was agreed.
Two consequences of this decision are tracked in `issues.md` rather than dropped — an MCP client
needs the structured tool error (`S16`) and honest tool annotations (`A8`) to decide whether a
retry is safe, and both matter more now than when `place_order` was chat-only.

### Connecting to Claude Desktop (or any remote MCP client)

Remote clients require https, so the backend needs a tunnel. Order matters:

1. Start the backend and `ngrok http 4000`.
2. Set **`OAUTH_ISSUER_URL`** to the https URL ngrok prints.
3. **Restart the backend.** `dotenv/config` reads `.env` once at boot and `bun --watch` does not
   watch `.env`, so editing it alone changes nothing.
4. Add the connector in Claude Desktop pointing at `https://<host>/api/mcp`.

**`OAUTH_ISSUER_URL` is the whole game.** Every URL in both discovery documents is built from it
(`routes/oauth.ts`), and nothing derives them from the incoming request. Left on localhost, the
client is told to register at `http://localhost:4000/oauth/register`, cannot reach it, and reports
a sign-in failure — while the backend log shows discovery succeeding and then simply no
`POST /oauth/register`. **That missing line is the signature of this bug.** The `/.well-known/*`
handler now warns when the request host and `OAUTH_ISSUER_URL` disagree, so it says so locally.

Other things worth knowing before you debug the wrong thing:

- **Leave `PUBLIC_APP_URL` on localhost.** `/oauth/authorize` redirects to `web/`'s
  `/agent-connect` consent page in *your own browser* on this machine, so it must stay local — and
  `web/` has to be running on `:3000` for the approval step to render at all.
- **A free ngrok URL changes on every restart.** Each new URL means a new `OAUTH_ISSUER_URL`, a
  backend restart, and re-adding the connector, since the client caches what it discovered. A
  reserved ngrok domain removes the loop.
- **ngrok's free interstitial** appears on the first browser navigation, and `/oauth/authorize` is
  one. Click through; a request header cannot suppress it for a top-level navigation.
- **`GET /.well-known/oauth-protected-resource` returning 404 is correct.** RFC 9728 puts a
  resource's metadata at the path-suffixed location — `/.well-known/oauth-protected-resource/api/mcp`
  — which is what the SDK serves. Clients probe the bare path as a fallback; ignore it.
- **`CORS_ORIGIN` does not affect discovery.** The SDK sets `Access-Control-Allow-Origin: *` on
  both metadata documents itself. It would only matter for a browser-side client.
- Connecting a real agent makes the accepted risk above concrete rather than theoretical: MCP
  exposes every tool, `place_order` and `start_reserve_pay_setup` included, with no scope or
  spend cap. That is intended — just know it before you point a live agent at it.

---

## Conventions

- **Hono** is the API framework, served directly on the Bun runtime — no `@hono/node-server`
  adapter needed. `src/server.ts` builds and exports the app as Bun's own server-config default
  export (`export default { port, fetch: app.fetch }`); running the file (`bun src/server.ts`,
  including under `bun --watch`) starts the server without an explicit `Bun.serve()` call. Route
  validation uses `@hono/zod-validator` against the schemas in `/schemas`, keeping `/routes`
  handlers thin per the Service Layer Rules above.
- **Drizzle**, not Prisma/TypeORM — schema stays plain TypeScript, no generate-step lag, easy
  raw-SQL escape hatch for complex balance queries.
- **Never read a Postgres error code off `err.code`** — use `pgErrorCode(err)` from
  `/utils/db-error.ts` (with the `PG_UNIQUE_VIOLATION` / `PG_FOREIGN_KEY_VIOLATION` constants).
  drizzle-orm v1 wraps driver errors in a `DrizzleQueryError` and hangs pg's `DatabaseError`
  (the object carrying `code`) off `.cause`, so `err.code` is always `undefined`. This fails
  silently: the `catch` branch simply never matches and a handled constraint violation escapes
  as a 500. It had already broken the archive-instead-of-delete fallback, the "category still
  has products" 409, and the webhook/verify checkout idempotency guard.
- **Zod schemas are the single source of truth** for both runtime validation and (via zod-4's
  `z.toJSONSchema`) the parameter schemas exposed to agents through the MCP tool definitions.
  Don't hand-write a separate JSON schema for a tool that already has a Zod schema.
- **`/config` validates env at boot**, not lazily inside whatever service first needs a given
  key — a missing `RAZORPAY_KEY_SECRET` should crash startup, not surface as a mysterious 500
  three requests in.
- **Auth is a stateless JWT bearer token** (`hono/jwt`, signed in `userService.issueToken`),
  deliberately the same "bearer token in `Authorization` header" shape agent auth uses too — see
  "MCP OAuth" above for the second verification path this predicted (`userService.verifyAgentToken`,
  checked inline in `routes/mcp.ts`, not a third `middleware/*.ts` file).
- **Admin auth is a third, fully separate verification path.** `middleware/adminAuth.ts` +
  `services/adminAuthService.ts`: `POST /api/admin/login` exchanges the shared `ADMIN_PASSWORD`
  for a JWT signed with a *separate* secret (`ADMIN_JWT_SECRET`), payload `{ role: "admin" }`,
  no `sub`, 12h TTL. `requireAdmin` verifies that secret and asserts `role === "admin"`; it
  never sets `userId` and admin routes use `AdminEnv` (types.ts), not `AppEnv`. The two token
  types can't be swapped: `userService.verifyToken` rejects a missing string `sub`,
  `verifyAdminToken` rejects a missing `role`. Admin mutations still go route → service and
  still write `auditService` rows (`actorType: "admin"`).

---

## Scripts (`backend/package.json`)

```
bun run dev          Start the API with hot reload (bun --watch src/server.ts)
bun run build        Bundle to ./dist (bun build)
bun run start        Run the built bundle (./dist/server.js) — use after `build`, e.g. in prod
bun run db:generate  Generate a SQL migration from src/db/schema.ts into ./drizzle
bun run db:migrate   Apply pending migrations to DATABASE_URL
bun run db:push      Push schema directly to the DB without a migration file (fast local iteration)
bun run db:studio    Open Drizzle Studio against DATABASE_URL
bun run db:seed      Seed categories/products (ported from web/data/*.ts) — safe to re-run,
                      uses onConflictDoNothing on slug so it never duplicates rows
```

**First-time setup:** fill in `.env` (copy `.env.example`, add real `RAZORPAY_KEY_ID` /
`RAZORPAY_KEY_SECRET` / `RAZORPAY_WEBHOOK_SECRET` from the Razorpay dashboard, plus
`ADMIN_PASSWORD` and `ADMIN_JWT_SECRET` for the admin surface — the server won't boot without
them), then `bun run db:generate && bun run db:migrate && bun run db:seed`, then `bun run dev`. Day-to-day schema changes: edit `src/db/schema.ts`, then either `db:generate` +
`db:migrate` (keeps a migration history) or `db:push` (quicker, no history — fine for local
iteration, not for anything already deployed).

`src/server.ts` is the real entrypoint (there is no `src/index.ts` — it was a broken bootstrap
stub and has been removed; `package.json`'s `"module"` field points at `src/server.ts`).
