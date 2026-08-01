/**
 * doc 46 FE-W3.2 — <DrillSpine>: the ONE canonical hierarchy spine for the
 * drill-down, shared shape across the whole SYNAPSE platform:
 *
 *   Corporate → Factory → Workshop → Line → Station → Machine
 *
 * Two rows:
 *   1. BREADCRUMB — the drilled path (Home / Corp / Factory / Line), each crumb
 *      clickable to jump back to that tier. A LIVE badge (socket + 60s poll).
 *   2. TIER STEPPER — the full 6-tier canonical model so the drill reads as one
 *      consistent spine. Real rollup tiers (corporate/factory/line/machine) are
 *      active/done/future; the Workshop & Station tiers are HONESTLY DEGRADED —
 *      the `drillDown.*` backend collapses them (factories group straight to
 *      lines; lines straight to machines) and exposes no per-workshop/-station
 *      rollup — so they render dashed + muted with an explanatory tooltip and are
 *      never presented with fabricated numbers.
 */
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Building2,
  Factory,
  Boxes,
  GitBranch,
  MapPin,
  Cpu,
  ChevronRight,
  Home,
  Wifi,
  Info,
} from "lucide-react";

/** The tiers the `drillDown.*` router actually rolls up (has real KPI data). */
export type DrillLevel = "corporate" | "factory" | "line" | "machine";

export interface DrillDownState {
  level: DrillLevel;
  corporateCode?: string;
  corporateName?: string;
  factoryId?: number;
  factoryName?: string;
  lineId?: number;
  lineName?: string;
  machineId?: number;
  machineName?: string;
}

/** Canonical tier order (includes the two degraded, non-rolled-up tiers). */
type TierKey = "corporate" | "factory" | "workshop" | "line" | "station" | "machine";

interface TierMeta {
  key: TierKey;
  icon: React.ComponentType<{ className?: string }>;
  /** true → backend does NOT roll this tier up (honest degradation). */
  degraded: boolean;
  /** For real tiers, the DrillLevel it maps to. */
  level?: DrillLevel;
}

const TIERS: TierMeta[] = [
  { key: "corporate", icon: Building2, degraded: false, level: "corporate" },
  { key: "factory", icon: Factory, degraded: false, level: "factory" },
  { key: "workshop", icon: Boxes, degraded: true },
  { key: "line", icon: GitBranch, degraded: false, level: "line" },
  { key: "station", icon: MapPin, degraded: true },
  { key: "machine", icon: Cpu, degraded: false, level: "machine" },
];

const LEVEL_ORDER: Record<DrillLevel, number> = {
  corporate: 0,
  factory: 1,
  line: 2,
  machine: 3,
};

type TierPhase = "active" | "done" | "future" | "degraded";

function tierPhase(tier: TierMeta, level: DrillLevel): TierPhase {
  if (tier.degraded || tier.level == null) return "degraded";
  const cur = LEVEL_ORDER[level];
  const idx = LEVEL_ORDER[tier.level];
  if (idx === cur) return "active";
  return idx < cur ? "done" : "future";
}

export interface DrillSpineProps {
  state: DrillDownState;
  onNavigate: (level: DrillLevel, data?: Partial<DrillDownState>) => void;
  live?: boolean;
}

export function DrillSpine({ state, onNavigate, live = false }: DrillSpineProps): React.JSX.Element {
  const { t } = useTranslation();

  const tierLabel = (key: TierKey): string =>
    ({
      corporate: t("dashboard.drill.tierCorporate", "Corporate"),
      factory: t("dashboard.drill.tierFactory", "Factory"),
      workshop: t("dashboard.drill.tierWorkshop", "Workshop"),
      line: t("dashboard.drill.tierLine", "Line"),
      station: t("dashboard.drill.tierStation", "Station"),
      machine: t("dashboard.drill.tierMachine", "Machine"),
    })[key];

  const degradedHint = (key: TierKey): string =>
    key === "workshop"
      ? t(
          "dashboard.drill.workshopCollapsedHint",
          "Workshop tier isn't rolled up by the drill backend — factories group straight to lines. No workshop-level data available.",
        )
      : t(
          "dashboard.drill.stationCollapsedHint",
          "Station tier isn't rolled up by the drill backend — lines group straight to machines. No station-level data available.",
        );

  // Navigate a completed real tier back into focus.
  const navigateTier = (tier: TierMeta) => {
    if (tier.level == null) return;
    switch (tier.level) {
      case "corporate":
        onNavigate("corporate");
        break;
      case "factory":
        if (state.corporateCode)
          onNavigate("factory", {
            corporateCode: state.corporateCode,
            corporateName: state.corporateName,
          });
        break;
      case "line":
        if (state.factoryId)
          onNavigate("line", {
            corporateCode: state.corporateCode,
            corporateName: state.corporateName,
            factoryId: state.factoryId,
            factoryName: state.factoryName,
          });
        break;
      case "machine":
        // Deepest tier — re-assert the current machine list with full context.
        if (state.lineId)
          onNavigate("machine", {
            corporateCode: state.corporateCode,
            corporateName: state.corporateName,
            factoryId: state.factoryId,
            factoryName: state.factoryName,
            lineId: state.lineId,
            lineName: state.lineName,
          });
        break;
      default:
        break;
    }
  };

  // ── Breadcrumb crumbs (the drilled path, by entity name) ──
  const crumbs: { level: DrillLevel; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { level: "corporate", label: t("dashboard.overview", "Overview"), icon: Building2 },
  ];
  if (state.corporateCode)
    crumbs.push({ level: "factory", label: state.corporateName || state.corporateCode, icon: Factory });
  if (state.factoryId)
    crumbs.push({ level: "line", label: state.factoryName || `#${state.factoryId}`, icon: GitBranch });
  if (state.lineId)
    crumbs.push({ level: "machine", label: state.lineName || `#${state.lineId}`, icon: Cpu });

  return (
    <div className="space-y-3">
      {/* Row 1 — breadcrumb of the drilled path + live badge */}
      <nav className="flex items-center gap-1 text-sm" aria-label={t("dashboard.drill.canonicalPath", "Corporate → Factory → Workshop → Line → Station → Machine")}>
        <Button variant="ghost" size="sm" onClick={() => onNavigate("corporate")} className="gap-1" aria-label={t("dashboard.overview", "Overview")}>
          <Home className="h-4 w-4" />
        </Button>
        {crumbs.map((c, i) => (
          <div key={c.level} className="flex items-center gap-1">
            {i > 0 && <ChevronRight className="h-4 w-4 text-muted-foreground" />}
            <Button
              variant={i === crumbs.length - 1 ? "secondary" : "ghost"}
              size="sm"
              className="max-w-[220px] gap-1"
              onClick={() => navigateTier(TIERS.find((tt) => tt.level === c.level)!)}
            >
              <c.icon className="h-4 w-4 shrink-0" />
              <span className="truncate">{c.label}</span>
            </Button>
          </div>
        ))}
        {live && (
          <span
            className="ml-auto inline-flex items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-[11px] font-medium text-success"
            title={t("dashboard.drill.liveHint", "Live via socket (60s poll fallback)")}
          >
            <Wifi className="h-3 w-3" aria-hidden="true" />
            {t("dashboard.drill.live", "LIVE")}
          </span>
        )}
      </nav>

      {/* Row 2 — canonical 6-tier stepper (honest-degradation for workshop/station) */}
      <div className="flex flex-wrap items-center gap-1.5 rounded-lg border bg-muted/30 p-2">
        {TIERS.map((tier, i) => {
          const phase = tierPhase(tier, state.level);
          const Icon = tier.icon;
          const clickable = phase === "done";
          const label = tierLabel(tier.key);
          return (
            <React.Fragment key={tier.key}>
              {i > 0 && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />}
              <button
                type="button"
                disabled={!clickable}
                onClick={clickable ? () => navigateTier(tier) : undefined}
                title={phase === "degraded" ? degradedHint(tier.key) : label}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors",
                  phase === "active" && "bg-primary text-primary-foreground",
                  phase === "done" && "bg-primary/10 text-primary hover:bg-primary/20",
                  phase === "future" && "text-muted-foreground",
                  phase === "degraded" && "border border-dashed border-muted-foreground/40 text-muted-foreground/70",
                  clickable && "cursor-pointer",
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
                {phase === "degraded" && <Info className="h-3 w-3 opacity-70" aria-hidden="true" />}
              </button>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

export default DrillSpine;
