/**
 * T2b — SCENE ADAPTER: T1 scene-graph geometry → the SimScene the kinematic gate needs.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * The Simulation Gate consumes a SimScene = { obstacles: Obstacle[], safetyZones:
 * SafetyZone[] }. This module converts the T1 SceneGraph's device bounds + zone bounds
 * into world AABB volumes. It is PURE + degrade-safe: geometry we can't parse is skipped
 * (never fabricated). When the scene has no usable geometry, an EMPTY scene is returned —
 * the gate then only catches joint-limit / workspace violations (honest).
 *
 * Coordinate honesty: most devices today carry only normalized layout positions and no
 * metric bounds (documented across T1/occupancyGrid). So this adapter uses whatever
 * explicit `bounds` blob exists ({x,y,w,h} or {min,max}) and skips the rest. When T2a
 * lands real geometry, more obstacles populate automatically — no code change here.
 * ════════════════════════════════════════════════════════════════════════════
 */
import type { SceneGraph } from "../../twin/sceneGraph";
import type { Vec3 } from "./kinematicModel";
import type { Obstacle } from "./collision";
import type { SafetyZone, SimScene } from "./kinematicSimGate";

/** Zone types that represent a human/safety region a link must not enter. */
const SAFETY_ZONE_TYPES = new Set(["human_shared", "safety"]);

/** Coerce a jsonb bounds blob into a world AABB (min,max in mm). Supports two shapes. */
export function boundsToAabb(bounds: Record<string, unknown> | null | undefined): { min: Vec3; max: Vec3 } | null {
  if (!bounds) return null;
  // shape A: { x, y, w, h [, z, d] }  — a footprint tile (z defaults 0, height default 500mm).
  if (typeof bounds.x === "number" && typeof bounds.y === "number" && typeof bounds.w === "number" && typeof bounds.h === "number") {
    const z0 = typeof bounds.z === "number" ? bounds.z : 0;
    const d = typeof bounds.d === "number" ? bounds.d : 500;
    return { min: [bounds.x, bounds.y, z0], max: [bounds.x + bounds.w, bounds.y + bounds.h, z0 + d] };
  }
  // shape B: { min:[x,y,z], max:[x,y,z] }
  const min = bounds.min as number[] | undefined;
  const max = bounds.max as number[] | undefined;
  if (Array.isArray(min) && Array.isArray(max) && min.length >= 2 && max.length >= 2) {
    return {
      min: [min[0], min[1], min[2] ?? 0],
      max: [max[0], max[1], max[2] ?? 500],
    };
  }
  return null;
}

/**
 * Build a SimScene from a T1 SceneGraph. Device bounds → obstacles; safety/human_shared
 * zone bounds → safetyZones (AND obstacles, so a link both intruding a zone and colliding
 * its volume is caught). PURE + degrade-safe.
 */
export function sceneFromGraph(graph: SceneGraph): SimScene {
  const obstacles: Obstacle[] = [];
  const safetyZones: SafetyZone[] = [];

  for (const dev of graph.devices) {
    const aabb = boundsToAabb(dev.bounds);
    if (aabb) obstacles.push({ id: dev.id, label: dev.name, volume: { kind: "aabb", min: aabb.min, max: aabb.max } });
  }

  for (const z of graph.zones) {
    const aabb = boundsToAabb(z.bounds);
    if (!aabb) continue;
    if (SAFETY_ZONE_TYPES.has(z.zoneType)) {
      safetyZones.push({ id: z.id, zoneType: z.zoneType, min: aabb.min, max: aabb.max });
      // A safety zone is also a soft obstacle volume for proximity margin.
      obstacles.push({ id: z.id, label: z.name, volume: { kind: "aabb", min: aabb.min, max: aabb.max } });
    }
  }

  return { obstacles, safetyZones };
}

/** An empty scene (no geometry) — the honest fallback when nothing is parseable. */
export const EMPTY_SCENE: SimScene = { obstacles: [], safetyZones: [] };
