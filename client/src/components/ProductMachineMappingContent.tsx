import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { toastTrpcError } from "@/lib/trpcErrors";
import { MachineSelect, ProductModelSelect, StatusBadge, ConfirmDeleteDialog, EmptyState, EntityPicker, type EntityOption } from "@/components/patterns";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { cn } from "@/lib/utils";
import {
  Package,
  Cpu,
  Plus,
  Loader2,
  Trash2,
  AlertTriangle,
  LayoutGrid,
  Table2,
  Check,
  Filter
} from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from 'react-i18next';

// Doc 42 T14 / Đợt 4C (J2) — số máy (cột) tối đa vẽ trong ma trận trước khi bắt
// người dùng thu hẹp phạm vi (chọn loại máy / tìm) để tránh lưới khổng lồ.
const MATRIX_MAX_COLS = 30;

interface MappingRow {
  id: number;
  productModelId: number;
  machineId: number;
  isActive: boolean;
  priority: number;
  notes: string | null;
  machine: { id: number; name: string; code: string; machineType?: string } | undefined;
  product: { id: number; name: string; code: string } | undefined;
}

export function ProductMachineMappingContent() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [selectedMachineId, setSelectedMachineId] = useState<number | null>(null);
  const [selectedProductId, setSelectedProductId] = useState<number | null>(null);
  const [newPriority, setNewPriority] = useState("");
  const [newNotes, setNewNotes] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);

  // Queries
  const { data: machines } = trpc.machine.list.useQuery();
  const { data: products } = trpc.productModel.list.useQuery();
  const { data: mappings, refetch: refetchMappings } = trpc.productMachineMapping.list.useQuery();

  // Mutations
  const createMappingMutation = trpc.productMachineMapping.create.useMutation({
    onSuccess: () => {
      toast.success(t('products.mappingCreated'));
      setDialogOpen(false);
      setSelectedMachineId(null);
      setSelectedProductId(null);
      setNewPriority("");
      setNewNotes("");
      refetchMappings();
    },
    onError: (error: any) => toastTrpcError(error),
  });

  const deleteMappingMutation = trpc.productMachineMapping.delete.useMutation({
    onSuccess: () => {
      toast.success(t('products.mappingDeleted'));
      refetchMappings();
    },
    onError: (error) => toastTrpcError(error),
  });

  const toggleActiveMutation = trpc.productMachineMapping.update.useMutation({
    onSuccess: () => {
      toast.success(t('products.statusUpdated'));
      refetchMappings();
    },
    onError: (error: any) => toastTrpcError(error),
  });

  // Doc 42 #11/#40 — dọn mapping mồ côi (sản phẩm/máy đã xoá) hiển thị "N/A".
  const cleanupOrphansMutation = trpc.productMachineMapping.cleanupOrphans.useMutation({
    onSuccess: ({ deleted }) => {
      toast.success(t('products.orphanCleanupDone', { count: deleted, defaultValue: 'Đã dọn {{count}} mapping mồ côi' }));
      refetchMappings();
    },
    onError: (error: any) => toastTrpcError(error),
  });

  const productIds = products ? new Set((products as any[]).map((p) => p.id)) : null;
  const isOrphan = (mapping: { productModelId: number }) =>
    productIds != null && !productIds.has(mapping.productModelId);
  const orphanCount = productIds != null && mappings ? mappings.filter(isOrphan).length : 0;

  const machineById = useMemo(() => {
    const map = new Map<number, MappingRow["machine"]>();
    for (const m of (machines ?? []) as any[]) map.set(m.id, { id: m.id, name: m.name, code: m.code, machineType: m.machineType });
    return map;
  }, [machines]);
  const productById = useMemo(() => {
    const map = new Map<number, MappingRow["product"]>();
    for (const p of (products ?? []) as any[]) map.set(p.id, { id: p.id, name: p.name, code: p.code });
    return map;
  }, [products]);

  // Bảng phẳng: mỗi mapping là 1 hàng — ẩn bản ghi mồ côi (banner + "Dọn" xử lý riêng).
  const rows = useMemo<MappingRow[]>(() => {
    return (mappings ?? [])
      .filter((m) => !isOrphan(m))
      .map((m: any) => ({
        id: m.id,
        productModelId: m.productModelId,
        machineId: m.machineId,
        isActive: m.isActive,
        priority: typeof m.priority === "number" ? m.priority : 0,
        notes: m.notes ?? null,
        machine: machineById.get(m.machineId),
        product: productById.get(m.productModelId),
      }))
      .filter((r) => r.machine && r.product);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mappings, machineById, productById, productIds]);

  const renderStatus = (r: MappingRow) => (
    <StatusBadge
      status={r.isActive ? "active" : "inactive"}
      tone={r.isActive ? "success" : "default"}
      label={r.isActive ? t("products.mappingActive", "Đang dùng") : t("products.mappingInactive", "Tạm tắt")}
    />
  );

  // ── Doc 42 T14 / Đợt 4C (J2) — chế độ xem MA TRẬN (hàng = sản phẩm, cột = máy) ──
  // Pivot tính client-side từ list mapping/sản phẩm/máy đã tải (không thêm query).
  // Gate tick/untick theo isAdmin (khớp gating hiện có của trang này).
  const canEditCell = isAdmin;

  const [viewMode, setViewMode] = useState<"flat" | "matrix">("flat");
  const [matrixType, setMatrixType] = useState<string | number | null>(null);
  const [matrixMachineQuery, setMatrixMachineQuery] = useState("");
  const [matrixProductQuery, setMatrixProductQuery] = useState("");
  const [pendingCells, setPendingCells] = useState<Set<string>>(() => new Set());

  const matrixCreateMutation = trpc.productMachineMapping.create.useMutation({
    onError: (error: any) => toastTrpcError(error),
  });
  const matrixDeleteMutation = trpc.productMachineMapping.delete.useMutation({
    onError: (error: any) => toastTrpcError(error),
  });

  const mappingByKey = useMemo(() => {
    const map = new Map<string, MappingRow>();
    for (const r of rows) map.set(`${r.productModelId}:${r.machineId}`, r);
    return map;
  }, [rows]);

  const machineTypeOptions = useMemo<EntityOption[]>(() => {
    const set = new Set<string>();
    for (const m of (machines ?? []) as any[]) if (m.machineType) set.add(String(m.machineType));
    return Array.from(set).sort().map((tp) => ({ value: tp, label: tp }));
  }, [machines]);

  const matrixMachines = useMemo(() => {
    let list = ((machines ?? []) as any[]).map((m) => ({
      id: m.id as number,
      name: m.name as string,
      code: m.code as string | null,
      machineType: m.machineType as string | undefined,
    }));
    if (matrixType != null) list = list.filter((m) => m.machineType === matrixType);
    const q = matrixMachineQuery.trim().toLowerCase();
    if (q) list = list.filter((m) => `${m.name} ${m.code ?? ""} ${m.machineType ?? ""}`.toLowerCase().includes(q));
    return list.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  }, [machines, matrixType, matrixMachineQuery]);

  const matrixProducts = useMemo(() => {
    let list = ((products ?? []) as any[]).map((p) => ({
      id: p.id as number,
      name: p.name as string,
      code: p.code as string | null,
    }));
    const q = matrixProductQuery.trim().toLowerCase();
    if (q) list = list.filter((p) => `${p.name} ${p.code ?? ""}`.toLowerCase().includes(q));
    return list.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  }, [products, matrixProductQuery]);

  const matrixLoading = mappings === undefined || machines === undefined || products === undefined;
  const tooManyCols = matrixMachines.length > MATRIX_MAX_COLS;

  const toggleCell = async (productModelId: number, machineId: number) => {
    const key = `${productModelId}:${machineId}`;
    if (pendingCells.has(key)) return;
    if (!canEditCell) return;
    const existing = mappingByKey.get(key);
    setPendingCells((prev) => { const n = new Set(prev); n.add(key); return n; });
    try {
      if (existing) await matrixDeleteMutation.mutateAsync({ id: existing.id });
      else await matrixCreateMutation.mutateAsync({ machineId, productModelId });
      await refetchMappings();
    } catch {
      /* lỗi đã toast qua onError */
    } finally {
      setPendingCells((prev) => { const n = new Set(prev); n.delete(key); return n; });
    }
  };

  const renderMatrixCell = (
    product: { id: number; name: string },
    machine: { id: number; name: string; code: string | null },
  ) => {
    const key = `${product.id}:${machine.id}`;
    const existing = mappingByKey.get(key);
    const pending = pendingCells.has(key);
    const active = existing?.isActive ?? false;
    const title = existing
      ? t("products.matrixCellLinked", "{{product}} ↔ {{machine}} — đang liên kết (bấm để bỏ)", { product: product.name, machine: machine.name })
      : t("products.matrixCellUnlinked", "{{product}} ↔ {{machine}} — chưa liên kết (bấm để tạo)", { product: product.name, machine: machine.name });
    return (
      <button
        type="button"
        data-cell={key}
        disabled={!canEditCell || pending}
        onClick={() => toggleCell(product.id, machine.id)}
        title={title}
        aria-label={title}
        aria-pressed={!!existing}
        className={cn(
          "group flex h-9 w-full items-center justify-center transition-colors",
          canEditCell ? "cursor-pointer hover:bg-accent" : "cursor-default",
        )}
      >
        {pending ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : existing ? (
          <span className="relative inline-flex">
            <span
              className={cn(
                "inline-flex h-5 w-5 items-center justify-center rounded",
                active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground ring-1 ring-border",
              )}
            >
              <Check className="h-3.5 w-3.5" />
            </span>
            {existing.priority > 0 && (
              <span className="absolute -right-2 -top-1.5 rounded bg-background px-0.5 text-[10px] font-medium leading-none tabular-nums text-muted-foreground">
                {existing.priority}
              </span>
            )}
          </span>
        ) : (
          <span
            className={cn(
              "inline-flex h-5 w-5 items-center justify-center rounded text-transparent ring-1 ring-border/50",
              canEditCell && "group-hover:text-muted-foreground",
            )}
          >
            <Plus className="h-3 w-3" />
          </span>
        )}
      </button>
    );
  };

  const columns: DataTableColumn<MappingRow>[] = [
    {
      id: "machine",
      header: t("machines.machine", "Máy"),
      sortValue: (r) => r.machine?.name ?? "",
      filterValue: (r) => `${r.machine?.name ?? ""} ${r.machine?.code ?? ""} ${r.machine?.machineType ?? ""}`,
      cell: (r) => (
        <div className="flex items-center gap-2 min-w-0">
          <div className="p-1.5 rounded bg-primary/10 shrink-0"><Cpu className="h-4 w-4 text-primary" /></div>
          <div className="min-w-0">
            <p className="font-medium truncate">{r.machine?.name}</p>
            <p className="text-xs text-muted-foreground truncate">
              {r.machine?.code}{r.machine?.machineType ? ` • ${r.machine.machineType}` : ""}
            </p>
          </div>
        </div>
      ),
    },
    {
      id: "product",
      header: t("products.product", "Sản phẩm"),
      sortValue: (r) => r.product?.name ?? "",
      filterValue: (r) => `${r.product?.name ?? ""} ${r.product?.code ?? ""}`,
      cell: (r) => (
        <div className="flex items-center gap-2 min-w-0">
          <Package className="h-4 w-4 text-muted-foreground shrink-0" />
          <div className="min-w-0">
            <p className="font-medium truncate">{r.product?.name}</p>
            <p className="text-xs text-muted-foreground truncate">{r.product?.code}</p>
          </div>
        </div>
      ),
    },
    {
      id: "priority",
      header: t("products.priority", "Ưu tiên"),
      align: "right",
      width: "96px",
      sortValue: (r) => r.priority,
      cell: (r) => <span className="tabular-nums">{r.priority.toLocaleString("vi-VN")}</span>,
    },
    {
      id: "notes",
      header: t("products.notes", "Ghi chú"),
      filterValue: (r) => r.notes ?? "",
      cell: (r) => (r.notes ? <span className="text-sm">{r.notes}</span> : <span className="text-muted-foreground">—</span>),
    },
    {
      id: "status",
      header: t("common.status", "Trạng thái"),
      align: "center",
      width: "130px",
      sortValue: (r) => (r.isActive ? 1 : 0),
      cell: (r) => (
        <button
          type="button"
          className="inline-flex align-middle disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
          aria-label={t("products.toggleActive", "Bật/tắt liên kết")}
          title={t("products.toggleActive", "Bật/tắt liên kết")}
          disabled={!isAdmin}
          onClick={() => toggleActiveMutation.mutate({ id: r.id, isActive: !r.isActive } as any)}
        >
          {renderStatus(r)}
        </button>
      ),
    },
    {
      id: "actions",
      header: "",
      align: "right",
      width: "60px",
      cell: (r) => (
        <ConfirmDeleteDialog
          disabled={!isAdmin}
          trigger={
            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" disabled={!isAdmin}>
              <Trash2 className="h-4 w-4" />
            </Button>
          }
          itemLabel={t("products.mappingLabel", "liên kết {{product}} ↔ {{machine}}", {
            product: r.product?.name,
            machine: r.machine?.name,
            defaultValue: "liên kết máy–sản phẩm",
          })}
          onConfirm={async () => { await deleteMappingMutation.mutateAsync({ id: r.id }); }}
        />
      ),
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">{t('products.machineMapping')}</h2>
          <p className="text-muted-foreground">
            {t('products.machineMappingDesc')}
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2" disabled={!isAdmin}>
              <Plus className="h-4 w-4" />
              {t('products.addMapping')}
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('products.machineMapping')}</DialogTitle>
              <DialogDescription>
                {t('products.selectMachineAndProduct')}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">{t('machines.machine')} *</label>
                <MachineSelect
                  value={selectedMachineId}
                  onChange={(v) => setSelectedMachineId(v as number | null)}
                  placeholder={t('machines.selectMachine')}
                  aria-label={t('machines.machine')}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{t('products.product')} *</label>
                <ProductModelSelect
                  value={selectedProductId}
                  onChange={(v) => setSelectedProductId(v as number | null)}
                  placeholder={t('products.selectProduct')}
                  aria-label={t('products.product')}
                />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="mapping-priority-ds">{t('products.priority', 'Ưu tiên')}</Label>
                  <Input
                    id="mapping-priority-ds"
                    type="number"
                    min={0}
                    value={newPriority}
                    onChange={(e) => setNewPriority(e.target.value)}
                    placeholder="0"
                  />
                </div>
                <div className="col-span-2 space-y-2">
                  <Label htmlFor="mapping-notes-ds">{t('products.notes', 'Ghi chú')}</Label>
                  <Input
                    id="mapping-notes-ds"
                    value={newNotes}
                    onChange={(e) => setNewNotes(e.target.value)}
                    placeholder={t('products.notesPlaceholder', 'Tuỳ chọn')}
                  />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>{t('common.cancel')}</Button>
              <Button
                onClick={() => {
                  if (selectedMachineId == null || selectedProductId == null) return;
                  createMappingMutation.mutate({
                    machineId: selectedMachineId,
                    productModelId: selectedProductId,
                    priority: newPriority.trim() !== "" ? Number(newPriority) : undefined,
                    notes: newNotes.trim() !== "" ? newNotes.trim() : undefined,
                  });
                }}
                disabled={createMappingMutation.isPending || selectedMachineId == null || selectedProductId == null}
              >
                {createMappingMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                {t('products.createLink')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Doc 42 T14 / Đợt 4C (J2) — chuyển Bảng phẳng ⇄ Ma trận sản phẩm×máy */}
      <div className="inline-flex rounded-lg border p-0.5">
        <button
          type="button"
          onClick={() => setViewMode("flat")}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
            viewMode === "flat" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
          )}
          aria-pressed={viewMode === "flat"}
        >
          <Table2 className="h-4 w-4" />
          {t("products.viewFlat", "Bảng phẳng")}
        </button>
        <button
          type="button"
          onClick={() => setViewMode("matrix")}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
            viewMode === "matrix" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
          )}
          aria-pressed={viewMode === "matrix"}
        >
          <LayoutGrid className="h-4 w-4" />
          {t("products.viewMatrix", "Ma trận")}
        </button>
      </div>

      {/* Doc 42 #11/#40 — cảnh báo + dọn mapping mồ côi (sản phẩm/máy đã xoá) */}
      {orphanCount > 0 && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
          <div className="flex items-center gap-2 text-sm">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
            <span>
              {t('products.orphanMappingsWarning', { count: orphanCount, defaultValue: '{{count}} mapping trỏ tới sản phẩm/máy đã bị xoá (đã ẩn khỏi danh sách).' })}
            </span>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="gap-2 shrink-0"
            disabled={!isAdmin || cleanupOrphansMutation.isPending}
            onClick={() => cleanupOrphansMutation.mutate()}
          >
            {cleanupOrphansMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            <Trash2 className="h-4 w-4" />
            {t('products.cleanupOrphanMappings', { defaultValue: 'Dọn mapping mồ côi' })}
          </Button>
        </div>
      )}

      {/* Doc 42 Đợt 2 (D2) — bảng phẳng máy↔sản phẩm: search/sort/paginate/skeleton/empty-state. */}
      {viewMode === "flat" && (
        <DataTable<MappingRow>
          data={rows}
          getRowId={(r) => r.id}
          columns={columns}
          searchable
          searchPlaceholder={t("products.searchMachineOrProduct", "Tìm máy hoặc sản phẩm…")}
          paginated
          pageSize={15}
          loading={mappings === undefined || machines === undefined || products === undefined}
          initialSort={{ columnId: "priority", dir: "desc" }}
          emptyState={
            <EmptyState
              variant="no-data"
              title={t("products.noMappingsYet", "Chưa có liên kết máy–sản phẩm")}
              description={t("products.addMappingHint", 'Bấm "Thêm liên kết" để gán sản phẩm cho máy.')}
              actionLabel={isAdmin ? t("products.addMapping") : undefined}
              onAction={isAdmin ? () => setDialogOpen(true) : undefined}
            />
          }
        />
      )}

      {/* Doc 42 T14 / Đợt 4C (J2) — MA TRẬN: hàng = sản phẩm, cột = máy; ô tick = mapping. */}
      {viewMode === "matrix" && (
        <div className="space-y-3">
          {/* Lọc phạm vi để tránh lưới khổng lồ (item 2) */}
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">{t("products.matrixFilterType", "Nhóm máy (loại)")}</Label>
              <EntityPicker
                options={machineTypeOptions}
                value={matrixType}
                onChange={(v) => setMatrixType(v as string | null)}
                placeholder={t("products.allMachineTypes", "Tất cả loại máy")}
                searchPlaceholder={t("products.matrixTypeSearch", "Tìm loại…")}
                warnOnInvalid={false}
                className="w-56"
                aria-label={t("products.matrixFilterType", "Nhóm máy (loại)")}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="matrix-machine-q-ds" className="text-xs text-muted-foreground">{t("products.matrixSearchMachine", "Tìm máy (cột)")}</Label>
              <Input
                id="matrix-machine-q-ds"
                value={matrixMachineQuery}
                onChange={(e) => setMatrixMachineQuery(e.target.value)}
                placeholder={t("products.matrixSearchMachinePh", "Tên/mã máy…")}
                className="w-44"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="matrix-product-q-ds" className="text-xs text-muted-foreground">{t("products.matrixSearchProduct", "Tìm sản phẩm (hàng)")}</Label>
              <Input
                id="matrix-product-q-ds"
                value={matrixProductQuery}
                onChange={(e) => setMatrixProductQuery(e.target.value)}
                placeholder={t("products.matrixSearchProductPh", "Tên/mã sản phẩm…")}
                className="w-44"
              />
            </div>
            <div className="ml-auto text-xs text-muted-foreground">
              {t("products.matrixCounts", "{{products}} sản phẩm × {{machines}} máy", {
                products: matrixProducts.length,
                machines: matrixMachines.length,
              })}
            </div>
          </div>

          {matrixLoading ? (
            <div className="flex items-center justify-center gap-2 rounded-lg border py-16 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("common.loading", "Đang tải…")}
            </div>
          ) : tooManyCols ? (
            <div className="rounded-lg border border-dashed p-8 text-center">
              <Filter className="mx-auto h-8 w-8 text-muted-foreground" />
              <p className="mt-2 font-medium">{t("products.matrixTooManyTitle", "Lưới quá lớn để hiển thị")}</p>
              <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                {t("products.matrixTooMany", "{{count}} máy vượt giới hạn {{max}} cột. Hãy chọn nhóm máy hoặc lọc bớt để thu hẹp.", {
                  count: matrixMachines.length,
                  max: MATRIX_MAX_COLS,
                })}
              </p>
            </div>
          ) : matrixMachines.length === 0 || matrixProducts.length === 0 ? (
            <EmptyState
              variant="no-results"
              title={t("products.matrixEmptyTitle", "Không có máy/sản phẩm khớp phạm vi")}
              description={t("products.matrixEmptyDesc", "Đổi nhóm máy hoặc từ khoá tìm để hiển thị ma trận.")}
            />
          ) : (
            <>
              <div className="max-h-[70vh] overflow-auto rounded-lg border">
                <table className="border-collapse text-sm">
                  <thead>
                    <tr>
                      <th className="sticky left-0 top-0 z-30 min-w-[12rem] border-b border-r bg-muted/95 px-3 py-2 text-left text-xs font-semibold backdrop-blur">
                        {t("products.matrixCorner", "Sản phẩm \\ Máy")}
                      </th>
                      {matrixMachines.map((m) => (
                        <th
                          key={m.id}
                          className="sticky top-0 z-20 h-32 min-w-[2.75rem] border-b border-r bg-muted/95 p-1 align-bottom backdrop-blur"
                        >
                          <div className="mx-auto flex h-28 items-end justify-center">
                            <span
                              className="max-h-28 truncate whitespace-nowrap text-xs font-medium [writing-mode:vertical-rl] rotate-180"
                              title={m.code ? `${m.name} (${m.code})` : m.name}
                            >
                              {m.name}
                            </span>
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {matrixProducts.map((p) => (
                      <tr key={p.id} className="hover:bg-muted/30">
                        <th
                          scope="row"
                          className="sticky left-0 z-10 min-w-[12rem] border-b border-r bg-background px-3 py-2 text-left align-middle"
                        >
                          <div className="min-w-0">
                            <p className="max-w-[16rem] truncate font-medium" title={p.name}>{p.name}</p>
                            {p.code && <p className="truncate text-xs text-muted-foreground">{p.code}</p>}
                          </div>
                        </th>
                        {matrixMachines.map((m) => (
                          <td key={m.id} className="border-b border-r p-0 text-center align-middle">
                            {renderMatrixCell(p, m)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Chú giải */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-flex h-4 w-4 items-center justify-center rounded bg-primary text-primary-foreground"><Check className="h-3 w-3" /></span>
                  {t("products.matrixLegendActive", "Đang liên kết")}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-flex h-4 w-4 items-center justify-center rounded bg-muted text-muted-foreground ring-1 ring-border"><Check className="h-3 w-3" /></span>
                  {t("products.matrixLegendInactive", "Liên kết (tạm tắt)")}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-flex h-4 w-4 items-center justify-center rounded ring-1 ring-border/50" />
                  {t("products.matrixLegendNone", "Chưa liên kết")}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <sup className="text-[10px]">n</sup>
                  {t("products.matrixLegendPriority", "= ưu tiên")}
                </span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default ProductMachineMappingContent;
