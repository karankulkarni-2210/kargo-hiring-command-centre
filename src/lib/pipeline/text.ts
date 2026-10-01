import "server-only";

export type FileKind = "pdf" | "docx" | "txt" | "unknown";

export function detectKind(buf: Buffer, filename: string, mime: string | null): FileKind {
  if (buf.subarray(0, 5).toString("latin1") === "%PDF-") return "pdf";
  if (buf[0] === 0x50 && buf[1] === 0x4b && /\.docx$/i.test(filename)) return "docx";
  if (buf[0] === 0x50 && buf[1] === 0x4b && mime?.includes("wordprocessingml")) return "docx";
  if (/\.txt$/i.test(filename) || mime === "text/plain") return "txt";
  return "unknown";
}

export async function pdfText(buf: Buffer): Promise<{ text: string; pages: number }> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const doc = await getDocumentProxy(new Uint8Array(buf));
  const { text, totalPages } = await extractText(doc, { mergePages: true });
  return { text: Array.isArray(text) ? text.join("\n") : text, pages: totalPages };
}

export async function docxText(buf: Buffer): Promise<string> {
  const mammoth = await import("mammoth");
  const r = await mammoth.extractRawText({ buffer: buf });
  return r.value;
}

export function txtText(buf: Buffer): string {
  let s = buf.toString("utf8");
  if (s.includes("�")) s = buf.toString("latin1");
  return s.replace(/^﻿/, "");
}

export function meaningfulChars(s: string): number {
  return s.replace(/\s+/g, "").length;
}
