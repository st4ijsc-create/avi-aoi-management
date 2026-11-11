/**
 * A2(n) T9 (D2, X3e, X7; kế hoạch mục 8) — a STOP handed over AGAIN after its own unknown attempt carries `docLai: "bat_buoc"`:
 *   • the facade (equipmentAdapter) hands the field to central's dispatcher (DispatchInput.docLai) and, on an edge node, to its OT front end (EdgeOtDispatchInput.docLai):
 *     an in-process field, never on the wire (EquipmentCommand is built by the walker of this process);
 *   • X7 [sim]: at the device stage (executeOtDeviceWrite, the stage both dispatchers use; StubDriver = the simulator in RAM) the write reaches the device BEFORE the read-back
 *     begins, the time to the write does not move with `docLai`, and a read-back that hangs is cut at the command's bound: not confirmed (acked_unverified), never acked_verified.
 * No DB, no network: the dispatchers are mocked for the facade; the device stage runs on the stub. Time: the case's own clock (performance.now) on the stub's calls.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const goi = vi.hoisted(() => ({ trungTam: [] as Array<Record<string, unknown>>, nut: [] as Array<Record<string, unknown>> }));
vi.mock("../../ot/commandDispatcher", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../../ot/commandDispatcher")>();
  return {
    ...orig,
    dispatch: async (input: Record<string, unknown>) => {
      goi.trungTam.push(input);
      return { ok: true, status: "acked_verified", simulated: false, commandLogIds: [], reason: undefined };
    },
  };
});
vi.mock("../../ot/otEdgeDispatch", () => ({
  dispatchOtOnEdge: async (input: Record<string, unknown>) => {
    goi.nut.push(input);
    return { ok: true, status: "acked_verified", stop: true, results: [] };
  },
}));

import { equipmentRegistry, type EquipmentCommand } from "../../equipment/equipmentAdapter";
import { StubDriver } from "../../ot/drivers/stubDriver";
import { executeOtDeviceWrite } from "../../ot/otDeviceWrite";
import type { DispatchInput } from "../../ot/commandDispatcher";

const lenh = (them: Partial<EquipmentCommand> = {}): EquipmentCommand => ({ name: "stop", adapterId: 501, machineId: 1, writes: [{ tagKey: "halt", value: true }], idempotencyKey: "run1-x-a2", hitl: { actionId: "foe-run1-x-a2", requestedBy: 7 }, ...them });
const vaiCu = process.env.AVI_PROCESS_ROLE;
const rbCu = process.env.OT_READBACK_ENABLED;
beforeEach(() => {
  goi.trungTam.length = 0;
  goi.nut.length = 0;
  delete process.env.OT_READBACK_ENABLED; // the flag stays off: D2 does not change it
});
afterEach(() => {
  if (vaiCu === undefined) delete process.env.AVI_PROCESS_ROLE;
  else process.env.AVI_PROCESS_ROLE = vaiCu;
  if (rbCu === undefined) delete process.env.OT_READBACK_ENABLED;
  else process.env.OT_READBACK_ENABLED = rbCu;
});

describe("A2(n) T9 — D2: the facade hands docLai on (central, edge), only when it is asked", () => {
  it("D2-TT central: docLai reaches the dispatcher's input; absent, the input has none", async () => {
    delete process.env.AVI_PROCESS_ROLE;
    const a = equipmentRegistry.getAdapter("ot-stub");
    await a.sendCommand(lenh({ docLai: "bat_buoc" }));
    await a.sendCommand(lenh({ idempotencyKey: "run1-x-a1" }));
    expect(goi.trungTam.map((x) => x.docLai ?? null)).toEqual(["bat_buoc", null]);
    expect(goi.nut).toEqual([]);
  });
  it("D2-NUT edge node: docLai reaches its OT front end; absent, none", async () => {
    process.env.AVI_PROCESS_ROLE = "edge";
    const a = equipmentRegistry.getAdapter("ot-stub");
    await a.sendCommand(lenh({ docLai: "bat_buoc", edge: { run: { runId: 1, claimSeq: 1, stepId: "x", attempt: 2 }, source: "local" } }));
    await a.sendCommand(lenh({ idempotencyKey: "run1-x-a1", edge: { run: { runId: 1, claimSeq: 1, stepId: "x", attempt: 1 }, source: "local" } }));
    expect(goi.nut.map((x) => x.docLai ?? null)).toEqual(["bat_buoc", null]);
    expect(goi.trungTam).toEqual([]);
  });
});

describe("A2(n) T9 — X7 [sim]: the device stage with docLai: the write first, its time unchanged, a hung read-back cut at the bound", () => {
  const ADAPTER = 990_635_909;
  const vao = (docLai: boolean): DispatchInput => ({
    adapterId: ADAPTER,
    machineId: null,
    commandType: "stop",
    writes: [{ tagKey: "halt", value: 1 }],
    triggeredBy: { kind: "hitl", confirmedBy: 1, requestedBy: 1 },
    idempotencyKey: `t9-x7-${Math.random()}`,
    ...(docLai ? { docLai: "bat_buoc" as const } : {}),
  });
  /** one write on a stub that records the moment of its write and of its read-back; `treo`: the read-back never answers */
  const ghi = async (docLai: boolean, treo: boolean, timeoutMs = 300) => {
    const d = new StubDriver();
    await d.connect({ endpoint: `stub://t9-x7-${Math.random()}` });
    const su: Array<{ ten: string; t: number }> = [];
    const t0 = performance.now();
    const wOrig = d.writeTags.bind(d);
    vi.spyOn(d, "writeTags").mockImplementation(async (...a: Parameters<StubDriver["writeTags"]>) => {
      su.push({ ten: "ghi", t: performance.now() - t0 });
      return wOrig(...a);
    });
    const rOrig = d.readTags.bind(d);
    vi.spyOn(d, "readTags").mockImplementation(async (...a: Parameters<StubDriver["readTags"]>) => {
      su.push({ ten: "doc", t: performance.now() - t0 });
      if (treo) return new Promise<never>(() => undefined);
      return rOrig(...a);
    });
    const inp = vao(docLai);
    const resolved = inp.writes.map((w) => ({ write: w, address: "DB1.8", dataType: "int" }));
    const r = await executeOtDeviceWrite({
      input: inp,
      driver: d,
      resolved,
      driverWrites: resolved.map((x) => ({ tagKey: x.write.tagKey, address: x.address, value: x.write.value, dataType: "int" as never })),
      timeoutMs,
      stopTyped: true,
      ledger: { intentIds: [], confirmedBy: 1 },
      bumpStopEpoch: false,
    });
    const xong = performance.now() - t0;
    await d.disconnect();
    return { r, su, xong };
  };
  it("X7 the write reaches the simulator BEFORE the read-back begins; the device stage says acked_verified only from that read", async () => {
    const { r, su } = await ghi(true, false);
    expect(su.map((x) => x.ten)).toEqual(["ghi", "doc"]);
    expect(su[0]!.t).toBeLessThanOrEqual(su[1]!.t);
    expect(r.outcomes[0]).toMatchObject({ ok: true, status: "acked_verified" });
  });
  it("X7 without docLai (the first hand-over, the flag off): no read-back at all: acked, never acked_verified", async () => {
    const { r, su } = await ghi(false, false);
    expect(su.map((x) => x.ten)).toEqual(["ghi"]);
    expect(r.outcomes[0]).toMatchObject({ ok: true, status: "acked" });
  });
  it("X7 the time to the write does not move with docLai (the read-back comes after it): 20 rounds each, the medians within 20 ms", async () => {
    const lay = async (docLai: boolean) => {
      const ds: number[] = [];
      for (let i = 0; i < 20; i++) ds.push((await ghi(docLai, false)).su[0]!.t);
      ds.sort((a, b) => a - b);
      return ds[10]!;
    };
    const khong = await lay(false);
    const co = await lay(true);
    expect(Math.abs(co - khong), `median to the write: ${co.toFixed(2)} ms with, ${khong.toFixed(2)} ms without`).toBeLessThan(20);
  });
  it("X7 a read-back that hangs is cut at the command's bound: not confirmed (acked_unverified), the answer comes within the bound", async () => {
    const { r, su, xong } = await ghi(true, true, 300);
    expect(su.map((x) => x.ten)).toEqual(["ghi", "doc"]);
    expect(r.outcomes[0]).toMatchObject({ ok: true, status: "acked_unverified" });
    expect(r.outcomes[0]!.status).not.toBe("acked_verified");
    expect(xong, "cut at the bound (300 ms), not left hanging").toBeLessThan(300 + 1500);
    expect(xong).toBeGreaterThanOrEqual(290);
  });
});
