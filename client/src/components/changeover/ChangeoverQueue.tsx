/**
 * doc 63 DEP-08 (FLW-03) — Hàng đợi ĐỔI MODEL duyệt 2-người, nhúng trong ProductChangeoverWizard.
 *
 *   • Operator (machine_monitoring/canView): chọn recipe (changeover.recipeOptions — catalog
 *     metadata, không payload) → GỬI YÊU CẦU (changeover.request — INERT, chỉ 1 hàng DB) và
 *     theo dõi "Yêu cầu của tôi" (listMine).
 *   • Người duyệt (machine_control/canEdit + actuation 2FA): thấy thêm hàng đợi PENDING
 *     (changeover.list) với Duyệt (SoD approver≠requester; lỗi 2FA/SoD hiện nguyên văn qua
 *     toast — server là tường thật) và Từ chối (bắt lý do ≥3 ký tự).
 *   • Với người KHÔNG có quyền duyệt, query list bị FORBIDDEN → panel duyệt tự ẨN (retry:false,
 *     không toast — đây là phân quyền bình thường, không phải lỗi).
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ClipboardCheck, Send } from "lucide-react";

function StatusChip({ status }: { status: string }) {
  const variant =
    status === "approved" ? "default" : status === "rejected" ? "destructive" : "secondary";
  return <Badge variant={variant} className="text-[11px] capitalize">{status}</Badge>;
}

export function ChangeoverQueue({ machineId }: { machineId: number | undefined }) {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const [recipeId, setRecipeId] = useState<number | undefined>();
  const [note, setNote] = useState("");
  const [rejectReason, setRejectReason] = useState("");

  const options = trpc.machineRecipe.changeover.recipeOptions.useQuery(
    { machineId: machineId! },
    { enabled: !!machineId, retry: false, refetchOnWindowFocus: false },
  );
  const mine = trpc.machineRecipe.changeover.listMine.useQuery(
    { limit: 10 },
    { retry: false, refetchOnWindowFocus: false },
  );
  // Panel duyệt: FORBIDDEN với người không có machine_control → tự ẩn (không phải lỗi).
  const pending = trpc.machineRecipe.changeover.list.useQuery(
    { status: "pending", limit: 50 },
    { retry: false, refetchOnWindowFocus: false },
  );

  const invalidate = () => {
    void utils.machineRecipe.changeover.listMine.invalidate();
    void utils.machineRecipe.changeover.list.invalidate();
  };

  const requestM = trpc.machineRecipe.changeover.request.useMutation({
    onSuccess: () => {
      toast.success(t("changeover.requested", "Đã gửi yêu cầu đổi model — chờ người khác duyệt."));
      setNote("");
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const approveM = trpc.machineRecipe.changeover.approve.useMutation({
    onSuccess: () => {
      toast.success(t("changeover.approved", "Đã duyệt — recipe được triển khai (ledger)."));
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const rejectM = trpc.machineRecipe.changeover.reject.useMutation({
    onSuccess: () => {
      toast.success(t("changeover.rejected", "Đã từ chối yêu cầu."));
      setRejectReason("");
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const canShowApprover = pending.isSuccess;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ClipboardCheck className="h-4 w-4" />
          {t("changeover.queueTitle", "Đổi model — duyệt 2 người")}
        </CardTitle>
        <CardDescription>
          {t(
            "changeover.queueDesc",
            "Gửi yêu cầu đổi recipe cho máy; người có quyền (khác bạn) duyệt mới thi hành. Chỉ ghi sổ (ledger) — không đẩy lệnh xuống máy.",
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* ── Gửi yêu cầu (operator-level) ── */}
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-56 flex-1">
            <div className="pb-1 text-xs text-muted-foreground">{t("changeover.recipe", "Recipe")}</div>
            <Select
              value={recipeId != null ? String(recipeId) : ""}
              onValueChange={(v) => setRecipeId(Number(v))}
              disabled={!machineId || options.isLoading}
            >
              <SelectTrigger>
                <SelectValue placeholder={machineId ? t("changeover.pickRecipe", "Chọn recipe…") : t("changeover.pickMachineFirst", "Chọn máy trước")} />
              </SelectTrigger>
              <SelectContent>
                {(options.data ?? []).map((r) => (
                  <SelectItem key={r.id} value={String(r.id)}>
                    {r.code} v{r.version} — {r.name}
                    {r.approvedBy == null ? ` (${t("changeover.notApproved", "chưa second-approve")})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-48 flex-1">
            <div className="pb-1 text-xs text-muted-foreground">{t("changeover.note", "Ghi chú")}</div>
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("changeover.notePh", "Lý do / ca / đơn hàng…")} />
          </div>
          <Button
            disabled={!machineId || !recipeId || requestM.isPending}
            onClick={() => machineId && recipeId && requestM.mutate({ machineId, recipeId, note: note || undefined })}
          >
            <Send className="mr-1 h-4 w-4" />
            {t("changeover.send", "Gửi yêu cầu")}
          </Button>
        </div>

        {/* ── Yêu cầu của tôi ── */}
        {(mine.data?.length ?? 0) > 0 && (
          <div>
            <div className="pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t("changeover.mine", "Yêu cầu của tôi")}
            </div>
            <div className="space-y-1">
              {mine.data!.map((r) => (
                <div key={r.id} className="flex flex-wrap items-center gap-2 rounded-md border px-2 py-1.5 text-sm">
                  <StatusChip status={r.status} />
                  <span className="font-mono text-xs">{r.machineCode ?? r.machineId}</span>
                  <span>{r.recipeCode} v{r.recipeVersion}</span>
                  {r.decisionNote && <span className="text-xs text-muted-foreground">— {r.decisionNote}</span>}
                  <span className="ml-auto font-mono text-[11px] text-muted-foreground">
                    {r.createdAt ? new Date(r.createdAt as unknown as string).toLocaleString() : ""}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Hàng đợi duyệt (chỉ hiện khi có quyền machine_control) ── */}
        {canShowApprover && (
          <div>
            <div className="pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t("changeover.pendingQueue", "Hàng đợi chờ duyệt")}
            </div>
            {(pending.data?.length ?? 0) === 0 ? (
              <span className="text-sm text-muted-foreground">{t("changeover.empty", "Không có yêu cầu chờ.")}</span>
            ) : (
              <div className="space-y-1.5">
                <Input
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder={t("changeover.rejectPh", "Lý do từ chối (bắt buộc khi Từ chối, ≥3 ký tự)")}
                />
                {pending.data!.map((r) => (
                  <div key={r.id} className="flex flex-wrap items-center gap-2 rounded-md border px-2 py-1.5 text-sm">
                    <span className="font-mono text-xs">#{r.id}</span>
                    <span className="font-mono text-xs">{r.machineCode ?? r.machineId}</span>
                    <span>{r.recipeCode} v{r.recipeVersion}</span>
                    {r.recipeStatus !== "active" && r.recipeStatus != null && (
                      <Badge variant="outline" className="text-[10px]">{String(r.recipeStatus)}</Badge>
                    )}
                    {r.requestNote && <span className="text-xs text-muted-foreground">— {r.requestNote}</span>}
                    <div className="ml-auto flex gap-1.5">
                      <Button
                        size="sm"
                        disabled={approveM.isPending}
                        onClick={() => approveM.mutate({ id: r.id })}
                      >
                        {t("changeover.approve", "Duyệt")}
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={rejectM.isPending || rejectReason.trim().length < 3}
                        onClick={() => rejectM.mutate({ id: r.id, note: rejectReason.trim() })}
                      >
                        {t("changeover.reject", "Từ chối")}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default ChangeoverQueue;
