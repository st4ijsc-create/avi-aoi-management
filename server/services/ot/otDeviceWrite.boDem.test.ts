/**
 * SCADA R0 Task 6 (C8) — executeOtDeviceWrite đếm kết quả GHI theo từng tag (thuần: không DB, driver giả).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { executeOtDeviceWrite } from "./otDeviceWrite";
import { __datLaiBoDem, layBoDem } from "./boDemTruyenThong";
import type { DispatchInput } from "./commandDispatcher";

const A = 7171;
const input: DispatchInput = {
  adapterId: A,
  commandType: "set",
  writes: [{ tagKey: "a", value: 1 }, { tagKey: "b", value: 2 }],
  triggeredBy: { kind: "hitl", requestedBy: 1 },
  idempotencyKey: "k",
};
const resolved = [
  { write: { tagKey: "a", value: 1 }, address: "1", dataType: "int" },
  { write: { tagKey: "b", value: 2 }, address: "2", dataType: "int" },
] as never;
const driverWrites = [
  { tagKey: "a", address: "1", value: 1, dataType: "int" as never },
  { tagKey: "b", address: "2", value: 2, dataType: "int" as never },
];
const stage = (driver: unknown, timeoutMs = 1000) => ({
  input,
  driver: driver as never,
  resolved,
  driverWrites,
  timeoutMs,
  stopTyped: false,
  ledger: { intentIds: [], confirmedBy: 1 },
});

beforeEach(() => __datLaiBoDem());

describe("executeOtDeviceWrite — bộ đếm lệnh", () => {
  it("kết quả theo từng tag: a ok, b lỗi ⇒ lenh 2, lenhLoi 1, theo tag", async () => {
    const driver = {
      writeTags: async () => [{ tagKey: "a", ok: true }, { tagKey: "b", ok: false, error: "exc" }],
      readTags: async () => [],
    };
    await executeOtDeviceWrite(stage(driver));
    const b = layBoDem(A);
    expect(b).toMatchObject({ lenh: 2, lenhLoi: 1 });
    expect(b.theoTag.a).toMatchObject({ lenh: 1, lenhLoi: 0 });
    expect(b.theoTag.b).toMatchObject({ lenh: 1, lenhLoi: 1 });
  });

  it("driver ném ⇒ mọi tag tính lỗi; timeout ⇒ mọi tag tính lỗi", async () => {
    await executeOtDeviceWrite(stage({ writeTags: async () => { throw new Error("boom"); }, readTags: async () => [] }));
    expect(layBoDem(A)).toMatchObject({ lenh: 2, lenhLoi: 2 });
    __datLaiBoDem();
    await executeOtDeviceWrite(stage({ writeTags: () => new Promise(() => undefined), readTags: async () => [] }, 20));
    expect(layBoDem(A)).toMatchObject({ lenh: 2, lenhLoi: 2 });
  });
});
