/**
 * doc 24 Wave-3 T3 + Tier-2 (Twin) — USD (USDA / ASCII) scene-interchange EXPORTER.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Emits the bespoke scene-graph (sceneGraph.ts) as a valid USDA stage — a `Xform`
 * hierarchy mirroring factory → zone/line → station → device — so the twin can be
 * opened in Omniverse / Isaac Sim / any USD tool for interchange. PURE STRING emitter:
 * no dependency (USDA is plain text), no USD SDK.
 *
 * MAPPING:
 *   • factory        → root `def Xform "<factory>" ( kind = "assembly" )`.
 *   • materials      → `def Scope "Looks"` under the factory carrying one
 *                      `UsdPreviewSurface` `def Material "Mat_<state>"` per device STATE
 *                      that appears (running=green, aborted/estop=red, idle/…=grey — the
 *                      same state→colour semantics the viewer uses). Every device prim (and
 *                      its placeholder geometry) `rel material:binding`-s the material for
 *                      its live state, so the exported stage is visually meaningful.
 *   • zones          → `def Scope "Zones"` → one `def Xform` per zone (metadata only).
 *   • lines/stations → `def Scope "Lines"` → `def Xform` per line → per station.
 *   • device         → `def Xform "<device>"` carrying:
 *       - `double3 xformOp:translate` from the device layout coords (0,0,0 fallback).
 *       - `references = @<modelUri>@` when a glTF asset is registered; otherwise a
 *         child placeholder `def Cube "geo"` (honest — no faked geometry).
 *       - `custom string st4i:deviceId/state/kind` provenance attrs.
 *       - `rel material:binding` to the per-state material.
 *   • robot joints   → TRUE per-joint kinematics: a nested `def Xform "Joint_N"` chain
 *                      derived from the robot's resolved kinematic model (kinematicModel.ts).
 *                      Each Joint carries the joint's REST transform (matrix4d, from the
 *                      DH/URDF chain) + a motion op along the joint's AXIS (revolute →
 *                      rotate about the axis; prismatic → translate along it), plus
 *                      `st4i:jointAxis/jointType/jointValue` provenance. Falls back to the
 *                      legacy `rotateZ` placeholder chain ONLY when no kinematic model
 *                      resolves for the robot.
 *   • physics        → OPT-IN (`includePhysics`) UsdPhysics layer: a `PhysicsScene`, a
 *                      `PhysicsRigidBodyAPI`/`PhysicsCollisionAPI` on device prims, and — for
 *                      robots with a kinematic model — a `PhysicsArticulationRootAPI` on the
 *                      robot plus a flat `def Scope "Physics"` of rigid-body links +
 *                      `PhysicsRevoluteJoint`/`PhysicsPrismaticJoint` articulation joints
 *                      (axis + lower/upper limits from the model). Physics-off keeps the
 *                      geometry-only export intact + backward-compatible.
 *   • orphan devices → devices with no station are emitted under `def Scope
 *                      "UnassignedDevices"` so EVERY device round-trips exactly once.
 *
 * DEGRADE-SAFE: a null-factory / empty scene-graph → a valid EMPTY stage (header +
 * metadata, no prims), never a throw.
 * ════════════════════════════════════════════════════════════════════════════
 */
import type { SceneGraph, DeviceNode, ZoneNode, NormalizedState } from "./sceneGraph";
import {
  SAMPLE_MODELS,
  type KinematicModel,
  type KinematicJoint,
  type Mat4,
  type Vec3,
  mat4Identity,
  mat4Mul,
  mat4Origin,
  dhTransform,
} from "../programming/sim/kinematicModel";

/** Options for the USDA export. */
export interface UsdExportOptions {
  /** Stage up-axis (default "Z" — USD default is "Y", but factory layouts are Z-up). */
  upAxis?: "Y" | "Z";
  /** metersPerUnit (default 1). */
  metersPerUnit?: number;
  /**
   * Emit `UsdPreviewSurface` materials (a per-device-state `Looks` scope) + bind them.
   * Default TRUE — materials are additive metadata (they never alter the geometry prims),
   * so the geometry hierarchy + T3 structural contract is unchanged. Set FALSE for a bare
   * geometry-only stage.
   */
  includeMaterials?: boolean;
  /**
   * OPT-IN UsdPhysics layer (PhysicsScene + rigid bodies + articulation joints). Default
   * FALSE so the geometry-only export is unchanged + backward-compatible.
   */
  includePhysics?: boolean;
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

/** Format a number for USDA (finite → plain; non-finite → 0). */
function num(n: number): string {
  return Number.isFinite(n) ? String(n) : "0";
}

/** Format a Vec3 as a USDA tuple `(x, y, z)`. */
function vec3(v: Vec3 | readonly number[]): string {
  return `(${num(v[0])}, ${num(v[1])}, ${num(v[2])})`;
}

/**
 * Format a column-major Mat4 (kinematicModel convention, m[col*4+row]) as a USDA
 * `matrix4d` value. USD authors matrix4d in ROW-vector convention (a point transforms as
 * `p * M`, translation in the LAST ROW), which is the TRANSPOSE of our column-major
 * `M · p` matrix. Chunking the column-major array in groups of four yields the columns,
 * which become USD's rows — i.e. exactly that transpose — so translation lands in row 3.
 */
function fmtMat4(m: Mat4): string {
  const row = (o: number) => `(${num(m[o])}, ${num(m[o + 1])}, ${num(m[o + 2])}, ${num(m[o + 3])})`;
  return `(${row(0)}, ${row(4)}, ${row(8)}, ${row(12)})`;
}

// ── State → material colour (the viewer's state→colour semantics) ─────────────
//
// Bridges the normalized PackML-ish device state → the twin viewer palette
// (digitalTwinService.TWIN_STATUS_COLORS): running=green, fault(aborted/estop)=red,
// idle/stopped/offline/unknown=grey, held=purple. Kept here (not imported) so the pure
// emitter stays dependency-light; the semantics match what the 3D scene renders.
const STATE_COLORS: Record<NormalizedState, string> = {
  running: "#22c55e", // green
  idle: "#9ca3af", // grey
  stopped: "#6b7280", // dark grey
  held: "#a855f7", // purple (maintenance-ish)
  aborted: "#ef4444", // red (fault)
  estop: "#dc2626", // deep red (e-stop)
  offline: "#4b5563", // slate grey
  unknown: "#9ca3af", // grey
};

/** Hex "#rrggbb" → normalized [r,g,b] in 0..1 (fallback grey on a bad value). */
function hexTo01(hex: string): [number, number, number] {
  const h = (hex || "").replace("#", "");
  if (h.length !== 6) return [0.6, 0.6, 0.6];
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  return [Number.isFinite(r) ? r : 0.6, Number.isFinite(g) ? g : 0.6, Number.isFinite(b) ? b : 0.6];
}

/** Round to 4 dp so the emitted colour string is compact + deterministic. */
function r4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
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

/** Rendering context threaded through the emit helpers. */
interface UsdCtx {
  b: UsdaBuilder;
  includeMaterials: boolean;
  includePhysics: boolean;
  /** Absolute prim path of the `Looks` scope, e.g. "/factory_1/Looks". */
  looksRoot: string;
}

/** Emit the translate xformOp + order for a device prim body. */
function emitTransform(b: UsdaBuilder, pos: { x: number; y: number; z?: number } | null): void {
  const x = pos?.x ?? 0;
  const y = pos?.y ?? 0;
  const z = pos?.z ?? 0;
  b.line(`double3 xformOp:translate = (${num(x)}, ${num(y)}, ${num(z)})`);
  b.line(`uniform token[] xformOpOrder = ["xformOp:translate"]`);
}

/** Material binding line to the per-state material (absolute prim path). */
function materialBinding(ctx: UsdCtx, state: NormalizedState): string {
  return `rel material:binding = <${ctx.looksRoot}/Mat_${state}>`;
}

// ── Kinematic-model resolution + per-joint frames ─────────────────────────────

/** Resolve the authored kinematic model for a robot device (null when none). */
function resolveDeviceModel(d: DeviceNode): KinematicModel | null {
  if (d.kind !== "robot" || !d.kinematicModelId) return null;
  return SAMPLE_MODELS[d.kinematicModelId] ?? null;
}

/** The value-independent (rest) transform of a joint — DH-at-zero or the URDF <origin>. */
function jointRestTransform(j: KinematicJoint): Mat4 {
  if (j.local) return j.local.restTransform;
  return dhTransform(j.dh.a, j.dh.alpha, j.dh.d, j.dh.theta);
}

/** Classify a (possibly non-normalized) axis against the six canonical directions. */
type AxisClass = "X" | "Y" | "Z" | "-X" | "-Y" | "-Z" | "arbitrary";
function classifyAxis(a: Vec3): AxisClass {
  const n = Math.hypot(a[0], a[1], a[2]);
  if (n < 1e-9) return "arbitrary";
  const x = a[0] / n, y = a[1] / n, z = a[2] / n, t = 1e-6;
  if (Math.abs(x - 1) < t && Math.abs(y) < t && Math.abs(z) < t) return "X";
  if (Math.abs(x + 1) < t && Math.abs(y) < t && Math.abs(z) < t) return "-X";
  if (Math.abs(y - 1) < t && Math.abs(x) < t && Math.abs(z) < t) return "Y";
  if (Math.abs(y + 1) < t && Math.abs(x) < t && Math.abs(z) < t) return "-Y";
  if (Math.abs(z - 1) < t && Math.abs(x) < t && Math.abs(y) < t) return "Z";
  if (Math.abs(z + 1) < t && Math.abs(x) < t && Math.abs(y) < t) return "-Z";
  return "arbitrary";
}

/** Canonical USD physics axis token (unsigned; sign is folded into the motion sign). */
function axisTokenOf(cls: AxisClass): "X" | "Y" | "Z" {
  if (cls === "X" || cls === "-X") return "X";
  if (cls === "Y" || cls === "-Y") return "Y";
  return "Z";
}

/** A resolved per-joint frame for USD emission (one per NON-fixed joint). */
interface JointFrame {
  name: string;
  type: "revolute" | "prismatic";
  /** Fixed parent→joint transform (folds any preceding fixed joints). */
  restTransform: Mat4;
  axis: Vec3;
  axisClass: AxisClass;
  axisToken: "X" | "Y" | "Z";
  /**
   * Where the joint motion multiplies relative to `restTransform`:
   *   "pre"  → T(v) = motion(v) · rest   (authored DH chains: the joint variable is the
   *            leading Rot_z(θ)/Trans_z(d), so it commutes to the OUTSIDE of the rest DH).
   *   "post" → T(v) = rest · motion(v)   (URDF-derived chains: <origin> then <axis> motion).
   */
  motionSide: "pre" | "post";
  limits?: { min: number; max: number };
}

/**
 * Resolve one JointFrame per NON-fixed joint of the model. Preceding fixed joints are
 * folded into the next movable joint's rest transform. Exact for the authored DH samples
 * (no fixed joints) and for URDF-derived all-`local` chains.
 */
function resolveJointFrames(model: KinematicModel): JointFrame[] {
  const out: JointFrame[] = [];
  let pending = mat4Identity();
  for (const j of model.joints) {
    if (j.type === "fixed") {
      pending = mat4Mul(pending, jointRestTransform(j));
      continue;
    }
    const axis: Vec3 = j.local ? j.local.axis : [0, 0, 1];
    const motionSide: "pre" | "post" = j.local ? "post" : "pre";
    const rest = mat4Mul(pending, jointRestTransform(j));
    pending = mat4Identity();
    const axisClass = classifyAxis(axis);
    out.push({
      name: j.name,
      type: j.type,
      restTransform: rest,
      axis,
      axisClass,
      axisToken: axisTokenOf(axisClass),
      motionSide,
      ...(j.limits ? { limits: j.limits } : {}),
    });
  }
  return out;
}

/** Unit-quaternion (w,x,y,z) for a rotation of `angle` rad about `axis`. */
function quatFromAxisAngle(axis: Vec3, angle: number): { w: number; x: number; y: number; z: number } {
  const n = Math.hypot(axis[0], axis[1], axis[2]);
  if (n < 1e-9) return { w: 1, x: 0, y: 0, z: 0 };
  const h = angle / 2, s = Math.sin(h) / n;
  return { w: Math.cos(h), x: axis[0] * s, y: axis[1] * s, z: axis[2] * s };
}

/** The single motion xformOp (name + line) for a joint at `value` (rad / mm). */
function motionOp(f: JointFrame, value: number): { opName: string; line: string } {
  if (f.type === "prismatic") {
    const t: Vec3 = [f.axis[0] * value, f.axis[1] * value, f.axis[2] * value];
    return { opName: "xformOp:translate:joint", line: `double3 xformOp:translate:joint = ${vec3(t)}` };
  }
  // revolute — degrees for the USD rotate ops.
  const deg = (value * 180) / Math.PI;
  switch (f.axisClass) {
    case "Z":
      return { opName: "xformOp:rotateZ", line: `double xformOp:rotateZ = ${num(deg)}` };
    case "-Z":
      return { opName: "xformOp:rotateZ", line: `double xformOp:rotateZ = ${num(-deg)}` };
    case "X":
      return { opName: "xformOp:rotateX", line: `double xformOp:rotateX = ${num(deg)}` };
    case "-X":
      return { opName: "xformOp:rotateX", line: `double xformOp:rotateX = ${num(-deg)}` };
    case "Y":
      return { opName: "xformOp:rotateY", line: `double xformOp:rotateY = ${num(deg)}` };
    case "-Y":
      return { opName: "xformOp:rotateY", line: `double xformOp:rotateY = ${num(-deg)}` };
    default: {
      const q = quatFromAxisAngle(f.axis, value);
      return { opName: "xformOp:orient", line: `quatf xformOp:orient = (${num(q.w)}, ${num(q.x)}, ${num(q.y)}, ${num(q.z)})` };
    }
  }
}

/**
 * TRUE per-joint kinematics — a nested `def Xform "Joint_N"` chain from the model's
 * frames. Each Joint carries its rest transform (matrix4d) + the motion op along the
 * joint's axis, ordered per `motionSide`, plus axis/type/value provenance. The number of
 * joints emitted is `min(#values, #model-joints)` so a robot that only streams a few joint
 * values renders exactly those (and never fabricates joints it has no value for).
 */
function emitTrueJointChain(b: UsdaBuilder, frames: JointFrame[], jointValues: number[]): void {
  const n = Math.min(jointValues.length, frames.length);
  for (let i = 0; i < n; i++) {
    const f = frames[i];
    const value = Number.isFinite(jointValues[i]) ? jointValues[i] : 0;
    b.open(`def Xform "Joint_${i}"`);
    b.line(`custom string st4i:jointName = ${usdString(f.name)}`);
    b.line(`custom string st4i:jointType = ${usdString(f.type)}`);
    b.line(`custom double3 st4i:jointAxis = ${vec3(f.axis)}`);
    b.line(`custom double st4i:jointValue = ${num(value)}`);
    const restLine = `matrix4d xformOp:transform:rest = ${fmtMat4(f.restTransform)}`;
    const m = motionOp(f, value);
    if (f.motionSide === "pre") {
      // T(v) = motion(v) · rest — motion is the OUTER (leading) op.
      b.line(m.line);
      b.line(restLine);
      b.line(`uniform token[] xformOpOrder = ["${m.opName}", "xformOp:transform:rest"]`);
    } else {
      // T(v) = rest · motion(v) — motion is the INNER (trailing) op.
      b.line(restLine);
      b.line(m.line);
      b.line(`uniform token[] xformOpOrder = ["xformOp:transform:rest", "${m.opName}"]`);
    }
  }
  for (let i = 0; i < n; i++) b.close();
}

/** Legacy fallback — a nested Joint_N rotateZ chain (revolute assumption, no model). */
function emitPlaceholderJointChain(b: UsdaBuilder, joints: number[]): void {
  for (let i = 0; i < joints.length; i++) {
    const deg = Number.isFinite(joints[i]) ? (joints[i] * 180) / Math.PI : 0;
    b.open(`def Xform "Joint_${i}"`);
    b.line(`custom string st4i:jointType = "revolute"`);
    b.line(`custom double3 st4i:jointAxis = (0, 0, 1)`);
    b.line(`double xformOp:rotateZ = ${num(deg)}`);
    b.line(`uniform token[] xformOpOrder = ["xformOp:rotateZ"]`);
  }
  for (let i = 0; i < joints.length; i++) b.close();
}

/**
 * OPT-IN UsdPhysics articulation for a robot — a flat `def Scope "Physics"` of rigid-body
 * links (kept flat, NOT nested, so no invalid nested-rigid-body) + revolute/prismatic
 * joints wiring the link chain. Links sit at their rest poses (accumulated rest product);
 * joints carry the axis + lower/upper limits from the model. Emitted as a sibling of the
 * visual Joint chain, under a robot prim that carries `PhysicsArticulationRootAPI`.
 */
function emitPhysicsArticulation(b: UsdaBuilder, devicePath: string, frames: JointFrame[], jointValues: number[]): void {
  const n = Math.min(jointValues.length, frames.length);
  if (n === 0) return;
  b.open(`def Scope "Physics"`);

  // Links (flat) — placed by the accumulated rest transform (motion=identity at rest).
  let acc: Mat4 = mat4Identity();
  const linkPaths: string[] = [];
  for (let i = 0; i < n; i++) {
    acc = mat4Mul(acc, frames[i].restTransform);
    const linkPath = `${devicePath}/Physics/Link_${i}`;
    linkPaths.push(linkPath);
    b.openMeta(`def Xform "Link_${i}"`, [`prepend apiSchemas = ["PhysicsRigidBodyAPI", "PhysicsCollisionAPI"]`]);
    b.line(`matrix4d xformOp:transform = ${fmtMat4(acc)}`);
    b.line(`uniform token[] xformOpOrder = ["xformOp:transform"]`);
    b.open(`def Cube "collider"`);
    b.line(`double size = 100`);
    b.close();
    b.close(); // link
  }

  // Articulation joints — body0 = previous link (base for joint 0), body1 = this link.
  for (let i = 0; i < n; i++) {
    const f = frames[i];
    const body0 = i === 0 ? devicePath : linkPaths[i - 1];
    const body1 = linkPaths[i];
    const schema = f.type === "prismatic" ? "PhysicsPrismaticJoint" : "PhysicsRevoluteJoint";
    b.open(`def ${schema} "PhysJoint_${i}"`);
    b.line(`rel physics:body0 = <${body0}>`);
    b.line(`rel physics:body1 = <${body1}>`);
    b.line(`uniform token physics:axis = "${f.axisToken}"`);
    if (f.limits) {
      // Revolute limits are DEGREES in UsdPhysics; prismatic limits are distance units (mm).
      const lo = f.type === "revolute" ? (f.limits.min * 180) / Math.PI : f.limits.min;
      const hi = f.type === "revolute" ? (f.limits.max * 180) / Math.PI : f.limits.max;
      b.line(`float physics:lowerLimit = ${num(lo)}`);
      b.line(`float physics:upperLimit = ${num(hi)}`);
    }
    const o = mat4Origin(f.restTransform);
    b.line(`point3f physics:localPos0 = ${vec3(o)}`);
    b.line(`point3f physics:localPos1 = (0, 0, 0)`);
    b.close();
  }

  b.close(); // Physics scope
}

/**
 * Emit one device prim (Xform + transform + reference-or-placeholder + provenance +
 * material binding + true kinematics + optional physics). `devicePath` is the device's
 * absolute prim path (for physics joint body refs).
 */
function emitDevice(ctx: UsdCtx, d: DeviceNode, devicePath: string): void {
  const b = ctx.b;
  const name = usdSanitizeName(d.id);
  const model = resolveDeviceModel(d);
  const frames = model ? resolveJointFrames(model) : null;
  const hasArticulation = ctx.includePhysics && d.kind === "robot" && !!frames && !!d.joints && d.joints.length > 0;

  // Prim metadata: glTF reference + applied physics schemas.
  const meta: string[] = [];
  if (d.modelUri) meta.push(`references = ${usdAssetPath(d.modelUri)}`);
  if (ctx.includePhysics) {
    if (hasArticulation) meta.push(`prepend apiSchemas = ["PhysicsArticulationRootAPI"]`);
    else meta.push(`prepend apiSchemas = ["PhysicsRigidBodyAPI", "PhysicsCollisionAPI"]`);
  }
  if (meta.length) b.openMeta(`def Xform "${name}"`, meta);
  else b.open(`def Xform "${name}"`);

  emitTransform(b, d.position);
  b.line(`custom string st4i:deviceId = ${usdString(d.id)}`);
  b.line(`custom string st4i:kind = ${usdString(d.kind)}`);
  b.line(`custom string st4i:state = ${usdString(d.state)}`);
  if (d.kind === "robot" && d.kinematicModelId) {
    b.line(`custom string st4i:kinematicModelId = ${usdString(d.kinematicModelId)}`);
  }
  if (ctx.includeMaterials) b.line(materialBinding(ctx, d.state));

  // No registered asset → an honest placeholder cube (not faked geometry) — with a
  // material binding of its own so the placeholder is also visually meaningful.
  if (!d.modelUri) {
    b.open(`def Cube "geo"`);
    b.line(`double size = 200`);
    if (ctx.includeMaterials) b.line(materialBinding(ctx, d.state));
    b.close();
  }

  // Robot articulation: TRUE per-joint kinematics from the model, else the placeholder.
  if (d.kind === "robot" && d.joints && d.joints.length > 0) {
    if (frames && frames.length > 0) emitTrueJointChain(b, frames, d.joints);
    else emitPlaceholderJointChain(b, d.joints);
  }

  // OPT-IN physics articulation (flat rigid-body links + joints).
  if (hasArticulation && frames && d.joints) emitPhysicsArticulation(b, devicePath, frames, d.joints);

  b.close();
}

/** Emit one zone prim (metadata only — bounds are free-form). */
function emitZone(b: UsdaBuilder, z: ZoneNode): void {
  b.open(`def Xform "${usdSanitizeName(z.id)}"`);
  b.line(`custom string st4i:zoneType = ${usdString(z.zoneType)}`);
  b.line(`custom int st4i:maxConcurrentRobots = ${num(z.maxConcurrentRobots)}`);
  b.close();
}

/** Emit the `Looks` scope: one UsdPreviewSurface material per used device state. */
function emitLooks(ctx: UsdCtx, states: NormalizedState[]): void {
  const b = ctx.b;
  b.open(`def Scope "Looks"`);
  for (const s of states) {
    const [r, g, bl] = hexTo01(STATE_COLORS[s] ?? STATE_COLORS.unknown);
    const matName = `Mat_${s}`;
    b.open(`def Material "${matName}"`);
    b.line(`token outputs:surface.connect = <${ctx.looksRoot}/${matName}/PreviewSurface.outputs:surface>`);
    b.open(`def Shader "PreviewSurface"`);
    b.line(`uniform token info:id = "UsdPreviewSurface"`);
    b.line(`color3f inputs:diffuseColor = (${num(r4(r))}, ${num(r4(g))}, ${num(r4(bl))})`);
    b.line(`float inputs:metallic = 0`);
    b.line(`float inputs:roughness = 0.5`);
    b.line(`token outputs:surface`);
    b.close(); // shader
    b.close(); // material
  }
  b.close(); // Looks
}

/** Emit the physics scene (gravity along the down-axis for the stage up-axis). */
function emitPhysicsScene(b: UsdaBuilder, upAxis: "Y" | "Z"): void {
  b.open(`def PhysicsScene "PhysicsScene"`);
  b.line(`vector3f physics:gravityDirection = ${upAxis === "Y" ? "(0, -1, 0)" : "(0, 0, -1)"}`);
  b.line(`float physics:gravityMagnitude = 9.81`);
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
  const includeMaterials = opts?.includeMaterials ?? true;
  const includePhysics = opts?.includePhysics ?? false;

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
  const ctx: UsdCtx = {
    b,
    includeMaterials,
    includePhysics,
    looksRoot: `/${factoryPrim}/Looks`,
  };

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

  // Materials (Looks scope) — one per distinct device STATE that appears.
  if (includeMaterials) {
    const usedStates = new Set<NormalizedState>();
    for (const d of graph.devices) usedStates.add(d.state);
    if (usedStates.size > 0) emitLooks(ctx, [...usedStates]);
  }

  // Physics scene (opt-in).
  if (includePhysics) emitPhysicsScene(b, upAxis);

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
    const linesPath = `/${factoryPrim}/Lines`;
    b.open(`def Scope "Lines"`);
    for (const line of graph.lines) {
      const lineName = usdSanitizeName(line.id);
      b.open(`def Xform "${lineName}"`);
      b.line(`custom string st4i:lineCode = ${usdString(line.code)}`);
      for (const station of line.stations) {
        const stationName = usdSanitizeName(station.id);
        b.open(`def Xform "${stationName}"`);
        b.line(`custom string st4i:stationCode = ${usdString(station.code)}`);
        for (const d of station.devices) {
          nestedDeviceIds.add(d.id);
          emitDevice(ctx, d, `${linesPath}/${lineName}/${stationName}/${usdSanitizeName(d.id)}`);
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
    const orphanPath = `/${factoryPrim}/UnassignedDevices`;
    b.open(`def Scope "UnassignedDevices"`);
    for (const d of orphans) emitDevice(ctx, d, `${orphanPath}/${usdSanitizeName(d.id)}`);
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
