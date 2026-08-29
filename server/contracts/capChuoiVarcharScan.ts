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

/** Đi theo `duongDan` từ schema gốc tới `ZodType` của trường lá. */
function layTheoDuong(goc: z.ZodTypeAny, duongDan: BuocDuongDan[]): z.ZodTypeAny {
  let node: any = goc;
  for (const buoc of duongDan) {
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

export interface KetQuaKiemKe {
  /** Mỗi phần tử: một trường ĐỎ — thiếu `.max()` hoặc lệch số. */
  loi: string[];
  soTruongDaXet: number;
}

/**
 * Chạy toàn bộ `KIEM_KE_CAP_CHUOI` trên một schema gốc (mặc định
 * `machineDataContractV2` thật — nhưng nhận tham số để lưới đột biến (§ test)
 * chạy lại CHÍNH hàm này trên một schema đã bị mutate trong bộ nhớ, không phải
 * một bản giản lược riêng).
 */
export function kiemKeCapChuoi(goc: z.ZodTypeAny = machineDataContractV2): KetQuaKiemKe {
  const loi: string[] = [];
  for (const muc of KIEM_KE_CAP_CHUOI) {
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
  return { loi, soTruongDaXet: KIEM_KE_CAP_CHUOI.length };
}
