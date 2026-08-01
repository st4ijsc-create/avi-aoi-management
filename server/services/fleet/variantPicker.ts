/**
 * Khối 2 (doc 16 §7 part c / §15 G2) — A/B program variant picker.
 * Flag: FLEET_RESOURCE_ENABLED (default OFF).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * When a program is dispatched for an operation, pickVariant() chooses one of a
 * program_project's ACTIVE variant arms (A | B | control) by WEIGHTED traffic split.
 *
 * DETERMINISM (for testability + stable per-task assignment): the choice is driven
 * by a stable hash of a caller-supplied `seed` (e.g. the taskKey), NOT Math.random.
 * Same seed + same arm weights → same arm, every time. This also means a given task
 * always lands in the same arm across retries (no flip-flop mid-rollout).
 *
 * The picker NORMALISES the active arms' trafficSplitPct (they need not sum to 100):
 * each arm owns a contiguous sub-range of [0,1) proportional to its weight; the
 * seed's hash maps into that line. Paused arms are excluded; if every arm is paused
 * (or there are none), the result is null (caller falls back to the base program).
 *
 * recordVariantOutcome() folds one run outcome into the arm's rolling `metrics`
 * jsonb (runs / successes / failures / avgCycleMs) — best-effort, flag-gated.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { eq } from "drizzle-orm";
import { getDb } from "../../db/connection";
import { programVariants } from "../../../drizzle/schema/fleetResource";
import { fleetResourceEnabled } from "./skillRegistry";

/** A variant arm as the PURE picker sees it (no DB shape leaks in). */
export interface VariantArm {
  id: number;
  variant: string; // 'A' | 'B' | 'control'
  trafficSplitPct: number;
  status: string; // 'active' | 'paused'
}

export interface PickedVariant {
  id: number;
  variant: string;
}

/**
 * Stable 32-bit FNV-1a hash of a seed string → a float in [0,1). Deterministic and
 * dependency-free (no crypto import needed for a non-security weighting).
 */
export function seedToUnit(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // >>> 0 → unsigned; divide by 2^32 → [0,1)
  return (h >>> 0) / 0x100000000;
}

/**
 * PURE — pick an active arm deterministically from `seed`. Active arms with a
 * non-positive weight are treated as weight 0; if ALL active weights are 0 they are
 * split evenly (so a misconfigured 0/0 split still picks rather than dropping work).
 * Returns null when there is no active arm.
 */
export function pickVariant(arms: VariantArm[], seed: string): PickedVariant | null {
  const active = arms.filter((a) => a.status === "active");
  if (active.length === 0) return null;

  let weights = active.map((a) => (a.trafficSplitPct > 0 ? a.trafficSplitPct : 0));
  let total = weights.reduce((s, w) => s + w, 0);
  if (total <= 0) {
    // all-zero → even split
    weights = active.map(() => 1);
    total = active.length;
  }

  const u = seedToUnit(seed);
  let acc = 0;
  for (let i = 0; i < active.length; i++) {
    acc += weights[i] / total;
    if (u < acc) return { id: active[i].id, variant: active[i].variant };
  }
  // floating-point tail → last active arm
  const last = active[active.length - 1];
  return { id: last.id, variant: last.variant };
}

/**
 * DB-bound — pick a variant for a program_project by seed. No-op (null) unless
 * FLEET_RESOURCE_ENABLED. Reads only the variant table; opens no control path.
 */
export async function pickVariantForProgram(programProjectId: number, seed: string): Promise<{ enabled: boolean; picked: PickedVariant | null }> {
  if (!fleetResourceEnabled()) return { enabled: false, picked: null };
  const db = await getDb();
  if (!db) return { enabled: true, picked: null };
  const arms = await db.select().from(programVariants).where(eq(programVariants.programProjectId, programProjectId));
  return { enabled: true, picked: pickVariant(arms.map((a) => ({ id: a.id, variant: a.variant, trafficSplitPct: a.trafficSplitPct, status: a.status })), seed) };
}

export interface VariantMetrics {
  runs?: number;
  successes?: number;
  failures?: number;
  avgCycleMs?: number;
  [k: string]: unknown;
}

/**
 * PURE — fold one outcome into a rolling metrics object (running average for cycle).
 * Exposed so tests can assert the accumulation without a DB.
 */
export function foldOutcome(prev: VariantMetrics | null | undefined, outcome: { success: boolean; cycleMs?: number }): VariantMetrics {
  const runs = (prev?.runs ?? 0) + 1;
  const successes = (prev?.successes ?? 0) + (outcome.success ? 1 : 0);
  const failures = (prev?.failures ?? 0) + (outcome.success ? 0 : 1);
  let avgCycleMs = prev?.avgCycleMs;
  if (typeof outcome.cycleMs === "number") {
    const prevAvg = prev?.avgCycleMs ?? 0;
    const prevRuns = prev?.runs ?? 0;
    avgCycleMs = Math.round((prevAvg * prevRuns + outcome.cycleMs) / runs);
  }
  return { ...prev, runs, successes, failures, ...(avgCycleMs != null ? { avgCycleMs } : {}) };
}

/**
 * DB-bound — record an outcome against a variant arm. No-op unless
 * FLEET_RESOURCE_ENABLED. Best-effort; never throws to the caller.
 */
export async function recordVariantOutcome(variantId: number, outcome: { success: boolean; cycleMs?: number }): Promise<{ enabled: boolean; ok: boolean }> {
  if (!fleetResourceEnabled()) return { enabled: false, ok: false };
  const db = await getDb();
  if (!db) return { enabled: true, ok: false };
  const [arm] = await db.select().from(programVariants).where(eq(programVariants.id, variantId)).limit(1);
  if (!arm) return { enabled: true, ok: false };
  const next = foldOutcome(arm.metrics as VariantMetrics | null, outcome);
  await db.update(programVariants).set({ metrics: next, updatedAt: new Date() }).where(eq(programVariants.id, variantId));
  return { enabled: true, ok: true };
}
