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
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { PageHeader, PageContainer, StatusBadge } from "@/components/patterns";
import { Cpu, Plus, Pencil, Trash2, AlertTriangle, Link2, Link2Off, Wand2 } from "lucide-react";
import { toast } from "sonner";

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
      toast.error(e?.message ?? "Error");
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
  const [search, setSearch] = useState("");
  const list = trpc.componentLibrary.packages.list.useQuery({ family: family !== "all" ? family : undefined });
  const linkStats = trpc.componentLibrary.linkStats.useQuery();
  const utils = trpc.useUtils();
  const refresh = () => { utils.componentLibrary.packages.list.invalidate(); utils.componentLibrary.linkStats.invalidate(); };
  const create = trpc.componentLibrary.packages.create.useMutation({ onSuccess: () => { toast.success(t("masterData.saved")); refresh(); } });
  const update = trpc.componentLibrary.packages.update.useMutation({ onSuccess: () => { toast.success(t("masterData.saved")); refresh(); } });
  const del = trpc.componentLibrary.packages.delete.useMutation({ onSuccess: () => { toast.success(t("masterData.deleted")); refresh(); } });

  const fields = usePackageFields();
  const linkCount = useMemo(() => {
    const m = new Map<number, number>();
    for (const r of linkStats.data?.byPackage ?? []) m.set(r.packageId, r.count);
    return m;
  }, [linkStats.data]);

  const rows = (list.data ?? []).filter((r: any) =>
    !search || String(r.code).toLowerCase().includes(search.toLowerCase()) || String(r.ipcName ?? "").toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <Card><CardContent className="space-y-3 pt-4">
      <div className="flex flex-wrap items-center gap-2">
        {canCreate && (
          <EntityDialog
            title={t("componentLibrary.newPackage")} fields={fields}
            initial={{ isActive: true, mountType: "SMT", hasPolarity: false }}
            onSubmit={async (v) => { await create.mutateAsync(toPackagePayload(v) as any); }}
            trigger={<Button><Plus className="mr-1 h-4 w-4" /> {t("componentLibrary.newPackage")}</Button>}
          />
        )}
        <Select value={family} onValueChange={setFamily}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("common.all", "Tất cả")}</SelectItem>
            {FAMILIES.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input
          className="w-56"
          placeholder={t("componentLibrary.searchPlaceholder")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="ml-auto text-xs text-muted-foreground">
          {t("componentLibrary.packageCount", { count: rows.length })}
        </div>
      </div>
      <Table>
        <TableHeader><TableRow>
          <TableHead>{t("masterData.code")}</TableHead>
          <TableHead>{t("componentLibrary.family")}</TableHead>
          <TableHead>{t("componentLibrary.ipcName")}</TableHead>
          <TableHead>{t("componentLibrary.mount")}</TableHead>
          <TableHead className="text-right">{t("componentLibrary.pins")}</TableHead>
          <TableHead className="text-right">{t("componentLibrary.pitch")}</TableHead>
          <TableHead>{t("componentLibrary.polarity")}</TableHead>
          <TableHead className="text-right">{t("componentLibrary.linkedMaterials")}</TableHead>
          <TableHead>{t("masterData.active")}</TableHead>
          <TableHead></TableHead>
        </TableRow></TableHeader>
        <TableBody>
          {rows.map((r: any) => (
            <TableRow key={r.id}>
              <TableCell className="font-mono">
                {r.code}
                {r.origin === "seed" && (
                  <Badge variant="secondary" className="ml-2 text-[10px]">{t("componentLibrary.seedBadge")}</Badge>
                )}
              </TableCell>
              <TableCell><Badge variant="outline">{r.family}</Badge></TableCell>
              <TableCell className="font-mono text-xs">{r.ipcName ?? "-"}</TableCell>
              <TableCell>{r.mountType}</TableCell>
              <TableCell className="text-right">{r.pinCount ?? "-"}</TableCell>
              <TableCell className="text-right">{r.pitchMm ?? "-"}</TableCell>
              <TableCell>
                {r.hasPolarity
                  ? <Badge variant="destructive" className="text-[10px]">{r.polarityMark ?? t("componentLibrary.polarized")}</Badge>
                  : <span className="text-muted-foreground">-</span>}
              </TableCell>
              <TableCell className="text-right">{linkCount.get(r.id) ?? 0}</TableCell>
              <TableCell><StatusBadge status={r.isActive ? "active" : "inactive"} tone={r.isActive ? "success" : "default"} label={r.isActive ? t("masterData.active") : t("masterData.inactive")} /></TableCell>
              <TableCell className="text-right space-x-1">
                {canEdit && (
                  <EntityDialog
                    title={t("componentLibrary.editPackage")} fields={fields.filter((f) => f.key !== "code")} initial={r}
                    onSubmit={async (v) => { await update.mutateAsync({ ...toPackagePayload(v), code: undefined, id: r.id } as any); }}
                    trigger={<Button size="sm" variant="ghost"><Pencil className="h-4 w-4" /></Button>}
                  />
                )}
                {canDelete && <Button size="sm" variant="ghost" onClick={() => del.mutate({ id: r.id })}><Trash2 className="h-4 w-4" /></Button>}
              </TableCell>
            </TableRow>
          ))}
          {rows.length === 0 && <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground">{t("masterData.empty")}</TableCell></TableRow>}
        </TableBody>
      </Table>
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
  const del = trpc.componentLibrary.footprints.delete.useMutation({ onSuccess: () => { toast.success(t("masterData.deleted")); refresh(); } });

  const fields: Field[] = [
    { key: "code", label: t("masterData.code"), required: true },
    { key: "density", label: t("componentLibrary.density"), type: "select", options: DENSITIES.map((d) => ({ value: d, label: d })) },
    { key: "padCount", label: t("componentLibrary.padCount"), type: "number" },
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
        <Table>
          <TableHeader><TableRow>
            <TableHead>{t("masterData.code")}</TableHead>
            <TableHead>{t("componentLibrary.density")}</TableHead>
            <TableHead className="text-right">{t("componentLibrary.padCount")}</TableHead>
            <TableHead></TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {(footprints.data ?? []).map((r: any) => (
              <TableRow key={r.id}>
                <TableCell className="font-mono">{r.code}</TableCell>
                <TableCell>{r.density ?? "-"}</TableCell>
                <TableCell className="text-right">{r.padCount ?? "-"}</TableCell>
                <TableCell className="text-right space-x-1">
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
                  {canDelete && <Button size="sm" variant="ghost" onClick={() => del.mutate({ id: r.id })}><Trash2 className="h-4 w-4" /></Button>}
                </TableCell>
              </TableRow>
            ))}
            {footprints.data?.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">{t("masterData.empty")}</TableCell></TableRow>}
          </TableBody>
        </Table>
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
  const link = trpc.componentLibrary.linkMaterial.useMutation({ onSuccess: () => { toast.success(t("masterData.saved")); refresh(); } });
  const backfill = trpc.componentLibrary.backfillMaterialLinks.useMutation({
    onSuccess: (r) => { toast.success(t("componentLibrary.backfillDone", { count: r.linked })); refresh(); },
    onError: (e) => toast.error(e.message),
  });

  const pkgById = useMemo(() => {
    const m = new Map<number, any>();
    for (const p of packages.data ?? []) m.set(p.id, p);
    return m;
  }, [packages.data]);

  const rows = (materials.data ?? []).filter((r: any) => !onlyUnlinked || r.packageId == null);

  return (
    <Card><CardContent className="space-y-3 pt-4">
      <div className="flex flex-wrap items-center gap-3">
        {canEdit && (
          <Button size="sm" variant="outline" onClick={() => backfill.mutate()} disabled={backfill.isPending}>
            <Wand2 className="mr-1 h-4 w-4" /> {t("componentLibrary.backfillByType")}
          </Button>
        )}
        <div className="flex items-center gap-2">
          <Switch checked={onlyUnlinked} onCheckedChange={setOnlyUnlinked} />
          <Label className="text-sm">{t("componentLibrary.onlyUnlinked")}</Label>
        </div>
        <div className="ml-auto text-xs text-muted-foreground">
          {t("componentLibrary.linkCoverage", {
            linked: linkStats.data?.linkedMaterials ?? 0,
            total: linkStats.data?.totalMaterials ?? 0,
          })}
        </div>
      </div>
      <Table>
        <TableHeader><TableRow>
          <TableHead>{t("masterData.code")}</TableHead>
          <TableHead>{t("masterData.name")}</TableHead>
          <TableHead>{t("masterData.packageType")}</TableHead>
          <TableHead>{t("componentLibrary.linkedPackage")}</TableHead>
          <TableHead></TableHead>
        </TableRow></TableHeader>
        <TableBody>
          {rows.map((r: any) => (
            <TableRow key={r.id}>
              <TableCell className="font-mono">{r.code}</TableCell>
              <TableCell>{r.name}</TableCell>
              <TableCell className="font-mono text-xs">{r.packageType ?? "-"}</TableCell>
              <TableCell>
                {canEdit ? (
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
                )}
              </TableCell>
              <TableCell>
                {r.packageId != null
                  ? <Link2 className="h-4 w-4 text-success" aria-label={t("componentLibrary.linked")} />
                  : <Link2Off className="h-4 w-4 text-muted-foreground" aria-label={t("componentLibrary.unlinked")} />}
              </TableCell>
            </TableRow>
          ))}
          {rows.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">{t("masterData.empty")}</TableCell></TableRow>}
        </TableBody>
      </Table>
    </CardContent></Card>
  );
}
