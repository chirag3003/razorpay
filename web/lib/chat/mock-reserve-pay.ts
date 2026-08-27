/**
 * A localStorage-backed stand-in for the Reserve Pay mandate ledger the backend
 * will own. Models only what the UI needs: a block, what's been debited from
 * it, and an expiry.
 *
 * Real flow this stands in for: create customer -> create order with
 * `token.type: single_block_multiple_debit` -> authorisation payment with
 * `upi.flow: "intent"` (the one human approval) -> fetch token. Afterwards each
 * debit is a headless server-to-server call.
 */

import type { ChatErrorCode, ChatMandate, Rupees } from "@/lib/chat/protocol";

const STORE_KEY = "freshcart-chat-mock";

/** Regulatory ceilings from the Razorpay docs. */
export const RESERVE_MAX_AMOUNT: Rupees = 10_000;
export const RESERVE_MAX_VALIDITY_DAYS = 90;

/** `?chatmock=` forces a branch so failure paths are demoable on demand. */
export type MockScenario =
  | "happy"
  | "insufficient"
  | "expired"
  | "revoked"
  | "bank_down";

type MockState = {
  mandate: ChatMandate | null;
  scenario: MockScenario;
};

function read(): MockState {
  if (typeof window === "undefined") return { mandate: null, scenario: "happy" };
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return { mandate: null, scenario: "happy" };
    return JSON.parse(raw) as MockState;
  } catch {
    return { mandate: null, scenario: "happy" };
  }
}

function write(state: MockState) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch {
    // Private mode / quota — the mock degrades to in-memory-per-render, which
    // is survivable for a demo.
  }
}

function daysFromNow(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function randomId(prefix: string): string {
  return `${prefix}_mock${Math.random().toString(36).slice(2, 12)}`;
}

export function getScenario(): MockScenario {
  return read().scenario;
}

export function setScenario(scenario: MockScenario) {
  const state = read();
  write({ ...state, scenario });

  // The scenario knobs need a mandate to act on, so seed one that already
  // exhibits the condition being demoed.
  if (scenario === "insufficient") {
    write({
      scenario,
      mandate: {
        tokenId: randomId("token"),
        maxAmount: RESERVE_MAX_AMOUNT,
        amountBlocked: 2_000,
        amountDebited: 1_660,
        expiredAt: daysFromNow(RESERVE_MAX_VALIDITY_DAYS),
        status: "active",
      },
    });
  } else if (scenario === "expired") {
    write({
      scenario,
      mandate: {
        tokenId: randomId("token"),
        maxAmount: RESERVE_MAX_AMOUNT,
        amountBlocked: 2_000,
        amountDebited: 400,
        expiredAt: daysFromNow(-1),
        status: "expired",
      },
    });
  } else if (scenario === "revoked") {
    write({
      scenario,
      mandate: {
        tokenId: randomId("token"),
        maxAmount: RESERVE_MAX_AMOUNT,
        amountBlocked: 2_000,
        amountDebited: 0,
        expiredAt: daysFromNow(RESERVE_MAX_VALIDITY_DAYS),
        status: "revoked",
      },
    });
  }
}

export function getMandate(): ChatMandate | null {
  const { mandate } = read();
  if (!mandate) return null;
  // Expiry is a clock fact, not stored state — recompute on every read.
  if (mandate.status === "active" && new Date(mandate.expiredAt).getTime() <= Date.now()) {
    return { ...mandate, status: "expired" };
  }
  return mandate;
}

/** Creates the pending mandate and returns the intent deep link to approve. */
export function createMandate(amount: Rupees): { mandate: ChatMandate; upiUri: string } {
  const state = read();
  const mandate: ChatMandate = {
    tokenId: randomId("token"),
    maxAmount: RESERVE_MAX_AMOUNT,
    amountBlocked: Math.min(amount, RESERVE_MAX_AMOUNT),
    amountDebited: 0,
    expiredAt: daysFromNow(RESERVE_MAX_VALIDITY_DAYS),
    // Not usable until approved in the UPI app.
    status: "revoked",
  };
  write({ ...state, mandate });
  return { mandate, upiUri: buildIntentUri(mandate.amountBlocked) };
}

export function approveMandate(): ChatMandate | null {
  const state = read();
  if (!state.mandate) return null;
  const mandate: ChatMandate = { ...state.mandate, status: "active" };
  write({ ...state, mandate });
  return mandate;
}

export function topUp(amount: Rupees): { mandate: ChatMandate; upiUri: string } {
  // A real top-up is a fresh block; the old one is exhausted, not extended.
  return createMandate(amount);
}

export function expireNow() {
  const state = read();
  if (!state.mandate) return;
  write({
    ...state,
    mandate: { ...state.mandate, status: "expired", expiredAt: daysFromNow(-1) },
  });
}

export function revoke() {
  const state = read();
  if (!state.mandate) return;
  write({ ...state, mandate: { ...state.mandate, status: "revoked" } });
}

export function resetMock() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STORE_KEY);
}

export type DebitResult =
  | { ok: true; paymentId: string; debited: Rupees; remainingAfter: Rupees }
  | { ok: false; code: ChatErrorCode };

export function debit(amount: Rupees): DebitResult {
  const state = read();
  const mandate = getMandate();

  if (state.scenario === "bank_down") return { ok: false, code: "bank_not_available" };
  if (!mandate) return { ok: false, code: "reserve_insufficient" };
  if (mandate.status === "expired") return { ok: false, code: "mandate_expired" };
  if (mandate.status === "revoked") return { ok: false, code: "mandate_revoked" };
  if (amount > mandate.maxAmount) return { ok: false, code: "transaction_limit_exceeded" };

  const remaining = mandate.amountBlocked - mandate.amountDebited;
  if (amount > remaining) return { ok: false, code: "reserve_insufficient" };

  const next: ChatMandate = { ...mandate, amountDebited: mandate.amountDebited + amount };
  write({ ...state, mandate: next });

  return {
    ok: true,
    paymentId: randomId("pay"),
    debited: amount,
    remainingAfter: next.amountBlocked - next.amountDebited,
  };
}

/**
 * Mirrors the shape Razorpay returns from the authorisation payment. Real
 * clients may swap the `upi://` scheme for an app-specific one (gpay://,
 * phonepe://) keeping the query string intact.
 */
function buildIntentUri(amount: Rupees): string {
  const params = new URLSearchParams({
    pa: "freshcart.rzprec@example",
    pn: "FreshCart",
    mn: "Create Mandate",
    am: amount.toFixed(2),
    amrule: "MAX",
    recur: "ASPRESENTED",
    cu: "INR",
    txnType: "CREATE",
    block: "Y",
  });
  return `upi://mandate?${params.toString()}`;
}
