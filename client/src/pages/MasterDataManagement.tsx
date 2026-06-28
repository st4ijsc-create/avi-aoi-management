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

type Field = { key: string; label: string; type?: "text" | "number" | "bool"; required?: boolean };

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
          </TabsList>
          <TabsContent value="suppliers"><SuppliersPanel /></TabsContent>
          <TabsContent value="materials"><MaterialsPanel /></TabsContent>
          <TabsContent value="customers"><CustomersPanel /></TabsContent>
          <TabsContent value="skills"><SkillsPanel /></TabsContent>
          <TabsContent value="tools"><ToolsPanel /></TabsContent>
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
