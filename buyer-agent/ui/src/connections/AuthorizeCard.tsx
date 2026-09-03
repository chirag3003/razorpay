import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api.ts";
import type { ConnectionStatus } from "../lib/protocol.ts";

/**
 * The OAuth hand-off, made legible.
 *
 * When an MCP server answers "authorizing" instead of connecting, this card is what the user
 * sees: what is about to happen, and one button — clicked directly, so the browser lets the
 * tab open — that sends them to the server to sign in. It then waits for the connection to
 * flip itself to "connected" (the panel polls, and the callback tab pings us on its way out).
 *
 * Nothing here is specific to any server. It is the same card for the project's own storefront
 * and for a public MCP server that happens to speak OAuth.
 */
export function AuthorizeCard({
  conn,
  onDone,
}: {
  conn: ConnectionStatus;
  onDone: () => void;
}) {
  const [phase, setPhase] = useState<"intro" | "waiting">("intro");
  const [busy, setBusy] = useState(false);
  const mintedRef = useRef(false);

  // A card that appeared for a connection the server has no authorize URL for yet (a cold-load
  // row that was never approved) — ask for one, then let the parent re-render us with it.
  useEffect(() => {
    if (conn.state === "authorizing" && !conn.authorizationUrl && !mintedRef.current) {
      mintedRef.current = true;
      void api.reconnect(conn.id).then(onDone).catch(onDone);
    }
  }, [conn.state, conn.authorizationUrl, conn.id, onDone]);

  // Once it lands, show the tick briefly then dismiss.
  useEffect(() => {
    if (conn.state === "connected") {
      const t = setTimeout(onDone, 1500);
      return () => clearTimeout(t);
    }
  }, [conn.state, onDone]);

  function openTab() {
    if (!conn.authorizationUrl) return;
    // Intentionally not "noopener": the callback tab pings this window on its way out so the
    // panel updates instantly instead of waiting for the next poll.
    window.open(conn.authorizationUrl, "_blank");
    setPhase("waiting");
  }

  async function cancel() {
    setBusy(true);
    try {
      await api.removeConnection(conn.id);
    } finally {
      setBusy(false);
      onDone();
    }
  }

  async function tryAgain() {
    setBusy(true);
    try {
      await api.reconnect(conn.id);
      setPhase("intro");
      mintedRef.current = false;
    } finally {
      setBusy(false);
      onDone();
    }
  }

  const shell = "rounded-lg border px-3.5 py-3 space-y-2";

  if (conn.state === "connected") {
    return (
      <div className={`${shell} border-good/40 bg-good/5`}>
        <p className="text-sm text-ink-100">
          Connected ✓ — {conn.toolCount} {conn.toolCount === 1 ? "tool" : "tools"}
        </p>
      </div>
    );
  }

  if (conn.state === "error") {
    return (
      <div className={`${shell} border-danger/40 bg-danger/8`}>
        <p className="text-sm text-ink-100">Couldn’t authorize {conn.label}</p>
        <p className="text-[11px] leading-snug text-danger">{conn.error}</p>
        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={tryAgain}
            disabled={busy}
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-ink-950 transition hover:brightness-110 disabled:opacity-40"
          >
            Try again
          </button>
          <button
            type="button"
            onClick={cancel}
            disabled={busy}
            className="rounded-md border border-ink-700 px-3 py-1.5 text-sm text-ink-300 transition hover:bg-ink-800 disabled:opacity-40"
          >
            Remove
          </button>
        </div>
      </div>
    );
  }

  // state === "authorizing"
  if (phase === "waiting") {
    return (
      <div className={`${shell} border-signal/40 bg-signal/5`}>
        <div className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-caution animate-pulse" />
          <p className="text-sm text-ink-100">Waiting for you to finish in the other tab…</p>
        </div>
        <p className="text-[11px] leading-snug text-ink-500">
          It connects on its own once you approve. This closes when it does.
        </p>
        <div className="flex gap-3 pt-1">
          <button
            type="button"
            onClick={openTab}
            className="text-[11px] text-ink-500 underline hover:text-ink-300"
          >
            Reopen tab
          </button>
          <button
            type="button"
            onClick={onDone}
            className="text-[11px] text-ink-500 underline hover:text-ink-300"
          >
            Check now
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`${shell} border-signal/40 bg-signal/5`}>
      <p className="text-sm text-ink-100">Authorize {conn.label}</p>
      <p className="text-[11px] leading-snug text-ink-500">
        This server uses OAuth. Click Authorize to sign in and grant access in a new tab — your
        credentials go to the server, never to this agent.
      </p>
      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={openTab}
          disabled={!conn.authorizationUrl}
          className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-ink-950 transition hover:brightness-110 disabled:opacity-40"
        >
          {conn.authorizationUrl ? "Authorize" : "Preparing…"}
        </button>
        <button
          type="button"
          onClick={cancel}
          disabled={busy}
          className="rounded-md border border-ink-700 px-3 py-1.5 text-sm text-ink-300 transition hover:bg-ink-800 disabled:opacity-40"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
