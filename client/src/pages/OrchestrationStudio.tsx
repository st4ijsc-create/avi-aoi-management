/**
 * Phase E3b — Factory Control Plane: VISUAL ORCHESTRATION STUDIO.
 *
 * A structured visual editor that lets an engineer AUTHOR a multi-machine FOE
 * workflow (nested step-tree + inspector), SIMULATE it on the digital twin
 * (timeline / state-trace / warnings), then DEPLOY + RUN it.
 *
 * It is ADDITIVE + READ-OPEN: authoring + simulate are not FOE-gated (simulate is
 * always safe); deploy/run require machine_control and FOE_ENABLED. The produced
 * WorkflowDefinition MIRRORS server/services/orchestration/foe/workflowModel.ts so
 * `deployWorkflow` validates server-side.
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Link, useLocation } from "wouter";
import { useEngineering } from "@/contexts/EngineeringContext";
import { withParams } from "@/lib/engineeringDeepLink";
import DashboardLayout from "@/components/DashboardLayout";
import { PageHeader, PageContainer } from "@/components/patterns";
import { buildBreadcrumbs } from "@/lib/breadcrumbs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { trpc } from "@/lib/trpc";
import { toastTrpcError } from "@/lib/trpcErrors";
import { usePermissions } from "@/_core/hooks/usePermissions";
import { ViewOnlyBadge } from "@/components/PermissionGate";
import { toast } from "sonner";
import {
  Workflow,
  Terminal,
  ListOrdered,
  GitBranch,
  Layers,
  Hourglass,
  Activity,
  HandMetal,
  Timer,
  Plus,
  Trash2,
  ChevronUp,
  ChevronDown,
  FlaskConical,
  Save,
  Play,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Gauge,
  RefreshCw,
  Sparkles,
  Info,
  Wand2,
  Copy,
  History,
  GitCompare,
  RotateCcw,
  ListTree,
  Network,
} from "lucide-react";
import { LineDiff, prettyJson } from "@/components/diff/LineDiff";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  type StudioStep,
  type StudioDef,
  type StepKind,
  STEP_KINDS,
  PACKML_STATES,
  COMPARE_OPS,
  newStep,
  cloneDef,
  serializeDef,
  findStep,
  updateStep,
  deleteStep,
  moveStep,
  reorderToSibling,
  addChild,
  STEP_META,
  emptyDef,
  ON_PRECONDITION_FAIL,
} from "@/components/orchestration/workflowTypes";
import { WorkflowGraphCanvas } from "@/components/orchestration/WorkflowGraphCanvas";
import { useStepUpOtp } from "@/components/security/StepUpOtpDialog";

// ════════════════════════════════════════════════════════════════════════════
// STEP-TREE CANVAS (left) — nested visual blocks per step type
// ════════════════════════════════════════════════════════════════════════════

function StepBlock({
  step,
  depth,
  selectedId,
  onSelect,
  onMove,
  onDelete,
  onAddChild,
  siblingCount,
  index,
  t,
}: {
  step: StudioStep;
  depth: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onMove: (id: string, dir: -1 | 1) => void;
  onDelete: (id: string) => void;
  onAddChild: (parentId: string, slot: "steps" | "then" | "else", kind: StepKind) => void;
  siblingCount: number;
  index: number;
  t: TFunction;
}) {
  const meta = STEP_META[step.type];
  const Icon = ICONS[step.type];
  const selected = selectedId === step.id;

  const childLists: Array<{ slot: "steps" | "then" | "else"; label: string; items: StudioStep[] }> = [];
  if (step.type === "sequence" || step.type === "parallel") {
    childLists.push({ slot: "steps", label: "", items: step.steps ?? [] });
  } else if (step.type === "branch") {
    childLists.push({ slot: "then", label: t("studio.branchThen", "If true (then)"), items: step.then ?? [] });
    childLists.push({ slot: "else", label: t("studio.branchElse", "If false (else)"), items: step.else ?? [] });
  }

  return (
    <div className="space-y-1">
      <div
        role="button"
        tabIndex={0}
        onClick={() => onSelect(step.id)}
        onKeyDown={(e) => e.key === "Enter" && onSelect(step.id)}
        className={`group flex items-center gap-2 rounded-md border px-2 py-1.5 cursor-pointer transition-colors ${
          selected ? "ring-2 ring-primary border-primary" : "hover:bg-muted/50"
        } ${meta.border} ${meta.bg}`}
      >
        <span className={`flex h-6 w-6 items-center justify-center rounded ${meta.iconBg}`}>
          <Icon className={`h-3.5 w-3.5 ${meta.iconColor}`} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">
            {t(meta.labelKey, meta.labelDefault)}
            <span className="ml-1.5 font-mono text-[10px] text-muted-foreground">{step.id}</span>
          </div>
          <div className="truncate text-[11px] text-muted-foreground">{summarize(step, t)}</div>
        </div>
        <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            disabled={index === 0}
            onClick={(e) => { e.stopPropagation(); onMove(step.id, -1); }}
            aria-label={t("studio.moveUp", "Up")}
          >
            <ChevronUp className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            disabled={index === siblingCount - 1}
            onClick={(e) => { e.stopPropagation(); onMove(step.id, 1); }}
            aria-label={t("studio.moveDown", "Down")}
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6 text-destructive"
            onClick={(e) => { e.stopPropagation(); onDelete(step.id); }}
            aria-label={t("common.delete", "Delete")}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {childLists.map(({ slot, label, items }) => (
        <div key={slot} className="ml-4 border-l-2 border-dashed border-muted-foreground/30 pl-3 space-y-1">
          {label && <div className="pt-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>}
          {items.map((child, i) => (
            <StepBlock
              key={child.id}
              step={child}
              depth={depth + 1}
              selectedId={selectedId}
              onSelect={onSelect}
              onMove={onMove}
              onDelete={onDelete}
              onAddChild={onAddChild}
              siblingCount={items.length}
              index={i}
              t={t}
            />
          ))}
          <AddStepMenu onAdd={(k) => onAddChild(step.id, slot, k)} t={t} small />
        </div>
      ))}
    </div>
  );
}

const ICONS: Record<StepKind, typeof Terminal> = {
  command: Terminal,
  sequence: ListOrdered,
  parallel: Layers,
  branch: GitBranch,
  wait_state: Hourglass,
  wait_telemetry: Activity,
  hitl_gate: HandMetal,
  delay: Timer,
};

function summarize(step: StudioStep, t: TFunction): string {
  switch (step.type) {
    case "command":
      return `M#${step.machineId ?? "?"} · ${step.command || "—"}`;
    case "wait_state":
      return `M#${step.machineId ?? "?"} → ${(step.targetStates ?? []).join(", ") || "—"}`;
    case "wait_telemetry":
      return t("studio.conditionShort", "telemetry condition");
    case "branch":
      return t("studio.branchShort", "branch on condition");
    case "delay":
      return `${step.ms ?? 0} ms`;
    case "hitl_gate":
      return step.prompt || t("studio.gateShort", "wait for manual approval");
    case "sequence":
      return `${(step.steps ?? []).length} ${t("studio.children", "child steps")}`;
    case "parallel":
      return `${(step.steps ?? []).length} ${t("studio.branches", "parallel branches")}`;
    default:
      return "";
  }
}

function AddStepMenu({ onAdd, t, small }: { onAdd: (k: StepKind) => void; t: TFunction; small?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <Button
        size="sm"
        variant="ghost"
        className={small ? "h-6 text-[11px] text-muted-foreground" : "text-muted-foreground"}
        onClick={() => setOpen((o) => !o)}
      >
        <Plus className="mr-1 h-3.5 w-3.5" />
        {t("studio.addStep", "Add step")}
      </Button>
      {open && (
        <div className="absolute z-20 mt-1 grid w-44 grid-cols-1 gap-0.5 rounded-md border bg-popover p-1 shadow-lg">
          {STEP_KINDS.map((k) => {
            const Icon = ICONS[k];
            return (
              <button
                key={k}
                className="flex items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-muted"
                onClick={() => { onAdd(k); setOpen(false); }}
              >
                <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                {t(STEP_META[k].labelKey, STEP_META[k].labelDefault)}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// INSPECTOR (right) — config form for the selected step
// ════════════════════════════════════════════════════════════════════════════

type EquipmentRow = {
  machineId: number;
  name: string;
  code?: string | null;
  machineType: string;
  capability?: {
    supportedCommands?: Array<{ name: string; label?: string; paramsSchema?: ParamDesc[]; riskLevel?: string }>;
  };
};
type ParamDesc = {
  name: string;
  label?: string;
  dataType?: string;
  required?: boolean;
  options?: Array<string | number>;
  min?: number;
  max?: number;
  unit?: string;
};

function Inspector({
  step,
  machines,
  onPatch,
  t,
}: {
  step: StudioStep;
  machines: EquipmentRow[];
  onPatch: (patch: Partial<StudioStep>) => void;
  t: TFunction;
}) {
  const selectedMachine = useMemo(
    () => machines.find((m) => m.machineId === step.machineId),
    [machines, step.machineId],
  );
  const commands = selectedMachine?.capability?.supportedCommands ?? [];
  const selectedCmd = commands.find((c) => c.name === (step as { command?: string }).command);

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label className="text-xs">{t("studio.stepId", "Step id")}</Label>
        <Input value={step.id} onChange={(e) => onPatch({ id: e.target.value })} className="font-mono text-sm" />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">{t("studio.stepLabel", "Label (optional)")}</Label>
        <Input value={step.label ?? ""} onChange={(e) => onPatch({ label: e.target.value })} />
      </div>

      <Separator />

      {step.type === "command" && (
        <>
          <div className="space-y-1.5">
            <Label className="text-xs">{t("studio.machine", "Machine")}</Label>
            <Select
              value={step.machineId ? String(step.machineId) : ""}
              onValueChange={(v) => onPatch({ machineId: Number(v), command: "", args: {} })}
            >
              <SelectTrigger><SelectValue placeholder={t("studio.pickMachine", "Select machine…")} /></SelectTrigger>
              <SelectContent>
                {machines.map((m) => (
                  <SelectItem key={m.machineId} value={String(m.machineId)}>
                    #{m.machineId} · {m.name} ({m.machineType})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">{t("studio.command", "Command")}</Label>
            <Select
              value={(step.command as string) || ""}
              onValueChange={(v) => onPatch({ command: v, args: {} })}
              disabled={!selectedMachine}
            >
              <SelectTrigger><SelectValue placeholder={t("studio.pickCommand", "Select command…")} /></SelectTrigger>
              <SelectContent>
                {commands.map((c) => (
                  <SelectItem key={c.name} value={c.name}>
                    {c.label ?? c.name}
                    {c.riskLevel && <span className="ml-1 text-[10px] text-muted-foreground">[{c.riskLevel}]</span>}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {selectedCmd && (selectedCmd.paramsSchema?.length ?? 0) > 0 && (
            <div className="space-y-2 rounded-md border bg-muted/30 p-2">
              <div className="text-[11px] font-semibold uppercase text-muted-foreground">{t("studio.args", "Parameters")}</div>
              {(selectedCmd.paramsSchema ?? []).map((p) => (
                <ArgField key={p.name} param={p} value={(step.args ?? {})[p.name]} onChange={(val) => onPatch({ args: { ...(step.args ?? {}), [p.name]: val } })} t={t} />
              ))}
            </div>
          )}
        </>
      )}

      {step.type === "wait_state" && (
        <>
          <div className="space-y-1.5">
            <Label className="text-xs">{t("studio.machine", "Machine")}</Label>
            <Select value={step.machineId ? String(step.machineId) : ""} onValueChange={(v) => onPatch({ machineId: Number(v) })}>
              <SelectTrigger><SelectValue placeholder={t("studio.pickMachine", "Select machine…")} /></SelectTrigger>
              <SelectContent>
                {machines.map((m) => (
                  <SelectItem key={m.machineId} value={String(m.machineId)}>#{m.machineId} · {m.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">{t("studio.targetStates", "Target states (PackML)")}</Label>
            <div className="flex flex-wrap gap-1">
              {PACKML_STATES.map((s) => {
                const on = (step.targetStates ?? []).includes(s);
                return (
                  <button
                    key={s}
                    onClick={() => {
                      const cur = step.targetStates ?? [];
                      onPatch({ targetStates: on ? cur.filter((x) => x !== s) : [...cur, s] });
                    }}
                    className={`rounded border px-1.5 py-0.5 text-[11px] ${on ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted"}`}
                  >
                    {s}
                  </button>
                );
              })}
            </div>
          </div>
          <NumberField label={t("studio.timeoutMs", "Timeout (ms)")} value={step.timeoutMs ?? 30000} onChange={(n) => onPatch({ timeoutMs: n })} />
          <NumberField label={t("studio.pollMs", "Poll interval (ms, optional)")} value={step.pollMs ?? 0} onChange={(n) => onPatch({ pollMs: n > 0 ? n : undefined })} />
        </>
      )}

      {step.type === "wait_telemetry" && (
        <>
          <ConditionEditor
            condition={step.condition}
            machines={machines}
            onChange={(c) => onPatch({ condition: c })}
            t={t}
          />
          <NumberField label={t("studio.timeoutMs", "Timeout (ms)")} value={step.timeoutMs ?? 30000} onChange={(n) => onPatch({ timeoutMs: n })} />
          <NumberField label={t("studio.pollMs", "Poll interval (ms, optional)")} value={step.pollMs ?? 0} onChange={(n) => onPatch({ pollMs: n > 0 ? n : undefined })} />
        </>
      )}

      {step.type === "branch" && (
        <ConditionEditor condition={step.condition} machines={machines} onChange={(c) => onPatch({ condition: c })} t={t} />
      )}

      {step.type === "delay" && (
        <NumberField label={t("studio.delayMs", "Delay (ms)")} value={step.ms ?? 1000} onChange={(n) => onPatch({ ms: n })} />
      )}

      {step.type === "hitl_gate" && (
        <>
          <div className="space-y-1.5">
            <Label className="text-xs">{t("studio.gatePrompt", "Prompt for the approver")}</Label>
            <Textarea value={step.prompt ?? ""} onChange={(e) => onPatch({ prompt: e.target.value })} rows={3} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">{t("studio.approverRoles", "Approver roles (advisory, comma-separated)")}</Label>
            <Input
              value={(step.approverRoles ?? []).join(", ")}
              placeholder="supervisor, admin"
              onChange={(e) => {
                const roles = e.target.value.split(",").map((r) => r.trim()).filter(Boolean);
                onPatch({ approverRoles: roles.length ? roles : undefined });
              }}
            />
            <p className="text-[10px] text-muted-foreground">{t("studio.approverRolesHint", "Advisory only — RBAC is enforced at the API.")}</p>
          </div>
        </>
      )}

      {step.type === "parallel" && (
        <div className="flex items-center justify-between rounded-md border bg-muted/30 px-2 py-1.5">
          <div className="space-y-0.5">
            <Label className="text-xs">{t("studio.failFast", "Fail fast")}</Label>
            <p className="text-[10px] text-muted-foreground">{t("studio.failFastHint", "Fail the parallel on the FIRST failing branch (else only if all fail).")}</p>
          </div>
          <Checkbox checked={Boolean(step.failFast)} onCheckedChange={(v) => onPatch({ failFast: v ? true : undefined })} />
        </div>
      )}

      {(step.type === "sequence" || step.type === "parallel") && (
        <p className="text-xs text-muted-foreground">{t("studio.containerHint", "Add / reorder child steps directly on the workflow tree on the left.")}</p>
      )}

      <Separator />

      {/* ── W4-16: Nâng cao — interlock / retry / bù trừ (mọi loại bước) ── */}
      <AdvancedStepSection step={step} machines={machines} onPatch={onPatch} t={t} />
    </div>
  );
}

// ── W4-16: Section "Nâng cao" — precondition + onPreconditionFail + maxAttempts + compensation ──
function AdvancedStepSection({
  step, machines, onPatch, t,
}: {
  step: StudioStep;
  machines: EquipmentRow[];
  onPatch: (patch: Partial<StudioStep>) => void;
  t: TFunction;
}) {
  const hasPrecondition = step.precondition != null;
  const hasCompensation = step.compensation != null;

  return (
    <div className="space-y-3">
      <div className="text-[11px] font-semibold uppercase text-muted-foreground">{t("studio.advanced", "Advanced")}</div>

      {/* Precondition / interlock */}
      <div className="space-y-2 rounded-md border bg-muted/20 p-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs">{t("studio.precondition", "Precondition (interlock)")}</Label>
          <Checkbox
            checked={hasPrecondition}
            onCheckedChange={(v) => onPatch({ precondition: v ? { source: "telemetry", key: "", op: "gt", value: 0 } : undefined })}
          />
        </div>
        {hasPrecondition && (
          <>
            <ConditionEditor
              condition={step.precondition}
              machines={machines}
              onChange={(c) => onPatch({ precondition: c })}
              t={t}
              title={t("studio.preconditionCond", "Must hold before running")}
            />
            <div className="space-y-1">
              <Label className="text-[11px]">{t("studio.onPreconditionFail", "On precondition fail")}</Label>
              <Select
                value={step.onPreconditionFail ?? "hold"}
                onValueChange={(v) => onPatch({ onPreconditionFail: v as StudioStep["onPreconditionFail"] })}
              >
                <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ON_PRECONDITION_FAIL.map((o) => (
                    <SelectItem key={o} value={o}>{t(`studio.onFail.${o}`, o)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </>
        )}
      </div>

      {/* maxAttempts (retry) */}
      <NumberField
        label={t("studio.maxAttempts", "Max retry attempts (0 = no retry)")}
        value={step.maxAttempts ?? 0}
        onChange={(n) => onPatch({ maxAttempts: n > 0 ? n : undefined })}
      />

      {/* Compensation (saga undo) — chỉ hỗ trợ một lệnh bù trừ */}
      <div className="space-y-2 rounded-md border bg-muted/20 p-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs">{t("studio.compensation", "Compensation (saga undo)")}</Label>
          <Checkbox
            checked={hasCompensation}
            onCheckedChange={(v) => onPatch({
              compensation: v
                ? { id: `${step.id}-comp`, type: "command", args: {} }
                : undefined,
            })}
          />
        </div>
        {hasCompensation && step.compensation && (
          <CompensationEditor
            comp={step.compensation}
            machines={machines}
            onChange={(c) => onPatch({ compensation: c })}
            t={t}
          />
        )}
        {hasCompensation && (
          <p className="text-[10px] text-muted-foreground">{t("studio.compensationHint", "Runs one command to undo THIS step if it fails.")}</p>
        )}
      </div>
    </div>
  );
}

// Trình sửa bù trừ tối giản — một lệnh (máy + verb + args) chạy khi bước lỗi.
function CompensationEditor({
  comp, machines, onChange, t,
}: {
  comp: StudioStep;
  machines: EquipmentRow[];
  onChange: (c: StudioStep) => void;
  t: TFunction;
}) {
  const selectedMachine = machines.find((m) => m.machineId === comp.machineId);
  const commands = selectedMachine?.capability?.supportedCommands ?? [];
  return (
    <div className="space-y-2">
      <div className="space-y-1">
        <Label className="text-[11px]">{t("studio.machine", "Machine")}</Label>
        <Select
          value={comp.machineId ? String(comp.machineId) : ""}
          onValueChange={(v) => onChange({ ...comp, machineId: Number(v), command: "", args: {} })}
        >
          <SelectTrigger className="h-8 text-sm"><SelectValue placeholder={t("studio.pickMachine", "Select machine…")} /></SelectTrigger>
          <SelectContent>
            {machines.map((m) => <SelectItem key={m.machineId} value={String(m.machineId)}>#{m.machineId} · {m.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label className="text-[11px]">{t("studio.command", "Command")}</Label>
        <Select
          value={comp.command ?? ""}
          onValueChange={(v) => onChange({ ...comp, command: v, args: {} })}
          disabled={!selectedMachine}
        >
          <SelectTrigger className="h-8 text-sm"><SelectValue placeholder={t("studio.pickCommand", "Select command…")} /></SelectTrigger>
          <SelectContent>
            {commands.map((c) => <SelectItem key={c.name} value={c.name}>{c.label ?? c.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

// W4-16: validate MỘT tham số theo paramsSchema (required / kiểu / min-max). Trả thông
// điệp lỗi (đã dịch) hoặc null nếu hợp lệ. PURE — dùng cho cả hiển thị inline.
function validateArg(param: ParamDesc, value: unknown, t: TFunction): string | null {
  const isNum = param.dataType === "int" || param.dataType === "float" || param.dataType === "number";
  const isBool = param.dataType === "bool" || param.dataType === "boolean";
  const empty = value === undefined || value === null || value === "";
  if (param.required && empty && !isBool) return t("studio.argRequired", "Required");
  if (empty) return null; // không bắt buộc + rỗng → ok
  if (isNum) {
    const n = typeof value === "number" ? value : Number(value);
    if (Number.isNaN(n)) return t("studio.argNotNumber", "Must be a number");
    if (param.dataType === "int" && !Number.isInteger(n)) return t("studio.argNotInt", "Must be an integer");
    if (param.min != null && n < param.min) return t("studio.argMin", "Min {{min}}", { min: param.min });
    if (param.max != null && n > param.max) return t("studio.argMax", "Max {{max}}", { max: param.max });
  }
  if (param.options && param.options.length && !param.options.some((o) => String(o) === String(value))) {
    return t("studio.argOption", "Not an allowed value");
  }
  return null;
}

function ArgField({ param, value, onChange, t }: { param: ParamDesc; value: unknown; onChange: (v: unknown) => void; t: TFunction }) {
  const label = `${param.label ?? param.name}${param.unit ? ` (${param.unit})` : ""}${param.required ? " *" : ""}`;
  const error = validateArg(param, value, t);
  const errorEl = error ? <p className="text-[10px] text-destructive">{error}</p> : null;
  if (param.options && param.options.length) {
    return (
      <div className="space-y-1">
        <Label className="text-[11px]">{label}</Label>
        <Select value={value != null ? String(value) : ""} onValueChange={(v) => onChange(v)}>
          <SelectTrigger className={`h-8 text-sm ${error ? "border-destructive" : ""}`}><SelectValue placeholder="…" /></SelectTrigger>
          <SelectContent>
            {param.options.map((o) => <SelectItem key={String(o)} value={String(o)}>{String(o)}</SelectItem>)}
          </SelectContent>
        </Select>
        {errorEl}
      </div>
    );
  }
  const isNum = param.dataType === "int" || param.dataType === "float" || param.dataType === "number";
  const isBool = param.dataType === "bool" || param.dataType === "boolean";
  if (isBool) {
    return (
      <div className="flex items-center justify-between">
        <Label className="text-[11px]">{label}</Label>
        <Checkbox checked={Boolean(value)} onCheckedChange={(v) => onChange(Boolean(v))} />
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <Label className="text-[11px]">{label}</Label>
      <Input
        className={`h-8 text-sm ${error ? "border-destructive" : ""}`}
        type={isNum ? "number" : "text"}
        value={value != null ? String(value) : ""}
        min={param.min}
        max={param.max}
        onChange={(e) => onChange(isNum ? (e.target.value === "" ? undefined : Number(e.target.value)) : e.target.value)}
      />
      {errorEl}
    </div>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <Input type="number" value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}

// ── COMPOSITE condition builder (leaf + all/any/not) ─────────────────────────
// Mirror server Condition: một LEAF (có `source`) HOẶC một combinator (all/any/not).
type CondNode = Record<string, unknown>;

function condMode(c?: CondNode): "leaf" | "all" | "any" | "not" {
  if (!c) return "leaf";
  if (Array.isArray(c.all)) return "all";
  if (Array.isArray(c.any)) return "any";
  if (c.not) return "not";
  return "leaf";
}

const DEFAULT_LEAF: CondNode = { source: "telemetry", key: "", op: "gt", value: 0 };

// Chỉ phần LEAF (một phép so sánh) — dùng lại bên trong composite.
function LeafConditionEditor({
  condition, machines, onChange, t,
}: {
  condition?: CondNode;
  machines: EquipmentRow[];
  onChange: (c: CondNode) => void;
  t: TFunction;
}) {
  const c = (condition ?? DEFAULT_LEAF) as {
    source?: string; machineId?: number; key?: string; op?: string; value?: unknown;
  };
  const set = (patch: CondNode) => onChange({ ...c, ...patch });
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-[11px]">{t("studio.condSource", "Source")}</Label>
          <Select value={c.source ?? "telemetry"} onValueChange={(v) => set({ source: v })}>
            <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {["telemetry", "state", "param", "const"].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-[11px]">{t("studio.condOp", "Operator")}</Label>
          <Select value={c.op ?? "gt"} onValueChange={(v) => set({ op: v })}>
            <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {COMPARE_OPS.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
      {(c.source === "telemetry" || c.source === "state") && (
        <div className="space-y-1">
          <Label className="text-[11px]">{t("studio.machine", "Machine")}</Label>
          <Select value={c.machineId ? String(c.machineId) : ""} onValueChange={(v) => set({ machineId: Number(v) })}>
            <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="…" /></SelectTrigger>
            <SelectContent>
              {machines.map((m) => <SelectItem key={m.machineId} value={String(m.machineId)}>#{m.machineId} · {m.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}
      {c.source !== "state" && (
        <div className="space-y-1">
          <Label className="text-[11px]">{c.source === "const" ? t("studio.condConst", "Value (const)") : t("studio.condKey", "Key")}</Label>
          <Input className="h-8 text-sm" value={(c.key as string) ?? ""} onChange={(e) => set({ key: e.target.value })} />
        </div>
      )}
      {c.op !== "exists" && (
        <div className="space-y-1">
          <Label className="text-[11px]">{t("studio.condValue", "Comparison value")}</Label>
          <Input className="h-8 text-sm" value={c.value != null ? String(c.value) : ""} onChange={(e) => {
            const raw = e.target.value;
            const num = Number(raw);
            set({ value: raw !== "" && !Number.isNaN(num) ? num : raw });
          }} />
        </div>
      )}
    </div>
  );
}

const COND_MODES: Array<{ key: "leaf" | "all" | "any" | "not"; labelKey: string; labelDefault: string }> = [
  { key: "leaf", labelKey: "studio.condLeaf", labelDefault: "Leaf" },
  { key: "all", labelKey: "studio.condAll", labelDefault: "AND (all)" },
  { key: "any", labelKey: "studio.condAny", labelDefault: "OR (any)" },
  { key: "not", labelKey: "studio.condNot", labelDefault: "NOT" },
];

// Editor đệ quy: leaf HOẶC combinator. `depth` giới hạn lồng ≤ 3 để UI gọn.
function ConditionEditor({
  condition,
  machines,
  onChange,
  t,
  depth = 0,
  title,
}: {
  condition?: CondNode;
  machines: EquipmentRow[];
  onChange: (c: CondNode) => void;
  t: TFunction;
  depth?: number;
  title?: string;
}) {
  const mode = condMode(condition);

  const setMode = (m: "leaf" | "all" | "any" | "not") => {
    if (m === mode) return;
    const existingLeaf = mode === "leaf" && condition ? condition : null;
    if (m === "leaf") onChange({ ...DEFAULT_LEAF });
    else if (m === "all") onChange({ all: existingLeaf ? [existingLeaf] : [] });
    else if (m === "any") onChange({ any: existingLeaf ? [existingLeaf] : [] });
    else onChange({ not: existingLeaf ?? { ...DEFAULT_LEAF } });
  };

  const canNest = depth < 3; // chặn lồng quá sâu

  return (
    <div className="space-y-2 rounded-md border bg-muted/30 p-2">
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-semibold uppercase text-muted-foreground">{title ?? t("studio.condition", "Condition")}</div>
        <div className="flex gap-0.5">
          {COND_MODES.map((m) => (
            <button
              key={m.key}
              type="button"
              disabled={m.key !== "leaf" && !canNest}
              onClick={() => setMode(m.key)}
              className={`rounded border px-1.5 py-0.5 text-[10px] ${
                mode === m.key ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted disabled:opacity-40"
              }`}
            >
              {t(m.labelKey, m.labelDefault)}
            </button>
          ))}
        </div>
      </div>

      {mode === "leaf" && (
        <LeafConditionEditor condition={condition} machines={machines} onChange={onChange} t={t} />
      )}

      {(mode === "all" || mode === "any") && (
        <CompositeChildren
          items={(condition?.[mode] as CondNode[]) ?? []}
          machines={machines}
          onChange={(items) => onChange({ [mode]: items })}
          t={t}
          depth={depth}
        />
      )}

      {mode === "not" && (
        <ConditionEditor
          condition={(condition?.not as CondNode) ?? { ...DEFAULT_LEAF }}
          machines={machines}
          onChange={(c) => onChange({ not: c })}
          t={t}
          depth={depth + 1}
          title={t("studio.condNotChild", "Negated condition")}
        />
      )}
    </div>
  );
}

// Danh sách con của all/any với thêm/xoá.
function CompositeChildren({
  items, machines, onChange, t, depth,
}: {
  items: CondNode[];
  machines: EquipmentRow[];
  onChange: (items: CondNode[]) => void;
  t: TFunction;
  depth: number;
}) {
  return (
    <div className="space-y-2">
      {items.length === 0 && (
        <p className="text-[11px] text-muted-foreground">{t("studio.condNoChildren", "No sub-conditions yet — add one below.")}</p>
      )}
      {items.map((child, i) => (
        <div key={i} className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-medium text-muted-foreground">#{i + 1}</span>
            <Button
              size="icon" variant="ghost" className="h-6 w-6 text-destructive"
              onClick={() => onChange(items.filter((_, j) => j !== i))}
              aria-label={t("common.delete", "Delete")}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
          <ConditionEditor
            condition={child}
            machines={machines}
            onChange={(c) => onChange(items.map((x, j) => (j === i ? c : x)))}
            t={t}
            depth={depth + 1}
          />
        </div>
      ))}
      <Button
        size="sm" variant="ghost" className="h-7 text-[11px] text-muted-foreground"
        onClick={() => onChange([...items, { ...DEFAULT_LEAF }])}
      >
        <Plus className="mr-1 h-3.5 w-3.5" /> {t("studio.condAddChild", "Add sub-condition")}
      </Button>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// DIGITAL-TWIN VIEW — timeline / state-trace / warnings
// ════════════════════════════════════════════════════════════════════════════

const STATUS_COLOR: Record<string, string> = {
  ok: "bg-emerald-500",
  warning: "bg-amber-500",
  blocked: "bg-red-500",
  skipped: "bg-slate-400",
  gate: "bg-violet-500",
};

type SimResult = {
  ok: boolean;
  valid: boolean;
  errors: string[];
  timeline: Array<{ stepId: string; stepType: string; machineId?: number; command?: string; startMs: number; endMs: number; status: string; predictedState?: string; note?: string }>;
  warnings: Array<{ stepId: string; kind: string; message: string }>;
  totalDurationMs: number;
  machineStateTrace: Record<string, Array<{ atMs: number; state: string }>>;
};

function TwinView({ sim, machines, t }: { sim: SimResult; machines: EquipmentRow[]; t: TFunction }) {
  const total = Math.max(1, sim.totalDurationMs);
  const machineName = (id: number | string) => machines.find((m) => m.machineId === Number(id))?.name ?? `#${id}`;

  return (
    <div className="space-y-4">
      {/* Validation errors */}
      {sim.errors.length > 0 && (
        <div className="rounded-md border border-red-500/40 bg-red-500/10 p-3">
          <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-red-600">
            <XCircle className="h-4 w-4" /> {t("studio.validationErrors", "Validation errors")}
          </div>
          <ul className="ml-5 list-disc text-xs text-red-600/90">
            {sim.errors.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <Badge variant={sim.ok ? "default" : "destructive"} className={sim.ok ? "bg-emerald-500" : ""}>
          {sim.ok ? <CheckCircle2 className="mr-1 h-3 w-3" /> : <AlertTriangle className="mr-1 h-3 w-3" />}
          {sim.ok ? t("studio.simOk", "Feasible") : t("studio.simNotOk", "Has issues")}
        </Badge>
        <span className="text-muted-foreground">
          <Timer className="mr-1 inline h-3.5 w-3.5" />
          {t("studio.totalDuration", "Estimated total time")}: <b>{(sim.totalDurationMs / 1000).toFixed(1)}s</b>
        </span>
        <span className="text-muted-foreground">{sim.timeline.length} {t("studio.steps", "steps")}</span>
      </div>

      {/* Timeline / Gantt */}
      <div>
        <div className="mb-1 text-[11px] font-semibold uppercase text-muted-foreground">{t("studio.timeline", "Timeline (Gantt)")}</div>
        <div className="space-y-1">
          {sim.timeline.map((e, i) => {
            const left = (e.startMs / total) * 100;
            const width = Math.max(0.8, ((e.endMs - e.startMs) / total) * 100);
            return (
              <div key={i} className="flex items-center gap-2">
                <div className="w-28 shrink-0 truncate text-[11px] font-mono text-muted-foreground" title={`${e.stepType} · ${e.stepId}`}>
                  {e.stepId}
                </div>
                <div className="relative h-5 flex-1 rounded bg-muted/50">
                  <div
                    className={`absolute top-0 h-5 rounded ${STATUS_COLOR[e.status] ?? "bg-slate-400"} flex items-center px-1`}
                    style={{ left: `${left}%`, width: `${width}%` }}
                    title={e.note}
                  >
                    <span className="truncate text-[10px] text-white">{e.command ?? e.stepType}</span>
                  </div>
                </div>
                <div className="w-14 shrink-0 text-right text-[10px] text-muted-foreground">{e.endMs - e.startMs}ms</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Per-machine state trace */}
      {Object.keys(sim.machineStateTrace).length > 0 && (
        <div>
          <div className="mb-1 text-[11px] font-semibold uppercase text-muted-foreground">{t("studio.stateTrace", "Machine state trace")}</div>
          <div className="space-y-1.5">
            {Object.entries(sim.machineStateTrace).map(([id, pts]) => (
              <div key={id} className="flex items-center gap-2">
                <div className="w-28 shrink-0 truncate text-[11px] text-muted-foreground">{machineName(id)}</div>
                <div className="flex flex-1 flex-wrap items-center gap-1">
                  {pts.map((p, i) => (
                    <div key={i} className="flex items-center gap-1">
                      {i > 0 && <span className="text-muted-foreground">→</span>}
                      <span className="rounded border bg-card px-1.5 py-0.5 text-[10px]">
                        {p.state}<span className="ml-1 text-muted-foreground">@{p.atMs}ms</span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Warnings */}
      {sim.warnings.length > 0 && (
        <div>
          <div className="mb-1 flex items-center gap-1 text-[11px] font-semibold uppercase text-amber-600">
            <AlertTriangle className="h-3.5 w-3.5" /> {t("studio.warnings", "Warnings")} ({sim.warnings.length})
          </div>
          <ul className="space-y-1">
            {sim.warnings.map((w, i) => (
              <li key={i} className="rounded border border-amber-500/30 bg-amber-500/5 px-2 py-1 text-xs">
                <span className="font-mono text-[10px] text-muted-foreground">{w.stepId}</span>{" "}
                <Badge variant="outline" className="text-[9px]">{w.kind}</Badge>{" "}
                {w.message}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// MAIN PAGE
// ════════════════════════════════════════════════════════════════════════════

// ── Trạng thái run đã kết thúc → dừng poll để tránh refetch vô hạn ──
const TERMINAL_RUN_STATUSES = new Set(["succeeded", "completed", "failed", "aborted"]);
function isRunTerminal(status: string): boolean {
  return TERMINAL_RUN_STATUSES.has(status);
}

export default function OrchestrationStudio() {
  const { t, i18n } = useTranslation();
  // U3 (doc 26) — breadcrumb "Kỹ thuật › Section › Trang" + link về Hub.
  const [location] = useLocation();
  const crumbs = buildBreadcrumbs(location, t);
  const { hasPermission } = usePermissions();
  const canControl = hasPermission("machine_control", "canCreate");
  // U1 (doc 26) — nhớ workflow ref đang mở làm fallback deep-link khi sang Cell Twin/RF.
  const { setLastWorkflowRef } = useEngineering();

  const [def, setDef] = useState<StudioDef>(() => emptyDef());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sim, setSim] = useState<SimResult | null>(null);
  // doc 40 ENG-F4 — sim-gate: bằng chứng mô phỏng ĐẠT gắn với ĐÚNG định nghĩa (hash). Bất kỳ chỉnh
  // sửa nào đổi định nghĩa → hash đổi → sim không còn "tươi" → Deploy khoá lại (khi gate bật).
  const [simPass, setSimPass] = useState<{ hash: string; token?: string } | null>(null);
  // W4-16: view canvas — "tree" (mặc định an toàn) | "graph" (sơ đồ node react-flow).
  const [canvasView, setCanvasView] = useState<"tree" | "graph">("tree");

  // ── E5: AI advisor state ──
  const [aiGoal, setAiGoal] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiRationale, setAiRationale] = useState<string | null>(null);
  const [optimizePreview, setOptimizePreview] = useState<{ def: StudioDef; diff: string[]; rationale: string } | null>(null);

  const statusQ = trpc.orchestration.status.useQuery();
  const foeEnabled = statusQ.data?.enabled ?? false;
  // doc 40 ENG-F4 — server báo sim-gate có bắt buộc không (cờ FOE_SIM_GATE_REQUIRED). OFF → không
  // khoá Deploy theo sim (hành vi cũ); ON → phải mô phỏng ĐẠT định nghĩa hiện tại trước khi Deploy.
  const simGateRequired = statusQ.data?.simGateRequired ?? false;
  // Hash định nghĩa hiện tại (khoá so khớp với lần sim gần nhất). serializeDef xác định → ổn định.
  const defHash = useMemo(() => JSON.stringify(serializeDef(def)), [def]);
  const simFresh = simPass != null && simPass.hash === defHash;
  const aiStatusQ = trpc.aiOrchestration.status.useQuery();
  const aiEnabled = aiStatusQ.data?.enabled ?? false;

  // U4 (doc 26 §2.4) — lý do khoá nút ghi: thiếu quyền hoặc cờ FOE tắt.
  const permReason = !canControl
    ? t("common.gate.needPerm", "Requires {{perm}} permission", { perm: "machine_control" })
    : undefined;
  const controlReason = permReason ?? (!foeEnabled
    ? t("common.gate.flagOff", "Feature is OFF — enable flag {{flag}}", { flag: "FOE" })
    : undefined);

  const equipmentQ = trpc.equipment.listEquipment.useQuery({ limit: 500 });
  const machines = (equipmentQ.data ?? []) as unknown as EquipmentRow[];

  const workflowsQ = trpc.orchestration.listWorkflows.useQuery({ limit: 100 });
  // Realtime: poll khi còn run chưa kết thúc; dừng khi tất cả đã terminal.
  const runsQ = trpc.orchestration.listRuns.useQuery(
    { limit: 25 },
    {
      refetchInterval: (q) => {
        const rows = (q.state.data ?? []) as Array<Record<string, unknown>>;
        return rows.some((r) => !isRunTerminal(String(r.status ?? ""))) ? 2000 : false;
      },
    },
  );

  // U13 (doc 26 §2.2/§2.3) — tìm/lọc client cho workflows + runs.
  const [wfSearch, setWfSearch] = useState("");
  const filteredWorkflows = useMemo(() => {
    const q = wfSearch.trim().toLowerCase();
    const rows = (workflowsQ.data ?? []) as Array<Record<string, unknown>>;
    if (!q) return rows;
    return rows.filter((w) => {
      const name = String(w.name ?? "").toLowerCase();
      const ref = String(w.ref ?? "").toLowerCase();
      return name.includes(q) || ref.includes(q);
    });
  }, [workflowsQ.data, wfSearch]);

  const [runStatusFilter, setRunStatusFilter] = useState<string>("all");
  const allRuns = (runsQ.data ?? []) as Array<Record<string, unknown>>;
  // Trạng thái "chờ duyệt" = held / awaiting_confirm (HITL gate đang mở).
  const isAwaitingRun = (r: Record<string, unknown>) => {
    const s = String(r.status ?? "");
    return s === "awaiting_confirm" || s === "held";
  };
  const runStatuses = useMemo(() => {
    const set = new Set<string>();
    for (const r of allRuns) if (r.status) set.add(String(r.status));
    return Array.from(set).sort();
  }, [allRuns]);
  const filteredRuns = useMemo(
    () => (runStatusFilter === "all" ? allRuns : allRuns.filter((r) => String(r.status ?? "") === runStatusFilter)),
    [allRuns, runStatusFilter],
  );
  // §2.3 — tách nhóm "Đang chờ duyệt" LÊN ĐẦU; phần còn lại giữ thứ tự gốc.
  const awaitingRuns = useMemo(() => filteredRuns.filter(isAwaitingRun), [filteredRuns]);
  const otherRuns = useMemo(() => filteredRuns.filter((r) => !isAwaitingRun(r)), [filteredRuns]);
  // Badge đếm luôn dựa trên TỔNG số run chờ duyệt (không phụ thuộc bộ lọc đang chọn).
  const awaitingCount = useMemo(() => allRuns.filter(isAwaitingRun).length, [allRuns]);

  const utils = trpc.useUtils();
  const [simulating, setSimulating] = useState(false);
  // doc 54 P3.2 — step-up 2FA (fresh OTP) for deployWorkflow when ACTUATION_STEPUP_2FA is on.
  const stepUp = useStepUpOtp();

  const deployM = trpc.orchestration.deployWorkflow.useMutation({
    onSuccess: (r) => {
      if (r?.ok) { toast.success(t("studio.deployed", "Workflow saved / deployed")); void workflowsQ.refetch(); }
      else toast.error(r?.message ?? t("studio.deployFail", "Deploy failed"));
    },
    onError: (e) => toastTrpcError(e),
  });
  const startRunM = trpc.orchestration.startRun.useMutation({
    onSuccess: (r) => {
      toast.success(t("studio.runStarted", "Run started (run #{{id}})", { id: r?.runId ?? "?" }));
      void runsQ.refetch();
    },
    onError: (e) => toastTrpcError(e),
  });
  const resumeM = trpc.orchestration.resumeRun.useMutation({
    onSuccess: () => { void runsQ.refetch(); void utils.orchestration.getRun.invalidate(); },
    onError: (e) => toastTrpcError(e),
  });
  const abortM = trpc.orchestration.abortRun.useMutation({
    onSuccess: () => { void runsQ.refetch(); },
    onError: (e) => toastTrpcError(e),
  });

  // ── Saved-workflow delete / duplicate ──
  const [deleteWf, setDeleteWf] = useState<{ id: number; ref: string } | null>(null);
  const [dupWf, setDupWf] = useState<{ id: number; ref: string; name: string } | null>(null);
  const [dupNewRef, setDupNewRef] = useState("");

  const deleteWfM = trpc.orchestration.deleteWorkflow.useMutation({
    onSuccess: () => { toast.success(t("studio.wfDeleted", "Workflow deleted")); setDeleteWf(null); void workflowsQ.refetch(); },
    onError: (e) => toastTrpcError(e),
  });
  const duplicateWfM = trpc.orchestration.duplicateWorkflow.useMutation({
    onSuccess: () => { toast.success(t("studio.wfDuplicated", "Workflow duplicated")); setDupWf(null); setDupNewRef(""); void workflowsQ.refetch(); },
    onError: (e) => toastTrpcError(e),
  });

  // ── W3-11: version history panel (diff 2 phiên bản + rollback) ──
  const [versionsWf, setVersionsWf] = useState<{ id: number; ref: string } | null>(null);
  const [vDiffBaseId, setVDiffBaseId] = useState<number | null>(null);
  const [vDiffCompareId, setVDiffCompareId] = useState<number | null>(null);
  const [rollbackVer, setRollbackVer] = useState<{ workflowId: number; version: number } | null>(null);
  const versionsQ = trpc.orchestration.listVersions.useQuery(
    { workflowId: versionsWf?.id ?? 0 },
    { enabled: versionsWf != null },
  );
  const versionRows = (versionsQ.data ?? []) as Array<{ id: number; version: number; name: string; definitionJson: unknown }>;
  const vDiffBase = versionRows.find((v) => v.id === vDiffBaseId) ?? null;
  const vDiffCompare = versionRows.find((v) => v.id === vDiffCompareId) ?? null;
  const rollbackWfM = trpc.orchestration.rollbackWorkflow.useMutation({
    onSuccess: (r) => {
      if (r?.ok) {
        toast.success(t("studio.rollbackDone", "Đã khôi phục — tạo phiên bản mới từ bản cũ"));
        setRollbackVer(null);
        void workflowsQ.refetch();
        void versionsQ.refetch();
      } else {
        toast.error(r?.message ?? t("studio.rollbackFail", "Khôi phục thất bại"));
      }
    },
    onError: (e) => toastTrpcError(e),
  });

  const selectedStep = selectedId ? findStep(def.steps, selectedId) : null;

  const mutate = (fn: (d: StudioDef) => void) => {
    setDef((prev) => { const next = cloneDef(prev); fn(next); return next; });
  };

  const handleAddTopLevel = (kind: StepKind) => {
    const s = newStep(kind, def);
    mutate((d) => { d.steps.push(s); });
    setSelectedId(s.id);
  };
  const handleAddChild = (parentId: string, slot: "steps" | "then" | "else", kind: StepKind) => {
    const s = newStep(kind, def);
    mutate((d) => addChild(d.steps, parentId, slot, s));
    setSelectedId(s.id);
  };
  const handlePatch = (patch: Partial<StudioStep>) => {
    if (!selectedId) return;
    mutate((d) => updateStep(d.steps, selectedId, patch));
    if (patch.id) setSelectedId(patch.id);
  };
  const handleDelete = (id: string) => {
    mutate((d) => deleteStep(d.steps, id));
    if (selectedId === id) setSelectedId(null);
  };
  const handleMove = (id: string, dir: -1 | 1) => mutate((d) => moveStep(d.steps, id, dir));
  // U14 — nối cạnh trên sơ đồ: sắp lại thứ tự anh-em (chỉ trong cùng danh sách).
  const handleReorderToSibling = (sourceId: string, targetId: string) =>
    mutate((d) => { reorderToSibling(d.steps, sourceId, targetId); });
  // T-2 (doc 38) — kéo-thả node trên sơ đồ → lưu toạ độ vào step.ui (write-back vào AST).
  const handleMoveNode = (id: string, pos: { x: number; y: number }) =>
    mutate((d) => updateStep(d.steps, id, { ui: { x: pos.x, y: pos.y } }));

  const loadWorkflow = (row: { definitionJson?: unknown }) => {
    const json = row.definitionJson as StudioDef | undefined;
    if (json && Array.isArray(json.steps)) {
      const cloned = cloneDef(json);
      setDef(cloned);
      setSelectedId(null);
      setSim(null);
      setSimPass(null); // doc 40 ENG-F4 — định nghĩa mới nạp vào → phải mô phỏng lại trước khi Deploy
      setLastWorkflowRef(cloned.ref || null); // U1 — nhớ ref để mang sang Cell Twin
      toast.success(t("studio.loaded", "Workflow loaded into the editor"));
    }
  };

  const runSimulate = async () => {
    setSimulating(true);
    try {
      const payload = serializeDef(def) as Record<string, unknown>;
      const submittedHash = JSON.stringify(payload);
      const res = await utils.orchestration.simulate.fetch({ workflow: payload });
      setSim(res as unknown as SimResult);
      // doc 40 ENG-F4 — sim ĐẠT → nhớ token gắn với ĐÚNG định nghĩa vừa nộp để qua sim-gate ở Deploy.
      // Sim không đạt → xoá bằng chứng cũ (Deploy sẽ khoá lại khi gate bật).
      if (res?.ok) setSimPass({ hash: submittedHash, token: (res as { simToken?: string }).simToken });
      else setSimPass(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSimulating(false);
    }
  };
  // doc 40 ENG-F4 — mang sim-token (nếu còn tươi cho định nghĩa hiện tại) sang server để qua sim-gate.
  // doc 54 P3.2 — deployWorkflow chạy deployProcedure → step-up 2FA (OTP tươi) khi cờ bật.
  const runDeploy = () =>
    stepUp.guard((totpCode) => deployM.mutate({
      definition: serializeDef(def) as Record<string, unknown>,
      simToken: simFresh ? simPass?.token : undefined,
      totpCode,
    }));
  const runStart = () => startRunM.mutate({ workflowRef: def.ref, params: {} });

  // ── E5: AI advisor — propose / optimize (HITL: AI only proposes; human deploys) ──
  const i18nLang = (((i18n.language || "vi").slice(0, 2)) as "vi" | "en" | "zh");

  const aiSuggest = async () => {
    setAiBusy(true);
    setAiRationale(null);
    try {
      const res = await utils.aiOrchestration.suggestWorkflow.fetch({
        goal: aiGoal.trim() || undefined,
        lang: i18nLang,
      });
      if (!res.available) {
        toast.error(res.message ?? t("studio.aiUnavailable", "AI advisor is not available yet"));
        return;
      }
      if (res.workflow) {
        // Load the AI proposal into the editor — the human STILL reviews + deploys manually.
        setDef(cloneDef(res.workflow as unknown as StudioDef));
        setSelectedId(null);
        setAiRationale(res.rationale || null);
        setSim((res.simulation as unknown as SimResult) ?? null);
        if (res.valid) toast.success(t("studio.aiProposed", "AI proposed a workflow — review it before deploying"));
        else toast.warning(res.message ?? t("studio.aiInvalid", "AI could not produce a valid workflow"));
      } else {
        toast.error(res.message ?? t("studio.aiInvalid", "AI could not produce a valid workflow"));
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setAiBusy(false);
    }
  };

  const aiOptimize = async () => {
    setAiBusy(true);
    try {
      const res = await utils.aiOrchestration.optimizeWorkflow.fetch({
        workflow: serializeDef(def) as Record<string, unknown>,
        goal: aiGoal.trim() || undefined,
        lang: i18nLang,
      });
      if (!res.available) {
        toast.error(res.message ?? t("studio.aiUnavailable", "AI advisor is not available yet"));
        return;
      }
      if (res.workflow) {
        setSim((res.simulation as unknown as SimResult) ?? null);
        setOptimizePreview({
          def: cloneDef(res.workflow as unknown as StudioDef),
          diff: res.diff ?? [],
          rationale: res.rationale || "",
        });
        if (!res.valid) toast.warning(res.message ?? t("studio.aiInvalid", "AI could not produce a valid workflow"));
      } else {
        toast.error(res.message ?? t("studio.aiInvalid", "AI could not produce a valid workflow"));
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setAiBusy(false);
    }
  };

  const acceptOptimized = () => {
    if (!optimizePreview) return;
    setDef(cloneDef(optimizePreview.def));
    setSelectedId(null);
    setAiRationale(optimizePreview.rationale || null);
    setOptimizePreview(null);
    toast.success(t("studio.aiOptimizeApplied", "Applied the AI-optimized workflow"));
  };

  return (
    <DashboardLayout>
      <PageContainer fluid className="flex flex-col gap-4 space-y-0">
        {/* Header */}
        <PageHeader
          breadcrumbs={crumbs}
          icon={<Workflow className="h-6 w-6" />}
          title={t("studio.title", "Orchestration Studio")}
          badge={!canControl ? <ViewOnlyBadge module="machine_control" /> : undefined}
          description={t("studio.subtitle", "Author multi-machine workflows visually, simulate them on the digital twin, then deploy & run")}
          actions={
            <>
              <Button variant="outline" onClick={() => void runSimulate()} disabled={simulating || def.steps.length === 0}>
                <FlaskConical className="mr-1.5 h-4 w-4" /> {t("studio.simulate", "Simulate")}
              </Button>
              <Button
                variant="outline"
                onClick={runDeploy}
                disabled={!canControl || !foeEnabled || deployM.isPending || (simGateRequired && !simFresh)}
                title={
                  controlReason ??
                  (simGateRequired && !simFresh
                    ? t("studio.simRequired", "Chưa mô phỏng đạt — hãy Simulate đến khi feasible trước khi Deploy")
                    : undefined)
                }
              >
                <Save className="mr-1.5 h-4 w-4" /> {t("studio.deploy", "Save (deploy)")}
              </Button>
              <Button onClick={runStart} disabled={!canControl || !foeEnabled || startRunM.isPending || !def.ref} title={controlReason}>
                <Play className="mr-1.5 h-4 w-4" /> {t("studio.run", "Run")}
              </Button>
            </>
          }
        />

        {/* U7 (doc 26 §2.1) — "Khi nào dùng": trang LÀ GÌ / DÙNG KHI NÀO cho KTV mới. */}
        <div className="flex items-start gap-2 rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
          <span>{t("studio.whenToUse", "When to use — design multi-machine workflows visually and dry-run them on the twin before deploying. For a single-device program use the Engineering Workspace.")}</span>
        </div>

        {/* FOE disabled banner */}
        {!statusQ.isLoading && !foeEnabled && (
          <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <span>{t("studio.foeOff", "FOE is off (FOE_ENABLED) — you can still author & simulate, but deploy/run are disabled.")}</span>
          </div>
        )}

        {/* doc 40 ENG-F4 — sim-gate: đánh dấu bước Simulate là BẮT BUỘC trước Deploy (khi cờ bật). */}
        {simGateRequired && foeEnabled && (
          <div className={`flex items-start gap-2 rounded-md border p-2 text-xs ${simFresh ? "border-emerald-500/40 bg-emerald-500/10" : "border-sky-500/40 bg-sky-500/10"}`}>
            <FlaskConical className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${simFresh ? "text-emerald-600" : "text-sky-600"}`} aria-hidden="true" />
            <span>
              {simFresh
                ? t("studio.simGateOk", "Mô phỏng đã ĐẠT cho định nghĩa hiện tại — có thể Deploy.")
                : t("studio.simGateRequiredHint", "Sim-gate BẬT: phải Simulate ĐẠT (feasible) định nghĩa hiện tại trước khi Deploy. Mọi chỉnh sửa sẽ yêu cầu mô phỏng lại.")}
            </span>
          </div>
        )}

        {/* E5 — AI advisor (propose / optimize). HITL: AI only proposes; the human deploys. */}
        <Card className="border-violet-500/30 bg-violet-500/5">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4 text-violet-600" />
              {t("studio.aiTitle", "AI orchestration advisor")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-col gap-2 md:flex-row md:items-end">
              <div className="flex-1 space-y-1.5">
                <Label className="text-xs">{t("studio.aiGoal", "Goal / problem (for the AI)")}</Label>
                <Input
                  value={aiGoal}
                  onChange={(e) => setAiGoal(e.target.value)}
                  placeholder={t("studio.aiGoalPlaceholder", "e.g. AOI reports NG → robot rejects part → conveyor moves it; add an approval gate before stopping the line")}
                  disabled={!aiEnabled || aiBusy}
                />
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="border-violet-500/40"
                  onClick={() => void aiSuggest()}
                  disabled={!aiEnabled || aiBusy}
                  title={!aiEnabled ? t("studio.aiOff", "Enable AI_ORCHESTRATION_ADVISOR_ENABLED to use") : undefined}
                >
                  <Sparkles className="mr-1.5 h-4 w-4" /> {t("studio.aiSuggest", "AI suggest workflow")}
                </Button>
                <Button
                  variant="outline"
                  className="border-violet-500/40"
                  onClick={() => void aiOptimize()}
                  disabled={!aiEnabled || aiBusy || def.steps.length === 0}
                  title={!aiEnabled ? t("studio.aiOff", "Enable AI_ORCHESTRATION_ADVISOR_ENABLED to use") : undefined}
                >
                  <Wand2 className="mr-1.5 h-4 w-4" /> {t("studio.aiOptimize", "AI optimize")}
                </Button>
              </div>
            </div>

            {!aiStatusQ.isLoading && !aiEnabled && (
              <p className="text-xs text-muted-foreground">
                {t("studio.aiDisabledHint", "The AI advisor is OFF (AI_ORCHESTRATION_ADVISOR_ENABLED). AI only PROPOSES — a human always reviews & deploys manually.")}
              </p>
            )}

            {aiRationale && (
              <div className="rounded-md border border-violet-500/30 bg-card p-2 text-xs">
                <span className="font-semibold text-violet-700">{t("studio.aiRationale", "AI rationale")}: </span>
                {aiRationale}
              </div>
            )}

            {/* Optimize preview — accept (replace editor) or discard. */}
            {optimizePreview && (
              <div className="space-y-2 rounded-md border border-violet-500/40 bg-card p-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-violet-700">
                  <Wand2 className="h-4 w-4" /> {t("studio.aiOptimizePreview", "AI-proposed optimization")}
                </div>
                {optimizePreview.rationale && (
                  <p className="text-xs text-muted-foreground">{optimizePreview.rationale}</p>
                )}
                {optimizePreview.diff.length > 0 && (
                  <ul className="ml-4 list-disc text-xs">
                    {optimizePreview.diff.map((d, i) => <li key={i}>{d}</li>)}
                  </ul>
                )}
                <div className="flex gap-2">
                  <Button size="sm" className="bg-violet-600 hover:bg-violet-700" onClick={acceptOptimized}>
                    {t("studio.aiAccept", "Apply to editor")}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setOptimizePreview(null)}>
                    {t("studio.aiDiscard", "Discard")}
                  </Button>
                </div>
              </div>
            )}
            <p className="text-[11px] text-muted-foreground">
              {t("studio.aiHitlNote", "HITL: AI only proposes a workflow + simulates it on the digital twin. Saving (deploy) & running are always done manually by a human.")}
            </p>
          </CardContent>
        </Card>

        {/* TOP — workflow meta + params */}
        <Card>
          <CardContent className="grid grid-cols-1 gap-3 py-4 md:grid-cols-4">
            <div className="space-y-1.5">
              <Label className="text-xs">{t("studio.ref", "Workflow ref *")}</Label>
              <Input value={def.ref} onChange={(e) => setDef((d) => ({ ...d, ref: e.target.value }))} placeholder="line-a-startup" className="font-mono" />
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <Label className="text-xs">{t("studio.name", "Name *")}</Label>
              <Input value={def.name} onChange={(e) => setDef((d) => ({ ...d, name: e.target.value }))} placeholder={t("studio.namePlaceholder", "Line A startup")} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t("studio.version", "Version")}</Label>
              <Input type="number" value={def.version ?? 1} onChange={(e) => setDef((d) => ({ ...d, version: Number(e.target.value) }))} />
            </div>
          </CardContent>
        </Card>

        {/* MAIN GRID — tree canvas + inspector */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {/* LEFT — step tree / node-graph (toggle Cây | Sơ đồ) */}
          <Card className="lg:col-span-2">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-base">
                {canvasView === "tree" ? t("studio.canvas", "Workflow tree") : t("studio.graphCanvas", "Workflow diagram")}
              </CardTitle>
              {/* Toggle view — cây là mặc định an toàn; sơ đồ là view đọc + chọn node */}
              <div className="inline-flex overflow-hidden rounded-md border" role="tablist" aria-label={t("studio.viewToggle", "View")}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={canvasView === "tree"}
                  onClick={() => setCanvasView("tree")}
                  className={`flex items-center gap-1 px-2.5 py-1 text-xs transition-colors ${
                    canvasView === "tree" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
                  }`}
                >
                  <ListTree className="h-3.5 w-3.5" /> {t("studio.viewTree", "Tree")}
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={canvasView === "graph"}
                  onClick={() => setCanvasView("graph")}
                  className={`flex items-center gap-1 px-2.5 py-1 text-xs transition-colors ${
                    canvasView === "graph" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
                  }`}
                >
                  <Network className="h-3.5 w-3.5" /> {t("studio.viewGraph", "Diagram")}
                </button>
              </div>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {canvasView === "tree" ? (
                <>
                  {def.steps.length === 0 && (
                    <p className="py-6 text-center text-sm text-muted-foreground">{t("studio.emptyCanvas", "No steps yet. Add the first step below.")}</p>
                  )}
                  {def.steps.map((s, i) => (
                    <StepBlock
                      key={s.id}
                      step={s}
                      depth={0}
                      selectedId={selectedId}
                      onSelect={setSelectedId}
                      onMove={handleMove}
                      onDelete={handleDelete}
                      onAddChild={handleAddChild}
                      siblingCount={def.steps.length}
                      index={i}
                      t={t}
                    />
                  ))}
                  <AddStepMenu onAdd={handleAddTopLevel} t={t} />
                </>
              ) : (
                <>
                  {/* U14 — canvas luôn hiển thị (kể cả khi trống): palette cho phép thêm bước đầu tiên ngay trên sơ đồ. */}
                  <WorkflowGraphCanvas
                    def={def}
                    selectedId={selectedId}
                    onSelect={setSelectedId}
                    onDelete={handleDelete}
                    onAddTopLevel={handleAddTopLevel}
                    onAddChild={handleAddChild}
                    onReorderToSibling={handleReorderToSibling}
                    onMoveNode={handleMoveNode}
                    t={t}
                  />
                  <p className="text-[11px] text-muted-foreground">{t("studio.graphHintEdit", "Click a chip to add a step (or drag it onto a container to nest); drag a link between two siblings to reorder; use the trash icon or Delete to remove. Click a node to configure it in the inspector.")}</p>
                </>
              )}
            </CardContent>
          </Card>

          {/* RIGHT — inspector */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{t("studio.inspector", "Step configuration")}</CardTitle>
            </CardHeader>
            <CardContent>
              {selectedStep ? (
                <Inspector step={selectedStep} machines={machines} onPatch={handlePatch} t={t} />
              ) : (
                <p className="py-6 text-center text-sm text-muted-foreground">{t("studio.selectStep", "Select a step on the tree to configure it.")}</p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* TWIN VIEW */}
        {sim && (
          <Card>
            <CardHeader className="pb-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Gauge className="h-4 w-4 text-primary" /> {t("studio.twin", "Digital twin — simulation result")}
                </CardTitle>
                {/* W6-26 + U1 — cross-link golden-thread: sim → xem phát lại trên twin viewer,
                    MANG ?ref= workflow đang mở để Cell Twin tự chọn đúng workflow (không mở trống). */}
                <span className="flex items-center gap-3 text-xs">
                  <Link href={withParams("/cell-twin", { ref: def.ref || null })} className="font-medium text-primary hover:underline">
                    {def.ref ? t("studio.viewOnCellTwin", "Xem trên Cell Twin") : t("nav.cellTwin")}
                  </Link>
                  <Link href="/rf-test-cell" className="font-medium text-primary hover:underline">{t("nav.rfTestCell")}</Link>
                </span>
              </div>
            </CardHeader>
            <CardContent>
              <TwinView sim={sim} machines={machines} t={t} />
            </CardContent>
          </Card>
        )}

        {/* WORKFLOWS + RUNS */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* Saved workflows */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-base">{t("studio.workflows", "Saved workflows")}</CardTitle>
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => void workflowsQ.refetch()}>
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {/* U13 — ô tìm theo tên/mã (lọc phía client). */}
              {(workflowsQ.data ?? []).length > 0 && (
                <Input
                  value={wfSearch}
                  onChange={(e) => setWfSearch(e.target.value)}
                  placeholder={t("studio.searchWorkflows", "Tìm theo tên hoặc mã…")}
                  className="h-8 text-sm"
                />
              )}
              {(workflowsQ.data ?? []).length === 0 && (
                <p className="py-4 text-center text-sm text-muted-foreground">{t("studio.noWorkflows", "No workflows yet.")}</p>
              )}
              {(workflowsQ.data ?? []).length > 0 && filteredWorkflows.length === 0 && (
                <p className="py-4 text-center text-sm text-muted-foreground">{t("studio.noWorkflowMatch", "Không có quy trình khớp bộ lọc")}</p>
              )}
              {filteredWorkflows.map((w: Record<string, unknown>) => (
                <div key={String(w.id)} className="flex items-center justify-between rounded border px-2 py-1.5 text-sm">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{String(w.name ?? w.ref)}</div>
                    <div className="truncate font-mono text-[10px] text-muted-foreground">{String(w.ref)} · v{String(w.version ?? 1)}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button size="sm" variant="outline" onClick={() => loadWorkflow(w as { definitionJson?: unknown })}>
                      {t("studio.load", "Load")}
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      title={t("studio.versions", "Versions")}
                      onClick={() => { setVersionsWf({ id: Number(w.id), ref: String(w.ref) }); setVDiffBaseId(null); setVDiffCompareId(null); }}
                    >
                      <History className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      disabled={!canControl}
                      title={permReason ?? t("studio.duplicate", "Duplicate")}
                      onClick={() => { setDupWf({ id: Number(w.id), ref: String(w.ref), name: String(w.name ?? w.ref) }); setDupNewRef(`${String(w.ref)}-copy`); }}
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-destructive"
                      disabled={!canControl}
                      title={permReason ?? t("common.delete", "Delete")}
                      onClick={() => setDeleteWf({ id: Number(w.id), ref: String(w.ref) })}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Recent runs */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                {t("studio.runs", "Recent runs")}
                {/* U13 §2.3 — badge đếm run đang chờ duyệt (tổng, không theo bộ lọc). */}
                {awaitingCount > 0 && (
                  <Badge className="bg-amber-500 text-white">{awaitingCount}</Badge>
                )}
              </CardTitle>
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => void runsQ.refetch()}>
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {/* U13 — lọc theo trạng thái (lọc phía client). */}
              {allRuns.length > 0 && (
                <Select value={runStatusFilter} onValueChange={setRunStatusFilter}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("studio.allStatuses", "Tất cả trạng thái")}</SelectItem>
                    {runStatuses.map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {allRuns.length === 0 && (
                <p className="py-4 text-center text-sm text-muted-foreground">{t("studio.noRuns", "No runs yet.")}</p>
              )}
              {allRuns.length > 0 && filteredRuns.length === 0 && (
                <p className="py-4 text-center text-sm text-muted-foreground">{t("studio.noRunMatch", "Không có lần chạy khớp bộ lọc")}</p>
              )}
              {/* §2.3 — nhóm "Đang chờ duyệt" ghim lên đầu. */}
              {awaitingRuns.length > 0 && (
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 pt-1 text-xs font-semibold text-amber-600 dark:text-amber-400">
                    <Hourglass className="h-3.5 w-3.5" />
                    {t("studio.awaitingApproval", "Đang chờ duyệt")}
                    <Badge variant="outline" className="text-[10px]">{awaitingRuns.length}</Badge>
                  </div>
                  {awaitingRuns.map((r: Record<string, unknown>) => (
                    <RunRow
                      key={String(r.id)}
                      run={r}
                      canControl={canControl}
                      onResume={(approved, note) => resumeM.mutate({ runId: Number(r.id), approved, note })}
                      onAbort={() => abortM.mutate({ runId: Number(r.id) })}
                      t={t}
                    />
                  ))}
                </div>
              )}
              {/* Các run còn lại. */}
              {otherRuns.length > 0 && (
                <div className="space-y-1.5">
                  {awaitingRuns.length > 0 && (
                    <div className="pt-1 text-xs font-semibold text-muted-foreground">
                      {t("studio.otherRuns", "Lần chạy khác")}
                    </div>
                  )}
                  {otherRuns.map((r: Record<string, unknown>) => (
                    <RunRow
                      key={String(r.id)}
                      run={r}
                      canControl={canControl}
                      onResume={(approved, note) => resumeM.mutate({ runId: Number(r.id), approved, note })}
                      onAbort={() => abortM.mutate({ runId: Number(r.id) })}
                      t={t}
                    />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* editor note — cả cây lồng lẫn sơ đồ node đều xem chung một model */}
        <p className="text-center text-[11px] text-muted-foreground">
          {t("studio.editorNote", "Author on the nested step tree, or switch to the node-graph diagram to visualize sequence / parallel / branch.")}
        </p>
      </PageContainer>

      {/* Duplicate workflow dialog */}
      <Dialog open={dupWf != null} onOpenChange={(o) => { if (!o) { setDupWf(null); setDupNewRef(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("studio.duplicateTitle", "Duplicate workflow")}</DialogTitle>
            <DialogDescription>{t("studio.duplicateDesc", "Create a copy with a new ref. The copy carries no runs.")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label className="text-xs">{t("studio.duplicateNewRef", "New workflow ref *")}</Label>
            <Input value={dupNewRef} onChange={(e) => setDupNewRef(e.target.value)} className="font-mono" placeholder="line-a-startup-copy" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDupWf(null); setDupNewRef(""); }}>{t("common.cancel", "Cancel")}</Button>
            <Button
              disabled={!dupNewRef.trim() || duplicateWfM.isPending}
              onClick={() => dupWf && duplicateWfM.mutate({ id: dupWf.id, newRef: dupNewRef.trim() })}
            >
              {t("studio.duplicate", "Duplicate")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete workflow confirm */}
      <AlertDialog open={deleteWf != null} onOpenChange={(o) => !o && setDeleteWf(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("studio.deleteWfTitle", "Delete workflow?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("studio.deleteWfDesc", "Workflow \"{{ref}}\" and its finished run history will be deleted. If any run is still active, the operation is rejected.", { ref: deleteWf?.ref })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel", "Cancel")}</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground" onClick={() => deleteWf && deleteWfM.mutate({ id: deleteWf.id })}>
              {t("common.delete", "Delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* W3-11 — Version history: diff 2 phiên bản + rollback */}
      <Dialog open={versionsWf != null} onOpenChange={(o) => { if (!o) setVersionsWf(null); }}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{t("studio.versionsTitle", "Version history")}</DialogTitle>
            <DialogDescription>
              {t("studio.versionsDesc", "Each deploy snapshots a version. Compare two versions or roll back (rollback re-deploys the old definition as a NEW version).")}
              {versionsWf ? ` — ${versionsWf.ref}` : ""}
            </DialogDescription>
          </DialogHeader>

          {versionsQ.isLoading && <p className="py-3 text-center text-sm text-muted-foreground">{t("common.loading", "Loading…")}</p>}
          {versionsQ.isError && <p className="py-3 text-center text-sm text-destructive">{t("common.loadError", "Failed to load")}</p>}
          {!versionsQ.isLoading && !versionsQ.isError && versionRows.length === 0 && (
            <p className="py-3 text-center text-sm text-muted-foreground">
              {t("studio.noVersions", "No version snapshots yet (only versions deployed after this feature are recorded).")}
            </p>
          )}

          {versionRows.length > 0 && (
            <div className="space-y-3">
              {/* Danh sách phiên bản + nút rollback */}
              <div className="max-h-[180px] space-y-1 overflow-auto rounded-md border p-1.5">
                {versionRows.map((v) => (
                  <div key={v.id} className="flex items-center justify-between rounded px-2 py-1 text-sm hover:bg-muted/50">
                    <span className="font-mono text-xs">v{v.version} <span className="text-muted-foreground">· {v.name}</span></span>
                    <Button
                      size="sm" variant="outline" className="h-7"
                      disabled={!canControl || rollbackWfM.isPending}
                      title={permReason}
                      onClick={() => setRollbackVer({ workflowId: versionsWf!.id, version: v.version })}
                    >
                      <RotateCcw className="mr-1 h-3.5 w-3.5" /> {t("studio.rollback", "Rollback")}
                    </Button>
                  </div>
                ))}
              </div>

              {/* So sánh 2 phiên bản (diff định nghĩa JSON) */}
              {versionRows.length >= 2 && (
                <div className="rounded-md border bg-muted/20 p-2">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
                      <GitCompare className="h-3.5 w-3.5" /> {t("studio.compareVersions", "Compare versions")}
                    </span>
                    <Select value={vDiffBaseId != null ? String(vDiffBaseId) : ""} onValueChange={(v) => setVDiffBaseId(Number(v))}>
                      <SelectTrigger className="h-7 w-24 text-xs"><SelectValue placeholder={t("studio.diffBase", "Base")} /></SelectTrigger>
                      <SelectContent>
                        {versionRows.map((v) => <SelectItem key={v.id} value={String(v.id)}>v{v.version}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <span className="text-xs text-muted-foreground">→</span>
                    <Select value={vDiffCompareId != null ? String(vDiffCompareId) : ""} onValueChange={(v) => setVDiffCompareId(Number(v))}>
                      <SelectTrigger className="h-7 w-24 text-xs"><SelectValue placeholder={t("studio.diffCompare", "Compare")} /></SelectTrigger>
                      <SelectContent>
                        {versionRows.map((v) => <SelectItem key={v.id} value={String(v.id)}>v{v.version}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  {vDiffBase && vDiffCompare ? (
                    <LineDiff left={prettyJson(vDiffBase.definitionJson)} right={prettyJson(vDiffCompare.definitionJson)} maxHeightClass="max-h-[280px]" />
                  ) : (
                    <p className="py-2 text-center text-xs text-muted-foreground">{t("studio.diffPick", "Pick two versions to compare.")}</p>
                  )}
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setVersionsWf(null)}>{t("common.close", "Close")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* W3-11 — Rollback confirm */}
      <AlertDialog open={rollbackVer != null} onOpenChange={(o) => { if (!o) setRollbackVer(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("studio.rollbackTitle", "Roll back to this version?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("studio.rollbackConfirm", "This re-deploys version v{{version}}'s definition as a NEW version (append-only; history is preserved). Flag-gated by FOE_ENABLED.", { version: rollbackVer?.version ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel", "Cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { if (rollbackVer) rollbackWfM.mutate({ workflowId: rollbackVer.workflowId, version: rollbackVer.version }); }}
            >
              {t("studio.rollback", "Rollback")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {/* doc 54 P3.2 — step-up 2FA prompt for workflow deploy */}
      {stepUp.dialog}
    </DashboardLayout>
  );
}

const RUN_STATUS_COLOR: Record<string, string> = {
  succeeded: "bg-emerald-500",
  completed: "bg-emerald-500",
  running: "bg-blue-500",
  active: "bg-blue-500",
  queued: "bg-slate-400",
  awaiting_confirm: "bg-violet-500",
  held: "bg-amber-500",
  failed: "bg-red-500",
  aborted: "bg-red-500",
};

// U6 (doc 26) — kiểu bước run kèm `result` (chứa prompt/approverRoles của hitl_gate).
type RunStepView = {
  stepId: string;
  stepType: string;
  status: string;
  result?: Record<string, unknown> | null;
};

function RunRow({
  run,
  canControl,
  onResume,
  onAbort,
  t,
}: {
  run: Record<string, unknown>;
  canControl: boolean;
  onResume: (approved: boolean, note?: string) => void;
  onAbort: () => void;
  t: TFunction;
}) {
  const [open, setOpen] = useState(false);
  // U6 — chế độ nhập lý do khi từ chối (reject) + nội dung lý do.
  const [rejecting, setRejecting] = useState(false);
  const [rejectNote, setRejectNote] = useState("");
  const status = String(run.status ?? "");
  const runId = Number(run.id);
  const awaiting = status === "awaiting_confirm" || status === "held";
  // Realtime: khi panel mở → poll bước; run đang chờ duyệt cũng nạp 1 lần (không poll)
  // để lấy NGỮ CẢNH gate (prompt/approverRoles) hiển thị cạnh nút Approve.
  const detailQ = trpc.orchestration.getRun.useQuery(
    { runId },
    {
      enabled: open || (awaiting && canControl),
      refetchInterval: (q) => {
        const st = String((q.state.data as { run?: { status?: string } } | undefined)?.run?.status ?? status);
        return open && !isRunTerminal(st) ? 1500 : false;
      },
    },
  );
  const currentStepId = detailQ.data?.run?.currentStepId ?? null;
  const steps = (detailQ.data?.steps ?? []) as RunStepView[];
  // U6 — bước đang chờ + prompt tác giả soạn + roles người duyệt (từ result của gate).
  const currentStep = currentStepId != null ? steps.find((s) => s.stepId === currentStepId) : undefined;
  const gatePrompt = typeof currentStep?.result?.prompt === "string" ? (currentStep.result.prompt as string) : "";
  const gateRoles = Array.isArray(currentStep?.result?.approverRoles)
    ? (currentStep!.result!.approverRoles as unknown[]).map(String).filter(Boolean)
    : [];

  const closeReject = () => { setRejecting(false); setRejectNote(""); };

  return (
    <div className="rounded border text-sm">
      <div className="flex items-center justify-between px-2 py-1.5">
        <button className="flex min-w-0 items-center gap-2" onClick={() => setOpen((o) => !o)}>
          <Badge className={`${RUN_STATUS_COLOR[status] ?? "bg-slate-400"} text-white`}>{status}</Badge>
          <span className="truncate font-mono text-[11px] text-muted-foreground">run #{runId} · {String(run.workflowRef ?? run.workflowId ?? "")}</span>
        </button>
        {awaiting && canControl && (
          <div className="flex gap-1">
            <Button size="sm" className="h-7 bg-emerald-600 hover:bg-emerald-700" onClick={() => onResume(true)}>
              {t("studio.approve", "Approve")}
            </Button>
            <Button size="sm" variant="outline" className="h-7" onClick={() => setRejecting((r) => !r)}>
              {t("studio.reject", "Reject")}
            </Button>
            <Button size="sm" variant="destructive" className="h-7" onClick={onAbort}>
              {t("studio.abort", "Abort")}
            </Button>
          </div>
        )}
      </div>

      {/* U6 (doc 26 §2.3) — NGỮ CẢNH duyệt: người duyệt thấy đang duyệt BƯỚC GÌ. */}
      {awaiting && canControl && (
        <div className="space-y-2 border-t bg-violet-500/5 px-2 py-2">
          {detailQ.isLoading ? (
            <p className="text-xs text-muted-foreground">{t("common.loading", "Loading…")}</p>
          ) : detailQ.isError ? (
            <p className="text-xs text-destructive">{t("common.loadError", "Failed to load")}</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                <span className="text-muted-foreground">{t("studio.awaitingStep", "Bước đang chờ")}:</span>
                <span className="font-mono text-[11px] font-medium">{currentStepId ?? "—"}</span>
                {gateRoles.length > 0 && (
                  <span className="flex items-center gap-1 text-muted-foreground">
                    · {t("studio.approverRolesLabel", "Vai trò duyệt")}:
                    {gateRoles.map((r) => (
                      <Badge key={r} variant="outline" className="text-[10px]">{r}</Badge>
                    ))}
                  </span>
                )}
              </div>
              <div className="rounded border bg-background/60 px-2 py-1.5 text-xs">
                {gatePrompt
                  ? <span className="whitespace-pre-wrap">{gatePrompt}</span>
                  : <span className="italic text-muted-foreground">{t("studio.noGatePrompt", "Tác giả không soạn nội dung nhắc cho bước này.")}</span>}
              </div>
            </>
          )}
          {/* U6 — lý do từ chối (tùy chọn) truyền vào resume. */}
          {rejecting && (
            <div className="space-y-1.5 rounded border border-red-500/40 bg-red-500/5 p-2">
              <Label className="text-[11px]">{t("studio.rejectReason", "Lý do từ chối (tùy chọn)")}</Label>
              <Input
                value={rejectNote}
                onChange={(e) => setRejectNote(e.target.value)}
                placeholder={t("studio.rejectReasonPlaceholder", "Vì sao không duyệt bước này?")}
                className="h-7 text-xs"
              />
              <div className="flex justify-end gap-1">
                <Button size="sm" variant="ghost" className="h-7" onClick={closeReject}>
                  {t("common.cancel", "Cancel")}
                </Button>
                <Button
                  size="sm" variant="destructive" className="h-7"
                  onClick={() => { onResume(false, rejectNote.trim() || undefined); closeReject(); }}
                >
                  {t("studio.confirmReject", "Xác nhận từ chối")}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {open && (
        <div className="border-t bg-muted/20 px-2 py-1.5">
          {detailQ.isLoading && <p className="text-xs text-muted-foreground">{t("common.loading", "Loading…")}</p>}
          {detailQ.isError && <p className="text-xs text-destructive">{t("common.loadError", "Failed to load")}</p>}
          {steps.map((s) => {
            const isCurrent = currentStepId != null && s.stepId === currentStepId;
            return (
              <div key={s.stepId} className={`flex items-center justify-between py-0.5 text-xs ${isCurrent ? "rounded bg-primary/10 px-1" : ""}`}>
                <span className="font-mono text-[11px]">
                  {isCurrent && <span className="mr-1 text-primary">▶</span>}
                  {s.stepId} <span className="text-muted-foreground">({s.stepType})</span>
                </span>
                <Badge variant="outline" className="text-[10px]">{s.status}</Badge>
              </div>
            );
          })}
          {detailQ.data && steps.length === 0 && (
            <p className="text-xs text-muted-foreground">{t("studio.noSteps", "No steps recorded yet.")}</p>
          )}
        </div>
      )}
    </div>
  );
}
