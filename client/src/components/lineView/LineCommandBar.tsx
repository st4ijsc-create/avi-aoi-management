/**
 * doc 44 W3-B4 / G5.10 — Thanh lệnh tuyến (Line View, spec LDS-L5 §6.1):
 * start|hold|resume|changeover|complete|reset_fault — mỗi nút bọc
 * <ConfirmWithReason> (start/hold/resume/complete = low; changeover/reset_fault
 * = high, quyết định batch). Gọi trpc.lineController.command (actuationProcedure
 * server-side: role-floor + 2FA + policy seam — "không có cửa hậu").
 *
 * Mutation trả TransitionResult NGUYÊN TRẠNG (ok:false = lý do nghiệp vụ, KHÔNG
 * phải TRPCError) → dialog kết quả render checks readiness / allowed-list /
 * reason_code POLICY_DENIED. Nút disable theo FSM map client (lineFsm.ts —
 * mirror server, server luôn validate lại).
 */
import * as React from "react";
import { useTranslation } from "react-i18next";
import {
  CheckCircle2,
  Loader2,
  Pause,
  Play,
  RefreshCcw,
  ShieldAlert,
  StepForward,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ConfirmWithReason, StatusBadge } from "@/components/patterns";
import {
  LINE_VIEW_COMMANDS,
  LINE_VIEW_COMMAND_RISK,
  isLineViewCommandEnabled,
  type LineViewCommand,
  type LineViewState,
} from "./lineFsm";
import { ReadinessChecklist, type ReadinessResultView } from "./ReadinessPanel";

/** Mirror TransitionFailure (lineControllerService.ts) — chỉ các field UI cần. */
interface TransitionFailureView {
  ok: false;
  code: string;
  message: string;
  from?: string;
  to?: string;
  allowed?: readonly string[];
  readiness?: ReadinessResultView;
  effect?: string;
  policyRef?: string | null;
}

const COMMAND_ICON: Record<LineViewCommand, React.ReactNode> = {
  start: <Play className="size-4" aria-hidden="true" />,
  hold: <Pause className="size-4" aria-hidden="true" />,
  resume: <StepForward className="size-4" aria-hidden="true" />,
  changeover: <RefreshCcw className="size-4" aria-hidden="true" />,
  complete: <CheckCircle2 className="size-4" aria-hidden="true" />,
  reset_fault: <Wrench className="size-4" aria-hidden="true" />,
};

export interface LineCommandBarProps {
  lineId: number;
  lineCode: string;
  state: LineViewState;
  /** RBAC client-side (machine_control/canEdit) — hiện-nhưng-khoá kèm lý do (doc 26 U4). */
  canControl: boolean;
  /** Gọi sau MỌI kết quả lệnh (ok lẫn bị chặn) để invalidate queries. */
  onSettled: () => void;
}

export function LineCommandBar({ lineId, lineCode, state, canControl, onSettled }: LineCommandBarProps) {
  const { t } = useTranslation();
  const [failure, setFailure] = React.useState<TransitionFailureView | null>(null);
  const [pendingCommand, setPendingCommand] = React.useState<LineViewCommand | null>(null);

  const commandMutation = trpc.lineController.command.useMutation({
    // TRPCError thật (mất mạng / role-floor / 2FA) — khác với ok:false nghiệp vụ.
    onError: (e) => toast.error(e.message),
  });

  const cmdLabel = (c: LineViewCommand): string =>
    t(`lineView.cmd.${c}`, {
      start: "Chạy (Start)",
      hold: "Giữ (Hold)",
      resume: "Tiếp tục (Resume)",
      changeover: "Đổi sản phẩm (Changeover)",
      complete: "Hoàn tất (Complete)",
      reset_fault: "Xác nhận khắc phục lỗi",
    }[c]);

  const runCommand = async (command: LineViewCommand, reason: string) => {
    setPendingCommand(command);
    try {
      const res = await commandMutation.mutateAsync({ lineId, command, reason });
      if (res.ok) {
        toast.success(
          t("lineView.result.success", "Tuyến {{line}}: '{{from}}' → '{{to}}'", {
            line: lineCode,
            from: res.from,
            to: res.to,
          }),
        );
      } else {
        // Lý do nghiệp vụ (FSM/readiness/policy/conflict) — mở dialog chi tiết.
        setFailure(res as TransitionFailureView);
      }
      onSettled();
    } finally {
      setPendingCommand(null);
    }
  };

  const noPermReason = !canControl
    ? t(
        "lineView.needControlPerm",
        "Cần quyền machine_control (edit) để phát lệnh tuyến — server còn yêu cầu role và 2FA.",
      )
    : undefined;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {LINE_VIEW_COMMANDS.map((command) => {
          const enabled = isLineViewCommandEnabled(command, state);
          const risk = LINE_VIEW_COMMAND_RISK[command];
          const busy = pendingCommand === command && commandMutation.isPending;
          const disabled = !enabled || !canControl || commandMutation.isPending;
          const disabledReason = !canControl
            ? noPermReason
            : !enabled
              ? t("lineView.cmdNotAllowed", "Lệnh không hợp lệ từ trạng thái '{{state}}'", { state })
              : undefined;
          return (
            <ConfirmWithReason
              key={command}
              riskLevel={risk}
              disabled={disabled}
              title={t("lineView.confirm.title", "{{command}} — tuyến {{line}}?", {
                command: cmdLabel(command),
                line: lineCode,
              })}
              description={t(`lineView.confirm.desc_${command}`)}
              impact={risk === "high" ? t(`lineView.confirm.impact_${command}`) : undefined}
              confirmLabel={cmdLabel(command)}
              onConfirm={(reason) => runCommand(command, reason)}
              trigger={
                <Button
                  size="sm"
                  variant={command === "start" ? "default" : "outline"}
                  disabled={disabled}
                  title={disabledReason}
                >
                  {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : COMMAND_ICON[command]}
                  {cmdLabel(command)}
                </Button>
              }
            />
          );
        })}
      </div>

      {/* Dialog kết quả khi lệnh bị CHẶN (TransitionResult ok:false — server đã audit). */}
      <Dialog open={failure != null} onOpenChange={(o) => !o && setFailure(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldAlert className="size-4 shrink-0 text-destructive" aria-hidden="true" />
              {t("lineView.result.blockedTitle", "Lệnh bị chặn")}
              {failure && <Badge variant="outline">{failure.code}</Badge>}
            </DialogTitle>
            <DialogDescription>
              {t(
                "lineView.result.blockedDesc",
                "Server từ chối chuyển trạng thái — trạng thái tuyến KHÔNG đổi. Chi tiết bên dưới.",
              )}
            </DialogDescription>
          </DialogHeader>

          {failure && (
            <div className="space-y-3 text-sm">
              <p className="break-words">{failure.message}</p>

              {/* NOT_READY → render checklist readiness ngay trong dialog. */}
              {failure.code === "NOT_READY" && failure.readiness && (
                <div className="rounded-md border bg-muted/30 p-3">
                  <p className="mb-2 text-xs font-medium text-muted-foreground">
                    {t("lineView.result.readinessChecks", "Checklist sẵn sàng (vừa chạy)")}
                  </p>
                  <ReadinessChecklist checks={failure.readiness.checks} />
                </div>
              )}

              {/* INVALID_TRANSITION → danh sách transition hợp lệ từ trạng thái hiện tại. */}
              {failure.code === "INVALID_TRANSITION" && failure.allowed && (
                <div className="rounded-md border bg-muted/30 p-3">
                  <p className="mb-2 text-xs font-medium text-muted-foreground">
                    {t("lineView.result.allowed", "Transition hợp lệ từ '{{from}}'", {
                      from: failure.from ?? "?",
                    })}
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {failure.allowed.map((s) => (
                      <StatusBadge key={s} status={s} label={t(`lineView.state.${s}`, s)} />
                    ))}
                  </div>
                </div>
              )}

              {/* POLICY_DENIED → reason_code + effect + policy ref (spec §6.1: hiển thị lý do). */}
              {failure.code === "POLICY_DENIED" && (
                <div className="space-y-1 rounded-md border bg-muted/30 p-3 text-xs">
                  <p>
                    <span className="font-medium">{t("lineView.result.policyEffect", "Effect")}:</span>{" "}
                    {failure.effect ?? "—"}
                  </p>
                  <p>
                    <span className="font-medium">{t("lineView.result.policyRef", "Policy ref")}:</span>{" "}
                    {failure.policyRef ?? "—"}
                  </p>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setFailure(null)}>
              {t("lineView.result.close", "Đóng")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default LineCommandBar;
