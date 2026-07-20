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
 *     staleness label, and a reload-once safeguard when data is stale > 5 min,
 *   • W8 (doc 67) "tiếng chuông": a NEW andon raise (isNewAndonRaise — never
 *     ack/resolve echoes) rings a 2-note WebAudio chime (?sound=0 mutes),
 *     flashes a destructive full-screen border (reduced-motion: 1 static beat)
 *     and — when auto-cycling — spotlights the raising line for one cycle
 *     (never stealing a fresh manual drill). Bursts within 5s collapse to one
 *     chime + one flash.
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
import { fmtPct } from "@/lib/format";
import { severityDotClass, TONE_TILE_CLASS } from "@/components/patterns/isaStateBadges";
import { ConnectionChip } from "@/components/patterns/ConnectionChip";
import { getSharedSocket, releaseSharedSocket } from "@/lib/socketManager";
import { usePollingInterval } from "@/hooks/usePollingInterval";
import { useThrottledInvalidate } from "@/hooks/useDebouncedInvalidate";
import { usePermissions } from "@/_core/hooks/usePermissions";
import { PollFreshness } from "@/components/PollFreshness";
import ManualHelp from "@/components/ManualHelp";
import {
  parseAndonBoardParams,
  nextCycleIndex,
  tileStatus,
  agoLabel,
  andonTileReason,
  isNewAndonRaise,
  type TileStatus,
} from "@/lib/andonBoard";

const POLL_MS = 15_000;
// doc 68 §3.5 (P1 — "không cắt-khuất line"): a wall TV has nobody to scroll, so
// on ?kiosk we default the auto-cycle ON (each line gets its own full-screen view
// in turn) unless the URL already sets ?cycle=. Operator/mobile keep it off.
const DEFAULT_TV_CYCLE_SEC = 20;
const STALE_RELOAD_MS = 5 * 60 * 1000;
const RELOAD_GUARD_KEY = "andon_board_last_reload";
// W8 (doc 67): burst guard — many raises within 5s → one chime + one flash.
const SIGNAL_THROTTLE_MS = 5_000;
// W8: flash lasts ~2.5s (3 beats; reduced-motion = 1 static beat, same span).
const FLASH_MS = 2_500;

// Tile skin per status — W7 GĐ2: crit/warn/good/offline lấy từ TONE_TILE_CLASS shared
// (đối chiếu: khớp byte-identical với bản local cũ — không đổi hình thức TV).
// GIỮ LOCAL có chủ đích:
//   • andon: nền destructive ĐẶC + pulse — tín hiệu khẩn nhất phải đọc được từ 5–10 m,
//     soft-tint shared (bg-destructive/15) sẽ làm nhạt;
//   • idle: bg-card để phân biệt với offline (bg-muted/60) trên cùng lưới tile.
const TILE_CLASS: Record<TileStatus, string> = {
  andon: "border-destructive bg-destructive text-destructive-foreground animate-pulse",
  crit: TONE_TILE_CLASS.danger,
  warn: TONE_TILE_CLASS.warning,
  good: TONE_TILE_CLASS.success,
  offline: TONE_TILE_CLASS.muted,
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

// W7 GĐ2: chấm trạng thái Andon dùng severityDotClass shared (red/call → danger,
// yellow → warning, green → success — khớp bản ANDON_STATE_DOT local cũ; state lạ
// rơi về chấm muted thay vì không màu). fmtPct dùng bản lib/format (1 chữ số).

export default function AndonBoard() {
  const { t } = useTranslation();
  const params = useMemo(
    () => parseAndonBoardParams(typeof window === "undefined" ? "" : window.location.search),
    [],
  );
  // doc 68 §3.5 (P1): effective cycle — explicit ?cycle= wins; else default ON for
  // the TV persona (?kiosk) so line 3 is never clipped below the fold. Derived
  // from the once-parsed params, so it is stable across renders (safe in deps).
  const effCycleSec = params.cycleSec > 0 ? params.cycleSec : params.kiosk ? DEFAULT_TV_CYCLE_SEC : 0;

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

  // Throttled socket-triggered refetch (events can burst) — W7 GĐ2: hook shared
  // useThrottledInvalidate GIỮ đúng ngữ nghĩa bản tự chế cũ (timer đang chạy → bỏ
  // qua, KHÔNG reset; fn chạy 1500ms sau lần gọi đầu mỗi đợt; tự clear khi unmount).
  const scheduleRefetch = useThrottledInvalidate(() => {
    void utils.dashboard.getAndonBoard.invalidate();
  }, 1500);

  // ── W8 (doc 67) "tiếng chuông": chime + flash + spotlight on a NEW raise ──
  // CHIME — WebAudio 2 notes (880→660 Hz, 0.6s). Autoplay-policy pattern copied
  // from OpsConsole W3 (việc 7): ONE shared AudioContext created on mount so we
  // KNOW whether the policy blocks us (state "suspended" → honest footer chip
  // "Chạm để bật chuông"); the first pointerdown anywhere (listener once)
  // resumes it. ?sound=0 skips all of this (no context, no chip).
  const audioCtxRef = useRef<AudioContext | null>(null);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const ensureAudio = useCallback((): AudioContext | null => {
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      if (!audioCtxRef.current) {
        const ctx: AudioContext = new AC();
        ctx.onstatechange = () => setAudioBlocked(ctx.state !== "running");
        audioCtxRef.current = ctx;
      }
      return audioCtxRef.current;
    } catch { return null; }
  }, []);
  const unlockAudio = useCallback(() => {
    const ctx = ensureAudio();
    if (!ctx) return;
    if (ctx.state !== "running") {
      void ctx.resume()
        .then(() => setAudioBlocked(ctx.state !== "running"))
        .catch(() => setAudioBlocked(true));
    } else setAudioBlocked(false);
  }, [ensureAudio]);
  useEffect(() => {
    if (!params.sound) return;
    const ctx = ensureAudio();
    if (ctx) setAudioBlocked(ctx.state !== "running");
    window.addEventListener("pointerdown", unlockAudio, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlockAudio);
      void audioCtxRef.current?.close().catch(() => {});
      audioCtxRef.current = null;
    };
  }, [params.sound, ensureAudio, unlockAudio]);

  const chime = useCallback(() => {
    const ctx = ensureAudio();
    if (!ctx) return;
    if (ctx.state !== "running") { setAudioBlocked(true); return; }
    try {
      // Two descending notes (~880→660 Hz over 0.6s) — a "bell", not the OpsConsole
      // square-wave klaxon: the TV rings many times a shift and must not grate.
      const t0 = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(880, t0);
      osc.frequency.setValueAtTime(660, t0 + 0.3);
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.14, t0 + 0.02);
      gain.gain.setValueAtTime(0.14, t0 + 0.27);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.3);
      gain.gain.exponentialRampToValueAtTime(0.14, t0 + 0.33);
      gain.gain.setValueAtTime(0.14, t0 + 0.5);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.6);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.62);
    } catch { /* audio unavailable — stay silent */ }
  }, [ensureAudio]);

  // FLASH — full-screen destructive border, 3 beats over ~2.5s (CSS below;
  // prefers-reduced-motion collapses it to 1 static beat of the same span).
  const [flashNew, setFlashNew] = useState(false);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (flashTimer.current) clearTimeout(flashTimer.current);
  }, []);
  // Burst guard (chime + flash share it) and spotlight bookkeeping. linesRef is
  // assigned in the auto-cycle section below (closure reads it at event time).
  const lastSignalAt = useRef(0);
  const spotlightAt = useRef(0);

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
    const onDisconnect = () => {
      setSocketConnected(false);
      // W4 (doc 67): without the socket the online-set is unknowable — drop to
      // "unknown" (tiles stop claiming online/offline) instead of freezing stale.
      setOnlineMachines(new Set());
    };
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
    // W8 (doc 67): andon:event still refetches like every data event, but a NEW
    // raise (never ack/resolve echoes — isNewAndonRaise) additionally rings the
    // chime, flashes the border and spotlights the raising line. A burst of
    // raises within 5s collapses to ONE chime + ONE flash.
    const onAndonEvent = (ev: {
      event?: string;
      status?: string;
      state?: string;
      lineId?: number | null;
      machineId?: number | null;
    }) => {
      scheduleRefetch();
      if (!isNewAndonRaise(ev)) return;
      const nowMs = Date.now();
      if (nowMs - lastSignalAt.current < SIGNAL_THROTTLE_MS) return;
      lastSignalAt.current = nowMs;
      if (params.sound) chime();
      setFlashNew(true);
      if (flashTimer.current) clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setFlashNew(false), FLASH_MS);
      // AUTO-SPOTLIGHT — only while auto-cycling, and NEVER over a fresh manual
      // drill (< cycleSec since the last tap keeps the operator's view). Jumps
      // to the raising line's view; the normal cycle resumes from there after
      // one full cycle period (spotlightAt holds the tick, mirror of W4
      // lastManualAt).
      if (effCycleSec <= 0) return;
      if (nowMs - lastManualAt.current < effCycleSec * 1000) return;
      const ls = linesRef.current;
      let idx = ev.lineId != null ? ls.findIndex((l) => l.lineId === ev.lineId) : -1;
      if (idx < 0 && ev.machineId != null) {
        idx = ls.findIndex((l) => l.machines.some((m) => m.machineId === ev.machineId));
      }
      if (idx >= 0) {
        spotlightAt.current = nowMs;
        setViewIndex(idx + 1);
      }
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("machine:online_list", onOnlineList);
    socket.on("machine:status_change", onStatusChange);
    socket.on("andon:event", onAndonEvent);
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
      socket.off("andon:event", onAndonEvent);
      socket.off("dashboard:update", onDataEvent);
      socket.off("ng:alert", onDataEvent);
      socket.off("yield:warning", onDataEvent);
      socket.off("qualityGate:triggered", onDataEvent);
      releaseSharedSocket();
    };
  }, [scheduleRefetch, chime, params.sound, effCycleSec]);

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
  // W8: the socket handler above reads the CURRENT lines at event time to map a
  // raise → view index without re-subscribing the socket on every data change.
  const linesRef = useRef(lines);
  linesRef.current = lines;
  const viewCount = 1 + lines.length;
  const [viewIndex, setViewIndex] = useState(0);
  // W4 (doc 67): a manual drill (tap on a line header) holds the view — the
  // auto-cycle skips ticks until one full cycle period of idle has passed,
  // so the board never yanks the screen away mid-inspection. W8: a spotlight
  // (auto-jump to a freshly raised line) holds it the same way, for ONE cycle.
  const lastManualAt = useRef(0);
  useEffect(() => {
    if (effCycleSec <= 0 || viewCount <= 1) return;
    const id = setInterval(() => {
      if (Date.now() - Math.max(lastManualAt.current, spotlightAt.current) < effCycleSec * 1000) return;
      setViewIndex((i) => nextCycleIndex(i, viewCount));
    }, effCycleSec * 1000);
    return () => clearInterval(id);
  }, [effCycleSec, viewCount]);
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

  // W4 (doc 67) honesty: ticker shows oldest UNACKED first (they need action),
  // then acked, each oldest-first. Items raised > 4h ago and still unacked get
  // an explicit "QUÁ HẠN" badge.
  const OVERDUE_MS = 4 * 3_600_000;
  const sortedAndons = useMemo(() => {
    const arr = [...(board?.andons ?? [])];
    arr.sort((a, b) => {
      const rankA = a.status === "raised" ? 0 : 1;
      const rankB = b.status === "raised" ? 0 : 1;
      if (rankA !== rankB) return rankA - rankB;
      return new Date(a.raisedAt).getTime() - new Date(b.raisedAt).getTime();
    });
    return arr;
  }, [board?.andons]);

  // doc 68 §3.5 (P1): a red/call tile shows its andon reason + age. Map machine →
  // its active andon (first-seen wins; server lists newest-first). Line-only
  // andons (no machineId) never reach a tile, so they are intentionally skipped.
  const andonByMachineId = useMemo(() => {
    const m = new Map<number, (typeof sortedAndons)[number]>();
    for (const a of board?.andons ?? []) {
      if (a.machineId != null && !m.has(a.machineId)) m.set(a.machineId, a);
    }
    return m;
  }, [board?.andons]);

  // W4 (doc 67) touch: hover-pause is useless on a touch panel — any pointerdown
  // on the footer pauses the marquee; it resumes after 10s of idle. With ≤ 4
  // andons there is no marquee at all (static wrapped list — always readable).
  const [tickerPaused, setTickerPaused] = useState(false);
  const tickerIdleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pauseTicker = useCallback(() => {
    setTickerPaused(true);
    if (tickerIdleTimer.current) clearTimeout(tickerIdleTimer.current);
    tickerIdleTimer.current = setTimeout(() => setTickerPaused(false), 10_000);
  }, []);
  useEffect(() => () => {
    if (tickerIdleTimer.current) clearTimeout(tickerIdleTimer.current);
  }, []);
  const staticTicker = sortedAndons.length > 0 && sortedAndons.length <= 4;

  // W4 (doc 67) honesty: "Toàn bộ line" must not lie while a URL/scope filter is
  // active — name what is actually shown (factory/line names come with the data).
  const effFactoryId = params.factoryId ?? assetScope.factoryId ?? null;
  const effLineCount = params.lineIds.length > 0 ? params.lineIds.length : assetScope.lineId !== undefined ? 1 : 0;
  const isFiltered = effFactoryId != null || effLineCount > 0;
  const filterLabel = useMemo(() => {
    if (!isFiltered) return null;
    const parts: string[] = [];
    if (effLineCount > 0) {
      const names = [...new Set(lines.map((l) => l.lineName).filter((n): n is string => !!n))];
      parts.push(names.length > 0 ? names.join(" + ") : `${effLineCount} line`);
    }
    if (effFactoryId != null) {
      const factoryName = lines.find((l) => l.factoryName)?.factoryName;
      if (factoryName) parts.push(factoryName);
      else if (parts.length === 0) parts.push(`Xưởng #${effFactoryId}`);
    }
    return parts.join(" · ");
  }, [isFiltered, effLineCount, effFactoryId, lines]);

  const connState: "live" | "poll" | "offline" = boardQuery.isError
    ? "offline"
    : socketConnected
      ? "live"
      : "poll";

  return (
    <div className="fixed inset-0 z-40 flex flex-col overflow-hidden bg-background text-foreground">
      {/* W8 (doc 67): NEW-raise flash — full-screen destructive border, 3 beats
          ~2.5s (reduced-motion: 1 static beat). Pure overlay, never eats input. */}
      {flashNew && (
        <div
          aria-hidden
          className="andon-flash-overlay pointer-events-none absolute inset-0 z-50 border-[max(0.6rem,1vw)] border-destructive"
        />
      )}
      {/* ── Top strip: title + KPIs + health + clock ── */}
      <header className="flex items-stretch gap-[1vw] border-b-2 border-border bg-card px-[1.2vw] py-[0.8vh]">
        {/* doc 68 §3.5 (P1): single-row header — drop "(TV)" + the always-on
            subtitle so it no longer clips to "BẢNG ANDON (T…" and the header is
            thinner. Drill/filter/cycle context moves inline and only appears when
            it actually differs from the default "all lines" view. */}
        <div className="flex min-w-0 items-center gap-[1vw]">
          <div className="flex min-w-0 items-center gap-2">
            <Megaphone className="size-[1.6vw] min-h-5 min-w-5 text-primary" aria-hidden />
            <h1 className="truncate text-[clamp(1.1rem,1.8vw,2.2rem)] font-black uppercase tracking-wide">
              {t("andonBoard.boardTitle", "BẢNG ANDON")}
            </h1>
          </div>
          {(drilled || filterLabel || effCycleSec > 0) && (
            <span className="truncate text-[clamp(0.65rem,0.9vw,1rem)] text-muted-foreground">
              {drilled && visibleLines[0]
                ? `${visibleLines[0].lineName ?? t("andonBoard.noLine", "Chưa gán line")}${visibleLines[0].factoryName ? ` · ${visibleLines[0].factoryName}` : ""}`
                : filterLabel
                  ? `${filterLabel} (${t("andonBoard.filtered", "đang lọc")})`
                  : ""}
              {effCycleSec > 0 && `${drilled || filterLabel ? " · " : ""}⟳${effCycleSec}s`}
            </span>
          )}
        </div>

        {/* W4 (doc 67): mobile 390px — 3-col wrap dưới sm; TV/desktop giữ 1 hàng. */}
        <div className="ml-auto grid grid-cols-3 items-center gap-[1vw] sm:grid-cols-none sm:auto-cols-fr sm:grid-flow-col">
          {/* W4 (doc 67) honesty: 100% trên n=1 bo là vô nghĩa thống kê — hiện
              n=… và dùng tone muted (không xanh/đỏ) khi mẫu < 20. */}
          <KpiTile
            label={t("andonBoard.finalYield", "Final Yield hôm nay")}
            value={fmtPct(kpis?.finalYield)}
            sub={kpis ? `n=${kpis.total}` : undefined}
            tone={kpis?.finalYield == null || kpis.total < 20 ? "muted" : kpis.finalYield < params.critPct ? "crit" : kpis.finalYield < params.warnPct ? "warn" : "good"}
          />
          {/* doc65 V4: FPY dùng CÙNG quy tắc ngưỡng màu với Final Yield — 2 ô cạnh nhau
              cùng 100% mà một xanh một trắng là bất nhất tín hiệu. */}
          <KpiTile
            label={t("andonBoard.fpy", "FPY")}
            value={fmtPct(kpis?.fpy)}
            sub={kpis ? `n=${kpis.firstTotal}` : undefined}
            tone={kpis?.fpy == null || kpis.firstTotal < 20 ? "muted" : kpis.fpy < params.critPct ? "crit" : kpis.fpy < params.warnPct ? "warn" : "good"}
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
          {/* doc 68 §3.5 (P2): "Andon đang mở" = câu hỏi số 1 của bảng → hero
              (cỡ/màu trội), các KPI còn lại là ngữ cảnh phụ. */}
          <KpiTile
            hero
            label={t("andonBoard.activeAndons", "Andon đang mở")}
            value={kpis ? String(kpis.activeAndons) : "—"}
            sub={`${t("andonBoard.unacked", "Chưa xác nhận")}: ${board ? unackedAndons : "—"}`}
            tone={kpis && kpis.activeAndons > 0 ? "crit" : "good"}
          />
        </div>

        <div className="flex flex-col items-end justify-center gap-1 pl-[0.5vw]">
          {/* doc 68 §3.5 (P2): clock demoted — it was the 2nd-brightest mass on the
              board for no reason; the hero belongs to "Andon đang mở". */}
          <div className="text-[clamp(1.1rem,1.8vw,2.2rem)] font-bold leading-none tabular-nums text-muted-foreground">
            {/* W4 (doc 67): mobile — ẩn giây dưới md cho khỏi tràn hàng KPI. */}
            <span className="md:hidden">
              {now.toLocaleTimeString("vi-VN", { hour12: false, hour: "2-digit", minute: "2-digit" })}
            </span>
            <span className="hidden md:inline">{now.toLocaleTimeString("vi-VN", { hour12: false })}</span>
          </div>
          <div className="flex items-center gap-2">
            {/* W7 GĐ2: pill tự chế → ConnectionChip size='tv' (chuẩn GĐ1). Đổi hình
                thức CÓ CHỦ ĐÍCH theo chip shared: offline = muted (không giả đỏ như
                bản cũ — "mất kết nối" là mất tươi, không phải sự cố sản xuất).
                KHÔNG truyền lastEventAt: PollFreshness ngay cạnh đã khai tuổi dữ liệu
                — thêm tuổi vào chip sẽ hiện 2 con số trùng nhau. */}
            <ConnectionChip
              size="tv"
              state={connState === "live" ? "live" : connState === "poll" ? "polling" : "offline"}
              pulse={connState === "live"}
              label={
                connState === "live"
                  ? t("realtime.live", "Trực tiếp")
                  : connState === "poll"
                    ? t("realtime.polling", "Định kỳ")
                    : t("realtime.offline", "Mất kết nối")
              }
            />
            {/* doc 68 §3.5 (P2): ẩn chrome tương tác ở kiosk/TV (freshness + gear) —
                một bảng treo tường không ai bấm; operator/mobile giữ nguyên. */}
            {!params.kiosk && (
              <PollFreshness updatedAt={boardQuery.dataUpdatedAt || undefined} isFetching={boardQuery.isFetching} />
            )}
            {!params.kiosk && (
              /* Setup-only escape hatch — icon nhỏ nhưng hit-area ≥ 40px (W4 doc 67 touch) */
              <Link
                href="/dashboard"
                title={t("andonBoard.backToDashboard", "Về Dashboard")}
                className="flex min-h-10 min-w-10 items-center justify-center text-muted-foreground/60 hover:text-foreground"
              >
                <Settings className="size-[1vw] min-h-4 min-w-4" aria-hidden />
              </Link>
            )}
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
                  lastManualAt.current = Date.now();
                  const idx = lines.indexOf(line);
                  setViewIndex(drilled ? 0 : idx + 1);
                }}
                className="mb-[0.5vh] flex min-h-10 w-full items-baseline gap-[1vw] border-b border-border pb-[0.3vh] text-left"
                title={drilled ? t("andonBoard.showAll", "Xem tất cả line") : t("andonBoard.drillLine", "Xem riêng line này")}
              >
                <span className="flex items-center gap-2 text-[clamp(0.9rem,1.5vw,1.9rem)] font-extrabold uppercase">
                  {line.andonState && (
                    // doc 68 §3.5 (P2): ≥1.6vw — 0.9vw (~17px) là vô hình từ 5–10 m.
                    <span className={cn("size-[1.6vw] min-h-4 min-w-4 rounded-full animate-pulse", severityDotClass(line.andonState))} />
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

              {/* doc 68 §3.5 (P2): auto-fit (not auto-fill) — a line with few
                  machines stretches its tiles to fill the row instead of leaving
                  4 empty cells trailing; no line reads as "half-empty". */}
              <div
                className="grid gap-[0.6vw]"
                style={{
                  gridTemplateColumns: `repeat(auto-fit, minmax(${drilled ? "16vw" : "11vw"}, 1fr))`,
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
                  // doc 68 §3.5 (P1): a red/call tile must say WHY (reason + age),
                  // not "—" or a bare yield the eye can't parse from 5–10 m.
                  const activeAndon = status === "andon" ? andonByMachineId.get(m.machineId) : undefined;
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
                        {/* W4 (doc 67) TV: ≥1.5vw (≈29px@FHD) — mã máy phải đọc được từ 5–10 m. */}
                        <span className="line-clamp-2 text-[clamp(0.85rem,1.5vw,1.9rem)] font-bold leading-tight [overflow-wrap:break-word]">{m.code.replace(/-/g, "-​")}</span>
                        {/* doc 68 §3.5 (P2): dấu hiệu trạng thái ≥1.6vw — đọc được từ xa. */}
                        {status === "offline" && <MonitorOff className="size-[1.6vw] min-h-5 min-w-5 shrink-0" aria-hidden />}
                        {m.andonState === "yellow" && status !== "andon" && (
                          <AlertTriangle className="size-[1.6vw] min-h-5 min-w-5 shrink-0 text-warning" aria-hidden />
                        )}
                      </div>
                      {status === "andon" ? (
                        <div className="min-w-0">
                          {/* Reason word(s) — big, high-contrast (inherits the tile's
                              destructive-foreground). This is what the eye needs at range. */}
                          <div className="line-clamp-2 text-[clamp(1.1rem,2.2vw,3rem)] font-black uppercase leading-none [overflow-wrap:break-word]">
                            {andonTileReason({ title: activeAndon?.title, reason: activeAndon?.reason, state: m.andonState })}
                          </div>
                          {activeAndon && (
                            <div className="mt-[0.3vh] text-[clamp(0.8rem,1.3vw,1.7rem)] font-bold leading-none tabular-nums opacity-90">
                              {agoLabel(new Date(activeAndon.raisedAt).getTime(), now.getTime())}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className={cn(
                          "text-[clamp(1.3rem,2.6vw,4rem)] font-black leading-none tabular-nums",
                          YIELD_TEXT_CLASS[status],
                        )}>
                          {m.finalYield == null ? t("andonBoard.idle", "—") : fmtPct(m.finalYield)}
                        </div>
                      )}
                      <div className="mt-auto flex items-baseline justify-between text-[clamp(0.7rem,1vw,1.3rem)] font-semibold opacity-90">
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
      {/* W4 (doc 67) touch: any pointerdown on the footer pauses the marquee
          (hover-pause never fires on a touch panel); resumes after 10s idle. */}
      <footer className="relative border-t-2 border-border bg-card" onPointerDown={pauseTicker}>
        {/* W8 (doc 67): autoplay policy blocks the chime until a user gesture —
            say so honestly (OpsConsole W3 pattern) instead of ringing silently.
            Any tap anywhere unlocks (window pointerdown once) → chip vanishes. */}
        {params.sound && audioBlocked && (
          <button
            type="button"
            onClick={unlockAudio}
            className="absolute bottom-[0.5vh] right-[0.5vw] z-20 min-h-10 rounded-md border border-warning bg-card px-2.5 py-1 text-[clamp(0.6rem,0.9vw,1.1rem)] font-semibold text-warning"
          >
            {t("andonBoard.tapToEnableSound", "Chạm để bật chuông")}
          </button>
        )}
        <div
          className={cn(
            "andon-ticker-viewport relative flex items-center",
            staticTicker
              ? "min-h-[clamp(2.2rem,4.5vh,4rem)] max-h-[24vh] overflow-y-auto"
              : "h-[clamp(2.2rem,4.5vh,4rem)] overflow-hidden",
          )}
        >
          <span className="z-10 flex shrink-0 items-center gap-2 self-stretch bg-destructive px-[1vw] text-[clamp(0.7rem,1vw,1.3rem)] font-black uppercase text-destructive-foreground">
            <Megaphone className="size-[1vw] min-h-4 min-w-4" aria-hidden />
            Andon
          </span>
          {board && board.andons.length === 0 ? (
            <span className="px-[1vw] text-[clamp(0.7rem,1vw,1.3rem)] font-semibold text-success">
              {t("andonBoard.tickerEmpty", "Không có Andon đang mở — mọi line hoạt động bình thường")}
            </span>
          ) : (
            // W4 (doc 67): ≤ 4 andons → static wrapped list (no marquee — Ack is
            // always tappable). More → marquee with duration ∝ item count;
            // hover/focus pause kept for mouse users, pointerdown pause for touch.
            <div
              className={cn(
                "flex items-center gap-[3vw]",
                staticTicker
                  ? "flex-wrap gap-y-1 px-[1vw] py-[0.4vh]"
                  : "andon-ticker-track whitespace-nowrap pl-[2vw] hover:[animation-play-state:paused] focus-within:[animation-play-state:paused]",
              )}
              style={
                staticTicker
                  ? undefined
                  : {
                      animationDuration: `${10 + sortedAndons.length * 6}s`,
                      animationPlayState: tickerPaused ? "paused" : undefined,
                    }
              }
            >
              {sortedAndons.map((a) => {
                const raisedMs = new Date(a.raisedAt).getTime();
                const overdue = a.status === "raised" && now.getTime() - raisedMs > OVERDUE_MS;
                return (
                <span key={a.id} className="inline-flex items-center gap-2 text-[clamp(0.75rem,1.1vw,1.4rem)] font-bold">
                  <span className={cn("size-[0.8vw] min-h-3 min-w-3 rounded-full animate-pulse", severityDotClass(a.state))} />
                  <span className="uppercase text-muted-foreground">{a.lineName ?? a.machineCode ?? "—"}</span>
                  {a.machineCode && a.lineName && <span className="text-muted-foreground">· {a.machineCode}</span>}
                  <span>{a.title}</span>
                  <span className="text-muted-foreground">({agoLabel(raisedMs, now.getTime())})</span>
                  {/* W4 (doc 67) honesty: > 4h chưa ai xác nhận → nói thẳng. */}
                  {overdue && (
                    <span className="rounded bg-destructive px-1.5 py-0.5 text-[clamp(0.6rem,0.8vw,1rem)] font-black uppercase text-destructive-foreground">
                      {t("andonBoard.overdue", "QUÁ HẠN")}
                    </span>
                  )}
                  {/* doc 37 B1: page-cited manual lookup for the alarm cause/remedy. Andon events
                      carry no vendor/nativeCode → broad search keyed off the event title + reason
                      (the fallback path; mapAlarm needs vendor+nativeCode which this shape lacks). */}
                  {/* doc 68 §3.5 (P2): ẩn chrome tương tác (Tra mã) ở kiosk/TV. */}
                  {!params.kiosk && (
                    <ManualHelp
                      query={`${a.title} ${a.reason ?? ""} alarm cause remedy`.trim()}
                      buttonLabel={t("andonBoard.lookupCode", "Tra mã")}
                      size="sm"
                      variant="secondary"
                      align="end"
                      className="text-[clamp(0.6rem,0.8vw,1rem)]"
                    />
                  )}
                  {/* B6: acknowledge — pointerdown/hover pauses the ticker so this stays
                      tappable. doc 68 §3.5 (P2): hidden on the kiosk wall board (nobody
                      acks from a TV); the "Đã xác nhận" state stays informative. */}
                  {a.status === "raised" ? (
                    !params.kiosk && (
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
                    )
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[clamp(0.6rem,0.8vw,1rem)] font-semibold text-success">
                      <Check className="size-[0.9vw] min-h-3 min-w-3" aria-hidden />
                      {t("andonBoard.acked", "Đã xác nhận")}
                    </span>
                  )}
                </span>
                );
              })}
            </div>
          )}
        </div>
        {/* Marquee keyframes — scoped to this board only. Duration is overridden
            inline (10s + 6s/item) so 29 andons don't blur past in 30s.
            prefers-reduced-motion: no marquee — the SAME items become a wrapped,
            vertically scrollable list (nothing is swallowed). */}
        <style>{`
          .andon-ticker-track { animation: andon-ticker-scroll 30s linear infinite; will-change: transform; }
          @keyframes andon-ticker-scroll {
            0% { transform: translateX(100vw); }
            100% { transform: translateX(-100%); }
          }
          /* W8 (doc 67): NEW-raise border flash — 3 beats across the 2.5s the
             overlay is mounted; reduced-motion collapses to 1 static beat. */
          .andon-flash-overlay { animation: andon-flash-pulse 2.5s ease-in-out; opacity: 0; }
          @keyframes andon-flash-pulse {
            0%, 30%, 63%, 100% { opacity: 0; }
            13%, 46%, 80% { opacity: 1; }
          }
          @media (prefers-reduced-motion: reduce) {
            .andon-flash-overlay { animation: none; opacity: 0.9; }
          }
          @media (prefers-reduced-motion: reduce) {
            .andon-ticker-viewport {
              height: auto;
              min-height: clamp(2.2rem, 4.5vh, 4rem);
              max-height: 24vh;
              overflow-y: auto;
            }
            .andon-ticker-viewport .andon-ticker-track {
              animation: none;
              transform: none;
              flex-wrap: wrap;
              white-space: normal;
              row-gap: 0.25rem;
              padding: 0.3vh 1vw;
            }
          }
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
  hero = false,
}: {
  label: string;
  value: string;
  sub?: string;
  tone: "good" | "warn" | "crit" | "neutral" | "muted";
  // doc 68 §3.5 (P2): hero = "câu hỏi số 1" của bảng ("Andon đang mở") — value to
  // hơn hẳn + có khối nền/viền để neo mắt từ 5–10 m; các KPI khác là ngữ cảnh phụ.
  hero?: boolean;
}) {
  return (
    // W4 (doc 67): KPI row scales theo vh — chiều cao header là ràng buộc thật
    // trên TV; vw làm chữ bé đi khi màn rộng nhưng header thấp.
    <div
      className={cn(
        "flex min-w-0 flex-col items-center justify-center px-[0.6vw] text-center",
        hero && "rounded-lg px-[1vw]",
        hero && tone === "crit" && "bg-destructive/15 ring-2 ring-destructive/60",
        hero && tone !== "crit" && "bg-success/10 ring-1 ring-success/40",
      )}
    >
      <span className="truncate text-[clamp(0.55rem,1.4vh,0.95rem)] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span
        className={cn(
          "font-black leading-tight tabular-nums",
          hero ? "text-[clamp(1.6rem,5.2vh,4.2rem)]" : "text-[clamp(1.2rem,3.8vh,3rem)]",
          tone === "good" && "text-success",
          tone === "warn" && "text-warning",
          tone === "crit" && "text-destructive",
          tone === "muted" && "text-muted-foreground",
        )}
      >
        {value}
      </span>
      {sub && (
        <span className="truncate text-[clamp(0.55rem,1.3vh,0.9rem)] text-muted-foreground">{sub}</span>
      )}
    </div>
  );
}
