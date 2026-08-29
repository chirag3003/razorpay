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
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
  // Admin surface (/api/admin) — deliberately separate from the human-session auth above.
  // ADMIN_PASSWORD is the single shared operator secret exchanged at POST /api/admin/login;
  // ADMIN_JWT_SECRET signs the resulting admin token with a key distinct from JWT_SECRET so a
  // leaked user-token secret can never mint an admin token.
  ADMIN_PASSWORD: z.string().min(1, "ADMIN_PASSWORD is required"),
  ADMIN_JWT_SECRET: z
    .string()
    .min(16, "ADMIN_JWT_SECRET must be at least 16 characters"),

  // Storefront chat agent. OpenRouter is the only LLM provider the backend talks to, and
  // src/llm is the only place that talks to it (backend/CLAUDE.md, "LLM Isolation").
  OPENROUTER_API_KEY: z.string().min(1, "OPENROUTER_API_KEY is required"),
  // Any OpenRouter model slug. Swapping providers is this string and nothing else — which is
  // the reason there is no LangChain-style provider abstraction in this codebase.
  OPENROUTER_MODEL: z.string().default("anthropic/claude-sonnet-4.5"),
  // Tried in order after the primary if it errors or is rate-limited. Empty disables fallback.
  OPENROUTER_FALLBACK_MODEL: z.string().default("openai/gpt-4.1-mini"),
  // Sent as HTTP-Referer/X-Title for OpenRouter attribution, and used to build the storefront
  // hrefs that go into chat widgets (order confirmation links, "see all results").
  PUBLIC_APP_URL: z.url().default("http://localhost:3000"),
});

export type Env = z.infer<typeof envSchema>;
