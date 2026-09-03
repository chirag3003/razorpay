// Partial masking for contact details shown on unauthenticated screens. Enough for the owner to
// recognise their own account, not enough for a forwarded link to disclose it.

const BULLET = "•";

/**
 * Keeps the first two characters and the domain: `chirag@gmail.com` -> `ch••••••@gmail.com`.
 * Falls back to masking the whole local part when it is too short to keep a prefix.
 */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at <= 0) return BULLET.repeat(Math.max(email.length, 4));

  const local = email.slice(0, at);
  const domain = email.slice(at);
  const keep = local.length > 3 ? 2 : 0;

  return local.slice(0, keep) + BULLET.repeat(Math.max(local.length - keep, 2)) + domain;
}

/** Keeps the last four digits: `9876543210` -> `••••••3210`. */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length <= 4) return BULLET.repeat(4);

  return BULLET.repeat(digits.length - 4) + digits.slice(-4);
}
