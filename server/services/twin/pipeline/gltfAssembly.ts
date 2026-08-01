/**
 * T4 (doc 24 Wave-3) — SHARED glTF 2.0 binary assembler.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Extracted from urdfToGltf.ts's hand-rolled emitter so BOTH the URDF path (node
 * hierarchy from joints) AND the new STEP/CAD path (flat list of triangulated
 * solids) emit byte-identical, spec-valid glTF from ONE code path — the same
 * "single source of 3D truth" discipline the registry enforces (doc 16 §1.1).
 *
 * `GltfBinaryBuilder` owns the low-level packing: POSITION+NORMAL+indices → 4-byte
 * aligned bufferViews + accessors (POSITION carries min/max, which drei/three
 * require) into ONE binary buffer, embedded as a base64 data-URI so the .gltf is a
 * single self-contained file the FE `<Gltf>` loader can fetch directly.
 *
 * `assembleGltfFromMeshes` is the FLAT convenience: one node per mesh, all scene
 * roots — used by the STEP importer (a CAD assembly is a flat set of solids). The
 * URDF emitter drives the builder directly because it needs a joint node tree.
 *
 * PURE + deterministic (no I/O). Units are whatever the caller feeds in (the URDF
 * path feeds metres; the STEP path scales mm→m before calling).
 * ════════════════════════════════════════════════════════════════════════════
 */

export type Vec3 = [number, number, number];

/** A triangle mesh: flat xyz positions, flat xyz normals, triangle indices. */
export interface TriMeshData {
  positions: number[];
  normals: number[];
  indices: number[];
}

/** A named triangle mesh (for the flat scene assembler). */
export interface NamedTriMesh extends TriMeshData {
  name: string;
}

// glTF 2.0 constant enums.
export const GLTF_FLOAT = 5126;
export const GLTF_UNSIGNED_INT = 5125;
export const GLTF_ARRAY_BUFFER = 34962;
export const GLTF_ELEMENT_ARRAY_BUFFER = 34963;

/** What `addMesh` reports back (mesh index + this mesh's local POSITION AABB). */
export interface AddedMesh {
  meshIndex: number;
  min: Vec3;
  max: Vec3;
}

/**
 * Accumulates glTF meshes/accessors/bufferViews into ONE binary buffer. Call
 * `addMesh` per triangle mesh, then `finalize()` once to get the packed buffer +
 * data-URI. Deliberately mirrors the original urdfToGltf packing exactly (4-byte
 * alignment before every view; POSITION min/max; NORMAL; UNSIGNED_INT indices).
 */
export class GltfBinaryBuilder {
  private readonly bufferParts: Buffer[] = [];
  private byteOffset = 0;
  readonly bufferViews: Array<Record<string, unknown>> = [];
  readonly accessors: Array<Record<string, unknown>> = [];
  readonly meshes: Array<Record<string, unknown>> = [];

  /** Append a bufferView (padded to a 4-byte boundary per the glTF spec). */
  private pushView(data: Buffer, target: number): number {
    const pad = (4 - (this.byteOffset % 4)) % 4;
    if (pad) {
      this.bufferParts.push(Buffer.alloc(pad));
      this.byteOffset += pad;
    }
    this.bufferViews.push({ buffer: 0, byteOffset: this.byteOffset, byteLength: data.byteLength, target });
    this.bufferParts.push(data);
    this.byteOffset += data.byteLength;
    return this.bufferViews.length - 1;
  }

  /**
   * Add one triangle mesh as a glTF mesh with a single primitive
   * (POSITION + NORMAL attributes + UNSIGNED_INT indices, triangle mode). Returns
   * the mesh index and this mesh's local POSITION bounds (used for scene AABB).
   */
  addMesh(name: string, mesh: TriMeshData, material = 0): AddedMesh {
    // POSITION accessor (with required min/max).
    const posBuf = Buffer.from(new Float32Array(mesh.positions).buffer);
    const posView = this.pushView(posBuf, GLTF_ARRAY_BUFFER);
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < mesh.positions.length; i += 3) {
      const x = mesh.positions[i], y = mesh.positions[i + 1], z = mesh.positions[i + 2];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    // Degenerate/empty guard: keep min/max finite so the accessor stays valid.
    if (!Number.isFinite(minX)) { minX = minY = minZ = 0; maxX = maxY = maxZ = 0; }
    const posAccessor = this.accessors.length;
    this.accessors.push({
      bufferView: posView,
      componentType: GLTF_FLOAT,
      count: mesh.positions.length / 3,
      type: "VEC3",
      min: [minX, minY, minZ],
      max: [maxX, maxY, maxZ],
    });

    // NORMAL accessor.
    const normBuf = Buffer.from(new Float32Array(mesh.normals).buffer);
    const normView = this.pushView(normBuf, GLTF_ARRAY_BUFFER);
    const normAccessor = this.accessors.length;
    this.accessors.push({ bufferView: normView, componentType: GLTF_FLOAT, count: mesh.normals.length / 3, type: "VEC3" });

    // Indices accessor.
    const idxBuf = Buffer.from(new Uint32Array(mesh.indices).buffer);
    const idxView = this.pushView(idxBuf, GLTF_ELEMENT_ARRAY_BUFFER);
    const idxAccessor = this.accessors.length;
    this.accessors.push({ bufferView: idxView, componentType: GLTF_UNSIGNED_INT, count: mesh.indices.length, type: "SCALAR" });

    const meshIndex = this.meshes.length;
    this.meshes.push({
      name,
      primitives: [
        { attributes: { POSITION: posAccessor, NORMAL: normAccessor }, indices: idxAccessor, material, mode: 4 },
      ],
    });
    return { meshIndex, min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
  }

  /** Concatenate the binary buffer and return it + its base64 data-URI. */
  finalize(): { buffer: Buffer; dataUri: string } {
    const buffer = Buffer.concat(this.bufferParts);
    return { buffer, dataUri: `data:application/octet-stream;base64,${buffer.toString("base64")}` };
  }
}

/** A default matte-grey PBR material (shared with the URDF emitter's look). */
export function defaultMaterial(name = "cad-default"): Record<string, unknown> {
  return {
    name,
    pbrMetallicRoughness: { baseColorFactor: [0.7, 0.72, 0.75, 1], metallicFactor: 0.1, roughnessFactor: 0.8 },
    doubleSided: true,
  };
}

export interface AssembleGltfResult {
  /** The glTF 2.0 JSON document (single embedded buffer, base64 data-URI). */
  gltf: Record<string, unknown>;
  /** Serialised, ready to write to a .gltf file. */
  json: string;
  /** AABB of the whole model (same units the meshes were given in). */
  bounds: { min: Vec3; max: Vec3 };
  meshCount: number;
  nodeCount: number;
}

/**
 * Assemble a FLAT glTF scene from a set of named triangle meshes — one node per
 * mesh, every node a scene root, one shared material. Used by the STEP/CAD importer
 * (a CAD part/assembly reads back as a flat list of triangulated solids with no
 * articulation). Computes the whole-model AABB from the per-mesh POSITION bounds.
 */
export function assembleGltfFromMeshes(
  meshes: NamedTriMesh[],
  opts: { generator?: string; materialName?: string } = {},
): AssembleGltfResult {
  const builder = new GltfBinaryBuilder();
  let min: Vec3 = [Infinity, Infinity, Infinity];
  let max: Vec3 = [-Infinity, -Infinity, -Infinity];
  const nodes: Array<Record<string, unknown>> = [];
  const roots: number[] = [];

  for (const m of meshes) {
    const added = builder.addMesh(m.name, m, 0);
    min = [Math.min(min[0], added.min[0]), Math.min(min[1], added.min[1]), Math.min(min[2], added.min[2])];
    max = [Math.max(max[0], added.max[0]), Math.max(max[1], added.max[1]), Math.max(max[2], added.max[2])];
    const nodeIndex = nodes.length;
    nodes.push({ name: m.name, mesh: added.meshIndex });
    roots.push(nodeIndex);
  }
  if (!Number.isFinite(min[0])) { min = [0, 0, 0]; max = [0, 0, 0]; }

  const { buffer, dataUri } = builder.finalize();
  const gltf: Record<string, unknown> = {
    asset: { version: "2.0", generator: opts.generator ?? "avi-aoi gltfAssembly (T4)" },
    scene: 0,
    scenes: [{ nodes: roots }],
    nodes,
    meshes: builder.meshes,
    materials: [defaultMaterial(opts.materialName)],
    accessors: builder.accessors,
    bufferViews: builder.bufferViews,
    buffers: [{ byteLength: buffer.byteLength, uri: dataUri }],
  };

  return { gltf, json: JSON.stringify(gltf), bounds: { min, max }, meshCount: builder.meshes.length, nodeCount: nodes.length };
}
