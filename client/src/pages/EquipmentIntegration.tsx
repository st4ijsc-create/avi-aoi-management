/**
 * I1 (doc 16 §6 / §15) — EQUIPMENT INTEGRATION surface (Khối 1B).
 *
 * Read-mostly cockpit over the equipmentIntegrationRouter:
 *   • Connector catalog (I1-a) — the FOCAS/Euromap integration FRAMEWORKS (honest status: a framework with
 *       no connected device says so; the Unified Equipment Model snapshot shows "—" when source:'none') and
 *       the adapter protocols REGISTERED in the server registry (registration ≠ a connected device).
 *   • Recipe versions (I1-b) — pick a recipe code → versions (VersionHistoryPanel). Actions create / release /
 *       archive / rollback (rollback confirms via AlertDialog) + record-load. All gated (machine_control +
 *       flag).
 *   • Load history (I1-b) — append-only genealogy by machine OR by recipe code.
 *   • Acquisition workers (W8-C) — visionAdapter worker status / start / stop.
 *
 * SAFETY / HONESTY (mirrors the router): FOCAS/Euromap are READ-ONLY frameworks — no real device is attached
 * and no telemetry is fabricated; the UI never invents values. Recipe mutations are METADATA/genealogy only —
 * they open NO device-control path. Mutations are gated behind EQ_INTEG_ENABLED; when the flag is OFF the page
 * shows a calm preview notice and surfaces the CONFLICT error gracefully (toast.info, not red). Read RBAC:
 * machine_monitoring/canView. Actions: machine_control/canCreate (hidden when absent); release/rollback:
 * machine_control/canEdit (doc 80 Task 3).
 *
 * Doc 81 Đợt 2 Task 7 — bố cục P4 Cockpit (doc 81 §1.2 dòng Integration, FE1 §2.14, FE2 §3/§5):
 *  - Header một hàng (`CockpitLayout` → `PageHeaderCompact`): h1 (+ "Chỉ xem") · chip trạng thái cờ (đủ 4 nhánh
 *    của FeatureStatusGate) · chip "Khi nào dùng" (câu khi-nào-dùng + phụ đề cũ) · chip "Chỉ đọc" (lưu ý an toàn
 *    cũ trong popover) · `StatusChipStrip` thay 4 MetricCard, NHÃN ĐÚNG NGHĨA: "Adapter đăng ký" (đếm
 *    registry — đăng ký, KHÔNG phải kết nối) · "Framework đã kết nối" x/y (framework có thiết bị thật, `configured`,
 *    trên tổng số framework — thẻ "Framework" cũ gộp vào mẫu số) · "Cờ". Mỗi chip mang nguồn và trạng thái loading/lỗi riêng (không in 0 khi lỗi).
 *  - MAIN (`data-layout-main`) = hàng tab (`?tab=` status|recipes|history|acquisition — giữ giá trị cũ; thanh công
 *    cụ DUY NHẤT trong MAIN, bộ lọc/hành động của từng tab nằm cùng hàng) + nội dung tab:
 *      · status: catalog connector danh sách–chi tiết (`SplitListDetail`, `?connector=`).
 *      · recipes: `?code=` → `VersionHistoryPanel` (so sánh payload hai phiên bản) + hành động mỗi hàng như cũ.
 *        Rollback = `RollbackConfirm requireReason={false} requireOtp={false}` (hợp đồng cũ — R-2-g). Tạo phiên bản /
 *        ghi nhận nạp = sheet (`?flyout=eq-recipe-new`, `?flyout=eq-recipe-load&flyoutId=<id>`).
 *      · history: bảng phả hệ như cũ.
 *      · acquisition: panel worker `keepMounted` — mount LẦN ĐẦU khi mở tab, sau đó KHÔNG unmount khi đổi tab
 *        (Review Focus 3); khởi động worker = sheet `?flyout=acq-start`; dừng = một cú bấm như cũ.
 *  - doc 81 §1.2 muốn "phiên bản recipe/lịch sử nạp → Recipes" và "worker thu ảnh → Vision". Dời đi cần route/IA
 *    mới (Recipes đọc router `machineRecipe`, không có phả hệ nạp; chưa có màn Vision nào chứa worker) ⇒ GIỮ ở đây,
 *    tab recipes/history có liên kết "Mở trong Recipes" (`/recipes?code=` / `?machineId=`).
 *  - Không thủ tục, input, cổng hay thông điệp lỗi nào đổi; mỗi lần xác nhận vẫn đúng MỘT lượt gọi như cũ (R-2-n).
 */
import { createContext, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation, useSearch } from "wouter";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import { trpc } from "@/lib/trpc";
import { usePermissions } from "@/_core/hooks/usePermissions";
import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { ViewOnlyBadge } from "@/components/PermissionGate";
import {
  CockpitLayout,
  EmptyState,
  FeatureStatusNoticeChip,
  FlyoutHost,
  NoticeChip,
  NoticeStack,
  PageContainer,
  RollbackConfirm,
  SplitListDetail,
  StatusBadge,
  StatusChipStrip,
  Text,
  VersionHistoryPanel,
  chipStateFromQuery,
  useFlyout,
  useNarrowViewport,
  useFlyoutLayer,
  type FlyoutDefinition,
  type StatusChipItem,
  type VersionRow,
} from "@/components/patterns";
import { type TabbedHubTab } from "@/components/workspace/TabbedHub";
import { resolveActiveTab } from "@/components/workspace/hubState";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Plug, RefreshCw, Lock, AlertTriangle, Plus, FlaskConical,
  History, Network, CheckCircle2, Send, Rocket, Archive, Undo2, Download,
  CircleSlash, Camera, Play, Square, Loader2, ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import { mapTrpcError, toastTrpcError } from "@/lib/trpcErrors";
import { isFeatureDisabledError } from "@/lib/featureFlagError";
import {
  deriveFeatureStatus,
  featureStatusLabel,
  featureStatusTone,
  isFeatureStatusUnsettled,
  type FeatureStatus,
} from "@/components/common/FeatureStatusGate";

// ── Typesafe shapes inferred from the equipmentIntegrationRouter output ───────
type RouterOutputs = inferRouterOutputs<AppRouter>;
type IntegrationStatus = RouterOutputs["equipmentIntegration"]["integrationStatus"];
type FrameworkEntry = IntegrationStatus["frameworks"][number];
type AdapterEntry = IntegrationStatus["adapters"][number];
type FrameworkSnapshot = RouterOutputs["equipmentIntegration"]["frameworkSnapshot"];
type RecipeVersionList = RouterOutputs["equipmentIntegration"]["listRecipeVersions"];
type RecipeVersion = RecipeVersionList["versions"][number];
type LoadLogRow = RouterOutputs["equipmentIntegration"]["listLoadHistory"][number];
type MachineRow = RouterOutputs["machine"]["list"][number];

type FrameworkKind = "focas" | "euromap";
type HistoryMode = "machine" | "code";
type CreateVersionInput = { code: string; name: string; payload: Record<string, unknown>; machineId?: number; notes?: string };
type RecordLoadInput = { recipeId: number; machineId: number; deploy: boolean; notes?: string };
type StartWorkerInput = {
  id: string;
  source: { kind: "file"; directory?: string; loop?: boolean } | { kind: "mock"; width?: number; height?: number; maxFrames?: number };
  machineCode?: string;
  intervalMs?: number;
  maxFrames?: number;
  submit?: boolean;
  assessQuality?: boolean;
};

const TAB_VALUES = ["status", "recipes", "history", "acquisition"] as const;
type TabValue = (typeof TAB_VALUES)[number];
const BASE_PATH = "/equipment-integration";

function pctOrDash(n: number | null): string {
  return n == null ? "—" : `${Math.round(n * 100)}%`;
}
function numOrDash(n: number | null): string {
  return n == null ? "—" : String(n);
}
function strOrDash(s: string | null): string {
  return s == null || s === "" ? "—" : s;
}

/** Đọc/ghi một tham số URL của trang (replace — không thêm mục lịch sử), giữ mọi tham số khác. */
function useUrlParam(name: string): [string | null, (value: string | null) => void] {
  const search = useSearch();
  const [location, setLocation] = useLocation();
  const value = useMemo(() => new URLSearchParams(search).get(name), [search, name]);
  const set = (v: string | null) => {
    const p = new URLSearchParams(window.location.search);
    if (v == null || v === "") p.delete(name);
    else p.set(name, v);
    const qs = p.toString();
    setLocation(qs ? `${location}?${qs}` : location, { replace: true });
  };
  return [value, set];
}

// ── Dữ liệu dùng chung cho các tab (TabbedHub: Content là ComponentType không nhận props) ──────
interface EqPageCtx {
  tab: TabValue;
  /** <1024 px: công cụ của tab nằm ĐẦU nội dung tab (hàng tab không đủ chỗ) — GC10. */
  narrow: boolean;
  canView: boolean;
  canControl: boolean;
  canRelease: boolean;
  canViewAcq: boolean;
  canControlAcq: boolean;
  userId: number | null;
  flagUnsettled: boolean;
  integration: IntegrationStatus | undefined;
  integrationLoading: boolean;
  integrationError: boolean;
  connector: string | null;
  setConnector: (v: string | null) => void;
  machines: MachineRow[];
  machineName: Map<number, string>;
  // recipes
  recipeCode: string;
  setRecipeCode: (v: string) => void;
  activeCode: string | null;
  runVersionLookup: () => void;
  versions: RecipeVersion[];
  versionsLoading: boolean;
  versionsError: boolean;
  release: (v: RecipeVersion) => void;
  archive: (v: RecipeVersion) => void;
  rollback: (v: RecipeVersion) => void;
  releasePending: boolean;
  archivePending: boolean;
  rollbackPending: boolean;
  recordLoadPending: boolean;
  // history
  historyMode: HistoryMode;
  setHistoryMode: (m: HistoryMode) => void;
  historyMachineId: number | null;
  setHistoryMachineId: (id: number | null) => void;
  historyCode: string;
  setHistoryCode: (v: string) => void;
  activeHistoryCode: string | null;
  runHistoryCodeLookup: () => void;
  historyRows: LoadLogRow[];
  historyFetching: boolean;
  // acquisition
  acqLive: boolean | undefined;
  setAcqLive: (v: boolean | undefined) => void;
  refreshAcq: () => void;
}
const EqCtx = createContext<EqPageCtx | null>(null);
function useEqCtx(): EqPageCtx {
  const v = useContext(EqCtx);
  if (!v) throw new Error("EqCtx missing");
  return v;
}

const TABS: readonly TabbedHubTab[] = [
  { value: "status", labelKey: "eqIntegration.tab.status", fallback: "Connector catalog", icon: <Network className="h-4 w-4" />, Content: CatalogTab },
  { value: "recipes", labelKey: "eqIntegration.tab.recipes", fallback: "Recipe versions", icon: <FlaskConical className="h-4 w-4" />, Content: RecipesTab },
  { value: "history", labelKey: "eqIntegration.tab.history", fallback: "Load history", icon: <History className="h-4 w-4" />, Content: HistoryTab },
  // W8-C (doc 27 V14 — W7-E's noted UI slot): acquisition worker status/start/stop. keepMounted: Review Focus 3.
  { value: "acquisition", labelKey: "eqIntegration.tab.acquisition", fallback: "Acquisition workers", icon: <Camera className="h-4 w-4" />, Content: AcquisitionTab, keepMounted: true },
];

export default function EquipmentIntegration() {
  const { t } = useTranslation();
  const { hasPermission } = usePermissions();
  const { user } = useAuth();
  const canView = hasPermission("machine_monitoring", "canView");
  const canControl = hasPermission("machine_control", "canCreate");
  // doc 80 Task 3 (FLOW-01/INT-02) — release/rollback now require the SAME server gate as
  // /recipes: machine_control/canEdit (+ actuationProcedure role-floor + 2FA), not the bare
  // canCreate used for create/archive/record-load. A canCreate-only user must NOT see an
  // enabled Release/Rollback button that the server will now reject.
  const canRelease = hasPermission("machine_control", "canEdit");
  // W8-C — RBAC mirrors the visionAdapter router: machine_alerts/canView to read, canCreate to start/stop.
  const canViewAcq = hasPermission("machine_alerts", "canView");
  const canControlAcq = hasPermission("machine_alerts", "canCreate");

  const search = useSearch();
  const tab = resolveActiveTab(search, TAB_VALUES, "status") as TabValue;
  const narrow = useNarrowViewport();
  const [connector, setConnector] = useUrlParam("connector");
  // Recipe-versions: mã đang xem nằm ở `?code=` (F5 / deep link giữ được).
  const [activeCode, setActiveCode] = useUrlParam("code");
  const [recipeCode, setRecipeCode] = useState(() => activeCode ?? "");

  // Load-history tab state
  const [historyMode, setHistoryMode] = useState<HistoryMode>("machine");
  const [historyMachineId, setHistoryMachineId] = useState<number | null>(null);
  const [historyCode, setHistoryCode] = useState("");
  const [activeHistoryCode, setActiveHistoryCode] = useState<string | null>(null);

  // Acquisition: panel báo cờ thu ảnh trực tiếp lên hàng công cụ.
  const [acqLive, setAcqLive] = useState<boolean | undefined>(undefined);

  const utils = trpc.useUtils();

  // ── Reads (RBAC: machine_monitoring/canView) ────────────────────────────────
  const statusQ = trpc.equipmentIntegration.status.useQuery(undefined, { enabled: canView });
  const integrationQ = trpc.equipmentIntegration.integrationStatus.useQuery(undefined, { enabled: canView });
  const machinesQ = trpc.machine.list.useQuery(undefined, { enabled: canView });

  const versionsQ = trpc.equipmentIntegration.listRecipeVersions.useQuery(
    { code: activeCode ?? "" },
    { enabled: canView && !!activeCode, retry: false },
  );
  const loadHistoryQ = trpc.equipmentIntegration.listLoadHistory.useQuery(
    { machineId: historyMachineId ?? 0, limit: 200 },
    { enabled: canView && historyMode === "machine" && !!historyMachineId, retry: false },
  );
  const codeHistoryQ = trpc.equipmentIntegration.listCodeHistory.useQuery(
    { code: activeHistoryCode ?? "", limit: 200 },
    { enabled: canView && historyMode === "code" && !!activeHistoryCode, retry: false },
  );

  const integration = integrationQ.data as IntegrationStatus | undefined;
  const machines = (machinesQ.data ?? []) as MachineRow[];
  const versions = (versionsQ.data?.versions ?? []) as RecipeVersion[];
  const historyRows = ((historyMode === "machine" ? loadHistoryQ.data : codeHistoryQ.data) ?? []) as LoadLogRow[];

  // Doc 80 Task 1 (PLT-02/G-07/X-07): pending/erroring status query is UNKNOWN, not "on".
  const flagStatus = deriveFeatureStatus(statusQ, (d: { enabled?: boolean }) => d.enabled);
  const flagUnsettled = isFeatureStatusUnsettled(flagStatus);

  const machineName = useMemo(() => {
    const m = new Map<number, string>();
    for (const mc of machines) m.set(mc.id, mc.name ?? mc.code ?? String(mc.id));
    return m;
  }, [machines]);

  const configuredCount = useMemo(
    () => (integration?.frameworks ?? []).filter((f) => f.configured).length,
    [integration],
  );

  const refetchAll = () => {
    void utils.equipmentIntegration.status.invalidate();
    void utils.equipmentIntegration.integrationStatus.invalidate();
    void utils.equipmentIntegration.listRecipeVersions.invalidate();
    void utils.equipmentIntegration.listLoadHistory.invalidate();
    void utils.equipmentIntegration.listCodeHistory.invalidate();
  };
  const refreshAcq = () => void utils.visionAdapter.acquisitionWorkerStatus.invalidate();

  // Surface the FLAG-OFF CONFLICT gracefully (info, not a scary red error).
  const onMutationError = (e: { data?: { code?: string } | null; message: string }) => {
    if (isFeatureDisabledError(e)) {
      toast.info(t("eqIntegration.flagOffToast", "Equipment integration is disabled (preview). Set EQ_INTEG_ENABLED=true to act."));
      void utils.equipmentIntegration.status.invalidate();
    } else {
      toast.error(mapTrpcError(e));
    }
  };

  // ── Mutations (RBAC: machine_control/canCreate + EQ_INTEG_ENABLED) ───────────
  // Toast + invalidate ở hook TRANG (chạy cả khi sheet đã đóng trong lúc chờ); sheet tự đóng qua callback lượt gọi.
  const createM = trpc.equipmentIntegration.createRecipeVersion.useMutation({
    onSuccess: () => { toast.success(t("eqIntegration.versionCreated", "Recipe version created (draft)")); refetchAll(); },
    onError: onMutationError,
  });
  const releaseM = trpc.equipmentIntegration.releaseRecipeVersion.useMutation({
    onSuccess: () => { toast.success(t("eqIntegration.versionReleased", "Version released")); refetchAll(); },
    onError: onMutationError,
  });
  const archiveM = trpc.equipmentIntegration.archiveRecipeVersion.useMutation({
    onSuccess: () => { toast.success(t("eqIntegration.versionArchived", "Version archived")); refetchAll(); },
    onError: onMutationError,
  });
  const rollbackM = trpc.equipmentIntegration.rollbackRecipeVersion.useMutation({
    onSuccess: () => { toast.success(t("eqIntegration.versionRolledBack", "Released contract rolled back")); refetchAll(); },
    onError: onMutationError,
  });
  const recordLoadM = trpc.equipmentIntegration.recordRecipeLoad.useMutation({
    onSuccess: () => { toast.success(t("eqIntegration.loadRecorded", "Recipe load recorded (genealogy)")); refetchAll(); },
    onError: onMutationError,
  });
  // W8-C — start lives at page level (the sheet is rendered by FlyoutHost, outside the panel).
  const startAcqM = trpc.visionAdapter.startAcquisitionWorker.useMutation({
    onSuccess: () => { toast.success(t("eqIntegration.acq.started", "Acquisition worker started")); refreshAcq(); },
    // PRECONDITION_FAILED carries the server's honest refusal reason (flag off,
    // duplicate id, disabled config, source open failure) — show it verbatim.
    onError: (e) => toastTrpcError(e),
  });

  const runVersionLookup = () => {
    const c = recipeCode.trim();
    if (c) setActiveCode(c);
  };
  const runHistoryCodeLookup = () => {
    const c = historyCode.trim();
    if (c) setActiveHistoryCode(c);
  };

  if (!canView) {
    return (
      <DashboardLayout>
        <div className="p-6">
          <Card>
            <CardContent className="py-10 text-center text-muted-foreground">
              <AlertTriangle className="mx-auto mb-2 h-6 w-6" />
              {t("eqIntegration.noPermission", "You do not have permission to view equipment integration.")}
            </CardContent>
          </Card>
        </div>
      </DashboardLayout>
    );
  }

  const ctx: EqPageCtx = {
    tab,
    narrow,
    canView,
    canControl,
    canRelease,
    canViewAcq,
    canControlAcq,
    userId: user?.id ?? null,
    flagUnsettled,
    integration,
    integrationLoading: integrationQ.isLoading,
    integrationError: integrationQ.isError,
    connector,
    setConnector,
    machines,
    machineName,
    recipeCode,
    setRecipeCode,
    activeCode,
    runVersionLookup,
    versions,
    versionsLoading: versionsQ.isLoading,
    versionsError: versionsQ.isError,
    release: (v) => releaseM.mutate({ recipeId: v.id }),
    archive: (v) => archiveM.mutate({ recipeId: v.id }),
    rollback: (v) => rollbackM.mutate({ toRecipeId: v.id }),
    releasePending: releaseM.isPending,
    archivePending: archiveM.isPending,
    rollbackPending: rollbackM.isPending,
    recordLoadPending: recordLoadM.isPending,
    historyMode,
    setHistoryMode,
    historyMachineId,
    setHistoryMachineId,
    historyCode,
    setHistoryCode,
    activeHistoryCode,
    runHistoryCodeLookup,
    historyRows,
    historyFetching: historyMode === "machine" ? loadHistoryQ.isFetching : codeHistoryQ.isFetching,
    acqLive,
    setAcqLive,
    refreshAcq,
  };

  // ── Flyouts (một stack sheet phải; URL `?flyout=&flyoutId=` là nguồn sự thật) ──
  const findVersion = (id: string | null) =>
    id != null && /^\d+$/.test(id) ? versions.find((v) => v.id === Number(id)) ?? null : null;
  const flyouts: Record<string, FlyoutDefinition> = {};
  if (canControl) {
    flyouts["eq-recipe-new"] = {
      size: "md",
      title: t("eqIntegration.createTitle", "New recipe version (draft)"),
      description: t("eqIntegration.createDesc", "Immutable draft version — genealogy metadata only; nothing is pushed to a device."),
      render: () => (
        <CreateVersionForm
          defaultCode={activeCode ?? recipeCode}
          machines={machines}
          pending={createM.isPending}
          onSubmit={(v, done) => createM.mutate(v, { onSuccess: done })}
        />
      ),
    };
    flyouts["eq-recipe-load"] = {
      size: "md",
      title: t("eqIntegration.recordLoadTitle", "Record recipe load"),
      description: (id) => {
        const v = findVersion(id);
        return v
          ? t("eqIntegration.recordLoadHint", "Records that {{code}} v{{version}} was loaded onto a machine (genealogy). This opens no device path; a select_recipe command still routes through the gated dispatcher.")
              .replace("{{code}}", v.code)
              .replace("{{version}}", String(v.version))
          : undefined;
      },
      render: (layer) => {
        const v = findVersion(layer.id);
        if (!v) {
          return (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {versionsQ.isLoading
                ? t("eqIntegration.loading", "Loading…")
                : t("eqIntegration.versionNotFound", "Version #{{id}} is not in the loaded recipe code.", { id: layer.id ?? "" })}
            </p>
          );
        }
        return (
          <RecordLoadForm
            key={v.id}
            version={v}
            machines={machines}
            pending={recordLoadM.isPending}
            onSubmit={(input, done) => recordLoadM.mutate(input, { onSuccess: done })}
          />
        );
      },
    };
  }
  if (canViewAcq && canControlAcq) {
    flyouts["acq-start"] = {
      size: "md",
      title: t("eqIntegration.acq.startTitle", "Start acquisition worker"),
      description: t(
        "eqIntegration.acq.startHint",
        "File source replays a capture folder; mock generates synthetic frames. Submission stamps NTF ('needs inspection') — acquisition is not judgement.",
      ),
      render: () => (
        <StartAcquisitionWorkerForm
          pending={startAcqM.isPending}
          onSubmit={(cfg, done) => startAcqM.mutate(cfg, { onSuccess: done })}
        />
      ),
    };
  }

  const chipItems: StatusChipItem[] = [
    {
      id: "adapters-registered",
      label: t("eqIntegration.kpi.adapters", "Registered adapters"),
      value: integration?.adapters.length,
      state: chipStateFromQuery(integrationQ),
      source: t("eqIntegration.chip.srcAdapters", "Server adapter registry (integrationStatus.adapters) — registered, not connected"),
    },
    {
      id: "frameworks-connected",
      label: t("eqIntegration.kpi.configured", "Frameworks connected"),
      value: integration ? `${configuredCount}/${integration.frameworks.length}` : undefined,
      state: chipStateFromQuery(integrationQ),
      tone: integration && configuredCount === 0 ? "warning" : "success",
      source: t("eqIntegration.chip.srcConnected", "Frameworks with a real connector/device (integrationStatus.frameworks[].configured)"),
    },
    {
      id: "flag",
      label: t("eqIntegration.kpi.flag", "Flag"),
      value:
        flagStatus === "on" || flagStatus === "off"
          ? featureStatusLabel(flagStatus, {
              on: t("eqIntegration.on", "On"),
              off: t("eqIntegration.off", "Off"),
              loading: t("eqIntegration.checking", "Checking…"),
              error: t("eqIntegration.unknown", "Unknown"),
            })
          : undefined,
      state: flagChipState(flagStatus),
      tone: featureStatusTone(flagStatus) === "good" ? "success" : featureStatusTone(flagStatus) === "warning" ? "warning" : "default",
      source: t("eqIntegration.chip.srcFlag", "Server feature flag (equipmentIntegration.status)"),
    },
  ];

  return (
    <DashboardLayout>
      <FlyoutHost flyouts={flyouts}>
        {/* doc 81 Đợt 2 Task 2 — PageContainer: không đệm kép với <main> của shell. */}
        <PageContainer className="space-y-0">
          <EqCtx.Provider value={ctx}>
            <CockpitLayout
              icon={<Plug />}
              title={
                <span className="flex items-center gap-2">
                  {t("eqIntegration.title", "Equipment Integration")}
                  {!canControl && <ViewOnlyBadge module="machine_control" />}
                </span>
              }
              notices={
                <>
                  {/* Honest 4-state flag (loading/off/on/error) — doc 80 Task 1, as a chip. */}
                  <FeatureStatusNoticeChip
                    status={flagStatus}
                    offMessage={t(
                      "eqIntegration.flagOffBanner",
                      "Preview mode: equipment integration is disabled. Reads work; actions (create / release / archive / rollback version, record load) are blocked until it is enabled.",
                    )}
                    errorMessage={t(
                      "eqIntegration.flagStatusError",
                      "Could not check whether equipment integration is enabled — actions are disabled until this is confirmed.",
                    )}
                  />
                  <NoticeStack
                    items={[
                      {
                        // U7 (doc 26 §2.1) — "Khi nào dùng" (khoá riêng của trang) + phụ đề cũ.
                        id: "whenToUse:eqIntegration.whenToUse",
                        kind: "whenToUse",
                        content: (
                          <div className="space-y-2">
                            <p data-when-to-use="eqIntegration.whenToUse">
                              {t("eqIntegration.whenToUse", "When to use — browse vendor integration frameworks (FOCAS/Euromap) and recipe version genealogy. Read-only metadata, no live device.")}
                            </p>
                            <p className="text-muted-foreground">
                              {t("eqIntegration.subtitle", "Multi-vendor integration frameworks (FOCAS / Euromap, read-only) and recipe versioning genealogy — metadata only, no device commands.")}
                            </p>
                          </div>
                        ),
                      },
                      {
                        // Safety / honesty note — mirrors the router discipline.
                        id: "honesty",
                        kind: "honesty",
                        label: t("eqIntegration.safetyChip", "Read-only · no device control"),
                        content: (
                          <p>
                            {t(
                              "eqIntegration.safetyNote",
                              "FOCAS/Euromap are read-only integration frameworks — no live device is attached and no telemetry is fabricated. Recipe versioning here is genealogy/metadata only; it opens no device-control path.",
                            )}
                          </p>
                        ),
                      },
                    ]}
                  />
                </>
              }
              chips={<StatusChipStrip items={chipItems} />}
              actions={
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={refetchAll}
                  title={t("common.refresh", "Refresh")}
                  aria-label={t("common.refresh", "Refresh")}
                >
                  <RefreshCw className="h-4 w-4" />
                </Button>
              }
              tabs={TABS}
              basePath={BASE_PATH}
              defaultTab="status"
              toolbarEnd={narrow ? undefined : <TabToolbar />}
              mainName="equipment-integration"
            />
          </EqCtx.Provider>
        </PageContainer>
      </FlyoutHost>
    </DashboardLayout>
  );
}

function flagChipState(s: FeatureStatus): StatusChipItem["state"] {
  if (s === "loading") return "loading";
  if (s === "error") return "error";
  return "ok";
}

// ── Hàng công cụ của tab đang mở (cùng hàng dải tab — thanh công cụ DUY NHẤT trong MAIN) ───────
function TabToolbar() {
  const ctx = useEqCtx();
  if (ctx.tab === "recipes") return <RecipesToolbar />;
  if (ctx.tab === "history") return <HistoryToolbar />;
  if (ctx.tab === "acquisition") return <AcquisitionToolbar />;
  return <CatalogToolbar />;
}

/** <1024 px: cùng bộ công cụ, nhưng là một hàng xuống dòng được ở đầu nội dung tab (không bị hàng tab cắt). */
function NarrowTools() {
  return (
    <div data-narrow-tools="" className="flex flex-wrap items-center gap-2 pb-2">
      <TabToolbar />
    </div>
  );
}

function CatalogToolbar() {
  const { t } = useTranslation();
  const { integration } = useEqCtx();
  if (!integration) return null;
  const n = integration.frameworks.length + integration.adapters.length;
  return (
    <span className="text-xs text-muted-foreground">
      {t("eqIntegration.catalog.count", "{{count}} connectors", { count: n })}
    </span>
  );
}

function RecipesLink({ href }: { href: string }) {
  const { t } = useTranslation();
  return (
    <Link
      href={href}
      className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs text-primary hover:bg-accent"
      title={t("eqIntegration.openInRecipesHint", "Recipe catalog, approval and deployment live on the Recipes page")}
    >
      <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
      {t("eqIntegration.openInRecipes", "Open in Recipes")}
    </Link>
  );
}

function RecipesToolbar() {
  const { t } = useTranslation();
  const ctx = useEqCtx();
  const flyout = useFlyout();
  return (
    <>
      <Input
        className="h-8 w-24"
        value={ctx.recipeCode}
        placeholder="RCP-001"
        aria-label={t("eqIntegration.recipeCode", "Recipe code")}
        onChange={(e) => ctx.setRecipeCode(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") ctx.runVersionLookup(); }}
      />
      <Button variant="outline" size="sm" className="h-8" disabled={!ctx.recipeCode.trim()} onClick={ctx.runVersionLookup}>
        {t("eqIntegration.loadVersions", "Load versions")}
      </Button>
      {ctx.canControl && (
        <Button
          size="sm" variant="outline" className="h-8"
          disabled={ctx.flagUnsettled}
          title={ctx.flagUnsettled ? t("common.gate.checkingStatus", "Checking feature status…") : undefined}
          onClick={() => flyout.open("eq-recipe-new")}
        >
          <Plus className="mr-1 h-4 w-4" />{t("eqIntegration.createVersion", "New version")}
        </Button>
      )}
      <RecipesLink href={ctx.activeCode ? `/recipes?code=${encodeURIComponent(ctx.activeCode)}` : "/recipes"} />
    </>
  );
}

function HistoryToolbar() {
  const { t } = useTranslation();
  const ctx = useEqCtx();
  const link =
    ctx.historyMode === "machine" && ctx.historyMachineId
      ? `/recipes?machineId=${ctx.historyMachineId}`
      : ctx.historyMode === "code" && ctx.activeHistoryCode
        ? `/recipes?code=${encodeURIComponent(ctx.activeHistoryCode)}`
        : "/recipes";
  return (
    <>
      <Select value={ctx.historyMode} onValueChange={(v) => ctx.setHistoryMode(v as HistoryMode)}>
        <SelectTrigger className="h-8 w-32" aria-label={t("eqIntegration.historyMode", "Filter by")}><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="machine">{t("eqIntegration.byMachine", "Machine")}</SelectItem>
          <SelectItem value="code">{t("eqIntegration.byCode", "Recipe code")}</SelectItem>
        </SelectContent>
      </Select>
      {ctx.historyMode === "machine" ? (
        // U11 — Select DS; "__none__" là sentinel cho "chưa chọn máy".
        <Select
          value={ctx.historyMachineId != null ? String(ctx.historyMachineId) : "__none__"}
          onValueChange={(v) => ctx.setHistoryMachineId(v === "__none__" ? null : Number(v))}
        >
          <SelectTrigger className="h-8 w-56" aria-label={t("eqIntegration.machine", "Machine")}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">{t("eqIntegration.selectMachine", "Select a machine…")}</SelectItem>
            {ctx.machines.map((m) => (
              <SelectItem key={m.id} value={String(m.id)}>{m.name ?? m.code} ({m.code})</SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <>
          <Input
            className="h-8 w-32"
            value={ctx.historyCode}
            placeholder="RCP-001"
            aria-label={t("eqIntegration.recipeCode", "Recipe code")}
            onChange={(e) => ctx.setHistoryCode(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") ctx.runHistoryCodeLookup(); }}
          />
          <Button variant="outline" size="sm" className="h-8" disabled={!ctx.historyCode.trim()} onClick={ctx.runHistoryCodeLookup}>
            {t("eqIntegration.loadHistory", "Load history")}
          </Button>
        </>
      )}
      <RecipesLink href={link} />
    </>
  );
}

function AcquisitionToolbar() {
  const { t } = useTranslation();
  const ctx = useEqCtx();
  const flyout = useFlyout();
  if (!ctx.canViewAcq) return null;
  return (
    <>
      {/* Live-flag notice (honest gate — workers refuse to start when off), as a chip in the tool row. */}
      {ctx.acqLive === false && (
        <NoticeChip kind="flagOff" label={t("eqIntegration.acq.liveOffChip", "Live acquisition off")}>
          <p>
            {t(
              "eqIntegration.acq.flagOff",
              "Live acquisition is disabled (LIVE_ACQUISITION_ENABLED is off). Status stays readable; starting a worker will be refused until the flag is enabled.",
            )}
          </p>
        </NoticeChip>
      )}
      <NoticeChip kind="hint" label={t("eqIntegration.acq.aboutChip", "About sources")}>
        <p>
          {t(
            "eqIntegration.acq.desc",
            "Grab → quality metrics → optional NTF submit through the same canonical ingest path. File/mock sources are real today; GenICam stays a stub until a camera driver is bound.",
          )}
        </p>
      </NoticeChip>
      <Button size="icon" variant="ghost" className="h-8 w-8" onClick={ctx.refreshAcq} title={t("common.refresh", "Refresh")} aria-label={t("common.refresh", "Refresh")}>
        <RefreshCw className="h-4 w-4" />
      </Button>
      {ctx.canControlAcq && (
        <Button size="sm" variant="outline" className="h-8" onClick={() => flyout.open("acq-start")}>
          <Play className="mr-1 h-4 w-4" />
          {t("eqIntegration.acq.start", "Start worker")}
        </Button>
      )}
    </>
  );
}

// ════════════════ TAB: Connector catalog (I1-a) — danh sách–chi tiết ════════════════

type ConnectorItem =
  | { id: string; type: "framework"; framework: FrameworkEntry }
  | { id: string; type: "adapter"; adapter: AdapterEntry };

function CatalogTab() {
  const { t } = useTranslation();
  const ctx = useEqCtx();
  const items: ConnectorItem[] = useMemo(() => {
    if (!ctx.integration) return [];
    return [
      ...ctx.integration.frameworks.map((f) => ({ id: `framework:${f.kind}`, type: "framework" as const, framework: f })),
      ...ctx.integration.adapters.map((a) => ({ id: `adapter:${a.kind}`, type: "adapter" as const, adapter: a })),
    ];
  }, [ctx.integration]);
  const selected = items.find((i) => i.id === ctx.connector) ?? null;

  const select = (id: string) => ctx.setConnector(id);
  const list = (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t("eqIntegration.catalog.colConnector", "Connector")}</TableHead>
          <TableHead>{t("eqIntegration.catalog.colType", "Type")}</TableHead>
          <TableHead>{t("eqIntegration.col.status", "Status")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {ctx.integrationLoading && (
          <TableRow><TableCell colSpan={3} className="py-8 text-center text-muted-foreground">{t("eqIntegration.loading", "Loading…")}</TableCell></TableRow>
        )}
        {ctx.integrationError && (
          <TableRow><TableCell colSpan={3} role="alert" className="py-8 text-center text-destructive">{t("eqIntegration.catalog.loadError", "Could not read the integration status.")}</TableCell></TableRow>
        )}
        {items.map((item) => (
          <TableRow
            key={item.id}
            data-connector={item.id}
            tabIndex={0}
            aria-current={selected?.id === item.id ? "true" : undefined}
            className={`cursor-pointer ${selected?.id === item.id ? "bg-muted" : ""}`}
            onClick={() => select(item.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                select(item.id);
              }
            }}
          >
            <TableCell>
              <span className="font-mono text-xs font-medium">{item.type === "framework" ? item.framework.kind : item.adapter.kind}</span>
              {item.type === "framework" && <span className="ml-1 text-xs text-muted-foreground">({item.framework.vendor})</span>}
            </TableCell>
            <TableCell className="text-xs">
              {item.type === "framework" ? t("eqIntegration.catalog.typeFramework", "Framework") : t("eqIntegration.catalog.typeAdapter", "Adapter protocol")}
            </TableCell>
            <TableCell><ConnectorStatus item={item} /></TableCell>
          </TableRow>
        ))}
        {ctx.integration && ctx.integration.adapters.length === 0 && (
          <TableRow><TableCell colSpan={3} className="py-4 text-center text-xs text-muted-foreground">{t("eqIntegration.noAdapters", "No adapter protocols registered.")}</TableCell></TableRow>
        )}
      </TableBody>
    </Table>
  );

  return (
    <>
      {ctx.narrow && <NarrowTools />}
      <SplitListDetail
        layoutId="eq-integration-catalog"
        userId={ctx.userId}
        list={list}
        hasSelection={selected != null}
        onBack={() => ctx.setConnector(null)}
        listLabel={t("eqIntegration.catalog.listLabel", "Connector catalog")}
        detailLabel={t("eqIntegration.catalog.detailLabel", "Connector details")}
        heightClass="h-[calc(100dvh-13rem)] min-h-[22rem]"
        emptyDetail={<EmptyState variant="no-data" compact title={t("eqIntegration.catalog.pickHint", "Pick a connector to see its details.")} />}
        detail={
          selected == null ? null : selected.type === "framework" ? (
            <FrameworkDetail key={selected.id} framework={selected.framework} canView={ctx.canView} />
          ) : (
            <AdapterDetail key={selected.id} adapter={selected.adapter} />
          )
        }
      />
    </>
  );
}

function ConnectorStatus({ item }: { item: ConnectorItem }) {
  const { t } = useTranslation();
  if (item.type === "adapter") {
    return (
      <Badge variant="outline" className="text-xs" title={item.adapter.delegatesTo}>
        {t("eqIntegration.catalog.registered", "Registered")}
      </Badge>
    );
  }
  return item.framework.configured ? (
    <StatusBadge status="configured" tone="success" label={t("eqIntegration.configured", "Connected")} />
  ) : (
    <Badge variant="outline" className="border-warning/30 bg-warning/15 text-warning">
      <CircleSlash className="mr-1 h-3 w-3" />{t("eqIntegration.frameworkNoDevice", "Framework — no device connected")}
    </Badge>
  );
}

function AdapterDetail({ adapter }: { adapter: AdapterEntry }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-3 overflow-auto p-3 text-sm">
      <h2 className="font-mono text-base font-semibold">{adapter.kind}</h2>
      <dl className="grid grid-cols-[10rem_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted-foreground">{t("eqIntegration.catalog.colType", "Type")}</dt>
        <dd>{t("eqIntegration.catalog.typeAdapter", "Adapter protocol")}</dd>
        <dt className="text-muted-foreground">{t("eqIntegration.col.status", "Status")}</dt>
        <dd>{t("eqIntegration.catalog.registered", "Registered")}</dd>
        <dt className="text-muted-foreground">{t("eqIntegration.catalog.delegatesTo", "Delegates to")}</dt>
        <dd className="font-mono">{adapter.delegatesTo}</dd>
      </dl>
      <p className="text-xs text-muted-foreground">
        {t(
          "eqIntegration.catalog.adapterHonesty",
          "This protocol is REGISTERED in the server's adapter registry — registration does not mean a device is connected.",
        )}
      </p>
    </div>
  );
}

// ── Framework detail (FOCAS / Euromap) with an honest read-only snapshot ─────────
function FrameworkDetail({ framework, canView }: { framework: FrameworkEntry; canView: boolean }) {
  const { t } = useTranslation();
  const uid = useId();
  const [machineCode, setMachineCode] = useState("");
  const [active, setActive] = useState<string | null>(null);

  const snapshotQ = trpc.equipmentIntegration.frameworkSnapshot.useQuery(
    { kind: framework.kind as FrameworkKind, machineCode: active ?? "" },
    { enabled: canView && !!active, retry: false },
  );
  const snap = snapshotQ.data as FrameworkSnapshot | undefined;

  const transports = "transports" in framework ? framework.transports : undefined;
  const readFunctions = "readFunctions" in framework ? framework.readFunctions : undefined;

  return (
    <div className="space-y-3 overflow-auto p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-semibold capitalize">{framework.kind}</h2>
        <span className="text-xs text-muted-foreground">({framework.vendor})</span>
        <ConnectorStatus item={{ id: framework.kind, type: "framework", framework }} />
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <Badge variant="outline" className="text-muted-foreground">{t("eqIntegration.readOnly", "read-only")}</Badge>
        {transports?.map((tr) => (
          <Badge key={tr} variant="secondary" className="font-mono text-xs">{tr}</Badge>
        ))}
        {readFunctions?.map((fn) => (
          <Badge key={fn} variant="secondary" className="font-mono text-xs">{fn}</Badge>
        ))}
      </div>

      <p className="text-xs text-muted-foreground">{framework.caveat}</p>
      <p className="text-xs text-muted-foreground">
        {t(
          "eqIntegration.frameworkNote",
          "This is an integration FRAMEWORK. It models the read-only fields a real FOCAS/Euromap connector would map into the Unified Equipment Model, but live data requires a connected device/connector. Until then values stay \"—\" and the snapshot source is \"none\".",
        )}
      </p>

      {/* Honest snapshot probe — UEM fields shown with "—" when source:'none' */}
      <div className="flex flex-wrap items-end gap-2">
        <div className="grid gap-1">
          <Label htmlFor={`${uid}-mc`} className="text-xs text-muted-foreground">{t("eqIntegration.machineCode", "Machine code")}</Label>
          <Input
            id={`${uid}-mc`}
            className="w-44"
            value={machineCode}
            placeholder="CNC-01"
            onChange={(e) => setMachineCode(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && machineCode.trim()) setActive(machineCode.trim()); }}
          />
        </div>
        <Button variant="outline" size="sm" disabled={!machineCode.trim()} onClick={() => setActive(machineCode.trim())}>
          {t("eqIntegration.readSnapshot", "Read snapshot")}
        </Button>
      </div>

      {active && snapshotQ.isFetching && <Text tone="muted" variant="body-sm">{t("eqIntegration.loading", "Loading…")}</Text>}
      {snap && !snapshotQ.isFetching && (
        <div className="rounded-md border border-border bg-muted/30 p-3">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <StatusBadge
              status={snap.source}
              tone={snap.source === "live" ? "success" : snap.source === "cache" ? "info" : "default"}
              label={t(`eqIntegration.source.${snap.source}`, snap.source)}
            />
            {!snap.connected && (
              <Badge variant="outline" className="text-muted-foreground">{t("eqIntegration.notConnected", "not connected")}</Badge>
            )}
            <span className="text-xs text-muted-foreground">
              {snap.at ? new Date(snap.at).toLocaleString() : t("eqIntegration.noReadout", "no readout")}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <UemField label={t("eqIntegration.uem.recipeId", "recipe_id")} value={strOrDash(snap.recipeId)} />
            <UemField label={t("eqIntegration.uem.cycleCount", "cycle_count")} value={numOrDash(snap.cycleCount)} />
            <UemField label={t("eqIntegration.uem.alarmCode", "alarm_code")} value={strOrDash(snap.alarmCode)} />
            <UemField label={t("eqIntegration.uem.utilization", "utilization_rate")} value={pctOrDash(snap.utilizationRate)} />
          </div>
        </div>
      )}
    </div>
  );
}

function UemField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="font-mono text-muted-foreground">{label}</span>
      <span className="font-mono font-medium">{value}</span>
    </div>
  );
}

// ════════════════ TAB: Recipe versions (I1-b) — VersionHistoryPanel ════════════════

function RecipesTab() {
  const { t } = useTranslation();
  const ctx = useEqCtx();
  const flyout = useFlyout();
  const [, setLocation] = useLocation();

  if (!ctx.activeCode) {
    return (
      <>
        {ctx.narrow && <NarrowTools />}
        <EmptyState
          variant="no-data"
          title={t("eqIntegration.pickHint", "Enter a recipe code above to list its immutable versions and genealogy actions.")}
          description={t("eqIntegration.recipesElsewhere", "Recipe approval and deployment to machines live on the Recipes page.")}
          actionLabel={t("eqIntegration.openInRecipes", "Open in Recipes")}
          onAction={() => setLocation("/recipes")}
        />
      </>
    );
  }

  const released = ctx.versions.find((v) => v.designStatus === "released");
  const rows: VersionRow[] = ctx.versions.map((v) => ({
    id: v.id,
    label: `v${v.version}`,
    createdAt: v.createdAt ?? null,
    author: v.createdBy != null ? `#${v.createdBy}` : undefined,
    current: v.designStatus === "released",
    note: (
      <span className="inline-flex items-center gap-2">
        <StatusBadge status={v.designStatus} label={t(`eqIntegration.recipeStatus.${v.designStatus}`, v.designStatus)} />
        <span>{v.name}</span>
      </span>
    ),
    content: v.payload,
  }));
  const byId = new Map(ctx.versions.map((v) => [v.id, v]));
  const needsEdit = t("eqIntegration.needsEditPermission", "Needs edit permission (machine_control/canEdit) to release/rollback.");

  return (
    <>
      {ctx.narrow && <NarrowTools />}
      <VersionHistoryPanel
        title={t("eqIntegration.versionsTitle", "Versions of {{code}}").replace("{{code}}", ctx.activeCode)}
        versions={rows}
        status={ctx.versionsError ? "error" : ctx.versionsLoading ? "loading" : "ready"}
        defaultBaseId={released?.id ?? null}
        diffMaxHeightClass="max-h-[40vh]"
        renderRowActions={(row) => {
          const v = byId.get(Number(row.id));
          if (!v) return null;
          if (!ctx.canControl) return <span className="text-xs text-muted-foreground">{t("eqIntegration.viewOnly", "View only")}</span>;
          return (
            <div className="flex justify-end gap-1">
              {v.designStatus === "draft" && (
                <Button size="sm" variant="ghost" className="h-7" disabled={ctx.releasePending || !ctx.canRelease}
                  title={ctx.canRelease ? t("eqIntegration.releaseTip", "Release this version (archives the current released one)") : needsEdit}
                  onClick={() => ctx.release(v)}>
                  <Rocket className="mr-1 h-3.5 w-3.5 text-emerald-500" />{t("eqIntegration.release", "Release")}
                </Button>
              )}
              {v.designStatus === "archived" && (
                // R-2-g — hợp đồng cũ: AlertDialog, không lý do, không OTP; MỘT lượt rollback mỗi xác nhận.
                <RollbackConfirm
                  requireReason={false}
                  requireOtp={false}
                  versionLabel={`v${v.version}`}
                  title={t("eqIntegration.rollbackConfirmTitle", "Roll back released contract?")}
                  description={t(
                    "eqIntegration.rollbackConfirmBody",
                    "This releases {{code}} v{{version}} and archives the current released version. It writes genealogy metadata only — no recipe is pushed to a device.",
                  )
                    .replace("{{code}}", v.code)
                    .replace("{{version}}", String(v.version))}
                  confirmLabel={t("eqIntegration.rollback", "Rollback")}
                  disabled={ctx.rollbackPending || !ctx.canRelease}
                  onRollback={() => ctx.rollback(v)}
                  trigger={
                    <Button size="sm" variant="ghost" className="h-7" disabled={ctx.rollbackPending || !ctx.canRelease}
                      title={ctx.canRelease ? t("eqIntegration.rollbackTip", "Roll the released contract back to this version") : needsEdit}>
                      <Undo2 className="mr-1 h-3.5 w-3.5" />{t("eqIntegration.rollback", "Rollback")}
                    </Button>
                  }
                />
              )}
              {v.designStatus !== "archived" && (
                <Button size="sm" variant="ghost" className="h-7" disabled={ctx.archivePending}
                  title={t("eqIntegration.archiveTip", "Archive this version")}
                  onClick={() => ctx.archive(v)}>
                  <Archive className="mr-1 h-3.5 w-3.5" />{t("eqIntegration.archive", "Archive")}
                </Button>
              )}
              <Button size="sm" variant="ghost" className="h-7" disabled={ctx.recordLoadPending}
                title={t("eqIntegration.loadTip", "Record that this version was loaded onto a machine (genealogy)")}
                onClick={() => flyout.open("eq-recipe-load", { id: v.id })}>
                <Download className="mr-1 h-3.5 w-3.5" />{t("eqIntegration.recordLoad", "Record load")}
              </Button>
            </div>
          );
        }}
      />
    </>
  );
}

// ════════════════ TAB: Load history / genealogy (I1-b) ════════════════

// ── Action → tone for the genealogy table ─────────────────────────────────────
const ACTION_TONE: Record<string, "success" | "warning" | "info" | "default" | "error"> = {
  create: "default",
  release: "success",
  archive: "warning",
  rollback: "info",
  load: "info",
};

function HistoryTab() {
  const { t } = useTranslation();
  const ctx = useEqCtx();
  const { historyMode, historyMachineId, activeHistoryCode, historyRows, historyFetching } = ctx;
  return (
    <>
      {ctx.narrow && <NarrowTools />}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("eqIntegration.col.when", "When")}</TableHead>
            <TableHead>{t("eqIntegration.col.action", "Action")}</TableHead>
            <TableHead>{t("eqIntegration.col.recipe", "Code @ version")}</TableHead>
            <TableHead>{t("eqIntegration.col.machine", "Machine")}</TableHead>
            <TableHead>{t("eqIntegration.col.who", "Performed by")}</TableHead>
            <TableHead>{t("eqIntegration.col.notes", "Notes")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {historyFetching && (
            <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">{t("eqIntegration.loading", "Loading…")}</TableCell></TableRow>
          )}
          {historyMode === "machine" && !historyMachineId && (
            <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">{t("eqIntegration.selectMachineHint", "Select a machine to view its recipe genealogy.")}</TableCell></TableRow>
          )}
          {historyMode === "code" && !activeHistoryCode && (
            <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">{t("eqIntegration.selectCodeHint", "Enter a recipe code to view its genealogy across machines.")}</TableCell></TableRow>
          )}
          {((historyMode === "machine" && historyMachineId && !historyFetching) ||
            (historyMode === "code" && activeHistoryCode && !historyFetching)) &&
            historyRows.length === 0 && (
            <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">{t("eqIntegration.historyEmpty", "No genealogy events.")}</TableCell></TableRow>
          )}
          {historyRows.map((row) => (
            <TableRow key={row.id}>
              <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                {row.createdAt ? new Date(row.createdAt).toLocaleString() : "—"}
              </TableCell>
              <TableCell>
                <StatusBadge status={row.action} tone={ACTION_TONE[row.action] ?? "default"} label={t(`eqIntegration.action.${row.action}`, row.action)} />
              </TableCell>
              <TableCell className="font-mono text-xs">
                {row.recipeCode}{row.recipeVersion != null ? ` @v${row.recipeVersion}` : ""}
              </TableCell>
              <TableCell className="text-xs">
                {row.machineId != null ? (ctx.machineName.get(row.machineId) ?? `#${row.machineId}`) : "—"}
              </TableCell>
              <TableCell className="text-xs">{row.performedBy != null ? `#${row.performedBy}` : "—"}</TableCell>
              <TableCell className="max-w-[20rem] truncate text-xs text-muted-foreground" title={row.notes ?? undefined}>
                {row.notes ?? "—"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// W8-C (doc 27 V14, Đợt 7.6 follow-up) — Acquisition worker panel.
//
// UI over visionAdapter.acquisitionWorkerStatus / startAcquisitionWorker /
// stopAcquisitionWorker (W7-E built them API-only and documented THIS page as
// the panel slot). RBAC mirrors the router: machine_alerts/canView to read,
// machine_alerts/canCreate to start/stop. LIVE_ACQUISITION_ENABLED gates
// starting — the refusal reason from the server is surfaced verbatim (honest).
//
// Doc 81 Đợt 2 Task 7 — Review Focus 3: the tab is keepMounted; the panel mounts the FIRST time the tab is
// opened (no polling for a page visit that never opens it) and is never unmounted by a tab switch afterwards.
// ════════════════════════════════════════════════════════════════════════════

type AcqStatus = RouterOutputs["visionAdapter"]["acquisitionWorkerStatus"];
type AcqWorker = AcqStatus["workers"][number];

const ACQ_STATE_TONE: Record<string, "success" | "warning" | "error" | "default" | "info"> = {
  running: "success",
  completed: "info",
  stopped: "default",
  error: "error",
};

function AcquisitionTab() {
  const { tab, narrow } = useEqCtx();
  // Chốt "đã mở": một khi tab được mở, panel ở lại (TabbedHub keepMounted giữ instance).
  const [opened, setOpened] = useState(tab === "acquisition");
  useEffect(() => {
    if (tab === "acquisition") setOpened(true);
  }, [tab]);
  // `{narrow && …}` giữ vị trí con ⇒ qua lại 1024 px KHÔNG remount panel.
  return opened ? (
    <>
      {narrow && <NarrowTools />}
      <AcquisitionWorkersPanel />
    </>
  ) : null;
}

function AcquisitionWorkersPanel() {
  const { t } = useTranslation();
  const { canViewAcq, canControlAcq, setAcqLive, refreshAcq } = useEqCtx();

  const statusQ = trpc.visionAdapter.acquisitionWorkerStatus.useQuery(undefined, {
    enabled: canViewAcq,
    refetchInterval: 5_000,
    retry: false,
  });
  const sourcesQ = trpc.visionAdapter.listAcquisitionSources.useQuery(undefined, {
    enabled: canViewAcq,
    retry: false,
    staleTime: 60_000,
  });

  const stopM = trpc.visionAdapter.stopAcquisitionWorker.useMutation({
    onSuccess: () => {
      toast.success(t("eqIntegration.acq.stopped", "Acquisition worker stopped"));
      refreshAcq();
    },
    onError: (e) => toastTrpcError(e),
  });

  const status = statusQ.data as AcqStatus | undefined;
  const liveEnabled = status?.liveEnabled;
  useEffect(() => {
    setAcqLive(liveEnabled);
  }, [liveEnabled]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!canViewAcq) {
    return (
      <div data-acq-panel="" className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
        <Lock className="mt-0.5 h-4 w-4 shrink-0" />
        {t("eqIntegration.acq.noPermission", "Viewing acquisition workers requires the machine-alerts view permission.")}
      </div>
    );
  }

  const workers = status?.workers ?? [];

  return (
    <div data-acq-panel="" className="space-y-2">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("eqIntegration.acq.col.id", "Worker")}</TableHead>
            <TableHead>{t("eqIntegration.col.status", "Status")}</TableHead>
            <TableHead>{t("eqIntegration.acq.col.source", "Source")}</TableHead>
            <TableHead className="text-right">{t("eqIntegration.acq.col.frames", "Frames")}</TableHead>
            <TableHead className="text-right">{t("eqIntegration.acq.col.submitted", "Submitted")}</TableHead>
            <TableHead className="text-right">{t("eqIntegration.acq.col.errors", "Errors")}</TableHead>
            <TableHead>{t("eqIntegration.acq.col.last", "Last frame / error")}</TableHead>
            {canControlAcq && <TableHead className="text-right">{t("common.actions", "Actions")}</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {statusQ.isLoading && (
            <TableRow>
              <TableCell colSpan={canControlAcq ? 8 : 7} className="py-8 text-center text-muted-foreground">
                <Loader2 className="mx-auto h-5 w-5 animate-spin" />
              </TableCell>
            </TableRow>
          )}
          {!statusQ.isLoading && workers.length === 0 && (
            <TableRow>
              <TableCell colSpan={canControlAcq ? 8 : 7} className="py-8 text-center text-muted-foreground">
                {t("eqIntegration.acq.empty", "No acquisition workers registered in this server session.")}
              </TableCell>
            </TableRow>
          )}
          {workers.map((w: AcqWorker) => {
            const lastEntry = w.ledger.length > 0 ? w.ledger[w.ledger.length - 1] : null;
            return (
              <TableRow key={w.id}>
                <TableCell>
                  <span className="font-mono text-xs font-medium">{w.id}</span>
                  <p className="text-[10px] text-muted-foreground">
                    {t("eqIntegration.acq.since", "since")} {new Date(w.startedAt).toLocaleString()}
                    {w.stoppedAt ? ` → ${new Date(w.stoppedAt).toLocaleTimeString()}` : ""}
                  </p>
                </TableCell>
                <TableCell>
                  <StatusBadge status={w.state} tone={ACQ_STATE_TONE[w.state] ?? "default"} label={t(`eqIntegration.acq.state.${w.state}`, w.state)} />
                </TableCell>
                <TableCell>
                  <Badge variant="secondary" className="font-mono text-[11px]">{w.config.source.kind}</Badge>
                  {w.config.submit && (
                    <Badge variant="outline" className="ml-1 text-[10px]" title={w.config.machineCode ?? undefined}>
                      {t("eqIntegration.acq.submits", "submits NTF")}
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-right font-mono text-xs">{w.framesGrabbed}</TableCell>
                <TableCell className="text-right font-mono text-xs">{w.submitted}</TableCell>
                <TableCell className={`text-right font-mono text-xs ${w.errors > 0 ? "text-destructive" : ""}`}>{w.errors}</TableCell>
                <TableCell className="max-w-56">
                  {w.lastError ? (
                    <span className="block truncate text-xs text-destructive" title={w.lastError}>{w.lastError}</span>
                  ) : lastEntry ? (
                    <span className="text-xs text-muted-foreground">
                      #{lastEntry.frameId} · {new Date(lastEntry.at).toLocaleTimeString()}
                      {lastEntry.quality
                        ? lastEntry.quality.acceptable
                          ? ` · ${t("eqIntegration.acq.qualityOk", "quality OK")}`
                          : ` · ${t("eqIntegration.acq.qualityBad", "quality poor")}`
                        : ""}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </TableCell>
                {canControlAcq && (
                  <TableCell className="text-right">
                    {w.state === "running" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-destructive hover:text-destructive/80"
                        disabled={stopM.isPending}
                        onClick={() => stopM.mutate({ id: w.id })}
                      >
                        <Square className="mr-1 h-3.5 w-3.5" />
                        {t("eqIntegration.acq.stop", "Stop")}
                      </Button>
                    )}
                  </TableCell>
                )}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      {/* Discovery line — which source kinds are genuinely usable now */}
      {sourcesQ.data && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <span>{t("eqIntegration.acq.sources", "Source kinds")}:</span>
          {sourcesQ.data.sources.map((s: { kind: string; available: boolean; description?: string }) => (
            <Badge
              key={s.kind}
              variant="outline"
              className={`font-mono text-[10px] ${s.available ? "" : "text-muted-foreground line-through"}`}
              title={s.description}
            >
              {s.kind}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Đóng lớp flyout của CHÍNH form này (không đóng nhầm lớp khác — Task 5 review M3) ──────────
function useCloseOwnLayer() {
  const layer = useFlyoutLayer();
  const flyoutApi = useFlyout();
  const stackRef = useRef(flyoutApi.stack);
  stackRef.current = flyoutApi.stack;
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  const done = () => {
    const top = stackRef.current[stackRef.current.length - 1];
    if (!mountedRef.current || !top || top.key !== layer.key || top.id !== layer.id) return;
    layer.setDirty(false);
    layer.close();
  };
  return { layer, done };
}

function SheetFooter({ children }: { children: ReactNode }) {
  return <div className="flex justify-end gap-2 border-t pt-3">{children}</div>;
}

// ── Sheet: create recipe version ───────────────────────────────────────────────
function CreateVersionForm({
  defaultCode, machines, pending, onSubmit,
}: {
  defaultCode: string;
  machines: MachineRow[];
  pending: boolean;
  onSubmit: (v: CreateVersionInput, done: () => void) => void;
}) {
  const { t } = useTranslation();
  const { layer, done } = useCloseOwnLayer();
  const uid = useId();
  const [initialCode] = useState(defaultCode);
  const [code, setCode] = useState(defaultCode);
  const [name, setName] = useState("");
  const [machineId, setMachineId] = useState<number | null>(null);
  const [payloadText, setPayloadText] = useState("{}");
  const [notes, setNotes] = useState("");

  const dirty = code !== initialCode || name !== "" || machineId != null || payloadText !== "{}" || notes !== "";
  useEffect(() => { layer.setDirty(dirty); }, [dirty]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = () => {
    if (!code.trim() || !name.trim()) {
      toast.error(t("eqIntegration.createRequired", "Code and name are required.")); return;
    }
    let payload: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(payloadText || "{}");
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) payload = parsed as Record<string, unknown>;
      else { toast.error(t("eqIntegration.payloadObject", "Payload must be a JSON object.")); return; }
    } catch {
      toast.error(t("eqIntegration.payloadInvalid", "Payload is not valid JSON.")); return;
    }
    onSubmit(
      {
        code: code.trim(),
        name: name.trim(),
        payload,
        machineId: machineId ?? undefined,
        notes: notes.trim() || undefined,
      },
      done,
    );
  };

  return (
    <div className="grid gap-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1">
          <Label htmlFor={`${uid}-code`}>{t("eqIntegration.recipeCode", "Recipe code")}</Label>
          <Input id={`${uid}-code`} value={code} placeholder="RCP-001" onChange={(e) => setCode(e.target.value)} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor={`${uid}-name`}>{t("eqIntegration.col.name", "Name")}</Label>
          <Input id={`${uid}-name`} value={name} placeholder="Reflow profile A" onChange={(e) => setName(e.target.value)} />
        </div>
      </div>
      <div className="grid gap-1">
        <Label htmlFor={`${uid}-machine`}>{t("eqIntegration.machineOptional", "Machine (optional)")}</Label>
        {/* U11 — Select DS; "__none__" là sentinel cho "(none)". */}
        <Select value={machineId != null ? String(machineId) : "__none__"} onValueChange={(v) => setMachineId(v === "__none__" ? null : Number(v))}>
          <SelectTrigger id={`${uid}-machine`} className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">{t("eqIntegration.noMachine", "(none)")}</SelectItem>
            {machines.map((m) => <SelectItem key={m.id} value={String(m.id)}>{m.name ?? m.code} ({m.code})</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-1">
        <Label htmlFor={`${uid}-payload`}>{t("eqIntegration.payload", "Payload (JSON)")}</Label>
        <textarea
          id={`${uid}-payload`}
          className="flex min-h-[6rem] rounded-md border border-input bg-transparent px-2 py-1 font-mono text-xs"
          value={payloadText}
          onChange={(e) => setPayloadText(e.target.value)}
        />
      </div>
      <div className="grid gap-1">
        <Label htmlFor={`${uid}-notes`}>{t("eqIntegration.notes", "Notes")}</Label>
        <Input id={`${uid}-notes`} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <SheetFooter>
        <Button variant="outline" onClick={() => layer.close()}>{t("common.cancel", "Cancel")}</Button>
        <Button onClick={submit} disabled={pending}><CheckCircle2 className="mr-1 h-4 w-4" />{t("eqIntegration.create", "Create version")}</Button>
      </SheetFooter>
    </div>
  );
}

// ── Sheet: start acquisition worker (file / mock — the sources that are REAL today) ────────
function StartAcquisitionWorkerForm({
  pending, onSubmit,
}: {
  pending: boolean;
  onSubmit: (cfg: StartWorkerInput, done: () => void) => void;
}) {
  const { t } = useTranslation();
  const { layer, done } = useCloseOwnLayer();
  const uid = useId();
  const [id, setId] = useState("");
  const [kind, setKind] = useState<"file" | "mock">("file");
  const [directory, setDirectory] = useState("");
  const [loop, setLoop] = useState(false);
  const [mockMaxFrames, setMockMaxFrames] = useState("20");
  const [intervalMs, setIntervalMs] = useState("2000");
  const [submit, setSubmit] = useState(false);
  const [machineCode, setMachineCode] = useState("");
  const [assessQuality, setAssessQuality] = useState(true);

  const dirty = id !== "" || kind !== "file" || directory !== "" || loop || mockMaxFrames !== "20" || intervalMs !== "2000" || submit || machineCode !== "" || !assessQuality;
  useEffect(() => { layer.setDirty(dirty); }, [dirty]); // eslint-disable-line react-hooks/exhaustive-deps

  const doSubmit = () => {
    if (!id.trim()) {
      toast.error(t("eqIntegration.acq.idRequired", "Worker id is required.")); return;
    }
    if (kind === "file" && !directory.trim()) {
      toast.error(t("eqIntegration.acq.dirRequired", "Directory is required for a file source.")); return;
    }
    if (submit && !machineCode.trim()) {
      toast.error(t("eqIntegration.acq.machineRequired", "Submitting frames requires a machine code.")); return;
    }
    onSubmit(
      {
        id: id.trim(),
        source: kind === "file"
          ? { kind: "file", directory: directory.trim(), loop }
          : { kind: "mock", maxFrames: Math.max(0, parseInt(mockMaxFrames) || 0) },
        machineCode: machineCode.trim() || undefined,
        intervalMs: Math.min(3_600_000, Math.max(50, parseInt(intervalMs) || 2000)),
        submit,
        assessQuality,
      },
      done,
    );
  };

  return (
    <div className="grid gap-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1">
          <Label htmlFor={`${uid}-id`}>{t("eqIntegration.acq.col.id", "Worker")}</Label>
          <Input id={`${uid}-id`} value={id} placeholder="replay-line1" onChange={(e) => setId(e.target.value)} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor={`${uid}-kind`}>{t("eqIntegration.acq.kind", "Source kind")}</Label>
          <Select value={kind} onValueChange={(v) => setKind(v as "file" | "mock")}>
            <SelectTrigger id={`${uid}-kind`} className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="file">file</SelectItem>
              <SelectItem value="mock">mock</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      {kind === "file" ? (
        <>
          <div className="grid gap-1">
            <Label htmlFor={`${uid}-dir`}>{t("eqIntegration.acq.directory", "Directory (on the server)")}</Label>
            <Input id={`${uid}-dir`} value={directory} placeholder="D:\\captures\\line1" onChange={(e) => setDirectory(e.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={loop} onCheckedChange={(v) => setLoop(Boolean(v))} />
            {t("eqIntegration.acq.loop", "Loop the folder (soak test)")}
          </label>
        </>
      ) : (
        <div className="grid gap-1">
          <Label htmlFor={`${uid}-max`}>{t("eqIntegration.acq.maxFrames", "Max frames (0 = until stopped)")}</Label>
          <Input id={`${uid}-max`} type="number" min={0} value={mockMaxFrames} onChange={(e) => setMockMaxFrames(e.target.value)} />
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1">
          <Label htmlFor={`${uid}-interval`}>{t("eqIntegration.acq.interval", "Interval (ms)")}</Label>
          <Input id={`${uid}-interval`} type="number" min={50} value={intervalMs} onChange={(e) => setIntervalMs(e.target.value)} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor={`${uid}-mc`}>{t("eqIntegration.machineCode", "Machine code")}</Label>
          <Input id={`${uid}-mc`} value={machineCode} placeholder="AOI-01" onChange={(e) => setMachineCode(e.target.value)} />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox checked={submit} onCheckedChange={(v) => setSubmit(Boolean(v))} />
        {t("eqIntegration.acq.submitFrames", "Submit each frame as a canonical NTF inspection (requires machine code)")}
      </label>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox checked={assessQuality} onCheckedChange={(v) => setAssessQuality(Boolean(v))} />
        {t("eqIntegration.acq.assessQuality", "Run image-quality metrics per frame")}
      </label>
      <SheetFooter>
        <Button variant="outline" onClick={() => layer.close()}>{t("common.cancel", "Cancel")}</Button>
        <Button onClick={doSubmit} disabled={pending}>
          {pending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
          <Play className="mr-1 h-4 w-4" />
          {t("eqIntegration.acq.start", "Start worker")}
        </Button>
      </SheetFooter>
    </div>
  );
}

// ── Sheet: record recipe load ──────────────────────────────────────────────────
function RecordLoadForm({
  version, machines, pending, onSubmit,
}: {
  version: RecipeVersion;
  machines: MachineRow[];
  pending: boolean;
  onSubmit: (v: RecordLoadInput, done: () => void) => void;
}) {
  const { t } = useTranslation();
  const { layer, done } = useCloseOwnLayer();
  const uid = useId();
  const initialMachine = version.machineId ?? null;
  const [machineId, setMachineId] = useState<number | null>(initialMachine);
  const [deploy, setDeploy] = useState(false);
  const [notes, setNotes] = useState("");

  const dirty = machineId !== initialMachine || deploy || notes !== "";
  useEffect(() => { layer.setDirty(dirty); }, [dirty]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = () => {
    if (!machineId) { toast.error(t("eqIntegration.machineRequired", "Select a machine.")); return; }
    onSubmit({ recipeId: version.id, machineId, deploy, notes: notes.trim() || undefined }, done);
  };

  return (
    <div className="grid gap-3">
      <div className="grid gap-1">
        <Label htmlFor={`${uid}-machine`}>{t("eqIntegration.machine", "Machine")}</Label>
        {/* U11 — Select DS; "__none__" là sentinel cho "chưa chọn máy". */}
        <Select value={machineId != null ? String(machineId) : "__none__"} onValueChange={(v) => setMachineId(v === "__none__" ? null : Number(v))}>
          <SelectTrigger id={`${uid}-machine`} className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">{t("eqIntegration.selectMachine", "Select a machine…")}</SelectItem>
            {machines.map((m) => <SelectItem key={m.id} value={String(m.id)}>{m.name ?? m.code} ({m.code})</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox checked={deploy} onCheckedChange={(v) => setDeploy(Boolean(v))} />
        {t("eqIntegration.alsoDeploy", "Also write a recipe_deployments ledger row")}
      </label>
      <div className="grid gap-1">
        <Label htmlFor={`${uid}-notes`}>{t("eqIntegration.notes", "Notes")}</Label>
        <Input id={`${uid}-notes`} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <SheetFooter>
        <Button variant="outline" onClick={() => layer.close()}>{t("common.cancel", "Cancel")}</Button>
        <Button onClick={submit} disabled={pending}><Send className="mr-1 h-4 w-4" />{t("eqIntegration.recordLoad", "Record load")}</Button>
      </SheetFooter>
    </div>
  );
}
