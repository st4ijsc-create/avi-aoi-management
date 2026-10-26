/**
 * SCADA R1b-2b-1 T6 (mục 42) — đọc lại tag int có tỉ lệ ở KHÔNG GIAN THÔ, và địa chỉ lớp bit so theo luật bool (Task 2 concern 3).
 * Thiết bị = driver giả tối thiểu (ghi nhớ, đọc lại giá trị do test ép). Oracle: giá trị ép do test chọn.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { executeOtDeviceWrite } from "./otDeviceWrite";
import type { DispatchInput } from "./commandDispatcher";
import type { OtDriver } from "./otDriver";

const savedRb = process.env.OT_READBACK_ENABLED;
beforeEach(() => {
  delete process.env.OT_READBACK_ENABLED;
});
afterEach(() => {
  if (savedRb === undefined) delete process.env.OT_READBACK_ENABLED;
  else process.env.OT_READBACK_ENABLED = savedRb;
});

function fakeDriver(protocol: string, docLai: unknown): OtDriver {
  return {
    protocol,
    writeTags: async (ws: Array<{ tagKey: string }>) => ws.map((w) => ({ tagKey: w.tagKey, ok: true })),
    readTags: async (ts: Array<{ tagKey: string }>) => ts.map((t) => ({ tagKey: t.tagKey, value: docLai, quality: "good", ts: new Date() })),
  } as unknown as OtDriver;
}

async function ghi(opts: { protocol: string; address: string; dataType: string; value: unknown; docLai: unknown; scale?: number; offset?: number; stop?: boolean }) {
  const input = {
    adapterId: 990_635_778,
    machineId: null,
    commandType: opts.stop ? "stop" : "set_param",
    writes: [{ tagKey: "t", value: opts.value }],
    triggeredBy: { kind: "hitl", confirmedBy: 1, requestedBy: 1 },
    idempotencyKey: `r1b2b-t6-${Math.random()}`,
    docLai: "bat_buoc",
  } as unknown as DispatchInput;
  const resolved = [{ write: input.writes[0], address: opts.address, dataType: opts.dataType, scale: opts.scale, offset: opts.offset }];
  const r = await executeOtDeviceWrite({
    input,
    driver: fakeDriver(opts.protocol, opts.docLai),
    resolved,
    driverWrites: [{ tagKey: "t", address: opts.address, value: opts.value, dataType: opts.dataType, scale: opts.scale, offset: opts.offset }],
    timeoutMs: 1000,
    stopTyped: !!opts.stop,
    ledger: { intentIds: [], confirmedBy: 1 },
    bumpStopEpoch: !!opts.stop,
  });
  return r.outcomes[0];
}

describe("R1b-2b-1 T6 — đọc lại int có tỉ lệ ở số thô", () => {
  it("★ int scale 0,5 ghi 2,5 đọc lại 3,0 good ⇒ acked_unverified (trước: acked_verified giả)", async () => {
    const o = await ghi({ protocol: "modbus", address: "40001", dataType: "int", value: 2.5, docLai: 3.0, scale: 0.5 });
    expect(o.status).toBe("acked_unverified");
  });
  it("int scale 0,5 ghi 2,5 đọc lại 2,5 ⇒ acked_verified", async () => {
    const o = await ghi({ protocol: "modbus", address: "40001", dataType: "int", value: 2.5, docLai: 2.5, scale: 0.5 });
    expect(o.status).toBe("acked_verified");
  });
});

describe("R1b-2b-1 T6 — địa chỉ lớp bit (Task 2 concern 3)", () => {
  it("★ STOP ghim 255 trên coil Modbus dataType int, đọc lại 1 ⇒ acked_verified", async () => {
    const o = await ghi({ protocol: "modbus", address: "00001", dataType: "int", value: 255, docLai: 1, stop: true });
    expect(o.status).toBe("acked_verified");
  });
  it("STOP ghim 255 trên coil dataType int, đọc lại 0 ⇒ acked_unverified", async () => {
    const o = await ghi({ protocol: "modbus", address: "00001", dataType: "int", value: 255, docLai: 0, stop: true });
    expect(o.status).toBe("acked_unverified");
  });
});
