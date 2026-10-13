import { formatMoney, parseMoney } from "@/lib/money";

/** Consistent cost highlighting: bold, tabular numerals, a "$" icon so it is not colour-only. */
export function CostBadge({ value, label }: { value: string | null; label?: string }) {
  const money = parseMoney(value);
  if (!money) return null;
  return (
    <span
      className="inline-flex items-center gap-1 rounded border border-amber-700 bg-amber-50 px-2 py-0.5 text-sm font-bold text-amber-900 tabular-nums"
      title={label ? `${label}: cost` : "Cost"}
    >
      <span aria-hidden>$</span>
      <span className="sr-only">Cost: </span>
      {formatMoney(money)}
    </span>
  );
}
