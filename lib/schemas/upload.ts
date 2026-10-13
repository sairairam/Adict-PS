import { z } from "zod";

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export const ACCEPTED_TYPES = {
  "application/pdf": [".pdf"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
  "application/msword": [".doc"],
  "image/png": [".png"],
  "image/jpeg": [".jpg", ".jpeg"],
  "image/tiff": [".tif", ".tiff"],
  "image/webp": [".webp"],
} as const;

export const uploadRequestSchema = z
  .object({
    filename: z.string().min(1).max(255),
    mimeType: z.string(),
    sizeBytes: z.number().int().positive().max(MAX_UPLOAD_BYTES),
  })
  .refine((v) => v.mimeType in ACCEPTED_TYPES, { message: "Unsupported file type", path: ["mimeType"] })
  .refine(
    (v) => {
      const exts = ACCEPTED_TYPES[v.mimeType as keyof typeof ACCEPTED_TYPES] as readonly string[];
      return exts?.some((e) => v.filename.toLowerCase().endsWith(e));
    },
    { message: "File extension does not match type", path: ["filename"] },
  );

export type UploadRequest = z.infer<typeof uploadRequestSchema>;
