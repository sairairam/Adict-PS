import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { validateField } from "@/lib/schemas/validation";

// Final server-side validation, then lock the document.
export async function POST(_req: Request, ctx: RouteContext<"/api/documents/[id]/submit">) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const { data: doc } = await supabase.from("documents").select("id, org_id, status").eq("id", id).single();
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (doc.status === "submitted") return NextResponse.json({ error: "Already submitted" }, { status: 409 });
  if (doc.status !== "ready_for_review") {
    return NextResponse.json({ error: `Document is ${doc.status}, not ready for review` }, { status: 409 });
  }

  const { data: fields } = await supabase.from("fields").select("id, key, label, type, value").eq("document_id", id);
  const { data: options } = await supabase
    .from("field_options")
    .select("field_id, value")
    .in("field_id", (fields ?? []).map((f) => f.id));

  const invalid = (fields ?? []).flatMap((f) => {
    const r = validateField({
      type: f.type,
      value: f.value,
      options: (options ?? []).filter((o) => o.field_id === f.id).map((o) => o.value),
    });
    return r.status === "invalid" ? [{ id: f.id, key: f.key, label: f.label, errors: r.errors }] : [];
  });
  if (invalid.length) {
    return NextResponse.json({ error: "Some fields are invalid", invalid }, { status: 422 });
  }

  await supabase.from("fields").update({ is_draft: false }).eq("document_id", id);
  await supabase.from("documents").update({ status: "submitted" }).eq("id", id);
  await createServiceClient().from("audit_log").insert({
    org_id: doc.org_id,
    actor_id: auth.user.id,
    action: "document.submit",
    entity: "documents",
    entity_id: id,
  });
  return NextResponse.json({ status: "submitted" });
}
