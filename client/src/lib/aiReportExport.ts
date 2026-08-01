/**
 * AI report → ReportExportConfig builder (doc 32 R4 · P0 #3).
 * ============================================================================
 * Turns the on-screen AI report (daily / rca / model / executive) into the
 * generic ReportExportConfig consumed by ReportExportButton, so the richest
 * management content can leave the page as PDF / XLSX / HTML. Pure + i18n-injected
 * so it is unit-testable without rendering the page.
 */
import type { ReportExportConfig } from "@/components/ReportExportButton";

export type AiReportTab = "daily" | "rca" | "model" | "executive";
type Tr = (key: string, def?: string) => string;

export function buildAiExportConfig(
  activeTab: AiReportTab,
  data: any,
  dateRange: { from: string; to: string },
  t: Tr,
): ReportExportConfig {
  const dateStr = `${dateRange.from} → ${dateRange.to}`;
  const sections: ReportExportConfig["sections"] = [];
  const d = data;

  if (activeTab === "daily" && d) {
    sections.push({
      title: t("rp.dailyTitle", "Báo cáo tổng hợp hàng ngày"),
      type: "stats",
      stats: [
        { label: t("rp.totalInspections", "Tổng kiểm tra"), value: d.totalInspections ?? 0 },
        { label: "OK", value: d.okCount ?? 0 },
        { label: "NG", value: d.ngCount ?? 0 },
        { label: t("rp.yield", "Yield"), value: `${((d.yieldRate ?? 0) * 100).toFixed(1)}%` },
      ],
    });
    if (d.narrative) sections.push({ title: t("rp.summary", "Tóm tắt"), type: "text", text: d.narrative });
    if (d.recommendations?.length)
      sections.push({
        title: t("rp.recommendations", "Khuyến nghị"),
        type: "table",
        tableHeaders: ["#", t("rp.recommendations", "Khuyến nghị")],
        tableRows: d.recommendations.map((r: string, i: number) => [i + 1, r]),
      });
  } else if (activeTab === "rca" && d) {
    if (d.narrative) sections.push({ title: t("rp.rcaTitle", "Phân tích nguyên nhân gốc (RCA)"), type: "text", text: d.narrative });
    if (d.actionItems?.length)
      sections.push({
        title: t("rp.actionItems", "Hành động cần làm"),
        type: "table",
        tableHeaders: ["#", t("rp.actionItems", "Hành động cần làm")],
        tableRows: d.actionItems.map((r: string, i: number) => [i + 1, r]),
      });
  } else if (activeTab === "model" && d) {
    if (d.narrative) sections.push({ title: t("rp.modelTitle", "Báo cáo hiệu suất mô hình AI"), type: "text", text: d.narrative });
    if (d.models?.length)
      sections.push({
        title: t("rp.modelTitle", "Báo cáo hiệu suất mô hình AI"),
        type: "table",
        tableHeaders: ["Model", t("rp.accuracy", "Độ chính xác"), t("rp.trend", "Xu hướng"), "Drift"],
        tableRows: d.models.map((m: any) => [
          m.modelCode,
          `${((m.currentAccuracy ?? 0) * 100).toFixed(1)}%`,
          m.accuracyTrend ?? "",
          m.driftDetected ? "⚠" : "OK",
        ]),
      });
  } else if (activeTab === "executive" && d) {
    if (d.kpis)
      sections.push({
        title: t("rp.executiveTitle", "Báo cáo tổng quan dành cho lãnh đạo"),
        type: "stats",
        stats: [
          { label: t("rp.totalProduction", "Tổng sản xuất"), value: d.kpis.totalProduction ?? 0 },
          { label: "Yield", value: `${((d.kpis.overallYield ?? 0) * 100).toFixed(1)}%` },
          { label: t("rp.defectRate", "Tỷ lệ lỗi"), value: `${((d.kpis.avgDefectRate ?? 0) * 100).toFixed(1)}%` },
          { label: t("rp.bestMachine", "Máy tốt nhất"), value: d.kpis.topPerformingMachine ?? "—" },
        ],
      });
    if (d.narrative) sections.push({ title: t("rp.summary", "Tóm tắt"), type: "text", text: d.narrative });
    if (d.forecast) sections.push({ title: t("rp.forecast", "Dự báo"), type: "text", text: d.forecast });
  }

  const titleMap: Record<AiReportTab, string> = {
    daily: t("rp.dailyTitle", "Báo cáo tổng hợp hàng ngày"),
    rca: t("rp.rcaTitle", "Phân tích nguyên nhân gốc (RCA)"),
    model: t("rp.modelTitle", "Báo cáo hiệu suất mô hình AI"),
    executive: t("rp.executiveTitle", "Báo cáo tổng quan dành cho lãnh đạo"),
  };
  return {
    title: titleMap[activeTab] || t("rp.title", "Báo cáo AI"),
    subtitle: dateStr,
    sections,
    filenamePrefix: `ai_report_${activeTab}`,
    orientation: "portrait",
  };
}
