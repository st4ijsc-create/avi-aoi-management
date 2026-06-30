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
import { trpc } from "@/lib/trpc";
import { usePermissions } from "@/_core/hooks/usePermissions";
import DashboardLayout from "@/components/DashboardLayout";
import { navItems } from "@/lib/navigation";
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
  const { hasPermission } = usePermissions();
  const canView = hasPermission("mes_bom", "canView");
  const canCreate = hasPermission("mes_bom", "canCreate");
  const canDelete = hasPermission("mes_bom", "canDelete");

  if (!canView) {
    return (
      <DashboardLayout title="BOM & Feeder (MES)" navItems={navItems} currentPath="/bom-management">
      <div className="p-6">
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            <AlertTriangle className="mx-auto mb-2 h-6 w-6" />
            Bạn không có quyền xem module BOM &amp; Feeder (mes_bom).
          </CardContent>
        </Card>
      </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout title="BOM & Feeder (MES)" navItems={navItems} currentPath="/bom-management">
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-2">
        <Boxes className="h-6 w-6" />
        <h1 className="text-2xl font-semibold">BOM &amp; Feeder (MES)</h1>
        <Badge variant="outline">G2.4</Badge>
        <ViewOnlyBadge module="mes_bom" />
      </div>
      <Tabs defaultValue="bom">
        <TabsList>
          <TabsTrigger value="bom">BOM</TabsTrigger>
          <TabsTrigger value="feeder">Feeder</TabsTrigger>
          <TabsTrigger value="trace">Truy vết</TabsTrigger>
        </TabsList>
        <TabsContent value="bom"><BomPanel canCreate={canCreate} canDelete={canDelete} /></TabsContent>
        <TabsContent value="feeder"><FeederPanel canCreate={canCreate} /></TabsContent>
        <TabsContent value="trace"><TracePanel /></TabsContent>
      </Tabs>
    </div>
    </DashboardLayout>
  );
}

// ─── BOM definitions + line items ───────────────────────────────────────────
function BomPanel({ canCreate, canDelete }: { canCreate: boolean; canDelete: boolean }) {
  const [productModelId, setProductModelId] = useState("");
  const [selectedBomId, setSelectedBomId] = useState<number | null>(null);
  const pid = Number(productModelId);
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
    onSuccess: () => { toast.success("Đã tạo BOM"); setNewCode(""); list.refetch(); },
    onError: (e) => toast.error(e.message),
  });
  const archiveDef = trpc.bom.archiveDefinition.useMutation({
    onSuccess: () => { toast.success("Đã lưu trữ BOM"); setSelectedBomId(null); list.refetch(); },
    onError: (e) => toast.error(e.message),
  });

  const materialOptions = useMaterialOptions();
  const [li, setLi] = useState<{ componentCode: string; materialId: number | null; qtyPer: string; refDesignator: string }>(
    { componentCode: "", materialId: null, qtyPer: "1", refDesignator: "" },
  );
  const addLine = trpc.bom.addLineItem.useMutation({
    onSuccess: () => { toast.success("Đã thêm dòng"); setLi({ componentCode: "", materialId: null, qtyPer: "1", refDesignator: "" }); utils.bom.getDefinition.invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const delLine = trpc.bom.deleteLineItem.useMutation({
    onSuccess: () => { toast.success("Đã xóa dòng"); utils.bom.getDefinition.invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle>BOM theo Product Model</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-end gap-2">
            <div>
              <Label>Product Model ID</Label>
              <Input value={productModelId} onChange={(e) => setProductModelId(e.target.value)} className="w-40" placeholder="vd: 1" />
            </div>
            {canCreate && (
              <>
                <div>
                  <Label>Mã BOM mới</Label>
                  <Input value={newCode} onChange={(e) => setNewCode(e.target.value)} className="w-48" placeholder="BOM-001" />
                </div>
                <Button
                  disabled={!newCode || !(pid > 0) || createDef.isPending}
                  onClick={() => createDef.mutate({ productModelId: pid, code: newCode })}
                >
                  <Plus className="mr-1 h-4 w-4" /> Tạo BOM
                </Button>
              </>
            )}
          </div>
          <Table>
            <TableHeader>
              <TableRow><TableHead>ID</TableHead><TableHead>Mã</TableHead><TableHead>Phiên bản</TableHead><TableHead>Trạng thái</TableHead><TableHead></TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {(list.data ?? []).map((b: any) => (
                <TableRow key={b.id} className={selectedBomId === b.id ? "bg-muted/50" : ""}>
                  <TableCell>{b.id}</TableCell>
                  <TableCell>{b.code}</TableCell>
                  <TableCell>v{b.version}</TableCell>
                  <TableCell><Badge variant={b.status === "active" ? "default" : "outline"}>{b.status}</Badge></TableCell>
                  <TableCell className="text-right space-x-2">
                    <Button size="sm" variant="outline" onClick={() => setSelectedBomId(b.id)}>Dòng linh kiện</Button>
                    {canDelete && (
                      <Button size="sm" variant="ghost" onClick={() => archiveDef.mutate({ id: b.id })}><Trash2 className="h-4 w-4" /></Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {list.data && list.data.length === 0 && (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">Chưa có BOM</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {selectedBomId != null && (
        <Card>
          <CardHeader><CardTitle>Dòng linh kiện — BOM #{selectedBomId}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {canCreate && (
              <div className="flex items-end gap-2 flex-wrap">
                <div>
                  <Label>Vật liệu (master)</Label>
                  <div>
                    <EntityCombobox
                      options={materialOptions}
                      value={li.materialId}
                      onChange={(id, opt) => setLi({ ...li, materialId: id, componentCode: opt?.code ?? li.componentCode })}
                      placeholder="Chọn vật liệu..."
                      className="w-56"
                    />
                  </div>
                </div>
                <div><Label>Mã linh kiện</Label><Input value={li.componentCode} onChange={(e) => setLi({ ...li, componentCode: e.target.value })} className="w-40" placeholder="hoặc nhập tay" /></div>
                <div><Label>SL/đơn vị</Label><Input value={li.qtyPer} onChange={(e) => setLi({ ...li, qtyPer: e.target.value })} className="w-24" /></div>
                <div><Label>Ref Designator</Label><Input value={li.refDesignator} onChange={(e) => setLi({ ...li, refDesignator: e.target.value })} className="w-40" /></div>
                <Button
                  disabled={!li.componentCode || addLine.isPending}
                  onClick={() => addLine.mutate({ bomId: selectedBomId, componentCode: li.componentCode, materialId: li.materialId ?? undefined, qtyPer: Number(li.qtyPer) || 1, refDesignator: li.refDesignator || undefined })}
                ><Plus className="mr-1 h-4 w-4" /> Thêm</Button>
              </div>
            )}
            <Table>
              <TableHeader><TableRow><TableHead>Mã LK</TableHead><TableHead>Tên</TableHead><TableHead>SL</TableHead><TableHead>RefDes</TableHead><TableHead></TableHead></TableRow></TableHeader>
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
  const [machineId, setMachineId] = useState("");
  const mid = Number(machineId);
  const feeders = trpc.bom.listFeeders.useQuery({ machineId: mid }, { enabled: mid > 0 });
  const materialOptions = useMaterialOptions();
  const [f, setF] = useState<{ componentCode: string; materialId: number | null; slotCode: string; qtyOnFeeder: string; reorderLevel: string }>(
    { componentCode: "", materialId: null, slotCode: "", qtyOnFeeder: "0", reorderLevel: "0" },
  );
  const assign = trpc.bom.assignFeederMaterial.useMutation({
    onSuccess: () => { toast.success("Đã gán feeder"); feeders.refetch(); },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader><CardTitle>Feeder theo máy</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-end gap-2 flex-wrap">
          <div><Label>Machine ID</Label><Input value={machineId} onChange={(e) => setMachineId(e.target.value)} className="w-32" /></div>
          {canCreate && (
            <>
              <div>
                <Label>Vật liệu (master)</Label>
                <div>
                  <EntityCombobox
                    options={materialOptions}
                    value={f.materialId}
                    onChange={(id, opt) => setF({ ...f, materialId: id, componentCode: opt?.code ?? f.componentCode })}
                    placeholder="Chọn vật liệu..."
                    className="w-52"
                  />
                </div>
              </div>
              <div><Label>Mã LK</Label><Input value={f.componentCode} onChange={(e) => setF({ ...f, componentCode: e.target.value })} className="w-32" placeholder="hoặc nhập tay" /></div>
              <div><Label>Slot</Label><Input value={f.slotCode} onChange={(e) => setF({ ...f, slotCode: e.target.value })} className="w-24" /></div>
              <div><Label>SL nạp</Label><Input value={f.qtyOnFeeder} onChange={(e) => setF({ ...f, qtyOnFeeder: e.target.value })} className="w-24" /></div>
              <div><Label>Mức đặt lại</Label><Input value={f.reorderLevel} onChange={(e) => setF({ ...f, reorderLevel: e.target.value })} className="w-24" /></div>
              <Button
                disabled={!(mid > 0) || !f.componentCode || assign.isPending}
                onClick={() => assign.mutate({ machineId: mid, componentCode: f.componentCode, materialId: f.materialId ?? undefined, slotCode: f.slotCode || undefined, qtyOnFeeder: Number(f.qtyOnFeeder) || 0, reorderLevel: Number(f.reorderLevel) || 0 })}
              ><Plus className="mr-1 h-4 w-4" /> Gán/Nạp</Button>
            </>
          )}
        </div>
        <Table>
          <TableHeader><TableRow><TableHead>Slot</TableHead><TableHead>Mã LK</TableHead><TableHead>Còn lại</TableHead><TableHead>Mức đặt lại</TableHead><TableHead>Trạng thái</TableHead></TableRow></TableHeader>
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
                      ? <Badge variant="destructive">Cần đặt lại</Badge>
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
        <CardHeader><CardTitle><GitMerge className="inline h-4 w-4 mr-1" /> Forward: Serial → Linh kiện</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <Input value={serial} onChange={(e) => setSerial(e.target.value)} placeholder="Serial board" />
          <Table>
            <TableHeader><TableRow><TableHead>Mã LK</TableHead><TableHead>Serial LK</TableHead><TableHead>Lot NCC</TableHead><TableHead>Hash</TableHead></TableRow></TableHeader>
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
        <CardHeader><CardTitle>Reverse: Lot NCC → Serials</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <Input value={lotId} onChange={(e) => setLotId(e.target.value)} placeholder="Supplier Lot ID" />
          <div className="flex flex-wrap gap-1">
            {(reverse.data?.serials ?? []).map((s: string) => <Badge key={s} variant="secondary">{s}</Badge>)}
            {reverse.data && reverse.data.serials.length === 0 && <span className="text-muted-foreground text-sm">Không có serial nào dùng lot này</span>}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
