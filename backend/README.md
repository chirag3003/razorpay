# backend

Bun + Hono. Services, REST routes, MCP server, Razorpay webhooks. Port 4000.

**First-time setup, env keys, and the Razorpay production-vs-simulator switch: [root
`README.md`](../README.md).**

```bash
bun install
bun run dev        # http://localhost:4000
```

```
bun run dev          hot reload
bun run build        bundle to ./dist
bun run start        run the built bundle
bun run db:generate  generate a migration from the schema
bun run db:migrate   apply pending migrations
bun run db:push      push schema, no migration file (local only)
bun run db:studio    Drizzle Studio
bun run db:seed      seed categories/products, safe to re-run
```

- **`API.md`** — every route, request/response shape and error code. Read this to integrate
  against the backend instead of reading source.
- **`CLAUDE.md`** — conventions for changing backend code.
