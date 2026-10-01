import { requireFounderPage } from "@/lib/auth";
import { Uploader } from "./uploader";
import { Notice } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function UploadPage() {
  const { supabase } = await requireFounderPage();
  const { data: rubric } = await supabase.from("rubric_versions").select("version_label").eq("is_active", true).maybeSingle();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Upload CVs</h1>
        <p className="mt-1 text-sm text-muted">PDF, DOCX or TXT, up to 10 MB each. Every file needs an explicit applied role. Uploading never contacts anyone.</p>
      </div>
      {!rubric && <Notice tone="danger" title="No active rubric">CVs will be extracted but cannot be scored until a rubric is active.</Notice>}
      <Uploader />
      <Notice tone="accent" title="What happens to a CV">
        1) The file goes to a private storage bucket. 2) Text is extracted on the server; emails, phone numbers and links are removed locally first. 3) Gemini
        extraction receives that text <em>including the name</em> (or the original file, for scanned PDFs) to separate identity from evidence. 4) Name, contact details
        and personal lines are stored in a restricted table and redacted from the evidence text. 5) Only redacted text is scored against both PM and SPM rubrics, and used for briefs
        and email drafts.
      </Notice>
    </div>
  );
}
