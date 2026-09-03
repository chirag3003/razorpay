import { OpenRouter } from "@openrouter/sdk";
import { env } from "../config/env.ts";

/**
 * The single OpenRouter client. `httpReferer` / `appTitle` are attribution headers — they make
 * this agent's requests identifiable in the OpenRouter activity log. `appTitle` becomes an HTTP
 * header, so it must stay ASCII (an em dash throws before the request is even sent).
 */
export const openrouter = new OpenRouter({
  apiKey: env.OPENROUTER_API_KEY,
  httpReferer: env.PUBLIC_URL,
  appTitle: "buyer-agent",
});

/**
 * Primary plus fallback, in try order. OpenRouter fails over server-side through this list, so a
 * dead primary costs no extra round trip. This is the whole provider-resilience story.
 */
export const modelChain: string[] = [
  env.OPENROUTER_MODEL,
  ...(env.OPENROUTER_FALLBACK_MODEL ? [env.OPENROUTER_FALLBACK_MODEL] : []),
];
