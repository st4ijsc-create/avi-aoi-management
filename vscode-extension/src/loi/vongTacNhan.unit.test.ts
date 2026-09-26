/**
 * LƯỚI cầu chì vòng lặp tác nhân (Đợt D / Task 3) — `buocKeTiep` là nơi quyết định DUY NHẤT giữa
 * "chạy tool" và "dừng"; xem docblock `vongTacNhan.ts` cho thứ tự ưu tiên NĂM điều kiện.
 *
 * ★★★ Ca #1 ("biHuy thắng mọi thứ") là ca có tải trọng nặng nhất: sai thứ tự ưu tiên ở đây nghĩa
 * là người dùng bấm Dừng mà vòng lặp vẫn âm thầm chạy thêm một lượt (gọi model + có thể chạy tool)
 * — xem Step 5 (ĐỘT BIẾN) trong báo cáo Task 3 để thấy ca này ĐỎ khi thứ tự bị đảo.
 */
import { describe, it, expect } from "vitest";
import { buocKeTiep } from "./vongTacNhan";

describe("buocKeTiep", () => {
  it("★★★ biHuy THẮNG MỌI THỨ — dừng nguoi_dung_dung dù CÒN trần VÀ CÒN yêu cầu đọc", () => {
    expect(buocKeTiep({ vong: 1, tran: 3, coYeuCauDoc: true, biHuy: true, coLoi: false })).toEqual({
      loai: "dung",
      lyDo: "nguoi_dung_dung",
    });
  });

  it("★★★ hết trần (vong >= tran) ⇒ dừng het_tran", () => {
    expect(buocKeTiep({ vong: 3, tran: 3, coYeuCauDoc: true, biHuy: false, coLoi: false })).toEqual({
      loai: "dung",
      lyDo: "het_tran",
    });
    // vong VƯỢT trần (không chỉ chạm đúng biên) vẫn phải dừng — phòng lỗi vòng lỡ tăng quá một nấc.
    expect(buocKeTiep({ vong: 4, tran: 3, coYeuCauDoc: true, biHuy: false, coLoi: false })).toEqual({
      loai: "dung",
      lyDo: "het_tran",
    });
  });

  it("★★★ không còn yêu cầu đọc ⇒ dừng khong_con_tool", () => {
    expect(buocKeTiep({ vong: 1, tran: 3, coYeuCauDoc: false, biHuy: false, coLoi: false })).toEqual({
      loai: "dung",
      lyDo: "khong_con_tool",
    });
  });

  it("★★★ có lỗi ⇒ dừng loi", () => {
    expect(buocKeTiep({ vong: 1, tran: 3, coYeuCauDoc: true, biHuy: false, coLoi: true })).toEqual({
      loai: "dung",
      lyDo: "loi",
    });
  });

  it("★★ còn trần + còn yêu cầu đọc + không huỷ + không lỗi ⇒ chay_tool", () => {
    expect(buocKeTiep({ vong: 1, tran: 3, coYeuCauDoc: true, biHuy: false, coLoi: false })).toEqual({
      loai: "chay_tool",
    });
    // Vòng áp SÁT trần (còn ĐÚNG một lượt) vẫn phải chạy tool, không dừng non.
    expect(buocKeTiep({ vong: 2, tran: 3, coYeuCauDoc: true, biHuy: false, coLoi: false })).toEqual({
      loai: "chay_tool",
    });
  });

  describe("★★ THỨ TỰ ƯU TIÊN khi NHIỀU điều kiện cùng đúng: huỷ > lỗi > hết trần > hết tool", () => {
    it("biHuy VÀ coLoi cùng đúng ⇒ huỷ thắng (nguoi_dung_dung, KHÔNG PHẢI loi)", () => {
      expect(buocKeTiep({ vong: 1, tran: 3, coYeuCauDoc: true, biHuy: true, coLoi: true })).toEqual({
        loai: "dung",
        lyDo: "nguoi_dung_dung",
      });
    });

    it("biHuy VÀ hết trần cùng đúng ⇒ huỷ thắng (nguoi_dung_dung, KHÔNG PHẢI het_tran)", () => {
      expect(buocKeTiep({ vong: 5, tran: 3, coYeuCauDoc: true, biHuy: true, coLoi: false })).toEqual({
        loai: "dung",
        lyDo: "nguoi_dung_dung",
      });
    });

    it("coLoi VÀ hết trần cùng đúng ⇒ lỗi thắng (loi, KHÔNG PHẢI het_tran)", () => {
      expect(buocKeTiep({ vong: 5, tran: 3, coYeuCauDoc: true, biHuy: false, coLoi: true })).toEqual({
        loai: "dung",
        lyDo: "loi",
      });
    });

    it("hết trần VÀ hết yêu cầu đọc cùng đúng ⇒ hết trần thắng (het_tran, KHÔNG PHẢI khong_con_tool)", () => {
      expect(buocKeTiep({ vong: 3, tran: 3, coYeuCauDoc: false, biHuy: false, coLoi: false })).toEqual({
        loai: "dung",
        lyDo: "het_tran",
      });
    });
  });

  describe("★ `tran` phải đi qua kepTranVong — giá trị rác ⇒ mặc định 3, KHÔNG phải 0 hay vô hạn", () => {
    it("tran=NaN (rác) ⇒ kẹp về mặc định 3 ⇒ vong=3 chạm trần", () => {
      // Nếu KHÔNG đi qua kepTranVong: `3 >= NaN` là false trong JS ⇒ sẽ SAI thành "chay_tool".
      expect(buocKeTiep({ vong: 3, tran: NaN, coYeuCauDoc: true, biHuy: false, coLoi: false })).toEqual({
        loai: "dung",
        lyDo: "het_tran",
      });
    });

    it("tran=Infinity (rác) ⇒ kẹp về mặc định 3, KHÔNG phải vô hạn ⇒ vong=3 chạm trần", () => {
      // Nếu KHÔNG đi qua kepTranVong: `3 >= Infinity` là false ⇒ vòng sẽ KHÔNG BAO GIỜ dừng vì hết
      // trần — đúng lớp lỗi "vòng không trần" mà `shared/aiCodingLoop.ts` cảnh báo.
      expect(buocKeTiep({ vong: 3, tran: Infinity, coYeuCauDoc: true, biHuy: false, coLoi: false })).toEqual({
        loai: "dung",
        lyDo: "het_tran",
      });
    });

    it("tran=999 (rác, vượt trần cứng) ⇒ kẹp về TRAN_VONG_TOI_DA=5, KHÔNG PHẢI 999", () => {
      // Nếu KHÔNG đi qua kepTranVong: `5 >= 999` là false ⇒ vòng chạy quá xa trần cứng của cả hệ.
      expect(buocKeTiep({ vong: 5, tran: 999, coYeuCauDoc: true, biHuy: false, coLoi: false })).toEqual({
        loai: "dung",
        lyDo: "het_tran",
      });
    });
  });
});
