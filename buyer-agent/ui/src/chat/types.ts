import type { ApprovalDetail, FormRequest, ToolClass, UrlPrompt } from "../lib/protocol.ts";

/**
 * The transcript is a flat, ordered list rather than a tree of messages.
 *
 * An agent turn interleaves prose, reasoning, tool calls and interruptions that need answering, and
 * they need to appear in the order they happened. Nesting tool calls under a "message" would lose
 * that ordering the moment a form arrives mid-sentence.
 */
export type TranscriptItem =
  | { kind: "user"; id: string; text: string }
  | { kind: "assistant"; id: string; text: string; streaming: boolean }
  | { kind: "thinking"; id: string; text: string; streaming: boolean }
  | {
      kind: "tool";
      id: string;
      callId: string;
      toolName: string;
      connectionLabel: string;
      toolClass: ToolClass;
      args: unknown;
      status: "running" | "ok" | "failed" | "blocked";
      progress: string[];
      summary?: string;
    }
  | {
      kind: "approval";
      id: string;
      approvalId: string;
      detail: ApprovalDetail;
      status: "pending" | "approved" | "rejected";
    }
  | {
      kind: "form";
      id: string;
      request: FormRequest;
      status: "pending" | "submitted" | "declined" | "cancelled";
      answer?: Record<string, unknown>;
    }
  | {
      kind: "url_prompt";
      id: string;
      prompt: UrlPrompt;
      status: "pending" | "done" | "cancelled";
    }
  | { kind: "error"; id: string; message: string; retryable: boolean };

export type ChatState = {
  items: TranscriptItem[];
  runId: string | null;
  busy: boolean;
  /** True while the loop is parked waiting on the user, so the composer can say so. */
  awaitingUser: boolean;
};
