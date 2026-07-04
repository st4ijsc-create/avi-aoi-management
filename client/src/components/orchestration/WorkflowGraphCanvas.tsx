/**
 * W4-16 / U14 — NODE-GRAPH CANVAS cho Orchestration Studio (view "Sơ đồ").
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Một @xyflow/react (react-flow) canvas render `StudioDef` dưới dạng node-graph —
 * view thứ 2 BÊN CẠNH cây bước hiện có (cây vẫn là mặc định an toàn). Canvas này
 * DERIVE nodes+edges từ chính `def.steps` mỗi lần render (qua `defToGraph`), KHÔNG
 * giữ state cấu trúc riêng → cây ↔ sơ đồ luôn cùng một nguồn sự thật. Mọi thao tác
 * SỬA trên sơ đồ đều gọi NGƯỢC về đúng các helper cây (addChild / deleteStep /
 * reorderToSibling) qua callback → round-trip cây↔sơ đồ không mất mát.
 *
 * U14 — SỬA cấu trúc tối thiểu trên sơ đồ (parity một phần với IR canvas):
 *   • THÊM bước: bấm chip palette → thêm ở cấp cao nhất; HOẶC kéo chip palette thả
 *     lên một node container (sequence/parallel → steps, branch → then/else) để lồng
 *     vào đúng slot (thả lên chip slot chỉ đích danh nhánh).
 *   • SẮP LẠI thứ tự anh-em: kéo cạnh `next` từ node này tới node anh-em kia (onConnect).
 *   • XOÁ node: nút thùng rác trên node hoặc phím Delete/Backspace.
 *   • Kéo node chỉ sắp xếp trực quan trong phiên (StudioStep không lưu toạ độ) —
 *     thêm/xoá/sắp lại sẽ tính lại layout deterministic.
 *
 *   • node ← một StudioStep (đệ quy mọi cấp lồng). Hiện icon + nhãn + tóm tắt + id.
 *   • edge ← luồng điều khiển: `next` tuần tự giữa các anh-em; container
 *            (sequence/parallel) → con đầu của steps; branch → con đầu của
 *            then (nhãn "then") / else (nhãn "else").
 *
 * Chỉ dùng semantic tokens (dark-first). Không hex thô.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { useCallback, useEffect, useMemo, useRef, type DragEvent } from "react";
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
  type Connection,
  type NodeMouseHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  Terminal, ListOrdered, Layers, GitBranch, Hourglass, Activity, HandMetal, Timer, Trash2, CornerDownRight,
} from "lucide-react";
import { STEP_META, STEP_KINDS, type StudioStep, type StudioDef, type StepKind } from "./workflowTypes";

// Slot con của một container (mirror tham số addChild ở page).
type WfSlot = "steps" | "then" | "else";
/** MIME dataTransfer palette đặt để pane nhận loại bước được kéo-thả. */
export const WF_DND_MIME = "application/x-wf-step-kind";
/** Attribute pane đọc để định tuyến drop vào đúng slot của container. */
const SLOT_ATTR = "data-wf-slot";

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

/** Nhãn người-đọc cho một slot. */
function slotLabelText(slot: WfSlot, t: TFunction): string {
  return slot === "then" ? t("studio.branchThen", "If true (then)")
    : slot === "else" ? t("studio.branchElse", "If false (else)")
      : t("studio.slotSteps", "Steps");
}

/** container? (có slot con để lồng bước). */
function isContainer(step: StudioStep): boolean {
  return step.type === "sequence" || step.type === "parallel" || step.type === "branch";
}
/** Slot mặc định khi thả vào thân container (không nhắm chip slot cụ thể). */
function defaultSlotOf(step: StudioStep): WfSlot | null {
  if (step.type === "sequence" || step.type === "parallel") return "steps";
  if (step.type === "branch") return "then";
  return null;
}
/** Các slot con của một bước container (kèm nhãn + số con) → render thành chip drop. */
function childSlotsOf(step: StudioStep, t: TFunction): Array<{ slot: WfSlot; label: string; count: number }> {
  if (step.type === "sequence" || step.type === "parallel") {
    return [{ slot: "steps", label: slotLabelText("steps", t), count: (step.steps ?? []).length }];
  }
  if (step.type === "branch") {
    return [
      { slot: "then", label: slotLabelText("then", t), count: (step.then ?? []).length },
      { slot: "else", label: slotLabelText("else", t), count: (step.else ?? []).length },
    ];
  }
  return [];
}

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

/** Các danh sách con của một bước container (giống StepBlock ở page) — dùng để layout + cạnh. */
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
  slots: Array<{ slot: WfSlot; label: string; count: number }>;
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
        data: { step, selected: selectedId === id, slotLabel, slots: childSlotsOf(step, t), t, onDelete },
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
  const { step, selected, slotLabel, slots, t, onDelete } = data;
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

      {/* U14 — chip drop theo slot: kéo chip palette thả vào để lồng bước vào đúng nhánh
          (sequence/parallel → steps, branch → then/else). Pane đọc slot từ SLOT_ATTR. */}
      {slots.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1 border-t border-dashed border-border/70 pt-1.5">
          {slots.map((s) => (
            <span
              key={s.slot}
              {...{ [SLOT_ATTR]: s.slot }}
              className="rounded border border-dashed border-primary/40 bg-primary/5 px-1.5 py-0.5 text-[9px] text-primary transition-colors hover:bg-primary/15"
              title={t("studio.dropIntoSlot", "Drop a step here to add to this branch")}
            >
              {s.label} · {s.count}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

const NODE_TYPES: NodeTypes = { wfStep: WfStepNode };

export interface WorkflowGraphCanvasProps {
  def: StudioDef;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  /** U14 — thêm bước cấp cao nhất (bấm chip palette / thả lên canvas trống). */
  onAddTopLevel: (kind: StepKind) => void;
  /** U14 — thêm bước con vào slot của một container (thả lên node container). */
  onAddChild: (parentId: string, slot: WfSlot, kind: StepKind) => void;
  /** U14 — sắp lại thứ tự: đưa `sourceId` xuống sau `targetId` (nối cạnh giữa 2 anh-em). */
  onReorderToSibling: (sourceId: string, targetId: string) => void;
  t: TFunction;
}

/** U14 — bảng palette kéo-thả: bấm để thêm cấp cao nhất, kéo để lồng vào container. */
function GraphPalette({ onAdd, t }: { onAdd: (k: StepKind) => void; t: TFunction }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-dashed bg-muted/30 px-2 py-1.5">
      <span className="text-[11px] font-medium text-muted-foreground">{t("studio.paletteLabel", "Add step:")}</span>
      {STEP_KINDS.map((k) => {
        const Icon = STEP_ICON[k];
        const meta = STEP_META[k];
        return (
          <button
            key={k}
            type="button"
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(WF_DND_MIME, k);
              e.dataTransfer.effectAllowed = "copy";
            }}
            onClick={() => onAdd(k)}
            className="flex cursor-grab items-center gap-1 rounded border border-dashed border-primary/40 bg-primary/5 px-1.5 py-0.5 text-[11px] text-primary transition-colors hover:bg-primary/15 active:cursor-grabbing"
            title={t("studio.paletteHint", "Click to add at top level, or drag onto a container to nest")}
          >
            <Icon className="h-3.5 w-3.5" /> {t(meta.labelKey, meta.labelDefault)}
          </button>
        );
      })}
    </div>
  );
}

function CanvasInner({
  def, selectedId, onSelect, onDelete, onAddTopLevel, onAddChild, onReorderToSibling, t,
}: WorkflowGraphCanvasProps) {
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

  const onDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }, []);

  // Thả chip palette. Thứ tự phân giải (tất cả đi qua CÙNG helper cây):
  //   1. Thả lên chip slot (SLOT_ATTR) → thêm vào ĐÚNG slot đó (steps/then/else).
  //   2. Thả lên thân node container → thêm vào slot mặc định.
  //   3. Ngược lại → thêm ở cấp cao nhất.
  const onDrop = useCallback((e: DragEvent) => {
    e.preventDefault();
    const kind = e.dataTransfer.getData(WF_DND_MIME) as StepKind | "";
    if (!kind) return;

    const el = e.target as HTMLElement | null;
    const nodeEl = el?.closest<HTMLElement>("[data-id]");
    const overId = nodeEl?.getAttribute("data-id") ?? null;

    // (1) chip slot chỉ đích danh trong node?
    const slotEl = el?.closest<HTMLElement>(`[${SLOT_ATTR}]`);
    const explicitSlot = slotEl?.getAttribute(SLOT_ATTR) as WfSlot | null;
    if (overId && explicitSlot) {
      onAddChild(overId, explicitSlot, kind);
      return;
    }

    // (2) node container → slot mặc định.
    if (overId) {
      const nodeData = nodes.find((n) => n.id === overId)?.data;
      if (nodeData && isContainer(nodeData.step)) {
        const slot = defaultSlotOf(nodeData.step);
        if (slot) { onAddChild(overId, slot, kind); return; }
      }
    }

    // (3) canvas trống → cấp cao nhất.
    onAddTopLevel(kind);
  }, [nodes, onAddChild, onAddTopLevel]);

  // Nối lại cạnh `next` giữa hai node anh-em → sắp lại thứ tự trong cây.
  const onConnect = useCallback((c: Connection) => {
    if (c.source && c.target && c.source !== c.target) {
      onReorderToSibling(c.source, c.target);
    }
  }, [onReorderToSibling]);

  return (
    <div className="space-y-2">
      <GraphPalette onAdd={onAddTopLevel} t={t} />
      <div ref={wrapperRef} className="h-[520px] w-full overflow-hidden rounded-md border border-border bg-muted/20">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          onNodesChange={onNodesChange}
          onNodeClick={onNodeClick}
          onNodesDelete={onNodesDelete}
          onConnect={onConnect}
          onDrop={onDrop}
          onDragOver={onDragOver}
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
