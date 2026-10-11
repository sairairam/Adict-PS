"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/browser";
import { ACCEPTED_TYPES, MAX_UPLOAD_BYTES } from "@/lib/schemas/upload";

type Item = { name: string; state: "uploading" | "done" | "error"; message?: string };

const ACCEPT = Object.entries(ACCEPTED_TYPES).flatMap(([mime, exts]) => [mime, ...exts]).join(",");

export function UploadDropzone() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [dragging, setDragging] = useState(false);

  const update = (name: string, patch: Partial<Item>) =>
    setItems((list) => list.map((i) => (i.name === name ? { ...i, ...patch } : i)));

  async function upload(file: File) {
    setItems((list) => [...list, { name: file.name, state: "uploading" }]);
    try {
      if (file.size > MAX_UPLOAD_BYTES) throw new Error("File exceeds 25 MB");
      const res = await fetch("/api/uploads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, mimeType: file.type, sizeBytes: file.size }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.issues?.[0]?.message ?? body.error ?? "Upload rejected");

      const { error } = await createClient()
        .storage.from("documents")
        .uploadToSignedUrl(body.path, body.token, file);
      if (error) throw error;

      const proc = await fetch(`/api/documents/${body.documentId}/process`, { method: "POST" });
      if (!proc.ok) throw new Error((await proc.json()).error ?? "Processing failed to start");

      update(file.name, { state: "done" });
      router.refresh();
    } catch (e) {
      update(file.name, { state: "error", message: e instanceof Error ? e.message : "Upload failed" });
    }
  }

  const handleFiles = (files: FileList | null) => files && Array.from(files).forEach(upload);

  return (
    <section>
      <div
        role="button"
        tabIndex={0}
        onClick={() => input.current?.click()}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files); }}
        className={`cursor-pointer rounded-lg border-2 border-dashed p-10 text-center ${dragging ? "border-black bg-gray-100" : "border-gray-300"}`}
      >
        <p className="font-medium">Drop files here or click to browse</p>
        <p className="text-sm text-gray-600">PDF, Word, PNG, JPEG, TIFF, WebP. Up to 25 MB.</p>
        <input ref={input} type="file" multiple accept={ACCEPT} hidden onChange={(e) => handleFiles(e.target.files)} />
      </div>
      <ul className="mt-3 space-y-1 text-sm" aria-live="polite">
        {items.map((i, idx) => (
          <li key={idx} className={i.state === "error" ? "text-red-700" : ""}>
            {i.name}: {i.state === "uploading" ? "Uploading..." : i.state === "done" ? "Queued" : i.message}
          </li>
        ))}
      </ul>
    </section>
  );
}
