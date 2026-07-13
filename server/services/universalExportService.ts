/**
 * Universal Data Export Service — THE canonical server render engine (doc 32
 * Wave R2, decision #2). Every on-demand/scheduled tabular report renders
 * through `renderReport()` here: PDF (jsPDF+autotable), XLSX (exceljs), CSV,
 * HTML — one API, i18n vi/en/zh, an embedded Vietnamese font so PDFs no longer
 * mojibake diacritics, and branding (company name / logo / colors) pulled from
 * the company profile.
 *
 * Puppeteer stays as the OPTIONAL premium renderer for complex HTML-layout
 * reports (reportGenerator.generateNGVisualPDF) — see `renderPremiumNgVisualPdf`
 * and the RenderReportInput.renderer hint. This module never rips it out.
 *
 * W5-D (doc 27 §6 A10): also hosts the PURE streaming-CSV/JSON primitives the
 * /api/export + /api/bi routes use (csvEscape / toCsvLine / rowToCsvLine /
 * jsonStreamChunk) — kept here so they are unit-testable without express.
 */
import ExcelJS from "exceljs";
import {
  VN_FONT_FAMILY,
  registerVietnameseFontJsPDF,
  registerCjkFontJsPDF,
  containsCjk,
  cjkFontUnavailableMessage,
} from "./fontAssets";

export interface ExportColumn {
  key: string;
  header: string;
  width?: number;
  format?: "number" | "percentage" | "date" | "datetime" | "text";
}

/** Report locale — drives header labels + number/date formatting. */
export type ReportLocale = "vi" | "en" | "zh";

/** Output container format. PPTX stays on its own path (decision #6). */
export type ReportFormat = "pdf" | "xlsx" | "csv" | "html";

/**
 * Branding pulled from the company profile (`email_template_config`, resolved by
 * `resolveBranding()`). `logoDataUri` is an embeddable data: URI (PDF header /
 * HTML header); `primaryColor` themes titles + table headers.
 */
export interface ReportBranding {
  companyName?: string | null;
  logoDataUri?: string | null;
  primaryColor?: string | null;
  footerText?: string | null;
}

export interface ExportOptions {
  title: string;
  subtitle?: string;
  columns: ExportColumn[];
  data: Record<string, any>[];
  language?: ReportLocale;
  fileName?: string;
  sheetName?: string;
  includeTimestamp?: boolean;
  companyName?: string;
  logoPath?: string;
  /** Branding (company name/logo/colors). Overrides companyName when present. */
  branding?: ReportBranding;
}

const LANGUAGE_LABELS: Record<string, Record<string, string>> = {
  vi: {
    generatedAt: "Tạo lúc",
    page: "Trang",
    total: "Tổng cộng",
    records: "bản ghi",
    company: "Công ty",
    report: "Báo cáo",
    noData: "Không có dữ liệu",
  },
  en: {
    generatedAt: "Generated at",
    page: "Page",
    total: "Total",
    records: "records",
    company: "Company",
    report: "Report",
    noData: "No data",
  },
  zh: {
    generatedAt: "生成时间",
    page: "页",
    total: "总计",
    records: "记录",
    company: "公司",
    report: "报告",
    noData: "无数据",
  },
};

// ─── Small helpers ───────────────────────────────────────────────────────────

const DEFAULT_PRIMARY = "#1E3A5F";

function localeTag(language: ReportLocale): string {
  return language === "zh" ? "zh-CN" : language === "en" ? "en-US" : "vi-VN";
}

/** #RRGGBB (or #RGB) → [r,g,b]; falls back to the brand navy on bad input. */
function hexToRgb(hex?: string | null): [number, number, number] {
  const fallback: [number, number, number] = [30, 58, 95];
  if (!hex) return fallback;
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return fallback;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** #RRGGBB → 8-hex ARGB for exceljs (opaque). */
function hexToArgb(hex?: string | null): string {
  const [r, g, b] = hexToRgb(hex);
  const to2 = (n: number) => n.toString(16).padStart(2, "0");
  return `FF${to2(r)}${to2(g)}${to2(b)}`.toUpperCase();
}

/** jsPDF image format from a data: URI (PNG default). */
function dataUriFormat(uri: string): "PNG" | "JPEG" | "WEBP" {
  const m = /^data:image\/(png|jpe?g|webp)/i.exec(uri);
  if (!m) return "PNG";
  const t = m[1].toLowerCase();
  return t.startsWith("jp") ? "JPEG" : t === "webp" ? "WEBP" : "PNG";
}

function resolveBrandingFromOptions(options: ExportOptions): ReportBranding {
  const b = options.branding ?? {};
  return {
    companyName: b.companyName ?? options.companyName ?? null,
    logoDataUri: b.logoDataUri ?? null,
    primaryColor: b.primaryColor ?? null,
    footerText: b.footerText ?? null,
  };
}

// ─── XLSX (exceljs) ──────────────────────────────────────────────────────────

/**
 * Generate an Excel report with professional formatting + i18n headers and
 * branding (company name banner, brand-colored header row).
 */
export async function generateExcelReport(options: ExportOptions): Promise<Buffer> {
  const { title, subtitle, columns, data, language = "vi", sheetName = "Report", includeTimestamp = true } = options;
  const labels = LANGUAGE_LABELS[language] || LANGUAGE_LABELS.vi;
  const branding = resolveBrandingFromOptions(options);
  const headerArgb = hexToArgb(branding.primaryColor || DEFAULT_PRIMARY);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = branding.companyName || "SYNAPSE";
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet(sheetName);
  const lastCol = Math.max(1, columns.length);

  // Company banner (branding)
  if (branding.companyName) {
    const cRow = worksheet.addRow([`${labels.company}: ${branding.companyName}`]);
    cRow.font = { size: 11, bold: true, color: { argb: headerArgb } };
    worksheet.mergeCells(worksheet.rowCount, 1, worksheet.rowCount, lastCol);
  }

  // Title row
  const titleRow = worksheet.addRow([title]);
  titleRow.font = { size: 16, bold: true, color: { argb: headerArgb } };
  titleRow.height = 30;
  worksheet.mergeCells(worksheet.rowCount, 1, worksheet.rowCount, lastCol);
  titleRow.alignment = { horizontal: "center", vertical: "middle" };

  // Subtitle
  if (subtitle) {
    const subRow = worksheet.addRow([subtitle]);
    subRow.font = { size: 12, italic: true, color: { argb: "FF666666" } };
    worksheet.mergeCells(worksheet.rowCount, 1, worksheet.rowCount, lastCol);
    subRow.alignment = { horizontal: "center" };
  }

  // Timestamp
  if (includeTimestamp) {
    const row = worksheet.addRow([`${labels.generatedAt}: ${new Date().toLocaleString(localeTag(language))}`]);
    row.font = { size: 10, color: { argb: "FF999999" } };
    worksheet.mergeCells(worksheet.rowCount, 1, worksheet.rowCount, lastCol);
  }

  // Empty row
  worksheet.addRow([]);

  // Header row
  const headerRow = worksheet.addRow(columns.map((c) => c.header));
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  headerRow.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: headerArgb } };
    cell.border = {
      top: { style: "thin" },
      bottom: { style: "thin" },
      left: { style: "thin" },
      right: { style: "thin" },
    };
    cell.alignment = { horizontal: "center", vertical: "middle" };
  });
  headerRow.height = 25;

  // Set column widths
  columns.forEach((col, i) => {
    worksheet.getColumn(i + 1).width = col.width || 15;
  });

  // Data rows
  data.forEach((item, rowIndex) => {
    const rowData = columns.map((col) => {
      const value = item[col.key];
      if (value === null || value === undefined) return "";
      if (col.format === "percentage") return typeof value === "number" ? value / 100 : value;
      if (col.format === "date" && value instanceof Date) return value;
      if (col.format === "datetime" && value instanceof Date) return value;
      return value;
    });

    const row = worksheet.addRow(rowData);
    const isEven = rowIndex % 2 === 0;

    row.eachCell((cell, colNumber) => {
      cell.border = { bottom: { style: "thin", color: { argb: "FFE0E0E0" } } };
      if (isEven) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8F9FA" } };
      }
      const col = columns[colNumber - 1];
      if (col?.format === "percentage") cell.numFmt = "0.00%";
      else if (col?.format === "number") cell.numFmt = "#,##0";
      else if (col?.format === "date") cell.numFmt = "DD/MM/YYYY";
      else if (col?.format === "datetime") cell.numFmt = "DD/MM/YYYY HH:mm:ss";
    });
  });

  // Total row
  const totalRow = worksheet.addRow([`${labels.total}: ${data.length} ${labels.records}`]);
  totalRow.font = { bold: true, italic: true };
  worksheet.mergeCells(worksheet.rowCount, 1, worksheet.rowCount, lastCol);

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

// ─── PDF (jsPDF + autotable, embedded Be Vietnam Pro) ────────────────────────

/**
 * Build the jsPDF document (shared by the base64 + Buffer entrypoints). The
 * Vietnamese font is registered and set active BEFORE any text is drawn, so
 * titles/headers/cells all render correct diacritics.
 */
async function buildReportPdfDoc(options: ExportOptions): Promise<any> {
  // jsPDF v4's ESM `default` export is a namespace object, not the constructor,
  // under Node — resolve the actual constructor across bundlers/runtimes.
  const jspdfMod: any = await import("jspdf");
  const jsPDF: any = jspdfMod.jsPDF ?? jspdfMod.default?.jsPDF ?? jspdfMod.default;
  const autotableMod: any = await import("jspdf-autotable");
  const autoTable: any = autotableMod.default ?? autotableMod.autoTable ?? autotableMod;

  const { title, subtitle, columns, data, language = "vi", includeTimestamp = true } = options;
  const labels = LANGUAGE_LABELS[language] || LANGUAGE_LABELS.vi;
  const branding = resolveBrandingFromOptions(options);
  const [pr, pg, pb] = hexToRgb(branding.primaryColor || DEFAULT_PRIMARY);

  const doc = new jsPDF({ orientation: data.length > 0 && columns.length > 6 ? "landscape" : "portrait" });

  // Register + activate the embedded Vietnamese font (fixes mojibake — P0 #4).
  registerVietnameseFontJsPDF(doc);

  // doc 48 R4 — Chinese text needs the CJK font (Noto Sans SC); Be Vietnam Pro
  // has no ideograph glyphs and renders them as tofu. jsPDF EMBEDS every font it
  // is handed (no tree-shaking of unused fonts), so we register the ~10 MB CJK
  // font ONLY when this document actually contains CJK — a pure vi/en report is
  // byte-for-byte unchanged (no CJK-font bloat). The zh locale always qualifies
  // (its header labels are Chinese); otherwise we scan the real content.
  const docHasCjk =
    language === "zh" ||
    containsCjk(title) ||
    containsCjk(subtitle) ||
    containsCjk(branding.companyName) ||
    columns.some((c) => containsCjk(c.header)) ||
    data.some((row) => columns.some((c) => containsCjk(row[c.key] == null ? "" : String(row[c.key]))));

  let cjkFamily: string | null = null;
  if (docHasCjk) {
    // Registered but left INACTIVE; `pickFont` swaps it in per text run wherever
    // CJK codepoints appear (autotable does it per cell below).
    cjkFamily = registerCjkFontJsPDF(doc);
    if (!cjkFamily) {
      if (language === "zh") {
        // A Chinese report is CJK end-to-end (labels + data) — never emit a tofu PDF.
        throw new Error(cjkFontUnavailableMessage());
      }
      // vi/en report with incidental CJK (e.g. a Chinese supplier name): don't break
      // the whole report, but don't silently tofu either — warn with the fix.
      console.warn(
        "[universalExportService] CJK content detected but the CJK font is not " +
          "installed; those glyphs will be blank. Run `node scripts/fetch-fonts.mjs`.",
      );
    }
  }

  /** Font family for a text run: the CJK font when the run has CJK + it is loaded. */
  const pickFont = (text: string): string =>
    cjkFamily && containsCjk(text) ? cjkFamily : VN_FONT_FAMILY;

  const pageWidth = doc.internal.pageSize.width;
  let yPos = 20;

  // Branding logo (top-right), best-effort — never let a bad logo break the PDF.
  if (branding.logoDataUri) {
    try {
      doc.addImage(branding.logoDataUri, dataUriFormat(branding.logoDataUri), pageWidth - 54, 10, 40, 14);
    } catch {
      /* ignore unrenderable logo */
    }
  }

  // Title
  doc.setFont(pickFont(title), "bold");
  doc.setFontSize(18);
  doc.setTextColor(pr, pg, pb);
  doc.text(title, pageWidth / 2, yPos, { align: "center" });
  doc.setFont(VN_FONT_FAMILY, "normal");
  yPos = 28;

  if (subtitle) {
    doc.setFont(pickFont(subtitle), "normal");
    doc.setFontSize(12);
    doc.setTextColor(100, 100, 100);
    doc.text(subtitle, pageWidth / 2, yPos, { align: "center" });
    yPos += 8;
  }

  if (branding.companyName) {
    const companyLine = `${labels.company}: ${branding.companyName}`;
    doc.setFont(pickFont(companyLine), "normal");
    doc.setFontSize(10);
    doc.setTextColor(120, 120, 120);
    doc.text(companyLine, 14, yPos);
    yPos += 6;
  }

  if (includeTimestamp) {
    const tsLine = `${labels.generatedAt}: ${new Date().toLocaleString(localeTag(language))}`;
    doc.setFont(pickFont(tsLine), "normal");
    doc.setFontSize(9);
    doc.setTextColor(150, 150, 150);
    doc.text(tsLine, 14, yPos);
    yPos += 8;
  }

  // Table
  const tableColumns = columns.map((c) => ({ header: c.header, dataKey: c.key }));
  const tableData = data.map((item) => {
    const row: Record<string, any> = {};
    columns.forEach((col) => {
      const value = item[col.key];
      if (value === null || value === undefined) row[col.key] = "";
      else if (col.format === "percentage") row[col.key] = `${Number(value).toFixed(2)}%`;
      else if (col.format === "number") row[col.key] = Number(value).toLocaleString(localeTag(language));
      else if (col.format === "date" && value instanceof Date) row[col.key] = value.toLocaleDateString(localeTag(language));
      else row[col.key] = String(value);
    });
    return row;
  });

  autoTable(doc, {
    startY: yPos,
    columns: tableColumns,
    body: tableData,
    // Use the embedded VN font for every cell — bold variant on headers.
    styles: { font: VN_FONT_FAMILY, fontStyle: "normal", fontSize: 9, cellPadding: 3 },
    headStyles: {
      font: VN_FONT_FAMILY,
      fontStyle: "bold",
      fillColor: [pr, pg, pb],
      textColor: [255, 255, 255],
      halign: "center",
    },
    alternateRowStyles: { fillColor: [248, 249, 250] },
    // doc 48 R4 — swap the CJK font into any header/body cell whose text contains
    // Chinese, keeping the bold/normal style autotable already assigned. Latin/VN
    // cells stay on Be Vietnam Pro. No-op when the CJK font is not installed.
    didParseCell: (hookData: any) => {
      if (!cjkFamily) return;
      const cell = hookData.cell;
      const text = Array.isArray(cell?.text) ? cell.text.join("") : String(cell?.text ?? "");
      if (containsCjk(text)) cell.styles.font = cjkFamily;
    },
    didDrawPage: (hookData: any) => {
      const pageCount = doc.getNumberOfPages();
      doc.setFontSize(8);
      doc.setTextColor(150, 150, 150);
      const footer = branding.footerText
        ? `${branding.footerText}  ·  ${labels.page} ${hookData.pageNumber} / ${pageCount}`
        : `${labels.page} ${hookData.pageNumber} / ${pageCount}`;
      doc.setFont(pickFont(footer), "normal");
      doc.text(footer, pageWidth / 2, doc.internal.pageSize.height - 10, { align: "center" });
    },
  });

  // Total
  const finalY = (doc as any).lastAutoTable?.finalY || yPos + 20;
  const totalLine = `${labels.total}: ${data.length} ${labels.records}`;
  doc.setFont(pickFont(totalLine), "normal");
  doc.setFontSize(10);
  doc.setTextColor(80, 80, 80);
  doc.text(totalLine, 14, finalY + 10);

  return doc;
}

/**
 * Generate a PDF report using jsPDF (embedded Vietnamese font). Returns base64
 * (kept for backward compat with existing/base64 consumers).
 */
export async function generatePdfReport(options: ExportOptions): Promise<string> {
  const doc = await buildReportPdfDoc(options);
  return doc.output("datauristring").split(",")[1]; // base64 only
}

/** Same PDF, returned as a Buffer (used by the unified renderReport pipeline). */
export async function generatePdfReportBuffer(options: ExportOptions): Promise<Buffer> {
  const doc = await buildReportPdfDoc(options);
  return Buffer.from(doc.output("arraybuffer"));
}

// ─── HTML (standalone, branded, selectable text) ─────────────────────────────

function escapeHtml(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatCellForHtml(value: unknown, col: ExportColumn, language: ReportLocale): string {
  if (value === null || value === undefined) return "";
  if (col.format === "percentage") return `${Number(value).toFixed(2)}%`;
  if (col.format === "number") return Number(value).toLocaleString(localeTag(language));
  if (col.format === "date" && value instanceof Date) return value.toLocaleDateString(localeTag(language));
  if (col.format === "datetime" && value instanceof Date) return value.toLocaleString(localeTag(language));
  return String(value);
}

/** Standalone, self-contained HTML report (selectable text, branded header). */
export function generateHtmlReport(options: ExportOptions): string {
  const { title, subtitle, columns, data, language = "vi", includeTimestamp = true } = options;
  const labels = LANGUAGE_LABELS[language] || LANGUAGE_LABELS.vi;
  const branding = resolveBrandingFromOptions(options);
  const primary = branding.primaryColor || DEFAULT_PRIMARY;
  const logo = branding.logoDataUri
    ? `<img src="${escapeHtml(branding.logoDataUri)}" alt="logo" style="max-height:48px;max-width:180px;" />`
    : "";
  const companyLine = branding.companyName
    ? `<div style="font-size:13px;color:#555;font-weight:600;">${escapeHtml(branding.companyName)}</div>`
    : "";
  const timestamp = includeTimestamp
    ? `<div style="font-size:11px;color:#999;">${escapeHtml(labels.generatedAt)}: ${escapeHtml(new Date().toLocaleString(localeTag(language)))}</div>`
    : "";

  const headCells = columns.map((c) => `<th style="padding:8px 10px;border:1px solid #d0d7de;text-align:left;">${escapeHtml(c.header)}</th>`).join("");
  const bodyRows =
    data.length === 0
      ? `<tr><td colspan="${columns.length}" style="padding:16px;text-align:center;color:#999;font-style:italic;">${escapeHtml(labels.noData)}</td></tr>`
      : data
          .map((item, i) => {
            const cells = columns.map((c) => `<td style="padding:6px 10px;border:1px solid #e5e7eb;">${escapeHtml(formatCellForHtml(item[c.key], c, language))}</td>`).join("");
            return `<tr style="background:${i % 2 === 0 ? "#ffffff" : "#f8f9fa"};">${cells}</tr>`;
          })
          .join("");

  const footer = branding.footerText ? `<p style="margin:6px 0 0;">${escapeHtml(branding.footerText)}</p>` : "";

  return `<!DOCTYPE html>
<html lang="${language}">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(title)}</title>
</head>
<body style="font-family:'Be Vietnam Pro',Arial,sans-serif;color:#222;max-width:1000px;margin:0 auto;padding:24px;">
  <header style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid ${escapeHtml(primary)};padding-bottom:12px;margin-bottom:16px;">
    <div>
      ${companyLine}
      <h1 style="margin:4px 0 2px;font-size:22px;color:${escapeHtml(primary)};">${escapeHtml(title)}</h1>
      ${subtitle ? `<div style="font-size:13px;color:#666;">${escapeHtml(subtitle)}</div>` : ""}
      ${timestamp}
    </div>
    <div>${logo}</div>
  </header>
  <table style="width:100%;border-collapse:collapse;font-size:13px;">
    <thead><tr style="background:${escapeHtml(primary)};color:#fff;">${headCells}</tr></thead>
    <tbody>${bodyRows}</tbody>
  </table>
  <footer style="margin-top:16px;font-size:11px;color:#888;border-top:1px solid #eee;padding-top:8px;">
    <p style="margin:0;">${escapeHtml(labels.total)}: ${data.length} ${escapeHtml(labels.records)}</p>
    ${footer}
  </footer>
</body>
</html>`;
}

// ─── CSV (branded UTF-8 BOM for Excel, i18n header row) ───────────────────────

/** CSV bytes for the report: UTF-8 BOM + header row + data rows. */
export function generateCsvReport(options: ExportOptions): Buffer {
  const { columns, data } = options;
  const keys = columns.map((c) => c.key);
  const header = toCsvLine(columns.map((c) => c.header));
  const rows = data.map((row) => rowToCsvLine(row, keys)).join("");
  // BOM so Excel opens Vietnamese text as UTF-8.
  return Buffer.from("﻿" + header + rows, "utf8");
}

// ─── Unified render API ──────────────────────────────────────────────────────

export interface RenderReportInput {
  /** Report type id (e.g. "daily_summary") — used for the default filename. */
  type: string;
  title: string;
  subtitle?: string;
  format: ReportFormat;
  locale?: ReportLocale;
  branding?: ReportBranding;
  columns: ExportColumn[];
  data: Record<string, any>[];
  fileName?: string;
  sheetName?: string;
  includeTimestamp?: boolean;
  /**
   * "default" = this engine (jsPDF/exceljs, VN font). "premium" = puppeteer
   * (reportGenerator) for complex HTML-layout PDFs — call
   * `renderPremiumNgVisualPdf` with NG-visual data instead; passing
   * renderer:"premium" here for a pdf throws a pointer to that path.
   */
  renderer?: "default" | "premium";
}

export interface RenderReportOutput {
  buffer: Buffer;
  mimeType: string;
  filename: string;
  format: ReportFormat;
}

const MIME: Record<ReportFormat, string> = {
  pdf: "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv; charset=utf-8",
  html: "text/html; charset=utf-8",
};
const EXT: Record<ReportFormat, string> = { pdf: "pdf", xlsx: "xlsx", csv: "csv", html: "html" };

function safeFileBase(input: RenderReportInput): string {
  const raw = input.fileName || input.type || "report";
  return (
    raw
      .toString()
      .normalize("NFKD")
      .replace(/[^\w.-]+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "")
      .slice(0, 120) || "report"
  );
}

/**
 * THE canonical entrypoint. Renders `input` to a Buffer in the requested format
 * with i18n labels, an embedded Vietnamese font (PDF), and branding.
 */
export async function renderReport(input: RenderReportInput): Promise<RenderReportOutput> {
  const format = input.format;
  if (input.renderer === "premium" && format === "pdf") {
    throw new Error(
      "renderReport: renderer='premium' is the puppeteer path for complex " +
        "HTML-layout reports; call renderPremiumNgVisualPdf(ngData) instead. " +
        "renderReport is the default tabular engine."
    );
  }

  const opts: ExportOptions = {
    title: input.title,
    subtitle: input.subtitle,
    columns: input.columns,
    data: input.data,
    language: input.locale ?? "vi",
    sheetName: input.sheetName,
    includeTimestamp: input.includeTimestamp ?? true,
    branding: input.branding,
  };

  let buffer: Buffer;
  switch (format) {
    case "pdf":
      buffer = await generatePdfReportBuffer(opts);
      break;
    case "xlsx":
      buffer = await generateExcelReport(opts);
      break;
    case "csv":
      buffer = generateCsvReport(opts);
      break;
    case "html":
      buffer = Buffer.from(generateHtmlReport(opts), "utf8");
      break;
    default:
      throw new Error(`renderReport: unsupported format "${format as string}"`);
  }

  return { buffer, mimeType: MIME[format], filename: `${safeFileBase(input)}.${EXT[format]}`, format };
}

/**
 * Premium PDF renderer (opt-in) — delegates to reportGenerator's puppeteer path
 * for the NG-visual report shape. Kept as a thin, lazy delegate so puppeteer is
 * only loaded when premium is actually requested (decision #2). Does NOT modify
 * reportGenerator.
 */
export async function renderPremiumNgVisualPdf(
  ngData: import("./reportGenerator").NGVisualReportData,
  customization?: import("./reportGenerator").ReportCustomization,
  fileBase = "report"
): Promise<RenderReportOutput> {
  const { generateNGVisualPDF } = await import("./reportGenerator");
  const buffer = await generateNGVisualPDF(ngData, customization);
  return { buffer, mimeType: MIME.pdf, filename: `${fileBase}.pdf`, format: "pdf" };
}

// ─── Branding resolution (company profile) ───────────────────────────────────

/**
 * Turn a company-profile logo (URL or data URI) into an embeddable data: URI.
 * Best-effort: returns undefined on any failure (never blocks a report).
 */
export async function toLogoDataUri(url?: string | null): Promise<string | undefined> {
  if (!url) return undefined;
  if (url.startsWith("data:")) return url;
  if (!/^https?:\/\//i.test(url)) return undefined;
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 4000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(t);
    if (!res.ok) return undefined;
    const mime = res.headers.get("content-type") || "image/png";
    if (!/^image\//i.test(mime)) return undefined;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > 2_000_000) return undefined;
    return `data:${mime};base64,${buf.toString("base64")}`;
  } catch {
    return undefined;
  }
}

/**
 * Resolve report branding from the company profile (`email_template_config`
 * default row). Lazy-imports the db layer so pure-render callers/tests never
 * touch the database. Returns an empty branding object on any failure.
 */
export async function resolveBranding(): Promise<ReportBranding> {
  try {
    const db = await import("../db");
    const cfg = await db.getDefaultEmailTemplateConfig();
    if (!cfg) return {};
    return {
      companyName: cfg.companyName ?? null,
      logoDataUri: (await toLogoDataUri(cfg.logoUrl)) ?? null,
      primaryColor: cfg.primaryColor ?? null,
      footerText: cfg.footerText ?? null,
    };
  } catch {
    return {};
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// W5-D (doc 27 §6 A10) — streaming CSV/JSON primitives (pure, no express)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * RFC-4180 CSV field escaping: quote when the value contains a comma, quote,
 * CR or LF; embedded quotes are doubled. null/undefined → empty field.
 * Dates serialize as ISO-8601 (stable for BI tools, timezone-explicit).
 */
export function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s: string;
  if (value instanceof Date) s = value.toISOString();
  else if (typeof value === "object") s = JSON.stringify(value);
  else s = String(value);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** One CSV line (CRLF-terminated per RFC 4180) from already-ordered values. */
export function toCsvLine(values: unknown[]): string {
  return values.map(csvEscape).join(",") + "\r\n";
}

/** One CSV line from a row object, in the given column order. */
export function rowToCsvLine(row: Record<string, unknown>, columns: readonly string[]): string {
  return toCsvLine(columns.map((c) => row[c]));
}

/**
 * Streaming-JSON-array chunk for one row: prefixes a comma for every row after
 * the first, so `[` + chunks + `]` is always a valid JSON array.
 */
export function jsonStreamChunk(row: unknown, isFirst: boolean): string {
  return (isFirst ? "" : ",") + JSON.stringify(row);
}
