/**
 * doc 81 Đợt 1D Task 2 — tool `machine_stop`: khi adapter đích có tag DỪNG ghim, tool gửi ĐÚNG các cặp ghim
 * (bỏ qua `tagKey` người/AI truyền); không có ghim / đọc ghim lỗi ⇒ hành vi hôm nay (tag mặc định/tagKey, true).
 * `otWriteBinding` (hash lúc propose) và `execute` dùng CÙNG plan ⇒ thứ được xác nhận = thứ được gửi.
 *
 * `loadStopPins` được giả lập (hàm thuần của nó có test riêng trên DB thật); dispatcher giả lập (đo đúng
 * lệnh tool trao cho nó). Cổng AI L-7 chạy THẬT (safety giả "OK", cờ AI bật) — khuôn machineControl.guardrail.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { boDemChungChoTest } from "../../ot/aiControlGate";

type Row = Record<string, any>;

vi.mock("drizzle-orm", () => ({
  eq: (col: any, val: any) => (r: Row) => r[col.__name] === val,
  and: (...p: Array<(r: Row) => boolean>) => (r: Row) => p.every((f) => f(r)),
}));

const adapters: Row[] = [{ id: 10, machineId: 5, code: "A10", isEnabled: true }];
const fakeDb = {
  select: () => ({
    from: (_t: any) => ({
      where: (pred: (r: Row) => boolean) => ({
        limit: async () => {
          for (const r of adapters) if (pred(r)) return [r];
          return [];
        },
      }),
    }),
  }),
};
vi.mock("../../../db/connection", () => ({ getDb: vi.fn(async () => fakeDb) }));
vi.mock("../../../../drizzle/schema", () => ({
  deviceAdapters: { __table: "device_adapters", machineId: { __name: "machineId" }, id: { __name: "id" }, isEnabled: { __name: "isEnabled" } },
  deviceTags: { __table: "device_tags", adapterId: { __name: "adapterId" }, tagKey: { __name: "tagKey" }, writable: { __name: "writable" } },
}));
vi.mock("../../../db/machineRecipe", () => ({ getActiveRecipe: vi.fn(async () => null) }));

const pinsState = vi.hoisted(() => ({ pins: [] as Array<{ tagKey: string; value: unknown }>, throws: false, calls: [] as number[] }));
vi.mock("../../ot/stopPin", () => ({
  loadStopPins: async (_db: unknown, adapterId: number) => {
    pinsState.calls.push(adapterId);
    if (pinsState.throws) throw new Error("D1T2 pin read failed");
    return pinsState.pins;
  },
}));

const dispatchSpy = vi.fn(async (..._a: unknown[]) => ({ ok: true, simulated: true, status: "simulated", results: [], commandLogIds: [1] }));
vi.mock("../../ot/commandDispatcher", () => ({
  dispatch: (...a: unknown[]) => dispatchSpy(...a),
  isOtControlEnabled: () => false,
}));
const safetyChoAi = vi.fn(async (..._a: unknown[]) => "OK" as const);
vi.mock("../../ot/aiControlGate.safety", () => ({
  preflightSafetyChoAi: (...a: unknown[]) => safetyChoAi(...a),
}));

import "./machineControl";
import { getTool } from "../toolRegistry";

const ctx = { user: { id: 1, role: "admin", name: "A" }, lang: "en" as const, actionId: "act-1" };
const tool = (name: string) => getTool(name) as any;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.AI_OT_CONTROL_ENABLED = "true";
  safetyChoAi.mockResolvedValue("OK");
  boDemChungChoTest().xoaHet();
  pinsState.pins = [];
  pinsState.throws = false;
  pinsState.calls = [];
});
afterEach(() => {
  delete process.env.AI_OT_CONTROL_ENABLED;
});

describe("machine_stop — tag DỪNG ghim (doc 81 Đợt 1D Task 2)", () => {
  it("★ có ghim ⇒ gửi ĐÚNG các cặp ghim, tagKey người truyền bị BỎ QUA; binding lúc propose = đúng lệnh đó", async () => {
    pinsState.pins = [
      { tagKey: "cmd_stop", value: true },
      { tagKey: "speed_sp", value: 0 },
    ];
    await tool("machine_stop").execute({ machineId: 5, tagKey: "cmd_start" }, ctx);
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    const arg = dispatchSpy.mock.calls[0][0] as any;
    expect(arg.commandType).toBe("stop");
    expect(arg.adapterId).toBe(10);
    expect(arg.writes).toEqual([
      { tagKey: "cmd_stop", value: true },
      { tagKey: "speed_sp", value: 0 },
    ]);
    expect(arg.writes.some((w: any) => w.tagKey === "cmd_start")).toBe(false);
    const bound = await tool("machine_stop").otWriteBinding({ machineId: 5, tagKey: "cmd_start" });
    expect(bound).toEqual({ adapterId: 10, machineId: 5, commandType: "stop", writes: arg.writes });
    expect(pinsState.calls.every((id) => id === 10)).toBe(true);
  });

  it("có ghim ⇒ preview cho người xác nhận thấy đúng giá trị ghim + tagKey bị bỏ qua", async () => {
    pinsState.pins = [{ tagKey: "cmd_stop", value: true }];
    const pv = await tool("machine_stop").preview({ machineId: 5, tagKey: "cmd_start" }, ctx);
    expect(pv.changes[0].newValue).toBe("cmd_stop=true");
    expect(pv.warnings.join(" ")).toMatch(/pinned stop tags/);
    expect(pv.warnings.join(" ")).toMatch(/Tag "cmd_start" is ignored/);
  });

  it("KHÔNG có ghim ⇒ như hôm nay: tagKey người truyền (hoặc cmd_stop), value true", async () => {
    await tool("machine_stop").execute({ machineId: 5, tagKey: "my_stop" }, ctx);
    expect((dispatchSpy.mock.calls[0][0] as any).writes).toEqual([{ tagKey: "my_stop", value: true }]);
    await tool("machine_stop").execute({ machineId: 5 }, ctx);
    expect((dispatchSpy.mock.calls[1][0] as any).writes).toEqual([{ tagKey: "cmd_stop", value: true }]);
  });

  it("đọc ghim LỖI ⇒ như hôm nay (dispatcher tự đọc lại ghim; lỗi ở đó không bao giờ là miễn trừ)", async () => {
    pinsState.throws = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      await tool("machine_stop").execute({ machineId: 5 }, ctx);
      expect((dispatchSpy.mock.calls[0][0] as any).writes).toEqual([{ tagKey: "cmd_stop", value: true }]);
    } finally {
      warn.mockRestore();
    }
  });

  it("machine_start / pause / reset KHÔNG đọc ghim, gửi tag của mình (ghim chỉ áp cho lệnh dừng)", async () => {
    pinsState.pins = [{ tagKey: "cmd_stop", value: true }];
    await tool("machine_pause").execute({ machineId: 5 }, ctx);
    expect((dispatchSpy.mock.calls[0][0] as any).writes).toEqual([{ tagKey: "cmd_pause", value: true }]);
    expect(pinsState.calls).toHaveLength(0);
  });
});
