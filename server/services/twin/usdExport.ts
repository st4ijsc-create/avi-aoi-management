/**
 * doc 24 Wave-3 T3 — USD (USDA / ASCII) scene-interchange EXPORTER.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Emits the bespoke scene-graph (sceneGraph.ts) as a valid USDA stage — a `Xform`
 * hierarchy mirroring factory → zone/line → station → device — so the twin can be
 * opened in Omniverse / Isaac Sim / any USD tool for interchange. PURE STRING emitter:
 * no dependency (USDA is plain text), no USD SDK.
 *
 * MAPPING:
 *   • factory        → root `def Xform "<factory>" ( kind = "assembly" )`.
 *   • zones          → `def Scope "Zones"` → one `def Xform` per zone (metadata only;
 *                      zone bounds are free-form so no transform is fabricated).
 *   • lines/stations → `def Scope "Lines"` → `def Xform` per line → per station.
 *   • device         → `def Xform "<device>"` carrying:
 *       - `double3 xformOp:translate` from the device layout coords (0,0,0 fallback)
 *         + `uniform token[] xformOpOrder = ["xformOp:translate"]`.
 *       - `references = @<modelUri>@` when a glTF asset is registered; otherwise a
 *         child placeholder `def Cube "geo"` (honest — no faked geometry).
 *       - `custom string st4i:deviceId/state/kind` provenance attrs.
 *   • robot joints   → nested `def Xform "Joint_N"` chain with `xformOp:rotateZ`
 *                      (revolute assumption — the scene-graph carries joint VALUES, not
 *                      per-joint axes; documented simplification). Emitted only when the
 *                      robot reports a joints vector.
 *   • orphan devices → devices with no station are emitted under `def Scope
 *                      "UnassignedDevices"` so EVERY device round-trips exactly once.
 *
 * DEGRADE-SAFE: a null-factory / empty scene-graph → a valid EMPTY stage (header +
 * metadata, no prims), never a throw. DEFERRED (honest): USD materials, physics
 * (UsdPhysics joints/colliders), and true per-joint kinematics (axis/rest transform) —
 * this phase emits geometry hierarchy + placeholder articulation only.
 * ════════════════════════════════════════════════════════════════════════════
 */
import type { SceneGraph, DeviceNode, ZoneNode } from "./sceneGraph";

/** Options for the USDA export (reserved for future units/up-axis overrides). */
export interface UsdExportOptions {
  /** Stage up-axis (default "Z" — USD default is "Y", but factory layouts are Z-up). */
  upAxis?: "Y" | "Z";
  /** metersPerUnit (default 1). */
  metersPerUnit?: number;
}

/**
 * Sanitize an arbitrary id into a valid USD prim name: `[A-Za-z_][A-Za-z0-9_]*`.
 * Non-conforming chars → "_"; a leading digit is prefixed with "_". PURE + exported
 * for unit-testing (e.g. "machine:12" → "machine_12").
 */
export function usdSanitizeName(raw: string): string {
  let s = (raw ?? "").replace(/[^A-Za-z0-9_]/g, "_");
  if (s.length === 0) s = "_";
  if (/^[0-9]/.test(s)) s = `_${s}`;
  return s;
}

/** Escape a value for a USD double-quoted string. */
function usdString(s: string): string {
  return `"${String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** Escape an asset path for a USD `@...@` reference (strip the delimiter char). */
function usdAssetPath(uri: string): string {
  return `@${String(uri).replace(/@/g, "%40")}@`;
}

/** Small indentation-aware line builder that guarantees balanced braces. */
class UsdaBuilder {
  private lines: string[] = [];
  private depth = 0;
  private readonly pad = "    ";

  line(text = ""): void {
    this.lines.push(text.length ? this.pad.repeat(this.depth) + text : "");
  }

  /** Open a scope `<header>\n{` and increase indent. */
  open(header: string): void {
    this.line(header);
    this.line("{");
    this.depth++;
  }

  /**
   * Open a scope that carries prim metadata: `<header> (\n  <meta…>\n)\n{`, then
   * increase indent. Keeps the private depth encapsulated (no external mutation).
   */
  openMeta(header: string, meta: string[]): void {
    this.line(`${header} (`);
    this.depth++;
    for (const m of meta) this.line(m);
    this.depth--;
    this.line(`)`);
    this.line("{");
    this.depth++;
  }

  /** Close the current scope `}` and decrease indent. */
  close(): void {
    this.depth = Math.max(0, this.depth - 1);
    this.line("}");
  }

  toString(): string {
    return this.lines.join("\n") + "\n";
  }
}

/** Emit the translate xformOp + order for a device prim body. */
function emitTransform(b: UsdaBuilder, pos: { x: number; y: number; z?: number } | null): void {
  const x = pos?.x ?? 0;
  const y = pos?.y ?? 0;
  const z = pos?.z ?? 0;
  b.line(`double3 xformOp:translate = (${num(x)}, ${num(y)}, ${num(z)})`);
  b.line(`uniform token[] xformOpOrder = ["xformOp:translate"]`);
}

/** Format a number for USDA (finite → plain; non-finite → 0). */
function num(n: number): string {
  return Number.isFinite(n) ? String(n) : "0";
}

/** Emit a nested Joint_N xform chain for a robot's joint vector (revolute assumption). */
function emitJointChain(b: UsdaBuilder, joints: number[]): void {
  // Nest each joint under the previous so the chain reads as an articulated hierarchy.
  for (let i = 0; i < joints.length; i++) {
    const deg = Number.isFinite(joints[i]) ? (joints[i] * 180) / Math.PI : 0;
    b.open(`def Xform "Joint_${i}"`);
    b.line(`double xformOp:rotateZ = ${num(deg)}`);
    b.line(`uniform token[] xformOpOrder = ["xformOp:rotateZ"]`);
  }
  // Close them all (deepest last-opened first).
  for (let i = 0; i < joints.length; i++) b.close();
}

/** Emit one device prim (Xform + transform + reference-or-placeholder + provenance). */
function emitDevice(b: UsdaBuilder, d: DeviceNode): void {
  const name = usdSanitizeName(d.id);
  if (d.modelUri) {
    // Reference the registered glTF asset via prim metadata.
    b.openMeta(`def Xform "${name}"`, [`references = ${usdAssetPath(d.modelUri)}`]);
  } else {
    b.open(`def Xform "${name}"`);
  }

  emitTransform(b, d.position);
  b.line(`custom string st4i:deviceId = ${usdString(d.id)}`);
  b.line(`custom string st4i:kind = ${usdString(d.kind)}`);
  b.line(`custom string st4i:state = ${usdString(d.state)}`);

  // No registered asset → an honest placeholder cube (not faked geometry).
  if (!d.modelUri) {
    b.open(`def Cube "geo"`);
    b.line(`double size = 200`);
    b.close();
  }

  // Robot articulation: nested joint xforms when joint telemetry exists.
  if (d.kind === "robot" && d.joints && d.joints.length > 0) {
    emitJointChain(b, d.joints);
  }

  b.close();
}

/** Emit one zone prim (metadata only — bounds are free-form). */
function emitZone(b: UsdaBuilder, z: ZoneNode): void {
  b.open(`def Xform "${usdSanitizeName(z.id)}"`);
  b.line(`custom string st4i:zoneType = ${usdString(z.zoneType)}`);
  b.line(`custom int st4i:maxConcurrentRobots = ${num(z.maxConcurrentRobots)}`);
  b.close();
}

/**
 * PURE — export a scene-graph as a USDA (ASCII USD) stage string. DB-free.
 * Degrade-safe: an empty / null-factory graph → a valid empty stage.
 */
export function sceneGraphToUsda(graph: SceneGraph, opts?: UsdExportOptions): string {
  const b = new UsdaBuilder();
  const upAxis = opts?.upAxis ?? "Z";
  const metersPerUnit = opts?.metersPerUnit ?? 1;

  b.line(`#usda 1.0`);

  // Empty / degenerate stage: header + metadata only, no prims (still valid USDA).
  if (!graph.factory) {
    b.line(`(`);
    b.line(`    doc = "ST4I twin USD export — empty stage (no factory)"`);
    b.line(`    metersPerUnit = ${num(metersPerUnit)}`);
    b.line(`    upAxis = "${upAxis}"`);
    b.line(`)`);
    return b.toString();
  }

  const factoryPrim = usdSanitizeName(`factory:${graph.factory.id}`);

  // Stage metadata.
  b.line(`(`);
  b.line(`    defaultPrim = "${factoryPrim}"`);
  b.line(`    doc = ${usdString(`ST4I twin USD export — ${graph.factory.name} (ts ${graph.ts})`)}`);
  b.line(`    metersPerUnit = ${num(metersPerUnit)}`);
  b.line(`    upAxis = "${upAxis}"`);
  b.line(`)`);
  b.line();

  // Root factory Xform (assembly).
  b.openMeta(`def Xform "${factoryPrim}"`, [`kind = "assembly"`]);
  b.line(`custom string st4i:factoryCode = ${usdString(graph.factory.code)}`);

  // Zones scope.
  if (graph.zones.length > 0) {
    b.open(`def Scope "Zones"`);
    for (const z of graph.zones) emitZone(b, z);
    b.close();
  }

  // Track which devices are emitted under a station so orphans can be swept up.
  const nestedDeviceIds = new Set<string>();

  // Lines scope.
  if (graph.lines.length > 0) {
    b.open(`def Scope "Lines"`);
    for (const line of graph.lines) {
      b.open(`def Xform "${usdSanitizeName(line.id)}"`);
      b.line(`custom string st4i:lineCode = ${usdString(line.code)}`);
      for (const station of line.stations) {
        b.open(`def Xform "${usdSanitizeName(station.id)}"`);
        b.line(`custom string st4i:stationCode = ${usdString(station.code)}`);
        for (const d of station.devices) {
          nestedDeviceIds.add(d.id);
          emitDevice(b, d);
        }
        b.close(); // station
      }
      b.close(); // line
    }
    b.close(); // Lines scope
  }

  // Orphan devices (no station) → an UnassignedDevices scope so EVERY device appears.
  const orphans = graph.devices.filter((d) => !nestedDeviceIds.has(d.id));
  if (orphans.length > 0) {
    b.open(`def Scope "UnassignedDevices"`);
    for (const d of orphans) emitDevice(b, d);
    b.close();
  }

  b.close(); // factory
  return b.toString();
}

/**
 * DB-bound convenience — build the USDA string for a factory. Lazily builds the
 * scene-graph and emits it. Read-only. Degrade-safe: no DB / no factory → empty stage.
 */
export async function buildFactoryUsda(factoryId: number, opts?: UsdExportOptions): Promise<string> {
  const { buildSceneGraph } = await import("./sceneGraph");
  const graph = await buildSceneGraph(factoryId);
  return sceneGraphToUsda(graph, opts);
}
