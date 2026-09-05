# Fresh Cart — agent context

Grocery e-commerce that works two ways: a normal website for humans, and an MCP + OAuth interface
any third-party AI agent can transact through with no special integration. Same service layer
under both.

Real problem being solved: trust and authorization between a merchant and a buyer's agent it has
never seen. Not "make a chatbot that can check out."

Setup and how to run: `README.md`. API contract: `backend/API.md`.

## Hard rules

1. **No LLM in the transaction core.** Catalog lookup, cart mutation, mandate verification, the
   Reserve Pay debit — deterministic code only. LLMs allowed in exactly two places, and this is
   structurally checkable: only `chatService.ts` and `searchAssistService.ts` may import `/llm`.
2. **One service layer, two callers.** All order/cart/payment logic in `backend/src/services/`.
   REST routes and MCP tool handlers both call into it. Never duplicate logic in a handler, never
   reach into the db from one.
3. **Buyer-side agent shares zero code.** Separate codebase, knows only the public MCP endpoint
   and an OAuth token. That separation is what makes the "any agent can transact" claim real.
4. **Every money-moving action writes an `audit_log` row** — actor, mandate checked, decision,
   outcome. No audit row = incomplete, not just under-logged.
5. **Discovery open, transacting gated.** Browse/search need no token. Cart, checkout, Reserve Pay
   need a valid one. Note there is **one blanket `store:agent` scope** — a valid token covers
   every action.

## Layout

```
web/           Next.js — storefront, chat panel, /admin dashboard
backend/       Bun + Hono — services, REST, MCP, webhooks
```

Stack: Bun, Hono, Postgres + Drizzle, Zod v4, OpenRouter (`OPENROUTER_MODEL` is the whole provider
swap), Razorpay test-mode SDK.

## Payment model

- **Agent access token** — OAuth only, never copy-pasted. JWT, `actorType: "agent"`, 24h.
- **Reserve Pay mandate** — the standing authority. One UPI PIN approval blocks real funds.
  ₹10,000 cap, ≤90 day expiry, one block per customer (regulatory, enforced by a partial unique
  index).
- **Cart mandate** — signed `{cart_contents, total, timestamp}` written at checkout before the
  debit. Makes `place_order` idempotent; invalidates a quote whose cart moved underneath it.
- **Verification order, don't reorder:** token valid → mandate active + unexpired → amount within
  cap → sufficient blocked balance.

Full AP2 (W3C VCs, 3-party crypto chain) deliberately not implemented. UAP is narrative only —
never claim integration.

## The two agent surfaces differ, don't conflate them

**Chat agent is gated structurally.** `place_order` is never in the tool list sent to the model —
not withheld-unless-confirmed, never present. On a `review.confirm` widget tap `chatService`
resolves the user's open quote and calls the tool directly, no model round trip. Prompt injection
in a product name can't place an order because the function isn't in the model's hands.

**MCP is deliberately open.** An OAuth-connected agent can call `prepare_order` → `place_order` in
one turn, and `start_reserve_pay_setup` to create a new block up to ₹10,000. Consent is the
one-time OAuth approval plus the UPI PIN — not per-order. No scope, no spend cap. Accepted
knowingly: agentic checkout is the product. Bounds are the ₹10,000 ceiling and the block balance.

Holds on both: every action scoped to one user, every money call audited, cart mandate records
what was agreed.

Adding another money-moving tool? Pick which model it follows and write it down. A sentence in a
system prompt is not a gate.

## Out of scope — don't plan work against these, don't re-raise as gaps

Recovery agent (payment-failure diagnosis/retry policy), A2A transport, upsell tooling beyond
`list_related_products`, per-agent scope/spend caps, connected-agents view and revocation, order
cancellation and refunds, logout token revocation, stock quantities, order-status transition
rules, a test suite.

`backend/API.md` §7 has the full list with reasoning. Verification is `bun x tsc --noEmit` plus a
manual money-path walkthrough.
