import { OpenRouter } from "@openrouter/sdk";
import { env } from "../config/env";

/**
 * The single OpenRouter client. `httpReferer`/`appTitle` are attribution headers; they make
 * requests identifiable in the OpenRouter activity log.
 *
 * Only src/llm may import this (backend/CLAUDE.md, "LLM Isolation").
 */
export const openrouter = new OpenRouter({
  apiKey: env.OPENROUTER_API_KEY,
  httpReferer: env.PUBLIC_APP_URL,
  // ASCII only: this becomes an HTTP header, and headers are Latin-1. An em dash here
  // throws "Header 'X-OpenRouter-Title' has invalid value" before the request is even sent.
  appTitle: "Razorpay Store Growth Agent",
});

// Primary plus fallbacks, in try order. OpenRouter's `models` array fails over server-side, so
// a dead primary costs no extra round trip. This is the whole provider-resilience story.
export const modelChain: string[] = [
  env.OPENROUTER_MODEL,
  ...(env.OPENROUTER_FALLBACK_MODEL ? [env.OPENROUTER_FALLBACK_MODEL] : []),
];
