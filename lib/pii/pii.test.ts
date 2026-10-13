import { describe, expect, it } from "vitest";
import { detectPii } from "./detect";
import { makeToken, tokeniseText } from "./tokenise";
import { decryptValue, encryptValue } from "./vault";

const KEY = "test-hmac-key";

describe("detectPii", () => {
  it("finds emails and phone numbers", () => {
    const found = detectPii("Mail jane.doe@example.com or call (415) 555-2671.", "US");
    expect(found.map((m) => m.type)).toEqual(["email", "phone"]);
    expect(found[0].value).toBe("jane.doe@example.com");
  });
  it("catches invalid-but-phone-shaped numbers such as 555 numbers", () => {
    const found = detectPii("Contact: (555) 010-2486 | jordan@example.com", "US");
    expect(found.map((m) => m.type)).toEqual(["phone", "email"]);
    expect(found[0].value).toBe("(555) 010-2486");
  });
  it("does not treat ids, amounts or dates as phones", () => {
    const text = "Claim CLM-2026-00421 policy AUTO-12345678 total $1,200.00 on 2026-10-05";
    expect(detectPii(text, "US")).toEqual([]);
  });
  it("ignores text without PII", () => {
    expect(detectPii("Invoice total 1,250.00 due 2026-01-31", "US")).toEqual([]);
  });
});

describe("tokenisation", () => {
  it("is deterministic per tenant and differs across tenants", () => {
    const a = makeToken("org1", "email", "Jane@Example.com", KEY);
    expect(a).toBe(makeToken("org1", "email", " jane@example.com ", KEY));
    expect(a).not.toBe(makeToken("org2", "email", "jane@example.com", KEY));
    expect(a).toMatch(/^\[EMAIL_[0-9a-f]{12}\]$/);
  });
  it("replaces PII and returns originals for the vault", () => {
    const { text, entries } = tokeniseText("Contact a@b.co now", "org1", KEY);
    expect(text).not.toContain("a@b.co");
    expect(text).toMatch(/Contact \[EMAIL_[0-9a-f]{12}\] now/);
    expect(entries).toHaveLength(1);
    expect(entries[0].value).toBe("a@b.co");
  });
});

describe("vault encryption", () => {
  it("round-trips and uses a fresh IV each time", () => {
    const one = encryptValue("secret@x.io", "vault-key");
    expect(decryptValue(one, "vault-key")).toBe("secret@x.io");
    expect(encryptValue("secret@x.io", "vault-key")).not.toBe(one);
  });
  it("fails with the wrong key", () => {
    expect(() => decryptValue(encryptValue("x", "k1"), "k2")).toThrow();
  });
});
