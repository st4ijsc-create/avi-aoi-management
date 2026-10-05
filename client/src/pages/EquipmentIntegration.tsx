/**
 * I1 (doc 16 §6 / §15) — EQUIPMENT INTEGRATION surface (Khối 1B).
 *
 * Read-mostly cockpit over the equipmentIntegrationRouter:
 *   • Connector catalog (I1-a) — the FOCAS/Euromap integration FRAMEWORKS (honest status: a framework with
 *       no connected device says so; the Unified Equipment Model snapshot shows "—" when source:'none') and
 *       the adapter protocols REGISTERED in the server registry (registration ≠ a connected device).
 *   • (Đợt 3 Task 1) Recipe versions + load history (I1-b) MOVED to /recipes (tab "Phiên bản" row actions + tab
 *       "Lịch sử nạp"); `?tab=recipes|history` redirects there keeping the query (LegacyTabRedirectGate).
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
import { createContext, useContext, useEffect, useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearch } from "wouter";
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
  NoticeStack,
  PageContainer,
  SplitListDetail,
  StatusBadge,
  StatusChipStrip,
  Text,
  VersionHistoryPanel,
  chipStateFromQuery,
  useNarrowViewport,
  type FlyoutDefinition,
  type StatusChipItem,
  type VersionRow,
} from "@/components/patterns";
import { useUrlParam } from "@/components/patterns/useUrlParam";
import { LegacyTabRedirectGate, VISION_ACQUISITION_PATH } from "@/lib/engineeringLegacyRedirects";
import { LoadHistoryPanel, type HistoryMode, type LoadLogRow } from "./RecipeLoadHistory";
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
  Plug, RefreshCw, AlertTriangle, Network,
  CircleSlash, History,
} from "lucide-react";
import {
  deriveFeatureStatus,
  featureStatusTone,
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
/** Fix round 1 (R-3-b) — tab CHỈ-ĐỌC "Phiên bản & lịch sử nạp" cho người KHÔNG mở được /recipes (machine_control/canView). */
const TAB_VALUES_READONLY = ["status", "history"] as const;
type TabValue = (typeof TAB_VALUES_READONLY)[number];
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

// ── Dữ liệu dùng chung cho các tab (TabbedHub: Content là ComponentType không nhận props) ──────
interface EqPageCtx {
  tab: TabValue;
  /** <1024 px: công cụ của tab nằm ĐẦU nội dung tab (hàng tab không đủ chỗ) — GC10. */
  narrow: boolean;
  canView: boolean;
  /** Mở được /recipes (machine_control/canView) ⇒ phiên bản/lịch sử nạp ở Recipes; không ⇒ tab chỉ-đọc ở đây (R-3-b). */
  canOpenRecipes: boolean;
  /** Ô mã recipe của tab chỉ-đọc (theo `?code=`). */
  roCode: string;
  setRoCode: (v: string) => void;
  userId: number | null;
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
const TAB_READONLY: TabbedHubTab = { value: "history", labelKey: "eqIntegration.tab.readonlyHistory", fallback: "Versions & load history (view only)", icon: <History className="h-4 w-4" />, Content: ReadOnlyHistoryTab };
const TABS: readonly TabbedHubTab[] = [TAB_STATUS];
const TABS_READONLY: readonly TabbedHubTab[] = [TAB_STATUS, TAB_READONLY];

/**
 * Đợt 3 Task 1 — `?tab=recipes|history` (đã dời sang Recipes) ⇒ REPLACE sang `/recipes?tab=versions|history`, giữ query
 * (lib/engineeringLegacyRedirects.tsx); tab còn lại dựng trang như cũ.
 */
// Fix round 1 (Ruling R-3-b) — CHỈ chuyển người dùng mở được /recipes (machine_control/canView, cùng `canView` của
// RecipeManagement). Người không có (vai seed operator/viewer) ở lại và thấy tab CHỈ-ĐỌC (phiên bản không thao tác + lịch
// sử nạp) — cùng thủ tục đọc cũ (machine_monitoring/canView); quyền phía server không đổi.
// Đợt 3 Task 2 — `?tab=acquisition` ⇒ `/vision/acquisition` (giữ query, bỏ `tab`) CHỈ cho người mở được trang đó
// (machine_alerts/canView — cổng QĐ-3c của trang mới); người không có ở lại đây (tab catalog), không bị đẩy vào trang từ chối.
export default function EquipmentIntegration() {
  const { hasPermission } = usePermissions();
  const canOpenRecipes = hasPermission("machine_control", "canView");
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
  const canOpenRecipes = hasPermission("machine_control", "canView");

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
    roCode,
    setRoCode,
    userId: user?.id ?? null,
    integration,
    integrationLoading: integrationQ.isLoading,
    integrationError: integrationQ.isError,
    connector,
    setConnector,
  };

  // ── Flyouts (một stack sheet phải; URL `?flyout=&flyoutId=` là nguồn sự thật). Đợt 3 Task 2: sheet khởi động worker
  // ("acq-start") dời sang Vision › Thu ảnh — trang này không còn flyout nào.
  const flyouts: Record<string, FlyoutDefinition> = {};

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
              tabs={canOpenRecipes ? TABS : TABS_READONLY}
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
  if (ctx.tab === "history" && !ctx.canOpenRecipes) return <ReadOnlyHistoryToolbar />;
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

// ════════ Fix round 1 (R-3-b) — tab CHỈ-ĐỌC "Phiên bản & lịch sử nạp" (người không mở được /recipes) ════════
// Cùng thủ tục đọc cũ của Integration (machine_monitoring/canView): listRecipeVersions / listCodeHistory /
// listLoadHistory / machine.list. KHÔNG một nút thao tác nào (không tạo/phát hành/lưu trữ/rollback/ghi nhận nạp).
type RoMachine = { id: number; code?: string | null; name?: string | null };

function ReadOnlyHistoryToolbar() {
  const { t } = useTranslation();
  const ctx = useEqCtx();
  const [, setCode] = useUrlParam("code");
  const [machineParam, setMachineParam] = useUrlParam("machineId");
  const machinesQ = trpc.machine.list.useQuery(undefined, { enabled: ctx.canView });
  const machines = (machinesQ.data ?? []) as RoMachine[];
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
      <Badge variant="outline" className="text-muted-foreground">{t("eqIntegration.viewOnly", "View only")}</Badge>
    </>
  );
}

type RoVersion = { id: number; code: string; name: string; version: number; payload: unknown; designStatus: string; createdBy?: number | null; createdAt?: string | Date | null };

function ReadOnlyHistoryTab() {
  const { t } = useTranslation();
  const ctx = useEqCtx();
  const [codeParam] = useUrlParam("code");
  const [machineParam] = useUrlParam("machineId");
  const code = codeParam != null && codeParam !== "" ? codeParam : null;
  const machineId = machineParam != null && /^\d+$/.test(machineParam) ? Number(machineParam) : null;
  const [modePick, setModePick] = useState<HistoryMode | null>(null);
  const mode: HistoryMode = modePick ?? (code != null ? "code" : "machine");

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
  const versions = ((versionsQ.data as { versions?: RoVersion[] } | undefined)?.versions ?? []) as RoVersion[];
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

  return (
    <div data-readonly-history="" className="space-y-4">
      {ctx.narrow && <NarrowTools />}
      {code == null ? (
        <p className="text-sm text-muted-foreground">
          {t("eqIntegration.readonly.pickCode", "Enter a recipe code above to see its versions and load history (view only).")}
        </p>
      ) : (
        // KHÔNG renderRowActions ⇒ không cột thao tác, không nút nào trên hàng phiên bản.
        <VersionHistoryPanel
          title={t("eqIntegration.versionsTitle", "Versions of {{code}}").replace("{{code}}", code)}
          versions={rows}
          status={versionsQ.isError ? "error" : versionsQ.isLoading ? "loading" : "ready"}
          defaultBaseId={released?.id ?? null}
          diffMaxHeightClass="max-h-[40vh]"
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
        pickCodeText={t("eqIntegration.readonly.pickCode", "Enter a recipe code above to see its versions and load history (view only).")}
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
