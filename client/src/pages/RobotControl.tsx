/**
 * P4 (audit H / doc 12 §6) — ROBOT CONTROL surface (read-mostly + honest safety gate).
 *
 * Surfaces the Phase-3 robotRouter: registry list, per-robot telemetry, and the
 * append-only motion-job log. ENG-F15 (doc 40): this page is now purely a REGISTRY /
 * observation surface — the dead in-page "command panel" (text-only, no dispatch) is
 * removed. Issuing a single gated robot command lives on /command-console (the first UI
 * that actually calls robot.actuate → robotCommandDispatcher, HITL-confirmed + dry-run +
 * idempotency). "Điều khiển" per row and the header button route there; legacy deep-links
 * that carried ?command= are forwarded to the console. The job log stays here (status:
 * simulated / hitl / rejected …) and the UI never implies a real motion happened.
 *
 * RBAC: writes on the robot registry are adminProcedure (admin only). Read-only roles
 * see a ViewOnlyBadge and disabled controls. Registry create/edit/delete live on the
 * existing admin/master-data flows — here we keep enable-toggle + read-only connection
 * test (the only non-motion, admin-gated mutations the router exposes).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useSearch } from "wouter";
import { trpc } from "@/lib/trpc";
import { withParams } from "@/lib/engineeringDeepLink";
import { usePermissions } from "@/_core/hooks/usePermissions";
import { useActuationReadiness } from "@/hooks/useActuationReadiness";
import { canClearMotionLock, motionLockClearBlocked, motionLockReasonText, motionLockTipText, type PanelMotionLock } from "@/lib/robotMotionLock";
import EdgeResolutionPanel from "@/components/edge/EdgeResolutionPanel";
import DashboardLayout from "@/components/DashboardLayout";
import { ViewOnlyBadge } from "@/components/PermissionGate";
import { PageHeader, PageContainer, StatusBadge } from "@/components/patterns";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Bot, RefreshCw, ShieldAlert, Plug, Activity, AlertTriangle, CheckCircle2, CircleSlash, ExternalLink,
  Send, Unlock, Lock, PowerOff, Power,
} from "lucide-react";
import { toast } from "sonner";
import { toastTrpcError } from "@/lib/trpcErrors";

// doc 81 Đợt 1B Task 5 fix round 4 (R13) — trạng thái sống do robotRouter.list gắn kèm: kết nối
// của tiến trình + KHOÁ CHUYỂN ĐỘNG (đặt sau rớt kết nối / kết cục lệnh không rõ; chỉ STOP được xác
// nhận hoặc thao tác gỡ có kiểm soát mới mở). `active=false` = cổng robot chưa nạp robot này.
type RobotLive = {
  active: boolean;
  connected: boolean;
  motionLock: { locked: boolean; reasonCode?: string; since?: string; detail?: string; generation?: number; persisted?: boolean } | null;
};

type RobotRow = {
  id: number;
  code: string;
  name: string;
  vendor: string;
  model?: string | null;
  kind: string;
  endpoint: string;
  isEnabled: boolean;
  status: string;
  lastSeenAt?: string | Date | null;
  live?: RobotLive;
  /** doc 81 Đợt 7 I5 — the per-robot automation switch ("unknown" = unreadable: the server refuses automation then). */
  automation?: "on" | "off" | "unknown";
};

function fmt(v?: string | Date | null): string {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

function jobStatusBadge(status: string, t: (k: string, f: string) => string) {
  switch (status) {
    case "done":
      return <StatusBadge status={status} tone="success" label={t("robot.job.done", "Hoàn tất")} />;
    case "running":
      return <StatusBadge status={status} tone="info" label={t("robot.job.running", "Đang chạy")} />;
    case "failed":
      return <StatusBadge status={status} tone="error" label={t("robot.job.failed", "Lỗi")} />;
    case "rejected":
      return <StatusBadge status={status} tone="error" label={t("robot.job.rejected", "Từ chối")} />;
    case "confirmed":
    case "pending":
      return <StatusBadge status={status} tone="warning" label={t("robot.job.pending", "Chờ xác nhận")} />;
    case "simulated":
    default:
      return <StatusBadge status={status} tone="default" label={t("robot.job.simulated", "Mô phỏng")} />;
  }
}

export default function RobotControl() {
  const { t } = useTranslation();
  // doc 81 Đợt 4 Task B4 — a lock restored as `persistUnknown` (saved lock unreadable at startup) gets a sentence, not a code.
  // doc 81 Đợt 12 N fix 1 (M-4) — the reason in words (vi/en/zh): persistUnknown, and ownerChanged told apart by WHO can clear it
  // (a lock held only in the DB is not cleared by a STOP); any other code as is.
  const lockReason = (lock: PanelMotionLock): string => {
    if (lock?.reasonCode === "persistUnknown") {
      return t("robot.motionLock.reason.persistUnknown", "không đọc được khoá đã lưu lúc khởi động (CSDL không trả lời) — khoá để an toàn");
    }
    const x = motionLockReasonText(lock);
    return x ? t(x.key, x.defaultValue) : (lock?.reasonCode ?? "link loss");
  };
  const [, setLocation] = useLocation();
  const search = useSearch();
  const { hasPermission, isAdmin } = usePermissions();
  // doc 40 ENG-F3 — bỏ hardgate role==='admin'. Bật/tắt thiết bị + test kết nối là hành
  // vi điều khiển OT → gate theo permission bit machine_control/canEdit (admin bypass sẵn
  // trong hasPermission). Engineer/supervisor có machine_control giờ không bị khóa oan.
  const canControl = hasPermission("machine_control", "canEdit");
  // Fix round 5 (item 3) — robot.clearMotionLock is actuationProcedure (admin/supervisor/engineer)
  // + machine_control/canEdit: gate the button on BOTH so nobody sees an enabled button that ends
  // in FORBIDDEN. Advisory only; the server stays the wall.
  const { role: actuationRole } = useActuationReadiness();
  const canClearLock = canClearMotionLock(actuationRole, canControl);
  // doc 81 Đợt 10 F2 (R-10-af / R-10-ax) — resolving a refused STOP / an orphaned write intent is admin / supervisor (+ 2FA)
  // AND machine_control/canEdit on the server (edgeResolution.*): hide the buttons that would end in FORBIDDEN.
  const canResolveEdge = canControl && (actuationRole === "admin" || actuationRole === "supervisor");
  // doc 54 Wave B — the enable-toggle + connection-test SERVER procedures (setEnabled/
  // testConnection) are adminProcedure (admin-only), so a non-admin with machine_control
  // would see the affordance but hit a 403. Gate THESE two controls on isAdmin to match the
  // server; the other affordances (Command Console / Điều khiển / Cockpit) stay on canControl.

  // Deep-link params. `?robotId=` auto-focuses the row (still useful). `?command=` is a
  // LEGACY shape (cockpit Propose now targets /command-console directly) — we forward it
  // to the console below rather than reviving a dead in-page command panel (ENG-F15).
  const deepLink = useMemo(() => {
    const p = new URLSearchParams(search);
    const rid = p.get("robotId");
    const cmd = p.get("command");
    const ridNum = rid != null && rid.trim() !== "" && Number.isFinite(Number(rid)) ? Number(rid) : null;
    return { robotId: ridNum, command: cmd != null && cmd.trim() !== "" ? cmd : null };
  }, [search]);

  const utils = trpc.useUtils();
  // Fix round 4 — `live` (kết nối + khoá chuyển động) đổi theo thời gian ⇒ làm mới định kỳ.
  const listQ = trpc.robot.list.useQuery(undefined, { refetchInterval: 10_000 });
  const robots = (listQ.data ?? []) as RobotRow[];

  // Fix round 4 (R13) — hộp thoại xác nhận gỡ khoá chuyển động (lý do bắt buộc, ghi audit ở server).
  const [clearTarget, setClearTarget] = useState<RobotRow | null>(null);
  const [clearReason, setClearReason] = useState("");
  const clearLockM = trpc.robot.clearMotionLock.useMutation({
    onSuccess: (r, vars) => {
      const code = robots.find((x) => x.id === vars.robotId)?.code ?? String(vars.robotId);
      if (r.changed) toast.success(t("robot.motionLock.cleared", { defaultValue: "Đã gỡ khoá chuyển động cho {{code}}", code }));
      else toast.info(t("robot.motionLock.notLocked", { defaultValue: "Robot {{code}} không bị khoá chuyển động", code }));
      setClearTarget(null);
      setClearReason("");
      void utils.robot.list.invalidate();
    },
    onError: (e) => {
      toastTrpcError(e);
      // Fix round 5 (item 2) — a CONFLICT means the lock changed under the dialog: close it and
      // re-read, so the operator decides about the CURRENT state, never the one they first saw.
      setClearTarget(null);
      setClearReason("");
      void utils.robot.list.invalidate();
    },
  });

  // doc 81 Đợt 7 task I5 — per-robot automation switch (VDA5050 / ROS2 self-grant). Turning it OFF only withholds motion:
  // machine_control/canEdit is enough; turning it back ON needs the actuation floor (admin/supervisor/engineer) too. A
  // reason is required either way (the server writes the audit row before the change). STOPs are never affected.
  const [autoTarget, setAutoTarget] = useState<{ robot: RobotRow; enable: boolean } | null>(null);
  const [autoReason, setAutoReason] = useState("");
  const canEnableAutomation = canClearLock; // same floor: actuation role + machine_control/canEdit
  const autoDone = {
    onSuccess: (r: { robotId: number; automation: string }) => {
      const code = robots.find((x) => x.id === r.robotId)?.code ?? String(r.robotId);
      if (r.automation === "off") toast.success(t("robot.automation.turnedOff", { defaultValue: "Đã TẮT tự động hoá cho {{code}}", code }));
      else toast.success(t("robot.automation.turnedOn", { defaultValue: "Đã BẬT lại tự động hoá cho {{code}}", code }));
      setAutoTarget(null);
      setAutoReason("");
      void utils.robot.list.invalidate();
    },
    onError: (e: unknown) => {
      toastTrpcError(e);
      void utils.robot.list.invalidate();
    },
  };
  const disableAutoM = trpc.robot.disableAutomation.useMutation(autoDone);
  const enableAutoM = trpc.robot.enableAutomation.useMutation(autoDone);
  const autoPending = disableAutoM.isPending || enableAutoM.isPending;

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const selected = useMemo(
    () => robots.find((r) => r.id === selectedId) ?? robots[0] ?? null,
    [robots, selectedId],
  );
  const activeId = selected?.id ?? null;

  // Auto-focus the deep-linked robot once it exists in the loaded registry.
  // Guard by applied-id so a periodic list refetch never fights a manual selection.
  const appliedDeepLinkIdRef = useRef<number | null>(null);
  useEffect(() => {
    if (deepLink.robotId == null) return;
    if (appliedDeepLinkIdRef.current === deepLink.robotId) return;
    if (robots.some((r) => r.id === deepLink.robotId)) {
      setSelectedId(deepLink.robotId);
      appliedDeepLinkIdRef.current = deepLink.robotId;
    }
  }, [deepLink.robotId, robots]);

  // ENG-F15 — điều khiển thật đã chuyển sang /command-console. Chuyển tiếp deep-link cũ
  // mang ?command= (vd từ liên kết Propose cũ) sang console, giữ robotId + command, thay
  // vì hiển thị bảng lệnh chết ở trang này.
  useEffect(() => {
    if (deepLink.command != null) {
      setLocation(withParams("/command-console", { robotId: deepLink.robotId, command: deepLink.command }), { replace: true });
    }
  }, [deepLink.command, deepLink.robotId, setLocation]);

  const telemetryQ = trpc.robot.telemetry.useQuery(
    { robotId: activeId ?? 0, limit: 20 },
    { enabled: activeId != null },
  );
  const jobsQ = trpc.robot.jobs.useQuery(
    { robotId: activeId ?? 0, limit: 50 },
    { enabled: activeId != null },
  );

  const latestTelemetry = (telemetryQ.data ?? [])[0] as
    | { mode?: string | null; busy?: boolean | null; estop?: boolean | null; speedPct?: number | null; errorText?: string | null; timestamp?: string | Date }
    | undefined;

  const setEnabledM = trpc.robot.setEnabled.useMutation({
    onSuccess: () => {
      toast.success(t("robot.toastEnabled", "Đã cập nhật trạng thái bật/tắt robot"));
      void utils.robot.list.invalidate();
    },
    onError: (e) => toastTrpcError(e),
  });

  const testM = trpc.robot.testConnection.useMutation({
    onSuccess: (r) => {
      if (r?.ok) toast.success(t("robot.testOk", "Kết nối OK (chỉ đọc trạng thái, không có chuyển động)"));
      else toast.error(r?.error ?? t("robot.testFail", "Kết nối thất bại"));
    },
    onError: (e) => toastTrpcError(e),
  });

  return (
    <DashboardLayout>
      <PageContainer className="space-y-4">
        <PageHeader
          icon={<Bot className="h-6 w-6" />}
          title={t("robot.title", "Điều khiển Robot")}
          badge={!canControl ? <ViewOnlyBadge /> : undefined}
          description={t("robot.subtitle", "Theo dõi robot/AGV: registry, telemetry, nhật ký lệnh — chuyển động luôn qua HITL/dry-run")}
          actions={
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={!canControl}
                onClick={() => setLocation(withParams("/command-console", { robotId: activeId }))}
                title={!canControl ? t("robot.controlPermRequired", "Cần quyền điều khiển máy (machine_control)") : t("robot.openConsoleTip", "Mở Command Console để phát lệnh có gate (HITL + dry-run)")}
              >
                <Send className="mr-1 h-4 w-4" /> {t("robot.commandConsole", "Command Console")}
              </Button>
              <Button size="icon" variant="ghost" onClick={() => void listQ.refetch()} title={t("common.refresh", "Làm mới")}>
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
          }
        />

        {/* Safety banner — honest about the gate (always shown) */}
        <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <span>
            {t(
              "robot.safetyBanner",
              "An toàn: lệnh chuyển động KHÔNG được phát từ giao diện này. Mọi lệnh đi qua bộ điều phối nội bộ (xác nhận con người HITL + mô phỏng/dry-run + khoá idempotency). Robot chưa bật (disabled) sẽ không bao giờ chuyển động thật.",
            )}
          </span>
        </div>

        {/* Registry */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{t("robot.registry", "Danh sách Robot")}</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("robot.colCode", "Mã")}</TableHead>
                  <TableHead>{t("robot.colName", "Tên")}</TableHead>
                  <TableHead>{t("robot.colVendor", "Hãng")}</TableHead>
                  <TableHead>{t("robot.colKind", "Loại")}</TableHead>
                  <TableHead>{t("robot.colEnabled", "Cho phép")}</TableHead>
                  <TableHead>{t("robot.colStatus", "Trạng thái")}</TableHead>
                  <TableHead>{t("robot.colLastSeen", "Lần cuối")}</TableHead>
                  <TableHead className="text-right">{t("common.actions", "Thao tác")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {robots.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-sm text-muted-foreground">
                      {t("robot.empty", "Chưa có robot nào được đăng ký.")}
                    </TableCell>
                  </TableRow>
                )}
                {robots.map((r) => (
                  <TableRow
                    key={r.id}
                    className={`cursor-pointer ${activeId === r.id ? "bg-muted/50" : ""}`}
                    onClick={() => setSelectedId(r.id)}
                  >
                    <TableCell className="font-mono text-xs">{r.code}</TableCell>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell><Badge variant="outline">{r.vendor}</Badge></TableCell>
                    <TableCell className="text-xs">{r.kind}</TableCell>
                    <TableCell>
                      {r.isEnabled
                        ? <StatusBadge status="enabled" tone="success" label={<><CheckCircle2 className="mr-1 h-3 w-3" />{t("robot.enabled", "Bật")}</>} className="gap-0" />
                        : <StatusBadge status="disabled" tone="default" label={<><CircleSlash className="mr-1 h-3 w-3" />{t("robot.disabled", "Tắt")}</>} className="gap-0" />}
                    </TableCell>
                    <TableCell className="text-xs">
                      <div className="flex flex-col items-start gap-1">
                        <span>{r.status}</span>
                        {/* Fix round 4 (R13) — trạng thái sống của tiến trình: mất kết nối / khoá chuyển động */}
                        {r.live?.active && !r.live.connected && (
                          <StatusBadge
                            status="link_lost" tone="warning" className="gap-0"
                            label={<><AlertTriangle className="mr-1 h-3 w-3" />{t("robot.live.linkLost", "Mất kết nối")}</>}
                          />
                        )}
                        {r.automation && r.automation !== "on" && (
                          <span
                            data-testid="robot-automation-off"
                            title={t("robot.automation.offTip", "Tự động hoá (VDA5050 / ROS2) bị TẮT cho robot này: hệ thống tự động không tự cấp quyền chuyển động; lệnh DỪNG không bị ảnh hưởng.")}
                          >
                            <StatusBadge
                              status="automation_off" tone="warning" className="gap-0"
                              label={<><PowerOff className="mr-1 h-3 w-3" />{r.automation === "off" ? t("robot.automation.offBadge", "Tự động hoá: TẮT") : t("robot.automation.unknownBadge", "Tự động hoá: không đọc được (coi như TẮT)")}</>}
                            />
                          </span>
                        )}
                        {r.live?.motionLock?.locked && (
                          <span
                            title={t(motionLockTipText(r.live.motionLock).key, {
                              defaultValue: motionLockTipText(r.live.motionLock).defaultValue,
                              reason: lockReason(r.live.motionLock),
                              since: fmt(r.live.motionLock.since),
                            })}
                          >
                            <StatusBadge
                              status="motion_locked" tone="error" className="gap-0"
                              label={<><Lock className="mr-1 h-3 w-3" />{t("robot.motionLock.badge", "Khoá chuyển động")}</>}
                            />
                          </span>
                        )}
                        {/* doc 81 Đợt 12 N fix 1 (M-3) — a locked robot not loaded by the gateway: why it cannot be cleared yet */}
                        {(() => {
                          const blocked = motionLockClearBlocked(r.live);
                          return blocked ? <span className="max-w-[16rem] text-[11px] text-muted-foreground" data-testid="robot-lock-inactive">{t(blocked.key, blocked.defaultValue)}</span> : null;
                        })()}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs">{fmt(r.lastSeenAt)}</TableCell>
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-3">
                        {r.live?.motionLock?.locked && (
                          <Button
                            size="sm" variant="destructive" className="h-7"
                            disabled={!canClearLock || clearLockM.isPending || motionLockClearBlocked(r.live) !== null}
                            onClick={() => { setClearTarget(r); setClearReason(""); }}
                            title={
                              !canClearLock
                                ? t("robot.motionLock.roleRequired", "Cần vai admin/supervisor/engineer và quyền điều khiển máy (machine_control)")
                                : (() => {
                                    // doc 81 Đợt 12 N fix 1 (M-3) — an inactive robot: say why the clear cannot act yet
                                    const blocked = motionLockClearBlocked(r.live);
                                    return blocked ? t(blocked.key, blocked.defaultValue) : t("robot.motionLock.badge", "Khoá chuyển động");
                                  })()
                            }
                          >
                            <Unlock className="mr-1 h-3.5 w-3.5" />{t("robot.motionLock.clear", "Gỡ khoá")}
                          </Button>
                        )}
                        {r.automation === "on" ? (
                          <Button
                            size="sm" variant="outline" className="h-7"
                            disabled={!canControl || autoPending}
                            onClick={() => { setAutoTarget({ robot: r, enable: false }); setAutoReason(""); }}
                            title={!canControl ? t("robot.controlPermRequired", "Cần quyền điều khiển máy (machine_control)") : t("robot.automation.disableTip", "Tắt tự động hoá: hệ thống VDA5050 / ROS2 không còn tự cấp quyền chuyển động cho robot này. Lệnh DỪNG không bị ảnh hưởng.")}
                          >
                            <PowerOff className="mr-1 h-3.5 w-3.5" />{t("robot.automation.disable", "Tắt tự động hoá")}
                          </Button>
                        ) : (
                          <Button
                            size="sm" variant="outline" className="h-7"
                            disabled={!canEnableAutomation || autoPending}
                            onClick={() => { setAutoTarget({ robot: r, enable: true }); setAutoReason(""); }}
                            title={!canEnableAutomation ? t("robot.motionLock.roleRequired", "Cần vai admin/supervisor/engineer và quyền điều khiển máy (machine_control)") : t("robot.automation.enableTip", "Bật lại tự động hoá: hệ thống VDA5050 / ROS2 lại được tự cấp quyền chuyển động (gắn đúng lệnh, một lần, có hạn, có kiểm toán).")}
                          >
                            <Power className="mr-1 h-3.5 w-3.5" />{t("robot.automation.enable", "Bật tự động hoá")}
                          </Button>
                        )}
                        <Button
                          size="sm" variant="ghost" className="h-7"
                          onClick={() => setLocation(`/robot/${r.id}`)}
                          title={t("robot.openCockpit", "Mở cockpit robot")}
                        >
                          <ExternalLink className="mr-1 h-3.5 w-3.5" />{t("robot.cockpit", "Cockpit")}
                        </Button>
                        <Button
                          size="sm" variant="ghost" className="h-7"
                          disabled={!canControl}
                          onClick={() => setLocation(withParams("/command-console", { robotId: r.id }))}
                          title={!canControl ? t("robot.controlPermRequired", "Cần quyền điều khiển máy (machine_control)") : t("robot.controlTip", "Mở Command Console cho robot này (phát lệnh có gate)")}
                        >
                          <Send className="mr-1 h-3.5 w-3.5" />{t("robot.control", "Điều khiển")}
                        </Button>
                        <div className="flex items-center gap-1.5" title={!isAdmin ? t("robot.adminRequired", "Chỉ quản trị viên (admin) mới bật/tắt hoặc kiểm tra kết nối thiết bị") : undefined}>
                          <Switch
                            checked={r.isEnabled}
                            disabled={!isAdmin || setEnabledM.isPending}
                            onCheckedChange={(v) => setEnabledM.mutate({ id: r.id, enabled: v })}
                          />
                        </div>
                        <Button
                          size="sm" variant="outline" className="h-7"
                          disabled={!isAdmin || testM.isPending}
                          onClick={() => testM.mutate({ id: r.id })}
                          title={!isAdmin ? t("robot.adminRequired", "Chỉ quản trị viên (admin) mới bật/tắt hoặc kiểm tra kết nối thiết bị") : t("robot.testConnTip", "Kiểm tra kết nối — chỉ đọc trạng thái, không chuyển động")}
                        >
                          <Plug className="mr-1 h-3.5 w-3.5" />{t("robot.testConn", "Kiểm tra")}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* doc 81 Đợt 10 F2 — lệnh DỪNG chờ (device_pending_stops) + lệnh ghi OT mồ côi: chỉ người mới đóng được, có kiểm toán */}
        <EdgeResolutionPanel canResolve={canResolveEdge} />

        {/* Detail: telemetry + job log (điều khiển ở /command-console) */}
        {selected && (
          <div className="space-y-4">
            {/* Telemetry */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Activity className="h-4 w-4" />
                  {t("robot.telemetry", "Telemetry")} — <span className="font-mono text-sm">{selected.code}</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {latestTelemetry ? (
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div><span className="text-muted-foreground">{t("robot.mode", "Chế độ")}: </span>{latestTelemetry.mode ?? "—"}</div>
                    <div><span className="text-muted-foreground">{t("robot.speed", "Tốc độ")}: </span>{latestTelemetry.speedPct ?? "—"}%</div>
                    <div>
                      <span className="text-muted-foreground">{t("robot.busy", "Bận")}: </span>
                      {latestTelemetry.busy ? t("common.yes", "Có") : t("common.no", "Không")}
                    </div>
                    <div>
                      <span className="text-muted-foreground">E-Stop: </span>
                      {latestTelemetry.estop
                        ? <Badge variant="destructive"><AlertTriangle className="mr-1 h-3 w-3" />{t("robot.estopActive", "Kích hoạt")}</Badge>
                        : <Badge variant="outline">{t("robot.estopClear", "Bình thường")}</Badge>}
                    </div>
                    {latestTelemetry.errorText && (
                      <div className="col-span-2 text-destructive">{latestTelemetry.errorText}</div>
                    )}
                    <div className="col-span-2 text-xs text-muted-foreground">
                      {t("robot.asOf", "Tại thời điểm")}: {fmt(latestTelemetry.timestamp)}
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {t("robot.noTelemetry", "Chưa có telemetry (robot có thể đang offline hoặc chưa bật polling).")}
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Job log (append-only) */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{t("robot.jobLog", "Nhật ký lệnh (append-only)")}</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("robot.colJobType", "Loại lệnh")}</TableHead>
                      <TableHead>{t("robot.colJobStatus", "Trạng thái")}</TableHead>
                      <TableHead>{t("robot.colTrigger", "Nguồn")}</TableHead>
                      <TableHead>{t("robot.colCreated", "Tạo lúc")}</TableHead>
                      <TableHead>{t("robot.colCompleted", "Xong lúc")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(jobsQ.data ?? []).length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                          {t("robot.noJobs", "Chưa có lệnh nào.")}
                        </TableCell>
                      </TableRow>
                    )}
                    {((jobsQ.data ?? []) as Array<{ id: number; jobType: string; status: string; triggerKind: string; createdAt?: string | Date; completedAt?: string | Date | null }>).map((j) => (
                      <TableRow key={j.id}>
                        <TableCell className="font-mono text-xs">{j.jobType}</TableCell>
                        <TableCell>{jobStatusBadge(j.status, t)}</TableCell>
                        <TableCell className="text-xs">
                          <Badge variant="outline">{j.triggerKind}</Badge>
                        </TableCell>
                        <TableCell className="text-xs">{fmt(j.createdAt)}</TableCell>
                        <TableCell className="text-xs">{fmt(j.completedAt)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        )}

        {/* doc 81 Đợt 7 I5 — tắt / bật tự động hoá theo robot: lý do bắt buộc, server ghi audit rồi mới đổi */}
        <AlertDialog open={autoTarget != null} onOpenChange={(open) => { if (!open) setAutoTarget(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {autoTarget?.enable
                  ? t("robot.automation.enableTitle", { defaultValue: "Bật lại tự động hoá cho {{code}}?", code: autoTarget?.robot.code ?? "" })
                  : t("robot.automation.disableTitle", { defaultValue: "Tắt tự động hoá cho {{code}}?", code: autoTarget?.robot.code ?? "" })}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {autoTarget?.enable
                  ? t("robot.automation.enableDesc", "Hệ thống VDA5050 / ROS2 sẽ lại được tự cấp quyền chuyển động cho robot này (gắn đúng một lệnh, dùng một lần, có hạn, có kiểm toán). Thao tác được ghi vào nhật ký kiểm toán kèm lý do.")
                  : t("robot.automation.disableDesc", "Hệ thống VDA5050 / ROS2 sẽ không còn tự cấp quyền chuyển động cho robot này; quyền đã cấp mà chưa dùng cũng bị từ chối. Lệnh DỪNG và lệnh do người vận hành tự bấm không bị ảnh hưởng. Thao tác được ghi vào nhật ký kiểm toán kèm lý do.")}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="robot-automation-reason">
                {t("robot.motionLock.reasonLabel", "Lý do (bắt buộc, ít nhất 3 ký tự)")}
              </label>
              <Textarea id="robot-automation-reason" value={autoReason} onChange={(e) => setAutoReason(e.target.value)} rows={3} />
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={autoPending}>{t("common.cancel", "Hủy")}</AlertDialogCancel>
              <AlertDialogAction
                disabled={autoReason.trim().length < 3 || autoPending || !autoTarget || (autoTarget.enable ? !canEnableAutomation : !canControl)}
                onClick={(e) => {
                  e.preventDefault();
                  if (!autoTarget) return;
                  const vars = { robotId: autoTarget.robot.id, reason: autoReason.trim() };
                  if (autoTarget.enable) enableAutoM.mutate(vars);
                  else disableAutoM.mutate(vars);
                }}
              >
                {autoTarget?.enable ? t("robot.automation.enable", "Bật tự động hoá") : t("robot.automation.disable", "Tắt tự động hoá")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Fix round 4 (R13) — xác nhận gỡ khoá chuyển động: lý do bắt buộc, server ghi audit rồi mới gỡ */}
        <AlertDialog open={clearTarget != null} onOpenChange={(open) => { if (!open) setClearTarget(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t("robot.motionLock.clearTitle", { defaultValue: "Gỡ khoá chuyển động cho {{code}}?", code: clearTarget?.code ?? "" })}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t("robot.motionLock.clearDesc", {
                  defaultValue: "Khoá được đặt vì {{reason}} (từ {{since}}). Trước khi gỡ, hãy xác nhận tại chỗ rằng robot đã dừng và khu vực an toàn. Thao tác này được ghi vào nhật ký kiểm toán kèm lý do của bạn; không có byte nào được gửi tới robot.",
                  reason: lockReason(clearTarget?.live?.motionLock),
                  since: fmt(clearTarget?.live?.motionLock?.since),
                })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="robot-motion-lock-reason">
                {t("robot.motionLock.reasonLabel", "Lý do (bắt buộc, ít nhất 3 ký tự)")}
              </label>
              <Textarea
                id="robot-motion-lock-reason"
                value={clearReason}
                onChange={(e) => setClearReason(e.target.value)}
                placeholder={t("robot.motionLock.reasonPlaceholder", "Ví dụ: đã kiểm tra tại chỗ, robot đứng yên, khu vực trống")}
                rows={3}
              />
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={clearLockM.isPending}>{t("common.cancel", "Hủy")}</AlertDialogCancel>
              <AlertDialogAction
                disabled={clearReason.trim().length < 3 || clearLockM.isPending || !clearTarget || !canClearLock}
                onClick={(e) => {
                  e.preventDefault(); // giữ hộp thoại mở tới khi mutation trả lời
                  // Fix round 5 (item 2) — gửi đúng generation đã hiển thị lúc mở hộp thoại (so-sánh-rồi-gỡ ở server).
                  if (clearTarget) {
                    clearLockM.mutate({
                      robotId: clearTarget.id,
                      reason: clearReason.trim(),
                      expectedGeneration: clearTarget.live?.motionLock?.generation ?? 0,
                    });
                  }
                }}
              >
                <Unlock className="mr-1 h-4 w-4" />{t("robot.motionLock.confirm", "Xác nhận gỡ khoá")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </PageContainer>
    </DashboardLayout>
  );
}
