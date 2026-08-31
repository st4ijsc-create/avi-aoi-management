/**
 * Pha 1F Task 4 (⭐ TRỌNG TÂM) — lưới THUẦN (không DB) cho
 * `hinhDangHopDongMetaJson.ts`: đúng bộ SINH HÌNH DẠNG (không phải cổng verdict
 * — cổng verdict sống ở `server/routers/aoiPackageHinhDangHopDongChoPhep.test.ts`,
 * nơi DUY NHẤT có thể đo bằng SELECT sau commit THẬT).
 *
 * Bốn việc file này canh:
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
 *  §4 ★★★ MỚI (2026-08-30, sau phát hiện coordinator) — KỶ LUẬT
 *     `KyVongOverallResult`: mọi hình dạng dùng biến thể `ghiNhanNoDaDuyet`
 *     PHẢI khai `hanhViHienTai !== hanhViDung` (nếu bằng nhau, không có lý do
 *     gì "ghi nhận nợ" một giá trị ĐÃ ĐÚNG — phải dùng `khangDinh`) VÀ
 *     `maBacklog` khớp `/^BG-\d+$/` (không được để trống/mơ hồ). Đây là lưới
 *     CHỐNG LẶP LẠI đúng lỗi BG-91: một `kyVong` mã hoá hành vi SAI mà không
 *     có nhãn phân biệt "khẳng định" ↔ "ghi nhận" khiến cổng XANH GIẢ khi bug
 *     còn đó, và ĐỎ-TRÔNG-GIỐNG-HỒI-QUY khi bug được vá.
 *
 * §2/§3/§4 là chính "cổng theo hình dạng hợp đồng cho phép" ở TẦNG SCHEMA —
 * cổng ở TẦNG VERDICT (chạy commit thật, SELECT thật) nằm ở file tích hợp.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { z } from "zod";
import {
  duyetTruongOptional,
  duongVangMat,
  BANG_HINH_DANG,
  layHinhDangMauMayThat,
  phanLoaiTuChoi,
  giaTriQuanSatDuoc,
  giaTriDung,
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

// ════════════════════════════════════════════════════════════════════════════
// §4 ★★★ MỚI — kỷ luật "khẳng định" (khangDinh) vs "ghi nhận" (ghiNhanNoDaDuyet).
// Chặn đúng lớp lỗi BG-91: một kyVong mã hoá hành vi SAI mà không phân biệt
// được với "hành vi ĐÚNG" — xem docblock đầu file `hinhDangHopDongMetaJson.ts`
// tại `KyVongOverallResult`.
// ════════════════════════════════════════════════════════════════════════════
describe("★★★ §4 — kỷ luật KyVongOverallResult: 'ghiNhanNoDaDuyet' KHÔNG được dùng để né đỏ", () => {
  const HINH_DANG_CHAP_NHAN = BANG_HINH_DANG.filter(
    (h): h is typeof h & { kyVong: { loai: "chapNhan" } } => h.kyVong.loai === "chapNhan",
  );
  const GHI_NHAN_NO = HINH_DANG_CHAP_NHAN.filter((h) => h.kyVong.overallResult.dang === "ghiNhanNoDaDuyet");

  // ══════════════════════════════════════════════════════════════════════
  // ★★★ Pha 1F Task 8 (I-1) — GHIM chống "rửa lỗi": người review đột biến
  // SỐNG bắt được — hoàn nguyên bản vá T1 trong MÃ SẢN XUẤT + đổi MỘT hình
  // dạng từ `khangDinh` sang `ghiNhanNoDaDuyet` (kèm `maBacklog` bịa) — làm
  // ca đó XANH, vì trước bản sửa này KHÔNG có gì ghim SỐ LƯỢNG/TÊN các hình
  // dạng dùng biến thể "ghi nhận nợ". Tập rỗng/dài ra âm thầm là chính lỗ đó.
  // ══════════════════════════════════════════════════════════════════════
  it("★★★ GHIM đúng TẬP hình dạng dùng 'ghiNhanNoDaDuyet' hôm nay — thêm/bớt MỘT hình dạng (kể cả chuyển từ 'khangDinh' sang) là một LỜI KHAI, không phải bảo trì im lặng", () => {
    expect(
      GHI_NHAN_NO.map((h) => h.ten).sort(),
      "tập hình dạng 'ghiNhanNoDaDuyet' đã đổi — nếu bạn vừa CHUYỂN một hình dạng từ 'khangDinh' sang " +
        "đây để né đỏ, đây chính là lưới được dựng ra để bắt điều đó; sửa danh sách này CHỈ khi thật sự " +
        "có một nợ MỚI đã được chủ dự án duyệt treo (kèm mục backlog CÓ THẬT — xem §5 bên dưới).",
    ).toEqual(["biDanhPointsRongThayMeasurements_BG77"]);
  });

  it("mọi hình dạng 'ghiNhanNoDaDuyet': hanhViHienTai KHÁC hanhViDung — nếu bằng nhau, phải dùng 'khangDinh' thay vì 'ghi nhận nợ' một giá trị đã đúng", () => {
    for (const h of GHI_NHAN_NO) {
      const kv = h.kyVong.overallResult as Extract<typeof h.kyVong.overallResult, { dang: "ghiNhanNoDaDuyet" }>;
      expect(
        kv.hanhViHienTai,
        `"${h.ten}": hanhViHienTai==hanhViDung=="${kv.hanhViDung}" — không có lý do dùng 'ghiNhanNoDaDuyet', đổi sang 'khangDinh'`,
      ).not.toBe(kv.hanhViDung);
    }
  });

  it("mọi hình dạng 'ghiNhanNoDaDuyet': maBacklog khớp dạng 'BG-<số>' — không được để trống/mơ hồ", () => {
    for (const h of GHI_NHAN_NO) {
      const kv = h.kyVong.overallResult as Extract<typeof h.kyVong.overallResult, { dang: "ghiNhanNoDaDuyet" }>;
      expect(kv.maBacklog, `"${h.ten}": maBacklog phải khớp /^BG-\\d+$/`).toMatch(/^BG-\d+$/);
      expect(kv.lyDoDuyet.length, `"${h.ten}": lyDoDuyet không được rỗng`).toBeGreaterThan(10);
    }
  });

  // ══════════════════════════════════════════════════════════════════════
  // ★★★ Pha 1F Task 8 (I-1) — đóng lỗ "hanhViDung khai sai ngữ nghĩa": đột
  // biến SỐNG đã đổi `hanhViDung` "NG"→"NTF" và cổng CŨ vẫn 49/49 XANH, vì
  // trước bản sửa này KHÔNG có gì đối chiếu `hanhViDung` với luật thật — chỉ
  // có phép so BẤT ĐẲNG với `hanhViHienTai` (mà "NTF" cũng khác "OK", nên vẫn
  // qua). `tinhHanhViDung` (bắt buộc ở TẦNG KIỂU, xem `hinhDangHopDongMetaJson.ts`)
  // là bằng chứng THẬT — một hàm THUẦN tái dùng `inferAoiOverallResult`
  // (production).
  // ══════════════════════════════════════════════════════════════════════
  it("★★★ I-1 — mọi hình dạng 'ghiNhanNoDaDuyet': hanhViDung khai KHỚP kết quả tính từ tinhHanhViDung(meta) (LUẬT THẬT) — không phải một chuỗi tự khai đứng riêng", () => {
    for (const h of GHI_NHAN_NO) {
      const kv = h.kyVong.overallResult as Extract<typeof h.kyVong.overallResult, { dang: "ghiNhanNoDaDuyet" }>;
      const tinhDuoc = kv.tinhHanhViDung(h.meta);
      expect(
        tinhDuoc,
        `"${h.ten}": hanhViDung khai "${kv.hanhViDung}" nhưng tinhHanhViDung(meta) tính ra "${tinhDuoc}" — ` +
          `một trong hai đang SAI (đúng lỗ mà đột biến "NG"→"NTF" đã bắt được ở lượt review trước).`,
      ).toBe(kv.hanhViDung);
    }
  });

  it("★ ĐỘT BIẾN TỰ KIỂM — tinhHanhViDung KHÔNG được là một hằng số nguỵ trang (trả cứng hanhViDung bất kể input): trên một biến thể 'sạch' (không NG/NTF/overallResult khai nào) PHẢI tính ra 'OK' — cùng hợp đồng inferAoiOverallResult(ngCount:0, ntfCount:0, explicitResult:null)", () => {
    for (const h of GHI_NHAN_NO) {
      const kv = h.kyVong.overallResult as Extract<typeof h.kyVong.overallResult, { dang: "ghiNhanNoDaDuyet" }>;
      const metaSach = structuredClone(h.meta) as Record<string, unknown>;
      delete metaSach.overallResult;
      for (const tenMang of ["measurements", "points"] as const) {
        const mang = metaSach[tenMang];
        if (Array.isArray(mang)) {
          for (const phanTu of mang) {
            if (phanTu && typeof phanTu === "object") delete (phanTu as Record<string, unknown>).result;
          }
        }
      }
      const ketSach = kv.tinhHanhViDung(metaSach);
      expect(
        ketSach,
        `"${h.ten}": tinhHanhViDung trên biến thể KHÔNG NG/NTF nào phải trả "OK" — nếu không, hàm nghi ngờ ` +
          `là một hằng số nguỵ trang (luôn trả "${kv.hanhViDung}" bất kể dữ liệu vào).`,
      ).toBe("OK");
    }
  });

  it("giaTriQuanSatDuoc/giaTriDung: với 'khangDinh' hai hàm trả CÙNG giá trị; với 'ghiNhanNoDaDuyet' trả HAI giá trị KHÁC NHAU (đúng thiết kế tách biệt)", () => {
    for (const h of HINH_DANG_CHAP_NHAN) {
      const kv = h.kyVong.overallResult;
      const quanSat = giaTriQuanSatDuoc(kv);
      const dung = giaTriDung(kv);
      if (kv.dang === "khangDinh") {
        expect(quanSat, `"${h.ten}": khangDinh ⇒ giaTriQuanSatDuoc===giaTriDung`).toBe(dung);
      } else {
        expect(quanSat, `"${h.ten}": ghiNhanNoDaDuyet ⇒ giaTriQuanSatDuoc (hiện tại) KHÁC giaTriDung (đúng) — đúng bản chất "nợ"`).not.toBe(dung);
      }
    }
  });

  it("★★★ ĐÚNG BÀI HỌC BG-91 — hình dạng inspectionTime-dài-ở-cửa-ZIP nay dùng 'khangDinh' (đã vá ở 6082df2f), KHÔNG còn 'ghiNhanNoDaDuyet'", () => {
    const shape = BANG_HINH_DANG.find((h) => h.ten === "ngayGioDaiThatDuocNhanOCuaZip_BG91_daVa");
    expect(shape, "hình dạng BG-91 phải tồn tại (đổi tên từ …BiTuChoiOCuaZip_KHAC_v1x)").toBeTruthy();
    expect(shape!.kyVong.loai).toBe("chapNhan");
    if (shape!.kyVong.loai === "chapNhan") {
      expect(shape!.kyVong.overallResult.dang, "BG-91 đã vá — kỳ vọng phải là khangDinh, không phải ghi nhận nợ").toBe("khangDinh");
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// §5 ★★★ MỚI (Pha 1F Task 8, I-2) — maBacklog PHẢI trỏ một mục CÓ THẬT trong
// backlog toàn cảnh, không chỉ khớp regex hình dạng chuỗi `/^BG-\d+$/`. Đo
// được TRƯỚC bản sửa này: đột biến "BG-77"→"BG-9999" (mã KHÔNG tồn tại) qua
// được 49/49 — §4 chỉ kiểm HÌNH DẠNG chuỗi, không kiểm LIÊN KẾT tới một mục
// nợ thật. `docs/superpowers/specs/2026-08-31-aoi-backlog-toan-canh.md` là
// tệp PHÂN TÍCH ĐƯỢC (đọc + regex mọi mã `BG-<số>` xuất hiện trong đó) —
// hoàn toàn canh được, như brief yêu cầu.
// ════════════════════════════════════════════════════════════════════════════
describe("★★★ §5 — I-2: maBacklog PHẢI trỏ một mục CÓ THẬT trong backlog toàn cảnh", () => {
  const DUONG_BACKLOG_TOAN_CANH = new URL(
    "../../docs/superpowers/specs/2026-08-31-aoi-backlog-toan-canh.md",
    import.meta.url,
  );
  const NOI_DUNG_BACKLOG_TOAN_CANH = readFileSync(DUONG_BACKLOG_TOAN_CANH, "utf8");
  const MA_BACKLOG_TON_TAI = new Set(
    Array.from(NOI_DUNG_BACKLOG_TOAN_CANH.matchAll(/BG-\d+/g), (m) => m[0]),
  );

  const HINH_DANG_CHAP_NHAN = BANG_HINH_DANG.filter(
    (h): h is typeof h & { kyVong: { loai: "chapNhan" } } => h.kyVong.loai === "chapNhan",
  );
  const GHI_NHAN_NO = HINH_DANG_CHAP_NHAN.filter((h) => h.kyVong.overallResult.dang === "ghiNhanNoDaDuyet");

  it(`docs/superpowers/specs/2026-08-31-aoi-backlog-toan-canh.md đọc được, có ≥30 mã BG- phân biệt (đo được: ${MA_BACKLOG_TON_TAI.size}) — chống tự thoả (đường dẫn sai/tệp rỗng ⇒ tập rỗng ⇒ MỌI maBacklog đều "không tồn tại", lưới sẽ đỏ SAI LÝ DO)`, () => {
    expect(MA_BACKLOG_TON_TAI.size).toBeGreaterThanOrEqual(30);
  });

  it("★★★ mọi maBacklog trong BANG_HINH_DANG khớp một mã CÓ THẬT trong backlog toàn cảnh (vd 'BG-9999' khớp /^BG-\\d+$/ nhưng KHÔNG xuất hiện trong tài liệu ⇒ phải ĐỎ ở đây)", () => {
    for (const h of GHI_NHAN_NO) {
      const kv = h.kyVong.overallResult as Extract<typeof h.kyVong.overallResult, { dang: "ghiNhanNoDaDuyet" }>;
      expect(
        MA_BACKLOG_TON_TAI.has(kv.maBacklog),
        `"${h.ten}": maBacklog "${kv.maBacklog}" KHÔNG xuất hiện trong ` +
          `docs/superpowers/specs/2026-08-31-aoi-backlog-toan-canh.md — không phải một mục nợ có thật, ` +
          `chỉ là một chuỗi khớp hình dạng "BG-<số>".`,
      ).toBe(true);
    }
  });

  it("★ ĐỐI CHỨNG — 'BG-9999' (mã bịa dùng trong đột biến review) KHÔNG có trong tập đọc được từ tài liệu (chứng minh lưới PHÂN BIỆT được, không tự thoả toàn bộ)", () => {
    expect(MA_BACKLOG_TON_TAI.has("BG-9999")).toBe(false);
  });
});
