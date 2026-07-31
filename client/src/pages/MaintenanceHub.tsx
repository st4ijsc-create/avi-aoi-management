/**
 * CMMS mini-hub (/cmms) — doc 40 Wave 4c §11 (persona: kỹ thuật viên bảo trì).
 *
 * Gom 4 mặt bảo trì vào một nơi (content-first, 4 tab):
 *   1. Lệnh công việc  — danh sách gọn + mở trang đầy đủ /work-orders.
 *   2. Lịch PM          — CRUD maintenance_schedules (tính năng operator bảo trì
 *                          CHƯA từng có): tạo/sửa/xóa/bật-tắt lịch bảo trì phòng ngừa.
 *   3. Vật tư           — worklist phụ tùng ở/dưới mức đặt lại (restock).
 *   4. Độ tin cậy       — MTTR/MTBF toàn đội + xếp hạng máy "tệ nhất" (bad actors),
 *                          suy ra từ các lệnh công việc ĐÃ HOÀN THÀNH (dữ liệu thật).
 *
 * Dữ liệu THẬT, honest-null: chỉ số không đủ dữ liệu hiển thị "—", KHÔNG bịa.
 * RBAC: module machine_monitoring (như WorkOrdersPage). Ghi (PM/parts) ẩn khi
 * thiếu grant. SAFETY: thuần master-data + vòng đời bảo trì — KHÔNG ghi giá trị
 * xuống máy.
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { trpc } from "@/lib/trpc";
import { toastTrpcError } from "@/lib/trpcErrors";
import { usePermissions } from "@/_core/hooks/usePermissions";
import DashboardLayout from "@/components/DashboardLayout";
import { ViewOnlyBadge } from "@/components/PermissionGate";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  PageHeader, PageContainer, StatusBadge, StatChip, StatChipRow, EmptyState,
  type BadgeVariant,
} from "@/components/patterns";
import { MachineSelect } from "@/components/patterns/EntityPicker";
import {
  Wrench, CalendarClock, Package, Activity, Plus, Pencil, Trash2,
  ExternalLink, AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";

const MODULE = "machine_monitoring";

// scheduleType enum (drizzle/schema/enums.ts) — nhãn tiếng Việt qua fallback.
const SCHEDULE_TYPES = ["TIME_BASED", "USAGE_BASED", "CONDITION_BASED", "PREDICTIVE"] as const;
type ScheduleType = (typeof SCHEDULE_TYPES)[number];

const WO_STATUS_MAP: Record<string, BadgeVariant> = {
  COMPLETED: "secondary",
  CANCELLED: "outline",
  IN_PROGRESS: "default",
  ON_HOLD: "destructive",
};

const fmtDate = (v: string | Date | null | undefined) =>
  v ? new Date(v).toLocaleDateString() : "—";

function scheduleTypeLabel(t: TFunction, v: string): string {
  const map: Record<string, string> = {
    TIME_BASED: t("cmms.pm.type.TIME_BASED", "Theo thời gian"),
    USAGE_BASED: t("cmms.pm.type.USAGE_BASED", "Theo giờ chạy"),
    CONDITION_BASED: t("cmms.pm.type.CONDITION_BASED", "Theo điều kiện"),
    PREDICTIVE: t("cmms.pm.type.PREDICTIVE", "Dự đoán"),
  };
  return map[v] ?? v;
}

// ────────────────────────────────────────────────────────────────────────────
// Hub shell — 4 tab, đồng bộ ?tab= (mẫu ConnectivityHub).
// ────────────────────────────────────────────────────────────────────────────
export default function MaintenanceHub() {
  const { t } = useTranslation();
  const { hasPermission } = usePermissions();
  const canView = hasPermission(MODULE, "canView");
  const search = useSearch();
  const [, setLocation] = useLocation();

  const tabs = [
    { value: "work-orders", label: t("cmms.tabs.workOrders", "Lệnh công việc"), icon: <Wrench className="h-4 w-4" /> },
    { value: "pm", label: t("cmms.tabs.pm", "Lịch PM"), icon: <CalendarClock className="h-4 w-4" /> },
    { value: "parts", label: t("cmms.tabs.parts", "Vật tư"), icon: <Package className="h-4 w-4" /> },
    { value: "reliability", label: t("cmms.tabs.reliability", "Độ tin cậy"), icon: <Activity className="h-4 w-4" /> },
  ];
  const validValues = tabs.map((x) => x.value);

  const initialTab = (() => {
    const tab = new URLSearchParams(search).get("tab");
    return tab && validValues.includes(tab) ? tab : "work-orders";
  })();
  const [activeTab, setActiveTab] = useState(initialTab);

  useEffect(() => {
    const tab = new URLSearchParams(search).get("tab");
    if (tab && validValues.includes(tab) && tab !== activeTab) setActiveTab(tab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const handleTabChange = (v: string) => {
    setActiveTab(v);
    setLocation(`/cmms?tab=${v}`, { replace: true });
  };

  if (!canView) {
    return (
      <DashboardLayout title={t("cmms.title", "Bảo trì (CMMS)")}>
        <div className="p-6">
          <Card><CardContent className="py-10 text-center text-muted-foreground">
            <AlertTriangle className="mx-auto mb-2 h-6 w-6" />
            {t("cmms.noPermission", "Bạn không có quyền xem module bảo trì.")}
          </CardContent></Card>
        </div>
      </DashboardLayout>
    );
  }

  const current = validValues.includes(activeTab) ? activeTab : "work-orders";

  return (
    <DashboardLayout title={t("cmms.title", "Bảo trì (CMMS)")}>
      <PageContainer className="space-y-4">
        <PageHeader
          icon={<Wrench className="h-6 w-6" />}
          title={t("cmms.title", "Bảo trì (CMMS)")}
          description={t("cmms.subtitle", "Lệnh công việc · lịch phòng ngừa · vật tư · độ tin cậy")}
          badge={<ViewOnlyBadge module={MODULE} />}
        />

        <Tabs value={current} onValueChange={handleTabChange} className="space-y-4">
          <TabsList className="flex flex-wrap h-auto">
            {tabs.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value} className="gap-2">
                {tab.icon}{tab.label}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="work-orders"><WorkOrdersTab /></TabsContent>
          <TabsContent value="pm"><PmSchedulesTab /></TabsContent>
          <TabsContent value="parts"><SparePartsTab /></TabsContent>
          <TabsContent value="reliability"><ReliabilityTab /></TabsContent>
        </Tabs>
      </PageContainer>
    </DashboardLayout>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Tab 1 — Lệnh công việc (danh sách gọn + mở trang đầy đủ)
// ════════════════════════════════════════════════════════════════════════════
function WorkOrdersTab() {
  const { t } = useTranslation();
  const listQ = trpc.maintenance.listWorkOrders.useQuery({ limit: 20 });
  const summaryQ = trpc.maintenance.summary.useQuery();
  const rows = (listQ.data ?? []) as Array<{
    id: number; workOrderNumber: string; machineId: number; machineCode: string | null;
    title: string; status: string; priority: number;
  }>;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <StatChipRow>
          <StatChip label={t("cmms.wo.total", "Tổng")} value={summaryQ.data?.total ?? "—"} />
          <StatChip label={t("cmms.wo.open", "Đang mở")} value={summaryQ.data?.open ?? "—"} tone="warning" />
        </StatChipRow>
        <Button asChild size="sm" variant="outline">
          <Link href="/work-orders">
            <ExternalLink className="h-4 w-4 mr-1" /> {t("cmms.wo.openFull", "Mở trang đầy đủ")}
          </Link>
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("cmms.wo.number", "Số")}</TableHead>
                <TableHead>{t("cmms.wo.machine", "Thiết bị")}</TableHead>
                <TableHead>{t("cmms.wo.title", "Tiêu đề")}</TableHead>
                <TableHead>{t("cmms.wo.priority", "Ưu tiên")}</TableHead>
                <TableHead>{t("cmms.wo.status", "Trạng thái")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {listQ.isLoading && (
                <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">{t("common.loading", "Đang tải…")}</TableCell></TableRow>
              )}
              {!listQ.isLoading && rows.length === 0 && (
                <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">{t("cmms.wo.empty", "Chưa có lệnh công việc")}</TableCell></TableRow>
              )}
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs">{r.workOrderNumber}</TableCell>
                  <TableCell>
                    <Link href={`/machine/${r.machineId}`} className="inline-flex items-center gap-1 text-primary hover:underline">
                      {r.machineCode ?? `#${r.machineId}`}
                      <ExternalLink aria-hidden="true" className="h-3 w-3 opacity-60" />
                    </Link>
                  </TableCell>
                  <TableCell className="max-w-[22rem] truncate">{r.title}</TableCell>
                  <TableCell><Badge variant={r.priority <= 2 ? "destructive" : "outline"}>P{r.priority}</Badge></TableCell>
                  <TableCell><StatusBadge status={r.status} variant={WO_STATUS_MAP[r.status] ?? "default"} label={r.status} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Tab 2 — Lịch PM (CRUD maintenance_schedules qua trpc.maintenanceSchedule.*)
// ════════════════════════════════════════════════════════════════════════════
type PmSchedule = {
  id: number;
  machineId: number;
  machineCode?: string | null;
  name: string;
  taskType: string;
  intervalDays: number | null;
  nextDueAt: string | Date | null;
  isActive: boolean;
};

function PmSchedulesTab() {
  const { t } = useTranslation();
  const { hasPermission } = usePermissions();
  // QA4c-2: nút PM khớp ĐÚNG module server (maintenanceScheduleRouter WRITE =
  // machine_downtime) — trước dùng MODULE(machine_monitoring→machine_status) gây
  // hiện nút rồi bấm FORBIDDEN. machine_downtime: maintenance có canCreate/canEdit.
  const canCreate = hasPermission("machine_downtime", "canCreate");
  const canEdit = hasPermission("machine_downtime", "canEdit");
  const canDelete = hasPermission("machine_downtime", "canDelete");

  const utils = trpc.useUtils();
  const listQ = trpc.maintenanceSchedule.list.useQuery();
  const machinesQ = trpc.machine.list.useQuery();
  const machines = (machinesQ.data ?? []) as Array<{ id: number; code: string; name?: string }>;
  const machineLabel = (id: number) => {
    const m = machines.find((x) => x.id === id);
    return m ? `${m.code}${m.name ? ` — ${m.name}` : ""}` : `#${id}`;
  };

  const [editing, setEditing] = useState<PmSchedule | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<PmSchedule | null>(null);

  const invalidate = () => void utils.maintenanceSchedule.list.invalidate();

  const createM = trpc.maintenanceSchedule.create.useMutation({
    onSuccess: () => { toast.success(t("cmms.pm.created", "Đã tạo lịch PM")); setCreateOpen(false); invalidate(); },
    onError: (e) => toastTrpcError(e),
  });
  const updateM = trpc.maintenanceSchedule.update.useMutation({
    onSuccess: () => { toast.success(t("cmms.pm.updated", "Đã cập nhật lịch PM")); setEditing(null); invalidate(); },
    onError: (e) => toastTrpcError(e),
  });
  const removeM = trpc.maintenanceSchedule.remove.useMutation({
    onSuccess: () => { toast.success(t("cmms.pm.removed", "Đã xóa lịch PM")); setConfirmDelete(null); invalidate(); },
    onError: (e) => toastTrpcError(e),
  });
  const setEnabledM = trpc.maintenanceSchedule.setEnabled.useMutation({
    onSuccess: () => invalidate(),
    onError: (e) => toastTrpcError(e),
  });

  const rows = (listQ.data ?? []) as PmSchedule[];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-sm text-muted-foreground">
          {t("cmms.pm.hint", "Lịch bảo trì phòng ngừa theo chu kỳ — hệ thống sinh lệnh công việc khi tới hạn.")}
        </p>
        {canCreate && (
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-1" /> {t("cmms.pm.create", "Tạo lịch PM")}
          </Button>
        )}
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("cmms.pm.machine", "Thiết bị")}</TableHead>
                <TableHead>{t("cmms.pm.name", "Tên công việc")}</TableHead>
                <TableHead>{t("cmms.pm.typeCol", "Loại")}</TableHead>
                <TableHead className="text-right">{t("cmms.pm.interval", "Chu kỳ (ngày)")}</TableHead>
                <TableHead>{t("cmms.pm.nextDue", "Tới hạn kế")}</TableHead>
                <TableHead>{t("cmms.pm.active", "Kích hoạt")}</TableHead>
                <TableHead className="text-right">{t("cmms.pm.actions", "Thao tác")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {listQ.isLoading && (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">{t("common.loading", "Đang tải…")}</TableCell></TableRow>
              )}
              {!listQ.isLoading && rows.length === 0 && (
                <TableRow><TableCell colSpan={7} className="py-8">
                  <EmptyState
                    variant="no-config"
                    title={t("cmms.pm.emptyTitle", "Chưa có lịch bảo trì phòng ngừa")}
                    description={t("cmms.pm.emptyDesc", "Tạo lịch PM đầu tiên để tự động sinh lệnh công việc khi tới hạn.")}
                    compact
                  />
                </TableCell></TableRow>
              )}
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <Link href={`/machine/${r.machineId}`} className="text-primary hover:underline">
                      {r.machineCode ?? machineLabel(r.machineId)}
                    </Link>
                  </TableCell>
                  <TableCell className="max-w-[18rem] truncate">{r.name}</TableCell>
                  <TableCell><Badge variant="outline">{scheduleTypeLabel(t, r.taskType)}</Badge></TableCell>
                  <TableCell className="text-right tabular-nums">{r.intervalDays ?? "—"}</TableCell>
                  <TableCell className="text-xs">{fmtDate(r.nextDueAt)}</TableCell>
                  <TableCell>
                    <Switch
                      checked={r.isActive}
                      disabled={!canEdit || setEnabledM.isPending}
                      onCheckedChange={(v) => setEnabledM.mutate({ id: r.id, isActive: v })}
                      aria-label={t("cmms.pm.active", "Kích hoạt")}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex gap-1 justify-end">
                      {canEdit && (
                        <Button size="sm" variant="ghost" aria-label={t("common.edit", "Sửa")} onClick={() => setEditing(r)}>
                          <Pencil aria-hidden="true" className="h-4 w-4" />
                        </Button>
                      )}
                      {canDelete && (
                        <Button size="sm" variant="ghost" aria-label={t("common.delete", "Xóa")} onClick={() => setConfirmDelete(r)}>
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

      {(createOpen || editing) && (
        <PmScheduleDialog
          initial={editing}
          machines={machines}
          pending={createM.isPending || updateM.isPending}
          onClose={() => { setCreateOpen(false); setEditing(null); }}
          onSubmit={(v) => {
            if (editing) updateM.mutate({ id: editing.id, ...v });
            else createM.mutate(v);
          }}
        />
      )}

      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("cmms.pm.confirmDeleteTitle", "Xóa lịch PM?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("cmms.pm.confirmDeleteBody", "Hành động này không thể hoàn tác.")} — {confirmDelete?.name}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel", "Hủy")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => confirmDelete && removeM.mutate({ id: confirmDelete.id })}>
              {t("common.delete", "Xóa")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function PmScheduleDialog({
  initial, machines, pending, onClose, onSubmit,
}: {
  initial: PmSchedule | null;
  machines: Array<{ id: number; code: string; name?: string }>;
  pending: boolean;
  onClose: () => void;
  onSubmit: (v: { machineId: number; name: string; taskType: ScheduleType; intervalDays: number; nextDueAt?: string }) => void;
}) {
  const { t } = useTranslation();
  const [machineId, setMachineId] = useState<number | null>(initial?.machineId ?? null);
  const [name, setName] = useState(initial?.name ?? "");
  const [taskType, setTaskType] = useState<ScheduleType>((initial?.taskType as ScheduleType) ?? "TIME_BASED");
  const [intervalDays, setIntervalDays] = useState<string>(
    initial?.intervalDays != null ? String(initial.intervalDays) : "30",
  );
  const [nextDueAt, setNextDueAt] = useState<string>(
    initial?.nextDueAt ? new Date(initial.nextDueAt).toISOString().slice(0, 10) : "",
  );

  const submit = () => {
    if (!machineId) { toast.error(t("cmms.pm.machineRequired", "Chọn thiết bị")); return; }
    if (name.trim().length < 2) { toast.error(t("cmms.pm.nameRequired", "Nhập tên công việc")); return; }
    const days = Number(intervalDays);
    if (!Number.isInteger(days) || days < 1) { toast.error(t("cmms.pm.intervalRequired", "Chu kỳ ≥ 1 ngày")); return; }
    onSubmit({
      machineId,
      name: name.trim(),
      taskType,
      intervalDays: days,
      nextDueAt: nextDueAt ? new Date(nextDueAt).toISOString() : undefined,
    });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initial ? t("cmms.pm.editTitle", "Sửa lịch PM") : t("cmms.pm.create", "Tạo lịch PM")}</DialogTitle>
          <DialogDescription className="sr-only">
            {t("cmms.pm.dialogDesc", "Nhập máy, loại và chu kỳ cho lịch bảo trì phòng ngừa.")}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <div className="grid gap-1">
            <Label>{t("cmms.pm.machine", "Thiết bị")} *</Label>
            <MachineSelect
              value={machineId}
              onChange={(v) => setMachineId(v == null ? null : Number(v))}
              disabled={!!initial}
              placeholder={t("cmms.pm.selectMachine", "Chọn thiết bị…")}
              aria-label={t("cmms.pm.machine", "Thiết bị")}
            />
          </div>
          <div className="grid gap-1">
            <Label>{t("cmms.pm.name", "Tên công việc")} *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)}
              placeholder={t("cmms.pm.namePlaceholder", "VD: Tra dầu trục X")} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1">
              <Label>{t("cmms.pm.typeCol", "Loại")}</Label>
              <Select value={taskType} onValueChange={(v) => setTaskType(v as ScheduleType)}>
                <SelectTrigger aria-label={t("cmms.pm.typeCol", "Loại")} className="h-9 w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SCHEDULE_TYPES.map((s) => <SelectItem key={s} value={s}>{scheduleTypeLabel(t, s)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1">
              <Label>{t("cmms.pm.interval", "Chu kỳ (ngày)")} *</Label>
              <Input type="number" min={1} value={intervalDays}
                onChange={(e) => setIntervalDays(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-1">
            <Label>{t("cmms.pm.nextDue", "Tới hạn kế")}</Label>
            <Input type="date" value={nextDueAt} onChange={(e) => setNextDueAt(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("common.cancel", "Hủy")}</Button>
          <Button onClick={submit} disabled={pending}>{t("common.save", "Lưu")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Tab 3 — Vật tư (worklist phụ tùng ở/dưới mức đặt lại)
// ════════════════════════════════════════════════════════════════════════════
function SparePartsTab() {
  const { t } = useTranslation();
  const belowQ = trpc.maintenance.partsBelowReorder.useQuery({ limit: 200 });
  const rows = (belowQ.data ?? []) as Array<{
    id: number; partCode: string; partName: string; category: string | null;
    quantityOnHand: number; reorderLevel: number; reorderQuantity: number;
    unit: string; location: string | null; supplierCode: string | null;
  }>;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-sm text-muted-foreground">
          {t("cmms.parts.hint", "Phụ tùng ở/dưới mức đặt lại — cần bổ sung kho. Ghi nhận tiêu thụ trong chi tiết lệnh công việc.")}
        </p>
        <StatChipRow>
          <StatChip label={t("cmms.parts.needRestock", "Cần đặt thêm")} value={belowQ.isLoading ? "—" : rows.length}
            tone={rows.length > 0 ? "error" : "success"} />
        </StatChipRow>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("cmms.parts.code", "Mã")}</TableHead>
                <TableHead>{t("cmms.parts.name", "Tên phụ tùng")}</TableHead>
                <TableHead>{t("cmms.parts.category", "Nhóm")}</TableHead>
                <TableHead className="text-right">{t("cmms.parts.onHand", "Tồn")}</TableHead>
                <TableHead className="text-right">{t("cmms.parts.reorder", "Mức đặt lại")}</TableHead>
                <TableHead className="text-right">{t("cmms.parts.suggest", "Đề xuất đặt")}</TableHead>
                <TableHead>{t("cmms.parts.location", "Vị trí")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {belowQ.isLoading && (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">{t("common.loading", "Đang tải…")}</TableCell></TableRow>
              )}
              {!belowQ.isLoading && rows.length === 0 && (
                <TableRow><TableCell colSpan={7} className="py-8">
                  <EmptyState
                    variant="no-data"
                    title={t("cmms.parts.okTitle", "Kho phụ tùng đủ mức")}
                    description={t("cmms.parts.okDesc", "Không có phụ tùng nào ở/dưới mức đặt lại.")}
                    compact
                  />
                </TableCell></TableRow>
              )}
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs">{r.partCode}</TableCell>
                  <TableCell className="max-w-[18rem] truncate">{r.partName}</TableCell>
                  <TableCell>{r.category ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    <span className={r.quantityOnHand <= r.reorderLevel ? "text-destructive font-medium" : ""}>
                      {r.quantityOnHand} {r.unit}
                    </span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{r.reorderLevel}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.reorderQuantity || "—"}</TableCell>
                  <TableCell className="text-xs">{r.location ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Tab 4 — Độ tin cậy (MTTR/MTBF toàn đội + bad actors)
// Suy ra từ các WO ĐÃ HOÀN THÀNH (mirror computeMttrMtbf ở backend): MTTR = TB
// downtimeMinutes; MTBF = TB khoảng cách openedAt giữa các lần hỏng liên tiếp.
// ════════════════════════════════════════════════════════════════════════════
type RelRow = {
  machineId: number;
  machineCode: string | null;
  failures: number;
  mttrMinutes: number | null;
  mtbfHours: number | null;
  lastFailure: number | null;
};

function ReliabilityTab() {
  const { t } = useTranslation();
  const listQ = trpc.maintenance.listWorkOrders.useQuery({ limit: 500 });

  const { table, fleetMttr, fleetMtbf, totalFailures } = useMemo(() => {
    const orders = (listQ.data ?? []) as Array<{
      machineId: number; machineCode: string | null; status: string;
      openedAt: string | Date | null; closedAt: string | Date | null;
      repairStartedAt: string | Date | null; downtimeMinutes: number | null;
    }>;
    const completed = orders.filter((o) => o.status === "COMPLETED");

    const byMachine = new Map<number, typeof completed>();
    for (const o of completed) {
      const arr = byMachine.get(o.machineId) ?? [];
      arr.push(o);
      byMachine.set(o.machineId, arr);
    }

    const rows: RelRow[] = [];
    for (const [machineId, list] of byMachine) {
      // opened ascending
      const withOpen = list
        .filter((o) => o.openedAt)
        .sort((a, b) => new Date(a.openedAt!).getTime() - new Date(b.openedAt!).getTime());
      const failures = withOpen.length;
      if (failures === 0) continue;

      // MTTR — TB downtimeMinutes (fallback closedAt−repairStartedAt).
      const downtimes = withOpen
        .map((o) => o.downtimeMinutes ?? (o.closedAt && o.repairStartedAt
          ? Math.round((new Date(o.closedAt).getTime() - new Date(o.repairStartedAt).getTime()) / 60000)
          : null))
        .filter((d): d is number => d != null && d >= 0);
      const mttrMinutes = downtimes.length
        ? downtimes.reduce((a, b) => a + b, 0) / downtimes.length
        : null;

      // MTBF — TB khoảng cách openedAt liên tiếp (giờ).
      let mtbfHours: number | null = null;
      if (failures >= 2) {
        let gapMs = 0;
        for (let i = 1; i < withOpen.length; i++) {
          gapMs += new Date(withOpen[i].openedAt!).getTime() - new Date(withOpen[i - 1].openedAt!).getTime();
        }
        mtbfHours = gapMs / (failures - 1) / 3_600_000;
      }

      rows.push({
        machineId,
        machineCode: withOpen[withOpen.length - 1].machineCode ?? null,
        failures,
        mttrMinutes,
        mtbfHours,
        lastFailure: new Date(withOpen[withOpen.length - 1].openedAt!).getTime(),
      });
    }

    // Bad actors: nhiều hỏng nhất, rồi MTTR cao nhất.
    rows.sort((a, b) => (b.failures - a.failures) || ((b.mttrMinutes ?? 0) - (a.mttrMinutes ?? 0)));

    const allMttr = rows.map((r) => r.mttrMinutes).filter((x): x is number => x != null);
    const allMtbf = rows.map((r) => r.mtbfHours).filter((x): x is number => x != null);
    return {
      table: rows,
      totalFailures: completed.length,
      fleetMttr: allMttr.length ? allMttr.reduce((a, b) => a + b, 0) / allMttr.length : null,
      fleetMtbf: allMtbf.length ? allMtbf.reduce((a, b) => a + b, 0) / allMtbf.length : null,
    };
  }, [listQ.data]);

  const fmtMins = (m: number | null) => (m == null ? "—" : m < 60 ? `${Math.round(m)} ph` : `${(m / 60).toFixed(1)} giờ`);
  const fmtHours = (h: number | null) => (h == null ? "—" : h < 48 ? `${h.toFixed(1)} giờ` : `${(h / 24).toFixed(1)} ngày`);

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {t("cmms.rel.hint", "Chỉ số suy ra từ các lệnh công việc ĐÃ HOÀN THÀNH. Thiếu dữ liệu hiển thị “—”.")}
      </p>

      <StatChipRow>
        <StatChip label={t("cmms.rel.machines", "Số máy có hỏng")} value={listQ.isLoading ? "—" : table.length} />
        <StatChip label={t("cmms.rel.failures", "Tổng lần hỏng")} value={listQ.isLoading ? "—" : totalFailures} tone="warning" />
        <StatChip label={t("cmms.rel.fleetMttr", "MTTR đội")} value={fmtMins(fleetMttr)} tone="info" />
        <StatChip label={t("cmms.rel.fleetMtbf", "MTBF đội")} value={fmtHours(fleetMtbf)} tone="success" />
      </StatChipRow>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">#</TableHead>
                <TableHead>{t("cmms.rel.machine", "Thiết bị")}</TableHead>
                <TableHead className="text-right">{t("cmms.rel.failuresCol", "Số lần hỏng")}</TableHead>
                <TableHead className="text-right">{t("cmms.rel.mttr", "MTTR")}</TableHead>
                <TableHead className="text-right">{t("cmms.rel.mtbf", "MTBF")}</TableHead>
                <TableHead>{t("cmms.rel.lastFailure", "Lần hỏng gần nhất")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {listQ.isLoading && (
                <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">{t("common.loading", "Đang tải…")}</TableCell></TableRow>
              )}
              {!listQ.isLoading && table.length === 0 && (
                <TableRow><TableCell colSpan={6} className="py-8">
                  <EmptyState
                    variant="no-analytics"
                    title={t("cmms.rel.emptyTitle", "Chưa đủ dữ liệu độ tin cậy")}
                    description={t("cmms.rel.emptyDesc", "Đóng (hoàn thành) các lệnh công việc để tích lũy MTTR/MTBF.")}
                    compact
                  />
                </TableCell></TableRow>
              )}
              {table.map((r, i) => (
                <TableRow key={r.machineId}>
                  <TableCell className="tabular-nums text-muted-foreground">{i + 1}</TableCell>
                  <TableCell>
                    <Link href={`/machine/${r.machineId}`} className="text-primary hover:underline">
                      {r.machineCode ?? `#${r.machineId}`}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    <Badge variant={i < 3 && r.failures > 1 ? "destructive" : "outline"}>{r.failures}</Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{fmtMins(r.mttrMinutes)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtHours(r.mtbfHours)}</TableCell>
                  <TableCell className="text-xs">{r.lastFailure ? new Date(r.lastFailure).toLocaleDateString() : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
