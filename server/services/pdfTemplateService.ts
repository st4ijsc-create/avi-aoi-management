/**
 * PDF Report Templates Service
 * Beautiful PDF templates for inspection reports and quality reports using PDFKit
 * 
 * Templates:
 * - Inspection Report (per-inspection detail)
 * - Quality Summary Report (period aggregation)
 * - Machine Performance Report
 * - NG Analysis Report
 */

// @ts-ignore - pdfkit has no bundled type declarations
import PDFDocument from "pdfkit";
import * as db from "../db";
import { registerVietnameseFontPdfKit } from "./fontAssets";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PDFReportConfig {
  title: string;
  subtitle?: string;
  logoUrl?: string;        // company logo (http(s) URL or data: URI) — drawn in header
  companyName?: string;
  primaryColor?: string;   // hex color
  accentColor?: string;
  footerText?: string;     // branding footer line (falls back to companyName)
  generatedBy?: string;
  confidential?: boolean;
  pageSize?: "A4" | "LETTER";
  orientation?: "portrait" | "landscape";
}

export interface InspectionReportData {
  inspection: {
    id: number;
    serialNumber: string;
    overallResult: string;
    inspectionTime: Date;
    machineCode?: string;
    machineName?: string;
    lineName?: string;
    stationName?: string;
    workshopName?: string;
    factoryName?: string;
    notes?: string;
    acknowledgedBy?: string;
    acknowledgedAt?: Date;
  };
  measurements: Array<{
    pointName: string;
    measurementType: string;
    result: string;
    measuredValue?: string;
    standardValue?: string;
    upperLimit?: string;
    lowerLimit?: string;
    unit?: string;
    remark?: string;
  }>;
  productModel?: {
    name: string;
    code: string;
    description?: string;
  };
}

export interface QualityReportData {
  period: { start: Date; end: Date };
  summary: {
    totalInspections: number;
    okCount: number;
    ngCount: number;
    ntfCount: number;
    yieldRate: number;
    ngRate: number;
  };
  byMachine: Array<{
    machineName: string;
    machineCode: string;
    totalInspections: number;
    okCount: number;
    ngCount: number;
    yieldRate: number;
  }>;
  topNGPoints: Array<{
    pointName: string;
    ngCount: number;
    percentage: number;
  }>;
  dailyTrend: Array<{
    date: string;
    totalInspections: number;
    okCount: number;
    ngCount: number;
    yieldRate: number;
  }>;
  filters?: {
    factoryName?: string;
    workshopName?: string;
    lineName?: string;
  };
}

// ─── Color Utilities ────────────────────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.substring(0, 2), 16),
    parseInt(h.substring(2, 4), 16),
    parseInt(h.substring(4, 6), 16),
  ];
}

function lightenColor(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  const lr = Math.min(255, r + amount);
  const lg = Math.min(255, g + amount);
  const lb = Math.min(255, b + amount);
  return `#${lr.toString(16).padStart(2, "0")}${lg.toString(16).padStart(2, "0")}${lb.toString(16).padStart(2, "0")}`;
}

// ─── Logo / letterhead (doc 32 §2 P3 #17) ────────────────────────────────────

/**
 * Resolve a company-profile logo (http(s) URL or data: URI) into a raster Buffer
 * that PDFKit's `doc.image()` can embed. Best-effort: returns undefined on any
 * failure (bad URL, non-image, oversized, fetch error) so the report always
 * renders name-only rather than crashing. PDFKit only supports PNG/JPEG — other
 * formats will throw at draw time and are caught by the caller.
 */
export async function resolveLogoBuffer(logoUrl?: string | null): Promise<Buffer | undefined> {
  if (!logoUrl) return undefined;
  try {
    if (logoUrl.startsWith("data:")) {
      const comma = logoUrl.indexOf(",");
      if (comma < 0) return undefined;
      const meta = logoUrl.slice(5, comma); // e.g. "image/png;base64"
      if (!/^image\//i.test(meta)) return undefined;
      const isB64 = /;base64/i.test(meta);
      const buf = isB64
        ? Buffer.from(logoUrl.slice(comma + 1), "base64")
        : Buffer.from(decodeURIComponent(logoUrl.slice(comma + 1)), "utf8");
      return buf.length > 0 && buf.length <= 2_000_000 ? buf : undefined;
    }
    if (!/^https?:\/\//i.test(logoUrl)) return undefined;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    const res = await fetch(logoUrl, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return undefined;
    const mime = res.headers.get("content-type") || "";
    if (mime && !/^image\//i.test(mime)) return undefined;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length > 0 && buf.length <= 2_000_000 ? buf : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Draw the letterhead logo into the coloured header band, best-effort. Returns
 * true when an image was actually embedded (so the caller can indent the title
 * text to make room). Never throws.
 */
function drawHeaderLogo(
  doc: any,
  logoBuf: Buffer | undefined,
  x: number,
  y: number,
  fit: [number, number],
): boolean {
  if (!logoBuf) return false;
  try {
    doc.image(logoBuf, x, y, { fit, align: "left", valign: "center" });
    return true;
  } catch {
    return false; // unsupported format (e.g. SVG/WEBP) → name-only fallback
  }
}

// ─── PDF Generation Functions ───────────────────────────────────────────────

/**
 * Generate a professional Inspection Report PDF
 */
export async function generateInspectionReportPDF(
  data: InspectionReportData,
  config: PDFReportConfig = { title: "Inspection Report" }
): Promise<Buffer> {
  const primary = config.primaryColor || "#2563eb";
  const accent = config.accentColor || "#10b981";
  const [pr, pg, pb] = hexToRgb(primary);

  // Resolve the branding logo before the synchronous PDFKit draw (best-effort).
  const logoBuf = await resolveLogoBuffer(config.logoUrl);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: config.pageSize || "A4",
      margin: 40,
      bufferPages: true,
      info: {
        Title: config.title,
        Author: config.companyName || "AVI/AOI Management System",
        Subject: `Inspection Report - ${data.inspection.serialNumber}`,
      },
    });

    // Embed the Vietnamese font so diacritics render (was mojibake with the
    // WinAnsi core font — doc 32 §2 P0 #4). Sets BeVietnamPro as the default.
    registerVietnameseFontPdfKit(doc);

    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // ─── Header ──────────────────────────────────────────
    doc
      .rect(0, 0, doc.page.width, 100)
      .fill(primary);

    // Letterhead logo (doc 32 §2 P3 #17) — indent the title when drawn.
    const logoDrawn = drawHeaderLogo(doc, logoBuf, 40, 22, [46, 56]);
    const headTextX = logoDrawn ? 96 : 40;

    doc
      .fontSize(22)
      .fillColor("white")
      .text(config.title, headTextX, 25, { align: "left" });

    doc
      .fontSize(10)
      .fillColor("rgba(255,255,255,0.8)")
      .text(config.companyName || "AVI/AOI Factory Management", headTextX, 55, { align: "left" });

    doc
      .fontSize(10)
      .fillColor("rgba(255,255,255,0.8)")
      .text(`Generated: ${new Date().toLocaleString("vi-VN")}`, 40, 70, { align: "right", width: doc.page.width - 80 });

    if (config.confidential) {
      doc
        .fontSize(8)
        .fillColor("#ff6b6b")
        .text("CONFIDENTIAL", doc.page.width - 120, 30);
    }

    // ─── Result Badge ────────────────────────────────────
    const result = data.inspection.overallResult;
    const badgeColor = result === "OK" ? "#10b981" : result === "NG" ? "#ef4444" : "#f59e0b";
    const badgeX = doc.page.width - 130;

    doc
      .roundedRect(badgeX, 15, 80, 35, 5)
      .fill(badgeColor);

    doc
      .fontSize(18)
      .fillColor("white")
      .text(result, badgeX, 23, { width: 80, align: "center" });

    let y = 120;

    // ─── Inspection Info Section ─────────────────────────
    doc
      .fontSize(14)
      .fillColor(primary)
      .text("Thông tin kiểm tra", 40, y);

    y += 5;
    doc
      .moveTo(40, y + 15)
      .lineTo(doc.page.width - 40, y + 15)
      .strokeColor(primary)
      .lineWidth(1)
      .stroke();

    y += 25;
    const leftCol = 40;
    const rightCol = doc.page.width / 2 + 20;
    const labelWidth = 120;

    const infoRows = [
      [
        { label: "Serial Number:", value: data.inspection.serialNumber },
        { label: "Kết quả:", value: data.inspection.overallResult },
      ],
      [
        { label: "Thời gian:", value: new Date(data.inspection.inspectionTime).toLocaleString("vi-VN") },
        { label: "Máy:", value: `${data.inspection.machineName || ""} (${data.inspection.machineCode || ""})` },
      ],
      [
        { label: "Line:", value: data.inspection.lineName || "N/A" },
        { label: "Station:", value: data.inspection.stationName || "N/A" },
      ],
      [
        { label: "Xưởng:", value: data.inspection.workshopName || "N/A" },
        { label: "Nhà máy:", value: data.inspection.factoryName || "N/A" },
      ],
    ];

    doc.fontSize(10);
    for (const row of infoRows) {
      doc.fillColor("#666").text(row[0].label, leftCol, y, { width: labelWidth });
      doc.fillColor("#333").text(row[0].value, leftCol + labelWidth, y);
      if (row[1]) {
        doc.fillColor("#666").text(row[1].label, rightCol, y, { width: labelWidth });
        doc.fillColor("#333").text(row[1].value, rightCol + labelWidth, y);
      }
      y += 18;
    }

    // Product model
    if (data.productModel) {
      y += 5;
      doc.fillColor("#666").text("Sản phẩm:", leftCol, y, { width: labelWidth });
      doc.fillColor("#333").text(`${data.productModel.name} (${data.productModel.code})`, leftCol + labelWidth, y);
      y += 18;
    }

    y += 10;

    // ─── Measurement Results Table ──────────────────────
    doc
      .fontSize(14)
      .fillColor(primary)
      .text("Kết quả đo lường", 40, y);

    y += 5;
    doc
      .moveTo(40, y + 15)
      .lineTo(doc.page.width - 40, y + 15)
      .strokeColor(primary)
      .lineWidth(1)
      .stroke();

    y += 25;

    // Table headers
    const tableLeft = 40;
    const colWidths = [30, 130, 65, 70, 70, 70, 80];
    const headers = ["#", "Điểm đo", "Loại", "Kết quả", "Giá trị", "Chuẩn", "Ghi chú"];

    // Draw header row
    doc.rect(tableLeft, y, doc.page.width - 80, 22).fill(lightenColor(primary, 200));
    doc.fontSize(8).fillColor(primary);
    let hx = tableLeft + 5;
    headers.forEach((header, i) => {
      doc.text(header, hx, y + 6, { width: colWidths[i] - 10, align: i > 2 ? "center" : "left" });
      hx += colWidths[i];
    });
    y += 22;

    // Draw data rows
    doc.fontSize(8);
    data.measurements.forEach((m, index) => {
      // Check page break
      if (y > doc.page.height - 80) {
        doc.addPage();
        y = 40;
      }

      const rowBg = index % 2 === 0 ? "#ffffff" : "#f8fafc";
      doc.rect(tableLeft, y, doc.page.width - 80, 20).fill(rowBg);

      const resultColor = m.result === "OK" ? "#10b981" : m.result === "NG" ? "#ef4444" : "#f59e0b";

      let rx = tableLeft + 5;
      doc.fillColor("#666").text(String(index + 1), rx, y + 5, { width: colWidths[0] - 10 });
      rx += colWidths[0];
      doc.fillColor("#333").text(m.pointName, rx, y + 5, { width: colWidths[1] - 10 });
      rx += colWidths[1];
      doc.fillColor("#666").text(m.measurementType, rx, y + 5, { width: colWidths[2] - 10 });
      rx += colWidths[2];
      doc.fillColor(resultColor).text(m.result, rx, y + 5, { width: colWidths[3] - 10, align: "center" });
      rx += colWidths[3];
      doc.fillColor("#333").text(m.measuredValue || "-", rx, y + 5, { width: colWidths[4] - 10, align: "center" });
      rx += colWidths[4];
      doc.fillColor("#666").text(m.standardValue || "-", rx, y + 5, { width: colWidths[5] - 10, align: "center" });
      rx += colWidths[5];
      doc.fillColor("#666").text(m.remark || "", rx, y + 5, { width: colWidths[6] - 10 });

      // Bottom border
      doc.moveTo(tableLeft, y + 20).lineTo(doc.page.width - 40, y + 20).strokeColor("#e5e7eb").lineWidth(0.5).stroke();
      y += 20;
    });

    // ─── Summary stats ──────────────────────────────────
    y += 15;
    if (y > doc.page.height - 100) {
      doc.addPage();
      y = 40;
    }

    const okCount = data.measurements.filter((m) => m.result === "OK").length;
    const ngCount = data.measurements.filter((m) => m.result === "NG").length;
    const ntfCount = data.measurements.filter((m) => m.result === "NTF").length;
    const total = data.measurements.length;

    doc.rect(40, y, doc.page.width - 80, 50).fill("#f8fafc").stroke("#e5e7eb");

    doc.fontSize(10).fillColor("#333").text("Tổng kết:", 55, y + 8);
    doc.fontSize(9)
      .fillColor("#10b981").text(`OK: ${okCount}/${total}`, 55, y + 25)
      .fillColor("#ef4444").text(`NG: ${ngCount}/${total}`, 155, y + 25)
      .fillColor("#f59e0b").text(`NTF: ${ntfCount}/${total}`, 255, y + 25)
      .fillColor("#333").text(`Yield: ${total > 0 ? ((okCount / total) * 100).toFixed(1) : 0}%`, 355, y + 25);

    // ─── Notes ───────────────────────────────────────────
    if (data.inspection.notes) {
      y += 70;
      doc.fontSize(12).fillColor(primary).text("Ghi chú", 40, y);
      y += 20;
      doc.fontSize(9).fillColor("#555").text(data.inspection.notes, 40, y, { width: doc.page.width - 80 });
    }

    // ─── Footer on all pages ─────────────────────────────
    const pages = doc.bufferedPageRange();
    for (let i = 0; i < pages.count; i++) {
      doc.switchToPage(i);
      doc
        .fontSize(7)
        .fillColor("#999")
        .text(
          `${config.footerText || config.companyName || "AVI/AOI Management"} | Page ${i + 1} of ${pages.count} | ${new Date().toLocaleString("vi-VN")}`,
          40,
          doc.page.height - 30,
          { align: "center", width: doc.page.width - 80 }
        );
    }

    doc.end();
  });
}

/**
 * Generate a Quality Summary Report PDF
 */
export async function generateQualityReportPDF(
  data: QualityReportData,
  config: PDFReportConfig = { title: "Quality Summary Report" }
): Promise<Buffer> {
  const primary = config.primaryColor || "#2563eb";
  const accent = config.accentColor || "#10b981";

  // Resolve the branding logo before the synchronous PDFKit draw (best-effort).
  const logoBuf = await resolveLogoBuffer(config.logoUrl);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: config.pageSize || "A4",
      margin: 40,
      bufferPages: true,
      info: {
        Title: config.title,
        Author: config.companyName || "AVI/AOI Management System",
      },
    });

    // Embed the Vietnamese font so diacritics render (doc 32 §2 P0 #4).
    registerVietnameseFontPdfKit(doc);

    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // ─── Header ──────────────────────────────────────────
    doc.rect(0, 0, doc.page.width, 90).fill(primary);

    // Letterhead logo (doc 32 §2 P3 #17) — indent the title when drawn.
    const logoDrawn = drawHeaderLogo(doc, logoBuf, 40, 18, [44, 54]);
    const headTextX = logoDrawn ? 94 : 40;

    doc.fontSize(22).fillColor("white").text(config.title, headTextX, 20);
    doc.fontSize(11).fillColor("rgba(255,255,255,0.85)")
      .text(`${formatDateVN(data.period.start)} - ${formatDateVN(data.period.end)}`, headTextX, 48);

    if (data.filters) {
      const parts: string[] = [];
      if (data.filters.factoryName) parts.push(`Nhà máy: ${data.filters.factoryName}`);
      if (data.filters.workshopName) parts.push(`Xưởng: ${data.filters.workshopName}`);
      if (data.filters.lineName) parts.push(`Line: ${data.filters.lineName}`);
      if (parts.length > 0) {
        doc.fontSize(9).fillColor("rgba(255,255,255,0.7)").text(parts.join(" • "), headTextX, 65);
      }
    }

    let y = 110;

    // ─── KPI Cards ───────────────────────────────────────
    const cardWidth = (doc.page.width - 100) / 4;
    const cards = [
      { label: "Tổng kiểm tra", value: formatNumber(data.summary.totalInspections), color: primary },
      { label: "OK", value: formatNumber(data.summary.okCount), color: "#10b981" },
      { label: "NG", value: formatNumber(data.summary.ngCount), color: "#ef4444" },
      { label: "Yield Rate", value: `${data.summary.yieldRate.toFixed(1)}%`, color: data.summary.yieldRate >= 95 ? "#10b981" : data.summary.yieldRate >= 90 ? "#f59e0b" : "#ef4444" },
    ];

    cards.forEach((card, i) => {
      const cx = 40 + i * (cardWidth + 7);
      doc.roundedRect(cx, y, cardWidth, 65, 5).fill("#f8fafc").stroke("#e5e7eb");
      doc.fontSize(20).fillColor(card.color).text(card.value, cx, y + 10, { width: cardWidth, align: "center" });
      doc.fontSize(8).fillColor("#666").text(card.label, cx, y + 42, { width: cardWidth, align: "center" });
    });

    y += 85;

    // ─── Machine Comparison Table ────────────────────────
    doc.fontSize(14).fillColor(primary).text("So sánh theo máy", 40, y);
    y += 25;

    const mHeaders = ["Máy", "Mã", "Tổng", "OK", "NG", "Yield %"];
    const mWidths = [120, 80, 60, 60, 60, 70];

    // Header row
    doc.rect(40, y, doc.page.width - 80, 22).fill(lightenColor(primary, 200));
    doc.fontSize(8).fillColor(primary);
    let mx = 45;
    mHeaders.forEach((h, i) => {
      doc.text(h, mx, y + 6, { width: mWidths[i] - 10, align: i > 1 ? "center" : "left" });
      mx += mWidths[i];
    });
    y += 22;

    doc.fontSize(8);
    data.byMachine.slice(0, 15).forEach((machine, idx) => {
      if (y > doc.page.height - 80) { doc.addPage(); y = 40; }

      const bg = idx % 2 === 0 ? "#ffffff" : "#f8fafc";
      doc.rect(40, y, doc.page.width - 80, 18).fill(bg);

      const yieldColor = machine.yieldRate >= 95 ? "#10b981" : machine.yieldRate >= 90 ? "#f59e0b" : "#ef4444";

      let rx = 45;
      doc.fillColor("#333").text(machine.machineName, rx, y + 4, { width: mWidths[0] - 10 }); rx += mWidths[0];
      doc.fillColor("#666").text(machine.machineCode, rx, y + 4, { width: mWidths[1] - 10 }); rx += mWidths[1];
      doc.fillColor("#333").text(String(machine.totalInspections), rx, y + 4, { width: mWidths[2] - 10, align: "center" }); rx += mWidths[2];
      doc.fillColor("#10b981").text(String(machine.okCount), rx, y + 4, { width: mWidths[3] - 10, align: "center" }); rx += mWidths[3];
      doc.fillColor("#ef4444").text(String(machine.ngCount), rx, y + 4, { width: mWidths[4] - 10, align: "center" }); rx += mWidths[4];
      doc.fillColor(yieldColor).text(`${machine.yieldRate.toFixed(1)}%`, rx, y + 4, { width: mWidths[5] - 10, align: "center" });

      y += 18;
    });

    y += 20;

    // ─── Top NG Points ──────────────────────────────────
    if (y > doc.page.height - 150) { doc.addPage(); y = 40; }

    doc.fontSize(14).fillColor("#ef4444").text("Top 10 điểm NG cao nhất", 40, y);
    y += 25;

    data.topNGPoints.slice(0, 10).forEach((point, idx) => {
      if (y > doc.page.height - 40) { doc.addPage(); y = 40; }

      const barWidth = Math.max(5, (point.percentage / (data.topNGPoints[0]?.percentage || 1)) * 200);
      
      doc.fontSize(9).fillColor("#333").text(`${idx + 1}. ${point.pointName}`, 40, y);
      doc.rect(200, y + 2, barWidth, 10).fill("#ef4444");
      doc.fontSize(8).fillColor("#666").text(`${point.ngCount} (${point.percentage.toFixed(1)}%)`, 200 + barWidth + 5, y + 1);
      y += 18;
    });

    y += 20;

    // ─── Daily Trend ─────────────────────────────────────
    if (data.dailyTrend.length > 0) {
      if (y > doc.page.height - 200) { doc.addPage(); y = 40; }

      doc.fontSize(14).fillColor(primary).text("Xu hướng theo ngày", 40, y);
      y += 25;

      const tHeaders = ["Ngày", "Tổng", "OK", "NG", "Yield %"];
      const tWidths = [100, 80, 80, 80, 80];

      doc.rect(40, y, doc.page.width - 80, 20).fill(lightenColor(primary, 200));
      doc.fontSize(8).fillColor(primary);
      let tx = 45;
      tHeaders.forEach((h, i) => {
        doc.text(h, tx, y + 5, { width: tWidths[i] - 10, align: i > 0 ? "center" : "left" });
        tx += tWidths[i];
      });
      y += 20;

      data.dailyTrend.slice(-14).forEach((day, idx) => {
        if (y > doc.page.height - 40) { doc.addPage(); y = 40; }
        const bg = idx % 2 === 0 ? "#ffffff" : "#f8fafc";
        doc.rect(40, y, doc.page.width - 80, 16).fill(bg);

        let dx = 45;
        doc.fontSize(8).fillColor("#333").text(day.date, dx, y + 3, { width: tWidths[0] - 10 }); dx += tWidths[0];
        doc.fillColor("#333").text(String(day.totalInspections), dx, y + 3, { width: tWidths[1] - 10, align: "center" }); dx += tWidths[1];
        doc.fillColor("#10b981").text(String(day.okCount), dx, y + 3, { width: tWidths[2] - 10, align: "center" }); dx += tWidths[2];
        doc.fillColor("#ef4444").text(String(day.ngCount), dx, y + 3, { width: tWidths[3] - 10, align: "center" }); dx += tWidths[3];
        const yc = day.yieldRate >= 95 ? "#10b981" : day.yieldRate >= 90 ? "#f59e0b" : "#ef4444";
        doc.fillColor(yc).text(`${day.yieldRate.toFixed(1)}%`, dx, y + 3, { width: tWidths[4] - 10, align: "center" });
        y += 16;
      });
    }

    // ─── Footer ──────────────────────────────────────────
    const pages = doc.bufferedPageRange();
    for (let i = 0; i < pages.count; i++) {
      doc.switchToPage(i);
      doc.fontSize(7).fillColor("#999").text(
        `${config.footerText || config.companyName || "AVI/AOI Management"} | Page ${i + 1} of ${pages.count} | ${new Date().toLocaleString("vi-VN")}`,
        40, doc.page.height - 30, { align: "center", width: doc.page.width - 80 }
      );
    }

    doc.end();
  });
}

// ─── Helper ─────────────────────────────────────────────────────────────────

function formatDateVN(date: Date): string {
  return new Date(date).toLocaleDateString("vi-VN", {
    year: "numeric", month: "long", day: "numeric",
  });
}

function formatNumber(n: number): string {
  return n.toLocaleString("vi-VN");
}
