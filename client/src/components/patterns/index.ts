/**
 * DS F1b — canonical pattern components (doc 16 §12.2).
 *
 * Additive, opt-in building blocks layered on top of shadcn/ui (new-york).
 * Import from "@/components/patterns" for consistency on NEW pages; existing
 * pages are not required to migrate (see doc 17 §rollout).
 */
export { PageHeader } from "./PageHeader";
export type { PageHeaderProps, BreadcrumbCrumb } from "./PageHeader";

export { PageContainer } from "./PageContainer";
export type { PageContainerProps } from "./PageContainer";

export { MetricCard } from "./MetricCard";
export type { MetricCardProps, MetricTone } from "./MetricCard";

export { StatusBadge } from "./StatusBadge";
export type { StatusBadgeProps, StatusMapEntry, BadgeVariant } from "./StatusBadge";

export { SectionCard } from "./SectionCard";
export type { SectionCardProps } from "./SectionCard";

// F1 (doc 23 §4 Table B) — shared domain/tool tile (homepage grid + role homes).
export { ToolTile } from "./ToolTile";
export type { ToolTileProps } from "./ToolTile";

export { Heading, Text } from "./Heading";
export type { HeadingProps, TextProps } from "./Heading";

// Re-export the pre-existing EmptyState so the pattern set is complete from one
// import. (Implementation lives in components/EmptyState.tsx — unchanged.)
export { EmptyState } from "../EmptyState";
export type { EmptyStateVariant } from "../EmptyState";

// Design-token runtime constants (motion springs, spacing, radius, elevation).
export { motion, fadeInUp, spacing, radius, elevation } from "./tokens";
export type { Tone } from "./tokens";

// F0 (doc 23) — recharts theme helpers (colours + tooltip/grid/axis styles).
export {
  chartColors,
  chartColor,
  chartTooltipStyle,
  chartTooltipLabelStyle,
  chartGridProps,
  chartAxisTick,
  chartAxisProps,
} from "./chartTokens";

// ── doc 39 Wave 2 — shared UI kit & pickers ──────────────────────────────────
// EntityPicker: searchable combobox over real tRPC list endpoints — replaces raw
// numeric-ID / free-text-code inputs everywhere. Presets wire the endpoints.
export {
  EntityPicker,
  MachineSelect,
  LineSelect,
  FactorySelect,
  WorkshopSelect,
  ProductModelSelect,
  WorkstationSelect,
  UserSelect,
} from "./EntityPicker";
export type { EntityOption, EntityPickerProps, EntitySelectProps } from "./EntityPicker";

// ScopeFilterBar: canonical product/line/machine/factory/date scope bar (URL-synced).
export { ScopeFilterBar, useScope } from "./ScopeFilterBar";
export type { ScopeValues, ScopeControl, ScopeFilterBarProps } from "./ScopeFilterBar";

// Themed recharts wrappers — pass data + series, get on-brand light/dark charts.
export {
  ThemedLineChart,
  ThemedAreaChart,
  ThemedBarChart,
  ThemedPieChart,
} from "./ThemedCharts";
export type { ChartSeries, BaseChartProps, ThemedPieChartProps } from "./ThemedCharts";

// Visual micro-primitives (extracted from per-page reinventions).
export { RadialGauge } from "./RadialGauge";
export type { RadialGaugeProps } from "./RadialGauge";
export { Sparkline } from "./Sparkline";
export type { SparklineProps, SparkPoint } from "./Sparkline";
export { ConnectionChip } from "./ConnectionChip";
export type { ConnectionChipProps, ConnectionState } from "./ConnectionChip";
