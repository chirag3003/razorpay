# Web — open issues and work queue

Verified against `main` at `dbcaabc`. Ordering is by priority, not by file.

The backend's own register is `backend/issues.md`; `handled.md` at the repo root lists what
already fails gracefully on both sides — read it before adding a new error path.

**All P0 and P1 items below are done and have been removed.** What remains is one deferred item
(P2, blocked on the backend), one item that was never a frontend bug, and the standing
known/accepted and out-of-scope lists.

---

## Not a frontend issue

**Paginated results can repeat or skip products.** Frontend symptom of a backend cause:
`productService` applies no tiebreaker to any sort, so rows with equal sort keys come back in
planner order, which is not stable across pages. Tracked as `L6` / P1 item 10 in
`backend/issues.md`. **No frontend change needed** — listed here so it is not re-diagnosed as a
pagination bug in this codebase.

---

## P2 — password reset UI (deferred: blocked on the backend)

**Not started.** The two endpoints this UI posts to do not exist yet — they are still open P2
items in `backend/issues.md`. Building the pages now would ship links that 404, so this waits for
the backend half to land. Nothing else in the queue depends on it.

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

**Voice chat is multilingual; the rest of the UI is not.** The mic transcribes 23 languages and
speaks the reply back in whichever was detected (`hooks/use-voice-recorder.ts`,
`store/chat-store.ts`, backend `POST /api/voice/*`). But the agent, every widget's copy and the
catalog are English, so a Hindi speaker hears fluent Hindi and then reads an English product card
underneath it. Closing that gap means translating widget payloads and product names, or running
the agent in the target language — a separate piece of work touching `backend/src/chat/partMapper.ts`
and `systemPrompt.ts`. Known and accepted; not a bug.

**Auth tokens live in `localStorage`.** `store/auth-store.ts` persists `user` and `token`; the
admin store does the same. Readable by any injected script or extension, with a 7-day TTL and no
server-side revocation. Accepted for this project; it is also the reason every authed page is a
client component (see `AGENTS.md`).

**Eight `react-hooks/set-state-in-effect` lint warnings remain.** `bun run lint` is clean of
errors. The one that cost a real extra render (`hooks/use-admin-list.ts`) is fixed; the rest are
cosmetic and deliberately left, including generated `components/ui/carousel.tsx` — shadcn output
is composed over, not edited.

---

## Explicitly out of scope — do not implement

Recorded so they are not re-discovered as findings later:

- **All frontend performance work.** No `next/image` migration (raw `<img>` throughout and
  `next.config.ts` has no `images.remotePatterns`), no fetch `revalidate` on catalog server
  components, no `next/dynamic` for `cmdk`/`embla`, no chat-transcript windowing, no move to
  httpOnly cookies.
- **Customer order cancellation** and refunds — no backend support, and none planned.
- **Real product reviews.** The Reviews tab on the PDP restates the aggregate rating and that is
  intentional for now.
- **`generateMetadata` / per-page SEO.**
- **Client-side logout revoking the token** — logout clears local state only; the JWT stays valid
  until it expires.
- **Coupons and promo codes.** The backend hardcodes `discount = 0`; the dead promo input has been
  removed from the cart rather than wired up.
- **The wishlist.** Removed outright rather than fixed — there was no table, no API and no
  cross-device persistence, and the `localStorage` key leaked one user's list to the next person
  to log in on a shared device. Reinstating it means building the backend half first.
