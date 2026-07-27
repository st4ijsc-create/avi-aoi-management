import * as React from "react"
import { motion } from "framer-motion"
import type { VariantProps } from "class-variance-authority"
import { Loader2, OctagonX, Pause, Play, RotateCcw, Square, Workflow } from "lucide-react"
import { toast } from "sonner"

import { useGloss } from "@/components/hmi/bilingual"
import { useT } from "@/i18n"
import { useAuth } from "@/lib/auth"
import { LineCommandError, useLine, useLineCommand, type LineCommand, type PackMlState } from "@/lib/api"
import { fadeSlideUp } from "@/theme/motion"
import { Sheet } from "@/components/industrial"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { StatusBadge, type statusBadgeVariants } from "@/components/ui/status-badge"

/**
 * GĐ3 sub-4 LC-4 (`.superpowers/sdd/2026-07-27-giaidoan3-alarms-linecontroller-blueprint/
 * task-4-brief.md`) — `/line`: the operator UI over LC-3's supervisory PackML state machine
 * (`LineController`, `LineEndpoints.cs`). A dedicated route (not a Dashboard card) — `Dashboard.tsx`'s
 * own layout is already a tight KPI row + machine grid (or the empty/ecosystem-connect state) with no
 * reserved "fleet controls" region, and `TopBar.tsx` already owns a DIFFERENT, fleet-level Start/Stop
 * pair (`FleetHost.Start`/`Stop`, the whole simulated fleet's power switch) — shoehorning a SECOND,
 * PackML-level control surface into the KPI strip would visually conflate the two, so this gets its own
 * page, same "its own route" choice EC-4 made for `/site` over cramming a Site-link form onto
 * Dashboard.
 *
 * Same "reads are Operator, one control surface is gated" shape `Site.tsx`/`AssetRegistry.tsx`
 * established — `RequireRole role="Operator"` here is a structural/defense-in-depth wrap only (Operator
 * is the lowest role, so every signed-in user already passes it); the server's own `Policies.Operator`
 * on `POST /v1/line/{command}` is the real enforcement.
 */

type BadgeStatus = NonNullable<VariantProps<typeof statusBadgeVariants>["status"]>

const ROLE_RANK: Record<string, number> = { Operator: 0, Engineer: 1, Admin: 2 }

function meetsMinRole(minRole: string, userRole: string | undefined): boolean {
  if (!userRole) return false
  return (ROLE_RANK[userRole] ?? -1) >= (ROLE_RANK[minRole] ?? Number.POSITIVE_INFINITY)
}

/** Client-side gate for the command buttons only — the server's own `Policies.Operator` is the real
 * enforcement. Renders nothing for anyone below `role` (same "just hide it" shape `Site.tsx`'s own
 * `RequireRole` uses, as opposed to `AssetRegistry.tsx`'s inline fallback note — there's no meaningful
 * read-only summary to show in its place here, the status Sheet above already covers that). */
function RequireRole({ role, children }: { role: string; children: React.ReactNode }) {
  const { user } = useAuth()
  if (!meetsMinRole(role, user?.role)) return null
  return <>{children}</>
}

/** PackML state → `StatusBadge` tone — a clean bijection over the app's 5 tones, same "one state, one
 * tone" discipline `LIFECYCLE_TONE` (`AssetRegistry.tsx`)/`BRIDGE_STATUS_BADGE` (`Site.tsx`) already
 * use elsewhere: `Execute` is the one genuinely-`ok` state (line actually running); `Held`/`Aborted`
 * are the two that must visually "stand out" (brief) — `warn`/`danger` respectively, matching their
 * real severity (a resumable pause vs. a commanded E-STOP); `Idle` (nothing commanded yet) is
 * `neutral`; `Stopped` (a deliberate, non-alarming halt) is `info`. */
const STATE_TONE: Record<PackMlState, BadgeStatus> = {
  Idle: "neutral",
  Execute: "ok",
  Held: "warn",
  Stopped: "info",
  Aborted: "danger",
}

/**
 * Mirrors `LineController.Execute`'s own transition table (`Line/LineController.cs`) — every entry
 * here is the exact same {from-states} → command legality that class's doc comment documents, so the
 * UI never offers a command the server would 409-reject. `abort` is the one deliberate exception: the
 * backend itself rejects an Abort from an already-`Aborted` line (`ExecuteAbort`'s own guard — "the
 * line is already Aborted"), but a real E-STOP control is conventionally NEVER greyed out (an operator
 * must never wonder why the panic button is disabled) — brief: "Abort styled as the prominent emergency
 * action (always enabled)". The one harmless redundant-Abort 409 surfaces as the same inline message
 * every other rejected command does, rather than being hidden behind a disabled button.
 */
const VALID_FROM: Record<LineCommand, PackMlState[] | "always"> = {
  start: ["Idle", "Stopped"],
  hold: ["Execute"],
  unhold: ["Held"],
  stop: ["Execute", "Held"],
  abort: "always",
  reset: ["Stopped", "Aborted"],
}

function isCommandEnabled(cmd: LineCommand, state: PackMlState | undefined): boolean {
  if (!state) return false
  const rule = VALID_FROM[cmd]
  return rule === "always" ? true : rule.includes(state)
}

const COMMAND_BUTTONS: {
  cmd: LineCommand
  icon: React.ComponentType<{ className?: string }>
  variant: "default" | "outline" | "destructive"
}[] = [
  { cmd: "start", icon: Play, variant: "default" },
  { cmd: "hold", icon: Pause, variant: "outline" },
  { cmd: "unhold", icon: Play, variant: "outline" },
  { cmd: "stop", icon: Square, variant: "outline" },
  { cmd: "abort", icon: OctagonX, variant: "destructive" },
  { cmd: "reset", icon: RotateCcw, variant: "outline" },
]

function DetailField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[11px] font-semibold tracking-wide text-text-muted uppercase">{label}</dt>
      <dd className="text-sm text-text-body">{children}</dd>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Status Sheet — the live PackML state badge (`useLine`, polled 3s) + holdReason/isRunning/estopEngaged
// readouts.
// ─────────────────────────────────────────────────────────────────────────

function LineStatusCard() {
  const t = useT()
  const gloss = useGloss()
  const { data, isPending, isError } = useLine()

  const badge = data ? (
    <StatusBadge status={STATE_TONE[data.state]}>{t(`line.state.${data.state}`)}</StatusBadge>
  ) : null

  return (
    <Sheet title={t("line.status.title")} titleEn={gloss("line.status.title")} headerRight={badge} bodyClassName="flex flex-col gap-4">
      {isError ? (
        <p className="text-sm text-danger-text">{t("line.status.loadFailed")}</p>
      ) : isPending || !data ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-2/3" />
        </div>
      ) : (
        <>
          {/* Raw `holdReason` text ("operator hold" / "critical alarm active") comes straight off
              `LineController` in English regardless of the active UI language — shown verbatim inside
              the translated wrapper sentence, same "server's own text embedded, never re-localized"
              idiom `Site.tsx`'s `site.status.lastError` already uses for `SiteStatus.lastError`. */}
          {data.holdReason ? (
            <p className="text-sm text-warn-text">{t("line.status.holdReason", { reason: data.holdReason })}</p>
          ) : null}
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
            <DetailField label={t("line.status.pipelineLabel")}>
              <StatusBadge status={data.isRunning ? "ok" : "neutral"}>
                {data.isRunning ? t("line.status.running") : t("line.status.notRunning")}
              </StatusBadge>
            </DetailField>
            <DetailField label={t("line.status.estopLabel")}>
              <StatusBadge status={data.estopEngaged ? "danger" : "neutral"}>
                {data.estopEngaged ? t("line.status.estopEngaged") : t("line.status.estopClear")}
              </StatusBadge>
            </DetailField>
          </dl>
        </>
      )}
    </Sheet>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Command Sheet — Start/Hold/Unhold/Stop/Abort/Reset, disabled per `VALID_FROM` above; a rejected
// (409) command shows the server's own reason text inline.
// ─────────────────────────────────────────────────────────────────────────

function LineCommandsCard() {
  const t = useT()
  const gloss = useGloss()
  const { data } = useLine()
  const command = useLineCommand()
  const [pendingCmd, setPendingCmd] = React.useState<LineCommand | null>(null)
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null)

  const state = data?.state

  function handleCommand(cmd: LineCommand) {
    setErrorMessage(null)
    setPendingCmd(cmd)
    command.mutate(cmd, {
      onSuccess: (result) => {
        setPendingCmd(null)
        toast.success(t("toast.lineCommandApplied", { state: t(`line.state.${result.state}`) }))
      },
      onError: (err) => {
        setPendingCmd(null)
        const message = err instanceof LineCommandError ? (err.serverMessage ?? t("line.errors.generic")) : t("line.errors.generic")
        setErrorMessage(message)
        toast.error(t("toast.lineCommandFailed"))
      },
    })
  }

  return (
    <Sheet title={t("line.commands.title")} titleEn={gloss("line.commands.title")} bodyClassName="flex flex-col gap-3">
      <RequireRole role="Operator">
        <div className="flex flex-wrap gap-2">
          {COMMAND_BUTTONS.map(({ cmd, icon: Icon, variant }) => {
            const enabled = isCommandEnabled(cmd, state)
            const pending = pendingCmd === cmd && command.isPending
            return (
              <Button
                key={cmd}
                type="button"
                variant={variant}
                disabled={!enabled || command.isPending}
                onClick={() => handleCommand(cmd)}
                aria-label={t(`line.commands.${cmd}Aria`)}
              >
                {pending ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <Icon className="size-3.5" aria-hidden="true" />
                )}
                {t(`line.commands.${cmd}`)}
              </Button>
            )
          })}
        </div>
      </RequireRole>

      {errorMessage ? (
        <p role="alert" className="text-xs text-danger-text">
          {errorMessage}
        </p>
      ) : null}
    </Sheet>
  )
}

function LineControlScreen() {
  const t = useT()
  const gloss = useGloss()

  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={fadeSlideUp}
      className="flex h-full min-h-0 flex-col gap-4 p-4 lg:p-6"
    >
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <Workflow className="size-5 text-primary-text" aria-hidden="true" />
          <h1 className="font-heading text-[26px] leading-none font-semibold tracking-tight text-text-strong">
            {t("line.title")}
          </h1>
        </div>
        <p className="hmi-micro mt-1">{gloss("line.title")}</p>
        <p className="mt-1 max-w-3xl text-sm text-text-muted">{t("line.description")}</p>
      </div>

      <div className="hmi-scroll min-h-0 flex-1 overflow-y-auto">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <LineStatusCard />
          <LineCommandsCard />
        </div>
      </div>
    </motion.div>
  )
}

export default function LineControl() {
  return <LineControlScreen />
}
