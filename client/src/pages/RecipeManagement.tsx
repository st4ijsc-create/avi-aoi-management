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
 */
import { useEffect, useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useTranslation } from "react-i18next";
import { usePermissions } from "@/_core/hooks/usePermissions";
import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { ViewOnlyBadge } from "@/components/PermissionGate";
import { PageHeader, PageContainer, StatusBadge, type BadgeVariant } from "@/components/patterns";
import { buildBreadcrumbs } from "@/lib/breadcrumbs";
import { useLocation, useSearch } from "wouter";
import { navItems } from "@/lib/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { LineDiff, prettyJson } from "@/components/diff/LineDiff";
import { FlaskConical, Plus, AlertTriangle, RotateCcw, Rocket, ShieldCheck, Eye, GitCompare, Star, History, RefreshCw, User, Cpu, ArrowRight } from "lucide-react";
import { toast } from "sonner";

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

export default function RecipeManagement() {
  const { t } = useTranslation();
  // U3 (doc 26) — breadcrumb "Kỹ thuật › Section › Trang" + link về Hub.
  const [location] = useLocation();
  const crumbs = buildBreadcrumbs(location, t);
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
  const [selectedCode, setSelectedCode] = useState<string | null>(null);

  // U15 (doc 26 §2.1) — lối vào theo MÁY: KTV chọn máy → thấy recipe đang ACTIVE
  // của máy đó mà không cần biết trước mã. Song song với trục theo-mã hiện có.
  const search = useSearch();
  const [selectedMachineId, setSelectedMachineId] = useState<number | null>(null);

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

  // ── Create new version dialog ──
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<NewVersionForm>(emptyNewVersion);
  const [jsonError, setJsonError] = useState<string | null>(null);

  const createRecipe = trpc.machineRecipe.recipes.create.useMutation({
    onSuccess: () => { toast.success(t("recipes.toastCreated")); setCreateOpen(false); setForm(emptyNewVersion); invalidateAll(); },
    onError: (e) => toast.error(e.message),
  });

  // ── Approve dialog (W2-9 — second-approver / segregation of duties) ──
  const [approveTarget, setApproveTarget] = useState<{ id: number; version: number } | null>(null);
  const [approveNote, setApproveNote] = useState("");
  const approve = trpc.machineRecipe.recipes.approve.useMutation({
    onSuccess: () => { toast.success(t("recipes.toastApproved")); setApproveTarget(null); setApproveNote(""); invalidateAll(); },
    onError: (e) => toast.error(e.message),
  });

  // ── Deploy dialog ──
  const [deployRecipeId, setDeployRecipeId] = useState<number | null>(null);
  const [deployMachineId, setDeployMachineId] = useState("");
  const [deployNotes, setDeployNotes] = useState("");

  const deploy = trpc.machineRecipe.recipes.deploy.useMutation({
    onSuccess: () => { toast.success(t("recipes.toastDeployed")); setDeployRecipeId(null); setDeployMachineId(""); setDeployNotes(""); invalidateAll(); },
    onError: (e) => toast.error(e.message),
  });

  // ── Rollback (AlertDialog) ──
  const [rollbackMachineId, setRollbackMachineId] = useState<number | null>(null);
  const rollback = trpc.machineRecipe.recipes.rollback.useMutation({
    onSuccess: () => { toast.success(t("recipes.toastRolledBack")); setRollbackMachineId(null); invalidateAll(); },
    onError: (e) => toast.error(e.message),
  });

  // ── W5-22 (a): Golden/master toggle ──
  const setGolden = trpc.machineRecipe.recipes.setGolden.useMutation({
    onSuccess: (row) => { toast.success(row.isGolden ? t("recipes.toastGoldenSet") : t("recipes.toastGoldenUnset")); invalidateAll(); },
    onError: (e) => toast.error(e.message),
  });

  // ── Archive (AlertDialog confirm) ──
  const [archiveTarget, setArchiveTarget] = useState<{ id: number; version: number } | null>(null);
  const archive = trpc.machineRecipe.recipes.archive.useMutation({
    onSuccess: () => { toast.success(t("recipes.toastArchived")); setArchiveTarget(null); invalidateAll(); },
    onError: (e) => toast.error(e.message),
  });

  // ── W3-11: xem payload (JSON read-only) + so sánh 2 phiên bản (diff) ──
  const [viewVersionId, setViewVersionId] = useState<number | null>(null);
  const [diffBaseId, setDiffBaseId] = useState<number | null>(null);
  const [diffCompareId, setDiffCompareId] = useState<number | null>(null);

  // Đổi code → reset lựa chọn diff để effect golden-default áp cho code mới.
  const selectCode = (code: string) => {
    setSelectedCode(code);
    setDiffBaseId(null);
    setDiffCompareId(null);
  };

  // U9 — loại mẫu payload đang chọn cho nút "Chèn mẫu".
  const [templateKind, setTemplateKind] = useState<RecipeTemplateKind>("aoi");

  const openCreate = () => {
    setForm({ ...emptyNewVersion, code: selectedCode ?? "" });
    setJsonError(null);
    setCreateOpen(true);
  };

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
      setJsonError(err instanceof Error ? err.message : String(err));
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

  const codes = codesQuery.data ?? [];
  const versions = versionsQuery.data ?? [];
  const deployments = deploymentsQuery.data ?? [];
  const machineList = machinesQuery.data ?? [];
  const genealogy = genealogyQuery.data ?? [];

  // U15 — recipe đang chạy của máy đang chọn (nếu có) từ sổ triển khai theo máy.
  // Bản đang chạy = row mới nhất status="deployed" (rollback tạo row deployed mới,
  // đánh dấu row cũ "rolled_back"); list đã sắp deployedAt giảm dần nên find đầu tiên.
  const machineDeployments = machineDeploymentsQuery.data ?? [];
  const activeDeployment = useMemo(
    () => machineDeployments.find((d) => d.status === "deployed") ?? null,
    [machineDeployments],
  );

  // W5-22 (a) — phiên bản golden (baseline) của code đang chọn, nếu có.
  const goldenVersion = useMemo(() => versions.find((v) => v.isGolden) ?? null, [versions]);

  // U6 (doc 26) — phiên bản đang chờ duyệt (để nhúng ngữ cảnh vào dialog duyệt).
  const approveVersion = useMemo(
    () => (approveTarget != null ? versions.find((v) => v.id === approveTarget.id) ?? null : null),
    [versions, approveTarget],
  );

  // W3-11 — tra cứu phiên bản đang xem / đang so sánh (payload nằm sẵn trong versions).
  const viewVersion = useMemo(() => versions.find((v) => v.id === viewVersionId) ?? null, [versions, viewVersionId]);
  const diffBase = useMemo(() => versions.find((v) => v.id === diffBaseId) ?? null, [versions, diffBaseId]);
  const diffCompare = useMemo(() => versions.find((v) => v.id === diffCompareId) ?? null, [versions, diffCompareId]);

  // W5-22 (a) — mặc định lấy phiên bản GOLDEN làm bản gốc khi so sánh (baseline đối chiếu).
  useEffect(() => {
    if (diffBaseId == null && goldenVersion != null) setDiffBaseId(goldenVersion.id);
  }, [goldenVersion, diffBaseId]);

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

  return (
    <DashboardLayout title={t("recipes.title")} navItems={navItems} currentPath="/recipes">
    <PageContainer>
      <PageHeader
        breadcrumbs={crumbs}
        icon={<FlaskConical className="h-6 w-6" />}
        title={
          <span className="flex items-center gap-2">
            {t("recipes.title")}<ViewOnlyBadge module="machine_control" />
          </span>
        }
        actions={
          <Button onClick={openCreate} disabled={!canCreate} title={createReason}>
            <Plus className="h-4 w-4 mr-1" /> {t("recipes.newVersion")}
          </Button>
        }
      />

      {/* SAFETY banner — HITL */}
      <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
        <AlertTriangle className="h-5 w-5 mt-0.5 shrink-0" />
        <span>{t("recipes.hitlBanner")}</span>
      </div>

      {/* U15 (doc 26 §2.1) — lối vào theo MÁY: chọn máy → xem recipe đang chạy mà
          không cần biết mã trước. Đọc-only, song song với trục theo-mã bên dưới. */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Cpu className="h-4 w-4" /> {t("recipes.byMachineTitle", "Xem theo máy")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Label className="shrink-0 text-sm text-muted-foreground sm:w-40">
              {t("recipes.byMachineLabel", "Chọn máy để xem recipe đang chạy")}
            </Label>
            <Select
              value={selectedMachineId != null ? String(selectedMachineId) : ""}
              onValueChange={(v) => setSelectedMachineId(v ? Number(v) : null)}
            >
              <SelectTrigger className="w-full sm:w-72" aria-label={t("recipes.selectMachine", "Chọn máy")}>
                <SelectValue placeholder={t("recipes.selectMachine", "Chọn máy")} />
              </SelectTrigger>
              <SelectContent>
                {machinesQuery.isLoading && (
                  <div className="px-2 py-1.5 text-sm text-muted-foreground">{t("common.loading", "Đang tải…")}</div>
                )}
                {!machinesQuery.isLoading && machineList.length === 0 && (
                  <div className="px-2 py-1.5 text-sm text-muted-foreground">{t("recipes.noMachines", "Chưa có máy nào")}</div>
                )}
                {machineList.map((m) => (
                  <SelectItem key={m.id} value={String(m.id)}>
                    {m.name ?? m.code ?? `#${m.id}`}{m.code && m.name ? ` (${m.code})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Kết quả: recipe đang chạy của máy đã chọn — đủ loading/empty/error. */}
          {selectedMachineId != null && (
            <div className="mt-3 rounded-md border bg-muted/20 p-3">
              {machineDeploymentsQuery.isLoading ? (
                <div className="space-y-2"><Skeleton className="h-5 w-48" /><Skeleton className="h-4 w-32" /></div>
              ) : machineDeploymentsQuery.isError ? (
                <div className="flex items-center gap-2 text-sm text-destructive">
                  <span>{t("recipes.loadError")}</span>
                  <Button size="sm" variant="outline" className="h-7" onClick={() => void machineDeploymentsQuery.refetch()}>
                    <RefreshCw className="h-3.5 w-3.5 mr-1" /> {t("recipes.retry")}
                  </Button>
                </div>
              ) : activeDeployment == null ? (
                <p className="text-sm text-muted-foreground">
                  {t("recipes.noActiveRecipe", "Máy này chưa có recipe đang chạy.")}
                </p>
              ) : (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <div>
                    <div className="text-xs text-muted-foreground">{t("recipes.activeRecipe", "Recipe đang chạy")}</div>
                    <div className="flex items-center gap-2 font-medium">
                      <FlaskConical className="h-4 w-4 text-muted-foreground" />
                      {activeDeployment.recipeCode != null
                        ? `${activeDeployment.recipeCode} v${activeDeployment.recipeVersion}`
                        : `#${activeDeployment.recipeId}`}
                      <StatusBadge status={activeDeployment.status} variant={RECIPE_STATUS_MAP[activeDeployment.status]?.variant ?? "outline"} />
                    </div>
                  </div>
                  {activeDeployment.deployedAt && (
                    <div>
                      <div className="text-xs text-muted-foreground">{t("recipes.deployedAt")}</div>
                      <div className="text-sm">{new Date(activeDeployment.deployedAt).toLocaleString()}</div>
                    </div>
                  )}
                  {activeDeployment.recipeCode != null && (
                    <Button
                      size="sm" variant="outline" className="ml-auto"
                      onClick={() => selectCode(activeDeployment.recipeCode as string)}
                    >
                      {t("recipes.viewThisRecipe", "Xem chi tiết recipe")} <ArrowRight className="h-4 w-4 ml-1" />
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Codes list */}
        <Card className="lg:col-span-1">
          <CardHeader><CardTitle>{t("recipes.codes")} ({codes.length})</CardTitle></CardHeader>
          <CardContent>
            <Table>
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
                {!codesQuery.isLoading && !codesQuery.isError && codes.length === 0 && (
                  <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground">{t("recipes.empty")}</TableCell></TableRow>
                )}
                {!codesQuery.isLoading && !codesQuery.isError && codes.map((c) => (
                  <TableRow
                    key={c.code}
                    className={`cursor-pointer ${selectedCode === c.code ? "bg-muted" : ""}`}
                    onClick={() => selectCode(c.code)}
                  >
                    <TableCell className="font-medium">{c.code}<div className="text-xs text-muted-foreground">{c.name}</div></TableCell>
                    <TableCell>{c.versions}</TableCell>
                    <TableCell>{c.activeVersion != null ? <Badge>v{c.activeVersion}</Badge> : <span className="text-muted-foreground">—</span>}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Versions of selected code */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{selectedCode ? t("recipes.versionsOf", { code: selectedCode }) : t("recipes.selectCode")}</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("recipes.version")}</TableHead>
                  <TableHead>{t("recipes.name")}</TableHead>
                  <TableHead>{t("recipes.createdByCol", "Người tạo")}</TableHead>
                  <TableHead>{t("recipes.status")}</TableHead>
                  <TableHead>{t("recipes.approvalStatus")}</TableHead>
                  <TableHead>{t("recipes.checksum")}</TableHead>
                  <TableHead className="text-right">{t("recipes.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {selectedCode == null && (
                  <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">{t("recipes.selectCodeHint")}</TableCell></TableRow>
                )}
                {selectedCode != null && versionsQuery.isLoading && (
                  [0, 1, 2].map((i) => (
                    <TableRow key={`vsk-${i}`}>
                      <TableCell colSpan={7}><Skeleton className="h-4 w-full" /></TableCell>
                    </TableRow>
                  ))
                )}
                {selectedCode != null && !versionsQuery.isLoading && versionsQuery.isError && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center">
                      <div className="flex flex-col items-center gap-2 py-3 text-sm text-destructive">
                        <span>{t("recipes.loadError")}</span>
                        <Button size="sm" variant="outline" onClick={() => void versionsQuery.refetch()}>
                          <RefreshCw className="h-4 w-4 mr-1" /> {t("recipes.retry")}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
                {selectedCode != null && !versionsQuery.isLoading && !versionsQuery.isError && versions.length === 0 && (
                  <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">{t("recipes.empty")}</TableCell></TableRow>
                )}
                {selectedCode != null && !versionsQuery.isLoading && !versionsQuery.isError && versions.map((v) => {
                  // W2-9 — trạng thái duyệt + chặn tự duyệt/tự deploy.
                  const isApproved = v.approvedBy != null;
                  const isOwnRecipe = v.createdBy != null && v.createdBy === user?.id;
                  return (
                  <TableRow key={v.id}>
                    <TableCell className="font-medium">
                      <span className="flex items-center gap-1">
                        v{v.version}
                        {v.isGolden && (
                          <Badge variant="default" className="gap-1 bg-amber-500 text-white hover:bg-amber-500" title={t("recipes.goldenHint")}>
                            <Star className="h-3 w-3 fill-current" /> {t("recipes.golden")}
                          </Badge>
                        )}
                      </span>
                    </TableCell>
                    <TableCell>{v.name}</TableCell>
                    <TableCell className="text-xs">
                      {v.createdByName ?? (v.createdBy != null ? `#${v.createdBy}` : <span className="text-muted-foreground">—</span>)}
                    </TableCell>
                    <TableCell><StatusBadge status={v.status} variant={RECIPE_STATUS_MAP[v.status]?.variant ?? "outline"} /></TableCell>
                    <TableCell>
                      {isApproved ? (
                        <Badge variant="default" title={v.approvalNote ?? ""}>{t("recipes.approved")}</Badge>
                      ) : (
                        <Badge variant="outline">{t("recipes.notApproved")}</Badge>
                      )}
                    </TableCell>
                    <TableCell className="max-w-[140px] truncate font-mono text-xs" title={v.checksum ?? ""}>{v.checksum ?? "—"}</TableCell>
                    <TableCell className="text-right space-x-1">
                      {/* W3-11 — xem payload (JSON read-only) */}
                      <Button
                        size="sm" variant="outline"
                        onClick={() => setViewVersionId(v.id)}
                      >
                        <Eye className="h-4 w-4 mr-1" /> {t("recipes.viewPayload", "Xem")}
                      </Button>
                      {/* W5-22 (a) — đánh dấu / bỏ đánh dấu Golden (baseline). */}
                      {/* Hiện-nhưng-khoá: giữ mọi cổng an toàn (SoD, cần duyệt) trong disabled. */}
                      <Button
                        size="sm" variant={v.isGolden ? "default" : "outline"}
                        className={v.isGolden ? "bg-amber-500 hover:bg-amber-600 text-white" : undefined}
                        disabled={!canEdit || setGolden.isPending}
                        title={editReason ?? (v.isGolden ? t("recipes.unsetGolden") : t("recipes.setGolden"))}
                        onClick={() => setGolden.mutate({ id: v.id, isGolden: !v.isGolden })}
                      >
                        <Star className={`h-4 w-4 ${v.isGolden ? "fill-current" : ""}`} />
                      </Button>
                      {!isApproved && (
                        <Button
                          size="sm" variant="outline"
                          disabled={!canEdit || approve.isPending || isOwnRecipe}
                          title={editReason ?? (isOwnRecipe ? t("recipes.cannotApproveOwn") : undefined)}
                          onClick={() => { setApproveTarget({ id: v.id, version: v.version }); setApproveNote(""); }}
                        >
                          <ShieldCheck className="h-4 w-4 mr-1" /> {t("recipes.approve")}
                        </Button>
                      )}
                      <Button
                        size="sm" variant="outline"
                        disabled={!canEdit || deploy.isPending || !isApproved}
                        title={editReason ?? (!isApproved ? t("recipes.deployNeedsApproval") : undefined)}
                        onClick={() => { setDeployRecipeId(v.id); setDeployMachineId(v.machineId != null ? String(v.machineId) : ""); setDeployNotes(""); }}
                      >
                        <Rocket className="h-4 w-4 mr-1" /> {t("recipes.deploy")}
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
                    </TableCell>
                  </TableRow>
                  );
                })}
              </TableBody>
            </Table>

            {/* W3-11 — So sánh 2 phiên bản payload (diff dòng) */}
            {versions.length >= 2 && (
              <div className="mt-3 rounded-md border bg-muted/20 p-2">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
                    <GitCompare className="h-3.5 w-3.5" /> {t("recipes.compareVersions", "So sánh phiên bản")}
                  </span>
                  <Select value={diffBaseId != null ? String(diffBaseId) : ""} onValueChange={(v) => setDiffBaseId(Number(v))}>
                    <SelectTrigger className="h-7 w-28 text-xs"><SelectValue placeholder={t("recipes.diffBase", "Bản gốc")} /></SelectTrigger>
                    <SelectContent>
                      {versions.map((v) => <SelectItem key={v.id} value={String(v.id)}>v{v.version}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <span className="text-xs text-muted-foreground">→</span>
                  <Select value={diffCompareId != null ? String(diffCompareId) : ""} onValueChange={(v) => setDiffCompareId(Number(v))}>
                    <SelectTrigger className="h-7 w-28 text-xs"><SelectValue placeholder={t("recipes.diffCompare", "So với")} /></SelectTrigger>
                    <SelectContent>
                      {versions.map((v) => <SelectItem key={v.id} value={String(v.id)}>v{v.version}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                {diffBase && diffCompare ? (
                  <LineDiff
                    left={prettyJson(diffBase.payload)}
                    right={prettyJson(diffCompare.payload)}
                    maxHeightClass="max-h-[300px]"
                  />
                ) : (
                  <p className="py-2 text-center text-xs text-muted-foreground">{t("recipes.diffPick", "Chọn 2 phiên bản để xem khác biệt")}</p>
                )}
              </div>
            )}

            {/* W5-22 (b) — Genealogy (lịch sử thao tác recipe từ recipe_load_log) */}
            {selectedCode != null && (
              <div className="mt-3 rounded-md border bg-muted/20 p-2">
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
            )}
          </CardContent>
        </Card>
      </div>

      {/* Deployment ledger */}
      <Card>
        <CardHeader><CardTitle>{t("recipes.deployHistory")} ({deployments.length})</CardTitle></CardHeader>
        <CardContent>
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
              {deploymentsQuery.isLoading && (
                [0, 1, 2].map((i) => (
                  <TableRow key={`dsk-${i}`}>
                    <TableCell colSpan={8}><Skeleton className="h-4 w-full" /></TableCell>
                  </TableRow>
                ))
              )}
              {!deploymentsQuery.isLoading && deploymentsQuery.isError && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center">
                    <div className="flex flex-col items-center gap-2 py-3 text-sm text-destructive">
                      <span>{t("recipes.loadError")}</span>
                      <Button size="sm" variant="outline" onClick={() => void deploymentsQuery.refetch()}>
                        <RefreshCw className="h-4 w-4 mr-1" /> {t("recipes.retry")}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              )}
              {!deploymentsQuery.isLoading && !deploymentsQuery.isError && deployments.length === 0 && (
                <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground">{t("recipes.empty")}</TableCell></TableRow>
              )}
              {!deploymentsQuery.isLoading && !deploymentsQuery.isError && deployments.map((d) => (
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
                      <Button size="sm" variant="outline" disabled={!canEdit || rollback.isPending} title={editReason}
                        onClick={() => setRollbackMachineId(d.machineId)}>
                        <RotateCcw className="h-4 w-4 mr-1" /> {t("recipes.rollback")}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* ── New version dialog ── */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("recipes.newVersion")}</DialogTitle>
            <DialogDescription>{t("recipes.newVersionDesc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>{t("recipes.code")}</Label>
                <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
              </div>
              <div>
                <Label>{t("recipes.name")}</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
            </div>
            <div>
              {/* U9 — nhãn payload + khung mẫu (Chèn mẫu) giúp người mới khỏi gõ JSON từ đầu. */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label>{t("recipes.payloadJson")}</Label>
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
                className="font-mono text-xs min-h-[180px]"
                value={form.payloadText}
                onChange={(e) => { setForm({ ...form, payloadText: e.target.value }); setJsonError(null); }}
              />
              <p className="mt-1 text-xs text-muted-foreground">{t("recipes.templateHint", "Không bắt buộc — chèn khung JSON mẫu để đỡ gõ tay, vẫn sửa được.")}</p>
              {jsonError && <p className="text-xs text-destructive mt-1">{t("recipes.jsonError")}: {jsonError}</p>}
            </div>
            <div>
              <Label>{t("recipes.notes")}</Label>
              <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>{t("recipes.cancel")}</Button>
            <Button
              onClick={submitCreate}
              disabled={createRecipe.isPending || !form.code.trim() || !form.name.trim()}
            >
              {t("recipes.saveNewVersion")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── W3-11: Xem payload (JSON read-only) ── */}
      <Dialog open={viewVersionId != null} onOpenChange={(o) => { if (!o) setViewVersionId(null); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {t("recipes.payloadTitle", "Payload")}{viewVersion ? ` — v${viewVersion.version}` : ""}
            </DialogTitle>
            <DialogDescription>{t("recipes.payloadReadonly", "Nội dung tham số của phiên bản (chỉ đọc).")}</DialogDescription>
          </DialogHeader>
          <pre className="max-h-[420px] overflow-auto rounded-md border bg-muted/20 p-2 font-mono text-xs">
            {viewVersion ? prettyJson(viewVersion.payload) : ""}
          </pre>
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewVersionId(null)}>{t("recipes.cancel")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Approve dialog (W2-9 — second-approver / segregation of duties) ── */}
      {/* U6 (doc 26) — nhúng NGỮ CẢNH để trưởng ca quyết trong 1 màn:
          ai tạo (createdByName) · lý do/ghi chú người tạo · diff so với bản Golden. */}
      <Dialog open={approveTarget != null} onOpenChange={(o) => { if (!o) setApproveTarget(null); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("recipes.approve")}{approveVersion ? ` — v${approveVersion.version}` : ""}</DialogTitle>
            <DialogDescription>{t("recipes.approveDesc")}</DialogDescription>
          </DialogHeader>
          <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-400">
            <ShieldCheck className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{t("recipes.sodHint")}</span>
          </div>
          <div className="space-y-3 mt-2">
            {/* Người tạo + ghi chú của phiên bản (ngữ cảnh cho người duyệt). */}
            <div className="rounded-md border bg-muted/20 p-2 text-xs space-y-1.5">
              <div className="flex items-center gap-1.5">
                <User className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-muted-foreground">{t("recipes.requestedBy", "Người tạo")}:</span>
                <span className="font-medium">
                  {approveVersion?.createdByName
                    ?? (approveVersion?.createdBy != null ? `#${approveVersion.createdBy}` : t("recipes.unknownUser", "Không rõ"))}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">{t("recipes.creatorNotes", "Lý do / ghi chú")}:</span>{" "}
                {approveVersion?.notes
                  ? <span className="text-foreground">{approveVersion.notes}</span>
                  : <span className="italic text-muted-foreground">{t("recipes.noCreatorNotes", "Không có ghi chú")}</span>}
              </div>
            </div>
            {/* Diff so với bản Golden (baseline) — tái dùng LineDiff. */}
            <div>
              <div className="mb-1 flex items-center gap-1 text-xs font-medium text-muted-foreground">
                <GitCompare className="h-3.5 w-3.5" />
                {t("recipes.diffVsGolden", "Khác biệt so với bản Golden")}
              </div>
              {goldenVersion == null ? (
                <p className="rounded-md border bg-muted/20 p-2 text-xs text-muted-foreground">
                  {t("recipes.noGoldenBaseline", "Chưa có bản Golden để đối chiếu.")}
                </p>
              ) : approveVersion != null && goldenVersion.id === approveVersion.id ? (
                <p className="rounded-md border bg-muted/20 p-2 text-xs text-muted-foreground">
                  {t("recipes.isGoldenSelf", "Đây chính là bản Golden hiện tại.")}
                </p>
              ) : approveVersion != null ? (
                <LineDiff
                  left={prettyJson(goldenVersion.payload)}
                  right={prettyJson(approveVersion.payload)}
                  maxHeightClass="max-h-[240px]"
                />
              ) : null}
            </div>
            <div>
              <Label>{t("recipes.approvalNote")}</Label>
              <Textarea value={approveNote} onChange={(e) => setApproveNote(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setApproveTarget(null)}>{t("recipes.cancel")}</Button>
            <Button
              disabled={approve.isPending}
              onClick={() => {
                if (approveTarget == null) return;
                approve.mutate({ recipeId: approveTarget.id, note: approveNote.trim() || null });
              }}
            >
              {t("recipes.confirmApprove")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Deploy dialog ── */}
      <Dialog open={deployRecipeId != null} onOpenChange={(o) => { if (!o) setDeployRecipeId(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("recipes.deploy")}</DialogTitle>
            <DialogDescription>{t("recipes.deployDesc")}</DialogDescription>
          </DialogHeader>
          <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-400">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{t("recipes.hitlBanner")}</span>
          </div>
          <div className="space-y-3 mt-2">
            <div>
              <Label>{t("recipes.machine")}</Label>
              {/* W5-22 (c) — chọn máy theo tên+ID thay vì gõ số thô. */}
              <Select value={deployMachineId} onValueChange={setDeployMachineId}>
                <SelectTrigger>
                  <SelectValue placeholder={machinesQuery.isLoading ? t("recipes.loadingMachines") : t("recipes.selectMachine")} />
                </SelectTrigger>
                <SelectContent>
                  {machineList.map((m) => (
                    <SelectItem key={m.id} value={String(m.id)}>#{m.id} · {m.name}{m.code ? ` (${m.code})` : ""}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {machinesQuery.isError && (
                <p className="text-xs text-destructive mt-1">{t("recipes.machinesLoadError")}</p>
              )}
            </div>
            <div>
              <Label>{t("recipes.notes")}</Label>
              <Input value={deployNotes} onChange={(e) => setDeployNotes(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeployRecipeId(null)}>{t("recipes.cancel")}</Button>
            <Button
              disabled={deploy.isPending || !deployMachineId.trim() || Number.isNaN(Number(deployMachineId))}
              onClick={() => {
                if (deployRecipeId == null) return;
                deploy.mutate({
                  recipeId: deployRecipeId,
                  machineId: Number(deployMachineId),
                  notes: deployNotes.trim() || null,
                });
              }}
            >
              {t("recipes.confirmDeploy")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Rollback confirm ── */}
      <AlertDialog open={rollbackMachineId != null} onOpenChange={(o) => { if (!o) setRollbackMachineId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("recipes.rollback")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("recipes.rollbackConfirm", { machineId: rollbackMachineId ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("recipes.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { if (rollbackMachineId != null) rollback.mutate({ machineId: rollbackMachineId }); }}
            >
              {t("recipes.confirmRollback")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
    </PageContainer>
    </DashboardLayout>
  );
}
