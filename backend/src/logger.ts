import { env } from "./config/env";

// The one logging module for the whole backend. Zero dependencies beyond config/env, so it is
// import-safe from anywhere — including mandateService/reservePayService/paymentService, which
// is the same leaf-module status /schemas and /errors already have (see CLAUDE.md).
//
// One line per event, aligned columns, a timestamp always: `HH:MM:SS.mmm LEVEL scope message
// key=value ...`. info is silenced by DEBUG_LOGS=false; warn/error always print, on the
// principle that a quiet run should still tell you when something actually broke.
//
// Deliberately not a "real" logging library: no transports, no file output, no log levels beyond
// info/warn/error. Console only, matching the project's stated aversion to bringing in a
// framework where a small amount of direct code already does the job (see CLAUDE.md's rationale
// against an LLM framework — the same argument applies here).

type Level = "INFO" | "WARN" | "ERROR";

const LEVEL_WIDTH = 5; // "ERROR" is the longest
const SCOPE_WIDTH = 5; // "oauth", "boot" + padding — widen here if a longer scope is added

// Matches hono's own convention in this codebase (utils/color.js): color unless NO_COLOR is set.
// No isTTY check — hono doesn't do one either, and matching it means log lines look consistent
// whether they came from the request logger below or from hono's own middleware elsewhere.
const COLOR = !("NO_COLOR" in process.env);

const LEVEL_COLOR: Record<Level, string> = {
  INFO: "\x1b[36m", // cyan
  WARN: "\x1b[33m", // yellow
  ERROR: "\x1b[31m", // red
};
const RESET = "\x1b[0m";

function timestamp(): string {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  const ms = String(now.getMilliseconds()).padStart(3, "0");
  return `${hh}:${mm}:${ss}.${ms}`;
}

/** Compact, one line: an object becomes single-line JSON, never pretty-printed. */
function formatValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function formatFields(fields?: Record<string, unknown>): string {
  if (!fields) return "";
  const parts = Object.entries(fields)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${formatValue(v)}`);
  return parts.length > 0 ? "  " + parts.join(" ") : "";
}

function write(level: Level, scope: string, message: string, fields?: Record<string, unknown>) {
  const levelTag = level.padEnd(LEVEL_WIDTH);
  const scopeTag = scope.padEnd(SCOPE_WIDTH);
  const coloredLevel = COLOR ? `${LEVEL_COLOR[level]}${levelTag}${RESET}` : levelTag;
  const line = `${timestamp()} ${coloredLevel} ${scopeTag} ${message}${formatFields(fields)}`;

  if (level === "ERROR") console.error(line);
  else if (level === "WARN") console.warn(line);
  else console.log(line);
}

/**
 * A DomainError or a plain Error renders as its message — never a raw stack dump, which is the
 * noise this module exists to replace. DEBUG_LOGS=true additionally appends the top stack frame
 * (file:line) so a genuine bug is still locatable; false omits it for a quieter run.
 */
function formatError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);

  if (!env.DEBUG_LOGS) return err.message;

  const topFrame = err.stack?.split("\n")[1]?.trim().replace(/^at /, "");
  return topFrame ? `${err.message}  (${topFrame})` : err.message;
}

export const logger = {
  info(scope: string, message: string, fields?: Record<string, unknown>) {
    if (!env.DEBUG_LOGS) return;
    write("INFO", scope, message, fields);
  },

  warn(scope: string, message: string, fields?: Record<string, unknown>) {
    write("WARN", scope, message, fields);
  },

  error(scope: string, message: string, err?: unknown, fields?: Record<string, unknown>) {
    const detail = err !== undefined ? formatError(err) : undefined;
    write("ERROR", scope, detail ? `${message}: ${detail}` : message, fields);
  },
};
