# Buyer Agent

A buyer-side AI assistant that can drive **any** MCP server or A2A agent you point it at.

It is deliberately not built around any particular merchant. It has no product model, no cart, no
checkout flow, and no knowledge of this repo's storefront. It connects to a URL, asks what tools
are there, and reasons about them. Connecting the project's own merchant later is the same three
fields as connecting a public weather server — that is the point.

This is deliverable #4 from the root `claude.md`, and it satisfies Hard Rule #3: nothing here
imports from `/backend` or `/web`.

---

## What it does

| | |
|---|---|
| **Discovers** | MCP `tools/list` (paginated) and A2A Agent Card skills, namespaced per connection |
| **Chats** | Streaming responses with visible reasoning and live tool-call status |
| **Renders forms** | One JSON-Schema renderer serving three input sources (see below) |
| **Gates actions** | Classifies every call read / write / money, and asks before it matters |
| **Caps spend** | Per-transaction and per-conversation limits, enforced before the call |
| **Logs** | Append-only local record of every decision, independent of any merchant's audit trail |

### The three form sources

The feature worth understanding. Structured input can be demanded by three completely unrelated
parties, and all three land in the same renderer:

1. **An MCP server** sends `elicitation/create` with a `requestedSchema` mid-tool-call.
2. **An A2A agent** moves a task to `input-required` with a schema in a `data` part.
3. **The agent itself** calls its built-in `request_user_input` tool when it needs something
   specific — a budget, an address, a confirmation — instead of guessing.

The renderer never learns which one asked. That is exactly why the agent can work against a server
nobody wrote a UI for.

---

## Setup

```bash
cd buyer-agent
bun install

cp server/.env.example server/.env
# Set ANTHROPIC_API_KEY — the agent loop cannot run without it.

bun run dev        # server on :4100, UI on :5173
```

Open http://localhost:5173.

---

## Try it against real third-party servers

Nothing below is ours. That is the demonstration.

**MCP (stdio).** In the Connections panel choose `MCP` → `stdio` and paste:

```
npx -y @modelcontextprotocol/server-everything stdio
```

15 tools appear. Ask the agent to *"trigger an elicitation request"* — the server asks **you** for
a dozen typed fields (string with email format, integer in a range, single- and multi-select
enums) and the form renders itself from the schema.

**Agent-authored forms.** Ask for something underspecified — *"order me something for dinner"* —
and the agent calls `request_user_input` to build its own form rather than guessing.

**A2A.** Run any agent from [`a2aproject/a2a-samples`](https://github.com/a2aproject/a2a-samples)
(usually `localhost:41241`), choose `A2A`, and paste its base URL. Its Agent Card skills become
tools.

**The approval gate.** A `readOnlyHint: true` tool runs on its own. A write tool raises a card
showing the **raw arguments**, not a paraphrase. Anything money-shaped always asks, and cannot be
set to auto-run — not in the UI, and not by hand-editing `data/policy.json`, because the server
re-sanitises it on load.

---

## Connecting this repo's merchant

Once `/backend` exposes its A2A server or MCP adapter, add it like any other connection:

- **Kind:** MCP (HTTP) or A2A
- **URL:** wherever the backend mounts it
- **Token:** a user JWT from `POST /api/auth/login` (there is no agent-token system yet)

No buyer-agent code changes. Expect `place_order` to fail with `payment_gateway_unavailable`
until Razorpay entitles the S2S JSON API on the test account — the agent surfaces that as an
explained failure rather than a crash, which is worth showing rather than hiding.

---

## Architecture

```
server/                        Bun + Hono
  connections/types.ts         MerchantConnection — the one abstraction
  connections/mcp.ts           MCP client + elicitation → form
  connections/a2a.ts           A2A client + task lifecycle → form
  connections/registry.ts      add / discover / persist / reconnect
  agent/loop.ts                streaming Claude loop, suspends for humans
  agent/builtins.ts            request_user_input, list_connections
  policy/classify.ts           read | write | money
  policy/gate.ts               approval + spend cap
  policy/activity.ts           append-only JSONL log
  session/store.ts             conversations and parked runs
ui/                            Vite + React + Tailwind
  forms/SchemaForm.tsx         the single renderer
  approvals/ApprovalCard.tsx   the consent gate
```

**Why a manual agent loop rather than the SDK tool runner:** a turn has to *suspend* — mid-loop,
across HTTP requests — while a human answers a form or an approval. A run is held server-side and
parks on a promise; the browser resolves it with a separate POST. The SSE stream is just a view
onto that run, so closing the tab cancels it rather than orphaning it.

**Money handling.** The gate reads amounts out of tool arguments with a shallow, conservative
scan. It cannot know a service's currency, and it cannot see a price the service computes
internally. The cap is a second line of defence behind human confirmation, never a substitute for
it — the UI says so too, rather than implying a guarantee the design cannot make.

---

## Voice — prepared, not built

Deliberately last. The seam is fixed so the implementation is a drop-in:

- `server/src/voice/provider.ts` — the `VoiceProvider` interface and a null provider.
- `POST /api/voice/transcribe` and `/api/voice/speak` answer **501** until `SARVAM_API_KEY` is set.
- `ui/src/voice/useVoice.ts` — the mic button reads availability from `/api/health`, so it stays
  hidden rather than appearing broken.
- `server/src/voice/sarvam.ts` documents the verified Sarvam call shapes (`saarika:v2.5` with
  `language_code: "unknown"` for auto-detect, `bulbul:v3` for TTS).

**The gotcha to plan around:** Chrome's `MediaRecorder` emits webm/opus; Sarvam's transcribe takes
mp3/wav at 16 kHz. Capture through an `AudioWorklet` and encode 16 kHz mono WAV client-side.
Handing it a default-options webm blob will fail.
