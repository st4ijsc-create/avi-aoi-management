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
 * Bóc lớp `ZodOptional`/`ZodNullable` cho tới khi chạm kiểu lõi.
 * `any` cố ý: hàm soi CẤU TRÚC động (duck-typing bằng `instanceof` runtime),
 * không phải mã sản xuất — `.unwrap()` của zod v4 trả kiểu `$ZodType` nội bộ
 * hẹp hơn `ZodTypeAny` công khai, ép kiểu tĩnh ở đây không phản ánh gì thêm.
 */
function boLopNgoai(node: z.ZodTypeAny): any {
  let n: any = node;
  while (n instanceof z.ZodOptional || n instanceof z.ZodNullable) {
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
  { ten: "startedAt", duongDan: ["startedAt"], max: 40, nguon: "ve-sinh", ghiChu: "đi timestamp (product_inspections.inspectionTime), không phải varchar" },
  { ten: "completedAt", duongDan: ["completedAt"], max: 40, nguon: "ve-sinh", ghiChu: "đi timestamp, không phải varchar" },
  { ten: "surfaces[].positions[].startedAt", duongDan: ["surfaces", "[]", "positions", "[]", "startedAt"], max: 40, nguon: "ve-sinh", ghiChu: "đi timestamp (inspection_positions.startedAt), không phải varchar" },
  { ten: "surfaces[].positions[].completedAt", duongDan: ["surfaces", "[]", "positions", "[]", "completedAt"], max: 40, nguon: "ve-sinh", ghiChu: "đi timestamp, không phải varchar" },
  { ten: "surfaces[].positions[].captures[].startedAt", duongDan: ["surfaces", "[]", "positions", "[]", "captures", "[]", "startedAt"], max: 40, nguon: "ve-sinh", ghiChu: "đi timestamp (inspection_captures.startedAt), không phải varchar" },
  { ten: "surfaces[].positions[].captures[].completedAt", duongDan: ["surfaces", "[]", "positions", "[]", "captures", "[]", "completedAt"], max: 40, nguon: "ve-sinh", ghiChu: "đi timestamp, không phải varchar" },
  { ten: "surfaces[].positions[].captures[].components[].componentName", duongDan: ["surfaces", "[]", "positions", "[]", "captures", "[]", "components", "[]", "componentName"], max: 255, nguon: "ve-sinh", ghiChu: "chưa có cột đích (Khối B) — quy ước 'tên' 255" },
  { ten: "surfaces[].positions[].captures[].components[].value", duongDan: ["surfaces", "[]", "positions", "[]", "captures", "[]", "components", "[]", "value"], max: 255, nguon: "ve-sinh", ghiChu: "nhánh chuỗi — đối xứng measuredValueText varchar(255), chưa xác nhận cột" },
  { ten: "surfaces[].positions[].captures[].components[].lowerLimit", duongDan: ["surfaces", "[]", "positions", "[]", "captures", "[]", "components", "[]", "lowerLimit"], max: 255, nguon: "ve-sinh", ghiChu: "không có cột kết quả nào — đối xứng value" },
  { ten: "surfaces[].positions[].captures[].components[].upperLimit", duongDan: ["surfaces", "[]", "positions", "[]", "captures", "[]", "components", "[]", "upperLimit"], max: 255, nguon: "ve-sinh", ghiChu: "không có cột kết quả nào — đối xứng value" },
  { ten: "surfaces[].positions[].captures[].components[].startedAt", duongDan: ["surfaces", "[]", "positions", "[]", "captures", "[]", "components", "[]", "startedAt"], max: 40, nguon: "ve-sinh", ghiChu: "đi timestamp, không phải varchar" },
  { ten: "surfaces[].positions[].captures[].components[].completedAt", duongDan: ["surfaces", "[]", "positions", "[]", "captures", "[]", "components", "[]", "completedAt"], max: 40, nguon: "ve-sinh", ghiChu: "đi timestamp, không phải varchar" },
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
  { ten: "startedAt", duongDan: ["startedAt"], max: 40, nguon: "ve-sinh", ghiChu: "đi timestamp qua new Date(), không phải varchar" },
  { ten: "finishedAt", duongDan: ["finishedAt"], max: 40, nguon: "ve-sinh", ghiChu: "không đọc ở đâu trong commit hôm nay — chuẩn bị trước, cùng quy ước ngày-giờ" },
  { ten: "inspectionTime", duongDan: ["inspectionTime"], max: 40, nguon: "ve-sinh", ghiChu: "đi timestamp qua new Date(), không phải varchar" },
  { ten: "companyCode", duongDan: ["companyCode"], max: 50, nguon: "ve-sinh", ghiChu: "chỉ đối chiếu qua macTenantChoGhi (không ghi verbatim) — khớp corporates.code varchar(50)" },
  { ten: "factoryCode", duongDan: ["factoryCode"], max: 50, nguon: "ve-sinh", ghiChu: "chỉ đối chiếu — khớp factories.code varchar(50)" },
  { ten: "factory", duongDan: ["factory"], max: 50, nguon: "ve-sinh", ghiChu: "alias của factoryCode — cùng lý do" },
  { ten: "workshopCode", duongDan: ["workshopCode"], max: 50, nguon: "ve-sinh", ghiChu: "chỉ đối chiếu — khớp workshops.code varchar(50)" },
  { ten: "lineCode", duongDan: ["lineCode"], max: 50, nguon: "ve-sinh", ghiChu: "chỉ đối chiếu — khớp production_lines.code varchar(50)" },
  { ten: "line", duongDan: ["line"], max: 50, nguon: "ve-sinh", ghiChu: "alias của lineCode — cùng lý do" },
  { ten: "measurements[].unit", duongDan: ["measurements", "[]", "unit"], max: 50, nguon: "ve-sinh", ghiChu: "chỉ nội suy vào remark (text) — không có cột đích riêng" },
  { ten: "points[].unit", duongDan: ["points", "[]", "unit"], max: 50, nguon: "ve-sinh", ghiChu: "cùng lý do measurements[].unit" },
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
 * Bọc ngoài được bóc bằng `boLopNgoai` (ĐÃ có ở trên) — tái dùng, không chế lại.
 * `ZodObject` ⇒ đệ quy từng key trong `.shape`. `ZodArray` ⇒ đệ quy `.element`,
 * thêm bước `"[]"`. `ZodUnion` ⇒ tìm nhánh `ZodString` (cùng logic `layMaxChuoi`
 * dùng cho lá đơn — nếu không có nhánh chuỗi nào, đây KHÔNG PHẢI trường chuỗi,
 * bỏ qua, không đệ quy sâu hơn vào từng nhánh union khác vì hai schema hôm nay
 * không có union chứa object/mảng lồng). Mọi kiểu khác (`ZodNumber`/
 * `ZodBoolean`/`ZodEnum`/`ZodLiteral`/…) không phải trường chuỗi — bỏ qua.
 */
/** Nối `duongDanHienTai` thành chuỗi hiển thị cùng QUY ƯỚC với `KIEM_KE_CAP_CHUOI`
 *  (`"surfaces[].positions[].positionId"`, KHÔNG phải `"surfaces.[].positions.[]…"`). */
function noiDuongDan(cac: readonly string[]): string {
  let s = "";
  for (const b of cac) {
    s += b === "[]" ? "[]" : (s.length > 0 ? "." : "") + b;
  }
  return s;
}

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
  if (n instanceof z.ZodUnion) {
    const nhanhChuoi = (n.options as z.ZodTypeAny[]).map(boLopNgoai).find((o) => o instanceof z.ZodString);
    if (!nhanhChuoi) return []; // union không có nhánh chuỗi nào (vd number|boolean) — không phải trường chuỗi
    return [{ duongDan: noiDuongDan(duongDanHienTai), max: (nhanhChuoi as z.ZodString).maxLength }];
  }
  if (n instanceof z.ZodString) {
    return [{ duongDan: noiDuongDan(duongDanHienTai), max: n.maxLength }];
  }
  return []; // number/boolean/enum/literal/date/… — không phải trường chuỗi, không xét
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
