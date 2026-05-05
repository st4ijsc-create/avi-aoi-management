/**
 * Analytics Constants
 * Centralized configuration for analytics pages
 */

export const ANALYTICS_COLORS = [
  '#ef4444', // Red
  '#f97316', // Orange
  '#eab308', // Yellow
  '#22c55e', // Green
  '#06b6d4', // Cyan
  '#3b82f6', // Blue
  '#8b5cf6', // Purple
  '#ec4899', // Pink
  '#14b8a6', // Teal
  '#f59e0b', // Amber
];

export const COLOR_PALETTE = {
  success: '#22c55e',
  warning: '#eab308',
  error: '#ef4444',
  info: '#3b82f6',
  critical: '#dc2626',
  good: '#16a34a',
  neutral: '#6b7280',
};

export const CHART_HEIGHT = {
  small: 200,
  medium: 250,
  large: 350,
  xLarge: 400,
};

export const PAGINATION = {
  defaultPageSize: 10,
  pageSizeOptions: [10, 20, 50, 100],
};

export const DATE_RANGE_PRESETS = {
  '7d': { label: 'Last 7 days', days: 7 },
  '14d': { label: 'Last 14 days', days: 14 },
  '30d': { label: 'Last 30 days', days: 30 },
  '90d': { label: 'Last 90 days', days: 90 },
  'month': { label: 'This month', days: null }, // Special handling
  'quarter': { label: 'This quarter', days: null },
};

export const THRESHOLD = {
  yieldGood: 95, // >= 95%
  yieldWarning: 90, // 90-95%
  yieldCritical: 90, // < 90%
  defectGood: 5, // < 5%
  defectWarning: 10, // 5-10%
  defectCritical: 10, // > 10%
};

export const CONFIDENCE_LEVELS = {
  high: 'Confidence: 90%+',
  medium: 'Confidence: 70-90%',
  low: 'Confidence: <70%',
};

export const TREND_INDICATORS = {
  improving: '↑',
  declining: '↓',
  stable: '→',
};

// Local storage keys for preferences
export const LOCAL_STORAGE_KEYS = {
  lastDateRange: 'analytics:lastDateRange',
  lastActiveTab: 'analytics:lastActiveTab',
  chartPreferences: 'analytics:chartPreferences',
  pageSize: 'analytics:pageSize',
};

// Export options for charts
export const EXPORT_FORMATS = {
  csv: { label: 'CSV', ext: '.csv', mime: 'text/csv' },
  json: { label: 'JSON', ext: '.json', mime: 'application/json' },
  png: { label: 'PNG', ext: '.png', mime: 'image/png' },
  pdf: { label: 'PDF', ext: '.pdf', mime: 'application/pdf' },
};
