import { describe, expect, it } from "vitest";
import {
  LATEST_MACHINE_CONTRACT_VERSION,
  listMachineContractVersions,
  machineContractJsonSchema,
  validateMachinePayload,
} from "./machineDataContract";

const validPayload = {
  schemaVersion: "1.0",
  machineCode: "AVI001",
  serialNumber: "SN-0001",
  overallResult: "OK",
  measurements: [{ pointCode: "P1", result: "OK" }],
};

describe("machineDataContract", () => {
  it("lists versions and exposes latest", () => {
    expect(listMachineContractVersions()).toContain("1.0");
    expect(LATEST_MACHINE_CONTRACT_VERSION).toBe("1.0");
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
