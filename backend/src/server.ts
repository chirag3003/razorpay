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
import { razorpayWebhook } from "./webhooks/razorpay";
import type { AppEnv } from "./types";
import { logger } from "hono/logger";

const app = new Hono<AppEnv>();

// Logging — log all requests to the console.
app.use(logger())

// CORS — allow all origins, and allow all headers.
app.use(
  "*",
  cors({
    origin: env.CORS_ORIGIN,
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  })
);

// Root — just a simple health check.
app.get("/", (c) => c.json({ status: "ok" }));

// API routes.
app.route("/api/auth", authRoutes);
app.route("/api/categories", categoryRoutes);
app.route("/api/products", productRoutes);
app.route("/api/addresses", addressRoutes);
app.route("/api/cart", cartRoutes);
app.route("/api/orders", orderRoutes);

// Public, signature-verified — not under /api since it's not called by the storefront.
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

// Bun's own server config export — `bun src/server.ts` (and `bun --watch`) start the server
// from this without needing an explicit Bun.serve() call.
export default {
  port: env.PORT,
  fetch: app.fetch,
};
