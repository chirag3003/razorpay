# Project: Razorpay Hackathon — Agentic Commerce & Revenue Recovery

## What We're Building

We're building a working, end-to-end simulated e-commerce merchant — think a Swiggy/Zomato-style
food/grocery delivery platform — that is fully usable by normal human customers through a real
website, and *also* fully transactable by independent AI agents (a self-hosted OpenClaw, a custom
"Jarvis," or any other third-party agent framework) with zero special integration required beyond
a merchant-issued token and a public protocol interface.

The system has three layers, built in this order:

1. **A real online store.** Signup/login, product catalog, cart, checkout, order history —
   exactly like any normal e-commerce site, using Razorpay's actual test-mode payment APIs for
   real (simulated-money) transactions. This is the foundation everything else sits on, not a
   throwaway prototype layer.

2. **Two merchant-side agents, sharing that same store's underlying logic:**
   - **Growth/Checkout Agent** — lets a customer (human, via chat, or an external AI agent, via
     protocol) complete a purchase conversationally instead of clicking through pages, with
     upsell/cross-sell suggestions along the way. This is what proves "an AI buyer can transact
     with this merchant end to end."
   - **Recovery Agent** — watches for payment failures (card declines, failed subscription
     debits, abandoned checkouts) on the same store, diagnoses *why* each one failed, and
     executes a bounded, auditable recovery action (retry, prompt, or give up per a stopping
     rule). Pitched as "recovering revenue that would otherwise be lost," not as a separate
     product.

3. **A buyer-side reference AI assistant**, built as a genuinely separate codebase, that connects
   to the merchant purely through its public protocol interface (see Protocol Layering below) —
   this is the live proof that *any* independent agent, not just something we built and control,
   can browse the catalog and complete a real purchase.

The hard problem this project is actually solving is trust and authorization between two mutually
independent parties (a merchant that doesn't control the buyer's agent, and a buyer's agent that
the merchant has never seen before) — not just "make a chatbot that can check out." Every
architectural choice below (the mandate/token system, UPI Reserve Pay for instant repeat debits,
keeping the transaction core LLM-free, A2A/MCP as the interface) exists to make that trust
relationship real, bounded, and auditable rather than assumed.

## Submission Track
Track 1 (AI Growth & Agentic Commerce). Track 3 (Revenue Recovery) concepts are included as a
second agent, framed entirely as revenue growth — never pitch or benchmark it against Track 3's
own rubric.

## One-line narrative
An agent suite that grows a merchant's revenue two ways — capturing new demand (Growth/Checkout
Agent) and recovering demand that's slipping away (Recovery Agent) — both explainable, bounded,
gated, and fully audited, and both transactable by *any* external buyer agent, not only one we
built ourselves.

---

## Hard Rules — do not violate these regardless of what a task seems to ask for

1. **No LLM in the merchant transaction core.** Catalog lookup, cart mutation, token/mandate
   verification, and the Reserve Pay debit call must be deterministic, auditable code. LLMs are
   only allowed in: Growth Agent upsell/cross-sell suggestion generation (advisory data only,
   never itself mutates a cart), Recovery Agent failure-explanation/messaging (root-cause
   classification itself stays rule-based), offline/batch catalog authoring, and the merchant
   admin dashboard assistant. If unsure whether new logic belongs in the deterministic core, ask
   before adding a model call to it.
2. **One service layer, two callers.** All order/cart/payment logic lives in
   `/backend/src/services/`. Both the normal web REST routes and the agent-facing
   A2A/MCP tool handlers must call into this same layer — never duplicate business logic in a
   route handler or a tool handler directly.
3. **Merchant service and buyer-side agent share zero code.** The buyer-side assistant is a
   structurally separate codebase/process. It may only know the merchant's public A2A/MCP
   endpoint and a bearer token — no shared imports, no internal shortcuts. This is what makes the
   "any independent agent can transact with our merchant" claim demonstrated, not just asserted.
4. **Every money-moving action must be logged to the audit trail** (`audit_log` table) with:
   actor (which token/agent), the mandate/scope checked, the decision, and the outcome. If a new
   endpoint moves money and doesn't write an audit row, it's incomplete.
5. **Discovery is open; transacting is not.** Catalog browsing/search requires no token. Cart
   creation, checkout, and any Reserve Pay action require a valid, unexpired, unrevoked token
   whose scope covers the action.

---

## Repo Structure

```
/web            Next.js — customer-facing store UI + chat, and merchant admin dashboard
/backend        Node/TypeScript — service layer, REST routes, A2A/MCP interfaces, webhook receiver
/buyer-agent    TBD — see "Buyer-Side Assistant" section below, not finalized yet
```

---

## Tech Stack

- **Dashboards & storefront:** Next.js (single app, routes for storefront + `/admin`)
- **Backend:** Node/TypeScript, official Razorpay SDK
- **Database:** Postgres
- **Webhook receiver:** built into backend, tunneled via ngrok for local dev
- **LLM:** OpenRouter (`@openrouter/sdk`), model set by `OPENROUTER_MODEL`; used only in the locations listed in Hard Rule #1
- **Payment rail:** Razorpay test-mode APIs — Orders, Payments, Payment Links, Subscriptions/
  Autopay, UPI Reserve Pay (SBMD)

---

## Payment / Mandate Architecture

- **Intent Mandate (simplified):** an opaque bearer token generated by the user in an
  "Agent Access" settings page. Fields: `token_id, user_id, scope, spend_cap, reserve_pay_token_id,
  expiry, revoked`. Generating it also completes the real UPI Reserve Pay authorisation (one
  human UPI-app approval), linking the token to actual blocked funds.
- **Cart Mandate (lightweight):** at checkout, before the Reserve Pay debit, generate and store a
  signed record `{cart_contents, total_amount, token_id, timestamp}` — the per-transaction proof
  of what was actually agreed to, separate from the token's general authority.
- **Payment Mandate:** the Reserve Pay debit call itself.
- Full AP2 (W3C Verifiable Credentials, 3-party cryptographic chain) is explicitly NOT
  implemented — this is a deliberate, documented simplification, not an oversight.
- **UPI Reserve Pay (SBMD) flow:** Create Customer → Create Order
  (`token.type: single_block_multiple_debit`, `max_amount ≤ ₹10,000`, `expire_at ≤ 90 days`) →
  Create Authorisation Payment (`upi.flow: intent`, one human approval) → Fetch Token → every
  subsequent purchase is a new Order (no `notification` object) + Initiate Payment referencing
  the stored token — instant, headless.
- **Constraint to respect:** one Reserve Pay block per merchant per customer (real regulatory
  limit). In this prototype, simulate multiple "merchants" as multiple tokens for the same
  customer within our one Razorpay test account.
- **Verification order on every agent request:** token valid/unexpired/unrevoked → action within
  scope/cap → (if payment) Reserve Pay balance check.

---

## Protocol Layering

| Layer | Protocol | Role |
|---|---|---|
| Transaction execution (primary) | **A2A** | Agent Card + task lifecycle (submitted→working→input-required→completed) fronting the shared service layer. Chosen over MCP-as-primary to natively support realtime/async features (live offers, flash-sale pushes) without bolting on a second interface later. |
| Compatibility layer (secondary) | **MCP (thin adapter)** | Same service layer, wrapped as MCP tools, so MCP-only agents can still transact. Build after the A2A path works. |
| Checkout semantics (reference only, not a transport) | **ACP** | Its session lifecycle (create→update→complete) and "merchant stays merchant of record" principle shape both the A2A task structure and the MCP adapter's schemas. |
| Narrative only | **UAP** | Not implementable — no live API exists yet. Cited in the pitch as the direction NPCI is heading, never integrated. |

**Accepted tradeoff:** A2A-as-primary costs some out-of-the-box compatibility (fewer agent
frameworks natively speak A2A today vs. MCP) in exchange for native realtime/task support. The
MCP adapter exists specifically to keep the "any agent can plug in" claim honest.

---

## Buyer-Side Assistant — NOT FINALIZED, decide based on remaining time

Purpose: a genuinely separate reference implementation proving third-party agents (e.g. a
self-hosted OpenClaw/Jarvis) can transact with the merchant with zero shared code.

Decided so far:
- Must be a structurally separate process/codebase (Hard Rule #3)
- LLM reasoning (Claude API) lives here, never merchant-side
- Talks to the merchant only via the public A2A interface (MCP adapter as fallback if
  demonstrating MCP-only-agent compatibility)
- Needs: credential store (token per connected merchant), merchant registry/selection logic,
  conversation/decision loop, ideally independent Cart Mandate co-signing and its own
  bounded-autonomy check before calling checkout

Open / deliberately deferred:
- **Language:** Go was discussed (small footprint, fast cold start, realistic story for an
  "edge device" framing like a smart-fridge client calling out to a cloud LLM) vs. just using
  Node/TS to match the rest of the stack for speed of development. **Not decided — revisit based
  on days remaining and team familiarity with Go.**
- Whether to attempt the optional stretch demo: cross-compiling the buyer-agent binary to run on
  a physical device (e.g. a Raspberry Pi staged as a "smart fridge") — only attempt after the
  core A2A path, dashboard, and both agents are working end to end.

---

## Deliverables

1. **Merchant Agent Service** (backend) — Growth/Checkout Agent module, Recovery Agent module,
   shared deterministic core, shared audit-log/mandate/token data layer
2. **Merchant Dashboard UI** (Next.js `/admin`) — audit trail, mandate chain per transaction,
   bounded/gated actions visualized, recovery agent monitor
3. **Customer-facing storefront + chat** (Next.js) — real signup/login/browse/cart/checkout, plus
   a first-party Claude-powered chat calling the same service layer directly
4. **Buyer-Side AI Assistant** (reference implementation) — see above, spec not finalized

---

## Build Order (reflects "boring store first, intelligence layered on top")

1. **Days 1-3:** Real e-commerce store — signup/login, browse, cart, standard Razorpay checkout,
   order history. Written as a clean service layer, not logic-in-route-handlers.
2. **Days 4-5:** Recovery Agent — webhook listener, failure classifier, policy engine, stopping
   rules, built on real data from Phase 1.
3. **Days 6-7:** Make the core agent-callable — schema additions (`agent_tokens,
   reserve_pay_tokens, cart_mandates, audit_log`), UPI Reserve Pay flow, "Agent Access" settings
   page, verification middleware.
4. **Days 8-9:** First-party chat Growth Agent on the storefront itself (same-origin, lowest
   trust risk, proves the concept before opening it externally). Upsell suggestions riding along
   in tool responses.
5. **Days 9-10:** Open it up — A2A server (Agent Card + task lifecycle) wrapping the same service
   layer, then the thin MCP adapter.
6. **Days 10-11:** Buyer-Side AI Assistant — build once language/scope is finalized, test as a
   genuinely separate process against the Day 9-10 server.
7. **Days 11-12:** Dashboard + audit trail wiring, one scripted graceful-failure case per agent,
   optional Pi stretch demo if time allows.
8. **Day 13:** Buffer, writeup, submission.

**Cut list if time runs short (in this order):** optional Pi/edge demo → MCP adapter →
buyer-side Cart Mandate co-signing → upsell suggestions in chat.
