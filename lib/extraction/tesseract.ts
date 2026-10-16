import os from "node:os";
import path from "node:path";
import { extractionSchema, type Extraction, type ExtractedField } from "@/lib/schemas/extraction";
import type { DocumentReader } from "./gemini";

// OFFLINE, FOR TESTING. Runs locally (no API key, nothing leaves the machine) but is far less
// accurate than Gemini and cannot read handwriting or checkboxes reliably. Fields come from
// layout heuristics, not a language model.

export type OcrWord = { text: string; confidence: number; x0: number; x1: number };
export type OcrLine = { words: OcrWord[]; y0: number; y1: number };

const MONEY_RE = /^[$€£₹]\s?\d[\d.,]*/;
const COLUMN_GAP_FACTOR = 1.2; // a gap wider than 1.2x the line height separates label from value

/** Tesseract often turns "a@b.com" into "a® b.com" or "a@ b.com". */
export function repairOcrEmails(text: string): string {
  return text.replace(/([A-Za-z0-9._%+-]+)\s?[®©@]\s?([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})/g, "$1@$2");
}

/** Tesseract often reads "$1,200.00" as "$1.200.00". */
export function normaliseOcrMoney(value: string): string {
  return value.replace(/^(\D*)(\d{1,3}(?:\.\d{3})+)\.(\d{2})\b/, (_, pre: string, whole: string, cents: string) => {
    return `${pre}${whole.replace(/\./g, ",")}.${cents}`;
  });
}

const toKey = (label: string) =>
  label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);

/** Splits each line at its widest column gap into label | value. Pure, so it is unit tested. */
export function extractFieldsFromLines(lines: OcrLine[], pageNo: number): ExtractedField[] {
  const fields: ExtractedField[] = [];
  for (const line of lines) {
    const words = [...line.words].filter((w) => w.text.trim()).sort((a, b) => a.x0 - b.x0);
    if (words.length < 2) continue;

    const height = line.y1 - line.y0;
    let splitAt = -1;
    let widest = 0;
    for (let i = 1; i < words.length; i++) {
      const gap = words[i].x0 - words[i - 1].x1;
      if (gap > widest) {
        widest = gap;
        splitAt = i;
      }
    }
    if (splitAt < 1 || widest < height * COLUMN_GAP_FACTOR) continue;

    const label = words.slice(0, splitAt).map((w) => w.text).join(" ").replace(/[:：]\s*$/, "").trim();
    const valueWords = words.slice(splitAt);
    let value = valueWords.map((w) => w.text).join(" ").trim();
    if (!label || label.length > 60 || !/[A-Za-z0-9]/.test(value) || /^[_\W]+$/.test(value)) continue;

    const isMoney = MONEY_RE.test(value);
    if (isMoney) value = normaliseOcrMoney(value);
    const key = toKey(label);
    if (!key) continue;

    const confidence = valueWords.reduce((s, w) => s + w.confidence, 0) / valueWords.length / 100;
    fields.push({
      key,
      label,
      type: isMoney ? "money" : "text",
      value: repairOcrEmails(value),
      confidence: Math.max(0, Math.min(1, Number(confidence.toFixed(2)))),
      page_no: pageNo,
      options: [],
    });
  }
  return fields;
}

export class TesseractReader implements DocumentReader {
  async read({ bytes, mimeType }: { bytes: Uint8Array; mimeType: string }): Promise<Extraction> {
    const images: Buffer[] = [];
    if (mimeType === "application/pdf") {
      const { pdf } = await import("pdf-to-img");
      for await (const page of await pdf(Buffer.from(bytes), { scale: 3 })) images.push(page);
    } else if (mimeType.startsWith("image/") && mimeType !== "image/webp") {
      images.push(Buffer.from(bytes));
    } else {
      throw new Error(`Tesseract reader cannot read ${mimeType}; use a PDF, PNG, JPEG or TIFF`);
    }

    const { createWorker } = await import("tesseract.js");
    const worker = await createWorker("eng", 1, { cachePath: path.join(os.tmpdir(), "tesseract-cache") });
    try {
      const pages: Extraction["pages"] = [];
      const fields: ExtractedField[] = [];
      const seen = new Set<string>();

      for (const [i, image] of images.entries()) {
        const pageNo = i + 1;
        const { data } = await worker.recognize(image, {}, { text: true, blocks: true });
        pages.push({ page_no: pageNo, markdown: repairOcrEmails(data.text) });

        const lines: OcrLine[] = (data.blocks ?? []).flatMap((b) =>
          b.paragraphs.flatMap((p) =>
            p.lines.map((l) => ({
              y0: l.bbox.y0,
              y1: l.bbox.y1,
              words: l.words.map((w) => ({ text: w.text, confidence: w.confidence, x0: w.bbox.x0, x1: w.bbox.x1 })),
            })),
          ),
        );
        for (const f of extractFieldsFromLines(lines, pageNo)) {
          let key = f.key;
          for (let n = 2; seen.has(key); n++) key = `${f.key}_${n}`;
          seen.add(key);
          fields.push({ ...f, key });
        }
      }
      return extractionSchema.parse({ doc_type: "Scanned document (offline OCR)", pages, fields });
    } finally {
      await worker.terminate();
    }
  }
}
