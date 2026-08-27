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
