/**
 * D1 (doc 16 §11.1 Khối 6) — VISUAL IR EDITOR.
 *
 * A bespoke block editor for authoring device-program-level IR flows (first-class
 * Motion + IO blocks: move_linear / move_joint / grip / release / set_output / wait /
 * if_condition / loop). Modeled on OrchestrationStudio's nested step-tree + inspector,
 * and reuses the dependency-free CodeEditor (Engineering Workspace) for the transpile
 * preview pane.
 *
 * HONESTY (mirrors the router + adapter): reads are open (machine_monitoring/canView);
 * lint + transpilePreview are PURE structural previews (block preview + semantic safety
 * linter + transpile) — NO physics simulation, NO device path. Save/build are gated behind
 * DPC_IR_V2_ENABLED + machine_control. A REAL deploy is a SEPARATE gated step (the existing
 * programmingService HITL 2-eyes) that this editor deliberately does NOT re-expose.
 *
 * Layout: toolbar (flow meta + live lint indicator + gated Save / Request build) →
 * split panes: LEFT palette (Motion/IO/Control) · CENTER flow canvas (nested tree, lint
 * borders) · RIGHT inspector OR transpile preview (target select → code pane with
 * IR↔code marker highlight via irCommentMap).
 *
 * i18n: t("ir.*", "English default") fallback pattern; nav keys added to en/vi/zh.
 */
import { useMemo, useState, useCallback, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import { trpc } from "@/lib/trpc";
import { usePermissions } from "@/_core/hooks/usePermissions";
import DashboardLayout from "@/components/DashboardLayout";
import { ViewOnlyBadge } from "@/components/PermissionGate";
import { PageHeader, PageContainer, MetricCard, SectionCard, StatusBadge } from "@/components/patterns";
import { CodeEditor } from "@/components/engineering/CodeEditor";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Cpu, Info, Lock, Plus, Trash2, ChevronUp, ChevronDown, CornerDownRight,
  Save, Hammer, Code2, CheckCircle2, AlertTriangle, XCircle, RefreshCw,
  FolderOpen, ListTree, ShieldCheck, Loader2, Network, GripVertical, GitCompare,
} from "lucide-react";
import { toast } from "sonner";
import {
  // Shared IR model + pure helpers (ONE source of truth for tree AND graph views).
  BLOCK_ICON, BLOCK_LABEL, PALETTE_GROUPS, COMPARE_OPS, TARGET_DEVICE_TYPES,
  EXPR_BINOPS, EXPR_OP_LABEL, isExpr,
  newBlock, findBlock, updateBlock, deleteBlock, moveBlock, addChild, cloneBlocks,
  reorderRelativeToSibling, childSlots, getChildren, summarize,
  type Pose, type CompareOp, type IrBlock, type BlockType, type Slot, type Flow,
  type TargetDeviceType, type Expr, type ExprBinOp, type NumericOrExpr,
} from "@/components/programming/irTree";
import { IrGraphCanvas, IR_DND_MIME } from "@/components/programming/IrGraphCanvas";
import { IrDiffPanel } from "@/components/programming/IrDiffPanel";

// ── Typesafe shapes inferred from the ir router output ────────────────────────
type RouterOutputs = inferRouterOutputs<AppRouter>;
type IrStatus = RouterOutputs["ir"]["status"];
type LintOutput = RouterOutputs["ir"]["lint"];
type TranspileOutput = RouterOutputs["ir"]["transpilePreview"];
type IrDiagnostic = LintOutput["diagnostics"][number];
type TranspileTarget = IrStatus["targets"][number];

// ══════════════════════════════════════════════════════════════════════════════
// CANVAS — nested block card (models OrchestrationStudio's StepBlock)
// ══════════════════════════════════════════════════════════════════════════════
function BlockCard({
  block, selectedId, index, siblingCount, diagsByBlock,
  onSelect, onMove, onDelete, onAddChild, t,
}: {
  block: IrBlock;
  selectedId: string | null;
  index: number;
  siblingCount: number;
  diagsByBlock: Map<string, IrDiagnostic[]>;
  onSelect: (id: string) => void;
  onMove: (id: string, dir: -1 | 1) => void;
  onDelete: (id: string) => void;
  onAddChild: (parentId: string, slot: Slot, type: BlockType) => void;
  t: TFunction;
}) {
  const Icon = BLOCK_ICON[block.type];
  const selected = selectedId === block.id;
  const diags = block.id ? (diagsByBlock.get(block.id) ?? []) : [];
  const hasError = diags.some((d) => d.severity === "error");
  const hasWarn = !hasError && diags.some((d) => d.severity === "warn");
  const borderTone = hasError
    ? "border-destructive ring-1 ring-destructive/40"
    : hasWarn
      ? "border-warning ring-1 ring-warning/30"
      : selected
        ? "border-primary ring-2 ring-primary"
        : "border-border hover:bg-muted/50";

  const slots = childSlots(block);

  return (
    <div className="space-y-1">
      <div
        role="button"
        tabIndex={0}
        onClick={() => block.id && onSelect(block.id)}
        onKeyDown={(e) => e.key === "Enter" && block.id && onSelect(block.id)}
        className={`group flex items-center gap-2 rounded-md border px-2 py-1.5 cursor-pointer transition-colors ${borderTone}`}
      >
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-primary/10 text-primary">
          <Icon className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">
            {t(BLOCK_LABEL[block.type].key, BLOCK_LABEL[block.type].def)}
            <span className="ml-1.5 font-mono text-[10px] text-muted-foreground">{block.id}</span>
          </div>
          <div className="truncate text-[11px] text-muted-foreground">{summarize(block, t)}</div>
        </div>
        <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          <Button size="icon" variant="ghost" className="h-6 w-6" disabled={index === 0}
            onClick={(e) => { e.stopPropagation(); block.id && onMove(block.id, -1); }} aria-label={t("ir.moveUp", "Up")}>
            <ChevronUp className="h-3.5 w-3.5" />
          </Button>
          <Button size="icon" variant="ghost" className="h-6 w-6" disabled={index === siblingCount - 1}
            onClick={(e) => { e.stopPropagation(); block.id && onMove(block.id, 1); }} aria-label={t("ir.moveDown", "Down")}>
            <ChevronDown className="h-3.5 w-3.5" />
          </Button>
          <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive"
            onClick={(e) => { e.stopPropagation(); block.id && onDelete(block.id); }} aria-label={t("common.delete", "Delete")}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Inline diagnostics for this block */}
      {diags.length > 0 && (
        <div className="ml-8 space-y-0.5">
          {diags.map((d, i) => (
            <div
              key={i}
              className={`flex items-start gap-1 rounded px-1.5 py-0.5 text-[11px] ${
                d.severity === "error" ? "bg-destructive/10 text-destructive" : "bg-warning/10 text-warning"
              }`}
            >
              {d.severity === "error" ? <XCircle className="mt-0.5 h-3 w-3 shrink-0" /> : <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />}
              <span><span className="font-mono">[{d.rule}]</span> {d.message}</span>
            </div>
          ))}
        </div>
      )}

      {/* Child slots (true/false branches or loop body) */}
      {slots.map((slot) => {
        const items = getChildren(block, slot);
        const slotLabel =
          slot === "true_branch" ? t("ir.slot.true", "If true") :
          slot === "false_branch" ? t("ir.slot.false", "If false") :
          t("ir.slot.body", "Loop body");
        return (
          <div key={slot} className="ml-4 border-l-2 border-dashed border-muted-foreground/30 pl-3 space-y-1">
            <div className="flex items-center gap-1 pt-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              <CornerDownRight className="h-3 w-3" /> {slotLabel}
            </div>
            {items.map((child, i) => (
              <BlockCard
                key={child.id}
                block={child}
                selectedId={selectedId}
                index={i}
                siblingCount={items.length}
                diagsByBlock={diagsByBlock}
                onSelect={onSelect}
                onMove={onMove}
                onDelete={onDelete}
                onAddChild={onAddChild}
                t={t}
              />
            ))}
            <AddChildMenu onAdd={(type) => block.id && onAddChild(block.id, slot, type)} t={t} />
          </div>
        );
      })}
    </div>
  );
}

function AddChildMenu({ onAdd, t }: { onAdd: (type: BlockType) => void; t: TFunction }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <Button size="sm" variant="ghost" className="h-6 text-[11px] text-muted-foreground" onClick={() => setOpen((o) => !o)}>
        <Plus className="mr-1 h-3.5 w-3.5" />{t("ir.addChild", "Add block")}
      </Button>
      {open && (
        <div className="absolute z-20 mt-1 w-44 rounded-md border bg-popover p-1 shadow-lg">
          {(Object.keys(BLOCK_LABEL) as BlockType[]).map((type) => {
            const Icon = BLOCK_ICON[type];
            return (
              <button key={type} className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-muted"
                onClick={() => { onAdd(type); setOpen(false); }}>
                <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                {t(BLOCK_LABEL[type].key, BLOCK_LABEL[type].def)}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// INSPECTOR — typed param editor for the selected block
// ══════════════════════════════════════════════════════════════════════════════
function NumField({ label, value, onChange, unit }: { label: string; value: number; onChange: (n: number) => void; unit?: string }) {
  return (
    <div className="space-y-1">
      <Label className="text-[11px]">{label}{unit ? ` (${unit})` : ""}</Label>
      <Input className="h-8 text-sm" type="number" value={Number.isFinite(value) ? value : 0}
        onChange={(e) => onChange(e.target.value === "" ? 0 : Number(e.target.value))} />
    </div>
  );
}

// ── P3: a SAFE mini expression editor (no free-text eval — dropdowns + numbers only) ──
// The value is EITHER a literal (number/boolean) OR a typed Expr AST node ({lit|var|binop}).
// This mirrors server irExpr.ts exactly, so what the author builds here is exactly what the
// linter scopes and the transpiler renders. No string is ever eval'd.
type ExprMode = "literal" | "variable" | "binop";
function exprMode(v: NumericOrExpr): ExprMode {
  if (!isExpr(v)) return "literal";
  if (v.kind === "var") return "variable";
  if (v.kind === "binop") return "binop";
  return "literal";
}
function litValue(v: NumericOrExpr): number {
  if (typeof v === "number") return v;
  if (isExpr(v) && v.kind === "lit" && typeof v.value === "number") return v.value;
  return 0;
}
function ExprField({
  label, value, onChange, t, allowBool,
}: {
  label: string;
  value: NumericOrExpr;
  onChange: (v: NumericOrExpr) => void;
  t: TFunction;
  allowBool?: boolean;
}) {
  const mode = exprMode(value);
  const setMode = (m: ExprMode) => {
    if (m === "literal") onChange(0);
    else if (m === "variable") onChange({ kind: "var", name: "x" } as Expr);
    else onChange({ kind: "binop", op: "add", left: { kind: "var", name: "x" }, right: { kind: "lit", value: 1 } } as Expr);
  };
  return (
    <div className="space-y-1 rounded-md border border-dashed border-border/70 p-2">
      <div className="flex items-center justify-between">
        <Label className="text-[11px]">{label}</Label>
        <Select value={mode} onValueChange={(m) => setMode(m as ExprMode)}>
          <SelectTrigger className="h-6 w-28 text-[11px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="literal">{t("ir.expr.literal", "literal")}</SelectItem>
            <SelectItem value="variable">{t("ir.expr.variable", "variable")}</SelectItem>
            <SelectItem value="binop">{t("ir.expr.binop", "expression")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {mode === "literal" && (
        allowBool ? (
          <Select
            value={typeof value === "boolean" ? (value ? "true" : "false") : (isExpr(value) && value.kind === "lit" && typeof value.value === "boolean" ? (value.value ? "true" : "false") : "num")}
            onValueChange={(v) => onChange(v === "true" ? true : v === "false" ? false : 0)}
          >
            <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="true">true</SelectItem>
              <SelectItem value="false">false</SelectItem>
              <SelectItem value="num">{t("ir.field.numeric", "numeric…")}</SelectItem>
            </SelectContent>
          </Select>
        ) : (
          <Input className="h-8 text-sm" type="number" value={litValue(value)}
            onChange={(e) => onChange(e.target.value === "" ? 0 : Number(e.target.value))} />
        )
      )}

      {mode === "variable" && isExpr(value) && value.kind === "var" && (
        <Input className="h-8 text-sm font-mono" value={value.name}
          placeholder="var name"
          onChange={(e) => onChange({ kind: "var", name: e.target.value } as Expr)} />
      )}

      {mode === "binop" && isExpr(value) && value.kind === "binop" && (
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1">
          <Input className="h-8 text-sm font-mono" placeholder="left"
            value={value.left.kind === "var" ? value.left.name : value.left.kind === "lit" ? String(value.left.value) : "…"}
            onChange={(e) => onChange({ ...value, left: parseLeaf(e.target.value) } as Expr)} />
          <Select value={value.op} onValueChange={(op) => onChange({ ...value, op: op as ExprBinOp } as Expr)}>
            <SelectTrigger className="h-8 w-16 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>{EXPR_BINOPS.map((o) => <SelectItem key={o} value={o}>{EXPR_OP_LABEL[o]}</SelectItem>)}</SelectContent>
          </Select>
          <Input className="h-8 text-sm font-mono" placeholder="right"
            value={value.right.kind === "var" ? value.right.name : value.right.kind === "lit" ? String(value.right.value) : "…"}
            onChange={(e) => onChange({ ...value, right: parseLeaf(e.target.value) } as Expr)} />
        </div>
      )}
      <p className="text-[10px] text-muted-foreground">{t("ir.expr.hint", "Safe typed expression — no code is evaluated. Variables must be set by a prior Set variable / Counter block.")}</p>
    </div>
  );
}
/** Turn a text field into an Expr LEAF: a bare number → lit; true/false → lit bool; else a var ref. */
function parseLeaf(raw: string): Expr {
  const s = raw.trim();
  if (s === "true") return { kind: "lit", value: true };
  if (s === "false") return { kind: "lit", value: false };
  const n = Number(s);
  if (s !== "" && !Number.isNaN(n)) return { kind: "lit", value: n };
  return { kind: "var", name: s };
}

function Inspector({ block, onPatch, t }: { block: IrBlock; onPatch: (patch: Partial<IrBlock>) => void; t: TFunction }) {
  const patchPose = (k: keyof Pose, v: number) => {
    if (block.type !== "move_linear") return;
    onPatch({ target_pose: { ...block.target_pose, [k]: v } } as Partial<IrBlock>);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="font-mono text-[11px]">{block.type}</Badge>
        <span className="font-mono text-[11px] text-muted-foreground">{block.id}</span>
      </div>

      {block.type === "move_linear" && (
        <>
          <div className="text-[11px] font-semibold uppercase text-muted-foreground">{t("ir.field.targetPose", "Target pose")}</div>
          <div className="grid grid-cols-3 gap-2">
            <NumField label="x" unit="mm" value={block.target_pose.x} onChange={(v) => patchPose("x", v)} />
            <NumField label="y" unit="mm" value={block.target_pose.y} onChange={(v) => patchPose("y", v)} />
            <NumField label="z" unit="mm" value={block.target_pose.z} onChange={(v) => patchPose("z", v)} />
            <NumField label="rx" value={block.target_pose.rx} onChange={(v) => patchPose("rx", v)} />
            <NumField label="ry" value={block.target_pose.ry} onChange={(v) => patchPose("ry", v)} />
            <NumField label="rz" value={block.target_pose.rz} onChange={(v) => patchPose("rz", v)} />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <NumField label={t("ir.field.speed", "Speed")} unit="mm/s" value={block.speed_mms} onChange={(v) => onPatch({ speed_mms: v } as Partial<IrBlock>)} />
            <NumField label={t("ir.field.accel", "Accel")} value={block.acceleration} onChange={(v) => onPatch({ acceleration: v } as Partial<IrBlock>)} />
            <NumField label={t("ir.field.blend", "Blend")} unit="mm" value={block.blend_radius} onChange={(v) => onPatch({ blend_radius: v } as Partial<IrBlock>)} />
          </div>
        </>
      )}

      {block.type === "move_joint" && (
        <>
          <div className="space-y-1">
            <Label className="text-[11px]">{t("ir.field.joints", "Joints (comma-separated)")}</Label>
            <Input className="h-8 text-sm font-mono" value={block.joints.join(", ")}
              onChange={(e) => onPatch({ joints: e.target.value.split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n)) } as Partial<IrBlock>)} />
          </div>
          <NumField label={t("ir.field.speedPct", "Speed")} unit="%" value={block.speed_pct} onChange={(v) => onPatch({ speed_pct: v } as Partial<IrBlock>)} />
        </>
      )}

      {block.type === "grip" && (
        <>
          <div className="space-y-1">
            <Label className="text-[11px]">{t("ir.field.toolId", "Tool id")}</Label>
            <Input className="h-8 text-sm" value={block.tool_id} onChange={(e) => onPatch({ tool_id: e.target.value } as Partial<IrBlock>)} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <NumField label={t("ir.field.force", "Force limit")} unit="N" value={block.force_limit_n} onChange={(v) => onPatch({ force_limit_n: v } as Partial<IrBlock>)} />
            <NumField label={t("ir.field.timeout", "Timeout")} unit="ms" value={block.timeout_ms} onChange={(v) => onPatch({ timeout_ms: v } as Partial<IrBlock>)} />
          </div>
        </>
      )}

      {block.type === "release" && (
        <div className="space-y-1">
          <Label className="text-[11px]">{t("ir.field.toolIdOpt", "Tool id (optional)")}</Label>
          <Input className="h-8 text-sm" value={block.tool_id ?? ""} onChange={(e) => onPatch({ tool_id: e.target.value || undefined } as Partial<IrBlock>)} />
        </div>
      )}

      {block.type === "set_output" && (
        <>
          <div className="space-y-1">
            <Label className="text-[11px]">{t("ir.field.signal", "Signal")}</Label>
            <Input className="h-8 text-sm" value={block.signal} onChange={(e) => onPatch({ signal: e.target.value } as Partial<IrBlock>)} />
          </div>
          <ExprField label={t("ir.field.value", "Value")} value={block.value} allowBool onChange={(v) => onPatch({ value: v } as Partial<IrBlock>)} t={t} />
        </>
      )}

      {block.type === "wait" && (
        <>
          <div className="space-y-1">
            <Label className="text-[11px]">{t("ir.field.signalRef", "Signal ref (optional)")}</Label>
            <Input className="h-8 text-sm" value={block.signal_ref ?? ""} onChange={(e) => onPatch({ signal_ref: e.target.value || undefined } as Partial<IrBlock>)} />
          </div>
          <ExprField label={t("ir.field.ms", "Duration (ms)")} value={block.ms ?? 0} onChange={(v) => onPatch({ ms: (typeof v === "boolean" ? 0 : v) } as Partial<IrBlock>)} t={t} />
          <p className="text-[10px] text-muted-foreground">{t("ir.field.waitHint", "wait needs at least one of { signal ref, duration }.")}</p>
        </>
      )}

      {block.type === "set_variable" && (
        <>
          <div className="space-y-1">
            <Label className="text-[11px]">{t("ir.field.varName", "Variable name")}</Label>
            <Input className="h-8 text-sm font-mono" value={block.name} onChange={(e) => onPatch({ name: e.target.value } as Partial<IrBlock>)} />
          </div>
          <ExprField label={t("ir.field.expr", "Expression")} value={block.expr} onChange={(v) => onPatch({ expr: (isExpr(v) ? v : { kind: "lit", value: typeof v === "boolean" ? v : Number(v) }) as Expr } as Partial<IrBlock>)} t={t} allowBool />
        </>
      )}

      {block.type === "counter" && (
        <>
          <div className="space-y-1">
            <Label className="text-[11px]">{t("ir.field.varName", "Counter name")}</Label>
            <Input className="h-8 text-sm font-mono" value={block.name} onChange={(e) => onPatch({ name: e.target.value } as Partial<IrBlock>)} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-[11px]">{t("ir.field.counterOp", "Operation")}</Label>
              <Select value={block.op} onValueChange={(v) => onPatch({ op: v as "increment" | "reset" } as Partial<IrBlock>)}>
                <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="increment">{t("ir.field.counterInc", "increment")}</SelectItem>
                  <SelectItem value="reset">{t("ir.field.counterReset", "reset")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <NumField label={block.op === "reset" ? t("ir.field.resetTo", "Reset to") : t("ir.field.by", "By")} value={block.amount} onChange={(v) => onPatch({ amount: v } as Partial<IrBlock>)} />
          </div>
        </>
      )}

      {block.type === "wait_until" && (
        <>
          <ExprField label={t("ir.field.condition", "Condition (holds → continue)")} value={block.condition} onChange={(v) => onPatch({ condition: (isExpr(v) ? v : { kind: "lit", value: typeof v === "boolean" ? v : Boolean(v) }) as Expr } as Partial<IrBlock>)} t={t} allowBool />
          <div className="grid grid-cols-2 gap-2">
            <NumField label={t("ir.field.timeout", "Timeout")} unit="ms" value={block.timeout_ms} onChange={(v) => onPatch({ timeout_ms: Math.max(1, Math.round(v)) } as Partial<IrBlock>)} />
            <NumField label={t("ir.field.poll", "Poll")} unit="ms" value={block.poll_ms} onChange={(v) => onPatch({ poll_ms: Math.max(1, Math.round(v)) } as Partial<IrBlock>)} />
          </div>
        </>
      )}

      {block.type === "set_analog" && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-[11px]">{t("ir.field.channel", "Channel")}</Label>
              <Input className="h-8 text-sm" value={block.channel} onChange={(e) => onPatch({ channel: e.target.value } as Partial<IrBlock>)} />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px]">{t("ir.field.unit", "Unit (optional)")}</Label>
              <Input className="h-8 text-sm" value={block.unit ?? ""} onChange={(e) => onPatch({ unit: e.target.value || undefined } as Partial<IrBlock>)} />
            </div>
          </div>
          <ExprField label={t("ir.field.value", "Value")} value={block.value} onChange={(v) => onPatch({ value: v } as Partial<IrBlock>)} t={t} />
        </>
      )}

      {block.type === "pid_control" && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-[11px]">{t("ir.field.pidIn", "Input channel (PV)")}</Label>
              <Input className="h-8 text-sm" value={block.input_channel} onChange={(e) => onPatch({ input_channel: e.target.value } as Partial<IrBlock>)} />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px]">{t("ir.field.pidOut", "Output channel")}</Label>
              <Input className="h-8 text-sm" value={block.output_channel} onChange={(e) => onPatch({ output_channel: e.target.value } as Partial<IrBlock>)} />
            </div>
          </div>
          <ExprField label={t("ir.field.setpoint", "Setpoint")} value={block.setpoint} onChange={(v) => onPatch({ setpoint: v } as Partial<IrBlock>)} t={t} />
          <div className="grid grid-cols-3 gap-2">
            <NumField label="Kp" value={block.kp} onChange={(v) => onPatch({ kp: v } as Partial<IrBlock>)} />
            <NumField label="Ki" value={block.ki} onChange={(v) => onPatch({ ki: v } as Partial<IrBlock>)} />
            <NumField label="Kd" value={block.kd} onChange={(v) => onPatch({ kd: v } as Partial<IrBlock>)} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <NumField label={t("ir.field.outMin", "Output min")} value={block.output_min} onChange={(v) => onPatch({ output_min: v } as Partial<IrBlock>)} />
            <NumField label={t("ir.field.outMax", "Output max")} value={block.output_max} onChange={(v) => onPatch({ output_max: v } as Partial<IrBlock>)} />
          </div>
          <p className="text-[10px] text-muted-foreground">{t("ir.field.pidHint", "Gains must be finite & non-negative; output is hard-clamped to [min, max]. URScript emits a bounded PID skeleton (no native PID).")}</p>
        </>
      )}

      {block.type === "if_condition" && (
        <div className="space-y-2">
          <div className="text-[11px] font-semibold uppercase text-muted-foreground">{t("ir.field.condition", "Condition")}</div>
          <div className="space-y-1">
            <Label className="text-[11px]">{t("ir.field.signalRef", "Signal ref")}</Label>
            <Input className="h-8 text-sm" value={block.signal_ref} onChange={(e) => onPatch({ signal_ref: e.target.value } as Partial<IrBlock>)} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-[11px]">{t("ir.field.operator", "Operator")}</Label>
              <Select value={block.operator} onValueChange={(v) => onPatch({ operator: v as CompareOp } as Partial<IrBlock>)}>
                <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>{COMPARE_OPS.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-[11px]">{t("ir.field.value", "Value")}</Label>
              <Input className="h-8 text-sm" value={String(block.value)} onChange={(e) => {
                const raw = e.target.value;
                const num = Number(raw);
                const val: number | boolean | string = raw === "true" ? true : raw === "false" ? false : (raw !== "" && !Number.isNaN(num) ? num : raw);
                onPatch({ value: val } as Partial<IrBlock>);
              }} />
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground">{t("ir.field.branchHint", "Add blocks into the true / false branches on the canvas.")}</p>
        </div>
      )}

      {block.type === "loop" && (
        <div className="space-y-2">
          <div className="space-y-1">
            <Label className="text-[11px]">{t("ir.field.loopMode", "Loop mode")}</Label>
            <Select
              value={block.count != null ? "count" : "while"}
              onValueChange={(v) => onPatch(v === "count"
                ? ({ count: block.count ?? 3, while: undefined } as Partial<IrBlock>)
                : ({ count: undefined, while: block.while ?? { signal_ref: "DI1", operator: "eq", value: true } } as Partial<IrBlock>))}
            >
              <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="count">{t("ir.field.loopCount", "Fixed count")}</SelectItem>
                <SelectItem value="while">{t("ir.field.loopWhile", "While condition")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {block.count != null && (
            <NumField label={t("ir.field.count", "Count")} value={block.count} onChange={(v) => onPatch({ count: Math.max(1, Math.round(v)) } as Partial<IrBlock>)} />
          )}
          {block.while != null && (
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1 col-span-1">
                <Label className="text-[11px]">{t("ir.field.signalRef", "Signal")}</Label>
                <Input className="h-8 text-sm" value={block.while.signal_ref} onChange={(e) => onPatch({ while: { ...block.while!, signal_ref: e.target.value } } as Partial<IrBlock>)} />
              </div>
              <div className="space-y-1 col-span-1">
                <Label className="text-[11px]">{t("ir.field.operator", "Op")}</Label>
                <Select value={block.while.operator} onValueChange={(v) => onPatch({ while: { ...block.while!, operator: v as CompareOp } } as Partial<IrBlock>)}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>{COMPARE_OPS.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1 col-span-1">
                <Label className="text-[11px]">{t("ir.field.value", "Value")}</Label>
                <Input className="h-8 text-sm" value={String(block.while.value)} onChange={(e) => {
                  const raw = e.target.value; const num = Number(raw);
                  const val: number | boolean | string = raw === "true" ? true : raw === "false" ? false : (raw !== "" && !Number.isNaN(num) ? num : raw);
                  onPatch({ while: { ...block.while!, value: val } } as Partial<IrBlock>);
                }} />
              </div>
            </div>
          )}
          <p className="text-[10px] text-muted-foreground">{t("ir.field.bodyHint", "Add blocks into the loop body on the canvas.")}</p>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// TRANSPILE PREVIEW — target select → code pane with IR↔code marker highlight
// ══════════════════════════════════════════════════════════════════════════════
function TranspilePreview({
  flow, canView, selectedId, targets, t,
}: {
  flow: Flow;
  canView: boolean;
  selectedId: string | null;
  targets: readonly TranspileTarget[];
  t: TFunction;
}) {
  const [target, setTarget] = useState<TranspileTarget>(targets[0] ?? "urscript");
  const previewQ = trpc.ir.transpilePreview.useQuery(
    { flow, target },
    { enabled: canView, retry: false },
  );
  const preview = previewQ.data as TranspileOutput | undefined;

  // Highlight the marker line for the selected block (via irCommentMap: marker → blockId).
  const highlightLine = useMemo(() => {
    if (!preview?.code || !selectedId) return null;
    const markerForBlock = Object.entries(preview.irCommentMap).find(([, blockId]) => blockId === selectedId)?.[0];
    if (!markerForBlock) return null;
    const lines = preview.code.split("\n");
    const idx = lines.findIndex((l) => l.includes(markerForBlock) || l.includes(`#${selectedId}`) || l.includes(`# [IR`) && l.includes(selectedId));
    return idx >= 0 ? idx : null;
  }, [preview, selectedId]);

  const preRef = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (highlightLine != null && preRef.current) {
      const el = preRef.current.querySelector(`[data-line="${highlightLine}"]`);
      el?.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [highlightLine]);

  const errorCount = (preview?.diagnostics ?? []).filter((d) => d.severity === "error").length;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Label className="text-xs text-muted-foreground">{t("ir.transpile.target", "Target")}</Label>
        <Select value={target} onValueChange={(v) => setTarget(v as TranspileTarget)}>
          <SelectTrigger className="h-8 w-40 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>{targets.map((tg) => <SelectItem key={tg} value={tg}>{tg}</SelectItem>)}</SelectContent>
        </Select>
        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => void previewQ.refetch()} title={t("common.refresh", "Refresh")}>
          {previewQ.isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        </Button>
      </div>

      {/* Blocking-errors notice — transpile is disabled until lint ok */}
      {preview && !preview.ok && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
          <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{t("ir.transpile.blocked", "Transpile is blocked by {{n}} safety-linter error(s). Fix them to generate code.", { n: errorCount })}</span>
        </div>
      )}

      {preview?.code ? (
        <div className="overflow-hidden rounded-md border bg-muted/30">
          <pre ref={preRef} className="max-h-[420px] overflow-auto p-3 font-mono text-xs leading-5">
            {preview.code.split("\n").map((line, i) => {
              const isComment = line.trimStart().startsWith("# [IR");
              const active = i === highlightLine;
              return (
                <div
                  key={i}
                  data-line={i}
                  className={`whitespace-pre ${active ? "-mx-3 bg-primary/15 px-3" : ""} ${isComment ? "text-primary/80" : ""}`}
                >
                  {line || " "}
                </div>
              );
            })}
          </pre>
        </div>
      ) : (
        <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          {previewQ.isFetching
            ? t("ir.transpile.loading", "Transpiling…")
            : t("ir.transpile.none", "No code generated. Resolve any lint errors above, then retry.")}
        </div>
      )}

      <p className="text-[10px] text-muted-foreground">
        {t("ir.transpile.note", "Each block's native code is preceded by a “# [IR <type> #<id>]” marker. Selecting a block highlights & scrolls to its marker.")}
      </p>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN PAGE
// ══════════════════════════════════════════════════════════════════════════════
function emptyFlow(): Flow {
  return { flow_id: "flow-1", target_device_type: "universal-robots", version: 1, blocks: [] };
}

export default function IrEditor() {
  const { t } = useTranslation();
  const { hasPermission } = usePermissions();
  const canView = hasPermission("machine_monitoring", "canView");
  const canControl = hasPermission("machine_control", "canCreate");

  const [flow, setFlow] = useState<Flow>(() => emptyFlow());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [rightTab, setRightTab] = useState<"inspector" | "preview">("inspector");
  const [saveProjectId, setSaveProjectId] = useState<string>("");
  // View toggle: the node-GRAPH canvas is the default (the "kéo thả khối" surface); the
  // nested TREE stays available. Both render the SAME AST via the SAME helpers.
  const [viewMode, setViewMode] = useState<"graph" | "tree">("graph");

  const utils = trpc.useUtils();

  // ── Reads ────────────────────────────────────────────────────────────────
  const statusQ = trpc.ir.status.useQuery(undefined, { enabled: canView });
  const flowsQ = trpc.ir.listFlows.useQuery({ limit: 200 }, { enabled: canView });
  const projectsQ = trpc.programming.listProjects.useQuery({ limit: 200 }, { enabled: canView });

  const flagEnabled = statusQ.data?.enabled ?? false;
  const targets = (statusQ.data?.targets ?? ["urscript", "ros2"]) as readonly TranspileTarget[];
  const irProjects = useMemo(
    () => (projectsQ.data ?? []).filter((p) => p.kind === "ir-flow"),
    [projectsQ.data],
  );

  // ── Live lint (debounced) — pure read; runs whenever the flow changes ──────
  const [lintFlowInput, setLintFlowInput] = useState<Flow>(flow);
  useEffect(() => {
    const h = setTimeout(() => setLintFlowInput(flow), 400);
    return () => clearTimeout(h);
  }, [flow]);
  const lintQ = trpc.ir.lint.useQuery({ flow: lintFlowInput }, { enabled: canView, retry: false });
  const lint = lintQ.data as LintOutput | undefined;

  // Group diagnostics by blockId for canvas borders.
  const diagsByBlock = useMemo(() => {
    const m = new Map<string, IrDiagnostic[]>();
    for (const d of lint?.diagnostics ?? []) {
      const list = m.get(d.blockId) ?? [];
      list.push(d);
      m.set(d.blockId, list);
    }
    return m;
  }, [lint]);
  const errorCount = (lint?.diagnostics ?? []).filter((d) => d.severity === "error").length;
  const warnCount = (lint?.diagnostics ?? []).filter((d) => d.severity === "warn").length;
  const lintOk = lint?.ok ?? true;

  // ── Mutations (gated: DPC_IR_V2_ENABLED + machine_control) ─────────────────
  const onMutationError = (e: { data?: { code?: string } | null; message: string }) => {
    if (e.data?.code === "CONFLICT" && /disabled/i.test(e.message)) {
      toast.info(t("ir.flagOffToast", "IR programming is disabled (preview). Set DPC_IR_V2_ENABLED=true to save/build."));
      void utils.ir.status.invalidate();
    } else {
      toast.error(e.message);
    }
  };

  const saveM = trpc.ir.saveFlow.useMutation({
    onSuccess: (r) => {
      const ok = r?.validation?.ok ?? true;
      if (ok) toast.success(t("ir.saved", "Flow saved (validated)"));
      else toast.warning(t("ir.savedInvalid", "Flow saved but the linter flagged issues — see diagnostics."));
      void utils.ir.listFlows.invalidate();
    },
    onError: onMutationError,
  });
  const buildM = trpc.ir.requestBuild.useMutation({
    onSuccess: (r) => {
      if (r?.ok) toast.success(t("ir.buildOk", "Build requested — transpiled OK. Deploy is a separate gated step."));
      else toast.warning(t("ir.buildBlocked", "Build did not pass (linter/transpile). Deploy remains blocked."));
      void utils.ir.listFlows.invalidate();
    },
    onError: onMutationError,
  });

  // ── Mutators over the flow tree ────────────────────────────────────────────
  const selectedBlock = selectedId ? findBlock(flow.blocks, selectedId) : null;

  const addTopLevel = useCallback((type: BlockType) => {
    const b = newBlock(type);
    setFlow((f) => ({ ...f, blocks: [...cloneBlocks(f.blocks), b] }));
    setSelectedId(b.id ?? null);
  }, []);
  const handleAddChild = useCallback((parentId: string, slot: Slot, type: BlockType) => {
    const b = newBlock(type);
    setFlow((f) => ({ ...f, blocks: addChild(f.blocks, parentId, slot, b) }));
    setSelectedId(b.id ?? null);
  }, []);
  const handlePatch = useCallback((patch: Partial<IrBlock>) => {
    if (!selectedId) return;
    setFlow((f) => ({ ...f, blocks: updateBlock(f.blocks, selectedId, patch) }));
  }, [selectedId]);
  const handleDelete = useCallback((id: string) => {
    setFlow((f) => ({ ...f, blocks: deleteBlock(f.blocks, id) }));
    setSelectedId((cur) => (cur === id ? null : cur));
  }, []);
  const handleMove = useCallback((id: string, dir: -1 | 1) => {
    setFlow((f) => ({ ...f, blocks: moveBlock(f.blocks, id, dir) }));
  }, []);
  // Graph canvas: reconnecting a `next` edge between two SIBLINGS reorders them (no-op
  // across lists). Routes through the same immutable AST helper as the tree's up/down.
  const handleReorderToSibling = useCallback((sourceId: string, targetId: string) => {
    setFlow((f) => ({ ...f, blocks: reorderRelativeToSibling(f.blocks, sourceId, targetId) }));
  }, []);

  const loadFlow = async (artifactId: number) => {
    try {
      const res = await utils.ir.getFlow.fetch({ artifactId });
      if (res.flow) {
        setFlow(res.flow as Flow);
        setSelectedId(null);
        toast.success(t("ir.loaded", "Flow loaded into the editor"));
      } else {
        toast.error(t("ir.loadFail", "Artifact could not be parsed as an IR flow."));
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  const doSave = () => {
    const pid = Number(saveProjectId);
    if (!Number.isInteger(pid) || pid <= 0) {
      toast.error(t("ir.pickProject", "Pick an ir-flow project to save into."));
      return;
    }
    saveM.mutate({ projectId: pid, branch: "main", flow });
  };

  if (!canView) {
    return (
      <DashboardLayout>
        <div className="p-6">
          <Card><CardContent className="py-10 text-center text-muted-foreground">
            <AlertTriangle className="mx-auto mb-2 h-6 w-6" />
            {t("ir.noPermission", "You do not have permission to view the IR editor.")}
          </CardContent></Card>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <PageContainer fluid className="flex flex-col gap-4 space-y-0">
        <PageHeader
          icon={<Code2 className="h-6 w-6" />}
          title={t("ir.title", "Visual IR Editor")}
          badge={!canControl ? <ViewOnlyBadge module="machine_control" /> : undefined}
          description={t("ir.subtitle", "Author motion/IO device programs as first-class IR blocks, lint & transpile — a structural preview, not a physics run.")}
          actions={
            <Button size="icon" variant="ghost" onClick={() => { void flowsQ.refetch(); void utils.ir.lint.invalidate(); }} title={t("common.refresh", "Refresh")}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          }
        />

        {/* Flag-off preview banner (honest) */}
        {!statusQ.isLoading && !flagEnabled && (
          <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <span>{t("ir.flagOffBanner", "Preview mode: IR programming is disabled (DPC_IR_V2_ENABLED is off). Authoring, lint and transpile preview work; Save flow / Request build are blocked until the flag is enabled.")}</span>
          </div>
        )}

        {/* Persistent honesty note — structural preview + gated deploy */}
        <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
          <Lock className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{t("ir.honestyNote", "Structural preview + lint + transpile only — physics simulation and a real deploy are gated separately. A real deploy always routes through the existing programming service (HITL 2-eyes) and is never triggered from this screen.")}</span>
        </div>

        {/* Flow metadata toolbar + lint indicator + gated actions */}
        <Card>
          <CardContent className="flex flex-col gap-3 py-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
              <div className="space-y-1.5">
                <Label className="text-xs">{t("ir.flowId", "Flow id")}</Label>
                <Input className="font-mono" value={flow.flow_id} onChange={(e) => setFlow((f) => ({ ...f, flow_id: e.target.value }))} placeholder="pick-place-01" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">{t("ir.targetDevice", "Target device type")}</Label>
                <Select value={flow.target_device_type} onValueChange={(v) => setFlow((f) => ({ ...f, target_device_type: v as TargetDeviceType }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{TARGET_DEVICE_TYPES.map((dt) => <SelectItem key={dt} value={dt}>{dt}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">{t("ir.version", "Version")}</Label>
                <Input type="number" min={1} value={flow.version} onChange={(e) => setFlow((f) => ({ ...f, version: Math.max(1, Number(e.target.value) || 1) }))} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">{t("ir.linkedCapability", "Linked capability (optional)")}</Label>
                <Input value={flow.linked_capability ?? ""} onChange={(e) => setFlow((f) => ({ ...f, linked_capability: e.target.value || undefined }))} placeholder="pick_place" />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {/* Live lint indicator */}
              <div className="flex items-center gap-2">
                {lintQ.isFetching ? (
                  <Badge variant="outline" className="gap-1"><Loader2 className="h-3 w-3 animate-spin" /> {t("ir.linting", "Linting…")}</Badge>
                ) : (
                  <StatusBadge
                    status={lintOk ? "ok" : "error"}
                    label={
                      <span className="inline-flex items-center gap-1">
                        <ShieldCheck className="h-3 w-3" />
                        {lintOk ? t("ir.lintOk", "Lint OK") : t("ir.lintErrors", "{{n}} error(s)", { n: errorCount })}
                        {warnCount > 0 ? ` · ${t("ir.lintWarns", "{{n}} warn", { n: warnCount })}` : ""}
                      </span>
                    }
                  />
                )}
              </div>

              <div className="ml-auto flex flex-wrap items-center gap-2">
                {/* Save target project */}
                <Select value={saveProjectId} onValueChange={setSaveProjectId}>
                  <SelectTrigger className="h-9 w-52"><SelectValue placeholder={t("ir.pickProjectPlaceholder", "Save into project…")} /></SelectTrigger>
                  <SelectContent>
                    {irProjects.length === 0 && <div className="px-2 py-1.5 text-xs text-muted-foreground">{t("ir.noProjects", "No ir-flow projects")}</div>}
                    {irProjects.map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.code} · {p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Button variant="outline" onClick={doSave}
                  disabled={!canControl || !flagEnabled || saveM.isPending || flow.blocks.length === 0}
                  title={!flagEnabled ? t("ir.flagOffTip", "Enable DPC_IR_V2_ENABLED to save") : undefined}>
                  {saveM.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />}
                  {t("ir.save", "Save flow")}
                </Button>
              </div>
            </div>

            <p className="text-[11px] text-muted-foreground">
              {t("ir.deployReminder", "Save appends a validated ir-flow artifact; Request build (below, per saved flow) transpiles it. Deploy to a real device is a separate gated step (existing programming service, HITL 2-eyes) — not exposed here.")}
            </p>
          </CardContent>
        </Card>

        {/* SPLIT PANES: palette · canvas · inspector/preview */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          {/* LEFT — palette */}
          <SectionCard
            className="lg:col-span-3"
            icon={<Plus className="h-4 w-4" />}
            title={t("ir.palette", "Block palette")}
          >
            <div className="space-y-3">
              <p className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <GripVertical className="h-3 w-3" />
                {viewMode === "graph"
                  ? t("ir.paletteHintGraph", "Drag a block onto the canvas — drop on an if/loop to nest it.")
                  : t("ir.paletteHintTree", "Click a block to append it at the top level.")}
              </p>
              {PALETTE_GROUPS.map((g) => (
                <div key={g.label.def} className="space-y-1">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{t(g.label.key, g.label.def)}</div>
                  <div className="grid grid-cols-1 gap-1">
                    {g.types.map((type) => {
                      const Icon = BLOCK_ICON[type];
                      return (
                        <Button
                          key={type}
                          size="sm"
                          variant="outline"
                          className="cursor-grab justify-start active:cursor-grabbing"
                          draggable
                          onDragStart={(e) => {
                            e.dataTransfer.setData(IR_DND_MIME, type);
                            e.dataTransfer.effectAllowed = "copy";
                          }}
                          onClick={() => addTopLevel(type)}
                        >
                          <Icon className="mr-2 h-3.5 w-3.5" />{t(BLOCK_LABEL[type].key, BLOCK_LABEL[type].def)}
                        </Button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>

          {/* CENTER — canvas (Graph | Tree — two views over ONE AST) */}
          <SectionCard
            className="lg:col-span-5"
            icon={viewMode === "graph" ? <Network className="h-4 w-4" /> : <ListTree className="h-4 w-4" />}
            title={t("ir.canvas", "Flow canvas")}
            description={
              <span className="flex flex-wrap gap-2 text-xs">
                <span>{flow.blocks.length} {t("ir.topLevelBlocks", "top-level block(s)")}</span>
                {errorCount > 0 && <span className="text-destructive">· {errorCount} {t("ir.errorsShort", "error(s)")}</span>}
                {warnCount > 0 && <span className="text-warning">· {warnCount} {t("ir.warnsShort", "warning(s)")}</span>}
              </span>
            }
            action={
              <div className="inline-flex shrink-0 rounded-md border border-border p-0.5">
                <Button
                  size="sm"
                  variant={viewMode === "graph" ? "secondary" : "ghost"}
                  className="h-7 gap-1 px-2 text-xs"
                  onClick={() => setViewMode("graph")}
                  aria-pressed={viewMode === "graph"}
                >
                  <Network className="h-3.5 w-3.5" />{t("ir.viewGraph", "Graph")}
                </Button>
                <Button
                  size="sm"
                  variant={viewMode === "tree" ? "secondary" : "ghost"}
                  className="h-7 gap-1 px-2 text-xs"
                  onClick={() => setViewMode("tree")}
                  aria-pressed={viewMode === "tree"}
                >
                  <ListTree className="h-3.5 w-3.5" />{t("ir.viewTree", "Tree")}
                </Button>
              </div>
            }
          >
            {viewMode === "graph" ? (
              <IrGraphCanvas
                flow={flow}
                selectedId={selectedId}
                diagsByBlock={diagsByBlock}
                onSelect={(id) => { setSelectedId(id); setRightTab("inspector"); }}
                onDelete={handleDelete}
                onAddTopLevel={addTopLevel}
                onAddChild={handleAddChild}
                onReorderToSibling={handleReorderToSibling}
                t={t}
              />
            ) : flow.blocks.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">{t("ir.emptyCanvas", "No blocks yet. Add one from the palette on the left.")}</p>
            ) : (
              <ScrollArea className="max-h-[560px] pr-2">
                <div className="space-y-1.5">
                  {flow.blocks.map((b, i) => (
                    <BlockCard
                      key={b.id}
                      block={b}
                      selectedId={selectedId}
                      index={i}
                      siblingCount={flow.blocks.length}
                      diagsByBlock={diagsByBlock}
                      onSelect={(id) => { setSelectedId(id); setRightTab("inspector"); }}
                      onMove={handleMove}
                      onDelete={handleDelete}
                      onAddChild={handleAddChild}
                      t={t}
                    />
                  ))}
                </div>
              </ScrollArea>
            )}
          </SectionCard>

          {/* RIGHT — inspector / transpile preview */}
          <Card className="lg:col-span-4">
            <CardContent className="pt-4">
              <Tabs value={rightTab} onValueChange={(v) => setRightTab(v as "inspector" | "preview")} className="gap-3">
                <TabsList className="w-full">
                  <TabsTrigger value="inspector" className="flex-1"><Cpu className="mr-1 h-4 w-4" />{t("ir.inspector", "Inspector")}</TabsTrigger>
                  <TabsTrigger value="preview" className="flex-1"><Code2 className="mr-1 h-4 w-4" />{t("ir.preview", "Transpile preview")}</TabsTrigger>
                </TabsList>
                <TabsContent value="inspector">
                  {selectedBlock ? (
                    <Inspector block={selectedBlock} onPatch={handlePatch} t={t} />
                  ) : (
                    <p className="py-8 text-center text-sm text-muted-foreground">{t("ir.selectBlock", "Select a block on the canvas to edit its parameters.")}</p>
                  )}
                </TabsContent>
                <TabsContent value="preview">
                  <TranspilePreview flow={lintFlowInput} canView={canView} selectedId={selectedId} targets={targets} t={t} />
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </div>

        {/* KPI strip + saved flows */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MetricCard icon={<ListTree className="h-4 w-4" />} label={t("ir.kpi.blocks", "Top-level blocks")} value={flow.blocks.length} />
          <MetricCard icon={<XCircle className="h-4 w-4" />} label={t("ir.kpi.errors", "Lint errors")} value={errorCount} tone={errorCount > 0 ? "danger" : "default"} />
          <MetricCard icon={<AlertTriangle className="h-4 w-4" />} label={t("ir.kpi.warns", "Lint warnings")} value={warnCount} tone={warnCount > 0 ? "warning" : "default"} />
          <MetricCard icon={<CheckCircle2 className="h-4 w-4" />} label={t("ir.kpi.status", "Lint status")} value={lintOk ? t("ir.kpi.pass", "Pass") : t("ir.kpi.blockedShort", "Blocked")} tone={lintOk ? "good" : "danger"} />
        </div>

        <SectionCard
          icon={<FolderOpen className="h-4 w-4" />}
          title={t("ir.savedFlows", "Saved IR flows")}
          action={
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => void flowsQ.refetch()}>
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          }
        >
          {(flowsQ.data ?? []).length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">{t("ir.noFlows", "No saved IR flows yet.")}</p>
          ) : (
            <div className="space-y-1.5">
              {(flowsQ.data ?? []).map((r) => (
                <div key={r.id} className="flex items-center justify-between gap-2 rounded border px-2 py-1.5 text-sm">
                  <div className="min-w-0">
                    <div className="truncate font-medium">
                      {r.summary?.flowId ?? `artifact #${r.id}`}
                      <span className="ml-1.5 font-mono text-[10px] text-muted-foreground">
                        {r.branch} · v{r.version}
                      </span>
                    </div>
                    <div className="truncate text-[11px] text-muted-foreground">
                      {r.summary ? `${r.summary.targetDeviceType} · ${r.summary.blockCount} ${t("ir.blocksLower", "blocks")} · ${r.summary.blockTypes.join(", ")}` : t("ir.unparseable", "unparseable")}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <StatusBadge status={String(r.status)} />
                    <Button size="sm" variant="outline" className="h-7" onClick={() => void loadFlow(r.id)}>
                      <FolderOpen className="mr-1 h-3.5 w-3.5" />{t("ir.load", "Load")}
                    </Button>
                    <Button
                      size="sm" variant="ghost" className="h-7"
                      disabled={!canControl || !flagEnabled || buildM.isPending}
                      title={!flagEnabled ? t("ir.flagOffTip", "Enable DPC_IR_V2_ENABLED to build") : t("ir.buildTip", "Transpile this saved flow (deploy stays a separate gated step)")}
                      onClick={() => buildM.mutate({ artifactId: r.id })}
                    >
                      <Hammer className="mr-1 h-3.5 w-3.5" />{t("ir.build", "Request build")}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        {/* P5 — block-level version diff (added=success · removed=destructive · modified=warning · moved=primary) */}
        <SectionCard
          icon={<GitCompare className="h-4 w-4" />}
          title={t("ir.diff.title", "Version diff")}
          description={t("ir.diff.subtitle", "Compare two saved versions (or a version vs the current draft) — added / removed / modified / moved blocks, annotated on the tree.")}
        >
          <IrDiffPanel flows={flowsQ.data ?? []} currentFlow={flow} t={t} />
        </SectionCard>
      </PageContainer>
    </DashboardLayout>
  );
}
