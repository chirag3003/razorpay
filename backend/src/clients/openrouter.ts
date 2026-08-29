import { OpenRouter } from "@openrouter/sdk";
import { env } from "../config/env";

/**
 * The single OpenRouter client, created once like clients/razorpay.ts.
 *
 * `httpReferer` / `appTitle` are OpenRouter's attribution headers — they put the app on the
 * public leaderboard and, more usefully here, make requests identifiable in the OpenRouter
 * activity log when a demo goes sideways.
 *
 * Only src/llm may import this (backend/CLAUDE.md, "LLM Isolation"). Nothing in /services that
 * touches money is allowed to reach it, which stays greppable precisely because the import path
 * is this narrow.
 */
export const openrouter = new OpenRouter({
  apiKey: env.OPENROUTER_API_KEY,
  httpReferer: env.PUBLIC_APP_URL,
  // ASCII only: this becomes an HTTP header, and headers are Latin-1. An em dash here
  // throws "Header 'X-OpenRouter-Title' has invalid value" before the request is even sent.
  appTitle: "Razorpay Store Growth Agent",
});

/**
 * Primary model plus fallbacks, in the order OpenRouter should try them.
 *
 * OpenRouter's `models` array does the failover server-side: if the primary is down, rate-limited
 * or refuses, it routes to the next one without a second round trip from us. That is the whole
 * of our provider-resilience story, and it costs one array.
 */
export const modelChain: string[] = [
  env.OPENROUTER_MODEL,
  ...(env.OPENROUTER_FALLBACK_MODEL ? [env.OPENROUTER_FALLBACK_MODEL] : []),
];
