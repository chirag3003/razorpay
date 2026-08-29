# Backend API Reference

This is the integration contract for `backend/`. It exists so a frontend engineer (human or AI
agent) can wire up `web/` — or any other client — **without reading backend source**. If something
here ever disagrees with the code, the code wins; but if you find a mismatch, fix this file in the
same change.

Out of scope / not built yet: agent tokens, mandates, Reserve Pay, A2A/MCP. Everything below is
plain REST — session-auth for the human storefront (§2–§6.9), plus a password-gated admin
surface for a merchant dashboard (§6.10). See `backend/CLAUDE.md` if you're changing backend
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

**Admin auth is a completely separate mechanism** (see §6.10). The admin dashboard endpoints
under `/api/admin/*` are gated by their own token: `POST /api/admin/login` takes a single
shared password (`ADMIN_PASSWORD` in `backend/.env`) and returns an admin JWT signed with a
different secret (`ADMIN_JWT_SECRET`), 12-hour expiry, payload `{ role: "admin" }` with **no
`sub`**. A user token is never accepted on an `/api/admin` route and an admin token is never
accepted on a storefront route — they are not interchangeable in either direction.

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
| 401  | `UNAUTHORIZED`               | Missing/invalid/expired bearer token, bad login credentials, or wrong admin password |
| 403  | `FORBIDDEN`                  | Reserved for admin-authorization failures — defined, not currently returned by any route |
| 404  | `NOT_FOUND`                  | Category/product/address/order/cart-item doesn't exist (message says which, e.g. `"Product not found"`) |
| 409  | `CONFLICT`                   | Signup with an already-registered email; admin create with a duplicate slug; admin delete of a category that still has products |
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
  archivedAt: string | null;  // storefront responses always null (archived rows are filtered
                              // out); admin responses (§6.10) can be an ISO timestamp
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
  paymentMethod: string;  // "razorpay" by default (the storefront no longer collects a method
                          // up front — Razorpay Checkout does). May still be "upi" | "card" |
                          // "netbanking" | "cod" if a caller passed one to /checkout/initiate.
  razorpayOrderId: string;
  razorpayPaymentId: string;
  subtotal: number;
  deliveryFee: number;
  discount: number;        // always 0 for now — no promo/coupon system yet
  total: number;
  status: "placed" | "shipped" | "delivered" | "cancelled";  // starts "placed"; only an admin
                                                             // (§6.10) can change it
  placedAt: string;         // ISO timestamp
  items: Array<{ productId: string; qty: number; priceAtPurchase: number; product: Product /* raw shape */ }>;
}
```
`priceAtPurchase` is the frozen per-unit price at order time — use this for order-history display,
not the live `product.price` (which can have changed since).

### AdminOrder (returned from the `/api/admin/orders*` endpoints — §6.10)
The `Order` shape above **plus** the buyer (admins aren't scoped to one user):
```ts
Order & { buyer: { id: string; name: string; email: string; phone: string } }
```

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
POST   /api/reserve-pay/mandates/:id/revoke  auth stops further debits (local only)
POST   /api/reserve-pay/mandates/debit   auth     test harness: debit without an order

POST   /api/chat                         auth     SSE; the storefront chat agent
GET    /api/chat/:conversationId         auth     rendered transcript, no model call

POST   /api/admin/login                  public   password -> admin JWT
GET    /api/admin/dashboard              admin    summary counts + recent orders
GET    /api/admin/orders                 admin    filters + pagination
GET    /api/admin/orders/:id             admin
PATCH  /api/admin/orders/:id/status      admin    { status }
GET    /api/admin/products               admin    no storefront in-stock/archived filtering
POST   /api/admin/products               admin
PATCH  /api/admin/products/:id           admin    partial; { archived } toggles archive
DELETE /api/admin/products/:id           admin    hard-delete, or archive if order-referenced
GET    /api/admin/categories             admin    includes productCount per category
POST   /api/admin/categories             admin
PATCH  /api/admin/categories/:id         admin    partial
DELETE /api/admin/categories/:id         admin    409 if the category still has products
GET    /api/admin/users                  admin    read-only, paginated
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

### 6.3a `PATCH /api/auth/me`
Auth required. Body is any subset of `{ "name": string, "email": string, "phone": string }` —
send only the fields being changed. `200 { "user": {...} }` (same `User` shape as everywhere
else). `409 CONFLICT` if `email` is set to one already used by a different account (same
non-enumerating behavior as signup — see §3). Password is not changeable via this endpoint (no
change-password flow exists yet).

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
{ "addressId": "<uuid, must belong to caller>", "deliverySlot": "Today, 4-6 PM" }
```
`paymentMethod` is **optional** and defaults to `"razorpay"`. The storefront no longer collects a
payment method up front — Razorpay Checkout asks the user which method to use. If a caller does
send one it must be `"upi" | "card" | "netbanking" | "cod"`, and **it is stored for display only;
it does not change what Razorpay Checkout actually shows the user**. `"cod"` still goes through
the same Razorpay-order flow today (there is no separate pay-on-delivery path that skips
Razorpay). If you want a true COD option that bypasses online payment, that's not built — flag it
rather than assuming `"cod"` does that.

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

### 6.10 Admin

Store-operator endpoints for a merchant dashboard. **Separate auth from everything above** (see
§2): get a token from `POST /api/admin/login`, then send `Authorization: Bearer <admin token>`
on every other `/api/admin/*` call. A missing/invalid/expired admin token → `401 UNAUTHORIZED`.
There is one shared admin identity — no per-admin accounts, no roles. Every mutating call writes
an `audit_log` row (`actor_type = "admin"`).

#### 6.10.1 `POST /api/admin/login`
Public. Request `{ "password": "..." }` (checked against `ADMIN_PASSWORD`).
`200 { "token": "eyJ..." }` — the admin JWT, valid 12h. `401 UNAUTHORIZED` on a wrong password.

#### 6.10.2 `GET /api/admin/dashboard`
`200`:
```json
{
  "orders":  { "total": 128, "byStatus": { "placed": 12, "shipped": 40, "delivered": 74, "cancelled": 2 } },
  "revenue": { "allTime": 348200, "last30Days": 91400 },
  "catalog": { "products": 60, "archived": 3, "categories": 8, "outOfStock": 4 },
  "users":   { "total": 51 },
  "recentOrders": [ /* AdminOrder[], up to 10, newest first */ ]
}
```
`revenue` sums `order.total` (whole rupees) over every order whose status isn't `"cancelled"`;
`last30Days` further restricts to `placedAt` within the last 30 days. `catalog.products` counts
non-archived products only; `catalog.archived` is the archived count.

#### 6.10.3 `GET /api/admin/orders`
All query params optional:

| param      | type                                                    | default   |
|------------|--------------------------------------------------------|-----------|
| `status`   | `placed` \| `shipped` \| `delivered` \| `cancelled`     | (all)     |
| `userId`   | uuid — orders for one buyer                              | (all)     |
| `dateFrom` | ISO-8601 datetime — `placedAt >=`                        | (none)    |
| `dateTo`   | ISO-8601 datetime — `placedAt <=`                        | (none)    |
| `q`        | substring match on `orderNumber` (case-insensitive)     | ""        |
| `sort`     | `newest` \| `oldest` \| `total-desc` \| `total-asc`      | `newest`  |
| `page`     | positive integer                                         | 1         |
| `pageSize` | positive integer, max 100                                | 20        |

`200 { "items": AdminOrder[], "total": number, "page": number, "pageSize": number }` — same
`{ items, total, page, pageSize }` envelope as `GET /api/products`.

#### 6.10.4 `GET /api/admin/orders/:id`
`200 { "order": AdminOrder }`. `404 NOT_FOUND` if the id is unknown (no ownership scoping — an
admin sees every order).

#### 6.10.5 `PATCH /api/admin/orders/:id/status`
Body `{ "status": "shipped" }` — must be one of the four values. `200 { "order": AdminOrder }`.
`404` if the id is unknown; a value outside the set is a `400` validation error (§3). No
transition rules — any status can move to any other (including back to `"placed"`).

#### 6.10.6 `GET /api/admin/products`
The admin catalog view — unlike `GET /api/products` it does **no** implicit in-stock or archived
filtering. Query params (all optional): `q` (name substring), `category` (single slug),
`archived` = `exclude` (default) \| `only` \| `all`, `inStock` = `"true"` \| `"false"`,
`sort` = `newest` (default) \| `name-asc` \| `price-asc` \| `price-desc`, `page` (1),
`pageSize` (max 100, default 20). `200 { "items": Product[], "total", "page", "pageSize" }` —
`Product` including `archivedAt` (§4).

#### 6.10.7 `POST /api/admin/products`
Body:
```json
{
  "name": "Cold Pressed Olive Oil",
  "categorySlug": "staples-grains",
  "price": 499,
  "mrp": 560,
  "unit": "500 ml",
  "image": "https://.../olive-oil.jpg",
  "images": ["https://.../olive-oil.jpg", "https://.../olive-oil-2.jpg"],
  "description": "First cold press, single origin.",
  "inStock": true,
  "tags": ["new"]
}
```
`images` (defaults to `[image]`), `inStock` (defaults `true`) and `tags` (defaults `[]`) are
optional. `slug` is generated from `name` (with a `-2`, `-3`… suffix on collision) — not client
-supplied. `rating`/`ratingCount` start at 0. `201 { "product": Product }`. `404 NOT_FOUND` if
`categorySlug` doesn't match a category.

#### 6.10.8 `PATCH /api/admin/products/:id`
Body is any non-empty subset of the create fields, **plus** `"archived": boolean` —
`true` stamps `archivedAt` (product disappears from the storefront and from add-to-cart, stays
visible here and in past orders), `false` clears it. `200 { "product": Product }`. `404` if the
id — or a supplied `categorySlug` — is unknown.

#### 6.10.9 `DELETE /api/admin/products/:id`
Tries a hard delete. If no order references the product → `204`, empty body. If a past order
does (the line item must survive) → the product is **archived instead** and the response is
`200 { "product": Product, "archived": true }`. `404` if the id is unknown.

#### 6.10.10 `GET /api/admin/categories`
`200 { "categories": Array<Category & { productCount: number }> }`, alphabetical by name.
`productCount` counts all products in the category (archived included).

#### 6.10.11 `POST /api/admin/categories`
Body `{ "name", "description", "icon", "image", "slug"? }` — `icon` is a Lucide icon name
(e.g. `"Carrot"`), `slug` is derived from `name` if omitted. `201 { "category": Category }`.
`409 CONFLICT` if the slug is already taken.

#### 6.10.12 `PATCH /api/admin/categories/:id`
Any non-empty subset of `{ name, description, icon, image, slug }`. `200 { "category": Category }`.
`404` if unknown; `409 CONFLICT` if `slug` collides with another category.

#### 6.10.13 `DELETE /api/admin/categories/:id`
`204` on success. `409 CONFLICT` if any product still references the category (reassign or delete
those products first — categories are hard-delete only, no archive). `404` if unknown.

#### 6.10.14 `GET /api/admin/users`
Read-only. Query: `q` (substring on name or email), `page` (1), `pageSize` (max 100, default 50).
`200 { "items": Array<{ id, name, email, phone, createdAt }>, "total", "page", "pageSize" }`.
`passwordHash` is never included. No create/update/delete for users.

---

### 6.11 UPI Reserve Pay (SBMD)

> **Blocked on Razorpay account activation.** Every endpoint below is implemented, but
> `/v1/payments/create/json` (Razorpay's server-to-server payment API) is **not enabled on this
> test account** — it answers `400 BAD_REQUEST_ERROR "The requested URL was not found on the
> server."` for *any* payment, recurring or not. Creating the SBMD authorisation order already
> works, so the blocker is one support request: ask Razorpay to enable the S2S JSON API, UPI
> Reserve Pay (SBMD), and `save_vpa` on the account. Until then `POST /api/reserve-pay/mandates`
> returns `502 PAYMENT_GATEWAY_ERROR`.

**What this is.** Reserve Pay blocks a customer's funds once, against a single UPI PIN approval,
and lets the merchant debit that block repeatedly with no further customer interaction. That
headless second half is the point: a chat interface or an external AI agent cannot drive a
Razorpay Checkout popup, so every AI-initiated payment runs on this rail.

**Lifecycle.**
```
1. POST /api/reserve-pay/mandates          -> mandate (status "pending") + intentUrl
2. Customer opens intentUrl in their UPI app and approves with their PIN   <- the only human step
3. GET  /api/reserve-pay/mandates/:id      -> poll until status becomes "confirmed"
4. POST /api/cart/checkout/reserve-pay     -> debits the block, returns a real Order. Repeat
                                              freely until the block is exhausted or expires.
```

**Mandate shape** (returned by every endpoint in this section):
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
  "intentLinks": {
    "generic": "upi://mandate?pa=...",
    "gpay": "gpay://upi/mandate?pa=...",
    "phonepe": "phonepe://mandate?pa=...",
    "paytm": "paytmmp://mandate?pa=...",
    "bhim": "bhim://upi/mandate?pa=...",
    "cred": "credpay://upi/mandate?pa=...",
    "whatsapp": "whatsapp-consumer://upi/mandate?pa=..."
  },
  "expiresAt": "2026-11-25T...",
  "confirmedAt": null,
  "createdAt": "2026-08-27T..."
}
```
Amounts are in **paise** here, unlike the rest of this API — these fields are reconciled directly
against Razorpay's own figures, so they carry Razorpay's unit. The `*InRupees` fields are
provided for display. `intentLinks` is `null` until Razorpay returns a deep link, and individual
app links let a client skip the OS app chooser; `generic` is the safe default.

**`POST /api/reserve-pay/mandates`** — body `{ "amountInRupees": 500, "expiryDays": 90 }`.
`amountInRupees` is a whole number, max **10,000** (regulatory cap). `expiryDays` is optional,
max **90**, defaults to **30**. Returns `201 { mandate }` with `status: "pending"` and the
`intentUrl` to send the customer to.
- `409 CONFLICT` if the account already has a live mandate — revoke it first. One live mandate
  per user, enforced by a partial unique index, so two concurrent calls can't double-block funds.
  A `pending` mandate the customer abandoned is aged out automatically after 15 minutes, so an
  unfinished approval never locks them out permanently.
- `400 MANDATE_AMOUNT_EXCEEDED` / Zod `400` if the amount or expiry is out of range.
- `502 PAYMENT_GATEWAY_ERROR` carries Razorpay's own description verbatim.

**`GET /api/reserve-pay/mandates/current`** — `200 { "mandate": null }` when the caller has none.
This is what a checkout screen calls to decide whether to offer Reserve Pay at all.

**`GET /api/reserve-pay/mandates/:id`** — **re-syncs from Razorpay before responding**, so it
writes as well as reads. This is the endpoint to poll while the customer is approving: it is what
picks up the token id, flips `status` to `confirmed`, and fills in `amountBlockedPaise` and
`vpa`. Terminal mandates short-circuit and cost no Razorpay round-trip.

**`GET /api/reserve-pay/mandates`** — `200 { mandates: [...] }`, newest first, including terminal
ones. Mandate history is kept, not overwritten.

**`POST /api/reserve-pay/mandates/:id/revoke`** — `200 { mandate }` with `status: "revoked"`.
Cancels the mandate at Razorpay, which **unblocks the customer's remaining funds and credits
them back instantly**, and stops us debiting it. If Razorpay/NPCI rejects the cancellation the
mandate is still marked revoked locally and `failureReason` carries the gateway's reason — in
that case the funds stay blocked until Razorpay auto-reverses them 10 minutes before expiry, so
surface `failureReason` if it is set. `409 MANDATE_NOT_ACTIVE` if it was already terminal.

**`POST /api/reserve-pay/mandates/debit`** — body `{ "amountInRupees": 50, "description": "..." }`.
Charges the caller's live mandate **without creating an order**. This is a test harness for
exercising the rail without a cart; real purchases go through the checkout endpoint below, which
produces an order row for the money it moves. Returns `201` with the debit and Razorpay ids.

**`POST /api/cart/checkout/reserve-pay`** — the headless counterpart to §6.8. Body is identical
to `/checkout/initiate`: `{ "addressId": "<uuid>", "deliverySlot": "Today, 4-6 PM" }`. Returns
`201 { order }` — the **same** `Order` shape §6.8 returns. No `keyId`, no Checkout.js, no
signature round-trip; one call in, a finished order out.

It runs the same cart and address validation as `/checkout/initiate` (so `400 EMPTY_CART` and
`400 INVALID_ADDRESS` behave identically), then the mandate guard chain **in this order**:

| Error | Code | Meaning |
|---|---|---|
| `409` | `MANDATE_NOT_ACTIVE` | no mandate, or it is paused/revoked/failed/expired/exhausted |
| `409` | `MANDATE_EXPIRED` | past `expiresAt` |
| `400` | `MANDATE_AMOUNT_EXCEEDED` | this single charge exceeds the per-transaction cap |
| `402` | `INSUFFICIENT_BLOCKED_BALANCE` | not enough left in the block |

The order matters: a caller learns its mandate is unusable before it learns anything about
balances. The balance is re-synced from Razorpay before the check, so it is never decided on a
stale local count.

**Webhooks.** Reserve Pay adds three kinds of Razorpay order to the system (browser checkout,
mandate authorisation, mandate debit) and they all arrive on the same `/webhooks/razorpay`
endpoint, which now dispatches on order id. `payment.authorized` is handled alongside
`payment.captured` (a Reserve Pay authorisation often reports as the former), as are
`token.confirmed` / `token.rejected` / `token.cancelled` / `token.paused`. Nothing here is
client-facing, but note that a mandate can become `confirmed` via the webhook without anyone
polling.

---

### 6.12 Agent tool layer (not HTTP)

**This is not a REST surface.** It's an in-process TypeScript registry at
`src/agent-interfaces/tools/`, imported and called directly by the AI layer. It is documented here
because it is the contract the chat agent codes against, and because the A2A and MCP adapters will
expose exactly these tools when they land.

**Why it exists.** The REST endpoints above assume a browser holding a session JWT and return
shapes a React page renders — a single catalog page is ~2,200 tokens, most of it placeholder image
URLs and one boilerplate description repeated across all 58 products. Agents need the same
*actions* with model-shaped inputs, compact outputs, and failures they can recover from.

### Calling it

```ts
import { runTool, toAnthropicTools } from "./agent-interfaces/tools/registry";

const ctx = {
  actor: { type: "agent", id: "<agent or token id>" },  // who is acting — audit rows use this
  userId: "<uuid>",                                     // whose data
  conversationId: "<optional, for audit correlation>",
};

const result = await runTool(ctx, "search_products", { q: "milk" });
```

**Authentication happens above this layer.** The caller resolves the session and passes `userId`;
tools trust it exactly as a route handler trusts `c.get("userId")` after `requireAuth`. Agent
tokens with scopes and spend caps are the next phase and slot into `ctx.actor` without changing
any tool.

`toAnthropicTools()` returns `{name, description, input_schema}` generated from each tool's Zod
schema via zod-4's `z.toJSONSchema`; `toMcpTools()` returns the same with `inputSchema`.

### `runTool` never throws

Every call returns a discriminated result, because a model can't catch an exception:

```ts
{ ok: true,  data: { ... } }
{ ok: false, error: { code, message, retryable, hint? } }
```

`hint` is the important field — it tells the model what to do next, which is what turns a failure
into a recovery rather than a stall. Codes: `invalid_input`, `not_found`, `cart_empty`,
`product_unavailable`, `invalid_address`, `invalid_slot`, `mandate_missing`, `mandate_expired`,
`mandate_revoked`, `reserve_insufficient`, `amount_exceeds_mandate_limit`, `quote_expired`,
`quote_superseded`, `cart_changed`, `payment_declined`, `payment_gateway_unavailable`, `conflict`,
`server`. They're named to map mechanically onto `ChatErrorCode` in `web/lib/chat/protocol.ts`.

### The tools

| Tool | Writes | Notes |
|---|---|---|
| `search_products` | | Matches names and tags, **not** descriptions. `category` is OR, `tag` is AND. |
| `get_product` | | Accepts a slug or an id. |
| `list_categories` | | The fallback for vague requests — pick a category instead of guessing keywords. |
| `list_related_products` | | Same-category, unranked. |
| `get_cart` | | |
| `add_to_cart` | ● | Quantity is **additive**. Rejects out-of-stock; caps a line at 20. |
| `update_cart_item` | ● | Absolute quantity, minimum 1. |
| `remove_from_cart` / `clear_cart` | ● | |
| `list_addresses` / `create_address` | ● | |
| `list_delivery_slots` | | `prepare_order` accepts only these ids. |
| `get_payment_status` | | `none` / `active` / `expired` / `revoked` / `insufficient`, plus the shortfall. Falls back to local ledger state if the provider is unreachable, flagged as `stale`. |
| `start_reserve_pay_setup` | ● | Returns the UPI intent link the customer must approve. |
| `check_reserve_pay_status` | | Always contacts the provider — this is the polling tool. |
| `prepare_order` | ● | Issues a signed quote. Takes no money. |
| `place_order` | ● | Charges. Idempotent on `quoteId`. |
| `list_orders` / `get_order` | | **Read-only.** Agents cannot cancel, refund, or change an order's status. |

Outputs mirror `web/lib/chat/protocol.ts` (`ChatProduct`, `ChatCartLine`, `ChatAddress`,
`ChatSlot`, `ChatMandate`) so the AI layer can pass them nearly straight into a message part.
**All money is integer rupees**, including the mandate figures, which are converted from the paise
the Reserve Pay tables store.

### Ordering is two-phase

```
prepare_order({addressId, slotId})  ->  quote { quoteId, lines, totals, payment, expiresAt }
        (show the customer, get an explicit yes)
place_order({quoteId})              ->  { order, alreadyPlaced }
```

`prepare_order` writes a **Cart Mandate** — a signed, per-transaction record of exactly what was
agreed (`cart_mandates` table), distinct from the Reserve Pay mandate's standing authority. It
buys three things:

- **Idempotency.** A consumed quote records the order it produced, so a retried `place_order`
  returns that order (`alreadyPlaced: true`) instead of buying the cart twice.
- **Invalidation.** The quote carries a fingerprint of the cart. Change the cart afterwards and
  `place_order` fails with `cart_changed` rather than charging a basket nobody approved.
- **Tamper evidence.** The record is HMAC-signed; a modified row fails its integrity check.

Only one quote is open per customer at a time — calling `prepare_order` again supersedes the
previous one. Quotes expire after 15 minutes.

**Known limitation:** `place_order` delegates to `orderService.checkoutWithReservePay`, which
re-derives its snapshot from the live cart at charge time. The fingerprint check runs immediately
before the charge, so the window is sub-millisecond and same-customer-only, but a cart mutated
inside it would be charged at its new total. Any divergence is recorded in the audit row
(`quotedTotal` vs `chargedTotal`).

**Reserve Pay is blocked on account activation** (see §6.11), so `start_reserve_pay_setup` and
`place_order` return `payment_gateway_unavailable` today. Everything else works.

---

### 6.13 Storefront chat agent — `POST /api/chat`

The first-party Growth Agent. An LLM over OpenRouter, calling **only** the tool layer in §6.12,
streaming back the exact `ServerEvent` union the frontend already defines in
`web/lib/chat/protocol.ts`.

**Auth:** `Authorization: Bearer <user jwt>`, like every other route.
**Response:** `text/event-stream`, one JSON `ServerEvent` per `data:` frame.

#### Request

```jsonc
{
  "conversationId": "uuid",       // client-generated; created server-side on first use
  "token": "…",                   // accepted for wire compatibility, IGNORED (see below)
  "turn": { "kind": "text", "text": "what milk do you have" },
  "clientState": { "route": "/products", "recentActions": [] },
  "protocolVersion": 1
}
```

`turn` is one of:

| kind | shape |
|---|---|
| `text` | `{ kind: "text", text }` |
| `widget_action` | `{ kind: "widget_action", partId, action }` — `action` is the `WidgetAction` union |
| `resume` | `{ kind: "resume" }` — replays the stored transcript, no model call, no tokens spent |

`protocolVersion` must equal the server's `CHAT_PROTOCOL_VERSION` (currently `1`) or the request
is rejected **before** the stream opens, with `400 PROTOCOL_VERSION_MISMATCH`. Bump it on both
sides whenever a part's shape changes.

#### Response frames

```
data: {"type":"message_start","messageId":"…"}
data: {"type":"part_start","part":{"type":"text","partId":"text-1-ab3","text":"","done":false}}
data: {"type":"text_delta","partId":"text-1-ab3","delta":"Here's what I "}
data: {"type":"part_end","partId":"text-1-ab3"}
data: {"type":"part_start","part":{"type":"product_results","partId":"products-2-9fk","products":[…]}}
data: {"type":"part_end","partId":"products-2-9fk"}
data: {"type":"message_end","messageId":"…"}
```

An unrecoverable failure arrives as a frame, never as a dead connection:
`{"type":"error","code":"server","message":"…","retryable":true}`. The stream still closes with
`message_end`.

#### Widgets are projected, never authored by the model

The model is not given "UI tools". When a tool returns, the server deterministically builds the
widget from **that tool's own data** (`src/chat/partMapper.ts`):

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

So **every rupee the customer sees came out of Postgres**, not out of a sampler. That is root
`claude.md` Hard Rule #1 applied to the UI as well as to the debit.

Multiple cart mutations in one turn collapse to a single trailing `cart_summary`. Other widgets
stream out the moment their tool returns.

Tool failures mostly do *not* produce an `error` part — `not_found`, `cart_empty` and
`invalid_input` are things the model recovers from using the failure's `hint`, and a red box for
"that slug doesn't exist" is noise. Only failures the **customer** must act on are rendered:
`mandate_expired`, `mandate_revoked`, `reserve_insufficient`, `amount_exceeds_mandate_limit`,
`payment_declined`, `payment_gateway_unavailable`.

#### The hard gate on `place_order`

**`place_order` is never sent to the model at all** — not on any turn, confirmed or otherwise.
On a `turn.action.type === "review.confirm"` widget action, `chatService` resolves the customer's
one open quote itself and calls `place_order` directly, with no model round trip involved in the
decision.

It is not a rule in a system prompt, and it is not even a per-turn *unlock* of the function — the
function is simply never in the JSON sent to the model. `review.confirm` carries no payload (no
quoteId), so there was never a decision for a model to make: the widget action plus server state
already determine the entire call. A prompt injection hidden in a product name, a hallucinated
call, a retry storm: none can place an order, because there is nothing to call, ever. A customer
who types "yes, place it" is told to tap Confirm on the review card; that tap goes straight to the
tool, not through the model.

#### `clientState` is not trusted

`route` and `recentActions` are read as hints. Everything that could influence a purchase — cart,
addresses, Reserve Pay balance, open quote — is rebuilt from the database each turn and injected
as a server-truth context block. This also removes three tool round-trips from the start of
almost every conversation.

`recentActions` matters: the storefront batches cart taps made outside the chat panel and sends
them with the next turn, which is how the agent knows not to re-add what the customer already
added by hand.

#### Conversations

Stored in `conversations` + `chat_messages`. `chat_messages.content` holds the raw model message
(including tool calls and results) so a conversation resumes verbatim; `chat_messages.parts` holds
the rendered `MessagePart[]` that a `resume` turn replays. The conversation id is passed to every
tool as `ToolContext.conversationId`, so an order's `audit_log` rows carry it — that is what links
a placed order back to the conversation that placed it.

`GET /api/chat/:conversationId` returns `{ conversationId, protocolVersion, messages: [{id, parts}] }`
for rehydrating a panel without a model call.

Aborting the request (closing the panel) propagates to the OpenRouter call, so tokens stop being
billed immediately, and nothing from the partial turn is persisted.

#### Model configuration

`OPENROUTER_MODEL` is the entire provider swap — Claude, GPT, Llama, anything on OpenRouter.
`OPENROUTER_FALLBACK_MODEL` is passed in the same request as a server-side failover, so a dead
primary costs no extra round trip. There is no LangChain-style provider abstraction because
OpenRouter already is one.

#### What the frontend still has to do

The backend is complete; `web/` has not been touched.

1. **Implement `createSseTransport()`** in `web/lib/chat/transport.ts` and return it from
   `getChatTransport()`. POST to `/api/chat` with the bearer token, read `text/event-stream`,
   `JSON.parse` each `data:` frame, yield as `ServerEvent`. The store and every widget already
   speak this — nothing else changes.
2. **`ChatRequest.token` is vestigial.** Auth is the `Authorization` header. Keep sending the
   field or drop it.
3. **Re-read the cart when a `cart_summary` part arrives.** The agent now mutates the *server*
   cart through `add_to_cart`, so the Zustand store must refresh. No protocol change needed —
   `cart_summary` is already `live` lifecycle.
4. **`buildClientState` should stop calling `mock-reserve-pay`** (`client-state.ts:44`). Cosmetic
   only: the backend ignores `clientState.mandate` and uses server truth.
5. **`web/lib/chat/mock-*.ts` (~870 lines) can be deleted** once the SSE transport lands.

**Reserve Pay is still blocked on account activation** (§6.11), so `start_reserve_pay_setup` and
the debit inside `place_order` return `payment_gateway_unavailable`. That surfaces as an `error`
part with `code: "bank_not_available"`, which `web/components/chat/widgets/error-widget.tsx`
already renders. Everything else in the chat flow works today.

---

## 7. Things intentionally not built (don't assume these exist)

- No password reset / email verification / OAuth — signup+login only.
- No coupons/discounts — `discount` is always `0`.
- No multi-address "ship to" selection beyond picking one saved address at checkout time.
- No server-enforced single default address (see §6.6 note).
- No true cash-on-delivery bypass of Razorpay (see §6.8 note on `paymentMethod: "cod"`).
- **Admin surface (§6.10) is intentionally minimal:** one shared password, no per-admin
  accounts or roles/RBAC, no order-status transition rules, no editing/deleting users, no
  audit-log read endpoint, no CSV/export, no login rate-limiting. Customer-facing order
  tracking is still not exposed (`status` changes are admin-only and not surfaced to the buyer).
- No A2A or MCP transport. The tool layer (§6.12) is shaped so both adapters wrap it unchanged,
  but neither exists — the only caller today is the first-party chat agent (§6.13).
- The chat agent has **no upsell tooling beyond `list_related_products`**, no conversation list
  endpoint, no title editing, and no way to delete a conversation.
- No agent tokens. `ToolContext.actor` is shaped for them, but there is no `agent_tokens` table,
  no scope or spend-cap enforcement, and no `verifyAgentToken` middleware. Whoever calls the tool
  layer is trusted to have authenticated the user.
- Agents cannot modify orders. No cancel, no refund, no status change — §6.12's order tools are
  read-only, and there is no refund code anywhere in the backend.
- No stock quantities. `products.inStock` is a boolean; nothing decrements on purchase, so
  "only 3 left" is not expressible and overselling is not prevented.
- **Reserve Pay is blocked on account activation.** See the note at the top of §6.11 — the code
  is complete but `/v1/payments/create/json` is not enabled on the test account, so no mandate
  can be authorised yet.
