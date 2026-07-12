/**
 * FactoryCommandView — Màn hình chỉ huy TOÀN NHÀ MÁY (doc 40 Wave 4d §13.1).
 *
 * Content-first: canvas (2D/3D theo Line) chiếm ≥70% chiều cao; KPI strip gọn ở
 * trên (≤64px), rail "Vấn đề đang mở" ở phải, drawer chi tiết máy mở tại chỗ
 * (không rời trang). Mặc định 2D (D8), toggle sang 3D giữ nguyên selection.
 *
 * Dữ liệu THẬT:
 *   - trpc.factoryCommand.overview      → factories / machines / issues (nền, refetch 45s)
 *   - trpc.factoryCommand.machineDetail → tóm tắt cho drawer (khi chọn 1 máy)
 *   - socket machine:status_update      → cập nhật màu máy tức thời (không poll nặng)
 *
 * Cảnh (FactoryScene2D/3D) do agent A cung cấp qua '@/components/factory-scene'
 * (cùng props). Trang này chỉ điều phối state + layout.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import {
  Maximize2,
  Minimize2,
  Boxes,
  Square,
  AlertTriangle,
  Gauge,
  Activity,
  Wrench,
  Radio,
  WifiOff,
  ClipboardList,
  ExternalLink,
  SlidersHorizontal,
  Filter,
} from "lucide-react";

import { trpc } from "@/lib/trpc";
import { getSharedSocket } from "@/lib/socketManager";
import { severityMeta } from "@/lib/severityCanonical";
// doc 44 G5.12 — nguồn canonical DUY NHẤT map trạng thái→màu (token oklch, KHÔNG hex).
import { canonicalDotClass, canonicalBadgeClass } from "@/lib/canonicalStatusColor";
import { usePermissions } from "@/_core/hooks/usePermissions";

import DashboardLayout from "@/components/DashboardLayout";
import { navItems } from "@/lib/navigation";
import { AsyncBoundary } from "@/components/AsyncBoundary";
import { FactoryScene2D, FactoryScene3D } from "@/components/factory-scene";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

// ── Kiểu theo HỢP ĐỒNG liên-agent (doc 40 Wave 4d) ─────────────────────────
type MachineStatus = "running" | "idle" | "down" | "offline" | "maintenance";
type OverlayMode = "status" | "oee" | "ng" | "energy";
type IssueKind = "andon" | "alarm" | "pdm" | "workorder" | "offline";
type IssueSeverity = "critical" | "warning" | "info";

interface MachineNode {
  id: number;
  code: string;
  name: string;
  machineType: string;
  lineId: number | null;
  lineName: string | null;
  status: MachineStatus;
  oeePercent: number | null;
  positionX: number;
  positionY: number;
  positionZ: number;
  width: number;
  height: number;
  depth: number;
  rotation: number;
  andonActive: boolean;
  pdmRiskHigh: boolean;
}

interface CommandIssue {
  id: string;
  kind: IssueKind;
  machineId: number;
  machineCode: string;
  severity: IssueSeverity;
  label: string;
  ageMinutes: number;
  /** doc 44 W6-2 (G5.11) — impact score 0..100 (present when IMPACT_ALERT_ENABLED). */
  impact?: number;
  /** doc 44 W6-2 (G5.11) — raw issues folded into this one (dedup); 1 when none. */
  count?: number;
}

interface OverviewResponse {
  factories: { id: number; name: string; code: string }[];
  machines: MachineNode[];
  issues: CommandIssue[];
}

/**
 * Tóm tắt drawer (agent C · machineDetail). Kiểu nới lỏng + đọc phòng thủ vì hình
 * dạng chính xác do agent C chốt; ta chỉ hiển thị theo hợp đồng đã thống nhất.
 */
interface TelemetryTag {
  name: string;
  value: number | string | null;
  unit?: string | null;
}
interface MachineDetailSummary {
  id?: number;
  code?: string;
  name?: string;
  status?: MachineStatus | string;
  oeePercent?: number | null;
  recipe?: string | null;
  alarms?: { id: string | number; label: string; severity?: string }[];
  workOrders?: { id: string | number; label: string; status?: string }[];
  telemetryTags?: TelemetryTag[];
}

// ── Bảng màu trạng thái (doc 44 G5.12: dot/badge từ nguồn canonical, token oklch) ──
// ISA-101: idle/offline = trung tính (xám); running=success; down=danger;
// maintenance=info. Chỉ label giữ tại chỗ; MÀU đi qua canonicalStatusColor.
const STATUS_META: Record<MachineStatus, { labelVi: string; dot: string; badge: string }> = {
  running: { labelVi: "Đang chạy", dot: canonicalDotClass("running"), badge: canonicalBadgeClass("running") },
  idle: { labelVi: "Chờ", dot: canonicalDotClass("idle"), badge: canonicalBadgeClass("idle") },
  down: { labelVi: "Lỗi/Dừng", dot: canonicalDotClass("down"), badge: canonicalBadgeClass("down") },
  maintenance: { labelVi: "Bảo trì", dot: canonicalDotClass("maintenance"), badge: canonicalBadgeClass("maintenance") },
  offline: { labelVi: "Mất kết nối", dot: canonicalDotClass("offline"), badge: canonicalBadgeClass("offline") },
};

const SEVERITY_RANK: Record<IssueSeverity, number> = { critical: 0, warning: 1, info: 2 };

const ISSUE_ICON: Record<IssueKind, typeof AlertTriangle> = {
  andon: AlertTriangle,
  alarm: Radio,
  pdm: Activity,
  workorder: ClipboardList,
  offline: WifiOff,
};

/**
 * StatChip — thẻ KPI gọn (content-first: nhỏ, một hàng). Fallback nội bộ.
 * TODO(agent D): thay bằng <StatChip> chia sẻ khi có, giữ nguyên props (label/value/tone/icon).
 */
function StatChip({
  icon: Icon,
  label,
  value,
  tone = "default",
}: {
  icon: typeof Gauge;
  label: string;
  value: string;
  tone?: "default" | "good" | "warn" | "bad";
}) {
  // doc 44 G5.12 — dùng semantic token (success/warning/destructive), KHÔNG hex.
  const toneCls =
    tone === "good"
      ? "text-success"
      : tone === "warn"
        ? "text-warning"
        : tone === "bad"
          ? "text-destructive"
          : "text-foreground";
  return (
    <div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-1.5 min-w-[7.5rem]">
      <Icon className={cn("h-4 w-4 shrink-0", toneCls)} />
      <div className="leading-tight">
        <div className={cn("text-sm font-semibold tabular-nums", toneCls)}>{value}</div>
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      </div>
    </div>
  );
}

/** Tuổi vấn đề dạng ngắn (VN): "vừa xong" · "12ph" · "2g30ph". */
function formatAge(min: number): string {
  if (min < 1) return "vừa xong";
  if (min < 60) return `${Math.round(min)}ph`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m ? `${h}g${m}ph` : `${h}g`;
}

export default function FactoryCommandView() {
  const { t } = useTranslation();
  const [, setLocation] = useLocation();
  const { hasPermission, isAdmin } = usePermissions();
  const canControl = isAdmin || hasPermission("machine_control");

  // ── State điều khiển cảnh ──
  const [factoryId, setFactoryId] = useState<number | undefined>(undefined);
  const [is3D, setIs3D] = useState(false); // D8: 2D mặc định
  const [overlay, setOverlay] = useState<OverlayMode>("status");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [focusId, setFocusId] = useState<number | null>(null);
  const [onlyIssues, setOnlyIssues] = useState(false);

  const canvasWrapRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Trạng thái LIVE đè lên overview (socket machine:status_update).
  const [liveStatus, setLiveStatus] = useState<Record<number, MachineStatus>>({});

  // ── Dữ liệu ──
  const overviewQ = trpc.factoryCommand.overview.useQuery(
    { factoryId },
    { refetchInterval: 45_000 }, // nền: cập nhật membership + issue; realtime lo phần màu
  ) as unknown as {
    data?: OverviewResponse;
    isLoading: boolean;
    isError: boolean;
    error: unknown;
    refetch: () => void;
  };

  const detailQ = trpc.factoryCommand.machineDetail.useQuery(
    { machineId: selectedId ?? 0 },
    { enabled: selectedId != null },
  ) as unknown as {
    data?: unknown;
    isLoading: boolean;
    isError: boolean;
    error: unknown;
    refetch: () => void;
  };
  // Adapter (QA4d-1): map hình dạng THẬT của service (identity/oee/alarms/workorders
  // lồng nhau) → shape phẳng mà drawer JSX dùng. Sửa cùng lúc: crash render recipe
  // object, tiêu đề "Máy"/OEE "—" sai, không hiện WO/alarm, telemetry giả giá trị.
  const detail = useMemo<MachineDetailSummary | undefined>(() => {
    const d = detailQ.data as any;
    if (!d) return undefined;
    const rec = d.recipe;
    const recipeStr =
      typeof rec === "string"
        ? rec
        : rec?.recipeName ?? rec?.name ?? rec?.recipeCode ?? rec?.programName ?? rec?.version ?? null;
    return {
      id: d.identity?.id,
      code: d.identity?.code,
      name: d.identity?.name,
      status: d.status,
      oeePercent: d.oee?.oee ?? null,
      recipe: recipeStr,
      alarms: (d.alarms ?? []).map((a: any, i: number) => ({
        id: `${a.standardCode ?? "alarm"}-${a.ts ?? i}`,
        label: a.description || a.standardCode || "—",
        severity: a.severity,
      })),
      workOrders: (d.workorders ?? []).map((w: any) => ({
        id: w.id,
        label: w.title || w.workOrderNumber || `#${w.id}`,
        status: w.status,
      })),
      // Telemetry: service trả DESCRIPTOR (không có giá trị live) → chỉ liệt kê tín
      // hiệu khả dụng, KHÔNG bịa số; xem giá trị trực tiếp qua nút "Mở cockpit".
      telemetryTags: (d.telemetryTags ?? []).map((tg: any) => ({
        name: tg.label ?? tg.key ?? "—",
        value: null,
        unit: tg.unit ?? null,
      })),
    };
  }, [detailQ.data]);

  // ── Realtime: machine:status_update → chỉ đổi màu, KHÔNG refetch ──
  useEffect(() => {
    const socket = getSharedSocket();
    const onStatus = (data: { machineId: number; status: string }) => {
      if (data?.machineId == null) return;
      setLiveStatus((prev) => ({ ...prev, [data.machineId]: data.status as MachineStatus }));
    };
    socket.on("machine:status_update", onStatus);
    socket.emit("subscribe", {}); // vào room chung để nhận feed
    return () => {
      socket.off("machine:status_update", onStatus);
    };
  }, []);

  // ── Đồng bộ trạng thái fullscreen ──
  useEffect(() => {
    const onFsChange = () => setIsFullscreen(document.fullscreenElement != null);
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  const toggleFullscreen = () => {
    const el = canvasWrapRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.();
  };

  const factories = overviewQ.data?.factories ?? [];
  const rawMachines = overviewQ.data?.machines ?? [];
  const issues = overviewQ.data?.issues ?? [];

  // Máy sau khi đè trạng thái LIVE.
  const machines: MachineNode[] = useMemo(
    () =>
      rawMachines.map((m) =>
        liveStatus[m.id] ? { ...m, status: liveStatus[m.id] } : m,
      ),
    [rawMachines, liveStatus],
  );

  // Tập machineId đang có vấn đề (để lọc "chỉ máy có vấn đề").
  const issueMachineIds = useMemo(() => new Set(issues.map((i) => i.machineId)), [issues]);
  const sceneMachines = useMemo(
    () => (onlyIssues ? machines.filter((m) => issueMachineIds.has(m.id)) : machines),
    [machines, onlyIssues, issueMachineIds],
  );

  // Issue đã sắp xếp. doc 44 W6-2 (G5.11): khi server trả impact (cờ ON) → tôn
  // trọng thứ tự theo TÁC ĐỘNG (impact ↓, tuổi ↓); ngược lại giữ sort cũ
  // severity ↑ → tuổi ↓ (nặng + lâu lên đầu).
  const sortedIssues = useMemo(() => {
    const hasImpact = issues.some((i) => i.impact != null);
    return [...issues].sort((a, b) => {
      if (hasImpact) {
        const im = (b.impact ?? 0) - (a.impact ?? 0);
        if (im !== 0) return im;
        return b.ageMinutes - a.ageMinutes;
      }
      const s = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
      return s !== 0 ? s : b.ageMinutes - a.ageMinutes;
    });
  }, [issues]);

  // ── KPI (dữ liệu thật từ overview) ──
  const kpi = useMemo(() => {
    const running = machines.filter((m) => m.status === "running").length;
    const idle = machines.filter((m) => m.status === "idle").length;
    const down = machines.filter((m) => m.status === "down").length;
    const oeeVals = machines.map((m) => m.oeePercent).filter((v): v is number => v != null);
    const oee = oeeVals.length ? Math.round(oeeVals.reduce((a, b) => a + b, 0) / oeeVals.length) : null;
    return { running, idle, down, oee, openIssues: issues.length };
  }, [machines, issues]);

  const selectMachine = (id: number) => {
    setSelectedId(id);
    setFocusId(id); // camera bay tới
  };

  const activeFactoryValue = factoryId != null ? String(factoryId) : "all";

  const SceneComponent = is3D ? FactoryScene3D : FactoryScene2D;

  return (
    <DashboardLayout
      title={t("factoryCommand.title", "Chỉ huy nhà máy")}
      navItems={navItems}
      currentPath="/factory-command"
    >
      <div className="flex flex-col gap-3 h-[calc(100vh-8rem)] min-h-[560px]">
        {/* ── KPI strip (content-first: gọn ≤64px) ── */}
        <div className="flex items-center gap-2 overflow-x-auto pb-0.5 shrink-0">
          <StatChip
            icon={Gauge}
            label={t("factoryCommand.kpiOee", "OEE nhà máy")}
            value={kpi.oee != null ? `${kpi.oee}%` : "—"}
            tone={kpi.oee == null ? "default" : kpi.oee >= 80 ? "good" : kpi.oee >= 60 ? "warn" : "bad"}
          />
          <StatChip icon={Activity} label={t("factoryCommand.kpiRunning", "Đang chạy")} value={String(kpi.running)} tone="good" />
          <StatChip icon={Square} label={t("factoryCommand.kpiIdle", "Chờ")} value={String(kpi.idle)} tone={kpi.idle ? "warn" : "default"} />
          <StatChip icon={AlertTriangle} label={t("factoryCommand.kpiDown", "Lỗi/Dừng")} value={String(kpi.down)} tone={kpi.down ? "bad" : "default"} />
          {/* NG ca: overview chưa cấp số NG → hiển thị "—" trung thực. TODO(agent C): thêm ngCount vào overview. */}
          <StatChip icon={AlertTriangle} label={t("factoryCommand.kpiNg", "NG ca")} value="—" />
          <StatChip icon={Wrench} label={t("factoryCommand.kpiIssues", "Vấn đề mở")} value={String(kpi.openIssues)} tone={kpi.openIssues ? "warn" : "default"} />

          <div className="ml-auto flex items-center gap-2">
            {/* Chọn nhà máy (khi >1) */}
            {factories.length > 1 && (
              <Select
                value={activeFactoryValue}
                onValueChange={(v) => setFactoryId(v === "all" ? undefined : Number(v))}
              >
                <SelectTrigger className="h-8 w-[10rem]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("factoryCommand.allFactories", "Tất cả nhà máy")}</SelectItem>
                  {factories.map((f) => (
                    <SelectItem key={f.id} value={String(f.id)}>
                      {f.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </div>

        {/* ── Thân: canvas (≥70%) + rail phải ── */}
        <div className="flex flex-1 gap-3 min-h-0">
          {/* CANVAS */}
          <div
            ref={canvasWrapRef}
            className="relative flex-1 min-w-0 rounded-xl border bg-muted/20 overflow-hidden"
          >
            {/* Thanh công cụ overlay trên canvas */}
            <div className="absolute left-3 top-3 z-10 flex items-center gap-2">
              {/* 2D ⇄ 3D — giữ nguyên selection (state ở parent) */}
              <div className="flex items-center rounded-lg border bg-card/90 backdrop-blur p-0.5">
                <Button
                  type="button"
                  size="sm"
                  variant={is3D ? "ghost" : "secondary"}
                  className="h-7 gap-1 px-2"
                  onClick={() => setIs3D(false)}
                  aria-pressed={!is3D}
                >
                  <Square className="h-3.5 w-3.5" />
                  2D
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={is3D ? "secondary" : "ghost"}
                  className="h-7 gap-1 px-2"
                  onClick={() => setIs3D(true)}
                  aria-pressed={is3D}
                >
                  <Boxes className="h-3.5 w-3.5" />
                  3D
                </Button>
              </div>

              {/* Lớp phủ dữ liệu */}
              <Select value={overlay} onValueChange={(v) => setOverlay(v as OverlayMode)}>
                <SelectTrigger className="h-8 w-[9rem] bg-card/90 backdrop-blur">
                  <SlidersHorizontal className="h-3.5 w-3.5 mr-1 text-muted-foreground" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="status">{t("factoryCommand.overlayStatus", "Trạng thái")}</SelectItem>
                  <SelectItem value="oee">{t("factoryCommand.overlayOee", "OEE")}</SelectItem>
                  <SelectItem value="ng">{t("factoryCommand.overlayNg", "Tỉ lệ NG")}</SelectItem>
                  <SelectItem value="energy">{t("factoryCommand.overlayEnergy", "Năng lượng")}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Fullscreen / chế độ TV */}
            <div className="absolute right-3 top-3 z-10">
              <Button
                type="button"
                size="icon"
                variant="secondary"
                className="h-8 w-8 bg-card/90 backdrop-blur"
                onClick={toggleFullscreen}
                aria-label={t("factoryCommand.fullscreen", "Toàn màn hình (TV)")}
                title={t("factoryCommand.fullscreen", "Toàn màn hình (TV)")}
              >
                {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
              </Button>
            </div>

            {/* Cảnh (honest loading/empty/error) */}
            <AsyncBoundary
              isLoading={overviewQ.isLoading}
              isError={overviewQ.isError}
              error={overviewQ.error}
              isEmpty={sceneMachines.length === 0}
              onRetry={overviewQ.refetch}
              preset="none"
              className="absolute inset-0"
              errorTitle={t("factoryCommand.loadError", "Không tải được sơ đồ nhà máy")}
              emptyState={
                <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-muted-foreground">
                  <Boxes className="h-10 w-10 opacity-40" />
                  <p className="text-sm">
                    {onlyIssues
                      ? t("factoryCommand.emptyNoIssues", "Không có máy nào đang gặp vấn đề.")
                      : t("factoryCommand.emptyNoMachines", "Chưa có máy nào được đặt vị trí trên sơ đồ.")}
                  </p>
                  {onlyIssues && (
                    <Button size="sm" variant="outline" onClick={() => setOnlyIssues(false)}>
                      {t("factoryCommand.showAll", "Hiện tất cả máy")}
                    </Button>
                  )}
                </div>
              }
            >
              <SceneComponent
                machines={sceneMachines}
                selectedId={selectedId}
                onSelect={selectMachine}
                overlay={overlay}
                focusId={focusId}
              />
            </AsyncBoundary>
          </div>

          {/* RAIL PHẢI — Vấn đề đang mở */}
          <aside className="hidden lg:flex w-80 shrink-0 flex-col rounded-xl border bg-card">
            <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-warning" />
                <h2 className="text-sm font-semibold">
                  {t("factoryCommand.openIssues", "Vấn đề đang mở")}
                </h2>
                <Badge variant="secondary" className="tabular-nums">
                  {sortedIssues.length}
                </Badge>
              </div>
              <Button
                type="button"
                size="sm"
                variant={onlyIssues ? "secondary" : "ghost"}
                className="h-7 gap-1 px-2 text-xs"
                onClick={() => setOnlyIssues((v) => !v)}
                aria-pressed={onlyIssues}
                title={t("factoryCommand.onlyIssues", "Chỉ máy có vấn đề")}
              >
                <Filter className="h-3.5 w-3.5" />
                {t("factoryCommand.onlyIssuesShort", "Lọc")}
              </Button>
            </div>

            <ScrollArea className="flex-1">
              <AsyncBoundary
                isLoading={overviewQ.isLoading}
                isError={overviewQ.isError}
                error={overviewQ.error}
                isEmpty={sortedIssues.length === 0}
                onRetry={overviewQ.refetch}
                preset="list"
                className="p-2"
                errorTitle={t("factoryCommand.issuesError", "Không tải được danh sách vấn đề")}
                emptyState={
                  <div className="flex flex-col items-center justify-center gap-2 py-10 text-center text-muted-foreground">
                    <Activity className="h-8 w-8 opacity-40" />
                    <p className="text-sm">{t("factoryCommand.noIssues", "Không có vấn đề nào đang mở. Nhà máy ổn định.")}</p>
                  </div>
                }
              >
                <ul className="flex flex-col gap-1.5 p-1">
                  {sortedIssues.map((iss) => {
                    const Icon = ISSUE_ICON[iss.kind];
                    // doc 44 G5.15 — màu viền theo 1 thang severity canonical.
                    const sevCls = severityMeta(iss.severity).borderLeft;
                    return (
                      <li key={iss.id}>
                        <button
                          type="button"
                          onClick={() => selectMachine(iss.machineId)}
                          className={cn(
                            "w-full rounded-md border border-l-2 bg-background px-2.5 py-2 text-left transition-colors hover:bg-accent",
                            sevCls,
                            selectedId === iss.machineId && "ring-1 ring-primary",
                          )}
                        >
                          <div className="flex items-center gap-2">
                            <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            <span className="font-mono text-xs text-muted-foreground">{iss.machineCode}</span>
                            {/* doc 44 G5.11 — dedup: N cảnh báo cùng máy+loại → 1 dòng + số đếm. */}
                            {iss.count != null && iss.count > 1 && (
                              <Badge variant="secondary" className="h-4 px-1 text-[10px] tabular-nums" title={t("factoryCommand.mergedCount", "Đã gộp {{count}} cảnh báo cùng loại", { count: iss.count })}>
                                ×{iss.count}
                              </Badge>
                            )}
                            <span className="ml-auto flex items-center gap-1.5">
                              {/* doc 44 G5.11 — điểm tác động (khi cờ impact bật). */}
                              {iss.impact != null && (
                                <span
                                  className="text-[10px] font-semibold tabular-nums text-muted-foreground"
                                  title={t("factoryCommand.impactScore", "Điểm tác động (0–100)")}
                                >
                                  {t("factoryCommand.impactLabel", "TĐ")} {iss.impact}
                                </span>
                              )}
                              <span className="text-[10px] text-muted-foreground tabular-nums">
                                {formatAge(iss.ageMinutes)}
                              </span>
                            </span>
                          </div>
                          <div className="mt-0.5 line-clamp-2 text-sm">{iss.label}</div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </AsyncBoundary>
            </ScrollArea>
          </aside>
        </div>
      </div>

      {/* ── DRAWER chi tiết máy (mở tại chỗ, không rời trang) ── */}
      <Sheet open={selectedId != null} onOpenChange={(o) => !o && setSelectedId(null)}>
        <SheetContent side="right" className="w-full sm:max-w-md flex flex-col p-0">
          <SheetHeader className="border-b px-4 py-3">
            <SheetTitle className="flex items-center gap-2">
              {detail?.name ?? t("factoryCommand.machine", "Máy")}
              {detail?.code && (
                <span className="font-mono text-xs text-muted-foreground">{detail.code}</span>
              )}
            </SheetTitle>
            <SheetDescription className="sr-only">
              {t("factoryCommand.drawerDesc", "Chi tiết máy: hiện trạng, telemetry, vấn đề và hành động.")}
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto p-4">
            <AsyncBoundary
              isLoading={detailQ.isLoading}
              isError={detailQ.isError}
              error={detailQ.error}
              onRetry={detailQ.refetch}
              preset="list"
              errorTitle={t("factoryCommand.detailError", "Không tải được chi tiết máy")}
            >
              <Tabs defaultValue="status" className="w-full">
                <TabsList className="grid w-full grid-cols-4">
                  <TabsTrigger value="status">{t("factoryCommand.tabStatus", "Hiện trạng")}</TabsTrigger>
                  <TabsTrigger value="telemetry">{t("factoryCommand.tabTelemetry", "Telemetry")}</TabsTrigger>
                  <TabsTrigger value="issues">{t("factoryCommand.tabIssues", "Vấn đề")}</TabsTrigger>
                  <TabsTrigger value="actions">{t("factoryCommand.tabActions", "Hành động")}</TabsTrigger>
                </TabsList>

                {/* Hiện trạng */}
                <TabsContent value="status" className="mt-3 space-y-3">
                  <div className="flex items-center justify-between rounded-lg border p-3">
                    <span className="text-sm text-muted-foreground">{t("factoryCommand.status", "Trạng thái")}</span>
                    {(() => {
                      const st = (detail?.status as MachineStatus) ?? "offline";
                      const meta = STATUS_META[st] ?? STATUS_META.offline;
                      return (
                        <span className="flex items-center gap-2">
                          <span className={cn("h-2.5 w-2.5 rounded-full", meta.dot)} />
                          <Badge variant="outline" className={meta.badge}>{meta.labelVi}</Badge>
                        </span>
                      );
                    })()}
                  </div>
                  <div className="flex items-center justify-between rounded-lg border p-3">
                    <span className="text-sm text-muted-foreground">OEE</span>
                    <span className="font-semibold tabular-nums">
                      {detail?.oeePercent != null ? `${Math.round(detail.oeePercent)}%` : "—"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between rounded-lg border p-3">
                    <span className="text-sm text-muted-foreground">{t("factoryCommand.recipe", "Recipe/Chương trình")}</span>
                    <span className="text-sm">{detail?.recipe || "—"}</span>
                  </div>
                  {detail?.alarms && detail.alarms.length > 0 && (
                    <div className="rounded-lg border p-3">
                      <div className="mb-2 text-sm text-muted-foreground">{t("factoryCommand.alarms", "Cảnh báo")}</div>
                      <ul className="space-y-1">
                        {detail.alarms.map((a) => (
                          <li key={a.id} className="flex items-center gap-2 text-sm">
                            <Radio className="h-3.5 w-3.5 text-destructive" />
                            {a.label}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {detail?.workOrders && detail.workOrders.length > 0 && (
                    <div className="rounded-lg border p-3">
                      <div className="mb-2 text-sm text-muted-foreground">{t("factoryCommand.workOrders", "Lệnh công việc")}</div>
                      <ul className="space-y-1">
                        {detail.workOrders.map((w) => (
                          <li key={w.id} className="flex items-center gap-2 text-sm">
                            <ClipboardList className="h-3.5 w-3.5 text-muted-foreground" />
                            {w.label}
                            {w.status && <Badge variant="secondary" className="ml-auto text-[10px]">{w.status}</Badge>}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </TabsContent>

                {/* Telemetry — liệt kê TÍN HIỆU khả dụng (descriptor), KHÔNG hiển thị
                    giá trị giả; giá trị trực tiếp xem ở cockpit. */}
                <TabsContent value="telemetry" className="mt-3 space-y-3">
                  {detail?.telemetryTags && detail.telemetryTags.length > 0 ? (
                    <>
                      <p className="text-xs text-muted-foreground">
                        {t("factoryCommand.telemetryHint", "Tín hiệu khả dụng của máy — mở cockpit để xem giá trị trực tiếp.")}
                      </p>
                      <ul className="divide-y rounded-lg border">
                        {detail.telemetryTags.map((tag) => (
                          <li key={tag.name} className="flex items-center justify-between px-3 py-2 text-sm">
                            <span>{tag.name}</span>
                            {tag.unit && <span className="font-mono text-xs text-muted-foreground">{tag.unit}</span>}
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : (
                    <p className="py-6 text-center text-sm text-muted-foreground">
                      {t("factoryCommand.noTelemetry", "Chưa có tín hiệu telemetry.")}
                    </p>
                  )}
                  {selectedId != null && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full gap-2"
                      onClick={() => setLocation(`/machine/${selectedId}`)}
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      {t("factoryCommand.viewTelemetry", "Xem telemetry chi tiết")}
                    </Button>
                  )}
                </TabsContent>

                {/* Vấn đề của riêng máy này */}
                <TabsContent value="issues" className="mt-3 space-y-2">
                  {(() => {
                    const own = sortedIssues.filter((i) => i.machineId === selectedId);
                    if (own.length === 0)
                      return (
                        <p className="py-6 text-center text-sm text-muted-foreground">
                          {t("factoryCommand.noMachineIssues", "Máy này không có vấn đề nào đang mở.")}
                        </p>
                      );
                    return own.map((iss) => {
                      const Icon = ISSUE_ICON[iss.kind];
                      return (
                        <div key={iss.id} className="flex items-start gap-2 rounded-lg border p-3">
                          <Icon className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                          <div className="min-w-0">
                            <div className="text-sm">{iss.label}</div>
                            <div className="text-[11px] text-muted-foreground">
                              {iss.severity} · {formatAge(iss.ageMinutes)}
                            </div>
                          </div>
                        </div>
                      );
                    });
                  })()}
                </TabsContent>

                {/* Hành động */}
                <TabsContent value="actions" className="mt-3 space-y-2">
                  <Button
                    className="w-full justify-start gap-2"
                    variant="secondary"
                    onClick={() => selectedId != null && setLocation(`/machine/${selectedId}`)}
                  >
                    <ExternalLink className="h-4 w-4" />
                    {t("factoryCommand.openCockpit", "Mở cockpit máy")}
                  </Button>
                  {/* Gọi bảo trì: điều hướng sang work-orders (không bịa mutation) */}
                  <Button
                    className="w-full justify-start gap-2"
                    variant="outline"
                    onClick={() => setLocation(`/work-orders?machineId=${selectedId ?? ""}`)}
                  >
                    <Wrench className="h-4 w-4" />
                    {t("factoryCommand.callMaintenance", "Tạo/xem lệnh bảo trì")}
                  </Button>
                  {/* Điều khiển: chỉ hiện khi có quyền machine_control (RBAC) */}
                  {canControl && (
                    <Button
                      className="w-full justify-start gap-2"
                      variant="outline"
                      onClick={() => setLocation("/command-console")}
                    >
                      <SlidersHorizontal className="h-4 w-4" />
                      {t("factoryCommand.control", "Điều khiển (Command Console)")}
                    </Button>
                  )}
                </TabsContent>
              </Tabs>
            </AsyncBoundary>
          </div>
        </SheetContent>
      </Sheet>
    </DashboardLayout>
  );
}
