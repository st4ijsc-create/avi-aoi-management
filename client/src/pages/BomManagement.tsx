/**
 * Sprint G2.4 — BOM / Feeder / Component-genealogy management (master data + trace).
 *
 * SAFETY: this page is master data CRUD + material telemetry + read-only trace.
 * It NEVER writes a value to a machine. Component installs are recorded as
 * OUTCOMES (telemetry) and link into the existing genealogy ledger via a "merge"
 * event — there is no control path here.
 *
 * RBAC: module 'mes_bom'. Create/edit/delete buttons are hidden unless the user
 * holds the matching grant; the whole page requires canView.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { usePermissions } from "@/_core/hooks/usePermissions";
import DashboardLayout from "@/components/DashboardLayout";
import { navItems } from "@/lib/navigation";
import { PageHeader, PageContainer } from "@/components/patterns";
import { ProductModelSelect, MachineSelect } from "@/components/patterns";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Boxes, Plus, Trash2, GitMerge, AlertTriangle } from "lucide-react";
import { PermissionGate, ViewOnlyBadge } from "@/components/PermissionGate";
import { EntityCombobox, type EntityOption } from "@/components/EntityCombobox";
import { toast } from "sonner";

// P2: shared materials master picker — turns componentCode free-text into a real
// materials.id FK. Degrades to [] when the user lacks masterdata:canView.
function useMaterialOptions(): EntityOption[] {
  const q = trpc.masterData.materials.list.useQuery({ activeOnly: true }, { retry: false });
  return (q.data ?? []).map((m: any) => ({ id: m.id, code: m.code, name: m.name }));
}

export default function BomManagement() {
  const { t } = useTranslation();
  const { hasPermission } = usePermissions();
  const canView = hasPermission("mes_bom", "canView");
  const canCreate = hasPermission("mes_bom", "canCreate");
  const canDelete = hasPermission("mes_bom", "canDelete");

  if (!canView) {
    return (
      <DashboardLayout title="BOM & Feeder (MES)" navItems={navItems} currentPath="/bom-management">
      <PageContainer>
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            <AlertTriangle className="mx-auto mb-2 h-6 w-6" />
            {t("bom.noPermission")}
          </CardContent>
        </Card>
      </PageContainer>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout title="BOM & Feeder (MES)" navItems={navItems} currentPath="/bom-management">
    <PageContainer>
      <PageHeader
        icon={<Boxes className="h-6 w-6" />}
        title={t("bom.title")}
        badge={<ViewOnlyBadge module="mes_bom" />}
        actions={<Badge variant="outline">G2.4</Badge>}
      />
      <Tabs defaultValue="bom">
        <TabsList>
          <TabsTrigger value="bom">{t("bom.tabBom")}</TabsTrigger>
          <TabsTrigger value="feeder">{t("bom.tabFeeder")}</TabsTrigger>
          <TabsTrigger value="trace">{t("bom.tabTrace")}</TabsTrigger>
        </TabsList>
        <TabsContent value="bom"><BomPanel canCreate={canCreate} canDelete={canDelete} /></TabsContent>
        <TabsContent value="feeder"><FeederPanel canCreate={canCreate} /></TabsContent>
        <TabsContent value="trace"><TracePanel /></TabsContent>
      </Tabs>
    </PageContainer>
    </DashboardLayout>
  );
}

// ─── BOM definitions + line items ───────────────────────────────────────────
function BomPanel({ canCreate, canDelete }: { canCreate: boolean; canDelete: boolean }) {
  const { t } = useTranslation();
  const [productModelId, setProductModelId] = useState<number | null>(null);
  const [selectedBomId, setSelectedBomId] = useState<number | null>(null);
  const pid = productModelId ?? 0;
  const utils = trpc.useUtils();

  const list = trpc.bom.listDefinitions.useQuery(
    { productModelId: pid },
    { enabled: Number.isFinite(pid) && pid > 0 },
  );
  const detail = trpc.bom.getDefinition.useQuery(
    { id: selectedBomId ?? 0 },
    { enabled: selectedBomId != null },
  );

  const [newCode, setNewCode] = useState("");
  const createDef = trpc.bom.createDefinition.useMutation({
    onSuccess: () => { toast.success(t("bom.toastCreated")); setNewCode(""); list.refetch(); },
    onError: (e) => toast.error(e.message),
  });
  const archiveDef = trpc.bom.archiveDefinition.useMutation({
    onSuccess: () => { toast.success(t("bom.toastArchived")); setSelectedBomId(null); list.refetch(); },
    onError: (e) => toast.error(e.message),
  });

  const materialOptions = useMaterialOptions();
  const [li, setLi] = useState<{ componentCode: string; materialId: number | null; qtyPer: string; refDesignator: string }>(
    { componentCode: "", materialId: null, qtyPer: "1", refDesignator: "" },
  );
  const addLine = trpc.bom.addLineItem.useMutation({
    onSuccess: () => { toast.success(t("bom.toastLineAdded")); setLi({ componentCode: "", materialId: null, qtyPer: "1", refDesignator: "" }); utils.bom.getDefinition.invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const delLine = trpc.bom.deleteLineItem.useMutation({
    onSuccess: () => { toast.success(t("bom.toastLineDeleted")); utils.bom.getDefinition.invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle>{t("bom.byProductModel")}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-end gap-2">
            <div>
              <Label>{t("bom.productModelId")}</Label>
              <ProductModelSelect value={productModelId} onChange={(v) => setProductModelId(v == null ? null : Number(v))} aria-label={t("bom.productModelId")} placeholder={t("bom.productModelIdPlaceholder")} clearable className="w-56" />
            </div>
            {canCreate && (
              <>
                <div>
                  <Label>{t("bom.newBomCode")}</Label>
                  <Input value={newCode} onChange={(e) => setNewCode(e.target.value)} className="w-48" placeholder="BOM-001" />
                </div>
                <Button
                  disabled={!newCode || !(pid > 0) || createDef.isPending}
                  onClick={() => createDef.mutate({ productModelId: pid, code: newCode })}
                >
                  <Plus className="mr-1 h-4 w-4" /> {t("bom.createBom")}
                </Button>
              </>
            )}
          </div>
          <Table>
            <TableHeader>
              <TableRow><TableHead>{t("bom.id")}</TableHead><TableHead>{t("bom.code")}</TableHead><TableHead>{t("bom.version")}</TableHead><TableHead>{t("bom.status")}</TableHead><TableHead></TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {(list.data ?? []).map((b: any) => (
                <TableRow key={b.id} className={selectedBomId === b.id ? "bg-muted/50" : ""}>
                  <TableCell>{b.id}</TableCell>
                  <TableCell>{b.code}</TableCell>
                  <TableCell>v{b.version}</TableCell>
                  <TableCell><Badge variant={b.status === "active" ? "default" : "outline"}>{b.status}</Badge></TableCell>
                  <TableCell className="text-right space-x-2">
                    <Button size="sm" variant="outline" onClick={() => setSelectedBomId(b.id)}>{t("bom.lineItems")}</Button>
                    {canDelete && (
                      <Button size="sm" variant="ghost" onClick={() => archiveDef.mutate({ id: b.id })}><Trash2 className="h-4 w-4" /></Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {list.data && list.data.length === 0 && (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">{t("bom.noBom")}</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {selectedBomId != null && (
        <Card>
          <CardHeader><CardTitle>{t("bom.lineItemsForBom", { id: selectedBomId })}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {canCreate && (
              <div className="flex items-end gap-2 flex-wrap">
                <div>
                  <Label>{t("bom.materialMaster")}</Label>
                  <div>
                    <EntityCombobox
                      options={materialOptions}
                      value={li.materialId}
                      onChange={(id, opt) => setLi({ ...li, materialId: id, componentCode: opt?.code ?? li.componentCode })}
                      placeholder={t("bom.selectMaterial")}
                      className="w-56"
                    />
                  </div>
                </div>
                <div><Label>{t("bom.componentCode")}</Label><Input value={li.componentCode} onChange={(e) => setLi({ ...li, componentCode: e.target.value })} className="w-40" placeholder={t("bom.orTypeManually")} /></div>
                <div><Label>{t("bom.qtyPerUnit")}</Label><Input value={li.qtyPer} onChange={(e) => setLi({ ...li, qtyPer: e.target.value })} className="w-24" /></div>
                <div><Label>{t("bom.refDesignator")}</Label><Input value={li.refDesignator} onChange={(e) => setLi({ ...li, refDesignator: e.target.value })} className="w-40" /></div>
                <Button
                  disabled={!li.componentCode || addLine.isPending}
                  onClick={() => addLine.mutate({ bomId: selectedBomId, componentCode: li.componentCode, materialId: li.materialId ?? undefined, qtyPer: Number(li.qtyPer) || 1, refDesignator: li.refDesignator || undefined })}
                ><Plus className="mr-1 h-4 w-4" /> {t("common.add")}</Button>
              </div>
            )}
            <Table>
              <TableHeader><TableRow><TableHead>{t("bom.componentCodeShort")}</TableHead><TableHead>{t("bom.name")}</TableHead><TableHead>{t("bom.qty")}</TableHead><TableHead>{t("bom.refDes")}</TableHead><TableHead></TableHead></TableRow></TableHeader>
              <TableBody>
                {(detail.data?.lineItems ?? []).map((it: any) => (
                  <TableRow key={it.id}>
                    <TableCell>{it.componentCode}</TableCell>
                    <TableCell>{it.componentName ?? "-"}</TableCell>
                    <TableCell>{it.qtyPer}</TableCell>
                    <TableCell>{it.refDesignator ?? "-"}</TableCell>
                    <TableCell className="text-right">
                      {canDelete && <Button size="sm" variant="ghost" onClick={() => delLine.mutate({ id: it.id })}><Trash2 className="h-4 w-4" /></Button>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Feeder panel (assign/load + reorder badge) ─────────────────────────────
function FeederPanel({ canCreate }: { canCreate: boolean }) {
  const { t } = useTranslation();
  const [machineId, setMachineId] = useState<number | null>(null);
  const mid = machineId ?? 0;
  const feeders = trpc.bom.listFeeders.useQuery({ machineId: mid }, { enabled: mid > 0 });
  const materialOptions = useMaterialOptions();
  const [f, setF] = useState<{ componentCode: string; materialId: number | null; slotCode: string; qtyOnFeeder: string; reorderLevel: string }>(
    { componentCode: "", materialId: null, slotCode: "", qtyOnFeeder: "0", reorderLevel: "0" },
  );
  const assign = trpc.bom.assignFeederMaterial.useMutation({
    onSuccess: () => { toast.success(t("bom.toastFeederAssigned")); feeders.refetch(); },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader><CardTitle>{t("bom.feederByMachine")}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-end gap-2 flex-wrap">
          <div><Label>{t("bom.machineId")}</Label><MachineSelect value={machineId} onChange={(v) => setMachineId(v == null ? null : Number(v))} aria-label={t("bom.machineId")} clearable className="w-56" /></div>
          {canCreate && (
            <>
              <div>
                <Label>{t("bom.materialMaster")}</Label>
                <div>
                  <EntityCombobox
                    options={materialOptions}
                    value={f.materialId}
                    onChange={(id, opt) => setF({ ...f, materialId: id, componentCode: opt?.code ?? f.componentCode })}
                    placeholder={t("bom.selectMaterial")}
                    className="w-52"
                  />
                </div>
              </div>
              <div><Label>{t("bom.componentCodeShort")}</Label><Input value={f.componentCode} onChange={(e) => setF({ ...f, componentCode: e.target.value })} className="w-32" placeholder={t("bom.orTypeManually")} /></div>
              <div><Label>{t("bom.slot")}</Label><Input value={f.slotCode} onChange={(e) => setF({ ...f, slotCode: e.target.value })} className="w-24" /></div>
              <div><Label>{t("bom.qtyLoaded")}</Label><Input value={f.qtyOnFeeder} onChange={(e) => setF({ ...f, qtyOnFeeder: e.target.value })} className="w-24" /></div>
              <div><Label>{t("bom.reorderLevel")}</Label><Input value={f.reorderLevel} onChange={(e) => setF({ ...f, reorderLevel: e.target.value })} className="w-24" /></div>
              <Button
                disabled={!(mid > 0) || !f.componentCode || assign.isPending}
                onClick={() => assign.mutate({ machineId: mid, componentCode: f.componentCode, materialId: f.materialId ?? undefined, slotCode: f.slotCode || undefined, qtyOnFeeder: Number(f.qtyOnFeeder) || 0, reorderLevel: Number(f.reorderLevel) || 0 })}
              ><Plus className="mr-1 h-4 w-4" /> {t("bom.assignLoad")}</Button>
            </>
          )}
        </div>
        <Table>
          <TableHeader><TableRow><TableHead>{t("bom.slot")}</TableHead><TableHead>{t("bom.componentCodeShort")}</TableHead><TableHead>{t("bom.remaining")}</TableHead><TableHead>{t("bom.reorderLevel")}</TableHead><TableHead>{t("bom.status")}</TableHead></TableRow></TableHeader>
          <TableBody>
            {(feeders.data ?? []).map((row: any) => {
              const below = Number(row.qtyOnFeeder) <= Number(row.reorderLevel);
              return (
                <TableRow key={row.id}>
                  <TableCell>{row.slotCode ?? "-"}</TableCell>
                  <TableCell>{row.componentCode}</TableCell>
                  <TableCell>{row.qtyOnFeeder}</TableCell>
                  <TableCell>{row.reorderLevel}</TableCell>
                  <TableCell>
                    {below
                      ? <Badge variant="destructive">{t("bom.needReorder")}</Badge>
                      : <Badge variant="outline">{row.status}</Badge>}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ─── Trace (forward serial → components, reverse lot/component → serials) ─────
function TracePanel() {
  const { t } = useTranslation();
  const [serial, setSerial] = useState("");
  const [lotId, setLotId] = useState("");
  const forward = trpc.bom.traceForward.useQuery({ serialNumber: serial }, { enabled: serial.length > 0 });
  const reverse = trpc.bom.traceReverse.useQuery(
    { supplierLotId: Number(lotId) },
    { enabled: Number(lotId) > 0 },
  );

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader><CardTitle><GitMerge className="inline h-4 w-4 mr-1" /> {t("bom.forwardTitle")}</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <Input value={serial} onChange={(e) => setSerial(e.target.value)} placeholder={t("bom.serialBoard")} />
          <Table>
            <TableHeader><TableRow><TableHead>{t("bom.componentCodeShort")}</TableHead><TableHead>{t("bom.componentSerial")}</TableHead><TableHead>{t("bom.supplierLot")}</TableHead><TableHead>{t("bom.hash")}</TableHead></TableRow></TableHeader>
            <TableBody>
              {(forward.data?.components ?? []).map((c: any) => (
                <TableRow key={c.id}>
                  <TableCell>{c.componentCode}</TableCell>
                  <TableCell>{c.componentSerial ?? "-"}</TableCell>
                  <TableCell>{c.supplierLotId ?? "-"}</TableCell>
                  <TableCell className="font-mono text-xs">{c.genealogyHash ? c.genealogyHash.slice(0, 12) : "∅"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>{t("bom.reverseTitle")}</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <Input value={lotId} onChange={(e) => setLotId(e.target.value)} placeholder={t("bom.supplierLotId")} />
          <div className="flex flex-wrap gap-1">
            {(reverse.data?.serials ?? []).map((s: string) => <Badge key={s} variant="secondary">{s}</Badge>)}
            {reverse.data && reverse.data.serials.length === 0 && <span className="text-muted-foreground text-sm">{t("bom.noSerialForLot")}</span>}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
