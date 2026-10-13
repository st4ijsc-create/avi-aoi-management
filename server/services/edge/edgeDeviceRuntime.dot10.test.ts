/**
 * doc 81 Đợt 10 task D — the safety-PLC CONFIG-SOURCE seams on the edge (safetyPlcAdapter.listPlcConfigs,
 * safetyTarget.resolveSafetyTargets) installed by installEdgeDeviceRuntime: the preflight reads the SIGNED snapshot's configs
 * and never the DB; the target is not re-resolved on the edge (null ⇒ every shipped config applies — never fewer); with no
 * config yet ⇒ no configs ⇒ the preflight answers UNKNOWN ⇒ motion / writes refused (fail-closed). Central (no install) is
 * unchanged. The DB module is a trap.
 */
import { describe, it, expect, vi, afterEach } from "vitest";

const H = vi.hoisted(() => ({ dbCalls: 0 }));
vi.mock("../../db/connection", () => ({
  getDb: async () => {
    H.dbCalls++;
    throw new Error("EDGE_DB_TRAP");
  },
}));

import { installEdgeDeviceRuntime, _resetEdgeDeviceRuntimeForTests, edgeDeviceRuntime } from "./edgeDeviceRuntime";
import { listPlcConfigs } from "../safety/plc/safetyPlcAdapter";
import { resolveSafetyTargets } from "../ot/safetyTarget";

const cfg = (id: number, over: Record<string, unknown> = {}) => ({ id, trustDigest: null, approved: true, config: { id, code: `S${id}`, enabled: true, robotId: null, stationId: null, lineId: 3, backend: "sim", ...over } });
let snapshot: any = null;
const rt = {
  nodeId: 7,
  config: () => snapshot,
  journal: { consumeAuthorization: async () => ({ ok: true as const }), isJtiConsumed: () => false, appendRun: async () => undefined, appendEvent: async () => undefined },
  auth: () => null,
};

afterEach(async () => {
  await _resetEdgeDeviceRuntimeForTests();
  snapshot = null;
  H.dbCalls = 0;
});

describe("edge device runtime — safety config sources from the signed snapshot", () => {
  it("★ listPlcConfigs answers from the snapshot (filters as the SQL: enabled / robot / station / line), no DB", async () => {
    snapshot = { safetyPlcConfigs: [cfg(2), cfg(1, { enabled: false }), cfg(3, { lineId: 4 })] };
    await installEdgeDeviceRuntime(rt);
    expect(edgeDeviceRuntime()).toBe(rt);
    expect((await listPlcConfigs({ onlyEnabled: true })).map((c) => c.id)).toEqual([2, 3]);
    expect((await listPlcConfigs({ lineId: 4 })).map((c) => c.id)).toEqual([3]);
    expect((await listPlcConfigs()).map((c) => c.id)).toEqual([1, 2, 3]);
    expect(H.dbCalls).toBe(0);
  });

  it("★ resolveSafetyTargets never reads the DB on the edge: null ⇒ every shipped config applies", async () => {
    snapshot = { safetyPlcConfigs: [cfg(2)] };
    await installEdgeDeviceRuntime(rt);
    expect(await resolveSafetyTargets({ adapterId: 5, machineId: 50 })).toBeNull();
    expect(await resolveSafetyTargets({ robotId: 12 })).toBeNull();
    expect(H.dbCalls).toBe(0);
  });

  it("no config yet ⇒ no safety configs (the preflight then answers UNKNOWN — refused); after reset central reads the DB again", async () => {
    await installEdgeDeviceRuntime(rt);
    expect(await listPlcConfigs({ onlyEnabled: true })).toEqual([]);
    await _resetEdgeDeviceRuntimeForTests();
    await expect(listPlcConfigs({ onlyEnabled: true })).rejects.toThrow(/EDGE_DB_TRAP/); // central path = the DB (trapped here)
    expect(H.dbCalls).toBe(1);
  });
});
