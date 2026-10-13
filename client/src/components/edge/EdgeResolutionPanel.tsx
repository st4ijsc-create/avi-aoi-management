/**
 * doc 81 Đợt 10 task F2 — R-10-af / R-10-ax: what a PERSON must look at after the edge cutover, and the two audited decisions
 * only a person may take. Nothing here sends a byte to a device.
 *
 *   • Pending STOPs (device_pending_stops): needsResolution (refused / failed — only a person closes it), ownerCannotList (the
 *     edge owner cannot reach the device — central executes it), overdue (a STOP never expires; it is still owed), undeliverable
 *     (its node has no active credential — it will never pull it).
 *   • Orphaned OT write intents: a write-ahead intent with no result (the process died mid-write). It blocks the adapter's
 *     ownership change until a result exists; a person records "outcome unknown" once it is ≥ 10 minutes old.
 * The server is the wall (edgeResolution.* — admin / supervisor + 2FA + machine_control/canEdit, factory scope, audit in the
 * same transaction); `canResolve` only hides buttons that would end in FORBIDDEN.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { toastTrpcError } from "@/lib/trpcErrors";

type StopItem = {
  requestId: number;
  deviceKind: "robot" | "adapter";
  deviceId: number;
  deviceCode: string | null;
  requestNodeCode: string | null;
  requestEdgeNodeId: number;
  currentNodeCode: string | null;
  currentEdgeNodeId: number | null;
  reason: string | null;
  createdAt: string;
  outcome: "refused" | "failed" | null;
  needsResolution: boolean;
  ownerCannotList: boolean;
  overdue: boolean;
  undeliverable: boolean;
};
type IntentItem = {
  intentId: number;
  adapterId: number;
  adapterCode: string | null;
  commandType: string | null;
  tagKey: string | null;
  createdAt: string;
  ageMinutes: number;
  resolvable: boolean;
};
type ListData = { available: boolean; stops: StopItem[]; intents: IntentItem[]; stopTotal: number; intentTotal: number; intentMinAgeMinutes: number };

const fmt = (v?: string | null) => (v ? new Date(v).toLocaleString() : "—");

export default function EdgeResolutionPanel(props: { robotId?: number; adapterId?: number; canResolve: boolean }) {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const filter = props.robotId != null ? { robotId: props.robotId } : props.adapterId != null ? { adapterId: props.adapterId } : undefined;
  const listQ = trpc.edgeResolution.list.useQuery(filter, { refetchInterval: 15_000 });
  const raw = listQ.data as Partial<ListData> | undefined;
  const data: ListData = {
    available: raw?.available !== false,
    stops: Array.isArray(raw?.stops) ? (raw!.stops as StopItem[]) : [],
    intents: Array.isArray(raw?.intents) ? (raw!.intents as IntentItem[]) : [],
    stopTotal: Number(raw?.stopTotal ?? 0),
    intentTotal: Number(raw?.intentTotal ?? 0),
    intentMinAgeMinutes: Number(raw?.intentMinAgeMinutes ?? 10),
  };

  const [target, setTarget] = useState<{ kind: "stop"; item: StopItem } | { kind: "intent"; item: IntentItem } | null>(null);
  const [reason, setReason] = useState("");
  const done = {
    onSuccess: () => {
      toast.success(target?.kind === "intent" ? t("edgeResolution.intentResolved", "Đã ghi nhận kết cục KHÔNG RÕ cho lệnh ghi mồ côi") : t("edgeResolution.stopResolved", "Đã ghi nhận cách xử lý lệnh DỪNG"));
      setTarget(null);
      setReason("");
      void utils.edgeResolution.list.invalidate();
    },
    onError: (e: unknown) => {
      toastTrpcError(e);
      setTarget(null);
      setReason("");
      void utils.edgeResolution.list.invalidate();
    },
  };
  const resolveStopM = trpc.edgeResolution.resolveStop.useMutation(done);
  const resolveIntentM = trpc.edgeResolution.resolveIntent.useMutation(done);
  const pending = resolveStopM.isPending || resolveIntentM.isPending;
  const deviceLabel = (s: StopItem) => `${s.deviceKind === "robot" ? t("edgeResolution.robot", "Robot") : t("edgeResolution.adapter", "Bộ chuyển đổi")} ${s.deviceCode ?? `#${s.deviceId}`}`;

  return (
    <Card data-testid="edge-resolution-panel">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldAlert className="h-4 w-4" />
          {t("edgeResolution.title", "Lệnh DỪNG chờ xử lý và lệnh ghi mồ côi")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!data.available && (
          <p className="text-sm text-muted-foreground">{t("edgeResolution.unavailable", "Chưa có lược đồ điều khiển edge (migration 0374 chưa áp) — không có gì để hiển thị.")}</p>
        )}
        {data.available && data.stops.length === 0 && data.intents.length === 0 && (
          <p className="text-sm text-muted-foreground">{t("edgeResolution.empty", "Không có lệnh DỪNG nào đang chờ và không có lệnh ghi mồ côi trong phạm vi của bạn.")}</p>
        )}

        {data.stops.length > 0 && (
          <div className="space-y-1">
            <div className="text-sm font-medium">
              {t("edgeResolution.stopsHeading", { defaultValue: "Lệnh DỪNG chưa được xác nhận ({{shown}}/{{total}})", shown: data.stops.length, total: data.stopTotal })}
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("edgeResolution.colDevice", "Thiết bị")}</TableHead>
                  <TableHead>{t("edgeResolution.colOwner", "Nút gửi / chủ hiện tại")}</TableHead>
                  <TableHead>{t("edgeResolution.colCreated", "Tạo lúc")}</TableHead>
                  <TableHead>{t("edgeResolution.colState", "Tình trạng")}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.stops.map((s) => (
                  <TableRow key={s.requestId}>
                    <TableCell className="text-xs">{deviceLabel(s)}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {s.requestNodeCode ?? `#${s.requestEdgeNodeId}`} / {s.currentEdgeNodeId == null ? t("edgeResolution.central", "trung tâm") : (s.currentNodeCode ?? `#${s.currentEdgeNodeId}`)}
                    </TableCell>
                    <TableCell className="text-xs">{fmt(s.createdAt)}</TableCell>
                    <TableCell className="space-x-1 space-y-1 text-xs">
                      {s.needsResolution && (
                        <Badge variant="destructive">
                          {s.outcome === "failed" ? t("edgeResolution.flag.failed", "Thất bại — cần người xử lý") : t("edgeResolution.flag.refused", "Bị từ chối — cần người xử lý")}
                        </Badge>
                      )}
                      {s.ownerCannotList && <Badge variant="outline">{t("edgeResolution.flag.ownerCannotList", "Nút edge không thấy thiết bị — trung tâm thực thi")}</Badge>}
                      {s.overdue && <Badge variant="outline">{t("edgeResolution.flag.overdue", "Quá hạn — vẫn phải DỪNG")}</Badge>}
                      {s.undeliverable && <Badge variant="destructive">{t("edgeResolution.flag.undeliverable", "Không giao được — nút không còn thông tin xác thực")}</Badge>}
                      {!s.needsResolution && !s.ownerCannotList && !s.overdue && !s.undeliverable && <Badge variant="secondary">{t("edgeResolution.flag.pending", "Đang chờ thực thi")}</Badge>}
                    </TableCell>
                    <TableCell className="text-right">
                      {s.needsResolution && props.canResolve && (
                        <Button size="sm" variant="outline" disabled={pending} onClick={() => setTarget({ kind: "stop", item: s })}>
                          {t("edgeResolution.resolveStop", "Ghi nhận xử lý")}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {data.intents.length > 0 && (
          <div className="space-y-1">
            <div className="text-sm font-medium">
              {t("edgeResolution.intentsHeading", { defaultValue: "Lệnh ghi OT mồ côi — chưa có kết quả ({{shown}}/{{total}})", shown: data.intents.length, total: data.intentTotal })}
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("edgeResolution.colAdapter", "Bộ chuyển đổi")}</TableHead>
                  <TableHead>{t("edgeResolution.colCommand", "Lệnh / tag")}</TableHead>
                  <TableHead>{t("edgeResolution.colAge", "Tuổi (phút)")}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.intents.map((i) => (
                  <TableRow key={i.intentId}>
                    <TableCell className="font-mono text-xs">{i.adapterCode ?? `#${i.adapterId}`}</TableCell>
                    <TableCell className="font-mono text-xs">{i.commandType ?? "—"} / {i.tagKey ?? "—"}</TableCell>
                    <TableCell className="text-xs">{i.ageMinutes}</TableCell>
                    <TableCell className="text-right text-xs">
                      {!i.resolvable ? (
                        <span className="text-muted-foreground">{t("edgeResolution.intentTooRecent", { defaultValue: "Có thể vẫn đang ghi — chờ đủ {{min}} phút", min: data.intentMinAgeMinutes })}</span>
                      ) : props.canResolve ? (
                        <Button size="sm" variant="outline" disabled={pending} onClick={() => setTarget({ kind: "intent", item: i })}>
                          {t("edgeResolution.resolveIntent", "Ghi nhận kết cục không rõ")}
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <AlertDialog open={target != null} onOpenChange={(open) => { if (!open) setTarget(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {target?.kind === "intent"
                  ? t("edgeResolution.intentDialogTitle", { defaultValue: "Ghi nhận kết cục KHÔNG RÕ cho lệnh ghi #{{id}}?", id: target.item.intentId })
                  : t("edgeResolution.stopDialogTitle", { defaultValue: "Ghi nhận cách xử lý lệnh DỪNG #{{id}}?", id: target?.kind === "stop" ? target.item.requestId : "" })}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {target?.kind === "intent"
                  ? t("edgeResolution.intentDialogDesc", "Tiến trình đã dừng giữa lúc ghi: lệnh có thể đã hoặc chưa tới thiết bị. Hãy kiểm tra giá trị thật tại chỗ trước. Thao tác ghi một dòng KẾT QUẢ 'kết cục không rõ' vào sổ lệnh (không sửa, không xoá gì), được kiểm toán kèm lý do; không gửi gì tới thiết bị. Việc đổi chủ của bộ chuyển đổi vẫn bị chặn thêm 10 phút sau đó.")
                  : t("edgeResolution.stopDialogDesc", "Lệnh DỪNG này đã bị từ chối hoặc thất bại — nó KHÔNG được thực thi tự động nữa. Chỉ ghi nhận khi thiết bị đã được dừng bằng cách khác và đã kiểm tra tại chỗ. Thao tác được kiểm toán kèm lý do; lệnh vẫn hiển thị là 'đã xử lý bởi người'.")}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="edge-resolution-reason">
                {t("edgeResolution.reasonLabel", "Lý do / cách đã xử lý (bắt buộc, ít nhất 3 ký tự)")}
              </label>
              <Textarea id="edge-resolution-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={pending}>{t("common.cancel", "Hủy")}</AlertDialogCancel>
              <AlertDialogAction
                disabled={reason.trim().length < 3 || pending || !target || !props.canResolve}
                onClick={(e) => {
                  e.preventDefault();
                  if (!target) return;
                  if (target.kind === "stop") resolveStopM.mutate({ requestId: target.item.requestId, resolution: reason.trim() });
                  else resolveIntentM.mutate({ intentId: target.item.intentId, reason: reason.trim() });
                }}
              >
                {t("edgeResolution.confirm", "Xác nhận và ghi kiểm toán")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
