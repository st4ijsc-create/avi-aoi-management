/**
 * E1-e (doc 16 §10 / §15) — Compliance metrics.  Flag: EQ_GOVERN_ENABLED.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Computes the Compliance Dashboard metrics:
 *   • % of machines mapped to a PUBLISHED device type
 *   • adapters / capability profiles PASSING conformance
 *   • change-requests pending
 *   • alarm-mapping coverage (distinct vendors mapped)
 *
 * PURE core (computeCompliance) over supplied inputs so it is trivially unit-testable;
 * the DB-bound aggregation (loading machines / device_types / CRs / alarm_taxonomy)
 * lives in the router which has db access.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { runConformanceAcrossSeed } from "./conformanceTest";

export interface ComplianceInput {
  /** Each machine's machineType (the equipmentClass it declares). */
  machineTypes: string[];
  /** typeKeys that have at least one PUBLISHED device_types row. */
  publishedTypeKeys: string[];
  /** Conformance results (defaults to the seed sweep). */
  conformanceResults?: { typeKey: string; pass: boolean }[];
  /** CR statuses present (to count pending/in_review). */
  crStatuses?: string[];
  /** Distinct vendors that have at least one alarm mapping. */
  mappedVendors?: string[];
}

export interface ComplianceMetrics {
  machineCount: number;
  machinesMappedToPublished: number;
  /** 0..1 — fraction of machines whose machineType is a published device type. */
  mappedRate: number;
  conformanceTypeCount: number;
  conformancePassCount: number;
  conformancePassRate: number;
  /** typeKeys that FAILED conformance (for the dashboard alert). */
  failingTypes: string[];
  crPendingCount: number;
  alarmVendorCoverage: number;
  /** unmapped machineTypes (present on machines but no published device type). */
  unmappedMachineTypes: string[];
}

/** Pure compliance computation. Fail-safe over partial inputs. */
export function computeCompliance(input: ComplianceInput): ComplianceMetrics {
  const machineTypes = Array.isArray(input.machineTypes) ? input.machineTypes : [];
  const published = new Set((input.publishedTypeKeys ?? []).map((s) => String(s)));
  const machineCount = machineTypes.length;
  let mapped = 0;
  const unmappedSet = new Set<string>();
  for (const mt of machineTypes) {
    if (published.has(mt)) mapped++;
    else unmappedSet.add(mt);
  }

  const conf = input.conformanceResults ?? runConformanceAcrossSeed();
  const conformanceTypeCount = conf.length;
  const passing = conf.filter((c) => c.pass);
  const failingTypes = conf.filter((c) => !c.pass).map((c) => c.typeKey);

  const crStatuses = input.crStatuses ?? [];
  const crPendingCount = crStatuses.filter((s) => s === "pending" || s === "in_review").length;

  const alarmVendorCoverage = new Set((input.mappedVendors ?? []).map((v) => String(v).toLowerCase())).size;

  return {
    machineCount,
    machinesMappedToPublished: mapped,
    mappedRate: machineCount > 0 ? mapped / machineCount : 0,
    conformanceTypeCount,
    conformancePassCount: passing.length,
    conformancePassRate: conformanceTypeCount > 0 ? passing.length / conformanceTypeCount : 0,
    failingTypes,
    crPendingCount,
    alarmVendorCoverage,
    unmappedMachineTypes: Array.from(unmappedSet).sort(),
  };
}
