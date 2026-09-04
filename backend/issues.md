# Backend — open issues and work queue

This is the **single** backend work register. It replaces `proposal.md` (the 2026-08-31 review),
whose still-open items are folded in below with their original `S#`/`L#`/`A#` ids so existing
references still resolve; the full original text is in git history.

Ordering is by priority, not by file. The P0/P1/Recommended sweep was completed against `main` at
`dbcaabc`; what remains open is **P0 item 7 (rate limiting)**, **P2 (password reset)**, and the
backlog. Closed items are kept as one-line rows with where they landed, rather than deleted, so
the `S#`/`L#`/`A#` ids still resolve.

For what already fails *gracefully*, see `handled.md` at the repo root — check it before adding a
new error path, and add to it when you add one.

---

## Standing constraints (not tasks)

### Reserve Pay needs Razorpay account activation — served by a simulator meanwhile

The Reserve Pay rail (`API.md` §6.11) is implemented and typechecks, but Razorpay has **not
provisioned the server-to-server payment API** on this account. `POST /v1/payments/create/json`
answers `400 BAD_REQUEST_ERROR "The requested URL was not found on the server."` for *any*
payment, recurring or not — verified by direct `curl`, not just through our code:

| Call | Result |
|---|---|
| `POST /v1/customers` | 200 |
| `POST /v1/orders` with `token.type: single_block_multiple_debit` | 200 |
| `GET /v1/payments`, `POST /v1/tokens` | 200 / 400 with real field validation — the route exists |
| `POST /v1/payments/create/ajax` | **401** (auth reached, so the 404s below are not an auth problem) |
| `POST /v1/payments/create/json` (SBMD auth **and** plain UPI collect) | **400** "URL not found" |
| `POST /v1/payments/create/upi`, `POST /v1/payments/validate/vpa` | **400** same |

Re-probed after UPI was enabled on the account: `GET /v1/methods` now reports `upi: true`,
`upi_intent: true`, `recurring.upi: true` — so UPI as a *payment method* is on, and the S2S *API*
is still off. They are separate entitlements and only the second one blocks us.

**To unblock:** ask Razorpay support to enable the **S2S JSON API** (`/payments/create/json`) and
`save_vpa` on this account.

**One narrowing worth keeping:** `POST /payments/create/recurring` *is* provisioned on both test
and live keys and does real field, id-format and token-lookup validation, returning exactly the
`{razorpay_payment_id, razorpay_order_id, razorpay_signature}` shape
`createReservePayDebitPayment` already expects. So the **debit** half has a working endpoint. The
**authorisation** half does not — sent with no `token` and `upi.flow: intent`, `create/recurring`
falls back to the same unprovisioned JSON handler. No authorisation means no token, so the working
debit endpoint has nothing to spend. Switching `createReservePayDebitPayment` over is a one-line
change, deliberately not applied because it cannot be tested until authorisation works.

**The simulator.** `RESERVE_PAY_SIM=true bun run dev` (test keys only; boot refuses against
`rzp_live_`) serves the rail from `services/reservePaySimService.ts`.
`services/reservePayGateway.ts` picks real or simulated from that one flag, and every guard,
reservation, audit write and status mapping in `reservePayService` runs identically either way.
Signatures are real on both sides — see `handled.md` §9. State lives in `sim_tokens` /
`sim_payments`, which `syncMandate` reconciles against exactly as it does Razorpay. Controls,
all scoped to the caller's own mandate: `POST /api/reserve-pay/sim/approve`,
`POST|DELETE /api/reserve-pay/sim/debit-failure`, `POST /api/reserve-pay/sim/token-status`,
`GET /api/reserve-pay/sim/state`. Dropping `RESERVE_PAY_SIM` switches back; no real Razorpay call
was removed or edited to build it.

### MCP agents may place orders — accepted risk, not a bug

> An OAuth-connected MCP agent can call `prepare_order` → `place_order` in one turn, and can call
> `start_reserve_pay_setup` to create a **new** block up to ₹10,000. The human's consent is the
> one-time OAuth approval plus the UPI PIN on the block — not a per-order confirmation. There is
> no scope, no spend cap, and no per-agent limit; the ₹10,000 regulatory ceiling and the block's
> remaining balance are the only bounds. This is deliberate, and it is the opposite of the
> first-party chat agent, where `place_order` is never in the model's tool list at all
> (`chatService.ts:261`). Accepted knowingly: agentic checkout is the product.

This closes `S1`. The two consequences of the decision that were scheduled rather than dropped are
now done: an MCP client gets the structured error (`S16`) and honest tool annotations (`A8`) it
needs to decide whether a retry is safe — `place_order` advertises `idempotentHint: true`, which
is precisely what tells a client that retrying after a timeout returns the same order rather than
placing a second one.

### Still open: `chat_messages.parts` carries no version stamp

`CHAT_PROTOCOL_VERSION` (now **4** on both sides) guards the *request*; it says nothing about
parts already written to the database. `GET /api/chat/:conversationId` replays stored parts and
stamps the *current* version onto them, so a part written under v3 is served as v4. Adding a
required field to a part type has already crashed the panel once this way.

Mitigated on the client (`web/store/chat-store.ts` sets `version` with a `migrate` that drops the
transcript; widgets treat newer fields as optional), but the server side is unaddressed. Options:
a `protocol_version` column on `chat_messages` with older rows filtered out of replay, or a
standing rule that new part fields are always optional on the client. **Needs a decision, not a
patch** — recorded rather than fixed.

The lesson worth keeping from how this was found: a prompt rule that defers to a widget is only
as good as that widget's wire type, and parts persisted in two places (JSONB and the client's
`sessionStorage`) are reachable by neither the request-version guard nor a code review of the
current types.

---

## P0 — abuse surface and money correctness

**All closed except item 7 (rate limiting), which was deferred by decision.** Everything below the
rate-limiting entry has been fixed and verified; see git history for the per-item commits.

### 7. No rate limiting anywhere  `S4`  — **STILL OPEN**

No middleware, no dependency, no per-IP or per-account counter on any route. The ones that matter:

- **`POST /api/chat`** — every turn is up to `MAX_ROUNDS = 8` OpenRouter calls at
  `maxTokens: 1500`. Combined with unlimited signup this is an **unbounded LLM billing
  amplification vector**, and the most likely way this project gets hurt in a public demo.
- **`POST /api/auth/login`** — credential stuffing, and a CPU denial-of-service besides:
  `Bun.password.verify` is deliberately slow, so unthrottled requests are a direct lever on the
  process. Now slightly worse, not better: the enumeration fix (old item 11) makes the *miss* path
  pay for an argon2 verify too, which is correct for privacy and doubles the cost of a flood.
- **`POST /api/admin/login`** — one shared, unrotatable password guarding the whole operator
  surface, with unlimited guesses. The compare is now constant-time, but volume is untouched and
  remains the cheapest attack on the most valuable credential in the system.
- **`POST /api/auth/signup`** — unlimited account creation, no verification.
- **`POST /oauth/register`** — unauthenticated RFC 7591 dynamic client registration; unbounded
  rows in `oauth_clients`, and `registerClientSchema.redirect_uris` has no array-length or
  per-URI length cap, so one request can store an arbitrarily large jsonb value. (The global
  256 KB body limit now bounds a single request, but not the row count.)
- **`POST /oauth/token`** — a free DB-read amplifier (guessing itself is unrealistic against
  32 random bytes).
- **`GET /api/reserve-pay/mandates/:id`** — each call re-syncs against Razorpay, up to two live
  API calls. The `syncMandate` freshness window (old P1 item 6) does **not** help here: this
  endpoint is the approval poll and deliberately passes `force: true`.

One middleware file covering all of the above.

### Closed in this pass

| # | Item | Where it landed |
|---|---|---|
| 1 | `minPrice`/`maxPrice` unbounded on a public endpoint | `schemas/product-query.schema.ts`, capped at `MAX_PRODUCT_PRICE` |
| 2 | Cart quantity uncapped on the REST path | `schemas/cart.schema.ts` **and** `cartService.addItem`, against the resulting line; the false comment in `tools/cart.ts` rewritten |
| 3 | REST add-to-cart ignored `inStock` | `cartService.addItem`, so both callers inherit it |
| 4 | `deliverySlot` accepted arbitrary free text | validated against `DELIVERY_SLOT_LABELS` |
| 5 | Order items from the live cart, totals from the snapshot (+`S14`, `S15`) | `CheckoutSnapshot.lines`; `place_order` passes the quoted total and `mandateId`, and the charge is refused on divergence |
| 6 | `getOrCreateActiveCartId` lost-update race (`S12`) | `onConflictDoNothing().returning()` + re-read |
| 8 | Admin login not constant-time (`S5`) | `crypto.timingSafeEqual` over sha256 digests. **No lockout — that half belongs to item 7** |
| 9 | Live-money test harness on the production route table (`S10`) | registered only under `RESERVE_PAY_TEST_DEBIT_ROUTE` |
| 10 | No webhook replay guard (`S17`) | `markDebitOutcome` is a transition table; `captured -> failed` refused |
| 11 | Login leaked which emails are registered | dummy-hash verify on the miss path. **Signup still leaks** — see below |
| 12 | No request body size limit | `hono/body-limit` at `MAX_REQUEST_BODY_BYTES` |
| 13 | Unbounded conversation creation | `MAX_CONVERSATIONS_PER_USER`, both creation paths |

**Deliberately left open from item 11:** `userService.createUser` still throws
`ConflictError("An account with this email already exists")`, which leaks the same fact the login
timing fix just closed. Not fixed here because a non-enumerating signup and a non-enumerating
forgot-password want the same treatment, and that is P2. Recorded in `handled.md` §7 so it is not
mistaken for done.

## P1 — performance

**All closed.** The schema went from four indexes to fifteen, and the two worst query shapes
(1+2N order hydration, unindexable search) are gone.

| # | Item | Where it landed |
|---|---|---|
| 1 | Missing indexes (`L4`) | 11 new indexes incl. the first two on `audit_log`, which had none |
| 2 | `GET /api/orders` was 1+2N and unpaginated (`L1`, `L9`) | `orderService.attachItems`; `{limit, offset}` in the service, `?limit/?offset` on the route, same for the admin listing and dashboard |
| 3 | Product search could not use an index (`L3`) | `pg_trgm` GIN on `name`, plain GIN on `tags`, tag clause rewritten to `&&`; `%`/`_` escaped |
| 4 | Duplicate count query on every listing (`L2`) | `count(*) over()` + `utils/paginate.ts` |
| 5 | `loadHistory` read the whole transcript (+`S3`) | `ORDER BY … DESC LIMIT`, then walk forward to a turn boundary |
| 6 | `syncMandate` called far more than needed (`L5`) | `synced_at` + `RESERVE_PAY_SYNC_FRESHNESS_SECONDS`; pollers and webhooks pass `force` |
| 7 | `buildTurnContext` inlined every address (`A12`) | capped at `MAX_CONTEXT_ADDRESSES`, default first |
| 8 | `search_products_nl` offered to the chat model (`A1`), filter builder under-fed (`A2`) | `ToolDefinition.surfaces`; prompt now gets `slug — name — description` |
| 9 | `temperature: 0.3` in a tool-calling loop (`A6`) | `0` |
| 10 | Sorts had no tiebreaker, `newest` did not sort by age (`L6`) | `asc(products.id)` on every sort; `products.created_at` added |

**One recall trade to know about (item 3):** the tag clause is now exact element overlap, where it
used to be a substring `ILIKE`. Searching `organ` no longer matches the tag `organic`. Accepted —
the tag clause is a bonus path and `name` still matches substrings. Also note `pg_trgm` here makes
search **fast, not fuzzy**: `choclate` still returns nothing. The index is the prerequisite for
fuzzy matching, but turning it on is a recall decision (`A3`/`A4`/`A5`) rather than a free side
effect.

## P2 — password reset (new feature, real email)

There is **no email capability anywhere in the repo today** — no provider dependency, no SMTP
config, no send path. This adds one.

**Provider.** Add **Resend** (one API key, HTTP, no SMTP config to get wrong) with
`RESEND_API_KEY` and a from-address added to `schemas/env.schema.ts` so they are validated at
boot like every other key, per the `/config` convention in `CLAUDE.md`. Fetch the current provider
API shape with the `find-docs` skill rather than writing the call from memory.

**Storage.** A new table of single-use, expiring reset tokens, **hashed at rest** — mirror the
`tokenHash`-as-primary-key pattern in `db/schema/oauth.ts`'s `oauth_refresh_tokens`, including
marking a token consumed with a conditional `UPDATE … WHERE consumedAt IS NULL` so a concurrent
double-use loses deterministically.

**Endpoints.**

- `POST /api/auth/forgot-password` `{email}` → **always `200`**, whether or not the address
  exists. This is the whole point: a distinguishable response reintroduces the enumeration
  problem the login-timing fix closed (old P0 item 11) — and `createUser` still leaks it directly,
  which is why that half was left for this change. Sends a link to
  `${PUBLIC_APP_URL}/reset-password?token=…`.
- `POST /api/auth/reset-password` `{token, password}` → consumes the token, re-hashes with
  `Bun.password.hash`, returns `200`. Invalid/expired/consumed tokens all answer the same way, per
  `handled.md` §7.

**Also:** rate-limit both under P0 item 7 (they are the two most obviously abusable new routes);
write `auditService` rows for both; document as `API.md` §6.3b and remove "No password reset" from
`API.md` §7. Password policy today is `min(6)` with no complexity rule — worth revisiting in the
same change.

---

## Recommended alongside — **all closed**

- **`S3`** — done with P1 item 5, same read path.
- **`S11`** — `orderService.getOrderByNumber(userId, orderNumber)` added; `tools/orders.ts` no
  longer imports `db`. `grep -rn 'from "../../db"' src/agent-interfaces` is now empty, which is
  the check the Service Layer Rule wants.
- **`S13`** — `mandateService.markStatus` only includes `orderId` in the patch when it is
  provided, so it can no longer null the column that makes `place_order` idempotent.
- **`S16`** — the MCP error path sets `structuredContent`, so `code` and `retryable` reach the
  client instead of being flattened into prose.
- **`A8`** — per-tool `annotations` on `ToolDefinition`, filled in for every write tool. Written
  by hand rather than derived from `readOnly`, since `add_to_cart` (additive) and
  `update_cart_item` (absolute) are both writes with opposite idempotency.
- **`A9`** — the `UNAUTHORIZED`/`FORBIDDEN` branch keeps its anti-probing message and now carries
  a hint.
- **`A11`** — the per-round LLM log line carries the answering model, latency and token usage.
  This is the only cost visibility in the system, and it is what makes item 7's absence
  measurable in the meantime.

## Backlog — not scheduled

- **`S2`** — `chat_messages` row ordering within a turn is not deterministic. `defaultNow()` emits
  Postgres `now()`, which is *transaction start time*, so every row `persistTurn` writes carries
  an identical timestamp, and both readers order by `createdAt` alone. Index order is the likely
  tiebreak today but nothing guarantees it. Needs an ordinal column and a migration.
- **`S6` / `S7`** — live agent access tokens survive refresh-token revocation for up to 24h (no
  `jti`, no denylist), and a replayed refresh token does not revoke its family. Descoped with
  agent revocation; revisit if a "connected agents" view is ever built.
- **`S18`** — `routes/mcp.ts` fabricates `AuthInfo.expiresAt` as `now + 60`. Harmless under
  `legacy: "stateless"`; wrong the moment the transport mode changes.
- **`L7`** — multi-tag search is `@>` (AND), so "organic bestsellers" returns nothing. Deliberate
  and documented, but it gives a model no way to tell an over-constrained query from an empty
  catalog. Either switch to overlap or add an explicit `tagMode`.
- **`L8`** — `nextPartId` uses a module-global counter. Not a bug (the random suffix makes
  collisions impossible) but a shared mutable across concurrent requests that a reader has to stop
  and reason about.
- **`L10`** — `ForbiddenError` is exported and never constructed, while `mapError` has a live
  `case "FORBIDDEN"`. Ownership failures deliberately answer `NotFoundError` for anti-probing, so
  either something should throw it or both halves can go.
- **`A3` / `A4` / `A5`** — search recall. Nothing retries on zero results; `search_products_nl`'s
  `{}` fallback passes the customer's whole sentence into an `ILIKE` substring match on product
  names, which is a guaranteed miss dressed as a normal empty result. The root cause is that
  search never matches descriptions and only by substring. The `pg_trgm` index is now in place
  (closed P1 item 3), so the affordable half — a `similarity()` threshold for typo tolerance — is
  a query change away; embeddings are the other half. Note the index alone changed nothing about
  recall.
- **`A7`** — `MAX_ROUNDS = 8` with `parallelToolCalls: false` is tight for a cold checkout, which
  is seven rounds with no slack for one failure and a recovery. The sequential constraint is
  justified for mutations and unnecessary for reads; `ToolDefinition.readOnly` is already the
  discriminator.
- **`A10`** — prompt injection is closed structurally only for `place_order` (and only on the chat
  surface). `presenters.toAgentProduct` already drops `description`, which is most of the
  mitigation; the gap is `toAgentProductDetail`. Sharper on MCP, where the text reaches an agent
  whose system prompt we do not write and cannot audit.

---

## Closed / out of scope

- **`S1`** — reclassified as intentional; see "MCP agents may place orders" above.
- **`S8`** — an unauthenticated `GET /api/oauth/authorize/:requestId` is correct by design: the
  consent page must render before the human logs in, and the id is a v4 UUID.
- **Descoped by decision**, and documented as such in `API.md` §7: the Recovery Agent, the A2A
  transport, upsell/cross-sell tooling, Intent Mandate `scope`/`spend_cap`, the connected-agents
  view and agent revocation, customer order cancellation and refunds, logout token revocation,
  stock quantities, order-status transition rules, and a test suite.
