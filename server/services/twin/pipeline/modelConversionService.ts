/**
 * T2a-4 (doc 20 §1/§5) — MODEL CONVERSION SERVICE + registry write.  Flag: MODEL_PIPELINE_ENABLED.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * The service that turns a URDF source into a RENDERABLE glTF asset and records it in the
 * T1 twin model registry (equipment_3d_models) with conversionStatus='ready', so the
 * DigitalTwinCenter renders a real robot model instead of a primitive block. It ties the
 * T2a pipeline together:
 *
 *   convertUrdfModel(source) →
 *     parseUrdf → urdfToGltf → write .gltf under uploads/models/urdf/<key>.gltf →
 *     registerModel({ modelUri, sourceFormat:'urdf', conversionStatus:'ready', bounds })
 *
 * ── HONESTY (never 'ready' without a real asset) ────────────────────────────
 *   • On any failure (parse error, empty robot, write failure) the registry row is written
 *     with conversionStatus='failed' and the real error text — NEVER 'ready'.
 *   • STEP/IGES → glTF is REAL as of T4 (doc 24 Wave-3): `convertStepModel` runs the source
 *     through occt-import-js (OpenCASCADE WASM, stepToGltf.ts), writes models/step/<key>.gltf
 *     and registers conversionStatus='ready'. Called WITHOUT a source it stays the honest seam
 *     ('pending'); a bad file / unavailable kernel / zero solids → 'failed' + reason. NEVER faked.
 *   • External `<mesh>` refs inside a URDF that can't be triangulated become labelled
 *     placeholders; the ready row's notes record how many + that they are placeholders.
 *
 * ── STORAGE ─────────────────────────────────────────────────────────────────
 * Converted assets are written under the local uploads root (LOCAL_STORAGE_DIR, default
 * ./uploads) at models/{urdf,step}/<key>.gltf and served by Express at /uploads/models/…
 * (the same convention edge packages use). The .gltf embeds its binary buffer as a base64
 * data-URI, so it is a single self-contained file the drei <Gltf> loader can fetch directly.
 *
 * FLAG: MODEL_PIPELINE_ENABLED (default OFF). Read at call time. When OFF, convert* return a
 * no-op result and write NOTHING (mirrors twinLiveEnabled / simKinematicEnabled).
 * ════════════════════════════════════════════════════════════════════════════
 */
import fs from "fs";
import path from "path";
import { parseUrdf } from "./urdfParser";
import { urdfToGltf } from "./urdfToGltf";
import { stepBufferToGltf } from "./stepToGltf";
import { registerModel, type ModelKind } from "../modelRegistry";

/** Flag — default OFF (mirrors twinLiveEnabled / simKinematicEnabled). */
export function modelPipelineEnabled(): boolean {
  return process.env.MODEL_PIPELINE_ENABLED === "true" || process.env.MODEL_PIPELINE_ENABLED === "1";
}

/** Root where converted web assets live (served by Express at /uploads/...). */
function uploadsRoot(): string {
  return process.env.LOCAL_STORAGE_DIR ? path.resolve(process.env.LOCAL_STORAGE_DIR) : path.join(process.cwd(), "uploads");
}

/** Sanitise a model key into a safe filename segment (no traversal). */
function safeKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "model";
}

/**
 * Write a serialised .gltf under uploads/models/<subdir>/<safeKey>.gltf (traversal-guarded)
 * and return its web URI + absolute path. Shared by the URDF and STEP converters.
 */
async function writeGltfAsset(subdir: string, key: string, json: string): Promise<{ modelUri: string; filePath: string }> {
  const relKey = `models/${subdir}/${key}.gltf`;
  const filePath = path.join(uploadsRoot(), relKey);
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(path.resolve(uploadsRoot()) + path.sep)) {
    throw new Error("Invalid model key: path traversal detected");
  }
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(filePath, json, "utf8");
  return { modelUri: `/uploads/${relKey}`, filePath };
}

export interface ConvertUrdfInput {
  /** The raw URDF XML. */
  urdfSource: string;
  /** Stable registry key (idempotent re-convert bumps version). */
  modelKey: string;
  /** Binding — at most one is the resolve key; class is the fallback. */
  machineId?: number | null;
  equipmentId?: string | null;
  equipmentClass?: string | null;
  /** Optional external mesh files (filename → ASCII-STL text) to triangulate inline. */
  meshFiles?: Record<string, string>;
  createdBy?: number | null;
  scope?: string | null;
  corporateCode?: string | null;
  factoryId?: number | null;
}

export interface ConvertResult {
  ok: boolean;
  status: "ready" | "failed" | "disabled";
  modelKey: string;
  modelUri?: string;
  registryId?: number;
  bounds?: { min: [number, number, number]; max: [number, number, number] };
  externalMeshCount?: number;
  meshCount?: number;
  nodeCount?: number;
  message?: string;
}

/**
 * Convert a URDF source → glTF asset → registry row (conversionStatus 'ready').
 * Flag-gated. On failure writes a 'failed' registry row with the honest error (never 'ready').
 */
export async function convertUrdfModel(input: ConvertUrdfInput): Promise<ConvertResult> {
  if (!modelPipelineEnabled()) {
    return { ok: false, status: "disabled", modelKey: input.modelKey, message: "MODEL_PIPELINE_ENABLED is off" };
  }

  const key = safeKey(input.modelKey);
  try {
    const robot = parseUrdf(input.urdfSource);
    if (!robot.links.length) throw new Error("URDF has no <link> elements — nothing to convert.");

    const resolver = input.meshFiles ? (fn: string) => input.meshFiles?.[fn] ?? input.meshFiles?.[path.basename(fn)] : undefined;
    const result = urdfToGltf(robot, { meshResolver: resolver });

    // Write the .gltf under uploads/models/urdf/<key>.gltf.
    const { modelUri } = await writeGltfAsset("urdf", key, result.json);

    const notes: string[] = [
      `T2a URDF→glTF: ${result.meshCount} meshes / ${result.nodeCount} nodes from robot "${robot.name}".`,
    ];
    if (result.externalMeshes.length) {
      notes.push(
        `${result.externalMeshes.length} external <mesh> ref(s) emitted as PLACEHOLDER boxes (not fabricated): ` +
          result.externalMeshes.map((m) => `${m.link}:${m.filename}`).join(", "),
      );
    }

    const reg = await registerModel({
      modelKey: input.modelKey,
      modelUri,
      machineId: input.machineId ?? null,
      equipmentId: input.equipmentId ?? null,
      equipmentClass: input.equipmentClass ?? null,
      modelKind: "gltf" as ModelKind,
      sourceFormat: "urdf",
      conversionStatus: "ready",
      bounds: { min: result.bounds.min, max: result.bounds.max, unit: "m" },
      scope: input.scope ?? null,
      notes: notes.join(" "),
      corporateCode: input.corporateCode ?? null,
      factoryId: input.factoryId ?? null,
      createdBy: input.createdBy ?? null,
    });

    return {
      ok: true,
      status: "ready",
      modelKey: input.modelKey,
      modelUri,
      registryId: reg.id,
      bounds: result.bounds,
      externalMeshCount: result.externalMeshes.length,
      meshCount: result.meshCount,
      nodeCount: result.nodeCount,
      message: reg.ok ? undefined : reg.message,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // HONEST failure: record a 'failed' row (no asset), never 'ready'.
    await registerModel({
      modelKey: input.modelKey,
      modelUri: "", // no asset
      machineId: input.machineId ?? null,
      equipmentId: input.equipmentId ?? null,
      equipmentClass: input.equipmentClass ?? null,
      modelKind: "urdf",
      sourceFormat: "urdf",
      conversionStatus: "failed",
      notes: `T2a URDF conversion FAILED: ${message}`,
      createdBy: input.createdBy ?? null,
    }).catch(() => undefined);
    return { ok: false, status: "failed", modelKey: input.modelKey, message };
  }
}

export interface ConvertStepInput {
  modelKey: string;
  sourceFormat: "step" | "iges";
  /**
   * The raw CAD file to convert (STEP/IGES text, base64, or bytes). When ABSENT the
   * call stays the HONEST SEAM: no geometry is fabricated, a 'pending' row is written.
   */
  stepSource?: string | Buffer | Uint8Array;
  machineId?: number | null;
  equipmentId?: string | null;
  equipmentClass?: string | null;
  scope?: string | null;
  corporateCode?: string | null;
  factoryId?: number | null;
  createdBy?: number | null;
}

export interface ConvertStepResult {
  ok: boolean;
  status: "ready" | "failed" | "pending" | "disabled";
  modelKey: string;
  modelUri?: string;
  registryId?: number;
  bounds?: { min: [number, number, number]; max: [number, number, number] };
  meshCount?: number;
  solidCount?: number;
  triangleCount?: number;
  message?: string;
}

/** Coerce a caller-supplied STEP source (text / base64 / bytes) to raw bytes. */
function toStepBytes(src: string | Buffer | Uint8Array): Uint8Array {
  if (typeof src !== "string") return src instanceof Uint8Array ? src : new Uint8Array(src);
  // A STEP/IGES file is ISO-10303 ASCII text starting with "ISO-10303-21" (STEP) or
  // "S      1"/flag lines (IGES). If it doesn't look like text, treat it as base64.
  if (/ISO-10303-21|^\s*S\s+\d|FILE_SCHEMA|HEADER;/i.test(src.slice(0, 256))) {
    return new Uint8Array(Buffer.from(src, "utf8"));
  }
  try {
    return new Uint8Array(Buffer.from(src, "base64"));
  } catch {
    return new Uint8Array(Buffer.from(src, "utf8"));
  }
}

/**
 * STEP/IGES → glTF via occt-import-js (OpenCASCADE WASM).
 *
 *   • With `stepSource`: parse → tessellate → glTF (mm→m) → write
 *     uploads/models/step/<key>.gltf → register conversionStatus 'ready' (bounds in m).
 *     On ANY failure (bad file, occt unavailable, zero solids) → a 'failed' row with the
 *     honest reason. NEVER fabricates geometry.
 *   • Without `stepSource`: the HONEST SEAM is preserved — a 'pending' row is written
 *     pointing at the real converter, and NOTHING is fabricated.
 *
 * Flag-gated by MODEL_PIPELINE_ENABLED.
 */
export async function convertStepModel(input: ConvertStepInput): Promise<ConvertStepResult> {
  if (!modelPipelineEnabled()) {
    return { ok: false, status: "disabled", modelKey: input.modelKey, message: "MODEL_PIPELINE_ENABLED is off" };
  }

  // ── No source → keep the honest 'pending' seam (nothing to convert, no fake mesh). ──
  if (input.stepSource == null) {
    const note =
      `${input.sourceFormat.toUpperCase()}→glTF needs the source CAD file plus a CAD kernel ` +
      `(occt-import-js WASM OpenCASCADE). None supplied — registered 'pending'; no geometry fabricated.`;
    const reg = await registerModel({
      modelKey: input.modelKey,
      modelUri: "",
      machineId: input.machineId ?? null,
      equipmentId: input.equipmentId ?? null,
      equipmentClass: input.equipmentClass ?? null,
      modelKind: "gltf",
      sourceFormat: input.sourceFormat,
      conversionStatus: "pending",
      notes: note,
      createdBy: input.createdBy ?? null,
    });
    return { ok: false, status: "pending", modelKey: input.modelKey, message: note, registryId: reg.id };
  }

  const key = safeKey(input.modelKey);
  try {
    const bytes = toStepBytes(input.stepSource);
    if (!bytes.length) throw new Error("empty CAD source (0 bytes)");
    const result = await stepBufferToGltf(bytes, { sourceFormat: input.sourceFormat });

    const { modelUri } = await writeGltfAsset("step", key, result.json);

    const notes =
      `T4 ${input.sourceFormat.toUpperCase()}→glTF (occt-import-js): ${result.solidCount} solid(s), ` +
      `${result.triangleCount} triangles. Units mm→m; bounds in metres.`;

    const reg = await registerModel({
      modelKey: input.modelKey,
      modelUri,
      machineId: input.machineId ?? null,
      equipmentId: input.equipmentId ?? null,
      equipmentClass: input.equipmentClass ?? null,
      modelKind: "gltf" as ModelKind,
      sourceFormat: input.sourceFormat,
      conversionStatus: "ready",
      bounds: { min: result.bounds.min, max: result.bounds.max, unit: "m" },
      scope: input.scope ?? null,
      notes,
      corporateCode: input.corporateCode ?? null,
      factoryId: input.factoryId ?? null,
      createdBy: input.createdBy ?? null,
    });

    return {
      ok: true,
      status: "ready",
      modelKey: input.modelKey,
      modelUri,
      registryId: reg.id,
      bounds: result.bounds,
      meshCount: result.meshCount,
      solidCount: result.solidCount,
      triangleCount: result.triangleCount,
      message: reg.ok ? undefined : reg.message,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // HONEST failure: a 'failed' row (no asset), never 'ready', never a fake mesh.
    await registerModel({
      modelKey: input.modelKey,
      modelUri: "",
      machineId: input.machineId ?? null,
      equipmentId: input.equipmentId ?? null,
      equipmentClass: input.equipmentClass ?? null,
      modelKind: "gltf",
      sourceFormat: input.sourceFormat,
      conversionStatus: "failed",
      notes: `T4 ${input.sourceFormat.toUpperCase()} conversion FAILED: ${message}`,
      createdBy: input.createdBy ?? null,
    }).catch(() => undefined);
    return { ok: false, status: "failed", modelKey: input.modelKey, message };
  }
}
