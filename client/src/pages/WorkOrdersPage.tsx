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
import { useMemo, useState } from "react";
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
import { StatusBadge, type BadgeVariant } from "@/components/patterns";
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
import { Wrench, Plus, Pencil, Trash2, AlertTriangle, CheckCircle2 } from "lucide-react";
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
      <div className="p-6 space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          <Wrench className="h-6 w-6" />
          <h1 className="text-2xl font-semibold">{t("workOrders.title")}</h1>
          <ViewOnlyBadge module="machine_monitoring" />
          {summary && (
            <span className="flex gap-1">
              <Badge variant="outline">{t("workOrders.total")}: {summary.total}</Badge>
              <Badge variant="default">{t("workOrders.openCount")}: {summary.open}</Badge>
            </span>
          )}
          <div className="ml-auto">
            {canCreate && (
              <Button onClick={() => setCreateOpen(true)} size="sm">
                <Plus className="h-4 w-4 mr-1" /> {t("workOrders.create")}
              </Button>
            )}
          </div>
        </div>

        {/* Filters */}
        <div className="flex gap-3 flex-wrap items-end">
          <div className="grid gap-1">
            <Label>{t("workOrders.filterStatus")}</Label>
            <select aria-label={t("workOrders.filterStatus")} className="flex h-9 w-44 rounded-md border border-input bg-transparent px-3 py-1 text-sm"
              value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">{t("workOrders.all")}</option>
              {STATUSES.map((s) => <option key={s} value={s}>{t(`workOrders.status.${s}`)}</option>)}
            </select>
          </div>
          <div className="grid gap-1">
            <Label>{t("workOrders.filterMachine")}</Label>
            <select aria-label={t("workOrders.filterMachine")} className="flex h-9 w-56 rounded-md border border-input bg-transparent px-3 py-1 text-sm"
              value={machineFilter} onChange={(e) => setMachineFilter(e.target.value)}>
              <option value="">{t("workOrders.all")}</option>
              {machines.map((m) => <option key={m.id} value={m.id}>{m.code}{m.name ? ` — ${m.name}` : ""}</option>)}
            </select>
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
                    <TableCell>{r.machineCode ?? machineLabel(r.machineId)}</TableCell>
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
      </div>

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
  const [assignedTo, setAssignedTo] = useState<string>("");
  const [description, setDescription] = useState("");

  const submit = () => {
    if (!machineId) { toast.error(t("workOrders.machineRequired")); return; }
    if (title.trim().length < 3) { toast.error(t("workOrders.titleRequired")); return; }
    onSubmit({
      machineId: Number(machineId),
      title: title.trim(),
      type,
      priority,
      assignedTo: assignedTo ? Number(assignedTo) : undefined,
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
            <select aria-label={t("workOrders.col.machine")} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
              value={machineId} onChange={(e) => setMachineId(e.target.value)}>
              <option value="">--</option>
              {machines.map((m) => <option key={m.id} value={m.id}>{m.code}{m.name ? ` — ${m.name}` : ""}</option>)}
            </select>
          </div>
          <div className="grid gap-1">
            <Label>{t("workOrders.col.title")} *</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1">
              <Label>{t("workOrders.col.type")}</Label>
              <select aria-label={t("workOrders.col.type")} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                value={type} onChange={(e) => setType(e.target.value)}>
                {TYPES.map((s) => <option key={s} value={s}>{t(`workOrders.type.${s}`)}</option>)}
              </select>
            </div>
            <div className="grid gap-1">
              <Label>{t("workOrders.col.priority")} (1–5)</Label>
              <Input type="number" min={1} max={5} value={priority}
                onChange={(e) => setPriority(Math.min(5, Math.max(1, Number(e.target.value) || 3)))} />
            </div>
          </div>
          <div className="grid gap-1">
            <Label>{t("workOrders.assignee")}</Label>
            <Input type="number" placeholder={t("workOrders.assigneePlaceholder")} value={assignedTo}
              onChange={(e) => setAssignedTo(e.target.value)} />
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
  const [assignedTo, setAssignedTo] = useState<string>(wo.assignedTo != null ? String(wo.assignedTo) : "");
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
              <select aria-label={t("workOrders.col.status")} disabled={!canEdit || isClosed}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm disabled:opacity-60"
                value={status} onChange={(e) => setStatus(e.target.value)}>
                {STATUSES.map((s) => <option key={s} value={s}>{t(`workOrders.status.${s}`)}</option>)}
              </select>
            </div>
            <div className="grid gap-1">
              <Label>{t("workOrders.col.priority")}</Label>
              <Input type="number" min={1} max={5} disabled={!canEdit || isClosed} value={priority}
                onChange={(e) => setPriority(Math.min(5, Math.max(1, Number(e.target.value) || 3)))} />
            </div>
          </div>
          <div className="grid gap-1">
            <Label>{t("workOrders.assignee")}</Label>
            <Input type="number" disabled={!canEdit || isClosed} value={assignedTo}
              onChange={(e) => setAssignedTo(e.target.value)} />
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
        </div>
        <DialogFooter className="flex-wrap gap-2">
          <Button variant="outline" onClick={onClose}>{t("workOrders.cancel")}</Button>
          {canEdit && !isClosed && (
            <Button variant="secondary" disabled={updating}
              onClick={() => onUpdate({
                status,
                priority,
                assignedTo: assignedTo ? Number(assignedTo) : null,
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
