/**
 * doc 81 Đợt 1D final wave 3 (M8, final review) — commissioning.status KHÔNG hỏng vì đọc ghim DỪNG hỏng.
 * Trước Đợt 1D status chỉ cần commissioning_records; Task 1 thêm `loadStopPins` ⇒ một lỗi đọc tag làm cả status
 * lỗi. Nay: `pinnedStopTags: null` + `pinnedStopTagsUnreadable: true`, phần còn lại của status vẫn trả.
 * Không DB: getDb / commissioningService / stopPin là giả (quyết định commissioned không phải thứ đo ở đây).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const fake = vi.hoisted(() => ({ throwPins: false, pins: [] as Array<{ tagKey: string; value: unknown }> }));

vi.mock("../db", () => ({ getDb: async () => ({}) }));
vi.mock("../services/ot/commissioningService", () => ({
  createRecord: vi.fn(),
  revokeRecord: vi.fn(),
  listRecords: vi.fn(async () => []),
  isCommissioned: vi.fn(async () => true),
  isCommissioningRequired: vi.fn(() => true),
}));
vi.mock("../services/ot/stopPin", () => ({
  loadStopPins: vi.fn(async () => {
    if (fake.throwPins) throw new Error("connection terminated (forced)");
    return fake.pins;
  }),
}));

import { commissioningRouter } from "./commissioningRouter";

const caller = () =>
  commissioningRouter.createCaller({ user: { id: 1, role: "admin", name: "probe-admin", twoFactorEnabled: true } } as any);

beforeEach(() => {
  fake.throwPins = false;
  fake.pins = [];
});

describe("M8 — commissioning.status với đọc ghim DỪNG hỏng", () => {
  it("đọc ghim NÉM ⇒ status VẪN trả (commissioned đúng), pinnedStopTags null + pinnedStopTagsUnreadable true", async () => {
    fake.throwPins = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const st = await caller().status({ adapterId: 42 });
      expect(st).toMatchObject({ adapterId: 42, required: true, commissioned: true, wouldForceSimulated: false });
      expect(st.pinnedStopTags).toBeNull();
      expect(st.pinnedStopTagsUnreadable).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });

  it("đọc ghim được ⇒ danh sách ghim + pinnedStopTagsUnreadable false (rỗng vẫn là [] chứ không null)", async () => {
    fake.pins = [{ tagKey: "cmd_stop", value: true }];
    const st = await caller().status({ adapterId: 42 });
    expect(st.pinnedStopTags).toEqual([{ tagKey: "cmd_stop", value: true }]);
    expect(st.pinnedStopTagsUnreadable).toBe(false);
    fake.pins = [];
    const st2 = await caller().status({ adapterId: 42 });
    expect(st2.pinnedStopTags).toEqual([]);
    expect(st2.pinnedStopTagsUnreadable).toBe(false);
  });
});
