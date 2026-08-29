import { api } from "../lib/api.ts";
import type { ActivityRow, Settings, ToolClass } from "../lib/protocol.ts";

const CLASS_HELP: Record<ToolClass, string> = {
  read: "Tools that only look things up.",
  write: "Tools that change something on a connected service.",
  money: "Tools that spend, order, or subscribe.",
};

export function SettingsPanel({
  settings,
  activity,
  onChanged,
}: {
  settings: Settings | null;
  activity: ActivityRow[];
  onChanged: () => void;
}) {
  if (!settings) return null;

  const capClass =
    "w-24 rounded-md border border-ink-700 bg-ink-950 px-2 py-1 text-right text-sm text-ink-100 " +
    "outline-none focus:border-accent-dim";

  return (
    <div className="space-y-5">
      <section>
        <h3 className="mb-2 text-xs font-semibold tracking-wide text-ink-300 uppercase">
          Approval defaults
        </h3>
        <div className="space-y-2">
          {(Object.keys(CLASS_HELP) as ToolClass[]).map((cls) => (
            <div key={cls}>
              <div className="flex items-center gap-2">
                <span className="text-sm text-ink-100 capitalize">{cls}</span>
                <select
                  value={settings.modes[cls]}
                  onChange={(e) =>
                    api
                      .updateSettings({
                        modes: { ...settings.modes, [cls]: e.target.value } as Settings["modes"],
                      })
                      .then(onChanged)
                  }
                  className="ml-auto rounded border border-ink-800 bg-ink-950 px-1.5 py-0.5 text-xs text-ink-300 outline-none"
                >
                  {/* "money" has no auto option at all. The server refuses it too — this is
                      just the UI telling the same truth. */}
                  {cls !== "money" && <option value="auto">auto-run</option>}
                  <option value="ask">ask first</option>
                  <option value="deny">never</option>
                </select>
              </div>
              <p className="text-[11px] leading-snug text-ink-700">{CLASS_HELP[cls]}</p>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-xs font-semibold tracking-wide text-ink-300 uppercase">
          Spend caps
        </h3>
        <div className="space-y-2">
          <label className="flex items-center gap-2">
            <span className="text-sm text-ink-100">Per transaction</span>
            <input
              type="number"
              min={0}
              defaultValue={settings.perTransactionCap}
              onBlur={(e) =>
                api.updateSettings({ perTransactionCap: Number(e.target.value) }).then(onChanged)
              }
              className={`ml-auto ${capClass}`}
            />
          </label>
          <label className="flex items-center gap-2">
            <span className="text-sm text-ink-100">Per conversation</span>
            <input
              type="number"
              min={0}
              defaultValue={settings.sessionCap}
              onBlur={(e) => api.updateSettings({ sessionCap: Number(e.target.value) }).then(onChanged)}
              className={`ml-auto ${capClass}`}
            />
          </label>
        </div>
        <p className="mt-2 text-[11px] leading-snug text-ink-700">
          Best-effort. The agent reads amounts out of tool arguments, so it cannot see a price a
          service works out on its own. Caps back up the approval prompt; they don't replace it.
          Set 0 to disable.
        </p>
      </section>

      <section>
        <h3 className="mb-2 text-xs font-semibold tracking-wide text-ink-300 uppercase">
          Activity
        </h3>
        {activity.length === 0 ? (
          <p className="text-xs text-ink-700">Nothing yet.</p>
        ) : (
          <div className="space-y-1">
            {activity.slice(0, 40).map((row, i) => (
              <div key={i} className="flex items-baseline gap-2 text-[11px]">
                <span
                  className={row.decision === "allowed" ? "text-good" : "text-caution"}
                  title={row.reason}
                >
                  {row.decision === "allowed" ? "✓" : "✕"}
                </span>
                <span className="truncate font-mono text-ink-300">{row.tool}</span>
                <span className="truncate text-ink-700">{row.connectionLabel}</span>
                <span className="ml-auto shrink-0 text-ink-700">
                  {new Date(row.at).toLocaleTimeString()}
                </span>
              </div>
            ))}
          </div>
        )}
        <p className="mt-2 text-[11px] leading-snug text-ink-700">
          Your own record of what the agent did, written locally — independent of whatever the
          connected services logged.
        </p>
      </section>
    </div>
  );
}
