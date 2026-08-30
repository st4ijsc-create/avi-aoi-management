// server/contracts/capChuoiVarcharDuongIngestMacDinh.test.ts
//
// Pha 1E Task 3 (BG-69) — "census schema-walk hẹp hơn lời khai, LẦN THỨ BA".
//
// Đo được TRƯỚC bản vá này: census (`capChuoiVarcharScan.ts`) chỉ soi ĐÚNG hai
// schema (`machineDataContractV2`, `metaJsonSchema`). `submitInspectionCoreObject`
// (machineApiRouters.ts) — hợp đồng v1.x của CHÍNH hai cửa `submitInspection`/
// `submitInspectionBatch` mà `machineDataContractV2` (hợp đồng v2.0 cây) đã
// được soi — ĐÃ `export` từ Pha 1D Task 5 với chú thích "chỉ để census soi
// được" nhưng 0 census nào thực sự soi nó. Sau bản vá 9 trường ở Pha 1D, nó
// còn 20 lá chuỗi không `.max()`, 3 lá chạm cột thật. Cùng lúc, `presign`
// (`aoiPackageRouter.ts`, cửa thứ sáu) mang `inspectionId` INSERT thẳng vào
// `inspection_packages.packageId` varchar(100) mà không hề có `.max()` — một
// lỗ `22001` THẬT, xảy ra Ở BƯỚC TRƯỚC `metaJsonSchema` (meta.json chỉ xuất
// hiện sau khi ZIP đã tải lên xong).
//
// File này canh BỐN mệnh đề của brief:
//   §1 — DANH SÁCH ĐẦY ĐỦ schema census phải soi (mệnh đề 1) + walker XANH
//        trên CẢ SÁU, với danh sách miễn trừ NHỎ tường minh.
//   §2 — HAI bảng kiểm kê MỚI (`KIEM_KE_SUBMIT_INSPECTION_CORE`,
//        `KIEM_KE_PRESIGN`, `capChuoiVarcharScan.ts`) khớp SỐ ĐO ĐƯỢC, và CA
//        BIÊN trên TOÀN BỘ hai bảng (mệnh đề 2 + 3: đúng-bằng-sức-chứa HỢP LỆ).
//   §3 — CHỐNG HỒI QUY: mẫu máy THẬT vẫn parse `success:true` qua
//        `machineDataContractV2` (đường v2.0), và một payload v1.x tối thiểu
//        vẫn parse qua `submitInspectionCoreObject` SAU khi siết.
//   §4 — HAI ĐỘT BIẾN BẮT BUỘC (mệnh đề 4): (a) trường chuỗi MỚI không
//        `.max()` ở BẤT KỲ schema nào trong sáu ⇒ census ĐỎ nêu đúng tên,
//        KHÔNG cần sửa bảng; (b) trường bọc `.transform()` ⇒ walker BÁO ĐỘNG
//        (throw), không im lặng bỏ qua — kèm ca đối chứng `.default()` (TRONG
//        SUỐT, không báo động — vì `machineDataContractV2.schemaVersion` là
//        một `.default()` THẬT đang chạy sản xuất, xem `capChuoiVarcharScan.ts`).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { machineDataContractV2 } from "./machineDataContractV2";
import {
  KIEM_KE_SUBMIT_INSPECTION_CORE,
  KIEM_KE_PRESIGN,
  kiemKeTheoBang,
  kiemTraToanBoTruongChuoi,
  duyetTimTruongChuoi,
  duongDanDuLieu,
  type MucCapChuoi,
} from "./capChuoiVarcharScan";
import {
  submitInspectionCoreObject,
  submitProcessResultCoreObject,
  syncEdgeResultsCoreObject,
} from "../routers/machineApiRouters";
import { presignCoreObject, metaJsonSchema } from "../routers/aoiPackageRouter";

const MAU_MAY_THAT = "D:\\SOURCES\\AOIData\\dashboard-sample.json";

// Chụp NGUYÊN VĂN hai file nguồn bị lượt này CHỈNH SỬA THẬT (không phải một
// mutation trong bộ nhớ — khác cơ chế "chụp/so khớp" của các lưới §4 mutation
// khác trong dự án, dùng ở ĐÂY để chứng minh CÁC CA ĐỘT BIẾN trong CHÍNH file
// test này không vô tình ghi đè lên hai file đã sửa thật sự).
const DUONG_MACHINE_API = new URL("../routers/machineApiRouters.ts", import.meta.url);
const DUONG_AOI_PACKAGE = new URL("../routers/aoiPackageRouter.ts", import.meta.url);
const NOI_DUNG_MACHINE_API_GOC = readFileSync(DUONG_MACHINE_API, "utf8");
const NOI_DUNG_AOI_PACKAGE_GOC = readFileSync(DUONG_AOI_PACKAGE, "utf8");

// ════════════════════════════════════════════════════════════════════════════
// §1 — DANH SÁCH ĐẦY ĐỦ mọi schema census phải soi + VÌ SAO ĐỦ.
// ════════════════════════════════════════════════════════════════════════════
// Ranh giới KHÔNG tự nghĩ ra mới: tái dùng NGUYÊN VĂN "cửa ingest" mà
// `cuaIngestScan.ts` (Pha 1C, BG-16→BG-21→BG-39) đã ba lần sửa lại cho ĐÚNG —
// vị từ `laTenCuaIngest` (`/^submit/i` hoặc `/^sync.*result/i`) trên
// `machineApiRouter`, và `laTenCuaIngestZip` (`presign`/`commit`) trên
// `aoiPackageRouter`. Sáu cửa, sáu schema input (v1.x/v2.0 của cùng hai cửa
// TÁCH RIÊNG vì hai HÌNH DẠNG khác nhau — `quyetDinhPhienBanIngest` chọn một
// trong hai LÚC CHẠY, không phải "một cửa được soi hai lần"):
//   1&2. submitInspection / submitInspectionBatch → submitInspectionCoreObject (v1.x) + machineDataContractV2 (v2.0)
//   3&4. submitProcessResult / submitProcessResultBatch → submitProcessResultCoreObject
//   5.   syncEdgeResults → syncEdgeResultsCoreObject
//   6.   presign → presignCoreObject · commit → metaJsonSchema (parse meta.json TRONG zip)
// `commit`'s OWN input schema (apiKey/machineCode/packageId/sizeBytes/sha256)
// KHÔNG nằm trong danh sách: `packageId` ở đó chỉ SO KHỚP (SELECT eq(),
// aoiPackageRouter.ts) — gói đã được `presign` INSERT từ trước — không INSERT
// verbatim ở bước `commit`, nên không mang rủi ro `22001` mà census này được
// dựng để đóng (đối xứng lý do `machineCode`/`apiKey` VỆ SINH ở các bảng khác).
// Mọi thủ tục KHÁC của hai router này (heartbeat, key rotation, config pull,
// deployment confirm, listPackages, getPackage, …) — theo ĐÚNG vị từ
// `laTenCuaIngest`/`laTenCuaIngestZip` — KHÔNG phải cửa ingest (không nhận DỮ
// LIỆU ĐO từ máy), ngoài phạm vi. Router CRUD nội bộ (nhân viên qua UI) khác
// HẲN lớp rủi ro — người, tần suất thấp, UI có validate riêng — không phải
// nguồn của lỗi `22001` lặp lại BA LẦN mà census này tồn tại để đóng.
interface MucSchemaIngest {
  readonly ten: string;
  readonly schema: z.ZodTypeAny;
  readonly mienTru: ReadonlySet<string>;
}
const DANH_SACH_SCHEMA_INGEST: readonly MucSchemaIngest[] = [
  { ten: "machineDataContractV2", schema: machineDataContractV2,
    mienTru: new Set(["surfaces[].positions[].captures[].components[].errorDesc"]) },
  { ten: "submitInspectionCoreObject", schema: submitInspectionCoreObject,
    mienTru: new Set(["measurements[].remark"]) },
  { ten: "submitProcessResultCoreObject", schema: submitProcessResultCoreObject, mienTru: new Set() },
  { ten: "syncEdgeResultsCoreObject", schema: syncEdgeResultsCoreObject,
    mienTru: new Set(["results[].inputReference"]) },
  { ten: "presignCoreObject", schema: presignCoreObject, mienTru: new Set() },
  { ten: "metaJsonSchema", schema: metaJsonSchema, mienTru: new Set(["measurements[].remark"]) },
];

describe("§1 — DANH SÁCH ĐẦY ĐỦ 6 schema (6 cửa ingest) — walker XANH trên cả sáu", () => {
  it("★★★ đúng SÁU schema đăng ký — đổi số này là một lời khai (thêm/bớt cửa ingest)", () => {
    expect(DANH_SACH_SCHEMA_INGEST.length).toBe(6);
  });

  for (const { ten, schema, mienTru } of DANH_SACH_SCHEMA_INGEST) {
    it(`${ten} — walker (kiemTraToanBoTruongChuoi) 0 lỗi, KHÔNG throw`, () => {
      const r = kiemTraToanBoTruongChuoi(schema, ten, mienTru);
      expect(r.loi, r.loi.join("\n")).toEqual([]);
    });
  }

  it("KHÔNG miễn trừ nào là thừa — mỗi mục trong mienTru khớp ĐÚNG một lá max:null thật (chống miễn trừ ma)", () => {
    for (const { ten, schema, mienTru } of DANH_SACH_SCHEMA_INGEST) {
      const laNull = new Set(duyetTimTruongChuoi(schema).filter((l) => l.max === null).map((l) => l.duongDan));
      for (const m of mienTru) {
        expect(laNull.has(m), `${ten}: miễn trừ "${m}" không khớp lá max:null nào thật`).toBe(true);
      }
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// §2 — Hai bảng kiểm kê MỚI khớp SỐ ĐO ĐƯỢC + CA BIÊN trên TOÀN BỘ.
// ════════════════════════════════════════════════════════════════════════════
/** Payload v1.x TỐI THIỂU hợp lệ cho `submitInspectionCoreObject` — đủ để mọi
 *  đường trong `KIEM_KE_SUBMIT_INSPECTION_CORE` ĐẾN ĐƯỢC (measurements[0] tồn
 *  tại với mọi trường liên quan). KHÔNG lấy từ mẫu máy thật (không có sample
 *  v1.x — machine thật gửi hôm nay đều v2.0 cây, xem §3) — dựng tay, tối
 *  thiểu, đúng shape schema yêu cầu (`result` bắt buộc trong mỗi measurement).
 */
function mauHopLeV1x(): any {
  return structuredClone({
    machineCode: "MC-01",
    apiKey: "mk_test",
    serialNumber: "SN123456",
    overallResult: "OK",
    inspectionTime: "2026-08-30T10:00:00Z",
    serverReceivedAt: "2026-08-30T10:00:00Z",
    measurements: [{
      pointId: "P1",
      pointCode: "P1",
      measuredValue: "12.5",
      unitScaleToCanonical: "1",
      result: "OK",
      valueZ: "1", valueHeight: "1", valueArea: "1", valueVolume: "1",
      valueVoidPct: "1", valueCoplanarity: "1", valueWarpage: "1",
      valueOffsetX: "1", valueOffsetY: "1", valueTilt: "1", valueThickness: "1",
    }],
  });
}

function mauHopLePresign(): any {
  return { apiKey: "mk_test", machineCode: "MC-01", inspectionId: "INSPECT-1", sizeBytes: 1024, sha256: "abc123" };
}

/** Đặt `gia` vào payload mẫu, đi theo đường DỮ LIỆU tương ứng `duongDan` ("[]" → phần tử 0). */
function apDungGiaTri(mau: any, duongDan: MucCapChuoi["duongDan"], gia: string): void {
  const dp = duongDanDuLieu(duongDan);
  let obj = mau;
  for (let i = 0; i < dp.length - 1; i++) obj = obj[dp[i] as keyof typeof obj];
  obj[dp[dp.length - 1] as keyof typeof obj] = gia as never;
}

describe("§2a — KIEM_KE_SUBMIT_INSPECTION_CORE (19 lá) khớp submitInspectionCoreObject THẬT", () => {
  it("★★★ đúng 19 hàng — đổi số này là một lời khai", () => {
    expect(KIEM_KE_SUBMIT_INSPECTION_CORE.length).toBe(19);
  });

  it("★★★ 3 lá 'db' (khớp cột thật) — đúng CÁC TÊN mệnh đề 2 nêu", () => {
    const dbTen = KIEM_KE_SUBMIT_INSPECTION_CORE.filter((m) => m.nguon === "db").map((m) => m.ten).sort();
    expect(dbTen).toEqual([
      "measurements[].measuredValue",
      "measurements[].pointCode",
      "measurements[].pointId",
    ].sort());
  });

  it("0 lỗi trên submitInspectionCoreObject thật (kiemKeTheoBang)", () => {
    const r = kiemKeTheoBang(submitInspectionCoreObject, KIEM_KE_SUBMIT_INSPECTION_CORE);
    expect(r.loi, r.loi.join("\n")).toEqual([]);
    expect(r.soTruongDaXet).toBe(19);
  });

  it("mỗi hàng có `ten` DUY NHẤT", () => {
    const ten = KIEM_KE_SUBMIT_INSPECTION_CORE.map((m) => m.ten);
    expect(new Set(ten).size).toBe(ten.length);
  });

  for (const muc of KIEM_KE_SUBMIT_INSPECTION_CORE) {
    it(`${muc.ten} — đúng .max(${muc.max}) ký tự vẫn HỢP LỆ (${muc.nguon === "db" ? muc.ghiChu : "vệ sinh"})`, () => {
      const p = mauHopLeV1x();
      apDungGiaTri(p, muc.duongDan, "x".repeat(muc.max));
      const r = submitInspectionCoreObject.safeParse(p);
      expect(r.success, r.success ? "" : JSON.stringify((r as { error?: unknown }).error)).toBe(true);
    });

    it(`${muc.ten} — quá .max(${muc.max}) MỘT ký tự bị TỪ CHỐI`, () => {
      const p = mauHopLeV1x();
      apDungGiaTri(p, muc.duongDan, "x".repeat(muc.max + 1));
      expect(submitInspectionCoreObject.safeParse(p).success).toBe(false);
    });
  }
});

describe("§2b — KIEM_KE_PRESIGN (4 lá) khớp presignCoreObject THẬT", () => {
  it("★★★ đúng 4 hàng", () => {
    expect(KIEM_KE_PRESIGN.length).toBe(4);
  });

  it("0 lỗi trên presignCoreObject thật", () => {
    const r = kiemKeTheoBang(presignCoreObject, KIEM_KE_PRESIGN);
    expect(r.loi, r.loi.join("\n")).toEqual([]);
    expect(r.soTruongDaXet).toBe(4);
  });

  it("★★★ inspectionId — .max(100) khớp inspection_packages.packageId (đo avi_app) — LỖ 22001 thật được đóng ở đây", () => {
    const muc = KIEM_KE_PRESIGN.find((m) => m.ten === "inspectionId")!;
    expect(muc.max).toBe(100);
    expect(muc.nguon).toBe("db");
  });

  for (const muc of KIEM_KE_PRESIGN) {
    it(`${muc.ten} — đúng .max(${muc.max}) ký tự vẫn HỢP LỆ`, () => {
      const p = mauHopLePresign();
      apDungGiaTri(p, muc.duongDan, "x".repeat(muc.max));
      const r = presignCoreObject.safeParse(p);
      expect(r.success, r.success ? "" : JSON.stringify((r as { error?: unknown }).error)).toBe(true);
    });

    it(`${muc.ten} — quá .max(${muc.max}) MỘT ký tự bị TỪ CHỐI`, () => {
      const p = mauHopLePresign();
      apDungGiaTri(p, muc.duongDan, "x".repeat(muc.max + 1));
      expect(presignCoreObject.safeParse(p).success).toBe(false);
    });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// §3 — CHỐNG HỒI QUY.
// ════════════════════════════════════════════════════════════════════════════
describe("§3 — CHỐNG HỒI QUY", () => {
  it(`${MAU_MAY_THAT} (v2.0, đường machineDataContractV2) nguyên văn ⇒ success:true SAU lượt sửa này`, () => {
    const raw = readFileSync(MAU_MAY_THAT, "utf8");
    const data = JSON.parse(raw);
    const r = machineDataContractV2.safeParse(data);
    expect(r.success, r.success ? "" : JSON.stringify((r as { error?: unknown }).error)).toBe(true);
  });

  it("payload v1.x TỐI THIỂU (mauHopLeV1x) vẫn parse được qua submitInspectionCoreObject SAU khi siết 19 .max() mới", () => {
    const r = submitInspectionCoreObject.safeParse(mauHopLeV1x());
    expect(r.success, r.success ? "" : JSON.stringify((r as { error?: unknown }).error)).toBe(true);
  });

  it("payload presign TỐI THIỂU vẫn parse được qua presignCoreObject SAU khi siết", () => {
    const r = presignCoreObject.safeParse(mauHopLePresign());
    expect(r.success, r.success ? "" : JSON.stringify((r as { error?: unknown }).error)).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// §4 — ★★★ HAI ĐỘT BIẾN BẮT BUỘC (mệnh đề 4).
// ════════════════════════════════════════════════════════════════════════════
describe("§4a — ĐỘT BIẾN (a): trường chuỗi MỚI không .max() ở BẤT KỲ schema nào trong sáu ⇒ census ĐỎ nêu đúng tên, KHÔNG cần sửa bảng", () => {
  for (const { ten, schema, mienTru } of DANH_SACH_SCHEMA_INGEST) {
    it(`${ten}.truongMoiChuaTungCo (KHÔNG .max()) ⇒ đỏ đúng tên, không kéo trường khác`, () => {
      const dotBien = (schema as any).extend({ truongMoiChuaTungCo: z.string().optional() });
      const r = kiemTraToanBoTruongChuoi(dotBien, ten, mienTru);
      expect(r.loi).toEqual([`[${ten}] truongMoiChuaTungCo: THIẾU .max()`]);
    });
  }
});

describe("§4b — ★★★ ĐỘT BIẾN (b): trường bọc .transform() ⇒ walker BÁO ĐỘNG (throw), KHÔNG im lặng bỏ qua", () => {
  for (const { ten, schema } of DANH_SACH_SCHEMA_INGEST) {
    it(`${ten}.truongTransform (bọc .transform()) ⇒ duyetTimTruongChuoi THROW, không trả [] im lặng`, () => {
      const dotBien = (schema as any).extend({
        truongTransform: z.string().max(50).transform((v) => v.trim()),
      });
      expect(() => duyetTimTruongChuoi(dotBien)).toThrow(/CHƯA HỖ TRỢ/);
    });
  }

  it("ĐỐI CHỨNG — .default() KHÔNG báo động (TRONG SUỐT, giống Optional/Nullable): machineDataContractV2.schemaVersion là MỘT .default() THẬT đang chạy sản xuất, không phải giả định", () => {
    expect(() => duyetTimTruongChuoi(machineDataContractV2)).not.toThrow();
    const dotBien = submitInspectionCoreObject.extend({ truongDefault: z.string().default("x") });
    const r = duyetTimTruongChuoi(dotBien);
    const phatHien = r.find((x) => x.duongDan === "truongDefault");
    expect(phatHien, "trường bọc .default() KHÔNG .max() phải vẫn được PHÁT HIỆN (không bị nuốt bởi unwrap)").toBeDefined();
    expect(phatHien!.max).toBeNull();
  });

  it("★ BONUS — ZodDiscriminatedUnion (lớp con của ZodUnion) KHÔNG được nhánh union thường âm thầm nuốt — throw, không phải 'không có trường chuỗi'", () => {
    const dotBien = submitInspectionCoreObject.extend({
      truongDU: z.discriminatedUnion("kind", [
        z.object({ kind: z.literal("a"), val: z.string() }), // val KHÔNG .max() — nếu union thường nuốt, sẽ không bao giờ bị bắt
      ]),
    });
    expect(() => duyetTimTruongChuoi(dotBien)).toThrow(/ZodDiscriminatedUnion/);
  });

  it("ĐỐI CHỨNG — tuple SỐ THẬT trong submitProcessResultCoreObject.waveforms[].samples KHÔNG throw (đã hỗ trợ thật, không phải miễn trừ)", () => {
    expect(() => duyetTimTruongChuoi(submitProcessResultCoreObject)).not.toThrow();
  });
});

describe("§5 — hai file nguồn ĐÃ SỬA THẬT của Task 3 không hề bị đụng THÊM bởi các ca đột biến trong chính file test này", () => {
  it("machineApiRouters.ts trên đĩa khớp nguyên văn bản chụp lúc nạp module test này", () => {
    expect(readFileSync(DUONG_MACHINE_API, "utf8")).toBe(NOI_DUNG_MACHINE_API_GOC);
  });

  it("aoiPackageRouter.ts trên đĩa khớp nguyên văn bản chụp lúc nạp module test này", () => {
    expect(readFileSync(DUONG_AOI_PACKAGE, "utf8")).toBe(NOI_DUNG_AOI_PACKAGE_GOC);
  });
});
