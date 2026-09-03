"use client";

import { use, useCallback, useEffect, useState } from "react";
import { Check, Loader2, ShieldCheck } from "lucide-react";
import { Card } from "@/components/ui/card";
import { ErrorState } from "@/components/common/error-state";
import { UpiApprovalControls } from "@/components/reserve-pay/upi-approval-controls";
import { getApproval, ApprovalLinkError, type ApprovalView } from "@/lib/api/reserve-pay";
import { formatPrice } from "@/lib/utils";

/**
 * Where an agent sends the customer to approve a reserved balance it set up over MCP. Agents have
 * no widget to render into, so without this they would paste a raw `upi://mandate?…` string —
 * unreadable, and untappable on a desktop.
 *
 * Deliberately **not** behind auth and outside the `(shop)` group: the recipient is a person with
 * a link, usually not the signed-in browser. The 32-byte token in the path is the only credential,
 * and it unlocks nothing but a masked summary plus the UPI link the customer must still approve
 * with their own PIN.
 */

/** Long enough not to hammer the provider, short enough that approval feels immediate. */
const POLL_MS = 3000;

type Phase =
  | { kind: "loading" }
  | { kind: "invalid"; message: string }
  | { kind: "ready"; view: ApprovalView };

export default function ApprovePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });

  const load = useCallback(async () => {
    try {
      setPhase({ kind: "ready", view: await getApproval(token) });
    } catch (err) {
      setPhase({
        kind: "invalid",
        message:
          err instanceof ApprovalLinkError
            ? err.message
            : "Could not reach the store. Check your connection and try again.",
      });
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  // Polls only while the outcome can still change, so an approved or dead link stops calling.
  const pending = phase.kind === "ready" && phase.view.status === "pending";
  useEffect(() => {
    if (!pending) return;
    const id = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(id);
  }, [pending, load]);

  return (
    <main className="flex min-h-dvh items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-sm p-5">
        {phase.kind === "loading" && (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading…
          </div>
        )}

        {phase.kind === "invalid" && (
          <ErrorState
            title="This link is no longer valid"
            description={`${phase.message} Ask for a new one, or set up the balance from the store.`}
          />
        )}

        {phase.kind === "ready" && <Approval view={phase.view} />}
      </Card>
    </main>
  );
}

function Approval({ view }: { view: ApprovalView }) {
  if (view.status === "confirmed") {
    return (
      <div className="py-4 text-center">
        <Check className="mx-auto mb-2 size-8 text-primary" />
        <p className="text-sm font-medium">{formatPrice(view.amountInRupees)} reserved</p>
        <p className="mt-1 text-xs text-muted-foreground">
          You can close this page — the assistant can now pay for your orders.
        </p>
      </div>
    );
  }

  // Anything not pending and not confirmed is terminal: revoked, expired, failed, exhausted.
  if (view.status !== "pending") {
    return (
      <ErrorState
        title="This balance is no longer active"
        description={`The request was ${view.status}. Ask the assistant to set up a new one.`}
      />
    );
  }

  return (
    <div>
      <div className="mb-1 flex items-center gap-2 text-sm font-medium">
        <ShieldCheck className="size-4 text-primary" />
        Approve reserved balance
      </div>
      <p className="mb-4 text-xs text-muted-foreground">
        Approve once in your UPI app. After that the assistant can pay for your orders without a
        PIN each time, up to this amount.
      </p>

      <div className="mb-4 rounded-lg border bg-muted/30 p-3">
        <p className="text-2xl font-semibold">{formatPrice(view.amountInRupees)}</p>
        <p className="text-xs text-muted-foreground">valid {view.validityDays} days</p>

        {/* Masked, not full: this page is reachable by anyone holding the link. Enough for the
            owner to recognise the account before entering a PIN, and no more. */}
        <div className="mt-3 border-t pt-3">
          <p className="text-xs text-muted-foreground">Adding to</p>
          <p className="text-sm font-medium">{view.account.name}</p>
          <p className="text-xs text-muted-foreground">{view.account.email}</p>
          <p className="text-xs text-muted-foreground">{view.account.phone}</p>
        </div>
      </div>

      {view.intentUrl && (
        <UpiApprovalControls upiUri={view.intentUrl} links={view.intentLinks} />
      )}

      <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="size-3 animate-spin" />
        Waiting for your approval
      </p>
    </div>
  );
}
