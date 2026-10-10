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
 *
 * Doc 81 Đợt 2 Task 11 — bố cục P2 "Canvas designer" (doc 81 §1.2/§1.3, `WorkbenchShell`, biến thể full-bleed):
 *  - Header MỘT hàng (`PageHeaderCompact`): h1 (+ "Chỉ xem") · chip FOE tắt / sim-gate / "Khi nào dùng" (câu cũ
 *    trong popover, cùng điều kiện hiện) · Trợ lý AI điều phối · Mô phỏng · Lưu (deploy) · Chạy (cùng cổng cũ).
 *  - Thanh công cụ (NGOÀI MAIN): tên + mã quy trình SỬA TẠI CHỖ, số phiên bản, chuyển Cây | Sơ đồ.
 *  - TRÁI: bảng bước (bấm = thêm cấp cao nhất, kéo = lồng vào node container trên sơ đồ) + thư viện quy trình đã
 *    lưu (Nạp · Phiên bản · Nhân bản · Xoá). MAIN (`data-layout-main`): canvas cây/sơ đồ. PHẢI: Cấu hình bước.
 *  - DƯỚI (gập ở lần đầu — R-2-l): Lần chạy / Chờ duyệt / Vấn đề (`?tab=`); đếm luôn thấy ở thanh trạng thái.
 *  - Sheet (FlyoutHost): Trợ lý AI 420 px (`?flyout=orch-ai`, không chồng sheet chat — R-2-j), Lịch sử phiên bản
 *    (`VersionHistoryPanel` + `RollbackConfirm`: lý do ≥3 + OTP tươi mỗi lượt — R-2-g), Nhân bản. Xoá giữ AlertDialog.
 *  - R-2-n: Chạy / Deploy (OTP) / Duyệt / Từ chối / Tiếp tục / Dừng / Huỷ / Khôi phục giữ đúng đích, xác nhận, cổng
 *    và `expectedStepId` như trước; nhãn DRY-RUN / "chưa xác nhận" và toast i18n khi run bị từ chối vì "draft" giữ nguyên.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Link, useSearch } from "wouter";
import { useEngineering } from "@/contexts/EngineeringContext";
import { withParams } from "@/lib/engineeringDeepLink";
import DashboardLayout from "@/components/DashboardLayout";
import { useShellPageVariant } from "@/lib/shellPage";
import {
  PageHeaderCompact, NoticeStack, FlyoutHost, useFlyout, parseFlyoutStack, FLYOUT_PARAM, WorkbenchShell,
  VersionHistoryPanel, RollbackConfirm,
  type NoticeItem, type FlyoutDefinition,
} from "@/components/patterns";
import { useUrlParam } from "@/components/patterns/useUrlParam";
import { useCloseOwnLayer } from "@/components/patterns/useCloseOwnLayer";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { trpc } from "@/lib/trpc";
import { mapTrpcError, toastTrpcError } from "@/lib/trpcErrors";
import { translateAppError } from "@/lib/errorCodes"; // doc 81 Đợt 4 fix round 3 (R-4-n) — step detail.appError
import { cn } from "@/lib/utils";
import { usePermissions } from "@/_core/hooks/usePermissions";
import { useAuth } from "@/_core/hooks/useAuth";
import { ViewOnlyBadge } from "@/components/PermissionGate";
import { setAiChatOpen, useAiEntry } from "@/lib/aiEntryStore";
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
  Copy,
  History,
  RotateCcw,
  ListTree,
  Network,
  Pencil,
} from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import { WorkflowGraphCanvas, WF_DND_MIME } from "@/components/orchestration/WorkflowGraphCanvas";
import { useStepUpOtp } from "@/components/security/StepUpOtpDialog";
// doc 80 Đợt 1 Task 4 (X-01 · ORC-13) — nhãn SEED/DEMO/SIM + DRY-RUN trên run.
import { ProvenanceBadge, ProvenanceSummary, DispatchModeBadge } from "@/components/common/ProvenanceBadge";
import { classifyStepDispatch, type RunDispatchSummary } from "@shared/provenance";
// doc 81 Đợt 3 Task 4 — "Giao cho" trên run đang chờ duyệt + tên người được giao trên hàng run. Được giao ≠ được duyệt.
import { AssigneeCell, AssignmentControl, useAssignments, useCanAssign, type AssignmentRow } from "@/components/engineering/AssignmentControl";

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
  /** equipment.listEquipment — routes robot kinds ("robot" / "vda5050") through robotId (R-4-n picker). */
  adapterKind?: string;
  capability?: {
    adapterKind?: string;
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

/** doc 81 Đợt 4 fix round 3 (R-4-n) — a robot the step can target (fleet.robotPositions: in-scope, enabled robots). */
type RobotOption = { id: number; code?: string | null; name?: string | null };

function isRobotKindRow(m: EquipmentRow | undefined): boolean {
  const k = m?.adapterKind ?? m?.capability?.adapterKind;
  return k === "robot" || k === "vda5050";
}

function Inspector({
  step,
  machines,
  robots = [],
  onPatch,
  t,
}: {
  step: StudioStep;
  machines: EquipmentRow[];
  robots?: RobotOption[];
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
              // fix round 3 (R-4-n): changing the command keeps the chosen robot
              onValueChange={(v) => onPatch({ command: v, args: typeof (step.args ?? {}).robotId === "number" ? { robotId: (step.args ?? {}).robotId } : {} })}
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
          {/* doc 81 Đợt 4 fix round 3 (R-4-n) — a robot step must name its robot (deploy refuses robotIdMissing). */}
          {isRobotKindRow(selectedMachine) && (
            <div className="space-y-1.5" data-testid="robot-picker">
              <Label className="text-xs">{t("studio.robot", "Robot")}</Label>
              <Select
                value={typeof (step.args ?? {}).robotId === "number" ? String((step.args ?? {}).robotId) : ""}
                onValueChange={(v) => onPatch({ args: { ...(step.args ?? {}), robotId: Number(v) } })}
              >
                <SelectTrigger aria-label={t("studio.robot", "Robot")}><SelectValue placeholder={t("studio.pickRobot", "Select robot…")} /></SelectTrigger>
                <SelectContent>
                  {robots.map((r) => (
                    <SelectItem key={r.id} value={String(r.id)}>#{r.id} · {r.name ?? r.code ?? ""}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {robots.length === 0 && <p className="text-[11px] text-muted-foreground">{t("studio.noRobots", "No robot in your scope is enabled.")}</p>}
            </div>
          )}
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
            <Label className="text-xs">{t("studio.approverRoles", "Approver roles (comma-separated)")}</Label>
            <Input
              value={(step.approverRoles ?? []).join(", ")}
              placeholder="supervisor, admin"
              onChange={(e) => {
                const roles = e.target.value.split(",").map((r) => r.trim()).filter(Boolean);
                onPatch({ approverRoles: roles.length ? roles : undefined });
              }}
            />
            {/* doc 80 ORC-03 — server ÉP approverRoles (admin luôn được); câu cũ "advisory" là SAI. */}
            <p className="text-[10px] text-muted-foreground">{t("studio.approverRolesHint", "Enforced by the server: only these roles (or admin) can approve this gate; empty = anyone with machine-control permission.")}</p>
          </div>
          <div className="flex items-center justify-between rounded-md border bg-muted/30 px-2 py-1.5">
            <div className="space-y-0.5">
              <Label className="text-xs">{t("studio.fourEyes", "Four-eyes required")}</Label>
              <p className="text-[10px] text-muted-foreground">{t("studio.fourEyesHint", "The user who started the run cannot approve this gate (admin included).")}</p>
            </div>
            <Checkbox checked={Boolean(step.fourEyes)} onCheckedChange={(v) => onPatch({ fourEyes: v ? true : undefined })} />
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

// ── Doc 81 Đợt 2 Task 11 — bố cục P2 "Canvas designer" ────────────────────────────────────────
/** Tab của panel dưới (`?tab=`). */
type BottomTab = "runs" | "approvals" | "problems";
const BOTTOM_TABS: readonly BottomTab[] = ["runs", "approvals", "problems"];
const isBottomTab = (v: string | null): v is BottomTab => v != null && (BOTTOM_TABS as readonly string[]).includes(v);
/** Khoá flyout (FlyoutHost, `?flyout=`). */
const AI_FLYOUT = "orch-ai";
const VERSIONS_FLYOUT = "orch-versions";
const DUPLICATE_FLYOUT = "orch-duplicate";

type WorkflowRow = Record<string, unknown>;

/**
 * Tiêu đề sửa TẠI CHỖ: nút hiện giá trị; bấm ⇒ ô nhập (tự focus); Enter hoặc rời ô ⇒ lưu; Esc ⇒ huỷ.
 * Lưu đúng chuỗi người gõ (không trim) như ô nhập cũ của card meta.
 */
function InlineEditText({
  value,
  label,
  emptyText,
  placeholder,
  onCommit,
  mono = false,
  className,
}: {
  value: string;
  label: string;
  emptyText: string;
  placeholder?: string;
  onCommit: (v: string) => void;
  mono?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  // Enter/Esc đã xử lý ⇒ blur khi ô nhập rời DOM không lưu lần nữa.
  const settledRef = useRef(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const refocusRef = useRef(false);
  useEffect(() => {
    if (!editing && refocusRef.current) {
      refocusRef.current = false;
      buttonRef.current?.focus();
    }
  }, [editing]);
  const finish = (save: boolean) => {
    settledRef.current = true;
    refocusRef.current = true;
    if (save) onCommit(draft);
    setEditing(false);
  };
  if (editing) {
    return (
      <Input
        autoFocus
        aria-label={label}
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            finish(true);
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            finish(false);
          }
        }}
        onBlur={() => {
          if (settledRef.current) return;
          onCommit(draft);
          setEditing(false);
        }}
        className={cn("h-7 w-56 text-sm", mono && "font-mono text-xs", className)}
      />
    );
  }
  return (
    <button
      ref={buttonRef}
      type="button"
      aria-label={label}
      title={t("studio.clickToEdit", "Bấm để sửa")}
      onClick={() => {
        settledRef.current = false;
        setDraft(value);
        setEditing(true);
      }}
      className={cn(
        "group inline-flex h-7 min-w-0 max-w-[22rem] items-center gap-1.5 rounded px-1.5 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        mono ? "font-mono text-xs text-muted-foreground" : "text-sm font-semibold",
        className,
      )}
    >
      {value ? <span className="truncate">{value}</span> : <span className="truncate font-normal italic text-muted-foreground">{emptyText}</span>}
      <Pencil className="h-3 w-3 shrink-0 opacity-50 group-hover:opacity-100" aria-hidden="true" />
    </button>
  );
}

/** Nút mở Trợ lý AI điều phối (sheet 420). Phải nằm trong FlyoutHost. */
function AiAdvisorButton({ label }: { label: string }) {
  const flyout = useFlyout();
  const open = flyout.isOpen(AI_FLYOUT);
  return (
    <Button
      variant="outline"
      className="border-violet-500/40"
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-label={label}
      onClick={() => flyout.open(AI_FLYOUT)}
    >
      <Sparkles className="h-4 w-4 text-violet-600 lg:mr-1.5" aria-hidden="true" />
      {/* < 1024 px: chỉ biểu tượng (tên vẫn ở aria-label) để header một hàng không tràn (Đợt 3b Task 2 fix 1: trước là < 640;
          768 px đo được 610 px nút ⇒ header phải xuống dòng). */}
      <span className="hidden lg:inline">{label}</span>
    </Button>
  );
}

/**
 * Ruling R-2-j — trợ lý điều phối (sheet 420) và sheet chat AI của top bar KHÔNG BAO GIỜ chồng nhau: mở trợ lý
 * ⇒ đóng chat; chat mở ra ⇒ đóng trợ lý. Chỉ phản ứng theo CHUYỂN TRẠNG THÁI (không đóng cái vừa được mở).
 */
function AiSurfaceGuard() {
  const flyout = useFlyout();
  const { chatOpen } = useAiEntry();
  const advisorOpen = flyout.isOpen(AI_FLYOUT);
  const prev = useRef({ chatOpen, advisorOpen });
  useEffect(() => {
    const p = prev.current;
    prev.current = { chatOpen, advisorOpen };
    if (advisorOpen && !p.advisorOpen && chatOpen) {
      setAiChatOpen(false);
      return;
    }
    if (chatOpen && !p.chatOpen && advisorOpen) flyout.close();
  }, [chatOpen, advisorOpen, flyout]);
  return null;
}

/** Bảng bước (palette) + thư viện quy trình đã lưu — panel TRÁI. Phải nằm trong FlyoutHost. */
function LibraryPanel({
  workflows,
  filteredWorkflows,
  wfSearch,
  onSearch,
  onRefresh,
  onLoad,
  onDelete,
  onAddStep,
  canControl,
  permReason,
  showGraphHint,
  t,
}: {
  workflows: WorkflowRow[];
  filteredWorkflows: WorkflowRow[];
  wfSearch: string;
  onSearch: (v: string) => void;
  onRefresh: () => void;
  onLoad: (w: WorkflowRow) => void;
  onDelete: (w: { id: number; ref: string }) => void;
  onAddStep: (k: StepKind) => void;
  canControl: boolean;
  permReason: string | undefined;
  showGraphHint: boolean;
  t: TFunction;
}) {
  const flyout = useFlyout();
  return (
    <div className="flex h-full min-h-0 flex-col">
      <section className="shrink-0 border-b p-2">
        <h2 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t("studio.addStep", "Add step")}</h2>
        <div role="group" aria-label={t("studio.addStep", "Add step")} className="grid grid-cols-2 gap-1">
          {STEP_KINDS.map((k) => {
            const Icon = ICONS[k];
            const meta = STEP_META[k];
            return (
              <button
                key={k}
                type="button"
                draggable
                onDragStart={(e) => {
                  // Cùng MIME với palette của sơ đồ ⇒ kéo thả lên node container để lồng bước.
                  e.dataTransfer.setData(WF_DND_MIME, k);
                  e.dataTransfer.effectAllowed = "copy";
                }}
                onClick={() => onAddStep(k)}
                title={t("studio.paletteHint", "Click to add at top level, or drag onto a container to nest")}
                className={`flex min-w-0 items-center gap-1.5 rounded border px-1.5 py-1 text-left text-xs transition-colors hover:bg-muted ${meta.border} ${meta.bg}`}
              >
                <Icon className={`h-3.5 w-3.5 shrink-0 ${meta.iconColor}`} aria-hidden="true" />
                <span className="truncate">{t(meta.labelKey, meta.labelDefault)}</span>
              </button>
            );
          })}
        </div>
        {showGraphHint && (
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            {t("studio.graphHintEdit", "Click a chip to add a step (or drag it onto a container to nest); drag a link between two siblings to reorder; use the trash icon or Delete to remove. Click a node to configure it in the inspector.")}
          </p>
        )}
      </section>
      <section className="flex min-h-0 flex-1 flex-col p-2">
        <div className="mb-1.5 flex items-center justify-between gap-1">
          <h2 className="truncate text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t("studio.workflows", "Saved workflows")}</h2>
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            aria-label={t("studio.refreshWorkflows", "Tải lại danh sách quy trình")}
            title={t("studio.refreshWorkflows", "Tải lại danh sách quy trình")}
            onClick={onRefresh}
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        </div>
        {/* U13 — ô tìm theo tên/mã (lọc phía client). */}
        {workflows.length > 0 && (
          <Input
            value={wfSearch}
            onChange={(e) => onSearch(e.target.value)}
            placeholder={t("studio.searchWorkflows", "Tìm theo tên hoặc mã…")}
            aria-label={t("studio.searchWorkflows", "Tìm theo tên hoặc mã…")}
            className="mb-1.5 h-7 text-xs"
          />
        )}
        <div className="min-h-0 flex-1 space-y-1 overflow-auto">
          {workflows.length === 0 && (
            <p className="py-4 text-center text-xs text-muted-foreground">{t("studio.noWorkflows", "No workflows yet.")}</p>
          )}
          {workflows.length > 0 && filteredWorkflows.length === 0 && (
            <p className="py-4 text-center text-xs text-muted-foreground">{t("studio.noWorkflowMatch", "Không có quy trình khớp bộ lọc")}</p>
          )}
          {filteredWorkflows.map((w) => {
            const id = Number(w.id);
            const ref = String(w.ref);
            const name = String(w.name ?? w.ref);
            return (
              <div key={String(w.id)} data-workflow-row={id} className="rounded border px-2 py-1 text-sm">
                <div className="truncate font-medium" title={name}>{name}</div>
                <div className="flex items-center gap-0.5">
                  <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-muted-foreground" title={ref}>
                    {ref} · v{String(w.version ?? 1)}
                  </span>
                  <Button size="sm" variant="outline" className="h-6 px-2 text-xs" onClick={() => onLoad(w)}>
                    {t("studio.load", "Load")}
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6"
                    aria-label={t("studio.versions", "Versions")}
                    title={t("studio.versions", "Versions")}
                    onClick={() => flyout.open(VERSIONS_FLYOUT, { id })}
                  >
                    <History className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6"
                    disabled={!canControl}
                    aria-label={t("studio.duplicate", "Duplicate")}
                    title={permReason ?? t("studio.duplicate", "Duplicate")}
                    onClick={() => flyout.open(DUPLICATE_FLYOUT, { id })}
                  >
                    <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6 text-destructive"
                    disabled={!canControl}
                    aria-label={t("common.delete", "Delete")}
                    title={permReason ?? t("common.delete", "Delete")}
                    onClick={() => onDelete({ id, ref })}
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

/** Sheet "Nhân bản quy trình" (thay Dialog cũ): cùng ô nhập, cùng kiểm tra (mã trống ⇒ khoá), cùng payload. */
function DuplicateWorkflowForm({
  wf,
  loaded,
  pending,
  onDuplicate,
}: {
  wf: { id: number; ref: string; name: string } | null;
  loaded: boolean;
  pending: boolean;
  onDuplicate: (input: { id: number; newRef: string }, done: () => void) => void;
}) {
  const { t } = useTranslation();
  const { layer, done } = useCloseOwnLayer();
  const initial = wf ? `${wf.ref}-copy` : "";
  const [newRef, setNewRef] = useState(initial);
  useEffect(() => {
    layer.setDirty(newRef !== initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newRef, initial]);
  if (!wf) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        {loaded
          ? t("studio.wfNotLoaded", "Không tìm thấy quy trình #{{id}} trong danh sách đã tải.", { id: layer.id ?? "" })
          : t("common.loading", "Loading…")}
      </p>
    );
  }
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!newRef.trim() || pending) return;
        onDuplicate({ id: wf.id, newRef: newRef.trim() }, done);
      }}
    >
      <p className="text-sm">
        {wf.name} <span className="font-mono text-xs text-muted-foreground">· {wf.ref}</span>
      </p>
      <div className="space-y-1.5">
        <Label htmlFor="orch-dup-ref" className="text-xs">{t("studio.duplicateNewRef", "New workflow ref *")}</Label>
        <Input id="orch-dup-ref" value={newRef} onChange={(e) => setNewRef(e.target.value)} className="font-mono" placeholder="line-a-startup-copy" />
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => layer.close()}>{t("common.cancel", "Cancel")}</Button>
        <Button type="submit" disabled={!newRef.trim() || pending}>{t("studio.duplicate", "Duplicate")}</Button>
      </div>
    </form>
  );
}

export default function OrchestrationStudio() {
  const { t, i18n } = useTranslation();
  // doc 81 Đợt 2 Task 11 — màn đã chuyển sang WorkbenchShell ⇒ "full-bleed": rail trái thu gọn, <main> không đệm.
  useShellPageVariant("full-bleed");
  const { user } = useAuth();
  const { hasPermission } = usePermissions();
  const canControl = hasPermission("machine_control", "canCreate");
  const canAssignRun = useCanAssign("orchestration_run");
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
  // doc 81 Đợt 4 fix round 3 (R-4-n) — robot picker source: in-scope, enabled robots (existing fleet query).
  const robotsQ = trpc.fleet.robotPositions.useQuery(undefined, { enabled: machines.some((m) => isRobotKindRow(m)) });
  const robotOptions = (robotsQ.data ?? []) as RobotOption[];

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

  // doc 81 Đợt 3 Task 4 — phân công còn sống của ĐÚNG các run đang liệt kê.
  const runIds = useMemo(() => ((runsQ.data ?? []) as Array<Record<string, unknown>>).map((r) => Number(r.id)), [runsQ.data]);
  const { byId: runAssignments } = useAssignments("orchestration_run", runIds, hasPermission("machine_control", "canView"));

  // U13 (doc 26 §2.2/§2.3) — tìm/lọc client cho workflows + runs.
  const [wfSearch, setWfSearch] = useState("");
  const allWorkflows = (workflowsQ.data ?? []) as WorkflowRow[];
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
  // doc 80 ORC-04 — run 'held' do server khởi động lại (rehydrate ghi contextJson.interrupted)
  // KHÔNG phải cổng chờ duyệt: tách nhóm "Bị gián đoạn" (Tiếp tục… có xác nhận / Huỷ), không nút Approve.
  const isInterruptedRun = (r: Record<string, unknown>) =>
    String(r.status ?? "") === "held" &&
    Boolean((r.contextJson as Record<string, unknown> | null | undefined)?.interrupted);
  // Trạng thái "chờ duyệt" = held / awaiting_confirm (HITL gate đang mở) — trừ run bị gián đoạn.
  const isAwaitingRun = (r: Record<string, unknown>) => {
    if (isInterruptedRun(r)) return false;
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
  // §2.3 — nhóm "Đang chờ duyệt" (nay là tab riêng của panel dưới); phần còn lại giữ thứ tự gốc.
  const awaitingRuns = useMemo(() => filteredRuns.filter(isAwaitingRun), [filteredRuns]);
  const interruptedRuns = useMemo(() => filteredRuns.filter(isInterruptedRun), [filteredRuns]);
  const otherRuns = useMemo(
    () => filteredRuns.filter((r) => !isAwaitingRun(r) && !isInterruptedRun(r)),
    [filteredRuns],
  );
  // Badge đếm luôn dựa trên TỔNG số run chờ duyệt (không phụ thuộc bộ lọc đang chọn).
  const awaitingCount = useMemo(() => allRuns.filter(isAwaitingRun).length, [allRuns]);

  const utils = trpc.useUtils();
  const [simulating, setSimulating] = useState(false);
  // doc 54 P3.2 — step-up 2FA (fresh OTP) for deployWorkflow when ACTUATION_STEPUP_2FA is on.
  const stepUp = useStepUpOtp();

  /**
   * doc 81 Đợt 4 (R-4-j, R-4-n) + final wave G2/G3/G4 — the translated sentence for a definition refused by the server's
   * definition checks (deploy, rollback = deploy, and run START since G4), naming the steps; null for any other result
   * (the caller keeps its own fallback). One place, so no refusal code reaches the operator as raw server English.
   */
  const definitionRefusalText = (r: { reason?: string; stepIds?: string[] } | null | undefined): string | null => {
    const steps = (r?.stepIds ?? []).join(", ");
    switch (r?.reason) {
      case "robotIdMissing": // fix round 3 (R-4-n)
        return t("studio.deployRobotIdMissing", "Not deployed: robot step(s) {{steps}} name no robot. Pick the robot for each step, then deploy again.", { steps });
      case "robotUnavailable": // final wave G3
        return t("studio.deployRobotUnavailable", "Not deployed: robot step(s) {{steps}} name a robot that does not exist (or the robot list could not be read). Pick an existing robot for each step, then deploy again.", { steps });
      case "robotDisabled": // final wave R-4-x — motion steps only
        return t("studio.deployRobotDisabled", "Not deployed: motion step(s) {{steps}} name a robot that is not enabled. Enable the robot or pick an enabled one, then deploy again.", { steps });
      case "stopAdapterAmbiguous": // fix round 2 (R-4-j)
        return t("studio.deployStopAdapterAmbiguous", "Not deployed: stop step(s) {{steps}} cannot reach a single adapter (the machine has none or several enabled, and the step names no adapter). Set the step's adapter or fix the machine's adapters, then deploy again.", { steps });
      default:
        return null;
    }
  };

  const deployM = trpc.orchestration.deployWorkflow.useMutation({
    onSuccess: (r) => {
      if (r?.ok) { toast.success(t("studio.deployed", "Workflow saved / deployed")); void workflowsQ.refetch(); }
      else toast.error(definitionRefusalText(r) ?? r?.message ?? t("studio.deployFail", "Deploy failed"));
    },
    onError: (e) => toastTrpcError(e),
  });
  const startRunM = trpc.orchestration.startRun.useMutation({
    onSuccess: (r) => {
      // doc 80 ORC-06 — server từ chối run workflow chưa deploy (bản nháp) bằng ok:false + message.
      if (r && !r.ok && r.runId == null) {
        // doc 80 Đợt 1 Task 11 — khi lý do là TRẠNG THÁI WORKFLOW (draft/archived), dùng t()
        // thay vì hiện nguyên văn `message` tiếng Anh của server.
        if (r.workflowStatus) {
          toast.error(
            t(
              "studio.runNotDeployed",
              'This workflow is currently "{{status}}" — Deploy it first, then run it.',
              { status: r.workflowStatus },
            ),
          );
        } else if (definitionRefusalText(r)) {
          // final wave G4 — an active workflow failing the deploy-time definition checks is refused at START.
          toast.error(`${t("studio.runRefusedDefinition", "Run not started — the deployed workflow fails a safety check:")} ${definitionRefusalText(r)}`);
        } else {
          toast.error(r.message ?? t("studio.runFail", "Could not start the run"));
        }
      } else toast.success(t("studio.runStarted", "Run started (run #{{id}})", { id: r?.runId ?? "?" }));
      void runsQ.refetch();
    },
    onError: (e) => toastTrpcError(e),
  });
  const resumeM = trpc.orchestration.resumeRun.useMutation({
    onSuccess: () => { void runsQ.refetch(); void utils.orchestration.getRun.invalidate(); },
    // doc 80 Đợt 1 Task 9 — CONFLICT (gate đã đổi / lượt khác đã quyết định) ⇒ tải lại để thấy gate thật.
    onError: (e) => {
      toastTrpcError(e);
      if (e.data?.code === "CONFLICT") { void runsQ.refetch(); void utils.orchestration.getRun.invalidate(); }
    },
  });
  const abortM = trpc.orchestration.abortRun.useMutation({
    onSuccess: () => { void runsQ.refetch(); },
    onError: (e) => toastTrpcError(e),
  });

  // ── Saved-workflow delete (AlertDialog — xác nhận phá huỷ giữ nguyên) / duplicate (sheet) ──
  const [deleteWf, setDeleteWf] = useState<{ id: number; ref: string } | null>(null);

  const deleteWfM = trpc.orchestration.deleteWorkflow.useMutation({
    onSuccess: () => { toast.success(t("studio.wfDeleted", "Workflow deleted")); setDeleteWf(null); void workflowsQ.refetch(); },
    onError: (e) => toastTrpcError(e),
  });
  // Sheet tự đóng qua `done` truyền theo từng lượt gọi (useCloseOwnLayer); toast + tải lại giữ ở đây như cũ.
  const duplicateWfM = trpc.orchestration.duplicateWorkflow.useMutation({
    onSuccess: () => { toast.success(t("studio.wfDuplicated", "Workflow duplicated")); void workflowsQ.refetch(); },
    onError: (e) => toastTrpcError(e),
  });

  // ── W3-11: version history (diff 2 phiên bản + rollback) — nay là sheet `?flyout=orch-versions&flyoutId=<id>` ──
  const search = useSearch();
  const flyoutStack = useMemo(() => parseFlyoutStack(search), [search]);
  const versionsEntry = flyoutStack.find((e) => e.key === VERSIONS_FLYOUT);
  const versionsWfId = versionsEntry?.id != null && /^\d+$/.test(versionsEntry.id) ? Number(versionsEntry.id) : null;
  const versionsQ = trpc.orchestration.listVersions.useQuery(
    { workflowId: versionsWfId ?? 0 },
    { enabled: versionsWfId != null },
  );
  const versionRows = (versionsQ.data ?? []) as Array<{
    id: number;
    version: number;
    name: string;
    definitionJson: unknown;
    createdBy?: number | null;
    createdAt?: string | Date | null;
  }>;
  const rollbackWfM = trpc.orchestration.rollbackWorkflow.useMutation({
    onSuccess: (r) => {
      if (r?.ok) {
        toast.success(t("studio.rollbackDone", "Đã khôi phục — tạo phiên bản mới từ bản cũ"));
        void workflowsQ.refetch();
        void versionsQ.refetch();
      } else {
        // final wave G2 (re-review 3 A3-1) — rollback = deploy: the same refusal codes, translated (not raw server English).
        toast.error(definitionRefusalText(r) ?? r?.message ?? t("studio.rollbackFail", "Khôi phục thất bại"));
      }
    },
    onError: (e) => toastTrpcError(e),
  });

  // ── Panel dưới: Lần chạy / Chờ duyệt / Vấn đề (ruling R-2-l) ─────────────────────────────────
  // Tab trong `?tab=` (F5 giữ). Chưa chọn: có run chờ duyệt hoặc đến từ deep-link `?filter=pending`
  // (PendingReviewStrip) ⇒ "Chờ duyệt" — tương đương nhóm chờ duyệt được GHIM ĐẦU danh sách cũ.
  const [tabParam, setTabParam] = useUrlParam("tab");
  const filterPending = useMemo(() => new URLSearchParams(search).get("filter") === "pending", [search]);
  // Tab do MÃ chọn khi đang có sheet mở (không ghi URL: FlyoutHost giữ dấu lịch sử trên mục URL hiện tại).
  const [autoTab, setAutoTab] = useState<BottomTab | null>(null);
  // final wave T11 — `?tab=` đổi (back/forward, link) ⇒ bỏ tab do mã chọn: URL lại là nguồn sự thật (Review Focus 4).
  useEffect(() => { setAutoTab(null); }, [tabParam]);
  const bottomTab: BottomTab =
    autoTab ?? (isBottomTab(tabParam) ? tabParam : filterPending || awaitingCount > 0 ? "approvals" : "runs");
  const [bottomOpenRequest, setBottomOpenRequest] = useState(0);
  const chooseBottomTab = (tab: BottomTab) => {
    setAutoTab(null);
    setTabParam(tab);
  };
  const openBottom = (tab: BottomTab) => {
    chooseBottomTab(tab);
    setBottomOpenRequest((n) => n + 1);
  };
  // Kết quả mô phỏng mới (người bấm Mô phỏng, hoặc AI đề xuất kèm mô phỏng) ⇒ mở panel ở tab Vấn đề.
  const revealProblems = () => {
    if (new URLSearchParams(window.location.search).has(FLYOUT_PARAM)) setAutoTab("problems");
    else chooseBottomTab("problems");
    setBottomOpenRequest((n) => n + 1);
  };
  // Deep-link LÚC NẠP trang (`?filter=pending` từ PendingReviewStrip, `?tab=` sau F5) = ý định mở panel.
  useEffect(() => {
    if (filterPending || isBottomTab(tabParam)) setBottomOpenRequest((n) => n + 1);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const problemsCount = sim ? sim.errors.length + sim.warnings.length : 0;
  const problemsTone: "error" | "warning" | null = sim
    ? sim.errors.length > 0 || !sim.ok ? "error" : sim.warnings.length > 0 ? "warning" : null
    : null;

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
      revealProblems();
      // doc 40 ENG-F4 — sim ĐẠT → nhớ token gắn với ĐÚNG định nghĩa vừa nộp để qua sim-gate ở Deploy.
      // Sim không đạt → xoá bằng chứng cũ (Deploy sẽ khoá lại khi gate bật).
      if (res?.ok) setSimPass({ hash: submittedHash, token: (res as { simToken?: string }).simToken });
      else setSimPass(null);
    } catch (err) {
      toast.error(mapTrpcError(err));
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
        if (res.simulation) revealProblems();
        if (res.valid) toast.success(t("studio.aiProposed", "AI proposed a workflow — review it before deploying"));
        else toast.warning(res.message ?? t("studio.aiInvalid", "AI could not produce a valid workflow"));
      } else {
        toast.error(res.message ?? t("studio.aiInvalid", "AI could not produce a valid workflow"));
      }
    } catch (err) {
      toast.error(mapTrpcError(err));
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
        if (res.simulation) revealProblems();
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
      toast.error(mapTrpcError(err));
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

  const findWorkflow = (id: string | null) => allWorkflows.find((w) => String(w.id) === id) ?? null;
  const workflowsLoaded = !workflowsQ.isLoading;

  // ── Sheet (FlyoutHost: một stack sheet phải, URL `?flyout=&flyoutId=` là nguồn sự thật) ──
  const flyouts: Record<string, FlyoutDefinition> = {
    // E5 — Trợ lý AI điều phối: sheet 420 px (size sm). HITL: AI chỉ đề xuất; người deploy.
    [AI_FLYOUT]: {
      size: "sm",
      title: t("studio.aiTitle", "AI orchestration advisor"),
      description: t("studio.aiSheetDesc", "AI chỉ ĐỀ XUẤT và mô phỏng — bạn xem lại trên canvas rồi tự Lưu (deploy) và Chạy."),
      render: () => (
        <div className="space-y-3" data-ai-advisor="">
          <div className="space-y-1.5">
            <Label htmlFor="orch-ai-goal" className="text-xs">{t("studio.aiGoal", "Goal / problem (for the AI)")}</Label>
            <Input
              id="orch-ai-goal"
              value={aiGoal}
              onChange={(e) => setAiGoal(e.target.value)}
              placeholder={t("studio.aiGoalPlaceholder", "e.g. AOI reports NG → robot rejects part → conveyor moves it; add an approval gate before stopping the line")}
              disabled={!aiEnabled || aiBusy}
            />
          </div>
          <div className="flex flex-wrap gap-2">
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
        </div>
      ),
    },
    // W3-11 — Version history: VersionHistoryPanel (so sánh 2 bản) + RollbackConfirm mỗi hàng.
    [VERSIONS_FLYOUT]: {
      size: "lg",
      title: t("studio.versionsTitle", "Version history"),
      description: (id) => {
        const wf = findWorkflow(id);
        return `${t("studio.versionsDesc", "Each deploy snapshots a version. Compare two versions or roll back (rollback re-deploys the old definition as a NEW version).")}${wf ? ` — ${String(wf.ref)}` : ""}`;
      },
      render: (layer) => {
        const workflowId = layer.id != null && /^\d+$/.test(layer.id) ? Number(layer.id) : null;
        // final wave T11 — như sheet Nhân bản: quy trình KHÔNG có trong danh sách đã tải ⇒ không mở lịch sử/khôi phục
        // (trang cũ chỉ mở được từ hàng của danh sách).
        if (workflowId == null || (workflowsLoaded && !findWorkflow(layer.id))) {
          return <p className="py-6 text-center text-sm text-muted-foreground">{t("studio.wfNotLoaded", "Không tìm thấy quy trình #{{id}} trong danh sách đã tải.", { id: layer.id ?? "" })}</p>;
        }
        if (!findWorkflow(layer.id)) {
          return <p className="py-6 text-center text-sm text-muted-foreground">{t("common.loading", "Loading…")}</p>;
        }
        if (!versionsQ.isLoading && !versionsQ.isError && versionRows.length === 0) {
          return (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {t("studio.noVersions", "No version snapshots yet (only versions deployed after this feature are recorded).")}
            </p>
          );
        }
        return (
          <VersionHistoryPanel
            status={versionsQ.isLoading ? "loading" : versionsQ.isError ? "error" : "ready"}
            versions={versionRows.map((v) => ({
              id: v.id,
              label: `v${v.version}`,
              createdAt: v.createdAt ?? null,
              author: v.createdBy != null ? `#${v.createdBy}` : undefined,
              note: v.name,
              content: v.definitionJson,
            }))}
            renderRowActions={(row) => {
              const v = versionRows.find((x) => x.id === row.id);
              if (!v) return null;
              // doc 80 ORC-05 — rollback = deploy: lý do bắt buộc (≥3) + OTP tươi mỗi lượt (R-2-g: giữ đúng hợp đồng).
              // OTP hỏi bằng `stepUp.guard` CỦA TRANG ngay tại điểm gọi (y như bản cũ: ConfirmWithReason → guard →
              // mutate) — nên `requireOtp={false}` ở đây KHÔNG có nghĩa là bỏ OTP: nó chỉ tránh hỏi OTP HAI lần.
              // Lưới step-up (`vramPanelStepUp.unit.test.ts` §I-3) đòi mọi điểm gọi thủ tục `deployProcedure` nằm
              // TRONG `stepUp.guard` và gửi `totpCode` ở CÙNG file — đúng hình dạng dưới đây.
              return (
                <RollbackConfirm
                  trigger={
                    <Button
                      size="sm" variant="outline" className="h-7"
                      disabled={!canControl || rollbackWfM.isPending}
                      title={permReason}
                    >
                      <RotateCcw className="mr-1 h-3.5 w-3.5" /> {t("studio.rollback", "Rollback")}
                    </Button>
                  }
                  versionLabel={`v${v.version}`}
                  disabled={!canControl || rollbackWfM.isPending}
                  title={t("studio.rollbackTitle", "Roll back to this version?")}
                  description={t("studio.rollbackConfirm", "This re-deploys version v{{version}}'s definition as a NEW version (append-only; history is preserved). Flag-gated by FOE_ENABLED.", { version: v.version })}
                  impact={t("studio.rollbackImpact", "Requires an OTP code and a reason; the reason is recorded in the audit log.")}
                  requireOtp={false}
                  minReasonLength={3}
                  confirmLabel={t("studio.rollback", "Rollback")}
                  onRollback={({ reason }) =>
                    stepUp.guard((totpCode) =>
                      rollbackWfM.mutate({ workflowId, version: v.version, reason: reason ?? "", totpCode }),
                    )
                  }
                />
              );
            }}
          />
        );
      },
    },
  };
  if (canControl) {
    flyouts[DUPLICATE_FLYOUT] = {
      size: "sm",
      title: t("studio.duplicateTitle", "Duplicate workflow"),
      description: t("studio.duplicateDesc", "Create a copy with a new ref. The copy carries no runs."),
      render: (layer) => {
        const w = findWorkflow(layer.id);
        const wf = w ? { id: Number(w.id), ref: String(w.ref), name: String(w.name ?? w.ref) } : null;
        return (
          <DuplicateWorkflowForm
            key={wf?.id ?? "none"}
            wf={wf}
            loaded={workflowsLoaded}
            pending={duplicateWfM.isPending}
            onDuplicate={(input, done) => duplicateWfM.mutate(input, { onSuccess: () => done() })}
          />
        );
      },
    };
  }

  // ── Header: một hàng — h1 · chip (Chỉ xem, FOE tắt, sim-gate, Khi nào dùng) · hành động ──
  const notices: Array<NoticeItem | false> = [
    // Cùng điều kiện banner cũ: đang tải ⇒ không hiện.
    !statusQ.isLoading && !foeEnabled && {
      id: "foeOff",
      kind: "flagOff",
      label: t("studio.foeOffChip", "FOE đang tắt"),
      testId: "orch-foe-off",
      content: <p>{t("studio.foeOff", "FOE is off (FOE_ENABLED) — you can still author & simulate, but deploy/run are disabled.")}</p>,
    },
    // doc 40 ENG-F4 — sim-gate: đánh dấu bước Simulate là BẮT BUỘC trước Deploy (khi cờ bật).
    simGateRequired && foeEnabled && {
      id: "simGate",
      kind: "simGate",
      label: simFresh ? t("studio.simGateChipOk", "Sim-gate: đã ĐẠT") : t("studio.simGateChipNeed", "Sim-gate: cần mô phỏng"),
      testId: "orch-sim-gate",
      content: (
        <p>
          {simFresh
            ? t("studio.simGateOk", "Mô phỏng đã ĐẠT cho định nghĩa hiện tại — có thể Deploy.")
            : t("studio.simGateRequiredHint", "Sim-gate BẬT: phải Simulate ĐẠT (feasible) định nghĩa hiện tại trước khi Deploy. Mọi chỉnh sửa sẽ yêu cầu mô phỏng lại.")}
        </p>
      ),
    },
    // U7 (doc 26 §2.1) — "Khi nào dùng": khoá riêng của trang + phụ đề cũ.
    {
      id: "whenToUse",
      kind: "whenToUse",
      content: (
        <div className="space-y-1.5">
          <p className="text-muted-foreground">{t("studio.subtitle", "Author multi-machine workflows visually, simulate them on the digital twin, then deploy & run")}</p>
          <p data-when-to-use="studio.whenToUse">{t("studio.whenToUse", "When to use — design multi-machine workflows visually and dry-run them on the twin before deploying. For a single-device program use the Engineering Workspace.")}</p>
        </div>
      ),
    },
  ];

  const canvasTitle = canvasView === "tree" ? t("studio.canvas", "Workflow tree") : t("studio.graphCanvas", "Workflow diagram");

  // ── Thanh công cụ DUY NHẤT của MAIN (`data-layout-toolbar`, 40 px ≤ 56): tên/mã/phiên bản sửa tại chỗ · Cây | Sơ đồ ──
  const toolbar = (
    <div data-layout-toolbar="" className="flex h-10 min-w-0 shrink-0 items-center gap-2 border-b px-2">
      <InlineEditText
        value={def.name}
        label={t("studio.editName", "Tên quy trình *")}
        emptyText={t("studio.untitled", "Quy trình chưa đặt tên")}
        placeholder={t("studio.namePlaceholder", "Line A startup")}
        onCommit={(v) => setDef((d) => ({ ...d, name: v }))}
      />
      <InlineEditText
        value={def.ref}
        mono
        label={t("studio.editRef", "Mã quy trình (ref) *")}
        emptyText={t("studio.noRef", "chưa có mã (ref)")}
        placeholder="line-a-startup"
        onCommit={(v) => setDef((d) => ({ ...d, ref: v }))}
      />
      <label className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
        v
        <Input
          type="number"
          aria-label={t("studio.versionNumber", "Số phiên bản")}
          value={def.version ?? 1}
          onChange={(e) => setDef((d) => ({ ...d, version: Number(e.target.value) }))}
          className="h-7 w-16 text-xs"
        />
      </label>
      <div className="flex-1" />
      {/* Toggle view — cây là mặc định an toàn; sơ đồ là view đọc + chọn node */}
      <div
        className="inline-flex shrink-0 overflow-hidden rounded-md border"
        role="tablist"
        aria-label={t("studio.viewToggle", "View")}
        title={t("studio.editorNote", "Author on the nested step tree, or switch to the node-graph diagram to visualize sequence / parallel / branch.")}
      >
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
    </div>
  );

  // ── MAIN: thanh công cụ + canvas (cây lồng nhau | sơ đồ node); canvas tự cuộn, thanh công cụ đứng yên ──
  const canvasBody =
    canvasView === "tree" ? (
      <div className="space-y-1.5 p-3">
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
      </div>
    ) : (
      <div className="h-full p-2">
        {/* U14 — canvas luôn hiển thị (kể cả khi trống); bảng bước bên trái kéo-thả vào sơ đồ. */}
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
          fill
          showPalette={false}
        />
      </div>
    );
  const canvas = (
    <div className="flex h-full min-h-0 flex-col">
      {toolbar}
      <div className="min-h-0 flex-1 overflow-auto">{canvasBody}</div>
    </div>
  );

  // ── PHẢI: Inspector ──
  const inspector = (
    <div className="p-3">
      <h2 className="mb-2 text-sm font-semibold">{t("studio.inspector", "Step configuration")}</h2>
      {selectedStep ? (
        <Inspector step={selectedStep} machines={machines} robots={robotOptions} onPatch={handlePatch} t={t} />
      ) : (
        <p className="py-6 text-center text-sm text-muted-foreground">{t("studio.selectStep", "Select a step on the tree to configure it.")}</p>
      )}
    </div>
  );

  const renderRun = (r: Record<string, unknown>, interrupted = false) => (
    <RunRow
      key={String(r.id)}
      run={r}
      interrupted={interrupted}
      canControl={canControl}
      assignment={runAssignments.get(Number(r.id))}
      canAssign={canAssignRun}
      onResume={(approved, note, expectedStepId, expectedDefHash) => resumeM.mutate({ runId: Number(r.id), approved, note, expectedStepId, expectedDefHash })}
      onAbort={() => abortM.mutate({ runId: Number(r.id) })}
      t={t}
    />
  );

  // ── DƯỚI: Lần chạy / Chờ duyệt / Vấn đề. forceMount ⇒ đổi tab không huỷ chi tiết run đang mở. ──
  const bottomContent = (
    <Tabs value={bottomTab} onValueChange={(v) => isBottomTab(v) && chooseBottomTab(v)} className="flex h-full min-h-0 flex-col gap-0">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b px-2">
        <TabsList className="h-7">
          <TabsTrigger value="runs" className="h-6 text-xs">{t("studio.runsTab", "Lần chạy")}</TabsTrigger>
          <TabsTrigger value="approvals" className="h-6 gap-1 text-xs">
            {t("studio.awaitingTab", "Chờ duyệt")}
            {awaitingCount > 0 && <Badge className="h-4 min-w-4 bg-amber-500 px-1 text-[10px] text-white">{awaitingCount}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="problems" className="h-6 gap-1 text-xs">
            {t("studio.problemsTab", "Vấn đề")}
            {problemsCount > 0 && (
              <Badge className={`h-4 min-w-4 px-1 text-[10px] text-white ${problemsTone === "error" ? "bg-destructive" : "bg-amber-500"}`}>{problemsCount}</Badge>
            )}
          </TabsTrigger>
        </TabsList>
        <div className="flex-1" />
        {/* U13 — lọc theo trạng thái (lọc phía client) — áp cho danh sách run như cũ. */}
        {bottomTab !== "problems" && allRuns.length > 0 && (
          <Select value={runStatusFilter} onValueChange={setRunStatusFilter}>
            <SelectTrigger className="h-7 w-44 text-xs" aria-label={t("studio.runStatusFilter", "Lọc theo trạng thái")}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("studio.allStatuses", "Tất cả trạng thái")}</SelectItem>
              {runStatuses.map((s) => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {bottomTab !== "problems" && (
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            aria-label={t("studio.refreshRuns", "Tải lại lần chạy")}
            title={t("studio.refreshRuns", "Tải lại lần chạy")}
            onClick={() => void runsQ.refetch()}
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        )}
      </div>
      <TabsContent value="runs" forceMount hidden={bottomTab !== "runs"} className="min-h-0 flex-1 space-y-1.5 overflow-auto p-2">
        <ProvenanceSummary rows={allRuns} />
        {allRuns.length === 0 && (
          <p className="py-4 text-center text-sm text-muted-foreground">{t("studio.noRuns", "No runs yet.")}</p>
        )}
        {allRuns.length > 0 && interruptedRuns.length === 0 && otherRuns.length === 0 && (
          <p className="py-4 text-center text-sm text-muted-foreground">{t("studio.noRunMatch", "Không có lần chạy khớp bộ lọc")}</p>
        )}
        {/* doc 80 ORC-04 — nhóm "Bị gián đoạn" (held do restart): KHÔNG phải cổng chờ duyệt — ghim đầu như cũ. */}
        {interruptedRuns.length > 0 && (
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 pt-1 text-xs font-semibold text-orange-600 dark:text-orange-400">
              <AlertTriangle className="h-3.5 w-3.5" />
              {t("studio.interruptedRuns", "Interrupted")}
              <Badge variant="outline" className="text-[10px]">{interruptedRuns.length}</Badge>
            </div>
            {interruptedRuns.map((r) => renderRun(r, true))}
          </div>
        )}
        {otherRuns.length > 0 && (
          <div className="space-y-1.5">
            {interruptedRuns.length > 0 && (
              <div className="pt-1 text-xs font-semibold text-muted-foreground">{t("studio.otherRuns", "Lần chạy khác")}</div>
            )}
            {otherRuns.map((r) => renderRun(r))}
          </div>
        )}
      </TabsContent>
      <TabsContent value="approvals" forceMount hidden={bottomTab !== "approvals"} className="min-h-0 flex-1 space-y-1.5 overflow-auto p-2">
        {/* §2.3 — run đang chờ duyệt (HITL gate). */}
        {awaitingRuns.length === 0 && (
          <p className="py-4 text-center text-sm text-muted-foreground">
            {awaitingCount > 0
              ? t("studio.noRunMatch", "Không có lần chạy khớp bộ lọc")
              : t("studio.noAwaiting", "Không có lần chạy nào đang chờ duyệt.")}
          </p>
        )}
        {awaitingRuns.map((r) => renderRun(r))}
      </TabsContent>
      <TabsContent value="problems" forceMount hidden={bottomTab !== "problems"} className="min-h-0 flex-1 overflow-auto p-2">
        {sim ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <Gauge className="h-4 w-4 text-primary" aria-hidden="true" /> {t("studio.twin", "Digital twin — simulation result")}
              </h3>
              {/* W6-26 + U1 — cross-link golden-thread: sim → xem phát lại trên twin viewer,
                  MANG ?ref= workflow đang mở để Cell Twin tự chọn đúng workflow (không mở trống). */}
              <span className="flex items-center gap-3 text-xs">
                <Link href={withParams("/cell-twin", { ref: def.ref || null })} className="font-medium text-primary hover:underline">
                  {def.ref ? t("studio.viewOnCellTwin", "Xem trên Cell Twin") : t("nav.cellTwin")}
                </Link>
                <Link href="/rf-test-cell" className="font-medium text-primary hover:underline">{t("nav.rfTestCell")}</Link>
              </span>
            </div>
            <TwinView sim={sim} machines={machines} t={t} />
          </div>
        ) : (
          <p className="py-4 text-center text-sm text-muted-foreground">
            {t("studio.noSim", "Chưa có kết quả mô phỏng — bấm Mô phỏng để kiểm tra quy trình trên bản sao số.")}
          </p>
        )}
      </TabsContent>
    </Tabs>
  );

  // ── Thanh trạng thái: số đếm LUÔN thấy kể cả khi panel dưới gập (R-2-l); bấm = mở đúng tab. ──
  const statusItem = (testId: string, tab: BottomTab, label: string, value: ReactNode, tone: "error" | "warning" | null) => (
    <button
      type="button"
      data-testid={testId}
      onClick={() => openBottom(tab)}
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1 rounded px-1 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        tone === "error" && "font-semibold text-destructive",
        tone === "warning" && "font-semibold text-amber-600 dark:text-amber-400",
      )}
    >
      {label}: <span className="tabular-nums">{value}</span>
    </button>
  );
  const statusBar = (
    <div className="flex min-w-0 items-center gap-2">
      {statusItem("orch-status-runs", "runs", t("studio.runsTab", "Lần chạy"), runsQ.isLoading ? "…" : allRuns.length, null)}
      {statusItem("orch-status-awaiting", "approvals", t("studio.awaitingTab", "Chờ duyệt"), runsQ.isLoading ? "…" : awaitingCount, awaitingCount > 0 ? "warning" : null)}
      {statusItem("orch-status-problems", "problems", t("studio.problemsTab", "Vấn đề"), problemsCount, problemsTone)}
    </div>
  );

  return (
    <DashboardLayout>
      <FlyoutHost flyouts={flyouts}>
        <AiSurfaceGuard />
        <div className="flex h-[calc(100dvh_-_var(--shell-chrome-h,3.5rem))] min-h-[30rem] flex-col">
          <PageHeaderCompact
            className="shrink-0 px-3 py-1"
            icon={<Workflow />}
            title={t("studio.title", "Orchestration Studio")}
            chips={
              <>
                {!canControl && <ViewOnlyBadge module="machine_control" />}
                <NoticeStack items={notices} />
              </>
            }
            actions={
              <>
                <AiAdvisorButton label={t("studio.aiTitle", "AI orchestration advisor")} />
                <Button
                  variant="outline"
                  aria-label={t("studio.simulate", "Simulate")}
                  onClick={() => void runSimulate()}
                  disabled={simulating || def.steps.length === 0}
                >
                  <FlaskConical className="h-4 w-4 lg:mr-1.5" aria-hidden="true" />
                  <span className="hidden lg:inline">{t("studio.simulate", "Simulate")}</span>
                </Button>
                <Button
                  variant="outline"
                  aria-label={t("studio.deploy", "Save (deploy)")}
                  onClick={runDeploy}
                  disabled={!canControl || !foeEnabled || deployM.isPending || (simGateRequired && !simFresh)}
                  title={
                    controlReason ??
                    (simGateRequired && !simFresh
                      ? t("studio.simRequired", "Chưa mô phỏng đạt — hãy Simulate đến khi feasible trước khi Deploy")
                      : undefined)
                  }
                >
                  <Save className="h-4 w-4 lg:mr-1.5" aria-hidden="true" />
                  <span className="hidden lg:inline">{t("studio.deploy", "Save (deploy)")}</span>
                </Button>
                <Button
                  aria-label={t("studio.run", "Run")}
                  onClick={runStart}
                  disabled={!canControl || !foeEnabled || startRunM.isPending || !def.ref}
                  title={controlReason}
                >
                  <Play className="h-4 w-4 lg:mr-1.5" aria-hidden="true" />
                  <span className="hidden lg:inline">{t("studio.run", "Run")}</span>
                </Button>
              </>
            }
          />
          <WorkbenchShell
            layoutId="orchestration-studio"
            userId={user?.id ?? null}
            mainName="orchestration-studio"
            mainLabel={t("studio.canvasArea", "Canvas")}
            mainAria={{ "aria-label": canvasTitle }}
            heightClass="min-h-0 flex-1"
            className="rounded-none border-x-0 border-b-0"
            main={canvas}
            left={{
              label: t("studio.libraryPanel", "Bước & thư viện"),
              minPx: 220,
              defaultPx: 240,
              maxPx: 360,
              content: (
                <LibraryPanel
                  workflows={allWorkflows}
                  filteredWorkflows={filteredWorkflows}
                  wfSearch={wfSearch}
                  onSearch={setWfSearch}
                  onRefresh={() => void workflowsQ.refetch()}
                  onLoad={(w) => loadWorkflow(w as { definitionJson?: unknown })}
                  onDelete={setDeleteWf}
                  onAddStep={handleAddTopLevel}
                  canControl={canControl}
                  permReason={permReason}
                  showGraphHint={canvasView === "graph"}
                  t={t}
                />
              ),
            }}
            right={{ label: t("studio.inspector", "Step configuration"), minPx: 300, defaultPx: 340, maxPx: 480, content: inspector }}
            bottom={{
              label: t("studio.bottomPanel", "Lần chạy · Duyệt · Vấn đề"),
              minPx: 160,
              defaultPx: 260,
              maxPx: 480,
              defaultCollapsed: true,
              openRequest: bottomOpenRequest,
              content: bottomContent,
            }}
            statusBar={statusBar}
          />
        </div>
      </FlyoutHost>

      {/* Delete workflow confirm — xác nhận phá huỷ: giữ AlertDialog. */}
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
  error?: string | null;
};

/**
 * doc 81 Đợt 4 Task A5 + fix round 1 (finding 7) — the engine's step error for "no separate gate approval":
 * `FOE_GATE_REQUIRED(<reason>): …` (foeEngine.gateRequiredError). Each reason has its own translated sentence.
 */
const FOE_GATE_REQUIRED_RE = /^FOE_GATE_REQUIRED(?:\((noGate|approvedByOwner|staleApproval|ownerUnknown)\))?(?=:|\s|$)/;
type GateRequiredReason = "noGate" | "approvedByOwner" | "staleApproval" | "ownerUnknown";
function gateRequiredReasonOf(error: unknown): GateRequiredReason | null {
  if (typeof error !== "string") return null;
  const m = FOE_GATE_REQUIRED_RE.exec(error);
  return m ? ((m[1] as GateRequiredReason | undefined) ?? "noGate") : null;
}
/** doc 81 Đợt 4 fix round 3 (R-4-n) — `result.detail.appError` of a failed step (e.g. INVALID_VALUE robotId/robotIdRequired). */
function stepAppError(s: RunStepView): { appCode: string; appParams: Record<string, string | number> | undefined } | null {
  if (s.status !== "failed") return null;
  const a = (s.result?.detail as { appError?: { appCode?: unknown; appParams?: unknown } } | undefined)?.appError;
  if (!a || typeof a.appCode !== "string") return null;
  return { appCode: a.appCode, appParams: (a.appParams as Record<string, string | number> | undefined) ?? undefined };
}

function gateRequiredText(reason: GateRequiredReason, t: TFunction): string {
  switch (reason) {
    case "approvedByOwner":
      return t("studio.gateRequiredOwnerApproved", "Not sent: the approval gate before this command was approved by the person who started the run, which does not count. Start a new run and have another user approve the gate.");
    case "staleApproval":
      return t("studio.gateRequiredStale", "Not sent: the workflow was redeployed after the gate was approved, so that approval does not cover what is running now. Start a new run and have the gate approved again.");
    case "ownerUnknown":
      return t("studio.gateRequiredOwnerUnknown", "Not sent: this run has no known owner (started by the system or by an API key with no creating user), so a separate approval cannot be checked. Start the run as a user.");
    default:
      return t("studio.gateRequired", "Not sent: this command needs an approval gate earlier in the run, approved by someone other than the person who started it. Add a gate before this step, deploy, and start a new run.");
  }
}

/** doc 80 Task 4 (ORC-13) — per-step dispatch marker in the run drawer (routedTo + simulated/sent). */
function StepDispatchTag({ result, t }: { result: Record<string, unknown> | null | undefined; t: TFunction }) {
  const kind = classifyStepDispatch(result);
  if (!kind) return null;
  const routedTo = typeof result?.routedTo === "string" ? result.routedTo : "";
  // Fix round 1 — "not sent" ONLY for rejected; failed/timeout may have reached the device.
  const label =
    kind === "simulated"
      ? t("provenance.step.simulated", "simulated")
      : kind === "live"
        ? t("provenance.step.live", "sent")
        : kind === "unconfirmed"
          ? t("provenance.step.unconfirmed", "unconfirmed — may have reached the device")
          : t("provenance.step.rejected", "not sent");
  return (
    <Badge
      variant="outline"
      data-testid="step-dispatch"
      data-kind={kind}
      className={`text-[10px] ${kind === "simulated" ? "border-violet-500/50 text-violet-700 dark:text-violet-300" : kind === "live" ? "border-emerald-500/50 text-emerald-700 dark:text-emerald-300" : kind === "unconfirmed" ? "border-amber-500/50 text-amber-700 dark:text-amber-300" : "text-muted-foreground"}`}
    >
      {routedTo ? `${routedTo} · ` : ""}{label}
    </Badge>
  );
}

function RunRow({
  run,
  interrupted = false,
  canControl,
  assignment,
  canAssign = false,
  onResume,
  onAbort,
  t,
}: {
  run: Record<string, unknown>;
  /** doc 80 ORC-04 — run 'held' do server khởi động lại (không phải cổng chờ duyệt). */
  interrupted?: boolean;
  canControl: boolean;
  /** doc 81 Đợt 3 Task 4 — phân công đang hiệu lực của run này + quyền giao (machine_control/canCreate). */
  assignment?: AssignmentRow;
  canAssign?: boolean;
  /** doc 80 Đợt 1 Task 9 — `expectedStepId` = gate đang HIỂN THỊ (server từ chối nếu run đã sang gate khác). */
  /** doc 81 Đợt 4 fix round 2 (R-4-k) — `expectedDefHash` = getRun().defHash the screen loaded; required to approve. */
  onResume: (approved: boolean, note: string | undefined, expectedStepId: string | null, expectedDefHash?: string) => void;
  onAbort: () => void;
  t: TFunction;
}) {
  const [open, setOpen] = useState(false);
  // U6 — chế độ nhập lý do khi từ chối (reject) + nội dung lý do.
  const [rejecting, setRejecting] = useState(false);
  const [rejectNote, setRejectNote] = useState("");
  // doc 80 ORC-04 — "Tiếp tục…" một run bị gián đoạn phải qua hộp xác nhận.
  const [confirmContinue, setConfirmContinue] = useState(false);
  const status = String(run.status ?? "");
  const runId = Number(run.id);
  const awaiting = !interrupted && (status === "awaiting_confirm" || status === "held");
  // doc 80 ORC-01 — Abort nay dừng THẬT run đang chạy ⇒ hiện nút cho run queued/running.
  const abortable = status === "running" || status === "queued";
  // Realtime: khi panel mở → poll bước; run đang chờ duyệt cũng nạp 1 lần (không poll)
  // để lấy NGỮ CẢNH gate (prompt/approverRoles) hiển thị cạnh nút Approve.
  const detailQ = trpc.orchestration.getRun.useQuery(
    { runId },
    {
      // doc 81 Đợt 4 fix round 2 (R-4-k) — interrupted runs too: "Continue" sends the loaded definition hash.
      enabled: open || ((awaiting || interrupted) && canControl),
      refetchInterval: (q) => {
        const st = String((q.state.data as { run?: { status?: string } } | undefined)?.run?.status ?? status);
        return open && !isRunTerminal(st) ? 1500 : false;
      },
    },
  );
  const currentStepId = detailQ.data?.run?.currentStepId ?? null;
  // doc 80 Đợt 1 Task 9 — gate người duyệt đang NHÌN: bước của chi tiết đã nạp (khối ngữ cảnh
  // "Bước đang chờ"), chưa nạp thì bước trên hàng danh sách. Gửi kèm approve/reject/continue.
  const shownStepId: string | null = detailQ.data?.run
    ? (detailQ.data.run.currentStepId ?? null)
    : typeof run.currentStepId === "string" ? run.currentStepId : null;
  const steps = (detailQ.data?.steps ?? []) as RunStepView[];
  // doc 81 Đợt 4 fix round 2 (R-4-k) — the definition this screen shows; Approve / Continue wait for it.
  // fix round 3 (R-4-p) — PINNED at the first view of the gate (per gate step): a later poll with another hash never
  // replaces it silently; the row says "definition changed, reload" and Approve / Continue stay disabled.
  const polledHash = (detailQ.data as { defHash?: string | null } | undefined)?.defHash ?? undefined;
  const pinKey = `${runId}:${shownStepId ?? ""}`;
  const pinned = useRef<{ key: string; hash: string } | null>(null);
  if (polledHash && (!pinned.current || pinned.current.key !== pinKey)) pinned.current = { key: pinKey, hash: polledHash };
  const defHash = pinned.current?.key === pinKey ? pinned.current.hash : undefined;
  const defChanged = defHash !== undefined && polledHash !== undefined && polledHash !== defHash;
  // U6 — bước đang chờ + prompt tác giả soạn + roles người duyệt (từ result của gate).
  const currentStep = currentStepId != null ? steps.find((s) => s.stepId === currentStepId) : undefined;
  const gatePrompt = typeof currentStep?.result?.prompt === "string" ? (currentStep.result.prompt as string) : "";
  const gateRoles = Array.isArray(currentStep?.result?.approverRoles)
    ? (currentStep!.result!.approverRoles as unknown[]).map(String).filter(Boolean)
    : [];

  const closeReject = () => { setRejecting(false); setRejectNote(""); };

  return (
    <div className="rounded border text-sm" data-run-row={runId}>
      <div className="flex items-center justify-between px-2 py-1.5">
        <button className="flex min-w-0 items-center gap-2" onClick={() => setOpen((o) => !o)}>
          <Badge className={`${RUN_STATUS_COLOR[status] ?? "bg-slate-400"} text-white`}>{status}</Badge>
          <span className="truncate font-mono text-[11px] text-muted-foreground">run #{runId} · {String(run.workflowRef ?? run.workflowId ?? "")}</span>
          {/* doc 80 Task 4 — X-01 source label + ORC-13 dry-run/live marker. */}
          <ProvenanceBadge row={run} />
          <DispatchModeBadge dispatch={run.dispatch as RunDispatchSummary | undefined} />
          {assignment && <AssigneeCell row={assignment} className="max-w-[9rem]" />}
        </button>
        {interrupted && canControl && (
          <div className="flex gap-1">
            <Button size="sm" variant="outline" className="h-7" onClick={() => setConfirmContinue(true)}>
              {t("studio.continueRun", "Continue…")}
            </Button>
            <Button size="sm" variant="destructive" className="h-7" onClick={onAbort}>
              {t("studio.cancelRun", "Cancel run")}
            </Button>
          </div>
        )}
        {abortable && canControl && (
          <Button size="sm" variant="destructive" className="h-7" onClick={onAbort}>
            {t("studio.abort", "Abort")}
          </Button>
        )}
        {awaiting && canControl && (
          <div className="flex gap-1">
            <Button size="sm" className="h-7 bg-emerald-600 hover:bg-emerald-700" disabled={!defHash || defChanged} onClick={() => onResume(true, undefined, shownStepId, defHash)}>
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

      {defChanged && (awaiting || interrupted) && canControl && (
        <div data-testid="definition-changed" role="alert" className="border-t bg-amber-500/10 px-2 py-1.5 text-xs text-amber-800 dark:text-amber-200">
          {t("studio.definitionChangedReload", "The workflow definition changed since you opened this approval — reload the page and review it before approving.")}
        </div>
      )}
      {interrupted && (
        <div className="border-t bg-orange-500/5 px-2 py-1.5 text-xs text-muted-foreground">
          {t("studio.interruptedHint", "Interrupted by a server restart — this is NOT an approval gate. Check the line before continuing; completed steps will not run again.")}
        </div>
      )}
      <AlertDialog open={confirmContinue} onOpenChange={setConfirmContinue}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("studio.continueRunTitle", "Continue run #{{id}}?", { id: runId })}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("studio.continueRunDesc", "The run resumes from where it was interrupted and may send real commands to machines. Completed steps are skipped.")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel", "Cancel")}</AlertDialogCancel>
            <AlertDialogAction disabled={!defHash || defChanged} onClick={() => { setConfirmContinue(false); onResume(true, undefined, shownStepId, defHash); }}>
              {t("studio.continueRunConfirm", "Continue run")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* U6 (doc 26 §2.3) — NGỮ CẢNH duyệt: người duyệt thấy đang duyệt BƯỚC GÌ. */}
      {awaiting && canControl && (
        <div className="space-y-2 border-t bg-violet-500/5 px-2 py-2">
          {/* doc 81 Đợt 3 Task 4 — "Giao cho" run đang giữ (không đụng nút Approve/Reject/Abort ở trên). */}
          <AssignmentControl entityType="orchestration_run" entityId={runId} assignment={assignment} canAssign={canAssign} />
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
                  onClick={() => { onResume(false, rejectNote.trim() || undefined, shownStepId); closeReject(); }}
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
            // doc 81 Đợt 4 Task A5 — a command step stopped because no separate approval gate preceded it.
            const gateRequired = gateRequiredReasonOf(s.error);
            return (
              <div key={s.stepId}>
                <div className={`flex items-center justify-between py-0.5 text-xs ${isCurrent ? "rounded bg-primary/10 px-1" : ""}`}>
                  <span className="font-mono text-[11px]">
                    {isCurrent && <span className="mr-1 text-primary">▶</span>}
                    {s.stepId} <span className="text-muted-foreground">({s.stepType})</span>
                  </span>
                  <span className="flex items-center gap-1">
                    {/* doc 80 Task 4 (ORC-13) — where the command went and whether it was simulated. */}
                    <StepDispatchTag result={s.result} t={t} />
                    <Badge variant="outline" className="text-[10px]">{s.status}</Badge>
                  </span>
                </div>
                {/* doc 81 Đợt 4 fix round 3 (R-4-n) — a localisable refusal carried by the step (detail.appError). */}
                {!gateRequired && stepAppError(s) && (
                  <p data-testid="step-app-error" className="pb-1 pl-2 text-[11px] text-amber-700 dark:text-amber-300">
                    {translateAppError(stepAppError(s)!.appCode, stepAppError(s)!.appParams, s.error ?? "")}
                  </p>
                )}
                {gateRequired && (
                  <p data-testid="step-gate-required" data-reason={gateRequired} className="pb-1 pl-2 text-[11px] text-amber-700 dark:text-amber-300">
                    {gateRequiredText(gateRequired, t)}
                  </p>
                )}
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
