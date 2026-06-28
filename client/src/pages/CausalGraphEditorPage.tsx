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
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { usePermissions } from "@/_core/hooks/usePermissions";
import DashboardLayout from "@/components/DashboardLayout";
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
import { Network, Plus, Pencil, Trash2, Workflow } from "lucide-react";
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

  const nodeLabel = (id: string) => nodeById.get(id)?.label ?? id;

  if (!canView) {
    return <div className="p-8 text-center text-muted-foreground">{t("common.noPermission", "Bạn không có quyền truy cập")}</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Network className="h-6 w-6" />
          {t("causalGraph.title", "Trình chỉnh sửa đồ thị nhân quả")}
        </h1>
        <p className="text-muted-foreground">
          {t("causalGraph.desc", "Quản lý đồ thị máy ↔ lỗi ↔ nguyên nhân ↔ hành động dùng cho phân tích nguyên nhân gốc")}
        </p>
      </div>

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
      <CausalGraphEditorPageContent />
    </DashboardLayout>
  );
}
