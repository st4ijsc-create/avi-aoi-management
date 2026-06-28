/**
 * Doc 07 §③ — MES/MOM Master Data management (Supplier | Material | Customer |
 * Skill | Tool). Tabbed admin page; each tab is a list + create/edit dialog
 * backed by the `masterData` tRPC router.
 *
 * SAFETY: pure master-data CRUD. NEVER writes a value to a machine.
 * RBAC: module 'masterdata'. Create/edit/delete actions are hidden unless the
 * user holds the matching grant; the whole page requires canView.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { usePermissions } from "@/_core/hooks/usePermissions";
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
import { Database, Plus, Pencil, Trash2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

type Field = {
  key: string;
  label: string;
  type?: "text" | "number" | "bool" | "select";
  required?: boolean;
  options?: { value: string; label: string }[]; // for type "select"
};

export default function MasterDataManagement() {
  const { t } = useTranslation();
  const { hasPermission } = usePermissions();
  const canView = hasPermission("masterdata", "canView");

  if (!canView) {
    return (
      <DashboardLayout title={t("masterData.title")} navItems={navItems} currentPath="/master-data">
        <div className="p-6">
          <Card>
            <CardContent className="py-10 text-center text-muted-foreground">
              <AlertTriangle className="mx-auto mb-2 h-6 w-6" />
              {t("masterData.noPermission")}
            </CardContent>
          </Card>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout title={t("masterData.title")} navItems={navItems} currentPath="/master-data">
      <div className="p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Database className="h-6 w-6" />
          <h1 className="text-2xl font-semibold">{t("masterData.title")}</h1>
          <Badge variant="outline">MES/MOM</Badge>
        </div>
        <Tabs defaultValue="suppliers">
          <TabsList>
            <TabsTrigger value="suppliers">{t("masterData.tabs.suppliers")}</TabsTrigger>
            <TabsTrigger value="materials">{t("masterData.tabs.materials")}</TabsTrigger>
            <TabsTrigger value="customers">{t("masterData.tabs.customers")}</TabsTrigger>
            <TabsTrigger value="skills">{t("masterData.tabs.skills")}</TabsTrigger>
            <TabsTrigger value="tools">{t("masterData.tabs.tools")}</TabsTrigger>
            <TabsTrigger value="uom">{t("masterData.tabs.uom")}</TabsTrigger>
            <TabsTrigger value="calendar">{t("masterData.tabs.calendar")}</TabsTrigger>
            <TabsTrigger value="inventory">{t("masterData.tabs.inventory")}</TabsTrigger>
          </TabsList>
          <TabsContent value="suppliers"><SuppliersPanel /></TabsContent>
          <TabsContent value="materials"><MaterialsPanel /></TabsContent>
          <TabsContent value="customers"><CustomersPanel /></TabsContent>
          <TabsContent value="skills"><SkillsPanel /></TabsContent>
          <TabsContent value="tools"><ToolsPanel /></TabsContent>
          <TabsContent value="uom"><UomPanel /></TabsContent>
          <TabsContent value="calendar"><CalendarPanel /></TabsContent>
          <TabsContent value="inventory"><InventoryPanel /></TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}

// ─── Reusable create/edit dialog ────────────────────────────────────────────
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
        <div className="grid gap-3 py-2">
          {fields.map((f) => (
            <div key={f.key} className="grid gap-1">
              <Label>{f.label}{f.required && <span className="text-destructive"> *</span>}</Label>
              {f.type === "bool" ? (
                <Switch
                  checked={!!vals[f.key]}
                  onCheckedChange={(c) => setVals((v) => ({ ...v, [f.key]: c }))}
                />
              ) : f.type === "select" ? (
                <select
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                  value={vals[f.key] ?? ""}
                  onChange={(e) => setVals((v) => ({ ...v, [f.key]: e.target.value || undefined }))}
                >
                  <option value="">--</option>
                  {(f.options ?? []).map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
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

function ActiveBadge({ active }: { active: boolean }) {
  const { t } = useTranslation();
  return <Badge variant={active ? "default" : "outline"}>{active ? t("masterData.active") : t("masterData.inactive")}</Badge>;
}

// ─── Suppliers ──────────────────────────────────────────────────────────────
function SuppliersPanel() {
  const { t } = useTranslation();
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission("masterdata", "canCreate");
  const canEdit = hasPermission("masterdata", "canEdit");
  const canDelete = hasPermission("masterdata", "canDelete");
  const list = trpc.masterData.suppliers.list.useQuery({});
  const utils = trpc.useUtils();
  const refresh = () => utils.masterData.suppliers.list.invalidate();
  const create = trpc.masterData.suppliers.create.useMutation({ onSuccess: () => { toast.success(t("masterData.saved")); refresh(); } });
  const update = trpc.masterData.suppliers.update.useMutation({ onSuccess: () => { toast.success(t("masterData.saved")); refresh(); } });
  const del = trpc.masterData.suppliers.delete.useMutation({ onSuccess: () => { toast.success(t("masterData.deleted")); refresh(); } });

  const fields: Field[] = [
    { key: "code", label: t("masterData.code"), required: true },
    { key: "name", label: t("masterData.name"), required: true },
    { key: "contactName", label: t("masterData.contact") },
    { key: "contactEmail", label: t("masterData.email") },
    { key: "country", label: t("masterData.country") },
    { key: "rating", label: t("masterData.rating"), type: "number" },
    { key: "isActive", label: t("masterData.active"), type: "bool" },
    { key: "notes", label: t("masterData.notes") },
  ];

  return (
    <Card><CardContent className="space-y-3 pt-4">
      {canCreate && (
        <EntityDialog
          title={t("masterData.newSupplier")} fields={fields} initial={{ isActive: true }}
          onSubmit={async (v) => { await create.mutateAsync(v as any); }}
          trigger={<Button><Plus className="mr-1 h-4 w-4" /> {t("masterData.newSupplier")}</Button>}
        />
      )}
      <Table>
        <TableHeader><TableRow>
          <TableHead>{t("masterData.code")}</TableHead><TableHead>{t("masterData.name")}</TableHead>
          <TableHead>{t("masterData.type")}</TableHead><TableHead>{t("masterData.approval")}</TableHead>
          <TableHead>{t("masterData.active")}</TableHead><TableHead></TableHead>
        </TableRow></TableHeader>
        <TableBody>
          {(list.data ?? []).map((r: any) => (
            <TableRow key={r.id}>
              <TableCell className="font-mono">{r.code}</TableCell>
              <TableCell>{r.name}</TableCell>
              <TableCell>{r.type}</TableCell>
              <TableCell><Badge variant="secondary">{r.approvalStatus}</Badge></TableCell>
              <TableCell><ActiveBadge active={r.isActive} /></TableCell>
              <TableCell className="text-right space-x-1">
                {canEdit && (
                  <EntityDialog
                    title={t("masterData.editSupplier")} fields={fields} initial={r}
                    onSubmit={async (v) => { await update.mutateAsync({ ...v, id: r.id } as any); }}
                    trigger={<Button size="sm" variant="ghost"><Pencil className="h-4 w-4" /></Button>}
                  />
                )}
                {canDelete && <Button size="sm" variant="ghost" onClick={() => del.mutate({ id: r.id })}><Trash2 className="h-4 w-4" /></Button>}
              </TableCell>
            </TableRow>
          ))}
          {list.data?.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">{t("masterData.empty")}</TableCell></TableRow>}
        </TableBody>
      </Table>
    </CardContent></Card>
  );
}

// ─── Materials ──────────────────────────────────────────────────────────────
function MaterialsPanel() {
  const { t } = useTranslation();
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission("masterdata", "canCreate");
  const canEdit = hasPermission("masterdata", "canEdit");
  const canDelete = hasPermission("masterdata", "canDelete");
  const list = trpc.masterData.materials.list.useQuery({});
  const utils = trpc.useUtils();
  const refresh = () => utils.masterData.materials.list.invalidate();
  const create = trpc.masterData.materials.create.useMutation({ onSuccess: () => { toast.success(t("masterData.saved")); refresh(); } });
  const update = trpc.masterData.materials.update.useMutation({ onSuccess: () => { toast.success(t("masterData.saved")); refresh(); } });
  const del = trpc.masterData.materials.delete.useMutation({ onSuccess: () => { toast.success(t("masterData.deleted")); refresh(); } });

  const fields: Field[] = [
    { key: "code", label: t("masterData.code"), required: true },
    { key: "name", label: t("masterData.name"), required: true },
    { key: "materialClass", label: t("masterData.materialClass") },
    { key: "mpn", label: t("masterData.mpn") },
    { key: "manufacturer", label: t("masterData.manufacturer") },
    { key: "packageType", label: t("masterData.packageType") },
    { key: "msl", label: t("masterData.msl") },
    { key: "unit", label: t("masterData.unit") },
    { key: "rohs", label: t("masterData.rohs"), type: "bool" },
    { key: "isActive", label: t("masterData.active"), type: "bool" },
  ];

  return (
    <Card><CardContent className="space-y-3 pt-4">
      {canCreate && (
        <EntityDialog
          title={t("masterData.newMaterial")} fields={fields} initial={{ isActive: true, rohs: true, unit: "pcs" }}
          onSubmit={async (v) => { await create.mutateAsync(v as any); }}
          trigger={<Button><Plus className="mr-1 h-4 w-4" /> {t("masterData.newMaterial")}</Button>}
        />
      )}
      <Table>
        <TableHeader><TableRow>
          <TableHead>{t("masterData.code")}</TableHead><TableHead>{t("masterData.name")}</TableHead>
          <TableHead>{t("masterData.mpn")}</TableHead><TableHead>{t("masterData.packageType")}</TableHead>
          <TableHead>RoHS</TableHead><TableHead>{t("masterData.active")}</TableHead><TableHead></TableHead>
        </TableRow></TableHeader>
        <TableBody>
          {(list.data ?? []).map((r: any) => (
            <TableRow key={r.id}>
              <TableCell className="font-mono">{r.code}</TableCell>
              <TableCell>{r.name}</TableCell>
              <TableCell>{r.mpn ?? "-"}</TableCell>
              <TableCell>{r.packageType ?? "-"}</TableCell>
              <TableCell>{r.rohs ? "✓" : "✗"}</TableCell>
              <TableCell><ActiveBadge active={r.isActive} /></TableCell>
              <TableCell className="text-right space-x-1">
                {canEdit && (
                  <EntityDialog
                    title={t("masterData.editMaterial")} fields={fields} initial={r}
                    onSubmit={async (v) => { await update.mutateAsync({ ...v, id: r.id } as any); }}
                    trigger={<Button size="sm" variant="ghost"><Pencil className="h-4 w-4" /></Button>}
                  />
                )}
                {canDelete && <Button size="sm" variant="ghost" onClick={() => del.mutate({ id: r.id })}><Trash2 className="h-4 w-4" /></Button>}
              </TableCell>
            </TableRow>
          ))}
          {list.data?.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">{t("masterData.empty")}</TableCell></TableRow>}
        </TableBody>
      </Table>
    </CardContent></Card>
  );
}

// ─── Customers ──────────────────────────────────────────────────────────────
function CustomersPanel() {
  const { t } = useTranslation();
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission("masterdata", "canCreate");
  const canEdit = hasPermission("masterdata", "canEdit");
  const canDelete = hasPermission("masterdata", "canDelete");
  const list = trpc.masterData.customers.list.useQuery({});
  const utils = trpc.useUtils();
  const refresh = () => utils.masterData.customers.list.invalidate();
  const create = trpc.masterData.customers.create.useMutation({ onSuccess: () => { toast.success(t("masterData.saved")); refresh(); } });
  const update = trpc.masterData.customers.update.useMutation({ onSuccess: () => { toast.success(t("masterData.saved")); refresh(); } });
  const del = trpc.masterData.customers.delete.useMutation({ onSuccess: () => { toast.success(t("masterData.deleted")); refresh(); } });

  const fields: Field[] = [
    { key: "code", label: t("masterData.code"), required: true },
    { key: "name", label: t("masterData.name"), required: true },
    { key: "contactName", label: t("masterData.contact") },
    { key: "contactEmail", label: t("masterData.email") },
    { key: "country", label: t("masterData.country") },
    { key: "isActive", label: t("masterData.active"), type: "bool" },
    { key: "notes", label: t("masterData.notes") },
  ];

  return (
    <Card><CardContent className="space-y-3 pt-4">
      {canCreate && (
        <EntityDialog
          title={t("masterData.newCustomer")} fields={fields} initial={{ isActive: true }}
          onSubmit={async (v) => { await create.mutateAsync(v as any); }}
          trigger={<Button><Plus className="mr-1 h-4 w-4" /> {t("masterData.newCustomer")}</Button>}
        />
      )}
      <Table>
        <TableHeader><TableRow>
          <TableHead>{t("masterData.code")}</TableHead><TableHead>{t("masterData.name")}</TableHead>
          <TableHead>{t("masterData.country")}</TableHead><TableHead>{t("masterData.active")}</TableHead><TableHead></TableHead>
        </TableRow></TableHeader>
        <TableBody>
          {(list.data ?? []).map((r: any) => (
            <TableRow key={r.id}>
              <TableCell className="font-mono">{r.code}</TableCell>
              <TableCell>{r.name}</TableCell>
              <TableCell>{r.country ?? "-"}</TableCell>
              <TableCell><ActiveBadge active={r.isActive} /></TableCell>
              <TableCell className="text-right space-x-1">
                {canEdit && (
                  <EntityDialog
                    title={t("masterData.editCustomer")} fields={fields} initial={r}
                    onSubmit={async (v) => { await update.mutateAsync({ ...v, id: r.id } as any); }}
                    trigger={<Button size="sm" variant="ghost"><Pencil className="h-4 w-4" /></Button>}
                  />
                )}
                {canDelete && <Button size="sm" variant="ghost" onClick={() => del.mutate({ id: r.id })}><Trash2 className="h-4 w-4" /></Button>}
              </TableCell>
            </TableRow>
          ))}
          {list.data?.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">{t("masterData.empty")}</TableCell></TableRow>}
        </TableBody>
      </Table>
    </CardContent></Card>
  );
}

// ─── Skills ─────────────────────────────────────────────────────────────────
function SkillsPanel() {
  const { t } = useTranslation();
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission("masterdata", "canCreate");
  const canEdit = hasPermission("masterdata", "canEdit");
  const canDelete = hasPermission("masterdata", "canDelete");
  const list = trpc.masterData.skills.list.useQuery({});
  const utils = trpc.useUtils();
  const refresh = () => utils.masterData.skills.list.invalidate();
  const create = trpc.masterData.skills.create.useMutation({ onSuccess: () => { toast.success(t("masterData.saved")); refresh(); } });
  const update = trpc.masterData.skills.update.useMutation({ onSuccess: () => { toast.success(t("masterData.saved")); refresh(); } });
  const del = trpc.masterData.skills.delete.useMutation({ onSuccess: () => { toast.success(t("masterData.deleted")); refresh(); } });

  const fields: Field[] = [
    { key: "code", label: t("masterData.code"), required: true },
    { key: "name", label: t("masterData.name"), required: true },
    { key: "category", label: t("masterData.category") },
    { key: "description", label: t("masterData.description") },
    { key: "isActive", label: t("masterData.active"), type: "bool" },
  ];

  return (
    <Card><CardContent className="space-y-3 pt-4">
      {canCreate && (
        <EntityDialog
          title={t("masterData.newSkill")} fields={fields} initial={{ isActive: true }}
          onSubmit={async (v) => { await create.mutateAsync(v as any); }}
          trigger={<Button><Plus className="mr-1 h-4 w-4" /> {t("masterData.newSkill")}</Button>}
        />
      )}
      <Table>
        <TableHeader><TableRow>
          <TableHead>{t("masterData.code")}</TableHead><TableHead>{t("masterData.name")}</TableHead>
          <TableHead>{t("masterData.category")}</TableHead><TableHead>{t("masterData.active")}</TableHead><TableHead></TableHead>
        </TableRow></TableHeader>
        <TableBody>
          {(list.data ?? []).map((r: any) => (
            <TableRow key={r.id}>
              <TableCell className="font-mono">{r.code}</TableCell>
              <TableCell>{r.name}</TableCell>
              <TableCell>{r.category ?? "-"}</TableCell>
              <TableCell><ActiveBadge active={r.isActive} /></TableCell>
              <TableCell className="text-right space-x-1">
                {canEdit && (
                  <EntityDialog
                    title={t("masterData.editSkill")} fields={fields} initial={r}
                    onSubmit={async (v) => { await update.mutateAsync({ ...v, id: r.id } as any); }}
                    trigger={<Button size="sm" variant="ghost"><Pencil className="h-4 w-4" /></Button>}
                  />
                )}
                {canDelete && <Button size="sm" variant="ghost" onClick={() => del.mutate({ id: r.id })}><Trash2 className="h-4 w-4" /></Button>}
              </TableCell>
            </TableRow>
          ))}
          {list.data?.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">{t("masterData.empty")}</TableCell></TableRow>}
        </TableBody>
      </Table>
    </CardContent></Card>
  );
}

// ─── Tools ──────────────────────────────────────────────────────────────────
function ToolsPanel() {
  const { t } = useTranslation();
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission("masterdata", "canCreate");
  const canEdit = hasPermission("masterdata", "canEdit");
  const canDelete = hasPermission("masterdata", "canDelete");
  const list = trpc.masterData.tools.list.useQuery({});
  const utils = trpc.useUtils();
  const refresh = () => utils.masterData.tools.list.invalidate();
  const create = trpc.masterData.tools.create.useMutation({ onSuccess: () => { toast.success(t("masterData.saved")); refresh(); } });
  const update = trpc.masterData.tools.update.useMutation({ onSuccess: () => { toast.success(t("masterData.saved")); refresh(); } });
  const del = trpc.masterData.tools.delete.useMutation({ onSuccess: () => { toast.success(t("masterData.deleted")); refresh(); } });

  const fields: Field[] = [
    { key: "code", label: t("masterData.code"), required: true },
    { key: "name", label: t("masterData.name"), required: true },
    { key: "machineType", label: t("masterData.machineType") },
    { key: "lifeLimit", label: t("masterData.lifeLimit"), type: "number" },
    { key: "lifeUsed", label: t("masterData.lifeUsed"), type: "number" },
    { key: "location", label: t("masterData.location") },
    { key: "isActive", label: t("masterData.active"), type: "bool" },
  ];

  return (
    <Card><CardContent className="space-y-3 pt-4">
      {canCreate && (
        <EntityDialog
          title={t("masterData.newTool")} fields={fields} initial={{ isActive: true, lifeUsed: 0 }}
          onSubmit={async (v) => { await create.mutateAsync(v as any); }}
          trigger={<Button><Plus className="mr-1 h-4 w-4" /> {t("masterData.newTool")}</Button>}
        />
      )}
      <Table>
        <TableHeader><TableRow>
          <TableHead>{t("masterData.code")}</TableHead><TableHead>{t("masterData.name")}</TableHead>
          <TableHead>{t("masterData.type")}</TableHead><TableHead>{t("masterData.status")}</TableHead>
          <TableHead>{t("masterData.life")}</TableHead><TableHead></TableHead>
        </TableRow></TableHeader>
        <TableBody>
          {(list.data ?? []).map((r: any) => (
            <TableRow key={r.id}>
              <TableCell className="font-mono">{r.code}</TableCell>
              <TableCell>{r.name}</TableCell>
              <TableCell>{r.type}</TableCell>
              <TableCell><Badge variant="secondary">{r.status}</Badge></TableCell>
              <TableCell>{r.lifeLimit != null ? `${r.lifeUsed}/${r.lifeLimit}` : (r.lifeUsed ?? 0)}</TableCell>
              <TableCell className="text-right space-x-1">
                {canEdit && (
                  <EntityDialog
                    title={t("masterData.editTool")} fields={fields} initial={r}
                    onSubmit={async (v) => { await update.mutateAsync({ ...v, id: r.id } as any); }}
                    trigger={<Button size="sm" variant="ghost"><Pencil className="h-4 w-4" /></Button>}
                  />
                )}
                {canDelete && <Button size="sm" variant="ghost" onClick={() => del.mutate({ id: r.id })}><Trash2 className="h-4 w-4" /></Button>}
              </TableCell>
            </TableRow>
          ))}
          {list.data?.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">{t("masterData.empty")}</TableCell></TableRow>}
        </TableBody>
      </Table>
    </CardContent></Card>
  );
}

// ─── Units of Measure (+ conversions) ────────────────────────────────────────
function UomPanel() {
  const { t } = useTranslation();
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission("masterdata", "canCreate");
  const canEdit = hasPermission("masterdata", "canEdit");
  const canDelete = hasPermission("masterdata", "canDelete");
  const list = trpc.masterData.uom.list.useQuery({});
  const convList = trpc.masterData.uom.listConversions.useQuery();
  const utils = trpc.useUtils();
  const refresh = () => utils.masterData.uom.list.invalidate();
  const refreshConv = () => utils.masterData.uom.listConversions.invalidate();
  const create = trpc.masterData.uom.create.useMutation({ onSuccess: () => { toast.success(t("masterData.saved")); refresh(); } });
  const update = trpc.masterData.uom.update.useMutation({ onSuccess: () => { toast.success(t("masterData.saved")); refresh(); } });
  const del = trpc.masterData.uom.delete.useMutation({ onSuccess: () => { toast.success(t("masterData.deleted")); refresh(); } });
  const createConv = trpc.masterData.uom.createConversion.useMutation({ onSuccess: () => { toast.success(t("masterData.saved")); refreshConv(); } });
  const delConv = trpc.masterData.uom.deleteConversion.useMutation({ onSuccess: () => { toast.success(t("masterData.deleted")); refreshConv(); } });

  const dimensions = ["length", "mass", "volume", "time", "temperature", "count", "percent", "other"];
  const fields: Field[] = [
    { key: "code", label: t("masterData.code"), required: true },
    { key: "name", label: t("masterData.name"), required: true },
    { key: "dimension", label: t("masterData.dimension"), type: "select", options: dimensions.map((d) => ({ value: d, label: t(`masterData.dimensions.${d}`) })) },
    { key: "isBase", label: t("masterData.isBase"), type: "bool" },
    { key: "isActive", label: t("masterData.active"), type: "bool" },
  ];
  const convFields: Field[] = [
    { key: "fromUomCode", label: t("masterData.fromUom"), required: true },
    { key: "toUomCode", label: t("masterData.toUom"), required: true },
    { key: "factor", label: t("masterData.factor"), type: "number", required: true },
    { key: "offset", label: t("masterData.offset"), type: "number" },
    { key: "notes", label: t("masterData.notes") },
  ];

  return (
    <div className="space-y-4">
      <Card><CardContent className="space-y-3 pt-4">
        {canCreate && (
          <EntityDialog
            title={t("masterData.newUom")} fields={fields} initial={{ isActive: true, dimension: "count" }}
            onSubmit={async (v) => { await create.mutateAsync(v as any); }}
            trigger={<Button><Plus className="mr-1 h-4 w-4" /> {t("masterData.newUom")}</Button>}
          />
        )}
        <Table>
          <TableHeader><TableRow>
            <TableHead>{t("masterData.code")}</TableHead><TableHead>{t("masterData.name")}</TableHead>
            <TableHead>{t("masterData.dimension")}</TableHead><TableHead>{t("masterData.isBase")}</TableHead>
            <TableHead>{t("masterData.active")}</TableHead><TableHead></TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {(list.data ?? []).map((r: any) => (
              <TableRow key={r.id}>
                <TableCell className="font-mono">{r.code}</TableCell>
                <TableCell>{r.name}</TableCell>
                <TableCell>{r.dimension}</TableCell>
                <TableCell>{r.isBase ? "✓" : "-"}</TableCell>
                <TableCell><ActiveBadge active={r.isActive} /></TableCell>
                <TableCell className="text-right space-x-1">
                  {canEdit && (
                    <EntityDialog
                      title={t("masterData.editUom")} fields={fields} initial={r}
                      onSubmit={async (v) => { await update.mutateAsync({ ...v, id: r.id } as any); }}
                      trigger={<Button size="sm" variant="ghost"><Pencil className="h-4 w-4" /></Button>}
                    />
                  )}
                  {canDelete && <Button size="sm" variant="ghost" onClick={() => del.mutate({ id: r.id })}><Trash2 className="h-4 w-4" /></Button>}
                </TableCell>
              </TableRow>
            ))}
            {list.data?.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">{t("masterData.empty")}</TableCell></TableRow>}
          </TableBody>
        </Table>
      </CardContent></Card>

      <Card><CardContent className="space-y-3 pt-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">{t("masterData.conversions")}</h3>
          {canCreate && (
            <EntityDialog
              title={t("masterData.newConversion")} fields={convFields} initial={{ offset: 0 }}
              onSubmit={async (v) => { await createConv.mutateAsync(v as any); }}
              trigger={<Button size="sm" variant="outline"><Plus className="mr-1 h-4 w-4" /> {t("masterData.newConversion")}</Button>}
            />
          )}
        </div>
        <Table>
          <TableHeader><TableRow>
            <TableHead>{t("masterData.fromUom")}</TableHead><TableHead>{t("masterData.toUom")}</TableHead>
            <TableHead>{t("masterData.factor")}</TableHead><TableHead>{t("masterData.offset")}</TableHead><TableHead></TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {(convList.data ?? []).map((r: any) => (
              <TableRow key={r.id}>
                <TableCell className="font-mono">{r.fromUomCode}</TableCell>
                <TableCell className="font-mono">{r.toUomCode}</TableCell>
                <TableCell>{r.factor}</TableCell>
                <TableCell>{r.offset}</TableCell>
                <TableCell className="text-right">
                  {canDelete && <Button size="sm" variant="ghost" onClick={() => delConv.mutate({ id: r.id })}><Trash2 className="h-4 w-4" /></Button>}
                </TableCell>
              </TableRow>
            ))}
            {convList.data?.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">{t("masterData.empty")}</TableCell></TableRow>}
          </TableBody>
        </Table>
      </CardContent></Card>
    </div>
  );
}

// ─── Plant / Shift Calendar (+ days) ─────────────────────────────────────────
function CalendarPanel() {
  const { t } = useTranslation();
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission("masterdata", "canCreate");
  const canEdit = hasPermission("masterdata", "canEdit");
  const canDelete = hasPermission("masterdata", "canDelete");
  const list = trpc.masterData.calendar.list.useQuery({});
  const [selected, setSelected] = useState<number | undefined>(undefined);
  const days = trpc.masterData.calendar.listDays.useQuery({ calendarId: selected! }, { enabled: selected != null });
  const utils = trpc.useUtils();
  const refresh = () => utils.masterData.calendar.list.invalidate();
  const refreshDays = () => utils.masterData.calendar.listDays.invalidate();
  const create = trpc.masterData.calendar.create.useMutation({ onSuccess: () => { toast.success(t("masterData.saved")); refresh(); } });
  const update = trpc.masterData.calendar.update.useMutation({ onSuccess: () => { toast.success(t("masterData.saved")); refresh(); } });
  const del = trpc.masterData.calendar.delete.useMutation({ onSuccess: () => { toast.success(t("masterData.deleted")); refresh(); } });
  const createDay = trpc.masterData.calendar.createDay.useMutation({ onSuccess: () => { toast.success(t("masterData.saved")); refreshDays(); } });
  const delDay = trpc.masterData.calendar.deleteDay.useMutation({ onSuccess: () => { toast.success(t("masterData.deleted")); refreshDays(); } });

  const dayTypes = ["working", "holiday", "planned_downtime"];
  const fields: Field[] = [
    { key: "code", label: t("masterData.code"), required: true },
    { key: "name", label: t("masterData.name"), required: true },
    { key: "factoryCode", label: t("masterData.factoryCode") },
    { key: "timezone", label: t("masterData.timezone") },
    { key: "isActive", label: t("masterData.active"), type: "bool" },
  ];
  const dayFields: Field[] = [
    { key: "date", label: t("masterData.date"), required: true },
    { key: "dayType", label: t("masterData.dayType"), type: "select", options: dayTypes.map((d) => ({ value: d, label: t(`masterData.dayTypes.${d}`) })) },
    { key: "notes", label: t("masterData.notes") },
  ];

  return (
    <div className="space-y-4">
      <Card><CardContent className="space-y-3 pt-4">
        {canCreate && (
          <EntityDialog
            title={t("masterData.newCalendar")} fields={fields} initial={{ isActive: true, timezone: "Asia/Ho_Chi_Minh" }}
            onSubmit={async (v) => { await create.mutateAsync(v as any); }}
            trigger={<Button><Plus className="mr-1 h-4 w-4" /> {t("masterData.newCalendar")}</Button>}
          />
        )}
        <Table>
          <TableHeader><TableRow>
            <TableHead>{t("masterData.code")}</TableHead><TableHead>{t("masterData.name")}</TableHead>
            <TableHead>{t("masterData.factoryCode")}</TableHead><TableHead>{t("masterData.timezone")}</TableHead>
            <TableHead>{t("masterData.active")}</TableHead><TableHead></TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {(list.data ?? []).map((r: any) => (
              <TableRow key={r.id} className={selected === r.id ? "bg-muted/50" : ""}>
                <TableCell className="font-mono cursor-pointer" onClick={() => setSelected(r.id)}>{r.code}</TableCell>
                <TableCell className="cursor-pointer" onClick={() => setSelected(r.id)}>{r.name}</TableCell>
                <TableCell>{r.factoryCode ?? "-"}</TableCell>
                <TableCell>{r.timezone}</TableCell>
                <TableCell><ActiveBadge active={r.isActive} /></TableCell>
                <TableCell className="text-right space-x-1">
                  {canEdit && (
                    <EntityDialog
                      title={t("masterData.editCalendar")} fields={fields} initial={r}
                      onSubmit={async (v) => { await update.mutateAsync({ ...v, id: r.id } as any); }}
                      trigger={<Button size="sm" variant="ghost"><Pencil className="h-4 w-4" /></Button>}
                    />
                  )}
                  {canDelete && <Button size="sm" variant="ghost" onClick={() => del.mutate({ id: r.id })}><Trash2 className="h-4 w-4" /></Button>}
                </TableCell>
              </TableRow>
            ))}
            {list.data?.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">{t("masterData.empty")}</TableCell></TableRow>}
          </TableBody>
        </Table>
      </CardContent></Card>

      <Card><CardContent className="space-y-3 pt-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">{t("masterData.calendarDays")}{selected == null ? ` — ${t("masterData.selectCalendar")}` : ""}</h3>
          {canCreate && selected != null && (
            <EntityDialog
              title={t("masterData.newDay")} fields={dayFields} initial={{ dayType: "working" }}
              onSubmit={async (v) => { await createDay.mutateAsync({ ...v, calendarId: selected } as any); }}
              trigger={<Button size="sm" variant="outline"><Plus className="mr-1 h-4 w-4" /> {t("masterData.newDay")}</Button>}
            />
          )}
        </div>
        {selected != null && (
          <Table>
            <TableHeader><TableRow>
              <TableHead>{t("masterData.date")}</TableHead><TableHead>{t("masterData.dayType")}</TableHead>
              <TableHead>{t("masterData.notes")}</TableHead><TableHead></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {(days.data ?? []).map((r: any) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono">{r.date}</TableCell>
                  <TableCell><Badge variant="secondary">{t(`masterData.dayTypes.${r.dayType}`)}</Badge></TableCell>
                  <TableCell>{r.notes ?? "-"}</TableCell>
                  <TableCell className="text-right">
                    {canDelete && <Button size="sm" variant="ghost" onClick={() => delDay.mutate({ id: r.id })}><Trash2 className="h-4 w-4" /></Button>}
                  </TableCell>
                </TableRow>
              ))}
              {days.data?.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">{t("masterData.empty")}</TableCell></TableRow>}
            </TableBody>
          </Table>
        )}
      </CardContent></Card>
    </div>
  );
}

// ─── Warehouse / Inventory ───────────────────────────────────────────────────
function InventoryPanel() {
  const { t } = useTranslation();
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission("masterdata", "canCreate");
  const canEdit = hasPermission("masterdata", "canEdit");
  const canDelete = hasPermission("masterdata", "canDelete");
  const utils = trpc.useUtils();

  const warehouses = trpc.masterData.inventory.listWarehouses.useQuery({});
  const [selectedWh, setSelectedWh] = useState<number | undefined>(undefined);
  const locations = trpc.masterData.inventory.listLocations.useQuery({ warehouseId: selectedWh! }, { enabled: selectedWh != null });
  const balances = trpc.masterData.inventory.listBalances.useQuery({});

  const refreshWh = () => utils.masterData.inventory.listWarehouses.invalidate();
  const refreshLoc = () => utils.masterData.inventory.listLocations.invalidate();
  const refreshBal = () => utils.masterData.inventory.listBalances.invalidate();
  const createWh = trpc.masterData.inventory.createWarehouse.useMutation({ onSuccess: () => { toast.success(t("masterData.saved")); refreshWh(); } });
  const updateWh = trpc.masterData.inventory.updateWarehouse.useMutation({ onSuccess: () => { toast.success(t("masterData.saved")); refreshWh(); } });
  const delWh = trpc.masterData.inventory.deleteWarehouse.useMutation({ onSuccess: () => { toast.success(t("masterData.deleted")); refreshWh(); } });
  const createLoc = trpc.masterData.inventory.createLocation.useMutation({ onSuccess: () => { toast.success(t("masterData.saved")); refreshLoc(); } });
  const delLoc = trpc.masterData.inventory.deleteLocation.useMutation({ onSuccess: () => { toast.success(t("masterData.deleted")); refreshLoc(); } });
  const upsertBal = trpc.masterData.inventory.upsertBalance.useMutation({ onSuccess: () => { toast.success(t("masterData.saved")); refreshBal(); } });
  const delBal = trpc.masterData.inventory.deleteBalance.useMutation({ onSuccess: () => { toast.success(t("masterData.deleted")); refreshBal(); } });

  const whTypes = ["raw", "wip", "fg", "spare", "other"];
  const locKinds = ["bin", "shelf", "zone"];
  const whFields: Field[] = [
    { key: "code", label: t("masterData.code"), required: true },
    { key: "name", label: t("masterData.name"), required: true },
    { key: "factoryCode", label: t("masterData.factoryCode") },
    { key: "type", label: t("masterData.type"), type: "select", options: whTypes.map((d) => ({ value: d, label: t(`masterData.warehouseTypes.${d}`) })) },
    { key: "isActive", label: t("masterData.active"), type: "bool" },
  ];
  const locFields: Field[] = [
    { key: "code", label: t("masterData.code"), required: true },
    { key: "name", label: t("masterData.name") },
    { key: "kind", label: t("masterData.kind"), type: "select", options: locKinds.map((d) => ({ value: d, label: t(`masterData.locationKinds.${d}`) })) },
    { key: "isActive", label: t("masterData.active"), type: "bool" },
  ];
  const balFields: Field[] = [
    { key: "materialCode", label: t("masterData.materialCode"), required: true },
    { key: "warehouseCode", label: t("masterData.warehouseCode"), required: true },
    { key: "locationCode", label: t("masterData.locationCode") },
    { key: "lotCode", label: t("masterData.lotCode") },
    { key: "quantityOnHand", label: t("masterData.quantityOnHand"), type: "number", required: true },
    { key: "uomCode", label: t("masterData.unit") },
  ];

  return (
    <div className="space-y-4">
      <Card><CardContent className="space-y-3 pt-4">
        {canCreate && (
          <EntityDialog
            title={t("masterData.newWarehouse")} fields={whFields} initial={{ isActive: true, type: "other" }}
            onSubmit={async (v) => { await createWh.mutateAsync(v as any); }}
            trigger={<Button><Plus className="mr-1 h-4 w-4" /> {t("masterData.newWarehouse")}</Button>}
          />
        )}
        <Table>
          <TableHeader><TableRow>
            <TableHead>{t("masterData.code")}</TableHead><TableHead>{t("masterData.name")}</TableHead>
            <TableHead>{t("masterData.type")}</TableHead><TableHead>{t("masterData.factoryCode")}</TableHead>
            <TableHead>{t("masterData.active")}</TableHead><TableHead></TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {(warehouses.data ?? []).map((r: any) => (
              <TableRow key={r.id} className={selectedWh === r.id ? "bg-muted/50" : ""}>
                <TableCell className="font-mono cursor-pointer" onClick={() => setSelectedWh(r.id)}>{r.code}</TableCell>
                <TableCell className="cursor-pointer" onClick={() => setSelectedWh(r.id)}>{r.name}</TableCell>
                <TableCell><Badge variant="secondary">{t(`masterData.warehouseTypes.${r.type}`)}</Badge></TableCell>
                <TableCell>{r.factoryCode ?? "-"}</TableCell>
                <TableCell><ActiveBadge active={r.isActive} /></TableCell>
                <TableCell className="text-right space-x-1">
                  {canEdit && (
                    <EntityDialog
                      title={t("masterData.editWarehouse")} fields={whFields} initial={r}
                      onSubmit={async (v) => { await updateWh.mutateAsync({ ...v, id: r.id } as any); }}
                      trigger={<Button size="sm" variant="ghost"><Pencil className="h-4 w-4" /></Button>}
                    />
                  )}
                  {canDelete && <Button size="sm" variant="ghost" onClick={() => delWh.mutate({ id: r.id })}><Trash2 className="h-4 w-4" /></Button>}
                </TableCell>
              </TableRow>
            ))}
            {warehouses.data?.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">{t("masterData.empty")}</TableCell></TableRow>}
          </TableBody>
        </Table>
      </CardContent></Card>

      <Card><CardContent className="space-y-3 pt-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">{t("masterData.storageLocations")}{selectedWh == null ? ` — ${t("masterData.selectWarehouse")}` : ""}</h3>
          {canCreate && selectedWh != null && (
            <EntityDialog
              title={t("masterData.newLocation")} fields={locFields} initial={{ isActive: true, kind: "bin" }}
              onSubmit={async (v) => { await createLoc.mutateAsync({ ...v, warehouseId: selectedWh } as any); }}
              trigger={<Button size="sm" variant="outline"><Plus className="mr-1 h-4 w-4" /> {t("masterData.newLocation")}</Button>}
            />
          )}
        </div>
        {selectedWh != null && (
          <Table>
            <TableHeader><TableRow>
              <TableHead>{t("masterData.code")}</TableHead><TableHead>{t("masterData.name")}</TableHead>
              <TableHead>{t("masterData.kind")}</TableHead><TableHead>{t("masterData.active")}</TableHead><TableHead></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {(locations.data ?? []).map((r: any) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono">{r.code}</TableCell>
                  <TableCell>{r.name ?? "-"}</TableCell>
                  <TableCell>{t(`masterData.locationKinds.${r.kind}`)}</TableCell>
                  <TableCell><ActiveBadge active={r.isActive} /></TableCell>
                  <TableCell className="text-right">
                    {canDelete && <Button size="sm" variant="ghost" onClick={() => delLoc.mutate({ id: r.id })}><Trash2 className="h-4 w-4" /></Button>}
                  </TableCell>
                </TableRow>
              ))}
              {locations.data?.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">{t("masterData.empty")}</TableCell></TableRow>}
            </TableBody>
          </Table>
        )}
      </CardContent></Card>

      <Card><CardContent className="space-y-3 pt-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">{t("masterData.inventoryBalances")}</h3>
          {canCreate && (
            <EntityDialog
              title={t("masterData.newBalance")} fields={balFields} initial={{ uomCode: "pcs", quantityOnHand: 0 }}
              onSubmit={async (v) => { await upsertBal.mutateAsync(v as any); }}
              trigger={<Button size="sm" variant="outline"><Plus className="mr-1 h-4 w-4" /> {t("masterData.newBalance")}</Button>}
            />
          )}
        </div>
        <Table>
          <TableHeader><TableRow>
            <TableHead>{t("masterData.materialCode")}</TableHead><TableHead>{t("masterData.warehouseCode")}</TableHead>
            <TableHead>{t("masterData.locationCode")}</TableHead><TableHead>{t("masterData.lotCode")}</TableHead>
            <TableHead>{t("masterData.quantityOnHand")}</TableHead><TableHead>{t("masterData.unit")}</TableHead><TableHead></TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {(balances.data ?? []).map((r: any) => (
              <TableRow key={r.id}>
                <TableCell className="font-mono">{r.materialCode}</TableCell>
                <TableCell className="font-mono">{r.warehouseCode}</TableCell>
                <TableCell>{r.locationCode ?? "-"}</TableCell>
                <TableCell>{r.lotCode ?? "-"}</TableCell>
                <TableCell>{r.quantityOnHand}</TableCell>
                <TableCell>{r.uomCode}</TableCell>
                <TableCell className="text-right">
                  {canDelete && <Button size="sm" variant="ghost" onClick={() => delBal.mutate({ id: r.id })}><Trash2 className="h-4 w-4" /></Button>}
                </TableCell>
              </TableRow>
            ))}
            {balances.data?.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">{t("masterData.empty")}</TableCell></TableRow>}
          </TableBody>
        </Table>
      </CardContent></Card>
    </div>
  );
}
