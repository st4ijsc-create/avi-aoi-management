/**
 * doc 63 (P6 FEA-M2/M4/M5/M6) — ISA state badges. Quiet, outlined pills whose colour comes
 * only from the stateVocabulary token (var()), keeping PackML / SEMI-E10 / alarm / Andon
 * visually SEPARATE (AUD-09). A coloured dot (pulsing for transient states) plus the label
 * mean colour is never the sole channel (ISA-101 / WCAG 1.4.1). Unknown states fall back to
 * neutral grey — never a guessed colour.
 */
import { cn } from "@/lib/utils";
import { resolveStateToken, type StateFamily } from "@/lib/stateVocabulary";

const NEUTRAL = "--isa-graphic-muted";

function StateBadge({
  varName,
  label,
  transient,
  title,
  className,
}: {
  varName: string;
  label: string;
  transient?: boolean;
  title?: string;
  className?: string;
}) {
  return (
    <span
      role="status"
      title={title ?? label}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium leading-none",
        className,
      )}
      style={{ color: `var(${varName})`, borderColor: `var(${varName})` }}
    >
      <span
        className={cn("size-2 shrink-0 rounded-full", transient && "animate-pulse")}
        style={{ backgroundColor: `var(${varName})` }}
        aria-hidden="true"
      />
      <span className="truncate">{label}</span>
    </span>
  );
}

function badgeFor(family: StateFamily) {
  return function Badge({ state, label, className }: { state: string; label?: string; className?: string }) {
    const tok = resolveStateToken(family, state);
    const text = label ?? state;
    return (
      <StateBadge
        varName={tok?.varName ?? NEUTRAL}
        label={text}
        transient={tok?.transient}
        title={`${family}: ${state}`}
        className={className}
      />
    );
  };
}

/** PackML 17-state op-state badge (WAIT vs ACTING distinguished by the pulsing dot). */
export const PackmlStateBadge = badgeFor("packml");
/** SEMI E10 6-state availability badge — palette distinct from PackML. */
export const E10StateBadge = badgeFor("e10");
/** Andon signal badge — 'call' is always its own level (AUD-09 fix). */
export const AndonBadge = badgeFor("andon");
/** PackML unit-mode chip (Production / Maintenance / Manual). */
export const UnitModeChip = badgeFor("unitmode");
