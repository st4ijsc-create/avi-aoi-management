/**
 * Causal Knowledge Graph editor (route /causal-graph).
 *
 * Management UI over knowledge/causal-graph.json — the machine ↔ defect ↔ cause ↔
 * action graph the RCA copilot / auto-proposer / orchestration consume. Lists
 * nodes grouped by type with add/edit/delete, and edges (from→to + relation +
 * weight) with add/edit/delete. Edge pickers only show existing nodes, so the UI
 * keeps referential integrity; the server validates + writes atomically.
 *
 * RBAC: analytics_root_cause (view/edit/delete). Write controls hide without
 * permission.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
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
  MarkerType,
  useReactFlow,
  useNodesState,
  type Node,
  type Edge,
  type NodeProps,
  type NodeTypes,
  type NodeMouseHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { trpc } from "@/lib/trpc";
import { usePermissions } from "@/_core/hooks/usePermissions";
import DashboardLayout from "@/components/DashboardLayout";
import { PageHeader, PageContainer } from "@/components/patterns";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Network, Plus, Pencil, Trash2, Workflow,
  Cpu, AlertTriangle, Search, Wrench,
} from "lucide-react";
import { toast } from "sonner";

type NodeType = "machine" | "defect" | "cause" | "action";
type EdgeType =
  | "machine_exhibits"
  | "defect_caused_by"
  | "cause_resolved_by"
  | "cause_prevented_by";

interface GNode { id: string; type: NodeType; label: string; aliases?: string[] }
interface GEdge { from: string; to: string; type: EdgeType; weight?: number }

const NODE_TYPES: NodeType[] = ["machine", "defect", "cause", "action"];
const EDGE_TYPES: EdgeType[] = [
  "machine_exhibits",
  "defect_caused_by",
  "cause_resolved_by",
  "cause_prevented_by",
];

// ════════════════════════════════════════════════════════════════════════════
// Node-graph canvas (@xyflow/react) — RENDERS the causal graph as a directed
// node-link diagram, the page's primary visualization alongside the existing
// grouped-node cards + edge table (which stay as the accessible fallback).
//
// The canvas DERIVES its nodes+edges from the SAME `causalGraph.getGraph` data
// the cards/table use (via `causalToGraph`), so it never holds its own graph
// state. Idiom (imports, CSS import, node/edge typing, Background/Controls/
// MiniMap, fit-view) mirrors WorkflowGraphCanvas / IrGraphCanvas. Semantic
// tokens only — light/dark safe, no raw hex.
// ════════════════════════════════════════════════════════════════════════════

// Layered layout: one column per node type (machine → defect → cause → action,
// the natural causal flow), nodes stacked vertically within their column.
const COL_W = 280;
const ROW_H = 96;
const X0 = 40;
const Y0 = 40;

// Per-type icon + semantic tone (no hex — primary/destructive/warning/success).
const NODE_TONE: Record<NodeType, { icon: typeof Cpu; cls: string }> = {
  machine: { icon: Cpu, cls: "bg-primary/10 text-primary" },
  defect: { icon: AlertTriangle, cls: "bg-destructive/10 text-destructive" },
  cause: { icon: Search, cls: "bg-warning/10 text-warning" },
  action: { icon: Wrench, cls: "bg-success/10 text-success" },
};

type CNodeData = {
  node: GNode;
  canEdit: boolean;
  canDelete: boolean;
  onEdit: (n: GNode) => void;
  onDelete: (n: GNode) => void;
  t: TFunction;
};

type CausalBuilt = { nodes: Node<CNodeData>[]; edges: Edge[] };

/** Causal graph data → react-flow nodes + edges. PURE. */
function causalToGraph(
  nodes: GNode[],
  edges: GEdge[],
  selectedId: string | null,
  canEdit: boolean,
  canDelete: boolean,
  onEdit: (n: GNode) => void,
  onDelete: (n: GNode) => void,
  t: TFunction,
): CausalBuilt {
  const perType: Record<NodeType, number> = { machine: 0, defect: 0, cause: 0, action: 0 };
  const rfNodes: Node<CNodeData>[] = nodes.map((n) => {
    const col = NODE_TYPES.indexOf(n.type);
    const row = perType[n.type]++;
    return {
      id: n.id,
      type: "causalNode",
      position: { x: X0 + Math.max(col, 0) * COL_W, y: Y0 + row * ROW_H },
      data: { node: n, canEdit, canDelete, onEdit, onDelete, t },
      selected: selectedId === n.id,
    };
  });

  const known = new Set(nodes.map((n) => n.id));
  const rfEdges: Edge[] = edges
    .filter((e) => known.has(e.from) && known.has(e.to))
    .map((e, i) => {
      const w = typeof e.weight === "number" ? Math.min(Math.max(e.weight, 0), 1) : 0.5;
      return {
        id: `${e.from}|${e.to}|${e.type}|${i}`,
        source: e.from,
        target: e.to,
        type: "smoothstep",
        // Edge thickness reflects causal strength (weight).
        style: { stroke: "var(--primary)", strokeWidth: 1 + w * 3 },
        markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: "var(--primary)" },
        label: typeof e.weight === "number" ? e.weight.toFixed(2) : undefined,
        labelStyle: { fill: "var(--muted-foreground)", fontSize: 10 },
        labelBgStyle: { fill: "var(--card)" },
        labelBgPadding: [3, 1] as [number, number],
        data: { kind: e.type },
      };
    });

  return { nodes: rfNodes, edges: rfEdges };
}

/** Typed node component — icon + label + id, with edit/delete actions (permission-gated). */
function CausalNode({ data }: NodeProps<Node<CNodeData>>) {
  const { node, canEdit, canDelete, onEdit, onDelete, t } = data;
  const tone = NODE_TONE[node.type];
  const Icon = tone.icon;
  return (
    <div className="relative w-[210px] rounded-md border border-border bg-card px-2.5 py-2 text-card-foreground shadow-sm transition-colors hover:border-primary/50">
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-border !bg-muted-foreground" />
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-border !bg-primary" />

      <div className="flex items-start gap-2">
        <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded ${tone.cls}`}>
          <Icon className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-medium">{node.label}</div>
          <div className="truncate font-mono text-[9px] text-muted-foreground">{node.id}</div>
        </div>
      </div>

      <div className="mt-1.5 flex items-center justify-between border-t border-dashed border-border/70 pt-1.5">
        <span className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
          {t(`causalGraph.nodeType.${node.type}`, node.type)}
        </span>
        {(canEdit || canDelete) && (
          <div className="flex items-center gap-1">
            {canEdit && (
              <button
                type="button"
                className="nodrag rounded p-0.5 text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary"
                aria-label={t("common.edit", "Sửa")}
                onClick={(e) => { e.stopPropagation(); onEdit(node); }}
              >
                <Pencil className="h-3 w-3" />
              </button>
            )}
            {canDelete && (
              <button
                type="button"
                className="nodrag rounded p-0.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                aria-label={t("common.delete", "Xoá")}
                onClick={(e) => { e.stopPropagation(); onDelete(node); }}
              >
                <Trash2 className="h-3 w-3" />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const CAUSAL_NODE_TYPES: NodeTypes = { causalNode: CausalNode };

interface CausalGraphCanvasProps {
  nodes: GNode[];
  edges: GEdge[];
  selectedId: string | null;
  canEdit: boolean;
  canDelete: boolean;
  onSelect: (id: string) => void;
  onEdit: (n: GNode) => void;
  onDelete: (n: GNode) => void;
  t: TFunction;
}

function CausalCanvasInner({
  nodes: gNodes, edges: gEdges, selectedId, canEdit, canDelete, onSelect, onEdit, onDelete, t,
}: CausalGraphCanvasProps) {
  const rf = useReactFlow();

  const { nodes: builtNodes, edges } = useMemo(
    () => causalToGraph(gNodes, gEdges, selectedId, canEdit, canDelete, onEdit, onDelete, t),
    [gNodes, gEdges, selectedId, canEdit, canDelete, onEdit, onDelete, t],
  );

  // Local node state for smooth dragging; re-sync from data whenever it changes.
  const [nodes, setNodes, onNodesChange] = useNodesState(builtNodes);
  useEffect(() => { setNodes(builtNodes); }, [builtNodes, setNodes]);

  const onNodeClick: NodeMouseHandler = useCallback((_e, node) => { onSelect(node.id); }, [onSelect]);

  return (
    <div
      className="h-[520px] w-full overflow-hidden rounded-md border border-border bg-muted/20"
      role="application"
      aria-label={t("causalGraph.canvasAria", "Sơ đồ nhân quả: máy, lỗi, nguyên nhân và hành động cùng các quan hệ có hướng")}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={CAUSAL_NODE_TYPES}
        onNodesChange={onNodesChange}
        onNodeClick={onNodeClick}
        onInit={() => rf.fitView({ padding: 0.2, duration: 200 })}
        fitView
        proOptions={{ hideAttribution: true }}
        minZoom={0.2}
        maxZoom={2}
        nodesConnectable={false}
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

/** Node-graph view of the causal graph (wrapped in ReactFlowProvider for useReactFlow). */
function CausalGraphCanvas(props: CausalGraphCanvasProps) {
  return (
    <ReactFlowProvider>
      <CausalCanvasInner {...props} />
    </ReactFlowProvider>
  );
}

export function CausalGraphEditorPageContent() {
  const { t } = useTranslation();
  const { hasPermission } = usePermissions();
  const canView = hasPermission("analytics_root_cause", "canView");
  const canEdit = hasPermission("analytics_root_cause", "canEdit");
  const canDelete = hasPermission("analytics_root_cause", "canDelete");

  const utils = trpc.useUtils();
  const graphQ = trpc.causalGraph.getGraph.useQuery(undefined, { enabled: canView });
  const nodes: GNode[] = (graphQ.data?.nodes as GNode[]) ?? [];
  const edges: GEdge[] = (graphQ.data?.edges as GEdge[]) ?? [];
  const invalidate = () => void utils.causalGraph.getGraph.invalidate();

  const nodeById = useMemo(() => {
    const m = new Map<string, GNode>();
    for (const n of nodes) m.set(n.id, n);
    return m;
  }, [nodes]);

  const onErr = (e: { message?: string }) =>
    toast.error(e?.message || t("causalGraph.toastError", "Thao tác thất bại"));
  const onOk = () => { invalidate(); toast.success(t("causalGraph.toastSaved", "Đã lưu đồ thị nhân quả")); };

  // ── Node mutations ──
  const addNodeM = trpc.causalGraph.addNode.useMutation({ onSuccess: () => { onOk(); setNodeOpen(false); }, onError: onErr });
  const updateNodeM = trpc.causalGraph.updateNode.useMutation({ onSuccess: () => { onOk(); setNodeOpen(false); }, onError: onErr });
  const deleteNodeM = trpc.causalGraph.deleteNode.useMutation({ onSuccess: () => { onOk(); setDeleteNode(null); }, onError: onErr });

  // ── Edge mutations ──
  const addEdgeM = trpc.causalGraph.addEdge.useMutation({ onSuccess: () => { onOk(); setEdgeOpen(false); }, onError: onErr });
  const updateEdgeM = trpc.causalGraph.updateEdge.useMutation({ onSuccess: () => { onOk(); setEdgeOpen(false); }, onError: onErr });
  const deleteEdgeM = trpc.causalGraph.deleteEdge.useMutation({ onSuccess: () => { onOk(); setDeleteEdge(null); }, onError: onErr });

  // ── Node dialog state ──
  const [nodeOpen, setNodeOpen] = useState(false);
  const [editingNode, setEditingNode] = useState<GNode | null>(null);
  const [nId, setNId] = useState("");
  const [nType, setNType] = useState<NodeType>("defect");
  const [nLabel, setNLabel] = useState("");
  const [nAliases, setNAliases] = useState("");
  const [deleteNode, setDeleteNode] = useState<GNode | null>(null);

  const openNewNode = (type: NodeType) => {
    setEditingNode(null);
    setNId(""); setNType(type); setNLabel(""); setNAliases("");
    setNodeOpen(true);
  };
  const openEditNode = (n: GNode) => {
    setEditingNode(n);
    setNId(n.id); setNType(n.type); setNLabel(n.label); setNAliases((n.aliases ?? []).join(", "));
    setNodeOpen(true);
  };
  const submitNode = () => {
    const aliases = nAliases.split(",").map((s) => s.trim()).filter(Boolean);
    if (editingNode) {
      updateNodeM.mutate({
        id: editingNode.id,
        newId: nId.trim() !== editingNode.id ? nId.trim() : undefined,
        type: nType,
        label: nLabel.trim(),
        aliases,
      });
    } else {
      addNodeM.mutate({ id: nId.trim(), type: nType, label: nLabel.trim(), aliases });
    }
  };

  // ── Edge dialog state ──
  const [edgeOpen, setEdgeOpen] = useState(false);
  const [editingEdge, setEditingEdge] = useState<GEdge | null>(null);
  const [eFrom, setEFrom] = useState("");
  const [eTo, setETo] = useState("");
  const [eType, setEType] = useState<EdgeType>("defect_caused_by");
  const [eWeight, setEWeight] = useState("0.5");
  const [deleteEdge, setDeleteEdge] = useState<GEdge | null>(null);

  const openNewEdge = () => {
    setEditingEdge(null);
    setEFrom(""); setETo(""); setEType("defect_caused_by"); setEWeight("0.5");
    setEdgeOpen(true);
  };
  const openEditEdge = (e: GEdge) => {
    setEditingEdge(e);
    setEFrom(e.from); setETo(e.to); setEType(e.type); setEWeight(String(e.weight ?? 0.5));
    setEdgeOpen(true);
  };
  const submitEdge = () => {
    const weight = eWeight.trim() === "" ? undefined : Number(eWeight);
    if (editingEdge) {
      updateEdgeM.mutate({
        match: { from: editingEdge.from, to: editingEdge.to, type: editingEdge.type },
        patch: { from: eFrom, to: eTo, type: eType, weight },
      });
    } else {
      addEdgeM.mutate({ from: eFrom, to: eTo, type: eType, weight });
    }
  };

  // Canvas selection (highlights the picked node; the cards/table stay as the
  // keyboard-accessible fallback for the same data).
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const nodeLabel = (id: string) => nodeById.get(id)?.label ?? id;

  if (!canView) {
    return <div className="p-8 text-center text-muted-foreground">{t("common.noPermission", "Bạn không có quyền truy cập")}</div>;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<Network className="h-6 w-6" />}
        title={t("causalGraph.title", "Trình chỉnh sửa đồ thị nhân quả")}
        description={t("causalGraph.desc", "Quản lý đồ thị máy ↔ lỗi ↔ nguyên nhân ↔ hành động dùng cho phân tích nguyên nhân gốc")}
      />

      {/* Node-link diagram — primary visualization of the SAME graph data */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <Network className="h-5 w-5" />
            {t("causalGraph.diagram", "Sơ đồ nhân quả")}
            <Badge variant="secondary">{nodes.length} · {edges.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {nodes.length === 0 ? (
            <div className="flex h-[220px] items-center justify-center text-sm text-muted-foreground">
              {t("causalGraph.noNodes", "Chưa có node")}
            </div>
          ) : (
            <CausalGraphCanvas
              nodes={nodes}
              edges={edges}
              selectedId={selectedNodeId}
              canEdit={canEdit}
              canDelete={canDelete}
              onSelect={setSelectedNodeId}
              onEdit={openEditNode}
              onDelete={setDeleteNode}
              t={t}
            />
          )}
        </CardContent>
      </Card>

      {/* Nodes grouped by type */}
      <div className="grid gap-4 md:grid-cols-2">
        {NODE_TYPES.map((type) => {
          const items = nodes.filter((n) => n.type === type);
          return (
            <Card key={type}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <CardTitle className="flex items-center gap-2 text-base">
                  {t(`causalGraph.nodeType.${type}`, type)}
                  <Badge variant="secondary">{items.length}</Badge>
                </CardTitle>
                {canEdit && (
                  <Button size="sm" variant="outline" onClick={() => openNewNode(type)}>
                    <Plus className="h-4 w-4 mr-1" /> {t("common.add", "Thêm")}
                  </Button>
                )}
              </CardHeader>
              <CardContent className="space-y-1">
                {items.length === 0 && (
                  <div className="text-sm text-muted-foreground py-2">{t("causalGraph.noNodes", "Chưa có node")}</div>
                )}
                {items.map((n) => (
                  <div key={n.id} className="flex items-center justify-between rounded-md border p-2">
                    <div className="min-w-0">
                      <div className="font-medium truncate">{n.label}</div>
                      <div className="text-xs text-muted-foreground truncate">{n.id}</div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {canEdit && (
                        <Button size="icon" variant="ghost" onClick={() => openEditNode(n)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                      )}
                      {canDelete && (
                        <Button size="icon" variant="ghost" onClick={() => setDeleteNode(n)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Edges */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <Workflow className="h-5 w-5" />
            {t("causalGraph.edges", "Quan hệ")}
            <Badge variant="secondary">{edges.length}</Badge>
          </CardTitle>
          {canEdit && (
            <Button size="sm" variant="outline" onClick={openNewEdge} disabled={nodes.length < 2}>
              <Plus className="h-4 w-4 mr-1" /> {t("common.add", "Thêm")}
            </Button>
          )}
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("causalGraph.from", "Từ")}</TableHead>
                <TableHead>{t("causalGraph.relation", "Quan hệ")}</TableHead>
                <TableHead>{t("causalGraph.to", "Đến")}</TableHead>
                <TableHead className="w-24">{t("causalGraph.weight", "Trọng số")}</TableHead>
                <TableHead className="w-24 text-right">{t("common.actions", "Thao tác")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {edges.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-6">
                    {t("causalGraph.noEdges", "Chưa có quan hệ")}
                  </TableCell>
                </TableRow>
              )}
              {edges.map((e, i) => (
                <TableRow key={`${e.from}|${e.to}|${e.type}|${i}`}>
                  <TableCell>{nodeLabel(e.from)}</TableCell>
                  <TableCell><Badge variant="outline">{t(`causalGraph.edgeType.${e.type}`, e.type)}</Badge></TableCell>
                  <TableCell>{nodeLabel(e.to)}</TableCell>
                  <TableCell>{e.weight ?? "—"}</TableCell>
                  <TableCell className="text-right">
                    {canEdit && (
                      <Button size="icon" variant="ghost" onClick={() => openEditEdge(e)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                    )}
                    {canDelete && (
                      <Button size="icon" variant="ghost" onClick={() => setDeleteEdge(e)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Node dialog */}
      <Dialog open={nodeOpen} onOpenChange={setNodeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingNode ? t("causalGraph.editNode", "Sửa node") : t("causalGraph.addNode", "Thêm node")}
            </DialogTitle>
            <DialogDescription>{t("causalGraph.nodeDialogDesc", "Định danh phải là duy nhất (vd: defect:solder_bridge)")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>{t("causalGraph.nodeId", "Định danh (id)")}</Label>
              <Input value={nId} onChange={(e) => setNId(e.target.value)} placeholder="defect:my_defect" />
            </div>
            <div className="space-y-1">
              <Label>{t("causalGraph.nodeTypeLabel", "Loại")}</Label>
              <Select value={nType} onValueChange={(v) => setNType(v as NodeType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {NODE_TYPES.map((tt) => (
                    <SelectItem key={tt} value={tt}>{t(`causalGraph.nodeType.${tt}`, tt)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>{t("causalGraph.nodeLabelField", "Nhãn")}</Label>
              <Input value={nLabel} onChange={(e) => setNLabel(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>{t("causalGraph.aliases", "Bí danh (phân tách bởi dấu phẩy)")}</Label>
              <Input value={nAliases} onChange={(e) => setNAliases(e.target.value)} placeholder="alias1, alias2" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNodeOpen(false)}>{t("common.cancel", "Huỷ")}</Button>
            <Button
              onClick={submitNode}
              disabled={!nId.trim() || !nLabel.trim() || addNodeM.isPending || updateNodeM.isPending}
            >
              {t("common.save", "Lưu")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edge dialog */}
      <Dialog open={edgeOpen} onOpenChange={setEdgeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingEdge ? t("causalGraph.editEdge", "Sửa quan hệ") : t("causalGraph.addEdge", "Thêm quan hệ")}
            </DialogTitle>
            <DialogDescription>{t("causalGraph.edgeDialogDesc", "Chỉ chọn được các node đang tồn tại")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>{t("causalGraph.from", "Từ")}</Label>
              <Select value={eFrom} onValueChange={setEFrom}>
                <SelectTrigger><SelectValue placeholder={t("causalGraph.selectNode", "Chọn node")} /></SelectTrigger>
                <SelectContent>
                  {nodes.map((n) => (
                    <SelectItem key={n.id} value={n.id}>{n.label} ({n.type})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>{t("causalGraph.relation", "Quan hệ")}</Label>
              <Select value={eType} onValueChange={(v) => setEType(v as EdgeType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {EDGE_TYPES.map((tt) => (
                    <SelectItem key={tt} value={tt}>{t(`causalGraph.edgeType.${tt}`, tt)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>{t("causalGraph.to", "Đến")}</Label>
              <Select value={eTo} onValueChange={setETo}>
                <SelectTrigger><SelectValue placeholder={t("causalGraph.selectNode", "Chọn node")} /></SelectTrigger>
                <SelectContent>
                  {nodes.map((n) => (
                    <SelectItem key={n.id} value={n.id}>{n.label} ({n.type})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>{t("causalGraph.weight", "Trọng số")} (0–1)</Label>
              <Input type="number" step="0.05" min="0" max="1" value={eWeight} onChange={(e) => setEWeight(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEdgeOpen(false)}>{t("common.cancel", "Huỷ")}</Button>
            <Button
              onClick={submitEdge}
              disabled={!eFrom || !eTo || addEdgeM.isPending || updateEdgeM.isPending}
            >
              {t("common.save", "Lưu")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete node confirm */}
      <AlertDialog open={!!deleteNode} onOpenChange={(o) => !o && setDeleteNode(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("causalGraph.deleteNodeTitle", "Xoá node?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("causalGraph.deleteNodeDesc", "Mọi quan hệ liên quan đến node này cũng sẽ bị xoá.")} {deleteNode?.label}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel", "Huỷ")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteNode && deleteNodeM.mutate({ id: deleteNode.id })}>
              {t("common.delete", "Xoá")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete edge confirm */}
      <AlertDialog open={!!deleteEdge} onOpenChange={(o) => !o && setDeleteEdge(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("causalGraph.deleteEdgeTitle", "Xoá quan hệ?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteEdge && `${nodeLabel(deleteEdge.from)} → ${nodeLabel(deleteEdge.to)}`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel", "Huỷ")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteEdge && deleteEdgeM.mutate({ from: deleteEdge.from, to: deleteEdge.to, type: deleteEdge.type })}
            >
              {t("common.delete", "Xoá")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default function CausalGraphEditorPage() {
  return (
    <DashboardLayout>
      <PageContainer>
        <CausalGraphEditorPageContent />
      </PageContainer>
    </DashboardLayout>
  );
}
