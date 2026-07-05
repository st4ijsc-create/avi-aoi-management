/**
 * Wave R5 (doc 32 §2 P3 #17) — PDFKit logo / letterhead drawing.
 *
 * Proves the logo path added to pdfTemplateService:
 *  1. resolveLogoBuffer decodes a data: URI, rejects non-images / non-http / empty.
 *  2. When a valid logo is configured, the PDFKit builders embed an image XObject
 *     (`/Image`) into the header.
 *  3. When no logo (or a broken logo) is configured, the report still renders a
 *     valid PDF name-only — never crashes (best-effort fallback).
 */
import { describe, it, expect, vi } from "vitest";
// @ts-ignore - pdfkit ships no bundled type declarations
import PDFDocument from "pdfkit";
import {
  generateQualityReportPDF,
  generateInspectionReportPDF,
  resolveLogoBuffer,
  type QualityReportData,
  type InspectionReportData,
} from "./pdfTemplateService";

// 1×1 transparent PNG (valid image PDFKit can embed).
const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

const QUALITY: QualityReportData = {
  period: { start: new Date("2026-07-01"), end: new Date("2026-07-05") },
  summary: { totalInspections: 100, okCount: 95, ngCount: 5, ntfCount: 0, yieldRate: 95, ngRate: 5 },
  byMachine: [
    { machineName: "Máy hàn số 1", machineCode: "M-01", totalInspections: 100, okCount: 95, ngCount: 5, yieldRate: 95 },
  ],
  topNGPoints: [{ pointName: "Mối hàn lỗi", ngCount: 5, percentage: 100 }],
  dailyTrend: [{ date: "2026-07-05", totalInspections: 100, okCount: 95, ngCount: 5, yieldRate: 95 }],
};

const INSPECTION: InspectionReportData = {
  inspection: {
    id: 1,
    serialNumber: "INS-1",
    overallResult: "OK",
    inspectionTime: new Date("2026-07-05T08:00:00Z"),
    machineName: "Máy hàn",
    machineCode: "M-01",
  },
  measurements: [{ pointName: "Điểm 1", measurementType: "VISUAL", result: "OK" }],
};

// ── 1. resolveLogoBuffer ─────────────────────────────────────────────────────
describe("resolveLogoBuffer", () => {
  it("decodes a base64 image data URI into a non-empty Buffer", async () => {
    const buf = await resolveLogoBuffer(TINY_PNG);
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf!.length).toBeGreaterThan(0);
    // PNG magic bytes.
    expect(buf!.slice(0, 4).toString("latin1")).toBe("\x89PNG");
  });

  it("returns undefined for empty / null / undefined input", async () => {
    expect(await resolveLogoBuffer(undefined)).toBeUndefined();
    expect(await resolveLogoBuffer(null)).toBeUndefined();
    expect(await resolveLogoBuffer("")).toBeUndefined();
  });

  it("rejects a non-image data URI", async () => {
    expect(await resolveLogoBuffer("data:text/plain;base64,aGVsbG8=")).toBeUndefined();
  });

  it("rejects a non-http, non-data string (no local file access)", async () => {
    expect(await resolveLogoBuffer("logo.png")).toBeUndefined();
    expect(await resolveLogoBuffer("ftp://host/logo.png")).toBeUndefined();
    expect(await resolveLogoBuffer("/etc/passwd")).toBeUndefined();
  });
});

// ── 2. Logo drawn when configured (spy on PDFKit's image()) ───────────────────
// NOTE: byte-scanning for "/Image" is unreliable — the embedded VN font subset is
// binary and coincidentally contains that token. Spying on doc.image() is the
// robust discriminator and directly proves the draw path (doc 32 §2 P3 #17).
describe("PDFKit letterhead logo", () => {
  it("quality report calls doc.image() and embeds the logo when configured", async () => {
    const spy = vi.spyOn(PDFDocument.prototype as any, "image");
    try {
      const buf = await generateQualityReportPDF(QUALITY, {
        title: "Báo cáo chất lượng",
        companyName: "Công ty ST4I",
        logoUrl: TINY_PNG,
        footerText: "© 2026 ST4I",
      });
      expect(buf.slice(0, 5).toString("latin1")).toBe("%PDF-");
      // doc.image() is called exactly once (the header logo) with the decoded buffer.
      expect(spy).toHaveBeenCalledTimes(1);
      expect(Buffer.isBuffer(spy.mock.calls[0][0])).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it("inspection report calls doc.image() when a logo is configured", async () => {
    const spy = vi.spyOn(PDFDocument.prototype as any, "image");
    try {
      const buf = await generateInspectionReportPDF(INSPECTION, {
        title: "Báo cáo kiểm tra",
        companyName: "Công ty ST4I",
        logoUrl: TINY_PNG,
      });
      expect(buf.slice(0, 5).toString("latin1")).toBe("%PDF-");
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  // ── 3. Name-only fallback (no logo / broken logo) ──────────────────────────
  it("does NOT call doc.image() and renders name-only when no logo is configured", async () => {
    const spy = vi.spyOn(PDFDocument.prototype as any, "image");
    try {
      const buf = await generateQualityReportPDF(QUALITY, { title: "Báo cáo chất lượng", companyName: "Công ty ST4I" });
      expect(buf.slice(0, 5).toString("latin1")).toBe("%PDF-");
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it("falls back to a valid name-only PDF (never crashes) when the logo bytes are not a decodable image", async () => {
    // A well-formed data URI whose payload is NOT a decodable PNG → doc.image()
    // throws, caught by drawHeaderLogo → the report still renders.
    const buf = await generateQualityReportPDF(QUALITY, {
      title: "Báo cáo chất lượng",
      companyName: "Công ty ST4I",
      logoUrl: "data:image/png;base64,AAAAAAAA",
    });
    expect(buf.slice(0, 5).toString("latin1")).toBe("%PDF-");
    expect(buf.length).toBeGreaterThan(1000);
  });
});
