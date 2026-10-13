import { Suspense } from "react";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "../(auth)/login/actions";
import { UploadDropzone } from "@/components/UploadDropzone";

export default function DocumentsPage() {
  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Documents</h1>
        <form action={signOut}>
          <button className="text-sm underline">Sign out</button>
        </form>
      </header>
      <UploadDropzone />
      <Suspense fallback={<p className="text-sm text-gray-600">Loading...</p>}>
        <DocumentTable />
      </Suspense>
    </main>
  );
}

async function DocumentTable() {
  await connection(); // per-request data (session, timestamps): never prerender
  const supabase = await createClient();
  const { data: documents } = await supabase
    .from("documents")
    .select("id, filename, status, created_at")
    .order("created_at", { ascending: false });

  return (
    <table className="w-full text-left text-sm">
      <thead>
        <tr className="border-b"><th className="py-2">File</th><th>Status</th><th>Uploaded</th></tr>
      </thead>
      <tbody>
        {documents?.map((d) => (
          <tr key={d.id} className="border-b">
            <td className="py-2">{d.filename}</td>
            <td>{d.status}</td>
            <td>{new Date(d.created_at).toLocaleString()}</td>
          </tr>
        ))}
        {!documents?.length && (
          <tr><td colSpan={3} className="py-4 text-gray-600">No documents yet.</td></tr>
        )}
      </tbody>
    </table>
  );
}
