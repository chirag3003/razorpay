import type { JsonSchema } from "../forms/types.ts";
import { normaliseObjectSchema } from "../connections/mcp.ts";
import { registry } from "../connections/registry.ts";
import type { CallHooks, DiscoveredTool, ToolOutcome } from "../connections/types.ts";

export const BUILTIN_CONNECTION_ID = "agent";

/**
 * Tools the agent always has, independent of what is connected.
 *
 * `request_user_input` is the one that matters. Without it the agent can only ask questions in
 * prose and hope the answer comes back parseable; with it, the agent can put a real form in front
 * of the user for anything at all — a budget, a size, a delivery window, a confirmation — and get
 * back structured data. It is the same renderer MCP elicitation and A2A input-required use, so a
 * form the agent invents is indistinguishable from one a server asked for.
 */
export const BUILTIN_TOOLS: DiscoveredTool[] = [
  {
    qualifiedName: "request_user_input",
    name: "request_user_input",
    connectionId: BUILTIN_CONNECTION_ID,
    connectionLabel: "This assistant",
    kind: "mcp",
    description:
      "Show the user a form and wait for their answer. Use this whenever you need specific " +
      "information from the user rather than guessing — a delivery address, a budget, a size, a " +
      "date, a choice between options, or a final confirmation. Prefer this over asking in prose " +
      "when the answer is structured, because you get back clean values instead of having to " +
      "parse a sentence. Describe each field with a clear `title` and, where it helps, a " +
      "`description`; use `enum` when there is a fixed set of choices.",
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short heading for the form." },
        description: {
          type: "string",
          description: "One or two sentences explaining why you are asking.",
        },
        schema: {
          type: "object",
          description:
            "A JSON Schema object describing the fields to collect. Must be " +
            '`{\"type\": \"object\", \"properties\": {...}, \"required\": [...]}`. Supported field ' +
            "types: string (with optional enum, format, maxLength), number, integer, boolean, and " +
            "arrays of enum strings.",
        },
        submitLabel: { type: "string", description: 'Button text. Defaults to "Continue".' },
      },
      required: ["title", "schema"],
    },
  },
  {
    qualifiedName: "list_connections",
    name: "list_connections",
    connectionId: BUILTIN_CONNECTION_ID,
    connectionLabel: "This assistant",
    kind: "mcp",
    description:
      "List the services currently connected to this assistant and how many tools each provides. " +
      "Use this when the user asks what you can do, or when you need to tell them that nothing " +
      "relevant is connected yet.",
    annotations: { readOnlyHint: true },
    inputSchema: { type: "object", properties: {} },
  },
];

export function isBuiltin(qualifiedName: string): boolean {
  return BUILTIN_TOOLS.some((t) => t.qualifiedName === qualifiedName);
}

export async function runBuiltin(
  qualifiedName: string,
  args: unknown,
  hooks: CallHooks,
): Promise<ToolOutcome> {
  if (qualifiedName === "list_connections") {
    const statuses = registry.statuses();
    if (statuses.length === 0) {
      return {
        ok: true,
        text:
          "No services are connected. The user can add an MCP server or an A2A agent from the " +
          "Connections panel; until then you can only talk, not act.",
      };
    }
    return {
      ok: true,
      text: statuses
        .map(
          (s) =>
            `- ${s.label} (${s.kind.toUpperCase()}, ${s.state})` +
            `${s.state === "connected" ? `, ${s.toolCount} tools` : ""}` +
            `${s.error ? ` — ${s.error}` : ""}`,
        )
        .join("\n"),
    };
  }

  if (qualifiedName === "request_user_input") {
    const input = (args ?? {}) as Record<string, unknown>;
    const schema = normaliseObjectSchema(input.schema);

    if (!schema.properties || Object.keys(schema.properties).length === 0) {
      return {
        ok: false,
        text:
          "The schema had no properties, so there was nothing to ask. Provide a JSON Schema " +
          "object with at least one field under `properties`.",
        retryable: true,
      };
    }

    const response = await hooks.requestForm({
      source: "agent",
      title: typeof input.title === "string" ? input.title : "A few details",
      description: typeof input.description === "string" ? input.description : undefined,
      schema: schema as JsonSchema,
      submitLabel: typeof input.submitLabel === "string" ? input.submitLabel : undefined,
      // The agent asked because it is stuck; offering a "decline" button just strands the turn.
      allowDecline: false,
    });

    if (response.action !== "accept") {
      return {
        ok: false,
        text: "The user dismissed the form without answering. Ask them in plain language instead.",
        retryable: false,
      };
    }

    return {
      ok: true,
      text: `The user provided:\n${JSON.stringify(response.content, null, 2)}`,
      structured: response.content,
    };
  }

  return { ok: false, text: `Unknown built-in tool "${qualifiedName}".`, retryable: false };
}
