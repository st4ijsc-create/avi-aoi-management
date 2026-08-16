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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { useTranslation } from "react-i18next";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import {
  LayoutDashboard, RefreshCw, Gauge, Boxes, AlertTriangle, Network,
  Sparkles, Minimize2,
} from "lucide-react";

import { trpc } from "@/lib/trpc";
import { fmtNum, fmtPct } from "@/lib/format";
import { useDebouncedInvalidate } from "@/hooks/useDebouncedInvalidate";
import DashboardLayout from "@/components/DashboardLayout";
import { RelatedViews } from "@/components/RelatedViews";
import { PageContainer, PageHeader, StatChip, StatChipRow, StatusBadge } from "@/components/patterns";
import {
  severityTone,
  TONE_TILE_CLASS,
  TONE_DOT_CLASS,
  type SemanticTone,
} from "@/components/patterns/isaStateBadges";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/_core/hooks/useAuth";
import {
  useEcosystemEvents,
  type EcosystemEvent,
  type EcosystemKind,
} from "@/hooks/useEcosystemEvents";
import { cn } from "@/lib/utils";

import { LivePill } from "@/components/controlTower/PanelShell";
import { DeferredMount } from "@/components/DeferredMount";
import { PANEL_COMPONENTS, PanelLiveContext } from "@/components/controlTower/panels";
import {
  PERSONAS,
  PERSONA_META,
  PERSONA_PANELS,
  personaForRole,
  getStoredPersona,
  storePersona,
  type Persona,
} from "@/components/controlTower/personas";

// W6 (doc 67) — phân loại event của useEcosystemEvents cho invalidate chọn lọc:
// nhóm cảnh báo (andon + các lớp alarm-class cùng họ) và nhóm sản lượng/chất lượng.
const ALARM_EVENT_KINDS: readonly EcosystemKind[] = ["andon", "safety", "escalation", "anomaly", "spc"];
const PRODUCTION_EVENT_KINDS: readonly EcosystemKind[] = ["inspection", "yield", "ng", "quality_gate"];

// doc 68 §3.2 (việc 2): panel "hero" (rủi ro/cảnh báo) — span 2 cột khi có cảnh báo
// nghiêm trọng (critical/high > 0) để neo mắt. Chỉ panel đầu tiên thuộc nhóm này span.
const HERO_PANEL_KEYS: ReadonlySet<string> = new Set(["topRisks", "alarmHealth", "andonRail", "liveAlarms"]);

export default function ControlTower(): React.JSX.Element {
  const { t } = useTranslation();
  const { user, loading } = useAuth();
  const utils = trpc.useUtils();

  // ── persona: ?role= → stored → role default → executive ───────────────────
  // doc 67 W5 (việc 4): ?role=executive|supervisor|operations deep-link thắng tất
  // (không ghi localStorage — chỉ đổi tay mới lưu); còn lại: lựa chọn đã lưu →
  // mặc định theo vai từ auth.me (executive/admin→Điều hành, supervisor/manager→
  // Quản đốc, operator→Vận hành).
  const search = useSearch();
  const urlPersona = useMemo<Persona | null>(() => {
    const raw = new URLSearchParams(search).get("role");
    return raw && (PERSONAS as readonly string[]).includes(raw) ? (raw as Persona) : null;
  }, [search]);

  // ── doc 67 W8 — kiosk TV wall (?kiosk=1) ───────────────────────────────────
  // TÁI DÙNG cơ chế hệ thống sẵn có: App.tsx gọi useKioskMode() toàn cục (đọc
  // ?kiosk=1 một lần lúc mount, gắn .kiosk-mode lên <html>) và index.css ~693 ẩn
  // [data-app-chrome="sidebar"/"header"] + zero padding main. Trang này chỉ thêm
  // phần RIÊNG cho Control Tower: (a) tự chọn persona 'Vận hành' (alarm rail +
  // andon + downtime — hợp treo xưởng) trừ khi ?role= chỉ định khác; (b) phóng
  // nội dung ~1.3× cho khoảng cách xem TV (class biến thể [zoom:1.3] trên
  // container); (c) ẩn RelatedViews + persona selector + nút Làm mới (TV không
  // tương tác — auto-refresh socket/poll GIỮ NGUYÊN); (d) nút thoát nhỏ ở góc.
  // Cùng cách nhận diện với useKioskMode: kiosk=1 hoặc kiosk=true.
  const kiosk = useMemo(() => {
    const raw = new URLSearchParams(search).get("kiosk");
    return raw === "1" || raw === "true";
  }, [search]);
  const storedRef = useRef<Persona | null>(getStoredPersona());
  // W8: kiosk (không ?role=) THẮNG lựa chọn đã lưu — TV wall luôn mở 'Vận hành'.
  const [persona, setPersonaState] = useState<Persona>(
    () => urlPersona ?? (kiosk ? "operations" : storedRef.current ?? personaForRole(user?.role)),
  );
  // ?role= changes (client-side nav) take effect immediately; kiosk falls back to operations.
  useEffect(() => {
    if (urlPersona != null) setPersonaState(urlPersona);
    else if (kiosk) setPersonaState("operations");
  }, [urlPersona, kiosk]);
  // Once auth resolves and the user never picked one (and no ?role=/?kiosk), adopt the role default.
  useEffect(() => {
    if (urlPersona == null && !kiosk && storedRef.current == null && !loading) {
      setPersonaState(personaForRole(user?.role));
    }
  }, [urlPersona, kiosk, loading, user?.role, setPersonaState]);

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

  // ── doc 68 §3.2 (việc 1+2) — HERO status band + hero-panel span ─────────────
  // Đèn tổng + đếm cảnh báo mở lấy từ kpiSummary (đã fetch, chia sẻ). Bất thường #1
  // lấy từ recentAlerts (chỉ fetch khi CÓ cảnh báo mở — enabled-gate, đỡ gọi thừa).
  const alarmsVal = kpiQ.data?.alarms.available ? kpiQ.data.alarms.value : null;
  const openTotal = alarmsVal?.total ?? 0;
  const severe = (alarmsVal?.critical ?? 0) > 0 || (alarmsVal?.high ?? 0) > 0;
  const alertsQ = trpc.commandCenter.recentAlerts.useQuery(
    { limit: 5 },
    { refetchInterval: 30_000, staleTime: 10_000, enabled: openTotal > 0 },
  );
  const topAlert = useMemo(() => {
    const list = alertsQ.data?.alerts ?? [];
    if (list.length === 0) return null;
    const rank = (s: string): number => {
      const tn = severityTone(s);
      return tn === "danger" ? 3 : tn === "warning" ? 2 : 1;
    };
    return [...list].sort((a, b) => rank(b.severity) - rank(a.severity) || b.ts - a.ts)[0] ?? null;
  }, [alertsQ.data]);

  // ── realtime: socket invalidates SELECTIVELY per event kind (debounced); poll is fallback ─
  // W6 (doc 67): trước đây MỖI event invalidate cả 8 query key (bão refetch khi stream
  // dồn dập). Nay: debounce nâng 1,5s→5s, gom `kind` của các event trong cửa sổ rồi chỉ
  // invalidate NHÓM nguồn tương ứng:
  //   • andon/alarm-class → alarmKpi.summary + dashboard.getAndonBoard + commandCenter.recentAlerts
  //     (đúng 3 nguồn được poll-gate trong panels.tsx — PanelLiveContext);
  //   • inspection/yield  → drillDown.corporateStats + dashboard.getStats;
  //   • oee               → mqttClient.getAllOEE (mean OEE live của panel corporate).
  // executiveReport / aiInsight KHÔNG đi theo event — hai nguồn chậm này giữ poll riêng.
  // W7 GĐ2: phần TIMER của scheduleRefresh W6 → useDebouncedInvalidate shared (cùng
  // ngữ nghĩa debounce-trailing 5s: mỗi event reset đồng hồ, tự clear khi unmount).
  // Logic pendingKinds (gom kind trong cửa sổ → invalidate CHỌN LỌC nhóm nguồn)
  // GIỮ NGUYÊN — chỉ chỗ setTimeout/clearTimeout tự chế được thay.
  const pendingKinds = useRef<Set<EcosystemKind>>(new Set());
  const flushPendingKinds = useDebouncedInvalidate(() => {
    const kinds = pendingKinds.current;
    pendingKinds.current = new Set();
    if (ALARM_EVENT_KINDS.some((k) => kinds.has(k))) {
      void utils.alarmKpi.summary.invalidate();
      void utils.dashboard.getAndonBoard.invalidate();
      void utils.commandCenter.recentAlerts.invalidate();
    }
    if (PRODUCTION_EVENT_KINDS.some((k) => kinds.has(k))) {
      void utils.drillDown.corporateStats.invalidate();
      void utils.dashboard.getStats.invalidate();
    }
    if (kinds.has("oee")) {
      void utils.mqttClient.getAllOEE.invalidate();
    }
  }, 5_000);
  const scheduleRefresh = useCallback(
    (evt: EcosystemEvent) => {
      pendingKinds.current.add(evt.kind);
      flushPendingKinds();
    },
    [flushPendingKinds],
  );
  useEcosystemEvents({ onEvent: scheduleRefresh });

  // W6 (doc 67): nút "Làm mới" — refetchType:'active' tường minh: chỉ query đang có
  // observer (panel đang hiển thị) refetch ngay, phần còn lại chỉ bị đánh dấu stale.
  const refreshAll = useCallback(() => {
    const activeOnly = { refetchType: "active" as const };
    void utils.commandCenter.invalidate(undefined, activeOnly);
    void utils.warRoom.invalidate(undefined, activeOnly);
    void utils.alarmKpi.invalidate(undefined, activeOnly);
    void utils.aiInsight.invalidate(undefined, activeOnly);
    void utils.dashboard.invalidate(undefined, activeOnly);
    void utils.mqttClient.getAllOEE.invalidate(undefined, activeOnly);
    void utils.executiveReport.invalidate(undefined, activeOnly);
    void utils.drillDown.invalidate(undefined, activeOnly);
  }, [utils]);

  const panelKeys = PERSONA_PANELS[persona];
  // Panel hero đầu tiên của persona (span 2 cột khi severe). null khi persona không có.
  const firstHeroKey = useMemo(() => panelKeys.find((k) => HERO_PANEL_KEYS.has(k)) ?? null, [panelKeys]);

  // W8: thoát kiosk = bỏ ?kiosk khỏi URL bằng điều hướng ĐẦY ĐỦ (reload), vì
  // useKioskMode() ở App chỉ đọc location.search MỘT LẦN lúc mount ([] deps) —
  // client-side setLocation sẽ không gỡ .kiosk-mode khỏi <html>.
  const exitKiosk = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    const url = new URL(window.location.href);
    url.searchParams.delete("kiosk");
    window.location.assign(url.pathname + url.search + url.hash);
  }, []);

  return (
    <DashboardLayout>
      {/* W8: [zoom:1.3] phóng toàn bộ nội dung ~1.3× cho TV wall (Tailwind
          arbitrary property — Chrome/Edge kiosk hỗ trợ zoom chuẩn hoá). */}
      <PageContainer className={cn(kiosk && "[zoom:1.3]")}>
        <PageHeader
          icon={<LayoutDashboard className="h-6 w-6" />}
          // doc 67 W5 (việc 2) — 1 key/trang: h1 = breadcrumb = menu = nav.controlTower.
          title={t("nav.controlTower", "Factory Overview")}
          // doc 68 §3.2 (việc 6) — mô tả rút 1 dòng (chi tiết đã nằm ở tooltip persona).
          description={t("controlTower.subtitleShort", "Bảng điều hành trực tiếp — KPI & tín hiệu theo vai trò.")}
        />

        {/* doc 68 §3.2 (việc 1) — HERO STATUS BAND: mảng chính neo mắt <10s. */}
        <HeroStatusBand kpi={kpiQ.data} topAlert={topAlert} isLoading={kpiQ.isLoading} />

        {/* doc 68 §3.2 (việc 6) — 1 toolbar 1 hàng: persona-tab (trái) · LIVE + Làm mới (phải).
            W8: ẩn persona + Làm mới khi kiosk (TV không tương tác); LIVE vẫn hiện. */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          {!kiosk ? (
            <div className="inline-flex flex-wrap items-center gap-2">
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
                        // W4 (doc 67): min-h-11 (44px) — vùng chạm đạt chuẩn găng tay/panel-PC.
                        "min-h-11 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
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
            </div>
          ) : (
            <div />
          )}
          <div className="flex items-center gap-2">
            <LivePill live={isLive} />
            {!kiosk && (
              <Button variant="outline" size="sm" onClick={refreshAll}>
                <RefreshCw className={cn("mr-1 h-4 w-4", (kpiQ.isFetching || statusQ.isFetching) && "animate-spin")} />
                {t("controlTower.refresh", "Refresh")}
              </Button>
            )}
          </div>
        </div>

        {/* Shared KPI strip (honest "—"; hidden gracefully when unauthorized).
            doc 68 §3.2 (việc 4): bỏ dòng "Tuổi dữ liệu KPI" trùng (freshness đã
            hiện per-panel khi stale + LIVE pill ở toolbar). */}
        <KpiStrip
          data={kpiQ.data}
          isLoading={kpiQ.isLoading}
          isError={kpiQ.isError}
          error={kpiQ.error}
        />

        {/* Persona panel grid.
            W6 (doc 67): PanelLiveContext cấp trạng thái socket cho panel poll-gate
            (refetchInterval: isLive ? false : POLL_x); hàng panel thứ 2 trở đi
            (dưới fold ở 800px cao, grid md:grid-cols-2 → index ≥2) bọc DeferredMount
            để first-paint chỉ mount KPI strip + hàng panel đầu. */}
        <PanelLiveContext.Provider value={isLive}>
          <div className="grid gap-4 md:grid-cols-2">
            {panelKeys.map((key, idx) => {
              const Panel = PANEL_COMPONENTS[key];
              // doc 68 §3.2 (việc 2): panel hero span 2 cột khi severe (wrapper
              // display:grid → Card con vẫn giãn đều chiều cao như grid-item cũ).
              const cellCls = cn("grid", severe && key === firstHeroKey && "md:col-span-2");
              return (
                <div key={key} className={cellCls}>
                  {idx < 2 ? (
                    <Panel />
                  ) : (
                    <DeferredMount
                      placeholder={
                        <div className="h-64 animate-pulse rounded-lg border border-border bg-muted/30" aria-hidden="true" />
                      }
                    >
                      <Panel />
                    </DeferredMount>
                  )}
                </div>
              );
            })}
          </div>
        </PanelLiveContext.Provider>

        {/* doc 68 §3.2 (việc 5) — RelatedViews xuống CHÂN trang (lối tắt phụ, không
            phải đường vào chính). W8: ẩn khi kiosk — TV wall không điều hướng. */}
        {!kiosk && <RelatedViews pageId="control-tower" />}

        {/* W8: nút thoát kiosk — nhỏ, mờ, góc dưới-phải; 40×40px tối thiểu
            (h-10 w-10, chưa tính zoom 1.3×). Bỏ ?kiosk khỏi URL qua exitKiosk. */}
        {kiosk && (
          <button
            type="button"
            onClick={exitKiosk}
            title={t("controlTower.exitKiosk", "Thoát chế độ kiosk")}
            aria-label={t("controlTower.exitKiosk", "Thoát chế độ kiosk")}
            className="fixed bottom-3 right-3 z-50 flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card/70 text-muted-foreground opacity-60 shadow-sm backdrop-blur transition-opacity hover:opacity-100 hover:text-foreground"
          >
            <Minimize2 className="h-4 w-4" />
          </button>
        )}
      </PageContainer>
    </DashboardLayout>
  );
}

// ── shared KPI strip ──────────────────────────────────────────────────────────
// W7 GĐ2: fmtNum/fmtPct local → lib/format. Chip OEE gọi fmtPct(v, 0) để giữ đúng
// hiển thị số nguyên ("97%") như bản Math.round cũ.
type KpiSummary = inferRouterOutputs<AppRouter>["commandCenter"]["kpiSummary"];

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
  // W4 (doc 67): chip KPI bấm được → điều hướng deep-view tương ứng (route đã
  // xác minh tồn tại trong App.tsx). fleet/energy KHÔNG gắn vì /fleet và /energy
  // không tồn tại (chỉ có /fleet-orchestration gated-permission và /energy-analytics).
  const [, setLocation] = useLocation();

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
  const sitesReporting = data.sites.available ? data.sites.value?.reporting ?? 0 : null;
  const sitesTotal = data.sites.available ? data.sites.value?.total ?? 0 : null;
  const ai = data.aiInsights.available ? data.aiInsights.value?.count ?? null : null;

  // doc 68 §3.2 (việc 5): ≤5 chip CỐT LÕI (bỏ Fleet + Energy — ít actionable, hay "—");
  // nhãn ngắn để không bị cảm giác cắt chữ. Vẫn wrap 2 hàng ở 1280 nếu cần.
  return (
    <StatChipRow wrap>
      <StatChip
        icon={<Gauge />}
        label={t("controlTower.kpi.oee", "OEE (mean)")}
        value={fmtPct(oee, 0)}
        tone={oee == null ? "default" : oee < 60 ? "warning" : "success"}
        onClick={() => setLocation("/oee-dashboard")}
        title={t("controlTower.kpi.oeeGo", "Mở bảng OEE đầy đủ")}
      />
      <StatChip
        icon={<Boxes />}
        label={t("controlTower.kpi.wip", "WIP units")}
        value={fmtNum(wip)}
        onClick={() => setLocation("/wip-dashboard")}
        title={t("controlTower.kpi.wipGo", "Mở bảng WIP đầy đủ")}
      />
      {/* W1-P0: kpiSummary đếm cảnh báo ĐANG MỞ (andon chưa xử lý + sự kiện an toàn,
          KHÔNG theo cửa sổ thời gian) — nhãn phải nói rõ phạm vi để không mâu thuẫn
          với panel "Alarm health (24h)" vốn đếm cảnh báo PHÁT SINH trong 24h. */}
      <StatChip
        icon={<AlertTriangle />}
        label={t("controlTower.kpi.alarmsOpen", "Cảnh báo mở")}
        title={t("controlTower.demCanhBaoChuaXu", "Đếm cảnh báo chưa xử lý (mọi thời điểm): andon chưa resolve + sự kiện an toàn. Khác với panel 'Tình trạng cảnh báo (24h)' — đếm số phát sinh trong cửa sổ 24h. Bấm để mở Ops Console.")}
        value={alarmsCrit == null ? "—" : `${alarmsCrit} / ${alarmsHigh}`}
        tone={alarmsCrit ? "error" : "default"}
        onClick={() => setLocation("/ops-console")}
      />
      <StatChip
        icon={<Network />}
        label={t("controlTower.kpi.sites", "Sites reporting")}
        value={sitesReporting == null ? "—" : `${sitesReporting} / ${sitesTotal}`}
        onClick={() => setLocation("/corporate-dashboard")}
        title={t("controlTower.kpi.sitesGo", "Mở Corporate dashboard")}
      />
      <StatChip icon={<Sparkles />} label={t("controlTower.kpi.ai", "AI insights")} value={fmtNum(ai)} />
    </StatChipRow>
  );
}

// ── doc 68 §3.2 (việc 1) — HERO status band ──────────────────────────────────
// Đèn tổng (Khỏe/Cảnh báo/Sự cố) + đếm cảnh báo mở + 1 dòng bất thường #1. Đây là
// mảng chính: người vận hành neo mắt <10s trước khi quét panel. Trung thực: khi
// nguồn alarm không khả dụng → "Chưa rõ" (muted), không bịa trạng thái "Khỏe".
function HeroStatusBand({
  kpi,
  topAlert,
  isLoading,
}: {
  kpi: KpiSummary | undefined;
  topAlert: { title: string; severity: string; ts: number } | null;
  isLoading: boolean;
}): React.JSX.Element {
  const { t } = useTranslation();
  const [, setLocation] = useLocation();

  const alarms = kpi?.alarms.available ? kpi.alarms.value : null;
  const crit = alarms?.critical ?? 0;
  const high = alarms?.high ?? 0;
  const total = alarms?.total ?? 0;
  const level: SemanticTone = alarms == null ? "muted" : crit > 0 ? "danger" : high > 0 ? "warning" : "success";
  const label =
    alarms == null
      ? t("controlTower.hero.unknown", "Chưa rõ")
      : level === "danger"
        ? t("controlTower.hero.incident", "Sự cố")
        : level === "warning"
          ? t("controlTower.hero.warning", "Cảnh báo")
          : t("controlTower.hero.healthy", "Khỏe");
  const badgeTone = level === "danger" ? "error" : level === "warning" ? "warning" : level === "success" ? "success" : "default";

  if (isLoading && kpi == null) {
    return <div className="h-16 w-full animate-pulse rounded-lg border border-border bg-muted/30" aria-hidden="true" />;
  }

  return (
    <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border px-4 py-3", TONE_TILE_CLASS[level])}>
      {/* Đèn tổng: chấm (nhấp nháy khi nghiêm trọng) + StatusBadge. */}
      <div className="flex items-center gap-2.5">
        <span
          className={cn("h-3.5 w-3.5 shrink-0 rounded-full", TONE_DOT_CLASS[level], (level === "danger" || level === "warning") && "animate-pulse")}
          aria-hidden="true"
        />
        <StatusBadge status={label} tone={badgeTone} className="text-sm" />
      </div>

      {/* Đếm cảnh báo mở (bấm → Ops Console). */}
      {alarms != null && (
        <button
          type="button"
          onClick={() => setLocation("/ops-console")}
          className="rounded-md text-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          title={t("controlTower.hero.openOps", "Mở Ops Console")}
        >
          <span className="font-semibold tabular-nums text-destructive">{crit}</span>{" "}
          <span className="text-muted-foreground">{t("controlTower.hero.critical", "nặng")}</span>
          {" · "}
          <span className="font-semibold tabular-nums text-warning">{high}</span>{" "}
          <span className="text-muted-foreground">{t("controlTower.hero.high", "cao")}</span>
          {" · "}
          <span className="font-semibold tabular-nums">{total}</span>{" "}
          <span className="text-muted-foreground">{t("controlTower.hero.open", "đang mở")}</span>
        </button>
      )}

      {/* 1 dòng bất thường #1 (hoặc "tất cả ổn" khi không có cảnh báo mở). */}
      <div className="min-w-0 flex-1 basis-full sm:basis-0">
        {topAlert ? (
          <p className="truncate text-sm">
            <span className="text-muted-foreground">{t("controlTower.hero.topAnomaly", "Bất thường #1")}: </span>
            <span className="font-medium">{topAlert.title}</span>
          </p>
        ) : alarms != null && level === "success" ? (
          <p className="truncate text-sm text-muted-foreground">
            {t("controlTower.hero.allClear", "Không có cảnh báo đang mở — hệ thống ổn định.")}
          </p>
        ) : null}
      </div>
    </div>
  );
}
