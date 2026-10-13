// Amounts are stored as integer minor units plus a currency code to avoid floating-point errors.
const SYMBOLS: Record<string, string> = { "$": "USD", "€": "EUR", "£": "GBP", "₹": "INR", "¥": "JPY" };
const CODE_RE = /\b(USD|EUR|GBP|INR|JPY|CAD|AUD)\b/i;

export type Money = { amountMinor: number; currency: string };

/** Parses strings like "$1,200.00", "1.200,50 EUR" or "320". Returns null if no amount is found. */
export function parseMoney(raw: string | null | undefined, fallbackCurrency = "USD"): Money | null {
  if (!raw) return null;
  const currency =
    raw.match(CODE_RE)?.[1].toUpperCase() ??
    Object.entries(SYMBOLS).find(([s]) => raw.includes(s))?.[1] ??
    fallbackCurrency;

  const num = raw.match(/\d[\d.,]*/)?.[0];
  if (!num) return null;

  const lastDot = num.lastIndexOf(".");
  const lastComma = num.lastIndexOf(",");
  let normalised: string;
  if (lastDot >= 0 && lastComma >= 0) {
    const decimalSep = lastDot > lastComma ? "." : ",";
    normalised = num.split(decimalSep === "." ? "," : ".").join("").replace(decimalSep, ".");
  } else if (lastComma >= 0) {
    // "1,200" is thousands; "12,50" is a decimal comma.
    normalised = /,\d{2}$/.test(num) && num.indexOf(",") === lastComma ? num.replace(",", ".") : num.replace(/,/g, "");
  } else {
    normalised = num;
  }
  const value = Number(normalised);
  if (!Number.isFinite(value)) return null;
  return { amountMinor: Math.round(value * 100), currency };
}

export function formatMoney({ amountMinor, currency }: Money, locale = "en-US") {
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(amountMinor / 100);
}
