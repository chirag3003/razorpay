import { useEffect, useRef } from "react";
import { SchemaForm } from "../forms/SchemaForm.tsx";
import { ApprovalCard } from "../approvals/ApprovalCard.tsx";
import type { TranscriptItem } from "./types.ts";

const SOURCE_LABEL = {
  mcp_elicitation: "requested over MCP",
  a2a_input_required: "requested over A2A",
  agent: "asked by the assistant",
} as const;

const TOOL_DOT = {
  running: "bg-signal animate-pulse",
  ok: "bg-good",
  failed: "bg-danger",
  blocked: "bg-caution",
} as const;

export function Transcript({
  items,
  busy,
  currency,
  onApprove,
  onForm,
  onUrlPrompt,
}: {
  items: TranscriptItem[];
  busy: boolean;
  currency: string;
  onApprove: (id: string, approvalId: string, decision: "approve" | "reject", remember: boolean) => void;
  onForm: (
    id: string,
    formId: string,
    action: "accept" | "decline" | "cancel",
    content?: Record<string, unknown>,
  ) => void;
  onUrlPrompt: (id: string, promptId: string, action: "accept" | "cancel") => void;
}) {
  const endRef = useRef<HTMLDivElement>(null);

  // Pin to the bottom as content streams in. Deliberately unconditional: the transcript is a live
  // console, and a form arriving off-screen is a turn that looks hung.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [items]);

  return (
    <div className="flex-1 overflow-y-auto px-4 py-5">
      <div className="mx-auto flex max-w-3xl flex-col gap-3.5">
        {items.length === 0 && <EmptyState />}

        {items.map((item) => {
          switch (item.kind) {
            case "user":
              return (
                <div key={item.id} className="self-end max-w-[85%]">
                  <div className="rounded-xl rounded-br-sm bg-ink-800 px-3.5 py-2 text-sm whitespace-pre-wrap text-ink-100">
                    {item.text}
                  </div>
                </div>
              );

            case "assistant":
              return (
                <div key={item.id} className="max-w-[92%] text-sm leading-relaxed whitespace-pre-wrap text-ink-100">
                  {item.text}
                  {item.streaming && <Caret />}
                </div>
              );

            case "thinking":
              return (
                <details key={item.id} className="group max-w-[92%]">
                  <summary className="cursor-pointer list-none text-xs text-ink-700 hover:text-ink-500">
                    <span className="group-open:hidden">▸ reasoning</span>
                    <span className="hidden group-open:inline">▾ reasoning</span>
                  </summary>
                  <div className="mt-1 border-l-2 border-ink-800 pl-3 text-xs leading-relaxed whitespace-pre-wrap text-ink-500">
                    {item.text}
                    {item.streaming && <Caret />}
                  </div>
                </details>
              );

            case "tool":
              return (
                <div key={item.id} className="rounded-lg border border-ink-800 bg-ink-900/60 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${TOOL_DOT[item.status]}`} />
                    <span className="font-mono text-xs text-accent">{item.toolName}</span>
                    <span className="truncate text-[11px] text-ink-500">{item.connectionLabel}</span>
                    {item.toolClass === "money" && (
                      <span className="ml-auto shrink-0 rounded border border-danger/50 px-1 text-[10px] tracking-wide text-danger uppercase">
                        money
                      </span>
                    )}
                  </div>

                  {item.progress.map((note, i) => (
                    <p key={i} className="mt-1 pl-3.5 text-[11px] text-ink-500">
                      {note}
                    </p>
                  ))}

                  {item.summary && (
                    <p
                      className={
                        "mt-1 pl-3.5 text-[11px] leading-snug " +
                        (item.status === "ok" ? "text-ink-500" : "text-caution")
                      }
                    >
                      {item.summary}
                    </p>
                  )}
                </div>
              );

            case "approval":
              return (
                <ApprovalCard
                  key={item.id}
                  detail={item.detail}
                  status={item.status}
                  currency={currency}
                  onDecide={(decision, remember) =>
                    onApprove(item.id, item.approvalId, decision, remember)
                  }
                />
              );

            case "form":
              return (
                <div
                  key={item.id}
                  className="rounded-lg border border-accent-dim/50 bg-accent/5 px-3.5 py-3"
                >
                  <div className="flex items-baseline gap-2">
                    <h3 className="text-sm font-semibold text-ink-100">{item.request.title}</h3>
                    <span className="ml-auto text-[10px] tracking-wide text-ink-500 uppercase">
                      {SOURCE_LABEL[item.request.source]}
                    </span>
                  </div>
                  {item.request.description && (
                    <p className="mt-1 mb-3 text-xs leading-snug text-ink-300">
                      {item.request.description}
                    </p>
                  )}

                  {item.status === "pending" ? (
                    <SchemaForm
                      schema={item.request.schema}
                      submitLabel={item.request.submitLabel}
                      secondaryLabel={item.request.allowDecline ? "Not now" : undefined}
                      onSubmit={(content) => onForm(item.id, item.request.formId, "accept", content)}
                      onSecondary={() => onForm(item.id, item.request.formId, "decline")}
                    />
                  ) : item.status === "submitted" ? (
                    <div className="space-y-0.5">
                      {Object.entries(item.answer ?? {}).map(([key, value]) => (
                        <div key={key} className="flex gap-2 text-xs">
                          <span className="text-ink-500">{key}</span>
                          <span className="font-mono text-ink-100">
                            {Array.isArray(value) ? value.join(", ") : String(value)}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-ink-500">Dismissed without answering.</p>
                  )}
                </div>
              );

            case "url_prompt":
              return (
                <div key={item.id} className="rounded-lg border border-signal/40 bg-signal/5 px-3.5 py-3">
                  <p className="text-sm text-ink-100">{item.prompt.message}</p>
                  <a
                    href={item.prompt.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="mt-1 block font-mono text-xs break-all text-signal underline"
                  >
                    {item.prompt.url}
                  </a>
                  {item.status === "pending" ? (
                    <div className="mt-3 flex gap-2">
                      <button
                        type="button"
                        onClick={() => onUrlPrompt(item.id, item.prompt.promptId, "accept")}
                        className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-ink-950"
                      >
                        I've done it
                      </button>
                      <button
                        type="button"
                        onClick={() => onUrlPrompt(item.id, item.prompt.promptId, "cancel")}
                        className="rounded-md border border-ink-700 px-3 py-1.5 text-sm text-ink-300"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <p className="mt-2 text-xs text-ink-500">
                      {item.status === "done" ? "✓ Confirmed" : "Cancelled"}
                    </p>
                  )}
                </div>
              );

            case "error":
              return (
                <div
                  key={item.id}
                  className="rounded-lg border border-danger/40 bg-danger/8 px-3.5 py-2.5 text-sm text-ink-100"
                >
                  {item.message}
                </div>
              );
          }
        })}

        {busy && <Working />}
        <div ref={endRef} />
      </div>
    </div>
  );
}

function Caret() {
  return <span className="ml-px inline-block h-3.5 w-1.5 translate-y-0.5 bg-accent" />;
}

function Working() {
  return (
    <div className="flex items-center gap-1 pl-0.5">
      {[0, 1, 2].map((i) => (
        <span key={i} className="animate-dot h-1 w-1 rounded-full bg-ink-500" />
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="mt-16 text-center">
      <h2 className="text-lg font-semibold text-ink-100">A buyer-side agent</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ink-500">
        Connect an MCP server or an A2A agent, and I'll work out what it can do and use it on your
        behalf. I don't know anything about any particular shop — I learn what's possible from
        whatever you connect.
      </p>
    </div>
  );
}
