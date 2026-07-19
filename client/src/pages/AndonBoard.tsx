/**
 * AndonBoard — dedicated shopfloor Andon/TV board at /andon
 * (doc 27 §5 gap F7 / Đợt 5.4, W5-C).
 *
 * Designed for a wall TV viewed from 5–10 m:
 *   • no app chrome at all (own full-screen root — works with or without ?kiosk=1),
 *   • rem/vw-scaled huge type, high-contrast semantic tokens (light + dark),
 *   • top strip = factory KPIs today (canonical final yield / true FPY / output /
 *     last-hour UPH / NG / active andons + open alerts) + connection health + clock,
 *   • grid of line sections with machine tiles (yield %, NG, state colour),
 *   • bottom ticker of active Andon events,
 *   • auto-cycle all-lines ↔ per-line views (?cycle=30), URL-configurable
 *     filters/theme/thresholds — see lib/andonBoard.ts for the URL contract,
 *   • realtime: socket-first (shared socket, global room events trigger a
 *     debounced refetch), 15s poll fallback via usePollingInterval, PollFreshness
 *     staleness label, and a reload-once safeguard when data is stale > 5 min.
 *
 * No interaction is required; tiles stay clickable (machine → /machine/:id
 * cockpit, line header → drill view) for setup use.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
// doc 64 IA-10 S1 — truc pham vi ISA-95.
import { useScope } from "@/components/patterns/ScopeFilterBar";
import { useScopeWired } from "@/contexts/AssetScopeContext";
import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { AlertTriangle, Check, Loader2, Megaphone, MonitorOff, Settings } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { getSharedSocket, releaseSharedSocket } from "@/lib/socketManager";
import { usePollingInterval } from "@/hooks/usePollingInterval";
import { usePermissions } from "@/_core/hooks/usePermissions";
import { PollFreshness } from "@/components/PollFreshness";
import ManualHelp from "@/components/ManualHelp";
import {
  parseAndonBoardParams,
  nextCycleIndex,
  tileStatus,
  agoLabel,
  type TileStatus,
} from "@/lib/andonBoard";

const POLL_MS = 15_000;
const STALE_RELOAD_MS = 5 * 60 * 1000;
const RELOAD_GUARD_KEY = "andon_board_last_reload";

// Tile skin per status — semantic tokens only (theme-safe in light AND dark).
const TILE_CLASS: Record<TileStatus, string> = {
  andon: "border-destructive bg-destructive text-destructive-foreground animate-pulse",
  crit: "border-destructive bg-destructive/15 text-foreground",
  warn: "border-warning bg-warning/15 text-foreground",
  good: "border-success bg-success/10 text-foreground",
  offline: "border-border bg-muted/60 text-muted-foreground",
  idle: "border-border bg-card text-muted-foreground",
};

const YIELD_TEXT_CLASS: Record<TileStatus, string> = {
  andon: "text-destructive-foreground",
  crit: "text-destructive",
  warn: "text-warning",
  good: "text-success",
  offline: "text-muted-foreground",
  idle: "text-muted-foreground",
};

const ANDON_STATE_DOT: Record<string, string> = {
  red: "bg-destructive",
  call: "bg-destructive",
  yellow: "bg-warning",
  green: "bg-success",
};

function fmtPct(v: number | null | undefined): string {
  return v == null ? "—" : `${v.toFixed(v >= 100 ? 0 : 1)}%`;
}

export default function AndonBoard() {
  const { t } = useTranslation();
  const params = useMemo(
    () => parseAndonBoardParams(typeof window === "undefined" ? "" : window.location.search),
    [],
  );

  // ── URL theme override (?theme=dark|light) — restored on unmount ─────────
  useEffect(() => {
    if (!params.theme) return;
    const root = document.documentElement;
    const hadDark = root.classList.contains("dark");
    const hadLight = root.classList.contains("light");
    root.classList.toggle("dark", params.theme === "dark");
    root.classList.toggle("light", params.theme === "light");
    return () => {
      root.classList.toggle("dark", hadDark);
      root.classList.toggle("light", hadLight);
    };
  }, [params.theme]);

  // ── Data: 15s poll fallback; socket events refetch sooner ────────────────
  const polling = usePollingInterval(POLL_MS);
  const utils = trpc.useUtils();
  // doc 64 IA-10 S1 — trục phạm vi: URL kiosk (?factory=&lines=) THẮNG (cấu hình TV
  // chủ đích); trục lấp khi URL không chỉ định → board theo Xưởng/Chuyền đã chọn.
  const { scope: assetScope } = useScope(["factory", "line"]);
  useScopeWired();
  const boardQuery = trpc.dashboard.getAndonBoard.useQuery(
    {
      factoryId: params.factoryId ?? assetScope.factoryId ?? undefined,
      lineIds: params.lineIds.length > 0 ? params.lineIds : assetScope.lineId !== undefined ? [assetScope.lineId] : undefined,
    },
    { ...polling, refetchOnReconnect: "always" },
  );
  const board = boardQuery.data;

  // Debounced socket-triggered refetch (events can burst).
  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleRefetch = useCallback(() => {
    if (refetchTimer.current) return;
    refetchTimer.current = setTimeout(() => {
      refetchTimer.current = null;
      void utils.dashboard.getAndonBoard.invalidate();
    }, 1500);
  }, [utils]);

  // ── B6: operator acknowledge (andon/canEdit — operators have it per RBAC) ────
  const { hasPermission } = usePermissions();
  const canAck = hasPermission("andon", "canEdit");
  const [ackingId, setAckingId] = useState<number | null>(null);
  const ackAndon = trpc.andon.acknowledge.useMutation({
    onSuccess: () => {
      toast.success(t("andonBoard.ackDone", "Đã xác nhận Andon"));
      void utils.dashboard.getAndonBoard.invalidate();
    },
    onError: (e) => toast.error(e.message),
    onSettled: () => setAckingId(null),
  });
  const handleAck = (id: number) => {
    if (!canAck || ackingId != null) return;
    setAckingId(id);
    ackAndon.mutate({ id });
  };

  // ── Socket: online set + event-driven refresh ────────────────────────────
  const [socketConnected, setSocketConnected] = useState(false);
  const [onlineMachines, setOnlineMachines] = useState<Set<string>>(new Set());
  useEffect(() => {
    const socket = getSharedSocket();
    const onConnect = () => {
      setSocketConnected(true);
      socket.emit("subscribe", {}); // join the global room (andon/oee/alert pushes)
      socket.emit("admin:get_online_machines");
    };
    const onDisconnect = () => setSocketConnected(false);
    const onOnlineList = (data: { machines: string[] }) => setOnlineMachines(new Set(data.machines));
    const onStatusChange = (data: { machineCode: string; status: "online" | "offline" }) => {
      setOnlineMachines((prev) => {
        const next = new Set(prev);
        if (data.status === "online") next.add(data.machineCode);
        else next.delete(data.machineCode);
        return next;
      });
    };
    const onDataEvent = () => scheduleRefetch();

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("machine:online_list", onOnlineList);
    socket.on("machine:status_change", onStatusChange);
    socket.on("andon:event", onDataEvent);
    socket.on("dashboard:update", onDataEvent);
    socket.on("ng:alert", onDataEvent);
    socket.on("yield:warning", onDataEvent);
    socket.on("qualityGate:triggered", onDataEvent);
    if (socket.connected) onConnect();

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("machine:online_list", onOnlineList);
      socket.off("machine:status_change", onStatusChange);
      socket.off("andon:event", onDataEvent);
      socket.off("dashboard:update", onDataEvent);
      socket.off("ng:alert", onDataEvent);
      socket.off("yield:warning", onDataEvent);
      socket.off("qualityGate:triggered", onDataEvent);
      if (refetchTimer.current) clearTimeout(refetchTimer.current);
      releaseSharedSocket();
    };
  }, [scheduleRefetch]);

  // ── Stale-data safeguard: reload once if nothing fresh for > 5 min ───────
  useEffect(() => {
    const id = setInterval(() => {
      const updatedAt = boardQuery.dataUpdatedAt;
      if (!updatedAt || Date.now() - updatedAt < STALE_RELOAD_MS) return;
      if (document.visibilityState !== "visible") return;
      const last = Number(sessionStorage.getItem(RELOAD_GUARD_KEY) || 0);
      if (Date.now() - last < 2 * STALE_RELOAD_MS) return; // never reload-loop
      sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()));
      window.location.reload();
    }, 30_000);
    return () => clearInterval(id);
  }, [boardQuery.dataUpdatedAt]);

  // ── Clock (big, 1s tick) ──────────────────────────────────────────────────
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // ── Auto-cycle: view 0 = all lines, then one per line ─────────────────────
  const lines = board?.lines ?? [];
  const viewCount = 1 + lines.length;
  const [viewIndex, setViewIndex] = useState(0);
  useEffect(() => {
    if (params.cycleSec <= 0 || viewCount <= 1) return;
    const id = setInterval(
      () => setViewIndex((i) => nextCycleIndex(i, viewCount)),
      params.cycleSec * 1000,
    );
    return () => clearInterval(id);
  }, [params.cycleSec, viewCount]);
  useEffect(() => {
    // Data shrank (filter/removal) → never point at a missing view.
    if (viewIndex >= viewCount) setViewIndex(0);
  }, [viewIndex, viewCount]);

  const visibleLines = viewIndex === 0 ? lines : lines.slice(viewIndex - 1, viewIndex);
  const drilled = viewIndex !== 0;

  const kpis = board?.kpis;
  // B6: the "Andon đang mở" tile and its sub now read from the SAME active-andon
  // stream the ticker/tiles render (andon_events) instead of the unrelated
  // alert_history table — so "4 open / 0 alerts" can no longer contradict.
  // `raised` = active but not yet acknowledged by anyone.
  const unackedAndons = (board?.andons ?? []).filter((a) => a.status === "raised").length;
  const connState: "live" | "poll" | "offline" = boardQuery.isError
    ? "offline"
    : socketConnected
      ? "live"
      : "poll";

  return (
    <div className="fixed inset-0 z-40 flex flex-col overflow-hidden bg-background text-foreground">
      {/* ── Top strip: title + KPIs + health + clock ── */}
      <header className="flex items-stretch gap-[1vw] border-b-2 border-border bg-card px-[1.2vw] py-[0.8vh]">
        <div className="flex min-w-0 flex-col justify-center">
          <div className="flex items-center gap-2">
            <Megaphone className="size-[1.6vw] min-h-5 min-w-5 text-primary" aria-hidden />
            <h1 className="truncate text-[clamp(1.1rem,1.8vw,2.2rem)] font-black uppercase tracking-wide">
              {t("andonBoard.title", "Bảng Andon")}
            </h1>
          </div>
          <p className="truncate text-[clamp(0.65rem,0.9vw,1rem)] text-muted-foreground">
            {drilled && visibleLines[0]
              ? `${visibleLines[0].lineName ?? t("andonBoard.noLine", "Chưa gán line")} · ${visibleLines[0].factoryName ?? ""}`
              : t("andonBoard.allLines", "Toàn bộ line")}
            {params.cycleSec > 0 && ` · ⟳${params.cycleSec}s`}
          </p>
        </div>

        <div className="ml-auto grid auto-cols-fr grid-flow-col items-center gap-[1vw]">
          <KpiTile
            label={t("andonBoard.finalYield", "Final Yield hôm nay")}
            value={fmtPct(kpis?.finalYield)}
            tone={kpis?.finalYield == null ? "muted" : kpis.finalYield < params.critPct ? "crit" : kpis.finalYield < params.warnPct ? "warn" : "good"}
          />
          {/* doc65 V4: FPY dùng CÙNG quy tắc ngưỡng màu với Final Yield — 2 ô cạnh nhau
              cùng 100% mà một xanh một trắng là bất nhất tín hiệu. */}
          <KpiTile
            label={t("andonBoard.fpy", "FPY")}
            value={fmtPct(kpis?.fpy)}
            tone={kpis?.fpy == null ? "muted" : kpis.fpy < params.critPct ? "crit" : kpis.fpy < params.warnPct ? "warn" : "good"}
          />
          <KpiTile
            label={t("andonBoard.output", "Sản lượng")}
            value={kpis ? String(kpis.total) : "—"}
            sub={`UPH ${kpis ? kpis.uphLastHour : "—"}`}
            tone="neutral"
          />
          <KpiTile
            label={t("andonBoard.ngToday", "NG hôm nay")}
            value={kpis ? String(kpis.ng) : "—"}
            tone={kpis && kpis.ng > 0 ? "warn" : "neutral"}
          />
          <KpiTile
            label={t("andonBoard.activeAndons", "Andon đang mở")}
            value={kpis ? String(kpis.activeAndons) : "—"}
            sub={`${t("andonBoard.unacked", "Chưa xác nhận")}: ${board ? unackedAndons : "—"}`}
            tone={kpis && kpis.activeAndons > 0 ? "crit" : "good"}
          />
        </div>

        <div className="flex flex-col items-end justify-center gap-1 pl-[0.5vw]">
          <div className="text-[clamp(1.4rem,2.6vw,3.4rem)] font-black leading-none tabular-nums">
            {now.toLocaleTimeString("vi-VN", { hour12: false })}
          </div>
          <div className="flex items-center gap-2">
            <span
              role="status"
              title={connState}
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[clamp(0.55rem,0.7vw,0.85rem)] font-bold uppercase",
                connState === "live" && "bg-success/15 text-success",
                connState === "poll" && "bg-warning/15 text-warning",
                connState === "offline" && "bg-destructive/15 text-destructive",
              )}
            >
              <span className={cn(
                "size-2 rounded-full",
                connState === "live" && "bg-success animate-pulse",
                connState === "poll" && "bg-warning",
                connState === "offline" && "bg-destructive",
              )} />
              {connState === "live"
                ? t("realtime.live", "Trực tiếp")
                : connState === "poll"
                  ? t("realtime.polling", "Định kỳ")
                  : t("realtime.offline", "Mất kết nối")}
            </span>
            <PollFreshness updatedAt={boardQuery.dataUpdatedAt || undefined} isFetching={boardQuery.isFetching} />
            {/* Setup-only escape hatch — tiny, unobtrusive */}
            <Link href="/dashboard" title={t("andonBoard.backToDashboard", "Về Dashboard")} className="text-muted-foreground/60 hover:text-foreground">
              <Settings className="size-[1vw] min-h-4 min-w-4" aria-hidden />
            </Link>
          </div>
        </div>
      </header>

      {/* ── Lines + machine tiles ── */}
      {/* overflow-y-auto: with many lines nothing is silently clipped (a real TV
          should be given ?lines=…/?factory=… or ?cycle=… to fit one screen). */}
      <main className="flex-1 overflow-y-auto overflow-x-hidden px-[1.2vw] py-[1vh]">
        {boardQuery.isLoading && (
          <div className="flex h-full items-center justify-center text-[clamp(1rem,2vw,2.5rem)] text-muted-foreground">
            {t("common.loading", "Đang tải…")}
          </div>
        )}
        {boardQuery.isError && !board && (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-destructive">
            <MonitorOff className="size-[4vw] min-h-10 min-w-10" aria-hidden />
            <p className="text-[clamp(1rem,2vw,2.5rem)] font-bold">
              {t("andonBoard.loadError", "Không tải được dữ liệu — sẽ tự thử lại")}
            </p>
          </div>
        )}
        {board && lines.length === 0 && (
          <div className="flex h-full items-center justify-center text-[clamp(1rem,2vw,2.5rem)] text-muted-foreground">
            {t("andonBoard.noMachines", "Không có máy nào khớp bộ lọc")}
          </div>
        )}

        <div className={cn("grid min-h-full content-start gap-[1vh]", drilled && "content-stretch")}>
          {visibleLines.map((line) => (
            <section key={line.lineId ?? "none"} className="min-w-0">
              <button
                type="button"
                onClick={() => {
                  const idx = lines.indexOf(line);
                  setViewIndex(drilled ? 0 : idx + 1);
                }}
                className="mb-[0.5vh] flex min-h-10 w-full items-baseline gap-[1vw] border-b border-border pb-[0.3vh] text-left"
                title={drilled ? t("andonBoard.showAll", "Xem tất cả line") : t("andonBoard.drillLine", "Xem riêng line này")}
              >
                <span className="flex items-center gap-2 text-[clamp(0.9rem,1.5vw,1.9rem)] font-extrabold uppercase">
                  {line.andonState && (
                    <span className={cn("size-[0.9vw] min-h-3 min-w-3 rounded-full animate-pulse", ANDON_STATE_DOT[line.andonState])} />
                  )}
                  {line.lineName ?? t("andonBoard.noLine", "Chưa gán line")}
                </span>
                <span className={cn(
                  "text-[clamp(0.9rem,1.5vw,1.9rem)] font-black tabular-nums",
                  line.finalYield == null ? "text-muted-foreground"
                    : line.finalYield < params.critPct ? "text-destructive"
                      : line.finalYield < params.warnPct ? "text-warning" : "text-success",
                )}>
                  {fmtPct(line.finalYield)}
                </span>
                <span className="text-[clamp(0.65rem,0.9vw,1.1rem)] text-muted-foreground">
                  {t("andonBoard.lineSummary", { ng: line.ng, total: line.total, defaultValue: "NG {{ng}} / {{total}} bo" })}
                </span>
              </button>

              <div
                className="grid gap-[0.6vw]"
                style={{
                  gridTemplateColumns: `repeat(auto-fill, minmax(${drilled ? "16vw" : "11vw"}, 1fr))`,
                }}
              >
                {line.machines.map((m) => {
                  const status = tileStatus({
                    finalYield: m.finalYield,
                    andonState: m.andonState,
                    online: onlineMachines.size > 0 ? onlineMachines.has(m.code) : null,
                    warnPct: params.warnPct,
                    critPct: params.critPct,
                  });
                  return (
                    <Link
                      key={m.machineId}
                      href={`/machine/${m.machineId}`}
                      className={cn(
                        "flex min-w-0 flex-col rounded-xl border-2 px-[0.7vw] py-[0.6vh] transition-colors",
                        TILE_CLASS[status],
                      )}
                      title={`${m.name} · ${m.stationName ?? ""}`}
                    >
                      <div className="flex items-start justify-between gap-1">
                        {/* doc65 PRO-100: TV không có hover — mã máy được wrap tối đa 2 dòng
                            (break-all) thay vì ellipsis nuốt hậu tố định danh ("SIM-L2-CONVE…"). */}
                        {/* ​ sau '-' → wrap tại ranh giới token, không gãy giữa từ (CONVEY/OR). */}
                        <span className="line-clamp-2 text-[clamp(0.7rem,1vw,1.3rem)] font-bold leading-tight [overflow-wrap:break-word]">{m.code.replace(/-/g, "-​")}</span>
                        {status === "offline" && <MonitorOff className="size-[0.9vw] min-h-3 min-w-3 shrink-0" aria-hidden />}
                        {m.andonState === "yellow" && status !== "andon" && (
                          <AlertTriangle className="size-[0.9vw] min-h-3 min-w-3 shrink-0 text-warning" aria-hidden />
                        )}
                      </div>
                      <div className={cn(
                        "text-[clamp(1.3rem,2.6vw,4rem)] font-black leading-none tabular-nums",
                        status !== "andon" && YIELD_TEXT_CLASS[status],
                      )}>
                        {m.finalYield == null ? t("andonBoard.idle", "—") : fmtPct(m.finalYield)}
                      </div>
                      <div className="mt-auto flex items-baseline justify-between text-[clamp(0.6rem,0.85vw,1.05rem)] font-semibold opacity-90">
                        <span>NG {m.ng}</span>
                        <span>{m.total} {t("andonBoard.boards", "bo")}</span>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </main>

      {/* ── Bottom ticker: active Andon events ── */}
      <footer className="border-t-2 border-border bg-card">
        <div className="relative flex h-[clamp(2.2rem,4.5vh,4rem)] items-center overflow-hidden">
          <span className="z-10 flex h-full shrink-0 items-center gap-2 bg-destructive px-[1vw] text-[clamp(0.7rem,1vw,1.3rem)] font-black uppercase text-destructive-foreground">
            <Megaphone className="size-[1vw] min-h-4 min-w-4" aria-hidden />
            Andon
          </span>
          {board && board.andons.length === 0 ? (
            <span className="px-[1vw] text-[clamp(0.7rem,1vw,1.3rem)] font-semibold text-success">
              {t("andonBoard.tickerEmpty", "Không có Andon đang mở — mọi line hoạt động bình thường")}
            </span>
          ) : (
            // pause-on-hover so the "Tra mã" popover trigger holds still while open
            <div className="andon-ticker-track flex items-center gap-[3vw] whitespace-nowrap pl-[2vw] hover:[animation-play-state:paused] focus-within:[animation-play-state:paused]">
              {(board?.andons ?? []).map((a) => (
                <span key={a.id} className="inline-flex items-center gap-2 text-[clamp(0.75rem,1.1vw,1.4rem)] font-bold">
                  <span className={cn("size-[0.8vw] min-h-3 min-w-3 rounded-full animate-pulse", ANDON_STATE_DOT[a.state] ?? "bg-muted-foreground")} />
                  <span className="uppercase text-muted-foreground">{a.lineName ?? a.machineCode ?? "—"}</span>
                  {a.machineCode && a.lineName && <span className="text-muted-foreground">· {a.machineCode}</span>}
                  <span>{a.title}</span>
                  <span className="text-muted-foreground">({agoLabel(new Date(a.raisedAt).getTime(), now.getTime())})</span>
                  {/* doc 37 B1: page-cited manual lookup for the alarm cause/remedy. Andon events
                      carry no vendor/nativeCode → broad search keyed off the event title + reason
                      (the fallback path; mapAlarm needs vendor+nativeCode which this shape lacks). */}
                  <ManualHelp
                    query={`${a.title} ${a.reason ?? ""} alarm cause remedy`.trim()}
                    buttonLabel={t("andonBoard.lookupCode", "Tra mã")}
                    size="sm"
                    variant="secondary"
                    align="end"
                    className="text-[clamp(0.6rem,0.8vw,1rem)]"
                  />
                  {/* B6: acknowledge — hover pauses the ticker so this stays clickable */}
                  {a.status === "raised" ? (
                    <button
                      type="button"
                      onClick={() => handleAck(a.id)}
                      disabled={!canAck || ackingId != null}
                      title={
                        canAck
                          ? t("andonBoard.ackHint", "Xác nhận đã tiếp nhận Andon này")
                          : t("andonBoard.ackNoPerm", "Bạn không có quyền xác nhận Andon")
                      }
                      className="inline-flex min-h-10 items-center gap-1 rounded-md border border-current px-2.5 py-0.5 text-[clamp(0.6rem,0.8vw,1rem)] font-bold uppercase transition-colors hover:bg-foreground/10 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {ackingId === a.id ? (
                        <Loader2 className="size-[0.9vw] min-h-3 min-w-3 animate-spin" aria-hidden />
                      ) : (
                        <Check className="size-[0.9vw] min-h-3 min-w-3" aria-hidden />
                      )}
                      {t("andonBoard.ack", "Xác nhận")}
                    </button>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[clamp(0.6rem,0.8vw,1rem)] font-semibold text-success">
                      <Check className="size-[0.9vw] min-h-3 min-w-3" aria-hidden />
                      {t("andonBoard.acked", "Đã xác nhận")}
                    </span>
                  )}
                </span>
              ))}
            </div>
          )}
        </div>
        {/* Marquee keyframes — scoped to this board only */}
        <style>{`
          .andon-ticker-track { animation: andon-ticker-scroll 30s linear infinite; will-change: transform; }
          @keyframes andon-ticker-scroll {
            0% { transform: translateX(100vw); }
            100% { transform: translateX(-100%); }
          }
          @media (prefers-reduced-motion: reduce) { .andon-ticker-track { animation: none; } }
        `}</style>
      </footer>
    </div>
  );
}

function KpiTile({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone: "good" | "warn" | "crit" | "neutral" | "muted";
}) {
  return (
    <div className="flex min-w-0 flex-col items-center justify-center px-[0.6vw] text-center">
      <span className="truncate text-[clamp(0.55rem,0.75vw,0.95rem)] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span
        className={cn(
          "text-[clamp(1.2rem,2.2vw,3rem)] font-black leading-tight tabular-nums",
          tone === "good" && "text-success",
          tone === "warn" && "text-warning",
          tone === "crit" && "text-destructive",
          tone === "muted" && "text-muted-foreground",
        )}
      >
        {value}
      </span>
      {sub && (
        <span className="truncate text-[clamp(0.55rem,0.7vw,0.9rem)] text-muted-foreground">{sub}</span>
      )}
    </div>
  );
}
