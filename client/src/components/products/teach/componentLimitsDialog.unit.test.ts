/**
 * componentLimitsDialog.unit.test.ts — Khối C Task 11: lưới cho `componentLimitsDialogLogic.ts`.
 *
 * Cùng khuôn `teachTreeTab.unit.test.ts` (Task 10): test HÀM THUẦN, không render (repo này
 * `vitest.config.ts` chạy `*.unit.test.ts` client ở `environment: "node"`, 0
 * `@testing-library/react`).
 */
import { describe, it, expect } from "vitest";
import {
  FORM_RONG,
  laChuoiSoHopLe,
  laDonViHopLe,
  kiemTraForm,
  layTruongDaNhap,
  soTruongDaNhap,
  xayInputSetLimitsBatch,
  ketQuaThanhCong,
  docLoiCanDuyetNguong,
  thongBaoThanhCong,
  thongBaoCanDuyet,
  keHoachLamMoiSauLuu,
  diemCayDayChoCanvas,
  type FormGioiHan,
} from "./componentLimitsDialogLogic";

function gia(overrides: Partial<FormGioiHan>): FormGioiHan {
  return { ...FORM_RONG, ...overrides };
}

describe("laChuoiSoHopLe — decimal(precision:15, scale:6) THẬT (drizzle/schema/product.ts)", () => {
  it("rỗng (chưa nhập) là HỢP LỆ", () => {
    expect(laChuoiSoHopLe("")).toBe(true);
    expect(laChuoiSoHopLe("   ")).toBe(true);
  });

  it("số nguyên/thập phân hợp lệ, có dấu âm", () => {
    expect(laChuoiSoHopLe("0")).toBe(true);
    expect(laChuoiSoHopLe("12.5")).toBe(true);
    expect(laChuoiSoHopLe("-3.000001")).toBe(true);
    expect(laChuoiSoHopLe("123456789")).toBe(true); // 9 chữ số phần nguyên — vừa khít
    expect(laChuoiSoHopLe("1.2345678")).toBe(false); // 7 chữ số sau dấu chấm — kiểm ở test riêng dưới cho rõ ràng
  });

  it("chuỗi không parse được ⇒ ĐỎ (chặn TRƯỚC khi tới server)", () => {
    expect(laChuoiSoHopLe("abc")).toBe(false);
    expect(laChuoiSoHopLe("1.2.3")).toBe(false);
    expect(laChuoiSoHopLe("12,5")).toBe(false); // dấu phẩy — không phải định dạng DB
    expect(laChuoiSoHopLe("1e5")).toBe(false); // khoa học — không phải chuỗi decimal DB chấp nhận
  });

  it("vượt scale 6 (quá 6 chữ số sau dấu chấm) ⇒ ĐỎ", () => {
    expect(laChuoiSoHopLe("1.2345678")).toBe(false); // 7 chữ số sau dấu chấm
    expect(laChuoiSoHopLe("1.123456")).toBe(true); // đúng 6 — vừa khít
  });

  it("vượt precision (quá 9 chữ số phần nguyên) ⇒ ĐỎ", () => {
    expect(laChuoiSoHopLe("1234567890")).toBe(false); // 10 chữ số
    expect(laChuoiSoHopLe("123456789")).toBe(true); // 9 — vừa khít
  });
});

describe("laDonViHopLe — measurement_point_defs.unit varchar(20)", () => {
  it("≤20 ký tự hợp lệ, >20 ĐỎ", () => {
    expect(laDonViHopLe("mm")).toBe(true);
    expect(laDonViHopLe("a".repeat(20))).toBe(true);
    expect(laDonViHopLe("a".repeat(21))).toBe(false);
  });
});

describe("kiemTraForm", () => {
  it("form trống hoàn toàn ⇒ 0 lỗi (rỗng là hợp lệ, không phải giá trị số)", () => {
    expect(kiemTraForm(FORM_RONG)).toEqual([]);
  });

  it("bắt ĐÚNG trường sai, không lây sang trường khác", () => {
    const loi = kiemTraForm(gia({ lowerLimit: "abc", upperLimit: "5" }));
    expect(loi).toHaveLength(1);
    expect(loi[0].truong).toBe("lowerLimit");
  });

  it("unit quá dài bị bắt cùng lượt với lỗi số", () => {
    const loi = kiemTraForm(gia({ heightMax: "x", unit: "a".repeat(25) }));
    const truongLoi = loi.map((l) => l.truong).sort();
    expect(truongLoi).toEqual(["heightMax", "unit"]);
  });
});

describe("layTruongDaNhap / soTruongDaNhap — CHỈ trường có nội dung, KHÔNG gửi \"\"", () => {
  it("form trống ⇒ object rỗng, 0 khoá — KHÔNG gửi field rỗng dưới dạng \"\"", () => {
    const truong = layTruongDaNhap(FORM_RONG);
    expect(truong).toEqual({});
    expect(Object.prototype.hasOwnProperty.call(truong, "lowerLimit")).toBe(false);
    expect(soTruongDaNhap(FORM_RONG)).toBe(0);
  });

  it("chỉ khoảng trắng ⇒ vẫn coi là rỗng, không gửi", () => {
    const truong = layTruongDaNhap(gia({ unit: "   " }));
    expect(truong).toEqual({});
  });

  it("một trường có nội dung ⇒ ĐÚNG một khoá, giá trị đã trim", () => {
    const truong = layTruongDaNhap(gia({ lowerLimit: "  1.5  " }));
    expect(truong).toEqual({ lowerLimit: "1.5" });
    expect(soTruongDaNhap(gia({ lowerLimit: "1.5" }))).toBe(1);
  });

  it("nhiều trường có nội dung ⇒ gộp đủ, đúng số lượng", () => {
    const g = gia({ lowerLimit: "1", upperLimit: "9", unit: "mm" });
    expect(layTruongDaNhap(g)).toEqual({ lowerLimit: "1", upperLimit: "9", unit: "mm" });
    expect(soTruongDaNhap(g)).toBe(3);
  });
});

describe("xayInputSetLimitsBatch — form → items setLimitsBatch", () => {
  it("ĐƠN (1 id) ⇒ items có ĐÚNG 1 phần tử, đúng field đã nhập", () => {
    const input = xayInputSetLimitsBatch([42], gia({ lowerLimit: "1", upperLimit: "9" }), "");
    expect(input.items).toHaveLength(1);
    expect(input.items[0]).toEqual({ id: 42, lowerLimit: "1", upperLimit: "9" });
  });

  it("chọn-nhiều (N id) ⇒ GỘP ĐÚNG N item, MỘT bộ giá trị áp cho tất cả", () => {
    const ids = [1, 2, 3, 4, 5];
    const input = xayInputSetLimitsBatch(ids, gia({ heightMin: "0", heightMax: "10" }), "");
    expect(input.items).toHaveLength(5);
    for (let i = 0; i < ids.length; i++) {
      expect(input.items[i]).toEqual({ id: ids[i], heightMin: "0", heightMax: "10" });
    }
  });

  it("trường rỗng KHÔNG xuất hiện trong item (không phải \"\")", () => {
    const input = xayInputSetLimitsBatch([1], gia({ unit: "mm" }), "");
    expect(input.items[0]).toEqual({ id: 1, unit: "mm" });
    expect(Object.prototype.hasOwnProperty.call(input.items[0], "lowerLimit")).toBe(false);
  });

  it("changeReason rỗng ⇒ bỏ hẳn khỏi input; có nội dung ⇒ trim rồi giữ", () => {
    const rong = xayInputSetLimitsBatch([1], FORM_RONG, "   ");
    expect(Object.prototype.hasOwnProperty.call(rong, "changeReason")).toBe(false);

    const coLyDo = xayInputSetLimitsBatch([1], FORM_RONG, "  đổi theo SPI mới  ");
    expect(coLyDo.changeReason).toBe("đổi theo SPI mới");
  });
});

describe("ketQuaThanhCong / docLoiCanDuyetNguong / thongBaoThanhCong / thongBaoCanDuyet — phân biệt ĐÃ LƯU vs CẦN DUYỆT", () => {
  it("mutation thành công ⇒ 'đã lưu N điểm', N = updated CHIẾU THẲNG", () => {
    const kq = ketQuaThanhCong({ updated: 7 });
    expect(kq).toEqual({ loai: "daLuu", soDiem: 7 });
    const tb = thongBaoThanhCong(kq.soDiem);
    expect(tb.macDinh).toContain("Đã lưu");
    expect(tb.params).toEqual({ soDiem: 7 });
  });

  it("nhận diện ĐÚNG lỗi cửa duyệt ngưỡng (FORBIDDEN + OPERATION_FAILED + editThresholdDirectly)", () => {
    const err = {
      data: {
        code: "FORBIDDEN",
        appCode: "OPERATION_FAILED",
        appParams: { operation: "editThresholdDirectly", reason: "productLifecycleRequiresApproval", lifecycleStatus: "active" },
      },
    };
    const kq = docLoiCanDuyetNguong(err);
    expect(kq).toEqual({ loai: "canDuyet", lyDo: "productLifecycleRequiresApproval" });
  });

  it("nhận diện lý do 'có chương trình đã phát hành' riêng biệt", () => {
    const err = {
      data: {
        code: "FORBIDDEN",
        appCode: "OPERATION_FAILED",
        appParams: { operation: "editThresholdDirectly", reason: "releasedProgramRequiresApproval" },
      },
    };
    expect(docLoiCanDuyetNguong(err)).toEqual({ loai: "canDuyet", lyDo: "releasedProgramRequiresApproval" });
  });

  it("KHÔNG nhận nhầm FORBIDDEN khác (thiếu quyền, không mang editThresholdDirectly)", () => {
    const err = { data: { code: "FORBIDDEN", appCode: "PERMISSION_DENIED", appParams: { action: "somethingElse" } } };
    expect(docLoiCanDuyetNguong(err)).toBeNull();
  });

  it("KHÔNG nhận nhầm operation khác dùng chung appCode OPERATION_FAILED", () => {
    const err = { data: { code: "FORBIDDEN", appCode: "OPERATION_FAILED", appParams: { operation: "someOtherOp" } } };
    expect(docLoiCanDuyetNguong(err)).toBeNull();
  });

  it("KHÔNG nhận nhầm lỗi NOT_FOUND/BAD_REQUEST hay input dị dạng", () => {
    expect(docLoiCanDuyetNguong({ data: { code: "NOT_FOUND" } })).toBeNull();
    expect(docLoiCanDuyetNguong(new Error("plain error"))).toBeNull();
    expect(docLoiCanDuyetNguong(null)).toBeNull();
    expect(docLoiCanDuyetNguong(undefined)).toBeNull();
    expect(docLoiCanDuyetNguong("string lỗi")).toBeNull();
  });

  it("thông báo 'cần duyệt' KHÔNG BAO GIỜ nói 'đã gửi duyệt' — không có gì thật sự được gửi", () => {
    const tbLifecycle = thongBaoCanDuyet({ loai: "canDuyet", lyDo: "productLifecycleRequiresApproval" });
    const tbProgram = thongBaoCanDuyet({ loai: "canDuyet", lyDo: "releasedProgramRequiresApproval" });
    for (const tb of [tbLifecycle, tbProgram]) {
      expect(tb.macDinh).toMatch(/Chưa lưu/);
      expect(tb.macDinh).not.toContain("đã gửi duyệt");
      expect(tb.macDinh).not.toContain("Đã gửi duyệt");
    }
    // Hai lý do khác nhau ⇒ hai câu khác nhau (không gộp, đúng tinh thần "đừng nuốt nguyên nhân").
    expect(tbLifecycle.khoa).not.toBe(tbProgram.khoa);
  });

  it("'đã lưu' và 'cần duyệt' là hai khoá i18n khác nhau — không thể lẫn lộn ở UI", () => {
    const tbLuu = thongBaoThanhCong(3);
    const tbCanDuyet = thongBaoCanDuyet({ loai: "canDuyet", lyDo: null });
    expect(tbLuu.khoa).not.toBe(tbCanDuyet.khoa);
  });
});

describe("keHoachLamMoiSauLuu — invalidate ĐÚNG hai truy vấn Task 9 sau khi lưu", () => {
  it("trả đúng tham số cho listComponents + thongKeGioiHan", () => {
    const ke = keHoachLamMoiSauLuu({ captureRowId: 11, productModelId: 22, machineId: 33 });
    expect(ke).toEqual({
      listComponents: { captureRowId: 11 },
      thongKeGioiHan: { productModelId: 22, machineId: 33 },
    });
  });
});

describe("diemCayDayChoCanvas — hình học THẬT của cây dạy là roi* (rect), KHÔNG phải shape/geometry mặc định", () => {
  it("đủ 4 toạ độ roi ⇒ dựng đúng CanvasMeasurementPoint dạng rect", () => {
    const diem = diemCayDayChoCanvas({
      componentExtId: "COMP-1",
      roiX: 100,
      roiY: 200,
      roiWidth: 40,
      roiHeight: 20,
    });
    expect(diem).toEqual({
      code: "COMP-1",
      positionX: 120, // 100 + 40/2
      positionY: 210, // 200 + 20/2
      radius: 20, // max(40,20)/2
      shape: "rect",
      geometry: { shape: "rect", x: 100, y: 200, width: 40, height: 20 },
    });
  });

  it("thiếu BẤT KỲ toạ độ roi nào ⇒ null (không bịa hình học một phần)", () => {
    expect(diemCayDayChoCanvas({ componentExtId: "C", roiX: null, roiY: 1, roiWidth: 1, roiHeight: 1 })).toBeNull();
    expect(diemCayDayChoCanvas({ componentExtId: "C", roiX: 1, roiY: 1, roiWidth: null, roiHeight: 1 })).toBeNull();
  });

  it("componentExtId null ⇒ rơi về code dự phòng", () => {
    const diem = diemCayDayChoCanvas({
      componentExtId: null,
      code: "FALLBACK",
      roiX: 0,
      roiY: 0,
      roiWidth: 10,
      roiHeight: 10,
    });
    expect(diem?.code).toBe("FALLBACK");
  });
});
