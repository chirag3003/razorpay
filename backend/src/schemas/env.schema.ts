import { z } from "zod";

export const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  JWT_SECRET: z.string().min(16, "JWT_SECRET must be at least 16 characters"),
  PORT: z.coerce.number().int().positive().default(4000),
  RAZORPAY_KEY_ID: z.string().min(1, "RAZORPAY_KEY_ID is required"),
  RAZORPAY_KEY_SECRET: z.string().min(1, "RAZORPAY_KEY_SECRET is required"),
  RAZORPAY_WEBHOOK_SECRET: z
    .string()
    .min(1, "RAZORPAY_WEBHOOK_SECRET is required"),
  // Logs every Razorpay request and its verbatim reply to the console. Diagnostics only — it
  // prints request bodies, including customer contact details.
  RAZORPAY_DEBUG: z
    .string()
    .default("false")
    .transform((v) => v === "true" || v === "1"),

  // Gates src/logger.ts's INFO lines (every HTTP request, tool call and LLM round). WARN/ERROR
  // always print regardless — a quiet run should still say when something broke. Defaults on:
  // this backend is otherwise hard to follow from the console.
  DEBUG_LOGS: z
    .string()
    .default("true")
    .transform((v) => v === "true" || v === "1"),

  // Serves the Reserve Pay rail from a local simulator instead of Razorpay — the S2S payment API
  // is not provisioned on the account, so no mandate can otherwise be authorised. Config rejects
  // this against a live key. z.coerce.boolean() is wrong here: it reads "false" as true.
  RESERVE_PAY_SIM: z
    .string()
    .default("false")
    .transform((v) => v === "true" || v === "1"),
  // How long a simulated block stays `pending` before it counts as approved. Sized against chat,
  // not against the API: one chat turn measures ~6s, so a shorter window is already over by the
  // customer's first "I've approved it" and the pending state is never seen. Set 0 to confirm
  // instantly.
  RESERVE_PAY_SIM_APPROVAL_DELAY_MS: z.coerce.number().int().min(0).default(20000),
  // Replays the webhook Razorpay would have sent, correctly signed, so the async reconciliation
  // path runs rather than only the polling path.
  RESERVE_PAY_SIM_WEBHOOKS: z
    .string()
    .default("true")
    .transform((v) => v === "true" || v === "1"),
  RESERVE_PAY_SIM_WEBHOOK_DELAY_MS: z.coerce.number().int().min(0).default(500),

  // Registers POST /api/reserve-pay/mandates/debit, a test harness that charges the caller's own
  // Reserve Pay block for an arbitrary amount and creates no order. Off by default: it moves real
  // money against real keys and any authenticated user can call it. Same "registered only when
  // enabled" treatment as the /sim/* controls, and the same "true"/"1" shape — z.coerce.boolean()
  // is wrong here, it reads "false" as true.
  RESERVE_PAY_TEST_DEBIT_ROUTE: z
    .string()
    .default("false")
    .transform((v) => v === "true" || v === "1"),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
  // ADMIN_PASSWORD is the shared operator secret exchanged at POST /api/admin/login.
  // ADMIN_JWT_SECRET is distinct from JWT_SECRET, so a leaked user-token secret cannot mint an
  // admin token.
  ADMIN_PASSWORD: z.string().min(1, "ADMIN_PASSWORD is required"),
  ADMIN_JWT_SECRET: z
    .string()
    .min(16, "ADMIN_JWT_SECRET must be at least 16 characters"),

  // OpenRouter is the only LLM provider, and src/llm the only place that talks to it.
  OPENROUTER_API_KEY: z.string().min(1, "OPENROUTER_API_KEY is required"),
  // Any OpenRouter model slug. Swapping providers is this string and nothing else.
  OPENROUTER_MODEL: z.string().default("anthropic/claude-sonnet-4.5"),
  // Tried in order after the primary if it errors or is rate-limited. Empty disables fallback.
  OPENROUTER_FALLBACK_MODEL: z.string().default("openai/gpt-4.1-mini"),
  // OpenRouter attribution headers, and the base for storefront hrefs in chat widgets.
  PUBLIC_APP_URL: z.url().default("http://localhost:3000"),

  // This backend's own externally-reachable origin, used to build the absolute URLs in the RFC
  // 8414/9728 metadata documents. Local dev against a remote MCP client needs a tunnel (ngrok),
  // same as the webhook receiver.
  OAUTH_ISSUER_URL: z.url().default("http://localhost:4000"),
});

export type Env = z.infer<typeof envSchema>;
