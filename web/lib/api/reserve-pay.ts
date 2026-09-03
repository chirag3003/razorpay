import { BASE_URL } from "@/lib/api/client";
import type { UpiIntentLinks } from "@/lib/chat/protocol";

/**
 * The unauthenticated approval endpoint behind `/approve/[token]`. Deliberately not `apiFetch`:
 * that attaches the session token, and this page is reached by whoever the agent sent the link to
 * — often not the signed-in browser, and frequently no signed-in browser at all.
 */

export type ApprovalView = {
  status: string;
  amountInRupees: number;
  validityDays: number;
  expiresAt: string;
  account: { name: string; email: string; phone: string };
  /** Null once the block is no longer pending, so a stale link cannot re-offer a live mandate. */
  intentUrl: string | null;
  intentLinks: UpiIntentLinks | null;
};

export class ApprovalLinkError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApprovalLinkError";
    this.status = status;
  }
}

export async function getApproval(token: string): Promise<ApprovalView> {
  if (!BASE_URL) throw new Error("NEXT_PUBLIC_API_BASE_URL is not set — add it to web/.env.local");

  const response = await fetch(`${BASE_URL}/api/reserve-pay/approval/${encodeURIComponent(token)}`, {
    // Always hit the origin: this drives a polling loop whose whole purpose is fresh status.
    cache: "no-store",
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new ApprovalLinkError(
      body?.error ?? "This approval link is no longer valid.",
      response.status
    );
  }

  return response.json();
}
