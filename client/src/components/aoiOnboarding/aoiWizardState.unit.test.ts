/**
 * W2-D — pure-logic tests for the AOI wizard draft serialization
 * (client/src/components/aoiOnboarding/types.ts).
 *
 * Invariants:
 *   • buildSnapshot NEVER emits the plaintext API key (only keyPrefix).
 *   • buildSnapshot ↔ applySnapshot round-trips the resumable state.
 *   • hot-folder config is only emitted in hot-folder mode with a watchPath.
 *
 * (No *.test.tsx component-test convention exists in this repo — client tests
 * are node-env *.unit.test.ts logic tests, per vitest.config.ts include list.)
 */
import { describe, it, expect } from "vitest";
import {
  buildSnapshot,
  applySnapshot,
  initialAoiWizardState,
  type AoiWizardState,
} from "./types";

const filled: AoiWizardState = {
  ...initialAoiWizardState,
  machineId: 5,
  machineCode: "AOI-05",
  machineName: "AOI line 5",
  machineHasApiKey: true,
  adapterKey: "generic-json",
  adapterLabel: "Generic JSON",
  ingestionMode: "hot-folder",
  hotFolder: {
    watchPath: "D:\\aoi\\export",
    filePattern: "*.csv",
    archivePath: "D:\\aoi\\archive",
    errorPath: "",
  },
  dryRunPassed: true,
  dryRunSummary: {
    serialNumber: "SN-9",
    overallResult: "OK",
    measurementCount: 12,
    warnings: [],
  },
  overrideReason: "",
  keyIssued: true,
  keyPrefix: "mach_ab12c",
  plaintextKey: "mach_SUPER_SECRET_VALUE",
  signedOff: false,
};

describe("buildSnapshot", () => {
  it("never leaks the plaintext key — only the display prefix", () => {
    const snap = buildSnapshot(filled, 4);
    expect(JSON.stringify(snap)).not.toContain("SUPER_SECRET");
    expect(snap.credential?.keyPrefix).toBe("mach_ab12c");
    expect((snap.credential as any)?.plaintextKey).toBeUndefined();
  });

  it("serializes vendor / ingestion / dry-run for the resumable draft", () => {
    const snap = buildSnapshot(filled, 3);
    expect(snap.step).toBe(3);
    expect(snap.vendor).toEqual({ adapterKey: "generic-json", label: "Generic JSON" });
    expect(snap.ingestion?.mode).toBe("hot-folder");
    expect(snap.ingestion?.hotFolder?.watchPath).toBe("D:\\aoi\\export");
    expect(snap.ingestion?.hotFolder?.errorPath).toBeUndefined(); // empty → omitted
    expect(snap.dryRun?.passed).toBe(true);
  });

  it("omits the hot-folder block for http-push mode and empty watchPath", () => {
    const httpSnap = buildSnapshot({ ...filled, ingestionMode: "http-push" }, 1);
    expect(httpSnap.ingestion?.mode).toBe("http-push");
    expect(httpSnap.ingestion?.hotFolder).toBeUndefined();

    const noPath = buildSnapshot(
      { ...filled, hotFolder: { ...filled.hotFolder, watchPath: "" } },
      1,
    );
    expect(noPath.ingestion?.hotFolder).toBeUndefined();
  });

  it("omits vendor/dryRun/credential blocks when nothing was entered yet", () => {
    const snap = buildSnapshot({ ...initialAoiWizardState, machineId: 1 }, 0);
    expect(snap.vendor).toBeUndefined();
    expect(snap.dryRun).toBeUndefined();
    expect(snap.credential).toBeUndefined();
  });
});

describe("applySnapshot (resume)", () => {
  it("round-trips the wizard state (minus in-memory-only secrets)", () => {
    const snap = buildSnapshot(filled, 4);
    const patch = applySnapshot(snap);
    expect(patch.adapterKey).toBe("generic-json");
    expect(patch.adapterLabel).toBe("Generic JSON");
    expect(patch.ingestionMode).toBe("hot-folder");
    expect(patch.hotFolder?.watchPath).toBe("D:\\aoi\\export");
    expect(patch.hotFolder?.filePattern).toBe("*.csv");
    expect(patch.dryRunPassed).toBe(true);
    expect(patch.keyIssued).toBe(true);
    expect(patch.keyPrefix).toBe("mach_ab12c");
    // the plaintext key is gone by design — resume can only show the prefix
    expect((patch as any).plaintextKey).toBeUndefined();
  });

  it("fills sensible defaults for a partial snapshot", () => {
    const patch = applySnapshot({ ingestion: { mode: "hot-folder", hotFolder: { watchPath: "/x" } } });
    expect(patch.hotFolder?.filePattern).toBe("*.{csv,xml,json}");
    expect(patch.hotFolder?.archivePath).toBe("");
  });
});
