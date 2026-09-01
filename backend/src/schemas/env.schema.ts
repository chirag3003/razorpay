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
