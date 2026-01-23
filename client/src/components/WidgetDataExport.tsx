import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Download, FileJson, FileSpreadsheet, FileCode, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';

export interface WidgetData {
  id: string;
  title: string;
  type: string;
  data: Record<string, unknown> | unknown[];
  metadata?: {
    timestamp: number;
    filters?: Record<string, unknown>;
    user?: string;
  };
}

interface WidgetDataExportProps {
  widgetId: string;
  widgetTitle: string;
  getData: () => Promise<WidgetData>;
  className?: string;
  size?: 'sm' | 'default';
}

// Helper to convert data to CSV
function convertToCSV(data: unknown[], headers?: string[]): string {
  if (!data || data.length === 0) return '';
  
  const firstItem = data[0];
  const keys = headers || (typeof firstItem === 'object' && firstItem !== null 
    ? Object.keys(firstItem) 
    : ['value']);
  
  const csvRows: string[] = [];
  
  // Header row
  csvRows.push(keys.join(','));
  
  // Data rows
  data.forEach(item => {
    const values = keys.map(key => {
      const value = typeof item === 'object' && item !== null 
        ? (item as Record<string, unknown>)[key] 
        : item;
      
      // Handle different types
      if (value === null || value === undefined) return '';
      if (typeof value === 'string') {
        // Escape quotes and wrap in quotes if contains comma
        const escaped = value.replace(/"/g, '""');
        return value.includes(',') || value.includes('"') || value.includes('\n') 
          ? `"${escaped}"` 
          : escaped;
      }
      if (typeof value === 'object') return JSON.stringify(value).replace(/"/g, '""');
      return String(value);
    });
    csvRows.push(values.join(','));
  });
  
  return csvRows.join('\n');
}

// Helper to convert data to HTML table
function convertToHTML(widgetData: WidgetData): string {
  const { title, type, data, metadata } = widgetData;
  const timestamp = metadata?.timestamp ? new Date(metadata.timestamp).toLocaleString() : new Date().toLocaleString();
  
  let tableHTML = '';
  
  if (Array.isArray(data) && data.length > 0) {
    const firstItem = data[0];
    const keys = typeof firstItem === 'object' && firstItem !== null 
      ? Object.keys(firstItem) 
      : ['value'];
    
    tableHTML = `
      <table style="width: 100%; border-collapse: collapse; margin-top: 20px;">
        <thead>
          <tr style="background-color: #f3f4f6;">
            ${keys.map(key => `<th style="padding: 12px; text-align: left; border: 1px solid #e5e7eb; font-weight: 600;">${key}</th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${data.map((item, idx) => `
            <tr style="background-color: ${idx % 2 === 0 ? '#ffffff' : '#f9fafb'};">
              ${keys.map(key => {
                const value = typeof item === 'object' && item !== null 
                  ? (item as Record<string, unknown>)[key] 
                  : item;
                const displayValue = value === null || value === undefined 
                  ? '-' 
                  : typeof value === 'object' 
                    ? JSON.stringify(value) 
                    : String(value);
                return `<td style="padding: 12px; border: 1px solid #e5e7eb;">${displayValue}</td>`;
              }).join('')}
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } else if (typeof data === 'object' && data !== null) {
    // Object data - display as key-value pairs
    const entries = Object.entries(data);
    tableHTML = `
      <table style="width: 100%; border-collapse: collapse; margin-top: 20px;">
        <thead>
          <tr style="background-color: #f3f4f6;">
            <th style="padding: 12px; text-align: left; border: 1px solid #e5e7eb; font-weight: 600; width: 30%;">Property</th>
            <th style="padding: 12px; text-align: left; border: 1px solid #e5e7eb; font-weight: 600;">Value</th>
          </tr>
        </thead>
        <tbody>
          ${entries.map(([key, value], idx) => `
            <tr style="background-color: ${idx % 2 === 0 ? '#ffffff' : '#f9fafb'};">
              <td style="padding: 12px; border: 1px solid #e5e7eb; font-weight: 500;">${key}</td>
              <td style="padding: 12px; border: 1px solid #e5e7eb;">${
                value === null || value === undefined 
                  ? '-' 
                  : typeof value === 'object' 
                    ? JSON.stringify(value, null, 2) 
                    : String(value)
              }</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }
  
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} - Export</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      color: #1f2937;
      max-width: 1200px;
      margin: 0 auto;
      padding: 40px 20px;
      background-color: #f9fafb;
    }
    .container {
      background-color: #ffffff;
      border-radius: 8px;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
      padding: 30px;
    }
    .header {
      border-bottom: 2px solid #e5e7eb;
      padding-bottom: 20px;
      margin-bottom: 20px;
    }
    .title {
      font-size: 24px;
      font-weight: 700;
      color: #111827;
      margin: 0 0 8px 0;
    }
    .metadata {
      display: flex;
      gap: 20px;
      flex-wrap: wrap;
      font-size: 14px;
      color: #6b7280;
    }
    .metadata-item {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .badge {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 9999px;
      font-size: 12px;
      font-weight: 500;
      background-color: #dbeafe;
      color: #1e40af;
    }
    .footer {
      margin-top: 30px;
      padding-top: 20px;
      border-top: 1px solid #e5e7eb;
      font-size: 12px;
      color: #9ca3af;
      text-align: center;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1 class="title">${title}</h1>
      <div class="metadata">
        <div class="metadata-item">
          <span class="badge">${type}</span>
        </div>
        <div class="metadata-item">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"></circle>
            <polyline points="12 6 12 12 16 14"></polyline>
          </svg>
          <span>Exported: ${timestamp}</span>
        </div>
        ${metadata?.user ? `
        <div class="metadata-item">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
            <circle cx="12" cy="7" r="4"></circle>
          </svg>
          <span>By: ${metadata.user}</span>
        </div>
        ` : ''}
      </div>
    </div>
    
    <div class="content">
      ${tableHTML || '<p style="color: #6b7280;">No data available</p>'}
    </div>
    
    <div class="footer">
      <p>Generated by AVI/AOI Factory Management System</p>
    </div>
  </div>
</body>
</html>
  `.trim();
}

// Download helper
function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function WidgetDataExport({ 
  widgetId, 
  widgetTitle, 
  getData, 
  className = '',
  size = 'sm'
}: WidgetDataExportProps) {
  const { t } = useTranslation();
  const [isExporting, setIsExporting] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewData, setPreviewData] = useState<WidgetData | null>(null);
  const [previewFormat, setPreviewFormat] = useState<'json' | 'csv' | 'html'>('json');

  const handleExport = useCallback(async (format: 'json' | 'csv' | 'html') => {
    setIsExporting(true);
    try {
      const widgetData = await getData();
      const timestamp = new Date().toISOString().split('T')[0];
      const baseFilename = `${widgetId}-${timestamp}`;
      
      switch (format) {
        case 'json': {
          const jsonContent = JSON.stringify(widgetData, null, 2);
          downloadFile(jsonContent, `${baseFilename}.json`, 'application/json');
          toast.success(t('common.exportSuccess', 'Exported successfully'));
          break;
        }
        case 'csv': {
          const data = Array.isArray(widgetData.data) ? widgetData.data : [widgetData.data];
          const csvContent = convertToCSV(data);
          downloadFile(csvContent, `${baseFilename}.csv`, 'text/csv');
          toast.success(t('common.exportSuccess', 'Exported successfully'));
          break;
        }
        case 'html': {
          const htmlContent = convertToHTML(widgetData);
          downloadFile(htmlContent, `${baseFilename}.html`, 'text/html');
          toast.success(t('common.exportSuccess', 'Exported successfully'));
          break;
        }
      }
    } catch (error) {
      console.error('Export error:', error);
      toast.error(t('common.exportError', 'Export failed'));
    } finally {
      setIsExporting(false);
    }
  }, [getData, widgetId, t]);

  const handlePreview = useCallback(async (format: 'json' | 'csv' | 'html') => {
    setIsExporting(true);
    try {
      const widgetData = await getData();
      setPreviewData(widgetData);
      setPreviewFormat(format);
      setPreviewOpen(true);
    } catch (error) {
      console.error('Preview error:', error);
      toast.error(t('common.error', 'Error loading data'));
    } finally {
      setIsExporting(false);
    }
  }, [getData, t]);

  const getPreviewContent = useCallback(() => {
    if (!previewData) return '';
    
    switch (previewFormat) {
      case 'json':
        return JSON.stringify(previewData, null, 2);
      case 'csv': {
        const data = Array.isArray(previewData.data) ? previewData.data : [previewData.data];
        return convertToCSV(data);
      }
      case 'html':
        return convertToHTML(previewData);
      default:
        return '';
    }
  }, [previewData, previewFormat]);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button 
            variant="ghost" 
            size={size === 'sm' ? 'icon' : 'default'}
            className={`${size === 'sm' ? 'h-6 w-6' : ''} ${className}`}
            disabled={isExporting}
          >
            {isExporting ? (
              <Loader2 className={`${size === 'sm' ? 'h-3 w-3' : 'h-4 w-4'} animate-spin`} />
            ) : (
              <Download className={size === 'sm' ? 'h-3 w-3' : 'h-4 w-4'} />
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuLabel>{t('dashboard.exportData', 'Export Data')}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          
          <DropdownMenuItem onClick={() => handleExport('json')}>
            <FileJson className="h-4 w-4 mr-2 text-yellow-600" />
            <span>JSON</span>
          </DropdownMenuItem>
          
          <DropdownMenuItem onClick={() => handleExport('csv')}>
            <FileSpreadsheet className="h-4 w-4 mr-2 text-green-600" />
            <span>CSV</span>
          </DropdownMenuItem>
          
          <DropdownMenuItem onClick={() => handleExport('html')}>
            <FileCode className="h-4 w-4 mr-2 text-blue-600" />
            <span>HTML</span>
          </DropdownMenuItem>
          
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-xs text-muted-foreground">Preview</DropdownMenuLabel>
          
          <DropdownMenuItem onClick={() => handlePreview('json')}>
            <FileJson className="h-4 w-4 mr-2 text-yellow-600 opacity-60" />
            <span className="text-muted-foreground">Preview JSON</span>
          </DropdownMenuItem>
          
          <DropdownMenuItem onClick={() => handlePreview('csv')}>
            <FileSpreadsheet className="h-4 w-4 mr-2 text-green-600 opacity-60" />
            <span className="text-muted-foreground">Preview CSV</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Preview Dialog */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-4xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle>{widgetTitle} - {previewFormat.toUpperCase()} Preview</DialogTitle>
            <DialogDescription>
              Preview the data before exporting
            </DialogDescription>
          </DialogHeader>
          
          <div className="overflow-auto max-h-[50vh] bg-muted/50 rounded-lg p-4">
            <pre className="text-sm font-mono whitespace-pre-wrap break-all">
              {getPreviewContent()}
            </pre>
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreviewOpen(false)}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button onClick={() => {
              handleExport(previewFormat);
              setPreviewOpen(false);
            }}>
              <Download className="h-4 w-4 mr-2" />
              {t('common.download', 'Download')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// Dashboard-level export component
interface DashboardDataExportProps {
  getAllWidgetsData: () => Promise<WidgetData[]>;
  dashboardTitle?: string;
}

export function DashboardDataExport({ getAllWidgetsData, dashboardTitle = 'Dashboard' }: DashboardDataExportProps) {
  const { t } = useTranslation();
  const [isExporting, setIsExporting] = useState(false);

  const handleExportAll = useCallback(async (format: 'json' | 'html') => {
    setIsExporting(true);
    try {
      const allData = await getAllWidgetsData();
      const timestamp = new Date().toISOString().split('T')[0];
      const baseFilename = `dashboard-export-${timestamp}`;
      
      if (format === 'json') {
        const jsonContent = JSON.stringify({
          title: dashboardTitle,
          exportedAt: new Date().toISOString(),
          widgets: allData,
        }, null, 2);
        downloadFile(jsonContent, `${baseFilename}.json`, 'application/json');
        toast.success(t('common.exportSuccess', 'Exported successfully'));
      } else {
        // Generate comprehensive HTML report
        const htmlContent = generateDashboardHTML(allData, dashboardTitle);
        downloadFile(htmlContent, `${baseFilename}.html`, 'text/html');
        toast.success(t('common.exportSuccess', 'Exported successfully'));
      }
    } catch (error) {
      console.error('Dashboard export error:', error);
      toast.error(t('common.exportError', 'Export failed'));
    } finally {
      setIsExporting(false);
    }
  }, [getAllWidgetsData, dashboardTitle, t]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={isExporting}>
          {isExporting ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Download className="h-4 w-4 mr-2" />
          )}
          {t('dashboard.exportAll', 'Export All')}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{t('dashboard.exportDashboard', 'Export Dashboard')}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => handleExportAll('json')}>
          <FileJson className="h-4 w-4 mr-2 text-yellow-600" />
          <span>Export as JSON</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleExportAll('html')}>
          <FileCode className="h-4 w-4 mr-2 text-blue-600" />
          <span>Export as HTML Report</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Generate comprehensive HTML report for all widgets
function generateDashboardHTML(widgets: WidgetData[], title: string): string {
  const timestamp = new Date().toLocaleString();
  
  const widgetSections = widgets.map(widget => {
    let tableHTML = '';
    
    if (Array.isArray(widget.data) && widget.data.length > 0) {
      const firstItem = widget.data[0];
      const keys = typeof firstItem === 'object' && firstItem !== null 
        ? Object.keys(firstItem) 
        : ['value'];
      
      tableHTML = `
        <table>
          <thead>
            <tr>
              ${keys.map(key => `<th>${key}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${widget.data.slice(0, 50).map((item, idx) => `
              <tr class="${idx % 2 === 0 ? 'even' : 'odd'}">
                ${keys.map(key => {
                  const value = typeof item === 'object' && item !== null 
                    ? (item as Record<string, unknown>)[key] 
                    : item;
                  const displayValue = value === null || value === undefined 
                    ? '-' 
                    : typeof value === 'object' 
                      ? JSON.stringify(value) 
                      : String(value);
                  return `<td>${displayValue}</td>`;
                }).join('')}
              </tr>
            `).join('')}
          </tbody>
        </table>
        ${widget.data.length > 50 ? `<p class="truncated">Showing 50 of ${widget.data.length} records</p>` : ''}
      `;
    } else if (typeof widget.data === 'object' && widget.data !== null) {
      const entries = Object.entries(widget.data);
      tableHTML = `
        <div class="kv-grid">
          ${entries.map(([key, value]) => `
            <div class="kv-item">
              <span class="kv-key">${key}</span>
              <span class="kv-value">${
                value === null || value === undefined 
                  ? '-' 
                  : typeof value === 'object' 
                    ? JSON.stringify(value) 
                    : String(value)
              }</span>
            </div>
          `).join('')}
        </div>
      `;
    }
    
    return `
      <section class="widget-section">
        <div class="widget-header">
          <h2>${widget.title}</h2>
          <span class="widget-type">${widget.type}</span>
        </div>
        <div class="widget-content">
          ${tableHTML || '<p class="no-data">No data available</p>'}
        </div>
      </section>
    `;
  }).join('');
  
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} - Dashboard Export</title>
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      color: #1f2937;
      background-color: #f3f4f6;
    }
    .container {
      max-width: 1400px;
      margin: 0 auto;
      padding: 40px 20px;
    }
    .header {
      background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%);
      color: white;
      padding: 40px;
      border-radius: 12px;
      margin-bottom: 30px;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
    }
    .header h1 {
      font-size: 32px;
      font-weight: 700;
      margin-bottom: 8px;
    }
    .header .subtitle {
      opacity: 0.9;
      font-size: 16px;
    }
    .summary {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 20px;
      margin-bottom: 30px;
    }
    .summary-card {
      background: white;
      padding: 24px;
      border-radius: 12px;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
    }
    .summary-card .label {
      font-size: 14px;
      color: #6b7280;
      margin-bottom: 4px;
    }
    .summary-card .value {
      font-size: 28px;
      font-weight: 700;
      color: #1e40af;
    }
    .widget-section {
      background: white;
      border-radius: 12px;
      margin-bottom: 24px;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
      overflow: hidden;
    }
    .widget-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 20px 24px;
      border-bottom: 1px solid #e5e7eb;
      background-color: #f9fafb;
    }
    .widget-header h2 {
      font-size: 18px;
      font-weight: 600;
      color: #111827;
    }
    .widget-type {
      font-size: 12px;
      padding: 4px 12px;
      background-color: #dbeafe;
      color: #1e40af;
      border-radius: 9999px;
      font-weight: 500;
    }
    .widget-content {
      padding: 24px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
    }
    th {
      text-align: left;
      padding: 12px 16px;
      background-color: #f3f4f6;
      font-weight: 600;
      font-size: 14px;
      color: #374151;
      border-bottom: 2px solid #e5e7eb;
    }
    td {
      padding: 12px 16px;
      border-bottom: 1px solid #e5e7eb;
      font-size: 14px;
    }
    tr.even {
      background-color: #ffffff;
    }
    tr.odd {
      background-color: #f9fafb;
    }
    tr:hover {
      background-color: #f3f4f6;
    }
    .kv-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 16px;
    }
    .kv-item {
      display: flex;
      flex-direction: column;
      padding: 16px;
      background-color: #f9fafb;
      border-radius: 8px;
    }
    .kv-key {
      font-size: 12px;
      color: #6b7280;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 4px;
    }
    .kv-value {
      font-size: 18px;
      font-weight: 600;
      color: #111827;
    }
    .no-data {
      color: #9ca3af;
      font-style: italic;
      text-align: center;
      padding: 40px;
    }
    .truncated {
      text-align: center;
      color: #6b7280;
      font-size: 14px;
      margin-top: 16px;
      padding-top: 16px;
      border-top: 1px dashed #e5e7eb;
    }
    .footer {
      text-align: center;
      padding: 30px;
      color: #9ca3af;
      font-size: 14px;
    }
    @media print {
      body {
        background-color: white;
      }
      .widget-section {
        break-inside: avoid;
        box-shadow: none;
        border: 1px solid #e5e7eb;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>${title}</h1>
      <p class="subtitle">Dashboard Export - ${timestamp}</p>
    </div>
    
    <div class="summary">
      <div class="summary-card">
        <div class="label">Total Widgets</div>
        <div class="value">${widgets.length}</div>
      </div>
      <div class="summary-card">
        <div class="label">Export Time</div>
        <div class="value" style="font-size: 16px;">${timestamp}</div>
      </div>
    </div>
    
    ${widgetSections}
    
    <div class="footer">
      <p>Generated by AVI/AOI Factory Management System</p>
      <p>© ${new Date().getFullYear()} All rights reserved</p>
    </div>
  </div>
</body>
</html>
  `.trim();
}

export { convertToCSV, convertToHTML, downloadFile };
