import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { decryptValue } from "@/lib/pii/vault";

const body = z.object({ token: z.string().regex(/^\[(EMAIL|PHONE)_[0-9a-f]{12}\]$/) });

// Role-gated detokenisation. Every reveal is audited.
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid token" }, { status: 400 });

  const admin = createServiceClient();
  const { data: row } = await admin
    .from("pii_vault")
    .select("org_id, encrypted_value, document_id")
    .eq("token", parsed.data.token)
    .maybeSingle();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: member } = await admin
    .from("org_members")
    .select("role")
    .eq("org_id", row.org_id)
    .eq("user_id", auth.user.id)
    .maybeSingle();
  if (!member || !["admin", "reviewer"].includes(member.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await admin.from("audit_log").insert({
    org_id: row.org_id,
    actor_id: auth.user.id,
    action: "pii.reveal",
    entity: "pii_vault",
    entity_id: parsed.data.token,
    diff: { document_id: row.document_id },
  });
  return NextResponse.json({ value: decryptValue(row.encrypted_value) });
}
