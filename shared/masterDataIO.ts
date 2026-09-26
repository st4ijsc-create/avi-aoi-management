/**
 * Doc 42 Đợt 4A (INFRA-4A) — hạt nhân THUẦN dùng chung cho import master-data.
 *
 * Chứa DUY NHẤT: kiểu cột (ColumnSpec), ánh xạ header→field và validate/ép kiểu
 * một mảng bản ghi (đã parse sẵn từ CSV/XLSX). KHÔNG phụ thuộc exceljs/xlsx/DOM/
 * node → import được từ CẢ server (`@shared/masterDataIO`) lẫn client
 * (ImportExportBar). Nhờ vậy client (preview) và server (endpoint) dùng CÙNG một
 * luật validate, không lệch nhau.
 *
 * Luồng:
 *   file  ──(exceljs/xlsx: header-keyed records)──▶  mapAndValidate(records, spec)
 *                                                     └▶ { rows, errors }
 */

/** Kiểu dữ liệu một cột. Mặc định "string". */
export type MasterDataColumnType = "string" | "number" | "date" | "boolean";

/** Định dạng file import/export hỗ trợ. */
export type MasterDataFormat = "csv" | "xlsx";

/** Đặc tả một cột master-data (dùng cho export header + validate import). */
export interface MasterDataColumn {
  /** Khoá field trong object trả về (vd "code"). */
  field: string;
  /**
   * ⚠ HAI VAI TRONG MỘT TRƯỜNG — và đây là chỗ dễ phá nhất của cả module.
   *
   * `header` vừa là (a) nhãn cột hiển thị, vừa là (b) **KHOÁ KHỚP** tên cột trong
   * file Excel/CSV người dùng tải lên (`mapAndValidate` dò bằng
   * `normalizeKey(col.header)`), vừa là (c) hàng tiêu đề của file template xuất ra.
   *
   * ⇒ **KHÔNG được dịch trường này.** Dịch nó là: template xuất ra mang tên cột lạ,
   *   và MỌI file người dùng đang có hết nhập được. Đợt F13 đã suýt làm đúng thế.
   *
   * Muốn nhãn đổi theo ngôn ngữ thì dùng `headerKey` bên dưới — vai (a) tách khỏi
   * (b)+(c), hợp đồng dữ liệu giữ nguyên.
   */
  header: string;
  /**
   * Khoá i18n cho NHÃN HIỂN THỊ của cột. Chỉ ảnh hưởng chỗ hiện ra cho người đọc
   * (bảng xem trước khi nhập); phép KHỚP cột và hàng tiêu đề template vẫn dùng
   * `header`. Thiếu `headerKey` ⇒ lùi về `header`, đúng hành vi cũ.
   */
  headerKey?: string;
  /** Bắt buộc có giá trị. Thiếu → error. */
  required?: boolean;
  /** Kiểu ép/validate. Mặc định "string". */
  type?: MasterDataColumnType;
  /** Giá trị ví dụ cho dòng mẫu trong file template. */
  example?: string | number | boolean;
}

/** Lỗi tại một ô khi import (row = số thứ tự dòng DỮ LIỆU, bắt đầu từ 1). */
export interface ImportRowError {
  row: number;
  field: string;
  message: string;
}

/** Lỗi một ô (chưa gắn số dòng) — dùng trong chi tiết từng dòng. */
export interface ImportCellError {
  field: string;
  message: string;
}

/** Chi tiết một dòng import (cho preview client): giá trị đã map + lỗi của dòng. */
export interface MasterDataRowDetail {
  /** Số dòng dữ liệu (1-based, tính cả dòng rỗng bị bỏ → khớp file gốc). */
  row: number;
  /** Giá trị đã ánh xạ field + ép kiểu (chỉ field không rỗng, hợp lệ). */
  values: Record<string, unknown>;
  /** Lỗi của dòng này. Rỗng = dòng hợp lệ. */
  errors: ImportCellError[];
}

/** Kết quả parse+validate: rows đã ánh xạ field + ép kiểu, và danh sách lỗi. */
export interface MasterDataParseResult<T = Record<string, unknown>> {
  rows: T[];
  errors: ImportRowError[];
}

const TRUE_TOKENS = new Set(["true", "1", "yes", "y", "x", "✓", "có", "co", "on"]);
const FALSE_TOKENS = new Set(["false", "0", "no", "n", "không", "khong", "off"]);

function normalizeKey(s: string): string {
  return s.trim().toLowerCase();
}

function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === "string" && v.trim() === "");
}

interface CoerceResult {
  value: unknown;
  empty: boolean;
  error?: string;
}

/** Ép một ô thô về kiểu cột; trả {value, empty, error?}. Thuần, dễ test. */
export function coerceCell(raw: unknown, type: MasterDataColumnType = "string"): CoerceResult {
  if (isEmpty(raw)) return { value: undefined, empty: true };

  switch (type) {
    case "number": {
      if (typeof raw === "number") {
        return Number.isFinite(raw) ? { value: raw, empty: false } : { value: raw, empty: false, error: "phải là số" };
      }
      // Bỏ dấu phân cách nghìn thông dụng (space, dấu phẩy) trước khi parse.
      const cleaned = String(raw).trim().replace(/[\s,](?=\d{3}\b)/g, "");
      const n = Number(cleaned);
      return Number.isFinite(n) ? { value: n, empty: false } : { value: raw, empty: false, error: "phải là số" };
    }
    case "boolean": {
      if (typeof raw === "boolean") return { value: raw, empty: false };
      const token = String(raw).trim().toLowerCase();
      if (TRUE_TOKENS.has(token)) return { value: true, empty: false };
      if (FALSE_TOKENS.has(token)) return { value: false, empty: false };
      return { value: raw, empty: false, error: "phải là true/false" };
    }
    case "date": {
      if (raw instanceof Date) {
        return Number.isNaN(raw.getTime())
          ? { value: raw, empty: false, error: "ngày không hợp lệ" }
          : { value: raw.toISOString(), empty: false };
      }
      const d = new Date(String(raw).trim());
      return Number.isNaN(d.getTime())
        ? { value: raw, empty: false, error: "ngày không hợp lệ" }
        : { value: d.toISOString(), empty: false };
    }
    case "string":
    default:
      return { value: String(raw).trim(), empty: false };
  }
}

/**
 * Chi tiết TỪNG dòng (cho preview client): ánh xạ header→field + ép kiểu +
 * validate. Header khớp không phân biệt hoa/thường & khoảng trắng thừa; nếu
 * không thấy header thì thử khớp theo tên field. Bỏ qua dòng rỗng hoàn toàn.
 * `row` giữ theo chỉ số bản ghi gốc (tính cả dòng rỗng) để khớp số dòng file.
 */
export function validateRecordsDetailed(
  records: Array<Record<string, unknown>>,
  columns: MasterDataColumn[],
): MasterDataRowDetail[] {
  const details: MasterDataRowDetail[] = [];

  records.forEach((record, index) => {
    // Chuẩn hoá khoá bản ghi 1 lần.
    const byKey = new Map<string, unknown>();
    for (const [k, v] of Object.entries(record)) byKey.set(normalizeKey(k), v);

    const lookup = (col: MasterDataColumn) =>
      byKey.has(normalizeKey(col.header))
        ? byKey.get(normalizeKey(col.header))
        : byKey.get(normalizeKey(col.field));

    // Dòng hoàn toàn rỗng → bỏ qua (không tính là lỗi).
    if (columns.every((c) => isEmpty(lookup(c)))) return;

    const values: Record<string, unknown> = {};
    const errors: ImportCellError[] = [];

    for (const col of columns) {
      const coerced = coerceCell(lookup(col), col.type ?? "string");

      if (coerced.empty) {
        if (col.required) errors.push({ field: col.field, message: `"${col.header}" bắt buộc nhập` });
        continue; // rỗng không bắt buộc → bỏ field
      }
      if (coerced.error) {
        errors.push({ field: col.field, message: `"${col.header}" ${coerced.error}` });
        continue;
      }
      values[col.field] = coerced.value;
    }

    details.push({ row: index + 1, values, errors });
  });

  return details;
}

/**
 * Ánh xạ + validate một mảng bản ghi (header-keyed, đã parse từ CSV/XLSX) theo
 * columnSpec → {rows, errors}. Đây là API chính cho server/router.
 */
export function mapAndValidate<T extends Record<string, unknown> = Record<string, unknown>>(
  records: Array<Record<string, unknown>>,
  columns: MasterDataColumn[],
): MasterDataParseResult<T> {
  const rows: T[] = [];
  const errors: ImportRowError[] = [];

  for (const detail of validateRecordsDetailed(records, columns)) {
    rows.push(detail.values as T);
    for (const e of detail.errors) errors.push({ row: detail.row, field: e.field, message: e.message });
  }

  return { rows, errors };
}

/** Ánh xạ ngược một bản ghi field-keyed → header-keyed (cho export). */
export function toHeaderRecord(
  row: Record<string, unknown>,
  columns: MasterDataColumn[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const col of columns) {
    const v = row[col.field];
    out[col.header] = v === null || v === undefined ? "" : v instanceof Date ? v.toISOString() : v;
  }
  return out;
}

/** Một dòng ví dụ (header-keyed) từ các `example` của cột — cho file template. */
export function buildExampleRecord(columns: MasterDataColumn[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const col of columns) {
    if (col.example !== undefined) {
      out[col.header] = col.example;
    } else {
      out[col.header] =
        col.type === "number" ? 0 : col.type === "boolean" ? false : col.type === "date" ? "2026-01-01" : "";
    }
  }
  return out;
}
