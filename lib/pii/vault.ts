import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PiiEntry } from "./tokenise";

// AES-256-GCM. Stored layout: iv (12) | auth tag (16) | ciphertext, as a Postgres bytea hex string.
function key(raw = process.env.PII_VAULT_KEY) {
  if (!raw) throw new Error("PII_VAULT_KEY is not set");
  return createHash("sha256").update(raw).digest();
}

export function encryptValue(plain: string, raw?: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(raw), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return "\\x" + Buffer.concat([iv, cipher.getAuthTag(), body]).toString("hex");
}

export function decryptValue(stored: string, raw?: string): string {
  const buf = Buffer.from(stored.replace(/^\\x/, ""), "hex");
  const decipher = createDecipheriv("aes-256-gcm", key(raw), buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString("utf8");
}

/** Service-role client only: pii_vault has no RLS policies. */
export async function storeEntries(admin: SupabaseClient, orgId: string, documentId: string, entries: PiiEntry[]) {
  if (!entries.length) return;
  const { error } = await admin.from("pii_vault").upsert(
    entries.map((e) => ({
      token: e.token,
      org_id: orgId,
      type: e.type,
      encrypted_value: encryptValue(e.value),
      document_id: documentId,
    })),
    { onConflict: "token", ignoreDuplicates: true },
  );
  if (error) throw new Error(`Vault write failed: ${error.message}`);
}
