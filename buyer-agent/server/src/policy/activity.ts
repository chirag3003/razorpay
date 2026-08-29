import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { env } from "../config/env.ts";
import type { ToolClass } from "./classify.ts";

/**
 * The buyer's own record of what its agent did.
 *
 * Append-only, one JSON object per line. This is deliberately the buyer-side mirror of a
 * merchant's audit log: when a purchase happens, two mutually independent parties each hold their
 * own account of it, and neither has to trust the other's.
 */
export type ActivityRow = {
  at: string;
  conversationId: string;
  runId: string;
  connectionId: string;
  connectionLabel: string;
  tool: string;
  toolClass: ToolClass;
  /** Which rule produced the decision — "policy:auto", "user:approved", "cap:per_transaction", … */
  reason: string;
  decision: "allowed" | "blocked";
  outcome?: "success" | "failure";
  amount?: number | null;
  detail?: string;
};

const file = () => join(env.DATA_DIR, "activity.jsonl");

export async function recordActivity(row: ActivityRow): Promise<void> {
  try {
    await mkdir(env.DATA_DIR, { recursive: true });
    await appendFile(file(), `${JSON.stringify(row)}\n`);
  } catch (err) {
    // A failed audit write must never take down the turn the user is watching, but it must not
    // pass silently either.
    console.error("Failed to write activity row:", err);
  }
}

export async function readActivity(limit = 200): Promise<ActivityRow[]> {
  try {
    const text = await readFile(file(), "utf8");
    const lines = text.trim().split("\n").filter(Boolean);
    return lines
      .slice(-limit)
      .map((line) => {
        try {
          return JSON.parse(line) as ActivityRow;
        } catch {
          return null;
        }
      })
      .filter((r): r is ActivityRow => r !== null)
      .reverse();
  } catch {
    return [];
  }
}
