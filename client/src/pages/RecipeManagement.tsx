/**
 * Sprint G2.2b — Machine Recipe management (CONFIG + VIEW only).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * SAFETY:
 *   - This page manages the recipe CATALOG (versioned parameter sets) and shows the
 *     deployment LEDGER. recipes.deploy / recipes.rollback ONLY flip the active
 *     version + write a recipe_deployments ledger row (the router guarantees this —
 *     no commandDispatcher, no driver write path).
 *   - To actually PUSH a recipe down to a real machine, use the HITL write-action
 *     flow in the AI Copilot. This page NEVER bypasses HITL.
 * RBAC via module 'machine_control':
 *   view = canView ; create = canCreate ; deploy/rollback/archive = canEdit.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Doc 81 Đợt 2 Task 6 — bố cục P3 (doc 81 §1.2 dòng Recipes, FE1 §2.5, FE2 §3):
 *  - Header một hàng (`PageHeaderCompact`): h1 · chip "Đẩy xuống máy qua HITL" (câu banner HITL cũ, trong
 *    popover) · bộ chọn máy gọn (EntityPicker — cùng giao diện MachineSelect, cùng nguồn
 *    `machineRecipe.machines.list` như card "Xem theo máy" 146 px cũ) + recipe đang chạy của máy đó ·
 *    "Lưu phiên bản mới".
 *  - `SplitListDetail` mainRegion="detail": danh sách MÃ recipe bên trái (toolbar: chip `?filter=pending`
 *    + đếm); MAIN = chi tiết mã đang chọn (`?code=`), một hàng công cụ duy nhất = tên mã + tab
 *    (`?tab=`) Tham số / Phiên bản (VersionHistoryPanel) / Duyệt / Triển khai / Máy đang chạy. Chưa chọn
 *    mã ⇒ MAIN là sổ triển khai mọi máy (card "Lịch sử triển khai" cũ).
 *  - Tạo phiên bản = sheet `?flyout=recipe-new`; duyệt = sheet `?flyout=recipe-approve&flyoutId=<id>`;
 *    triển khai = drawer `?flyout=recipe-deploy&flyoutId=<id>` — MỘT máy, MỘT lượt `deploy` mỗi lần xác nhận
 *    (R-2-n: đúng năng lực dialog cũ; triển khai nhiều máy là quyết định của chủ dự án); giữ cổng
 *    đã-duyệt + quyền + nút xác nhận như dialog cũ. Nút "Tất cả mã" bỏ chọn mã ⇒ về sổ mọi máy.
 *  - Rollback = RollbackConfirm `requireReason={false}` `requireOtp={false}` (hợp đồng cũ: AlertDialog,
 *    không lý do, không OTP — R-2-g). Lưu trữ vẫn AlertDialog. Golden vẫn một nút bật/tắt.
 *  - Lỗi cổng recipe CHẶT (Đợt 1C: `recipeArchived` khi triển khai, `recipeRetired` khi rollback) hiện
 *    trong khối role=alert ngay cạnh hành động (ngoài toast như cũ).
 *  Không thủ tục, input, cổng hay thông điệp lỗi nào đổi; mỗi mutation invalidate đúng như trước.
 */
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { trpc } from "@/lib/trpc";
import { mapTrpcError, toastTrpcError } from "@/lib/trpcErrors";
import { useTranslation } from "react-i18next";
import { usePermissions } from "@/_core/hooks/usePermissions";
import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { ViewOnlyBadge } from "@/components/PermissionGate";
import {
  PageContainer, PageHeaderCompact, NoticeChip, StatusBadge, SplitListDetail, FlyoutHost, useFlyout, useCloseOwnLayer,
  VersionHistoryPanel, JsonDiffView, RollbackConfirm, EntityPicker,
  type BadgeVariant, type FlyoutApi, type FlyoutDefinition, type VersionRow, type EntityOption,
} from "@/components/patterns";
import { useLocation, useSearch } from "wouter";
import { navItems } from "@/lib/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { FlaskConical, Plus, AlertTriangle, RotateCcw, Rocket, ShieldCheck, Eye, GitCompare, Star, History, RefreshCw, User, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type RecipeStatus = "draft" | "active" | "archived";

// Recipe status → solid shadcn <Badge> variant, unified onto the shared
// <StatusBadge> (W4). active→primary, draft→secondary, archived→outline.
const RECIPE_STATUS_MAP: Record<string, { variant: BadgeVariant }> = {
  active: { variant: "default" },
  draft: { variant: "secondary" },
};

interface NewVersionForm {
  code: string;
  name: string;
  payloadText: string;
  notes: string;
}

const emptyNewVersion: NewVersionForm = { code: "", name: "", payloadText: "{\n  \n}", notes: "" };

/**
 * U9 (doc 26) — khung payload mẫu theo loại recipe. Nút "Chèn mẫu" điền skeleton
 * JSON HỢP LỆ vào textarea để người mới đỡ gõ sai cú pháp — chỉ hỗ trợ, không bắt buộc.
 */
const RECIPE_TEMPLATE_KINDS = ["aoi", "spi", "generic"] as const;
type RecipeTemplateKind = (typeof RECIPE_TEMPLATE_KINDS)[number];
const RECIPE_TEMPLATES: Record<RecipeTemplateKind, Record<string, unknown>> = {
  aoi: {
    inspection: { algorithm: "", sensitivity: 0.8 },
    thresholds: { minDefectArea: 0, maxDefectArea: 0 },
    lighting: { top: 100, side: 80 },
    roi: [],
  },
  spi: {
    measurement: { heightMin: 0, heightMax: 0, volumeMin: 0, volumeMax: 0 },
    offset: { x: 0, y: 0 },
    pads: [],
  },
  generic: {
    parameters: {},
    notes: "",
  },
};

/** Tab chi tiết (`?tab=`). Mặc định "versions" — cùng nội dung chính trang cũ hiện khi chọn mã. */
const DETAIL_TABS = ["params", "versions", "approval", "deploy", "machines"] as const;
type DetailTab = (typeof DETAIL_TABS)[number];
const DEFAULT_TAB: DetailTab = "versions";

/** Hàng `listVersions` — chỉ các trường trang đọc. */
type VersionData = {
  id: number;
  code: string;
  name: string;
  version: number;
  payload: unknown;
  status: string;
  isGolden?: boolean | null;
  checksum?: string | null;
  notes?: string | null;
  machineId?: number | null;
  createdBy?: number | null;
  createdByName?: string | null;
  createdAt?: string | Date | null;
  approvedBy?: number | null;
  approvalNote?: string | null;
};
/** Hàng `deployments.list`. */
type DeploymentData = {
  id: number;
  recipeId: number;
  machineId: number;
  machineName?: string | null;
  recipeCode?: string | null;
  recipeVersion?: number | null;
  deployedBy?: number | null;
  deployedAt?: string | Date | null;
  status: string;
  previousRecipeId?: number | null;
  notes?: string | null;
};
type MachineData = { id: number; code?: string | null; name?: string | null };
type DeployInput = { recipeId: number; machineId: number; notes: string | null };

const machineLabel = (m: MachineData | undefined, id: number) => m?.name ?? m?.code ?? `#${id}`;

/** Đọc/ghi một tham số URL của trang (replace — không thêm mục lịch sử), giữ mọi tham số khác. */
function useUrlParam(name: string): [string | null, (value: string | null) => void] {
  const search = useSearch();
  const [location, setLocation] = useLocation();
  const value = useMemo(() => new URLSearchParams(search).get(name), [search, name]);
  const set = (v: string | null) => {
    const p = new URLSearchParams(search);
    if (v == null || v === "") p.delete(name);
    else p.set(name, v);
    const qs = p.toString();
    setLocation(qs ? `${location}?${qs}` : location, { replace: true });
  };
  return [value, set];
}

/** Trải payload JSON thành lưới tham số (đường dẫn · giá trị · kiểu) — chỉ đọc. */
function flattenPayload(value: unknown, prefix = ""): Array<{ path: string; value: string; type: string }> {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return prefix ? [{ path: prefix, value: "{}", type: "object" }] : [];
    return entries.flatMap(([k, v]) => flattenPayload(v, prefix ? `${prefix}.${k}` : k));
  }
  if (Array.isArray(value)) return [{ path: prefix, value: JSON.stringify(value), type: "array" }];
  return [{ path: prefix, value: value === null ? "null" : String(value), type: value === null ? "null" : typeof value }];
}

/** useFlyout() cho đoạn JSX nằm trong FlyoutHost của chính trang. */
function WithFlyout({ children }: { children: (api: FlyoutApi) => ReactNode }) {
  return <>{children(useFlyout())}</>;
}

/** Khối lỗi role=alert (cổng chặt Đợt 1C) — đọc được, có nút đóng. */
function ErrorNotice({ title, message, onDismiss }: { title: ReactNode; message: string; onDismiss?: () => void }) {
  const { t } = useTranslation();
  return (
    <div role="alert" className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="font-medium">{title}</div>
        <div>{message}</div>
      </div>
      {onDismiss && (
        <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={onDismiss}>
          {t("recipes.dismiss", "Đóng")}
        </Button>
      )}
    </div>
  );
}

export default function RecipeManagement() {
  const { t } = useTranslation();
  const { hasPermission } = usePermissions();
  const { user } = useAuth();
  const canView = hasPermission("machine_control", "canView");
  const canCreate = hasPermission("machine_control", "canCreate");
  const canEdit = hasPermission("machine_control", "canEdit");
  // U4 (doc 26 §2.4) — hiện-nhưng-khoá: lý do khi thiếu quyền điều khiển máy.
  const createReason = !canCreate
    ? t("common.gate.needPerm", "Requires {{perm}} permission", { perm: "machine_control" })
    : undefined;
  const editReason = !canEdit
    ? t("common.gate.needPerm", "Requires {{perm}} permission", { perm: "machine_control" })
    : undefined;

  const utils = trpc.useUtils();

  const codesQuery = trpc.machineRecipe.recipes.listCodes.useQuery(undefined, { enabled: canView });
  // Doc 81 Đợt 2 Task 6 — mã đang chọn nằm trong URL (`?code=`, F5 giữ; flyout duyệt/triển khai dựa vào nó).
  const [codeParam, setCodeParam] = useUrlParam("code");
  const selectedCode = codeParam != null && codeParam.length > 0 ? codeParam : null;
  const [tabParam, setTabParam] = useUrlParam("tab");

  // U15 (doc 26 §2.1) — lối vào theo MÁY: KTV chọn máy → thấy recipe đang ACTIVE
  // của máy đó mà không cần biết trước mã. Song song với trục theo-mã hiện có.
  const search = useSearch();
  const [selectedMachineId, setSelectedMachineId] = useState<number | null>(null);

  // Doc 80 Đợt 1 Task 2 (HUB-03) — deep-link `?filter=pending` từ Engineering Hub
  // (trước bản vá: bị BỎ QUA, trang chỉ đọc `machineId`). Lọc danh sách mã xuống
  // còn mã có phiên bản CẦN CHÚ Ý (draft chưa duyệt, hoặc RCP-06: active chưa duyệt).
  const filterPending = useMemo(() => new URLSearchParams(search).get("filter") === "pending", [search]);
  const [showPendingOnly, setShowPendingOnly] = useState(false);
  useEffect(() => {
    if (filterPending) setShowPendingOnly(true);
  }, [filterPending]);
  // Fix round 1 (review minor) — đến từ Hub `?filter=pending` ⇒ tab mặc định là "Duyệt" (việc cần làm);
  // `?tab=` hợp lệ trong URL vẫn thắng.
  const defaultTab: DetailTab = filterPending ? "approval" : DEFAULT_TAB;
  const activeTab: DetailTab = (DETAIL_TABS as readonly string[]).includes(tabParam ?? "") ? (tabParam as DetailTab) : defaultTab;

  const versionsQuery = trpc.machineRecipe.recipes.listVersions.useQuery(
    { code: selectedCode ?? "" },
    { enabled: canView && selectedCode != null && selectedCode.length > 0 },
  );

  const deploymentsQuery = trpc.machineRecipe.deployments.list.useQuery(
    { limit: 100 },
    { enabled: canView },
  );

  // W5-22 (c) — danh sách máy cho machine-picker (thay ô number thô).
  const machinesQuery = trpc.machineRecipe.machines.list.useQuery(undefined, { enabled: canView });

  // U15 — sổ triển khai của riêng máy đang chọn (đọc-only, không ghi DB); bản
  // status="deployed" mới nhất chính là recipe máy đó đang chạy.
  const machineDeploymentsQuery = trpc.machineRecipe.deployments.list.useQuery(
    { machineId: selectedMachineId ?? 0, limit: 20 },
    { enabled: canView && selectedMachineId != null },
  );

  // W5-22 (b) — genealogy (recipe_load_log) của code đang chọn.
  const genealogyQuery = trpc.machineRecipe.recipes.genealogy.useQuery(
    { code: selectedCode ?? "", limit: 200 },
    { enabled: canView && selectedCode != null && selectedCode.length > 0 },
  );

  const invalidateAll = () => {
    void utils.machineRecipe.recipes.listCodes.invalidate();
    if (selectedCode) {
      void utils.machineRecipe.recipes.listVersions.invalidate({ code: selectedCode });
      void utils.machineRecipe.recipes.genealogy.invalidate({ code: selectedCode, limit: 200 });
    }
    void utils.machineRecipe.deployments.list.invalidate();
  };

  // ── Approve (W2-9 — second-approver / segregation of duties) — sheet `recipe-approve` ──
  const approve = trpc.machineRecipe.recipes.approve.useMutation({
    onSuccess: () => { toast.success(t("recipes.toastApproved")); invalidateAll(); },
    onError: (e) => toastTrpcError(e),
  });

  // ── Deploy — drawer `recipe-deploy`: MỘT máy, MỘT lượt gọi mỗi lần xác nhận (như dialog cũ — R-2-n) ──
  // Toast + invalidate ở hook của TRANG ⇒ vẫn chạy đúng khi drawer đã đóng trong lúc chờ server.
  const deploy = trpc.machineRecipe.recipes.deploy.useMutation({
    onSuccess: () => { toast.success(t("recipes.toastDeployed")); invalidateAll(); },
    onError: (e) => toastTrpcError(e),
  });

  // ── Rollback (RollbackConfirm, hợp đồng cũ: không lý do, không OTP) ──
  // Đợt 1C — lời từ chối của cổng chặt (recipeRetired…) giữ lại trong UI cạnh sổ, không chỉ trong toast.
  const [rollbackError, setRollbackError] = useState<{ machineId: number; message: string } | null>(null);
  const rollback = trpc.machineRecipe.recipes.rollback.useMutation({
    onSuccess: () => { toast.success(t("recipes.toastRolledBack")); setRollbackError(null); invalidateAll(); },
    onError: (e, vars) => { toastTrpcError(e); setRollbackError({ machineId: vars.machineId, message: mapTrpcError(e) }); },
  });

  // ── W5-22 (a): Golden/master toggle ──
  const setGolden = trpc.machineRecipe.recipes.setGolden.useMutation({
    onSuccess: (row) => { toast.success(row.isGolden ? t("recipes.toastGoldenSet") : t("recipes.toastGoldenUnset")); invalidateAll(); },
    onError: (e) => toastTrpcError(e),
  });

  // ── Archive (AlertDialog confirm) ──
  const [archiveTarget, setArchiveTarget] = useState<{ id: number; version: number } | null>(null);
  const archive = trpc.machineRecipe.recipes.archive.useMutation({
    onSuccess: () => { toast.success(t("recipes.toastArchived")); setArchiveTarget(null); invalidateAll(); },
    onError: (e) => toastTrpcError(e),
  });

  // W3-11 — phiên bản đang xem ở tab Tham số (nút "Xem" của tab Phiên bản đặt nó).
  const [paramsVersionId, setParamsVersionId] = useState<number | null>(null);

  // Đổi code → bỏ phiên bản đang xem; VersionHistoryPanel dựng lại theo mã (key) để mặc định Golden áp lại.
  const selectCode = (code: string) => {
    setCodeParam(code);
    setParamsVersionId(null);
  };

  const codes = codesQuery.data ?? [];
  // HUB-03 — chỉ mã có phiên bản CẦN CHÚ Ý (`pendingCount` từ `listCodes`).
  const visibleCodes = showPendingOnly ? codes.filter((c) => c.pendingCount > 0) : codes;
  const versions = (versionsQuery.data ?? []) as VersionData[];
  const deployments = (deploymentsQuery.data ?? []) as DeploymentData[];
  const machineList = (machinesQuery.data ?? []) as MachineData[];
  const genealogy = genealogyQuery.data ?? [];

  // U15 — recipe đang chạy của máy đang chọn (nếu có) từ sổ triển khai theo máy.
  // Bản đang chạy = row mới nhất status="deployed" (rollback tạo row deployed mới,
  // đánh dấu row cũ "rolled_back"); list đã sắp deployedAt giảm dần nên find đầu tiên.
  const machineDeployments = (machineDeploymentsQuery.data ?? []) as DeploymentData[];
  const activeDeployment = useMemo(
    () => machineDeployments.find((d) => d.status === "deployed") ?? null,
    [machineDeployments],
  );

  // W5-22 (a) — phiên bản golden (baseline) của code đang chọn, nếu có.
  const goldenVersion = useMemo(() => versions.find((v) => v.isGolden) ?? null, [versions]);

  // U6 (doc 26) — tra phiên bản theo id (sheet duyệt / drawer triển khai nhúng ngữ cảnh của nó).
  const versionById = useMemo(() => new Map(versions.map((v) => [v.id, v] as const)), [versions]);

  // W3-11 — phiên bản ở tab Tham số: bản đã bấm "Xem", nếu không thì bản đang chạy → Golden → mới nhất.
  const paramsVersion = useMemo(
    () =>
      (paramsVersionId != null ? versions.find((v) => v.id === paramsVersionId) : undefined) ??
      versions.find((v) => v.status === "active") ??
      goldenVersion ??
      versions[0] ??
      null,
    [versions, paramsVersionId, goldenVersion],
  );

  // Tab Triển khai — sổ của RIÊNG mã đang chọn; tab Máy đang chạy — máy có bản "deployed" MỚI NHẤT
  // (cùng vị từ với activeDeployment) thuộc mã này, trong 100 lần triển khai gần nhất của sổ.
  const codeDeployments = useMemo(
    () => (selectedCode == null ? [] : deployments.filter((d) => d.recipeCode === selectedCode)),
    [deployments, selectedCode],
  );
  const runningOnCode = useMemo(() => {
    if (selectedCode == null) return [];
    const seen = new Set<number>();
    const out: DeploymentData[] = [];
    for (const d of deployments) {
      if (seen.has(d.machineId) || d.status !== "deployed") continue;
      seen.add(d.machineId);
      if (d.recipeCode === selectedCode) out.push(d);
    }
    return out;
  }, [deployments, selectedCode]);
  const pendingInCode = useMemo(
    () => versions.filter((v) => v.approvedBy == null && (v.status === "draft" || v.status === "active")).length,
    [versions],
  );
  const machineOptions = useMemo<EntityOption[]>(
    () => machineList.map((m) => ({ value: m.id, label: machineLabel(m, m.id), sublabel: m.name && m.code ? m.code : undefined })),
    [machineList],
  );

  // U15 — deep-link ?machineId: mở sẵn máy khi điều hướng từ trang khác (Đợt 1).
  useEffect(() => {
    const raw = new URLSearchParams(search).get("machineId");
    if (!raw) return;
    const id = Number(raw);
    if (Number.isInteger(id) && id > 0) setSelectedMachineId(id);
  }, [search]);

  if (!canView) {
    return (
      <DashboardLayout title={t("recipes.title")} navItems={navItems} currentPath="/recipes">
        <div className="p-6 text-muted-foreground">{t("recipes.noViewPermission")}</div>
      </DashboardLayout>
    );
  }

  const versionsLoaded = !versionsQuery.isLoading;
  const findVersion = (id: string | null) => (id != null && /^\d+$/.test(id) ? versionById.get(Number(id)) ?? null : null);
  const missingVersion = (id: string | null) => (
    <p className="py-6 text-center text-sm text-muted-foreground">
      {versionsLoaded
        ? t("recipes.versionNotFound", "Không tìm thấy phiên bản #{{id}} trong mã đang chọn.", { id: id ?? "" })
        : t("common.loading", "Đang tải…")}
    </p>
  );

  // ── Flyouts (một stack sheet phải; URL `?flyout=&flyoutId=` là nguồn sự thật) ──
  const flyouts: Record<string, FlyoutDefinition> = {};
  if (canCreate) {
    flyouts["recipe-new"] = {
      size: "lg",
      title: t("recipes.newVersion"),
      description: t("recipes.newVersionDesc"),
      render: () => <CreateVersionForm initialCode={selectedCode ?? ""} canCreate={canCreate} onSaved={invalidateAll} />,
    };
  }
  if (canEdit) {
    flyouts["recipe-approve"] = {
      size: "lg",
      title: (id) => {
        const v = findVersion(id);
        return `${t("recipes.approve")}${v ? ` — v${v.version}` : ""}`;
      },
      description: t("recipes.approveDesc"),
      render: (layer) => {
        const v = findVersion(layer.id);
        if (!v) return missingVersion(layer.id);
        return (
          <ApproveForm
            key={v.id}
            version={v}
            golden={goldenVersion}
            isOwn={v.createdBy != null && v.createdBy === user?.id}
            pending={approve.isPending}
            approveAsync={(input) => approve.mutateAsync(input)}
          />
        );
      },
    };
    flyouts["recipe-deploy"] = {
      size: "md",
      title: (id) => {
        const v = findVersion(id);
        return `${t("recipes.deploy")}${v ? ` — ${v.code} v${v.version}` : ""}`;
      },
      description: t("recipes.deployDesc"),
      render: (layer) => {
        const v = findVersion(layer.id);
        if (!v) return missingVersion(layer.id);
        return (
          <DeployDrawer
            key={v.id}
            version={v}
            machines={machineList}
            machinesLoading={machinesQuery.isLoading}
            machinesError={machinesQuery.isError}
            pending={deploy.isPending}
            deployAsync={(input) => deploy.mutateAsync(input)}
          />
        );
      },
    };
  }

  const ledgerProps = {
    canEdit,
    editReason,
    rollbackPending: rollback.isPending,
    onRollback: (machineId: number) => rollback.mutate({ machineId }),
    rollbackError,
    onDismissError: () => setRollbackError(null),
  };

  const codesList = (
    <Table aria-label={t("recipes.codes")}>
      <TableHeader>
        <TableRow>
          <TableHead>{t("recipes.code")}</TableHead>
          <TableHead>{t("recipes.versionsCount")}</TableHead>
          <TableHead>{t("recipes.active")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {codesQuery.isLoading && (
          [0, 1, 2].map((i) => (
            <TableRow key={`sk-${i}`}>
              <TableCell><Skeleton className="h-4 w-24" /></TableCell>
              <TableCell><Skeleton className="h-4 w-8" /></TableCell>
              <TableCell><Skeleton className="h-4 w-10" /></TableCell>
            </TableRow>
          ))
        )}
        {!codesQuery.isLoading && codesQuery.isError && (
          <TableRow>
            <TableCell colSpan={3} className="text-center">
              <div className="flex flex-col items-center gap-2 py-3 text-sm text-destructive">
                <span>{t("recipes.loadError")}</span>
                <Button size="sm" variant="outline" onClick={() => void codesQuery.refetch()}>
                  <RefreshCw className="h-4 w-4 mr-1" /> {t("recipes.retry")}
                </Button>
              </div>
            </TableCell>
          </TableRow>
        )}
        {!codesQuery.isLoading && !codesQuery.isError && visibleCodes.length === 0 && (
          <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground">{t("recipes.empty")}</TableCell></TableRow>
        )}
        {!codesQuery.isLoading && !codesQuery.isError && visibleCodes.map((c) => (
          <TableRow
            key={c.code}
            tabIndex={0}
            aria-current={selectedCode === c.code ? "true" : undefined}
            className={cn("cursor-pointer", selectedCode === c.code && "bg-muted")}
            onClick={() => selectCode(c.code)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                selectCode(c.code);
              }
            }}
          >
            <TableCell className="font-medium">{c.code}<div className="text-xs text-muted-foreground">{c.name}</div></TableCell>
            <TableCell>{c.versions}</TableCell>
            <TableCell>{c.activeVersion != null ? <Badge>v{c.activeVersion}</Badge> : <span className="text-muted-foreground">—</span>}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );

  const listToolbar = (
    <>
      {/* Doc 80 Đợt 1 Task 2 (HUB-03) — deep-link `?filter=pending` từ Hub. */}
      {showPendingOnly && (
        <div
          className="inline-flex h-8 items-center gap-1 rounded-full border border-warning/40 bg-warning/10 pl-3 pr-1 text-xs text-muted-foreground"
          title={t("recipes.filteringPending", "Đang lọc: chỉ hiện mã có phiên bản cần chú ý")}
        >
          <span>{t("recipes.filterPendingChip", "Chỉ mã cần chú ý")}</span>
          <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => setShowPendingOnly(false)}>
            {t("recipes.showAll", "Xem tất cả")}
          </Button>
        </div>
      )}
      <span className="text-xs text-muted-foreground">{t("recipes.codeCount", "{{count}} mã", { count: visibleCodes.length })}</span>
      {/* Fix round 1 (review Important) — bỏ chọn mã ⇒ MAIN về sổ triển khai MỌI máy (trang cũ luôn hiện sổ này;
          hàng không có mã recipe chỉ có ở đó). Màn hẹp đã có "Quay lại danh sách". */}
      {selectedCode != null && (
        <Button
          size="sm" variant="ghost" className="ml-auto h-7 px-2 text-xs"
          title={t("recipes.allCodesHint", "Bỏ chọn mã — xem sổ triển khai của mọi máy")}
          onClick={() => setCodeParam(null)}
        >
          {t("recipes.allCodes", "Tất cả mã")}
        </Button>
      )}
    </>
  );

  const versionRows: VersionRow[] = versions.map((v) => ({
    id: v.id,
    label: `v${v.version}`,
    createdAt: v.createdAt ?? null,
    author: v.createdByName ?? (v.createdBy != null ? `#${v.createdBy}` : undefined),
    current: v.status === "active",
    content: v.payload,
    note: (
      <span className="flex items-center gap-1">
        <span className="truncate">{v.name}</span>
        <StatusBadge status={v.status} variant={RECIPE_STATUS_MAP[v.status]?.variant ?? "outline"} />
        {v.approvedBy != null
          ? <Badge variant="default" title={v.approvalNote ?? ""}>{t("recipes.approved")}</Badge>
          : <Badge variant="outline">{t("recipes.notApproved")}</Badge>}
        {v.isGolden && (
          <Badge variant="default" className="gap-1 bg-amber-500 text-white hover:bg-amber-500" title={t("recipes.goldenHint")}>
            <Star className="h-3 w-3 fill-current" /> {t("recipes.golden")}
          </Badge>
        )}
      </span>
    ),
  }));

  const detail = selectedCode == null ? null : (
    <WithFlyout>
      {(flyout) => (
        <Tabs value={activeTab} onValueChange={(v) => setTabParam(v)} className="flex h-full min-h-0 flex-col gap-2">
          {/* Thanh công cụ DUY NHẤT trong MAIN: tên mã + tab (một hàng ≤56 px). */}
          <div data-layout-toolbar="" style={{ maxHeight: 56 }} className="flex shrink-0 items-center gap-3 overflow-hidden px-2 pt-2">
            <h2 className="max-w-[14rem] shrink-0 truncate text-base font-semibold" title={selectedCode}>{selectedCode}</h2>
            {versions[0]?.name && <span className="hidden min-w-0 max-w-[12rem] truncate text-xs text-muted-foreground xl:inline">{versions[0].name}</span>}
            <TabsList aria-label={t("recipes.detailTabs", "Mục chi tiết recipe")} className="h-9 justify-start overflow-x-auto">
              <TabsTrigger value="params" className="min-h-8 flex-none text-xs">{t("recipes.tab.params", "Tham số")}</TabsTrigger>
              <TabsTrigger value="versions" className="min-h-8 flex-none text-xs">{t("recipes.tab.versions", "Phiên bản")}</TabsTrigger>
              <TabsTrigger value="approval" className="min-h-8 flex-none gap-1 text-xs">
                {t("recipes.tab.approval", "Duyệt")}
                {pendingInCode > 0 && <Badge variant="secondary" className="h-4 min-w-4 px-1 text-[10px]">{pendingInCode}</Badge>}
              </TabsTrigger>
              <TabsTrigger value="deploy" className="min-h-8 flex-none gap-1 text-xs">
                {t("recipes.tab.deploy", "Triển khai")}
                {codeDeployments.length > 0 && <Badge variant="secondary" className="h-4 min-w-4 px-1 text-[10px]">{codeDeployments.length}</Badge>}
              </TabsTrigger>
              <TabsTrigger value="machines" className="min-h-8 flex-none text-xs">{t("recipes.tab.machines", "Máy đang chạy")}</TabsTrigger>
            </TabsList>
          </div>

          {/* ── Tham số: lưới tham số (chỉ đọc) của một phiên bản — thay dialog "Xem payload" (W3-11) ── */}
          <TabsContent value="params" className="min-h-0 flex-1 space-y-2 overflow-auto px-2 pb-2">
            {versionsQuery.isLoading ? (
              <div className="space-y-2"><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-2/3" /></div>
            ) : versionsQuery.isError ? (
              <VersionsLoadError onRetry={() => void versionsQuery.refetch()} />
            ) : paramsVersion == null ? (
              <p className="py-6 text-center text-sm text-muted-foreground">{t("recipes.params.noVersions", "Mã này chưa có phiên bản.")}</p>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <Label htmlFor="recipe-params-version" className="text-xs text-muted-foreground">{t("recipes.params.version", "Phiên bản đang xem")}</Label>
                  <Select value={String(paramsVersion.id)} onValueChange={(v) => setParamsVersionId(Number(v))}>
                    <SelectTrigger id="recipe-params-version" className="h-7 w-28 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {versions.map((v) => <SelectItem key={v.id} value={String(v.id)}>v{v.version}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <StatusBadge status={paramsVersion.status} variant={RECIPE_STATUS_MAP[paramsVersion.status]?.variant ?? "outline"} />
                  <span className="max-w-[16rem] truncate font-mono text-muted-foreground" title={paramsVersion.checksum ?? ""}>
                    {t("recipes.checksum")}: {paramsVersion.checksum ?? "—"}
                  </span>
                </div>
                <ParamsGrid payload={paramsVersion.payload} />
              </>
            )}
          </TabsContent>

          {/* ── Phiên bản: VersionHistoryPanel (diff mặc định so với Golden — W5-22 (a)) + genealogy ── */}
          <TabsContent value="versions" className="min-h-0 flex-1 space-y-3 overflow-auto px-2 pb-2">
            <VersionHistoryPanel
              key={selectedCode}
              versions={versionRows}
              status={versionsQuery.isLoading ? "loading" : versionsQuery.isError ? "error" : "ready"}
              defaultBaseId={goldenVersion?.id ?? null}
              diffMaxHeightClass="max-h-[300px]"
              renderRowActions={(row) => {
                const v = versionById.get(Number(row.id));
                if (!v) return null;
                return (
                  <span className="inline-flex items-center gap-1">
                    {/* W3-11 — xem payload (lưới tham số, chỉ đọc) */}
                    <Button size="sm" variant="outline" onClick={() => { setParamsVersionId(v.id); setTabParam("params"); }}>
                      <Eye className="h-4 w-4 mr-1" /> {t("recipes.viewPayload", "Xem")}
                    </Button>
                    {/* W5-22 (a) — đánh dấu / bỏ đánh dấu Golden (baseline). */}
                    <Button
                      size="sm" variant={v.isGolden ? "default" : "outline"}
                      className={v.isGolden ? "bg-amber-500 hover:bg-amber-600 text-white" : undefined}
                      disabled={!canEdit || setGolden.isPending}
                      aria-label={v.isGolden ? t("recipes.unsetGolden") : t("recipes.setGolden")}
                      title={editReason ?? (v.isGolden ? t("recipes.unsetGolden") : t("recipes.setGolden"))}
                      onClick={() => setGolden.mutate({ id: v.id, isGolden: !v.isGolden })}
                    >
                      <Star className={`h-4 w-4 ${v.isGolden ? "fill-current" : ""}`} />
                    </Button>
                    {v.status !== "archived" && (
                      <Button
                        size="sm" variant="outline"
                        disabled={!canEdit || archive.isPending}
                        title={editReason}
                        onClick={() => setArchiveTarget({ id: v.id, version: v.version })}
                      >
                        {t("recipes.archive")}
                      </Button>
                    )}
                  </span>
                );
              }}
            />
            {versionsQuery.isError && <VersionsLoadError onRetry={() => void versionsQuery.refetch()} />}

            {/* W5-22 (b) — Genealogy (lịch sử thao tác recipe từ recipe_load_log) */}
            <div className="rounded-md border bg-muted/20 p-2">
              <div className="mb-2 flex items-center gap-1 text-xs font-medium text-muted-foreground">
                <History className="h-3.5 w-3.5" /> {t("recipes.genealogy")}
              </div>
              {genealogyQuery.isLoading ? (
                <div className="space-y-1"><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-2/3" /></div>
              ) : genealogyQuery.isError ? (
                <div className="flex items-center justify-center gap-2 py-2 text-xs text-destructive">
                  <span>{t("recipes.loadError")}</span>
                  <Button size="sm" variant="outline" className="h-6" onClick={() => void genealogyQuery.refetch()}>
                    <RefreshCw className="h-3.5 w-3.5 mr-1" /> {t("recipes.retry")}
                  </Button>
                </div>
              ) : genealogy.length === 0 ? (
                <p className="py-2 text-center text-xs text-muted-foreground">{t("recipes.genealogyEmpty")}</p>
              ) : (
                <ul className="max-h-[220px] space-y-1 overflow-auto text-xs">
                  {genealogy.map((g) => (
                    <li key={g.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 border-b border-border/50 pb-1 last:border-0">
                      <Badge variant="outline" className="font-mono">{t(`recipes.action.${g.action}`, g.action)}</Badge>
                      <span className="font-medium">v{g.recipeVersion ?? "—"}</span>
                      {g.machineId != null && <span className="text-muted-foreground">→ #{g.machineId}</span>}
                      {g.performedBy != null && <span className="text-muted-foreground">· user #{g.performedBy}</span>}
                      <span className="text-muted-foreground">· {g.createdAt ? new Date(g.createdAt).toLocaleString() : "—"}</span>
                      {g.notes && <span className="text-muted-foreground italic truncate max-w-[240px]" title={g.notes}>— {g.notes}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </TabsContent>

          {/* ── Duyệt: phiên bản + trạng thái duyệt; "Duyệt" mở sheet (W2-9, chặn tự duyệt) ── */}
          <TabsContent value="approval" className="min-h-0 flex-1 overflow-auto px-2 pb-2">
            <VersionTable
              versions={versions}
              loading={versionsQuery.isLoading}
              error={versionsQuery.isError}
              onRetry={() => void versionsQuery.refetch()}
              extraHead={<TableHead>{t("recipes.approvalNote")}</TableHead>}
              extraCell={(v) => <TableCell className="max-w-[16rem] truncate text-xs" title={v.approvalNote ?? ""}>{v.approvalNote ?? "—"}</TableCell>}
              action={(v) => {
                const isApproved = v.approvedBy != null;
                const isOwnRecipe = v.createdBy != null && v.createdBy === user?.id;
                if (isApproved) return null;
                return (
                  <Button
                    size="sm" variant="outline"
                    disabled={!canEdit || approve.isPending || isOwnRecipe}
                    title={editReason ?? (isOwnRecipe ? t("recipes.cannotApproveOwn") : undefined)}
                    onClick={() => flyout.open("recipe-approve", { id: v.id })}
                  >
                    <ShieldCheck className="h-4 w-4 mr-1" /> {t("recipes.approve")}
                  </Button>
                );
              }}
            />
          </TabsContent>

          {/* ── Triển khai: phiên bản (nút Triển khai → drawer nhiều máy) + sổ triển khai của mã (rollback) ── */}
          <TabsContent value="deploy" className="min-h-0 flex-1 space-y-3 overflow-auto px-2 pb-2">
            <VersionTable
              versions={versions}
              loading={versionsQuery.isLoading}
              error={versionsQuery.isError}
              onRetry={() => void versionsQuery.refetch()}
              action={(v) => {
                const isApproved = v.approvedBy != null;
                return (
                  <Button
                    size="sm" variant="outline"
                    disabled={!canEdit || deploy.isPending || !isApproved}
                    title={editReason ?? (!isApproved ? t("recipes.deployNeedsApproval") : undefined)}
                    onClick={() => flyout.open("recipe-deploy", { id: v.id })}
                  >
                    <Rocket className="h-4 w-4 mr-1" /> {t("recipes.deploy")}
                  </Button>
                );
              }}
            />
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">{t("recipes.deployHistory")} ({codeDeployments.length})</h3>
              <DeploymentLedger
                rows={codeDeployments}
                loading={deploymentsQuery.isLoading}
                error={deploymentsQuery.isError}
                onRetry={() => void deploymentsQuery.refetch()}
                {...ledgerProps}
              />
            </div>
          </TabsContent>

          {/* ── Máy đang chạy mã này (sổ triển khai, bản "deployed" mới nhất mỗi máy) ── */}
          <TabsContent value="machines" className="min-h-0 flex-1 space-y-2 overflow-auto px-2 pb-2">
            <Table aria-label={t("recipes.tab.machines", "Máy đang chạy")}>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("recipes.machine")}</TableHead>
                  <TableHead>{t("recipes.recipeVersion")}</TableHead>
                  <TableHead>{t("recipes.deployedBy")}</TableHead>
                  <TableHead>{t("recipes.deployedAt")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {deploymentsQuery.isLoading ? (
                  <TableRow><TableCell colSpan={4}><Skeleton className="h-4 w-full" /></TableCell></TableRow>
                ) : deploymentsQuery.isError ? (
                  <TableRow><TableCell colSpan={4} className="text-center text-sm text-destructive">{t("recipes.loadError")}</TableCell></TableRow>
                ) : runningOnCode.length === 0 ? (
                  <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">{t("recipes.noRunningMachines", "Chưa có máy nào đang chạy mã này.")}</TableCell></TableRow>
                ) : runningOnCode.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="font-medium">{d.machineName ? `${d.machineName} (#${d.machineId})` : `#${d.machineId}`}</TableCell>
                    <TableCell>{`${d.recipeCode} v${d.recipeVersion}`}</TableCell>
                    <TableCell>{d.deployedBy ?? "—"}</TableCell>
                    <TableCell className="text-xs">{d.deployedAt ? new Date(d.deployedAt).toLocaleString() : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <p className="text-xs text-muted-foreground">
              {t("recipes.runningMachinesNote", "Theo {{count}} lần triển khai gần nhất trong sổ.", { count: deployments.length })}
            </p>
          </TabsContent>
        </Tabs>
      )}
    </WithFlyout>
  );

  // Chưa chọn mã ⇒ MAIN là sổ triển khai MỌI máy (card "Lịch sử triển khai" cũ) + gợi ý chọn mã.
  const allDeployments = (
    <div className="h-full space-y-2 overflow-auto p-2">
      <h2 className="text-sm font-semibold">{t("recipes.deployHistory")} ({deployments.length})</h2>
      <p className="text-xs text-muted-foreground">
        {t("recipes.emptyDetailHint", "Chọn một mã recipe ở danh sách bên trái để xem tham số, phiên bản, duyệt và triển khai.")}
      </p>
      <DeploymentLedger
        rows={deployments}
        loading={deploymentsQuery.isLoading}
        error={deploymentsQuery.isError}
        onRetry={() => void deploymentsQuery.refetch()}
        {...ledgerProps}
      />
    </div>
  );

  return (
    <DashboardLayout title={t("recipes.title")} navItems={navItems} currentPath="/recipes">
      <FlyoutHost flyouts={flyouts}>
        {/* doc 81 Đợt 2 Task 2 — PageContainer: không đệm kép với <main> của shell. */}
        <PageContainer className="space-y-3">
          <WithFlyout>
            {(flyout) => (
              <PageHeaderCompact
                icon={<FlaskConical />}
                title={
                  <span className="flex items-center gap-2">
                    {t("recipes.title")}<ViewOnlyBadge module="machine_control" />
                  </span>
                }
                chips={
                  // SAFETY — HITL: câu banner cũ, nay trong popover của chip (không còn khối trên MAIN).
                  <NoticeChip kind="honesty" label={t("recipes.hitlChip", "Đẩy xuống máy qua HITL")}>
                    {t("recipes.hitlBanner")}
                  </NoticeChip>
                }
                actions={
                  <>
                    {/* U15 (doc 26 §2.1) — lối vào theo MÁY, gọn trong header (thay card 146 px). */}
                    <EntityPicker
                      options={machineOptions}
                      value={selectedMachineId}
                      onChange={(v) => setSelectedMachineId(v == null ? null : Number(v))}
                      loading={machinesQuery.isLoading}
                      placeholder={t("recipes.selectMachine", "Chọn máy")}
                      searchPlaceholder={t("recipes.searchMachine", "Tìm máy…")}
                      emptyText={t("recipes.noMachines", "Chưa có máy nào")}
                      aria-label={t("recipes.selectMachine", "Chọn máy")}
                      className="w-48"
                    />
                    {selectedMachineId != null && (
                      <RunningRecipe
                        loading={machineDeploymentsQuery.isLoading}
                        error={machineDeploymentsQuery.isError}
                        onRetry={() => void machineDeploymentsQuery.refetch()}
                        active={activeDeployment}
                        onOpen={selectCode}
                      />
                    )}
                    <Button size="sm" onClick={() => flyout.open("recipe-new")} disabled={!canCreate} title={createReason}>
                      <Plus className="h-4 w-4 mr-1" /> {t("recipes.newVersion")}
                    </Button>
                  </>
                }
              />
            )}
          </WithFlyout>

          <SplitListDetail
            layoutId="recipes"
            userId={user?.id ?? null}
            mainRegion="detail"
            listLabel={t("recipes.codes")}
            detailLabel={t("recipes.detailLabel", "Chi tiết recipe")}
            listToolbar={listToolbar}
            list={codesList}
            hasSelection={selectedCode != null}
            detail={detail}
            emptyDetail={allDeployments}
            onBack={() => setCodeParam(null)}
            heightClass="h-[calc(100dvh-9.25rem)] min-h-[28rem]"
          />
        </PageContainer>
      </FlyoutHost>

      {/* ── Archive confirm ── */}
      <AlertDialog open={archiveTarget != null} onOpenChange={(o) => { if (!o) setArchiveTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("recipes.archive")}</AlertDialogTitle>
            <AlertDialogDescription>
              {archiveTarget != null && t("recipes.confirmArchive", { version: archiveTarget.version })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("recipes.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { if (archiveTarget != null) archive.mutate({ id: archiveTarget.id }); }}
            >
              {t("recipes.archive")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>
  );
}

// ── Header: recipe đang chạy của máy đã chọn (U15) — đủ loading / lỗi / trống / có ─────────────

function RunningRecipe({
  loading, error, onRetry, active, onOpen,
}: { loading: boolean; error: boolean; onRetry: () => void; active: DeploymentData | null; onOpen: (code: string) => void }) {
  const { t } = useTranslation();
  return (
    <div data-testid="running-recipe" className="flex max-w-[18rem] items-center gap-1 text-xs">
      {loading ? (
        <span className="text-muted-foreground" aria-busy="true">{t("common.loading", "Đang tải…")}</span>
      ) : error ? (
        <>
          <span className="text-destructive">{t("recipes.loadError")}</span>
          <Button size="sm" variant="outline" className="h-7" onClick={onRetry}>
            <RefreshCw className="h-3.5 w-3.5 mr-1" /> {t("recipes.retry")}
          </Button>
        </>
      ) : active == null ? (
        <span className="truncate text-muted-foreground" title={t("recipes.noActiveRecipe", "Máy này chưa có recipe đang chạy.")}>
          {t("recipes.noActiveRecipe", "Máy này chưa có recipe đang chạy.")}
        </span>
      ) : (
        <>
          <span className="shrink-0 text-muted-foreground">{t("recipes.activeRecipe", "Recipe đang chạy")}:</span>
          {active.recipeCode != null ? (
            <Button
              size="sm" variant="outline" className="h-7 min-w-0"
              title={`${t("recipes.viewThisRecipe", "Xem chi tiết recipe")}${active.deployedAt ? ` · ${t("recipes.deployedAt")}: ${new Date(active.deployedAt).toLocaleString()}` : ""}`}
              onClick={() => onOpen(active.recipeCode as string)}
            >
              <span className="truncate">{`${active.recipeCode} v${active.recipeVersion}`}</span>
              <ArrowRight className="h-3.5 w-3.5 ml-1" />
            </Button>
          ) : (
            <span className="font-medium">#{active.recipeId}</span>
          )}
        </>
      )}
    </div>
  );
}

// ── Bảng phiên bản dùng cho tab Duyệt / Triển khai ─────────────────────────────────────────────

function VersionsLoadError({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-center gap-2 py-3 text-sm text-destructive">
      <span>{t("recipes.loadError")}</span>
      <Button size="sm" variant="outline" onClick={onRetry}>
        <RefreshCw className="h-4 w-4 mr-1" /> {t("recipes.retry")}
      </Button>
    </div>
  );
}

function VersionTable({
  versions, loading, error, onRetry, action, extraHead, extraCell,
}: {
  versions: VersionData[];
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  action: (v: VersionData) => ReactNode;
  extraHead?: ReactNode;
  extraCell?: (v: VersionData) => ReactNode;
}) {
  const { t } = useTranslation();
  const cols = 6 + (extraHead ? 1 : 0);
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t("recipes.version")}</TableHead>
          <TableHead>{t("recipes.name")}</TableHead>
          <TableHead>{t("recipes.createdByCol", "Người tạo")}</TableHead>
          <TableHead>{t("recipes.status")}</TableHead>
          <TableHead>{t("recipes.approvalStatus")}</TableHead>
          {extraHead}
          <TableHead className="text-right">{t("recipes.actions")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {loading && [0, 1, 2].map((i) => (
          <TableRow key={`vsk-${i}`}><TableCell colSpan={cols}><Skeleton className="h-4 w-full" /></TableCell></TableRow>
        ))}
        {!loading && error && (
          <TableRow><TableCell colSpan={cols}><VersionsLoadError onRetry={onRetry} /></TableCell></TableRow>
        )}
        {!loading && !error && versions.length === 0 && (
          <TableRow><TableCell colSpan={cols} className="text-center text-muted-foreground">{t("recipes.empty")}</TableCell></TableRow>
        )}
        {!loading && !error && versions.map((v) => (
          <TableRow key={v.id} data-recipe-id={v.id}>
            <TableCell className="font-medium">v{v.version}</TableCell>
            <TableCell>{v.name}</TableCell>
            <TableCell className="text-xs">
              {v.createdByName ?? (v.createdBy != null ? `#${v.createdBy}` : <span className="text-muted-foreground">—</span>)}
            </TableCell>
            <TableCell><StatusBadge status={v.status} variant={RECIPE_STATUS_MAP[v.status]?.variant ?? "outline"} /></TableCell>
            <TableCell>
              {v.approvedBy != null
                ? <Badge variant="default" title={v.approvalNote ?? ""}>{t("recipes.approved")}</Badge>
                : <Badge variant="outline">{t("recipes.notApproved")}</Badge>}
            </TableCell>
            {extraCell?.(v)}
            <TableCell className="text-right">{action(v)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

// ── Lưới tham số (chỉ đọc) ─────────────────────────────────────────────────────────────────────

function ParamsGrid({ payload }: { payload: unknown }) {
  const { t } = useTranslation();
  const rows = useMemo(() => flattenPayload(payload), [payload]);
  return (
    <div className="space-y-2">
      <Table aria-label={t("recipes.tab.params", "Tham số")}>
        <TableHeader>
          <TableRow>
            <TableHead>{t("recipes.params.key", "Tham số")}</TableHead>
            <TableHead>{t("recipes.params.value", "Giá trị")}</TableHead>
            <TableHead>{t("recipes.params.type", "Kiểu")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground">{t("recipes.params.empty", "Payload trống.")}</TableCell></TableRow>
          ) : rows.map((r) => (
            <TableRow key={r.path}>
              <TableCell className="font-mono text-xs">{r.path}</TableCell>
              <TableCell className="max-w-[24rem] break-all font-mono text-xs">{r.value}</TableCell>
              <TableCell className="text-xs text-muted-foreground">{r.type}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <details className="rounded-md border bg-muted/20 p-2 text-xs">
        <summary className="cursor-pointer text-muted-foreground">{t("recipes.params.rawJson", "JSON gốc")}</summary>
        <pre className="mt-2 max-h-[420px] overflow-auto font-mono text-xs">{JSON.stringify(payload, null, 2)}</pre>
      </details>
    </div>
  );
}

// ── Sổ triển khai + rollback (RollbackConfirm — hợp đồng cũ: không lý do, không OTP) ───────────

function DeploymentLedger({
  rows, loading, error, onRetry, canEdit, editReason, rollbackPending, onRollback, rollbackError, onDismissError,
}: {
  rows: DeploymentData[];
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  canEdit: boolean;
  editReason?: string;
  rollbackPending: boolean;
  onRollback: (machineId: number) => void;
  rollbackError: { machineId: number; message: string } | null;
  onDismissError: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2">
      {rollbackError && (
        <ErrorNotice
          title={t("recipes.rollbackFailed", "Rollback máy #{{machineId}} không thực hiện được", { machineId: rollbackError.machineId })}
          message={rollbackError.message}
          onDismiss={onDismissError}
        />
      )}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("recipes.machine")}</TableHead>
            <TableHead>{t("recipes.recipeVersion")}</TableHead>
            <TableHead>{t("recipes.deployedBy")}</TableHead>
            <TableHead>{t("recipes.deployedAt")}</TableHead>
            <TableHead>{t("recipes.status")}</TableHead>
            <TableHead>{t("recipes.previous")}</TableHead>
            <TableHead>{t("recipes.notes")}</TableHead>
            <TableHead className="text-right">{t("recipes.actions")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading && (
            [0, 1, 2].map((i) => (
              <TableRow key={`dsk-${i}`}>
                <TableCell colSpan={8}><Skeleton className="h-4 w-full" /></TableCell>
              </TableRow>
            ))
          )}
          {!loading && error && (
            <TableRow>
              <TableCell colSpan={8} className="text-center">
                <div className="flex flex-col items-center gap-2 py-3 text-sm text-destructive">
                  <span>{t("recipes.loadError")}</span>
                  <Button size="sm" variant="outline" onClick={onRetry}>
                    <RefreshCw className="h-4 w-4 mr-1" /> {t("recipes.retry")}
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          )}
          {!loading && !error && rows.length === 0 && (
            <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground">{t("recipes.empty")}</TableCell></TableRow>
          )}
          {!loading && !error && rows.map((d) => (
            <TableRow key={d.id}>
              <TableCell className="font-medium">{d.machineName ? `${d.machineName} (#${d.machineId})` : `#${d.machineId}`}</TableCell>
              <TableCell>{d.recipeCode != null ? `${d.recipeCode} v${d.recipeVersion}` : `#${d.recipeId}`}</TableCell>
              <TableCell>{d.deployedBy}</TableCell>
              <TableCell className="text-xs">{d.deployedAt ? new Date(d.deployedAt).toLocaleString() : "—"}</TableCell>
              <TableCell><StatusBadge status={d.status} variant={RECIPE_STATUS_MAP[d.status]?.variant ?? "outline"} /></TableCell>
              <TableCell>{d.previousRecipeId ?? "—"}</TableCell>
              <TableCell className="max-w-[200px] truncate" title={d.notes ?? ""}>{d.notes ?? "—"}</TableCell>
              <TableCell className="text-right">
                {d.previousRecipeId != null && (
                  <RollbackConfirm
                    requireReason={false}
                    requireOtp={false}
                    versionLabel={`#${d.previousRecipeId}`}
                    title={t("recipes.rollback")}
                    description={t("recipes.rollbackConfirm", { machineId: d.machineId })}
                    confirmLabel={t("recipes.confirmRollback")}
                    disabled={!canEdit || rollbackPending}
                    onRollback={() => onRollback(d.machineId)}
                    trigger={
                      <Button size="sm" variant="outline" disabled={!canEdit || rollbackPending} title={editReason}>
                        <RotateCcw className="h-4 w-4 mr-1" /> {t("recipes.rollback")}
                      </Button>
                    }
                  />
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// ── Sheet: tạo phiên bản mới ───────────────────────────────────────────────────────────────────

function CreateVersionForm({ initialCode, canCreate, onSaved }: { initialCode: string; canCreate: boolean; onSaved: () => void }) {
  const { t } = useTranslation();
  const { layer, done } = useCloseOwnLayer();
  const uid = useId();
  // Form khởi tạo MỘT lần lúc mở sheet (như openCreate cũ: mã = mã đang chọn).
  const [initial] = useState<NewVersionForm>(() => ({ ...emptyNewVersion, code: initialCode }));
  const [form, setForm] = useState<NewVersionForm>(initial);
  const [jsonError, setJsonError] = useState<string | null>(null);
  // U9 — loại mẫu payload đang chọn cho nút "Chèn mẫu".
  const [templateKind, setTemplateKind] = useState<RecipeTemplateKind>("aoi");

  const dirty = form.code !== initial.code || form.name !== initial.name || form.payloadText !== initial.payloadText || form.notes !== initial.notes;
  useEffect(() => { layer.setDirty(dirty); }, [dirty]); // eslint-disable-line react-hooks/exhaustive-deps

  const createRecipe = trpc.machineRecipe.recipes.create.useMutation({
    onSuccess: () => { toast.success(t("recipes.toastCreated")); onSaved(); done(); },
    onError: (e) => toastTrpcError(e),
  });

  // U9 — chèn khung JSON mẫu; nếu ô đang có nội dung thực thì hỏi xác nhận trước khi thay.
  const insertTemplate = () => {
    const skeleton = RECIPE_TEMPLATES[templateKind];
    const text = JSON.stringify(skeleton, null, 2);
    const cur = form.payloadText.trim();
    if (cur && cur !== emptyNewVersion.payloadText.trim() && cur !== "{}") {
      if (!window.confirm(t("recipes.templateOverwriteConfirm", "Ô payload đang có nội dung — chèn mẫu sẽ thay thế. Tiếp tục?"))) return;
    }
    setForm((f) => ({ ...f, payloadText: text }));
    setJsonError(null);
  };

  const submitCreate = () => {
    let parsed: Record<string, unknown>;
    try {
      const value = JSON.parse(form.payloadText);
      if (value === null || typeof value !== "object" || Array.isArray(value)) {
        setJsonError(t("recipes.jsonMustBeObject"));
        return;
      }
      parsed = value as Record<string, unknown>;
    } catch (err) {
      setJsonError(mapTrpcError(err));
      return;
    }
    setJsonError(null);
    createRecipe.mutate({
      code: form.code.trim(),
      name: form.name.trim(),
      payload: parsed,
      notes: form.notes.trim() || null,
    });
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor={`${uid}-code`}>{t("recipes.code")}</Label>
          <Input id={`${uid}-code`} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
        </div>
        <div>
          <Label htmlFor={`${uid}-name`}>{t("recipes.name")}</Label>
          <Input id={`${uid}-name`} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
      </div>
      <div>
        {/* U9 — nhãn payload + khung mẫu (Chèn mẫu) giúp người mới khỏi gõ JSON từ đầu. */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Label htmlFor={`${uid}-payload`}>{t("recipes.payloadJson")}</Label>
          {canCreate && (
            <div className="flex items-center gap-1">
              <Select value={templateKind} onValueChange={(v) => setTemplateKind(v as RecipeTemplateKind)}>
                <SelectTrigger className="h-7 w-52 text-xs" aria-label={t("recipes.insertTemplate", "Chèn mẫu")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="aoi">{t("recipes.tplAoi", "Mẫu AOI (kiểm tra quang học)")}</SelectItem>
                  <SelectItem value="spi">{t("recipes.tplSpi", "Mẫu SPI (kiểm tra kem hàn)")}</SelectItem>
                  <SelectItem value="generic">{t("recipes.tplGeneric", "Mẫu chung")}</SelectItem>
                </SelectContent>
              </Select>
              <Button type="button" size="sm" variant="outline" className="h-7" onClick={insertTemplate}>
                {t("recipes.insertTemplate", "Chèn mẫu")}
              </Button>
            </div>
          )}
        </div>
        <Textarea
          id={`${uid}-payload`}
          className="font-mono text-xs min-h-[180px]"
          value={form.payloadText}
          onChange={(e) => { setForm({ ...form, payloadText: e.target.value }); setJsonError(null); }}
        />
        <p className="mt-1 text-xs text-muted-foreground">{t("recipes.templateHint", "Không bắt buộc — chèn khung JSON mẫu để đỡ gõ tay, vẫn sửa được.")}</p>
        {jsonError && <p className="text-xs text-destructive mt-1">{t("recipes.jsonError")}: {jsonError}</p>}
      </div>
      <div>
        <Label htmlFor={`${uid}-notes`}>{t("recipes.notes")}</Label>
        <Input id={`${uid}-notes`} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" onClick={() => layer.close()}>{t("recipes.cancel")}</Button>
        <Button
          onClick={submitCreate}
          disabled={createRecipe.isPending || !form.code.trim() || !form.name.trim()}
        >
          {t("recipes.saveNewVersion")}
        </Button>
      </div>
    </div>
  );
}

// ── Sheet: duyệt (W2-9 — second-approver / segregation of duties) ──────────────────────────────
// U6 (doc 26) — nhúng NGỮ CẢNH để trưởng ca quyết trong 1 màn:
// ai tạo (createdByName) · lý do/ghi chú người tạo · diff so với bản Golden.

function ApproveForm({
  version, golden, isOwn, pending, approveAsync,
}: {
  version: VersionData;
  golden: VersionData | null;
  isOwn: boolean;
  pending: boolean;
  approveAsync: (input: { recipeId: number; note: string | null }) => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const { layer, done, mountedRef } = useCloseOwnLayer();
  const uid = useId();
  const [approveNote, setApproveNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { layer.setDirty(approveNote.trim() !== ""); }, [approveNote]); // eslint-disable-line react-hooks/exhaustive-deps
  const isApproved = version.approvedBy != null;

  const confirm = () => {
    setError(null);
    approveAsync({ recipeId: version.id, note: approveNote.trim() || null }).then(
      () => done(),
      (e: unknown) => { if (mountedRef.current) setError(mapTrpcError(e)); },
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-400">
        <ShieldCheck className="h-4 w-4 mt-0.5 shrink-0" />
        <span>{t("recipes.sodHint")}</span>
      </div>
      {/* Người tạo + ghi chú của phiên bản (ngữ cảnh cho người duyệt). */}
      <div className="rounded-md border bg-muted/20 p-2 text-xs space-y-1.5">
        <div className="flex items-center gap-1.5">
          <User className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-muted-foreground">{t("recipes.requestedBy", "Người tạo")}:</span>
          <span className="font-medium">
            {version.createdByName ?? (version.createdBy != null ? `#${version.createdBy}` : t("recipes.unknownUser", "Không rõ"))}
          </span>
        </div>
        <div>
          <span className="text-muted-foreground">{t("recipes.creatorNotes", "Lý do / ghi chú")}:</span>{" "}
          {version.notes
            ? <span className="text-foreground">{version.notes}</span>
            : <span className="italic text-muted-foreground">{t("recipes.noCreatorNotes", "Không có ghi chú")}</span>}
        </div>
      </div>
      {/* Diff so với bản Golden (baseline). */}
      <div>
        <div className="mb-1 flex items-center gap-1 text-xs font-medium text-muted-foreground">
          <GitCompare className="h-3.5 w-3.5" />
          {t("recipes.diffVsGolden", "Khác biệt so với bản Golden")}
        </div>
        {golden == null ? (
          <p className="rounded-md border bg-muted/20 p-2 text-xs text-muted-foreground">
            {t("recipes.noGoldenBaseline", "Chưa có bản Golden để đối chiếu.")}
          </p>
        ) : golden.id === version.id ? (
          <p className="rounded-md border bg-muted/20 p-2 text-xs text-muted-foreground">
            {t("recipes.isGoldenSelf", "Đây chính là bản Golden hiện tại.")}
          </p>
        ) : (
          <JsonDiffView
            left={golden.payload}
            right={version.payload}
            leftLabel={`v${golden.version} (${t("recipes.golden")})`}
            rightLabel={`v${version.version}`}
            maxHeightClass="max-h-[240px]"
          />
        )}
      </div>
      {isApproved ? (
        <p className="rounded-md border bg-muted/20 p-2 text-xs text-muted-foreground">
          {t("recipes.alreadyApproved", "Phiên bản này đã được duyệt.")}
        </p>
      ) : (
        <>
          <div>
            <Label htmlFor={`${uid}-note`}>{t("recipes.approvalNote")}</Label>
            <Textarea id={`${uid}-note`} value={approveNote} onChange={(e) => setApproveNote(e.target.value)} />
          </div>
          {isOwn && <p className="text-xs text-destructive">{t("recipes.cannotApproveOwn")}</p>}
          {error && <ErrorNotice title={t("recipes.approve")} message={error} />}
        </>
      )}
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" onClick={() => layer.close()}>{t("recipes.cancel")}</Button>
        {!isApproved && (
          <Button disabled={pending || isOwn} onClick={confirm}>
            {t("recipes.confirmApprove")}
          </Button>
        )}
      </div>
    </div>
  );
}

// ── Drawer: triển khai một phiên bản lên MỘT máy (R-2-n: đúng năng lực của dialog cũ) ─────────
// MỘT máy đích, MỘT lượt `recipes.deploy` mỗi lần bấm xác nhận; cùng cổng (canEdit ở đăng ký flyout,
// đã-duyệt, đang chờ), cùng chữ. Lời từ chối (cổng chặt Đợt 1C: recipeArchived…) hiện trong khối
// role=alert ngay trong drawer, kèm toast của hook trang. Đóng drawer khi đang chờ: drawer không cập nhật
// state nữa (mountedRef); toast/invalidate do hook của trang làm; chỉ đóng lớp nếu nó vẫn là lớp trên cùng.

function DeployDrawer({
  version, machines, machinesLoading, machinesError, pending, deployAsync,
}: {
  version: VersionData;
  machines: MachineData[];
  machinesLoading: boolean;
  machinesError: boolean;
  pending: boolean;
  deployAsync: (input: DeployInput) => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const { layer, done, mountedRef } = useCloseOwnLayer();
  const uid = useId();
  // W5-22 (c) — máy gắn sẵn của phiên bản được chọn trước (như dialog cũ).
  const [initialMachineId] = useState<number | null>(() => version.machineId ?? null);
  const [machineId, setMachineId] = useState<number | null>(initialMachineId);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<{ machineId: number; message: string } | null>(null);
  const isApproved = version.approvedBy != null;
  useEffect(() => { layer.setDirty(machineId !== initialMachineId || notes.trim() !== ""); }, [machineId, notes]); // eslint-disable-line react-hooks/exhaustive-deps

  // W5-22 (c) — chọn máy theo tên+ID thay vì gõ số thô (nhãn "#id · tên" như dialog cũ).
  const options = useMemo<EntityOption[]>(
    () => machines.map((m) => ({ value: m.id, label: `#${m.id} · ${machineLabel(m, m.id)}`, sublabel: m.code ?? undefined })),
    [machines],
  );

  const confirm = () => {
    if (!isApproved || machineId == null) return;
    setError(null);
    const id = machineId;
    deployAsync({ recipeId: version.id, machineId: id, notes: notes.trim() || null }).then(
      () => done(),
      (e: unknown) => { if (mountedRef.current) setError({ machineId: id, message: mapTrpcError(e) }); },
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-400">
        <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
        <span>{t("recipes.hitlBanner")}</span>
      </div>
      {!isApproved && <p className="text-xs text-destructive">{t("recipes.deployNeedsApproval")}</p>}
      <div className="space-y-1">
        <Label htmlFor={`${uid}-machine`}>{t("recipes.machine")}</Label>
        <EntityPicker
          id={`${uid}-machine`}
          options={options}
          value={machineId}
          onChange={(v) => { setMachineId(v == null ? null : Number(v)); setError(null); }}
          loading={machinesLoading}
          disabled={pending}
          placeholder={machinesLoading ? t("recipes.loadingMachines") : t("recipes.selectMachine")}
          searchPlaceholder={t("recipes.searchMachine", "Tìm máy…")}
          emptyText={t("recipes.noMachines", "Chưa có máy nào")}
          aria-label={t("recipes.machine")}
        />
        {machinesError && <p className="text-xs text-destructive mt-1">{t("recipes.machinesLoadError")}</p>}
      </div>
      <div>
        <Label htmlFor={`${uid}-notes`}>{t("recipes.notes")}</Label>
        <Input id={`${uid}-notes`} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      {error && (
        <ErrorNotice
          title={t("recipes.deployFailed", "Triển khai lên {{machine}} không thực hiện được", {
            machine: machineLabel(machines.find((m) => m.id === error.machineId), error.machineId),
          })}
          message={error.message}
        />
      )}
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" onClick={() => layer.close()}>{t("recipes.cancel")}</Button>
        <Button disabled={pending || !isApproved || machineId == null} onClick={confirm}>
          {t("recipes.confirmDeploy")}
        </Button>
      </div>
    </div>
  );
}
