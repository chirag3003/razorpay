import {
  ClientFactory,
  ClientFactoryOptions,
  DefaultAgentCardResolver,
  JsonRpcTransportFactory,
  RestTransportFactory,
  type Client,
} from "@a2a-js/sdk/client";
import { Role, TaskState, type AgentCard, type Message, type Part, type Task } from "@a2a-js/sdk";
import type {
  CallHooks,
  ConnectionRecord,
  DiscoveredTool,
  MerchantConnection,
  ToolOutcome,
} from "./types.ts";
import type { JsonSchema } from "../forms/types.ts";
import { qualify } from "./mcp.ts";

/** Guard against two agents ping-ponging input-required at each other forever. */
const MAX_TURNS_PER_CALL = 8;

/**
 * A generic A2A client.
 *
 * The impedance mismatch worth understanding: MCP exposes *typed tools*, A2A exposes *skills* — a
 * skill has a name, a description and examples, but no input schema, because you talk to an A2A
 * agent in natural language. So each skill becomes a tool taking a single `instruction` string,
 * and the skill's examples go into the tool description so the model knows what kind of sentence
 * to write.
 *
 * The second difference is that an A2A call is a *task*, not a request/response. It can come back
 * `input-required` halfway through, which is A2A's equivalent of MCP elicitation — and it routes
 * to the same form renderer.
 */
export class A2AConnection implements MerchantConnection {
  readonly id: string;
  readonly kind = "a2a" as const;
  #label: string;
  #record: ConnectionRecord;
  #client: Client | null = null;
  #card: AgentCard | null = null;
  /** Kept so successive tool calls land in one conversation rather than starting fresh each time. */
  #contextId = "";

  constructor(record: ConnectionRecord) {
    this.id = record.id;
    this.#record = record;
    this.#label = record.label || record.url || record.id;
  }

  get label() {
    return this.#label;
  }

  async connect(): Promise<void> {
    if (!this.#record.url) throw new Error("An A2A connection needs a url.");

    // The bearer token has to reach both the agent-card fetch and every subsequent transport call,
    // so it is applied at the fetch layer rather than per-request.
    const fetchImpl = this.#authenticatedFetch();

    // Resolve the card ourselves rather than using createFromUrl: the Client interface exposes no
    // card accessor, and we need the card's skills to build the tool list.
    const resolver = new DefaultAgentCardResolver({ fetchImpl });
    this.#card = await resolver.resolve(this.#record.url);

    const factory = new ClientFactory(
      ClientFactoryOptions.createFrom(ClientFactoryOptions.default, {
        transports: [
          new JsonRpcTransportFactory({ fetchImpl }),
          new RestTransportFactory({ fetchImpl }),
        ],
        cardResolver: resolver,
      }),
    );

    this.#client = await factory.createFromAgentCard(this.#card);
    if (this.#card?.name) this.#label = this.#record.label || this.#card.name;
  }

  #authenticatedFetch(): typeof fetch | undefined {
    const token = this.#record.token;
    if (!token) return undefined;
    return ((input, init) => {
      const headers = new Headers(init?.headers);
      headers.set("Authorization", `Bearer ${token}`);
      return fetch(input, { ...init, headers });
    }) as typeof fetch;
  }

  async listTools(): Promise<DiscoveredTool[]> {
    const card = this.#card;
    if (!card) throw new Error(`A2A connection ${this.id} is not connected.`);

    const skills = card.skills ?? [];

    // An agent card with no declared skills is legal. Expose one catch-all tool so the agent is
    // still reachable rather than silently contributing nothing.
    if (skills.length === 0) {
      return [
        this.#toolFor("send_message", card.description || `Send a request to ${this.#label}.`, []),
      ];
    }

    return skills.map((skill) =>
      this.#toolFor(
        skill.id || skill.name,
        skill.description || skill.name,
        skill.examples ?? [],
        skill.name,
      ),
    );
  }

  #toolFor(id: string, description: string, examples: string[], title?: string): DiscoveredTool {
    const exampleText = examples.length
      ? `\n\nExample requests this skill handles:\n${examples.map((e) => `- ${e}`).join("\n")}`
      : "";

    return {
      qualifiedName: qualify(this.id, id),
      name: id,
      connectionId: this.id,
      connectionLabel: this.#label,
      kind: "a2a",
      description:
        `${description}${exampleText}\n\n` +
        `This is an A2A skill on the "${this.#label}" agent. Describe what you want in plain ` +
        `language in the "instruction" field; the remote agent interprets it and may come back ` +
        `asking for more details.`,
      inputSchema: {
        type: "object",
        properties: {
          instruction: {
            type: "string",
            title: title ? `Instruction for ${title}` : "Instruction",
            description:
              "A complete, self-contained natural-language request. Include every detail the " +
              "remote agent needs — it cannot see this conversation.",
          },
        },
        required: ["instruction"],
      },
    };
  }

  async callTool(name: string, args: unknown, hooks: CallHooks): Promise<ToolOutcome> {
    const client = this.#client;
    if (!client) return { ok: false, text: "Not connected.", retryable: true };

    const instruction = extractInstruction(args);
    if (!instruction) {
      return {
        ok: false,
        text: "No instruction was provided for this A2A skill.",
        retryable: false,
      };
    }

    const collected: string[] = [];
    let taskId = "";
    let nextText = instruction;

    try {
      for (let turn = 0; turn < MAX_TURNS_PER_CALL; turn++) {
        const outcome = await this.#runTurn(client, name, nextText, taskId, hooks, collected);

        if (outcome.kind === "done") {
          return { ok: true, text: collected.join("\n").trim() || outcome.note };
        }
        if (outcome.kind === "failed") {
          return { ok: false, text: outcome.note, retryable: outcome.retryable };
        }

        // input_required: we have an answer from the user; send it back into the same task.
        taskId = outcome.taskId;
        nextText = outcome.reply;
      }

      return {
        ok: false,
        text: `The ${this.#label} agent kept asking for more input (${MAX_TURNS_PER_CALL} rounds). Stopped to avoid a loop.`,
        retryable: false,
      };
    } catch (err) {
      return { ok: false, text: err instanceof Error ? err.message : String(err), retryable: true };
    }
  }

  async #runTurn(
    client: Client,
    skillId: string,
    text: string,
    taskId: string,
    hooks: CallHooks,
    collected: string[],
  ): Promise<TurnOutcome> {
    const stream = client.sendMessageStream({
      tenant: "",
      message: this.#message(text, taskId, skillId),
      configuration: undefined,
      metadata: undefined,
    });

    let lastTask: Task | null = null;

    for await (const event of stream) {
      switch (event.payload?.$case) {
        case "message": {
          const body = partsToText(event.payload.value.parts);
          if (body) collected.push(body);
          break;
        }
        case "task": {
          lastTask = event.payload.value;
          if (event.payload.value.contextId) this.#contextId = event.payload.value.contextId;
          break;
        }
        case "statusUpdate": {
          const update = event.payload.value;
          const status = update.status;
          if (!status) break;

          const note = partsToText(status.message?.parts ?? []);

          if (status.state === TaskState.TASK_STATE_INPUT_REQUIRED) {
            const resolved = await this.#handleInputRequired(update.taskId, status.message, hooks);
            if (resolved.kind !== "input_required") return resolved;
            return { ...resolved, taskId: update.taskId || lastTask?.id || taskId };
          }

          if (status.state === TaskState.TASK_STATE_AUTH_REQUIRED) {
            return {
              kind: "failed",
              retryable: false,
              note:
                note ||
                `The ${this.#label} agent requires authentication that this connection does not have. ` +
                  `Ask the user to add a token for it in Connections.`,
            };
          }

          if (
            status.state === TaskState.TASK_STATE_FAILED ||
            status.state === TaskState.TASK_STATE_REJECTED ||
            status.state === TaskState.TASK_STATE_CANCELED
          ) {
            return {
              kind: "failed",
              retryable: false,
              note: note || `The task ended in state ${status.state}.`,
            };
          }

          if (note) {
            if (status.state === TaskState.TASK_STATE_COMPLETED) collected.push(note);
            else hooks.onProgress(note);
          }
          break;
        }
        case "artifactUpdate": {
          const body = partsToText(event.payload.value.artifact?.parts ?? []);
          if (body) collected.push(body);
          break;
        }
      }
    }

    // Some agents complete without a terminal statusUpdate; fall back to the last task snapshot.
    if (lastTask) {
      for (const artifact of lastTask.artifacts ?? []) {
        const body = partsToText(artifact.parts ?? []);
        if (body) collected.push(body);
      }
    }

    return { kind: "done", note: "The task completed." };
  }

  /**
   * `input-required` is A2A's elicitation. When the agent attaches a `data` part containing a JSON
   * Schema we render a real form; otherwise all we have is a question in prose, so we ask it as a
   * single free-text field. Both go through the same renderer.
   */
  async #handleInputRequired(
    taskId: string,
    message: Message | undefined,
    hooks: CallHooks,
  ): Promise<TurnOutcome> {
    const prose = partsToText(message?.parts ?? []) || "The agent needs more information.";
    const schema = findSchemaPart(message?.parts ?? []);

    const response = await hooks.requestForm({
      source: "a2a_input_required",
      connectionId: this.id,
      connectionLabel: this.#label,
      title: `${this.#label} needs more information`,
      description: prose,
      schema: schema ?? {
        type: "object",
        properties: { answer: { type: "string", title: "Your answer", description: prose } },
        required: ["answer"],
      },
      allowDecline: true,
    });

    if (response.action !== "accept") {
      return {
        kind: "failed",
        retryable: false,
        note: `The user ${response.action === "decline" ? "declined" : "dismissed"} the request for more information, so the task was not completed.`,
      };
    }

    // Free-text answers go back as prose; structured answers go back as JSON the agent can parse.
    const content = response.content;
    const reply =
      schema === null && typeof content.answer === "string"
        ? content.answer
        : JSON.stringify(content);

    return { kind: "input_required", taskId, reply };
  }

  #message(text: string, taskId: string, skillId: string): Message {
    return {
      messageId: crypto.randomUUID(),
      contextId: this.#contextId,
      taskId,
      role: Role.ROLE_USER,
      parts: [{ content: { $case: "text", value: text } } as Part],
      metadata: { skillId },
      extensions: [],
      referenceTaskIds: [],
    };
  }

  async close(): Promise<void> {
    this.#client = null;
    this.#card = null;
  }
}

type TurnOutcome =
  | { kind: "done"; note: string }
  | { kind: "failed"; note: string; retryable: boolean }
  | { kind: "input_required"; taskId: string; reply: string };

function extractInstruction(args: unknown): string {
  if (typeof args === "string") return args;
  if (!args || typeof args !== "object") return "";
  const record = args as Record<string, unknown>;
  if (typeof record.instruction === "string") return record.instruction;
  // A model occasionally invents its own field name. Falling back to a serialisation beats
  // failing the call outright.
  const values = Object.values(record).filter((v) => typeof v === "string") as string[];
  return values[0] ?? JSON.stringify(record);
}

export function partsToText(parts: Part[]): string {
  const out: string[] = [];
  for (const part of parts) {
    switch (part.content?.$case) {
      case "text":
        out.push(part.content.value);
        break;
      case "data":
        out.push(JSON.stringify(part.content.value));
        break;
      case "url":
        out.push(`[file] ${part.content.value}`);
        break;
      case "raw":
        out.push("[binary content omitted]");
        break;
    }
  }
  return out.join("\n").trim();
}

/**
 * Look for a JSON Schema hiding in a `data` part.
 *
 * There is no single blessed convention for this in A2A yet, so accept the two shapes that appear
 * in practice: a wrapper `{ schema: {...} }`, or a bare object schema. Anything else is treated as
 * ordinary data and the caller falls back to a free-text prompt.
 */
export function findSchemaPart(parts: Part[]): JsonSchema | null {
  for (const part of parts) {
    if (part.content?.$case !== "data") continue;
    const value = part.content.value;
    if (!value || typeof value !== "object") continue;

    const wrapper = value as Record<string, unknown>;
    const candidate =
      wrapper.schema && typeof wrapper.schema === "object"
        ? (wrapper.schema as JsonSchema)
        : (value as JsonSchema);

    if (candidate.type === "object" && candidate.properties) return candidate;
  }
  return null;
}
