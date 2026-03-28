import * as db from "../db";

export interface NGVisualReportData {
  period: {
    start: Date;
    end: Date;
  };
  summary: {
    totalInspections: number;
    totalNG: number;
    ngRate: number;
    avgNGPerProduct: number;
  };
  topNGPoints: Array<{
    pointName: string;
    ngCount: number;
    percentage: number;
  }>;
  workstationHeatmap: Array<{
    workstationName: string;
    ngCount: number;
    inspectionCount: number;
    ngRate: number;
  }>;
  trendData: Array<{
    date: string;
    ngRate: number;
    inspectionCount: number;
  }>;
  filters?: {
    factoryName?: string;
    workshopName?: string;
    lineName?: string;
  };
}

export interface ReportCustomization {
  logoUrl?: string | null;
  primaryColor?: string | null;
  footerText?: string | null;
  reportFormat?: "HTML" | "PDF" | "EXCEL";
}

/**
 * Generate NG Visual report data for a specific period
 */
export async function generateNGVisualReport(options: {
  startDate: Date;
  endDate: Date;
  factoryId?: number;
  workshopId?: number;
  lineId?: number;
}): Promise<NGVisualReportData> {
  const { startDate, endDate, factoryId, workshopId, lineId } = options;

  // Get factory/workshop/line names for filters
  let filters: NGVisualReportData["filters"] = {};
  if (factoryId) {
    const factory = await db.getFactoryById(factoryId);
    filters.factoryName = factory?.name;
  }
  if (workshopId) {
    const workshop = await db.getWorkshopById(workshopId);
    filters.workshopName = workshop?.name;
  }
  if (lineId) {
    const line = await db.getLineById(lineId);
    filters.lineName = line?.name;
  }

  // Get summary data (using existing getNGTrendByDay and aggregate)
  const allTrendData = await db.getNGTrendByDay({
    startDate,
    endDate,
  });

  const totalInspections = allTrendData.reduce((sum, day) => sum + day.totalCount, 0);
  const totalNG = allTrendData.reduce((sum, day) => sum + day.ngCount, 0);
  const ngRate = totalInspections > 0 ? (totalNG / totalInspections) * 100 : 0;
  const avgNGPerProduct = totalInspections > 0 ? totalNG / totalInspections : 0;

  const summaryData = {
    totalInspections,
    totalNG,
    ngRate,
    avgNGPerProduct,
  };

  // Get top NG points (using existing getTopNGMeasurementPoints)
  const topNGData = await db.getTopNGMeasurementPoints({
    startDate,
    endDate,
    limit: 10,
  });

  // Get workstation heatmap (mock data for now - would need new DB function)
  const heatmapData: Array<{
    workstationName: string;
    ngCount: number;
    inspectionCount: number;
    ngRate: number;
  }> = [];

  // Get trend data (last 30 days)
  const trendStartDate = new Date(endDate);
  trendStartDate.setDate(trendStartDate.getDate() - 30);
  const trendData = await db.getNGTrendByDay({
    startDate: trendStartDate,
    endDate,
  });

  return {
    period: {
      start: startDate,
      end: endDate,
    },
    summary: {
      totalInspections: summaryData.totalInspections || 0,
      totalNG: summaryData.totalNG || 0,
      ngRate: summaryData.ngRate || 0,
      avgNGPerProduct: summaryData.avgNGPerProduct || 0,
    },
    topNGPoints: topNGData.map((point: any) => ({
      pointName: point.name || point.code,
      ngCount: point.ngCount,
      percentage: point.percentage,
    })),
    workstationHeatmap: heatmapData.map((ws: any) => ({
      workstationName: ws.workstationName,
      ngCount: ws.ngCount,
      inspectionCount: ws.inspectionCount,
      ngRate: ws.ngRate,
    })),
    trendData: trendData.map((day) => ({
      date: day.date,
      ngRate: day.ngRate,
      inspectionCount: day.totalCount,
    })),
    filters,
  };
}

/**
 * Generate HTML email template for NG Visual report with customization
 */
export function generateNGVisualEmailHTML(
  data: NGVisualReportData,
  customization?: ReportCustomization
): string {
  const primaryColor = customization?.primaryColor || "#667eea";
  const logoUrl = customization?.logoUrl;
  const footerText = customization?.footerText || "Báo cáo tự động từ hệ thống AVI/AOI Factory Management";

  // Generate gradient colors based on primary color
  const gradientEnd = adjustColor(primaryColor, -20);

  const formatDate = (date: Date) => {
    return new Date(date).toLocaleDateString("vi-VN", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  const formatNumber = (num: number) => {
    return Number(num || 0).toLocaleString("vi-VN");
  };

  const formatPercent = (num: number) => {
    return Number(num || 0).toFixed(2) + "%";
  };

  let filterText = "";
  if (data.filters) {
    const parts = [];
    if (data.filters.factoryName) parts.push(`Nhà máy: ${data.filters.factoryName}`);
    if (data.filters.workshopName) parts.push(`Xưởng: ${data.filters.workshopName}`);
    if (data.filters.lineName) parts.push(`Line: ${data.filters.lineName}`);
    if (parts.length > 0) {
      filterText = `<p style="color: rgba(255,255,255,0.8); font-size: 14px; margin-top: 10px;">${parts.join(" • ")}</p>`;
    }
  }

  const logoHtml = logoUrl
    ? `<img src="${logoUrl}" alt="Logo" style="max-height: 50px; max-width: 200px; margin-bottom: 15px;" />`
    : "";

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Báo cáo NG Visual</title>
</head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 800px; margin: 0 auto; padding: 20px; background-color: #f5f5f5;">
  <div style="background: linear-gradient(135deg, ${primaryColor} 0%, ${gradientEnd} 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
    ${logoHtml}
    <h1 style="color: white; margin: 0; font-size: 28px;">Báo cáo NG Visual</h1>
    <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0 0; font-size: 16px;">
      ${formatDate(data.period.start)} - ${formatDate(data.period.end)}
    </p>
    ${filterText}
  </div>

  <div style="background: #ffffff; padding: 30px; border-radius: 0 0 10px 10px;">
    <!-- Summary Section -->
    <div style="background: #f8f9fa; padding: 25px; border-radius: 8px; margin-bottom: 25px;">
      <h2 style="color: ${primaryColor}; margin-top: 0; font-size: 20px; border-bottom: 2px solid ${primaryColor}; padding-bottom: 10px;">
        📊 Tổng quan
      </h2>
      <table style="width: 100%; border-collapse: collapse; margin-top: 20px;">
        <tr>
          <td style="text-align: center; padding: 15px; background: ${adjustColor(primaryColor, 90)}; border-radius: 8px; width: 25%;">
            <div style="font-size: 28px; font-weight: bold; color: ${primaryColor};">${formatNumber(data.summary.totalInspections)}</div>
            <div style="color: #666; font-size: 12px; margin-top: 5px;">Tổng số kiểm tra</div>
          </td>
          <td style="width: 2%;"></td>
          <td style="text-align: center; padding: 15px; background: #fff0f0; border-radius: 8px; width: 25%;">
            <div style="font-size: 28px; font-weight: bold; color: #e74c3c;">${formatNumber(data.summary.totalNG)}</div>
            <div style="color: #666; font-size: 12px; margin-top: 5px;">Tổng số NG</div>
          </td>
          <td style="width: 2%;"></td>
          <td style="text-align: center; padding: 15px; background: #fff8e1; border-radius: 8px; width: 25%;">
            <div style="font-size: 28px; font-weight: bold; color: #f39c12;">${formatPercent(data.summary.ngRate)}</div>
            <div style="color: #666; font-size: 12px; margin-top: 5px;">Tỷ lệ NG</div>
          </td>
          <td style="width: 2%;"></td>
          <td style="text-align: center; padding: 15px; background: #e8f5e9; border-radius: 8px; width: 25%;">
            <div style="font-size: 28px; font-weight: bold; color: #27ae60;">${data.summary.avgNGPerProduct.toFixed(2)}</div>
            <div style="color: #666; font-size: 12px; margin-top: 5px;">TB NG/SP</div>
          </td>
        </tr>
      </table>
    </div>

    <!-- Top NG Points Section -->
    <div style="background: #f8f9fa; padding: 25px; border-radius: 8px; margin-bottom: 25px;">
      <h2 style="color: #e74c3c; margin-top: 0; font-size: 20px; border-bottom: 2px solid #e74c3c; padding-bottom: 10px;">
        🎯 Top 10 điểm NG
      </h2>
      <table style="width: 100%; border-collapse: collapse; margin-top: 15px; background: white;">
        <thead>
          <tr style="background: #f1f3f4;">
            <th style="padding: 12px; text-align: left; border-bottom: 2px solid #dee2e6; font-size: 13px; color: #555;">#</th>
            <th style="padding: 12px; text-align: left; border-bottom: 2px solid #dee2e6; font-size: 13px; color: #555;">Điểm đo</th>
            <th style="padding: 12px; text-align: right; border-bottom: 2px solid #dee2e6; font-size: 13px; color: #555;">Số lượng</th>
            <th style="padding: 12px; text-align: right; border-bottom: 2px solid #dee2e6; font-size: 13px; color: #555;">Tỷ lệ</th>
          </tr>
        </thead>
        <tbody>
          ${data.topNGPoints.slice(0, 10).map((point, index) => `
            <tr style="border-bottom: 1px solid #eee;">
              <td style="padding: 10px 12px; font-size: 13px; color: #666;">${index + 1}</td>
              <td style="padding: 10px 12px; font-size: 13px; font-weight: 500;">${point.pointName}</td>
              <td style="padding: 10px 12px; text-align: right; font-size: 13px; color: #e74c3c; font-weight: bold;">${formatNumber(point.ngCount)}</td>
              <td style="padding: 10px 12px; text-align: right; font-size: 13px;">
                <span style="background: #fee; padding: 2px 8px; border-radius: 4px; color: #c0392b;">${formatPercent(point.percentage)}</span>
              </td>
            </tr>
          `).join("")}
          ${data.topNGPoints.length === 0 ? `
            <tr>
              <td colspan="4" style="padding: 20px; text-align: center; color: #999; font-style: italic;">
                Không có dữ liệu NG trong khoảng thời gian này
              </td>
            </tr>
          ` : ""}
        </tbody>
      </table>
    </div>

    <!-- Trend Chart Section -->
    ${data.trendData.length > 0 ? `
    <div style="background: #f8f9fa; padding: 25px; border-radius: 8px; margin-bottom: 25px;">
      <h2 style="color: ${primaryColor}; margin-top: 0; font-size: 20px; border-bottom: 2px solid ${primaryColor}; padding-bottom: 10px;">
        📈 Xu hướng NG (30 ngày gần nhất)
      </h2>
      <table style="width: 100%; border-collapse: collapse; margin-top: 15px; background: white;">
        <thead>
          <tr style="background: #f1f3f4;">
            <th style="padding: 10px; text-align: left; border-bottom: 2px solid #dee2e6; font-size: 12px; color: #555;">Ngày</th>
            <th style="padding: 10px; text-align: right; border-bottom: 2px solid #dee2e6; font-size: 12px; color: #555;">Số kiểm tra</th>
            <th style="padding: 10px; text-align: right; border-bottom: 2px solid #dee2e6; font-size: 12px; color: #555;">Tỷ lệ NG</th>
            <th style="padding: 10px; text-align: left; border-bottom: 2px solid #dee2e6; font-size: 12px; color: #555;">Biểu đồ</th>
          </tr>
        </thead>
        <tbody>
          ${data.trendData.slice(-7).map((day) => {
            const barWidth = Math.min(day.ngRate * 10, 100);
            const barColor = day.ngRate > 5 ? "#e74c3c" : day.ngRate > 2 ? "#f39c12" : "#27ae60";
            return `
            <tr style="border-bottom: 1px solid #eee;">
              <td style="padding: 8px 10px; font-size: 12px;">${day.date}</td>
              <td style="padding: 8px 10px; text-align: right; font-size: 12px;">${formatNumber(day.inspectionCount)}</td>
              <td style="padding: 8px 10px; text-align: right; font-size: 12px; font-weight: bold; color: ${barColor};">${formatPercent(day.ngRate)}</td>
              <td style="padding: 8px 10px;">
                <div style="background: #eee; border-radius: 4px; height: 16px; width: 100px;">
                  <div style="background: ${barColor}; border-radius: 4px; height: 16px; width: ${barWidth}px;"></div>
                </div>
              </td>
            </tr>
          `}).join("")}
        </tbody>
      </table>
    </div>
    ` : ""}

    <!-- Workstation Heatmap Section -->
    ${data.workstationHeatmap.length > 0 ? `
    <div style="background: #f8f9fa; padding: 25px; border-radius: 8px; margin-bottom: 25px;">
      <h2 style="color: #f39c12; margin-top: 0; font-size: 20px; border-bottom: 2px solid #f39c12; padding-bottom: 10px;">
        🔥 NG theo công trạm
      </h2>
      <table style="width: 100%; border-collapse: collapse; margin-top: 15px; background: white;">
        <thead>
          <tr style="background: #f1f3f4;">
            <th style="padding: 12px; text-align: left; border-bottom: 2px solid #dee2e6; font-size: 13px; color: #555;">Công trạm</th>
            <th style="padding: 12px; text-align: right; border-bottom: 2px solid #dee2e6; font-size: 13px; color: #555;">Kiểm tra</th>
            <th style="padding: 12px; text-align: right; border-bottom: 2px solid #dee2e6; font-size: 13px; color: #555;">NG</th>
            <th style="padding: 12px; text-align: right; border-bottom: 2px solid #dee2e6; font-size: 13px; color: #555;">Tỷ lệ NG</th>
          </tr>
        </thead>
        <tbody>
          ${data.workstationHeatmap.map((ws) => {
            const bgColor = ws.ngRate > 5 ? "#fff0f0" : ws.ngRate > 2 ? "#fff8e1" : "#ffffff";
            return `
            <tr style="border-bottom: 1px solid #eee; background: ${bgColor};">
              <td style="padding: 10px 12px; font-size: 13px; font-weight: 500;">${ws.workstationName}</td>
              <td style="padding: 10px 12px; text-align: right; font-size: 13px;">${formatNumber(ws.inspectionCount)}</td>
              <td style="padding: 10px 12px; text-align: right; font-size: 13px; color: #e74c3c; font-weight: bold;">${formatNumber(ws.ngCount)}</td>
              <td style="padding: 10px 12px; text-align: right; font-size: 13px; font-weight: bold;">${formatPercent(ws.ngRate)}</td>
            </tr>
          `}).join("")}
        </tbody>
      </table>
    </div>
    ` : ""}

    <!-- Footer -->
    <div style="text-align: center; padding: 25px 20px; color: #666; font-size: 12px; border-top: 1px solid #eee; margin-top: 10px;">
      <p style="margin: 0; line-height: 1.8;">${footerText}</p>
      <p style="margin: 10px 0 0 0; color: #999;">Được tạo lúc ${new Date().toLocaleString("vi-VN")}</p>
    </div>
  </div>
</body>
</html>
  `;
}

/**
 * Adjust color brightness
 * @param color Hex color string
 * @param amount Positive to lighten, negative to darken
 */
function adjustColor(color: string, amount: number): string {
  const hex = color.replace("#", "");
  const num = parseInt(hex, 16);
  
  let r = (num >> 16) + amount;
  let g = ((num >> 8) & 0x00ff) + amount;
  let b = (num & 0x0000ff) + amount;
  
  r = Math.max(0, Math.min(255, r));
  g = Math.max(0, Math.min(255, g));
  b = Math.max(0, Math.min(255, b));
  
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

/**
 * Generate PDF report for NG Visual
 */
export async function generateNGVisualPDF(
  data: NGVisualReportData,
  customization?: ReportCustomization
): Promise<Buffer> {
  // Use puppeteer to convert HTML to PDF
  const puppeteer = await import("puppeteer");
  
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  
  try {
    const page = await browser.newPage();
    
    // Generate HTML content
    const htmlContent = generateNGVisualEmailHTML(data, customization);
    
    // Set content
    await page.setContent(htmlContent, { waitUntil: "networkidle0" });
    
    // Generate PDF
    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: {
        top: "20px",
        right: "20px",
        bottom: "20px",
        left: "20px",
      },
    });
    
    return Buffer.from(pdfBuffer);
  } finally {
    await browser.close();
  }
}

/**
 * Generate Excel report for NG Visual
 */
export async function generateNGVisualExcel(
  data: NGVisualReportData,
  customization?: ReportCustomization
): Promise<Buffer> {
  const ExcelJS = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  
  const primaryColor = customization?.primaryColor || "#667eea";
  
  // Summary Sheet
  const summarySheet = workbook.addWorksheet("Tổng quan");
  
  // Title
  summarySheet.mergeCells("A1:D1");
  const titleCell = summarySheet.getCell("A1");
  titleCell.value = "BÁO CÁO NG VISUAL";
  titleCell.font = { bold: true, size: 18, color: { argb: primaryColor.replace("#", "") } };
  titleCell.alignment = { horizontal: "center" };
  
  // Period
  summarySheet.mergeCells("A2:D2");
  const periodCell = summarySheet.getCell("A2");
  periodCell.value = `Từ ${new Date(data.period.start).toLocaleDateString("vi-VN")} đến ${new Date(data.period.end).toLocaleDateString("vi-VN")}`;
  periodCell.alignment = { horizontal: "center" };
  
  // Summary data
  summarySheet.addRow([]);
  summarySheet.addRow(["Chỉ số", "Giá trị"]);
  summarySheet.addRow(["Tổng số kiểm tra", data.summary.totalInspections]);
  summarySheet.addRow(["Tổng số NG", data.summary.totalNG]);
  summarySheet.addRow(["Tỷ lệ NG (%)", data.summary.ngRate.toFixed(2)]);
  summarySheet.addRow(["TB NG/sản phẩm", data.summary.avgNGPerProduct.toFixed(2)]);
  
  // Style header row
  const headerRow = summarySheet.getRow(4);
  headerRow.font = { bold: true };
  headerRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "F0F0F0" },
  };
  
  // Column widths
  summarySheet.getColumn(1).width = 25;
  summarySheet.getColumn(2).width = 20;
  
  // Top NG Points Sheet
  const ngPointsSheet = workbook.addWorksheet("Top NG Points");
  
  ngPointsSheet.addRow(["#", "Điểm đo", "Số lượng NG", "Tỷ lệ (%)"]);
  const ngHeaderRow = ngPointsSheet.getRow(1);
  ngHeaderRow.font = { bold: true };
  ngHeaderRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFE0E0" },
  };
  
  data.topNGPoints.forEach((point, index) => {
    ngPointsSheet.addRow([index + 1, point.pointName, point.ngCount, point.percentage.toFixed(2)]);
  });
  
  ngPointsSheet.getColumn(1).width = 5;
  ngPointsSheet.getColumn(2).width = 30;
  ngPointsSheet.getColumn(3).width = 15;
  ngPointsSheet.getColumn(4).width = 15;
  
  // Trend Data Sheet
  const trendSheet = workbook.addWorksheet("Xu hướng");
  
  trendSheet.addRow(["Ngày", "Số kiểm tra", "Tỷ lệ NG (%)"]);
  const trendHeaderRow = trendSheet.getRow(1);
  trendHeaderRow.font = { bold: true };
  trendHeaderRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "E0F0FF" },
  };
  
  data.trendData.forEach((day) => {
    trendSheet.addRow([day.date, day.inspectionCount, day.ngRate.toFixed(2)]);
  });
  
  trendSheet.getColumn(1).width = 15;
  trendSheet.getColumn(2).width = 15;
  trendSheet.getColumn(3).width = 15;
  
  // Workstation Heatmap Sheet
  if (data.workstationHeatmap.length > 0) {
    const heatmapSheet = workbook.addWorksheet("Công trạm");
    
    heatmapSheet.addRow(["Công trạm", "Số kiểm tra", "Số NG", "Tỷ lệ NG (%)"]);
    const heatmapHeaderRow = heatmapSheet.getRow(1);
    heatmapHeaderRow.font = { bold: true };
    heatmapHeaderRow.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFF8E1" },
    };
    
    data.workstationHeatmap.forEach((ws) => {
      heatmapSheet.addRow([ws.workstationName, ws.inspectionCount, ws.ngCount, ws.ngRate.toFixed(2)]);
    });
    
    heatmapSheet.getColumn(1).width = 25;
    heatmapSheet.getColumn(2).width = 15;
    heatmapSheet.getColumn(3).width = 10;
    heatmapSheet.getColumn(4).width = 15;
  }
  
  // Generate buffer
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

/**
 * Generate report in specified format
 */
export async function generateReport(
  data: NGVisualReportData,
  format: "HTML" | "PDF" | "EXCEL",
  customization?: ReportCustomization
): Promise<{ content: Buffer | string; mimeType: string; extension: string }> {
  switch (format) {
    case "PDF":
      return {
        content: await generateNGVisualPDF(data, customization),
        mimeType: "application/pdf",
        extension: "pdf",
      };
    case "EXCEL":
      return {
        content: await generateNGVisualExcel(data, customization),
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        extension: "xlsx",
      };
    case "HTML":
    default:
      return {
        content: generateNGVisualEmailHTML(data, customization),
        mimeType: "text/html",
        extension: "html",
      };
  }
}
