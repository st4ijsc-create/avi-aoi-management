/**
 * doc 81 Đợt 8 task N fix 1 (owner decision I1, 2026-10-11) — MAKER-CHECKER of REAL safety-PLC configs.
 *
 * The background poller (safetyPlcPoller.ts) records the e-stop / guard trips of a REAL backend (modbus / opcua) through the
 * trusted device-ingest door ⇒ those notices bypass the recipients' opt-outs. The trust root is the CONFIG (endpoint, tag
 * map, binding). Rule:
 *   • a real config is trusted ONLY while its CURRENT digest (plcTrustDigest, computed here, the one place) equals the
 *     `approvedDigest` of its safety_plc_config_trust row, approved by a SECOND person (an admin who is neither the last
 *     editor nor an author of a create/update since the previous approval);
 *   • every create / update through the router clears the approval (new edit row); an edit by any other path changes the
 *     digest ⇒ no match ⇒ not trusted;
 *   • not approved / changed / table missing / lookup error ⇒ NOT trusted: events are still recorded, as NORMAL notices
 *     (fail closed for trust only — nothing is dropped, nothing on a STOP path depends on this);
 *   • a sim config is never trusted and cannot be approved.
 * Every config write is audited in control_audit_log (create / update / delete / approve / reject), in the SAME transaction
 * as the write. Scope: a config is reachable by id only when its factory is in the caller's factory scope (full scope ⇒
 * all; a config without factory ⇒ full scope only); out of scope and nonexistent give the SAME "not_found" (R-5-d parity).
 * L-7: this module writes configuration / audit rows only; it never talks to a PLC.
 */
import { createHash } from "node:crypto";
import { and, desc, eq, gt, inArray } from "drizzle-orm";
import { DbUnavailableError } from "../../../_core/dbErrors";
import { getDb } from "../../../db/connection";
import {
  controlAuditLog,
  safetyPlcConfigs,
  safetyPlcConfigTrust,
  type SafetyPlcConfig,
  type SafetyPlcConfigTrust,
  type SafetyPlcStatusMap,
} from "../../../../drizzle/schema";
import { recordAuditEvent } from "../../audit/controlAuditService";
import type { UpsertPlcConfigInput } from "./safetyPlcAdapter";

/** control_audit_log.entityType of a safety-PLC config. */
export const PLC_CONFIG_AUDIT_ENTITY = "safety_plc_config";
export const PLC_TRUST_DIGEST_VERSION = "plc-trust-v1";

const TAG_FLAGS = ["estop", "zoneOccupied", "resetRequired", "muting"] as const;

export function isRealPlcBackend(cfg: Pick<SafetyPlcConfig, "backend">): boolean {
  return cfg.backend === "modbus" || cfg.backend === "opcua";
}

/** The trust-relevant content of a config, in a FIXED order (defaults normalised: same meaning ⇒ same digest). */
export function plcTrustMaterial(cfg: Pick<SafetyPlcConfig, "backend" | "endpoint" | "statusMap" | "robotId" | "stationId" | "lineId" | "factoryId" | "scope" | "corporateCode" | "enabled">) {
  const map = (cfg.statusMap ?? {}) as SafetyPlcStatusMap;
  const tags = TAG_FLAGS.map((f) => {
    const t = map[f];
    return t?.address ? [f, String(t.address), t.dataType ?? "bool", t.activeWhen ?? "truthy"] : [f, null, null, null];
  });
  return [
    PLC_TRUST_DIGEST_VERSION,
    String(cfg.backend ?? ""),
    String(cfg.endpoint ?? "").trim(),
    tags,
    cfg.robotId ?? null,
    cfg.stationId ?? null,
    cfg.lineId ?? null,
    cfg.factoryId ?? null,
    cfg.scope ?? null,
    cfg.corporateCode ?? null,
    cfg.enabled === true,
  ];
}

/** sha256 (hex) of the trust-relevant content. The ONE digest function (router, poller, UI all use this). */
export function plcTrustDigest(cfg: Parameters<typeof plcTrustMaterial>[0]): string {
  return createHash("sha256").update(JSON.stringify(plcTrustMaterial(cfg))).digest("hex");
}

/** A trust row approves `cfg` ⇔ real backend, approved digest = current digest, approver set and ≠ last editor. */
export function trustRowApproves(cfg: SafetyPlcConfig, row: Pick<SafetyPlcConfigTrust, "approvedDigest" | "approvedBy" | "lastEditedBy"> | null | undefined): boolean {
  if (!isRealPlcBackend(cfg) || !row) return false;
  if (row.approvedBy == null || !row.approvedDigest) return false;
  if (row.lastEditedBy != null && row.approvedBy === row.lastEditedBy) return false;
  return row.approvedDigest === plcTrustDigest(cfg);
}

/** Poller hook: is this (snapshot of a) config approved right now? Any error / missing table ⇒ false (not trusted). */
export async function isPlcConfigTrustApproved(cfg: SafetyPlcConfig): Promise<boolean> {
  try {
    if (!isRealPlcBackend(cfg)) return false;
    const d = await getDb();
    if (!d) return false;
    const [row] = await d.select().from(safetyPlcConfigTrust).where(eq(safetyPlcConfigTrust.configId, cfg.id)).limit(1);
    return trustRowApproves(cfg, row);
  } catch {
    return false;
  }
}

/** Caller's factory scope: null = full scope; [] = nothing. */
export type PlcScope = number[] | null;
export function plcConfigInScope(scope: PlcScope, factoryId: number | null | undefined): boolean {
  if (scope === null) return true;
  return factoryId != null && scope.includes(factoryId);
}

async function db() {
  const d = await getDb();
  if (!d) throw new DbUnavailableError();
  return d;
}
type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

function configValues(input: UpsertPlcConfigInput) {
  return {
    code: input.code,
    name: input.name,
    vendor: input.vendor ?? "generic",
    backend: input.backend ?? "sim",
    endpoint: input.endpoint ?? null,
    statusMap: input.statusMap ?? undefined,
    robotId: input.robotId ?? null,
    stationId: input.stationId ?? null,
    lineId: input.lineId ?? null,
    enabled: input.enabled ?? true,
    notes: input.notes ?? null,
    scope: input.scope ?? null,
    corporateCode: input.corporateCode ?? null,
    factoryId: input.factoryId ?? null,
  };
}

/** A new edit: the editor becomes the maker; any approval / rejection is cleared (an edit always clears trust). */
async function markEdited(tx: Tx, cfg: SafetyPlcConfig, actorId: number): Promise<void> {
  const edit = {
    lastEditedBy: actorId,
    lastEditedAt: new Date(),
    editDigest: plcTrustDigest(cfg),
    approvedDigest: null,
    approvedBy: null,
    approvedAt: null,
    rejectedDigest: null,
    rejectedBy: null,
    rejectedAt: null,
    rejectReason: null,
  };
  await tx
    .insert(safetyPlcConfigTrust)
    .values({ configId: cfg.id, ...edit })
    .onConflictDoUpdate({ target: safetyPlcConfigTrust.configId, set: edit });
}

export type PlcWriteResult<T> = { kind: "ok"; value: T } | { kind: "not_found" };

/**
 * Create / update a config (router upsertSafetyPlcConfig). Scope: an update reaches only an in-scope row, and neither a
 * create nor an update may place the row outside the caller's scope (both ⇒ "not_found", the same answer as a missing id).
 * Audited (create / update, before + after) and the trust row reset, all in ONE transaction.
 */
export async function savePlcConfig(input: UpsertPlcConfigInput, actorId: number, scope: PlcScope): Promise<PlcWriteResult<{ config: SafetyPlcConfig; created: boolean }>> {
  const d = await db();
  const values = configValues(input);
  return d.transaction(async (tx) => {
    if (input.id != null) {
      const [before] = await tx.select().from(safetyPlcConfigs).where(eq(safetyPlcConfigs.id, input.id)).limit(1).for("update");
      if (!before || !plcConfigInScope(scope, before.factoryId) || !plcConfigInScope(scope, values.factoryId)) return { kind: "not_found" as const };
      const [config] = await tx.update(safetyPlcConfigs).set({ ...values, updatedAt: new Date() }).where(eq(safetyPlcConfigs.id, input.id)).returning();
      await markEdited(tx, config, actorId);
      await recordAuditEvent(tx, { entityType: PLC_CONFIG_AUDIT_ENTITY, entityId: config.id, action: "update", actorId, before, after: config });
      return { kind: "ok" as const, value: { config, created: false } };
    }
    if (!plcConfigInScope(scope, values.factoryId)) return { kind: "not_found" as const };
    const [config] = await tx.insert(safetyPlcConfigs).values(values).returning();
    await markEdited(tx, config, actorId);
    await recordAuditEvent(tx, { entityType: PLC_CONFIG_AUDIT_ENTITY, entityId: config.id, action: "create", actorId, before: null, after: config });
    return { kind: "ok" as const, value: { config, created: true } };
  });
}

/** Delete a config (audited; its trust row goes with it — FK ON DELETE CASCADE). Out of scope ⇒ "not_found". */
export async function deletePlcConfig(id: number, actorId: number, scope: PlcScope, reason?: string | null): Promise<PlcWriteResult<{ id: number }>> {
  const d = await db();
  return d.transaction(async (tx) => {
    const [before] = await tx.select().from(safetyPlcConfigs).where(eq(safetyPlcConfigs.id, id)).limit(1).for("update");
    if (!before || !plcConfigInScope(scope, before.factoryId)) return { kind: "not_found" as const };
    await recordAuditEvent(tx, { entityType: PLC_CONFIG_AUDIT_ENTITY, entityId: id, action: "delete", actorId, before, after: null, reason: reason ?? null });
    await tx.delete(safetyPlcConfigs).where(eq(safetyPlcConfigs.id, id));
    return { kind: "ok" as const, value: { id } };
  });
}

/** Authors (create / update actors) of a config since its last approval (audit trail — ILK-02 pattern). */
async function authoredSinceLastApproval(tx: Tx | Db, configId: number, userId: number): Promise<boolean> {
  const scopeQ = and(eq(controlAuditLog.entityType, PLC_CONFIG_AUDIT_ENTITY), eq(controlAuditLog.entityId, String(configId)));
  const [lastApproval] = await tx
    .select({ id: controlAuditLog.id })
    .from(controlAuditLog)
    .where(and(scopeQ, eq(controlAuditLog.action, "approve")))
    .orderBy(desc(controlAuditLog.id))
    .limit(1);
  const [authored] = await tx
    .select({ id: controlAuditLog.id })
    .from(controlAuditLog)
    .where(and(scopeQ, inArray(controlAuditLog.action, ["create", "update"]), eq(controlAuditLog.actorId, userId), lastApproval ? gt(controlAuditLog.id, lastApproval.id) : undefined))
    .limit(1);
  return authored != null;
}

export type PlcDecision = "approve" | "reject";
export type PlcDecideResult =
  | { kind: "ok"; digest: string; decision: PlcDecision }
  | { kind: "not_found" }
  | { kind: "sim" }
  | { kind: "self" }
  | { kind: "stale" };

/**
 * Approve / reject the CURRENT content of a real config. `expectedDigest` = the digest the approver was shown; it must
 * equal the server's digest of the row under FOR UPDATE (else "stale"). The approver must be neither the last editor nor
 * an author since the last approval ("self"). Audited in the same transaction.
 */
export async function decidePlcConfigTrust(
  input: { id: number; decision: PlcDecision; expectedDigest: string; reason?: string | null },
  actorId: number,
  scope: PlcScope,
): Promise<PlcDecideResult> {
  const d = await db();
  return d.transaction(async (tx) => {
    const [cfg] = await tx.select().from(safetyPlcConfigs).where(eq(safetyPlcConfigs.id, input.id)).limit(1).for("update");
    if (!cfg || !plcConfigInScope(scope, cfg.factoryId)) return { kind: "not_found" as const };
    if (!isRealPlcBackend(cfg)) return { kind: "sim" as const };
    const [row] = await tx.select().from(safetyPlcConfigTrust).where(eq(safetyPlcConfigTrust.configId, cfg.id)).limit(1).for("update");
    if ((row?.lastEditedBy != null && row.lastEditedBy === actorId) || (await authoredSinceLastApproval(tx, cfg.id, actorId))) return { kind: "self" as const };
    const digest = plcTrustDigest(cfg);
    if (input.expectedDigest !== digest) return { kind: "stale" as const };
    const now = new Date();
    const set =
      input.decision === "approve"
        ? { approvedDigest: digest, approvedBy: actorId, approvedAt: now, rejectedDigest: null, rejectedBy: null, rejectedAt: null, rejectReason: null }
        : { approvedDigest: null, approvedBy: null, approvedAt: null, rejectedDigest: digest, rejectedBy: actorId, rejectedAt: now, rejectReason: input.reason ?? null };
    const [after] = await tx
      .insert(safetyPlcConfigTrust)
      .values({ configId: cfg.id, lastEditedBy: row?.lastEditedBy ?? null, editDigest: row?.editDigest ?? null, ...set })
      .onConflictDoUpdate({ target: safetyPlcConfigTrust.configId, set })
      .returning();
    await recordAuditEvent(tx, {
      entityType: PLC_CONFIG_AUDIT_ENTITY,
      entityId: cfg.id,
      action: input.decision,
      actorId,
      before: row ?? null,
      after: { ...after, digest },
      reason: input.reason ?? null,
    });
    return { kind: "ok" as const, digest, decision: input.decision };
  });
}

export type PlcTrustState = "sim" | "approved" | "pending" | "rejected";
export interface PlcTrustListRow {
  id: number;
  code: string;
  name: string;
  backend: string;
  enabled: boolean;
  robotId: number | null;
  stationId: number | null;
  lineId: number | null;
  factoryId: number | null;
  state: PlcTrustState;
  digest: string;
  approvedBy: number | null;
  approvedAt: Date | null;
  rejectedBy: number | null;
  rejectedAt: Date | null;
  rejectReason: string | null;
  lastEditedBy: number | null;
  lastEditedAt: Date | null;
  /** The viewer may approve / reject now (admin, real backend, not the maker / a recent author). */
  mayDecide: boolean;
  /** Why not (when the viewer is an admin): "sim" | "self". */
  blockedBy: "sim" | "self" | null;
  /** What the approver approves — shown to ADMINS only (null otherwise). */
  endpoint: string | null;
  tags: Array<{ flag: string; address: string | null; dataType: string | null; activeWhen: string | null }> | null;
}

/** The trust status of every config in the viewer's scope (approval screen). */
export async function listPlcTrust(scope: PlcScope, viewer: { id: number; isAdmin: boolean }): Promise<PlcTrustListRow[]> {
  const d = await db();
  const cfgs = (await d.select().from(safetyPlcConfigs).orderBy(safetyPlcConfigs.id)).filter((c) => plcConfigInScope(scope, c.factoryId));
  if (cfgs.length === 0) return [];
  const ids = cfgs.map((c) => c.id);
  let rows: SafetyPlcConfigTrust[] = [];
  try {
    rows = await d.select().from(safetyPlcConfigTrust).where(inArray(safetyPlcConfigTrust.configId, ids));
  } catch {
    rows = []; // table missing (0368 not applied) ⇒ everything "pending" (not trusted)
  }
  const byId = new Map(rows.map((r) => [r.configId, r]));
  const out: PlcTrustListRow[] = [];
  for (const c of cfgs) {
    const r = byId.get(c.id) ?? null;
    const real = isRealPlcBackend(c);
    const digest = plcTrustDigest(c);
    const state: PlcTrustState = !real ? "sim" : trustRowApproves(c, r) ? "approved" : r?.rejectedDigest === digest ? "rejected" : "pending";
    let blockedBy: PlcTrustListRow["blockedBy"] = null;
    if (viewer.isAdmin) {
      if (!real) blockedBy = "sim";
      else if ((r?.lastEditedBy != null && r.lastEditedBy === viewer.id) || (await authoredSinceLastApproval(d, c.id, viewer.id).catch(() => true))) blockedBy = "self";
    }
    const map = (c.statusMap ?? {}) as SafetyPlcStatusMap;
    out.push({
      id: c.id,
      code: c.code,
      name: c.name,
      backend: c.backend,
      enabled: c.enabled,
      robotId: c.robotId,
      stationId: c.stationId,
      lineId: c.lineId,
      factoryId: c.factoryId,
      state,
      digest,
      approvedBy: r?.approvedBy ?? null,
      approvedAt: r?.approvedAt ?? null,
      rejectedBy: r?.rejectedBy ?? null,
      rejectedAt: r?.rejectedAt ?? null,
      rejectReason: r?.rejectReason ?? null,
      lastEditedBy: r?.lastEditedBy ?? null,
      lastEditedAt: r?.lastEditedAt ?? null,
      mayDecide: viewer.isAdmin && blockedBy === null,
      blockedBy,
      endpoint: viewer.isAdmin ? (c.endpoint ?? null) : null,
      tags: viewer.isAdmin
        ? TAG_FLAGS.map((f) => ({ flag: f, address: map[f]?.address ?? null, dataType: map[f]?.address ? (map[f]?.dataType ?? "bool") : null, activeWhen: map[f]?.address ? (map[f]?.activeWhen ?? "truthy") : null }))
        : null,
    });
  }
  return out;
}
