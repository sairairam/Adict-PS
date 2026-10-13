"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatMoney, parseMoney } from "@/lib/money";
import { validateField, type ValidationStatus } from "@/lib/schemas/validation";
import { CostBadge } from "./CostBadge";
import { RevealTokens } from "./RevealToken";

export type FieldRow = {
  id: string;
  key: string;
  label: string;
  type: string;
  is_cost: boolean;
  page_no: number | null;
  value: string | null;
  confidence: number | null;
  version: number;
  validation_status: ValidationStatus;
  validation_errors: string[] | null;
  options: string[];
};

type SaveState = "idle" | "saving" | "saved" | "error" | "conflict";
const DEBOUNCE_MS = 800;

export function ExtractionForm({ documentId, initial, locked }: { documentId: string; initial: FieldRow[]; locked: boolean }) {
  const router = useRouter();
  const [values, setValues] = useState(() => Object.fromEntries(initial.map((f) => [f.id, f.value ?? ""])));
  const [serverErrors, setServerErrors] = useState<Record<string, string[]>>({});
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [submitMessage, setSubmitMessage] = useState<string | null>(null);

  const versions = useRef(Object.fromEntries(initial.map((f) => [f.id, f.version])));
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const dirty = useRef(new Set<string>());
  const inFlight = useRef(0);
  const valuesRef = useRef(values);
  useEffect(() => {
    valuesRef.current = values;
  }, [values]);

  const save = useCallback(
    async (fieldId: string) => {
      if (!dirty.current.has(fieldId)) return;
      dirty.current.delete(fieldId);
      inFlight.current++;
      setSaveState("saving");
      try {
        const res = await fetch(`/api/documents/${documentId}/fields/${fieldId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ value: valuesRef.current[fieldId] || null, version: versions.current[fieldId] }),
        });
        const body = await res.json();
        if (res.status === 409) {
          // Someone else changed it: take the server's version, keep the user informed.
          versions.current[fieldId] = body.current.version;
          setValues((v) => ({ ...v, [fieldId]: body.current.value ?? "" }));
          setSaveState("conflict");
          return;
        }
        if (!res.ok) throw new Error(body.error ?? "Save failed");
        versions.current[fieldId] = body.field.version;
        setServerErrors((e) => ({ ...e, [fieldId]: body.field.validation_errors ?? [] }));
        // The server tokenises PII; show what was actually stored (unless the user typed again since).
        if (!dirty.current.has(fieldId)) setValues((v) => ({ ...v, [fieldId]: body.field.value ?? "" }));
        setSaveState((s) => (s === "conflict" ? s : "saved"));
      } catch {
        dirty.current.add(fieldId);
        setSaveState("error");
      } finally {
        inFlight.current--;
      }
    },
    [documentId],
  );

  const flushAll = useCallback(() => {
    for (const id of [...dirty.current]) {
      clearTimeout(timers.current[id]);
      void save(id);
    }
  }, [save]);

  // Save on tab hide / page close, and on unmount.
  useEffect(() => {
    const onHide = () => document.visibilityState === "hidden" && flushAll();
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", flushAll);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", flushAll);
      flushAll();
    };
  }, [flushAll]);

  function change(fieldId: string, value: string) {
    setValues((v) => ({ ...v, [fieldId]: value }));
    dirty.current.add(fieldId);
    setSaveState("saving");
    clearTimeout(timers.current[fieldId]);
    timers.current[fieldId] = setTimeout(() => save(fieldId), DEBOUNCE_MS);
  }

  function blur(fieldId: string) {
    clearTimeout(timers.current[fieldId]);
    void save(fieldId);
  }

  // Client-side validation for instant feedback; the server result is authoritative.
  const results = useMemo(
    () =>
      Object.fromEntries(
        initial.map((f) => {
          const r = validateField({ type: f.type, value: values[f.id], options: f.options });
          return [f.id, { status: r.status, errors: r.errors.length ? r.errors : (serverErrors[f.id] ?? []) }];
        }),
      ),
    [initial, values, serverErrors],
  );
  const invalidCount = Object.values(results).filter((r) => r.status === "invalid").length;

  const costFields = initial.filter((f) => f.is_cost);
  const totalMinor = costFields.reduce((sum, f) => sum + (parseMoney(values[f.id])?.amountMinor ?? 0), 0);
  const currency = parseMoney(values[costFields[0]?.id])?.currency ?? "USD";

  async function submit() {
    flushAll();
    setSubmitMessage(null);
    // Let in-flight saves settle so the server validates the latest values.
    while (inFlight.current > 0 || dirty.current.size > 0) await new Promise((r) => setTimeout(r, 100));
    const res = await fetch(`/api/documents/${documentId}/submit`, { method: "POST" });
    const body = await res.json();
    if (res.ok) return router.refresh();
    setSubmitMessage(
      res.status === 422
        ? `Fix ${body.invalid.length} invalid field(s): ${body.invalid.map((i: { label: string }) => i.label).join(", ")}`
        : (body.error ?? "Submit failed"),
    );
  }

  return (
    <div>
      <div className="sticky top-0 z-10 -mx-4 mb-4 flex flex-wrap items-center justify-between gap-3 border-b bg-white/95 px-4 py-3 backdrop-blur">
        <div className="flex items-center gap-4">
          <span className="text-sm font-medium">Total cost</span>
          <span className="rounded border border-amber-700 bg-amber-50 px-2 py-0.5 font-bold text-amber-900 tabular-nums">
            {formatMoney({ amountMinor: totalMinor, currency })}
          </span>
        </div>
        <div className="flex items-center gap-4">
          <SaveIndicator state={saveState} />
          {!locked && (
            <button
              onClick={submit}
              disabled={invalidCount > 0 || saveState === "saving"}
              className="rounded bg-black px-4 py-1.5 text-sm text-white disabled:opacity-40"
              title={invalidCount ? `${invalidCount} invalid field(s)` : undefined}
            >
              Submit
            </button>
          )}
          {locked && <span className="rounded bg-green-100 px-2 py-1 text-sm text-green-900">Submitted (locked)</span>}
        </div>
      </div>
      {submitMessage && <p role="alert" className="mb-3 text-sm text-red-700">{submitMessage}</p>}
      {saveState === "conflict" && (
        <p role="alert" className="mb-3 text-sm text-amber-800">
          A field was changed elsewhere. It has been refreshed to the latest saved value.
        </p>
      )}

      <ul className="space-y-4">
        {initial.map((f) => {
          const r = results[f.id];
          const lowConfidence = f.confidence !== null && f.confidence < 0.7;
          return (
            <li key={f.id}>
              <label htmlFor={f.id} className="flex items-center justify-between gap-2 text-sm font-medium">
                <span>{f.label}</span>
                <span className="flex items-center gap-2">
                  {lowConfidence && <span className="rounded bg-yellow-100 px-1.5 text-xs text-yellow-900">Check this</span>}
                  {f.is_cost && <CostBadge value={values[f.id]} label={f.label} />}
                </span>
              </label>
              <FieldInput
                id={f.id}
                field={f}
                value={values[f.id]}
                disabled={locked}
                invalid={r.status === "invalid"}
                onChange={(v) => change(f.id, v)}
                onBlur={() => blur(f.id)}
              />
              {r.errors.map((e) => (
                <p key={e} id={`${f.id}-err`} role="alert" className="mt-1 text-xs text-red-700">
                  ⚠ {e}
                </p>
              ))}
              <RevealTokens value={values[f.id]} />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function FieldInput(props: {
  id: string;
  field: FieldRow;
  value: string;
  disabled: boolean;
  invalid: boolean;
  onChange: (v: string) => void;
  onBlur: () => void;
}) {
  const { id, field, value, disabled, invalid, onChange, onBlur } = props;
  const cls = `mt-1 w-full rounded border p-2 text-sm ${invalid ? "border-red-700" : "border-gray-300"}`;
  const common = { id, disabled, onBlur, "aria-invalid": invalid, "aria-describedby": invalid ? `${id}-err` : undefined };

  if (field.type === "checkbox") {
    return (
      <label className="mt-1 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={value === "checked"}
          {...common}
          onChange={(e) => onChange(e.target.checked ? "checked" : "unchecked")}
        />
        {value === "checked" ? "Checked" : "Unchecked"}
      </label>
    );
  }
  if (field.type === "select" && field.options.length) {
    return (
      <select {...common} value={value} className={cls} onChange={(e) => onChange(e.target.value)}>
        <option value="">Select...</option>
        {[...new Set([...field.options, ...(value && !field.options.includes(value) ? [value] : [])])].map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    );
  }
  return <input {...common} type="text" value={value} className={cls} onChange={(e) => onChange(e.target.value)} />;
}

function SaveIndicator({ state }: { state: SaveState }) {
  const text = { idle: "", saving: "Saving...", saved: "✓ Saved", error: "⚠ Not saved, retrying on next edit", conflict: "⚠ Refreshed" }[state];
  return <span aria-live="polite" className={`text-sm ${state === "error" ? "text-red-700" : "text-gray-600"}`}>{text}</span>;
}
