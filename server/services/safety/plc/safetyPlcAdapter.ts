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
import { DbUnavailableError } from "../../../_core/dbErrors";
import { getDb } from "../../../db/connection";
import { safetyPlcConfigs, type SafetyPlcConfig, type SafetyPlcStatusSnapshot, type SafetyPlcStatusMap } from "../../../../drizzle/schema";
import { record } from "../safetyAuditService";
import type { SafetyEventType } from "../safetyAuditService";
import { createDriver } from "../../ot/driverRegistry";
import type { OtProtocol, OtTagAddress } from "../../ot/otDriver";
import { redactEndpoint, safeBackendLabel } from "./plcRedact";

/** Flag — default OFF (mirrors safetyAuditEnabled / safetyZoneSwEnabled). */
export function safetyPlcAdapterEnabled(): boolean {
  return (
    process.env.SAFETY_PLC_ADAPTER_ENABLED === "true" || process.env.SAFETY_PLC_ADAPTER_ENABLED === "1"
  );
}

async function db() {
  const d = await getDb();
  if (!d) throw new DbUnavailableError();
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

/** doc 81 Đợt 1C Task 1 — a status read that also names the mapped flags it could NOT observe. */
export interface SafetyPlcCheckedRead {
  status: SafetyPlcStatusSnapshot;
  /** Mapped safety flags whose tag came back missing or with quality ≠ "good" (unknown, not clear). */
  unreadable: Array<keyof SafetyPlcStatusSnapshot>;
  /**
   * doc 81 Đợt 9 U2 — ONLY when asked (`readChecked({ withLatch: true })`, the background poller) and the config maps an
   * e-stop latch tag: its decided value, or `unreadable`. The actuation preflight never asks (it judges the live tags).
   */
  latch?: { estopLatch?: boolean; unreadable: boolean };
  /**
   * doc 81 Đợt 9 U fix 1 (I4) — ONLY when asked (`withHeartbeat`) and mapped: the heartbeat tag's raw value, or unreadable.
   * `changes` (subscription backend only): how many changes were observed since the previous batch (a toggle that flips
   * an even number of times between two polls still counts as alive).
   */
  heartbeat?: { value?: number | string | boolean; unreadable: boolean; changes?: number };
}

/** A pluggable status source. Returns the CURRENT observed status snapshot. */
export interface SafetyPlcBackendReader {
  readonly kind: "sim" | "modbus" | "opcua";
  /** Read one status snapshot. Real backends open/read/close via the OT driver. */
  read(): Promise<SafetyPlcStatusSnapshot>;
  /**
   * doc 81 Đợt 1C Task 1 — real backends only: the snapshot plus the mapped flags whose tag could
   * not be read with good quality. The real-actuation preflight REQUIRES it for a `real` config
   * (absent ⇒ that config cannot vouch "clean").
   */
  readChecked?(opts?: { withLatch?: boolean; withHeartbeat?: boolean; timeoutMs?: number }): Promise<SafetyPlcCheckedRead>;
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
    protected readonly endpoint: string,
    protected readonly statusMap: SafetyPlcStatusMap,
    protected readonly timeoutMs = 5000,
  ) {
    this.kind = kind;
  }

  /** Build the (flag → OT tag) read list from the statusMap. */
  protected tagList(): Array<{ flag: keyof SafetyPlcStatusSnapshot; tag: OtTagAddress }> {
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
    return (await this.readChecked()).status;
  }

  /**
   * doc 81 Đợt 1C Task 1 — the same single read as `read()`, plus WHICH mapped safety flags could
   * not be observed (sample missing or quality ≠ "good"). `read()` keeps leaving those flags unset
   * (advisory path unchanged); the real-actuation preflight uses `unreadable` so a bad-quality
   * safety tag makes this config UNKNOWN instead of "clean" (it used to count as OK).
   */
  /** doc 81 Đợt 9 U2 — the e-stop latch tag (READ only), when the config maps one. */
  protected latchTag(): OtTagAddress | null {
    const ref = this.statusMap.estopLatch;
    return ref?.address ? { tagKey: "estopLatch", address: ref.address, dataType: ref.dataType ?? "bool" } : null;
  }

  /** doc 81 Đợt 9 U fix 1 (I4) — the PLC heartbeat tag (READ only), when the config maps one. */
  protected heartbeatTag(): OtTagAddress | null {
    const ref = this.statusMap.heartbeat;
    return ref?.address ? { tagKey: "heartbeat", address: ref.address, dataType: ref.dataType ?? "int" } : null;
  }

  /** `timeoutMs` (U fix 1, M1): a caller with a smaller budget bounds the connect with it. */
  async readChecked(opts: { withLatch?: boolean; withHeartbeat?: boolean; timeoutMs?: number } = {}): Promise<SafetyPlcCheckedRead> {
    const tags = this.tagList();
    const latch = opts.withLatch ? this.latchTag() : null;
    const hb = opts.withHeartbeat ? this.heartbeatTag() : null;
    if (tags.length === 0 && !latch && !hb) return { status: {}, unreadable: [] }; // nothing mapped → nothing to observe
    const driver = createDriver(this.kind as OtProtocol);
    await driver.connect({ endpoint: this.endpoint, timeoutMs: opts.timeoutMs ?? this.timeoutMs });
    try {
      const samples = await driver.readTags([...tags.map((t) => t.tag), ...(latch ? [latch] : []), ...(hb ? [hb] : [])]);
      const byKey = new Map(samples.map((s) => [s.tagKey, s]));
      const snap: SafetyPlcStatusSnapshot = {};
      const unreadable: Array<keyof SafetyPlcStatusSnapshot> = [];
      for (const { flag } of tags) {
        const s = byKey.get(flag);
        if (!s || s.quality !== "good") {
          unreadable.push(flag); // bad quality → leave unknown (honest), and SAY it is unknown
          continue;
        }
        const ref = this.statusMap[flag];
        const truthy = strictBool(s.value);
        if (truthy === undefined) {
          // doc 81 Đợt 8 N3 — an unparseable value ("abc", NaN, an object, "") is UNKNOWN, never "clear" (it used to
          // coerce to false ⇒ a false "released" / a "clean" preflight). Fail toward unknown.
          unreadable.push(flag);
          continue;
        }
        snap[flag] = ref?.activeWhen === "falsy" ? !truthy : truthy;
      }
      const out: SafetyPlcCheckedRead = { status: snap, unreadable };
      if (latch) out.latch = decideLatch(this.statusMap, byKey.get("estopLatch"));
      if (hb) out.heartbeat = decideHeartbeat(byKey.get("heartbeat"));
      return out;
    } finally {
      await driver.disconnect().catch(() => undefined);
    }
  }

  label(): string {
    return `real ${this.kind} read @ ${this.endpoint} (READ-ONLY)`;
  }
}

/**
 * doc 81 Đợt 9 U2 — the e-stop latch from its sample: missing / bad quality / unparseable ⇒ UNREADABLE (never "not latched").
 */
export function decideLatch(map: SafetyPlcStatusMap, s: { quality?: string; value?: unknown } | undefined): { estopLatch?: boolean; unreadable: boolean } {
  if (!s || s.quality !== "good") return { unreadable: true };
  const v = strictBool(s.value);
  if (v === undefined) return { unreadable: true };
  return { estopLatch: map.estopLatch?.activeWhen === "falsy" ? !v : v, unreadable: false };
}

/** doc 81 Đợt 9 U fix 1 (I4) — a heartbeat sample: a good, finite number / boolean / non-empty string, else UNREADABLE. */
export function decideHeartbeat(s: { quality?: string; value?: unknown } | undefined): { value?: number | string | boolean; unreadable: boolean } {
  if (!s || s.quality !== "good") return { unreadable: true };
  const v = s.value;
  if ((typeof v === "number" && Number.isFinite(v)) || typeof v === "boolean" || (typeof v === "string" && v.length > 0)) return { value: v, unreadable: false };
  return { unreadable: true };
}

/**
 * doc 81 Đợt 8 N3 — a status value as a boolean, or undefined when it cannot be decided: booleans; finite numbers (≠ 0 ⇒
 * true); the strings "1"/"0"/"true"/"false" (any case, trimmed). Anything else (NaN, "abc", "", null, objects) ⇒ undefined.
 */
export function strictBool(v: unknown): boolean | undefined {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return Number.isFinite(v) ? v !== 0 : undefined;
  if (typeof v === "string") {
    const t = v.trim().toLowerCase();
    if (t === "1" || t === "true") return true;
    if (t === "0" || t === "false") return false;
  }
  return undefined;
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

/**
 * doc 81 Đợt 8 final wave N-R7 — the legacy UNAUDITED upsert writer of this module was REMOVED (it had no production caller): every
 * config write goes through safetyPlcTrust.savePlcConfig (audited, scope-checked, clears the maker-checker approval). The
 * input type above stays (savePlcConfig takes it).
 */

/** final wave N-R6 — ONE enabled config by id (the poller's record-time attribution lookup); null = missing / disabled. */
export async function loadEnabledPlcConfig(id: number): Promise<SafetyPlcConfig | null> {
  const d = await db();
  const [cfg] = await d.select().from(safetyPlcConfigs).where(and(eq(safetyPlcConfigs.id, id), eq(safetyPlcConfigs.enabled, true))).limit(1);
  return cfg ?? null;
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
      // doc 81 Đợt 8 N fix 1 (M3) — never the endpoint in the answer (label without endpoint, redacted error text)
      backend: safeBackendLabel(backend),
      status: {},
      findings: [],
      recorded: 0,
      message: `read failed: ${redactEndpoint(String((err as Error)?.message ?? err).slice(0, 300), cfg.endpoint)}`,
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
      notes: `${f.note} [source ${source}, PLC "${cfg.code}", backend ${safeBackendLabel(backend)}]`, // N fix 1 (M3): no endpoint
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

  return { enabled: true, backend: safeBackendLabel(backend), status, findings: out, recorded };
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
