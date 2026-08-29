/**
 * Mirror of the server's event union.
 *
 * Hand-copied rather than imported: the server is a separate package and the whole point of this
 * project is that the two halves talk over a wire contract, not shared imports. If this drifts
 * from server/src/protocol.ts the reducer's exhaustive switch is what catches it.
 */

export type ToolClass = "read" | "write" | "money";
export type FormSource = "mcp_elicitation" | "a2a_input_required" | "agent";

export type JsonSchema = {
  type?: string | string[];
  title?: string;
  description?: string;
  default?: unknown;
  enum?: unknown[];
  enumNames?: string[];
  format?: string;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  items?: JsonSchema;
  properties?: Record<string, JsonSchema>;
  required?: string[];
};

export type FormRequest = {
  formId: string;
  source: FormSource;
  connectionId?: string;
  connectionLabel?: string;
  title: string;
  description?: string;
  schema: JsonSchema;
  submitLabel?: string;
  allowDecline: boolean;
};

export type UrlPrompt = {
  promptId: string;
  connectionId: string;
  connectionLabel: string;
  message: string;
  url: string;
};

export type ApprovalDetail = {
  toolName: string;
  connectionLabel: string;
  description: string;
  toolClass: ToolClass;
  args: unknown;
  detectedAmount: number | null;
  capBreach?: { kind: "per_transaction" | "session"; limit: number; wouldBe: number };
};

export type ConnectionStatus = {
  id: string;
  kind: "mcp" | "a2a";
  label: string;
  target: string;
  state: "connected" | "connecting" | "error";
  error?: string;
  toolCount: number;
};

export type ServerEvent =
  | { type: "run_id"; runId: string }
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
  | { type: "tool_call_end"; callId: string; ok: boolean; summary: string; blocked?: boolean }
  | { type: "approval_request"; approvalId: string; callId: string; detail: ApprovalDetail }
  | { type: "form_request"; request: FormRequest }
  | { type: "url_prompt"; prompt: UrlPrompt }
  | { type: "connections"; connections: ConnectionStatus[] }
  | { type: "run_end"; runId: string; stopReason: string }
  | { type: "error"; message: string; retryable: boolean };

export type ToolPolicy = {
  qualifiedName: string;
  name: string;
  connectionId: string;
  connectionLabel: string;
  kind: "mcp" | "a2a";
  description: string;
  toolClass: ToolClass;
  mode: "auto" | "ask" | "deny";
  overridden: boolean;
};

export type Settings = {
  modes: Record<ToolClass, "auto" | "ask" | "deny">;
  overrides: Record<string, { mode?: string; toolClass?: ToolClass }>;
  perTransactionCap: number;
  sessionCap: number;
  currencySymbol: string;
};

export type ActivityRow = {
  at: string;
  conversationId: string;
  runId: string;
  connectionId: string;
  connectionLabel: string;
  tool: string;
  toolClass: ToolClass;
  reason: string;
  decision: "allowed" | "blocked";
  outcome?: "success" | "failure";
  amount?: number | null;
  detail?: string;
};
