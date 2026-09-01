import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { ALL_TOOLS, runTool } from "../tools/registry";
import type { ToolContext, ToolResult } from "../tools/types";

// Adapter over the same tool registry the chat agent uses. No logic of its own (Hard Rule #2) —
// it only translates runTool's {ok, data|error} into MCP's {content, structuredContent} /
// {isError, content}.
//
// One McpServer per request (routes/mcp.ts), so ctx is captured by closure rather than threaded
// through MCP's per-tool ServerContext.

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
  const server = new McpServer({ name: "razorpay-store", version: "1.0.0" });

  for (const tool of ALL_TOOLS) {
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
