/**
 * doc 40 (MTX-06) — IO-Link master profile tests (vitest, pure — no I/O, no HW).
 *
 * Validates that every profile is SELF-CONSISTENT and cements the reuse contract:
 *   • the OPC-UA nodeId produced for each port PARSES via the REAL parseOpcuaAddress
 *     (so the existing opcuaDriver can read it — no new driver),
 *   • `{port}` substitution + port-range/uniqueness validation are correct,
 *   • per-port tagKey/scale flow into OtTagAddress unchanged,
 *   • the OPC-UA plan targets a protocol='opcua' device_adapter (live), and the HTTP
 *     plan is honestly flagged as a REST descriptor/seam (no HTTP OtDriver yet).
 */
import { describe, it, expect } from "vitest";
import {
  listIoLinkMasterProfiles,
  getIoLinkMasterProfile,
  resolvePortAddress,
  toOtTagAddresses,
  buildIoLinkAdapterPlan,
  IO_LINK_MAX_PORTS,
  type IoLinkPortConfig,
} from "./ioLinkProfile";
import { parseOpcuaAddress } from "../ot/drivers/opcuaAddress";

const SAMPLE_PORTS: IoLinkPortConfig[] = [
  { port: 1, tagKey: "pressure_bar", dataType: "float", scale: 0.01, unit: "bar", label: "Line pressure" },
  { port: 3, tagKey: "temperature", dataType: "float", unit: "degC", label: "Coolant temp" },
  { port: 5, tagKey: "part_present", dataType: "bool", unit: "", label: "Part present" },
];

describe("IO-Link master profiles", () => {
  it("ships the expected profiles, all honestly marked assumed with 8 ports", () => {
    const all = listIoLinkMasterProfiles();
    expect(all.map((p) => p.id).sort()).toEqual(
      ["balluff-bni", "ifm-al1350", "turck-tben-l"].sort(),
    );
    for (const p of all) {
      expect(p.validationStatus).toBe("assumed");
      expect(p.portCount).toBe(IO_LINK_MAX_PORTS);
    }
  });

  it("resolves each port's OPC-UA nodeId to something the real parser accepts", () => {
    for (const p of listIoLinkMasterProfiles()) {
      for (let port = 1; port <= p.portCount; port++) {
        const addr = resolvePortAddress(p, port, "opcua");
        expect(addr).toContain(String(port));
        expect(() => parseOpcuaAddress(addr), `${p.id} port ${port} (${addr})`).not.toThrow();
      }
    }
  });

  it("substitutes {port} into both OPC-UA and HTTP templates and leaves no placeholder", () => {
    const ifm = getIoLinkMasterProfile("ifm-al1350")!;
    expect(resolvePortAddress(ifm, 2, "opcua")).toBe("ns=1;s=iolinkmaster/port[2]/iolinkdevice/pdin");
    expect(resolvePortAddress(ifm, 2, "http")).toBe("/iolinkmaster/port[2]/iolinkdevice/pdin/getdata");
    for (const p of listIoLinkMasterProfiles()) {
      expect(resolvePortAddress(p, 4, "http")).not.toContain("{port}");
    }
  });

  it("rejects out-of-range ports (fail-loud)", () => {
    const p = getIoLinkMasterProfile("balluff-bni")!;
    expect(() => resolvePortAddress(p, 0, "opcua")).toThrow(/out of range/);
    expect(() => resolvePortAddress(p, 9, "opcua")).toThrow(/out of range/);
    expect(() => resolvePortAddress(p, 1.5, "opcua")).toThrow(/out of range/);
  });

  it("toOtTagAddresses uses tagKey as-is and carries scale/dataType per port", () => {
    const tags = toOtTagAddresses("ifm-al1350", "opcua", SAMPLE_PORTS);
    expect(tags.map((t) => t.tagKey)).toEqual(["pressure_bar", "temperature", "part_present"]);
    const pressure = tags[0];
    expect(pressure.scale).toBe(0.01);
    expect(pressure.dataType).toBe("float");
    expect(pressure.unit).toBe("bar");
    // bool port keeps its declared dataType.
    expect(tags[2].dataType).toBe("bool");
    // every OPC-UA address parses.
    for (const t of tags) expect(() => parseOpcuaAddress(t.address)).not.toThrow();
  });

  it("defaults dataType to float and unit to empty when a port omits them", () => {
    const tags = toOtTagAddresses("turck-tben-l", "opcua", [{ port: 7, tagKey: "flow" }]);
    expect(tags[0].dataType).toBe("float");
    expect(tags[0].unit).toBe("");
    expect(tags[0].scale).toBeUndefined();
  });

  it("rejects duplicate port configs", () => {
    expect(() =>
      toOtTagAddresses("ifm-al1350", "opcua", [
        { port: 2, tagKey: "a" },
        { port: 2, tagKey: "b" },
      ]),
    ).toThrow(/duplicate IO-Link port 2/);
  });

  it("buildIoLinkAdapterPlan (opcua) yields a live protocol='opcua' plan reusing opcuaDriver", () => {
    const plan = buildIoLinkAdapterPlan("ifm-al1350", "opcua", SAMPLE_PORTS, { host: "10.0.0.7" });
    expect(plan.adapter.protocol).toBe("opcua");
    expect(plan.adapter.endpoint).toBe("opc.tcp://10.0.0.7:4840");
    expect(plan.adapter.kind).toBe("iolink_master");
    expect(plan.adapter.profileId).toBe("ifm-al1350");
    expect(plan.adapter.httpDriverAvailable).toBe(true);
    expect(plan.tags).toHaveLength(SAMPLE_PORTS.length);
  });

  it("buildIoLinkAdapterPlan (http) is honestly flagged as a REST descriptor/seam", () => {
    const plan = buildIoLinkAdapterPlan("balluff-bni", "http", SAMPLE_PORTS, { host: "meter.local" });
    expect(plan.adapter.protocol).toBe("http");
    expect(plan.adapter.endpoint).toBe("http://meter.local:80");
    // No HTTP OtDriver registered → not a live wire.
    expect(plan.adapter.httpDriverAvailable).toBe(false);
    // HTTP tag addresses are REST paths (not nodeIds).
    expect(plan.tags[0].address.startsWith("/")).toBe(true);
  });

  it("uses a custom port when provided, else the profile default", () => {
    const custom = buildIoLinkAdapterPlan("turck-tben-l", "opcua", SAMPLE_PORTS, { port: 48400 });
    expect(custom.adapter.endpoint).toContain(":48400");
    const dflt = buildIoLinkAdapterPlan("turck-tben-l", "http", SAMPLE_PORTS);
    expect(dflt.adapter.endpoint).toContain(":80");
  });

  it("unknown profile ids and empty port lists fail loud", () => {
    expect(getIoLinkMasterProfile("nope")).toBeUndefined();
    expect(() => toOtTagAddresses("nope", "opcua", SAMPLE_PORTS)).toThrow(/unknown IO-Link master profile/);
    expect(() => buildIoLinkAdapterPlan("nope", "opcua", SAMPLE_PORTS)).toThrow(/unknown IO-Link master profile/);
    expect(() => buildIoLinkAdapterPlan("ifm-al1350", "opcua", [])).toThrow(/at least one port/);
  });
});
