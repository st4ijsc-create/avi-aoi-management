/**
 * S2b-2 (doc 20 §2/§5 / doc 16 §8) — READ-ONLY safety-PLC status adapter.
 *   Flag: SAFETY_PLC_ADAPTER_ENABLED (default OFF).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Certified safety controllers (Pilz PNOZmulti/PSS, Sick Flexi Soft) expose a
 * NON-safety-rated STATUS interface over Modbus-TCP / OPC-UA — e-stop state, zone
 * occupied, reset-required, muting. This adapter OBSERVES that status and maps each
 * observed flag → an ADVISORY safety_event (via safetyAuditService.record):
 *
 *   estop=true         → eventType 'estop'         (detectedBy 'plc'/'sim'*, logged_only)
 *   zoneOccupied=true  → eventType 'zone_intrusion'
 *   resetRequired=true → eventType 'intrusion'     (note: reset required)
 *   muting=true        → eventType 'speed_violation' (note: muting active)
 *
 *   (* safety_events.detectedBy carries the HONEST provenance: 'plc' for a real
 *      certified Safety PLC status read, 'sim' for the clearly-labelled sim backend
 *      (varchar, additive — no migration). The true source is ALSO restated in notes.)
 *
 * BACKENDS (honest):
 *   • 'sim' (default) — a SCRIPTED status stream (statusMap.simScript). Clearly a sim;
 *     used for testing until a real endpoint is configured. NEVER presented as a live
 *     PLC read.
 *   • 'modbus' / 'opcua' — a REAL read via the EXISTING OT driver (driverRegistry),
 *     reusing the same connect/readTags path OT already uses. Only the flagged status
 *     TAGS are read (bool). Nothing is ever WRITTEN.
 *
 * ⚠ CRITICAL HONESTY / SAFETY: READ-ONLY. This adapter NEVER actuates a rated stop.
 *   The certified Safety PLC performs the rated stop ITSELF in hardware (SIL 2/3,
 *   <100ms dual-channel); this software only OBSERVES that it happened and LOGS an
 *   advisory event. No write path exists here — we call the OT driver's readTags only,
 *   never writeTags. With the flag OFF everything is a no-op (enabled:false).
 * ════════════════════════════════════════════════════════════════════════════
 */
import { and, eq } from "drizzle-orm";
import { getDb } from "../../../db/connection";
import { safetyPlcConfigs, type SafetyPlcConfig, type SafetyPlcStatusSnapshot, type SafetyPlcStatusMap } from "../../../../drizzle/schema";
import { record } from "../safetyAuditService";
import type { SafetyEventType } from "../safetyAuditService";
import { createDriver } from "../../ot/driverRegistry";
import type { OtProtocol, OtTagAddress } from "../../ot/otDriver";

/** Flag — default OFF (mirrors safetyAuditEnabled / safetyZoneSwEnabled). */
export function safetyPlcAdapterEnabled(): boolean {
  return (
    process.env.SAFETY_PLC_ADAPTER_ENABLED === "true" || process.env.SAFETY_PLC_ADAPTER_ENABLED === "1"
  );
}

async function db() {
  const d = await getDb();
  if (!d) throw new Error("Database not connected");
  return d;
}

// ════════════════════════════════════════════════════════════════════════════
// STATUS → advisory-event mapping (PURE, exported for tests)
// ════════════════════════════════════════════════════════════════════════════

/** One advisory finding derived from a PLC status flag. */
export interface PlcAdvisoryFinding {
  flag: keyof SafetyPlcStatusSnapshot;
  eventType: SafetyEventType;
  note: string;
}

const FLAG_TO_EVENT: Record<keyof SafetyPlcStatusSnapshot, { eventType: SafetyEventType; note: string }> = {
  estop: {
    eventType: "estop",
    note: "ADVISORY: safety-PLC reports e-stop ACTIVE. The certified Safety PLC performs the rated stop in hardware; software only OBSERVED it (read-only, NOT actuated).",
  },
  zoneOccupied: {
    eventType: "zone_intrusion",
    note: "ADVISORY: safety-PLC reports a protected zone OCCUPIED (read-only monitoring).",
  },
  resetRequired: {
    eventType: "intrusion",
    note: "ADVISORY: safety-PLC reports RESET REQUIRED — a safety function tripped and awaits manual reset (read-only).",
  },
  muting: {
    eventType: "speed_violation",
    note: "ADVISORY: safety-PLC reports MUTING active — a protective function is temporarily bypassed (read-only, verify on the floor).",
  },
};

/**
 * PURE — map an observed status snapshot to the set of ADVISORY findings (one per
 * ACTIVE flag). Absent/false flags produce nothing. Deterministic; no I/O.
 */
export function statusToFindings(status: SafetyPlcStatusSnapshot): PlcAdvisoryFinding[] {
  const out: PlcAdvisoryFinding[] = [];
  (Object.keys(FLAG_TO_EVENT) as Array<keyof SafetyPlcStatusSnapshot>).forEach((flag) => {
    if (status[flag] === true) {
      const m = FLAG_TO_EVENT[flag];
      out.push({ flag, eventType: m.eventType, note: m.note });
    }
  });
  return out;
}

// ════════════════════════════════════════════════════════════════════════════
// BACKENDS — sim (scripted) + real (OT driver read)
// ════════════════════════════════════════════════════════════════════════════

/** A pluggable status source. Returns the CURRENT observed status snapshot. */
export interface SafetyPlcBackendReader {
  readonly kind: "sim" | "modbus" | "opcua";
  /** Read one status snapshot. Real backends open/read/close via the OT driver. */
  read(): Promise<SafetyPlcStatusSnapshot>;
  /** Human-readable label — always states whether this is sim or a real endpoint. */
  label(): string;
}

/**
 * SIM backend — cycles through a scripted sequence of status snapshots. If no script
 * is provided, it returns an all-clear snapshot (never fabricates an active fault).
 * Clearly labelled as a sim; the calling adapter tags advisory events accordingly.
 */
export class SimSafetyPlcBackend implements SafetyPlcBackendReader {
  readonly kind = "sim" as const;
  private idx = 0;
  constructor(private readonly script: SafetyPlcStatusSnapshot[] = []) {}
  async read(): Promise<SafetyPlcStatusSnapshot> {
    if (this.script.length === 0) return {}; // all-clear; never invent a fault
    const snap = this.script[this.idx % this.script.length];
    this.idx += 1;
    return { ...snap };
  }
  label(): string {
    return `sim (scripted, ${this.script.length} step${this.script.length === 1 ? "" : "s"}) — NOT a live PLC`;
  }
}

/**
 * REAL backend — reads live status via the EXISTING OT driver (Modbus/OPC-UA). Only
 * the mapped status TAGS are read (bool). READ-ONLY: never calls writeTags. Connect →
 * readTags → disconnect per read (matches the OT facade's testConnection pattern);
 * unreachable endpoint → throws (the adapter logs it honestly; never fabricates).
 */
export class OtReadSafetyPlcBackend implements SafetyPlcBackendReader {
  readonly kind: "modbus" | "opcua";
  constructor(
    kind: "modbus" | "opcua",
    private readonly endpoint: string,
    private readonly statusMap: SafetyPlcStatusMap,
    private readonly timeoutMs = 5000,
  ) {
    this.kind = kind;
  }

  /** Build the (flag → OT tag) read list from the statusMap. */
  private tagList(): Array<{ flag: keyof SafetyPlcStatusSnapshot; tag: OtTagAddress }> {
    const flags: Array<keyof SafetyPlcStatusSnapshot> = ["estop", "zoneOccupied", "resetRequired", "muting"];
    const out: Array<{ flag: keyof SafetyPlcStatusSnapshot; tag: OtTagAddress }> = [];
    for (const flag of flags) {
      const ref = this.statusMap[flag];
      if (ref?.address) {
        out.push({
          flag,
          tag: {
            tagKey: flag,
            address: ref.address,
            dataType: ref.dataType ?? "bool",
          },
        });
      }
    }
    return out;
  }

  async read(): Promise<SafetyPlcStatusSnapshot> {
    const tags = this.tagList();
    if (tags.length === 0) return {}; // nothing mapped → nothing to observe
    const driver = createDriver(this.kind as OtProtocol);
    await driver.connect({ endpoint: this.endpoint, timeoutMs: this.timeoutMs });
    try {
      const samples = await driver.readTags(tags.map((t) => t.tag));
      const byKey = new Map(samples.map((s) => [s.tagKey, s]));
      const snap: SafetyPlcStatusSnapshot = {};
      for (const { flag } of tags) {
        const s = byKey.get(flag);
        if (!s || s.quality !== "good") continue; // bad quality → leave unknown (honest)
        const ref = this.statusMap[flag];
        const truthy = coerceBool(s.value);
        snap[flag] = ref?.activeWhen === "falsy" ? !truthy : truthy;
      }
      return snap;
    } finally {
      await driver.disconnect().catch(() => undefined);
    }
  }

  label(): string {
    return `real ${this.kind} read @ ${this.endpoint} (READ-ONLY)`;
  }
}

function coerceBool(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") return v === "1" || v.toLowerCase() === "true";
  return false;
}

/** Build the backend reader for a config (sim by default). */
export function backendForConfig(cfg: SafetyPlcConfig): SafetyPlcBackendReader {
  const map = (cfg.statusMap ?? {}) as SafetyPlcStatusMap;
  if (cfg.backend === "modbus" || cfg.backend === "opcua") {
    if (!cfg.endpoint) {
      // Honest fallback: a real backend without an endpoint cannot read → sim (empty).
      return new SimSafetyPlcBackend([]);
    }
    return new OtReadSafetyPlcBackend(cfg.backend, cfg.endpoint, map);
  }
  return new SimSafetyPlcBackend(map.simScript ?? []);
}

// ════════════════════════════════════════════════════════════════════════════
// CONFIG CRUD (flag-gated mutations; reads always allowed)
// ════════════════════════════════════════════════════════════════════════════

export interface PlcConfigFilter {
  robotId?: number;
  stationId?: number;
  lineId?: number;
  onlyEnabled?: boolean;
}

/** List safety-PLC configs (read — always allowed). */
export async function listPlcConfigs(filter: PlcConfigFilter = {}): Promise<SafetyPlcConfig[]> {
  const d = await db();
  const conds = [];
  if (filter.robotId != null) conds.push(eq(safetyPlcConfigs.robotId, filter.robotId));
  if (filter.stationId != null) conds.push(eq(safetyPlcConfigs.stationId, filter.stationId));
  if (filter.lineId != null) conds.push(eq(safetyPlcConfigs.lineId, filter.lineId));
  if (filter.onlyEnabled) conds.push(eq(safetyPlcConfigs.enabled, true));
  return d
    .select()
    .from(safetyPlcConfigs)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(safetyPlcConfigs.id);
}

export interface UpsertPlcConfigInput {
  id?: number;
  code: string;
  name: string;
  vendor?: "pilz" | "sick" | "generic";
  backend?: "sim" | "modbus" | "opcua";
  endpoint?: string | null;
  statusMap?: SafetyPlcStatusMap | null;
  robotId?: number | null;
  stationId?: number | null;
  lineId?: number | null;
  enabled?: boolean;
  notes?: string | null;
  scope?: string | null;
  corporateCode?: string | null;
  factoryId?: number | null;
}

export interface PlcConfigWriteResult {
  ok: boolean;
  enabled: boolean;
  config?: SafetyPlcConfig;
  message?: string;
}

/** Create or update a safety-PLC config (flag-gated). */
export async function upsertPlcConfig(input: UpsertPlcConfigInput): Promise<PlcConfigWriteResult> {
  if (!safetyPlcAdapterEnabled()) return { ok: false, enabled: false, message: "SAFETY_PLC_ADAPTER_ENABLED off" };
  const d = await db();
  const values = {
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
  if (input.id != null) {
    const [config] = await d
      .update(safetyPlcConfigs)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(safetyPlcConfigs.id, input.id))
      .returning();
    if (!config) return { ok: false, enabled: true, message: `safety-PLC config ${input.id} not found` };
    return { ok: true, enabled: true, config };
  }
  const [config] = await d.insert(safetyPlcConfigs).values(values).returning();
  return { ok: true, enabled: true, config };
}

// ════════════════════════════════════════════════════════════════════════════
// READ + WIRE INTO S1 ADVISORY
// ════════════════════════════════════════════════════════════════════════════

export interface PlcReadResult {
  enabled: boolean;
  /** The backend used — always names sim vs real endpoint (honesty). */
  backend: string;
  /** The observed status snapshot (empty when all-clear / unreachable/unknown). */
  status: SafetyPlcStatusSnapshot;
  /** The advisory findings derived from the status (one per active flag). */
  findings: Array<PlcAdvisoryFinding & { safetyEventId?: number }>;
  recorded: number;
  message?: string;
}

/**
 * Read one status snapshot from a config's backend and WIRE each active flag into S1 as
 * an ADVISORY safety_event. READ-ONLY throughout — never actuates. No-op (enabled:false)
 * unless SAFETY_PLC_ADAPTER_ENABLED. Advisory events only PERSIST when SAFETY_AUDIT is
 * also on (record() self-gates); findings are still returned (advisory read).
 *
 * `override` lets a test/caller inject a backend reader (e.g. a scripted sim) directly.
 */
export async function readAndRecord(
  cfg: SafetyPlcConfig,
  override?: SafetyPlcBackendReader,
): Promise<PlcReadResult> {
  if (!safetyPlcAdapterEnabled()) {
    return { enabled: false, backend: "off", status: {}, findings: [], recorded: 0, message: "SAFETY_PLC_ADAPTER_ENABLED off" };
  }
  const backend = override ?? backendForConfig(cfg);
  let status: SafetyPlcStatusSnapshot;
  try {
    status = await backend.read();
  } catch (err) {
    // Honest: unreachable/failed read → report the error, fabricate NOTHING.
    return {
      enabled: true,
      backend: backend.label(),
      status: {},
      findings: [],
      recorded: 0,
      message: `read failed: ${(err as Error)?.message ?? String(err)}`,
    };
  }

  const findings = statusToFindings(status);
  const out: Array<PlcAdvisoryFinding & { safetyEventId?: number }> = [];
  let recorded = 0;
  const source = backend.kind === "sim" ? "sim" : "plc";

  for (const f of findings) {
    const res = await record({
      eventType: f.eventType,
      robotId: cfg.robotId ?? null,
      stationId: cfg.stationId ?? null,
      lineId: cfg.lineId ?? null,
      // Honest provenance: 'plc' when we READ a real certified Safety PLC's status,
      // 'sim' for the clearly-labelled scripted sim backend. (The true source is ALSO
      // restated in the notes.) Still READ-ONLY — the PLC performs the rated stop itself.
      detectedBy: source,
      handledBy: "advisory",
      outcome: "logged_only",
      humanPosition: { plcFlag: f.flag, backend: backend.kind, source },
      notes: `${f.note} [source ${source}, PLC "${cfg.code}", backend ${backend.label()}]`,
      scope: cfg.scope ?? null,
      corporateCode: cfg.corporateCode ?? null,
      factoryId: cfg.factoryId ?? null,
    });
    const rec: PlcAdvisoryFinding & { safetyEventId?: number } = { ...f };
    if (res.ok && res.event) {
      rec.safetyEventId = res.event.id;
      recorded += 1;
    }
    out.push(rec);
  }

  return { enabled: true, backend: backend.label(), status, findings: out, recorded };
}

/** Read + record for a config id (loads the config, then readAndRecord). */
export async function readConfigById(id: number, override?: SafetyPlcBackendReader): Promise<PlcReadResult> {
  if (!safetyPlcAdapterEnabled()) {
    return { enabled: false, backend: "off", status: {}, findings: [], recorded: 0, message: "SAFETY_PLC_ADAPTER_ENABLED off" };
  }
  const d = await db();
  const [cfg] = await d.select().from(safetyPlcConfigs).where(eq(safetyPlcConfigs.id, id)).limit(1);
  if (!cfg) return { enabled: true, backend: "none", status: {}, findings: [], recorded: 0, message: `safety-PLC config ${id} not found` };
  return readAndRecord(cfg, override);
}
