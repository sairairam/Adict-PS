import { createHmac } from "node:crypto";
import { detectPii, type PiiType } from "./detect";

export type PiiEntry = { token: string; type: PiiType; value: string };

function secret(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

/** Normalise so the same email/phone always maps to the same token. */
function canonical(type: PiiType, value: string) {
  return type === "email" ? value.trim().toLowerCase() : value.replace(/[^\d+]/g, "");
}

/** Deterministic per tenant: HMAC(secret, org + type + canonical value). */
export function makeToken(orgId: string, type: PiiType, value: string, key = secret("PII_HMAC_KEY")) {
  const digest = createHmac("sha256", key).update(`${orgId}:${type}:${canonical(type, value)}`).digest("hex");
  return `[${type.toUpperCase()}_${digest.slice(0, 12)}]`;
}

/** Replaces every email/phone in `text` with a token and returns the originals for the vault. */
export function tokeniseText(text: string, orgId: string, key?: string) {
  const entries = new Map<string, PiiEntry>();
  let out = "";
  let cursor = 0;
  for (const m of detectPii(text)) {
    const token = makeToken(orgId, m.type, m.value, key);
    entries.set(token, { token, type: m.type, value: m.value });
    out += text.slice(cursor, m.start) + token;
    cursor = m.end;
  }
  out += text.slice(cursor);
  return { text: out, entries: [...entries.values()] };
}
