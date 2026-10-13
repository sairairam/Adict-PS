import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { validateField } from "@/lib/schemas/validation";
import { tokeniseText } from "@/lib/pii/tokenise";
import { storeEntries } from "@/lib/pii/vault";

const body = z.object({
  value: z.string().max(5000).nullable(),
  version: z.number().int().positive(),
});

const FIELD_COLUMNS = "id, value, version, validation_status, validation_errors, is_draft";

// Autosave one field. Optimistic concurrency: the client sends the version it last saw.
export async function PATCH(request: Request, ctx: RouteContext<"/api/documents/[id]/fields/[fieldId]">) {
  const { id, fieldId } = await ctx.params;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  const { version } = parsed.data;
  const rawValue = parsed.data.value?.trim() ? parsed.data.value : null;

  // RLS scopes both reads to the caller's organisation.
  const { data: doc } = await supabase.from("documents").select("id, org_id, status").eq("id", id).single();
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (doc.status === "submitted") return NextResponse.json({ error: "Document is submitted and locked" }, { status: 423 });

  const { data: field } = await supabase
    .from("fields")
    .select("id, type, value, version")
    .eq("id", fieldId)
    .eq("document_id", id)
    .single();
  if (!field) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: options } = await supabase.from("field_options").select("value").eq("field_id", fieldId);
  const optionValues = (options ?? []).map((o) => o.value);

  // Validate the raw value first (authoritative), then tokenise so PII is never stored in clear.
  // Invalid values are still saved as drafts so work is never lost.
  const validation = validateField({ type: field.type, value: rawValue, options: optionValues });
  const admin = createServiceClient();
  let storedValue = rawValue;
  if (rawValue) {
    const t = tokeniseText(rawValue, doc.org_id);
    storedValue = t.text;
    await storeEntries(admin, doc.org_id, id, t.entries);
  }

  const { data: updated } = await supabase
    .from("fields")
    .update({
      value: storedValue,
      version: version + 1,
      validation_status: validation.status,
      validation_errors: validation.errors,
      is_draft: true,
      updated_by: auth.user.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", fieldId)
    .eq("document_id", id)
    .eq("version", version)
    .select(FIELD_COLUMNS)
    .maybeSingle();

  if (!updated) {
    const { data: current } = await supabase.from("fields").select(FIELD_COLUMNS).eq("id", fieldId).single();
    return NextResponse.json({ error: "Version conflict", current }, { status: 409 });
  }

  await admin.from("audit_log").insert({
    org_id: doc.org_id,
    actor_id: auth.user.id,
    action: "field.update",
    entity: "fields",
    entity_id: fieldId,
    // Only tokenised values are logged.
    diff: { from: field.value, to: storedValue, version: version + 1 },
  });
  return NextResponse.json({ field: updated });
}
