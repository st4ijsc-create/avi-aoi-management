// P1: Multi-shape measurement geometry — zod schemas + TS types.
// Geometry payloads are persisted in `measurement_point_defs.geometry` (jsonb)
// and discriminated by `measurement_point_defs.shape` (varchar).
//
// For shape="circle" we keep legacy positionX/positionY/radius columns in sync
// (derived in router). For all other shapes those columns hold a representative
// point (geometry centroid or first vertex) so legacy clients keep working.

import { z } from "zod";

export const POINT_SHAPES = [
  "circle",
  "rect",
  "polygon",
  "line",
  "ring",
  "mask",
  "array",
] as const;
export type PointShape = (typeof POINT_SHAPES)[number];
export const pointShapeEnum = z.enum(POINT_SHAPES);

// --- atomic ---
const numberSchema = z.number().finite();
const nonNegSchema = z.number().finite().min(0);
const point2dSchema = z.object({ x: numberSchema, y: numberSchema });

// --- per-shape geometry ---
export const circleGeometrySchema = z.object({
  shape: z.literal("circle"),
  x: numberSchema,
  y: numberSchema,
  radius: nonNegSchema,
});

export const rectGeometrySchema = z.object({
  shape: z.literal("rect"),
  x: numberSchema,        // top-left x
  y: numberSchema,        // top-left y
  width: nonNegSchema,
  height: nonNegSchema,
  rotation: numberSchema.optional(), // degrees, optional
});

export const polygonGeometrySchema = z.object({
  shape: z.literal("polygon"),
  points: z.array(point2dSchema).min(3),
});

export const lineGeometrySchema = z.object({
  shape: z.literal("line"),
  x1: numberSchema,
  y1: numberSchema,
  x2: numberSchema,
  y2: numberSchema,
  thickness: nonNegSchema.optional(),
});

export const ringGeometrySchema = z.object({
  shape: z.literal("ring"),
  x: numberSchema,
  y: numberSchema,
  rOuter: nonNegSchema,
  rInner: nonNegSchema,
});

const maskRegionSchema = z.union([
  z.object({ kind: z.literal("rect"), x: numberSchema, y: numberSchema, width: nonNegSchema, height: nonNegSchema }),
  z.object({ kind: z.literal("polygon"), points: z.array(point2dSchema).min(3) }),
  z.object({ kind: z.literal("circle"), x: numberSchema, y: numberSchema, radius: nonNegSchema }),
]);

export const maskGeometrySchema = z.object({
  shape: z.literal("mask"),
  region: maskRegionSchema,
  invert: z.boolean().optional(), // if true, mask area is excluded
});

// Cell shape inside an array. Reuse circle/rect for cells.
const arrayCellShapeSchema = z.enum(["circle", "rect"]);
const arrayCellGeometrySchema = z.union([
  z.object({ radius: nonNegSchema }),                                    // for cellShape=circle
  z.object({ width: nonNegSchema, height: nonNegSchema }),               // for cellShape=rect
]);

export const arrayGeometrySchema = z.object({
  shape: z.literal("array"),
  rows: z.number().int().positive(),
  cols: z.number().int().positive(),
  pitchX: numberSchema,
  pitchY: numberSchema,
  originX: numberSchema,    // top-left X of cell (0,0)
  originY: numberSchema,    // top-left Y of cell (0,0)
  cellShape: arrayCellShapeSchema,
  cellGeometry: arrayCellGeometrySchema,
});

export const measurementGeometrySchema = z.discriminatedUnion("shape", [
  circleGeometrySchema,
  rectGeometrySchema,
  polygonGeometrySchema,
  lineGeometrySchema,
  ringGeometrySchema,
  maskGeometrySchema,
  arrayGeometrySchema,
]);

export type CircleGeometry = z.infer<typeof circleGeometrySchema>;
export type RectGeometry = z.infer<typeof rectGeometrySchema>;
export type PolygonGeometry = z.infer<typeof polygonGeometrySchema>;
export type LineGeometry = z.infer<typeof lineGeometrySchema>;
export type RingGeometry = z.infer<typeof ringGeometrySchema>;
export type MaskGeometry = z.infer<typeof maskGeometrySchema>;
export type ArrayGeometry = z.infer<typeof arrayGeometrySchema>;
export type MeasurementGeometry = z.infer<typeof measurementGeometrySchema>;

/**
 * Derive a representative center + radius from any geometry so legacy
 * positionX/positionY/radius columns stay populated for backward compatibility.
 * radius is approximate bounding-circle half-extent for non-circular shapes.
 */
export function deriveLegacyAnchor(g: MeasurementGeometry): { x: number; y: number; radius: number } {
  switch (g.shape) {
    case "circle":
      return { x: g.x, y: g.y, radius: g.radius };
    case "rect": {
      const cx = g.x + g.width / 2;
      const cy = g.y + g.height / 2;
      return { x: cx, y: cy, radius: Math.max(g.width, g.height) / 2 };
    }
    case "polygon": {
      let sx = 0, sy = 0;
      for (const p of g.points) { sx += p.x; sy += p.y; }
      const cx = sx / g.points.length;
      const cy = sy / g.points.length;
      let maxR = 0;
      for (const p of g.points) {
        const d = Math.hypot(p.x - cx, p.y - cy);
        if (d > maxR) maxR = d;
      }
      return { x: cx, y: cy, radius: maxR };
    }
    case "line": {
      const cx = (g.x1 + g.x2) / 2;
      const cy = (g.y1 + g.y2) / 2;
      return { x: cx, y: cy, radius: Math.hypot(g.x2 - g.x1, g.y2 - g.y1) / 2 };
    }
    case "ring":
      return { x: g.x, y: g.y, radius: g.rOuter };
    case "mask": {
      const r = g.region;
      if (r.kind === "rect") {
        return { x: r.x + r.width / 2, y: r.y + r.height / 2, radius: Math.max(r.width, r.height) / 2 };
      }
      if (r.kind === "circle") {
        return { x: r.x, y: r.y, radius: r.radius };
      }
      // polygon
      let sx = 0, sy = 0;
      for (const p of r.points) { sx += p.x; sy += p.y; }
      const cx = sx / r.points.length;
      const cy = sy / r.points.length;
      let maxR = 0;
      for (const p of r.points) {
        const d = Math.hypot(p.x - cx, p.y - cy);
        if (d > maxR) maxR = d;
      }
      return { x: cx, y: cy, radius: maxR };
    }
    case "array": {
      const cx = g.originX + (g.cols * g.pitchX) / 2;
      const cy = g.originY + (g.rows * g.pitchY) / 2;
      const r = Math.max(g.cols * g.pitchX, g.rows * g.pitchY) / 2;
      return { x: cx, y: cy, radius: r };
    }
  }
}

export interface ExpandedArrayCell {
  rowIndex: number;
  colIndex: number;
  shape: "circle" | "rect";
  geometry: CircleGeometry | RectGeometry;
}

/**
 * Expand a `shape=array` geometry into N child cells. Used by deltaSyncPoints
 * so machine clients receive concrete per-cell geometry without needing to
 * understand the array primitive.
 */
export function expandArrayGeometry(g: ArrayGeometry): ExpandedArrayCell[] {
  const out: ExpandedArrayCell[] = [];
  for (let r = 0; r < g.rows; r++) {
    for (let c = 0; c < g.cols; c++) {
      const x = g.originX + c * g.pitchX;
      const y = g.originY + r * g.pitchY;
      if (g.cellShape === "circle") {
        const cell = g.cellGeometry as { radius: number };
        out.push({
          rowIndex: r, colIndex: c, shape: "circle",
          geometry: { shape: "circle", x, y, radius: cell.radius },
        });
      } else {
        const cell = g.cellGeometry as { width: number; height: number };
        out.push({
          rowIndex: r, colIndex: c, shape: "rect",
          geometry: { shape: "rect", x, y, width: cell.width, height: cell.height },
        });
      }
    }
  }
  return out;
}
