# Known gaps found while integrating `web/`

## Blocked: UPI Reserve Pay needs Razorpay account activation

The Reserve Pay rail (`API.md` §6.11) is implemented and typechecks, but **cannot be exercised
end to end on the current test account**. `POST /v1/payments/create/json` — Razorpay's
server-to-server payment API, which both the authorisation payment and every debit go through —
answers:

```
400 BAD_REQUEST_ERROR
"The requested URL was not found on the server."   source: "internal"
```

Verified with direct `curl` against the account keys, not just through our code:

- `POST /v1/customers` → **200**
- `POST /v1/orders` with `token.type: single_block_multiple_debit` → **200** (SBMD orders are fine)
- `POST /v1/payments/create/json` with the SBMD authorisation body → **400**, URL not found
- `POST /v1/payments/create/json` with a plain non-recurring UPI collect body → **400**, same

The last probe is the decisive one: the endpoint is unavailable for *any* payment, recurring or
not, so this is account entitlement, not our payload and not an SBMD-specific problem.

**To unblock:** raise a request with Razorpay support to enable, on this account:
1. the **S2S JSON API** (`/payments/create/json`) — this is the actual blocker
2. **UPI Reserve Pay (SBMD)**
3. **`save_vpa`** — the docs note UPI tokens are omitted from token responses without it

Until then `POST /api/reserve-pay/mandates` returns `502 PAYMENT_GATEWAY_ERROR` carrying
Razorpay's description verbatim, and no mandate can reach `confirmed`. Everything that does not
need the gateway is verified working: validation, the guard chain and its error codes, the
one-live-mandate-per-user index, abandoned-mandate expiry, audit rows, and the webhook router.

### Re-probed 2026-09-02 — UPI is enabled now, the S2S API is still not

Checked again after UPI was reported enabled on the account. **UPI is on; the actual blocker is
unchanged.** `GET /v1/methods` for this key now reports `upi: true`, `upi_intent: true`,
`recurring.upi: true`, and lists `recurring.upi_autopay` — so item 2 below looks satisfied.

But every S2S payment-creation route is still absent for this account:

| Call | Result |
|---|---|
| `POST /v1/payments/create/json` (SBMD auth body) | **400** "The requested URL was not found on the server." |
| `POST /v1/payments/create/json` (plain UPI collect) | **400** same |
| `POST /v1/payments/create/upi` | **400** same |
| `POST /v1/payments/validate/vpa` | **400** same |
| `POST /v1/customers` | 200 |
| `POST /v1/orders` with `token.type: single_block_multiple_debit` | 200 |
| `GET /v1/payments` | 200 |
| `POST /v1/tokens` | 400 "The card field is required." — route exists, body validated |
| `POST /v1/payments/create/ajax` | 401 "Authentication failed" |

The last two rows are what make this conclusive. The same credentials that 404 on
`create/json` reach `/tokens` and `/payments` fine, and `create/ajax` answers **401**, not 404 —
so the 404s are route-level entitlement, not authentication and not our payload. Enabling UPI as
a *payment method* does not enable the *server-to-server API* used to initiate one; they are
separate entitlements and only the second one blocks us.

**Still outstanding with Razorpay support:** the **S2S JSON API** (`/payments/create/json`) —
and `save_vpa`, whose sibling endpoint `/payments/validate/vpa` is 404 for the same reason.

### Narrowed further: `/payments/create/recurring` works, `/payments/create/json` does not

Probing the SDK's `razorpay.payments.createRecurringPayment` turned up a second endpoint we had
never tried, and it is **provisioned on both the test and live keys**:

| Same request body, two endpoints | Response | `source` |
|---|---|---|
| `POST /payments/create/recurring` | `"No db records found."` — it looked the token up | `business` |
| `POST /payments/create/json` | `"The requested URL was not found on the server."` | `internal` |

`create/recurring` does real per-field validation (`"contact: cannot be blank"`), real id-format
validation (`"BOGUS1234567 is not a valid id"`), and then a token lookup. It returns exactly the
`{razorpay_payment_id, razorpay_order_id, razorpay_signature}` shape `createReservePayDebitPayment`
already expects, so `verifyPaymentSignature` needs no change.

**So the debit half of the rail has a working endpoint.** The authorisation half does not: sent
with no `token` and `upi.flow: intent`, `create/recurring` falls back to the same
`"URL not found"`, because Razorpay routes an initial recurring payment to the unprovisioned S2S
JSON handler. No authorisation means no token, so the working debit endpoint has nothing to spend
and the rail stays blocked end to end.

**Follow-up, deliberately not done yet:** switch `createReservePayDebitPayment` from
`/payments/create/json` to `/payments/create/recurring`. It is a one-line change and the endpoint
is verified reachable, but it cannot be tested until authorisation works, so it is recorded here
rather than applied blind.

## Reserve Pay simulator (`RESERVE_PAY_SIM`)

Because the authorisation endpoint is unreachable, the rail is served in demo mode by a local
simulator: `services/reservePayGateway.ts` picks `paymentService` (real) or
`reservePaySimService` (simulated) from one env flag, and `reservePayService` — every guard,
reservation, audit write and status mapping — is unchanged either way.

```
RESERVE_PAY_SIM=true bun run dev        # test keys only; boot refuses against rzp_live_
```

Both signatures stay real: the simulated debit is HMAC-signed with `RAZORPAY_KEY_SECRET` so
`verifyPaymentSignature` genuinely passes, and replayed webhooks are signed with
`RAZORPAY_WEBHOOK_SECRET` so `verifyWebhookSignature` does too. Simulated ids all carry a `_sim_`
segment. State lives in `sim_tokens` / `sim_payments`, which act as the pretend gateway that
`syncMandate` reconciles against.

Controls, all scoped to the caller's own mandate: `POST /api/reserve-pay/sim/approve` (skip the
approval wait), `POST|DELETE /api/reserve-pay/sim/debit-failure` (arm a one-shot decline),
`POST /api/reserve-pay/sim/token-status` (drive the gateway-side status; the mandate then moves
through the real `syncMandate`), `GET /api/reserve-pay/sim/state`.

**Switching back** when Razorpay grants S2S access: drop `RESERVE_PAY_SIM`. Nothing else changes
— no real Razorpay call was removed or edited to build this.

End-to-end behaviour is unchanged and correct: `POST /api/reserve-pay/mandates` returns
`502 PAYMENT_GATEWAY_ERROR` with Razorpay's description verbatim, and the mandate row lands in
`failed` rather than being left orphaned as `pending` — `GET /mandates/current` returns
`{"mandate": null}` afterwards, so the slot is released and the next attempt is unblocked.

## ~~Bug: "what's in my cart" answered in text, never the cart widget~~ — resolved

Found during frontend integration testing: asking the chat "What is in my cart?" got a plain-text
reply ("Your cart has one item: Toned Milk, 1 L packet, at ₹58...") instead of the `cart_summary`
widget the frontend renders for exactly this.

**Root cause:** `llm/turnContext.ts`'s `buildTurnContext()` rebuilds a `CURRENT CONTEXT` block from
Postgres every turn, and it included the full itemized cart (name, qty, price, itemId per line) as
a latency shortcut. `systemPrompt.ts` told the model not to call a tool "just to re-read something
it already tells you" — so the model answered straight from that context text. The
`cart_summary` widget is only ever produced (`chat/partMapper.ts`, `toolResultToPart`) when
`get_cart` (or another cart-mutating tool) actually runs, so a context-only answer never rendered
one. This was also a freshness gap, not just a UX one: `CURRENT CONTEXT` is a snapshot taken once
at the top of the turn, so a multi-round turn or an out-of-band cart change elsewhere could leave
the model reciting stale numbers instead of re-checking the DB.

**Fix:** `buildTurnContext()` now only puts the aggregate line (item count, subtotal, delivery,
total) in context — no per-item breakdown, no itemIds. `systemPrompt.ts` now explicitly carves out
an exception to the "don't re-read what context tells you" rule for cart line items, and adds a
"never describe cart contents from memory — always call get_cart" rule alongside the existing
never-state-an-unverified-price rule. With item-level detail and itemIds gone from context, the
model has no path to answer a cart-contents question, or to call `update_cart_item`/
`remove_from_cart` (both require an itemId "from get_cart" per their own tool descriptions), other
than calling `get_cart` — which is also what renders the widget and guarantees the numbers are
this instant's DB truth, not a snapshot from the top of the turn.

## ~~Missing: profile update endpoint~~ — resolved

`PATCH /api/auth/me` is implemented (`src/routes/auth.ts`, `userService.updateUser`), matching
the spec below exactly, and documented in `API.md` §6.3a. Verified: partial update, `GET
/api/auth/me` reflects the change, malformed email returns the standard Zod `400`, email
collision with another account returns `409 CONFLICT`, and the route is 401 without a token.

<details>
<summary>Original spec</summary>

`PATCH /api/auth/me`

- Auth required (same `requireAuth` middleware as the rest of `/api/auth/me`, `/api/addresses*`, etc).
- Body: any subset of `{ name: string; email: string; phone: string }` (all optional, at least one
  expected — mirror the partial-update convention already used by `PATCH /api/addresses/:id`).
- On success: `200 { "user": User }` (same `User` shape as signup/login/`GET /api/auth/me`).
- On email collision with another user's account: `409 { "error": "...", "code": "CONFLICT" }`
  (same convention as signup).
- Validation errors (e.g. malformed email): standard Zod `400` shape per `API.md` §3.

Implementation should follow the existing service-layer convention in `backend/CLAUDE.md` —
add the update logic to `userService.ts`, keep the route handler in `routes/auth.ts` thin.

</details>
