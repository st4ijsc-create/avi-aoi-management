/**
 * ★★ AI Local Đợt 8.3 — CANVAS của Flow Studio (xyflow). Component MỚI, không đụng `orchestration/WorkflowGraphCanvas.tsx`
 * (FOE) — chỉ học cách repo dùng xyflow (provider + `screenToFlowPosition` cho thả từ bảng bên, `colorMode` theo theme).
 *
 * Nguồn sự thật DUY NHẤT là `FlowDefinition` (node theo id, nối theo id + cổng): node/cạnh xyflow SUY ra từ nó mỗi lần
 * render; mọi thao tác (kéo ⇒ `position`, nối ⇒ `connections`, xoá) gọi ngược `onChange(def)`. Cổng vào/ra của mỗi node lấy
 * từ `danhMucNode` (`congVao`/`congRa`) ⇒ chỉ nối được cổng có thật. `trangThai` (nodeId ⇒ trạng thái bước) tô viền node
 * theo lượt đang xem.
 */
import { memo, useCallback, useEffect, useMemo, useRef, type DragEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  ReactFlow, ReactFlowProvider, Background, BackgroundVariant, Controls, Handle, Position, useReactFlow,
  type Node, type Edge, type NodeProps, type NodeTypes, type Connection, type NodeChange, type EdgeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { FlowDefinition } from "@shared/flow/model";
import { useResolvedTheme } from "@/contexts/ThemeContext";
import { MAU_HANG, MAU_TRANG_THAI, taoNutMoi, type KhaiBaoNutClient } from "@/lib/flowStudio";

export const KIEU_KEO_NUT = "application/x-flow-node";

interface DuLieuNut extends Record<string, unknown> {
  ten: string;
  type: string;
  kb: KhaiBaoNutClient | undefined;
  trangThai: string | undefined;
  tat: boolean;
  nhanHang: string;
  nhanTrangThai: string;
}

const NutLuong = memo(function NutLuong({ data, selected }: NodeProps<Node<DuLieuNut>>) {
  const vao = data.kb?.congVao ?? ["main"];
  const ra = data.kb?.congRa ?? ["main"];
  const mauTT = data.trangThai ? MAU_TRANG_THAI[data.trangThai] : undefined;
  const cao = Math.max(vao.length, ra.length, 1);
  return (
    <div
      data-testid={`flow-node-${data.ten}`}
      className={`rounded-md border-2 bg-card text-card-foreground shadow-sm px-3 py-2 min-w-[180px] max-w-[240px] ${
        selected ? "ring-2 ring-primary" : ""
      } ${mauTT ? mauTT.split(" ").filter((c) => c.startsWith("border-")).join(" ") : "border-border"} ${data.tat ? "opacity-50" : ""}`}
      style={{ minHeight: 28 + cao * 18 }}
    >
      <div className="text-sm font-medium truncate" title={data.ten}>{data.ten}</div>
      <div className="text-[11px] text-muted-foreground font-mono truncate">{data.type}</div>
      <div className="mt-1 flex flex-wrap gap-1">
        {data.kb && <span className={`text-[10px] px-1 rounded border ${MAU_HANG[data.kb.tacDungPhu]}`}>{data.nhanHang}</span>}
        {data.trangThai && <span className={`text-[10px] px-1 rounded border ${mauTT ?? ""}`}>{data.nhanTrangThai}</span>}
      </div>
      {vao.map((c, i) => (
        <Handle key={`in-${c}`} id={c} type="target" position={Position.Left} style={{ top: `${((i + 1) / (vao.length + 1)) * 100}%` }} title={c} />
      ))}
      {ra.map((c, i) => (
        <div key={`out-${c}`}>
          <Handle id={c} type="source" position={Position.Right} style={{ top: `${((i + 1) / (ra.length + 1)) * 100}%` }} title={c} />
          {ra.length > 1 && (
            <span
              className="absolute right-2 text-[9px] text-muted-foreground -translate-y-1/2 pointer-events-none"
              style={{ top: `${((i + 1) / (ra.length + 1)) * 100}%` }}
            >
              {c}
            </span>
          )}
        </div>
      ))}
    </div>
  );
});

const KIEU_NUT: NodeTypes = { nut: NutLuong };

export interface FlowCanvasProps {
  def: FlowDefinition;
  danhMuc: ReadonlyMap<string, KhaiBaoNutClient>;
  onChange: (def: FlowDefinition) => void;
  chon: string | null;
  onChon: (id: string | null) => void;
  trangThai?: Record<string, string>;
  /** Tăng số này ⇒ canvas khớp khung nhìn (sau khi thêm node từ bảng bên). */
  khop?: number;
}

function NoiDungCanvas({ def, danhMuc, onChange, chon, onChon, trangThai, khop }: FlowCanvasProps) {
  const { t } = useTranslation();
  const colorMode = useResolvedTheme();
  const rf = useReactFlow();
  const vo = useRef<HTMLDivElement>(null);
  const defRef = useRef(def);
  defRef.current = def;
  useEffect(() => {
    if (!khop) return;
    const h = requestAnimationFrame(() => void rf.fitView({ padding: 0.25, maxZoom: 1.1, duration: 200 }));
    return () => cancelAnimationFrame(h);
  }, [khop, rf]);

  const nodes = useMemo<Node<DuLieuNut>[]>(
    () =>
      def.nodes.map((n) => {
        const kb = danhMuc.get(n.type);
        const tt = trangThai?.[n.id];
        return {
          id: n.id,
          type: "nut",
          position: { x: n.position[0], y: n.position[1] },
          selected: n.id === chon,
          data: {
            ten: n.name,
            type: n.type,
            kb,
            trangThai: tt,
            tat: n.disabled === true,
            nhanHang: kb ? t(`flowStudio.hang.${kb.tacDungPhu}`) : "",
            nhanTrangThai: tt ? t(`flowStudio.trangThai.${tt}`, { defaultValue: tt }) : "",
          },
        };
      }),
    [def.nodes, danhMuc, trangThai, chon, t],
  );

  const edges = useMemo<Edge[]>(
    () =>
      def.connections.map((c) => ({
        id: `${c.from.node}:${c.from.port}->${c.to.node}:${c.to.port}`,
        source: c.from.node,
        sourceHandle: c.from.port,
        target: c.to.node,
        targetHandle: c.to.port,
        // nhan cong ra da hien canh node nguon — khong lap lai tren canh
        animated: trangThai?.[c.from.node] === "xong" && !!trangThai?.[c.to.node],
        style: {
          stroke: trangThai?.[c.from.node] === "xong" && trangThai?.[c.to.node] ? "var(--color-success)" : "var(--color-muted-foreground)",
          strokeWidth: 1.75,
        },
      })),
    [def.connections, trangThai],
  );

  const xoaNut = useCallback((ids: Set<string>) => {
    const d = defRef.current;
    onChange({
      ...d,
      nodes: d.nodes.filter((n) => !ids.has(n.id)),
      connections: d.connections.filter((c) => !ids.has(c.from.node) && !ids.has(c.to.node)),
    });
  }, [onChange]);

  const onNodesChange = useCallback((changes: NodeChange<Node<DuLieuNut>>[]) => {
    const d = defRef.current;
    const viTri = new Map<string, [number, number]>();
    const xoa = new Set<string>();
    for (const ch of changes) {
      if (ch.type === "position" && ch.position) viTri.set(ch.id, [Math.round(ch.position.x), Math.round(ch.position.y)]);
      else if (ch.type === "remove") xoa.add(ch.id);
      else if (ch.type === "select" && ch.selected) onChon(ch.id);
    }
    if (xoa.size) {
      xoaNut(xoa);
      if (chon && xoa.has(chon)) onChon(null);
      return;
    }
    if (viTri.size) onChange({ ...d, nodes: d.nodes.map((n) => (viTri.has(n.id) ? { ...n, position: viTri.get(n.id)! } : n)) });
  }, [onChange, onChon, xoaNut, chon]);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    const xoa = new Set(changes.filter((c) => c.type === "remove").map((c) => c.id));
    if (!xoa.size) return;
    const d = defRef.current;
    onChange({ ...d, connections: d.connections.filter((c) => !xoa.has(`${c.from.node}:${c.from.port}->${c.to.node}:${c.to.port}`)) });
  }, [onChange]);

  const hopLe = useCallback((c: Connection | Edge) => {
    if (!c.source || !c.target || c.source === c.target) return false;
    const d = defRef.current;
    const a = danhMuc.get(d.nodes.find((n) => n.id === c.source)?.type ?? "");
    const b = danhMuc.get(d.nodes.find((n) => n.id === c.target)?.type ?? "");
    const ra = c.sourceHandle ?? "main";
    const vao = c.targetHandle ?? "main";
    return !!a && !!b && !b.laKichHoat && a.congRa.includes(ra) && b.congVao.includes(vao);
  }, [danhMuc]);

  const onConnect = useCallback((c: Connection) => {
    if (!hopLe(c)) return;
    const d = defRef.current;
    const moi = { from: { node: c.source, port: c.sourceHandle ?? "main" }, to: { node: c.target, port: c.targetHandle ?? "main" } };
    if (d.connections.some((x) => x.from.node === moi.from.node && x.from.port === moi.from.port && x.to.node === moi.to.node && x.to.port === moi.to.port)) return;
    onChange({ ...d, connections: [...d.connections, moi] });
  }, [onChange, hopLe]);

  const onDragOver = useCallback((e: DragEvent) => {
    if (e.dataTransfer.types.includes(KIEU_KEO_NUT)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    }
  }, []);

  const onDrop = useCallback((e: DragEvent) => {
    const type = e.dataTransfer.getData(KIEU_KEO_NUT);
    const kb = type ? danhMuc.get(type) : undefined;
    if (!kb) return;
    e.preventDefault();
    const p = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    const d = defRef.current;
    const n = taoNutMoi(kb, d.nodes.map((x) => x.id), [p.x, p.y]);
    onChange({ ...d, nodes: [...d.nodes, n] });
    onChon(n.id);
  }, [danhMuc, rf, onChange, onChon]);

  return (
    <div ref={vo} className="h-full w-full" data-testid="flow-canvas" onDragOver={onDragOver} onDrop={onDrop}>
      <ReactFlow
        colorMode={colorMode}
        nodes={nodes}
        edges={edges}
        nodeTypes={KIEU_NUT}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        isValidConnection={hopLe}
        onPaneClick={() => onChon(null)}
        deleteKeyCode={["Delete", "Backspace"]}
        fitView
        fitViewOptions={{ padding: 0.25, maxZoom: 1.1 }}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

export default function FlowCanvas(props: FlowCanvasProps) {
  return (
    <ReactFlowProvider>
      <NoiDungCanvas {...props} />
    </ReactFlowProvider>
  );
}
