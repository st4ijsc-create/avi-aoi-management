/**
 * W4-16 — NODE-GRAPH CANVAS cho Orchestration Studio (view "Sơ đồ").
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Một @xyflow/react (react-flow) canvas render `StudioDef` dưới dạng node-graph —
 * view thứ 2 BÊN CẠNH cây bước hiện có (cây vẫn là mặc định an toàn). Canvas này
 * là READ + SELECT: nó DERIVE nodes+edges từ chính `def.steps` mỗi lần render
 * (qua `defToGraph`), KHÔNG giữ state cấu trúc riêng → cây ↔ sơ đồ luôn cùng một
 * nguồn sự thật. Click node → chọn để mở Inspector; xoá node qua nút hoặc phím
 * Delete. Kéo node chỉ sắp xếp trực quan trong phiên (không đổi cấu trúc / không
 * lưu — sắp lại cấu trúc trên canvas để residual risk).
 *
 *   • node ← một StudioStep (đệ quy mọi cấp lồng). Hiện icon + nhãn + tóm tắt + id.
 *   • edge ← luồng điều khiển: `next` tuần tự giữa các anh-em; container
 *            (sequence/parallel) → con đầu của steps; branch → con đầu của
 *            then (nhãn "then") / else (nhãn "else").
 *
 * Chỉ dùng semantic tokens (dark-first). Không hex thô.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { TFunction } from "i18next";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Handle,
  Position,
  useReactFlow,
  useNodesState,
  type Node,
  type Edge,
  type NodeProps,
  type NodeTypes,
  type NodeMouseHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  Terminal, ListOrdered, Layers, GitBranch, Hourglass, Activity, HandMetal, Timer, Trash2, CornerDownRight,
} from "lucide-react";
import { STEP_META, type StudioStep, type StudioDef, type StepKind } from "./workflowTypes";

// Icon theo loại bước (đồng bộ với ICONS ở OrchestrationStudio).
const STEP_ICON: Record<StepKind, typeof Terminal> = {
  command: Terminal,
  sequence: ListOrdered,
  parallel: Layers,
  branch: GitBranch,
  wait_state: Hourglass,
  wait_telemetry: Activity,
  hitl_gate: HandMetal,
  delay: Timer,
};

/** Tóm tắt một dòng cho node (thuần, không phụ thuộc capability). */
function summarizeStep(step: StudioStep, t: TFunction): string {
  switch (step.type) {
    case "command":
      return `M#${step.machineId ?? "?"} · ${step.command || "—"}`;
    case "wait_state":
      return `M#${step.machineId ?? "?"} → ${(step.targetStates ?? []).join(", ") || "—"}`;
    case "wait_telemetry":
      return t("studio.conditionShort", "telemetry condition");
    case "branch":
      return t("studio.branchShort", "branch by condition");
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

/** Các danh sách con của một bước container (giống StepBlock ở page). */
function childListsOf(step: StudioStep, t: TFunction): Array<{ label: string; items: StudioStep[] }> {
  if (step.type === "sequence" || step.type === "parallel") {
    return [{ label: "", items: step.steps ?? [] }];
  }
  if (step.type === "branch") {
    return [
      { label: t("studio.branchThen", "If true (then)"), items: step.then ?? [] },
      { label: t("studio.branchElse", "If false (else)"), items: step.else ?? [] },
    ];
  }
  return [];
}

// ── layout deterministic (depth-first, lane dọc, con thụt phải) ──
const NODE_H = 78;
const V_GAP = 30;
const H_INDENT = 300;

type WfNodeData = {
  step: StudioStep;
  selected: boolean;
  slotLabel: string | null;
  t: TFunction;
  onDelete: (id: string) => void;
};
type Built = { nodes: Node<WfNodeData>[]; edges: Edge[] };

/** StudioDef → react-flow nodes+edges. PURE. `selectedId` chỉ ảnh hưởng trình bày. */
export function defToGraph(
  def: StudioDef,
  selectedId: string | null,
  t: TFunction,
  onDelete: (id: string) => void,
): Built {
  const nodes: Node<WfNodeData>[] = [];
  const edges: Edge[] = [];

  const layList = (list: StudioStep[], x: number, yStart: number, slotLabel: string | null): number => {
    let y = yStart;
    let prevId: string | null = null;
    for (const step of list) {
      const id = step.id || "?";
      nodes.push({
        id,
        type: "wfStep",
        position: { x, y },
        data: { step, selected: selectedId === id, slotLabel, t, onDelete },
        selected: selectedId === id,
      });
      if (prevId) {
        edges.push({ id: `next-${prevId}-${id}`, source: prevId, target: id, type: "smoothstep", data: { kind: "next" } });
      }
      prevId = id;

      const lists = childListsOf(step, t);
      if (lists.length > 0) {
        let branchBottom = y + NODE_H;
        lists.forEach((cl, si) => {
          const childX = x + H_INDENT * (si + 1);
          const first = cl.items[0];
          if (first?.id) {
            edges.push({
              id: `slot-${id}-${si}-${first.id}`,
              source: id,
              target: first.id,
              type: "smoothstep",
              label: cl.label || undefined,
              data: { kind: "slot" },
            });
          }
          const bottom = layList(cl.items, childX, y, cl.label || null);
          branchBottom = Math.max(branchBottom, bottom);
        });
        y = branchBottom + V_GAP;
      } else {
        y += NODE_H + V_GAP;
      }
    }
    return y;
  };

  layList(def.steps, 40, 40, null);
  return { nodes, edges };
}

// ── node component có kiểu ──
function WfStepNode({ data }: NodeProps<Node<WfNodeData>>) {
  const { step, selected, slotLabel, t, onDelete } = data;
  const meta = STEP_META[step.type];
  const Icon = STEP_ICON[step.type];

  return (
    <div
      className={`relative w-[220px] rounded-md border bg-card px-2.5 py-2 text-card-foreground shadow-sm transition-colors ${
        selected ? "border-primary ring-2 ring-primary" : "border-border hover:border-primary/50"
      }`}
    >
      <Handle type="target" position={Position.Top} className="!h-2 !w-2 !border-border !bg-muted-foreground" />
      <Handle type="source" position={Position.Bottom} className="!h-2 !w-2 !border-border !bg-primary" />

      {slotLabel && (
        <div className="mb-1 flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
          <CornerDownRight className="h-2.5 w-2.5" /> {slotLabel}
        </div>
      )}

      <div className="flex items-start gap-2">
        <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded ${meta.iconBg}`}>
          <Icon className={`h-3.5 w-3.5 ${meta.iconColor}`} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-xs font-medium">{t(meta.labelKey, meta.labelDefault)}</span>
            <span className="font-mono text-[9px] text-muted-foreground">{step.id}</span>
          </div>
          <div className="truncate text-[10px] text-muted-foreground">{summarizeStep(step, t)}</div>
        </div>
        <button
          type="button"
          className="nodrag rounded p-0.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
          aria-label={t("common.delete", "Delete")}
          onClick={(e) => { e.stopPropagation(); onDelete(step.id); }}
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

const NODE_TYPES: NodeTypes = { wfStep: WfStepNode };

export interface WorkflowGraphCanvasProps {
  def: StudioDef;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  t: TFunction;
}

function CanvasInner({ def, selectedId, onSelect, onDelete, t }: WorkflowGraphCanvasProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const rf = useReactFlow();

  const { nodes: builtNodes, edges } = useMemo(
    () => defToGraph(def, selectedId, t, onDelete),
    [def, selectedId, t, onDelete],
  );

  // State node cục bộ để kéo mượt; đồng bộ lại từ def mỗi khi cấu trúc/chọn đổi.
  const [nodes, setNodes, onNodesChange] = useNodesState(builtNodes);
  useEffect(() => { setNodes(builtNodes); }, [builtNodes, setNodes]);

  const onNodeClick: NodeMouseHandler = useCallback((_e, node) => { onSelect(node.id); }, [onSelect]);
  const onNodesDelete = useCallback((deleted: Node[]) => { for (const n of deleted) onDelete(n.id); }, [onDelete]);

  return (
    <div ref={wrapperRef} className="h-[560px] w-full overflow-hidden rounded-md border border-border bg-muted/20">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        onNodesChange={onNodesChange}
        onNodeClick={onNodeClick}
        onNodesDelete={onNodesDelete}
        onInit={() => rf.fitView({ padding: 0.2, duration: 200 })}
        fitView
        proOptions={{ hideAttribution: true }}
        deleteKeyCode={["Backspace", "Delete"]}
        minZoom={0.2}
        maxZoom={2}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} className="!bg-transparent" />
        <MiniMap
          pannable
          zoomable
          className="!bg-card !border-border"
          nodeColor={() => "var(--primary)"}
          maskColor="color-mix(in oklch, var(--background) 70%, transparent)"
        />
        <Controls className="!border-border" />
      </ReactFlow>
    </div>
  );
}

/** View node-graph cho workflow (bọc trong ReactFlowProvider để dùng useReactFlow). */
export function WorkflowGraphCanvas(props: WorkflowGraphCanvasProps) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}

export default WorkflowGraphCanvas;
