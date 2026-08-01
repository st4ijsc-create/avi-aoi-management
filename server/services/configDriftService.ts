/**
 * doc 56 Đ4 — Generic config-sync + drift service (CONFIG-SYNC-1/2/3/6).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * The GENERIC config-sync brain. A machine pulls a versioned config for a
 * (machine, configKind) pair; the server keeps a "digital shadow" of what it is
 * SUPPOSED to run (desired*, written at deploy/notify) vs what it REPORTS running
 * (reported*, written at ackConfigApplied / heartbeat drift). driftState is the
 * two-way reconciliation (in_sync | drift | unknown).
 *
 * RESOLVE ACTIVE CONFIG (per (machine, configKind)):
 *   • recipe | device_settings → active machine_recipes row, resolved PER-MACHINE
 *     first (machineId bound + status='active'), FALLING BACK to a PER-MACHINE-TYPE
 *     default (machineId IS NULL + machineType match + status='active'). An explicit
 *     configCode short-circuits to that code's active version (validated to belong
 *     to this machine or its type). Descriptor = {code, version, checksum, resolvedBy}.
 *   • points | model — resolved in machineApiRouters (they need the points/model
 *     path db helpers); this service only owns recipe/device_settings + the shadow.
 *
 * FLAGS (default OFF ⇒ every write path here is dormant; nothing touches the DB):
 *   CONFIG_SYNC_GENERIC_ENABLED — check/get/ack + deploy→desired + notify.
 *   CONFIG_DRIFT_REPORT_ENABLED — heartbeat `running[]` → reported* + drift alert.
 *
 * Fail-safe: DB absent ⇒ conservative (null descriptor, no fabricated drift). The
 * alert path swallows errors (a drift signal must never break a heartbeat/deploy).
 * ════════════════════════════════════════════════════════════════════════════
 */
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "../db/connection";
import {
  machineConfigState,
  machineRecipes,
  type MachineConfigState,
  type MachineRecipe,
} from "../../drizzle/schema";
import { getActiveRecipe } from "../db/machineRecipe";

// ── flags (read at call time — tests flip them; no redeploy) ──────────────────

function envTrue(v: string | undefined): boolean {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "true" || s === "1" || s === "yes" || s === "on";
}

/** Master switch for the generic config-sync surface (check/get/ack + deploy notify). */
export function configSyncGenericEnabled(): boolean {
  return envTrue(process.env.CONFIG_SYNC_GENERIC_ENABLED);
}

/** Switch for the two-way drift path (heartbeat `running[]` → reported* + alert). */
export function configDriftReportEnabled(): boolean {
  return envTrue(process.env.CONFIG_DRIFT_REPORT_ENABLED);
}

// ── types ─────────────────────────────────────────────────────────────────────

export type DriftState = "in_sync" | "drift" | "unknown";

/** A normalized "what should this machine run" descriptor for one configKind. */
export interface ConfigDescriptor {
  code: string;
  version: string;
  checksum: string | null;
  /** How the active config was resolved (per-machine binding vs type default). */
  resolvedBy: "machine" | "machineType";
}

/** Minimal machine shape the resolver needs (structural — avoids an auth-type cycle). */
export interface ResolverMachine {
  id: number;
  machineType: string | null | undefined;
}

// ── pure drift decision ────────────────────────────────────────────────────────

/**
 * PURE two-way drift verdict. `unknown` when either side has no data yet. When BOTH
 * carry a checksum it is authoritative (byte-exact); otherwise fall back to
 * (code, version) equality. Version is compared as a string (the shadow stores it
 * as varchar so every config family's representation round-trips).
 */
export function computeDriftState(
  desired: { code?: string | null; version?: string | null; checksum?: string | null } | null | undefined,
  reported: { code?: string | null; version?: string | null; checksum?: string | null } | null | undefined,
): DriftState {
  const hasDesired = !!desired && (desired.code != null || desired.version != null || desired.checksum != null);
  const hasReported = !!reported && (reported.code != null || reported.version != null || reported.checksum != null);
  if (!hasDesired || !hasReported) return "unknown";
  if (desired!.checksum != null && reported!.checksum != null) {
    return desired!.checksum === reported!.checksum ? "in_sync" : "drift";
  }
  const codeMatch = (desired!.code ?? null) === (reported!.code ?? null);
  const versionMatch = String(desired!.version ?? "") === String(reported!.version ?? "");
  return codeMatch && versionMatch ? "in_sync" : "drift";
}

// ── active-config resolution (recipe / device_settings) ────────────────────────

/** Active machine-TYPE default recipe (machineId IS NULL) for a machine family. */
async function resolveActiveRecipeByType(machineType: string | null | undefined): Promise<MachineRecipe | undefined> {
  if (!machineType) return undefined;
  const db = await getDb();
  if (!db) return undefined;
  const [row] = await db
    .select()
    .from(machineRecipes)
    .where(and(
      eq(machineRecipes.machineType, machineType as NonNullable<MachineRecipe["machineType"]>),
      isNull(machineRecipes.machineId),
      eq(machineRecipes.status, "active"),
    ))
    .limit(1);
  return row;
}

/**
 * Resolve the active recipe ROW for (machine, configKind∈{recipe,device_settings}).
 * PER-MACHINE binding wins; falls back to the machine-TYPE default. An explicit
 * `configCode` short-circuits to that code's active version (ignored if it does not
 * belong to this machine or its type — a machine can only be handed ITS config).
 * Returns null when nothing active resolves (honest — no fabricated config).
 */
export async function resolveActiveRecipe(
  machine: ResolverMachine,
  configCode?: string,
): Promise<{ recipe: MachineRecipe; resolvedBy: ConfigDescriptor["resolvedBy"] } | null> {
  let recipe: MachineRecipe | undefined;
  let resolvedBy: ConfigDescriptor["resolvedBy"] = "machine";

  const trimmedCode = configCode?.trim() || undefined;
  if (trimmedCode) {
    const byCode = await getActiveRecipe({ code: trimmedCode });
    if (byCode) {
      const boundToMachine = byCode.machineId != null && byCode.machineId === machine.id;
      const boundToType = byCode.machineId == null && (byCode.machineType == null || byCode.machineType === machine.machineType);
      if (boundToMachine) { recipe = byCode; resolvedBy = "machine"; }
      else if (boundToType) { recipe = byCode; resolvedBy = "machineType"; }
      // else: this code is someone else's config — ignore, fall through to resolution.
    }
  }

  if (!recipe) {
    const byMachine = await getActiveRecipe({ machineId: machine.id });
    if (byMachine) { recipe = byMachine; resolvedBy = "machine"; }
  }
  if (!recipe) {
    const byType = await resolveActiveRecipeByType(machine.machineType);
    if (byType) { recipe = byType; resolvedBy = "machineType"; }
  }
  if (!recipe) return null;
  return { recipe, resolvedBy };
}

/** Descriptor {code, version, checksum, resolvedBy} form of resolveActiveRecipe. */
export async function resolveRecipeConfigDescriptor(
  machine: ResolverMachine,
  configCode?: string,
): Promise<ConfigDescriptor | null> {
  const resolved = await resolveActiveRecipe(machine, configCode);
  if (!resolved) return null;
  const { recipe, resolvedBy } = resolved;
  return {
    code: recipe.code,
    version: String(recipe.version),
    checksum: recipe.checksum ?? null,
    resolvedBy,
  };
}

// ── shadow state (machine_config_state) ────────────────────────────────────────

/** Read the shadow row for (machine, configKind), or null. Fail-safe → null. */
export async function readConfigState(machineId: number, configKind: string): Promise<MachineConfigState | null> {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db
    .select()
    .from(machineConfigState)
    .where(and(eq(machineConfigState.machineId, machineId), eq(machineConfigState.configKind, configKind)))
    .limit(1);
  return row ?? null;
}

/**
 * Write the DESIRED config (server intent) for (machine, configKind) + stamp
 * notifiedAt. Recomputes driftState against the CURRENTLY-reported values so a
 * deploy that matches what the machine already runs lands 'in_sync' immediately.
 * Upsert on (machineId, configKind). Fail-safe: DB absent ⇒ no-op.
 */
export async function upsertDesiredConfig(input: {
  machineId: number;
  configKind: string;
  code: string | null;
  version: string | number | null;
  checksum: string | null;
}): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const version = input.version != null ? String(input.version) : null;
  const existing = await readConfigState(input.machineId, input.configKind);
  const reported = existing
    ? { code: existing.reportedCode, version: existing.reportedVersion, checksum: existing.reportedChecksum }
    : null;
  const drift = computeDriftState({ code: input.code, version, checksum: input.checksum }, reported);
  const now = new Date();
  const desired = {
    desiredCode: input.code ?? null,
    desiredVersion: version,
    desiredChecksum: input.checksum ?? null,
    notifiedAt: now,
    driftState: drift,
    updatedAt: now,
  };
  await db
    .insert(machineConfigState)
    .values({ machineId: input.machineId, configKind: input.configKind, ...desired })
    .onConflictDoUpdate({
      target: [machineConfigState.machineId, machineConfigState.configKind],
      set: desired,
    });
}

/**
 * Write the REPORTED config (machine truth) for (machine, configKind), recompute
 * driftState against the stored DESIRED values, and persist both. Returns the
 * verdict so the caller (heartbeat/ack) can alert on 'drift'. Upsert on
 * (machineId, configKind). Fail-safe: DB absent ⇒ {driftState:'unknown'}.
 */
export async function recordReportedConfig(input: {
  machineId: number;
  configKind: string;
  code: string | null;
  version: string | number | null;
  checksum: string | null;
}): Promise<{ driftState: DriftState }> {
  const db = await getDb();
  if (!db) return { driftState: "unknown" };
  const version = input.version != null ? String(input.version) : null;
  const existing = await readConfigState(input.machineId, input.configKind);
  const desired = existing
    ? { code: existing.desiredCode, version: existing.desiredVersion, checksum: existing.desiredChecksum }
    : null;
  const drift = computeDriftState(desired, { code: input.code, version, checksum: input.checksum });
  const now = new Date();
  const reported = {
    reportedCode: input.code ?? null,
    reportedVersion: version,
    reportedChecksum: input.checksum ?? null,
    reportedAt: now,
    driftState: drift,
    updatedAt: now,
  };
  await db
    .insert(machineConfigState)
    .values({ machineId: input.machineId, configKind: input.configKind, ...reported })
    .onConflictDoUpdate({
      target: [machineConfigState.machineId, machineConfigState.configKind],
      set: reported,
    });
  return { driftState: drift };
}

// ── drift alert (fail-soft) ────────────────────────────────────────────────────

/**
 * Route ONE Andon warning when a machine reports drift from its desired config.
 * Best-effort: a routeAlert failure is logged and swallowed (a drift signal must
 * never break the heartbeat/ack that produced it).
 */
export async function routeConfigDriftAlert(input: {
  machineId: number;
  machineCode?: string;
  configKind: string;
  desired: { code?: string | null; version?: string | null; checksum?: string | null } | null;
  reported: { code?: string | null; version?: string | null; checksum?: string | null };
}): Promise<void> {
  try {
    const { routeAlert } = await import("./aiSmartAlertRouter");
    await routeAlert({
      type: "PATTERN_ANOMALY",
      severity: "MEDIUM",
      machineId: input.machineId,
      message:
        `Máy ${input.machineCode ?? `#${input.machineId}`} lệch cấu hình "${input.configKind}": ` +
        `mong muốn ${input.desired?.code ?? "?"}@${input.desired?.version ?? "?"} ` +
        `nhưng máy đang chạy ${input.reported.code ?? "?"}@${input.reported.version ?? "?"}. ` +
        `Cân nhắc đồng bộ lại (re-deploy/pull).`,
      data: {
        source: "config_drift",
        configKind: input.configKind,
        desired: input.desired ?? null,
        reported: input.reported,
        runbookRef: "rb-config-drift",
      },
    });
  } catch (err) {
    console.error("[configDrift] routeAlert failed:", err instanceof Error ? err.message : err);
  }
}
