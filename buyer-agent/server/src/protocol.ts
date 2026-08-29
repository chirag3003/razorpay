import type { FormRequest, UrlPrompt } from "./forms/types.ts";
import type { ConnectionStatus } from "./connections/types.ts";
import type { ToolClass } from "./policy/classify.ts";

/**
 * Server -> browser event union, streamed over SSE. The single source of truth for the wire; the
 * UI's reducer switches exhaustively on `type`, so adding an event here is a compile error there
 * until it is handled.
 */
export type ServerEvent =
  | { type: "run_start"; runId: string; conversationId: string }
  | { type: "thinking_delta"; delta: string }
  | { type: "text_delta"; delta: string }
  | {
      type: "tool_call_start";
      callId: string;
      toolName: string;
      connectionLabel: string;
      toolClass: ToolClass;
      args: unknown;
    }
  | { type: "tool_call_progress"; callId: string; note: string }
  | {
      type: "tool_call_end";
      callId: string;
      ok: boolean;
      summary: string;
      /** Set when the gate refused the call rather than the server failing it. */
      blocked?: boolean;
    }
  | { type: "approval_request"; approvalId: string; callId: string; detail: ApprovalDetail }
  | { type: "form_request"; request: FormRequest }
  | { type: "url_prompt"; prompt: UrlPrompt }
  | { type: "connections"; connections: ConnectionStatus[] }
  | { type: "run_end"; runId: string; stopReason: string }
  | { type: "error"; message: string; retryable: boolean };

export type ApprovalDetail = {
  toolName: string;
  connectionLabel: string;
  description: string;
  toolClass: ToolClass;
  args: unknown;
  /** Best-effort. Null when no amount could be identified in the arguments. */
  detectedAmount: number | null;
  /** Populated when the call would breach a cap; the UI shows this instead of an approve button. */
  capBreach?: { kind: "per_transaction" | "session"; limit: number; wouldBe: number };
};

/** Browser -> server, resolving whatever the run is currently blocked on. */
export type ResolvePayload =
  | { kind: "approval"; approvalId: string; decision: "approve" | "reject"; remember?: boolean }
  | { kind: "form"; formId: string; action: "accept"; content: Record<string, unknown> }
  | { kind: "form"; formId: string; action: "decline" | "cancel" }
  | { kind: "url_prompt"; promptId: string; action: "accept" | "cancel" };

export function sseFrame(event: ServerEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}
