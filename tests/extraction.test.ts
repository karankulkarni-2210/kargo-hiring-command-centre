import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { detectKind, docxText, meaningfulChars, pdfText, txtText } from "@/lib/pipeline/text";

const f = (n: string) => readFileSync(`fixtures/synthetic-cvs/${n}`);

describe("local text extraction (before any AI call)", () => {
  it("reads a text-layer PDF", async () => {
    const buf = f("SYNTHETIC_text_PDF_PM_Kiran_Desai.pdf");
    expect(detectKind(buf, "x.pdf", "application/pdf")).toBe("pdf");
    const { text } = await pdfText(buf);
    expect(text).toContain("Killed the");
    expect(meaningfulChars(text)).toBeGreaterThan(200);
  });
  it("detects a scanned / image-only PDF (routes to the disclosed Gemini OCR path)", async () => {
    const { text } = await pdfText(f("SYNTHETIC_scanned_image_only_SPM_Sameer_Joshi.pdf"));
    expect(meaningfulChars(text)).toBeLessThan(200);
  });
  it("reads DOCX and TXT", async () => {
    const buf = f("SYNTHETIC_docx_SPM_Farah_Khan.docx");
    expect(detectKind(buf, "a.docx", null)).toBe("docx");
    expect(await docxText(buf)).toContain("EDI connector");
    expect(txtText(f("SYNTHETIC_weak_SPM_Rohit_Kale.txt"))).toContain("Associate Product Manager");
  });
  it("rejects unknown formats", () => {
    expect(detectKind(Buffer.from("GIF89a"), "x.gif", "image/gif")).toBe("unknown");
  });
});
