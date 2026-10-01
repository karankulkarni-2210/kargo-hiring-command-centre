import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(f) ? [p] : [];
  });
}
const files = walk("src");

describe("no email can be sent outside the explicit Confirm-to-Send path", () => {
  it("only the send route and the settings integration test import the Resend transport", () => {
    const importers = files.filter((f) => /from\s+["']@\/lib\/email\/resend["']|from\s+["']\.\.?\/.*email\/resend["']/.test(readFileSync(f, "utf8")));
    expect(importers.sort()).toEqual(["src/app/api/emails/send/route.ts", "src/app/api/settings/test-email/route.ts"]);
  });
  it("nothing else calls the Resend API", () => {
    const callers = files.filter((f) => readFileSync(f, "utf8").includes("api.resend.com"));
    expect(callers).toEqual(["src/lib/email/resend.ts"]);
  });
  it("upload, processing, scoring, ranking and decision code never touch email sending", () => {
    for (const f of files.filter((x) => /pipeline|uploads|process|cron|decision|rubric/.test(x))) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/sendViaResend|email_sends/);
    }
  });
  it("the send route requires an explicit confirm flag", () => {
    const src = readFileSync("src/app/api/emails/send/route.ts", "utf8");
    expect(src).toContain("confirm: z.literal(true)");
    expect(src).toContain("checkSendEligibility");
  });
});

describe("secrets stay server-side", () => {
  it("no client component reads server secrets", () => {
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      if (!src.startsWith('"use client"')) continue;
      expect(src, f).not.toMatch(/GEMINI_API_KEY|RESEND_API_KEY|SERVICE_ROLE|process\.env/);
    }
  });
  it(".env.local is git-ignored and .env.example is committed", () => {
    const gi = readFileSync(".gitignore", "utf8");
    expect(gi).toMatch(/^\.env\*$/m);
    expect(gi).toMatch(/^!\.env\.example$/m);
  });
});
