import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { MapPin, ImageOff, AlertTriangle, Info } from "lucide-react";

export interface ProductDefectHeatmapScope {
  productModelId?: number;
  machineId?: number;
  startDate: string;
  endDate: string;
}

// Defect density colour ramp (green → yellow → orange → red) by 0..1 intensity.
function densityColor(intensity: number, alpha = 0.85): string {
  if (intensity <= 0) return `rgba(148, 163, 184, ${alpha * 0.5})`; // slate (no defects)
  if (intensity < 0.25) return `rgba(34, 197, 94, ${alpha})`;
  if (intensity < 0.5) return `rgba(234, 179, 8, ${alpha})`;
  if (intensity < 0.75) return `rgba(249, 115, 22, ${alpha})`;
  return `rgba(239, 68, 68, ${alpha})`;
}

/**
 * Quality Cockpit — product defect heatmap (FIXED overlay).
 *
 * Renders each measurement point's defect density as a bubble at the point's
 * REAL position on the product reference image. Positions come from
 * measurement_point_defs.normalizedX/Y (0..1), falling back to positionX/Y over
 * the product's native image dimensions. This replaces the legacy
 * `pointDefId % grid` pseudo-coordinate, which had no physical meaning.
 *
 * Defect classification (IPC-A-610 codes) is P4 — see the placeholder hook below.
 */
export function ProductDefectHeatmap({ scope }: { scope: ProductDefectHeatmapScope }) {
  const { t } = useTranslation();
  const [selectedPointId, setSelectedPointId] = useState<number | null>(null);

  const { data, isLoading } = trpc.defectHeatmap.getProductDefectOverlay.useQuery(
    {
      productModelId: scope.productModelId!,
      machineId: scope.machineId,
      startDate: scope.startDate,
      endDate: scope.endDate,
    },
    { enabled: !!scope.productModelId },
  );

  // Points that have a usable normalized anchor (0..1) for overlay.
  const positionedPoints = useMemo(() => {
    if (!data?.points) return [];
    return data.points.filter(
      (p) =>
        p.normalizedX != null &&
        p.normalizedY != null &&
        p.normalizedX >= 0 && p.normalizedX <= 1 &&
        p.normalizedY >= 0 && p.normalizedY <= 1,
    );
  }, [data]);

  const maxNg = data?.maxNg ?? 0;
  const selectedPoint = positionedPoints.find((p) => p.pointDefId === selectedPointId) ?? null;

  // ── Empty / guard states (honest) ──────────────────────────────────────────
  if (!scope.productModelId) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
          <MapPin className="h-12 w-12 mb-3 opacity-40" />
          <p className="font-medium">{t("qualityCockpit.heatmap.selectProductPrompt")}</p>
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    return <Skeleton className="h-[520px] w-full" />;
  }

  const product = data?.product;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Overlay canvas */}
      <Card className="lg:col-span-2">
        <CardHeader className="py-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <MapPin className="h-4 w-4" />
            {t("qualityCockpit.heatmap.title")}
          </CardTitle>
          <CardDescription>
            {product?.code ? `${product.code} — ${product.name}` : ""}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!product?.referenceImageUrl ? (
            <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground border border-dashed rounded-lg">
              <ImageOff className="h-12 w-12 mb-3 opacity-40" />
              <p className="font-medium">{t("qualityCockpit.heatmap.noProductImage")}</p>
              <p className="text-xs mt-1 max-w-sm">{t("qualityCockpit.heatmap.noProductImageHint")}</p>
            </div>
          ) : positionedPoints.length === 0 ? (
            <div className="relative">
              <img
                src={product.referenceImageUrl}
                alt={product.name ?? ""}
                className="w-full rounded-lg border"
              />
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="bg-background/90 backdrop-blur-sm rounded-lg px-4 py-3 flex items-center gap-2 text-sm text-muted-foreground">
                  <Info className="h-4 w-4" />
                  {t("qualityCockpit.heatmap.noPositions")}
                </div>
              </div>
            </div>
          ) : (
            <div className="relative inline-block w-full">
              <img
                src={product.referenceImageUrl}
                alt={product.name ?? ""}
                className="w-full rounded-lg border select-none"
                draggable={false}
              />
              {/* Defect density bubbles at REAL normalized positions */}
              <TooltipProvider>
                {positionedPoints.map((p) => {
                  const intensity = maxNg > 0 ? p.ngCount / maxNg : 0;
                  // Bubble size scales with density (min 14px, max ~44px).
                  const size = 14 + intensity * 30;
                  const left = `${(p.normalizedX as number) * 100}%`;
                  const top = `${(p.normalizedY as number) * 100}%`;
                  const isSelected = selectedPointId === p.pointDefId;
                  return (
                    <Tooltip key={p.pointDefId}>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onClick={() => setSelectedPointId(p.pointDefId)}
                          className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 transition-transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-ring"
                          style={{
                            left,
                            top,
                            width: `${size}px`,
                            height: `${size}px`,
                            backgroundColor: densityColor(intensity),
                            borderColor: isSelected ? "#ffffff" : "rgba(255,255,255,0.6)",
                            boxShadow: isSelected ? "0 0 0 3px rgba(59,130,246,0.6)" : undefined,
                          }}
                          aria-label={`${p.code} — ${p.ngCount} NG`}
                        >
                          {p.ngCount > 0 && size >= 24 && (
                            <span className="text-[10px] font-bold text-white leading-none">
                              {p.ngCount}
                            </span>
                          )}
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        <div className="text-xs space-y-0.5">
                          <p className="font-medium">{p.code} — {p.name}</p>
                          <p>{t("qualityCockpit.heatmap.ngCount")}: <span className="font-mono">{p.ngCount}</span></p>
                          <p>{t("qualityCockpit.heatmap.inspected")}: <span className="font-mono">{p.totalCount}</span></p>
                          <p>{t("qualityCockpit.heatmap.ngRate")}: <span className="font-mono">{p.ngRate.toFixed(2)}%</span></p>
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  );
                })}
              </TooltipProvider>

              {/* Legend */}
              <div className="absolute bottom-3 right-3 bg-background/90 backdrop-blur-sm rounded-lg p-2">
                <p className="text-[10px] font-medium mb-1">{t("qualityCockpit.heatmap.defectDensity")}</p>
                <div className="flex items-center gap-1">
                  {[0.1, 0.35, 0.6, 0.85].map((v) => (
                    <div key={v} className="w-4 h-4 rounded" style={{ backgroundColor: densityColor(v) }} />
                  ))}
                </div>
                <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5">
                  <span>{t("qualityCockpit.heatmap.low")}</span>
                  <span>{t("qualityCockpit.heatmap.high")}</span>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Side panel: ranked points + selection + P4 classification hook */}
      <div className="space-y-4">
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              {t("qualityCockpit.heatmap.overview")}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3">
            <div className="text-center p-3 bg-muted rounded-lg">
              <p className="text-2xl font-bold text-red-500">{data?.totalNg ?? 0}</p>
              <p className="text-xs text-muted-foreground">{t("qualityCockpit.heatmap.totalNg")}</p>
            </div>
            <div className="text-center p-3 bg-muted rounded-lg">
              <p className="text-2xl font-bold">{data?.totalInspected ?? 0}</p>
              <p className="text-xs text-muted-foreground">{t("qualityCockpit.heatmap.inspected")}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm">{t("qualityCockpit.heatmap.topPoints")}</CardTitle>
          </CardHeader>
          <CardContent className="p-2">
            {[...(data?.points ?? [])]
              .sort((a, b) => b.ngCount - a.ngCount)
              .slice(0, 10)
              .map((p) => {
                const intensity = maxNg > 0 ? p.ngCount / maxNg : 0;
                return (
                  <button
                    key={p.pointDefId}
                    type="button"
                    onClick={() => setSelectedPointId(p.pointDefId)}
                    className={`w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted ${
                      selectedPointId === p.pointDefId ? "bg-muted" : ""
                    }`}
                  >
                    <span
                      className="h-3 w-3 rounded-full shrink-0"
                      style={{ backgroundColor: densityColor(intensity) }}
                    />
                    <span className="flex-1 truncate">{p.code}</span>
                    <Badge variant="secondary" className="font-mono">{p.ngCount}</Badge>
                  </button>
                );
              })}
            {(!data?.points || data.points.length === 0) && (
              <p className="text-sm text-muted-foreground py-4 text-center">
                {t("qualityCockpit.heatmap.noData")}
              </p>
            )}
          </CardContent>
        </Card>

        {selectedPoint && (
          <Card>
            <CardHeader className="py-3">
              <CardTitle className="text-sm">{selectedPoint.code} — {selectedPoint.name}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("qualityCockpit.heatmap.ngCount")}</span>
                <span className="font-mono">{selectedPoint.ngCount}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("qualityCockpit.heatmap.ngRate")}</span>
                <span className="font-mono">{selectedPoint.ngRate.toFixed(2)}%</span>
              </div>
              {/* P4 HOOK: defect classification (IPC-A-610 code breakdown) goes here. */}
              <p className="text-xs text-muted-foreground italic pt-2 border-t mt-2">
                {t("qualityCockpit.heatmap.classificationComingSoon")}
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

export default ProductDefectHeatmap;
