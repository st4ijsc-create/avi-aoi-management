/**
 * SECS/GEM Connectivity FRAMEWORK — GEM equipment model (SEMI E30).
 *
 * ── HONESTY / SCOPE ──────────────────────────────────────────────────────────
 * This is the GEM DATA MODEL + the event→platform mapping, NOT a compliant GEM
 * implementation. It models Control State, Communication State, and the GEM
 * registries (Collection Events, Status Variables, Equipment Constants, Alarms),
 * and provides PURE mappers that turn inbound SECS-II messages into rows for the
 * platform's EXISTING tables — reusing schema, NO migration:
 *   - S6F11 Event Report  → a `process_results` row (a GEM collection event is
 *                            recorded as a process/event result by machineCode),
 *   - S5F1  Alarm Report   → an Andon-style alarm record (raiseAndon input shape),
 *   - SV poll / S6F1 trace → an `ot_telemetry` row per status variable.
 * The platform machine is resolved by a CONFIGURED `machineCode`.
 *
 * The mappers are PURE (no DB I/O) so they are unit-testable; the router/service
 * layer performs the actual inserts. A real GEM bring-up still requires dynamic
 * event/report definition (S2F33/F35/F37), the full control-state transition
 * model, spooling, and equipment-constant negotiation — all out of scope here.
 */
import type { SecsMessage, SecsItem } from "./secsMessages";
import type { InsertProcessResult } from "../../../drizzle/schema";
import type { InsertOtTelemetry } from "../../../drizzle/schema";

// ─── GEM state models (SEMI E30) ─────────────────────────────────────────────

/** GEM Communication State. */
export type GemCommState = "DISABLED" | "ENABLED_NOT_COMMUNICATING" | "ENABLED_COMMUNICATING";

/** GEM Control State (Online sub-states Local/Remote; plus Offline). */
export type GemControlState = "OFFLINE" | "ONLINE_LOCAL" | "ONLINE_REMOTE";

/** A GEM Collection Event definition (CEID → name + linked report ids). */
export interface CollectionEvent {
  ceid: number;
  name: string;
  reportIds?: number[];
}

/** A GEM Status Variable definition (SVID → name + the telemetry tag key it maps to). */
export interface StatusVariable {
  svid: number;
  name: string;
  /** Telemetry tagKey used when an SV value is ingested into ot_telemetry. */
  tagKey: string;
  unit?: string;
}

/** A GEM Equipment Constant definition (ECID → name + value). */
export interface EquipmentConstant {
  ecid: number;
  name: string;
  value?: number | string;
}

/** A GEM Alarm definition (ALID → name + the Andon reason it maps to). */
export interface AlarmDef {
  alid: number;
  name: string;
  /** Andon reason category for the mapped alarm record. */
  reason?: "quality" | "material" | "maintenance" | "safety" | "setup" | "other";
}

/**
 * The configured GEM equipment model bound to ONE platform machine by code.
 * Registries are simple maps keyed by their numeric id.
 */
export interface GemConfig {
  /** Platform machine code this equipment maps to (resolves machineId at runtime). */
  machineCode: string;
  modelName: string;
  softRev: string;
  collectionEvents?: CollectionEvent[];
  statusVariables?: StatusVariable[];
  equipmentConstants?: EquipmentConstant[];
  alarms?: AlarmDef[];
}

/** Live GEM model state + registries for a configured equipment. */
export class GemModel {
  commState: GemCommState = "DISABLED";
  controlState: GemControlState = "OFFLINE";

  readonly collectionEvents = new Map<number, CollectionEvent>();
  readonly statusVariables = new Map<number, StatusVariable>();
  readonly equipmentConstants = new Map<number, EquipmentConstant>();
  readonly alarms = new Map<number, AlarmDef>();

  constructor(readonly config: GemConfig) {
    for (const ce of config.collectionEvents ?? []) this.collectionEvents.set(ce.ceid, ce);
    for (const sv of config.statusVariables ?? []) this.statusVariables.set(sv.svid, sv);
    for (const ec of config.equipmentConstants ?? []) this.equipmentConstants.set(ec.ecid, ec);
    for (const al of config.alarms ?? []) this.alarms.set(al.alid, al);
  }

  /** Communication state transition on a successful establish-comms (S1F13/F14). */
  onCommunicationsEstablished(): void {
    this.commState = "ENABLED_COMMUNICATING";
  }

  /** Control state transition (host S2F41 ONLINE/OFFLINE etc.). MODEL ONLY. */
  setControlState(s: GemControlState): void {
    this.controlState = s;
  }
}

// ─── SECS-II item helpers (read scalars out of the skeleton item tree) ────────

function firstUint(item: SecsItem | undefined): number | undefined {
  if (!item) return undefined;
  if (item.format === "U1" || item.format === "U2" || item.format === "U4") return item.value[0];
  if (item.format === "BINARY") return item.value[0];
  return undefined;
}

function asAscii(item: SecsItem | undefined): string | undefined {
  return item && item.format === "A" ? item.value : undefined;
}

/** Flatten a SECS-II item's leaf scalar to a JS primitive (for metrics/telemetry). */
function leafValue(item: SecsItem): number | string | boolean | null {
  switch (item.format) {
    case "A":
      return item.value;
    case "BOOLEAN":
      return item.value[0] ?? false;
    case "BINARY":
    case "U1":
    case "U2":
    case "U4":
      return item.value[0] ?? null;
    case "L":
      return null;
  }
}

// ─── Mappers: GEM message → platform row (PURE, no I/O) ───────────────────────

/** The Andon-style alarm record this framework emits for S5F1 (mirrors raiseAndon input). */
export interface GemAlarmRecord {
  machineCode: string;
  machineId: number | null;
  state: "red" | "yellow";
  reason: "quality" | "material" | "maintenance" | "safety" | "setup" | "other";
  title: string;
  message: string;
  /** GEM alarm id (ALID). */
  alid: number;
  /** true = alarm SET, false = alarm CLEARED. */
  set: boolean;
  raisedBySystem: true;
}

/**
 * Map S6F11 Event Report → a process_results row.
 *
 * A GEM collection event becomes a process/event result keyed by machine. The
 * CEID + report values are stored in `metrics` (jsonb) so nothing is lost; the
 * row's `result` defaults to "skip" (event, not a pass/fail measurement) unless
 * a value named like result/pass/fail is found in the report.
 */
export function mapEventReportToProcessResult(
  msg: SecsMessage,
  machineId: number,
  ctx: { serialNumber?: string; stepType?: string; lineCode?: string; measuredAt?: Date } = {},
): InsertProcessResult {
  const body = msg.body;
  const top = body.format === "L" ? body.value : [];
  const ceid = firstUint(top[1]) ?? 0; // L[ DATAID, CEID, reports ]
  const ce = undefined as CollectionEvent | undefined;

  // Flatten report values into a metrics object.
  const metrics: Record<string, number | string | boolean> = { ceid };
  const reportsList = top[2];
  if (reportsList && reportsList.format === "L") {
    reportsList.value.forEach((rep, ri) => {
      if (rep.format !== "L") return;
      const rptId = firstUint(rep.value[0]);
      const values = rep.value[1];
      if (values && values.format === "L") {
        values.value.forEach((v, vi) => {
          const lv = leafValue(v);
          if (lv != null) metrics[`r${rptId ?? ri}_v${vi}`] = lv;
        });
      }
    });
  }

  return {
    serialNumber: ctx.serialNumber ?? `CEID-${ceid}`,
    machineId,
    stepType: ctx.stepType ?? "gem-event",
    lineCode: ctx.lineCode,
    result: "skip",
    metrics,
    measuredAt: ctx.measuredAt ?? new Date(),
  };
}

/**
 * Map S5F1 Alarm Report → an Andon-style alarm record.
 * Body: L[ ALCD(BINARY: bit7=set), ALID(U4), ALTX(A) ].
 */
export function mapAlarmToAndon(
  msg: SecsMessage,
  machineCode: string,
  machineId: number | null,
  alarmDef?: AlarmDef,
): GemAlarmRecord {
  const top = msg.body.format === "L" ? msg.body.value : [];
  const alcd = firstUint(top[0]) ?? 0;
  const set = (alcd & 0x80) !== 0;
  const alid = firstUint(top[1]) ?? 0;
  const altx = asAscii(top[2]) ?? alarmDef?.name ?? `Alarm ${alid}`;
  const reason = alarmDef?.reason ?? "maintenance";

  return {
    machineCode,
    machineId,
    state: set ? "red" : "yellow",
    reason,
    title: `GEM alarm ${alid}: ${altx}`.slice(0, 255),
    message: set ? `Equipment alarm SET (ALID=${alid}): ${altx}` : `Equipment alarm CLEARED (ALID=${alid}): ${altx}`,
    alid,
    set,
    raisedBySystem: true,
  };
}

/**
 * Map a status-variable poll (or an S6F1 trace value) → ot_telemetry rows.
 * Each SVID with a known StatusVariable mapping becomes one telemetry row using
 * the SV's tagKey. `adapterId` is the synthetic SECS adapter id for this machine.
 */
export function mapStatusVariablesToTelemetry(
  samples: Array<{ svid: number; value: number | string | boolean | null }>,
  model: GemModel,
  adapterId: number,
  machineId: number | null,
  at: Date = new Date(),
): InsertOtTelemetry[] {
  const rows: InsertOtTelemetry[] = [];
  for (const s of samples) {
    const sv = model.statusVariables.get(s.svid);
    const tagKey = sv?.tagKey ?? `SVID_${s.svid}`;
    const row: InsertOtTelemetry = {
      adapterId,
      machineId: machineId ?? undefined,
      tagKey,
      valueNumeric: null,
      valueText: null,
      quality: "good",
      timestamp: at,
    };
    const v = s.value;
    if (typeof v === "number" && Number.isFinite(v)) row.valueNumeric = String(v);
    else if (typeof v === "boolean") row.valueText = v ? "true" : "false";
    else if (typeof v === "string") row.valueText = v.length > 500 ? v.slice(0, 500) : v;
    rows.push(row);
  }
  return rows;
}
