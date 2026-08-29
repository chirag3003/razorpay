# Known gaps found while building the backend chat agent

## Compatibility: `OrderReviewPart.payment.tokenId` is no longer sent

`POST /api/chat`'s `order_review` part used to carry `payment.tokenId` (the Reserve Pay mandate
id) to satisfy `web/lib/chat/protocol.ts`'s `OrderReviewPart.payment` type, which declares it
`required`. It is **not sent anymore**.

Why: grepping every file in `web/components/chat/widgets/` shows nothing reads it —
`order-review-widget.tsx` only uses `part.payment.remaining`, and the two Reserve Pay widgets
never receive an `OrderReviewPart` at all. It existed purely to fill a required field, not because
anything consumed it. The backend now omits it rather than keep a field with zero readers.

**To restore compatibility, in `web/`:**

1. `web/lib/chat/protocol.ts` — drop `tokenId` from `OrderReviewPart["payment"]`:
   ```ts
   // before
   payment: { method: "reserve_pay"; tokenId: string; remaining: Rupees };
   // after
   payment: { method: "reserve_pay"; remaining: Rupees };
   ```
2. `web/lib/chat/mock-script.ts:230` — remove the now-invalid field from the mock's own
   `order_review` construction:
   ```ts
   // before
   payment: { method: "reserve_pay", tokenId: mandate.tokenId, remaining },
   // after
   payment: { method: "reserve_pay", remaining },
   ```
3. Bump `CHAT_PROTOCOL_VERSION` in `web/lib/chat/protocol.ts` from `1` to `2` once the above
   lands, matching the bump already made on the backend side
   (`backend/src/chat/protocol.ts`). Until this is bumped on both sides, a real `POST /api/chat`
   call will 400 with `PROTOCOL_VERSION_MISMATCH` — deliberately, so the mismatch is loud rather
   than shipping a field that's silently `undefined` at runtime.

No component changes needed beyond the type — nothing renders the field today, so nothing breaks
by its absence; this is purely bringing the type back in line with what's actually on the wire.

## Related, but not fixed here: `ChatMandate.tokenId` is the same story

`ChatMandate.tokenId` (the same Reserve Pay mandate id, surfaced via `get_payment_status`,
`check_reserve_pay_status`, and `start_reserve_pay_setup`) is *also* unrendered by every widget
that receives a `ChatMandate` — checked `reserve-pay-status-widget.tsx` and
`reserve-pay-setup-widget.tsx` directly. This one wasn't touched, since it's a separate field on a
separate type and wasn't part of the change that prompted this doc. Worth the same look later:
either it's dead weight like `payment.tokenId` was, or it's scaffolding for a future "manage this
specific reserved balance" affordance (e.g. showing which balance is active, or letting the
customer revoke one by id) that was never built. If it's the latter, it should stay and get a
consumer; if not, it can go the same way as `payment.tokenId`.
