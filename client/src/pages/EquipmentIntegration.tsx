/**
 * I1 (doc 16 §6 / §15) — EQUIPMENT INTEGRATION surface (Khối 1B).
 *
 * Read-mostly cockpit over the equipmentIntegrationRouter:
 *   • Connector catalog (I1-a) — the FOCAS/Euromap integration FRAMEWORKS (honest status: a framework with
 *       no connected device says so; the Unified Equipment Model snapshot shows "—" when source:'none') and
 *       the adapter protocols REGISTERED in the server registry (registration ≠ a connected device).
 *   • (Đợt 3 Task 1) Recipe versions + load history (I1-b) MOVED to /recipes (tab "Phiên bản" row actions + tab
 *       "Lịch sử nạp"); `?tab=recipes|history` redirects there keeping the query (LegacyTabRedirectGate) — ONLY for users who
 *       can open /recipes (machine_control/canView AND the /recipes route licence, MOD_ENGINEERING). Final wave (Ruling
 *       R-3-h): users without the permission keep a read-only tab (R-3-b); users WITH it but without the licence (OT-only
 *       customers) keep the FULL former recipe capability here (tab "Phiên bản & lịch sử nạp": create / release / archive /
 *       rollback version, record load, load history — same procedures, payloads, gates as before Đợt 3 Task 1; Đợt 3b
 *       Task 2: archive now asks for the same confirmation as Recipes, gate unchanged).
 *   • (Đợt 3 Task 2) Acquisition workers (W8-C) MOVED to Vision › Thu ảnh (`/vision/acquisition`, pages/VisionAcquisition.tsx);
 *       `?tab=acquisition` redirects there keeping the query, for users who can open it (machine_alerts/canView).
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
 *  - MAIN (`data-layout-main`) = hàng tab (`?tab=` status [+ history chỉ-đọc, R-3-b]; thanh công cụ DUY NHẤT trong
 *    MAIN, bộ lọc/hành động của từng tab nằm cùng hàng) + nội dung tab:
 *      · status: catalog connector danh sách–chi tiết (`SplitListDetail`, `?connector=`).
 *  - Không thủ tục, input, cổng hay thông điệp lỗi nào đổi; mỗi lần xác nhận vẫn đúng MỘT lượt gọi như cũ (R-2-n).
 *
 * Doc 81 Đợt 3 Task 1 (doc 81 §11 "Đã chốt" 2026-10-05) — tab "Phiên bản recipe" và "Lịch sử nạp" DỜI sang Recipes:
 * phát hành / rollback phiên bản / ghi nhận nạp (cùng thủ tục, payload, cổng) ở hàng của tab Phiên bản; lịch sử nạp
 * theo mã/máy ở tab "Lịch sử nạp"; tạo phiên bản / lưu trữ dùng MỘT bộ với Recipes. `?tab=recipes|history` của trang
 * này chuyển hướng (REPLACE) sang `/recipes?tab=versions|history`, giữ nguyên văn mọi tham số khác.
 */
import { createContext, useContext, useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearch } from "wouter";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import { trpc } from "@/lib/trpc";
import { usePermissions } from "@/_core/hooks/usePermissions";
import { useAuth } from "@/_core/hooks/useAuth";
import { useLicenseModules } from "@/hooks/useLicenseModules";
import { toast } from "sonner";
import { mapTrpcError } from "@/lib/trpcErrors";
import { isFeatureDisabledError } from "@/lib/featureFlagError";
import DashboardLayout from "@/components/DashboardLayout";
import { ViewOnlyBadge } from "@/components/PermissionGate";
import {
  CockpitLayout,
  EmptyState,
  FeatureStatusNoticeChip,
  FlyoutHost,
  NoticeStack,
  PageContainer,
  RollbackConfirm,
  SplitListDetail,
  StatusBadge,
  StatusChipStrip,
  Text,
  VersionHistoryPanel,
  chipStateFromQuery,
  useCloseOwnLayer,
  useFlyout,
  useNarrowViewport,
  type FlyoutDefinition,
  type StatusChipItem,
  type VersionRow,
} from "@/components/patterns";
import { useUrlParam } from "@/components/patterns/useUrlParam";
import { LegacyTabRedirectGate, VISION_ACQUISITION_PATH } from "@/lib/engineeringLegacyRedirects";
import { LoadHistoryPanel, RecordLoadForm, type HistoryMode, type LoadLogRow, type LoadMachine, type RecordLoadInput } from "./RecipeLoadHistory";
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
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Plug, RefreshCw, AlertTriangle, Network,
  CircleSlash, History, Camera,
  Archive, CheckCircle2, Download, Plus, Rocket, Undo2,
} from "lucide-react";
import {
  deriveFeatureStatus,
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

type FrameworkKind = "focas" | "euromap";

// Đợt 3 Task 2 — tab "acquisition" dời sang Vision › Thu ảnh (`/vision/acquisition`).
const TAB_VALUES = ["status"] as const;
/**
 * Fix round 1 (R-3-b) — tab "Phiên bản & lịch sử nạp" cho người KHÔNG mở được /recipes. Final wave (R-3-h): "không mở
 * được" = thiếu QUYỀN (machine_control/canView) HOẶC thiếu GIẤY PHÉP route /recipes (MOD_ENGINEERING) — xem `useRecipesAccess`.
 */
const TAB_VALUES_READONLY = ["status", "history"] as const;
type TabValue = (typeof TAB_VALUES_READONLY)[number];
const BASE_PATH = "/equipment-integration";
const RECIPES_PATH = "/recipes";

/**
 * Final wave (Ruling R-3-h, "không ai mất quyền") — chế độ của tab phiên bản / lịch sử nạp trên Integration:
 *  - "none": mở được /recipes (QUYỀN + GIẤY PHÉP) ⇒ không có tab; `?tab=recipes|history` chuyển sang Recipes.
 *  - "readonly" (R-3-b, không đổi): không có machine_control/canView (vai seed operator/viewer) ⇒ chỉ xem.
 *  - "full": có machine_control/canView nhưng giấy phép KHÔNG gồm /recipes (khách chỉ mua MOD_OT_CONTROL) ⇒ GIỮ NGUYÊN
 *    năng lực recipe cũ của Integration trước Đợt 3 Task 1 (tạo / phát hành / lưu trữ / rollback phiên bản, ghi nhận nạp,
 *    lịch sử nạp) — cùng thủ tục, payload, cổng hiện (canCreate) / cổng bật (canEdit cho phát hành/rollback) như cũ.
 */
type RecipeMode = "none" | "readonly" | "full";

/**
 * R-3-h — "mở được /recipes" = cổng QUYỀN của chính route (RouteGuard navHref "/recipes" ⇒ machine_control/canView) VÀ
 * cổng GIẤY PHÉP theo route (`isRouteAllowed` của useLicenseModules — cùng vị từ mà thanh bên/⌘K lọc mục /recipes và
 * RouteGuard §1b dùng). Thiếu một trong hai ⇒ người dùng ở lại Integration với tab recipe của mình.
 */
function useRecipesAccess(): { canOpenRecipes: boolean; mode: RecipeMode } {
  const { hasPermission } = usePermissions();
  const { isRouteAllowed } = useLicenseModules();
  const permitted = hasPermission("machine_control", "canView");
  const canOpenRecipes = permitted && isRouteAllowed(RECIPES_PATH);
  return { canOpenRecipes, mode: canOpenRecipes ? "none" : permitted ? "full" : "readonly" };
}

type RecipeVersion = { id: number; code: string; name: string; version: number; payload: unknown; designStatus: string; machineId?: number | null; createdBy?: number | null; createdAt?: string | Date | null };
type CreateVersionInput = { code: string; name: string; payload: Record<string, unknown>; machineId?: number; notes?: string };

function pctOrDash(n: number | null): string {
  return n == null ? "—" : `${Math.round(n * 100)}%`;
}
function numOrDash(n: number | null): string {
  return n == null ? "—" : String(n);
}
function strOrDash(s: string | null): string {
  return s == null || s === "" ? "—" : s;
}

// ── Dữ liệu dùng chung cho các tab (TabbedHub: Content là ComponentType không nhận props) ──────
interface EqPageCtx {
  tab: TabValue;
  /** <1024 px: công cụ của tab nằm ĐẦU nội dung tab (hàng tab không đủ chỗ) — GC10. */
  narrow: boolean;
  canView: boolean;
  /** Mở được /recipes (quyền + giấy phép) ⇒ phiên bản/lịch sử nạp ở Recipes; không ⇒ tab ở đây (R-3-b / R-3-h). */
  canOpenRecipes: boolean;
  /** R-3-h — "readonly" (không machine_control) hoặc "full" (có quyền, thiếu giấy phép /recipes). */
  recipeMode: RecipeMode;
  /** Chế độ "full": hiện thao tác (machine_control/canCreate — cổng hiện cũ). */
  canControl: boolean;
  /** Chế độ "full": bật phát hành/rollback (machine_control/canEdit — cổng cũ, doc 80 Task 3). */
  canRelease: boolean;
  /** Cờ EQ_INTEG chưa rõ (đang kiểm tra / lỗi) ⇒ nút "Phiên bản mới" khoá như cũ. */
  flagUnsettled: boolean;
  release: (v: RecipeVersion) => void;
  archive: (v: RecipeVersion) => void;
  rollback: (v: RecipeVersion) => void;
  releasePending: boolean;
  archivePending: boolean;
  rollbackPending: boolean;
  recordLoadPending: boolean;
  /** Ô mã recipe của tab chỉ-đọc (theo `?code=`). */
  roCode: string;
  setRoCode: (v: string) => void;
  userId: number | null;
  /** R-3-d — mở được Vision › Thu ảnh (machine_alerts/canView, cổng của trang đó) ⇒ link "Worker thu ảnh → …". */
  canViewAcq: boolean;
  integration: IntegrationStatus | undefined;
  integrationLoading: boolean;
  integrationError: boolean;
  connector: string | null;
  setConnector: (v: string | null) => void;
}
const EqCtx = createContext<EqPageCtx | null>(null);
function useEqCtx(): EqPageCtx {
  const v = useContext(EqCtx);
  if (!v) throw new Error("EqCtx missing");
  return v;
}

const TAB_STATUS: TabbedHubTab = { value: "status", labelKey: "eqIntegration.tab.status", fallback: "Connector catalog", icon: <Network className="h-4 w-4" />, Content: CatalogTab };
const TAB_READONLY: TabbedHubTab = { value: "history", labelKey: "eqIntegration.tab.readonlyHistory", fallback: "Versions & load history (view only)", icon: <History className="h-4 w-4" />, Content: RecipeHistoryTab };
// R-3-h — cùng tab (cùng `?tab=history`), nhãn không có "(chỉ xem)" vì người dùng này có thao tác.
const TAB_FULL: TabbedHubTab = { value: "history", labelKey: "eqIntegration.tab.recipeHistory", fallback: "Versions & load history", icon: <History className="h-4 w-4" />, Content: RecipeHistoryTab };
const TABS: readonly TabbedHubTab[] = [TAB_STATUS];
const TABS_READONLY: readonly TabbedHubTab[] = [TAB_STATUS, TAB_READONLY];
const TABS_FULL: readonly TabbedHubTab[] = [TAB_STATUS, TAB_FULL];

/**
 * Đợt 3 Task 1 — `?tab=recipes|history` (đã dời sang Recipes) ⇒ REPLACE sang `/recipes?tab=versions|history`, giữ query
 * (lib/engineeringLegacyRedirects.tsx); tab còn lại dựng trang như cũ.
 */
// Fix round 1 (Ruling R-3-b) — CHỈ chuyển người dùng mở được /recipes (machine_control/canView, cùng `canView` của
// RecipeManagement). Người không có (vai seed operator/viewer) ở lại và thấy tab CHỈ-ĐỌC (phiên bản không thao tác + lịch
// sử nạp) — cùng thủ tục đọc cũ (machine_monitoring/canView); quyền phía server không đổi.
// Đợt 3 Task 2 — `?tab=acquisition` ⇒ `/vision/acquisition` (giữ query, bỏ `tab`) CHỈ cho người mở được trang đó
// (machine_alerts/canView — cổng QĐ-3c của trang mới); người không có ở lại đây (tab catalog), không bị đẩy vào trang từ chối.
// Final wave (Ruling R-3-h) — "mở được /recipes" gồm cả GIẤY PHÉP route (/recipes thuộc MOD_ENGINEERING, Integration thuộc
// MOD_OT_CONTROL): khách chỉ có OT ở lại đây với đủ năng lực recipe cũ (chế độ "full"), không bị đẩy vào khoá giấy phép.
export default function EquipmentIntegration() {
  const { hasPermission } = usePermissions();
  const { canOpenRecipes } = useRecipesAccess();
  const canViewAcq = hasPermission("machine_alerts", "canView");
  return (
    <LegacyTabRedirectGate from={BASE_PATH} when={(r) => (r.to === VISION_ACQUISITION_PATH ? canViewAcq : canOpenRecipes)}>
      <EquipmentIntegrationPage />
    </LegacyTabRedirectGate>
  );
}

function EquipmentIntegrationPage() {
  const { t } = useTranslation();
  const { hasPermission } = usePermissions();
  const { user } = useAuth();
  const canView = hasPermission("machine_monitoring", "canView");
  // "Chỉ xem" (machine_control/canCreate) — huy hiệu header giữ như cũ.
  const canControl = hasPermission("machine_control", "canCreate");
  // doc 80 Task 3 — phát hành/rollback: machine_control/canEdit (cổng server actuationProcedure + canEdit), như cũ.
  const canRelease = hasPermission("machine_control", "canEdit");
  const { canOpenRecipes, mode: recipeMode } = useRecipesAccess();
  const full = recipeMode === "full";
  const canViewAcq = hasPermission("machine_alerts", "canView");

  const search = useSearch();
  const tab = resolveActiveTab(search, canOpenRecipes ? TAB_VALUES : TAB_VALUES_READONLY, "status") as TabValue;
  // R-3-b — người xem chỉ-đọc đến bằng `?tab=recipes` (giá trị cũ) ⇒ tab chỉ-đọc (thay giá trị, giữ tham số khác).
  const [tabParam, setTabParam] = useUrlParam("tab");
  useEffect(() => {
    if (!canOpenRecipes && tabParam === "recipes") setTabParam("history");
  }, [canOpenRecipes, tabParam]); // eslint-disable-line react-hooks/exhaustive-deps
  const [codeParam] = useUrlParam("code");
  const [roCode, setRoCode] = useState(() => codeParam ?? "");
  useEffect(() => {
    setRoCode(codeParam ?? "");
  }, [codeParam]);
  const narrow = useNarrowViewport();
  const [connector, setConnector] = useUrlParam("connector");

  const utils = trpc.useUtils();

  // ── Reads (RBAC: machine_monitoring/canView) ────────────────────────────────
  const statusQ = trpc.equipmentIntegration.status.useQuery(undefined, { enabled: canView });
  const integrationQ = trpc.equipmentIntegration.integrationStatus.useQuery(undefined, { enabled: canView });

  const integration = integrationQ.data as IntegrationStatus | undefined;

  // Doc 80 Task 1 (PLT-02/G-07/X-07): pending/erroring status query is UNKNOWN, not "on".
  const flagStatus = deriveFeatureStatus(statusQ, (d: { enabled?: boolean }) => d.enabled);

  const configuredCount = useMemo(
    () => (integration?.frameworks ?? []).filter((f) => f.configured).length,
    [integration],
  );

  const refetchAll = () => {
    void utils.equipmentIntegration.status.invalidate();
    void utils.equipmentIntegration.integrationStatus.invalidate();
  };

  // ── R-3-h — chế độ "full" (có machine_control, giấy phép không gồm /recipes): năng lực recipe CŨ của trang, nguyên văn ──
  // Cùng 5 mutation, cùng payload, cùng bộ invalidate (`refetchAll` cũ: status, integrationStatus, listRecipeVersions,
  // listLoadHistory, listCodeHistory), cùng xử lý lỗi (cờ TẮT ⇒ toast.info bình tĩnh + đọc lại cờ; lỗi khác ⇒ toast đỏ).
  const flagUnsettled = isFeatureStatusUnsettled(flagStatus);
  const [flyoutParam] = useUrlParam("flyout");
  const sheetOpen = full && canControl && (flyoutParam === "eq-recipe-new" || flyoutParam === "eq-recipe-load");
  // Sheet cần danh sách máy (nguồn cũ `machine.list`) và — với ghi nhận nạp — phiên bản của mã đang xem (`?code=`).
  const sheetMachinesQ = trpc.machine.list.useQuery(undefined, { enabled: canView && sheetOpen });
  const sheetVersionsQ = trpc.equipmentIntegration.listRecipeVersions.useQuery(
    { code: codeParam ?? "" },
    { enabled: canView && sheetOpen && flyoutParam === "eq-recipe-load" && !!codeParam, retry: false },
  );
  const refetchRecipes = () => {
    refetchAll();
    void utils.equipmentIntegration.listRecipeVersions.invalidate();
    void utils.equipmentIntegration.listLoadHistory.invalidate();
    void utils.equipmentIntegration.listCodeHistory.invalidate();
  };
  const onMutationError = (e: unknown) => {
    if (isFeatureDisabledError(e)) {
      // Final wave (GC6) — câu KHÔNG mang tên biến môi trường (câu cũ có "EQ_INTEG_ENABLED=true").
      toast.info(t("eqIntegration.flagOffToast", "Equipment integration is disabled (preview) — this action is blocked until it is enabled."));
      void utils.equipmentIntegration.status.invalidate();
    } else {
      toast.error(mapTrpcError(e));
    }
  };
  // Toast + invalidate ở hook TRANG (chạy cả khi sheet đã đóng trong lúc chờ); sheet tự đóng qua callback lượt gọi.
  const createM = trpc.equipmentIntegration.createRecipeVersion.useMutation({
    onSuccess: () => { toast.success(t("eqIntegration.versionCreated", "Recipe version created (draft)")); refetchRecipes(); },
    onError: (e) => onMutationError(e),
  });
  const releaseM = trpc.equipmentIntegration.releaseRecipeVersion.useMutation({
    onSuccess: () => { toast.success(t("eqIntegration.versionReleased", "Version released")); refetchRecipes(); },
    onError: (e) => onMutationError(e),
  });
  const archiveM = trpc.equipmentIntegration.archiveRecipeVersion.useMutation({
    onSuccess: () => { toast.success(t("eqIntegration.versionArchived", "Version archived")); refetchRecipes(); },
    onError: (e) => onMutationError(e),
  });
  const rollbackM = trpc.equipmentIntegration.rollbackRecipeVersion.useMutation({
    onSuccess: () => { toast.success(t("eqIntegration.versionRolledBack", "Released contract rolled back")); refetchRecipes(); },
    onError: (e) => onMutationError(e),
  });
  const recordLoadM = trpc.equipmentIntegration.recordRecipeLoad.useMutation({
    onSuccess: () => { toast.success(t("eqIntegration.loadRecorded", "Recipe load recorded (genealogy)")); refetchRecipes(); },
    onError: (e) => onMutationError(e),
  });

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
    canOpenRecipes,
    recipeMode,
    canControl,
    canRelease,
    flagUnsettled,
    release: (v) => releaseM.mutate({ recipeId: v.id }),
    archive: (v) => archiveM.mutate({ recipeId: v.id }),
    rollback: (v) => rollbackM.mutate({ toRecipeId: v.id }),
    releasePending: releaseM.isPending,
    archivePending: archiveM.isPending,
    rollbackPending: rollbackM.isPending,
    recordLoadPending: recordLoadM.isPending,
    roCode,
    setRoCode,
    userId: user?.id ?? null,
    canViewAcq,
    integration,
    integrationLoading: integrationQ.isLoading,
    integrationError: integrationQ.isError,
    connector,
    setConnector,
  };

  // ── Flyouts (một stack sheet phải; URL `?flyout=&flyoutId=` là nguồn sự thật). Đợt 3 Task 2: sheet khởi động worker
  // ("acq-start") dời sang Vision › Thu ảnh. R-3-h: chế độ "full" giữ hai sheet recipe cũ (cùng khoá, cùng cổng canCreate).
  const flyouts: Record<string, FlyoutDefinition> = {};
  if (full && canControl) {
    const machines = (sheetMachinesQ.data ?? []) as LoadMachine[];
    const sheetVersions = ((sheetVersionsQ.data as { versions?: RecipeVersion[] } | undefined)?.versions ?? []) as RecipeVersion[];
    const findVersion = (id: string | null) =>
      id != null && /^\d+$/.test(id) ? sheetVersions.find((v) => v.id === Number(id)) ?? null : null;
    flyouts["eq-recipe-new"] = {
      size: "md",
      title: t("eqIntegration.createTitle", "New recipe version (draft)"),
      description: t("eqIntegration.createDesc", "Immutable draft version — genealogy metadata only; nothing is pushed to a device."),
      // Như cũ: cờ CHƯA RÕ (đang kiểm tra / lỗi) ⇒ sheet chỉ báo trạng thái, không form (cả deep link / F5). Cờ TẮT (đã rõ)
      // ⇒ form như cũ (server trả CONFLICT ⇒ toast.info).
      render: () => flagUnsettled ? (
        flagStatus === "error" ? (
          <p role="alert" className="py-6 text-center text-sm text-destructive">
            {t("eqIntegration.flagStatusError", "Could not check whether equipment integration is enabled — actions are disabled until this is confirmed.")}
          </p>
        ) : (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {t("common.gate.checkingStatus", "Checking feature status…")}
          </p>
        )
      ) : (
        <CreateVersionForm
          defaultCode={codeParam ?? roCode}
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
              {sheetVersionsQ.isLoading
                ? t("eqIntegration.loading", "Loading…")
                : t("eqIntegration.versionNotFound", "Version #{{id}} is not in the loaded recipe code.", { id: layer.id ?? "" })}
            </p>
          );
        }
        // Sheet DÙNG CHUNG với Recipes (RecipeLoadHistory.tsx): MỘT phiên bản, MỘT máy, MỘT lượt recordRecipeLoad.
        return (
          <RecordLoadForm
            key={v.id}
            version={v}
            machines={machines}
            pending={recordLoadM.isPending}
            onSubmit={(input: RecordLoadInput, done, fail) => recordLoadM.mutate(input, { onSuccess: done, onError: (e) => fail(e) })}
          />
        );
      },
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
      // loading/error: chip tự in chữ trạng thái chung (StatusChipStrip) — không in số/nhãn bật-tắt.
      value: flagStatus === "on" ? t("eqIntegration.on", "On") : flagStatus === "off" ? t("eqIntegration.off", "Off") : undefined,
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
                    offMessage={
                      full
                        ? t(
                            // R-3-h — người dùng chế độ "full" có các thao tác NGAY TRÊN trang này (không phải "nay ở Recipes").
                            "eqIntegration.flagOffBannerHere",
                            "Preview mode: equipment integration is disabled. Reads work; recipe version actions on this page (create / release / archive / roll back, record a load) are blocked until it is enabled.",
                          )
                        : t(
                            "eqIntegration.flagOffBanner",
                            "Preview mode: equipment integration is disabled. Reads work; actions (create / release / archive / rollback version, record load) are blocked until it is enabled.",
                          )
                    }
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
              tabs={recipeMode === "none" ? TABS : recipeMode === "full" ? TABS_FULL : TABS_READONLY}
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
  return (
    <>
      {ctx.tab === "history" && !ctx.canOpenRecipes ? <RecipeHistoryToolbar /> : <CatalogToolbar />}
      {ctx.canViewAcq && <AcquisitionMovedLink />}
    </>
  );
}

/**
 * Đợt 3 Task 2 fix round 1 (Ruling R-3-d) — chỗ CŨ trỏ tới chỗ MỚI: worker thu ảnh đã dời sang Vision › Thu ảnh. Hiện ở mọi
 * tab, chỉ cho người mở được trang đó (machine_alerts/canView). Integration thuộc MOD_OT_CONTROL nên khách chỉ có OT (ô AI
 * của launcher là upsell) luôn có lối nhìn thấy được tới trang.
 */
function AcquisitionMovedLink() {
  const { t } = useTranslation();
  return (
    <Button asChild size="sm" variant="outline" className="h-8">
      <Link href={VISION_ACQUISITION_PATH} data-acq-moved-link="">
        <Camera className="mr-1 h-4 w-4" aria-hidden="true" />
        {t("eqIntegration.acqMoved", "Acquisition workers → Vision › Image acquisition")}
      </Link>
    </Button>
  );
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

// ════════ Fix round 1 (R-3-b) / final wave (R-3-h) — tab "Phiên bản & lịch sử nạp" (người không mở được /recipes) ════════
// Cùng thủ tục đọc cũ của Integration (machine_monitoring/canView): listRecipeVersions / listCodeHistory /
// listLoadHistory / machine.list.
//  - "readonly" (R-3-b): KHÔNG một nút thao tác nào (không tạo/phát hành/lưu trữ/rollback/ghi nhận nạp).
//  - "full" (R-3-h): thao tác phiên bản như tab "Phiên bản recipe" cũ — cổng hiện machine_control/canCreate, phát hành/
//    rollback bật theo machine_control/canEdit, lưu trữ qua hộp xác nhận như Recipes (Đợt 3b Task 2), rollback = RollbackConfirm không lý do/không OTP (R-2-g),
//    ghi nhận nạp = sheet dùng chung `eq-recipe-load`; "Phiên bản mới" = sheet `eq-recipe-new` (khoá khi cờ chưa rõ).
type RoMachine = { id: number; code?: string | null; name?: string | null };

function RecipeHistoryToolbar() {
  const { t } = useTranslation();
  const ctx = useEqCtx();
  const flyout = useFlyout();
  const [, setCode] = useUrlParam("code");
  const [machineParam, setMachineParam] = useUrlParam("machineId");
  const machinesQ = trpc.machine.list.useQuery(undefined, { enabled: ctx.canView });
  const machines = (machinesQ.data ?? []) as RoMachine[];
  const actions = ctx.recipeMode === "full" && ctx.canControl;
  const run = () => {
    const c = ctx.roCode.trim();
    if (c) setCode(c);
  };
  return (
    <>
      <Input
        className="h-8 w-28"
        value={ctx.roCode}
        placeholder="RCP-001"
        aria-label={t("eqIntegration.recipeCode", "Recipe code")}
        onChange={(e) => ctx.setRoCode(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") run(); }}
      />
      <Button variant="outline" size="sm" className="h-8" disabled={!ctx.roCode.trim()} onClick={run}>
        {t("eqIntegration.loadVersions", "Load versions")}
      </Button>
      {actions && (
        <Button
          size="sm" variant="outline" className="h-8"
          disabled={ctx.flagUnsettled}
          title={ctx.flagUnsettled ? t("common.gate.checkingStatus", "Checking feature status…") : undefined}
          onClick={() => flyout.open("eq-recipe-new")}
        >
          <Plus className="mr-1 h-4 w-4" />{t("eqIntegration.createVersion", "New version")}
        </Button>
      )}
      {/* U11 — Select DS; "__none__" là sentinel cho "chưa chọn máy". */}
      <Select value={machineParam && /^\d+$/.test(machineParam) ? machineParam : "__none__"} onValueChange={(v) => setMachineParam(v === "__none__" ? null : v)}>
        <SelectTrigger className="h-8 w-56" aria-label={t("eqIntegration.machine", "Machine")}><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="__none__">{t("eqIntegration.selectMachine", "Select a machine…")}</SelectItem>
          {machines.map((m) => (
            <SelectItem key={m.id} value={String(m.id)}>{m.name ?? m.code} ({m.code})</SelectItem>
          ))}
        </SelectContent>
      </Select>
      {!actions && <Badge variant="outline" className="text-muted-foreground">{t("eqIntegration.viewOnly", "View only")}</Badge>}
    </>
  );
}

function RecipeHistoryTab() {
  const { t } = useTranslation();
  const ctx = useEqCtx();
  const flyout = useFlyout();
  const [codeParam] = useUrlParam("code");
  const [machineParam] = useUrlParam("machineId");
  const code = codeParam != null && codeParam !== "" ? codeParam : null;
  const machineId = machineParam != null && /^\d+$/.test(machineParam) ? Number(machineParam) : null;
  const [modePick, setModePick] = useState<HistoryMode | null>(null);
  const mode: HistoryMode = modePick ?? (code != null ? "code" : "machine");
  const full = ctx.recipeMode === "full";

  const machinesQ = trpc.machine.list.useQuery(undefined, { enabled: ctx.canView });
  const versionsQ = trpc.equipmentIntegration.listRecipeVersions.useQuery({ code: code ?? "" }, { enabled: ctx.canView && code != null, retry: false });
  const loadHistoryQ = trpc.equipmentIntegration.listLoadHistory.useQuery(
    { machineId: machineId ?? 0, limit: 200 },
    { enabled: ctx.canView && mode === "machine" && machineId != null, retry: false },
  );
  const codeHistoryQ = trpc.equipmentIntegration.listCodeHistory.useQuery(
    { code: code ?? "", limit: 200 },
    { enabled: ctx.canView && mode === "code" && code != null, retry: false },
  );
  const historyQ = mode === "machine" ? loadHistoryQ : codeHistoryQ;
  const machines = (machinesQ.data ?? []) as RoMachine[];
  const machineLabel = (id: number) => {
    const m = machines.find((x) => x.id === id);
    return m ? (m.name ?? m.code ?? `#${id}`) : `#${id}`;
  };
  const versions = ((versionsQ.data as { versions?: RecipeVersion[] } | undefined)?.versions ?? []) as RecipeVersion[];
  const rows: VersionRow[] = versions.map((v) => ({
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
  const released = versions.find((v) => v.designStatus === "released");
  const byId = new Map(versions.map((v) => [v.id, v]));
  const needsEdit = t("eqIntegration.needsEditPermission", "Needs edit permission (machine_control/canEdit) to release/rollback.");

  // R-3-h — hàng thao tác của tab "Phiên bản recipe" cũ (chỉ chế độ "full"; "readonly" KHÔNG renderRowActions ⇒ không cột).
  const renderRowActions = (row: VersionRow): ReactNode => {
    const v = byId.get(Number(row.id));
    if (!v) return null;
    if (!ctx.canControl) return <span className="text-xs text-muted-foreground">{t("eqIntegration.viewOnly", "View only")}</span>;
    return (
      <div className="flex justify-end gap-1">
        {v.designStatus === "draft" && (
          <Button size="icon" variant="ghost" className="h-8 w-8" disabled={ctx.releasePending || !ctx.canRelease}
            aria-label={t("eqIntegration.release", "Release")}
            title={ctx.canRelease ? t("eqIntegration.releaseTip", "Release this version (archives the current released one)") : needsEdit}
            onClick={() => ctx.release(v)}>
            <Rocket className="h-4 w-4 text-emerald-500" />
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
              <Button size="icon" variant="ghost" className="h-8 w-8" disabled={ctx.rollbackPending || !ctx.canRelease}
                aria-label={t("eqIntegration.rollback", "Rollback")}
                title={ctx.canRelease ? t("eqIntegration.rollbackTip", "Roll the released contract back to this version") : needsEdit}>
                <Undo2 className="h-4 w-4" />
              </Button>
            }
          />
        )}
        {v.designStatus !== "archived" && (
          // Đợt 3b Task 2 (c) — chủ dự án 2026-10-06 "thống nhất lưu trữ recipe cần xác nhận": CÙNG bước xác nhận như
          // Recipes (AlertDialog: tiêu đề `recipes.archive`, câu `recipes.confirmArchive`, Hủy / Lưu trữ). Cổng hiện/bật
          // KHÔNG đổi (canCreate qua `ctx.canControl`, chỉ khoá khi đang gửi); payload {recipeId} + invalidate KHÔNG đổi.
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="icon" variant="ghost" className="h-8 w-8" disabled={ctx.archivePending}
                aria-label={t("eqIntegration.archive", "Archive")}
                title={t("eqIntegration.archiveTip", "Archive this version")}>
                <Archive className="h-4 w-4" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t("recipes.archive")}</AlertDialogTitle>
                <AlertDialogDescription>{t("recipes.confirmArchive", { version: v.version })}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t("recipes.cancel")}</AlertDialogCancel>
                <AlertDialogAction onClick={() => ctx.archive(v)}>{t("recipes.archive")}</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
        <Button size="icon" variant="ghost" className="h-8 w-8" disabled={ctx.recordLoadPending}
          aria-label={t("eqIntegration.recordLoad", "Record load")}
          title={t("eqIntegration.loadTip", "Record that this version was loaded onto a machine (genealogy)")}
          onClick={() => flyout.open("eq-recipe-load", { id: v.id })}>
          <Download className="h-4 w-4" />
        </Button>
      </div>
    );
  };

  const pickCode = full
    ? t("eqIntegration.recipeTab.pickCode", "Enter a recipe code above to see its versions, version actions and load history.")
    : t("eqIntegration.readonly.pickCode", "Enter a recipe code above to see its versions and load history (view only).");
  return (
    <div {...(full ? { "data-recipe-history": "full" } : { "data-readonly-history": "" })} className="space-y-4">
      {ctx.narrow && <NarrowTools />}
      {code == null ? (
        <p className="text-sm text-muted-foreground">{pickCode}</p>
      ) : (
        // "readonly": KHÔNG renderRowActions ⇒ không cột thao tác, không nút nào trên hàng phiên bản.
        <VersionHistoryPanel
          title={t("eqIntegration.versionsTitle", "Versions of {{code}}").replace("{{code}}", code)}
          versions={rows}
          status={versionsQ.isError ? "error" : versionsQ.isLoading ? "loading" : "ready"}
          defaultBaseId={released?.id ?? null}
          diffMaxHeightClass="max-h-[40vh]"
          {...(full ? { renderRowActions } : {})}
        />
      )}
      <LoadHistoryPanel
        mode={mode}
        onModeChange={setModePick}
        code={code}
        machineId={machineId}
        machineLabel={machineLabel}
        canRead={ctx.canView}
        rows={(historyQ.data ?? []) as LoadLogRow[]}
        loading={historyQ.isFetching}
        error={historyQ.isError}
        onRetry={() => void historyQ.refetch()}
        pickCodeText={pickCode}
        pickMachineText={t("eqIntegration.readonly.pickMachine", "Select a machine above to see its load history.")}
      />
    </div>
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
        heightClass="h-[calc(100dvh_-_var(--shell-chrome-h,3.5rem)_-_9.5rem)] min-h-[22rem]"
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

// ── R-3-h — sheet "Phiên bản mới" (chế độ "full"): khôi phục NGUYÊN form cũ của Integration trước Đợt 3 Task 1 ─────────
// `equipmentIntegration.createRecipeVersion` (machine_control/canCreate + EQ_INTEG_ENABLED), payload
// `{ code, name, payload, machineId?, notes? }`, cùng kiểm tra "Mã và tên là bắt buộc." / JSON object.
function SheetFooter({ children }: { children: ReactNode }) {
  return <div className="flex justify-end gap-2 border-t pt-3">{children}</div>;
}

function CreateVersionForm({
  defaultCode, machines, pending, onSubmit,
}: {
  defaultCode: string;
  machines: LoadMachine[];
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
