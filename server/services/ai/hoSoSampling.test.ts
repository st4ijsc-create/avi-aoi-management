/**
 * Lưới cho `hoSoSampling.ts` (B2) — vị từ thuần, không mock.
 *
 * Điều đắt nhất cần canh: **cần gạt ở vị trí mặc định ⇒ KHÔNG một con số nào đổi** (A/B chưa xong thì
 * sản xuất phải y nguyên), và **`minP` chính hãng là số 0 tường minh** (vắng ⇒ server 0,05 ⇒ "chính hãng"
 * giả).
 */
import { describe, it, expect } from "vitest";
import {
  docTenHoSo,
  hoSoSamplingCho,
  HO_SO_CHINH_HANG_NGHI,
  HO_SO_CHINH_HANG_KHONG_NGHI,
  type HoSoSampling,
} from "./hoSoSampling";

const HIEN_TAI_MA: HoSoSampling = { temperature: 0.25, topP: 0.9, repeatPenalty: 1.05 };

describe("docTenHoSo — cần gạt SAI ⇒ hành vi cũ, không phải hồ sơ lạ", () => {
  it("vắng / rỗng / rác / sai chính tả ⇒ hien-tai", () => {
    expect(docTenHoSo(undefined)).toBe("hien-tai");
    expect(docTenHoSo("")).toBe("hien-tai");
    expect(docTenHoSo("   ")).toBe("hien-tai");
    expect(docTenHoSo("chinh_hang")).toBe("hien-tai");
    expect(docTenHoSo("official")).toBe("hien-tai");
  });
  it("chinh-hang — chấp nhận hoa/thường và khoảng trắng quanh", () => {
    expect(docTenHoSo("chinh-hang")).toBe("chinh-hang");
    expect(docTenHoSo("  CHINH-HANG ")).toBe("chinh-hang");
  });
  it("mặc định đọc env `AI_SAMPLING_PROFILE` TẠI THỜI ĐIỂM GỌI", () => {
    const cu = process.env.AI_SAMPLING_PROFILE;
    try {
      delete process.env.AI_SAMPLING_PROFILE;
      expect(docTenHoSo()).toBe("hien-tai");
      process.env.AI_SAMPLING_PROFILE = "chinh-hang";
      expect(docTenHoSo()).toBe("chinh-hang");
    } finally {
      if (cu === undefined) delete process.env.AI_SAMPLING_PROFILE;
      else process.env.AI_SAMPLING_PROFILE = cu;
    }
  });
});

describe("hoSoSamplingCho — hien-tai trả NGUYÊN, chinh-hang tách theo nghĩ thật", () => {
  it("★★★ hien-tai ⇒ trả đúng đối tượng bên gọi đưa (cùng danh tính), bất kể có nghĩ hay không", () => {
    expect(hoSoSamplingCho(HIEN_TAI_MA, true, "hien-tai")).toBe(HIEN_TAI_MA);
    expect(hoSoSamplingCho(HIEN_TAI_MA, false, "hien-tai")).toBe(HIEN_TAI_MA);
  });
  it("chinh-hang + nghĩ thật ⇒ hồ sơ NGHĨ coding", () => {
    expect(hoSoSamplingCho(HIEN_TAI_MA, true, "chinh-hang")).toBe(HO_SO_CHINH_HANG_NGHI);
    expect(HO_SO_CHINH_HANG_NGHI).toEqual({
      temperature: 0.6,
      topP: 0.95,
      topK: 20,
      minP: 0,
      presencePenalty: 0,
      repeatPenalty: 1.0,
    });
  });
  it("chinh-hang + KHÔNG nghĩ thật ⇒ hồ sơ instruct (presence 1,5)", () => {
    expect(hoSoSamplingCho(HIEN_TAI_MA, false, "chinh-hang")).toBe(HO_SO_CHINH_HANG_KHONG_NGHI);
    expect(HO_SO_CHINH_HANG_KHONG_NGHI.presencePenalty).toBe(1.5);
    expect(HO_SO_CHINH_HANG_KHONG_NGHI.topP).toBe(0.8);
  });
  it("★★ `minP` chính hãng là SỐ 0 TƯỒNG MINH ở cả hai hồ sơ (vắng ⇒ server điền 0,05 ⇒ chính hãng giả)", () => {
    for (const hs of [HO_SO_CHINH_HANG_NGHI, HO_SO_CHINH_HANG_KHONG_NGHI]) {
      expect(hs.minP).toBe(0);
      expect(hs.minP).not.toBeUndefined();
      expect(hs.topK).toBe(20);
      expect(hs.repeatPenalty).toBe(1.0);
    }
  });
});
