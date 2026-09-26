/**
 * F1 (doc 23 §4 Table B) — ecosystem DOMAIN registry.
 *
 * The ordered set of top-level ecosystem modules surfaced as the domain grid on
 * the SYNAPSE homepage (the automation-ecosystem front door). Each entry maps a
 * conceptual DOMAIN to its real canonical landing route (verified against
 * App.tsx routing). Labels/blurbs are i18n keys under `domains.*`.
 *
 * This is a marketing/orientation surface — it does NOT enforce RBAC. Each target
 * route runs its own RouteGuard; a user without access is handled there. Keep the
 * list short (~8) and conceptual, not a full nav (F2 owns navigation.tsx).
 */
import {
  Factory,
  ShieldCheck,
  Cpu,
  Bot,
  Boxes,
  BrainCircuit,
  BarChart3,
  Network,
  type LucideIcon,
} from "lucide-react";

export interface DomainTile {
  /** Stable key (React key + analytics). */
  key: string;
  icon: LucideIcon;
  /** i18n key → short label. */
  labelKey: string;
  /** i18n key → one-line blurb. */
  blurbKey: string;
  /** Canonical landing route (verified in App.tsx). */
  href: string;
}

export const DOMAINS: DomainTile[] = [
  {
    key: "production",
    icon: Factory,
    labelKey: "domains.production.label",
    blurbKey: "domains.production.blurb",
    href: "/production-dashboard",
  },
  {
    key: "quality",
    icon: ShieldCheck,
    labelKey: "domains.quality.label",
    blurbKey: "domains.quality.blurb",
    href: "/quality-cockpit",
  },
  {
    key: "devices",
    icon: Cpu,
    labelKey: "domains.devices.label",
    blurbKey: "domains.devices.blurb",
    href: "/device-monitor",
  },
  {
    key: "robotics",
    icon: Bot,
    labelKey: "domains.robotics.label",
    blurbKey: "domains.robotics.blurb",
    href: "/fleet-orchestration",
  },
  {
    key: "twin",
    icon: Boxes,
    labelKey: "domains.twin.label",
    blurbKey: "domains.twin.blurb",
    href: "/digital-twin-center",
  },
  {
    key: "ai",
    icon: BrainCircuit,
    labelKey: "domains.ai.label",
    blurbKey: "domains.ai.blurb",
    // doc 69 T6 — /ai-hub retired/merged into /ai-home (still redirects for
    // old bookmarks; this internal link points straight at the new landing).
    href: "/ai-home",
  },
  {
    key: "analytics",
    icon: BarChart3,
    labelKey: "domains.analytics.label",
    blurbKey: "domains.analytics.blurb",
    href: "/reports",
  },
  {
    key: "governance",
    icon: Network,
    labelKey: "domains.governance.label",
    blurbKey: "domains.governance.blurb",
    href: "/federation-dashboard",
  },
];

export default DOMAINS;
