# Backend code review — findings & proposals

Full read of `backend/src` (~9.3k lines, 79 files) on 2026-08-31, at commit `a8569ea`.

**Nothing here is implemented.** This is the findings half of the review; the companion pass only
removed dead code and rewrote comments, with no behaviour change. Each item names the file and the
line so it can be picked up independently.

Ordering inside each section is roughly by severity/impact, not by file.

---

## 1. Security & bugs

### S1 — MCP hands an external agent `place_order` with no gate

`src/agent-interfaces/mcp/index.ts:33` registers every entry of `ALL_TOOLS`, and
`ALL_TOOLS` includes `checkoutTools` (`src/agent-interfaces/tools/checkout.ts:457`), which
includes `place_order` and `start_reserve_pay_setup`.

The chat agent's headline safety property is structural, not prompted: `place_order` is never in
the tool list a model sees (`src/services/chatService.ts:279` filters it out unconditionally), and
`chatService.handlePlaceOrderConfirm` calls it directly only when the customer taps Confirm on a
review widget. `CLAUDE.md` states this as the design: *"A confused model or a prompt injection
hiding in a product name cannot place an order because the function is never in its hands to begin
with — there's no 'unless' for it to defeat."*

The MCP surface hands it over directly. An OAuth-connected agent can call `prepare_order` and then
`place_order` in the same breath — no human, no spend cap, no per-order confirmation — against a
24-hour access token. It also gets `start_reserve_pay_setup`, so it can create a *new* block up to
`RESERVE_PAY_MAX_AMOUNT` (₹10,000) rather than only spending an existing one.

`CLAUDE.md`'s "No scope/spend-cap enforcement yet" note frames this as a feature that hasn't been
built. It is more than that: it is an active inversion, on the newest surface, of the property the
chat agent goes to real lengths to guarantee.

**Options, roughly in order of effort:**

1. Filter `place_order` out of `buildMcpServer` the same way `chatService` does, and require the
   human to confirm the quote out-of-band (the `/agent-connect` page pattern already exists for
   OAuth consent — a "confirm this order" page is the same shape).
2. Add the `scope` / `spend_cap` fields already sketched in root `claude.md`'s Intent Mandate
   design, enforced by the `verifyAgentToken.ts` middleware `CLAUDE.md` already describes but
   which does not exist. `ToolDefinition.readOnly` is already on every tool and is the natural
   gate.
3. Keep it exposed but require a fresh, short-lived, per-quote authorisation (a second OAuth
   scope, or a signed confirmation the human produces) before `place_order` will accept a quoteId.

### S2 — `chat_messages` ordering within a turn is not deterministic

`src/services/chatService.ts:121` (`persistTurn`) inserts every row of a turn inside one
`db.transaction`. `chat_messages.created_at` is `timestamp().notNull().defaultNow()`
(`src/db/schema/conversations.ts:61`), and Drizzle's `defaultNow()` emits Postgres `now()`, which
is **transaction start time** — byte-identical for every row written in that transaction.

`loadHistory` (`chatService.ts:88`) and `loadTranscript` (`chatService.ts:103`) both order by
`createdAt` alone. With every row in a turn carrying the same timestamp, the order is whatever the
planner happens to return. That can interleave a turn's `assistant` / `tool` / `assistant` rows
incorrectly, which corrupts the history replayed into the model on the next turn and the transcript
replayed on `{kind:"resume"}`.

The `chat_messages_conversation_idx` index on `(conversation_id, created_at)` makes index order the
likely tiebreak in practice today, but nothing guarantees it, and it will change under a plan
change or a `VACUUM FULL`.

**Fix requires a schema change** — an ordinal (`serial`, or a per-conversation sequence number
assigned in `persistTurn`), then order by `(created_at, ordinal)`. Not a one-liner, which is why
it is here rather than in the cleanup pass.

### S3 — `loadHistory` can orphan a `tool` message from its `assistant` parent

`chatService.ts:93` — `rows.slice(-MAX_HISTORY_MESSAGES)` slices by row count (40), not by turn
boundary. Each tool call produces two rows (the `assistant` carrying `toolCalls`, then the `tool`
carrying the result), so a slice can begin partway through that pair.

Every OpenAI-compatible endpoint rejects a `tool` message that is not preceded by an `assistant`
message with a matching `tool_calls` entry. That comes back as a 400, which `agentLoop`'s outer
catch (`src/llm/agentLoop.ts:214`) converts into `"The assistant hit a problem. Try again?"`.

The failure is not transient. History only grows, so once a conversation crosses 40 rows with an
unlucky boundary, every subsequent turn in that conversation fails the same way.

**Fix:** walk backwards from the newest row and stop at a boundary where the next row is a `user`
or a tool-call-free `assistant` — i.e. slice by turn, not by count. Worth doing together with S2,
since both touch the same read path.

### S4 — No rate limiting anywhere in the app

No middleware, no per-IP or per-account counter, on any route. The four that matter:

- `POST /api/admin/login` (`src/routes/admin/auth.ts:10`) — a **single shared password** for the
  whole operator surface, with unlimited guesses. This is the most valuable credential in the
  system and the cheapest to attack.
- `POST /api/auth/login` (`src/routes/auth.ts:31`) — credential stuffing, and also a CPU
  denial-of-service: `Bun.password.verify` is deliberately slow, so unthrottled requests are a
  direct lever on the process.
- `POST /oauth/register` (`src/routes/oauth.ts:65`) — unauthenticated RFC 7591 dynamic client
  registration. Unbounded rows in `oauth_clients`; `registerClientSchema.redirect_uris`
  (`src/schemas/oauth.schema.ts:7`) has no array-length cap and no per-URI length cap, so a single
  request can store an arbitrarily large jsonb value.
- `POST /oauth/token` (`src/routes/oauth.ts:120`) — code and refresh-token guessing. Both are
  32 random bytes so guessing is not realistic, but the endpoint is still a free DB-read amplifier.

### S5 — `adminAuthService.login` uses a non-constant-time compare

`src/services/adminAuthService.ts:13` — `if (password !== env.ADMIN_PASSWORD)`. Timing leakage
across a network is marginal and largely masked by jitter, but `crypto.timingSafeEqual` on equal-
length buffers costs nothing and removes the question. Materially more relevant once S4 is fixed
and an attacker's remaining lever is timing rather than volume.

### S6 — Revoking a refresh token does not revoke live access tokens

Agent access tokens are stateless JWTs (`src/services/userService.ts:112`) with a 24-hour TTL, no
`jti`, and no denylist. `verifyAgentToken` checks the signature and the `actorType` claim and
nothing else.

There is also no revocation endpoint at all — `web/issues.md` records a "connected agents" view as
later work. So today "disconnect this agent" cannot be implemented at any layer: deleting the
`oauth_refresh_tokens` row stops future refreshes, but every already-issued access token keeps
working for up to 24 hours.

Cheapest containment without a redesign: store a `jti` per issued access token (or a
per-user `tokensValidAfter` timestamp) and check it in `verifyAgentToken`. That trades statelessness
for revocability, which is the right trade for a token that can spend money.

### S7 — No refresh-token reuse detection, and OAuth tables are never pruned

`src/services/oauthService.ts:287` (`refreshAccessToken`) rotates correctly — the conditional
`UPDATE … WHERE revokedAt IS NULL` means a replay loses deterministically. But a replay is also the
canonical signal that the token was stolen, and nothing acts on it: the rest of that client's
refresh chain stays valid, so a thief who gets there first keeps a working session while the
legitimate holder just sees one failure.

Standard handling is: on presentation of an already-revoked refresh token, revoke every token in
that family and force re-authorisation.

Separately, `oauth_codes`, `oauth_authorization_requests` and `oauth_refresh_tokens`
(`src/db/schema/oauth.ts`) have no cleanup job and no indexes beyond their primary keys. Expired
and consumed rows accumulate forever, and `refreshAccessToken`'s lookup is a PK hit but a
per-user/per-client listing (needed by the future "connected agents" view) would be a sequential
scan.

### S8 — `GET /api/oauth/authorize/:requestId` is unauthenticated

`src/routes/oauth.ts:90`. It returns `{requestId, clientName, scope}` to anyone who presents a
request id. The id is a v4 UUID so this is not enumerable in practice, and the consent page needs
to render before the human logs in — so this is arguably correct by design. Flagged because it is
the only OAuth endpoint returning state with no auth, and because the alternative (render after
login, fetch with the session JWT) is not much harder.

### S9 — `POST /api/cart/checkout/verify` is not bound to the calling user

`src/routes/cart.ts:78` verifies the Razorpay signature, then calls
`orderService.confirmPayment(razorpayOrderId, razorpayPaymentId)`. `confirmPayment`
(`src/services/orderService.ts:144`) finds the cart by `checkout_razorpay_order_id` and creates the
order against `cart.userId`. Nothing compares that to `c.get("userId")`.

Impact is genuinely low: the signature is an HMAC only Razorpay can produce, and the resulting
order still lands on the correct account, so this is not an order-theft path. But it means the
entire check rests on the signature alone, and the ownership assertion is one line. Worth adding on
principle, in a file whose whole job is money.

### S10 — A live-money test harness is on the production route table

`POST /api/reserve-pay/mandates/debit` (`src/routes/reserve-pay.ts:52`) charges the caller's Reserve
Pay block for an arbitrary amount and creates no order. Its own comment calls it a test harness.
Any authenticated user can call it. Nothing gates it behind an env flag or a non-production check.

### S11 — A tool handler reaches into the database directly

`src/agent-interfaces/tools/orders.ts:47` imports `db` and `orders` and runs its own select to
resolve an order number to an id. `CLAUDE.md`'s Service Layer Rules are explicit that
`/agent-interfaces` calls `/services` and never the reverse, and never the DB.

Harmless in isolation — it is a read, and `orderService.getOrderById` still does the ownership check
on the next line. It is the crack the rule exists to prevent: the obvious next step is a handler
that writes.

**Fix:** `orderService.getOrderByNumber(userId, orderNumber)`.

### S12 — `getOrCreateActiveCartId` has a lost-update race

`src/services/cartService.ts:13` selects, sees nothing, inserts. Two concurrent callers both see
nothing and both insert; `carts.user_id` is `.unique()` (`src/db/schema/carts.ts:29`), so the loser
throws a raw Postgres unique violation that nothing catches — it escapes to `app.onError` as a bare
500.

Every other insert-after-check in the codebase handles this (`reservePayService.createMandate`
catches `PG_UNIQUE_VIOLATION`, `chatService.resolveConversation` uses `onConflictDoNothing` and
re-reads). This one does not, and it is on the hottest path: `getOrCreateActiveCartId` is called by
every cart tool, `prepare_order`, `place_order`, `buildTurnContext`, and every REST cart route.

Newly reachable, too — the MCP surface has no client-side serialisation, so two parallel tool calls
from one agent hit it directly.

**Fix:** `onConflictDoNothing().returning()`, and re-read on empty — the same shape
`resolveConversation` already uses.

### S13 — `markStatus` silently clears `orderId`

`src/services/mandateService.ts:197` — `set({ status, orderId: orderId ?? null, … })`. Calling it
without an `orderId` nulls any existing one.

That column is what makes `place_order` idempotent: `checkout.ts:345` returns the already-created
order when `quote.status === "consumed" && quote.orderId`. Clearing it turns a safe retry into a
second charge.

Not reachable today — every `markStatus` call that omits `orderId` targets an `open` quote, which
has none. It is a loaded footgun for the next caller.

**Fix:** only include `orderId` in the patch when it is provided.

### S14 — `place_order` detects a quote/charge divergence and does nothing about it

`src/agent-interfaces/tools/checkout.ts:420` computes `totalMatchesQuote` and passes it to the audit
log. Nothing else reads it.

The underlying issue: `orderService.checkoutWithReservePay` re-derives its own snapshot from the
live cart at charge time (`orderService.ts:95`) and charges *that* total, not the total in the signed
quote the customer approved. The fingerprint check immediately above narrows the window to
sub-millisecond and same-user-only — the code comment says as much — but explicitly does not close
it.

So the failure mode is: the customer approves ₹247, the cart moves in the gap, and they are charged
something else. It is recorded and then allowed.

**Options:** pass the quoted total down and have `checkoutWithReservePay` refuse to charge anything
else; or keep re-deriving but abort when the two disagree.

### S15 — `place_order` does not pass the quote's `mandateId` down

Same call site (`checkout.ts:411`). `checkoutWithReservePay` → `reservePayService.prepareDebit`
re-resolves the mandate with `getLiveMandate` (`reservePayService.ts:432`).

The signed cart mandate names a specific `mandateId` — that link between the specific authority and
the general one is the point of the record. If the customer revokes their block and creates a new
one between `prepare_order` and `place_order`, the charge lands on a mandate the quote never
referenced, and the signature still verifies because `mandateId` is checked by nobody.

Narrow window, and the customer is the only one who can trigger it, but it is a signed-record
guarantee that is not actually enforced.

### S16 — MCP flattens away the structured tool error

`src/agent-interfaces/mcp/index.ts:22` turns `{code, message, retryable, hint}` into
`{isError: true, content: [{type: "text", text}]}`. The `code` and `retryable` fields never reach
the client.

The whole tool-error design exists so a caller can branch on the code — `partMapper.ts:112`
(`errorActions`) uses exactly that to decide that `payment_declined` must **never** offer a retry,
because the charge may have succeeded and only its proof is suspect. An MCP client gets a string
and has to guess.

**Fix:** also set `structuredContent` on the error path, carrying the `ToolError` verbatim. MCP
supports it on error results, and the field is already used on the success path one branch up.

### S17 — No webhook replay guard

`src/webhooks/razorpay.ts:129`. `verifyWebhookSignature` proves the body came from Razorpay; nothing
prevents the same signed body being replayed later.

Most handlers are naturally idempotent (`syncMandate` re-reads from Razorpay; `confirmPayment`
short-circuits on an existing order). `markDebitOutcome` (`reservePayService.ts:788`) is not — it is
an unconditional `UPDATE`, so a stale `payment.failed` redelivered after a successful capture will
flip a `captured` debit back to `failed`, corrupting the reconciliation ledger.

**Fix:** store the webhook event id and reject duplicates, or make `markDebitOutcome` refuse to move
a row out of a terminal state.

### S18 — `routes/mcp.ts` fabricates `AuthInfo.expiresAt`

`src/routes/mcp.ts:44` — `expiresAt: Math.floor(Date.now() / 1000) + 60`. The comment is honest
about it being request-scoped bookkeeping, but it is a made-up value unrelated to the token's real
`exp`. Harmless under `legacy: "stateless"`, where nothing outlives the request; wrong the moment
the transport mode changes. `verifyAgentToken` could return the decoded payload's `exp` instead of
just the `sub`.

---

## 2. Logic improvements

Discussion only — none of these are bugs.

### L1 — N+1 on every order listing

`orderService.listOrders` (`src/services/orderService.ts:289`) does one select for the order rows,
then `Promise.all(rows.map(getOrderWithItems))` — and `getOrderWithItems` runs **two** more queries
per order. `adminOrderService.listOrders` (`src/services/adminOrderService.ts:59`) does the same via
`withDetail`, with `pageSize` capped at 100 → up to 200 round trips for one page.
`adminDashboardService.summary` calls it for the recent-orders panel, so the dashboard inherits it.

One join with a `jsonb_agg` over items, or two queries total (orders, then all items for those
order ids), replaces all of it.

### L2 — Duplicate count query on product listing

`productService.listProducts` (`src/services/productService.ts:83`) runs the filtered query and a
second query that repeats the same join and where clause purely for `count(*)`. A
`count(*) over()` window on the first query returns both in one round trip. Same shape in
`adminProductService.list` and `adminUserService.listUsers`.

### L3 — Product search cannot use an index

`buildProductSearchCondition` (`src/services/productSearch.ts:27`) is
`ILIKE '%term%'` on `products.name`, OR'd with an `EXISTS (SELECT 1 FROM unnest(tags) …)`. Neither
side is indexable — a leading-wildcard `ILIKE` cannot use a btree, and the `unnest` subquery
defeats the GIN index that `tags` would otherwise support.

Every search is a sequential scan over the products table, on the single hottest path both the chat
agent and MCP callers take. Fine at 58 products; the first thing to fall over on a real catalog.

**Contained fix:** `pg_trgm` GIN index on `name` (which also buys typo tolerance), and rewrite the
tag clause to `tags && ARRAY[...]` so a plain GIN on `tags` applies. The file's own doc comment
already anticipates this.

### L4 — Missing indexes

Indexed today: `conversations(user_id, updated_at)`, `chat_messages(conversation_id, created_at)`,
the partial uniques on `reserve_pay_mandates` and `cart_mandates`, and the various `.unique()`
columns.

Not indexed, despite being queried by exactly these columns:

- `orders.user_id` — `listOrders`, `getOrderById`, admin filtering.
- `cart_mandates.user_id` — `getOpenCartMandate`, called on every chat turn.
- `oauth_refresh_tokens.user_id` / `client_id` — needed by any revocation or "connected agents" view.
- `audit_log` — **no index at all.** This is the table the entire audit story depends on being
  queryable, and there is no way to fetch one actor's rows, or one action's, without a full scan.

### L5 — `syncMandate` is called far more often than it needs to be

`reservePayService.syncMandate` costs up to two Razorpay round trips (`fetchPayment` +
`fetchCustomerToken`). It is called from `createMandate` (via `releaseAbandonedMandate`),
`getMandate`, `prepare_order` (via `mandateView`), `get_payment_status`, `check_reserve_pay_status`,
`prepareDebit`, and four webhook branches. A single checkout conversation can hit Razorpay six or
more times.

A short freshness window (skip the sync if the row was synced in the last N seconds) would cut most
of that without weakening any guarantee: the actual correctness point is `prepareDebit`'s
conditional `UPDATE` (`reservePayService.ts:450`), which re-checks the balance atomically in the
database regardless of how fresh the sync was. `check_reserve_pay_status` would opt out of the
window, since polling is its whole purpose.

### L6 — `sort: "newest"` does not sort by age

`productService.ts:73` — the `newest` branch orders by whether the product carries the `new` tag.
`products` has no `created_at` column; `adminProductService.ts:89` comments on the same gap and
falls back to `archivedAt` desc.

Either add `created_at` (cheap, and it makes the admin sort honest too) or rename the option to
what it does.

### L7 — Multi-tag search is AND, which almost always returns nothing

`productService.ts:51` uses `arrayContains(products.tags, filters.tag)` — Postgres `@>`, meaning the
product must carry **all** listed tags. The schema documents this
(`agent-tool.schema.ts:43`), so it is deliberate.

But a model asked for "organic bestsellers" will naturally pass `["organic", "bestseller"]` and get
an empty result, then have no way to tell an empty catalog from an over-constrained query. Either
switch to overlap (`&&`) to match the `category` field's ANY semantics, or add an explicit
`tagMode: "any" | "all"`.

### L8 — `nextPartId` uses a module-global counter

`src/chat/partMapper.ts:38-42`. The random 5-character suffix makes collisions effectively
impossible, so this is not a bug — but a counter shared across every concurrent request in the
process is a thing a reader has to stop and reason about. A per-turn counter, or plain
`crypto.randomUUID()`, removes the question.

### L9 — `list_orders` fetches everything then slices

`src/agent-interfaces/tools/orders.ts:24` calls `orderService.listOrders` (which has no limit and
hydrates every order — see L1) and slices to `input.limit` afterwards. Its own comment flags this.
Push the limit into the service.

### L10 — `ForbiddenError` is exported and never constructed

`src/errors/index.ts:23`. `registry.mapError` has a live `case "FORBIDDEN"`, so the handling exists
for an error nothing throws. Either something should be throwing it (address/order ownership
failures currently answer `NotFoundError` deliberately, for anti-probing) or both halves can go.
Left in place during the cleanup pass because the hierarchy is meant to be complete.

---

## 3. Agentic workflow — accuracy improvements

Ordered by expected accuracy gain per unit of effort.

### A1 — `search_products_nl` is exposed to the chat model

`chatService.ts:279` builds the tool list with `toOpenAITools((tool) => tool.name !== "place_order")`
— the only tool it filters. So `search_products_nl` is offered to the chat agent, which is itself an
LLM.

That means the chat model can call a tool whose entire job is to spend a *second* LLM call turning
free text into structured filters — filters the chat model could have produced itself in the same
turn, for free, by calling `search_products` directly. It costs an extra round trip, adds a second
failure mode (see A4), and introduces the possibility of two models disagreeing about one query.

The tool was built for MCP callers with no LLM of their own. It should be MCP-only.

**Fix:** either extend the `chatService` filter, or add a `surfaces: ("chat" | "mcp")[]` field to
`ToolDefinition` so the split is declared on the tool rather than encoded in a filter predicate that
already carries an unrelated safety meaning.

### A2 — The filter-builder only sees category *slugs*

`searchAssistService.buildSearchFiltersFromText` (`src/services/searchAssistService.ts:9`) fetches
full category rows and then passes `categories.map(c => c.slug)` — slugs only — into
`buildSearchFilters`, which drops them into the system prompt as a bare comma-separated list
(`src/llm/searchQueryBuilder.ts:26`).

So the model has to map "milk" → `dairy-eggs` from the slug string alone. It works when the slug
happens to contain the noun and degrades sharply when it does not.

The category rows already carry `name` and `description`, already fetched, already in memory.
Passing `slug — name — description` triples instead is a one-line change with a large expected
return, and it is the highest accuracy-per-effort item in this document.

### A3 — Nothing retries when a search returns zero results

Both `search_products` (`catalog.ts:17`) and `search_products_nl` (`catalog.ts:54`) return
`{products: [], total: 0, hasMore: false}` and stop. The chat model can notice and try again, at the
cost of a full round trip; an MCP caller may not.

A cheap in-handler retry ladder — drop price bounds, then drop tags, then drop category, then fall
back to keyword — would raise recall substantially for a few milliseconds of extra database work,
and would let the tool report *what* it relaxed so the caller can say so.

### A4 — The `{}` fallback degrades into a query that cannot succeed

`buildSearchFilters` returns `{}` on any failure (`searchQueryBuilder.ts:71`) — a deliberate
graceful degradation. But `search_products_nl` then does
`q: filters.category || filters.tag ? "" : input.query` (`catalog.ts:67`), so with no filters it
passes the customer's whole sentence into an `ILIKE '%…%'` substring match on product names.

"something sweet and cold for a party" cannot match any product name. The degradation is not
graceful; it is a guaranteed miss dressed as a normal empty result, and the caller has no way to
tell it apart from a genuinely empty catalog.

**Better:** when no filters were derived, either extract nouns and search those, or return an
explicit failure carrying a hint pointing at `list_categories` — the same recovery route the
`search_products` description already recommends for vague requests.

### A5 — The semantic gap is the root cause, and A2–A4 are all mitigations

Search matches product names and tags, never descriptions, and only by substring
(`productSearch.ts`). "I want to buy milk" works only because some product is literally named
"…Milk". "Something for breakfast" cannot work at any level of prompt engineering.

Two real fixes, both affordable:

- **`pg_trgm` + Postgres full-text search** — buys stemming ("tomatoes" → "tomato"), typo tolerance,
  and ranked results. Contained, no new infrastructure, also fixes L3.
- **An embedding index** over `name + category + tags + description` — buys actual semantic
  matching. For 58 products this is a single table with a `vector` column and one batch job; the
  catalog is small enough that even a brute-force cosine scan in Postgres would be fast.

`productSearch.ts` is already isolated behind one function specifically so this can be swapped
without touching `productService` or any tool. That was the right call and the swap point is ready.

### A6 — `temperature: 0.3` in a tool-calling loop

`src/llm/agentLoop.ts:66`. Tool-argument accuracy wants 0 — there is no upside to sampling noise in
a UUID, a slot id, or a category slug, and the arguments are where accuracy actually matters. The
prose quality argument for non-zero temperature is weak here because the system prompt already
constrains output to one or two short sentences.

Note `searchQueryBuilder` already uses `temperature: 0` for exactly this reason.

### A7 — `MAX_ROUNDS = 8` with sequential tool calls is tight for checkout

`agentLoop.ts:19` caps at 8 rounds; `parallelToolCalls: false` (`agentLoop.ts:65`) means one tool per
round. A cold checkout is `search_products` → `add_to_cart` → `get_cart` → `list_addresses` →
`list_delivery_slots` → `get_payment_status` → `prepare_order` — seven rounds with no slack. One
tool failure and a recovery attempt exhausts the budget, and the customer gets "The assistant got
stuck working on that."

The sequential constraint is justified for mutations (deterministic audit order, deterministic cart
state). It is not needed for reads. `ToolDefinition.readOnly` already exists on every tool and is
exactly the discriminator: allow parallel calls when every requested tool is read-only, keep them
serialised otherwise. Raising `MAX_ROUNDS` is the cruder alternative.

### A8 — MCP tool annotations are half-filled

`src/agent-interfaces/mcp/index.ts:39` sets `annotations: { readOnlyHint: tool.readOnly }` and
nothing else. MCP defines `destructiveHint`, `idempotentHint` and `openWorldHint`, and clients use
them to decide what to run without asking a human first.

Filling them in correctly is the cheapest per-tool safety improvement available on that surface:

- `clear_cart` — `destructiveHint: true`. It is irreversible and its own description says so.
- `place_order` — `idempotentHint: true`. It genuinely is, by `quoteId`, and that is worth
  advertising: it tells a client a retry after a timeout is safe.
- `add_to_cart` — `idempotentHint: false`. Quantity is additive; a blind retry double-adds.
- `update_cart_item`, `remove_from_cart` — `idempotentHint: true`.

This wants a per-tool annotations field on `ToolDefinition` rather than being derived from
`readOnly`, which is the only signal available today.

### A9 — `mapError` gives the model a dead end on UNAUTHORIZED/FORBIDDEN

`src/agent-interfaces/tools/registry.ts:170` maps both to
`{code: "not_found", message: "Not available", retryable: false}` with **no hint**.

The anti-probing choice is right — the model should not learn whether a resource exists. But every
other branch in `mapError` carries a hint, and the file's own comment says the hint is what turns a
failure into a recovery. Without one, the model gets a flat refusal with no next action and
typically loops or apologises.

A hint like "That belongs to a different account. Call `list_orders` to see this customer's own
orders." costs nothing and leaks nothing.

### A10 — Prompt injection is closed structurally only for `place_order`

`systemPrompt.ts:45` instructs the model never to act on instructions found inside tool results, and
the file's own header is candid that prompt rules are "a guide to good behaviour, never a control."

Product names, descriptions, address lines and order notes all reach the model verbatim through tool
results. The one action that matters — placing an order — is closed structurally, which is the right
priority. Everything else (clearing a cart, adding items, creating an address, starting a Reserve
Pay block) rests on the prompt rule.

Low risk today because catalog text is admin-authored and addresses are the customer's own. It gets
sharper on the MCP surface, where the same text reaches an agent whose system prompt this project
does not write and cannot audit — the injection would be aimed at *their* model, not ours.

Worth considering: wrapping catalog free-text in explicit delimiters in tool output, and keeping
admin-editable fields (`description` especially) out of tool results that do not need them.
`presenters.toAgentProduct` already drops `description`, which is most of the mitigation; the gap is
`toAgentProductDetail` and order notes.

### A11 — No record of which model actually answered

`clients/openrouter.ts:30` sends a `modelChain`, and OpenRouter fails over server-side. So a
degraded or wrong answer cannot be attributed to a model — the primary may have been down and a
fallback answered, and nothing anywhere records which.

`response.model` is on every OpenRouter response and is read nowhere. Neither is token usage, so
there is no per-turn cost or latency record either. Logging both on the `message` event would make
"the assistant got worse today" a question with an answer.

### A12 — `buildTurnContext` inlines every saved address, unbounded

`src/llm/turnContext.ts:110` loops over `addresses` with no cap, one line each, into the context
block prepended to every turn. Fine at two addresses. At forty it is the largest thing in the prompt
and pushes conversation history out of the window — which degrades exactly the thing the context
block exists to improve.

Cap it (default first, then most recent N) and tell the model to call `list_addresses` for the rest,
mirroring the treatment cart line items already get in the same file.
