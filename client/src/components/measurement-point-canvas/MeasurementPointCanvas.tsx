import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

type Point2D = { x: number; y: number };

export type CanvasPointShape = "circle" | "rect" | "polygon" | "line" | "ring" | "mask";

export type CanvasGeometry =
  | { shape: "circle"; x: number; y: number; radius: number }
  | { shape: "rect"; x: number; y: number; width: number; height: number; rotation?: number }
  | { shape: "polygon"; points: Point2D[] }
  | { shape: "line"; x1: number; y1: number; x2: number; y2: number; thickness?: number }
  | { shape: "ring"; x: number; y: number; rOuter: number; rInner: number }
  | {
      shape: "mask";
      region:
        | { kind: "rect"; x: number; y: number; width: number; height: number }
        | { kind: "polygon"; points: Point2D[] }
        | { kind: "circle"; x: number; y: number; radius: number };
      invert?: boolean;
    };

export interface CanvasMeasurementPoint {
  id?: number;
  code: string;
  positionX: number;
  positionY: number;
  radius: number;
  shape?: CanvasPointShape;
  geometry?: CanvasGeometry;
}

interface DragState {
  index: number;
  mode: "move" | "handle";
  handleId?: string;
  start: Point2D;
  original: CanvasMeasurementPoint;
}

interface DrawState {
  tool: CanvasPointShape;
  start: Point2D;
  current: Point2D;
}

interface MeasurementPointCanvasProps {
  imageUrl: string;
  points: CanvasMeasurementPoint[];
  selectedIndex: number | null;
  onSelectIndex: (index: number | null) => void;
  onChangePoints: (points: CanvasMeasurementPoint[]) => void;
  isEditMode: boolean;
  isDrawing: boolean;
  drawTool: CanvasPointShape;
  pointRadius: number;
  zoomLevel: number;
  className?: string;
  onDrawingStateChange?: (drawing: boolean) => void;
}

const HANDLE_RADIUS = 5;
const HIT_PADDING = 10;

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function distance(a: Point2D, b: Point2D): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function toGeometry(p: CanvasMeasurementPoint): CanvasGeometry {
  if (p.geometry) return p.geometry;
  return { shape: "circle", x: p.positionX, y: p.positionY, radius: p.radius || 20 };
}

function anchorFromGeometry(g: CanvasGeometry): { x: number; y: number; radius: number } {
  if (g.shape === "circle") return { x: g.x, y: g.y, radius: g.radius };
  if (g.shape === "rect") {
    return { x: g.x + g.width / 2, y: g.y + g.height / 2, radius: Math.max(g.width, g.height) / 2 };
  }
  if (g.shape === "line") {
    const cx = (g.x1 + g.x2) / 2;
    const cy = (g.y1 + g.y2) / 2;
    return { x: cx, y: cy, radius: Math.max(10, distance({ x: g.x1, y: g.y1 }, { x: g.x2, y: g.y2 }) / 2) };
  }
  if (g.shape === "ring") return { x: g.x, y: g.y, radius: g.rOuter };
  if (g.shape === "polygon") {
    let sx = 0;
    let sy = 0;
    for (const pt of g.points) {
      sx += pt.x;
      sy += pt.y;
    }
    const x = sx / g.points.length;
    const y = sy / g.points.length;
    let maxR = 10;
    for (const pt of g.points) {
      maxR = Math.max(maxR, distance({ x, y }, pt));
    }
    return { x, y, radius: maxR };
  }
  const r = g.region;
  if (r.kind === "rect") {
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, radius: Math.max(r.width, r.height) / 2 };
  }
  if (r.kind === "circle") return { x: r.x, y: r.y, radius: r.radius };
  let sx = 0;
  let sy = 0;
  for (const pt of r.points) {
    sx += pt.x;
    sy += pt.y;
  }
  const x = sx / r.points.length;
  const y = sy / r.points.length;
  return { x, y, radius: 20 };
}

function getRectCorners(g: Extract<CanvasGeometry, { shape: "rect" }>): Point2D[] {
  return [
    { x: g.x, y: g.y },
    { x: g.x + g.width, y: g.y },
    { x: g.x, y: g.y + g.height },
    { x: g.x + g.width, y: g.y + g.height },
  ];
}

function pointInGeometry(pt: Point2D, g: CanvasGeometry): boolean {
  if (g.shape === "circle") return distance(pt, { x: g.x, y: g.y }) <= g.radius + HIT_PADDING;
  if (g.shape === "ring") {
    const d = distance(pt, { x: g.x, y: g.y });
    return d <= g.rOuter + HIT_PADDING && d >= Math.max(0, g.rInner - HIT_PADDING);
  }
  if (g.shape === "rect") {
    return (
      pt.x >= g.x - HIT_PADDING &&
      pt.x <= g.x + g.width + HIT_PADDING &&
      pt.y >= g.y - HIT_PADDING &&
      pt.y <= g.y + g.height + HIT_PADDING
    );
  }
  if (g.shape === "line") {
    const a = { x: g.x1, y: g.y1 };
    const b = { x: g.x2, y: g.y2 };
    const ab = distance(a, b) || 1;
    const ap = distance(a, pt);
    const bp = distance(b, pt);
    return ap + bp <= ab + HIT_PADDING;
  }
  if (g.shape === "polygon") {
    const xs = g.points.map((p) => p.x);
    const ys = g.points.map((p) => p.y);
    return (
      pt.x >= Math.min(...xs) - HIT_PADDING &&
      pt.x <= Math.max(...xs) + HIT_PADDING &&
      pt.y >= Math.min(...ys) - HIT_PADDING &&
      pt.y <= Math.max(...ys) + HIT_PADDING
    );
  }
  const r = g.region;
  if (r.kind === "rect") {
    return (
      pt.x >= r.x - HIT_PADDING &&
      pt.x <= r.x + r.width + HIT_PADDING &&
      pt.y >= r.y - HIT_PADDING &&
      pt.y <= r.y + r.height + HIT_PADDING
    );
  }
  if (r.kind === "circle") return distance(pt, { x: r.x, y: r.y }) <= r.radius + HIT_PADDING;
  const xs = r.points.map((p) => p.x);
  const ys = r.points.map((p) => p.y);
  return (
    pt.x >= Math.min(...xs) - HIT_PADDING &&
    pt.x <= Math.max(...xs) + HIT_PADDING &&
    pt.y >= Math.min(...ys) - HIT_PADDING &&
    pt.y <= Math.max(...ys) + HIT_PADDING
  );
}

function getHandles(g: CanvasGeometry): Array<{ id: string; x: number; y: number }> {
  if (g.shape === "circle") {
    return [
      { id: "center", x: g.x, y: g.y },
      { id: "radius", x: g.x + g.radius, y: g.y },
    ];
  }
  if (g.shape === "ring") {
    return [
      { id: "center", x: g.x, y: g.y },
      { id: "outer", x: g.x + g.rOuter, y: g.y },
      { id: "inner", x: g.x + g.rInner, y: g.y },
    ];
  }
  if (g.shape === "rect") {
    return getRectCorners(g).map((c, idx) => ({ id: `corner-${idx}`, x: c.x, y: c.y }));
  }
  if (g.shape === "line") {
    return [
      { id: "p1", x: g.x1, y: g.y1 },
      { id: "p2", x: g.x2, y: g.y2 },
    ];
  }
  if (g.shape === "polygon") {
    return g.points.map((p, idx) => ({ id: `v-${idx}`, x: p.x, y: p.y }));
  }
  if (g.region.kind === "rect") {
    return [
      { id: "m-0", x: g.region.x, y: g.region.y },
      { id: "m-1", x: g.region.x + g.region.width, y: g.region.y + g.region.height },
    ];
  }
  if (g.region.kind === "circle") {
    return [
      { id: "m-c", x: g.region.x, y: g.region.y },
      { id: "m-r", x: g.region.x + g.region.radius, y: g.region.y },
    ];
  }
  return g.region.points.map((p, idx) => ({ id: `m-v-${idx}`, x: p.x, y: p.y }));
}

function updatePointGeometry(
  original: CanvasMeasurementPoint,
  mode: "move" | "handle",
  from: Point2D,
  to: Point2D,
  handleId?: string,
): CanvasMeasurementPoint {
  const g = toGeometry(original);
  const dx = to.x - from.x;
  const dy = to.y - from.y;

  let next: CanvasGeometry = g;

  if (mode === "move") {
    if (g.shape === "circle") next = { ...g, x: g.x + dx, y: g.y + dy };
    else if (g.shape === "ring") next = { ...g, x: g.x + dx, y: g.y + dy };
    else if (g.shape === "rect") next = { ...g, x: g.x + dx, y: g.y + dy };
    else if (g.shape === "line") next = { ...g, x1: g.x1 + dx, y1: g.y1 + dy, x2: g.x2 + dx, y2: g.y2 + dy };
    else if (g.shape === "polygon") next = { ...g, points: g.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) };
    else if (g.region.kind === "rect") {
      next = { ...g, region: { ...g.region, x: g.region.x + dx, y: g.region.y + dy } };
    } else if (g.region.kind === "circle") {
      next = { ...g, region: { ...g.region, x: g.region.x + dx, y: g.region.y + dy } };
    } else {
      next = { ...g, region: { ...g.region, points: g.region.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) } };
    }
  } else if (handleId) {
    if (g.shape === "circle") {
      if (handleId === "center") next = { ...g, x: to.x, y: to.y };
      else next = { ...g, radius: Math.max(2, distance({ x: g.x, y: g.y }, to)) };
    } else if (g.shape === "ring") {
      if (handleId === "center") next = { ...g, x: to.x, y: to.y };
      else if (handleId === "outer") next = { ...g, rOuter: Math.max(g.rInner + 1, distance({ x: g.x, y: g.y }, to)) };
      else next = { ...g, rInner: Math.max(1, Math.min(g.rOuter - 1, distance({ x: g.x, y: g.y }, to))) };
    } else if (g.shape === "rect" && handleId.startsWith("corner-")) {
      const idx = Number(handleId.split("-")[1]);
      const corners = getRectCorners(g);
      corners[idx] = to;
      const minX = Math.min(...corners.map((c) => c.x));
      const minY = Math.min(...corners.map((c) => c.y));
      const maxX = Math.max(...corners.map((c) => c.x));
      const maxY = Math.max(...corners.map((c) => c.y));
      next = { ...g, x: minX, y: minY, width: Math.max(2, maxX - minX), height: Math.max(2, maxY - minY) };
    } else if (g.shape === "line") {
      if (handleId === "p1") next = { ...g, x1: to.x, y1: to.y };
      if (handleId === "p2") next = { ...g, x2: to.x, y2: to.y };
    } else if (g.shape === "polygon" && handleId.startsWith("v-")) {
      const idx = Number(handleId.split("-")[1]);
      const pts = g.points.map((p, i) => (i === idx ? { x: to.x, y: to.y } : p));
      next = { ...g, points: pts };
    }
  }

  const anchor = anchorFromGeometry(next);
  return {
    ...original,
    shape: next.shape,
    geometry: next,
    positionX: Math.round(anchor.x),
    positionY: Math.round(anchor.y),
    radius: Math.max(2, Math.round(anchor.radius)),
  };
}

function createGeometryFromDrag(tool: CanvasPointShape, start: Point2D, end: Point2D, radius: number): CanvasGeometry {
  if (tool === "circle") {
    return { shape: "circle", x: start.x, y: start.y, radius: Math.max(2, radius) };
  }
  if (tool === "line") {
    return { shape: "line", x1: start.x, y1: start.y, x2: end.x, y2: end.y, thickness: 2 };
  }
  if (tool === "ring") {
    const ro = Math.max(4, distance(start, end));
    return { shape: "ring", x: start.x, y: start.y, rOuter: ro, rInner: Math.max(2, ro * 0.6) };
  }
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  const width = Math.max(2, Math.abs(end.x - start.x));
  const height = Math.max(2, Math.abs(end.y - start.y));
  if (tool === "rect") return { shape: "rect", x, y, width, height };
  return { shape: "mask", region: { kind: "rect", x, y, width, height }, invert: false };
}

function renderGeometry(g: CanvasGeometry, selected: boolean, onPointerDown: () => void) {
  const stroke = selected ? "#10b981" : "#06b6d4";
  const fill = selected ? "rgba(16,185,129,0.2)" : "rgba(6,182,212,0.15)";
  const common = { stroke, fill, strokeWidth: selected ? 2.5 : 2, onPointerDown };

  if (g.shape === "circle") {
    return <circle cx={g.x} cy={g.y} r={g.radius} {...common} />;
  }
  if (g.shape === "rect") {
    return <rect x={g.x} y={g.y} width={g.width} height={g.height} {...common} />;
  }
  if (g.shape === "line") {
    return <line x1={g.x1} y1={g.y1} x2={g.x2} y2={g.y2} stroke={stroke} strokeWidth={Math.max(2, g.thickness || 2)} onPointerDown={onPointerDown} />;
  }
  if (g.shape === "ring") {
    const d =
      `M ${g.x - g.rOuter},${g.y} a ${g.rOuter},${g.rOuter} 0 1,0 ${g.rOuter * 2},0 a ${g.rOuter},${g.rOuter} 0 1,0 -${g.rOuter * 2},0 ` +
      `M ${g.x - g.rInner},${g.y} a ${g.rInner},${g.rInner} 0 1,0 ${g.rInner * 2},0 a ${g.rInner},${g.rInner} 0 1,0 -${g.rInner * 2},0`;
    return <path d={d} fillRule="evenodd" {...common} />;
  }
  if (g.shape === "polygon") {
    return <polygon points={g.points.map((p) => `${p.x},${p.y}`).join(" ")} {...common} />;
  }
  if (g.region.kind === "rect") {
    return <rect x={g.region.x} y={g.region.y} width={g.region.width} height={g.region.height} strokeDasharray="6 3" {...common} />;
  }
  if (g.region.kind === "circle") {
    return <circle cx={g.region.x} cy={g.region.y} r={g.region.radius} strokeDasharray="6 3" {...common} />;
  }
  return <polygon points={g.region.points.map((p) => `${p.x},${p.y}`).join(" ")} strokeDasharray="6 3" {...common} />;
}

export function MeasurementPointCanvas({
  imageUrl,
  points,
  selectedIndex,
  onSelectIndex,
  onChangePoints,
  isEditMode,
  isDrawing,
  drawTool,
  pointRadius,
  zoomLevel,
  className,
  onDrawingStateChange,
}: MeasurementPointCanvasProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [imageSize, setImageSize] = useState<{ width: number; height: number }>({ width: 1280, height: 720 });
  const [drag, setDrag] = useState<DragState | null>(null);
  const [draw, setDraw] = useState<DrawState | null>(null);
  const [draftPolygon, setDraftPolygon] = useState<Point2D[]>([]);

  const displayScale = Math.max(0.5, Math.min(2, zoomLevel / 100));

  const pointsWithGeometry = useMemo(() => {
    return points.map((p) => ({ ...p, geometry: toGeometry(p) }));
  }, [points]);

  const toSvgPoint = (clientX: number, clientY: number): Point2D => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * imageSize.width;
    const y = ((clientY - rect.top) / rect.height) * imageSize.height;
    return { x: clamp(x, 0, imageSize.width), y: clamp(y, 0, imageSize.height) };
  };

  const commitCreatedPoint = (geometry: CanvasGeometry) => {
    const anchor = anchorFromGeometry(geometry);
    const nextPoint: CanvasMeasurementPoint = {
      code: `MP-${String(points.length + 1).padStart(3, "0")}`,
      positionX: Math.round(anchor.x),
      positionY: Math.round(anchor.y),
      radius: Math.max(2, Math.round(anchor.radius)),
      shape: geometry.shape,
      geometry,
    };
    const updated = [...points, nextPoint];
    onChangePoints(updated);
    onSelectIndex(updated.length - 1);
    onDrawingStateChange?.(false);
  };

  const handlePointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    const pt = toSvgPoint(event.clientX, event.clientY);

    if (isEditMode && isDrawing) {
      if (drawTool === "polygon") {
        setDraftPolygon((prev) => [...prev, pt]);
        return;
      }
      if (drawTool === "circle") {
        commitCreatedPoint(createGeometryFromDrag("circle", pt, pt, pointRadius));
        return;
      }
      setDraw({ tool: drawTool, start: pt, current: pt });
      return;
    }

    if (!isEditMode) return;

    const selected = selectedIndex != null ? pointsWithGeometry[selectedIndex] : null;
    if (selected) {
      const handles = getHandles(selected.geometry as CanvasGeometry);
      const hitHandle = handles.find((h) => distance(pt, { x: h.x, y: h.y }) <= HANDLE_RADIUS + 4);
      if (hitHandle) {
        setDrag({
          index: selectedIndex as number,
          mode: "handle",
          handleId: hitHandle.id,
          start: pt,
          original: selected,
        });
        return;
      }
      if (pointInGeometry(pt, selected.geometry as CanvasGeometry)) {
        setDrag({ index: selectedIndex as number, mode: "move", start: pt, original: selected });
        return;
      }
    }

    for (let i = pointsWithGeometry.length - 1; i >= 0; i--) {
      if (pointInGeometry(pt, pointsWithGeometry[i].geometry as CanvasGeometry)) {
        onSelectIndex(i);
        return;
      }
    }
    onSelectIndex(null);
  };

  const handlePointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const pt = toSvgPoint(event.clientX, event.clientY);
    if (draw) {
      setDraw((prev) => (prev ? { ...prev, current: pt } : prev));
      return;
    }
    if (!drag) return;

    const updated = [...pointsWithGeometry];
    const nextPoint = updatePointGeometry(drag.original, drag.mode, drag.start, pt, drag.handleId);
    updated[drag.index] = nextPoint as any;
    onChangePoints(updated);
  };

  const handlePointerUp = () => {
    if (draw) {
      const geometry = createGeometryFromDrag(draw.tool, draw.start, draw.current, pointRadius);
      commitCreatedPoint(geometry);
      setDraw(null);
    }
    setDrag(null);
  };

  const handleDoubleClick = () => {
    if (!isEditMode || !isDrawing || drawTool !== "polygon") return;
    if (draftPolygon.length < 3) return;
    commitCreatedPoint({ shape: "polygon", points: draftPolygon });
    setDraftPolygon([]);
  };

  const polygonPreviewPoints = useMemo(() => {
    if (draftPolygon.length === 0) return "";
    return draftPolygon.map((p) => `${p.x},${p.y}`).join(" ");
  }, [draftPolygon]);

  const drawPreview = useMemo(() => {
    if (!draw) return null;
    return createGeometryFromDrag(draw.tool, draw.start, draw.current, pointRadius);
  }, [draw, pointRadius]);

  return (
    <div className={className}>
      <div className="overflow-auto border rounded-lg bg-muted/30 max-h-125">
        <svg
          ref={svgRef}
          width={imageSize.width * displayScale}
          height={imageSize.height * displayScale}
          viewBox={`0 0 ${imageSize.width} ${imageSize.height}`}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
          onDoubleClick={handleDoubleClick}
          style={{ cursor: isEditMode ? (isDrawing ? "crosshair" : "move") : "default" }}
        >
          <image
            href={imageUrl}
            x={0}
            y={0}
            width={imageSize.width}
            height={imageSize.height}
            preserveAspectRatio="none"
            onLoad={(e) => {
              const img = e.currentTarget as unknown as { width: { baseVal: { value: number } }; height: { baseVal: { value: number } } };
              if (img.width?.baseVal?.value && img.height?.baseVal?.value) {
                setImageSize({ width: img.width.baseVal.value, height: img.height.baseVal.value });
              }
            }}
          />

          {pointsWithGeometry.map((p, index) => {
            const selected = index === selectedIndex;
            const g = p.geometry as CanvasGeometry;
            return (
              <g key={`${p.id ?? "new"}-${index}`}>
                {renderGeometry(g, selected, () => onSelectIndex(index))}
                {selected &&
                  isEditMode &&
                  getHandles(g).map((h) => (
                    <circle key={h.id} cx={h.x} cy={h.y} r={HANDLE_RADIUS} fill="#ffffff" stroke="#10b981" strokeWidth={2} />
                  ))}
              </g>
            );
          })}

          {drawPreview && <g>{renderGeometry(drawPreview, true, () => {})}</g>}

          {draftPolygon.length > 0 && (
            <g>
              <polyline points={polygonPreviewPoints} fill="rgba(6,182,212,0.1)" stroke="#06b6d4" strokeWidth={2} />
              {draftPolygon.map((p, idx) => (
                <circle key={`draft-${idx}`} cx={p.x} cy={p.y} r={4} fill="#06b6d4" />
              ))}
            </g>
          )}
        </svg>
      </div>
    </div>
  );
}

export default MeasurementPointCanvas;
