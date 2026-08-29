import { useState } from "react";
import { api } from "../lib/api.ts";
import type { ConnectionStatus, Settings, ToolPolicy } from "../lib/protocol.ts";

const STATE_DOT = {
  connected: "bg-good",
  connecting: "bg-caution animate-pulse",
  error: "bg-danger",
} as const;

const CLASS_COLOR = {
  read: "text-signal",
  write: "text-caution",
  money: "text-danger",
} as const;

/**
 * Where a merchant becomes reachable.
 *
 * This is the whole "any agent can plug in" claim reduced to a form: a URL, optionally a token,
 * and the agent discovers the rest. Nothing here is specific to any service — connecting the
 * project's own storefront later is the same three fields as connecting a public weather server.
 */
export function ConnectionsPanel({
  connections,
  tools,
  settings,
  onChanged,
}: {
  connections: ConnectionStatus[];
  tools: ToolPolicy[];
  settings: Settings | null;
  onChanged: () => void;
}) {
  const [kind, setKind] = useState<"mcp" | "a2a">("mcp");
  const [transport, setTransport] = useState<"url" | "stdio">("url");
  const [url, setUrl] = useState("");
  const [command, setCommand] = useState("");
  const [label, setLabel] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    setBusy(true);
    setError(null);
    try {
      const [cmd, ...args] = command.trim().split(/\s+/);
      const result = await api.addConnection({
        kind,
        label: label.trim() || undefined,
        token: token.trim() || undefined,
        ...(kind === "mcp" && transport === "stdio"
          ? { command: cmd, args }
          : { url: url.trim() }),
      });
      if (result.connection.state === "error") {
        setError(result.connection.error ?? "Could not connect.");
      } else {
        setUrl("");
        setCommand("");
        setLabel("");
        setToken("");
      }
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const inputClass =
    "w-full rounded-md border border-ink-700 bg-ink-950 px-2.5 py-1.5 text-sm text-ink-100 " +
    "outline-none placeholder:text-ink-700 focus:border-accent-dim";

  return (
    <div className="space-y-5">
      <section>
        <h3 className="mb-2 text-xs font-semibold tracking-wide text-ink-300 uppercase">
          Add a connection
        </h3>

        <div className="space-y-2">
          <div className="flex gap-1">
            {(["mcp", "a2a"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className={
                  "flex-1 rounded-md border px-2 py-1 text-xs uppercase transition " +
                  (kind === k
                    ? "border-accent bg-accent/15 text-ink-100"
                    : "border-ink-700 text-ink-500 hover:bg-ink-800")
                }
              >
                {k}
              </button>
            ))}
          </div>

          {kind === "mcp" && (
            <div className="flex gap-1">
              {(["url", "stdio"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTransport(t)}
                  className={
                    "flex-1 rounded border px-2 py-0.5 text-[11px] transition " +
                    (transport === t
                      ? "border-ink-500 text-ink-100"
                      : "border-ink-800 text-ink-500 hover:bg-ink-800")
                  }
                >
                  {t === "url" ? "HTTP" : "stdio"}
                </button>
              ))}
            </div>
          )}

          {kind === "mcp" && transport === "stdio" ? (
            <input
              className={`${inputClass} font-mono text-xs`}
              placeholder="npx -y @modelcontextprotocol/server-everything stdio"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
            />
          ) : (
            <input
              className={inputClass}
              placeholder={kind === "a2a" ? "https://agent.example.com" : "http://localhost:3000/mcp"}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          )}

          <input
            className={inputClass}
            placeholder="Label (optional)"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
          <input
            className={inputClass}
            type="password"
            placeholder="Bearer token (optional)"
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />

          <button
            type="button"
            onClick={add}
            disabled={busy}
            className="w-full rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-ink-950 transition hover:brightness-110 disabled:opacity-40"
          >
            {busy ? "Connecting…" : "Connect"}
          </button>

          {error && <p className="text-xs leading-snug text-danger">{error}</p>}
          <p className="text-[11px] leading-snug text-ink-700">
            The token stays on the server and is never sent to this page.
          </p>
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-xs font-semibold tracking-wide text-ink-300 uppercase">
          Connected ({connections.length})
        </h3>

        {connections.length === 0 && (
          <p className="text-xs text-ink-700">Nothing connected yet.</p>
        )}

        <div className="space-y-1.5">
          {connections.map((conn) => (
            <div key={conn.id} className="rounded-md border border-ink-800 bg-ink-900/60 px-2.5 py-2">
              <div className="flex items-center gap-2">
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATE_DOT[conn.state]}`} />
                <span className="truncate text-sm text-ink-100">{conn.label}</span>
                <span className="shrink-0 rounded border border-ink-800 px-1 text-[10px] text-ink-500 uppercase">
                  {conn.kind}
                </span>
                <button
                  type="button"
                  onClick={() => api.removeConnection(conn.id).then(onChanged)}
                  className="ml-auto shrink-0 text-xs text-ink-700 hover:text-danger"
                  title="Disconnect"
                >
                  ✕
                </button>
              </div>
              <p className="mt-0.5 truncate font-mono text-[10px] text-ink-700">{conn.target}</p>
              {conn.state === "error" ? (
                <div className="mt-1 flex items-start gap-2">
                  <p className="flex-1 text-[11px] leading-snug text-danger">{conn.error}</p>
                  <button
                    type="button"
                    onClick={() => api.reconnect(conn.id).then(onChanged)}
                    className="shrink-0 text-[11px] text-ink-500 underline hover:text-ink-300"
                  >
                    retry
                  </button>
                </div>
              ) : (
                <p className="mt-0.5 text-[11px] text-ink-500">{conn.toolCount} tools</p>
              )}
            </div>
          ))}
        </div>
      </section>

      {tools.length > 0 && settings && (
        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-ink-300 uppercase">
            Tools ({tools.length})
          </h3>
          <div className="space-y-px">
            {tools.map((tool) => (
              <div
                key={tool.qualifiedName}
                className="flex items-center gap-2 rounded px-1.5 py-1 hover:bg-ink-900"
              >
                <span className={`shrink-0 font-mono text-[10px] ${CLASS_COLOR[tool.toolClass]}`}>
                  {tool.toolClass.slice(0, 4)}
                </span>
                <span className="truncate font-mono text-[11px] text-ink-300">{tool.name}</span>
                <select
                  value={tool.mode}
                  onChange={(e) =>
                    api
                      .setOverride({ qualifiedName: tool.qualifiedName, mode: e.target.value })
                      .then(onChanged)
                  }
                  className="ml-auto shrink-0 rounded border border-ink-800 bg-ink-950 px-1 py-px text-[10px] text-ink-300 outline-none"
                >
                  <option value="auto">auto</option>
                  <option value="ask">ask</option>
                  <option value="deny">deny</option>
                </select>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
