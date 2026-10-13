import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/server";
import { GeminiReader, type DocumentReader } from "@/lib/extraction/gemini";
import { tokeniseText, type PiiEntry } from "@/lib/pii/tokenise";
import { storeEntries } from "@/lib/pii/vault";

type Doc = { id: string; org_id: string; storage_path: string; mime_type: string };

async function setJob(admin: SupabaseClient, jobId: string, patch: Record<string, unknown>) {
  await admin.from("processing_jobs").update(patch).eq("id", jobId);
}

/**
 * Runs the pipeline for one queued job: read the document, tokenise PII, store the results.
 *
 * The reader sees the raw document (it has to), so everything we persist is tokenised first:
 * page text, field values and option values contain tokens, originals live only in the vault.
 * Re-running replaces earlier pages and fields, so a retry is safe.
 */
export async function processJob(jobId: string, reader: DocumentReader = new GeminiReader()) {
  const admin = createServiceClient();

  const { data: job } = await admin.from("processing_jobs").select("*").eq("id", jobId).single();
  if (!job || job.status === "done") return;
  const { data: doc } = await admin.from("documents").select("*").eq("id", job.document_id).single<Doc>();
  if (!doc) return;

  await setJob(admin, jobId, { status: "running", attempts: job.attempts + 1, error: null });

  try {
    await admin.from("documents").update({ status: "normalised" }).eq("id", doc.id);

    const { data: blob, error: downloadError } = await admin.storage.from("documents").download(doc.storage_path);
    if (downloadError || !blob) throw new Error(`Could not read uploaded file: ${downloadError?.message}`);

    const extraction = await reader.read({
      bytes: new Uint8Array(await blob.arrayBuffer()),
      mimeType: doc.mime_type,
    });

    const entries: PiiEntry[] = [];
    const tokenise = (text: string) => {
      const t = tokeniseText(text, doc.org_id);
      entries.push(...t.entries);
      return t.text;
    };

    const pages = extraction.pages.map((p) => ({
      document_id: doc.id,
      org_id: doc.org_id,
      page_no: p.page_no,
      markdown: tokenise(p.markdown),
    }));
    const fields = extraction.fields.map((f) => ({
      field: {
        document_id: doc.id,
        org_id: doc.org_id,
        key: f.key,
        label: f.label,
        type: f.type,
        is_cost: f.type === "money",
        page_no: f.page_no,
        value: f.value === null ? null : tokenise(f.value),
        confidence: f.confidence,
      },
      options: f.options.map((o) => ({ value: tokenise(o.value), confidence: o.confidence })),
    }));

    // Vault first: never persist a token whose original is not recoverable.
    await storeEntries(admin, doc.org_id, doc.id, entries);

    await admin.from("pages").delete().eq("document_id", doc.id);
    await admin.from("fields").delete().eq("document_id", doc.id);

    const { error: pagesError } = await admin.from("pages").insert(pages);
    if (pagesError) throw new Error(pagesError.message);
    await admin.from("documents").update({ status: "ocr_done", page_count: pages.length }).eq("id", doc.id);

    // Duplicate keys from the model would violate unique (document_id, key): keep the first.
    const seen = new Set<string>();
    for (const { field, options } of fields) {
      if (seen.has(field.key)) continue;
      seen.add(field.key);
      const { data: row, error } = await admin.from("fields").insert(field).select("id").single();
      if (error) throw new Error(error.message);
      if (options.length) {
        const { error: optError } = await admin.from("field_options").insert(
          options.map((o) => ({ field_id: row.id, org_id: doc.org_id, value: o.value, source: "llm", confidence: o.confidence })),
        );
        if (optError) throw new Error(optError.message);
      }
    }

    await admin.from("documents").update({ status: "ready_for_review", doc_type: extraction.doc_type }).eq("id", doc.id);
    await setJob(admin, jobId, { status: "done", stage: "extract" });
  } catch (e) {
    await setJob(admin, jobId, { status: "failed", error: e instanceof Error ? e.message : String(e) });
    await admin.from("documents").update({ status: "failed" }).eq("id", doc.id);
  }
}
