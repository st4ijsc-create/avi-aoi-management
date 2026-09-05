import { ControlButton, type ControlButtonVariant } from "@/components/industrial"
import { useWritePermissionResolution } from "../writePermissionChannel.ts"
import type { WidgetProps } from "../widgetRegistry.ts"
import { asRecord, policyGate } from "./shared.ts"

const KNOWN_VARIANTS = new Set<ControlButtonVariant>(["start", "pause", "reset", "estop"])

/**
 * `kind: "command-button"` — wraps `ControlButton`.
 *
 * 🔴 SAFETY (plan §5, task brief): the frozen schema REQUIRES `policyAction` whenever
 * `kind === "command-button"` — but that guarantee only holds for a document that actually validated
 * against the schema, and this runtime must not assume every document that reaches it did (a document
 * from an unexpected source is exactly the case this matters for). `policyGate` (`shared.ts`) is the
 * ONE place that decision gets made; `widgetRegistry.test.mjs` pins `policyGate` directly AND asserts
 * this file's own source text actually calls it, so this component and that test cannot quietly drift
 * apart.
 *
 * 🔴 WS-HMI-2 Task 6, controller ruling — the schema constrains not only the PRESENCE of that field
 * but its VALUE (`enum: ["machine.setpoint", "machine.command"]`), and `policyGate` now checks
 * membership rather than truthiness. Before that fix an unrecognised action rendered this button
 * ENABLED with no reason shown — the same untrusted-document case this comment already argued about,
 * answered the opposite way from how `ScreenRenderer` answers it for an unknown `kind`.
 *
 * Does NOT interpret `bindings.value` — `screen-screwdrive-full.json`'s "reset" widget sets one, but
 * nothing in this widget reads it today; that's free-form schema flexibility with no assigned meaning
 * yet, not a silently-dropped feature.
 *
 * Does NOT dispatch the actual write (no `POST /v1/machines/{code}/command` call happens here) — wiring
 * an enabled control to `lib/api.ts`'s `useInvokeMachineCommand` needs a machine code and an
 * authenticated role this generic widget has no access to; that belongs to whichever later task/
 * workstream actually wires a screen to a live machine, not to the registry built here.
 */
export function CommandButtonWidget(props: WidgetProps) {
  const { widget } = props
  const p = asRecord(widget.props)
  // 🔴 Session S1 (S-6) — the engine's per-session verdict, read from context and handed to `policyGate`
  // as DATA. The gate stays a pure JSX-free function so `widgetRegistry.test.mjs` keeps executing the
  // real thing directly; the hook lives here, in the `.tsx`, where a hook belongs.
  const gate = policyGate(widget, useWritePermissionResolution())
  const variant: ControlButtonVariant =
    typeof p.variant === "string" && KNOWN_VARIANTS.has(p.variant as ControlButtonVariant)
      ? (p.variant as ControlButtonVariant)
      : "start"
  const label = typeof p.label === "string" ? p.label : widget.id
  const labelEn = typeof p.labelEn === "string" ? p.labelEn : undefined

  return (
    <div className="flex flex-col items-center gap-1">
      <ControlButton variant={variant} label={label} labelEn={labelEn} disabled={gate.disabled} />
      {gate.reason ? (
        <p role="note" className="max-w-40 text-center text-[11px] text-danger-text">
          {gate.reason}
        </p>
      ) : null}
    </div>
  )
}
