/**
 * kiem-dinh R1b-1 H1 (b) (2026-10-25) — `phanLoaiGhimStopHmi` THUẦN: STOP HMI (`dungMay`) chỉ gửi ghim của tag mức tác động ≤ 1; mức NULL ⇒ 5
 * (cùng phép suy `kenhScada.mucTacDongKenh`, fail-closed) ⇒ bỏ qua; giá trị mức lạ lúc chạy (0, 2, 1.5, NaN) ⇒ bỏ qua. Ghim không hợp lệ (tag tắt /
 * không ghi được / sai kiểu) không vào bên nào (luật `stopPinsFromTagRows`).
 */
import { describe, expect, it } from "vitest";
import { MUC_TOI_DA_STOP_HMI, phanLoaiGhimStopHmi, type StopPinTagRowMuc } from "./stopPin";

const hang = (tagKey: string, actuationLevel: number | null, o: Partial<StopPinTagRowMuc> = {}): StopPinTagRowMuc => ({
  tagKey,
  dataType: "int",
  stopValue: 0,
  writable: true,
  isEnabled: true,
  actuationLevel,
  ...o,
});

describe("kiem-dinh H1 (b) — phanLoaiGhimStopHmi", () => {
  it("mức tối đa của STOP HMI là 1", () => {
    expect(MUC_TOI_DA_STOP_HMI).toBe(1);
  });

  it("★ mức 1 ⇒ gửi; mức 3 / 4 / 5 ⇒ bỏ qua (ly_do muc_cao, mức hiệu lực); NULL ⇒ bỏ qua với mức 5", () => {
    const kq = phanLoaiGhimStopHmi([hang("a1", 1), hang("b3", 3), hang("c4", 4), hang("d5", 5), hang("e_null", null)]);
    expect(kq.gui).toEqual([{ tagKey: "a1", value: 0 }]);
    expect(kq.boQua).toEqual([
      { tagKey: "b3", ly_do: "muc_cao", muc: 3 },
      { tagKey: "c4", ly_do: "muc_cao", muc: 4 },
      { tagKey: "d5", ly_do: "muc_cao", muc: 5 },
      { tagKey: "e_null", ly_do: "muc_cao", muc: 5 },
    ]);
  });

  it("giá trị mức lạ lúc chạy (0, 2, 1.5, NaN) ⇒ bỏ qua (fail-closed), không bao giờ gửi", () => {
    const kq = phanLoaiGhimStopHmi([hang("m0", 0), hang("m2", 2), hang("m15", 1.5), hang("mnan", Number.NaN)]);
    expect(kq.gui).toEqual([]);
    expect(kq.boQua.map((b) => b.tagKey)).toEqual(["m0", "m2", "m15", "mnan"]);
  });

  it("ghim không hợp lệ (tag tắt / không ghi được / không ghim / sai kiểu) ⇒ không vào gửi lẫn bỏ qua", () => {
    const kq = phanLoaiGhimStopHmi([
      hang("tat", 1, { isEnabled: false }),
      hang("chi_doc", 4, { writable: false }),
      hang("khong_ghim", 1, { stopValue: null }),
      hang("sai_kieu", 4, { stopValue: "x" }),
    ]);
    expect(kq).toEqual({ gui: [], boQua: [] });
  });
});
