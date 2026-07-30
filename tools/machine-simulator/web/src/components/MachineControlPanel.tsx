import * as React from "react"
import { AlertTriangle, Loader2, Radio, Send, Zap } from "lucide-react"

import { useGloss } from "@/components/hmi/bilingual"
import { useT } from "@/i18n"
import { useAuth } from "@/lib/auth"
import {
  MachineWriteApiError,
  useConfiguredConnectors,
  useInvokeMachineCommand,
  useWriteMachineSetpoint,
  type CommandResult,
  type ConnectorCommandGrant,
  type ConnectorWritablePointGrant,
  type SetpointWriteResult,
  type WriteOutcome,
} from "@/lib/api"
import { Sheet } from "@/components/industrial"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { FormField } from "@/components/FormField"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { StatusBadge } from "@/components/ui/status-badge"
import { Switch } from "@/components/ui/switch"

/**
 * Task B-8 (.superpowers/sdd/2026-07-29-dotB-machine-control-blueprint/task-8-brief.md) — the first web
 * surface over B-1 through B-7's write path: `POST /v1/machines/{code}/setpoint`/`.../command`. Reads
 * what the machine's OWN connector declares (`GET /v1/connectors/configured`'s `writeCapability` —
 * mandatory, parse-time-validated bounds, never "unbounded" — see README §16.4/§16.6/§21) and lets an
 * Engineer+ issue a setpoint or an Admin issue a command, mirroring B-6's own role split exactly
 * (`machine.setpoint.write` → Engineer, `machine.command.invoke` → Admin — one level stricter, because a
 * command can trigger real physical motion and a setpoint cannot).
 *
 * Two things this file gets right on purpose (README §21.3/§21.4):
 * - **A command is never one click away.** `CommandRow` always goes through a confirmation dialog before
 *   firing — the same deliberate two-step "say so before the click" pattern `Site.tsx`'s identity-rotation
 *   dialog already established for its own irreversible action — never a bare button a stray click fires.
 *   A setpoint changes a value rather than triggering motion, so it does NOT get that same friction, but it
 *   is still role-gated identically to the API.
 * - **`Indeterminate` renders as itself**, in `OutcomeBanner` below — never folded into a generic failure
 *   message and never mistaken for success. Two earlier tasks in this batch (B-4, B-5) shipped bugs where
 *   exactly that collapse happened one layer down (inside a driver); this UI does not repeat it one layer
 *   up.
 */

const ROLE_RANK: Record<string, number> = { Operator: 0, Engineer: 1, Admin: 2 }

function meetsMinRole(minRole: string, userRole: string | undefined): boolean {
  if (!userRole) return false
  return (ROLE_RANK[userRole] ?? -1) >= (ROLE_RANK[minRole] ?? Number.POSITIVE_INFINITY)
}

type TFunc = ReturnType<typeof useT>
type GlossFunc = ReturnType<typeof useGloss>

/** `min`/`max` are both `null` ONLY for an OPC-UA `Bool` setpoint (README §16.6 — a boolean's domain
 * `{false,true}` is already exhaustively bounded, a STRONGER bound than any numeric range, never a
 * missing one). Every numeric writable point has BOTH bounds populated — mandatory, parse-time-enforced —
 * so this is a safe, total rule for which control to render, not a heuristic. */
function isBooleanPoint(point: ConnectorWritablePointGrant): boolean {
  return point.min === null && point.max === null
}

function outcomeStatus(outcome: WriteOutcome): "ok" | "warn" | "danger" | "info" {
  switch (outcome) {
    case "Applied":
      return "ok"
    case "Rejected":
      return "warn"
    case "Failed":
      return "danger"
    case "Indeterminate":
    default:
      // Deliberately its OWN visual lane — never `warn` (Rejected) or `danger` (Failed): conflating
      // "we don't know" with either "refused" or "explicit no" would destroy the one distinction this
      // whole outcome exists to preserve. See this file's own header comment.
      return "info"
  }
}

function outcomeLabel(t: TFunc, outcome: WriteOutcome): string {
  switch (outcome) {
    case "Applied":
      return t("machineDetail.control.outcome.applied")
    case "Rejected":
      return t("machineDetail.control.outcome.rejected")
    case "Failed":
      return t("machineDetail.control.outcome.failed")
    case "Indeterminate":
    default:
      return t("machineDetail.control.outcome.indeterminate")
  }
}

function rejectionReasonLabel(t: TFunc, reason: string | null): string | null {
  if (reason === null) return null
  const key = `machineDetail.control.rejectionReason.${reason}`
  const label = t(key)
  // Falls back to the raw reason code for a value this UI doesn't have a translation for yet — never a
  // raw i18n key leaking to an operator (the AlarmCenter/driverKind idiom this codebase already uses).
  return label === key ? reason : label
}

function OutcomeBanner({
  t,
  outcome,
  rejectionReason,
  detail,
}: {
  t: TFunc
  outcome: WriteOutcome
  rejectionReason: string | null
  detail: string | null
}) {
  const reasonLabel = rejectionReasonLabel(t, rejectionReason)
  return (
    <div className="flex flex-col gap-1 border border-border bg-surface-subtle p-2.5" role={outcome === "Indeterminate" ? "alert" : "status"}>
      <div className="flex items-center gap-2">
        <StatusBadge status={outcomeStatus(outcome)}>{outcomeLabel(t, outcome)}</StatusBadge>
        {outcome === "Indeterminate" ? <AlertTriangle className="size-3.5 text-info-text" aria-hidden="true" /> : null}
      </div>
      {outcome === "Indeterminate" ? (
        <p className="text-xs font-medium text-text-strong">{t("machineDetail.control.outcome.indeterminateGuidance")}</p>
      ) : null}
      {reasonLabel ? <p className="text-xs text-text-muted">{reasonLabel}</p> : null}
      {detail ? <p className="text-xs text-text-muted">{detail}</p> : null}
    </div>
  )
}

function NotAvailableBanner({ message }: { message: string }) {
  return (
    <p className="border border-danger/30 bg-danger/10 p-2.5 text-xs text-danger-text" role="alert">
      {message}
    </p>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Setpoints — Engineer+.
// ─────────────────────────────────────────────────────────────────────────

function SetpointRow({
  t,
  gloss,
  machineCode,
  point,
  canWrite,
}: {
  t: TFunc
  gloss: GlossFunc
  machineCode: string
  point: ConnectorWritablePointGrant
  canWrite: boolean
}) {
  const isBool = isBooleanPoint(point)
  const [boolValue, setBoolValue] = React.useState(false)
  const [numericValue, setNumericValue] = React.useState("")
  const [validationError, setValidationError] = React.useState<string | null>(null)
  const [result, setResult] = React.useState<SetpointWriteResult | null>(null)
  const [notAvailable, setNotAvailable] = React.useState<string | null>(null)
  const write = useWriteMachineSetpoint(machineCode)

  function handleSubmit() {
    setValidationError(null)
    setNotAvailable(null)
    let value: number | boolean
    if (isBool) {
      value = boolValue
    } else {
      const parsed = Number(numericValue)
      if (numericValue.trim() === "" || Number.isNaN(parsed)) {
        setValidationError(t("machineDetail.control.points.invalidValue"))
        return
      }
      value = parsed
    }
    write.mutate(
      { point: point.name, value },
      {
        onSuccess: (response) => setResult(response.result),
        onError: (err) => {
          setResult(null)
          setNotAvailable(err instanceof MachineWriteApiError && err.serverMessage ? err.serverMessage : t("machineDetail.control.errorGeneric"))
        },
      }
    )
  }

  return (
    <div className="flex flex-col gap-2 border border-border bg-surface-card p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-heading text-sm font-semibold text-text-strong">{point.name}</span>
        <span className="font-mono text-[11px] text-text-muted">{point.target}</span>
      </div>
      {isBool ? (
        <p className="hmi-micro">{t("machineDetail.control.points.boolHint")}</p>
      ) : (
        <p className="hmi-micro">{t("machineDetail.control.points.boundsHint", { min: point.min ?? 0, max: point.max ?? 0 })}</p>
      )}

      {canWrite ? (
        <div className="flex flex-wrap items-end gap-2">
          {isBool ? (
            <label htmlFor={`setpoint-${machineCode}-${point.name}`} className="flex items-center gap-2">
              <span className="flex flex-col gap-0">
                <span className="text-xs font-medium text-text-body">{t("machineDetail.control.points.valueLabel")}</span>
                <span className="hmi-micro" aria-hidden="true">
                  {gloss("machineDetail.control.points.valueLabel")}
                </span>
              </span>
              <Switch id={`setpoint-${machineCode}-${point.name}`} checked={boolValue} onCheckedChange={setBoolValue} disabled={write.isPending} />
            </label>
          ) : (
            <FormField
              label={t("machineDetail.control.points.valueLabel")}
              labelEn={gloss("machineDetail.control.points.valueLabel")}
              htmlFor={`setpoint-${machineCode}-${point.name}`}
              className="min-w-32"
            >
              <Input
                id={`setpoint-${machineCode}-${point.name}`}
                type="number"
                min={point.min ?? undefined}
                max={point.max ?? undefined}
                value={numericValue}
                onChange={(e) => setNumericValue(e.target.value)}
                disabled={write.isPending}
                className="font-numeric"
              />
            </FormField>
          )}
          <Button type="button" size="sm" onClick={handleSubmit} disabled={write.isPending}>
            {write.isPending ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Send className="size-3.5" aria-hidden="true" />}
            {write.isPending ? t("machineDetail.control.points.writing") : t("machineDetail.control.points.submit")}
          </Button>
        </div>
      ) : (
        <p className="text-xs text-text-muted">{t("machineDetail.control.roleRequiredEngineer")}</p>
      )}

      {validationError ? (
        <p className="text-xs text-danger-text" role="alert">
          {validationError}
        </p>
      ) : null}
      {notAvailable ? <NotAvailableBanner message={notAvailable} /> : null}
      {result ? <OutcomeBanner t={t} outcome={result.outcome} rejectionReason={result.rejectionReason} detail={result.detail} /> : null}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Commands — Admin+, always behind a confirmation dialog.
// ─────────────────────────────────────────────────────────────────────────

function CommandConfirmDialog({
  t,
  open,
  onOpenChange,
  machineCode,
  command,
  onConfirmed,
}: {
  t: TFunc
  open: boolean
  onOpenChange: (open: boolean) => void
  machineCode: string
  command: ConnectorCommandGrant
  onConfirmed: (result: CommandResult | { notAvailable: string }) => void
}) {
  const [argumentsJson, setArgumentsJson] = React.useState("")
  const [argumentsError, setArgumentsError] = React.useState<string | null>(null)
  const invoke = useInvokeMachineCommand(machineCode)

  React.useEffect(() => {
    // Fresh confirmation every time the dialog (re)opens — same discipline `Site.tsx`'s
    // `RotateIdentityDialog` uses, so a second invocation never inherits a stale argument blob.
    if (open) {
      setArgumentsJson("")
      setArgumentsError(null)
    }
  }, [open])

  function parseArguments(): Record<string, number | boolean | string> | undefined | false {
    const trimmed = argumentsJson.trim()
    if (trimmed === "") return undefined
    try {
      const parsed: unknown = JSON.parse(trimmed)
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        setArgumentsError(t("machineDetail.control.commands.argumentsInvalid"))
        return false
      }
      return parsed as Record<string, number | boolean | string>
    } catch {
      setArgumentsError(t("machineDetail.control.commands.argumentsInvalid"))
      return false
    }
  }

  function handleConfirm() {
    setArgumentsError(null)
    const parsedArguments = parseArguments()
    if (parsedArguments === false) return
    invoke.mutate(
      { command: command.name, arguments: parsedArguments },
      {
        onSuccess: (response) => {
          onConfirmed(response.result)
          onOpenChange(false)
        },
        onError: (err) => {
          onConfirmed({
            notAvailable: err instanceof MachineWriteApiError && err.serverMessage ? err.serverMessage : t("machineDetail.control.errorGeneric"),
          })
          onOpenChange(false)
        },
      }
    )
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !invoke.isPending && onOpenChange(next)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("machineDetail.control.commands.confirmTitle", { command: command.name })}</DialogTitle>
          <DialogDescription>{t("machineDetail.control.commands.confirmDescription", { machineCode, command: command.name })}</DialogDescription>
        </DialogHeader>
        <FormField
          label={t("machineDetail.control.commands.argumentsLabel")}
          hint={t("machineDetail.control.commands.argumentsHint")}
          htmlFor={`command-args-${machineCode}-${command.name}`}
        >
          <textarea
            id={`command-args-${machineCode}-${command.name}`}
            value={argumentsJson}
            onChange={(e) => setArgumentsJson(e.target.value)}
            placeholder={'{"speed": 100}'}
            rows={3}
            disabled={invoke.isPending}
            className="w-full min-w-0 rounded-[var(--radius)] border border-border-strong bg-surface-muted px-2.5 py-1.5 font-mono text-xs text-text-body transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-[var(--focus)] focus-visible:ring-2 focus-visible:ring-[var(--focus)]/40 disabled:cursor-not-allowed disabled:opacity-50"
          />
        </FormField>
        {argumentsError ? (
          <p className="text-xs text-danger-text" role="alert">
            {argumentsError}
          </p>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={invoke.isPending}>
            {t("machineDetail.control.commands.cancel")}
          </Button>
          <Button type="button" variant="destructive" onClick={handleConfirm} disabled={invoke.isPending}>
            {invoke.isPending ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Zap className="size-3.5" aria-hidden="true" />}
            {invoke.isPending ? t("machineDetail.control.commands.invoking") : t("machineDetail.control.commands.confirmSubmit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CommandRow({
  t,
  machineCode,
  command,
  canInvoke,
}: {
  t: TFunc
  machineCode: string
  command: ConnectorCommandGrant
  canInvoke: boolean
}) {
  const [confirmOpen, setConfirmOpen] = React.useState(false)
  const [result, setResult] = React.useState<CommandResult | null>(null)
  const [notAvailable, setNotAvailable] = React.useState<string | null>(null)

  function handleConfirmed(outcome: CommandResult | { notAvailable: string }) {
    if ("notAvailable" in outcome) {
      setResult(null)
      setNotAvailable(outcome.notAvailable)
    } else {
      setNotAvailable(null)
      setResult(outcome)
    }
  }

  return (
    <div className="flex flex-col gap-2 border border-border bg-surface-card p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-heading text-sm font-semibold text-text-strong">{command.name}</span>
        <span className="font-mono text-[11px] text-text-muted">{command.target}</span>
      </div>

      {canInvoke ? (
        <Button type="button" variant="destructive" size="sm" className="w-fit" onClick={() => setConfirmOpen(true)}>
          <Zap className="size-3.5" aria-hidden="true" />
          {t("machineDetail.control.commands.invoke")}
        </Button>
      ) : (
        <p className="text-xs text-text-muted">{t("machineDetail.control.roleRequiredAdmin")}</p>
      )}

      {notAvailable ? <NotAvailableBanner message={notAvailable} /> : null}
      {result ? <OutcomeBanner t={t} outcome={result.outcome} rejectionReason={result.rejectionReason} detail={result.detail} /> : null}

      <CommandConfirmDialog
        t={t}
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        machineCode={machineCode}
        command={command}
        onConfirmed={handleConfirmed}
      />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Panel — reads the machine's own connector's declared write capability.
// ─────────────────────────────────────────────────────────────────────────

export function MachineControlPanel({ machineCode }: { machineCode: string }) {
  const t = useT()
  const gloss = useGloss()
  const { user } = useAuth()
  const { data: connectors, isPending, isError } = useConfiguredConnectors()

  const canWriteSetpoint = meetsMinRole("Engineer", user?.role)
  const canInvokeCommand = meetsMinRole("Admin", user?.role)

  if (isPending) {
    return (
      <Sheet className="max-w-4xl" bodyClassName="flex flex-col gap-3">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
      </Sheet>
    )
  }

  if (isError) {
    return (
      <Sheet className="max-w-4xl">
        <p className="text-sm text-danger-text">{t("machineDetail.control.loadFailed")}</p>
      </Sheet>
    )
  }

  const connector = (connectors ?? []).find((c) => c.machineCode === machineCode)
  const capability = connector?.writeCapability
  const points = capability?.writablePoints ?? []
  const commands = capability?.commands ?? []

  if (!capability?.grantsWriteCapability || (points.length === 0 && commands.length === 0)) {
    return (
      <Sheet className="max-w-4xl" bodyClassName="flex flex-col items-center gap-2 py-8 text-center">
        <Radio className="size-6 text-text-muted" aria-hidden="true" />
        <h3 className="font-heading text-sm font-semibold text-text-strong">{t("machineDetail.control.noCapability.title")}</h3>
        <p className="max-w-md text-sm text-text-muted">{t("machineDetail.control.noCapability.description")}</p>
      </Sheet>
    )
  }

  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <p className="text-sm text-text-muted">{t("machineDetail.control.description")}</p>

      <Sheet title={t("machineDetail.control.points.title")} titleEn={gloss("machineDetail.control.points.title")} bodyClassName="flex flex-col gap-3">
        {points.length === 0 ? (
          <p className="text-sm text-text-muted">{t("machineDetail.control.points.empty")}</p>
        ) : (
          points.map((point) => (
            <SetpointRow key={point.name} t={t} gloss={gloss} machineCode={machineCode} point={point} canWrite={canWriteSetpoint} />
          ))
        )}
      </Sheet>

      <Sheet title={t("machineDetail.control.commands.title")} titleEn={gloss("machineDetail.control.commands.title")} bodyClassName="flex flex-col gap-3">
        {commands.length === 0 ? (
          <p className="text-sm text-text-muted">{t("machineDetail.control.commands.empty")}</p>
        ) : (
          commands.map((command) => (
            <CommandRow key={command.name} t={t} machineCode={machineCode} command={command} canInvoke={canInvokeCommand} />
          ))
        )}
      </Sheet>
    </div>
  )
}
