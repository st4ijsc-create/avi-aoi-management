import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

interface PDFExportOptions {
  title: string;
  subtitle?: string;
  companyName?: string;
  logoUrl?: string;
  orientation?: 'portrait' | 'landscape';
  pageSize?: 'a4' | 'letter';
}

interface ChartData {
  elementId: string;
  title: string;
}

interface TableData {
  headers: string[];
  rows: (string | number)[][];
  title?: string;
}

interface StatsData {
  label: string;
  value: string | number;
  change?: number;
  changeLabel?: string;
}

export class PDFExportService {
  private pdf: jsPDF;
  private currentY: number = 20;
  private pageWidth: number;
  private pageHeight: number;
  private margin: number = 15;
  private contentWidth: number;

  constructor(options: PDFExportOptions) {
    this.pdf = new jsPDF({
      orientation: options.orientation || 'portrait',
      unit: 'mm',
      format: options.pageSize || 'a4',
    });

    this.pageWidth = this.pdf.internal.pageSize.getWidth();
    this.pageHeight = this.pdf.internal.pageSize.getHeight();
    this.contentWidth = this.pageWidth - 2 * this.margin;

    // Add header
    this.addHeader(options);
  }

  private addHeader(options: PDFExportOptions) {
    // Company name
    if (options.companyName) {
      this.pdf.setFontSize(10);
      this.pdf.setTextColor(100, 100, 100);
      this.pdf.text(options.companyName, this.margin, this.currentY);
      this.currentY += 8;
    }

    // Title
    this.pdf.setFontSize(18);
    this.pdf.setTextColor(0, 0, 0);
    this.pdf.text(options.title, this.margin, this.currentY);
    this.currentY += 8;

    // Subtitle
    if (options.subtitle) {
      this.pdf.setFontSize(11);
      this.pdf.setTextColor(100, 100, 100);
      this.pdf.text(options.subtitle, this.margin, this.currentY);
      this.currentY += 6;
    }

    // Date
    this.pdf.setFontSize(9);
    this.pdf.setTextColor(150, 150, 150);
    const dateStr = `Ngay xuat: ${new Date().toLocaleDateString('vi-VN')} ${new Date().toLocaleTimeString('vi-VN')}`;
    this.pdf.text(dateStr, this.margin, this.currentY);
    this.currentY += 10;

    // Divider line
    this.pdf.setDrawColor(200, 200, 200);
    this.pdf.line(this.margin, this.currentY, this.pageWidth - this.margin, this.currentY);
    this.currentY += 10;
  }

  private checkNewPage(requiredHeight: number) {
    if (this.currentY + requiredHeight > this.pageHeight - 20) {
      this.pdf.addPage();
      this.currentY = 20;
      return true;
    }
    return false;
  }

  addSectionTitle(title: string) {
    this.checkNewPage(15);
    this.pdf.setFontSize(14);
    this.pdf.setTextColor(50, 50, 50);
    this.pdf.text(title, this.margin, this.currentY);
    this.currentY += 8;
  }

  addText(text: string, fontSize: number = 10) {
    this.checkNewPage(10);
    this.pdf.setFontSize(fontSize);
    this.pdf.setTextColor(80, 80, 80);
    
    const lines = this.pdf.splitTextToSize(text, this.contentWidth);
    this.pdf.text(lines, this.margin, this.currentY);
    this.currentY += lines.length * (fontSize * 0.4) + 5;
  }

  addStatsCards(stats: StatsData[]) {
    this.checkNewPage(30);
    
    const cardWidth = (this.contentWidth - (stats.length - 1) * 5) / stats.length;
    const cardHeight = 25;
    
    stats.forEach((stat, index) => {
      const x = this.margin + index * (cardWidth + 5);
      
      // Card background
      this.pdf.setFillColor(245, 245, 245);
      this.pdf.roundedRect(x, this.currentY, cardWidth, cardHeight, 2, 2, 'F');
      
      // Label
      this.pdf.setFontSize(8);
      this.pdf.setTextColor(100, 100, 100);
      this.pdf.text(stat.label, x + 3, this.currentY + 6);
      
      // Value
      this.pdf.setFontSize(14);
      this.pdf.setTextColor(30, 30, 30);
      this.pdf.text(String(stat.value), x + 3, this.currentY + 15);
      
      // Change indicator
      if (stat.change !== undefined) {
        const changeColor = stat.change > 0 ? [34, 197, 94] : stat.change < 0 ? [239, 68, 68] : [100, 100, 100];
        this.pdf.setFontSize(8);
        this.pdf.setTextColor(changeColor[0], changeColor[1], changeColor[2]);
        const changeText = `${stat.change > 0 ? '+' : ''}${stat.change.toFixed(1)}%`;
        this.pdf.text(changeText, x + 3, this.currentY + 21);
      }
    });
    
    this.currentY += cardHeight + 10;
  }

  addTable(data: TableData) {
    this.checkNewPage(50);
    
    if (data.title) {
      this.pdf.setFontSize(11);
      this.pdf.setTextColor(50, 50, 50);
      this.pdf.text(data.title, this.margin, this.currentY);
      this.currentY += 6;
    }

    const colWidth = this.contentWidth / data.headers.length;
    const rowHeight = 8;
    
    // Header
    this.pdf.setFillColor(240, 240, 240);
    this.pdf.rect(this.margin, this.currentY, this.contentWidth, rowHeight, 'F');
    this.pdf.setFontSize(9);
    this.pdf.setTextColor(50, 50, 50);
    
    data.headers.forEach((header, i) => {
      this.pdf.text(header, this.margin + i * colWidth + 2, this.currentY + 5);
    });
    this.currentY += rowHeight;
    
    // Rows
    this.pdf.setTextColor(80, 80, 80);
    data.rows.forEach((row, rowIndex) => {
      if (this.checkNewPage(rowHeight)) {
        // Re-add header on new page
        this.pdf.setFillColor(240, 240, 240);
        this.pdf.rect(this.margin, this.currentY, this.contentWidth, rowHeight, 'F');
        this.pdf.setFontSize(9);
        this.pdf.setTextColor(50, 50, 50);
        data.headers.forEach((header, i) => {
          this.pdf.text(header, this.margin + i * colWidth + 2, this.currentY + 5);
        });
        this.currentY += rowHeight;
        this.pdf.setTextColor(80, 80, 80);
      }
      
      // Alternate row background
      if (rowIndex % 2 === 0) {
        this.pdf.setFillColor(250, 250, 250);
        this.pdf.rect(this.margin, this.currentY, this.contentWidth, rowHeight, 'F');
      }
      
      row.forEach((cell, i) => {
        const cellText = String(cell).substring(0, 20);
        this.pdf.text(cellText, this.margin + i * colWidth + 2, this.currentY + 5);
      });
      this.currentY += rowHeight;
    });
    
    this.currentY += 10;
  }

  async addChartFromElement(elementId: string, title?: string) {
    const element = document.getElementById(elementId);
    if (!element) {
      console.warn(`Element ${elementId} not found`);
      return;
    }

    try {
      const canvas = await html2canvas(element, {
        scale: 2,
        backgroundColor: '#ffffff',
        logging: false,
      });

      const imgData = canvas.toDataURL('image/png');
      const imgWidth = this.contentWidth;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;

      this.checkNewPage(imgHeight + 15);

      if (title) {
        this.pdf.setFontSize(11);
        this.pdf.setTextColor(50, 50, 50);
        this.pdf.text(title, this.margin, this.currentY);
        this.currentY += 6;
      }

      this.pdf.addImage(imgData, 'PNG', this.margin, this.currentY, imgWidth, imgHeight);
      this.currentY += imgHeight + 10;
    } catch (error) {
      console.error('Error capturing chart:', error);
    }
  }

  addFooter() {
    const totalPages = this.pdf.getNumberOfPages();
    
    for (let i = 1; i <= totalPages; i++) {
      this.pdf.setPage(i);
      this.pdf.setFontSize(8);
      this.pdf.setTextColor(150, 150, 150);
      
      // Page number
      const pageText = `Trang ${i}/${totalPages}`;
      this.pdf.text(pageText, this.pageWidth - this.margin - 20, this.pageHeight - 10);
      
      // Footer line
      this.pdf.setDrawColor(200, 200, 200);
      this.pdf.line(this.margin, this.pageHeight - 15, this.pageWidth - this.margin, this.pageHeight - 15);
      
      // Generated by
      this.pdf.text('AVI/AOI Management System', this.margin, this.pageHeight - 10);
    }
  }

  save(filename: string) {
    this.addFooter();
    this.pdf.save(filename);
  }

  getBlob(): Blob {
    this.addFooter();
    return this.pdf.output('blob');
  }
}

// Helper function to export comparison report
export async function exportComparisonPDF(
  stats1: { total: number; ok: number; ng: number; ntf: number; yieldRate: number },
  stats2: { total: number; ok: number; ng: number; ntf: number; yieldRate: number },
  period1Label: string,
  period2Label: string,
  chartIds: string[]
) {
  const pdf = new PDFExportService({
    title: 'Bao cao So sanh Chat luong',
    subtitle: `${period1Label} vs ${period2Label}`,
    companyName: 'AVI/AOI Factory Management',
    orientation: 'portrait',
  });

  // Calculate changes
  const calcChange = (current: number, previous: number) => {
    if (previous === 0) return current > 0 ? 100 : 0;
    return ((current - previous) / previous * 100);
  };

  // Add stats cards
  pdf.addSectionTitle('Tong quan');
  pdf.addStatsCards([
    { label: 'Tong san pham', value: stats1.total.toLocaleString(), change: calcChange(stats1.total, stats2.total) },
    { label: 'San pham OK', value: stats1.ok.toLocaleString(), change: calcChange(stats1.ok, stats2.ok) },
    { label: 'San pham NG', value: stats1.ng.toLocaleString(), change: calcChange(stats1.ng, stats2.ng) },
    { label: 'San pham NTF', value: stats1.ntf.toLocaleString(), change: calcChange(stats1.ntf, stats2.ntf) },
    { label: 'Yield Rate', value: `${stats1.yieldRate.toFixed(2)}%`, change: stats1.yieldRate - stats2.yieldRate },
  ]);

  // Add comparison table
  pdf.addTable({
    title: 'Chi tiet so sanh',
    headers: ['Chi so', period1Label, period2Label, 'Thay doi'],
    rows: [
      ['Tong san pham', stats1.total, stats2.total, `${calcChange(stats1.total, stats2.total).toFixed(1)}%`],
      ['San pham OK', stats1.ok, stats2.ok, `${calcChange(stats1.ok, stats2.ok).toFixed(1)}%`],
      ['San pham NG', stats1.ng, stats2.ng, `${calcChange(stats1.ng, stats2.ng).toFixed(1)}%`],
      ['San pham NTF', stats1.ntf, stats2.ntf, `${calcChange(stats1.ntf, stats2.ntf).toFixed(1)}%`],
      ['Yield Rate', `${stats1.yieldRate.toFixed(2)}%`, `${stats2.yieldRate.toFixed(2)}%`, `${(stats1.yieldRate - stats2.yieldRate).toFixed(2)} diem`],
    ],
  });

  // Add charts
  pdf.addSectionTitle('Bieu do');
  for (const chartId of chartIds) {
    await pdf.addChartFromElement(chartId);
  }

  // Save
  const filename = `comparison_report_${new Date().toISOString().split('T')[0]}.pdf`;
  pdf.save(filename);
}

// Helper function to export analysis report
export async function exportAnalysisPDF(
  stats: { total: number; ok: number; ng: number; ntf: number; yieldRate: number },
  dateRange: string,
  chartIds: string[]
) {
  const pdf = new PDFExportService({
    title: 'Bao cao Phan tich Chat luong',
    subtitle: dateRange,
    companyName: 'AVI/AOI Factory Management',
    orientation: 'portrait',
  });

  // Add stats
  pdf.addSectionTitle('Tong quan');
  pdf.addStatsCards([
    { label: 'Tong san pham', value: stats.total.toLocaleString() },
    { label: 'San pham OK', value: stats.ok.toLocaleString() },
    { label: 'San pham NG', value: stats.ng.toLocaleString() },
    { label: 'San pham NTF', value: stats.ntf.toLocaleString() },
    { label: 'Yield Rate', value: `${stats.yieldRate.toFixed(2)}%` },
  ]);

  // Add charts
  pdf.addSectionTitle('Bieu do phan tich');
  for (const chartId of chartIds) {
    await pdf.addChartFromElement(chartId);
  }

  const filename = `analysis_report_${new Date().toISOString().split('T')[0]}.pdf`;
  pdf.save(filename);
}
