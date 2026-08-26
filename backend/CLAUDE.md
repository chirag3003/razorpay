# /backend — Claude Code Context

This file scopes to work happening inside `/backend`. It loads alongside the root `CLAUDE.md`
(which has the full project narrative, track framing, and cross-project hard rules) — this file
only adds backend-specific detail. If something here seems to conflict with the root file, the
root file's Hard Rules win; ask before proceeding.

**If you're building the frontend (or anything else) that calls this API, read `backend/API.md`
instead of this file** — it's the full request/response contract (every route, entity shape,
error format, and the Razorpay checkout sequence) written so you don't need to read backend source
to integrate against it. This file (`CLAUDE.md`) is for people/agents changing backend code.

---

## Layout

```
/backend/src
  /db                 Drizzle schema, client, migrations
  /schemas            Zod schemas — single source for validation AND for generating
                       A2A/MCP tool parameter schemas (via zod-to-json-schema or similar).
                       Zero dependencies on anything else in the tree.
  /errors             Typed domain error hierarchy (DomainError base + specific subclasses).
                       Zero dependencies on anything else in the tree.
  /clients            External SDK instances (razorpay.ts, anthropic.ts), created once
  /config             Parses + validates process.env via /schemas/env.schema.ts at boot —
                       fail fast on bad config, don't let a missing key surface mid-request
  /services           All business logic. See "Service Layer Rules" below.
  /routes             REST API for the Next.js storefront + dashboard. Thin — validate via
                       /schemas, call one or more /services functions, return.
  /agent-interfaces
    /a2a               Agent Card + task lifecycle (submitted→working→input-required→completed).
                       Primary interface. Task handlers validate via /schemas, call /services.
    /mcp               Thin adapter over the same /services calls. Secondary/compatibility layer.
  /webhooks           Razorpay webhook receiver — validates payload via /schemas, calls
                       recoveryService for payment.failed / subscription.charged events
  /middleware         verifyAgentToken.ts (token valid → scope/cap → Reserve Pay balance chain),
                      auth.ts (normal human session auth for REST routes)
  /llm                Every Claude API call in the backend lives here, nowhere else. See
                      "LLM Isolation" below.
  constants.ts        Regulatory/config numbers centralized — RESERVE_PAY_MAX_AMOUNT (₹10,000),
                      RESERVE_PAY_MAX_EXPIRY_DAYS (90), spend-cap defaults, etc. Never hardcode
                      these inline in a service or schema.
  server.ts           Entrypoint

/backend/tests        Mirrors /services. Prioritize mandateService and reservePayService —
                      these carry the most weight in the project's "bounded/gated" claim.
```

---

## Service Layer Rules (this is the load-bearing convention for the whole backend)

- **All order/cart/payment/mandate logic lives in `/services`.** `/routes` and
  `/agent-interfaces` (both A2A and MCP) must call into the same service functions — never
  duplicate business logic in a route handler or a task handler.
- **Dependency direction is one-way:** `/services` must never import from `/routes` or
  `/agent-interfaces`. Only the reverse is allowed. If a service seems to need something from a
  route, that's a sign the logic belongs in the service and the route is just misplaced.
- **`/schemas` and `/errors` are leaf-level, zero-dependency modules** — safely importable from
  anywhere (routes, agent-interfaces, services) with no circular-import risk.
- **Every service function that moves money or checks a mandate must call `auditService`** to
  write a row — actor (token/agent), mandate/scope checked, decision, outcome. An endpoint that
  moves money without an audit write is incomplete, not just under-logged.
- **Domain errors, not generic throws.** Use the `/errors` hierarchy (`ScopeExceededError`,
  `MandateExpiredError`, `InsufficientBalanceError`, `PaymentDeclinedError`, etc.) so
  `auditService` and both calling layers (routes, agent-interfaces) have one consistent shape to
  catch, log, and translate into a response. The "one graceful failure" demo case should throw
  one of these, not an unhandled exception.

---

## Cart Handling

Cart is **server-side, referenced by ID** — not built client/agent-side and submitted whole at
checkout. Decided because: it's the only way both callers (routes, agent-interfaces) can share
`cartService`'s state; it matches the ACP session model (create→update→complete) already used as
the checkout semantics reference; it produces a real per-item audit sequence instead of one
opaque "checkout happened" entry; it lets scope/cap checks fail fast on the item that exceeds the
cap rather than only at final checkout; it's what lets upsell suggestions ride along in
`add_item` responses; and it survives an agent-side crash/restart.

```
create_cart()                    → returns cart_id
add_item(cart_id, product, qty)  → validates stock/price, checks running total against the
                                    token's spend_cap, returns updated cart + upsell suggestions
remove_item(cart_id, item_id)
checkout(cart_id)                → re-validates final total, generates the Cart Mandate record,
                                    runs the Reserve Pay debit, writes audit rows
```

A one-shot "reorder exactly this" convenience is fine to support later, but it must resolve into
the same server-side cart internally (a helper that front-loads several `add_item` calls) — never
a separate checkout path that skips incremental validation.

---

## LLM Isolation

Every Claude API call in the backend lives in `/llm`, and nowhere else. This makes "no LLM in the
merchant transaction core" (root CLAUDE.md Hard Rule #1) structurally checkable rather than just
a written rule.
- **Never allowed to import `/llm`:** `mandateService.ts`, `reservePayService.ts`,
  `paymentService.ts`, `verifyAgentToken.ts`, or anything in `/agent-interfaces` task handlers
  that touches cart/checkout/payment.
- **Allowed to import `/llm`:** `growthService.ts` (upsell/cross-sell suggestion text —
  suggestions are advisory data only, never themselves mutate a cart), `recoveryService.ts`
  (failure *explanation*/messaging only — root-cause classification itself stays rule-based on
  decline codes), and the admin dashboard assistant.
- If you're adding an ESLint import-boundary rule to enforce this at build time, it belongs here.

---

## Payment / Mandate Specifics (backend implementation detail — see root CLAUDE.md for the "why")

- **Reserve Pay (SBMD) flow lives in `reservePayService.ts`:** Create Customer → Create Order
  (`token.type: single_block_multiple_debit`, `max_amount ≤ RESERVE_PAY_MAX_AMOUNT`,
  `expire_at ≤ RESERVE_PAY_MAX_EXPIRY_DAYS`) → Create Authorisation Payment (`upi.flow: intent`)
  → Fetch Token → subsequent debits are new Orders **without** the `notification` object +
  Initiate Payment referencing the stored token.
- **One Reserve Pay block per (customer, simulated-merchant) pair** — simulate multiple
  merchants as multiple tokens for the same customer within the one Razorpay test account.
- **Verification chain, enforced in `verifyAgentToken.ts` middleware, in this order:** token
  valid/unexpired/unrevoked → requested action within scope/cap → (if payment) Reserve Pay
  balance check. Don't reorder or short-circuit this — e.g. don't check balance before scope.
- **Cart Mandate** is a signed `{cart_contents, total_amount, token_id, timestamp}` record,
  generated in `mandateService.ts` at checkout time, before the Reserve Pay debit call —
  separate from the token's general scope/cap authority.

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
- **Zod schemas are the single source of truth** for both runtime validation and (via
  zod-to-json-schema or similar) the parameter schemas exposed to agents through A2A/MCP tool
  definitions. Don't hand-write a separate JSON schema for a tool that already has a Zod schema.
- **`/config` validates env at boot**, not lazily inside whatever service first needs a given
  key — a missing `RAZORPAY_KEY_SECRET` should crash startup, not surface as a mysterious 500
  three requests in.
- **Auth is a stateless JWT bearer token** (`hono/jwt`, signed in `userService.issueToken`),
  deliberately the same "bearer token in `Authorization` header" shape the future `agent_tokens`
  system will use — swapping in agent auth later doesn't require a new auth primitive, just a
  second verification path alongside `middleware/auth.ts`.

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
`RAZORPAY_KEY_SECRET` / `RAZORPAY_WEBHOOK_SECRET` from the Razorpay dashboard — the server won't
boot without them), then `bun run db:generate && bun run db:migrate && bun run db:seed`, then
`bun run dev`. Day-to-day schema changes: edit `src/db/schema.ts`, then either `db:generate` +
`db:migrate` (keeps a migration history) or `db:push` (quicker, no history — fine for local
iteration, not for anything already deployed).

`src/server.ts` is the real entrypoint (there is no `src/index.ts` — it was a broken bootstrap
stub and has been removed; `package.json`'s `"module"` field points at `src/server.ts`).
