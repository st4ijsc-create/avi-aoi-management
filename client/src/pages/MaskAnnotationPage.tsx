/**
 * B7 — Mask Annotation Page.
 *
 * QC tô vùng defect bằng polygon (click các điểm) trên ảnh, chọn nhãn lớp, lưu
 * mask (source "human"). Hỗ trợ nhiều mask/ảnh, undo điểm, xoá mask, đo metrology
 * (diện tích/đường kính/chu vi — px hoặc µm khi có calibration), overlay bán
 * trong suốt + biên. Có thể chạy model segmentation (degrade rõ nếu chưa có).
 *
 * Đa ngôn ngữ vi/en/zh qua i18n key `maskAnno.*`.
 */
import { useState, useRef, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { PageHeader, PageContainer } from "@/components/patterns";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Brush, Trash2, Undo2, Save, Play, Ruler } from "lucide-react";
import { toast } from "sonner";
import { mapTrpcError } from "@/lib/trpcErrors";

interface Point { x: number; y: number; }
interface MaskItem {
  id: string;
  label: string;
  points: Point[]; // toạ độ pixel theo kích thước tự nhiên của ảnh
  color: string;
}

const PALETTE = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#3b82f6", "#a855f7"];

export default function MaskAnnotationPage() {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  const [imageUrl, setImageUrl] = useState<string>("");
  const [imgDims, setImgDims] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [masks, setMasks] = useState<MaskItem[]>([]);
  const [draft, setDraft] = useState<Point[]>([]);
  const [classLabel, setClassLabel] = useState<string>("scratch");
  const [umPerPx, setUmPerPx] = useState<string>("");
  const [modelId, setModelId] = useState<string>("");
  const [measured, setMeasured] = useState<Record<string, any>>({});

  const saveMask = trpc.aiSegmentation.saveMask.useMutation();
  const runSeg = trpc.aiSegmentation.runSegmentation.useMutation();
  const utils = trpc.useUtils();

  // ── Vẽ canvas (ảnh + mask + draft) ──────────────────────────────────────────
  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img || !imgDims.w) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const sx = canvas.width / imgDims.w;
    const sy = canvas.height / imgDims.h;

    const drawPoly = (pts: Point[], color: string, closed: boolean) => {
      if (pts.length === 0) return;
      ctx.beginPath();
      ctx.moveTo(pts[0].x * sx, pts[0].y * sy);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x * sx, pts[i].y * sy);
      if (closed) ctx.closePath();
      ctx.fillStyle = color + "55"; // ~33% alpha
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      if (closed) ctx.fill();
      ctx.stroke();
      for (const p of pts) {
        ctx.beginPath();
        ctx.arc(p.x * sx, p.y * sy, 3, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
      }
    };

    for (const m of masks) drawPoly(m.points, m.color, true);
    if (draft.length) drawPoly(draft, "#06b6d4", false);
  }, [masks, draft, imgDims]);

  useEffect(() => { redraw(); }, [redraw]);

  const onImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    imgRef.current = img;
    setImgDims({ w: img.naturalWidth, h: img.naturalHeight });
    const canvas = canvasRef.current;
    if (canvas) {
      const maxW = 720;
      const scale = Math.min(1, maxW / img.naturalWidth);
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
    }
  };

  const onCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !imgDims.w) return;
    const rect = canvas.getBoundingClientRect();
    const cx = ((e.clientX - rect.left) / rect.width) * canvas.width;
    const cy = ((e.clientY - rect.top) / rect.height) * canvas.height;
    // quy về toạ độ pixel ảnh tự nhiên
    const x = (cx / canvas.width) * imgDims.w;
    const y = (cy / canvas.height) * imgDims.h;
    setDraft((d) => [...d, { x: Math.round(x), y: Math.round(y) }]);
  };

  const finishMask = () => {
    if (draft.length < 3) { toast.error(t("maskAnno.needThreePoints")); return; }
    const color = PALETTE[masks.length % PALETTE.length];
    setMasks((m) => [...m, { id: crypto.randomUUID(), label: classLabel, points: draft, color }]);
    setDraft([]);
  };

  const undoPoint = () => setDraft((d) => d.slice(0, -1));
  const removeMask = (id: string) => {
    setMasks((m) => m.filter((x) => x.id !== id));
    setMeasured((mm) => { const c = { ...mm }; delete c[id]; return c; });
  };

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => setImageUrl(String(reader.result));
    reader.readAsDataURL(f);
  };

  const um = umPerPx.trim() ? Number(umPerPx) : null;

  const measureMaskItem = async (m: MaskItem) => {
    try {
      const res = await utils.aiSegmentation.measureMask.fetch({
        maskData: { width: imgDims.w, height: imgDims.h, points: m.points },
        umPerPx: um && um > 0 ? um : null,
      });
      setMeasured((mm) => ({ ...mm, [m.id]: res }));
    } catch (err: any) {
      toast.error(mapTrpcError(err));
    }
  };

  const saveMaskItem = async (m: MaskItem) => {
    try {
      const res = await saveMask.mutateAsync({
        imageUrl: imageUrl.startsWith("data:") ? undefined : imageUrl,
        source: "human",
        maskFormat: "polygon",
        maskData: { width: imgDims.w, height: imgDims.h, points: m.points },
        classLabel: m.label,
        umPerPx: um && um > 0 ? um : undefined,
      });
      if (res.metrology) setMeasured((mm) => ({ ...mm, [m.id]: res.metrology }));
      toast.success(t("maskAnno.saved"));
    } catch (err: any) {
      toast.error(mapTrpcError(err));
    }
  };

  const runModel = async () => {
    if (!modelId.trim() || !imageUrl) { toast.error(t("maskAnno.needModelImage")); return; }
    try {
      const res = await runSeg.mutateAsync({
        modelId: Number(modelId),
        image: imageUrl,
        umPerPx: um && um > 0 ? um : undefined,
      });
      // scale mask polygon từ lưới output về kích thước ảnh
      const sx = imgDims.w / res.maskWidth;
      const sy = imgDims.h / res.maskHeight;
      const newMasks: MaskItem[] = res.masks.map((mk: any, i: number) => ({
        id: crypto.randomUUID(),
        label: mk.label,
        points: mk.polygon.map((p: Point) => ({ x: p.x * sx, y: p.y * sy })),
        color: PALETTE[(masks.length + i) % PALETTE.length],
      }));
      setMasks((m) => [...m, ...newMasks]);
      toast.success(t("maskAnno.modelMasks", { count: newMasks.length }));
      // X5: cảnh báo trung thực khi nhánh YOLO-seg (chưa validate model thật).
      if ((res as any).experimental) {
        toast.warning(
          (res as any).experimentalNote ??
            t(
              "maskAnno.experimentalSeg",
              "Kết quả YOLO-seg là THỬ NGHIỆM — chưa validate model thật, số đo metrology chỉ tham khảo.",
            ),
        );
      }
    } catch (err: any) {
      // degrade trung thực: MODEL_NOT_AVAILABLE
      // i18n-raw-ok: `msg` dùng để SO KHỚP mã máy-đọc-được, không phải để hiện.
      const msg = err?.message ?? String(err);
      if (msg.includes("MODEL_NOT_AVAILABLE")) toast.error(t("maskAnno.modelUnavailable"));
      else toast.error(mapTrpcError(err));
    }
  };

  const fmt = (n: number) => (n == null ? "-" : Number(n).toFixed(2));

  return (
    <DashboardLayout>
      <PageContainer fluid>
        <PageHeader
          icon={<Brush className="h-6 w-6" />}
          title={t("maskAnno.title")}
          description={t("maskAnno.subtitle")}
        />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Canvas */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">{t("maskAnno.canvasTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-2 items-end">
                <div className="flex-1 min-w-50">
                  <Label className="text-xs">{t("maskAnno.imageUrl")}</Label>
                  <Input value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://… / /uploads/…" />
                </div>
                <div>
                  <Label className="text-xs">{t("maskAnno.uploadFile")}</Label>
                  <Input type="file" accept="image/*" onChange={onFile} />
                </div>
              </div>

              {imageUrl ? (
                <div className="relative inline-block border rounded overflow-hidden">
                  {/* ảnh ẩn để lấy naturalWidth */}
                  <img src={imageUrl} alt="src" onLoad={onImageLoad} className="hidden" crossOrigin="anonymous" />
                  <canvas
                    ref={canvasRef}
                    onClick={onCanvasClick}
                    className="cursor-crosshair max-w-full"
                  />
                </div>
              ) : (
                <div className="h-64 flex items-center justify-center text-muted-foreground border rounded border-dashed">
                  {t("maskAnno.loadImageHint")}
                </div>
              )}

              <div className="flex flex-wrap gap-2 items-end">
                <div>
                  <Label className="text-xs">{t("maskAnno.classLabel")}</Label>
                  <Input value={classLabel} onChange={(e) => setClassLabel(e.target.value)} className="w-40" />
                </div>
                <Button size="sm" variant="outline" onClick={undoPoint} disabled={!draft.length}>
                  <Undo2 className="h-4 w-4 mr-1" />{t("maskAnno.undoPoint")}
                </Button>
                <Button size="sm" onClick={finishMask} disabled={draft.length < 3}>
                  <Brush className="h-4 w-4 mr-1" />{t("maskAnno.finishMask")} ({draft.length})
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Panel mask + metrology + model */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("maskAnno.masksPanel")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2 items-end">
                <div className="flex-1">
                  <Label className="text-xs">{t("maskAnno.umPerPx")}</Label>
                  <Input value={umPerPx} onChange={(e) => setUmPerPx(e.target.value)} placeholder={t("maskAnno.umPerPxPh")} />
                </div>
              </div>
              {!um && <p className="text-xs text-warning">{t("maskAnno.noCalib")}</p>}

              <div className="border-t pt-2 space-y-1">
                <Label className="text-xs">{t("maskAnno.runModel")}</Label>
                <div className="flex gap-2">
                  <Input value={modelId} onChange={(e) => setModelId(e.target.value)} placeholder={t("maskAnno.modelIdPh")} className="w-28" />
                  <Button size="sm" variant="secondary" onClick={runModel} disabled={runSeg.isPending}>
                    <Play className="h-4 w-4 mr-1" />{t("maskAnno.run")}
                  </Button>
                </div>
              </div>

              <div className="space-y-2 max-h-105 overflow-auto border-t pt-2">
                {masks.length === 0 && <p className="text-xs text-muted-foreground">{t("maskAnno.noMasks")}</p>}
                {masks.map((m) => {
                  const mm = measured[m.id];
                  return (
                    <div key={m.id} className="rounded border p-2 text-xs space-y-1">
                      <div className="flex items-center justify-between">
                        <Badge style={{ backgroundColor: m.color }}>{m.label}</Badge>
                        <div className="flex gap-1">
                          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => measureMaskItem(m)} title={t("maskAnno.measure")}>
                            <Ruler className="h-3.5 w-3.5" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => saveMaskItem(m)} title={t("maskAnno.save")}>
                            <Save className="h-3.5 w-3.5" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive" onClick={() => removeMask(m.id)} title={t("maskAnno.delete")}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                      {mm && (
                        <div className="grid grid-cols-2 gap-x-2 text-muted-foreground">
                          <span>{t("maskAnno.area")}: {fmt(mm.area)} {mm.unit === "um" ? "µm²" : "px²"}</span>
                          <span>{t("maskAnno.perimeter")}: {fmt(mm.perimeter)} {mm.unit === "um" ? "µm" : "px"}</span>
                          <span>{t("maskAnno.feretMax")}: {fmt(mm.feretMax)}</span>
                          <span>{t("maskAnno.feretMin")}: {fmt(mm.feretMin)}</span>
                          <span>{t("maskAnno.equivDia")}: {fmt(mm.equivDiameter)}</span>
                          {mm.degraded && <span className="text-warning">{t("maskAnno.unitPx")}</span>}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>
      </PageContainer>
    </DashboardLayout>
  );
}
