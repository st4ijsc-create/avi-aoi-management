/**
 * OperatorSessionControl — doc 35 Wave W4-E, task 2.
 *
 * Turns OperatorHome from a report/glance console into a real operator terminal:
 * CLOCK-IN opens a production session (productionSession.open — pick shift + line)
 * and, while a session is open, PAUSE / RESUME / CLOSE it (productionSession
 * pause/resume/close). Before W4-E no client ever called open/close, so an
 * operator could not actually start or stop a shift session from the terminal.
 *
 * Kiosk-friendly: one big status card + big touch buttons. All writes hit the
 * W0.3c-gated procedures (open ⇒ production_orders.canCreate; pause/resume/close ⇒
 * canEdit). The UI disables clock-in when the operator lacks canCreate.
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { usePermissions } from "@/_core/hooks/usePermissions";
import { toast } from "sonner";
import { LogIn, Pause, Play, Square, Clock, ShieldAlert } from "lucide-react";

/** Compute planned start/end ISO strings for a shift config applied to today. */
function plannedWindow(shift: { startHour: number; startMinute?: number | null; endHour: number; endMinute?: number | null }) {
  const now = new Date();
  const start = new Date(now);
  start.setHours(shift.startHour, shift.startMinute ?? 0, 0, 0);
  const end = new Date(now);
  end.setHours(shift.endHour, shift.endMinute ?? 0, 0, 0);
  // Overnight shift → end rolls to next day.
  if (end.getTime() <= start.getTime()) end.setDate(end.getDate() + 1);
  const shiftDate = new Date(now);
  shiftDate.setHours(0, 0, 0, 0);
  return { shiftDate: shiftDate.toISOString(), plannedStart: start.toISOString(), plannedEnd: end.toISOString() };
}

export default function OperatorSessionControl() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { hasPermission } = usePermissions();
  const canOpen = hasPermission("production_session", "canCreate");
  const canEdit = hasPermission("production_session", "canEdit");
  const operatorId = (user as any)?.id as number | undefined;

  const utils = trpc.useUtils();
  const openQ = trpc.productionSession.list.useQuery(
    { status: "open", limit: 100 },
    { refetchInterval: 60_000, refetchOnWindowFocus: false },
  );
  const pausedQ = trpc.productionSession.list.useQuery(
    { status: "paused", limit: 100 },
    { refetchInterval: 60_000, refetchOnWindowFocus: false },
  );

  // The operator's current live session (open first, else paused). Falls back to
  // any live session when the row has no operatorId match (best-effort terminal).
  const mySession = useMemo(() => {
    const live = [...(openQ.data ?? []), ...(pausedQ.data ?? [])] as any[];
    if (live.length === 0) return null;
    const mine = operatorId != null ? live.filter((s) => s.operatorId === operatorId) : live;
    const pool = mine.length > 0 ? mine : live;
    return pool.sort((a, b) => new Date(b.actualStart).getTime() - new Date(a.actualStart).getTime())[0] ?? null;
  }, [openQ.data, pausedQ.data, operatorId]);

  const [clockInOpen, setClockInOpen] = useState(false);
  const [shiftId, setShiftId] = useState<number | null>(null);
  const [lineId, setLineId] = useState<number | null>(null);

  const shifts = trpc.shiftConfig.list.useQuery(undefined, { enabled: clockInOpen });
  const lines = trpc.line.list.useQuery(undefined, { enabled: clockInOpen });
  const workshops = trpc.workshop.list.useQuery(undefined, { enabled: clockInOpen });

  const refetchLive = () => { openQ.refetch(); pausedQ.refetch(); utils.productionSession.list.invalidate(); };

  const openMut = trpc.productionSession.open.useMutation({
    onSuccess: () => {
      toast.success(t("opSession.clockedIn", "Đã vào ca — phiên sản xuất đã mở"));
      setClockInOpen(false);
      setShiftId(null); setLineId(null);
      refetchLive();
    },
    onError: (e) => toast.error(e.message),
  });
  const pauseMut = trpc.productionSession.pause.useMutation({
    onSuccess: () => { toast.success(t("opSession.paused", "Đã tạm dừng phiên")); refetchLive(); },
    onError: (e) => toast.error(e.message),
  });
  const resumeMut = trpc.productionSession.resume.useMutation({
    onSuccess: () => { toast.success(t("opSession.resumed", "Đã tiếp tục phiên")); refetchLive(); },
    onError: (e) => toast.error(e.message),
  });
  const closeMut = trpc.productionSession.close.useMutation({
    onSuccess: () => { toast.success(t("opSession.closed", "Đã kết thúc ca — phiên đã đóng")); refetchLive(); },
    onError: (e) => toast.error(e.message),
  });

  const doClockIn = () => {
    if (!shiftId || !lineId) { toast.error(t("opSession.pickShiftLine", "Chọn ca và dây chuyền")); return; }
    if (operatorId == null) { toast.error(t("opSession.noUser", "Không xác định được người dùng")); return; }
    const shift = (shifts.data ?? []).find((s: any) => s.id === shiftId);
    const line = (lines.data ?? []).find((l: any) => l.id === lineId);
    if (!shift || !line) { toast.error(t("opSession.pickShiftLine", "Chọn ca và dây chuyền")); return; }
    const workshop = (workshops.data ?? []).find((w: any) => w.id === (line as any).workshopId);
    if (!workshop) { toast.error(t("opSession.noWorkshop", "Không tìm thấy nhà xưởng của dây chuyền")); return; }
    const win = plannedWindow(shift as any);
    openMut.mutate({
      shiftConfigId: shiftId,
      factoryId: (workshop as any).factoryId,
      workshopId: (workshop as any).id,
      lineId,
      operatorId,
      shiftDate: win.shiftDate,
      plannedStart: win.plannedStart,
      plannedEnd: win.plannedEnd,
    });
  };

  const busy = pauseMut.isPending || resumeMut.isPending || closeMut.isPending;
  const bigBtn = "min-h-[64px] flex-1 text-base font-bold";

  return (
    <Card className="border-2">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Clock className="h-5 w-5" /> {t("opSession.title", "Ca làm việc")}
        </CardTitle>
        <CardDescription>
          {mySession
            ? t("opSession.current", "Phiên hiện tại: {{code}}", { code: mySession.sessionCode })
            : t("opSession.none", "Chưa vào ca — chạm để bắt đầu phiên sản xuất")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {mySession ? (
          <>
            <div className="flex items-center gap-2 text-sm">
              <Badge variant={mySession.status === "open" ? "default" : "secondary"} className="text-sm">
                {mySession.status === "open" ? t("opSession.running", "Đang chạy") : t("opSession.pausedState", "Tạm dừng")}
              </Badge>
              <span className="text-muted-foreground">
                {t("opSession.since", "Từ {{time}}", { time: new Date(mySession.actualStart).toLocaleTimeString() })}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {mySession.status === "open" ? (
                <Button variant="outline" className={bigBtn} disabled={!canEdit || busy}
                  onClick={() => pauseMut.mutate({ id: mySession.id })}>
                  <Pause className="h-5 w-5 mr-2" /> {t("opSession.pause", "Tạm dừng")}
                </Button>
              ) : (
                <Button variant="outline" className={bigBtn} disabled={!canEdit || busy}
                  onClick={() => resumeMut.mutate({ id: mySession.id })}>
                  <Play className="h-5 w-5 mr-2" /> {t("opSession.resume", "Tiếp tục")}
                </Button>
              )}
              <Button variant="destructive" className={bigBtn} disabled={!canEdit || busy}
                onClick={() => closeMut.mutate({ id: mySession.id })}>
                <Square className="h-5 w-5 mr-2" /> {t("opSession.close", "Kết thúc ca")}
              </Button>
            </div>
            {!canEdit && (
              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                <ShieldAlert className="h-3 w-3" /> {t("opSession.noEdit", "Bạn chưa được cấp quyền tạm dừng/kết thúc ca — liên hệ giám sát để cấp quyền phiên sản xuất.")}
              </p>
            )}
          </>
        ) : (
          <>
            <Button
              className="min-h-[80px] w-full text-lg font-bold"
              disabled={!canOpen}
              onClick={() => setClockInOpen(true)}
            >
              <LogIn className="h-6 w-6 mr-2" /> {t("opSession.clockIn", "Vào ca")}
            </Button>
            {!canOpen && (
              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                <ShieldAlert className="h-3 w-3" /> {t("opSession.noCreate", "Bạn chưa được cấp quyền vào ca — liên hệ giám sát để cấp quyền phiên sản xuất.")}
              </p>
            )}
          </>
        )}
      </CardContent>

      {/* Clock-in dialog: pick shift + line, open a session */}
      <Dialog open={clockInOpen} onOpenChange={setClockInOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <LogIn className="h-5 w-5" /> {t("opSession.clockIn", "Vào ca")}
            </DialogTitle>
            <DialogDescription>
              {t("opSession.clockInDesc", "Chọn ca và dây chuyền để mở phiên sản xuất mới.")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>{t("opSession.shift", "Ca")}</Label>
              <Select value={shiftId != null ? String(shiftId) : undefined} onValueChange={(v) => setShiftId(Number(v))}>
                <SelectTrigger><SelectValue placeholder={t("opSession.selectShift", "Chọn ca…")} /></SelectTrigger>
                <SelectContent>
                  {(shifts.data ?? []).map((s: any) => (
                    <SelectItem key={s.id} value={String(s.id)}>{s.name} ({s.code})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>{t("opSession.line", "Dây chuyền")}</Label>
              <Select value={lineId != null ? String(lineId) : undefined} onValueChange={(v) => setLineId(Number(v))}>
                <SelectTrigger><SelectValue placeholder={t("opSession.selectLine", "Chọn dây chuyền…")} /></SelectTrigger>
                <SelectContent>
                  {(lines.data ?? []).map((l: any) => (
                    <SelectItem key={l.id} value={String(l.id)}>{l.name} ({l.code})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setClockInOpen(false)}>{t("common.cancel", "Hủy")}</Button>
            <Button onClick={doClockIn} disabled={!canOpen || openMut.isPending || !shiftId || !lineId}>
              <LogIn className="h-4 w-4 mr-2" />
              {openMut.isPending ? t("opSession.clockingIn", "Đang vào ca…") : t("opSession.clockIn", "Vào ca")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
