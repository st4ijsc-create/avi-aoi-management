// Doc 27 Đợt 5 / W5-E — gap F3: unit tests for the wizard field validators.
import { describe, it, expect } from "vitest";
import { isValidAddress, isValidMachineCode, isValidPort } from "./validation";

describe("isValidMachineCode", () => {
  it("accepts real-world code shapes", () => {
    expect(isValidMachineCode("AOI-LINE1-01")).toBe(true);
    expect(isValidMachineCode("SN-ABC123")).toBe(true);
    expect(isValidMachineCode("m1.zone_2")).toBe(true);
    expect(isValidMachineCode("  AOI-01  ")).toBe(true); // trimmed
  });

  it("rejects empty, over-long and bad characters", () => {
    expect(isValidMachineCode("")).toBe(false);
    expect(isValidMachineCode("   ")).toBe(false);
    expect(isValidMachineCode("X".repeat(51))).toBe(false);
    expect(isValidMachineCode("-starts-with-dash")).toBe(false);
    expect(isValidMachineCode("has space")).toBe(false);
    expect(isValidMachineCode("bad/slash")).toBe(false);
  });
});

describe("isValidAddress", () => {
  it("accepts IPv4 with octets 0-255", () => {
    expect(isValidAddress("192.168.1.50")).toBe(true);
    expect(isValidAddress("0.0.0.0")).toBe(true);
    expect(isValidAddress("255.255.255.255")).toBe(true);
  });

  it("rejects out-of-range or malformed IPv4", () => {
    expect(isValidAddress("256.1.1.1")).toBe(false);
    expect(isValidAddress("192.168.1")).toBe(false);
    expect(isValidAddress("192.168.1.1.1")).toBe(false);
    expect(isValidAddress("")).toBe(false);
    expect(isValidAddress("not an address!")).toBe(false);
  });

  it("accepts hostnames (edge machines addressed by DNS/mDNS)", () => {
    expect(isValidAddress("aoi-line1.local")).toBe(true);
    expect(isValidAddress("plc01")).toBe(true);
    expect(isValidAddress("-bad-.local")).toBe(false);
  });
});

describe("isValidPort", () => {
  it("accepts 1..65535 integers only", () => {
    expect(isValidPort(1)).toBe(true);
    expect(isValidPort(8080)).toBe(true);
    expect(isValidPort(65535)).toBe(true);
    expect(isValidPort(0)).toBe(false);
    expect(isValidPort(65536)).toBe(false);
    expect(isValidPort(80.5)).toBe(false);
    expect(isValidPort(NaN)).toBe(false);
  });
});
