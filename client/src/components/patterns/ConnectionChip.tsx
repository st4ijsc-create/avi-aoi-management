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
import { relTimeShort } from "@/lib/format";

/**
 * doc 67 W7 GĐ1 — mở rộng thêm bộ ba nguồn-dữ-liệu "live | polling | offline"
 * (thay LiveBadge/pill LIVE-POLLING local ở Control Tower / OpsConsole / Andon):
 *   • live    → success (socket đang đẩy sự kiện)
 *   • polling → warning (rơi về poll định kỳ — dữ liệu có thể trễ)
 *   • offline → muted   (mất kết nối — KHÔNG giả vờ tươi)
 * Các state cũ (connected/connecting/…) GIỮ NGUYÊN — backward-compatible.
 */
export type ConnectionState =
  | "connected"
  | "connecting"
  | "disconnected"
  | "error"
  | "unknown"
  | "live"
  | "polling"
  | "offline";

export interface ConnectionChipProps {
  state: ConnectionState;
  /** Override the displayed text (defaults to a per-state label). */
  label?: string;
  /** Animate the dot while connected/connecting (respects prefers-reduced-motion). */
  pulse?: boolean;
  /**
   * Mốc sự kiện dữ liệu gần nhất (ms epoch) — hiển thị tuổi "· 5s/3m/2h" qua
   * relTimeShort, tự tick 10s. Bỏ trống → không hiển thị (hành vi cũ).
   */
  lastEventAt?: number;
  /** `tv` = cỡ lớn cho bảng treo tường / kiosk nhìn xa (doc 67 W7). */
  size?: "sm" | "md" | "tv";
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
  // ── doc 67 W7 — nguồn dữ liệu (token semantic: success/warning/muted) ──────
  live: {
    chip: "border-success/30 bg-success/15 text-success",
    dot: "bg-success",
    label: "LIVE",
    live: true,
  },
  polling: {
    chip: "border-warning/30 bg-warning/15 text-warning",
    dot: "bg-warning",
    label: "POLLING",
    live: true,
  },
  offline: {
    chip: "border-border bg-muted text-muted-foreground",
    dot: "bg-muted-foreground",
    label: "OFFLINE",
    live: false,
  },
};

const SIZE = {
  sm: { pill: "gap-1.5 px-2 py-0.5 text-[11px]", dot: "size-1.5" },
  md: { pill: "gap-2 px-2.5 py-1 text-xs", dot: "size-2" },
  // TV/kiosk: đọc được từ xa (ISA-101), đồng bộ với các bảng treo tường.
  tv: { pill: "gap-2.5 px-3.5 py-1.5 text-base font-semibold", dot: "size-3" },
} as const;

export function ConnectionChip({
  state,
  label,
  pulse = false,
  lastEventAt,
  size = "md",
  className,
}: ConnectionChipProps): React.JSX.Element {
  const cfg = STATE_CONFIG[state];
  const sz = SIZE[size];
  const text = label ?? cfg.label;
  const animate = pulse && cfg.live;

  // Tuổi sự kiện tự tick 10s (chỉ khi có lastEventAt — không thêm timer vô ích).
  const [, bump] = React.useReducer((c: number) => c + 1, 0);
  const hasAge = lastEventAt != null;
  React.useEffect(() => {
    if (!hasAge) return;
    const id = setInterval(bump, 10_000);
    return () => clearInterval(id);
  }, [hasAge]);

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
      {lastEventAt != null && (
        <span className="tabular-nums opacity-75" aria-label={`Last event ${relTimeShort(lastEventAt)} ago`}>
          · {relTimeShort(lastEventAt)}
        </span>
      )}
    </span>
  );
}

export default ConnectionChip;
