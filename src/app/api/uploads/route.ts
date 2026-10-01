import { z } from "zod";
import { HttpError, withFounder } from "@/lib/auth";
import { supabaseAnonKey } from "@/lib/env";

export const runtime = "nodejs";

const ALLOWED: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain",
};
const MAX_BYTES = 10 * 1024 * 1024;

const Body = z.object({
  files: z
    .array(
      z.object({
        name: z.string().min(1).max(240),
        size: z.number().int().positive(),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
        role: z.enum(["PM", "SPM"]),
        synthetic: z.boolean().optional(),
      }),
    )
    .min(1)
    .max(60),
});

/**
 * Step 1 of upload: register each file (explicit applied role required), reject duplicates,
 * and hand back a short-lived signed upload URL for the private bucket. Nothing is processed yet.
 */
export async function POST(req: Request) {
  return withFounder(async ({ supabase, email }) => {
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "Each file needs a name, size, SHA-256 and an applied role (PM or SPM).");
    const out = [];
    for (const f of parsed.data.files) {
      const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
      if (!ALLOWED[ext]) {
        out.push({ name: f.name, ok: false, error: "Unsupported type — upload PDF, DOCX or TXT." });
        continue;
      }
      if (f.size > MAX_BYTES) {
        out.push({ name: f.name, ok: false, error: "File is larger than 10 MB." });
        continue;
      }
      const { data: dup } = await supabase
        .from("candidates")
        .select("id, status, applied_role")
        .eq("file_sha256", f.sha256)
        .neq("status", "duplicate")
        .limit(1);
      if (dup?.length) {
        const d = dup[0];
        if (d.status === "awaiting_upload") {
          // A previous attempt registered but never finished uploading: resume it.
          const { data: c } = await supabase.from("candidates").select("file_path").eq("id", d.id).single();
          const signed = await supabase.storage.from("cvs").createSignedUploadUrl(c!.file_path!, { upsert: true });
          if (signed.error) {
            out.push({ name: f.name, ok: false, error: signed.error.message });
            continue;
          }
          out.push({ name: f.name, ok: true, candidateId: d.id, signedUrl: signed.data.signedUrl, resumed: true });
          continue;
        }
        out.push({ name: f.name, ok: false, duplicate: true, duplicateOf: d.id, error: "Duplicate — this exact file is already in the system." });
        continue;
      }
      const id = crypto.randomUUID();
      const safe = f.name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(-120);
      const path = `${id}/${safe}`;
      const { error } = await supabase.from("candidates").insert({
        id,
        applied_role: f.role,
        status: "awaiting_upload",
        original_filename: f.name,
        file_path: path,
        file_mime: ALLOWED[ext],
        file_size: f.size,
        file_sha256: f.sha256,
        is_synthetic: Boolean(f.synthetic) || /synthetic/i.test(f.name),
      });
      if (error) {
        out.push({ name: f.name, ok: false, error: error.code === "23505" ? "Duplicate — this exact file is already in the system." : error.message });
        continue;
      }
      const signed = await supabase.storage.from("cvs").createSignedUploadUrl(path, { upsert: true });
      if (signed.error) {
        out.push({ name: f.name, ok: false, candidateId: id, error: `Could not create upload URL: ${signed.error.message}` });
        continue;
      }
      out.push({ name: f.name, ok: true, candidateId: id, signedUrl: signed.data.signedUrl });
    }
    await supabase.from("audit_log").insert({ actor: email, action: "upload_registered", entity: "candidates", details: { count: out.filter((o) => o.ok).length } });
    // The publishable/anon key is public by design; the signed URL token is what authorises the upload.
    return { files: out, apiKey: supabaseAnonKey() };
  });
}
