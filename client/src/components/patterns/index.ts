/**
 * DS F1b — canonical pattern components (doc 16 §12.2).
 *
 * Additive, opt-in building blocks layered on top of shadcn/ui (new-york).
 * Import from "@/components/patterns" for consistency on NEW pages; existing
 * pages are not required to migrate (see doc 17 §rollout).
 */
export { PageHeader } from "./PageHeader";
export type { PageHeaderProps } from "./PageHeader";

export { MetricCard } from "./MetricCard";
export type { MetricCardProps, MetricTone } from "./MetricCard";

export { StatusBadge } from "./StatusBadge";
export type { StatusBadgeProps, StatusMapEntry, BadgeVariant } from "./StatusBadge";

export { SectionCard } from "./SectionCard";
export type { SectionCardProps } from "./SectionCard";

export { Heading, Text } from "./Heading";
export type { HeadingProps, TextProps } from "./Heading";

// Re-export the pre-existing EmptyState so the pattern set is complete from one
// import. (Implementation lives in components/EmptyState.tsx — unchanged.)
export { EmptyState } from "../EmptyState";
export type { EmptyStateVariant } from "../EmptyState";

// Design-token runtime constants (motion springs, spacing, radius, elevation).
export { motion, fadeInUp, spacing, radius, elevation } from "./tokens";
export type { Tone } from "./tokens";
