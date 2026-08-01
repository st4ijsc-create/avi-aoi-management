/**
 * Ingest contract-validation + quarantine — doc 44 Batch W2-B2 (gap G2.6).
 *
 * W0-E built the seam (schemaRegistry.validateMessage) but enforced NOTHING. This module is
 * the enforcement layer the two machine-inbound seams call:
 *   • mqttService.processAedesPublish  — raw broker frames  (source "mqtt")
 *   • telemetryBus.ingestTelemetry     — CanonicalSample[]  (source "telemetry_bus")
 *
 * MODE — env CONTRACT_VALIDATE_INGEST_MODE (read per call so tests/ops can flip live):
 *   "off"        (DEFAULT) → hooks return immediately; no seed, no validation, no timers,
 *                 no DB — zero added cost, byte-for-byte prior pipeline behaviour.
 *   "log"        → validate + console.warn + count per subject; NEVER blocks.
 *   "quarantine" → invalid message is BLOCKED from the pipeline and persisted to
 *                 contract_quarantine (migration 0254; payload capped at 64KB serialized).
 *                 Valid messages flow through untouched.
 *
 * FAIL-SAFE (hard rule): an INTERNAL error of the validator/seed/counter machinery must
 * never block production ingest → caught, counted (validatorErrors), passed through.
 * NOTE the deliberate asymmetry: a message that FAILS its contract in quarantine mode is
 * blocked even if the quarantine INSERT later fails (DB down) — the operator chose
 * enforcement; we log the persist failure loudly instead of silently un-blocking.
 *
 * SUBJECT MAPPING: only UNS topics under contract are validated —
 * syn/{site}/{area}/{line}/{cell}/{equip}/(telemetry|state|events|health|cmd[/ack])
 * → the matching "syn/+/+/+/+/+/…" subject seeded from contracts/canonical/*.json.
 * Any other topic (avi/…, $SYS, …) → null → skipped (no schema = nothing to enforce).
 *
 * METRICS: light in-process counters (valid/invalid/quarantined per subject) exposed via
 * getIngestValidationStats() + contractsRouter.ingestValidationStats — no prom dep added.
 *
 * RETENTION: rows older than CONTRACT_QUARANTINE_RETENTION_DAYS (default 30; <=0 disables)
 * are swept in bounded batches (pattern: dataRetentionService, via the jobs pool). The
 * sweep timer starts lazily on the first non-off validation → mode off schedules nothing.
 */
import { validateMessage, seedCanonicalSchemas } from "./schemaRegistry";

export type IngestSource = "mqtt" | "telemetry_bus" | "api";
export type IngestValidationMode = "off" | "log" | "quarantine";

/** Canonical subject for telemetry-shaped messages (matches telemetry.schema.json x-subject). */
export const TELEMETRY_SUBJECT = "syn/+/+/+/+/+/telemetry";

/** Serialized-payload cap for quarantine rows (beyond → truncated wrapper). */
export const QUARANTINE_MAX_PAYLOAD_BYTES = 64 * 1024;
const MAX_ERRORS_STORED = 50;

/** Current mode. Unknown/unset values fail-safe to "off". */
export function ingestValidationMode(env: NodeJS.ProcessEnv = process.env): IngestValidationMode {
  const v = env.CONTRACT_VALIDATE_INGEST_MODE;
  return v === "log" || v === "quarantine" ? v : "off";
}

// ── topic → canonical subject ────────────────────────────────────────────────
const SYN_LEAVES = new Set(["telemetry", "state", "events", "health", "cmd"]);

/**
 * Map a concrete UNS topic to the canonical subject it is under contract with, or null
 * when no contract governs it (→ caller skips validation entirely).
 */
export function topicToSubject(topic: string): string | null {
  if (!topic || !topic.startsWith("syn/")) return null;
  const parts = topic.split("/");
  if (parts.length === 7 && SYN_LEAVES.has(parts[6])) return `syn/+/+/+/+/+/${parts[6]}`;
  if (parts.length === 8 && parts[6] === "cmd" && parts[7] === "ack") return "syn/+/+/+/+/+/cmd/ack";
  return null;
}

// ── lazy canonical seed ──────────────────────────────────────────────────────
// The registry may be empty at runtime (CONTRACT_REGISTRY_PERSIST_ENABLED defaults OFF, so
// initContractRegistry never ran). Enforcement without schemas would validate nothing, so on
// the FIRST non-off validation we seed the canonical Git files into the in-memory registry
// (persist:false → the seed body runs fully synchronously; DB never touched). Idempotent vs
// a boot-time initContractRegistry (unchanged files are skipped by the seed).
let seeded = false;
function ensureCanonicalSeeded(): void {
  if (seeded) return;
  seeded = true;
  try {
    void seedCanonicalSchemas({ persist: false });
  } catch (err) {
    console.error("[ContractIngest] canonical seed failed (validation stays open):", (err as Error)?.message || err);
  }
}

// ── in-process metrics ───────────────────────────────────────────────────────
interface SubjectCounters { valid: number; invalid: number; quarantined: number }
const statsBySubject = new Map<string, SubjectCounters>();
let validatorErrors = 0; // internal validator failures that passed through (fail-safe)

function countersFor(subject: string): SubjectCounters {
  let c = statsBySubject.get(subject);
  if (!c) {
    c = { valid: 0, invalid: 0, quarantined: 0 };
    statsBySubject.set(subject, c);
  }
  return c;
}

/** Snapshot of the in-process ingest-validation counters (light metric surface). */
export function getIngestValidationStats(): {
  mode: IngestValidationMode;
  validatorErrors: number;
  subjects: Array<{ subject: string } & SubjectCounters>;
} {
  return {
    mode: ingestValidationMode(),
    validatorErrors,
    subjects: [...statsBySubject.entries()].map(([subject, c]) => ({ subject, ...c })),
  };
}

// ── quarantine persistence (fire-and-forget off the hot path) ────────────────
/**
 * Cap a payload for storage: anything serializing >64KB becomes a wrapper
 * { truncated: true, sizeBytes, preview } (preview cut byte-accurately; a multibyte char on
 * the boundary may render as a replacement char — acceptable for a review preview).
 */
export function capQuarantinePayload(payload: unknown): unknown {
  try {
    const s = JSON.stringify(payload) ?? "null";
    const bytes = Buffer.byteLength(s, "utf8");
    if (bytes <= QUARANTINE_MAX_PAYLOAD_BYTES) return payload;
    return {
      truncated: true,
      sizeBytes: bytes,
      preview: Buffer.from(s, "utf8").subarray(0, QUARANTINE_MAX_PAYLOAD_BYTES).toString("utf8"),
    };
  } catch {
    return { truncated: true, unserializable: true };
  }
}

// Writes are chained so tests (and graceful shutdown) can await them deterministically
// without the hot path ever awaiting the DB.
let quarantineWriteChain: Promise<void> = Promise.resolve();

/** Await all quarantine writes issued so far (tests / shutdown). */
export function flushQuarantineWrites(): Promise<void> {
  return quarantineWriteChain;
}

async function persistQuarantine(source: IngestSource, subject: string, payload: unknown, errors: string[]): Promise<void> {
  try {
    const { getDb } = await import("../../db/connection");
    const db = await getDb();
    if (!db) {
      console.warn(`[ContractIngest] quarantine row NOT persisted (no DB) — message from ${source} vs ${subject} was still blocked`);
      return;
    }
    const { contractQuarantine } = await import("../../../drizzle/schema/contracts");
    await db.insert(contractQuarantine).values({
      subject,
      source,
      payload: capQuarantinePayload(payload),
      errors: errors.slice(0, MAX_ERRORS_STORED),
    });
  } catch (err) {
    console.error("[ContractIngest] quarantine persist failed (message was already blocked):", (err as Error)?.message || err);
  }
}

function fireQuarantinePersist(source: IngestSource, subject: string, payload: unknown, errors: string[]): void {
  quarantineWriteChain = quarantineWriteChain.then(() => persistQuarantine(source, subject, payload, errors));
}

// ── the verdict core ─────────────────────────────────────────────────────────
export interface InboundVerdict {
  /** false ⇔ mode "quarantine" AND the message failed its contract → caller must NOT pipeline it. */
  ok: boolean;
  action: "skipped" | "pass" | "logged" | "quarantined";
  errors?: string[];
}

/** Shared invalid-message handling for mode log|quarantine. */
function applyInvalid(source: IngestSource, subject: string, payload: unknown, errors: string[]): InboundVerdict {
  const mode = ingestValidationMode();
  const c = countersFor(subject);
  c.invalid++;
  if (mode !== "quarantine") {
    console.warn(
      `[ContractIngest] ${source} message INVALID vs ${subject} (mode=log — NOT blocked): ${errors.slice(0, 5).join("; ")}`,
    );
    return { ok: true, action: "logged", errors };
  }
  c.quarantined++;
  fireQuarantinePersist(source, subject, payload, errors);
  return { ok: false, action: "quarantined", errors };
}

/**
 * Validate one inbound message (payload already parsed to a JS value) against the LATEST
 * registered schema for `subject`. Mode off → immediate skip (zero-cost). Subjects with no
 * registered schema stay open (validateMessage returns valid). NEVER throws.
 */
export function validateInbound(source: IngestSource, subject: string, payload: unknown): InboundVerdict {
  if (ingestValidationMode() === "off") return { ok: true, action: "skipped" };
  try {
    ensureCanonicalSeeded();
    ensureQuarantineRetentionTimer();
    const res = validateMessage(subject, payload);
    if (res.valid) {
      countersFor(subject).valid++;
      return { ok: true, action: "pass" };
    }
    return applyInvalid(source, subject, payload, res.errors ?? ["invalid"]);
  } catch (err) {
    // FAIL-SAFE: a bug in the validator machinery must never block production ingest.
    validatorErrors++;
    console.error("[ContractIngest] validator internal error — passing message through:", (err as Error)?.message || err);
    return { ok: true, action: "pass" };
  }
}

// ── mqtt seam helper ─────────────────────────────────────────────────────────
/**
 * Raw-frame entry for mqttService: maps topic → subject (non-contract topics skip), safely
 * parses Buffer/string JSON, then validates. A topic UNDER CONTRACT carrying non-JSON is
 * itself a contract violation (all canonical schemas are JSON objects) and is handled by
 * the same mode rules. NEVER throws.
 */
export function validateInboundMqtt(topic: string, payload: Buffer | string | unknown): InboundVerdict {
  if (ingestValidationMode() === "off") return { ok: true, action: "skipped" };
  try {
    const subject = topicToSubject(topic);
    if (!subject) return { ok: true, action: "skipped" };
    let raw: string | null = null;
    let parsed: unknown;
    try {
      raw = Buffer.isBuffer(payload) ? payload.toString("utf8") : typeof payload === "string" ? payload : null;
      parsed = raw === null ? payload : JSON.parse(raw);
    } catch {
      ensureCanonicalSeeded();
      ensureQuarantineRetentionTimer();
      return applyInvalid("mqtt", subject, { raw: raw ?? String(payload) }, ["payload is not valid JSON"]);
    }
    return validateInbound("mqtt", subject, parsed);
  } catch (err) {
    validatorErrors++;
    console.error("[ContractIngest] mqtt validation internal error — passing message through:", (err as Error)?.message || err);
    return { ok: true, action: "pass" };
  }
}

// ── telemetryBus seam helper ─────────────────────────────────────────────────
/** Structural mirror of telemetryBus.CanonicalSample (no runtime import → no cycle). */
interface TelemetrySampleLike {
  ts?: Date;
  machineId?: number | null;
  deviceId?: string | null;
  metric: string;
  value: number | string | boolean | null;
  unit?: string | null;
  quality?: string;
}

const CANONICAL_QUALITIES = new Set(["good", "uncertain", "bad"]);

/**
 * Re-shape ONE CanonicalSample into the canonical telemetry message (telemetry.schema.json:
 * asset_id/ts/metrics[]) so the SAME contract governs both seams. asset_id = deviceId, else
 * "machine:<id>" — a sample with neither is missing its asset identity and fails the
 * contract (that is the point). quality is only forwarded when it is a canonical value
 * (the internal enum is wider — e.g. "stale" — and must not cause false rejections).
 */
export function sampleToCanonicalTelemetry(s: TelemetrySampleLike): Record<string, unknown> {
  const assetId = s.deviceId ?? (s.machineId != null ? `machine:${s.machineId}` : undefined);
  return {
    ...(assetId !== undefined ? { asset_id: assetId } : {}),
    ts: (s.ts instanceof Date ? s.ts : new Date()).toISOString(),
    metrics: [
      {
        name: s.metric,
        value: s.value,
        ...(s.unit ? { unit: s.unit } : {}),
        ...(s.quality && CANONICAL_QUALITIES.has(s.quality) ? { quality: s.quality } : {}),
      },
    ],
  };
}

/**
 * Batch entry for telemetryBus.ingestTelemetry: mode off returns the SAME array reference
 * (zero-cost). Otherwise each sample is validated as a canonical telemetry message; in
 * quarantine mode invalid samples are dropped from the batch (each quarantined
 * individually), valid ones flow on. NEVER throws — any internal error returns the batch
 * unfiltered (fail-safe pass-through).
 */
export function filterTelemetrySamples<T extends TelemetrySampleLike>(samples: T[]): T[] {
  if (ingestValidationMode() === "off") return samples;
  try {
    const out: T[] = [];
    for (const s of samples) {
      const verdict = validateInbound("telemetry_bus", TELEMETRY_SUBJECT, sampleToCanonicalTelemetry(s));
      if (verdict.ok) out.push(s);
    }
    return out.length === samples.length ? samples : out;
  } catch (err) {
    validatorErrors++;
    console.error("[ContractIngest] telemetry filter internal error — batch passes unfiltered:", (err as Error)?.message || err);
    return samples;
  }
}

// ── retention sweep (contract_quarantine) ────────────────────────────────────
/** Retention window in days (default 30). <=0 disables the sweep entirely. */
export function quarantineRetentionDays(env: NodeJS.ProcessEnv = process.env): number {
  const n = parseInt(String(env.CONTRACT_QUARANTINE_RETENTION_DAYS ?? ""), 10);
  return Number.isFinite(n) ? n : 30;
}

function sweepIntervalMs(): number {
  const n = parseInt(String(process.env.CONTRACT_QUARANTINE_SWEEP_INTERVAL_MS ?? ""), 10);
  return Number.isFinite(n) && n >= 60_000 ? n : 6 * 60 * 60 * 1000; // default 6h, floor 1min
}

const SWEEP_BATCH = 5000;

/**
 * Delete quarantine rows older than the retention window, in bounded batches on the jobs
 * pool (mirrors dataRetentionService). Returns rows deleted; 0 on disabled/no-DB/error.
 */
export async function sweepQuarantineRetention(): Promise<number> {
  const days = quarantineRetentionDays();
  if (days <= 0) return 0;
  try {
    const { getJobsDb } = await import("../../db/connection");
    const db = await getJobsDb();
    if (!db) return 0;
    const { sql } = await import("drizzle-orm");
    let total = 0;
    for (let i = 0; i < 200; i++) {
      const deleted = (await db.execute(
        sql`DELETE FROM "contract_quarantine"
            WHERE ctid IN (
              SELECT ctid FROM "contract_quarantine"
              WHERE "received_at" < now() - make_interval(days => ${days})
              LIMIT ${SWEEP_BATCH}
            )
            RETURNING 1`,
      )) as unknown as Array<unknown>;
      const n = Array.isArray(deleted) ? deleted.length : 0;
      total += n;
      if (n < SWEEP_BATCH) break;
    }
    if (total > 0) console.log(`[ContractIngest] quarantine retention: deleted ${total} rows older than ${days}d`);
    return total;
  } catch (err) {
    console.error("[ContractIngest] quarantine retention sweep failed:", (err as Error)?.message || err);
    return 0;
  }
}

let retentionTimer: NodeJS.Timeout | null = null;

/** Start the sweep timer lazily (first non-off validation). Mode off never gets here. */
function ensureQuarantineRetentionTimer(): void {
  if (retentionTimer || quarantineRetentionDays() <= 0) return;
  retentionTimer = setInterval(() => void sweepQuarantineRetention(), sweepIntervalMs());
  retentionTimer.unref?.();
}

/** Stop the retention timer (tests / graceful shutdown). */
export function stopQuarantineRetention(): void {
  if (retentionTimer) {
    clearInterval(retentionTimer);
    retentionTimer = null;
  }
}

/** Test helper — reset seed flag, counters and timer (registry itself: _clearSchemaRegistry). */
export function _resetIngestValidation(): void {
  seeded = false;
  statsBySubject.clear();
  validatorErrors = 0;
  quarantineWriteChain = Promise.resolve();
  stopQuarantineRetention();
}
