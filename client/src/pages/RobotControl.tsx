/**
 * P4 (audit H / doc 12 §6) — ROBOT CONTROL surface (read-mostly + honest safety gate).
 *
 * Surfaces the Phase-3 robotRouter: registry list, per-robot telemetry, and the
 * append-only motion-job log. The command panel is INTENTIONALLY non-actuating:
 * motion control is NOT exposed over tRPC — it routes through the internal
 * robotCommandDispatcher (HITL-confirmed + dry-run/simulated + idempotency-keyed),
 * never from the browser. So this page is honest about that: it shows the job log
 * (status: simulated / hitl / rejected …), whether a robot is ENABLED (a disabled
 * robot never actuates), and explains that any "command" issued elsewhere is
 * simulated until the device is enabled. The UI never implies a real motion happened.
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
import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { ViewOnlyBadge } from "@/components/PermissionGate";
import { PageHeader, PageContainer, StatusBadge } from "@/components/patterns";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Bot, RefreshCw, ShieldAlert, Plug, Activity, AlertTriangle, Lock, CheckCircle2, CircleSlash, ExternalLink,
  X, Send,
} from "lucide-react";
import { toast } from "sonner";

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
  const [, setLocation] = useLocation();
  const search = useSearch();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  // Deep-link from RobotCockpit "Propose": /robot-control?robotId=X&command=Y
  // (params emitted at RobotCockpit.tsx ~line 680). We consume them to auto-focus
  // the robot and surface the proposed command honestly — dispatch stays gated.
  const deepLink = useMemo(() => {
    const p = new URLSearchParams(search);
    const rid = p.get("robotId");
    const cmd = p.get("command");
    const ridNum = rid != null && rid.trim() !== "" && Number.isFinite(Number(rid)) ? Number(rid) : null;
    return { robotId: ridNum, command: cmd != null && cmd.trim() !== "" ? cmd : null };
  }, [search]);

  const utils = trpc.useUtils();
  const listQ = trpc.robot.list.useQuery();
  const robots = (listQ.data ?? []) as RobotRow[];

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

  // A dismissible deep-link banner; reset dismissal whenever the link changes.
  const [deepLinkDismissed, setDeepLinkDismissed] = useState(false);
  useEffect(() => {
    setDeepLinkDismissed(false);
  }, [deepLink.robotId, deepLink.command]);

  const bannerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (deepLink.robotId != null && !deepLinkDismissed) {
      bannerRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [deepLink.robotId, deepLink.command, deepLinkDismissed]);

  const deepLinkRobot = useMemo(
    () => (deepLink.robotId != null ? robots.find((r) => r.id === deepLink.robotId) ?? null : null),
    [robots, deepLink.robotId],
  );
  // Show the proposed-command panel when a command was deep-linked and the currently
  // selected robot is the one it targets (or no specific robot was named).
  const proposedForSelected =
    deepLink.command != null && selected != null &&
    (deepLink.robotId == null || deepLink.robotId === selected.id);

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
    onError: (e) => toast.error(e.message),
  });

  const testM = trpc.robot.testConnection.useMutation({
    onSuccess: (r) => {
      if (r?.ok) toast.success(t("robot.testOk", "Kết nối OK (chỉ đọc trạng thái, không có chuyển động)"));
      else toast.error(r?.error ?? t("robot.testFail", "Kết nối thất bại"));
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <DashboardLayout>
      <PageContainer className="space-y-4">
        <PageHeader
          icon={<Bot className="h-6 w-6" />}
          title={t("robot.title", "Điều khiển Robot")}
          badge={!isAdmin ? <ViewOnlyBadge /> : undefined}
          description={t("robot.subtitle", "Theo dõi robot/AGV: registry, telemetry, nhật ký lệnh — chuyển động luôn qua HITL/dry-run")}
          actions={
            <Button size="icon" variant="ghost" onClick={() => void listQ.refetch()} title={t("common.refresh", "Làm mới")}>
              <RefreshCw className="h-4 w-4" />
            </Button>
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

        {/* Deep-link banner — cockpit "Propose" landed here with a robot + command. */}
        {deepLink.robotId != null && !deepLinkDismissed && (
          <div
            ref={bannerRef}
            className="flex items-start gap-2 rounded-md border border-primary/40 bg-primary/10 p-3 text-sm"
          >
            <Send className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <div className="flex-1">
              <p className="font-medium">{t("robot.deepLinkTitle", "Proposed command from cockpit")}</p>
              <p className="mt-0.5 text-muted-foreground">
                {deepLinkRobot
                  ? deepLink.command
                    ? t(
                        "robot.deepLinkBody",
                        'The robot cockpit proposed the command "{{command}}" for robot {{robot}}. It has been focused below — review it in the gated command panel; nothing is dispatched automatically.',
                        { command: deepLink.command, robot: `${deepLinkRobot.name} (${deepLinkRobot.code})` },
                      )
                    : t(
                        "robot.deepLinkRobotOnly",
                        "The robot cockpit focused robot {{robot}} below.",
                        { robot: `${deepLinkRobot.name} (${deepLinkRobot.code})` },
                      )
                  : t(
                      "robot.deepLinkNotFound",
                      "A cockpit link referenced robot #{{robotId}}, but it is not in the registry (it may be hidden or removed).",
                      { robotId: deepLink.robotId },
                    )}
              </p>
            </div>
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6 shrink-0"
              onClick={() => setDeepLinkDismissed(true)}
              title={t("common.dismiss", "Dismiss")}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        )}

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
                    <TableCell className="text-xs">{r.status}</TableCell>
                    <TableCell className="text-xs">{fmt(r.lastSeenAt)}</TableCell>
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-3">
                        <Button
                          size="sm" variant="ghost" className="h-7"
                          onClick={() => setLocation(`/robot/${r.id}`)}
                          title={t("robot.openCockpit", "Mở cockpit robot")}
                        >
                          <ExternalLink className="mr-1 h-3.5 w-3.5" />{t("robot.cockpit", "Cockpit")}
                        </Button>
                        <div className="flex items-center gap-1.5" title={!isAdmin ? t("robot.adminOnly", "Chỉ admin") : undefined}>
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
                          title={t("robot.testConnTip", "Kiểm tra kết nối — chỉ đọc trạng thái, không chuyển động")}
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

        {/* Detail: telemetry + command/job log */}
        {selected && (
          <div className="grid gap-4 lg:grid-cols-2">
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

            {/* Command panel — honest read-only / gated */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Lock className="h-4 w-4" />
                  {t("robot.commandPanel", "Bảng lệnh (gated)")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {proposedForSelected ? (
                  <div className="space-y-3">
                    <div className="rounded-md border border-primary/40 bg-primary/5 p-3 text-sm">
                      <p className="flex items-center gap-2 font-medium">
                        <Send className="h-4 w-4 text-primary" />
                        {t("robot.proposedCmdTitle", "Proposed command (from cockpit)")}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span className="text-muted-foreground">{t("robot.proposedCmd", "Command")}:</span>
                        <Badge variant="outline" className="font-mono">{deepLink.command}</Badge>
                        <span className="text-muted-foreground">·</span>
                        <span className="text-muted-foreground">{t("robot.forRobot", "Robot")}:</span>
                        <span className="font-mono text-xs">{selected.code}</span>
                        {selected.isEnabled
                          ? <StatusBadge status="enabled" tone="success" label={<><CheckCircle2 className="mr-1 h-3 w-3" />{t("robot.enabled", "Bật")}</>} className="gap-0" />
                          : <StatusBadge status="disabled" tone="default" label={<><CircleSlash className="mr-1 h-3 w-3" />{t("robot.disabled", "Tắt")}</>} className="gap-0" />}
                      </div>
                      <p className="mt-2 text-muted-foreground">
                        {t(
                          "robot.proposedCmdNote",
                          "This surface does NOT dispatch motion. To execute, the command must go through the internal gated dispatcher (robotCommandDispatcher: human-in-the-loop confirm + dry-run + idempotency key).",
                        )}{" "}
                        {selected.isEnabled
                          ? t("robot.proposedCmdEnabled", "This robot is ENABLED — an operator can confirm and run it via the HITL dispatcher; watch the job log below for its status (simulated / hitl / done).")
                          : t("robot.proposedCmdDisabled", "This robot is DISABLED — any dispatch is recorded as SIMULATED (no real motion) until an admin enables it in the registry above.")}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7"
                        onClick={() => setLocation(`/robot/${selected.id}`)}
                        title={t("robot.openCockpit", "Mở cockpit robot")}
                      >
                        <ExternalLink className="mr-1 h-3.5 w-3.5" />{t("robot.backToCockpit", "Back to cockpit")}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7"
                        onClick={() => setLocation("/robot-control")}
                        title={t("robot.clearProposed", "Clear proposed command")}
                      >
                        <X className="mr-1 h-3.5 w-3.5" />{t("robot.clearProposed", "Clear proposed command")}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-md border border-dashed border-muted-foreground/30 bg-muted/30 p-3 text-sm">
                    <p className="font-medium">{t("robot.noDirectCmdTitle", "Không phát lệnh trực tiếp từ UI")}</p>
                    <p className="mt-1 text-muted-foreground">
                      {selected.isEnabled
                        ? t("robot.cmdEnabledNote", "Robot đã BẬT. Lệnh vẫn chỉ được phát qua bộ điều phối HITL nội bộ (xác nhận con người + idempotency). Giao diện này không kích hoạt chuyển động.")
                        : t("robot.cmdDisabledNote", "Robot đang TẮT — mọi lệnh sẽ chỉ được ghi nhận ở trạng thái MÔ PHỎNG (simulated), không có chuyển động thật cho tới khi được bật.")}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Job log (append-only) */}
            <Card className="lg:col-span-2">
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
      </PageContainer>
    </DashboardLayout>
  );
}
