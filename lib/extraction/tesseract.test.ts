import { describe, expect, it } from "vitest";
import { detectPii } from "@/lib/pii/detect";
import { extractFieldsFromLines, normaliseOcrMoney, repairOcrEmails, type OcrLine } from "./tesseract";

const w = (text: string, x0: number, x1: number, confidence = 90) => ({ text, x0, x1, confidence });
const line = (words: ReturnType<typeof w>[]): OcrLine => ({ words, y0: 0, y1: 30 });

describe("OCR text repair", () => {
  it("repairs emails mangled by OCR so PII detection still catches them", () => {
    expect(repairOcrEmails("jordan.taylor® example.com")).toBe("jordan.taylor@example.com");
    expect(repairOcrEmails("mail a@ b.co now")).toBe("mail a@b.co now");
    expect(detectPii(repairOcrEmails("Contact jordan.taylor® example.com"), "US").map((m) => m.type)).toEqual(["email"]);
  });
  it("fixes European-style thousands separators in money", () => {
    expect(normaliseOcrMoney("$1.200.00")).toBe("$1,200.00");
    expect(normaliseOcrMoney("$3.000.00 (subject to inspection)")).toBe("$3,000.00 (subject to inspection)");
    expect(normaliseOcrMoney("$850.00")).toBe("$850.00");
  });
});

describe("extractFieldsFromLines", () => {
  it("splits label and value at the wide column gap", () => {
    const fields = extractFieldsFromLines(
      [
        line([w("Claimant", 0, 80), w("Jordan", 300, 360), w("Taylor", 370, 430)]),
        line([w("Trunk", 0, 50), w("repair", 58, 105), w("and", 112, 140), w("paint", 148, 190), w("$1.200.00", 600, 700)]),
      ],
      1,
    );
    expect(fields).toHaveLength(2);
    expect(fields[0]).toMatchObject({ key: "claimant", label: "Claimant", value: "Jordan Taylor", type: "text", page_no: 1 });
    expect(fields[1]).toMatchObject({ key: "trunk_repair_and_paint", value: "$1,200.00", type: "money" });
  });
  it("ignores running text, headings and blank signature lines", () => {
    const fields = extractFieldsFromLines(
      [
        line([w("Description", 0, 90), w("of", 98, 120), w("damage", 128, 190)]), // no wide gap
        line([w("Claimant", 0, 80), w("____________", 300, 500)]), // only underscores
        line([w("Single", 0, 60)]),
      ],
      1,
    );
    expect(fields).toEqual([]);
  });
});
