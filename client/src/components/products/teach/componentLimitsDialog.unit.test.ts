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
  layTruongThayDoi,
  soTruongThayDoi,
  xayInputSetLimitsBatch,
  xayInputYeuCauDuyet,
  ketQuaThanhCong,
  docLoiCanDuyetNguong,
  thongBaoThanhCong,
  thongBaoCanDuyet,
  keHoachLamMoiSauLuu,
  diemCayDayChoCanvas,
  coTheLuu,
  type FormGioiHan,
  type TenTruongForm,
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

  // Vòng sửa 1 (Minor #1) — so sánh CHÉO lowerLimit≤upperLimit / heightMin≤heightMax.
  it("lowerLimit > upperLimit (cả hai hợp lệ) ⇒ lỗi gắn ở upperLimit", () => {
    const loi = kiemTraForm(gia({ lowerLimit: "10", upperLimit: "5" }));
    expect(loi).toEqual([
      { truong: "upperLimit", khoa: "teachLimits.errCanDuoiLonHonCanTren", macDinh: "Cận dưới phải nhỏ hơn hoặc bằng cận trên" },
    ]);
  });

  it("lowerLimit === upperLimit ⇒ hợp lệ (biên ≤, không phải <)", () => {
    expect(kiemTraForm(gia({ lowerLimit: "5", upperLimit: "5" }))).toEqual([]);
  });

  it("heightMin > heightMax (cả hai hợp lệ) ⇒ lỗi gắn ở heightMax", () => {
    const loi = kiemTraForm(gia({ heightMin: "3", heightMax: "1" }));
    expect(loi).toEqual([
      { truong: "heightMax", khoa: "teachLimits.errCaoMinLonHonMax", macDinh: "Cao tối thiểu phải nhỏ hơn hoặc bằng cao tối đa" },
    ]);
  });

  it("KHÔNG so sánh chéo khi một trong hai trống hoặc sai định dạng — tránh chồng lỗi", () => {
    expect(kiemTraForm(gia({ lowerLimit: "10" }))).toEqual([]); // upperLimit trống — chưa có gì để so
    const loiSaiDinhDang = kiemTraForm(gia({ lowerLimit: "abc", upperLimit: "1" }));
    expect(loiSaiDinhDang).toHaveLength(1);
    expect(loiSaiDinhDang[0].truong).toBe("lowerLimit"); // chỉ lỗi định dạng, không thêm lỗi so sánh
  });

  it("lowerLimit>upperLimit và heightMin>heightMax cùng lúc ⇒ CẢ HAI lỗi xuất hiện", () => {
    const loi = kiemTraForm(gia({ lowerLimit: "9", upperLimit: "1", heightMin: "9", heightMax: "1" }));
    const truongLoi = loi.map((l) => l.truong).sort();
    expect(truongLoi).toEqual(["heightMax", "upperLimit"]);
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

describe("layTruongThayDoi / soTruongThayDoi — M-5 (vòng sửa 9): CHỈ trường THẬT SỰ đổi so với giaGoc", () => {
  it("giaGoc null (hàng loạt) ⇒ rơi về hành vi CŨ của layTruongDaNhap, không đổi", () => {
    const g = gia({ lowerLimit: "1", upperLimit: "9" });
    expect(layTruongThayDoi(g, null)).toEqual(layTruongDaNhap(g));
    expect(soTruongThayDoi(g, null)).toBe(soTruongDaNhap(g));
  });

  it("[KỊCH BẢN M-5] đơn tiền điền ĐỦ 5 trường, mở → Lưu NGAY không sửa gì ⇒ 0 trường thay đổi", () => {
    const daTai = gia({ lowerLimit: "1", upperLimit: "9", unit: "mm", heightMin: "0", heightMax: "5" });
    // gia hiện tại Y HỆT giaGoc (người dùng chưa gõ gì) — đúng tình huống "mở → Lưu ngay".
    expect(layTruongThayDoi(daTai, daTai)).toEqual({});
    expect(soTruongThayDoi(daTai, daTai)).toBe(0);
  });

  it("chỉ MỘT trong 5 trường tiền điền bị sửa ⇒ CHỈ trường đó vào kết quả", () => {
    const daTai = gia({ lowerLimit: "1", upperLimit: "9", unit: "mm", heightMin: "0", heightMax: "5" });
    const hienTai = { ...daTai, upperLimit: "10" }; // sửa đúng 1 trường
    expect(layTruongThayDoi(hienTai, daTai)).toEqual({ upperLimit: "10" });
    expect(soTruongThayDoi(hienTai, daTai)).toBe(1);
  });

  it("gõ lại ĐÚNG giá trị cũ (có khoảng trắng thừa) ⇒ vẫn coi là KHÔNG đổi (so sánh sau trim)", () => {
    const daTai = gia({ lowerLimit: "1" });
    const hienTai = gia({ lowerLimit: "  1  " });
    expect(layTruongThayDoi(hienTai, daTai)).toEqual({});
  });

  it("xoá một trường tiền điền về rỗng ⇒ KHÔNG vào kết quả (rỗng = 'không đổi' theo layTruongDaNhap, không phải 'xoá')", () => {
    const daTai = gia({ lowerLimit: "1", upperLimit: "9" });
    const hienTai = { ...daTai, upperLimit: "" };
    expect(layTruongThayDoi(hienTai, daTai)).toEqual({});
  });

  it("trường vốn RỖNG ở giaGoc, người dùng nhập mới ⇒ ĐƯỢC tính là đổi", () => {
    const daTai = gia({ lowerLimit: "1" }); // unit rỗng lúc tải
    const hienTai = { ...daTai, unit: "mm" };
    expect(layTruongThayDoi(hienTai, daTai)).toEqual({ unit: "mm" });
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

  // M-5 (vòng sửa 9) — Test bắt buộc theo brief: "mở → Lưu ngay ⇒ 0 item / không gọi mutation".
  // `luuMutation.mutate` chỉ được gọi từ `ComponentLimitsDialog.tsx` (không test được ở đây, repo
  // không có jsdom/@testing-library/react — xem docblock đầu file) NHƯNG `items` rỗng ở input xây
  // được bằng hàm THUẦN này là điều kiện CẦN: component không có gì để gửi thì việc gọi/không gọi
  // mutation chỉ còn là "gọi mutation với 0 field thay đổi", ý nghĩa hành vi giống hệt "không gọi".
  it("[KỊCH BẢN M-5] giaGoc = gia (mở → Lưu ngay, không sửa gì) ⇒ item KHÔNG mang field nào ngoài id", () => {
    const daTai = gia({ lowerLimit: "1", upperLimit: "9", unit: "mm", heightMin: "0", heightMax: "5" });
    const input = xayInputSetLimitsBatch([42], daTai, "", daTai);
    expect(input.items).toHaveLength(1);
    expect(input.items[0]).toEqual({ id: 42 });
  });

  it("giaGoc bỏ qua (không truyền) ⇒ TƯƠNG THÍCH NGƯỢC, hành vi y hệt trước M-5", () => {
    const g = gia({ lowerLimit: "1", upperLimit: "9" });
    const cu = xayInputSetLimitsBatch([1], g, "");
    const moi = xayInputSetLimitsBatch([1], g, "", null);
    expect(cu).toEqual(moi);
  });

  it("giaGoc có, CHỈ 1/5 trường đổi ⇒ item CHỈ mang đúng field đó", () => {
    const daTai = gia({ lowerLimit: "1", upperLimit: "9", unit: "mm", heightMin: "0", heightMax: "5" });
    const hienTai = { ...daTai, heightMax: "8" };
    const input = xayInputSetLimitsBatch([7], hienTai, "", daTai);
    expect(input.items[0]).toEqual({ id: 7, heightMax: "8" });
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

describe("coTheLuu — Vòng sửa 1 (Important): chặn race đổi điểm A→B trong lúc getById(B) đang tải", () => {
  it("hàng loạt: không phụ thuộc getById ⇒ chỉ cần form hợp lệ + có nội dung", () => {
    const g = gia({ lowerLimit: "1" });
    expect(
      coTheLuu({ soHang: 3, loiForm: kiemTraForm(g), soTruongDaNhap: soTruongDaNhap(g), dangTaiChiTietDon: false }),
    ).toBe(true);
  });

  it("0 hàng ⇒ luôn false (không có gì để lưu)", () => {
    expect(coTheLuu({ soHang: 0, loiForm: [], soTruongDaNhap: 1, dangTaiChiTietDon: false })).toBe(false);
  });

  it("đơn, đang tải chi tiết (getById đang chạy) ⇒ CHẶN dù form hợp lệ và có nội dung", () => {
    const g = gia({ lowerLimit: "1", upperLimit: "2" });
    expect(
      coTheLuu({ soHang: 1, loiForm: kiemTraForm(g), soTruongDaNhap: soTruongDaNhap(g), dangTaiChiTietDon: true }),
    ).toBe(false);
  });

  it("đơn, tải xong (không còn dangTaiChiTietDon) + form hợp lệ + có nội dung ⇒ cho lưu", () => {
    const g = gia({ lowerLimit: "1", upperLimit: "2" });
    expect(
      coTheLuu({ soHang: 1, loiForm: kiemTraForm(g), soTruongDaNhap: soTruongDaNhap(g), dangTaiChiTietDon: false }),
    ).toBe(true);
  });

  /**
   * ★★★ Kịch bản RACE đúng như review mô tả: chế độ đơn, đang sửa điểm A (đã nhập 2 trường hợp
   * lệ), người dùng đổi mục tiêu sang điểm B trong khi `measurementPoint.getById(B)` CÒN ĐANG TẢI.
   *
   * `duocLuuMaCu` bên dưới là biểu thức CHÉP NGUYÊN VĂN cửa gác của `ComponentLimitsDialog.tsx`
   * TRƯỚC vòng sửa 1 (xem `handleLuu`/nút Lưu ở commit `0d570915`): chỉ `rows.length>0`,
   * `loiForm.length===0`, `soTruongDaNhap>0` — HOÀN TOÀN không biết "có đang tải điểm khác hay
   * không". Trong cửa sổ race, `gia` vẫn là dữ liệu CỦA A (không bị mã cũ reset cho đơn) ⇒ biểu
   * thức này ĐÚNG (cho phép lưu) — đây là dòng ĐỎ (bug): bấm Lưu lúc này sẽ ghi giá trị của A lên
   * B (`rows[0].id` đã là B, nhưng `gia` vẫn của A).
   */
  it("[HỒI QUY] mã CŨ (trước vòng sửa 1) KHÔNG chặn Lưu khi đổi A→B trong lúc B đang tải ⇒ RACE", () => {
    const giaConLaiCuaA = gia({ lowerLimit: "1", upperLimit: "2" }); // "còn lại" của A — mã cũ không reset
    const loiFormA = kiemTraForm(giaConLaiCuaA);
    const soTruongA = soTruongDaNhap(giaConLaiCuaA);

    // Dòng ĐỎ — chép nguyên văn cửa gác CŨ (không có khái niệm "đang tải điểm khác"):
    const duocLuuMaCu = loiFormA.length === 0 && soTruongA > 0; // (rows.length>0 giả định luôn đúng ở đây)
    expect(duocLuuMaCu).toBe(true); // BUG đã đo: mã cũ CHO PHÉP lưu dù đang giữa A→B

    // Mã MỚI (`coTheLuu`, có `dangTaiChiTietDon`) PHẢI chặn đúng tình huống này.
    const duocLuuMaMoi = coTheLuu({
      soHang: 1,
      loiForm: loiFormA,
      soTruongDaNhap: soTruongA,
      dangTaiChiTietDon: true, // getById(B) đang tải — tín hiệu mã cũ không có
    });
    expect(duocLuuMaMoi).toBe(false);
  });

  it("form có lỗi (dù không đang tải) ⇒ vẫn chặn", () => {
    const g = gia({ lowerLimit: "abc" });
    expect(
      coTheLuu({ soHang: 1, loiForm: kiemTraForm(g), soTruongDaNhap: soTruongDaNhap(g), dangTaiChiTietDon: false }),
    ).toBe(false);
  });

  it("chưa nhập trường nào (dù không đang tải) ⇒ vẫn chặn", () => {
    expect(
      coTheLuu({ soHang: 1, loiForm: kiemTraForm(FORM_RONG), soTruongDaNhap: soTruongDaNhap(FORM_RONG), dangTaiChiTietDon: false }),
    ).toBe(false);
  });

  // Lô 2 nhóm B — nút Xoá không đổi điều kiện coTheLuu cũ khi KHÔNG có gì bị đánh dấu xoá
  // (xoaTruong rỗng ⇒ tương thích ngược tuyệt đối với mọi ca ở trên).
  it("xoaTruong rỗng (mặc định) ⇒ hành vi y hệt trước khi có nút Xoá", () => {
    expect(
      coTheLuu({ soHang: 1, loiForm: kiemTraForm(FORM_RONG), soTruongDaNhap: 0, dangTaiChiTietDon: false, soTruongXoa: 0 }),
    ).toBe(false);
  });

  it("0 trường nhập nhưng CÓ trường bị đánh dấu xoá ⇒ vẫn cho Lưu (xoá LÀ một thay đổi)", () => {
    expect(
      coTheLuu({ soHang: 1, loiForm: [], soTruongDaNhap: 0, dangTaiChiTietDon: false, soTruongXoa: 1 }),
    ).toBe(true);
  });

  it("đang tải chi tiết đơn ⇒ vẫn chặn dù có trường đánh dấu xoá (race A→B)", () => {
    expect(
      coTheLuu({ soHang: 1, loiForm: [], soTruongDaNhap: 0, dangTaiChiTietDon: true, soTruongXoa: 1 }),
    ).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Lô 2 nhóm B (BG-123 phần UI) — nút "Xoá giới hạn" gửi NULL, khác "để trống" (undefined/không đổi)
// và khác "nhập giá trị" (string). Server (82ced43b) đã nhận `z.string().nullable().optional()`
// cho đúng NULLABLE_LIMIT_STRING_FIELDS (APPROVAL_LIMIT_FIELDS trừ criteria/toleranceMode — bao
// gồm cả 5 trường form ở đây: lowerLimit/upperLimit/unit/heightMin/heightMax).
//
// Ba trạng thái PHẢI phân biệt RÕ ở input gửi lên setLimitsBatch:
//   • undefined — trường không đụng tới (không có trong object item)
//   • string    — đặt giá trị mới (người dùng gõ, hoặc tiền điền không đổi ở batch cũ)
//   • null      — người dùng bấm nút Xoá cho trường đó (ghi đè MỌI nội dung gõ trong ô, xem test
//                 "xoá THẮNG nội dung gõ" dưới đây — tránh trạng thái mơ hồ "vừa gõ vừa xoá")
// ═══════════════════════════════════════════════════════════════════════════════════════════════
describe("layTruongThayDoi/xayInputSetLimitsBatch với xoaTruong — 3 trạng thái undefined/string/null", () => {
  function xoa(...truong: TenTruongForm[]): ReadonlySet<TenTruongForm> {
    return new Set(truong);
  }

  it("không đánh dấu xoá gì (mặc định) ⇒ y hệt hành vi cũ (không tham số thứ 3)", () => {
    const g = gia({ lowerLimit: "1", upperLimit: "9" });
    expect(layTruongThayDoi(g, null)).toEqual(layTruongThayDoi(g, null, xoa()));
  });

  it("đơn: trường ĐANG CÓ giá trị (giaGoc có), bấm Xoá ⇒ null, KHÔNG phải undefined hay chuỗi cũ", () => {
    const daTai = gia({ lowerLimit: "1", upperLimit: "9", unit: "mm", heightMin: "0", heightMax: "5" });
    // Người dùng không gõ gì thêm — chỉ bấm nút Xoá cho upperLimit.
    const truong = layTruongThayDoi(daTai, daTai, xoa("upperLimit"));
    expect(truong).toEqual({ upperLimit: null });
    expect(truong.upperLimit).not.toBe(undefined);
  });

  it("trường KHÔNG đụng tới (không gõ, không bấm Xoá) ⇒ undefined — không có mặt trong kết quả", () => {
    const daTai = gia({ lowerLimit: "1", upperLimit: "9" });
    const truong = layTruongThayDoi(daTai, daTai, xoa("upperLimit"));
    expect(Object.prototype.hasOwnProperty.call(truong, "lowerLimit")).toBe(false);
    expect(truong.lowerLimit).toBeUndefined();
  });

  it("trường được GÕ giá trị mới (không bấm Xoá) ⇒ chuỗi thật, không phải null", () => {
    const daTai = gia({ lowerLimit: "1" });
    const hienTai = { ...daTai, heightMin: "2" };
    const truong = layTruongThayDoi(hienTai, daTai, xoa());
    expect(truong).toEqual({ heightMin: "2" });
  });

  it("xoá THẮNG nội dung gõ — bấm Xoá một trường ĐỒNG THỜI ô đó vẫn còn chữ cũ ⇒ vẫn null", () => {
    // Race hiếm: UI nên tự xoá/khoá ô khi đánh dấu Xoá, nhưng logic thuần phải AN TOÀN dù ô còn
    // giá trị — ý định "xoá" của người dùng không được bị nội dung ô nuốt mất.
    const daTai = gia({ lowerLimit: "1", upperLimit: "9" });
    const hienTaiVanConChu = { ...daTai, upperLimit: "999" };
    const truong = layTruongThayDoi(hienTaiVanConChu, daTai, xoa("upperLimit"));
    expect(truong.upperLimit).toBeNull();
  });

  it("hàng loạt (giaGoc null) + đánh dấu xoá 2 trường ⇒ cả hai null, trường khác theo layTruongDaNhap cũ", () => {
    const g = gia({ unit: "mm" }); // unit được gõ, lowerLimit/heightMax bị đánh dấu xoá
    const truong = layTruongThayDoi(g, null, xoa("lowerLimit", "heightMax"));
    expect(truong).toEqual({ unit: "mm", lowerLimit: null, heightMax: null });
  });

  it("nhiều trường: 1 giữ nguyên (undefined) + 1 đặt mới (string) + 1 xoá (null) cùng lúc", () => {
    const daTai = gia({ lowerLimit: "1", upperLimit: "9", unit: "mm", heightMin: "0", heightMax: "5" });
    const hienTai = { ...daTai, heightMin: "3" }; // đặt mới heightMin, không đụng lowerLimit/unit/upperLimit
    const truong = layTruongThayDoi(hienTai, daTai, xoa("upperLimit"));
    expect(truong).toEqual({ heightMin: "3", upperLimit: null });
    expect(Object.prototype.hasOwnProperty.call(truong, "lowerLimit")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(truong, "unit")).toBe(false);
  });

  it("xayInputSetLimitsBatch: item mang null ĐÚNG cho trường bị xoá, giữ id nguyên vẹn", () => {
    const daTai = gia({ lowerLimit: "1", upperLimit: "9" });
    const input = xayInputSetLimitsBatch([42], daTai, "", daTai, xoa("lowerLimit"));
    expect(input.items).toHaveLength(1);
    expect(input.items[0]).toEqual({ id: 42, lowerLimit: null });
  });

  it("xayInputSetLimitsBatch hàng loạt: null áp cho TẤT CẢ id đã chọn", () => {
    const ids = [1, 2, 3];
    const input = xayInputSetLimitsBatch(ids, FORM_RONG, "", null, xoa("unit"));
    expect(input.items).toHaveLength(3);
    for (let i = 0; i < ids.length; i++) {
      expect(input.items[i]).toEqual({ id: ids[i], unit: null });
    }
  });

  it("xayInputSetLimitsBatch: không truyền xoaTruong (tương thích ngược) ⇒ y hệt trước Lô 2", () => {
    const g = gia({ lowerLimit: "1", upperLimit: "9" });
    const cu = xayInputSetLimitsBatch([1], g, "");
    const moi = xayInputSetLimitsBatch([1], g, "", null, xoa());
    expect(cu).toEqual(moi);
  });

  it("soTruongThayDoi đếm CẢ trường bị xoá (null) — không chỉ trường có chuỗi", () => {
    const daTai = gia({ lowerLimit: "1", upperLimit: "9" });
    expect(soTruongThayDoi(daTai, daTai, xoa("upperLimit"))).toBe(1);
  });
});

describe("docLoiCanDuyetNguong — lỗi CONFLICT (optimistic-lock của measurementPoint.update) KHÔNG bị nhận nhầm thành 'cần duyệt'", () => {
  // BG-123 UI dùng setLimitsBatch (không có expectedUpdatedAt/CONFLICT — đó là cơ chế RIÊNG của
  // measurementPoint.update, xem productRouters.ts:1451-1480). Test này khẳng định NẾU một lỗi
  // CONFLICT tới tay dialog (vd một mutation khác dùng chung hàm này trong tương lai), nó KHÔNG bị
  // nuốt nhầm thành "cần duyệt" — rơi đúng nhánh toastTrpcError(err) chung, dialog vẫn mở (xem
  // onError trong ComponentLimitsDialog.tsx: chỉ đóng dialog ở onSuccess, không ở nhánh lỗi nào).
  it("lỗi CONFLICT (MP_STALE_WRITE) ⇒ docLoiCanDuyetNguong trả null, KHÔNG bị coi là 'cần duyệt'", () => {
    const err = {
      data: {
        code: "CONFLICT",
        appCode: "ENTITY_DUPLICATE",
        appParams: { entity: "measurementPoint", expectedUpdatedAt: "2020-01-01T00:00:00.000Z" },
      },
    };
    expect(docLoiCanDuyetNguong(err)).toBeNull();
  });
});

// ── Lô 7 Mục 3 (BG-111) — cầu nối "Gửi yêu cầu duyệt" ngay chỗ bị chặn ─────────
describe("xayInputYeuCauDuyet — payload cho thresholdApproval.request, dựng từ TruongThayDoi 3-trạng-thái", () => {
  it("MỘT id (đơn) + một trường sửa (lowerLimit) ⇒ 1 item, deXuat đúng field, comment đi kèm", () => {
    const daTai = gia({ lowerLimit: "1", upperLimit: "9" });
    const g = gia({ lowerLimit: "2", upperLimit: "9" });
    const items = xayInputYeuCauDuyet([5], g, "ly do doi", daTai);
    expect(items).toHaveLength(1);
    expect(items[0]).toEqual({ pointDefId: 5, deXuat: { lowerLimit: "2" }, comment: "ly do doi" });
  });

  it("trường bị XOÁ (null) ⇒ deXuat mang null tường minh, KHÔNG bị lọc mất (khác 'không đổi')", () => {
    const daTai = gia({ heightMax: "5" });
    const items = xayInputYeuCauDuyet([5], daTai, "", daTai, new Set<TenTruongForm>(["heightMax"]));
    expect(items[0].deXuat).toEqual({ heightMax: null });
  });

  it("BA trạng thái cùng lúc: một trường ĐẶT giá trị mới, một trường XOÁ, một trường KHÔNG ĐỔI ⇒ deXuat chỉ mang hai trường đầu", () => {
    const daTai = gia({ lowerLimit: "1", upperLimit: "9", heightMax: "5" });
    const g = gia({ lowerLimit: "2", upperLimit: "9", heightMax: "" }); // upperLimit không đổi, heightMax bị xoá
    const items = xayInputYeuCauDuyet([5], g, "", daTai, new Set<TenTruongForm>(["heightMax"]));
    expect(items[0].deXuat).toEqual({ lowerLimit: "2", heightMax: null });
  });

  it("changeReason rỗng ⇒ KHÔNG có khoá `comment` trong item (khớp .optional() server, tránh gửi chuỗi rỗng vô nghĩa)", () => {
    const daTai = gia({ lowerLimit: "1" });
    const g = gia({ lowerLimit: "2" });
    const items = xayInputYeuCauDuyet([5], g, "   ", daTai);
    expect(items[0]).not.toHaveProperty("comment");
  });

  it("HÀNG LOẠT (N id): MỖI id một item RIÊNG, cùng chia sẻ MỘT bộ deXuat (áp cùng thay đổi cho tất cả)", () => {
    const g = gia({ heightMax: "9" });
    const items = xayInputYeuCauDuyet([5, 6, 7], g, "hang loat", null);
    expect(items).toHaveLength(3);
    expect(items.map((i) => i.pointDefId)).toEqual([5, 6, 7]);
    for (const it of items) expect(it.deXuat).toEqual({ heightMax: "9" });
  });

  it("giaGoc=null (hàng loạt, không có baseline chung) ⇒ rơi về hành vi layTruongThayDoi cũ (mọi trường có nội dung đều vào deXuat)", () => {
    const g = gia({ lowerLimit: "1", upperLimit: "9" });
    const items = xayInputYeuCauDuyet([5], g, "", null);
    expect(items[0].deXuat).toEqual({ lowerLimit: "1", upperLimit: "9" });
  });

  it("0 trường thay đổi (deXuat rỗng) ⇒ trả mảng RỖNG — không dựng item vô nghĩa cho server từ chối", () => {
    const daTai = gia({ lowerLimit: "1" });
    const items = xayInputYeuCauDuyet([5], daTai, "", daTai);
    expect(items).toEqual([]);
  });

  it("ids rỗng ⇒ trả mảng rỗng (không lặp, không lỗi)", () => {
    const g = gia({ lowerLimit: "2" });
    expect(xayInputYeuCauDuyet([], g, "", null)).toEqual([]);
  });
});
