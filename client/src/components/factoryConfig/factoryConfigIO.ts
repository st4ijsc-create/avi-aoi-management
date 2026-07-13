/**
 * doc 47 IA Đợt 3 — bộ công cụ THUẦN (không React) cho panel Nhập/Xuất cấu hình
 * nhà máy. Tách khỏi FactoryConfigImportExport.tsx cho gọn: định nghĩa cột từng
 * cấp, đọc/ép kiểu/kiểm tra file CSV·Excel phía client, dựng dòng xuất (đã resolve
 * mã cha) và dựng file mẫu.
 *
 * NGUYÊN TẮC TRUNG THỰC: shape mỗi dòng import BÁM SÁT `.input()` zod THẬT của
 * `trpc.import.*` (server/routers/dataRouters.ts). Tên cột file = KHOÁ KỸ THUẬT
 * (code, name, factoryCode…) — không dịch — để file xuất/mẫu re-import được
 * (round-trip). Máy loại nào không khớp enum server bị chặn TRƯỚC khi gửi.
 */
import * as XLSX from "xlsx";

/** Mirror của server/constants/machineTypes.ts — GIỮ ĐỒNG BỘ (order + values).
 * Bản client/src/constants/machineTypes.ts đang thiếu 4 loại SMT nên KHÔNG dùng ở
 * đây; danh sách đủ 21 giá trị này khớp `z.enum(MACHINE_TYPES)` của importMachines. */
export const IMPORT_MACHINE_TYPES = [
  "AVI", "AOI", "SPI", "AXI", "ICT", "FCT", "CMM", "AUTOMATION",
  "FEEDER", "ASSEMBLY", "SCREWDRIVE", "DISPENSING", "ICT_FUNC", "ROBOT_TEST",
  "PACKAGING", "PALLETIZER", "ROBOT",
  "MOUNTER", "REFLOW", "STENCIL_PRINTER", "WAVE_SOLDER",
] as const;

export type FactoryLevel = "factory" | "workshop" | "line" | "station" | "machine";
export const FACTORY_LEVELS: FactoryLevel[] = ["factory", "workshop", "line", "station", "machine"];

export type FieldType = "string" | "number" | "boolean" | "enum";

export interface FieldDef {
  /** Khoá kỹ thuật = tên cột file = khoá gửi server (khớp zod). */
  key: string;
  /** i18n key + default cho nhãn hiển thị (preview/UI). */
  labelKey: string;
  labelDefault: string;
  type: FieldType;
  required: boolean;
  /** Trường này là MÃ CHA — phải resolve được trong DB hiện có. */
  parentRef?: boolean;
  enumValues?: readonly string[];
  /** Giá trị ví dụ dùng cho file mẫu. */
  example?: string | number | boolean;
}

export interface LevelDef {
  level: FactoryLevel;
  labelKey: string;
  labelDefault: string;
  /** Tên procedure trong importRouter (server/routers/dataRouters.ts). */
  importProc:
    | "importFactories"
    | "importWorkshops"
    | "importLines"
    | "importStations"
    | "importMachines";
  fields: FieldDef[];
  /** Cấp cha (để resolve mã cha khi xuất/kiểm tra). null = gốc. */
  parent: FactoryLevel | null;
  /** Khoá id-cha trên bản ghi DB (dùng khi dựng dòng xuất). */
  parentIdKey?: "factoryId" | "workshopId" | "lineId" | "stationId";
}

// ── Định nghĩa từng cấp — cột file = shape zod THẬT của import ────────────────
export const LEVEL_DEFS: Record<FactoryLevel, LevelDef> = {
  factory: {
    level: "factory",
    labelKey: "factoryIO.level.factory",
    labelDefault: "Nhà máy",
    importProc: "importFactories",
    parent: null,
    fields: [
      { key: "code", labelKey: "factoryIO.field.code", labelDefault: "Mã", type: "string", required: true, example: "FAC-01" },
      { key: "name", labelKey: "factoryIO.field.name", labelDefault: "Tên", type: "string", required: true, example: "Nhà máy Bắc Ninh" },
      { key: "description", labelKey: "factoryIO.field.description", labelDefault: "Mô tả", type: "string", required: false, example: "" },
      { key: "address", labelKey: "factoryIO.field.address", labelDefault: "Địa chỉ", type: "string", required: false, example: "" },
      { key: "region", labelKey: "factoryIO.field.region", labelDefault: "Khu vực", type: "string", required: false, example: "" },
      { key: "country", labelKey: "factoryIO.field.country", labelDefault: "Quốc gia", type: "string", required: false, example: "VN" },
      { key: "isActive", labelKey: "factoryIO.field.isActive", labelDefault: "Kích hoạt", type: "boolean", required: false, example: true },
    ],
  },
  workshop: {
    level: "workshop",
    labelKey: "factoryIO.level.workshop",
    labelDefault: "Phân xưởng",
    importProc: "importWorkshops",
    parent: "factory",
    parentIdKey: "factoryId",
    fields: [
      { key: "factoryCode", labelKey: "factoryIO.field.factoryCode", labelDefault: "Mã nhà máy", type: "string", required: true, parentRef: true, example: "FAC-01" },
      { key: "code", labelKey: "factoryIO.field.code", labelDefault: "Mã", type: "string", required: true, example: "WS-01" },
      { key: "name", labelKey: "factoryIO.field.name", labelDefault: "Tên", type: "string", required: true, example: "Xưởng SMT" },
      { key: "description", labelKey: "factoryIO.field.description", labelDefault: "Mô tả", type: "string", required: false, example: "" },
      { key: "isActive", labelKey: "factoryIO.field.isActive", labelDefault: "Kích hoạt", type: "boolean", required: false, example: true },
    ],
  },
  line: {
    level: "line",
    labelKey: "factoryIO.level.line",
    labelDefault: "Dây chuyền",
    importProc: "importLines",
    parent: "workshop",
    parentIdKey: "workshopId",
    fields: [
      { key: "workshopCode", labelKey: "factoryIO.field.workshopCode", labelDefault: "Mã xưởng", type: "string", required: true, parentRef: true, example: "WS-01" },
      { key: "code", labelKey: "factoryIO.field.code", labelDefault: "Mã", type: "string", required: true, example: "LINE-01" },
      { key: "name", labelKey: "factoryIO.field.name", labelDefault: "Tên", type: "string", required: true, example: "Dây chuyền 1" },
      { key: "description", labelKey: "factoryIO.field.description", labelDefault: "Mô tả", type: "string", required: false, example: "" },
      { key: "capacityPerHour", labelKey: "factoryIO.field.capacityPerHour", labelDefault: "Công suất/giờ", type: "number", required: false, example: 120 },
      { key: "maxConcurrentOrders", labelKey: "factoryIO.field.maxConcurrentOrders", labelDefault: "Số lệnh tối đa", type: "number", required: false, example: 1 },
      { key: "isActive", labelKey: "factoryIO.field.isActive", labelDefault: "Kích hoạt", type: "boolean", required: false, example: true },
    ],
  },
  station: {
    level: "station",
    labelKey: "factoryIO.level.station",
    labelDefault: "Trạm",
    importProc: "importStations",
    parent: "line",
    parentIdKey: "lineId",
    fields: [
      { key: "lineCode", labelKey: "factoryIO.field.lineCode", labelDefault: "Mã dây chuyền", type: "string", required: true, parentRef: true, example: "LINE-01" },
      { key: "code", labelKey: "factoryIO.field.code", labelDefault: "Mã", type: "string", required: true, example: "ST-01" },
      { key: "name", labelKey: "factoryIO.field.name", labelDefault: "Tên", type: "string", required: true, example: "Trạm AOI" },
      { key: "description", labelKey: "factoryIO.field.description", labelDefault: "Mô tả", type: "string", required: false, example: "" },
      { key: "orderIndex", labelKey: "factoryIO.field.orderIndex", labelDefault: "Thứ tự", type: "number", required: false, example: 1 },
      { key: "isActive", labelKey: "factoryIO.field.isActive", labelDefault: "Kích hoạt", type: "boolean", required: false, example: true },
    ],
  },
  machine: {
    level: "machine",
    labelKey: "factoryIO.level.machine",
    labelDefault: "Máy",
    importProc: "importMachines",
    parent: "station",
    parentIdKey: "stationId",
    fields: [
      { key: "stationCode", labelKey: "factoryIO.field.stationCode", labelDefault: "Mã trạm", type: "string", required: true, parentRef: true, example: "ST-01" },
      { key: "code", labelKey: "factoryIO.field.code", labelDefault: "Mã", type: "string", required: true, example: "M-01" },
      { key: "name", labelKey: "factoryIO.field.name", labelDefault: "Tên", type: "string", required: true, example: "Máy AOI 1" },
      { key: "machineType", labelKey: "factoryIO.field.machineType", labelDefault: "Loại máy", type: "enum", required: true, enumValues: IMPORT_MACHINE_TYPES, example: "AOI" },
      { key: "model", labelKey: "factoryIO.field.model", labelDefault: "Model", type: "string", required: false, example: "" },
      { key: "manufacturer", labelKey: "factoryIO.field.manufacturer", labelDefault: "Hãng SX", type: "string", required: false, example: "" },
      { key: "isActive", labelKey: "factoryIO.field.isActive", labelDefault: "Kích hoạt", type: "boolean", required: false, example: true },
    ],
  },
};

// ── Ép kiểu ô ────────────────────────────────────────────────────────────────
const TRUE_TOKENS = new Set(["true", "1", "yes", "y", "co", "có", "x", "active", "on"]);
const FALSE_TOKENS = new Set(["false", "0", "no", "n", "khong", "không", "inactive", "off"]);

function cellString(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

/** true/false/undefined; trả `{ ok, value }` — ok=false nghĩa là giá trị không hiểu được. */
function coerceBoolean(v: unknown): { ok: boolean; value?: boolean } {
  if (v == null || v === "") return { ok: true, value: undefined };
  if (typeof v === "boolean") return { ok: true, value: v };
  const s = cellString(v).toLowerCase();
  if (TRUE_TOKENS.has(s)) return { ok: true, value: true };
  if (FALSE_TOKENS.has(s)) return { ok: true, value: false };
  return { ok: false };
}

function coerceNumber(v: unknown): { ok: boolean; value?: number } {
  if (v == null || v === "") return { ok: true, value: undefined };
  if (typeof v === "number") return Number.isFinite(v) ? { ok: true, value: v } : { ok: false };
  const n = Number(cellString(v));
  return Number.isFinite(n) ? { ok: true, value: n } : { ok: false };
}

// ── Kiểm tra + ép kiểu 1 dòng ────────────────────────────────────────────────
export interface ParsedRow {
  /** Chỉ số dòng dữ liệu (1-based, không kể header). */
  rowNumber: number;
  /** Giá trị đã ép kiểu, chỉ gồm field có giá trị — sẵn sàng gửi server. */
  values: Record<string, unknown>;
  /** Lỗi chặn gửi (thiếu bắt buộc, sai kiểu/enum, mã cha không resolve). */
  errors: string[];
  /** Mã đã tồn tại trong cấp này → import sẽ cập nhật (nếu ghi đè) hoặc báo lỗi. */
  codeExists: boolean;
  get valid(): boolean;
}

export interface ValidationCtx {
  /** Mã cha hiện có trong DB (rỗng nếu cấp gốc). */
  parentCodes: Set<string>;
  /** Mã đang có ở chính cấp này (để cảnh báo trùng). */
  existingCodes: Set<string>;
  /** Nhãn đã dịch, dùng dựng message lỗi thân thiện. */
  labelOf: (field: FieldDef) => string;
  parentLabel: string;
}

/** Đọc ô theo key KHÔNG phân biệt hoa/thường (header có thể "Code" hay "code"). */
function pickCell(raw: Record<string, unknown>, key: string): unknown {
  if (key in raw) return raw[key];
  const lower = key.toLowerCase();
  for (const k of Object.keys(raw)) {
    if (k.toLowerCase().trim() === lower) return raw[k];
  }
  return undefined;
}

export function validateRow(
  level: FactoryLevel,
  raw: Record<string, unknown>,
  rowNumber: number,
  ctx: ValidationCtx,
): ParsedRow {
  const def = LEVEL_DEFS[level];
  const values: Record<string, unknown> = {};
  const errors: string[] = [];

  for (const field of def.fields) {
    const rawVal = pickCell(raw, field.key);
    const label = ctx.labelOf(field);

    if (field.type === "boolean") {
      const r = coerceBoolean(rawVal);
      if (!r.ok) errors.push(`${label}: ${cellString(rawVal)} — cần true/false`);
      else if (r.value !== undefined) values[field.key] = r.value;
      continue;
    }
    if (field.type === "number") {
      const r = coerceNumber(rawVal);
      if (!r.ok) errors.push(`${label}: "${cellString(rawVal)}" — phải là số`);
      else if (r.value !== undefined) values[field.key] = r.value;
      continue;
    }

    // string | enum
    const s = cellString(rawVal);
    if (!s) {
      if (field.required) errors.push(`${label}: thiếu (bắt buộc)`);
      continue;
    }
    if (field.type === "enum") {
      const upper = s.toUpperCase();
      if (!field.enumValues?.includes(upper)) {
        errors.push(`${label}: "${s}" không hợp lệ`);
        continue;
      }
      values[field.key] = upper;
      continue;
    }
    // parent-ref: phải resolve được trong DB hiện có
    if (field.parentRef) {
      values[field.key] = s;
      if (!ctx.parentCodes.has(s)) {
        errors.push(`${ctx.parentLabel} "${s}": không tìm thấy`);
      }
      continue;
    }
    values[field.key] = s;
  }

  const code = typeof values.code === "string" ? values.code : "";
  const codeExists = code !== "" && ctx.existingCodes.has(code);

  return {
    rowNumber,
    values,
    errors,
    codeExists,
    get valid() {
      return this.errors.length === 0;
    },
  };
}

// ── Đọc file (CSV / Excel) → mảng dòng thô ───────────────────────────────────
export async function readSheetRows(file: File): Promise<Record<string, unknown>[]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const first = wb.SheetNames[0];
  if (!first) return [];
  const ws = wb.Sheets[first];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
}

// ── Dựng dòng XUẤT (đã resolve mã cha) từ list DB thô ─────────────────────────
type Row = Record<string, unknown>;

/** Map id → code cho một list bất kỳ. */
export function codeById(rows: Row[]): Map<number, string> {
  const m = new Map<number, string>();
  for (const r of rows) {
    const id = r.id;
    if (typeof id === "number") m.set(id, cellString(r.code));
  }
  return m;
}

/**
 * Dựng data xuất cho 1 cấp: mỗi dòng khoá theo field.key của cấp (kể cả mã cha đã
 * resolve). Cột khớp import → file xuất re-import được. Trả `[]` nếu không có dòng.
 */
export function buildExportRows(
  level: FactoryLevel,
  rows: Row[],
  parentCodeById: Map<number, string> | null,
): Record<string, unknown>[] {
  const def = LEVEL_DEFS[level];
  return rows.map((r) => {
    const out: Record<string, unknown> = {};
    for (const field of def.fields) {
      if (field.parentRef && def.parentIdKey && parentCodeById) {
        const pid = r[def.parentIdKey];
        out[field.key] = typeof pid === "number" ? parentCodeById.get(pid) ?? "" : "";
      } else if (field.type === "boolean") {
        out[field.key] = r[field.key] === true;
      } else {
        const v = r[field.key];
        out[field.key] = v == null ? "" : v;
      }
    }
    return out;
  });
}

// ── File mẫu (Tải mẫu) — cột đúng shape import + 1 dòng ví dụ ─────────────────
export function downloadTemplate(level: FactoryLevel): void {
  const def = LEVEL_DEFS[level];
  const example: Record<string, unknown> = {};
  for (const f of def.fields) example[f.key] = f.example ?? "";
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet([example], { header: def.fields.map((f) => f.key) });
  XLSX.utils.book_append_sheet(wb, ws, def.level);
  XLSX.writeFile(wb, `mau-${def.level}.xlsx`);
}
