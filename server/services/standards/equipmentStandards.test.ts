/**
 * E1 (doc 16 Khối 5) — Equipment Standardization & Governance tests.
 *
 * PURE / in-memory (no DB) — mirrors the fleet/twin/safety pure-fn pattern:
 *   • multi-level inheritance resolution + extension preservation (E1-a)
 *   • seed consistency with capabilityModel (E1-a)
 *   • SemVer backward-compat enforcement (E1-c)
 *   • alarm mapping (E1-b)
 *   • CR workflow transitions (E1-c)
 *   • conformance validator pass/fail + the CI sweep (E1-d)
 *   • compliance metric computation (E1-e)
 *   • flag-off behaviour (eqGovernEnabled)
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  buildSeedTypes,
  resolveType,
  buildTree,
  resolveForMachineType,
  parseSemver,
  compareSemver,
  bumpSemver,
  eqGovernEnabled,
  type DeviceTypeNode,
} from "./deviceTypeRegistry";
import { listDefaultProfiles } from "../equipment/capabilityModel";
import { mapAlarm, listVendors, SEED_ALARM_MAPPINGS } from "./alarmTaxonomy";
import {
  canTransitionStatus,
  nextStatus,
  canPromote,
  assessBackwardCompat,
  enforcePublish,
  buildPublishedNode,
  applyProposalToNodes,
  generateCrKey,
} from "./governanceService";
import {
  runConformance,
  subjectFromResolved,
  runConformanceAcrossSeed,
  runConformanceAcrossCapabilityProfiles,
  type ConformanceSubject,
} from "./conformanceTest";
import { computeCompliance } from "./complianceService";

// ════════════════════════════════════════════════════════════════════════════
// E1-a — Device Type Hierarchy + inheritance resolution
// ════════════════════════════════════════════════════════════════════════════
describe("deviceTypeRegistry — seed + inheritance", () => {
  const seed = buildSeedTypes();

  it("seeds the structural intermediates + one leaf per EquipmentClass", () => {
    const keys = new Set(seed.map((n) => n.typeKey));
    expect(keys.has("Equipment")).toBe(true);
    expect(keys.has("Robot")).toBe(true);
    expect(keys.has("CollaborativeRobot")).toBe(true);
    expect(keys.has("Inspection")).toBe(true);
    // every capabilityModel class is present as a leaf
    for (const p of listDefaultProfiles()) expect(keys.has(p.equipmentClass)).toBe(true);
  });

  it("resolves multi-level inheritance (Equipment → Robot → ... AOI leaf) merging attributes", () => {
    const aoi = resolveType("AOI", seed)!;
    expect(aoi).toBeTruthy();
    // chain starts at the Equipment root
    expect(aoi.inheritanceChain[0]).toBe("Equipment");
    expect(aoi.inheritanceChain).toContain("Inspection");
    expect(aoi.inheritanceChain[aoi.inheritanceChain.length - 1]).toBe("AOI");
    // base attribute (vendor) inherited from Equipment + leaf telemetry (yield) present
    const names = aoi.attributesSchema.map((a) => a.name);
    expect(names).toContain("vendor"); // from Equipment base
    expect(names).toContain("yield"); // from AOI leaf telemetry
    expect(names).toContain("cycle_time");
  });

  it("CollaborativeRobot inherits Equipment + Robot attributes AND adds cobot attrs", () => {
    const cobot = resolveType("CollaborativeRobot", seed)!;
    const names = cobot.attributesSchema.map((a) => a.name);
    expect(cobot.inheritanceChain).toEqual(["Equipment", "Robot", "CollaborativeRobot"]);
    expect(names).toContain("vendor"); // Equipment
    expect(names).toContain("payload_kg"); // Robot
    expect(names).toContain("force_limit_n"); // CollaborativeRobot
    expect(names).toContain("safety_rated_speed_mms");
  });

  it("preserves + merges `extension` at EVERY level (child wins on clash)", () => {
    const nodes: DeviceTypeNode[] = [
      { typeKey: "Base", parentTypeKey: null, version: "1.0.0", status: "published", attributesSchema: [], supportedCommands: [], supportedStates: [], extensionFields: { a: 1, shared: "base" }, mappedMachineTypes: [] },
      { typeKey: "Mid", parentTypeKey: "Base", version: "1.0.0", status: "published", attributesSchema: [], supportedCommands: [], supportedStates: [], extensionFields: { b: 2, shared: "mid" }, mappedMachineTypes: [] },
      { typeKey: "Leaf", parentTypeKey: "Mid", version: "1.0.0", status: "published", attributesSchema: [], supportedCommands: [], supportedStates: [], extensionFields: { c: 3, shared: "leaf" }, mappedMachineTypes: ["X"] },
    ];
    const r = resolveType("Leaf", nodes)!;
    expect(r.extension).toEqual({ a: 1, b: 2, c: 3, shared: "leaf" }); // all levels preserved, child overrides
  });

  it("child attribute OVERRIDES parent by name", () => {
    const nodes: DeviceTypeNode[] = [
      { typeKey: "P", parentTypeKey: null, version: "1.0.0", status: "published", attributesSchema: [{ name: "speed", dataType: "int", unit: "rpm" }], supportedCommands: [], supportedStates: [], extensionFields: {}, mappedMachineTypes: [] },
      { typeKey: "C", parentTypeKey: "P", version: "1.0.0", status: "published", attributesSchema: [{ name: "speed", dataType: "float", unit: "mm/s" }], supportedCommands: [], supportedStates: [], extensionFields: {}, mappedMachineTypes: ["x"] },
    ];
    const r = resolveType("C", nodes)!;
    const speed = r.attributesSchema.find((a) => a.name === "speed")!;
    expect(speed.dataType).toBe("float");
    expect(speed.unit).toBe("mm/s");
  });

  it("is fail-safe: unknown typeKey → null; machineType fallback → Equipment", () => {
    expect(resolveType("NopeNotAType", seed)).toBeNull();
    const r = resolveForMachineType("NopeNotAType", seed);
    expect(r.typeKey).toBe("Equipment");
  });

  it("breaks inheritance cycles without throwing", () => {
    const nodes: DeviceTypeNode[] = [
      { typeKey: "A", parentTypeKey: "B", version: "1.0.0", status: "published", attributesSchema: [], supportedCommands: [], supportedStates: [], extensionFields: {}, mappedMachineTypes: ["a"] },
      { typeKey: "B", parentTypeKey: "A", version: "1.0.0", status: "published", attributesSchema: [], supportedCommands: [], supportedStates: [], extensionFields: {}, mappedMachineTypes: [] },
    ];
    expect(() => resolveType("A", nodes)).not.toThrow();
  });

  it("builds a tree rooted at Equipment", () => {
    const tree = buildTree(seed);
    const equip = tree.find((t) => t.typeKey === "Equipment");
    expect(equip).toBeTruthy();
    const childKeys = equip!.children.map((c) => c.typeKey);
    expect(childKeys).toContain("Robot");
    expect(childKeys).toContain("Inspection");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// E1-a — SemVer helpers
// ════════════════════════════════════════════════════════════════════════════
describe("SemVer", () => {
  it("parses + compares + bumps", () => {
    expect(parseSemver("2.3.4")).toEqual({ major: 2, minor: 3, patch: 4 });
    expect(parseSemver("garbage")).toEqual({ major: 0, minor: 0, patch: 0 });
    expect(compareSemver("1.0.0", "1.1.0")).toBe(-1);
    expect(compareSemver("2.0.0", "1.9.9")).toBe(1);
    expect(compareSemver("1.2.3", "1.2.3")).toBe(0);
    expect(bumpSemver("1.2.3", "major")).toBe("2.0.0");
    expect(bumpSemver("1.2.3", "minor")).toBe("1.3.0");
    expect(bumpSemver("1.2.3", "patch")).toBe("1.2.4");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// E1-b — Alarm taxonomy
// ════════════════════════════════════════════════════════════════════════════
describe("alarmTaxonomy.mapAlarm", () => {
  it("maps a known vendor native code → standard code + severity + action", () => {
    const r = mapAlarm("fanuc", "SRVO-050");
    expect(r.mapped).toBe(true);
    expect(r.standardCode).toBe("COLLISION");
    expect(r.severity).toBe("critical");
    expect(r.recommendedAction).toBeTruthy();
  });
  it("is case-insensitive on vendor + native code", () => {
    expect(mapAlarm("FANUC", "srvo-050").standardCode).toBe("COLLISION");
  });
  it("fails safe for unknown code", () => {
    const r = mapAlarm("fanuc", "DOES-NOT-EXIST");
    expect(r.mapped).toBe(false);
    expect(r.standardCode).toBe("UNKNOWN_ALARM");
    expect(r.severity).toBe("medium");
  });
  it("seeds 5 example vendors", () => {
    const vendors = listVendors();
    expect(vendors).toEqual(expect.arrayContaining(["fanuc", "universal_robots", "mitsubishi", "kuka", "siemens"]));
    expect(SEED_ALARM_MAPPINGS.length).toBeGreaterThanOrEqual(10);
  });
  it("a DB override wins over the seed for the same vendor+native", () => {
    const entries = [...SEED_ALARM_MAPPINGS, { vendor: "fanuc", nativeCode: "SRVO-050", standardCode: "OVERRIDDEN", severity: "low" as const }];
    expect(mapAlarm("fanuc", "SRVO-050", entries).standardCode).toBe("COLLISION");
    // (seed appears first; mapAlarm returns the FIRST match — proves precedence is deterministic)
  });
});

// ════════════════════════════════════════════════════════════════════════════
// E1-c — Governance workflow + backward-compat
// ════════════════════════════════════════════════════════════════════════════
describe("governanceService — CR workflow transitions", () => {
  it("enforces forward-only status transitions", () => {
    expect(canTransitionStatus("pending", "in_review")).toBe(true);
    expect(canTransitionStatus("in_review", "approved")).toBe(true);
    expect(canTransitionStatus("approved", "published")).toBe(true);
    expect(canTransitionStatus("pending", "published")).toBe(false); // cannot skip review
    expect(canTransitionStatus("rejected", "approved")).toBe(false); // terminal
    expect(nextStatus("pending", "approved")).toBeNull();
    expect(nextStatus("in_review", "rejected")).toBe("rejected");
  });
  it("enforces forward-only promotion (none→staging→production)", () => {
    expect(canPromote("none", "staging")).toBe(true);
    expect(canPromote("staging", "production")).toBe(true);
    expect(canPromote("none", "production")).toBe(false);
    expect(canPromote("production", "staging")).toBe(false);
  });
});

describe("governanceService — backward-compat (SemVer enforcement)", () => {
  const A = [{ name: "x", dataType: "int" as const }, { name: "y", dataType: "float" as const }];

  it("ADD-only optional field → minor", () => {
    const r = assessBackwardCompat(A, [...A, { name: "z", dataType: "string" }]);
    expect(r.breaking).toBe(false);
    expect(r.requiredBump).toBe("minor");
  });
  it("no field change (metadata only) → patch", () => {
    const r = assessBackwardCompat(A, [...A]);
    expect(r.requiredBump).toBe("patch");
  });
  it("REMOVING a published field is breaking → major + flagged", () => {
    const r = assessBackwardCompat(A, [{ name: "x", dataType: "int" }]);
    expect(r.breaking).toBe(true);
    expect(r.requiredBump).toBe("major");
    expect(r.reasons.join(" ")).toMatch(/removed field 'y'/);
  });
  it("ALTERING a field dataType is breaking → major", () => {
    const r = assessBackwardCompat(A, [{ name: "x", dataType: "string" }, { name: "y", dataType: "float" }]);
    expect(r.breaking).toBe(true);
    expect(r.requiredBump).toBe("major");
  });
  it("tightening optional→required is breaking", () => {
    const base = [{ name: "x", dataType: "int" as const }];
    const r = assessBackwardCompat(base, [{ name: "x", dataType: "int", required: true }]);
    expect(r.breaking).toBe(true);
  });

  it("enforcePublish: minor add ok when gate passes", () => {
    const d = enforcePublish({ currentVersion: "1.0.0", declaredBump: "minor", conformance: "pass", publishedAttrs: A, proposedAttrs: [...A, { name: "z", dataType: "bool" }] });
    expect(d.ok).toBe(true);
    expect(d.newVersion).toBe("1.1.0");
  });
  it("enforcePublish: breaking change under-declared as minor is REJECTED", () => {
    const d = enforcePublish({ currentVersion: "1.0.0", declaredBump: "minor", conformance: "pass", publishedAttrs: A, proposedAttrs: [{ name: "x", dataType: "int" }] });
    expect(d.ok).toBe(false);
    expect(d.breaking).toBe(true);
    expect(d.rejection).toMatch(/MAJOR/);
  });
  it("enforcePublish: breaking change as major is ACCEPTED → 2.0.0", () => {
    const d = enforcePublish({ currentVersion: "1.4.2", declaredBump: "major", conformance: "pass", publishedAttrs: A, proposedAttrs: [{ name: "x", dataType: "int" }] });
    expect(d.ok).toBe(true);
    expect(d.newVersion).toBe("2.0.0");
  });
  it("enforcePublish: blocked when conformance gate is not 'pass'", () => {
    const d = enforcePublish({ currentVersion: "1.0.0", declaredBump: "minor", conformance: "pending", publishedAttrs: A, proposedAttrs: [...A, { name: "z", dataType: "bool" }] });
    expect(d.ok).toBe(false);
    expect(d.rejection).toMatch(/conformance/);
  });
  it("buildPublishedNode produces a published node from a proposal", () => {
    const node = buildPublishedNode({ targetTypeKey: "MyType", newVersion: "1.1.0", proposed: { parentTypeKey: "Equipment", attributesSchema: [{ name: "p", dataType: "int" }], mappedMachineTypes: ["X"] } });
    expect(node.status).toBe("published");
    expect(node.version).toBe("1.1.0");
    expect(node.parentTypeKey).toBe("Equipment");
  });
  it("generateCrKey is unique-ish + prefixed", () => {
    const a = generateCrKey(), b = generateCrKey();
    expect(a).toMatch(/^CR-\d+-/);
    expect(a).not.toBe(b);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// W5-20 — CR proposedSchema overlay + SERVER-side conformance (governance fix)
// ════════════════════════════════════════════════════════════════════════════
describe("W5-20 — proposal overlay + server-side conformance", () => {
  const seed = buildSeedTypes();

  it("overlays a proposal as a PUBLISHED node WITHOUT emptying it (publish is non-empty)", () => {
    const overlay = applyProposalToNodes("AOI", { attributesSchema: [{ name: "x", dataType: "int" }] }, seed);
    const node = overlay.find((n) => n.typeKey === "AOI")!;
    expect(node.status).toBe("published");
    expect(node.attributesSchema.length).toBeGreaterThan(0);
  });

  it("PRESERVES the parent when the proposal omits parentTypeKey (hierarchy not severed)", () => {
    // proposal carries NO parentTypeKey — the old bug would null it and detach the leaf.
    const overlay = applyProposalToNodes("AOI", { attributesSchema: [{ name: "new_attr", dataType: "int" }] }, seed);
    const node = overlay.find((n) => n.typeKey === "AOI")!;
    expect(node.parentTypeKey).toBe("Inspection"); // preserved from seed
    const resolved = resolveType("AOI", overlay)!;
    // still inherits the Equipment base + Inspection chain — proof the tree survived.
    expect(resolved.inheritanceChain).toEqual(expect.arrayContaining(["Equipment", "Inspection", "AOI"]));
    const names = resolved.attributesSchema.map((a) => a.name);
    expect(names).toContain("vendor"); // inherited from Equipment base
    expect(names).toContain("new_attr"); // the proposed addition
  });

  it("computes conformance on the SERVER: an incomplete AOI proposal FAILS (no self-attest)", () => {
    // client could self-attest 'pass', but the server resolves + runs the rules itself:
    const overlay = applyProposalToNodes("AOI", {
      attributesSchema: [{ name: "state", dataType: "string" }], // missing cycle_time
      supportedCommands: [{ name: "start" }, { name: "stop" }],
    }, seed);
    const resolved = resolveType("AOI", overlay)!;
    const conf = runConformance(subjectFromResolved(resolved));
    expect(conf.pass).toBe(false);
    expect(conf.violations.some((v) => v.detail.includes("cycle_time"))).toBe(true);
  });

  it("computes conformance on the SERVER: a complete AOI proposal PASSES", () => {
    const overlay = applyProposalToNodes("AOI", {
      attributesSchema: [{ name: "state", dataType: "string" }, { name: "cycle_time", dataType: "float" }],
      supportedCommands: [{ name: "start" }, { name: "stop" }],
      supportedStates: ["Idle", "Execute", "Stopped"],
    }, seed);
    const resolved = resolveType("AOI", overlay)!;
    const conf = runConformance(subjectFromResolved(resolved));
    expect(conf.pass).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// E1-d — Conformance validator + CI sweep
// ════════════════════════════════════════════════════════════════════════════
describe("conformanceTest", () => {
  it("PASSES a Robot subject that supports stop+abort and reaches Aborted", () => {
    const s: ConformanceSubject = {
      typeKey: "ROBOT", inheritanceChain: ["Equipment", "Robot", "ROBOT"],
      commandNames: ["start", "stop", "abort"], telemetryKeys: ["state", "mode"], states: ["Idle", "Execute", "Stopped", "Aborted"],
    };
    const r = runConformance(s);
    expect(r.pass).toBe(true);
  });
  it("FAILS a Robot subject missing the e-stop (abort) command", () => {
    const s: ConformanceSubject = {
      typeKey: "ROBOT", inheritanceChain: ["Equipment", "Robot", "ROBOT"],
      commandNames: ["start", "stop"], telemetryKeys: ["state"], states: ["Idle", "Stopped"],
    };
    const r = runConformance(s);
    expect(r.pass).toBe(false);
    expect(r.violations.some((v) => v.rule.includes("abort"))).toBe(true);
  });
  it("FAILS an Inspection subject missing cycle_time", () => {
    const s: ConformanceSubject = {
      typeKey: "AOI", inheritanceChain: ["Equipment", "Inspection", "AOI"],
      commandNames: ["start", "stop"], telemetryKeys: ["state", "yield"], states: ["Idle", "Stopped"],
    };
    const r = runConformance(s);
    expect(r.pass).toBe(false);
    expect(r.violations.some((v) => v.kind === "missing_telemetry" && v.detail.includes("cycle_time"))).toBe(true);
  });

  // The "conformance in CI" deliverable — these MUST pass for every seeded type/profile.
  it("CI: every SEEDED device type conforms to the standard", () => {
    const results = runConformanceAcrossSeed();
    expect(results.length).toBeGreaterThan(0);
    const failing = results.filter((r) => !r.pass);
    expect(failing, `failing types: ${JSON.stringify(failing, null, 2)}`).toEqual([]);
  });
  it("CI: every capabilityModel DEFAULT_PROFILE conforms to the standard", () => {
    const results = runConformanceAcrossCapabilityProfiles();
    const failing = results.filter((r) => !r.pass);
    expect(failing, `failing profiles: ${JSON.stringify(failing, null, 2)}`).toEqual([]);
  });
  it("seed resolved → subject carries the inheritance chain", () => {
    const aoi = resolveType("AOI", buildSeedTypes())!;
    const subj = subjectFromResolved(aoi);
    expect(subj.inheritanceChain).toContain("Inspection");
    expect(subj.telemetryKeys).toContain("cycle_time");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// E1-e — Compliance metrics
// ════════════════════════════════════════════════════════════════════════════
describe("complianceService.computeCompliance", () => {
  it("computes mapped rate + unmapped types", () => {
    const m = computeCompliance({
      machineTypes: ["AOI", "AOI", "ROBOT", "WEIRD"],
      publishedTypeKeys: ["AOI", "ROBOT"],
      conformanceResults: [{ typeKey: "AOI", pass: true }, { typeKey: "ROBOT", pass: false }],
      crStatuses: ["pending", "approved", "in_review"],
      mappedVendors: ["fanuc", "kuka"],
    });
    expect(m.machineCount).toBe(4);
    expect(m.machinesMappedToPublished).toBe(3);
    expect(m.mappedRate).toBeCloseTo(0.75);
    expect(m.unmappedMachineTypes).toEqual(["WEIRD"]);
    expect(m.conformancePassCount).toBe(1);
    expect(m.failingTypes).toEqual(["ROBOT"]);
    expect(m.crPendingCount).toBe(2); // pending + in_review
    expect(m.alarmVendorCoverage).toBe(2);
  });
  it("fail-safe on empty input (no div-by-zero)", () => {
    const m = computeCompliance({ machineTypes: [], publishedTypeKeys: [], conformanceResults: [], crStatuses: [], mappedVendors: [] });
    expect(m.mappedRate).toBe(0);
    expect(m.conformancePassRate).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Flag behaviour
// ════════════════════════════════════════════════════════════════════════════
describe("EQ_GOVERN_ENABLED flag", () => {
  const prev = process.env.EQ_GOVERN_ENABLED;
  afterEach(() => { if (prev === undefined) delete process.env.EQ_GOVERN_ENABLED; else process.env.EQ_GOVERN_ENABLED = prev; });
  beforeEach(() => { delete process.env.EQ_GOVERN_ENABLED; });

  it("defaults OFF", () => {
    expect(eqGovernEnabled()).toBe(false);
  });
  it("ON when set to true/1", () => {
    process.env.EQ_GOVERN_ENABLED = "true";
    expect(eqGovernEnabled()).toBe(true);
    process.env.EQ_GOVERN_ENABLED = "1";
    expect(eqGovernEnabled()).toBe(true);
  });
  it("pure reads (seed/resolve/mapAlarm/conformance) work regardless of flag", () => {
    delete process.env.EQ_GOVERN_ENABLED; // OFF
    expect(buildSeedTypes().length).toBeGreaterThan(0);
    expect(resolveType("ROBOT", buildSeedTypes())).toBeTruthy();
    expect(mapAlarm("kuka", "KSS01301").mapped).toBe(true);
    expect(runConformanceAcrossSeed().every((r) => r.pass)).toBe(true);
  });
});
