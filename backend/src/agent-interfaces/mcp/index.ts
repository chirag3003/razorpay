import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { ALL_TOOLS, runTool } from "../tools/registry";
import { isOnSurface } from "../tools/types";
import type { ToolContext, ToolResult } from "../tools/types";

// Adapter over the same tool registry the chat agent uses. No logic of its own (Hard Rule #2) —
// it only translates runTool's {ok, data|error} into MCP's {content, structuredContent} /
// {isError, content}.
//
// One McpServer per request (routes/mcp.ts), so ctx is captured by closure rather than threaded
// through MCP's per-tool ServerContext.

/**
 * An external agent gets none of chat's systemPrompt.ts — no CURRENT CONTEXT, no conversation-wide
 * rules, nothing but each tool's own description, read once at session start. This is the MCP
 * equivalent: not a port of systemPrompt.ts, just the handful of its rules that are load-bearing
 * for correctness here and have no other way to reach an agent on this surface. Keep it short —
 * every line is competing with the rest of the agent's own context for attention.
 */
const AGENT_INSTRUCTIONS = `You are calling tools on Fresh Cart, a grocery store, on a customer's behalf.

- Never state a rupee figure — a price, a total, a balance — that isn't exactly what the most
  recent tool result said. Never add, subtract, or otherwise compute one yourself.
- Topping up or replacing a Reserve Pay balance makes the new amount the customer's entire
  balance; the old amount is released, not combined with it. start_reserve_pay_setup's response
  states this explicitly with the actual numbers whenever it applies — read it before reporting
  a balance to the customer.
- Never send the customer a raw upi:// string. Use the tool result's approvalUrl instead.
- Never call place_order without the customer's explicit yes, in this exchange, to the exact
  quote prepare_order just returned.`;

function toolResultToCallResult(result: ToolResult) {
  if (result.ok) {
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result.data) }],
      structuredContent: result.data as Record<string, unknown>,
    };
  }

  const { error } = result;
  const text = error.hint ? `${error.message} ${error.hint}` : error.message;
  return {
    isError: true,
    content: [{ type: "text" as const, text }],
  };
}

export function buildMcpServer(ctx: ToolContext): McpServer {
  const server = new McpServer(
    { name: "razorpay-store", version: "1.0.0" },
    { instructions: AGENT_INSTRUCTIONS }
  );

  for (const tool of ALL_TOOLS.filter((tool) => isOnSurface(tool, "mcp"))) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.input as z.ZodObject<z.ZodRawShape>,
        annotations: { readOnlyHint: tool.readOnly },
      },
      async (args: unknown) => toolResultToCallResult(await runTool(ctx, tool.name, args))
    );
  }

  return server;
}
