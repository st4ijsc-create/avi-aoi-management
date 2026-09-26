import { describe, expect, it } from "vitest";
import {
  LATEST_MACHINE_CONTRACT_VERSION,
  LATEST_PROCESS_CONTRACT_VERSION,
  listMachineContractVersions,
  listProcessContractVersions,
  machineContractJsonSchema,
  machineProcessContractJsonSchema,
  validateMachinePayload,
  validateProcessPayload,
  isIsoWithExplicitOffset,
} from "./machineDataContract";

const validPayload = {
  schemaVersion: "1.0",
  machineCode: "AVI001",
  serialNumber: "SN-0001",
  overallResult: "OK",
  measurements: [{ pointCode: "P1", result: "OK" }],
};

describe("machineDataContract", () => {
  it("lists versions and exposes latest (2.0 — Pha 1A Task 4 cây 4 cấp, keeps 1.0/1.1 for reject-with-reason)", () => {
    expect(listMachineContractVersions()).toContain("1.0");
    expect(listMachineContractVersions()).toContain("1.1");
    expect(listMachineContractVersions()).toContain("2.0");
    expect(LATEST_MACHINE_CONTRACT_VERSION).toBe("2.0");
  });

  it("accepts a valid payload", () => {
    const r = validateMachinePayload("1.0", validPayload);
    expect(r.ok).toBe(true);
    expect(r.errors).toBeUndefined();
  });

  it("requires apiKey or machineCode", () => {
    const { machineCode, ...rest } = validPayload;
    const r = validateMachinePayload("1.0", rest);
    expect(r.ok).toBe(false);
  });

  it("rejects invalid overallResult", () => {
    const r = validateMachinePayload("1.0", { ...validPayload, overallResult: "MAYBE" });
    expect(r.ok).toBe(false);
  });

  it("rejects unknown version", () => {
    const r = validateMachinePayload("9.9", validPayload);
    expect(r.ok).toBe(false);
    expect(r.errors?.[0].message).toContain("Unknown contract version");
  });

  it("emits a JSON-Schema for the latest version", () => {
    const schema = machineContractJsonSchema("1.0") as Record<string, unknown> | null;
    expect(schema).toBeTruthy();
    expect(schema).toHaveProperty("type");
  });

  it("returns null JSON-Schema for unknown version", () => {
    expect(machineContractJsonSchema("9.9")).toBeNull();
  });
});

// ── doc 56 API-2 — inspection v1.1 khớp submitInspection thật (sửa drift) ─────
describe("machineDataContract v1.1 (drift fix)", () => {
  const v11Payload = {
    schemaVersion: "1.1",
    machineCode: "AOI-01",
    serialNumber: "SN-1001",
    variantCode: "REVB",
    overallResult: "NG",
    idempotencyKey: "board-abc-123",
    pointsConfigVersion: 7,
    panelId: "PANEL-9",
    boardIndex: 3,
    measurements: [
      { pointCode: "R12", result: "NG", unit: "mil", measuredValue: 4.2, valueHeight: 0.13, defectCatalogCode: "BRIDGE", defectSeverity: "major" },
    ],
  };

  it("accepts a payload using the fields v1.0 was MISSING", () => {
    const r = validateMachinePayload("1.1", v11Payload);
    expect(r.ok).toBe(true);
    expect(r.errors).toBeUndefined();
  });

  it("still requires apiKey or machineCode + a serial", () => {
    const { machineCode, ...noId } = v11Payload;
    expect(validateMachinePayload("1.1", noId).ok).toBe(false);
    expect(validateMachinePayload("1.1", { ...v11Payload, serialNumber: "" }).ok).toBe(false);
  });

  it("exposes the real machine-contract fields in the JSON-Schema (drift closed)", () => {
    const schema = machineContractJsonSchema("1.1") as { properties?: Record<string, unknown> } | null;
    expect(schema).toBeTruthy();
    const props = schema?.properties ?? {};
    for (const f of ["variantCode", "idempotencyKey", "pointsConfigVersion", "panelId", "boardIndex"]) {
      expect(props).toHaveProperty(f);
    }
    // v1.0 (hand-written) did NOT carry these — proves 1.1 is the closer contract.
    const v10 = machineContractJsonSchema("1.0") as { properties?: Record<string, unknown> } | null;
    expect(v10?.properties ?? {}).not.toHaveProperty("variantCode");
  });
});

// ── doc 56 nhóm C — ST4I Standard Process Feed v1 (process-result@1.0) ────────
describe("machineProcessResultContract v1", () => {
  const validProcess = {
    schemaVersion: "1.0",
    machineCode: "PRESS-07",
    serialNumber: "SN-2002",
    stepType: "press-fit",
    result: "pass" as const,
    ts: "2026-07-17T08:00:00+07:00",
    recipe: { code: "PF-100", version: "3" },
    metrics: [{ name: "force", value: 1220.5, unit: "N", lsl: 1000, usl: 1500, nominal: 1250 }],
    waveforms: [{ name: "force-curve", unit: "N", rateHz: 1000, samples: [[0, 0], [1, 1220.5]] }],
    idempotencyKey: "proc-xyz-789",
    stationId: 4,
    lineCode: "L1",
    productionOrderCode: "PO-55",
    lotCode: "LOT-9",
  };

  it("lists process versions + latest 1.0", () => {
    expect(listProcessContractVersions()).toContain("1.0");
    expect(LATEST_PROCESS_CONTRACT_VERSION).toBe("1.0");
  });

  it("accepts a valid Feed v1 payload", () => {
    const r = validateProcessPayload("1.0", validProcess);
    expect(r.ok).toBe(true);
    expect(r.errors).toBeUndefined();
  });

  it("rejects a payload missing serialNumber", () => {
    const { serialNumber, ...rest } = validProcess;
    const r = validateProcessPayload("1.0", rest);
    expect(r.ok).toBe(false);
    expect(r.errors?.some((e) => e.path === "serialNumber")).toBe(true);
  });

  it("rejects a NAIVE ts (no explicit UTC offset)", () => {
    const r = validateProcessPayload("1.0", { ...validProcess, ts: "2026-07-17T08:00:00" });
    expect(r.ok).toBe(false);
    expect(r.errors?.some((e) => e.path === "ts")).toBe(true);
    // sanity on the helper itself
    expect(isIsoWithExplicitOffset("2026-07-17T08:00:00")).toBe(false);
    expect(isIsoWithExplicitOffset("2026-07-17T08:00:00+07:00")).toBe(true);
    expect(isIsoWithExplicitOffset("2026-07-17T01:00:00Z")).toBe(true);
  });

  it("rejects a result outside pass|fail|warn|skip", () => {
    const r = validateProcessPayload("1.0", { ...validProcess, result: "PASSED" });
    expect(r.ok).toBe(false);
    expect(r.errors?.some((e) => e.path === "result")).toBe(true);
  });

  it("rejects an unknown process version", () => {
    const r = validateProcessPayload("9.9", validProcess);
    expect(r.ok).toBe(false);
    expect(r.errors?.[0].message).toContain("Unknown process contract version");
  });

  it("emits a JSON-Schema for process-result 1.0 (null for unknown)", () => {
    const schema = machineProcessContractJsonSchema("1.0") as Record<string, unknown> | null;
    expect(schema).toBeTruthy();
    expect(schema).toHaveProperty("type");
    expect(machineProcessContractJsonSchema("9.9")).toBeNull();
  });

  // ── doc 61 — contract aligned to the RUNTIME schema (submitProcessResultCoreObject).
  //    These lock the APIdocs contract to what the server actually enforces. ──
  it("accepts a payload WITHOUT ts (ts is optional; server stamps now())", () => {
    const { ts, ...noTs } = validProcess;
    const r = validateProcessPayload("1.0", noTs);
    expect(r.ok).toBe(true);
    expect(r.errors).toBeUndefined();
  });

  it("rejects a metrics[].value that is NOT a number (number-only, matches runtime)", () => {
    const r = validateProcessPayload("1.0", {
      ...validProcess,
      metrics: [{ name: "force", value: "PASS" }],
    });
    expect(r.ok).toBe(false);
    expect(r.errors?.some((e) => e.path.startsWith("metrics"))).toBe(true);
  });

  it("accepts a schemaVersion other than '1.0' (log-only; not enforced)", () => {
    expect(validateProcessPayload("1.0", { ...validProcess, schemaVersion: "1.3" }).ok).toBe(true);
    const { schemaVersion, ...noVer } = validProcess;
    expect(validateProcessPayload("1.0", noVer).ok).toBe(true);
  });

  it("rejects a non-numeric stationId (integer only, matches runtime)", () => {
    const r = validateProcessPayload("1.0", { ...validProcess, stationId: "ST-A" });
    expect(r.ok).toBe(false);
    expect(r.errors?.some((e) => e.path === "stationId")).toBe(true);
  });
});
