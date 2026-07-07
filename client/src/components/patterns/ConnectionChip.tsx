/**
 * DS Wave-2 — <ConnectionChip> (doc 16 §12.2 micro-primitives).
 *
 * A compact status pill for live connection state — MQTT / OT link / socket /
 * device. Replaces the ad-hoc "green dot + text" spans re-implemented per page.
 * Tones use the SEMANTIC design tokens as soft tints (bg-tint + matching text +
 * border), identical in spirit to <StatusBadge>, so it is AA-legible and flips
 * correctly between light and dark (NEVER hardcoded hex).
 *
 * The status dot can `pulse` while connected/connecting to signal liveness; the
 * animation is gated behind `motion-safe:` so it honours `prefers-reduced-motion`.
 *
 * @example
 *   <ConnectionChip state={socket.connected ? "connected" : "disconnected"} pulse />
 *   <ConnectionChip state="error" label="MQTT broker" size="sm" />
 */
import * as React from "react";
import { cn } from "@/lib/utils";

export type ConnectionState = "connected" | "connecting" | "disconnected" | "error" | "unknown";

export interface ConnectionChipProps {
  state: ConnectionState;
  /** Override the displayed text (defaults to a per-state label). */
  label?: string;
  /** Animate the dot while connected/connecting (respects prefers-reduced-motion). */
  pulse?: boolean;
  size?: "sm" | "md";
  className?: string;
}

interface StateConfig {
  /** Soft-tint pill classes (border + bg + text). */
  chip: string;
  /** Dot fill class. */
  dot: string;
  /** Default label. */
  label: string;
  /** Whether this state represents an active link (eligible for pulse). */
  live: boolean;
}

const STATE_CONFIG: Record<ConnectionState, StateConfig> = {
  connected: {
    chip: "border-success/30 bg-success/15 text-success",
    dot: "bg-success",
    label: "Connected",
    live: true,
  },
  connecting: {
    chip: "border-warning/30 bg-warning/15 text-warning",
    dot: "bg-warning",
    label: "Connecting",
    live: true,
  },
  disconnected: {
    chip: "border-border bg-muted text-muted-foreground",
    dot: "bg-muted-foreground",
    label: "Disconnected",
    live: false,
  },
  error: {
    chip: "border-destructive/30 bg-destructive/15 text-destructive",
    dot: "bg-destructive",
    label: "Error",
    live: false,
  },
  unknown: {
    chip: "border-border bg-muted text-muted-foreground",
    dot: "bg-muted-foreground/60",
    label: "Unknown",
    live: false,
  },
};

const SIZE = {
  sm: { pill: "gap-1.5 px-2 py-0.5 text-[11px]", dot: "size-1.5" },
  md: { pill: "gap-2 px-2.5 py-1 text-xs", dot: "size-2" },
} as const;

export function ConnectionChip({
  state,
  label,
  pulse = false,
  size = "md",
  className,
}: ConnectionChipProps): React.JSX.Element {
  const cfg = STATE_CONFIG[state];
  const sz = SIZE[size];
  const text = label ?? cfg.label;
  const animate = pulse && cfg.live;

  return (
    <span
      role="status"
      aria-live="polite"
      aria-label={`Connection: ${text}`}
      className={cn(
        "inline-flex items-center rounded-full border font-medium leading-none",
        sz.pill,
        cfg.chip,
        className,
      )}
    >
      <span className={cn("relative flex shrink-0", sz.dot)} aria-hidden="true">
        {animate && (
          <span
            className={cn(
              "absolute inline-flex h-full w-full rounded-full opacity-75 motion-safe:animate-ping",
              cfg.dot,
            )}
          />
        )}
        <span className={cn("relative inline-flex rounded-full", sz.dot, cfg.dot)} />
      </span>
      {text}
    </span>
  );
}

export default ConnectionChip;
