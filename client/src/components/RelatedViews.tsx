/**
 * U7 (doc 21 §6 / §3 G-11) — Related-views cross-link rail.
 *
 * A compact, reversible cross-linking strip placed near a dashboard's header so
 * users can hop between GENUINELY-DIFFERENTIATED overlapping surfaces (e.g. the
 * operational Dashboard ↔ the Ecosystem Command Center, the 2D what-if twin ↔ the
 * 3D twin center, WIP dispatch ↔ the MES control tower) instead of us deleting a
 * page that offers unique data/audience.
 *
 * Purely presentational + navigational (wouter <Link>). No data, no side effects.
 * Labels are i18n keys with an English default fallback so nothing breaks if a
 * key is missing. Each link points at an EXISTING route.
 */
import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";

export interface RelatedViewLink {
  href: string;
  /** i18n key (falls back to `label`'s default via t()). */
  labelKey: string;
  /** English default shown when the i18n key is absent. */
  labelDefault: string;
  icon?: React.ReactNode;
}

// ─────────────────────────────────────────────────────────────────────────────
// doc 67 W5 (việc 6) — MAP QUAN HỆ TẬP TRUNG, 2 CHIỀU, cho các màn overview.
//
// Đây là đường truy cập CHÍNH tới các trang đã rút khỏi menu (command-center /
// dashboard / corporate-dashboard / executive — xem COLLAPSED_INTO_HUB trong
// navigation.tsx), nên map này phải phủ đủ và đối xứng: mọi cặp A→B mà cả A lẫn B
// đều render RelatedViews thì B→A cũng có mặt. /andon là TV thuần (không render
// rail) — chỉ xuất hiện làm ĐÍCH. Nhãn dùng CHÍNH key menu nav.* (việc 2: h1 =
// breadcrumb = menu = RelatedViews, 1 key/trang).
// ─────────────────────────────────────────────────────────────────────────────

/** Overview pages that render (or are targeted by) the related-views rail. */
export type RelatedPageId =
  | "control-tower"
  | "command-center"
  | "dashboard"
  | "ops-console"
  | "andon"
  | "drill-down"
  | "corporate-dashboard"
  | "executive";

/** pageId → canonical link (route + the SAME nav.* i18n key the menu uses). */
const PAGE_LINKS: Record<RelatedPageId, RelatedViewLink> = {
  "control-tower": { href: "/control-tower", labelKey: "nav.controlTower", labelDefault: "Factory Overview" },
  "command-center": { href: "/command-center", labelKey: "nav.commandCenter", labelDefault: "Layout & Digital Twin" },
  dashboard: { href: "/dashboard", labelKey: "nav.dashboardMain", labelDefault: "Production Quality" },
  "ops-console": { href: "/ops-console", labelKey: "nav.opsConsole", labelDefault: "Alert Response" },
  andon: { href: "/andon", labelKey: "nav.andonBoard", labelDefault: "Andon Board (TV)" },
  "drill-down": { href: "/drill-down", labelKey: "nav.drillDown", labelDefault: "Corporate Analytics" },
  "corporate-dashboard": { href: "/corporate-dashboard", labelKey: "nav.corporateDashboard", labelDefault: "Corporate Overview" },
  executive: { href: "/executive", labelKey: "nav.executiveMobile", labelDefault: "Executive Briefing" },
};

/**
 * Symmetric relations (kept 2-chiều by hand; every non-TV pair listed both ways):
 *   control-tower ↔ mọi trang con · command-center ↔ dashboard/ops-console ·
 *   dashboard ↔ drill-down/andon · ops-console ↔ andon · drill-down ↔ corporate ·
 *   corporate ↔ executive.
 */
const RELATED_MAP: Record<RelatedPageId, readonly RelatedPageId[]> = {
  "control-tower": ["command-center", "dashboard", "ops-console", "andon", "drill-down", "corporate-dashboard", "executive"],
  "command-center": ["control-tower", "dashboard", "ops-console"],
  dashboard: ["control-tower", "command-center", "drill-down", "andon"],
  "ops-console": ["control-tower", "command-center", "andon"],
  andon: [], // TV board — never renders the rail (target only).
  "drill-down": ["control-tower", "dashboard", "corporate-dashboard"],
  "corporate-dashboard": ["control-tower", "drill-down", "executive"],
  executive: ["control-tower", "corporate-dashboard"],
};

/** Resolve the centralized related links for a page (empty when unknown). */
export function getRelatedLinks(pageId: RelatedPageId): RelatedViewLink[] {
  return (RELATED_MAP[pageId] ?? []).map((id) => PAGE_LINKS[id]);
}

export interface RelatedViewsProps {
  /** Explicit links (legacy call-sites). Ignored when `pageId` is given. */
  links?: RelatedViewLink[];
  /** Overview page id → links resolved from the centralized 2-way map above. */
  pageId?: RelatedPageId;
  /** Leading label (i18n key + default). Defaults to "Related views". */
  titleKey?: string;
  titleDefault?: string;
  className?: string;
}

export function RelatedViews({
  links: linksProp,
  pageId,
  titleKey = "related.title",
  titleDefault = "Related views",
  className,
}: RelatedViewsProps) {
  const { t } = useTranslation();
  const links = pageId ? getRelatedLinks(pageId) : linksProp ?? [];
  if (!links.length) return null;
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 text-sm text-muted-foreground",
        className,
      )}
    >
      <span className="font-medium">{t(titleKey, titleDefault)}:</span>
      {links.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className="inline-flex min-h-10 items-center gap-1 rounded-full border border-border bg-muted/40 px-3 py-1 text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          {l.icon}
          {t(l.labelKey, l.labelDefault)}
          <ArrowUpRight className="h-3 w-3 opacity-60" />
        </Link>
      ))}
    </div>
  );
}

export default RelatedViews;
