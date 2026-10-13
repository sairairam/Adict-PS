import { parseMoney } from "@/lib/money";

// Pure and dependency-free: the same function runs in the browser (instant feedback) and on the
// server (authoritative, on every autosave and at submission).

export type ValidationStatus = "pending" | "valid" | "invalid";
export type ValidationResult = { status: ValidationStatus; errors: string[] };

export const PII_TOKEN_RE = /\[(?:EMAIL|PHONE)_[0-9a-f]{12}\]/g;
const SINGLE_TOKEN_RE = /^\[(EMAIL|PHONE)_[0-9a-f]{12}\]$/;
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;

export type FieldInput = {
  type: string;
  value: string | null;
  /** Allowed values for "select" fields; empty means unconstrained. */
  options?: string[];
};

export function validateField({ type, value, options = [] }: FieldInput): ValidationResult {
  const v = value?.trim() ?? "";
  if (!v) return { status: "pending", errors: [] };

  const fail = (message: string): ValidationResult => ({ status: "invalid", errors: [message] });
  const ok: ValidationResult = { status: "valid", errors: [] };

  switch (type) {
    case "number":
      return Number.isFinite(Number(v.replace(/,/g, ""))) ? ok : fail("Enter a valid number");
    case "money":
      return parseMoney(v) ? ok : fail("Enter a valid amount, e.g. $1,200.00");
    case "date":
      return Number.isNaN(Date.parse(v)) ? fail("Enter a valid date") : ok;
    case "email":
      return SINGLE_TOKEN_RE.test(v) || EMAIL_RE.test(v) ? ok : fail("Enter a valid email address");
    case "phone": {
      if (SINGLE_TOKEN_RE.test(v)) return ok;
      const digits = v.replace(/\D/g, "").length;
      return digits >= 7 && digits <= 15 ? ok : fail("Enter a valid phone number");
    }
    case "checkbox":
      return v === "checked" || v === "unchecked" ? ok : fail("Must be checked or unchecked");
    case "select":
      return options.length === 0 || options.includes(v) ? ok : fail("Choose one of the listed options");
    default:
      return ok;
  }
}
