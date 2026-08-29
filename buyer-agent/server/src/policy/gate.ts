import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { env } from "../config/env.ts";
import type { DiscoveredTool } from "../connections/types.ts";
import { classifyCall, detectAmount, type ToolClass } from "./classify.ts";

export type PolicyMode = "auto" | "ask" | "deny";

export type Settings = {
  /** Default handling per class. `money` cannot be set to `auto` — see sanitiseSettings. */
  modes: Record<ToolClass, PolicyMode>;
  /** Per-tool overrides, keyed by qualified name. */
  overrides: Record<string, { mode?: PolicyMode; toolClass?: ToolClass }>;
  /** Largest single detected amount the agent will proceed with. 0 disables the check. */
  perTransactionCap: number;
  /** Total detected spend allowed across one conversation. 0 disables the check. */
  sessionCap: number;
  /** Purely cosmetic — the agent has no way to know a server's real currency. */
  currencySymbol: string;
};

const DEFAULTS: Settings = {
  modes: { read: "auto", write: "ask", money: "ask" },
  overrides: {},
  perTransactionCap: 5000,
  sessionCap: 15000,
  currencySymbol: "₹",
};

export type GateVerdict =
  | { decision: "allow"; reason: string; toolClass: ToolClass; amount: number | null }
  | { decision: "ask"; reason: string; toolClass: ToolClass; amount: number | null }
  | {
      decision: "block";
      reason: string;
      toolClass: ToolClass;
      amount: number | null;
      /** Present when the block was a cap breach rather than a deny rule. */
      capBreach?: { kind: "per_transaction" | "session"; limit: number; wouldBe: number };
    };

class PolicyStore {
  #settings: Settings = DEFAULTS;
  #loaded = false;

  get #file() {
    return join(env.DATA_DIR, "policy.json");
  }

  async load(): Promise<void> {
    if (this.#loaded) return;
    this.#loaded = true;
    try {
      const raw = JSON.parse(await readFile(this.#file, "utf8")) as Partial<Settings>;
      this.#settings = sanitiseSettings({ ...DEFAULTS, ...raw });
    } catch {
      this.#settings = DEFAULTS;
    }
  }

  get settings(): Settings {
    return this.#settings;
  }

  async update(patch: Partial<Settings>): Promise<Settings> {
    this.#settings = sanitiseSettings({ ...this.#settings, ...patch });
    await mkdir(env.DATA_DIR, { recursive: true });
    await writeFile(this.#file, JSON.stringify(this.#settings, null, 2));
    return this.#settings;
  }

  async setOverride(qualifiedName: string, override: { mode?: PolicyMode; toolClass?: ToolClass }) {
    return this.update({
      overrides: { ...this.#settings.overrides, [qualifiedName]: override },
    });
  }

  /**
   * Decide what happens to one call.
   *
   * Order matters and mirrors the merchant-side verification chain: identity of the action first
   * (what class is it), then authority (does policy permit it), then funds (does it fit the cap).
   * Checking the cap first would tell a user their budget is fine for an action they were never
   * allowed to take.
   */
  evaluate(tool: DiscoveredTool, args: unknown, spentThisSession: number): GateVerdict {
    const override = this.#settings.overrides[tool.qualifiedName];
    const toolClass = classifyCall(tool, args, override?.toolClass);
    const amount = detectAmount(args);

    const mode: PolicyMode = override?.mode ?? this.#settings.modes[toolClass];

    if (mode === "deny") {
      return {
        decision: "block",
        reason: override?.mode ? "user:denied-tool" : `policy:deny-${toolClass}`,
        toolClass,
        amount,
      };
    }

    if (amount !== null) {
      const { perTransactionCap, sessionCap } = this.#settings;
      if (perTransactionCap > 0 && amount > perTransactionCap) {
        return {
          decision: "block",
          reason: "cap:per_transaction",
          toolClass,
          amount,
          capBreach: { kind: "per_transaction", limit: perTransactionCap, wouldBe: amount },
        };
      }
      if (sessionCap > 0 && spentThisSession + amount > sessionCap) {
        return {
          decision: "block",
          reason: "cap:session",
          toolClass,
          amount,
          capBreach: {
            kind: "session",
            limit: sessionCap,
            wouldBe: spentThisSession + amount,
          },
        };
      }
    }

    if (mode === "auto") {
      return { decision: "allow", reason: `policy:auto-${toolClass}`, toolClass, amount };
    }
    return { decision: "ask", reason: `policy:ask-${toolClass}`, toolClass, amount };
  }
}

/**
 * `money` may never be set to `auto`.
 *
 * This is the one setting the user is not allowed to turn off. An agent that can spend without
 * asking is the exact failure mode the whole approval design exists to prevent, and a checkbox
 * that disables it would make every other guarantee here decorative.
 */
function sanitiseSettings(s: Settings): Settings {
  return {
    ...s,
    modes: { ...s.modes, money: s.modes.money === "auto" ? "ask" : s.modes.money },
    perTransactionCap: Math.max(0, Number(s.perTransactionCap) || 0),
    sessionCap: Math.max(0, Number(s.sessionCap) || 0),
  };
}

export const policy = new PolicyStore();
