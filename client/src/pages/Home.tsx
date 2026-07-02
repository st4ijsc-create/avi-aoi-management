/**
 * F1 (doc 23 §4 Table B) — CONTINUUM public homepage.
 *
 * The automation-ECOSYSTEM front door (not an AOI brochure). It keeps its OWN
 * public header/footer (this is NOT a DashboardLayout page) and is shown to
 * logged-out visitors, during first-run setup, or to a signed-in user who
 * deliberately lands here with ?stay=1. Every authenticated user is otherwise
 * redirected to their role landing (see the effect below).
 *
 * Blocks: brand header · Today briefing (authed) · compact ecosystem hero ·
 * live plant-health KPI strip (authed, honest "—") · domain/module grid ·
 * "your workspace" row (authed) · brand footer.
 */
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";
import { getLoginUrl } from "@/const";
import { trpc } from "@/lib/trpc";
import { useEffect } from "react";
import { useLocation, Link } from "wouter";
import { Gauge, LogIn, Inbox, CalendarClock, ArrowRight, LayoutDashboard, Lock } from "lucide-react";
import { TodayBriefing } from "@/components/TodayBriefing";
import { FirstRunTour } from "@/components/FirstRunTour";
import { landingPathForRole } from "@/lib/roleLanding";
import { MetricCard, ToolTile } from "@/components/patterns";
import { BRAND } from "@/config/brand";
import { DOMAINS } from "@/lib/domains";

// ─── Live plant-health strip ───────────────────────────────────────────────────
// Reuses the SAME aggregation the Command Center uses (commandCenter.kpiSummary)
// so Home never invents numbers. Honest "—" when a source is unavailable; if the
// query errors (e.g. the viewer lacks machine_monitoring), we render nothing loud
// — the query is best-effort and additive.
function PlantHealthStrip() {
  const { t } = useTranslation();
  const kpiQ = trpc.commandCenter.kpiSummary.useQuery(
    {},
    { refetchInterval: 30_000, staleTime: 10_000, retry: false, refetchOnWindowFocus: false },
  );
  const kpi = kpiQ.data;

  const fmtNum = (v: number | null | undefined) => (v == null ? "—" : String(v));
  const fmtPct = (v: number | null | undefined) => (v == null ? "—" : `${Math.round(v)}%`);

  const oeeVal = kpi?.oee.available ? fmtPct(kpi.oee.value?.oee ?? null) : "—";
  const wipVal = kpi?.wip.available ? fmtNum(kpi.wip.value?.count) : "—";
  const alarmsCrit = kpi?.alarms.available ? kpi.alarms.value?.critical ?? 0 : null;
  const alarmsHigh = kpi?.alarms.available ? kpi.alarms.value?.high ?? 0 : null;
  const fleetRobots = kpi?.fleet.available ? kpi.fleet.value?.robotsOnline ?? 0 : null;
  const fleetTasks = kpi?.fleet.available
    ? (kpi.fleet.value?.tasksPending ?? 0) + (kpi.fleet.value?.tasksRunning ?? 0)
    : null;
  const sitesReporting = kpi?.sites.available ? kpi.sites.value?.reporting ?? 0 : null;
  const sitesTotal = kpi?.sites.available ? kpi.sites.value?.total ?? 0 : null;

  // The viewer cannot read the estate KPIs — say so plainly rather than fake it.
  if (kpiQ.isError) {
    return (
      <div className="rounded-xl border bg-card/60 px-4 py-3 text-sm text-muted-foreground">
        {t("home.kpiNoAccess", "Live plant health is available to monitoring roles.")}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      <MetricCard
        icon={<Gauge className="h-4 w-4" />}
        label={t("home.kpiOee", "OEE (mean)")}
        value={oeeVal}
        tone={kpi?.oee.value?.oee != null && kpi.oee.value.oee < 60 ? "warning" : "default"}
      />
      <MetricCard
        icon={<LayoutDashboard className="h-4 w-4" />}
        label={t("home.kpiWip", "WIP units")}
        value={wipVal}
      />
      <MetricCard
        icon={<Gauge className="h-4 w-4" />}
        label={t("home.kpiAlarms", "Alarms crit / high")}
        value={alarmsCrit == null ? "—" : `${alarmsCrit} / ${alarmsHigh}`}
        tone={alarmsCrit ? "error" : "default"}
      />
      <MetricCard
        icon={<Gauge className="h-4 w-4" />}
        label={t("home.kpiFleet", "Fleet tasks / robots")}
        value={fleetTasks == null ? "—" : `${fleetTasks} / ${fleetRobots}`}
      />
      <MetricCard
        icon={<Gauge className="h-4 w-4" />}
        label={t("home.kpiSites", "Sites reporting")}
        value={sitesReporting == null ? "—" : `${sitesReporting} / ${sitesTotal}`}
      />
    </div>
  );
}

export default function Home() {
  const { t } = useTranslation();
  const { user, loading, isAuthenticated } = useAuth();
  const [, setLocation] = useLocation();
  const { data: setupCheck } = trpc.auth.checkSetupRequired.useQuery();

  const BrandMark = BRAND.logoIcon;
  const rolePath = landingPathForRole(user?.role);

  // Redirect to setup if no admin exists
  useEffect(() => {
    if (setupCheck?.required && !isAuthenticated) {
      setLocation("/setup");
    }
  }, [setupCheck, isAuthenticated, setLocation]);

  // ONE front door (source-of-truth home): send EVERY authenticated user to their
  // canonical role-home — not just shop-floor roles — so login and "/" agree on a
  // single consistent landing. This overview page stays for logged-out / setup, or
  // when a signed-in user deliberately navigates here with ?stay=1. Roles with no
  // dedicated home (landingPathForRole → "/") stay put, so there is no redirect loop.
  useEffect(() => {
    if (loading || !isAuthenticated) return;
    if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("stay")) return;
    const dest = landingPathForRole(user?.role);
    if (dest !== "/") setLocation(dest, { replace: true });
  }, [loading, isAuthenticated, user?.role, setLocation]);

  return (
    <div className="min-h-screen bg-background">
      {/* First-run coach — shown once per user (renders nothing when logged out) */}
      <FirstRunTour />

      {/* ── Header — Continuum brand lockup ── */}
      <header className="sticky top-0 z-50 border-b border-border/50 bg-card/50 backdrop-blur-xl">
        <div className="container flex h-16 items-center justify-between">
          <Link href="/?stay=1" className="flex items-center gap-3">
            <div className="glow-primary flex h-10 w-10 items-center justify-center rounded-xl bg-primary/20">
              <BrandMark className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-foreground">{BRAND.name}</h1>
              <p className="text-xs text-muted-foreground">{t(BRAND.taglineKey, BRAND.tagline)}</p>
            </div>
          </Link>

          <div className="flex items-center gap-3">
            {loading ? (
              <div className="h-9 w-24 animate-pulse rounded-lg bg-muted" />
            ) : isAuthenticated ? (
              <div className="flex items-center gap-3">
                <span className="hidden text-sm text-muted-foreground sm:block">
                  {user?.name || user?.email}
                </span>
                <Link href={rolePath}>
                  <Button variant="default" size="sm" className="gap-2">
                    <LayoutDashboard className="h-4 w-4" />
                    {t("home.enterWorkspace", "Enter workspace")}
                  </Button>
                </Link>
              </div>
            ) : (
              <a href={getLoginUrl()}>
                <Button variant="default" size="sm" className="gap-2">
                  <LogIn className="h-4 w-4" />
                  {t("auth.login")}
                </Button>
              </a>
            )}
          </div>
        </div>
      </header>

      {/* Today Briefing — role-aware, zero-click summary (only when logged in) */}
      {isAuthenticated && (
        <div className="container pt-6">
          <TodayBriefing />
        </div>
      )}

      {/* ── Compact ecosystem hero ── */}
      <section className="relative overflow-hidden py-16 lg:py-20">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-accent/5" />
        <div className="absolute left-1/2 top-1/2 h-[720px] w-[720px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/5 blur-3xl" />

        <div className="container relative">
          <div className="mx-auto max-w-3xl text-center">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-4 py-2">
              <BrandMark className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium text-primary">
                {t(BRAND.taglineKey, BRAND.tagline)}
              </span>
            </div>

            <h1 className="mb-5 text-4xl font-bold tracking-tight md:text-5xl lg:text-6xl">
              <span className="gradient-text">{t("home.heroTitle", "One platform for the whole factory")}</span>
            </h1>

            <p className="mx-auto mb-8 max-w-2xl text-lg text-muted-foreground">
              {t("home.heroSubhead", "Production · OT · Robotics · Twin · AI · Multi-site")}
            </p>

            <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
              {isAuthenticated ? (
                <Link href={rolePath}>
                  <Button size="lg" className="glow-primary gap-2">
                    <LayoutDashboard className="h-5 w-5" />
                    {t("home.enterWorkspace", "Enter workspace")}
                  </Button>
                </Link>
              ) : (
                <a href={getLoginUrl()}>
                  <Button size="lg" className="glow-primary gap-2">
                    <LogIn className="h-5 w-5" />
                    {t("home.getStarted", "Get started")}
                  </Button>
                </a>
              )}
              <Link href="/command-center">
                <Button size="lg" variant="outline" className="gap-2">
                  <Gauge className="h-5 w-5" />
                  {t("home.openCommandCenter", "Open Command Center")}
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── Live plant-health KPI strip ── */}
      <section className="border-y border-border/50 bg-card/30 py-10">
        <div className="container">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            {t("home.plantHealthTitle", "Live plant health")}
          </h2>
          {isAuthenticated ? (
            <PlantHealthStrip />
          ) : (
            <div className="flex flex-col items-start gap-3 rounded-xl border bg-card/60 px-5 py-6 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Lock className="h-5 w-5" />
                </div>
                <p className="text-sm text-muted-foreground">
                  {t("home.kpiSignInHint", "Sign in to see live plant health.")}
                </p>
              </div>
              <a href={getLoginUrl()}>
                <Button variant="outline" size="sm" className="gap-2">
                  <LogIn className="h-4 w-4" />
                  {t("auth.login")}
                </Button>
              </a>
            </div>
          )}
        </div>
      </section>

      {/* ── Domain / module grid ── */}
      <section className="py-16 lg:py-20">
        <div className="container">
          <div className="mb-10 text-center">
            <h2 className="mb-3 text-3xl font-bold md:text-4xl">
              {t("home.domainsHeading", "Explore the")}{" "}
              <span className="gradient-text">{t("home.domainsHighlight", "ecosystem")}</span>
            </h2>
            <p className="mx-auto max-w-2xl text-muted-foreground">
              {t("home.domainsSubheading", "Eight connected domains — from the shop floor to multi-site governance.")}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
            {DOMAINS.map((d) => (
              <ToolTile
                key={d.key}
                icon={d.icon}
                label={t(d.labelKey)}
                blurb={t(d.blurbKey)}
                href={d.href}
              />
            ))}
          </div>
        </div>
      </section>

      {/* ── Your workspace row (authenticated only) ── */}
      {isAuthenticated && (
        <section className="border-t border-border/50 bg-card/30 py-14">
          <div className="container">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {t("home.workspaceTitle", "Your workspace")}
            </h2>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <ToolTile
                icon={LayoutDashboard}
                label={t("home.workspaceRoleHome", "My workspace")}
                blurb={t("home.workspaceRoleHomeDesc", "Your role landing")}
                href={rolePath === "/" ? "/dashboard" : rolePath}
              />
              <ToolTile
                icon={Inbox}
                label={t("home.workspaceInbox", "Inbox")}
                blurb={t("home.workspaceInboxDesc", "Actions awaiting you")}
                href="/inbox"
              />
              <ToolTile
                icon={CalendarClock}
                label={t("home.workspaceToday", "Today")}
                blurb={t("home.workspaceTodayDesc", "Your shift briefing")}
                href="/today"
              />
              <ToolTile
                icon={Gauge}
                label={t("home.openCommandCenter", "Open Command Center")}
                blurb={t("home.workspaceCommandDesc", "Single pane of glass")}
                href="/command-center"
              />
            </div>
          </div>
        </section>
      )}

      {/* ── Footer — Continuum brand ── */}
      <footer className="border-t border-border/50 py-8">
        <div className="container">
          <div className="flex flex-col items-center justify-between gap-4 md:flex-row">
            <div className="flex items-center gap-2">
              <BrandMark className="h-5 w-5 text-primary" />
              <span className="text-sm text-muted-foreground">
                {BRAND.name} — {t(BRAND.taglineKey, BRAND.tagline)}
              </span>
            </div>
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>© {new Date().getFullYear()} {BRAND.short}</span>
              <span aria-hidden="true">·</span>
              <Link href="/about-system" className="inline-flex items-center gap-1 hover:text-foreground">
                {t("home.aboutLink", "About")}
                <ArrowRight className="h-3 w-3" />
              </Link>
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
