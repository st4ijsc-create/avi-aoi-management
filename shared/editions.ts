/**
 * Edition descriptors — SYNAPSE §4 / ADR-007 "collapsible deployment".
 * (doc 33 §3.1 / F1 · SYNAPSE alignment initiative)
 *
 * ONE codebase → THREE editions with a seamless upgrade path:
 *   • machine  — bundled with a single OEM machine on 1 IPC (single-node, embedded infra)
 *   • line     — a cluster of machines / one production line (line-cluster)
 *   • site     — whole plant, multi-line, HA (site-ha, external infra)
 *
 * This module is the SINGLE SOURCE OF TRUTH for what each edition MAY enable and how
 * big it MAY grow. It is layered ON TOP of [[module-registry]]:
 *   - `module-registry` defines WHAT modules/features/quotas exist (the catalogue).
 *   - the LICENSE decides which of those a given deployment is entitled to.
 *   - the EDITION provides a CEILING (allowed modules) + a CLAMP (quota ceilings) +
 *     an infra default. Effective entitlement = (license ∩ edition ceiling), quotas
 *     clamped down by the edition.
 *
 * IMPORTANT (non-breaking): the DEFAULT edition is `site` (full), so a deployment that
 * sets no EDITION behaves exactly as before. Editions never GRANT beyond the license —
 * they only bound it. Core modules are always allowed in every edition.
 *
 * Pure module: no I/O, no process.env. Consumed by server (deploymentProfile, entitlement)
 * and client (edition badge). Runtime resolution of the current edition lives in
 * server/_core/deploymentProfile.ts.
 */

import { CORE_MODULE_CODES } from "./module-registry";

export type EditionCode = "machine" | "line" | "site";
export type InfraProfile = "embedded" | "external";
export type Topology = "single-node" | "line-cluster" | "site-ha";

export interface EditionDescriptor {
  /** Unique edition code (matches license `edition` field). */
  code: EditionCode;
  /** Display name. */
  name: string;
  /** One-line description. */
  description: string;
  /** Deployment topology hint. */
  topology: Topology;
  /** Default infra profile — `embedded` = in-process broker + local/degraded time-series;
   *  `external` = EMQX cluster + dedicated TimescaleDB. Overridable via INFRA_PROFILE. */
  defaultInfraProfile: InfraProfile;
  /** Module codes this edition MAY enable (ceiling). `"*"` = all modules.
   *  Core modules are ALWAYS allowed regardless of this list. The license still
   *  decides actual enablement WITHIN this ceiling. */
  moduleCeiling: readonly string[] | "*";
  /** Quota ceilings that clamp module-registry `limit` features DOWNWARD for this
   *  edition (feature code → max value). Absent feature = use registry/license value. */
  quotaCeilings: Readonly<Record<string, number>>;
}

/** Default edition when EDITION is unset — `site` keeps full, backward-compatible behavior. */
export const DEFAULT_EDITION: EditionCode = "site";

/**
 * The three editions. `machine` is intentionally lean (OEM "Trojan horse" bundled with a
 * machine); `line` adds orchestration/analytics; `site` is unrestricted.
 */
export const EDITIONS: Readonly<Record<EditionCode, EditionDescriptor>> = {
  machine: {
    code: "machine",
    name: "Machine Edition",
    description:
      "Bán kèm 1 máy tự động hóa (OEM) trên 1 IPC: HMI + thu thập dữ liệu + AI-lite + giám sát/điều khiển cục bộ. Single-node, broker nhúng.",
    topology: "single-node",
    defaultInfraProfile: "embedded",
    // Lean set: monitoring, master-data, production, alerts, local AI, and OT connect/control.
    // Heavy multi-site/analytics/federation modules are excluded (upgrade to Line/Site).
    moduleCeiling: [
      "MOD_MONITORING",
      "MOD_DATA_MANAGEMENT",
      "MOD_PRODUCTION",
      "MOD_ALERTS",
      "MOD_AI",
      "MOD_OT_CONTROL",
    ],
    quotaCeilings: {
      MAX_DEVICE_ADAPTERS: 16,
      MAX_MACHINES: 8,
      MAX_PRODUCTS: 200,
      MAX_PRODUCTION_ORDERS: 500,
      MAX_AI_MODELS: 8,
      MAX_FEDERATION_SITES: 0,
    },
  },
  line: {
    code: "line",
    name: "Line Edition",
    description:
      "Cụm máy / 1 dây chuyền: thêm orchestration, analytics nâng cao, điều phối tài nguyên. 1 server hoặc K3s tại line.",
    topology: "line-cluster",
    defaultInfraProfile: "external",
    moduleCeiling: [
      "MOD_MONITORING",
      "MOD_DATA_MANAGEMENT",
      "MOD_PRODUCTION",
      "MOD_ALERTS",
      "MOD_ANALYTICS",
      "MOD_AI",
      "MOD_OT_CONTROL",
    ],
    quotaCeilings: {
      MAX_DEVICE_ADAPTERS: 64,
      MAX_MACHINES: 40,
      MAX_PRODUCTS: 2000,
      MAX_PRODUCTION_ORDERS: 5000,
      MAX_FEDERATION_SITES: 1,
    },
  },
  site: {
    code: "site",
    name: "Site Edition",
    description:
      "Toàn nhà máy, đa line, đa hãng: digital twin, AI đầy đủ, MES/ERP gateway, multi-site federation. Cụm K8s HA + edge K3s.",
    topology: "site-ha",
    defaultInfraProfile: "external",
    moduleCeiling: "*",
    quotaCeilings: {}, // no downward clamp — registry/license values apply
  },
};

/** All edition codes in upgrade order (machine → line → site). */
export const EDITION_CODES: readonly EditionCode[] = ["machine", "line", "site"];

/** Type guard for an arbitrary string. */
export function isEditionCode(value: string | undefined | null): value is EditionCode {
  return value === "machine" || value === "line" || value === "site";
}

/** Get a descriptor, falling back to the default edition for unknown/undefined input. */
export function getEdition(code: string | undefined | null): EditionDescriptor {
  return isEditionCode(code) ? EDITIONS[code] : EDITIONS[DEFAULT_EDITION];
}

/** List all edition descriptors (upgrade order). */
export function listEditions(): EditionDescriptor[] {
  return EDITION_CODES.map((c) => EDITIONS[c]);
}

/**
 * Is a module allowed to run in an edition? Core modules always are; `"*"` allows all;
 * otherwise the code must be in the edition's ceiling.
 */
export function isModuleAllowedInEdition(code: string | undefined | null, moduleCode: string): boolean {
  if (CORE_MODULE_CODES.includes(moduleCode)) return true;
  const ceiling = getEdition(code).moduleCeiling;
  if (ceiling === "*") return true;
  return ceiling.includes(moduleCode);
}

/**
 * Effective modules for a deployment = (licensed ∪ core) intersected with the edition's
 * ceiling. Editions BOUND the license; they never grant beyond it.
 *
 * @param code           current edition code
 * @param licensedCodes  module codes the license entitles (optional modules)
 * @returns deduped module codes actually usable, preserving `licensedCodes` order then core
 */
export function resolveEditionModules(
  code: string | undefined | null,
  licensedCodes: readonly string[],
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (m: string) => {
    if (!seen.has(m) && isModuleAllowedInEdition(code, m)) {
      seen.add(m);
      out.push(m);
    }
  };
  for (const m of licensedCodes) push(m);
  for (const m of CORE_MODULE_CODES) push(m); // core is always available
  return out;
}

/**
 * Clamp a quota value down to the edition ceiling. If the edition sets no ceiling for the
 * feature, the incoming value is returned unchanged (editions only clamp DOWN).
 */
export function clampQuota(
  code: string | undefined | null,
  featureCode: string,
  value: number,
): number {
  const ceiling = getEdition(code).quotaCeilings[featureCode];
  if (ceiling === undefined) return value;
  return Math.min(value, ceiling);
}
