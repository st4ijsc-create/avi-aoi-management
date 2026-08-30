// server/contracts/capChuoiMetaJsonCensus.test.ts
//
// Pha 1D Task 5 (BG-52 ⛔) — `metaJsonSchema` (cửa ZIP, `aoiPackageRouter.commit`)
// có **0 trường `.max()`** trước bản vá này, trong khi 6 trường
// (`serialNumber`/`productModel`/`batchNumber`/`productionOrderCode`/
// `stageCode`/`operatorId`) ghi NGUYÊN VĂN vào cột `varchar` của
// `product_inspections`, và các trường `measurements[]`/`points[]` ghi vào
// `package_images`. Cùng lớp lỗi BG-9/BG-27 mà `machineDataContractV2` (đường
// v2.0) đã đóng ở Task 3 — cửa ZIP chưa từng được vá.
//
// Cùng bốn điều `capChuoiVarcharCensus.test.ts` canh cho MDC v2, áp cho
// `metaJsonSchema` + bảng `KIEM_KE_META_JSON` (30 trường, `capChuoiVarcharScan.ts`):
//   §1 — census (`kiemKeTheoBang`) XANH trên hợp đồng THẬT, dân số GHIM (30).
//   §2 — CA CANH BIÊN trên TOÀN BỘ 30 trường: đúng-bằng-sức-chứa HỢP LỆ; quá 1
//        ký tự TỪ CHỐI.
//   §3 — CHỐNG HỒI QUY: `D:\SOURCES\AOIData\aoipackage-meta-sample.json` — xem
//        ★ GHI CHÚ QUAN TRỌNG bên dưới, mẫu này KHÔNG parse được bằng
//        `metaJsonSchema` (kể cả TRƯỚC bản vá `.max()` này) vì nó là hình dạng
//        MANIFEST ẢNH khác (không phải `metaJsonSchema`) — spec
//        `2026-08-24-aoi-5-cap-xuong-song-design.md:88,722` đã ghi nhận đây là
//        lỗ THẬT, có tên riêng (L-2), KHÔNG thuộc phạm vi Task 5 (chỉ `.max()`).
//        Ca dưới đây chứng minh bản vá `.max()` KHÔNG thêm bất kỳ lý do thất bại
//        MỚI nào — mẫu vẫn thất bại vì ĐÚNG một lý do trước/sau: thiếu trường
//        `measurements` bắt buộc.
//   §4 — ĐỘT BIẾN THẬT trên `kiemKeTheoBang`/`metaJsonSchema` trong bộ nhớ.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { metaJsonSchema } from "../routers/aoiPackageRouter";
import { KIEM_KE_META_JSON, kiemKeTheoBang, duongDanDuLieu, type MucCapChuoi } from "./capChuoiVarcharScan";

const MAU_GOI_ANH_THAT = "D:\\SOURCES\\AOIData\\aoipackage-meta-sample.json";

/**
 * Payload HỢP LỆ tối thiểu theo ĐÚNG hình dạng `metaJsonSchema` hôm nay
 * (measurements[] phẳng, "Đồng bộ với submitInspection measurements") — KHÔNG
 * có mẫu THẬT nào khớp hình dạng này trong `D:\SOURCES\AOIData` (xem §3), nên
 * dựng tay theo đúng field mà `aoiPackageRouter.commit` đọc (serialNumber/
 * productModel BẮT BUỘC; measurements[] BẮT BUỘC nhưng RỖNG vẫn hợp lệ).
 */
function mauHopLe(): any {
  return {
    machineCode: "AOI-01",
    inspectionId: "insp-abc-123",
    serialNumber: "SN123456",
    productModel: "MODEL-X",
    batchNumber: "LOT-2026-08",
    startedAt: "2026-08-30T09:30:00.000Z",
    finishedAt: "2026-08-30T09:30:14.000Z",
    inspectionTime: "2026-08-30T09:30:00.000Z",
    overallResult: "NG",
    companyCode: "SIM",
    factoryCode: "FAC-HN",
    factory: "FAC-HN",
    workshopCode: "WS-01",
    lineCode: "JUNIPER",
    line: "JUNIPER",
    stageCode: "AOI",
    productionOrderCode: "PO-2026-000123",
    operatorId: "OP-007",
    measurements: [
      {
        pointId: "P01",
        pointCode: "P01",
        code: "P01",
        name: "Diem do 1",
        fileName: "P01.jpg",
        result: "NG",
        measuredValue: "12.5",
        value: "12.5",
        unit: "mm",
        remark: "vuot nguong",
      },
    ],
    // Legacy — chỉ CA CANH BIÊN của points[]* cần nhánh này có mặt (tương thích
    // ngược, `metaJsonSchema.commit` chỉ ĐỌC points[] khi measurements[] RỖNG —
    // xem `normalizedMeasurements` — nhưng schema PARSE cả hai nếu cùng có mặt).
    points: [
      {
        code: "P01",
        name: "Diem do 1",
        fileName: "P01.jpg",
        result: "NG",
        value: "12.5",
        unit: "mm",
      },
    ],
    summary: { totalPoints: 1, ok: 0, ng: 1, ntf: 0 },
  };
}

/** Đặt `gia` vào payload mẫu, đi theo đường DỮ LIỆU tương ứng `duongDan` SCHEMA ("[]" → phần tử 0). */
function apDungGiaTri(mau: any, duongDan: MucCapChuoi["duongDan"], gia: string): void {
  const dp = duongDanDuLieu(duongDan);
  let obj = mau;
  for (let i = 0; i < dp.length - 1; i++) obj = obj[dp[i] as keyof typeof obj];
  obj[dp[dp.length - 1] as keyof typeof obj] = gia as never;
}

/** Bóc mọi `.max()` khỏi một `ZodType` lá — chỉ dùng để dựng đột biến §4. */
function boMax(node: z.ZodTypeAny): z.ZodTypeAny {
  if (node instanceof z.ZodOptional) return z.optional(boMax(node.unwrap()));
  if (node instanceof z.ZodNullable) return z.nullable(boMax(node.unwrap()));
  if (node instanceof z.ZodUnion) {
    const options = (node.options as z.ZodTypeAny[]).map((o) => (o instanceof z.ZodString ? z.string() : o));
    return z.union(options as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]);
  }
  if (node instanceof z.ZodString) return z.string();
  return node;
}

/** Dựng lại `metaJsonSchema` với ĐÚNG một trường ở `duongDan` bị thay bằng `moiHoa(nguyenBan)`. */
function taoSchemaDotBien(duongDan: MucCapChuoi["duongDan"], moiHoa: (n: z.ZodTypeAny) => z.ZodTypeAny): z.ZodTypeAny {
  function boLop(node: any): any {
    // metaJsonSchema.points là z.array(...).optional() — bóc Optional trước khi
    // đọc .shape/.element, cùng lý do layTheoDuong đã sửa ở capChuoiVarcharScan.ts.
    while (node instanceof z.ZodOptional || node instanceof z.ZodNullable) node = node.unwrap();
    return node;
  }
  function apDung(node: any, con: readonly string[]): any {
    const thuc = boLop(node);
    if (con.length === 0) return moiHoa(thuc);
    const [buoc, ...conLai] = con;
    if (buoc === "[]") return z.array(apDung(thuc.element, conLai));
    return z.object({ ...thuc.shape, [buoc]: apDung(thuc.shape[buoc], conLai) });
  }
  return apDung(metaJsonSchema, duongDan);
}

describe("§1 — CENSUS trên metaJsonSchema THẬT phải XANH", () => {
  it("★★★ dân số trường đã xét — GHIM 30 (đổi số này là một lời khai)", () => {
    expect(KIEM_KE_META_JSON.length).toBe(30);
  });

  it("★★★ 0 lỗi trên metaJsonSchema thật", () => {
    const r = kiemKeTheoBang(metaJsonSchema, KIEM_KE_META_JSON);
    expect(r.loi, "census ĐỎ trên hợp đồng thật — sửa .max() cho khớp KIEM_KE_META_JSON").toEqual([]);
    expect(r.soTruongDaXet).toBe(30);
  });

  it("mỗi hàng kiểm kê có `ten` DUY NHẤT (chống hai hàng cùng tên che lấp nhau)", () => {
    const ten = KIEM_KE_META_JSON.map((m) => m.ten);
    expect(new Set(ten).size).toBe(ten.length);
  });

  it("payload mẫu hợp lệ (mauHopLe) thật sự parse được (chống lưới tự thoả trên payload hỏng)", () => {
    const r = metaJsonSchema.safeParse(mauHopLe());
    expect(r.success, r.success ? "" : JSON.stringify((r as { error?: unknown }).error)).toBe(true);
  });
});

describe("§2 — CA CANH BIÊN trên TOÀN BỘ 30 trường", () => {
  for (const muc of KIEM_KE_META_JSON) {
    it(`${muc.ten} — đúng .max(${muc.max}) ký tự vẫn HỢP LỆ (${muc.nguon === "db" ? muc.ghiChu : "vệ sinh"})`, () => {
      const p = mauHopLe();
      apDungGiaTri(p, muc.duongDan, "x".repeat(muc.max));
      const r = metaJsonSchema.safeParse(p);
      expect(r.success, r.success ? "" : JSON.stringify((r as { error?: unknown }).error)).toBe(true);
    });

    it(`${muc.ten} — quá .max(${muc.max}) MỘT ký tự bị TỪ CHỐI`, () => {
      const p = mauHopLe();
      apDungGiaTri(p, muc.duongDan, "x".repeat(muc.max + 1));
      expect(metaJsonSchema.safeParse(p).success).toBe(false);
    });
  }
});

describe("§3 — mẫu THẬT trong D:\\SOURCES\\AOIData — ★ GHI CHÚ QUAN TRỌNG", () => {
  it(`${MAU_GOI_ANH_THAT} — KHÔNG parse được (TRƯỚC và SAU bản vá .max(), CÙNG một lý do — lỗ L-2 đã biết, NGOÀI phạm vi Task 5)`, () => {
    const raw = readFileSync(MAU_GOI_ANH_THAT, "utf8");
    const data = JSON.parse(raw);
    const r = metaJsonSchema.safeParse(data);
    // Đo THẬT (không suy đoán): mẫu này là MANIFEST ẢNH (`images[]` +
    // `captureId`/`surface`/`positionId`/`captureName`/`localImagePath`) — một
    // hình dạng KHÁC `metaJsonSchema` (`measurements[]` bắt buộc). File này
    // KHÔNG BAO GIỜ khai `measurements` ⇒ luôn thất bại ở ĐÚNG một lý do: field
    // bắt buộc bị thiếu — không liên quan gì tới `.max()`. Bản vá Task 5 KHÔNG
    // thêm bất kỳ lý do thất bại MỚI nào.
    expect(r.success).toBe(false);
    if (!r.success) {
      const duongLoi = r.error.issues.map((i) => i.path.join("."));
      expect(duongLoi).toEqual(["measurements"]);
      expect(r.error.issues[0].message).toContain("expected array");
    }
  });

  it("chống hồi quy THẬT SỰ: cùng mẫu, GẮN THÊM measurements:[] rỗng (mô phỏng nếu Agent tuân thủ hình dạng metaJsonSchema) ⇒ parse được, .max() không vỡ các trường identity/images vốn đã ngắn", () => {
    const raw = readFileSync(MAU_GOI_ANH_THAT, "utf8");
    const data = JSON.parse(raw);
    const r = metaJsonSchema.safeParse({ ...data, measurements: [] });
    expect(r.success, r.success ? "" : JSON.stringify((r as { error?: unknown }).error)).toBe(true);
  });
});

describe("§4 — ★★★ ĐỘT BIẾN THẬT (trong bộ nhớ, không chạm đĩa) — gỡ MỘT .max() bất kỳ ⇒ ĐỎ đúng tên", () => {
  for (const muc of KIEM_KE_META_JSON) {
    it(`gỡ .max() của "${muc.ten}" ⇒ census ĐỎ, NÊU ĐÚNG TÊN, không kéo trường khác theo`, () => {
      const schemaDotBien = taoSchemaDotBien(muc.duongDan, boMax);
      const r = kiemKeTheoBang(schemaDotBien, KIEM_KE_META_JSON);
      expect(r.loi.some((l) => l.startsWith(`${muc.ten}: THIẾU .max()`)), `output thật:\n${r.loi.join("\n")}`).toBe(true);
      expect(r.loi, "đột biến MỘT trường không được kéo trường khác báo lỗi oan").toHaveLength(1);
    });
  }

  it("★★★ LỆCH SỐ (không phải thiếu hẳn) cũng bị bắt — .max(100)→.max(99) cho productModel", () => {
    const muc = KIEM_KE_META_JSON.find((m) => m.ten === "productModel")!;
    const schemaDotBien = taoSchemaDotBien(muc.duongDan, () => z.string().max(muc.max - 1));
    const r = kiemKeTheoBang(schemaDotBien, KIEM_KE_META_JSON);
    expect(r.loi).toEqual([`${muc.ten}: .max(${muc.max - 1}) LỆCH, kỳ vọng .max(${muc.max}) — ${muc.ghiChu}`]);
  });
});
