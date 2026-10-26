/**
 * ★ MCP cục bộ — TRUY VẤN DB CHỈ ĐỌC.
 *
 * Hàng rào thật nằm ở PHÍA CSDL, không ở bộ lọc văn bản:
 *   1. Kết nối bằng vai trò riêng `mcp_chi_doc` (tạo bởi `scripts/mcp-cuc-bo-vai-tro.mjs`): chỉ CONNECT + USAGE + SELECT;
 *      bảng có cột nhạy cảm (mật khẩu, băm, khoá, token, bí mật, TOTP …) chỉ được SELECT các cột KHÁC (cấp theo cột).
 *      Bảng tạo SAU lần chạy script KHÔNG tự thấy (không đặt default privileges) — chạy lại script để cấp.
 *   2. Mỗi truy vấn chạy trong `BEGIN READ ONLY` + `statement_timeout` riêng, đọc bằng cursor (giao thức mở rộng) ⇒ một câu lệnh
 *      (`SELECT 1; DROP …` bị máy chủ từ chối: "cannot insert multiple commands into a prepared statement") — xem `chayChiDoc`.
 *   3. Bộ lọc văn bản dưới đây chỉ để BÁO LỖI SỚM, dễ hiểu — không phải hàng rào.
 *
 * ⚠ GIỚI HẠN đã biết: vai trò đọc được dữ liệu MỌI nhà máy (không có phạm vi nhà máy theo hàng). Chỉ dùng trên máy chủ nội bộ, và node
 *   MCP của Luồng mang hạng `ngoai-ghi` (bật luồng cần quyền). Không mở cổng MCP ra mạng.
 */
import postgres from "postgres";

export const TRAN_HANG = 500;
export const TRAN_BYTE_KET_QUA = 900 * 1024;
export const HAN_TRUY_VAN_MS = 5000;

export class LoiDb extends Error {
  constructor(message: string, readonly ma: string) {
    super(message);
    this.name = "LoiDb";
  }
}

/** Bỏ chú thích `--` và `/* *\/` (không đụng chuỗi trong nháy đơn) để kiểm từ khoá đầu câu. */
export function boChuThich(sql: string): string {
  let ra = "";
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    if (c === "'") {
      const j = sql.indexOf("'", i + 1);
      const het = j === -1 ? sql.length : j + 1;
      ra += sql.slice(i, het);
      i = het;
    } else if (c === "-" && sql[i + 1] === "-") {
      const j = sql.indexOf("\n", i);
      i = j === -1 ? sql.length : j;
    } else if (c === "/" && sql[i + 1] === "*") {
      const j = sql.indexOf("*/", i + 2);
      i = j === -1 ? sql.length : j + 2;
      ra += " ";
    } else {
      ra += c;
      i++;
    }
  }
  return ra;
}

/** Kiểm sơ bộ: một câu, bắt đầu bằng SELECT / WITH / EXPLAIN / TABLE / VALUES. Trả câu đã bỏ dấu `;` cuối. */
export function kiemSqlChiDoc(sql: unknown): string {
  if (typeof sql !== "string") throw new LoiDb("sql phải là chuỗi", "THAM_SO_SAI");
  if (sql.length > 20_000) throw new LoiDb("sql quá dài (tối đa 20 000 ký tự)", "THAM_SO_SAI");
  const sach = boChuThich(sql).trim().replace(/;\s*$/, "");
  if (sach === "") throw new LoiDb("sql rỗng", "THAM_SO_SAI");
  // `;` trong chuỗi / tên trong nháy không tính (máy chủ vẫn là hàng rào cuối: giao thức mở rộng chỉ nhận MỘT câu).
  const khung = sach.replace(/'(?:[^']|'')*'/g, "''").replace(/"(?:[^"]|"")*"/g, '""');
  if (khung.includes(";")) throw new LoiDb("chỉ một câu lệnh mỗi lần gọi", "NHIEU_CAU");
  if (!/^(select|with|explain|table|values)\b/i.test(sach)) throw new LoiDb("chỉ nhận SELECT / WITH / EXPLAIN / TABLE / VALUES", "KHONG_PHAI_DOC");
  if (/^explain\b[^]*\banalyze\b/i.test(khung)) throw new LoiDb("EXPLAIN ANALYZE không được phép (thực thi câu lệnh)", "KHONG_PHAI_DOC");
  return sql.trim().replace(/;\s*$/, "");
}

export interface KetNoiDb {
  sql: postgres.Sql;
  dong(): Promise<void>;
}

export function taoKetNoiDb(url: string): KetNoiDb {
  const sql = postgres(url, { max: 3, idle_timeout: 30, connect_timeout: 10, prepare: false, onnotice: () => undefined });
  return { sql, dong: () => sql.end({ timeout: 5 }) };
}

function chuanHoaGiaTri(v: unknown): unknown {
  if (typeof v === "bigint") return v.toString();
  if (v instanceof Date) return v.toISOString();
  if (Buffer.isBuffer(v)) return `[bytea ${v.length} byte]`;
  return v;
}

export async function truyVan(db: KetNoiDb, sqlVao: unknown): Promise<{ cot: string[]; hang: unknown[][]; soHang: number; biCat: boolean }> {
  return chayChiDoc(db, kiemSqlChiDoc(sqlVao));
}

/**
 * Phần THỰC THI (đã qua kiểm văn bản). Tách riêng để lưới kiểm hàng rào phía máy chủ KHI BỎ QUA bộ lọc văn bản.
 * ⚠ `tx.unsafe(cau)` KHÔNG kèm `.cursor()` dùng giao thức ĐƠN GIẢN của postgres.js ⇒ NHẬN nhiều câu (đã đo 2026-10-26);
 *   `.cursor()` buộc giao thức MỞ RỘNG ⇒ máy chủ từ chối "cannot insert multiple commands into a prepared statement". Đừng bỏ cursor.
 */
export async function chayChiDoc(db: KetNoiDb, cau: string): Promise<{ cot: string[]; hang: unknown[][]; soHang: number; biCat: boolean }> {
  try {
    return await db.sql.begin("READ ONLY", async (tx) => {
      await tx.unsafe(`SET LOCAL statement_timeout = ${HAN_TRUY_VAN_MS}`);
      const ketQua: unknown[][] = [];
      let cot: string[] = [];
      let biCat = false;
      let byte = 0;
      // cursor: không kéo cả bảng vào RAM — lấy tới TRAN_HANG + 1 rồi dừng.
      for await (const lo of tx.unsafe(cau).cursor(100)) {
        if (cot.length === 0 && lo.length > 0) cot = Object.keys(lo[0] as object);
        for (const h of lo) {
          if (ketQua.length >= TRAN_HANG) {
            biCat = true;
            break;
          }
          const dong = cot.map((c) => chuanHoaGiaTri((h as Record<string, unknown>)[c]));
          byte += JSON.stringify(dong).length;
          if (byte > TRAN_BYTE_KET_QUA) {
            biCat = true;
            break;
          }
          ketQua.push(dong);
        }
        if (biCat) break;
      }
      return { cot, hang: ketQua, soHang: ketQua.length, biCat };
    });
  } catch (e) {
    if (e instanceof LoiDb) throw e;
    const m = e as { message?: string; code?: string };
    throw new LoiDb(`CSDL từ chối: ${String(m.message ?? e).slice(0, 300)}`, m.code === "42501" ? "KHONG_CO_QUYEN" : "LOI_CSDL");
  }
}

/** Danh sách bảng + cột mà vai trò hiện tại ĐỌC ĐƯỢC (theo quyền thật, không theo danh sách viết tay). */
export async function lietKeBang(db: KetNoiDb, locTen: unknown): Promise<Array<{ bang: string; cot: string[] }>> {
  const loc = typeof locTen === "string" && locTen.trim() !== "" ? `%${locTen.trim().toLowerCase().slice(0, 60)}%` : "%";
  const rows = await db.sql<Array<{ bang: string; cot: string[] }>>`
    SELECT c.table_name AS bang, array_agg(c.column_name::text ORDER BY c.ordinal_position) AS cot
    FROM information_schema.columns c
    WHERE c.table_schema = 'public' AND lower(c.table_name) LIKE ${loc}
      AND has_column_privilege(current_user, quote_ident(c.table_schema) || '.' || quote_ident(c.table_name), c.column_name, 'SELECT')
    GROUP BY c.table_name ORDER BY c.table_name LIMIT 1000`;
  return rows.map((r) => ({ bang: r.bang, cot: r.cot }));
}
