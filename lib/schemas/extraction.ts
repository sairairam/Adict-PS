import { z } from "zod";

export const FIELD_TYPES = ["text", "number", "date", "money", "checkbox", "email", "phone", "select"] as const;

export const extractedFieldSchema = z.object({
  key: z.string().min(1).max(80),
  label: z.string().min(1).max(200),
  type: z.enum(FIELD_TYPES),
  value: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  page_no: z.number().int().min(1).nullable(),
  options: z
    .array(z.object({ value: z.string(), confidence: z.number().min(0).max(1) }))
    .default([]),
});

export const extractionSchema = z.object({
  doc_type: z.string(),
  pages: z.array(z.object({ page_no: z.number().int().min(1), markdown: z.string() })).min(1),
  fields: z.array(extractedFieldSchema),
});

export type ExtractedField = z.infer<typeof extractedFieldSchema>;
export type Extraction = z.infer<typeof extractionSchema>;
