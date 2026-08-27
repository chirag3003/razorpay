// Razorpay returns the authorisation deep link as a generic `upi://mandate?...` URL. Handing a
// customer that generic link makes the OS show an app chooser, which is the right default — but
// a client that already knows which app the customer uses can skip the chooser by swapping the
// scheme. The query string is identical across every app; only the part before `?` changes.
//
// Scheme table is from Razorpay's UPI Reserve Pay integration docs ("App-Specific Deep Links").

const GENERIC_PREFIX = "upi://mandate";

const APP_PREFIXES = {
  gpay: "gpay://upi/mandate",
  phonepe: "phonepe://mandate",
  paytm: "paytmmp://mandate",
  bhim: "bhim://upi/mandate",
  cred: "credpay://upi/mandate",
  whatsapp: "whatsapp-consumer://upi/mandate",
} as const;

export type UpiApp = keyof typeof APP_PREFIXES;

export type UpiIntentLinks = { generic: string } & Record<UpiApp, string>;

/**
 * Expands a generic `upi://mandate` URL into one link per supported UPI app.
 *
 * Returns `null` for anything that isn't a generic mandate intent URL rather than guessing —
 * Razorpay's response shape is ours to read, not to assume, and a silently mangled payment
 * deep link is worse than no per-app links at all. Callers fall back to the raw URL.
 */
export function buildUpiIntentLinks(intentUrl: string): UpiIntentLinks | null {
  if (!intentUrl.startsWith(GENERIC_PREFIX)) return null;

  const query = intentUrl.slice(GENERIC_PREFIX.length);

  return {
    generic: intentUrl,
    ...(Object.fromEntries(
      Object.entries(APP_PREFIXES).map(([app, prefix]) => [app, `${prefix}${query}`])
    ) as Record<UpiApp, string>),
  };
}
