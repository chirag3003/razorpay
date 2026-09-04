# Backend — open issues and work queue

This is the **single** backend work register. It replaces `proposal.md` (the 2026-08-31 review),
whose still-open items are folded in below with their original `S#`/`L#`/`A#` ids so existing
references still resolve; the full original text is in git history.

Ordering is by priority, not by file. Everything here has been verified against `main` at
`dbcaabc`.

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

This closes `S1`. Two consequences of the decision are scheduled below rather than dropped:
an MCP client needs the structured error (`S16`) and honest tool annotations (`A8`) to decide
whether a retry is safe, and both matter more now than they did when `place_order` was
chat-only.

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

### 1. `minPrice` / `maxPrice` are unbounded on a public endpoint  `[new]`

`schemas/product-query.schema.ts` — `z.coerce.number().optional()`, with no `.int()`, `.max()` or
`.nonnegative()`. `GET /api/products?maxPrice=99999999999999999999` reaches
`productService.listProducts` → `lte(products.price, …)` → a Postgres *integer out of range*
error, which is not a `DomainError` and so becomes a generic 500. **Unauthenticated, repeatable,
on the most public endpoint in the app.**

The fix already exists one file over: `schemas/agent-tool.schema.ts` caps the same filters at
`MAX_PRODUCT_PRICE` (`constants.ts`), added for exactly this reason. It was applied to the agent
path only. Mirror it here.

### 2. Cart quantity is uncapped on the REST path  `[new]`

`schemas/cart.schema.ts` — `addCartItemSchema.qty` is `z.number().int().positive()` and
`updateCartItemSchema.qty` is `z.number().int().min(0)`. Neither has a `.max()`.
`cartService.addItem` has no cap of its own and quantity is **additive**, so
`POST /api/cart/items {qty: 2000000000}` twice overflows `int4` and produces another unhandled
500. A single large value also produces an order total with no ceiling on the ordinary Razorpay
checkout path.

`MAX_CART_ITEM_QTY` (20) is enforced **only** at `agent-interfaces/tools/cart.ts:79`.

**Also fix the comment at `agent-interfaces/tools/cart.ts:60`**, which asserts that "the REST
route's Zod schema did the inStock and quantity checks." It does neither. A comment claiming a
guard that does not exist is worse than no comment.

Cap in the schema *and* in `cartService.addItem`, since the additive path can exceed the cap
without any single request doing so.

### 3. REST add-to-cart ignores `inStock`  `[new]`

`cartService.addItem` checks `archivedAt` only. Out-of-stock products can be added and checked out
through the storefront, while the agent path correctly rejects them
(`agent-interfaces/tools/cart.ts:66`). Same asymmetry as item 2 — the guard belongs in the
service, where both callers get it.

### 4. `deliverySlot` accepts arbitrary free text  `[new]`

`schemas/checkout.schema.ts` — `z.string().min(1)`. Any string, of any length, lands in an order a
human has to fulfil. `constants.ts` acknowledges this ("The REST checkout schema stays
`z.string().min(1)`") and constrains it at the agent boundary instead; the storefront posts a
label, so validate against the labels `deliverySlotLabel` produces from `DELIVERY_SLOTS` rather
than against slot ids.

### 5. Order items come from the live cart while totals come from the snapshot  `[new]` + `S14` + `S15`

Three faces of one problem: **what was approved is not what gets charged or recorded.**

- **Web path** (`orderService.confirmPayment:129`): totals are read from the frozen
  `checkoutSnapshot`, but the order's line items are read from the *live* cart
  (`getCartWithTotals`, `:151`) and `priceAtPurchase` from the *current* catalog price (`:181`).
  Mutating the cart while the Razorpay modal is open produces an order containing the new items at
  the old total. The agent path has a `cartFingerprint` guard for this; the web path has none.
- **`S14`** — `place_order` computes `totalMatchesQuote` (`tools/checkout.ts:522`), writes it to
  the audit row, and nothing reads it. `checkoutWithReservePay` re-derives its snapshot from the
  live cart at charge time and charges *that*, not the quoted total. The fingerprint check
  narrows the window to sub-millisecond and same-customer-only but explicitly does not close it.
- **`S15`** — `place_order` does not pass the quote's `mandateId` down;
  `reservePayService.prepareDebit` re-resolves "the live mandate" via `getLiveMandate`. A customer
  who revokes and recreates their block between `prepare_order` and `place_order` is charged
  against a mandate the signed quote never named — and the signature still verifies, because
  nothing checks `mandateId`.

Fix as one change: build order items and prices from the snapshot, pass the quoted total and
`mandateId` down, and refuse to charge on divergence rather than recording it and proceeding.

### 6. `getOrCreateActiveCartId` has a lost-update race  `S12`

`cartService.ts:13` selects, sees nothing, inserts. Two concurrent callers both insert;
`carts.user_id` is unique, so the loser throws a raw unique violation that nothing catches and it
escapes as a bare 500. This is the hottest path in the backend — every cart route, every cart
tool, `prepare_order`, `place_order` and `buildTurnContext` call it — and it is newly reachable
from parallel MCP tool calls, which have no client-side serialisation.

Every other insert-after-check in the codebase already handles this. Use the same shape
`chatService.resolveConversation` uses: `onConflictDoNothing().returning()`, re-read on empty.

### 7. No rate limiting anywhere  `S4`

No middleware, no dependency, no per-IP or per-account counter on any route. The ones that matter:

- **`POST /api/chat`** — every turn is up to `MAX_ROUNDS = 8` OpenRouter calls at
  `maxTokens: 1500`. Combined with unlimited signup this is an **unbounded LLM billing
  amplification vector**, and the most likely way this project gets hurt in a public demo.
- **`POST /api/auth/login`** — credential stuffing, and a CPU denial-of-service besides:
  `Bun.password.verify` is deliberately slow, so unthrottled requests are a direct lever on the
  process.
- **`POST /api/admin/login`** — one shared, unrotatable password guarding the whole operator
  surface, with unlimited guesses. The most valuable credential in the system and the cheapest to
  attack.
- **`POST /api/auth/signup`** — unlimited account creation, no verification.
- **`POST /oauth/register`** — unauthenticated RFC 7591 dynamic client registration; unbounded
  rows in `oauth_clients`, and `registerClientSchema.redirect_uris` has no array-length or
  per-URI length cap, so one request can store an arbitrarily large jsonb value.
- **`POST /oauth/token`** — a free DB-read amplifier (guessing itself is unrealistic against
  32 random bytes).
- **`GET /api/reserve-pay/mandates/:id`** — each call re-syncs against Razorpay, up to two live
  API calls, so a tight poll hammers Razorpay as well as us.

One middleware file covering all of the above.

### 8. Admin login: non-constant-time compare, no lockout  `S5`

`services/adminAuthService.ts` — `password !== env.ADMIN_PASSWORD`. Use
`crypto.timingSafeEqual` on equal-length buffers; it costs nothing and removes the question.
Materially more relevant once item 7 lands and volume is no longer the attacker's easiest lever.

### 9. A live-money test harness is on the production route table  `S10`

`POST /api/reserve-pay/mandates/debit` (`routes/reserve-pay.ts:54`) charges the caller's Reserve
Pay block for an arbitrary amount and creates no order. Its own comment calls it a test harness.
Any authenticated user can call it, and nothing gates it behind an env flag.

Its sibling `/sim/*` routes in the same file get this exactly right — *"a control that can move a
mandate's status should not exist as a route at all in a real deployment."* Apply the same
pattern, or delete the route.

### 10. No webhook replay guard  `S17`

`verifyWebhookSignature` proves a body came from Razorpay; nothing stops the same signed body
being replayed. Most handlers are naturally idempotent (`syncMandate` re-reads from the gateway,
`confirmPayment` short-circuits on an existing order). `markDebitOutcome` is not — it is an
unconditional `UPDATE`, so a stale `payment.failed` redelivered after a successful capture flips a
`captured` debit back to `failed` and corrupts the reconciliation ledger.

Preferred fix: refuse to move a debit row out of a terminal state. Alternative: store event ids
and reject duplicates.

### 11. Login and signup leak which emails are registered  `[new]`

`userService.verifyCredentials` returns before `Bun.password.verify` when the email is unknown, so
an unknown address answers in ~0ms and a known one takes an argon2 verify. The response text is
correctly identical (see `handled.md` §7); the timing is not. Run the verify against a dummy hash
on the miss path.

`createUser` throws `ConflictError("An account with this email already exists")`, which leaks the
same fact directly. Worth reconsidering alongside the password-reset work in P2, since a
non-enumerating signup and a non-enumerating forgot-password want the same treatment.

### 12. No request body size limit  `[new]`

No `hono/body-limit`, no `maxRequestBodySize`. Unauthenticated routes (`/api/auth/signup`,
`/api/auth/login`, `/oauth/register`, `/oauth/token`, `/webhooks/razorpay`) accept arbitrarily
large bodies — a cheap memory/CPU lever, compounded by the absence of item 7.

### 13. Unbounded conversation creation  `[new]`

`chatService.resolveConversation` accepts a client-supplied `conversationId` with
`createIfMissing`, so a client can mint unlimited `conversations` rows. Cap per user, or stop
honouring arbitrary client UUIDs for creation.

---

## P1 — performance

**Start here: only four indexes exist in the entire schema.** Verified across
`drizzle/*/migration.sql`: `conversations(user_id, updated_at)`,
`chat_messages(conversation_id, created_at)`, and the two partial uniques on
`reserve_pay_mandates` and `cart_mandates`. Everything else relies on primary keys and `.unique()`
columns.

### 1. Missing indexes  `L4`

Not indexed, despite being queried by exactly these columns:

- `orders.user_id` — `listOrders`, `getOrderById`, admin filtering
- `order_items.order_id` — every order hydration
- `addresses.user_id`
- `cart_mandates.user_id` — `getOpenCartMandate`, called on every chat turn
- `products.category_id`
- `reserve_pay_debits.mandate_id`
- `oauth_refresh_tokens(user_id, client_id)`
- **`audit_log` — no index at all.** This is the table the entire audit story depends on being
  queryable, and there is no way to fetch one actor's rows, or one action's, without a full scan.
  Index actor and `created_at`.

### 2. `GET /api/orders` is 1 + 2N queries and unpaginated  `L1` + `L9`

`orderService.listOrders:283` selects the order rows, then maps every one through
`getOrderWithItems`, which **re-selects the order it was just handed** plus its items. Twenty
orders is 41 round trips, over an unindexed `user_id`, with no limit or offset anywhere.

Replace with two queries: the orders, then all items for those order ids via
`inArray(orderItems.orderId, ids)`, grouped in memory. Push `limit`/`offset` into the service —
`agent-interfaces/tools/orders.ts` currently fetches everything and slices afterwards (`L9`, its
own comment says so). `adminOrderService.listOrders` has the same shape via `withDetail` with
`pageSize` capped at 100, so an admin page can be 200 round trips, and
`adminDashboardService.summary` inherits it for the recent-orders panel.

### 3. Product search cannot use an index  `L3`

`services/productSearch.ts` is `ILIKE '%term%'` on `products.name` OR'd with an
`EXISTS (SELECT 1 FROM unnest(tags) …)`. Neither side is indexable — a leading-wildcard `ILIKE`
cannot use a btree, and the `unnest` subquery defeats the GIN index `tags` would otherwise
support. Every search is a sequential scan, on the hottest path both the chat agent and MCP
callers take.

Add a `pg_trgm` GIN index on `name` (which also buys typo tolerance) and rewrite the tag clause to
`tags && ARRAY[...]` so a plain GIN applies. The file is already isolated behind one function
specifically so this can be swapped without touching `productService` or any tool.

While here: the term is interpolated into the pattern without escaping `%` or `_`, so a caller can
inject wildcards. Harmless today, but escape them.

### 4. Duplicate count query on every listing  `L2`

`productService.listProducts` runs the filtered query and a second query repeating the same join
and where clause purely for `count(*)`. A `count(*) over()` window on the first query returns
both in one round trip. Same shape in `adminProductService.list` and `adminUserService.listUsers`.

### 5. `loadHistory` reads the whole transcript to keep 40 rows  `[new]` + `S3`

`chatService.ts:78` selects **every** `chat_messages` row for the conversation — each holding a
full OpenRouter message including tool results as JSONB — and then slices the last
`MAX_HISTORY_MESSAGES` in JavaScript. Every chat turn's cost grows with conversation length.
Use `ORDER BY created_at DESC LIMIT` and reverse.

**Do this together with `S3`**, which touches the same slice: `rows.slice(-40)` cuts by row count,
not by turn boundary, and each tool round produces an `assistant` row carrying `toolCalls` plus a
`tool` row carrying the result. A cut landing between them produces a `tool` message with no
matching `assistant`, which every OpenAI-compatible endpoint rejects with a 400. The failure is
**not transient** — history only grows, so once a conversation crosses the boundary unluckily,
every subsequent turn in it fails identically with "The assistant hit a problem. Try again?"
Walk backwards and stop at a `user` or tool-call-free `assistant` row.

### 6. `syncMandate` is called far more often than it needs to be  `L5`

It costs up to two Razorpay round trips (`fetchPayment` + `fetchCustomerToken`) and is called from
`createMandate`, `getMandate`, `prepare_order`, `get_payment_status`, `check_reserve_pay_status`,
`prepareDebit` and four webhook branches. One checkout conversation can hit Razorpay six or more
times.

Add a short freshness window — skip the sync if the row was synced in the last N seconds — with
`check_reserve_pay_status` opting out, since polling is its whole purpose. This weakens nothing:
the actual correctness guarantee is `prepareDebit`'s conditional `UPDATE`, which re-checks the
balance atomically in the database regardless of how fresh the sync was.

### 7. `buildTurnContext` inlines every saved address, uncapped  `A12`

`llm/turnContext.ts` loops over all addresses into the context block prepended to every turn.
Fine at two; at forty it is the largest thing in the prompt and pushes conversation history out of
the window — degrading exactly the thing the context block exists to improve. Cap it (default
first, then most recent N) and tell the model to call `list_addresses` for the rest, mirroring the
treatment cart line items already get in the same file.

### 8. `search_products_nl` is offered to the chat model  `A1`, and the filter builder is under-fed  `A2`

`chatService.ts:261` filters exactly one tool from the model's list (`place_order`), so
`search_products_nl` is offered to the chat agent — which is itself an LLM. It spends a *second*
LLM call producing filters the chat model could have produced itself, for free, by calling
`search_products` directly: an extra round trip, a second failure mode, and the possibility of two
models disagreeing about one query. The tool was built for MCP callers with no LLM of their own.
Make it MCP-only — preferably by adding a `surfaces: ("chat" | "mcp")[]` field to
`ToolDefinition` rather than extending a filter predicate that already carries an unrelated safety
meaning.

`A2` is the highest accuracy-per-effort item in this file: `searchAssistService` fetches full
category rows and then passes `categories.map(c => c.slug)` — slugs only — into the prompt, so the
model has to map "milk" → `dairy-eggs` from the slug string alone. The rows already carry `name`
and `description`, already in memory. Pass `slug — name — description` triples.

### 9. `temperature: 0.3` in a tool-calling loop  `A6`

`llm/agentLoop.ts:61`. There is no upside to sampling noise in a UUID, a slot id or a category
slug, and arguments are where accuracy actually matters. The prose-quality argument is weak here
because the system prompt already constrains output to one or two short sentences.
`llm/searchQueryBuilder.ts` already uses `0` for exactly this reason.

### 10. Sorts have no tiebreaker, and `newest` does not sort by age  `L6`

`productService.ts` applies a single ordering key per sort and no secondary key, so rows with
equal keys come back in planner order — which is not stable across pages, meaning **paginated
results can repeat or skip products**. This is the backend half of `web/issues.md`'s pagination
bug. Add a stable tiebreaker (`products.id`) to every sort.

Separately, the `newest` branch orders by whether the product carries the `new` *tag*, because
`products` has no `created_at` column (`adminProductService` comments on the same gap and falls
back to `archivedAt`). Either add `created_at` — cheap, and it makes the admin sort honest too —
or rename the option to what it does.

---

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
  problem P0 item 11 is closing. Sends a link to
  `${PUBLIC_APP_URL}/reset-password?token=…`.
- `POST /api/auth/reset-password` `{token, password}` → consumes the token, re-hashes with
  `Bun.password.hash`, returns `200`. Invalid/expired/consumed tokens all answer the same way, per
  `handled.md` §7.

**Also:** rate-limit both under P0 item 7 (they are the two most obviously abusable new routes);
write `auditService` rows for both; document as `API.md` §6.3b and remove "No password reset" from
`API.md` §7. Password policy today is `min(6)` with no complexity rule — worth revisiting in the
same change.

---

## Recommended alongside

Cheap, and they touch files the work above already opens.

- **`S3`** — do it with P1 item 5, same read path.
- **`S11`** — `agent-interfaces/tools/orders.ts` imports `db` and runs its own select to resolve
  an order number, violating the Service Layer Rule that `/agent-interfaces` never touches the
  database. Harmless today (it is a read, and `getOrderById` still checks ownership on the next
  line) but it is the crack the rule exists to prevent. Add
  `orderService.getOrderByNumber(userId, orderNumber)`.
- **`S13`** — `mandateService.markStatus` does `set({ status, orderId: orderId ?? null, … })`, so
  calling it without an `orderId` **nulls any existing one**. That column is what makes
  `place_order` idempotent; clearing it turns a safe retry into a second charge. Not reachable
  today — every call that omits it targets an `open` quote, which has none — but it is a loaded
  footgun on the one column that prevents double-charging. Only include `orderId` in the patch
  when it is provided.
- **`S16`** — `agent-interfaces/mcp/index.ts` flattens `{code, message, retryable, hint}` into a
  plain text `content` block, so `code` and `retryable` never reach an MCP client. The whole
  tool-error design exists so a caller can branch on the code: `chat/partMapper.ts` uses exactly
  that to ensure `payment_declined` never offers a retry, because the charge may have succeeded
  and only its proof is suspect. An MCP client gets a string and has to guess. **Now more
  important than when it was filed** — MCP `place_order` is deliberately open, so an MCP client
  guessing wrong retries into a double-charge attempt. Set `structuredContent` on the error path
  too; MCP supports it, and the success path one branch up already uses it.
- **`A8`** — MCP tool annotations are half-filled: `readOnlyHint: tool.readOnly` and nothing else.
  Clients use `destructiveHint` / `idempotentHint` / `openWorldHint` to decide what to run without
  asking a human. Same reasoning as `S16` — this is the cheapest per-tool safety improvement
  available on the surface we just opened. `clear_cart` → `destructiveHint: true`; `place_order` →
  `idempotentHint: true` (it genuinely is, by `quoteId`, and advertising it tells a client a retry
  after a timeout is safe); `add_to_cart` → `idempotentHint: false` (additive, a blind retry
  double-adds); `update_cart_item` / `remove_from_cart` → `idempotentHint: true`. Wants a per-tool
  annotations field on `ToolDefinition` rather than being derived from `readOnly`.
- **`A9`** — `registry.mapError` maps `UNAUTHORIZED` and `FORBIDDEN` to "Not available" with **no
  hint**, while every other branch has one and the file's own comment says the hint is what turns
  a failure into a recovery. The anti-probing choice is right; the dead end is not. "That belongs
  to a different account. Call `list_orders` to see this customer's own orders." leaks nothing.
- **`A11`** — `clients/openrouter.ts` sends a `modelChain` and OpenRouter fails over server-side,
  so a degraded answer cannot be attributed to a model. `response.model` is on every response and
  is read nowhere; neither is token usage, so there is no per-turn cost or latency record. Log
  both — it is the only cost visibility in the system, and it complements the new rate limits.

---

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
  search never matches descriptions and only by substring — P1 item 3's `pg_trgm` work is the
  affordable half of the fix; embeddings are the other.
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
