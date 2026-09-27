/**
 * E1-e (doc 16 §10 / §15) — Compliance metrics.  Flag: EQ_GOVERN_ENABLED.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Computes the Compliance Dashboard metrics:
 *   • % of machines mapped to a PUBLISHED device type
 *   • device types PASSING conformance
 *   • change-requests pending
 *   • alarm-mapping coverage (distinct vendors mapped)
 *
 * PURE core (computeCompliance) over supplied inputs so it is trivially unit-testable;
 * the DB-bound aggregation (loadComplianceMetrics) is shared by the tRPC router
 * (`equipmentStandards.complianceMetrics`) and the public v1 read (`/standards/compliance`)
 * so both surfaces report the SAME numbers.
 *
 * ★ doc 80 Đợt 1 Task 3 (STD-01) — the old core was a TAUTOLOGY: "mapped" compared each
 *   machine's `machineType` against the typeKeys of the in-code SEED (which is BUILT from
 *   the machine-type enum), so every machine was always "mapped" (1700/1700 observed live
 *   while `machines.device_type_key` was NULL on 1 113 rows), and conformance ran on the
 *   same seed constants (24/24 always green). Now:
 *     • mapped  ⇔ `machines.device_type_key` names a typeKey with a PUBLISHED row in
 *                 `device_types` (seed constants are NOT counted as published);
 *     • conformance runs on the published `device_types` rows actually in the DB;
 *     • `basis` says what the numbers were computed from (and flags thin data) instead of
 *       ever presenting a fabricated 100 %.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { eq } from "drizzle-orm";
import type { getDb } from "../../db/connection";
import { machines } from "../../../drizzle/schema";
import { deviceTypes, alarmTaxonomy, deviceTypeChangeRequests } from "../../../drizzle/schema/equipmentStandards";
import { runConformanceAcrossNodes } from "./conformanceTest";
import { nodeFromDeviceTypeRow } from "./deviceTypeRegistry";
import { SEED_ALARM_MAPPINGS } from "./alarmTaxonomy";

/** One machine as seen by the compliance KPI. */
export interface ComplianceMachine {
  /** The equipmentClass the machine declares (for the "unmapped types" list only). */
  machineType: string | null;
  /** `machines.device_type_key` — the governance binding. NULL = never bound. */
  deviceTypeKey: string | null;
}

export interface ComplianceInput {
  machines: ComplianceMachine[];
  /** typeKeys that have at least one PUBLISHED device_types row. */
  publishedTypeKeys: string[];
  /** Conformance results over the published device types. */
  conformanceResults: { typeKey: string; pass: boolean }[];
  /** CR statuses present (to count pending/in_review). */
  crStatuses?: string[];
  /** Distinct vendors that have at least one alarm mapping. */
  mappedVendors?: string[];
  /** false ⇒ no DB connection: every count below is 0 because nothing was read. */
  dbAvailable?: boolean;
}

/** Why a number may be thin — codes (the UI translates them), never a silent 100 %. */
export type ComplianceWarning =
  | "db_unavailable"
  | "no_machines"
  | "no_published_types"
  | "no_bound_machines"
  | "no_conformance_subjects";

export interface ComplianceBasis {
  /** "mapped" is decided by this column — never by machines.machineType. */
  mapping: "machines.device_type_key";
  /** The published type set comes from device_types rows (status='published'). */
  publishedTypesFrom: "device_types";
  /** Conformance ran over the published device_types rows. */
  conformanceFrom: "device_types";
  dbAvailable: boolean;
  publishedTypeCount: number;
  /** Machines with a non-NULL device_type_key (bound to SOME key, published or not). */
  machinesWithKey: number;
  /** Machines bound to a key that has NO published device_types row (draft/unknown). */
  machinesWithUnpublishedKey: number;
  warnings: ComplianceWarning[];
}

export interface ComplianceMetrics {
  machineCount: number;
  machinesMappedToPublished: number;
  /** 0..1 — fraction of machines whose device_type_key is a published device type. */
  mappedRate: number;
  unmappedMachineCount: number;
  /** machineTypes that have ≥1 machine NOT mapped to a published device type. */
  unmappedMachineTypes: string[];
  /** Published typeKey → number of machines bound to it (only keys with ≥1 machine). */
  usageByTypeKey: Record<string, number>;
  conformanceTypeCount: number;
  conformancePassCount: number;
  conformancePassRate: number;
  /** typeKeys that FAILED conformance (for the dashboard alert). */
  failingTypes: string[];
  crPendingCount: number;
  alarmVendorCoverage: number;
  basis: ComplianceBasis;
}

/** Pure compliance computation. Fail-safe over partial inputs. */
export function computeCompliance(input: ComplianceInput): ComplianceMetrics {
  const list = Array.isArray(input.machines) ? input.machines : [];
  const published = new Set((input.publishedTypeKeys ?? []).map((s) => String(s)));
  const machineCount = list.length;
  let mapped = 0;
  let withKey = 0;
  let withUnpublishedKey = 0;
  const unmappedSet = new Set<string>();
  const usage: Record<string, number> = {};
  for (const m of list) {
    const key = m?.deviceTypeKey ? String(m.deviceTypeKey) : null;
    if (key) withKey++;
    if (key && published.has(key)) {
      mapped++;
      usage[key] = (usage[key] ?? 0) + 1;
    } else {
      if (key) withUnpublishedKey++;
      if (m?.machineType) unmappedSet.add(String(m.machineType));
    }
  }

  const conf = Array.isArray(input.conformanceResults) ? input.conformanceResults : [];
  const conformanceTypeCount = conf.length;
  const passing = conf.filter((c) => c.pass);
  const failingTypes = conf.filter((c) => !c.pass).map((c) => c.typeKey);

  const crStatuses = input.crStatuses ?? [];
  const crPendingCount = crStatuses.filter((s) => s === "pending" || s === "in_review").length;

  const alarmVendorCoverage = new Set((input.mappedVendors ?? []).map((v) => String(v).toLowerCase())).size;

  const dbAvailable = input.dbAvailable !== false;
  const warnings: ComplianceWarning[] = [];
  if (!dbAvailable) warnings.push("db_unavailable");
  if (machineCount === 0) warnings.push("no_machines");
  if (published.size === 0) warnings.push("no_published_types");
  if (machineCount > 0 && withKey === 0) warnings.push("no_bound_machines");
  if (conformanceTypeCount === 0) warnings.push("no_conformance_subjects");

  return {
    machineCount,
    machinesMappedToPublished: mapped,
    mappedRate: machineCount > 0 ? mapped / machineCount : 0,
    unmappedMachineCount: machineCount - mapped,
    unmappedMachineTypes: Array.from(unmappedSet).sort(),
    usageByTypeKey: usage,
    conformanceTypeCount,
    conformancePassCount: passing.length,
    conformancePassRate: conformanceTypeCount > 0 ? passing.length / conformanceTypeCount : 0,
    failingTypes,
    crPendingCount,
    alarmVendorCoverage,
    basis: {
      mapping: "machines.device_type_key",
      publishedTypesFrom: "device_types",
      conformanceFrom: "device_types",
      dbAvailable,
      publishedTypeCount: published.size,
      machinesWithKey: withKey,
      machinesWithUnpublishedKey: withUnpublishedKey,
      warnings,
    },
  };
}

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

/**
 * DB-bound aggregation shared by `equipmentStandards.complianceMetrics` and the v1
 * `/standards/compliance` read. `d = null` (no DB) ⇒ honest zeros + `db_unavailable`.
 *
 * Alarm vendor coverage keeps SEED ∪ persisted: unlike device types, the seed alarm
 * mappings ARE live at runtime (loadAlarmMappings / mapAlarm merge them), so counting
 * their vendors is a measurement of what the normalizer really does.
 */
export async function loadComplianceMetrics(d: Db | null): Promise<ComplianceMetrics> {
  const mappedVendors = new Set<string>();
  for (const m of SEED_ALARM_MAPPINGS) mappedVendors.add(m.vendor.toLowerCase());
  if (!d) {
    return computeCompliance({
      machines: [],
      publishedTypeKeys: [],
      conformanceResults: [],
      crStatuses: [],
      mappedVendors: Array.from(mappedVendors),
      dbAvailable: false,
    });
  }
  const ms = await d
    .select({ machineType: machines.machineType, deviceTypeKey: machines.deviceTypeKey })
    .from(machines);
  const publishedRows = await d.select().from(deviceTypes).where(eq(deviceTypes.status, "published"));
  const publishedNodes = publishedRows.map(nodeFromDeviceTypeRow);
  const at = await d.select({ vendor: alarmTaxonomy.vendor }).from(alarmTaxonomy);
  for (const a of at) mappedVendors.add(a.vendor.toLowerCase());
  const crs = await d.select({ status: deviceTypeChangeRequests.status }).from(deviceTypeChangeRequests);
  return computeCompliance({
    machines: ms.map((m) => ({ machineType: m.machineType ?? null, deviceTypeKey: m.deviceTypeKey ?? null })),
    publishedTypeKeys: Array.from(new Set(publishedRows.map((r) => r.typeKey))),
    conformanceResults: runConformanceAcrossNodes(publishedNodes),
    crStatuses: crs.map((c) => c.status),
    mappedVendors: Array.from(mappedVendors),
    dbAvailable: true,
  });
}
