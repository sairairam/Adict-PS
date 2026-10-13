import { findPhoneNumbersInText, type CountryCode } from "libphonenumber-js";

export type PiiType = "email" | "phone";
export type PiiMatch = { type: PiiType; value: string; start: number; end: number };

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;

// Optional country code, then 3-3-4 digits with common separators; not glued to other digits.
const PHONE_FALLBACK_RE = /(?<![\d-])(?:\+\d{1,3}[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)/g;

export function defaultRegion(): CountryCode {
  return (process.env.PII_DEFAULT_REGION as CountryCode) || "US";
}

/** Finds emails and phone numbers; returns non-overlapping matches in text order. */
export function detectPii(text: string, region: CountryCode = defaultRegion()): PiiMatch[] {
  const matches: PiiMatch[] = [];

  for (const m of text.matchAll(EMAIL_RE)) {
    matches.push({ type: "email", value: m[0], start: m.index, end: m.index + m[0].length });
  }
  for (const p of findPhoneNumbersInText(text, region)) {
    matches.push({ type: "phone", value: text.slice(p.startsAt, p.endsAt), start: p.startsAt, end: p.endsAt });
  }
  // Fallback: libphonenumber only matches *valid* numbers, so formats like (555) 010-2486 slip through.
  for (const m of text.matchAll(PHONE_FALLBACK_RE)) {
    const digits = m[0].replace(/\D/g, "").length;
    if (digits >= 10 && digits <= 15) {
      matches.push({ type: "phone", value: m[0], start: m.index, end: m.index + m[0].length });
    }
  }

  matches.sort((a, b) => a.start - b.start || b.end - a.end);
  const result: PiiMatch[] = [];
  for (const m of matches) {
    if (!result.length || m.start >= result[result.length - 1].end) result.push(m);
  }
  return result;
}
