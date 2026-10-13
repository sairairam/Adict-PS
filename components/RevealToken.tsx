"use client";

import { useState } from "react";
import { PII_TOKEN_RE } from "@/lib/schemas/validation";

/** Shows a "Reveal" button for each PII token in `value`. Every reveal is audited server-side. */
export function RevealTokens({ value }: { value: string | null }) {
  const tokens = value ? [...new Set(value.match(PII_TOKEN_RE) ?? [])] : [];
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  if (!tokens.length) return null;

  async function reveal(token: string) {
    setError(null);
    const res = await fetch("/api/pii/reveal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const body = await res.json();
    if (!res.ok) return setError(res.status === 403 ? "You are not allowed to reveal this" : (body.error ?? "Failed"));
    setRevealed((r) => ({ ...r, [token]: body.value }));
    // Hide again after 15 seconds.
    setTimeout(() => setRevealed((r) => Object.fromEntries(Object.entries(r).filter(([k]) => k !== token))), 15000);
  }

  return (
    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
      {tokens.map((t) =>
        revealed[t] ? (
          <span key={t} className="rounded bg-gray-100 px-2 py-0.5 font-mono">{revealed[t]}</span>
        ) : (
          <button key={t} type="button" onClick={() => reveal(t)} className="underline">
            Reveal {t.startsWith("[EMAIL") ? "email" : "phone"}
          </button>
        ),
      )}
      {error && <span role="alert" className="text-red-700">{error}</span>}
    </div>
  );
}
