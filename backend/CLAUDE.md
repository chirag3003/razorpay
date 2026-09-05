# /backend — conventions

Loads alongside root `claude.md` (project rules, the two agent surfaces, out-of-scope list). Root
Hard Rules win on any conflict.

**Calling this API rather than changing it? Read `API.md` instead** — full request/response
contract, written so you never touch backend source. Setup/run: root `README.md`.

## Layout

```
src/
  db/               Drizzle schema, client, migrations
  schemas/          Zod — validation AND MCP tool param schemas (z.toJSONSchema). Zero deps.
  errors/           DomainError hierarchy. Zero deps.
  logger.ts         Only logging module, one line per event. DEBUG_LOGS gates INFO; WARN/ERROR
                    always print. Zero deps beyond /config, safe to import anywhere.
  clients/          External SDK instances (razorpay, openrouter), created once
  config/           Parses + validates process.env at boot via schemas/env.schema.ts
  services/         All business logic. See rules below.
  routes/           REST for storefront + dashboard. Thin: validate, call service, return.
    admin/          /api/admin/* — every router but auth.ts applies requireAdmin
  agent-interfaces/
    tools/          The registry every AI-callable action goes through (runTool, ALL_TOOLS).
                    Chat and MCP both wrap this same map, neither adds a tool of its own.
    mcp/            buildMcpServer(ctx) — registers ALL_TOOLS as MCP tools. No logic of its own.
  webhooks/         Razorpay receiver. Validates signature, routes to a service. Always 200.
  middleware/       auth.ts (human session), adminAuth.ts. MCP's bearer check is inline in
                    routes/mcp.ts — one call, not worth a file. No scope/spend-cap middleware.
  chat/             Storefront chat wire format. protocol.ts mirrors web/lib/chat/protocol.ts;
                    partMapper.ts turns a tool result into a widget. Deterministic, no LLM.
  llm/              Every LLM call in the backend. Nowhere else. See below.
  utils/            Pure helpers, no app deps
  constants.ts      Regulatory/config numbers — RESERVE_PAY_MAX_AMOUNT, MAX_CART_ITEM_QTY,
                    DELIVERY_SLOTS. Never hardcode these inline.
  server.ts         Entrypoint (there is no index.ts)
```

**No test suite, and one is out of scope.** Verification is `bun x tsc --noEmit` plus a manual
money-path walkthrough.

## Service layer rules

Load-bearing convention for the whole backend.

- All order/cart/payment/mandate logic in `/services`. `/routes` and `/agent-interfaces` call into
  it — never duplicate logic, never touch `db` directly.
  `grep -rn 'from "../../db"' src/agent-interfaces` should stay empty.
- **One-way dependency:** `/services` never imports from `/routes` or `/agent-interfaces`. If a
  service seems to need something from a route, the logic belongs in the service.
- `/schemas` and `/errors` are leaf modules, zero deps, importable anywhere.
- **Every money/mandate function calls `auditService`.**
- **Domain errors, never generic throws.** Use `/errors` — `server.ts`'s `app.onError` is the one
  mapping site, turning any `DomainError` into `{error, code}` at its status and everything else
  into a generic 500. No stack trace, no raw Postgres or Razorpay error reaches a client. Table of
  every error class and its code: `API.md` §3.

## LLM isolation

- **Only two files may import `/llm`:** `chatService.ts` and `searchAssistService.ts`. That grep
  *is* the enforcement:
  `grep -rn "\.\./llm" src/services src/agent-interfaces` returns exactly those two.
- Never: `mandateService`, `reservePayService`, `paymentService`, `orderService`, `cartService`,
  or anything in `/agent-interfaces` touching cart/checkout/payment.
- **No LLM framework.** The loop is ~180 lines in `llm/agentLoop.ts` and stays that way. A
  framework owning the loop turns "where does the model touch money" from an import-graph question
  into an inspection question, and fights the per-turn tool filtering that implements the
  `place_order` gate.
- **The chat gate is structural, not prompted** — `place_order` is never in the tool list at all.
  MCP deliberately does not have that property. Root `claude.md` has both in full; don't restate
  them, and don't conflate them.

## Cart

Server-side, referenced by id — not built client-side and submitted whole. Only way both callers
share `cartService` state, and it gives a real per-item audit sequence.

```
get_cart()                        the caller's one active cart, resolved from userId
add_to_cart(productId, qty)       validates stock + per-line cap. qty is ADDITIVE
update_cart_item(itemId, qty)     absolute
remove_from_cart(itemId) / clear_cart()
prepare_order(addressId, slotId)  re-validates, writes the signed cart mandate, takes no money
place_order(quoteId)              runs the debit, writes audit rows. Idempotent by quoteId.
```

No `create_cart` — `cartService.getOrCreateActiveCartId(userId)` is the only place the
one-cart-per-user assumption lives.

## Reserve Pay

- Flow lives in `reservePayService.ts`: Create Customer → Create Order
  (`token.type: single_block_multiple_debit`) → Create Auth Payment (`upi.flow: intent`) → Fetch
  Token → later debits are new Orders **without** `notification` + Initiate Payment against the
  stored token.
- **Gateway is swappable.** `reservePayService` calls `services/reservePayGateway.ts`, never
  `paymentService` directly. `RESERVE_PAY_SIM` picks real or simulator — see root `README.md`.
  **Add a new gateway call to the `ReservePayGateway` type, not as a direct paymentService
  import.**
- `prepareDebit`'s conditional `UPDATE` re-checks balance atomically in the database. That UPDATE,
  not the guard chain, is the actual correctness guarantee.
- Cart mandate is signed in `mandateService.ts` before the debit call.

## MCP OAuth

`routes/oauth.ts` + `services/oauthService.ts`. This backend is both Authorization Server and
Resource Server — correct here, `userService` already is the identity source. Tunnel setup and the
`OAUTH_ISSUER_URL` failure mode: root `README.md`.

- **Two mutually-exclusive JWT kinds, one secret.** `verifyToken` rejects any payload carrying
  `actorType`; `verifyAgentToken` requires it. A leaked agent token can't be replayed against
  `/api/auth/me`, or vice versa.
- Agent tokens only ever minted by `exchangeAuthorizationCode` / `refreshAccessToken`. There is
  deliberately no `POST /api/auth/agent-login` — that's the copy-paste flow OAuth replaces.
- **PKCE mandatory**, S256 only. Agents are public clients; `oauth_clients` has no secret column.
- Refresh tokens hashed at rest, rotated every use — a stolen one is replayable exactly once.
- `GET /.well-known/oauth-protected-resource` returning 404 is **correct**. RFC 9728 puts it at
  the path-suffixed location (`/api/mcp` appended). Clients probe the bare path as a fallback.

## Conventions

- **Hono on Bun**, no `@hono/node-server`. `server.ts` exports Bun's server-config default
  (`{port, fetch}`) — running the file starts the server, no explicit `Bun.serve()`. Route
  validation via `@hono/zod-validator` against `/schemas`.
- **Never read `err.code` for a Postgres error** — use `pgErrorCode(err)` from `utils/db-error.ts`
  with `PG_UNIQUE_VIOLATION` / `PG_FOREIGN_KEY_VIOLATION`. drizzle-orm v1 wraps driver errors in
  `DrizzleQueryError` and hangs pg's `DatabaseError` off `.cause`, so `err.code` is always
  `undefined`. **This fails silently** — the catch branch never matches and a handled constraint
  violation escapes as a 500. It has already broken three call sites.
- **Zod schemas are the single source of truth** for validation and, via `z.toJSONSchema`, the MCP
  tool parameter schemas. Don't hand-write a JSON schema for a tool that has a Zod one.
- **`/config` validates env at boot**, not lazily. A missing key should crash startup, not surface
  as a mysterious 500 three requests in.
- **Three separate auth paths.** Human session JWT (`JWT_SECRET`, 7d) → `middleware/auth.ts`.
  Agent token (same secret, `actorType`, 24h) → inline in `routes/mcp.ts`. Admin
  (`ADMIN_JWT_SECRET`, `{role: "admin"}`, no `sub`, 12h) → `middleware/adminAuth.ts`, uses
  `AdminEnv` not `AppEnv`. The token types can't be swapped: `verifyToken` rejects a missing
  string `sub`, `verifyAdminToken` rejects a missing `role`. Admin mutations still go route →
  service and still write audit rows.

## Scripts

```
bun run dev          hot reload (bun --watch src/server.ts)
bun run build        bundle to ./dist
bun run start        run the built bundle
bun run db:generate  generate a migration from the schema into ./drizzle
bun run db:migrate   apply pending migrations
bun run db:push      push schema without a migration file (local iteration only)
bun run db:studio    Drizzle Studio
bun run db:seed      seed categories/products, safe to re-run
```

Schema change: edit `src/db/schema/`, then `db:generate` + `db:migrate` (keeps history) or
`db:push` (quicker, no history — not for anything deployed).
