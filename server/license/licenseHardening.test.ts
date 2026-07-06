/**
 * Licensing hardening tests — SYNAPSE §4.3 (doc 33 F4 · P2).
 * Never-stop-production policy · Ed25519 verify · TPM fingerprint · device metering.
 */
import { describe, it, expect } from "vitest";

import {
  isProductionCritical,
  neverStopProduction,
  isProcedureAllowed,
  decideLicenseBatch,
  type LicenseState,
} from "./licensePolicy";
import {
  generateEd25519Keypair,
  signLicenseEd25519,
  verifyLicenseEd25519,
  deriveFingerprint,
  canonicalClaims,
} from "./ed25519License";
import { computeDeviceUsage, usageReportLine, type MeteredDevice } from "./deviceMetering";

const alwaysAllowed = (p: string) => p === "auth.me" || p === "license.activate";

describe("licensePolicy — never stop production (SYNAPSE §4.3)", () => {
  it("production-critical namespaces are recognized", () => {
    expect(isProductionCritical("inspection.record")).toBe(true);
    expect(isProductionCritical("productionSession.start")).toBe(true);
    expect(isProductionCritical("andon.raise")).toBe(true);
    expect(isProductionCritical("safety.logEvent")).toBe(true);
    expect(isProductionCritical("admin.deleteUser")).toBe(false);
    expect(isProductionCritical("settings.upsert")).toBe(false);
  });

  it("MIXED namespaces: runtime verbs stay critical, config/authoring verbs do NOT (bypass fix)", () => {
    // genuine runtime execution keeps the line running even on a lapsed license
    expect(isProductionCritical("robot.sendCommand")).toBe(true);
    expect(isProductionCritical("equipment.reportStatus")).toBe(true);
    // config/authoring mutations are NOT never-stop → they wait for renewal (commercial lever)
    for (const p of [
      "robot.create", "robot.update", "robot.setEnabled",
      "inspectionProgram.createDraft", "inspectionProgram.submit", "inspectionProgram.approve",
      "inspectionProgram.release", "field.registerDiscovered", "equipment.create",
    ]) {
      expect(isProductionCritical(p)).toBe(false);
    }
  });

  it("locked/no_license blocks premium config in MIXED namespaces but never blocks runtime exec", () => {
    for (const state of ["locked", "no_license"] as LicenseState[]) {
      expect(isProcedureAllowed({ procedure: "robot.create", method: "POST", state, alwaysAllowed })).toBe(false);
      expect(isProcedureAllowed({ procedure: "inspectionProgram.approve", method: "POST", state, alwaysAllowed })).toBe(false);
      // runtime execution still never halts
      expect(isProcedureAllowed({ procedure: "robot.sendCommand", method: "POST", state, alwaysAllowed })).toBe(true);
    }
  });

  it("neverStopProduction defaults TRUE, false only when explicitly disabled", () => {
    expect(neverStopProduction({})).toBe(true);
    expect(neverStopProduction({ LICENSE_NEVER_STOP_PRODUCTION: "false" })).toBe(false);
    expect(neverStopProduction({ LICENSE_NEVER_STOP_PRODUCTION: "true" })).toBe(true);
  });

  it("production-critical POST passes in EVERY state (the line never halts)", () => {
    for (const state of ["readonly", "locked", "no_license"] as LicenseState[]) {
      expect(
        isProcedureAllowed({ procedure: "inspection.record", method: "POST", state, alwaysAllowed }),
      ).toBe(true);
    }
  });

  it("non-critical mutation is blocked when readonly, but its query passes", () => {
    expect(
      isProcedureAllowed({ procedure: "settings.upsert", method: "POST", state: "readonly", alwaysAllowed }),
    ).toBe(false);
    expect(
      isProcedureAllowed({ procedure: "settings.get", method: "GET", state: "readonly", alwaysAllowed }),
    ).toBe(true);
  });

  it("locked DEGRADES to readonly for non-critical when never-stop is on (default)", () => {
    // never-stop ON: locked → readonly semantics → non-critical GET ok, POST blocked
    expect(
      isProcedureAllowed({ procedure: "settings.get", method: "GET", state: "locked", alwaysAllowed, neverStop: true }),
    ).toBe(true);
    expect(
      isProcedureAllowed({ procedure: "settings.upsert", method: "POST", state: "locked", alwaysAllowed, neverStop: true }),
    ).toBe(false);
    // never-stop OFF: strict locked blocks non-critical GET too
    expect(
      isProcedureAllowed({ procedure: "settings.get", method: "GET", state: "locked", alwaysAllowed, neverStop: false }),
    ).toBe(false);
  });

  it("batch is allowed iff all procedures pass; picks a representative code", () => {
    // mixed critical + non-critical mutation in readonly → blocked (non-critical fails)
    const mixed = decideLicenseBatch({
      procedures: ["inspection.record", "settings.upsert"],
      method: "POST",
      state: "readonly",
      alwaysAllowed,
    });
    expect(mixed.allow).toBe(false);
    expect(mixed.code).toBe("LICENSE_READONLY");
    // all-critical batch passes even locked
    expect(
      decideLicenseBatch({ procedures: ["inspection.record", "andon.raise"], method: "POST", state: "locked", alwaysAllowed }).allow,
    ).toBe(true);
  });
});

describe("ed25519License", () => {
  it("sign → verify roundtrip; tamper + wrong key fail", () => {
    const kp = generateEd25519Keypair();
    const claims = { edition: "site", modules: ["MOD_AI"], exp: 123 };
    const sig = signLicenseEd25519(claims, kp.privateKeyPem);
    expect(verifyLicenseEd25519(claims, sig, kp.publicKeyPem)).toBe(true);
    // tampered claims
    expect(verifyLicenseEd25519({ ...claims, edition: "machine" }, sig, kp.publicKeyPem)).toBe(false);
    // wrong key
    const other = generateEd25519Keypair();
    expect(verifyLicenseEd25519(claims, sig, other.publicKeyPem)).toBe(false);
    // garbage never throws
    expect(verifyLicenseEd25519(claims, "not-base64!!", kp.publicKeyPem)).toBe(false);
  });

  it("canonicalClaims is key-order stable (signature is deterministic)", () => {
    expect(canonicalClaims({ b: 1, a: 2 })).toBe(canonicalClaims({ a: 2, b: 1 }));
  });

  it("deriveFingerprint: TPM-bound flag, stable, MAC-order independent", () => {
    const a = deriveFingerprint({ cpuId: "cpu1", macAddresses: ["m2", "m1"], tpmEkPublic: "ek" });
    const b = deriveFingerprint({ cpuId: "cpu1", macAddresses: ["m1", "m2"], tpmEkPublic: "ek" });
    expect(a.fingerprint).toBe(b.fingerprint); // order-independent
    expect(a.tpmBound).toBe(true);
    const noTpm = deriveFingerprint({ cpuId: "cpu1" });
    expect(noTpm.tpmBound).toBe(false);
    expect(noTpm.fingerprint).not.toBe(a.fingerprint);
  });
});

describe("deviceMetering (floating license)", () => {
  const devices: MeteredDevice[] = [
    { id: "r1", kind: "robot", connected: true },
    { id: "r2", kind: "robot", connected: true },
    { id: "c1", kind: "cnc", connected: true },
    { id: "s1", kind: "sensor", connected: false },
  ];

  it("counts connected devices + byKind; unlimited quota", () => {
    const u = computeDeviceUsage(devices, null);
    expect(u.connected).toBe(3);
    expect(u.total).toBe(4);
    expect(u.withinLimit).toBe(true);
    expect(u.overBy).toBe(0);
    expect(u.byKind).toEqual({ robot: 2, cnc: 1 });
  });

  it("within / over limit (over = warn only, never block)", () => {
    expect(computeDeviceUsage(devices, 5).withinLimit).toBe(true);
    const over = computeDeviceUsage(devices, 2);
    expect(over.withinLimit).toBe(false);
    expect(over.overBy).toBe(1);
    expect(usageReportLine(over)).toMatch(/OVER by 1/);
  });

  it("carries peak forward", () => {
    expect(computeDeviceUsage(devices, null, 10).peak).toBe(10);
    expect(computeDeviceUsage(devices, null, 1).peak).toBe(3);
  });
});
