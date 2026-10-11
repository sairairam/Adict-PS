# Implementation Architecture: Document Extraction & Review Platform

## 1. Overview

A web application where users upload PDF, Word and image files. The system reads typed text, handwriting and checkboxes, extracts fields (including fields with multiple dropdown options), cross-checks the suggested options, highlights the best one, shows cost prominently, validates every field, autosaves continuously, and tokenises PII (email addresses, phone numbers) after extraction.

### Stack

| Layer | Choice |
|---|---|
| Front end and back end | Next.js (App Router, TypeScript), Route Handlers and Server Actions as the backend |
| Database, auth, files | Supabase (Postgres, Auth, Storage, Realtime, Row Level Security) |
| OCR | Mistral OCR (primary); Supabase has no native OCR (see 6.1) |
| Validation | Zod (shared between client and server) |
| Jobs | Supabase Edge Functions + `pgmq` / `pg_cron` queue (or Next.js route + Vercel background functions) |
| UI | Tailwind + shadcn/ui, React Hook Form, TanStack Query |

---

## 2. High-Level Architecture

```
Browser (Next.js client)
  |  upload, review UI, autosave
  v
Next.js server (Route Handlers / Server Actions)
  |-- Auth check (Supabase session)
  |-- Signed upload URL --> Supabase Storage (private bucket)
  |-- Enqueue job ------> Postgres queue (pgmq)
  v
Worker (Edge Function / background route)
  1. Normalise file (Word -> PDF, image -> as is)
  2. OCR (Mistral OCR)
  3. Structured field extraction + checkbox/dropdown parsing
  4. Cross-check and scoring of suggested options
  5. Field validation
  6. PII detection + tokenisation
  7. Write results to Postgres
  v
Supabase Realtime --> UI updates live as each stage finishes
```

---

## 3. Functional Requirements Mapping

| # | Requirement | Where it is handled |
|---|---|---|
| 1 | Upload PDF, Word, image | Section 4 |
| 2 | Auto-read text, handwriting, checkboxes, multi-option dropdowns | Sections 5, 6 |
| 3 | Autosave at all stages | Section 7 |
| 4 | Cross-check suggestions, highlight best option | Section 8 |
| 5 | Highlight cost everywhere | Section 9 |
| 6 | Field-level validation | Section 10 |
| 7 | PII tokenisation after extraction | Section 11 |

---

## 4. File Upload and Normalisation

**Accepted types**

- PDF: `application/pdf`
- Word: `.docx` (`application/vnd.openxmlformats-officedocument.wordprocessingml.document`); legacy `.doc` converted via LibreOffice
- Images: `image/png`, `image/jpeg`, `image/tiff`, `image/webp`

**Flow**

1. Client requests a signed upload URL from `POST /api/uploads` (server validates MIME type, extension, size limit, e.g. 25 MB).
2. Client uploads directly to a private Supabase Storage bucket (`documents/{user_id}/{document_id}/original.ext`), with a resumable upload for large files.
3. Server creates a `documents` row (`status = 'uploaded'`) and enqueues a processing job.
4. Server-side checks: magic-byte sniffing (not just extension), page-count cap, optional antivirus scan (ClamAV in the worker).

**Normalisation**

| Input | Handling |
|---|---|
| PDF | Sent to OCR directly |
| DOCX | Convert to PDF with LibreOffice in the worker (preserves layout and checkbox glyphs); also extract native text with `mammoth` as a cross-reference |
| Image | Sent to OCR directly; pre-process (deskew, contrast) with `sharp` if confidence is low |

Note: LibreOffice cannot run inside a pure serverless function. Run the worker as a small container (Fly.io, Railway, Cloud Run) for the conversion step.

---

## 5. Extraction Pipeline

Stages are idempotent and each writes its own status, so a failure resumes from the last good stage.

```
uploaded -> normalised -> ocr_done -> extracted -> cross_checked -> validated -> tokenised -> ready_for_review
```

1. **OCR** produces page text (markdown), layout blocks and per-page images.
2. **Structured extraction** sends the OCR output plus page images to a vision-capable LLM with a JSON schema (Mistral document annotation / structured output, or another vision model) to produce typed fields.
3. **Checkbox and dropdown parsing**: see 6.2.
4. Each extracted field stores `value`, `confidence` (0 to 1), `source_page`, and `bbox` so the UI can highlight the exact region on the original document.

---

## 6. OCR Design

### 6.1 Mistral OCR vs Supabase

Supabase does not provide an OCR engine. It can host the files, queue and results, but the recognition itself must be an external service. **Recommendation: Mistral OCR as the OCR engine, Supabase as storage and orchestration.** Keep the OCR call behind an interface so another provider can be swapped in.

```ts
interface OcrProvider {
  extract(file: SignedUrl): Promise<OcrResult>; // pages, markdown, blocks, confidence
}
```

### 6.2 Handwriting, checkboxes, dropdown options

OCR alone returns text. Checkbox state and handwriting are less reliable, so:

- **Typed text**: OCR markdown is the primary source.
- **Handwriting**: OCR plus a vision-LLM pass on the cropped region; lower-confidence results are flagged for review.
- **Checkboxes**: the vision pass classifies each box as `checked | unchecked | uncertain` with a bbox. Do not rely on OCR glyphs alone (☑ / ☐ / "X" are inconsistent).
- **Multiple options in a dropdown**: where a form shows several candidate values (or ambiguous text), store all candidates as `field_options` rows rather than one value, so the cross-check stage can rank them.

Validate this on a sample set of real documents early; checkbox and handwriting accuracy varies by form quality and is the main technical risk.

---

## 7. Autosave (All Stages)

- **Client**: React Hook Form with a debounced (about 800 ms) save on change plus save on blur and `visibilitychange`. Show a "Saving... / Saved" indicator.
- **Server**: `PATCH /api/documents/:id/fields/:fieldId` upserts the value with an optimistic-concurrency `version` column; a conflict returns 409 and the UI merges.
- **Pipeline**: every stage commits its output to the database before the next begins, so nothing is lost on refresh or crash.
- **Drafts**: `documents.status` and `field_values.is_draft` allow resuming exactly where the user left off.
- **History**: an `audit_log` table (and optional `field_revisions`) records who changed what and when, which also enables undo.
- **Offline blip**: queue unsent edits in IndexedDB and replay on reconnect.

---

## 8. Cross-Checking and Best-Option Highlighting

For every field with multiple suggestions (`field_options`):

1. **Collect candidates**: OCR text, vision-LLM reading, native Word text (if DOCX), and reference-data matches.
2. **Cross-check signals**
   - Agreement between independent readers (OCR vs vision vs native text)
   - Match against reference or master data (catalogue, price list, allowed values)
   - Field-level validation pass/fail (Section 10)
   - Confidence scores
3. **Score** each option: `score = w1*agreement + w2*reference_match + w3*validity + w4*confidence` (weights configurable in a `scoring_config` table).
4. **Best option**: the highest score is flagged `is_recommended = true`. The UI highlights it (badge plus colour plus an icon, not colour alone) and shows a short "why" (e.g. "3 of 3 readers agree, matches price list").
5. **Low margin**: if the top two scores are close, mark the field "needs review" instead of auto-selecting.
6. The user can always override; the override is stored and logged.

---

## 9. Cost Highlighting

- Any field typed as `money` or flagged `is_cost = true` is rendered with a consistent `CostBadge` component (bold, accent colour, currency formatting, tabular numerals).
- Costs appear in: the extraction form, dropdown options (each option shows its cost inline), the cross-check comparison panel, the sticky summary bar (running total), and any exported output.
- When options differ in cost, show the delta versus the recommended option (e.g. `+$120.00`).
- Store amounts as integer minor units plus a currency code (`amount_minor`, `currency`) to avoid floating-point errors.
- Accessibility: contrast ratio of at least 4.5:1, not colour-only.

---

## 10. Field-Level Validation

- A single **schema registry**: each document type has a Zod schema describing every field (type, required, regex, min/max, allowed enum values, cross-field rules).
- The same schema runs **on the client** (instant feedback while typing) and **on the server** (authoritative, on every autosave and at submission).
- Validation results are stored per field (`validation_status`, `validation_errors`), so the UI shows inline errors next to the exact field.
- Autosave **saves invalid values as drafts** (so work is never lost) but blocks final submission until all required fields are valid.
- Examples: email format, phone via `libphonenumber-js`, date ranges, numeric ranges, currency, checkbox groups (exactly one / at least one), enum membership for dropdowns.

---

## 11. PII Reduction by Tokenisation

Runs **after extraction and validation**, before data is shown to broader roles or sent to any downstream system.

**Detection**

- Emails: RFC-compliant regex.
- Phone numbers: `libphonenumber-js` with default regions, plus regex fallback.
- Optional: an NER pass to catch PII embedded in free text.

**Tokenisation**

1. Replace each detected value with a stable token, e.g. `[EMAIL_7f3a9c]`, `[PHONE_b21e04]`.
2. Store the original in a separate `pii_vault` table, encrypted at rest (Supabase Vault / `pgcrypto`, with the key outside the app database). Columns: `token`, `encrypted_value`, `type`, `document_id`, `created_at`.
3. Use **deterministic tokens** (HMAC of the value plus a secret) so the same email always maps to the same token within a tenant, which keeps de-duplication and joins possible without exposing the value.
4. Application tables, logs, LLM prompts and exports only ever contain tokens.

**Detokenisation**

- Only through a server-side endpoint, gated by role (RLS plus an explicit permission), and every reveal is written to the audit log.
- The vault table has no client-readable RLS policy; access is service-role only.

**Important ordering note**: OCR and extraction necessarily see the raw text. To limit exposure, tokenise before sending content to any further third-party step (e.g. a second LLM pass) wherever that step does not need the raw values, and confirm the OCR provider's data-retention terms.

---

## 12. Data Model (Supabase / Postgres)

```
documents(id, owner_id, org_id, filename, storage_path, mime_type, status,
          doc_type, page_count, created_at, updated_at)

pages(id, document_id, page_no, markdown, image_path)

fields(id, document_id, key, label, type, is_cost, page_no, bbox,
       value, confidence, validation_status, validation_errors,
       is_draft, version, updated_by, updated_at)

field_options(id, field_id, value, source, confidence, cost_minor, currency,
              score, is_recommended, rationale)

pii_vault(token PK, org_id, type, encrypted_value, document_id, created_at)

audit_log(id, actor_id, action, entity, entity_id, diff, created_at)

processing_jobs(id, document_id, stage, status, attempts, error, updated_at)

scoring_config(org_id, weights jsonb)
```

**Row Level Security**: every table carries `org_id`/`owner_id`; policies restrict reads and writes to the owner's organisation. `pii_vault` is service-role only.

---

## 13. API Surface (Next.js Route Handlers)

| Method and path | Purpose |
|---|---|
| `POST /api/uploads` | Validate metadata, return signed upload URL, create document |
| `POST /api/documents/:id/process` | Enqueue processing |
| `GET /api/documents/:id` | Document, fields, options, status |
| `PATCH /api/documents/:id/fields/:fieldId` | Autosave a field (versioned) |
| `POST /api/documents/:id/fields/:fieldId/select-option` | Choose an option (overrides recommendation) |
| `POST /api/documents/:id/submit` | Final server-side validation and lock |
| `POST /api/pii/reveal` | Role-gated detokenisation (audited) |

Realtime: the client subscribes to `documents` and `processing_jobs` changes so the UI shows live stage progress.

---

## 14. Frontend Structure

```
app/
  (auth)/login
  documents/
    page.tsx                 # list and upload dropzone
    [id]/page.tsx            # review screen
components/
  UploadDropzone
  DocumentViewer             # original with bbox overlays
  ExtractionForm             # fields with inline validation
  OptionDropdown             # options, scores, recommended badge
  CostBadge                  # consistent cost highlighting
  SummaryBar                 # sticky running cost total and save status
  SaveIndicator
lib/
  supabase/ (server and browser clients)
  schemas/ (Zod per doc type)
  ocr/ (provider interface, mistral.ts)
  pii/ (detect, tokenise, vault)
  scoring/
```

Review screen layout: original document on the left (click a field to jump to its region), extracted form on the right, sticky summary bar for cost and save state.

---

## 15. Security and Compliance

- Private storage buckets; short-lived signed URLs only.
- Auth via Supabase Auth; RLS on all tables; service-role key only on the server.
- Secrets (Mistral key, HMAC key, vault key) in environment variables or a secrets manager, never in the client bundle.
- Encryption in transit (TLS) and at rest.
- Audit log for edits and PII reveals.
- Rate limiting on upload and OCR endpoints; file-size and page caps to control OCR cost.
- Retention policy: auto-delete originals and vault entries after a configurable period.

---

## 16. Non-Functional Considerations

- **Performance**: process pages in parallel; stream stage progress to the UI.
- **Reliability**: queue with retries and dead-letter handling; idempotent stages.
- **Cost control**: cache OCR results by file hash; cap pages per document.
- **Observability**: structured logs, per-stage timings, OCR confidence dashboards, error tracking (Sentry).
- **Testing**: golden-file test set of real forms (typed, handwritten, checkbox-heavy) with field-level accuracy metrics; unit tests for validation schemas, scoring and tokenisation; Playwright end-to-end tests for upload, review and autosave.

---

## 17. Delivery Phases

1. **Foundation**: Next.js, Supabase auth, schema and RLS, upload to Storage.
2. **OCR and extraction**: Mistral OCR integration, structured field extraction, bbox overlays.
3. **Review UI**: form, autosave, field-level validation.
4. **Cross-check and cost**: option scoring, best-option highlight, cost components.
5. **PII**: detection, tokenisation, vault, audited reveal.
6. **Hardening**: accuracy tuning on real documents, security review, monitoring.

---

## 18. Open Questions

- Which document types and forms are in scope first (this drives schemas and reference data)?
- Where does the "cost" come from: printed on the document, a price list, or both?
- Who may detokenise PII, and are there regulatory requirements (GDPR, HIPAA, SOC 2)?
- Expected volume and page counts (affects OCR budget and queue sizing)?
- Is a hosted worker container acceptable for Word-to-PDF conversion?
