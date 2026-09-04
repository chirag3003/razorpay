# Project: Razorpay Hackathon — Agentic Commerce

## What We're Building

A working, end-to-end simulated e-commerce merchant — think a Swiggy/Zomato-style food/grocery
delivery platform — that is fully usable by normal human customers through a real website, and
*also* fully transactable by independent AI agents (a self-hosted OpenClaw, a custom "Jarvis," or
any other third-party agent framework) with zero special integration required beyond an OAuth
connection.

The system has three layers, built in this order:

1. **A real online store.** Signup/login, product catalog, cart, checkout, order history —
   exactly like any normal e-commerce site, using Razorpay's actual test-mode payment APIs for
   real (simulated-money) transactions. This is the foundation everything else sits on, not a
   throwaway prototype layer.

2. **A merchant-side Growth/Checkout Agent**, sharing that same store's underlying logic — it
   lets a customer complete a purchase conversationally instead of clicking through pages, either
   as a human in the storefront chat panel or as an external AI agent over the public MCP
   interface. This is what proves "an AI buyer can transact with this merchant end to end."

3. **A buyer-side reference AI assistant**, built as a genuinely separate codebase, that connects
   to the merchant purely through its public MCP interface — the live proof that *any* independent
   agent, not just something we built and control, can browse the catalog and complete a real
   purchase.

The hard problem this project is actually solving is trust and authorization between two mutually
independent parties (a merchant that doesn't control the buyer's agent, and a buyer's agent that
the merchant has never seen before) — not just "make a chatbot that can check out." Every
architectural choice below (OAuth-issued agent tokens, the cart mandate, UPI Reserve Pay for
instant repeat debits, keeping the transaction core LLM-free) exists to make that trust
relationship real, bounded and auditable rather than assumed.

## Submission Track
Track 1 (AI Growth & Agentic Commerce).

## One-line narrative
An agent suite that grows a merchant's revenue by capturing new demand conversationally —
explainable, audited, and transactable by *any* external buyer agent, not only one we built
ourselves.

---

## Hard Rules — do not violate these regardless of what a task seems to ask for

1. **No LLM in the merchant transaction core.** Catalog lookup, cart mutation, mandate
   verification and the Reserve Pay debit call must be deterministic, auditable code. LLMs are
   only allowed in: the storefront chat agent's conversation loop, natural-language search
   assistance (advisory only — it produces filters, it never mutates state), and offline/batch
   catalog authoring. If unsure whether new logic belongs in the deterministic core, ask before
   adding a model call to it. This is structurally checkable, not just a written rule: only
   `chatService.ts` and `searchAssistService.ts` may import `/llm`.
2. **One service layer, two callers.** All order/cart/payment logic lives in
   `/backend/src/services/`. Both the normal web REST routes and the agent-facing MCP tool
   handlers must call into this same layer — never duplicate business logic in a route handler or
   a tool handler directly.
3. **Merchant service and buyer-side agent share zero code.** The buyer-side assistant is a
   structurally separate codebase/process. It may only know the merchant's public MCP endpoint and
   an OAuth token — no shared imports, no internal shortcuts. This is what makes the "any
   independent agent can transact with our merchant" claim demonstrated, not just asserted.
4. **Every money-moving action must be logged to the audit trail** (`audit_log` table) with:
   actor (which token/agent), the mandate checked, the decision, and the outcome. If a new
   endpoint moves money and doesn't write an audit row, it's incomplete.
5. **Discovery is open; transacting is not.** Catalog browsing and search require no token. Cart
   mutation, checkout and any Reserve Pay action require a valid, unexpired token. Note what this
   does *not* say: there is **one blanket `store:agent` scope**, so a valid token covers every
   action. Per-action scoping and spend caps were designed and deliberately not built — see
   "Where the human is in the loop" below.

---

## Repo Structure

```
/web            Next.js — customer-facing store UI + chat, and merchant admin dashboard
/backend        Node/TypeScript — service layer, REST routes, MCP interface, webhook receiver
/buyer-agent    Independent buyer-side assistant (separate process, no shared code)
handled.md      What already fails gracefully, across all three — read before adding an error path
```

Each project keeps its own `issues.md` as its work queue. `backend/API.md` is the full
request/response contract and is the file to read before integrating against the backend.

---

## Tech Stack

- **Dashboards & storefront:** Next.js (single app, routes for storefront + `/admin`)
- **Backend:** Bun + Hono + TypeScript, official Razorpay SDK
- **Database:** Postgres (Drizzle)
- **Webhook receiver:** built into backend, tunneled via ngrok for local dev
- **LLM:** OpenRouter (`@openrouter/sdk`), model set by `OPENROUTER_MODEL`; used only in the
  locations listed in Hard Rule #1
- **Payment rail:** Razorpay test-mode APIs — Orders, Payments, UPI Reserve Pay (SBMD)

---

## Payment / Mandate Architecture

- **Agent access token:** issued only by the OAuth flow (`backend/API.md` §6.15), never handed to
  a human to copy-paste. A JWT with `actorType: "agent"` and a 24-hour TTL, mutually exclusive
  with the human session token even though both sign with the same secret.
- **Reserve Pay mandate:** the standing authority. Generating it completes a real UPI Reserve Pay
  authorisation (one human UPI-app PIN approval), blocking actual funds that later debits draw
  against.
- **Cart Mandate:** at checkout, before the debit, a signed record
  `{cart_contents, total_amount, timestamp}` is written — the per-transaction proof of what was
  actually agreed, separate from the token's general authority. It is what makes `place_order`
  idempotent and what invalidates a quote whose cart moved underneath it.
- **Payment Mandate:** the Reserve Pay debit call itself.
- Full AP2 (W3C Verifiable Credentials, 3-party cryptographic chain) is explicitly NOT
  implemented — a deliberate, documented simplification, not an oversight.
- **UPI Reserve Pay (SBMD) flow:** Create Customer → Create Order
  (`token.type: single_block_multiple_debit`, `max_amount ≤ ₹10,000`, `expire_at ≤ 90 days`) →
  Create Authorisation Payment (`upi.flow: intent`, one human approval) → Fetch Token → every
  subsequent purchase is a new Order (no `notification` object) + Initiate Payment referencing
  the stored token — instant, headless.
- **Constraint to respect:** one Reserve Pay block per merchant per customer (a real regulatory
  limit), enforced by a partial unique index rather than only in application code.
- **Verification order on every agent request:** token valid/unexpired → mandate active and
  unexpired → amount within the per-transaction cap → sufficient blocked balance. Don't reorder or
  short-circuit this.

**The rail is currently served by a local simulator** because Razorpay has not provisioned the
server-to-server payment API on this account. Every guard, reservation, audit write and signature
check is real either way — see `backend/issues.md` for the entitlement detail and the switch-back.

---

## Where the human is in the loop

The honest version of the trust story, because the two agent surfaces answer it differently and
conflating them is the easiest mistake to make in this codebase.

**The first-party chat agent is gated structurally.** `place_order` is never in the tool list sent
to the model — not withheld-unless-confirmed, never present at all (`chatService.ts:261`). On a
`review.confirm` widget tap, `chatService` resolves the customer's one open quote itself and calls
the tool directly, with no model round trip in the decision. The widget action carries no
`quoteId`, so there was never a decision for a model to make. A prompt injection hidden in a
product name, a hallucinated call, a retry storm: none can place an order, because there is
nothing to call.

**The MCP surface is deliberately open:**

> An OAuth-connected MCP agent can call `prepare_order` → `place_order` in one turn, and can call
> `start_reserve_pay_setup` to create a **new** block up to ₹10,000. The human's consent is the
> one-time OAuth approval plus the UPI PIN on the block — not a per-order confirmation. There is
> no scope, no spend cap, and no per-agent limit; the ₹10,000 regulatory ceiling and the block's
> remaining balance are the only bounds. This is deliberate, and it is the opposite of the
> first-party chat agent, where `place_order` is never in the model's tool list at all
> (`chatService.ts:261`). Accepted knowingly: agentic checkout is the product.

What still holds on both surfaces: every action is scoped to one user's data, every money-moving
call writes an audit row naming the actor, the cart mandate records exactly what was agreed, and
the block's ceiling bounds total exposure. What does not hold is per-action authorization — an
agent the customer connected once can spend the whole block without asking again.

If you add another money-moving tool, decide which of these two models it follows and write it
down. Do not add a sentence to a system prompt and call it gated.

---

## Protocol Layering

| Layer | Protocol | Role |
|---|---|---|
| Transaction execution | **MCP** | The interface. Agent-facing tools at `POST /api/mcp`, wrapping the same service layer the REST routes use, with OAuth (RFC 9728/8414/7591 + PKCE) for connection. |
| Checkout semantics (reference only, not a transport) | **ACP** | Its session lifecycle (create→update→complete) and "merchant stays merchant of record" principle shape the tool registry's schemas and the two-phase `prepare_order`/`place_order` split. |

**A2A was considered and not built.** MCP calls typed tools with structured JSON arguments
(`add_to_cart({productId, qty})`) — no LLM needed on either side for most of them. A2A instead
sends one free-text instruction per "skill"; there is no structured-args call in its wire protocol
at all, so *every* A2A call would need this backend's LLM just to parse intent. That is a
fundamentally different shape, and MCP is the one that matches "most tool calls need no AI, only
search benefits from one." The reasoning is written out in `backend/API.md` §6.14.

UAP is narrative only — no live API exists. Cite it as the direction NPCI is heading; never claim
integration.

---

## Deliverables

1. **Merchant Agent Service** (backend) — the shared deterministic core, the tool registry both
   agent surfaces call, and the audit-log/mandate data layer
2. **Merchant Dashboard UI** (Next.js `/admin`) — catalog, orders, users, and the audit trail
3. **Customer-facing storefront + chat** (Next.js) — real signup/login/browse/cart/checkout, plus
   an LLM chat panel calling the same service layer
4. **Buyer-Side AI Assistant** (`/buyer-agent`) — a genuinely separate process that discovers this
   merchant's tools over MCP and transacts through them, sharing no code with it. It is
   general-purpose by design (it drives any MCP server or A2A agent you point it at) and is
   currently **out of active scope** — see `buyer-agent/README.md`.

---

## Explicitly out of scope

Descoped by decision. Do not plan work against these, and do not re-raise them as gaps:

- **Recovery Agent** (payment-failure diagnosis, retry policy, stopping rules) — never built, not
  planned. `webhooks/razorpay.ts` handles `payment.failed` by clearing the pending checkout and
  nothing more.
- **A2A transport** — see Protocol Layering above.
- **Upsell / cross-sell tooling** beyond `list_related_products`.
- **Intent Mandate `scope` / `spend_cap`** and an "Agent Access" settings page.
- **Connected-agents view and agent revocation.**
- **Customer order cancellation and refunds**, logout token revocation, stock quantities,
  order-status transition rules, and a test suite.

`backend/API.md` §7 keeps the authoritative version of this list with the reasoning per item.
