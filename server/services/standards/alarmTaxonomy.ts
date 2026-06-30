/**
 * E1-b (doc 16 §10 / §15) — ISA-18.2 Alarm Taxonomy.  Flag: EQ_GOVERN_ENABLED.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Normalizes a vendor's NATIVE alarm code → a STANDARD internal code + an ISA-18.2
 * severity band + a recommended action. Adapters / andon call mapAlarm() to turn raw
 * per-vendor codes into one taxonomy the whole platform reasons about.
 *
 * SAFETY / PURE: this module DESCRIBES alarms only. It opens no control path. The
 * built-in SEED mappings (3–5 example vendors) are a pure in-memory dictionary; the
 * DB-backed `alarm_taxonomy` rows OVERRIDE/extend them (resolved in the router which
 * has db access). mapAlarm() here is pure over a supplied entry list (defaults to the
 * seed) so it is trivially unit-testable.
 * ════════════════════════════════════════════════════════════════════════════
 */

/** ISA-18.2 priority/severity bands. */
export type AlarmSeverity = "critical" | "high" | "medium" | "low" | "diagnostic";

export const ALARM_SEVERITIES = ["critical", "high", "medium", "low", "diagnostic"] as const satisfies readonly AlarmSeverity[];

/** ONE taxonomy entry (matches the alarm_taxonomy row shape, sans tenant/id). */
export interface AlarmMapping {
  vendor: string;
  machineType?: string | null;
  deviceTypeKey?: string | null;
  nativeCode: string;
  standardCode: string;
  severity: AlarmSeverity;
  description?: string;
  recommendedAction?: string;
}

/** The normalized result of mapAlarm(). */
export interface NormalizedAlarm {
  standardCode: string;
  severity: AlarmSeverity;
  recommendedAction?: string;
  description?: string;
  /** True when the result came from a real mapping; false = fail-safe default. */
  mapped: boolean;
}

/** Narrow an arbitrary string to an AlarmSeverity (fail-safe → 'medium'). */
export function asSeverity(raw: unknown): AlarmSeverity {
  return typeof raw === "string" && (ALARM_SEVERITIES as readonly string[]).includes(raw)
    ? (raw as AlarmSeverity)
    : "medium";
}

// ════════════════════════════════════════════════════════════════════════════
// SEED — 5 example vendors (Fanuc, Universal Robots, Mitsubishi, KUKA, Siemens).
// These are illustrative ISA-18.2 mappings; the DB table extends/overrides them.
// ════════════════════════════════════════════════════════════════════════════
export const SEED_ALARM_MAPPINGS: AlarmMapping[] = [
  // ── Fanuc (robot controllers) ──
  { vendor: "fanuc", machineType: "ROBOT", nativeCode: "SRVO-050", standardCode: "COLLISION_DETECT", severity: "critical", description: "Collision detect alarm", recommendedAction: "Clear obstruction; jog robot away; reset after safety check." },
  { vendor: "fanuc", machineType: "ROBOT", nativeCode: "SRVO-021", standardCode: "ESTOP_ACTIVE", severity: "critical", description: "SRDY off (E-stop)", recommendedAction: "Release E-stop and reset controller." },
  { vendor: "fanuc", machineType: "ROBOT", nativeCode: "SRVO-062", standardCode: "ENCODER_FAULT", severity: "high", description: "BZAL alarm (encoder battery)", recommendedAction: "Replace encoder backup battery; re-master axis." },
  // ── Universal Robots (cobots) ──
  { vendor: "universal_robots", machineType: "ROBOT", nativeCode: "C153A0", standardCode: "FORCE_LIMIT_EXCEEDED", severity: "high", description: "Protective stop: force limit exceeded", recommendedAction: "Reduce payload/speed; verify force limit config; restart program." },
  { vendor: "universal_robots", machineType: "ROBOT", nativeCode: "C204", standardCode: "JOINT_LIMIT", severity: "medium", description: "Joint position out of safety range", recommendedAction: "Jog joint back into range; review waypoints." },
  { vendor: "universal_robots", machineType: "ROBOT", nativeCode: "C100", standardCode: "ESTOP_ACTIVE", severity: "critical", description: "Emergency stop pressed", recommendedAction: "Release E-stop button; re-enable robot." },
  // ── Mitsubishi (PLC / OT) ──
  { vendor: "mitsubishi", machineType: "AUTOMATION", nativeCode: "2300", standardCode: "OVERTEMP", severity: "high", description: "Module over-temperature", recommendedAction: "Check cooling/fans; allow cooldown before reset." },
  { vendor: "mitsubishi", machineType: "AUTOMATION", nativeCode: "1401", standardCode: "IO_FAULT", severity: "medium", description: "I/O module verify error", recommendedAction: "Reseat/replace I/O module; verify wiring." },
  // ── KUKA (robot controllers) ──
  { vendor: "kuka", machineType: "ROBOT", nativeCode: "KSS01301", standardCode: "DRIVE_FAULT", severity: "high", description: "Drives contactor fault", recommendedAction: "Acknowledge fault; check drive enable chain." },
  { vendor: "kuka", machineType: "ROBOT", nativeCode: "KSS15014", standardCode: "WORKSPACE_VIOLATION", severity: "medium", description: "Workspace monitoring violation", recommendedAction: "Move TCP inside the configured workspace; review cell layout." },
  // ── Siemens (S7 PLC) ──
  { vendor: "siemens", machineType: "AUTOMATION", nativeCode: "SF-CPU", standardCode: "CPU_FAULT", severity: "critical", description: "CPU group/system fault (SF LED)", recommendedAction: "Read diagnostic buffer; clear faulting module; restart CPU." },
  { vendor: "siemens", machineType: "AUTOMATION", nativeCode: "BF-PN", standardCode: "COMMS_LOSS", severity: "high", description: "PROFINET bus fault", recommendedAction: "Check network cabling/device; re-establish PROFINET." },
];

/** Default fail-safe when no mapping is found. */
const DEFAULT_UNKNOWN: NormalizedAlarm = {
  standardCode: "UNKNOWN_ALARM",
  severity: "medium",
  recommendedAction: "No taxonomy mapping — investigate vendor manual and add a mapping.",
  mapped: false,
};

/** Normalize a vendor key (lower-case, trim) for consistent matching. */
export function normalizeVendor(vendor: string): string {
  return String(vendor ?? "").trim().toLowerCase();
}

/**
 * Map (vendor, nativeCode) → normalized alarm. Pure over the supplied entry list
 * (defaults to the seed). Match is case-insensitive on vendor; nativeCode is matched
 * exactly first, then case-insensitively. Fail-safe: unknown → DEFAULT_UNKNOWN.
 */
export function mapAlarm(
  vendor: string,
  nativeCode: string,
  entries: AlarmMapping[] = SEED_ALARM_MAPPINGS,
): NormalizedAlarm {
  const v = normalizeVendor(vendor);
  const code = String(nativeCode ?? "").trim();
  if (!v || !code) return { ...DEFAULT_UNKNOWN };
  let hit = entries.find((e) => normalizeVendor(e.vendor) === v && e.nativeCode === code);
  if (!hit) {
    const lc = code.toLowerCase();
    hit = entries.find((e) => normalizeVendor(e.vendor) === v && e.nativeCode.toLowerCase() === lc);
  }
  if (!hit) return { ...DEFAULT_UNKNOWN };
  return {
    standardCode: hit.standardCode,
    severity: asSeverity(hit.severity),
    recommendedAction: hit.recommendedAction,
    description: hit.description,
    mapped: true,
  };
}

/** Distinct vendors present in an entry list (for UI filters). */
export function listVendors(entries: AlarmMapping[] = SEED_ALARM_MAPPINGS): string[] {
  return Array.from(new Set(entries.map((e) => normalizeVendor(e.vendor)))).sort();
}
