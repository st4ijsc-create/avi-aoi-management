/**
 * M13 — machines.capabilities validation against the deviceTypes descriptor
 * (doc 27 §2 M13, design contract doc 29 §4 — Đợt 8 / W8-A, column 0191).
 * ============================================================================
 * `machines.capabilities` is free jsonb; `device_types.attributesSchema`
 * (equipmentStandards.ts) is the per-type attribute CONTRACT (merged across
 * the inheritance chain by deviceTypeRegistry.resolveType — reused, not
 * re-implemented).
 *
 * SOFT 2-TIER GATE (doc 29 §4.2, mirrors the commissioning gate):
 *   Tier 1 (always): validate on save, stamp the result into the new nullable
 *     `machines.capabilitiesValidation` jsonb + surface a UI badge. NEVER
 *     rejects.
 *   Tier 2 (flag CAPABILITIES_VALIDATION_ENFORCED, default OFF): reject the
 *     mutation ONLY when a REQUIRED attribute is missing/mistyped
 *     (`blockingErrors`). Non-required type mismatches stay warnings; keys
 *     outside the contract are NEVER blocking (vendor extensions — the
 *     `extensionFields` PRESERVED philosophy) but are listed in `unknownKeys`.
 *
 * RESOLUTION machineType → deviceType: via `mappedMachineTypes` on the node
 * set (seed ∪ published device_types rows — same loadNodeSet shape as
 * equipmentStandardsRouter), falling back to a node whose typeKey equals the
 * machineType, then to the Equipment base. Fail-safe: never throws.
 *
 * TIER-2 DRIFT REPORT: runCapabilitiesDriftScanNow() sweeps every ACTIVE
 * machine weekly (scheduler mirrors integrityScanService), re-validates its
 * capabilities against the CURRENT contract, re-stamps drifted rows and logs
 * an honest summary (including machineTypes with no device-type mapping —
 * the doc 29 §4.2(4) orphan case).
 */
import * as cron from "node-cron";
import { eq, and } from "drizzle-orm";
import { getDb, getJobsDb } from "../../db/connection";
import { machines, deviceTypes } from "../../../drizzle/schema";
import type { CapabilitiesValidationStamp } from "../../../drizzle/schema";
import type { DeviceTypeAttribute } from "../../../drizzle/schema/equipmentStandards";
import {
  buildSeedTypes,
  resolveType,
  type DeviceTypeNode,
  type ResolvedDeviceType,
} from "./deviceTypeRegistry";

// ─── Flags ────────────────────────────────────────────────────────────────────

/** Tier-2 enforcement — default OFF (warning-only per doc 29 §4.2 nấc 1). */
export function capabilitiesValidationEnforced(): boolean {
  const v = process.env.CAPABILITIES_VALIDATION_ENFORCED;
  return v === "true" || v === "1";
}

/** Weekly drift scan — default ON (read + jsonb stamp only, bounded work). */
function driftScanEnabled(): boolean {
  return String(process.env.CAPABILITIES_DRIFT_SCAN_ENABLED ?? "true").toLowerCase() !== "false";
}

// ─── Pure validator ───────────────────────────────────────────────────────────

export interface CapabilitiesValidationResult extends CapabilitiesValidationStamp {
  /** Errors on REQUIRED attributes — the only thing tier-2 enforcement blocks on. */
  blockingErrors: Array<{ path: string; expected: string; got: string; required?: boolean }>;
}

function describeType(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

/** Check ONE declared attribute value against its DeviceTypeAttribute slot. */
function checkAttribute(attr: DeviceTypeAttribute, value: unknown): { expected: string } | null {
  switch (attr.dataType) {
    case "bool":
      return typeof value === "boolean" ? null : { expected: "boolean" };
    case "int":
      return typeof value === "number" && Number.isInteger(value) ? null : { expected: "integer" };
    case "float":
      return typeof value === "number" && Number.isFinite(value) ? null : { expected: "number" };
    case "string":
      return typeof value === "string" ? null : { expected: "string" };
    case "enum": {
      const opts = attr.options ?? [];
      return opts.some((o) => o === value)
        ? null
        : { expected: `one of [${opts.join(", ")}]` };
    }
    case "json":
      return value !== null && (typeof value === "object")
        ? null
        : { expected: "object/array (json)" };
    default:
      // Unknown dataType in the contract — never fail the machine for a
      // contract-side problem.
      return null;
  }
}

/**
 * Resolve which device type governs a machineType: a node whose
 * mappedMachineTypes contains it → its typeKey; else a node keyed AS the
 * machineType; else the Equipment base. Returns null only when the node set
 * has no Equipment root either (empty set).
 */
export function resolveDeviceTypeForMachineType(
  machineType: string,
  nodes: DeviceTypeNode[],
): ResolvedDeviceType | null {
  const mapped = nodes.find((n) => (n.mappedMachineTypes ?? []).includes(machineType));
  return (
    (mapped ? resolveType(mapped.typeKey, nodes) : null) ??
    resolveType(machineType, nodes) ??
    resolveType("Equipment", nodes)
  );
}

/**
 * Validate a capabilities payload against the resolved device-type contract.
 * PURE + fail-safe (never throws). `capabilities` NULL/empty ⇒ `skipped: true`
 * and ok — a machine that declares nothing has nothing to drift (required
 * attributes are only checked against DECLARED payloads, so legacy rows do
 * not all light up red the day this ships).
 */
export function validateCapabilities(
  machineType: string,
  capabilities: unknown,
  nodes?: DeviceTypeNode[],
): CapabilitiesValidationResult {
  const set = nodes ?? buildSeedTypes();
  const resolved = resolveDeviceTypeForMachineType(machineType, set);
  const checkedAt = new Date().toISOString();

  const base: CapabilitiesValidationResult = {
    checkedAt,
    deviceTypeKey: resolved?.typeKey ?? "(unmapped)",
    deviceTypeVersion: resolved?.version,
    ok: true,
    errors: [],
    blockingErrors: [],
    unknownKeys: [],
  };

  const caps =
    capabilities && typeof capabilities === "object" && !Array.isArray(capabilities)
      ? (capabilities as Record<string, unknown>)
      : null;

  if (!caps || Object.keys(caps).length === 0) {
    // Nothing declared → nothing to validate (honest skip, not a fake pass).
    return { ...base, skipped: true };
  }
  if (!resolved) {
    // No contract at all — cannot validate; report the mapping gap, don't block.
    return {
      ...base,
      ok: false,
      errors: [{ path: "(machineType)", expected: `a device type mapped to '${machineType}'`, got: "no mapping" }],
    };
  }

  const attrByName = new Map(resolved.attributesSchema.map((a) => [a.name, a]));
  const errors: CapabilitiesValidationResult["errors"] = [];
  const unknownKeys: string[] = [];

  for (const [key, value] of Object.entries(caps)) {
    const attr = attrByName.get(key);
    if (!attr) {
      unknownKeys.push(key); // vendor extension — listed, never blocking
      continue;
    }
    const bad = checkAttribute(attr, value);
    if (bad) {
      errors.push({ path: key, expected: bad.expected, got: describeType(value), required: attr.required === true });
    }
  }
  // Required attributes must be PRESENT (and well-typed — covered above).
  for (const attr of resolved.attributesSchema) {
    if (attr.required === true && !(attr.name in caps)) {
      errors.push({ path: attr.name, expected: attr.dataType, got: "missing", required: true });
    }
  }

  const blockingErrors = errors.filter((e) => e.required === true);
  return {
    ...base,
    ok: errors.length === 0,
    errors,
    blockingErrors,
    unknownKeys,
  };
}

/** Strip the derived field before persisting into machines.capabilitiesValidation. */
export function toStamp(result: CapabilitiesValidationResult, source: "save" | "drift-scan"): CapabilitiesValidationStamp {
  const { blockingErrors: _blocking, ...stamp } = result;
  return { ...stamp, source };
}

// ─── Node loading (seed ∪ persisted device_types rows) ───────────────────────

/**
 * SEED ∪ device_types rows (same merge as equipmentStandardsRouter.loadNodeSet;
 * preferNode inside resolveType picks published > draft and highest SemVer).
 * Fail-safe: DB offline → seed only.
 */
export async function loadDeviceTypeNodes(): Promise<DeviceTypeNode[]> {
  const seed = buildSeedTypes();
  try {
    const db = await getDb();
    if (!db) return seed;
    const rows = await db.select().from(deviceTypes);
    const persisted: DeviceTypeNode[] = rows.map((r) => ({
      typeKey: r.typeKey,
      parentTypeKey: r.parentTypeKey ?? null,
      version: r.version ?? "1.0.0",
      status: (r.status as DeviceTypeNode["status"]) ?? "draft",
      label: r.label ?? undefined,
      description: r.description ?? undefined,
      attributesSchema: (r.attributesSchema ?? []) as DeviceTypeNode["attributesSchema"],
      supportedCommands: (r.supportedCommands ?? []) as DeviceTypeNode["supportedCommands"],
      supportedStates: (r.supportedStates ?? []) as DeviceTypeNode["supportedStates"],
      extensionFields: (r.extensionFields ?? {}) as Record<string, unknown>,
      mappedMachineTypes: (r.mappedMachineTypes ?? []) as string[],
      adapterKind: r.adapterKind ?? undefined,
    }));
    return [...seed, ...persisted];
  } catch (err) {
    console.warn("[capabilitiesValidation] device_types load failed — using seed only:", (err as Error)?.message);
    return seed;
  }
}

// ─── Tier-2 weekly drift scan ─────────────────────────────────────────────────

export interface CapabilitiesDriftEntry {
  machineId: number;
  code: string;
  name: string;
  machineType: string;
  deviceTypeKey: string;
  errors: CapabilitiesValidationStamp["errors"];
  unknownKeys: string[];
}

export interface CapabilitiesDriftReport {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  machinesChecked: number;
  withCapabilities: number;
  drifted: CapabilitiesDriftEntry[];
  /** machineTypes present on active machines but with NO device-type mapping. */
  unmappedMachineTypes: string[];
  durationMs: number;
  scannedAt: string;
}

type MachineSlice = Pick<
  typeof machines.$inferSelect,
  "id" | "code" | "name" | "machineType" | "capabilities"
>;

/**
 * PURE drift-report builder over an in-memory machine slice (unit-tested).
 * A machine "drifts" when it DECLARES capabilities and the current contract
 * flags errors on them (skipped rows never drift).
 */
export function buildDriftReport(rows: MachineSlice[], nodes: DeviceTypeNode[]): {
  withCapabilities: number;
  drifted: CapabilitiesDriftEntry[];
  unmappedMachineTypes: string[];
  stamps: Map<number, CapabilitiesValidationStamp>;
} {
  const drifted: CapabilitiesDriftEntry[] = [];
  const unmapped = new Set<string>();
  const stamps = new Map<number, CapabilitiesValidationStamp>();
  let withCapabilities = 0;

  for (const m of rows) {
    const mapped = nodes.some(
      (n) => (n.mappedMachineTypes ?? []).includes(m.machineType) || n.typeKey === m.machineType,
    );
    if (!mapped) unmapped.add(m.machineType);

    const result = validateCapabilities(m.machineType, m.capabilities ?? null, nodes);
    if (result.skipped) continue;
    withCapabilities += 1;
    stamps.set(m.id, toStamp(result, "drift-scan"));
    if (!result.ok || result.unknownKeys.length > 0) {
      drifted.push({
        machineId: m.id,
        code: m.code,
        name: m.name,
        machineType: m.machineType,
        deviceTypeKey: result.deviceTypeKey,
        errors: result.errors,
        unknownKeys: result.unknownKeys,
      });
    }
  }
  return { withCapabilities, drifted, unmappedMachineTypes: [...unmapped].sort(), stamps };
}

let scanRunning = false;
let lastDriftRunAt: Date | null = null;
let lastDriftReport: CapabilitiesDriftReport | null = null;

/**
 * Sweep all ACTIVE machines: re-validate declared capabilities against the
 * CURRENT contract, re-stamp machines.capabilitiesValidation for every row
 * that declares capabilities, and log a summary. Fail-safe; single-flight.
 */
export async function runCapabilitiesDriftScanNow(): Promise<CapabilitiesDriftReport> {
  const start = Date.now();
  const scannedAt = new Date().toISOString();
  if (scanRunning) {
    return { ok: true, skipped: true, reason: "already_running", machinesChecked: 0, withCapabilities: 0, drifted: [], unmappedMachineTypes: [], durationMs: 0, scannedAt };
  }
  scanRunning = true;
  try {
    // Long full-table sweep → background-jobs pool (mirrors integrityScanService).
    const db = await getJobsDb();
    if (!db) {
      return { ok: false, skipped: true, reason: "db_unavailable", machinesChecked: 0, withCapabilities: 0, drifted: [], unmappedMachineTypes: [], durationMs: Date.now() - start, scannedAt };
    }
    const nodes = await loadDeviceTypeNodes();
    const rows = (await db
      .select({
        id: machines.id,
        code: machines.code,
        name: machines.name,
        machineType: machines.machineType,
        capabilities: machines.capabilities,
      })
      .from(machines)
      .where(eq(machines.isActive, true))) as MachineSlice[];

    const { withCapabilities, drifted, unmappedMachineTypes, stamps } = buildDriftReport(rows, nodes);

    // Re-stamp rows that declare capabilities (bounded: only those rows).
    for (const [machineId, stamp] of stamps) {
      try {
        await db
          .update(machines)
          .set({ capabilitiesValidation: stamp })
          .where(and(eq(machines.id, machineId), eq(machines.isActive, true)));
      } catch (err) {
        console.warn(`[capabilitiesDrift] stamp failed for machine ${machineId} (run migration 0191?):`, (err as Error)?.message);
      }
    }

    const report: CapabilitiesDriftReport = {
      ok: true,
      machinesChecked: rows.length,
      withCapabilities,
      drifted,
      unmappedMachineTypes,
      durationMs: Date.now() - start,
      scannedAt,
    };
    lastDriftRunAt = new Date();
    lastDriftReport = report;

    if (drifted.length > 0 || unmappedMachineTypes.length > 0) {
      console.warn(
        `[capabilitiesDrift] ${drifted.length} machine(s) drift from their device-type contract` +
        (unmappedMachineTypes.length ? `; unmapped machineTypes: ${unmappedMachineTypes.join(", ")}` : "") +
        ` — ${drifted.map((d) => `${d.code}(${d.errors.length}err/${d.unknownKeys.length}ext)`).join(", ") || "-"}`,
      );
    } else {
      console.log(`[capabilitiesDrift] clean — ${rows.length} machine(s), ${withCapabilities} with declared capabilities, ${report.durationMs}ms`);
    }
    return report;
  } catch (err) {
    const msg = (err as Error)?.message ?? String(err);
    console.error("[capabilitiesDrift] scan failed:", msg);
    return { ok: false, reason: msg, machinesChecked: 0, withCapabilities: 0, drifted: [], unmappedMachineTypes: [], durationMs: Date.now() - start, scannedAt };
  } finally {
    scanRunning = false;
  }
}

// ─── Scheduler lifecycle (mirrors integrityScanService) ───────────────────────

let job: cron.ScheduledTask | null = null;

/** Weekly cron (Sunday 03:45 factory time by default). No-op when disabled. */
export function startCapabilitiesDriftScheduler(): void {
  if (!driftScanEnabled()) {
    console.log("[capabilitiesDrift] disabled (CAPABILITIES_DRIFT_SCAN_ENABLED=false)");
    return;
  }
  if (job) return;
  const CRON = process.env.CAPABILITIES_DRIFT_CRON || "45 3 * * 0";
  const TZ = process.env.CAPABILITIES_DRIFT_TZ || "Asia/Ho_Chi_Minh";
  job = cron.schedule(
    CRON,
    () => {
      runCapabilitiesDriftScanNow().catch((e) => console.error("[capabilitiesDrift] cron error:", e));
    },
    { timezone: TZ },
  );
  console.log(`[capabilitiesDrift] scheduled '${CRON}' (${TZ})`);
}

export function stopCapabilitiesDriftScheduler(): void {
  if (job) {
    job.stop();
    job = null;
    console.log("[capabilitiesDrift] stopped");
  }
}

/** Status for the admin surface. */
export function getCapabilitiesDriftStatus() {
  return {
    enabled: driftScanEnabled(),
    enforced: capabilitiesValidationEnforced(),
    cron: process.env.CAPABILITIES_DRIFT_CRON || "45 3 * * 0",
    timezone: process.env.CAPABILITIES_DRIFT_TZ || "Asia/Ho_Chi_Minh",
    running: !!job,
    scanInFlight: scanRunning,
    lastRunAt: lastDriftRunAt,
    lastReport: lastDriftReport,
  };
}
