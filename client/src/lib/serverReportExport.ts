/**
 * doc 46 FE-W2 — client helper for the server-side FONT-SAFE report engine.
 *
 * Calls `trpc.export.renderReport` (universalExportService with embedded
 * BeVietnamPro), which renders VN/ZH diacritics correctly — unlike client-side
 * jsPDF, which lacked the glyphs and had to strip "Ngày xuất" → "Ngay xuat".
 * Returns base64; we rebuild a Blob and trigger a browser download.
 *
 * Use this for TABULAR data grids. Canvas/chart screenshot exports (dashboard
 * images) legitimately stay on client jsPDF — the server can't capture a
 * client-rendered chart.
 */
import { useCallback, useState } from "react";
import { trpc } from "@/lib/trpc";

export type ExportFormat = "pdf" | "xlsx" | "csv";
export type ExportLanguage = "vi" | "en" | "zh";

export interface ExportColumnSpec {
  key: string;
  header: string;
  width?: number;
  format?: "number" | "percentage" | "date" | "datetime" | "text";
}

export interface ReportExportRequest {
  /** Report id used for the default filename (e.g. "sla_cockpit"). */
  type?: string;
  title: string;
  subtitle?: string;
  columns: ExportColumnSpec[];
  data: Record<string, unknown>[];
  fileName?: string;
}

function base64ToBlob(b64: string, mime: string): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Returns `exportReport(req, format, language)` which renders a font-safe
 * document server-side and downloads it, plus `busy` (the in-flight format).
 */
export function useReportExport() {
  const mutation = trpc.export.renderReport.useMutation();
  const [busy, setBusy] = useState<ExportFormat | null>(null);

  const exportReport = useCallback(
    async (req: ReportExportRequest, format: ExportFormat, language: ExportLanguage) => {
      setBusy(format);
      try {
        const res = await mutation.mutateAsync({
          type: req.type ?? "report",
          title: req.title,
          subtitle: req.subtitle,
          format,
          language,
          columns: req.columns,
          data: req.data,
          fileName: req.fileName,
        });
        triggerDownload(base64ToBlob(res.base64, res.mimeType), res.filename);
        return { ok: true as const, filename: res.filename };
      } finally {
        setBusy(null);
      }
    },
    [mutation],
  );

  return { exportReport, busy, isExporting: busy != null };
}
