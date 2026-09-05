# web

Storefront, `/admin` dashboard and the chat panel — one Next.js app (Next 16, React 19, Tailwind
v4, shadcn/base-ui, zustand). Port 3000.

**Setup: [root `README.md`](../README.md).**

```bash
bun install
bun run dev        # http://localhost:3000
```

**Backend must be running** — this app holds no data of its own. With the API down you get error
states, not a catalog. Run it with `RESERVE_PAY_SIM=true` for the Reserve Pay and agent-checkout
flows to work end to end.

`bun run lint` and `bun x tsc --noEmit` both pass clean. Keep them that way.

- **`../backend/API.md`** — the request/response contract. Read before adding an API call.
- **`AGENTS.md`** — conventions here: server/client split, the single fetch path, store rules,
  chat protocol versioning.
