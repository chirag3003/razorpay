import Razorpay from "razorpay";
import { env } from "../config/env";

export const razorpay = new Razorpay({
  key_id: env.RAZORPAY_KEY_ID,
  key_secret: env.RAZORPAY_KEY_SECRET,
});

const API_BASE = "https://api.razorpay.com/v1";

// Wraps the SDK's HTTP client so the exact request and Razorpay's verbatim reply reach the
// console. Every resource method (customers.create, payments.fetch) routes through this same
// object, so patching it here covers all of them. Auth is applied inside the SDK and never
// appears in these params, so nothing secret is printed.
if (env.RAZORPAY_DEBUG) {
  const api = razorpay.api as unknown as Record<string, unknown>;

  for (const verb of ["get", "post", "put", "patch", "delete"]) {
    const original = api[verb];
    if (typeof original !== "function") continue;

    api[verb] = async (params: { url?: string; data?: unknown }, ...rest: unknown[]) => {
      const line = `${verb.toUpperCase()} ${API_BASE}${params?.url ?? ""}`;
      console.log(`\n[razorpay] ${new Date().toISOString()}  ${line}`);
      console.log(`[razorpay] key_id   ${env.RAZORPAY_KEY_ID}`);
      console.log(`[razorpay] request  ${JSON.stringify(params?.data ?? null)}`);

      try {
        const result = await (original as Function).apply(razorpay.api, [params, ...rest]);
        console.log(`[razorpay] success  ${JSON.stringify(result)}`);
        return result;
      } catch (err) {
        // The SDK normalises failures to { statusCode, error }, so both halves are logged
        // separately — the ticket needs the HTTP status as well as Razorpay's error body.
        const e = err as { statusCode?: unknown; error?: unknown };
        console.log(`[razorpay] FAILED   status=${e?.statusCode ?? "n/a"}`);
        console.log(`[razorpay] error    ${JSON.stringify(e?.error ?? String(err))}`);
        throw err;
      }
    };
  }

  console.log(`[razorpay] debug logging ON for ${env.RAZORPAY_KEY_ID}`);
}
