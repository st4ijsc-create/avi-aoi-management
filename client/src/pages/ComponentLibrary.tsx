/**
 * Doc 27 §2 M12a / doc 29 §1 (Đợt 8 — W8-A) — Component Library management.
 *
 * Package/footprint master admin (mirrors the MasterDataManagement tab-page
 * pattern): Packages tab (list + create/edit + soft delete + family filter),
 * Footprints tab (land-pattern variants of a selected package) and a
 * Material-links tab (assign materials.packageId, auto-link by packageType).
 *
 * SAFETY: pure master-data CRUD. NEVER writes a value to a machine.
 * RBAC: module 'masterdata' (same grant as /master-data — the library IS
 * master data); actions hide without the matching grant.
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { usePermissions } from "@/_core/hooks/usePermissions";
import { ViewOnlyBadge } from "@/components/PermissionGate";
import DashboardLayout from "@/components/DashboardLayout";
import { navItems } from "@/lib/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { PageHeader, PageContainer, StatusBadge, ConfirmDeleteDialog, EmptyState } from "@/components/patterns";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { Cpu, Plus, Pencil, Trash2, RotateCcw, AlertTriangle, Link2, Link2Off, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { toastTrpcError } from "@/lib/trpcErrors";

const FAMILIES = [
  "CHIP", "QFP", "QFN", "BGA", "SOT", "SOD", "SOIC", "TSSOP", "DPAK", "THT", "CONN", "ELECTROLYTIC", "TANTALUM", "CRYSTAL", "LED", "CSP", "OTHER",
];
const MOUNT_TYPES = ["SMT", "THT", "PRESSFIT"];
const POLARITY_MARKS = ["dot", "notch", "band", "chamfer", "silk_plus", "pin1_orientation", "tab", "custom"];
const LEAD_TYPES = ["gullwing", "j-lead", "no-lead", "ball", "axial", "radial"];
const DENSITIES = ["most", "nominal", "least"];

type Field = {
  key: string;
  label: string;
  type?: "text" | "number" | "bool" | "select";
  required?: boolean;
  options?: { value: string; label: string }[];
};

export default function ComponentLibrary() {
  const { t } = useTranslation();
  const { hasPermission } = usePermissions();
  const canView = hasPermission("masterdata", "canView");

  if (!canView) {
    return (
      <DashboardLayout title={t("componentLibrary.title")} navItems={navItems} currentPath="/component-library">
        <PageContainer>
          <Card>
            <CardContent className="py-10 text-center text-muted-foreground">
              <AlertTriangle className="mx-auto mb-2 h-6 w-6" />
              {t("masterData.noPermission")}
            </CardContent>
          </Card>
        </PageContainer>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout title={t("componentLibrary.title")} navItems={navItems} currentPath="/component-library">
      <PageContainer>
        <PageHeader
          icon={<Cpu className="h-6 w-6" />}
          title={t("componentLibrary.title")}
          description={t("componentLibrary.subtitle")}
          badge={<ViewOnlyBadge module="masterdata" />}
          actions={<Badge variant="outline">IPC-7351</Badge>}
        />
        <Tabs defaultValue="packages">
          <TabsList>
            <TabsTrigger value="packages">{t("componentLibrary.tabs.packages")}</TabsTrigger>
            <TabsTrigger value="footprints">{t("componentLibrary.tabs.footprints")}</TabsTrigger>
            <TabsTrigger value="materials">{t("componentLibrary.tabs.materialLinks")}</TabsTrigger>
          </TabsList>
          <TabsContent value="packages"><PackagesPanel /></TabsContent>
          <TabsContent value="footprints"><FootprintsPanel /></TabsContent>
          <TabsContent value="materials"><MaterialLinksPanel /></TabsContent>
        </Tabs>
      </PageContainer>
    </DashboardLayout>
  );
}

// ─── Reusable create/edit dialog (mirrors MasterDataManagement) ──────────────
function EntityDialog({
  title, fields, initial, onSubmit, trigger,
}: {
  title: string;
  fields: Field[];
  initial?: Record<string, any>;
  onSubmit: (values: Record<string, any>) => Promise<void> | void;
  trigger: React.ReactNode;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [vals, setVals] = useState<Record<string, any>>(initial ?? {});

  const submit = async () => {
    for (const f of fields) {
      if (f.required && !vals[f.key]) {
        toast.error(t("masterData.fieldRequired", { field: f.label }));
        return;
      }
    }
    try {
      await onSubmit(vals);
      setOpen(false);
    } catch (e: any) {
      toastTrpcError(e);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) setVals(initial ?? {}); }}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[80vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <div className="grid gap-3 py-2 sm:grid-cols-2">
          {fields.map((f) => (
            <div key={f.key} className="grid gap-1">
              <Label>{f.label}{f.required && <span className="text-destructive"> *</span>}</Label>
              {f.type === "bool" ? (
                <Switch
                  checked={!!vals[f.key]}
                  onCheckedChange={(c) => setVals((v) => ({ ...v, [f.key]: c }))}
                />
              ) : f.type === "select" ? (
                <Select
                  value={vals[f.key] ?? "__none__"}
                  onValueChange={(val) =>
                    setVals((v) => ({ ...v, [f.key]: val === "__none__" ? undefined : val }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="--" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">--</SelectItem>
                    {(f.options ?? []).map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  type={f.type === "number" ? "number" : "text"}
                  value={vals[f.key] ?? ""}
                  onChange={(e) => setVals((v) => ({
                    ...v,
                    [f.key]: f.type === "number"
                      ? (e.target.value === "" ? undefined : Number(e.target.value))
                      : e.target.value,
                  }))}
                />
              )}
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>{t("masterData.cancel")}</Button>
          <Button onClick={submit}>{t("masterData.save")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function usePackageFields(): Field[] {
  const { t } = useTranslation();
  return [
    { key: "code", label: t("masterData.code"), required: true },
    { key: "family", label: t("componentLibrary.family"), type: "select", required: true, options: FAMILIES.map((f) => ({ value: f, label: f })) },
    { key: "ipcName", label: t("componentLibrary.ipcName") },
    { key: "mountType", label: t("componentLibrary.mountType"), type: "select", options: MOUNT_TYPES.map((m) => ({ value: m, label: m })) },
    { key: "bodyLengthMm", label: t("componentLibrary.bodyLength"), type: "number" },
    { key: "bodyWidthMm", label: t("componentLibrary.bodyWidth"), type: "number" },
    { key: "bodyHeightMm", label: t("componentLibrary.bodyHeight"), type: "number" },
    { key: "pinCount", label: t("componentLibrary.pinCount"), type: "number" },
    { key: "pitchMm", label: t("componentLibrary.pitch"), type: "number" },
    { key: "hasPolarity", label: t("componentLibrary.hasPolarity"), type: "bool" },
    { key: "polarityMark", label: t("componentLibrary.polarityMark"), type: "select", options: POLARITY_MARKS.map((m) => ({ value: m, label: m })) },
    { key: "leadType", label: t("componentLibrary.leadType"), type: "select", options: LEAD_TYPES.map((m) => ({ value: m, label: m })) },
    { key: "inspectionNotes", label: t("componentLibrary.inspectionNotes") },
    { key: "isActive", label: t("masterData.active"), type: "bool" },
  ];
}

/** Strip non-input fields before sending an edit payload. */
function toPackagePayload(v: Record<string, any>) {
  const keys = [
    "code", "family", "ipcName", "mountType", "bodyLengthMm", "bodyWidthMm", "bodyHeightMm",
    "pinCount", "pitchMm", "hasPolarity", "polarityMark", "leadType", "inspectionNotes", "isActive",
  ];
  const out: Record<string, any> = {};
  for (const k of keys) {
    if (v[k] === undefined || v[k] === "") continue;
    out[k] = ["bodyLengthMm", "bodyWidthMm", "bodyHeightMm", "pinCount", "pitchMm"].includes(k) ? Number(v[k]) : v[k];
  }
  return out;
}

// ─── Packages ────────────────────────────────────────────────────────────────
function PackagesPanel() {
  const { t } = useTranslation();
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission("masterdata", "canCreate");
  const canEdit = hasPermission("masterdata", "canEdit");
  const canDelete = hasPermission("masterdata", "canDelete");
  const [family, setFamily] = useState<string>("all");
  const [showArchived, setShowArchived] = useState(false);
  const list = trpc.componentLibrary.packages.list.useQuery({
    family: family !== "all" ? family : undefined,
    includeDeleted: showArchived || undefined,
  });
  const linkStats = trpc.componentLibrary.linkStats.useQuery();
  const utils = trpc.useUtils();
  const refresh = () => { utils.componentLibrary.packages.list.invalidate(); utils.componentLibrary.linkStats.invalidate(); };
  const create = trpc.componentLibrary.packages.create.useMutation({ onSuccess: () => { toast.success(t("masterData.saved")); refresh(); } });
  const update = trpc.componentLibrary.packages.update.useMutation({ onSuccess: () => { toast.success(t("masterData.saved")); refresh(); } });
  const del = trpc.componentLibrary.packages.delete.useMutation({ onSuccess: () => { toast.success(t("masterData.deleted")); refresh(); }, onError: (e) => toastTrpcError(e) });
  const restore = trpc.componentLibrary.packages.restore.useMutation({ onSuccess: () => { toast.success(t("masterData.saved")); refresh(); }, onError: (e) => toastTrpcError(e) });

  const fields = usePackageFields();
  const linkCount = useMemo(() => {
    const m = new Map<number, number>();
    for (const r of linkStats.data?.byPackage ?? []) m.set(r.packageId, r.count);
    return m;
  }, [linkStats.data]);

  const data = (list.data ?? []) as any[];

  const columns: DataTableColumn<any>[] = [
    {
      id: "code",
      header: t("masterData.code"),
      sortValue: (r) => r.code,
      filterValue: (r) => `${r.code} ${r.ipcName ?? ""}`,
      cell: (r) => (
        <span className="font-mono">
          {r.code}
          {r.origin === "seed" && (
            <Badge variant="secondary" className="ml-2 text-[10px]">{t("componentLibrary.seedBadge")}</Badge>
          )}
          {r.deletedAt != null && (
            <Badge variant="outline" className="ml-2 text-[10px] text-muted-foreground">{t("componentLibrary.archivedBadge", "Đã lưu trữ")}</Badge>
          )}
        </span>
      ),
    },
    { id: "family", header: t("componentLibrary.family"), sortValue: (r) => r.family, cell: (r) => <Badge variant="outline">{r.family}</Badge> },
    { id: "ipcName", header: t("componentLibrary.ipcName"), sortValue: (r) => r.ipcName, cell: (r) => <span className="font-mono text-xs">{r.ipcName ?? "-"}</span> },
    { id: "mount", header: t("componentLibrary.mount"), sortValue: (r) => r.mountType, cell: (r) => r.mountType ?? "-" },
    { id: "pins", header: t("componentLibrary.pins"), align: "right", sortValue: (r) => r.pinCount, cell: (r) => (r.pinCount != null ? Number(r.pinCount).toLocaleString("vi-VN") : "-") },
    { id: "pitch", header: t("componentLibrary.pitch"), align: "right", sortValue: (r) => r.pitchMm, cell: (r) => r.pitchMm ?? "-" },
    {
      id: "polarity",
      header: t("componentLibrary.polarity"),
      sortValue: (r) => (r.hasPolarity ? 1 : 0),
      cell: (r) => (r.hasPolarity
        ? <Badge variant="destructive" className="text-[10px]">{r.polarityMark ?? t("componentLibrary.polarized")}</Badge>
        : <span className="text-muted-foreground">-</span>),
    },
    { id: "linked", header: t("componentLibrary.linkedMaterials"), align: "right", sortValue: (r) => linkCount.get(r.id) ?? 0, cell: (r) => (linkCount.get(r.id) ?? 0).toLocaleString("vi-VN") },
    {
      id: "active",
      header: t("masterData.active"),
      sortValue: (r) => (r.isActive ? 1 : 0),
      cell: (r) => <StatusBadge status={r.isActive ? "active" : "inactive"} tone={r.isActive ? "success" : "default"} label={r.isActive ? t("masterData.active") : t("masterData.inactive")} />,
    },
    {
      id: "actions",
      header: "",
      align: "right",
      cell: (r) => (
        <div className="space-x-1 text-right whitespace-nowrap">
          {r.deletedAt != null ? (
            canEdit && (
              <Button size="sm" variant="ghost" onClick={() => restore.mutate({ id: r.id })} disabled={restore.isPending}>
                <RotateCcw className="mr-1 h-4 w-4" /> {t("componentLibrary.restore", "Khôi phục")}
              </Button>
            )
          ) : (
            <>
              {canEdit && (
                <EntityDialog
                  title={t("componentLibrary.editPackage")} fields={fields.filter((f) => f.key !== "code")} initial={r}
                  onSubmit={async (v) => { await update.mutateAsync({ ...toPackagePayload(v), code: undefined, id: r.id } as any); }}
                  trigger={<Button size="sm" variant="ghost"><Pencil className="h-4 w-4" /></Button>}
                />
              )}
              {canDelete && (
                <ConfirmDeleteDialog
                  trigger={<Button size="sm" variant="ghost"><Trash2 className="h-4 w-4" /></Button>}
                  itemLabel={`${t("componentLibrary.tabs.packages")} ${r.code}`}
                  isSoftDelete
                  referenceCount={linkCount.get(r.id)}
                  referenceLabel={t("componentLibrary.linkedMaterials")}
                  onConfirm={async () => { await del.mutateAsync({ id: r.id }); }}
                />
              )}
            </>
          )}
        </div>
      ),
    },
  ];

  return (
    <Card><CardContent className="pt-4">
      <DataTable
        columns={columns}
        data={data}
        getRowId={(r) => r.id}
        loading={list.isLoading}
        searchable
        searchPlaceholder={t("componentLibrary.searchPlaceholder")}
        initialSort={{ columnId: "code", dir: "asc" }}
        emptyState={
          <EmptyState
            variant="no-data"
            title={t("componentLibrary.emptyTitle", "Chưa có package")}
            description={t("componentLibrary.emptyDesc", "Chưa có package linh kiện nào khớp bộ lọc. Tạo package đầu tiên để bắt đầu.")}
          />
        }
        toolbar={
          <>
            {canCreate && (
              <EntityDialog
                title={t("componentLibrary.newPackage")} fields={fields}
                initial={{ isActive: true, mountType: "SMT", hasPolarity: false }}
                onSubmit={async (v) => { await create.mutateAsync(toPackagePayload(v) as any); }}
                trigger={<Button size="sm"><Plus className="mr-1 h-4 w-4" /> {t("componentLibrary.newPackage")}</Button>}
              />
            )}
            <Select value={family} onValueChange={setFamily}>
              <SelectTrigger className="h-9 w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("common.all", "Tất cả")}</SelectItem>
                {FAMILIES.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="flex items-center gap-2">
              <Switch checked={showArchived} onCheckedChange={setShowArchived} />
              <Label className="text-sm">{t("componentLibrary.showArchived", "Hiện đã lưu trữ")}</Label>
            </div>
          </>
        }
      />
    </CardContent></Card>
  );
}

// ─── Footprints (per selected package) ───────────────────────────────────────
function FootprintsPanel() {
  const { t } = useTranslation();
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission("masterdata", "canCreate");
  const canEdit = hasPermission("masterdata", "canEdit");
  const canDelete = hasPermission("masterdata", "canDelete");
  const packages = trpc.componentLibrary.packages.list.useQuery({});
  const [selected, setSelected] = useState<number | undefined>(undefined);
  const footprints = trpc.componentLibrary.footprints.listByPackage.useQuery(
    { packageId: selected! }, { enabled: selected != null },
  );
  const utils = trpc.useUtils();
  const refresh = () => utils.componentLibrary.footprints.listByPackage.invalidate();
  const create = trpc.componentLibrary.footprints.create.useMutation({ onSuccess: () => { toast.success(t("masterData.saved")); refresh(); } });
  const update = trpc.componentLibrary.footprints.update.useMutation({ onSuccess: () => { toast.success(t("masterData.saved")); refresh(); } });
  const del = trpc.componentLibrary.footprints.delete.useMutation({ onSuccess: () => { toast.success(t("masterData.deleted")); refresh(); }, onError: (e) => toastTrpcError(e) });

  const fields: Field[] = [
    { key: "code", label: t("masterData.code"), required: true },
    { key: "density", label: t("componentLibrary.density"), type: "select", options: DENSITIES.map((d) => ({ value: d, label: d })) },
    { key: "padCount", label: t("componentLibrary.padCount"), type: "number" },
  ];

  const data = (footprints.data ?? []) as any[];
  const columns: DataTableColumn<any>[] = [
    { id: "code", header: t("masterData.code"), sortValue: (r) => r.code, filterValue: (r) => r.code, cell: (r) => <span className="font-mono">{r.code}</span> },
    { id: "density", header: t("componentLibrary.density"), sortValue: (r) => r.density, cell: (r) => r.density ?? "-" },
    { id: "padCount", header: t("componentLibrary.padCount"), align: "right", sortValue: (r) => r.padCount, cell: (r) => (r.padCount != null ? Number(r.padCount).toLocaleString("vi-VN") : "-") },
    {
      id: "actions",
      header: "",
      align: "right",
      cell: (r) => (
        <div className="space-x-1 text-right whitespace-nowrap">
          {canEdit && (
            <EntityDialog
              title={t("componentLibrary.editFootprint")} fields={fields.filter((f) => f.key !== "code")} initial={r}
              onSubmit={async (v) => {
                await update.mutateAsync({
                  id: r.id,
                  density: v.density,
                  padCount: v.padCount != null ? Number(v.padCount) : undefined,
                } as any);
              }}
              trigger={<Button size="sm" variant="ghost"><Pencil className="h-4 w-4" /></Button>}
            />
          )}
          {canDelete && (
            <ConfirmDeleteDialog
              trigger={<Button size="sm" variant="ghost"><Trash2 className="h-4 w-4" /></Button>}
              itemLabel={`${t("componentLibrary.tabs.footprints")} ${r.code}`}
              onConfirm={async () => { await del.mutateAsync({ id: r.id }); }}
            />
          )}
        </div>
      ),
    },
  ];

  return (
    <Card><CardContent className="space-y-3 pt-4">
      <div className="flex flex-wrap items-center gap-2">
        <Label>{t("componentLibrary.selectPackage")}</Label>
        <Select value={selected != null ? String(selected) : "__none__"} onValueChange={(v) => setSelected(v === "__none__" ? undefined : Number(v))}>
          <SelectTrigger className="w-64"><SelectValue placeholder="--" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">--</SelectItem>
            {(packages.data ?? []).map((p: any) => (
              <SelectItem key={p.id} value={String(p.id)}>{p.code} ({p.family})</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {canCreate && selected != null && (
          <EntityDialog
            title={t("componentLibrary.newFootprint")} fields={fields} initial={{ density: "nominal" }}
            onSubmit={async (v) => {
              await create.mutateAsync({
                packageId: selected,
                code: v.code,
                density: v.density,
                padCount: v.padCount != null ? Number(v.padCount) : undefined,
              } as any);
            }}
            trigger={<Button size="sm" variant="outline"><Plus className="mr-1 h-4 w-4" /> {t("componentLibrary.newFootprint")}</Button>}
          />
        )}
      </div>
      {selected != null ? (
        <DataTable
          columns={columns}
          data={data}
          getRowId={(r) => r.id}
          loading={footprints.isLoading}
          searchable
          searchPlaceholder={t("masterData.code")}
          initialSort={{ columnId: "code", dir: "asc" }}
          emptyState={
            <EmptyState
              variant="no-data"
              title={t("componentLibrary.emptyFootprintTitle", "Chưa có land-pattern")}
              description={t("componentLibrary.emptyFootprintDesc", "Package này chưa có biến thể footprint nào. Tạo footprint đầu tiên.")}
            />
          }
        />
      ) : (
        <div className="py-8 text-center text-sm text-muted-foreground">{t("componentLibrary.selectPackageHint")}</div>
      )}
    </CardContent></Card>
  );
}

// ─── Material ↔ package links ────────────────────────────────────────────────
function MaterialLinksPanel() {
  const { t } = useTranslation();
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission("masterdata", "canEdit");
  const materials = trpc.masterData.materials.list.useQuery({});
  const packages = trpc.componentLibrary.packages.list.useQuery({});
  const linkStats = trpc.componentLibrary.linkStats.useQuery();
  const [onlyUnlinked, setOnlyUnlinked] = useState(false);
  const utils = trpc.useUtils();
  const refresh = () => { utils.masterData.materials.list.invalidate(); utils.componentLibrary.linkStats.invalidate(); };
  const link = trpc.componentLibrary.linkMaterial.useMutation({ onSuccess: () => { toast.success(t("masterData.saved")); refresh(); }, onError: (e) => toastTrpcError(e) });
  const backfill = trpc.componentLibrary.backfillMaterialLinks.useMutation({
    onSuccess: (r) => { toast.success(t("componentLibrary.backfillDone", { count: r.linked })); refresh(); },
    onError: (e) => toastTrpcError(e),
  });

  const pkgById = useMemo(() => {
    const m = new Map<number, any>();
    for (const p of packages.data ?? []) m.set(p.id, p);
    return m;
  }, [packages.data]);

  const data = (materials.data ?? []).filter((r: any) => !onlyUnlinked || r.packageId == null) as any[];

  const columns: DataTableColumn<any>[] = [
    { id: "code", header: t("masterData.code"), sortValue: (r) => r.code, filterValue: (r) => `${r.code} ${r.name ?? ""}`, cell: (r) => <span className="font-mono">{r.code}</span> },
    { id: "name", header: t("masterData.name"), sortValue: (r) => r.name, cell: (r) => r.name },
    { id: "packageType", header: t("masterData.packageType"), sortValue: (r) => r.packageType, cell: (r) => <span className="font-mono text-xs">{r.packageType ?? "-"}</span> },
    {
      id: "linkedPackage",
      header: t("componentLibrary.linkedPackage"),
      cell: (r) => (canEdit ? (
        <Select
          value={r.packageId != null ? String(r.packageId) : "__none__"}
          onValueChange={(v) => link.mutate({ materialId: r.id, packageId: v === "__none__" ? null : Number(v) })}
        >
          <SelectTrigger className="h-8 w-56"><SelectValue placeholder="--" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">{t("componentLibrary.noPackage")}</SelectItem>
            {(packages.data ?? []).map((p: any) => (
              <SelectItem key={p.id} value={String(p.id)}>{p.code} ({p.family})</SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : r.packageId != null ? (
        <Badge variant="outline">{pkgById.get(r.packageId)?.code ?? `#${r.packageId}`}</Badge>
      ) : (
        <span className="text-muted-foreground">-</span>
      )),
    },
    {
      id: "linked",
      header: "",
      align: "center",
      width: "48px",
      cell: (r) => (r.packageId != null
        ? <Link2 className="h-4 w-4 text-success" aria-label={t("componentLibrary.linked")} />
        : <Link2Off className="h-4 w-4 text-muted-foreground" aria-label={t("componentLibrary.unlinked")} />),
    },
  ];

  return (
    <Card><CardContent className="pt-4">
      <DataTable
        columns={columns}
        data={data}
        getRowId={(r) => r.id}
        loading={materials.isLoading}
        searchable
        searchPlaceholder={t("componentLibrary.searchPlaceholder")}
        initialSort={{ columnId: "code", dir: "asc" }}
        emptyState={
          <EmptyState
            variant="no-data"
            title={t("componentLibrary.emptyMaterialTitle", "Không có vật liệu")}
            description={t("componentLibrary.emptyMaterialDesc", "Không có vật liệu nào khớp bộ lọc hiện tại.")}
          />
        }
        toolbar={
          <>
            {canEdit && (
              <Button size="sm" variant="outline" onClick={() => backfill.mutate()} disabled={backfill.isPending}>
                <Wand2 className="mr-1 h-4 w-4" /> {t("componentLibrary.backfillByType")}
              </Button>
            )}
            <div className="flex items-center gap-2">
              <Switch checked={onlyUnlinked} onCheckedChange={setOnlyUnlinked} />
              <Label className="text-sm">{t("componentLibrary.onlyUnlinked")}</Label>
            </div>
            <div className="text-xs text-muted-foreground">
              {t("componentLibrary.linkCoverage", {
                linked: linkStats.data?.linkedMaterials ?? 0,
                total: linkStats.data?.totalMaterials ?? 0,
              })}
            </div>
          </>
        }
      />
    </CardContent></Card>
  );
}
