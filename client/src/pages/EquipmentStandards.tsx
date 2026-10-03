/**
 * E1 (doc 16 §10 / §12) — EQUIPMENT STANDARDS & GOVERNANCE surface (Khối 5).
 *
 * Read-mostly governance cockpit over the equipmentStandardsRouter, organised into tabs (`?tab=`, old values):
 *   • "hierarchy" (E1-a)  — versioned Device Type tree + fully-merged detail (resolveType). Register type (gated).
 *   • "alarms" (E1-b)     — ISA-18.2 alarm mappings table + vendor/native lookup (mapAlarm) + upsert (gated).
 *   • "alarmPerf" (W5-21) — EEMUA-191 alarm KPIs (one source: alarmKpi.summary) + master alarm DB (rationalization).
 *   • "crs" (E1-c)        — Equipment Standards Board change requests: review / approve / reject / publish.
 *   • "compliance" (E1-e + E1-d) — complianceMetrics detail + a "run conformance" action.
 *
 * Doc 81 Đợt 2 Task 9 — mẫu P3/P4 (`CockpitLayout`):
 *  - Header một hàng: h1 · chip cờ (4 trạng thái của FeatureStatusGate) · chip LỖI "N loại không đạt" (thay khối đỏ) ·
 *    `StatusChipStrip` (thay 5 MetricCard; MỖI chip ghi thủ tục nguồn; số liên quan cảnh báo GHIM — R-2-p) ·
 *    "Khi nào dùng" + "Chỉ metadata" (câu an toàn cũ) · làm mới.
 *  - MAIN (`data-layout-main`) = hàng tab (thanh công cụ DUY NHẤT; công cụ của tab đang mở nằm cùng hàng) + nội dung:
 *      hierarchy  → `SplitListDetail`: cây (role=tree) | chi tiết đã phân giải, chọn qua `?typeKey=` (F5 / deep link).
 *      alarms     → `DataTable` PHÂN TRANG (FE1: 185 dòng không phân trang ⇒ trang cao 8,3×). Chuẩn hoá = SHEET.
 *      alarmPerf  → bảng cảnh báo chuẩn (DataTable phân trang); KPI là chip có nguồn ở PANEL PHỤ (ngoài MAIN).
 *                   Chattering vẫn "Chưa đo được" (nguồn chung chưa tính). Shelve vẫn KHOÁ (STD-02).
 *      crs        → `ApprovalQueue` dùng chung với ECN, cấu hình theo hợp đồng HIỆN TẠI (R-2-g): KHÔNG bước xác nhận,
 *                   KHÔNG bắt lý do từ chối — một cú bấm = một lượt gọi như cũ (R-2-n). Maker-checker: tác giả không tự
 *                   duyệt/từ chối/xuất bản (server `selfReviewChangeRequest` / `selfPublishEquipmentStandard`).
 *      compliance → như cũ.
 *  - Dialog tạo/sửa → sheet (`FlyoutHost`, `?flyout=`): eq-type-new, eq-alarm-map, eq-alarm-normalize, eq-master
 *    (`flyoutId` = id khi sửa), eq-cr-new — trường, mặc định, kiểm tra, payload như dialog cũ.
 *  - < 1024 px: công cụ của tab xuống hàng đầu nội dung tab.
 *
 * SAFETY / NO-OP (mirrors the router): every write here is GOVERNANCE METADATA only — it opens NO device-control path.
 * Mutations are gated behind EQ_GOVERN_ENABLED. Read RBAC: machine_monitoring/canView. Actions: machine_control/canCreate.
 */
import { createContext, useContext, useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useSearch } from "wouter";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import { trpc } from "@/lib/trpc";
import { usePermissions } from "@/_core/hooks/usePermissions";
import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { ViewOnlyBadge } from "@/components/PermissionGate";
import {
  ApprovalQueue,
  CockpitLayout,
  EmptyState,
  FeatureStatusNoticeChip,
  FlyoutHost,
  NoticeChip,
  NoticeStack,
  PageContainer,
  SplitListDetail,
  StatusBadge,
  StatusChipStrip,
  Heading,
  Text,
  chipStateFromQuery,
  chartTooltipStyle,
  chartGridProps,
  chartAxisTick,
  useCloseOwnLayer,
  useFlyout,
  useNarrowViewport,
  type ApprovalItem,
  type FlyoutDefinition,
  type StatusChipItem,
  type TransitionAction,
} from "@/components/patterns";
import { useUrlParam } from "@/components/patterns/useUrlParam";
// doc 63 AUD-08 — alarm badge 4-hue riêng (critical≠high) khi HMI_ISA101_V2 bật.
import { AlarmPriorityBadge } from "@/components/patterns/isaStateBadges";
import { isIsa101V2 } from "@/lib/hmiFlags";
import { type TabbedHubTab } from "@/components/workspace/TabbedHub";
import { resolveActiveTab } from "@/components/workspace/hubState";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ResponsiveContainer, BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip, Cell,
} from "recharts";
import {
  ShieldCheck, RefreshCw, AlertTriangle, Plus, Search,
  ChevronRight, ChevronDown,
  Boxes, Tags, Wrench, CheckCircle2, XCircle, Send, Eye, Layers, Activity,
} from "lucide-react";
import { toast } from "sonner";
import { mapTrpcError } from "@/lib/trpcErrors";
import { isFeatureDisabledError } from "@/lib/featureFlagError";
import {
  deriveFeatureStatus,
  isFeatureStatusUnsettled,
  type FeatureStatus,
} from "@/components/common/FeatureStatusGate";
// doc 80 Đợt 1 Task 4 (X-01) — nhãn SEED trên cây device type + dải tóm tắt.
import { ProvenanceBadge, ProvenanceSummary } from "@/components/common/ProvenanceBadge";

// ── Typesafe shapes inferred from the equipmentStandardsRouter output ─────────
type RouterOutputs = inferRouterOutputs<AppRouter>;
type HierarchyTree = RouterOutputs["equipmentStandards"]["hierarchyTree"];
type TreeNode = HierarchyTree["tree"][number];
type ResolvedType = RouterOutputs["equipmentStandards"]["resolveType"];
type AlarmList = RouterOutputs["equipmentStandards"]["listAlarmMappings"];
type AlarmMapping = AlarmList["mappings"][number];
type MappedAlarm = RouterOutputs["equipmentStandards"]["mapAlarm"];
type ChangeRequest = RouterOutputs["equipmentStandards"]["listChangeRequests"][number];
type Conformance = RouterOutputs["equipmentStandards"]["runConformance"];
type Compliance = RouterOutputs["equipmentStandards"]["complianceMetrics"];
// doc 80 Đợt 1 Task 3 (STD-04) — ONE KPI source: the same alarmKpi.summary as /alarm-kpi + Control Tower.
type AlarmKpis = RouterOutputs["alarmKpi"]["summary"];
type MasterAlarmRow = RouterOutputs["equipmentStandards"]["listMasterAlarms"][number];

const TAB_VALUES = ["hierarchy", "alarms", "alarmPerf", "crs", "compliance"] as const;
type TabValue = (typeof TAB_VALUES)[number];
const BASE_PATH = "/equipment-standards";
/** Bảng ánh xạ / cảnh báo chuẩn: 15 dòng một trang ⇒ trang ≤ 1,5× khung nhìn ở 1366×768 (FE1 cũ 8,3×). */
const ALARM_PAGE_SIZE = 15;
/** Số chip KPI hiện thẳng (đo trên trình duyệt thật, header một hàng với h1 + chip "Khi nào dùng"): ≥ 1600 px ⇒ 4 (+1);
 *  1280–1599 ⇒ 2 (+3); < 1280 px ⇒ 1 = chip GHIM (+4). Dải không co (shrink-0) — phần bị header cắt là ghi chú phía sau. */
const HEADER_ALL_BREAKPOINT_PX = 1600;
const HEADER_MID_BREAKPOINT_PX = 1280;
/** Dưới 1366 px (tab có panel phụ: dưới 1600 px) nút công cụ chỉ còn icon (tên ở aria-label + title) để hàng tab không bị cắt. */
const COMPACT_TOOLS_BREAKPOINT_PX = 1366;

const CONSEQUENCES = ["none", "minor", "major", "severe"] as const;
type Consequence = (typeof CONSEQUENCES)[number];

const PRIORITY_TONE: Record<string, "error" | "warning" | "info" | "success" | "default"> = {
  critical: "error", high: "error", medium: "warning", low: "info",
};

// doc 63 AUD-08 — tone system chỉ có 5 tông nên critical/high từng CÙNG màu đỏ.
// Khi HMI_ISA101_V2 bật, badge priority/severity chuyển sang AlarmPriorityBadge
// (4 hue riêng qua token --alarm-*: đỏ25/cam55/amber85/vàng-nhạt95) — hết nhầm P1 vs P2.
function PriorityBadge({ value, label }: { value: string; label: string }) {
  if (isIsa101V2()) return <AlarmPriorityBadge state={value} label={label} />;
  return <StatusBadge status={value} tone={PRIORITY_TONE[value] ?? "default"} label={label} />;
}

const SEVERITIES = ["critical", "high", "medium", "low", "diagnostic"] as const;
type Severity = (typeof SEVERITIES)[number];

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

// ── Dữ liệu dùng chung cho các tab (TabbedHub: Content là ComponentType không nhận props) ──────
interface StdPageCtx {
  tab: TabValue;
  /** < 1024 px: công cụ của tab nằm ĐẦU nội dung tab (hàng tab không đủ chỗ) — GC10. */
  narrow: boolean;
  /** 1024–1365 px: nút công cụ chỉ còn icon (tên ở aria-label/title). */
  compactTools: boolean;
  /** < 1024 px: chip cờ / loại không đạt / ghi chú xuống hàng công cụ đầu nội dung tab (header hẹp cắt phần tràn). */
  narrowNotices: ReactNode;
  canControl: boolean;
  userId: number | null;
  /** Nút ghi cổng cờ (Register type / Map alarm / Add master): canControl && cờ đã rõ. */
  flagCanControl: boolean;
  flagControlReason: string | undefined;
  // hierarchy
  tree: TreeNode[];
  treeFlat: TreeNode[];
  treeLoading: boolean;
  selectedTypeKey: string | null;
  setSelectedTypeKey: (k: string | null) => void;
  resolved: ResolvedType | undefined;
  resolveFetching: boolean;
  resolveError: boolean;
  // alarms
  alarms: AlarmMapping[];
  alarmsLoading: boolean;
  alarmsError: boolean;
  vendors: string[];
  vendorFilter: string;
  setVendorFilter: (v: string) => void;
  alarmSearch: string;
  setAlarmSearch: (v: string) => void;
  // alarm performance
  kpiWindow: number;
  setKpiWindow: (n: number) => void;
  masters: MasterAlarmRow[];
  mastersLoading: boolean;
  shelvePending: boolean;
  deletePending: boolean;
  unshelve: (m: MasterAlarmRow) => void;
  deleteMaster: (m: MasterAlarmRow) => void;
  // crs
  crs: ChangeRequest[];
  crsStatus: "loading" | "error" | "ready";
  crStatusFilter: string;
  setCrStatusFilter: (v: string) => void;
  crPending: boolean;
  onCrTransition: (item: ApprovalItem, action: TransitionAction) => void;
  // compliance
  compliance: Compliance | undefined;
  conformanceChart: { name: string; value: number; kind: "pass" | "fail" }[];
  runConfReq: boolean;
  conformance: Conformance | undefined;
  conformanceFetching: boolean;
  runConformance: () => void;
}
const StdCtx = createContext<StdPageCtx | null>(null);
function useStdCtx(): StdPageCtx {
  const v = useContext(StdCtx);
  if (!v) throw new Error("StdCtx missing");
  return v;
}

// Tab KHÔNG icon: hàng tab + công cụ của tab phải vừa một dòng ở 1366 px (icon tốn ~22 px mỗi tab).
const TABS: readonly TabbedHubTab[] = [
  { value: "hierarchy", labelKey: "eqStandards.tab.hierarchy", fallback: "Hierarchy", Content: HierarchyTab },
  { value: "alarms", labelKey: "eqStandards.tab.alarms", fallback: "Alarm taxonomy", Content: AlarmsTab },
  { value: "alarmPerf", labelKey: "eqStandards.tab.alarmPerf", fallback: "Alarm performance", Content: AlarmPerfTab },
  { value: "crs", labelKey: "eqStandards.tab.crs", fallback: "Change requests", Content: CrsTab },
  { value: "compliance", labelKey: "eqStandards.tab.compliance", fallback: "Compliance", Content: ComplianceTab },
];

export default function EquipmentStandards() {
  const { t } = useTranslation();
  const { hasPermission } = usePermissions();
  const { user } = useAuth();
  const canView = hasPermission("machine_monitoring", "canView");
  const canControl = hasPermission("machine_control", "canCreate");
  // U4 (doc 26 §2.4) — hiện-nhưng-khoá: lý do khi thiếu quyền điều khiển máy.
  const permReason = !canControl
    ? t("common.gate.needPerm", "Requires {{perm}} permission", { perm: "machine_control" })
    : undefined;

  const search = useSearch();
  const tab = resolveActiveTab(search, TAB_VALUES, "hierarchy") as TabValue;
  const narrow = useNarrowViewport();
  const headerAll = !useNarrowViewport(HEADER_ALL_BREAKPOINT_PX);
  const headerMid = !useNarrowViewport(HEADER_MID_BREAKPOINT_PX);
  // Tab "Hiệu năng cảnh báo" có panel phụ (300–340 px) ⇒ MAIN hẹp hơn: < 1600 px nút công cụ cũng chỉ còn icon.
  const below1366 = useNarrowViewport(COMPACT_TOOLS_BREAKPOINT_PX);
  const compactTools = !narrow && (below1366 || (tab === "alarmPerf" && !headerAll));
  // Loại thiết bị đang xem nằm ở `?typeKey=` (F5 / deep link giữ được).
  const [selectedTypeKey, setSelectedTypeKey] = useUrlParam("typeKey");
  const [vendorFilter, setVendorFilter] = useState<string>("");
  // final wave T9 — tìm qua MỌI trang của bảng ánh xạ (Ctrl+F của trình duyệt chỉ thấy trang đang hiện).
  const [alarmSearch, setAlarmSearch] = useState<string>("");
  const [crStatusFilter, setCrStatusFilter] = useState<string>("");

  // Lookup state (sheet chuẩn hoá — giữ ở trang để kết quả còn khi mở lại sheet, như panel cũ)
  const [lookupVendor, setLookupVendor] = useState("");
  const [lookupCode, setLookupCode] = useState("");
  const [lookup, setLookup] = useState<{ vendor: string; nativeCode: string } | null>(null);

  const [runConfReq, setRunConfReq] = useState(false);
  // W5-21 — alarm performance state
  const [kpiWindow, setKpiWindow] = useState(7);

  const utils = trpc.useUtils();

  // ── Reads (RBAC: machine_monitoring/canView) ────────────────────────────────
  const statusQ = trpc.equipmentStandards.status.useQuery(undefined, { enabled: canView });
  const treeQ = trpc.equipmentStandards.hierarchyTree.useQuery(undefined, { enabled: canView });
  const resolveQ = trpc.equipmentStandards.resolveType.useQuery(
    { typeKey: selectedTypeKey ?? "" },
    { enabled: canView && !!selectedTypeKey, retry: false },
  );
  const alarmsQ = trpc.equipmentStandards.listAlarmMappings.useQuery(
    vendorFilter ? { vendor: vendorFilter } : undefined,
    { enabled: canView },
  );
  const mapAlarmQ = trpc.equipmentStandards.mapAlarm.useQuery(
    { vendor: lookup?.vendor ?? "", nativeCode: lookup?.nativeCode ?? "" },
    { enabled: canView && !!lookup, retry: false },
  );
  const crsQ = trpc.equipmentStandards.listChangeRequests.useQuery(
    crStatusFilter ? { status: crStatusFilter, limit: 200 } : { limit: 200 },
    { enabled: canView },
  );
  const complianceQ = trpc.equipmentStandards.complianceMetrics.useQuery(undefined, { enabled: canView });
  const conformanceQ = trpc.equipmentStandards.runConformance.useQuery(undefined, {
    enabled: canView && runConfReq,
    retry: false,
  });
  // doc 80 Đợt 1 Task 3 (STD-04) — trước đây gọi bộ tính THỨ HAI (equipmentStandards.alarmKpis,
  // chỉ andon) với operatorCount: 1 CỨNG ⇒ số khác /alarm-kpi. Nay đọc CÙNG alarmKpi.summary và
  // KHÔNG gửi operatorCount — server tự suy (số người vận hành đang hoạt động).
  const kpisQ = trpc.alarmKpi.summary.useQuery(
    { windowHours: kpiWindow * 24 },
    { enabled: canView },
  );
  const mastersQ = trpc.equipmentStandards.listMasterAlarms.useQuery(undefined, { enabled: canView });

  const tree = (treeQ.data?.tree ?? []) as TreeNode[];
  // doc 80 Task 4 — every node of the tree (roots + descendants) for the "N/M are seed" strip.
  const treeFlat = useMemo(() => {
    const out: TreeNode[] = [];
    const walk = (ns: TreeNode[]) => { for (const n of ns) { out.push(n); walk(n.children as TreeNode[]); } };
    walk(tree);
    return out;
  }, [tree]);
  const resolved = resolveQ.data as ResolvedType | undefined;
  const alarms = (alarmsQ.data?.mappings ?? []) as AlarmMapping[];
  const vendors = (alarmsQ.data?.vendors ?? []) as string[];
  const mapped = mapAlarmQ.data as MappedAlarm | undefined;
  const crs = (crsQ.data ?? []) as ChangeRequest[];
  const compliance = complianceQ.data as Compliance | undefined;
  const conformance = conformanceQ.data as Conformance | undefined;
  const kpis = kpisQ.data as AlarmKpis | undefined;
  const masters = (mastersQ.data ?? []) as MasterAlarmRow[];

  // Doc 80 Task 1 (PLT-02/G-07/X-07): pending/erroring status query is UNKNOWN, not "on".
  const flagStatus = deriveFeatureStatus(statusQ, (d: { enabled?: boolean }) => d.enabled);
  const flagUnsettled = isFeatureStatusUnsettled(flagStatus);
  const flagControlReason = permReason
    ?? (flagUnsettled ? t("common.gate.checkingStatus", "Checking feature status…") : undefined);
  const flagCanControl = canControl && !flagUnsettled;

  const refetchAll = () => {
    void utils.equipmentStandards.status.invalidate();
    void utils.equipmentStandards.hierarchyTree.invalidate();
    void utils.equipmentStandards.resolveType.invalidate();
    void utils.equipmentStandards.listAlarmMappings.invalidate();
    void utils.equipmentStandards.listChangeRequests.invalidate();
    void utils.equipmentStandards.complianceMetrics.invalidate();
    void utils.equipmentStandards.runConformance.invalidate();
    void utils.alarmKpi.summary.invalidate();
    void utils.equipmentStandards.listMasterAlarms.invalidate();
  };

  // Surface the FLAG-OFF CONFLICT gracefully (info, not a scary red error).
  const onMutationError = (e: { data?: { code?: string } | null; message: string }) => {
    if (isFeatureDisabledError(e)) {
      toast.info(t("eqStandards.flagOffToast", "Equipment governance is disabled (preview). Set EQ_GOVERN_ENABLED=true to act."));
      void utils.equipmentStandards.status.invalidate();
    } else {
      toast.error(mapTrpcError(e));
    }
  };

  // ── Mutations (RBAC: machine_control/canCreate + EQ_GOVERN_ENABLED) ──────────
  // Toast + invalidate ở hook TRANG (chạy cả khi sheet đã đóng trong lúc chờ); sheet tự đóng qua callback lượt gọi.
  const registerM = trpc.equipmentStandards.registerDeviceType.useMutation({
    onSuccess: () => { toast.success(t("eqStandards.typeRegistered", "Device type registered (draft)")); refetchAll(); },
    onError: onMutationError,
  });
  const upsertAlarmM = trpc.equipmentStandards.upsertAlarmMapping.useMutation({
    onSuccess: () => { toast.success(t("eqStandards.alarmSaved", "Alarm mapping saved")); refetchAll(); },
    onError: onMutationError,
  });
  const submitCrM = trpc.equipmentStandards.submitChangeRequest.useMutation({
    onSuccess: () => { toast.success(t("eqStandards.crSubmitted", "Change request submitted")); refetchAll(); },
    onError: onMutationError,
  });
  const reviewCrM = trpc.equipmentStandards.reviewChangeRequest.useMutation({
    onSuccess: () => { toast.success(t("eqStandards.crReviewed", "Change request updated")); refetchAll(); },
    onError: onMutationError,
  });
  const publishCrM = trpc.equipmentStandards.publishChangeRequest.useMutation({
    onSuccess: (r) => {
      const dec = r && "decision" in r ? r.decision : undefined;
      toast.success(
        t("eqStandards.crPublished", "Change request published")
        + (dec ? ` — v${dec.newVersion} (${dec.effectiveBump}${dec.breaking ? ", breaking" : ""})` : ""),
      );
      refetchAll();
    },
    onError: onMutationError,
  });
  // W5-21 — master alarm mutations
  const upsertMasterM = trpc.equipmentStandards.upsertMasterAlarm.useMutation({
    onSuccess: () => { toast.success(t("eqStandards.masterSaved", "Master alarm saved")); refetchAll(); },
    onError: onMutationError,
  });
  const shelveMasterM = trpc.equipmentStandards.shelveMasterAlarm.useMutation({
    onSuccess: () => { toast.success(t("eqStandards.masterShelved", "Shelving updated")); refetchAll(); },
    onError: onMutationError,
  });
  const deleteMasterM = trpc.equipmentStandards.deleteMasterAlarm.useMutation({
    onSuccess: () => { toast.success(t("eqStandards.masterDeleted", "Master alarm deleted")); refetchAll(); },
    onError: onMutationError,
  });

  // ── Derived KPIs (from complianceMetrics) ────────────────────────────────────
  const conformanceChart = useMemo(() => {
    if (!compliance) return [];
    return [
      { name: t("eqStandards.pass", "Pass"), value: compliance.conformancePassCount, kind: "pass" as const },
      {
        name: t("eqStandards.fail", "Fail"),
        value: Math.max(0, compliance.conformanceTypeCount - compliance.conformancePassCount),
        kind: "fail" as const,
      },
    ];
  }, [compliance, t]);

  if (!canView) {
    return (
      <DashboardLayout>
        <div className="p-6">
          <Card>
            <CardContent className="py-10 text-center text-muted-foreground">
              <AlertTriangle className="mx-auto mb-2 h-6 w-6" />
              {t("eqStandards.noPermission", "You do not have permission to view equipment standards.")}
            </CardContent>
          </Card>
        </div>
      </DashboardLayout>
    );
  }

  // R-2-g / R-2-n — mỗi cú bấm đúng MỘT lượt gọi với đúng input cũ (không reviewNotes, publish → staging).
  const onCrTransition = (item: ApprovalItem, action: TransitionAction) => {
    const crId = Number(item.id);
    if (action.key === "publish") publishCrM.mutate({ crId, stage: "staging" });
    else if (action.key === "in_review" || action.key === "approved" || action.key === "rejected") reviewCrM.mutate({ crId, to: action.key });
  };

  const ctx: StdPageCtx = {
    tab,
    narrow,
    compactTools,
    narrowNotices: null,
    canControl,
    userId: user?.id ?? null,
    flagCanControl,
    flagControlReason,
    tree,
    treeFlat,
    treeLoading: treeQ.isLoading,
    selectedTypeKey,
    setSelectedTypeKey,
    resolved,
    resolveFetching: resolveQ.isFetching,
    resolveError: !!resolveQ.error,
    alarms,
    alarmsLoading: alarmsQ.isLoading,
    alarmsError: alarmsQ.isError,
    vendors,
    vendorFilter,
    setVendorFilter,
    alarmSearch,
    setAlarmSearch,
    kpiWindow,
    setKpiWindow,
    masters,
    mastersLoading: mastersQ.isLoading,
    shelvePending: shelveMasterM.isPending,
    deletePending: deleteMasterM.isPending,
    unshelve: (m) => shelveMasterM.mutate({ id: m.id, shelvedUntil: null }),
    deleteMaster: (m) => deleteMasterM.mutate({ id: m.id }),
    crs,
    crsStatus: crsQ.isLoading ? "loading" : crsQ.isError ? "error" : "ready",
    crStatusFilter,
    setCrStatusFilter,
    crPending: reviewCrM.isPending || publishCrM.isPending,
    onCrTransition,
    compliance,
    conformanceChart,
    runConfReq,
    conformance,
    conformanceFetching: conformanceQ.isFetching,
    runConformance: () => { setRunConfReq(true); void utils.equipmentStandards.runConformance.invalidate(); },
  };

  // ── Flyouts (một stack sheet phải; URL `?flyout=&flyoutId=` là nguồn sự thật) ──
  // Nút cũ "Đăng ký loại" / "Ánh xạ cảnh báo" / "Thêm cảnh báo chuẩn" bị khoá khi cờ CHƯA RÕ — deep link / F5 cũng
  // vậy: chưa rõ ⇒ sheet chỉ báo trạng thái, không có form. Cờ TẮT (đã rõ) ⇒ form như nút cũ (server trả CONFLICT).
  const unsettledBody = (
    <UnsettledFlag status={flagStatus} />
  );
  const flyouts: Record<string, FlyoutDefinition> = {
    "eq-alarm-normalize": {
      size: "md",
      title: t("eqStandards.lookupTitle", "Normalize an alarm"),
      description: t("eqStandards.lookupDesc", "Look up how a vendor's native alarm code maps to the ISA-18.2 standard code."),
      render: () => (
        <NormalizeAlarmPanel
          vendor={lookupVendor}
          code={lookupCode}
          setVendor={setLookupVendor}
          setCode={setLookupCode}
          lookup={lookup}
          onLookup={(v) => setLookup(v)}
          fetching={mapAlarmQ.isFetching}
          mapped={mapped}
        />
      ),
    },
  };
  if (canControl) {
    flyouts["eq-type-new"] = {
      size: "md",
      title: t("eqStandards.registerTitle", "Register device type (draft)"),
      description: t("eqStandards.registerDesc", "Adds a draft device type under a parent in the hierarchy; it becomes usable after review."),
      render: () => flagUnsettled ? unsettledBody : (
        <RegisterTypeForm
          parentOptions={tree}
          pending={registerM.isPending}
          onSubmit={(v, done) => registerM.mutate(v, { onSuccess: done })}
        />
      ),
    };
    flyouts["eq-alarm-map"] = {
      size: "md",
      title: t("eqStandards.upsertAlarmTitle", "Map vendor alarm"),
      description: t("eqStandards.upsertAlarmDesc", "Maps a vendor's native alarm code to an ISA-18.2 standard code and severity."),
      render: () => flagUnsettled ? unsettledBody : (
        <UpsertAlarmForm
          pending={upsertAlarmM.isPending}
          onSubmit={(v, done) => upsertAlarmM.mutate(v, { onSuccess: done })}
        />
      ),
    };
    flyouts["eq-master"] = {
      size: "md",
      title: (id) => id ? t("eqStandards.editMasterTitle", "Edit master alarm") : t("eqStandards.addMasterTitle", "Rationalize a master alarm"),
      description: t("eqStandards.masterDesc", "A master alarm records the rationalized priority, consequence and response for one alarm (EEMUA-191)."),
      render: (layer) => {
        if (layer.id) {
          // Sửa: nút cũ "Sửa" không bị cổng cờ (chỉ canControl) — giữ nguyên.
          const row = /^\d+$/.test(layer.id) ? masters.find((m) => m.id === Number(layer.id)) : undefined;
          if (!row) {
            return (
              <p className="py-6 text-center text-sm text-muted-foreground">
                {mastersQ.isLoading
                  ? t("eqStandards.loading", "Loading…")
                  : t("eqStandards.masterNotFound", "Master alarm #{{id}} was not found.", { id: layer.id })}
              </p>
            );
          }
          return (
            <MasterAlarmForm
              key={row.id}
              initial={row}
              pending={upsertMasterM.isPending}
              onSubmit={(v, done) => upsertMasterM.mutate(v, { onSuccess: done })}
            />
          );
        }
        return flagUnsettled ? unsettledBody : (
          <MasterAlarmForm
            initial={null}
            pending={upsertMasterM.isPending}
            onSubmit={(v, done) => upsertMasterM.mutate(v, { onSuccess: done })}
          />
        );
      },
    };
    // Nút cũ "Gửi CR" chỉ cần canControl (không cổng cờ) — giữ nguyên.
    flyouts["eq-cr-new"] = {
      size: "lg",
      title: t("eqStandards.submitCrTitle", "Submit change request"),
      description: t("eqStandards.submitCrDesc", "Proposes a change to a device type; it goes through review and conformance before publishing."),
      render: () => (
        <SubmitCrForm
          parentOptions={tree}
          canView={canView}
          pending={submitCrM.isPending}
          onSubmit={(v, done) => submitCrM.mutate(v, { onSuccess: done })}
        />
      ),
    };
  }

  const complianceState = chipStateFromQuery(complianceQ);
  // R-2-p: chip liên quan cảnh báo GHIM và đứng ĐẦU dải (header hẹp cắt phần cuối, không cắt nó).
  const chipItems: StatusChipItem[] = [
    {
      id: "eq-alarm-vendors",
      // R-2-p: số liên quan cảnh báo — không bao giờ vào "+N".
      pinned: true,
      label: t("eqStandards.kpi.vendorCoverage", "Alarm vendors"),
      value: compliance?.alarmVendorCoverage,
      state: complianceState,
      source: t("eqStandards.chip.srcAlarmVendors", "equipmentStandards.complianceMetrics — distinct vendors in the alarm taxonomy (seed + database)"),
    },
    {
      id: "eq-mapped",
      label: t("eqStandards.kpi.mapped", "Machines mapped"),
      value: compliance ? `${pct(compliance.mappedRate)} · ${compliance.machinesMappedToPublished}/${compliance.machineCount}` : undefined,
      state: complianceState,
      tone: compliance && compliance.mappedRate < 1 ? "warning" : "success",
      source: t("eqStandards.chip.srcMapped", "equipmentStandards.complianceMetrics — machines whose device_type_key points to a published device type"),
    },
    {
      id: "eq-conformance",
      label: t("eqStandards.kpi.conformance", "Conformance pass"),
      value: compliance ? `${pct(compliance.conformancePassRate)} · ${compliance.conformancePassCount}/${compliance.conformanceTypeCount}` : undefined,
      state: complianceState,
      tone: compliance && compliance.conformancePassRate < 1 ? "error" : "success",
      source: t("eqStandards.chip.srcConformance", "equipmentStandards.complianceMetrics — published device types in the database passing the standard rule set"),
    },
    {
      id: "eq-pending-crs",
      label: t("eqStandards.kpi.pendingCrs", "Pending CRs"),
      value: compliance?.crPendingCount,
      state: complianceState,
      tone: compliance && compliance.crPendingCount > 0 ? "warning" : "default",
      source: t("eqStandards.chip.srcPendingCrs", "equipmentStandards.complianceMetrics — change requests pending or in review"),
    },
    {
      id: "eq-types",
      label: t("eqStandards.kpi.types", "Device types"),
      value: treeQ.data?.typeCount,
      state: chipStateFromQuery(treeQ),
      source: t("eqStandards.chip.srcTypes", "equipmentStandards.hierarchyTree — distinct device type keys (seed + database)"),
    },
  ];

  const failingTypes = compliance?.failingTypes ?? [];
  // Flag status — honest 4-state (loading/off/on/error), doc 80 Task 1, as a chip.
  const flagChip = (
    <FeatureStatusNoticeChip
      status={flagStatus}
      offMessage={t(
        "eqStandards.flagOffBanner",
        "Preview mode: equipment governance is disabled. Reads work; actions (register type / map alarm / submit / review / publish) are blocked until it is enabled.",
      )}
      errorMessage={t(
        "eqStandards.flagStatusError",
        "Could not check whether equipment governance is enabled — actions are disabled until this is confirmed.",
      )}
    />
  );
  // Khối đỏ "Types failing conformance" cũ ⇒ chip LỖI đứng trước dải KPI (không bị header cắt trước số liệu).
  const failingChip = failingTypes.length > 0 ? (
    <NoticeChip kind="error" label={t("eqStandards.failingTypesChip", "{{count}} failing conformance", { count: failingTypes.length })}>
      <div className="space-y-2">
        <p className="font-medium text-destructive">{t("eqStandards.failingTypesTitle", "Types failing conformance")}</p>
        <div className="flex flex-wrap gap-1">
          {failingTypes.map((k) => (
            <Badge key={k} variant="outline" className="border-destructive/30 bg-destructive/15 text-destructive font-mono text-xs">{k}</Badge>
          ))}
        </div>
      </div>
    </NoticeChip>
  ) : null;
  // "Khi nào dùng" + câu an toàn cũ. Ở header: MỘT chip + "+1" (đo 1600 px: chip thứ hai bị header cắt im lặng).
  const noticeStack = (maxVisible: number) => (
    <NoticeStack
      maxVisible={maxVisible}
      items={[
        {
          // U7 (doc 26 §2.1) — "Khi nào dùng" (khoá riêng của trang) + phụ đề cũ.
          id: "whenToUse:eqStandards.whenToUse",
          kind: "whenToUse",
          content: (
            <div className="space-y-2">
              <p data-when-to-use="eqStandards.whenToUse">
                {t("eqStandards.whenToUse", "When to use — govern device-type standards, the ISA-18.2 alarm taxonomy and the review board. Governance metadata only, no device commands.")}
              </p>
              <p className="text-muted-foreground">
                {t("eqStandards.subtitle", "Versioned device-type hierarchy, ISA-18.2 alarm taxonomy and the Equipment Standards Board — governance metadata only, no device commands.")}
              </p>
            </div>
          ),
        },
        {
          // Safety note — mirrors the router's NO-OP discipline.
          id: "honesty",
          kind: "honesty",
          label: t("eqStandards.safetyChip", "Metadata only"),
          content: (
            <p>
              {t(
                "eqStandards.safetyNote",
                "This page writes governance metadata only (device-type versions, alarm taxonomy, change requests). It opens no device-control path.",
              )}
            </p>
          ),
        },
      ]}
    />
  );
  // < 1024 px: header chỉ giữ h1 + dải KPI (chip GHIM vẫn hiện); chip cờ / loại không đạt / ghi chú xuống hàng công cụ.
  ctx.narrowNotices = narrow ? (
    <>
      {flagChip}
      {failingChip}
      {noticeStack(2)}
    </>
  ) : null;

  return (
    <DashboardLayout>
      <FlyoutHost flyouts={flyouts}>
        {/* doc 81 Đợt 2 Task 2 — PageContainer: không đệm kép với <main> của shell. */}
        <PageContainer className="space-y-0">
          <StdCtx.Provider value={ctx}>
            <CockpitLayout
              icon={<ShieldCheck />}
              title={
                <span className="flex items-center gap-2">
                  {t("eqStandards.title", "Equipment Standards & Governance")}
                  {!canControl && <ViewOnlyBadge module="machine_control" />}
                </span>
              }
              chips={
                <>
                  {!narrow && flagChip}
                  {!narrow && failingChip}
                  <StatusChipStrip items={chipItems} maxVisible={headerAll ? 4 : headerMid ? 2 : 1} className="shrink-0" />
                  {/* Ghi chú đứng SAU dải KPI: header chật thì chúng bị cắt trước, không phải số liệu. */}
                  {!narrow && noticeStack(1)}
                </>
              }
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
              defaultTab="hierarchy"
              toolbarEnd={narrow ? undefined : <TabToolbar />}
              side={tab === "alarmPerf" ? <AlarmPerfSide kpis={kpis} kpisQ={kpisQ} /> : undefined}
              sideWidth={headerAll ? 340 : 300}
              sideLabel={t("eqStandards.alarmPerfTitle", "Alarm performance (EEMUA-191)")}
              mainName="equipment-standards"
            />
          </StdCtx.Provider>
        </PageContainer>
      </FlyoutHost>
    </DashboardLayout>
  );
}

/** Cờ chưa rõ (đang kiểm tra / lỗi) — sheet ghi không có form (như nút cũ bị khoá). */
function UnsettledFlag({ status }: { status: FeatureStatus }) {
  const { t } = useTranslation();
  return status === "error" ? (
    <p role="alert" className="py-6 text-center text-sm text-destructive">
      {t("eqStandards.flagStatusError", "Could not check whether equipment governance is enabled — actions are disabled until this is confirmed.")}
    </p>
  ) : (
    <p className="py-6 text-center text-sm text-muted-foreground">
      {t("common.gate.checkingStatus", "Checking feature status…")}
    </p>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Hàng công cụ của tab đang mở (cùng hàng dải tab — thanh công cụ DUY NHẤT trong MAIN)
// ══════════════════════════════════════════════════════════════════════════════
function TabToolbar() {
  const ctx = useStdCtx();
  if (ctx.tab === "alarms") return <AlarmsToolbar />;
  if (ctx.tab === "alarmPerf") return <AlarmPerfToolbar />;
  if (ctx.tab === "crs") return <CrsToolbar />;
  if (ctx.tab === "compliance") return <ComplianceToolbar />;
  return <HierarchyToolbar />;
}

/** < 1024 px: cùng bộ công cụ, nhưng là một hàng xuống dòng được ở đầu nội dung tab (không bị hàng tab cắt). */
function NarrowTools() {
  const ctx = useStdCtx();
  return (
    <div data-narrow-tools="" className="flex flex-wrap items-center gap-2 pb-2">
      {ctx.narrowNotices}
      <TabToolbar />
    </div>
  );
}

/** Nút công cụ của tab: đủ chữ; 1024–1365 px chỉ còn icon (tên ở aria-label, tooltip = lý do khoá hoặc tên). */
function ToolButton({ icon, label, disabled, title, onClick }: { icon: ReactNode; label: string; disabled?: boolean; title?: string; onClick: () => void }) {
  const { compactTools } = useStdCtx();
  return compactTools ? (
    <Button size="sm" variant="outline" className="h-8 w-8 px-0" disabled={disabled} aria-label={label} title={title ?? label} onClick={onClick}>
      {icon}
    </Button>
  ) : (
    <Button size="sm" variant="outline" className="h-8" disabled={disabled} title={title} onClick={onClick}>
      {icon}<span className="ml-1">{label}</span>
    </Button>
  );
}

function HierarchyToolbar() {
  const { t } = useTranslation();
  const ctx = useStdCtx();
  const flyout = useFlyout();
  return (
    <ToolButton icon={<Plus className="h-4 w-4" />} label={t("eqStandards.registerType", "Register type")}
      disabled={!ctx.flagCanControl} title={ctx.flagControlReason} onClick={() => flyout.open("eq-type-new")} />
  );
}

function AlarmsToolbar() {
  const { t } = useTranslation();
  const ctx = useStdCtx();
  const flyout = useFlyout();
  return (
    <>
      <Input
        type="search"
        value={ctx.alarmSearch}
        onChange={(e) => ctx.setAlarmSearch(e.target.value)}
        placeholder={t("eqStandards.alarmSearch", "Search alarms…")}
        aria-label={t("eqStandards.alarmSearchLabel", "Search alarms (vendor, code, action) across all pages")}
        className="h-8 w-40"
      />
      {/* U11 — Select DS thay <select> gõ tay; "__all__" là sentinel cho "tất cả". */}
      <Select value={ctx.vendorFilter || "__all__"} onValueChange={(v) => ctx.setVendorFilter(v === "__all__" ? "" : v)}>
        <SelectTrigger size="sm" className="w-36" aria-label={t("eqStandards.vendor", "Vendor")}><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="__all__">{t("eqStandards.allVendors", "All vendors")}</SelectItem>
          {ctx.vendors.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}
        </SelectContent>
      </Select>
      <ToolButton icon={<Search className="h-4 w-4" />} label={t("eqStandards.normalize", "Normalize alarm")} onClick={() => flyout.open("eq-alarm-normalize")} />
      <ToolButton icon={<Plus className="h-4 w-4" />} label={t("eqStandards.mapAlarm", "Map alarm")}
        disabled={!ctx.flagCanControl} title={ctx.flagControlReason} onClick={() => flyout.open("eq-alarm-map")} />
    </>
  );
}

function AlarmPerfToolbar() {
  const { t } = useTranslation();
  const ctx = useStdCtx();
  const flyout = useFlyout();
  return (
    <>
      <Select value={String(ctx.kpiWindow)} onValueChange={(v) => ctx.setKpiWindow(Number(v))}>
        <SelectTrigger size="sm" className="w-32" aria-label={t("eqStandards.windowLabel", "Time window")}><SelectValue /></SelectTrigger>
        <SelectContent>
          {[1, 7, 30].map((d) => (
            <SelectItem key={d} value={String(d)}>{t("eqStandards.lastNDays", "Last {{n}} days").replace("{{n}}", String(d))}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <ToolButton icon={<Plus className="h-4 w-4" />} label={t("eqStandards.addMaster", "Add master alarm")}
        disabled={!ctx.flagCanControl} title={ctx.flagControlReason} onClick={() => flyout.open("eq-master")} />
    </>
  );
}

function CrsToolbar() {
  const { t } = useTranslation();
  const ctx = useStdCtx();
  const flyout = useFlyout();
  return (
    <>
      {/* U11 — Select DS; "__all__" là sentinel cho "tất cả trạng thái". */}
      <Select value={ctx.crStatusFilter || "__all__"} onValueChange={(v) => ctx.setCrStatusFilter(v === "__all__" ? "" : v)}>
        <SelectTrigger size="sm" className="w-36" aria-label={t("eqStandards.col.status", "Status")}><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="__all__">{t("eqStandards.allStatuses", "All statuses")}</SelectItem>
          {["pending", "in_review", "approved", "rejected", "published"].map((s) => (
            <SelectItem key={s} value={s}>{t(`eqStandards.crStatus.${s}`, s)}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      {ctx.canControl && (
        <ToolButton icon={<Plus className="h-4 w-4" />} label={t("eqStandards.submitCr", "Submit CR")} onClick={() => flyout.open("eq-cr-new")} />
      )}
    </>
  );
}

function ComplianceToolbar() {
  const { t } = useTranslation();
  const ctx = useStdCtx();
  return (
    <ToolButton icon={<RefreshCw className={`h-4 w-4 ${ctx.conformanceFetching ? "animate-spin" : ""}`} />} label={t("eqStandards.runConf", "Run conformance")}
      disabled={ctx.conformanceFetching} onClick={ctx.runConformance} />
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB: Hierarchy (E1-a) — cây | chi tiết (SplitListDetail, `?typeKey=`)
// ══════════════════════════════════════════════════════════════════════════════
function HierarchyTab() {
  const { t } = useTranslation();
  const ctx = useStdCtx();
  const key = ctx.selectedTypeKey;
  const list = (
    <div className="p-2">
      {ctx.treeLoading && <Text tone="muted" variant="body-sm">{t("eqStandards.loading", "Loading…")}</Text>}
      {!ctx.treeLoading && ctx.tree.length === 0 && (
        <EmptyState variant="no-data" compact title={t("eqStandards.treeEmpty", "No device types.")} />
      )}
      <ProvenanceSummary rows={ctx.treeFlat} className="mb-2" />
      {ctx.tree.length > 0 && (
        <div role="tree" aria-label={t("eqStandards.hierarchyTitle", "Device type hierarchy")} className="space-y-0.5">
          {ctx.tree.map((node) => (
            <TreeRow key={node.typeKey} node={node} depth={0} selected={key} onSelect={(k) => ctx.setSelectedTypeKey(k)} />
          ))}
        </div>
      )}
    </div>
  );
  const detail = key ? (
    <div className="h-full space-y-3 overflow-auto p-3 text-sm">
      <h2 className="flex items-center gap-2 text-base font-semibold">
        <Layers className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        {t("eqStandards.resolvedTitle", "Resolved: {{key}}").replace("{{key}}", key)}
      </h2>
      {ctx.resolveFetching && <Text tone="muted" variant="body-sm">{t("eqStandards.loading", "Loading…")}</Text>}
      {!ctx.resolveFetching && ctx.resolveError && (
        <Text tone="muted" variant="body-sm">{t("eqStandards.notFound", "Type not found:")} <span className="font-mono">{key}</span></Text>
      )}
      {ctx.resolved && !ctx.resolveFetching && !ctx.resolveError && <ResolvedDetail resolved={ctx.resolved} />}
    </div>
  ) : null;
  return (
    <>
      {ctx.narrow && <NarrowTools />}
      <SplitListDetail
        layoutId="eq-standards-types"
        userId={ctx.userId}
        list={list}
        detail={detail}
        hasSelection={key != null}
        onBack={() => ctx.setSelectedTypeKey(null)}
        listLabel={t("eqStandards.hierarchyTitle", "Device type hierarchy")}
        detailLabel={t("eqStandards.resolvedTitlePlain", "Resolved device type")}
        heightClass="h-[calc(100dvh_-_var(--shell-chrome-h,3.5rem)_-_9.5rem)] min-h-[22rem]"
        emptyDetail={
          <EmptyState
            variant="no-data"
            compact
            title={t("eqStandards.selectHint", "Select a device type in the tree to view its fully-merged attributes, commands and PackML states.")}
          />
        }
      />
    </>
  );
}

// ── Tree row (recursive, expandable) — role=treeitem, Enter/Space chọn ─────────
function TreeRow({
  node, depth, selected, onSelect,
}: {
  node: TreeNode;
  depth: number;
  selected: string | null;
  onSelect: (k: string) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(depth < 2);
  const hasChildren = node.children.length > 0;
  const isSel = selected === node.typeKey;
  return (
    <>
      <div
        role="treeitem"
        aria-level={depth + 1}
        aria-selected={isSel}
        aria-expanded={hasChildren ? open : undefined}
        tabIndex={0}
        data-testid={`type-row-${node.typeKey}`}
        className={`flex cursor-pointer items-center gap-1 rounded px-2 py-1 text-sm hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${isSel ? "bg-primary/10" : ""}`}
        style={{ paddingLeft: `${depth * 1.1 + 0.5}rem` }}
        onClick={() => onSelect(node.typeKey)}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect(node.typeKey);
          }
        }}
      >
        {hasChildren ? (
          <button
            type="button"
            className="shrink-0 text-muted-foreground"
            aria-label={open ? t("eqStandards.collapse", "Collapse") : t("eqStandards.expand", "Expand")}
            onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
          >
            {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
        ) : (
          <span className="inline-block w-3.5 shrink-0" />
        )}
        <Boxes className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className={`truncate ${isSel ? "font-medium" : ""}`}>{node.label ?? node.typeKey}</span>
        <span className="ml-auto flex shrink-0 items-center gap-1">
          <ProvenanceBadge row={node} />
          <span className="font-mono text-[10px] text-muted-foreground">v{node.version}</span>
          <StatusBadge status={node.status} className="px-1 py-0 text-[10px]" />
        </span>
      </div>
      {hasChildren && open && (
        <div role="group">
          {node.children.map((c) => (
            <TreeRow key={c.typeKey} node={c} depth={depth + 1} selected={selected} onSelect={onSelect} />
          ))}
        </div>
      )}
    </>
  );
}

// ── Resolved device-type detail ───────────────────────────────────────────────
function ResolvedDetail({ resolved }: { resolved: ResolvedType }) {
  const { t } = useTranslation();
  const extKeys = Object.keys(resolved.extension ?? {});
  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono font-medium">{resolved.typeKey}</span>
        <Badge variant="outline">v{resolved.version}</Badge>
        {resolved.adapterKind && <Badge className="bg-violet-500 text-white">{resolved.adapterKind}</Badge>}
      </div>
      <div>
        <div className="mb-1 text-xs font-medium text-muted-foreground">{t("eqStandards.inheritance", "Inheritance chain")}</div>
        <div className="flex flex-wrap items-center gap-1">
          {resolved.inheritanceChain.map((k, i) => (
            <span key={k} className="inline-flex items-center gap-1">
              <Badge variant="secondary" className="font-mono text-xs">{k}</Badge>
              {i < resolved.inheritanceChain.length - 1 && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
            </span>
          ))}
        </div>
      </div>
      <div>
        <div className="mb-1 text-xs font-medium text-muted-foreground">
          {t("eqStandards.attributes", "Attributes")} ({resolved.attributesSchema.length})
        </div>
        {resolved.attributesSchema.length === 0 ? (
          <Text tone="muted" variant="caption">{t("eqStandards.none", "None")}</Text>
        ) : (
          <div className="flex flex-wrap gap-1">
            {resolved.attributesSchema.map((a) => (
              <Badge key={a.name} variant="outline" className="font-mono text-xs" title={a.label ?? a.name}>
                <Tags className="mr-1 h-3 w-3" />{a.name}{a.unit ? ` (${a.unit})` : ""}
              </Badge>
            ))}
          </div>
        )}
      </div>
      <div>
        <div className="mb-1 text-xs font-medium text-muted-foreground">
          {t("eqStandards.commands", "Commands")} ({resolved.supportedCommands.length})
        </div>
        {resolved.supportedCommands.length === 0 ? (
          <Text tone="muted" variant="caption">{t("eqStandards.none", "None")}</Text>
        ) : (
          <div className="flex flex-wrap gap-1">
            {resolved.supportedCommands.map((c) => (
              <Badge key={c.name} variant="secondary" className="font-mono text-xs"><Wrench className="mr-1 h-3 w-3" />{c.name}</Badge>
            ))}
          </div>
        )}
      </div>
      <div>
        <div className="mb-1 text-xs font-medium text-muted-foreground">
          {t("eqStandards.states", "PackML states")} ({resolved.supportedStates.length})
        </div>
        {resolved.supportedStates.length === 0 ? (
          <Text tone="muted" variant="caption">{t("eqStandards.none", "None")}</Text>
        ) : (
          <div className="flex flex-wrap gap-1">
            {resolved.supportedStates.map((s) => <Badge key={s} variant="outline" className="text-xs">{s}</Badge>)}
          </div>
        )}
      </div>
      {extKeys.length > 0 && (
        <div>
          <div className="mb-1 text-xs font-medium text-muted-foreground">{t("eqStandards.extension", "Extension fields")}</div>
          <pre className="max-h-40 overflow-auto rounded border border-border bg-muted/30 p-2 text-[11px]">
            {JSON.stringify(resolved.extension, null, 2)}
          </pre>
        </div>
      )}
      {resolved.mappedMachineTypes.length > 0 && (
        <div>
          <div className="mb-1 text-xs font-medium text-muted-foreground">{t("eqStandards.mappedTypes", "Mapped machine types")}</div>
          <div className="flex flex-wrap gap-1">
            {resolved.mappedMachineTypes.map((m) => <Badge key={m} variant="outline" className="font-mono text-xs">{m}</Badge>)}
          </div>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB: Alarm taxonomy (E1-b) — DataTable PHÂN TRANG (MAIN)
// ══════════════════════════════════════════════════════════════════════════════
function AlarmsTab() {
  const { t } = useTranslation();
  const ctx = useStdCtx();
  const columns: DataTableColumn<AlarmMapping>[] = [
    { id: "vendor", header: t("eqStandards.col.vendor", "Vendor"), cell: (a) => <span className="text-xs">{a.vendor}</span>, sortValue: (a) => a.vendor },
    { id: "native", header: t("eqStandards.col.native", "Native code"), cell: (a) => <span className="font-mono text-xs">{a.nativeCode}</span>, sortValue: (a) => a.nativeCode },
    { id: "standard", header: t("eqStandards.col.standard", "Standard code"), cell: (a) => <span className="font-mono text-xs font-medium">{a.standardCode}</span>, sortValue: (a) => a.standardCode },
    {
      id: "severity",
      header: t("eqStandards.col.severity", "Severity"),
      cell: (a) => <PriorityBadge value={a.severity} label={t(`eqStandards.severity.${a.severity}`, a.severity)} />,
    },
    {
      id: "action",
      header: t("eqStandards.col.action", "Recommended action"),
      className: "max-w-[22rem]",
      cell: (a) => (
        <span className="block max-w-[22rem] truncate text-xs text-muted-foreground" title={a.recommendedAction ?? undefined}>
          {a.recommendedAction ?? "—"}
        </span>
      ),
    },
  ];
  const q = ctx.alarmSearch.trim().toLowerCase();
  const rows = q
    ? ctx.alarms.filter((a) => [a.vendor, a.nativeCode, a.standardCode, a.severity, a.recommendedAction ?? ""].some((v) => String(v).toLowerCase().includes(q)))
    : ctx.alarms;
  return (
    <>
      {ctx.narrow && <NarrowTools />}
      <DataTable<AlarmMapping>
        data={rows}
        pageResetKey={`${ctx.vendorFilter}|${q}`}
        columns={columns}
        getRowId={(a) => `${a.vendor}::${a.nativeCode}`}
        pageSize={ALARM_PAGE_SIZE}
        loading={ctx.alarmsLoading}
        emptyState={
          ctx.alarmsError ? (
            <p role="alert" className="py-8 text-center text-sm text-destructive">{t("eqStandards.alarmsError", "Could not load the alarm mappings.")}</p>
          ) : (
            <EmptyState variant="no-data" compact title={t("eqStandards.alarmsEmpty", "No alarm mappings.")} />
          )
        }
      />
    </>
  );
}

// ── Sheet: chuẩn hoá một cảnh báo (mapAlarm) — trạng thái tra cứu ở trang (như panel cũ) ─────
function NormalizeAlarmPanel({
  vendor, code, setVendor, setCode, lookup, onLookup, fetching, mapped,
}: {
  vendor: string;
  code: string;
  setVendor: (v: string) => void;
  setCode: (v: string) => void;
  lookup: { vendor: string; nativeCode: string } | null;
  onLookup: (v: { vendor: string; nativeCode: string }) => void;
  fetching: boolean;
  mapped: MappedAlarm | undefined;
}) {
  const { t } = useTranslation();
  const uid = useId();
  const can = !!vendor.trim() && !!code.trim();
  const run = () => { if (can) onLookup({ vendor: vendor.trim(), nativeCode: code.trim() }); };
  return (
    <div className="grid gap-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1">
          <Label htmlFor={`${uid}-vendor`} className="text-xs text-muted-foreground">{t("eqStandards.vendor", "Vendor")}</Label>
          <Input id={`${uid}-vendor`} value={vendor} placeholder="fanuc" onChange={(e) => setVendor(e.target.value)} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor={`${uid}-code`} className="text-xs text-muted-foreground">{t("eqStandards.nativeCode", "Native code")}</Label>
          <Input id={`${uid}-code`} value={code} placeholder="SRVO-050" onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") run(); }} />
        </div>
      </div>
      <div>
        <Button variant="outline" size="sm" disabled={!can} onClick={run}>
          <Search className="mr-1 h-4 w-4" />{t("eqStandards.lookup", "Look up")}
        </Button>
      </div>
      {lookup && fetching && <p className="text-sm text-muted-foreground">{t("eqStandards.loading", "Loading…")}</p>}
      {mapped && lookup && !fetching && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/30 p-3 text-sm">
          <span className="font-mono">{lookup.vendor} / {lookup.nativeCode}</span>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
          <span className="font-mono font-medium">{mapped.standardCode}</span>
          <PriorityBadge value={mapped.severity} label={t(`eqStandards.severity.${mapped.severity}`, mapped.severity)} />
          {!mapped.mapped && <Badge variant="outline" className="text-muted-foreground">{t("eqStandards.unmappedDefault", "fail-safe default")}</Badge>}
          {mapped.recommendedAction && <span className="text-xs text-muted-foreground">— {mapped.recommendedAction}</span>}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB: Alarm performance (W5-21, EEMUA-191) — MAIN = master alarm DB; KPI ở panel phụ
// ══════════════════════════════════════════════════════════════════════════════
function AlarmPerfTab() {
  const { t } = useTranslation();
  const ctx = useStdCtx();
  const flyout = useFlyout();
  const columns: DataTableColumn<MasterAlarmRow>[] = [
    {
      id: "key",
      header: t("eqStandards.col.alarmKey", "Alarm key"),
      cell: (m) => (
        <span className="font-mono text-xs font-medium">
          {m.alarmKey}{m.assetType ? <span className="ml-1 text-muted-foreground">/{m.assetType}</span> : null}
        </span>
      ),
    },
    { id: "priority", header: t("eqStandards.col.priority", "Priority"), cell: (m) => <PriorityBadge value={m.priority} label={t(`eqStandards.priority.${m.priority}`, m.priority)} /> },
    { id: "consequence", header: t("eqStandards.col.consequence", "Consequence"), cell: (m) => <span className="text-xs">{t(`eqStandards.consequenceVal.${m.consequence}`, m.consequence)}</span> },
    { id: "ttr", header: t("eqStandards.col.ttr", "Time-to-respond"), cell: (m) => <span className="text-xs">{m.timeToRespond != null ? `${m.timeToRespond} ${t("eqStandards.min", "min")}` : "—"}</span> },
    { id: "setpoint", header: t("eqStandards.col.setpoint", "Setpoint / deadband"), cell: (m) => <span className="text-xs text-muted-foreground">{m.setpoint ?? "—"}{m.deadband ? ` / ±${m.deadband}` : ""}</span> },
    {
      id: "shelve",
      header: t("eqStandards.col.shelve", "Shelved / suppressed"),
      cell: (m) =>
        m.isSuppressed ? (
          <Badge variant="outline" className="border-destructive/30 bg-destructive/10 text-destructive text-xs">{t("eqStandards.suppressed", "Suppressed")}</Badge>
        ) : m.isShelvedNow ? (
          // Task 3 Fix round 1 (STD-02) — shelveMasterAlarm vẫn ghi được ở server nhưng đường
          // báo động chính chưa đọc shelvedUntil ⇒ badge trơn "Shelved" là ấn tượng SAI.
          <Badge data-testid={`master-shelved-${m.id}`} variant="outline"
            className="border-amber-500/30 bg-amber-500/10 text-amber-600 text-xs"
            title={t("eqStandards.shelveNotEnforced", "Not yet effective on the alarm path")}>
            {t("eqStandards.shelvedNotEnforced", "Shelved (not yet effective)")}
          </Badge>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    {
      id: "actions",
      header: t("common.actions", "Actions"),
      align: "right",
      cell: (m) =>
        ctx.canControl ? (
          <div className="flex justify-end gap-1">
            <Button size="sm" variant="ghost" className="h-7" onClick={() => flyout.open("eq-master", { id: m.id })}>
              <Eye className="mr-1 h-3.5 w-3.5" />{t("eqStandards.edit", "Edit")}
            </Button>
            {m.isShelvedNow ? (
              <Button size="sm" variant="ghost" className="h-7" disabled={ctx.shelvePending} onClick={() => ctx.unshelve(m)}>
                {t("eqStandards.unshelve", "Un-shelve")}
              </Button>
            ) : (
              // doc 80 Đợt 1 Task 3 (STD-02) — KHOÁ cho tới khi có enforcement: đường
              // báo động chính (Andon/cảnh báo AI) chưa đọc shelvedUntil, bấm "Shelve"
              // khiến người vận hành tưởng đã shelve trong khi báo động vẫn nổ.
              <Button size="sm" variant="ghost" className="h-7" disabled
                title={t("eqStandards.shelveNotEnforced", "Not yet effective on the alarm path")}>
                {t("eqStandards.shelve8h", "Shelve 8h")}
              </Button>
            )}
            <Button size="sm" variant="ghost" className="h-7" disabled={ctx.deletePending}
              aria-label={t("eqStandards.deleteMaster", "Delete master alarm")} title={t("eqStandards.deleteMaster", "Delete master alarm")}
              onClick={() => ctx.deleteMaster(m)}>
              <XCircle className="h-3.5 w-3.5 text-destructive" />
            </Button>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">{t("eqStandards.viewOnly", "View only")}</span>
        ),
    },
  ];
  return (
    <>
      {ctx.narrow && <NarrowTools />}
      {/* Tiêu đề thuần một dòng (h2 ≤ 40 px): tên tab "Hiệu năng cảnh báo" không nói bảng này là gì. */}
      <h2 className="mb-2 text-sm font-semibold">{t("eqStandards.masterTitle", "Master alarm database (rationalization)")}</h2>
      <DataTable<MasterAlarmRow>
        data={ctx.masters}
        columns={columns}
        getRowId={(m) => m.id}
        pageSize={ALARM_PAGE_SIZE}
        loading={ctx.mastersLoading}
        emptyState={<EmptyState variant="no-data" compact title={t("eqStandards.masterEmpty", "No master alarms rationalized yet.")} />}
      />
    </>
  );
}

/** Panel phụ (ngoài MAIN): KPI EEMUA-191 thành chip CÓ NGUỒN + nhóm gây nhiễu. Chattering: "Chưa đo được". */
function AlarmPerfSide({ kpis, kpisQ }: { kpis: AlarmKpis | undefined; kpisQ: { data: unknown; isLoading?: boolean; isPending?: boolean; isError?: boolean } }) {
  const { t } = useTranslation();
  const state = chipStateFromQuery(kpisQ);
  const rateTone = kpis ? (kpis.rate.status === "critical" ? "error" : kpis.rate.status === "warning" ? "warning" : "success") : "default";
  const items: StatusChipItem[] = [
    {
      id: "alarm-kpi-total", pinned: true, label: t("eqStandards.kpi.total", "Total alarms"), value: kpis?.totalAlarms, state,
      source: t("eqStandards.chip.srcAlarmTotal", "alarmKpi.summary — Andon + AI alerts in the window (same source as /alarm-kpi and Control Tower)"),
    },
    {
      id: "alarm-kpi-rate", pinned: true, label: t("eqStandards.kpi.perOpHour", "Alarms/op/hour"), value: kpis ? kpis.rate.alarmsPerHourPerOperator.toFixed(1) : undefined, state, tone: rateTone,
      source: t("eqStandards.chip.srcAlarmRate", "alarmKpi.summary — alarms per operator per hour; operators counted on the server"),
    },
    {
      id: "alarm-kpi-flood", pinned: true, label: t("eqStandards.kpi.flood", "Flood windows"), value: kpis?.flood.floodBucketCount, state, tone: kpis ? (kpis.flood.isFlooding ? "error" : "success") : "default",
      source: t("eqStandards.chip.srcFlood", "alarmKpi.summary — 10-minute windows above the flood threshold"),
    },
    {
      id: "alarm-kpi-standing", pinned: true, label: t("eqStandards.kpi.standing", "Standing/stale"), value: kpis?.standing.count, state, tone: kpis ? (kpis.standing.count > 0 ? "warning" : "success") : "default",
      source: t("eqStandards.chip.srcStanding", "alarmKpi.summary — alarms standing longer than the threshold"),
    },
    {
      id: "alarm-kpi-peak", pinned: true, label: t("eqStandards.kpi.peakWindow", "Peak/10min"), value: kpis?.flood.maxInWindow, state,
      source: t("eqStandards.chip.srcPeak", "alarmKpi.summary — most alarms in one 10-minute window"),
    },
    {
      // Task 3 Fix round 1 — nguồn KPI chung (alarmKpi.summary) CHƯA tính chattering: nói thẳng "chưa đo được"
      // thay vì bỏ ô im lặng hay bịa một con số. Nguồn của chip = lý do.
      // final wave M-6 — chip này KHÔNG đọc alarmKpi ⇒ không mang trạng thái tải/lỗi của nguồn đó: luôn "chưa đo được".
      id: "alarm-kpi-chattering", label: t("eqStandards.kpi.chattering", "Chattering"), value: t("eqStandards.kpi.notMeasured", "Not measured yet"), state: "ok",
      source: t("eqStandards.kpi.chatteringNotMeasuredTip", "The combined alarm KPI source (alarmKpi) does not compute chattering yet."),
    },
    {
      id: "alarm-kpi-operators", label: t("eqStandards.kpi.operators", "Operators (server)"), value: kpis?.operatorCount, state,
      source: t("eqStandards.chip.srcOperators", "alarmKpi.summary — active operators counted on the server"),
    },
  ];
  return (
    <div data-alarm-perf-side="" className="space-y-3 text-sm">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <Activity className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        {t("eqStandards.alarmPerfTitle", "Alarm performance (EEMUA-191)")}
      </h2>
      {kpisQ.isError && <Text tone="muted" variant="body-sm">{t("eqStandards.kpiError", "Could not load alarm KPIs.")}</Text>}
      <StatusChipStrip
        items={items}
        maxVisible={items.length}
        ariaLabel={t("eqStandards.alarmPerfTitle", "Alarm performance (EEMUA-191)")}
        className="flex-wrap overflow-visible"
      />
      {kpis && (
        <p data-testid="alarm-kpi-source" className="text-xs text-muted-foreground">
          {t(
            "eqStandards.kpiSourceNote",
            "Same source as the Alarm KPI dashboard and Control Tower (Andon + AI alerts). Operators: {{n}} — counted on the server.",
            { n: kpis.operatorCount },
          )}
        </p>
      )}
      {kpis && (
        <div>
          <Heading level={6} className="mb-2">{t("eqStandards.badActors", "Top bad actors")}</Heading>
          {kpis.badActors.length === 0 ? (
            <Text tone="muted" variant="body-sm">{t("eqStandards.noAlarms", "No alarms in this window.")}</Text>
          ) : (
            <div className="space-y-1">
              {kpis.badActors.map((b) => (
                <div key={b.actorKey} className="flex items-center gap-2 text-sm">
                  <span className="w-24 shrink-0 truncate font-mono text-xs" title={b.actorKey}>{b.actorLabel}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded bg-muted">
                    <div className="h-full bg-primary" style={{ width: `${Math.round(b.percent)}%` }} />
                  </div>
                  <span className="w-16 shrink-0 text-right text-xs text-muted-foreground">{b.count} ({Math.round(b.percent)}%)</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB: Change requests (E1-c) — ApprovalQueue dùng chung (R-2-g: hợp đồng HIỆN TẠI)
// ══════════════════════════════════════════════════════════════════════════════
function CrsTab() {
  const { t } = useTranslation();
  const ctx = useStdCtx();
  // Server: người tạo CR không được review/duyệt/từ chối (selfReviewChangeRequest) hay xuất bản
  // (selfPublishEquipmentStandard) ⇒ MỌI hành động tách khỏi tác giả. Client chỉ báo sớm; server vẫn là cổng.
  const review: TransitionAction = { key: "in_review", kind: "advance", segregateFrom: ["author"], label: t("eqStandards.review", "Review"), hint: t("eqStandards.startReviewTip", "Move to in-review") };
  const approve: TransitionAction = { key: "approved", kind: "approve", segregateFrom: ["author"], label: t("eqStandards.approve", "Approve"), hint: t("eqStandards.approveTip", "Approve — the server computes the conformance gate from the proposed schema") };
  const reject: TransitionAction = { key: "rejected", kind: "reject", segregateFrom: ["author"], label: t("eqStandards.reject", "Reject"), hint: t("eqStandards.rejectTip", "Reject") };
  const publish: TransitionAction = { key: "publish", kind: "advance", segregateFrom: ["author"], label: t("eqStandards.publish", "Publish"), hint: t("eqStandards.publishTip", "Publish — gated by conformance + backward-compat") };

  const items: ApprovalItem[] = ctx.crs.map((cr) => {
    const breaking = String(cr.backwardIncompatible) === "true";
    const actions: TransitionAction[] = !ctx.canControl
      ? []
      : cr.status === "pending"
        ? [review, approve, reject]
        : cr.status === "in_review"
          ? [approve, reject]
          : cr.status === "approved"
            ? [publish]
            : [];
    return {
      id: cr.id,
      key: cr.crKey,
      authorId: cr.requestedBy,
      authorName: cr.requestedBy != null ? `#${cr.requestedBy}` : undefined,
      title: (
        <span className="inline-flex flex-wrap items-center gap-1">
          <span className="font-mono text-xs">{cr.targetTypeKey}</span>
          <Badge variant="outline">{t(`eqStandards.crKind.${cr.kind}`, cr.kind)}</Badge>
        </span>
      ),
      status: (
        <span className="inline-flex flex-wrap items-center gap-1">
          <StatusBadge status={cr.status} label={t(`eqStandards.crStatus.${cr.status}`, cr.status)} />
          <StatusBadge status={cr.conformanceStatus} label={t(`eqStandards.conf.${cr.conformanceStatus}`, cr.conformanceStatus)} />
          {breaking && (
            <span title={t("eqStandards.breakingTip", "Backward-incompatible — requires a major version bump")}>
              <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
            </span>
          )}
          <Badge variant="outline" className="text-muted-foreground">{cr.stage}</Badge>
        </span>
      ),
      actions,
      actionsFallback: !ctx.canControl
        ? <span className="text-xs text-muted-foreground">{t("eqStandards.viewOnly", "View only")}</span>
        : cr.status === "rejected" || cr.status === "published"
          ? <span className="text-xs text-muted-foreground">{t("eqStandards.terminal", "—")}</span>
          : undefined,
    };
  });
  return (
    <>
      {ctx.narrow && <NarrowTools />}
      <div className="max-h-[calc(100dvh_-_var(--shell-chrome-h,3.5rem)_-_9.5rem)] min-h-[16rem] overflow-auto rounded-md border bg-card">
        <ApprovalQueue
          items={items}
          status={ctx.crsStatus}
          currentUserId={ctx.userId}
          pending={ctx.crPending}
          // R-2-g — hợp đồng HIỆN TẠI của CR: một cú bấm (không sheet xác nhận), lý do từ chối KHÔNG bắt buộc.
          confirmStep={false}
          rejectReasonRequired={false}
          emptyTitle={t("eqStandards.crsEmpty", "No change requests.")}
          ariaLabel={t("eqStandards.crsTitle", "Equipment Standards Board")}
          onTransition={(item, action) => ctx.onCrTransition(item, action)}
        />
      </div>
    </>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB: Compliance (E1-e + E1-d)
// ══════════════════════════════════════════════════════════════════════════════
function ComplianceTab() {
  const { t } = useTranslation();
  const ctx = useStdCtx();
  const compliance = ctx.compliance;
  return (
    <div className="flex flex-col gap-4">
      {ctx.narrow && <NarrowTools />}
      {/* Tiêu đề thuần một dòng (h2 ≤ 40 px) + khung — không dùng header SectionCard (khối có nền/viền trên phần tử
          làm việc = banner trong MAIN theo thiết bị đo). */}
      <section aria-labelledby="eq-compliance-overview">
        <h2 id="eq-compliance-overview" className="mb-2 text-sm font-semibold">{t("eqStandards.complianceTitle", "Compliance overview")}</h2>
        <div className="rounded-md border bg-card p-4">
          <div className="grid gap-4 md:grid-cols-2">
            {/* Conformance pass/fail chart (natural pass vs fail series) */}
            <div>
              <Heading level={6} className="mb-2">{t("eqStandards.conformanceChart", "Conformance by device type")}</Heading>
              {ctx.conformanceChart.length > 0 ? (
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={ctx.conformanceChart}>
                      <CartesianGrid {...chartGridProps} />
                      <XAxis dataKey="name" tick={chartAxisTick} />
                      <YAxis allowDecimals={false} tick={chartAxisTick} />
                      <Tooltip contentStyle={chartTooltipStyle} cursor={{ fill: "var(--muted)" }} />
                      <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                        {ctx.conformanceChart.map((entry) => (
                          <Cell key={entry.kind} fill={entry.kind === "pass" ? "var(--success)" : "var(--destructive)"} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <Text tone="muted" variant="body-sm">{t("eqStandards.loading", "Loading…")}</Text>
              )}
            </div>

            {/* Unmapped machine types */}
            <div>
              <Heading level={6} className="mb-2">{t("eqStandards.unmappedTitle", "Unmapped machine types")}</Heading>
              {compliance && compliance.unmappedMachineTypes.length === 0 && (
                <div className="flex items-center gap-2 text-sm text-emerald-600">
                  <CheckCircle2 className="h-4 w-4" />{t("eqStandards.allMapped", "Every machine type maps to a published device type.")}
                </div>
              )}
              {compliance && compliance.unmappedMachineTypes.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {compliance.unmappedMachineTypes.map((m) => (
                    <Badge key={m} variant="outline" className="border-warning/30 bg-warning/15 text-warning font-mono text-xs">{m}</Badge>
                  ))}
                </div>
              )}
              {!compliance && <Text tone="muted" variant="body-sm">{t("eqStandards.loading", "Loading…")}</Text>}
            </div>
          </div>
          {/* doc 80 Đợt 1 Task 3 (STD-01) — nói rõ số đo trên CÁI GÌ (không còn 100 % giả từ hằng số seed). */}
          {compliance && (
            <div data-testid="compliance-basis" className="mt-4 space-y-1 text-xs text-muted-foreground">
              <p>
                {t(
                  "eqStandards.complianceBasis",
                  "Mapped = machines.device_type_key bound to a published device type: {{mapped}}/{{total}} machines ({{keyed}} have a key, {{unpublished}} point to an unpublished type). Conformance runs on the {{types}} published device types in the database.",
                  {
                    mapped: compliance.machinesMappedToPublished,
                    total: compliance.machineCount,
                    keyed: compliance.basis.machinesWithKey,
                    unpublished: compliance.basis.machinesWithUnpublishedKey,
                    types: compliance.basis.publishedTypeCount,
                  },
                )}
              </p>
              {compliance.basis.warnings.map((w) => (
                <p key={w} className="text-warning">{t(`eqStandards.basisWarning.${w}`, w)}</p>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Run conformance (nút ở hàng công cụ của tab) */}
      <section aria-labelledby="eq-conformance-test">
        <h2 id="eq-conformance-test" className="mb-2 text-sm font-semibold">{t("eqStandards.runConfTitle", "Conformance test")}</h2>
        <div className="rounded-md border bg-card p-4">
          {!ctx.runConfReq && (
            <Text tone="muted" variant="body-sm">{t("eqStandards.runConfHint", "Run the standard rule set across the seeded device types and capability profiles.")}</Text>
          )}
          {ctx.runConfReq && ctx.conformanceFetching && <Text tone="muted" variant="body-sm">{t("eqStandards.loading", "Loading…")}</Text>}
          {ctx.conformance && !ctx.conformanceFetching && <ConformanceResult result={ctx.conformance} />}
        </div>
      </section>
    </div>
  );
}

// ── Conformance result detail ─────────────────────────────────────────────────
function ConformanceResult({ result }: { result: Conformance }) {
  const { t } = useTranslation();
  const all = [...result.seed, ...result.profiles];
  const failing = all.filter((r) => !r.pass);
  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-center gap-2">
        {result.pass ? (
          <Badge className="border-success/30 bg-success/15 text-success" variant="outline"><CheckCircle2 className="mr-1 h-3.5 w-3.5" />{t("eqStandards.confPass", "All pass")}</Badge>
        ) : (
          <Badge className="border-destructive/30 bg-destructive/15 text-destructive" variant="outline"><XCircle className="mr-1 h-3.5 w-3.5" />{t("eqStandards.confFail", "Failures")}: {failing.length}</Badge>
        )}
        <span className="text-xs text-muted-foreground">{t("eqStandards.confChecked", "{{n}} subjects checked").replace("{{n}}", String(all.length))}</span>
      </div>
      {failing.length > 0 && (
        <div className="space-y-2">
          {failing.map((r, i) => (
            <div key={`${r.typeKey}-${i}`} className="rounded-md border border-destructive/30 bg-destructive/5 p-2">
              <div className="font-mono text-xs font-medium">{r.typeKey}</div>
              <ul className="mt-1 space-y-0.5">
                {r.violations.map((v, j) => (
                  <li key={j} className="text-xs text-muted-foreground">• {v.rule} — <span className="font-mono">{v.detail}</span></li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SheetFooter({ children }: { children: ReactNode }) {
  return <div className="flex justify-end gap-2 border-t pt-3">{children}</div>;
}

// ── Sheet: register device type ───────────────────────────────────────────────
function RegisterTypeForm({
  parentOptions, pending, onSubmit,
}: {
  parentOptions: TreeNode[];
  pending: boolean;
  onSubmit: (v: { typeKey: string; parentTypeKey?: string; version: string; label?: string; description?: string }, done: () => void) => void;
}) {
  const { t } = useTranslation();
  const { layer, done } = useCloseOwnLayer();
  const uid = useId();
  const [typeKey, setTypeKey] = useState("");
  const [parentTypeKey, setParentTypeKey] = useState("");
  const [version, setVersion] = useState("1.0.0");
  const [label, setLabel] = useState("");
  const [description, setDescription] = useState("");

  const dirty = typeKey !== "" || parentTypeKey !== "" || version !== "1.0.0" || label !== "" || description !== "";
  useEffect(() => { layer.setDirty(dirty); }, [dirty]); // eslint-disable-line react-hooks/exhaustive-deps

  // Flatten the tree for the parent <select>.
  const flatKeys = useMemo(() => {
    const out: string[] = [];
    const walk = (nodes: TreeNode[]) => { for (const n of nodes) { out.push(n.typeKey); walk(n.children); } };
    walk(parentOptions);
    return out;
  }, [parentOptions]);

  const submit = () => {
    if (!typeKey.trim()) { toast.error(t("eqStandards.typeKeyRequired", "Type key is required.")); return; }
    onSubmit({
      typeKey: typeKey.trim(),
      parentTypeKey: parentTypeKey.trim() || undefined,
      version: version.trim() || "1.0.0",
      label: label.trim() || undefined,
      description: description.trim() || undefined,
    }, done);
  };

  return (
    <div className="grid gap-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1">
          <Label htmlFor={`${uid}-key`}>{t("eqStandards.typeKey", "Type key")}</Label>
          <Input id={`${uid}-key`} value={typeKey} placeholder="MyRobotVariant" onChange={(e) => setTypeKey(e.target.value)} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor={`${uid}-ver`}>{t("eqStandards.version", "Version")}</Label>
          <Input id={`${uid}-ver`} value={version} placeholder="1.0.0" onChange={(e) => setVersion(e.target.value)} />
        </div>
      </div>
      <div className="grid gap-1">
        <Label htmlFor={`${uid}-parent`}>{t("eqStandards.parent", "Parent type")}</Label>
        {/* U11 — Select DS; "__none__" là sentinel cho "không cha (root)". */}
        <Select value={parentTypeKey || "__none__"} onValueChange={(v) => setParentTypeKey(v === "__none__" ? "" : v)}>
          <SelectTrigger id={`${uid}-parent`} className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">{t("eqStandards.noParent", "(none — root)")}</SelectItem>
            {flatKeys.map((k) => <SelectItem key={k} value={k}>{k}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-1">
        <Label htmlFor={`${uid}-label`}>{t("eqStandards.label", "Label")}</Label>
        <Input id={`${uid}-label`} value={label} onChange={(e) => setLabel(e.target.value)} />
      </div>
      <div className="grid gap-1">
        <Label htmlFor={`${uid}-desc`}>{t("eqStandards.description", "Description")}</Label>
        <Input id={`${uid}-desc`} value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <SheetFooter>
        <Button variant="outline" onClick={() => layer.close()}>{t("common.cancel", "Cancel")}</Button>
        <Button onClick={submit} disabled={pending}><CheckCircle2 className="mr-1 h-4 w-4" />{t("eqStandards.register", "Register")}</Button>
      </SheetFooter>
    </div>
  );
}

// ── Sheet: upsert alarm mapping ───────────────────────────────────────────────
function UpsertAlarmForm({
  pending, onSubmit,
}: {
  pending: boolean;
  onSubmit: (v: { vendor: string; nativeCode: string; standardCode: string; severity: Severity; description?: string; recommendedAction?: string }, done: () => void) => void;
}) {
  const { t } = useTranslation();
  const { layer, done } = useCloseOwnLayer();
  const uid = useId();
  const [vendor, setVendor] = useState("");
  const [nativeCode, setNativeCode] = useState("");
  const [standardCode, setStandardCode] = useState("");
  const [severity, setSeverity] = useState<Severity>("medium");
  const [description, setDescription] = useState("");
  const [recommendedAction, setRecommendedAction] = useState("");

  const dirty = vendor !== "" || nativeCode !== "" || standardCode !== "" || severity !== "medium" || description !== "" || recommendedAction !== "";
  useEffect(() => { layer.setDirty(dirty); }, [dirty]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = () => {
    if (!vendor.trim() || !nativeCode.trim() || !standardCode.trim()) {
      toast.error(t("eqStandards.alarmRequired", "Vendor, native code and standard code are required.")); return;
    }
    onSubmit({
      vendor: vendor.trim(), nativeCode: nativeCode.trim(), standardCode: standardCode.trim(), severity,
      description: description.trim() || undefined, recommendedAction: recommendedAction.trim() || undefined,
    }, done);
  };

  return (
    <div className="grid gap-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1">
          <Label htmlFor={`${uid}-vendor`}>{t("eqStandards.vendor", "Vendor")}</Label>
          <Input id={`${uid}-vendor`} value={vendor} placeholder="fanuc" onChange={(e) => setVendor(e.target.value)} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor={`${uid}-native`}>{t("eqStandards.nativeCode", "Native code")}</Label>
          <Input id={`${uid}-native`} value={nativeCode} placeholder="SRVO-050" onChange={(e) => setNativeCode(e.target.value)} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1">
          <Label htmlFor={`${uid}-std`}>{t("eqStandards.standardCode", "Standard code")}</Label>
          <Input id={`${uid}-std`} value={standardCode} placeholder="COLLISION_DETECT" onChange={(e) => setStandardCode(e.target.value)} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor={`${uid}-sev`}>{t("eqStandards.col.severity", "Severity")}</Label>
          <Select value={severity} onValueChange={(v) => setSeverity(v as Severity)}>
            <SelectTrigger id={`${uid}-sev`} className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              {SEVERITIES.map((s) => <SelectItem key={s} value={s}>{t(`eqStandards.severity.${s}`, s)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid gap-1">
        <Label htmlFor={`${uid}-desc`}>{t("eqStandards.description", "Description")}</Label>
        <Input id={`${uid}-desc`} value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div className="grid gap-1">
        <Label htmlFor={`${uid}-action`}>{t("eqStandards.recommendedAction", "Recommended action")}</Label>
        <Input id={`${uid}-action`} value={recommendedAction} onChange={(e) => setRecommendedAction(e.target.value)} />
      </div>
      <SheetFooter>
        <Button variant="outline" onClick={() => layer.close()}>{t("common.cancel", "Cancel")}</Button>
        <Button onClick={submit} disabled={pending}><CheckCircle2 className="mr-1 h-4 w-4" />{t("eqStandards.save", "Save mapping")}</Button>
      </SheetFooter>
    </div>
  );
}

// ── Sheet: master alarm (W5-21) ───────────────────────────────────────────────
// Client-side mirror of the server EEMUA-191 matrix — PREVIEW ONLY (the server
// re-derives priority authoritatively on upsert).
function previewPriority(consequence: Consequence, ttr: number | null): string {
  const band = ttr == null ? "medium" : ttr < 10 ? "short" : ttr <= 30 ? "medium" : "long";
  const M: Record<Consequence, Record<string, string>> = {
    severe: { short: "critical", medium: "critical", long: "high" },
    major: { short: "high", medium: "high", long: "medium" },
    minor: { short: "medium", medium: "low", long: "low" },
    none: { short: "low", medium: "low", long: "low" },
  };
  return M[consequence][band];
}

interface MasterAlarmValue {
  alarmKey: string;
  assetType?: string;
  vendor?: string;
  nativeCode?: string;
  label?: string;
  consequence: Consequence;
  timeToRespond?: number;
  setpoint?: string;
  deadband?: string;
  rationalization?: string;
  isSuppressed?: boolean;
}

function MasterAlarmForm({
  initial, pending, onSubmit,
}: {
  initial: MasterAlarmRow | null;
  pending: boolean;
  onSubmit: (v: MasterAlarmValue, done: () => void) => void;
}) {
  const { t } = useTranslation();
  const { layer, done } = useCloseOwnLayer();
  const uid = useId();
  const init = {
    alarmKey: initial?.alarmKey ?? "",
    assetType: initial?.assetType ?? "",
    vendor: initial?.vendor ?? "",
    nativeCode: initial?.nativeCode ?? "",
    label: initial?.label ?? "",
    consequence: ((initial?.consequence as Consequence) ?? "minor") as Consequence,
    ttr: initial?.timeToRespond != null ? String(initial.timeToRespond) : "",
    setpoint: initial?.setpoint ?? "",
    deadband: initial?.deadband ?? "",
    rationalization: initial?.rationalization ?? "",
    isSuppressed: initial?.isSuppressed ?? false,
  };
  const [alarmKey, setAlarmKey] = useState(init.alarmKey);
  const [assetType, setAssetType] = useState(init.assetType);
  const [vendor, setVendor] = useState(init.vendor);
  const [nativeCode, setNativeCode] = useState(init.nativeCode);
  const [label, setLabel] = useState(init.label);
  const [consequence, setConsequence] = useState<Consequence>(init.consequence);
  const [ttr, setTtr] = useState<string>(init.ttr);
  const [setpoint, setSetpoint] = useState(init.setpoint);
  const [deadband, setDeadband] = useState(init.deadband);
  const [rationalization, setRationalization] = useState(init.rationalization);
  const [isSuppressed, setIsSuppressed] = useState<boolean>(init.isSuppressed);

  const dirty = alarmKey !== init.alarmKey || assetType !== init.assetType || vendor !== init.vendor || nativeCode !== init.nativeCode
    || label !== init.label || consequence !== init.consequence || ttr !== init.ttr || setpoint !== init.setpoint
    || deadband !== init.deadband || rationalization !== init.rationalization || isSuppressed !== init.isSuppressed;
  useEffect(() => { layer.setDirty(dirty); }, [dirty]); // eslint-disable-line react-hooks/exhaustive-deps

  const ttrNum = ttr.trim() === "" ? null : Number(ttr);
  const preview = previewPriority(consequence, ttrNum != null && Number.isFinite(ttrNum) ? ttrNum : null);

  const submit = () => {
    if (!alarmKey.trim()) { toast.error(t("eqStandards.alarmKeyRequired", "Alarm key is required.")); return; }
    onSubmit({
      alarmKey: alarmKey.trim(),
      assetType: assetType.trim() || undefined,
      vendor: vendor.trim() || undefined,
      nativeCode: nativeCode.trim() || undefined,
      label: label.trim() || undefined,
      consequence,
      timeToRespond: ttrNum != null && Number.isFinite(ttrNum) ? ttrNum : undefined,
      setpoint: setpoint.trim() || undefined,
      deadband: deadband.trim() || undefined,
      rationalization: rationalization.trim() || undefined,
      isSuppressed,
    }, done);
  };

  return (
    <div className="grid gap-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1">
          <Label htmlFor={`${uid}-key`}>{t("eqStandards.alarmKey", "Alarm key (standard code)")}</Label>
          <Input id={`${uid}-key`} value={alarmKey} placeholder="COLLISION_DETECT" onChange={(e) => setAlarmKey(e.target.value)} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor={`${uid}-asset`}>{t("eqStandards.assetType", "Asset type (optional)")}</Label>
          <Input id={`${uid}-asset`} value={assetType} placeholder="ROBOT" onChange={(e) => setAssetType(e.target.value)} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1">
          <Label htmlFor={`${uid}-cons`}>{t("eqStandards.consequence", "Consequence")}</Label>
          <Select value={consequence} onValueChange={(v) => setConsequence(v as Consequence)}>
            <SelectTrigger id={`${uid}-cons`} className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              {CONSEQUENCES.map((c) => <SelectItem key={c} value={c}>{t(`eqStandards.consequenceVal.${c}`, c)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1">
          <Label htmlFor={`${uid}-ttr`}>{t("eqStandards.ttr", "Time-to-respond (min)")}</Label>
          <Input id={`${uid}-ttr`} type="number" min={0} value={ttr} placeholder="10" onChange={(e) => setTtr(e.target.value)} />
        </div>
      </div>
      {/* Derived priority preview */}
      <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 p-2 text-sm">
        <span className="text-xs text-muted-foreground">{t("eqStandards.derivedPriority", "Derived priority (EEMUA-191):")}</span>
        <PriorityBadge value={preview} label={t(`eqStandards.priority.${preview}`, preview)} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1">
          <Label htmlFor={`${uid}-sp`}>{t("eqStandards.setpoint", "Setpoint")}</Label>
          <Input id={`${uid}-sp`} value={setpoint} placeholder="85 °C" onChange={(e) => setSetpoint(e.target.value)} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor={`${uid}-db`}>{t("eqStandards.deadband", "Deadband")}</Label>
          <Input id={`${uid}-db`} value={deadband} placeholder="2 °C" onChange={(e) => setDeadband(e.target.value)} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1">
          <Label htmlFor={`${uid}-vendor`}>{t("eqStandards.vendor", "Vendor (optional)")}</Label>
          <Input id={`${uid}-vendor`} value={vendor} placeholder="fanuc" onChange={(e) => setVendor(e.target.value)} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor={`${uid}-native`}>{t("eqStandards.nativeCode", "Native code (optional)")}</Label>
          <Input id={`${uid}-native`} value={nativeCode} placeholder="SRVO-050" onChange={(e) => setNativeCode(e.target.value)} />
        </div>
      </div>
      <div className="grid gap-1">
        <Label htmlFor={`${uid}-label`}>{t("eqStandards.label", "Label")}</Label>
        <Input id={`${uid}-label`} value={label} onChange={(e) => setLabel(e.target.value)} />
      </div>
      <div className="grid gap-1">
        <Label htmlFor={`${uid}-rat`}>{t("eqStandards.rationalization", "Rationalization")}</Label>
        <Input id={`${uid}-rat`} value={rationalization} placeholder={t("eqStandards.rationalizationHint", "Why this alarm exists / operator action")} onChange={(e) => setRationalization(e.target.value)} />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox checked={isSuppressed} onCheckedChange={(v) => setIsSuppressed(Boolean(v))} />
        {t("eqStandards.suppressDesign", "Design suppression (out-of-service — never raises)")}
      </label>
      <SheetFooter>
        <Button variant="outline" onClick={() => layer.close()}>{t("common.cancel", "Cancel")}</Button>
        <Button onClick={submit} disabled={pending}><CheckCircle2 className="mr-1 h-4 w-4" />{t("eqStandards.save", "Save mapping")}</Button>
      </SheetFooter>
    </div>
  );
}

// ── Sheet: submit change request ──────────────────────────────────────────────
type AttrDataType = "bool" | "int" | "float" | "string" | "json" | "enum";
const ATTR_DATA_TYPES: AttrDataType[] = ["string", "int", "float", "bool", "json", "enum"];
interface AttrRow { name: string; dataType: AttrDataType; unit: string; required: boolean; }

/** Payload the CR carries — a REAL proposed schema (no longer an empty {} default). */
interface SubmitCrValue {
  targetTypeKey: string;
  kind: "new_type" | "modify" | "deprecate";
  semverBump?: "major" | "minor" | "patch";
  proposedSchema: {
    parentTypeKey?: string;
    attributesSchema: Array<{ name: string; dataType: AttrDataType; unit?: string; required?: boolean }>;
    supportedCommands: Array<{ name: string }>;
  };
}

function SubmitCrForm({
  parentOptions, canView, pending, onSubmit,
}: {
  parentOptions: TreeNode[];
  canView: boolean;
  pending: boolean;
  onSubmit: (v: SubmitCrValue, done: () => void) => void;
}) {
  const { t } = useTranslation();
  const { layer, done } = useCloseOwnLayer();
  const uid = useId();
  const [targetTypeKey, setTargetTypeKey] = useState("");
  const [kind, setKind] = useState<"new_type" | "modify" | "deprecate">("modify");
  const [semverBump, setSemverBump] = useState<"major" | "minor" | "patch">("minor");
  const [parentTypeKey, setParentTypeKey] = useState("");
  const [attrs, setAttrs] = useState<AttrRow[]>([]);
  const [cmds, setCmds] = useState<string[]>([]);

  const dirty = targetTypeKey !== "" || kind !== "modify" || semverBump !== "minor" || parentTypeKey !== "" || attrs.length > 0 || cmds.length > 0;
  useEffect(() => { layer.setDirty(dirty); }, [dirty]); // eslint-disable-line react-hooks/exhaustive-deps

  // Flatten the tree for the parent <select>.
  const flatKeys = useMemo(() => {
    const out: string[] = [];
    const walk = (nodes: TreeNode[]) => { for (const n of nodes) { out.push(n.typeKey); walk(n.children); } };
    walk(parentOptions);
    return out;
  }, [parentOptions]);

  // Prefill source — resolve the current published type for the entered targetTypeKey.
  const key = targetTypeKey.trim();
  const resolveQ = trpc.equipmentStandards.resolveType.useQuery(
    { typeKey: key },
    { enabled: canView && key.length > 0, retry: false },
  );
  const resolved = resolveQ.data as ResolvedType | undefined;
  const hasResolved = !!resolved && !resolveQ.isError;

  // Copy the merged current schema into the editors so the change ADDS to (never
  // silently replaces/empties) the existing type — the fix for the hierarchy-wipe bug.
  const prefill = () => {
    if (!resolved) return;
    setAttrs(resolved.attributesSchema.map((a) => ({
      name: a.name, dataType: (a.dataType as AttrDataType) ?? "string", unit: a.unit ?? "", required: a.required ?? false,
    })));
    setCmds(resolved.supportedCommands.map((c) => c.name));
    // Parent = the node just above self in the resolved inheritance chain.
    const chain = resolved.inheritanceChain;
    setParentTypeKey(chain.length >= 2 ? chain[chain.length - 2] : "");
    toast.success(t("eqStandards.crPrefilled", "Loaded current schema — edit below."));
  };

  const submit = () => {
    if (!key) { toast.error(t("eqStandards.targetRequired", "Target type key is required.")); return; }
    const attributesSchema = attrs
      .filter((a) => a.name.trim())
      .map((a) => ({ name: a.name.trim(), dataType: a.dataType, unit: a.unit.trim() || undefined, required: a.required || undefined }));
    const supportedCommands = cmds.filter((c) => c.trim()).map((c) => ({ name: c.trim() }));
    onSubmit({
      targetTypeKey: key, kind, semverBump,
      proposedSchema: { parentTypeKey: parentTypeKey.trim() || undefined, attributesSchema, supportedCommands },
    }, done);
  };

  return (
    <div className="grid gap-3">
      <div className="grid gap-1">
        <Label htmlFor={`${uid}-target`}>{t("eqStandards.targetType", "Target type key")}</Label>
        <div className="flex items-center gap-2">
          <Input id={`${uid}-target`} value={targetTypeKey} placeholder="Robot" onChange={(e) => setTargetTypeKey(e.target.value)} />
          <Button type="button" variant="outline" size="sm" className="h-9 shrink-0" disabled={!hasResolved} onClick={prefill}>
            <Layers className="mr-1 h-4 w-4" />{t("eqStandards.crPrefill", "Prefill")}
          </Button>
        </div>
        {key.length > 0 && resolveQ.isFetching && (
          <Text tone="muted" variant="caption">{t("eqStandards.loading", "Loading…")}</Text>
        )}
        {key.length > 0 && !resolveQ.isFetching && !hasResolved && (
          <Text tone="muted" variant="caption">{t("eqStandards.crNoResolve", "No existing published type for this key — a new type will be created on publish.")}</Text>
        )}
        {hasResolved && !resolveQ.isFetching && (
          <Text tone="muted" variant="caption">{t("eqStandards.crPrefillHint", "Click Prefill to load current attributes/commands so your change adds to them instead of replacing the type.")}</Text>
        )}
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div className="grid gap-1">
          <Label htmlFor={`${uid}-kind`}>{t("eqStandards.kind", "Kind")}</Label>
          <Select value={kind} onValueChange={(v) => setKind(v as typeof kind)}>
            <SelectTrigger id={`${uid}-kind`} className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              {(["new_type", "modify", "deprecate"] as const).map((k) => (
                <SelectItem key={k} value={k}>{t(`eqStandards.crKind.${k}`, k)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1">
          <Label htmlFor={`${uid}-bump`}>{t("eqStandards.semverBump", "SemVer bump")}</Label>
          <Select value={semverBump} onValueChange={(v) => setSemverBump(v as typeof semverBump)}>
            <SelectTrigger id={`${uid}-bump`} className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              {(["major", "minor", "patch"] as const).map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1">
          <Label htmlFor={`${uid}-parent`}>{t("eqStandards.parent", "Parent type")}</Label>
          {/* U11 — Select DS; "__none__" là sentinel cho "không cha (root)". */}
          <Select value={parentTypeKey || "__none__"} onValueChange={(v) => setParentTypeKey(v === "__none__" ? "" : v)}>
            <SelectTrigger id={`${uid}-parent`} className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">{t("eqStandards.noParent", "(none — root)")}</SelectItem>
              {flatKeys.map((k) => <SelectItem key={k} value={k}>{k}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Attributes editor */}
      <div className="grid gap-1">
        <div className="flex items-center justify-between">
          <Label>{t("eqStandards.attributes", "Attributes")} ({attrs.length})</Label>
          <Button type="button" variant="ghost" size="sm" className="h-7"
            onClick={() => setAttrs((a) => [...a, { name: "", dataType: "string", unit: "", required: false }])}>
            <Plus className="mr-1 h-3.5 w-3.5" />{t("eqStandards.addAttr", "Add attribute")}
          </Button>
        </div>
        {attrs.length === 0 ? (
          <Text tone="muted" variant="caption">{t("eqStandards.crNoAttrs", "No attributes yet — prefill or add rows.")}</Text>
        ) : (
          <div className="space-y-1">
            {attrs.map((a, i) => (
              <div key={i} className="flex items-center gap-1">
                <Input className="h-8 flex-1" placeholder={t("eqStandards.attrName", "name")} value={a.name}
                  onChange={(e) => setAttrs((arr) => arr.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
                <Select value={a.dataType}
                  onValueChange={(v) => setAttrs((arr) => arr.map((x, j) => j === i ? { ...x, dataType: v as AttrDataType } : x))}>
                  <SelectTrigger size="sm" className="w-24 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ATTR_DATA_TYPES.map((dt) => <SelectItem key={dt} value={dt}>{dt}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Input className="h-8 w-20" placeholder={t("eqStandards.unit", "unit")} value={a.unit}
                  onChange={(e) => setAttrs((arr) => arr.map((x, j) => j === i ? { ...x, unit: e.target.value } : x))} />
                <label className="flex items-center gap-1 text-xs text-muted-foreground" title={t("eqStandards.required", "Required")}>
                  <Checkbox checked={a.required}
                    onCheckedChange={(v) => setAttrs((arr) => arr.map((x, j) => j === i ? { ...x, required: Boolean(v) } : x))} />
                  {t("eqStandards.reqShort", "req")}
                </label>
                <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0"
                  onClick={() => setAttrs((arr) => arr.filter((_, j) => j !== i))}>
                  <XCircle className="h-4 w-4 text-muted-foreground" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Commands editor */}
      <div className="grid gap-1">
        <div className="flex items-center justify-between">
          <Label>{t("eqStandards.commands", "Commands")} ({cmds.length})</Label>
          <Button type="button" variant="ghost" size="sm" className="h-7" onClick={() => setCmds((c) => [...c, ""])}>
            <Plus className="mr-1 h-3.5 w-3.5" />{t("eqStandards.addCmd", "Add command")}
          </Button>
        </div>
        {cmds.length === 0 ? (
          <Text tone="muted" variant="caption">{t("eqStandards.crNoCmds", "No commands yet — prefill or add rows.")}</Text>
        ) : (
          <div className="space-y-1">
            {cmds.map((c, i) => (
              <div key={i} className="flex items-center gap-1">
                <Input className="h-8 flex-1" placeholder={t("eqStandards.cmdName", "command name")} value={c}
                  onChange={(e) => setCmds((arr) => arr.map((x, j) => j === i ? e.target.value : x))} />
                <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0"
                  onClick={() => setCmds((arr) => arr.filter((_, j) => j !== i))}>
                  <XCircle className="h-4 w-4 text-muted-foreground" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        {t("eqStandards.crHint", "After submission the CR goes pending → in-review → approved, then publish enforces the conformance + backward-compatibility gate.")}
      </p>
      <SheetFooter>
        <Button variant="outline" onClick={() => layer.close()}>{t("common.cancel", "Cancel")}</Button>
        <Button onClick={submit} disabled={pending}><Send className="mr-1 h-4 w-4" />{t("eqStandards.submit", "Submit")}</Button>
      </SheetFooter>
    </div>
  );
}
