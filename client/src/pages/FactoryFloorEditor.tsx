/**
 * Factory Floor Editor — set REAL floor-plan coordinates for machines.
 *
 * A top-down 2D plan: drag each machine to its actual position on the factory
 * floor. On drop, the normalized (0–1) x/y is persisted via
 * `machine.updateLayoutPosition` — the same coordinates the 3D plant view
 * (/factory-live-map) reads to place the 3D blocks.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import DashboardLayout from "@/components/DashboardLayout";
import { PageContainer, PageHeader } from "@/components/patterns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { statusColor } from "@/components/FactoryFloor3D";
import { toast } from "sonner";
import { Boxes, Info, Magnet, Save, Move } from "lucide-react";
import { PermissionGate, ViewOnlyBadge } from "@/components/PermissionGate";

interface Row {
  id: number; code: string; name: string; machineType: string;
  latestStatus: string; heartbeatStatus: string;
  line: { id: number; name: string; code: string };
  factory: { id: number; name: string; code: string };
  layoutPositionX?: number | string | null;
  layoutPositionY?: number | string | null;
  layout?: { x?: number; y?: number; rotationDeg?: number; footprintW?: number; footprintD?: number } | null;
}

const DEF_W = 1.5, DEF_D = 1.5;
interface Xform { rotationDeg: number; footprintW: number; footprintD: number }

const VB_W = 1000, VB_H = 640, PAD = 44;
const INNER_W = VB_W - 2 * PAD, INNER_H = VB_H - 2 * PAD;
const MW = 46, MH = 34; // machine rect size in viewBox units

function num(v: unknown): number { const n = typeof v === "number" ? v : parseFloat(String(v)); return Number.isFinite(n) ? n : NaN; }

export default function FactoryFloorEditor() {
  const { t } = useTranslation();
  const [, setLocation] = useLocation();
  const machinesQ = trpc.machineStatus.listWithStatus.useQuery();
  const saveM = trpc.machine.updateLayout.useMutation();

  const [factoryId, setFactoryId] = useState<number | null>(null);
  const [snap, setSnap] = useState(true);
  const [pos, setPos] = useState<Record<number, { x: number; y: number }>>({});
  const [xform, setXform] = useState<Record<number, Xform>>({});
  const [dragId, setDragId] = useState<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const rows = (machinesQ.data ?? []) as unknown as Row[];
  const factories = useMemo(() => {
    const m = new Map<number, { id: number; name: string }>();
    for (const r of rows) if (r.factory) m.set(r.factory.id, r.factory);
    return [...m.values()];
  }, [rows]);
  const activeFactoryId = factoryId ?? factories[0]?.id ?? null;
  const machines = useMemo(() => rows.filter((r) => r.factory?.id === activeFactoryId), [rows, activeFactoryId]);

  // Initialise local positions from saved coords; stage unplaced ones in a left tray.
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

  const persist = (id: number, p: { x: number; y: number }, x: Xform) =>
    saveM.mutate(
      { id, x: p.x, y: p.y, rotationDeg: x.rotationDeg, footprintW: x.footprintW, footprintD: x.footprintD },
      { onError: () => toast.error(t("ffe.saveFailed", "Lưu vị trí thất bại")) },
    );

  const lineColor = (lid: number) => `hsl(${(lid * 67) % 360} 70% 55%)`;

  const clientToNorm = (clientX: number, clientY: number) => {
    const rect = svgRef.current!.getBoundingClientRect();
    const vx = ((clientX - rect.left) / rect.width) * VB_W;
    const vy = ((clientY - rect.top) / rect.height) * VB_H;
    let nx = (vx - PAD) / INNER_W;
    let ny = (vy - PAD) / INNER_H;
    nx = Math.max(0, Math.min(1, nx));
    ny = Math.max(0, Math.min(1, ny));
    if (snap) { nx = Math.round(nx / 0.02) * 0.02; ny = Math.round(ny / 0.02) * 0.02; }
    return { x: nx, y: ny };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (dragId == null) return;
    const p = clientToNorm(e.clientX, e.clientY);
    setPos((prev) => ({ ...prev, [dragId]: p }));
  };
  const onPointerUp = () => {
    if (dragId == null) return;
    const id = dragId;
    setDragId(null);
    const p = pos[id];
    if (p) persist(id, p, xform[id] ?? { rotationDeg: 0, footprintW: DEF_W, footprintD: DEF_D });
  };

  const placedCount = machines.filter((m) => { const px = num(m.layoutPositionX), py = num(m.layoutPositionY); return px >= 0 && px <= 1 && py >= 0 && py <= 1; }).length;

  return (
    <DashboardLayout>
      <PageContainer fluid className="space-y-4">
        <PageHeader
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
              <Button size="sm" variant={snap ? "default" : "outline"} onClick={() => setSnap((s) => !s)}><Magnet className="h-4 w-4 mr-1" /> {t("ffe.snap", "Bắt lưới")}</Button>
              <Button size="sm" variant="outline" onClick={() => setLocation("/factory-live-map")}><Boxes className="h-4 w-4 mr-1" /> {t("ffe.view3d", "Xem 3D")}</Button>
            </>
          }
        />

        <div className="rounded-md border border-sky-300 bg-sky-50 dark:bg-sky-950/30 px-3 py-2 text-xs text-sky-800 dark:text-sky-200 flex items-start gap-2">
          <Info className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{t("ffe.note", "Máy mờ ở cột trái là CHƯA đặt vị trí — kéo vào sàn để gán toạ độ. Thả chuột là tự lưu. Màu viền = dây chuyền, màu nền = trạng thái live.")} {saveM.isPending && <span className="inline-flex items-center gap-1 ml-1"><Save className="h-3 w-3 animate-pulse" /> {t("ffe.saving", "đang lưu…")}</span>}</span>
        </div>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Boxes className="h-4 w-4" /> {machines[0]?.factory?.name ?? ""} — {placedCount}/{machines.length} {t("ffe.placed", "máy đã đặt")}</CardTitle></CardHeader>
          <CardContent>
            <svg
              ref={svgRef}
              viewBox={`0 0 ${VB_W} ${VB_H}`}
              className="w-full rounded-md bg-slate-50 dark:bg-slate-900 border select-none"
              style={{ touchAction: "none" }}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerLeave={onPointerUp}
            >
              {/* floor + grid */}
              <rect x={PAD} y={PAD} width={INNER_W} height={INNER_H} rx={6} className="fill-white dark:fill-slate-950 stroke-slate-300 dark:stroke-slate-700" />
              {Array.from({ length: 11 }).map((_, i) => (
                <g key={i}>
                  <line x1={PAD + (INNER_W / 10) * i} y1={PAD} x2={PAD + (INNER_W / 10) * i} y2={PAD + INNER_H} className="stroke-slate-200 dark:stroke-slate-800" strokeWidth={1} />
                  <line x1={PAD} y1={PAD + (INNER_H / 10) * i} x2={PAD + INNER_W} y2={PAD + (INNER_H / 10) * i} className="stroke-slate-200 dark:stroke-slate-800" strokeWidth={1} />
                </g>
              ))}
              <text x={PAD + 4} y={PAD - 8} className="fill-slate-400 text-[12px]">{t("ffe.floor", "Sàn nhà máy (nhìn từ trên)")}</text>

              {machines.map((m) => {
                const p = pos[m.id] ?? { x: 0.02, y: 0.05 };
                const xf = xform[m.id] ?? { rotationDeg: 0, footprintW: DEF_W, footprintD: DEF_D };
                const cx = PAD + p.x * INNER_W, cy = PAD + p.y * INNER_H;
                const rw = MW * (xf.footprintW / DEF_W), rh = MH * (xf.footprintD / DEF_D);
                const isSel = selected === m.id;
                return (
                  <g
                    key={m.id}
                    transform={`translate(${cx}, ${cy}) rotate(${xf.rotationDeg})`}
                    style={{ cursor: dragId === m.id ? "grabbing" : "grab" }}
                    onPointerDown={(e) => { (e.target as Element).setPointerCapture?.(e.pointerId); setDragId(m.id); setSelected(m.id); }}
                  >
                    <rect x={-rw / 2} y={-rh / 2} width={rw} height={rh} rx={4} fill={statusColor(m)} stroke={isSel ? "#06b6d4" : lineColor(m.line.id)} strokeWidth={isSel ? 3 : 2.5} opacity={0.95} />
                    {/* heading marker (front edge) so rotation is visible */}
                    <rect x={-rw * 0.2} y={rh / 2 - 4} width={rw * 0.4} height={4} rx={2} className="fill-slate-100" />
                    <text x={0} y={4} textAnchor="middle" transform={`rotate(${-xf.rotationDeg})`} className="fill-white text-[11px] font-medium pointer-events-none">{m.code}</text>
                  </g>
                );
              })}
            </svg>

            {selected != null && (() => {
              const m = machines.find((x) => x.id === selected);
              if (!m) return null;
              const p = pos[m.id];
              const xf = xform[m.id] ?? { rotationDeg: 0, footprintW: DEF_W, footprintD: DEF_D };
              const updX = (patch: Partial<Xform>) => setXform((prev) => ({ ...prev, [m.id]: { ...xf, ...patch } }));
              const saveNow = () => { if (p) persist(m.id, p, xform[m.id] ?? xf); };
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
                        onChange={(e) => updX({ rotationDeg: Number(e.target.value) })}
                        onPointerUp={saveNow} onKeyUp={saveNow}
                        className="w-full"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">{t("ffe.fpW", "Rộng (W)")}</Label>
                      <Input type="number" step={0.1} min={0.3} value={xf.footprintW}
                        onChange={(e) => updX({ footprintW: Number(e.target.value) })} onBlur={saveNow} className="h-8" />
                    </div>
                    <div>
                      <Label className="text-xs">{t("ffe.fpD", "Sâu (D)")}</Label>
                      <Input type="number" step={0.1} min={0.3} value={xf.footprintD}
                        onChange={(e) => updX({ footprintD: Number(e.target.value) })} onBlur={saveNow} className="h-8" />
                    </div>
                  </div>
                  <PermissionGate module="machine_control" action="canEdit">
                    <div className="flex gap-2">
                      {[0, 90, 180, 270].map((deg) => (
                        <Button key={deg} size="sm" variant="outline" className="h-7 px-2" onClick={() => { updX({ rotationDeg: deg }); if (p) persist(m.id, p, { ...xf, rotationDeg: deg }); }}>{deg}°</Button>
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
