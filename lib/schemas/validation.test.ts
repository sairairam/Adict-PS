import { describe, expect, it } from "vitest";
import { formatMoney, parseMoney } from "@/lib/money";
import { validateField } from "./validation";

const status = (type: string, value: string | null, options?: string[]) =>
  validateField({ type, value, options }).status;

describe("validateField", () => {
  it("treats empty values as pending", () => {
    expect(status("email", null)).toBe("pending");
    expect(status("number", "  ")).toBe("pending");
  });
  it("validates emails and accepts PII tokens", () => {
    expect(status("email", "jane@example.com")).toBe("valid");
    expect(status("email", "not-an-email")).toBe("invalid");
    expect(status("email", "[EMAIL_80bd781c77de]")).toBe("valid");
  });
  it("validates phones and accepts PII tokens", () => {
    expect(status("phone", "(415) 555-2671")).toBe("valid");
    expect(status("phone", "12")).toBe("invalid");
    expect(status("phone", "[PHONE_752af6996fb4]")).toBe("valid");
  });
  it("validates numbers, money, dates", () => {
    expect(status("number", "1,250.5")).toBe("valid");
    expect(status("number", "abc")).toBe("invalid");
    expect(status("money", "$1,200.00")).toBe("valid");
    expect(status("money", "free")).toBe("invalid");
    expect(status("date", "2026-10-05")).toBe("valid");
    expect(status("date", "yesterday-ish")).toBe("invalid");
  });
  it("validates checkbox and select membership", () => {
    expect(status("checkbox", "checked")).toBe("valid");
    expect(status("checkbox", "yes")).toBe("invalid");
    expect(status("select", "B", ["A", "B"])).toBe("valid");
    expect(status("select", "C", ["A", "B"])).toBe("invalid");
  });
});

describe("parseMoney", () => {
  it("parses common formats to minor units", () => {
    expect(parseMoney("$1,200.00")).toEqual({ amountMinor: 120000, currency: "USD" });
    expect(parseMoney("$3,000.00 (subject to inspection)")).toEqual({ amountMinor: 300000, currency: "USD" });
    expect(parseMoney("1.200,50 EUR")).toEqual({ amountMinor: 120050, currency: "EUR" });
    expect(parseMoney("12,50 €")).toEqual({ amountMinor: 1250, currency: "EUR" });
    expect(parseMoney("320")).toEqual({ amountMinor: 32000, currency: "USD" });
  });
  it("returns null when there is no amount", () => {
    expect(parseMoney("n/a")).toBeNull();
    expect(parseMoney(null)).toBeNull();
  });
  it("formats minor units", () => {
    expect(formatMoney({ amountMinor: 120000, currency: "USD" })).toBe("$1,200.00");
  });
});
