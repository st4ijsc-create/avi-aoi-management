/**
 * dashboardTemplateApply
 *
 * Shared logic for turning a dashboard *template* (a list of widget ids + a
 * grid layout in {i,x,y,w,h} form) into the concrete `WidgetConfig[]` shape that
 * a user custom dashboard stores (and that CustomDashboardViewer renders on the
 * main Dashboard "custom" tab).
 *
 * This is what makes template "Apply" actually persist a real layout: the caller
 * passes the result to `dashboardWidget.createCustomDashboard`, which writes to
 * `userCustomDashboards` — the exact table CustomDashboardViewer reads back.
 */
import type { WidgetConfig, WidgetType } from "@/components/DashboardWidgetLibrary";

export interface TemplateLayoutItem {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

// Valid widget types accepted by the custom-dashboard renderer.
const VALID_WIDGET_TYPES = new Set<WidgetType>([
  "kpi-card",
  "bar-chart",
  "line-chart",
  "pie-chart",
  "gauge",
  "table",
  "map",
  "alert-list",
  "activity-feed",
  "trend-indicator",
  "clock",
  "target-progress",
  "production-volume",
  "machine-status",
  "top-ng-points",
  "throughput",
  "yield-rate",
  "recent-alerts",
]);

/**
 * Map the loose widget ids used by SYSTEM_TEMPLATES (e.g. "production-stats",
 * "yield-chart") onto concrete, renderable WidgetType values. Unknown ids fall
 * back to a generic KPI card so applying never silently drops a tile.
 */
const TEMPLATE_WIDGET_TYPE_MAP: Record<string, WidgetType> = {
  // production-overview
  "production-stats": "kpi-card",
  "yield-chart": "yield-rate",
  "machine-status": "machine-status",
  "hourly-trend": "line-chart",
  // quality-control
  "ng-analysis": "pie-chart",
  "spc-chart": "line-chart",
  "defect-pareto": "top-ng-points",
  "quality-trend": "line-chart",
  // machine-health
  "machine-uptime": "machine-status",
  "oee-gauge": "gauge",
  "alert-summary": "alert-list",
  "maintenance-calendar": "table",
  // executive-summary
  "kpi-cards": "kpi-card",
  "factory-comparison": "bar-chart",
  "monthly-trend": "line-chart",
  "top-issues": "top-ng-points",
  // realtime-monitoring
  "live-production": "production-volume",
  "active-alerts": "recent-alerts",
  "machine-map": "machine-status",
  "recent-inspections": "table",
  // alert-management
  "alert-timeline": "activity-feed",
  "alert-rules": "table",
  "notification-stats": "kpi-card",
  "escalation-matrix": "table",
};

function resolveWidgetType(id: string): WidgetType {
  if (VALID_WIDGET_TYPES.has(id as WidgetType)) return id as WidgetType;
  return TEMPLATE_WIDGET_TYPE_MAP[id] ?? "kpi-card";
}

function widthToSize(w: number): WidgetConfig["size"] {
  // Templates use a 12-col grid; the custom dashboard uses a 4-col grid.
  if (w >= 11) return "full";
  if (w >= 7) return "large";
  if (w >= 4) return "medium";
  return "small";
}

function titleFromId(id: string): string {
  return id
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/**
 * Convert a template (widget ids + optional grid layout) into WidgetConfig[].
 * Accepts either a `layout` array ({i,x,y,w,h}) or a bare `widgets` string[].
 */
export function templateToCustomDashboardWidgets(opts: {
  widgets?: string[];
  layout?: TemplateLayoutItem[];
}): WidgetConfig[] {
  const { widgets = [], layout } = opts;

  if (layout && layout.length > 0) {
    return layout.map((item, index) => ({
      id: `w_${Date.now()}_${index}`,
      type: resolveWidgetType(item.i),
      title: titleFromId(item.i),
      size: widthToSize(item.w),
      position: { x: item.x ?? 0, y: item.y ?? index },
      config: {},
    }));
  }

  return widgets.map((id, index) => ({
    id: `w_${Date.now()}_${index}`,
    type: resolveWidgetType(id),
    title: titleFromId(id),
    size: "medium",
    position: { x: 0, y: index },
    config: {},
  }));
}
