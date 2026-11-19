/**
 * (HST 15/11) bản ghi ngân sách HIỆU DỤNG vào `bat-dau.model.nganSachNguCanh` cho máy đo cờ ép. THUẦN.
 * ĐỘT BIẾN PHẢI ĐỎ: "không ghi trường khi giá trị bị bỏ qua" (chỉ ghi khi giá trị hợp lệ) · "ghi cả khi biến vắng" · "ghi số ép thay số
 * hiệu dụng" · "sao chép đối tượng khi vắng" (đổi định danh / thứ tự khoá).
 */
import { describe, expect, it } from "vitest";
import { GIOI_HAN_MAC_DINH, type ThongTinModelBatDau } from "@shared/agentCore";
import { banGhiNganSachBatDau, ganNganSachVaoThongTin } from "./ghiNganSachBatDau";

const ttCucBo = { vaiTro: "code.software", model: "Qwen3.6-35B-A3B-UD-Q4_K_XL", nguon: "gan-env", bangChung: "x" } as unknown as ThongTinModelBatDau;

describe("banGhiNganSachBatDau", () => {
  it("biến VẮNG ⇒ null (không ghi gì)", () => {
    expect(banGhiNganSachBatDau({}, { nganSachNguCanhToken: 28_672 })).toBeNull();
    expect(banGhiNganSachBatDau({ AI_AGENT_NGAN_SACH_EPX: "1" }, undefined)).toBeNull();
  });
  it("biến có mặt, hợp lệ ⇒ ghi số HIỆU DỤNG của gioiHan", () => {
    expect(banGhiNganSachBatDau({ AI_AGENT_NGAN_SACH_EP: "28672" }, { nganSachNguCanhToken: 28_672 })).toEqual({ nganSachNguCanh: 28_672 });
  });
  it("biến có mặt nhưng GIÁ TRỊ LẠ (bị bỏ qua) ⇒ trường VẪN có = ngân sách thật (máy đo thấy lệch 28 672)", () => {
    for (const v of ["abc", "", "-1", "100000"]) {
      expect(banGhiNganSachBatDau({ AI_AGENT_NGAN_SACH_EP: v }, { nganSachNguCanhToken: 65_536 })).toEqual({ nganSachNguCanh: 65_536 });
    }
  });
  it("có mặt mà gioiHan không mang ngân sách (hỏi ngân sách ném / lượt không hỏi) ⇒ ghi mặc định lõi 65 536, KHÔNG số ép", () => {
    expect(GIOI_HAN_MAC_DINH.nganSachNguCanhToken).toBe(65_536);
    expect(banGhiNganSachBatDau({ AI_AGENT_NGAN_SACH_EP: "28672" }, undefined)).toEqual({ nganSachNguCanh: 65_536 });
    expect(banGhiNganSachBatDau({ AI_AGENT_NGAN_SACH_EP: "28672" }, { soLuotToiDa: 30 })).toEqual({ nganSachNguCanh: 65_536 });
  });
});

describe("ganNganSachVaoThongTin", () => {
  it("ghi null ⇒ trả NGUYÊN đối tượng (cùng định danh, cùng JSON từng byte)", () => {
    const ra = ganNganSachVaoThongTin(ttCucBo, null);
    expect(ra).toBe(ttCucBo);
    expect(JSON.stringify(ra)).toBe(JSON.stringify(ttCucBo));
  });
  it("có ghi ⇒ thêm đúng một khoá ở CUỐI, khoá cũ giữ thứ tự", () => {
    const ra = ganNganSachVaoThongTin(ttCucBo, { nganSachNguCanh: 28_672 });
    expect(Object.keys(ra)).toEqual([...Object.keys(ttCucBo), "nganSachNguCanh"]);
    expect(ra.nganSachNguCanh).toBe(28_672);
    expect(ttCucBo.nganSachNguCanh).toBeUndefined();
  });
});
