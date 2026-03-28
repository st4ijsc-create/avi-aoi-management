import { useState, useCallback } from "react";
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
  type: "stats" | "table" | "chart" | "text";
  /** Stats: array of { label, value } */
  stats?: { label: string; value: string | number }[];
  /** Table: headers + rows */
  tableHeaders?: string[];
  tableRows?: (string | number)[][];
  /** Chart: DOM element ID for screenshot capture */
  chartElementId?: string;
  /** Text block */
  text?: string;
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
}

interface ReportExportButtonProps {
  getConfig: () => ReportExportConfig | Promise<ReportExportConfig>;
  className?: string;
  size?: "sm" | "default";
}

/* ═══════════════════════════════════════════════════
   Shared helpers
   ═══════════════════════════════════════════════════ */

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

import { resolveOklchColors } from "../lib/resolveOklchColors";

/** html2canvas options shared across all capture calls */
function h2cOptions(extra?: Partial<Parameters<typeof html2canvas>[1]>): Parameters<typeof html2canvas>[1] {
  return {
    scale: 2,
    backgroundColor: "#ffffff",
    logging: false,
    useCORS: true,
    onclone: (_doc: Document, el: HTMLElement) => {
      // el is the cloned target — resolve oklch in its whole subtree
      const wrapper = el.ownerDocument;
      resolveOklchColors(wrapper);
    },
    ...extra,
  };
}

/** Capture all chart DOM elements that currently exist as base64 PNG images */
async function captureVisibleCharts(sections: ReportSection[]): Promise<Record<string, string>> {
  const imgs: Record<string, string> = {};
  for (const sec of sections) {
    if (sec.type === "chart" && sec.chartElementId) {
      const el = document.getElementById(sec.chartElementId);
      if (el) {
        try {
          const canvas = await html2canvas(el, h2cOptions({ backgroundColor: null }));
          imgs[sec.chartElementId] = canvas.toDataURL("image/png");
        } catch { /* skip unavailable charts */ }
      }
    }
  }
  return imgs;
}

/** Build the inner HTML body for all report sections */
function buildSectionsHTML(sections: ReportSection[], chartImgs: Record<string, string>): string {
  let html = "";
  for (const sec of sections) {
    html += `<h2 style="color:#1e293b;border-bottom:2px solid #e2e8f0;padding-bottom:8px;margin:28px 0 12px;font-size:16px;">${esc(sec.title)}</h2>`;

    if (sec.type === "stats" && sec.stats) {
      html += `<div style="display:flex;flex-wrap:wrap;gap:10px;margin:10px 0;">`;
      for (const s of sec.stats) {
        html += `<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px 18px;min-width:110px;text-align:center;">
          <div style="font-size:18px;font-weight:700;color:#0f172a;">${esc(String(s.value))}</div>
          <div style="font-size:10px;color:#64748b;margin-top:3px;">${esc(s.label)}</div>
        </div>`;
      }
      html += `</div>`;
    }

    if (sec.type === "table" && sec.tableHeaders && sec.tableRows) {
      html += `<table style="width:100%;border-collapse:collapse;margin:10px 0;font-size:12px;">
        <thead><tr style="background:#f1f5f9;">
          ${sec.tableHeaders.map((h) => `<th style="padding:7px 10px;text-align:left;border:1px solid #e2e8f0;font-weight:600;color:#334155;">${esc(h)}</th>`).join("")}
        </tr></thead><tbody>
          ${sec.tableRows.map((row, i) => `<tr style="background:${i % 2 === 0 ? "#fff" : "#f8fafc"};">
            ${row.map((c) => `<td style="padding:6px 10px;border:1px solid #e2e8f0;color:#334155;">${esc(String(c))}</td>`).join("")}
          </tr>`).join("")}
        </tbody></table>`;
    }

    if (sec.type === "chart" && sec.chartElementId && chartImgs[sec.chartElementId]) {
      html += `<div style="margin:10px 0;"><img src="${chartImgs[sec.chartElementId]}" style="max-width:100%;border-radius:8px;border:1px solid #e2e8f0;" /></div>`;
    }

    if (sec.type === "text" && sec.text) {
      html += `<pre style="color:#475569;line-height:1.7;margin:10px 0;white-space:pre-wrap;font-family:inherit;font-size:12px;">${esc(sec.text)}</pre>`;
    }
  }
  return html;
}

/** Build a complete HTML document string for the report */
function buildFullHTML(config: ReportExportConfig, labels: Record<string, string>, chartImgs: Record<string, string>): string {
  const dateStr = new Date().toLocaleString();
  const body = buildSectionsHTML(config.sections, chartImgs);
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(config.title)}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Noto Sans', 'Noto Sans SC', sans-serif; max-width: 1200px; margin: 0 auto; padding: 40px; color: #334155; line-height: 1.5; background: #fff; }
  @media print { body { padding: 20px; } }
</style></head><body>
<div style="margin-bottom:4px;"><span style="font-size:10px;color:#94a3b8;">${esc(labels.generatedBy)}</span></div>
<h1 style="color:#0f172a;margin:0 0 4px;font-size:22px;">${esc(config.title)}</h1>
${config.subtitle ? `<p style="color:#64748b;margin:0 0 4px;font-size:13px;">${esc(config.subtitle)}</p>` : ""}
<p style="color:#94a3b8;font-size:11px;margin:0 0 12px;">${labels.exportDate}: ${dateStr}</p>
<hr style="border:none;border-top:2px solid #e2e8f0;margin:0 0 8px;">
${body}
<hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0 8px;">
<p style="color:#94a3b8;font-size:10px;margin:0;">${esc(labels.generatedBy)} — ${dateStr}</p>
</body></html>`;
}

/* ═══════════════════════════════════════════════════
   Export Functions
   ═══════════════════════════════════════════════════ */

/**
 * PDF export using HTML-to-Canvas approach.
 * Renders the report as HTML in a hidden container, captures it with html2canvas,
 * and splits into PDF pages. This ensures all Unicode fonts (Vietnamese, Chinese)
 * render correctly using the browser's native text rendering.
 */
async function exportPDF(config: ReportExportConfig, labels: Record<string, string>) {
  // 1. Capture all visible chart screenshots from the DOM
  const chartImgs = await captureVisibleCharts(config.sections);

  // 2. Build HTML report body
  const dateStr = new Date().toLocaleString();
  const bodyHTML = buildSectionsHTML(config.sections, chartImgs);

  // 3. Render in a hidden container so html2canvas can capture it
  const isLandscape = config.orientation === "landscape";
  const pxWidth = isLandscape ? 1120 : 794; // approximate A4 proportions
  const container = document.createElement("div");
  container.style.cssText = `position:fixed;left:-10000px;top:0;width:${pxWidth}px;background:#fff;padding:40px 50px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Noto Sans','Noto Sans SC',sans-serif;color:#334155;line-height:1.5;`;
  container.innerHTML = `
    <div style="margin-bottom:4px;"><span style="font-size:10px;color:#94a3b8;">${esc(labels.generatedBy)}</span></div>
    <h1 style="color:#0f172a;margin:0 0 4px;font-size:22px;">${esc(config.title)}</h1>
    ${config.subtitle ? `<p style="color:#64748b;margin:0 0 4px;font-size:13px;">${esc(config.subtitle)}</p>` : ""}
    <p style="color:#94a3b8;font-size:11px;margin:0 0 12px;">${labels.exportDate}: ${dateStr}</p>
    <hr style="border:none;border-top:2px solid #e2e8f0;margin:0 0 8px;">
    ${bodyHTML}
    <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0 8px;">
    <p style="color:#94a3b8;font-size:10px;margin:0;">${esc(labels.generatedBy)} — ${dateStr}</p>
  `;
  document.body.appendChild(container);

  try {
    // 4. Capture the hidden container as a single tall canvas
    const fullCanvas = await html2canvas(container, h2cOptions());

    // 5. Split the captured canvas into A4-sized PDF pages
    const pdf = new jsPDF({
      orientation: isLandscape ? "landscape" : "portrait",
      unit: "mm",
      format: "a4",
    });
    const pw = pdf.internal.pageSize.getWidth();
    const ph = pdf.internal.pageSize.getHeight();
    const m = 10; // margin
    const uw = pw - 2 * m;
    const uh = ph - 2 * m - 5; // leave room for page number

    const ratio = uw / fullCanvas.width; // mm per canvas pixel
    const pxPerPage = uh / ratio;
    const totalPages = Math.ceil(fullCanvas.height / pxPerPage);

    for (let p = 0; p < totalPages; p++) {
      if (p > 0) pdf.addPage();
      const sy = p * pxPerPage;
      const sh = Math.min(pxPerPage, fullCanvas.height - sy);

      // Crop a page-sized slice of the canvas
      const slice = document.createElement("canvas");
      slice.width = fullCanvas.width;
      slice.height = sh;
      const ctx = slice.getContext("2d")!;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, slice.width, slice.height);
      ctx.drawImage(fullCanvas, 0, sy, fullCanvas.width, sh, 0, 0, fullCanvas.width, sh);

      pdf.addImage(slice.toDataURL("image/jpeg", 0.92), "JPEG", m, m, uw, sh * ratio);

      // Page number footer
      pdf.setFontSize(8);
      pdf.setTextColor(180, 180, 180);
      pdf.text(`${p + 1} / ${totalPages}`, pw - m - 12, ph - 4);
    }

    pdf.save(`${config.filenamePrefix}_${new Date().toISOString().split("T")[0]}.pdf`);
  } finally {
    document.body.removeChild(container);
  }
}

function exportExcel(config: ReportExportConfig) {
  const wb = XLSX.utils.book_new();
  const usedNames = new Set<string>();

  // Helper: ensure unique sheet names (Excel 31-char limit)
  const sheetName = (name: string): string => {
    let base = name.replace(/[\\/*?[\]:]/g, "").slice(0, 28);
    let final = base;
    let i = 1;
    while (usedNames.has(final)) {
      final = `${base.slice(0, 28 - String(i).length - 1)}_${i}`;
      i++;
    }
    usedNames.add(final);
    return final;
  };

  for (const section of config.sections) {
    if (section.type === "stats" && section.stats) {
      const data = section.stats.map((s) => ({ [section.title]: s.label, Value: String(s.value) }));
      const ws = XLSX.utils.json_to_sheet(data);
      XLSX.utils.book_append_sheet(wb, ws, sheetName(section.title));
    }

    if (section.type === "table" && section.tableHeaders && section.tableRows) {
      const aoa = [section.tableHeaders, ...section.tableRows];
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      XLSX.utils.book_append_sheet(wb, ws, sheetName(section.title));
    }
  }

  if (!wb.SheetNames.length) {
    const ws = XLSX.utils.aoa_to_sheet([[config.title], ["No tabular data available"]]);
    XLSX.utils.book_append_sheet(wb, ws, "Report");
  }

  const filename = `${config.filenamePrefix}_${new Date().toISOString().split("T")[0]}.xlsx`;
  XLSX.writeFile(wb, filename);
}

async function exportHTML(config: ReportExportConfig, labels: Record<string, string>) {
  // Capture all visible chart screenshots from the DOM
  const chartImgs = await captureVisibleCharts(config.sections);

  const html = buildFullHTML(config, labels, chartImgs);
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

  const handleExport = useCallback(async (format: "pdf" | "excel" | "html") => {
    setExporting(format);
    try {
      const config = await getConfig();
      switch (format) {
        case "pdf":
          await exportPDF(config, labels);
          break;
        case "excel":
          exportExcel(config);
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
