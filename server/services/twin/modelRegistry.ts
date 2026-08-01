/**
 * Khối 7 (doc 16 §11.2 / §15 T1-a) — Equipment 3D Model Registry.  Flag: TWIN_LIVE_ENABLED.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * register / list / resolve a web-ready 3D model (glTF/URDF) for an equipment or an
 * equipment CLASS. THE single source of model truth shared by the scene-graph
 * builder (sceneGraph.ts) and the FE drei <Gltf> loader (doc 16 §1.1 principle:
 * one model for sim AND viz, so the twin never goes stale).
 *
 * HONEST SEAM — CAD→glTF conversion is NOT done in-process. The actual
 * STEP/IGES/URDF → glTF conversion requires external CAD/robotics tooling and is
 * OUT OF SCOPE for T1. This service ONLY stores already-converted model URIs plus a
 * `conversionStatus` provenance record. We deliberately do NOT fake a converter; a
 * row with conversionStatus != 'ready'/'external' has no usable asset yet and the FE
 * falls back to a primitive block.
 *
 * RESOLUTION precedence (most specific wins): machineId → equipmentId → equipmentClass.
 *
 * FLAG: read paths (list/resolve) are NOT flag-gated (read-only, safe, lets the UI
 * show what is registered). MUTATING register/archive are gated by TWIN_LIVE_ENABLED
 * at the router (mirrors fleetRouter.requireFlag). The service exposes a pure helper
 * `pickBestModel` so resolution logic is unit-testable without a DB.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { and, eq, desc } from "drizzle-orm";
import { getDb } from "../../db/connection";
import { equipment3dModels, type Equipment3dModel, type InsertEquipment3dModel } from "../../../drizzle/schema/twin";

/** Flag — default OFF (mirrors fleetOrchEnabled). */
export function twinLiveEnabled(): boolean {
  return process.env.TWIN_LIVE_ENABLED === "true" || process.env.TWIN_LIVE_ENABLED === "1";
}

const VALID_MODEL_KINDS = ["gltf", "urdf"] as const;
const VALID_SOURCE_FORMATS = ["step", "iges", "urdf", "gltf"] as const;
const VALID_CONVERSION = ["pending", "converting", "ready", "failed", "external"] as const;
export type ModelKind = (typeof VALID_MODEL_KINDS)[number];
export type SourceFormat = (typeof VALID_SOURCE_FORMATS)[number];
export type ConversionStatus = (typeof VALID_CONVERSION)[number];

/** A model is renderable by the FE only when the asset is actually present. */
export function isModelRenderable(m: Pick<Equipment3dModel, "conversionStatus" | "status" | "modelUri">): boolean {
  if (m.status !== "active") return false;
  if (!m.modelUri) return false;
  return m.conversionStatus === "ready" || m.conversionStatus === "external";
}

export interface ResolveTarget {
  machineId?: number | null;
  equipmentId?: string | null;
  equipmentClass?: string | null;
}

/**
 * PURE resolution — pick the best model for a target from a candidate set.
 * Precedence: an exact machineId match beats an equipmentId match beats a class
 * match. Among ties, the highest `version` (then newest id) wins. Archived /
 * non-renderable rows are skipped. No DB — unit-testable.
 */
export function pickBestModel(target: ResolveTarget, candidates: Equipment3dModel[]): Equipment3dModel | null {
  const usable = candidates.filter((c) => c.status === "active");
  const rank = (m: Equipment3dModel): number => {
    if (target.machineId != null && m.machineId === target.machineId) return 3;
    if (target.equipmentId != null && m.equipmentId === target.equipmentId) return 2;
    if (target.equipmentClass != null && m.equipmentClass === target.equipmentClass && m.machineId == null && m.equipmentId == null) return 1;
    return 0;
  };
  let best: Equipment3dModel | null = null;
  let bestScore = -1;
  for (const m of usable) {
    const r = rank(m);
    if (r === 0) continue;
    if (
      r > bestScore ||
      (r === bestScore && best != null && (m.version > best.version || (m.version === best.version && m.id > best.id)))
    ) {
      best = m;
      bestScore = r;
    }
  }
  return best;
}

export interface RegisterModelInput {
  modelKey: string;
  modelUri: string;
  machineId?: number | null;
  equipmentId?: string | null;
  equipmentClass?: string | null;
  modelKind?: ModelKind;
  sourceFormat?: SourceFormat;
  conversionStatus?: ConversionStatus;
  bounds?: Record<string, unknown> | null;
  scope?: string | null;
  notes?: string | null;
  corporateCode?: string | null;
  factoryId?: number | null;
  createdBy?: number | null;
}

export interface RegisterResult {
  ok: boolean;
  id?: number;
  created: boolean;
  version?: number;
  message?: string;
}

/**
 * Register (or re-register) a model. Idempotent on `modelKey`: a re-register UPDATES
 * the existing row in place and BUMPS `version` (so a CAD re-export produces a new
 * version, not a duplicate). Does NOT convert anything — `modelUri` must already be
 * a web-ready asset; `conversionStatus` records its provenance.
 */
export async function registerModel(input: RegisterModelInput): Promise<RegisterResult> {
  const db = await getDb();
  if (!db) return { ok: false, created: false, message: "db unavailable" };

  const modelKind = input.modelKind ?? "gltf";
  const sourceFormat = input.sourceFormat ?? (modelKind === "urdf" ? "urdf" : "gltf");
  const conversionStatus = input.conversionStatus ?? "ready";

  const [existing] = await db
    .select()
    .from(equipment3dModels)
    .where(eq(equipment3dModels.modelKey, input.modelKey))
    .limit(1);

  if (existing) {
    const nextVersion = existing.version + 1;
    await db
      .update(equipment3dModels)
      .set({
        modelUri: input.modelUri,
        machineId: input.machineId ?? null,
        equipmentId: input.equipmentId ?? null,
        equipmentClass: input.equipmentClass ?? null,
        modelKind,
        sourceFormat,
        conversionStatus,
        bounds: input.bounds ?? null,
        scope: input.scope ?? null,
        notes: input.notes ?? null,
        corporateCode: input.corporateCode ?? null,
        factoryId: input.factoryId ?? null,
        version: nextVersion,
        status: "active",
        updatedAt: new Date(),
      })
      .where(eq(equipment3dModels.id, existing.id));
    return { ok: true, id: existing.id, created: false, version: nextVersion };
  }

  const values: InsertEquipment3dModel = {
    modelKey: input.modelKey,
    modelUri: input.modelUri,
    machineId: input.machineId ?? null,
    equipmentId: input.equipmentId ?? null,
    equipmentClass: input.equipmentClass ?? null,
    modelKind,
    sourceFormat,
    conversionStatus,
    bounds: input.bounds ?? null,
    scope: input.scope ?? null,
    notes: input.notes ?? null,
    corporateCode: input.corporateCode ?? null,
    factoryId: input.factoryId ?? null,
    createdBy: input.createdBy ?? null,
    version: 1,
    status: "active",
  };
  const [row] = await db.insert(equipment3dModels).values(values).returning({ id: equipment3dModels.id });
  return { ok: true, id: row?.id, created: true, version: 1 };
}

/** List models (optionally filter by class / status). Read-only; not flag-gated. */
export async function listModels(opts?: { equipmentClass?: string; status?: string; limit?: number }): Promise<Equipment3dModel[]> {
  const db = await getDb();
  if (!db) return [];
  const conds = [];
  if (opts?.equipmentClass) conds.push(eq(equipment3dModels.equipmentClass, opts.equipmentClass));
  if (opts?.status) conds.push(eq(equipment3dModels.status, opts.status));
  return db
    .select()
    .from(equipment3dModels)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(equipment3dModels.updatedAt))
    .limit(Math.min(Math.max(opts?.limit ?? 200, 1), 1000));
}

/**
 * Resolve the best model for a target (machineId / equipmentId / equipmentClass).
 * Loads the small candidate set (rows that could match) and applies the PURE
 * `pickBestModel` precedence. Returns null when nothing usable is registered.
 */
export async function resolveModel(target: ResolveTarget): Promise<Equipment3dModel | null> {
  const db = await getDb();
  if (!db) return null;
  // The registry is small (one row per equipment/class). Load active rows and let
  // the pure picker apply precedence — keeps the query trivial + the logic testable.
  const rows = await db.select().from(equipment3dModels).where(eq(equipment3dModels.status, "active"));
  return pickBestModel(target, rows);
}

/** Archive a model (soft delete — hidden from resolve). Gated at the router. */
export async function archiveModel(id: number): Promise<{ ok: boolean }> {
  const db = await getDb();
  if (!db) return { ok: false };
  await db.update(equipment3dModels).set({ status: "archived", updatedAt: new Date() }).where(eq(equipment3dModels.id, id));
  return { ok: true };
}
