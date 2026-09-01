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
import { chatRoutes } from "./routes/chat";
import { adminRoutes } from "./routes/admin";
import { oauthRoutes } from "./routes/oauth";
import { mcpRoutes } from "./routes/mcp";
import { razorpayWebhook } from "./webhooks/razorpay";
import type { AppEnv } from "./types";
import { logger } from "hono/logger";

const app = new Hono<AppEnv>();

app.use(logger())

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

  console.error(err);
  return c.json({ error: "Internal server error", code: "INTERNAL_ERROR" }, 500);
});

console.log(`backend listening on http://localhost:${env.PORT}`);

// Bun's server-config export — `bun src/server.ts` starts from this, no Bun.serve() call needed.
export default {
  port: env.PORT,
  fetch: app.fetch,
};
