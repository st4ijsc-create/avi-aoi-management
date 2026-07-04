/**
 * Factory Floor Editor — world-class 2D floor planner (audit doc 25 · W6-25).
 *
 * A top-down plan where you place each machine at its real position. On top of the
 * baseline drag-to-place it now supports:
 *   (1) Ảnh nền CAD/ảnh + tỉ lệ mét thật (factory.floorPlanImageUrl + floorWidthM/DepthM).
 *   (2) Zones — polygon vùng vẽ được (factory_zones) + CRUD + vẽ/kéo đỉnh.
 *   (3) Zoom/pan (wheel + kéo nền) qua viewBox + undo/redo cho đặt/xoay/resize.
 *   (4) Cue máy CHƯA đặt: mờ + viền nét đứt.
 *
 * Toạ độ máy vẫn là normalized (0–1) lưu qua machine.updateLayout — cùng hệ mà bản
 * đồ 3D (/factory-live-map) đọc để dựng khối 3D. Zones cũng dùng toạ độ 0–1.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import DashboardLayout from "@/components/DashboardLayout";
import { PageContainer, PageHeader } from "@/components/patterns";
import { buildBreadcrumbs } from "@/lib/breadcrumbs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { statusColor } from "@/components/FactoryFloor3D";
import { toast } from "sonner";
import { Boxes, Info, Magnet, Save, Move, Upload, Ruler, Undo2, Redo2, ZoomIn, ZoomOut, Maximize, Shapes, Trash2, Plus, Check, X } from "lucide-react";
import { PermissionGate, ViewOnlyBadge, useCanWrite } from "@/components/PermissionGate";

interface Row {
  id: number; code: string; name: string; machineType: string;
  latestStatus: string; heartbeatStatus: string;
  line: { id: number; name: string; code: string };
  factory: { id: number; name: string; code: string };
  layoutPositionX?: number | string | null;
  layoutPositionY?: number | string | null;
  layout?: { x?: number; y?: number; rotationDeg?: number; footprintW?: number; footprintD?: number } | null;
}

interface Pt { x: number; y: number }
interface ZoneRow { id: number; factoryId: number; name: string; color: string; points: Pt[] }

const DEF_W = 1.5, DEF_D = 1.5;
interface Xform { rotationDeg: number; footprintW: number; footprintD: number }
interface Transform { pos: Pt; xform: Xform }
interface UndoAction { undo: () => void; redo: () => void }

const VB_W = 1000, VB_H = 640, PAD = 44;
const INNER_W = VB_W - 2 * PAD, INNER_H = VB_H - 2 * PAD;
const MW = 46, MH = 34; // machine rect size in viewBox units
const MIN_VW = VB_W * 0.2; // giới hạn zoom-in (viewBox nhỏ nhất)

function num(v: unknown): number { const n = typeof v === "number" ? v : parseFloat(String(v)); return Number.isFinite(n) ? n : NaN; }
function isPlaced(m: Row): boolean { const px = num(m.layoutPositionX), py = num(m.layoutPositionY); return px >= 0 && px <= 1 && py >= 0 && py <= 1; }
function toVB(p: Pt) { return { vx: PAD + p.x * INNER_W, vy: PAD + p.y * INNER_H }; }
function centroid(pts: Pt[]): Pt { if (!pts.length) return { x: 0.5, y: 0.5 }; const s = pts.reduce((a, p) => ({ x: a.x + p.x, y: a.y + p.y }), { x: 0, y: 0 }); return { x: s.x / pts.length, y: s.y / pts.length }; }

export default function FactoryFloorEditor() {
  const { t } = useTranslation();
  const [location, setLocation] = useLocation();
  // U3 (doc 26) — breadcrumb "Kỹ thuật › Section › Trang" + link về Hub.
  const crumbs = buildBreadcrumbs(location, t);
  const machinesQ = trpc.machineStatus.listWithStatus.useQuery();
  const factoriesQ = trpc.factory.list.useQuery();
  const utils = trpc.useUtils();
  const saveM = trpc.machine.updateLayout.useMutation();
  // Chỉ user có quyền machine_control/canEdit mới được ghi (kéo-thả / dims / zones)
  const { canEdit } = useCanWrite("machine_control");

  const [factoryId, setFactoryId] = useState<number | null>(null);
  const [snap, setSnap] = useState(true);
  const [pos, setPos] = useState<Record<number, Pt>>({});
  const [xform, setXform] = useState<Record<number, Xform>>({});
  const [dragId, setDragId] = useState<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // Zoom/pan — viewBox điều chỉnh được
  const [view, setView] = useState({ x: 0, y: 0, w: VB_W, h: VB_H });
  const panRef = useRef<{ cx: number; cy: number; vx: number; vy: number } | null>(null);

  // Undo/redo (đặt/xoay/resize máy)
  const [undoStack, setUndoStack] = useState<UndoAction[]>([]);
  const [redoStack, setRedoStack] = useState<UndoAction[]>([]);
  const editBefore = useRef<{ id: number; pos: Pt; xform: Xform } | null>(null);

  // Zones
  const [mode, setMode] = useState<"machines" | "zones">("machines");
  const [zones, setZones] = useState<ZoneRow[]>([]);
  const [selZone, setSelZone] = useState<number | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [draft, setDraft] = useState<Pt[]>([]);
  const vtxDrag = useRef<{ zoneId: number; idx: number } | null>(null);

  const rows = (machinesQ.data ?? []) as unknown as Row[];
  const factories = useMemo(() => (factoriesQ.data ?? []) as Array<{ id: number; name: string; floorPlanImageUrl?: string | null; floorWidthM?: string | number | null; floorDepthM?: string | number | null }>, [factoriesQ.data]);
  const activeFactoryId = factoryId ?? factories[0]?.id ?? rows[0]?.factory?.id ?? null;
  const activeFactory = useMemo(() => factories.find((f) => f.id === activeFactoryId) ?? null, [factories, activeFactoryId]);
  const machines = useMemo(() => rows.filter((r) => r.factory?.id === activeFactoryId), [rows, activeFactoryId]);

  const zonesQ = trpc.factoryZone.listByFactory.useQuery(
    { factoryId: activeFactoryId ?? 0 },
    { enabled: activeFactoryId != null },
  );

  // Mutations: nền + kích thước + zones
  const uploadFP = trpc.factory.uploadFloorPlan.useMutation({
    onSuccess: () => { toast.success(t("ffe.bgUploaded", "Đã tải ảnh nền")); void utils.factory.list.invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const dimsM = trpc.factory.updateFloorDims.useMutation({
    onSuccess: () => { toast.success(t("ffe.dimsSaved", "Đã lưu kích thước sàn")); void utils.factory.list.invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const createZone = trpc.factoryZone.create.useMutation({ onSuccess: () => void zonesQ.refetch(), onError: (e) => toast.error(e.message) });
  const updateZone = trpc.factoryZone.update.useMutation({ onSuccess: () => void zonesQ.refetch(), onError: (e) => toast.error(e.message) });
  const deleteZone = trpc.factoryZone.delete.useMutation({ onSuccess: () => void zonesQ.refetch(), onError: (e) => toast.error(e.message) });

  // Kích thước mét — input cục bộ đồng bộ theo factory đang chọn
  const [dimW, setDimW] = useState("");
  const [dimD, setDimD] = useState("");
  useEffect(() => {
    setDimW(activeFactory?.floorWidthM != null ? String(activeFactory.floorWidthM) : "");
    setDimD(activeFactory?.floorDepthM != null ? String(activeFactory.floorDepthM) : "");
  }, [activeFactory?.id, activeFactory?.floorWidthM, activeFactory?.floorDepthM]);

  // Đồng bộ zones từ server vào state cục bộ (để kéo đỉnh mượt trước khi lưu)
  useEffect(() => {
    const data = (zonesQ.data ?? []) as unknown as ZoneRow[];
    setZones(data.map((z) => ({ ...z, points: Array.isArray(z.points) ? z.points : [] })));
  }, [zonesQ.data]);

  // Reset view khi đổi nhà máy
  useEffect(() => { setView({ x: 0, y: 0, w: VB_W, h: VB_H }); setSelected(null); setSelZone(null); setDrawing(false); setDraft([]); setUndoStack([]); setRedoStack([]); }, [activeFactoryId]);

  // Khởi tạo vị trí cục bộ từ toạ độ đã lưu; máy chưa đặt xếp thành cột trái (staging)
  useEffect(() => {
    setPos((prev) => {
      const next = { ...prev };
      let stagei = 0;
      for (const m of machines) {
        if (next[m.id]) continue;
        const px = num(m.layoutPositionX), py = num(m.layoutPositionY);
        if (px >= 0 && px <= 1 && py >= 0 && py <= 1) next[m.id] = { x: px, y: py };
        else { next[m.id] = { x: 0.02, y: Math.min(0.95, 0.05 + stagei * 0.07) }; stagei++; }
      }
      return next;
    });
    setXform((prev) => {
      const next = { ...prev };
      for (const m of machines) {
        if (next[m.id]) continue;
        next[m.id] = {
          rotationDeg: num(m.layout?.rotationDeg) || 0,
          footprintW: num(m.layout?.footprintW) > 0 ? num(m.layout?.footprintW) : DEF_W,
          footprintD: num(m.layout?.footprintD) > 0 ? num(m.layout?.footprintD) : DEF_D,
        };
      }
      return next;
    });
  }, [machines]);

  // Ghi thô 1 máy (đã kiểm canEdit)
  const persistRaw = (id: number, p: Pt, x: Xform) => {
    if (!canEdit) return; // chặn ghi ở client — server cũng kiểm quyền (defense in depth)
    saveM.mutate(
      { id, x: p.x, y: p.y, rotationDeg: x.rotationDeg, footprintW: x.footprintW, footprintD: x.footprintD },
      {
        onError: () => toast.error(t("ffe.saveFailed", "Lưu vị trí thất bại")),
        onSuccess: () => { void utils.machineStatus.listWithStatus.invalidate(); },
      },
    );
  };
  // Áp dụng 1 transform vào state + ghi (dùng cho undo/redo)
  const applyTransform = (id: number, tr: Transform) => {
    setPos((prev) => ({ ...prev, [id]: tr.pos }));
    setXform((prev) => ({ ...prev, [id]: tr.xform }));
    persistRaw(id, tr.pos, tr.xform);
  };
  const pushAction = (a: UndoAction) => { setUndoStack((s) => [...s, a]); setRedoStack([]); };
  const doUndo = () => setUndoStack((s) => { if (!s.length) return s; const a = s[s.length - 1]; a.undo(); setRedoStack((r) => [...r, a]); return s.slice(0, -1); });
  const doRedo = () => setRedoStack((s) => { if (!s.length) return s; const a = s[s.length - 1]; a.redo(); setUndoStack((u) => [...u, a]); return s.slice(0, -1); });

  // Bắt đầu/kết thúc một thao tác chỉnh transform (kéo/xoay/resize) — ghi + ghi undo
  const beginEdit = (id: number) => { editBefore.current = { id, pos: pos[id], xform: xform[id] }; };
  const commitEdit = (id: number) => {
    const before = editBefore.current; editBefore.current = null;
    const after: Transform = { pos: pos[id], xform: xform[id] };
    persistRaw(id, after.pos, after.xform);
    if (!before || before.id !== id) return;
    const bp = before.pos, bx = before.xform;
    const changed = bp.x !== after.pos.x || bp.y !== after.pos.y || bx.rotationDeg !== after.xform.rotationDeg || bx.footprintW !== after.xform.footprintW || bx.footprintD !== after.xform.footprintD;
    if (!changed) return;
    const beforeT: Transform = { pos: bp, xform: bx };
    pushAction({ undo: () => applyTransform(id, beforeT), redo: () => applyTransform(id, after) });
  };
  // Đặt tức thì (nút xoay nhanh) — ghi kèm undo
  const applyInstant = (id: number, before: Transform, after: Transform) => {
    setXform((prev) => ({ ...prev, [id]: after.xform }));
    setPos((prev) => ({ ...prev, [id]: after.pos }));
    persistRaw(id, after.pos, after.xform);
    pushAction({ undo: () => applyTransform(id, before), redo: () => applyTransform(id, after) });
  };

  const lineColor = (lid: number) => `hsl(${(lid * 67) % 360} 70% 55%)`;

  // Client px → toạ độ viewBox (theo view hiện tại)
  const clientToVB = (clientX: number, clientY: number) => {
    const rect = svgRef.current!.getBoundingClientRect();
    return {
      vx: view.x + ((clientX - rect.left) / rect.width) * view.w,
      vy: view.y + ((clientY - rect.top) / rect.height) * view.h,
    };
  };
  const clientToNorm = (clientX: number, clientY: number) => {
    const { vx, vy } = clientToVB(clientX, clientY);
    let nx = (vx - PAD) / INNER_W;
    let ny = (vy - PAD) / INNER_H;
    nx = Math.max(0, Math.min(1, nx));
    ny = Math.max(0, Math.min(1, ny));
    if (snap && mode === "machines") { nx = Math.round(nx / 0.02) * 0.02; ny = Math.round(ny / 0.02) * 0.02; }
    return { x: nx, y: ny };
  };

  // Zoom quanh con trỏ (wheel native để chặn cuộn trang)
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setView((v) => {
        const rect = el.getBoundingClientRect();
        const vx = v.x + ((e.clientX - rect.left) / rect.width) * v.w;
        const vy = v.y + ((e.clientY - rect.top) / rect.height) * v.h;
        const factor = e.deltaY < 0 ? 0.88 : 1.14;
        let nw = Math.max(MIN_VW, Math.min(VB_W, v.w * factor));
        const ratio = nw / v.w;
        let nh = v.h * ratio;
        let nx = vx - (vx - v.x) * ratio;
        let ny = vy - (vy - v.y) * ratio;
        // giữ trong khung tổng
        nx = Math.max(0, Math.min(VB_W - nw, nx));
        ny = Math.max(0, Math.min(VB_H - nh, ny));
        return { x: nx, y: ny, w: nw, h: nh };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const zoomBtn = (dir: 1 | -1) => setView((v) => {
    const factor = dir > 0 ? 0.85 : 1.18;
    let nw = Math.max(MIN_VW, Math.min(VB_W, v.w * factor));
    const ratio = nw / v.w; let nh = v.h * ratio;
    const cx = v.x + v.w / 2, cy = v.y + v.h / 2;
    let nx = Math.max(0, Math.min(VB_W - nw, cx - nw / 2));
    let ny = Math.max(0, Math.min(VB_H - nh, cy - nh / 2));
    return { x: nx, y: ny, w: nw, h: nh };
  });
  const resetView = () => setView({ x: 0, y: 0, w: VB_W, h: VB_H });

  // Pan nền
  const startPan = (e: React.PointerEvent) => {
    panRef.current = { cx: e.clientX, cy: e.clientY, vx: view.x, vy: view.y };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (dragId != null && mode === "machines") {
      setPos((prev) => ({ ...prev, [dragId]: clientToNorm(e.clientX, e.clientY) }));
      return;
    }
    if (vtxDrag.current) {
      const { zoneId, idx } = vtxDrag.current;
      const np = clientToNorm(e.clientX, e.clientY);
      setZones((zs) => zs.map((z) => z.id === zoneId ? { ...z, points: z.points.map((p, i) => i === idx ? np : p) } : z));
      return;
    }
    if (panRef.current) {
      const rect = svgRef.current!.getBoundingClientRect();
      const dx = ((e.clientX - panRef.current.cx) / rect.width) * view.w;
      const dy = ((e.clientY - panRef.current.cy) / rect.height) * view.h;
      setView((v) => ({ ...v, x: Math.max(0, Math.min(VB_W - v.w, panRef.current!.vx - dx)), y: Math.max(0, Math.min(VB_H - v.h, panRef.current!.vy - dy)) }));
    }
  };
  const onPointerUp = () => {
    if (dragId != null) { const id = dragId; setDragId(null); commitEdit(id); }
    if (vtxDrag.current) { const { zoneId } = vtxDrag.current; vtxDrag.current = null; const z = zones.find((x) => x.id === zoneId); if (z && canEdit) updateZone.mutate({ id: zoneId, points: z.points }); }
    panRef.current = null;
  };

  // Thao tác trên nền (rect sàn)
  const onFloorPointerDown = (e: React.PointerEvent) => {
    if (mode === "zones" && drawing) {
      const np = clientToNorm(e.clientX, e.clientY);
      setDraft((d) => [...d, np]);
      return;
    }
    startPan(e);
  };

  const finishZone = () => {
    if (!activeFactoryId || draft.length < 3) { toast.error(t("ffe.zoneNeed3", "Cần tối thiểu 3 điểm")); return; }
    createZone.mutate({ factoryId: activeFactoryId, name: t("ffe.newZoneName", "Vùng mới"), points: draft });
    setDrawing(false); setDraft([]);
  };

  const placedCount = machines.filter(isPlaced).length;
  const wM = num(activeFactory?.floorWidthM), dM = num(activeFactory?.floorDepthM);
  const hasMeters = wM > 0 && dM > 0;

  return (
    <DashboardLayout>
      <PageContainer fluid className="space-y-4">
        <PageHeader
          breadcrumbs={crumbs}
          icon={<Move className="h-6 w-6" />}
          title={t("ffe.title", "Sửa mặt bằng nhà máy")}
          badge={<ViewOnlyBadge module="machine_control" />}
          description={t("ffe.subtitle", "Kéo từng máy về đúng vị trí thực trên sàn — toạ độ được lưu và dùng cho bản đồ 3D")}
          actions={
            <>
              <Select value={activeFactoryId ? String(activeFactoryId) : undefined} onValueChange={(v) => setFactoryId(Number(v))}>
                <SelectTrigger className="w-[200px]"><SelectValue placeholder={t("ffe.pickFactory", "Chọn nhà máy")} /></SelectTrigger>
                <SelectContent>{factories.map((f) => <SelectItem key={f.id} value={String(f.id)}>{f.name}</SelectItem>)}</SelectContent>
              </Select>
              <Button size="sm" variant={mode === "machines" ? "default" : "outline"} onClick={() => { setMode("machines"); setDrawing(false); }}><Move className="h-4 w-4 mr-1" /> {t("ffe.modeMachines", "Máy")}</Button>
              <Button size="sm" variant={mode === "zones" ? "default" : "outline"} onClick={() => { setMode("zones"); setSelected(null); }}><Shapes className="h-4 w-4 mr-1" /> {t("ffe.modeZones", "Vùng")}</Button>
              <Button size="sm" variant="outline" onClick={() => setLocation("/factory-live-map")}><Boxes className="h-4 w-4 mr-1" /> {t("ffe.view3d", "Xem 3D")}</Button>
            </>
          }
        />

        <div className="rounded-md border border-sky-300 bg-sky-50 dark:bg-sky-950/30 px-3 py-2 text-xs text-sky-800 dark:text-sky-200 flex items-start gap-2">
          <Info className="h-4 w-4 mt-0.5 shrink-0" />
          <span>
            {mode === "machines"
              ? t("ffe.note", "Máy mờ + viền nét đứt là CHƯA đặt vị trí — kéo vào sàn để gán toạ độ. Thả chuột là tự lưu. Lăn chuột để phóng to, kéo nền để di chuyển khung.")
              : t("ffe.noteZone", "Chế độ Vùng: bấm 'Vẽ vùng mới' rồi click trên sàn để thêm điểm; kéo đỉnh để chỉnh. Đọc mở, chỉnh cần quyền.")}
            {(saveM.isPending || uploadFP.isPending || dimsM.isPending) && <span className="inline-flex items-center gap-1 ml-1"><Save className="h-3 w-3 animate-pulse" /> {t("ffe.saving", "đang lưu…")}</span>}
          </span>
        </div>

        {/* Thanh công cụ: nền + tỉ lệ mét + zoom/pan + undo/redo */}
        <Card>
          <CardContent className="py-3 flex flex-wrap items-end gap-3">
            <PermissionGate module="machine_control" action="canEdit" fallback={null}>
              <div className="flex flex-col gap-1">
                <Label className="text-xs">{t("ffe.floorPlan", "Ảnh nền (CAD/ảnh)")}</Label>
                <div className="flex gap-2">
                  <Button asChild size="sm" variant="outline" className="h-8" disabled={!activeFactoryId || uploadFP.isPending} title={!activeFactoryId ? t("common.gate.selectFactory", "Chọn nhà máy trước") : undefined}>
                    <label className="cursor-pointer">
                      <Upload className="h-4 w-4 mr-1" /> {uploadFP.isPending ? t("ffe.bgUploading", "Đang tải…") : t("ffe.bgUpload", "Tải ảnh nền")}
                      <input type="file" accept="image/*" className="hidden" onChange={(e) => {
                        const file = e.target.files?.[0]; e.currentTarget.value = "";
                        if (!file || !activeFactoryId) return;
                        if (!file.type.startsWith("image/")) { toast.error(t("ffe.pickImage", "Vui lòng chọn tệp ảnh")); return; }
                        if (file.size > 8 * 1024 * 1024) { toast.error(t("ffe.maxFile8", "Tối đa 8MB")); return; }
                        const reader = new FileReader();
                        reader.onload = () => uploadFP.mutate({ id: activeFactoryId, imageData: (reader.result as string).split(",")[1], fileName: file.name, contentType: file.type });
                        reader.readAsDataURL(file);
                      }} />
                    </label>
                  </Button>
                  {activeFactory?.floorPlanImageUrl && (
                    <Button size="sm" variant="ghost" className="h-8 text-destructive" onClick={() => activeFactoryId && dimsM.mutate({ id: activeFactoryId, clearImage: true })}><X className="h-4 w-4" /></Button>
                  )}
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-xs flex items-center gap-1"><Ruler className="h-3 w-3" /> {t("ffe.floorWidthM", "Rộng sàn (m)")}</Label>
                <Input type="number" step={0.1} min={0.1} value={dimW} onChange={(e) => setDimW(e.target.value)} className="h-8 w-28" placeholder="0" />
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-xs">{t("ffe.floorDepthM", "Sâu sàn (m)")}</Label>
                <Input type="number" step={0.1} min={0.1} value={dimD} onChange={(e) => setDimD(e.target.value)} className="h-8 w-28" placeholder="0" />
              </div>
              <Button size="sm" variant="outline" className="h-8" disabled={!activeFactoryId || dimsM.isPending} title={!activeFactoryId ? t("common.gate.selectFactory", "Chọn nhà máy trước") : undefined} onClick={() => {
                if (!activeFactoryId) return;
                const w = parseFloat(dimW), d = parseFloat(dimD);
                dimsM.mutate({ id: activeFactoryId, floorWidthM: Number.isFinite(w) && w > 0 ? w : undefined, floorDepthM: Number.isFinite(d) && d > 0 ? d : undefined });
              }}><Save className="h-4 w-4 mr-1" /> {t("ffe.saveDims", "Lưu kích thước")}</Button>
            </PermissionGate>

            <div className="ml-auto flex items-end gap-1">
              <Button size="sm" variant={snap ? "default" : "outline"} className="h-8" onClick={() => setSnap((s) => !s)}><Magnet className="h-4 w-4 mr-1" /> {t("ffe.snap", "Bắt lưới")}</Button>
              <Button size="sm" variant="outline" className="h-8 px-2" title={t("ffe.undo", "Hoàn tác")} disabled={!undoStack.length} onClick={doUndo}><Undo2 className="h-4 w-4" /></Button>
              <Button size="sm" variant="outline" className="h-8 px-2" title={t("ffe.redo", "Làm lại")} disabled={!redoStack.length} onClick={doRedo}><Redo2 className="h-4 w-4" /></Button>
              <Button size="sm" variant="outline" className="h-8 px-2" title={t("ffe.zoomIn", "Phóng to")} onClick={() => zoomBtn(1)}><ZoomIn className="h-4 w-4" /></Button>
              <Button size="sm" variant="outline" className="h-8 px-2" title={t("ffe.zoomOut", "Thu nhỏ")} onClick={() => zoomBtn(-1)}><ZoomOut className="h-4 w-4" /></Button>
              <Button size="sm" variant="outline" className="h-8 px-2" title={t("ffe.resetView", "Khung mặc định")} onClick={resetView}><Maximize className="h-4 w-4" /></Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Boxes className="h-4 w-4" /> {activeFactory?.name ?? machines[0]?.factory?.name ?? ""} — {placedCount}/{machines.length} {t("ffe.placed", "máy đã đặt")}{hasMeters && <span className="text-xs text-muted-foreground font-normal">· {wM}×{dM} m</span>}</CardTitle></CardHeader>
          <CardContent>
            {machinesQ.isLoading ? (
              <div className="h-40 flex items-center justify-center text-sm text-muted-foreground">{t("common.loading", "Đang tải…")}</div>
            ) : machinesQ.isError ? (
              <div className="h-40 flex items-center justify-center text-sm text-destructive">{t("common.error", "Đã xảy ra lỗi")}</div>
            ) : machines.length === 0 ? (
              <div className="h-40 flex items-center justify-center text-sm text-muted-foreground">{t("ffe.empty", "Nhà máy này chưa có máy nào")}</div>
            ) : (
            <svg
              ref={svgRef}
              viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
              className="w-full rounded-md bg-slate-50 dark:bg-slate-900 border select-none"
              style={{ touchAction: "none", cursor: panRef.current ? "grabbing" : "default" }}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerLeave={onPointerUp}
            >
              {/* floor background rect (bắt pan / vẽ điểm) */}
              <rect x={PAD} y={PAD} width={INNER_W} height={INNER_H} rx={6} className="fill-white dark:fill-slate-950 stroke-slate-300 dark:stroke-slate-700"
                onPointerDown={onFloorPointerDown}
                style={{ cursor: mode === "zones" && drawing ? "crosshair" : "grab" }}
              />
              {/* ảnh nền CAD/ảnh (nếu có) */}
              {activeFactory?.floorPlanImageUrl && (
                <image href={activeFactory.floorPlanImageUrl} x={PAD} y={PAD} width={INNER_W} height={INNER_H} preserveAspectRatio="none" opacity={0.85} style={{ pointerEvents: "none" }} />
              )}
              {/* grid + nhãn mét */}
              {Array.from({ length: 11 }).map((_, i) => (
                <g key={i}>
                  <line x1={PAD + (INNER_W / 10) * i} y1={PAD} x2={PAD + (INNER_W / 10) * i} y2={PAD + INNER_H} className="stroke-slate-200 dark:stroke-slate-800" strokeWidth={1} style={{ pointerEvents: "none" }} />
                  <line x1={PAD} y1={PAD + (INNER_H / 10) * i} x2={PAD + INNER_W} y2={PAD + (INNER_H / 10) * i} className="stroke-slate-200 dark:stroke-slate-800" strokeWidth={1} style={{ pointerEvents: "none" }} />
                  {hasMeters && i % 2 === 0 && (
                    <>
                      <text x={PAD + (INNER_W / 10) * i} y={PAD - 4} textAnchor="middle" className="fill-slate-400 text-[9px]" style={{ pointerEvents: "none" }}>{(wM * i / 10).toFixed(0)}</text>
                      <text x={PAD - 6} y={PAD + (INNER_H / 10) * i + 3} textAnchor="end" className="fill-slate-400 text-[9px]" style={{ pointerEvents: "none" }}>{(dM * i / 10).toFixed(0)}</text>
                    </>
                  )}
                </g>
              ))}
              <text x={PAD + 4} y={PAD - 14} className="fill-slate-400 text-[12px]" style={{ pointerEvents: "none" }}>{hasMeters ? t("ffe.floorMeters", "Sàn nhà máy (mét, nhìn từ trên)") : t("ffe.floor", "Sàn nhà máy (nhìn từ trên)")}</text>

              {/* Zones */}
              {zones.map((z) => {
                if (!z.points.length) return null;
                const poly = z.points.map((p) => { const { vx, vy } = toVB(p); return `${vx},${vy}`; }).join(" ");
                const c = centroid(z.points); const cc = toVB(c);
                const isSelZ = selZone === z.id;
                return (
                  <g key={z.id} onPointerDown={(e) => { if (mode === "zones") { e.stopPropagation(); setSelZone(z.id); } }} style={{ cursor: mode === "zones" ? "pointer" : "default" }}>
                    <polygon points={poly} fill={z.color} fillOpacity={0.14} stroke={z.color} strokeWidth={isSelZ ? 3 : 2} strokeDasharray={isSelZ ? "" : "6 4"} />
                    <text x={cc.vx} y={cc.vy} textAnchor="middle" className="text-[11px] font-medium" fill={z.color} style={{ pointerEvents: "none" }}>{z.name}</text>
                    {/* đỉnh kéo được (chỉ khi chọn + zones mode + canEdit) */}
                    {mode === "zones" && isSelZ && canEdit && z.points.map((p, i) => { const { vx, vy } = toVB(p); return (
                      <circle key={i} cx={vx} cy={vy} r={5} fill="#fff" stroke={z.color} strokeWidth={2}
                        style={{ cursor: "grab" }}
                        onPointerDown={(e) => { e.stopPropagation(); (e.target as Element).setPointerCapture?.(e.pointerId); vtxDrag.current = { zoneId: z.id, idx: i }; }}
                      />
                    ); })}
                  </g>
                );
              })}

              {/* Draft polygon đang vẽ */}
              {mode === "zones" && draft.length > 0 && (
                <g style={{ pointerEvents: "none" }}>
                  <polyline points={draft.map((p) => { const { vx, vy } = toVB(p); return `${vx},${vy}`; }).join(" ")} fill="rgba(14,165,233,0.12)" stroke="#0ea5e9" strokeWidth={2} strokeDasharray="4 3" />
                  {draft.map((p, i) => { const { vx, vy } = toVB(p); return <circle key={i} cx={vx} cy={vy} r={4} fill="#0ea5e9" />; })}
                </g>
              )}

              {machines.map((m) => {
                const p = pos[m.id] ?? { x: 0.02, y: 0.05 };
                const xf = xform[m.id] ?? { rotationDeg: 0, footprintW: DEF_W, footprintD: DEF_D };
                const { vx: cx, vy: cy } = toVB(p);
                const rw = MW * (xf.footprintW / DEF_W), rh = MH * (xf.footprintD / DEF_D);
                const isSel = selected === m.id;
                const placed = isPlaced(m); // (4) cue máy chưa đặt
                const interactive = mode === "machines";
                return (
                  <g
                    key={m.id}
                    transform={`translate(${cx}, ${cy}) rotate(${xf.rotationDeg})`}
                    style={{ cursor: !interactive ? "default" : !canEdit ? "pointer" : dragId === m.id ? "grabbing" : "grab", opacity: placed ? 1 : 0.4 }}
                    onPointerDown={(e) => {
                      if (!interactive) return;
                      e.stopPropagation();
                      setSelected(m.id);
                      if (!canEdit) return; // read-only: chỉ chọn để xem, không kéo
                      (e.target as Element).setPointerCapture?.(e.pointerId);
                      beginEdit(m.id);
                      setDragId(m.id);
                    }}
                  >
                    <rect x={-rw / 2} y={-rh / 2} width={rw} height={rh} rx={4} fill={statusColor(m)} stroke={isSel ? "#06b6d4" : lineColor(m.line.id)} strokeWidth={isSel ? 3 : 2.5} strokeDasharray={placed ? "" : "5 3"} opacity={0.95} />
                    {/* heading marker (front edge) so rotation is visible */}
                    <rect x={-rw * 0.2} y={rh / 2 - 4} width={rw * 0.4} height={4} rx={2} className="fill-slate-100" />
                    <text x={0} y={4} textAnchor="middle" transform={`rotate(${-xf.rotationDeg})`} className="fill-white text-[11px] font-medium pointer-events-none">{m.code}</text>
                  </g>
                );
              })}
            </svg>
            )}

            {/* Bảng zones (chế độ Vùng) */}
            {mode === "zones" && (
              <div className="mt-3 rounded-md border p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium flex items-center gap-2"><Shapes className="h-4 w-4" /> {t("ffe.zones", "Vùng")} ({zones.length})</div>
                  <PermissionGate module="machine_control" action="canEdit" fallback={null}>
                    {drawing ? (
                      <div className="flex gap-2">
                        <span className="text-xs text-muted-foreground self-center">{t("ffe.drawHint", "Click trên sàn để thêm điểm")} ({draft.length})</span>
                        <Button size="sm" variant="outline" className="h-7" disabled={!draft.length} onClick={() => setDraft((d) => d.slice(0, -1))}>{t("ffe.removeLastPoint", "Xoá điểm cuối")}</Button>
                        <Button size="sm" className="h-7" disabled={draft.length < 3 || createZone.isPending} onClick={finishZone}><Check className="h-4 w-4 mr-1" /> {t("ffe.finishZone", "Hoàn tất")}</Button>
                        <Button size="sm" variant="ghost" className="h-7" onClick={() => { setDrawing(false); setDraft([]); }}><X className="h-4 w-4" /></Button>
                      </div>
                    ) : (
                      <Button size="sm" variant="outline" className="h-7" onClick={() => { setDrawing(true); setDraft([]); setSelZone(null); }}><Plus className="h-4 w-4 mr-1" /> {t("ffe.newZone", "Vẽ vùng mới")}</Button>
                    )}
                  </PermissionGate>
                </div>

                {zones.length === 0 ? (
                  <div className="text-xs text-muted-foreground">{t("ffe.noZones", "Chưa có vùng nào")}</div>
                ) : (
                  <div className="space-y-2">
                    {zones.map((z) => (
                      <div key={z.id} className={`flex flex-wrap items-center gap-2 rounded border p-2 ${selZone === z.id ? "border-cyan-400" : ""}`} onClick={() => setSelZone(z.id)}>
                        <Input value={z.name} disabled={!canEdit} className="h-7 w-40"
                          onChange={(e) => setZones((zs) => zs.map((x) => x.id === z.id ? { ...x, name: e.target.value } : x))}
                          onBlur={() => canEdit && updateZone.mutate({ id: z.id, name: z.name })} />
                        <input type="color" value={z.color} disabled={!canEdit} className="h-7 w-10 rounded border disabled:opacity-50"
                          onChange={(e) => { const color = e.target.value; setZones((zs) => zs.map((x) => x.id === z.id ? { ...x, color } : x)); if (canEdit) updateZone.mutate({ id: z.id, color }); }} />
                        <span className="text-xs text-muted-foreground">{z.points.length} {t("ffe.points", "điểm")}</span>
                        <PermissionGate module="machine_control" action="canEdit" fallback={null}>
                          <Button size="sm" variant="ghost" className="h-7 px-2 text-destructive ml-auto" onClick={() => deleteZone.mutate({ id: z.id })}><Trash2 className="h-4 w-4" /></Button>
                        </PermissionGate>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Bảng chỉnh máy (chế độ Máy) */}
            {mode === "machines" && selected != null && (() => {
              const m = machines.find((x) => x.id === selected);
              if (!m) return null;
              const p = pos[m.id];
              const xf = xform[m.id] ?? { rotationDeg: 0, footprintW: DEF_W, footprintD: DEF_D };
              const updX = (patch: Partial<Xform>) => setXform((prev) => ({ ...prev, [m.id]: { ...xf, ...patch } }));
              return (
                <div className="mt-3 rounded-md border p-3 space-y-2">
                  <div className="text-sm flex flex-wrap gap-3 items-center">
                    <span className="font-medium text-foreground">{m.name} ({m.code})</span>
                    <span className="text-xs text-muted-foreground">{m.line.name} • {m.machineType}</span>
                    <span className="text-xs text-muted-foreground">x={p ? p.x.toFixed(2) : "—"}, y={p ? p.y.toFixed(2) : "—"}</span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
                    <div>
                      <Label className="text-xs">{t("ffe.rotation", "Góc xoay")}: {xf.rotationDeg}°</Label>
                      <input
                        type="range" min={0} max={360} step={5} value={xf.rotationDeg}
                        onPointerDown={() => beginEdit(m.id)}
                        onChange={(e) => updX({ rotationDeg: Number(e.target.value) })}
                        onPointerUp={() => commitEdit(m.id)} onKeyUp={() => commitEdit(m.id)}
                        disabled={!canEdit}
                        className="w-full disabled:opacity-50 disabled:cursor-not-allowed"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">{t("ffe.fpW", "Rộng (W)")}</Label>
                      <Input type="number" step={0.1} min={0.3} max={20} value={xf.footprintW}
                        onFocus={() => beginEdit(m.id)}
                        onChange={(e) => updX({ footprintW: Number(e.target.value) })} onBlur={() => commitEdit(m.id)} disabled={!canEdit} className="h-8" />
                    </div>
                    <div>
                      <Label className="text-xs">{t("ffe.fpD", "Sâu (D)")}</Label>
                      <Input type="number" step={0.1} min={0.3} max={20} value={xf.footprintD}
                        onFocus={() => beginEdit(m.id)}
                        onChange={(e) => updX({ footprintD: Number(e.target.value) })} onBlur={() => commitEdit(m.id)} disabled={!canEdit} className="h-8" />
                    </div>
                  </div>
                  <PermissionGate module="machine_control" action="canEdit">
                    <div className="flex gap-2">
                      {[0, 90, 180, 270].map((deg) => (
                        <Button key={deg} size="sm" variant="outline" className="h-7 px-2" onClick={() => { if (p) applyInstant(m.id, { pos: p, xform: xf }, { pos: p, xform: { ...xf, rotationDeg: deg } }); }}>{deg}°</Button>
                      ))}
                    </div>
                  </PermissionGate>
                </div>
              );
            })()}
          </CardContent>
        </Card>
      </PageContainer>
    </DashboardLayout>
  );
}
