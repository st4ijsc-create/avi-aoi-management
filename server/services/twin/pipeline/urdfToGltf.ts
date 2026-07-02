/**
 * T2a-2 (doc 20 §1/§5) — URDF → glTF 2.0 emitter.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Converts a parsed URDF (urdfParser.ts) into a valid, self-contained **glTF 2.0**
 * document loadable by the FE drei `<Gltf>` loader. It builds:
 *
 *   • a NODE hierarchy mirroring the link/joint tree — each joint's <origin xyz rpy>
 *     becomes the child node's translation+rotation (TRS), so the rest pose matches
 *     the real robot geometry;
 *   • MESHES for primitive <geometry> (box / cylinder / sphere) — generated triangle
 *     buffers (interleaved-free: POSITION + NORMAL + indices), packed into ONE binary
 *     buffer embedded as a base64 data-URI (so the .gltf is a single portable file);
 *   • a simple PBR material per link;
 *   • correct accessors / bufferViews with POSITION min/max (drei/three require it).
 *
 * ── LIB vs HAND-ROLLED ──────────────────────────────────────────────────────
 * NO glTF lib is in the dependency tree (@gltf-transform is absent; `three` IS a dep
 * but its GLTFExporter needs a live three.Scene + browser-ish globals server-side —
 * heavyweight and side-effectful). glTF 2.0's JSON container is well-specified and, for
 * PRIMITIVE geometry, tractable to emit by hand — same call as b2mmlCodec (hand-roll a
 * small well-scoped codec rather than pull a heavy dep). So this is a hand-rolled
 * emitter producing a spec-valid glTF (verified structurally in tests).
 *
 * ── EXTERNAL MESH HONESTY ───────────────────────────────────────────────────
 * `<mesh filename=...>` refs: if the caller supplies the referenced file's bytes AND it
 * is ASCII STL, we cheaply triangulate it (real geometry). Otherwise we emit a labelled
 * PLACEHOLDER box sized from the mesh `scale` and record the unresolved ref in
 * `result.externalMeshes` — we NEVER fabricate geometry we do not have. Binary-STL / DAE
 * / OBJ import is a documented phase-2 seam (needs a proper importer).
 *
 * Units: glTF is in METRES (URDF's native unit) — no conversion here.
 * ════════════════════════════════════════════════════════════════════════════
 */
import {
  type UrdfRobot,
  type UrdfGeometry,
  type UrdfVisual,
  type Vec3,
  walkLinkTree,
} from "./urdfParser";
import { GltfBinaryBuilder, defaultMaterial } from "./gltfAssembly";

// ── Triangle-mesh primitive: flat positions + normals + indices ─────────────────

interface TriMesh {
  positions: number[]; // flat xyz
  normals: number[]; // flat xyz
  indices: number[];
}

/** Axis-aligned box centred at origin, extents = full size (metres). */
function boxMesh(size: Vec3): TriMesh {
  const [sx, sy, sz] = [size[0] / 2, size[1] / 2, size[2] / 2];
  // 6 faces, 4 verts each (so normals are per-face flat), 2 tris each.
  const faces: Array<{ n: Vec3; verts: Vec3[] }> = [
    { n: [0, 0, 1], verts: [[-sx, -sy, sz], [sx, -sy, sz], [sx, sy, sz], [-sx, sy, sz]] },
    { n: [0, 0, -1], verts: [[sx, -sy, -sz], [-sx, -sy, -sz], [-sx, sy, -sz], [sx, sy, -sz]] },
    { n: [1, 0, 0], verts: [[sx, -sy, sz], [sx, -sy, -sz], [sx, sy, -sz], [sx, sy, sz]] },
    { n: [-1, 0, 0], verts: [[-sx, -sy, -sz], [-sx, -sy, sz], [-sx, sy, sz], [-sx, sy, -sz]] },
    { n: [0, 1, 0], verts: [[-sx, sy, sz], [sx, sy, sz], [sx, sy, -sz], [-sx, sy, -sz]] },
    { n: [0, -1, 0], verts: [[-sx, -sy, -sz], [sx, -sy, -sz], [sx, -sy, sz], [-sx, -sy, sz]] },
  ];
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  for (const f of faces) {
    const base = positions.length / 3;
    for (const v of f.verts) {
      positions.push(v[0], v[1], v[2]);
      normals.push(f.n[0], f.n[1], f.n[2]);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return { positions, normals, indices };
}

/** Cylinder along +Z (URDF convention), centred at origin. `seg` radial segments. */
function cylinderMesh(radius: number, length: number, seg = 24): TriMesh {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const hz = length / 2;
  // Side wall: two rings.
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    const cx = Math.cos(a), cy = Math.sin(a);
    positions.push(radius * cx, radius * cy, -hz);
    normals.push(cx, cy, 0);
    positions.push(radius * cx, radius * cy, hz);
    normals.push(cx, cy, 0);
  }
  for (let i = 0; i < seg; i++) {
    const b = i * 2;
    indices.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
  }
  // Caps (flat, per-face normals).
  const addCap = (z: number, nz: number) => {
    const centerIdx = positions.length / 3;
    positions.push(0, 0, z);
    normals.push(0, 0, nz);
    const ringStart = positions.length / 3;
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      positions.push(radius * Math.cos(a), radius * Math.sin(a), z);
      normals.push(0, 0, nz);
    }
    for (let i = 0; i < seg; i++) {
      if (nz > 0) indices.push(centerIdx, ringStart + i, ringStart + i + 1);
      else indices.push(centerIdx, ringStart + i + 1, ringStart + i);
    }
  };
  addCap(hz, 1);
  addCap(-hz, -1);
  return { positions, normals, indices };
}

/** UV sphere centred at origin. */
function sphereMesh(radius: number, latBands = 16, lonBands = 24): TriMesh {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  for (let lat = 0; lat <= latBands; lat++) {
    const theta = (lat * Math.PI) / latBands;
    const st = Math.sin(theta), ct = Math.cos(theta);
    for (let lon = 0; lon <= lonBands; lon++) {
      const phi = (lon * 2 * Math.PI) / lonBands;
      const sp = Math.sin(phi), cp = Math.cos(phi);
      const x = cp * st, y = sp * st, z = ct;
      positions.push(radius * x, radius * y, radius * z);
      normals.push(x, y, z);
    }
  }
  const ring = lonBands + 1;
  for (let lat = 0; lat < latBands; lat++) {
    for (let lon = 0; lon < lonBands; lon++) {
      const a = lat * ring + lon;
      const b = a + ring;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  return { positions, normals, indices };
}

/**
 * Triangulate ASCII STL text (real geometry). Returns null if it doesn't look like
 * ASCII STL (so the caller falls back to a placeholder honestly). Normals from the
 * `facet normal` lines; per-facet flat shading.
 */
export function triangulateAsciiStl(text: string): TriMesh | null {
  if (!/^\s*solid\b/i.test(text) || !/facet\s+normal/i.test(text)) return null;
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const facetRe = /facet\s+normal\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)[\s\S]*?endfacet/gi;
  const vertexRe = /vertex\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = facetRe.exec(text)) !== null) {
    const nx = Number(m[1]), ny = Number(m[2]), nz = Number(m[3]);
    const block = m[0];
    vertexRe.lastIndex = 0;
    const verts: number[][] = [];
    let vm: RegExpExecArray | null;
    while ((vm = vertexRe.exec(block)) !== null) {
      verts.push([Number(vm[1]), Number(vm[2]), Number(vm[3])]);
    }
    if (verts.length < 3) continue;
    // Fan-triangulate (STL facets are triangles; be tolerant).
    for (let i = 1; i + 1 < verts.length; i++) {
      for (const v of [verts[0], verts[i], verts[i + 1]]) {
        const base = positions.length / 3;
        positions.push(v[0], v[1], v[2]);
        normals.push(nx, ny, nz);
        indices.push(base);
      }
    }
  }
  if (positions.length === 0) return null;
  return { positions, normals, indices };
}

// ── Geometry → TriMesh (with external-mesh honesty) ─────────────────────────────

export interface ExternalMeshRef {
  link: string;
  filename: string;
  reason: string;
}

interface GeomResult {
  mesh: TriMesh;
  externalRef?: ExternalMeshRef;
}

/**
 * Resolve a URDF geometry to a triangle mesh. `meshResolver` (optional) may return the
 * bytes of a referenced mesh file so ASCII STL can be triangulated in-line; if it can't
 * be resolved/triangulated, a placeholder box (from the mesh scale) is emitted and the
 * unresolved ref is recorded — NEVER faked as the real mesh.
 */
function geometryToMesh(
  linkName: string,
  geom: UrdfGeometry,
  meshResolver?: (filename: string) => string | null | undefined,
): GeomResult {
  if (geom.kind === "box") return { mesh: boxMesh(geom.size) };
  if (geom.kind === "cylinder") return { mesh: cylinderMesh(geom.radius, geom.length) };
  if (geom.kind === "sphere") return { mesh: sphereMesh(geom.radius) };
  // mesh: try to resolve → ASCII STL; else placeholder + honest record.
  const raw = meshResolver?.(geom.filename);
  if (raw) {
    const stl = triangulateAsciiStl(raw);
    if (stl) return { mesh: stl };
  }
  const s = geom.scale;
  const placeholder = boxMesh([Math.max(0.02, s[0] * 0.1), Math.max(0.02, s[1] * 0.1), Math.max(0.02, s[2] * 0.1)]);
  return {
    mesh: placeholder,
    externalRef: {
      link: linkName,
      filename: geom.filename,
      reason: raw
        ? "referenced mesh is not ASCII STL (binary-STL/DAE/OBJ import is a phase-2 seam) — placeholder box emitted"
        : "referenced mesh file not provided to the converter — placeholder box emitted",
    },
  };
}

// ── glTF 2.0 document assembly ──────────────────────────────────────────────────

/** Euler XYZ (URDF rpy, radians) → quaternion [x,y,z,w] (glTF node.rotation order). */
function rpyToQuat(rpy: Vec3): [number, number, number, number] {
  const [r, p, y] = rpy;
  const cr = Math.cos(r / 2), sr = Math.sin(r / 2);
  const cp = Math.cos(p / 2), sp = Math.sin(p / 2);
  const cy = Math.cos(y / 2), sy = Math.sin(y / 2);
  // URDF rpy is Rz(yaw)·Ry(pitch)·Rx(roll) applied to a point → compose accordingly.
  const qx = sr * cp * cy - cr * sp * sy;
  const qy = cr * sp * cy + sr * cp * sy;
  const qz = cr * cp * sy - sr * sp * cy;
  const qw = cr * cp * cy + sr * sp * sy;
  return [qx, qy, qz, qw];
}

export interface UrdfToGltfResult {
  /** The glTF 2.0 JSON document (single embedded buffer, base64 data-URI). */
  gltf: Record<string, unknown>;
  /** Serialised, ready to write to a .gltf file. */
  json: string;
  /** AABB of the whole robot in metres (rest pose) — for bounds / LOD. */
  bounds: { min: Vec3; max: Vec3 };
  /** Unresolved external-mesh refs (honest — placeholders were emitted). */
  externalMeshes: ExternalMeshRef[];
  meshCount: number;
  nodeCount: number;
}

/**
 * Emit a valid glTF 2.0 document for a parsed URDF. PURE + deterministic (no I/O).
 * Node hierarchy follows the link tree; joint origins become node TRS. Only links with
 * a <visual> (or <collision>) geometry get a mesh; joint-only links become empty nodes.
 */
export function urdfToGltf(
  robot: UrdfRobot,
  opts: { meshResolver?: (filename: string) => string | null | undefined } = {},
): UrdfToGltfResult {
  const tree = walkLinkTree(robot);

  // Shared glTF binary assembler (4-byte aligned bufferViews + POSITION min/max).
  const builder = new GltfBinaryBuilder();
  const meshes = builder.meshes;
  const accessors = builder.accessors;
  const bufferViews = builder.bufferViews;
  const externalMeshes: ExternalMeshRef[] = [];

  // Track link name → mesh index (only for links that produced geometry).
  const linkMeshIndex: Record<string, number> = {};

  const addMeshForVisual = (linkName: string, vis: UrdfVisual): number => {
    const { mesh, externalRef } = geometryToMesh(linkName, vis.geometry, opts.meshResolver);
    if (externalRef) externalMeshes.push(externalRef);
    return builder.addMesh(linkName, mesh, 0).meshIndex;
  };

  // Build meshes for links that carry geometry (prefer <visual>, else <collision>).
  for (const { link } of tree) {
    const vis = link.visual ?? link.collision;
    if (vis) linkMeshIndex[link.name] = addMeshForVisual(link.name, vis);
  }

  // Build node hierarchy. Each link → one node; children attached per joint edges.
  const nodeIndexByLink: Record<string, number> = {};
  const nodes: Array<Record<string, unknown>> = [];
  for (const { link } of tree) {
    nodeIndexByLink[link.name] = nodes.length;
    const node: Record<string, unknown> = { name: link.name };
    if (linkMeshIndex[link.name] !== undefined) node.mesh = linkMeshIndex[link.name];
    nodes.push(node);
  }
  // Apply joint transforms (child node placed by joint <origin>) + parent→child edges.
  for (const { link, joint } of tree) {
    const idx = nodeIndexByLink[link.name];
    if (joint) {
      const node = nodes[idx];
      const t = joint.origin.xyz;
      if (t[0] !== 0 || t[1] !== 0 || t[2] !== 0) node.translation = [t[0], t[1], t[2]];
      const rpy = joint.origin.rpy;
      if (rpy[0] !== 0 || rpy[1] !== 0 || rpy[2] !== 0) node.rotation = rpyToQuat(rpy);
    }
  }
  for (const j of robot.joints) {
    const p = nodeIndexByLink[j.parent];
    const c = nodeIndexByLink[j.child];
    if (p === undefined || c === undefined) continue;
    const parentNode = nodes[p];
    (parentNode.children as number[] | undefined ?? (parentNode.children = [])).push(c);
  }

  // Scene roots: nodes that are not any node's child.
  const childSet = new Set<number>();
  for (const n of nodes) for (const c of (n.children as number[] | undefined) ?? []) childSet.add(c);
  const roots: number[] = [];
  for (let i = 0; i < nodes.length; i++) if (!childSet.has(i)) roots.push(i);

  // Whole-robot rest-pose AABB (accumulate node world translations + local mesh bounds).
  // Conservative: walk tree accumulating translations only (rotations kept simple for bounds).
  const bounds = computeRobotBounds(robot, tree, linkMeshIndex, meshes, accessors);

  const { buffer, dataUri } = builder.finalize();

  const gltf: Record<string, unknown> = {
    asset: { version: "2.0", generator: "avi-aoi urdfToGltf (T2a hand-rolled)" },
    scene: 0,
    scenes: [{ nodes: roots }],
    nodes,
    meshes,
    materials: [defaultMaterial("urdf-default")],
    accessors,
    bufferViews,
    buffers: [{ byteLength: buffer.byteLength, uri: dataUri }],
  };

  return {
    gltf,
    json: JSON.stringify(gltf),
    bounds,
    externalMeshes,
    meshCount: meshes.length,
    nodeCount: nodes.length,
  };
}

/** Conservative whole-robot AABB (metres) by accumulating chain translations + mesh POSITION min/max. */
function computeRobotBounds(
  robot: UrdfRobot,
  tree: Array<{ link: import("./urdfParser").UrdfLink; joint: import("./urdfParser").UrdfJoint | null }>,
  linkMeshIndex: Record<string, number>,
  meshes: Array<Record<string, unknown>>,
  accessors: Array<Record<string, unknown>>,
): { min: Vec3; max: Vec3 } {
  // Accumulate translation offsets from root along joint origins (ignores rotation → conservative-ish).
  const offset: Record<string, Vec3> = {};
  const byName: Record<string, { joint: import("./urdfParser").UrdfJoint | null }> = {};
  for (const t of tree) byName[t.link.name] = { joint: t.joint };
  const resolveOffset = (linkName: string, seen = new Set<string>()): Vec3 => {
    if (offset[linkName]) return offset[linkName];
    if (seen.has(linkName)) return [0, 0, 0];
    seen.add(linkName);
    const j = robot.jointByChild[linkName];
    if (!j) return (offset[linkName] = [0, 0, 0]);
    const parent = resolveOffset(j.parent, seen);
    return (offset[linkName] = [parent[0] + j.origin.xyz[0], parent[1] + j.origin.xyz[1], parent[2] + j.origin.xyz[2]]);
  };

  let min: Vec3 = [Infinity, Infinity, Infinity];
  let max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const { link } of tree) {
    const mi = linkMeshIndex[link.name];
    const off = resolveOffset(link.name);
    if (mi === undefined) {
      min = [Math.min(min[0], off[0]), Math.min(min[1], off[1]), Math.min(min[2], off[2])];
      max = [Math.max(max[0], off[0]), Math.max(max[1], off[1]), Math.max(max[2], off[2])];
      continue;
    }
    const prim = (meshes[mi].primitives as Array<{ attributes: { POSITION: number } }>)[0];
    const acc = accessors[prim.attributes.POSITION] as { min: number[]; max: number[] };
    min = [Math.min(min[0], off[0] + acc.min[0]), Math.min(min[1], off[1] + acc.min[1]), Math.min(min[2], off[2] + acc.min[2])];
    max = [Math.max(max[0], off[0] + acc.max[0]), Math.max(max[1], off[1] + acc.max[1]), Math.max(max[2], off[2] + acc.max[2])];
  }
  if (!Number.isFinite(min[0])) return { min: [0, 0, 0], max: [0, 0, 0] };
  return { min, max };
}
