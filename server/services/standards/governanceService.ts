/**
 * E1-c (doc 16 §10 / §15) — Equipment Standards Board governance workflow.
 * Flag: EQ_GOVERN_ENABLED.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * The change-request lifecycle for the Device Type registry:
 *
 *   submit (pending) → review (in_review) → approve (approved) | reject (rejected)
 *      → on approve: publish() creates a NEW device_types version
 *      → publish requires the conformance gate to PASS
 *      → promotion: none → staging → production
 *
 * BACKWARD-COMPAT RULE (enforced): a publish may only ADD fields (→ minor|patch). If
 * the proposed schema REMOVES or ALTERS the dataType/required of a field that exists
 * in the currently-published version, that is a BREAKING change → it REQUIRES a major
 * bump and is FLAGGED (backwardIncompatible). assessBackwardCompat() computes the
 * minimum required bump; enforcePublish() rejects an under-bumped breaking publish.
 *
 * This module is PURE (no DB): the router/governanceService caller persists the rows;
 * the transition + backward-compat + semver logic lives here and is unit-tested.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { bumpSemver, type DeviceTypeNode } from "./deviceTypeRegistry";
import type { DeviceTypeAttribute } from "../../../drizzle/schema/equipmentStandards";

export type CrStatus = "pending" | "in_review" | "approved" | "rejected" | "published";
export type CrKind = "new_type" | "modify" | "deprecate";
export type SemverBump = "major" | "minor" | "patch";
export type ConformanceGate = "pending" | "pass" | "fail";
export type PromotionStage = "none" | "staging" | "production";

/** Allowed CR status transitions (forward-only, with reject from review/pending). */
const STATUS_TRANSITIONS: Record<CrStatus, CrStatus[]> = {
  pending: ["in_review", "rejected"],
  in_review: ["approved", "rejected"],
  approved: ["published", "rejected"],
  rejected: [],
  published: [],
};

/** True iff `to` is a legal next status from `from`. */
export function canTransitionStatus(from: CrStatus, to: CrStatus): boolean {
  return (STATUS_TRANSITIONS[from] ?? []).includes(to);
}

/** Apply a status transition; returns next status or null (illegal). Fail-safe. */
export function nextStatus(from: CrStatus, to: CrStatus): CrStatus | null {
  return canTransitionStatus(from, to) ? to : null;
}

/** Allowed promotion transitions (forward-only). */
const STAGE_TRANSITIONS: Record<PromotionStage, PromotionStage[]> = {
  none: ["staging"],
  staging: ["production", "none"],
  production: [],
};
export function canPromote(from: PromotionStage, to: PromotionStage): boolean {
  return (STAGE_TRANSITIONS[from] ?? []).includes(to);
}

// ════════════════════════════════════════════════════════════════════════════
// Backward-compatibility analysis (the core governance rule).
// ════════════════════════════════════════════════════════════════════════════

export interface BackwardCompatResult {
  /** The minimum SemVer bump the change requires. */
  requiredBump: SemverBump;
  /** True when the change removes/alters a published field (breaking). */
  breaking: boolean;
  /** Human-readable reasons (added/removed/altered fields). */
  reasons: string[];
}

/**
 * Compare a published attribute set with a proposed one and determine the minimum
 * SemVer bump:
 *   • a field present in published but ABSENT in proposed     → REMOVAL → breaking (major)
 *   • a field whose dataType or required flag CHANGED         → ALTER   → breaking (major)
 *   • a NEW optional field                                    → additive (minor)
 *   • only a NEW required field (no removal/alter)            → additive (minor)
 *   • no field changes (label/description/extension only)     → patch
 *
 * Pure + fail-safe (treats missing arrays as empty).
 */
export function assessBackwardCompat(
  published: DeviceTypeAttribute[] | undefined | null,
  proposed: DeviceTypeAttribute[] | undefined | null,
): BackwardCompatResult {
  const pub = Array.isArray(published) ? published : [];
  const prop = Array.isArray(proposed) ? proposed : [];
  const propByName = new Map(prop.map((a) => [a.name, a]));
  const pubByName = new Map(pub.map((a) => [a.name, a]));
  const reasons: string[] = [];
  let breaking = false;
  let added = false;

  // removals + alterations (breaking)
  for (const p of pub) {
    const np = propByName.get(p.name);
    if (!np) { breaking = true; reasons.push(`removed field '${p.name}'`); continue; }
    if (np.dataType !== p.dataType) { breaking = true; reasons.push(`altered dataType of '${p.name}' (${p.dataType}→${np.dataType})`); }
    // tightening required (optional→required) is breaking for existing consumers
    if (np.required === true && p.required !== true) { breaking = true; reasons.push(`tightened '${p.name}' to required`); }
  }
  // additions (additive)
  for (const np of prop) {
    if (!pubByName.has(np.name)) { added = true; reasons.push(`added field '${np.name}'`); }
  }

  const requiredBump: SemverBump = breaking ? "major" : added ? "minor" : "patch";
  return { requiredBump, breaking, reasons };
}

export interface PublishDecision {
  ok: boolean;
  /** The version the new published row SHOULD carry. */
  newVersion: string;
  requiredBump: SemverBump;
  effectiveBump: SemverBump;
  breaking: boolean;
  reasons: string[];
  /** When !ok, why the publish is rejected. */
  rejection?: string;
}

/**
 * Decide whether a publish may proceed and at what version.
 *
 *   • conformance gate MUST be 'pass' (a 'pending'/'fail' publish is rejected).
 *   • the declared `semverBump` MUST be >= the requiredBump from backward-compat
 *     analysis. A breaking change under-declared as minor|patch is REJECTED (and
 *     flagged). Under-declaring minor as patch is also rejected.
 *
 * Returns the computed newVersion (bumping the current published version).
 */
export function enforcePublish(args: {
  currentVersion: string;
  declaredBump: SemverBump;
  conformance: ConformanceGate;
  publishedAttrs: DeviceTypeAttribute[] | null | undefined;
  proposedAttrs: DeviceTypeAttribute[] | null | undefined;
}): PublishDecision {
  const compat = assessBackwardCompat(args.publishedAttrs, args.proposedAttrs);
  const rank: Record<SemverBump, number> = { patch: 1, minor: 2, major: 3 };
  const effectiveBump = args.declaredBump;
  const base: Omit<PublishDecision, "ok" | "rejection" | "newVersion"> = {
    requiredBump: compat.requiredBump,
    effectiveBump,
    breaking: compat.breaking,
    reasons: compat.reasons,
  };

  if (args.conformance !== "pass") {
    return { ...base, ok: false, newVersion: args.currentVersion, rejection: `conformance gate is '${args.conformance}' (must be 'pass')` };
  }
  if (rank[effectiveBump] < rank[compat.requiredBump]) {
    return {
      ...base, ok: false, newVersion: args.currentVersion,
      rejection: compat.breaking
        ? `breaking change requires a MAJOR bump (declared '${effectiveBump}'): ${compat.reasons.join("; ")}`
        : `change requires at least a '${compat.requiredBump}' bump (declared '${effectiveBump}')`,
    };
  }
  return { ...base, ok: true, newVersion: bumpSemver(args.currentVersion, effectiveBump) };
}

/**
 * Build the new published DeviceTypeNode from an approved CR's proposed schema. Pure.
 * Caller persists it (status 'published', publishedAt now, origin 'manual').
 */
export function buildPublishedNode(args: {
  targetTypeKey: string;
  newVersion: string;
  proposed: {
    parentTypeKey?: string | null;
    label?: string;
    description?: string;
    attributesSchema?: DeviceTypeAttribute[];
    supportedCommands?: DeviceTypeNode["supportedCommands"];
    supportedStates?: DeviceTypeNode["supportedStates"];
    extensionFields?: Record<string, unknown>;
    mappedMachineTypes?: string[];
    adapterKind?: string;
  };
}): DeviceTypeNode {
  const p = args.proposed ?? {};
  return {
    typeKey: args.targetTypeKey,
    parentTypeKey: p.parentTypeKey ?? null,
    version: args.newVersion,
    status: "published",
    label: p.label,
    description: p.description,
    attributesSchema: Array.isArray(p.attributesSchema) ? p.attributesSchema : [],
    supportedCommands: Array.isArray(p.supportedCommands) ? p.supportedCommands : [],
    supportedStates: Array.isArray(p.supportedStates) ? p.supportedStates : [],
    extensionFields: p.extensionFields && typeof p.extensionFields === "object" ? p.extensionFields : {},
    mappedMachineTypes: Array.isArray(p.mappedMachineTypes) ? p.mappedMachineTypes : [],
    adapterKind: p.adapterKind,
  };
}

/**
 * Overlay a CR's proposed schema onto a node set as a PUBLISHED node for its typeKey,
 * so the server can RESOLVE + run conformance on the *merged* proposal (not on a
 * client-attested flag). Pure.
 *
 *   • builds the proposed node via buildPublishedNode (attributes/commands/parent/…);
 *   • if the proposal omits parentTypeKey, KEEP the current node's parent so the
 *     inheritance hierarchy is never silently severed;
 *   • replaces any existing node(s) with the same typeKey by the proposed node.
 */
export function applyProposalToNodes(
  targetTypeKey: string,
  proposed: Record<string, unknown> | null | undefined,
  nodes: DeviceTypeNode[],
): DeviceTypeNode[] {
  const node = buildPublishedNode({ targetTypeKey, newVersion: "1.0.0", proposed: (proposed ?? {}) as never });
  if (node.parentTypeKey == null) {
    const cur = nodes.find((n) => n.typeKey === targetTypeKey);
    node.parentTypeKey = cur?.parentTypeKey ?? null;
  }
  return [...nodes.filter((n) => n.typeKey !== targetTypeKey), node];
}

/** Generate a stable CR key. */
export function generateCrKey(): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `CR-${Date.now()}-${rand}`;
}
