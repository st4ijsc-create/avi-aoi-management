/**
 * Lô 4 Mục 3 (BG-36) — ĐƯỜNG ĐỌC cho dead-letter WAL (`inspectionStoreForward.ts`).
 *
 * BG-36 khai: dead-letter "chưa có giao diện" — 101 mục, 7,4 MB, nằm 6 tuần không
 * ai đọc (đo TRƯỚC, xác nhận trên máy này: `data/inspection-store-forward.dead.jsonl`
 * = 101 dòng, 7.410.317 byte). `inspectionStoreForward.ts` chỉ GHI (`deadLetter()`,
 * hàm nội bộ không export) — không hàm nào đọc lại file này. Module này CHỈ THÊM
 * đường đọc, KHÔNG đụng logic ghi/dead-letter/retry hiện có (import `path` để dùng
 * CÙNG quy ước đặt tên file `deadLetterFile()` đã có, không định nghĩa lại đường dẫn
 * theo cách khác).
 *
 * PHẠM VI: chỉ ĐỌC (list phân trang + đọc chi tiết MỘT mục, payload cắt gọn an
 * toàn). KHÔNG resubmit/replay — đó là việc SAU (ngoài phạm vi Lô 4 Mục 3, xem
 * lo-4-brief.md).
 *
 * AN TOÀN PAYLOAD: mỗi dòng dead-letter mang `payload` là NGUYÊN VĂN submission
 * gốc — bao gồm `apiKey` (bí mật máy) và các trường ảnh base64 (`imageBase64` ở
 * v1.x `measurements[]`, tương tự cho các hình dạng khác) có thể DÀI HÀNG CHỤC
 * NGHÌN KÝ TỰ MỘT TRƯỜNG (đo thật trên máy này). `listDeadLetterEntries` không
 * bao giờ trả `payload` (chỉ summary rút từ nó); `getDeadLetterDetail` cắt gọn MỌI
 * chuỗi dài quá `MAX_FIELD_STRING_LENGTH` bằng placeholder + độ dài gốc, và luôn
 * xoá `apiKey` (bí mật, không cần thiết để chẩn đoán lý do dead-letter).
 */
import { promises as fs } from "node:fs";
import path from "node:path";

// CÙNG quy ước walFile()/deadLetterFile() ở `inspectionStoreForward.ts` — đọc TRỰC
// TIẾP từ ENV thay vì import hàm đó (module kia không export nó) để tránh việc
// import gián tiếp kéo theo toàn bộ trạng thái WAL in-memory (queue/worker) vào một
// module chỉ cần ĐỌC FILE. Nếu `inspectionStoreForward.ts` đổi quy ước đặt tên,
// hằng số dưới đây phải đổi theo — canh bằng test `deadLetterReader.test.ts` dùng
// CHÍNH `INSPECTION_STORE_FORWARD_FILE` để trỏ file test.
function walFile(): string {
  const p = process.env.INSPECTION_STORE_FORWARD_FILE?.trim();
  return path.resolve(p && p.length > 0 ? p : "./data/inspection-store-forward.jsonl");
}

function deadLetterFile(): string {
  return walFile().replace(/\.jsonl$/, "") + ".dead.jsonl";
}

interface RawDeadLetterLine {
  key: string;
  deadAt: string;
  attempts: number;
  error: string;
  payload?: {
    machineCode?: string;
    serialNumber?: string;
    apiKey?: string;
    [k: string]: unknown;
  };
}

export interface DeadLetterSummary {
  key: string;
  deadAt: string;
  attempts: number;
  error: string;
  machineCode: string | null;
  serialNumber: string | null;
}

export interface DeadLetterListResult {
  entries: DeadLetterSummary[];
  /** Tổng SỐ MỤC trong toàn file (không phải chỉ trang hiện tại). */
  total: number;
  /** Tổng byte thật của file dead-letter trên đĩa (đo bằng fs.stat, không ước lượng). */
  totalBytes: number;
}

async function docTatCaDong(): Promise<{ raw: RawDeadLetterLine[]; totalBytes: number }> {
  let stat: { size: number };
  try {
    stat = await fs.stat(deadLetterFile());
  } catch {
    // Chưa từng dead-letter mục nào — empty-state TRUNG THỰC, không phải lỗi.
    return { raw: [], totalBytes: 0 };
  }
  let content: string;
  try {
    content = await fs.readFile(deadLetterFile(), "utf8");
  } catch {
    return { raw: [], totalBytes: stat.size };
  }
  const raw: RawDeadLetterLine[] = [];
  for (const line of content.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      const parsed = JSON.parse(t) as RawDeadLetterLine;
      if (typeof parsed.key === "string") raw.push(parsed);
    } catch {
      // Dòng hỏng — bỏ qua an toàn (không làm hỏng cả lượt đọc vì 1 dòng lỗi),
      // cùng triết lý `restoreInspectionWal` (inspectionStoreForward.ts) đã dùng
      // cho file WAL đang hoạt động.
    }
  }
  return { raw, totalBytes: stat.size };
}

/**
 * Danh sách dead-letter phân trang — KHÔNG BAO GIỜ trả `payload` (chỉ 4 trường mô
 * tả rút từ nó: machineCode/serialNumber, đủ để người vận hành nhận diện bo nào,
 * không đủ để rò ảnh/apiKey). `total`/`totalBytes` đo trên TOÀN FILE, không phải
 * trang hiện tại — đúng yêu cầu brief "tổng số + tổng byte".
 */
export async function listDeadLetterEntries(input: {
  offset: number;
  limit: number;
}): Promise<DeadLetterListResult> {
  const { raw, totalBytes } = await docTatCaDong();
  const page = raw.slice(input.offset, input.offset + input.limit);
  const entries: DeadLetterSummary[] = page.map((r) => ({
    key: r.key,
    deadAt: r.deadAt,
    attempts: r.attempts,
    error: r.error,
    machineCode: r.payload?.machineCode ?? null,
    serialNumber: r.payload?.serialNumber ?? null,
  }));
  return { entries, total: raw.length, totalBytes };
}

// ── chi tiết một mục — payload CẮT GỌN AN TOÀN ──────────────────────────────────

/** Chuỗi dài hơn ngưỡng này bị thay bằng placeholder + độ dài gốc (byte tiết
 * kiệm đo được TRÊN MÁY THẬT: dòng dài nhất trong dead-letter thật là 276.974
 * byte, phần lớn là MỘT trường `imageBase64` — 2000 ký tự đã đủ cho người vận
 * hành thấy "có dữ liệu, không rỗng" mà không kéo cả ảnh về client). */
const MAX_FIELD_STRING_LENGTH = 2000;
/** Trần TỔNG kích thước JSON trả về cho MỘT chi tiết — phòng thủ kép: dù cắt
 * từng trường, một payload có RẤT NHIỀU trường trung bình (không có trường nào
 * đơn lẻ vượt MAX_FIELD_STRING_LENGTH) vẫn không được vượt trần này. */
const MAX_DETAIL_JSON_BYTES = 60_000;
const REDACTED_KEYS = new Set(["apikey"]); // so sánh không phân biệt hoa/thường

function catGonGiaTri(value: unknown, depth: number): unknown {
  if (depth > 6) return "[đã cắt: quá sâu]";
  if (typeof value === "string") {
    if (value.length > MAX_FIELD_STRING_LENGTH) {
      return `${value.slice(0, MAX_FIELD_STRING_LENGTH)}… [đã cắt — dài gốc ${value.length} ký tự]`;
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((v) => catGonGiaTri(v, depth + 1));
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (REDACTED_KEYS.has(k.toLowerCase())) {
        out[k] = "[đã xoá — bí mật máy]";
        continue;
      }
      out[k] = catGonGiaTri(v, depth + 1);
    }
    return out;
  }
  return value;
}

export interface DeadLetterDetail {
  key: string;
  deadAt: string;
  attempts: number;
  error: string;
  machineCode: string | null;
  serialNumber: string | null;
  /** Payload gốc đã cắt gọn AN TOÀN — mọi chuỗi dài + `apiKey` đã được xử lý qua
   * `catGonGiaTri`. Dùng để chẩn đoán (xem máy/serial/kết quả khai), KHÔNG dùng để
   * resubmit (đây là bản đã mất dữ liệu — cắt gọn có chủ đích). */
  payload: Record<string, unknown> | null;
}

/**
 * Đọc chi tiết MỘT mục dead-letter theo `key`. Trả `null` nếu không tìm thấy
 * (tra cứu sai khoá — KHÔNG phải lỗi hệ thống). Payload luôn được cắt gọn qua
 * `catGonGiaTri` + trần tổng `MAX_DETAIL_JSON_BYTES` (cắt gọn thêm lần nữa — chỉ
 * còn metadata — nếu bản đã cắt-từng-trường vẫn vượt trần, phòng thủ kép).
 */
export async function getDeadLetterDetail(key: string): Promise<DeadLetterDetail | null> {
  const { raw } = await docTatCaDong();
  const found = raw.find((r) => r.key === key);
  if (!found) return null;

  let payload = (catGonGiaTri(found.payload ?? null, 0) as Record<string, unknown> | null) ?? null;
  if (payload) {
    const bytes = Buffer.byteLength(JSON.stringify(payload), "utf8");
    if (bytes > MAX_DETAIL_JSON_BYTES) {
      // Phòng thủ kép: quá nhiều trường trung bình cộng lại vượt trần — giữ lại
      // CHỈ metadata cấp cao, không cố cắt sâu hơn (tránh vòng lặp cắt phức tạp
      // cho một trường hợp cực hiếm chưa từng đo thấy trên dữ liệu thật).
      payload = {
        machineCode: found.payload?.machineCode ?? null,
        serialNumber: found.payload?.serialNumber ?? null,
        _daCatGonToanBo: `payload gốc quá lớn (${bytes} byte sau khi cắt từng trường, vượt trần ${MAX_DETAIL_JSON_BYTES}) — chỉ còn metadata cấp cao`,
      };
    }
  }

  return {
    key: found.key,
    deadAt: found.deadAt,
    attempts: found.attempts,
    error: found.error,
    machineCode: found.payload?.machineCode ?? null,
    serialNumber: found.payload?.serialNumber ?? null,
    payload,
  };
}
