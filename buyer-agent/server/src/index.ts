import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { env } from "./config/env.ts";
import { registry } from "./connections/registry.ts";
import { policy, type PolicyMode } from "./policy/gate.ts";
import { classifyTool, type ToolClass } from "./policy/classify.ts";
import { readActivity } from "./policy/activity.ts";
import { sessions } from "./session/store.ts";
import { runTurn } from "./agent/loop.ts";
import { BUILTIN_TOOLS } from "./agent/builtins.ts";
import { sseFrame, type ResolvePayload } from "./protocol.ts";
import { voiceStatus } from "./voice/provider.ts";

await policy.load();
await registry.load();

const app = new Hono();

app.use("*", cors({ origin: env.CORS_ORIGIN, allowHeaders: ["Content-Type"] }));

app.get("/api/health", (c) => c.json({ status: "ok", voice: voiceStatus() }));

/* ------------------------------------------------------------------ connections */

const addConnectionSchema = z.object({
  kind: z.enum(["mcp", "a2a"]),
  label: z.string().optional(),
  url: z.string().optional(),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  token: z.string().optional(),
});

app.get("/api/connections", (c) => c.json({ connections: registry.statuses() }));

app.post("/api/connections", async (c) => {
  const parsed = addConnectionSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: "Invalid connection", issues: parsed.error.issues }, 400);
  }
  if (!parsed.data.url && !parsed.data.command) {
    return c.json({ error: "Provide either a url or a command." }, 400);
  }
  if (parsed.data.kind === "a2a" && !parsed.data.url) {
    return c.json({ error: "A2A connections need a url." }, 400);
  }

  const status = await registry.add(parsed.data);
  // A failed connect is reported in the body, not as an HTTP error — the row exists and the user
  // needs to see why it failed in order to fix it.
  return c.json({ connection: status }, 201);
});

app.delete("/api/connections/:id", async (c) => {
  await registry.remove(c.req.param("id"));
  return c.json({ ok: true });
});

app.post("/api/connections/:id/reconnect", async (c) => {
  const status = await registry.reconnect(c.req.param("id"));
  if (!status) return c.json({ error: "No such connection" }, 404);
  return c.json({ connection: status });
});

// Where a merchant's OAuth authorization server sends the browser back after the
// human approves (or denies). Registered as the connection's redirect_uri. This
// is a top-level browser navigation, not an API call — it answers with a plain
// page telling the human to return to the agent.
app.get("/api/connections/:id/oauth/callback", async (c) => {
  const params = new URL(c.req.url).searchParams;
  const status = await registry.completeOAuth(c.req.param("id"), params);

  if (!status) {
    return c.html(callbackPage("Unknown connection", "You can close this tab."), 404);
  }
  if (status.state === "connected") {
    return c.html(
      callbackPage("Connected ✓", "You can close this tab and return to the agent."),
    );
  }
  return c.html(
    callbackPage(
      "Authorization failed",
      status.error ?? "Please try again from the agent's Connections panel.",
    ),
    400,
  );
});

function callbackPage(title: string, body: string): string {
  const esc = (s: string) =>
    s.replace(/[&<>"]/g, (ch) =>
      ch === "&" ? "&amp;" : ch === "<" ? "&lt;" : ch === ">" ? "&gt;" : "&quot;",
    );
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<style>
  body { font: 15px/1.5 system-ui, sans-serif; background: #0b0b0d; color: #e7e7ea;
         display: grid; place-content: center; min-height: 100vh; margin: 0; text-align: center; }
  main { max-width: 22rem; padding: 2rem; }
  h1 { font-size: 1.15rem; margin: 0 0 .5rem; }
  p { margin: 0; color: #a1a1aa; }
</style>
</head>
<body><main><h1>${esc(title)}</h1><p>${esc(body)}</p></main></body>
</html>`;
}

/* ------------------------------------------------------------------------ tools */

app.get("/api/tools", (c) => {
  const settings = policy.settings;
  const tools = [...BUILTIN_TOOLS, ...registry.tools()].map((tool) => {
    const override = settings.overrides[tool.qualifiedName];
    const toolClass = classifyTool(tool, override?.toolClass);
    return {
      qualifiedName: tool.qualifiedName,
      name: tool.name,
      connectionId: tool.connectionId,
      connectionLabel: tool.connectionLabel,
      kind: tool.kind,
      description: tool.description,
      toolClass,
      mode: override?.mode ?? settings.modes[toolClass],
      overridden: Boolean(override),
    };
  });
  return c.json({ tools });
});

/* --------------------------------------------------------------------- settings */

const settingsSchema = z.object({
  modes: z.record(z.enum(["read", "write", "money"]), z.enum(["auto", "ask", "deny"])).optional(),
  perTransactionCap: z.number().min(0).optional(),
  sessionCap: z.number().min(0).optional(),
  currencySymbol: z.string().max(4).optional(),
});

app.get("/api/settings", (c) => c.json({ settings: policy.settings }));

app.patch("/api/settings", async (c) => {
  const parsed = settingsSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: "Invalid settings", issues: parsed.error.issues }, 400);
  }
  const patch = { ...parsed.data };
  if (patch.modes) {
    patch.modes = { ...policy.settings.modes, ...patch.modes } as Record<ToolClass, PolicyMode>;
  }
  const settings = await policy.update(patch as Parameters<typeof policy.update>[0]);
  return c.json({ settings });
});

const overrideSchema = z.object({
  qualifiedName: z.string().min(1),
  mode: z.enum(["auto", "ask", "deny"]).optional(),
  toolClass: z.enum(["read", "write", "money"]).optional(),
});

app.post("/api/settings/overrides", async (c) => {
  const parsed = overrideSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "Invalid override" }, 400);
  const { qualifiedName, ...override } = parsed.data;
  const settings = await policy.setOverride(qualifiedName, override);
  return c.json({ settings });
});

/* --------------------------------------------------------------------- activity */

app.get("/api/activity", async (c) => c.json({ activity: await readActivity() }));

/* ------------------------------------------------------------------------- chat */

const chatSchema = z.object({
  conversationId: z.string().min(1),
  text: z.string().min(1),
});

app.post("/api/chat", async (c) => {
  const parsed = chatSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "Invalid chat request" }, 400);

  const run = sessions.startRun(parsed.data.conversationId);

  // Kick the loop off without awaiting it: the SSE response below is what drains its events, and
  // the loop will outlive this request whenever it parks on a form or an approval.
  void runTurn(run, parsed.data.text).finally(() => {
    // Give the SSE consumer a moment to flush the terminal frames before dropping the run.
    setTimeout(() => sessions.endRun(run.id), 30_000);
  });

  return streamSSE(c, async (stream) => {
    // Sent before anything else so the client can address resolve calls to this run immediately.
    await stream.writeSSE({ data: JSON.stringify({ type: "run_id", runId: run.id }) });

    stream.onAbort(() => {
      // The browser navigated away or hit stop. Cancel rather than leaving a run parked on a
      // form nobody can answer.
      run.abort();
    });

    for await (const event of run.queue) {
      await stream.write(sseFrame(event));
    }
  });
});

app.post("/api/runs/:runId/resolve", async (c) => {
  const run = sessions.run(c.req.param("runId"));
  if (!run) return c.json({ error: "No such run" }, 404);

  const payload = (await c.req.json().catch(() => null)) as ResolvePayload | null;
  if (!payload) return c.json({ error: "Invalid payload" }, 400);

  const id =
    payload.kind === "approval"
      ? payload.approvalId
      : payload.kind === "form"
        ? payload.formId
        : payload.promptId;

  const value =
    payload.kind === "approval"
      ? { decision: payload.decision, remember: payload.remember }
      : payload.kind === "form"
        ? payload.action === "accept"
          ? { action: "accept", content: payload.content }
          : { action: payload.action }
        : { action: payload.action === "accept" ? "accept" : "cancel" };

  // A false return means nothing was waiting — a double-submit or a stale card. Not an error.
  const matched = run.resolve(id, value);
  return c.json({ ok: matched });
});

app.post("/api/conversations/:id/reset", (c) => {
  sessions.reset(c.req.param("id"));
  return c.json({ ok: true });
});

/* ------------------------------------------------------------------------ voice */

const voiceUnavailable = {
  error: "voice_provider_not_configured",
  message: "Set SARVAM_API_KEY and wire the provider in src/voice/provider.ts to enable voice.",
};

app.post("/api/voice/transcribe", (c) => c.json(voiceUnavailable, 501));
app.post("/api/voice/speak", (c) => c.json(voiceUnavailable, 501));

/* ----------------------------------------------------------------------- errors */

app.onError((err, c) => {
  console.error("Unhandled error:", err);
  return c.json({ error: "Something went wrong on our side." }, 500);
});

console.log(`buyer-agent server listening on :${env.PORT}`);

export default { port: env.PORT, fetch: app.fetch };
