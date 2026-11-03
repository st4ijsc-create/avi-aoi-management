/**
 * G1 — aiPhien.themLuot XÁC MINH dấu nguồn model ngoài (không DB: getDb và bộ xác minh là bản giả; bản thật ở aiPhien.db.test.ts).
 * Lỗi gốc: client ghi câu trả lời model ngoài vào phiên mà coLuotNgoai vẫn false ⇒ lịch sử đó về sau được tin như local.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const xacMinh = vi.fn(async (..._a: unknown[]): Promise<boolean> => false);
vi.mock("../services/ai/ngoai/dauNguon", () => ({ xacMinhPhienCoLuotNgoai: (...a: unknown[]) => xacMinh(...a) }));

let hang: { turns: unknown; version: number; title: string } | null = { turns: [], version: 3, title: "t" };
const dauVet: { set: Array<Record<string, unknown>>; nhanUpdate: number } = { set: [], nhanUpdate: 0 };
vi.mock("./connection", () => ({
  getDb: async () => ({
    select: () => ({ from: () => ({ where: () => ({ limit: async () => (hang ? [hang] : []) }) }) }),
    update: () => ({
      set: (s: Record<string, unknown>) => {
        dauVet.nhanUpdate++;
        dauVet.set.push(s);
        return { where: () => ({ returning: async () => [{ version: 4 }] }) };
      },
    }),
  }),
}));

import { themLuot } from "./aiPhien";

const ID = "11111111-1111-4111-8111-111111111111";
const them = (over: Record<string, unknown> = {}) =>
  themLuot(7, { sessionId: ID, expectedVersion: 3, luot: [{ role: "user", content: "hỏi" }, { role: "assistant", content: "TRẢ LỜI NGOÀI" }], ...over });

beforeEach(() => {
  xacMinh.mockReset();
  xacMinh.mockResolvedValue(false);
  hang = { turns: [], version: 3, title: "t" };
  dauVet.set = [];
  dauVet.nhanUpdate = 0;
});

describe("themLuot — dấu nguồn model ngoài", () => {
  it("★ bộ xác minh nhận ĐÚNG người, CHỈ các lượt assistant của lần ghi này và id client khai", async () => {
    await them({ ngoaiCallIds: [11, 12] });
    expect(xacMinh).toHaveBeenCalledTimes(1);
    expect(xacMinh.mock.calls[0][1]).toEqual({ userId: 7, traLoi: ["TRẢ LỜI NGOÀI"], ngoaiCallIds: [11, 12] });
  });
  it("★ KHÔNG gửi id vẫn gọi bộ xác minh (tự dò theo băm) — client không rửa dấu bằng cách bỏ id", async () => {
    await them();
    expect(xacMinh).toHaveBeenCalledTimes(1);
    expect(xacMinh.mock.calls[0][1]).toMatchObject({ ngoaiCallIds: null });
  });
  it("★ xác minh true ⇒ coLuotNgoai:true nằm TRONG CÙNG câu UPDATE với lượt (một update duy nhất)", async () => {
    xacMinh.mockResolvedValue(true);
    const r = await them();
    expect(r).toMatchObject({ ok: true });
    expect(dauVet.nhanUpdate).toBe(1);
    expect(dauVet.set[0]).toMatchObject({ coLuotNgoai: true, turnCount: 2 });
    expect(Array.isArray(dauVet.set[0].turns)).toBe(true);
  });
  it("★ ĐƠN ĐIỆU: xác minh false ⇒ UPDATE KHÔNG mang khoá coLuotNgoai (không bao giờ ghi false đè true)", async () => {
    xacMinh.mockResolvedValue(false);
    await them();
    expect(dauVet.set[0]).not.toHaveProperty("coLuotNgoai");
  });
  it("★ id lệch (NGOAI_KHONG_TON_TAI) ⇒ DAU_NGUON_LECH và KHÔNG ghi gì", async () => {
    xacMinh.mockRejectedValue(Object.assign(new Error("x"), { ma: "NGOAI_KHONG_TON_TAI" }));
    expect(await them({ ngoaiCallIds: [999] })).toEqual({ ok: false, ma: "DAU_NGUON_LECH" });
    expect(dauVet.nhanUpdate).toBe(0);
  });
  it("★ lỗi lạ của bộ xác minh ⇒ LOI và KHÔNG ghi (fail-closed, không rơi về 'cứ ghi')", async () => {
    xacMinh.mockRejectedValue(new Error("db sập"));
    expect(await them()).toMatchObject({ ok: false, ma: "LOI" });
    expect(dauVet.nhanUpdate).toBe(0);
  });
  it("id sai hình (âm · 0 · không nguyên · >50 · không phải mảng) ⇒ THAM_SO_SAI, chưa chạm bộ xác minh/DB", async () => {
    for (const bad of [[-1], [0], [1.5], new Array(51).fill(1), "1", [null]]) {
      expect(await them({ ngoaiCallIds: bad }), JSON.stringify(bad)).toEqual({ ok: false, ma: "THAM_SO_SAI" });
    }
    expect(xacMinh).not.toHaveBeenCalled();
    expect(dauVet.nhanUpdate).toBe(0);
  });
  it("CONFLICT (version lệch) ⇒ không gọi bộ xác minh, không ghi", async () => {
    hang = { turns: [], version: 9, title: "t" };
    expect(await them()).toMatchObject({ ok: false, ma: "CONFLICT", versionHienTai: 9 });
    expect(xacMinh).not.toHaveBeenCalled();
    expect(dauVet.nhanUpdate).toBe(0);
  });
  it("phiên không phải của người này / không có ⇒ NOT_FOUND, không xác minh", async () => {
    hang = null;
    expect(await them()).toMatchObject({ ok: false, ma: "NOT_FOUND" });
    expect(xacMinh).not.toHaveBeenCalled();
  });
  it("lần ghi chỉ có lượt user ⇒ traLoi rỗng (vẫn hỏi bộ xác minh; nó trả false khi không id)", async () => {
    await them({ luot: [{ role: "user", content: "chỉ hỏi" }] });
    expect(xacMinh.mock.calls[0][1]).toMatchObject({ traLoi: [] });
  });
});
