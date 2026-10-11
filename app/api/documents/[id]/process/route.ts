export const maxDuration = 300;

import { after, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { matchesMagicBytes } from "@/lib/magic";
import { processJob } from "@/lib/pipeline/process";

// After the client finishes uploading: verify the file really is what it claims, then enqueue.
export async function POST(_req: Request, ctx: RouteContext<"/api/documents/[id]/process">) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  // RLS scopes this to the caller's organisation.
  const { data: doc } = await supabase.from("documents").select("*").eq("id", id).single();
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const admin = createServiceClient();
  const { data: blob, error } = await admin.storage.from("documents").download(doc.storage_path);
  if (error || !blob) return NextResponse.json({ error: "File not uploaded" }, { status: 409 });

  const head = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
  if (!matchesMagicBytes(doc.mime_type, head)) {
    await admin.storage.from("documents").remove([doc.storage_path]);
    await admin.from("documents").update({ status: "failed" }).eq("id", id);
    return NextResponse.json({ error: "File content does not match its type" }, { status: 422 });
  }

  const { data: job, error: jobError } = await admin.from("processing_jobs").insert({
    document_id: id,
    org_id: doc.org_id,
    stage: "normalise",
  }).select("id").single();
  if (jobError || !job) return NextResponse.json({ error: jobError?.message ?? "Enqueue failed" }, { status: 500 });
  after(() => processJob(job.id));

  await admin.from("audit_log").insert({
    org_id: doc.org_id,
    actor_id: auth.user.id,
    action: "document.enqueue",
    entity: "documents",
    entity_id: id,
  });
  return NextResponse.json({ status: "queued" }, { status: 202 });
}
