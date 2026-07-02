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
