import { useMemo, useState } from "react";

/**
 * P4.B G10 — Per-MP Defect Heatmap Overlay
 * Renders a colored circle for each MP on top of the product reference image,
 * tinted by historical defect rate. Click → modal with top-3 defect codes.
 */
export interface MpDefectStat {
  pointDefId: number;
  code: string;
  positionX: number;
  positionY: number;
  radius: number;
  shape?: string;
  geometry?: any;
  totalCount: number;
  ngCount: number;
  defectRate: number;
  topDefects: Array<{ code: string | null; name: string | null; count: number }>;
}

interface DefectHeatmapOverlayProps {
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
  stats: MpDefectStat[];
  zoomLevel?: number;
  onClickPoint?: (stat: MpDefectStat) => void;
  className?: string;
}

function rateToColor(rate: number): string {
  // 0 = green (#22c55e), 0.05 = yellow (#eab308), 0.15 = orange (#f97316), 0.30+ = red (#ef4444)
  if (rate <= 0) return "#22c55e";
  if (rate < 0.05) return "#84cc16";
  if (rate < 0.10) return "#eab308";
  if (rate < 0.20) return "#f97316";
  return "#ef4444";
}

export default function DefectHeatmapOverlay({
  imageUrl,
  imageWidth,
  imageHeight,
  stats,
  zoomLevel = 1,
  onClickPoint,
  className,
}: DefectHeatmapOverlayProps) {
  const [hoverId, setHoverId] = useState<number | null>(null);

  const sorted = useMemo(
    () => [...stats].sort((a, b) => a.defectRate - b.defectRate),
    [stats],
  );

  return (
    <div
      className={className}
      style={{
        position: "relative",
        width: imageWidth * zoomLevel,
        height: imageHeight * zoomLevel,
      }}
    >
      <img
        src={imageUrl}
        alt="Product reference"
        style={{
          width: "100%",
          height: "100%",
          objectFit: "contain",
          userSelect: "none",
          pointerEvents: "none",
        }}
        draggable={false}
      />
      <svg
        viewBox={`0 0 ${imageWidth} ${imageHeight}`}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          pointerEvents: "none",
        }}
      >
        {sorted.map((s) => {
          const color = rateToColor(s.defectRate);
          const opacity = s.totalCount === 0 ? 0.25 : Math.max(0.4, Math.min(0.9, 0.4 + s.defectRate * 2));
          const isHover = hoverId === s.pointDefId;
          return (
            <g
              key={s.pointDefId}
              style={{ pointerEvents: "auto", cursor: onClickPoint ? "pointer" : "default" }}
              onMouseEnter={() => setHoverId(s.pointDefId)}
              onMouseLeave={() => setHoverId(null)}
              onClick={() => onClickPoint?.(s)}
            >
              <circle
                cx={s.positionX}
                cy={s.positionY}
                r={s.radius || 20}
                fill={color}
                fillOpacity={opacity}
                stroke={isHover ? "#000" : color}
                strokeWidth={isHover ? 2 : 1}
              />
              {s.totalCount > 0 && (
                <text
                  x={s.positionX}
                  y={s.positionY + 4}
                  textAnchor="middle"
                  fontSize={Math.max(10, (s.radius || 20) * 0.5)}
                  fontWeight="bold"
                  fill="#fff"
                  stroke="#000"
                  strokeWidth={0.5}
                  style={{ paintOrder: "stroke" }}
                >
                  {(s.defectRate * 100).toFixed(1)}%
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {hoverId !== null && (() => {
        const s = stats.find((x) => x.pointDefId === hoverId);
        if (!s) return null;
        return (
          <div
            style={{
              position: "absolute",
              left: 8,
              top: 8,
              background: "rgba(15, 23, 42, 0.92)",
              color: "#fff",
              padding: "8px 12px",
              borderRadius: 6,
              fontSize: 12,
              maxWidth: 280,
              pointerEvents: "none",
              zIndex: 10,
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 4 }}>{s.code}</div>
            <div>NG: {s.ngCount} / Total: {s.totalCount}</div>
            <div>Defect rate: {(s.defectRate * 100).toFixed(2)}%</div>
            {s.topDefects.length > 0 && (
              <div style={{ marginTop: 4 }}>
                <div style={{ opacity: 0.7, fontSize: 11 }}>Top defects:</div>
                {s.topDefects.map((d, i) => (
                  <div key={i} style={{ fontSize: 11 }}>
                    • {d.code ?? "?"} {d.name ? `— ${d.name}` : ""} ({d.count})
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}
