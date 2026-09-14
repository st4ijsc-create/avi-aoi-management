/**
 * giuDuLieuTruoc.unit.test.ts — ★ ĐỢT 40 (QA Đợt 39 Pareto #5): giữ dữ liệu lượt trước CHỈ KHI CÙNG NHÀ MÁY.
 *
 * Hai chiều (G5): (+) cùng nhà máy ⇒ giữ (ô trạm không remount giữa hai pha `tangIds`); (−) khác nhà máy /
 * không đọc được khoá / chưa có nhà máy ⇒ KHÔNG giữ (không in máy của A dưới tên B).
 */
import { describe, expect, it } from "vitest";
import { factoryIdCuaKhoa, giuKhiCungNhaMay } from "./giuDuLieuTruoc";

/** Khoá tRPC v11 thật: `[["twinCanh","canhThietKe"], { input, type: "query" }]`. */
const khoa = (factoryId: number, tangIds: number[]) =>
  [["twinCanh", "canhThietKe"], { input: { factoryId, tangIds }, type: "query" }] as const;

describe("factoryIdCuaKhoa — đọc `input.factoryId` từ khoá tRPC", () => {
  it("đọc đúng số từ khoá thật", () => {
    expect(factoryIdCuaKhoa(khoa(1, []))).toBe(1);
    expect(factoryIdCuaKhoa(khoa(18, [28]))).toBe(18);
  });
  it("`null` khi khoá thiếu/ lệch hình — không đoán", () => {
    expect(factoryIdCuaKhoa(undefined)).toBeNull();
    expect(factoryIdCuaKhoa([])).toBeNull();
    expect(factoryIdCuaKhoa([["twinCanh", "canhThietKe"]])).toBeNull();
    expect(factoryIdCuaKhoa([["x"], { type: "query" }])).toBeNull();
    expect(factoryIdCuaKhoa([["x"], { input: { factoryId: "1" } }])).toBeNull();
    expect(factoryIdCuaKhoa([["x"], { input: { factoryId: NaN } }])).toBeNull();
  });
});

describe("giuKhiCungNhaMay — placeholderData của `canhThietKe`", () => {
  const duLieuA = { tram: [{ id: 14 }], may: [{ id: 14 }] };

  it("★ (+) pha 1 → pha 2 CÙNG nhà máy (tangIds [] → [28]) ⇒ GIỮ dữ liệu pha 1 — ô trạm không remount", () => {
    const giu = giuKhiCungNhaMay<typeof duLieuA>(1);
    expect(giu(duLieuA, { queryKey: khoa(1, []) })).toBe(duLieuA);
  });

  it("★ (−) đổi nhà máy (A → B) ⇒ KHÔNG giữ — không in máy của A dưới tên B", () => {
    const giu = giuKhiCungNhaMay<typeof duLieuA>(18);
    expect(giu(duLieuA, { queryKey: khoa(1, [28]) })).toBeUndefined();
  });

  it("(−) chưa có nhà máy (`null`) hoặc chưa có dữ liệu trước ⇒ KHÔNG giữ", () => {
    expect(giuKhiCungNhaMay<typeof duLieuA>(null)(duLieuA, { queryKey: khoa(1, []) })).toBeUndefined();
    expect(giuKhiCungNhaMay<typeof duLieuA>(1)(undefined, { queryKey: khoa(1, []) })).toBeUndefined();
  });

  it("(−) không có `previousQuery` / khoá không đọc được ⇒ KHÔNG giữ (fail-closed về phía không bịa)", () => {
    const giu = giuKhiCungNhaMay<typeof duLieuA>(1);
    expect(giu(duLieuA, undefined)).toBeUndefined();
    expect(giu(duLieuA, { queryKey: undefined })).toBeUndefined();
    expect(giu(duLieuA, { queryKey: [["twinCanh", "canhThietKe"]] })).toBeUndefined();
  });
});
