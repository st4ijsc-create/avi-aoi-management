/**
 * Pha 0 · C0-7 — bug MELSEC `machineId: adapterId`: MÃ ADAPTER bị dùng làm MÃ MÁY ở dispatch() ⇒ preflight an toàn đọc trạng thái MỘT MÁY KHÁC.
 * Sửa: machineId = `device_adapters.machineId` của chính adapter (null nếu chưa gắn máy); tra DB lỗi ⇒ failed có mã, KHÔNG gọi dispatch().
 * Mock: getDb (một hàng device_adapters) + dispatch. Đột biến: trả lại `machineId: adapterId` ⇒ các test "adapterId ≠ machineId" đỏ.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  hang: [] as Array<{ machineId: number | null }>,
  loiDb: false as boolean,
  dbNull: false as boolean,
  dispatch: vi.fn(async (_i: unknown) => ({ ok: true, status: "acked", simulated: false })),
}));

vi.mock("../../../db/connection", () => ({
  getDb: async () => {
    if (h.loiDb) throw new Error("db sập");
    if (h.dbNull) return null; // edge / DB từ chối: getDb() TRẢ null, không ném
    return { select: () => ({ from: () => ({ where: () => ({ limit: async () => h.hang }) }) }) };
  },
}));
vi.mock("../../ot/commandDispatcher", () => ({ dispatch: (i: unknown) => h.dispatch(i) }));

import { MitsubishiEngineeringAdapter } from "./mitsubishiEngineeringAdapter";

const build = { ok: true, diagnostics: [], meta: { paramMap: { D100: "1" } } } as never;
const opts = (deviceId: number) => ({ stage: "staging" as const, idempotencyKey: "k1", deviceId, hitl: { actionId: "act", requestedBy: 6, confirmedBy: 8 } });

beforeEach(() => {
  h.hang = [];
  h.loiDb = false;
  h.dbNull = false;
  h.dispatch.mockClear();
});

describe("C0-7 MELSEC — machineId của dispatch() là MÁY của adapter, không phải mã adapter", () => {
  it("★ adapter 41 gắn máy 7 ⇒ dispatch({adapterId:41, machineId:7}) (adapterId ≠ machineId)", async () => {
    h.hang = [{ machineId: 7 }];
    const r = await new MitsubishiEngineeringAdapter().deploy(build, opts(41));
    expect(r.status).toBe("deployed");
    expect(h.dispatch).toHaveBeenCalledTimes(1);
    expect(h.dispatch.mock.calls[0][0]).toMatchObject({ adapterId: 41, machineId: 7, commandType: "recipe_param_push" });
  });

  it("★ trùng số cũng đúng: adapter 7 gắn máy 3 ⇒ machineId 3 (không phải 7)", async () => {
    h.hang = [{ machineId: 3 }];
    await new MitsubishiEngineeringAdapter().deploy(build, opts(7));
    expect(h.dispatch.mock.calls[0][0]).toMatchObject({ adapterId: 7, machineId: 3 });
  });

  it("adapter chưa gắn máy (machineId null) hoặc không có hàng ⇒ machineId null (dispatch tự từ chối adapter lạ)", async () => {
    h.hang = [{ machineId: null }];
    await new MitsubishiEngineeringAdapter().deploy(build, opts(41));
    expect((h.dispatch.mock.calls[0][0] as { machineId: unknown }).machineId).toBeNull();
    h.dispatch.mockClear();
    h.hang = [];
    await new MitsubishiEngineeringAdapter().deploy(build, opts(42));
    expect((h.dispatch.mock.calls[0][0] as { machineId: unknown }).machineId).toBeNull();
  });

  it("★ tra DB lỗi ⇒ failed ADAPTER_MACHINE_LOOKUP_FAILED, dispatch KHÔNG được gọi (fail-closed)", async () => {
    h.loiDb = true;
    const r = await new MitsubishiEngineeringAdapter().deploy(build, opts(41));
    expect(r).toMatchObject({ ok: false, status: "failed", detail: { reason: "ADAPTER_MACHINE_LOOKUP_FAILED" } });
    expect(h.dispatch).not.toHaveBeenCalled();
  });

  it("★ c7d: getDb() TRẢ null (không ném) ⇒ cũng failed ADAPTER_MACHINE_LOOKUP_FAILED, dispatch KHÔNG được gọi — không được hiểu null là 'adapter chưa gắn máy'", async () => {
    h.dbNull = true;
    const r = await new MitsubishiEngineeringAdapter().deploy(build, opts(41));
    expect(r).toMatchObject({ ok: false, status: "failed", detail: { reason: "ADAPTER_MACHINE_LOOKUP_FAILED" } });
    expect(h.dispatch).not.toHaveBeenCalled();
  });
});
