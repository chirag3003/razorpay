# Errors this system handles gracefully

A reference for what already fails *well* — kept separate from `issues.md`, which tracks what
doesn't. Every entry names the file so a reader can check the claim rather than take it on trust.

The through-line: a failure should either be recoverable by whoever hit it, or recorded somewhere
that makes it reconcilable later. Nothing is allowed to reach a client as a stack trace, and
nothing that moves money is allowed to disappear.

---

## 1. Typed domain errors, mapped in one place

`errors/DomainError.ts` defines a base carrying `statusCode` and `code`; `errors/index.ts` defines
the concrete set.

| Class | HTTP | `code` |
|---|---|---|
| `NotFoundError` | 404 | `NOT_FOUND` |
| `UnauthorizedError` | 401 | `UNAUTHORIZED` |
| `ForbiddenError` | 403 | `FORBIDDEN` |
| `ConflictError` | 409 | `CONFLICT` |
| `EmptyCartError` | 400 | `EMPTY_CART` |
| `InvalidAddressError` | 400 | `INVALID_ADDRESS` |
| `PaymentVerificationError` | 400 | `PAYMENT_VERIFICATION_FAILED` |
| `PaymentGatewayError` | 502 | `PAYMENT_GATEWAY_ERROR` |
| `MandateNotActiveError` | 409 | `MANDATE_NOT_ACTIVE` |
| `MandateExpiredError` | 409 | `MANDATE_EXPIRED` |
| `MandateAmountExceededError` | 400 | `MANDATE_AMOUNT_EXCEEDED` |
| `InsufficientBalanceError` | **402** | `INSUFFICIENT_BLOCKED_BALANCE` |

`InsufficientBalanceError` is 402 rather than 400 on purpose: the request is well-formed, the
funds simply are not there. `MandateAmountExceededError` is kept distinct from it because the
caller's fix differs — a smaller debit, not a new mandate.

**One mapping site.** `server.ts:72` (`app.onError`) turns any `DomainError` into
`{error, code}` at its own status, and everything else into a generic
`{error: "Internal server error", code: "INTERNAL_ERROR"}` 500 after logging it server-side. No
stack trace, no raw Postgres error, and no raw Razorpay error reaches a client from any route.

## 2. Postgres error codes are unwrapped correctly

drizzle-orm v1 wraps driver errors in a `DrizzleQueryError` and hangs pg's `DatabaseError` — the
object actually carrying `code` — off `.cause`, so reading `err.code` always yields `undefined`.
That failure is silent: the `catch` branch simply never matches and a handled constraint violation
escapes as a 500.

`utils/db-error.ts` exists for this. `pgErrorCode(err)` walks the `.cause` chain, and
`PG_UNIQUE_VIOLATION` / `PG_FOREIGN_KEY_VIOLATION` are the constants to compare against. Used at
every site that catches a constraint violation: `orderService.ts:190`, `mandateService.ts`,
`reservePayService.ts:167`, `adminProductService.ts`, `adminCategoryService.ts`.

**Never read `err.code` directly.**

## 3. Money paths

**Order creation is idempotent two ways.** `orderService.confirmPayment` (`orderService.ts:129`)
first short-circuits if an order already exists for the Razorpay order id; if it loses a race with
the `payment.captured` webhook it catches the unique violation on `orders.razorpay_order_id`
(`orderService.ts:190`) and returns whichever writer won.

**`place_order` is idempotent on `quoteId`.** A consumed cart mandate records the order it
produced, so a retried call returns that order with `alreadyPlaced: true`
(`agent-interfaces/tools/checkout.ts:456`) instead of buying the cart twice.

**A quote is invalidated when the cart moves under it.** `place_order` re-derives the cart
fingerprint immediately before charging and compares it to the quote's
(`tools/checkout.ts:490-503`), so a changed basket fails with `cart_changed` rather than being
charged. The quote is HMAC-signed, and the fingerprint is recomputed from the signed snapshot
rather than read from its own column — a rewritten row cannot pass both checks.

**The checkout snapshot is written before any money moves.**
`orderService.checkoutWithReservePay` stashes it on the cart *then* charges, because that snapshot
is what the `payment.captured` webhook rebuilds the order from if the process dies mid-charge.
Stashing after would leave one unrecoverable window — money taken, no order, nothing to
reconstruct from. On a failed debit it clears the stash, so the next `payment.failed` cannot wipe
an unrelated checkout.

**A debit whose signature fails verification does not release the reservation.**
`reservePayService.ts:609` — the charge may have succeeded with only its proof suspect, so the
funds stay held and `syncMandate` reconciles on the next read. Failing toward *not losing money*
is the deliberate choice.

**A gateway rejection is a row, not an exception.** Every debit attempt writes a
`reserve_pay_debits` row carrying the error code and description, successful or not. That table is
the reconciliation ledger against Razorpay.

**The one-live-mandate slot is claimed atomically.** `reservePayService.createMandate`
(`reservePayService.ts:112`) inserts the row *before* calling Razorpay, so a lost race fails
before any funds are blocked, backed by the partial unique index
`reserve_pay_mandates_one_live_per_user`. A mandate abandoned mid-approval is expired after
`RESERVE_PAY_PENDING_TTL_MINUTES` by `releaseAbandonedMandate`, so closing the UPI app does not
lock the slot forever.

## 4. Webhooks

`webhooks/razorpay.ts` wraps the whole event dispatch in try/catch and **always returns 200**
(`:166`). Razorpay retries any non-2xx, so an unhandled throw becomes an infinite redelivery loop;
the error is logged instead.

`confirmIfCheckoutPending` (`webhooks/razorpay.ts:69-76`) swallows exactly one thing — a
`NOT_FOUND`, which just means the payment was created outside our checkout flow (a dashboard
payment) — and rethrows everything else, so genuine bugs still surface in the log rather than
being silently eaten by the always-200 rule above.

**Replay is safe on every branch.** `verifyWebhookSignature` proves a body came from Razorpay but
nothing stops the same signed body being redelivered. Most handlers are naturally idempotent —
`syncMandate` re-reads from the gateway, `confirmPayment` short-circuits on an existing order.
`markDebitOutcome` (`services/reservePayService.ts`) is the one that was not, being an
unconditional `UPDATE`; it is now a state machine (`DEBIT_STATUS_TRANSITIONS`) that permits
`created -> captured|failed` and `failed -> captured` and **refuses `captured -> failed`**, so a
stale `payment.failed` redelivered after a successful capture cannot flip the reconciliation
ledger back. A refused transition logs a WARN and returns normally — a redelivery is not an error,
but a refused `captured -> failed` is also what an ordering bug would look like, so it leaves a
trace.

## 5. Agent and LLM layer

**`runTool` never throws** (`agent-interfaces/tools/registry.ts:202`). A model cannot catch an
exception, so every failure becomes data: `{ok: false, error}`.

**Every error carries a recovery route.** `mapError` (`registry.ts:47`) translates each domain code
into `{code, message, retryable, hint}`. `hint` is the load-bearing field — it tells the model what
to do next, which is what turns a failure into a recovery rather than a stall. Unmapped errors are
deliberately generic to the model while the real error and its top stack frame are logged
server-side.

**The loop is bounded.** `MAX_ROUNDS = 8` (`llm/agentLoop.ts:17`) caps a runaway tool loop and logs
a warning when hit (`agentLoop.ts:216`) rather than truncating silently.

**Malformed tool-call JSON is recoverable, not fatal.** A truncated stream producing unparseable
arguments is handled as a tool failure the model can retry, not an exception.

**Aborting genuinely stops the spend.** `routes/chat.ts` passes `c.req.raw.signal` into
`runChatTurn`, which passes it to `runAgentTurn`, which passes it to OpenRouter's `fetchOptions`
(`agentLoop.ts:66`). Closing the chat panel stops token billing mid-stream, and nothing from the
partial turn is persisted.

**A mid-stream failure stays well-formed.** SSE headers are already sent by then, so an exception
cannot become a 4xx/5xx. `routes/chat.ts` emits an `error` frame instead, and the panel renders a
retryable failure rather than hanging on a dead stream.

## 6. Swallows that are deliberate

Both are commented at the site, and both follow the same rule: never turn a bookkeeping failure
into a user-facing failure after the user already got what they asked for.

- **Persisting a chat turn** (`chatService.ts:251-253`, `:379-383`) — logged and swallowed. The
  customer already has their answer and any order placed is real; only the transcript write is
  best-effort.
- **Reading the balance after a successful charge**
  (`agent-interfaces/tools/checkout.ts:63`, `remainingAfterCharge`) — returns `0` rather than
  throwing, so a failed follow-up read cannot turn a completed order into a reported failure.

**Conversation creation is bounded.** `chatService.resolveConversation` accepts a client-supplied
`conversationId` with `createIfMissing`, and also mints one when the client sends none — both are
client-driven, so both check `MAX_CONVERSATIONS_PER_USER` first and answer
`409 CONFLICT` rather than letting one account fill the `conversations` table.

**Over-size request bodies** are refused before any handler sees them.
`hono/body-limit` runs globally in `server.ts` at `MAX_REQUEST_BODY_BYTES` (256 KB), after the
request logger — so an over-size request still produces one `http` log line — and answers
`413 {error, code: "PAYLOAD_TOO_LARGE"}` in the same shape `onError` produces for a `DomainError`.
It sits above the unauthenticated routes (`/api/auth/*`, `/oauth/register`, `/oauth/token`,
`/webhooks/razorpay`), and the webhook's raw-body signature read (`c.req.text()`) still works
underneath it.

## 7. Anti-probing

Failures are shaped so a caller learns nothing from them.

- Another user's order, address or conversation answers **404, not 403** — uniformly, across REST
  routes and agent tools alike. `resolveConversation` documents this explicitly.
- `verifyCredentials` returns one `"Invalid email or password"` for both an unknown email and a
  wrong password, and takes the **same time** either way: the miss path runs `Bun.password.verify`
  against a dummy argon2 hash computed once at module load, so a returning-early miss no longer
  answers in ~0ms while a hit pays for a full verify. Identical text with distinguishable timing
  is still enumeration.
  *Not yet closed on the signup side:* `createUser` still throws
  `"An account with this email already exists"`, which leaks the same fact directly. It is left
  alone deliberately — a non-enumerating signup and a non-enumerating forgot-password want the
  same treatment, and the password-reset work is `issues.md` P2.
- `GET /api/reserve-pay/approval/:token` returns one 404 for unknown, expired and abandoned links
  alike, so someone holding a guess cannot tell which.

## 8. Frontend

- **`lib/api/client.ts`** separates transport failure from HTTP failure: a dead server, DNS
  failure or offline client becomes `NETWORK_ERROR` (`:138`) rather than an unhandled rejection,
  and the backend's Zod error envelope is parsed into per-field errors (`:71`). `isNetworkError` /
  `isServerError` let call sites branch without re-parsing.
- **A network blip does not log you out.** `auth-store.hydrateFromServer` (`store/auth-store.ts:53`)
  distinguishes "the token is genuinely invalid" (clear the session) from "the server is
  unreachable" (keep the session, expose a retryable `status: "error"`), which `RequireAuth`
  renders as a retry instead of bouncing an already-logged-in user to `/login`.
- **The SSE parser is defensive.** `lib/chat/sse-transport.ts` buffers partial chunks across reads
  (`:62-73`), skips malformed frames without killing the stream, flushes a trailing unterminated
  line (`:82`), and swallows `AbortError` so a cancelled turn is not reported as a failure.
- **`app/global-error.tsx`** is self-contained inline-styled HTML, because it replaces the root
  layout when a render error escapes it — it cannot rely on the theme provider or fonts.
- **No flash of protected content.** `auth-store` deliberately does not persist `status` (only
  `user` and `token`, `:78`), so both the server render and the first client render start at
  `idle` and the guards show a spinner until hydration resolves — avoiding both a hydration
  mismatch and a content flash.
- **Admin failures funnel through one handler** (`store/admin-auth-store.ts`), where a 401 tears
  the session down and anything else is left retryable with the token kept.

## 9. Configuration and the simulator

- **`config/env.ts` validates every environment variable at boot** and exits with a per-field
  message. A missing `RAZORPAY_KEY_SECRET` crashes startup instead of surfacing as a mysterious
  500 three requests in.
- **The simulator refuses to run against live credentials.** `RESERVE_PAY_SIM` paired with an
  `rzp_live_` key exits at boot: reporting a debit as captured without moving money is a lie about
  real funds.
- **The simulator does not fake the things that matter.** Simulated debits are HMAC-signed with
  the real `RAZORPAY_KEY_SECRET` so `verifyPaymentSignature` genuinely passes, and replayed
  webhooks are signed with the real `RAZORPAY_WEBHOOK_SECRET` so `verifyWebhookSignature` does
  too. Every simulated id carries a `_sim_` segment so it can never be mistaken for a real one in
  a log or an audit row.
- **The `/sim/*` control routes are not registered at all outside sim mode**
  (`routes/reserve-pay.ts`) — a control that can move a mandate's status should not exist as a
  route in a real deployment, rather than existing and being guarded.

---

## Keeping this list true

- A new `DomainError` subclass goes in the table in §1, with its status and code.
- A new deliberate swallow goes in §6, with the reason it is safe — an uncommented swallow that
  isn't listed here should be read as a bug.
- A new money-moving path states, here, what happens when it fails halfway: what is recorded, and
  what reconciles it.
