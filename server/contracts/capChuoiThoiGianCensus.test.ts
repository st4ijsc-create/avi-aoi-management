// server/contracts/capChuoiThoiGianCensus.test.ts
//
// Pha 1F Task 6 (review lượt 7, C-2 ⛔) — CENSUS TRẦN THỜI GIAN trên CẢ SÁU
// hợp đồng ingest, tiêu chí MỚI (xem docblock lớn tại `kiemTraTranThoiGian`,
// `capChuoiVarcharScan.ts`): không hỏi "trường này có alias ở đâu không"
// (tiêu chí BG-91 dùng — CẤU TRÚC KHÔNG THỂ tìm ra `startedAt` vì v1.x không
// khai trường này), mà hỏi TRỰC TIẾP trên MỌI trường thời gian của MỌI hợp
// đồng: "trần hiện tại có ≥ độ dài `DateTime.ToString()` dài nhất đã đo
// (50 ký tự, margin tới 64) không?".
//
// Đây là LẦN THỨ BA cùng một lớp lỗi bị vá — file này là LƯỚI CANH để không
// có lần thứ tư: một trường thời gian MỚI (khớp quy ước đặt tên "…At"/"…Time"/
// "ts") được thêm vào BẤT KỲ hợp đồng nào trong sáu, với trần < 64, PHẢI tự
// động bị bắt — KHÔNG cần ai cập nhật một bảng kiểm kê viết tay (§4 chứng
// minh chính xác điều đó).
//
// Sáu phần:
//   §0 — `laTenTruongThoiGian` tự đúng trên tên biết trước (đơn vị nhỏ).
//   §1 — `kiemTraTranThoiGian` 0 lỗi trên CẢ SÁU schema THẬT (sau bản vá).
//   §2 — CHỐNG TỰ THOẢ: tổng số trường thời gian tìm được GHIM theo schema
//        (một bộ đếm hỏng trả 0 sẽ bị bắt ở đây).
//   §3 — ĐỘT BIẾN THẬT (trong bộ nhớ): hạ `.max()` của MỖI trường thời gian
//        ĐANG CÓ xuống 40 ⇒ census ĐỎ, nêu đúng tên, không kéo trường khác.
//   §4 — ★★★ ĐỘT BIẾN BẮT BUỘC (mệnh đề (b) của brief Task 6): THÊM một
//        trường thời gian MỚI (trần 40) vào BẤT KỲ hợp đồng nào trong sáu ⇒
//        census ĐỎ, nêu đúng tên — KHÔNG cần sửa bảng/danh sách nào.
//   §5 — CHỐNG HỒI QUY: chuỗi `DateTime.ToString()` 50/45 ký tự (nguyên văn
//        bằng chứng review) được CHẤP NHẬN trên MỌI trường thời gian đã vá.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { machineDataContractV2 } from "./machineDataContractV2";
import {
  submitInspectionCoreObject,
  submitProcessResultCoreObject,
  syncEdgeResultsCoreObject,
} from "../routers/machineApiRouters";
import { presignCoreObject, metaJsonSchema } from "../routers/aoiPackageRouter";
import {
  kiemTraTranThoiGian,
  laTenTruongThoiGian,
  duyetTimTruongChuoi,
  TRAN_TOI_THIEU_THOI_GIAN,
} from "./capChuoiVarcharScan";

// Nguyên văn hai dòng bằng chứng DateTime.ToString() từ review lượt 6/7 (giống
// machineApiThoiGianDaiThat.test.ts / aoiPackageZipInspectionTimeDaiThat.test.ts).
const CHUOI_50 = "Sun Aug 30 2026 14:26:51 GMT+0700 (Indochina Time)";
const CHUOI_45 = "Sunday, August 30, 2026 12:00:00 PM GMT+07:00";

interface MucSchemaThoiGian {
  readonly ten: string;
  readonly schema: z.ZodTypeAny;
}

/** Sáu hợp đồng ingest — ĐÚNG danh sách brief Task 6 liệt kê. */
const DANH_SACH_SCHEMA: readonly MucSchemaThoiGian[] = [
  { ten: "machineDataContractV2", schema: machineDataContractV2 },
  { ten: "metaJsonSchema", schema: metaJsonSchema },
  { ten: "submitInspectionCoreObject", schema: submitInspectionCoreObject },
  { ten: "submitProcessResultCoreObject", schema: submitProcessResultCoreObject },
  { ten: "syncEdgeResultsCoreObject", schema: syncEdgeResultsCoreObject },
  { ten: "presignCoreObject", schema: presignCoreObject },
];

// Chụp NGUYÊN VĂN ba file nguồn bị Task 6 sửa THẬT — đột biến ở §3/§4 chỉ dựng
// schema MỚI trong bộ nhớ (`.extend()`/dựng lại object), KHÔNG `writeFileSync`.
const DUONG_MDC_V2 = new URL("./machineDataContractV2.ts", import.meta.url);
const DUONG_AOI_PACKAGE = new URL("../routers/aoiPackageRouter.ts", import.meta.url);
const DUONG_MACHINE_API = new URL("../routers/machineApiRouters.ts", import.meta.url);
const NOI_DUNG_MDC_V2_GOC = readFileSync(DUONG_MDC_V2, "utf8");
const NOI_DUNG_AOI_PACKAGE_GOC = readFileSync(DUONG_AOI_PACKAGE, "utf8");
const NOI_DUNG_MACHINE_API_GOC = readFileSync(DUONG_MACHINE_API, "utf8");

// ════════════════════════════════════════════════════════════════════════════
// §0 — laTenTruongThoiGian tự đúng trên tên biết trước.
// ════════════════════════════════════════════════════════════════════════════
describe("§0 — laTenTruongThoiGian: heuristic theo TÊN, tự đúng trên các ca biết trước", () => {
  it("khớp mọi tên THẬT đang dùng trong sáu hợp đồng", () => {
    for (const ten of ["startedAt", "completedAt", "finishedAt", "inspectionTime", "serverReceivedAt", "inferredAt", "ts"]) {
      expect(laTenTruongThoiGian(ten), `"${ten}" phải được nhận diện là trường thời gian`).toBe(true);
    }
  });

  it("KHÔNG khớp tên KHÔNG phải thời gian (chống dương tính giả)", () => {
    for (const ten of ["serialNumber", "machineCode", "apiKey", "value", "unit", "format", "rate", "state", "componentId", "result"]) {
      expect(laTenTruongThoiGian(ten), `"${ten}" KHÔNG được nhận diện là trường thời gian`).toBe(false);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// §1 — kiemTraTranThoiGian 0 lỗi trên CẢ SÁU schema THẬT.
// ════════════════════════════════════════════════════════════════════════════
describe("§1 — kiemTraTranThoiGian: 0 lỗi trên CẢ SÁU hợp đồng THẬT (sau bản vá Task 6)", () => {
  for (const { ten, schema } of DANH_SACH_SCHEMA) {
    it(`${ten} — mọi trường thời gian có .max() ≥ ${TRAN_TOI_THIEU_THOI_GIAN}`, () => {
      const r = kiemTraTranThoiGian(schema, ten);
      expect(r.loi, r.loi.join("\n")).toEqual([]);
    });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// §2 — CHỐNG TỰ THOẢ: tổng + breakdown theo schema GHIM.
// ════════════════════════════════════════════════════════════════════════════
describe("★★★ §2 — CHỐNG TỰ THOẢ: dân số trường thời gian tìm được GHIM theo schema", () => {
  it("★★★ breakdown ĐÚNG theo schema — đổi số này là một lời khai (thêm/bớt trường thời gian)", () => {
    const dem = Object.fromEntries(
      DANH_SACH_SCHEMA.map(({ ten, schema }) => [ten, kiemTraTranThoiGian(schema, ten).soTruongThoiGian]),
    );
    expect(dem).toEqual({
      // machineDataContractV2: startedAt/completedAt ở CẢ BỐN cấp (gốc, position, capture, component) = 8
      machineDataContractV2: 8,
      // BG-85 — metaJsonSchema = machineDataContractV2.extend({images}) — images[]
      // KHÔNG có trường thời gian nào (captureId/fileName/captureName/sha256) ⇒
      // CÙNG 8 trường thời gian của machineDataContractV2, không còn 3 trường
      // startedAt/finishedAt/inspectionTime riêng của hợp đồng phẳng cũ (đã xoá).
      metaJsonSchema: 8,
      // submitInspectionCoreObject: inspectionTime, serverReceivedAt = 2
      submitInspectionCoreObject: 2,
      // submitProcessResultCoreObject: ts, serverReceivedAt = 2
      submitProcessResultCoreObject: 2,
      // syncEdgeResultsCoreObject: results[].inferredAt = 1
      syncEdgeResultsCoreObject: 1,
      // presignCoreObject: KHÔNG có trường thời gian nào (4 lá: apiKey/machineCode/inspectionId/sha256)
      presignCoreObject: 0,
    });
  });

  it("★★★ TỔNG ≥12 trên toàn bộ sáu hợp đồng (chống bộ đếm hỏng trả 0/vài trường giả tạo)", () => {
    const tong = DANH_SACH_SCHEMA.reduce(
      (sum, { ten, schema }) => sum + kiemTraTranThoiGian(schema, ten).soTruongThoiGian,
      0,
    );
    expect(tong).toBeGreaterThanOrEqual(12);
  });

  it("presignCoreObject — 0 trường thời gian là ĐÚNG (đối chứng: census không tự thoả khi hợp đồng không có trường nào khớp tên)", () => {
    const r = kiemTraTranThoiGian(presignCoreObject, "presignCoreObject");
    expect(r.soTruongThoiGian).toBe(0);
    expect(r.loi).toEqual([]);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Tiện ích ĐỘT BIẾN dùng chung cho §3/§4 — mirror `taoSchemaDotBien` của
// capChuoiVarcharCensus.test.ts/capChuoiMetaJsonCensus.test.ts, TỔNG QUÁT HOÁ
// để nhận `goc` (root schema) làm THAM SỐ thay vì hardcode machineDataContractV2
// — cần thiết vì lưới này chạy trên SÁU schema, không phải một.
// ════════════════════════════════════════════════════════════════════════════

/** "surfaces[].positions[].startedAt" → ["surfaces","[]","positions","[]","startedAt"] — nghịch đảo `noiDuongDan` (capChuoiVarcharScan.ts). */
function tachDuongDanThanhBuoc(duongDan: string): string[] {
  const buoc: string[] = [];
  for (const tok of duongDan.split(".")) {
    if (tok.endsWith("[]")) buoc.push(tok.slice(0, -2), "[]");
    else buoc.push(tok);
  }
  return buoc;
}

/** Hạ trần một lá `ZodString`/nhánh chuỗi của `ZodUnion` xuống `moi` — GIỮ optional/nullable bọc ngoài. */
function datMaxGiuVo(node: z.ZodTypeAny, moi: number): z.ZodTypeAny {
  if (node instanceof z.ZodOptional) return z.optional(datMaxGiuVo(node.unwrap(), moi));
  if (node instanceof z.ZodNullable) return z.nullable(datMaxGiuVo(node.unwrap(), moi));
  if (node instanceof z.ZodUnion) {
    const options = (node.options as z.ZodTypeAny[]).map((o) => (o instanceof z.ZodString ? z.string().max(moi) : o));
    return z.union(options as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]);
  }
  if (node instanceof z.ZodString) return z.string().max(moi);
  throw new Error(`datMaxGiuVo: kiểu không hỗ trợ tại lá (${(node as any)?.constructor?.name ?? typeof node})`);
}

/** Dựng lại `goc` với ĐÚNG một trường ở `buoc` (đường dạng MẢNG bước, không phải chuỗi) bị thay bằng `moiHoa(nguyenBan)`. */
function apDungDotBienTheoDuong(goc: z.ZodTypeAny, buoc: readonly string[], moiHoa: (n: z.ZodTypeAny) => z.ZodTypeAny): z.ZodTypeAny {
  function apDung(node: any, con: readonly string[]): any {
    if (con.length === 0) return moiHoa(node);
    let thuc = node;
    while (thuc instanceof z.ZodOptional || thuc instanceof z.ZodNullable || thuc instanceof z.ZodDefault) thuc = thuc.unwrap();
    const [b, ...conLai] = con;
    if (b === "[]") return z.array(apDung(thuc.element, conLai));
    return z.object({ ...thuc.shape, [b]: apDung(thuc.shape[b], conLai) });
  }
  return apDung(goc, buoc);
}

/** Mọi trường THỜI GIAN thật (`laTenTruongThoiGian`) hiện có trong một schema, kèm đường dạng MẢNG BƯỚC. */
function truongThoiGianThat(schema: z.ZodTypeAny): Array<{ duongDan: string; buoc: string[] }> {
  return duyetTimTruongChuoi(schema)
    .filter((l) => laTenTruongThoiGian(l.duongDan.split(".").pop()!))
    .map((l) => ({ duongDan: l.duongDan, buoc: tachDuongDanThanhBuoc(l.duongDan) }));
}

// ════════════════════════════════════════════════════════════════════════════
// §3 — ĐỘT BIẾN THẬT: hạ MỖI trường thời gian ĐANG CÓ xuống .max(40).
// ════════════════════════════════════════════════════════════════════════════
describe("★★★ §3 — ĐỘT BIẾN THẬT (trong bộ nhớ): hạ .max() của MỖI trường thời gian ĐANG CÓ xuống 40 ⇒ census ĐỎ đúng tên", () => {
  for (const { ten, schema } of DANH_SACH_SCHEMA) {
    const cacTruong = truongThoiGianThat(schema);
    for (const { duongDan, buoc } of cacTruong) {
      it(`${ten}.${duongDan} → .max(40) ⇒ ĐỎ đúng tên, không kéo trường khác`, () => {
        const dotBien = apDungDotBienTheoDuong(schema, buoc, (n) => datMaxGiuVo(n, 40));
        const r = kiemTraTranThoiGian(dotBien, ten);
        expect(
          r.loi,
          `output thật:\n${r.loi.join("\n")}`,
        ).toEqual([
          `[${ten}] ${duongDan}: .max(40) < ${TRAN_TOI_THIEU_THOI_GIAN} — nhỏ hơn định dạng ` +
            `DateTime.ToString() dài nhất đã đo (50 ký tự, dư margin tới ${TRAN_TOI_THIEU_THOI_GIAN})`,
        ]);
      });
    }
  }

  it("CHỐNG 'XANH VÌ QUÉT TRÚNG 0 THỨ': §3 THẬT SỰ chạy ≥12 ca (một vòng for rỗng sẽ khiến describe này có 0 test — bằng chứng gián tiếp qua tổng đếm)", () => {
    const tong = DANH_SACH_SCHEMA.reduce((sum, { schema }) => sum + truongThoiGianThat(schema).length, 0);
    expect(tong).toBeGreaterThanOrEqual(12);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// §4 — ★★★ ĐỘT BIẾN BẮT BUỘC (mệnh đề (b) brief Task 6): trường thời gian MỚI.
// ════════════════════════════════════════════════════════════════════════════
describe("★★★ §4 — ĐỘT BIẾN BẮT BUỘC: THÊM một trường thời gian MỚI (trần 40) vào BẤT KỲ hợp đồng nào ⇒ census ĐỎ đúng tên, KHÔNG cần sửa bảng/danh sách nào", () => {
  for (const { ten, schema } of DANH_SACH_SCHEMA) {
    it(`${ten} + kiemTraThuAt (KHÔNG có trong DANH_SACH_SCHEMA/bất kỳ bảng nào, .max(40)) ⇒ census ĐỎ đúng tên`, () => {
      const dotBien = (schema as any).extend({ kiemTraThuAt: z.string().max(40).optional() });
      const r = kiemTraTranThoiGian(dotBien, ten);
      expect(r.loi).toEqual([
        `[${ten}] kiemTraThuAt: .max(40) < ${TRAN_TOI_THIEU_THOI_GIAN} — nhỏ hơn định dạng ` +
          `DateTime.ToString() dài nhất đã đo (50 ký tự, dư margin tới ${TRAN_TOI_THIEU_THOI_GIAN})`,
      ]);
    });
  }

  it("ĐỐI CHỨNG — trường MỚI CÙNG TÊN nhưng .max(64) ⇒ KHÔNG đỏ (không báo oan trường mới hợp lệ)", () => {
    const dotBien = (machineDataContractV2 as any).extend({ kiemTraThuAt: z.string().max(64).optional() });
    const r = kiemTraTranThoiGian(dotBien, "machineDataContractV2");
    expect(r.loi).toEqual([]);
  });

  it("ĐỐI CHỨNG — trường MỚI KHÔNG khớp tên thời gian (vd 'ghiChuThem') dù .max(1) ⇒ NGOÀI PHẠM VI census này (kiemTraToanBoTruongChuoi mới đòi MỌI chuỗi có .max(), lưới này CHỈ đòi nhóm thời gian)", () => {
    const dotBien = (machineDataContractV2 as any).extend({ ghiChuThem: z.string().max(1).optional() });
    const r = kiemTraTranThoiGian(dotBien, "machineDataContractV2");
    expect(r.loi).toEqual([]);
    expect(r.soTruongThoiGian).toBe(truongThoiGianThat(machineDataContractV2).length); // KHÔNG tăng — trường mới bị bỏ qua đúng như thiết kế
  });

  it("trường thời gian MỚI lồng SÂU trong mảng ('images[].checkedAt') cũng bị bắt — walker đệ quy đúng qua ZodArray lồng nhau", () => {
    const dotBien = (metaJsonSchema as any).extend({
      images: z.array(
        z.object({
          captureId: z.string().max(64),
          fileName: z.string().max(255),
          checkedAt: z.string().max(40).optional(), // MỚI — cố ý trần thấp
        }),
      ).optional(),
    });
    const r = kiemTraTranThoiGian(dotBien, "metaJsonSchema");
    expect(r.loi).toEqual([
      `[metaJsonSchema] images[].checkedAt: .max(40) < ${TRAN_TOI_THIEU_THOI_GIAN} — nhỏ hơn định dạng ` +
        `DateTime.ToString() dài nhất đã đo (50 ký tự, dư margin tới ${TRAN_TOI_THIEU_THOI_GIAN})`,
    ]);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// §5 — CHỐNG HỒI QUY: chuỗi DateTime.ToString() 50/45 ký tự ĐƯỢC CHẤP NHẬN.
// ════════════════════════════════════════════════════════════════════════════
describe("★★★ §5 — CHỐNG HỒI QUY: chuỗi DateTime.ToString() 50/45 ký tự (bằng chứng review NGUYÊN VĂN) ĐƯỢC CHẤP NHẬN trên MỌI trường thời gian đã vá", () => {
  it.each([["50 ký tự", CHUOI_50], ["45 ký tự", CHUOI_45]])(
    "machineDataContractV2 — startedAt/completedAt Ở CẢ BỐN CẤP, chuỗi %s",
    (_ten, chuoi) => {
      const mau = {
        identity: { station: "S", machine: "M", line: "L", plant: "P", country: "VN", solutionName: "SOL", appVersion: "1.0" },
        productId: "PID-1",
        serialNumber: "SN-1",
        overallResult: "OK",
        ntf: false,
        startedAt: chuoi,
        completedAt: chuoi,
        summary: {
          surfaces: { total: 1, pass: 1, ng: 0, ntf: 0 },
          positions: { total: 1, pass: 1, ng: 0, ntf: 0 },
          captures: { total: 1, pass: 1, ng: 0, ntf: 0 },
          components: { total: 0, pass: 0, ng: 0, ntf: 0 },
        },
        surfaces: [{
          name: "TOP", result: "OK", ntf: false,
          positions: [{
            positionId: "P1", result: "OK", ntf: false, startedAt: chuoi, completedAt: chuoi,
            captures: [{
              captureId: "C1", result: "OK", ntf: false, startedAt: chuoi, completedAt: chuoi,
              components: [{
                componentId: "K1", result: "OK", ntf: false, startedAt: chuoi, completedAt: chuoi,
              }],
            }],
          }],
        }],
      };
      const r = machineDataContractV2.safeParse(mau);
      expect(r.success, r.success ? "" : JSON.stringify((r as { error?: unknown }).error)).toBe(true);
    },
  );

  it.each([["50 ký tự", CHUOI_50], ["45 ký tự", CHUOI_45]])(
    "submitProcessResultCoreObject — ts/serverReceivedAt, chuỗi %s",
    (_ten, chuoi) => {
      const mau = {
        machineCode: "MC-01", serialNumber: "SN-1", stepType: "reflow", result: "pass",
        ts: chuoi, serverReceivedAt: chuoi,
      };
      const r = submitProcessResultCoreObject.safeParse(mau);
      expect(r.success, r.success ? "" : JSON.stringify((r as { error?: unknown }).error)).toBe(true);
    },
  );

  it.each([["50 ký tự", CHUOI_50], ["45 ký tự", CHUOI_45]])(
    "syncEdgeResultsCoreObject — results[].inferredAt (nhánh chuỗi), chuỗi %s",
    (_ten, chuoi) => {
      const mau = {
        deploymentId: 1,
        results: [{
          localResultId: "R1", predictions: [{ label: "ok", confidence: 0.9 }],
          confidence: 0.9, topLabel: "ok", inferredAt: chuoi,
        }],
      };
      const r = syncEdgeResultsCoreObject.safeParse(mau);
      expect(r.success, r.success ? "" : JSON.stringify((r as { error?: unknown }).error)).toBe(true);
    },
  );

  it("CHỐNG HỒI QUY NGƯỢC: chuỗi 65 ký tự (quá .max(64) một ký tự) VẪN bị từ chối trên machineDataContractV2.startedAt — không phải unbounded", () => {
    const raiRac = "x".repeat(65);
    const mau: any = {
      identity: { station: "S", machine: "M", line: "L", plant: "P", country: "VN", solutionName: "SOL", appVersion: "1.0" },
      productId: "PID-1", serialNumber: "SN-1", overallResult: "OK", ntf: false,
      startedAt: raiRac,
      summary: {
        surfaces: { total: 0, pass: 0, ng: 0, ntf: 0 }, positions: { total: 0, pass: 0, ng: 0, ntf: 0 },
        captures: { total: 0, pass: 0, ng: 0, ntf: 0 }, components: { total: 0, pass: 0, ng: 0, ntf: 0 },
      },
      surfaces: [],
    };
    expect(machineDataContractV2.safeParse(mau).success).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// §6 — ba file nguồn KHÔNG hề bị đụng bởi toàn bộ đột biến trong chính file này.
// ════════════════════════════════════════════════════════════════════════════
describe("§6 — ba file nguồn ĐÃ SỬA THẬT của Task 6 không bị đụng THÊM bởi đột biến trong CHÍNH file test này", () => {
  it("machineDataContractV2.ts trên đĩa khớp nguyên văn bản chụp lúc nạp module", () => {
    expect(readFileSync(DUONG_MDC_V2, "utf8")).toBe(NOI_DUNG_MDC_V2_GOC);
  });
  it("aoiPackageRouter.ts trên đĩa khớp nguyên văn bản chụp lúc nạp module", () => {
    expect(readFileSync(DUONG_AOI_PACKAGE, "utf8")).toBe(NOI_DUNG_AOI_PACKAGE_GOC);
  });
  it("machineApiRouters.ts trên đĩa khớp nguyên văn bản chụp lúc nạp module", () => {
    expect(readFileSync(DUONG_MACHINE_API, "utf8")).toBe(NOI_DUNG_MACHINE_API_GOC);
  });
});
