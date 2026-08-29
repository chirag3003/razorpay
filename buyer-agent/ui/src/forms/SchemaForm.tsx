import { useMemo, useState } from "react";
import type { JsonSchema } from "../lib/protocol.ts";

/**
 * Renders a form from a JSON Schema.
 *
 * The only renderer in the app, shared by all three input sources — an MCP server's
 * `elicitation/create`, an A2A task hitting `input-required`, and the agent's own
 * `request_user_input`. It never learns which one asked, which is exactly why the agent can work
 * against a server nobody wrote a UI for.
 *
 * The supported subset is driven by what MCP elicitation actually permits (flat objects of
 * primitives, single/multi-select enums), with defaults and ranges honoured. Anything it does not
 * recognise degrades to a text input rather than throwing — an unfamiliar server must still get a
 * usable form.
 */
export type FieldError = string | null;

export function SchemaForm({
  schema,
  submitLabel = "Continue",
  secondaryLabel,
  onSubmit,
  onSecondary,
  disabled,
}: {
  schema: JsonSchema;
  submitLabel?: string;
  secondaryLabel?: string;
  onSubmit: (value: Record<string, unknown>) => void;
  onSecondary?: () => void;
  disabled?: boolean;
}) {
  const fields = useMemo(() => Object.entries(schema.properties ?? {}), [schema]);
  const required = useMemo(() => new Set(schema.required ?? []), [schema]);

  const [values, setValues] = useState<Record<string, unknown>>(() => initialValues(schema));
  const [errors, setErrors] = useState<Record<string, FieldError>>({});
  const [touched, setTouched] = useState(false);

  function set(key: string, value: unknown) {
    setValues((prev) => ({ ...prev, [key]: value }));
    if (touched) setErrors((prev) => ({ ...prev, [key]: null }));
  }

  function submit() {
    const found: Record<string, FieldError> = {};
    for (const [key, prop] of fields) {
      found[key] = validate(prop, values[key], required.has(key));
    }
    setTouched(true);
    setErrors(found);
    if (Object.values(found).some(Boolean)) return;

    // Drop empty optionals so a server does not receive `""` where it expected absence.
    const cleaned: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(values)) {
      if (value === "" || value === undefined) continue;
      if (Array.isArray(value) && value.length === 0) continue;
      cleaned[key] = value;
    }
    onSubmit(cleaned);
  }

  return (
    <div className="space-y-3.5">
      {fields.length === 0 && (
        <p className="text-sm text-ink-500">This form has no fields to fill in.</p>
      )}

      {fields.map(([key, prop]) => (
        <Field
          key={key}
          name={key}
          schema={prop}
          required={required.has(key)}
          value={values[key]}
          error={errors[key] ?? null}
          disabled={disabled}
          onChange={(v) => set(key, v)}
        />
      ))}

      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          onClick={submit}
          disabled={disabled}
          className="rounded-md bg-accent px-3.5 py-1.5 text-sm font-medium text-ink-950 transition hover:brightness-110 disabled:opacity-40"
        >
          {submitLabel}
        </button>
        {secondaryLabel && onSecondary && (
          <button
            type="button"
            onClick={onSecondary}
            disabled={disabled}
            className="rounded-md border border-ink-700 px-3 py-1.5 text-sm text-ink-300 transition hover:bg-ink-800 disabled:opacity-40"
          >
            {secondaryLabel}
          </button>
        )}
      </div>
    </div>
  );
}

function Field({
  name,
  schema,
  required,
  value,
  error,
  disabled,
  onChange,
}: {
  name: string;
  schema: JsonSchema;
  required: boolean;
  value: unknown;
  error: FieldError;
  disabled?: boolean;
  onChange: (value: unknown) => void;
}) {
  const label = schema.title ?? humanise(name);
  const inputClass =
    "w-full rounded-md border bg-ink-950 px-2.5 py-1.5 text-sm text-ink-100 outline-none transition " +
    "placeholder:text-ink-700 focus:border-accent-dim " +
    (error ? "border-danger" : "border-ink-700");

  return (
    <label className="block">
      <span className="mb-1 flex items-baseline gap-1.5 text-xs font-medium tracking-wide text-ink-300 uppercase">
        {label}
        {required && <span className="text-danger normal-case">required</span>}
      </span>
      {schema.description && (
        <span className="mb-1.5 block text-xs leading-snug text-ink-500">{schema.description}</span>
      )}

      {renderControl(schema, value, onChange, inputClass, disabled)}

      {error && <span className="mt-1 block text-xs text-danger">{error}</span>}
    </label>
  );
}

function renderControl(
  schema: JsonSchema,
  value: unknown,
  onChange: (value: unknown) => void,
  inputClass: string,
  disabled?: boolean,
) {
  // Multi-select: an array whose items carry an enum.
  if (schema.type === "array" && Array.isArray(schema.items?.enum)) {
    const selected = Array.isArray(value) ? (value as string[]) : [];
    const options = schema.items.enum as string[];
    const names = schema.items.enumNames;
    return (
      <div className="flex flex-wrap gap-1.5">
        {options.map((option, i) => {
          const on = selected.includes(option);
          return (
            <button
              key={option}
              type="button"
              disabled={disabled}
              onClick={() =>
                onChange(on ? selected.filter((s) => s !== option) : [...selected, option])
              }
              className={
                "rounded-full border px-2.5 py-1 text-xs transition disabled:opacity-40 " +
                (on
                  ? "border-accent bg-accent/15 text-ink-100"
                  : "border-ink-700 text-ink-300 hover:bg-ink-800")
              }
            >
              {names?.[i] ?? option}
            </button>
          );
        })}
      </div>
    );
  }

  // Single select.
  if (Array.isArray(schema.enum)) {
    const options = schema.enum as unknown[];
    return (
      <select
        className={inputClass}
        value={String(value ?? "")}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Select…</option>
        {options.map((option, i) => (
          <option key={String(option)} value={String(option)}>
            {schema.enumNames?.[i] ?? String(option)}
          </option>
        ))}
      </select>
    );
  }

  if (schema.type === "boolean") {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange(!value)}
        className={
          "flex h-6 w-11 items-center rounded-full border px-0.5 transition disabled:opacity-40 " +
          (value ? "border-accent bg-accent/30" : "border-ink-700 bg-ink-900")
        }
      >
        <span
          className={
            "h-4.5 w-4.5 rounded-full bg-ink-100 transition " + (value ? "translate-x-5" : "")
          }
        />
      </button>
    );
  }

  if (schema.type === "number" || schema.type === "integer") {
    return (
      <input
        type="number"
        className={inputClass}
        value={value === undefined || value === null ? "" : String(value)}
        min={schema.minimum}
        max={schema.maximum}
        step={schema.type === "integer" ? 1 : "any"}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
      />
    );
  }

  // Long free text gets room to breathe rather than a single cramped line.
  if ((schema.maxLength ?? 0) > 140) {
    return (
      <textarea
        className={inputClass}
        rows={3}
        value={String(value ?? "")}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }

  return (
    <input
      type={htmlInputType(schema.format)}
      className={inputClass}
      value={String(value ?? "")}
      maxLength={schema.maxLength}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function htmlInputType(format?: string): string {
  switch (format) {
    case "email":
      return "email";
    case "uri":
    case "url":
      return "url";
    case "date":
      return "date";
    case "date-time":
      return "datetime-local";
    default:
      return "text";
  }
}

function initialValues(schema: JsonSchema): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, prop] of Object.entries(schema.properties ?? {})) {
    if (prop.default !== undefined) out[key] = prop.default;
    else if (prop.type === "boolean") out[key] = false;
    else if (prop.type === "array") out[key] = [];
    else out[key] = "";
  }
  return out;
}

function validate(schema: JsonSchema, value: unknown, required: boolean): FieldError {
  const empty =
    value === undefined ||
    value === null ||
    value === "" ||
    (Array.isArray(value) && value.length === 0);

  if (required && empty && schema.type !== "boolean") return "This field is required.";
  if (empty) return null;

  if (schema.type === "number" || schema.type === "integer") {
    const n = Number(value);
    if (!Number.isFinite(n)) return "Enter a number.";
    if (schema.type === "integer" && !Number.isInteger(n)) return "Enter a whole number.";
    if (schema.minimum !== undefined && n < schema.minimum) return `Must be at least ${schema.minimum}.`;
    if (schema.maximum !== undefined && n > schema.maximum) return `Must be at most ${schema.maximum}.`;
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      return `Choose at least ${schema.minItems}.`;
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      return `Choose at most ${schema.maxItems}.`;
    }
  }

  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      return `Must be at least ${schema.minLength} characters.`;
    }
    if (schema.format === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      return "Enter a valid email address.";
    }
    if ((schema.format === "uri" || schema.format === "url") && !/^https?:\/\/.+/.test(value)) {
      return "Enter a valid URL starting with http:// or https://";
    }
  }

  return null;
}

function humanise(name: string): string {
  return name
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase());
}
