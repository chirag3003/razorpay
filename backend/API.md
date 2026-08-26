# Backend API Reference

This is the integration contract for `backend/`. It exists so a frontend engineer (human or AI
agent) can wire up `web/` — or any other client — **without reading backend source**. If something
here ever disagrees with the code, the code wins; but if you find a mismatch, fix this file in the
same change.

Out of scope / not built yet: agent tokens, mandates, Reserve Pay, A2A/MCP. Everything below is
plain session-auth REST for a human storefront. See `backend/CLAUDE.md` if you're changing backend
code, not just calling it.

---

## 1. Base URL & running the server

- Dev: `http://localhost:4000` (or whatever `PORT` is set to in `backend/.env`).
- Every route below is prefixed with `/api` **except** the webhook (`/webhooks/razorpay`, not
  called by the frontend) and the health check (`GET /` → `{"status":"ok"}`).
- All request/response bodies are JSON. Send `Content-Type: application/json` on every request
  with a body.
- CORS is locked to a single origin via the `CORS_ORIGIN` env var (default
  `http://localhost:3000`). If the frontend runs on a different origin/port, `CORS_ORIGIN` in
  `backend/.env` must be updated to match, or every request will fail CORS with no JSON error body.
- To actually run it: see `backend/CLAUDE.md` → "Scripts" section (`bun run dev`, migrations,
  seeding). It won't boot without real `RAZORPAY_KEY_ID`/`RAZORPAY_KEY_SECRET`/
  `RAZORPAY_WEBHOOK_SECRET` in `.env` — env is validated at startup and the process exits if
  anything is missing.

---

## 2. Auth

Stateless JWT bearer tokens, 7-day expiry, no refresh endpoint (the client just needs to re-login
after expiry — log the user out on a `401` from any authenticated route).

1. `POST /api/auth/signup` or `POST /api/auth/login` returns `{ user, token }`.
2. Store `token` client-side (e.g. localStorage) and send it on every authenticated request:
   ```
   Authorization: Bearer <token>
   ```
3. Routes that **do not** require auth: `GET /api/categories*`, `GET /api/products*`. Everything
   else (`/api/auth/me`, all of `/api/addresses`, `/api/cart`, `/api/orders`) requires the header —
   omitting it or sending a bad/expired token returns `401 UNAUTHORIZED`.

There is no concept of guest cart/checkout — the cart is server-side per logged-in user (see
§6.4), so the frontend must gate cart/checkout UI behind login.

---

## 3. Response & error conventions

**Success:** plain JSON, no envelope wrapper beyond what's documented per-endpoint below (e.g.
`{ "user": {...} }`, `{ "categories": [...] }`). `DELETE` endpoints return `204 No Content` with
an empty body.

**Domain errors** (expected failures — bad input at the business-logic level, not a validation
failure) come back as:
```json
{ "error": "Human-readable message", "code": "MACHINE_READABLE_CODE" }
```
with one of these HTTP statuses:

| HTTP | `code`                       | When |
|------|------------------------------|------|
| 400  | `EMPTY_CART`                 | Checkout initiated with no items in cart |
| 400  | `INVALID_ADDRESS`            | Address doesn't exist or doesn't belong to the caller (same code for both — don't leak which) |
| 400  | `PAYMENT_VERIFICATION_FAILED`| Razorpay signature on `/checkout/verify` didn't match |
| 401  | `UNAUTHORIZED`               | Missing/invalid/expired bearer token, or bad login credentials |
| 404  | `NOT_FOUND`                  | Category/product/address/order/cart-item doesn't exist (message says which, e.g. `"Product not found"`) |
| 409  | `CONFLICT`                   | Signup with an email that's already registered |
| 502  | `PAYMENT_GATEWAY_ERROR`      | Razorpay itself rejected the order-create call (e.g. bad API keys) |

**Request validation errors** (malformed body/query — wrong type, missing required field, failed
a Zod `.min()`/`.email()`/etc.) come back **before** any domain logic runs, in a **different
shape**, always `400`:
```json
{
  "success": false,
  "error": {
    "name": "ZodError",
    "message": "[{\"code\":\"invalid_format\",\"path\":[\"email\"],\"message\":\"Enter a valid email address\"}]"
  }
}
```
Note `error.message` is a **JSON-encoded string**, not an object — `JSON.parse()` it to get the
issues array (each with `path` and `message`) if you want field-level errors in a form. Treat any
`400` with `"success": false` at the top level as this validation shape; any `400`/`401`/`404`/etc.
with `error`/`code` at the top level as the domain-error shape above.

**Unhandled/unexpected errors:** `500 { "error": "Internal server error", "code": "INTERNAL_ERROR" }`
— should not happen in normal operation; treat as a bug if seen.

---

## 4. Entity shapes

Money fields are **whole rupees as integers/numbers**, not paise, everywhere except the Razorpay
checkout-init response (§6.6, which is paise — that's a Razorpay API convention, not this
backend's).

### User
```ts
{ id: string; name: string; email: string; phone: string }
```
(`passwordHash` is never returned.)

### Category
```ts
{ id: string; slug: string; name: string; description: string; icon: string; image: string }
```

### Product (as returned from catalog endpoints: list/detail/related)
```ts
{
  id: string;
  slug: string;
  name: string;
  categorySlug: string;   // note: slug, not categoryId — already joined for you
  price: number;          // rupees
  mrp: number;             // rupees, may equal price (no discount)
  unit: string;            // e.g. "500 g", "1 L"
  image: string;
  images: string[];
  description: string;
  rating: number;
  ratingCount: number;
  inStock: boolean;
  tags: string[];
}
```

### Product (as embedded inside a cart item or order item — §6.4/§6.7)
Same fields **except** `categorySlug` is `categoryId` (raw FK, not joined) instead — these two
endpoints select the raw product row rather than the catalog-joined shape. If you need the
category slug for a cart/order line item, look it up from `GET /api/categories` client-side, or
treat it as a known gap.

### Address
```ts
{
  id: string;
  userId: string;
  type: "Home" | "Work" | "Other";
  name: string;       // recipient name
  phone: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  pincode: string;     // 6 digits, string
  isDefault: boolean;
}
```

### Cart (the full `GET /api/cart` response shape — see §6.4)
```ts
{
  cartId: string;
  items: Array<{ itemId: string; qty: number; product: Product /* raw shape, see above */ }>;
  itemCount: number;   // sum of qty
  subtotal: number;    // sum(price * qty), rupees
  deliveryFee: number; // 0 if subtotal >= 199 or cart is empty, else 25 — see constants.ts
  total: number;        // subtotal + deliveryFee
}
```

### Order (returned from checkout/verify and both order endpoints)
```ts
{
  id: string;
  orderNumber: string;    // e.g. "FC-LX3K9A2B" — human-facing, show this not `id`
  userId: string;
  address: {              // frozen snapshot at order time, NOT a live address FK
    type: string; name: string; phone: string;
    line1: string; line2?: string; city: string; state: string; pincode: string;
  };
  deliverySlot: string;
  paymentMethod: "upi" | "card" | "netbanking" | "cod";
  razorpayOrderId: string;
  razorpayPaymentId: string;
  subtotal: number;
  deliveryFee: number;
  discount: number;        // always 0 for now — no promo/coupon system yet
  total: number;
  status: "placed";        // always "placed" today — no fulfillment-status transitions wired up yet
  placedAt: string;         // ISO timestamp
  items: Array<{ productId: string; qty: number; priceAtPurchase: number; product: Product /* raw shape */ }>;
}
```
`priceAtPurchase` is the frozen per-unit price at order time — use this for order-history display,
not the live `product.price` (which can have changed since).

---

## 5. Endpoint index

```
POST   /api/auth/signup                  public
POST   /api/auth/login                   public
GET    /api/auth/me                      auth

GET    /api/categories                   public
GET    /api/categories/:slug             public

GET    /api/products                     public   query filters + pagination
GET    /api/products/:slug               public
GET    /api/products/:slug/related       public

GET    /api/addresses                    auth
POST   /api/addresses                    auth
PATCH  /api/addresses/:id                auth
DELETE /api/addresses/:id                auth

GET    /api/cart                         auth     get-or-create, always priced live
POST   /api/cart/items                   auth
PATCH  /api/cart/items/:itemId           auth     qty: 0 removes the item
DELETE /api/cart/items/:itemId           auth
DELETE /api/cart                         auth     clears all items
POST   /api/cart/checkout/initiate       auth     creates a Razorpay Order
POST   /api/cart/checkout/verify         auth     verifies signature, creates the Order

GET    /api/orders                       auth
GET    /api/orders/:id                   auth
```

---

## 6. Endpoint details

### 6.1 `POST /api/auth/signup`
Request:
```json
{ "name": "Asha Rao", "email": "asha@example.com", "phone": "9876543210", "password": "at-least-6-chars" }
```
`201`:
```json
{ "user": { "id": "...", "name": "Asha Rao", "email": "asha@example.com", "phone": "9876543210" }, "token": "eyJ..." }
```
`409 CONFLICT` if the email is already registered.

### 6.2 `POST /api/auth/login`
Request: `{ "email": "asha@example.com", "password": "..." }`
`200`: same shape as signup's success response.
`401 UNAUTHORIZED` on wrong email or password (same message either way — no user enumeration).

### 6.3 `GET /api/auth/me`
Auth required. `200 { "user": {...} }`. Use on app load to validate a stored token / rehydrate
the session.

### 6.4 Categories
- `GET /api/categories` → `200 { "categories": Category[] }`, alphabetical by name.
- `GET /api/categories/:slug` → `200 { "category": Category }`, `404` if slug doesn't exist.

### 6.5 Products
`GET /api/products` — all query params optional:

| param      | type                                                        | default      |
|------------|-------------------------------------------------------------|--------------|
| `category` | comma-separated category **slugs**, e.g. `dairy,bakery`     | (all)        |
| `tag`      | comma-separated tags, e.g. `organic,new`                    | (all)        |
| `q`        | string, matched against product name (case-insensitive, substring) | ""    |
| `minPrice` | number                                                       | (none)       |
| `maxPrice` | number                                                       | (none)       |
| `inStock`  | `"true"` \| `"false"` — string literal, not a bool           | (both)       |
| `sort`     | `popularity` \| `price-asc` \| `price-desc` \| `rating` \| `newest` | `popularity` |
| `page`     | positive integer                                             | 1            |
| `pageSize` | positive integer, max 50                                     | 12           |

`200`:
```json
{ "items": [ /* Product[] */ ], "total": 137, "page": 1, "pageSize": 12 }
```
`total` is the full matching count (for computing total pages), not `items.length`.
`"newest"` sort surfaces products tagged `"new"` first, no secondary date field exists.

- `GET /api/products/:slug` → `200 { "product": Product }`, `404` if not found.
- `GET /api/products/:slug/related` → `200 { "products": Product[] }` (up to 5, same category,
  excludes itself). `404` if `:slug` itself doesn't exist.

### 6.6 Addresses
All require auth and are scoped to the caller — you can never see or modify another user's
address (a mismatched `:id` returns `400 INVALID_ADDRESS`, not `404`, deliberately not
distinguishing "doesn't exist" from "not yours").

- `GET /api/addresses` → `200 { "addresses": Address[] }`
- `POST /api/addresses` → body is the address fields minus `id`/`userId`:
  ```json
  {
    "type": "Home", "name": "Asha Rao", "phone": "9876543210",
    "line1": "221B Baker Street", "line2": "Near the bakery",
    "city": "Mumbai", "state": "Maharashtra", "pincode": "400001",
    "isDefault": true
  }
  ```
  (`line2` and `isDefault` optional.) `201 { "address": Address }`.
  Note: creating a second address with `isDefault: true` does **not** unset the previous default —
  there's no single-default-enforcement logic yet. If the frontend needs "only one default",
  enforce it client-side for now (e.g. only show/use the most recently set one).
- `PATCH /api/addresses/:id` → body is any subset of the same fields (all optional). `200 { "address": Address }`.
- `DELETE /api/addresses/:id` → `204`, empty body.

### 6.7 Cart
All require auth. There is exactly one cart per user (created lazily on first touch) — no
concept of multiple saved carts or a cart ID the frontend needs to track; every cart endpoint
resolves "the caller's cart" server-side.

- `GET /api/cart` → `200`, full Cart shape (§4). Safe to call anytime, including before the user
  has added anything — returns an empty cart, not a 404.
- `POST /api/cart/items` → body `{ "productId": "<uuid>", "qty": 2 }` (`qty` optional, defaults
  to 1). Adding a product already in the cart **increments** its qty rather than erroring or
  overwriting. `404 NOT_FOUND` ("Product not found") for a bad `productId`. `201`, full Cart shape.
- `PATCH /api/cart/items/:itemId` → body `{ "qty": 3 }`. **`qty: 0` deletes the line item** (not
  an error) — use this instead of the `DELETE` endpoint for a quantity-stepper UI's "decrement to
  zero" case if that's more convenient. `404` if `:itemId` isn't in the caller's cart. `200`, full
  Cart shape.
- `DELETE /api/cart/items/:itemId` → `200`, full Cart shape (not 204 — unlike addresses, this
  returns the updated cart so the client doesn't need a follow-up `GET`).
- `DELETE /api/cart` → clears all items. `200`, full (now-empty) Cart shape.

### 6.8 Checkout — full flow

This is the one multi-step integration. Two backend calls plus a client-side Razorpay Checkout
popup sit in between them:

```
1. Frontend: POST /api/cart/checkout/initiate  →  backend creates a real Razorpay Order
2. Frontend: open Razorpay Checkout (checkout.js) using the response from step 1
3. User completes payment in the Razorpay popup
4. Razorpay: calls the frontend's `handler` callback with payment_id/order_id/signature
5. Frontend: POST /api/cart/checkout/verify with those three values
6. Backend: verifies signature, creates the Order row, clears the cart  →  returns the Order
```

**Step 1 — `POST /api/cart/checkout/initiate`**
Body:
```json
{ "addressId": "<uuid, must belong to caller>", "deliverySlot": "Today, 4-6 PM", "paymentMethod": "upi" }
```
`paymentMethod` is one of `"upi" | "card" | "netbanking" | "cod"` — **note this value is stored
for display only; it does not change what Razorpay Checkout actually shows the user**, and `"cod"`
still goes through the same Razorpay-order flow today (there is no separate pay-on-delivery path
that skips Razorpay). If you want a true COD option that bypasses online payment, that's not built
— flag it rather than assuming `"cod"` does that.

Preconditions, checked server-side (don't need client-side duplication, but good for disabling
the checkout button early): cart must be non-empty (`400 EMPTY_CART`), `addressId` must belong to
the caller (`400 INVALID_ADDRESS`).

`200`:
```json
{ "razorpayOrderId": "order_ABC123", "amount": 24900, "currency": "INR", "keyId": "rzp_test_..." }
```
`amount` is in **paise** (Razorpay convention) — `24900` = ₹249.00. This is computed from the
cart's live totals at the moment of the call (subtotal + delivery fee, no discount support yet)
and frozen into a snapshot server-side; changing the cart after this call and before completing
payment does not change what gets charged (but does invalidate anything not yet paid for — see
"retrying" below).

**Step 2/3 — client-side Razorpay Checkout.** Load `https://checkout.razorpay.com/v1/checkout.js`
and open it with:
```js
const options = {
  key: response.keyId,
  amount: response.amount,
  currency: response.currency,
  order_id: response.razorpayOrderId,
  name: "Your Store Name",
  handler: function (razorpayResponse) {
    // razorpayResponse = { razorpay_payment_id, razorpay_order_id, razorpay_signature }
    // → call step 5 with these three fields
  },
  prefill: { name: user.name, email: user.email, contact: user.phone },
};
new window.Razorpay(options).open();
```
This part is entirely client-side Razorpay SDK usage — the backend is not involved between steps
1 and 5, and never sees card/UPI details (Razorpay handles that in the popup/iframe).

**Step 5 — `POST /api/cart/checkout/verify`**
Body (field names deliberately match Razorpay's snake_case callback field names, just
camelCased):
```json
{
  "razorpayOrderId": "order_ABC123",
  "razorpayPaymentId": "pay_XYZ789",
  "razorpaySignature": "<hex signature from the handler callback>"
}
```
`200 { "order": Order }` (see §4 for shape) — cart is now empty, order appears in
`GET /api/orders`.

`400 PAYMENT_VERIFICATION_FAILED` if the signature doesn't check out (tampered/malformed payload —
should not happen in normal client flow; if it does, do not retry with the same values, something
is wrong).

**Idempotency / webhook note:** Razorpay also fires a server-to-server webhook
(`payment.captured`) at `/webhooks/razorpay`, which independently calls the same
order-confirmation logic. This is a backend-internal reliability mechanism (covers the case where
the user closes the tab right after paying, before step 5 fires) — **the frontend does not call
or need to know about the webhook**, but should be aware that calling `/checkout/verify` is safe
to retry: if the order was already created (by a webhook that beat the client here, or a genuine
duplicate call), the same call just returns the existing `Order` again rather than erroring or
creating a duplicate.

**Retrying a failed/abandoned checkout:** if the user closes the Razorpay popup or payment fails,
just call `/checkout/initiate` again — it creates a fresh Razorpay order from the cart's current
(live) state. The cart is untouched by a failed/abandoned attempt.

### 6.9 Orders
Both require auth and are scoped to the caller.

- `GET /api/orders` → `200 { "orders": Order[] }`, newest first.
- `GET /api/orders/:id` → `200 { "order": Order }`. `404` if it doesn't exist **or** belongs to
  someone else (same non-distinguishing behavior as addresses).

---

## 7. Things intentionally not built (don't assume these exist)

- No password reset / email verification / OAuth — signup+login only.
- No order status transitions (no "mark delivered", no tracking) — `status` is always `"placed"`.
- No coupons/discounts — `discount` is always `0`.
- No multi-address "ship to" selection beyond picking one saved address at checkout time.
- No server-enforced single default address (see §6.6 note).
- No true cash-on-delivery bypass of Razorpay (see §6.8 note on `paymentMethod: "cod"`).
- No admin/merchant-facing endpoints of any kind.
- No agent/AI checkout path — that's the deliberately-deferred next phase; see
  `backend/CLAUDE.md` for how the service layer is shaped to make that additive later.
