/**
 * ★ Đợt 3a — CSDL CHƯA áp 0393 (cột `chuSoHuu` vắng ⇒ 42703) ⇒ `danhSachDuAnDb` LÙI về ba cột 0337, KHÔNG rơi về danh
 * sách rỗng (mã mới chạy trước migration không được làm biến mất dự án admin). Lỗi khác ⇒ rỗng như cũ.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { cheDo } = vi.hoisted(() => ({ cheDo: { v: "thieu-cot" as "thieu-cot" | "loi-khac" | "du" } }));
vi.mock("./connection", () => ({
  getDb: async () => ({
    select: (cot: Record<string, unknown>) => ({
      from: () => ({
        orderBy: async () => {
          if ("chuSoHuu" in cot && cheDo.v === "thieu-cot") throw Object.assign(new Error('column "chuSoHuu" does not exist'), { code: "42703" });
          if (cheDo.v === "loi-khac") throw Object.assign(new Error("boom"), { code: "57014" });
          return "chuSoHuu" in cot
            ? [{ id: "cn", ten: "Cá nhân", goc: "D:\\x", chuSoHuu: 7, cachTao: "rong" }]
            : [{ id: "adm", ten: "Admin", goc: "D:\\y" }];
        },
      }),
    }),
  }),
}));

import { danhSachDuAnDb } from "./aiRepoDuAn";

beforeEach(() => {
  cheDo.v = "thieu-cot";
});

describe("danhSachDuAnDb — lùi an toàn khi CSDL chưa có 0393", () => {
  it("★★★ 42703 ⇒ đọc ba cột 0337, mọi hàng là mục admin (chuSoHuu null)", async () => {
    expect(await danhSachDuAnDb()).toEqual([{ id: "adm", ten: "Admin", goc: "D:\\y", chuSoHuu: null, cachTao: null }]);
  });
  it("★ CSDL đủ cột ⇒ mang chuSoHuu/cachTao", async () => {
    cheDo.v = "du";
    expect(await danhSachDuAnDb()).toEqual([{ id: "cn", ten: "Cá nhân", goc: "D:\\x", chuSoHuu: 7, cachTao: "rong" }]);
  });
  it("★ lỗi khác ⇒ rỗng (degrade như cũ, không ném)", async () => {
    cheDo.v = "loi-khac";
    expect(await danhSachDuAnDb()).toEqual([]);
  });
});
