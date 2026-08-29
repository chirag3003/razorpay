import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import type {
  CallHooks,
  ConnectionRecord,
  DiscoveredTool,
  MerchantConnection,
  ToolOutcome,
} from "./types.ts";
import type { JsonSchema } from "../forms/types.ts";

const CLIENT_INFO = { name: "buyer-agent", version: "0.1.0" } as const;

/**
 * A generic MCP client. It knows nothing about commerce — it lists whatever the server offers and
 * calls it.
 *
 * The interesting half is elicitation. We declare the `elicitation` capability at construction,
 * which is what makes a server willing to ask us mid-tool-call for input it is missing. That
 * request arrives as `elicitation/create` carrying a JSON Schema, and we hand it straight to the
 * UI's form renderer. Without the declared capability a server has to fail the call instead, so
 * this one line is the difference between "the shop can ask you for a delivery address" and "the
 * shop errors out".
 */
export class McpConnection implements MerchantConnection {
  readonly id: string;
  readonly kind = "mcp" as const;
  #label: string;
  #record: ConnectionRecord;
  #client: Client | null = null;
  /** Set for the duration of a callTool so the elicitation handler can reach the active hooks. */
  #hooks: CallHooks | null = null;

  constructor(record: ConnectionRecord) {
    this.id = record.id;
    this.#record = record;
    this.#label = record.label || record.url || record.command || record.id;
  }

  get label() {
    return this.#label;
  }

  async connect(): Promise<void> {
    const client = new Client(CLIENT_INFO, {
      capabilities: {
        // Both modes. `form` is the schema-driven one; `url` is "go here and come back".
        elicitation: { form: {}, url: {} },
      },
    });

    this.#installElicitationHandler(client);

    await client.connect(this.#buildTransport());
    this.#client = client;

    const info = client.getServerVersion();
    if (info?.name) this.#label = this.#record.label || info.name;
  }

  #buildTransport() {
    if (this.#record.command) {
      return new StdioClientTransport({
        command: this.#record.command,
        args: this.#record.args ?? [],
      });
    }
    if (!this.#record.url) {
      throw new Error("An MCP connection needs either a url or a command.");
    }
    const headers: Record<string, string> = {};
    if (this.#record.token) headers.Authorization = `Bearer ${this.#record.token}`;
    return new StreamableHTTPClientTransport(new URL(this.#record.url), {
      requestInit: { headers },
    });
  }

  #installElicitationHandler(client: Client) {
    client.setRequestHandler("elicitation/create", async (request) => {
      const params = request.params as Record<string, unknown>;
      const hooks = this.#hooks;

      // A server may elicit outside a tool call (or after we tore the run down). We cannot show a
      // form with no transcript to show it in, so decline rather than hang the server's request.
      if (!hooks) return { action: "decline" as const };

      const message = typeof params.message === "string" ? params.message : "";

      if (params.mode === "url" && typeof params.url === "string") {
        const res = await hooks.requestUrlVisit({
          connectionId: this.id,
          connectionLabel: this.#label,
          message: message || "This server needs you to complete a step in your browser.",
          url: params.url,
        });
        return res.action === "accept"
          ? { action: "accept" as const }
          : { action: res.action === "decline" ? ("decline" as const) : ("cancel" as const) };
      }

      const schema = normaliseObjectSchema(params.requestedSchema);
      const res = await hooks.requestForm({
        source: "mcp_elicitation",
        connectionId: this.id,
        connectionLabel: this.#label,
        title: schema.title ?? `${this.#label} needs some details`,
        description: message || schema.description,
        schema,
        allowDecline: true,
      });

      if (res.action === "accept") {
        return { action: "accept" as const, content: toElicitContent(res.content) };
      }
      return { action: res.action };
    });
  }

  async listTools(): Promise<DiscoveredTool[]> {
    const client = this.#require();
    const tools: DiscoveredTool[] = [];
    let cursor: string | undefined;

    // Paginate. A server with 200 tools returns them in pages and a client that reads only the
    // first page silently loses the rest.
    do {
      const page = await client.listTools(cursor ? { cursor } : undefined);
      for (const tool of page.tools) {
        tools.push({
          qualifiedName: qualify(this.id, tool.name),
          name: tool.name,
          connectionId: this.id,
          connectionLabel: this.#label,
          kind: "mcp",
          description: tool.description ?? tool.title ?? tool.name,
          inputSchema: normaliseObjectSchema(tool.inputSchema),
          annotations: tool.annotations as DiscoveredTool["annotations"],
        });
      }
      cursor = page.nextCursor;
    } while (cursor);

    return tools;
  }

  async callTool(name: string, args: unknown, hooks: CallHooks): Promise<ToolOutcome> {
    const client = this.#require();
    this.#hooks = hooks;
    try {
      const result = await client.callTool({
        name,
        arguments: (args ?? {}) as Record<string, unknown>,
      });

      const text = renderContent(result.content);
      // MCP signals tool-level failure in-band via isError, not by rejecting. Both paths have to
      // reach the model as a tool_result, so they converge here.
      if (result.isError) {
        return { ok: false, text: text || "The tool reported an error.", retryable: false };
      }
      return {
        ok: true,
        text: text || "(the tool returned no content)",
        structured: result.structuredContent,
      };
    } catch (err) {
      return {
        ok: false,
        text: err instanceof Error ? err.message : String(err),
        retryable: true,
      };
    } finally {
      this.#hooks = null;
    }
  }

  async close(): Promise<void> {
    await this.#client?.close();
    this.#client = null;
  }

  #require(): Client {
    if (!this.#client) throw new Error(`MCP connection ${this.id} is not connected.`);
    return this.#client;
  }
}

/**
 * MCP restricts elicitation results to flat primitives and string arrays — the SDK's types enforce
 * it. Our form renderer is more permissive (it also serves A2A and agent-authored forms), so
 * narrow here rather than weakening the shared FormResponse for every caller.
 */
function toElicitContent(
  content: Record<string, unknown>,
): Record<string, string | number | boolean | string[]> {
  const out: Record<string, string | number | boolean | string[]> = {};
  for (const [key, value] of Object.entries(content)) {
    if (value === null || value === undefined) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      out[key] = value;
    } else if (Array.isArray(value)) {
      out[key] = value.map(String);
    } else {
      // An object slipped through from a nested field the server did not ask for. Send it as JSON
      // rather than dropping the answer the user actually gave.
      out[key] = JSON.stringify(value);
    }
  }
  return out;
}

export function qualify(connectionId: string, toolName: string): string {
  // Anthropic tool names allow [a-zA-Z0-9_-]{1,128}; a server may use characters outside that.
  const safe = `${connectionId}__${toolName}`.replace(/[^a-zA-Z0-9_-]/g, "_");
  return safe.slice(0, 128);
}

/** Flatten MCP content blocks into the text the model will read. */
function renderContent(content: unknown): string {
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const b = block as Record<string, unknown>;
    if (b.type === "text" && typeof b.text === "string") parts.push(b.text);
    else if (b.type === "resource_link") parts.push(`[resource] ${String(b.uri ?? "")}`);
    else if (b.type === "resource") {
      const r = b.resource as Record<string, unknown> | undefined;
      if (r && typeof r.text === "string") parts.push(r.text);
      else parts.push(`[embedded resource ${String(r?.uri ?? "")}]`);
    } else if (b.type === "image" || b.type === "audio") {
      parts.push(`[${b.type} content omitted]`);
    }
  }
  return parts.join("\n").trim();
}

/**
 * Coerce whatever a server sent into an object schema the form renderer can walk.
 *
 * Servers do send odd things here — a bare `{}`, a non-object schema, a missing `type`. Rendering
 * an empty form is a better failure than throwing inside a tool call.
 */
export function normaliseObjectSchema(raw: unknown): JsonSchema {
  if (!raw || typeof raw !== "object") return { type: "object", properties: {} };
  const schema = raw as JsonSchema;
  if (schema.type === "object" || schema.properties) {
    return { ...schema, type: "object", properties: schema.properties ?? {} };
  }
  // A non-object schema gets wrapped so there is always exactly one field to render.
  return {
    type: "object",
    properties: { value: schema },
    required: ["value"],
  };
}
