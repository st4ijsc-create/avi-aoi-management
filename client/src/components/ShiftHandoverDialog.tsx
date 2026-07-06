/**
 * ShiftHandoverDialog — doc 35 Wave W4-E, task 1.
 *
 * The FIRST client surface to actually call `productionSession.handover`. The
 * backend procedure (fromSessionId → toSessionId + handoverNotes, requirePermission
 * production_orders.canEdit) existed since W0.3c but no UI ever invoked it.
 *
 * Flow: pick the OUTGOING session (or it is pre-selected), pick the INCOMING
 * session it hands over to, write handover notes → one call records the link +
 * notes on the outgoing session. The receiving session then shows those notes.
 *
 * Write is disabled (and a hint shown) when the user lacks
 * production_orders.canEdit — the same permission the server enforces.
 */
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { usePermissions } from "@/_core/hooks/usePermissions";
import { toast } from "sonner";
import { ArrowRightLeft, ShieldAlert } from "lucide-react";

interface SessionLike {
  id: number;
  sessionCode?: string | null;
  shiftDate?: string | Date | null;
  operatorId?: number | null;
  status?: string | null;
}

export interface ShiftHandoverDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-selected outgoing session; when set, the "from" picker is locked. */
  fromSession?: SessionLike | null;
  /** Called after a successful handover so callers can refetch their lists. */
  onDone?: () => void;
}

function sessionLabel(s: SessionLike): string {
  const code = s.sessionCode ?? `#${s.id}`;
  const date = s.shiftDate ? new Date(s.shiftDate).toLocaleDateString() : "";
  return date ? `${code} · ${date}` : code;
}

export function ShiftHandoverDialog({ open, onOpenChange, fromSession, onDone }: ShiftHandoverDialogProps) {
  const { t } = useTranslation();
  const { hasPermission } = usePermissions();
  const canHandover = hasPermission("production_orders", "canEdit");

  // Candidate sessions to hand over between: open + paused are still "live".
  const openQ = trpc.productionSession.list.useQuery({ status: "open", limit: 200 }, { enabled: open });
  const pausedQ = trpc.productionSession.list.useQuery({ status: "paused", limit: 200 }, { enabled: open });

  const sessions = useMemo<SessionLike[]>(() => {
    const map = new Map<number, SessionLike>();
    for (const s of (openQ.data ?? []) as SessionLike[]) map.set(s.id, s);
    for (const s of (pausedQ.data ?? []) as SessionLike[]) map.set(s.id, s);
    if (fromSession) map.set(fromSession.id, fromSession);
    return Array.from(map.values());
  }, [openQ.data, pausedQ.data, fromSession]);

  const [fromId, setFromId] = useState<number | null>(fromSession?.id ?? null);
  const [toId, setToId] = useState<number | null>(null);
  const [notes, setNotes] = useState("");

  // Reset when (re)opened or the pre-selected session changes.
  useEffect(() => {
    if (open) {
      setFromId(fromSession?.id ?? null);
      setToId(null);
      setNotes("");
    }
  }, [open, fromSession?.id]);

  const handover = trpc.productionSession.handover.useMutation({
    onSuccess: () => {
      toast.success(t("handover.success", "Đã bàn giao ca — ghi chú đã lưu vào phiên nhận"));
      onDone?.();
      onOpenChange(false);
    },
    onError: (e) => toast.error(e.message),
  });

  const submit = () => {
    if (!fromId || !toId) {
      toast.error(t("handover.pickBoth", "Chọn cả phiên bàn giao và phiên nhận"));
      return;
    }
    if (fromId === toId) {
      toast.error(t("handover.notSame", "Phiên bàn giao và phiên nhận phải khác nhau"));
      return;
    }
    if (notes.trim().length < 1) {
      toast.error(t("handover.notesRequired", "Nhập ghi chú bàn giao"));
      return;
    }
    handover.mutate({ fromSessionId: fromId, toSessionId: toId, handoverNotes: notes.trim() });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowRightLeft className="h-5 w-5" /> {t("handover.title", "Bàn giao ca")}
          </DialogTitle>
          <DialogDescription>
            {t("handover.description", "Ghi lại việc chuyển giao trách nhiệm giữa ca đi và ca đến. Ghi chú sẽ hiển thị trên phiên nhận.")}
          </DialogDescription>
        </DialogHeader>

        {!canHandover && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            <ShieldAlert className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{t("handover.noPermission", "Bạn không có quyền bàn giao (cần production_orders · canEdit).")}</span>
          </div>
        )}

        <div className="space-y-3">
          <div className="space-y-1">
            <Label>{t("handover.fromSession", "Phiên bàn giao (ca đi)")}</Label>
            <Select
              value={fromId != null ? String(fromId) : undefined}
              onValueChange={(v) => setFromId(Number(v))}
              disabled={!!fromSession}
            >
              <SelectTrigger><SelectValue placeholder={t("handover.selectSession", "Chọn phiên…")} /></SelectTrigger>
              <SelectContent>
                {sessions.map((s) => (
                  <SelectItem key={s.id} value={String(s.id)}>{sessionLabel(s)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label>{t("handover.toSession", "Phiên nhận (ca đến)")}</Label>
            <Select value={toId != null ? String(toId) : undefined} onValueChange={(v) => setToId(Number(v))}>
              <SelectTrigger><SelectValue placeholder={t("handover.selectSession", "Chọn phiên…")} /></SelectTrigger>
              <SelectContent>
                {sessions.filter((s) => s.id !== fromId).map((s) => (
                  <SelectItem key={s.id} value={String(s.id)}>{sessionLabel(s)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label>{t("handover.notes", "Ghi chú bàn giao")}</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
              placeholder={t("handover.notesPlaceholder", "Tình trạng máy, việc đang dở, cảnh báo cho ca sau…")}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t("common.cancel", "Hủy")}</Button>
          <Button onClick={submit} disabled={!canHandover || handover.isPending}>
            <ArrowRightLeft className="h-4 w-4 mr-2" />
            {handover.isPending ? t("handover.submitting", "Đang bàn giao…") : t("handover.submit", "Bàn giao ca")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ShiftHandoverDialog;
