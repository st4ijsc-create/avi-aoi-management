/**
 * Sprint F1.1 — driverRegistry unit tests.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { registerDriver, createDriver, listProtocols, _clearRegistry } from "./driverRegistry";
import { createStubDriver } from "./drivers/stubDriver";

describe("driverRegistry", () => {
  beforeEach(() => {
    _clearRegistry();
  });

  it("createDriver throws for unregistered protocol", () => {
    expect(() => createDriver("stub")).toThrowError(/No OT driver registered/);
  });

  it("registerDriver then createDriver returns an instance", () => {
    registerDriver("stub", createStubDriver);
    const d = createDriver("stub");
    expect(d.protocol).toBe("stub");
    expect(typeof d.connect).toBe("function");
  });

  it("createDriver returns a fresh instance each call", () => {
    registerDriver("stub", createStubDriver);
    expect(createDriver("stub")).not.toBe(createDriver("stub"));
  });

  it("listProtocols reflects registered protocols", () => {
    expect(listProtocols()).toEqual([]);
    registerDriver("stub", createStubDriver);
    registerDriver("opcua", createStubDriver);
    expect(listProtocols().sort()).toEqual(["opcua", "stub"]);
  });
});
