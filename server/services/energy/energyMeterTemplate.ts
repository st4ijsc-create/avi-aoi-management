/**
 * doc 40 W5 (MTX-09) — ENERGY-METER Modbus register templates (ISO-50001 device coverage).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * A DATA-ONLY register map for common power/energy meters, expressed as the platform's
 * `OtTagAddress[]` so a meter is polled by the EXISTING Modbus OT driver
 * (server/services/ot/drivers/modbusDriver.ts) — NO new driver, NO new dependency.
 *
 * The `tagKey` of every register is DELIBERATELY one of the energy metric names the
 * telemetry→energy auto-ingest tap whitelists (see telemetryBus.ts
 * ENERGY_METRIC_COLUMN: energy_kwh / power_kw / power_factor / reactive_power_kvar /
 * apparent_power_kva). So the wiring is:
 *
 *   device_adapters(protocol='modbus') ──poll──▶ modbusDriver.readTags(template tags)
 *        ──emit OtSample(tagKey)──▶ ot_telemetry(metric = tagKey)
 *        ──[flag ENERGY_INGEST_FROM_TELEMETRY, Wave 3B]──▶ energy_readings(power_kw/…)
 *
 * i.e. registering a meter with one of these templates is enough for its power/energy
 * to land in `energy_readings` once the ingest flag is on — no bespoke reader.
 *
 * ⚠️⚠️ HONESTY CAVEAT — VALIDATE AGAINST THE VENDOR REGISTER LIST ⚠️⚠️
 *   Register addresses/scales below are PLAUSIBLE values assembled WITHOUT the
 *   proprietary per-model Modbus register-list documents. They MUST be verified
 *   against the actual meter's published map before trusting the readings on real
 *   hardware — hence `validationStatus: "assumed"`. They are collected in one editable
 *   table so a real deployment fixes them in a single place. Also: `OtTagAddress` cannot
 *   carry Modbus word-order, so these templates assume the driver default BIG word order
 *   (ABCD); a word-swapped (CDAB) meter needs a driver-level word-order option (seam).
 * ════════════════════════════════════════════════════════════════════════════
 */
import type { OtTagAddress, OtDataType } from "../ot/otDriver";

/**
 * The energy metric names the telemetry→energy tap recognises (MIRROR of the
 * whitelist keys in telemetryBus.ts ENERGY_METRIC_COLUMN). A template register whose
 * `metric` is in this set will auto-mirror into energy_readings; other registers
 * (voltage/current/frequency) are still valid telemetry but are NOT energy-mirrored.
 */
export const ENERGY_INGEST_METRICS = [
  "energy_kwh",
  "active_energy_kwh",
  "power_kw",
  "active_power_kw",
  "power_factor",
  "reactive_power_kvar",
  "apparent_power_kva",
] as const;

export type EnergyIngestMetric = (typeof ENERGY_INGEST_METRICS)[number];

/** True if a register's metric auto-mirrors into energy_readings (Wave 3B tap). */
export function isEnergyIngestMetric(metric: string): boolean {
  return (ENERGY_INGEST_METRICS as readonly string[]).includes(metric);
}

/** How well the register map is validated against the vendor document. */
export type EnergyTemplateValidation = "spec-verified" | "assumed";

/** ONE meter register mapped to a canonical metric. `metric` becomes the tag key. */
export interface EnergyRegister {
  /** Canonical metric (== OtTagAddress.tagKey → ot_telemetry.metric). */
  metric: string;
  /** Modbus address in the platform convention (e.g. "4x:3060" = holding reg 3060). */
  address: string;
  /** float = 32-bit (2 words); int = 16-bit (1 word, use `scale`). */
  dataType: OtDataType;
  /** Multiply raw by `scale` to get engineering units (default 1). */
  scale?: number;
  /** Engineering unit (kW / kWh / "" for PF / …). */
  unit: string;
  /** Human label for UI. */
  label: string;
}

/** A named meter template: connection defaults + register map. */
export interface EnergyMeterTemplate {
  /** Stable template id (used to attach to a device_adapter). */
  id: string;
  vendor: string;
  model: string;
  /** Honest validation status of the register map. */
  validationStatus: EnergyTemplateValidation;
  /** Default Modbus TCP port (502) and slave/unit id. */
  defaultPort: number;
  defaultUnitId: number;
  registers: EnergyRegister[];
  /** Free-form note (e.g. link to the register-list doc to verify against). */
  note?: string;
}

// ── Templates (ASSUMED maps — verify against vendor register lists) ──────────────

/**
 * Schneider Electric PM5000-series (PM5100/5300/5500). The PM5000 exposes a block of
 * IEEE-754 float32 measurements in the 3000-range holding registers. Addresses below
 * follow the PM5000 float map (assumed — confirm in the PM5000 Modbus register list).
 */
const SCHNEIDER_PM5000: EnergyMeterTemplate = {
  id: "schneider-pm5000",
  vendor: "Schneider Electric",
  model: "PM5100/5300/5500",
  validationStatus: "assumed",
  defaultPort: 502,
  defaultUnitId: 1,
  note: "Verify float32 addresses + word order vs the PM5000 Modbus register list.",
  registers: [
    { metric: "power_kw",            address: "4x:3060", dataType: "float", unit: "kW",   label: "Total Active Power" },
    { metric: "reactive_power_kvar", address: "4x:3068", dataType: "float", unit: "kVAr", label: "Total Reactive Power" },
    { metric: "apparent_power_kva",  address: "4x:3076", dataType: "float", unit: "kVA",  label: "Total Apparent Power" },
    { metric: "power_factor",        address: "4x:3084", dataType: "float", unit: "",     label: "Total Power Factor" },
    { metric: "energy_kwh",          address: "4x:3204", dataType: "float", unit: "kWh",  label: "Total Active Energy (Delivered)" },
  ],
};

/**
 * Selec MFM384 / EM2M multifunction meter. Selec exposes 32-bit float measurements in
 * the input-register range (3x). Addresses below are the MFM384 assumed map — confirm
 * against the Selec Modbus communication manual.
 */
const SELEC_MFM384: EnergyMeterTemplate = {
  id: "selec-mfm384",
  vendor: "Selec",
  model: "MFM384 / EM2M",
  validationStatus: "assumed",
  defaultPort: 502,
  defaultUnitId: 1,
  note: "Verify float32 input-register addresses vs the Selec MFM384/EM2M Modbus manual.",
  registers: [
    { metric: "power_kw",            address: "3x:101", dataType: "float", unit: "kW",   label: "Active Power (Total)" },
    { metric: "reactive_power_kvar", address: "3x:103", dataType: "float", unit: "kVAr", label: "Reactive Power (Total)" },
    { metric: "apparent_power_kva",  address: "3x:105", dataType: "float", unit: "kVA",  label: "Apparent Power (Total)" },
    { metric: "power_factor",        address: "3x:107", dataType: "float", unit: "",     label: "Power Factor (Average)" },
    { metric: "energy_kwh",          address: "3x:157", dataType: "float", unit: "kWh",  label: "Active Energy Import" },
  ],
};

/**
 * A GENERIC single-phase float meter (IEC-62053 style). Useful as a starting point for
 * any meter that publishes float32 kW / kWh / PF in a small holding block — the
 * installer just edits the 3 addresses. `assumed` by definition.
 */
const GENERIC_IEC_FLOAT: EnergyMeterTemplate = {
  id: "generic-iec-float",
  vendor: "Generic",
  model: "IEC-62053 float meter",
  validationStatus: "assumed",
  defaultPort: 502,
  defaultUnitId: 1,
  note: "Edit the 3 holding addresses to match your meter's float32 kW/kWh/PF block.",
  registers: [
    { metric: "power_kw",     address: "4x:1", dataType: "float", unit: "kW",  label: "Active Power" },
    { metric: "power_factor", address: "4x:3", dataType: "float", unit: "",    label: "Power Factor" },
    { metric: "energy_kwh",   address: "4x:5", dataType: "float", unit: "kWh", label: "Active Energy" },
  ],
};

const TEMPLATES: Record<string, EnergyMeterTemplate> = {
  [SCHNEIDER_PM5000.id]: SCHNEIDER_PM5000,
  [SELEC_MFM384.id]: SELEC_MFM384,
  [GENERIC_IEC_FLOAT.id]: GENERIC_IEC_FLOAT,
};

/** All templates (read-only view for a picker UI). */
export function listEnergyMeterTemplates(): EnergyMeterTemplate[] {
  return Object.values(TEMPLATES).map(cloneTemplate);
}

/** One template by id, or undefined. */
export function getEnergyMeterTemplate(id: string): EnergyMeterTemplate | undefined {
  const t = TEMPLATES[id];
  return t ? cloneTemplate(t) : undefined;
}

function cloneTemplate(t: EnergyMeterTemplate): EnergyMeterTemplate {
  return { ...t, registers: t.registers.map((r) => ({ ...r })) };
}

/**
 * Convert a template into `OtTagAddress[]` ready to hand to the Modbus OT driver /
 * store in `device_tags`. `tagKey === metric` so the emitted samples carry the metric
 * the energy tap whitelists. Throws for an unknown template id (fail-loud).
 */
export function toOtTagAddresses(templateOrId: EnergyMeterTemplate | string): OtTagAddress[] {
  const tpl = typeof templateOrId === "string" ? getEnergyMeterTemplate(templateOrId) : templateOrId;
  if (!tpl) throw new Error(`unknown energy meter template: ${String(templateOrId)}`);
  return tpl.registers.map((r) => ({
    tagKey: r.metric,
    address: r.address,
    dataType: r.dataType,
    ...(r.scale != null ? { scale: r.scale } : {}),
    unit: r.unit,
  })) as OtTagAddress[];
}

/**
 * Describe the `device_adapters` + `device_tags` rows to create for a meter, WITHOUT
 * touching the DB (pure). The caller (an admin router / seed script) inserts these
 * using its own db handle. Reuses protocol 'modbus' → the existing modbusDriver.
 */
export interface EnergyMeterAdapterPlan {
  adapter: {
    protocol: "modbus";
    endpoint: string;      // "tcp://host:port"
    unitId: number;
    /** Marks the adapter as an energy meter for discovery/UI. */
    kind: "energy_meter";
    templateId: string;
    validationStatus: EnergyTemplateValidation;
  };
  tags: OtTagAddress[];
}

/** Build an adapter+tags plan for a meter at `host` using `templateId`. */
export function buildEnergyMeterAdapterPlan(
  host: string,
  templateId: string,
  opts?: { port?: number; unitId?: number },
): EnergyMeterAdapterPlan {
  const tpl = getEnergyMeterTemplate(templateId);
  if (!tpl) throw new Error(`unknown energy meter template: ${templateId}`);
  const port = opts?.port ?? tpl.defaultPort;
  const unitId = opts?.unitId ?? tpl.defaultUnitId;
  return {
    adapter: {
      protocol: "modbus",
      endpoint: `tcp://${host}:${port}`,
      unitId,
      kind: "energy_meter",
      templateId: tpl.id,
      validationStatus: tpl.validationStatus,
    },
    tags: toOtTagAddresses(tpl),
  };
}
