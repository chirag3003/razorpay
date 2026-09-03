import "dotenv/config";
import { envSchema } from "../schemas/env.schema";

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment configuration:");
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
  }
  process.exit(1);
}

// Refuse to pair the Reserve Pay simulator with live credentials. The simulator reports debits
// as captured without moving money; against a live key that is a lie about real funds, and the
// card checkout path on the same key is not simulated at all.
if (parsed.data.RESERVE_PAY_SIM && parsed.data.RAZORPAY_KEY_ID.startsWith("rzp_live_")) {
  console.error(
    "RESERVE_PAY_SIM is on with a live RAZORPAY_KEY_ID. Switch to test keys, or turn the simulator off."
  );
  process.exit(1);
}

export const env = parsed.data;
