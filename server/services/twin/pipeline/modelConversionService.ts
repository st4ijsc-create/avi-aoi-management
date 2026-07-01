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
 *   • STEP/IGES → glTF is a DOCUMENTED PHASE-2 SEAM: `convertStepModel` writes NOTHING and
 *     registers conversionStatus='pending' with a note pointing at the real path
 *     (occt-import-js / assimp — a CAD kernel). It does NOT fake geometry.
 *   • External `<mesh>` refs inside a URDF that can't be triangulated become labelled
 *     placeholders; the ready row's notes record how many + that they are placeholders.
 *
 * ── STORAGE ─────────────────────────────────────────────────────────────────
 * Converted assets are written under the local uploads root (LOCAL_STORAGE_DIR, default
 * ./uploads) at models/urdf/<key>.gltf and served by Express at /uploads/models/urdf/<key>.gltf
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
    const relKey = `models/urdf/${key}.gltf`;
    const filePath = path.join(uploadsRoot(), relKey);
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(path.resolve(uploadsRoot()) + path.sep)) {
      throw new Error("Invalid model key: path traversal detected");
    }
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await fs.promises.writeFile(filePath, result.json, "utf8");
    const modelUri = `/uploads/${relKey}`;

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

export interface ConvertStepResult {
  ok: false;
  status: "pending" | "disabled";
  modelKey: string;
  message: string;
  registryId?: number;
}

/**
 * STEP/IGES → glTF — DOCUMENTED PHASE-2 SEAM. Does NOT convert anything: a STEP/IGES kernel
 * (occt-import-js — WASM OpenCASCADE — or assimp / FreeCAD headless) is required and is out of
 * scope for T2a's pure-Node pipeline. Registers a 'pending' row with an honest note so the FE
 * shows the source is queued-but-not-converted (falls back to a primitive). NEVER faked.
 */
export async function convertStepModel(input: {
  modelKey: string;
  sourceFormat: "step" | "iges";
  machineId?: number | null;
  equipmentId?: string | null;
  equipmentClass?: string | null;
  createdBy?: number | null;
}): Promise<ConvertStepResult> {
  if (!modelPipelineEnabled()) {
    return { ok: false, status: "disabled", modelKey: input.modelKey, message: "MODEL_PIPELINE_ENABLED is off" };
  }
  const note =
    `${input.sourceFormat.toUpperCase()}→glTF requires a CAD kernel (occt-import-js WASM OpenCASCADE, or assimp / ` +
    `FreeCAD headless) — PHASE-2 seam, not implemented in the pure-Node T2a pipeline. No geometry fabricated.`;
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
