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
  readTrpcPath,
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
import {
  CURRENT_PRODUCT_CODE,
  LEGACY_PRODUCT_CODES,
  getDefaultProductCode,
  isAcceptedProductCode,
  productCodesMatch,
} from "./productCode";

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

  // Doc 80 Đợt 1 Task 6 (XC-01): query input lớn đi POST (tRPC methodOverride). License readonly
  // không được coi POST-query là ghi — tra loại thủ tục THẬT; không biết loại ⇒ giữ POST (chặn).
  describe("POST-query (methodOverride) dưới license readonly", () => {
    const loai = (p: string) =>
      ({ "ir.lint": "query", "programming.plcopenImport": "query", "settings.upsert": "mutation" } as Record<string, string>)[p];

    it("batch POST chỉ gồm query ⇒ cho qua như GET", () => {
      const d = decideLicenseBatch({
        procedures: ["ir.lint", "programming.plcopenImport"],
        method: "POST",
        state: "readonly",
        alwaysAllowed,
        procedureType: loai,
      });
      expect(d.allow).toBe(true);
      // never-stop mặc định hạ locked → readonly: cũng qua
      expect(
        decideLicenseBatch({ procedures: ["ir.lint"], method: "POST", state: "locked", alwaysAllowed, procedureType: loai, neverStop: true }).allow,
      ).toBe(true);
    });

    it("POST mutation vẫn bị chặn; batch trộn query + mutation bị chặn", () => {
      expect(
        decideLicenseBatch({ procedures: ["settings.upsert"], method: "POST", state: "readonly", alwaysAllowed, procedureType: loai }).allow,
      ).toBe(false);
      expect(
        decideLicenseBatch({ procedures: ["ir.lint", "settings.upsert"], method: "POST", state: "readonly", alwaysAllowed, procedureType: loai }).allow,
      ).toBe(false);
    });

    it("không biết loại thủ tục ⇒ fail-closed (giữ POST ⇒ chặn); không truyền procedureType ⇒ hành vi cũ", () => {
      expect(
        decideLicenseBatch({ procedures: ["khong.tonTai"], method: "POST", state: "readonly", alwaysAllowed, procedureType: loai }).allow,
      ).toBe(false);
      expect(decideLicenseBatch({ procedures: ["ir.lint"], method: "POST", state: "readonly", alwaysAllowed }).allow).toBe(false);
    });

    it("strict locked (never-stop tắt) vẫn chặn cả GET lẫn POST-query không thiết yếu", () => {
      expect(
        decideLicenseBatch({ procedures: ["ir.lint"], method: "POST", state: "locked", alwaysAllowed, procedureType: loai, neverStop: false }).allow,
      ).toBe(false);
    });
  });

  // Doc 80 Đợt 1 final wave (item 3): đọc tên thủ tục ĐÚNG NHƯ tRPC 11 (đoạn cuối sau `/`, decode, tách `,`
  // chỉ khi batch) + phòng thủ nhiều lớp cho đường thô đáng ngờ. Bản HTTP thật: licenseMiddleware.pathSpoof.test.ts.
  describe("readTrpcPath — cùng phép đọc với adapter tRPC", () => {
    it("đường thường: một thủ tục; batch hợp lệ: tách `,`; không đáng ngờ", () => {
      expect(readTrpcPath("/settings.upsert", false)).toEqual({ procedures: ["settings.upsert"], suspicious: false });
      expect(readTrpcPath("/settings.get", true)).toEqual({ procedures: ["settings.get"], suspicious: false });
      expect(readTrpcPath("/ir.lint,programming.pouLint", true)).toEqual({ procedures: ["ir.lint", "programming.pouLint"], suspicious: false });
    });

    it("★★★ hai ví dụ giả mạo: thủ tục đọc ra là thủ tục tRPC SẼ chạy, và đường bị đánh dấu đáng ngờ", () => {
      // `/` thừa: tRPC chạy đoạn CUỐI (`settings.upsert`), không phải `inspection.x`.
      expect(readTrpcPath("/inspection.x/settings.upsert", true)).toEqual({ procedures: ["settings.upsert"], suspicious: true });
      // `%2C`: tRPC decode rồi mới tách ⇒ CẢ HAI chạy; bản cũ thấy một tên `inspection.x%2Csettings.upsert`.
      expect(readTrpcPath("/inspection.x%2Csettings.upsert", true)).toEqual({ procedures: ["inspection.x", "settings.upsert"], suspicious: true });
    });

    it("`,` khi KHÔNG batch là một tên duy nhất (tRPC không tách) và đáng ngờ; `%2F` đáng ngờ; không decode được đáng ngờ", () => {
      expect(readTrpcPath("/inspection.x,settings.upsert", false)).toEqual({ procedures: ["inspection.x,settings.upsert"], suspicious: true });
      expect(readTrpcPath("/ir.lint%2Fx", true)).toEqual({ procedures: ["ir.lint/x"], suspicious: true });
      const hong = readTrpcPath("/%E0%A4%A", true);
      expect(hong.suspicious).toBe(true);
      expect(hong.procedures).toEqual(["%E0%A4%A"]);
    });

    it("đáng ngờ ⇒ xét như GHI: GET query không thiết yếu bị chặn, POST-query không được nới; ghi thiết yếu vẫn qua", () => {
      const loai = (p: string) => ({ "settings.get": "query", "ir.lint": "query" } as Record<string, string>)[p];
      expect(decideLicenseBatch({ procedures: ["settings.get"], method: "GET", state: "readonly", alwaysAllowed, procedureType: loai }).allow).toBe(true);
      expect(decideLicenseBatch({ procedures: ["settings.get"], method: "GET", state: "readonly", alwaysAllowed, procedureType: loai, suspicious: true }).allow).toBe(false);
      expect(decideLicenseBatch({ procedures: ["ir.lint"], method: "POST", state: "readonly", alwaysAllowed, procedureType: loai }).allow).toBe(true);
      expect(decideLicenseBatch({ procedures: ["ir.lint"], method: "POST", state: "readonly", alwaysAllowed, procedureType: loai, suspicious: true }).allow).toBe(false);
      expect(decideLicenseBatch({ procedures: ["inspection.record"], method: "POST", state: "readonly", alwaysAllowed, suspicious: true }).allow).toBe(true);
      expect(decideLicenseBatch({ procedures: ["auth.me"], method: "GET", state: "locked", alwaysAllowed, suspicious: true }).allow).toBe(true);
    });
  });
});

describe("productCode — dual-accept (REBRAND R-2)", () => {
  it("NEW canonical code passes", () => {
    expect(CURRENT_PRODUCT_CODE).toBe("SYNAPSE-PLATFORM");
    expect(isAcceptedProductCode("SYNAPSE-PLATFORM", "")).toBe(true);
    expect(isAcceptedProductCode("SYNAPSE-PROD", "")).toBe(true);
  });

  it("LEGACY codes still pass (licenses issued in the field must not die)", () => {
    for (const legacy of LEGACY_PRODUCT_CODES) {
      expect(isAcceptedProductCode(legacy, "")).toBe(true);
    }
    // field .env / DB rows used lowercase — comparison is case-insensitive
    expect(isAcceptedProductCode("avi-aoi-management", "")).toBe(true);
  });

  it("FOREIGN code fails", () => {
    expect(isAcceptedProductCode("SOME-OTHER-PRODUCT", "")).toBe(false);
    expect(isAcceptedProductCode("", "")).toBe(false);
    expect(isAcceptedProductCode(null, "")).toBe(false);
    expect(isAcceptedProductCode(undefined, "")).toBe(false);
  });

  it("configured env code is accepted even when outside both families", () => {
    expect(isAcceptedProductCode("CUSTOM-OEM-CODE", "CUSTOM-OEM-CODE")).toBe(true);
    expect(isAcceptedProductCode("CUSTOM-OEM-CODE", "")).toBe(false);
  });

  it("productCodesMatch: old license ↔ new app identity match both ways", () => {
    // license stored under legacy code, app presents the new code
    expect(productCodesMatch("AVI-AOI-MANAGEMENT", "SYNAPSE-PLATFORM", "")).toBe(true);
    // and vice versa
    expect(productCodesMatch("SYNAPSE-PLATFORM", "avi-aoi-management", "")).toBe(true);
    // exact match (any casing) always passes, even outside the family
    expect(productCodesMatch("X-CUSTOM", "x-custom", "")).toBe(true);
    // foreign vs family never matches
    expect(productCodesMatch("SOME-OTHER-PRODUCT", "SYNAPSE-PLATFORM", "")).toBe(false);
    expect(productCodesMatch("AVI-AOI-MANAGEMENT", "SOME-OTHER-PRODUCT", "")).toBe(false);
    // empty never matches
    expect(productCodesMatch("", "SYNAPSE-PLATFORM", "")).toBe(false);
  });

  it("getDefaultProductCode falls back to the NEW canonical code (env wins when set)", () => {
    // In the test env LICENSE_PRODUCT_CODE is unset → ENV.licenseProductCode === ''
    // (vitest setup does not define it) so the fallback must be the new code.
    if (!process.env.LICENSE_PRODUCT_CODE) {
      expect(getDefaultProductCode()).toBe("SYNAPSE-PLATFORM");
    } else {
      expect(getDefaultProductCode()).toBe(process.env.LICENSE_PRODUCT_CODE.trim());
    }
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
