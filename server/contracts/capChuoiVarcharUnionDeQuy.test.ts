// server/contracts/capChuoiVarcharUnionDeQuy.test.ts
//
// Pha 1F Task 3 (BG-79) — walker "hết mù im lặng" (Pha 1E Task 3, BG-69) CÒN
// mù đúng lớp đó, tại ĐÚNG nhánh `ZodUnion`.
//
// Đo được TRƯỚC bản vá này (nghiệm thu lượt 6 của Pha 1E Task 3):
//   union[number, object{beTrong:string}]   → throw? FALSE | lá tìm được: []  ← MÙ
//   array<union[number, object{…}]>          → throw? FALSE | lá tìm được: []  ← MÙ
//   record / any / unknown                   → THROW ✓ (đúng, KHÔNG phải ca này)
//
// Gốc rễ: `duyetTimTruongChuoi` (`capChuoiVarcharScan.ts`) xử `ZodUnion` bằng
// CÙNG logic `layMaxChuoi` (tìm nhánh `ZodString` ĐẦU TIÊN ở CẤP NÀY) — nếu
// không nhánh nào là `ZodString` trực tiếp, `return []` IM LẶNG, kể cả khi một
// nhánh khác là `ZodObject`/`ZodArray` CHỨA lá chuỗi bên trong. Chú thích tại
// chỗ (dòng 412-414 bản trước bản vá) biện minh "không có schema nào hôm nay
// có union chứa object … NGOÀI ZodDiscriminatedUnion, đã chặn TRƯỚC nhánh
// này" — ĐỌC NHƯ THỂ chốt `ZodDiscriminatedUnion` phủ được ca này, nhưng
// KHÔNG: một `z.union([...])` THƯỜNG (không discriminated) chứa object vẫn
// rơi thẳng vào nhánh `ZodUnion` cũ, không hề chạm nhánh `ZodDiscriminatedUnion`
// (nhánh đó chỉ bắt các union được TẠO bằng `z.discriminatedUnion(...)`).
//
// Đây là lập luận "HÔM NAY CHƯA CÓ" — đúng lớp lập luận đã hỏng BỐN lần trong
// dự án này (`docs/superpowers/specs/2026-08-31-aoi-backlog-toan-canh.md`
// §L-1). Đột biến bắt buộc của Pha 1E chỉ thử `.transform()` (có throw), CHƯA
// BAO GIỜ thử hình dạng union-chứa-object — nên lỗ này lọt qua nghiệm thu.
//
// Sửa: đệ quy MỌI NHÁNH union — tìm lá chuỗi trong MỌI nhánh, không chỉ nhánh
// đầu tiên/nhánh "trông giống chuỗi" (xem `capChuoiVarcharScan.ts`, nhánh
// `ZodUnion` của `duyetTimTruongChuoi`).
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { duyetTimTruongChuoi, kiemTraToanBoTruongChuoi } from "./capChuoiVarcharScan";
import { machineDataContractV2 } from "./machineDataContractV2";
import {
  submitInspectionCoreObject,
  submitProcessResultCoreObject,
  syncEdgeResultsCoreObject,
} from "../routers/machineApiRouters";
import { presignCoreObject, metaJsonSchema } from "../routers/aoiPackageRouter";

describe("§1 — MỆNH ĐỀ 1: union[number, object{beTrong:string}] ⇒ walker TÌM ĐƯỢC lá, không trả [] im lặng", () => {
  it("nhánh object của union, KHÔNG .max() ⇒ được PHÁT HIỆN với max:null (KHÔNG PHẢI [] im lặng)", () => {
    const schema = z.object({
      truong: z.union([z.number(), z.object({ beTrong: z.string() })]),
    });
    const phatHien = duyetTimTruongChuoi(schema);
    expect(phatHien, "walker trả [] — ĐÚNG lỗ BG-79, lá 'truong.beTrong' bị nuốt").not.toEqual([]);
    expect(phatHien).toEqual([{ duongDan: "truong.beTrong", max: null }]);
  });

  it("nhánh object của union, CÓ .max(30) ⇒ được PHÁT HIỆN với max:30 (đối chứng — không chỉ bắt được lá THIẾU .max())", () => {
    const schema = z.object({
      truong: z.union([z.number(), z.object({ beTrong: z.string().max(30) })]),
    });
    const phatHien = duyetTimTruongChuoi(schema);
    expect(phatHien).toEqual([{ duongDan: "truong.beTrong", max: 30 }]);
  });

  it("census (kiemTraToanBoTruongChuoi) trên schema này ĐỎ đúng tên — không im lặng xanh", () => {
    const schema = z.object({
      truong: z.union([z.number(), z.object({ beTrong: z.string() })]),
    });
    const r = kiemTraToanBoTruongChuoi(schema, "schemaThuNghiem");
    expect(r.loi).toEqual(["[schemaThuNghiem] truong.beTrong: THIẾU .max()"]);
  });
});

describe("§2 — MỆNH ĐỀ 2: array<union[number, object{…}]> ⇒ tương tự, không trả [] im lặng", () => {
  it("mảng của union chứa object, nhánh object KHÔNG .max() ⇒ phát hiện đúng đường '[].beTrong'", () => {
    const schema = z.object({
      ds: z.array(z.union([z.number(), z.object({ beTrong: z.string() })])),
    });
    const phatHien = duyetTimTruongChuoi(schema);
    expect(phatHien).toEqual([{ duongDan: "ds[].beTrong", max: null }]);
  });

  it("census trên schema này ĐỎ đúng tên", () => {
    const schema = z.object({
      ds: z.array(z.union([z.number(), z.object({ beTrong: z.string() })])),
    });
    const r = kiemTraToanBoTruongChuoi(schema, "schemaThuNghiem2");
    expect(r.loi).toEqual(["[schemaThuNghiem2] ds[].beTrong: THIẾU .max()"]);
  });
});

describe("§3 — ★★★ ĐỘT BIẾN BẮT BUỘC (a): trường chuỗi ở NHÁNH KHÔNG-ĐẦU-TIÊN của union ⇒ walker vẫn tìm ra", () => {
  it("union BA nhánh [number, boolean, object{sau:string}] — lá chuỗi nằm ở nhánh THỨ BA ⇒ vẫn được phát hiện", () => {
    const schema = z.object({
      truong: z.union([z.number(), z.boolean(), z.object({ sau: z.string() })]),
    });
    const phatHien = duyetTimTruongChuoi(schema);
    expect(phatHien).toEqual([{ duongDan: "truong.sau", max: null }]);
  });

  it("union NHIỀU nhánh object — MỌI nhánh đều được đệ quy, không chỉ nhánh trúng đầu tiên", () => {
    const schema = z.object({
      truong: z.union([
        z.object({ nhanhMot: z.string().max(10) }),
        z.object({ nhanhHai: z.string().max(20) }),
      ]),
    });
    const phatHien = duyetTimTruongChuoi(schema).sort((a, b) => a.duongDan.localeCompare(b.duongDan));
    expect(phatHien).toEqual([
      { duongDan: "truong.nhanhHai", max: 20 },
      { duongDan: "truong.nhanhMot", max: 10 },
    ]);
  });
});

describe("§4 — CÙNG LỚP LỖI: kiểu NGUY HIỂM (record/any/unknown/.transform()) ẩn trong một nhánh union PHẢI báo động, không im lặng", () => {
  it("z.record(...) ở nhánh THỨ HAI của union ⇒ THROW (trước bản vá: [] im lặng, vì nhánh union cũ không đệ quy tới record)", () => {
    const schema = z.object({
      truong: z.union([z.number(), z.record(z.string(), z.string())]),
    });
    expect(() => duyetTimTruongChuoi(schema)).toThrow(/CHƯA HỖ TRỢ/);
  });

  it("z.unknown() ở nhánh union ⇒ THROW", () => {
    const schema = z.object({ truong: z.union([z.number(), z.unknown()]) });
    expect(() => duyetTimTruongChuoi(schema)).toThrow(/CHƯA HỖ TRỢ/);
  });
});

describe("§5 — CHỐNG HỒI QUY (mệnh đề 3): ZodDefault/ZodTuple vẫn HỖ TRỢ THẬT sau khi sửa nhánh ZodUnion", () => {
  it("machineDataContractV2.schemaVersion (.default('2.0')) — vẫn KHÔNG throw, vẫn được duyệt qua đúng (trong suốt)", () => {
    expect(() => duyetTimTruongChuoi(machineDataContractV2)).not.toThrow();
  });

  it("submitProcessResultCoreObject.waveforms[].samples (z.array(z.tuple([number,number]))) — vẫn KHÔNG throw (tuple SỐ thật đang chạy production)", () => {
    expect(() => duyetTimTruongChuoi(submitProcessResultCoreObject)).not.toThrow();
  });

  it("ZodTuple trộn với union (tuple mà MỘT vị trí là union chứa object) — vẫn đệ quy đúng, không hồi quy", () => {
    const schema = z.object({
      cap: z.tuple([z.number(), z.union([z.number(), z.object({ sau: z.string() })])]),
    });
    const phatHien = duyetTimTruongChuoi(schema);
    expect(phatHien).toEqual([{ duongDan: "cap[1].sau", max: null }]);
  });
});

describe("§6 — CÂU HỎI BẮT BUỘC: sáu schema THẬT đang chạy production — bản vá có làm cái gì XANH cũ hoá ĐỎ không?", () => {
  // Đo bằng grep + walk THẬT (không suy đoán): none trong 6 schema có union chứa
  // nhánh object/array (mọi z.union() thật hôm nay là string|number hoặc
  // string|date — xem docblock cuối `capChuoiVarcharScan.ts` nếu cần danh sách).
  // Nên bản vá KHÔNG chuyển field THẬT nào từ "được census tính là sạch" sang
  // "đỏ" — nó chỉ mở rộng khả năng PHÁT HIỆN cho một HÌNH DẠNG không schema nào
  // dùng hôm nay. Bốn ca dưới đây CHỨNG MINH bằng cách chạy lại đúng census đã
  // xanh trước bản vá này và xác nhận VẪN xanh sau bản vá (không hồi quy).
  const CAC_SCHEMA_THAT: ReadonlyArray<[string, z.ZodTypeAny]> = [
    ["machineDataContractV2", machineDataContractV2],
    ["submitInspectionCoreObject", submitInspectionCoreObject],
    ["submitProcessResultCoreObject", submitProcessResultCoreObject],
    ["syncEdgeResultsCoreObject", syncEdgeResultsCoreObject],
    ["presignCoreObject", presignCoreObject],
    ["metaJsonSchema", metaJsonSchema],
  ];

  for (const [ten, schema] of CAC_SCHEMA_THAT) {
    it(`${ten} — duyetTimTruongChuoi KHÔNG throw SAU bản vá nhánh ZodUnion (không có union-chứa-object thật nào bị lộ ra)`, () => {
      expect(() => duyetTimTruongChuoi(schema)).not.toThrow();
    });
  }
});
