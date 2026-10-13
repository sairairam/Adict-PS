import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ExtractionForm, type FieldRow } from "@/components/ExtractionForm";

export default function ReviewPage(props: PageProps<"/documents/[id]">) {
  return (
    <main className="mx-auto max-w-6xl p-4">
      <Link href="/documents" className="text-sm underline">← All documents</Link>
      <Suspense fallback={<p className="mt-6 text-sm text-gray-600">Loading...</p>}>
        <Review params={props.params} />
      </Suspense>
    </main>
  );
}

async function Review({ params }: { params: Promise<{ id: string }> }) {
  await connection(); // per-user data: never prerender
  const { id } = await params;
  const supabase = await createClient();

  // RLS limits every query to the signed-in user's organisation.
  const { data: doc } = await supabase.from("documents").select("id, filename, status, doc_type, page_count").eq("id", id).single();
  if (!doc) notFound();

  const { data: fields } = await supabase.from("fields").select("*").eq("document_id", id).order("page_no").order("created_at");
  const [{ data: options }, { data: pages }, { data: job }] = await Promise.all([
    supabase.from("field_options").select("field_id, value").in("field_id", (fields ?? []).map((f) => f.id)),
    supabase.from("pages").select("page_no, markdown").eq("document_id", id).order("page_no"),
    supabase.from("processing_jobs").select("status, error").eq("document_id", id).order("updated_at", { ascending: false }).limit(1).maybeSingle(),
  ]);

  const rows: FieldRow[] = (fields ?? []).map((f) => ({
    id: f.id,
    key: f.key,
    label: f.label,
    type: f.type,
    is_cost: f.is_cost,
    page_no: f.page_no,
    value: f.value,
    confidence: f.confidence,
    version: f.version,
    validation_status: f.validation_status,
    validation_errors: f.validation_errors,
    options: (options ?? []).filter((o) => o.field_id === f.id).map((o) => o.value),
  }));

  const ready = doc.status === "ready_for_review" || doc.status === "submitted";

  return (
    <>
      <header className="my-4">
        <h1 className="text-2xl font-semibold">{doc.filename}</h1>
        <p className="text-sm text-gray-600">
          {doc.doc_type ?? "Document"} · {doc.page_count ?? "?"} page(s) · status: {doc.status}
        </p>
      </header>

      {!ready ? (
        <p role="status" className="rounded border p-4 text-sm">
          {doc.status === "failed"
            ? `Processing failed: ${job?.error ?? "unknown error"}`
            : "This document is still being processed. Refresh in a moment."}
        </p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <section aria-label="Source text" className="max-h-[75vh] overflow-auto rounded border bg-gray-50 p-4">
            <h2 className="mb-2 text-sm font-semibold">Source text (personal data tokenised)</h2>
            {(pages ?? []).map((p) => (
              <article key={p.page_no} className="mb-4">
                <h3 className="text-xs font-semibold text-gray-600">Page {p.page_no}</h3>
                <pre className="whitespace-pre-wrap text-sm">{p.markdown}</pre>
              </article>
            ))}
          </section>
          <section aria-label="Extracted fields">
            <ExtractionForm documentId={doc.id} initial={rows} locked={doc.status === "submitted"} />
          </section>
        </div>
      )}
    </>
  );
}
