// server/contracts/capChuoiVarcharScan.ts
//
// Pha 1D Task 3 (BG-27) — bộ soi CẤU TRÚC (không phải regex trên văn bản) đối
// chiếu MỌI trường chuỗi của `machineDataContractV2` với sức chứa cột DB thật.
//
// ── Vì sao soi CẤU TRÚC, không soi VĂN BẢN ────────────────────────────────────
// `cuaIngestScan.ts` (Pha 1C) đã học bài BG-16: một regex trên mã nguồn nhìn
// nhầm nhánh (comment, chuỗi log, tên biến trùng) là XANH GIẢ kinh điển. Ở đây
// nguy cơ tương tự là: một comment nói ".max(64)" trong khi giá trị THẬT của
// `.max()` đã bị đổi, hoặc field bị đổi tên nhưng comment cũ còn nguyên. Soi
// thẳng vào đối tượng `ZodType` đã dựng (`instanceof`, `.unwrap()`, `.shape`,
// `.element`, `.options`, `.maxLength` — TOÀN BỘ là API CÔNG KHAI của zod v4,
// không đọc `._zod` nội bộ) loại bỏ hoàn toàn lớp rủi ro "văn bản nói dối".
//
// ── Hai nhóm sức chứa (xem docblock đầu `machineDataContractV2.ts`, "Vòng sửa 3") ──
// (A) KHỚP CỘT THẬT — số đo từ `information_schema.columns`, vai `avi_app`,
//     kiểm 2026-08-30 (script kiểm nằm ở nhật ký task-3-report.md, KHÔNG lưu
//     trong repo — đây là số ĐÃ ĐO, không phải suy đoán).
// (B) VỆ SINH — không khớp cột nào (đi `text`/`timestamp`, hoặc không hề ghi
//     DB) — `.max()` chỉ chặn payload rác, hằng số do task này CHỌN, không
//     phải đo từ DB.
//
// Cả hai nhóm đều nằm trong CÙNG một bảng `KIEM_KE_CAP_CHUOI` — census không
// phân biệt xử lý, chỉ phân biệt Ở LỜI GIẢI THÍCH (trường `nguon`) để người
// đọc lỗi biết sửa số nào theo DB, số nào theo quy ước nội bộ.
import { z } from "zod";
import { machineDataContractV2 } from "./machineDataContractV2";

/**
 * Bóc lớp `ZodOptional`/`ZodNullable`/`ZodDefault` cho tới khi chạm kiểu lõi.
 * `any` cố ý: hàm soi CẤU TRÚC động (duck-typing bằng `instanceof` runtime),
 * không phải mã sản xuất — `.unwrap()` của zod v4 trả kiểu `$ZodType` nội bộ
 * hẹp hơn `ZodTypeAny` công khai, ép kiểu tĩnh ở đây không phản ánh gì thêm.
 *
 * `ZodDefault` (Pha 1E Task 3, BG-69) — TRONG SUỐT giống Optional/Nullable:
 * `.default(x)` chỉ cung cấp giá trị THAY THẾ khi input là `undefined`, không
 * đổi hình dạng/độ dài của trường LÚC CÓ giá trị — `machineDataContractV2.schemaVersion`
 * (`z.literal("2.0").default("2.0")`) là ca THẬT đang tồn tại; trước bản vá
 * này nó rơi vào nhánh `return []` cuối `duyetTimTruongChuoi` một cách TÌNH CỜ
 * đúng (không phải trường chuỗi) — nay đi qua unwrap tường minh, cùng kết quả
 * nhưng không còn dựa vào một nhánh mù để đúng.
 */
function boLopNgoai(node: z.ZodTypeAny): any {
  let n: any = node;
  while (n instanceof z.ZodOptional || n instanceof z.ZodNullable || n instanceof z.ZodDefault) {
    n = n.unwrap();
  }
  return n;
}

/**
 * Trần độ dài THẬT của một trường — bóc optional/nullable, và nếu là
 * `z.union([...])` thì tìm nhánh `ZodString` bên trong (đúng hình dạng
 * `value`/`lowerLimit`/`upperLimit`: `z.union([z.string().max(n), z.number()])`).
 * `null` = không có `.max()` (đúng quy ước getter `maxLength` của zod v4).
 */
export function layMaxChuoi(node: z.ZodTypeAny): number | null {
  let n = boLopNgoai(node);
  if (n instanceof z.ZodUnion) {
    const nhanhChuoi = (n.options as z.ZodTypeAny[]).map(boLopNgoai).find((o) => o instanceof z.ZodString);
    if (!nhanhChuoi) return null;
    n = nhanhChuoi;
  }
  if (!(n instanceof z.ZodString)) return null;
  return n.maxLength;
}

/**
 * Một bước điều hướng trong `duongDan`: tên field (đi `.shape[ten]`) hoặc
 * `"[]"` (đi `.element` — bước vào phần tử của một `z.array()`).
 */
export type BuocDuongDan = string;

/**
 * Đi theo `duongDan` từ schema gốc tới `ZodType` của trường lá.
 *
 * Bóc `ZodOptional`/`ZodNullable` (`boLopNgoai`) TRƯỚC mỗi bước điều hướng —
 * cần cho `metaJsonSchema` (cửa ZIP, Pha 1D Task 5): `points` là một mảng
 * OPTIONAL (`z.array(...).optional()`), khác `machineDataContractV2` (mọi mảng
 * trên các đường trong `KIEM_KE_CAP_CHUOI` đều BẮT BUỘC) — thiếu bước bóc này
 * thì bước "[]" gọi `.element` thẳng trên `ZodOptional` (không có thuộc tính đó)
 * và ném nhầm "mất dấu". Không đổi hành vi trên MDC v2 (không có mảng/object
 * optional dọc các đường hiện có, nên bước bóc luôn là no-op ở đó).
 */
function layTheoDuong(goc: z.ZodTypeAny, duongDan: BuocDuongDan[]): z.ZodTypeAny {
  let node: any = goc;
  for (const buoc of duongDan) {
    node = boLopNgoai(node);
    node = buoc === "[]" ? node.element : node.shape[buoc];
    if (!node) {
      throw new Error(
        `layTheoDuong: mất dấu ở bước "${buoc}" (đường đầy đủ: ${duongDan.join(".")}) — ` +
          `trường đã bị đổi tên/xoá khỏi hợp đồng?`,
      );
    }
  }
  return node;
}

/** Cùng `duongDan` nhưng đi trên MỘT ĐỐI TƯỢNG DỮ LIỆU (payload mẫu) — "[]" → phần tử 0. */
export function duongDanDuLieu(duongDan: BuocDuongDan[]): (string | number)[] {
  return duongDan.map((b) => (b === "[]" ? 0 : b));
}

export interface MucCapChuoi {
  /** Tên hiển thị trong thông điệp lỗi — PHẢI duy nhất trong bảng. */
  ten: string;
  /** Đường điều hướng từ schema gốc (`machineDataContractV2`) tới trường. */
  duongDan: BuocDuongDan[];
  /** Trần kỳ vọng — số ký tự tối đa hợp lệ. */
  max: number;
  /** "db" = khớp cột THẬT (information_schema); "ve-sinh" = không khớp cột nào. */
  nguon: "db" | "ve-sinh";
  /** Giải thích ngắn — cột đích hoặc lý do vệ sinh. In ra khi census ĐỎ. */
  ghiChu: string;
}

/**
 * KIỂM KÊ ĐẦY ĐỦ — mọi trường chuỗi của `machineDataContractV2` PHẢI có `.max()`,
 * TRỪ `errorDesc` (cột đích `text`, không giới hạn thật — xem docblock
 * `machineDataContractV2.ts`). Đổi bảng này là một LỜI KHAI, không phải bảo trì
 * im lặng — mọi hàng ở đây phải khớp ĐÚNG con số đang có trong
 * `machineDataContractV2.ts` (census §1 canh điều đó).
 */
export const KIEM_KE_CAP_CHUOI: readonly MucCapChuoi[] = [
  // ── Nhóm (A) khớp cột THẬT ──────────────────────────────────────────────
  { ten: "serialNumber", duongDan: ["serialNumber"], max: 100, nguon: "db",
    ghiChu: "product_inspections.serialNumber varchar(100)" },
  { ten: "productModel", duongDan: ["productModel"], max: 100, nguon: "db",
    ghiChu: "product_inspections.productModel varchar(100)" },
  { ten: "surfaces[].name", duongDan: ["surfaces", "[]", "name"], max: 100, nguon: "db",
    ghiChu: "inspection_surfaces.surfaceName varchar(100)" },
  { ten: "surfaces[].positions[].positionId", duongDan: ["surfaces", "[]", "positions", "[]", "positionId"], max: 64, nguon: "db",
    ghiChu: "inspection_positions.positionId varchar(64)" },
  { ten: "surfaces[].positions[].captures[].captureId", duongDan: ["surfaces", "[]", "positions", "[]", "captures", "[]", "captureId"], max: 64, nguon: "db",
    ghiChu: "inspection_captures.captureExtId varchar(64)" },
  { ten: "surfaces[].positions[].captures[].captureName", duongDan: ["surfaces", "[]", "positions", "[]", "captures", "[]", "captureName"], max: 255, nguon: "db",
    ghiChu: "inspection_captures.captureName varchar(255)" },
  { ten: "surfaces[].positions[].captures[].components[].componentId", duongDan: ["surfaces", "[]", "positions", "[]", "captures", "[]", "components", "[]", "componentId"], max: 64, nguon: "db",
    ghiChu: "measurement_results.componentExtId varchar(64)" },
  { ten: "surfaces[].positions[].captures[].components[].errorCode", duongDan: ["surfaces", "[]", "positions", "[]", "captures", "[]", "components", "[]", "errorCode"], max: 50, nguon: "db",
    ghiChu: "measurement_results.errorCode varchar(50) (cột có sẵn cho Khối B, chưa ghi hôm nay)" },

  // ── Nhóm (B) vệ sinh — KHÔNG khớp cột nào ────────────────────────────────
  { ten: "type", duongDan: ["type"], max: 100, nguon: "ve-sinh",
    ghiChu: "không đọc ở đâu trong đường ingest v2.0 — chỉ parse" },
  { ten: "apiKey", duongDan: ["apiKey"], max: 256, nguon: "ve-sinh",
    ghiChu: "so khớp bằng SELECT eq(), không INSERT — không có rủi ro 22001" },
  { ten: "productId", duongDan: ["productId"], max: 200, nguon: "ve-sinh",
    ghiChu: "chỉ vào hàm băm SHA-256 làm khoá khử trùng — không có cột đích" },
  { ten: "identity.station", duongDan: ["identity", "station"], max: 200, nguon: "ve-sinh", ghiChu: "vào hàm băm khoá khử trùng, không có cột đích" },
  { ten: "identity.machine", duongDan: ["identity", "machine"], max: 200, nguon: "ve-sinh", ghiChu: "vào hàm băm khoá khử trùng, không có cột đích" },
  { ten: "identity.line", duongDan: ["identity", "line"], max: 200, nguon: "ve-sinh", ghiChu: "vào hàm băm khoá khử trùng, không có cột đích" },
  { ten: "identity.plant", duongDan: ["identity", "plant"], max: 200, nguon: "ve-sinh", ghiChu: "vào hàm băm khoá khử trùng, không có cột đích" },
  { ten: "identity.country", duongDan: ["identity", "country"], max: 200, nguon: "ve-sinh", ghiChu: "vào hàm băm khoá khử trùng, không có cột đích" },
  { ten: "identity.solutionName", duongDan: ["identity", "solutionName"], max: 200, nguon: "ve-sinh", ghiChu: "vào hàm băm khoá khử trùng, không có cột đích" },
  { ten: "identity.appVersion", duongDan: ["identity", "appVersion"], max: 200, nguon: "ve-sinh", ghiChu: "vào hàm băm khoá khử trùng, không có cột đích" },
  { ten: "startedAt", duongDan: ["startedAt"], max: 64, nguon: "ve-sinh", ghiChu: "đi timestamp (product_inspections.inspectionTime), không phải varchar — Pha 1F Task 6 (C-2 ⛔): nới từ 40, xem docblock máyDataContractV2.ts" },
  { ten: "completedAt", duongDan: ["completedAt"], max: 64, nguon: "ve-sinh", ghiChu: "đi timestamp, không phải varchar — Pha 1F Task 6: nới từ 40" },
  { ten: "surfaces[].positions[].startedAt", duongDan: ["surfaces", "[]", "positions", "[]", "startedAt"], max: 64, nguon: "ve-sinh", ghiChu: "đi timestamp (inspection_positions.startedAt), không phải varchar — Pha 1F Task 6: nới từ 40" },
  { ten: "surfaces[].positions[].completedAt", duongDan: ["surfaces", "[]", "positions", "[]", "completedAt"], max: 64, nguon: "ve-sinh", ghiChu: "đi timestamp, không phải varchar — Pha 1F Task 6: nới từ 40" },
  { ten: "surfaces[].positions[].captures[].startedAt", duongDan: ["surfaces", "[]", "positions", "[]", "captures", "[]", "startedAt"], max: 64, nguon: "ve-sinh", ghiChu: "đi timestamp (inspection_captures.startedAt), không phải varchar — Pha 1F Task 6: nới từ 40" },
  { ten: "surfaces[].positions[].captures[].completedAt", duongDan: ["surfaces", "[]", "positions", "[]", "captures", "[]", "completedAt"], max: 64, nguon: "ve-sinh", ghiChu: "đi timestamp, không phải varchar — Pha 1F Task 6: nới từ 40" },
  { ten: "surfaces[].positions[].captures[].components[].componentName", duongDan: ["surfaces", "[]", "positions", "[]", "captures", "[]", "components", "[]", "componentName"], max: 255, nguon: "ve-sinh", ghiChu: "chưa có cột đích (Khối B) — quy ước 'tên' 255" },
  { ten: "surfaces[].positions[].captures[].components[].value", duongDan: ["surfaces", "[]", "positions", "[]", "captures", "[]", "components", "[]", "value"], max: 255, nguon: "ve-sinh", ghiChu: "nhánh chuỗi — đối xứng measuredValueText varchar(255), chưa xác nhận cột" },
  { ten: "surfaces[].positions[].captures[].components[].lowerLimit", duongDan: ["surfaces", "[]", "positions", "[]", "captures", "[]", "components", "[]", "lowerLimit"], max: 255, nguon: "ve-sinh", ghiChu: "không có cột kết quả nào — đối xứng value" },
  { ten: "surfaces[].positions[].captures[].components[].upperLimit", duongDan: ["surfaces", "[]", "positions", "[]", "captures", "[]", "components", "[]", "upperLimit"], max: 255, nguon: "ve-sinh", ghiChu: "không có cột kết quả nào — đối xứng value" },
  { ten: "surfaces[].positions[].captures[].components[].startedAt", duongDan: ["surfaces", "[]", "positions", "[]", "captures", "[]", "components", "[]", "startedAt"], max: 64, nguon: "ve-sinh", ghiChu: "đi timestamp, không phải varchar — Pha 1F Task 6: nới từ 40" },
  { ten: "surfaces[].positions[].captures[].components[].completedAt", duongDan: ["surfaces", "[]", "positions", "[]", "captures", "[]", "components", "[]", "completedAt"], max: 64, nguon: "ve-sinh", ghiChu: "đi timestamp, không phải varchar — Pha 1F Task 6: nới từ 40" },
];

/**
 * Pha 1D Task 5 (BG-52 ⛔) — kiểm kê ĐẦY ĐỦ 30 trường chuỗi của `metaJsonSchema`
 * (cửa ZIP, `aoiPackageRouter.ts`), TRỪ `measurements[].remark` (cột đích `text`,
 * xem docblock tại chỗ khai báo schema). Cùng khuôn `KIEM_KE_CAP_CHUOI` — hai
 * nhóm, hai lý do:
 *   (A) KHỚP CỘT THẬT — `serialNumber`/`productModel`/`batchNumber`/
 *       `productionOrderCode` (100), `stageCode`/`operatorId` (50) →
 *       `product_inspections.*`; `measurements[]`/`points[]`: `pointId`/
 *       `pointCode`/`code` (50) → `package_images.pointCode`; `name` (255) →
 *       `.pointName`; `fileName` (255) → `.fileName`; `measuredValue`/`value`
 *       (100 — trần SIẾT HƠN trong hai cột nó chạm, xem docblock schema) →
 *       `.measurementValue`.
 *   (B) VỆ SINH — phần còn lại (đo avi_app 2026-08-30, xem docblock schema).
 *
 * ★★★ BG-72 (Pha 1F Task 2 ⛔, lượt soát THỨ HAI) — `inspectionTime` KHÔNG chỉ
 * "vệ sinh" như `startedAt`/`finishedAt`: chú thích tại chỗ khai schema tự
 * nhận nó là "Alias for startedAt (submitInspection compat)" — tức PHẢI khớp
 * `.max()` của `submitInspectionCoreObject.inspectionTime` (đường v1.x,
 * `KIEM_KE_SUBMIT_INSPECTION_CORE` ở trên). Lượt vá BG-72 đầu tiên chỉ nới
 * v1.x lên 64, bỏ sót cửa ZIP — cùng payload `DateTime.ToString()` 45-50 ký
 * tự, v1.x nhận còn ZIP ném `ZodError code:"too_big"` → đếm VĨNH VIỄN → gói
 * `'dead'` sau `nguongLoiVinhVienZip()` lượt (nặng hơn BG-73: gói CHẾT THẬT,
 * không phải kẹt `'failed'`). Đã nới `.max(64)` khớp lại — xem docblock đầy
 * đủ tại `metaJsonSchema.inspectionTime` (`aoiPackageRouter.ts`).
 */
export const KIEM_KE_META_JSON: readonly MucCapChuoi[] = [
  // ── Nhóm (A) khớp cột THẬT ────────────────────────────────────────────────
  { ten: "serialNumber", duongDan: ["serialNumber"], max: 100, nguon: "db", ghiChu: "product_inspections.serialNumber varchar(100)" },
  { ten: "productModel", duongDan: ["productModel"], max: 100, nguon: "db", ghiChu: "product_inspections.productModel varchar(100)" },
  { ten: "batchNumber", duongDan: ["batchNumber"], max: 100, nguon: "db", ghiChu: "product_inspections.batchNumber varchar(100)" },
  { ten: "stageCode", duongDan: ["stageCode"], max: 50, nguon: "db", ghiChu: "product_inspections.stageCode varchar(50)" },
  { ten: "productionOrderCode", duongDan: ["productionOrderCode"], max: 100, nguon: "db", ghiChu: "product_inspections.productionOrderCode varchar(100)" },
  { ten: "operatorId", duongDan: ["operatorId"], max: 50, nguon: "db", ghiChu: "product_inspections.operatorId varchar(50)" },
  { ten: "measurements[].pointId", duongDan: ["measurements", "[]", "pointId"], max: 50, nguon: "db", ghiChu: "package_images.pointCode varchar(50) (1/3 nguồn ứng viên — xem docblock schema)" },
  { ten: "measurements[].pointCode", duongDan: ["measurements", "[]", "pointCode"], max: 50, nguon: "db", ghiChu: "package_images.pointCode varchar(50) (2/3 nguồn ứng viên)" },
  { ten: "measurements[].code", duongDan: ["measurements", "[]", "code"], max: 50, nguon: "db", ghiChu: "package_images.pointCode varchar(50) (3/3 nguồn ứng viên)" },
  { ten: "measurements[].name", duongDan: ["measurements", "[]", "name"], max: 255, nguon: "db", ghiChu: "package_images.pointName varchar(255)" },
  { ten: "measurements[].fileName", duongDan: ["measurements", "[]", "fileName"], max: 255, nguon: "db", ghiChu: "package_images.fileName varchar(255)" },
  { ten: "measurements[].measuredValue", duongDan: ["measurements", "[]", "measuredValue"], max: 100, nguon: "db", ghiChu: "package_images.measurementValue varchar(100) — SIẾT HƠN measurement_results.measuredValueText(255), xem docblock schema" },
  { ten: "measurements[].value", duongDan: ["measurements", "[]", "value"], max: 100, nguon: "db", ghiChu: "package_images.measurementValue varchar(100) — cùng cột trên" },
  { ten: "points[].code", duongDan: ["points", "[]", "code"], max: 50, nguon: "db", ghiChu: "package_images.pointCode varchar(50) (đường points[] tương thích ngược)" },
  { ten: "points[].name", duongDan: ["points", "[]", "name"], max: 255, nguon: "db", ghiChu: "package_images.pointName varchar(255)" },
  { ten: "points[].fileName", duongDan: ["points", "[]", "fileName"], max: 255, nguon: "db", ghiChu: "package_images.fileName varchar(255)" },
  { ten: "points[].value", duongDan: ["points", "[]", "value"], max: 100, nguon: "db", ghiChu: "package_images.measurementValue varchar(100)" },

  // ── Nhóm (B) vệ sinh — KHÔNG khớp cột nào, hoặc khớp NHƯNG không ghi verbatim ──
  { ten: "machineCode", duongDan: ["machineCode"], max: 100, nguon: "ve-sinh", ghiChu: "không đọc ở đâu trong commit — chỉ parse" },
  { ten: "inspectionId", duongDan: ["inspectionId"], max: 100, nguon: "ve-sinh", ghiChu: "không đọc ở đâu trong commit — chỉ parse" },
  { ten: "startedAt", duongDan: ["startedAt"], max: 64, nguon: "ve-sinh", ghiChu: "đi timestamp qua new Date(), không phải varchar — ★★★ Pha 1F Task 6 (review lượt 7, C-2 ⛔): TRƯỜNG GỐC THẬT (':1009' đọc inspectionTime ?? startedAt, mẫu máy thật KHÔNG khai inspectionTime), nới từ .max(40) — xem docblock tại chỗ khai schema" },
  { ten: "finishedAt", duongDan: ["finishedAt"], max: 64, nguon: "ve-sinh", ghiChu: "không đọc ở đâu trong commit hôm nay — chuẩn bị trước, cùng quy ước ngày-giờ. Pha 1F Task 6 (C-2 ⛔): nới từ .max(40), cùng lý do startedAt" },
  { ten: "inspectionTime", duongDan: ["inspectionTime"], max: 64, nguon: "ve-sinh", ghiChu: "đi timestamp qua new Date(), không phải varchar — BG-72 (lượt 2): alias CỦA submitInspectionCoreObject.inspectionTime (v1.x) — PHẢI khớp .max(64), lượt vá BG-72 đầu tiên bỏ sót cửa ZIP" },
  { ten: "companyCode", duongDan: ["companyCode"], max: 50, nguon: "ve-sinh", ghiChu: "chỉ đối chiếu qua macTenantChoGhi (không ghi verbatim) — khớp corporates.code varchar(50)" },
  { ten: "factoryCode", duongDan: ["factoryCode"], max: 50, nguon: "ve-sinh", ghiChu: "chỉ đối chiếu — khớp factories.code varchar(50)" },
  { ten: "factory", duongDan: ["factory"], max: 50, nguon: "ve-sinh", ghiChu: "alias của factoryCode — cùng lý do" },
  { ten: "workshopCode", duongDan: ["workshopCode"], max: 50, nguon: "ve-sinh", ghiChu: "chỉ đối chiếu — khớp workshops.code varchar(50)" },
  { ten: "lineCode", duongDan: ["lineCode"], max: 50, nguon: "ve-sinh", ghiChu: "chỉ đối chiếu — khớp production_lines.code varchar(50)" },
  { ten: "line", duongDan: ["line"], max: 50, nguon: "ve-sinh", ghiChu: "alias của lineCode — cùng lý do" },
  { ten: "measurements[].unit", duongDan: ["measurements", "[]", "unit"], max: 50, nguon: "ve-sinh", ghiChu: "chỉ nội suy vào remark (text) — không có cột đích riêng" },
  { ten: "points[].unit", duongDan: ["points", "[]", "unit"], max: 50, nguon: "ve-sinh", ghiChu: "cùng lý do measurements[].unit" },
];

/**
 * Pha 1E Task 3 (BG-69) — KIỂM KÊ ĐẦY ĐỦ 19 lá chuỗi CỦA LƯỢT SỬA NÀY trên
 * `submitInspectionCoreObject` (`machineApiRouters.ts`, cửa `submitInspection`/
 * `submitInspectionBatch` — HÌNH DẠNG v1.x, đối xứng `machineDataContractV2`
 * là hình dạng v2.0 cây của CÙNG hai cửa, chọn bằng `quyetDinhPhienBanIngest`).
 * Đây là bảng THỨ BA cùng khuôn `KIEM_KE_CAP_CHUOI`/`KIEM_KE_META_JSON` — CHỈ
 * liệt kê 19/37 lá chuỗi thật của schema (18 lá khác ĐÃ có `.max()` từ trước —
 * xem `duyetTimTruongChuoi(submitInspectionCoreObject)` để thấy TOÀN BỘ 37;
 * bảng này không lặp lại phần đã đúng, cùng lý do `KIEM_KE_META_JSON` chỉ khai
 * "30 trường" chứ không khai lại các trường không đổi). TRỪ
 * `measurements[].remark` (cột đích `measurement_results.remark` là `text`,
 * không giới hạn thật — cùng lý do `errorDesc`/`metaJsonSchema.measurements[].remark`,
 * đăng ký ở `MIEN_TRU_SUBMIT_INSPECTION_CORE` trong
 * `capChuoiVarcharSchemaWalkCuaIngestConLai.test.ts`, KHÔNG có ở bảng này).
 *
 * (A) KHỚP CỘT THẬT — số đo `information_schema.columns`, vai `avi_app`,
 *   2026-08-30: `pointId`/`pointCode` → `measurement_point_defs.code`
 *   varchar(50) (autoCreate ghi CÙNG chuỗi vào `.name` varchar(255) qua
 *   `resolveOrCreateMeasurementPointDefId`, cột HẸP HƠN — 50 — mới là ràng
 *   buộc thật); `measuredValue` → `measurement_results.measuredValueText`
 *   varchar(255) (nhánh chuỗi khi giá trị không phải số).
 * (B) VỆ SINH — không khớp cột nào, hoặc chỉ SO KHỚP (không INSERT verbatim):
 *   `machineCode`/`apiKey` (SELECT eq() qua authenticateMachine — cùng con số
 *   `apiKey` đã chọn ở nhóm B của `KIEM_KE_CAP_CHUOI`); `inspectionTime`/
 *   `serverReceivedAt` (đi cột `timestamp`, không phải varchar); `unitScaleToCanonical`/
 *   `valueZ`…`valueThickness` (11 trường, đi cột `decimal(15,6)` qua
 *   `toOptionalDecimal()`, không phải varchar — cùng con số 255 đã chọn cho
 *   nhánh chuỗi của `value`/`lowerLimit`/`upperLimit` ở `machineDataContractV2.ts`).
 *
 * ★★★ BG-72 (Pha 1F Task 2 ⛔) — `inspectionTime`/`serverReceivedAt` TỪNG
 * `.max(40)` (cùng con số `startedAt`/`completedAt`) — ĐO LIVE cho thấy đó là
 * HỒI QUY: `DateTime.ToString()` mặc định của Agent C# (KHÔNG phải ISO-8601)
 * dài tới 45-50 ký tự, `new Date()` VẪN parse được (không phải payload rác)
 * nhưng `.max(40)` từ chối trên đường v1.x BẬN NHẤT. Nới `.max(40)` →
 * `.max(64)` (xem docblock tại `submitInspectionCoreObject.inspectionTime`/
 * `.serverReceivedAt`, `machineApiRouters.ts`, cho bằng chứng đo được đầy đủ +
 * lý do). `startedAt`/`completedAt` ở `KIEM_KE_CAP_CHUOI`
 * (machineDataContractV2, đường v2.0 cây) và `startedAt`/`finishedAt`/
 * `inspectionTime` ở `KIEM_KE_META_JSON` (cửa ZIP) GIỮ NGUYÊN 40 — brief
 * Pha 1F Task 2 đo CHỈ hai trường này (v1.x) hồi quy, không mở rộng sang
 * hai schema kia.
 */
export const KIEM_KE_SUBMIT_INSPECTION_CORE: readonly MucCapChuoi[] = [
  // ── Nhóm (A) khớp cột THẬT ──────────────────────────────────────────────
  { ten: "measurements[].pointId", duongDan: ["measurements", "[]", "pointId"], max: 50, nguon: "db",
    ghiChu: "measurement_point_defs.code varchar(50) (qua resolveOrCreateMeasurementPointDefId, autoCreate:true — cùng chuỗi cũng ghi .name varchar(255), cột hẹp hơn là ràng buộc)" },
  { ten: "measurements[].pointCode", duongDan: ["measurements", "[]", "pointCode"], max: 50, nguon: "db",
    ghiChu: "measurement_point_defs.code varchar(50) — cùng cột trên" },
  { ten: "measurements[].measuredValue", duongDan: ["measurements", "[]", "measuredValue"], max: 255, nguon: "db",
    ghiChu: "measurement_results.measuredValueText varchar(255) (nhánh chuỗi khi giá trị không phải số)" },

  // ── Nhóm (B) vệ sinh — KHÔNG khớp cột nào, hoặc chỉ SO KHỚP ──────────────
  { ten: "machineCode", duongDan: ["machineCode"], max: 50, nguon: "ve-sinh",
    ghiChu: "so khớp bằng SELECT eq() qua authenticateMachine, không INSERT — khớp sức chứa machines.code varchar(50)" },
  { ten: "apiKey", duongDan: ["apiKey"], max: 256, nguon: "ve-sinh",
    ghiChu: "so khớp bằng SELECT eq(), không INSERT — cùng con số apiKey của machineDataContractV2" },
  { ten: "inspectionTime", duongDan: ["inspectionTime"], max: 64, nguon: "ve-sinh",
    ghiChu: "đi timestamp qua new Date(), không phải varchar — BG-72: nới từ 40, DateTime.ToString() mặc định dài tới 50 ký tự vẫn phải nhận được" },
  { ten: "serverReceivedAt", duongDan: ["serverReceivedAt"], max: 64, nguon: "ve-sinh",
    ghiChu: "đi timestamp, không phải varchar (server-stamped, WAL replay) — BG-72: nới từ 40, cùng lý do inspectionTime" },
  { ten: "measurements[].unitScaleToCanonical", duongDan: ["measurements", "[]", "unitScaleToCanonical"], max: 255, nguon: "ve-sinh",
    ghiChu: "chỉ vào toNum() trong bộ nhớ để đổi đơn vị — không có cột đích" },
  { ten: "measurements[].valueZ", duongDan: ["measurements", "[]", "valueZ"], max: 255, nguon: "ve-sinh", ghiChu: "đi cột decimal(15,6) qua toOptionalDecimal(), không phải varchar" },
  { ten: "measurements[].valueHeight", duongDan: ["measurements", "[]", "valueHeight"], max: 255, nguon: "ve-sinh", ghiChu: "đi cột decimal(15,6), không phải varchar" },
  { ten: "measurements[].valueArea", duongDan: ["measurements", "[]", "valueArea"], max: 255, nguon: "ve-sinh", ghiChu: "đi cột decimal(15,6), không phải varchar" },
  { ten: "measurements[].valueVolume", duongDan: ["measurements", "[]", "valueVolume"], max: 255, nguon: "ve-sinh", ghiChu: "đi cột decimal(15,6), không phải varchar" },
  { ten: "measurements[].valueVoidPct", duongDan: ["measurements", "[]", "valueVoidPct"], max: 255, nguon: "ve-sinh", ghiChu: "đi cột decimal(15,6), không phải varchar" },
  { ten: "measurements[].valueCoplanarity", duongDan: ["measurements", "[]", "valueCoplanarity"], max: 255, nguon: "ve-sinh", ghiChu: "đi cột decimal(15,6), không phải varchar" },
  { ten: "measurements[].valueWarpage", duongDan: ["measurements", "[]", "valueWarpage"], max: 255, nguon: "ve-sinh", ghiChu: "đi cột decimal(15,6), không phải varchar" },
  { ten: "measurements[].valueOffsetX", duongDan: ["measurements", "[]", "valueOffsetX"], max: 255, nguon: "ve-sinh", ghiChu: "đi cột decimal(15,6), không phải varchar" },
  { ten: "measurements[].valueOffsetY", duongDan: ["measurements", "[]", "valueOffsetY"], max: 255, nguon: "ve-sinh", ghiChu: "đi cột decimal(15,6), không phải varchar" },
  { ten: "measurements[].valueTilt", duongDan: ["measurements", "[]", "valueTilt"], max: 255, nguon: "ve-sinh", ghiChu: "đi cột decimal(15,6), không phải varchar" },
  { ten: "measurements[].valueThickness", duongDan: ["measurements", "[]", "valueThickness"], max: 255, nguon: "ve-sinh", ghiChu: "đi cột decimal(15,6), không phải varchar" },
];

/**
 * Pha 1E Task 3 (BG-69) — KIỂM KÊ ĐẦY ĐỦ `presignCoreObject`
 * (`aoiPackageRouter.ts`, cửa thứ sáu `presign`). Bốn lá chuỗi — TOÀN BỘ
 * schema (không có lá nào khác) — nên KHÔNG cần miễn trừ.
 *
 * (A) KHỚP CỘT THẬT — `inspectionId` → `inspection_packages.packageId`
 *   varchar(100) (đo avi_app, 2026-08-30) — ★ LỖ 22001 THẬT mà Task 3 đóng:
 *   `presign` INSERT trường này NGUYÊN VĂN làm `packageId`, TRƯỚC KHI
 *   `metaJsonSchema` (Pha 1D Task 5) kịp soi bất kỳ trường nào của `meta.json`.
 * (B) VỆ SINH — `apiKey`/`machineCode` (so khớp qua authenticateMachine, cùng
 *   con số hai trường cùng tên ở `submitInspectionCoreObject`); `sha256`
 *   (khai báo nhưng KHÔNG hề được đọc ở đâu trong `aoiPackageRouter.ts` — đã
 *   grep `input.sha256`, 0 kết quả ngoài khai báo — `.max(128)` dư sức
 *   SHA-256 hex thật 64 ký tự).
 */
export const KIEM_KE_PRESIGN: readonly MucCapChuoi[] = [
  { ten: "inspectionId", duongDan: ["inspectionId"], max: 100, nguon: "db",
    ghiChu: "inspection_packages.packageId varchar(100) — INSERT nguyên văn, lỗ 22001 THẬT trước Task 3" },
  { ten: "apiKey", duongDan: ["apiKey"], max: 256, nguon: "ve-sinh", ghiChu: "so khớp qua authenticateMachine, không INSERT" },
  { ten: "machineCode", duongDan: ["machineCode"], max: 50, nguon: "ve-sinh", ghiChu: "so khớp qua authenticateMachine, khớp sức chứa machines.code varchar(50)" },
  { ten: "sha256", duongDan: ["sha256"], max: 128, nguon: "ve-sinh", ghiChu: "khai báo nhưng không đọc ở đâu — dư sức SHA-256 hex thật (64 ký tự)" },
];

export interface KetQuaKiemKe {
  /** Mỗi phần tử: một trường ĐỎ — thiếu `.max()` hoặc lệch số. */
  loi: string[];
  soTruongDaXet: number;
}

/**
 * Chạy MỘT bảng kiểm kê bất kỳ (`MucCapChuoi[]`) trên MỘT schema gốc bất kỳ —
 * lõi dùng chung của `kiemKeCapChuoi` (MDC v2) và census `metaJsonSchema`
 * (`capChuoiMetaJsonCensus.test.ts`), tránh chép lại vòng lặp so khớp lần thứ
 * hai cho schema thứ hai.
 */
export function kiemKeTheoBang(goc: z.ZodTypeAny, bang: readonly MucCapChuoi[]): KetQuaKiemKe {
  const loi: string[] = [];
  for (const muc of bang) {
    let node: z.ZodTypeAny;
    try {
      node = layTheoDuong(goc, muc.duongDan);
    } catch (e) {
      loi.push(`${muc.ten}: ${(e as Error).message}`);
      continue;
    }
    const thuc = layMaxChuoi(node);
    if (thuc === null) {
      loi.push(`${muc.ten}: THIẾU .max() (kỳ vọng ${muc.max} — ${muc.ghiChu})`);
    } else if (thuc !== muc.max) {
      loi.push(`${muc.ten}: .max(${thuc}) LỆCH, kỳ vọng .max(${muc.max}) — ${muc.ghiChu}`);
    }
  }
  return { loi, soTruongDaXet: bang.length };
}

/**
 * Chạy toàn bộ `KIEM_KE_CAP_CHUOI` trên một schema gốc (mặc định
 * `machineDataContractV2` thật — nhưng nhận tham số để lưới đột biến (§ test)
 * chạy lại CHÍNH hàm này trên một schema đã bị mutate trong bộ nhớ, không phải
 * một bản giản lược riêng).
 */
export function kiemKeCapChuoi(goc: z.ZodTypeAny = machineDataContractV2): KetQuaKiemKe {
  return kiemKeTheoBang(goc, KIEM_KE_CAP_CHUOI);
}

// ════════════════════════════════════════════════════════════════════════════
// Pha 1D Task 5 (BG-52 ⛔) — CENSUS DUYỆT SCHEMA, không duyệt BẢNG
// ════════════════════════════════════════════════════════════════════════════
//
// `kiemKeCapChuoi` ở trên (Task 3) chỉ soi CÁC ĐƯỜNG có mặt trong
// `KIEM_KE_CAP_CHUOI` — một BẢNG viết tay. Review toàn nhánh Pha 1D bắt đúng
// điểm mù đó: (1) bảng chỉ liệt kê `machineDataContractV2`, `metaJsonSchema`
// (cửa ZIP) có 0 trường `.max()` mà không ai nhận ra vì không cửa nào soi nó;
// (2) NGAY CẢ khi soi đúng schema, một trường chuỗi MỚI được thêm vào schema
// mà KHÔNG được thêm vào bảng vẫn lọt qua — `capChuoiVarcharCensus.test.ts:84`
// ghim `KIEM_KE_CAP_CHUOI.length === 30` và §2/§4 chỉ lặp trên CHÍNH bảng đó,
// không có ca nào duyệt schema để PHÁT HIỆN trường mới.
//
// `duyetTimTruongChuoi` dưới đây đi ngược lại: xuất phát từ SCHEMA (không phải
// bảng), tự đệ quy qua `ZodObject`/`ZodArray`/`ZodUnion`/optional/nullable/
// default để liệt kê MỌI lá `ZodString`, không cần ai khai trước đường đi của
// nó. Một trường chuỗi mới không `.max()` sẽ tự xuất hiện trong kết quả với
// `max: null` — census trên nó (`kiemTraToanBoTruongChuoi`) đỏ ngay, nêu đúng
// tên, KHÔNG cần sửa bất kỳ bảng kiểm kê nào (đây là bằng chứng Việc 4 THẬT sự
// khác Task 3: đột biến "thêm trường mới" không đụng `KIEM_KE_CAP_CHUOI`/
// `DANH_SACH_SCHEMA` mà vẫn đỏ — xem `capChuoiVarcharSchemaWalk.test.ts`).
//
// `kiemKeCapChuoi`/`KIEM_KE_CAP_CHUOI` KHÔNG bị xoá — nó vẫn giữ vai trò riêng:
// đối chiếu SỐ CHÍNH XÁC cho nhóm trường đã đo trực tiếp từ DB (Nhóm A), thứ
// walker không tự biết ("thiếu .max()" ≠ "có .max() nhưng SAI SỐ" — hai lớp lỗi
// khác nhau, xem ca "LỆCH SỐ" ở Task 3). Hai lớp bổ sung cho nhau, không thay
// thế nhau: walker canh SỰ TỒN TẠI trên MỌI trường của MỌI schema; bảng canh
// GIÁ TRỊ CHÍNH XÁC trên tập trường đã biết.

/** Một lá `ZodString` (hoặc nhánh chuỗi của một `ZodUnion`) phát hiện được khi duyệt schema. */
export interface TruongChuoiPhatHien {
  /** Đường điều hướng dạng chuỗi, nối bằng "." — "[]" cho bước vào phần tử mảng. */
  duongDan: string;
  /** `null` = KHÔNG có `.max()`. */
  max: number | null;
}

const GIOI_HAN_DO_SAU_DUYET = 15; // chặn đệ quy vô hạn nếu lỡ có cấu trúc tự trỏ — không có trong 2 schema hôm nay, nhưng an toàn hơn để.

/**
 * Đệ quy MỌI lá `ZodString` của một schema `ZodType` bất kỳ — KHÔNG cần bảng
 * khai trước đường đi. Đây là khác biệt cốt lõi với `layTheoDuong` (Task 3):
 * hàm đó ĐI THEO một `duongDan` đã biết trước; hàm này TỰ TÌM mọi đường.
 *
 * Bọc ngoài được bóc bằng `boLopNgoai` (ĐÃ có ở trên, nay CŨNG bóc `ZodDefault`)
 * — tái dùng, không chế lại. `ZodObject` ⇒ đệ quy từng key trong `.shape`.
 * `ZodArray` ⇒ đệ quy `.element`, thêm bước `"[]"`. `ZodTuple` ⇒ đệ quy TỪNG
 * VỊ TRÍ trong `.def.items` (khác `ZodArray`: mỗi vị trí kiểu RIÊNG, không
 * đồng nhất — xem chú thích tại nhánh). `ZodUnion` ⇒ đệ quy MỌI NHÁNH (Pha 1F
 * Task 3, BG-79 — xem khối chú thích lớn ngay tại nhánh `ZodUnion` bên dưới,
 * đây KHÔNG còn là "tìm nhánh ZodString đầu tiên" như trước bản vá đó).
 *
 * ★★★ Pha 1E Task 3 (BG-69), mệnh đề 4 — TRƯỚC bản vá này, MỌI kiểu không
 * khớp bốn nhánh trên (`ZodObject`/`ZodArray`/`ZodUnion`/`ZodString`) rơi vào
 * `return []` cuối hàm — im lặng, không phân biệt được "chắc chắn không phải
 * trường chuỗi" (`ZodNumber`, `ZodEnum`, …) với "walker KHÔNG BIẾT bên trong
 * có gì" (`ZodPipe`/`.transform()`, `ZodRecord`, `ZodDiscriminatedUnion`,
 * `ZodIntersection`, …). Cùng cơ chế "im lặng ở chỗ không biết đọc giống hệt
 * xanh vì không có vấn đề" đã cắn dự án BA lần (census cửa ingest bỏ lọt cửa
 * thứ sáu; census `.max()` cưỡng chế BẢNG thay vì SCHEMA — xem docblock đầu
 * file). Từ bản vá này: kiểu THẬT SỰ không thể chứa trường chuỗi (không có
 * con — `KIEU_LA_AN_TOAN` bên dưới) mới được `return []`; MỌI kiểu khác
 * KHÔNG khớp bất kỳ nhánh nào ở trên ném lỗi — buộc người thêm nhánh xử lý
 * TRƯỚC khi tin kết quả, thay vì âm thầm được tính là "sạch".
 *
 * ⚠⚠⚠ Pha 1F Task 3 (BG-79) — MỆNH ĐỀ 4 (bản BG-69) VẪN CÒN MỘT LỖ Ở ĐÚNG
 * NHÁNH `ZodUnion`: bản vá BG-69 KHÔNG throw cho union — nó `return []` IM
 * LẶNG khi không có nhánh `ZodString` TRỰC TIẾP ở CẤP NÀY, kể cả khi một
 * nhánh khác là `ZodObject`/`ZodArray` CHỨA lá chuỗi bên trong (ví dụ
 * `z.union([z.number(), z.object({beTrong: z.string()})])` — lá `beTrong`
 * biến mất hoàn toàn, không throw, không xuất hiện trong kết quả). Đây ĐÚNG
 * LÀ lớp lỗi "hôm nay chưa có" mà docblock đầu file (dòng "không có schema
 * nào hôm nay có union chứa object … NGOÀI ZodDiscriminatedUnion") đã dùng để
 * biện minh — lập luận đã hỏng bốn lần trong dự án này (spec
 * 2026-08-31-aoi-backlog-toan-canh.md §L-1). `ZodDiscriminatedUnion` đứng
 * TRƯỚC nhánh này (throw) không hề "chặn" ca này: một `z.union([...])`
 * THƯỜNG (không discriminated) chứa object vẫn rơi thẳng vào nhánh dưới đây.
 */
/** Nối `duongDanHienTai` thành chuỗi hiển thị cùng QUY ƯỚC với `KIEM_KE_CAP_CHUOI`
 *  (`"surfaces[].positions[].positionId"`, KHÔNG phải `"surfaces.[].positions.[]…"`).
 *  Bước bắt đầu bằng `"["` (mảng `"[]"` HOẶC vị trí tuple `"[0]"`/`"[1]"`, Pha 1E
 *  Task 3) nối liền KHÔNG dấu chấm — mọi bước khác nối bằng dấu chấm. */
function noiDuongDan(cac: readonly string[]): string {
  let s = "";
  for (const b of cac) {
    s += b.startsWith("[") ? b : (s.length > 0 ? "." : "") + b;
  }
  return s;
}

/**
 * Các kiểu LÁ, KHÔNG CÓ CON — về mặt CẤU TRÚC không thể "giấu" một trường
 * chuỗi bên trong (khác `ZodAny`/`ZodUnknown`: hai kiểu đó KHÔNG có hình dạng
 * cố định, walker không thể CHỨNG MINH bên trong không có chuỗi, nên CỐ Ý
 * không nằm trong danh sách này — gặp một trong hai kiểu đó sẽ rơi xuống báo
 * động ở cuối `duyetTimTruongChuoi`, không được coi là "an toàn").
 */
const KIEU_LA_AN_TOAN = [
  z.ZodNumber, z.ZodBoolean, z.ZodBigInt, z.ZodDate, z.ZodEnum, z.ZodLiteral,
  z.ZodNull, z.ZodUndefined, z.ZodVoid, z.ZodNaN, z.ZodNever, z.ZodSymbol,
] as const;

export function duyetTimTruongChuoi(
  goc: z.ZodTypeAny,
  duongDanHienTai: string[] = [],
  doSau = 0,
): TruongChuoiPhatHien[] {
  if (doSau > GIOI_HAN_DO_SAU_DUYET) {
    throw new Error(
      `duyetTimTruongChuoi: vượt độ sâu ${GIOI_HAN_DO_SAU_DUYET} tại "${noiDuongDan(duongDanHienTai)}" ` +
        `— khả năng cấu trúc tự trỏ, dừng lại để không treo thay vì đệ quy vô hạn.`,
    );
  }
  const n = boLopNgoai(goc);
  if (n instanceof z.ZodObject) {
    const shape = n.shape as Record<string, z.ZodTypeAny>;
    const ra: TruongChuoiPhatHien[] = [];
    for (const key of Object.keys(shape)) {
      ra.push(...duyetTimTruongChuoi(shape[key], [...duongDanHienTai, key], doSau + 1));
    }
    return ra;
  }
  if (n instanceof z.ZodArray) {
    // Ép `any` trước khi đọc `.element`: zod v4 `ZodArray.element` trả kiểu nội
    // bộ `$ZodType` (khác `ZodTypeAny` công khai) sau khi TS đã NARROW `n` qua
    // `instanceof` — cùng lý do `layTheoDuong`/`layMaxChuoi` ở trên giữ tham số
    // `node: any`, không phải lỗi mới.
    return duyetTimTruongChuoi((n as any).element, [...duongDanHienTai, "[]"], doSau + 1);
  }
  if (n instanceof z.ZodTuple) {
    // Pha 1E Task 3 (BG-69) — CHƯA HỖ TRỢ trước bản vá này (rơi vào `return []`
    // cuối hàm, IM LẶNG) dù MỘT tuple THẬT đã tồn tại
    // (`submitProcessResultCoreObject.waveforms[].samples`:
    // `z.array(z.tuple([z.number(), z.number()]))`). Khác `ZodArray` (mọi phần
    // tử CÙNG kiểu): mỗi VỊ TRÍ trong tuple có kiểu RIÊNG, nên đệ quy theo TỪNG
    // vị trí (`[0]`, `[1]`, …), không dùng chung nhãn `"[]"`. `ZodTuple` không
    // có getter công khai kiểu `.element` (ZodArray)/`.options` (ZodUnion) —
    // `.def.items` là trường CÔNG KHAI, ỔN ĐỊNH của zod v4 (interface giới
    // thiệu chính thức từ v4, KHÔNG phải `._zod` nội bộ bị cấm ở đầu file).
    const def = (n as any).def;
    if (def.rest != null) {
      throw new Error(
        `duyetTimTruongChuoi: ZodTuple có phần "rest" (variadic, .rest()) tại "${noiDuongDan(duongDanHienTai)}" ` +
          `— CHƯA HỖ TRỢ (không phải "không có trường chuỗi"). Bổ sung nhánh xử lý trước khi tin census này.`,
      );
    }
    const items = def.items as z.ZodTypeAny[];
    const ra: TruongChuoiPhatHien[] = [];
    items.forEach((item, idx) => {
      ra.push(...duyetTimTruongChuoi(item, [...duongDanHienTai, `[${idx}]`], doSau + 1));
    });
    return ra;
  }
  if (n instanceof z.ZodDiscriminatedUnion) {
    // Pha 1E Task 3 (BG-69) — PHẢI kiểm TRƯỚC `z.ZodUnion` ngay dưới: một
    // `ZodDiscriminatedUnion` CŨNG là `instanceof z.ZodUnion` (lớp con trong
    // zod v4) — nếu để rơi xuống nhánh union thường, nó sẽ tìm nhánh
    // `ZodString` NGAY CẤP NÀY (không có gì — mỗi lựa chọn của discriminated
    // union là một `ZodObject`), kết luận "không phải trường chuỗi" và IM
    // LẶNG bỏ qua TOÀN BỘ field bên trong từng object lựa chọn — đúng lớp lỗi
    // mệnh đề 4 mô tả, và là một bug THẬT của nhánh `ZodUnion` cũ (không phải
    // giả định lý thuyết — đã xác nhận bằng `instanceof` runtime khi viết bản
    // vá này). Không có schema THẬT nào trong 6 cửa ingest hôm nay dùng
    // discriminated union, nên báo động ở đây không hồi quy gì.
    throw new Error(
      `duyetTimTruongChuoi: ZodDiscriminatedUnion tại "${noiDuongDan(duongDanHienTai)}" — CHƯA HỖ TRỢ ` +
        `(mỗi lựa chọn là một object, cần đệ quy riêng từng lựa chọn, không phải "không có trường chuỗi"). ` +
        `Bổ sung nhánh xử lý trước khi tin census này.`,
    );
  }
  if (n instanceof z.ZodUnion) {
    // Pha 1F Task 3 (BG-79) — ĐỆ QUY MỌI NHÁNH, không chỉ tìm nhánh `ZodString`
    // ĐẦU TIÊN ở cấp này (hành vi CŨ, đã mù với union chứa object — xem khối
    // chú thích lớn ngay phía trên hàm). Mỗi nhánh (`option`) được đệ quy qua
    // ĐÚNG `duyetTimTruongChuoi` — CÙNG `duongDanHienTai` (nhánh union không tự
    // thêm một bước điều hướng riêng: nó là hình dạng THAY THẾ của CÙNG một
    // trường, không phải một trường con MỚI). Kết quả:
    //   - nhánh `ZodString` trực tiếp ⇒ một lá tại `duongDanHienTai` (giống hệt
    //     hành vi cũ khi CHỈ có một nhánh chuỗi).
    //   - nhánh `ZodObject`/`ZodArray`/`ZodTuple` ⇒ đệ quy tiếp, tự nối thêm
    //     bước theo ĐÚNG logic các nhánh đó (vd "beTrong" ⇒
    //     "<duongDanHienTai>.beTrong") — đây là ca `union[number,
    //     object{beTrong:string}]` mà bản BG-69 từng bỏ lọt.
    //   - nhánh nằm trong `KIEU_LA_AN_TOAN` (number/boolean/…) ⇒ `[]`, không
    //     đóng góp gì (an toàn, không thể giấu chuỗi).
    //   - nhánh KHÔNG khớp gì (`.transform()`, `ZodRecord`, …) ⇒ THROW từ chính
    //     lời gọi đệ quy — union KHÔNG che giấu nhánh nguy hiểm.
    const ra: TruongChuoiPhatHien[] = [];
    for (const option of n.options as z.ZodTypeAny[]) {
      ra.push(...duyetTimTruongChuoi(option, duongDanHienTai, doSau + 1));
    }
    return ra;
  }
  if (n instanceof z.ZodString) {
    return [{ duongDan: noiDuongDan(duongDanHienTai), max: n.maxLength }];
  }
  if (KIEU_LA_AN_TOAN.some((K) => n instanceof K)) {
    return []; // number/boolean/bigint/date/enum/literal/null/undefined/void/NaN/never/symbol — LÁ, không thể giấu trường chuỗi
  }
  // ★★★ Pha 1E Task 3 (BG-69), mệnh đề 4 — BÁO ĐỘNG, KHÔNG im lặng `return []`.
  // Đến đây là mọi kiểu KHÔNG khớp nhánh nào ở trên VÀ KHÔNG nằm trong
  // `KIEU_LA_AN_TOAN` — gồm (nhưng không giới hạn) `ZodPipe`/`.transform()`,
  // `ZodRecord`, `ZodIntersection`, `ZodAny`, `ZodUnknown`, `ZodLazy`, …
  // `ZodPipe` đặc biệt NGUY HIỂM nếu chỉ kiểm `.max()` của nhánh INPUT (`.def.in`):
  // giá trị SAU `.transform()` có thể dài BAO NHIÊU cũng được bất kể input bị
  // giới hạn — kiểm tra input sẽ cho một CẢM GIÁC AN TOÀN SAI, tệ hơn cả im
  // lặng bỏ qua. Ném lỗi ở đây thay vì đoán.
  throw new Error(
    `duyetTimTruongChuoi: gặp kiểu zod CHƯA HỖ TRỢ (${n?.constructor?.name ?? typeof n}) tại ` +
      `"${noiDuongDan(duongDanHienTai)}" — walker KHÔNG THỂ chứng minh nhánh này không chứa trường ` +
      `chuỗi thiếu .max() (vd ZodPipe/.transform() có thể đổi ĐỘ DÀI đầu ra tuỳ ý so với input, ` +
      `ZodRecord/ZodIntersection có thể ẩn field bên trong). BÁO ĐỘNG thay vì im lặng trả [] — bổ ` +
      `sung nhánh xử lý cho kiểu này trước khi tin bất kỳ kết quả census nào.`,
  );
}

/**
 * Census DUYỆT SCHEMA cho MỘT schema gốc: mọi lá `ZodString` phát hiện được
 * (qua `duyetTimTruongChuoi`) mà KHÔNG nằm trong `mienTru` phải có `.max()`
 * (`max !== null`). `mienTru` là danh sách NHỎ, TƯỜNG MINH các trường cố ý
 * không có trần (cột đích `text`, không có sức chứa thật để khớp — vd
 * `errorDesc`/`measurements[].remark`) — mỗi mục trong đó phải có lý do ghi ở
 * nơi khai báo schema, KHÔNG phải một cách lặng lẽ tắt cổng.
 */
export function kiemTraToanBoTruongChuoi(
  goc: z.ZodTypeAny,
  tenSchema: string,
  mienTru: ReadonlySet<string> = new Set(),
): KetQuaKiemKe {
  const phatHien = duyetTimTruongChuoi(goc);
  const loi: string[] = [];
  for (const { duongDan, max } of phatHien) {
    if (mienTru.has(duongDan)) continue;
    if (max === null) {
      loi.push(`[${tenSchema}] ${duongDan}: THIẾU .max()`);
    }
  }
  return { loi, soTruongDaXet: phatHien.length };
}

// ════════════════════════════════════════════════════════════════════════════
// Pha 1F Task 6 (review lượt 7, C-2 ⛔) — CENSUS TRẦN THỜI GIAN: tiêu chí MỚI.
// ════════════════════════════════════════════════════════════════════════════
//
// ── VÌ SAO LƯỚI NÀY TỒN TẠI (đọc trước khi sửa) ───────────────────────────────
// Cùng một hồi quy ("trần .max() nhỏ hơn định dạng DateTime.ToString() dài
// nhất mà new Date() vẫn parse được") đã bị vá NỬA ĐƯỜNG BA LẦN liên tiếp:
//   1. BG-72 (Pha 1F Task 2) — chỉ vá đường v1.x (submitInspectionCoreObject).
//   2. BG-91 (lượt soát thứ hai) — quét lại cửa ZIP, nhưng CHỈ theo tiêu chí
//      "trường này có alias bên v1.x không?" — vá được `inspectionTime` (CÓ
//      alias `submitInspectionCoreObject.inspectionTime`), BỎ SÓT `startedAt`/
//      `finishedAt` (KHÔNG có alias — v1.x không hề khai hai trường này).
//   3. Review lượt 7 (C-2 ⛔, Task 6 NÀY) — đo LIVE: `startedAt` mới là trường
//      GỐC THẬT (`aoiPackageRouter.ts:1009` đọc `inspectionTime ?? startedAt`,
//      mẫu máy thật KHÔNG khai `inspectionTime`) — bị `.max(40)` từ chối, đếm
//      VĨNH VIỄN, khoá gói `'dead'`.
// Gốc rễ: tiêu chí "có alias không" là một câu hỏi VỀ CẤU TRÚC hợp đồng, không
// phải về RỦI RO THẬT. Một trường có thể mang giá trị thời gian dài mà KHÔNG
// hề có alias ở bất kỳ đường nào khác — `startedAt` chính là ví dụ đó.
//
// ⇒ Lưới này đổi câu hỏi: KHÔNG hỏi "trường này có alias không", mà hỏi
// TRỰC TIẾP trên MỌI trường chuỗi của MỌI hợp đồng ingest: "tên trường này có
// DẠNG một trường thời gian không (laTenTruongThoiGian), và nếu có, trần của
// nó có ≥ TRAN_TOI_THIEU_THOI_GIAN không?" — không cần biết trước danh sách
// trường, không cần alias, không cần bằng chứng "too_big đã đo hôm nay".
//
// ── TỰ TẤN CÔNG TIÊU CHÍ CỦA CHÍNH LƯỚI NÀY (bắt buộc theo brief Task 6) ──────
// `laTenTruongThoiGian` là một HEURISTIC THEO TÊN (kết thúc bằng "At"/"Time",
// hoặc đúng bằng "ts") — KHÔNG PHẢI một phép chứng minh cấu trúc như
// `duyetTimTruongChuoi` (nơi "ZodString" là một SỰ THẬT về kiểu, không phải
// suy đoán). Nó CHẮC CHẮN bỏ sót một trường mang giá trị thời gian nhưng đặt
// tên KHÔNG theo quy ước này (vd một trường tên "khi", "moment", "stamp",
// "dateStr" nếu tương lai có ai đặt tên khác quy ước hiện hành). Đây là giới
// hạn THẬT, không che giấu — ghi rõ trong report Task 6, KHÔNG tự nhận "đã
// quét hết mọi trường thời gian có thể có", chỉ nhận "đã quét hết mọi trường
// khớp quy ước đặt tên ĐANG DÙNG trong sáu hợp đồng ingest hôm nay (startedAt/
// completedAt/finishedAt/inspectionTime/serverReceivedAt/inferredAt/ts)" — và
// MỖI trường mới khớp quy ước đó, dù thêm vào schema nào trong sáu, tự động bị
// bắt (không cần sửa bảng nào — xem đột biến (b) ở `capChuoiThoiGianCensus.test.ts`).
export const TRAN_TOI_THIEU_THOI_GIAN = 64;

const HAU_TO_TEN_TRUONG_THOI_GIAN = /(?:At|Time)$/;

/**
 * Tên trường (LÁ CUỐI của đường dẫn, không phải cả đường) có DẠNG một trường
 * mang giá trị thời gian không — quy ước ĐANG DÙNG trong sáu hợp đồng ingest:
 * kết thúc bằng "At" (`startedAt`/`completedAt`/`finishedAt`/`serverReceivedAt`/
 * `inferredAt`) hoặc "Time" (`inspectionTime`), hoặc đúng bằng "ts"
 * (`submitProcessResultCoreObject.ts`). Phân biệt hoa/thường có chủ đích:
 * "At"/"Time" viết hoa chữ cái đầu đúng quy ước camelCase của dự án — một
 * trường như "format"/"rate" (kết thúc bằng "at"/"te" THƯỜNG) KHÔNG khớp.
 */
export function laTenTruongThoiGian(tenTruong: string): boolean {
  return tenTruong === "ts" || HAU_TO_TEN_TRUONG_THOI_GIAN.test(tenTruong);
}

/** Lá cuối của một đường dạng "surfaces[].positions[].startedAt" → "startedAt". */
function tenLaCuoi(duongDan: string): string {
  const buoc = duongDan.split(".");
  return buoc[buoc.length - 1];
}

/**
 * Census TRẦN THỜI GIAN cho MỘT schema gốc: duyệt TOÀN BỘ lá chuỗi
 * (`duyetTimTruongChuoi` — cùng bộ duyệt CẤU TRÚC dùng cho
 * `kiemTraToanBoTruongChuoi`, không phải một bộ duyệt riêng), lọc theo
 * `laTenTruongThoiGian`, rồi đòi MỖI trường khớp có `.max()` VÀ
 * `.max() >= TRAN_TOI_THIEU_THOI_GIAN`. Trường không khớp tên (không phải
 * trường thời gian) KHÔNG bị đòi hỏi gì — lưới này không thay thế
 * `kiemTraToanBoTruongChuoi` (đòi MỌI trường chuỗi CÓ `.max()`, bất kể giá
 * trị), nó SIẾT THÊM một lớp cho ĐÚNG nhóm trường thời gian.
 */
export function kiemTraTranThoiGian(
  goc: z.ZodTypeAny,
  tenSchema: string,
): { loi: string[]; soTruongThoiGian: number } {
  const phatHien = duyetTimTruongChuoi(goc);
  const loi: string[] = [];
  let soTruongThoiGian = 0;
  for (const { duongDan, max } of phatHien) {
    if (!laTenTruongThoiGian(tenLaCuoi(duongDan))) continue;
    soTruongThoiGian++;
    if (max === null) {
      loi.push(
        `[${tenSchema}] ${duongDan}: trường THỜI GIAN không có .max() (kỳ vọng ≥${TRAN_TOI_THIEU_THOI_GIAN})`,
      );
    } else if (max < TRAN_TOI_THIEU_THOI_GIAN) {
      loi.push(
        `[${tenSchema}] ${duongDan}: .max(${max}) < ${TRAN_TOI_THIEU_THOI_GIAN} — nhỏ hơn định dạng ` +
          `DateTime.ToString() dài nhất đã đo (50 ký tự, dư margin tới ${TRAN_TOI_THIEU_THOI_GIAN})`,
      );
    }
  }
  return { loi, soTruongThoiGian };
}
