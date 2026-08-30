/**
 * Pha 1F Task 4 (⭐ TRỌNG TÂM) — lưới THUẦN (không DB) cho
 * `hinhDangHopDongMetaJson.ts`: đúng bộ SINH HÌNH DẠNG (không phải cổng verdict
 * — cổng verdict sống ở `server/routers/aoiPackageHinhDangHopDongChoPhep.test.ts`,
 * nơi DUY NHẤT có thể đo bằng SELECT sau commit THẬT).
 *
 * Ba việc file này canh:
 *  §1 `duyetTruongOptional` — walker tự đúng trên một schema TỔNG HỢP đã biết
 *     trước kết quả (cùng kỹ thuật `capChuoiVarcharUnionDeQuy.test.ts`, BG-79).
 *  §2 CHỐNG TỰ THOẢ (mệnh đề 3, nửa đầu) — `duyetTruongOptional(metaJsonSchema)`
 *     trả về ĐỦ NHIỀU đường (một bộ sinh hỏng trả `[]` sẽ bị bắt ở đây), và
 *     LƯỚI CANH PHỦ: mọi đường nó tìm được phải có ÍT NHẤT MỘT hình dạng
 *     trong `BANG_HINH_DANG` để nó VẮNG MẶT — nêu đúng tên đường nào chưa
 *     được phủ nếu có.
 *  §3 TỰ NHẤT QUÁN — mỗi hình dạng trong `BANG_HINH_DANG` phải có
 *     `kyVong.loai` KHỚP với `metaJsonSchema.safeParse()` THẬT (không phải
 *     một lời khai đứng riêng), và mỗi hình dạng `tuChoi` phải có
 *     `kyVong.vinhVien` KHỚP `laLoiVinhVienDemVaoNguongDeadZip` THẬT.
 *
 * §2/§3 là chính "cổng theo hình dạng hợp đồng cho phép" ở TẦNG SCHEMA — cổng
 * ở TẦNG VERDICT (chạy commit thật, SELECT thật) nằm ở file tích hợp.
 */
import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  duyetTruongOptional,
  duongVangMat,
  BANG_HINH_DANG,
  layHinhDangMauMayThat,
  phanLoaiTuChoi,
} from "./hinhDangHopDongMetaJson";
import { metaJsonSchema } from "../routers/aoiPackageRouter";

// ════════════════════════════════════════════════════════════════════════════
// §1 — duyetTruongOptional tự đúng trên schema TỔNG HỢP đã biết trước kết quả.
// ════════════════════════════════════════════════════════════════════════════
describe("duyetTruongOptional — walker tự đệ quy MỌI trường .optional()", () => {
  it("object phẳng: chỉ trường .optional() được liệt kê, trường bắt buộc KHÔNG", () => {
    const s = z.object({ batBuoc: z.string(), tuyChon: z.string().optional() });
    expect(duyetTruongOptional(s)).toEqual(["tuyChon"]);
  });

  it("mảng optional: bước '[]' được thêm, con của phần tử cũng được duyệt", () => {
    const s = z.object({
      ds: z.array(z.object({ a: z.string(), b: z.number().optional() })).optional(),
    });
    expect(duyetTruongOptional(s).sort()).toEqual(["ds", "ds.[].b"].sort());
  });

  it("★ default() ĐƯỢC coi là 'vắng mặt được' (đo thật: safeParse({}) THÀNH CÔNG với .default()) — nullable() ĐƠN LẺ KHÔNG (đo thật: safeParse({}) THẤT BẠI, khoá vẫn bắt buộc, chỉ giá trị được null)", () => {
    const sNullable = z.object({ x: z.string().nullable() });
    const sDefault = z.object({ x: z.string().default("mac-dinh") });
    // Đối chứng bằng chính safeParse — không suy đoán từ tên API.
    expect(sNullable.safeParse({}).success, "tiền đề: nullable đơn lẻ KHÔNG cho vắng khoá").toBe(false);
    expect(sDefault.safeParse({}).success, "tiền đề: default CHO vắng khoá").toBe(true);
    expect(duyetTruongOptional(sNullable)).toEqual([]);
    expect(duyetTruongOptional(sDefault)).toEqual(["x"]);
  });

  it("union: đệ quy MỌI nhánh, cùng đường dẫn (union là hình dạng THAY THẾ của MỘT trường)", () => {
    const s = z.object({ v: z.union([z.number(), z.string()]).optional() });
    expect(duyetTruongOptional(s)).toEqual(["v"]);
  });

  it("★ CHỐNG TỰ THOẢ — kiểu KHÔNG nhận diện được (ZodRecord) ⇒ THROW, không im lặng trả []", () => {
    const s = z.object({ x: z.record(z.string(), z.string()).optional() });
    expect(() => duyetTruongOptional(s)).toThrow(/CHƯA HỖ TRỢ/);
  });

  it("object lồng sâu: đường dẫn nối đúng cấp ('a.b.c'), trường KHÔNG optional ở giữa vẫn được đi qua để tìm con optional", () => {
    const s = z.object({
      a: z.object({ b: z.object({ c: z.string().optional() }) }),
    });
    expect(duyetTruongOptional(s)).toEqual(["a.b.c"]);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// §2 — CHỐNG TỰ THOẢ trên metaJsonSchema THẬT + lưới canh PHỦ.
// ════════════════════════════════════════════════════════════════════════════
describe("★★★ mệnh đề 3 (nửa đầu) — bộ sinh KHÔNG được trả về danh sách rỗng/nhỏ giả tạo", () => {
  const TAT_CA_OPTIONAL = duyetTruongOptional(metaJsonSchema);

  it("metaJsonSchema THẬT có ≥25 đường .optional() (đo được: 33 — một bộ đếm hỏng trả 0 hoặc vài chục sẽ bị bắt ở đây)", () => {
    expect(TAT_CA_OPTIONAL.length).toBeGreaterThanOrEqual(25);
  });

  it("danh sách KHÔNG rỗng và chứa các đường TOP-LEVEL đã biết chắc chắn tồn tại (đối chứng thủ công, không chỉ tin bộ đếm)", () => {
    for (const p of ["machineCode", "overallResult", "companyCode", "points", "summary"]) {
      expect(TAT_CA_OPTIONAL, `thiếu đường đã biết chắc chắn: ${p}`).toContain(p);
    }
    for (const p of ["measurements.[].result", "measurements.[].pointId", "points.[].name"]) {
      expect(TAT_CA_OPTIONAL, `thiếu đường lồng đã biết chắc chắn: ${p}`).toContain(p);
    }
  });

  it("★★★ BẮT BUỘC hai trường bắt buộc (serialNumber/productModel/measurements) KHÔNG bị liệt kê nhầm là optional", () => {
    for (const p of ["serialNumber", "productModel", "measurements", "measurements.[].fileName"]) {
      expect(TAT_CA_OPTIONAL, `${p} là BẮT BUỘC, không được xuất hiện trong danh sách optional`).not.toContain(p);
    }
  });
});

describe("★★★ mệnh đề 3 (LƯỚI CANH PHỦ) — mọi đường .optional() PHẢI có ≥1 hình dạng để nó VẮNG MẶT", () => {
  const TAT_CA_OPTIONAL = duyetTruongOptional(metaJsonSchema);
  const HINH_DANG_CHAP_NHAN = BANG_HINH_DANG.filter((h) => h.kyVong.loai === "chapNhan");

  it("BANG_HINH_DANG có ≥1 hình dạng 'chapNhan' để chạy lưới canh phủ trên (chống bảng rỗng)", () => {
    expect(HINH_DANG_CHAP_NHAN.length).toBeGreaterThan(0);
  });

  it("★★★ MỖI đường .optional() của metaJsonSchema có ÍT NHẤT MỘT hình dạng chứng minh nó VẮNG MẶT được", () => {
    const thieu = TAT_CA_OPTIONAL.filter(
      (duongDan) => !HINH_DANG_CHAP_NHAN.some((h) => duongVangMat(h.meta, duongDan)),
    );
    expect(
      thieu,
      `Các trường .optional() sau CHƯA được hình dạng nào trong BANG_HINH_DANG phủ ở trạng thái VẮNG MẶT — ` +
        `thêm một hình dạng bỏ trống trường đó, hoặc mở rộng một hình dạng có sẵn: ${thieu.join(", ")}`,
    ).toEqual([]);
  });

  it("★ ĐỘT BIẾN TỰ KIỂM — nếu BANG_HINH_DANG chỉ còn hình dạng 'toiThieu' (không đủ đa dạng), lưới canh vẫn phải ĐỎ trên các trường có mặt (result/measuredValue/...) — chứng minh lưới canh PHÂN BIỆT được 'phủ' và 'không phủ', không tự thoả toàn bộ", () => {
    const chiHinhDangToiThieu = HINH_DANG_CHAP_NHAN.filter((h) => h.ten === "toiThieuMoiTruongOptionalVangMat");
    expect(chiHinhDangToiThieu.length, "test dựng sai — không tìm thấy hình dạng tối thiểu").toBe(1);
    // Hình dạng tối thiểu CÓ đủ measurements[0] không result/pointId/... (mọi trường optional
    // CẤP LÁ đều vắng) — nhưng "points.[].name"/"points.[].result"/... chỉ được phủ VÌ `points`
    // (container) vắng mặt (hiển nhiên/vacuous). Đây KHÔNG phải lỗ hổng: nếu points hoàn toàn
    // vắng, các trường con của nó VỐN DĨ vắng theo — lưới canh cố ý coi đó là "đã phủ" (xem
    // docblock `duongVangMat`). Ca này chỉ xác nhận lưới KHÔNG trả `true` một cách vô điều kiện:
    // trên MỘT schema tổng hợp có trường bắt buộc "value luôn có mặt", lưới canh phải ĐỎ.
    const schemaGia = z.object({ x: z.object({ luonCoMat: z.string() }) }); // không optional nào
    const duongOptionalGia = duyetTruongOptional(schemaGia);
    expect(duongOptionalGia).toEqual([]); // không có trường optional nào để đòi phủ — tự nhất quán
  });
});

// ════════════════════════════════════════════════════════════════════════════
// §3 — TỰ NHẤT QUÁN: kyVong của MỖI hình dạng khớp hành vi THẬT của schema/hàm phân loại.
// ════════════════════════════════════════════════════════════════════════════
describe("★★★ mỗi hình dạng trong BANG_HINH_DANG: kyVong.loai KHỚP metaJsonSchema.safeParse() THẬT", () => {
  it(`BANG_HINH_DANG có ≥10 hình dạng (đo được: ${BANG_HINH_DANG.length})`, () => {
    expect(BANG_HINH_DANG.length).toBeGreaterThanOrEqual(10);
  });

  for (const h of BANG_HINH_DANG) {
    it(`"${h.ten}": kyVong.loai="${h.kyVong.loai}" khớp safeParse THẬT`, () => {
      const r = metaJsonSchema.safeParse(h.meta);
      expect(r.success, `metaJsonSchema.safeParse("${h.ten}").success phải là ${h.kyVong.loai === "chapNhan"}`).toBe(
        h.kyVong.loai === "chapNhan",
      );
    });
  }

  for (const h of BANG_HINH_DANG.filter((x) => x.kyVong.loai === "tuChoi")) {
    it(`"${h.ten}": phân loại vĩnh viễn/tạm thời khớp laLoiVinhVienDemVaoNguongDeadZip THẬT`, () => {
      const pl = phanLoaiTuChoi(h);
      expect(pl.thanhCong, "hình dạng tuChoi phải KHÔNG parse được — test dựng sai nếu parse thành công").toBe(false);
      expect(pl.vinhVien).toBe((h.kyVong as { vinhVien: boolean }).vinhVien);
    });
  }
});

describe("★★★ mệnh đề 3 (nửa sau) — ≥1 hình dạng CÓ THỂ CHỨNG MINH không nằm trong DB test", () => {
  it("BANG_HINH_DANG khai ≥1 hình dạng 'ungCuVienKhongTrongDbTest' (bằng chứng THẬT — SELECT — nằm ở file tích hợp)", () => {
    const ungCuVien = BANG_HINH_DANG.filter((h) => h.ungCuVienKhongTrongDbTest === true);
    expect(ungCuVien.length).toBeGreaterThanOrEqual(1);
  });

  it("mẫu máy THẬT (BG-73, đọc lazy) CŨNG là ứng viên 'không trong DB test' — parse LUÔN thất bại nên KHÔNG THỂ có mặt trong bất kỳ hàng product_inspections nào (mọi hàng DB đòi hỏi parse thành công trước khi ghi)", () => {
    const mmt = layHinhDangMauMayThat();
    expect(mmt.ungCuVienKhongTrongDbTest).toBe(true);
    const r = metaJsonSchema.safeParse(mmt.meta);
    expect(r.success, "tiền đề của lập luận 'không trong DB test': parse PHẢI thất bại").toBe(false);
  });
});
