# Adict-PS
Extracting Information from Data Provided. Autofilling, OCR model application.

See [implementation-architecture.md](implementation-architecture.md) for the design.

## Status
- Phase 1 (Foundation): auth, schema with RLS, signed uploads, magic-byte verification, job queue.
- Phase 2 (Extraction): Gemini reads PDFs and images and returns page text and fields.
- Phase 5 (PII): emails and phone numbers are tokenised, encrypted in a vault, and revealed only through an audited, role-gated endpoint.
- Phase 3 (Review UI): editable form with autosave, field validation, cost highlighting and submit/lock.

Not built yet: cross-check scoring (Phase 4), document viewer with bounding boxes, Word files, offline edit queue.

## Offline testing mode
Set `DOCUMENT_READER=tesseract` in `.env.local` to read documents locally with Tesseract: no API key and nothing leaves your machine. It is for testing only: less accurate than Gemini, no handwriting or checkbox support, and fields come from layout heuristics. The default is `gemini`. Restart `npm run dev` after changing it.

## Setup
1. Create a Supabase project and run `supabase/migrations/0001_init.sql` (SQL editor or `supabase db push`).
2. Copy `.env.example` to `.env.local` and fill in the Supabase URL, anon key and service-role key.
3. Get a free Gemini key at https://aistudio.google.com/apikey and set `GEMINI_API_KEY`.
4. `npm install`, then `npm run dev`. Run tests with `npm test`.
