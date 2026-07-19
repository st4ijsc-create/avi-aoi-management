/**
 * Executive Control Tower (doc 46 FE-W3.1 · decision D4 "consolidate + complete").
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ONE recommended entry point that unifies the six overlapping command screens
 * (CommandCenter · FactoryCommandView · MESControlTower · WarRoom · OpsConsole ·
 * CorporateDashboard). Rather than rewrite them, this page COMPOSES the most
 * important live signals into a persona-configurable grid of compact panels, each
 * linking out ("Open full view →") to the specialised screen for depth.
 *
 *   • A persona selector (Executive / Supervisor / Operations) chooses which
 *     panels show; the choice is persisted in localStorage and defaults from the
 *     signed-in user's role.
 *   • A shared KPI strip (commandCenter.kpiSummary) sits on top — honest "—" when
 *     a signal is unavailable, never a fabricated number.
 *   • Freshness follows the app's real-time pattern: the U1 ecosystem socket
 *     invalidates the active queries (debounced) with a poll interval fallback.
 *
 * READ-ONLY. Every panel reads a REAL tRPC router and degrades gracefully when the
 * query is UNAUTHORIZED for the current role (the panel hides its deep-link and
 * shows a muted note instead of a red error).
 * ════════════════════════════════════════════════════════════════════════════
 */
import * as React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import {
  LayoutDashboard, RefreshCw, Gauge, Boxes, AlertTriangle, Bot, Network,
  Sparkles, Zap,
} from "lucide-react";

import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { RelatedViews } from "@/components/RelatedViews";
import { PageContainer, PageHeader, StatChip, StatChipRow } from "@/components/patterns";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/_core/hooks/useAuth";
import { useEcosystemEvents } from "@/hooks/useEcosystemEvents";
import { cn } from "@/lib/utils";

import { LivePill } from "@/components/controlTower/PanelShell";
import { PANEL_COMPONENTS } from "@/components/controlTower/panels";
import {
  PERSONAS,
  PERSONA_META,
  PERSONA_PANELS,
  personaForRole,
  getStoredPersona,
  storePersona,
  type Persona,
} from "@/components/controlTower/personas";

export default function ControlTower(): React.JSX.Element {
  const { t } = useTranslation();
  const { user, loading } = useAuth();
  const utils = trpc.useUtils();

  // ── persona: stored → role default → executive ─────────────────────────────
  const storedRef = useRef<Persona | null>(getStoredPersona());
  const [persona, setPersonaState] = useState<Persona>(
    () => storedRef.current ?? personaForRole(user?.role),
  );
  // Once auth resolves and the user never picked one, adopt the role default.
  useEffect(() => {
    if (storedRef.current == null && !loading) {
      setPersonaState(personaForRole(user?.role));
    }
  }, [loading, user?.role, setPersonaState]);

  const setPersona = useCallback(
    (p: Persona) => {
      storedRef.current = p;
      storePersona(p);
      setPersonaState(p);
    },
    [setPersonaState],
  );

  // ── live-vs-poll status (drives the badge + strip realtime) ────────────────
  const statusQ = trpc.commandCenter.status.useQuery(undefined, { refetchInterval: 30_000 });
  const isLive = statusQ.data?.mode === "live";

  // ── shared KPI strip ───────────────────────────────────────────────────────
  const kpiQ = trpc.commandCenter.kpiSummary.useQuery({}, { refetchInterval: 20_000, staleTime: 5_000 });

  // ── realtime: socket invalidates active queries (debounced); poll is fallback ─
  const invalidateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleRefresh = useCallback(() => {
    if (invalidateTimer.current) clearTimeout(invalidateTimer.current);
    invalidateTimer.current = setTimeout(() => {
      void utils.commandCenter.kpiSummary.invalidate();
      void utils.commandCenter.recentAlerts.invalidate();
      void utils.warRoom.briefing.invalidate();
      void utils.alarmKpi.summary.invalidate();
      void utils.aiInsight.list.invalidate();
      void utils.dashboard.getAndonBoard.invalidate();
      void utils.dashboard.getStats.invalidate();
      void utils.mqttClient.getAllOEE.invalidate();
    }, 1_500);
  }, [utils]);
  useEcosystemEvents({ onEvent: scheduleRefresh });
  useEffect(
    () => () => {
      if (invalidateTimer.current) clearTimeout(invalidateTimer.current);
    },
    [],
  );

  const refreshAll = useCallback(() => {
    void utils.commandCenter.invalidate();
    void utils.warRoom.invalidate();
    void utils.alarmKpi.invalidate();
    void utils.aiInsight.invalidate();
    void utils.dashboard.invalidate();
    void utils.mqttClient.getAllOEE.invalidate();
    void utils.executiveReport.invalidate();
    void utils.drillDown.invalidate();
  }, [utils]);

  const panelKeys = PERSONA_PANELS[persona];

  return (
    <DashboardLayout>
      <PageContainer>
        <PageHeader
          icon={<LayoutDashboard className="h-6 w-6" />}
          title={t("controlTower.title", "Control Tower")}
          description={t(
            "controlTower.subtitle",
            "One live command surface — persona-configurable KPIs and signals, linking out to the specialised views for depth.",
          )}
          actions={
            <div className="flex items-center gap-2">
              <LivePill live={isLive} />
              <Button variant="outline" size="sm" onClick={refreshAll}>
                <RefreshCw className={cn("mr-1 h-4 w-4", (kpiQ.isFetching || statusQ.isFetching) && "animate-spin")} />
                {t("controlTower.refresh", "Refresh")}
              </Button>
            </div>
          }
        />

        {/* Persona selector (persisted; defaults from role) */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-muted-foreground">{t("controlTower.viewAs", "View as")}:</span>
          <div className="inline-flex flex-wrap gap-1 rounded-lg border border-border bg-muted/30 p-1">
            {PERSONAS.map((p) => {
              const active = p === persona;
              const meta = PERSONA_META[p];
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPersona(p)}
                  aria-pressed={active}
                  title={t(meta.descKey, meta.descDefault)}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                    active
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                  )}
                >
                  {t(meta.labelKey, meta.labelDefault)}
                </button>
              );
            })}
          </div>
          <span className="hidden text-xs text-muted-foreground sm:inline">
            {t(PERSONA_META[persona].descKey, PERSONA_META[persona].descDefault)}
          </span>
        </div>

        {/* Cross-links to the specialised command surfaces (depth). */}
        <RelatedViews
          links={[
            { href: "/command-center", labelKey: "nav.commandCenter", labelDefault: "Command Center" },
            { href: "/war-room", labelKey: "nav.warRoom", labelDefault: "War Room" },
            { href: "/ops-console", labelKey: "nav.opsConsole", labelDefault: "Ops Console" },
            { href: "/mes-control-tower", labelKey: "nav.mesControlTower", labelDefault: "MES Hub" },
            { href: "/corporate-dashboard", labelKey: "nav.corporateDashboard", labelDefault: "Corporate" },
            { href: "/factory-command-view", labelKey: "nav.factoryCommandView", labelDefault: "Factory Command" },
          ]}
        />

        {/* Shared KPI strip (honest "—"; hidden gracefully when unauthorized) */}
        <KpiStrip
          data={kpiQ.data}
          isLoading={kpiQ.isLoading}
          isError={kpiQ.isError}
          error={kpiQ.error}
        />

        {/* Persona panel grid */}
        <div className="grid gap-4 md:grid-cols-2">
          {panelKeys.map((key) => {
            const Panel = PANEL_COMPONENTS[key];
            return <Panel key={key} />;
          })}
        </div>
      </PageContainer>
    </DashboardLayout>
  );
}

// ── shared KPI strip ──────────────────────────────────────────────────────────
type KpiSummary = inferRouterOutputs<AppRouter>["commandCenter"]["kpiSummary"];

function fmtNum(v: number | null | undefined): string {
  return v == null ? "—" : v.toLocaleString();
}
function fmtPct(v: number | null | undefined): string {
  return v == null ? "—" : `${Math.round(v)}%`;
}

function KpiStrip({
  data,
  isLoading,
  isError,
  error,
}: {
  data: KpiSummary | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
}): React.JSX.Element | null {
  const { t } = useTranslation();

  // Unauthorized / forbidden → hide the strip quietly (the panels do the same).
  const code = (error as { data?: { code?: string } } | null | undefined)?.data?.code;
  if (isError && (code === "UNAUTHORIZED" || code === "FORBIDDEN")) return null;

  if (isLoading || !data) {
    return (
      <div className="h-8 w-full animate-pulse rounded-md bg-muted/40" aria-hidden="true" />
    );
  }

  const oee = data.oee.available ? data.oee.value?.oee ?? null : null;
  const wip = data.wip.available ? data.wip.value?.count ?? null : null;
  const alarmsCrit = data.alarms.available ? data.alarms.value?.critical ?? 0 : null;
  const alarmsHigh = data.alarms.available ? data.alarms.value?.high ?? 0 : null;
  const robots = data.fleet.available ? data.fleet.value?.robotsOnline ?? 0 : null;
  const tasks = data.fleet.available
    ? (data.fleet.value?.tasksPending ?? 0) + (data.fleet.value?.tasksRunning ?? 0)
    : null;
  const sitesReporting = data.sites.available ? data.sites.value?.reporting ?? 0 : null;
  const sitesTotal = data.sites.available ? data.sites.value?.total ?? 0 : null;
  const ai = data.aiInsights.available ? data.aiInsights.value?.count ?? null : null;
  const energy = data.energy.available ? data.energy.value?.kwh ?? null : null;

  return (
    <StatChipRow>
      <StatChip
        icon={<Gauge />}
        label={t("controlTower.kpi.oee", "OEE (mean)")}
        value={fmtPct(oee)}
        tone={oee == null ? "default" : oee < 60 ? "warning" : "success"}
      />
      <StatChip icon={<Boxes />} label={t("controlTower.kpi.wip", "WIP units")} value={fmtNum(wip)} />
      {/* W1-P0: kpiSummary đếm cảnh báo ĐANG MỞ (andon chưa xử lý + sự kiện an toàn,
          KHÔNG theo cửa sổ thời gian) — nhãn phải nói rõ phạm vi để không mâu thuẫn
          với panel "Alarm health (24h)" vốn đếm cảnh báo PHÁT SINH trong 24h. */}
      <StatChip
        icon={<AlertTriangle />}
        label="Cảnh báo đang mở · nặng/cao"
        title="Đếm cảnh báo chưa xử lý (mọi thời điểm): andon chưa resolve + sự kiện an toàn. Khác với panel 'Tình trạng cảnh báo (24h)' — đếm số phát sinh trong cửa sổ 24h."
        value={alarmsCrit == null ? "—" : `${alarmsCrit} / ${alarmsHigh}`}
        tone={alarmsCrit ? "error" : "default"}
      />
      <StatChip
        icon={<Bot />}
        label={t("controlTower.kpi.fleet", "Fleet tasks / robots")}
        value={tasks == null ? "—" : `${tasks} / ${robots}`}
      />
      <StatChip
        icon={<Network />}
        label={t("controlTower.kpi.sites", "Sites reporting")}
        value={sitesReporting == null ? "—" : `${sitesReporting} / ${sitesTotal}`}
      />
      <StatChip icon={<Sparkles />} label={t("controlTower.kpi.ai", "AI insights")} value={fmtNum(ai)} />
      <StatChip icon={<Zap />} label={t("controlTower.kpi.energy", "Energy kWh")} value={fmtNum(energy)} />
    </StatChipRow>
  );
}
