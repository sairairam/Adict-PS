import { describe, expect, it } from "vitest";
import { parseGeminiResponse } from "./gemini";

const wrap = (obj: unknown, finishReason = "STOP") => ({
  candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] }, finishReason }],
});

const valid = {
  doc_type: "Vehicle damage claim",
  pages: [{ page_no: 1, markdown: "# Claim\nPolicy: ☑ Collision" }],
  fields: [
    { key: "policy_no", label: "Policy No", type: "text", value: "P-1", confidence: 0.9, page_no: 1, options: [] },
    { key: "collision", label: "Collision", type: "checkbox", value: "checked", confidence: 0.8, page_no: 1, options: [] },
  ],
};

describe("parseGeminiResponse", () => {
  it("parses a valid response", () => {
    const out = parseGeminiResponse(wrap(valid));
    expect(out.fields).toHaveLength(2);
    expect(out.pages[0].page_no).toBe(1);
  });
  it("rejects output that does not match the schema", () => {
    expect(() => parseGeminiResponse(wrap({ ...valid, fields: [{ key: "x" }] }))).toThrow();
  });
  it("reports blocked requests", () => {
    expect(() => parseGeminiResponse({ promptFeedback: { blockReason: "SAFETY" } })).toThrow(/blocked/);
  });
  it("reports empty and truncated output", () => {
    expect(() => parseGeminiResponse({ candidates: [] })).toThrow(/no content/);
    expect(() => parseGeminiResponse(wrap(valid, "MAX_TOKENS"))).toThrow(/cut off/);
  });
});
