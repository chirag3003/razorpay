import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { env } from "../config/env.ts";
import { McpConnection } from "./mcp.ts";
import { A2AConnection } from "./a2a.ts";
import type {
  ConnectionKind,
  ConnectionRecord,
  ConnectionStatus,
  DiscoveredTool,
  MerchantConnection,
} from "./types.ts";

type Live = {
  record: ConnectionRecord;
  connection: MerchantConnection;
  tools: DiscoveredTool[];
  state: "connected" | "connecting" | "error";
  error?: string;
};

/**
 * Holds every connected merchant and the tools they expose.
 *
 * The important property is that nothing here is commerce-specific. A connection is a URL plus an
 * optional token; what it turns out to offer is whatever it says it offers. Adding the FreshCart
 * backend later is the same operation as adding a public weather server.
 */
class ConnectionRegistry {
  #live = new Map<string, Live>();
  #loaded = false;

  get #file() {
    return join(env.DATA_DIR, "connections.json");
  }

  async load(): Promise<void> {
    if (this.#loaded) return;
    this.#loaded = true;

    const records = await this.#readRecords();
    // Connect in parallel — one unreachable server should not delay the others.
    await Promise.all(records.map((record) => this.#bring(record).catch(() => {})));
  }

  async #readRecords(): Promise<ConnectionRecord[]> {
    try {
      return JSON.parse(await readFile(this.#file, "utf8")) as ConnectionRecord[];
    } catch {
      return [];
    }
  }

  async #persist(): Promise<void> {
    await mkdir(env.DATA_DIR, { recursive: true });
    const records = [...this.#live.values()].map((l) => l.record);
    await writeFile(this.#file, JSON.stringify(records, null, 2));
  }

  async add(input: {
    kind: ConnectionKind;
    label?: string;
    url?: string;
    command?: string;
    args?: string[];
    token?: string;
  }): Promise<ConnectionStatus> {
    const record: ConnectionRecord = {
      id: slugId(input.label || input.url || input.command || input.kind),
      kind: input.kind,
      label: input.label ?? "",
      url: input.url,
      command: input.command,
      args: input.args,
      token: input.token,
      addedAt: new Date().toISOString(),
    };

    const live = await this.#bring(record);
    await this.#persist();
    return toStatus(live);
  }

  async #bring(record: ConnectionRecord): Promise<Live> {
    // Replace any previous instance for this id so a re-add reconnects rather than leaking.
    await this.#live.get(record.id)?.connection.close().catch(() => {});

    const connection: MerchantConnection =
      record.kind === "mcp" ? new McpConnection(record) : new A2AConnection(record);

    const live: Live = { record, connection, tools: [], state: "connecting" };
    this.#live.set(record.id, live);

    try {
      await connection.connect();
      live.tools = await connection.listTools();
      live.state = "connected";
      live.record.label = connection.label;
    } catch (err) {
      live.state = "error";
      live.error = err instanceof Error ? err.message : String(err);
      // Kept in the map deliberately: the user needs to see a failed connection in the UI to fix
      // or remove it, and dropping it silently would look like the add never happened.
    }
    return live;
  }

  async remove(id: string): Promise<void> {
    const live = this.#live.get(id);
    if (!live) return;
    await live.connection.close().catch(() => {});
    this.#live.delete(id);
    await this.#persist();
  }

  async reconnect(id: string): Promise<ConnectionStatus | null> {
    const live = this.#live.get(id);
    if (!live) return null;
    return toStatus(await this.#bring(live.record));
  }

  statuses(): ConnectionStatus[] {
    return [...this.#live.values()].map(toStatus);
  }

  /** Every tool from every connected server, namespaced. This is what the agent loop sees. */
  tools(): DiscoveredTool[] {
    return [...this.#live.values()].filter((l) => l.state === "connected").flatMap((l) => l.tools);
  }

  findTool(qualifiedName: string): DiscoveredTool | undefined {
    return this.tools().find((t) => t.qualifiedName === qualifiedName);
  }

  connection(id: string): MerchantConnection | undefined {
    return this.#live.get(id)?.connection;
  }
}

function toStatus(live: Live): ConnectionStatus {
  return {
    id: live.record.id,
    kind: live.record.kind,
    label: live.connection.label,
    target: live.record.url ?? `${live.record.command} ${(live.record.args ?? []).join(" ")}`.trim(),
    state: live.state,
    error: live.error,
    toolCount: live.tools.length,
  };
}

function slugId(seed: string): string {
  const base =
    seed
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 24) || "conn";
  // Short random suffix keeps two connections to the same host distinguishable.
  return `${base}-${Math.random().toString(36).slice(2, 6)}`;
}

export const registry = new ConnectionRegistry();
