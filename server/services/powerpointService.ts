/**
 * PowerPoint Export Service
 * Xuất dashboard/report sang PowerPoint sử dụng pptxgenjs
 */

import PptxGenJS from "pptxgenjs";
import type { QualityReportData } from "./pdfTemplateService";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PowerPointConfig {
  title: string;
  subtitle?: string;
  author?: string;
  companyName?: string;
  primaryColor?: string;
  accentColor?: string;
  includeCharts?: boolean;
  includeNotes?: boolean;
}

export interface DashboardSlideData {
  title: string;
  kpis: Array<{ label: string; value: string; trend?: string; trendDirection?: "up" | "down" | "same" }>;
  charts?: Array<{
    type: "bar" | "line" | "pie" | "doughnut";
    title: string;
    data: Array<{ name: string; values: number[] }>;
    labels: string[];
  }>;
  tables?: Array<{
    title: string;
    headers: string[];
    rows: string[][];
  }>;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const SLIDE_MARGIN = 0.5;
const TITLE_FONT_SIZE = 24;
const SUBTITLE_FONT_SIZE = 14;
const BODY_FONT_SIZE = 10;
const HEADER_FONT_SIZE = 12;

// ─── Helper Functions ───────────────────────────────────────────────────────

function cleanHex(hex: string): string {
  return hex.replace("#", "");
}

function addTitleSlide(
  pptx: PptxGenJS,
  config: PowerPointConfig
): void {
  const slide = pptx.addSlide();
  const primary = cleanHex(config.primaryColor || "#2563eb");

  // Background gradient
  slide.background = { color: primary };

  // Title
  slide.addText(config.title, {
    x: SLIDE_MARGIN,
    y: 1.5,
    w: "90%",
    h: 1.5,
    fontSize: 36,
    bold: true,
    color: "FFFFFF",
    align: "center",
    fontFace: "Arial",
  });

  // Subtitle
  if (config.subtitle) {
    slide.addText(config.subtitle, {
      x: SLIDE_MARGIN,
      y: 3.0,
      w: "90%",
      h: 0.8,
      fontSize: 18,
      color: "E0E0E0",
      align: "center",
      fontFace: "Arial",
    });
  }

  // Company name
  slide.addText(config.companyName || "SYNAPSE", {
    x: SLIDE_MARGIN,
    y: 4.2,
    w: "90%",
    h: 0.5,
    fontSize: 12,
    color: "B0B0B0",
    align: "center",
    fontFace: "Arial",
  });

  // Date
  slide.addText(`Generated: ${new Date().toLocaleString("vi-VN")}`, {
    x: SLIDE_MARGIN,
    y: 4.8,
    w: "90%",
    h: 0.4,
    fontSize: 10,
    color: "B0B0B0",
    align: "center",
    fontFace: "Arial",
  });
}

function addFooter(slide: PptxGenJS.Slide, config: PowerPointConfig, pageNum: number): void {
  slide.addText(`${config.companyName || "SYNAPSE"} | Trang ${pageNum}`, {
    x: 0.3,
    y: 5.2,
    w: "95%",
    h: 0.3,
    fontSize: 7,
    color: "999999",
    align: "center",
    fontFace: "Arial",
  });
}

function addKPISlide(
  pptx: PptxGenJS,
  title: string,
  kpis: DashboardSlideData["kpis"],
  config: PowerPointConfig,
  pageNum: number
): void {
  const slide = pptx.addSlide();
  const primary = cleanHex(config.primaryColor || "#2563eb");

  // Section title
  slide.addText(title, {
    x: SLIDE_MARGIN,
    y: 0.3,
    w: "90%",
    h: 0.6,
    fontSize: TITLE_FONT_SIZE,
    bold: true,
    color: primary,
    fontFace: "Arial",
  });

  // Divider line
  slide.addShape(pptx.ShapeType.line, {
    x: SLIDE_MARGIN,
    y: 0.9,
    w: 9,
    h: 0,
    line: { color: primary, width: 2 },
  });

  // KPI cards in grid
  const cardWidth = 2;
  const cardHeight = 1.2;
  const gap = 0.3;
  const cardsPerRow = 4;

  kpis.forEach((kpi, idx) => {
    const col = idx % cardsPerRow;
    const row = Math.floor(idx / cardsPerRow);
    const x = SLIDE_MARGIN + col * (cardWidth + gap);
    const y = 1.2 + row * (cardHeight + gap);

    // Card background
    slide.addShape(pptx.ShapeType.roundRect, {
      x,
      y,
      w: cardWidth,
      h: cardHeight,
      fill: { color: "F8FAFC" },
      line: { color: "E5E7EB", width: 1 },
      rectRadius: 0.1,
    });

    // KPI value
    slide.addText(kpi.value, {
      x,
      y: y + 0.15,
      w: cardWidth,
      h: 0.55,
      fontSize: 22,
      bold: true,
      color: primary,
      align: "center",
      fontFace: "Arial",
    });

    // KPI label
    slide.addText(kpi.label, {
      x,
      y: y + 0.65,
      w: cardWidth,
      h: 0.3,
      fontSize: 9,
      color: "666666",
      align: "center",
      fontFace: "Arial",
    });

    // Trend indicator
    if (kpi.trend) {
      const trendColor =
        kpi.trendDirection === "up" ? "10B981" :
        kpi.trendDirection === "down" ? "EF4444" : "F59E0B";
      const arrow =
        kpi.trendDirection === "up" ? "▲" :
        kpi.trendDirection === "down" ? "▼" : "●";

      slide.addText(`${arrow} ${kpi.trend}`, {
        x: x + cardWidth - 0.8,
        y: y + 0.05,
        w: 0.75,
        h: 0.25,
        fontSize: 7,
        color: trendColor,
        align: "right",
        fontFace: "Arial",
      });
    }
  });

  addFooter(slide, config, pageNum);
}

function addTableSlide(
  pptx: PptxGenJS,
  title: string,
  headers: string[],
  rows: string[][],
  config: PowerPointConfig,
  pageNum: number
): void {
  const slide = pptx.addSlide();
  const primary = cleanHex(config.primaryColor || "#2563eb");

  slide.addText(title, {
    x: SLIDE_MARGIN,
    y: 0.3,
    w: "90%",
    h: 0.5,
    fontSize: TITLE_FONT_SIZE - 4,
    bold: true,
    color: primary,
    fontFace: "Arial",
  });

  // Build table data
  const headerRow: PptxGenJS.TableCell[] = headers.map((h) => ({
    text: h,
    options: {
      bold: true,
      fontSize: 9,
      color: "FFFFFF",
      fill: { color: primary },
      align: "center" as const,
      valign: "middle" as const,
    },
  }));

  const dataRows: PptxGenJS.TableCell[][] = rows.slice(0, 15).map((row, idx) =>
    row.map((cell) => ({
      text: cell,
      options: {
        fontSize: 8,
        color: "333333",
        fill: { color: idx % 2 === 0 ? "FFFFFF" : "F8FAFC" },
        align: "center" as const,
        valign: "middle" as const,
      },
    }))
  );

  const tableData = [headerRow, ...dataRows];
  const colW = headers.map(() => 9 / headers.length);

  slide.addTable(tableData, {
    x: SLIDE_MARGIN,
    y: 1.0,
    w: 9,
    colW,
    border: { type: "solid", pt: 0.5, color: "E5E7EB" },
    autoPage: true,
    autoPageRepeatHeader: true,
    autoPageLineWeight: 0.25,
  });

  addFooter(slide, config, pageNum);
}

function addChartSlide(
  pptx: PptxGenJS,
  title: string,
  chartType: "bar" | "line" | "pie" | "doughnut",
  chartData: Array<{ name: string; values: number[] }>,
  labels: string[],
  config: PowerPointConfig,
  pageNum: number
): void {
  const slide = pptx.addSlide();
  const primary = cleanHex(config.primaryColor || "#2563eb");

  slide.addText(title, {
    x: SLIDE_MARGIN,
    y: 0.3,
    w: "90%",
    h: 0.5,
    fontSize: TITLE_FONT_SIZE - 4,
    bold: true,
    color: primary,
    fontFace: "Arial",
  });

  const pptxChartType =
    chartType === "bar" ? pptx.ChartType.bar :
    chartType === "line" ? pptx.ChartType.line :
    chartType === "pie" ? pptx.ChartType.pie :
    pptx.ChartType.doughnut;

  const data = chartData.map((d) => ({
    name: d.name,
    labels,
    values: d.values,
  }));

  const colors = ["2563EB", "10B981", "EF4444", "F59E0B", "8B5CF6", "EC4899"];

  slide.addChart(pptxChartType, data, {
    x: 0.8,
    y: 1.0,
    w: 8.4,
    h: 3.8,
    showTitle: false,
    showLegend: true,
    legendPos: "b",
    legendFontSize: 8,
    chartColors: colors.slice(0, chartData.length),
    valAxisLabelFontSize: 8,
    catAxisLabelFontSize: 8,
    catAxisOrientation: "minMax",
    valGridLine: { color: "E5E7EB", style: "dash", size: 0.5 },
  });

  addFooter(slide, config, pageNum);
}

// ─── Main Export Functions ─────────────────────────────────────────────────

/**
 * Export dashboard data as PowerPoint
 */
export async function exportDashboardToPowerPoint(
  slides: DashboardSlideData[],
  config: PowerPointConfig
): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.author = config.author || "SYNAPSE";
  pptx.company = config.companyName || "SYNAPSE";
  pptx.title = config.title;
  pptx.subject = config.subtitle || "Dashboard Report";
  pptx.layout = "LAYOUT_WIDE"; // 13.33 x 7.5

  // Title slide  
  addTitleSlide(pptx, config);

  let pageNum = 2;

  for (const slideData of slides) {
    // KPI slide
    if (slideData.kpis.length > 0) {
      addKPISlide(pptx, slideData.title, slideData.kpis, config, pageNum++);
    }

    // Chart slides
    if (config.includeCharts && slideData.charts) {
      for (const chart of slideData.charts) {
        addChartSlide(pptx, chart.title, chart.type, chart.data, chart.labels, config, pageNum++);
      }
    }

    // Table slides
    if (slideData.tables) {
      for (const table of slideData.tables) {
        addTableSlide(pptx, table.title, table.headers, table.rows, config, pageNum++);
      }
    }
  }

  // Generate buffer
  const result = await pptx.write({ outputType: "nodebuffer" });
  return result as Buffer;
}

/**
 * Export Quality Report data as PowerPoint
 */
export async function exportQualityReportToPowerPoint(
  data: QualityReportData,
  config: PowerPointConfig = { title: "Báo cáo chất lượng" }
): Promise<Buffer> {
  const slides: DashboardSlideData[] = [];

  // Slide 1: KPIs
  slides.push({
    title: "Tổng quan chất lượng",
    kpis: [
      { label: "Tổng kiểm tra", value: data.summary.totalInspections.toLocaleString("vi-VN") },
      { label: "OK", value: data.summary.okCount.toLocaleString("vi-VN") },
      { label: "NG", value: data.summary.ngCount.toLocaleString("vi-VN") },
      { label: "Yield Rate", value: `${data.summary.yieldRate.toFixed(1)}%`, trendDirection: data.summary.yieldRate >= 95 ? "up" : data.summary.yieldRate >= 90 ? "same" : "down" },
      { label: "NTF", value: data.summary.ntfCount.toLocaleString("vi-VN") },
      { label: "NG Rate", value: `${data.summary.ngRate.toFixed(1)}%`, trendDirection: data.summary.ngRate <= 5 ? "up" : "down" },
    ],
    charts: [
      {
        type: "line",
        title: "Xu hướng theo ngày",
        data: [
          { name: "OK", values: data.dailyTrend.map((d) => d.okCount) },
          { name: "NG", values: data.dailyTrend.map((d) => d.ngCount) },
        ],
        labels: data.dailyTrend.map((d) => d.date),
      },
      {
        type: "bar",
        title: "So sánh theo máy",
        data: [
          { name: "OK", values: data.byMachine.slice(0, 10).map((m) => m.okCount) },
          { name: "NG", values: data.byMachine.slice(0, 10).map((m) => m.ngCount) },
        ],
        labels: data.byMachine.slice(0, 10).map((m) => m.machineCode || m.machineName),
      },
    ],
    tables: [
      {
        title: "Top điểm NG",
        headers: ["#", "Điểm đo", "Số lượng NG", "Tỷ lệ (%)"],
        rows: data.topNGPoints.slice(0, 10).map((p, i) => [
          String(i + 1),
          p.pointName,
          String(p.ngCount),
          `${p.percentage.toFixed(1)}%`,
        ]),
      },
    ],
  });

  // Slide group 2: Machine details
  slides.push({
    title: "Chi tiết theo máy",
    kpis: [],
    tables: [
      {
        title: "Hiệu suất từng máy",
        headers: ["Máy", "Mã", "Tổng", "OK", "NG", "Yield %"],
        rows: data.byMachine.map((m) => [
          m.machineName,
          m.machineCode,
          String(m.totalInspections),
          String(m.okCount),
          String(m.ngCount),
          `${m.yieldRate.toFixed(1)}%`,
        ]),
      },
    ],
  });

  return exportDashboardToPowerPoint(slides, {
    ...config,
    subtitle: `${new Date(data.period.start).toLocaleDateString("vi-VN")} - ${new Date(data.period.end).toLocaleDateString("vi-VN")}`,
    includeCharts: true,
  });
}

/**
 * Export comparison result as PowerPoint
 */
export async function exportComparisonToPowerPoint(
  data: {
    currentPeriod: { start: string; end: string; summary: { totalInspections: number; okCount: number; ngCount: number; yieldRate: number; ngRate: number } };
    previousPeriod: { start: string; end: string; summary: { totalInspections: number; okCount: number; ngCount: number; yieldRate: number; ngRate: number } };
    machineComparison: Array<{ machineName: string; machineCode: string; current: { yieldRate: number }; previous: { yieldRate: number }; yieldChange: number }>;
  },
  config: PowerPointConfig = { title: "Báo cáo so sánh" }
): Promise<Buffer> {
  const slides: DashboardSlideData[] = [];

  const c = data.currentPeriod.summary;
  const p = data.previousPeriod.summary;

  slides.push({
    title: "So sánh kỳ hiện tại vs kỳ trước",
    kpis: [
      {
        label: "Tổng kiểm tra",
        value: c.totalInspections.toLocaleString("vi-VN"),
        trend: `${p.totalInspections > 0 ? (((c.totalInspections - p.totalInspections) / p.totalInspections) * 100).toFixed(1) : "N/A"}%`,
        trendDirection: c.totalInspections >= p.totalInspections ? "up" : "down",
      },
      {
        label: "Yield Rate",
        value: `${c.yieldRate.toFixed(1)}%`,
        trend: `${(c.yieldRate - p.yieldRate).toFixed(1)}pp`,
        trendDirection: c.yieldRate >= p.yieldRate ? "up" : "down",
      },
      {
        label: "NG Rate",
        value: `${c.ngRate.toFixed(1)}%`,
        trend: `${(c.ngRate - p.ngRate).toFixed(1)}pp`,
        trendDirection: c.ngRate <= p.ngRate ? "up" : "down",
      },
      {
        label: "OK Count",
        value: c.okCount.toLocaleString("vi-VN"),
        trend: `${p.okCount > 0 ? (((c.okCount - p.okCount) / p.okCount) * 100).toFixed(1) : "N/A"}%`,
        trendDirection: c.okCount >= p.okCount ? "up" : "down",
      },
    ],
    charts: [
      {
        type: "bar",
        title: "So sánh theo máy (Yield Rate)",
        data: [
          { name: "Kỳ hiện tại", values: data.machineComparison.slice(0, 10).map((m) => m.current.yieldRate) },
          { name: "Kỳ trước", values: data.machineComparison.slice(0, 10).map((m) => m.previous.yieldRate) },
        ],
        labels: data.machineComparison.slice(0, 10).map((m) => m.machineCode || m.machineName),
      },
    ],
    tables: [
      {
        title: "Thay đổi yield theo máy",
        headers: ["Máy", "Mã", "Yield hiện tại", "Yield trước", "Thay đổi"],
        rows: data.machineComparison.map((m) => [
          m.machineName,
          m.machineCode,
          `${m.current.yieldRate.toFixed(1)}%`,
          `${m.previous.yieldRate.toFixed(1)}%`,
          `${m.yieldChange > 0 ? "+" : ""}${m.yieldChange.toFixed(1)}%`,
        ]),
      },
    ],
  });

  return exportDashboardToPowerPoint(slides, {
    ...config,
    includeCharts: true,
  });
}
