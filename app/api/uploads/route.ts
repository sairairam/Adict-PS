import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { uploadRequestSchema } from "@/lib/schemas/upload";

// Validates metadata, creates the documents row and returns a signed upload URL.
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const parsed = uploadRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid upload", issues: parsed.error.issues }, { status: 400 });
  }
  const { filename, mimeType, sizeBytes } = parsed.data;

  const { data: membership } = await supabase
    .from("org_members")
    .select("org_id")
    .eq("user_id", auth.user.id)
    .limit(1)
    .single();
  if (!membership) return NextResponse.json({ error: "No organisation" }, { status: 403 });

  const documentId = crypto.randomUUID();
  const ext = filename.slice(filename.lastIndexOf(".")).toLowerCase();
  const storagePath = `${membership.org_id}/${documentId}/original${ext}`;

  const { error: insertError } = await supabase.from("documents").insert({
    id: documentId,
    org_id: membership.org_id,
    filename,
    storage_path: storagePath,
    mime_type: mimeType,
    size_bytes: sizeBytes,
  });
  if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });

  const { data: signed, error: signError } = await createServiceClient()
    .storage.from("documents")
    .createSignedUploadUrl(storagePath);
  if (signError) return NextResponse.json({ error: signError.message }, { status: 500 });

  return NextResponse.json({
    documentId,
    path: signed.path,
    token: signed.token,
  });
}
