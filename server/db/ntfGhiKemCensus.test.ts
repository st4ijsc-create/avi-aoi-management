import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * ĐIỀU TRA DÂN SỐ: mọi khối ghi `ntfConfirmedAt` đều ghi kèm `overallResult`.
 *
 * Bất biến DB (server/db/ntfCotKhongLech.db.test.ts) canh HẬU QUẢ trên dữ liệu đã
 * có. Lưới NÀY canh NGUYÊN NHÂN trên chính mã nguồn: quét TOÀN BỘ `server/` tìm
 * mọi "khối ghi" có khả năng đụng `ntfConfirmedAt` — lời gọi drizzle `.set({...})`
 * hoặc câu `UPDATE ... SET ...` viết tay — và khẳng định CÙNG khối đó cũng gán
 * `overallResult`. Thiếu một khối như vậy là đúng cách hai cột bắt đầu lệch: một
 * người viết `.set({ ntfConfirmedAt: new Date() })` ở đâu đó mà quên `overallResult`,
 * bất biến DB vẫn xanh cho tới lần ghi ĐẦU TIÊN kiểu đó — lưới này bắt được NGAY
 * lúc mã được viết, sớm hơn bất biến DB một bước.
 *
 * ⚠ Quét theo HÌNH DẠNG mã (cân bằng ngoặc `{}` sau `.set(`, và khoảng
 * `UPDATE ... SET` tới `WHERE`/`;`/dấu backtick kết thúc), không phải AST đầy đủ —
 * nó KHÔNG bắt được `.set(mộtBiếnĐãDựngSẵn)` (đối tượng xây rời rồi truyền vào).
 * Hôm nay không có chỗ nào viết `ntfConfirmedAt` theo kiểu đó (grep xác nhận CHỈ
 * `server/db/inspection.ts` gán cột này), nên thước đủ để canh dân số thật.
 *
 * Hai ca chống tự thoả:
 *   (1) phải quét được > 300 file .ts dưới server/ (chống glob rỗng);
 *   (2) phải TÌM THẤY ít nhất 1 khối ghi ntfConfirmedAt thật (nếu 0 khối ⇒ thước
 *       hỏng — có thể regex không khớp hình dạng thật — chứ KHÔNG phải "mã sạch").
 */

const TU_KHOA_NTF = /\bntfConfirmedAt\b/;
const TU_KHOA_OVERALL = /\boverallResult\b/;

/** Chính file này bị loại — nó CHỨA hai từ khoá trong docblock/chuỗi ví dụ, không phải một khối ghi. */
const MIEN_TRU_FILE = new Set<string>(["server/db/ntfGhiKemCensus.test.ts"]);

function quetFileTs(goc: string): string[] {
  const ra: string[] = [];
  for (const muc of readdirSync(goc, { withFileTypes: true })) {
    const duong = join(goc, muc.name).replace(/\\/g, "/");
    if (muc.isDirectory()) {
      if (muc.name === "node_modules" || muc.name === "dist") continue;
      ra.push(...quetFileTs(duong));
    } else if (muc.name.endsWith(".ts")) {
      ra.push(duong);
    }
  }
  return ra;
}

/** Trích khối `{...}` CÂN BẰNG ngoặc, bắt đầu tại chỉ số `openIdx` (ký tự phải là '{'). */
function trichKhoiCanBang(nguon: string, openIdx: number): string | null {
  let sau = 0;
  for (let i = openIdx; i < nguon.length; i++) {
    if (nguon[i] === "{") sau++;
    else if (nguon[i] === "}") {
      sau--;
      if (sau === 0) return nguon.slice(openIdx, i + 1);
    }
  }
  return null; // ngoặc không cân bằng trong phần còn lại của file — bỏ qua, không đoán mò.
}

/**
 * Trích mọi "khối ghi" trong một file nguồn:
 *   (1) drizzle `.set({ ... })` — khối đối tượng cân bằng ngoặc ngay sau `.set(`.
 *   (2) SQL thô `UPDATE <bảng> SET ...` — từ `SET` tới `WHERE`/dấu `;`/dấu backtick
 *       kết thúc template literal, cái nào tới trước.
 */
function trichKhoiGhi(nguon: string): string[] {
  const khoi: string[] = [];

  const reSet = /\.set\s*\(\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = reSet.exec(nguon))) {
    const idxMo = nguon.indexOf("{", m.index);
    const b = trichKhoiCanBang(nguon, idxMo);
    if (b) khoi.push(b);
  }

  const reUpdate = /\bUPDATE\s+\S+\s+SET\b/gi;
  while ((m = reUpdate.exec(nguon))) {
    const batDau = m.index;
    const phanSau = nguon.slice(batDau + m[0].length);
    const ketThuc = /\bWHERE\b|`|;/i.exec(phanSau);
    const doDai = ketThuc ? ketThuc.index : phanSau.length;
    khoi.push(nguon.slice(batDau, batDau + m[0].length + doDai));
  }

  return khoi;
}

describe("điều tra dân số: mọi khối ghi ntfConfirmedAt đều ghi kèm overallResult", () => {
  it("KHÔNG khối ghi nào set ntfConfirmedAt mà thiếu overallResult trong CÙNG khối", () => {
    const viPham: string[] = [];
    let soKhoiNtf = 0;
    for (const f of quetFileTs("server")) {
      if (MIEN_TRU_FILE.has(f)) continue;
      const nguon = readFileSync(f, "utf8");
      if (!TU_KHOA_NTF.test(nguon)) continue; // fast-path: đa số file không nhắc tới cột này
      for (const khoi of trichKhoiGhi(nguon)) {
        if (!TU_KHOA_NTF.test(khoi)) continue;
        soKhoiNtf++;
        if (!TU_KHOA_OVERALL.test(khoi)) {
          viPham.push(`${f}\n${khoi.slice(0, 300)}`);
        }
      }
    }
    expect(
      soKhoiNtf,
      "0 khối ghi ntfConfirmedAt nào được tìm thấy — thước HỎNG (regex không khớp hình dạng thật), " +
        "không phải bằng chứng 'mã sạch'. Đọc lại trichKhoiGhi().",
    ).toBeGreaterThan(0);
    expect(viPham, `Khối ghi ntfConfirmedAt THIẾU overallResult:\n${viPham.join("\n---\n")}`).toEqual([]);
  });

  it("chống glob rỗng — quét được > 300 file .ts dưới server/", () => {
    expect(quetFileTs("server").length).toBeGreaterThan(300);
  });
});
