/**
 * Universal Data Export Service
 * Xuất PDF/Excel cho tất cả báo cáo theo ngôn ngữ hiện tại
 */
import ExcelJS from "exceljs";

export interface ExportColumn {
  key: string;
  header: string;
  width?: number;
  format?: "number" | "percentage" | "date" | "datetime" | "text";
}

export interface ExportOptions {
  title: string;
  subtitle?: string;
  columns: ExportColumn[];
  data: Record<string, any>[];
  language?: "vi" | "en" | "zh";
  fileName?: string;
  sheetName?: string;
  includeTimestamp?: boolean;
  companyName?: string;
  logoPath?: string;
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

/**
 * Generate Excel report with professional formatting
 */
export async function generateExcelReport(options: ExportOptions): Promise<Buffer> {
  const { title, subtitle, columns, data, language = "vi", sheetName = "Report", includeTimestamp = true, companyName } = options;
  const labels = LANGUAGE_LABELS[language] || LANGUAGE_LABELS.vi;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = companyName || "AVI AOI Management";
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet(sheetName);

  // Title row
  const titleRow = worksheet.addRow([title]);
  titleRow.font = { size: 16, bold: true, color: { argb: "FF1E3A5F" } };
  titleRow.height = 30;
  worksheet.mergeCells(1, 1, 1, columns.length);
  titleRow.alignment = { horizontal: "center", vertical: "middle" };

  // Subtitle
  if (subtitle) {
    const subRow = worksheet.addRow([subtitle]);
    subRow.font = { size: 12, italic: true, color: { argb: "FF666666" } };
    worksheet.mergeCells(2, 1, 2, columns.length);
    subRow.alignment = { horizontal: "center" };
  }

  // Timestamp
  if (includeTimestamp) {
    const row = worksheet.addRow([`${labels.generatedAt}: ${new Date().toLocaleString(language === "zh" ? "zh-CN" : language === "en" ? "en-US" : "vi-VN")}`]);
    row.font = { size: 10, color: { argb: "FF999999" } };
    worksheet.mergeCells(worksheet.rowCount, 1, worksheet.rowCount, columns.length);
  }

  // Empty row
  worksheet.addRow([]);

  // Header row
  const headerRow = worksheet.addRow(columns.map(c => c.header));
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  headerRow.eachCell((cell, colNumber) => {
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF1E3A5F" },
    };
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
    const rowData = columns.map(col => {
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
      cell.border = {
        bottom: { style: "thin", color: { argb: "FFE0E0E0" } },
      };
      if (isEven) {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFF8F9FA" },
        };
      }

      const col = columns[colNumber - 1];
      if (col?.format === "percentage") {
        cell.numFmt = "0.00%";
      } else if (col?.format === "number") {
        cell.numFmt = "#,##0";
      } else if (col?.format === "date") {
        cell.numFmt = "DD/MM/YYYY";
      } else if (col?.format === "datetime") {
        cell.numFmt = "DD/MM/YYYY HH:mm:ss";
      }
    });
  });

  // Total row
  const totalRow = worksheet.addRow([`${labels.total}: ${data.length} ${labels.records}`]);
  totalRow.font = { bold: true, italic: true };
  worksheet.mergeCells(worksheet.rowCount, 1, worksheet.rowCount, columns.length);

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

/**
 * Generate PDF report using jsPDF
 * Returns base64 string
 */
export async function generatePdfReport(options: ExportOptions): Promise<string> {
  const { default: jsPDF } = await import("jspdf");
  const { default: autoTable } = await import("jspdf-autotable");

  const { title, subtitle, columns, data, language = "vi", includeTimestamp = true, companyName } = options;
  const labels = LANGUAGE_LABELS[language] || LANGUAGE_LABELS.vi;

  const doc = new jsPDF({ orientation: data.length > 0 && columns.length > 6 ? "landscape" : "portrait" });

  // Title
  doc.setFontSize(18);
  doc.setTextColor(30, 58, 95);
  doc.text(title, doc.internal.pageSize.width / 2, 20, { align: "center" });

  // Subtitle
  let yPos = 28;
  if (subtitle) {
    doc.setFontSize(12);
    doc.setTextColor(100, 100, 100);
    doc.text(subtitle, doc.internal.pageSize.width / 2, yPos, { align: "center" });
    yPos += 8;
  }

  if (companyName) {
    doc.setFontSize(10);
    doc.setTextColor(120, 120, 120);
    doc.text(`${labels.company}: ${companyName}`, 14, yPos);
    yPos += 6;
  }

  if (includeTimestamp) {
    doc.setFontSize(9);
    doc.setTextColor(150, 150, 150);
    const locale = language === "zh" ? "zh-CN" : language === "en" ? "en-US" : "vi-VN";
    doc.text(`${labels.generatedAt}: ${new Date().toLocaleString(locale)}`, 14, yPos);
    yPos += 8;
  }

  // Table
  const tableColumns = columns.map(c => ({ header: c.header, dataKey: c.key }));
  const tableData = data.map(item => {
    const row: Record<string, any> = {};
    columns.forEach(col => {
      let value = item[col.key];
      if (value === null || value === undefined) {
        row[col.key] = "";
      } else if (col.format === "percentage") {
        row[col.key] = `${Number(value).toFixed(2)}%`;
      } else if (col.format === "number") {
        row[col.key] = Number(value).toLocaleString();
      } else if (col.format === "date" && value instanceof Date) {
        row[col.key] = value.toLocaleDateString(language === "zh" ? "zh-CN" : language === "en" ? "en-US" : "vi-VN");
      } else {
        row[col.key] = String(value);
      }
    });
    return row;
  });

  autoTable(doc, {
    startY: yPos,
    columns: tableColumns,
    body: tableData,
    headStyles: {
      fillColor: [30, 58, 95],
      textColor: [255, 255, 255],
      fontStyle: "bold",
      halign: "center",
    },
    alternateRowStyles: {
      fillColor: [248, 249, 250],
    },
    styles: {
      fontSize: 9,
      cellPadding: 3,
    },
    didDrawPage: (hookData: any) => {
      // Footer with page numbers
      const pageCount = doc.getNumberOfPages();
      doc.setFontSize(8);
      doc.setTextColor(150, 150, 150);
      doc.text(
        `${labels.page} ${hookData.pageNumber} / ${pageCount}`,
        doc.internal.pageSize.width / 2,
        doc.internal.pageSize.height - 10,
        { align: "center" }
      );
    },
  });

  // Total
  const finalY = (doc as any).lastAutoTable?.finalY || yPos + 20;
  doc.setFontSize(10);
  doc.setTextColor(80, 80, 80);
  doc.text(`${labels.total}: ${data.length} ${labels.records}`, 14, finalY + 10);

  return doc.output("datauristring").split(",")[1]; // Return base64 only
}
