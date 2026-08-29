/**
 * The one form shape in the system.
 *
 * Three unrelated sources produce it — an MCP server's `elicitation/create`, an A2A task entering
 * `input-required`, and the agent's own `request_user_input` tool — and exactly one renderer
 * consumes it. Keeping them convergent here is what stops the UI from growing a branch per
 * protocol.
 */

/** A deliberately permissive JSON Schema view: we render what we recognise and ignore the rest. */
export type JsonSchema = {
  type?: string | string[];
  title?: string;
  description?: string;
  default?: unknown;
  enum?: unknown[];
  const?: unknown;
  format?: string;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  items?: JsonSchema;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  /** MCP elicitation uses this for single/multi-select display names alongside `enum`. */
  enumNames?: string[];
  [key: string]: unknown;
};

export type FormSource = "mcp_elicitation" | "a2a_input_required" | "agent";

export type FormRequest = {
  formId: string;
  source: FormSource;
  /** Which connection asked, when a connection asked. Absent for agent-authored forms. */
  connectionId?: string;
  connectionLabel?: string;
  title: string;
  description?: string;
  /** Always an object schema. Non-object schemas are wrapped by the adapter before they get here. */
  schema: JsonSchema;
  submitLabel?: string;
  /**
   * MCP elicitation distinguishes decline (a considered "no") from cancel (dismissed). Agent
   * forms generally cannot be declined — the agent asked because it is stuck without an answer.
   */
  allowDecline: boolean;
};

export type FormResponse =
  | { action: "accept"; content: Record<string, unknown> }
  | { action: "decline" }
  | { action: "cancel" };

/** A URL-mode elicitation: the server wants the user to go somewhere and come back. */
export type UrlPrompt = {
  promptId: string;
  connectionId: string;
  connectionLabel: string;
  message: string;
  url: string;
};
