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
/** ISA-18.2 alarm priority badge — 4 DISTINCT hues (critical≠high, AUD-08 fix). */
export const AlarmPriorityBadge = badgeFor("alarm");

/* ════════════════════════════════════════════════════════════════════════════
 * doc 67 W7 GĐ1 — TONE CHUẨN (nguồn ISA-101 duy nhất cho ngưỡng KPI + severity).
 *
 * Hợp nhất các map local: PanelShell.oeeTone/TONE_TEXT, DrillNode.yieldTone,
 * opsconsole/model SEVERITY_DOT/SEVERITY_TILE, CommandCenter STATUS_DOT/
 * STATUS_HEX, AndonBoard TILE_CLASS/ANDON_STATE_DOT, ExecutiveMobile
 * severityTone. Chỉ dùng semantic token (text-success/…): tự lật light/dark.
 * ════════════════════════════════════════════════════════════════════════════ */

/**
 * Tông semantic dùng chung. `info` có trong union + các map class (để phủ cách
 * dùng "low → info" của OpsConsole nếu trang chủ động chọn), nhưng các hàm
 * ngưỡng/severity mặc định KHÔNG trả `info` (quyết định đã duyệt: low/info → muted).
 */
export type SemanticTone = "success" | "warning" | "danger" | "info" | "muted";

/** Tone → class chữ (dùng thẳng cho số KPI). */
export const TONE_TEXT_CLASS: Record<SemanticTone, string> = {
  success: "text-success",
  warning: "text-warning",
  danger: "text-destructive",
  info: "text-info",
  muted: "text-muted-foreground",
};

/** Tone → class chấm tròn (dot). */
export const TONE_DOT_CLASS: Record<SemanticTone, string> = {
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-destructive",
  info: "bg-info",
  muted: "bg-muted-foreground/50",
};

/** Tone → class nền tile mềm (soft-tint, an toàn light/dark — kiểu AndonBoard). */
export const TONE_TILE_CLASS: Record<SemanticTone, string> = {
  success: "border-success bg-success/10 text-foreground",
  warning: "border-warning bg-warning/15 text-foreground",
  danger: "border-destructive bg-destructive/15 text-foreground",
  info: "border-info bg-info/10 text-foreground",
  muted: "border-border bg-muted/60 text-muted-foreground",
};

/**
 * Ngưỡng OEE → tone (quyết định user ĐÃ DUYỆT — 80/60, khớp PanelShell):
 * ≥80 success · ≥60 warning · <60 danger · null/NaN → muted (không dữ liệu).
 */
export function oeeTone(v: number | null | undefined): SemanticTone {
  if (v == null || Number.isNaN(v)) return "muted";
  if (v >= 80) return "success";
  if (v >= 60) return "warning";
  return "danger";
}

/**
 * Ngưỡng yield → tone (khớp DrillNode.yieldTone đã commit W4):
 * ≥95 success · ≥90 warning · <90 danger · null/NaN → muted.
 */
export function yieldTone(v: number | null | undefined): SemanticTone {
  if (v == null || Number.isNaN(v)) return "muted";
  if (v >= 95) return "success";
  if (v >= 90) return "warning";
  return "danger";
}

const normSev = (s: string) => (s || "").trim().toLowerCase();

/**
 * Severity chuỗi tự do → tone. Phủ 4 cách dùng hiện có (opsconsole, CommandCenter
 * EcosystemSeverity, AndonBoard andonState, ExecutiveMobile):
 *   critical/high/error/fatal/red/call → danger · medium/warning/yellow → warning ·
 *   low/info/advisory/notice → muted (đã duyệt) · green/ok/normal → success ·
 *   còn lại/rỗng → muted (không đoán màu).
 */
export function severityTone(sev: string | null | undefined): SemanticTone {
  switch (normSev(sev ?? "")) {
    case "critical":
    case "crit":
    case "high":
    case "error":
    case "fatal":
    case "red":
    case "call":
      return "danger";
    case "medium":
    case "med":
    case "warning":
    case "warn":
    case "yellow":
      return "warning";
    case "green":
    case "ok":
    case "normal":
      return "success";
    default:
      // low / info / advisory / notice / chuỗi lạ → trung tính.
      return "muted";
  }
}

/** Severity → class chấm tròn (thay SEVERITY_DOT / ANDON_STATE_DOT local). */
export function severityDotClass(sev: string | null | undefined): string {
  return TONE_DOT_CLASS[severityTone(sev)];
}

/** Severity → class nền tile mềm (thay SEVERITY_TILE / TILE_CLASS local). */
export function severityTileClass(sev: string | null | undefined): string {
  return TONE_TILE_CLASS[severityTone(sev)];
}

/* ── stateHex — màu hex cho three.js / canvas (KHÔNG dùng được class CSS) ────
 * Đọc giá trị CSS var hiện hành (--success/--warning/--destructive/
 * --muted-foreground/--info — theo theme đang bật) và resolve oklch → hex qua
 * canvas 1×1 (cache theo GIÁ TRỊ raw nên tự đúng khi đổi theme). SSR/test
 * (không có DOM) → hex tĩnh fallback khớp bảng CommandCenter STATUS_HEX. */

const TONE_CSS_VAR: Record<SemanticTone, string> = {
  success: "--success",
  warning: "--warning",
  danger: "--destructive",
  info: "--info",
  // --muted là NỀN (gần đen ở dark) — dot/canvas cần --muted-foreground.
  muted: "--muted-foreground",
};

/** Fallback tĩnh (SSR/test/canvas hỏng) — khớp STATUS_HEX của CommandCenter. */
const TONE_HEX_FALLBACK: Record<SemanticTone, string> = {
  success: "#10b981",
  warning: "#f59e0b",
  danger: "#ef4444",
  info: "#3b82f6",
  muted: "#94a3b8",
};

const hexCache = new Map<string, string>();
let hexProbeCtx: CanvasRenderingContext2D | null | undefined;

function resolveCssColorToHex(raw: string, fallback: string): string {
  const cached = hexCache.get(raw);
  if (cached) return cached;
  try {
    if (hexProbeCtx === undefined) {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      hexProbeCtx = canvas.getContext("2d", { willReadFrequently: true });
    }
    const ctx = hexProbeCtx;
    if (!ctx) return fallback;
    // Sentinel: chuỗi hỏng thì canvas GIỮ fillStyle cũ → phát hiện được, trả fallback.
    ctx.fillStyle = "#010203";
    ctx.fillStyle = raw; // canvas hiểu oklch()/rgb()/hex
    if (ctx.fillStyle === "#010203" && raw !== "#010203") return fallback;
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    const hex = `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
    hexCache.set(raw, hex);
    return hex;
  } catch {
    return fallback;
  }
}

/** Tone → hex hiện hành (theo theme). Dùng khi trang đã có sẵn tone. */
export function toneHex(tone: SemanticTone): string {
  const fallback = TONE_HEX_FALLBACK[tone];
  if (typeof window === "undefined" || typeof document === "undefined") return fallback;
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue(TONE_CSS_VAR[tone])
    .trim();
  if (!raw) return fallback;
  return resolveCssColorToHex(raw, fallback);
}

/**
 * Trạng thái node chuỗi tự do → hex cho three.js/canvas (thay STATUS_HEX local).
 * Phủ NodeStatus CommandCenter (ok/warn/down/idle/unknown) + TileStatus
 * AndonBoard (good/warn/crit/andon/offline/idle) + severity thông dụng.
 * Không nhận diện được → muted (KHÔNG đoán màu).
 */
export function stateHex(state: string): string {
  switch (normSev(state)) {
    case "ok":
    case "good":
    case "green":
    case "success":
    case "run":
    case "running":
    case "online":
    case "normal":
    case "pass":
      return toneHex("success");
    case "warn":
    case "warning":
    case "yellow":
    case "degraded":
    case "held":
    case "suspended":
      return toneHex("warning");
    case "down":
    case "crit":
    case "critical":
    case "error":
    case "fault":
    case "fail":
    case "failed":
    case "red":
    case "andon":
    case "call":
    case "stop":
    case "stopped":
      return toneHex("danger");
    case "info":
      return toneHex("info");
    default:
      // idle / unknown / offline / rỗng → trung tính.
      return toneHex("muted");
  }
}
