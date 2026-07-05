import { useState, useCallback } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { Download, FileText, FileSpreadsheet, FileCode, Loader2 } from "lucide-react";
import { toast } from "sonner";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import * as XLSX from "xlsx";
import { resolvePrintColors } from "../lib/resolveOklchColors";
import { capturePrintCharts, type PrintChartSpec } from "./reportPrintView";
import { paginateBlocks, type PaginationBlock } from "./reportPagination";

/* ═══════════════════════════════════════════════════
   Report Translations (vi / zh / en)
   ═══════════════════════════════════════════════════ */
const LABELS: Record<string, Record<string, string>> = {
  en: {
    exportDate: "Export date",
    page: "Page",
    exportReport: "Export Report",
    pdf: "PDF Report",
    excel: "Excel Spreadsheet",
    html: "HTML Report",
    exporting: "Exporting...",
    exportSuccess: "Report exported successfully",
    exportError: "Export failed",
    overview: "Overview",
    generatedBy: "AVI/AOI Management System",
    scope: "Scope & Filters",
    factory: "Factory",
    workshop: "Workshop",
    line: "Line",
    station: "Station",
    product: "Product",
    shift: "Shift",
    machineType: "Machine type",
    dateRange: "Date range",
    search: "Search",
    rows: "Rows",
  },
  vi: {
    exportDate: "Ngày xuất",
    page: "Trang",
    exportReport: "Xuất Báo Cáo",
    pdf: "Báo cáo PDF",
    excel: "Bảng tính Excel",
    html: "Báo cáo HTML",
    exporting: "Đang xuất...",
    exportSuccess: "Xuất báo cáo thành công",
    exportError: "Xuất báo cáo thất bại",
    overview: "Tổng quan",
    generatedBy: "Hệ thống quản lý AVI/AOI",
    scope: "Phạm vi & Bộ lọc",
    factory: "Nhà máy",
    workshop: "Phân xưởng",
    line: "Chuyền",
    station: "Trạm",
    product: "Sản phẩm",
    shift: "Ca",
    machineType: "Loại máy",
    dateRange: "Khoảng ngày",
    search: "Tìm kiếm",
    rows: "Số dòng",
  },
  zh: {
    exportDate: "导出日期",
    page: "页",
    exportReport: "导出报告",
    pdf: "PDF 报告",
    excel: "Excel 电子表格",
    html: "HTML 报告",
    exporting: "正在导出...",
    exportSuccess: "报告导出成功",
    exportError: "导出失败",
    overview: "概述",
    generatedBy: "AVI/AOI管理系统",
    scope: "范围和筛选",
    factory: "工厂",
    workshop: "车间",
    line: "产线",
    station: "工站",
    product: "产品",
    shift: "班次",
    machineType: "设备类型",
    dateRange: "日期范围",
    search: "搜索",
    rows: "行数",
  },
};

function getLabels(lang: string) {
  const key = lang.startsWith("vi") ? "vi" : lang.startsWith("zh") ? "zh" : "en";
  return LABELS[key];
}

/* ═══════════════════════════════════════════════════
   Types
   ═══════════════════════════════════════════════════ */
export interface ReportSection {
  title: string;
  type: "stats" | "table" | "chart" | "text" | "gallery";
  /** Stats: array of { label, value } */
  stats?: { label: string; value: string | number }[];
  /** Table: headers + rows */
  tableHeaders?: string[];
  tableRows?: (string | number)[][];
  /** Chart (legacy): DOM element ID captured from the currently-mounted tab. */
  chartElementId?: string;
  /**
   * Chart (preferred): off-screen render thunk. The engine mounts every thunk in
   * a hidden fixed-width "print view", so charts export even if their tab is not
   * open (doc 32 §6.5). Returns a recharts/React node.
   */
  chartRender?: () => ReactNode;
  /** Chart: mounted height in px for the off-screen print view (default 320). */
  chartHeight?: number;
  /** Chart: a pre-captured image (e.g. a board heatmap already rasterised by the page). */
  imageDataUrl?: string;
  /** Gallery: image URLs (e.g. NG defect photos) rendered as a grid. */
  images?: { src: string; caption?: string }[];
  /** Text block */
  text?: string;
}

/**
 * Scope / filter metadata rendered into the repeated header band (PDF, every
 * page), the HTML header, and a dedicated Excel sheet. Pages pass whatever
 * filters are currently applied so the report is self-describing (doc 32 §6.4 #8).
 */
export interface ReportScope {
  factory?: string;
  workshop?: string;
  line?: string;
  station?: string;
  product?: string;
  shift?: string;
  machineType?: string;
  /** Human-readable date range, e.g. "01/07 — 05/07". */
  dateRange?: string;
  /** Active free-text search, if any. */
  search?: string;
  /** e.g. "Low-yield only (<95%)" / "All rows" — describes table row scope. */
  rowScope?: string;
  /** Extra free-form note lines (low-yield filter, thresholds, …). */
  notes?: string[];
  /** Arbitrary extra labelled chips. */
  extra?: { label: string; value: string }[];
}

export interface ReportExportConfig {
  /** Report title */
  title: string;
  /** Subtitle (e.g., station name or date range) */
  subtitle?: string;
  /** Sections to include in the report */
  sections: ReportSection[];
  /** Filename prefix (no extension) */
  filenamePrefix: string;
  /** Orientation for PDF */
  orientation?: "portrait" | "landscape";
  /** Scope / filters band shown on every page. */
  scope?: ReportScope;
}

interface ReportExportButtonProps {
  getConfig: () => ReportExportConfig | Promise<ReportExportConfig>;
  className?: string;
  size?: "sm" | "default";
}

/** Map from a section object to its captured chart image (data URL). */
type ChartImageMap = Map<ReportSection, string>;

/* ═══════════════════════════════════════════════════
   Shared helpers
   ═══════════════════════════════════════════════════ */

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** html2canvas options shared across all capture calls — forces the print palette. */
function h2cOptions(extra?: Partial<Parameters<typeof html2canvas>[1]>): Parameters<typeof html2canvas>[1] {
  return {
    scale: 2,
    backgroundColor: "#ffffff",
    logging: false,
    useCORS: true,
    onclone: (_doc: Document, el: HTMLElement) => resolvePrintColors(el.ownerDocument),
    ...extra,
  };
}

/**
 * Capture every chart section as a PNG, decoupled from the open tab:
 *   1. `chartRender` thunks → mounted together off-screen via the print view.
 *   2. `chartElementId` (legacy) → captured from the live DOM if present.
 *   3. `imageDataUrl` → used as-is (already rasterised board/heatmap images).
 * Returns a map keyed by the section object.
 */
async function captureAllCharts(sections: ReportSection[], landscape: boolean): Promise<ChartImageMap> {
  const map: ChartImageMap = new Map();

  // 1. Off-screen print-view thunks (all at once).
  const specs: PrintChartSpec[] = [];
  const byKey = new Map<string, ReportSection>();
  sections.forEach((sec, i) => {
    if (sec.type === "chart" && sec.chartRender) {
      const key = `pv-${i}`;
      specs.push({ key, render: sec.chartRender, height: sec.chartHeight });
      byKey.set(key, sec);
    }
  });
  if (specs.length) {
    const imgs = await capturePrintCharts(specs, { width: landscape ? 1100 : 900 });
    for (const [key, dataUrl] of Object.entries(imgs)) {
      const sec = byKey.get(key);
      if (sec) map.set(sec, dataUrl);
    }
  }

  // 2. Legacy element-id charts (currently mounted tab).
  for (const sec of sections) {
    if (sec.type === "chart" && !sec.chartRender && sec.chartElementId && !map.has(sec)) {
      const el = document.getElementById(sec.chartElementId);
      if (el) {
        try {
          const canvas = await html2canvas(el, h2cOptions());
          map.set(sec, canvas.toDataURL("image/png"));
        } catch { /* skip unavailable charts — the data table still carries numbers */ }
      }
    }
  }

  // 3. Pre-rasterised images.
  for (const sec of sections) {
    if (sec.type === "chart" && sec.imageDataUrl && !map.has(sec)) {
      map.set(sec, sec.imageDataUrl);
    }
  }

  return map;
}

/* ── Scope / filter band ─────────────────────────────── */

function buildScopeChips(scope: ReportScope | undefined, labels: Record<string, string>): { label: string; value: string }[] {
  if (!scope) return [];
  const chips: { label: string; value: string }[] = [];
  const push = (label: string, value?: string) => {
    if (value != null && String(value).trim() !== "") chips.push({ label, value: String(value) });
  };
  push(labels.factory, scope.factory);
  push(labels.workshop, scope.workshop);
  push(labels.line, scope.line);
  push(labels.station, scope.station);
  push(labels.product, scope.product);
  push(labels.shift, scope.shift);
  push(labels.machineType, scope.machineType);
  push(labels.dateRange, scope.dateRange);
  push(labels.search, scope.search);
  push(labels.rows, scope.rowScope);
  if (scope.extra) for (const e of scope.extra) push(e.label, e.value);
  return chips;
}

function buildScopeBandHTML(scope: ReportScope | undefined, labels: Record<string, string>): string {
  const chips = buildScopeChips(scope, labels);
  const notes = scope?.notes?.filter((n) => n && n.trim() !== "") ?? [];
  if (!chips.length && !notes.length) return "";
  const pills = chips
    .map(
      (c) =>
        `<span style="display:inline-block;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:6px;padding:2px 8px;margin:2px 4px 2px 0;font-size:10px;color:#334155;">
          <b style="color:#64748b;font-weight:600;">${esc(c.label)}:</b> ${esc(c.value)}</span>`,
    )
    .join("");
  const noteLines = notes
    .map((n) => `<div style="font-size:10px;color:#64748b;margin-top:2px;">• ${esc(n)}</div>`)
    .join("");
  return `<div style="margin:6px 0 2px;padding:6px 8px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;">
    <div style="font-size:9px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:3px;">${esc(labels.scope)}</div>
    <div>${pills}</div>${noteLines}</div>`;
}

/* ── Section rendering ───────────────────────────────── */

const H2_STYLE = "color:#0f172a;border-bottom:2px solid #e2e8f0;padding-bottom:6px;margin:0 0 10px;font-size:15px;";

function galleryTableHTML(sec: ReportSection): string {
  const imgs = sec.images ?? [];
  if (!imgs.length) return "";
  const perRow = 3;
  let rows = "";
  for (let i = 0; i < imgs.length; i += perRow) {
    const cells = imgs
      .slice(i, i + perRow)
      .map(
        (im) =>
          `<td style="width:33%;padding:4px;vertical-align:top;text-align:center;">
            <img src="${esc(im.src)}" style="max-width:100%;max-height:220px;border:1px solid #e2e8f0;border-radius:6px;" />
            ${im.caption ? `<div style="font-size:9px;color:#64748b;margin-top:2px;">${esc(im.caption)}</div>` : ""}
          </td>`,
      )
      .join("");
    rows += `<tr>${cells}</tr>`;
  }
  return `<h2 style="${H2_STYLE}">${esc(sec.title)}</h2>
    <table style="width:100%;border-collapse:collapse;margin:4px 0;"><tbody>${rows}</tbody></table>`;
}

/** Render a single section's inner HTML (title + body). Returns "" to skip. */
function renderSectionInner(sec: ReportSection, img: string | undefined): string {
  if (sec.type === "stats" && sec.stats?.length) {
    const pills = sec.stats
      .map(
        (s) => `<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px 18px;min-width:110px;text-align:center;">
          <div style="font-size:18px;font-weight:700;color:#0f172a;">${esc(String(s.value))}</div>
          <div style="font-size:10px;color:#64748b;margin-top:3px;">${esc(s.label)}</div>
        </div>`,
      )
      .join("");
    return `<h2 style="${H2_STYLE}">${esc(sec.title)}</h2>
      <div style="display:flex;flex-wrap:wrap;gap:10px;margin:4px 0;">${pills}</div>`;
  }

  if (sec.type === "table" && sec.tableHeaders && sec.tableRows?.length) {
    const thead = `<thead><tr style="background:#f1f5f9;">
      ${sec.tableHeaders.map((h) => `<th style="padding:7px 10px;text-align:left;border:1px solid #e2e8f0;font-weight:600;color:#334155;font-size:12px;">${esc(h)}</th>`).join("")}
    </tr></thead>`;
    const tbody = `<tbody>${sec.tableRows
      .map(
        (row, i) => `<tr style="background:${i % 2 === 0 ? "#fff" : "#f8fafc"};">
        ${row.map((c) => `<td style="padding:6px 10px;border:1px solid #e2e8f0;color:#334155;font-size:12px;">${esc(String(c))}</td>`).join("")}
      </tr>`,
      )
      .join("")}</tbody>`;
    return `<h2 style="${H2_STYLE}">${esc(sec.title)}</h2>
      <table style="width:100%;border-collapse:collapse;margin:4px 0;">${thead}${tbody}</table>`;
  }

  if (sec.type === "chart") {
    if (!img) return ""; // no image captured → skip the empty section entirely
    return `<h2 style="${H2_STYLE}">${esc(sec.title)}</h2>
      <div style="margin:4px 0;"><img src="${img}" style="max-width:100%;border-radius:8px;border:1px solid #e2e8f0;" /></div>`;
  }

  if (sec.type === "gallery") {
    return galleryTableHTML(sec);
  }

  if (sec.type === "text" && sec.text) {
    return `<h2 style="${H2_STYLE}">${esc(sec.title)}</h2>
      <pre style="color:#475569;line-height:1.7;margin:4px 0;white-space:pre-wrap;font-family:inherit;font-size:12px;">${esc(sec.text)}</pre>`;
  }

  return "";
}

/** True when a section paginates row-by-row (real table or an image gallery). */
function isTableBlock(sec: ReportSection): boolean {
  return sec.type === "table" || sec.type === "gallery";
}

/** Build the block-wrapped body HTML used by both the PDF measurer and HTML export. */
function buildBlocksHTML(sections: ReportSection[], imgFor: (sec: ReportSection) => string | undefined): string {
  let html = "";
  let idx = 0;
  for (const sec of sections) {
    const inner = renderSectionInner(sec, imgFor(sec));
    if (!inner) continue;
    const kind = isTableBlock(sec) ? "table" : "atomic";
    html += `<div data-block-index="${idx}" data-block-kind="${kind}" style="margin:0 0 14px;padding-top:2px;">${inner}</div>`;
    idx++;
  }
  return html;
}

/** The repeated header band: branding + title + subtitle + date + scope band. */
function buildHeaderBandHTML(config: ReportExportConfig, labels: Record<string, string>, dateStr: string): string {
  return `<div style="margin-bottom:2px;"><span style="font-size:10px;color:#94a3b8;">${esc(labels.generatedBy)}</span></div>
    <h1 style="color:#0f172a;margin:0 0 2px;font-size:20px;">${esc(config.title)}</h1>
    ${config.subtitle ? `<p style="color:#64748b;margin:0 0 2px;font-size:12px;">${esc(config.subtitle)}</p>` : ""}
    <p style="color:#94a3b8;font-size:10px;margin:0 0 4px;">${esc(labels.exportDate)}: ${esc(dateStr)}</p>
    ${buildScopeBandHTML(config.scope, labels)}
    <hr style="border:none;border-top:2px solid #e2e8f0;margin:6px 0 0;">`;
}

/** Build a complete standalone HTML document for the report. */
function buildFullHTML(config: ReportExportConfig, labels: Record<string, string>, chartMap: ChartImageMap): string {
  const dateStr = new Date().toLocaleString();
  const body = buildBlocksHTML(config.sections, (sec) => chartMap.get(sec));
  const scopeBand = buildScopeBandHTML(config.scope, labels);
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(config.title)}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Noto Sans', 'Noto Sans SC', sans-serif; max-width: 1200px; margin: 0 auto; padding: 40px; color: #334155; line-height: 1.5; background: #fff; }
  @media print { body { padding: 20px; } }
</style></head><body>
<div style="margin-bottom:4px;"><span style="font-size:10px;color:#94a3b8;">${esc(labels.generatedBy)}</span></div>
<h1 style="color:#0f172a;margin:0 0 4px;font-size:22px;">${esc(config.title)}</h1>
${config.subtitle ? `<p style="color:#64748b;margin:0 0 4px;font-size:13px;">${esc(config.subtitle)}</p>` : ""}
<p style="color:#94a3b8;font-size:11px;margin:0 0 8px;">${esc(labels.exportDate)}: ${dateStr}</p>
${scopeBand}
<hr style="border:none;border-top:2px solid #e2e8f0;margin:8px 0;">
${body}
<hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0 8px;">
<p style="color:#94a3b8;font-size:10px;margin:0;">${esc(labels.generatedBy)} — ${dateStr}</p>
</body></html>`;
}

/* ═══════════════════════════════════════════════════
   Export Functions
   ═══════════════════════════════════════════════════ */

function makeHiddenContainer(pxWidth: number): HTMLDivElement {
  const c = document.createElement("div");
  c.style.cssText =
    `position:fixed;left:-100000px;top:0;width:${pxWidth}px;box-sizing:border-box;` +
    `background:#ffffff;padding:0 46px;` +
    `font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Noto Sans','Noto Sans SC',sans-serif;` +
    `color:#334155;line-height:1.5;`;
  return c;
}

interface AtomicMeta {
  topCss: number;
  hCss: number;
}
interface TableMeta {
  headerTopCss: number;
  headerHCss: number;
  rows: { topCss: number; hCss: number }[];
}

/**
 * PDF export with ELEMENT-AWARE pagination (doc 32 §6.4 #7/#8).
 *
 * Charts are captured off-screen (all tabs), the report body is rendered to a
 * hidden container, each section is measured as a block, and `paginateBlocks`
 * lays them onto A4 pages breaking only BETWEEN blocks (and between table rows,
 * re-emitting the column header). The branding + scope/filter band repeat on
 * every page; a page-number footer is drawn per page.
 */
async function exportPDF(config: ReportExportConfig, labels: Record<string, string>) {
  const isLandscape = config.orientation === "landscape";
  const pxWidth = isLandscape ? 1120 : 794;
  const dateStr = new Date().toLocaleString();

  // 1. Capture every chart (off-screen print view + legacy + pre-rasterised).
  const chartMap = await captureAllCharts(config.sections, isLandscape);

  // 2. Render header band + content blocks into hidden containers.
  const headerContainer = makeHiddenContainer(pxWidth);
  headerContainer.innerHTML = buildHeaderBandHTML(config, labels, dateStr);
  const contentContainer = makeHiddenContainer(pxWidth);
  contentContainer.innerHTML = buildBlocksHTML(config.sections, (sec) => chartMap.get(sec));
  document.body.appendChild(headerContainer);
  document.body.appendChild(contentContainer);

  try {
    const headerCanvas = await html2canvas(headerContainer, h2cOptions());
    const contentCanvas = await html2canvas(contentContainer, h2cOptions());

    const pdf = new jsPDF({ orientation: isLandscape ? "landscape" : "portrait", unit: "mm", format: "a4" });
    const pw = pdf.internal.pageSize.getWidth();
    const ph = pdf.internal.pageSize.getHeight();
    const m = 10;
    const uw = pw - 2 * m;

    const contentWidthPx = contentContainer.offsetWidth || pxWidth;
    const cssPxToMm = uw / contentWidthPx;
    const contentScale = contentCanvas.width / contentWidthPx; // canvas px per css px
    const headerBandMm = headerContainer.offsetHeight * cssPxToMm;

    const footerMm = 7;
    const gapTop = 3;
    const contentTop = m + headerBandMm + gapTop;
    const usableHeightMm = Math.max(20, ph - contentTop - footerMm - m);

    // 3. Measure each block.
    const cRect = contentContainer.getBoundingClientRect();
    const blockEls = Array.from(contentContainer.querySelectorAll<HTMLElement>("[data-block-index]"));
    const blocks: PaginationBlock[] = [];
    for (const el of blockEls) {
      const rect = el.getBoundingClientRect();
      const topCss = rect.top - cRect.top;
      if (el.getAttribute("data-block-kind") === "table") {
        const table = el.querySelector("table");
        const rowEls = table ? Array.from(table.querySelectorAll<HTMLElement>("tbody tr")) : [];
        const rowsMm: number[] = [];
        const rowMeta: { topCss: number; hCss: number }[] = [];
        for (const tr of rowEls) {
          const rr = tr.getBoundingClientRect();
          rowsMm.push(rr.height * cssPxToMm);
          rowMeta.push({ topCss: rr.top - cRect.top, hCss: rr.height });
        }
        // Header region = everything above the first data row (section title + column header).
        const firstRowTopCss = rowMeta.length ? rowMeta[0].topCss : topCss + rect.height;
        const headerHCss = firstRowTopCss - topCss;
        blocks.push({
          kind: "table",
          heightMm: rect.height * cssPxToMm,
          headerMm: headerHCss * cssPxToMm,
          rowsMm,
          meta: { headerTopCss: topCss, headerHCss, rows: rowMeta } as TableMeta,
        });
      } else {
        blocks.push({
          kind: "atomic",
          heightMm: rect.height * cssPxToMm,
          meta: { topCss, hCss: rect.height } as AtomicMeta,
        });
      }
    }

    const pages = paginateBlocks(blocks, usableHeightMm, { blockGapMm: 4 });

    // Draw a vertical css-px slice of the content canvas into the PDF.
    const drawSlice = (topCss: number, hCss: number, x: number, y: number, wMm: number, hMm: number) => {
      const sy = Math.max(0, topCss * contentScale);
      const sh = Math.max(1, hCss * contentScale);
      const tmp = document.createElement("canvas");
      tmp.width = contentCanvas.width;
      tmp.height = Math.round(sh);
      const ctx = tmp.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, tmp.width, tmp.height);
      ctx.drawImage(contentCanvas, 0, sy, contentCanvas.width, sh, 0, 0, tmp.width, sh);
      pdf.addImage(tmp.toDataURL("image/jpeg", 0.92), "JPEG", x, y, wMm, hMm);
    };

    const headerImg = headerCanvas.toDataURL("image/jpeg", 0.95);
    const pageLabelAscii = /^[\x00-\x7F]*$/.test(labels.page) ? `${labels.page} ` : "";

    for (let p = 0; p < pages.length; p++) {
      if (p > 0) pdf.addPage();
      // Repeat header band on every page.
      pdf.addImage(headerImg, "JPEG", m, m, uw, headerBandMm);

      for (const pl of pages[p].placements) {
        if (pl.kind === "atomic") {
          const meta = blocks[pl.blockIndex].meta as AtomicMeta;
          if (pl.scale < 1) {
            const wMm = uw * pl.scale;
            drawSlice(meta.topCss, meta.hCss, m + (uw - wMm) / 2, contentTop + pl.yMm, wMm, pl.heightMm);
          } else {
            drawSlice(meta.topCss, meta.hCss, m, contentTop + pl.yMm, uw, pl.heightMm);
          }
        } else {
          const meta = blocks[pl.blockIndex].meta as TableMeta;
          let y = contentTop + pl.yMm;
          if (pl.headerMm > 0) {
            drawSlice(meta.headerTopCss, meta.headerHCss, m, y, uw, pl.headerMm);
            y += pl.headerMm;
          }
          if (pl.rowEnd > pl.rowStart && meta.rows.length) {
            const first = meta.rows[pl.rowStart];
            const last = meta.rows[pl.rowEnd - 1];
            const hCss = last.topCss + last.hCss - first.topCss;
            drawSlice(first.topCss, hCss, m, y, uw, pl.rowsHeightMm);
          }
        }
      }

      // Footer page number (ASCII-safe — CJK "page" labels are dropped).
      pdf.setFontSize(8);
      pdf.setTextColor(150, 150, 150);
      pdf.text(`${pageLabelAscii}${p + 1} / ${pages.length}`, pw - m - 22, ph - 5);
    }

    pdf.save(`${config.filenamePrefix}_${new Date().toISOString().split("T")[0]}.pdf`);
  } finally {
    if (headerContainer.parentNode) document.body.removeChild(headerContainer);
    if (contentContainer.parentNode) document.body.removeChild(contentContainer);
  }
}

function exportExcel(config: ReportExportConfig, labels: Record<string, string>) {
  const wb = XLSX.utils.book_new();
  const usedNames = new Set<string>();

  const sheetName = (name: string): string => {
    const base = name.replace(/[\\/*?[\]:]/g, "").slice(0, 28);
    let final = base || "Sheet";
    let i = 1;
    while (usedNames.has(final)) {
      final = `${base.slice(0, 28 - String(i).length - 1)}_${i}`;
      i++;
    }
    usedNames.add(final);
    return final;
  };

  // Scope / filters sheet first, so the export is self-describing.
  const chips = buildScopeChips(config.scope, labels);
  if (chips.length || config.scope?.notes?.length) {
    const aoa: (string | number)[][] = [[labels.scope, ""]];
    for (const c of chips) aoa.push([c.label, c.value]);
    for (const n of config.scope?.notes ?? []) aoa.push(["", n]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), sheetName(labels.scope));
  }

  for (const section of config.sections) {
    if (section.type === "stats" && section.stats) {
      const data = section.stats.map((s) => ({ [section.title]: s.label, Value: String(s.value) }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), sheetName(section.title));
    }
    if (section.type === "table" && section.tableHeaders && section.tableRows) {
      const aoa = [section.tableHeaders, ...section.tableRows];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), sheetName(section.title));
    }
  }

  if (!wb.SheetNames.length) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[config.title], ["No tabular data available"]]), "Report");
  }

  XLSX.writeFile(wb, `${config.filenamePrefix}_${new Date().toISOString().split("T")[0]}.xlsx`);
}

async function exportHTML(config: ReportExportConfig, labels: Record<string, string>) {
  const chartMap = await captureAllCharts(config.sections, config.orientation === "landscape");
  const html = buildFullHTML(config, labels, chartMap);
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${config.filenamePrefix}_${new Date().toISOString().split("T")[0]}.html`;
  a.click();
  URL.revokeObjectURL(url);
}

/* ═══════════════════════════════════════════════════
   Component
   ═══════════════════════════════════════════════════ */
export default function ReportExportButton({ getConfig, className = "", size = "sm" }: ReportExportButtonProps) {
  const { i18n } = useTranslation();
  const labels = getLabels(i18n.language);
  const [exporting, setExporting] = useState<string | null>(null);
  void size;

  const handleExport = useCallback(async (format: "pdf" | "excel" | "html") => {
    setExporting(format);
    try {
      const config = await getConfig();
      switch (format) {
        case "pdf":
          await exportPDF(config, labels);
          break;
        case "excel":
          exportExcel(config, labels);
          break;
        case "html":
          await exportHTML(config, labels);
          break;
      }
      toast.success(labels.exportSuccess);
    } catch (error) {
      console.error("Export error:", error);
      toast.error(labels.exportError);
    } finally {
      setExporting(null);
    }
  }, [getConfig, labels]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border transition-colors
            ${exporting
              ? "bg-purple-600/10 text-purple-400 border-purple-500/20 cursor-wait"
              : "text-muted-foreground/70 hover:text-foreground border-border hover:border-purple-500/30 hover:bg-purple-600/5"
            } ${className}`}
          disabled={!!exporting}
        >
          {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
          {exporting ? labels.exporting : labels.exportReport}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel className="text-xs">{labels.exportReport}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => handleExport("pdf")} className="gap-2 text-xs cursor-pointer">
          <FileText className="h-3.5 w-3.5 text-red-400" />
          {labels.pdf}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleExport("excel")} className="gap-2 text-xs cursor-pointer">
          <FileSpreadsheet className="h-3.5 w-3.5 text-green-400" />
          {labels.excel}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleExport("html")} className="gap-2 text-xs cursor-pointer">
          <FileCode className="h-3.5 w-3.5 text-blue-400" />
          {labels.html}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
