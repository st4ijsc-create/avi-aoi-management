/**
 * SCADA R1b-1 Task 7 — bộ điều tiết dòng attempts: thuần RAM, `now` tiêm vào.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CUA_SO_MS,
  MA_ON,
  TRAN_KHOA,
  TRAN_MOI_PHUT,
  __datLaiDieuTiet,
  __henXaDangChay,
  __soKhoaDieuTiet,
  batXaTongKet,
  laMaOn,
  layTongKetHetHan,
  nenGhiThuLenh,
} from "./dieuTietThuLenh";

beforeEach(() => __datLaiDieuTiet());
afterEach(() => vi.useRealTimers());

describe("hằng số", () => {
  it("MA_ON đúng bốn mã ồn; trần 30/phút; cửa sổ 60 s", () => {
    expect([...MA_ON]).toEqual(["DA_XU_LY", "HET_HAN", "NOT_FOUND", "TOTP_CAN"]);
    expect(TRAN_MOI_PHUT).toBe(30);
    expect(CUA_SO_MS).toBe(60_000);
  });
  it("laMaOn: mã an toàn / không có ⇒ false", () => {
    for (const ma of MA_ON) expect(laMaOn(ma)).toBe(true);
    for (const ma of ["MODE_LOCAL", "INTERLOCK_BLOCKED", "ROLE_FLOOR", "TOTP_SAI", "DIEU_TIET", "", null, undefined]) expect(laMaOn(ma as never)).toBe(false);
  });
});

describe("nenGhiThuLenh", () => {
  it("30 dòng đầu trong cửa sổ ⇒ ghi; dòng 31 trở đi ⇒ không ghi", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 30; i++) expect(nenGhiThuLenh(1, "DA_XU_LY", t0 + i * 100)).toEqual({ ghi: true });
    for (let i = 0; i < 70; i++) expect(nenGhiThuLenh(1, "DA_XU_LY", t0 + 3_000 + i)).toEqual({ ghi: false });
  });

  it("cửa sổ tính từ dòng ĐẦU TIÊN, không trượt theo dòng sau: 59,999 s vẫn trong cửa sổ, 60 s là cửa sổ mới", () => {
    const t0 = 5_000;
    expect(nenGhiThuLenh(1, "HET_HAN", t0)).toEqual({ ghi: true });
    for (let i = 0; i < 29; i++) nenGhiThuLenh(1, "HET_HAN", t0 + 1_000);
    expect(nenGhiThuLenh(1, "HET_HAN", t0 + CUA_SO_MS - 1)).toEqual({ ghi: false });
    // cửa sổ kết thúc, 1 dòng bị gộp ⇒ tổng kết
    expect(nenGhiThuLenh(1, "HET_HAN", t0 + CUA_SO_MS)).toEqual({ ghi: "tong_ket", soLan: 1, stage: "request" });
  });

  it("tổng kết đếm ĐÚNG số dòng bị gộp; dòng hiện tại mở cửa sổ mới với đếm 1 (29 dòng nữa được ghi, rồi lại chặn)", () => {
    const t0 = 0;
    for (let i = 0; i < 100; i++) nenGhiThuLenh(2, "DA_XU_LY", t0 + i);
    expect(nenGhiThuLenh(2, "DA_XU_LY", t0 + 70_000)).toEqual({ ghi: "tong_ket", soLan: 70, stage: "request" });
    for (let i = 0; i < 29; i++) expect(nenGhiThuLenh(2, "DA_XU_LY", t0 + 70_001 + i)).toEqual({ ghi: true });
    expect(nenGhiThuLenh(2, "DA_XU_LY", t0 + 70_100)).toEqual({ ghi: false });
  });

  it("cửa sổ kết thúc mà KHÔNG có dòng bị gộp ⇒ ghi bình thường, không tổng kết", () => {
    for (let i = 0; i < 5; i++) nenGhiThuLenh(3, "NOT_FOUND", i);
    expect(nenGhiThuLenh(3, "NOT_FOUND", 100_000)).toEqual({ ghi: true });
  });

  it("tổng kết chỉ phát MỘT lần", () => {
    for (let i = 0; i < 40; i++) nenGhiThuLenh(4, "TOTP_CAN", i);
    expect(nenGhiThuLenh(4, "TOTP_CAN", 70_000)).toEqual({ ghi: "tong_ket", soLan: 10, stage: "request" });
    expect(nenGhiThuLenh(4, "TOTP_CAN", 70_001)).toEqual({ ghi: true });
  });

  it("khoá = (người, mã): mã khác / người khác có cửa sổ riêng", () => {
    for (let i = 0; i < 40; i++) nenGhiThuLenh(5, "DA_XU_LY", 10 + i);
    expect(nenGhiThuLenh(5, "DA_XU_LY", 100)).toEqual({ ghi: false });
    expect(nenGhiThuLenh(5, "HET_HAN", 100)).toEqual({ ghi: true });
    expect(nenGhiThuLenh(6, "DA_XU_LY", 100)).toEqual({ ghi: true });
  });

  it("dọn khoá: khoá cũ không còn tổng kết treo bị quét; khoá còn tổng kết treo được GIỮ", () => {
    nenGhiThuLenh(10, "DA_XU_LY", 0); // sạch
    for (let i = 0; i < 40; i++) nenGhiThuLenh(11, "DA_XU_LY", 0); // 10 bị gộp, treo
    expect(__soKhoaDieuTiet()).toBe(2);
    nenGhiThuLenh(12, "DA_XU_LY", 3 * CUA_SO_MS); // kích hoạt quét
    expect(__soKhoaDieuTiet()).toBe(2); // khoá 10 bị quét, khoá 11 giữ, khoá 12 mới
    expect(nenGhiThuLenh(11, "DA_XU_LY", 3 * CUA_SO_MS + 1)).toEqual({ ghi: "tong_ket", soLan: 10, stage: "request" });
  });

  it("trần cứng: bị dò nhiều người ⇒ số khoá không vượt TRAN_KHOA", () => {
    for (let i = 0; i < TRAN_KHOA + 500; i++) nenGhiThuLenh(100_000 + i, "NOT_FOUND", 1);
    expect(__soKhoaDieuTiet()).toBeLessThanOrEqual(TRAN_KHOA);
  });
});

describe("R1b-2a T9 — xả tổng kết cho người ngừng hẳn", () => {
  it("nhớ stage của dòng bị gộp CUỐI; layTongKetHetHan lấy + XOÁ cửa sổ hết hạn (lần hai rỗng)", () => {
    for (let i = 0; i < 30; i++) nenGhiThuLenh(5, "DA_XU_LY", 0, "request");
    nenGhiThuLenh(5, "DA_XU_LY", 1, "request");
    nenGhiThuLenh(5, "DA_XU_LY", 2, "confirm");
    expect(layTongKetHetHan(CUA_SO_MS - 1)).toEqual([]); // chưa hết hạn
    expect(layTongKetHetHan(CUA_SO_MS)).toEqual([{ userId: 5, reasonCode: "DA_XU_LY", stage: "confirm", soLan: 2 }]);
    expect(layTongKetHetHan(CUA_SO_MS + 1)).toEqual([]); // đã xoá ⇒ không tổng kết thứ hai
    expect(nenGhiThuLenh(5, "DA_XU_LY", CUA_SO_MS + 2)).toEqual({ ghi: true }); // quay lại: cửa sổ mới, không tổng kết
  });

  it("cửa sổ không có dòng bị gộp ⇒ không có tổng kết", () => {
    for (let i = 0; i < 30; i++) nenGhiThuLenh(6, "HET_HAN", 0);
    expect(layTongKetHetHan(10 * CUA_SO_MS)).toEqual([]);
  });

  it("100 DA_XU_LY (confirm) rồi IM ⇒ sau 61 s hẹn giờ ghi ĐÚNG MỘT lần {70, confirm}; người đó quay lại ⇒ {ghi:true}; hẹn giờ đã dừng", async () => {
    vi.useFakeTimers();
    const ghi = vi.fn(async () => {});
    batXaTongKet(ghi);
    expect(__henXaDangChay()).toBe(false); // bật LƯỜI: chưa có dòng bị gộp
    for (let i = 0; i < 100; i++) nenGhiThuLenh(7, "DA_XU_LY", Date.now(), "confirm");
    expect(__henXaDangChay()).toBe(true);
    await vi.advanceTimersByTimeAsync(61_000);
    expect(ghi).toHaveBeenCalledTimes(1);
    expect(ghi).toHaveBeenCalledWith({ userId: 7, reasonCode: "DA_XU_LY", stage: "confirm", soLan: 70 });
    expect(__henXaDangChay()).toBe(false);
    // quay lại sau khi đã xả: dòng được ghi, KHÔNG có tổng kết thứ hai
    expect(nenGhiThuLenh(7, "DA_XU_LY", Date.now(), "confirm")).toEqual({ ghi: true });
    await vi.advanceTimersByTimeAsync(5 * CUA_SO_MS);
    expect(ghi).toHaveBeenCalledTimes(1);
  });

  it("gọi batXaTongKet nhiều lần là idempotent (một hẹn giờ); lỗi của `ghi` chỉ log, không ném; hẹn giờ vẫn tự dừng", async () => {
    vi.useFakeTimers();
    const ghi = vi.fn(async () => {
      throw new Error("db sập");
    });
    batXaTongKet(ghi);
    batXaTongKet(ghi);
    batXaTongKet(ghi);
    for (let i = 0; i < 40; i++) nenGhiThuLenh(8, "TOTP_CAN", Date.now(), "confirm");
    await vi.advanceTimersByTimeAsync(61_000);
    expect(ghi).toHaveBeenCalledTimes(1);
    expect(__henXaDangChay()).toBe(false);
  });

  it("không đăng ký bộ xả ⇒ không bao giờ hẹn giờ (hành vi R1b-1 giữ nguyên)", () => {
    vi.useFakeTimers();
    for (let i = 0; i < 40; i++) nenGhiThuLenh(9, "TOTP_CAN", Date.now());
    expect(__henXaDangChay()).toBe(false);
  });
});
