/**
 * Doc 24 Wave-1 P2 — NODE-GRAPH IR CANVAS (drag-and-drop "kéo thả khối").
 *
 * ════════════════════════════════════════════════════════════════════════════
 * A @xyflow/react (react-flow) canvas that renders the device-program IR AST as a
 * node-graph — the platform's headline "kéo thả khối" (drag-and-drop blocks) affordance,
 * layered OVER the existing typed IR without changing its semantics.
 *
 * SINGLE SOURCE OF TRUTH: the IR `Flow` AST. This component DERIVES nodes + edges from
 * the AST every render (via `flowToGraph`) and, on every canvas edit, calls BACK into the
 * SAME pure helpers the tree view uses (`addChild` / `updateBlock` / `deleteBlock` /
 * `moveBlock` in irTree.ts). It never keeps its own block state. => tree ↔ graph is a
 * lossless round-trip (identical IR JSON), because both are renderers over one AST.
 *
 *   • node  ← one IR block (recursively, all nesting levels). Typed node component shows
 *             the block icon + label + a one-line param summary + a live lint badge
 *             (from diagsByBlock). Error nodes get a `destructive` border, warnings
 *             `warning`, selected `primary`.
 *   • edge  ← control flow: sequential `next` between siblings; `if_condition` → first
 *             block of true/false branch (labelled); `loop` → first block of its body.
 *
 * Interactions:
 *   • DRAG a palette block onto the canvas → add. Drop ONTO a container node (if/loop)
 *     appends into its default slot; drop on empty canvas appends top-level.
 *   • CLICK a node → select (drives the shared Inspector in IrEditor).
 *   • DELETE a node (node button or the react-flow delete key) → deleteBlock.
 *   • CONNECT / reconnect a `next` edge between two SIBLINGS → reorder within that list.
 *   • Pan / zoom / MiniMap / Controls / Background grid.
 *
 * Semantic tokens only (dark-first). No raw hex / palette classes.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { useCallback, useMemo, useRef, type DragEvent } from "react";
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
  type Node,
  type Edge,
  type NodeProps,
  type NodeTypes,
  type Connection,
  type NodeMouseHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Trash2, CornerDownRight } from "lucide-react";
import {
  BLOCK_ICON, BLOCK_LABEL, summarize, childSlots, getChildren, findBlock,
  isContainer, defaultSlot,
  type Flow, type IrBlock, type BlockType, type Slot,
} from "./irTree";

/** Attribute the pane reads to route a drop into a specific container slot. */
const SLOT_ATTR = "data-ir-slot";
/** Human label for a slot. */
function slotLabelText(slot: Slot, t: TFunction): string {
  return slot === "true_branch" ? t("ir.slot.true", "If true")
    : slot === "false_branch" ? t("ir.slot.false", "If false")
      : t("ir.slot.body", "Loop body");
}

// Diagnostics keyed by blockId (mirrors IrEditor's `diagsByBlock`).
export type GraphDiagnostic = { blockId: string; severity: "error" | "warn"; rule: string; message: string };

/** The dataTransfer MIME the palette sets so the pane can accept a dropped block type. */
export const IR_DND_MIME = "application/x-ir-block-type";

// ── Node data payload (what each react-flow node carries) ─────────────────────
type IrNodeData = {
  block: IrBlock;
  hasError: boolean;
  hasWarn: boolean;
  selected: boolean;
  t: TFunction;
  onDelete: (id: string) => void;
  // Which slot label this node sits under (rendered as a small ribbon) — null at top level.
  slotLabel: string | null;
  // Container child slots (with counts) → rendered as per-slot drop chips so a user can
  // drag a block DIRECTLY into true_branch / false_branch / body. Empty for leaf blocks.
  slots: Array<{ slot: Slot; label: string; count: number }>;
};

// ── Layout ────────────────────────────────────────────────────────────────────
// Deterministic depth-first layout: a vertical lane per list, children indented to the
// right under their container. Returns a bounding height so the parent lane can resume
// below a container's full subtree.
const NODE_W = 220;
const NODE_H = 84;
const V_GAP = 34; // vertical gap between stacked nodes
const H_INDENT = 300; // horizontal indent per nesting level / branch column

type Built = { nodes: Node<IrNodeData>[]; edges: Edge[] };

/**
 * Convert an IR Flow → react-flow nodes + edges. PURE. `selectedId` + `diagsByBlock`
 * only affect presentation (border tone + lint badge), never structure.
 */
export function flowToGraph(
  flow: Flow,
  selectedId: string | null,
  diagsByBlock: Map<string, GraphDiagnostic[]>,
  t: TFunction,
  onDelete: (id: string) => void,
): Built {
  const nodes: Node<IrNodeData>[] = [];
  const edges: Edge[] = [];

  // Lay a list of sibling blocks in a vertical lane at (x, yStart). Returns the y AFTER
  // the last node (so the caller can continue below). Adds sequential `next` edges.
  const layList = (
    list: IrBlock[],
    x: number,
    yStart: number,
    slotLabel: string | null,
  ): number => {
    let y = yStart;
    let prevId: string | null = null;
    for (const block of list) {
      const id = block.id ?? "?";
      const diags = block.id ? (diagsByBlock.get(block.id) ?? []) : [];
      const hasError = diags.some((d) => d.severity === "error");
      const hasWarn = !hasError && diags.some((d) => d.severity === "warn");
      const nodeSlots = childSlots(block).map((slot) => ({
        slot,
        label: slotLabelText(slot, t),
        count: getChildren(block, slot).length,
      }));
      nodes.push({
        id,
        type: "irBlock",
        position: { x, y },
        data: {
          block, hasError, hasWarn, selected: selectedId === id, t, onDelete, slotLabel,
          slots: nodeSlots,
        },
        // Enable react-flow selection sync with our own selection.
        selected: selectedId === id,
      });

      // Sequential control-flow edge from the previous sibling.
      if (prevId) {
        edges.push({
          id: `next-${prevId}-${id}`,
          source: prevId,
          target: id,
          type: "smoothstep",
          data: { kind: "next" },
        });
      }
      prevId = id;

      // Recurse into container slots to the right, then advance y past the subtree.
      const slots = childSlots(block);
      if (slots.length > 0) {
        let branchBottom = y + NODE_H; // at least the container's own box
        slots.forEach((slot, si) => {
          const children = getChildren(block, slot);
          const childX = x + H_INDENT * (si + 1);
          const label = slotLabelText(slot, t);
          // Branch edge → first child of the slot (labelled).
          const first = children[0];
          if (first?.id) {
            edges.push({
              id: `slot-${id}-${slot}-${first.id}`,
              source: id,
              target: first.id,
              type: "smoothstep",
              label,
              data: { kind: slot },
            });
          }
          const bottom = layList(children, childX, y, label);
          branchBottom = Math.max(branchBottom, bottom);
        });
        y = branchBottom + V_GAP;
      } else {
        y += NODE_H + V_GAP;
      }
    }
    return y;
  };

  layList(flow.blocks, 40, 40, null);
  return { nodes, edges };
}

// ── Typed node component ──────────────────────────────────────────────────────
function IrBlockNode({ data }: NodeProps<Node<IrNodeData>>) {
  const { block, hasError, hasWarn, selected, t, onDelete, slotLabel, slots } = data;
  const Icon = BLOCK_ICON[block.type];

  const borderTone = hasError
    ? "border-destructive ring-1 ring-destructive/40"
    : hasWarn
      ? "border-warning ring-1 ring-warning/30"
      : selected
        ? "border-primary ring-2 ring-primary"
        : "border-border hover:border-primary/50";

  const badge = hasError
    ? { cls: "bg-destructive/15 text-destructive border-destructive/30", label: t("ir.node.err", "error") }
    : hasWarn
      ? { cls: "bg-warning/15 text-warning border-warning/30", label: t("ir.node.warn", "warn") }
      : { cls: "bg-success/15 text-success border-success/30", label: t("ir.node.ok", "ok") };

  return (
    <div
      className={`relative w-[220px] rounded-md border bg-card px-2.5 py-2 text-card-foreground shadow-sm transition-colors ${borderTone}`}
    >
      {/* Top handle = incoming control flow; bottom handle = outgoing. */}
      <Handle type="target" position={Position.Top} className="!h-2 !w-2 !border-border !bg-muted-foreground" />
      <Handle type="source" position={Position.Bottom} className="!h-2 !w-2 !border-border !bg-primary" />

      {slotLabel && (
        <div className="mb-1 flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
          <CornerDownRight className="h-2.5 w-2.5" /> {slotLabel}
        </div>
      )}

      <div className="flex items-start gap-2">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-primary/10 text-primary">
          <Icon className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-xs font-medium">
              {t(BLOCK_LABEL[block.type].key, BLOCK_LABEL[block.type].def)}
            </span>
            <span className="font-mono text-[9px] text-muted-foreground">{block.id}</span>
          </div>
          <div className="truncate text-[10px] text-muted-foreground">{summarize(block, t)}</div>
        </div>
      </div>

      <div className="mt-1.5 flex items-center justify-between">
        <span className={`rounded border px-1 py-px text-[9px] font-medium ${badge.cls}`}>{badge.label}</span>
        <button
          type="button"
          className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive nodrag"
          aria-label={t("common.delete", "Delete")}
          onClick={(e) => { e.stopPropagation(); if (block.id) onDelete(block.id); }}
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>

      {/* Per-slot drop chips: drag a palette block onto one to nest into that exact slot
          (if_condition → true/false, loop → body). The pane reads the slot from SLOT_ATTR. */}
      {slots.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1 border-t border-dashed border-border/70 pt-1.5">
          {slots.map((s) => (
            <span
              key={s.slot}
              {...{ [SLOT_ATTR]: s.slot }}
              className="rounded border border-dashed border-primary/40 bg-primary/5 px-1.5 py-0.5 text-[9px] text-primary transition-colors hover:bg-primary/15"
              title={t("ir.node.dropIntoSlot", "Drop a block here to add to this branch")}
            >
              {s.label} · {s.count}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

const NODE_TYPES: NodeTypes = { irBlock: IrBlockNode };

// ── Public props ──────────────────────────────────────────────────────────────
export interface IrGraphCanvasProps {
  flow: Flow;
  selectedId: string | null;
  diagsByBlock: Map<string, GraphDiagnostic[]>;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  /** Add a top-level block of `type` (dropped on empty canvas). */
  onAddTopLevel: (type: BlockType) => void;
  /** Add a child block of `type` into a container node's slot (dropped on a container). */
  onAddChild: (parentId: string, slot: Slot, type: BlockType) => void;
  /** Reorder a block relative to a sibling by reconnecting the `next` edge. */
  onReorderToSibling: (sourceId: string, targetId: string) => void;
  t: TFunction;
}

// The inner canvas — needs to sit under a ReactFlowProvider to use useReactFlow().
function CanvasInner({
  flow, selectedId, diagsByBlock, onSelect, onDelete,
  onAddTopLevel, onAddChild, onReorderToSibling, t,
}: IrGraphCanvasProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const rf = useReactFlow();

  const { nodes, edges } = useMemo(
    () => flowToGraph(flow, selectedId, diagsByBlock, t, onDelete),
    [flow, selectedId, diagsByBlock, t, onDelete],
  );

  const onNodeClick: NodeMouseHandler = useCallback((_e, node) => {
    onSelect(node.id);
  }, [onSelect]);

  const onDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }, []);

  // Drop a palette block. Resolution order (all route through the SAME AST helpers as the
  // tree view, so the round-trip stays lossless):
  //   1. Dropped on a per-slot chip (SLOT_ATTR) → add into THAT exact slot (true/false/body).
  //   2. Dropped anywhere else on a container node → add into its default slot.
  //   3. Otherwise → append at top level.
  const onDrop = useCallback((e: DragEvent) => {
    e.preventDefault();
    const type = e.dataTransfer.getData(IR_DND_MIME) as BlockType | "";
    if (!type) return;

    const el = e.target as HTMLElement | null;
    const nodeEl = el?.closest<HTMLElement>("[data-id]");
    const overId = nodeEl?.getAttribute("data-id") ?? null;

    // (1) exact slot chip inside the node?
    const slotEl = el?.closest<HTMLElement>(`[${SLOT_ATTR}]`);
    const explicitSlot = slotEl?.getAttribute(SLOT_ATTR) as Slot | null;
    if (overId && explicitSlot) {
      onAddChild(overId, explicitSlot, type);
      return;
    }

    // (2) container node → default slot.
    if (overId) {
      const overBlock = findBlock(flow.blocks, overId);
      if (overBlock && isContainer(overBlock)) {
        const slot = defaultSlot(overBlock);
        if (slot) { onAddChild(overId, slot, type); return; }
      }
    }

    // (3) empty canvas → top level.
    onAddTopLevel(type);
  }, [flow.blocks, onAddChild, onAddTopLevel]);

  // Reconnect a `next` edge between two sibling nodes → reorder in the AST.
  const onConnect = useCallback((c: Connection) => {
    if (c.source && c.target && c.source !== c.target) {
      onReorderToSibling(c.source, c.target);
    }
  }, [onReorderToSibling]);

  // React-flow "delete key" removes selected nodes — route through the AST helper.
  const onNodesDelete = useCallback((deleted: Node[]) => {
    for (const n of deleted) onDelete(n.id);
  }, [onDelete]);

  return (
    <div ref={wrapperRef} className="h-[560px] w-full overflow-hidden rounded-md border border-border bg-muted/20">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        onNodeClick={onNodeClick}
        onNodesDelete={onNodesDelete}
        onConnect={onConnect}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onInit={() => rf.fitView({ padding: 0.2, duration: 200 })}
        fitView
        proOptions={{ hideAttribution: true }}
        className="ir-graph-canvas"
        deleteKeyCode={["Backspace", "Delete"]}
        minZoom={0.2}
        maxZoom={2}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} className="!bg-transparent" />
        <MiniMap
          pannable
          zoomable
          className="!bg-card !border-border"
          nodeColor={(n) => {
            const d = (n as Node<IrNodeData>).data;
            if (d?.hasError) return "var(--destructive)";
            if (d?.hasWarn) return "var(--warning)";
            return "var(--primary)";
          }}
          maskColor="color-mix(in oklch, var(--background) 70%, transparent)"
        />
        <Controls className="!border-border" />
      </ReactFlow>
    </div>
  );
}

/**
 * The node-graph canvas view for the IR. Wraps CanvasInner in a ReactFlowProvider so the
 * inner canvas can call useReactFlow(). Everything above the AST helpers is presentation.
 */
export function IrGraphCanvas(props: IrGraphCanvasProps) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}

export default IrGraphCanvas;
