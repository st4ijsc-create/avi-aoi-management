/**
 * ENG-F1 (doc 40 Wave 2) — GATED COMMAND CONSOLE.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Route `/command-console`. The FIRST UI that actually PHÁT một lệnh robot đơn lẻ
 * (start/stop/home/reset/pause/abort) qua HITL dispatcher — trước đây chuỗi
 * Propose→RobotControl là vòng tròn không thực thi. NÓ KHÔNG nới lỏng gate nào: mọi
 * lệnh đi qua `robot.actuate` → robotCommandDispatcher, giữ NGUYÊN idempotency · mode
 * gate (dry-run/simulated khi ROBOT_CONTROL_ENABLED≠true) · commissioning/FAT gate ·
 * interlock fail-closed · command-authz. Console CHỈ đóng vòng UI:
 *
 *   1. Chọn robot (registry) + lệnh (từ gatedActions capability metadata).
 *   2. Dialog typed-confirm: hiển thị riskLevel + interlock-check preview (read-only)
 *      + validationStatus vendor TRƯỚC khi gửi; người dùng phải GÕ ĐÚNG mã robot.
 *   3. Gửi → hiển thị trạng thái HONEST trả về (done/failed/simulated/rejected) +
 *      job log live (poll robot.jobs) pending→done.
 *
 * KHÔNG bao giờ ngụ ý một chuyển động thật đã xảy ra khi dispatcher trả 'simulated'.
 * RBAC: route gate machine_control; nút Gửi đòi machine_control/canEdit (server tái-gate).
 * ════════════════════════════════════════════════════════════════════════════
 */
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearch } from "wouter";
import { trpc } from "@/lib/trpc";
import { usePermissions } from "@/_core/hooks/usePermissions";
import DashboardLayout from "@/components/DashboardLayout";
import { PageHeader, SectionCard, StatusBadge, EmptyState } from "@/components/patterns";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Terminal, Bot, ShieldAlert, ShieldCheck, Lock, Send, RefreshCw, AlertTriangle,
  Play, Square, Home, RotateCcw, Pause, OctagonAlert, Info,
} from "lucide-react";

// ── The single-command verbs the console MAY dispatch (mirror robotRouter enum). ──
const CONSOLE_COMMANDS = ["start", "stop", "home", "reset", "pause", "abort"] as const;
type ConsoleCommand = (typeof CONSOLE_COMMANDS)[number];

const COMMAND_META: Record<ConsoleCommand, { label: string; icon: typeof Play; defaultRisk: string }> = {
  start: { label: "Start", icon: Play, defaultRisk: "high" },
  stop: { label: "Stop", icon: Square, defaultRisk: "high" },
  home: { label: "Home", icon: Home, defaultRisk: "high" },
  reset: { label: "Reset", icon: RotateCcw, defaultRisk: "low" },
  pause: { label: "Pause / Hold", icon: Pause, defaultRisk: "high" },
  abort: { label: "Abort", icon: OctagonAlert, defaultRisk: "high" },
};

function riskTone(risk: string): "error" | "warning" | "info" | "success" {
  switch ((risk ?? "").toLowerCase()) {
    case "critical": case "high": return "error";
    case "medium": return "warning";
    case "low": return "info";
    default: return "success";
  }
}
function validationTone(v: string): "error" | "warning" | "success" {
  switch (v) {
    case "spec-verified": return "success";
    case "assumed": return "warning";
    default: return "error"; // mock
  }
}
function jobStatusTone(s: string): "error" | "warning" | "info" | "success" {
  switch (s) {
    case "done": return "success";
    case "simulated": return "info";
    case "running": case "pending": return "warning";
    default: return "error"; // failed / rejected
  }
}

type RobotRow = {
  id: number;
  code: string;
  name: string;
  vendor: string;
  kind: string;
  isEnabled: boolean;
  status: string;
  validationStatus?: string;
};

export default function CommandConsole() {
  const { t } = useTranslation();
  const search = useSearch();
  const { hasPermission } = usePermissions();
  const canControl = hasPermission("machine_control", "canEdit");

  // ── Query-param deep link from RobotCockpit "Propose" (?robotId=&command=). ──
  const initial = useMemo(() => {
    const p = new URLSearchParams(search);
    const rid = Number(p.get("robotId"));
    const cmd = p.get("command");
    return {
      robotId: Number.isFinite(rid) && rid > 0 ? rid : null,
      command: (CONSOLE_COMMANDS as readonly string[]).includes(cmd ?? "") ? (cmd as ConsoleCommand) : null,
    };
  }, [search]);

  const [robotId, setRobotId] = useState<number | null>(initial.robotId);
  const [command, setCommand] = useState<ConsoleCommand | null>(initial.command);
  const [confirmText, setConfirmText] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  useEffect(() => {
    if (initial.robotId) setRobotId(initial.robotId);
    if (initial.command) setCommand(initial.command);
  }, [initial.robotId, initial.command]);

  const robotsQ = trpc.robot.list.useQuery(undefined, { staleTime: 10_000 });
  const robots = (robotsQ.data ?? []) as RobotRow[];
  const robot = robots.find((r) => r.id === robotId) ?? null;

  // gatedActions capability metadata (riskLevel / requiredPermission per command verb).
  const detailQ = trpc.assetCockpit.robotDetail.useQuery(
    { robotId: robotId ?? 0 },
    { enabled: robotId != null, staleTime: 10_000, retry: false },
  );
  const gatedByName = useMemo(() => {
    const m = new Map<string, { riskLevel: string; requiredPermission: string }>();
    for (const a of detailQ.data?.gatedActions ?? []) {
      m.set(a.name, { riskLevel: a.riskLevel, requiredPermission: a.requiredPermission });
    }
    return m;
  }, [detailQ.data]);

  // Interlock preview (read-only) — exactly what the dispatcher will evaluate. Live in dialog.
  const interlockQ = trpc.robot.interlockPreview.useQuery(
    { robotId: robotId ?? 0 },
    { enabled: dialogOpen && robotId != null, refetchInterval: dialogOpen ? 4000 : false, retry: false },
  );

  // Append-only job log (live) — closes the loop: pending→done shows here.
  const jobsQ = trpc.robot.jobs.useQuery(
    { robotId: robotId ?? 0, limit: 20 },
    { enabled: robotId != null, refetchInterval: 3000 },
  );

  const utils = trpc.useUtils();
  const actuate = trpc.robot.actuate.useMutation({
    onSuccess: (res) => {
      const status = res.status;
      if (status === "simulated") {
        toast.info(t("console.simulated", "Recorded SIMULATED (dry-run). No real motion — control disabled or robot not commissioned."));
      } else if (res.ok) {
        toast.success(t("console.sent", "Command accepted: {{status}}").replace("{{status}}", status));
      } else {
        toast.error(t("console.rejected", "Command not executed: {{status}}").replace("{{status}}", `${status}${res.error ? ` — ${res.error}` : ""}`));
      }
      void utils.robot.jobs.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const chosenRisk = command ? (gatedByName.get(command)?.riskLevel ?? COMMAND_META[command].defaultRisk) : "high";
  const interlockBlocked = interlockQ.data?.blocked === true;
  const confirmMatches = !!robot && confirmText.trim() === robot.code;
  const canSend = canControl && !!robot && !!command && confirmMatches && !actuate.isPending;

  function openConfirm(cmd: ConsoleCommand) {
    if (!robot) {
      toast.error(t("console.pickRobot", "Select a robot first."));
      return;
    }
    setCommand(cmd);
    setConfirmText("");
    setDialogOpen(true);
  }

  function doSend() {
    if (!robot || !command || !confirmMatches) return;
    actuate.mutate({ robotId: robot.id, command });
    setDialogOpen(false);
    setConfirmText("");
  }

  return (
    <DashboardLayout>
      <div className="space-y-4 p-1">
        <PageHeader
          icon={<Terminal className="h-6 w-6" />}
          title={t("console.title", "Command Console")}
          description={t("console.subtitle", "Issue a single gated robot command through the HITL dispatcher. Every command passes the existing mode / commissioning / interlock gates — dry-run unless control is enabled.")}
          actions={
            <Button size="sm" variant="outline" onClick={() => { void robotsQ.refetch(); void jobsQ.refetch(); }}>
              <RefreshCw className={`mr-1 h-4 w-4 ${robotsQ.isFetching ? "animate-spin" : ""}`} /> {t("console.refresh", "Refresh")}
            </Button>
          }
        />

        {!canControl && (
          <div className="flex items-center gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
            <Lock className="h-4 w-4 shrink-0" />
            {t("console.noPerm", "You have view-only access. Issuing a command requires machine_control / edit permission.")}
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {/* ── SELECT + COMMANDS ── */}
          <div className="space-y-4 lg:col-span-2">
            <SectionCard icon={<Bot className="h-4 w-4" />} title={t("console.selectRobot", "Select robot")}>
              {robotsQ.isLoading ? (
                <div className="py-6 text-center text-sm text-muted-foreground">{t("console.loading", "Loading robots…")}</div>
              ) : robots.length === 0 ? (
                <EmptyState title={t("console.noRobots", "No robots")} description={t("console.noRobotsHint", "No robots are registered.")} />
              ) : (
                <div className="space-y-3">
                  <Select value={robotId != null ? String(robotId) : ""} onValueChange={(v) => setRobotId(Number(v))}>
                    <SelectTrigger><SelectValue placeholder={t("console.selectPlaceholder", "Choose a robot…")} /></SelectTrigger>
                    <SelectContent>
                      {robots.map((r) => (
                        <SelectItem key={r.id} value={String(r.id)}>
                          {r.code} · {r.name} ({r.vendor})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {robot && (
                    <div className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm">
                      <span className="font-mono">{robot.code}</span>
                      <Badge variant="outline">{robot.vendor}</Badge>
                      <Badge variant="outline" className="capitalize">{robot.kind}</Badge>
                      <StatusBadge status={robot.isEnabled ? "active" : "offline"} className="px-1.5 py-0 text-[11px]" label={robot.isEnabled ? "enabled" : "disabled"} />
                      {robot.validationStatus && (
                        <StatusBadge
                          status={robot.validationStatus}
                          tone={validationTone(robot.validationStatus)}
                          className="px-1.5 py-0 text-[11px]"
                          label={robot.validationStatus}
                        />
                      )}
                    </div>
                  )}

                  {robot?.validationStatus === "mock" && (
                    <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                      <ShieldAlert className="h-4 w-4 shrink-0" />
                      {t("console.mockVendor", "This vendor driver is a MOCK (protocol not validated against real hardware). Commands stay simulated; a real device connection is refused unless the mock-vendor flag is explicitly enabled for a lab.")}
                    </div>
                  )}
                  {!robot?.isEnabled && robot && (
                    <div className="flex items-start gap-2 rounded-md border border-info/30 bg-info/10 px-3 py-2 text-xs text-info">
                      <Info className="h-4 w-4 shrink-0" />
                      {t("console.disabledRobot", "Robot is DISABLED — the dispatcher will reject a real run (a disabled/unconnected robot never actuates).")}
                    </div>
                  )}
                </div>
              )}
            </SectionCard>

            <SectionCard
              icon={<Terminal className="h-4 w-4" />}
              title={t("console.commands", "Commands")}
              description={t("console.commandsHint", "Choose a command to open a typed-confirm dialog. Nothing dispatches until you confirm.")}
            >
              {!robot ? (
                <EmptyState title={t("console.pickFirst", "Select a robot")} description={t("console.pickFirstHint", "Pick a robot above to see its proposable commands.")} />
              ) : (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {CONSOLE_COMMANDS.map((cmd) => {
                    const meta = COMMAND_META[cmd];
                    const Icon = meta.icon;
                    const risk = gatedByName.get(cmd)?.riskLevel ?? meta.defaultRisk;
                    return (
                      <button
                        key={cmd}
                        type="button"
                        disabled={!canControl}
                        onClick={() => openConfirm(cmd)}
                        className="flex flex-col items-start gap-1 rounded-md border px-3 py-2 text-left transition hover:border-primary disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <span className="flex items-center gap-1.5 font-medium">
                          <Icon className="h-4 w-4 text-muted-foreground" /> {meta.label}
                        </span>
                        <StatusBadge status={risk} tone={riskTone(risk)} className="px-1.5 py-0 text-[10px] capitalize" label={risk} />
                      </button>
                    );
                  })}
                </div>
              )}
            </SectionCard>
          </div>

          {/* ── LIVE JOB LOG ── */}
          <SectionCard
            icon={<RefreshCw className="h-4 w-4" />}
            title={t("console.jobLog", "Live job log")}
            description={t("console.jobLogHint", "Append-only — every dispatched command lands here (pending → done / simulated / rejected).")}
          >
            {!robot ? (
              <EmptyState title={t("console.noRobotSel", "No robot")} description={t("console.noRobotSelHint", "Select a robot to see its job log.")} />
            ) : (jobsQ.data?.length ?? 0) === 0 ? (
              <EmptyState title={t("console.noJobs", "No jobs")} description={t("console.noJobsHint", "No commands issued for this robot yet.")} />
            ) : (
              <ScrollArea className="h-[420px] pr-2">
                <div className="space-y-2">
                  {(jobsQ.data ?? []).map((j) => (
                    <div key={j.id} className="rounded-md border px-3 py-2 text-sm">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{String((j.params as Record<string, unknown> | null)?.command ?? j.jobType)}</span>
                        <StatusBadge status={j.status} tone={jobStatusTone(j.status)} className="px-1.5 py-0 text-[10px]" label={j.status} />
                        <span className="ml-auto text-[11px] text-muted-foreground">{j.createdAt ? new Date(String(j.createdAt)).toLocaleTimeString() : ""}</span>
                      </div>
                      {j.errorText && <div className="mt-1 text-xs text-destructive">{j.errorText}</div>}
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </SectionCard>
        </div>
      </div>

      {/* ── TYPED-CONFIRM DIALOG ── */}
      <Dialog open={dialogOpen} onOpenChange={(o) => { setDialogOpen(o); if (!o) setConfirmText(""); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-warning" />
              {t("console.confirmTitle", "Confirm command")}
            </DialogTitle>
            <DialogDescription>
              {t("console.confirmDesc", "This dispatches a gated command. It stays SIMULATED unless robot control is enabled AND the robot is commissioned. Interlocks are enforced server-side (fail-closed).")}
            </DialogDescription>
          </DialogHeader>

          {robot && command && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm">
                <span className="text-muted-foreground">{t("console.robot", "Robot")}:</span>
                <span className="font-mono">{robot.code}</span>
                <Badge variant="outline">{robot.vendor}</Badge>
                {robot.validationStatus && (
                  <StatusBadge status={robot.validationStatus} tone={validationTone(robot.validationStatus)} className="px-1.5 py-0 text-[10px]" label={robot.validationStatus} />
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm">
                <span className="text-muted-foreground">{t("console.command", "Command")}:</span>
                <span className="font-medium">{COMMAND_META[command].label}</span>
                <StatusBadge status={chosenRisk} tone={riskTone(chosenRisk)} className="px-1.5 py-0 text-[10px] capitalize" label={chosenRisk} />
              </div>

              {/* Interlock preview (read-only, live) */}
              <div className={`flex items-start gap-2 rounded-md border px-3 py-2 text-xs ${
                interlockQ.isLoading ? "border-muted text-muted-foreground"
                  : interlockBlocked ? "border-destructive/40 bg-destructive/10 text-destructive"
                  : "border-emerald-500/30 bg-emerald-500/10 text-emerald-600"
              }`}>
                {interlockBlocked ? <AlertTriangle className="h-4 w-4 shrink-0" /> : <ShieldCheck className="h-4 w-4 shrink-0" />}
                <div>
                  <div className="font-medium">
                    {interlockQ.isLoading ? t("console.interlockChecking", "Checking interlocks…")
                      : interlockBlocked ? t("console.interlockBlocked", "Interlock BLOCKED — the dispatcher will refuse a real run.")
                      : t("console.interlockClear", "Interlock clear.")}
                  </div>
                  {interlockBlocked && (interlockQ.data?.violations?.length ?? 0) > 0 && (
                    <div className="mt-0.5">
                      {(interlockQ.data?.violations ?? []).map((v) => `#${v.ruleId} (${v.action})`).join(", ")}
                    </div>
                  )}
                  {interlockQ.data?.failClosed && (
                    <div className="mt-0.5">{t("console.interlockFailClosed", "Evaluation error — fail-closed (no run).")}</div>
                  )}
                </div>
              </div>

              {/* Typed confirm */}
              <div className="space-y-1.5">
                <Label htmlFor="confirm-code">
                  {t("console.typeCode", "Type the robot code to confirm")}: <span className="font-mono text-foreground">{robot.code}</span>
                </Label>
                <Input
                  id="confirm-code"
                  autoComplete="off"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  placeholder={robot.code}
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => { setDialogOpen(false); setConfirmText(""); }}>
              {t("console.cancel", "Cancel")}
            </Button>
            <Button disabled={!canSend} onClick={doSend}>
              <Send className="mr-1 h-4 w-4" />
              {t("console.send", "Dispatch command")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
