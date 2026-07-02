/**
 * doc 24 C4 — robot vendor coverage:
 *   (a) the DB `robotvendorenum` now includes "vda5050" (migration 0161), and the
 *       vda5050 driver is SELECTABLE through the standard robot driver registry;
 *   (b) FANUC is now a REAL RMI driver (not a NotImplemented scaffold);
 *   (c) Mitsubishi/Delta remain honest scaffolds (connect() throws explicitly).
 */
import { describe, it, expect } from "vitest";
import { robotVendorEnum } from "../../../drizzle/schema/robot";
import { createRobotDriver, listVendors } from "./index";

describe("robot vendor enum + registry (doc 24 C4)", () => {
  it("robotvendorenum contains vda5050 (unblocked by migration 0161)", () => {
    expect(robotVendorEnum.enumValues).toContain("vda5050");
    // additive — existing vendors preserved
    for (const v of ["fanuc", "mitsubishi", "delta", "techman", "sim"]) {
      expect(robotVendorEnum.enumValues).toContain(v);
    }
  });

  it("vda5050 driver is selectable from the robot registry", () => {
    expect(listVendors()).toContain("vda5050");
    const driver = createRobotDriver("vda5050");
    expect(driver.vendor).toBe("vda5050");
    expect(typeof driver.connect).toBe("function");
    expect(typeof driver.runJob).toBe("function");
  });

  it("fanuc is now a real RMI driver (not the NotImplemented scaffold)", () => {
    const driver = createRobotDriver("fanuc");
    expect(driver.constructor.name).toBe("FanucDriver");
    expect(driver.vendor).toBe("fanuc");
  });

  it("mitsubishi/delta remain honest scaffolds — connect throws explicitly", async () => {
    for (const vendor of ["mitsubishi", "delta"] as const) {
      const driver = createRobotDriver(vendor);
      await expect(driver.connect({ endpoint: "127.0.0.1" })).rejects.toThrow(/not (wired|available)|not implemented|scaffold/i);
      // runJob is a non-throwing honest failure, not a silent success
      const res = await driver.runJob({ jobType: "home" });
      expect(res.ok).toBe(false);
    }
  });
});
