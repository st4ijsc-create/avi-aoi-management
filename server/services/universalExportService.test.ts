/**
 * Wave R2 (doc 32) — universalExportService as THE canonical render engine.
 *
 * Proves:
 *  1. The embedded Vietnamese font (Be Vietnam Pro) has full glyph coverage for
 *     Vietnamese diacritics — the "no mojibake" proof (fontkit, rigorous).
 *  2. renderReport() produces a valid, non-empty buffer with the correct MIME
 *     for each format (pdf/xlsx/csv/html).
 *  3. The PDF actually EMBEDS the VN font (FontFile2 + BeVietnamPro markers).
 *  4. Branding (company name / logo / primary color) reaches the output.
 *  5. i18n header labels differ across vi/en/zh.
 *  6. PDFKit templates (pdfTemplateService) embed the VN font too.
 */
import { describe, it, expect } from "vitest";
import * as fontkitMod from "fontkit";
import ExcelJS from "exceljs";

// fontkit is CJS — normalize the default/namespace interop across bundlers.
const fontkit: any = (fontkitMod as any).default ?? fontkitMod;
import {
  renderReport,
  generateHtmlReport,
  generateCsvReport,
  type ExportColumn,
  type RenderReportInput,
} from "./universalExportService";
import {
  getVietnameseFontBuffers,
  VN_FONT_FAMILY,
  isCjkFontAvailable,
  getCjkFontBuffers,
  CJK_FONT_FAMILY,
  containsCjk,
} from "./fontAssets";

const VN_STRING = "Kiểm tra chất lượng — Sản phẩm đạt/lỗi";

const COLUMNS: ExportColumn[] = [
  { key: "point", header: "Điểm đo" },
  { key: "result", header: "Kết quả" },
  { key: "yield", header: "Tỷ lệ", format: "percentage" },
];

const DATA = [
  { point: "Sản phẩm đạt", result: "OK", yield: 98.5 },
  { point: "Mối hàn lỗi", result: "NG", yield: 1.5 },
];

function baseInput(over: Partial<RenderReportInput> = {}): RenderReportInput {
  return {
    type: "quality_daily",
    title: "Báo cáo chất lượng",
    subtitle: "Ngày 05/07/2026",
    format: "pdf",
    locale: "vi",
    columns: COLUMNS,
    data: DATA,
    ...over,
  };
}

// ── 1. Font coverage — the no-mojibake proof ─────────────────────────────────
describe("Vietnamese font coverage", () => {
  it("Be Vietnam Pro (Regular+Bold) covers every Vietnamese glyph in the proof string", () => {
    const { regular, bold } = getVietnameseFontBuffers();
    const reg = fontkit.create(regular) as any;
    const bd = fontkit.create(bold) as any;

    const missingReg: string[] = [];
    const missingBold: string[] = [];
    for (const ch of VN_STRING) {
      if (ch === " ") continue;
      const cp = ch.codePointAt(0)!;
      if (!reg.hasGlyphForCodePoint(cp)) missingReg.push(`${ch} U+${cp.toString(16)}`);
      if (!bd.hasGlyphForCodePoint(cp)) missingBold.push(`${ch} U+${cp.toString(16)}`);
    }
    expect(missingReg).toEqual([]);
    expect(missingBold).toEqual([]);
    // Hard diacritics that WinAnsi/Helvetica lack entirely.
    for (const ch of ["ế", "ấ", "ộ", "ữ", "đ", "ỗ", "ự", "ằ"]) {
      expect(reg.hasGlyphForCodePoint(ch.codePointAt(0)!)).toBe(true);
    }
  });
});

// ── 2/3. renderReport per format ─────────────────────────────────────────────
describe("renderReport — formats", () => {
  it("pdf: valid PDF that embeds the Be Vietnam Pro font", async () => {
    const out = await renderReport(baseInput({ format: "pdf" }));
    expect(out.mimeType).toBe("application/pdf");
    expect(out.filename).toMatch(/\.pdf$/);
    expect(out.buffer.length).toBeGreaterThan(2000);
    expect(out.buffer.slice(0, 5).toString("latin1")).toBe("%PDF-");
    const bytes = out.buffer.toString("latin1");
    // Font subset is actually embedded (not a core-font reference).
    expect(bytes).toContain(VN_FONT_FAMILY);
    expect(bytes).toContain("FontFile2");
  });

  it("xlsx: valid OOXML zip with i18n header row", async () => {
    const out = await renderReport(baseInput({ format: "xlsx" }));
    expect(out.mimeType).toContain("spreadsheetml");
    expect(out.filename).toMatch(/\.xlsx$/);
    expect(out.buffer.slice(0, 2).toString("latin1")).toBe("PK"); // zip magic
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(out.buffer as any);
    const ws = wb.worksheets[0];
    const flat = JSON.stringify(ws.getSheetValues());
    expect(flat).toContain("Điểm đo"); // header text preserved
    expect(flat).toContain("Sản phẩm đạt"); // VN data preserved
  });

  it("csv: UTF-8 BOM + headers + VN data preserved", async () => {
    const out = await renderReport(baseInput({ format: "csv" }));
    expect(out.mimeType).toContain("text/csv");
    expect(out.filename).toMatch(/\.csv$/);
    const text = out.buffer.toString("utf8");
    expect(text.charCodeAt(0)).toBe(0xfeff); // BOM
    expect(text).toContain("Điểm đo");
    expect(text).toContain("Mối hàn lỗi");
  });

  it("html: standalone doc with selectable VN text (no mojibake)", async () => {
    const out = await renderReport(baseInput({ format: "html", title: VN_STRING }));
    expect(out.mimeType).toContain("text/html");
    const html = out.buffer.toString("utf8");
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain(VN_STRING); // full proof string, diacritics intact
    expect(html).toContain("Sản phẩm đạt"); // VN data row preserved
  });
});

// ── 4. Branding ──────────────────────────────────────────────────────────────
describe("renderReport — branding", () => {
  const TINY_PNG =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

  it("company name + logo appear in the PDF and HTML", async () => {
    const branding = { companyName: "Công ty ST4I", logoDataUri: TINY_PNG, primaryColor: "#0d9488" };
    const html = generateHtmlReport({
      title: "T",
      columns: COLUMNS,
      data: DATA,
      language: "vi",
      branding,
    });
    expect(html).toContain("Công ty ST4I");
    expect(html).toContain(TINY_PNG);
    expect(html).toContain("#0d9488");

    const pdf = await renderReport(baseInput({ branding }));
    expect(pdf.buffer.slice(0, 5).toString("latin1")).toBe("%PDF-");
    // A logo image XObject means the PNG was embedded into the PDF.
    expect(pdf.buffer.toString("latin1")).toContain("/Image");
  });

  it("company name appears in the XLSX banner", async () => {
    const out = await renderReport(baseInput({ format: "xlsx", branding: { companyName: "Nhà máy A" } }));
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(out.buffer as any);
    const flat = JSON.stringify(wb.worksheets[0].getSheetValues());
    expect(flat).toContain("Nhà máy A");
  });
});

// ── 5. i18n headers ──────────────────────────────────────────────────────────
describe("renderReport — i18n labels", () => {
  it("total-row label differs per locale (vi/en/zh)", () => {
    const vi = generateCsvReport({ title: "t", columns: COLUMNS, data: DATA, language: "vi" });
    // CSV has no total label; assert via HTML which renders the total label.
    const hvi = generateHtmlReport({ title: "t", columns: COLUMNS, data: DATA, language: "vi" });
    const hen = generateHtmlReport({ title: "t", columns: COLUMNS, data: DATA, language: "en" });
    const hzh = generateHtmlReport({ title: "t", columns: COLUMNS, data: DATA, language: "zh" });
    expect(hvi).toContain("Tổng cộng");
    expect(hen).toContain("Total");
    expect(hzh).toContain("总计");
    expect(vi.length).toBeGreaterThan(0);
  });
});

// ── 6. renderer='premium' guard ──────────────────────────────────────────────
describe("renderReport — premium guard", () => {
  it("rejects renderer='premium' for pdf with a pointer to the puppeteer path", async () => {
    await expect(renderReport(baseInput({ renderer: "premium", format: "pdf" }))).rejects.toThrow(/renderPremiumNgVisualPdf/);
  });
});

// ── 7. PDFKit templates embed the VN font ────────────────────────────────────
describe("pdfTemplateService — VN font embedding", () => {
  it("quality report PDF embeds Be Vietnam Pro", async () => {
    const { generateQualityReportPDF } = await import("./pdfTemplateService");
    const buf = await generateQualityReportPDF(
      {
        period: { start: new Date("2026-07-01"), end: new Date("2026-07-05") },
        summary: { totalInspections: 100, okCount: 95, ngCount: 5, ntfCount: 0, yieldRate: 95, ngRate: 5 },
        byMachine: [{ machineName: "Máy hàn số 1", machineCode: "M-01", totalInspections: 100, okCount: 95, ngCount: 5, yieldRate: 95 }],
        topNGPoints: [{ pointName: "Mối hàn lỗi", ngCount: 5, percentage: 100 }],
        dailyTrend: [{ date: "2026-07-05", totalInspections: 100, okCount: 95, ngCount: 5, yieldRate: 95 }],
      },
      { title: "Báo cáo chất lượng", companyName: "Công ty ST4I" }
    );
    expect(buf.slice(0, 5).toString("latin1")).toBe("%PDF-");
    expect(buf.toString("latin1")).toContain("BeVietnamPro");
  });
});

// ── 8. CJK (Noto Sans SC) — the no-tofu proof (doc 48 R4) ─────────────────────
// CJK strings are built from codepoints (String.fromCodePoint) to avoid literal
// ideographs in the source file. Skips when the (large) CJK font isn't installed.
describe("CJK font — Chinese (zh) PDF renders real glyphs, not tofu", () => {
  const cp = (...c: number[]) => String.fromCodePoint(...c);
  // 报告质量生成时间产品总计记录
  const ZH_PROOF = cp(
    0x62a5, 0x544a, 0x8d28, 0x91cf, 0x751f, 0x6210, 0x65f6, 0x95f4, 0x4ea7, 0x54c1, 0x603b, 0x8ba1, 0x8bb0, 0x5f55,
  );

  it("containsCjk flags Chinese and ignores Latin/Vietnamese", () => {
    expect(containsCjk(ZH_PROOF)).toBe(true);
    expect(containsCjk(cp(0xff21))).toBe(true); // fullwidth A
    expect(containsCjk("Report 2026")).toBe(false);
    expect(containsCjk("Ki" + cp(0x1ec3) + "m tra")).toBe(false); // Kiểm tra
    expect(containsCjk("")).toBe(false);
  });

  it.skipIf(!isCjkFontAvailable())("Noto Sans SC (Regular+Bold) covers every CJK proof glyph", () => {
    const bufs = getCjkFontBuffers()!;
    const reg = fontkit.create(bufs.regular) as any;
    const bd = fontkit.create(bufs.bold) as any;
    const missing: string[] = [];
    for (const ch of ZH_PROOF) {
      const c = ch.codePointAt(0)!;
      if (!reg.hasGlyphForCodePoint(c)) missing.push(`U+${c.toString(16)}`);
      expect(bd.hasGlyphForCodePoint(c)).toBe(true);
    }
    expect(missing).toEqual([]);
  });

  it.skipIf(!isCjkFontAvailable())("zh PDF embeds Noto Sans SC as a CID subset (not core-font tofu)", async () => {
    const cols: ExportColumn[] = [
      { key: "p", header: cp(0x4ea7, 0x54c1) }, // 产品
      { key: "r", header: cp(0x7ed3, 0x679c) }, // 结果
    ];
    const data = [{ p: cp(0x4e3b, 0x677f), r: cp(0x5408, 0x683c) }]; // 主板 / 合格
    const out = await renderReport({
      type: "q",
      title: cp(0x8d28, 0x91cf, 0x62a5, 0x544a), // 质量报告
      format: "pdf",
      locale: "zh",
      columns: cols,
      data,
    });
    expect(out.buffer.slice(0, 5).toString("latin1")).toBe("%PDF-");
    const bytes = out.buffer.toString("latin1");
    expect(bytes).toContain(CJK_FONT_FAMILY); // Noto Sans SC embedded …
    expect(bytes).toContain("FontFile2"); // … as an actual embedded subset …
    expect(bytes).toContain("CIDFontType2"); // … as a CID font (multi-byte CJK).
  });

  it.skipIf(!isCjkFontAvailable())("vi PDF does NOT carry the CJK font (no bloat regression)", async () => {
    const out = await renderReport({
      type: "q",
      title: "B" + cp(0x00e1) + "o c" + cp(0x00e1) + "o", // Báo cáo
      format: "pdf",
      locale: "vi",
      columns: [{ key: "p", header: "S" + cp(0x1ea3) + "n ph" + cp(0x1ea9) + "m" }], // Sản phẩm
      data: [{ p: "PCB-01" }],
    });
    const bytes = out.buffer.toString("latin1");
    expect(bytes).toContain(VN_FONT_FAMILY);
    expect(bytes).not.toContain(CJK_FONT_FAMILY); // CJK font never registered for a pure-VN report
  });
});
