import { GeminiReader, type DocumentReader } from "./gemini";
import { TesseractReader } from "./tesseract";

/** DOCUMENT_READER=gemini (default) or tesseract (offline, testing only). */
export function createReader(): DocumentReader {
  const name = (process.env.DOCUMENT_READER || "gemini").toLowerCase();
  if (name === "tesseract") return new TesseractReader();
  if (name === "gemini") return new GeminiReader();
  throw new Error(`Unknown DOCUMENT_READER "${name}" (use "gemini" or "tesseract")`);
}
