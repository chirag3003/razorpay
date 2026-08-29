import { useState } from "react";
import type { ApprovalDetail } from "../lib/protocol.ts";

const CLASS_STYLE = {
  read: "border-signal/40 bg-signal/5",
  write: "border-caution/40 bg-caution/5",
  money: "border-danger/50 bg-danger/8",
} as const;

const CLASS_LABEL = {
  read: "reads data",
  write: "changes something",
  money: "moves money",
} as const;

/**
 * The consent gate.
 *
 * It shows the raw arguments on purpose. The agent's own summary of what it is about to do is the
 * thing the user cannot verify — the arguments are the thing they can. A card that hid them behind
 * a friendly sentence would be asking for trust rather than establishing it.
 */
export function ApprovalCard({
  detail,
  status,
  currency,
  onDecide,
}: {
  detail: ApprovalDetail;
  status: "pending" | "approved" | "rejected";
  currency: string;
  onDecide: (decision: "approve" | "reject", remember: boolean) => void;
}) {
  const [remember, setRemember] = useState(false);
  const pending = status === "pending";

  return (
    <div className={`rounded-lg border px-3.5 py-3 ${CLASS_STYLE[detail.toolClass]}`}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-xs font-semibold tracking-wide text-ink-100 uppercase">
          Approval needed
        </span>
        <span className="rounded-full border border-ink-700 px-1.5 py-px text-[10px] tracking-wide text-ink-300 uppercase">
          {CLASS_LABEL[detail.toolClass]}
        </span>
        {detail.detectedAmount !== null && (
          <span className="ml-auto font-mono text-sm font-semibold text-ink-100">
            {currency}
            {detail.detectedAmount.toLocaleString()}
          </span>
        )}
      </div>

      <p className="mt-2 text-sm text-ink-100">
        <span className="font-mono text-accent">{detail.toolName}</span>
        <span className="text-ink-500"> on </span>
        <span className="text-ink-300">{detail.connectionLabel}</span>
      </p>
      <p className="mt-0.5 text-xs leading-snug text-ink-500">{detail.description}</p>

      <details className="mt-2 group">
        <summary className="cursor-pointer list-none text-xs text-ink-500 hover:text-ink-300">
          <span className="group-open:hidden">Show arguments ▸</span>
          <span className="hidden group-open:inline">Hide arguments ▾</span>
        </summary>
        <pre className="mt-1.5 max-h-56 overflow-auto rounded border border-ink-800 bg-ink-950 p-2 font-mono text-[11px] leading-relaxed text-ink-300">
          {JSON.stringify(detail.args, null, 2)}
        </pre>
      </details>

      {pending ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onDecide("approve", remember)}
            className="rounded-md bg-accent px-3.5 py-1.5 text-sm font-medium text-ink-950 transition hover:brightness-110"
          >
            Approve
          </button>
          <button
            type="button"
            onClick={() => onDecide("reject", false)}
            className="rounded-md border border-ink-700 px-3 py-1.5 text-sm text-ink-300 transition hover:bg-ink-800"
          >
            Reject
          </button>

          {/* Money actions never get a "don't ask again" — that is the one thing the user
              cannot delegate away, and offering it here would quietly undo the whole gate. */}
          {detail.toolClass !== "money" && (
            <label className="ml-1 flex cursor-pointer items-center gap-1.5 text-xs text-ink-500">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                className="accent-[var(--color-accent)]"
              />
              Always allow this tool
            </label>
          )}
        </div>
      ) : (
        <p
          className={`mt-3 text-xs font-medium ${status === "approved" ? "text-good" : "text-ink-500"}`}
        >
          {status === "approved" ? "✓ Approved" : "✕ Rejected — the action was not performed"}
        </p>
      )}
    </div>
  );
}
