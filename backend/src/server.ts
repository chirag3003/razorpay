import { Hono } from "hono";
import { cors } from "hono/cors";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { env } from "./config/env";
import { DomainError } from "./errors";
import { authRoutes } from "./routes/auth";
import { categoryRoutes } from "./routes/categories";
import { productRoutes } from "./routes/products";
import { addressRoutes } from "./routes/addresses";
import { cartRoutes } from "./routes/cart";
import { orderRoutes } from "./routes/orders";
import { reservePayRoutes } from "./routes/reserve-pay";
import { reservePayApprovalRoutes } from "./routes/reserve-pay-approval";
import { chatRoutes } from "./routes/chat";
import { adminRoutes } from "./routes/admin";
import { oauthRoutes } from "./routes/oauth";
import { mcpRoutes } from "./routes/mcp";
import { razorpayWebhook } from "./webhooks/razorpay";
import type { AppEnv } from "./types";
import { logger } from "./logger";

const app = new Hono<AppEnv>();

// One line per request instead of hono/logger's two, with a timestamp (it has none) and the
// caller when a route has set one — a domain-error status still routes through here since it's
// set on the response object regardless of how the handler resolved it.
app.use("*", async (c, next) => {
  const startedAt = Date.now();
  await next();
  logger.info("http", `${c.res.status} ${c.req.method} ${c.req.path}`, {
    ms: Date.now() - startedAt,
    userId: c.get("userId"),
  });
});

app.use(
  "*",
  cors({
    origin: env.CORS_ORIGIN,
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  })
);

app.get("/", (c) => c.json({ status: "ok" }));

app.route("/api/auth", authRoutes);
app.route("/api/categories", categoryRoutes);
app.route("/api/products", productRoutes);
app.route("/api/addresses", addressRoutes);
app.route("/api/cart", cartRoutes);
app.route("/api/orders", orderRoutes);
// Before the authed router: reservePayRoutes guards "*", and the approval page has no session.
app.route("/api/reserve-pay/approval", reservePayApprovalRoutes);
app.route("/api/reserve-pay", reservePayRoutes);

// SSE, streaming the ServerEvent union in web/lib/chat/protocol.ts.
app.route("/api/chat", chatRoutes);

// Its own auth (POST /api/admin/login + requireAdmin), separate from the human-session JWT.
app.route("/api/admin", adminRoutes);

app.route("/api/mcp", mcpRoutes);

// Mounted at root: oauthRoutes defines its own full paths (.well-known/*, /oauth/*, and the
// human-authenticated /api/oauth/* pair).
app.route("/", oauthRoutes);

// Public, signature-verified. Not under /api — the storefront never calls it.
app.route("/webhooks/razorpay", razorpayWebhook);

app.onError((err, c) => {
  if (err instanceof DomainError) {
    return c.json(
      { error: err.message, code: err.code },
      err.statusCode as ContentfulStatusCode
    );
  }

  logger.error("http", `unhandled ${c.req.method} ${c.req.path}`, err);
  return c.json({ error: "Internal server error", code: "INTERNAL_ERROR" }, 500);
});

if (env.RESERVE_PAY_SIM) {
  logger.info(
    "boot",
    `RESERVE PAY SIMULATOR ON — mandates and debits are fake, no money moves`,
    { approvalDelayMs: env.RESERVE_PAY_SIM_APPROVAL_DELAY_MS, controls: "/api/reserve-pay/sim/*" }
  );
}

if (env.RESERVE_PAY_TEST_DEBIT_ROUTE) {
  const live = env.RAZORPAY_KEY_ID.startsWith("rzp_live_");
  logger[live ? "warn" : "info"](
    "boot",
    live
      ? "RESERVE_PAY_TEST_DEBIT_ROUTE is on with LIVE Razorpay keys — POST /api/reserve-pay/mandates/debit moves real money for any authenticated caller"
      : "RESERVE_PAY_TEST_DEBIT_ROUTE is on — POST /api/reserve-pay/mandates/debit is registered (test harness, charges with no order)"
  );
}

logger.info("boot", `listening on http://localhost:${env.PORT}`);

// Bun's server-config export — `bun src/server.ts` starts from this, no Bun.serve() call needed.
export default {
  port: env.PORT,
  fetch: app.fetch,
};
