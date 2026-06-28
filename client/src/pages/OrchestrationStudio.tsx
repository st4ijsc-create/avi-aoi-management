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
import DashboardLayout from "@/components/DashboardLayout";
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
import { trpc } from "@/lib/trpc";
import { usePermissions } from "@/_core/hooks/usePermissions";
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
  Wand2,
} from "lucide-react";
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
  addChild,
  STEP_META,
  emptyDef,
} from "@/components/orchestration/workflowTypes";

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
    childLists.push({ slot: "then", label: t("studio.branchThen", "Nếu đúng (then)"), items: step.then ?? [] });
    childLists.push({ slot: "else", label: t("studio.branchElse", "Nếu sai (else)"), items: step.else ?? [] });
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
            aria-label={t("studio.moveUp", "Lên")}
          >
            <ChevronUp className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            disabled={index === siblingCount - 1}
            onClick={(e) => { e.stopPropagation(); onMove(step.id, 1); }}
            aria-label={t("studio.moveDown", "Xuống")}
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6 text-destructive"
            onClick={(e) => { e.stopPropagation(); onDelete(step.id); }}
            aria-label={t("common.delete", "Xóa")}
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
      return t("studio.conditionShort", "điều kiện telemetry");
    case "branch":
      return t("studio.branchShort", "rẽ nhánh theo điều kiện");
    case "delay":
      return `${step.ms ?? 0} ms`;
    case "hitl_gate":
      return step.prompt || t("studio.gateShort", "chờ duyệt thủ công");
    case "sequence":
      return `${(step.steps ?? []).length} ${t("studio.children", "bước con")}`;
    case "parallel":
      return `${(step.steps ?? []).length} ${t("studio.branches", "nhánh song song")}`;
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
        {t("studio.addStep", "Thêm bước")}
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
        <Label className="text-xs">{t("studio.stepId", "Mã bước (id)")}</Label>
        <Input value={step.id} onChange={(e) => onPatch({ id: e.target.value })} className="font-mono text-sm" />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">{t("studio.stepLabel", "Nhãn (tuỳ chọn)")}</Label>
        <Input value={step.label ?? ""} onChange={(e) => onPatch({ label: e.target.value })} />
      </div>

      <Separator />

      {step.type === "command" && (
        <>
          <div className="space-y-1.5">
            <Label className="text-xs">{t("studio.machine", "Máy")}</Label>
            <Select
              value={step.machineId ? String(step.machineId) : ""}
              onValueChange={(v) => onPatch({ machineId: Number(v), command: "", args: {} })}
            >
              <SelectTrigger><SelectValue placeholder={t("studio.pickMachine", "Chọn máy…")} /></SelectTrigger>
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
            <Label className="text-xs">{t("studio.command", "Lệnh")}</Label>
            <Select
              value={(step.command as string) || ""}
              onValueChange={(v) => onPatch({ command: v, args: {} })}
              disabled={!selectedMachine}
            >
              <SelectTrigger><SelectValue placeholder={t("studio.pickCommand", "Chọn lệnh…")} /></SelectTrigger>
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
              <div className="text-[11px] font-semibold uppercase text-muted-foreground">{t("studio.args", "Tham số")}</div>
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
            <Label className="text-xs">{t("studio.machine", "Máy")}</Label>
            <Select value={step.machineId ? String(step.machineId) : ""} onValueChange={(v) => onPatch({ machineId: Number(v) })}>
              <SelectTrigger><SelectValue placeholder={t("studio.pickMachine", "Chọn máy…")} /></SelectTrigger>
              <SelectContent>
                {machines.map((m) => (
                  <SelectItem key={m.machineId} value={String(m.machineId)}>#{m.machineId} · {m.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">{t("studio.targetStates", "Trạng thái đích (PackML)")}</Label>
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
        </>
      )}

      {step.type === "branch" && (
        <ConditionEditor condition={step.condition} machines={machines} onChange={(c) => onPatch({ condition: c })} t={t} />
      )}

      {step.type === "delay" && (
        <NumberField label={t("studio.delayMs", "Thời gian chờ (ms)")} value={step.ms ?? 1000} onChange={(n) => onPatch({ ms: n })} />
      )}

      {step.type === "hitl_gate" && (
        <div className="space-y-1.5">
          <Label className="text-xs">{t("studio.gatePrompt", "Câu hỏi cho người duyệt")}</Label>
          <Textarea value={step.prompt ?? ""} onChange={(e) => onPatch({ prompt: e.target.value })} rows={3} />
        </div>
      )}

      {(step.type === "sequence" || step.type === "parallel") && (
        <p className="text-xs text-muted-foreground">{t("studio.containerHint", "Thêm/sắp xếp các bước con ngay trên cây quy trình bên trái.")}</p>
      )}
    </div>
  );
}

function ArgField({ param, value, onChange, t }: { param: ParamDesc; value: unknown; onChange: (v: unknown) => void; t: TFunction }) {
  const label = `${param.label ?? param.name}${param.unit ? ` (${param.unit})` : ""}${param.required ? " *" : ""}`;
  if (param.options && param.options.length) {
    return (
      <div className="space-y-1">
        <Label className="text-[11px]">{label}</Label>
        <Select value={value != null ? String(value) : ""} onValueChange={(v) => onChange(v)}>
          <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="…" /></SelectTrigger>
          <SelectContent>
            {param.options.map((o) => <SelectItem key={String(o)} value={String(o)}>{String(o)}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
    );
  }
  const isNum = param.dataType === "int" || param.dataType === "float" || param.dataType === "number";
  const isBool = param.dataType === "bool" || param.dataType === "boolean";
  if (isBool) {
    return (
      <div className="flex items-center justify-between">
        <Label className="text-[11px]">{label}</Label>
        <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <Label className="text-[11px]">{label}</Label>
      <Input
        className="h-8 text-sm"
        type={isNum ? "number" : "text"}
        value={value != null ? String(value) : ""}
        min={param.min}
        max={param.max}
        onChange={(e) => onChange(isNum ? (e.target.value === "" ? undefined : Number(e.target.value)) : e.target.value)}
      />
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

// A simple LEAF condition builder (the safe-evaluator leaf shape).
function ConditionEditor({
  condition,
  machines,
  onChange,
  t,
}: {
  condition?: Record<string, unknown>;
  machines: EquipmentRow[];
  onChange: (c: Record<string, unknown>) => void;
  t: TFunction;
}) {
  const c = (condition ?? { source: "telemetry", key: "", op: "gt", value: 0 }) as {
    source?: string; machineId?: number; key?: string; op?: string; value?: unknown;
  };
  const set = (patch: Record<string, unknown>) => onChange({ ...c, ...patch });
  return (
    <div className="space-y-2 rounded-md border bg-muted/30 p-2">
      <div className="text-[11px] font-semibold uppercase text-muted-foreground">{t("studio.condition", "Điều kiện")}</div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-[11px]">{t("studio.condSource", "Nguồn")}</Label>
          <Select value={c.source ?? "telemetry"} onValueChange={(v) => set({ source: v })}>
            <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {["telemetry", "state", "param", "const"].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-[11px]">{t("studio.condOp", "Toán tử")}</Label>
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
          <Label className="text-[11px]">{t("studio.machine", "Máy")}</Label>
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
          <Label className="text-[11px]">{c.source === "const" ? t("studio.condConst", "Giá trị (const)") : t("studio.condKey", "Khoá (key)")}</Label>
          <Input className="h-8 text-sm" value={(c.key as string) ?? ""} onChange={(e) => set({ key: e.target.value })} />
        </div>
      )}
      {c.op !== "exists" && (
        <div className="space-y-1">
          <Label className="text-[11px]">{t("studio.condValue", "Giá trị so sánh")}</Label>
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
            <XCircle className="h-4 w-4" /> {t("studio.validationErrors", "Lỗi xác thực")}
          </div>
          <ul className="ml-5 list-disc text-xs text-red-600/90">
            {sim.errors.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <Badge variant={sim.ok ? "default" : "destructive"} className={sim.ok ? "bg-emerald-500" : ""}>
          {sim.ok ? <CheckCircle2 className="mr-1 h-3 w-3" /> : <AlertTriangle className="mr-1 h-3 w-3" />}
          {sim.ok ? t("studio.simOk", "Khả thi") : t("studio.simNotOk", "Có vấn đề")}
        </Badge>
        <span className="text-muted-foreground">
          <Timer className="mr-1 inline h-3.5 w-3.5" />
          {t("studio.totalDuration", "Tổng thời gian dự kiến")}: <b>{(sim.totalDurationMs / 1000).toFixed(1)}s</b>
        </span>
        <span className="text-muted-foreground">{sim.timeline.length} {t("studio.steps", "bước")}</span>
      </div>

      {/* Timeline / Gantt */}
      <div>
        <div className="mb-1 text-[11px] font-semibold uppercase text-muted-foreground">{t("studio.timeline", "Dòng thời gian (Gantt)")}</div>
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
          <div className="mb-1 text-[11px] font-semibold uppercase text-muted-foreground">{t("studio.stateTrace", "Diễn biến trạng thái máy")}</div>
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
            <AlertTriangle className="h-3.5 w-3.5" /> {t("studio.warnings", "Cảnh báo")} ({sim.warnings.length})
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

export default function OrchestrationStudio() {
  const { t, i18n } = useTranslation();
  const { hasPermission } = usePermissions();
  const canControl = hasPermission("machine_control", "canCreate");

  const [def, setDef] = useState<StudioDef>(() => emptyDef());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sim, setSim] = useState<SimResult | null>(null);

  // ── E5: AI advisor state ──
  const [aiGoal, setAiGoal] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiRationale, setAiRationale] = useState<string | null>(null);
  const [optimizePreview, setOptimizePreview] = useState<{ def: StudioDef; diff: string[]; rationale: string } | null>(null);

  const statusQ = trpc.orchestration.status.useQuery();
  const foeEnabled = statusQ.data?.enabled ?? false;
  const aiStatusQ = trpc.aiOrchestration.status.useQuery();
  const aiEnabled = aiStatusQ.data?.enabled ?? false;

  const equipmentQ = trpc.equipment.listEquipment.useQuery({ limit: 500 });
  const machines = (equipmentQ.data ?? []) as unknown as EquipmentRow[];

  const workflowsQ = trpc.orchestration.listWorkflows.useQuery({ limit: 100 });
  const runsQ = trpc.orchestration.listRuns.useQuery({ limit: 25 });

  const utils = trpc.useUtils();
  const [simulating, setSimulating] = useState(false);

  const deployM = trpc.orchestration.deployWorkflow.useMutation({
    onSuccess: (r) => {
      if (r?.ok) { toast.success(t("studio.deployed", "Đã lưu/triển khai quy trình")); void workflowsQ.refetch(); }
      else toast.error(r?.message ?? t("studio.deployFail", "Triển khai thất bại"));
    },
    onError: (e) => toast.error(e.message),
  });
  const startRunM = trpc.orchestration.startRun.useMutation({
    onSuccess: (r) => {
      toast.success(t("studio.runStarted", "Đã bắt đầu chạy (run #{{id}})", { id: r?.runId ?? "?" }));
      void runsQ.refetch();
    },
    onError: (e) => toast.error(e.message),
  });
  const resumeM = trpc.orchestration.resumeRun.useMutation({
    onSuccess: () => { void runsQ.refetch(); void utils.orchestration.getRun.invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const abortM = trpc.orchestration.abortRun.useMutation({
    onSuccess: () => { void runsQ.refetch(); },
    onError: (e) => toast.error(e.message),
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

  const loadWorkflow = (row: { definitionJson?: unknown }) => {
    const json = row.definitionJson as StudioDef | undefined;
    if (json && Array.isArray(json.steps)) {
      setDef(cloneDef(json));
      setSelectedId(null);
      setSim(null);
      toast.success(t("studio.loaded", "Đã nạp quy trình vào trình soạn"));
    }
  };

  const runSimulate = async () => {
    setSimulating(true);
    try {
      const res = await utils.orchestration.simulate.fetch({ workflow: serializeDef(def) as Record<string, unknown> });
      setSim(res as unknown as SimResult);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSimulating(false);
    }
  };
  const runDeploy = () => deployM.mutate({ definition: serializeDef(def) as Record<string, unknown> });
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
        toast.error(res.message ?? t("studio.aiUnavailable", "Trợ lý AI chưa khả dụng"));
        return;
      }
      if (res.workflow) {
        // Load the AI proposal into the editor — the human STILL reviews + deploys manually.
        setDef(cloneDef(res.workflow as unknown as StudioDef));
        setSelectedId(null);
        setAiRationale(res.rationale || null);
        setSim((res.simulation as unknown as SimResult) ?? null);
        if (res.valid) toast.success(t("studio.aiProposed", "AI đã đề xuất quy trình — hãy xem lại trước khi triển khai"));
        else toast.warning(res.message ?? t("studio.aiInvalid", "AI chưa tạo được quy trình hợp lệ"));
      } else {
        toast.error(res.message ?? t("studio.aiInvalid", "AI chưa tạo được quy trình hợp lệ"));
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
        toast.error(res.message ?? t("studio.aiUnavailable", "Trợ lý AI chưa khả dụng"));
        return;
      }
      if (res.workflow) {
        setSim((res.simulation as unknown as SimResult) ?? null);
        setOptimizePreview({
          def: cloneDef(res.workflow as unknown as StudioDef),
          diff: res.diff ?? [],
          rationale: res.rationale || "",
        });
        if (!res.valid) toast.warning(res.message ?? t("studio.aiInvalid", "AI chưa tạo được quy trình hợp lệ"));
      } else {
        toast.error(res.message ?? t("studio.aiInvalid", "AI chưa tạo được quy trình hợp lệ"));
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
    toast.success(t("studio.aiOptimizeApplied", "Đã áp dụng bản tối ưu của AI"));
  };

  return (
    <DashboardLayout>
      <div className="flex flex-col gap-4 p-4 md:p-6">
        {/* Header */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <Workflow className="h-6 w-6 text-primary" />
          </div>
          <div className="flex-1">
            <h1 className="text-2xl font-bold tracking-tight">{t("studio.title", "Studio Quy trình")}</h1>
            <p className="text-sm text-muted-foreground">{t("studio.subtitle", "Soạn quy trình đa máy bằng hình ảnh, mô phỏng trên bản sao số, rồi triển khai & chạy")}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => void runSimulate()} disabled={simulating || def.steps.length === 0}>
              <FlaskConical className="mr-1.5 h-4 w-4" /> {t("studio.simulate", "🔬 Mô phỏng")}
            </Button>
            <Button variant="outline" onClick={runDeploy} disabled={!canControl || !foeEnabled || deployM.isPending}>
              <Save className="mr-1.5 h-4 w-4" /> {t("studio.deploy", "💾 Lưu (deploy)")}
            </Button>
            <Button onClick={runStart} disabled={!canControl || !foeEnabled || startRunM.isPending || !def.ref}>
              <Play className="mr-1.5 h-4 w-4" /> {t("studio.run", "▶️ Chạy")}
            </Button>
          </div>
        </div>

        {/* FOE disabled banner */}
        {!statusQ.isLoading && !foeEnabled && (
          <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <span>{t("studio.foeOff", "FOE chưa bật (FOE_ENABLED) — vẫn soạn & mô phỏng được, nhưng deploy/chạy bị tắt.")}</span>
          </div>
        )}

        {/* E5 — AI advisor (propose / optimize). HITL: AI only proposes; the human deploys. */}
        <Card className="border-violet-500/30 bg-violet-500/5">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4 text-violet-600" />
              {t("studio.aiTitle", "Trợ lý AI điều phối")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-col gap-2 md:flex-row md:items-end">
              <div className="flex-1 space-y-1.5">
                <Label className="text-xs">{t("studio.aiGoal", "Mục tiêu / vấn đề (cho AI)")}</Label>
                <Input
                  value={aiGoal}
                  onChange={(e) => setAiGoal(e.target.value)}
                  placeholder={t("studio.aiGoalPlaceholder", "VD: AOI báo NG → robot gắp loại → băng tải chuyển; thêm cổng duyệt trước khi dừng line")}
                  disabled={!aiEnabled || aiBusy}
                />
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="border-violet-500/40"
                  onClick={() => void aiSuggest()}
                  disabled={!aiEnabled || aiBusy}
                  title={!aiEnabled ? t("studio.aiOff", "Bật AI_ORCHESTRATION_ADVISOR_ENABLED để dùng") : undefined}
                >
                  <Sparkles className="mr-1.5 h-4 w-4" /> {t("studio.aiSuggest", "🤖 AI gợi ý quy trình")}
                </Button>
                <Button
                  variant="outline"
                  className="border-violet-500/40"
                  onClick={() => void aiOptimize()}
                  disabled={!aiEnabled || aiBusy || def.steps.length === 0}
                  title={!aiEnabled ? t("studio.aiOff", "Bật AI_ORCHESTRATION_ADVISOR_ENABLED để dùng") : undefined}
                >
                  <Wand2 className="mr-1.5 h-4 w-4" /> {t("studio.aiOptimize", "🤖 AI tối ưu")}
                </Button>
              </div>
            </div>

            {!aiStatusQ.isLoading && !aiEnabled && (
              <p className="text-xs text-muted-foreground">
                {t("studio.aiDisabledHint", "Trợ lý AI đang TẮT (AI_ORCHESTRATION_ADVISOR_ENABLED). AI chỉ ĐỀ XUẤT — con người luôn xem lại & triển khai thủ công.")}
              </p>
            )}

            {aiRationale && (
              <div className="rounded-md border border-violet-500/30 bg-card p-2 text-xs">
                <span className="font-semibold text-violet-700">{t("studio.aiRationale", "Lý giải của AI")}: </span>
                {aiRationale}
              </div>
            )}

            {/* Optimize preview — accept (replace editor) or discard. */}
            {optimizePreview && (
              <div className="space-y-2 rounded-md border border-violet-500/40 bg-card p-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-violet-700">
                  <Wand2 className="h-4 w-4" /> {t("studio.aiOptimizePreview", "Bản tối ưu do AI đề xuất")}
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
                    {t("studio.aiAccept", "Áp dụng vào trình soạn")}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setOptimizePreview(null)}>
                    {t("studio.aiDiscard", "Bỏ qua")}
                  </Button>
                </div>
              </div>
            )}
            <p className="text-[11px] text-muted-foreground">
              {t("studio.aiHitlNote", "HITL: AI chỉ đề xuất quy trình + mô phỏng trên bản sao số. Việc lưu (deploy) & chạy luôn do con người thực hiện thủ công.")}
            </p>
          </CardContent>
        </Card>

        {/* TOP — workflow meta + params */}
        <Card>
          <CardContent className="grid grid-cols-1 gap-3 py-4 md:grid-cols-4">
            <div className="space-y-1.5">
              <Label className="text-xs">{t("studio.ref", "Mã quy trình (ref) *")}</Label>
              <Input value={def.ref} onChange={(e) => setDef((d) => ({ ...d, ref: e.target.value }))} placeholder="line-a-startup" className="font-mono" />
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <Label className="text-xs">{t("studio.name", "Tên *")}</Label>
              <Input value={def.name} onChange={(e) => setDef((d) => ({ ...d, name: e.target.value }))} placeholder={t("studio.namePlaceholder", "Khởi động dây chuyền A")} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t("studio.version", "Phiên bản")}</Label>
              <Input type="number" value={def.version ?? 1} onChange={(e) => setDef((d) => ({ ...d, version: Number(e.target.value) }))} />
            </div>
          </CardContent>
        </Card>

        {/* MAIN GRID — tree canvas + inspector */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {/* LEFT — step tree */}
          <Card className="lg:col-span-2">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{t("studio.canvas", "Cây quy trình")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {def.steps.length === 0 && (
                <p className="py-6 text-center text-sm text-muted-foreground">{t("studio.emptyCanvas", "Chưa có bước nào. Thêm bước đầu tiên bên dưới.")}</p>
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
            </CardContent>
          </Card>

          {/* RIGHT — inspector */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{t("studio.inspector", "Cấu hình bước")}</CardTitle>
            </CardHeader>
            <CardContent>
              {selectedStep ? (
                <Inspector step={selectedStep} machines={machines} onPatch={handlePatch} t={t} />
              ) : (
                <p className="py-6 text-center text-sm text-muted-foreground">{t("studio.selectStep", "Chọn một bước trên cây để cấu hình.")}</p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* TWIN VIEW */}
        {sim && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Gauge className="h-4 w-4 text-primary" /> {t("studio.twin", "Bản sao số — kết quả mô phỏng")}
              </CardTitle>
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
              <CardTitle className="text-base">{t("studio.workflows", "Quy trình đã lưu")}</CardTitle>
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => void workflowsQ.refetch()}>
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {(workflowsQ.data ?? []).length === 0 && (
                <p className="py-4 text-center text-sm text-muted-foreground">{t("studio.noWorkflows", "Chưa có quy trình nào.")}</p>
              )}
              {(workflowsQ.data ?? []).map((w: Record<string, unknown>) => (
                <div key={String(w.id)} className="flex items-center justify-between rounded border px-2 py-1.5 text-sm">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{String(w.name ?? w.ref)}</div>
                    <div className="truncate font-mono text-[10px] text-muted-foreground">{String(w.ref)} · v{String(w.version ?? 1)}</div>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => loadWorkflow(w as { definitionJson?: unknown })}>
                    {t("studio.load", "Nạp")}
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Recent runs */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-base">{t("studio.runs", "Lần chạy gần đây")}</CardTitle>
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => void runsQ.refetch()}>
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {(runsQ.data ?? []).length === 0 && (
                <p className="py-4 text-center text-sm text-muted-foreground">{t("studio.noRuns", "Chưa có lần chạy nào.")}</p>
              )}
              {(runsQ.data ?? []).map((r: Record<string, unknown>) => (
                <RunRow
                  key={String(r.id)}
                  run={r}
                  canControl={canControl}
                  onResume={(approved) => resumeM.mutate({ runId: Number(r.id), approved })}
                  onAbort={() => abortM.mutate({ runId: Number(r.id) })}
                  t={t}
                />
              ))}
            </CardContent>
          </Card>
        </div>

        {/* future enhancement note */}
        <p className="text-center text-[11px] text-muted-foreground">
          {t("studio.futureNote", "Phiên bản v1 dùng cây bước lồng nhau. Nâng cấp tương lai: chỉnh sửa dạng đồ thị (react-flow).")}
        </p>
      </div>
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

function RunRow({
  run,
  canControl,
  onResume,
  onAbort,
  t,
}: {
  run: Record<string, unknown>;
  canControl: boolean;
  onResume: (approved: boolean) => void;
  onAbort: () => void;
  t: TFunction;
}) {
  const [open, setOpen] = useState(false);
  const status = String(run.status ?? "");
  const runId = Number(run.id);
  const detailQ = trpc.orchestration.getRun.useQuery({ runId }, { enabled: open });
  const awaiting = status === "awaiting_confirm" || status === "held";

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
              {t("studio.approve", "Duyệt")}
            </Button>
            <Button size="sm" variant="outline" className="h-7" onClick={() => onResume(false)}>
              {t("studio.reject", "Từ chối")}
            </Button>
            <Button size="sm" variant="destructive" className="h-7" onClick={onAbort}>
              {t("studio.abort", "Dừng")}
            </Button>
          </div>
        )}
      </div>
      {open && (
        <div className="border-t bg-muted/20 px-2 py-1.5">
          {detailQ.isLoading && <p className="text-xs text-muted-foreground">{t("common.loading", "Đang tải...")}</p>}
          {(detailQ.data?.steps ?? []).map((s: { stepId: string; stepType: string; status: string }) => (
            <div key={s.stepId} className="flex items-center justify-between py-0.5 text-xs">
              <span className="font-mono text-[11px]">{s.stepId} <span className="text-muted-foreground">({s.stepType})</span></span>
              <Badge variant="outline" className="text-[10px]">{s.status}</Badge>
            </div>
          ))}
          {detailQ.data && (detailQ.data.steps ?? []).length === 0 && (
            <p className="text-xs text-muted-foreground">{t("studio.noSteps", "Chưa có bước nào được ghi nhận.")}</p>
          )}
        </div>
      )}
    </div>
  );
}
