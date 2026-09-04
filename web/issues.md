# Web — open issues and work queue

Verified against `main` at `dbcaabc`. Ordering is by priority, not by file.

The backend's own register is `backend/issues.md`; `handled.md` at the repo root lists what
already fails gracefully on both sides — read it before adding a new error path.

**Two items previously in this file are done and have been removed:** the
`OrderReviewPart.payment.tokenId` compatibility break (`CHAT_PROTOCOL_VERSION` is now **4** on
both sides) and the `/agent-connect` consent-page spec (the page exists at
`app/agent-connect/page.tsx`).

---

## P0 — bugs

### 1. Profile edits appear to save, then revert

`PATCH /api/auth/me` **is** implemented (`backend/src/routes/auth.ts`, documented in `API.md`
§6.3a) and `lib/api/auth.ts:updateProfile` calls it correctly. Two separate faults make it look
broken anyway:

- `app/(shop)/(protected)/account/page.tsx:74` awaits `updateProfile` and toasts success, but
  **never updates `useAuthStore`**. The form is driven by `useForm({ values: user … })` (`:64`),
  so react-hook-form resets the fields back to the stale store values on the next render — the
  edit looks discarded, and the header still shows the old name until a reload.
- The `catch` at `:77` hardcodes `"Profile editing isn't available yet"`, so a real failure — a
  409 on an email already in use, or a validation error — is reported as a missing feature.

Fix: set the returned user into the store, and surface `ApiError.message` (409 → "that email is
already in use"). Also delete the stale comment at `lib/api/auth.ts:29-30`
("Not implemented by the backend yet — see backend/issues.md"), which is no longer true.

### 2. An expired session has no recovery path

A 401 is only acted on inside `store/auth-store.ts:hydrateFromServer` (`:53`). Any *other* 401 —
the 7-day JWT lapsing mid-session — surfaces as whatever toast the individual call site writes.
The user is never logged out and never redirected, so every subsequent action fails with
"Invalid or expired token" and there is no way out except clearing storage.

`store/admin-auth-store.ts` already solves this for the admin surface by funnelling every API
failure through one handler that tears the session down on 401 and leaves everything else
retryable. Do the same for the user session, then redirect to `/login?next=<current path>` — the
`next` parameter is already honoured by `components/product/add-to-cart-button.tsx`.

### 3. Cart quantity taps can display the wrong number

`store/cart-store.ts:39-52` — `addItem`, `updateQty` and `removeItem` each await a full round trip
and then overwrite `cart` with the response. There is no optimistic update, no debounce, and no
in-flight de-duplication, so:

- every `+`/`-` tap waits on the network before the number moves (the most visible latency in the
  app), and
- tapping quickly fires N concurrent requests whose responses can resolve **out of order**,
  leaving the displayed quantity wrong until the next fetch.

Fix both together: apply the change locally first, then reconcile with the server response, and
either serialise mutations per item or drop responses older than the latest issued request.

### 4. A successful payment can be reported as a failure

`app/(shop)/(protected)/checkout/page.tsx:119` — inside Razorpay's `handler`, if `verifyCheckout`
throws (a network blip in the moment after capture), the user gets a red
"Payment verification failed" toast (`:130`) and is left on the checkout page. Their money is
gone and the UI says the order did not happen.

The order *is* created server-side by the `payment.captured` webhook, so the recovery exists and
is simply not surfaced. Show a "confirming your payment" state instead and poll `GET /api/orders`
for the order, falling back to a "we'll email you if this doesn't resolve" message rather than an
error. Never present a post-capture failure as a plain failure.

### 5. `PROTOCOL_VERSION_MISMATCH` offers a retry that cannot succeed

`lib/chat/sse-transport.ts:112-125` maps every non-401/403 failure to
`{type: "error", code: "server", retryable: true}`, so the backend's deliberate 400 on a protocol
mismatch renders an ErrorWidget with a "Try again" button that will fail identically forever — the
mismatch cannot self-heal client-side. Special-case the code to a non-retryable
"reload to update the app" state. The 400 is intentional (loud rather than silently rendering
`undefined` fields); the retry affordance is what is wrong.

### 6. An out-of-range page number renders an empty grid

`app/(shop)/products/page.tsx:52-53` computes `totalPages` and clamps `currentPage` **after** the
fetch has already used the raw `page`, so `?page=999` fetches nothing and then shows pagination
sitting on the last page with no products between. Clamp before fetching, or redirect.

### 7. Paginated results can repeat or skip products

Frontend symptom of a backend cause: `productService` applies no tiebreaker to any sort, so rows
with equal sort keys come back in planner order, which is not stable across pages. Tracked as
`L6` / P1 item 10 in `backend/issues.md`. **No frontend change needed** — listed here so it is not
re-diagnosed as a pagination bug in this codebase.

### 8. A network blip blanks the whole PDP or category page

`app/(shop)/products/[slug]/page.tsx` and `categories/[slug]/page.tsx` rely on `notFoundToNull`
(`lib/api/catalog.ts:23`), which only intercepts `ApiError` with code `NOT_FOUND`; a
`NETWORK_ERROR` or 5xx re-throws to `app/(shop)/error.tsx` and replaces the entire page.

The home page one directory over already does this correctly — `app/(shop)/page.tsx:14-17`
catches per section, so a failing endpoint degrades that section only. Adopt the same pattern:
the product itself still justifies the error boundary, but the related-products and category
strips should degrade to an `ErrorState` in place.

### 9. Lint warnings

`bun run lint` is clean of errors but reports 9 `react-hooks/set-state-in-effect` warnings. Most
are cosmetic (`theme-toggle.tsx`, `ui/carousel.tsx`); `hooks/use-admin-list.ts:50` is the one that
costs a real extra render on every admin list fetch.

---

## P1 — feature removals

### 10. Remove the wishlist completely

Not "fix the wishlist" — remove it. It was never a real feature: there is no table, no API, and no
cross-device persistence. It is `localStorage` under a fixed key with no user id in it and nothing
clearing it on logout, so **on a shared device, logging in as a second user shows the first
user's wishlist** — a genuine privacy problem on a shopping site. `/wishlist` also sits outside
the `(protected)` route group, so it renders while logged out. Deleting the feature removes the
leak; patching it would mean building the backend half.

Touches: `store/wishlist-store.ts`, `app/(shop)/wishlist/page.tsx`,
`components/product/wishlist-button.tsx`, and the entry points in
`app/(shop)/products/[slug]/page.tsx`, `components/product/product-card.tsx`,
`components/layout/account-menu.tsx`, `components/layout/mobile-nav.tsx` and
`components/layout/footer.tsx`.

### 11. Remove the promo-code input

`app/(shop)/(protected)/cart/page.tsx:80-82` renders a styled `InputGroupInput` placeholder
"Promo code" and an "Apply" `InputGroupButton` **with no handler at all**. The backend hardcodes
`discount = 0` (`orderService.ts`) and coupons are explicitly out of scope, so this is UI
promising a feature that does not exist and will not. Dead affordances are worse than absent ones.

### 12. Delete the unused mock catalog

`data/products.ts` and `data/categories.ts` (203 lines) are imported nowhere in `app/`,
`components/`, `lib/` or `store/` — leftovers from before the backend was wired up. Verified with
a repo-wide grep for `@/data/`.

---

## P2 — password reset UI

Pairs with `backend/issues.md` P2, which adds `POST /api/auth/forgot-password` and
`POST /api/auth/reset-password` and sends a link to `${PUBLIC_APP_URL}/reset-password?token=…`.

- A "Forgot password?" link on `app/(shop)/login/page.tsx`.
- A request page that posts the email and **always** renders the same "if that address has an
  account, check your inbox" confirmation — the backend deliberately answers 200 either way, and
  the UI must not undo that by branching on the response.
- `app/(shop)/reset-password/page.tsx` reading `?token=`, posting the new password, then routing
  to `/login`. Handle an invalid/expired token as a plain terminal state with a link to request a
  new one, in the shape `app/approve/[token]/page.tsx` already uses for dead links.

Reuse the existing form stack — `react-hook-form` + `zodResolver` with a schema in
`lib/validation.ts`, as `signup/page.tsx` does — and `lib/api/auth.ts` for the calls.

---

## Known and accepted

**`ChatMandate.tokenId` has no consumer.** Grepping `components/chat/widgets/` finds nothing that
reads it — neither `reserve-pay-status-widget.tsx` nor `reserve-pay-setup-widget.tsx`. It is
either dead weight (as `OrderReviewPart.payment.tokenId` turned out to be, and was removed) or
scaffolding for a "manage this specific reserved balance" affordance that was never built. Left in
place; it should get a consumer or go.

**Auth tokens live in `localStorage`.** `store/auth-store.ts:78` persists `user` and `token`; the
admin store does the same. Readable by any injected script or extension, with a 7-day TTL and no
server-side revocation. Accepted for this project; it is also the reason every authed page is a
client component (see `AGENTS.md`).

---

## Explicitly out of scope — do not implement

Recorded so they are not re-discovered as findings later:

- **All frontend performance work.** No `next/image` migration (14 files use raw `<img>` and
  `next.config.ts` has no `images.remotePatterns`), no fetch `revalidate` on catalog server
  components, no `next/dynamic` for `cmdk`/`embla`, no chat-transcript windowing, no move to
  httpOnly cookies.
- **Customer order cancellation** and refunds — no backend support, and none planned.
- **Real product reviews.** The Reviews tab on the PDP restates the aggregate rating and that is
  intentional for now.
- **`generateMetadata` / per-page SEO.**
- **Client-side logout revoking the token** — logout clears local state only; the JWT stays valid
  until it expires.
