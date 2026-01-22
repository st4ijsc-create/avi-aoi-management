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
 * Generate HTML email template for NG Visual report
 */
export function generateNGVisualEmailHTML(data: NGVisualReportData): string {
  const formatDate = (date: Date) => {
    return new Date(date).toLocaleDateString("vi-VN", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  const formatNumber = (num: number) => {
    return num.toLocaleString("vi-VN");
  };

  const formatPercent = (num: number) => {
    return num.toFixed(2) + "%";
  };

  let filterText = "";
  if (data.filters) {
    const parts = [];
    if (data.filters.factoryName) parts.push(`Nhà máy: ${data.filters.factoryName}`);
    if (data.filters.workshopName) parts.push(`Xưởng: ${data.filters.workshopName}`);
    if (data.filters.lineName) parts.push(`Line: ${data.filters.lineName}`);
    if (parts.length > 0) {
      filterText = `<p style="color: #666; font-size: 14px; margin-top: 10px;">${parts.join(" • ")}</p>`;
    }
  }

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Báo cáo NG Visual</title>
</head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 800px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
    <h1 style="color: white; margin: 0; font-size: 28px;">Báo cáo NG Visual</h1>
    <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0 0; font-size: 16px;">
      ${formatDate(data.period.start)} - ${formatDate(data.period.end)}
    </p>
    ${filterText}
  </div>

  <div style="background: #f8f9fa; padding: 30px; border-radius: 0 0 10px 10px;">
    <!-- Summary Section -->
    <div style="background: white; padding: 25px; border-radius: 8px; margin-bottom: 25px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
      <h2 style="color: #667eea; margin-top: 0; font-size: 20px; border-bottom: 2px solid #667eea; padding-bottom: 10px;">
        📊 Tổng quan
      </h2>
      <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 20px; margin-top: 20px;">
        <div style="text-align: center; padding: 15px; background: #f0f4ff; border-radius: 8px;">
          <div style="font-size: 32px; font-weight: bold; color: #667eea;">${formatNumber(data.summary.totalInspections)}</div>
          <div style="color: #666; font-size: 14px; margin-top: 5px;">Tổng số kiểm tra</div>
        </div>
        <div style="text-align: center; padding: 15px; background: #fff0f0; border-radius: 8px;">
          <div style="font-size: 32px; font-weight: bold; color: #e74c3c;">${formatNumber(data.summary.totalNG)}</div>
          <div style="color: #666; font-size: 14px; margin-top: 5px;">Tổng số NG</div>
        </div>
        <div style="text-align: center; padding: 15px; background: #fff8e1; border-radius: 8px;">
          <div style="font-size: 32px; font-weight: bold; color: #f39c12;">${formatPercent(data.summary.ngRate)}</div>
          <div style="color: #666; font-size: 14px; margin-top: 5px;">Tỷ lệ NG</div>
        </div>
        <div style="text-align: center; padding: 15px; background: #e8f5e9; border-radius: 8px;">
          <div style="font-size: 32px; font-weight: bold; color: #27ae60;">${data.summary.avgNGPerProduct.toFixed(2)}</div>
          <div style="color: #666; font-size: 14px; margin-top: 5px;">TB NG/sản phẩm</div>
        </div>
      </div>
    </div>

    <!-- Top NG Points Section -->
    <div style="background: white; padding: 25px; border-radius: 8px; margin-bottom: 25px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
      <h2 style="color: #e74c3c; margin-top: 0; font-size: 20px; border-bottom: 2px solid #e74c3c; padding-bottom: 10px;">
        🎯 Top 10 điểm NG
      </h2>
      <table style="width: 100%; border-collapse: collapse; margin-top: 15px;">
        <thead>
          <tr style="background: #f8f9fa;">
            <th style="padding: 12px; text-align: left; border-bottom: 2px solid #dee2e6; font-size: 14px;">#</th>
            <th style="padding: 12px; text-align: left; border-bottom: 2px solid #dee2e6; font-size: 14px;">Điểm đo</th>
            <th style="padding: 12px; text-align: right; border-bottom: 2px solid #dee2e6; font-size: 14px;">Số lượng</th>
            <th style="padding: 12px; text-align: right; border-bottom: 2px solid #dee2e6; font-size: 14px;">Tỷ lệ</th>
          </tr>
        </thead>
        <tbody>
          ${data.topNGPoints.slice(0, 10).map((point, index) => `
            <tr style="border-bottom: 1px solid #dee2e6;">
              <td style="padding: 12px; font-size: 14px;">${index + 1}</td>
              <td style="padding: 12px; font-size: 14px; font-weight: 500;">${point.pointName}</td>
              <td style="padding: 12px; text-align: right; font-size: 14px; color: #e74c3c; font-weight: bold;">${formatNumber(point.ngCount)}</td>
              <td style="padding: 12px; text-align: right; font-size: 14px;">${formatPercent(point.percentage)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>

    <!-- Workstation Heatmap Section -->
    <div style="background: white; padding: 25px; border-radius: 8px; margin-bottom: 25px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
      <h2 style="color: #f39c12; margin-top: 0; font-size: 20px; border-bottom: 2px solid #f39c12; padding-bottom: 10px;">
        🔥 NG theo công trạm
      </h2>
      <table style="width: 100%; border-collapse: collapse; margin-top: 15px;">
        <thead>
          <tr style="background: #f8f9fa;">
            <th style="padding: 12px; text-align: left; border-bottom: 2px solid #dee2e6; font-size: 14px;">Công trạm</th>
            <th style="padding: 12px; text-align: right; border-bottom: 2px solid #dee2e6; font-size: 14px;">Kiểm tra</th>
            <th style="padding: 12px; text-align: right; border-bottom: 2px solid #dee2e6; font-size: 14px;">NG</th>
            <th style="padding: 12px; text-align: right; border-bottom: 2px solid #dee2e6; font-size: 14px;">Tỷ lệ NG</th>
          </tr>
        </thead>
        <tbody>
          ${data.workstationHeatmap.map((ws) => {
            const bgColor = ws.ngRate > 5 ? "#fff0f0" : ws.ngRate > 2 ? "#fff8e1" : "#f0f4ff";
            return `
            <tr style="border-bottom: 1px solid #dee2e6; background: ${bgColor};">
              <td style="padding: 12px; font-size: 14px; font-weight: 500;">${ws.workstationName}</td>
              <td style="padding: 12px; text-align: right; font-size: 14px;">${formatNumber(ws.inspectionCount)}</td>
              <td style="padding: 12px; text-align: right; font-size: 14px; color: #e74c3c; font-weight: bold;">${formatNumber(ws.ngCount)}</td>
              <td style="padding: 12px; text-align: right; font-size: 14px; font-weight: bold;">${formatPercent(ws.ngRate)}</td>
            </tr>
          `}).join("")}
        </tbody>
      </table>
    </div>

    <!-- Footer -->
    <div style="text-align: center; padding: 20px; color: #666; font-size: 12px;">
      <p style="margin: 0;">Báo cáo tự động từ hệ thống AVI/AOI Factory Management</p>
      <p style="margin: 5px 0 0 0;">Được tạo lúc ${new Date().toLocaleString("vi-VN")}</p>
    </div>
  </div>
</body>
</html>
  `;
}
