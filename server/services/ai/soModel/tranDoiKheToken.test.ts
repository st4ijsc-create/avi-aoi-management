/**
 * ★ Đợt 9 (audit kiem-dinh M4, dieu-phoi duyệt N = 3 / 10 phút trượt / một token /v1) — trần đổi khe THEO TOKEN.
 * Trạng thái trong bộ nhớ: khởi động lại tiến trình ⇒ reset (chấp nhận, ghi trong docblock module).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CUA_SO_MS, TRAN_DOI_KHE, __xoaTranDoiKhe, chayVoiTokenKhe, ghiDoiKheTheoNguCanh, vuotTranDoiKhe } from "./tranDoiKheToken";

describe("tranDoiKheToken", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-21T08:00:00Z"));
    __xoaTranDoiKhe();
  });
  afterEach(() => vi.useRealTimers());

  it("hằng đã duyệt: 3 lần / 10 phút", () => {
    expect(TRAN_DOI_KHE).toBe(3);
    expect(CUA_SO_MS).toBe(10 * 60_000);
  });

  it("đếm theo NGỮ CẢNH token; chạm 3 ⇒ vượt trần; token khác không bị ảnh hưởng; ngoài ngữ cảnh ⇒ không đếm", async () => {
    for (let i = 0; i < 2; i++) await chayVoiTokenKhe("token:1", async () => ghiDoiKheTheoNguCanh());
    expect(vuotTranDoiKhe("token:1")).toBe(false);
    await chayVoiTokenKhe("token:1", async () => ghiDoiKheTheoNguCanh());
    expect(vuotTranDoiKhe("token:1")).toBe(true);
    expect(vuotTranDoiKhe("token:2")).toBe(false);
    ghiDoiKheTheoNguCanh(); // không có ngữ cảnh (app, không phải /v1) ⇒ bỏ qua
    expect(vuotTranDoiKhe("token:2")).toBe(false);
  });

  it("cửa sổ TRƯỢT: lần đổi cũ hơn 10 phút rơi khỏi cửa sổ ⇒ hết vượt trần", async () => {
    for (let i = 0; i < 3; i++) {
      await chayVoiTokenKhe("token:1", async () => ghiDoiKheTheoNguCanh());
      vi.advanceTimersByTime(60_000);
    }
    expect(vuotTranDoiKhe("token:1")).toBe(true);
    vi.advanceTimersByTime(CUA_SO_MS - 3 * 60_000 + 60_001); // lần đầu (t=0) vừa ra khỏi cửa sổ
    expect(vuotTranDoiKhe("token:1")).toBe(false);
  });

  it("log MỘT lần mỗi cửa sổ khi chạm trần (không log mỗi yêu cầu)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (let i = 0; i < 3; i++) await chayVoiTokenKhe("token:9", async () => ghiDoiKheTheoNguCanh());
    for (let i = 0; i < 5; i++) vuotTranDoiKhe("token:9");
    expect(warn.mock.calls.filter((c) => String(c[0]).includes("tran-doi-khe-token"))).toHaveLength(1);
    warn.mockRestore();
  });
});

describe("chonModelKhiVuotTran — vượt trần ⇒ model nặng KHÁC khe đang giữ được thay bằng model khe đang giữ", async () => {
  const { chonModelKhiVuotTran } = await import("./tranDoiKheToken");
  const nang = (m: string) => ["Q35", "Q27"].includes(m);
  it("nặng khác khe ⇒ đổi sang model đang giữ; nặng = khe / nhẹ ⇒ giữ nguyên; undefined ⇒ xét model mặc định", () => {
    expect(chonModelKhiVuotTran("Q27", { giu: "Q35", laKheNang: nang, modelMacDinh: "Q35" })).toEqual({ model: "Q35", doi: true });
    expect(chonModelKhiVuotTran("Q35", { giu: "Q35", laKheNang: nang, modelMacDinh: "Q35" })).toEqual({ model: "Q35", doi: false });
    expect(chonModelKhiVuotTran("4B", { giu: "Q27", laKheNang: nang, modelMacDinh: "Q35" })).toEqual({ model: "4B", doi: false });
    expect(chonModelKhiVuotTran(undefined, { giu: "Q27", laKheNang: nang, modelMacDinh: "Q35" })).toEqual({ model: "Q27", doi: true });
    // khe không đọc được ⇒ không đoán
    expect(chonModelKhiVuotTran("Q27", { giu: null, laKheNang: nang, modelMacDinh: "Q35" })).toEqual({ model: "Q27", doi: false });
  });
});
