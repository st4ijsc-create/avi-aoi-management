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

export interface RelatedViewsProps {
  links: RelatedViewLink[];
  /** Leading label (i18n key + default). Defaults to "Related views". */
  titleKey?: string;
  titleDefault?: string;
  className?: string;
}

export function RelatedViews({
  links,
  titleKey = "related.title",
  titleDefault = "Related views",
  className,
}: RelatedViewsProps) {
  const { t } = useTranslation();
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
          className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-3 py-1 text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
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
