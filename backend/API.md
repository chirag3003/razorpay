# Backend API Reference

The integration contract for `backend/`. Written so you can wire up a client **without reading
backend source**. Code wins on any disagreement — but fix this file in the same change.

Plain REST for the storefront (§2–§6.9), admin surface (§6.10), UPI Reserve Pay (§6.11), the
shared agent tool registry and chat agent (§6.12–§6.13a), MCP + its OAuth flow (§6.14–§6.15).
**§7 is what deliberately doesn't exist** — read it before assuming a feature is there.

Setup and running: root `README.md`. Changing backend code: `backend/CLAUDE.md`.

---

## 1. Base URL

- Dev: `http://localhost:4000` (or `PORT`).
- Everything is under `/api` except the webhook (`/webhooks/razorpay`), the OAuth endpoints
  (`/oauth/*`, `/.well-known/*`) and the health check (`GET /` → `{"status":"ok"}`).
- JSON in, JSON out. Send `Content-Type: application/json` on anything with a body.
- Bodies over **256 KB** get `413`. Voice upload has its own 4 MB limit (§6.13a).
- CORS locked to `CORS_ORIGIN` (default `http://localhost:3000`). Mismatch = every request fails
  CORS with no JSON body to explain it.

---

## 2. Auth

Stateless JWT bearer, 7-day expiry, no refresh endpoint — log the user out on a `401`.

1. `POST /api/auth/signup` or `/login` → `{ user, token }`.
2. Send `Authorization: Bearer <token>` on every authed request.
3. Public: `GET /api/categories*`, `GET /api/products*`. Everything else needs the header.

No guest cart or checkout — the cart is server-side per user, so gate cart/checkout UI behind
login.

**Admin auth is completely separate** (§6.10): `POST /api/admin/login` takes a shared
`ADMIN_PASSWORD` and returns a JWT signed with a *different* secret, 12h, payload
`{ role: "admin" }`, no `sub`. Not interchangeable with a user token in either direction.

**MCP auth is a third path** (§6.14): an OAuth access token, never a copy-pasted human JWT.

---

## 3. Response & error conventions

**Success:** plain JSON, per-endpoint shape (`{ "user": {...} }`, `{ "categories": [...] }`).
`DELETE` mostly returns `204` empty — exceptions noted per endpoint.

**Domain errors:** `{ "error": "human message", "code": "MACHINE_CODE" }`.

| HTTP | `code` | When |
|---|---|---|
| 400 | `VALIDATION` | Business-level bad input not caught by the schema |
| 400 | `EMPTY_CART` | Checkout with an empty cart |
| 400 | `INVALID_ADDRESS` | Address unknown **or** not the caller's — same code for both, deliberately |
| 400 | `PAYMENT_VERIFICATION_FAILED` | Razorpay signature didn't match |
| 400 | `MANDATE_AMOUNT_EXCEEDED` | Single charge over the per-transaction cap |
| 401 | `UNAUTHORIZED` | Missing/invalid/expired token, bad credentials, wrong admin password |
| 402 | `INSUFFICIENT_BLOCKED_BALANCE` | Not enough left in the block. 402 not 400 — request is fine, funds aren't |
| 403 | `FORBIDDEN` | Defined; not currently returned by any route |
| 404 | `NOT_FOUND` | Unknown category/product/address/order/cart item (message says which) |
| 409 | `CONFLICT` | Duplicate email, duplicate slug, category still has products, quote/cart divergence |
| 409 | `PRODUCT_UNAVAILABLE` | Out of stock |
| 409 | `MANDATE_NOT_ACTIVE` | No mandate, or paused/revoked/failed/expired/exhausted |
| 409 | `MANDATE_EXPIRED` | Past `expiresAt` |
| 413 | `PAYLOAD_TOO_LARGE` | Body over the limit |
| 502 | `PAYMENT_GATEWAY_ERROR` | Razorpay rejected the call (bad keys, unentitled API) |
| 503 | `VOICE_UNAVAILABLE` | No `SARVAM_API_KEY` — hide the mic, don't toast |
| 502 | `VOICE_SERVICE_ERROR` | Sarvam refused or unreachable |
| 500 | `INTERNAL_ERROR` | Bug. No stack trace, raw Postgres or raw Razorpay error ever reaches a client |

**Branch on `code`, never on message text.**

**Schema validation errors** run *before* domain logic and use a **different shape**, always
`400`:

```json
{
  "success": false,
  "error": {
    "name": "ZodError",
    "message": "[{\"code\":\"invalid_format\",\"path\":[\"email\"],\"message\":\"Enter a valid email address\"}]"
  }
}
```

`error.message` is a **JSON-encoded string** — `JSON.parse()` it for the issues array. Rule of
thumb: `"success": false` at the top level = validation shape; `error`/`code` at the top level =
domain shape.

---

## 4. Entity shapes

Money is **whole rupees as integers**, except the Razorpay checkout-init response and every
Reserve Pay `*Paise` field (§6.11) — those carry Razorpay's own unit.

### User
```ts
{ id: string; name: string; email: string; phone: string }
```
`passwordHash` is never returned.

### Category
```ts
{ id: string; slug: string; name: string; description: string; icon: string; image: string }
```

### Product (catalog endpoints — list/detail/related)
```ts
{
  id: string;
  slug: string;
  name: string;
  categorySlug: string;   // slug, not categoryId — already joined for you
  price: number;          // rupees
  mrp: number;            // rupees, may equal price
  unit: string;           // "500 g", "1 L"
  image: string;
  images: string[];
  description: string;
  rating: number;
  ratingCount: number;
  inStock: boolean;
  tags: string[];
  createdAt: string;          // ISO
  archivedAt: string | null;  // always null on storefront responses; can be set on admin ones
}
```

### Product (embedded in a cart item or order item)
Same, except `categorySlug` is replaced by `categoryId` (raw FK) — those endpoints select the raw
product row. Need the slug for a line item? Look it up from `GET /api/categories`.

### Address
```ts
{
  id: string; userId: string;
  type: "Home" | "Work" | "Other";
  name: string;    // recipient
  phone: string;
  line1: string; line2: string | null;
  city: string; state: string;
  pincode: string; // 6 digits, string
  isDefault: boolean;
}
```

### Cart
```ts
{
  cartId: string;
  items: Array<{ itemId: string; qty: number; product: Product /* raw shape */ }>;
  itemCount: number;    // sum of qty
  subtotal: number;
  deliveryFee: number;  // 0 if subtotal >= 199 or cart empty, else 25
  total: number;
}
```

### Order
```ts
{
  id: string;
  orderNumber: string;   // "FC-LX3K9A2B" — show this, not id
  userId: string;
  address: {             // frozen snapshot, NOT a live FK
    type; name; phone; line1; line2?; city; state; pincode;
  };
  deliverySlot: string;
  paymentMethod: string; // "razorpay" by default
  razorpayOrderId: string;
  razorpayPaymentId: string;
  subtotal: number;
  deliveryFee: number;
  discount: number;      // always 0 — no coupon system
  total: number;
  status: "placed" | "shipped" | "delivered" | "cancelled";  // starts "placed", admin-only changes
  placedAt: string;      // ISO
  items: Array<{ productId; qty; priceAtPurchase; product /* raw shape */ }>;
}
```
`priceAtPurchase` is frozen at order time — use it for order history, not the live
`product.price`.

### AdminOrder
`Order & { buyer: { id, name, email, phone } }`.

---

## 5. Endpoint index

```
POST   /api/auth/signup                  public
POST   /api/auth/login                   public
GET    /api/auth/me                      auth
PATCH  /api/auth/me                      auth

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
POST   /api/cart/checkout/reserve-pay    auth     headless: debits a mandate, returns the Order

GET    /api/orders                       auth
GET    /api/orders/:id                   auth

POST   /api/reserve-pay/mandates         auth     blocks funds; returns the UPI approval link
GET    /api/reserve-pay/mandates         auth     all mandates, newest first
GET    /api/reserve-pay/mandates/current auth     the live mandate, or null
GET    /api/reserve-pay/mandates/:id     auth     re-syncs from Razorpay; poll this
POST   /api/reserve-pay/mandates/:id/revoke  auth stops further debits
POST   /api/reserve-pay/mandates/debit   auth     test harness; only if RESERVE_PAY_TEST_DEBIT_ROUTE=true

POST   /api/chat                         auth     SSE; the storefront chat agent
GET    /api/chat/:conversationId         auth     rendered transcript, no model call

POST   /api/voice/transcribe             auth     multipart audio -> English text + spoken language
POST   /api/voice/speak                  auth     English text + language -> base64 WAV

POST   /api/mcp                          agent    MCP tool server (§6.14) — Bearer is an OAuth
                                                   access token, never a human JWT
GET    /.well-known/oauth-protected-resource/api/mcp   public   RFC 9728
GET    /.well-known/oauth-authorization-server         public   RFC 8414
POST   /oauth/register                   public   RFC 7591 dynamic client registration
GET    /oauth/authorize                  public   redirects to web/'s /agent-connect (§6.15)
GET    /api/oauth/authorize/:requestId   public   for /agent-connect to render client name/scope
POST   /api/oauth/authorize/decision     auth     the human's approve/deny, own session JWT
POST   /oauth/token                      public   authorization_code / refresh_token exchange

POST   /api/admin/login                  public   password -> admin JWT
GET    /api/admin/dashboard              admin    summary counts + recent orders
GET    /api/admin/orders                 admin    filters + pagination
GET    /api/admin/orders/:id             admin
PATCH  /api/admin/orders/:id/status      admin    { status }
GET    /api/admin/products               admin    no storefront in-stock/archived filtering
POST   /api/admin/products               admin
PATCH  /api/admin/products/:id           admin    partial; { archived } toggles archive
DELETE /api/admin/products/:id           admin    hard-delete, or archive if order-referenced
GET    /api/admin/categories             admin    includes productCount
POST   /api/admin/categories             admin
PATCH  /api/admin/categories/:id         admin    partial
DELETE /api/admin/categories/:id         admin    409 if the category still has products
GET    /api/admin/users                  admin    read-only, paginated
```

---

## 6. Endpoint details

### 6.1 `POST /api/auth/signup`
`{ "name", "email", "phone", "password" }` (password min 6).
`201 { user, token }`. `409 CONFLICT` if the email is registered.

### 6.2 `POST /api/auth/login`
`{ "email", "password" }` → `200 { user, token }`.
`401 UNAUTHORIZED` on wrong email *or* password — same message and same timing either way.

### 6.3 `GET /api/auth/me`
Auth. `200 { user }`. Use on app load to validate a stored token.

### 6.3a `PATCH /api/auth/me`
Auth. Any subset of `{ name, email, phone }`. `200 { user }`. `409 CONFLICT` if `email` is taken.
No password change flow exists.

### 6.4 Categories
- `GET /api/categories` → `200 { categories }`, alphabetical.
- `GET /api/categories/:slug` → `200 { category }`, `404` if unknown.

### 6.5 Products

`GET /api/products` — all params optional:

| param | type | default |
|---|---|---|
| `category` | comma-separated **slugs** — OR | (all) |
| `tag` | comma-separated tags — AND | (all) |
| `q` | matched against name (case-insensitive substring) and tags (exact element) | "" |
| `minPrice` / `maxPrice` | integer, 0–1,000,000 | (none) |
| `inStock` | `"true"` \| `"false"` — string literal, not a bool | (both) |
| `sort` | `popularity` \| `price-asc` \| `price-desc` \| `rating` \| `newest` | `popularity` |
| `page` | positive integer | 1 |
| `pageSize` | positive integer, max 50 | 12 |

`200 { "items": Product[], "total": 137, "page": 1, "pageSize": 12 }` — `total` is the full
matching count, not `items.length`.

Every sort has `id` as a tiebreaker, so paging is stable. `newest` sorts by `createdAt`.

- `GET /api/products/:slug` → `200 { product }`, `404` if unknown.
- `GET /api/products/:slug/related` → `200 { products }` (up to 5, same category, excludes
  itself). `404` if `:slug` is unknown.

### 6.6 Addresses

Auth, scoped to the caller. A mismatched `:id` returns `400 INVALID_ADDRESS`, not `404` —
deliberately not distinguishing "doesn't exist" from "not yours".

- `GET /api/addresses` → `200 { addresses }`
- `POST /api/addresses` → address fields minus `id`/`userId`; `line2` and `isDefault` optional.
  `201 { address }`.
  **No single-default enforcement** — a second `isDefault: true` does not unset the first.
- `PATCH /api/addresses/:id` → any subset. `200 { address }`.
- `DELETE /api/addresses/:id` → `204`.

### 6.7 Cart

Auth. Exactly one cart per user, created lazily. No cart id to track — every endpoint resolves
"the caller's cart" server-side.

- `GET /api/cart` → `200`, full Cart. Safe before anything is added — returns an empty cart, not
  a 404.
- `POST /api/cart/items` → `{ "productId", "qty" }` (`qty` optional, default 1, max 20 **per
  line and additive** — a request pushing the line over 20 is a `400`).
  Adding a product already in the cart **increments** it. `404` for a bad `productId`,
  `409 PRODUCT_UNAVAILABLE` if out of stock. `201`, full Cart.
- `PATCH /api/cart/items/:itemId` → `{ "qty": 3 }`. **`qty: 0` deletes the line** (not an error).
  `404` if not in the caller's cart. `200`, full Cart.
- `DELETE /api/cart/items/:itemId` → `200`, full Cart (not 204 — saves you a follow-up GET).
- `DELETE /api/cart` → `200`, empty Cart.

### 6.8 Checkout — browser flow

```
1. POST /api/cart/checkout/initiate  -> backend creates a real Razorpay Order
2. open Razorpay Checkout (checkout.js) with the response
3. user pays in the popup
4. Razorpay calls your `handler` with payment_id/order_id/signature
5. POST /api/cart/checkout/verify with those three
6. backend verifies, creates the Order, clears the cart -> returns the Order
```

**Step 1 — `POST /api/cart/checkout/initiate`**

```json
{ "addressId": "<uuid>", "deliverySlot": "Today, 4:00 PM - 6:00 PM" }
```

`deliverySlot` is the human **label**, not a slot id — one of the six `${day}, ${time}` strings
built from `DELIVERY_SLOTS` in `constants.ts`. Anything else is a `400`. (Agent tools take the
slot **id** instead; `list_delivery_slots` returns both.)

`paymentMethod` is optional, defaults `"razorpay"`, and is **stored for display only** — it does
not change what Razorpay Checkout shows. `"cod"` still goes through the same Razorpay flow; there
is no COD path that bypasses payment.

Preconditions: non-empty cart (`400 EMPTY_CART`), `addressId` belongs to the caller
(`400 INVALID_ADDRESS`).

```json
{ "razorpayOrderId": "order_ABC123", "amount": 24900, "currency": "INR", "keyId": "rzp_test_..." }
```

`amount` is **paise**. Computed from live cart totals and frozen into a server-side snapshot —
changing the cart afterwards does not change what gets charged.

**Steps 2/3 — client-side.** Load `https://checkout.razorpay.com/v1/checkout.js`:

```js
new window.Razorpay({
  key: res.keyId,
  amount: res.amount,
  currency: res.currency,
  order_id: res.razorpayOrderId,
  name: "Fresh Cart",
  handler: (r) => {
    // r = { razorpay_payment_id, razorpay_order_id, razorpay_signature } -> step 5
  },
  prefill: { name: user.name, email: user.email, contact: user.phone },
}).open();
```

The backend is not involved between steps 1 and 5 and never sees card/UPI details.

**Step 5 — `POST /api/cart/checkout/verify`**

```json
{ "razorpayOrderId": "order_ABC123", "razorpayPaymentId": "pay_XYZ789", "razorpaySignature": "<hex>" }
```

`200 { order }` — cart now empty. `400 PAYMENT_VERIFICATION_FAILED` on a bad signature; don't
retry with the same values.

**Safe to retry.** Razorpay also fires a `payment.captured` webhook that runs the same
order-confirmation logic (covers the user closing the tab right after paying). If the order
already exists, `/verify` returns it again rather than duplicating.

**Retrying an abandoned checkout:** just call `/initiate` again. A failed attempt leaves the cart
untouched.

### 6.9 Orders

Auth, scoped to the caller.

- `GET /api/orders` → `200 { orders, total }`, newest first. Optional `?limit=` (1–100, default
  100) and `?offset=` (default 0); `total` is the unpaginated count so you can page without a
  second call.
- `GET /api/orders/:id` → `200 { order }`. `404` if unknown **or** someone else's.

### 6.10 Admin

Separate auth (§2). One shared admin identity, no per-admin accounts or roles. Every mutating
call writes an `audit_log` row with `actor_type = "admin"`.

**6.10.1 `POST /api/admin/login`** — public. `{ "password" }` → `200 { token }`, valid 12h.
`401` on a wrong password.

**6.10.2 `GET /api/admin/dashboard`**
```json
{
  "orders":  { "total": 128, "byStatus": { "placed": 12, "shipped": 40, "delivered": 74, "cancelled": 2 } },
  "revenue": { "allTime": 348200, "last30Days": 91400 },
  "catalog": { "products": 60, "archived": 3, "categories": 8, "outOfStock": 4 },
  "users":   { "total": 51 },
  "recentOrders": [ /* AdminOrder[], up to 10 */ ]
}
```
`revenue` sums `order.total` over every non-cancelled order. `catalog.products` counts
non-archived only.

**6.10.3 `GET /api/admin/orders`**

| param | type | default |
|---|---|---|
| `status` | `placed` \| `shipped` \| `delivered` \| `cancelled` | (all) |
| `userId` | uuid | (all) |
| `dateFrom` / `dateTo` | ISO-8601, on `placedAt` | (none) |
| `q` | substring on `orderNumber` | "" |
| `sort` | `newest` \| `oldest` \| `total-desc` \| `total-asc` | `newest` |
| `page` / `pageSize` | pageSize max 100 | 1 / 20 |

`200 { items: AdminOrder[], total, page, pageSize }`.

**6.10.4 `GET /api/admin/orders/:id`** — `200 { order: AdminOrder }`. `404` if unknown; no
ownership scoping, an admin sees every order.

**6.10.5 `PATCH /api/admin/orders/:id/status`** — `{ "status": "shipped" }`. `200 { order }`.
No transition rules — any status can move to any other.

**6.10.6 `GET /api/admin/products`** — no implicit in-stock/archived filtering, unlike §6.5.
Params: `q`, `category` (single slug), `archived` = `exclude` (default) \| `only` \| `all`,
`inStock`, `sort` = `newest` (default) \| `name-asc` \| `price-asc` \| `price-desc`, `page`,
`pageSize` (max 100, default 20). `200 { items, total, page, pageSize }` with `archivedAt`.

**6.10.7 `POST /api/admin/products`**
```json
{
  "name": "Cold Pressed Olive Oil", "categorySlug": "staples-grains",
  "price": 499, "mrp": 560, "unit": "500 ml",
  "image": "https://.../olive-oil.jpg", "images": ["https://.../olive-oil.jpg"],
  "description": "First cold press, single origin.",
  "inStock": true, "tags": ["new"]
}
```
`images` (defaults `[image]`), `inStock` (default `true`), `tags` (default `[]`) optional. `slug`
is generated from `name` with a `-2`/`-3` suffix on collision — not client-supplied.
`201 { product }`. `404` if `categorySlug` is unknown.

**6.10.8 `PATCH /api/admin/products/:id`** — any non-empty subset of the create fields plus
`"archived": boolean`. `true` stamps `archivedAt` (gone from the storefront and add-to-cart, still
here and in past orders), `false` clears it. `200 { product }`.

**6.10.9 `DELETE /api/admin/products/:id`** — hard delete if no order references it → `204`. If
one does, **archives instead** → `200 { product, archived: true }`.

**6.10.10 `GET /api/admin/categories`** — `200 { categories: Array<Category & { productCount }> }`,
alphabetical. `productCount` includes archived products.

**6.10.11 `POST /api/admin/categories`** — `{ name, description, icon, image, slug? }`. `icon` is
a Lucide name (`"Carrot"`). `201 { category }`. `409` if the slug is taken.

**6.10.12 `PATCH /api/admin/categories/:id`** — any non-empty subset. `200 { category }`. `409` on
a slug collision.

**6.10.13 `DELETE /api/admin/categories/:id`** — `204`. `409 CONFLICT` if any product still
references it — no archive for categories, reassign or delete the products first.

**6.10.14 `GET /api/admin/users`** — read-only. `q` (name or email substring), `page`,
`pageSize` (max 100, default 50). `200 { items: Array<{id, name, email, phone, createdAt}>, total,
page, pageSize }`. No create/update/delete.

### 6.11 UPI Reserve Pay (SBMD)

Blocks a customer's funds once against a single UPI PIN approval, then lets the merchant debit
that block repeatedly with no further interaction. That headless second half is the point: a chat
panel or an external agent cannot drive a Razorpay Checkout popup, so **every AI-initiated payment
runs on this rail**.

> **Needs `RESERVE_PAY_SIM=true` on this account** — Razorpay hasn't provisioned the S2S payment
> API, so no mandate can be authorised against the real gateway. Every endpoint below behaves
> identically in either mode. Full detail and the switch back to production: root `README.md`.

**Lifecycle**
```
1. POST /api/reserve-pay/mandates       -> mandate (pending) + intentUrl
2. customer approves in their UPI app                        <- the only human step
3. GET  /api/reserve-pay/mandates/:id   -> poll until "confirmed"
4. POST /api/cart/checkout/reserve-pay  -> debits the block, returns an Order. Repeat freely.
```

**Mandate shape**, returned by every endpoint here:
```json
{
  "id": "<uuid>",
  "status": "pending | confirmed | paused | failed | revoked | expired | exhausted",
  "maxAmountPaise": 50000,
  "amountBlockedPaise": 50000,
  "amountDebitedPaise": 12500,
  "remainingPaise": 37500,
  "amountBlockedInRupees": 500,
  "remainingInRupees": 375,
  "vpa": "9876543210@upi",
  "failureReason": null,
  "intentUrl": "upi://mandate?pa=...",
  "intentLinks": { "generic": "...", "gpay": "...", "phonepe": "...", "paytm": "...", "bhim": "...", "cred": "...", "whatsapp": "..." },
  "expiresAt": "2026-11-25T...", "confirmedAt": null, "createdAt": "2026-08-27T..."
}
```

Amounts here are **paise**, unlike the rest of this API — they reconcile directly against
Razorpay's figures. `*InRupees` is for display. `intentLinks` is `null` until Razorpay returns a
deep link; per-app links skip the OS chooser, `generic` is the safe default.

**`POST /api/reserve-pay/mandates`** — `{ "amountInRupees": 500, "expiryDays": 90 }`.
`amountInRupees` max **10,000** (regulatory). `expiryDays` optional, max **90**, default **30**.
`201 { mandate }` with `status: "pending"` and the `intentUrl`.
- `409 CONFLICT` if a live mandate exists — revoke it first. One per user, enforced by a partial
  unique index, so concurrent calls can't double-block. An abandoned `pending` ages out after 15
  minutes so a half-finished approval never locks the customer out.
- `502 PAYMENT_GATEWAY_ERROR` carries Razorpay's description verbatim, and the row lands in
  `failed` rather than orphaned as `pending` — the one-mandate slot is released.

**`GET /api/reserve-pay/mandates/current`** — `200 { mandate }` or `{ "mandate": null }`. What a
checkout screen calls to decide whether to offer Reserve Pay.

**`GET /api/reserve-pay/mandates/:id`** — **re-syncs from Razorpay, so it writes as well as
reads.** This is the poll-while-approving endpoint: it picks up the token id, flips to
`confirmed`, fills in `amountBlockedPaise` and `vpa`. Terminal mandates short-circuit.

**`GET /api/reserve-pay/mandates`** — `200 { mandates }`, newest first, terminal ones included.
History is kept, not overwritten.

**`POST /api/reserve-pay/mandates/:id/revoke`** — `200 { mandate }`, `status: "revoked"`. Cancels
at Razorpay, which **unblocks remaining funds and credits them back instantly**. If Razorpay
rejects the cancellation the mandate is still revoked locally and `failureReason` is set — funds
then stay blocked until Razorpay auto-reverses 10 minutes before expiry, so **surface
`failureReason` when it's set**. `409 MANDATE_NOT_ACTIVE` if already terminal.

**`POST /api/reserve-pay/mandates/debit`** — `{ "amountInRupees": 50, "description": "..." }`.
Charges the caller's mandate **without creating an order**. Test harness only. `201` with the
debit and Razorpay ids.

**Not registered by default** — it moves real money for any authenticated caller and creates
nothing to reconcile against. Exists only when `RESERVE_PAY_TEST_DEBIT_ROUTE=true`; otherwise
`404` (or `401` first, if the caller has no token). Boot warns if enabled against live keys.

**`POST /api/cart/checkout/reserve-pay`** — the headless counterpart to §6.8. Body identical to
`/checkout/initiate`. Returns `201 { order }`, the **same** `Order` shape. No `keyId`, no
Checkout.js, no signature round trip.

Same cart and address validation as `/initiate`, then the mandate guard chain **in this order**:

| Error | Code |
|---|---|
| 409 | `MANDATE_NOT_ACTIVE` |
| 409 | `MANDATE_EXPIRED` |
| 400 | `MANDATE_AMOUNT_EXCEEDED` |
| 402 | `INSUFFICIENT_BLOCKED_BALANCE` |

Order matters: a caller learns its mandate is unusable before it learns anything about balances.
Balance is re-synced before the check, so it's never decided on a stale local count.

**Webhooks.** Three kinds of Razorpay order exist (browser checkout, mandate authorisation,
mandate debit) and all arrive at `/webhooks/razorpay`, dispatched on order id.
`payment.authorized` is handled alongside `payment.captured` (a Reserve Pay authorisation often
reports as the former), as are `token.confirmed` / `rejected` / `cancelled` / `paused`. Not
client-facing — but note a mandate can become `confirmed` via webhook with nobody polling.

### 6.12 Agent tool layer (not HTTP)

An in-process TypeScript registry at `src/agent-interfaces/tools/`, called directly by the AI
layer. Documented here because it's the contract the chat agent codes against and because §6.14's
MCP server exposes exactly these tools unchanged.

Why it exists: REST returns shapes a React page renders — one catalog page is ~2,200 tokens,
mostly placeholder image URLs. Agents need the same *actions* with model-shaped inputs, compact
outputs, and recoverable failures.

```ts
import { runTool, toAnthropicTools } from "./agent-interfaces/tools/registry";

const ctx = {
  actor: { type: "agent", id: "<agent or token id>" },  // audit rows use this
  userId: "<uuid>",                                     // whose data
  conversationId: "<optional, for audit correlation>",
};

const result = await runTool(ctx, "search_products", { q: "milk" });
```

**Auth happens above this layer.** The caller resolves the session and passes `userId`; tools
trust it exactly as a route trusts `c.get("userId")` after `requireAuth`.

`toAnthropicTools()` returns `{name, description, input_schema}` from each tool's Zod schema via
`z.toJSONSchema`; `toMcpTools()` returns the same with `inputSchema`.

**`runTool` never throws** — a model can't catch an exception:

```ts
{ ok: true,  data: { ... } }
{ ok: false, error: { code, message, retryable, hint? } }
```

`hint` is the important field — it tells the model what to do next, which is what turns a failure
into a recovery rather than a stall. Codes: `invalid_input`, `not_found`, `cart_empty`,
`product_unavailable`, `invalid_address`, `invalid_slot`, `mandate_missing`, `mandate_expired`,
`mandate_revoked`, `reserve_insufficient`, `amount_exceeds_mandate_limit`, `quote_expired`,
`quote_superseded`, `cart_changed`, `payment_declined`, `payment_gateway_unavailable`, `conflict`,
`server`. Named to map mechanically onto `ChatErrorCode` in `web/lib/chat/protocol.ts`.

| Tool | Writes | Notes |
|---|---|---|
| `search_products` | | Names and tags, **not** descriptions. `category` OR, `tag` AND. |
| `get_product` | | Slug or id. |
| `list_categories` | | The fallback for vague requests — pick a category rather than guess keywords. |
| `list_related_products` | | Same-category, unranked. |
| `get_cart` | | |
| `add_to_cart` | ● | Quantity **additive**. Rejects out-of-stock; caps a line at 20. |
| `update_cart_item` | ● | Absolute quantity, minimum 1. |
| `remove_from_cart` / `clear_cart` | ● | |
| `list_addresses` / `create_address` | ● | |
| `list_delivery_slots` | | `prepare_order` accepts only these ids. |
| `get_payment_status` | | `none`/`active`/`expired`/`revoked`/`insufficient` + shortfall. Falls back to local ledger state if the provider is unreachable, flagged `stale`. |
| `start_reserve_pay_setup` | ● | Returns the UPI intent link the customer must approve. |
| `check_reserve_pay_status` | | Always contacts the provider — the polling tool. |
| `prepare_order` | ● | Issues a signed quote. Takes no money. |
| `place_order` | ● | Charges. Idempotent on `quoteId`. |
| `list_orders` / `get_order` | | **Read-only.** Agents cannot cancel, refund or change status. |
| `search_products_nl` | | **MCP only**, not offered to the chat model. See §6.14. |

Outputs mirror `web/lib/chat/protocol.ts` types so the AI layer can pass them nearly straight into
a message part. **All money is integer rupees**, including mandate figures converted from the
paise the Reserve Pay tables store.

**Ordering is two-phase:**

```
prepare_order({addressId, slotId})  ->  quote { quoteId, lines, totals, payment, expiresAt }
        (show the customer, get an explicit yes)
place_order({quoteId})              ->  { order, alreadyPlaced }
```

`prepare_order` writes a **cart mandate** — a signed per-transaction record of what was agreed
(`cart_mandates`), distinct from the Reserve Pay mandate's standing authority. It buys:

- **Idempotency.** A consumed quote records the order it produced, so a retried `place_order`
  returns that order (`alreadyPlaced: true`) instead of buying twice.
- **Invalidation.** The quote carries a cart fingerprint, and the charge uses the **quoted** line
  items, prices and total — not the live cart. Change the cart afterwards and `place_order` fails
  `cart_changed` rather than charging a basket nobody approved. Swap the Reserve Pay mandate
  between the two calls and it fails `quote_superseded`.
- **Tamper evidence.** HMAC-signed; a modified row fails its integrity check.

One open quote per customer — calling `prepare_order` again supersedes the previous. Quotes expire
after 15 minutes.

Without Reserve Pay available (§6.11), `start_reserve_pay_setup` and `place_order` return
`payment_gateway_unavailable` — surfaced by the agent as an explained failure, not a crash.

### 6.13 Storefront chat agent — `POST /api/chat`

An LLM over OpenRouter calling **only** §6.12's tool layer, streaming the `ServerEvent` union
`web/lib/chat/protocol.ts` defines.

**Auth:** normal user JWT. **Response:** `text/event-stream`, one JSON `ServerEvent` per `data:`
frame.

```jsonc
{
  "conversationId": "uuid",       // client-generated, created server-side on first use
  "token": "…",                   // accepted for wire compatibility, IGNORED
  "turn": { "kind": "text", "text": "what milk do you have" },
  "clientState": { "route": "/products", "recentActions": [] },
  "protocolVersion": 4
}
```

| `turn.kind` | shape |
|---|---|
| `text` | `{ kind: "text", text }` |
| `widget_action` | `{ kind: "widget_action", partId, action }` — `action` is the `WidgetAction` union |
| `resume` | `{ kind: "resume" }` — replays the stored transcript, no model call, no tokens |

`protocolVersion` must equal `CHAT_PROTOCOL_VERSION` (currently **4**) or the request is rejected
**before** the stream opens, `400 PROTOCOL_VERSION_MISMATCH`. Bump on both sides whenever a part's
shape changes.

**Response frames**
```
data: {"type":"message_start","messageId":"…"}
data: {"type":"part_start","part":{"type":"text","partId":"text-1-ab3","text":"","done":false}}
data: {"type":"text_delta","partId":"text-1-ab3","delta":"Here's what I "}
data: {"type":"part_end","partId":"text-1-ab3"}
data: {"type":"part_start","part":{"type":"product_results","partId":"products-2-9fk","products":[…]}}
data: {"type":"part_end","partId":"products-2-9fk"}
data: {"type":"message_end","messageId":"…"}
```

An unrecoverable failure arrives as a frame, never a dead connection:
`{"type":"error","code":"server","message":"…","retryable":true}`. The stream still closes with
`message_end`. An LLM round that stalls is bounded by a timeout and surfaces this way rather than
hanging.

**Widgets are projected, never authored by the model.** The model gets no "UI tools". When a tool
returns, the server builds the widget from that tool's own data (`src/chat/partMapper.ts`):

| Tool | Part |
|---|---|
| `search_products`, `list_related_products`, `get_product` | `product_results` (max 6) |
| `list_categories` | `quick_replies` |
| any cart tool | `cart_summary` |
| `list_addresses`, `create_address` | `address_picker` |
| `list_delivery_slots` | `slot_picker` |
| `get_payment_status`, `check_reserve_pay_status` | `reserve_pay_status` |
| `start_reserve_pay_setup` | `reserve_pay_setup` |
| `prepare_order` | `order_review` |
| `place_order` | `order_confirmation` |
| `list_orders`, `get_order` | none — the model narrates |

So **every rupee the customer sees came out of Postgres**, not a sampler. Multiple cart mutations
in one turn collapse to a single trailing `cart_summary`.

Tool failures mostly do **not** produce an `error` part — `not_found`, `cart_empty` and
`invalid_input` are things the model recovers from using the `hint`, and a red box for "that slug
doesn't exist" is noise. Only failures the **customer** must act on render: `mandate_expired`,
`mandate_revoked`, `reserve_insufficient`, `amount_exceeds_mandate_limit`, `payment_declined`,
`payment_gateway_unavailable`.

**The hard gate on `place_order`.** It is **never sent to the model at all** — not on any turn,
confirmed or otherwise. On a `review.confirm` widget action, `chatService` resolves the customer's
one open quote itself and calls the tool directly, no model round trip in the decision.

Not a system-prompt rule, and not even a per-turn *unlock* — the function is simply never in the
JSON sent to the model. `review.confirm` carries no `quoteId`, so there was never a decision for a
model to make. Prompt injection in a product name, a hallucinated call, a retry storm: none can
place an order, because there is nothing to call. A customer who types "yes, place it" is told to
tap Confirm.

**`clientState` is not trusted.** `route` and `recentActions` are hints. Everything that could
influence a purchase — cart, addresses, Reserve Pay balance, open quote — is rebuilt from the
database each turn and injected as a server-truth context block. `recentActions` still matters:
the storefront batches cart taps made outside the panel and sends them with the next turn, so the
agent knows not to re-add what the customer already added by hand.

**Conversations.** `conversations` + `chat_messages`. `content` holds the raw model message
(tool calls and results included) so a conversation resumes verbatim; `parts` holds the rendered
`MessagePart[]` a `resume` turn replays. Ordering is by a `seq` column, not `createdAt` — a whole
turn is written in one transaction and shares a timestamp. `conversationId` reaches every tool as
`ToolContext.conversationId`, which is what links a placed order back to the conversation that
placed it. Capped at 200 conversations per user.

`GET /api/chat/:conversationId` → `{ conversationId, protocolVersion, messages: [{id, parts}] }`
for rehydrating a panel with no model call.

Closing the panel aborts the request and nothing from the partial turn is persisted. It does
**not** stop OpenRouter billing for the round already in flight.

**Model config.** `OPENROUTER_MODEL` is the entire provider swap. `OPENROUTER_FALLBACK_MODEL` is
sent in the same request as server-side failover, so a dead primary costs no extra round trip.

### 6.13a Chat voice — `POST /api/voice/transcribe` and `/api/voice/speak`

Speech in and out for the chat panel, backed by Sarvam AI. Normal user JWT. **Independent of
`/api/chat`** — the storefront transcribes, sends the text as an ordinary turn, then asks for the
reply to be spoken. `CHAT_PROTOCOL_VERSION` does not cover these.

Both answer `503 VOICE_UNAVAILABLE` with no `SARVAM_API_KEY` — treat as "hide the mic", not an
error worth a toast. Everything else is `502 VOICE_SERVICE_ERROR`; fall back to text rather than
retrying in a loop.

**`POST /api/voice/transcribe`** — `multipart/form-data`, one field `file`. WAV, MP3, AAC, OGG,
OPUS, FLAC, MP4/M4A and WebM all accepted, so a browser `MediaRecorder` blob posts as-is with no
transcoding.

- **Keep clips under 30s** — this is the synchronous path.
- Over 4 MB → `413`. That's an abuse bound, far above 30s of any supported codec.
- `400 VALIDATION` if there's no `file` field or no detectable speech.

```json
{ "transcript": "add two litres of milk to my cart", "languageCode": "hi-IN" }
```

**`transcript` is always English**, whichever of the 23 languages was spoken — transcription runs
in translate mode so the English-only agent can act on it. `languageCode` is BCP-47 for what was
actually spoken and is what you pass back to `/speak`; falls back to `en-IN`.

**`POST /api/voice/speak`** — `{ "text": "<English>", "languageCode": "hi-IN" }` (defaults
`en-IN`; anything else is translated before synthesis) → `{ "audio": "<base64 WAV>",
"languageCode": "hi-IN" }`.

Decode before playing (`atob` → `Uint8Array` → `Blob` of `audio/wav`). **Check `languageCode` in
the response, not the one you sent** — more languages can be transcribed than spoken, so a request
for one with no voice comes back as `en-IN` rather than failing. Over-long text is truncated at a
sentence boundary.

### 6.14 MCP tool server — `POST /api/mcp`

Lets an independent agent call §6.12's registry over the
[Model Context Protocol](https://modelcontextprotocol.io). Same tools, same `runTool`, same audit
trail — a transport on top of §6.12, not a second implementation.

**Auth:** an **OAuth access token from §6.15, never a copy-pasted human session JWT**. A human
login token gets `401` here, and symmetrically an agent token gets `401` from every human route. A
request with no token gets `401` plus a `WWW-Authenticate` header pointing at the
protected-resource metadata — which is what makes a real client's OAuth discovery kick in
automatically.

**Protocol:** MCP over Streamable HTTP — `initialize` → `tools/list` → `tools/call`. `tools/list`
returns every tool in §6.12, each `inputSchema` generated from the same Zod schema, plus per-tool
`annotations` (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`) so a client
can tell whether a retry is safe — `place_order` advertises `idempotentHint: true`, `add_to_cart`
advertises `false` because it's additive.

One tool is MCP-only:

| Tool | Notes |
|---|---|
| `search_products_nl` | Free-text `query`. One non-streaming LLM call turns it into the structured filters `search_products` takes, then calls it. Falls back to keyword search on any LLM failure — never a broken tool call. `search_products` itself stays LLM-free. Not offered to the chat agent, which is already an LLM and can build the filters itself. |

A `tools/call` result maps `runTool`'s `{ok, data}` / `{ok:false, error}` onto
`{content, structuredContent}` / `{isError, content}`. **Both branches set `structuredContent`**,
so `code` and `retryable` reach the client machine-readably instead of being flattened into prose.

Every call's `ToolContext.actor` is `{type: "agent", id: userId}` (vs the chat agent's
`{type: "user", …}`), so `audit_log` rows from MCP carry `actor_type = 'agent'` with no change to
any tool handler.

**A2A is not planned.** MCP calls typed tools with structured JSON args — no LLM needed on either
side for most of them. A2A sends one free-text instruction per skill with no structured-args call
in its wire protocol, so every A2A call would need this backend's LLM just to parse intent.

### 6.15 MCP OAuth — connecting an agent without a copy-pasted token

This backend is both Authorization Server and Resource Server for `/api/mcp` — `userService`
already is the identity source, so there's nothing to delegate to.

1. The client gets `401` from `/api/mcp` with `WWW-Authenticate`, discovers the AS from the
   metadata, and registers via `POST /oauth/register` (RFC 7591) — a `client_id`, no secret.
   Agents are public clients; PKCE is the protection, not a secret a headless process can't keep.
2. It opens `GET /oauth/authorize?…&code_challenge=…&code_challenge_method=S256` in a browser.
   **PKCE mandatory** — anything but `S256` is rejected. The backend validates `client_id` and
   that `redirect_uri` **exactly** matches one registered for it (no prefix match — this is the
   open-redirect guard), then 302s to `${PUBLIC_APP_URL}/agent-connect?request_id=…`, since this
   backend never renders HTML.
3. The human logs in and approves. That page calls `GET /api/oauth/authorize/:requestId` to render
   what's being approved, then `POST /api/oauth/authorize/decision` (behind `requireAuth`) with
   `{requestId, decision}`. Deliberately the human's *existing* login — approving is "prove you're
   logged in, then say yes." Response is `{redirectTo}`, back to the agent's `redirect_uri` with
   `?code=…&state=…` (or `?error=access_denied&state=…`).
4. The client exchanges the code at `POST /oauth/token` (`grant_type=authorization_code` plus
   `code_verifier`) for an access token (JWT, 24h) and a refresh token.
   `grant_type=refresh_token` renews it; refresh tokens **rotate on every use**, so a stolen one
   is replayable exactly once.

Tunnel setup, and the `OAUTH_ISSUER_URL` misconfiguration that makes a remote client fail to sign
in: root `README.md`.

#### Where the human is in the loop

Every connected agent gets one blanket `store:agent` scope covering the whole registry. This is
the sharpest thing to understand about this API:

> An OAuth-connected MCP agent can call `prepare_order` → `place_order` in one turn, and can call
> `start_reserve_pay_setup` to create a **new** block up to ₹10,000. The human's consent is the
> one-time OAuth approval plus the UPI PIN on the block — not a per-order confirmation. There is
> no scope, no spend cap, no per-agent limit; the ₹10,000 ceiling and the block's remaining
> balance are the only bounds. Deliberate, and the opposite of the chat agent, where `place_order`
> is never in the model's tool list at all. Accepted knowingly: agentic checkout is the product.

What still holds: every tool call is scoped to one user's data (an agent token for user A cannot
touch user B's cart, orders or addresses), every money-moving call writes an audit row naming the
actor, and the signed cart mandate records exactly what was agreed. What does not hold is
per-action authorization.

---

## 7. Things intentionally not built

Don't assume these exist; don't raise them as findings.

- **No Recovery Agent** — no payment-failure classifier, retry policy or customer-messaging path.
  `payment.failed` clears the pending checkout, writes an audit row, and stops.
- **No A2A transport** (§6.14).
- **No agent scope or spend-cap enforcement** — one blanket `store:agent` scope. The fuller
  "Intent Mandate" design (per-agent `scope`, `spend_cap`, an Agent Access settings page) was
  designed and deliberately not built.
- **No connected-agents view, no agent revocation.** `oauth_refresh_tokens` has the data but no
  endpoint exposes it. Access tokens are stateless 24h JWTs with no `jti` and no denylist, so
  revoking a refresh token doesn't stop a live access token.
- **No upsell/cross-sell** beyond `list_related_products`.
- **No order cancellation and no refunds**, for anyone. Agents can't modify orders either.
- **No logout that revokes** — logout clears client state, the JWT stays valid until expiry.
- **No wishlist, no coupons.** `discount` is always 0.
- **No stock quantities.** `inStock` is a boolean, nothing decrements on purchase, overselling
  isn't prevented.
- **No order-status transition rules.** Any status → any status; cancelling issues no refund.
- **No test suite.** Verification is `bun x tsc --noEmit` plus a manual money-path walkthrough.
- **No rate limiting on any route**, admin login included. The known gap most worth closing:
  `POST /api/chat` is up to 8 OpenRouter calls a turn, and signup is unlimited.
- **No password reset or email verification.** No email capability anywhere in the repo.
- **No multi-address "ship to"** beyond picking one saved address at checkout.
- **No server-enforced single default address** (§6.6).
- **No true COD** bypassing Razorpay (§6.8).
- **Admin surface is intentionally minimal** — one shared password, no per-admin accounts or
  roles, no user editing, no audit-log read endpoint, no export. Because the password is shared,
  `audit_log` can't attribute an admin action to a person; every admin row carries
  `actorId: "admin"`. Customer-facing order tracking isn't exposed.
- **Chat has no conversation-list endpoint**, no title editing, no delete.
- **`chat_messages.parts` carries no version stamp.** `CHAT_PROTOCOL_VERSION` guards the request;
  stored parts are replayed and stamped with the *current* version, so a part written under v3 is
  served as v4. Mitigated client-side (the store has a `migrate` that drops the transcript);
  unaddressed server-side. **Treat every new field on a part as optional.**
- **Reserve Pay needs `RESERVE_PAY_SIM=true`** on this account (§6.11).
