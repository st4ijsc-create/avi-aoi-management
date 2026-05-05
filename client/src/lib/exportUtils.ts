/**
 * Export utilities for analytics
 * CSV, JSON, PNG export functionality
 */

import { EXPORT_FORMATS } from '@/lib/analyticsConstants';

export interface ExportData {
  [key: string]: string | number | boolean;
}

/**
 * Convert data array to CSV format
 */
export function exportToCSV(
  data: ExportData[],
  filename: string = 'export.csv'
): void {
  if (!data.length) return;

  const headers = Object.keys(data[0]);
  const csvContent = [
    headers.join(','),
    ...data.map((row) =>
      headers.map((header) => {
        const value = row[header];
        // Escape quotes and wrap in quotes if contains comma
        if (typeof value === 'string' && (value.includes(',') || value.includes('"'))) {
          return `"${value.replace(/"/g, '""')}"`;
        }
        return value;
      }).join(',')
    ),
  ].join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  downloadFile(blob, filename, 'csv');
}

/**
 * Convert data array to JSON format
 */
export function exportToJSON(
  data: ExportData[] | Record<string, any>,
  filename: string = 'export.json'
): void {
  const jsonContent = JSON.stringify(data, null, 2);
  const blob = new Blob([jsonContent], { type: 'application/json;charset=utf-8;' });
  downloadFile(blob, filename, 'json');
}

/**
 * Export chart as PNG using html2canvas (requires installation)
 * For now, provide a placeholder that shows toast
 */
export async function exportChartToPNG(
  elementId: string,
  filename: string = 'chart.png'
): Promise<void> {
  try {
    // Dynamic import to avoid requiring html2canvas as hard dependency
    const html2canvas = (await import('html2canvas')).default;
    const element = document.getElementById(elementId);
    
    if (!element) {
      throw new Error(`Element with id "${elementId}" not found`);
    }

    const canvas = await html2canvas(element, {
      backgroundColor: '#ffffff',
      scale: 2,
    });

    const link = document.createElement('a');
    link.href = canvas.toDataURL('image/png');
    link.download = filename;
    link.click();
  } catch (error) {
    console.error('Error exporting to PNG:', error);
    // Show toast notification to user
    throw error;
  }
}

/**
 * Export table data to CSV with headers
 */
export function exportTableToCSV(
  tableElement: HTMLTableElement,
  filename: string = 'table.csv'
): void {
  const rows = Array.from(tableElement.querySelectorAll('tr'));
  const data = rows.map((row) =>
    Array.from(row.querySelectorAll('th, td'))
      .map((cell) => cell.textContent?.trim() || '')
  );

  if (!data.length) return;

  const csvContent = data.map((row) =>
    row
      .map((cell) => {
        if (cell.includes(',') || cell.includes('"')) {
          return `"${cell.replace(/"/g, '""')}"`;
        }
        return cell;
      })
      .join(',')
  ).join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  downloadFile(blob, filename, 'csv');
}

/**
 * Helper: Download blob as file
 */
function downloadFile(blob: Blob, filename: string, format: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename.endsWith(EXPORT_FORMATS[format as keyof typeof EXPORT_FORMATS]?.ext)
    ? filename
    : `${filename}${EXPORT_FORMATS[format as keyof typeof EXPORT_FORMATS]?.ext || ''}`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Format data for time-series export (chart data)
 */
export function formatChartDataForExport(
  data: Array<{ date: string; [key: string]: any }>,
  title: string = 'Chart Data'
): ExportData[] {
  return data.map((item) => ({
    Date: item.date,
    ...item,
  }));
}

/**
 * Generate CSV report header with metadata
 */
export function generateReportHeader(
  title: string,
  dateRange: { start: string; end: string },
  metadata: Record<string, string> = {}
): string {
  const lines = [
    `# ${title}`,
    `Generated: ${new Date().toISOString()}`,
    `Date Range: ${dateRange.start} to ${dateRange.end}`,
    ...Object.entries(metadata).map(([key, value]) => `${key}: ${value}`),
    '',
  ];
  return lines.join('\n');
}
