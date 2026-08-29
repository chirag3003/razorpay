import { useCallback, useEffect, useState } from "react";
import { api } from "./lib/api.ts";
import type { ActivityRow, ConnectionStatus, Settings, ToolPolicy } from "./lib/protocol.ts";
import { useChat } from "./chat/useChat.ts";
import { Transcript } from "./chat/Transcript.tsx";
import { Composer } from "./chat/Composer.tsx";
import { ConnectionsPanel } from "./connections/ConnectionsPanel.tsx";
import { SettingsPanel } from "./connections/SettingsPanel.tsx";
import type { ChatState } from "./chat/types.ts";

export function App() {
  const [connections, setConnections] = useState<ConnectionStatus[]>([]);
  const [tools, setTools] = useState<ToolPolicy[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [tab, setTab] = useState<"connections" | "settings">("connections");
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const refresh = useCallback(() => {
    void api.connections().then((d) => setConnections(d.connections)).catch(() => {});
    void api.tools().then((d) => setTools(d.tools)).catch(() => {});
    void api.settings().then((d) => setSettings(d.settings)).catch(() => {});
    void api.activity().then((d) => setActivity(d.activity)).catch(() => {});
  }, []);

  useEffect(refresh, [refresh]);

  const { state, send, stop, reset, resolve } = useChat(setConnections);

  // Tool policy and the activity log both move as a turn runs, so re-read once it settles.
  useEffect(() => {
    if (!state.busy) refresh();
  }, [state.busy, refresh]);

  const onApprove = useCallback(
    (id: string, approvalId: string, decision: "approve" | "reject", remember: boolean) => {
      void resolve({ kind: "approval", approvalId, decision, remember }, (prev: ChatState) => ({
        ...prev,
        items: prev.items.map((i) =>
          i.kind === "approval" && i.id === id
            ? { ...i, status: decision === "approve" ? "approved" : "rejected" }
            : i,
        ),
      }));
    },
    [resolve],
  );

  const onForm = useCallback(
    (
      id: string,
      formId: string,
      action: "accept" | "decline" | "cancel",
      content?: Record<string, unknown>,
    ) => {
      void resolve(
        action === "accept" ? { kind: "form", formId, action, content } : { kind: "form", formId, action },
        (prev: ChatState) => ({
          ...prev,
          items: prev.items.map((i) =>
            i.kind === "form" && i.id === id
              ? {
                  ...i,
                  status: action === "accept" ? "submitted" : action === "decline" ? "declined" : "cancelled",
                  answer: content,
                }
              : i,
          ),
        }),
      );
    },
    [resolve],
  );

  const onUrlPrompt = useCallback(
    (id: string, promptId: string, action: "accept" | "cancel") => {
      void resolve({ kind: "url_prompt", promptId, action }, (prev: ChatState) => ({
        ...prev,
        items: prev.items.map((i) =>
          i.kind === "url_prompt" && i.id === id
            ? { ...i, status: action === "accept" ? "done" : "cancelled" }
            : i,
        ),
      }));
    },
    [resolve],
  );

  const connected = connections.filter((c) => c.state === "connected").length;

  return (
    <div className="flex h-full">
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-ink-850 px-4 py-2.5">
          <div className="min-w-0">
            <h1 className="text-sm font-semibold text-ink-100">Buyer Agent</h1>
            <p className="text-[11px] text-ink-700">
              {connected > 0
                ? `${connected} service${connected === 1 ? "" : "s"} connected · ${tools.length} tools`
                : "no services connected"}
            </p>
          </div>

          <button
            type="button"
            onClick={reset}
            className="ml-auto rounded-md border border-ink-800 px-2.5 py-1 text-xs text-ink-500 transition hover:bg-ink-800 hover:text-ink-300"
          >
            New chat
          </button>
          <button
            type="button"
            onClick={() => setSidebarOpen((o) => !o)}
            className="rounded-md border border-ink-800 px-2.5 py-1 text-xs text-ink-500 transition hover:bg-ink-800 hover:text-ink-300 lg:hidden"
          >
            {sidebarOpen ? "Hide" : "Panel"}
          </button>
        </header>

        <Transcript
          items={state.items}
          busy={state.busy && !state.awaitingUser}
          currency={settings?.currencySymbol ?? "₹"}
          onApprove={onApprove}
          onForm={onForm}
          onUrlPrompt={onUrlPrompt}
        />

        <Composer
          busy={state.busy}
          awaitingUser={state.awaitingUser}
          onSend={send}
          onStop={stop}
        />
      </main>

      <aside
        className={
          "w-80 shrink-0 overflow-y-auto border-l border-ink-850 bg-ink-900/40 px-3.5 py-3 " +
          (sidebarOpen ? "block" : "hidden lg:block")
        }
      >
        <div className="mb-3 flex gap-1">
          {(["connections", "settings"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={
                "flex-1 rounded-md px-2 py-1 text-xs capitalize transition " +
                (tab === t ? "bg-ink-800 text-ink-100" : "text-ink-500 hover:text-ink-300")
              }
            >
              {t}
            </button>
          ))}
        </div>

        {tab === "connections" ? (
          <ConnectionsPanel
            connections={connections}
            tools={tools}
            settings={settings}
            onChanged={refresh}
          />
        ) : (
          <SettingsPanel settings={settings} activity={activity} onChanged={refresh} />
        )}
      </aside>
    </div>
  );
}
