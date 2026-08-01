/**
 * Doc 42 Đợt 4A (INFRA-4A) — engine import/export dùng chung cho bảng master-data.
 *
 * Thuần I/O buffer: nhận/sinh CSV (BOM UTF-8, RFC-4180) & XLSX (exceljs). Toàn
 * bộ LUẬT ánh xạ header→field + ép kiểu + validate nằm ở `@shared/masterDataIO`
 * (dùng chung với client ImportExportBar → không lệch). Router chỉ cần:
 *
 *   const { rows, errors } = await parseImport(buf, "xlsx", COLUMNS);
 *   if (errors.length) throw new TRPCError({ code: "BAD_REQUEST", ... });
 *   // upsert rows...
 *
 * và để tải xuống:
 *   const buf = await exportRows(rows, COLUMNS, "xlsx");  // hoặc "csv"
 *   const tmpl = await buildTemplate(COLUMNS, "xlsx");
 */
import ExcelJS from "exceljs";
import { toCsvLine } from "./universalExportService";
import {
  type MasterDataColumn,
  type MasterDataParseResult,
  type MasterDataFormat,
  mapAndValidate,
  toHeaderRecord,
  buildExampleRecord,
} from "@shared/masterDataIO";

export type {
  MasterDataColumn,
  MasterDataColumnType,
  MasterDataFormat,
  MasterDataParseResult,
  ImportRowError,
} from "@shared/masterDataIO";

const XLSX_HEADER_FILL = "FF1E3A5F"; // brand navy (khớp universalExportService)

// ─── EXPORT ──────────────────────────────────────────────────────────────────

/**
 * Sinh buffer export cho `rows` theo `columns` (header = nhãn cột). Header ở
 * DÒNG 1 (không banner) để export→parse round-trip lại được.
 */
export async function exportRows(
  rows: Array<Record<string, unknown>>,
  columns: MasterDataColumn[],
  format: MasterDataFormat,
): Promise<Buffer> {
  if (format === "csv") return csvBuffer(columns, rows);
  return xlsxBuffer(columns, rows);
}

/** File mẫu rỗng: chỉ header + 1 dòng ví dụ (từ `column.example`). */
export async function buildTemplate(
  columns: MasterDataColumn[],
  format: MasterDataFormat = "xlsx",
): Promise<Buffer> {
  const example = buildExampleRecord(columns);
  const exampleRow: Record<string, unknown> = {};
  for (const col of columns) exampleRow[col.field] = example[col.header];
  if (format === "csv") return csvBuffer(columns, [exampleRow]);
  return xlsxBuffer(columns, [exampleRow]);
}

function csvBuffer(columns: MasterDataColumn[], rows: Array<Record<string, unknown>>): Buffer {
  const header = toCsvLine(columns.map((c) => c.header));
  const body = rows
    .map((row) => {
      const hr = toHeaderRecord(row, columns);
      return toCsvLine(columns.map((c) => hr[c.header]));
    })
    .join("");
  // BOM để Excel mở đúng UTF-8 (tiếng Việt).
  return Buffer.from("﻿" + header + body, "utf8");
}

async function xlsxBuffer(columns: MasterDataColumn[], rows: Array<Record<string, unknown>>): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "SYNAPSE";
  wb.created = new Date();
  const ws = wb.addWorksheet("Data");

  const headerRow = ws.addRow(columns.map((c) => c.header));
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  headerRow.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: XLSX_HEADER_FILL } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
  });
  headerRow.height = 22;

  columns.forEach((col, i) => {
    ws.getColumn(i + 1).width = Math.max(12, Math.min(40, col.header.length + 4));
  });

  for (const row of rows) {
    const hr = toHeaderRecord(row, columns);
    ws.addRow(columns.map((c) => hr[c.header]));
  }

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

// ─── IMPORT (parse + validate) ───────────────────────────────────────────────

/**
 * Parse buffer CSV/XLSX → header-keyed records → ánh xạ field + ép kiểu +
 * validate (dùng luật chung `@shared/masterDataIO`). Trả {rows, errors}.
 */
export async function parseImport<T extends Record<string, unknown> = Record<string, unknown>>(
  buffer: Buffer,
  format: MasterDataFormat,
  columnSpec: MasterDataColumn[],
): Promise<MasterDataParseResult<T>> {
  const records = format === "csv" ? parseCsvRecords(buffer) : await parseXlsxRecords(buffer);
  return mapAndValidate<T>(records, columnSpec);
}

/** CSV buffer → mảng bản ghi header-keyed. Bỏ BOM, hỗ trợ ô có dấu nháy/xuống dòng. */
function parseCsvRecords(buffer: Buffer): Array<Record<string, unknown>> {
  let text = buffer.toString("utf8");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // strip BOM
  const table = parseCsvTable(text);
  if (table.length === 0) return [];
  const headers = table[0].map((h) => h.trim());
  const out: Array<Record<string, unknown>> = [];
  for (let r = 1; r < table.length; r++) {
    const cells = table[r];
    const rec: Record<string, unknown> = {};
    headers.forEach((h, i) => {
      rec[h] = cells[i] ?? "";
    });
    out.push(rec);
  }
  return out;
}

/** Parser CSV RFC-4180 tối giản (quote ", escape "", CR/LF trong ô, CRLF/LF). */
function parseCsvTable(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  let i = 0;
  const n = text.length;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  while (i < n) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ",") {
      endField();
      i++;
      continue;
    }
    if (ch === "\r") {
      // \r\n → xử lý như một dấu xuống dòng
      if (text[i + 1] === "\n") i++;
      endRow();
      i++;
      continue;
    }
    if (ch === "\n") {
      endRow();
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  // Dòng cuối (nếu có nội dung hoặc file không kết bằng newline).
  if (field.length > 0 || row.length > 0) endRow();

  // Bỏ các dòng rỗng hoàn toàn (chỉ 1 ô "" ).
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ""));
}

/** XLSX buffer → mảng bản ghi header-keyed (đọc worksheet đầu, dòng 1 = header). */
async function parseXlsxRecords(buffer: Buffer): Promise<Array<Record<string, unknown>>> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) return [];

  const headers: string[] = [];
  const headerRow = ws.getRow(1);
  headerRow.eachCell({ includeEmpty: true }, (cell, col) => {
    headers[col - 1] = String(cellValue(cell.value) ?? "").trim();
  });

  const out: Array<Record<string, unknown>> = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const rec: Record<string, unknown> = {};
    let hasAny = false;
    headers.forEach((h, i) => {
      if (!h) return;
      const v = cellValue(row.getCell(i + 1).value);
      if (v !== null && v !== undefined && v !== "") hasAny = true;
      rec[h] = v ?? "";
    });
    if (hasAny) out.push(rec);
  }
  return out;
}

/** Chuẩn hoá ExcelJS CellValue → primitive (Date/number/string/boolean). */
function cellValue(v: ExcelJS.CellValue): unknown {
  if (v === null || v === undefined) return v;
  if (v instanceof Date) return v;
  if (typeof v === "object") {
    const o = v as unknown as Record<string, unknown>;
    if ("richText" in o && Array.isArray(o.richText)) {
      return (o.richText as Array<{ text?: string }>).map((rt) => rt.text ?? "").join("");
    }
    if ("text" in o) return o.text; // hyperlink → text
    if ("result" in o) return o.result; // formula → result
    return String(v);
  }
  return v;
}
