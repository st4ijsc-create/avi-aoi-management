/**
 * T4 (doc 24 Wave-3) — STEP/IGES (CAD) → glTF 2.0 via occt-import-js (OpenCASCADE WASM).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Turns REAL machine CAD (an ISO-10303-21 `.step`/`.stp`, or `.iges`) into twin
 * geometry. OpenCASCADE (compiled to WASM by occt-import-js) reads the B-Rep,
 * TESSELLATES every solid to triangles, and hands back per-solid position/normal/
 * index arrays. We scale mm→m, then assemble a single self-contained glTF 2.0 via
 * the SHARED `gltfAssembly` builder (same emitter the URDF path uses) plus a
 * whole-model bounding box.
 *
 * ── WASM GUARD (never breaks `npm run check` / `vite build`) ─────────────────
 * occt is loaded through a LAZY dynamic `import()` cached at module scope (mirrors
 * rapierPhysics.loadRapier). No synchronous import pulls the WASM in, so `tsc`
 * (types only) and the client `vite build` never touch it. If the WASM cannot init
 * (sandbox without the .wasm, unsupported node, …) `loadOcct()` rejects and clears
 * its cache so a later call can retry; the caller degrades HONESTLY (no fake mesh).
 *
 * ── HONESTY ─────────────────────────────────────────────────────────────────
 *   • occt `success:false`, a parse error, or ZERO tessellated solids → we THROW an
 *     Error carrying the real occt diagnostic. The service records conversionStatus
 *     'failed' with that reason — geometry is NEVER fabricated.
 *   • Units: STEP is authored in its own unit (usually mm); occt returns raw model
 *     coordinates, so we scale by 0.001 to metres (glTF's convention) to match the
 *     URDF path. `bounds` is therefore already in metres.
 * ════════════════════════════════════════════════════════════════════════════
 */
import type { OcctModule, OcctMesh } from "occt-import-js";
import {
  assembleGltfFromMeshes,
  type NamedTriMesh,
  type AssembleGltfResult,
  type Vec3,
} from "./gltfAssembly";

/** STEP is authored in mm; glTF (and the URDF path) is in metres. */
const MM_TO_M = 0.001;

// ── Cached async WASM init (mirrors rapierPhysics.loadRapier) ──────────────────────
let occtPromise: Promise<OcctModule> | null = null;

/** Captured occt stderr diagnostics for the in-flight parse (single-threaded, reset per call). */
let occtDiag: string[] = [];

/**
 * Load + init occt-import-js exactly once (cached). The Emscripten factory locates its
 * `.wasm` next to the package's dist file automatically under Node. Rejects (and clears
 * the cache so a later call can retry) if the WASM cannot init — the caller then degrades
 * honestly. occt's noisy `**** ERR StepFile …` lines are captured into `occtDiag` rather
 * than dumped to the process stderr.
 */
export async function loadOcct(): Promise<OcctModule> {
  if (!occtPromise) {
    occtPromise = (async () => {
      const mod = await import("occt-import-js");
      const factory = (mod as unknown as { default?: unknown }).default ?? mod;
      if (typeof factory !== "function") throw new Error("occt-import-js did not export a factory function");
      const occt = await (factory as (arg?: Record<string, unknown>) => Promise<OcctModule>)({
        print: () => {
          /* swallow occt stdout */
        },
        printErr: (line: string) => {
          occtDiag.push(String(line));
        },
      });
      return occt;
    })().catch((err) => {
      occtPromise = null; // don't latch the failure
      throw err instanceof Error ? err : new Error(String(err));
    });
  }
  return occtPromise;
}

/** Cheap availability probe (used by tests + a UI hint) — does the WASM init here? */
export async function occtAvailable(): Promise<boolean> {
  try {
    await loadOcct();
    return true;
  } catch {
    return false;
  }
}

export interface StepToGltfResult extends AssembleGltfResult {
  /** Number of tessellated solids (one glTF mesh/node each). */
  solidCount: number;
  /** Total triangles across all solids. */
  triangleCount: number;
  /** bounds unit — always metres (positions scaled mm→m). */
  unit: "m";
}

export interface StepToGltfOptions {
  /** "step" (default) or "iges" — selects the occt reader. */
  sourceFormat?: "step" | "iges";
  /** Override the mm→m scale (default 0.001). */
  scale?: number;
}

/**
 * Compute flat per-face normals when occt did not supply a normal attribute
 * (defensive — occt normally provides normals). Averages nothing; uses the triangle
 * face normal for its three vertices so the mesh still shades.
 */
function computeFlatNormals(positions: number[], indices: number[]): number[] {
  const normals = new Array<number>(positions.length).fill(0);
  for (let t = 0; t + 2 < indices.length; t += 3) {
    const ia = indices[t] * 3, ib = indices[t + 1] * 3, ic = indices[t + 2] * 3;
    const ax = positions[ia], ay = positions[ia + 1], az = positions[ia + 2];
    const bx = positions[ib], by = positions[ib + 1], bz = positions[ib + 2];
    const cx = positions[ic], cy = positions[ic + 1], cz = positions[ic + 2];
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    for (const i of [ia, ib, ic]) {
      normals[i] += nx; normals[i + 1] += ny; normals[i + 2] += nz;
    }
  }
  // Renormalise accumulated vertex normals.
  for (let i = 0; i < normals.length; i += 3) {
    const len = Math.hypot(normals[i], normals[i + 1], normals[i + 2]) || 1;
    normals[i] /= len; normals[i + 1] /= len; normals[i + 2] /= len;
  }
  return normals;
}

/** Convert one occt mesh → our NamedTriMesh (scaled mm→m). Returns null if it has no triangles. */
function occtMeshToTriMesh(mesh: OcctMesh, index: number, scale: number): NamedTriMesh | null {
  const rawPos = mesh.attributes?.position?.array;
  const rawIdx = mesh.index?.array;
  if (!rawPos || !rawPos.length || !rawIdx || !rawIdx.length) return null;
  const positions = rawPos.map((v) => v * scale);
  const indices = rawIdx.slice();
  const rawNorm = mesh.attributes?.normal?.array;
  // Normals are unit vectors → scale-invariant; use as-is, else compute flat normals.
  const normals =
    rawNorm && rawNorm.length === positions.length ? rawNorm.slice() : computeFlatNormals(positions, indices);
  const name = mesh.name && mesh.name.trim() ? mesh.name.trim() : `solid_${index}`;
  return { name, positions, normals, indices };
}

/**
 * Parse a STEP/IGES buffer → glTF 2.0 (metres). Async (WASM). THROWS an Error carrying
 * the real occt diagnostic on any failure (bad file, occt `success:false`, or zero
 * solids) — never returns fabricated geometry. Requires the occt WASM to init; if it
 * cannot, the underlying `loadOcct()` rejection propagates (caller degrades honestly).
 */
export async function stepBufferToGltf(
  buffer: Uint8Array | Buffer,
  opts: StepToGltfOptions = {},
): Promise<StepToGltfResult> {
  const scale = opts.scale ?? MM_TO_M;
  const format = opts.sourceFormat ?? "step";
  const occt = await loadOcct();

  const content = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  occtDiag = [];
  const res =
    format === "iges" ? occt.ReadIgesFile(content, null) : occt.ReadStepFile(content, null);

  if (!res || !res.success) {
    const diag = occtDiag.join(" | ").trim();
    throw new Error(
      `occt failed to read the ${format.toUpperCase()} file${diag ? `: ${diag}` : " (occt reported success=false)."}`,
    );
  }

  const meshes: NamedTriMesh[] = [];
  let triangleCount = 0;
  (res.meshes ?? []).forEach((m, i) => {
    const tri = occtMeshToTriMesh(m, i, scale);
    if (tri) {
      meshes.push(tri);
      triangleCount += tri.indices.length / 3;
    }
  });

  if (!meshes.length) {
    const diag = occtDiag.join(" | ").trim();
    throw new Error(
      `${format.toUpperCase()} parsed but produced no tessellated solids (empty/curve-only geometry)${diag ? `: ${diag}` : "."}`,
    );
  }

  const assembled = assembleGltfFromMeshes(meshes, {
    generator: `avi-aoi stepToGltf (T4, occt-import-js) — ${format} → glTF`,
    materialName: "cad-default",
  });

  return {
    ...assembled,
    solidCount: meshes.length,
    triangleCount,
    unit: "m",
  };
}

export type { Vec3 };
