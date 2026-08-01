/**
 * doc 44 Batch W2-A2 (gap G1.11) — config-drift control (SYNAPSE Tầng-1 §6.4).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * "Kiểm soát trôi cấu hình": compare the RUNNING config of a connectivity entity
 * — a device_adapter row + its device_tags set — against the APPROVED baseline;
 * alert when they diverge.
 *
 * HASHING (pure, unit-tested):
 *   • SECRETS NEVER ENTER THE HASH: connectionOptions keys matching
 *     password/secret/token/credential/passphrase/private/api[-_]?key are
 *     dropped recursively; URL userinfo (scheme://user:pass@host) is stripped
 *     from the endpoint. So rotating a password is NOT drift, and the hash can
 *     be shown/stored without leaking credentials.
 *   • Stable: object keys sorted recursively, tags sorted by tagKey → the same
 *     logical config always yields the same sha256 regardless of row order.
 *
 * STATUS MODEL (config_snapshots, migration 0252):
 *   unapproved — no baseline yet (approved_hash NULL)
 *   in_sync    — current hash == approved hash
 *   drift      — current hash != approved hash (drift_detected_at = start of
 *                the CURRENT episode; cleared when back in sync / re-approved)
 *
 * SWEEP: startConfigDriftSweep() — gated by CONFIG_DRIFT_ENABLED (default OFF),
 * interval CONFIG_DRIFT_INTERVAL_MS (default 10 min, min 60 s), unref'd +
 * non-overlapping (mirrors machinePresenceService). A NEW drift episode routes
 * ONE warning through the central alert path (aiSmartAlertRouter.routeAlert →
 * predictive_alerts) — repeated sweeps of the same episode do not re-alert.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { createHash } from "node:crypto";
import { and, eq, asc } from "drizzle-orm";
import type { ConfigSnapshotStatus } from "../../../drizzle/schema/assetRegistry";

// ── flags / config ────────────────────────────────────────────────────────────

export function configDriftEnabled(): boolean {
  return process.env.CONFIG_DRIFT_ENABLED === "true";
}

export function configDriftIntervalMs(): number {
  const n = Number(process.env.CONFIG_DRIFT_INTERVAL_MS);
  // default 10 minutes; floor 60 s so a typo cannot melt the DB.
  return Number.isFinite(n) && n >= 60_000 ? n : 10 * 60 * 1000;
}

// ── secret redaction + stable hashing (PURE — unit-tested) ───────────────────

/** Key-name patterns whose values must never enter the hash/summary. */
const SENSITIVE_KEY_RE = /(pass(word)?|secret|token|credential|passphrase|private|api[-_]?key)/i;

/** Recursively drop sensitive keys from a JSON-ish value (arrays preserved). */
export function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY_RE.test(k)) continue; // dropped — never hashed, never summarised
      out[k] = redactSecrets(v);
    }
    return out;
  }
  return value;
}

/** Strip URL userinfo (scheme://user:pass@host…) from an endpoint string. */
export function redactEndpoint(endpoint: string | null | undefined): string {
  if (!endpoint) return "";
  return endpoint.replace(/\/\/[^@/]+@/, "//");
}

/** Deterministic JSON: object keys sorted recursively (arrays keep order). */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** The adapter fields that participate in the hash (secret-free by construction). */
export interface AdapterConfigInput {
  code: string;
  name: string;
  protocol: string;
  endpoint: string | null;
  machineId: number | null;
  pollIntervalMs: number | null;
  isEnabled: boolean;
  connectionOptions: Record<string, unknown> | null;
}

/** One tag's hash-relevant fields. */
export interface TagConfigInput {
  tagKey: string;
  address: string;
  dataType: string;
  unit: string | null;
  scale: string | number | null;
  offset: string | number | null;
  writable: boolean;
  isEnabled: boolean;
}

/**
 * sha256 hex over the canonical (secret-redacted, stable) form of an adapter
 * config + its tag set. PURE — same inputs ⇒ same hash, key/tag order agnostic.
 */
export function computeConfigHash(adapter: AdapterConfigInput, tags: TagConfigInput[]): string {
  const canonical = {
    adapter: {
      code: adapter.code,
      name: adapter.name,
      protocol: adapter.protocol,
      endpoint: redactEndpoint(adapter.endpoint),
      machineId: adapter.machineId ?? null,
      pollIntervalMs: adapter.pollIntervalMs ?? null,
      isEnabled: adapter.isEnabled,
      connectionOptions: redactSecrets(adapter.connectionOptions ?? {}),
    },
    tags: [...tags]
      .sort((a, b) => (a.tagKey < b.tagKey ? -1 : a.tagKey > b.tagKey ? 1 : 0))
      .map((t) => ({
        tagKey: t.tagKey,
        address: t.address,
        dataType: t.dataType,
        unit: t.unit ?? null,
        scale: t.scale != null ? String(t.scale) : null,
        offset: t.offset != null ? String(t.offset) : null,
        writable: t.writable,
        isEnabled: t.isEnabled,
      })),
  };
  return createHash("sha256").update(stableStringify(canonical), "utf8").digest("hex");
}

// ── snapshot / approve / sweep (DB-backed) ────────────────────────────────────

export interface AdapterDriftView {
  entityType: "adapter";
  adapterId: number;
  adapterCode: string;
  protocol: string;
  machineId: number | null;
  currentHash: string;
  approvedHash: string | null;
  status: ConfigSnapshotStatus;
  driftDetectedAt: Date | null;
  approvedAt: Date | null;
  approvedBy: number | null;
  /** Non-secret summary (adapter name/protocol + tag counts). */
  summary: Record<string, unknown>;
  /** True only on the sweep tick that FIRST detected the current episode. */
  newlyDrifted: boolean;
}

/** Load adapter + tags and compute the current hash + summary (no writes). */
async function loadAdapterCurrent(adapterId: number): Promise<
  | { adapter: AdapterConfigInput & { id: number }; currentHash: string; summary: Record<string, unknown> }
  | null
> {
  const { getDb } = await import("../../db/connection");
  const { deviceAdapters, deviceTags } = await import("../../../drizzle/schema");
  const d = await getDb();
  if (!d) return null;
  const [adapter] = await d.select().from(deviceAdapters).where(eq(deviceAdapters.id, adapterId)).limit(1);
  if (!adapter) return null;
  const tags = await d
    .select()
    .from(deviceTags)
    .where(eq(deviceTags.adapterId, adapterId))
    .orderBy(asc(deviceTags.tagKey));

  const adapterInput: AdapterConfigInput & { id: number } = {
    id: adapter.id,
    code: adapter.code,
    name: adapter.name,
    protocol: String(adapter.protocol),
    endpoint: adapter.endpoint,
    machineId: adapter.machineId ?? null,
    pollIntervalMs: adapter.pollIntervalMs ?? null,
    isEnabled: adapter.isEnabled,
    connectionOptions: (adapter.connectionOptions as Record<string, unknown> | null) ?? null,
  };
  const tagInputs: TagConfigInput[] = tags.map((t) => ({
    tagKey: t.tagKey,
    address: t.address,
    dataType: String(t.dataType),
    unit: t.unit ?? null,
    scale: t.scale as never,
    offset: t.offset as never,
    writable: t.writable,
    isEnabled: t.isEnabled,
  }));
  const currentHash = computeConfigHash(adapterInput, tagInputs);
  const summary: Record<string, unknown> = {
    adapterCode: adapter.code,
    adapterName: adapter.name,
    protocol: String(adapter.protocol),
    tagCount: tagInputs.length,
    enabledTagCount: tagInputs.filter((t) => t.isEnabled).length,
    adapterEnabled: adapter.isEnabled,
  };
  return { adapter: adapterInput, currentHash, summary };
}

/**
 * Compute the drift view for one adapter against its persisted snapshot.
 * `persist: true` upserts config_snapshots (sweep path); `false` is read-only
 * (GET /v1/assets/:id/config-drift — a GET must not mutate).
 */
export async function checkAdapterDrift(adapterId: number, opts: { persist: boolean }): Promise<AdapterDriftView | null> {
  const current = await loadAdapterCurrent(adapterId);
  if (!current) return null;

  const { getDb } = await import("../../db/connection");
  const { configSnapshots } = await import("../../../drizzle/schema");
  const d = await getDb();
  if (!d) return null;

  const [existing] = await d
    .select()
    .from(configSnapshots)
    .where(and(eq(configSnapshots.entityType, "adapter"), eq(configSnapshots.entityId, adapterId)))
    .limit(1);

  const approvedHash = existing?.approvedHash ?? null;
  const status: ConfigSnapshotStatus =
    approvedHash == null ? "unapproved" : approvedHash === current.currentHash ? "in_sync" : "drift";
  const wasDrift = existing?.status === "drift";
  const newlyDrifted = status === "drift" && !wasDrift;
  const driftDetectedAt =
    status === "drift" ? (wasDrift && existing?.driftDetectedAt ? existing.driftDetectedAt : new Date()) : null;

  if (opts.persist) {
    const values = {
      entityType: "adapter" as const,
      entityId: adapterId,
      configHash: current.currentHash,
      approvedHash,
      approvedBy: existing?.approvedBy ?? null,
      approvedAt: existing?.approvedAt ?? null,
      driftDetectedAt,
      status,
      payloadSummary: current.summary,
      updatedAt: new Date(),
    };
    await d
      .insert(configSnapshots)
      .values(values)
      .onConflictDoUpdate({
        target: [configSnapshots.entityType, configSnapshots.entityId],
        set: {
          configHash: values.configHash,
          driftDetectedAt: values.driftDetectedAt,
          status: values.status,
          payloadSummary: values.payloadSummary,
          updatedAt: values.updatedAt,
        },
      });
  }

  return {
    entityType: "adapter",
    adapterId,
    adapterCode: current.adapter.code,
    protocol: current.adapter.protocol,
    machineId: current.adapter.machineId,
    currentHash: current.currentHash,
    approvedHash,
    status,
    driftDetectedAt,
    approvedAt: existing?.approvedAt ?? null,
    approvedBy: existing?.approvedBy ?? null,
    summary: current.summary,
    newlyDrifted,
  };
}

/**
 * Approve the CURRENT running config as the baseline: approved_hash := current,
 * status 'in_sync', drift episode cleared. `approvedBy` is a users.id when the
 * approver is an interactive user; API-key principals pass null + a name that
 * is recorded (non-secret) in payload_summary.approvedByPrincipal.
 */
export async function approveCurrentConfig(
  adapterId: number,
  approvedBy: number | null,
  principalName?: string,
): Promise<AdapterDriftView> {
  const current = await loadAdapterCurrent(adapterId);
  if (!current) throw new Error(`Adapter ${adapterId} not found (or database unavailable)`);

  const { getDb } = await import("../../db/connection");
  const { configSnapshots } = await import("../../../drizzle/schema");
  const d = await getDb();
  if (!d) throw new Error("Database not available");

  const now = new Date();
  const summary = { ...current.summary, ...(principalName ? { approvedByPrincipal: principalName } : {}) };
  await d
    .insert(configSnapshots)
    .values({
      entityType: "adapter",
      entityId: adapterId,
      configHash: current.currentHash,
      approvedHash: current.currentHash,
      approvedBy,
      approvedAt: now,
      driftDetectedAt: null,
      status: "in_sync",
      payloadSummary: summary,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [configSnapshots.entityType, configSnapshots.entityId],
      set: {
        configHash: current.currentHash,
        approvedHash: current.currentHash,
        approvedBy,
        approvedAt: now,
        driftDetectedAt: null,
        status: "in_sync",
        payloadSummary: summary,
        updatedAt: now,
      },
    });

  return {
    entityType: "adapter",
    adapterId,
    adapterCode: current.adapter.code,
    protocol: current.adapter.protocol,
    machineId: current.adapter.machineId,
    currentHash: current.currentHash,
    approvedHash: current.currentHash,
    status: "in_sync",
    driftDetectedAt: null,
    approvedAt: now,
    approvedBy,
    summary,
    newlyDrifted: false,
  };
}

/**
 * One sweep over ALL device adapters: persist snapshots, and for each NEW drift
 * episode route ONE warning through the central alert path (routeAlert →
 * predictive_alerts). Fail-safe per adapter — one bad row never aborts the sweep.
 */
export async function sweepConfigDrift(): Promise<{ checked: number; drifted: number; alerted: number }> {
  const { getDb } = await import("../../db/connection");
  const { deviceAdapters } = await import("../../../drizzle/schema");
  const d = await getDb();
  if (!d) return { checked: 0, drifted: 0, alerted: 0 };

  const adapters = await d.select({ id: deviceAdapters.id }).from(deviceAdapters);
  let checked = 0;
  let drifted = 0;
  let alerted = 0;
  for (const a of adapters) {
    try {
      const view = await checkAdapterDrift(a.id, { persist: true });
      if (!view) continue;
      checked++;
      if (view.status === "drift") drifted++;
      if (view.newlyDrifted) {
        try {
          // Central alert path (SmartAlertEvent → predictive_alerts). Severity
          // "MEDIUM" ≈ warning; runbookRef carried inside data (routeAlert's
          // event contract has no top-level runbook field — honest, not forked).
          const { routeAlert } = await import("../aiSmartAlertRouter");
          await routeAlert({
            type: "PATTERN_ANOMALY",
            severity: "MEDIUM",
            ...(view.machineId != null ? { machineId: view.machineId } : {}),
            message:
              `Config drift: adapter "${view.adapterCode}" (${view.protocol}) no longer matches its approved baseline. ` +
              `Review the change, then re-approve via POST /api/v1/assets/{id}/config-drift/approve or revert the config.`,
            data: {
              kind: "config_drift",
              adapterId: view.adapterId,
              adapterCode: view.adapterCode,
              expectedHash: view.approvedHash,
              currentHash: view.currentHash,
              runbookRef: "runbooks/config-drift",
              summary: view.summary,
            },
          } as never);
          alerted++;
        } catch (err) {
          console.error("[ConfigDrift] alert routing failed:", (err as Error)?.message ?? err);
        }
      }
    } catch (err) {
      console.error(`[ConfigDrift] adapter ${a.id} check failed:`, (err as Error)?.message ?? err);
    }
  }
  return { checked, drifted, alerted };
}

// ── scheduler (mirrors machinePresenceService: gated, unref'd, non-overlap) ──

let sweepTimer: NodeJS.Timeout | null = null;
let sweeping = false;

/** Start the periodic sweep. Self-gated by CONFIG_DRIFT_ENABLED; idempotent. */
export function startConfigDriftSweep(): void {
  if (!configDriftEnabled()) {
    console.log("[ConfigDrift] disabled (set CONFIG_DRIFT_ENABLED=true to enable)");
    return;
  }
  if (sweepTimer) return; // already scheduled
  const intervalMs = configDriftIntervalMs();
  const run = async (): Promise<void> => {
    if (sweeping) return; // no overlap
    sweeping = true;
    try {
      const r = await sweepConfigDrift();
      if (r.drifted > 0) {
        console.warn(`[ConfigDrift] sweep: ${r.drifted}/${r.checked} adapter(s) drifted (${r.alerted} new alert(s))`);
      }
    } catch (err) {
      console.error("[ConfigDrift] sweep failed:", (err as Error)?.message ?? err);
    } finally {
      sweeping = false;
    }
  };
  sweepTimer = setInterval(() => void run(), intervalMs);
  if (typeof sweepTimer.unref === "function") sweepTimer.unref();
  console.log(`[ConfigDrift] sweep armed (every ${Math.round(intervalMs / 1000)}s)`);
  void run(); // first pass immediately (fail-safe inside)
}

/** Stop the sweep (idempotent). */
export function stopConfigDriftSweep(): void {
  if (sweepTimer) clearInterval(sweepTimer);
  sweepTimer = null;
}
