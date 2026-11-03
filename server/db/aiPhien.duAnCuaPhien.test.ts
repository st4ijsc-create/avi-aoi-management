/**
 * G3 — kho.duAnCuaPhien phân biệt "không có hàng" (NOT_FOUND) với "lỗi đọc" (LOI): router phải fail-closed khi lỗi đọc (luong-ui rà 6e0b59ef2).
 * Không DB: getDb là bản giả.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let cheDo: "hang" | "rong" | "ném" | "khongDb" = "hang";
let duAnHang: string | null = "da-1";
vi.mock("./connection", () => ({
  getDb: async () =>
    cheDo === "khongDb"
      ? null
      : {
          select: () => ({
            from: () => ({
              where: () => ({
                limit: async () => {
                  if (cheDo === "ném") throw new Error("db lỗi một lần");
                  return cheDo === "rong" ? [] : [{ p: duAnHang }];
                },
              }),
            }),
          }),
        },
}));

import { duAnCuaPhien } from "./aiPhien";

const ID = "11111111-1111-4111-8111-111111111111";
beforeEach(() => {
  cheDo = "hang";
  duAnHang = "da-1";
});

describe("duAnCuaPhien — ba kết cục khác nhau", () => {
  it("có hàng ⇒ ok + projectId; hàng di sản ⇒ projectId null", async () => {
    expect(await duAnCuaPhien(7, ID)).toEqual({ ok: true, projectId: "da-1" });
    duAnHang = null;
    expect(await duAnCuaPhien(7, ID)).toEqual({ ok: true, projectId: null });
  });
  it("★ không có hàng của người này ⇒ NOT_FOUND", async () => {
    cheDo = "rong";
    expect(await duAnCuaPhien(7, ID)).toEqual({ ok: false, ma: "NOT_FOUND" });
  });
  it("★ LỖI ĐỌC (SELECT ném) ⇒ LOI — KHÔNG phải NOT_FOUND/ok (router không được coi là 'cho qua')", async () => {
    cheDo = "ném";
    expect(await duAnCuaPhien(7, ID)).toEqual({ ok: false, ma: "LOI" });
  });
  it("DB vắng ⇒ LOI; id/người sai hình ⇒ NOT_FOUND", async () => {
    cheDo = "khongDb";
    expect(await duAnCuaPhien(7, ID)).toEqual({ ok: false, ma: "LOI" });
    cheDo = "hang";
    expect(await duAnCuaPhien(0, ID)).toEqual({ ok: false, ma: "NOT_FOUND" });
    expect(await duAnCuaPhien(7, "khong-phai-uuid")).toEqual({ ok: false, ma: "NOT_FOUND" });
  });
});
