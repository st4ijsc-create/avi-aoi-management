/**
 * Maintenance Work Orders — manage + CLOSE the PdM loop.
 *
 * The platform could only CREATE work-orders via the RCA AI write-tool and list
 * them read-only. This page surfaces the full lifecycle: list (filter by status
 * / machine), create (machine + title + type + priority + assignee), open a
 * detail to assign / edit / set status, and — the key PdM-loop closer — CLOSE a
 * work-order (records resolution + downtime → enables MTTR). Delete too.
 *
 * RBAC: module `machine_monitoring`. View gates the page; create/edit (incl.
 * close) and delete actions are hidden unless the user holds the matching grant.
 * SAFETY: pure maintenance lifecycle — never writes a value to a machine.
 */
import { useState } from "react";
import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { usePermissions } from "@/_core/hooks/usePermissions";
import DashboardLayout from "@/components/DashboardLayout";
import { ViewOnlyBadge } from "@/components/PermissionGate";
import { navItems } from "@/lib/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { StatusBadge, PageHeader, PageContainer, type BadgeVariant } from "@/components/patterns";
import { UserSelect } from "@/components/patterns/EntityPicker";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Wrench, Plus, Pencil, Trash2, AlertTriangle, CheckCircle2, Package, ExternalLink } from "lucide-react";
import { toast } from "sonner";

const STATUSES = ["OPEN", "SCHEDULED", "IN_PROGRESS", "ON_HOLD", "COMPLETED", "CANCELLED"] as const;
const TYPES = ["PREVENTIVE", "PREDICTIVE", "CORRECTIVE", "BREAKDOWN", "INSPECTION"] as const;
const OPEN_STATUSES = new Set(["OPEN", "SCHEDULED", "IN_PROGRESS", "ON_HOLD"]);

type WorkOrder = {
  id: number;
  workOrderNumber: string;
  machineId: number;
  machineCode: string | null;
  type: string;
  status: string;
  priority: number;
  title: string;
  description: string | null;
  assignedTo: number | null;
  openedAt: string | Date | null;
  closedAt: string | Date | null;
  repairStartedAt: string | Date | null;
  downtimeMinutes: number | null;
  resolutionNotes: string | null;
};

// Status → solid shadcn <Badge> variant (unified onto the shared <StatusBadge>,
// W4). Preserves the exact prior look; unlisted statuses fall back to "default".
const WO_STATUS_MAP: Record<string, { variant: BadgeVariant }> = {
  COMPLETED: { variant: "secondary" },
  CANCELLED: { variant: "outline" },
  IN_PROGRESS: { variant: "default" },
  ON_HOLD: { variant: "destructive" },
};

function ageLabel(openedAt: string | Date | null, closedAt: string | Date | null): string {
  if (!openedAt) return "—";
  const start = new Date(openedAt).getTime();
  const end = closedAt ? new Date(closedAt).getTime() : Date.now();
  const mins = Math.max(0, Math.round((end - start) / 60000));
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 48) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

export default function WorkOrdersPage() {
  const { t } = useTranslation();
  const { hasPermission } = usePermissions();
  const canView = hasPermission("machine_monitoring", "canView");
  const canCreate = hasPermission("machine_monitoring", "canCreate");
  const canEdit = hasPermission("machine_monitoring", "canEdit");
  const canDelete = hasPermission("machine_monitoring", "canDelete");

  const [statusFilter, setStatusFilter] = useState<string>("");
  const [machineFilter, setMachineFilter] = useState<string>("");
  const [createOpen, setCreateOpen] = useState(false);
  const [detail, setDetail] = useState<WorkOrder | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<WorkOrder | null>(null);

  const utils = trpc.useUtils();
  const machinesQ = trpc.machine.list.useQuery(undefined, { enabled: canView });
  const summaryQ = trpc.maintenance.summary.useQuery(undefined, { enabled: canView });
  const listQ = trpc.maintenance.listWorkOrders.useQuery(
    {
      status: (statusFilter || undefined) as any,
      machineId: machineFilter ? Number(machineFilter) : undefined,
    },
    { enabled: canView },
  );

  const machines = (machinesQ.data ?? []) as Array<{ id: number; code: string; name?: string }>;
  const machineLabel = (id: number) => {
    const m = machines.find((x) => x.id === id);
    return m ? `${m.code}${m.name ? ` — ${m.name}` : ""}` : `#${id}`;
  };

  const invalidate = () => {
    void utils.maintenance.listWorkOrders.invalidate();
    void utils.maintenance.summary.invalidate();
  };

  const createM = trpc.maintenance.createWorkOrder.useMutation({
    onSuccess: () => { toast.success(t("workOrders.created")); setCreateOpen(false); invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const updateM = trpc.maintenance.updateWorkOrder.useMutation({
    onSuccess: () => { toast.success(t("workOrders.updated")); setDetail(null); invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const closeM = trpc.maintenance.closeWorkOrder.useMutation({
    onSuccess: () => { toast.success(t("workOrders.closed")); setDetail(null); invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const deleteM = trpc.maintenance.deleteWorkOrder.useMutation({
    onSuccess: () => { toast.success(t("workOrders.deleted")); setConfirmDelete(null); invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  const rows = (listQ.data ?? []) as WorkOrder[];
  const summary = summaryQ.data;

  if (!canView) {
    return (
      <DashboardLayout title={t("workOrders.title")} navItems={navItems} currentPath="/work-orders">
        <div className="p-6">
          <Card><CardContent className="py-10 text-center text-muted-foreground">
            <AlertTriangle className="mx-auto mb-2 h-6 w-6" />
            {t("workOrders.noPermission")}
          </CardContent></Card>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout title={t("workOrders.title")} navItems={navItems} currentPath="/work-orders">
      <PageContainer className="space-y-4">
        <PageHeader
          icon={<Wrench className="h-6 w-6" />}
          title={t("workOrders.title")}
          badge={<ViewOnlyBadge module="machine_monitoring" />}
          actions={
            <>
              {summary && (
                <span className="flex gap-1">
                  <Badge variant="outline">{t("workOrders.total")}: {summary.total}</Badge>
                  <Badge variant="default">{t("workOrders.openCount")}: {summary.open}</Badge>
                </span>
              )}
              {canCreate && (
                <Button onClick={() => setCreateOpen(true)} size="sm">
                  <Plus className="h-4 w-4 mr-1" /> {t("workOrders.create")}
                </Button>
              )}
            </>
          }
        />

        {/* Filters */}
        <div className="flex gap-3 flex-wrap items-end">
          <div className="grid gap-1">
            <Label>{t("workOrders.filterStatus")}</Label>
            <Select value={statusFilter || "ALL"} onValueChange={(v) => setStatusFilter(v === "ALL" ? "" : v)}>
              <SelectTrigger aria-label={t("workOrders.filterStatus")} className="h-9 w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">{t("workOrders.all")}</SelectItem>
                {STATUSES.map((s) => <SelectItem key={s} value={s}>{t(`workOrders.status.${s}`)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1">
            <Label>{t("workOrders.filterMachine")}</Label>
            <Select value={machineFilter || "ALL"} onValueChange={(v) => setMachineFilter(v === "ALL" ? "" : v)}>
              <SelectTrigger aria-label={t("workOrders.filterMachine")} className="h-9 w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">{t("workOrders.all")}</SelectItem>
                {machines.map((m) => <SelectItem key={m.id} value={String(m.id)}>{m.code}{m.name ? ` — ${m.name}` : ""}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("workOrders.col.number")}</TableHead>
                  <TableHead>{t("workOrders.col.machine")}</TableHead>
                  <TableHead>{t("workOrders.col.title")}</TableHead>
                  <TableHead>{t("workOrders.col.type")}</TableHead>
                  <TableHead>{t("workOrders.col.priority")}</TableHead>
                  <TableHead>{t("workOrders.col.status")}</TableHead>
                  <TableHead>{t("workOrders.col.age")}</TableHead>
                  <TableHead className="text-right">{t("workOrders.col.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {listQ.isLoading && (
                  <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">{t("workOrders.loading")}</TableCell></TableRow>
                )}
                {!listQ.isLoading && rows.length === 0 && (
                  <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">{t("workOrders.empty")}</TableCell></TableRow>
                )}
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">{r.workOrderNumber}</TableCell>
                    <TableCell>
                      <Link
                        href={`/machine/${r.machineId}`}
                        className="inline-flex items-center gap-1 text-primary hover:underline"
                        title={t("workOrders.openMachine", "Mở thiết bị")}
                      >
                        {r.machineCode ?? machineLabel(r.machineId)}
                        <ExternalLink aria-hidden="true" className="h-3 w-3 opacity-60" />
                      </Link>
                    </TableCell>
                    <TableCell className="max-w-[20rem] truncate">{r.title}</TableCell>
                    <TableCell><Badge variant="outline">{t(`workOrders.type.${r.type}`)}</Badge></TableCell>
                    <TableCell><Badge variant={r.priority <= 2 ? "destructive" : "outline"}>P{r.priority}</Badge></TableCell>
                    <TableCell><StatusBadge status={r.status} variant={WO_STATUS_MAP[r.status]?.variant ?? "default"} label={t(`workOrders.status.${r.status}`)} /></TableCell>
                    <TableCell className="text-xs">{ageLabel(r.openedAt, r.closedAt)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex gap-1 justify-end">
                        {canEdit && (
                          <Button size="sm" variant="ghost" aria-label={t("common.edit", "Edit")} onClick={() => setDetail(r)}>
                            <Pencil aria-hidden="true" className="h-4 w-4" />
                          </Button>
                        )}
                        {canDelete && (
                          <Button size="sm" variant="ghost" aria-label={t("common.delete", "Delete")} onClick={() => setConfirmDelete(r)}>
                            <Trash2 aria-hidden="true" className="h-4 w-4 text-destructive" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </PageContainer>

      {/* Create dialog */}
      {createOpen && (
        <CreateDialog
          machines={machines}
          onClose={() => setCreateOpen(false)}
          onSubmit={(v) => createM.mutate(v as any)}
          pending={createM.isPending}
        />
      )}

      {/* Detail / edit / close dialog */}
      {detail && (
        <DetailDialog
          wo={detail}
          machineLabel={machineLabel}
          canEdit={canEdit}
          onClose={() => setDetail(null)}
          onUpdate={(patch) => updateM.mutate({ id: detail.id, ...patch } as any)}
          onCloseWo={(notes, downtime) => closeM.mutate({ id: detail.id, resolutionNotes: notes, downtimeMinutes: downtime })}
          updating={updateM.isPending}
          closing={closeM.isPending}
        />
      )}

      {/* Delete confirm */}
      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("workOrders.confirmDeleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("workOrders.confirmDeleteBody", { number: confirmDelete?.workOrderNumber })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("workOrders.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => confirmDelete && deleteM.mutate({ id: confirmDelete.id })}>
              {t("workOrders.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>
  );
}

function CreateDialog({
  machines, onClose, onSubmit, pending,
}: {
  machines: Array<{ id: number; code: string; name?: string }>;
  onClose: () => void;
  onSubmit: (v: Record<string, any>) => void;
  pending: boolean;
}) {
  const { t } = useTranslation();
  const [machineId, setMachineId] = useState<string>("");
  const [title, setTitle] = useState("");
  const [type, setType] = useState<string>("CORRECTIVE");
  const [priority, setPriority] = useState<number>(3);
  const [assignedTo, setAssignedTo] = useState<number | null>(null);
  const [description, setDescription] = useState("");

  const submit = () => {
    if (!machineId) { toast.error(t("workOrders.machineRequired")); return; }
    if (title.trim().length < 3) { toast.error(t("workOrders.titleRequired")); return; }
    onSubmit({
      machineId: Number(machineId),
      title: title.trim(),
      type,
      priority,
      assignedTo: assignedTo ?? undefined,
      description: description.trim() || undefined,
    });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{t("workOrders.create")}</DialogTitle></DialogHeader>
        <div className="grid gap-3 py-2">
          <div className="grid gap-1">
            <Label>{t("workOrders.col.machine")} *</Label>
            <Select value={machineId} onValueChange={setMachineId}>
              <SelectTrigger aria-label={t("workOrders.col.machine")} className="h-9 w-full">
                <SelectValue placeholder={t("workOrders.selectMachine", "Select a machine…")} />
              </SelectTrigger>
              <SelectContent>
                {machines.map((m) => <SelectItem key={m.id} value={String(m.id)}>{m.code}{m.name ? ` — ${m.name}` : ""}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1">
            <Label>{t("workOrders.col.title")} *</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1">
              <Label>{t("workOrders.col.type")}</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger aria-label={t("workOrders.col.type")} className="h-9 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TYPES.map((s) => <SelectItem key={s} value={s}>{t(`workOrders.type.${s}`)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1">
              <Label>{t("workOrders.col.priority")} (1–5)</Label>
              <Input type="number" min={1} max={5} value={priority}
                onChange={(e) => setPriority(Math.min(5, Math.max(1, Number(e.target.value) || 3)))} />
            </div>
          </div>
          <div className="grid gap-1">
            <Label>{t("workOrders.assignee")}</Label>
            <UserSelect
              value={assignedTo}
              onChange={(v) => setAssignedTo(v == null ? null : Number(v))}
              placeholder={t("workOrders.assigneePlaceholder", "Chọn người phụ trách…")}
              aria-label={t("workOrders.assignee")}
            />
          </div>
          <div className="grid gap-1">
            <Label>{t("workOrders.col.description")}</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("workOrders.cancel")}</Button>
          <Button onClick={submit} disabled={pending}>{t("workOrders.save")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DetailDialog({
  wo, machineLabel, canEdit, onClose, onUpdate, onCloseWo, updating, closing,
}: {
  wo: WorkOrder;
  machineLabel: (id: number) => string;
  canEdit: boolean;
  onClose: () => void;
  onUpdate: (patch: Record<string, any>) => void;
  onCloseWo: (notes: string | undefined, downtime: number | undefined) => void;
  updating: boolean;
  closing: boolean;
}) {
  const { t } = useTranslation();
  const [status, setStatus] = useState(wo.status);
  const [priority, setPriority] = useState(wo.priority);
  const [assignedTo, setAssignedTo] = useState<number | null>(wo.assignedTo);
  const [resolutionNotes, setResolutionNotes] = useState(wo.resolutionNotes ?? "");
  const [downtime, setDowntime] = useState<string>(wo.downtimeMinutes != null ? String(wo.downtimeMinutes) : "");

  const isClosed = wo.status === "COMPLETED" || wo.status === "CANCELLED";

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm">{wo.workOrderNumber}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <div className="text-sm">
            <div className="font-medium">{wo.title}</div>
            <div className="text-muted-foreground">{machineLabel(wo.machineId)}</div>
            {wo.description && <p className="mt-1 text-muted-foreground whitespace-pre-wrap">{wo.description}</p>}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1">
              <Label>{t("workOrders.col.status")}</Label>
              <Select value={status} onValueChange={setStatus} disabled={!canEdit || isClosed}>
                <SelectTrigger aria-label={t("workOrders.col.status")} className="h-9 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUSES.map((s) => <SelectItem key={s} value={s}>{t(`workOrders.status.${s}`)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1">
              <Label>{t("workOrders.col.priority")}</Label>
              <Input type="number" min={1} max={5} disabled={!canEdit || isClosed} value={priority}
                onChange={(e) => setPriority(Math.min(5, Math.max(1, Number(e.target.value) || 3)))} />
            </div>
          </div>
          <div className="grid gap-1">
            <Label>{t("workOrders.assignee")}</Label>
            <UserSelect
              value={assignedTo}
              onChange={(v) => setAssignedTo(v == null ? null : Number(v))}
              disabled={!canEdit || isClosed}
              placeholder={t("workOrders.assigneePlaceholder", "Chọn người phụ trách…")}
              aria-label={t("workOrders.assignee")}
            />
          </div>

          {/* Resolution + downtime — the close-loop inputs (feed MTTR). */}
          <div className="rounded-md border p-3 space-y-2 bg-muted/30">
            <div className="text-sm font-medium flex items-center gap-1">
              <CheckCircle2 className="h-4 w-4" /> {t("workOrders.closeSection")}
            </div>
            <div className="grid gap-1">
              <Label>{t("workOrders.resolutionNotes")}</Label>
              <Textarea value={resolutionNotes} disabled={isClosed}
                onChange={(e) => setResolutionNotes(e.target.value)} />
            </div>
            <div className="grid gap-1">
              <Label>{t("workOrders.downtimeMinutes")}</Label>
              <Input type="number" min={0} placeholder={t("workOrders.downtimeAuto")}
                disabled={isClosed} value={downtime} onChange={(e) => setDowntime(e.target.value)} />
            </div>
            {wo.downtimeMinutes != null && (
              <div className="text-xs text-muted-foreground">{t("workOrders.recordedDowntime", { mins: wo.downtimeMinutes })}</div>
            )}
          </div>

          {/* Spare-parts consumed — recordPartsUsed (atomic ledger + stock decrement). */}
          <WorkOrderPartsPanel workOrderId={wo.id} canEdit={canEdit} isClosed={isClosed} />
        </div>
        <DialogFooter className="flex-wrap gap-2">
          <Button variant="outline" onClick={onClose}>{t("workOrders.cancel")}</Button>
          {canEdit && !isClosed && (
            <Button variant="secondary" disabled={updating}
              onClick={() => onUpdate({
                status,
                priority,
                assignedTo,
                resolutionNotes: resolutionNotes || null,
              })}>
              {t("workOrders.saveChanges")}
            </Button>
          )}
          {canEdit && !isClosed && (
            <Button disabled={closing}
              onClick={() => onCloseWo(resolutionNotes || undefined, downtime ? Number(downtime) : undefined)}>
              <CheckCircle2 className="h-4 w-4 mr-1" /> {t("workOrders.closeWorkOrder")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Phụ tùng đã tiêu thụ trên 1 lệnh công việc — nối recordPartsUsed (trừ kho +
 * ghi ledger nguyên tử) và liệt kê listPartsForWorkOrder. Chi phí tính từ
 * snapshot unitCost trong ledger (KHÔNG bịa nếu null). Không có endpoint danh
 * mục vật tư đầy đủ nên nhập theo partCode (khớp spare_parts_inventory.partCode).
 */
function WorkOrderPartsPanel({
  workOrderId, canEdit, isClosed,
}: {
  workOrderId: number;
  canEdit: boolean;
  isClosed: boolean;
}) {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const partsQ = trpc.maintenance.listPartsForWorkOrder.useQuery({ workOrderId });
  const [partCode, setPartCode] = useState("");
  const [qty, setQty] = useState<string>("1");
  const [notes, setNotes] = useState("");

  const recordM = trpc.maintenance.recordPartsUsed.useMutation({
    onSuccess: (res) => {
      toast.success(t("workOrders.parts.recorded", "Đã ghi nhận vật tư"));
      if (res?.belowReorder) {
        toast.warning(t("workOrders.parts.belowReorder", "Tồn kho phụ tùng dưới mức đặt lại"));
      }
      setPartCode(""); setQty("1"); setNotes("");
      void utils.maintenance.listPartsForWorkOrder.invalidate({ workOrderId });
    },
    onError: (e) => toast.error(e.message),
  });

  const rows = (partsQ.data ?? []) as Array<{
    id: number; partCode: string; quantityUsed: number;
    unitCost: string | null; consumedAt: string | Date | null; notes: string | null;
  }>;
  const totalCost = rows.reduce(
    (sum, r) => sum + (r.unitCost != null ? Number(r.unitCost) * r.quantityUsed : 0),
    0,
  );
  const anyCost = rows.some((r) => r.unitCost != null);

  const submit = () => {
    const q = Number(qty);
    if (!partCode.trim()) { toast.error(t("workOrders.parts.codeRequired", "Nhập mã phụ tùng")); return; }
    if (!Number.isInteger(q) || q < 1) { toast.error(t("workOrders.parts.qtyRequired", "Số lượng ≥ 1")); return; }
    recordM.mutate({
      workOrderId,
      partCode: partCode.trim(),
      quantityUsed: q,
      notes: notes.trim() || undefined,
    });
  };

  return (
    <div className="rounded-md border p-3 space-y-2">
      <div className="text-sm font-medium flex items-center gap-1">
        <Package className="h-4 w-4" /> {t("workOrders.parts.title", "Vật tư đã dùng")}
      </div>

      {partsQ.isLoading ? (
        <div className="text-xs text-muted-foreground py-2">{t("workOrders.loading")}</div>
      ) : rows.length === 0 ? (
        <div className="text-xs text-muted-foreground py-2">{t("workOrders.parts.empty", "Chưa ghi nhận vật tư nào")}</div>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("workOrders.parts.code", "Mã phụ tùng")}</TableHead>
                <TableHead className="text-right">{t("workOrders.parts.qty", "SL")}</TableHead>
                <TableHead className="text-right">{t("workOrders.parts.cost", "Chi phí")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs">
                    {r.partCode}
                    {r.notes ? <span className="ml-1 text-muted-foreground">— {r.notes}</span> : null}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{r.quantityUsed}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.unitCost != null ? (Number(r.unitCost) * r.quantityUsed).toLocaleString() : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {anyCost && (
            <div className="text-xs text-muted-foreground text-right pt-1">
              {t("workOrders.parts.total", "Tổng chi phí")}: <span className="tabular-nums font-medium">{totalCost.toLocaleString()}</span>
            </div>
          )}
        </div>
      )}

      {canEdit && !isClosed && (
        <div className="flex flex-wrap items-end gap-2 pt-1">
          <div className="grid gap-1">
            <Label className="text-xs">{t("workOrders.parts.code", "Mã phụ tùng")}</Label>
            <Input className="h-9 w-40 font-mono" value={partCode}
              placeholder={t("workOrders.parts.codePlaceholder", "VD: BRG-6204")}
              onChange={(e) => setPartCode(e.target.value)} />
          </div>
          <div className="grid gap-1">
            <Label className="text-xs">{t("workOrders.parts.qty", "SL")}</Label>
            <Input className="h-9 w-20" type="number" min={1} value={qty}
              onChange={(e) => setQty(e.target.value)} />
          </div>
          <div className="grid gap-1 flex-1 min-w-[8rem]">
            <Label className="text-xs">{t("workOrders.parts.notes", "Ghi chú")}</Label>
            <Input className="h-9" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <Button size="sm" onClick={submit} disabled={recordM.isPending}>
            <Plus className="h-4 w-4 mr-1" /> {t("workOrders.parts.record", "Ghi nhận")}
          </Button>
        </div>
      )}
    </div>
  );
}
