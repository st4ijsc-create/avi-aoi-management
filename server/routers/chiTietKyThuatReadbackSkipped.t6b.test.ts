/**
 * SCADA R1b-2b-2a T6b polish (review m2) — hàng `command_log` của write ĐÃ acked mà đọc lại bị BỎ (lô có write "không rõ", `otDeviceWrite.lyDoBoDocLai`)
 * mang `errorText` "readback skipped: …" + status `acked_unverified`. Người xem bị che chi tiết thấy MÃ `READBACK_UNAVAILABLE` ("Đã ghi nhưng không đọc
 * lại được — kiểm tra tại máy"), không phải `TECHNICAL_ERROR` và không phải `TIMEOUT` (câu chung có chữ "outcome unknown" nhưng write NÀY đã áp).
 */
import { describe, it, expect } from "vitest";
import { maLoiCua, MA_LOI_DA_BIET } from "./_chiTietKyThuat";
import { LY_DO_BO_DOC_LAI_KHONG_RO, LY_DO_BO_DOC_LAI_MAT_LIEN_KET, LY_DO_BO_DOC_LAI_QUA_HAN } from "../services/ot/otDeviceWrite";

describe("T6b polish — maLoiCua('readback skipped: …')", () => {
  it("READBACK_UNAVAILABLE là mã ĐÃ BIẾT (có trong MA_LOI_DA_BIET)", () => {
    expect((MA_LOI_DA_BIET as readonly string[]).includes("READBACK_UNAVAILABLE")).toBe(true);
  });

  for (const cau of [LY_DO_BO_DOC_LAI_MAT_LIEN_KET, LY_DO_BO_DOC_LAI_QUA_HAN, LY_DO_BO_DOC_LAI_KHONG_RO]) {
    it(`★ "${cau}" + acked_unverified ⇒ READBACK_UNAVAILABLE`, () => {
      expect(maLoiCua(cau, "acked_unverified")).toBe("READBACK_UNAVAILABLE");
    });
  }

  it("write 'không rõ' của cùng lô (status timeout, câu T17) vẫn ⇒ TIMEOUT", () => {
    expect(maLoiCua("link lost while the write was in flight (after 40ms) — outcome unknown: the write may have been applied on the device", "timeout")).toBe("TIMEOUT");
  });

  it("'readback unavailable' cũ không đổi ⇒ READBACK_UNAVAILABLE", () => {
    expect(maLoiCua("readback unavailable", "acked_unverified")).toBe("READBACK_UNAVAILABLE");
  });
});
