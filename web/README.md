# web

The customer-facing storefront, the merchant admin dashboard, and the chat panel — one Next.js
app (Next 16, React 19, Tailwind v4, shadcn/base-ui, zustand).

```
app/(shop)          storefront: home, catalog, product detail, cart, checkout, orders, account
app/admin           operator dashboard: products, categories, orders, users
app/agent-connect   the OAuth consent screen an external agent sends the customer to
app/approve/[token] the standalone UPI Reserve Pay approval page (deliberately unauthenticated)
```

## Running it

```bash
bun install
cp .env.example .env.local     # NEXT_PUBLIC_API_BASE_URL=http://localhost:4000
bun run dev                    # http://localhost:3000
```

**The backend must be running.** This app holds no data of its own — every page fetches from
`/backend` through `lib/api/`, and with the API down you get the error states rather than a
catalog. Start it first (`cd ../backend && bun run dev`), and run it with
`RESERVE_PAY_SIM=true` if you want the Reserve Pay and agent-checkout flows to work end to end.

`bun run lint` and `bun x tsc --noEmit` both pass clean; keep them that way.

## Where to look

- **`../backend/API.md`** — the full request/response contract. Read this before adding an API
  call; it documents every route, entity shape and error code, so you never need to read backend
  source to integrate.
- **`AGENTS.md`** — the conventions in this project: the server/client component split, the single
  fetch path, store rules, and the chat protocol's versioning contract. Read it before writing
  code here.
- **`issues.md`** — the work queue: open bugs, what is being removed, and what is explicitly out
  of scope.
- **`../handled.md`** — what already fails gracefully across the whole system. Read it before
  adding a new error path.
