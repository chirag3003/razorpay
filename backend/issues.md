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
