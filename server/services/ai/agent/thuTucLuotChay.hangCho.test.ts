/** Đợt 11.8 · UX-D09 — vị trí hàng chờ model: chỉ SỐ, quyền, cổng tắt ⇒ null. */
import { describe, expect, it } from "vitest";
import { thuTucTrangThaiHangCho, tinhPhiaTruocHangCho } from "./thuTucLuotChay";

const tk = (o: Partial<{ batCong: boolean; dangChay: number; td: number; ag: number; nen: number }> = {}) => ({
  batCong: o.batCong ?? true,
  dangChay: o.dangChay ?? 0,
  dangCho: { "tuong-tac": o.td ?? 0, agent: o.ag ?? 0, nen: o.nen ?? 0 },
});

describe("tinhPhiaTruocHangCho", () => {
  it("đang chạy + chờ tương tác + chờ agent; KHÔNG tính mức nền", () => {
    expect(tinhPhiaTruocHangCho(tk())).toBe(0);
    expect(tinhPhiaTruocHangCho(tk({ dangChay: 1, td: 2, ag: 3, nen: 9 }))).toBe(6);
  });
  it("cổng ưu tiên TẮT ⇒ null", () => {
    expect(tinhPhiaTruocHangCho(tk({ batCong: false, dangChay: 5 }))).toBeNull();
  });
  it("số âm / thiếu ⇒ kẹp về 0", () => {
    expect(tinhPhiaTruocHangCho({ batCong: true, dangChay: -3, dangCho: { "tuong-tac": -1, agent: 2, nen: 0 } })).toBe(2);
  });
});

describe("thuTucTrangThaiHangCho", () => {
  it("người không có ai_repo_read (id không hợp lệ) ⇒ PERMISSION_DENIED, không đọc hàng chờ", async () => {
    let doc = 0;
    const r = await thuTucTrangThaiHangCho({ id: 0, role: "operator" }, () => {
      doc++;
      return { ...tk(), cacMuc: [] } as never;
    });
    expect(r).toMatchObject({ ok: false, note: "PERMISSION_DENIED", phiaTruoc: null });
    expect(doc).toBe(0);
  });
});
