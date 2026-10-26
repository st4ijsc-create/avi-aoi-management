/**
 * ★ Đợt 10.1 — `aiChonModel.danhMuc` qua caller tRPC thật. Cổng giấy phép MOD_AI tắt Ở ĐÂY (cùng khuôn
 * `aiGgufRouter.thinkingLeak.test.ts`) — chiều giấy phép đo ở `congGiayPhepAiCensus.test.ts` + `moduleGate.congGiayPhep.test.ts`.
 */
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.LICENSE_MODULE_GATE_ENABLED = "false";
});

const h = vi.hoisted(() => ({ factoryIds: [3, 5] as number[] | null, nhaMayNhan: [] as Array<number | null> }));

vi.mock("../db/reportAggregators", () => ({
  resolveTenantFactoryScope: vi.fn(async () => ({ factoryIds: h.factoryIds, labels: {} })),
}));

vi.mock("../services/ai/chonModel/danhMuc", async (importOriginal) => {
  const goc = await importOriginal<typeof import("../services/ai/chonModel/danhMuc")>();
  const { NGOAI_RONG } = await import("../services/ai/chonModel/kieu");
  return {
    ...goc,
    layPhuThuocDanhMucMacDinh: async () => ({
      anh: { taiLuc: 1, vaiTro: new Map(), profile: new Map(), gan: [] },
      hoSoCoDo: new Set<string>(),
      kheDangGiu: null,
      uocTinhDoiKheGiay: async () => null,
      ngoai: {
        layModelDaBat: async (f: number | null) => {
          h.nhaMayNhan.push(f);
          return NGOAI_RONG.layModelDaBat(f);
        },
      },
    }),
  };
});

import { aiChonModelRouter } from "./aiChonModelRouter";

describe("aiChonModel.danhMuc", () => {
  it("người dùng thường (không admin) có MOD_AI ⇒ auto + 11 vai trò; nhà máy = nhà máy đầu của phạm vi", async () => {
    h.nhaMayNhan = [];
    const ds = await aiChonModelRouter.createCaller({ user: { id: 9, role: "user" } } as any).danhMuc();
    expect(ds[0]!.ma).toBe("auto");
    expect(ds.filter((m) => m.loai === "vai-tro")).toHaveLength(11);
    expect(h.nhaMayNhan).toEqual([3]);
  });

  it("admin không gắn nhà máy (phạm vi null) ⇒ nhà máy null (không có mục ngoài)", async () => {
    h.factoryIds = null;
    h.nhaMayNhan = [];
    await aiChonModelRouter.createCaller({ user: { id: 1, role: "admin" } } as any).danhMuc();
    expect(h.nhaMayNhan).toEqual([null]);
  });

  it("chưa đăng nhập ⇒ UNAUTHORIZED", async () => {
    await expect(aiChonModelRouter.createCaller({ user: null } as any).danhMuc()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
