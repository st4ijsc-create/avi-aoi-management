/**
 * U4b (doc 21 §6 / G-8) — data-driven programming-adapter registry regression + proof.
 *
 * Proves the register-and-go refactor is BEHAVIOUR-PRESERVING:
 *   • every IMPLEMENTED programming kind resolves through the registry IDENTICALLY;
 *   • a PLANNED kind (gcode) still throws the honest "not yet implemented" error;
 *   • an unknown kind still throws "Unknown";
 *   • a NEWLY registered test kind resolves WITHOUT any core switch edit.
 */
import { describe, it, expect, afterEach } from "vitest";

import {
  programmingRegistry,
  registerProgrammingAdapter,
  StubProgrammingAdapter,
  PROGRAMMING_KINDS,
  type ProgrammingKind,
  type ProgrammingAdapter,
} from "./programmingAdapter";

// The IMPLEMENTED kinds (parity oracle == the OLD build() switch branches).
const IMPLEMENTED: ProgrammingKind[] = [
  "stub",
  "zmotion-basic",
  "mitsubishi-engineering",
  "robot-tm",
  "iec61131-st",
  "iec61131-ld",
  "ir-flow",
];

describe("U4b — programming adapter registry (parity)", () => {
  afterEach(() => programmingRegistry._clear());

  it("every implemented kind resolves through the registry with the right kind tag", () => {
    for (const kind of IMPLEMENTED) {
      const a = programmingRegistry.getAdapter(kind);
      expect(a.kind).toBe(kind);
      expect(programmingRegistry.isImplemented(kind)).toBe(true);
    }
    // The register-and-go view lists exactly the implemented kinds.
    expect([...programmingRegistry.listRegisteredKinds()].sort()).toEqual([...IMPLEMENTED].sort());
  });

  it("planned kind (gcode) still throws the honest 'not yet implemented' error", () => {
    expect(PROGRAMMING_KINDS).toContain("gcode");
    expect(programmingRegistry.isImplemented("gcode")).toBe(false);
    expect(() => programmingRegistry.getAdapter("gcode")).toThrow(/not yet implemented/);
  });

  it("unknown kind still throws 'Unknown'", () => {
    expect(() => programmingRegistry.getAdapter("nope" as ProgrammingKind)).toThrow(/Unknown/);
  });

  it("getAdapter memoises (same instance) across calls", () => {
    expect(programmingRegistry.getAdapter("stub")).toBe(programmingRegistry.getAdapter("stub"));
    expect(programmingRegistry.getAdapter("stub")).toBeInstanceOf(StubProgrammingAdapter);
  });

  it("register-and-go: a NEW kind resolves WITHOUT editing the build() switch", () => {
    const NEW_KIND = "test-lang-y" as ProgrammingKind;
    const adapter: ProgrammingAdapter = {
      kind: NEW_KIND,
      capabilities: {
        canCompile: true,
        canSimulate: false,
        canDownload: false,
        canUpload: false,
        canOnlineMonitor: false,
        canForce: false,
        canTeach: false,
        languages: ["test"],
      },
      async validate() {
        return { ok: true, diagnostics: [] };
      },
      async compile() {
        return { ok: true, diagnostics: [] };
      },
      async deploy() {
        return { ok: true, status: "simulated", simulated: true };
      },
    };
    registerProgrammingAdapter(NEW_KIND, () => adapter);
    const resolved = programmingRegistry.getAdapter(NEW_KIND);
    expect(resolved).toBe(adapter);
    expect(resolved.kind).toBe(NEW_KIND);
    expect(programmingRegistry.isImplemented(NEW_KIND)).toBe(true);
    expect(programmingRegistry.listRegisteredKinds()).toContain(NEW_KIND);
  });
});
