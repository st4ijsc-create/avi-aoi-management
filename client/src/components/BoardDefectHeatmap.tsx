import { useEffect, useMemo, useRef, useState } from "react";
// doc 64 IA-10 S3 — truc pham vi ISA-95.
import { useScope } from "@/components/patterns/ScopeFilterBar";
import { useScopeWired } from "@/contexts/AssetScopeContext";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Grid3X3, AlertTriangle, Info, MapPin } from "lucide-react";

/**
 * Doc 27 gap A5 (W5-A) — REAL board-space defect heatmap.
 *
 * Renders defectHeatmap.getBboxHeatmap: NG defects bucketed by their REAL
 * pixel bounding-box centers (measurement_results.defectBboxX/Y/W/H) into a
 * grid over the board image space. Honesty guarantees surfaced in the UI:
 *  - coordinateSpace badge ("product_image" | "observed_extent"), because the
 *    board image dimensions are not stored per inspection;
 *  - excludedNoBbox badge — legacy NG rows without a bbox are excluded from
 *    the grid, never silently dropped;
 *  - explicit "logical positions" mode for datasets with no bbox at all
 *    (pointDefId-derived layout — NOT spatial).
 */

function getDefaultDateRange() {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 30);
  return {
    startDate: start.toISOString().split("T")[0],
    endDate: end.toISOString().split("T")[0],
  };
}

// Heat ramp (transparent → green → yellow → orange → red).
function heatColor(intensity: number): string {
  if (intensity <= 0) return "rgba(0,0,0,0)";
  if (intensity < 0.25) return `rgba(34, 197, 94, ${0.35 + intensity})`;
  if (intensity < 0.5) return `rgba(234, 179, 8, ${0.45 + intensity * 0.5})`;
  if (intensity < 0.75) return `rgba(249, 115, 22, ${0.55 + intensity * 0.4})`;
  return `rgba(239, 68, 68, ${0.65 + intensity * 0.35})`;
}

const CANVAS_W = 800;
const CANVAS_H = 600;

export function BoardDefectHeatmap() {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [productModelId, setProductModelId] = useState<number | undefined>();
  const [machineId, setMachineId] = useState<number | undefined>();
  const [defectCatalogId, setDefectCatalogId] = useState<number | undefined>();
  // doc 64 IA-10 S3-B — trục phạm vi seed máy (picker tại-tab vẫn đổi được sau).
  const { scope: assetScope } = useScope(["machine"]);
  useScopeWired();
  useEffect(() => {
    if (assetScope.machineId !== undefined) setMachineId(assetScope.machineId);
  }, [assetScope.machineId]);
  const [dateRange, setDateRange] = useState(getDefaultDateRange);
  const [gridSize, setGridSize] = useState(50);
  const [logicalMode, setLogicalMode] = useState(false);
  const [weightBySeverity, setWeightBySeverity] = useState(false);

  const { data: products } = trpc.productModel.list.useQuery(undefined as any);
  const { data: machines } = trpc.machine.list.useQuery();
  const { data: defectClasses } = trpc.defectCatalog.list.useQuery({});

  const { data, isLoading } = trpc.defectHeatmap.getBboxHeatmap.useQuery({
    productModelId,
    machineId,
    defectCatalogId,
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
    gridWidth: gridSize,
    gridHeight: gridSize,
    mode: logicalMode ? "pointDef" : "bbox",
    weightBySeverity,
  });

  // Draw the grid onto the canvas.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !data) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#1f2937";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const cellW = canvas.width / data.gridWidth;
    const cellH = canvas.height / data.gridHeight;
    const max = data.maxDefectsInCell || 1;

    for (let y = 0; y < data.gridHeight; y++) {
      const row = data.grid[y];
      if (!row) continue;
      for (let x = 0; x < data.gridWidth; x++) {
        const v = row[x];
        if (!v) continue;
        ctx.fillStyle = heatColor(v / max);
        ctx.fillRect(x * cellW, y * cellH, Math.ceil(cellW), Math.ceil(cellH));
      }
    }

    // Hotspot rings
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.lineWidth = 1.5;
    for (const h of data.hotspots.slice(0, 5)) {
      ctx.beginPath();
      ctx.arc((h.x + 0.5) * cellW, (h.y + 0.5) * cellH, Math.max(cellW, cellH) * 0.9, 0, Math.PI * 2);
      ctx.stroke();
    }
  }, [data]);

  const coordinateSpaceLabel = useMemo(() => {
    switch (data?.coordinateSpace) {
      case "product_image":
        return t("defects.heatmap.spaceProductImage");
      case "observed_extent":
        return t("defects.heatmap.spaceObservedExtent");
      case "logical_point_index":
        return t("defects.heatmap.spaceLogical");
      default:
        return "";
    }
  }, [data?.coordinateSpace, t]);

  return (
    <div className="space-y-4">
      {/* Filters */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Grid3X3 className="h-4 w-4" />
            {t("defects.heatmap.boardTitle")}
          </CardTitle>
          <CardDescription>{t("defects.heatmap.boardSubtitle")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 items-end">
            <div className="space-y-1">
              <Label>{t("defects.heatmap.productModel")}</Label>
              <Select
                value={productModelId ? String(productModelId) : "all"}
                onValueChange={(v) => setProductModelId(v === "all" ? undefined : Number(v))}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("common.all")}</SelectItem>
                  {products?.map((p: any) => (
                    <SelectItem key={p.id} value={String(p.id)}>{p.code} – {p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>{t("defects.heatmap.machine")}</Label>
              <Select
                value={machineId ? String(machineId) : "all"}
                onValueChange={(v) => setMachineId(v === "all" ? undefined : Number(v))}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("common.all")}</SelectItem>
                  {machines?.map((m: any) => (
                    <SelectItem key={m.id} value={String(m.id)}>{m.name ?? m.code}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>{t("defects.heatmap.defectClass")}</Label>
              <Select
                value={defectCatalogId ? String(defectCatalogId) : "all"}
                onValueChange={(v) => setDefectCatalogId(v === "all" ? undefined : Number(v))}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("common.all")}</SelectItem>
                  {defectClasses?.map((d: any) => (
                    <SelectItem key={d.id} value={String(d.id)}>{d.code} – {d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>{t("defects.heatmap.dateFrom")}</Label>
              <Input
                type="date"
                value={dateRange.startDate}
                onChange={(e) => setDateRange((p) => ({ ...p, startDate: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <Label>{t("defects.heatmap.dateTo")}</Label>
              <Input
                type="date"
                value={dateRange.endDate}
                onChange={(e) => setDateRange((p) => ({ ...p, endDate: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <Label>{t("defects.heatmap.gridSize")}</Label>
              <Select value={String(gridSize)} onValueChange={(v) => setGridSize(Number(v))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="25">25 × 25</SelectItem>
                  <SelectItem value="50">50 × 50</SelectItem>
                  <SelectItem value="100">100 × 100</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-6 mt-4">
            <div className="flex items-center gap-2">
              <Switch id="board-logical-mode" checked={logicalMode} onCheckedChange={setLogicalMode} />
              <Label htmlFor="board-logical-mode" className="text-sm cursor-pointer">
                {t("defects.heatmap.logicalModeToggle")}
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="board-severity-weight"
                checked={weightBySeverity}
                onCheckedChange={setWeightBySeverity}
              />
              <Label htmlFor="board-severity-weight" className="text-sm cursor-pointer">
                {t("defects.heatmap.weightBySeverity")}
              </Label>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Honest status badges */}
      {data && (
        <div className="flex flex-wrap items-center gap-2">
          {data.realCoordinates ? (
            <Badge variant="secondary" className="gap-1">
              <MapPin className="h-3 w-3" />
              {t("defects.heatmap.realCoordinates")}
            </Badge>
          ) : (
            <Badge variant="destructive" className="gap-1">
              <AlertTriangle className="h-3 w-3" />
              {t("defects.heatmap.logicalPositionsWarning")}
            </Badge>
          )}
          <Badge variant="outline">{coordinateSpaceLabel}</Badge>
          {data.realCoordinates && (
            <Badge variant="outline">
              {t("defects.heatmap.boardExtent", { w: data.boardWidth, h: data.boardHeight })}
            </Badge>
          )}
          {data.excludedNoBbox > 0 && (
            <Badge variant="outline" className="gap-1 border-warning text-warning">
              <Info className="h-3 w-3" />
              {t("defects.heatmap.excludedNoBbox", {
                count: data.excludedNoBbox,
                pct: data.excludedNoBboxPct,
              })}
            </Badge>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Canvas */}
        <Card className="lg:col-span-2">
          <CardContent className="pt-6">
            {isLoading ? (
              <Skeleton className="w-full h-[480px]" />
            ) : !data || data.totalDefects === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center text-muted-foreground">
                <Grid3X3 className="h-12 w-12 mb-3 opacity-40" />
                <p className="font-medium">{t("defects.heatmap.noBboxData")}</p>
                {data && data.excludedNoBbox > 0 && !logicalMode && (
                  <p className="text-xs mt-2 max-w-md">
                    {t("defects.heatmap.noBboxDataHint", { count: data.excludedNoBbox })}
                  </p>
                )}
              </div>
            ) : (
              <div className="relative overflow-auto rounded-lg">
                <canvas ref={canvasRef} width={CANVAS_W} height={CANVAS_H} className="w-full rounded-lg" />
                <div className="absolute bottom-3 right-3 bg-background/90 backdrop-blur-sm rounded-lg p-2">
                  <p className="text-[10px] font-medium mb-1">{t("defects.heatmap.defectDensity")}</p>
                  <div className="flex items-center gap-1">
                    {[0.15, 0.4, 0.65, 0.9].map((v) => (
                      <div key={v} className="w-4 h-4 rounded" style={{ backgroundColor: heatColor(v) }} />
                    ))}
                  </div>
                  <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5">
                    <span>{t("defects.heatmap.low")}</span>
                    <span>{t("defects.heatmap.high")}</span>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Hotspots with per-cell top defect class */}
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm">{t("defects.heatmap.hotspots")}</CardTitle>
            <CardDescription>
              {t("defects.heatmap.totalDefects")}: {data?.totalDefects ?? 0}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {(data?.hotspots ?? []).map((h, idx) => (
              <div key={`${h.x},${h.y}`} className="flex items-start gap-2 p-2 bg-muted rounded-lg">
                <Badge variant={idx < 3 ? "destructive" : "secondary"} className="font-mono shrink-0">
                  #{idx + 1}
                </Badge>
                <div className="flex-1 min-w-0 text-xs space-y-0.5">
                  <p className="font-medium">
                    {data?.realCoordinates
                      ? t("defects.heatmap.hotspotAtPx", { x: h.realX, y: h.realY })
                      : t("defects.heatmap.hotspotAtCell", { x: h.x, y: h.y })}
                  </p>
                  <p className="text-muted-foreground">
                    {h.defectCount} NG ({h.percentage.toFixed(1)}%)
                  </p>
                  {h.defectTypes.length > 0 && (
                    <div className="flex flex-wrap gap-1 pt-0.5">
                      {h.defectTypes.map((dt) => (
                        <Badge key={dt.type} variant="outline" className="text-[10px] px-1 py-0">
                          {dt.type === "UNCLASSIFIED" ? t("defects.heatmap.unclassified") : dt.type} ×{dt.count}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {(!data?.hotspots || data.hotspots.length === 0) && (
              <p className="text-sm text-muted-foreground text-center py-6">
                {t("defects.heatmap.noBboxData")}
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default BoardDefectHeatmap;
