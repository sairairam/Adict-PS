import { extractionSchema, FIELD_TYPES, type Extraction } from "@/lib/schemas/extraction";

/** Reads a document and returns page text plus structured fields. Swap providers by implementing this. */
export interface DocumentReader {
  read(file: { bytes: Uint8Array; mimeType: string }): Promise<Extraction>;
}

const DEFAULT_MODEL = "gemini-flash-latest";
const SUPPORTED = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp", "image/tiff"]);
// Inline requests are capped at 20 MB total; base64 adds a third.
const MAX_INLINE_BYTES = 14 * 1024 * 1024;

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  required: ["doc_type", "pages", "fields"],
  properties: {
    doc_type: { type: "STRING" },
    pages: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        required: ["page_no", "markdown"],
        properties: { page_no: { type: "INTEGER" }, markdown: { type: "STRING" } },
      },
    },
    fields: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        required: ["key", "label", "type", "value", "confidence", "page_no", "options"],
        properties: {
          key: { type: "STRING" },
          label: { type: "STRING" },
          type: { type: "STRING", enum: [...FIELD_TYPES] },
          value: { type: "STRING", nullable: true },
          confidence: { type: "NUMBER" },
          page_no: { type: "INTEGER", nullable: true },
          options: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              required: ["value", "confidence"],
              properties: { value: { type: "STRING" }, confidence: { type: "NUMBER" } },
            },
          },
        },
      },
    },
  },
};

const PROMPT = `Read this document, including typed text, handwriting and checkboxes.
Return:
- doc_type: a short description of the document kind.
- pages: the text of every page in markdown, in order (page_no starts at 1). Show checkboxes as ☑ (checked) or ☐ (unchecked).
- fields: every labelled field on the form.

Field rules:
- key: stable snake_case identifier. label: the text shown on the form.
- type: one of ${FIELD_TYPES.join(", ")}. Use "checkbox" for tick boxes with value "checked" or "unchecked"; use "select" when the form offers several choices.
- value: exactly what the document shows; null if blank or illegible. Never invent values.
- For "select" fields, list every candidate choice in options with your confidence, and put the chosen one (if any) in value.
- Amounts: keep the printed currency symbol and digits in value.
- confidence: 0 to 1, lower for handwriting or ambiguous text.
- page_no: the page the field appears on.`;

type GeminiResponse = {
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
};

/** Pure, so it can be unit tested without the network. */
export function parseGeminiResponse(data: GeminiResponse): Extraction {
  if (data.promptFeedback?.blockReason) throw new Error(`Gemini blocked the request: ${data.promptFeedback.blockReason}`);
  const candidate = data.candidates?.[0];
  const text = candidate?.content?.parts?.map((p) => p.text ?? "").join("");
  if (!text) throw new Error(`Gemini returned no content (finishReason: ${candidate?.finishReason ?? "unknown"})`);
  if (candidate?.finishReason === "MAX_TOKENS") throw new Error("Gemini output was cut off; the document is too long");
  return extractionSchema.parse(JSON.parse(text));
}

export class GeminiReader implements DocumentReader {
  async read({ bytes, mimeType }: { bytes: Uint8Array; mimeType: string }): Promise<Extraction> {
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new Error("GEMINI_API_KEY is not set");
    if (!SUPPORTED.has(mimeType)) {
      throw new Error(`Gemini cannot read ${mimeType}; upload a PDF or image (Word files are not supported yet)`);
    }
    if (bytes.byteLength > MAX_INLINE_BYTES) throw new Error("File is too large for Gemini inline upload (limit about 14 MB)");

    const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;
    const body = JSON.stringify({
      contents: [
        {
          parts: [
            { inline_data: { mime_type: mimeType, data: Buffer.from(bytes).toString("base64") } },
            { text: PROMPT },
          ],
        },
      ],
      generationConfig: { temperature: 0, responseMimeType: "application/json", responseSchema: RESPONSE_SCHEMA },
    });

    // The free tier rate-limits aggressively: retry 429/503 with backoff.
    let lastError = "";
    for (let attempt = 0; attempt < 4; attempt++) {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
        body,
      });
      if (res.ok) return parseGeminiResponse(await res.json());
      lastError = `Gemini ${model} failed (${res.status}): ${(await res.text()).slice(0, 300)}`;
      if (res.status !== 429 && res.status !== 503) break;
      await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
    }
    throw new Error(lastError);
  }
}
