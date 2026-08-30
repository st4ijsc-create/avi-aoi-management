// server/contracts/capChuoiVarcharSchemaWalk.test.ts
//
// Pha 1D Task 5 (BG-52 ⛔), Việc 4 — "census phải duyệt SCHEMA, không duyệt BẢNG".
//
// `capChuoiVarcharCensus.test.ts` (Task 3) canh MỘT bảng viết tay
// (`KIEM_KE_CAP_CHUOI`) — mọi ca trong đó (kể cả đột biến §4) LẶP TRÊN CHÍNH
// BẢNG, không duyệt schema. Review toàn nhánh Pha 1D chỉ ra đúng điểm mù: bảng
// chỉ khai đúng MỘT schema (`machineDataContractV2`); và ngay cả trên đúng
// schema đó, một trường chuỗi MỚI được thêm vào schema mà KHÔNG được thêm vào
// bảng vẫn lọt qua — không ca nào ở Task 3 chứng minh được điều ngược lại.
//
// File này canh HAI điều mà `capChuoiVarcharCensus.test.ts` không canh:
//   §1 — `kiemTraToanBoTruongChuoi` (duyệt SCHEMA, `capChuoiVarcharScan.ts`)
//        XANH trên CẢ HAI schema thật (`machineDataContractV2`, `metaJsonSchema`),
//        dùng ĐÚNG danh sách miễn trừ nhỏ, tường minh (không phải một bảng liệt
//        kê toàn bộ trường).
//   §2 — ĐỘT BIẾN (a): gỡ `.max()` của một trường ĐANG CÓ ⇒ đỏ, nêu đúng tên —
//        KHÔNG cần bảng nào biết trước trường đó.
//   §3 — ★★★ ĐỘT BIẾN (b), CA CHỨNG MINH VIỆC 4 THẬT SỰ LÀM ĐƯỢC: THÊM một
//        trường chuỗi HOÀN TOÀN MỚI (không tồn tại ở bất kỳ bảng kiểm kê nào,
//        không tồn tại ở schema thật) mà KHÔNG `.max()` ⇒ census ĐỎ, nêu đúng
//        tên trường mới đó — mà KHÔNG cần sửa `KIEM_KE_CAP_CHUOI` hay bất kỳ
//        danh sách miễn trừ nào. Đối chứng: cùng trường mới đó NHƯNG CÓ `.max()`
//        ⇒ vẫn xanh (không báo oan trường mới hợp lệ).
//
// Cả hai schema được đột biến TRONG BỘ NHỚ (`.extend()`/dựng lại — zod trả object
// MỚI, schema gốc trên đĩa không hề bị đụng) — cùng kỹ thuật "không ghi đĩa" đã
// dùng ở `capChuoiVarcharCensus.test.ts` §4 và `cuaIngestCensus.test.ts` §5.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { machineDataContractV2 } from "./machineDataContractV2";
import { metaJsonSchema } from "../routers/aoiPackageRouter";
import { duyetTimTruongChuoi, kiemTraToanBoTruongChuoi } from "./capChuoiVarcharScan";

// Danh sách miễn trừ NHỎ, TƯỜNG MINH — mỗi mục có lý do ghi tại chỗ khai báo
// schema (KHÔNG phải bảng liệt kê toàn bộ trường). Đổi số lượng ở đây phải là
// một lời khai có chủ đích, không phải bảo trì im lặng.
const MIEN_TRU_MDC_V2 = new Set([
  "surfaces[].positions[].captures[].components[].errorDesc", // measurement_results.errorDesc là `text`, không giới hạn thật.
]);
const MIEN_TRU_META_JSON = new Set([
  "measurements[].remark", // measurement_results.remark là `text`, không giới hạn thật.
]);

// Chụp nội dung HAI file nguồn NGAY khi module này nạp — đột biến ở §2/§3 chỉ
// dựng schema MỚI trong bộ nhớ (`.extend()`, không `writeFileSync`), nên bản
// chụp này phải khớp y nguyên khi đọc lại ở cuối file.
const DUONG_MDC_V2 = new URL("./machineDataContractV2.ts", import.meta.url);
const DUONG_AOI_ROUTER = new URL("../routers/aoiPackageRouter.ts", import.meta.url);
const NOI_DUNG_MDC_V2_GOC = readFileSync(DUONG_MDC_V2, "utf8");
const NOI_DUNG_AOI_ROUTER_GOC = readFileSync(DUONG_AOI_ROUTER, "utf8");

describe("§1 — kiemTraToanBoTruongChuoi (DUYỆT SCHEMA) XANH trên CẢ HAI schema thật", () => {
  it("machineDataContractV2 — 0 lỗi (đúng 1 miễn trừ: errorDesc)", () => {
    const r = kiemTraToanBoTruongChuoi(machineDataContractV2, "machineDataContractV2", MIEN_TRU_MDC_V2);
    expect(r.loi, r.loi.join("\n")).toEqual([]);
    // 31 lá chuỗi thật (30 có .max() + 1 miễn trừ) — đo bằng chính duyetTimTruongChuoi,
    // không suy đoán. Đổi số này là một lời khai (thêm/bớt trường chuỗi ở MDC v2).
    expect(duyetTimTruongChuoi(machineDataContractV2)).toHaveLength(31);
  });

  it("metaJsonSchema (cửa ZIP) — 0 lỗi (đúng 1 miễn trừ: measurements[].remark)", () => {
    const r = kiemTraToanBoTruongChuoi(metaJsonSchema, "metaJsonSchema", MIEN_TRU_META_JSON);
    expect(r.loi, r.loi.join("\n")).toEqual([]);
    expect(duyetTimTruongChuoi(metaJsonSchema)).toHaveLength(31);
  });

  it("KHÔNG miễn trừ nào là thừa — mỗi mục trong MIEN_TRU_* phải khớp ĐÚNG một lá max:null thật của schema (chống miễn trừ ma)", () => {
    for (const [schema, mienTru, ten] of [
      [machineDataContractV2, MIEN_TRU_MDC_V2, "machineDataContractV2"],
      [metaJsonSchema, MIEN_TRU_META_JSON, "metaJsonSchema"],
    ] as const) {
      const laNull = new Set(duyetTimTruongChuoi(schema).filter((l) => l.max === null).map((l) => l.duongDan));
      for (const m of mienTru) {
        expect(laNull.has(m), `${ten}: miễn trừ "${m}" không khớp lá max:null nào thật — có thể trường đã có .max() rồi (miễn trừ thừa) hoặc tên sai`).toBe(true);
      }
    }
  });
});

describe("§2 — ĐỘT BIẾN (a): gỡ .max() của MỘT trường ĐANG CÓ ⇒ đỏ, nêu đúng tên", () => {
  it("machineDataContractV2.serialNumber gỡ .max() ⇒ đỏ đúng tên, không kéo trường khác", () => {
    const dotBien = machineDataContractV2.extend({ serialNumber: z.string().trim() });
    const r = kiemTraToanBoTruongChuoi(dotBien, "machineDataContractV2", MIEN_TRU_MDC_V2);
    expect(r.loi).toEqual(["[machineDataContractV2] serialNumber: THIẾU .max()"]);
  });

  it("metaJsonSchema.productModel gỡ .max() ⇒ đỏ đúng tên, không kéo trường khác", () => {
    const dotBien = metaJsonSchema.extend({ productModel: z.string() });
    const r = kiemTraToanBoTruongChuoi(dotBien, "metaJsonSchema", MIEN_TRU_META_JSON);
    expect(r.loi).toEqual(["[metaJsonSchema] productModel: THIẾU .max()"]);
  });
});

describe("§3 — ★★★ ĐỘT BIẾN (b): THÊM trường chuỗi MỚI không .max() ⇒ ĐỎ TỰ ĐỘNG, không cần sửa bảng/miễn trừ nào", () => {
  it("machineDataContractV2 + trường MỚI 'maNoiBoChuaTungCo' KHÔNG .max() ⇒ census ĐỎ nêu đúng tên trường mới — KIEM_KE_CAP_CHUOI/MIEN_TRU_MDC_V2 KHÔNG hề bị sửa", () => {
    const dotBien = machineDataContractV2.extend({ maNoiBoChuaTungCo: z.string().optional() });
    const r = kiemTraToanBoTruongChuoi(dotBien, "machineDataContractV2", MIEN_TRU_MDC_V2);
    expect(r.loi).toEqual(["[machineDataContractV2] maNoiBoChuaTungCo: THIẾU .max()"]);
  });

  it("ĐỐI CHỨNG — cùng trường MỚI đó nhưng CÓ .max() ⇒ vẫn XANH (không báo oan trường mới hợp lệ)", () => {
    const dotBien = machineDataContractV2.extend({ maNoiBoChuaTungCo: z.string().max(80).optional() });
    const r = kiemTraToanBoTruongChuoi(dotBien, "machineDataContractV2", MIEN_TRU_MDC_V2);
    expect(r.loi).toEqual([]);
  });

  it("metaJsonSchema + trường MỚI 'thongSoAgentChuaTungCo' KHÔNG .max() ⇒ census ĐỎ nêu đúng tên — MIEN_TRU_META_JSON KHÔNG hề bị sửa", () => {
    const dotBien = metaJsonSchema.extend({ thongSoAgentChuaTungCo: z.string().optional() });
    const r = kiemTraToanBoTruongChuoi(dotBien, "metaJsonSchema", MIEN_TRU_META_JSON);
    expect(r.loi).toEqual(["[metaJsonSchema] thongSoAgentChuaTungCo: THIẾU .max()"]);
  });

  it("trường MỚI lồng SÂU trong mảng ('measurements[].truongMoiSau') KHÔNG .max() cũng bị bắt — walker đệ quy đúng qua ZodArray/ZodObject lồng nhau, không chỉ cấp gốc", () => {
    const dotBien = metaJsonSchema.extend({
      measurements: z.array(
        z.object({
          pointId: z.string().max(50).optional(),
          fileName: z.string().max(255),
          truongMoiSau: z.string().optional(), // MỚI — cố ý KHÔNG .max()
        }),
      ),
    });
    const r = kiemTraToanBoTruongChuoi(dotBien, "metaJsonSchema", MIEN_TRU_META_JSON);
    expect(r.loi).toEqual(["[metaJsonSchema] measurements[].truongMoiSau: THIẾU .max()"]);
  });
});

describe("§4 — hai file nguồn KHÔNG hề bị đụng bởi toàn bộ đột biến ở trên (so khớp NGUYÊN VĂN)", () => {
  it("machineDataContractV2.ts trên đĩa khớp nguyên văn bản chụp lúc nạp module", () => {
    expect(readFileSync(DUONG_MDC_V2, "utf8")).toBe(NOI_DUNG_MDC_V2_GOC);
  });

  it("aoiPackageRouter.ts trên đĩa khớp nguyên văn bản chụp lúc nạp module", () => {
    expect(readFileSync(DUONG_AOI_ROUTER, "utf8")).toBe(NOI_DUNG_AOI_ROUTER_GOC);
  });
});
