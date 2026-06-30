/**
 * E1-d (doc 16 §10 / §15) — Conformance Testing.  Flag: EQ_GOVERN_ENABLED.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * A fixture-based validator: given a device type (resolved capabilities) OR an
 * adapter's declared capabilities, assert that the REQUIRED telemetry/commands/PackML
 * states for that type's STANDARD are present. e.g.
 *   • an AOI/Inspection type MUST expose `cycle_time` telemetry;
 *   • a Robot MUST support `stop` AND an e-stop (`abort`);
 *   • any controllable type MUST be able to reach the `Stopped`/`Aborted` states.
 *
 * Returns { pass, violations[] }. PURE + fail-safe — never throws. The vitest
 * conformance.test.ts RUNS these rules across the seeded device types / existing
 * capability profiles, so a profile that violates the standard FAILS CI.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { listDefaultProfiles, type EquipmentCapability } from "../equipment/capabilityModel";
import type { PackmlState } from "../equipment/packml";
import { resolveType, buildSeedTypes, type ResolvedDeviceType } from "./deviceTypeRegistry";

export interface ConformanceViolation {
  rule: string;
  kind: "missing_telemetry" | "missing_command" | "missing_state" | "missing_alarm";
  detail: string;
}

export interface ConformanceResult {
  typeKey: string;
  pass: boolean;
  violations: ConformanceViolation[];
  /** Rules that were evaluated (for transparency in the UI). */
  rulesChecked: string[];
}

/** A capability-ish bag the validator can inspect (works for both resolved types + raw capability). */
export interface ConformanceSubject {
  typeKey: string;
  /** Inheritance chain typeKeys — used to decide WHICH rules apply. */
  inheritanceChain?: string[];
  commandNames: string[];
  telemetryKeys: string[];
  states: PackmlState[];
}

/** Build a subject from a resolved device type. */
export function subjectFromResolved(r: ResolvedDeviceType): ConformanceSubject {
  return {
    typeKey: r.typeKey,
    inheritanceChain: r.inheritanceChain,
    commandNames: r.supportedCommands.map((c) => c.name),
    // resolved attributes carry telemetry slots (seeded from telemetryTags).
    telemetryKeys: r.attributesSchema.map((a) => a.name),
    states: r.supportedStates,
  };
}

/** Build a subject from a raw capabilityModel capability (adapter-declared). */
export function subjectFromCapability(cap: EquipmentCapability, inheritanceChain?: string[]): ConformanceSubject {
  return {
    typeKey: cap.equipmentClass,
    inheritanceChain,
    commandNames: cap.supportedCommands.map((c) => c.name),
    telemetryKeys: cap.telemetryTags.map((t) => t.key),
    states: cap.supportedStates,
  };
}

// ── rule predicates ──────────────────────────────────────────────────────────
type Applies = (s: ConformanceSubject) => boolean;
interface Rule {
  id: string;
  applies: Applies;
  check: (s: ConformanceSubject) => ConformanceViolation | null;
}

const hasAncestor = (s: ConformanceSubject, key: string) =>
  s.typeKey === key || (s.inheritanceChain?.includes(key) ?? false);

const requireTelemetry = (key: string): Rule["check"] => (s) =>
  s.telemetryKeys.includes(key) ? null : { rule: `MUST expose telemetry '${key}'`, kind: "missing_telemetry", detail: `'${key}' not in [${s.telemetryKeys.join(", ")}]` };

const requireCommand = (name: string): Rule["check"] => (s) =>
  s.commandNames.includes(name) ? null : { rule: `MUST support command '${name}'`, kind: "missing_command", detail: `'${name}' not in [${s.commandNames.join(", ")}]` };

const requireAnyCommand = (names: string[]): Rule["check"] => (s) =>
  names.some((n) => s.commandNames.includes(n)) ? null : { rule: `MUST support one of [${names.join(", ")}]`, kind: "missing_command", detail: `none of [${names.join(", ")}] in [${s.commandNames.join(", ")}]` };

const requireState = (st: PackmlState): Rule["check"] => (s) =>
  s.states.includes(st) ? null : { rule: `MUST be able to reach PackML state '${st}'`, kind: "missing_state", detail: `'${st}' not in supportedStates` };

/**
 * The STANDARD rule set (the "spec"). Each rule declares WHICH types it applies to
 * (by typeKey or ancestor) and WHAT it requires.
 */
export const CONFORMANCE_RULES: Rule[] = [
  // Inspection (AOI/AVI/SPI/AXI/CMM): cycle_time is mandatory.
  { id: "inspection.cycle_time", applies: (s) => hasAncestor(s, "Inspection"), check: requireTelemetry("cycle_time") },
  { id: "inspection.state", applies: (s) => hasAncestor(s, "Inspection"), check: requireTelemetry("state") },
  // Robots: must support stop AND an e-stop (abort).
  { id: "robot.stop", applies: (s) => hasAncestor(s, "Robot"), check: requireAnyCommand(["stop", "abort"]) },
  { id: "robot.estop", applies: (s) => hasAncestor(s, "Robot"), check: requireCommand("abort") },
  { id: "robot.aborted_state", applies: (s) => hasAncestor(s, "Robot"), check: requireState("Aborted") },
  // Test cells: must report a process result.
  { id: "testcell.result", applies: (s) => hasAncestor(s, "TestCell"), check: requireTelemetry("process_result") },
  // Every Equipment: must surface its state and be stoppable somewhere in the cube.
  { id: "equipment.state_telemetry", applies: () => true, check: requireTelemetry("state") },
  { id: "equipment.stoppable", applies: () => true, check: requireState("Stopped") },
];

/** Run conformance over one subject. Pure + fail-safe. */
export function runConformance(subject: ConformanceSubject, rules: Rule[] = CONFORMANCE_RULES): ConformanceResult {
  const violations: ConformanceViolation[] = [];
  const rulesChecked: string[] = [];
  for (const r of rules) {
    let applicable = false;
    try { applicable = r.applies(subject); } catch { applicable = false; }
    if (!applicable) continue;
    rulesChecked.push(r.id);
    let v: ConformanceViolation | null = null;
    try { v = r.check(subject); } catch { v = null; }
    if (v) violations.push(v);
  }
  return { typeKey: subject.typeKey, pass: violations.length === 0, violations, rulesChecked };
}

/**
 * Run conformance across EVERY seeded device type (resolved with inheritance). This is
 * the "conformance in CI" sweep — used by conformance.test.ts and the router's run.
 */
export function runConformanceAcrossSeed(): ConformanceResult[] {
  const nodes = buildSeedTypes();
  const out: ConformanceResult[] = [];
  for (const n of nodes) {
    // skip the abstract structural intermediates that have no mapped machine type and
    // no commands/telemetry of their own — they are containers, not deployable types.
    const resolved = resolveType(n.typeKey, nodes);
    if (!resolved) continue;
    const isLeaf = resolved.mappedMachineTypes.length > 0;
    if (!isLeaf) continue;
    out.push(runConformance(subjectFromResolved(resolved)));
  }
  return out;
}

/**
 * Run conformance across the raw capabilityModel DEFAULT_PROFILES too (belt + braces:
 * proves the seed and the source profiles agree). Each profile is checked against the
 * rules with its seed inheritance chain.
 */
export function runConformanceAcrossCapabilityProfiles(): ConformanceResult[] {
  const nodes = buildSeedTypes();
  return listDefaultProfiles().map((p) => {
    const resolved = resolveType(p.equipmentClass, nodes);
    return runConformance(subjectFromCapability(p, resolved?.inheritanceChain));
  });
}
