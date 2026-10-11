/**
 * doc 81 Đợt 9 final wave (ruling R-9-e, U re-review #3) — the "e-stop latch first seen set at T, not reset" warning INSIDE the
 * actuation confirm dialogs (robot command, Studio approve / continue), not only on the Safety source panel.
 *
 * While a Modbus e-stop LATCH stays set, later short presses are NOT captured until it is reset. The warning is NON-BLOCKING
 * (owner decision later: actuation is not gated by it) and it is NEVER shown for a STOP (`isStop` ⇒ nothing is rendered and
 * nothing is queried — a STOP is never delayed or questioned, L-7).
 *
 * Source: safety.sourceHealth (the same durable poll-state rows as the Safety page). With a command `target` the server lists only
 * the latched configs that guard that target (the gate's own matcher); without one, every latched config in the viewer's scope.
 * A query that fails (no permission, server down) renders nothing: this is a warning, not a gate.
 */
import { useTranslation } from "react-i18next";
import { AlertTriangle } from "lucide-react";
import { trpc } from "@/lib/trpc";

export interface SafetyLatchWarningProps {
  /** the command target, when the dialog has one (the robot of a robot command) */
  target?: { robotId?: number; machineId?: number; adapterId?: number };
  /** a STOP never shows the warning (and never queries) */
  isStop?: boolean;
  /** only query while the dialog is open */
  enabled?: boolean;
  className?: string;
}

export function SafetyLatchWarning({ target, isStop = false, enabled = true, className }: SafetyLatchWarningProps) {
  const { t } = useTranslation();
  const q = trpc.safety.sourceHealth.useQuery(target ? { target } : undefined, {
    enabled: enabled && !isStop,
    retry: false,
    staleTime: 5_000,
  });
  if (isStop || !enabled) return null;
  const latched = (q.data?.plcPoller?.latched ?? []) as Array<{ code: string; since: string }>;
  if (latched.length === 0) return null;
  return (
    <div
      data-testid="safety-latch-confirm-warning"
      role="status"
      className={`flex items-start gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200 ${className ?? ""}`}
    >
      <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="space-y-0.5">
        {latched.map((c) => (
          <div key={c.code}>
            {t(
              "safety.source.latchConfirm",
              "⚠ {{code}}: e-stop latch first seen set at {{time}}, not reset — later short presses are NOT captured until it is reset. Warning only: this command is not blocked by it.",
              { code: c.code, time: new Date(c.since).toLocaleString() },
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
