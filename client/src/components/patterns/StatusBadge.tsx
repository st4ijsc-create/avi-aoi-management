/**
 * DS F1b — <StatusBadge> (doc 16 §12.2).
 *
 * Maps a status string → semantic tone → a themed <Badge>. Replaces the
 * `taskStatusBadge` / `resStatusBadge` / `chargerStatusBadge` switch-helpers
 * duplicated across the fleet / safety / twin pages.
 *
 * Two ways to use it:
 *   1. Auto: <StatusBadge status="running" /> — a built-in keyword heuristic
 *      picks the tone (running/active→info, completed/ok→success, …).
 *   2. Explicit: <StatusBadge status="Custom" tone="warning" /> or pass a
 *      per-page `map` of status → {tone,label} for full control.
 *
 * Tones use the SEMANTIC tokens (success/warning/error/info) as soft tints
 * (bg-tint + matching text + border) so they are dark- and light-mode aware
 * and meet AA contrast (token foregrounds are tuned for this).
 */
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Tone } from "./tokens";

const TONE_CLASS: Record<Exclude<Tone, "accent">, string> = {
  default: "", // falls through to Badge variant="outline"
  success: "border-success/30 bg-success/15 text-success",
  warning: "border-warning/30 bg-warning/15 text-warning",
  error: "border-destructive/30 bg-destructive/15 text-destructive",
  info: "border-info/30 bg-info/15 text-info",
};

/** Keyword → tone heuristic. Lower-cased exact match first, then substring. */
const KEYWORD_TONE: Record<string, Exclude<Tone, "accent">> = {
  // success / healthy
  ok: "success", pass: "success", passed: "success", active: "success",
  available: "success", online: "success", done: "success", completed: "success",
  healthy: "success", connected: "success", released: "default",
  // info / in-progress
  running: "info", assigned: "info", in_use: "info", planned: "info",
  reserved: "warning", queued: "warning", pending: "warning",
  // warning
  warning: "warning", degraded: "warning", idle: "warning", maintenance: "warning",
  // error
  failed: "error", error: "error", fault: "error", ng: "error", offline: "error",
  down: "error", rejected: "error", lost_connection: "error", critical: "error",
};

function inferTone(status: string): Exclude<Tone, "accent"> {
  const s = status.toLowerCase().trim();
  if (s in KEYWORD_TONE) return KEYWORD_TONE[s];
  for (const [kw, tone] of Object.entries(KEYWORD_TONE)) {
    if (s.includes(kw)) return tone;
  }
  return "default";
}

export interface StatusBadgeProps {
  status: string;
  /** Force a tone, bypassing the heuristic. */
  tone?: Exclude<Tone, "accent">;
  /** Override the displayed label (defaults to `status`). */
  label?: React.ReactNode;
  /** Per-page override map: status → {tone,label}. Takes precedence. */
  map?: Record<string, { tone: Exclude<Tone, "accent">; label?: string }>;
  className?: string;
}

export function StatusBadge({ status, tone, label, map, className }: StatusBadgeProps) {
  const entry = map?.[status];
  const resolvedTone = tone ?? entry?.tone ?? inferTone(status);
  const text = label ?? entry?.label ?? status;

  if (resolvedTone === "default") {
    return (
      <Badge variant="outline" className={cn("text-muted-foreground", className)}>
        {text}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className={cn(TONE_CLASS[resolvedTone], className)}>
      {text}
    </Badge>
  );
}

export default StatusBadge;
