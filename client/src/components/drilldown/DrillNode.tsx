/**
 * doc 46 FE-W3.2 — <DrillNode>: a single clickable KPI-rollup row in the
 * hierarchical drill-down (Corporate → Factory → Line → Machine).
 *
 * The whole row continues the drill (onDrill) when there is a deeper tier; a
 * leaf row (Machine) has no deeper tier so its primary click opens the cockpit.
 * `leafAction` renders an explicit "Open Line View →" / "Open Cockpit →" button
 * (stops propagation) so the drill is a continuous navigation spine, never a
 * dead-end dashboard. KPI = real inspection rollup (OK / NG / yield) from the
 * `drillDown.*` router — no fabricated values.
 */
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { ChevronRight, ExternalLink } from "lucide-react";

/** Normalised KPI row shared by every drill tier. */
export interface DrillRow {
  /** Stable react key (id ?? code ?? name). */
  key: string;
  id?: number;
  code?: string;
  name: string;
  total: number;
  ok: number;
  ng: number;
  ntf: number;
  yieldRate: number;
  /**
   * W1: bucket "chưa gán" (thiếu mapping master data). Hàng render mờ (muted),
   * mang badge "Thiếu mapping" + tooltip giải thích, và xếp cuối danh sách.
   */
  isUnassigned?: boolean;
  /** Tooltip giải thích vì sao chưa gán + nơi khắc phục (Quản lý dữ liệu). */
  unassignedNote?: string;
}

export interface DrillNodeLeafAction {
  label: string;
  ariaLabel: string;
  onClick: () => void;
}

export interface DrillNodeProps {
  data: DrillRow;
  /** Max total across the current level → OK progress-bar scale. */
  maxValue: number;
  /**
   * W4: max NG across the current level → NG progress-bar scale. NG scaled
   * against Output max was visually invisible (ISA-101: deviation must be the
   * most salient thing). Falls back to maxValue when absent.
   */
  maxNg?: number;
  /** Continue drilling into this node's children. Undefined for a leaf tier. */
  onDrill?: () => void;
  /** Explicit leaf-out action (Open Line View / Open Cockpit). */
  leafAction?: DrillNodeLeafAction;
  /** Small tier icon shown before the name. */
  icon?: React.ReactNode;
}

/** Shared yield badge tone (W4: also drives the dashboard's quick-stat badges). */
export function yieldTone(v: number): "default" | "secondary" | "destructive" {
  if (v >= 95) return "default";
  if (v >= 90) return "secondary";
  return "destructive";
}

export function DrillNode({
  data,
  maxValue,
  maxNg,
  onDrill,
  leafAction,
  icon,
}: DrillNodeProps): React.JSX.Element {
  // Whole-row click: prefer continuing the drill; otherwise (leaf) open the cockpit.
  const primary = onDrill ?? leafAction?.onClick;
  const interactive = typeof primary === "function";

  return (
    <div
      className={cn(
        "rounded-lg border p-4 transition-colors",
        interactive && "cursor-pointer hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        // W1: hàng "chưa gán" render mờ (dữ liệu thật nhưng thiếu mapping master data).
        data.isUnassigned && "border-dashed bg-muted/30",
      )}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={interactive ? primary : undefined}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                primary?.();
              }
            }
          : undefined
      }
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {icon != null && <span className="shrink-0 text-muted-foreground">{icon}</span>}
          <span className={cn("truncate font-medium", data.isUnassigned && "text-muted-foreground")}>
            {data.name}
          </span>
          {/* W1: hàng "chưa gán" — ẩn badge code sentinel ('Unknown'/'UNASSIGNED'),
              thay bằng badge cảnh báo + tooltip hướng dẫn khắc phục. */}
          {data.code && !data.isUnassigned && (
            <Badge variant="outline" className="shrink-0 text-xs">
              {data.code}
            </Badge>
          )}
          {data.isUnassigned && (
            <Badge
              variant="outline"
              className="shrink-0 border-dashed text-xs font-normal text-muted-foreground"
              title={data.unassignedNote}
            >
              Thiếu mapping
            </Badge>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge variant={yieldTone(data.yieldRate)}>{data.yieldRate.toFixed(1)}%</Badge>
          {onDrill && <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="w-12 text-xs text-muted-foreground">OK</span>
          <Progress value={(data.ok / maxValue) * 100} className="h-2 flex-1" />
          <span className="w-16 text-right text-xs font-medium">{data.ok.toLocaleString()}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-12 text-xs text-muted-foreground">NG</span>
          {/* W4: NG scales against the tier's max NG (not max Output) so defects stay visible. */}
          <Progress value={(data.ng / Math.max(maxNg ?? maxValue, 1)) * 100} className="h-2 flex-1 [&>div]:bg-destructive" />
          <span className="w-16 text-right text-xs font-medium">{data.ng.toLocaleString()}</span>
        </div>
      </div>

      {leafAction && (
        <div className="mt-3 flex justify-end">
          <Button
            variant="secondary"
            size="sm"
            className="min-h-11 gap-1.5"
            aria-label={leafAction.ariaLabel}
            onClick={(e) => {
              e.stopPropagation();
              leafAction.onClick();
            }}
          >
            {leafAction.label}
            <ExternalLink className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
}

export default DrillNode;
