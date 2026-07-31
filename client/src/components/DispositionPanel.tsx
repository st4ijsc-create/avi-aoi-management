/**
 * W5-B (doc 27 §5 gap F2) — Disposition / repair-loop panel for InspectionDetail.
 *
 * Closes the loop after the QC verdict: on an NG/NTF board the inspector
 * creates a DISPOSITION (rework / repair / scrap / use_as_is / return_to_vendor),
 * the technician walks it through open → in_repair → repaired →
 * re_inspect_pending → closed (legal transitions come from the server —
 * single source of truth), and the panel shows the DERIVED re-inspect verdict:
 * a later inspection of the same serial ("Đã kiểm lại: OK/NG/NTF") deep-linked.
 *
 * Work-order integration is LINK-ONLY by design (see defectDispositionService
 * header — auto-created board-repair WOs would pollute machine MTTR/MTBF):
 * when the viewer can read maintenance WOs of the inspecting machine, the
 * create dialog offers linking an existing open WO; otherwise the field hides
 * (the list query fails silently for roles without machine_monitoring view).
 */
import { useState } from "react";
import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import { format } from "date-fns";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { toastTrpcError } from "@/lib/trpcErrors";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Wrench,
  Plus,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RotateCcw,
  ExternalLink,
  User as UserIcon,
} from "lucide-react";

type DispositionType = "rework" | "repair" | "scrap" | "use_as_is" | "return_to_vendor";
type DispositionStatus = "open" | "in_repair" | "repaired" | "re_inspect_pending" | "closed";

const DISPOSITION_TYPES: DispositionType[] = ["rework", "repair", "scrap", "use_as_is", "return_to_vendor"];

// Fallback transition map (mirrors the service); replaced by the server's map once loaded.
const FALLBACK_TRANSITIONS: Record<DispositionStatus, DispositionStatus[]> = {
  open: ["in_repair", "closed"],
  in_repair: ["repaired", "closed"],
  repaired: ["re_inspect_pending", "closed"],
  re_inspect_pending: ["closed", "in_repair"],
  closed: [],
};

const OPEN_WO_STATUSES = new Set(["OPEN", "SCHEDULED", "IN_PROGRESS", "ON_HOLD"]);

function statusBadgeClass(status: DispositionStatus): string {
  switch (status) {
    case "open": return "bg-destructive/20 text-destructive border-destructive/30";
    case "in_repair": return "bg-warning/20 text-warning border-warning/30";
    case "repaired": return "bg-primary/20 text-primary border-primary/30";
    case "re_inspect_pending": return "bg-secondary text-secondary-foreground border-border";
    case "closed": return "bg-success/20 text-success border-success/30";
  }
}

function verdictBadge(result: string) {
  if (result === "OK") {
    return (
      <Badge className="bg-success/20 text-success border-success/30 gap-1">
        <CheckCircle2 className="h-3 w-3" /> OK
      </Badge>
    );
  }
  if (result === "NG") {
    return (
      <Badge className="bg-destructive/20 text-destructive border-destructive/30 gap-1">
        <XCircle className="h-3 w-3" /> NG
      </Badge>
    );
  }
  return (
    <Badge className="bg-warning/20 text-warning border-warning/30 gap-1">
      <AlertTriangle className="h-3 w-3" /> {result}
    </Badge>
  );
}

export interface DispositionPanelProps {
  inspectionId: number;
  machineId?: number | null;
  overallResult: string;
  readOnly?: boolean;
  /** Pre-select a measurement result (when opened from a specific NG point). */
  measurementResultId?: number | null;
}

export function DispositionPanel({ inspectionId, machineId, overallResult, readOnly }: DispositionPanelProps) {
  const { t } = useTranslation();
  const utils = trpc.useUtils();

  const [createOpen, setCreateOpen] = useState(false);
  const [dispType, setDispType] = useState<DispositionType>("rework");
  const [note, setNote] = useState("");
  const [assignee, setAssignee] = useState("");
  const [workOrderId, setWorkOrderId] = useState<string>("none");

  const listQ = trpc.defectDisposition.listByInspection.useQuery(
    { inspectionId },
    { enabled: inspectionId > 0, retry: false },
  );
  const reInspectQ = trpc.defectDisposition.reInspectStatus.useQuery(
    { inspectionId },
    { enabled: inspectionId > 0, retry: false, staleTime: 30_000 },
  );
  const transitionsQ = trpc.defectDisposition.transitions.useQuery(undefined, {
    retry: false,
    staleTime: Infinity,
  });
  // WO link is optional and permission-gated server-side: for roles without
  // machine_monitoring view this query errors → the field simply hides.
  const woQ = trpc.maintenance.listWorkOrders.useQuery(
    { machineId: machineId ?? undefined, limit: 100 },
    { enabled: createOpen && machineId != null, retry: false },
  );
  const openWos = (woQ.data ?? []).filter((wo: { status: string }) => OPEN_WO_STATUSES.has(wo.status));

  const refresh = () => {
    listQ.refetch();
    utils.defectDisposition.countOpen.invalidate();
  };

  const createM = trpc.defectDisposition.create.useMutation({
    onSuccess: () => {
      toast.success(t("disposition.created", "Đã tạo disposition"));
      setCreateOpen(false);
      setNote("");
      setAssignee("");
      setWorkOrderId("none");
      refresh();
    },
    onError: (e) => toastTrpcError(e),
  });

  const updateM = trpc.defectDisposition.updateStatus.useMutation({
    onSuccess: () => {
      toast.success(t("disposition.statusUpdated", "Đã cập nhật trạng thái"));
      refresh();
    },
    onError: (e) => toastTrpcError(e),
  });

  const rows = listQ.data ?? [];
  const transitions = (transitionsQ.data as Record<DispositionStatus, DispositionStatus[]> | undefined) ?? FALLBACK_TRANSITIONS;

  // Show the panel for NG/NTF boards, or whenever history already exists.
  if (overallResult === "OK" && rows.length === 0) return null;

  const typeLabel = (v: DispositionType) => t(`disposition.types.${v}`, v);
  const statusLabel = (v: DispositionStatus) => t(`disposition.status.${v}`, v);
  const actionLabel = (v: DispositionStatus) => t(`disposition.action.${v}`, v);

  const reInspect = reInspectQ.data;

  return (
    <Card className="glass-card">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <Wrench className="h-5 w-5 text-primary" />
              {t("disposition.title", "Disposition / Sửa chữa")}
            </CardTitle>
            <CardDescription>
              {t("disposition.sectionDesc", "Quyết định xử lý board NG/NTF và theo dõi vòng lặp sửa chữa → kiểm lại")}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {/* Re-inspect linkage — DERIVED from a later inspection of the same serial */}
            {reInspect?.found && reInspect.latest ? (
              <Link href={`/inspection/${reInspect.latest.id}`}>
                <Badge variant="outline" className="gap-1.5 cursor-pointer hover:bg-muted">
                  <RotateCcw className="h-3 w-3" />
                  {t("disposition.reInspected", "Đã kiểm lại")}:
                  {verdictBadge(reInspect.latest.overallResult)}
                  {reInspect.laterCount > 1 ? (
                    <span className="text-[10px] text-muted-foreground">×{reInspect.laterCount}</span>
                  ) : null}
                  <ExternalLink className="h-3 w-3 text-muted-foreground" />
                </Badge>
              </Link>
            ) : (
              <Badge variant="outline" className="gap-1 text-muted-foreground">
                <RotateCcw className="h-3 w-3" />
                {t("disposition.notReInspected", "Chưa kiểm lại")}
              </Badge>
            )}
            {!readOnly && (
              <Button size="sm" className="gap-1" onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4" />
                {t("disposition.create", "Tạo disposition")}
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {listQ.isLoading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">
            {t("disposition.empty", "Chưa có disposition — board NG này chưa có quyết định xử lý.")}
          </p>
        ) : (
          <div className="space-y-3">
            {rows.map((d) => {
              const status = d.status as DispositionStatus;
              const nexts = transitions[status] ?? [];
              return (
                <div key={d.id} className="p-3 rounded-lg border border-border bg-secondary/20">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="secondary">{typeLabel(d.disposition as DispositionType)}</Badge>
                      <Badge className={`${statusBadgeClass(status)} border`}>{statusLabel(status)}</Badge>
                      {d.measurementResultId != null && (
                        <Badge variant="outline" className="text-[10px]">
                          {t("disposition.pointScope", "Điểm đo")} #{d.measurementResultId}
                        </Badge>
                      )}
                      {d.workOrderId != null && (
                        <Badge variant="outline" className="text-[10px] gap-1">
                          <Wrench className="h-3 w-3" />
                          WO #{d.workOrderId}
                        </Badge>
                      )}
                    </div>
                    {!readOnly && nexts.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {nexts.map((nx) => (
                          <Button
                            key={nx}
                            size="sm"
                            variant={nx === "closed" ? "outline" : "default"}
                            className="h-7 text-xs"
                            disabled={updateM.isPending}
                            onClick={() => updateM.mutate({ id: d.id, status: nx })}
                          >
                            {actionLabel(nx)}
                          </Button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span>
                      {t("disposition.createdBy", "Người tạo")}: {d.createdByName ?? (d.createdBy != null ? `#${d.createdBy}` : "—")}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <UserIcon className="h-3 w-3" />
                      {t("disposition.assignee", "Người sửa")}: {d.assigneeName ?? (d.assignee != null ? `#${d.assignee}` : "—")}
                    </span>
                    <span>{format(new Date(d.createdAt), "dd/MM/yyyy HH:mm")}</span>
                  </div>
                  {d.note && <p className="mt-1.5 text-sm text-foreground whitespace-pre-wrap">{d.note}</p>}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wrench className="h-5 w-5" />
              {t("disposition.createTitle", "Tạo disposition xử lý board")}
            </DialogTitle>
            <DialogDescription>
              {t("disposition.createDesc", "Quyết định xử lý cho board NG/NTF này. Trạng thái sửa chữa sẽ được theo dõi tới khi kiểm lại.")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">{t("disposition.type", "Loại xử lý")}</label>
              <Select value={dispType} onValueChange={(v) => setDispType(v as DispositionType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DISPOSITION_TYPES.map((v) => (
                    <SelectItem key={v} value={v}>{typeLabel(v)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">
                {t("disposition.assigneeInput", "Người sửa (user ID, tùy chọn)")}
              </label>
              <Input
                type="number"
                min={1}
                placeholder={t("disposition.assigneePlaceholder", "VD: 12")}
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
              />
            </div>
            {/* WO link — only when the viewer can read this machine's WOs (query would error otherwise) */}
            {machineId != null && !woQ.isError && openWos.length > 0 && (
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("disposition.linkWo", "Link WO bảo trì máy (tùy chọn)")}</label>
                <Select value={workOrderId} onValueChange={setWorkOrderId}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t("disposition.noWo", "Không liên kết")}</SelectItem>
                    {openWos.map((wo: { id: number; workOrderNumber: string; title: string; status: string }) => (
                      <SelectItem key={wo.id} value={String(wo.id)}>
                        <span className="flex items-center gap-2">
                          <span className="font-mono text-xs">{wo.workOrderNumber}</span>
                          <span className="truncate">{wo.title}</span>
                          <Badge variant="secondary" className="text-[10px]">{wo.status}</Badge>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {t("disposition.linkWoHint", "Chỉ liên kết WO có sẵn (khi NG nghi do máy). Sửa board không tạo WO bảo trì — tránh làm sai lệch MTTR/MTBF của máy.")}
                </p>
              </div>
            )}
            <div className="space-y-2">
              <label className="text-sm font-medium">{t("disposition.note", "Ghi chú")}</label>
              <Textarea
                rows={3}
                placeholder={t("disposition.notePlaceholder", "Mô tả lỗi cần sửa, hướng xử lý…")}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              {t("common.cancel", "Hủy")}
            </Button>
            <Button
              disabled={createM.isPending}
              className="gap-2"
              onClick={() =>
                createM.mutate({
                  inspectionId,
                  disposition: dispType,
                  note: note.trim() || undefined,
                  assignee: assignee.trim() ? Number(assignee) : undefined,
                  workOrderId: workOrderId !== "none" ? Number(workOrderId) : undefined,
                })
              }
            >
              {createM.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {t("disposition.create", "Tạo disposition")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export default DispositionPanel;
